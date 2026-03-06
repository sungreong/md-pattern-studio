import { escapeHtml } from './engine.js';

const DEFAULT_PAGE_WIDTH = '1120px';
const DEFAULT_PAGE_HEIGHT = '720px';

function normalizeOutlineItems(items = []) {
  const seen = new Set();
  return (items || [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      title: String(item?.title || '').trim(),
      depth: Number(item?.depth || 2),
    }))
    .filter((item) => item.id && item.title && !seen.has(item.id) && seen.add(item.id));
}

function buildOutlineHtml(items = []) {
  const outline = normalizeOutlineItems(items);
  if (!outline.length) return '';
  const links = outline
    .map((item) => `<a href="#${escapeHtml(item.id)}" class="outline-depth-${Math.min(6, Math.max(1, item.depth))}" data-outline-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a>`)
    .join('');
  return `
<aside class="export-outline" aria-label="Document outline">
  <div class="outline-head">
    <strong>Outline</strong>
    <button type="button" data-outline-toggle>Hide</button>
  </div>
  <div class="outline-current">Current: <span data-outline-current>Top</span></div>
  <nav class="outline-links">${links}</nav>
</aside>`;
}

function buildEnhancementScript({ mermaid = true } = {}) {
  return `
(() => {
  try {
    const compactText = (value) =>
      String(value || '')
        .split(' ')
        .join('')
        .split('\\\\n')
        .join('')
        .split('\\\\r')
        .join('')
        .split('\\\\t')
        .join('')
        .trim();

    const rawPages = Array.from(document.querySelectorAll('.doc-page'));
    const isMeaningful = (page) => {
      const inner = page && page.querySelector ? page.querySelector('.doc-page-inner') : null;
      if (!inner) return false;
      const text = compactText(inner.textContent || '');
      if (text) return true;
      return Boolean(inner.querySelector('img,table,pre,code,blockquote,ul,ol,section,article,figure,.mermaid-block'));
    };
    const pages = rawPages.filter(isMeaningful);
    rawPages.forEach((page) => {
      if (!isMeaningful(page)) page.remove();
    });

    const outline = document.querySelector('.export-outline');
    const outlineCurrent = outline ? outline.querySelector('[data-outline-current]') : null;
    const outlineLinks = outline ? Array.from(outline.querySelectorAll('[data-outline-id]')) : [];
    const outlineToggle = outline ? outline.querySelector('[data-outline-toggle]') : null;
    if (outlineToggle && outline) {
      outlineToggle.addEventListener('click', () => {
        const collapsed = outline.classList.toggle('is-collapsed');
        outlineToggle.textContent = collapsed ? 'Show' : 'Hide';
      });
    }

    const setActiveOutline = (sectionId) => {
      if (!outline) return;
      let activeText = 'Top';
      outlineLinks.forEach((link) => {
        const active = sectionId && link.dataset.outlineId === sectionId;
        link.classList.toggle('is-active', Boolean(active));
        if (active) activeText = link.textContent || activeText;
      });
      if (outlineCurrent) outlineCurrent.textContent = activeText;
    };

    let index = 0;
    let nav = null;
    let prev = null;
    let next = null;
    let toggle = null;
    let count = null;
    let observer = null;
    const rootDocument = document.querySelector('.studio-document');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollBehavior = reduceMotion ? 'auto' : 'smooth';

    const resolveOutlineTarget = (id) => {
      if (!id) return null;
      const byId = document.getElementById(id);
      if (byId) return byId;
      const fallback = Array.from(document.querySelectorAll('[data-section-id]')).find((node) => node.getAttribute('data-section-id') === id);
      return fallback || null;
    };

    const targetCache = new Map(
      outlineLinks.map((link) => {
        const id = link.dataset.outlineId || '';
        const target = resolveOutlineTarget(id);
        const page = target ? target.closest('.doc-page') : null;
        const pageIndex = page ? pages.indexOf(page) : -1;
        return [id, { target, pageIndex }];
      }),
    );

    const updateHash = (id) => {
      if (!id || !window.history || typeof window.history.replaceState !== 'function') return;
      try {
        window.history.replaceState(null, '', '#' + encodeURIComponent(id));
      } catch (_) {
        // noop
      }
    };

    const currentSectionFromPage = (page) => {
      if (!page) return '';
      const section = page.querySelector('[data-section-id]');
      return section ? section.getAttribute('data-section-id') || '' : '';
    };

    function updateScale() {
      if (!rootDocument || document.body.classList.contains('export-stacked')) return;
      const styles = getComputedStyle(rootDocument);
      const width = parseFloat(styles.getPropertyValue('--page-width')) || 0;
      const height = parseFloat(styles.getPropertyValue('--page-height')) || 0;
      if (!width || !height) {
        rootDocument.style.setProperty('--page-scale', '1');
        return;
      }
      const availableWidth = Math.max(120, window.innerWidth - 360);
      const availableHeight = Math.max(120, window.innerHeight - 40);
      const scale = Math.min(1, availableWidth / width, availableHeight / height);
      rootDocument.style.setProperty('--page-scale', String(Number.isFinite(scale) && scale > 0 ? scale : 1));
    }

    function bindStackObserver() {
      if (observer) observer.disconnect();
      const targets = Array.from(document.querySelectorAll('[data-section-id]'));
      if (!targets.length) return;
      observer = new IntersectionObserver(
        (entries) => {
          let best = null;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
          }
          if (best) setActiveOutline(best.target.getAttribute('data-section-id') || '');
        },
        { root: null, threshold: [0.2, 0.5, 0.8] },
      );
      targets.forEach((node) => observer.observe(node));
    }

    function unbindStackObserver() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
    }

    function paint() {
      if (!pages.length) return;
      pages.forEach((page, i) => page.classList.toggle('is-slide-active', i === index));
      if (!pages.some((page) => page.classList.contains('is-slide-active'))) {
        index = 0;
        pages[0].classList.add('is-slide-active');
      }
      if (count) count.textContent = String(index + 1) + ' / ' + String(pages.length);
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === pages.length - 1;
      updateScale();
      const currentSectionId = currentSectionFromPage(pages[index]);
      setActiveOutline(currentSectionId);
      updateHash(currentSectionId);
    }

    function move(delta) {
      if (document.body.classList.contains('export-stacked')) return;
      index = Math.min(Math.max(0, index + delta), pages.length - 1);
      paint();
    }

    function switchMode(stacked) {
      document.body.classList.toggle('export-stacked', stacked);
      document.body.classList.toggle('export-slides', !stacked && pages.length > 1);
      if (toggle) toggle.textContent = stacked ? 'Slides' : 'Stack';
      if (stacked) {
        unbindStackObserver();
        bindStackObserver();
      } else {
        unbindStackObserver();
        paint();
      }
    }

    if (pages.length >= 2) {
      document.body.classList.add('has-js-slides');
      document.body.classList.add('export-slides');
      nav = document.createElement('div');
      nav.className = 'export-slide-nav';
      nav.innerHTML = '<button type="button" data-action="prev">Prev</button><span class="count">1 / 1</span><button type="button" data-action="next">Next</button><button type="button" data-action="toggle">Stack</button>';
      document.body.appendChild(nav);
      prev = nav.querySelector('[data-action="prev"]');
      next = nav.querySelector('[data-action="next"]');
      toggle = nav.querySelector('[data-action="toggle"]');
      count = nav.querySelector('.count');
      prev.addEventListener('click', () => move(-1));
      next.addEventListener('click', () => move(1));
      toggle.addEventListener('click', () => {
        switchMode(!document.body.classList.contains('export-stacked'));
      });
      paint();
    } else {
      switchMode(true);
    }

    outlineLinks.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const id = link.dataset.outlineId || '';
        if (!id) return;
        const resolved = targetCache.get(id) || { target: null, pageIndex: -1 };
        const target = resolved.target || resolveOutlineTarget(id);
        if (!target) return;
        if (pages.length > 1 && !document.body.classList.contains('export-stacked')) {
          if (resolved.pageIndex >= 0) {
            index = resolved.pageIndex;
            paint();
          }
          setActiveOutline(id);
          updateHash(id);
          return;
        }
        target.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
        setActiveOutline(id);
        updateHash(id);
      });
    });

    const copyTextWithFallback = async (text) => {
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
    };

    document.addEventListener('click', async (event) => {
      const button = event.target && event.target.closest ? event.target.closest('[data-copy-code]') : null;
      if (!button) return;
      event.preventDefault();
      const root = button.closest('.md-code');
      if (!root) return;
      const source = root.querySelector('.mermaid-source');
      const code = root.querySelector('pre code');
      const text = (source && source.textContent) || (code && code.textContent) || '';
      if (!text) return;
      const originalLabel = button.textContent || '복사';
      const ok = await copyTextWithFallback(text);
      button.textContent = ok ? '복사됨' : '복사 실패';
      window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 1200);
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        move(-1);
      } else if (String(event.key || '').toLowerCase() === 's' && toggle) {
        toggle.click();
      }
    });
    window.addEventListener('resize', () => {
      updateScale();
    });

    setActiveOutline(currentSectionFromPage(pages[index] || null));
    let initialHash = String(window.location.hash || '').replace(/^#/, '');
    try {
      initialHash = decodeURIComponent(initialHash);
    } catch (_) {
      initialHash = '';
    }
    if (initialHash) {
      const resolved = targetCache.get(initialHash) || { target: null, pageIndex: -1 };
      const target = resolved.target || resolveOutlineTarget(initialHash);
      if (target) {
        if (pages.length > 1 && !document.body.classList.contains('export-stacked') && resolved.pageIndex >= 0) {
          index = resolved.pageIndex;
          paint();
        } else {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
          setActiveOutline(initialHash);
        }
      }
    }

    const mermaidEnabled = ${mermaid ? 'true' : 'false'};
    if (!mermaidEnabled) return;

    const blocks = Array.from(document.querySelectorAll('.mermaid-block'));
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
    const loadMermaid = () =>
      new Promise((resolve, reject) => {
        if (window.mermaid) {
          resolve(window.mermaid);
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.async = true;
        script.onload = () => resolve(window.mermaid || null);
        script.onerror = () => reject(new Error('mermaid-load-failed'));
        document.head.appendChild(script);
      });

    loadMermaid()
      .then((mermaid) => {
        if (!mermaid || typeof mermaid.initialize !== 'function' || typeof mermaid.render !== 'function') {
          blocks.forEach(showFallback);
          return;
        }
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        return Promise.all(
          blocks.map(async (block, idx) => {
            const source = block.querySelector('.mermaid-source');
            const target = block.querySelector('.mermaid-render');
            if (!source || !target) {
              showFallback(block);
              return;
            }
            const code = source.textContent || '';
            try {
              const renderId = 'mmd-' + idx + '-' + Date.now();
              const result = await mermaid.render(renderId, code);
              target.innerHTML = result.svg || '';
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
  } catch (error) {
    console.error('[slide-init-failed]', error);
  }
})();
`;
}

