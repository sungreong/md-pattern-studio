# Rendering Environment Guide

This skill operates inside **markdown-pattern-studio**, a Markdown → HTML presenter with a fixed-height slide canvas. Design decisions must account for how content actually renders in this specific environment — not generic PPTX assumptions.

---

## Slide Canvas Dimensions

| Property | Value |
|----------|-------|
| Width | 1120px |
| Height | 720px |
| Aspect ratio | 16:9 |
| Side padding | 2.5rem (40px) each side |
| Top/bottom padding | 2rem (32px) each side |
| Usable content area | ~1040px × ~656px |

Content is **vertically centered** within the canvas. A slide with only 200px of content will sit in the middle, leaving ~228px of breathing room above and below. This is intentional — but content must still have enough density to feel intentional, not sparse.

---

## Template Height Footprint

How much vertical space each template occupies at typical content density. Use this to judge whether a slide will feel full or sparse.

| Template | Typical height | Items for full-slide feel | Notes |
|----------|---------------|--------------------------|-------|
| `.cover` | 300–400px | 1 title + 1 subtitle | Cover is always full-height by design |
| `.dark` | fills 100% | any | Stretches to fill entire canvas |
| `.message` | 120–200px | 1 heading + 2–3 sentences | Feels sparse with only a heading; add body text |
| `.stats` | 160–220px (cards) | **4–6 stats** | 2–3 stats looks thin even after centering; combine with heading |
| `.icon-list` | 60–80px per item | **4–5 items** | 3 items = half slide; fewer → combine slides or add intro paragraph |
| `.two-column` | 300–450px | 2 blocks, 3–5 lines each | Works well; ensure both columns have comparable density |
| `.three-column` | 280–380px | 3 blocks, 2–4 lines each | Good for 3 symmetric items; keep each block short |
| `.compare` | 300–420px | 2 blocks, 3–5 lines each | **Only for exactly 2 items** |
| `.timeline` | 80–100px per stage | **3–5 stages** | 2 stages feels thin; 6+ may overflow |
| `.agenda` | 50–60px per item | 5–8 items | Best for structured lists; fewer items → use `.message` instead |
| `.card` | 200–350px | 1 highlighted block | Needs enough text to justify the card frame |
| `.spotlight` | 280–400px | 1 image + body paragraph | Image must exist; text-only spotlight is just a padded paragraph |
| `.half-bleed` | fills 100% | 1 image + 1–3 paragraphs | Always full-height; works well at any text density |
| `.quote-slide` | 200–300px | 1 quote (2–4 lines) | Short quote → centered, elegant; long quote → can scroll |

---

## Density Decision Rules

### Too sparse? Do one of these:
1. **Add a body paragraph** to the slide heading before the template content
2. **Merge two thin slides** into one with a richer template (e.g., two `.message` slides → one `.two-column`)
3. **Increase item count** — add a 4th icon-list item, add a 4th stat
4. **Use a visually heavier template** — `.half-bleed` fills the canvas regardless of text density

### Too dense? Do one of these:
1. **Split into two slides** using a `---\n{: .page-break}` separator
2. **Use `.agenda`** instead of a paragraph list — bullet points render more compactly
3. **Trim body copy** — each slide should have one message, not three

---

## Template Pairing — What Works Together

Consecutive slides should alternate visual weight. Avoid repeating the same template.

| After this... | Good next slide | Avoid |
|---------------|----------------|-------|
| `.cover` / `.dark` (open) | `.message` or `.stats` | Another `.dark` |
| `.message` | `.icon-list` or `.stats` | Another `.message` |
| `.stats` | `.half-bleed` or `.two-column` | Another `.stats` |
| `.icon-list` | `.compare` or `.timeline` | Another `.icon-list` |
| `.timeline` | `.stats` or `.card` | Another `.timeline` |
| `.half-bleed` | `.stats` or `.agenda` | Another `.half-bleed` |
| Any light slide | `.dark` (close) | `.message` (too similar to dark close) |

---

## Theme × Content Density Pairing

Some themes have higher visual weight (darker backgrounds, stronger accent) and compensate for sparse content better than light themes.

| Theme | Works with sparse content? | Why |
|-------|--------------------------|-----|
| `midnight` | Yes — dark bg fills space visually | Navy background carries slides with few items |
| `charcoal` | Yes | Dark tones visually fill the canvas |
| `coral` | Partially | Bold accent compensates but needs 4+ items |
| `default` / `report` | No | Light bg + sparse content looks unfinished |
| `sage` / `paper` | No | Soft palettes need dense content to anchor them |
| `berry` / `cherry` | Yes | High contrast carries sparse slides |

Rule: **the lighter the theme, the denser the content needs to be**.

---

## Content-to-Slide Mapping (Practical)

When transforming a document into slides, use this mapping to decide how much source content belongs on each slide.

| Source content | Target template | Target density |
|---------------|----------------|---------------|
| 1 key sentence | `.message` | Add 2–3 supporting bullet points |
| 3–5 metrics or KPIs | `.stats` | Use label \| value \| delta format |
| 3–5 features with icons | `.icon-list` | Write icon \| bold header \| 1-sentence desc |
| 2 contrasting options | `.compare` | Keep both blocks equal length |
| 3 symmetric items | `.three-column` | 3–5 lines per column max |
| Step-by-step progression | `.timeline` | 3–5 stages; each stage = 1 short label |
| 1 strong image + explanation | `.half-bleed` | 2–3 paragraphs; image is the anchor |
| Big quote or insight | `.quote-slide` | Quote alone; no bullets below |
| List of agenda items | `.agenda` | 5–8 items; each item = 1 line |

---

## What This Renderer Does NOT Support

Avoid writing content that depends on these — the renderer will silently fail or produce broken output.

- **Raw HTML as authoring syntax** — do not write `<div>`, `<span>`, `<br>`, `<iframe>`, `<video>`, or custom HTML wrappers; use Markdown and MPS templates instead
- **Collapsible details** — existing `<details>/<summary>` blocks are rendered as always-visible static note callouts for compatibility, not as interactive disclosure UI
- **Animated transitions** — no slide animations; each page is static HTML
- **Speaker notes** — no separate notes area; notes become visible slide content
- **Embedded video** — `<video>` tags are stripped; use an image thumbnail instead
- **Custom fonts from URLs** — only system font stacks are loaded (no Google Fonts)
- **SVG icons by name** — no icon library; use emoji as the icon primitive
- **Nested template classes** — e.g., `.two-column.dark` does not work; templates are mutually exclusive
- **More than one image in `.half-bleed`** — only the first image is used; extras fall into the text column
