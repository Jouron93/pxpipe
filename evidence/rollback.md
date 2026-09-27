# PXPipe Evidence-First Modernization — Rollback Runbook (`rollback.md`)

**Document Status**: Authoritative Operations Runbook & Rollback Procedure  
**Phase**: Phase 5 — Integration, Config Modernization & Deliverables  
**Integration Specialist**: `worker_phase4_5_integration`  
**Target Systems**:
- Configuration: `C:\Users\auron\.traderbot\pxpipe\config.json`
- Source Code: `C:\Projects\pxpipe`
- Runtime Daemon: `TraderBotPxpipeProxy` (`127.0.0.1:47821`)
**Date**: 2026-09-24T11:12:00Z  

---

## 1. Executive Summary

This runbook defines the exact, deterministic procedures to roll back all changes made during the PXPipe Evidence-First Modernization campaign. All operations are designed to be 100% reversible, non-destructive, and independently verifiable.

---

## 2. Configuration Rollback (`config.json`)

### 2.1 Sibling Backup Specifications
- **Target File**: `C:\Users\auron\.traderbot\pxpipe\config.json`
- **Validated Sibling Backup**: `C:\Users\auron\.traderbot\pxpipe\config.json.bak-20260924T100310Z`
- **Backup File Size**: 257,209 bytes
- **Backup SHA-256**: `a903403782d78383bb83165a0240509910765f604b22b3eb8e8af4214f778b0d`

### 2.2 Exact PowerShell Restore Command
Execute from PowerShell 7:
```powershell
Copy-Item -Path "C:\Users\auron\.traderbot\pxpipe\config.json.bak-20260924T100310Z" -Destination "C:\Users\auron\.traderbot\pxpipe\config.json" -Force
```

### 2.3 Verification of Restored Configuration
Run the single source of truth validator:
```powershell
& 'C:\Projects\TraderBot\backend\.venv\Scripts\python.exe' 'C:\Users\auron\.traderbot\pxpipe\unify_pxpipe.py'
```
**Acceptance Criteria**:
- Must exit with code `0`.
- Must emit `[PXPIPE AUDIT OK]` to stderr.
- Output JSON must report `"valid": true` and `"errors": []`.

---

## 3. Codebase Rollback (`C:\Projects\pxpipe`)

If it is necessary to revert code modifications made in `C:\Projects\pxpipe`:

### 3.1 Revert Modified Tracked Source Files
Execute from `C:\Projects\pxpipe`:
```powershell
git checkout -- src/core/claude-model-profiles.ts src/core/gemini-model-profiles.ts src/core/gpt-model-profiles.ts src/core/index.ts src/core/proxy.ts src/core/render.ts src/core/transform.ts src/node.ts tests/gemini.test.ts
```

### 3.2 Clean Untracked Phase Test Modules (Optional)
To remove new test files and modules added during modernizations:
```powershell
Remove-Item -Path "src\core\usage-accounting.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\challenger-adversarial.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\gpt6-profiles.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\image-budget.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\min-body-bytes.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\model-catalog.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "tests\provider-cache-alignment.test.ts" -Force -ErrorAction SilentlyContinue
```

### 3.3 Verify Working Tree Cleanliness
```powershell
git status --porcelain
```
Confirm that no unwanted modified files remain.

---

## 4. Service Lifecycle & Gate C Constraint

### 4.1 Current Production Service State: UNTOUCHED
- In accordance with strict user directives and Gate C constraints:
  - **Service restart was NOT AUTHORIZED and was NOT performed**.
  - `TraderBotPxpipeProxy` PID `49268` remains running continuously on `127.0.0.1:47821`.
  - Dashboard (`/`) and `/build-info` continue to serve HTTP 200 without disruption.

### 4.2 Exact Service Restart Sequence (Only When Explicitly Authorized by Operator)
When operator provides written authorization to restart the proxy daemon to pick up configuration or code updates:

#### Method A: Official Node Supervisor Runbook (Recommended)
```powershell
cd C:\Projects\pxpipe
node scripts/restart.mjs
```
*Sequence*:
1. Signals polite termination to running process PID 49268.
2. Escalates to `/F` force termination if not stopped within 5 seconds.
3. Automatically runs `node scripts/build.mjs` to compile fresh bundle in `dist/`.
4. Verifies TCP port 47821 is released.
5. Launches fresh `node bin/cli.js` with verified build provenance.

#### Method B: Windows Scheduled Task Restart
```powershell
Stop-ScheduledTask -TaskName 'TraderBotPxpipeProxy' -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'TraderBotPxpipeProxy'
```

#### Method C: Direct Supervisor Launch
```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\auron\.traderbot\pxpipe_supervisor.ps1"
```

### 4.3 Post-Restart Health Verification
Execute immediately after restart:
```powershell
Get-NetTCPConnection -LocalPort 47821
Invoke-WebRequest -Uri "http://127.0.0.1:47821/" -UseBasicParsing
Invoke-WebRequest -Uri "http://127.0.0.1:47821/build-info" -UseBasicParsing
```
Confirm `Listen` state and HTTP 200 responses.
