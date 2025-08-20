/**
 * @module mcp-stdio-http-bridge
 * @description Bridge between stdio-based MCP clients and HTTP-based MCP servers
 */

import readline from 'readline';
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';

/**
 * MCP Bridge class for converting between stdio and HTTP transports
 * @class MCPBridge
 * @extends EventEmitter
 */
export class MCPBridge extends EventEmitter {
  /**
   * Create a new MCP Bridge instance
   * @param {Object} options - Bridge configuration options
   * @param {string} [options.url='http://localhost:3200/mcp'] - MCP server URL
   * @param {number} [options.timeout=30000] - Request timeout in milliseconds
   * @param {string} [options.logLevel] - Log level (trace/debug/info/warn/error/fatal)
   * @param {Function} [options.fetch=globalThis.fetch] - Fetch implementation (for testing)
   * @param {Object} [options.logger] - Custom logger instance
   */
  constructor(options = {}) {
    super();
    this.url = options.url || process.env.MCP_HTTP_URL || 'http://localhost:3200/mcp';
    this.timeout = options.timeout || 30000;
    this.sessionId = null;
    this.running = false;
    this.fetch = options.fetch || globalThis.fetch;
    this.rl = null;

    // Setup logger
    this.logger =
      options.logger ||
      createLogger({
        level: options.logLevel || process.env.LOG_LEVEL,
      });
  }

  /**
   * Start the bridge
   * @param {Object} [options] - Start options
   * @param {ReadableStream} [options.input=process.stdin] - Input stream
   * @param {WritableStream} [options.output=process.stdout] - Output stream
   * @returns {Promise<void>}
   */
  async start(options = {}) {
    const input = options.input || process.stdin;
    const output = options.output || process.stdout;

    if (this.running) {
      const error = new Error('Bridge is already running');
      this.logger.error(error, 'Failed to start bridge');
      throw error;
    }

    this.running = true;
    this.logger.info({ url: this.url }, 'Starting MCP bridge');

    // Check server health
    await this.checkHealth();

    // Setup readline interface
    this.rl = readline.createInterface({
      input,
      output,
      terminal: false,
    });

    // Process input lines
    this.rl.on('line', async (line) => {
      if (line.trim()) {
        try {
          await this.processMessage(line.trim(), output);
        } catch (error) {
          this.logger.error(error, 'Error processing message');
          this.emit('error', error);
        }
      }
    });

    // Handle close
    this.rl.on('close', () => {
      this.stop();
    });

    this.logger.info('MCP bridge started successfully');
    this.emit('start');
  }

  /**
   * Stop the bridge
   */
  stop() {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping MCP bridge');
    this.running = false;

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.emit('stop');
  }

  /**
   * Check if the HTTP server is healthy
   * @returns {Promise<boolean>}
   * @throws {Error} If server is not reachable
   */
  async checkHealth() {
    const healthUrl = this.url.replace('/mcp', '/health');
    this.logger.debug({ healthUrl }, 'Checking server health');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await this.fetch(healthUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      this.logger.debug('Server health check passed');
      return true;
    } catch (error) {
      this.logger.error(error, 'Health check failed');
      const message = `MCP server not reachable at ${this.url}: ${error.message}`;
      throw new Error(message);
    }
  }

  /**
   * Process a JSON-RPC message
   * @param {string} message - JSON-RPC message string
   * @param {WritableStream} output - Output stream
   * @returns {Promise<void>}
   */
  async processMessage(message, output) {
    let parsed;
    let requestId;

    try {
      parsed = JSON.parse(message);
      requestId = parsed.id;
      this.logger.debug({ method: parsed.method, id: requestId }, 'Processing message');
    } catch (error) {
      this.logger.error({ message, error }, 'Failed to parse JSON-RPC message');
      const errorResponse = this._createErrorResponse(-32700, 'Parse error', null);
      output.write(JSON.stringify(errorResponse) + '\n');
      return;
    }

    try {
      const response = await this.forwardToHTTP(parsed);
      output.write(JSON.stringify(response) + '\n');
      this.logger.trace({ method: parsed.method, id: requestId }, 'Message processed successfully');
    } catch (error) {
      this.logger.error(error, 'Failed to forward message to HTTP server');
      const errorResponse = this._createErrorResponse(
        -32603,
        `Bridge error: ${error.message}`,
        requestId,
      );
      output.write(JSON.stringify(errorResponse) + '\n');
    }
  }

  /**
   * Forward a message to the HTTP server
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Response from server
   */
  async forwardToHTTP(message) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };

      // Add session ID if available
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
      }

      this.logger.trace({ url: this.url, headers, body: message }, 'Sending HTTP request');

      const response = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Capture session ID from response
      const newSessionId = response.headers.get('Mcp-Session-Id');
      if (newSessionId && newSessionId !== this.sessionId) {
        this.sessionId = newSessionId;
        this.logger.info({ sessionId: this.sessionId }, 'Session ID captured');
        this.emit('session', this.sessionId);
      }

      // Handle different response types
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        return await this._handleStreamingResponse(response);
      } else {
        const jsonResponse = await response.json();
        this.logger.trace({ response: jsonResponse }, 'Received JSON response');
        return jsonResponse;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error({ timeout: this.timeout }, 'Request timeout');
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle SSE streaming response
   * @private
   * @param {Response} response - Fetch response
   * @returns {Promise<Object>} Parsed response
   */
  async _handleStreamingResponse(response) {
    this.logger.debug('Handling streaming response');
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data) {
          try {
            const parsed = JSON.parse(data);
            this.logger.trace({ data: parsed }, 'Parsed SSE data');
            return parsed;
          } catch (error) {
            this.logger.warn({ data, error }, 'Failed to parse SSE data');
          }
        }
      }
    }

    const error = new Error('No valid data in streaming response');
    this.logger.error(error, 'Streaming response parsing failed');
    throw error;
  }

  /**
   * Create a JSON-RPC error response
   * @private
   * @param {number} code - Error code
   * @param {string} message - Error message
   * @param {any} id - Request ID
   * @returns {Object} Error response
   */
  _createErrorResponse(code, message, id) {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
      },
      id: id || null,
    };
  }
}

export default MCPBridge;
