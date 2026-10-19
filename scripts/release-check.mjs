import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { extname } from 'node:path';
import { verifyProductionBuild, PAGES, REDIRECTS, PERMISSIONS, sha256, inlineHash } from './lib/production.mjs';
import { createProductionServer, PRODUCTION_MIME } from './lib/production-server.mjs';

const records = [];
function local(path, method = 'GET', host = '127.0.0.1:5214') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 5214, path, method, headers: { Host: host }, timeout: 3000 }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Loopback timeout'))); req.end();
  });
}
function security(response, canonical = false) {
  assert.equal(response.headers['x-robots-tag'], canonical ? 'index, follow' : 'noindex, nofollow');
  assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-frame-options'], 'DENY'); assert.equal(response.headers['permissions-policy'], PERMISSIONS); assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.headers['content-security-policy'].includes("connect-src 'none'") && response.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
}
let server;
let listening = false;
try {
  const files = await verifyProductionBuild(); server = createProductionServer(files);
  server.listen(5214, '127.0.0.1'); await once(server, 'listening'); listening = true;
  assert.equal(server.address().address, '127.0.0.1'); assert.equal(server.address().port, 5214);
  for (const [file, bytes] of files) {
    if (file.startsWith('_')) continue;
    const path = '/' + file;
    for (const method of ['GET', 'HEAD']) {
      const response = await local(path, method); assert.equal(response.status, file === '404.html' ? 404 : 200);
      assert.equal(response.headers['content-type'], PRODUCTION_MIME[extname(file)]); assert.equal(Number(response.headers['content-length']), bytes.length);
      assert.deepEqual(response.bytes, method === 'HEAD' ? Buffer.alloc(0) : bytes); security(response, PAGES.includes(path));
      if (PAGES.includes(path)) {
        const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(bytes.toString())[1];
        assert.ok(response.headers['content-security-policy'].includes(`'sha256-${inlineHash(json)}'`));
      }
      records.push({ path, method, status: response.status, bytes: bytes.length, sha256: sha256(bytes), outcome: 'PASS' });
    }
  }
  for (const [path, to] of Object.entries(REDIRECTS)) for (const method of ['GET', 'HEAD']) {
    const response = await local(path, method); assert.equal(response.status, 301); assert.equal(response.headers.location, to);
    assert.equal(response.headers['content-security-policy'], undefined, '_redirects precedes _headers');
    if (method === 'HEAD') assert.equal(response.bytes.length, 0);
    records.push({ path, method, status: 301, location: to, outcome: 'PASS' });
  }
  for (const path of ['/missing', '/en/missing', '/_headers', '/_redirects', '/manifest.json', '/dist-production.manifest.json', '/package.json', '/scripts/build.mjs', '/.git/config', '/../package.json', '/%2e%2e/package.json', '/index.html?fake=1', '/INDEX.HTML', '//index.html', '/styles/%61pp.css']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await local(path, method); assert.equal(response.status, 404); security(response);
      assert.deepEqual(response.bytes, method === 'HEAD' ? Buffer.alloc(0) : files.get('404.html'));
      records.push({ path, method, status: 404, outcome: 'PASS' });
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await local('/index.html', method); assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD'); security(response);
    records.push({ path: '/index.html', method, status: 405, outcome: 'PASS' });
  }
  for (const host of ['localhost:5214', 'untrusted.invalid', '127.0.0.1:4214']) { const response = await local('/index.html', 'GET', host); assert.equal(response.status, 421); security(response); records.push({ host, status: 421, outcome: 'PASS' }); }
  console.log(JSON.stringify({ status: 'PASS', scope: 'Offline 127.0.0.1:5214 production HTTP model; not Cloudflare/live evidence. Exact-path model intentionally rejects query routes; CDN query/default headers require M3.', count: records.length, records }, null, 2));
} catch (error) { console.error(`FAIL release check: ${error.message}`); process.exitCode = 1; }
finally { if (server && listening) await new Promise(resolve => server.close(resolve)); }