export function buildStandaloneHtmlDocument({
  title = 'Document',
  renderedHtml = '',
  cssText = '',
  pageCount = 0,
  outlineItems = [],
  enableMermaid = true,
  exportWarnings = [],
} = {}) {
  const fallbackNav =
    pageCount > 1
      ? `
<nav class="export-fallback-nav" aria-label="Page navigation">
  <span>Pages:</span>
  ${Array.from({ length: pageCount }, (_, index) => `<a href="#page-${index + 1}">${index + 1}</a>`).join('')}
</nav>`
      : '';
  const outlineHtml = buildOutlineHtml(outlineItems);
  const warningItems = Array.isArray(exportWarnings) ? exportWarnings.filter(Boolean) : [];
  const warningHtml = warningItems.length
    ? `
<aside class="export-warning" role="status" aria-live="polite">
  <strong>이미지 경로 안내</strong>
  <ul>${warningItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
</aside>`
    : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #edf2f9;
      font-family: Inter, Pretendard, 'Noto Sans KR', system-ui, sans-serif;
    }
    ${cssText}
    body.export-slides {
      background: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    body.export-slides .studio-document {
      width: min(96vw, var(--page-width, ${DEFAULT_PAGE_WIDTH}));
      height: auto;
    }
    body.export-slides .document-shell.is-paginated {
      max-width: none;
      height: auto;
      display: block;
    }
    body.export-slides .doc-page {
      display: none;
      width: var(--page-width, ${DEFAULT_PAGE_WIDTH});
      height: var(--page-height, ${DEFAULT_PAGE_HEIGHT});
      margin: 0 auto;
    }
    body.export-slides .doc-page.is-slide-active {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      transform-origin: top center;
      transform: scale(var(--page-scale, 1));
    }
    body.export-slides .doc-page-inner {
      height: 100%;
      min-height: 0;
      overflow: auto;
    }
    .export-slide-nav {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 30;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(15, 23, 42, 0.85);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 999px;
      padding: 8px 10px;
      backdrop-filter: blur(8px);
    }
    .export-slide-nav button {
      border: 1px solid rgba(148, 163, 184, 0.45);
      background: rgba(30, 41, 59, 0.75);
      color: #e2e8f0;
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .export-slide-nav button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .export-slide-nav .count {
      min-width: 62px;
      text-align: center;
      font-size: 13px;
    }
    .export-fallback-nav {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 29;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.85);
      color: #e2e8f0;
      backdrop-filter: blur(8px);
      font-size: 12px;
    }
    .export-fallback-nav a {
      color: #e2e8f0;
      text-decoration: none;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 999px;
      padding: 4px 8px;
      background: rgba(30, 41, 59, 0.75);
    }
    body.has-js-slides .export-fallback-nav {
      display: none;
    }
    .export-outline {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 28;
      width: min(320px, 32vw);
      max-height: calc(100vh - 120px);
      overflow: auto;
      padding: 10px;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.86);
      color: #e2e8f0;
      backdrop-filter: blur(8px);
    }
    .export-outline .outline-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .export-outline .outline-head button {
      border: 1px solid rgba(148, 163, 184, 0.45);
      background: rgba(30, 41, 59, 0.75);
      color: #e2e8f0;
      border-radius: 999px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 12px;
    }
    .export-outline .outline-current {
      font-size: 12px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }
    .export-outline .outline-links {
      display: grid;
      gap: 4px;
    }
    .export-outline .outline-links a {
      color: #e2e8f0;
      text-decoration: none;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: rgba(30, 41, 59, 0.22);
      font-size: 13px;
    }
    .export-outline .outline-links a.outline-depth-3 { padding-left: 14px; }
    .export-outline .outline-links a.outline-depth-4 { padding-left: 20px; }
    .export-outline .outline-links a.outline-depth-5 { padding-left: 26px; }
    .export-outline .outline-links a.outline-depth-6 { padding-left: 32px; }
    .export-outline .outline-links a.is-active {
      border-color: rgba(99, 179, 237, 0.5);
      background: rgba(30, 64, 175, 0.4);
    }
    .export-outline.is-collapsed {
      width: auto;
      max-width: 120px;
      overflow: hidden;
    }
    .export-outline.is-collapsed .outline-current,
    .export-outline.is-collapsed .outline-links {
      display: none;
    }
    .export-warning {
      position: fixed;
      left: 16px;
      top: 16px;
      z-index: 31;
      max-width: min(620px, calc(100vw - 420px));
      border: 1px solid rgba(253, 186, 116, 0.55);
      background: rgba(124, 45, 18, 0.9);
      color: #ffedd5;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
    }
    .export-warning ul {
      margin: 6px 0 0;
      padding-left: 16px;
    }
    .export-warning li + li {
      margin-top: 4px;
    }
    .doc-page [data-section-id],
    .doc-page .section-heading[id] {
      scroll-margin-top: 18px;
    }
    body.export-stacked {
      background: #edf2f9;
      display: block;
      padding: 24px;
    }
    body.export-stacked .studio-document {
      width: auto;
      height: auto;
    }
    body.export-stacked .document-shell.is-paginated {
      display: grid;
      height: auto;
    }
    body.export-stacked .doc-page {
      display: grid;
      height: auto;
    }
    .mermaid-block .mermaid-render {
      min-height: 24px;
    }
    .mermaid-block .mermaid-fallback[hidden] {
      display: none !important;
    }
    @media (max-width: 980px) {
      .export-outline {
        width: min(280px, 42vw);
      }
    }
  </style>
</head>
<body>
${renderedHtml}
${fallbackNav}
${outlineHtml}
${warningHtml}
<script>
${buildEnhancementScript({ mermaid: enableMermaid })}
</script>
</body>
</html>`;
}
