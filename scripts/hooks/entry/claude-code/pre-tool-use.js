#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreToolUse Hook
 *
 * Called before Edit/Write/TodoWrite/Skill/Bash tool execution.
 * Enforces task gating, scope validation, component reuse checking,
 * TodoWrite gating, and routing gate enforcement.
 *
 * v4.0: Added scope gating to validate edits are within task's declared scope
 * v6.0: Added routing gate — blocks Bash before /wogi-* routing
 */

const path = require('path');
const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { checkTodoWriteGate } = require('../../core/todowrite-gate');
const { checkRoutingGate, clearRoutingPending } = require('../../core/routing-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending } = require('../../../flow-durable-session');
const { safeJsonParseString } = require('../../../flow-utils');

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

    // Parse JSON safely with prototype pollution protection
    let input;
    try {
      input = safeJsonParseString(inputData, null);
      if (!input) {
        // Invalid JSON - allow through (graceful degradation)
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
        }));
        process.exit(0);
        return;
      }
    } catch (_parseErr) {
      // Parse error - allow through (graceful degradation)
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

      // v6.0: Clear routing-pending flag on ANY /wogi-* skill invocation
      // This is the "routing happened" signal that unblocks Bash calls
      if (typeof skillName === 'string' && /^wogi-/i.test(skillName)) {
        try {
          clearRoutingPending();
          if (process.env.DEBUG) {
            console.error(`[Hook] Cleared routing-pending flag (Skill: ${skillName})`);
          }
        } catch (err) {
          // Non-blocking - don't fail the hook if clear fails
          if (process.env.DEBUG) {
            console.error(`[Hook] Failed to clear routing flag: ${err.message}`);
          }
        }
      }
    }

    // v6.0: Routing gate check (for Bash and EnterPlanMode)
    // Blocks Bash/EnterPlanMode calls when no /wogi-* command has been invoked first
    if (toolName === 'Bash' || toolName === 'EnterPlanMode') {
      try {
        const routingResult = checkRoutingGate(toolName);
        if (routingResult.blocked) {
          coreResult = {
            allowed: false,
            blocked: true,
            reason: `Routing gate: ${routingResult.reason}`,
            message: routingResult.message
          };
          const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
          console.log(JSON.stringify(output));
          process.exit(0);
          return;
        }
      } catch (err) {
        // Fail-open for routing gate (convenience enforcement, not security boundary)
        if (process.env.DEBUG) {
          console.error(`[Hook] Routing gate error (fail-open): ${err.message}`);
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
    // Fail-closed: deny the tool use on hook errors to prevent untracked edits
    // Users installed WogiFlow to enforce task tracking - failing open would bypass that
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    } else {
      console.error('[Wogi Flow Hook] Validation error occurred');
    }
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'WogiFlow validation error. Please check your setup or use /wogi-start.'
      }
    }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');

// Must await async main() to prevent race conditions
(async () => {
  try {
    await main();
  } catch (err) {
    // Fail-closed: deny on unexpected errors
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook] Unexpected error: ${err.message}`);
    }
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'WogiFlow hook error. Use /wogi-start to route your request.'
      }
    }));
    process.exit(0);
  }
})();
