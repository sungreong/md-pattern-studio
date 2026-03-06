import { parseMarkdownDocument, renderDocument, registerBuiltInTemplates, escapeHtml, splitSourceByPageBreak } from '/core/engine.js';
import { TemplateRegistry } from '/core/registry.js';
import { buildStandaloneHtmlDocument } from '/core/export-standalone.js';

const STORAGE_KEY_MD = 'markdown-pattern-studio:markdown';
const STORAGE_KEY_THEME = 'markdown-pattern-studio:theme';
const STORAGE_KEY_SOURCE_BASE = 'markdown-pattern-studio:source-base';

const registry = new TemplateRegistry();
registerBuiltInTemplates(registry);

const dom = {
  statusText: document.getElementById('statusText'),
  editorModePill: document.getElementById('editorModePill'),
  themeSelect: document.getElementById('themeSelect'),
  loadSampleBtn: document.getElementById('loadSampleBtn'),
  openMdBtn: document.getElementById('openMdBtn'),
  openMdInput: document.getElementById('openMdInput'),
  saveMdBtn: document.getElementById('saveMdBtn'),
  saveHtmlBtn: document.getElementById('saveHtmlBtn'),
  snippetGrid: document.getElementById('snippetGrid'),
  patternGuide: document.getElementById('patternGuide'),
  outlineList: document.getElementById('outlineList'),
  refreshOutlineBtn: document.getElementById('refreshOutlineBtn'),
  editorRoot: document.getElementById('editorRoot'),
  editorFallback: document.getElementById('editorFallback'),
  editorMeta: document.getElementById('editorMeta'),
  cursorMeta: document.getElementById('cursorMeta'),
  documentMeta: document.getElementById('documentMeta'),
  currentSectionBadge: document.getElementById('currentSectionBadge'),
  previewRoot: document.getElementById('previewRoot'),
  previewSource: document.getElementById('previewSource'),
  previewModeButtons: document.getElementById('previewModeButtons'),
  slideControls: document.getElementById('slideControls'),
  prevSlideBtn: document.getElementById('prevSlideBtn'),
  nextSlideBtn: document.getElementById('nextSlideBtn'),
  slideMeta: document.getElementById('slideMeta'),
};

const state = {
  source: '',
  model: null,
  view: null,
  editorKind: 'loading',
  previewMode: 'rendered',
  slideIndex: 0,
  renderedHtml: '',
  selectedSectionId: '',
  themeOverride: localStorage.getItem(STORAGE_KEY_THEME) || 'auto',
  sourceBaseDir: localStorage.getItem(STORAGE_KEY_SOURCE_BASE) || '',
  renderTimer: null,
  statusTimer: null,
};

const DEFAULT_PAGE_WIDTH = '1120px';
const DEFAULT_PAGE_HEIGHT = '720px';

const THEMES = [
  { value: 'auto', label: 'front matter 따르기' },
  { value: 'report', label: 'report' },
  { value: 'default', label: 'default' },
  { value: 'slate', label: 'slate' },
  { value: 'paper', label: 'paper' },
  { value: 'forest', label: 'forest' },
  { value: 'sunset', label: 'sunset' },
  { value: 'ocean', label: 'ocean' },
  { value: 'mono', label: 'mono' },
];

