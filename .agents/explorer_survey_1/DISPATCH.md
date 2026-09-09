## 2026-07-26T20:34:10Z

You are Survey Explorer 1 for PXPipe Model Registry refactoring.
Your task is to conduct a detailed read-only code survey of the Core Engine files in PXPipe (`C:\Projects\pxpipe`).

Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md` first.

Your specific scope:
1. Examine `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, `src/core/transform.ts`, and any other related core files.
2. Document all existing model definitions, pricing structures, context window lengths, aliases, render profiles, applicability checks, reasoning/effort settings, and configuration loading (`PXPIPE_CONFIG`, `~/.config/pxpipe/config.json`).
3. Identify all hardcoded context window lengths (e.g., hardcoded 128k) and ad-hoc model checks that must be replaced by `src/core/model-registry.ts`.
4. Outline the exact data schema and interface needed for `PxpipeModelProfile` in `src/core/model-registry.ts` to satisfy R1 and R2 in ORIGINAL_REQUEST.md.

Working directory: `C:\Projects\pxpipe\.agents\explorer_survey_1`
Write your findings and evidence chain to `C:\Projects\pxpipe\.agents\explorer_survey_1\handoff.md` and maintain `progress.md` heartbeat. When done, notify parent via send_message.
