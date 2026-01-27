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
const { markSkillPending } = require('../../../flow-durable-session');

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

    // v4.1: Skill execution tracking (for Skill tool)
    // Catches natural language skill invocations (e.g., "do the bulk tasks")
    if (toolName === 'Skill') {
      const skillName = toolInput.skill;
      if (typeof skillName === 'string' && /^wogi-(bulk|start)$/i.test(skillName)) {
        markSkillPending(skillName.toLowerCase(), { args: toolInput.args });
        if (process.env.DEBUG) {
          console.error(`[Hook] Marked skill ${skillName} as pending (via Skill tool)`);
        }
      }
    }

    // Strict adherence check (for Bash commands)
    // v5.0: Block AI from using wrong package manager or port
    if (toolName === 'Bash') {
      const command = toolInput.command;
      if (command) {
        const strictAdherence = getStrictAdherence();
        if (strictAdherence.isEnabled()) {
          const cmdResult = strictAdherence.validateCommand(command);
          if (cmdResult.blocked) {
            // Return with auto-corrected command suggestion
            coreResult = {
              allowed: false,
              blocked: true,
              reason: `Strict adherence: ${cmdResult.reason}`,
              message: cmdResult.autoCorrect
                ? `⚠️ BLOCKED: ${cmdResult.reason}\n\n✅ Auto-correcting to: ${cmdResult.autoCorrect}`
                : `⚠️ BLOCKED: ${cmdResult.reason}\n\n💡 ${cmdResult.suggestion || 'Please use the correct pattern.'}`
            };
            const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
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
          // Preserve task gating allowance unless component check blocks
          allowed: !componentResult.blocked,
          blocked: componentResult.blocked
        };
      }

      // Strict adherence: File naming check (for Write)
      // v5.0: Block AI from creating files with wrong naming convention
      // v5.1: Fixed to pass basename instead of full path
      if (!coreResult.blocked) {
        const strictAdherence = getStrictAdherence();
        if (strictAdherence.isEnabled()) {
          // Determine file type from path (more precise matching)
          // Only match if path contains /components/, /ui/, /api/, /routes/ directories
          const isComponent = /\/(components?|ui)\//i.test(filePath) && /\.(tsx|jsx)$/i.test(filePath);
          const isApi = /\/(api|routes)\//i.test(filePath);
          const fileType = isComponent ? 'component' : isApi ? 'api' : 'generic';

          // Extract basename for validation (validateFileName expects just the filename)
          const path = require('path');
          const fileName = path.basename(filePath);
          const fileResult = strictAdherence.validateFileName(fileName, fileType);
          if (fileResult.blocked) {
            coreResult = {
              allowed: false,
              blocked: true,
              reason: `Strict adherence: ${fileResult.reason}`,
              message: `⚠️ BLOCKED: ${fileResult.reason}\n\n💡 ${fileResult.suggestion || 'Please use the correct naming convention.'}`
            };
          }
        }
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
