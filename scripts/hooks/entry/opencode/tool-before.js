#!/usr/bin/env node

/**
 * Wogi Flow - OpenCode tool.execute.before Hook Entry Point
 *
 * Called before tool execution (file edits).
 * Enforces task gating, scope validation, and component reuse checking.
 *
 * THROWS to block operations - OpenCode's enforcement mechanism.
 */

const path = require('path');
const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { WRITE_TOOLS, isBlockingError } = require('../../core/constants');
const { opencodeAdapter } = require('../../adapters/opencode');

// Lazy-load strict adherence to avoid circular deps and startup cost
let _strictAdherence = null;
function getStrictAdherence() {
  if (!_strictAdherence) {
    try {
      _strictAdherence = require('../../../flow-strict-adherence');
    } catch (err) {
      // Log error if it's not just "module not found"
      if (err.code !== 'MODULE_NOT_FOUND' && process.env.DEBUG) {
        console.error(`[tool-before] Failed to load strict adherence: ${err.message}`);
      }
      _strictAdherence = { isEnabled: () => false, validateCommand: () => ({ valid: true }) };
    }
  }
  return _strictAdherence;
}

/**
 * Handle tool.execute.before event
 * @param {Object} ctx - OpenCode plugin context
 * @returns {Object} Plugin result or throws to block
 */
async function handleToolBefore(ctx) {
  try {
    const input = ctx || {};
    const parsedInput = opencodeAdapter.parseInput(input);

    const toolName = parsedInput.toolName;
    const toolInput = parsedInput.toolInput || {};

    // Only gate file write operations
    if (!WRITE_TOOLS.includes(toolName)) {
      return {};
    }

    // SECURITY: Validate filePath is a string with reasonable length
    const filePath = toolInput.path || toolInput.file_path;
    if (!filePath || typeof filePath !== 'string' || filePath.length > 5000) {
      return {};
    }

    let coreResult = { allowed: true, blocked: false };

    // Task + scope gating check
    coreResult = checkScopeGate({
      filePath,
      operation: 'write'
    });

    // Transform result - if blocked, this returns { block: true, error: '...' }
    const result = opencodeAdapter.transformResult('tool.execute.before', coreResult);

    // HARD ENFORCEMENT: throw to block
    if (result.block && result.error) {
      throw new Error(result.error);
    }

    // Component reuse check (for new files/Write)
    if (toolName === 'Write' || toolName === 'file_write') {
      const componentResult = checkComponentReuse({
        filePath,
        content: toolInput.content
      });

      const componentTransformed = opencodeAdapter.transformResult('tool.execute.before', componentResult);

      if (componentTransformed.block && componentTransformed.error) {
        throw new Error(componentTransformed.error);
      }

      // Merge warnings
      if (componentTransformed.systemMessage) {
        result.systemMessage = result.systemMessage
          ? `${result.systemMessage}\n\n${componentTransformed.systemMessage}`
          : componentTransformed.systemMessage;
      }
    }

    // Strict adherence: File naming check
    const strictAdherence = getStrictAdherence();
    if (strictAdherence.isEnabled() && toolName === 'Write') {
      const isComponent = /\/(components?|ui)\//i.test(filePath) && /\.(tsx|jsx)$/i.test(filePath);
      const isApi = /\/(api|routes)\//i.test(filePath);
      const fileType = isComponent ? 'component' : isApi ? 'api' : 'generic';

      const fileName = path.basename(filePath);
      const fileResult = strictAdherence.validateFileName(fileName, fileType);

      if (fileResult.blocked) {
        throw new Error(`Strict adherence: ${fileResult.reason}\n\n${fileResult.suggestion || 'Please use the correct naming convention.'}`);
      }
    }

    return result;
  } catch (err) {
    // Re-throw blocking errors (use typed check with string fallback)
    if (isBlockingError(err)) {
      throw err;
    }

    // Log other errors but allow operation to continue
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    return {};
  }
}

// Export for plugin use
module.exports = handleToolBefore;

// CLI interface if run directly (for testing)
if (require.main === module) {
  const runTest = async () => {
    try {
      const result = await handleToolBefore({
        toolName: 'Write',
        toolInput: { file_path: '/test/file.js', content: 'test' }
      });
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.log('Blocked:', err.message);
    }
  };
  runTest();
}
