import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..');

const filePairs = [
  ['scripts/md-to-html.mjs', 'scripts/md-to-html.mjs'],
  ['public/core/engine.js', 'public/core/engine.js'],
  ['public/core/export-standalone.js', 'public/core/export-standalone.js'],
  ['public/core/pagination.js', 'public/core/pagination.js'],
  ['public/core/registry.js', 'public/core/registry.js'],
  ['public/document.css', 'public/document.css'],
];

async function copyRequiredFiles() {
  for (const [srcRel, destRel] of filePairs) {
    const src = path.join(repoRoot, srcRel);
    const dest = path.join(extensionRoot, destRel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

copyRequiredFiles().catch((error) => {
  console.error('[sync-cli-bundle] failed:', error?.stack || String(error));
  process.exit(1);
});