const SNIPPETS = [
  {
    name: 'h2',
    label: 'H2 섹션',
    description: '일반 섹션을 추가합니다.',
    text: '\n## 새 섹션\n\n내용을 입력하세요.\n',
  },
  {
    name: 'cover',
    label: 'Cover',
    description: '커버 섹션 속성 예시를 삽입합니다.',
    text: '\n# 문서 제목 {#cover .cover eyebrow="Monthly Report"}\n\n첫 문단을 작성하세요.\n',
  },
  {
    name: 'two-column',
    label: '2단 섹션',
    description: '부모 섹션의 하위 섹션 2개를 좌우 컬럼으로 배치합니다.',
    text: '\n## 핵심 요약 {#summary .two-column}\n\n### 왼쪽 섹션\n- 항목 A\n- 항목 B\n\n### 오른쪽 섹션\n설명을 입력하세요.\n',
  },
  {
    name: 'stats',
    label: 'Stats',
    description: '리스트를 KPI 카드로 렌더합니다.',
    text: '\n### 핵심 KPI {#kpi .stats}\n- 전환율 | 4.1% | +0.8%p\n- 매출 | 1.24억 | +18%\n- 활성 사용자 | 1,480 | +23%\n',
  },
  {
    name: 'callout',
    label: 'Callout',
    description: '옵시디안 스타일 callout 입니다.',
    text: '\n> [!INFO] 메모\n> 강조하고 싶은 내용을 적으세요.\n',
  },
  {
    name: 'table',
    label: '표 + 속성',
    description: '표와 아래 속성 줄을 같이 삽입합니다.',
    text: '\n| 항목 | 목표 | 실적 |\n| --- | ---: | ---: |\n| 매출 | 100 | 124 |\n| 전환율 | 3.2 | 4.1 |\n{: .zebra .bordered .compact caption="월별 성과 비교" emphasis="last-col"}\n',
  },
  {
    name: 'image',
    label: '이미지 + 속성',
    description: '이미지와 속성 줄을 삽입합니다.',
    text: '\n![차트 설명](https://dummyimage.com/1200x520/e5eefc/1f3b7a.png&text=KPI+Chart)\n{: width="88%" align="center" caption="이미지 캡션"}\n',
  },
  {
    name: 'code',
    label: '코드 블록',
    description: '코드 블록과 title 속성 예시를 삽입합니다.',
    text: '\n```js title="preview-pipeline.js"\nfunction renderPreview(markdown) {\n  return markdown;\n}\n```\n',
  },
  {
    name: 'title-slide',
    label: 'Title Slide',
    description: '표지/타이틀 슬라이드를 삽입합니다.',
    text: '\n# 발표 제목 {#title .cover eyebrow="Presentation"}\n\n부제와 핵심 메시지를 쓰세요.\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'agenda-slide',
    label: 'Agenda',
    description: '아젠다(목차) 슬라이드를 삽입합니다.',
    text: '\n## Agenda {#agenda .agenda}\n- 1. 배경\n- 2. 핵심 지표\n- 3. 실행 계획\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'message-slide',
    label: 'Key Message',
    description: '한 줄 핵심 메시지 슬라이드를 삽입합니다.',
    text: '\n## 핵심 메시지 {#message .message}\n문제를 해결하는 가장 중요한 문장을 여기에 씁니다.\n{: .lead}\n\n- 근거 1\n- 근거 2\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'compare-slide',
    label: 'Compare 2-up',
    description: '좌우 비교 슬라이드(2단)를 삽입합니다.',
    text: '\n## 전/후 비교 {#compare .compare}\n\n### As-Is\n- 현재 상태 A\n- 현재 상태 B\n\n### To-Be\n- 개선 안 A\n- 개선 안 B\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'timeline-slide',
    label: 'Timeline',
    description: '단계별 일정 슬라이드를 삽입합니다.',
    text: '\n## 실행 타임라인 {#timeline .timeline}\n- 1주차 | 요건 정리\n- 2주차 | 시안 제작\n- 3주차 | 검증/피드백\n- 4주차 | 배포\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'data-slide',
    label: 'Data Slide',
    description: '표 중심 데이터 슬라이드를 삽입합니다.',
    text: '\n## 데이터 하이라이트 {#data .card}\n\n| 항목 | 목표 | 실적 |\n| --- | ---: | ---: |\n| 매출 | 100 | 124 |\n| 전환율 | 3.2 | 4.1 |\n{: .zebra .bordered .compact .table-fit caption="월별 성과" emphasis="last-col"}\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'quote-slide',
    label: 'Quote Slide',
    description: '인용/핵심 발언 슬라이드를 삽입합니다.',
    text: '\n## 고객 멘트 {#quote .quote-slide}\n\n> [!INFO] Voice of Customer\n> 이 기능 덕분에 작업 시간이 절반으로 줄었어요.\n\n---\n{: .page-break}\n\n',
  },
  {
    name: 'qa-slide',
    label: 'Q&A',
    description: '마무리 Q&A 슬라이드를 삽입합니다.',
    text: '\n## Q&A {#qa .message}\n궁금한 사항을 자유롭게 질문해주세요.\n',
  },
  {
    name: 'page-break',
    label: 'Page Break',
    description: 'HTML 미리보기/저장에서 페이지를 분리하는 마커를 삽입합니다.',
    text: '\n---\n{: .page-break}\n\n',
  },
];

const PATTERN_GUIDE = [
  {
    title: '커버 섹션',
    note: 'heading 뒤에 .cover 와 eyebrow 속성을 넣으면 표지처럼 렌더됩니다.',
    snippet: '# 2026년 3월 운영 보고서 {#cover .cover eyebrow="Monthly Report"}',
  },
  {
    title: '2단 레이아웃',
    note: '부모 섹션에 .two-column 을 주고 하위 섹션 2개를 작성하면 좌우 배치됩니다.',
    snippet: '## 핵심 요약 {#summary .two-column}\n\n### 핵심 KPI\n...\n\n### 분석 요약\n...',
  },
  {
    title: 'KPI 카드',
    note: '리스트 항목을 label | value | delta 형식으로 쓰고 .stats 를 주면 카드로 변환됩니다.',
    snippet: '### 핵심 KPI {#kpi .stats}\n- 전환율 | 4.1% | +0.8%p\n- 매출 | 1.24억 | +18%',
  },
  {
    title: '표 옵션',
    note: '표 바로 아래 {: ... } 한 줄로 줄무늬, 캡션, 강조 컬럼을 지정합니다.',
    snippet: '{: .zebra .bordered .compact caption="월별 성과 비교" emphasis="last-col"}',
  },
  {
    title: '이미지 옵션',
    note: '이미지 아래 {: width="88%" align="center" caption="..." } 식으로 씁니다.',
    snippet: '{: width="88%" align="center" caption="차트 캡션"}',
  },
  {
    title: 'Callout',
    note: '옵시디안과 비슷하게 > [!INFO] 형식으로 씁니다.',
    snippet: '> [!INFO] 메모\n> 강조할 메시지',
  },
  {
    title: '페이지 분리',
    note: '--- 아래에 {: .page-break} 를 두면 HTML이 다음 페이지로 나뉩니다.',
    snippet: '---\n{: .page-break}',
  },
  {
    title: 'Agenda Slide',
    note: '의제를 3~5개 범주로 정리할 때 사용합니다.',
    snippet: '## Agenda {#agenda .agenda}\n- 1. 배경\n- 2. 지표\n- 3. 실행',
  },
  {
    title: 'Key Message',
    note: '첫 문장 하나로 핵심을 전달하고 {: .lead}로 강조합니다.',
    snippet: '## 핵심 메시지 {#message .message}\n핵심 문장\n{: .lead}',
  },
  {
    title: 'Data Slide',
    note: '큰 표는 .table-fit으로 축소 우선 + 스크롤 fallback을 적용합니다.',
    snippet: '{: .zebra .bordered .compact .table-fit caption="성과 표"}',
  },
];

