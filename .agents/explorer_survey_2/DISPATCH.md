## 2026-07-26T20:34:10Z
You are Survey Explorer 2 for PXPipe Model Registry refactoring.
Your task is to conduct a detailed read-only code survey of the Dashboard UI and Proxy Integration in PXPipe (`C:\Projects\pxpipe`).

Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md` first.

Your specific scope:
1. Examine `src/dashboard/fragments.ts`, dashboard routes, HTML rendering, CSS styles, and model toggle logic.
2. Identify how model families and individual models are currently rendered, filtered, or toggled in the dashboard.
3. Detail how context length badges (e.g. `1M`, `2M`, `262K`, `128K`) and per-model toggle chips should be added to `src/dashboard/fragments.ts` per R3.
4. Survey the proxy service setup (`TraderBotPxpipeProxy` running on port 47821), checking how config changes take effect or how service reloads work.

Working directory: `C:\Projects\pxpipe\.agents\explorer_survey_2`
Write your findings and evidence chain to `C:\Projects\pxpipe\.agents\explorer_survey_2\handoff.md` and maintain `progress.md` heartbeat. When done, notify parent via send_message.
