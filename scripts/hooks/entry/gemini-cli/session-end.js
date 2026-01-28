#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI SessionEnd Hook
 *
 * Called when a Gemini CLI session ends.
 * Auto-logs to request-log.md and warns about uncommitted work.
 */

const { execSync } = require('child_process');
const { geminiAdapter } = require('../../adapters/gemini');

// Import from parent scripts directory
let getConfig, PATHS;
try {
  const flowUtils = require('../../../flow-utils');
  getConfig = flowUtils.getConfig;
  PATHS = flowUtils.PATHS;
} catch (err) {
  // Fallback
  getConfig = () => ({});
  PATHS = { root: process.cwd() };
}

/**
 * Get uncommitted file count
 */
function getUncommittedCount() {
  try {
    const output = execSync('git status --porcelain', {
      cwd: PATHS.root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(line => line.trim()).length;
  } catch (err) {
    return 0;
  }
}

/**
 * Check if auto-logging is enabled
 */
function isAutoLoggingEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.autoLogging?.enabled !== false;
}

// Maximum stdin size to prevent DoS (100KB should be enough)
const MAX_STDIN_SIZE = 100 * 1024;

async function main() {
  try {
    // Read input from stdin with size limit
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) {
        inputData += chunk.slice(0, MAX_STDIN_SIZE - (totalSize - chunk.length));
        break;
      }
      inputData += chunk;
    }

    // Handle empty input gracefully
    if (!inputData || inputData.trim().length === 0) {
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    // Parse JSON safely
    let input;
    try {
      input = JSON.parse(inputData);
    } catch (err) {
      // Invalid JSON - allow through (graceful degradation)
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    const parsedInput = geminiAdapter.parseInput(input);

    const result = {
      logged: false,
      warning: null
    };

    // Check for uncommitted work
    const uncommitted = getUncommittedCount();
    if (uncommitted > 0) {
      result.warning = `${uncommitted} uncommitted file${uncommitted !== 1 ? 's' : ''}. Consider committing before ending session.`;
    }

    // Auto-logging would go here but requires more session context
    if (isAutoLoggingEnabled()) {
      result.logged = false;
    }

    // Transform to Gemini CLI format
    const output = geminiAdapter.transformResult('SessionEnd', result);

    // Output JSON (must be only output to stdout)
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - allow session to end
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    console.log(JSON.stringify({ continue: true, decision: 'allow' }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
