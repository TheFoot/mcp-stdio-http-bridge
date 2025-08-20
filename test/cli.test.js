/**
 * @module test/cli
 * @description Tests for CLI
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '../src/cli.js');
const packagePath = join(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const expectedVersion = packageJson.version;

describe('CLI', () => {
  test('should display version', async () => {
    const result = await runCLI(['--version']);
    assert(result.stdout.includes(expectedVersion));
    assert.strictEqual(result.code, 0);
  });

  test('should display help', async () => {
    const result = await runCLI(['--help']);
    assert(result.stdout.includes('Usage:'));
    assert(result.stdout.includes('Options:'));
    assert.strictEqual(result.code, 0);
  });

  test('should fail when server is not reachable', async () => {
    const result = await runCLI(['--url', 'http://localhost:99999/mcp', '--timeout', '100']);
    // The error is logged to stdout via structured logging, not stderr
    assert(
      result.stdout.includes('Failed to start bridge') ||
        result.stdout.includes('MCP server not reachable'),
    );
    assert.notStrictEqual(result.code, 0);
  });
});

/**
 * Helper to run CLI and capture output
 * @param {Array} args - CLI arguments
 * @returns {Promise<Object>} Result with stdout, stderr, and exit code
 */
function runCLI(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [cliPath, ...args]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    // Kill after timeout
    setTimeout(() => {
      proc.kill();
    }, 2000);
  });
}
