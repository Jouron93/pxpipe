# Project Context & Scope Index

## User Request Summary
PXPipe proxy (port 47821) receives HTTP `/v1/messages` requests from Claude Code CLI where the model string is `claude-opus-4-8` (even when the user selects `opus` in the CLI). PXPipe must correctly map all `opus` family variants (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-5`, `opus`) to `claude-opus-5`, update pricing cards, ensure image compression eligibility checks match `claude-opus-5`, and verify end-to-end payload transformation and dashboard telemetry.

## Key Files Mentioned
- `src/core/model-pricing.ts`
- `src/core/applicability.ts`
- `src/core/transform.ts`
- `src/dashboard/fragments.ts`
- `src/core/proxy.ts`
- `tests/model-pricing.test.ts`
- `tests/proxy-usage.test.ts`
- `tests/reflow.test.ts`
- `tests/transform.ts` (or equivalent test files)
- `dist/node.js`

## Key Verification Requirements
- `resolveModelRate('claude-opus-4-8', ...)` returns canonicalModel `claude-opus-5` with rates $5/$0.50/$25.
- `resolveModelRate('opus', ...)` returns canonicalModel `claude-opus-5`.
- `npx tsc --noEmit` exits code 0 with 0 type errors.
- `pnpm test` passes all unit tests.
- `pnpm run build` succeeds and updates `dist/node.js`.
- PXPipe daemon process restarted and active on port 47821.
- Simulated request with `"model": "claude-opus-4-8"` logs `claude-opus-5` in `events.jsonl`.
