## 2026-07-26T20:21:58Z

<USER_REQUEST>
You are the Project Orchestrator for the PXPipe unified per-model configuration registry implementation.

Working directory: C:\Projects\pxpipe
Original Request Path: C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md
Your Agent Directory: C:\Projects\pxpipe\.agents\orchestrator

Please read C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md and execute the implementation end-to-end:

### Key Requirements:
1. **Model Registry (`src/core/model-registry.ts`)**:
   - Define `PxpipeModelProfile` schema.
   - Implement profiles for Claude family, OpenAI/Codex family, Grok family, AGY Proxy family, and NVIDIA NIM family (high-tier flagships + dynamic prefix matching `nvidia/*`, `deepseek-ai/*`, `meta/*`, `mistralai/*`, `openai/gpt-oss-*`).
   - Support alias matching (e.g. `claude-opus-4-8` -> `claude-opus-5`).

2. **Refactor Core Engines**:
   - Refactor `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, and `src/core/transform.ts` to consume `model-registry.ts`.
   - Ensure runtime overrides via `PXPIPE_CONFIG` / `~/.config/pxpipe/config.json`.

3. **Dashboard UI (`src/dashboard/fragments.ts`)**:
   - Render per-family sections with individual toggle chips for every model.

4. **Testing, Build & Service Reload**:
   - Update tests in `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`.
   - Ensure `npx tsc --noEmit` and `pnpm test` pass clean (exit 0).
   - Run `pnpm run build` to generate `dist/node.js`.
   - Restart `TraderBotPxpipeProxy` (port 47821) and verify proxy health.

Maintain `C:\Projects\pxpipe\.agents\orchestrator\progress.md` and `BRIEFING.md`. When all requirements and acceptance criteria are completely satisfied and verified, report victory to me.
</USER_REQUEST>