boot();

async function boot() {
  populateThemeSelect();
  renderSnippetGrid();
  renderPatternGuide();
  bindEvents();
  await restoreOrLoadSample();
  await initEditor();
  render();
}

function populateThemeSelect() {
  dom.themeSelect.innerHTML = THEMES.map((theme) => `<option value="${theme.value}">${theme.label}</option>`).join('');
  dom.themeSelect.value = THEMES.some((theme) => theme.value === state.themeOverride) ? state.themeOverride : 'auto';
}

function renderSnippetGrid() {
  dom.snippetGrid.innerHTML = SNIPPETS.map((snippet) => `<button type="button" data-snippet="${snippet.name}" title="${escapeHtml(snippet.description)}">${escapeHtml(snippet.label)}</button>`).join('');
}

function renderPatternGuide() {
  dom.patternGuide.innerHTML = PATTERN_GUIDE.map((item, index) => `
    <details class="pattern-card" ${index === 0 ? 'open' : ''}>
      <summary>
        <strong>${escapeHtml(item.title)}</strong>
      </summary>
      <p>${escapeHtml(item.note)}</p>
      <pre>${escapeHtml(item.snippet)}</pre>
    </details>
  `).join('');
}

function bindEvents() {
  dom.themeSelect.addEventListener('change', () => {
    state.themeOverride = dom.themeSelect.value;
    localStorage.setItem(STORAGE_KEY_THEME, state.themeOverride);
    render();
  });

  dom.loadSampleBtn.addEventListener('click', async () => {
    await loadSample();
    setSource(state.source);
    render();
  });

  dom.openMdBtn.addEventListener('click', () => dom.openMdInput.click());
  dom.openMdInput.addEventListener('change', async () => {
    const file = dom.openMdInput.files?.[0];
    if (!file) return;
    state.source = await file.text();
    state.sourceBaseDir = deriveSourceBaseFromFile(file) || '';
    if (state.sourceBaseDir) {
      localStorage.setItem(STORAGE_KEY_SOURCE_BASE, state.sourceBaseDir);
    } else {
      localStorage.removeItem(STORAGE_KEY_SOURCE_BASE);
      console.warn('[source-base-unavailable] browser file input does not expose full directory path');
    }
    setSource(state.source);
    persist();
    render();
    dom.openMdInput.value = '';
  });

  dom.saveMdBtn.addEventListener('click', () => {
    downloadFile('document.md', getSource(), 'text/markdown;charset=utf-8');
  });

  dom.saveHtmlBtn.addEventListener('click', async () => {
    const html = await buildStandaloneHtml();
    downloadFile('document.html', html, 'text/html;charset=utf-8');
  });

  dom.snippetGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-snippet]');
    if (!button) return;
    const snippet = SNIPPETS.find((item) => item.name === button.dataset.snippet);
    if (!snippet) return;
    insertText(snippet.text);
  });

  dom.refreshOutlineBtn.addEventListener('click', () => renderOutline());

  dom.outlineList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-section-id]');
    if (!button) return;
    revealSection(button.dataset.sectionId);
  });

  dom.previewModeButtons.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-preview-mode]');
    if (!button) return;
    state.previewMode = button.dataset.previewMode;
    if (state.previewMode === 'slides') {
      state.slideIndex = 0;
    }
    updatePreviewMode();
  });

  dom.previewRoot.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-code]');
    if (copyButton) {
      event.preventDefault();
      handleCodeCopyClick(copyButton);
      return;
    }
    const section = event.target.closest('[data-section-id]');
    if (!section) return;
    revealSection(section.dataset.sectionId, { scrollPreview: false });
  });

  dom.prevSlideBtn?.addEventListener('click', () => {
    moveSlide(-1);
  });

  dom.nextSlideBtn?.addEventListener('click', () => {
    moveSlide(1);
  });

  window.addEventListener('keydown', (event) => {
    const key = String(event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      state.source = getSource();
      persist();
      flashStatus('\uBB38\uC11C \uC800\uC7A5\uB428 (local)');
      return;
    }

    if (state.previewMode !== 'slides') return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      moveSlide(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      moveSlide(-1);
    }
  });
  window.addEventListener('resize', () => {
    applySlideContainScale();
  });
}

async function restoreOrLoadSample() {
  const stored = localStorage.getItem(STORAGE_KEY_MD);
  if (stored) {
    state.source = stored;
    return;
  }
  try {
    await loadSample();
  } catch (error) {
    console.warn('Sample load failed, using empty document', error);
    state.source = '';
  }
}

