#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  parseMarkdownDocument,
  renderDocument,
  registerBuiltInTemplates,
  splitSourceByPageBreak,
} from '../public/core/engine.js';
import { TemplateRegistry } from '../public/core/registry.js';
import { buildStandaloneHtmlDocument } from '../public/core/export-standalone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_PAGE_WIDTH = '1120px';
const DEFAULT_PAGE_HEIGHT = '720px';

function printUsage() {
  console.log(`Usage:
  node scripts/md-to-html.mjs <input.md> [--out output.html] [--theme report] [--mode web] [--standalone] [--base-dir path] [--mermaid|--no-mermaid]

Examples:
  node scripts/md-to-html.mjs test/notes.md
  node scripts/md-to-html.mjs test/notes.md --out test/notes.html --theme slate --standalone
`);
}

function parseArgs(argv) {
  const result = {
    input: '',
    out: '',
    theme: '',
    mode: '',
    standalone: true,
    baseDir: '',
    mermaid: null,
  };

  const args = [...argv];
  while (args.length) {
    const token = args.shift();
    if (!token) continue;
    if (!result.input && !token.startsWith('-')) {
      result.input = token;
      continue;
    }
    if (token === '--out' || token === '-o') {
      result.out = args.shift() || '';
      continue;
    }
    if (token === '--theme') {
      result.theme = args.shift() || '';
      continue;
    }
    if (token === '--mode') {
      result.mode = args.shift() || '';
      continue;
    }
    if (token === '--standalone') {
      result.standalone = true;
      continue;
    }
    if (token === '--no-standalone') {
      result.standalone = false;
      continue;
    }
    if (token === '--base-dir') {
      result.baseDir = args.shift() || '';
      continue;
    }
    if (token === '--mermaid') {
      result.mermaid = true;
      continue;
    }
    if (token === '--no-mermaid') {
      result.mermaid = false;
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown option: ${token}`);
  }

  if (!result.input) {
    printUsage();
    throw new Error('Missing input markdown file');
  }

  if (!result.out) {
    const ext = path.extname(result.input);
    const base = result.input.slice(0, ext.length ? -ext.length : result.input.length);
    result.out = `${base}.html`;
  }

  return result;
}

function isAbsoluteAssetPath(value = '') {
  const text = String(value || '').trim();
  return /^(https?:|data:|blob:|file:)/i.test(text) || text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text);
}

function createNodeAssetResolver(baseDir = '') {
  const base = String(baseDir || '').trim();
  return (rawSrc) => {
    const src = String(rawSrc || '').trim();
    if (!src) return { src, error: true };
    if (isAbsoluteAssetPath(src)) return { src, error: false };
    if (!base) return { src, error: false };
    try {
      return { src: pathToFileURL(path.resolve(base, src)).href, error: false };
    } catch (error) {
      return { src, error: true };
    }
  };
}

function sanitizeCssSize(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
  if (/^\d+(\.\d+)?(px|%|vw|vh|rem|em)$/.test(text)) return text;
  return fallback;
}

function resolvePageSizing(meta = {}) {
  return {
    width: sanitizeCssSize(meta.pageWidth || meta.slideWidth, DEFAULT_PAGE_WIDTH),
    height: sanitizeCssSize(meta.pageHeight || meta.slideHeight, DEFAULT_PAGE_HEIGHT),
  };
}

function unwrapDocumentShell(html) {
  const start = html.search(/<div class="document-shell(?: is-paginated)?">/);
  if (start === -1) return html;
  const startTagEnd = html.indexOf('>', start);
  if (startTagEnd === -1) return html;
  const end = html.lastIndexOf('</div>\n  </div>');
  if (end === -1 || end <= startTagEnd) return html.slice(startTagEnd + 1);
  return html.slice(startTagEnd + 1, end).trim();
}

function hasMeaningfulText(html) {
  const clean = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
  return clean.length > 0;
}

function buildRenderedHtml(source, options, registry) {
  const model = parseMarkdownDocument(source);
  const effectiveTheme = options.theme || model.meta.theme || 'report';
  const effectiveMode = options.mode || model.meta.mode || 'web';
  const sourceBaseDir = String(options.sourceBaseDir || model.meta.sourceBaseDir || '').trim();
  const resolveAssetUrl = createNodeAssetResolver(sourceBaseDir);
  const enableMermaid = options.enableMermaid !== false;
  const enableCodeCopy = options.enableCodeCopy !== false;

  const segments = splitSourceByPageBreak(source);
  if (segments.length <= 1) {
    return {
      model,
      html: renderDocument(
        model,
        {
          theme: effectiveTheme,
          toc: Boolean(model.meta.toc),
          tocDepth: Number(model.meta.tocDepth || 3),
          mode: effectiveMode,
          sourceBaseDir,
          resolveAssetUrl,
          enableMermaid,
          enableCodeCopy,
        },
        registry,
      ),
    };
  }

  const pages = [];
  for (const segment of segments) {
    const pageModel = parseMarkdownDocument(segment);
    const pageHtml = renderDocument(
      pageModel,
      {
        theme: effectiveTheme,
        toc: false,
        tocDepth: Number(model.meta.tocDepth || 3),
        mode: effectiveMode,
        sourceBaseDir,
        resolveAssetUrl,
        enableMermaid,
        enableCodeCopy,
      },
      registry,
    );
    const inner = unwrapDocumentShell(pageHtml);
    if (hasMeaningfulText(inner)) pages.push(inner);
  }

  if (!pages.length) {
    return {
      model,
      html: renderDocument(
        model,
        {
          theme: effectiveTheme,
          toc: Boolean(model.meta.toc),
          tocDepth: Number(model.meta.tocDepth || 3),
          mode: effectiveMode,
          sourceBaseDir,
          resolveAssetUrl,
          enableMermaid,
          enableCodeCopy,
        },
        registry,
      ),
    };
  }

  const { width, height } = resolvePageSizing(model.meta);
  const totalPages = pages.length;
  const content = pages
    .map(
      (page, index) => `
        <section class="doc-page" id="page-${index + 1}" data-page-number="${index + 1}">
          <div class="doc-page-inner">${page}</div>
          <footer class="doc-page-footer">
            <span>Page ${index + 1}</span>
            <span class="doc-page-links">
              ${index > 0 ? `<a href="#page-${index}">Prev</a>` : ''}
              ${index < totalPages - 1 ? `<a href="#page-${index + 2}">Next</a>` : ''}
            </span>
          </footer>
        </section>
      `,
    )
    .join('');

  return {
    model,
    html: `
      <div class="studio-document theme-${effectiveTheme} mode-${effectiveMode}" style="--page-width:${width};--page-height:${height};">
        <div class="document-shell is-paginated">
          ${content}
        </div>
      </div>
    `,
  };
}

function buildStandaloneHtml(rendered, model, cssText, options = {}) {
  const pageCount = (String(rendered).match(/class=\"doc-page\"/g) || []).length;
  return buildStandaloneHtmlDocument({
    title: model?.meta?.title || 'Document',
    renderedHtml: rendered,
    cssText,
    pageCount,
    outlineItems: model?.sections || [],
    enableMermaid: options.enableMermaid !== false,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outPath = path.resolve(process.cwd(), args.out);
  const sourceBaseDir = args.baseDir ? path.resolve(process.cwd(), args.baseDir) : path.dirname(inputPath);
  const enableMermaid = args.mermaid == null ? Boolean(args.standalone) : Boolean(args.mermaid);
  const enableCodeCopy = Boolean(args.standalone);

  const source = await fs.readFile(inputPath, 'utf8');
  const registry = new TemplateRegistry();
  registerBuiltInTemplates(registry);

  const { model, html } = buildRenderedHtml(
    source,
    {
      theme: args.theme,
      mode: args.mode,
      sourceBaseDir,
      enableMermaid,
      enableCodeCopy,
    },
    registry,
  );

  let output = html;
  if (args.standalone) {
    const cssPath = path.join(rootDir, 'public', 'document.css');
    const css = await fs.readFile(cssPath, 'utf8');
    output = buildStandaloneHtml(html, model, css, { enableMermaid });
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, 'utf8');
  console.log(`Converted: ${inputPath}`);
  console.log(`Output   : ${outPath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});

