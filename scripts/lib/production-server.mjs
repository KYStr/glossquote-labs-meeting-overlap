import { createServer } from 'node:http';
import { extname } from 'node:path';
import assert from 'node:assert/strict';
import { applyHeaders, parseHeaders } from './production-rules.mjs';
import { REDIRECTS } from './production.mjs';
import { MIME } from './static-files.mjs';

export const PRODUCTION_MIME = { ...MIME, '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
export function parseRedirects(text) {
  const actual = {};
  for (const line of text.trim().split('\n')) {
    const parts = line.split(' ');
    assert.ok(parts.length === 3 && parts[2] === '301' && Object.hasOwn(REDIRECTS, parts[0]) && !Object.hasOwn(actual, parts[0]), 'Invalid redirect');
    actual[parts[0]] = parts[1];
  }
  assert.deepEqual(actual, REDIRECTS, 'Redirects are canonical-only');
  return actual;
}
export function createProductionServer(files) {
  const rules = parseHeaders(files.get('_headers').toString()); const redirects = parseRedirects(files.get('_redirects').toString());
  const hidden = new Set(['_headers', '_redirects']);
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    function send(status, body, type, extra = {}, rulePath = '/404.html') {
      response.writeHead(status, { ...applyHeaders(rules, rulePath), 'Content-Type': type, 'Content-Length': body.length, ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    }
    if (request.headers.host !== '127.0.0.1:5214') { send(421, Buffer.from('Misdirected request\n'), PRODUCTION_MIME['.txt']); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { send(405, Buffer.from('Method not allowed\n'), PRODUCTION_MIME['.txt'], { Allow: 'GET, HEAD' }); request.resume(); return; }
    const path = request.url;
    if (Object.hasOwn(redirects, path)) {
      // Cloudflare resolves _redirects before _headers. Do not invent applied
      // asset headers for redirect responses; hosting verifies actual CDN headers.
      const body = Buffer.from('Canonical page\n');
      response.writeHead(301, { Location: redirects[path], 'Content-Type': PRODUCTION_MIME['.txt'], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body); return;
    }
    const file = path.startsWith('/') ? path.slice(1) : '';
    if (!files.has(file) || hidden.has(file)) { send(404, files.get('404.html'), PRODUCTION_MIME['.html']); return; }
    send(file === '404.html' ? 404 : 200, files.get(file), PRODUCTION_MIME[extname(file)], {}, path);
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxRequestsPerSocket = 100;
  return server;
}
