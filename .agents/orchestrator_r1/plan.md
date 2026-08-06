# Project Plan: PXPipe Opus 5 Model Alias Mapping & Telemetry Fix

## Objective
Audit and fix PXPipe proxy model alias mapping, request transformation, dashboard chip state, and telemetry for Claude Code `opus` requests (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `claude-opus-5`) to resolve to canonical `claude-opus-5`, update pricing rates ($5/$0.50/$25), verify unit and integration tests, build `dist/node.js`, restart daemon, and run live HTTP integration test.

## Phases / Milestones

### Milestone 0: Survey & Investigation
- Dispatch 3 parallel Explorers:
  - `explorer_survey_1`: Investigate `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/transform.ts`, `src/dashboard/fragments.ts` for Opus model aliases, pricing, rate cards, and dashboard chips.
  - `explorer_survey_2`: Investigate `src/core/transform.ts`, `src/core/proxy.ts`, `src/core/router.ts` (or relevant proxy handling code) for `/v1/messages` and `/v1/responses` request payload rewriting.
  - `explorer_survey_3`: Investigate existing test files `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/reflow.test.ts`, `tests/transform.ts`, build setup (`pnpm run build`), and daemon service (`TraderBotPxpipeProxy`).

### Milestone 1 (R1): Model Alias & Normalization Fix
- Map all `opus` family variants (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `claude-opus-5`) to `claude-opus-5` in `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/transform.ts`, `src/dashboard/fragments.ts`.
- Ensure pricing rates for `claude-opus-5` are $5 (input) / $0.50 (cache read) / $25 (output).
- Ensure image compression eligibility checks match `claude-opus-5`.

### Milestone 2 (R2): Request Transformation & Upstream Model Rewriting
- Ensure `/v1/messages` and `/v1/responses` request payload rewriting maps model field to `claude-opus-5` when Opus 5 mapping is active.

### Milestone 3 (R3): Unit & Integration Test Suite Verification
- Update test cases in `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/reflow.test.ts`, `tests/transform.ts`.
- Verify `npx tsc --noEmit` exits 0.
- Verify `pnpm test` passes all tests.

### Milestone 4 (R4): Build, Daemon Restart & Live HTTP Integration Test
- Run `pnpm run build` to update `dist/node.js`.
- Restart `TraderBotPxpipeProxy` scheduled task / process daemon.
- Execute live HTTP request to `http://127.0.0.1:47821/v1/messages` with `{"model": "claude-opus-4-8"}` and verify response and `events.jsonl` log.

## Gate Verification
Each milestone loop follows: Explorer -> Worker -> Reviewers (2) + Challenger (2) + Forensic Auditor -> Gate Verification.
