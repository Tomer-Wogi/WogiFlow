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
const { checkRoutingGate, clearRoutingPending, hasActiveTask } = require('../../core/routing-gate');
const { checkPhaseGate } = require('../../core/phase-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending } = require('../../../flow-durable-session');
const { getConfig } = require('../../../flow-utils');
const { readHookInput } = require('../shared/read-stdin');

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

async function main() {
  try {
    // Read input from stdin with size limit and parse JSON safely
    const { input } = await readHookInput();

    // Handle empty or invalid input gracefully
    if (!input) {
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

    // Agent-aware gating: detect subagent context from hook event fields
    // Claude Code now provides agent_id and agent_type for subagent tool calls.
    // Subagents in read-only phases (explore, review) should be allowed to read freely.
    const rawAgentId = input.agent_id || null;
    const rawAgentType = input.agent_type || null;

    // Validate agent_id format (alphanumeric + hyphens, reasonable length)
    // and agent_type against known values to prevent spoofing
    const VALID_AGENT_TYPES = new Set([
      'general-purpose', 'Explore', 'Plan', 'code-reviewer', 'bug-analyzer',
      'statusline-setup', 'claude-code-guide', 'ui-sketcher'
    ]);
    const agentId = (typeof rawAgentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawAgentId)) ? rawAgentId : null;
    const agentType = (typeof rawAgentType === 'string' && VALID_AGENT_TYPES.has(rawAgentType)) ? rawAgentType : null;
    const isSubagent = !!agentId;

    // Determine subagent intent from agent_type and apply dynamic permissions
    // agent_type values from Claude Code: 'general-purpose', 'Explore', 'Plan', 'code-reviewer', etc.
    const readOnlyAgentTypes = new Set(['Explore', 'Plan', 'code-reviewer', 'bug-analyzer']);
    const subagentReadOnly = isSubagent && agentType ? readOnlyAgentTypes.has(agentType) : false;

    // Load config ONCE and pass to all gate functions (avoids 7-8 redundant reads per tool call)
    let config;
    try {
      config = getConfig();
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Config load error: ${err.message}`);
      config = null; // Gates will fall back to their own getConfig() calls
    }

    let coreResult = { allowed: true, blocked: false };

    // Phase gate check — blocks tools not allowed in current workflow phase
    // Runs before all other gates. Fail-open: errors skip the check.
    // Subagents with read-only intent (Explore, Plan, code-reviewer) are allowed
    // to use read tools (Read, Glob, Grep, WebSearch, WebFetch) regardless of phase.
    const isReadTool = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(toolName);
    const skipPhaseGateForSubagent = isSubagent && subagentReadOnly && isReadTool;

    if (!skipPhaseGateForSubagent) {
      try {
        const phaseResult = checkPhaseGate(toolName, toolInput, config);
        if (phaseResult.blocked) {
          coreResult = { allowed: false, blocked: true, reason: phaseResult.reason, message: phaseResult.message };
          const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
          console.log(JSON.stringify(output));
          process.exit(0);
          return;
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`[Hook] Phase gate error (fail-open): ${err.message}`);
      }
    }

    // Task + scope gating check (for Edit and Write)
    // v4.0: checkScopeGate wraps checkTaskGate and adds scope validation
    if (toolName === 'Edit' || toolName === 'Write') {
      coreResult = checkScopeGate({
        filePath,
        operation: toolName.toLowerCase()
      }, config);

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
      coreResult = checkTodoWriteGate({ todos }, config);

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

    // v6.0: Routing gate — blocks tools when no /wogi-* command has been invoked first.
    // Edit/Write MUST be gated — AI can edit ready.json to create fake active tasks.
    // Agent MUST be gated — AI can spawn subagents that bypass routing entirely.
    // WebSearch/WebFetch gated for consistency with GATED_TOOLS in routing-gate.js.
    // NOTE: This list must stay in sync with GATED_TOOLS in routing-gate.js and the
    // PreToolUse matcher in settings.json. The matcher is a SUPERSET (adds Skill, TodoWrite).
    // v7.0: Subagents exempt — spawned by main agent which already went through routing.
    // v7.1: Defense-in-depth — only bypass when an active task exists.
    // v8.0: Added Agent, WebSearch, WebFetch to close bypass vectors.
    // v8.1: Whitelist read-only git commands — Claude naturally runs git status/log/diff
    //        to gather context before routing. These are pure reads with no side effects.
    const skipRoutingGateForSubagent = isSubagent && hasActiveTask();

    // Read-only git commands whitelist — allowed before routing.
    // These are pure read operations that cannot bypass task tracking.
    // Safety: reject commands with shell chaining operators to prevent abuse.
    let skipRoutingGateForReadOnlyGit = false;
    if (toolName === 'Bash' && toolInput.command) {
      const cmd = toolInput.command.trim();
      const READ_ONLY_GIT_PREFIXES = [
        'git status', 'git log', 'git diff', 'git branch',
        'git show', 'git rev-parse', 'git remote -v', 'git tag -l',
        'git ls-files', 'git describe'
      ];
      // Block shell chaining operators AND control characters that could bypass prefix matching
      const SHELL_CHAIN_OPERATORS = /[;&|`$()\n\r\\]/;
      // Block destructive flags that could appear after an otherwise-safe prefix
      const DESTRUCTIVE_GIT_FLAGS = /\s-[dD]\b|\s--delete\b|\s--force\b|\s--hard\b|\s--prune\b/;
      if (
        READ_ONLY_GIT_PREFIXES.some(prefix => cmd.startsWith(prefix)) &&
        !SHELL_CHAIN_OPERATORS.test(cmd) &&
        !DESTRUCTIVE_GIT_FLAGS.test(cmd)
      ) {
        skipRoutingGateForReadOnlyGit = true;
      }
    }

    if (!skipRoutingGateForSubagent && !skipRoutingGateForReadOnlyGit && (toolName === 'Bash' || toolName === 'EnterPlanMode' || toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep' || toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit' || toolName === 'Agent' || toolName === 'WebSearch' || toolName === 'WebFetch')) {
      try {
        const routingResult = checkRoutingGate(toolName, config);
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
        // Fail-CLOSED for routing gate — users installed WogiFlow for enforcement.
        // If the gate check itself errors, deny the tool rather than silently allowing
        // the exact bypass this system exists to prevent.
        if (process.env.DEBUG) {
          console.error(`[Hook] Routing gate error (fail-closed): ${err.message}`);
        }
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Routing gate error: ${err.message}`,
          message: 'Routing gate check failed. Please invoke /wogi-start first. Use Skill(skill="wogi-start", args="<your request>").'
        };
        const errOutput = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        console.log(JSON.stringify(errOutput));
        process.exit(0);
        return;
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
      }, config);

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
