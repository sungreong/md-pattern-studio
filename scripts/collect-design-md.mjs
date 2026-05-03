#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_REPO = 'VoltAgent/awesome-design-md';
const TREE_URL = `https://api.github.com/repos/${SOURCE_REPO}/git/trees/main?recursive=1`;
const README_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}/main/README.md`;
const RAW_BASE = `https://raw.githubusercontent.com/${SOURCE_REPO}/main`;
const SKILL_ROOT = path.join(repoRoot, 'ai_skills', 'claude', 'skills', 'md-presentation-composer');
const DESIGN_ROOT = path.join(SKILL_ROOT, 'references', 'design-md');
const RAW_ROOT = path.join(DESIGN_ROOT, 'raw');
const SOURCE_INDEX_PATH = path.join(DESIGN_ROOT, 'source-index.json');

function assertInsideRepo(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(repoRoot)) {
    throw new Error(`Refusing to write outside repository: ${resolved}`);
  }
  return resolved;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'markdown-pattern-studio-design-collector',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'markdown-pattern-studio-design-collector',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

function normalizeSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/getdesign\.md\//, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseCollectionMetadata(readme = '') {
  const map = new Map();
  let category = '';
  for (const line of String(readme).split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+\[(?:\*\*)?([^\]*]+)(?:\*\*)?\]\(([^)]+)\)\s*-\s*(.+?)\s*$/);
    if (!bullet || !category) continue;
    const [, name, href, description] = bullet;
    const slug = normalizeSlug(href);
    if (!slug) continue;
    map.set(slug, {
      slug,
      name: name.trim(),
      category,
      description: description.trim(),
      pageUrl: `https://getdesign.md/${slug}/design-md`,
    });
  }
  return map;
}

async function main() {
  const tree = await fetchJson(TREE_URL);
  const readme = await fetchText(README_URL);
  const metadata = parseCollectionMetadata(readme);
  const entries = (tree.tree || [])
    .filter((item) => item.type === 'blob' && /^design-md\/[^/]+\/DESIGN\.md$/.test(item.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (entries.length !== 70) {
    throw new Error(`Expected 70 DESIGN.md files, found ${entries.length}`);
  }

  await fs.mkdir(assertInsideRepo(RAW_ROOT), { recursive: true });
  const index = [];

  for (const entry of entries) {
    const slug = entry.path.split('/')[1];
    const rawUrl = `${RAW_BASE}/${entry.path}`;
    const content = await fetchText(rawUrl);
    const outDir = assertInsideRepo(path.join(RAW_ROOT, slug));
    const outPath = path.join(outDir, 'DESIGN.md');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, content.replace(/\r\n?/g, '\n'), 'utf8');

    const meta = metadata.get(slug) || {};
    index.push({
      slug,
      name: meta.name || slug,
      category: meta.category || 'Uncategorized',
      description: meta.description || '',
      pageUrl: meta.pageUrl || `https://getdesign.md/${slug}/design-md`,
      sourcePath: entry.path,
      sourceUrl: rawUrl,
      localPath: `references/design-md/raw/${slug}/DESIGN.md`,
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  }

  await fs.writeFile(
    assertInsideRepo(SOURCE_INDEX_PATH),
    `${JSON.stringify(
      {
        sourceRepo: SOURCE_REPO,
        collectedAt: new Date().toISOString(),
        count: index.length,
        items: index,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`Collected ${index.length} DESIGN.md files into ${path.relative(repoRoot, RAW_ROOT)}`);
  console.log(`Wrote ${path.relative(repoRoot, SOURCE_INDEX_PATH)}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
