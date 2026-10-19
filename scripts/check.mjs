import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { checkAssets, checkToolScripts } from './lib/check-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 required');
  await checkToolScripts(root);
  const files = await checkAssets(resolve(root, 'public'));
  console.log(`PASS check: ${files.length} closed preview assets; syntax, document structure and forbidden API checks`);
} catch (error) {
  console.error(`FAIL check: ${error.message}`);
  process.exitCode = 1;
}
