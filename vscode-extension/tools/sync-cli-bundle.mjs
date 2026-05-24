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
  ['public/core/appearance.js', 'public/core/appearance.js'],
  ['public/core/pagination.js', 'public/core/pagination.js'],
  ['public/core/quality.js', 'public/core/quality.js'],
  ['public/core/registry.js', 'public/core/registry.js'],
  ['public/core/snippets.js', 'public/core/snippets.js'],
  ['public/core/brand-designs.js', 'public/core/brand-designs.js'],
  ['public/document.css', 'public/document.css'],
  // NOTE: public/template-builder-vscode.html is VSCode-dedicated; do NOT sync from repo root
];

async function copyRequiredFiles() {
  for (const [srcRel, destRel] of filePairs) {
    const src = path.join(repoRoot, srcRel);
    const dest = path.join(extensionRoot, destRel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
  await copyBundledAiSkills();
}

async function copyBundledAiSkills() {
  const src = path.join(repoRoot, 'ai_skills');
  const dest = path.join(extensionRoot, 'ai_skills');

  assertInside(extensionRoot, dest);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, {
    recursive: true,
    filter: (source) => !isExcludedPath(source),
  });
}

function isExcludedPath(source) {
  const name = path.basename(source);
  return ['.git', 'node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(name);
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside extension root: ${target}`);
  }
}

copyRequiredFiles().catch((error) => {
  console.error('[sync-cli-bundle] failed:', error?.stack || String(error));
  process.exit(1);
});
