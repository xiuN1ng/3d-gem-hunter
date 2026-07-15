import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const candidates = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser'
].filter(Boolean);

const chromeExecutable = candidates.find((candidate) => {
  const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
});

if (!chromeExecutable) {
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

const profileDirectory = await mkdtemp(join(tmpdir(), 'gem-hunter-chrome-'));
let chrome;

async function waitFor(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    socket,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

async function stopProcess(process) {
  if (!process || process.exitCode !== null) return;
  await new Promise((resolve) => {
    process.once('exit', resolve);
    process.kill('SIGTERM');
    setTimeout(resolve, 2000);
  });
}

try {
  await waitFor(async () => {
    try {
      return (await fetch('http://127.0.0.1:4173/3d-gem-hunter/')).ok;
    } catch {
      return false;
    }
  }, 10000, 'Vite preview did not become ready within 10 seconds.');

  const targetUrl = 'http://127.0.0.1:4173/3d-gem-hunter/?perf-test=1&perf-tier=ci';
  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
    '--window-size=390,844',
    `--user-data-dir=${profileDirectory}`,
    targetUrl
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let chromeErrors = '';
  chrome.stderr.on('data', (chunk) => { chromeErrors += chunk.toString(); });
  const target = await waitFor(async () => {
    try {
      const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
      return targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('perf-test=1'));
    } catch {
      return null;
    }
  }, 10000, 'Chrome DevTools endpoint did not expose the performance page.');

  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  const result = await waitFor(async () => {
    try {
      const response = await cdp.send('Runtime.evaluate', {
        expression: `({
          state: document.documentElement.dataset.perfTest || null,
          result: document.querySelector('#perf-result')?.textContent || null,
          title: document.title
        })`,
        returnByValue: true
      });
      const value = response.result?.value;
      return value?.state ? value : null;
    } catch {
      return null;
    }
  }, 30000, 'Mobile WebGL performance page did not finish within 30 seconds.');

  cdp.socket.close();
  if (result.result) console.log(result.result);
  if (result.state !== 'pass') {
    console.error(chromeErrors);
    throw new Error(`Mobile WebGL performance smoke test failed with state: ${result.state}`);
  }
  console.log('PASS mobile WebGL browser smoke test');
} finally {
  await stopProcess(chrome);
  await stopProcess(preview);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
