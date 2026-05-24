import { escapeHtml } from './engine.js';
import {
  APPEARANCE_BACKGROUND_OPTIONS,
  APPEARANCE_FRAME_OPTIONS,
  APPEARANCE_PRESET_OPTIONS,
  APPEARANCE_RADIUS_OPTIONS,
  VIEWER_CHROME_OPTIONS,
  buildAppearanceBodyAttributes,
  normalizeAppearanceOptions,
} from './appearance.js';

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
    .map((item) => `<a href="#${escapeHtml(item.id)}" class="outline-depth-${Math.min(6, Math.max(1, item.depth))}" data-outline-id="${escapeHtml(item.id)}" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>`)
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

function buildStyleMenuHtml(appearanceOptions = {}) {
  const normalized = normalizeAppearanceOptions(appearanceOptions);
  const select = (name, label, options, selectedValue) => `
    <label>
      <span>${escapeHtml(label)}</span>
      <select data-appearance-control="${escapeHtml(name)}">
        ${options
          .map(
            (item) =>
              `<option value="${escapeHtml(item.value)}"${item.value === selectedValue ? ' selected' : ''}>${escapeHtml(item.label)}</option>`,
          )
          .join('')}
      </select>
    </label>`;

  return `
<details class="export-style-menu" data-export-style-menu>
  <summary>Style</summary>
  <div class="style-menu-grid">
    ${select('appearance', 'Preset', APPEARANCE_PRESET_OPTIONS, normalized.appearance)}
    ${select('appearanceBackground', 'Background', APPEARANCE_BACKGROUND_OPTIONS, normalized.appearanceBackground)}
    ${select('appearanceRadius', 'Corners', APPEARANCE_RADIUS_OPTIONS, normalized.appearanceRadius)}
    ${select('appearanceFrame', 'Frame', APPEARANCE_FRAME_OPTIONS, normalized.appearanceFrame)}
    ${select('viewerChrome', 'Chrome', VIEWER_CHROME_OPTIONS, normalized.viewerChrome)}
  </div>
</details>`;
}

