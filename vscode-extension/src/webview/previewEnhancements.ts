export type PreferredViewMode = 'auto' | 'slides' | 'stack';

interface PreviewEnhancementOptions {
  preferredViewMode: PreferredViewMode;
  outlineCollapsed: boolean;
}

export function injectPreviewEnhancements(html: string, options: PreviewEnhancementOptions): string {
  const payload = [
    buildResponsiveStyle(),
    buildBridgeScript(options),
    buildSearchMarkup(),
  ].join('\n');

  const lower = html.toLowerCase();
  const bodyIndex = lower.lastIndexOf('</body>');
  if (bodyIndex === -1) return `${html}\n${payload}`;
  return `${html.slice(0, bodyIndex)}\n${payload}\n${html.slice(bodyIndex)}`;
}

function buildResponsiveStyle(): string {
  return `
<style>
body.mps-compact-chrome {
  padding: 8px !important;
  overflow-x: hidden;
}
body.mps-narrow-preview .studio-document,
body.mps-narrow-preview .document-shell,
body.mps-narrow-preview .document-shell.is-paginated {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  justify-items: stretch;
}
body.mps-narrow-preview .studio-document {
  --font-size-title: clamp(1.7rem, 5.6vw, 2.35rem);
  --font-size-section: clamp(1.16rem, 3.6vw, 1.45rem);
}
body.mps-narrow-preview.export-stacked .studio-document {
  width: calc(100% / var(--stacked-zoom, 1));
}
body.mps-stack-zoomed.export-stacked .studio-document {
  transform-origin: top left;
}
body.mps-stack-zoomed.export-stacked .document-shell.is-paginated {
  max-width: none;
  margin-left: 0;
  margin-right: 0;
}
body.mps-layout-wide .template-columns .multi-column-grid {
  grid-template-columns: repeat(var(--column-count, 2), minmax(0, 1fr)) !important;
}
body.mps-layout-wide .studio-document .section-heading.level-1 {
  font-size: var(--font-size-title);
}
body.mps-layout-wide .studio-document .section-heading.level-2 {
  font-size: var(--font-size-section);
}
body.mps-narrow-preview .document-shell.is-paginated .doc-page {
  box-sizing: border-box;
  width: 100% !important;
  max-width: 100%;
  height: auto;
  min-height: 0;
}
body.mps-narrow-preview .document-shell.is-paginated .doc-page-inner {
  overflow: visible;
  min-width: 0;
}
body.mps-narrow-preview .document-shell.is-paginated .doc-page-inner > .md-section {
  min-width: 0;
  padding: clamp(14px, 3.8vw, 24px) !important;
}
body.mps-narrow-preview .section-heading,
body.mps-narrow-preview .md-paragraph,
body.mps-narrow-preview .md-list,
body.mps-narrow-preview .md-callout,
body.mps-narrow-preview .md-table th,
body.mps-narrow-preview .md-table td {
  overflow-wrap: anywhere;
}
body.mps-narrow-preview .section-heading {
  line-height: 1.14;
}
body.mps-narrow-preview .md-table-shell {
  max-width: 100%;
  overflow-x: auto;
}
body.mps-narrow-preview .md-table {
  min-width: 0;
  table-layout: auto;
}
body.mps-narrow-preview .md-table th,
body.mps-narrow-preview .md-table td {
  padding: 8px 10px;
  font-size: 13px;
}
body.mps-compact-chrome .export-outline {
  top: 8px;
  right: 8px;
  max-width: min(320px, calc(100vw - 16px));
}
body.mps-compact-chrome .export-outline:not(.is-collapsed) {
  left: 8px;
  width: auto;
}
body.mps-compact-chrome .export-slide-nav {
  left: 8px;
  right: 8px;
  bottom: 8px;
  max-width: calc(100vw - 16px);
  overflow-x: auto;
  justify-content: flex-start;
}
body.mps-compact-chrome #mps-search-bar {
  left: 8px;
  right: 8px;
  width: auto;
}
body.mps-compact-chrome #mps-search-input {
  min-width: 0;
  width: 100%;
}
</style>`;
}

