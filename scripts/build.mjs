import { mkdir, copyFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets } from './lib/check-assets.mjs';
import { inventory } from './lib/static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'public');
const target = resolve(root, 'dist');
try {
  const files = await checkAssets(source);
  try { await lstat(target); await inventory(target, { complete: false }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(target, { recursive: true });
  for (const item of files) {
    await mkdir(dirname(resolve(target, item.path)), { recursive: true });
    await copyFile(resolve(source, item.path), resolve(target, item.path));
  }
  const result = await inventory(target);
  if (JSON.stringify(result) !== JSON.stringify(files)) throw new Error('Built asset mismatch');
  console.log(JSON.stringify({ status: 'PASS', kind: 'preview-only', files: result }, null, 2));
} catch (error) { console.error(`FAIL build: ${error.message}`); process.exitCode = 1; }
