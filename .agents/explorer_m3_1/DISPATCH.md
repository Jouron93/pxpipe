## 2026-07-26T21:32:45Z
You are Explorer 1 for Milestone 3: Dashboard UI Model Toggle Chips (`src/dashboard/fragments.ts`).
Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`, and `C:\Projects\pxpipe\src\dashboard\fragments.ts`.

Your task:
Formulate the exact refactoring strategy for `renderModelsFragment` in `src/dashboard/fragments.ts`:
1. Query `getAllModelProfiles()` from `src/core/model-registry.ts` to retrieve all model profiles.
2. Group model profiles into 5 per-family sections:
   - Claude Family (`family === 'claude'`)
   - OpenAI / Codex Family (`family === 'openai'`)
   - Grok Family (`family === 'grok'`)
   - AGY Proxy Family (`family === 'agy'`)
   - NVIDIA NIM Family (`family === 'nvidia'`)
3. Format each chip button with its model label, context length badge (`1M`, `2M`, `262K`, `128K`), and enabled/locked status.

Working directory: `C:\Projects\pxpipe\.agents\explorer_m3_1`
Write your strategy to `C:\Projects\pxpipe\.agents\explorer_m3_1\handoff.md`. Notify parent when done.
