import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mps-appearance-'));

async function runCli(args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'md-to-html.mjs'), ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 4,
  });
  return { stdout, stderr };
}

const inputPath = path.join(tmpRoot, 'appearance.md');
const optionOutPath = path.join(tmpRoot, 'appearance-option.html');
const defaultOutPath = path.join(tmpRoot, 'appearance-default.html');

await fs.writeFile(
  inputPath,
  `---
title: Appearance Guard
theme: report
---

# Appearance Guard

This document checks viewer appearance options.
`,
  'utf8',
);

await runCli([
  inputPath,
  '--out',
  optionOutPath,
  '--appearance',
  'flat',
  '--appearance-radius',
  'none',
  '--appearance-background',
  'plain',
  '--viewer-chrome',
  'hidden',
  '--standalone',
]);

const optionHtml = await fs.readFile(optionOutPath, 'utf8');
assert.match(optionHtml, /<body[^>]*class="[^"]*appearance-flat[^"]*appearance-bg-plain[^"]*appearance-radius-none[^"]*viewer-chrome-hidden/);
assert.match(optionHtml, /class="studio-document[^"]*appearance-flat[^"]*appearance-bg-plain[^"]*appearance-radius-none/);
assert.match(optionHtml, /data-appearance="flat"/);
assert.match(optionHtml, /data-viewer-chrome="hidden"/);
assert.match(optionHtml, /data-export-style-menu/);
assert.match(optionHtml, /data-action="zoom-fill"/);
assert.match(optionHtml, /Fill Width/);

await runCli([inputPath, '--out', defaultOutPath, '--no-standalone']);
const defaultHtml = await fs.readFile(defaultOutPath, 'utf8');
const rootClass = defaultHtml.match(/class="studio-document([^"]*)"/)?.[1] || '';
assert.equal(/appearance-|viewer-chrome-/.test(rootClass), false);

await fs.rm(tmpRoot, { recursive: true, force: true });
