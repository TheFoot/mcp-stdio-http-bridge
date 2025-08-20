#!/usr/bin/env node
/**
 * @module mcp-stdio-http-bridge/cli
 * @description Command-line interface for MCP bridge
 */

import { program } from 'commander';
import { MCPBridge } from './index.js';
import { createLogger } from './logger.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

/**
 * Main CLI function
 */
const main = async () => {
  program
    .name('mcp-bridge')
    .description(packageJson.description)
    .version(packageJson.version)
    .option('-u, --url <url>', 'MCP server URL', process.env.MCP_HTTP_URL)
    .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '30000')
    .option(
      '-l, --log-level <level>',
      'Log level (trace/debug/info/warn/error/fatal)',
      process.env.LOG_LEVEL || 'info',
    )
    .option('--no-health-check', 'Skip health check on startup')
    .parse();

  const options = program.opts();

  // Create logger for CLI
  const logger = createLogger({ level: options.logLevel });

  const bridge = new MCPBridge({
    url: options.url,
    timeout: parseInt(options.timeout, 10),
    logLevel: options.logLevel,
    logger,
  });

  // Setup event handlers
  bridge.on('start', () => {
    logger.debug('Bridge started event received');
  });

  bridge.on('error', (error) => {
    logger.error(error, 'Bridge error event');
  });

  bridge.on('session', (sessionId) => {
    logger.info({ sessionId }, 'Session established');
  });

  // Handle shutdown signals
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutdown signal received');
    bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Check health unless disabled
    if (options.healthCheck !== false) {
      await bridge.checkHealth();
    }

    // Start the bridge
    await bridge.start();
  } catch (error) {
    logger.fatal(error, 'Failed to start bridge');
    process.exit(1);
  }
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const logger = createLogger();
    logger.fatal(error, 'Unhandled error');
    process.exit(1);
  });
}

export default main;