async function loadSample() {
  state.source = await fetch('/examples/sample.md').then((res) => res.text());
  state.sourceBaseDir = '';
  localStorage.removeItem(STORAGE_KEY_SOURCE_BASE);
  persist();
}

async function initEditor() {
  // Keep the editor writable immediately, then upgrade to CodeMirror if available.
  initTextareaFallback();
  const cm = await loadCodeMirror();
  if (!cm) return;
  initCodeMirror(cm);
}

async function loadCodeMirror() {
  try {
    // Load all CM modules with a single @codemirror/state lineage.
    const loader = Promise.all([
      import('https://esm.sh/@codemirror/state@6.4.1'),
      import('https://esm.sh/@codemirror/view@6.28.6?deps=@codemirror/state@6.4.1'),
      import('https://esm.sh/@codemirror/commands@6.6.0?deps=@codemirror/state@6.4.1,@codemirror/view@6.28.6'),
      import('https://esm.sh/@codemirror/lang-markdown@6.2.5?deps=@codemirror/state@6.4.1,@codemirror/view@6.28.6'),
    ]);
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('CodeMirror load timeout')), 3000);
    });
    const [stateModule, viewModule, commandsModule, markdownModule] = await Promise.race([loader, timeout]);
    return { ...stateModule, ...viewModule, ...commandsModule, ...markdownModule };
  } catch (error) {
    console.error('CodeMirror load failed', error);
    return null;
  }
}

function initCodeMirror(cm) {
  const { EditorState, EditorView, keymap, markdown, defaultKeymap, historyKeymap, indentWithTab, insertNewlineAndIndent, insertNewlineContinueMarkup } = cm;
  const editorTheme = EditorView.theme(
    {
      '&': {
        height: '100%',
        color: '#edf3ff',
        backgroundColor: 'transparent',
        fontSize: '14px',
      },
      '.cm-scroller': {
        fontFamily: 'var(--editor-font)',
        lineHeight: '1.75',
      },
      '.cm-content': {
        padding: '18px 0 28px',
        caretColor: '#9fb9ff',
      },
      '.cm-line': {
        padding: '0 16px',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: '#52637f',
        border: 'none',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(111, 149, 255, 0.08)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(111, 149, 255, 0.08)',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(111, 149, 255, 0.24)',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#9fb9ff',
      },
      '.cm-panels, .cm-tooltip': {
        backgroundColor: '#172134',
        color: '#e8eef9',
        border: '1px solid rgba(111, 149, 255, 0.18)',
      },
    },
    { dark: true },
  );

  state.view = new EditorView({
    state: EditorState.create({
      doc: state.source,
      extensions: [
        markdown(),
        editorTheme,
        keymap.of([
          {
            key: 'Enter',
            run: (view) => {
              if (typeof insertNewlineContinueMarkup === 'function' && insertNewlineContinueMarkup(view)) return true;
              if (typeof insertNewlineAndIndent === 'function') return insertNewlineAndIndent(view);
              return false;
            },
          },
          ...(indentWithTab ? [indentWithTab] : []),
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            state.source = update.state.doc.toString();
            persist();
            scheduleRender();
          }
          if (update.docChanged || update.selectionSet) {
            updateCursorMeta();
            syncActiveSectionFromCursor();
          }
        }),
      ],
    }),
    parent: dom.editorRoot,
  });

  state.editorKind = 'codemirror';
  dom.editorRoot.hidden = false;
  dom.editorFallback.hidden = true;
  dom.statusText.textContent = '실시간 렌더 준비 완료';
  dom.editorModePill.textContent = 'CodeMirror 6';
  updateCursorMeta();
}

function initTextareaFallback() {
  dom.editorFallback.hidden = false;
  dom.editorRoot.hidden = true;
  dom.editorFallback.value = state.source;
  dom.editorFallback.addEventListener('input', () => {
    state.source = dom.editorFallback.value;
    persist();
    scheduleRender();
  });
  dom.editorFallback.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.isComposing) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const input = dom.editorFallback;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const value = input.value || '';
    const tabText = '  ';
    if (!event.shiftKey) {
      input.value = `${value.slice(0, start)}${tabText}${value.slice(end)}`;
      const next = start + tabText.length;
      input.selectionStart = next;
      input.selectionEnd = next;
      state.source = input.value;
      persist();
      scheduleRender();
      return;
    }

    const selected = value.slice(start, end);
    const hasSelection = end > start;
    if (!hasSelection) {
      if (value.slice(Math.max(0, start - tabText.length), start) === tabText) {
        input.value = `${value.slice(0, start - tabText.length)}${value.slice(start)}`;
        const next = Math.max(0, start - tabText.length);
        input.selectionStart = next;
        input.selectionEnd = next;
      }
      state.source = input.value;
      persist();
      scheduleRender();
      return;
    }

    const lines = selected.split('\n');
    const outdented = lines
      .map((line) => {
        if (line.startsWith(tabText)) return line.slice(tabText.length);
        if (line.startsWith('\t')) return line.slice(1);
        return line;
      })
      .join('\n');
    input.value = `${value.slice(0, start)}${outdented}${value.slice(end)}`;
    input.selectionStart = start;
    input.selectionEnd = start + outdented.length;
    state.source = input.value;
    persist();
    scheduleRender();
  });
  dom.editorFallback.addEventListener('keyup', () => {
    updateCursorMeta();
    syncActiveSectionFromCursor();
  });
  dom.editorFallback.addEventListener('click', () => {
    updateCursorMeta();
    syncActiveSectionFromCursor();
  });
  state.editorKind = 'textarea';
  dom.statusText.textContent = 'CodeMirror 로드 실패, textarea fallback 사용 중';
  dom.editorModePill.textContent = 'Fallback';
  updateCursorMeta();
}