function buildEnhancementScript({ mermaid = true, appearanceOptions = {} } = {}) {
  const normalizedAppearance = normalizeAppearanceOptions(appearanceOptions);
  const appearanceValues = APPEARANCE_PRESET_OPTIONS.map((item) => item.value);
  const backgroundValues = APPEARANCE_BACKGROUND_OPTIONS.map((item) => item.value);
  const radiusValues = APPEARANCE_RADIUS_OPTIONS.map((item) => item.value);
  const frameValues = APPEARANCE_FRAME_OPTIONS.map((item) => item.value);
  const chromeValues = VIEWER_CHROME_OPTIONS.map((item) => item.value);
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

    const appearanceValues = ${JSON.stringify(appearanceValues)};
    const backgroundValues = ${JSON.stringify(backgroundValues)};
    const radiusValues = ${JSON.stringify(radiusValues)};
    const frameValues = ${JSON.stringify(frameValues)};
    const chromeValues = ${JSON.stringify(chromeValues)};
    const defaultAppearance = ${JSON.stringify(normalizedAppearance)};

    function normalizeChoice(value, allowed, fallback) {
      const normalized = String(value || '').trim().toLowerCase();
      return allowed.indexOf(normalized) >= 0 ? normalized : fallback;
    }

    function normalizeAppearance(raw) {
      const value = raw || {};
      return {
        appearance: normalizeChoice(value.appearance, appearanceValues, 'default'),
        appearanceBackground: normalizeChoice(value.appearanceBackground, backgroundValues, 'default'),
        appearanceRadius: normalizeChoice(value.appearanceRadius, radiusValues, 'default'),
        appearanceFrame: normalizeChoice(value.appearanceFrame, frameValues, 'default'),
        viewerChrome: normalizeChoice(value.viewerChrome, chromeValues, 'full'),
      };
    }

    function removePrefixedClasses(node, prefixes) {
      if (!node || !node.classList) return;
      Array.from(node.classList).forEach((name) => {
        if (prefixes.some((prefix) => name === prefix || name.startsWith(prefix + '-'))) {
          node.classList.remove(name);
        }
      });
    }

    function setDataAttr(node, name, value, defaultValue) {
      if (!node) return;
      if (!value || value === defaultValue) {
        node.removeAttribute(name);
      } else {
        node.setAttribute(name, value);
      }
    }

    function applyAppearance(raw) {
      const next = normalizeAppearance(raw);
      const root = document.querySelector('.studio-document');
      const prefixes = ['appearance', 'appearance-bg', 'appearance-radius', 'appearance-frame'];
      removePrefixedClasses(root, prefixes);
      removePrefixedClasses(document.body, prefixes.concat(['viewer-chrome']));

      if (next.appearance !== 'default') {
        root && root.classList.add('appearance-' + next.appearance);
        document.body.classList.add('appearance-' + next.appearance);
      }
      if (next.appearanceBackground !== 'default') {
        root && root.classList.add('appearance-bg-' + next.appearanceBackground);
        document.body.classList.add('appearance-bg-' + next.appearanceBackground);
      }
      if (next.appearanceRadius !== 'default') {
        root && root.classList.add('appearance-radius-' + next.appearanceRadius);
        document.body.classList.add('appearance-radius-' + next.appearanceRadius);
      }
      if (next.appearanceFrame !== 'default') {
        root && root.classList.add('appearance-frame-' + next.appearanceFrame);
        document.body.classList.add('appearance-frame-' + next.appearanceFrame);
      }
      if (next.viewerChrome !== 'full') {
        document.body.classList.add('viewer-chrome-' + next.viewerChrome);
      }

      setDataAttr(root, 'data-appearance', next.appearance, 'default');
      setDataAttr(root, 'data-appearance-background', next.appearanceBackground, 'default');
      setDataAttr(root, 'data-appearance-radius', next.appearanceRadius, 'default');
      setDataAttr(root, 'data-appearance-frame', next.appearanceFrame, 'default');
      setDataAttr(document.body, 'data-appearance', next.appearance, 'default');
      setDataAttr(document.body, 'data-appearance-background', next.appearanceBackground, 'default');
      setDataAttr(document.body, 'data-appearance-radius', next.appearanceRadius, 'default');
      setDataAttr(document.body, 'data-appearance-frame', next.appearanceFrame, 'default');
      setDataAttr(document.body, 'data-viewer-chrome', next.viewerChrome, 'full');
      window.dispatchEvent(new CustomEvent('mdStudioAppearanceChanged', { detail: next }));
      return next;
    }

    function readAppearanceControls(menu) {
      const read = (name) => {
        const control = menu && menu.querySelector('[data-appearance-control="' + name + '"]');
        return control ? control.value : '';
      };
      return normalizeAppearance({
        appearance: read('appearance') || defaultAppearance.appearance,
        appearanceBackground: read('appearanceBackground') || defaultAppearance.appearanceBackground,
        appearanceRadius: read('appearanceRadius') || defaultAppearance.appearanceRadius,
        appearanceFrame: read('appearanceFrame') || defaultAppearance.appearanceFrame,
        viewerChrome: read('viewerChrome') || defaultAppearance.viewerChrome,
      });
    }

    function bindStyleMenu() {
      const menu = document.querySelector('[data-export-style-menu]');
      if (!menu || menu.hasAttribute('data-appearance-bound')) return;
      menu.setAttribute('data-appearance-bound', '1');
      menu.addEventListener('change', (event) => {
        const target = event.target;
        if (!target || !target.matches || !target.matches('[data-appearance-control]')) return;
        applyAppearance(readAppearanceControls(menu));
      });
      applyAppearance(readAppearanceControls(menu));
    }

    bindStyleMenu();

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
      let activeLink = null;
      outlineLinks.forEach((link) => {
        const active = sectionId && link.dataset.outlineId === sectionId;
        link.classList.toggle('is-active', Boolean(active));
        if (active) {
          activeText = link.textContent || activeText;
          activeLink = link;
        }
      });
      if (outlineCurrent) {
        outlineCurrent.textContent = activeText;
        outlineCurrent.setAttribute('title', activeText);
      }
      if (activeLink && typeof activeLink.scrollIntoView === 'function') {
        activeLink.scrollIntoView({ block: 'nearest' });
      }
    };

    let index = 0;
    let nav = null;
    let prev = null;
    let next = null;
    let toggle = null;
    let count = null;
    let observer = null;
    let zoomLevel = null;
    let autoFitScale = 1;
    let autoFillScale = 1;
    let autoZoomMode = 'fit';
    const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    let zoomLabel = null;
    let zoomInBtn = null;
    let zoomOutBtn = null;
    let fitBtn = null;
    let fillBtn = null;
    let pageSep = null;
    let zoomSep = null;
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

    const decodeHashValue = (raw) => {
      let value = String(raw || '').replace(/^#/, '').trim();
      if (!value) return '';
      try {
        value = decodeURIComponent(value);
      } catch (_) {
        value = '';
      }
      return value;
    };

    const resolvePageIndexFromId = (id) => {
      const value = String(id || '').trim();
      if (!value || !pages.length) return -1;
      const exact = pages.findIndex((page) => String(page.id || '') === value);
      if (exact >= 0) return exact;
      const match = value.match(/^page-(\d+)$/i);
      if (!match) return -1;
      const numeric = Number(match[1]) - 1;
      if (!Number.isFinite(numeric)) return -1;
      return Math.min(Math.max(0, numeric), pages.length - 1);
    };

    function goToPage(nextIndex) {
      if (!pages.length) return;
      const parsed = Number(nextIndex);
      const bounded = Math.min(Math.max(0, Number.isFinite(parsed) ? parsed : 0), pages.length - 1);
      index = bounded;
      paint();
    }

    function updateZoomDisplay() {
      if (!zoomLabel) return;
      const isStacked = document.body.classList.contains('export-stacked');
      if (zoomLevel == null) {
        const scale = autoZoomMode === 'fill' ? autoFillScale : isStacked ? 1 : autoFitScale;
        const pct = Math.round(scale * 100);
        if (isStacked) {
          zoomLabel.textContent = autoZoomMode === 'fill' ? 'Fill (' + pct + '%)' : pct + '%';
        } else {
          zoomLabel.textContent = autoZoomMode === 'fill' ? 'Fill (' + pct + '%)' : 'Fit (' + pct + '%)';
        }
      } else {
        zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
      }
      if (fitBtn) fitBtn.classList.toggle('is-active', zoomLevel == null && autoZoomMode === 'fit');
      if (fillBtn) fillBtn.classList.toggle('is-active', zoomLevel == null && autoZoomMode === 'fill');
    }

    function updateControlState() {
      if (!nav) return;
      const isStacked = document.body.classList.contains('export-stacked');
      const hasSlides = pages.length > 1;
      nav.classList.toggle('is-stack-mode', isStacked);
      nav.classList.toggle('is-slides-mode', !isStacked && hasSlides);
      if (prev) prev.hidden = isStacked || !hasSlides;
      if (next) next.hidden = isStacked || !hasSlides;
      if (count) count.hidden = isStacked || !hasSlides;
      if (pageSep) pageSep.hidden = isStacked || !hasSlides;
      if (toggle) {
        toggle.hidden = !hasSlides;
        toggle.textContent = isStacked ? 'Slides' : 'Stack';
      }
      if (fitBtn) fitBtn.hidden = false;
      if (fillBtn) fillBtn.hidden = isStacked;
      if (zoomSep) zoomSep.hidden = false;
    }

    function applyZoom(level) {
      zoomLevel = level;
      updateScale();
    }

    function applyAutoZoom(mode) {
      const isStacked = document.body.classList.contains('export-stacked');
      autoZoomMode = mode === 'fill' && !isStacked ? 'fill' : 'fit';
      applyZoom(null);
    }

    function getCurrentAutoScale(isStacked) {
      if (autoZoomMode === 'fill') return autoFillScale;
      return isStacked ? 1 : autoFitScale;
    }

    function clampZoom(scale) {
      const parsed = Number(scale);
      if (!Number.isFinite(parsed) || parsed <= 0) return 1;
      return Math.max(0.25, Math.min(2, Number(parsed.toFixed(4))));
    }

    function zoomIn() {
      const isStacked = document.body.classList.contains('export-stacked');
      const current = zoomLevel != null ? zoomLevel : getCurrentAutoScale(isStacked);
      const nxt = ZOOM_STEPS.find((s) => s > current + 0.001);
      if (nxt != null) applyZoom(nxt);
    }

    function zoomOut() {
      const isStacked = document.body.classList.contains('export-stacked');
      const current = zoomLevel != null ? zoomLevel : getCurrentAutoScale(isStacked);
      const steps = ZOOM_STEPS.slice().reverse();
      const prv = steps.find((s) => s < current - 0.001);
      if (prv != null) {
        if (!isStacked && autoZoomMode === 'fit' && prv <= autoFitScale + 0.001) {
          applyZoom(null);
        } else {
          applyZoom(prv);
        }
      } else {
        applyZoom(null);
      }
    }

    function updateScale() {
      if (!rootDocument) return;
      const isStacked = document.body.classList.contains('export-stacked');
      const basePadding = parseFloat(getComputedStyle(document.body).paddingLeft || '0');
      const bodyPadding = basePadding * 2;
      const navHeight = 60;
      const availableWidth = Math.max(120, window.innerWidth - bodyPadding - 8);

      if (isStacked) {
        autoFillScale = 1;
        if (autoZoomMode === 'fill') autoZoomMode = 'fit';
        const scale = zoomLevel != null ? zoomLevel : 1;
        document.documentElement.style.setProperty('--stacked-zoom', String(scale));
        rootDocument.style.removeProperty('--page-scale');
        document.body.classList.remove('export-slides-overflow');
        document.body.style.paddingRight = '';
        updateZoomDisplay();
        return;
      }

      const styles = getComputedStyle(rootDocument);
      const width = parseFloat(styles.getPropertyValue('--page-width')) || 0;
      const height = parseFloat(styles.getPropertyValue('--page-height')) || 0;
      if (!width || !height) {
        rootDocument.style.setProperty('--page-scale', '1');
        document.body.style.paddingRight = '';
        autoFitScale = 1;
        autoFillScale = 1;
        updateZoomDisplay();
        return;
      }
      const availableHeight = Math.max(120, window.innerHeight - navHeight - 40);
      const fitScale = Math.min(1, availableWidth / width, availableHeight / height);
      autoFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
      autoFillScale = clampZoom(availableWidth / Math.max(1, width));
      const finalScale = zoomLevel != null ? zoomLevel : autoZoomMode === 'fill' ? autoFillScale : autoFitScale;
      rootDocument.style.setProperty('--page-scale', String(finalScale));
      document.body.classList.toggle('export-slides-overflow', finalScale > autoFitScale * 1.01);
      document.body.style.paddingRight = '';
      updateZoomDisplay();
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
      updateControlState();
      const currentSectionId = currentSectionFromPage(pages[index]);
      setActiveOutline(currentSectionId);
      updateHash(currentSectionId || (pages[index] && pages[index].id) || '');
    }

    function move(delta) {
      if (document.body.classList.contains('export-stacked')) return;
      goToPage(index + delta);
    }

    function resetZoomForModeSwitch(stacked) {
      zoomLevel = null;
      autoZoomMode = 'fit';
      autoFillScale = 1;
      document.body.classList.remove('export-slides-overflow');
      document.documentElement.style.setProperty('--stacked-zoom', '1');
      if (rootDocument) {
        rootDocument.style.removeProperty('--page-scale');
      }
      window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    }

    function switchMode(stacked) {
      const wasStacked = document.body.classList.contains('export-stacked');
      if (wasStacked !== stacked) resetZoomForModeSwitch(stacked);
      document.body.classList.toggle('export-stacked', stacked);
      document.body.classList.toggle('export-slides', !stacked && pages.length > 1);
      updateControlState();
      if (stacked) {
        unbindStackObserver();
        bindStackObserver();
        updateScale();
      } else {
        unbindStackObserver();
        paint();
      }
    }

    nav = document.createElement('div');
    nav.className = 'export-slide-nav';
    nav.innerHTML =
      '<button type="button" data-action="prev">&#8249;</button>' +
      '<span class="count">1 / 1</span>' +
      '<button type="button" data-action="next">&#8250;</button>' +
      '<span class="nav-sep nav-sep-pages"></span>' +
      '<button type="button" data-action="zoom-out" title="Zoom Out (Ctrl+-)">&#8722;</button>' +
      '<span class="zoom-label">Fit</span>' +
      '<button type="button" data-action="zoom-in" title="Zoom In (Ctrl+=)">+</button>' +
      '<button type="button" data-action="zoom-fit" title="Fit to Window (Ctrl+0)">Fit</button>' +
      '<button type="button" data-action="zoom-fill" title="Fill Width (Ctrl+9)">Fill</button>' +
      '<span class="nav-sep nav-sep-zoom"></span>' +
      '<button type="button" data-action="toggle">Stack</button>';
    document.body.appendChild(nav);
    prev = nav.querySelector('[data-action="prev"]');
    next = nav.querySelector('[data-action="next"]');
    toggle = nav.querySelector('[data-action="toggle"]');
    count = nav.querySelector('.count');
    zoomLabel = nav.querySelector('.zoom-label');
    zoomInBtn = nav.querySelector('[data-action="zoom-in"]');
    zoomOutBtn = nav.querySelector('[data-action="zoom-out"]');
    fitBtn = nav.querySelector('[data-action="zoom-fit"]');
    fillBtn = nav.querySelector('[data-action="zoom-fill"]');
    pageSep = nav.querySelector('.nav-sep-pages');
    zoomSep = nav.querySelector('.nav-sep-zoom');
    prev.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    toggle.addEventListener('click', () => {
      switchMode(!document.body.classList.contains('export-stacked'));
    });
    zoomInBtn.addEventListener('click', zoomIn);
    zoomOutBtn.addEventListener('click', zoomOut);
    fitBtn.addEventListener('click', () => applyAutoZoom('fit'));
    fillBtn.addEventListener('click', () => applyAutoZoom('fill'));

    if (pages.length >= 2) {
      document.body.classList.add('has-js-slides');
      switchMode(false);
      if (outline) {
        outline.classList.add('is-collapsed');
        if (outlineToggle) outlineToggle.textContent = 'Show';
      }
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

    document.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a[href^="#page-"]') : null;
      if (!link) return;
      const href = String(link.getAttribute('href') || '').trim();
      const hashId = decodeHashValue(href);
      const pageIndex = resolvePageIndexFromId(hashId);
      if (pageIndex < 0) return;
      event.preventDefault();
      if (document.body.classList.contains('export-stacked')) {
        const targetPage = pages[pageIndex];
        if (targetPage && typeof targetPage.scrollIntoView === 'function') {
          targetPage.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
        }
        updateHash((targetPage && targetPage.id) || hashId);
        return;
      }
      goToPage(pageIndex);
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
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (ctrl && event.key === '-') {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (ctrl && event.key === '0') {
        event.preventDefault();
        applyAutoZoom('fit');
        return;
      }
      if (ctrl && event.key === '9') {
        event.preventDefault();
        applyAutoZoom('fill');
        return;
      }
      if (!ctrl) {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
          event.preventDefault();
          move(-1);
        } else if (String(event.key || '').toLowerCase() === 's' && toggle) {
          toggle.click();
        }
      }
    });
    window.addEventListener('resize', () => {
      updateScale();
    });

    setActiveOutline(currentSectionFromPage(pages[index] || null));
    let initialHash = decodeHashValue(window.location.hash || '');
    if (initialHash) {
      const pageIndex = resolvePageIndexFromId(initialHash);
      if (pageIndex >= 0) {
        if (pages.length > 1 && !document.body.classList.contains('export-stacked')) {
          goToPage(pageIndex);
        } else {
          const pageTarget = pages[pageIndex] || document.getElementById(initialHash);
          if (pageTarget && typeof pageTarget.scrollIntoView === 'function') {
            pageTarget.scrollIntoView({ behavior: 'auto', block: 'start' });
          }
        }
      } else {
        const resolved = targetCache.get(initialHash) || { target: null, pageIndex: -1 };
        const target = resolved.target || resolveOutlineTarget(initialHash);
        if (target) {
          if (pages.length > 1 && !document.body.classList.contains('export-stacked') && resolved.pageIndex >= 0) {
            goToPage(resolved.pageIndex);
          } else {
            target.scrollIntoView({ behavior: 'auto', block: 'start' });
            setActiveOutline(initialHash);
          }
        }
      }
    }

    window.addEventListener('hashchange', () => {
      const hashId = decodeHashValue(window.location.hash || '');
      if (!hashId || document.body.classList.contains('export-stacked')) return;
      const pageIndex = resolvePageIndexFromId(hashId);
      if (pageIndex >= 0) {
        goToPage(pageIndex);
      }
    });

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
  appearance = {},
} = {}) {
  const normalizedAppearance = normalizeAppearanceOptions(appearance);
  const bodyAttrs = buildAppearanceBodyAttributes(normalizedAppearance);
  const bodyClass = bodyAttrs.className ? ` class="${escapeHtml(bodyAttrs.className)}"` : '';
  const bodyData = bodyAttrs.attrs ? ` ${bodyAttrs.attrs}` : '';
  const fallbackNav =
    pageCount > 1
      ? `
<nav class="export-fallback-nav" aria-label="Page navigation">
  <span>Pages:</span>
  ${Array.from({ length: pageCount }, (_, index) => `<a href="#page-${index + 1}">${index + 1}</a>`).join('')}
</nav>`
      : '';
  const outlineHtml = buildOutlineHtml(outlineItems);
  const styleMenuHtml = buildStyleMenuHtml(normalizedAppearance);
  const warningItems = Array.isArray(exportWarnings) ? exportWarnings.filter(Boolean) : [];
  const warningHtml = warningItems.length
    ? `
<aside class="export-warning" role="status" aria-live="polite">
  <strong>변환 품질 안내</strong>
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
    body.appearance-clean,
    body.appearance-flat,
    body.appearance-reader {
      background: #f8fafc;
    }
    body.appearance-print,
    body.appearance-bg-plain {
      background: #ffffff;
    }
    body.appearance-bg-transparent {
      background: transparent;
    }
    ${cssText}
    body.export-slides {
      background: #edf2f9;
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
      min-height: var(--page-height, ${DEFAULT_PAGE_HEIGHT});
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
      background: rgba(255, 255, 255, 0.92);
      color: #1e293b;
      border: 1px solid rgba(191, 203, 222, 0.8);
      border-radius: 999px;
      padding: 8px 10px;
      backdrop-filter: blur(8px);
      box-shadow: 0 2px 12px rgba(30, 41, 59, 0.1);
    }
    .export-slide-nav.is-stack-mode {
      gap: 6px;
      padding: 7px 9px;
    }
    .export-slide-nav button {
      border: 1px solid rgba(191, 203, 222, 0.8);
      background: #f1f5fb;
      color: #1e293b;
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
    .export-slide-nav .nav-sep {
      width: 1px;
      height: 18px;
      background: rgba(148, 163, 184, 0.4);
      margin: 0 2px;
      flex-shrink: 0;
    }
    .export-slide-nav .zoom-label {
      min-width: 76px;
      text-align: center;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: #5b677c;
    }
    .export-slide-nav button[data-action="zoom-fit"].is-active,
    .export-slide-nav button[data-action="zoom-fill"].is-active {
      background: rgba(58, 99, 214, 0.12);
      border-color: rgba(58, 99, 214, 0.4);
      color: #3a63d6;
    }
    .export-style-menu {
      position: fixed;
      top: 14px;
      left: 14px;
      z-index: 32;
      width: min(238px, calc(100vw - 28px));
      color: #1e293b;
      font-size: 12px;
      font-family: Inter, Pretendard, 'Noto Sans KR', system-ui, sans-serif;
    }
    .export-style-menu summary {
      width: max-content;
      list-style: none;
      cursor: pointer;
      border: 1px solid rgba(191, 203, 222, 0.88);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      padding: 8px 12px;
      box-shadow: 0 2px 12px rgba(30, 41, 59, 0.09);
      backdrop-filter: blur(8px);
      font-weight: 800;
    }
    .export-style-menu summary::-webkit-details-marker {
      display: none;
    }
    .export-style-menu[open] summary {
      margin-bottom: 8px;
    }
    .export-style-menu .style-menu-grid {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(191, 203, 222, 0.88);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 10px 28px rgba(30, 41, 59, 0.14);
      backdrop-filter: blur(10px);
    }
    .export-style-menu label {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    .export-style-menu label span {
      color: #5b677c;
      font-weight: 700;
    }
    .export-style-menu select {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(191, 203, 222, 0.9);
      border-radius: 7px;
      background: #f8fafc;
      color: #1e293b;
      padding: 6px 8px;
      font: inherit;
    }
    body.export-stacked .studio-document {
      transform-origin: top center;
      transform: scale(var(--stacked-zoom, 1));
      width: calc(100% / var(--stacked-zoom, 1));
    }
    body.export-slides.export-slides-overflow {
      align-items: flex-start;
      overflow: auto;
      padding-top: 20px;
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
      border: 1px solid rgba(191, 203, 222, 0.8);
      background: rgba(255, 255, 255, 0.92);
      color: #1e293b;
      backdrop-filter: blur(8px);
      font-size: 12px;
      box-shadow: 0 2px 12px rgba(30, 41, 59, 0.1);
    }
    .export-fallback-nav a {
      color: #3a63d6;
      text-decoration: none;
      border: 1px solid rgba(191, 203, 222, 0.8);
      border-radius: 999px;
      padding: 4px 8px;
      background: #f1f5fb;
    }
    body.has-js-slides .export-fallback-nav {
      display: none;
    }
    .export-outline {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 28;
      width: min(260px, 28vw);
      max-height: calc(100vh - 112px);
      overflow: auto;
      padding: 8px;
      border-radius: 12px;
      border: 1px solid rgba(191, 203, 222, 0.8);
      background: rgba(255, 255, 255, 0.88);
      color: #1e293b;
      backdrop-filter: blur(8px);
      box-shadow: 0 2px 12px rgba(30, 41, 59, 0.08);
    }
    .export-outline .outline-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .export-outline .outline-head strong {
      font-size: 13px;
    }
    .export-outline .outline-head button {
      border: 1px solid rgba(191, 203, 222, 0.8);
      background: #f1f5fb;
      color: #1e293b;
      border-radius: 999px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .export-outline .outline-current {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      color: #5b677c;
      margin-bottom: 7px;
    }
    .export-outline .outline-links {
      display: grid;
      gap: 4px;
    }
    .export-outline .outline-links a {
      color: #1e293b;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 5px 7px;
      border-radius: 7px;
      border: 1px solid transparent;
      background: rgba(30, 41, 59, 0.04);
      font-size: 12px;
      line-height: 1.25;
    }
    .export-outline .outline-links a.outline-depth-3 { padding-left: 16px; }
    .export-outline .outline-links a.outline-depth-4 { padding-left: 25px; }
    .export-outline .outline-links a.outline-depth-5 { padding-left: 34px; }
    .export-outline .outline-links a.outline-depth-6 { padding-left: 43px; }
    .export-outline .outline-links a.is-active {
      border-color: rgba(58, 99, 214, 0.5);
      background: rgba(58, 99, 214, 0.14);
      color: #284fcb;
      font-weight: 700;
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
      padding: 24px 24px 84px;
    }
    body.export-stacked .studio-document {
      width: calc(100% / var(--stacked-zoom, 1));
      height: auto;
    }
    body.export-stacked .document-shell.is-paginated {
      display: grid;
      max-width: 980px;
      gap: 20px;
      height: auto;
      justify-items: stretch;
    }
    body.export-stacked .doc-page {
      display: grid;
      width: 100%;
      height: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      grid-template-rows: auto;
    }
    body.export-stacked .doc-page-inner {
      height: auto;
      min-height: 0;
      overflow: visible;
    }
    body.export-stacked .doc-page-footer {
      display: none;
    }
    body.viewer-chrome-minimal .export-outline:not(.is-collapsed) {
      width: auto;
      max-width: 160px;
    }
    body.viewer-chrome-minimal .export-outline .outline-current,
    body.viewer-chrome-minimal .export-outline .outline-links,
    body.viewer-chrome-minimal .export-fallback-nav {
      display: none !important;
    }
    body.viewer-chrome-minimal .export-slide-nav {
      opacity: 0.72;
    }
    body.viewer-chrome-hidden .export-outline,
    body.viewer-chrome-hidden .export-slide-nav,
    body.viewer-chrome-hidden .export-fallback-nav,
    body.viewer-chrome-hidden .export-warning {
      display: none !important;
    }
    .mermaid-block .mermaid-render {
      min-height: 24px;
    }
    .mermaid-block .mermaid-fallback[hidden] {
      display: none !important;
    }
    @media (max-width: 980px) {
      .export-outline {
        width: min(230px, 38vw);
      }
    }
    @media (max-width: 680px) {
      body {
        padding: 12px;
      }
      body.export-slides {
        padding: 8px;
      }
      body.export-stacked {
        padding: 12px;
      }
      .export-outline {
        top: 8px;
        right: 8px;
        width: min(180px, 48vw);
        max-height: calc(100vh - 80px);
        padding: 8px;
        font-size: 12px;
      }
      .export-outline .outline-links a {
        font-size: 12px;
        padding: 4px 6px;
      }
      .export-slide-nav {
        right: 8px;
        bottom: 8px;
        padding: 6px 8px;
        gap: 6px;
        max-width: calc(100vw - 16px);
        overflow-x: auto;
      }
      .export-slide-nav button {
        padding: 5px 8px;
        font-size: 12px;
      }
      .export-fallback-nav {
        left: 8px;
        bottom: 8px;
      }
      .export-style-menu {
        top: 8px;
        left: 8px;
        width: min(224px, calc(100vw - 16px));
      }
    }
    @media (max-width: 480px) {
      body {
        padding: 8px;
      }
      body.export-stacked {
        padding: 8px;
      }
      .export-outline {
        top: 6px;
        right: 6px;
        width: min(148px, 54vw);
      }
      .export-outline.is-collapsed {
        max-width: 80px;
      }
      .export-slide-nav .count {
        min-width: 44px;
        font-size: 12px;
      }
    }
  </style>
</head>
<body${bodyClass}${bodyData}>
${renderedHtml}
${styleMenuHtml}
${fallbackNav}
${outlineHtml}
${warningHtml}
<script>
${buildEnhancementScript({ mermaid: enableMermaid, appearanceOptions: normalizedAppearance })}
</script>
</body>
</html>`;
}
