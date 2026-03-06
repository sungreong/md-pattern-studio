export const PAGE_BREAK_TOKEN = '<!--__MPS_PAGE_BREAK__-->';

export function hasMeaningfulHtmlFragment(fragment = '') {
  const html = String(fragment || '').trim();
  if (!html) return false;

  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const withSpacesNormalized = withoutComments.replace(/&nbsp;|&#160;/gi, ' ').trim();
  if (!withSpacesNormalized) return false;

  const textOnly = withSpacesNormalized
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (textOnly) return true;

  return /<(section|article|p|ul|ol|table|figure|pre|blockquote|aside|h[1-6])\b/i.test(withSpacesNormalized);
}

export function buildPaginatedSegments(composedHtml = '', token = PAGE_BREAK_TOKEN) {
  return String(composedHtml || '')
    .split(token)
    .map((page) => page.trim())
    .filter((page) => hasMeaningfulHtmlFragment(page));
}