function getSource() {
  if (state.view) return state.view.state.doc.toString();
  return dom.editorFallback.value || state.source;
}

function setSource(value) {
  const text = String(value || '');
  state.source = text;
  if (state.view) {
    const current = state.view.state.doc.toString();
    if (current !== text) {
      state.view.dispatch({
        changes: { from: 0, to: state.view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
  } else {
    dom.editorFallback.value = text;
  }
  updateCursorMeta();
}

function insertText(text) {
  if (state.view) {
    const selection = state.view.state.selection.main;
    state.view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      scrollIntoView: true,
    });
    state.view.focus();
    return;
  }

  const input = dom.editorFallback;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const next = input.value.slice(0, start) + text + input.value.slice(end);
  input.value = next;
  input.selectionStart = input.selectionEnd = start + text.length;
  state.source = next;
  persist();
  render();
  input.focus();
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(render, 110);
}

function flashStatus(message, duration = 1400) {
  clearTimeout(state.statusTimer);
  dom.statusText.textContent = message;
  state.statusTimer = setTimeout(() => {
    if (dom.statusText.textContent === message) {
      dom.statusText.textContent = '\uC2E4\uC2DC\uAC04 \uB80C\uB354 \uC644\uB8CC';
    }
  }, duration);
}

function isAbsoluteAssetPath(value = '') {
  const text = String(value || '').trim();
  return /^(https?:|data:|blob:|file:)/i.test(text) || text.startsWith('/');
}

function deriveSourceBaseFromFile(file) {
  const directPath = String(file?.path || '').trim();
  if (directPath) {
    return directPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  }
  const relativePath = String(file?.webkitRelativePath || '').trim();
  if (relativePath.includes('/')) {
    return relativePath.replace(/\/[^/]+$/, '');
  }
  return '';
}

function createBrowserAssetResolver(sourceBaseDir) {
  const base = String(sourceBaseDir || '').trim();
  return (rawSrc) => {
    const src = String(rawSrc || '').trim();
    if (!src) return { src, error: true };
    if (isAbsoluteAssetPath(src)) return { src, error: false };
    if (!base) return { src, error: false };
    try {
      const normalizedBaseRaw = base.replace(/\\/g, '/');
      const normalizedBase = /^(file:|https?:)/i.test(normalizedBaseRaw)
        ? normalizedBaseRaw
        : /^[A-Za-z]:\//.test(normalizedBaseRaw)
          ? `file:///${normalizedBaseRaw}`
          : normalizedBaseRaw;
      if (!/^(file:|https?:)/i.test(normalizedBase) && !normalizedBase.startsWith('/')) {
        return { src: `${normalizedBase.replace(/\/+$/, '')}/${src.replace(/^\/+/, '')}`, error: false };
      }
      const withSlash = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
      return { src: new URL(src, withSlash).href, error: false };
    } catch (error) {
      try {
        return { src: `${base.replace(/\/+$/, '')}/${src.replace(/^\/+/, '')}`, error: false };
      } catch (nestedError) {
        console.warn('[asset-resolve-failed]', nestedError);
        return { src, error: true };
      }
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

function extractDocumentShellContent(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  const shell = template.content.querySelector('.studio-document > .document-shell');
  return shell ? shell.innerHTML.trim() : String(html || '').trim();
}

function isMeaningfulRenderedPage(fragment) {
  const template = document.createElement('template');
  template.innerHTML = String(fragment || '').trim();
  const text = (template.content.textContent || '').replace(/\s+/g, '').trim();
  if (text) return true;
  return Boolean(template.content.querySelector('img,table,pre,code,blockquote,ul,ol,section,article,figure'));
}

function buildRenderBundle(source) {
  const model = parseMarkdownDocument(source);
  const sourceBaseDir = String(state.sourceBaseDir || model.meta.sourceBaseDir || '').trim();
  const resolveAssetUrl = createBrowserAssetResolver(sourceBaseDir);
  const hasRelativeImage = (model.blocks || []).some((block) => block.type === 'image' && !isAbsoluteAssetPath(block.src || ''));
  if (hasRelativeImage && !sourceBaseDir) {
    console.warn('[relative-image-without-base] source base directory unavailable; keeping original relative src');
  }
  const theme = dom.themeSelect.value === 'auto' ? model.meta.theme || 'report' : dom.themeSelect.value;
  const options = {
    theme,
    toc: Boolean(model.meta.toc),
    tocDepth: Number(model.meta.tocDepth || 3),
    mode: model.meta.mode || 'web',
    sourceBaseDir,
    resolveAssetUrl,
    enableMermaid: true,
    enableCodeCopy: true,
  };

  const segments = splitSourceByPageBreak(source);
  if (segments.length <= 1) {
    return {
      model,
      options,
      html: renderDocument(model, options, registry),
    };
  }

  const pages = [];
  for (const segmentSource of segments) {
    const segmentModel = parseMarkdownDocument(segmentSource);
    const segmentHtml = renderDocument(
      segmentModel,
      {
        ...options,
        toc: false,
      },
      registry,
    );
    const inner = extractDocumentShellContent(segmentHtml);
    if (isMeaningfulRenderedPage(inner)) pages.push(inner);
  }

  if (!pages.length) {
    return {
      model,
      options,
      html: renderDocument(model, options, registry),
    };
  }

  const { width, height } = resolvePageSizing(model.meta);
  const totalPages = pages.length;
  const pageHtml = pages
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
  const styleAttr = `--page-width:${escapeHtml(width)};--page-height:${escapeHtml(height)};`;

  return {
    model,
    options,
    html: `
      <div class="studio-document theme-${escapeHtml(options.theme)} mode-${escapeHtml(options.mode)}" style="${styleAttr}">
        <div class="document-shell is-paginated">
          ${pageHtml}
        </div>
      </div>
    `,
  };
}

function render() {
  try {
    state.source = getSource();
    const bundle = buildRenderBundle(state.source);
    state.model = bundle.model;
    state.renderedHtml = bundle.html;
    dom.previewRoot.innerHTML = state.renderedHtml;
    renderMermaidInContainer(dom.previewRoot);
    dom.previewSource.textContent = state.renderedHtml.trim();
    dom.statusText.textContent = '실시간 렌더 완료';
    updatePreviewMode();
    updateDocumentMeta();
    updateOutlineAndSelection();
    persist();
  } catch (error) {
    console.error(error);
    dom.statusText.textContent = '렌더 실패';
    dom.previewRoot.innerHTML = `<div class="render-error"><pre>${escapeHtml(error.stack || error.message)}</pre></div>`;
    dom.previewSource.textContent = error.stack || error.message;
    updatePreviewMode();
  }
}

let mermaidLoaderPromise = null;
function loadMermaidRuntime() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mermaidLoaderPromise) return mermaidLoaderPromise;
  mermaidLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.async = true;
    script.onload = () => resolve(window.mermaid || null);
    script.onerror = () => reject(new Error('mermaid-load-failed'));
    document.head.appendChild(script);
  }).catch((error) => {
    mermaidLoaderPromise = null;
    throw error;
  });
  return mermaidLoaderPromise;
}

function renderMermaidInContainer(container) {
  const blocks = Array.from(container.querySelectorAll('.mermaid-block'));
  if (!blocks.length) return;

  const showFallback = (block) => {
    const fallback = block.querySelector('.mermaid-fallback');
    if (fallback) fallback.hidden = false;
    block.classList.remove('is-mermaid-ready');
  };

  const hideFallback = (block) => {
    const fallback = block.querySelector('.mermaid-fallback');
    if (fallback) fallback.hidden = true;
    block.classList.add('is-mermaid-ready');
  };

  loadMermaidRuntime()
    .then((mermaid) => {
      if (!mermaid || typeof mermaid.initialize !== 'function' || typeof mermaid.render !== 'function') {
        blocks.forEach(showFallback);
        return;
      }
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return Promise.all(
        blocks.map(async (block, index) => {
          const source = block.querySelector('.mermaid-source');
          const renderTarget = block.querySelector('.mermaid-render');
          if (!source || !renderTarget) {
            showFallback(block);
            return;
          }
          try {
            const renderId = `preview-mermaid-${Date.now()}-${index}`;
            const result = await mermaid.render(renderId, source.textContent || '');
            renderTarget.innerHTML = result.svg || '';
            hideFallback(block);
          } catch (error) {
            console.warn('[mermaid-render-failed]', error);
            showFallback(block);
          }
        }),
      );
    })
    .catch((error) => {
      console.warn('[mermaid-unavailable]', error);
      blocks.forEach(showFallback);
    });
}

function updatePreviewMode() {
  dom.previewRoot.hidden = state.previewMode === 'html';
  dom.previewSource.hidden = state.previewMode !== 'html';
  dom.previewRoot.classList.toggle('is-slide-mode', state.previewMode === 'slides');
  dom.previewModeButtons.querySelectorAll('button[data-preview-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.previewMode === state.previewMode);
  });
  syncSlides();
}

