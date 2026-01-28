#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI AfterTool Hook
 *
 * Called after tool execution (write_file, replace, edit_file).
 * Equivalent to Claude Code's PostToolUse hook.
 * Runs validation (lint, typecheck) on modified files.
 */

const { geminiAdapter } = require('../../adapters/gemini');

// Lazy-load validation module to avoid circular dependencies
let runValidation;
try {
  runValidation = require('../../core/validation').runValidation;
} catch (err) {
  // Module not available - provide no-op fallback
  runValidation = () => ({ skipped: true, message: 'Validation module not available' });
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
    const filePath = toolInput.path || toolInput.file_path;

    // Skip validation for non-edit operations
    if (toolName !== 'Edit' && toolName !== 'Write') {
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    // Skip validation for non-code files
    if (filePath && !filePath.match(/\.(js|jsx|ts|tsx|mjs|cjs)$/i)) {
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    // Run validation
    const coreResult = runValidation({
      filePath,
      toolName,
      toolResponse: parsedInput.toolResponse
    });

    // Transform to Gemini CLI format
    const output = geminiAdapter.transformResult('AfterTool', coreResult);

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
