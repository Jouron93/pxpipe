# Project: PXPipe Opus 5 Model Alias Mapping

## Architecture
PXPipe is a local proxy service listening on port 47821. It intercepts Anthropic (`/v1/messages`) and OpenAI (`/v1/chat/completions`, `/v1/responses`) API traffic, performs system/prompt reflowing and image compression, enforces model applicability and pricing metrics, logs events to `events.jsonl`, and renders dashboard telemetry.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Opus 5 Model Pricing & Normalization | Resolve `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `claude-opus-5` to canonical `claude-opus-5` with rates $5/$0.50/$25 | M1 | ORIGINAL_REQUEST R1 |
| 2 | Applicability & Image Compression | Update `baseModelId` and image compression eligibility checks for `claude-opus-5` | M1 | ORIGINAL_REQUEST R1 |
| 3 | Dashboard Fragments & Badges | Update dashboard chip fragments in `src/dashboard/fragments.ts` | M1 | ORIGINAL_REQUEST R1 |
| 4 | Upstream Payload Rewriting | Rewrite `model` field in forwarded request body to `claude-opus-5` for `/v1/messages` and `/v1/responses` | M2 | ORIGINAL_REQUEST R2 |
| 5 | Unit & Integration Test Suite | Update `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/reflow.test.ts`, `tests/transform.ts` | M3 | ORIGINAL_REQUEST R3 |
| 6 | Typecheck & Test Pass | Verify `npx tsc --noEmit` (0 errors) and `pnpm test` (100% passing) | M3 | ORIGINAL_REQUEST R3 |
| 7 | Build Bundle | Run `pnpm run build` to update `dist/node.js` | M4 | ORIGINAL_REQUEST R4 |
| 8 | Daemon Restart & HTTP Integration | Kill running PID on 47821, start task `TraderBotPxpipeProxy`, test HTTP POST `/v1/messages` with `claude-opus-4-8` and verify `events.jsonl` | M4 | ORIGINAL_REQUEST R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Model Alias & Normalization | `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/dashboard/fragments.ts` | None | PLANNED |
| M2 | Request Transformation & Upstream Rewriting | `src/core/transform.ts`, `src/core/openai.ts`, `src/core/proxy.ts` | M1 | PLANNED |
| M3 | Test Suite Verification | `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/reflow.test.ts` | M1, M2 | PLANNED |
| M4 | Build, Daemon Reload & Live HTTP Integration | Build `dist/node.js`, restart PID/Task, run POST test to port 47821 | M1, M2, M3 | PLANNED |

## Interface Contracts
### `resolveModelRate(model: string)`
- Inputs: Any Opus string (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `claude-opus-5`)
- Output: `{ canonicalModel: 'claude-opus-5', inputPerMtok: 5.0, cachedInputPerMtok: 0.5, outputPerMtok: 25.0 }`

### `baseModelId(model: string)`
- Inputs: Opus family variant
- Output: `'claude-opus-5'`

### Request Body Transformation (`transformRequest` & `proxy.ts`)
- Inbound JSON payload `"model": "claude-opus-4-8"` (or other Opus variant)
- Outbound JSON payload to upstream `"model": "claude-opus-5"`

## Code Layout
- `src/core/model-pricing.ts`: Model rate lookup table and resolution logic
- `src/core/applicability.ts`: Model support check and base model ID mapping
- `src/core/transform.ts`: Anthropic `/v1/messages` body transformation & model field rewrite
- `src/core/openai.ts`: OpenAI `/v1/chat/completions` & `/v1/responses` body transformation
- `src/core/proxy.ts`: Main proxy request handling & upstream forwarding
- `src/dashboard/fragments.ts`: Dashboard UI fragments and model badges
- `tests/`: Unit and integration test suite