function getPreviewPages() {
  const pages = Array.from(dom.previewRoot.querySelectorAll('.doc-page'));
  return pages.filter((page) => isMeaningfulPage(page));
}

function isMeaningfulPage(page) {
  const inner = page?.querySelector('.doc-page-inner');
  if (!inner) return false;
  const text = (inner.textContent || '').replace(/\s+/g, '').trim();
  if (text) return true;
  return Boolean(inner.querySelector('img,table,pre,code,blockquote,ul,ol,section,article,figure,.mermaid-block'));
}

function moveSlide(delta) {
  const pages = getPreviewPages();
  if (!pages.length) return;
  state.slideIndex = Math.min(Math.max(0, state.slideIndex + delta), pages.length - 1);
  syncSlides();
}

function applySlideContainScale() {
  if (state.previewMode !== 'slides') return;
  const doc = dom.previewRoot.querySelector('.studio-document');
  const activePage = dom.previewRoot.querySelector('.doc-page.is-slide-active');
  if (!doc || !activePage) return;
  const width = parseFloat(getComputedStyle(doc).getPropertyValue('--page-width')) || 0;
  const height = parseFloat(getComputedStyle(doc).getPropertyValue('--page-height')) || 0;
  if (!width || !height) {
    doc.style.setProperty('--page-scale', '1');
    return;
  }
  const availableWidth = Math.max(120, dom.previewRoot.clientWidth - 28);
  const availableHeight = Math.max(120, dom.previewRoot.clientHeight - 28);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  doc.style.setProperty('--page-scale', String(Number.isFinite(scale) && scale > 0 ? scale : 1));
}

