#!/usr/bin/env node

/**
 * Wogi Flow - OpenCode tool.execute.after Hook Entry Point
 *
 * Called after tool execution (file edits).
 * Runs validation (lint, typecheck) and reports results.
 */

const { runValidation } = require('../../core/validation');
const { WRITE_TOOLS } = require('../../core/constants');
const { opencodeAdapter } = require('../../adapters/opencode');

/**
 * Handle tool.execute.after event
 * @param {Object} ctx - OpenCode plugin context
 * @returns {Object} Plugin result with validation results
 */
async function handleToolAfter(ctx) {
  try {
    const input = ctx || {};
    const parsedInput = opencodeAdapter.parseInput(input);

    const toolName = parsedInput.toolName;
    const toolInput = parsedInput.toolInput || {};
    const toolResponse = parsedInput.toolResponse;

    // Only validate file write operations
    if (!WRITE_TOOLS.includes(toolName)) {
      return {};
    }

    const filePath = toolInput.path || toolInput.file_path;
    if (!filePath) {
      return {};
    }

    // Skip validation if tool failed
    if (toolResponse?.error) {
      return {};
    }

    // Run validation with timeout to prevent hanging
    const VALIDATION_TIMEOUT = 30000; // 30 seconds
    const validationPromise = runValidation({ filePath });
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ skipped: true, reason: 'timeout' }), VALIDATION_TIMEOUT)
    );

    const coreResult = await Promise.race([validationPromise, timeoutPromise]);

    // Transform to OpenCode format
    return opencodeAdapter.transformResult('tool.execute.after', coreResult);
  } catch (err) {
    // Non-blocking error - log but don't fail
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    return {};
  }
}

// Export for plugin use
module.exports = handleToolAfter;

// CLI interface if run directly (for testing)
if (require.main === module) {
  const runTest = async () => {
    const result = await handleToolAfter({
      toolName: 'Write',
      toolInput: { file_path: '/test/file.js' },
      toolResponse: { success: true }
    });
    console.log(JSON.stringify(result, null, 2));
  };
  runTest();
}
