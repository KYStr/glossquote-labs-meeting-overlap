import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, unlink, rename, link, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { inspectHTML, inspectCSS, inspectModule, checkAssets } from '../scripts/lib/check-assets.mjs';
import { FILES, META_CSP, inventory } from '../scripts/lib/static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const zh = await readFile(resolve(root, 'public/index.html'), 'utf8');
const en = await readFile(resolve(root, 'public/en/index.html'), 'utf8');
const css = await readFile(resolve(root, 'public/styles/app.css'), 'utf8');

for (const [locale, source, title, heading, link] of [
  ['zh-Hant', zh, '會議空檔交集｜找出全員可用的會議時段', '找出所有人都能參加的會議時段', '/en/index.html'],
  ['en', en, 'Meeting overlap | Find a time everyone can attend', 'Find a meeting time everyone can attend', '/index.html'],
]) test(`preview ${locale}: route, metadata, no-submit controls, local assets and FAQ`, () => {
  const elements = inspectHTML(source, locale);
  assert.ok(source.includes(`<title>${title}</title>`)); assert.ok(source.includes(`<h1>${heading}</h1>`));
  assert.equal(elements.filter(e => e.tag === 'details').length, 5);
  assert.equal(elements.filter(e => e.tag === 'script').length, 1);
  assert.equal(elements.find(e => e.attrs.id === 'language-link').attrs.href, link);
  assert.equal(elements.find(e => e.attrs.id === 'report').attrs.readonly, '');
  assert.equal(elements.find(e => e.attrs.id === 'duration').attrs.value, '60');
  for (const id of ['date', 'time-basis']) assert.equal(elements.find(e => e.attrs.id === id).attrs.value, undefined);
  for (const element of elements.filter(e => e.tag === 'input')) { assert.equal(element.attrs.type, 'text'); assert.equal(element.attrs.maxlength, '256'); }
  assert.ok(source.includes(locale === 'en' ? 'https://glossquote.com/en/index.html' : 'https://glossquote.com/index.html'));
});
for (const [name, mutate] of [
  ['unclosed document', s => s.replace('</main>', '')],
  ['unclosed attribute', s => s.replace('id="date"', 'id="date')],
  ['inline style', s => s.replace('<body>', '<body style="color:red">')],
  ['inline handler', s => s.replace('<body>', '<body onload="fake()">')],
  ['form transport', s => s.replace('<main id="workspace">', '<form id="workspace">').replace('</main>', '</form>')],
  ['field name serialization', s => s.replace('id="date"', 'id="date" name="date"')],
  ['submit button', s => s.replace('type="button"', 'type="submit"')],
  ['enabled pre-init controls', s => s.replace('id="workspace-controls" disabled', 'id="workspace-controls"')],
  ['unsafe CSP', s => s.replace(META_CSP, META_CSP + "; script-src 'unsafe-inline'")],
  ['indexable preview', s => s.replace('noindex, nofollow', 'index, follow')],
  ['external module', s => s.replace('/js/app.mjs', 'https://example.invalid/app.mjs')],
  ['external stylesheet', s => s.replace('/styles/app.css', 'https://example.invalid/app.css')],
  ['inline script', s => s.replace('</script>', 'fake()</script>')],
  ['query language link', s => s.replace('/en/index.html', '/en/index.html?draft=fake')],
  ['duplicate id', s => s.replace('id="time-basis"', 'id="date"')],
]) test(`HTML rejection: ${name}`, () => assert.throws(() => inspectHTML(mutate(zh), 'zh-Hant')));
for (const [name, source] of [['unbalanced', css + '\n.bad {'], ['unclosed string', css + '\n.bad { content: "oops; }'], ['unclosed comment', css + '\n/* fake'], ['external import', css + '\n@import "remote";'], ['font url', css + '\n.bad { background: url(remote); }']]) test(`CSS rejection: ${name}`, () => assert.throws(() => inspectCSS(source)));
for (const source of [
  'element.innerHTML = input;', 'element.outerHTML = input;', 'element.insertAdjacentHTML("afterbegin", input);',
  'eval(input);', 'new Function(input);', 'fetch(input);', 'new XMLHttpRequest();', 'new WebSocket(input);', 'new EventSource(input);',
  'navigator.sendBeacon(input);', 'localStorage.setItem("fake", input);', 'sessionStorage.setItem("fake", input);', 'indexedDB.open("fake");',
  'caches.open("fake");', 'document.cookie = input;', 'navigator.serviceWorker.register("fake");', 'navigator.clipboard.writeText(input);',
  'console.log(input);', 'location.hash = input;', 'location.search = input;', 'history.pushState(input, "");', 'window.confirm(input);',
  'alert(input);', 'print();', 'URL.createObjectURL(input);', 'showSaveFilePicker();', 'new Worker("fake");',
  'Date.now();', 'new Date();', 'Intl.DateTimeFormat();', 'Math.random();', 'setTimeout(action, 1);',
  'import("./state.mjs");', 'import { x } from "https://example.invalid/module.mjs";', 'import { x } from "../../outside.mjs";', 'import "../../outside.mjs";',
]) test(`module rejection: ${source}`, () => assert.throws(() => inspectModule(source, 'js/app.mjs')));
test('safe report label Date does not trigger an API false positive', () => inspectModule("const line = 'Date: 2028-02-29';", 'js/app.mjs'));
test('closed source inventory contains exactly the seven preview assets', async () => {
  const files = await checkAssets(resolve(root, 'public'));
  assert.deepEqual(files.map(f => f.path).sort(), [...FILES].sort());
  assert.ok(files.every(f => f.bytes > 0 && /^[a-f0-9]{64}$/.test(f.sha256)));
});
test('offline checker/build failure injection in a disposable copy', async () => {
  // The calling task supplies its own evidence root; standalone use defaults to OS temp.
  const evidenceRoot = process.env.GQ_MEETING_TEST_ROOT || tmpdir();
  await mkdir(evidenceRoot, { recursive: true });
  const fixture = await mkdtemp(join(evidenceRoot, 'meeting-security-'));
  await cp(resolve(root, 'public'), resolve(fixture, 'public'), { recursive: true });
  await cp(resolve(root, 'scripts'), resolve(fixture, 'scripts'), { recursive: true });
  await cp(resolve(root, 'package.json'), resolve(fixture, 'package.json'));
  const outcomes = [];
  function command(script, expected, label) {
    const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], { cwd: fixture, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, expected, label + ': ' + result.stdout + result.stderr);
    outcomes.push({ label, command: `node scripts/${script}.mjs`, exit: result.status });
    return result;
  }
  command('check', 0, 'valid copy'); command('build', 0, 'valid preview build');
  for (const [label, file, transform] of [
    ['HTML syntax', 'index.html', s => s.replace('</main>', '')],
    ['CSS syntax', 'styles/app.css', s => s + '\n.bad {'],
    ['JS syntax', 'js/app.mjs', s => s + '\nconst = ;'],
    ['dangerous DOM', 'js/app.mjs', s => s + '\nnode.innerHTML = value;'],
    ['storage', 'js/app.mjs', s => s + '\nlocalStorage.setItem("fake", value);'],
    ['network', 'js/app.mjs', s => s + '\nfetch(value);'],
    ['remote resource', 'index.html', s => s.replace('/styles/app.css', 'https://example.invalid/style.css')],
  ]) {
    const path = resolve(fixture, 'public', file); const original = await readFile(path);
    await writeFile(path, transform(original.toString()));
    command('check', 1, label); command('build', 1, label + ' build rejects');
    await writeFile(path, original);
  }
  const extra = resolve(fixture, 'public/unknown.txt'); await writeFile(extra, 'FAKE');
  command('check', 1, 'unknown source file'); await unlink(extra);
  const missing = resolve(fixture, 'public/js/copy.mjs'); const original = await readFile(missing); await unlink(missing);
  command('check', 1, 'missing required file'); await writeFile(missing, original);
  await writeFile(resolve(fixture, 'dist/stale.txt'), 'FAKE_STALE');
  const before = await readFile(resolve(fixture, 'dist/index.html'));
  command('build', 1, 'stale output rejects before copying');
  assert.deepEqual(await readFile(resolve(fixture, 'dist/index.html')), before);
  await unlink(resolve(fixture, 'dist/stale.txt'));
  const shared = resolve(fixture, 'shared-copy.mjs'); await rename(missing, shared); await link(shared, missing);
  command('check', 1, 'hardlinked asset'); await unlink(missing); await rename(shared, missing);
  const externalStyles = resolve(fixture, 'outside-styles'); const publicStyles = resolve(fixture, 'public/styles');
  await rename(publicStyles, externalStyles); await symlink(externalStyles, publicStyles, 'junction');
  command('check', 1, 'junction asset directory'); await unlink(publicStyles); await rename(externalStyles, publicStyles);
  assert.deepEqual((await inventory(resolve(fixture, 'public'))).map(f => f.path).sort(), [...FILES].sort());
  await writeFile(resolve(fixture, 'outcomes.json'), JSON.stringify(outcomes, null, 2) + '\n');
});