function syncSlides() {
  const allPages = Array.from(dom.previewRoot.querySelectorAll('.doc-page'));
  const pages = getPreviewPages();
  const slideMode = state.previewMode === 'slides';
  allPages.forEach((page) => {
    const meaningful = isMeaningfulPage(page);
    page.classList.toggle('is-empty-page', !meaningful);
    if (!meaningful) page.classList.remove('is-slide-active');
  });

  if (!slideMode) {
    allPages.forEach((page) => page.classList.remove('is-slide-active'));
    if (dom.slideControls) dom.slideControls.hidden = true;
    const doc = dom.previewRoot.querySelector('.studio-document');
    if (doc) doc.style.setProperty('--page-scale', '1');
    return;
  }

  if (!pages.length) {
    dom.previewRoot.classList.remove('is-slide-mode');
    if (dom.slideControls) dom.slideControls.hidden = true;
    return;
  }

  if (pages.length === 1) {
    state.slideIndex = 0;
    pages[0].classList.add('is-slide-active');
    if (dom.slideMeta) dom.slideMeta.textContent = '1 / 1';
    if (dom.prevSlideBtn) dom.prevSlideBtn.disabled = true;
    if (dom.nextSlideBtn) dom.nextSlideBtn.disabled = true;
    if (dom.slideControls) dom.slideControls.hidden = true;
    applySlideContainScale();
    return;
  }

  state.slideIndex = Math.min(Math.max(0, Number(state.slideIndex) || 0), pages.length - 1);
  pages.forEach((page, index) => page.classList.toggle('is-slide-active', index === state.slideIndex));
  if (!pages.some((page) => page.classList.contains('is-slide-active'))) {
    state.slideIndex = 0;
    pages[0].classList.add('is-slide-active');
  }
  if (dom.slideMeta) dom.slideMeta.textContent = `${state.slideIndex + 1} / ${pages.length}`;
  if (dom.prevSlideBtn) dom.prevSlideBtn.disabled = state.slideIndex === 0;
  if (dom.nextSlideBtn) dom.nextSlideBtn.disabled = state.slideIndex === pages.length - 1;
  if (dom.slideControls) dom.slideControls.hidden = false;
  applySlideContainScale();
}

function updateDocumentMeta() {
  if (!state.model) return;
  const words = state.source.trim() ? state.source.trim().split(/\s+/).length : 0;
  const chars = state.source.length;
  const tableCount = state.model.blocks.filter((item) => item.type === 'table').length;
  const imageCount = state.model.blocks.filter((item) => item.type === 'image').length;
  dom.editorMeta.textContent = `${state.model.sections.length}개 섹션 · ${tableCount}개 표 · ${imageCount}개 이미지`;
  dom.documentMeta.textContent = `Words ${words} · Chars ${chars}`;
}

function updateCursorMeta() {
  const info = getCursorInfo();
  dom.cursorMeta.textContent = `Ln ${info.line}, Col ${info.column}`;
}

