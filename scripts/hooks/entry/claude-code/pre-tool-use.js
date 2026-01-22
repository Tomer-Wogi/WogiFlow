#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreToolUse Hook
 *
 * Called before Edit/Write/TodoWrite tool execution.
 * Enforces task gating, scope validation, component reuse checking, and TodoWrite gating.
 *
 * v4.0: Added scope gating to validate edits are within task's declared scope
 */

const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { checkTodoWriteGate } = require('../../core/todowrite-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');

// Maximum stdin size to prevent DoS (100KB should be enough for tool inputs)
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
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
      }));
      process.exit(0);
      return;
    }

    // Parse JSON safely
    let input;
    try {
      input = JSON.parse(inputData);
    } catch (_parseErr) {
      // Invalid JSON - allow through (graceful degradation)
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
      }));
      process.exit(0);
      return;
    }

    const parsedInput = claudeCodeAdapter.parseInput(input);

    const toolName = parsedInput.toolName;
    const toolInput = parsedInput.toolInput || {};
    const filePath = toolInput.file_path;

    let coreResult = { allowed: true, blocked: false };

    // Task + scope gating check (for Edit and Write)
    // v4.0: checkScopeGate wraps checkTaskGate and adds scope validation
    if (toolName === 'Edit' || toolName === 'Write') {
      coreResult = checkScopeGate({
        filePath,
        operation: toolName.toLowerCase()
      });

      // If blocked by task or scope gating, return early
      if (coreResult.blocked) {
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        console.log(JSON.stringify(output));
        process.exit(0);
        return;
      }
    }

    // TodoWrite gating check (for TodoWrite)
    if (toolName === 'TodoWrite') {
      const todos = toolInput.todos || [];
      coreResult = checkTodoWriteGate({ todos });

      // If blocked by TodoWrite gating, return early
      if (coreResult.blocked) {
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        console.log(JSON.stringify(output));
        process.exit(0);
        return;
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
          // Preserve task gating allowance unless component check blocks
          allowed: !componentResult.blocked,
          blocked: componentResult.blocked
        };
      }
    }

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - allow operation to continue (graceful degradation)
    // Log generic message to avoid leaking sensitive path information
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    } else {
      console.error('[Wogi Flow Hook] Validation error occurred');
    }
    // Exit 0 with allow to not block on hook errors
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow'
      }
    }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
