#!/usr/bin/env node
import assert from 'assert/strict';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mps-small-'));
const inputPath = path.join(tempDir, 'small.md');
const outputPath = path.join(tempDir, 'small.html');

try {
  await fs.writeFile(inputPath, '## Demo\n\nText <small>tiny **note**</small> after.\n', 'utf8');
  await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'md-to-html.mjs'), inputPath, '--out', outputPath, '--standalone'], {
    cwd: repoRoot,
    timeout: 10000,
  });

  const html = await fs.readFile(outputPath, 'utf8');
  assert(html.includes('<small>tiny <strong>note</strong></small>'), 'CLI output should render inline small with nested Markdown formatting');
  assert(!html.includes('&lt;small&gt;'), 'CLI output should not leave inline small escaped');
  assert(html.includes('.studio-document small'), 'standalone CSS should include small text styling');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log('raw-html-small-cli-guard ok');
