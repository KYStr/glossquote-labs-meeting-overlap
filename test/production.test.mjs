import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, unlink, link, cp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, ORIGIN, PAGES, PRODUCTION_FILES, createProductionFiles, productionManifest, validateProduction, verifyM1Assets, verifyProductionBuild, checkWrangler } from '../scripts/lib/production.mjs';
import { inventory, FILES, META_CSP } from '../scripts/lib/static-files.mjs';
import { parseHeaders, applyHeaders, parseRobots, robotsAllowed } from '../scripts/lib/production-rules.mjs';
import { parseRedirects } from '../scripts/lib/production-server.mjs';

test('M2 frozen M1 preview is unchanged, including both HTML bodies and runtime bytes', async () => {
  const source = await inventory(resolve(ROOT, 'public')); await verifyM1Assets(source); assert.equal(source.length, 7);
  const altered = structuredClone(source); altered[0].sha256 = '0'.repeat(64); await assert.rejects(verifyM1Assets(altered), /M1 public bytes/);
  const production = await createProductionFiles();
  for (const file of FILES) {
    const before = await readFile(resolve(ROOT, 'public', file)); const after = production.get(file);
    if (file.endsWith('.html')) {
      const a = before.toString(); const b = after.toString(); assert.equal(b.slice(b.indexOf('<body>')), a.slice(a.indexOf('<body>')));
      assert.match(a, /noindex, nofollow/); assert.doesNotMatch(a, /rel="canonical"|hreflang=|application\/ld\+json/);
    } else assert.deepEqual(after, before);
  }
});
test('M2 exact static-only Wrangler config: domain, date, all logs/traces disabled, no build hook', async () => {
  await checkWrangler(); const config = JSON.parse(await readFile(resolve(ROOT, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.name, 'glossquote-meeting-overlap'); assert.equal(config.compatibility_date, '2026-10-19');
  assert.deepEqual(config.assets, { directory: './dist-production', not_found_handling: '404-page', html_handling: 'none' });
  for (const key of ['main', 'build', 'vars', 'secrets', 'bindings', 'services', 'compatibility_flags']) assert.equal(Object.hasOwn(config, key), false);
});
test('M2 exact deployment set, two canonical URLs and reciprocal language metadata', async () => {
  const files = await createProductionFiles(); assert.deepEqual([...files.keys()].sort(), [...PRODUCTION_FILES]);
  assert.deepEqual(validateProduction(files), { status: 'PASS', pages: 2, inlineHashes: 2, files: 12, visibleFAQ: '5 per language' });
  for (const [i, path] of PAGES.entries()) {
    const html = files.get(path.slice(1)).toString();
    assert.ok(html.includes(`<link rel="canonical" href="https://meet.glossquote.com${path}">`));
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1); assert.equal([...html.matchAll(/hreflang=/g)].length, 3);
    for (const [lang, route] of [['zh-Hant', '/index.html'], ['en', '/en/index.html'], ['x-default', '/index.html']]) assert.ok(html.includes(`hreflang="${lang}" href="https://meet.glossquote.com${route}"`));
    assert.ok(html.includes(`property="og:locale" content="${i === 0 ? 'zh_TW' : 'en_US'}"`));
  }
});
test('M2 JSON-LD is visible WebApplication/FAQ only, with independently verified exact CSP hashes', async () => {
  const files = await createProductionFiles(); const rules = parseHeaders(files.get('_headers').toString());
  for (const [i, path] of PAGES.entries()) {
    const html = files.get(path.slice(1)).toString(); const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)[1];
    const parsed = JSON.parse(json); const [app, faq] = parsed['@graph'];
    assert.equal(parsed['@context'], 'https://schema.org'); assert.equal(app['@type'], 'WebApplication'); assert.equal(app.url, 'https://meet.glossquote.com' + path); assert.equal(app.name, i === 0 ? '會議空檔交集' : 'Meeting overlap');
    assert.equal(faq['@type'], 'FAQPage'); assert.equal(faq.mainEntity.length, 5);
    assert.equal(faq.mainEntity[0].name, i === 0 ? '這個工具會讀我的行事曆或傳送邀請嗎？' : 'Does this tool read calendars or send invitations?');
    for (const item of faq.mainEntity) { assert.ok(html.includes(item.name)); assert.ok(html.includes(item.acceptedAnswer.text)); }
    assert.doesNotMatch(json, /aggregateRating|offers|potentialAction|price|reviewCount/);
    const independent = createHash('sha256').update(Buffer.from(json, 'utf8')).digest('base64');
    const headers = applyHeaders(rules, path);
    assert.equal(headers['content-security-policy'].split('default-src').length, 2); assert.ok(headers['content-security-policy'].includes(`'sha256-${independent}'`));
    assert.ok(html.includes(META_CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${independent}'`)));
    assert.equal(headers['x-robots-tag'], 'index, follow'); assert.doesNotMatch(headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  }
});
test('M2 header removal prevents conflicting robots and duplicate CSP', () => {
  const merged = applyHeaders(parseHeaders('/*\n  X-Robots-Tag: noindex\n/index.html\n  X-Robots-Tag: index\n'), '/index.html'); assert.equal(merged['x-robots-tag'], 'noindex, index');
  const removed = applyHeaders(parseHeaders('/*\n  X-Robots-Tag: noindex\n  Content-Security-Policy: old\n/index.html\n  ! X-Robots-Tag\n  X-Robots-Tag: index\n  ! Content-Security-Policy\n  Content-Security-Policy: new\n'), '/index.html');
  assert.deepEqual(removed, { 'x-robots-tag': 'index', 'content-security-policy': 'new' });
});
test('M2 header rule parser escapes literal dots and rejects malformed directives', () => {
  const rules = parseHeaders('/a.*\n  Test: yes\n'); assert.deepEqual(applyHeaders(rules, '/a.mjs'), { test: 'yes' }); assert.deepEqual(applyHeaders(rules, '/aXmjs'), {});
  for (const source of ['  Header: before-path\n', '/a\n  ! wrong name\n', '/a\n  no-colon\n', 'bad route\n  Header: value\n']) assert.throws(() => parseHeaders(source));
});
test('M2 robots longest-match, tie allow, end anchors, wildcard and case sensitivity', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /\nAllow: /js/\nDisallow: /js/private/\nAllow: /js/private/open.mjs$\nAllow: /same\nDisallow: /same\n');
  for (const [path, result] of [['/index.html', false], ['/js/app.mjs', true], ['/js/private/closed.mjs', false], ['/js/private/open.mjs', true], ['/js/private/open.mjs.extra', false], ['/JS/app.mjs', false], ['/same', true]]) assert.equal(robotsAllowed(rules, path), result, path);
  const wildcard = parseRobots('User-agent: *\nDisallow: /*.tmp$\n'); assert.equal(robotsAllowed(wildcard, '/a.tmp'), false); assert.equal(robotsAllowed(wildcard, '/a.tmp.more'), true);
});
test('M2 actual robots allows every runtime asset and exactly the intended metadata paths', async () => {
  const files = await createProductionFiles(); const rules = parseRobots(files.get('robots.txt').toString());
  for (const path of [...FILES.map(file => '/' + file), '/robots.txt', '/sitemap.xml', '/', '/en', '/en/']) assert.equal(robotsAllowed(rules, path), true, path);
  for (const path of ['/404.html', '/_headers', '/_redirects', '/manifest.json', '/scripts/check.mjs', '/TECHNICAL.md', '/.git/config', '/.runs/private', '/js/app.mjs.extra', '/styles/APP.css', '/index.html?data=fake']) assert.equal(robotsAllowed(rules, path), false, path);
  assert.deepEqual([...files.get('sitemap.xml').toString().matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), ['https://meet.glossquote.com/index.html', 'https://meet.glossquote.com/en/index.html']);
});
test('M2 redirects are only the three fixed canonical 301 paths', async () => {
  const files = await createProductionFiles(); assert.deepEqual(parseRedirects(files.get('_redirects').toString()), { '/': `${ORIGIN}/index.html`, '/en': `${ORIGIN}/en/index.html`, '/en/': `${ORIGIN}/en/index.html` });
  for (const source of ['/ https://untrusted.invalid/ 301', '/ https://meet.glossquote.com/index.html 302', '/ https://meet.glossquote.com/index.html 301\n/ https://meet.glossquote.com/index.html 301']) assert.throws(() => parseRedirects(source));
});
test('M2 404 is bilingual, noindex, has no app runtime or form', async () => {
  const files = await createProductionFiles(); const html = files.get('404.html').toString(); const rules = parseHeaders(files.get('_headers').toString());
  assert.match(html, /找不到頁面/); assert.match(html, /Page not found/); assert.match(html, /noindex, nofollow/); assert.doesNotMatch(html, /<script|<input|<form|rel="canonical"/);
  for (const path of ['/404.html', '/unknown', '/index.html?x=1']) assert.equal(applyHeaders(rules, path)['x-robots-tag'], 'noindex, nofollow');
});
test('M2 production verification rejects stale bytes, manifest, unknown asset and hardlinked manifest', async () => {
  const base = process.env.GQ_MEETING_TEST_ROOT || tmpdir(); await mkdir(base, { recursive: true }); const temporary = await mkdtemp(join(base, 'meeting-production-'));
  const directory = resolve(temporary, 'assets'); const files = await createProductionFiles();
  for (const [path, bytes] of files) { await mkdir(dirname(resolve(directory, path)), { recursive: true }); await writeFile(resolve(directory, path), bytes); }
  const manifestPath = directory + '.manifest.json'; await writeFile(manifestPath, JSON.stringify(productionManifest(files)));
  assert.deepEqual(productionManifest(await verifyProductionBuild(directory)), productionManifest(files));
  await writeFile(resolve(directory, 'index.html'), 'FAKE_STALE'); await assert.rejects(verifyProductionBuild(directory), /Stale production bytes/); await writeFile(resolve(directory, 'index.html'), files.get('index.html'));
  await writeFile(manifestPath, '{}'); await assert.rejects(verifyProductionBuild(directory), /Stale production manifest/); await writeFile(manifestPath, JSON.stringify(productionManifest(files)));
  await writeFile(resolve(directory, 'unknown.txt'), 'FAKE'); await assert.rejects(verifyProductionBuild(directory), /Unknown or linked/); await unlink(resolve(directory, 'unknown.txt'));
  await link(manifestPath, resolve(temporary, 'linked-manifest.json')); await assert.rejects(verifyProductionBuild(directory), /Unsafe manifest/);
});
test('M2 executable production build rejects unknown outputs before overwriting reviewed files', async () => {
  const base = process.env.GQ_MEETING_TEST_ROOT || tmpdir(); await mkdir(base, { recursive: true }); const fixture = await mkdtemp(join(base, 'meeting-production-build-'));
  for (const directory of ['public', 'scripts', 'release']) await cp(resolve(ROOT, directory), resolve(fixture, directory), { recursive: true });
  await cp(resolve(ROOT, 'wrangler.jsonc'), resolve(fixture, 'wrangler.jsonc'));
  function command(expected) { const result = spawnSync(process.execPath, ['scripts/build-production.mjs'], { cwd: fixture, windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, expected, result.stdout + result.stderr); }
  command(0); const before = await readFile(resolve(fixture, 'dist-production/index.html')); await writeFile(resolve(fixture, 'dist-production/unknown.txt'), 'FAKE'); command(1); assert.deepEqual(await readFile(resolve(fixture, 'dist-production/index.html')), before);
});
test('M2 validator rejects removed header detach, changed JSON-LD, and missing assets', async () => {
  const files = await createProductionFiles();
  const changedHeaders = new Map(files); changedHeaders.set('_headers', Buffer.from(files.get('_headers').toString().replace('  ! X-Robots-Tag\n', ''))); assert.throws(() => validateProduction(changedHeaders));
  const changedJSON = new Map(files); changedJSON.set('en/index.html', Buffer.from(files.get('en/index.html').toString().replace('"@type":"WebApplication"', '"@type":"Other"'))); assert.throws(() => validateProduction(changedJSON));
  const missing = new Map(files); missing.delete('js/copy.mjs'); assert.throws(() => validateProduction(missing));
});
