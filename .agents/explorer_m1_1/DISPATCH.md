## 2026-07-26T20:45:36Z

<USER_REQUEST>
You are Explorer 1 for Milestone 1: Model Registry Core (`src/core/model-registry.ts`).
Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md` and `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`.

Your task:
Analyze and formulate the exact TypeScript code structure, interfaces, types, constants, catalog array, alias resolver, and dynamic fallback resolver functions needed for `src/core/model-registry.ts`.

Key Requirements to address in your design:
1. `PxpipeModelProfile` interface holding: `canonicalId`, `displayName`, `family` ('claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia'), `status` ('validated' | 'degraded' | 'unvalidated'), `enabledByDefault`, `pricing`, `renderProfile`, `contextWindowTokens`, `maxOutputTokens`, `factsheetEnabled`, `aliases`.
2. Exact context window tokens:
   - Claude: 1,048,576 (1M) for Fable 5, Opus 5, Sonnet 5.
   - OpenAI/Codex: 262,144 (262K) for gpt-5.6-sol (1,050,000 long), 1,050,000 for gpt-5.5.
   - Grok: 524,288 (524K) for grok-4.5.
   - AGY Proxy: 2,097,152 (2M) for agy-gemini-3.6-flash-high, 1M for agy-claude-opus-4.6-thinking, 128,000 for agy-gpt-oss-120b-medium.
   - NVIDIA NIM catalog (102 models):
     * Nemotron 3 Ultra 550B: 1,048,576 (1M)
     * Llama 3.1 Nemotron Ultra 253B: 262,144 (262K)
     * Nemotron 3 Super 120B: 262,144 (262K)
     * Nemotron 4 340B: 1,048,576 (1M)
     * Nemotron Super 49B: 131,072 (128K)
     * DeepSeek V4 Pro: 1,048,576 (1M)
     * DeepSeek V4 Flash: 128,000
     * DeepSeek Coder 6.7B: 128,000
     * Meta Llama 3.3 70B: 131,072 (128K)
     * Mistral Large 2: 128,000
     * Qwen 3.5 397B: 262,144 (262K)
     * GPT-OSS 120B: 128,000
     * StarCoder2 15B: 128,000
3. Alias mapping: `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus` -> `claude-opus-5`.
4. Dynamic fallback resolver function for unknown `nvidia/*`, `deepseek-ai/*`, `mistralai/*`, `meta/*`, `qwen/*`, `bigcode/*`, `openai/*`, `agy/*` strings.
5. Export helper functions: `resolveModelProfile(modelId: string, route?: string): PxpipeModelProfile`, `getAllModelProfiles()`, `applyRuntimeConfigOverrides(config)`.

Working directory: `C:\Projects\pxpipe\.agents\explorer_m1_1`
Write your strategy and exact TypeScript specifications to `C:\Projects\pxpipe\.agents\explorer_m1_1\handoff.md`. Notify parent when done.
</USER_REQUEST>
