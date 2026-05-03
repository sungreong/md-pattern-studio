#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SKILL_ROOT = path.join(repoRoot, 'ai_skills', 'claude', 'skills', 'md-presentation-composer');
const DESIGN_ROOT = path.join(SKILL_ROOT, 'references', 'design-md');
const RAW_ROOT = path.join(DESIGN_ROOT, 'raw');
const SOURCE_INDEX_PATH = path.join(DESIGN_ROOT, 'source-index.json');
const MANIFEST_PATH = path.join(DESIGN_ROOT, 'manifest.json');
const BRAND_JS_PATH = path.join(repoRoot, 'public', 'core', 'brand-designs.js');

const SYSTEM_SANS = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SYSTEM_SERIF = "Georgia, 'Times New Roman', serif";
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

const ARCHETYPES = [
  {
    id: 'monochrome-precision',
    title: 'Monochrome Precision',
    slugs: ['vercel', 'linear.app', 'uber', 'x.ai', 'hashicorp', 'cal', 'ollama'],
    theme: 'mono',
    intent: 'pitch',
    templates: ['cover', 'message', 'compare', 'three-column', 'stats'],
    useFor: 'developer platforms, infrastructure narratives, strategy decks that need restraint and precision',
    pptMove: 'Use wide whitespace, hard contrast, short headlines, thin dividers, and restrained cards.',
    avoid: 'Avoid decorative gradients, overloaded icons, and colorful accents without a semantic role.',
  },
  {
    id: 'dark-developer',
    title: 'Dark Developer',
    slugs: ['cursor', 'supabase', 'expo', 'warp', 'resend', 'opencode.ai', 'voltagent', 'composio'],
    theme: 'charcoal',
    intent: 'reference',
    templates: ['dark', 'code', 'timeline', 'icon-list', 'stats'],
    useFor: 'technical decks, product architecture, developer tooling, API walkthroughs',
    pptMove: 'Lead with a dark cover, use code-like labels, compact spacing, and high-contrast accent cards.',
    avoid: 'Avoid washed-out mid grays and long centered paragraphs.',
  },
  {
    id: 'data-dashboard',
    title: 'Data Dashboard',
    slugs: ['sentry', 'kraken', 'clickhouse', 'ibm', 'cohere', 'coinbase', 'revolut', 'binance'],
    theme: 'report',
    intent: 'report',
    templates: ['stats', 'table-fit', 'compare', 'timeline', 'card'],
    useFor: 'metrics reports, operating reviews, analytics, risk and monitoring updates',
    pptMove: 'Prioritize stat grids, compact tables, alert colors, and clear hierarchy over hero-like composition.',
    avoid: 'Avoid oversized hero slides when the reader needs fast comparison.',
  },
  {
    id: 'editorial-magazine',
    title: 'Editorial / Magazine',
    slugs: ['wired', 'theverge', 'sanity', 'mintlify'],
    theme: 'paper',
    intent: 'narrative',
    templates: ['cover', 'quote-slide', 'two-column', 'card', 'message'],
    useFor: 'thought leadership, research narratives, content strategy, explanatory decks',
    pptMove: 'Use strong section titles, pull quotes, editorial rhythm, dense but readable text blocks, and captions.',
    avoid: 'Avoid dashboard density and generic SaaS cards.',
  },
  {
    id: 'photography-led-premium',
    title: 'Photography-Led Premium',
    slugs: ['apple', 'airbnb', 'nike', 'tesla', 'spacex', 'meta', 'pinterest', 'playstation'],
    theme: 'default',
    intent: 'pitch',
    templates: ['half-bleed', 'cover', 'message', 'spotlight', 'quote-slide'],
    useFor: 'product launches, consumer stories, brand narratives, visual case studies',
    pptMove: 'Anchor thin content with half-bleed images, cinematic whitespace, and one message per slide.',
    avoid: 'Avoid replacing missing imagery with decorative shapes; the visual must carry meaning.',
  },
  {
    id: 'fintech-trust',
    title: 'Fintech Trust',
    slugs: ['stripe', 'mastercard', 'wise', 'coinbase', 'revolut', 'kraken', 'binance'],
    theme: 'midnight',
    intent: 'pitch',
    templates: ['stats', 'compare', 'card', 'timeline', 'message'],
    useFor: 'finance, payment, trust, compliance, growth and business model decks',
    pptMove: 'Pair clean surfaces with one confident accent, numeric proof, and trust-building comparison slides.',
    avoid: 'Avoid playful decoration that weakens credibility.',
  },
  {
    id: 'playful-product',
    title: 'Playful Product',
    slugs: ['figma', 'miro', 'airtable', 'zapier', 'posthog', 'lovable', 'clay', 'framer', 'webflow', 'intercom'],
    theme: 'coral',
    intent: 'pitch',
    templates: ['icon-list', 'three-column', 'agenda', 'timeline', 'half-bleed'],
    useFor: 'creative tooling, product onboarding, feature launches, collaboration workflows',
    pptMove: 'Use icon lists, friendly accents, rounded cards, and visual variety without lowering information quality.',
    avoid: 'Avoid making every slide equally colorful; reserve color for structure and delight.',
  },
  {
    id: 'luxury-automotive',
    title: 'Luxury / Automotive',
    slugs: ['ferrari', 'lamborghini', 'bmw', 'bmw-m', 'bugatti', 'renault'],
    theme: 'berry',
    intent: 'pitch',
    templates: ['dark', 'half-bleed', 'cover', 'message', 'compare'],
    useFor: 'premium launches, executive storytelling, high-stakes brand or product reveals',
    pptMove: 'Use dark slides, monumental type, restrained copy, and strong contrast with one brand accent.',
    avoid: 'Avoid dense tables unless the deck deliberately shifts into appendix/report mode.',
  },
  {
    id: 'green-systems',
    title: 'Green Systems',
    slugs: ['spotify', 'starbucks', 'mongodb', 'nvidia', 'shopify', 'supabase'],
    theme: 'forest',
    intent: 'pitch',
    templates: ['dark', 'stats', 'icon-list', 'timeline', 'card'],
    useFor: 'platform growth, ecosystem decks, sustainability, commerce and technical power narratives',
    pptMove: 'Let green act as a strong system signal, balanced by black, cream, or neutral surfaces.',
    avoid: 'Avoid tinting every surface green; it quickly becomes one-note.',
  },
  {
    id: 'ai-cinematic',
    title: 'AI Cinematic',
    slugs: ['claude', 'mistral.ai', 'minimax', 'elevenlabs', 'runwayml', 'replicate', 'together.ai'],
    theme: 'slate',
    intent: 'narrative',
    templates: ['dark', 'message', 'half-bleed', 'timeline', 'icon-list'],
    useFor: 'AI product narratives, model capability decks, creative technology presentations',
    pptMove: 'Use strong mood, dark/light contrast, capability sequences, and one clear proof slide per claim.',
    avoid: 'Avoid vague futuristic decoration without product or capability evidence.',
  },
  {
    id: 'telecom-bold',
    title: 'Telecom / Bold Consumer',
    slugs: ['vodafone'],
    theme: 'cherry',
    intent: 'pitch',
    templates: ['dark', 'message', 'stats', 'compare', 'agenda'],
    useFor: 'consumer-scale announcements, market positioning, direct CTA-heavy decks',
    pptMove: 'Use big red chapter bands, concise copy, and high-contrast calls to action.',
    avoid: 'Avoid small, delicate accents that dilute the signal.',
  },
];

