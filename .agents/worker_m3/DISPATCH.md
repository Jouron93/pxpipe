## 2026-07-26T21:34:20Z

You are Worker 1 for Milestone 3: Dashboard UI Per-Model Toggle Chips (`src/dashboard/fragments.ts`) in PXPipe (`C:\Projects\pxpipe`).

Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`, and the Explorer handoff reports at:
- `C:\Projects\pxpipe\.agents\explorer_m3_1\handoff.md`
- `C:\Projects\pxpipe\.agents\explorer_m3_2\handoff.md`

Your task:
Refactor `src/dashboard/fragments.ts`:
1. Export `formatContextBadge(tokens: number | null | undefined): string` returning compact badge labels (`1M`, `2M`, `262K`, `128K`, `524K`, `500K`, `200K`).
2. Add `.badge-ctx` styling inside the `CSS` template string supporting light and dark themes.
3. Update `renderModelsFragment` to query `getAllModelProfiles()` from `src/core/model-registry.js`.
4. Partition models into 5 per-family sections:
   - Image Claude models (`family === 'claude'`)
   - Image OpenAI / Codex models (`family === 'openai'`)
   - Image Grok models (`family === 'grok'`)
   - Image AGY Proxy models (`family === 'agy' || family === 'gemini'`)
   - Image NVIDIA NIM Flagships (`family === 'nvidia'`)
5. Attach `<span class="badge-ctx">${badge}</span>` to chip buttons next to model labels.

Verification Requirements:
After updating `src/dashboard/fragments.ts`, run `npx tsc --noEmit` and `pnpm test`. Document command output and exit code.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Working Directory: `C:\Projects\pxpipe\.agents\worker_m3`
Write your completion report to `C:\Projects\pxpipe\.agents\worker_m3\handoff.md`. Notify parent via send_message when done.
