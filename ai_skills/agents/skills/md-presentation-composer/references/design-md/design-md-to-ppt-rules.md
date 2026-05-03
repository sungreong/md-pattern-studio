# DESIGN.md to PPT Markdown Rules

Use these rules to translate company DESIGN.md guidance into Markdown Pattern Studio slides.

## Translation Rules

- Convert color systems into 3 roles: canvas, text, accent. Keep one accent dominant at 60-70% of visual emphasis.
- Convert proprietary typography into available controls: heading size, font stack fallback, weight, casing, line height, and slide density.
- Convert component guidance into templates: cards -> `.card`, product/story visuals -> `.half-bleed`, metrics -> `.stats`, workflow -> `.timeline`, features -> `.icon-list`.
- Convert layout philosophy into slide density: sparse premium decks need image or dark-slide weight; reports need tables, stats, and compact comparison.
- Convert do/don't rules into QA checks before final output.

## Brand-to-Slide Mapping

| DESIGN.md signal | PPT Markdown move |
| --- | --- |
| strong primary color | use `theme` or `design` accent; reserve for CTA, stat delta, chapter slides |
| monochrome precision | use `.message`, `.compare`, thin tables, few colors |
| dark developer surface | use dark cover/close, code blocks, terminal-like labels |
| photography-first | use `.half-bleed` with meaningful images |
| dashboard/data density | use `.stats`, `.table-fit`, `.compare` |
| editorial voice | use `.quote-slide`, two-column narrative, strong captions |
| playful rounded UI | use `.icon-list`, rounded cards, friendly copy |
| luxury austerity | use fewer slides with stronger contrast and less copy |

## Hard Limits

- Do not depend on custom web fonts; use fallback font stacks.
- Do not depend on animation, hover states, or video; slides are static.
- Do not copy brand identity blindly; adapt the design logic to the user's content.
- Do not use a brand color everywhere. Accent overuse is a quality failure.
