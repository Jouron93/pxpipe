# Prior Art Index — PXPipe Evidence-First Modernization

**Date**: 2026-09-24T10:16:00Z  
**Phase**: Phase 1 — Local Prior Art Discovery & Defect Indexing  
**Author**: Research Specialist / Spec Miner (`spec_miner_phase1_prior_art`)  
**Workspace**: `C:\Projects\pxpipe`  
**Referenced Sources**: `C:\Projects\pxpipe`, `~/.traderbot/pxpipe/config.json`, `~/.traderbot/pxpipe/unify_pxpipe.py`, `C:\Projects\TraderBot\.agents\teamwork\`  

---

## 1. Executive Summary

This Prior Art Index synthesizes the empirical development history, architectural decisions, discovered failure modes, and current codebase status for the PXPipe Context-to-Image Proxy system. Every entry is grounded in concrete repository artifacts, commit diffs, live test executions, and configuration files.

Key Findings Overview:
1. **Windows TLS & SSE Streaming**: Confirmed fully resolved in commit `3c5b7297`. Explicit root CA injection prevents outbound TLS drops on Windows, and immediate header flushing prevents client SSE timeouts.
2. **Vision Strip Geometry & Typography**: Documented empirical trade-off between ultra-dense packing (`spleen-5x8`, 312 cols, 5.28× token cut, 63% verbatim OCR accuracy) and high-fidelity legibility (`jetbrains-mono-14`, 84/172 cols, 1.47× token cut, 100% verbatim OCR accuracy). Clamping to 1568×728 px eliminates destructive 0.555× API downscaling.
3. **Prompt & Context Caching**: Fully documented provider-specific cache semantics. Solved the "moving boundary cache-shredder" failure mode via discrete 50-turn quantized history staircases (`collapseChunk: 50`) and cache breakpoint relocation to the terminal image block.
4. **Model Naming & Gen 6 Prevention of Down-Rewriting**: Verified precedence rules in `src/core/gpt-model-profiles.ts` placing Gen 6 (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6-terra`) at the top of `BUILTIN_RULES`, preventing legacy down-rewriting to Gen 5.6. Verified bracketed tag stripping (`[1m]`, `[200k]`).
5. **Configuration Parsing Defect (`min_body_bytes`)**: Confirmed active defect in `src/node.ts`. The top-level key `min_body_bytes: 25000` exists in `config.json` and is validated by `unify_pxpipe.py`, but `src/node.ts` only inspects `process.env.PXPIPE_MIN_BODY_BYTES`, silently ignoring the configured file setting.
6. **Auditing Script Provenance (`unify_pxpipe.py`)**: Located and verified at `C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py`. It is an external operational SOT audit tool (not part of the `C:\Projects\pxpipe` repository). It runs cleanly with exit code 0 (`[PXPIPE AUDIT OK]`), validating 79 model scope entries and 1,392 imaging profiles.

---

## 2. Comprehensive Prior Art Index Table