function buildBridgeScript({ preferredViewMode, outlineCollapsed }: PreviewEnhancementOptions): string {
  return `
<script>
(function () {
  if (window.__mdStudioPreviewSyncInstalled) return;
  window.__mdStudioPreviewSyncInstalled = true;
  const preferredViewMode = ${JSON.stringify(preferredViewMode)};
  const initialOutlineCollapsed = ${outlineCollapsed ? 'true' : 'false'};
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  let userChangedMode = false;
  let autoChangingMode = false;
  let autoChangingOutline = false;
  let stackFitActive = false;
  let stackZoomOverride = null;
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const post = (message) => {
    if (vscodeApi && typeof vscodeApi.postMessage === 'function') vscodeApi.postMessage(message);
  };
  const notifyReady = () => post({ type: 'mdStudioPreview.ready' });
  const notifyOutlineState = (collapsed) =>
    post({ type: 'mdStudioPreview.outlineStateChanged', collapsed: Boolean(collapsed) });

  const getOutlineCollapsed = (outline) => Boolean(outline && outline.classList.contains('is-collapsed'));
  const shouldStack = () =>
    window.innerWidth < 980 ||
    preferredViewMode === 'stack' ||
    (preferredViewMode === 'auto' && window.innerWidth < 1400);
  const isStackedView = () => document.body.classList.contains('export-stacked');

  function readCssNumber(element, name, fallback) {
    const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function getBodyHorizontalPadding() {
    const style = getComputedStyle(document.body);
    const left = parseFloat(style.paddingLeft) || 0;
    const right = parseFloat(style.paddingRight) || 0;
    return left + right;
  }

  function getStackScale() {
    if (stackZoomOverride != null) return stackZoomOverride;
    return readCssNumber(document.documentElement, '--stacked-zoom', 1);
  }

  function getEffectiveLayoutWidth() {
    const viewportWidth = Math.max(120, window.innerWidth - getBodyHorizontalPadding() - 8);
    if (!isStackedView()) return viewportWidth;
    return viewportWidth / Math.max(0.1, getStackScale());
  }

  function updateResponsiveClasses() {
    const viewportNarrow = window.innerWidth < 980;
    const effectiveLayoutWidth = getEffectiveLayoutWidth();
    const stackScale = isStackedView() ? getStackScale() : 1;
    document.body.classList.toggle('mps-compact-chrome', viewportNarrow);
    document.body.classList.toggle('mps-narrow-preview', effectiveLayoutWidth < 980);
    document.body.classList.toggle('mps-layout-wide', effectiveLayoutWidth >= 820);
    document.body.classList.toggle('mps-stack-zoomed', isStackedView() && stackScale < 0.999);
  }

  function getStackFitScale() {
    const root = document.querySelector('.studio-document');
    if (!root) return 1;
    const shell = root.querySelector('.document-shell.is-paginated') || root;
    const currentScale = getStackScale();
    const fallbackWidth = Math.min(980, readCssNumber(root, '--page-width', 980));
    const contentWidth = Math.max(
      shell.scrollWidth || 0,
      root.scrollWidth || 0,
      (shell.getBoundingClientRect().width || 0) / Math.max(0.1, currentScale),
      fallbackWidth,
    );
    const availableWidth = Math.max(120, window.innerWidth - getBodyHorizontalPadding() - 16);
    const nextScale = Math.min(1, availableWidth / Math.max(1, contentWidth));
    return Number.isFinite(nextScale) ? Math.max(0.5, Math.min(1, nextScale)) : 1;
  }

  function updateStackZoomUi(scale, fit) {
    const nav = document.querySelector('.export-slide-nav');
    const label = nav ? nav.querySelector('.zoom-label') : null;
    const fitBtn = nav ? nav.querySelector('[data-action="zoom-fit"]') : null;
    if (label) {
      label.textContent = fit ? 'Fit (' + Math.round(scale * 100) + '%)' : Math.round(scale * 100) + '%';
    }
    if (fitBtn) fitBtn.classList.toggle('is-active', Boolean(fit));
  }

  function applyStackZoom(scale, fit) {
    stackZoomOverride = scale;
    stackFitActive = Boolean(fit);
    document.documentElement.style.setProperty('--stacked-zoom', String(scale));
    updateStackZoomUi(scale, fit);
    updateResponsiveClasses();
  }

  function applyStackFit() {
    applyStackZoom(getStackFitScale(), true);
  }

  function adjustStackZoom(delta) {
    const current = getStackScale();
    const steps = delta > 0 ? ZOOM_STEPS : ZOOM_STEPS.slice().reverse();
    const next = steps.find((step) => (delta > 0 ? step > current + 0.001 : step < current - 0.001));
    applyStackZoom(next == null ? current : next, false);
  }

  function bindStackZoomControls() {
    const nav = document.querySelector('.export-slide-nav');
    if (!nav || nav.hasAttribute('data-md-studio-fit-bound')) return;
    nav.setAttribute('data-md-studio-fit-bound', '1');

    const fitBtn = nav.querySelector('[data-action="zoom-fit"]');
    const zoomIn = nav.querySelector('[data-action="zoom-in"]');
    const zoomOut = nav.querySelector('[data-action="zoom-out"]');

    fitBtn?.addEventListener('click', (event) => {
      if (!isStackedView()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyStackFit();
    }, true);

    zoomIn?.addEventListener('click', (event) => {
      if (!isStackedView() || !stackFitActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      adjustStackZoom(1);
    }, true);

    zoomOut?.addEventListener('click', (event) => {
      if (!isStackedView() || !stackFitActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      adjustStackZoom(-1);
    }, true);

    for (const button of [zoomIn, zoomOut]) {
      button?.addEventListener('click', () => {
        if (!isStackedView()) return;
        stackFitActive = false;
        stackZoomOverride = null;
        window.setTimeout(() => {
          updateStackZoomUi(getStackScale(), false);
          updateResponsiveClasses();
        }, 0);
      });
    }
  }

  function setOutlineCollapsed(outline, collapsed) {
    if (!outline) return;
    const toggle = outline.querySelector('[data-outline-toggle]');
    if (getOutlineCollapsed(outline) === collapsed) return;
    if (toggle && typeof toggle.click === 'function') {
      toggle.click();
    } else {
      outline.classList.toggle('is-collapsed', collapsed);
      if (!autoChangingOutline) notifyOutlineState(collapsed);
    }
  }

  function bindOutline() {
    const outline = document.querySelector('.export-outline');
    if (!outline) return false;
    const toggle = outline.querySelector('[data-outline-toggle]');
    const narrow = window.innerWidth < 980;
    if (!narrow) setOutlineCollapsed(outline, initialOutlineCollapsed);
    if (toggle && !toggle.hasAttribute('data-md-studio-outline-bound')) {
      toggle.setAttribute('data-md-studio-outline-bound', '1');
      toggle.addEventListener('click', () => {
        if (!autoChangingOutline) {
          window.setTimeout(() => notifyOutlineState(getOutlineCollapsed(outline)), 0);
        }
      });
    }
    if (!narrow) notifyOutlineState(getOutlineCollapsed(outline));
    return true;
  }

  function applyResponsiveState() {
    updateResponsiveClasses();
    bindStackZoomControls();

    const toggle = document.querySelector('.export-slide-nav [data-action="toggle"]');
    const isStacked = isStackedView();
    if (!userChangedMode && toggle && shouldStack() && !isStacked) {
      autoChangingMode = true;
      toggle.click();
      autoChangingMode = false;
    }
    if (!userChangedMode && toggle && preferredViewMode === 'slides' && !narrow && isStacked) {
      autoChangingMode = true;
      toggle.click();
      autoChangingMode = false;
    }
    if (toggle && !toggle.hasAttribute('data-md-studio-mode-bound')) {
      toggle.setAttribute('data-md-studio-mode-bound', '1');
      toggle.addEventListener('click', () => {
        if (!autoChangingMode) userChangedMode = true;
        window.setTimeout(applyResponsiveState, 0);
      });
    }

    updateResponsiveClasses();
    bindStackZoomControls();

    const outline = document.querySelector('.export-outline');
    if (window.innerWidth < 980 && outline && !getOutlineCollapsed(outline)) {
      autoChangingOutline = true;
      setOutlineCollapsed(outline, true);
      autoChangingOutline = false;
    }

    if (isStackedView() && stackFitActive) {
      applyStackFit();
    } else if (isStackedView() && stackZoomOverride != null) {
      applyStackZoom(stackZoomOverride, false);
    }
  }

  function findByDataValue(selector, attrName, targetValue) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (node.getAttribute(attrName) === targetValue) return node;
    }
    return null;
  }

  function findTarget(sectionId) {
    if (!sectionId) return null;
    return document.getElementById(sectionId) || findByDataValue('[data-section-id]', 'data-section-id', sectionId);
  }

  document.addEventListener('DOMContentLoaded', () => {
    notifyReady();
    window.setTimeout(notifyReady, 120);
  }, { once: true });
  if (document.readyState !== 'loading') {
    notifyReady();
    window.setTimeout(notifyReady, 120);
  }

  for (const waitMs of [0, 80, 220, 450, 900]) {
    window.setTimeout(() => {
      bindOutline();
      applyResponsiveState();
    }, waitMs);
  }
  window.addEventListener('resize', applyResponsiveState);
  window.addEventListener('keydown', (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl || !isStackedView()) return;
    if (event.key === '0') {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyStackFit();
      return;
    }
    if (stackFitActive && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      adjustStackZoom(1);
      return;
    }
    if (stackFitActive && event.key === '-') {
      event.preventDefault();
      event.stopImmediatePropagation();
      adjustStackZoom(-1);
    }
  }, true);

  window.addEventListener('message', (event) => {
    const data = event && event.data ? event.data : null;
    if (!data || data.type !== 'mdStudioPreview.syncSection') return;
    const sectionId = String(data.sectionId || '').trim();
    if (!sectionId) return;

    const outlineLink = findByDataValue('[data-outline-id]', 'data-outline-id', sectionId);
    if (outlineLink && typeof outlineLink.click === 'function') {
      outlineLink.click();
      return;
    }

    const target = findTarget(sectionId);
    if (!target || typeof target.scrollIntoView !== 'function') return;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
})();
</script>`;
}

