import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'exit');
let ready = false;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview start timeout')), 10000);
    server.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      if (chunk.toString().includes('listening on http://127.0.0.1:4214/index.html')) { ready = true; clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); if (!ready) reject(new Error('Preview exited before ready; existing processes preserved')); });
  });
  const check = spawn(process.execPath, ['scripts/http-check.mjs'], { cwd, windowsHide: true, stdio: 'inherit' });
  const [exit] = await once(check, 'exit');
  if (exit !== 0) throw new Error('Loopback HTTP verification failed');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (server.exitCode === null && server.signalCode === null) server.kill();
  await closed;
  console.log(`Task-owned preview PID ${server.pid} stopped.`);
}
