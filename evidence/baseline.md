# PXPipe Evidence-First Modernization — Baseline Report (Phase 0)

**Date**: 2026-09-24T10:05:00Z  
**Phase**: Phase 0 — Boot, Backup, and Baseline  
**Lead / Worker**: Phase 0 Baseline Worker (`worker_phase0_baseline`)  
**Workspace**: `C:\Projects\pxpipe`  
**Canonical Config**: `C:\Users\auron\.traderbot\pxpipe\config.json`  

---

## 1. Executive Summary

Phase 0 establishes the empirical, non-mutating baseline for the PXPipe Context-to-Image Proxy system before any code modification, model catalog modernization, or rendering geometry experimentation begins.

Key Baseline Findings:
1. **Repository Health**: `npx tsc --noEmit` exits 0 (clean). `npx vitest run` passes 100% (83/83 test files, 1,246/1,246 unit and integration tests passing in 9.26s).
2. **Runtime Service**: `TraderBotPxpipeProxy` is active on port `127.0.0.1:47821` under PID 49268 (`node.exe C:\Projects\pxpipe\dist\node.js`), serving HTTP 200 on `/` and `/build-info` with verified build provenance (`bundle_verified: true`, source SHA `3c5b729730c57d5439e85260cdc7d7ba01a66e09`).
3. **Service Restart Constraint**: In accordance with user directives, service restart is **NOT AUTHORIZED**. Runtime verification of changes is labeled **PENDING**.
4. **Configuration Backup**: Verified sibling backup created at `C:\Users\auron\.traderbot\pxpipe\config.json.bak-20260924T100310Z` (257,209 bytes, SHA256: `a903403782d78383bb83165a0240509910765f604b22b3eb8e8af4214f778b0d`). Both original and backup validated byte-for-byte and parsed via JSON parser without error.
5. **Auditing Tool**: `unify_pxpipe.py` does not exist in `C:\Projects\pxpipe` or `C:\Projects\TraderBot\scripts\pxpipe\` and is not referenced in package scripts or repository documentation. It is documented as **MISSING / UNDOCUMENTED**.
6. **Pre-Existing Uncommitted Working Tree Drift**: Pre-existing unstaged modifications exist in `src/core/gemini-model-profiles.ts`, `src/core/gpt-model-profiles.ts`, and `tests/gemini.test.ts`, plus untracked test suites `tests/challenger-adversarial.test.ts` and `tests/gpt6-profiles.test.ts`. All of these tests currently pass cleanly.

---

## 2. Environment & Runtime Versions Table

| Component | Version | Executable / Path | Verification Command | Exit Code |
| :--- | :--- | :--- | :--- | :---: |
| **Node.js** | `v22.9.0` | `C:\Program Files\nodejs\node.exe` | `node -v` | 0 |
| **npm** | `11.19.0` | `C:\Program Files\nodejs\npm.cmd` | `npm -v` | 0 |
| **TypeScript** | `7.0.2` | `npx tsc` (local node_modules devDep) | `npx tsc -v` | 0 |
| **pnpm** | `10.21.0` | `pnpm` (system PATH) | `pnpm -v` | 0 |
| **Python** | `3.12.10` | `C:\Projects\TraderBot\backend\.venv\Scripts\python.exe` | `python.exe --version` | 0 |
| **Git** | `2.54.0.windows.1` | `C:\Program Files\Git\cmd\git.exe` | `git --version` | 0 |
| **Host OS** | Windows 11 Pro (Build 26100) | `JWR-ABYSS` (PowerShell 7 host) | Native pwsh | 0 |

---

## 3. Git State & Working Tree Audit

- **Active Branch**: `main`
- **Upstream Tracking**: `origin/main` (local is ahead by 4 commits)
- **HEAD Commit SHA**: `3c5b729730c57d5439e85260cdc7d7ba01a66e09`
- **Commit Message**: `fix(warp): Windows TLS root certificates and SSE streaming pass-through`
- **Working Tree Status**:
  - `modified: src/core/gemini-model-profiles.ts` (adds `gemini-3.5-flash`, `gemini-3.8-live`, `gemini-omni-1.1-flash`)
  - `modified: src/core/gpt-model-profiles.ts` (adds `GPT6_ASTRA_PROFILE`, `GPT6_SOL_PROFILE`, `GPT6_LUNA_PROFILE`, and `^gpt-6` rules)
  - `modified: tests/gemini.test.ts` (adds assertions for 3.5-flash, 3.8-live, omni-1.1-flash)
  - `untracked: tests/challenger-adversarial.test.ts` (11 adversarial stress tests covering bracketed suffixes, Gen 6 down-rewrite prevention, cache preservation, image budgets)
  - `untracked: tests/gpt6-profiles.test.ts` (4 unit tests verifying GPT-6 profile resolution and 14px geometry)

---

## 4. Service / Port / PID State

### Port 47821 Socket Probe
```powershell
Get-NetTCPConnection -LocalPort 47821
```
Output:
- **LocalAddress**: `127.0.0.1`
- **LocalPort**: `47821`
- **State**: `Listen`
- **OwningProcess**: `49268`
- **Active Connections**: 5 Established loopback sockets (telemetry / idle keepalives), multiple TimeWait sockets.

### Process Inspection
```powershell
Get-Process -Id 49268 | Select-Object Id, ProcessName, StartTime, Path, CommandLine
```
- **PID**: `49268`
- **ProcessName**: `node`
- **StartTime**: `2026-09-24 05:16:03 AM EDT`
- **Path**: `C:\Program Files\nodejs\node.exe`
- **CommandLine**: `"C:\Program Files\nodejs\node.exe" "C:\Projects\pxpipe\dist\node.js"`

### Scheduled Task Lifecycle
```powershell
Get-ScheduledTask -TaskName 'TraderBotPxpipeProxy'
```
- **TaskName**: `TraderBotPxpipeProxy`
- **State**: `Ready`
- **Action**: `pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\auron\.traderbot\pxpipe_supervisor.ps1"`
- **WorkingDirectory**: `C:\Users\auron\.traderbot`

