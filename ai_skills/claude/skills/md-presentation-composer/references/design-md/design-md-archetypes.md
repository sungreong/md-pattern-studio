# DESIGN.md Archetypes

Use this file when deciding a visual direction for a Markdown-to-PPT transformation.

## Monochrome Precision

- Brands: `cal`, `hashicorp`, `linear.app`, `ollama`, `uber`, `vercel`, `x.ai`
- Default frontmatter: `theme: mono`, `intent: pitch`
- Best for: developer platforms, infrastructure narratives, strategy decks that need restraint and precision
- PPT move: Use wide whitespace, hard contrast, short headlines, thin dividers, and restrained cards.
- Prefer templates: `.cover`, `.message`, `.compare`, `.three-column`, `.stats`
- Avoid: Avoid decorative gradients, overloaded icons, and colorful accents without a semantic role.

## Dark Developer

- Brands: `composio`, `cursor`, `expo`, `opencode.ai`, `resend`, `supabase`, `voltagent`, `warp`
- Default frontmatter: `theme: charcoal`, `intent: reference`
- Best for: technical decks, product architecture, developer tooling, API walkthroughs
- PPT move: Lead with a dark cover, use code-like labels, compact spacing, and high-contrast accent cards.
- Prefer templates: `.dark`, `.code`, `.timeline`, `.icon-list`, `.stats`
- Avoid: Avoid washed-out mid grays and long centered paragraphs.

## Data Dashboard

- Brands: `binance`, `clickhouse`, `cohere`, `coinbase`, `ibm`, `kraken`, `notion`, `raycast`, `revolut`, `sentry`, `superhuman`
- Default frontmatter: `theme: report`, `intent: report`
- Best for: metrics reports, operating reviews, analytics, risk and monitoring updates
- PPT move: Prioritize stat grids, compact tables, alert colors, and clear hierarchy over hero-like composition.
- Prefer templates: `.stats`, `.table-fit`, `.compare`, `.timeline`, `.card`
- Avoid: Avoid oversized hero slides when the reader needs fast comparison.

## Editorial / Magazine

- Brands: `mintlify`, `sanity`, `theverge`, `wired`
- Default frontmatter: `theme: paper`, `intent: narrative`
- Best for: thought leadership, research narratives, content strategy, explanatory decks
- PPT move: Use strong section titles, pull quotes, editorial rhythm, dense but readable text blocks, and captions.
- Prefer templates: `.cover`, `.quote-slide`, `.two-column`, `.card`, `.message`
- Avoid: Avoid dashboard density and generic SaaS cards.

## Photography-Led Premium

- Brands: `airbnb`, `apple`, `meta`, `nike`, `pinterest`, `playstation`, `spacex`, `tesla`
- Default frontmatter: `theme: default`, `intent: pitch`
- Best for: product launches, consumer stories, brand narratives, visual case studies
- PPT move: Anchor thin content with half-bleed images, cinematic whitespace, and one message per slide.
- Prefer templates: `.half-bleed`, `.cover`, `.message`, `.spotlight`, `.quote-slide`
- Avoid: Avoid replacing missing imagery with decorative shapes; the visual must carry meaning.

## Fintech Trust

- Brands: `mastercard`, `stripe`, `wise`
- Default frontmatter: `theme: midnight`, `intent: pitch`
- Best for: finance, payment, trust, compliance, growth and business model decks
- PPT move: Pair clean surfaces with one confident accent, numeric proof, and trust-building comparison slides.
- Prefer templates: `.stats`, `.compare`, `.card`, `.timeline`, `.message`
- Avoid: Avoid playful decoration that weakens credibility.

## Playful Product

- Brands: `airtable`, `clay`, `figma`, `framer`, `intercom`, `lovable`, `miro`, `posthog`, `webflow`, `zapier`
- Default frontmatter: `theme: coral`, `intent: pitch`
- Best for: creative tooling, product onboarding, feature launches, collaboration workflows
- PPT move: Use icon lists, friendly accents, rounded cards, and visual variety without lowering information quality.
- Prefer templates: `.icon-list`, `.three-column`, `.agenda`, `.timeline`, `.half-bleed`
- Avoid: Avoid making every slide equally colorful; reserve color for structure and delight.

## Luxury / Automotive

- Brands: `bmw`, `bmw-m`, `bugatti`, `ferrari`, `lamborghini`, `renault`
- Default frontmatter: `theme: berry`, `intent: pitch`
- Best for: premium launches, executive storytelling, high-stakes brand or product reveals
- PPT move: Use dark slides, monumental type, restrained copy, and strong contrast with one brand accent.
- Prefer templates: `.dark`, `.half-bleed`, `.cover`, `.message`, `.compare`
- Avoid: Avoid dense tables unless the deck deliberately shifts into appendix/report mode.

## Green Systems

- Brands: `mongodb`, `nvidia`, `shopify`, `spotify`, `starbucks`
- Default frontmatter: `theme: forest`, `intent: pitch`
- Best for: platform growth, ecosystem decks, sustainability, commerce and technical power narratives
- PPT move: Let green act as a strong system signal, balanced by black, cream, or neutral surfaces.
- Prefer templates: `.dark`, `.stats`, `.icon-list`, `.timeline`, `.card`
- Avoid: Avoid tinting every surface green; it quickly becomes one-note.

## AI Cinematic

- Brands: `claude`, `elevenlabs`, `minimax`, `mistral.ai`, `replicate`, `runwayml`, `together.ai`
- Default frontmatter: `theme: slate`, `intent: narrative`
- Best for: AI product narratives, model capability decks, creative technology presentations
- PPT move: Use strong mood, dark/light contrast, capability sequences, and one clear proof slide per claim.
- Prefer templates: `.dark`, `.message`, `.half-bleed`, `.timeline`, `.icon-list`
- Avoid: Avoid vague futuristic decoration without product or capability evidence.

## Telecom / Bold Consumer

- Brands: `vodafone`
- Default frontmatter: `theme: cherry`, `intent: pitch`
- Best for: consumer-scale announcements, market positioning, direct CTA-heavy decks
- PPT move: Use big red chapter bands, concise copy, and high-contrast calls to action.
- Prefer templates: `.dark`, `.message`, `.stats`, `.compare`, `.agenda`
- Avoid: Avoid small, delicate accents that dilute the signal.