function buildSearchMarkup(): string {
  return `
<style>
#mps-search-bar {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 99999;
  display: none;
  align-items: center;
  gap: 5px;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: 6px;
  padding: 5px 8px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.45);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: 13px;
  color: var(--vscode-editorWidget-foreground, #ccc);
}
#mps-search-input {
  background: var(--vscode-input-background, #3c3c3c);
  border: 1px solid var(--vscode-input-border, transparent);
  color: var(--vscode-input-foreground, #ccc);
  border-radius: 3px;
  padding: 3px 8px;
  font-size: 13px;
  width: 190px;
  outline: none;
}
#mps-search-input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
#mps-search-count { min-width: 56px; text-align: center; font-size: 11px; opacity: 0.7; }
.mps-search-btn {
  background: transparent;
  border: none;
  color: var(--vscode-editorWidget-foreground, #ccc);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 5px;
  border-radius: 3px;
  line-height: 1;
}
.mps-search-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); }
mark.mps-hit { background: #ffeb3b; color: #000; border-radius: 2px; padding: 0 1px; }
mark.mps-hit.mps-hit-active { background: #ff9800; outline: 2px solid #ff9800; }
</style>
<div id="mps-search-bar">
  <input id="mps-search-input" type="text" placeholder="Search in document..." autocomplete="off" spellcheck="false">
  <span id="mps-search-count"></span>
  <button class="mps-search-btn" id="mps-search-prev" title="Previous (Shift+Enter)">↑</button>
  <button class="mps-search-btn" id="mps-search-next" title="Next (Enter)">↓</button>
  <button class="mps-search-btn" id="mps-search-close" title="Close (Escape)">✕</button>
</div>
<script>
(function () {
  if (window.__mpsSearchInstalled) return;
  window.__mpsSearchInstalled = true;

  const bar = document.getElementById('mps-search-bar');
  const input = document.getElementById('mps-search-input');
  const countEl = document.getElementById('mps-search-count');
  const prevBtn = document.getElementById('mps-search-prev');
  const nextBtn = document.getElementById('mps-search-next');
  const closeBtn = document.getElementById('mps-search-close');
  let marks = [];
  let currentIndex = -1;
  let lastQuery = '';
  let timer = null;

  function clearMarks() {
    marks.forEach((mark) => {
      if (mark.parentNode) mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    });
    document.body.normalize();
    marks = [];
    currentIndex = -1;
  }

  function updateCount() {
    if (!lastQuery) countEl.textContent = '';
    else if (!marks.length) countEl.textContent = 'No results';
    else countEl.textContent = (currentIndex + 1) + ' / ' + marks.length;
  }

  function escapeRegex(value) {
    const specials = ['\\\\', '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']'];
    let result = String(value || '');
    specials.forEach((ch) => {
      result = result.split(ch).join('\\\\' + ch);
    });
    return result;
  }

  function highlight(query) {
    clearMarks();
    if (!query) {
      updateCount();
      return;
    }
    const regex = new RegExp(escapeRegex(query), 'gi');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || el.closest('#mps-search-bar')) return NodeFilter.FILTER_REJECT;
        if (['script', 'style', 'noscript'].includes(el.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        return (node.textContent || '').search(regex) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.textContent || '';
      regex.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let start = 0;
      let match;
      while ((match = regex.exec(text))) {
        if (match.index > start) fragment.appendChild(document.createTextNode(text.slice(start, match.index)));
        const mark = document.createElement('mark');
        mark.className = 'mps-hit';
        mark.textContent = match[0];
        marks.push(mark);
        fragment.appendChild(mark);
        start = regex.lastIndex;
      }
      if (start < text.length) fragment.appendChild(document.createTextNode(text.slice(start)));
      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    });
    currentIndex = marks.length ? 0 : -1;
    activate(currentIndex);
  }

  function activate(index) {
    marks.forEach((mark, i) => mark.classList.toggle('mps-hit-active', i === index));
    if (marks[index]) marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateCount();
  }

  function step(delta) {
    if (!marks.length) return;
    currentIndex = (currentIndex + delta + marks.length) % marks.length;
    activate(currentIndex);
  }

  function openSearch() {
    bar.style.display = 'flex';
    input.focus();
    input.select();
  }

  function closeSearch() {
    bar.style.display = 'none';
    clearMarks();
    input.value = '';
    lastQuery = '';
    updateCount();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastQuery = input.value;
      highlight(lastQuery);
    }, 180);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      closeSearch();
    }
  });
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', closeSearch);
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    } else if (event.key === 'Escape' && bar.style.display !== 'none') {
      closeSearch();
    }
  }, true);
})();
</script>`;
}
