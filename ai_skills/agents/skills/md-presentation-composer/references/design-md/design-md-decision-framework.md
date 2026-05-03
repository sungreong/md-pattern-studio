# DESIGN.md Decision Framework

Use this before transforming Markdown into a branded PPT-style deck.

## Step 1: Identify the Job

- Executive decision or operating review -> Data Dashboard or Fintech Trust
- Developer/API/architecture explanation -> Dark Developer or Monochrome Precision
- Product launch or consumer story -> Photography-Led Premium or Playful Product
- Research, essay, or thought leadership -> Editorial / Magazine
- Premium reveal or high-status brand story -> Luxury / Automotive
- AI capability narrative -> AI Cinematic

## Step 2: Match Density

- Sparse source content: use `.half-bleed`, `.dark`, `.message`, or merge slides.
- Medium source content: use `.icon-list`, `.three-column`, `.timeline`.
- Dense source content: use `.stats`, `.compare`, `.table-fit`, appendices.

## Step 3: Commit Frontmatter

```yaml
---
title: "Deck Title"
theme: midnight
intent: pitch
design: stripe
pageWidth: 1120px
pageHeight: 720px
---
```

If no specific brand is requested, omit `design` and use only the archetype's recommended `theme`.

## Step 4: Verify

- The first slide communicates the main point in 3 seconds.
- The chosen design direction is visible by slide 2.
- Every accent color has a semantic role.
- No slide depends on custom fonts, animation, or hidden speaker notes.
- The deck alternates visual weight and never repeats one layout 3+ times.
