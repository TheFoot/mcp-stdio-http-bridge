/**
 * @module test/bridge
 * @description Tests for MCPBridge class
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MCPBridge } from '../src/index.js';
import { Readable, Writable } from 'stream';
import sinon from 'sinon';
import pino from 'pino';

describe('MCPBridge', () => {
  let bridge;
  let fetchStub;
  let testLogger;

  beforeEach(() => {
    fetchStub = sinon.stub();
    // Create a silent logger for tests
    testLogger = pino({ level: 'silent' });
    bridge = new MCPBridge({
      url: 'http://localhost:3000/mcp',
      fetch: fetchStub,
      logger: testLogger,
    });
  });

  afterEach(() => {
    if (bridge.running) {
      bridge.stop();
    }
    sinon.restore();
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      const b = new MCPBridge({ logger: testLogger });
      assert.strictEqual(b.url, 'http://localhost:3200/mcp');
      assert.strictEqual(b.timeout, 30000);
      assert.strictEqual(b.sessionId, null);
    });

    test('should accept custom options', () => {
      const b = new MCPBridge({
        url: 'http://example.com/mcp',
        timeout: 5000,
        logLevel: 'debug',
        logger: testLogger,
      });
      assert.strictEqual(b.url, 'http://example.com/mcp');
      assert.strictEqual(b.timeout, 5000);
    });

    test('should use environment variable for URL', () => {
      process.env.MCP_HTTP_URL = 'http://env.example.com/mcp';
      const b = new MCPBridge({ logger: testLogger });
      assert.strictEqual(b.url, 'http://env.example.com/mcp');
      delete process.env.MCP_HTTP_URL;
    });
  });

  describe('checkHealth', () => {
    test('should succeed when server is healthy', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
      });

      const result = await bridge.checkHealth();
      assert.strictEqual(result, true);
      assert(fetchStub.calledWith('http://localhost:3000/health'));
    });

    test('should throw error when server is not reachable', async () => {
      fetchStub.rejects(new Error('Network error'));

      await assert.rejects(bridge.checkHealth(), /MCP server not reachable.*Network error/);
    });

    test('should throw error when server returns error status', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
      });

      await assert.rejects(bridge.checkHealth(), /Server returned 500/);
    });
  });

  describe('start/stop', () => {
    test('should start and stop the bridge', async () => {
      fetchStub.resolves({ ok: true });

      const input = new Readable({ read() {} });
      const output = new Writable({ write() {} });

      let startEmitted = false;
      bridge.on('start', () => {
        startEmitted = true;
      });

      await bridge.start({ input, output });
      assert.strictEqual(bridge.running, true);
      assert.strictEqual(startEmitted, true);

      let stopEmitted = false;
      bridge.on('stop', () => {
        stopEmitted = true;
      });

      bridge.stop();
      assert.strictEqual(bridge.running, false);
      assert.strictEqual(stopEmitted, true);
    });

    test('should throw error if already running', async () => {
      fetchStub.resolves({ ok: true });

      const input = new Readable({ read() {} });
      const output = new Writable({ write() {} });

      await bridge.start({ input, output });

      await assert.rejects(bridge.start({ input, output }), /Bridge is already running/);
    });
  });

  describe('processMessage', () => {
    test('should process valid JSON-RPC message', async () => {
      const message = JSON.stringify({
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      });

      const response = {
        jsonrpc: '2.0',
        result: 'success',
        id: 1,
      };

      fetchStub.resolves({
        ok: true,
        headers: new Map(),
        json: async () => response,
      });

      let output;
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          output = chunk.toString();
          callback();
        },
      });

      await bridge.processMessage(message, outputStream);

      const parsed = JSON.parse(output.trim());
      assert.deepStrictEqual(parsed, response);
    });

    test('should handle parse errors', async () => {
      const invalidMessage = 'not json';

      let output;
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          output = chunk.toString();
          callback();
        },
      });

      await bridge.processMessage(invalidMessage, outputStream);

      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.error.code, -32700);
      assert.strictEqual(parsed.error.message, 'Parse error');
    });

    test('should handle forwarding errors', async () => {
      const message = JSON.stringify({
        jsonrpc: '2.0',
        method: 'test',
        id: 1,
      });

      fetchStub.rejects(new Error('Network failure'));

      let output;
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          output = chunk.toString();
          callback();
        },
      });

      await bridge.processMessage(message, outputStream);

      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.error.code, -32603);
      assert(parsed.error.message.includes('Network failure'));
    });
  });

  describe('forwardToHTTP', () => {
    test('should forward message with correct headers', async () => {
      const message = { jsonrpc: '2.0', method: 'test', id: 1 };
      const response = { jsonrpc: '2.0', result: 'ok', id: 1 };

      fetchStub.resolves({
        ok: true,
        headers: new Map(),
        json: async () => response,
      });

      const result = await bridge.forwardToHTTP(message);

      assert(fetchStub.calledOnce);
      const [url, options] = fetchStub.firstCall.args;
      assert.strictEqual(url, 'http://localhost:3000/mcp');
      assert.strictEqual(options.method, 'POST');
      assert.strictEqual(options.headers['Content-Type'], 'application/json');
      assert.strictEqual(options.headers['Accept'], 'application/json, text/event-stream');
      assert.deepStrictEqual(JSON.parse(options.body), message);
      assert.deepStrictEqual(result, response);
    });

    test('should capture and use session ID', async () => {
      const headers = new Map([['Mcp-Session-Id', 'session123']]);

      fetchStub.resolves({
        ok: true,
        headers,
        json: async () => ({ result: 'ok' }),
      });

      let sessionEmitted = null;
      bridge.on('session', (id) => {
        sessionEmitted = id;
      });

      await bridge.forwardToHTTP({ method: 'test' });

      assert.strictEqual(bridge.sessionId, 'session123');
      assert.strictEqual(sessionEmitted, 'session123');

      // Second request should include session ID
      await bridge.forwardToHTTP({ method: 'test2' });
      const secondCall = fetchStub.secondCall.args[1];
      assert.strictEqual(secondCall.headers['Mcp-Session-Id'], 'session123');
    });

    test('should handle streaming response', async () => {
      const sseData = 'data: {"result":"streaming"}\n\n';

      fetchStub.resolves({
        ok: true,
        headers: new Map([['content-type', 'text/event-stream']]),
        text: async () => sseData,
      });

      const result = await bridge.forwardToHTTP({ method: 'test' });
      assert.deepStrictEqual(result, { result: 'streaming' });
    });

    test('should handle timeout', async () => {
      const b = new MCPBridge({
        url: 'http://localhost:3000/mcp',
        timeout: 100,
        fetch: fetchStub,
        logger: testLogger,
      });

      // Simulate a timeout by returning a promise that gets aborted
      fetchStub.callsFake((url, options) => {
        return new Promise((resolve, reject) => {
          // Listen for the abort signal
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
          // Don't resolve, let the timeout trigger the abort
        });
      });

      await assert.rejects(b.forwardToHTTP({ method: 'test' }), /Request timeout after 100ms/);
    });
  });

  describe('streaming response handling', () => {
    test('should parse SSE data correctly', async () => {
      const sseData = 'data: {"test":"value1"}\n\ndata: {"test":"value2"}\n\n';

      fetchStub.resolves({
        ok: true,
        headers: new Map([['content-type', 'text/event-stream']]),
        text: async () => sseData,
      });

      const result = await bridge.forwardToHTTP({ method: 'test' });
      assert.deepStrictEqual(result, { test: 'value1' }); // Returns first valid data
    });

    test('should handle invalid SSE data', async () => {
      const sseData = 'invalid sse format';

      fetchStub.resolves({
        ok: true,
        headers: new Map([['content-type', 'text/event-stream']]),
        text: async () => sseData,
      });

      await assert.rejects(
        bridge.forwardToHTTP({ method: 'test' }),
        /No valid data in streaming response/,
      );
    });
  });
});
