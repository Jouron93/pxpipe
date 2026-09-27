import fs from 'node:fs';
import path from 'node:path';

const fixturesDir = 'C:\\Projects\\pxpipe\\evidence\\fixtures';
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// Fixture 2: Long Monolithic File (~1,500 lines)
{
  const lines = [
    '/**',
    ' * Monolithic Event-Driven Workflow Orchestrator & State Transition Engine',
    ' * File: 02-long-monolith.txt',
    ' * Total Target Lines: ~1,500 lines',
    ' */',
    '',
    "export type WorkflowStatus = 'pending' | 'active' | 'suspended' | 'completed' | 'failed' | 'cancelled';",
    '',
  ];

  for (let i = 1; i <= 125; i++) {
    lines.push(`/** Module Section ${i}: Handler logic, state machine step ${i} */`);
    lines.push(`export interface StepState${i} {`);
    lines.push(`  readonly id: string;`);
    lines.push(`  readonly iteration: number;`);
    lines.push(`  readonly payload: Record<string, unknown>;`);
    lines.push(`  readonly status: WorkflowStatus;`);
    lines.push(`  readonly timestamp: number;`);
    lines.push(`}`);
    lines.push('');
    lines.push(`export class StepHandler${i} {`);
    lines.push(`  private state: StepState${i};`);
    lines.push(`  constructor(id: string) {`);
    lines.push(`    this.state = { id, iteration: ${i}, payload: {}, status: 'pending', timestamp: Date.now() };`);
    lines.push(`  }`);
    lines.push(`  public execute(input: Record<string, unknown>): StepState${i} {`);
    lines.push(`    const nextIteration = this.state.iteration + 1;`);
    lines.push(`    const status: WorkflowStatus = nextIteration % 10 === 0 ? 'suspended' : 'active';`);
    lines.push(`    this.state = { ...this.state, iteration: nextIteration, payload: { ...this.state.payload, ...input }, status };`);
    lines.push(`    return this.state;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
  }

  const content = lines.join('\n');
  fs.writeFileSync(path.join(fixturesDir, '02-long-monolith.txt'), content, 'utf8');
}

// Fixture 3: Structured JSON / Config
{
  const config = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'FrontierContextProxyConfiguration',
    version: '2.5.0-production',
    metadata: {
      generatedAt: '2026-09-24T10:00:00.000Z',
      environment: 'production',
      cluster: 'us-east-metal-01',
      datacenterId: 42,
      activeNodes: ['node-01.traderbot.local', 'node-02.traderbot.local', 'node-03.traderbot.local'],
      tags: ['inference', 'context-compression', 'token-saver', 'caching-v2'],
    },
    routing: {
      defaultProvider: 'anthropic',
      fallbackProvider: 'openai',
      timeoutMs: 30000,
      retryPolicy: {
        maxRetries: 3,
        backoffMultiplier: 1.5,
        initialDelayMs: 250,
        maxDelayMs: 2000,
        retryableStatusCodes: [429, 500, 502, 503, 504],
      },
      rateLimits: {
        globalRequestsPerMinute: 1200,
        globalTokensPerMinute: 40000000,
        perClientConcurrency: 16,
      },
    },
    rendering: {
      defaultFont: 'spleen-5x8',
      fallbackFont: 'jetbrains-mono-14',
      antiAliasing: true,
      gridLines: false,
      maxHeightPx: 728,
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      paperGray: 255,
      contrastThreshold: 0.85,
    },
    modelProfiles: [
      {
        id: 'claude-opus-5-5',
        family: 'anthropic',
        contextWindow: 1048576,
        maxOutputTokens: 16384,
        pricing: { inputPerMtok: 4.0, outputPerMtok: 20.0, cacheReadPerMtok: 0.4, cacheWritePerMtok: 5.0 },
        renderingOverride: { stripCols: 312, maxHeightPx: 728, font: 'spleen-5x8' },
        caching: { type: 'ephemeral', minTokens: 1024, ttlSeconds: 300, maxBreakpoints: 4 },
      },
      {
        id: 'claude-sonnet-5',
        family: 'anthropic',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        pricing: { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
        renderingOverride: { stripCols: 312, maxHeightPx: 728, font: 'spleen-5x8' },
        caching: { type: 'ephemeral', minTokens: 1024, ttlSeconds: 300, maxBreakpoints: 4 },
      },
      {
        id: 'gpt-6-astra',
        family: 'openai',
        contextWindow: 1048576,
        maxOutputTokens: 16384,
        pricing: { inputPerMtok: 10.0, outputPerMtok: 50.0, cacheReadPerMtok: 5.0, cacheWritePerMtok: 10.0 },
        renderingOverride: { stripCols: 84, maxHeightPx: 1954, font: 'jetbrains-mono-14' },
        caching: { type: 'prefix', minTokens: 1024, autoEvict: true },
      },
      {
        id: 'gpt-6-sol',
        family: 'openai',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        pricing: { inputPerMtok: 2.0, outputPerMtok: 10.0, cacheReadPerMtok: 1.0, cacheWritePerMtok: 2.0 },
        renderingOverride: { stripCols: 84, maxHeightPx: 1954, font: 'jetbrains-mono-14' },
        caching: { type: 'prefix', minTokens: 1024, autoEvict: true },
      },
      {
        id: 'gemini-3.8-flash',
        family: 'google',
        contextWindow: 2097152,
        maxOutputTokens: 8192,
        pricing: { inputPerMtok: 0.35, outputPerMtok: 1.4, cacheReadPerMtok: 0.0875, cacheWritePerMtok: 0.35 },
        renderingOverride: { stripCols: 312, maxHeightPx: 728, font: 'spleen-5x8' },
        caching: { type: 'explicit', minTokens: 32768, ttlSeconds: 3600 },
      },
      {
        id: 'grok-4.7',
        family: 'xai',
        contextWindow: 524288,
        maxOutputTokens: 8192,
        pricing: { inputPerMtok: 2.0, outputPerMtok: 6.0, cacheReadPerMtok: 1.0, cacheWritePerMtok: 2.0 },
        renderingOverride: { stripCols: 152, maxHeightPx: 512, font: 'spleen-5x8' },
        caching: { type: 'prefix', minTokens: 1024 },
      },
    ],
    features: {
      enableFactsheetExtraction: true,
      maxFactsheetEntries: 96,
      enableHistoryCollapse: true,
      historyCollapseThresholdTurns: 10,
      enableReflowNewlineMarkers: true,
      strictImageBudgetEnforcement: true,
      maxDecodedImagePayloadMiB: 18,
    },
  };

  fs.writeFileSync(path.join(fixturesDir, '03-structured-json.txt'), JSON.stringify(config, null, 2), 'utf8');
}

// Fixture 4: Unicode & Non-ASCII
{
  const lines = [
    '# ==========================================================================',
    '# Unicode, Multilingual Typography & Terminal Box-Drawing Test Matrix',
    '# Fixture: 04-unicode-box.txt',
    '# ==========================================================================',
    '',
    '## 1. Box Drawing & Form Borders (Single & Double Line)',
    '┌───────────────────────┬───────────────────────┬────────────────────────┐',
    '│ Component Name        │ Operational State     │ Latency (p99.9)        │',
    '├───────────────────────┼───────────────────────┼────────────────────────┤',
    '│ Core Neural Engine    │ RUNNING [ONLINE]      │ 12.45 ms               │',
    '│ Vision Atlas Cache    │ WARM [100% HIT]       │  0.08 ms               │',
    '│ Prompt Serializer     │ IDLE [READY]          │  1.12 ms               │',
    '└───────────────────────┴───────────────────────┴────────────────────────┘',
    '',
    '╔═══════════════════════╦═══════════════════════╦════════════════════════╗',
    '║ Double Frame Header   ║ Cluster Master Alpha  ║ Security Enclave B     ║',
    '╠═══════════════════════╬═══════════════════════╬════════════════════════╣',
    '║ Data Ingestion Pipeline║ ACTIVE: 42,500 msg/s  ║ VERIFIED: TLS 1.3 / OK ║',
    '║ Cryptographic Vault   ║ LOCKED: AES-256-GCM   ║ HARDWARE KEY ENFORCED  ║',
    '╚═══════════════════════╩═══════════════════════╩════════════════════════╝',
    '',
    '## 2. Block Elements & Progress Telemetry',
    'Progress Bar [Full Density]:   ████████████████████████████████ 100% Complete',
    'Progress Bar [Shaded Bands]:   ████████████████░░░░░░░░░░░░░░░░  50% Buffering',
    'Vertical Meter Blocks:          ▂▃▄▅▆▇█ | Level 8 Peak Volume',
    'Horizontal Quadrants:          ▖▗▘▙▚▛▜▝▞▟ | Geometric Glyphs',
    '',
    '## 3. Directional Flow & Mathematical Logic',
    'Flow Transition: Ingest ──► Validate ──► Normalize ──► Render ──► Transmit',
    'Bidirectional:   Client ◄──► Proxy Gate ◄──► Upstream API',
    'Logic Symbols:   ∀x ∈ Context: (x ≠ ∅) ∧ (x ⊆ Payload) ⇒ Decodable(x)',
    'Calculus/Stats:  ∫ f(t) dt = μ ± 3σ | ∑_{i=1}^N w_i · x_i | √λ · e^{-λ}',
    '',
    '## 4. Multilingual Scripts (CJK, Cyrillic, Greek, Accented Latin)',
    '- Chinese (Simplified):  深度学习上下文压缩代理正在运行中，显存占用正常。',
    '- Chinese (Traditional): 跨節點高並發狀態機架構驗證，延遲指標符合預期。',
    '- Japanese (Hiragana/Katakana/Kanji): リアルタイム推論パイプラインの正常稼働を確認しました。',
    '- Korean (Hangul):       초저지연 비전 렌더링 엔진 테스트가 성공적으로 완료되었습니다.',
    '- Greek:                 Η ακρίβεια της οπτικής αναγνώρισης χαρακτήρων είναι εξαιρετική.',
    '- Cyrillic:              Высокопроизводительный прокси-сервер сжатия контекста активен.',
    '- German / French:       Prüfung der Übertragungsqualität: naïve façon d\'être sûr et fidèle.',
    '- Nordic / Spanish:      Blåbærsyltetøy på fjellet; niños pequeños jugando en la plaza española.',
    '',
    '## 5. Currencies, Arrows & Special Punctuation',
    'Currencies:  $100.00 | €85.50 | £72.20 | ¥14,500 | ₩135,000 | ₹8,300 | ₿0.0025 | Ξ0.045',
    'Arrows:      ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ↚ ↛ ↞ ↠ ↢ ↣ ↦ ↩ ↪ ↫ ↬ ↰ ↱ ↲ ↳',
    'Checkmarks:  ✓ Passed  ✗ Failed  ⚠ Warning  ★ Star  ✦ Sparkle  ◆ Diamond',
  ];

  fs.writeFileSync(path.join(fixturesDir, '04-unicode-box.txt'), lines.join('\n'), 'utf8');
}

// Fixture 5: Dense Formatted Table
{
  const lines = [
    '+-------+----------------------+-----------+------------+------------+---------------+---------------+----------------+',
    '| ID    | Model Name           | Family    | Max Ctx    | Max Out    | Input $/M     | Output $/M    | Cache Read $/M |',
    '+-------+----------------------+-----------+------------+------------+---------------+---------------+----------------+',
    '| M-001 | gpt-6-astra          | OpenAI    | 1,048,576  | 16,384     | $     10.0000 | $     50.0000 | $       5.0000 |',
    '| M-002 | gpt-6-sol            | OpenAI    | 1,048,576  |  8,192     | $      2.0000 | $     10.0000 | $       1.0000 |',
    '| M-003 | gpt-6-luna           | OpenAI    | 1,048,576  |  4,096     | $      0.5000 | $      2.0000 | $       0.2500 |',
    '| M-004 | gpt-5.6-sol          | OpenAI    |   200,000  |  8,192     | $      3.0000 | $     15.0000 | $       1.5000 |',
    '| M-005 | gpt-5.6-terra        | OpenAI    |   128,000  |  4,096     | $      1.5000 | $      6.0000 | $       0.7500 |',
    '| M-006 | claude-opus-5-5      | Anthropic | 1,048,576  | 16,384     | $      4.0000 | $     20.0000 | $       0.4000 |',
    '| M-007 | claude-sonnet-5      | Anthropic | 1,048,576  |  8,192     | $      3.0000 | $     15.0000 | $       0.3000 |',
    '| M-008 | claude-fable-5-1     | Anthropic |   500,000  |  8,192     | $      1.5000 | $      7.5000 | $       0.1500 |',
    '| M-009 | claude-haiku-4-5     | Anthropic |   200,000  |  4,096     | $      0.2500 | $      1.2500 | $       0.0250 |',
    '| M-010 | gemini-3.8-flash     | Google    | 2,097,152  |  8,192     | $      0.3500 | $      1.4000 | $       0.0875 |',
    '| M-011 | gemini-3.8-live      | Google    | 1,048,576  |  4,096     | $      0.7000 | $      2.8000 | $       0.1750 |',
    '| M-012 | gemini-omni-1.1      | Google    |   500,000  |  4,096     | $      0.5000 | $      2.0000 | $       0.1250 |',
    '| M-013 | grok-4.7             | xAI       |   524,288  |  8,192     | $      2.0000 | $      6.0000 | $       1.0000 |',
    '| M-014 | grok-4.6             | xAI       |   262,144  |  4,096     | $      3.0000 | $      9.0000 | $       1.5000 |',
    '| M-015 | grok-code-fast-1     | xAI       |   131,072  |  4,096     | $      0.2000 | $      0.8000 | $       0.1000 |',
    '+-------+----------------------+-----------+------------+------------+---------------+---------------+----------------+',
    '| TOTAL | 15 Frontier Profiles | 4 Vendors | 11.5M Sum  | 104k Sum   | Avg: $ 2.0667 | Avg: $ 9.4000 | Avg: $ 1.1275  |',
    '+-------+----------------------+-----------+------------+------------+---------------+---------------+----------------+',
  ];

  // Repeat rows with realistic variation to simulate dense logs/data tables (~150 rows)
  for (let r = 16; r <= 80; r++) {
    const paddedId = String(r).padStart(3, '0');
    const inputPrice = (0.1 + (r * 0.05)).toFixed(4).padStart(11, ' ');
    const outputPrice = (0.5 + (r * 0.25)).toFixed(4).padStart(11, ' ');
    const cachePrice = (0.05 + (r * 0.025)).toFixed(4).padStart(11, ' ');
    lines.push(`| M-${paddedId} | synth-eval-arm-${paddedId}   | EvalGroup |   524,288  |  4,096     | $ ${inputPrice} | $ ${outputPrice} | $ ${cachePrice} |`);
  }
  lines.push('+-------+----------------------+-----------+------------+------------+---------------+---------------+----------------+');

  fs.writeFileSync(path.join(fixturesDir, '05-dense-table.txt'), lines.join('\n'), 'utf8');
}

// Fixture 6: Real-World Agent Tool Output / Git Diff
{
  const lines = [
    'commit 3c5b7297e68fa918bca41392686b2fa9817e002a',
    'Author: Principal Infrastructure Specialist <infra@traderbot.internal>',
    'Date:   Mon Sep 21 14:22:18 2026 -0400',
    '',
    '    fix(transport): resolve Windows root CA trust and eliminate SSE prefill timeout',
    '    ',
    '    - Add undici globalDispatcher on win32 to trust system root certs',
    '    - Immediately flush HTTP response headers upon detecting text/event-stream',
    '    - Unify intercept CA with public CA bundle in src/warp/ca.ts',
    '',
    'diff --git a/src/node.ts b/src/node.ts',
    'index 84a01c3..f902c81 100644',
    '--- a/src/node.ts',
    '+++ b/src/node.ts',
    '@@ -1085,10 +1085,16 @@ export function configureOutboundTransport(): void {',
    '   // Node on Windows does not automatically query the OS crypto trust store',
    '   // for native fetch requests, resulting in UNABLE_TO_VERIFY_LEAF_SIGNATURE.',
    '   if (process.platform === \'win32\') {',
    '+    const { rootCertificates } = require(\'node:tls\');',
    '+    const { Agent, setGlobalDispatcher } = require(\'undici\');',
    '+    setGlobalDispatcher(new Agent({',
    '+      connect: {',
    '+        ca: [...rootCertificates],',
    '+      },',
    '+    }));',
    '   }',
    ' }',
    ' ',
    '@@ -418,7 +424,9 @@ export async function writeWebResponse(res: Response, out: ServerResponse): Pro',
    '   out.writeHead(res.status, Object.fromEntries(res.headers.entries()));',
    '   if (res.headers.get(\'content-type\')?.includes(\'text/event-stream\')) {',
    '-    // Header buffering causes downstream client timeout before first token',
    '+    // Flush response headers immediately to establish SSE heartbeat',
    '+    out.flushHeaders();',
    '   }',
    '   if (!res.body) {',
    '     out.end();',
    'diff --git a/src/warp/ca.ts b/src/warp/ca.ts',
    'index 178cd32..6614bb0 100644',
    '--- a/src/warp/ca.ts',
    '+++ b/src/warp/ca.ts',
    '@@ -102,6 +102,18 @@ export function writeBundle(): void {',
    '   const localCa = fs.readFileSync(LOCAL_CA_PATH, \'utf8\');',
    '   const sysRoots = tls.rootCertificates.join(\'\\n\');',
    '   const combined = `${localCa}\\n# System Root Certificates\\n${sysRoots}`;',
    '+  fs.writeFileSync(BUNDLE_PATH, combined, { encoding: \'utf8\', mode: 0o644 });',
    '+  process.env.SSL_CERT_FILE = BUNDLE_PATH;',
    '+  process.env.CURL_CA_BUNDLE = BUNDLE_PATH;',
    '+  process.env.NODE_EXTRA_CA_CERTS = LOCAL_CA_PATH;',
    ' }',
  ];

  fs.writeFileSync(path.join(fixturesDir, '06-git-diff.txt'), lines.join('\n'), 'utf8');
}

console.log('Successfully generated all 6 benchmark fixtures in evidence/fixtures/');
