# BRIEFING — 2026-07-27T01:33:53Z

## Mission
Formulate exact helper, CSS, and HTMX handler specs for context badges in `src/dashboard/fragments.ts` for Milestone 3.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Read-only investigator / Specification writer for context badges & CSS
- Working directory: C:\Projects\pxpipe\.agents\explorer_m3_2
- Original parent: facdb52c-ae68-4754-8bec-1fbdc98695a3
- Milestone: Milestone 3 - Context Badges & CSS

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in src/
- Formulate formatContextBadge helper specs (binary powers of 2 vs decimal rounding)
- CSS styling for .badge-ctx inside .chip buttons for light & dark themes
- HTMX POST handler compatibility (`hx-post="/fragments/models"` with model + on state)

## Current Parent
- Conversation ID: facdb52c-ae68-4754-8bec-1fbdc98695a3
- Updated: 2026-07-27T01:33:53Z

## Investigation State
- **Explored paths**: `src/dashboard/fragments.ts`, `src/core/model-registry.ts`, `ORIGINAL_REQUEST.md`, `PROJECT.md`
- **Key findings**:
  - `formatContextBadge` maps `1_048_576`->`'1M'`, `2_097_152`->`'2M'`, `262_144`->`'262K'`, `131_072`/`128_000`->`'128K'`, `524_288`->`'524K'`, `500_000`->`'500K'`, `200_000`->`'200K'`.
  - CSS `.badge-ctx` styling leverages CSS variables (`--mono`, `--surface-2`, `--ink-2`, `--border-strong`, `--flame-ink`, `--flame`, `--surface`) for clean inline rendering across light & dark themes.
  - HTMX POST compatibility confirmed: `hx-post="/fragments/models"` with `hx-vals='{"model":"${canonicalId}","on":${!lit}}'`.
- **Unexplored areas**: None (investigation complete).

## Key Decisions Made
- Formulated exact `formatContextBadge` function signature and test vector suite.
- Formulated `.badge-ctx` CSS rules with light/dark theme variables.
- Formulated HTMX attribute contract and chip generator snippet.

## Artifact Index
- C:\Projects\pxpipe\.agents\explorer_m3_2\handoff.md — Final handoff report
- C:\Projects\pxpipe\.agents\explorer_m3_2\progress.md — Liveness heartbeat