function getCursorInfo() {
  if (state.view) {
    const head = state.view.state.selection.main.head;
    const line = state.view.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
  }
  const input = dom.editorFallback;
  const pos = input.selectionStart || 0;
  const before = input.value.slice(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function updateOutlineAndSelection() {
  syncActiveSectionFromCursor();
  renderOutline();
  highlightPreviewSelection();
}

function syncActiveSectionFromCursor() {
  if (!state.model?.sections?.length) {
    state.selectedSectionId = '';
    dom.currentSectionBadge.textContent = '현재 섹션 없음';
    return;
  }
  const line = getCursorInfo().line;
  let current = state.model.sections[0];
  for (const section of state.model.sections) {
    if (section.line <= line) current = section;
    else break;
  }
  state.selectedSectionId = current?.id || '';
  dom.currentSectionBadge.textContent = current ? `현재 섹션 · ${current.title}` : '현재 섹션 없음';
}

function renderOutline() {
  if (!state.model?.sections?.length) {
    dom.outlineList.innerHTML = '<div class="empty-note">문서에 heading 이 없습니다.</div>';
    return;
  }
  dom.outlineList.innerHTML = state.model.sections
    .map((section) => {
      const active = section.id === state.selectedSectionId ? 'is-active' : '';
      return `
        <button type="button" class="outline-item outline-depth-${section.depth} ${active}" data-section-id="${section.id}">
          <span class="outline-label">${escapeHtml(section.title)}</span>
          <span class="outline-line">L${section.line}</span>
        </button>
      `;
    })
    .join('');
}

function highlightPreviewSelection() {
  dom.previewRoot.querySelectorAll('.is-selected').forEach((node) => node.classList.remove('is-selected'));
  if (!state.selectedSectionId) return;
  const target = dom.previewRoot.querySelector(`[data-section-id="${CSS.escape(state.selectedSectionId)}"]`);
  target?.classList.add('is-selected');
}

function resolvePreviewTarget(sectionId) {
  if (!sectionId) return null;
  const headingTarget = dom.previewRoot.querySelector(`#${CSS.escape(sectionId)}`);
  if (headingTarget) return headingTarget;
  return dom.previewRoot.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
}

function revealSection(sectionId, options = {}) {
  if (!sectionId || !state.model?.sections?.length) return;
  const target = state.model.sections.find((section) => section.id === sectionId);
  if (!target) return;
  state.selectedSectionId = target.id;
  dom.currentSectionBadge.textContent = `현재 섹션 · ${target.title}`;

  if (state.view) {
    const safeLine = Math.min(Math.max(1, target.line), state.view.state.doc.lines);
    const lineInfo = state.view.state.doc.line(safeLine);
    state.view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
    state.view.focus();
  } else {
    const pos = positionForLine(dom.editorFallback.value, target.line);
    dom.editorFallback.focus();
    dom.editorFallback.setSelectionRange(pos, pos);
  }

  renderOutline();
  highlightPreviewSelection();
  if (options.scrollPreview !== false) {
    const previewTarget = resolvePreviewTarget(sectionId);
    if (previewTarget && state.previewMode === 'slides') {
      const pageNode = previewTarget.closest('.doc-page');
      const pages = Array.from(dom.previewRoot.querySelectorAll('.doc-page')).filter((page) => !page.classList.contains('is-empty-page'));
      const pageIndex = pageNode ? pages.indexOf(pageNode) : -1;
      if (pageIndex >= 0) {
        state.slideIndex = pageIndex;
        updatePreviewMode();
      }
      return;
    }
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    previewTarget?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}

function positionForLine(text, lineNumber) {
  const lines = String(text).split('\n');
  let position = 0;
  for (let index = 1; index < Math.min(lineNumber, lines.length); index += 1) {
    position += lines[index - 1].length + 1;
  }
  return position;
}

function persist() {
  localStorage.setItem(STORAGE_KEY_MD, state.source);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyTextWithFallback(text) {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      // fallback below
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

function getCodeTextFromButton(button) {
  const root = button?.closest?.('.md-code');
  if (!root) return '';
  const mermaidSource = root.querySelector('.mermaid-source');
  if (mermaidSource?.textContent) return mermaidSource.textContent;
  const code = root.querySelector('pre code');
  return code?.textContent || '';
}

async function handleCodeCopyClick(button) {
  if (!button) return;
  const originalLabel = button.textContent || '복사';
  const text = getCodeTextFromButton(button);
  if (!text) return;
  const ok = await copyTextWithFallback(text);
  button.textContent = ok ? '복사됨' : '복사 실패';
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1200);
}

async function buildStandaloneHtml() {
  const documentStyles = await fetch('/document.css').then((res) => res.text());
  const source = getSource();
  const bundle = buildRenderBundle(source);
  const model = bundle.model;
  const inlined = await inlineExportImages(bundle.html);
  const html = inlined.html;
  const pageCount = (html.match(/class="doc-page"/g) || []).length;
  const exportWarnings = inlined.unresolved.map((src) => `이미지 경로를 해석하지 못했습니다: ${src} (절대 경로 또는 기준 경로 지정 필요)`);
  if (exportWarnings.length) {
    flashStatus(`경고: ${exportWarnings.length}개 이미지 경로를 해석하지 못했습니다. 절대 경로를 사용하거나 CLI --base-dir를 사용하세요.`, 2800);
  }
  return buildStandaloneHtmlDocument({
    title: model.meta.title || 'Document',
    renderedHtml: html,
    cssText: documentStyles,
    pageCount,
    outlineItems: model.sections || [],
    enableMermaid: true,
    exportWarnings,
  });
}

function isResolvableRelativeSrc(src = '') {
  const text = String(src || '').trim();
  if (!text) return false;
  if (/^(data:|blob:|https?:|file:)/i.test(text)) return false;
  if (text.startsWith('/')) return false;
  return true;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('blob-read-failed'));
    reader.readAsDataURL(blob);
  });
}

async function inlineExportImages(renderedHtml = '') {
  const template = document.createElement('template');
  template.innerHTML = String(renderedHtml || '');
  const images = Array.from(template.content.querySelectorAll('img'));
  const unresolved = [];

  for (const img of images) {
    const rawSrc = String(img.getAttribute('src') || '').trim();
    if (!isResolvableRelativeSrc(rawSrc)) continue;
    try {
      const absolute = new URL(rawSrc, window.location.href).href;
      const response = await fetch(absolute);
      if (!response.ok) throw new Error(`asset-fetch-failed:${response.status}`);
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl) throw new Error('empty-data-url');
      img.setAttribute('src', dataUrl);
      img.removeAttribute('data-src-resolve-error');
    } catch (_) {
      img.setAttribute('data-src-resolve-error', 'true');
      unresolved.push(rawSrc);
    }
  }

  return {
    html: template.innerHTML,
    unresolved: Array.from(new Set(unresolved)),
  };
}








