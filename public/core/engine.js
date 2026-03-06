import { PAGE_BREAK_TOKEN, buildPaginatedSegments } from './pagination.js';

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const IMAGE_REF_RE = /^!\[([^\]]*)\]\[([^\]]*)\]\s*$/;
const LIST_RE = /^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/;
const BLOCK_ATTR_RE = /^\{:\s*(.+?)\s*\}\s*$/;
const REFERENCE_DEF_RE = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+["'(](.+?)["')])?\s*$/;

function serializeFrontMatter(meta = {}) {
  const entries = Object.entries(meta || {});
  if (!entries.length) return '';
  const lines = entries.map(([key, value]) => {
    if (typeof value === 'boolean' || typeof value === 'number') return `${key}: ${value}`;
    const text = String(value ?? '');
    if (/^[A-Za-z0-9_.-]+$/.test(text)) return `${key}: ${text}`;
    return `${key}: "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

function isPageBreakMarkerLine(line = '', nextLine = '') {
  if (!/^(-{3,}|\*{3,})\s*$/.test(String(line).trim())) return false;
  const info = parseBlockAttributeLine(nextLine);
  if (!info) return false;
  return info.classes.includes('page-break') || info.attrs?.pagebreak === true || info.attrs?.pagination === true;
}

export function splitSourceByPageBreak(source = '') {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const { meta, body } = parseFrontMatter(normalized);
  const lines = body.split('\n');
  const pages = [[]];
  let fenceToken = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = String(line || '').trim().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!fenceToken) {
        fenceToken = fenceMatch[1];
      } else if (fenceMatch[1] === fenceToken) {
        fenceToken = '';
      }
      pages[pages.length - 1].push(line);
      continue;
    }
    if (!fenceToken && isPageBreakMarkerLine(line, lines[index + 1] || '')) {
      pages.push([]);
      index += 1;
      continue;
    }
    pages[pages.length - 1].push(line);
  }

  const nonEmptyBodies = pages
    .map((pageLines) => pageLines.join('\n'))
    .map((text) => text.trim())
    .filter((text) => Boolean(text));
  if (nonEmptyBodies.length <= 1) return [normalized];

  const fm = serializeFrontMatter(meta);
  return nonEmptyBodies.map((bodyText) => `${fm}${bodyText}\n`);
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(value = '') {
  const trimmed = String(value).trim();
  if (!trimmed) return '#';
  if (/^javascript:/i.test(trimmed)) return '#';
  return trimmed;
}

export function slugify(value = '') {
  const base = String(value)
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u3131-\uD79D\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return base || 'section';
}

export function parseFrontMatter(source = '') {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: normalized, bodyStartLine: 1 };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { meta: {}, body: normalized, bodyStartLine: 1 };
  }
  const raw = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const bodyStartLine = normalized.slice(0, end + 5).split('\n').length;
  const meta = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^(true|false)$/i.test(value)) {
      meta[key] = /^true$/i.test(value);
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      meta[key] = Number(value);
    } else {
      meta[key] = value;
    }
  }
  return { meta, body, bodyStartLine };
}

export function interpolateVariables(text = '', vars = {}) {
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : '';
  });
}

function normalizeReferenceLabel(label = '') {
  return String(label).trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractReferenceDefinitions(body = '') {
  const references = {};
  const output = [];
  for (const line of String(body).split('\n')) {
    const match = line.match(REFERENCE_DEF_RE);
    if (!match) {
      output.push(line);
      continue;
    }
    const key = normalizeReferenceLabel(match[1]);
    if (!key) continue;
    references[key] = {
      href: String(match[2] || '').trim(),
      title: String(match[3] || '').trim(),
    };
  }
  return {
    body: output.join('\n'),
    references,
  };
}

function tokenizeAttributeSpec(spec = '') {
  const tokens = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < spec.length; i += 1) {
    const ch = spec[i];
    if (quote) {
      current += ch;
      if (ch === quote && spec[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function normalizeAttributeValue(raw = '') {
  const text = String(raw).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function parseAttributeSpec(spec = '') {
  const info = { id: '', classes: [], attrs: {} };
  for (const token of tokenizeAttributeSpec(spec)) {
    if (!token) continue;
    if (token.startsWith('#')) {
      info.id = token.slice(1);
      continue;
    }
    if (token.startsWith('.')) {
      info.classes.push(token.slice(1));
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      const key = token.slice(0, eq).trim();
      const value = normalizeAttributeValue(token.slice(eq + 1));
      if (key) info.attrs[key] = value;
      continue;
    }
    info.attrs[token] = true;
  }
  return info;
}

function parseHeadingPayload(payload = '') {
  let text = String(payload).trim();
  let attributes = { id: '', classes: [], attrs: {} };
  const match = text.match(/\s*\{([^{}]+)\}\s*$/);
  if (match) {
    attributes = parseAttributeSpec(match[1]);
    text = text.slice(0, match.index).trim();
  }
  return { text, ...attributes };
}

function parseBlockAttributeLine(line = '') {
  const match = String(line).trim().match(BLOCK_ATTR_RE);
  if (!match) return null;
  return parseAttributeSpec(match[1]);
}

function applyAttributes(target, info) {
  return {
    ...target,
    anchorId: info?.id || target.anchorId || '',
    classes: Array.isArray(info?.classes) ? info.classes : [],
    attrs: info?.attrs || {},
  };
}

export function parseMarkdownDocument(source = '') {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const { meta, body: rawBody, bodyStartLine } = parseFrontMatter(normalized);
  const interpolated = interpolateVariables(rawBody, meta);
  const { body, references } = extractReferenceDefinitions(interpolated);
  const lines = body.split('\n');

  const root = {
    type: 'root',
    id: 'root',
    title: meta.title || 'Document',
    depth: 0,
    line: bodyStartLine,
    contentLines: [],
    children: [],
    classes: [],
    attrs: {},
  };

  const stack = [root];
  let current = root;
  let fenceToken = '';
  const idCounts = new Map();

  const nextId = (candidate) => {
    const count = idCounts.get(candidate) || 0;
    idCounts.set(candidate, count + 1);
    return count === 0 ? candidate : `${candidate}-${count + 1}`;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = String(line || '').trim().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!fenceToken) {
        fenceToken = fenceMatch[1];
      } else if (fenceMatch[1] === fenceToken) {
        fenceToken = '';
      }
      current.contentLines.push(line);
      continue;
    }

    const headingMatch = !fenceToken ? line.match(HEADING_RE) : null;
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const parsed = parseHeadingPayload(headingMatch[2]);
      const headingText = parsed.text || 'Untitled';
      const id = nextId(parsed.id || slugify(headingText));
      while (stack.length && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] || root;
      const section = {
        type: 'section',
        id,
        title: headingText,
        depth,
        line: bodyStartLine + index,
        contentLines: [],
        children: [],
        classes: parsed.classes,
        attrs: parsed.attrs,
      };
      parent.children.push(section);
      stack.push(section);
      current = section;
      continue;
    }

    current.contentLines.push(line);
  }

  hydrateBlocks(root, { references });
  const sections = collectSections(root);
  const blocks = collectBlocks(root);
  return { meta, body, references, root, sections, blocks, bodyStartLine };
}

function hydrateBlocks(node, context) {
  if (node.contentLines) {
    node.blocks = parseBlocks(node.contentLines, node.id, context);
  }
  for (const child of node.children || []) {
    hydrateBlocks(child, context);
  }
}

function collectSections(root) {
  const items = [];
  const visit = (node) => {
    if (node.type === 'section') items.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return items;
}

function collectBlocks(root) {
  const items = [];
  const visit = (node) => {
    for (const block of node.blocks || []) {
      if (!['paragraph', 'list', 'blockquote', 'callout', 'code', 'hr'].includes(block.type)) {
        items.push({ ...block, sectionId: node.id, sectionTitle: node.title || root.title });
      }
    }
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return items;
}

function parseBlocks(lines, sectionId, context = {}) {
  const blocks = [];
  let i = 0;
  const counts = { paragraph: 0, list: 0, quote: 0, code: 0, table: 0, image: 0, hr: 0 };
  const nextBlockId = (type) => `${sectionId}__${type}_${++counts[type]}`;
  const isBlank = (value) => !value || !value.trim();
  const tableSeparator = (value) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value || '');
  const isFenceStart = (value) => /^(```+|~~~+)/.test(String(value || '').trim());
  const parseFenceInfo = (value) => {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/^(```+|~~~+)\s*(.*)$/);
    if (!match) return null;
    const fence = match[1];
    const info = match[2] || '';
    let lang = '';
    let title = '';
    if (info) {
      const parts = info.match(/^(\S+)(?:\s+title="([^"]+)")?/);
      if (parts) {
        lang = parts[1] || '';
        title = parts[2] || '';
      }
    }
    return { fence, lang, title };
  };
  const resolveReference = (label = '') => {
    const key = normalizeReferenceLabel(label);
    return key ? context.references?.[key] : null;
  };

  const readFollowingAttributes = (startIndex) => {
    const info = parseBlockAttributeLine(lines[startIndex] || '');
    if (!info) return { info: null, nextIndex: startIndex };
    return { info, nextIndex: startIndex + 1 };
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (parseBlockAttributeLine(line)) {
      i += 1;
      continue;
    }

    const fenceInfo = parseFenceInfo(line);
    if (fenceInfo) {
      i += 1;
      const codeLines = [];
      const fenceCloseRe = new RegExp(`^${fenceInfo.fence}\\s*$`);
      while (i < lines.length && !fenceCloseRe.test(String(lines[i] || '').trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const blockType = String(fenceInfo.lang || '').toLowerCase() === 'mermaid' ? 'mermaid' : 'code';
      let block = { type: blockType, id: nextBlockId('code'), lang: fenceInfo.lang, title: fenceInfo.title, value: codeLines.join('\n') };
      const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
      block = applyAttributes(block, attrInfo);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    if (IMAGE_RE.test(line.trim())) {
      const [, alt, src] = line.trim().match(IMAGE_RE);
      let block = { type: 'image', id: nextBlockId('image'), alt, src };
      i += 1;
      const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
      block = applyAttributes(block, attrInfo);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    if (IMAGE_REF_RE.test(line.trim())) {
      const [, alt, refLabel] = line.trim().match(IMAGE_REF_RE);
      const ref = resolveReference(refLabel || alt);
      if (ref?.href) {
        let block = { type: 'image', id: nextBlockId('image'), alt, src: ref.href };
        i += 1;
        const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
        block = applyAttributes(block, attrInfo);
        blocks.push(block);
        i = nextIndex;
        continue;
      }
    }

    if (line.includes('|') && tableSeparator(lines[i + 1])) {
      const tableStart = i;
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && String(lines[i] || '').includes('|') && !isBlank(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      let block = parseTableBlock(tableLines, nextBlockId('table'));
      if (!block) {
        i = tableStart + 2;
        blocks.push({ type: 'paragraph', id: nextBlockId('paragraph'), text: String(line || '').trim(), classes: [], attrs: {}, anchorId: '' });
        continue;
      } else {
        const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
        block = applyAttributes(block, attrInfo);
        blocks.push(block);
        i = nextIndex;
        continue;
      }
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || isBlank(lines[i]))) {
        quoteLines.push(lines[i]);
        i += 1;
      }
      let block = parseQuoteBlock(quoteLines, nextBlockId('quote'), context);
      const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
      block = applyAttributes(block, attrInfo);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    if (LIST_RE.test(line)) {
      const listLines = [];
      while (
        i < lines.length &&
        (LIST_RE.test(lines[i]) ||
          isBlank(lines[i]) ||
          (/^\s{2,}\S/.test(lines[i]) && !isFenceStart(lines[i]) && !parseBlockAttributeLine(lines[i])))
      ) {
        listLines.push(lines[i]);
        i += 1;
      }
      let block = parseListBlock(listLines, nextBlockId('list'), context);
      const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
      block = applyAttributes(block, attrInfo);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      let block = { type: 'hr', id: nextBlockId('hr') };
      i += 1;
      const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
      block = applyAttributes(block, attrInfo);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (isBlank(next)) break;
      if (parseBlockAttributeLine(next)) break;
      if (isFenceStart(next.trim()) || IMAGE_RE.test(next.trim()) || IMAGE_REF_RE.test(next.trim()) || /^>\s?/.test(next) || LIST_RE.test(next) || /^(-{3,}|\*{3,})\s*$/.test(next.trim())) break;
      if (next.includes('|') && tableSeparator(lines[i + 1])) break;
      paragraphLines.push(next);
      i += 1;
    }
    let block = { type: 'paragraph', id: nextBlockId('paragraph'), text: paragraphLines.join('\n').trim() };
    const { info: attrInfo, nextIndex } = readFollowingAttributes(i);
    block = applyAttributes(block, attrInfo);
    blocks.push(block);
    i = nextIndex;
  }

  return blocks;
}

function splitTableRow(line) {
  const text = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableBlock(lines, id) {
  const headers = splitTableRow(lines[0]);
  const separatorCells = splitTableRow(lines[1]);
  if (headers.length < 2 || separatorCells.length < 2 || headers.length !== separatorCells.length) {
    return null;
  }
  const validSeparator = separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  if (!validSeparator) return null;
  const alignSpec = separatorCells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'left';
  });
  const rows = lines
    .slice(2)
    .map(splitTableRow)
    .filter((row) => row.length > 0)
    .map((row) => {
      if (row.length < headers.length) {
        return [...row, ...Array.from({ length: headers.length - row.length }, () => '')];
      }
      if (row.length > headers.length) {
        const mergedTail = row.slice(headers.length - 1).join(' | ');
        return [...row.slice(0, headers.length - 1), mergedTail];
      }
      return row;
    });
  return { type: 'table', id, headers, align: alignSpec, rows };
}

function parseQuoteBlock(lines, id, context = {}) {
  const stripped = lines
    .map((line) => line.replace(/^>\s?/, ''))
    .map((line) => line.trimEnd());

  const first = stripped[0] || '';
  const calloutMatch = first.match(/^\[!([A-Za-z]+)\]\s*(.*)$/);
  if (calloutMatch) {
    const calloutType = calloutMatch[1].toLowerCase();
    const title = calloutMatch[2] || calloutType.toUpperCase();
    const contentLines = stripped.slice(1);
    return {
      type: 'callout',
      id,
      calloutType,
      title,
      blocks: parseBlocks(contentLines, `${id}__body`, context),
    };
  }

  return {
    type: 'blockquote',
    id,
    blocks: parseBlocks(stripped, `${id}__body`, context),
  };
}

function parseListBlock(lines, id, context = {}) {
  const rootItems = [];
  const stack = [];
  let ordered = false;

  const pushItem = (indent, marker, rawText) => {
    const taskMatch = String(rawText || '').trim().match(/^\[( |x|X)\]\s+(.*)$/);
    const item = {
      text: taskMatch ? taskMatch[2].trim() : String(rawText || '').trim(),
      isTask: Boolean(taskMatch),
      checked: taskMatch ? taskMatch[1].toLowerCase() === 'x' : false,
      ordered: /\d+\./.test(marker),
      children: [],
      blocks: [],
      _continuation: [],
    };
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    if (stack.length) {
      stack[stack.length - 1].item.children.push(item);
    } else {
      rootItems.push(item);
      if (rootItems.length === 1) ordered = item.ordered;
    }
    stack.push({ indent, item });
  };

  for (const line of lines) {
    if (!String(line || '').trim()) {
      if (stack.length) stack[stack.length - 1].item._continuation.push('');
      continue;
    }

    const match = line.match(LIST_RE);
    if (match) {
      const indent = match[1]?.length || 0;
      pushItem(indent, match[2] || '', match[3] || '');
      continue;
    }

    if (stack.length) {
      stack[stack.length - 1].item._continuation.push(line);
    }
  }

  const hydrateItem = (item, path) => {
    const continuationLines = item._continuation || [];
    const nonEmpty = continuationLines.filter((entry) => String(entry || '').trim().length > 0);
    if (nonEmpty.length) {
      const minIndent = Math.min(
        ...nonEmpty.map((entry) => {
          const m = String(entry).match(/^(\s*)/);
          return m ? m[1].length : 0;
        }),
      );
      const dedented = continuationLines.map((entry) => String(entry || '').slice(minIndent));
      item.blocks = parseBlocks(dedented, `${id}__${path}_body`, context);
    }
    for (let index = 0; index < item.children.length; index += 1) {
      hydrateItem(item.children[index], `${path}_c${index + 1}`);
    }
    delete item._continuation;
  };

  for (let index = 0; index < rootItems.length; index += 1) {
    hydrateItem(rootItems[index], `item${index + 1}`);
  }

  return { type: 'list', id, ordered, items: rootItems };
}

function resolveReference(context, label = '') {
  const key = normalizeReferenceLabel(label);
  if (!key) return null;
  return context?.model?.references?.[key] || context?.references?.[key] || null;
}

export function renderInline(text = '', context = {}) {
  const codeTokens = [];
  const escapeTokens = [];
  const brToken = '@@BR@@';
  let working = String(text ?? '');

  working = working.replace(/\\(.)/g, (_, token) => `@@ESC${escapeTokens.push(escapeHtml(token)) - 1}@@`);
  working = working.replace(/`([^`]+)`/g, (_, code) => `@@CODE${codeTokens.push(escapeHtml(code)) - 1}@@`);
  working = escapeHtml(working);

  working = working
    .replace(/ {2,}\n/g, brToken)
    .replace(/\\\n/g, brToken)
    .replace(/\n/g, ' ');

  working = working.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = sanitizeUrl(href);
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  working = working.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_, label, refLabel) => {
    const ref = resolveReference(context, refLabel || label);
    if (!ref?.href) return `[${label}]`;
    const href = escapeHtml(sanitizeUrl(ref.href));
    const title = ref.title ? ` title="${escapeHtml(ref.title)}"` : '';
    return `<a href="${href}" target="_blank" rel="noreferrer"${title}>${label}</a>`;
  });

  working = working.replace(/(^|[\s(])((https?:\/\/)[^\s<)]+[^\s<).,!?])/g, (_, lead, url) => {
    const safe = escapeHtml(sanitizeUrl(url));
    return `${lead}<a href="${safe}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
  });

  working = working.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  working = working.replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>');
  working = working.replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>');
  working = working.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  working = working.replace(new RegExp(brToken, 'g'), '<br />');
  working = working.replace(/@@CODE(\d+)@@/g, (_, index) => `<code>${codeTokens[Number(index)] || ''}</code>`);
  working = working.replace(/@@ESC(\d+)@@/g, (_, index) => escapeTokens[Number(index)] || '');
  return working;
}

function parseColumnMeta(text = '') {
  const result = {};
  for (const part of String(text).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^col(\d+)\s*:\s*(.+)$/i);
    if (!match) continue;
    result[Number(match[1]) - 1] = match[2].trim();
  }
  return result;
}

function getSectionTemplateName(section) {
  const explicit = section.attrs?.template;
  if (explicit) return String(explicit);
  const classSet = new Set(section.classes || []);
  if (classSet.has('cover')) return 'cover';
  if (
    classSet.has('two-column') ||
    classSet.has('layout-two') ||
    classSet.has('layout-two-column') ||
    Array.from(classSet).some((name) => /(^|\b)(two|three|four|five|six|\d+)-column(\b|$)/.test(name)) ||
    Array.from(classSet).some((name) => /^cols-\d+$/.test(name)) ||
    Number(section.attrs?.columns) > 1 ||
    Number(section.attrs?.cols) > 1
  ) {
    return 'column-layout';
  }
  if (classSet.has('card')) return 'card';
  if (classSet.has('spotlight')) return 'spotlight';
  if (classSet.has('stats') || classSet.has('stats-list')) return 'stats-list';
  if (classSet.has('agenda')) return 'agenda';
  if (classSet.has('timeline')) return 'timeline';
  if (classSet.has('compare')) return 'compare';
  if (classSet.has('quote-slide')) return 'quote-slide';
  if (classSet.has('message')) return 'message';
  return 'default';
}

export function renderDocument(model, options = {}, registry) {
  const theme = options.theme || model.meta.theme || 'report';
  const mode = options.mode || model.meta.mode || 'web';
  const showToc = options.toc ?? Boolean(model.meta.toc);
  const tocDepth = Number(options.tocDepth || model.meta.tocDepth || 3);

  const context = {
    model,
    options,
    registry,
    headingTag: (depth) => `h${Math.min(6, Math.max(1, depth))}`,
    renderSection: (section) => renderSection(section, context),
    renderSectionNoBreak: (section) => renderSection(section, { ...context, disablePageBreakTokens: true }),
    renderChildren: (section) => (section.children || []).map((child) => renderSection(child, { ...context, disablePageBreakTokens: true })).join(''),
    renderBody: (section) => renderBlocks(section.blocks || [], context),
    renderBlocks: (blocks) => renderBlocks(blocks || [], context),
    renderToc: (maxDepth = tocDepth) => renderToc(model.sections, maxDepth),
  };

  const introBlocks = model.root.blocks?.length ? `<section class="document-intro">${context.renderBlocks(model.root.blocks)}</section>` : '';
  const tocHtml = showToc ? context.renderToc(tocDepth) : '';
  const body = model.root.children.map((section) => context.renderSection(section)).join('');
  const composed = `${introBlocks}${tocHtml}${body}`;
  const pages = buildPaginatedSegments(composed, PAGE_BREAK_TOKEN);
  const shellClass = pages.length > 1 ? 'document-shell is-paginated' : 'document-shell';
  const content =
    pages.length > 1
      ? pages
          .map(
            (page, index) => `
        <section class="doc-page" data-page-number="${index + 1}">
          <div class="doc-page-inner">${page}</div>
          <footer class="doc-page-footer">Page ${index + 1}</footer>
        </section>
      `,
          )
          .join('')
      : composed;

  return `
    <div class="studio-document theme-${escapeHtml(theme)} mode-${escapeHtml(mode)}">
      <div class="${shellClass}">
        ${content}
      </div>
    </div>
  `;
}

function renderSection(section, context) {
  if (context?.disablePageBreakTokens) {
    const sanitized = {
      ...section,
      blocks: (section.blocks || []).filter((block) => !isPageBreakBlock(block)),
    };
    return renderSectionOnce(sanitized, context);
  }

  const pageSplit = splitBlocksByPageBreak(section.blocks || []);
  if (pageSplit.length <= 1) {
    return renderSectionOnce(section, context);
  }

  // When a section contains page-break markers, continue the same section style on the next page.
  return pageSplit
    .map((segmentBlocks, index) => {
      const segment = {
        ...section,
        blocks: segmentBlocks,
        // Children are rendered at the tail section chunk to preserve authoring order.
        children: index === pageSplit.length - 1 ? section.children : [],
      };
      return renderSectionOnce(segment, { ...context, disablePageBreakTokens: true });
    })
    .join(PAGE_BREAK_TOKEN);
}

function renderSectionOnce(section, context) {
  const templateName = getSectionTemplateName(section);
  const template = context.registry?.getSectionTemplate?.(templateName) || context.registry?.getSectionTemplate?.('default');
  if (template?.render) return template.render(section, context);
  return renderSectionChrome(section, `${context.renderBody(section)}${context.renderChildren(section)}`, context, 'template-default', {
    hideHeading: false,
    template: 'default',
  });
}

function isPageBreakBlock(block) {
  if (!block || block.type !== 'hr') return false;
  const classList = Array.isArray(block.classes) ? block.classes : [];
  return classList.includes('page-break') || block.attrs?.pagebreak === true || block.attrs?.pagination === true;
}

function splitBlocksByPageBreak(blocks = []) {
  const pages = [[]];
  for (const block of blocks || []) {
    if (isPageBreakBlock(block)) {
      pages.push([]);
      continue;
    }
    pages[pages.length - 1].push(block);
  }
  return pages.filter((page) => page.length > 0);
}

function sectionClassList(section, extraClasses = '') {
  const list = ['md-section', `level-${section.depth}`, ...section.classes.map((name) => `section-${name}`)];
  if (extraClasses) list.push(extraClasses);
  return list.filter(Boolean).join(' ');
}

function sanitizeCssSize(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
  if (/^\d+(\.\d+)?(px|%|vw|vh|rem|em)$/.test(text)) return text;
  return '';
}

function sanitizeOverflow(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'auto' || text === 'scroll' || text === 'hidden') return text;
  return '';
}

function sectionStyleAttr(section) {
  const attrs = section?.attrs || {};
  const vars = [];
  const height = sanitizeCssSize(attrs.height);
  const maxHeight = sanitizeCssSize(attrs.maxHeight);
  const overflow = sanitizeOverflow(attrs.overflow) || (height || maxHeight ? 'auto' : '');
  if (height) vars.push(`--section-height:${escapeHtml(height)};`);
  if (maxHeight) vars.push(`--section-max-height:${escapeHtml(maxHeight)};`);
  if (overflow) vars.push(`--section-overflow:${escapeHtml(overflow)};`);
  return vars.length ? ` style="${vars.join('')}"` : '';
}

function codeStyleAttr(block) {
  const attrs = block?.attrs || {};
  const vars = [];
  const height = sanitizeCssSize(attrs.height);
  const maxHeightInput = sanitizeCssSize(attrs.maxHeight);
  const maxHeight = maxHeightInput || (height ? height : '');
  const overflow = sanitizeOverflow(attrs.overflow);
  if (height) vars.push(`--code-height:${escapeHtml(height)};`);
  if (maxHeight) vars.push(`--code-max-height:${escapeHtml(maxHeight)};`);
  if (overflow) vars.push(`--code-overflow:${escapeHtml(overflow)};`);
  return vars.length ? ` style="${vars.join('')}"` : '';
}

function renderCodeHeader({ title = '', lang = '', enableCopy = true } = {}) {
  const left = [];
  if (title) left.push(`<div class="code-title">${escapeHtml(title)}</div>`);
  if (lang) left.push(`<span class="code-lang">${escapeHtml(lang)}</span>`);
  const copyButton = enableCopy ? '<button type="button" class="code-copy-btn" data-copy-code>복사</button>' : '';
  return `<div class="code-header"><span class="code-meta">${left.join('')}</span>${copyButton}</div>`;
}

function renderSectionHeading(section, context) {
  const Tag = context.headingTag(section.depth);
  const classes = ['section-heading', `level-${section.depth}`];
  if (section.classes.includes('lead')) classes.push('heading-lead');
  return `<${Tag} id="${escapeHtml(section.id)}" class="${classes.join(' ')}">${renderInline(section.title, context)}</${Tag}>`;
}

function renderSectionChrome(section, inner, context, extraClasses = '', meta = {}) {
  const attrId = section.anchorId ? ` id="${escapeHtml(section.anchorId)}"` : '';
  const styleAttr = sectionStyleAttr(section);
  return `
    <section class="${sectionClassList(section, extraClasses)}" data-section-id="${escapeHtml(section.id)}" data-template="${escapeHtml(meta.template || 'default')}"${attrId}${styleAttr}>
      ${meta.hideHeading ? '' : renderSectionHeading(section, context)}
      ${inner}
    </section>
  `;
}

function renderBlocks(blocks, context) {
  return (blocks || []).map((block) => renderBlock(block, context)).join('');
}

function blockIdAttr(block) {
  const attrs = [`data-block-id="${escapeHtml(block.id)}"`];
  if (block.anchorId) attrs.push(`id="${escapeHtml(block.anchorId)}"`);
  return attrs.join(' ');
}

function renderBlock(block, context) {
  const classList = Array.isArray(block.classes) ? block.classes : [];
  if (block.type === 'paragraph') {
    const classes = ['md-paragraph', ...classList.map((name) => `is-${name}`)];
    return `<p class="${classes.join(' ')}" ${blockIdAttr(block)}>${renderInline(block.text, context)}</p>`;
  }
  if (block.type === 'hr') {
    if (classList.includes('page-break') || block.attrs?.pagebreak === true || block.attrs?.pagination === true) {
      if (context?.disablePageBreakTokens) return '';
      return PAGE_BREAK_TOKEN;
    }
    return `<hr class="md-rule" ${blockIdAttr(block)} />`;
  }
  if (block.type === 'list') {
    const renderListItems = (items = []) => {
      return items
        .map((item) => {
          const text = item?.text ?? '';
          const line = item?.isTask
            ? `<label><input class="md-task-checkbox" type="checkbox" disabled${item.checked ? ' checked' : ''} /><span>${renderInline(text, context)}</span></label>`
            : renderInline(text, context);
          const continuation = item?.blocks?.length ? `<div class="md-list-item-body">${renderBlocks(item.blocks, context)}</div>` : '';
          const childTag = item?.children?.[0]?.ordered ? 'ol' : 'ul';
          const children = item?.children?.length
            ? `<${childTag} class="md-list">${renderListItems(item.children)}</${childTag}>`
            : '';
          const itemClass = item?.isTask ? ' class="md-task-item"' : '';
          return `<li${itemClass}>${line}${continuation}${children}</li>`;
        })
        .join('');
    };

    const tag = block.ordered ? 'ol' : 'ul';
    const hasTask = block.items.some((item) => item?.isTask);
    const isTaskList = hasTask && block.items.every((item) => item?.isTask);
    const listClasses = ['md-list', ...classList.map((name) => `is-${name}`)];
    if (isTaskList) listClasses.push('md-task-list');
    return `<${tag} class="${listClasses.join(' ')}" ${blockIdAttr(block)}>${renderListItems(block.items)}</${tag}>`;
  }
  if (block.type === 'blockquote') {
    return `<blockquote class="md-blockquote ${classList.map((name) => `is-${name}`).join(' ')}" ${blockIdAttr(block)}>${renderBlocks(block.blocks, context)}</blockquote>`;
  }
  if (block.type === 'callout') {
    return `
      <aside class="md-callout type-${escapeHtml(block.calloutType)} ${classList.map((name) => `is-${name}`).join(' ')}" ${blockIdAttr(block)}>
        <div class="callout-title">${escapeHtml(block.title)}</div>
        <div class="callout-body">${renderBlocks(block.blocks, context)}</div>
      </aside>
    `;
  }
  if (block.type === 'mermaid') {
    const styleAttr = codeStyleAttr(block);
    const enableCopy = context?.options?.enableCodeCopy !== false;
    if (context?.options?.enableMermaid === false) {
      return `
        <div class="md-code ${classList.map((name) => `is-${name}`).join(' ')}" ${blockIdAttr(block)}${styleAttr}>
          ${renderCodeHeader({ lang: 'mermaid', enableCopy })}
          <pre><code>${escapeHtml(block.value)}</code></pre>
        </div>
      `;
    }
    return `
      <div class="md-code mermaid-block ${classList.map((name) => `is-${name}`).join(' ')}" ${blockIdAttr(block)}${styleAttr}>
        ${renderCodeHeader({ lang: 'mermaid', enableCopy })}
        <pre class="mermaid-source" hidden>${escapeHtml(block.value)}</pre>
        <div class="mermaid-render" aria-label="Mermaid diagram"></div>
        <pre class="mermaid-fallback"><code>${escapeHtml(block.value)}</code></pre>
      </div>
    `;
  }
  if (block.type === 'code') {
    const title = block.attrs?.title || block.title || '';
    const styleAttr = codeStyleAttr(block);
    const enableCopy = context?.options?.enableCodeCopy !== false;
    return `
      <div class="md-code ${classList.map((name) => `is-${name}`).join(' ')}" ${blockIdAttr(block)}${styleAttr}>
        ${renderCodeHeader({ title, lang: block.lang || '', enableCopy })}
        <pre><code>${escapeHtml(block.value)}</code></pre>
      </div>
    `;
  }
  if (block.type === 'image') {
    const resolveAssetUrl = typeof context?.options?.resolveAssetUrl === 'function' ? context.options.resolveAssetUrl : null;
    let resolvedSrc = String(block.src || '');
    let resolveError = false;
    if (resolveAssetUrl) {
      try {
        const result = resolveAssetUrl(resolvedSrc, {
          sourceBaseDir: context?.options?.sourceBaseDir || '',
          block,
          model: context?.model,
        });
        if (typeof result === 'string') {
          resolvedSrc = result;
        } else if (result && typeof result === 'object') {
          resolvedSrc = String(result.src || resolvedSrc);
          resolveError = Boolean(result.error);
        }
      } catch (error) {
        resolveError = true;
      }
    }
    const align = String(block.attrs?.align || (classList.includes('left') ? 'left' : classList.includes('right') ? 'right' : 'center'));
    const widthValue = block.attrs?.width || '';
    const normalizedWidth = typeof widthValue === 'number' ? `${widthValue}%` : String(widthValue || '').trim();
    const caption = block.attrs?.caption || block.alt || '';
    const classes = ['md-figure', `align-${align}`, ...classList.map((name) => `is-${name}`)];
    const style = normalizedWidth ? ` style="--figure-width:${escapeHtml(normalizedWidth)};"` : '';
    const resolveErrorAttr = resolveError ? ' data-src-resolve-error="true"' : '';
    return `
      <figure class="${classes.join(' ')}" ${blockIdAttr(block)}${style}>
        <img src="${escapeHtml(sanitizeUrl(resolvedSrc))}" alt="${escapeHtml(block.alt || caption || '')}" loading="lazy"${resolveErrorAttr} />
        ${caption ? `<figcaption>${renderInline(caption, context)}</figcaption>` : ''}
      </figure>
    `;
  }
  if (block.type === 'table') {
    const tableClasses = ['md-table', ...classList];
    const shellClasses = ['md-table-shell'];
    const caption = block.attrs?.caption || '';
    const alignOverrides = parseColumnMeta(block.attrs?.align || '');
    const widthOverrides = parseColumnMeta(block.attrs?.width || '');
    const emphasis = String(block.attrs?.emphasis || '');
    const emphasisCol = /^col\d+$/i.test(emphasis) ? Number(emphasis.replace(/\D+/g, '')) - 1 : null;
    const emphasisLast = emphasis === 'last-col' || classList.includes('emphasis-last-col');
    if (classList.includes('shadow')) shellClasses.push('shadow-sm');
    if (classList.includes('table-fit') || block.attrs?.fit === true) shellClasses.push('table-fit');

    const colgroup = Object.keys(widthOverrides).length
      ? `<colgroup>${block.headers.map((_, index) => `<col${widthOverrides[index] ? ` style="width:${escapeHtml(widthOverrides[index])}"` : ''} />`).join('')}</colgroup>`
      : '';

    const renderCell = (tag, cell, index) => {
      const align = alignOverrides[index] || block.align[index] || 'left';
      const emphasisClass = (emphasisLast && index === block.headers.length - 1) || emphasisCol === index ? ' is-emphasis' : '';
      return `<${tag} class="align-${escapeHtml(align)}${emphasisClass}">${renderInline(cell, context)}</${tag}>`;
    };

    return `
      <div class="${shellClasses.join(' ')}" ${blockIdAttr(block)}>
        <table class="${tableClasses.join(' ')}">
          ${caption ? `<caption>${renderInline(caption, context)}</caption>` : ''}
          ${colgroup}
          <thead>
            <tr>${block.headers.map((cell, index) => renderCell('th', cell, index)).join('')}</tr>
          </thead>
          <tbody>
            ${block.rows.map((row) => `<tr>${row.map((cell, index) => renderCell('td', cell, index)).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  return '';
}

function renderToc(sections, maxDepth = 3) {
  const eligible = sections.filter((section) => section.depth <= maxDepth);
  if (!eligible.length) return '';
  return `
    <nav class="md-toc" aria-label="목차">
      <div class="toc-title">목차</div>
      <ol>
        ${eligible.map((section) => `<li class="toc-depth-${section.depth}"><a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`).join('')}
      </ol>
    </nav>
  `;
}

function parseColumnCount(section) {
  const attrValue = Number(section?.attrs?.columns || section?.attrs?.cols || 0);
  if (Number.isFinite(attrValue) && attrValue > 1) {
    return Math.min(6, Math.max(2, Math.floor(attrValue)));
  }

  const classList = Array.isArray(section?.classes) ? section.classes : [];
  const wordToNumber = new Map([
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
  ]);
  for (const cls of classList) {
    const lower = String(cls).toLowerCase();
    const wordMatch = lower.match(/^(two|three|four|five|six)-column$/);
    if (wordMatch) return wordToNumber.get(wordMatch[1]);
    const numMatch = lower.match(/^(\d+)-column$/) || lower.match(/^cols-(\d+)$/);
    if (numMatch) {
      const count = Number(numMatch[1]);
      if (count > 1) return Math.min(6, Math.max(2, Math.floor(count)));
    }
  }
  return 2;
}

function splitChildrenForColumns(section, columnCount = 2) {
  const children = section.children || [];
  const count = Math.max(2, Number(columnCount) || 2);
  const columns = Array.from({ length: count }, () => []);
  children.forEach((child, index) => {
    columns[index % count].push(child);
  });
  return columns;
}

function extractStatItems(section) {
  const stats = [];
  const restBlocks = [];
  for (const block of section.blocks || []) {
    if (block.type === 'list') {
      const parsed = block.items
        .map((item) => (item?.text ?? '').split('|').map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && parts.length <= 3 && parts.every(Boolean));
      if (parsed.length === block.items.length && parsed.length > 0) {
        for (const [label, value, delta = ''] of parsed) {
          stats.push({ label, value, delta });
        }
        continue;
      }
    }
    if (block.type === 'table' && block.headers.length >= 2 && block.rows.length > 0) {
      for (const row of block.rows) {
        const [label, value = '', delta = ''] = row;
        stats.push({ label, value, delta });
      }
      continue;
    }
    restBlocks.push(block);
  }
  return { stats, restBlocks };
}

export function registerBuiltInTemplates(registry) {
  registry.registerSectionTemplate({
    name: 'default',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      return renderSectionChrome(section, `${body}${children}`, context, 'template-default', { template: 'default' });
    },
  });

  registry.registerSectionTemplate({
    name: 'agenda',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      const inner = `${renderSectionHeading(section, context)}${body}${children}`;
      return renderSectionChrome(section, inner, context, 'template-agenda', { hideHeading: true, template: 'agenda' });
    },
  });

  registry.registerSectionTemplate({
    name: 'timeline',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      const inner = `${renderSectionHeading(section, context)}${body}${children}`;
      return renderSectionChrome(section, inner, context, 'template-timeline', { hideHeading: true, template: 'timeline' });
    },
  });

  registry.registerSectionTemplate({
    name: 'compare',
    render(section, context) {
      const sectionWithCols = { ...section, attrs: { ...(section.attrs || {}), cols: 2 } };
      const columnTemplate = context.registry?.getSectionTemplate?.('column-layout');
      const rendered = columnTemplate?.render ? columnTemplate.render(sectionWithCols, context) : '';
      return rendered.replace('template-columns', 'template-columns template-compare');
    },
  });

  registry.registerSectionTemplate({
    name: 'quote-slide',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      const inner = `${renderSectionHeading(section, context)}${body}${children}`;
      return renderSectionChrome(section, inner, context, 'template-quote-slide', { hideHeading: true, template: 'quote-slide' });
    },
  });

  registry.registerSectionTemplate({
    name: 'message',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      const inner = `<div class="message-shell">${renderSectionHeading(section, context)}${body}${children}</div>`;
      return renderSectionChrome(section, inner, context, 'template-message', { hideHeading: true, template: 'message' });
    },
  });

  registry.registerSectionTemplate({
    name: 'cover',
    render(section, context) {
      const eyebrow = section.attrs?.eyebrow || context.model.meta.eyebrow || context.model.meta.team || 'Document';
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      const inner = `
        <div class="cover-shell">
          <div class="cover-eyebrow">${escapeHtml(eyebrow)}</div>
          ${renderSectionHeading(section, context)}
          <div class="cover-body">${body}${children}</div>
        </div>
      `;
      return renderSectionChrome(section, inner, context, 'template-cover', { hideHeading: true, template: 'cover' });
    },
  });

  registry.registerSectionTemplate({
    name: 'column-layout',
    render(section, context) {
      const columnCount = parseColumnCount(section);
      const columns = splitChildrenForColumns(section, columnCount);
      const body = context.renderBody(section);
      const columnsHtml = columns
        .map((items, index) => `<div class="column column-${index + 1}">${items.map((child) => context.renderSectionNoBreak(child)).join('')}</div>`)
        .join('');
      const inner = `
        ${renderSectionHeading(section, context)}
        ${body}
        <div class="multi-column-grid" style="--column-count:${columnCount};">
          ${columnsHtml}
        </div>
      `;
      return renderSectionChrome(section, inner, context, `template-columns cols-${columnCount}`, {
        hideHeading: true,
        template: 'column-layout',
      });
    },
  });

  // Backward compatibility for older documents using explicit two-column template name.
  registry.registerSectionTemplate({
    name: 'two-column',
    render(section, context) {
      const sectionWithCols = { ...section, attrs: { ...(section.attrs || {}), cols: section.attrs?.cols || 2 } };
      return registry.getSectionTemplate('column-layout').render(sectionWithCols, context);
    },
  });

  registry.registerSectionTemplate({
    name: 'card',
    render(section, context) {
      const body = context.renderBody(section);
      const children = context.renderChildren(section);
      return renderSectionChrome(section, `<div class="section-card">${renderSectionHeading(section, context)}${body}${children}</div>`, context, 'template-card', {
        hideHeading: true,
        template: 'card',
      });
    },
  });

  registry.registerSectionTemplate({
    name: 'spotlight',
    render(section, context) {
      const [first, ...rest] = section.blocks || [];
      const lead = first ? `<div class="spotlight-lead">${renderBlock(first, context)}</div>` : '';
      const body = rest.length ? context.renderBlocks(rest) : '';
      const children = context.renderChildren(section);
      const inner = `${renderSectionHeading(section, context)}${lead}${body}${children}`;
      return renderSectionChrome(section, inner, context, 'template-spotlight', { hideHeading: true, template: 'spotlight' });
    },
  });

  registry.registerSectionTemplate({
    name: 'stats-list',
    render(section, context) {
      const { stats, restBlocks } = extractStatItems(section);
      const body = restBlocks.length ? context.renderBlocks(restBlocks) : '';
      const children = context.renderChildren(section);
      const statsHtml = stats.length
        ? `<div class="stats-grid">${stats
            .map(
              (item) => `
                <article class="stat-card">
                  <div class="stat-label">${escapeHtml(item.label)}</div>
                  <div class="stat-value">${escapeHtml(item.value)}</div>
                  ${item.delta ? `<div class="stat-delta ${/^[-]/.test(item.delta) ? 'negative' : 'positive'}">${escapeHtml(item.delta)}</div>` : ''}
                </article>
              `,
            )
            .join('')}</div>`
        : '';
      const inner = `${renderSectionHeading(section, context)}${statsHtml}${body}${children}`;
      return renderSectionChrome(section, inner, context, 'template-stats-list', { hideHeading: true, template: 'stats-list' });
    },
  });
}
