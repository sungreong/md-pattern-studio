export const APPEARANCE_PRESET_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'clean', label: 'Clean' },
  { value: 'flat', label: 'Flat' },
  { value: 'reader', label: 'Reader' },
  { value: 'print', label: 'Print' },
];

export const APPEARANCE_BACKGROUND_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'plain', label: 'Plain' },
  { value: 'transparent', label: 'Transparent' },
];

export const APPEARANCE_RADIUS_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'soft', label: 'Soft' },
  { value: 'none', label: 'None' },
];

export const APPEARANCE_FRAME_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'lines', label: 'Lines' },
  { value: 'none', label: 'None' },
];

export const VIEWER_CHROME_OPTIONS = [
  { value: 'full', label: 'Full' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'hidden', label: 'Hidden' },
];

const APPEARANCE_VALUES = APPEARANCE_PRESET_OPTIONS.map((item) => item.value);
const BACKGROUND_VALUES = APPEARANCE_BACKGROUND_OPTIONS.map((item) => item.value);
const RADIUS_VALUES = APPEARANCE_RADIUS_OPTIONS.map((item) => item.value);
const FRAME_VALUES = APPEARANCE_FRAME_OPTIONS.map((item) => item.value);
const CHROME_VALUES = VIEWER_CHROME_OPTIONS.map((item) => item.value);

export const DEFAULT_APPEARANCE_OPTIONS = Object.freeze({
  appearance: 'default',
  appearanceBackground: 'default',
  appearanceRadius: 'default',
  appearanceFrame: 'default',
  viewerChrome: 'full',
});

export function normalizeAppearanceOptions(options = {}, meta = {}) {
  return {
    appearance: normalizeChoice(
      readOptionValue(options, meta, ['appearance']),
      APPEARANCE_VALUES,
      DEFAULT_APPEARANCE_OPTIONS.appearance,
    ),
    appearanceBackground: normalizeChoice(
      readOptionValue(options, meta, ['appearanceBackground', 'appearance-background']),
      BACKGROUND_VALUES,
      DEFAULT_APPEARANCE_OPTIONS.appearanceBackground,
    ),
    appearanceRadius: normalizeChoice(
      readOptionValue(options, meta, ['appearanceRadius', 'appearance-radius']),
      RADIUS_VALUES,
      DEFAULT_APPEARANCE_OPTIONS.appearanceRadius,
    ),
    appearanceFrame: normalizeChoice(
      readOptionValue(options, meta, ['appearanceFrame', 'appearance-frame']),
      FRAME_VALUES,
      DEFAULT_APPEARANCE_OPTIONS.appearanceFrame,
    ),
    viewerChrome: normalizeChoice(
      readOptionValue(options, meta, ['viewerChrome', 'viewer-chrome']),
      CHROME_VALUES,
      DEFAULT_APPEARANCE_OPTIONS.viewerChrome,
    ),
  };
}

export function getAppearanceClassNames(options = {}, settings = {}) {
  const normalized = normalizeAppearanceOptions(options);
  const classes = [];
  if (normalized.appearance !== DEFAULT_APPEARANCE_OPTIONS.appearance) {
    classes.push(`appearance-${normalized.appearance}`);
  }
  if (normalized.appearanceBackground !== DEFAULT_APPEARANCE_OPTIONS.appearanceBackground) {
    classes.push(`appearance-bg-${normalized.appearanceBackground}`);
  }
  if (normalized.appearanceRadius !== DEFAULT_APPEARANCE_OPTIONS.appearanceRadius) {
    classes.push(`appearance-radius-${normalized.appearanceRadius}`);
  }
  if (normalized.appearanceFrame !== DEFAULT_APPEARANCE_OPTIONS.appearanceFrame) {
    classes.push(`appearance-frame-${normalized.appearanceFrame}`);
  }
  if (settings.includeViewerChrome && normalized.viewerChrome !== DEFAULT_APPEARANCE_OPTIONS.viewerChrome) {
    classes.push(`viewer-chrome-${normalized.viewerChrome}`);
  }
  return classes;
}

export function getAppearanceDataAttributes(options = {}, settings = {}) {
  const normalized = normalizeAppearanceOptions(options);
  const attrs = [];
  if (normalized.appearance !== DEFAULT_APPEARANCE_OPTIONS.appearance) {
    attrs.push(`data-appearance="${normalized.appearance}"`);
  }
  if (normalized.appearanceBackground !== DEFAULT_APPEARANCE_OPTIONS.appearanceBackground) {
    attrs.push(`data-appearance-background="${normalized.appearanceBackground}"`);
  }
  if (normalized.appearanceRadius !== DEFAULT_APPEARANCE_OPTIONS.appearanceRadius) {
    attrs.push(`data-appearance-radius="${normalized.appearanceRadius}"`);
  }
  if (normalized.appearanceFrame !== DEFAULT_APPEARANCE_OPTIONS.appearanceFrame) {
    attrs.push(`data-appearance-frame="${normalized.appearanceFrame}"`);
  }
  if (settings.includeViewerChrome && normalized.viewerChrome !== DEFAULT_APPEARANCE_OPTIONS.viewerChrome) {
    attrs.push(`data-viewer-chrome="${normalized.viewerChrome}"`);
  }
  return attrs;
}

export function buildAppearanceRootAttributes(options = {}) {
  const className = getAppearanceClassNames(options).join(' ');
  const attrs = getAppearanceDataAttributes(options).join(' ');
  return {
    className,
    attrs,
  };
}

export function buildAppearanceBodyAttributes(options = {}) {
  const className = getAppearanceClassNames(options, { includeViewerChrome: true }).join(' ');
  const attrs = getAppearanceDataAttributes(options, { includeViewerChrome: true }).join(' ');
  return {
    className,
    attrs,
  };
}

export function buildAppearanceCliArgs(options = {}) {
  const normalized = normalizeAppearanceOptions(options);
  const args = [];
  if (normalized.appearance !== DEFAULT_APPEARANCE_OPTIONS.appearance) {
    args.push('--appearance', normalized.appearance);
  }
  if (normalized.appearanceBackground !== DEFAULT_APPEARANCE_OPTIONS.appearanceBackground) {
    args.push('--appearance-background', normalized.appearanceBackground);
  }
  if (normalized.appearanceRadius !== DEFAULT_APPEARANCE_OPTIONS.appearanceRadius) {
    args.push('--appearance-radius', normalized.appearanceRadius);
  }
  if (normalized.appearanceFrame !== DEFAULT_APPEARANCE_OPTIONS.appearanceFrame) {
    args.push('--appearance-frame', normalized.appearanceFrame);
  }
  if (normalized.viewerChrome !== DEFAULT_APPEARANCE_OPTIONS.viewerChrome) {
    args.push('--viewer-chrome', normalized.viewerChrome);
  }
  return args;
}

function readOptionValue(options = {}, meta = {}, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key) && options[key] !== '' && options[key] != null) {
      return options[key];
    }
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] !== '' && meta[key] != null) {
      return meta[key];
    }
  }
  return undefined;
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}
