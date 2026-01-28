#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI BeforeTool Hook
 *
 * Called before tool execution (write_file, replace, edit_file).
 * Equivalent to Claude Code's PreToolUse hook.
 * Enforces task gating, scope validation, and component reuse checking.
 */

const path = require('path');
const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { geminiAdapter } = require('../../adapters/gemini');

// Lazy-load strict adherence to avoid circular deps and startup cost
let _strictAdherence = null;
function getStrictAdherence() {
  if (!_strictAdherence) {
    try {
      _strictAdherence = require('../../../flow-strict-adherence');
    } catch (err) {
      // Module not available - strict adherence disabled
      _strictAdherence = { isEnabled: () => false, validateCommand: () => ({ valid: true }) };
    }
  }
  return _strictAdherence;
}

// Maximum stdin size to prevent DoS (100KB should be enough)
const MAX_STDIN_SIZE = 100 * 1024;

/**
 * Map Gemini CLI tool names to Claude Code equivalents
 */
function normalizeToolName(toolName) {
  const toolMap = {
    'write_file': 'Write',
    'edit_file': 'Edit',
    'replace': 'Edit',
    'shell_execute': 'Bash',
    'read_file': 'Read'
  };
  return toolMap[toolName] || toolName;
}

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

    // Normalize tool name from Gemini format to internal format
    const toolName = normalizeToolName(parsedInput.toolName);
    const toolInput = parsedInput.toolInput || {};

    // Extract file path from Gemini CLI tool input
    // Gemini uses 'path' or 'file_path' depending on the tool
    const filePath = toolInput.path || toolInput.file_path;

    let coreResult = { allowed: true, blocked: false };

    // Task + scope gating check (for Edit and Write)
    if (toolName === 'Edit' || toolName === 'Write') {
      coreResult = checkScopeGate({
        filePath,
        operation: toolName.toLowerCase()
      });

      // If blocked by task or scope gating, return early
      if (coreResult.blocked) {
        const output = geminiAdapter.transformResult('BeforeTool', coreResult);
        console.log(JSON.stringify(output));
        process.exit(0);
        return;
      }
    }

    // Strict adherence check (for Bash commands)
    if (toolName === 'Bash') {
      const command = toolInput.command;
      if (command) {
        const strictAdherence = getStrictAdherence();
        if (strictAdherence.isEnabled()) {
          const cmdResult = strictAdherence.validateCommand(command);
          if (cmdResult.blocked) {
            coreResult = {
              allowed: false,
              blocked: true,
              reason: `Strict adherence: ${cmdResult.reason}`,
              message: cmdResult.autoCorrect
                ? `BLOCKED: ${cmdResult.reason}\n\nAuto-correcting to: ${cmdResult.autoCorrect}`
                : `BLOCKED: ${cmdResult.reason}\n\n${cmdResult.suggestion || 'Please use the correct pattern.'}`
            };
            const output = geminiAdapter.transformResult('BeforeTool', coreResult);
            console.log(JSON.stringify(output));
            process.exit(0);
            return;
          }
        }
      }
    }

    // Component reuse check (for Write only)
    if (toolName === 'Write' && filePath) {
      const componentResult = checkComponentReuse({
        filePath,
        content: toolInput.content
      });

      // Merge results - component check can add warning or block
      if (componentResult.blocked || componentResult.warning) {
        coreResult = {
          ...coreResult,
          ...componentResult,
          allowed: !componentResult.blocked,
          blocked: componentResult.blocked
        };
      }

      // Strict adherence: File naming check (for Write)
      if (!coreResult.blocked) {
        const strictAdherence = getStrictAdherence();
        if (strictAdherence.isEnabled()) {
          const isComponent = /\/(components?|ui)\//i.test(filePath) && /\.(tsx|jsx)$/i.test(filePath);
          const isApi = /\/(api|routes)\//i.test(filePath);
          const fileType = isComponent ? 'component' : isApi ? 'api' : 'generic';

          const fileName = path.basename(filePath);
          const fileResult = strictAdherence.validateFileName(fileName, fileType);
          if (fileResult.blocked) {
            coreResult = {
              allowed: false,
              blocked: true,
              reason: `Strict adherence: ${fileResult.reason}`,
              message: `BLOCKED: ${fileResult.reason}\n\n${fileResult.suggestion || 'Please use the correct naming convention.'}`
            };
          }
        }
      }
    }

    // Transform to Gemini CLI format
    const output = geminiAdapter.transformResult('BeforeTool', coreResult);

    // Output JSON (must be only output to stdout)
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - allow operation to continue
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
