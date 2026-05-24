import { getBrandDesign, normalizeBrandDesignSlug } from './brand-designs.js';

export function analyzeMarkdownQuality(source = '', model = null) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const issues = [];

  const add = (level, title, detail, line = 0) => {
    issues.push({ level, title, detail, line });
  };

  const headings = [];
  let inFence = false;
  let fenceLine = 0;
  let rawDetailsOpenLine = 0;
  let paragraphStart = 0;
  let paragraph = [];

  const flushParagraph = (endLine) => {
    const value = paragraph.join(' ').trim();
    if (value.length > 280) {
      add('info', '긴 문단', '한 문단이 길어 스캔성이 떨어질 수 있습니다. 핵심 문장과 근거 목록으로 나누는 것을 검토하세요.', paragraphStart);
    }
    paragraph = [];
    paragraphStart = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] || '';
    const trimmed = line.trim();
    const fence = trimmed.match(/^(```+|~~~+)\s*(.*)$/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLine = lineNumber;
        if (!String(fence[2] || '').trim()) {
          add('info', '코드 언어 누락', '코드블록에 언어를 적으면 문서 가독성과 복사 후 재사용성이 좋아집니다.', lineNumber);
        }
      } else {
        inFence = false;
      }
      flushParagraph(lineNumber);
      continue;
    }

    if (inFence) continue;

    if (/<details(?:\s[^>]*)?>/i.test(trimmed)) {
      add('warn', 'HTML details 변환', '`<details>/<summary>`는 미리보기에서 정적 callout으로 변환됩니다. 새 문서에서는 `[!NOTE]`, `.message`, `.card`, 또는 별도 페이지를 사용하세요.', lineNumber);
      if (!/<\/details\s*>/i.test(trimmed)) rawDetailsOpenLine = lineNumber;
    }
    if (rawDetailsOpenLine && /<\/details\s*>/i.test(trimmed)) {
      rawDetailsOpenLine = 0;
    }
    if (/<summary(?:\s[^>]*)?>/i.test(trimmed) && !rawDetailsOpenLine && !/<details(?:\s[^>]*)?>/i.test(trimmed)) {
      add('warn', 'HTML summary 단독 사용', '`<summary>`는 단독 Markdown 문법이 아닙니다. 제목 문장이나 callout 제목으로 바꾸세요.', lineNumber);
    }
    const unsupportedHtml = findUnsupportedHtml(trimmed);
    for (const tag of unsupportedHtml) {
      const severe = /^(iframe|script|style|video)$/i.test(tag);
      add(
        severe ? 'error' : 'warn',
        '지원하지 않는 raw HTML',
        `MPS Markdown은 <${tag}> HTML 태그를 렌더 문법으로 지원하지 않습니다. Markdown 문법이나 제공 템플릿으로 바꾸세요.`,
        lineNumber,
      );
    }

    const heading = trimmed.match(/^(#{1,6})\s*(.*)$/);
    if (heading) {
      flushParagraph(lineNumber);
      const depth = heading[1].length;
      const title = heading[2].replace(/\{[^{}]*\}\s*$/, '').trim();
      if (!title) add('warn', '빈 제목', '빈 heading은 outline과 내보내기 품질을 떨어뜨립니다.', lineNumber);
      const previous = headings[headings.length - 1];
      if (previous && depth > previous.depth + 1) {
        add('warn', 'Heading 단계 건너뜀', `H${previous.depth} 다음에 H${depth}가 나옵니다. 중간 단계 제목을 추가하거나 레벨을 낮추세요.`, lineNumber);
      }
      headings.push({ depth, title, line: lineNumber });
      continue;
    }

    if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed) && /^!\[\s*\]/.test(trimmed)) {
      add('warn', '이미지 alt 누락', '이미지 의미를 설명하는 alt 텍스트를 넣으면 접근성과 저장 HTML 품질이 좋아집니다.', lineNumber);
    }

    if (/^\|.*\|$/.test(trimmed)) {
      const cells = splitTableRow(trimmed);
      if (cells.length >= 6) {
        add('warn', '넓은 표', '열이 많은 표는 landscape, .table-fit, 또는 페이지 분리를 검토하세요.', lineNumber);
      }
      if (cells.some((cell) => cell.length > 80)) {
        add('info', '표 안 긴 문장', '표 셀 문장이 길면 카드/목록 구조가 더 읽기 좋을 수 있습니다.', lineNumber);
      }
      flushParagraph(lineNumber);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph(lineNumber);
      continue;
    }

    if (!trimmed || /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^>\s?/.test(trimmed)) {
      flushParagraph(lineNumber);
      continue;
    }

    if (!paragraph.length) paragraphStart = lineNumber;
    paragraph.push(trimmed);
  }
  flushParagraph(lines.length);

  if (inFence) add('error', '닫히지 않은 코드블록', `L${fenceLine}에서 시작한 코드블록이 닫히지 않았습니다.`, fenceLine);
  if (rawDetailsOpenLine) add('error', '닫히지 않은 details 블록', `L${rawDetailsOpenLine}에서 시작한 <details> 블록이 </details>로 닫히지 않았습니다.`, rawDetailsOpenLine);
  if (!headings.length && text.trim()) add('warn', '제목 없음', '문서에 heading이 없어 outline과 페이지 구조를 만들기 어렵습니다.', 1);

  const tables = (model?.blocks || []).filter((block) => block.type === 'table');
  for (const table of tables) {
    if ((table.rows || []).length >= 12) {
      add('warn', '긴 표', '행이 많은 표는 앞쪽 page-break와 caption을 함께 검토하세요.', 0);
    }
  }

  const pageBreakCount = (text.match(/\{: ?\.page-break/g) || []).length;
  if (headings.length >= 5 && pageBreakCount === 0) {
    add('info', '페이지 분리 후보', '섹션이 많은 문서입니다. 핵심 요약, 데이터, 결론 앞 page-break를 검토하세요.', 0);
  }

  const designValue = model?.meta?.design || model?.meta?.designMd || '';
  if (designValue) {
    const normalizedDesign = normalizeBrandDesignSlug(designValue);
    const design = getBrandDesign(designValue);
    if (!normalizedDesign || !design) {
      add('warn', '알 수 없는 DESIGN.md preset', `"${designValue}"는 수집된 70개 DESIGN.md manifest에 없는 slug입니다. theme fallback은 유지되지만 브랜드 토큰은 적용되지 않습니다.`, 0);
    }
  }

  issues.sort((a, b) => severityValue(b.level) - severityValue(a.level) || (a.line || 999999) - (b.line || 999999));

  return {
    score: Math.max(0, 100 - issues.reduce((sum, issue) => sum + severityPenalty(issue.level), 0)),
    issues,
  };
}

function severityValue(level) {
  if (level === 'error') return 3;
  if (level === 'warn') return 2;
  return 1;
}

function severityPenalty(level) {
  if (level === 'error') return 24;
  if (level === 'warn') return 12;
  return 5;
}

function splitTableRow(line = '') {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function findUnsupportedHtml(line = '') {
  const tags = [];
  const re = /<\/?(div|span|br|video|iframe|script|style)\b[^>]*>/gi;
  let match;
  while ((match = re.exec(String(line || '')))) {
    const tag = String(match[1] || '').toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