### HTTP Health & Build Provenance Probe
- `GET http://127.0.0.1:47821/`: Returns `HTTP 200` (PXPipe Dashboard HTML)
- `GET http://127.0.0.1:47821/build-info`: Returns `HTTP 200`:
```json
{
  "schema_version": 1,
  "repository": "teamchong/pxpipe",
  "source_sha": "3c5b729730c57d5439e85260cdc7d7ba01a66e09",
  "source_ref": "main",
  "dirty": false,
  "package_version": "0.13.2",
  "node_executable": "C:\\Program Files\\nodejs\\node.exe",
  "node_version": "v26.4.0",
  "built_at_utc": "2026-09-24T07:47:16.753Z",
  "entry_sha256": "c9c58a7b8907f51734eb6e1da2b1867db2d15b8431e456fc1c20f1e677be485c",
  "runtime_node_executable": "C:\\Program Files\\nodejs\\node.exe",
  "runtime_node_version": "v26.4.0",
  "runtime_pid": 49268,
  "runtime_entry_sha256": "c9c58a7b8907f51734eb6e1da2b1867db2d15b8431e456fc1c20f1e677be485c",
  "bundle_verified": true
}
```

---

## 5. Sibling Backup Receipt

To ensure 100% reversible configuration operations, a verified sibling backup was taken before any Phase 1-4 changes:

- **Original Path**: `C:\Users\auron\.traderbot\pxpipe\config.json`
- **Backup Path**: `C:\Users\auron\.traderbot\pxpipe\config.json.bak-20260924T100310Z`
- **File Size**: `257,209 bytes`
- **SHA-256**: `a903403782d78383bb83165a0240509910765f604b22b3eb8e8af4214f778b0d`
- **Integrity Validation**:
  * Decoded as UTF-8 without BOM.
  * Parsed with Python 3.12 standard library `json.loads()`.
  * Verified original and backup contain byte-identical content and matching parsed dictionary representations.

---

## 6. Raw Static Check Outputs & File Provenance

### 6.1 TypeScript Static Typecheck (`npx tsc --noEmit`)
- **Command**: `npx tsc --noEmit`
- **Working Directory**: `C:\Projects\pxpipe`
- **Exit Code**: `0`
- **Output**:
```text
npm warn Unknown project config "minimum-release-age". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown project config "minimum-release-age-exclude". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown project config "ignore-pnpmfile". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
```
*(No TypeScript errors emitted)*

