/** Credential SHAPE checks that decide whether a client bearer may be forwarded to a given
 *  upstream. These are shape checks on the exact bytes we would forward, not authentication:
 *  a forged claim mutates the token into junk the upstream rejects, so the worst outcome of a
 *  wrong "yes" is a 401 — never a real credential reaching the wrong provider. Fail closed:
 *  when a check cannot decide, the answer is "do not forward".
 *
 *  Why shape and not prefix alone: SuperGrok OAuth JWTs and ChatGPT/Codex OAuth JWTs both
 *  start with `eyJ`. Measured 2026-09-05 from live tokens on Abyss (claims only):
 *    SuperGrok  `iss = https://auth.x.ai`
 *    ChatGPT    `iss = https://auth.openai.com`
 *  The issuer HOST is compared exactly (`new URL(iss).hostname`), never by substring —
 *  "evilx.ai" contains "x.ai". Runtime-agnostic: no Buffer; `atob` exists in Node >= 16 and
 *  in Workers. */

export const CHATGPT_ISSUER_HOSTS: ReadonlySet<string> = new Set(['auth.openai.com']);
export const XAI_ISSUER_HOSTS: ReadonlySet<string> = new Set(['auth.x.ai']);

/** The token in `Authorization: Bearer <token>`, or undefined for anything else. */
export function bearerToken(authorization: string | null | undefined): string | undefined {
  if (typeof authorization !== 'string') return undefined;
  const match = /^bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match?.[1];
}

/** Anthropic API keys AND Claude Code OAuth access tokens (`sk-ant-oat01-…`) share the
 *  `sk-ant-` prefix, so this covers both without needing the `anthropic-beta` marker. */
export function isAnthropicCredential(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  return token !== undefined && token.startsWith('sk-ant-');
}

/** OpenAI keys share `sk-` with Anthropic keys, so a prefix match alone would leak
 *  an Anthropic credential to OpenAI. Exclude `sk-ant-` explicitly. */
export function isOpenAIApiKey(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  return token !== undefined && token.startsWith('sk-') && !token.startsWith('sk-ant-');
}

/** Exact lowercase hostname of a JWT's `iss` claim. Undefined on ANY failure — not a JWT,
 *  bad base64url, no/invalid `iss`, unparsable URL — so callers fail closed. */
export function jwtIssuerHost(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = parts[1];
    if (!payload) return undefined;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const iss = (JSON.parse(json) as { iss?: unknown }).iss;
    if (typeof iss !== 'string') return undefined;
    return new URL(iss).hostname.toLowerCase();
  } catch (err) {
    void err;
    return undefined;
  }
}

/** A ChatGPT/Codex OAuth session token — the only credential the ChatGPT codex backend
 *  accepts. `sk-…` API keys are NOT this, whatever the client claims to be. */
export function isChatGptSessionToken(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  if (!token) return false;
  const host = jwtIssuerHost(token);
  return host !== undefined && CHATGPT_ISSUER_HOSTS.has(host);
}

/** An xAI console key (`xai-…`) or a SuperGrok OAuth JWT issued by auth.x.ai. Anything else
 *  — notably a ChatGPT JWT or an OpenAI `sk-` key — must never reach api.x.ai. */
export function isXaiCredential(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  if (!token) return false;
  if (token.startsWith('xai-')) return true;
  const host = jwtIssuerHost(token);
  return host !== undefined && XAI_ISSUER_HOSTS.has(host);
}

/** True if this is a SuperGrok / Grok CLI OAuth session JWT issued by auth.x.ai (NOT an xai- console key). */
export function isSuperGrokSessionToken(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  if (!token) return false;
  const host = jwtIssuerHost(token);
  return host !== undefined && XAI_ISSUER_HOSTS.has(host);
}

/** True if this is an xAI console API key (starts with xai-). */
export function isXaiApiKey(authorization: string | null | undefined): boolean {
  const token = bearerToken(authorization);
  return token !== undefined && token.startsWith('xai-');
}

