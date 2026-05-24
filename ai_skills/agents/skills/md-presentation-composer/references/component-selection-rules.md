# Component Selection Rules

Use this when a Markdown section contains tables, metrics, retrieval results, evaluation data, or code-like identifiers. The goal is to choose the component that preserves meaning first, then polish the slide.

## Whole-Document Component Budget

Before writing slides, choose a small vocabulary for the whole document:

| Document type | Primary structure | Evidence style | Expressive limit |
| --- | --- | --- | --- |
| Technical review | problem -> method -> evidence -> decision | compact tables, code, diagrams | mostly restrained; dark cover/close only |
| Executive report | summary -> KPI -> drivers -> risks -> next actions | KPI cards + selected tables | one strong summary slide, no decorative variety |
| Pitch/proposal | problem -> contrast -> solution -> proof -> ask | compare, timeline, selected stats | 1-2 memorable visual moments |
| Tutorial | goal -> prerequisites -> steps -> checks -> troubleshooting | numbered lists, code, screenshots | clarity over drama |
| Reference doc | topic map -> definitions -> tables -> examples | dense tables and code | minimal decoration |

Do not pick a different visual idea for every section. A deck should feel like one designed system, not a template sampler.

## Selection Matrix

| Information role | Use | Good fit | Avoid |
| --- | --- | --- | --- |
| Top-line KPI | `.stats` | 2-6 short `label | value | delta` items such as Hit@5, p95 latency, cost, pass rate | Long identifiers, booleans, method names, query text |
| Precise evidence | table + `.table-fit` | qrels, Method/Hit/Rank, logs, settings, benchmark rows | Converting each row into a card |
| Alternative comparison | `.compare` or compact table | A/B, before/after, BM25 vs dense vs hybrid with same criteria | 5+ alternatives or 7+ criteria on one slide |
| Decision takeaway | `.message` or callout paragraph | "What changed" or "what to do next" after evidence | Replacing evidence with a claim only |
| Technical proof | evidence slide | claim + table/code + caveat in one page | Decorative cards that hide exact values |

## `.stats` Guardrails

- Use `.stats` only when each row is an independent KPI with one dominant value.
- Preferred syntax: list items in `label | value | delta` format.
- Short KPI tables may use headers such as `Metric | Value | Delta` or `지표 | 값 | 변화`.
- Do not use `.stats` for tables with headers like `Method`, `Query`, `Expected document`, `Hit`, `Rank`, `Status`, `Supported`, `Caveat`, `Page`, or `Mode`.
- Do not use `.stats` when any important cell is a long unbroken string such as `DOC-SEMANTIC-GLASS`, an API route, a hash, a model id, or a code symbol.
- If a section already has `.stats` but the table must stay a table, add `statsMode="table"` to the heading or table attribute line.
- Use `statsMode="cards"` only for a deliberate override after checking that truncation or wrapping will not hide meaning.

## Evidence Table Pattern

```markdown
## Contextual Retrieval Result {#contextual-result .card}

| Method | Expected document | Hit | Rank |
| --- | --- | --- | ---: |
| `bm25_raw` | `DOC-SEMANTIC-GLASS` | false | 없음 |
| `bm25_contextual` | `DOC-SEMANTIC-GLASS` | true | 1 |
{: .zebra .bordered .compact .table-fit caption="Query: `cracked screen fix`"}
```

Follow the table with one short interpretation paragraph or 2-4 bullets. Keep the exact evidence visible.

## Replacing Collapsible Details

Do not author `<details>` or `<summary>` blocks. Slides and saved HTML must be static and complete without hidden interaction.

| Source intent | Use instead | Notes |
| --- | --- | --- |
| Presenter-only aside | `.message` body paragraph or appendix slide | Keep the main slide clean; move optional talk track after the main evidence |
| Short example that should stay near the claim | `[!NOTE]` callout or `.card` | Make the example visible and concise |
| Long explanation | Separate page with `---` + `{: .page-break}` | Hidden long text becomes unreadable in export/print |
| Evidence sample, qrels, logs, or IDs | `.card` + `.table-fit` table or code block | Preserve exact values instead of hiding them |

Preferred callout syntax:

```markdown
> [!NOTE] Example
> Keep the detail visible, short, and tied to the slide's main claim.
```

## Design Notes

- Microsoft Copilot and Canva position AI presentation generation as draft + review workflows: generate structure quickly, then check slide order, tone, detail, brand, and layout.
- Cards work best for one subject; overloaded evidence cards are harder to scan than a compact table.
- Data tables need clear titles, short column labels, and enough space. If details feel cramped, split the slide.
- Long unbreakable strings need wrapping support in the renderer, but the authoring choice should still prefer tables for technical identifiers.
