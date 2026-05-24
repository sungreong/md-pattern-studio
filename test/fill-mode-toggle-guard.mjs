import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mps-fill-toggle-'));

async function runCli(args) {
  await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'md-to-html.mjs'), ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 4,
  });
}

const inputPath = path.join(tmpRoot, 'fill-toggle.md');
const outputPath = path.join(tmpRoot, 'fill-toggle.html');

await fs.writeFile(
  inputPath,
  `---
title: Fill Toggle Guard
---

# Cover

첫 페이지입니다.

---

## Second

두 번째 페이지입니다.
`,
  'utf8',
);

await runCli([inputPath, '--out', outputPath, '--standalone']);
const html = await fs.readFile(outputPath, 'utf8');

assert.match(html, /data-action="zoom-fill"/, 'Fill button should be present in slide controls');
assert.match(html, /fillBtn\.hidden = isStacked/, 'Fill button should be hidden in stack mode');
assert.match(html, /function resetZoomForModeSwitch/, 'Mode switching should reset zoom state');
assert.match(html, /autoZoomMode = 'fit'/, 'Mode switching should return to fit zoom mode');
assert.match(html, /document\.body\.classList\.remove\('export-slides-overflow'\)/, 'Mode switching should clear slide overflow');

await fs.rm(tmpRoot, { recursive: true, force: true });
console.log('fill mode toggle guard passed');
