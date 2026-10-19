import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import assert from 'node:assert/strict';
import { FILES, HEADERS, MIME } from './lib/static-files.mjs';

const cases = [];
async function probe(path, { method = 'GET', host = '127.0.0.1:4214' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 4214, path, method, headers: { Host: host }, timeout: 3000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Loopback timeout')));
    req.on('error', reject);
    req.end();
  });
}
function checkHeaders(result) {
  for (const [key, value] of Object.entries(HEADERS)) assert.equal(result.headers[key.toLowerCase()], value);
}
try {
  for (const file of FILES) {
    const expected = await readFile(new URL('../public/' + file, import.meta.url));
    for (const method of ['GET', 'HEAD']) {
      const response = await probe('/' + file, { method });
      assert.equal(response.status, 200);
      checkHeaders(response);
      assert.equal(response.headers['content-type'], MIME[extname(file)]);
      assert.equal(Number(response.headers['content-length']), expected.length);
      assert.deepEqual(response.bytes, method === 'HEAD' ? Buffer.alloc(0) : expected);
      cases.push({ path: '/' + file, method, status: 200, outcome: 'PASS' });
    }
  }
  for (const path of ['/', '/en/', '/missing', '/package.json', '/AGENTS.md', '/js/../app.mjs', '/../package.json', '/%2e%2e/package.json', '/styles/%61pp.css', '/index.html?draft=fake', '/en/index.html?x=1', '//index.html', '/js\\app.mjs', '/styles/app.css/']) {
    const response = await probe(path);
    assert.equal(response.status, 404); checkHeaders(response);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    cases.push({ path, method: 'GET', status: 404, outcome: 'PASS' });
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const response = await probe('/index.html', { method });
    assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD'); checkHeaders(response);
    cases.push({ path: '/index.html', method, status: 405, outcome: 'PASS' });
  }
  for (const host of ['localhost:4214', 'example.invalid', '127.0.0.1:9999', '127.0.0.1']) {
    const response = await probe('/index.html', { host });
    assert.equal(response.status, 421); checkHeaders(response);
    cases.push({ host, status: 421, outcome: 'PASS' });
  }
  console.log(JSON.stringify({ outcome: 'PASS', scope: 'loopback HTTP only; no browser evidence', cases }, null, 2));
} catch (error) { console.error(`FAIL HTTP: ${error.message}`); process.exitCode = 1; }
