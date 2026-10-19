import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets } from './lib/check-assets.mjs';
import { FILES, MIME, HEADERS } from './lib/static-files.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
await checkAssets(root);
const assets = new Map(await Promise.all(FILES.map(async file => ['/' + file, await readFile(resolve(root, file))])));
const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
  const headers = { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' };
  let status = 200;
  let body;
  if (request.headers.host !== '127.0.0.1:4214') { status = 421; body = Buffer.from('Misdirected request\n'); }
  else if (!['GET', 'HEAD'].includes(request.method)) { status = 405; headers.Allow = 'GET, HEAD'; body = Buffer.from('Method not allowed\n'); }
  else if (!assets.has(request.url)) { status = 404; body = Buffer.from('Not found\n'); }
  else { body = assets.get(request.url); headers['Content-Type'] = MIME[extname(request.url)]; }
  headers['Content-Length'] = body.length;
  response.writeHead(status, headers);
  response.end(request.method === 'HEAD' ? undefined : body);
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 1000;
server.maxRequestsPerSocket = 100;
server.on('error', () => { console.error('Preview could not bind 127.0.0.1:4214; existing processes preserved.'); process.exitCode = 1; });
server.listen(4214, '127.0.0.1', () => console.log(`Preview PID ${process.pid} listening on http://127.0.0.1:4214/index.html`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