/** Credential headers no built-in provider lane needs, so they are dropped for every
 *  destination except `passthrough`. `api-key` is Azure OpenAI's header and
 *  `x-goog-api-key` is Google's: a client configured for either could send one to this
 *  proxy, and nothing inspected them (Grok 4.6 review, 2026-09-05). Anthropic's own
 *  `x-api-key` is NOT here — it is checked per provider above, because the Anthropic lane
 *  legitimately needs it. */
const ALWAYS_STRIPPED_CREDENTIAL_HEADERS = [
  'cookie',
  'proxy-authorization',
  'api-key',
  'x-goog-api-key',
] as const;

export type UpstreamProvider = 'anthropic' | 'openai' | 'chatgpt' | 'xai' | 'passthrough';

/** Which provider a credential provably belongs to, or `unknown` when its shape identifies
 *  no provider we know. */
export type CredentialOwner = UpstreamProvider | 'unknown';

/** Classify a bearer by shape. `unknown` is a real answer, not a failure: an opaque token we
 *  do not recognise is not evidence of anything. */
export function classifyCredential(authorization: string | null | undefined): CredentialOwner {
  if (isAnthropicCredential(authorization)) return 'anthropic';
  if (isXaiCredential(authorization)) return 'xai';
  if (isChatGptSessionToken(authorization)) return 'chatgpt';
  if (isOpenAIApiKey(authorization)) return 'openai';
  return 'unknown';
}

/** True when this credential provably belongs to a DIFFERENT provider than the destination.
 *  `openai` (an `sk-` API key, for api.openai.com) and `chatgpt` (an OAuth session token, for
 *  the ChatGPT Codex backend) are deliberately DISTINCT despite the shared vendor: neither
 *  endpoint accepts the other's credential, and resolveUpstreams() already throws outright on
 *  `chatGptCodex && config.openAIApiKey`. Treating them as one family would forward a key to
 *  an endpoint the repo refuses to configure. */
function isForeignTo(owner: CredentialOwner, provider: UpstreamProvider): boolean {
  if (owner === 'unknown') return false;
  if (owner === provider) return false;
  // One deliberate asymmetry, grounded in the repo's own rule rather than taste: an
  // `sk-` API key must NOT reach the ChatGPT Codex backend — resolveUpstreams() throws on
  // `chatGptCodex && config.openAIApiKey`, so the pairing is already refused. There is no
  // equivalent refusal the other way, and a ChatGPT session token arriving at
  // api.openai.com is the same vendor and merely useless, so it is not stripped.
  if (owner === 'chatgpt' && provider === 'openai') return false;
  return true;
}

/** Strip every credential header that provably belongs to a provider OTHER than the
 *  destination. Per-lane bearer checks had left Anthropic `x-api-key` values reaching OpenAI
 *  and ignored cookies and proxy credentials entirely.
 *
 *  DENY-KNOWN-FOREIGN, not allow-known-own. The threat is this proxy misrouting the operator's
 *  own credentials between their own providers, and every leak measured on 2026-09-05 involved
 *  a credential whose shape names its owner (an `sk-ant-` key, a SuperGrok JWT, a ChatGPT
 *  JWT) — all still stripped. An allow-list would additionally strip anything it does not
 *  recognise, which silently 401s the operator's primary lane the day a provider changes token
 *  format; that cost is not worth a threat we cannot name. Anthropic `x-api-key` is checked
 *  the same way, since it is the one vendor header a built-in lane legitimately needs. */
export function sanitizeCredentialHeaders(headers: Headers, provider: UpstreamProvider): void {
  // User-configured gateways may need any of these credentials; passthrough deliberately
  // preserves them because the gateway, not a built-in provider policy, owns its auth.
  if (provider === 'passthrough') return;

  if (isForeignTo(classifyCredential(headers.get('authorization')), provider)) {
    headers.delete('authorization');
  }
  // Anthropic's own header. Anywhere else it is someone else's key on the wrong lane.
  const apiKey = headers.get('x-api-key');
  if (apiKey && (provider !== 'anthropic' || !apiKey.startsWith('sk-ant-'))) {
    headers.delete('x-api-key');
  }
  // An account identifier for the ChatGPT backend and nothing else.
  if (provider !== 'chatgpt') headers.delete('chatgpt-account-id');
  for (const name of ALWAYS_STRIPPED_CREDENTIAL_HEADERS) headers.delete(name);
}
