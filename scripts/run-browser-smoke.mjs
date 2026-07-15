import { spawn, spawnSync } from 'node:child_process';

const candidates = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser'
].filter(Boolean);

const chrome = candidates.find((candidate) => {
  const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
});

if (!chrome) {
  console.error('A Chrome/Chromium executable is required for the browser performance smoke test.');
  process.exit(1);
}

const preview = spawn(process.execPath, [
  './node_modules/vite/bin/vite.js',
  'preview',
  '--host', '127.0.0.1',
  '--port', '4173',
  '--strictPort'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function waitForPreview() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4173/3d-gem-hunter/');
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become ready within 10 seconds.');
}

try {
  await waitForPreview();
  const result = spawnSync(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=14000',
    '--dump-dom',
    'http://127.0.0.1:4173/3d-gem-hunter/?perf-test=1&perf-tier=ci'
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Chrome exited with ${result.status}`);
  const passed = /<html[^>]*data-perf-test="pass"/i.test(result.stdout);
  const metrics = result.stdout.match(/<pre id="perf-result"[^>]*>(.*?)<\/pre>/s)?.[1]
    ?.replaceAll('&quot;', '"')
    ?.replaceAll('&amp;', '&');
  if (metrics) console.log(metrics);
  if (!passed) throw new Error('Mobile WebGL performance smoke test did not pass.');
  console.log('PASS mobile WebGL browser smoke test');
} finally {
  preview.kill('SIGTERM');
}
