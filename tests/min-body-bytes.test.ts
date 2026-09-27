import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveMinBodyBytes,
  applyConfigFileDefaults,
  parseCli,
  createNodeApp,
  DEFAULT_MIN_BODY_BYTES,
} from '../src/node.js';
import { createProxy, type ProxyConfig, type ProxyEvent } from '../src/core/proxy.js';

describe('min_body_bytes configuration and enforcement', () => {
  let originalEnvMinBody: string | undefined;
  let originalEnvModels: string | undefined;
  let tempDir: string | undefined;

  beforeAll(() => {
    originalEnvMinBody = process.env.PXPIPE_MIN_BODY_BYTES;
    originalEnvModels = process.env.PXPIPE_MODELS;
    process.env.PXPIPE_MODELS = 'claude-fable-5';
  });

  afterAll(() => {
    if (originalEnvMinBody === undefined) delete process.env.PXPIPE_MIN_BODY_BYTES;
    else process.env.PXPIPE_MIN_BODY_BYTES = originalEnvMinBody;

    if (originalEnvModels === undefined) delete process.env.PXPIPE_MODELS;
    else process.env.PXPIPE_MODELS = originalEnvModels;
  });

  afterEach(() => {
    if (originalEnvMinBody === undefined) delete process.env.PXPIPE_MIN_BODY_BYTES;
    else process.env.PXPIPE_MIN_BODY_BYTES = originalEnvMinBody;

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe('resolveMinBodyBytes precedence and resolution', () => {
    it('respects numeric options.config.min_body_bytes over environment and defaults', () => {
      process.env.PXPIPE_MIN_BODY_BYTES = '80000';
      const resolved = resolveMinBodyBytes({
        config: { min_body_bytes: 150_000 },
      });
      expect(resolved).toBe(150_000);
    });

    it('parses string options.config.min_body_bytes correctly', () => {
      delete process.env.PXPIPE_MIN_BODY_BYTES;
      const resolved = resolveMinBodyBytes({
        config: { min_body_bytes: '75000' },
      });
      expect(resolved).toBe(75_000);
    });

    it('respects direct options.minBodyBytes when config object does not specify it', () => {
      delete process.env.PXPIPE_MIN_BODY_BYTES;
      const resolved = resolveMinBodyBytes({
        minBodyBytes: 90_000,
      });
      expect(resolved).toBe(90_000);
    });

    it('falls back to PXPIPE_MIN_BODY_BYTES env var when options omitted', () => {
      process.env.PXPIPE_MIN_BODY_BYTES = '64000';
      const resolved = resolveMinBodyBytes({});
      expect(resolved).toBe(64_000);
    });

    it('falls back to default floor when neither options nor environment are provided', () => {
      delete process.env.PXPIPE_MIN_BODY_BYTES;
      const resolved = resolveMinBodyBytes({});
      expect(resolved).toBe(DEFAULT_MIN_BODY_BYTES);
    });
  });

  describe('applyConfigFileDefaults with min_body_bytes', () => {
    it('loads min_body_bytes from config file into process.env when not set', () => {
      delete process.env.PXPIPE_MIN_BODY_BYTES;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-cfg-test-'));
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({ min_body_bytes: 45_000 }));

      const cfg = applyConfigFileDefaults(configFile);
      expect(cfg).toBeDefined();
      expect(cfg?.min_body_bytes).toBe(45_000);
      expect(process.env.PXPIPE_MIN_BODY_BYTES).toBe('45000');
    });

    it('does not overwrite existing environment variable from config file', () => {
      process.env.PXPIPE_MIN_BODY_BYTES = '99000';
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-cfg-test-'));
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({ min_body_bytes: 30_000 }));

      const cfg = applyConfigFileDefaults(configFile);
      expect(cfg?.min_body_bytes).toBe(30_000);
      expect(process.env.PXPIPE_MIN_BODY_BYTES).toBe('99000');
    });
  });

  describe('parseCli configuration mapping', () => {
    it('populates minBodyBytes in RuntimeConfig from options.config', () => {
      const runtimeCfg = parseCli([], {
        config: { min_body_bytes: 125_000 },
      });
      expect(runtimeCfg.minBodyBytes).toBe(125_000);
    });
  });

  describe('request handler min_body_bytes enforcement', () => {
    let originalFetch: typeof globalThis.fetch;
    let forwardCalls: Array<{ url: string; body: string }> = [];

    beforeAll(() => {
      originalFetch = globalThis.fetch;
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      forwardCalls = [];
    });

    function setupMockUpstream() {
      forwardCalls = [];
      globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(String(input), init);
        if (new URL(req.url).pathname.endsWith('/count_tokens')) {
          return new Response(JSON.stringify({ input_tokens: 100 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        const bodyText = await req.text();
        forwardCalls.push({ url: req.url, body: bodyText });
        return new Response(
          JSON.stringify({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            model: 'claude-fable-5',
            content: [{ type: 'text', text: 'ack' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 1 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }) as typeof globalThis.fetch;
    }

    it('passes request through uncompressed when payload is below min_body_bytes threshold', async () => {
      setupMockUpstream();
      let capturedEvent: ProxyEvent | undefined;

      const proxy = createProxy({
        minBodyBytes: 100_000,
        onRequest: (e) => {
          capturedEvent = e;
        },
      });

      // Payload is around 2,000 bytes (< 100,000)
      const smallPayload = {
        model: 'claude-fable-5',
        max_tokens: 100,
        system: [{ type: 'text', text: 'You are a test assistant. '.repeat(50) }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const res = await proxy(
        new Request('http://127.0.0.1:47821/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(smallPayload),
        }),
      );
      await res.text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(res.status).toBe(200);
      expect(forwardCalls.length).toBe(1);
      // Inbound body is passed through unmodified without image blocks
      const forwardedJson = JSON.parse(forwardCalls[0]!.body);
      expect(forwardedJson.messages[0].content).toBe('Hello');
      expect(capturedEvent?.info?.compressed).toBe(false);
    });

    it('evaluates and executes compression when payload meets min_body_bytes threshold', async () => {
      setupMockUpstream();
      let capturedEvent: ProxyEvent | undefined;

      const proxy = createProxy({
        minBodyBytes: 10_000,
        onRequest: (e) => {
          capturedEvent = e;
        },
      });

      // Payload is > 10,000 bytes with compressible static slab
      const largeSlab = 'Comprehensive documentation section header. '.repeat(400);
      const largePayload = {
        model: 'claude-fable-5',
        max_tokens: 100,
        system: [{ type: 'text', text: largeSlab }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const res = await proxy(
        new Request('http://127.0.0.1:47821/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(largePayload),
        }),
      );
      await res.text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(res.status).toBe(200);
      expect(forwardCalls.length).toBe(1);
      expect(capturedEvent).toBeDefined();
      expect(capturedEvent?.info?.compressed).toBe(true);
      expect(capturedEvent?.info?.imageCount).toBeGreaterThan(0);
    });

    it('end-to-end createNodeApp binds min_body_bytes from config options into request pipeline', async () => {
      setupMockUpstream();
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-node-app-test-'));
      const eventsFile = path.join(tempDir, 'events.jsonl');

      const app = await createNodeApp({
        config: { min_body_bytes: 80_000 },
        eventsFile,
      });

      try {
        expect(app.config.minBodyBytes).toBe(80_000);

        // Send a request below the 80,000 threshold (~1,500 bytes)
        const reqPayload = {
          model: 'claude-fable-5',
          max_tokens: 50,
          system: [{ type: 'text', text: 'Short system prompt. '.repeat(20) }],
          messages: [{ role: 'user', content: 'Testing node app handler' }],
        };

        const res = await app.handle(
          new Request('http://127.0.0.1:47821/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': 'test-key',
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(reqPayload),
          }),
        );

        expect(res.status).toBe(200);
        expect(forwardCalls.length).toBe(1);
        const forwarded = JSON.parse(forwardCalls[0]!.body);
        expect(forwarded.messages[0].content).toBe('Testing node app handler');
      } finally {
        await app.close();
      }
    });
  });
});
