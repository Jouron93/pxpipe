## 2026-07-27T01:32:45Z
You are Explorer 2 for Milestone 3: Context Badges & CSS (`src/dashboard/fragments.ts`).
Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`, and `C:\Projects\pxpipe\src\dashboard\fragments.ts`.

Your task:
Formulate the exact helper and CSS styling specifications for context badges in `src/dashboard/fragments.ts`:
1. `formatContextBadge(tokens: number): string` helper:
   - `1_048_576` -> `'1M'`
   - `2_097_152` -> `'2M'`
   - `262_144` -> `'262K'`
   - `131_072` or `128_000` -> `'128K'`
   - `524_288` -> `'524K'`
   - `500_000` -> `'500K'`
   - `200_000` -> `'200K'`
2. CSS styling for `.badge-ctx` to render cleanly inside `.chip` buttons in both light and dark themes.
3. HTMX POST handler compatibility (`hx-post="/fragments/models"` with `{ model: canonicalId, on: ... }`).

Working directory: `C:\Projects\pxpipe\.agents\explorer_m3_2`
Write your strategy to `C:\Projects\pxpipe\.agents\explorer_m3_2\handoff.md`. Notify parent when done.
