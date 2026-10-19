import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkAssets } from './check-assets.mjs';
import { FILES, CSP, META_CSP, inventory } from './static-files.mjs';
import { parseHeaders, applyHeaders, parseRobots, robotsAllowed } from './production-rules.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ORIGIN = 'https://meet.glossquote.com';
export const PAGES = ['/index.html', '/en/index.html'];
export const PRODUCTION_FILES = Object.freeze([...FILES, '404.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects'].sort());
export const REDIRECTS = Object.freeze({ '/': `${ORIGIN}/index.html`, '/en': `${ORIGIN}/en/index.html`, '/en/': `${ORIGIN}/en/index.html` });
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const inlineHash = body => createHash('sha256').update(body).digest('base64');
export const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const sorted = files => [...files].sort(([a], [b]) => a.localeCompare(b, 'en'));
export function productionManifest(files) {
  return { schemaVersion: 1, mode: 'production', origin: ORIGIN, files: sorted(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })) };
}
export async function verifyM1Assets(rows) {
  const baseline = JSON.parse(await readFile(resolve(ROOT, 'release/m1-public-hashes.json'), 'utf8'));
  assert.deepEqual(rows, baseline, 'M1 public bytes must remain unchanged');
}
export async function checkWrangler() {
  const config = JSON.parse(await readFile(resolve(ROOT, 'wrangler.jsonc'), 'utf8'));
  assert.deepEqual(config, {
    name: 'glossquote-meeting-overlap', compatibility_date: '2026-10-19',
    assets: { directory: './dist-production', not_found_handling: '404-page', html_handling: 'none' },
    routes: [{ pattern: 'meet.glossquote.com', custom_domain: true }],
    workers_dev: false, preview_urls: false, send_metrics: false,
    observability: { enabled: false, logs: { enabled: false }, traces: { enabled: false } },
  }, 'Static-assets-only Wrangler configuration must be exact');
}
function visibleFAQ(html) {
  const result = [...html.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)].map(match => ({ '@type': 'Question', name: match[1], acceptedAnswer: { '@type': 'Answer', text: match[2] } }));
  assert.equal(result.length, 5, 'Exactly the five visible questions');
  return result;
}
function metadata(source, path, language) {
  const title = /<title>([^<]+)<\/title>/.exec(source)[1];
  const description = /<meta name="description" content="([^"]+)">/.exec(source)[1];
  const data = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: language === 'en' ? 'Meeting overlap' : '會議空檔交集', description, url: ORIGIN + path, inLanguage: language, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript' },
    { '@type': 'FAQPage', inLanguage: language, mainEntity: visibleFAQ(source) },
  ] };
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const hash = inlineHash(json);
  const additions = `  <link rel="canonical" href="${ORIGIN}${path}">\n`
    + [['zh-Hant', '/index.html'], ['en', '/en/index.html'], ['x-default', '/index.html']].map(([lang, route]) => `  <link rel="alternate" hreflang="${lang}" href="${ORIGIN}${route}">\n`).join('')
    + `  <meta property="og:type" content="website">\n  <meta property="og:title" content="${title}">\n  <meta property="og:description" content="${description}">\n  <meta property="og:url" content="${ORIGIN}${path}">\n  <meta property="og:locale" content="${language === 'en' ? 'en_US' : 'zh_TW'}">\n`
    + `  <script type="application/ld+json">${json}</script>\n`;
  const html = source.replace('name="robots" content="noindex, nofollow"', 'name="robots" content="index, follow"')
    .replace(META_CSP, META_CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`))
    .replace('</head>', additions + '</head>');
  assert.equal(html.slice(html.indexOf('<body>')), source.slice(source.indexOf('<body>')), 'Task canvas must remain byte-identical');
  return { html, hash };
}
function notFoundHTML() {
  return `<!doctype html>\n<html lang="zh-Hant">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="robots" content="noindex, nofollow">\n  <meta name="referrer" content="no-referrer">\n  <meta http-equiv="Content-Security-Policy" content="${META_CSP}">\n  <title>找不到頁面 | Page not found | Gloss Tools</title>\n  <link rel="stylesheet" href="/styles/app.css">\n</head>\n<body>\n  <main>\n    <h1>找不到頁面</h1>\n    <p lang="en">Page not found.</p>\n    <p><a href="/index.html">開啟會議空檔交集</a></p>\n    <p lang="en"><a href="/en/index.html">Open Meeting overlap</a></p>\n  </main>\n</body>\n</html>\n`;
}
export async function createProductionFiles() {
  const rows = await checkAssets(resolve(ROOT, 'public'));
  await verifyM1Assets(rows); await checkWrangler();
  const files = new Map(await Promise.all(FILES.map(async path => [path, await readFile(resolve(ROOT, 'public', path))])));
  const hashes = new Map();
  for (const [i, path] of PAGES.entries()) {
    const rendered = metadata(files.get(path.slice(1)).toString('utf8'), path, i === 0 ? 'zh-Hant' : 'en');
    files.set(path.slice(1), Buffer.from(rendered.html)); hashes.set(path, rendered.hash);
  }
  files.set('404.html', Buffer.from(notFoundHTML()));
  let headers = `/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: ${PERMISSIONS}\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`;
  for (const path of PAGES) headers += `\n${path}\n  ! X-Robots-Tag\n  X-Robots-Tag: index, follow\n  ! Content-Security-Policy\n  Content-Security-Policy: ${CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hashes.get(path)}'`)}\n`;
  files.set('_headers', Buffer.from(headers));
  files.set('_redirects', Buffer.from(Object.entries(REDIRECTS).map(([from, to]) => `${from} ${to} 301`).join('\n') + '\n'));
  const paths = [...Object.keys(REDIRECTS), ...FILES.map(file => '/' + file), '/robots.txt', '/sitemap.xml'];
  files.set('robots.txt', Buffer.from('User-agent: *\nDisallow: /\n' + paths.map(path => `Allow: ${path}$`).join('\n') + `\nSitemap: ${ORIGIN}/sitemap.xml\n`));
  files.set('sitemap.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(path => `  <url><loc>${ORIGIN}${path}</loc></url>`).join('\n')}\n</urlset>\n`));
  return new Map(sorted(files));
}
export function validateProduction(files) {
  assert.deepEqual([...files.keys()].sort(), PRODUCTION_FILES);
  const headers = parseHeaders(files.get('_headers').toString()); const robots = parseRobots(files.get('robots.txt').toString());
  for (const [i, path] of PAGES.entries()) {
    const html = files.get(path.slice(1)).toString(); const effective = applyHeaders(headers, path);
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1); assert.ok(html.includes(`rel="canonical" href="${ORIGIN}${path}"`));
    assert.equal([...html.matchAll(/hreflang=/g)].length, 3);
    for (const [lang, route] of [['zh-Hant', '/index.html'], ['en', '/en/index.html'], ['x-default', '/index.html']]) assert.ok(html.includes(`hreflang="${lang}" href="${ORIGIN}${route}"`));
    assert.ok(html.includes('name="robots" content="index, follow"')); assert.equal(effective['x-robots-tag'], 'index, follow');
    const bodies = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => match[1]); assert.equal(bodies.length, 1);
    const data = JSON.parse(bodies[0]); assert.equal(data['@graph'].length, 2);
    const [app, faq] = data['@graph']; assert.equal(app['@type'], 'WebApplication'); assert.equal(app.url, ORIGIN + path); assert.equal(app.inLanguage, i ? 'en' : 'zh-Hant');
    assert.equal(faq['@type'], 'FAQPage'); assert.deepEqual(faq.mainEntity, visibleFAQ(html));
    const hash = `'sha256-${inlineHash(bodies[0])}'`;
    assert.equal(effective['content-security-policy'], CSP.replace("script-src 'self'", `script-src 'self' ${hash}`));
    assert.ok(effective['content-security-policy'].includes(hash)); assert.equal([...effective['content-security-policy'].matchAll(/sha256-/g)].length, 1);
    assert.ok(html.includes(META_CSP.replace("script-src 'self'", `script-src 'self' ${hash}`)));
    assert.doesNotMatch(html + effective['content-security-policy'], /unsafe-inline|unsafe-eval/);
    for (const match of html.matchAll(/(?:src|href)="(\/(?:styles|js)\/[^"?#]+)"/g)) { assert.ok(files.has(match[1].slice(1))); assert.equal(robotsAllowed(robots, match[1]), true); }
  }
  for (const path of FILES.map(file => '/' + file)) assert.equal(robotsAllowed(robots, path), true);
  for (const path of ['/404.html', '/_headers', '/_redirects', '/package.json', '/scripts/check.mjs', '/.git/config', '/.runs/fake', '/JS/app.mjs', '/js/app.mjs.extra']) assert.equal(robotsAllowed(robots, path), false);
  assert.deepEqual([...files.get('sitemap.xml').toString().matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), PAGES.map(path => ORIGIN + path));
  assert.equal(applyHeaders(headers, '/404.html')['x-robots-tag'], 'noindex, nofollow');
  assert.match(files.get('404.html').toString(), /noindex, nofollow/); assert.doesNotMatch(files.get('404.html').toString(), /id="workspace|<script|<input/);
  assert.ok([...files.values()].every(bytes => !bytes.toString().startsWith('\uFEFF')));
  return { status: 'PASS', pages: 2, inlineHashes: 2, files: files.size, visibleFAQ: '5 per language' };
}
export async function verifyProductionBuild(directory = resolve(ROOT, 'dist-production')) {
  const expected = await createProductionFiles(); validateProduction(expected);
  await inventory(directory, { allowed: PRODUCTION_FILES });
  const manifestPath = `${directory}.manifest.json`; const info = await lstat(manifestPath);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Unsafe manifest');
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), productionManifest(expected), 'Stale production manifest');
  const actual = new Map(await Promise.all(PRODUCTION_FILES.map(async path => [path, await readFile(resolve(directory, path))])));
  assert.deepEqual(productionManifest(actual), productionManifest(expected), 'Stale production bytes');
  return actual;
}
