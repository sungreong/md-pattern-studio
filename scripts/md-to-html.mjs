#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import { TextDecoder } from 'util';

import {
  parseMarkdownDocument,
  renderDocument,
  registerBuiltInTemplates,
  splitSourceByPageBreak,
} from '../public/core/engine.js';
import { TemplateRegistry } from '../public/core/registry.js';
import { buildStandaloneHtmlDocument } from '../public/core/export-standalone.js';
import { buildAppearanceRootAttributes, normalizeAppearanceOptions } from '../public/core/appearance.js';
import { buildBrandDesignStyle, getBrandDesign, normalizeBrandDesignSlug } from '../public/core/brand-designs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_PAGE_WIDTH = '1120px';
const DEFAULT_PAGE_HEIGHT = '720px';
const DEFAULT_INPUT_ENCODING = 'utf-8';
const FALLBACK_INPUT_ENCODINGS = ['windows-949', 'euc-kr'];
const EMAIL_DISCLAIMER_START_RE = /(?:^|\n)\s*The above message is intended solely for the named addressee\b/i;
const EMAIL_DISCLAIMER_CONFIRM_RE =
  /Any unauthorized dissemination[\s\S]{0,800}received\s+this\s+communication\s+in\s+error[\s\S]{0,400}erase\s+this\s+communication\s+immediately\.?/i;

function printUsage() {
  console.log(`Usage:
  node scripts/md-to-html.mjs <input.md> [--out output.html] [--theme report] [--design vercel] [--appearance clean] [--appearance-background plain] [--appearance-radius none] [--appearance-frame lines] [--viewer-chrome minimal] [--mode web] [--standalone] [--base-dir path] [--embed-local-images|--no-embed-local-images] [--strip-email-disclaimer] [--mermaid|--no-mermaid]

Examples:
  node scripts/md-to-html.mjs test/notes.md
  node scripts/md-to-html.mjs test/notes.md --out test/notes.html --theme slate --standalone
  node scripts/md-to-html.mjs test/notes.md --design vercel --intent pitch --standalone
`);
}