| # | Source Reference | Claim / Lesson / Failure Mode | Date / Version | Status in Current Code | Verified Evidence / Code Excerpt |
|---|---|---|---|---|---|
| **1** | Git Commit `3c5b7297` (`src/node.ts:1089-1093`) | **Windows Outbound TLS Drops**: Node on Windows does not automatically trust OS system roots for outbound fetch, causing upstream HTTPS connections to fail unless roots are explicitly provided. | 2026-09-21 (v0.13.2) | **Resolved** | `src/node.ts`: `if (process.platform === 'win32') { setGlobalDispatcher(new Agent({ connect: { ca: [...rootCertificates] } })); }` |
| **2** | Git Commit `3c5b7297` (`src/node.ts:422`, `tests/sse-delivery.test.ts`) | **Client SSE Timeout Before First Token**: Client timeouts occurred when upstream LLM took several seconds to generate the first token because HTTP response headers were buffered. | 2026-09-21 (v0.13.2) | **Resolved** | `src/node.ts`: `if (res.headers.get('content-type')?.includes('text/event-stream')) out.flushHeaders();` verified by `tests/sse-delivery.test.ts`. |
| **3** | Git Commit `3c5b7297` (`src/warp/ca.ts:98-140`, `tests/warp-windows.test.ts`) | **Child Process HTTPS Breakage via `SSL_CERT_FILE`**: Overwriting `SSL_CERT_FILE` / `CURL_CA_BUNDLE` with only the local Warp MITM CA breaks standard external HTTPS calls in subprocesses (pip, gcloud, curl). | 2026-09-21 (v0.13.2) | **Resolved** | `src/warp/ca.ts`: `writeBundle()` combines local `warp-ca.pem` with OS root certificates into `warp-ca-bundle.pem`, assigning `SSL_CERT_FILE` and `CURL_CA_BUNDLE` to the combined bundle while `NODE_EXTRA_CA_CERTS` gets `warp-ca.pem`. |
| **4** | `docs/LEGIBILITY-AUDIT-2026-07-01.md`, `docs/RENDER_SIZING.md:37-47` | **Destructive 0.555× API Downsampling**: Anthropic API enforces long-edge ≤ 1568 px and ~1.15 MP. Legacy 1932×1932 px pages were billed at max cap but downscaled 0.555× by Anthropic, turning 5×8 glyphs into illegible 2.8×4.4 px blur. | 2026-07-01 | **Resolved** | Clamped page geometry to 1568×728 px = 1.14 MP (`src/core/render.ts:MAX_HEIGHT_PX = 728`, `ANTHROPIC_SLAB_COLS = 312`). WYSIWYG ratio improved from 3.25 to 1.04. |
| **5** | `docs/LEGIBILITY-AUDIT-2026-07-01.md:59-79`, `docs/NOT-OCR.md:43-62` | **Spleen 5×8 Font Confusability Floor**: 45/94 ASCII chars in Spleen 5×8 have Hamming distance ≤ 3 px. Verbatim reading tops out at 63% (hex strings at 38% / 0/15 on non-Fable models). Errors are silent confabulations. | 2026-07-01 | **Confirmed Constraint** | `docs/NOT-OCR.md`: High-density 5×8 is lossy for random hashes/identifiers. Factsheet mechanism (`src/core/factsheet.ts`) extracts up to 96 precision-critical strings to send as native text alongside images. |
| **6** | `docs/MODEL_RENDER_PROFILES.md:17-23`, `docs/RENDER_SIZING.md:20-25` | **Legibility vs Density Profile Split**: Native 14px JetBrains Mono (`jetbrains-mono-14`, 84/172 cols) yields 100% verbatim recall on hashes, but reduces compression to 1.47× vs text (compared to 5.28× for Spleen 5×8). | 2026-07-09 | **Confirmed** | Claude Fable defaults to Spleen 5×8 (312 cols); Claude Sonnet/Opus and GPT-5.6 Sol default to JetBrains Mono 14px (172 / 84 cols) with opt-in status. |
| **7** | `docs/MODEL_RENDER_PROFILES.md:95-98` | **Font Overshoot Resample Penalty**: Increasing font size without reducing column count overshoots provider's no-resize boundary, triggering server-side downsampling and destroying legibility. | 2026-07-09 | **Confirmed Rule** | Rule: `stripCols` and `style` must always be tuned together. For 14px font, `stripCols` must be scaled down (e.g. 172 cols for 1568px width; 84 cols for 768px width). |
| **8** | `docs/RENDER_SIZING.md:44-59`, `src/core/transform.ts:103-109` | **Decoded Image Payload 20 MiB Crash Cliff**: Sending requests exceeding ~20 MiB of decoded image data triggers HTTP 500/502/empty responses from upstream providers, and `/compact` cannot recover. | 2026-07-15 | **Resolved & Enforced** | `src/core/transform.ts`: `maxImageBytes = 18 * 1024 * 1024` (18 MiB soft limit, 20 MiB ceiling). Groups admitted atomically: if a group exceeds budget, it stays as text. Verified by `tests/challenger-adversarial.test.ts:325-346`. |
| **9** | `docs/RENDER_SIZING.md:44-46`, `src/core/history.ts:33`, `src/core/transform.ts:255` | **Anthropic 100-Image Request Cap**: Anthropic API strictly rejects requests containing more than 100 images with a 400 error. | 2026-07-15 | **Resolved & Enforced** | `src/core/history.ts`: `ANTHROPIC_MAX_IMAGES = 100`. `imageHeadroom()` dynamically subtracts native user images and reserves safety slots. Collapsed history is rejected when headroom is exhausted. |
| **10** | `docs/HISTORY_CACHE_MODEL.md:47-64`, `docs/CACHING_AND_SAVINGS.md:58-62` | **Moving Boundary Cache Shredder (Bug #28)**: A continuous moving window (`cutoff = messages.length - keepTail`) re-renders and re-keys images every turn, paying a 1.25× cache-create write penalty every turn and resulting in −250% negative savings. | 2026-05-19 | **Resolved** | `src/core/history.ts:70-76`: Quantized staircase boundary: `Math.floor(rawCutoff / collapseChunk) * collapseChunk` (default `collapseChunk = 50`). Imaged prefix stays byte-identical (`history_image_sha8`) for ~50 turns, yielding 90% cache read discounts. |
| **11** | `docs/CACHING_AND_SAVINGS.md:41-45`, `tests/challenger-adversarial.test.ts:168-250` | **Breakpoint Invalidation in Image Transformations**: Inserting extra cache markers or dropping existing markers invalidates Anthropic prompt cache keys or exceeds the 4-breakpoint limit. | 2026-06-15 | **Resolved** | `src/core/transform.ts`: PXPipe does not synthesize new markers; it relocates the caller's existing `cache_control` marker onto the final image block of the stable prefix. Intermediate blocks have `cache_control` removed. |
| **12** | `docs/CACHING_AND_SAVINGS.md:49-62` | **Anthropic System Block Image Incompatibility**: Anthropic API rejects images inside the `system` parameter with `400 system.N.type: Input should be 'text'`. | 2026-05-10 | **Resolved** | `src/core/transform.ts`: Transformed image blocks are placed inside a synthetic initial `user` message (`messages[0]`). The `system` parameter retains only text instructions and factsheets. |
| **13** | `docs/CACHING_AND_SAVINGS.md:65-76` | **Mode-Switching Cache Burn Penalty**: Toggling between text and image modes invalidates warm provider caches, paying a one-time 1.15× write premium (`1.25 - 0.10`). | 2026-06-20 | **Resolved** | `src/core/transform.ts:116-123`: Symmetric burn formula: `burnImageSide = priorWarmTokens * (1.25 - 0.10)`; `burnTextSide = priorWarmImageTokens * (1.25 - 0.10)`. Mode flips are blocked unless net token savings exceed burn penalty. |
| **14** | `src/core/gpt-model-profiles.ts:229-268`, `tests/gpt6-profiles.test.ts:1-60` | **OpenAI Gen 6 Model Catalog & Pricing**: OpenAI Gen 6 models (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`) feature 1.05M context windows, 32px patch vision, and 50% prefix caching discount (`cacheReadRate: 0.5`). | 2026-09-22 | **Confirmed** | `src/core/gpt-model-profiles.ts`: Profiles defined with `GPT6_PRICING = { cacheReadRate: 0.5, outputRate: 5 }`. Astra uses 84 cols, 1954 px, JetBrains Mono 14px, and `exactStaticBaseline: true`. |
| **15** | `src/core/gpt-model-profiles.ts:307-336`, `tests/challenger-adversarial.test.ts:116-166` | **Silent Down-Rewriting of Gen 6 Models to Gen 5.6**: Risk of regex rules matching `gpt-6-*` as legacy models or defaulting to Gen 5.6 pricing / tile regimes. | 2026-09-22 | **Resolved** | `src/core/gpt-model-profiles.ts`: Gen 6 rules appear first in `BUILTIN_RULES` (lines 308-326) before any `gpt-5` rules. Unit test in `tests/challenger-adversarial.test.ts` proves `gpt-6-terra` does NOT down-rewrite to `gpt-5.6-terra`. |
| **16** | `tests/challenger-adversarial.test.ts:59-114`, `src/core/claude-model-profiles.ts` | **Bracketed Context Suffixes Routing Failure**: Model IDs with bracketed tokens (e.g. `claude-opus-5-5[1m]`, `claude-sonnet-5[1m]`, `[200k]`, `[fast]`) failing exact match lookups. | 2026-09-22 | **Resolved** | Strip regex removes bracketed suffixes prior to profile resolution while retaining modern 5.x capabilities (`isPre47Claude` returns false). |
| **17** | `src/core/gemini-model-profiles.ts:9-60`, Git Commit `0247e03` | **Gemini Flat Image Pricing & Vision TTFT Stalls**: Gemini charges a flat fee per image (1,078 tokens for 1568×728 px canvas; 1,120 ceiling). Excessive history images cause severe time-to-first-token (TTFT) stalls. | 2026-08-15 | **Resolved** | `src/core/gemini-model-profiles.ts`: `vision: { regime: 'flat', tokens: 1120, exact: { widthPx: 1568, heightPx: 728, tokens: 1078 } }`, `cacheReadRate: 0.25` (75% cache discount). History capped to 32 images (`maxImages: 32`). |
| **18** | `~/.traderbot/pxpipe/config.json`, `src/node.ts:85-104, 171-201` | **`min_body_bytes` Ignored From Configuration**: `config.json` sets `min_body_bytes: 25000`, but `src/node.ts` only checks `process.env.PXPIPE_MIN_BODY_BYTES`, silently ignoring the file setting. | 2026-09-24 | **Open Defect** | In `src/node.ts:applyConfigFileDefaults()`, only `cfg.models` is parsed. In `readConfig()`, `min_body_bytes` is never extracted or passed to proxy/transform options. |
| **19** | `~/.traderbot/pxpipe/unify_pxpipe.py`, `package.json:49-62` | **Location & Role of `unify_pxpipe.py`**: Prior baseline reported `unify_pxpipe.py` as missing because it does not exist in `C:\Projects\pxpipe` or `TraderBot\scripts\`. | 2026-09-24 | **Confirmed External / Resolved** | `unify_pxpipe.py` is an operator SOT validation tool located at `C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py`. It executes successfully with code 0 (`[PXPIPE AUDIT OK]`), validating `config.json` schema and live proxy stats. |
| **20** | `docs/RENDER_SIZING.md:85-91` | **Inefficiency of Square Page Padding**: Padding rendered text pages into squares (e.g. 1024×1024 or 1568×1568) adds large billed pixel area without carrying additional text information. | 2026-06-17 | **Confirmed Design Rule** | PXPipe generates variable-height portrait strips (`width = 2*PAD_X + columns*cellWidth`, `height = 2*PAD_Y + usedRows*cellHeight`), billing only utilized vertical patches. |

---

## 3. Deep Analysis of Critical Architectural Areas

### 3.1 Windows TLS Root Certificates & SSE Streaming Pass-Through
- **Root Cause of Prior Failure**: On Windows, Node.js applications using native `fetch` or `undici` communicate via Schannel or OpenSSL bundles that do not automatically synchronize with the Windows CryptoAPI CurrentUser/LocalMachine Root Trust Store. Furthermore, when `pxpipe warp` intercepts local traffic, setting `SSL_CERT_FILE` to point exclusively to `warp-ca.pem` breaks child processes attempting to connect to external endpoints.
- **The Fix in Commit `3c5b7297`**:
  1. `src/node.ts`: Explicitly registers `undici.Agent({ connect: { ca: [...rootCertificates] } })` as the global dispatcher on `win32`.
  2. `src/node.ts:writeWebResponse()`: Invokes `out.flushHeaders()` immediately upon detecting `text/event-stream` in response headers. This ensures downstream SSE clients (such as Codex and Claude Code) receive response headers immediately, keeping the socket alive while the upstream model completes prefill/generation.
  3. `src/warp/ca.ts`: Implemented `writeBundle()` to merge the local intercept CA with system roots (`warp-ca-bundle.pem`), ensuring both interception and public HTTPS succeed concurrently.

### 3.2 Vision Strip Geometry, Fonts, and Machine Legibility
- **Font Trade-Off**:
  - `spleen-5x8`: Fixed 1-bit bitmap atlas. At 312 columns, yields up to 5.28× compression ratio relative to text. However, pixel collision (e.g. `H~K`, `0~O`, `3~8`, `6~8`) results in a 38% accuracy rate on verbatim hex/identifier strings. Best suited for Claude Fable 5 and high-volume prose.
  - `jetbrains-mono-14`: Grayscale anti-aliased font atlas. At 84 columns (GPT/Grok) or 172 columns (Claude), delivers 100% exact retrieval on verbatim identifiers, but reduces compression ratio to ~1.47×. Necessary for OpenAI GPT-6 and GPT-5.6 Sol.
- **Geometry Clamping**:
  - Anthropic models clamp images to 1568 px max edge and ~1.15 MP. PXPipe strictly enforces 1568×728 px geometry (`src/core/render.ts`), achieving a 1.04 WYSIWYG ratio and preventing destructive API-side resampling.
  - OpenAI models utilize portrait strips: GPT-6 Astra / Sol configured at 84 columns × 1954 px height; Grok configured at 84 columns × 512 px height (matching Grok's 512×512 vision tile structure).

### 3.3 Prompt & Context Caching Semantics Across Frontier Providers
- **Anthropic**:
  - Ephemeral cache breakpoints (`cache_control: {"type": "ephemeral"}`).
  - PXPipe relocates the caller's breakpoint to the terminal image block of the static slab.
  - History aging uses a 50-turn quantized staircase (`collapseChunk: 50`) to keep the image prefix byte-identical across turns, preventing the catastrophic −250% moving-window cache-shredder regression.
- **OpenAI**:
  - Automatic prefix caching for requests ≥ 1,024 tokens.
  - Cache discount is 50% (`cacheReadRate: 0.5`).
  - Image prefixes participate in prefix caching if byte-identical and at identical token positions.
- **Google DeepMind (Gemini)**:
  - Cache read discount is 75% (`cacheReadRate: 0.25`).
  - Charges a flat fee per image (1,078 tokens for 1568×728 px canvas). History is capped at 32 images (`maxImages: 32`) to prevent vision TTFT stalls.
- **xAI (Grok)**:
  - Megapixel-based vision accounting (`regime: 'mpix'`).
  - 512 px height aligns with 512×512 vision tiles.

### 3.4 Model Catalog Modernization & Gen 6 Down-Rewrite Prevention
- **Gen 6 Frontier Models**:
  - `gpt-6-astra`: 1.05M context, 14px JetBrains Mono, 84 cols, 1954 px height, `exactStaticBaseline: true`, `maxImages: 64`, $10/$50 pricing, 50% cache read discount.
  - `gpt-6-sol`: 1.05M context, 14px JetBrains Mono, 84 cols, 1954 px height, $2/$10 pricing, 50% cache read discount.
  - `gpt-6-luna`: 1.05M context, Spleen font, 152 cols, 1932 px height, $0.50/$2 pricing, 50% cache read discount.
- **Precedence Architecture**:
  - `BUILTIN_RULES` in `src/core/gpt-model-profiles.ts` lists Gen 6 rules at the very top.
  - Suffix stripping logic removes bracketed tags (`[1m]`, `[200k]`, `[fast]`) prior to model resolution, ensuring variants inherit flagship geometry without falling back to legacy profiles.

### 3.5 Request Body Floor: `min_body_bytes` Config vs Environment Parsing
- **Current Defect**:
  - In `C:\Users\auron\.traderbot\pxpipe\config.json`, `"min_body_bytes": 25000` is defined as a top-level key and validated by `unify_pxpipe.py`.
  - However, in `src/node.ts:applyConfigFileDefaults()`, only `cfg.models` is extracted. `readConfig()` reads only `process.env.PXPIPE_MIN_BODY_BYTES`.
  - As a result, running `pxpipe` without explicitly exporting `PXPIPE_MIN_BODY_BYTES=25000` causes the server to ignore the user's config file threshold and fall back to hardcoded transform defaults (`minCompressChars: 2000`).

### 3.6 Auditing Tool Provenance (`unify_pxpipe.py`)
- **Status Clarification**:
  - `unify_pxpipe.py` does not exist inside `C:\Projects\pxpipe` git repository.
  - It exists at `C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py`.
  - Execution receipt:
    ```powershell
    & 'C:\Projects\TraderBot\backend\.venv\Scripts\python.exe' 'C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py'
    # Exits 0, outputs [PXPIPE AUDIT OK], valid: true, 79 models, 1392 imaging profiles, live HTTP probe 200 OK.
    ```
  - Recommendation: Retain `unify_pxpipe.py` in `~/.traderbot/pxpipe/` as the external SOT validator, and document clearly in repo runbooks that repository CI relies on `npx tsc --noEmit` and `npx vitest run`, whereas host runtime verification utilizes `unify_pxpipe.py`.

---

## 4. Summary of Open Defects

| Defect ID | Severity | File / Component | Description | Remediation Plan |
|---|---|---|---|---|
| **DEF-01** | Medium | `src/node.ts:applyConfigFileDefaults()`, `readConfig()` | `min_body_bytes` in `config.json` is ignored; server only inspects `PXPIPE_MIN_BODY_BYTES` env var. | Update `applyConfigFileDefaults()` and `readConfig()` to parse `cfg.min_body_bytes` into `opts.minBodyBytes`, falling back to env var, falling back to default. Add reproduction test in `tests/`. |
| **DEF-02** | Low | `C:\Projects\pxpipe` Working Tree | Pre-existing unstaged modifications in `src/core/gemini-model-profiles.ts`, `src/core/gpt-model-profiles.ts`, `tests/gemini.test.ts`, and untracked challenger tests. | Review, verify via `tsc` and `vitest`, and commit to `main` as part of Phase 1 defect stabilization. |
| **DEF-03** | Low | `~/.traderbot/pxpipe/config.json` | Model catalog bloat (12,025 lines, unverified legacy model stubs, inconsistent cache pricing). | Modernize model catalog in Phase 4 using the verified model evidence matrix, removing dead stubs and validating against `unify_pxpipe.py`. |

---

## 5. Recommendations for Subsequent Phases

1. **Phase 1 Implementation (Proxy Specialist)**:
   - Apply the clean fix for `DEF-01` (`min_body_bytes` parsing in `src/node.ts`).
   - Add unit test verifying that `config.json` `min_body_bytes` is respected over default when no env var is set, and env var overrides config file.
   - Verify `npx tsc --noEmit` and `npx vitest run` exit 0.
2. **Phase 2 (Rendering Specialist)**:
   - Execute the deterministic benchmark matrix specified in Phase 0 Baseline Report across the 6 representative fixtures.
   - Confirm Pareto-optimal geometry parameters per model family (Anthropic 1568×728, GPT-6 84×1954, Grok 84×512).
   - Re-verify boundary behavior of `maxImageBytes` (18 MiB) and `imageHeadroom` (100 images).
3. **Phase 3 (Caching Specialist)**:
   - Run fixture tests proving that unknown cache headers pass through untouched.
   - Verify that Anthropic 1-hour cache write rates and OpenAI prompt token details (`cached_tokens`) are parsed without double counting.
4. **Phase 4 (Model Catalog Modernization - Lead)**:
   - Update `~/.traderbot/pxpipe/config.json` with verified September 2026 frontier model profiles (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `claude-opus-5-5`, `claude-sonnet-5`, `gemini-3.8-flash`, `grok-4.7`).
   - Validate using `C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py` ensuring `[PXPIPE AUDIT OK]` is maintained.
5. **Phase 5 & 6 (Lifecycle & Verification)**:
   - When operator authorizes service restart, execute `node scripts/restart.mjs` and verify persistent supervisor state.
