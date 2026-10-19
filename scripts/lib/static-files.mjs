import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const FILES = Object.freeze([
  'index.html', 'en/index.html', 'styles/app.css', 'js/app.mjs',
  'js/core/meeting-overlap.mjs', 'js/state.mjs', 'js/copy.mjs',
]);
export const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' });
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";
export const META_CSP = CSP.replace("; frame-ancestors 'none'", '');
export const HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
});

export async function inventory(root, { complete = true, allowed = FILES } = {}) {
  const base = resolve(root);
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink() || resolve(await realpath(base)) !== base) throw new Error('Unsafe asset root');
  const files = [];
  const directories = new Set(allowed.flatMap(file => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  }));
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const absolute = resolve(folder, entry.name);
      const key = relative(base, absolute).split(sep).join('/');
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || resolve(await realpath(absolute)) !== absolute) throw new Error('Linked asset rejected');
      if (info.isDirectory()) {
        if (!directories.has(key)) throw new Error('Unknown asset directory');
        await walk(absolute);
      } else {
        if (!info.isFile() || info.nlink !== 1 || !allowed.includes(key)) throw new Error('Unknown or linked asset');
        const bytes = await readFile(absolute);
        files.push({ path: key, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await walk(base);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (complete && (files.length !== allowed.length || allowed.some(file => !files.some(item => item.path === file)))) throw new Error('Missing asset');
  return files;
}
