import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const distDir = new URL('../dist/', import.meta.url);
const manifestPath = new URL('../dist/.vite/manifest.json', import.meta.url);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory.pathname, entry.name);
    return entry.isDirectory() ? listFiles(new URL(`file://${path}/`)) : [path];
  }));
  return nested.flat();
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const files = await listFiles(distDir);
const assets = await Promise.all(files
  .filter((path) => /\.(?:js|css)$/.test(path))
  .map(async (path) => {
    const content = await readFile(path);
    return {
      file: relative(distDir.pathname, path),
      raw: (await stat(path)).size,
      gzip: gzipSync(content, { level: 9 }).length
    };
  }));

const byFile = new Map(assets.map((asset) => [asset.file, asset]));
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error('Vite manifest does not contain an entry chunk.');

const initialFiles = new Set();
function collectInitial(item) {
  if (!item || initialFiles.has(item.file)) return;
  initialFiles.add(item.file);
  for (const importedKey of item.imports ?? []) collectInitial(manifest[importedKey]);
}
collectInitial(entry);

const initialJs = [...initialFiles].map((file) => byFile.get(file)).filter(Boolean);
const entryAsset = byFile.get(entry.file);
const workerAsset = assets.find((asset) => asset.file.includes('cutTexture.worker-'));
const cssAssets = assets.filter((asset) => asset.file.endsWith('.css'));

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const budgets = [
  ['business entry raw', entryAsset?.raw ?? Infinity, 120 * 1024],
  ['initial JavaScript gzip', initialJs.reduce((sum, asset) => sum + asset.gzip, 0), 170 * 1024],
  ['cut worker raw', workerAsset?.raw ?? Infinity, 110 * 1024],
  ['CSS gzip', cssAssets.reduce((sum, asset) => sum + asset.gzip, 0), 6 * 1024]
];

let failed = false;
for (const [label, actual, limit] of budgets) {
  const ok = actual <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${kib(actual)} / ${kib(limit)}`);
}

if (failed) {
  console.error('Build performance budget exceeded.');
  process.exitCode = 1;
}
