import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, PRODUCTION_FILES, createProductionFiles, validateProduction, productionManifest, verifyProductionBuild } from './lib/production.mjs';
import { inventory } from './lib/static-files.mjs';

try {
  const files = await createProductionFiles(); validateProduction(files);
  const directory = resolve(ROOT, 'dist-production');
  try { await lstat(directory); await inventory(directory, { allowed: PRODUCTION_FILES, complete: false }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifestPath = `${directory}.manifest.json`;
  try { const stat = await lstat(manifestPath); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Unsafe manifest'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true });
  for (const [path, bytes] of files) { await mkdir(dirname(resolve(directory, path)), { recursive: true }); await writeFile(resolve(directory, path), bytes); }
  await writeFile(manifestPath, JSON.stringify(productionManifest(files), null, 2) + '\n');
  await verifyProductionBuild(directory);
  console.log(JSON.stringify({ status: 'PASS', directory: 'dist-production/', manifest: 'dist-production.manifest.json (outside assets)', ...productionManifest(files) }, null, 2));
} catch (error) { console.error(`FAIL production build: ${error.message}`); process.exitCode = 1; }