### 6.2 Unit & Integration Test Suite (`npx vitest run`)
- **Command**: `npx vitest run`
- **Working Directory**: `C:\Projects\pxpipe`
- **Exit Code**: `0`
- **Summary**:
  * Test Files: `83 passed (83)`
  * Tests: `1246 passed (1246)`
  * Duration: `9.26s` (transform 10.58s, setup 0ms, import 31.71s, tests 78.42s)
  * Additional verification on untracked tests:
    - `npx vitest run tests/challenger-adversarial.test.ts`: `11 passed (11)` in 264ms, exit code 0.
    - `npx vitest run tests/gpt6-profiles.test.ts`: `4 passed (4)` in 2ms, exit code 0.

### 6.3 PXPipe Audit Script (`unify_pxpipe.py`)
- **Status**: **MISSING / UNDOCUMENTED**
- **Evidence**:
  * `find_by_name` across `C:\Projects\pxpipe`: 0 matches.
  * `find_by_name` across `C:\Projects\TraderBot\scripts\pxpipe\`: 0 matches.
  * `grep_search` across `C:\Projects\pxpipe`: 0 references.
  * `grep_search` across `C:\Projects\TraderBot\.agents`: 0 references.
  * Package scripts in `package.json` define: `audit` (`pnpm audit --prod --audit-level high`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). There is no script or Python file named `unify_pxpipe.py`.

### 6.4 Core File Hashes (Pre-Modernization Baseline)
All files that may be inspected or modified in Phases 1-5:

| SHA-256 | Size (Bytes) | Relative Path |
| :--- | :---: | :--- |
| `b215d7e639f66f988d0beb5ca80e65f47bba889e780e355a6b496c4d911b5de2` | 2,793 | `package.json` |
| `cff32d7f46c7e552b87936230ec21f2332a0f205170011ce16fe74e52acf3d65` | 739 | `tsconfig.json` |
| `15c36fec820fd237271206675d3c61ccb116f6a7d1b3a211ef7018b2fc17a91b` | 61,037 | `src/node.ts` |
| `5980d00aed5e931f41ba7f9a5b7e097f4f5ad1c904d151162f9a0b7c0fff847b` | 60,865 | `src/core/render.ts` |
| `ab352212d86e72e5e54716fbcf930e8a59506b67f89f82ddf0b89c99eb629afc` | 2,660 | `src/core/profile-base.ts` |
| `eb8c9269a8cfbf5284c8535a79e8c453339b2700423fb27128007637d5ba97bd` | 8,233 | `src/core/claude-model-profiles.ts` |
| `72e02b0488a7177c54ff924c4da8bbcbef00949ad818e41924650a941c438fa2` | 31,473 | `src/core/gpt-model-profiles.ts` |
| `a75871aa2be4011093c1305ad4d3484a6f61c5dc823ea815bbb16705e8df75e3` | 5,965 | `src/core/gemini-model-profiles.ts` |
| `2b6b690c17ce4eaaae2912063a55f730c12f9821f7c9f64190e752386f626136` | 144,624 | `src/core/transform.ts` |
| `a39864722f51a4fe317801761197d64a1864731927fd2bf9a0fd475bc4908694` | 96,432 | `src/core/proxy.ts` |
| `444fbf74ca18013608b56864f16dc2dc90faa1f471e86f72fbb0b26fe2333146` | 50,652 | `src/core/history.ts` |
| `1485855475b391504c3908e6c78b4098a0d7402b75683fb047ec5b96c2575039` | 52,654 | `src/core/openai-history.ts` |
| `e1e06a45809ea80170bb26bce44840969b4d4853b954e956fcd78e6e6e4efc49` | 15,829 | `src/core/factsheet.ts` |
| `bfc279bf6f6cc54d63b8f5ab826c20edc80cf92510a1a95a30949dd3e0576e0f` | 3,140 | `src/core/types.ts` |
| `5611d5d398161354c2bef4d290dc8faae7a8b5bfdc334db1a384563bba42c2b5` | 6,107 | `src/core/provider-router.ts` |
| `bcee8f7a7b6e4eb045052cb5ec04db0d5a0ba98d51d244e14fe8128bdeb4a52d` | 7,130 | `src/core/vision-cost.ts` |
| `3bf76babb39657fe85e3ca29b8106208ac3089cdd9623e542171c2bacb4611cf` | 7,595 | `src/core/measurement.ts` |
| `a903403782d78383bb83165a0240509910765f604b22b3eb8e8af4214f778b0d` | 257,209 | `~/.traderbot/pxpipe/config.json` |

---

## 7. Categorized Baseline Table

| Category | Item / Symptom | Evidence & Impact | Status / Disposition |
| :--- | :--- | :--- | :--- |
| **Reproducible Failure** | `unify_pxpipe.py` script missing | Acceptance criterion in brief references `unify_pxpipe.py` exit 0, but no such script exists in pxpipe or TraderBot. | Documented as missing; audit suite relies on `npx tsc --noEmit` + `npx vitest run`. |
| **Reproducible Failure** | Config bloat & unverified models | `config.json` contains 12,025 lines with hundreds of legacy/unverified model names, stubs, and inconsistent pricing/cache keys. | Targeted for bounded Phase 4 cleanup per verified model matrix. |
| **Reproducible Failure** | `min_body_bytes` config key ignored | In `config.json`, `min_body_bytes` is present but `src/node.ts` only reads `PXPIPE_MIN_BODY_BYTES` env var. | Documented defect for Phase 1 proxy config parser repair. |
| **Warning** | npm `.npmrc` compatibility warnings | `npm warn Unknown project config "minimum-release-age"` printed during npx calls. | Cosmetic pnpm/npm configuration collision; does not impact build or test outcomes. |
| **Warning** | Uncommitted git working tree drift | Changes to `src/core/*-model-profiles.ts` and untracked challenger tests are uncommitted on `main`. | Preserved and documented; must be committed or segregated in appropriate branches. |
| **Environment Blocker** | Service Restart Not Authorized | User instructions strictly forbid restarting `TraderBotPxpipeProxy`. | Proxy PID 49268 remains untouched; all runtime verification is labeled PENDING. |
| **Environment Blocker** | Zero Paid Frontier Token Burn | Live inference calls to OpenAI/Anthropic/Google/xAI are strictly prohibited. | All verification restricted to local vitest suites, mock HTTP endpoints, and static proofs. |
| **Already-Passing** | TypeScript Compilation | `npx tsc --noEmit` exits 0 cleanly with zero errors. | Green baseline confirmed. |
| **Already-Passing** | Unit & Integration Test Suite | `npx vitest run` passes 83/83 suites, 1246/1246 tests in 9.26s. | Green baseline confirmed. |
| **Already-Passing** | TCP Listener & Build Info | `127.0.0.1:47821` listening, dashboard HTTP 200, build provenance verified. | Service online and healthy. |

---

## 8. Phase 2 Geometry Candidate Matrix & Evaluation Proposal

In accordance with Phase 2 requirements of the Execution Plan, the benchmark matrix, candidate configurations, metrics, and weights are established here to bind subsequent rendering optimization:

### 8.1 Representative Benchmark Fixtures
The benchmark suite must evaluate rendering across 6 diverse, deterministic fixtures:
1. **Short Code Snippet** (~100 lines, high indentation, symbols, brackets).
2. **Long Monolithic File** (~1,500 lines, mixed comments and functions).
3. **Structured JSON / Config** (deeply nested keys, quotation marks, arrays).
4. **Unicode & Non-ASCII** (CJK characters, accented letters, emoji, Box Drawing characters).
5. **Dense Formatted Table** (ASCII tables with pipes `|`, dashes `-`, alignment columns).
6. **Real-World Agent Tool Output / Git Diff** (unified diffs with `+`/`-`, file headers, commit SHAs).

### 8.2 Candidate Parameter Grid

| Parameter | Allowed / Tested Candidate Values | Rationale |
| :--- | :--- | :--- |
| **`stripCols`** | `84`, `152`, `200`, `312` | 84 cols (standard terminal / JetBrains Mono 14px), 152 cols (Grok optimized), 200 cols (mid-density), 312 cols (Spleen 5x8 ultra-dense). |
| **`maxHeightPx`** | `512`, `728`, `1568`, `1954` | 512 px (Grok vision tile match), 728 px (Anthropic optimal tile aspect), 1568 px (Spleen max page), 1954 px (OpenAI patch ceiling). |
| **`cellWBonus`** | `0`, `2`, `4` | Extra pixel width per cell for character spacing. |
| **`cellHBonus`** | `0`, `2`, `4` | Extra pixel height per cell for line height / descenders. |
| **Font** | `spleen-5x8`, `jetbrains-mono-10`, `jetbrains-mono-12`, `jetbrains-mono-14` | Supported 1-bit and grayscale font atlases in `src/core/`. |
| **Anti-Aliasing (`aa`)** | `true`, `false` | True for grayscale font atlases; false for 1-bit binary pixel fonts. |
| **Grid Lines (`grid`)** | `false`, `true` | False default; true tested for multi-column legibility. |

### 8.3 Scoring Metrics & Deterministic Tie-Breaking Hierarchy

| Metric | Weight | Measurement Method | Target Direction |
| :--- | :---: | :--- | :--- |
| **1. Clipping / Character Loss** | **1.0 (Hard Veto)** | Character-by-character roundtrip verification across all fixture lines. Any character truncation or drop immediately disqualifies candidate. | Zero loss required |
| **2. Image Count Efficiency** | **0.35** | Number of PNG images generated for a given character count. Fewer images = lower vision token overhead and lower socket failure risk. | Minimize |
| **3. Payload Size (Bytes)** | **0.30** | Total compressed PNG byte size across all generated images. Smaller payload = lower network latency and memory usage. | Minimize |
| **4. Render Latency (ms)** | **0.20** | Time required to encode and render all images in milliseconds using `@napi-rs/canvas` or software atlas rasterizer. | Minimize |
| **5. Configuration Simplicity** | **0.15** | Penalizes arbitrary or brittle overrides; prefers unified family profiles over per-minor-version configurations. | Maximize simplicity |

**Deterministic Tie-Breaker Rule**:
If two configurations achieve equal score within 1%:
1. Higher character headroom (zero clipping) wins;
2. Fewer images per request wins;
3. Smaller payload byte count wins;
4. Faster render latency wins;
5. Defaulting to built-in Spleen 5x8 or JetBrains Mono 14px wins.

---

## 9. Service Lifecycle & Restart Protocol

### 9.1 Service Restart Status: NOT AUTHORIZED
- In accordance with the Phase 0 brief and user safety instructions: **Restart of `TraderBotPxpipeProxy` is NOT AUTHORIZED**.
- The existing running daemon (PID 49268) remains in production serving incoming traffic.
- All Phase 1-5 verification is marked **RUNTIME VERIFICATION: PENDING (AWAITING OPERATOR RESTART AUTHORIZATION)**.

### 9.2 Exact Sanctioned Restart Commands (For When Authorized)

When the operator provides explicit written authorization to restart the proxy daemon, execute the following sanctioned sequence:

#### Method A: Official Node Supervisor Runbook (Preferred)
```powershell
cd C:\Projects\pxpipe
node scripts/restart.mjs
```
*What this does*:
1. Scans for existing proxy PIDs running `bin/cli.js` (including PID 49268) and sends polite shutdown signal via `taskkill /PID /T`.
2. Escalates to `/F` if process does not exit within 5 seconds.
3. Automatically runs `node scripts/build.mjs` to produce fresh `dist/` artifacts.
4. Verifies TCP port 47821 is completely free.
5. Launches fresh `node bin/cli.js` with verified build provenance.

#### Method B: Windows Scheduled Task Restart
```powershell
Stop-ScheduledTask -TaskName 'TraderBotPxpipeProxy' -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'TraderBotPxpipeProxy'
```

#### Method C: Direct Background Supervisor Launch
```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\auron\.traderbot\pxpipe_supervisor.ps1"
```

---

## 10. Gate A Readiness Recommendation

**Recommendation**: **GATE A CLEARED — PROCEED TO PHASE 1**.

**Justification**:
1. **Zero Breaking Errors in Baseline**: `tsc --noEmit` and `vitest run` are 100% green.
2. **Safe Backups Established**: Sibling backup of `config.json` is validated and stored.
3. **Concrete Repair Targets Identified**:
   - Parse `min_body_bytes` from `config.json` in `src/node.ts`.
   - Resolve uncommitted working tree diffs and commit verified tests.
   - Clarify `unify_pxpipe.py` absence in documentation.
   - Modernize model profiles and pricing according to authoritative citations.
4. **Scope Boundaries Intact**: No source code or configuration files were modified during Phase 0.
