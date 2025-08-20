/**
 * @module logger
 * @description Pino logger configuration for MCP Bridge
 */

import pino from 'pino';

/**
 * Create a configured logger instance
 * @param {Object} options - Logger options
 * @param {string} [options.level] - Log level
 * @param {boolean} [options.pretty=true] - Use pretty printing
 * @returns {Object} Pino logger instance
 */
export const createLogger = (options = {}) => {
  const level = options.level || process.env.LOG_LEVEL || 'info';
  const pretty = options.pretty !== false && process.env.NODE_ENV !== 'production';

  const pinoOptions = {
    level,
    base: null, // Don't include pid and hostname
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        errorProps: 'stack,cause',
        messageFormat: '[MCP-Bridge] {msg}',
      },
    };
  }

  return pino(pinoOptions);
};

// Create default logger instance
export const logger = createLogger();

export default logger;
