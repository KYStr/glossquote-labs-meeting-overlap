import { readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FILES, META_CSP, inventory } from './static-files.mjs';

const voidTags = new Set(['meta', 'link', 'input', 'br', 'hr']);
const forbidden = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval|Function|fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|serviceWorker|caches|cookie|clipboard|createObjectURL|showOpenFilePicker|showSaveFilePicker|Worker)\b|\bconsole\s*[.\[]|\b(?:window\s*\.\s*)?(?:alert|confirm|prompt|print)\s*\(|\blocation\s*\.\s*(?:search|hash)|\bhistory\s*\./;

function fail(message) { throw new Error(message); }

// Small closed-subset parser for the authored pages, not a general HTML sanitizer.
export function inspectHTML(source, locale) {
  if (!/^<!doctype html>/i.test(source) || !source.endsWith('\n')) fail('HTML document boundary');
  const stack = [];
  const elements = [];
  const ids = new Set();
  const tokens = source.match(/<!--[\s\S]*?-->|<!doctype[^>]*>|<[^>]*>|[^<]+/gi) ?? [];
  if (tokens.join('') !== source) fail('Unclosed HTML token');
  for (const token of tokens) {
    if (!token.startsWith('<') || token.startsWith('<!')) continue;
    const close = /^<\/([a-z][a-z0-9-]*)\s*>$/i.exec(token);
    if (close) {
      if (stack.pop() !== close[1].toLowerCase()) fail('Unbalanced HTML');
      continue;
    }
    const open = /^<([a-z][a-z0-9-]*)([\s\S]*?)>$/i.exec(token);
    if (!open) fail('Invalid HTML tag');
    const tag = open[1].toLowerCase();
    const attrs = {};
    let tail = open[2];
    while (tail.trim()) {
      const match = /^\s+([a-z][a-z0-9:-]*)(?:="([^"<>]*)")?/i.exec(tail);
      if (!match || Object.hasOwn(attrs, match[1].toLowerCase())) fail('Invalid HTML attribute');
      attrs[match[1].toLowerCase()] = match[2] ?? '';
      tail = tail.slice(match[0].length);
    }
    if (['form', 'iframe', 'object', 'embed', 'base', 'style', 'img', 'svg'].includes(tag)) fail('Disallowed HTML element');
    if (Object.keys(attrs).some(key => /^on/i.test(key) || ['style', 'srcdoc', 'action', 'method', 'ping', 'download'].includes(key))) fail('Active HTML attribute');
    if (attrs.id) { if (ids.has(attrs.id)) fail('Duplicate HTML id'); ids.add(attrs.id); }
    if (['input', 'textarea', 'select', 'button'].includes(tag) && Object.hasOwn(attrs, 'name')) fail('Serializable control');
    if (tag === 'button' && attrs.type !== 'button') fail('Submit-capable button');
    if (tag === 'input' && (attrs.type !== 'text' || !Object.hasOwn(attrs, 'autocomplete'))) fail('Input contract');
    if (tag === 'script' && (attrs.type !== 'module' || attrs.src !== '/js/app.mjs')) fail('Script contract');
    if (tag === 'link' && (attrs.rel !== 'stylesheet' || attrs.href !== '/styles/app.css')) fail('Resource contract');
    if (attrs.href && !['/index.html', '/en/index.html', '#workspace', 'https://glossquote.com/index.html', 'https://glossquote.com/en/index.html'].includes(attrs.href) && tag !== 'link') fail('Unknown link');
    if (attrs.src && tag !== 'script') fail('Unknown source');
    if (tag === 'script' && source.slice(source.indexOf(token) + token.length).split('</script>')[0].trim()) fail('Inline script');
    elements.push({ tag, attrs });
    if (!voidTags.has(tag)) stack.push(tag);
  }
  if (stack.length) fail('Unclosed HTML');
  const find = (tag, prop, value) => elements.find(e => e.tag === tag && e.attrs[prop] === value);
  if (!find('html', 'lang', locale)) fail('Page language');
  const metaCSP = find('meta', 'http-equiv', 'Content-Security-Policy');
  if (metaCSP?.attrs.content !== META_CSP) fail('CSP contract');
  if (find('meta', 'name', 'robots')?.attrs.content !== 'noindex, nofollow') fail('Preview noindex');
  if (!find('meta', 'name', 'description')?.attrs.content || !find('title', 'missing', undefined)) fail('Missing metadata');
  if (!find('fieldset', 'id', 'workspace-controls') || !Object.hasOwn(find('fieldset', 'id', 'workspace-controls').attrs, 'disabled')) fail('Controls not initially disabled');
  if (!find('script', 'src', '/js/app.mjs') || !find('link', 'href', '/styles/app.css')) fail('Missing entry assets');
  for (const id of ['date', 'time-basis', 'duration', 'participants', 'calculate', 'clear', 'language-link', 'confirmation', 'result', 'status', 'report', 'report-toggle']) if (!ids.has(id)) fail('Missing UI anchor');
  if (!find('noscript', 'missing', undefined) || source.includes('canonical') || source.includes('hreflang')) fail('Preview metadata contract');
  return elements;
}

export function inspectCSS(source) {
  if (/@import|url\s*\(|expression\s*\(/i.test(source)) fail('External or active CSS');
  let quote = null;
  let comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (comment) { if (c === '*' && source[i + 1] === '/') { comment = false; i++; } continue; }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      else if (c === '\n' || c === '\r') fail('Unclosed CSS string');
      continue;
    }
    if (c === '/' && source[i + 1] === '*') { comment = true; i++; }
    else if (c === '"' || c === "'") quote = c;
  }
  if (quote || comment) fail('Unclosed CSS token');
  let clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  const stack = [];
  for (const c of clean) {
    if ('{(['.includes(c)) stack.push(c);
    if ('})]'.includes(c) && stack.pop() !== { '}': '{', ')': '(', ']': '[' }[c]) fail('Unbalanced CSS');
  }
  if (stack.length || /\/\*|\*\//.test(clean) || !source.includes(':focus-visible') || !source.includes('prefers-reduced-motion')) fail('CSS structure or accessibility contract');
}

export function inspectModule(source, file) {
  if (forbidden.test(source)) fail(`Forbidden browser API in ${file}`);
  if (/\bimport\s*\(|\b(?:setTimeout|setInterval)\s*\(|\bDate\s*(?:\(|\.|\[)|\bIntl\b|\bMath\s*\.\s*random|https?:\/\//.test(source)) fail(`Unexpected runtime capability in ${file}`);
  const imports = [
    ...source.matchAll(/\b(?:import|export)\s+[^;'"`]+?\s+from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
  ];
  for (const match of imports) {
    const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
    if (!match[1].startsWith('./') && !match[1].startsWith('../') || !FILES.includes(target)) fail('Module graph not closed');
  }
}

export async function checkAssets(root) {
  const list = await inventory(root);
  for (const file of FILES) {
    const source = await readFile(resolve(root, file), 'utf8');
    if (source.startsWith('\uFEFF') || source.includes('\r')) fail('Asset encoding');
    if (file.endsWith('.html')) inspectHTML(source, file.startsWith('en/') ? 'en' : 'zh-Hant');
    if (file.endsWith('.css')) inspectCSS(source);
    if (file.endsWith('.mjs')) {
      inspectModule(source, file);
      const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) fail(`Module syntax: ${file}`);
    }
  }
  return list;
}

export async function checkToolScripts(root) {
  const { readdir } = await import('node:fs/promises');
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      if (entry.isFile() && entry.name.endsWith('.mjs')) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) fail(`Tool syntax: ${file}`);
      }
    }
  }
  await walk(resolve(root, 'scripts'));
  try { await walk(resolve(root, 'test')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.private !== true || pkg.type !== 'module' || pkg.engines?.node !== '>=24' || ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => Object.keys(pkg[key] ?? {}).length)) fail('Package contract');
}
