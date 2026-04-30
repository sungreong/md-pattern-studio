import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const cliPath = path.resolve(process.argv[2] || path.join(repoRoot, 'scripts', 'md-to-html.mjs'));

function runCli(args, cwd = repoRoot) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'md-studio-embed-images-'));
const assetDir = path.join(tempRoot, 'assets');
await fs.mkdir(assetDir, { recursive: true });

const svgPath = path.join(assetDir, 'local-card.svg');
await fs.writeFile(
  svgPath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#e5eefc"/><text x="12" y="36" font-size="18">Local</text></svg>`,
  'utf8',
);

const markdownPath = path.join(tempRoot, 'fixture.md');
await fs.writeFile(
  markdownPath,
  [
    '# Embed image fixture',
    '',
    '![local](./assets/local-card.svg)',
    '',
    '![remote](https://example.com/chart.png)',
    '',
    '![missing](./assets/missing.png)',
    '',
  ].join('\n'),
  'utf8',
);

const embedOutput = path.join(tempRoot, 'embed.html');
runCli([markdownPath, '--out', embedOutput, '--standalone', '--base-dir', tempRoot]);
const embedHtml = await fs.readFile(embedOutput, 'utf8');
assert.match(embedHtml, /src="data:image\/svg\+xml;base64,/);
assert.match(embedHtml, /src="https:\/\/example\.com\/chart\.png"/);
assert.match(embedHtml, /이미지 내장 실패:/);
assert.match(embedHtml, /class="md-image-fallback"/);
assert.match(embedHtml, /data-src-resolve-error="true"/);
assert.doesNotMatch(embedHtml, /src="file:\/\/\/[^"]*local-card\.svg"/);

const noEmbedOutput = path.join(tempRoot, 'no-embed.html');
runCli([markdownPath, '--out', noEmbedOutput, '--standalone', '--base-dir', tempRoot, '--no-embed-local-images']);
const noEmbedHtml = await fs.readFile(noEmbedOutput, 'utf8');
assert.match(noEmbedHtml, /src="file:\/\/\/[^"]*local-card\.svg"/);
assert.doesNotMatch(noEmbedHtml, /src="data:image\/svg\+xml;base64,/);

console.log(`embed-local-images ok: ${cliPath}`);
