import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  isAnthropicCredential,
  isChatGptSessionToken,
  isXaiCredential,
  jwtIssuerHost,
} from '../src/core/credential-shape.js';

function fakeJwt(payload: unknown): string {
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

describe('credential-shape', () => {
  it('bearerToken extracts the token and rejects other schemes', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc  ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('Bearer')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });

  it('isAnthropicCredential covers API keys and Claude OAuth tokens alike', () => {
    expect(isAnthropicCredential('Bearer sk-ant-api03-x')).toBe(true);
    expect(isAnthropicCredential('Bearer sk-ant-oat01-x')).toBe(true);
    expect(isAnthropicCredential('Bearer sk-proj-x')).toBe(false); // sk-ant- is NOT a substring match of sk-
    expect(isAnthropicCredential('Bearer xai-x')).toBe(false);
  });

  it('jwtIssuerHost returns the exact lowercase host and fails closed on anything malformed', () => {
    expect(jwtIssuerHost(fakeJwt({ iss: 'https://auth.openai.com' }))).toBe('auth.openai.com');
    expect(jwtIssuerHost(fakeJwt({ iss: 'https://AUTH.X.AI/' }))).toBe('auth.x.ai');
    expect(jwtIssuerHost(fakeJwt({ iss: 'https://evilx.ai' }))).toBe('evilx.ai'); // exact, not substring
    expect(jwtIssuerHost(fakeJwt({ sub: 'no-iss' }))).toBeUndefined();
    expect(jwtIssuerHost(fakeJwt({ iss: 42 }))).toBeUndefined();
    expect(jwtIssuerHost(fakeJwt({ iss: 'not a url' }))).toBeUndefined();
    expect(jwtIssuerHost('eyJ.not-base64!!.sig')).toBeUndefined();
    expect(jwtIssuerHost('two.parts')).toBeUndefined();
    expect(jwtIssuerHost('sk-proj-plain-key')).toBeUndefined();
  });

  it('isChatGptSessionToken accepts only auth.openai.com-issued JWTs', () => {
    expect(isChatGptSessionToken(`Bearer ${fakeJwt({ iss: 'https://auth.openai.com' })}`)).toBe(true);
    expect(isChatGptSessionToken(`Bearer ${fakeJwt({ iss: 'https://auth.x.ai' })}`)).toBe(false);
    expect(isChatGptSessionToken(`Bearer ${fakeJwt({ iss: 'https://auth.openai.com.evil.example' })}`)).toBe(false);
    expect(isChatGptSessionToken('Bearer sk-proj-x')).toBe(false);
    expect(isChatGptSessionToken(undefined)).toBe(false);
  });

  it('isXaiCredential accepts xai- console keys and auth.x.ai JWTs, nothing else', () => {
    expect(isXaiCredential('Bearer xai-console-key')).toBe(true);
    expect(isXaiCredential(`Bearer ${fakeJwt({ iss: 'https://auth.x.ai' })}`)).toBe(true);
    expect(isXaiCredential(`Bearer ${fakeJwt({ iss: 'https://auth.openai.com' })}`)).toBe(false);
    expect(isXaiCredential(`Bearer ${fakeJwt({ iss: 'https://evilx.ai' })}`)).toBe(false);
    expect(isXaiCredential(`Bearer ${fakeJwt({ iss: 'https://notauth.x.ai' })}`)).toBe(false);
    expect(isXaiCredential('Bearer sk-proj-x')).toBe(false);
    expect(isXaiCredential('Bearer sk-ant-x')).toBe(false);
  });
});