const THEME_BY_ARCHETYPE = new Map(ARCHETYPES.map((item) => [item.id, item.theme]));

function assertInsideRepo(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(repoRoot)) {
    throw new Error(`Refusing to write outside repository: ${resolved}`);
  }
  return resolved;
}

function parseFrontmatter(content = '') {
  const text = String(content || '');
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 5);
  const meta = {};
  let block = '';
  for (const line of raw.split('\n')) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      block = top[1];
      const value = top[2].trim();
      if (value) meta[block] = stripQuotes(value);
      else meta[block] = {};
      continue;
    }
    const nested = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (nested && block) {
      if (!meta[block] || typeof meta[block] !== 'object') meta[block] = {};
      meta[block][nested[1]] = stripQuotes(nested[2]);
    }
  }
  return { meta, body };
}

function stripQuotes(value = '') {
  return String(value).trim().replace(/^["']|["']$/g, '');
}

function slugToTitle(slug = '') {
  return String(slug)
    .split(/[.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractHeadings(content = '') {
  return String(content)
    .split('\n')
    .map((line) => line.match(/^(#{2,3})\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => ({
      depth: match[1].length,
      title: match[2].replace(/\s*\{[^{}]+\}\s*$/, '').trim(),
    }));
}

function extractColors(content = '', frontmatter = {}) {
  const colors = [];
  if (frontmatter.colors && typeof frontmatter.colors === 'object') {
    for (const [role, value] of Object.entries(frontmatter.colors)) {
      const hex = String(value || '').match(/#[0-9a-fA-F]{6}\b/)?.[0];
      if (hex) colors.push({ role, hex: hex.toLowerCase(), source: 'frontmatter' });
    }
  }

  const colorRe = /(?:\*\*([^*]+)\*\*\s*)?\(`?(#[0-9a-fA-F]{6})`?\)|(?:^|\s)([A-Za-z][A-Za-z0-9 /_-]{1,48})[:：]\s*`?(#[0-9a-fA-F]{6})`?/g;
  for (const match of content.matchAll(colorRe)) {
    const role = (match[1] || match[3] || 'color').trim();
    const hex = (match[2] || match[4] || '').toLowerCase();
    if (hex) colors.push({ role, hex, source: 'markdown' });
  }

  for (const match of content.matchAll(/\b(#[0-9a-fA-F]{6})\b/g)) {
    colors.push({ role: 'mentioned', hex: match[1].toLowerCase(), source: 'scan' });
  }

  return uniqueBy(colors, (item) => `${item.role.toLowerCase()}::${item.hex}`).slice(0, 36);
}

function hexToRgb(hex = '') {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hexA, hexB, amount = 0.5) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA || hexB || '#ffffff';
  return rgbToHex({
    r: a.r * (1 - amount) + b.r * amount,
    g: a.g * (1 - amount) + b.g * amount,
    b: a.b * (1 - amount) + b.b * amount,
  });
}

function luminance(hex = '') {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const values = [rgb.r, rgb.g, rgb.b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function saturationScore(hex = '') {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return (max - min) / Math.max(1, max);
}

function isNeutral(hex = '') {
  return saturationScore(hex) < 0.12;
}

function isLight(hex = '') {
  return luminance(hex) > 0.72;
}

function pickColor(colors, tests, fallback) {
  for (const test of tests) {
    const found = colors.find(test);
    if (found) return found.hex;
  }
  return fallback;
}

function isCanvasRole(roleText = '') {
  return /(^|[-_ /])(canvas|page|document|root)($|[-_ /])/.test(` ${roleText} `);
}

function isLightSurfaceRole(roleText = '') {
  return isCanvasRole(roleText) || /pure white|white canvas|canvas white|page background|surface|card surface|site background/.test(roleText);
}

function isDarkSurfaceRole(roleText = '') {
  return (
    isCanvasRole(roleText) ||
    /pure dark theme|dark background|black background|near black|near-black|true black|brand dark|dark navy|dark canvas|black canvas/.test(roleText)
  );
}

function deriveCssVars(colors, archetypeId, content = '') {
  const role = (item) => String(item.role || '').toLowerCase();
  const prefersDarkCanvas =
    ['dark-developer', 'luxury-automotive', 'ai-cinematic'].includes(archetypeId) ||
    /(?:dark|black|near-black|near black|void|terminal|night|cinematic)\s+(?:canvas|page|theme)|(?:canvas|page|theme)\s+(?:dark|black|near-black|near black|void|terminal|night|cinematic)/i.test(content);
  const accentTests =
    archetypeId === 'monochrome-precision'
      ? [
          (item) => /black|ink|text|foreground|heading/.test(role(item)) && isNeutral(item.hex) && luminance(item.hex) < 0.35,
          (item) => isNeutral(item.hex) && luminance(item.hex) < 0.35,
          (item) => /primary|accent|brand/.test(role(item)) && !isLight(item.hex),
        ]
      : [
          (item) => /primary|accent|brand|rausch|yellow|red|blue|green|pink|purple|emerald|coral/.test(role(item)) && !isNeutral(item.hex),
          (item) => !isNeutral(item.hex) && !isLight(item.hex),
          (item) => !isNeutral(item.hex),
        ];
  const accent = pickColor(colors, accentTests, THEME_BY_ARCHETYPE.get(archetypeId) === 'mono' ? '#171717' : '#3a63d6');
  const explicitCanvas = colors.find((item) => isCanvasRole(role(item)));
  const darkCanvas = colors.find((item) => isDarkSurfaceRole(role(item)) && luminance(item.hex) < 0.18);
  const bg = pickColor(
    colors,
    [
      (item) => item === explicitCanvas,
      (item) => prefersDarkCanvas && isDarkSurfaceRole(role(item)) && luminance(item.hex) < 0.22,
      (item) => isLightSurfaceRole(role(item)) && isLight(item.hex),
      (item) => isLight(item.hex),
    ],
    prefersDarkCanvas ? darkCanvas?.hex || '#0f1117' : '#ffffff',
  );
  const textTests =
    luminance(bg) < 0.35
      ? [
          (item) =>
            /(^|[-_ ])(ink|body|heading|foreground|white|text)$/.test(role(item)) &&
            !/error|disabled|primary/.test(role(item)) &&
            luminance(item.hex) > 0.68,
          (item) =>
            /(^|[-_ ])(ink|body|heading|foreground|white|text)/.test(role(item)) &&
            !/error|disabled|primary/.test(role(item)) &&
            luminance(item.hex) > 0.68,
          (item) => isNeutral(item.hex) && luminance(item.hex) > 0.68,
        ]
      : [
          (item) =>
            /(^|[-_ ])(ink|body|heading|foreground|black|text)$/.test(role(item)) &&
            !/error|disabled|primary/.test(role(item)) &&
            luminance(item.hex) < 0.35,
          (item) =>
            /(^|[-_ ])(ink|body|heading|foreground|black|text)/.test(role(item)) &&
            !/error|disabled|primary/.test(role(item)) &&
            luminance(item.hex) < 0.35,
          (item) => isNeutral(item.hex) && luminance(item.hex) < 0.35,
        ];
  const text = pickColor(
    colors,
    textTests,
    luminance(bg) < 0.35 ? '#f7f7f7' : '#171717',
  );
  const mutedTests =
    luminance(bg) < 0.35
      ? [
          (item) => /muted|secondary|body|gray|grey|description/.test(role(item)) && luminance(item.hex) > 0.42 && luminance(item.hex) < 0.82,
          (item) => isNeutral(item.hex) && luminance(item.hex) > 0.42 && luminance(item.hex) < 0.82,
        ]
      : [
          (item) => /muted|secondary|body|gray|grey|description/.test(role(item)) && luminance(item.hex) > 0.22 && luminance(item.hex) < 0.68,
        ];
  const muted = pickColor(
    colors,
    mutedTests,
    mix(text, bg, 0.35),
  );
  const accentRgb = hexToRgb(accent) || { r: 58, g: 99, b: 214 };
  const inverseBg = luminance(bg) < 0.35 ? bg : accent;
  return {
    '--doc-text': text,
    '--doc-muted': muted,
    '--doc-bg': bg,
    '--doc-bg-soft': mix(bg, accent, luminance(bg) < 0.35 ? 0.08 : 0.05),
    '--doc-bg-strong': mix(bg, accent, luminance(bg) < 0.35 ? 0.14 : 0.11),
    '--doc-line': luminance(bg) < 0.35 ? 'rgba(255,255,255,0.18)' : 'rgba(23,23,23,0.16)',
    '--doc-line-soft': luminance(bg) < 0.35 ? 'rgba(255,255,255,0.10)' : 'rgba(23,23,23,0.08)',
    '--doc-accent': accent,
    '--doc-accent-soft': `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.14)`,
    '--doc-inverse-bg': inverseBg,
    '--doc-inverse-text': '#ffffff',
  };
}

function sanitizeFontStack(value = '', fallback = SYSTEM_SANS) {
  let text = String(value || '')
    .replace(/\s+with fallbacks:.+$/i, '')
    .replace(/\s*\([^)]*$/g, '')
    .replace(/[.;]\s*$/g, '')
    .trim();
  text = text.replace(/^["']+|["']+$/g, '').trim();
  if (!text || /^(none|n\/a|null|undefined)$/i.test(text)) return fallback;
  const lower = text.toLowerCase();
  if (/(system-ui|sans-serif|serif|monospace|ui-monospace)\b/i.test(text)) return text;
  if (/mono|code|terminal|plex mono|berkeley/.test(lower)) return `${text}, ${SYSTEM_MONO}`;
  if (/serif|editorial|times|tiempos|georgia|copernicus|palatino|garamond/.test(lower)) return `${text}, ${SYSTEM_SERIF}`;
  return `${text}, ${SYSTEM_SANS}`;
}

function extractFontHints(content = '', frontmatter = {}) {
  const text = String(content || '');
  const fontFamilies = [];
  if (frontmatter.typography && typeof frontmatter.typography === 'object') {
    for (const value of Object.values(frontmatter.typography)) {
      if (value && typeof value === 'object' && value.fontFamily) fontFamilies.push(String(value.fontFamily));
    }
  }
  for (const match of text.matchAll(/fontFamily:\s*["']?(.+?)["']?\s*$/gm)) fontFamilies.push(match[1].trim());
  for (const match of text.matchAll(/\*\*(?:Primary|Font Family|Typeface)[^*]*\*\*:\s*`?([^`\n]+)`?/gi)) fontFamilies.push(match[1].trim());
  const first = uniqueBy(fontFamilies, (item) => item.toLowerCase())[0] || '';
  const clean = sanitizeFontStack(first);
  return {
    heading: clean,
    body: clean,
    mono: SYSTEM_MONO,
  };
}

function chooseArchetype(slug, content = '') {
  const direct = ARCHETYPES.find((item) => item.slugs.includes(slug));
  if (direct) return direct;
  const text = content.toLowerCase();
  if (/dashboard|metric|analytics|data|monitoring/.test(text)) return ARCHETYPES.find((item) => item.id === 'data-dashboard');
  if (/cinematic|photo|photography|full-bleed|premium/.test(text)) return ARCHETYPES.find((item) => item.id === 'photography-led-premium');
  if (/developer|code|terminal|api/.test(text)) return ARCHETYPES.find((item) => item.id === 'dark-developer');
  return ARCHETYPES[0];
}

function formatType(content = '', meta = {}) {
  if (Object.keys(meta || {}).length && meta.colors) return 'frontmatter-token';
  if (/##\s+1\.\s+Visual Theme/i.test(content) && /Agent Prompt Guide/i.test(content)) return 'nine-section';
  return 'sectioned-design-md';
}

function summarizeKeywords(content = '') {
  const terms = [
    'dark',
    'monochrome',
    'gradient',
    'photography',
    'editorial',
    'dashboard',
    'developer',
    'terminal',
    'premium',
    'playful',
    'rounded',
    'minimal',
    'cinematic',
    'data',
    'trust',
  ];
  const text = content.toLowerCase();
  return terms.filter((term) => text.includes(term)).slice(0, 8);
}

async function readSourceIndex() {
  try {
    return JSON.parse(await fs.readFile(SOURCE_INDEX_PATH, 'utf8'));
  } catch {
    return { items: [] };
  }
}

async function analyzeFiles() {
  const sourceIndex = await readSourceIndex();
  const sourceBySlug = new Map((sourceIndex.items || []).map((item) => [item.slug, item]));
  const dirents = await fs.readdir(RAW_ROOT, { withFileTypes: true });
  const slugs = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const items = [];

  for (const slug of slugs) {
    const filePath = path.join(RAW_ROOT, slug, 'DESIGN.md');
    const content = await fs.readFile(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(content);
    const source = sourceBySlug.get(slug) || {};
    const headings = extractHeadings(body);
    const colors = extractColors(content, meta);
    const archetype = chooseArchetype(slug, content);
    const cssVars = deriveCssVars(colors, archetype.id, content);
    const fontHints = extractFontHints(content, meta);
    cssVars['--font-heading'] = fontHints.heading;
    cssVars['--font-body'] = fontHints.body;

    items.push({
      slug,
      name: meta.name || source.name || slugToTitle(slug),
      category: source.category || 'Uncategorized',
      description: meta.description || source.description || '',
      archetype: archetype.id,
      recommendedTheme: archetype.theme,
      recommendedIntent: archetype.intent,
      format: formatType(content, meta),
      headings: headings.slice(0, 16),
      keywords: summarizeKeywords(content),
      colors,
      cssVars,
      fontHints,
      sourceUrl: source.sourceUrl || `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/${slug}/DESIGN.md`,
      pageUrl: source.pageUrl || `https://getdesign.md/${slug}/design-md`,
      localPath: `references/design-md/raw/${slug}/DESIGN.md`,
    });
  }

  if (items.length !== 70) throw new Error(`Expected 70 local DESIGN.md files, found ${items.length}`);
  return {
    generatedAt: new Date().toISOString(),
    count: items.length,
    archetypes: ARCHETYPES,
    items,
  };
}

function mdTable(rows) {
  return rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
}

function brandList(items, limit = 6) {
  return items.slice(0, limit).map((item) => item.name).join(', ');
}

function buildInsightsDoc(manifest) {
  const byArch = new Map();
  for (const item of manifest.items) {
    if (!byArch.has(item.archetype)) byArch.set(item.archetype, []);
    byArch.get(item.archetype).push(item);
  }
  const rows = [
    ['Archetype', 'Count', 'Examples', 'PPT Use'],
    ['---', '---:', '---', '---'],
    ...manifest.archetypes.map((arch) => [
      arch.title,
      byArch.get(arch.id)?.length || 0,
      brandList(byArch.get(arch.id) || []),
      arch.useFor,
    ]),
  ];

  return `# DESIGN.md Insights for PPT-Style Markdown

Generated from ${manifest.count} DESIGN.md files. Use this as the first synthesis layer before opening individual raw brand files.

## Core Insights

- Brand color is a role, not decoration. The strongest systems use one dominant color for primary action, status, or chapter structure.
- Typography identity can be translated into Markdown slides through scale, weight, casing, spacing, and density even when proprietary fonts are unavailable.
- Layout density is the fastest design signal: developer and data systems favor compact, scan-heavy slides; premium consumer systems need fewer words and stronger visual anchors.
- Dark slides work best as structural moments: cover, section break, proof reveal, or closing. Repeating dark slides without contrast makes the deck feel flat.
- Photography-led brands need real image anchors. If no useful image exists, choose editorial/message layouts instead of fake visual decoration.
- Data-heavy brands should preserve comparison speed: stat grids, compact tables, and side-by-side decision slides beat hero compositions.
- Playful brands still need hierarchy. Use icons, color, and rounded cards to guide attention, not to make every slide equally loud.
- Luxury brands are subtractive. Use fewer words, stronger contrast, and intentional pacing.

## Archetype Summary

${mdTable(rows)}

## How to Apply

1. Classify the source Markdown: report, pitch, reference, narrative, tutorial.
2. Pick one archetype from this file based on audience and content density.
3. Use the archetype's recommended theme and templates as defaults.
4. If a specific brand is requested, open \`manifest.json\` for tokens and only then open that brand's raw \`DESIGN.md\`.
5. Translate brand rules into slide decisions: background, accent, type scale, layout density, card style, image strategy.
6. Verify that every slide has one message, one visual role, and no unsupported dependency on external fonts or animation.
`;
}

function buildArchetypesDoc(manifest) {
  const byArch = new Map();
  for (const item of manifest.items) {
    if (!byArch.has(item.archetype)) byArch.set(item.archetype, []);
    byArch.get(item.archetype).push(item);
  }

  const sections = manifest.archetypes
    .map((arch) => {
      const items = byArch.get(arch.id) || [];
      return `## ${arch.title}

- Brands: ${items.map((item) => `\`${item.slug}\``).join(', ')}
- Default frontmatter: \`theme: ${arch.theme}\`, \`intent: ${arch.intent}\`
- Best for: ${arch.useFor}
- PPT move: ${arch.pptMove}
- Prefer templates: ${arch.templates.map((item) => `\`.${item}\``).join(', ')}
- Avoid: ${arch.avoid}
`;
    })
    .join('\n');

  return `# DESIGN.md Archetypes

Use this file when deciding a visual direction for a Markdown-to-PPT transformation.

${sections}
`;
}

function buildPptRulesDoc() {
  return `# DESIGN.md to PPT Markdown Rules

Use these rules to translate company DESIGN.md guidance into Markdown Pattern Studio slides.

## Translation Rules

- Convert color systems into 3 roles: canvas, text, accent. Keep one accent dominant at 60-70% of visual emphasis.
- Convert proprietary typography into available controls: heading size, font stack fallback, weight, casing, line height, and slide density.
- Convert component guidance into templates: cards -> \`.card\`, product/story visuals -> \`.half-bleed\`, metrics -> \`.stats\`, workflow -> \`.timeline\`, features -> \`.icon-list\`.
- Convert layout philosophy into slide density: sparse premium decks need image or dark-slide weight; reports need tables, stats, and compact comparison.
- Convert do/don't rules into QA checks before final output.

## Brand-to-Slide Mapping

| DESIGN.md signal | PPT Markdown move |
| --- | --- |
| strong primary color | use \`theme\` or \`design\` accent; reserve for CTA, stat delta, chapter slides |
| monochrome precision | use \`.message\`, \`.compare\`, thin tables, few colors |
| dark developer surface | use dark cover/close, code blocks, terminal-like labels |
| photography-first | use \`.half-bleed\` with meaningful images |
| dashboard/data density | use \`.stats\`, \`.table-fit\`, \`.compare\` |
| editorial voice | use \`.quote-slide\`, two-column narrative, strong captions |
| playful rounded UI | use \`.icon-list\`, rounded cards, friendly copy |
| luxury austerity | use fewer slides with stronger contrast and less copy |

## Hard Limits

- Do not depend on custom web fonts; use fallback font stacks.
- Do not depend on animation, hover states, or video; slides are static.
- Do not copy brand identity blindly; adapt the design logic to the user's content.
- Do not use a brand color everywhere. Accent overuse is a quality failure.
`;
}

function buildDecisionFrameworkDoc() {
  return `# DESIGN.md Decision Framework

Use this before transforming Markdown into a branded PPT-style deck.

## Step 1: Identify the Job

- Executive decision or operating review -> Data Dashboard or Fintech Trust
- Developer/API/architecture explanation -> Dark Developer or Monochrome Precision
- Product launch or consumer story -> Photography-Led Premium or Playful Product
- Research, essay, or thought leadership -> Editorial / Magazine
- Premium reveal or high-status brand story -> Luxury / Automotive
- AI capability narrative -> AI Cinematic

## Step 2: Match Density

- Sparse source content: use \`.half-bleed\`, \`.dark\`, \`.message\`, or merge slides.
- Medium source content: use \`.icon-list\`, \`.three-column\`, \`.timeline\`.
- Dense source content: use \`.stats\`, \`.compare\`, \`.table-fit\`, appendices.

## Step 3: Commit Frontmatter

\`\`\`yaml
---
title: "Deck Title"
theme: midnight
intent: pitch
design: stripe
pageWidth: 1120px
pageHeight: 720px
---
\`\`\`

If no specific brand is requested, omit \`design\` and use only the archetype's recommended \`theme\`.

## Step 4: Verify

- The first slide communicates the main point in 3 seconds.
- The chosen design direction is visible by slide 2.
- Every accent color has a semantic role.
- No slide depends on custom fonts, animation, or hidden speaker notes.
- The deck alternates visual weight and never repeats one layout 3+ times.
`;
}

function buildBrandDesignsJs(manifest) {
  const list = manifest.items.map((item) => ({
    slug: item.slug,
    className: item.slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    name: item.name,
    category: item.category,
    archetype: item.archetype,
    theme: item.recommendedTheme,
    intent: item.recommendedIntent,
    description: item.description,
    colors: item.colors.slice(0, 10),
    cssVars: item.cssVars,
  }));
  const aliases = {};
  for (const item of list) {
    aliases[item.slug.toLowerCase()] = item.slug;
    aliases[item.className.toLowerCase()] = item.slug;
    aliases[item.name.toLowerCase()] = item.slug;
    aliases[item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')] = item.slug;
  }

  return `// Generated by scripts/analyze-design-md.mjs. Do not edit by hand.
export const BRAND_DESIGN_LIST = ${JSON.stringify(list, null, 2)};

export const BRAND_DESIGNS = Object.fromEntries(BRAND_DESIGN_LIST.map((item) => [item.slug, item]));

const BRAND_DESIGN_ALIASES = ${JSON.stringify(aliases, null, 2)};

export function normalizeBrandDesignSlug(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'auto' || raw === 'none') return '';
  const compact = raw.replace(/^design:/, '').replace(/^brand:/, '').trim();
  const hyphen = compact.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return BRAND_DESIGN_ALIASES[compact] || BRAND_DESIGN_ALIASES[hyphen] || '';
}

export function getBrandDesign(value = '') {
  const slug = normalizeBrandDesignSlug(value);
  return slug ? BRAND_DESIGNS[slug] || null : null;
}

export function buildBrandDesignStyle(value = '') {
  const design = typeof value === 'string' ? getBrandDesign(value) : value;
  if (!design?.cssVars) return '';
  return Object.entries(design.cssVars)
    .filter(([, cssValue]) => cssValue != null && String(cssValue).trim())
    .map(([name, cssValue]) => \`\${name}:\${String(cssValue).replace(/;/g, '')};\`)
    .join('');
}
`;
}

async function main() {
  const manifest = await analyzeFiles();
  await fs.mkdir(assertInsideRepo(DESIGN_ROOT), { recursive: true });
  await fs.writeFile(assertInsideRepo(MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(assertInsideRepo(path.join(DESIGN_ROOT, 'design-md-insights.md')), buildInsightsDoc(manifest), 'utf8');
  await fs.writeFile(assertInsideRepo(path.join(DESIGN_ROOT, 'design-md-archetypes.md')), buildArchetypesDoc(manifest), 'utf8');
  await fs.writeFile(assertInsideRepo(path.join(DESIGN_ROOT, 'design-md-to-ppt-rules.md')), buildPptRulesDoc(), 'utf8');
  await fs.writeFile(assertInsideRepo(path.join(DESIGN_ROOT, 'design-md-decision-framework.md')), buildDecisionFrameworkDoc(), 'utf8');
  await fs.writeFile(assertInsideRepo(BRAND_JS_PATH), buildBrandDesignsJs(manifest), 'utf8');

  console.log(`Analyzed ${manifest.count} DESIGN.md files`);
  console.log(`Wrote ${path.relative(repoRoot, MANIFEST_PATH)}`);
  console.log(`Wrote ${path.relative(repoRoot, BRAND_JS_PATH)}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
