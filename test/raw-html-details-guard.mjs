#!/usr/bin/env node
import { parseMarkdownDocument, registerBuiltInTemplates, renderDocument } from '../public/core/engine.js';
import { analyzeMarkdownQuality } from '../public/core/quality.js';
import { TemplateRegistry } from '../public/core/registry.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function render(source) {
  const registry = new TemplateRegistry();
  registerBuiltInTemplates(registry);
  return renderDocument(parseMarkdownDocument(source), { mode: 'paginated' }, registry);
}

const detailsSource = `
## Demo

<details>
<summary>발표자가 말할 수 있는 짧은 예시</summary>

- 첫 번째 보충 설명
- 두 번째 보충 설명

| Method | Hit |
| --- | --- |
| bm25 | true |

\`\`\`js
console.log('inside note');
\`\`\`

</details>
`;

const detailsHtml = render(detailsSource);
assert(!detailsHtml.includes('&lt;details'), 'details tag should not render as literal escaped text');
assert(!detailsHtml.includes('&lt;summary'), 'summary tag should not render as literal escaped text');
assert(detailsHtml.includes('md-callout type-note'), 'details block should render as a static note callout');
assert(detailsHtml.includes('<div class="callout-title">발표자가 말할 수 있는 짧은 예시</div>'), 'summary should become the callout title');
assert(detailsHtml.includes('<li>첫 번째 보충 설명</li>'), 'details body should preserve Markdown lists');
assert(detailsHtml.includes('<table class="md-table"'), 'details body should preserve Markdown tables');
assert(detailsHtml.includes('console.log(&#39;inside note&#39;);'), 'details body should preserve code fences');

const inlineDetailsHtml = render(`
## Inline Details

<details><summary>Inline summary</summary>

Body paragraph.
</details>
`);
assert(inlineDetailsHtml.includes('<div class="callout-title">Inline summary</div>'), 'inline opening details should also become a callout');
assert(inlineDetailsHtml.includes('Body paragraph.'), 'inline opening details body should render');

const detailsQuality = analyzeMarkdownQuality(detailsSource, parseMarkdownDocument(detailsSource));
assert(detailsQuality.issues.some((issue) => issue.title === 'HTML details 변환'), 'details warning should be emitted');
assert(!detailsQuality.issues.some((issue) => issue.title === '닫히지 않은 details 블록'), 'closed details should not emit unclosed error');

const brokenQuality = analyzeMarkdownQuality(`
## Broken

<details>
<summary>Missing close</summary>
body
`);
assert(brokenQuality.issues.some((issue) => issue.level === 'error' && issue.title === '닫히지 않은 details 블록'), 'unclosed details should emit an error');

const rawHtmlQuality = analyzeMarkdownQuality(`
## Raw HTML

<div>Unsupported wrapper</div>
<iframe src="demo"></iframe>
`);
assert(rawHtmlQuality.issues.some((issue) => issue.level === 'warn' && issue.detail.includes('<div>')), 'unsupported div should emit a warning');
assert(rawHtmlQuality.issues.some((issue) => issue.level === 'error' && issue.detail.includes('<iframe>')), 'unsupported iframe should emit an error');

const fencedHtml = `
## Code Sample

\`\`\`html
<details>
<summary>Code only</summary>
</details>
\`\`\`
`;
const fencedRendered = render(fencedHtml);
const fencedQuality = analyzeMarkdownQuality(fencedHtml, parseMarkdownDocument(fencedHtml));
assert(!fencedRendered.includes('md-callout type-note'), 'details inside code fences should not become a callout');
assert(!fencedQuality.issues.some((issue) => issue.title.includes('HTML') || issue.title.includes('raw HTML')), 'details inside code fences should not emit raw HTML warnings');

console.log('raw-html-details-guard ok');