function parseArgs(argv) {
  const result = {
    input: '',
    out: '',
    theme: '',
    design: '',
    mode: '',
    intent: '',
    appearance: '',
    appearanceBackground: '',
    appearanceRadius: '',
    appearanceFrame: '',
    viewerChrome: '',
    standalone: true,
    baseDir: '',
    mermaid: null,
    embedLocalImages: null,
    stripEmailDisclaimer: false,
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
    if (token === '--design') {
      result.design = args.shift() || '';
      continue;
    }
    if (token === '--mode') {
      result.mode = args.shift() || '';
      continue;
    }
    if (token === '--intent') {
      result.intent = args.shift() || '';
      continue;
    }
    if (token === '--appearance') {
      result.appearance = args.shift() || '';
      continue;
    }
    if (token === '--appearance-background') {
      result.appearanceBackground = args.shift() || '';
      continue;
    }
    if (token === '--appearance-radius') {
      result.appearanceRadius = args.shift() || '';
      continue;
    }
    if (token === '--appearance-frame') {
      result.appearanceFrame = args.shift() || '';
      continue;
    }
    if (token === '--viewer-chrome') {
      result.viewerChrome = args.shift() || '';
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
    if (token === '--strip-email-disclaimer') {
      result.stripEmailDisclaimer = true;
      continue;
    }
    if (token === '--embed-local-images') {
      result.embedLocalImages = true;
      continue;
    }
    if (token === '--no-embed-local-images') {
      result.embedLocalImages = false;
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

function countMatches(text = '', pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function countReplacementChars(text = '') {
  return countMatches(text, /\uFFFD/g);
}

function countQuestionRuns(text = '') {
  return countMatches(text, /\?{3,}/g);
}

function countHangul(text = '') {
  return countMatches(text, /[\u3131-\u318E\uAC00-\uD7A3]/g);
}

function countLikelyMojibake(text = '') {
  return countMatches(text, /[ÃÂìíîïð][\u0080-\u00FF]?/g);
}

function scoreDecodedText(text = '') {
  const value = String(text || '');
  const length = Math.max(1, value.length);
  const replacements = countReplacementChars(value);
  const questionRuns = countQuestionRuns(value);
  const hangul = countHangul(value);
  const mojibake = countLikelyMojibake(value);
  let score = 0;
  score -= replacements * 120;
  score -= questionRuns * 35;
  score -= mojibake * 20;
  score += Math.min(hangul, 200) * 2;
  score += Math.min(length, 2000) / 1000;
  return { score, replacements, questionRuns, hangul, mojibake, length };
}

function decodeBuffer(buffer, encoding) {
  return new TextDecoder(encoding, { fatal: false }).decode(buffer);
}

function shouldTryFallbackDecoding(utf8Stats) {
  if (utf8Stats.replacements > 0) return true;
  if (utf8Stats.questionRuns >= 2 && utf8Stats.hangul === 0) return true;
  if (utf8Stats.mojibake >= 3 && utf8Stats.hangul === 0) return true;
  return false;
}

async function readInputMarkdown(inputPath) {
  const buffer = await fs.readFile(inputPath);
  const candidates = [
    {
      encoding: DEFAULT_INPUT_ENCODING,
      source: decodeBuffer(buffer, DEFAULT_INPUT_ENCODING),
    },
  ];
  candidates[0].stats = scoreDecodedText(candidates[0].source);

  if (shouldTryFallbackDecoding(candidates[0].stats)) {
    for (const encoding of FALLBACK_INPUT_ENCODINGS) {
      try {
        const source = decodeBuffer(buffer, encoding);
        candidates.push({ encoding, source, stats: scoreDecodedText(source) });
      } catch {
        // Unsupported encoding in a stripped-down Node build; keep the UTF-8 result.
      }
    }
  }

  candidates.sort((a, b) => b.stats.score - a.stats.score);
  const best = candidates[0];
  const warnings = [];
  if (best.encoding !== DEFAULT_INPUT_ENCODING) {
    warnings.push(`입력 파일을 UTF-8 대신 ${best.encoding} 인코딩으로 해석했습니다.`);
  }
  return { source: best.source, encoding: best.encoding, stats: best.stats, warnings };
}

function findEmailDisclaimerRange(source = '') {
  const text = String(source || '');
  const startMatch = text.match(EMAIL_DISCLAIMER_START_RE);
  if (!startMatch || startMatch.index == null) return null;
  const start = startMatch.index + startMatch[0].search(/The above message/i);
  const tail = text.slice(start);
  if (!EMAIL_DISCLAIMER_CONFIRM_RE.test(tail)) return null;
  return { start, end: text.length };
}

function stripEmailDisclaimer(source = '') {
  const text = String(source || '');
  const range = findEmailDisclaimerRange(text);
  if (!range) return { source: text, stripped: false };
  return {
    source: `${text.slice(0, range.start).trimEnd()}\n`,
    stripped: true,
  };
}

function buildSourceQualityWarnings(source = '', readResult = {}) {
  const stats = scoreDecodedText(source);
  const warnings = [...(readResult.warnings || [])];
  if (stats.replacements > 0) {
    warnings.push('입력에 깨진 문자(�)가 포함되어 있습니다. 원본 파일 인코딩 또는 추출 과정을 확인하세요.');
  }
  if (stats.questionRuns >= 2) {
    warnings.push('입력에 "????" 형태의 손상 텍스트가 많습니다. 이미 ?로 치환된 글자는 자동 복구할 수 없습니다.');
  }
  if (stats.hangul === 0 && (stats.questionRuns > 0 || stats.mojibake >= 3)) {
    warnings.push('한글 문서로 보이지만 한글 문자가 거의 없습니다. 사내 문서 추출/복사 단계에서 인코딩이 깨졌을 수 있습니다.');
  }
  return warnings;
}

function prepareSourceForRender(source = '', options = {}) {
  const disclaimerRange = findEmailDisclaimerRange(source);
  const warnings = [];
  let prepared = String(source || '');
  if (disclaimerRange) {
    if (options.stripEmailDisclaimer) {
      const stripped = stripEmailDisclaimer(prepared);
      prepared = stripped.source;
      warnings.push('회사 메일 footer/disclaimer를 감지해 HTML 출력에서 제거했습니다.');
    } else {
      warnings.push('메일 footer/disclaimer가 본문에 포함되어 있습니다. 제거하려면 --strip-email-disclaimer를 사용하세요.');
    }
  }
  return { source: prepared, warnings };
}

function isAbsoluteAssetPath(value = '') {
  const text = String(value || '').trim();
  return /^(https?:|data:|blob:|file:)/i.test(text) || text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text);
}

function isSkippedInlineAssetPath(value = '') {
  return /^(https?:|data:|blob:)/i.test(String(value || '').trim());
}

function decodeHtmlAttribute(value = '') {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtmlText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getImageMimeType(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.svg', 'image/svg+xml'],
    ['.bmp', 'image/bmp'],
    ['.ico', 'image/x-icon'],
  ]);
  return mimeTypes.get(ext) || 'application/octet-stream';
}

function resolveLocalImageFilePath(src = '', baseDir = '') {
  const value = decodeHtmlAttribute(src).trim();
  if (!value || isSkippedInlineAssetPath(value)) return null;
  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || path.isAbsolute(value)) {
    return value;
  }
  if (!baseDir || value.startsWith('/')) return null;
  return path.resolve(baseDir, value);
}

async function inlineLocalImages(renderedHtml = '', options = {}) {
  if (!options.embedLocalImages) return { html: renderedHtml, warnings: [] };

  const source = String(renderedHtml || '');
  const imageSrcRe = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;
  const warnings = [];
  const warningKeys = new Set();
  const chunks = [];
  let lastIndex = 0;

  const addWarning = (src, detail) => {
    const key = `${src}::${detail}`;
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push(`이미지 내장 실패: ${src}${detail ? ` (${detail})` : ''}`);
  };

  for (let match = imageSrcRe.exec(source); match; match = imageSrcRe.exec(source)) {
    const [tag, quote, rawSrc] = match;
    chunks.push(source.slice(lastIndex, match.index));
    lastIndex = match.index + tag.length;

    const localPath = resolveLocalImageFilePath(rawSrc, options.baseDir);
    if (!localPath) {
      chunks.push(tag);
      continue;
    }

    try {
      const buffer = await fs.readFile(localPath);
      const mimeType = getImageMimeType(localPath);
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      chunks.push(tag.replace(`src=${quote}${rawSrc}${quote}`, `src=${quote}${dataUrl}${quote}`));
    } catch (error) {
      addWarning(rawSrc, error?.code || error?.message || 'read-failed');
      const failedTag = tag.includes('data-src-resolve-error=')
        ? tag
        : tag.replace(/<img\b/i, '<img data-src-resolve-error="true"');
      chunks.push(
        `${failedTag}<div class="md-image-fallback" role="note">이미지를 불러올 수 없습니다.<span>${escapeHtmlText(rawSrc)}</span></div>`,
      );
    }
  }

  chunks.push(source.slice(lastIndex));
  return { html: chunks.join(''), warnings };
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
  const source = String(html || '');
  const start = source.search(/<div class="document-shell(?: is-paginated)?">/);
  if (start === -1) return source;

  const startTagEnd = source.indexOf('>', start);
  if (startTagEnd === -1) return source;

  const divTokenRe = /<\/?div\b[^>]*>/gi;
  divTokenRe.lastIndex = start;

  let depth = 0;
  let closeStart = -1;
  for (let match = divTokenRe.exec(source); match; match = divTokenRe.exec(source)) {
    const token = match[0];
    const isClosing = token.startsWith('</');
    if (isClosing) {
      depth -= 1;
      if (depth === 0) {
        closeStart = match.index;
        break;
      }
      continue;
    }

    depth += 1;
    if (depth === 1 && match.index !== start) {
      // Keep searching until we hit the document-shell opening tag.
      depth = 0;
    }
  }

  if (closeStart === -1 || closeStart <= startTagEnd) {
    return source.slice(startTagEnd + 1).trim();
  }
  return source.slice(startTagEnd + 1, closeStart).trim();
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
  const effectiveDesign = options.design || model.meta.design || model.meta.designMd || '';
  const brandDesign = getBrandDesign(effectiveDesign);
  const effectiveTheme = options.theme || model.meta.theme || brandDesign?.theme || 'report';
  const effectiveMode = options.mode || model.meta.mode || 'web';
  const effectiveIntent = options.intent || model.meta.intent || brandDesign?.intent || '';
  const appearance = normalizeAppearanceOptions(options, model.meta);
  const sourceBaseDir = String(options.sourceBaseDir || model.meta.sourceBaseDir || '').trim();
  const resolveAssetUrl = createNodeAssetResolver(sourceBaseDir);
  const enableMermaid = options.enableMermaid !== false;
  const enableCodeCopy = options.enableCodeCopy !== false;
  const warnings = [];
  if (effectiveDesign && !normalizeBrandDesignSlug(effectiveDesign)) {
    warnings.push(`알 수 없는 DESIGN.md preset: ${effectiveDesign}`);
  }

  const segments = splitSourceByPageBreak(source);
  if (segments.length <= 1) {
    return {
      model,
      appearance,
      warnings,
      html: renderDocument(
        model,
        {
          theme: effectiveTheme,
          design: effectiveDesign,
          toc: Boolean(model.meta.toc),
          tocDepth: Number(model.meta.tocDepth || 3),
          mode: effectiveMode,
          intent: effectiveIntent,
          ...appearance,
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
        design: effectiveDesign,
        toc: false,
        tocDepth: Number(model.meta.tocDepth || 3),
        mode: effectiveMode,
        intent: effectiveIntent,
        ...appearance,
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
      appearance,
      warnings,
      html: renderDocument(
        model,
        {
          theme: effectiveTheme,
          design: effectiveDesign,
          toc: Boolean(model.meta.toc),
          tocDepth: Number(model.meta.tocDepth || 3),
          mode: effectiveMode,
          intent: effectiveIntent,
          ...appearance,
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

  const intentClass = effectiveIntent ? ` intent-${effectiveIntent}` : '';
  const designClass = brandDesign?.className ? ` design-${brandDesign.className}` : '';
  const appearanceAttrs = buildAppearanceRootAttributes(appearance);
  const appearanceClass = appearanceAttrs.className ? ` ${escapeHtmlText(appearanceAttrs.className)}` : '';
  const appearanceData = appearanceAttrs.attrs ? ` ${appearanceAttrs.attrs}` : '';
  const designStyle = brandDesign ? buildBrandDesignStyle(brandDesign) : '';
  return {
    model,
    appearance,
    warnings,
    html: `
      <div class="studio-document theme-${escapeHtmlText(effectiveTheme)} mode-${escapeHtmlText(effectiveMode)}${escapeHtmlText(intentClass)}${escapeHtmlText(designClass)}${appearanceClass}"${appearanceData} style="${escapeHtmlText(`${designStyle}--page-width:${width};--page-height:${height};`)}">
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
    exportWarnings: options.exportWarnings || [],
    appearance: options.appearance || {},
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outPath = path.resolve(process.cwd(), args.out);
  const sourceBaseDir = args.baseDir ? path.resolve(process.cwd(), args.baseDir) : path.dirname(inputPath);
  const enableMermaid = args.mermaid == null ? Boolean(args.standalone) : Boolean(args.mermaid);
  const enableCodeCopy = Boolean(args.standalone);
  const embedLocalImages = args.embedLocalImages == null ? Boolean(args.standalone) : Boolean(args.embedLocalImages);

  const readResult = await readInputMarkdown(inputPath);
  const prepared = prepareSourceForRender(readResult.source, {
    stripEmailDisclaimer: args.stripEmailDisclaimer,
  });
  const source = prepared.source;
  const exportWarnings = [
    ...buildSourceQualityWarnings(source, readResult),
    ...prepared.warnings,
  ];
  const registry = new TemplateRegistry();
  registerBuiltInTemplates(registry);

  const { model, appearance, html: renderedHtml, warnings: renderWarnings = [] } = buildRenderedHtml(
    source,
    {
      theme: args.theme,
      design: args.design,
      mode: args.mode,
      intent: args.intent,
      appearance: args.appearance,
      appearanceBackground: args.appearanceBackground,
      appearanceRadius: args.appearanceRadius,
      appearanceFrame: args.appearanceFrame,
      viewerChrome: args.viewerChrome,
      sourceBaseDir,
      enableMermaid,
      enableCodeCopy,
    },
    registry,
  );
  exportWarnings.push(...renderWarnings);
  const inlined = await inlineLocalImages(renderedHtml, {
    baseDir: sourceBaseDir,
    embedLocalImages,
  });
  const html = inlined.html;
  exportWarnings.push(...inlined.warnings);

  let output = html;
  if (args.standalone) {
    const cssPath = path.join(rootDir, 'public', 'document.css');
    const css = await fs.readFile(cssPath, 'utf8');
    output = buildStandaloneHtml(html, model, css, { enableMermaid, exportWarnings, appearance });
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, 'utf8');
  console.log(`Converted: ${inputPath}`);
  console.log(`Output   : ${outPath}`);
  for (const warning of exportWarnings) {
    console.warn(`[md-to-html warning] ${warning}`);
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
