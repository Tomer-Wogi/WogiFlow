#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Adapter
 *
 * Transforms core hook results to Claude Code's hook format.
 * Handles SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd.
 */

const path = require('node:path');
const fs = require('node:fs');
const { BaseAdapter } = require('./base-adapter');

// Import from parent scripts directory
const { PATHS } = require('../../flow-utils');

// ============================================================
// Hook Timeout Constants (in seconds)
// ============================================================
// These values are used in generateConfig() to set timeouts for Claude Code hooks.
// They define how long each hook is allowed to run before timing out.

const HOOK_TIMEOUTS = {
  SESSION_START: 10,      // Session initialization
  SETUP: 30,              // Project setup/onboarding
  WORKTREE_CREATE: 10,    // Copy essential state to new worktree (Claude Code 2.1.50+)
  WORKTREE_REMOVE: 5,     // Clean up session state from removed worktree (Claude Code 2.1.50+)
  USER_PROMPT_SUBMIT: 5,  // Implementation gate check
  PRE_TOOL_USE: 5,        // Pre-edit checks (task gate, component check)
  POST_TOOL_USE: 60,      // Validation (linting, type checking)
  PRE_COMPACT: 5,         // Pre-compaction state save + block decision (Claude Code 2.1.105+)
  POST_COMPACT: 5,        // Post-compaction state recovery (Claude Code 2.1.76+)
  STOP: 5,                // Loop enforcement check
  SESSION_END: 10,        // Session cleanup/logging
  TASK_COMPLETED: 10,     // Post-task cleanup (Claude Code 2.1.33+)
  TASK_CREATED: 5,        // Task creation tracking (Claude Code 2.1.84+)
  TEAMMATE_IDLE: 5,       // Task dispatch for idle agents (Claude Code 2.1.33+)
  CONFIG_CHANGE: 5,       // Mid-session config change detection (Claude Code latest)
  INSTRUCTIONS_LOADED: 5  // Instructions loaded event (Claude Code latest)
};

/**
 * Claude Code Hook Events — ONLY officially supported events.
 * Claude Code rejects settings.json with unrecognized hook keys.
 * Do NOT add hooks here without verifying they pass Claude Code schema validation.
 */
const CLAUDE_CODE_EVENTS = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
  'UserPromptSubmit',
  'TaskCompleted',
  'WorktreeCreate',       // Claude Code 2.1.50+ — copy state to new worktree
  'WorktreeRemove',       // Claude Code 2.1.50+ — clean up worktree state
  'ConfigChange',         // Claude Code 2.1.63+ — mid-session config change detection
  'InstructionsLoaded',   // Claude Code latest — fires when CLAUDE.md/.claude/rules loaded
  'PostCompact',          // Claude Code 2.1.76+ — fires after context compaction completes
  'TaskCreated',          // Claude Code 2.1.84+ — fires when a task is created via TaskCreate
  'PreCompact',           // Claude Code 2.1.105+ — fires before context compaction, can block
];

/**
 * Extended hook events — supported but not yet used by WogiFlow.
 * See: https://code.claude.com/docs/en/hooks for the full event list.
 */
// const UNUSED_SUPPORTED_EVENTS = [
//   'SubagentStart',      // Supported but not yet used by WogiFlow
//   'SubagentStop',       // Supported but not yet used by WogiFlow
//   'Notification',       // Supported but not yet used by WogiFlow
//   'Elicitation',        // Claude Code 2.1.76+ — intercept MCP elicitation requests before dialog
//   'ElicitationResult',  // Claude Code 2.1.76+ — intercept/override elicitation responses before sending
//   'CwdChanged',         // Claude Code 2.1.83+ — fires when working directory changes (e.g., direnv)
//   'FileChanged',        // Claude Code 2.1.83+ — fires when watched files change on disk
//   'WorktreeCreate (http)', // Claude Code 2.1.84+ — WorktreeCreate now supports type:"http" transport
// ];

/**
 * HTTP hook transport is NOT supported for SessionStart.
 * These events must always use 'command' transport.
 */
const COMMAND_ONLY_EVENTS = new Set(['SessionStart']);

/**
 * Build a hook entry based on transport config.
 *
 * @param {'command'|'http'} transport - Hook transport type
 * @param {string} eventName - Hook event name (used to force command for COMMAND_ONLY_EVENTS)
 * @param {Object} commandOpts - Command transport options: { command, timeout }
 * @param {Object} httpOpts - HTTP transport options: { url, headers, allowedEnvVars, timeout }
 * @returns {Object} Claude Code hook entry
 */
function buildHookEntry(transport, eventName, commandOpts, httpOpts) {
  // SessionStart always uses command transport (HTTP not supported)
  if (transport === 'http' && COMMAND_ONLY_EVENTS.has(eventName)) {
    transport = 'command';
  }

  if (transport === 'http' && httpOpts?.url) {
    const entry = {
      type: 'http',
      url: httpOpts.url,
      timeout: httpOpts.timeout || commandOpts.timeout
    };
    if (httpOpts.headers && Object.keys(httpOpts.headers).length > 0) {
      entry.headers = httpOpts.headers;
    }
    if (httpOpts.allowedEnvVars && httpOpts.allowedEnvVars.length > 0) {
      entry.allowedEnvVars = httpOpts.allowedEnvVars;
    }
    return entry;
  }

  // Default: command transport
  return {
    type: 'command',
    command: commandOpts.command,
    timeout: commandOpts.timeout
  };
}

/**
 * Claude Code Adapter
 */
class ClaudeCodeAdapter extends BaseAdapter {
  constructor() {
    super('claude-code');
  }

  /**
   * Get Claude Code's settings path
   */
  getConfigPath() {
    return path.join(PATHS.claude, 'settings.json');
  }

  /**
   * Get local settings path (not committed)
   */
  getLocalConfigPath() {
    return path.join(PATHS.claude, 'settings.local.json');
  }

  /**
   * Get supported events
   */
  getSupportedEvents() {
    return CLAUDE_CODE_EVENTS;
  }

  /**
   * Check if Claude Code is likely available
   */
  isAvailable() {
    // Check if .claude directory exists
    return fs.existsSync(PATHS.claude);
  }

  /**
   * Parse Claude Code hook input
   */
  parseInput(input) {
    return {
      sessionId: input.session_id,
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      permissionMode: input.permission_mode,
      hookEvent: input.hook_event_name,
      toolName: input.tool_name,
      toolInput: input.tool_input,
      toolUseId: input.tool_use_id,
      toolResponse: input.tool_response,
      prompt: input.prompt,
      source: input.source,
      reason: input.reason
    };
  }

  /**
   * Transform core result to Claude Code format
   */
  transformResult(event, coreResult) {
    switch (event) {
      case 'SessionStart':
        return this.transformSessionStart(coreResult);
      case 'Setup':
        return this.transformSetup(coreResult);
      case 'PreToolUse':
        return this.transformPreToolUse(coreResult);
      case 'PostToolUse':
        return this.transformPostToolUse(coreResult);
      case 'Stop':
      case 'SubagentStop':
        return this.transformStop(coreResult);
      case 'SessionEnd':
        return this.transformSessionEnd(coreResult);
      case 'UserPromptSubmit':
        return this.transformUserPromptSubmit(coreResult);
      case 'TaskCompleted':
        return this.transformTaskCompleted(coreResult);
      case 'ConfigChange':
        return this.transformConfigChange(coreResult);
      case 'WorktreeCreate':
        return this.transformWorktreeCreate(coreResult);
      case 'WorktreeRemove':
        return this.transformWorktreeRemove(coreResult);
      case 'InstructionsLoaded':
        return this.transformInstructionsLoaded(coreResult);
      case 'PreCompact':
        return this.transformPreCompact(coreResult);
      case 'PostCompact':
        return this.transformPostCompact(coreResult);
      case 'TaskCreated':
        return this.transformTaskCreated(coreResult);
      default:
        return { continue: true };
    }
  }

  /**
   * Transform SessionStart result
   */
  transformSessionStart(coreResult) {
    if (!coreResult.enabled || !coreResult.context) {
      return { continue: true };
    }

    // Format context for injection
    const { formatContextForInjection } = require('../core/session-context');
    const contextText = formatContextForInjection(coreResult);

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextText
      }
    };
  }

  /**
   * Transform Setup result (Claude Code 2.1.10+ --init/--maintenance)
   */
  transformSetup(coreResult) {
    // If setup is needed, inject context for the AI to act on
    if (coreResult.needsSetup && coreResult.message) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'Setup',
          additionalContext: coreResult.message
        }
      };
    }

    // Maintenance results
    if (coreResult.results && coreResult.message) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'Setup',
          additionalContext: coreResult.message
        }
      };
    }

    // No action needed (already configured or setup disabled)
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message }),
      hookSpecificOutput: {
        hookEventName: 'Setup'
      }
    };
  }

  /**
   * Transform PreToolUse result (task gating, component check)
   */
  transformPreToolUse(coreResult) {
    // Blocked - deny permission
    if (coreResult.blocked) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: coreResult.message || 'Action blocked by Wogi Flow'
        }
      };
    }

    // Warning - allow but show message and inject context (Claude Code 2.1.9+)
    if (coreResult.warning && coreResult.message) {
      const result = {
        continue: true,
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow'
        }
      };

      // Inject component context via additionalContext (Claude Code 2.1.9+ feature)
      // This gives the AI richer context about similar components for better decisions
      if (coreResult.contextBlock) {
        result.hookSpecificOutput.additionalContext = coreResult.contextBlock;
      }

      return result;
    }

    // Allowed
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow'
      }
    };
  }

  /**
   * Transform PostToolUse result (validation)
   */
  transformPostToolUse(coreResult) {
    // If validation was skipped or passed
    if (coreResult.passed) {
      const message = coreResult.summary || (coreResult.passed ? 'Validation passed' : null);
      return {
        continue: true,
        ...(message && { systemMessage: message })
      };
    }

    // Validation failed
    return {
      continue: true,
      systemMessage: coreResult.summary || 'Validation failed',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        decision: coreResult.blocked ? 'block' : undefined,
        reason: coreResult.message
      }
    };
  }

  /**
   * Transform Stop result (loop enforcement + task queue continuation)
   */
  transformStop(coreResult) {
    // Can exit
    if (coreResult.canExit) {
      return {
        continue: false, // Allow stop
        ...(coreResult.message && { systemMessage: coreResult.message })
      };
    }

    // Continue to next task in queue (not blocked, just continue)
    if (coreResult.continueToNext) {
      const nextTaskMsg = `
✓ Task complete!

**Continuing to next task in queue:** ${coreResult.nextTaskId}
(${coreResult.remaining} task(s) remaining)

Run: /wogi-start ${coreResult.nextTaskId}`;

      return {
        continue: true, // Force continue to next task
        systemMessage: nextTaskMsg
      };
    }

    // Prompt before continuing to next task (pauseBetweenTasks: true)
    if (coreResult.shouldPrompt) {
      return {
        continue: true,
        systemMessage: coreResult.message
      };
    }

    // Block exit - criteria not complete
    return {
      continue: true, // Force continue
      stopReason: coreResult.message || 'Acceptance criteria not complete'
    };
  }

  /**
   * Transform SessionEnd result (auto-logging)
   */
  transformSessionEnd(coreResult) {
    // SessionEnd doesn't block, just provides info
    return {
      continue: true,
      ...(coreResult.warning && { systemMessage: coreResult.warning }),
      ...(coreResult.logged && { systemMessage: `Logged as ${coreResult.requestId}` })
    };
  }

  /**
   * Transform UserPromptSubmit result (implementation gate + research gate)
   *
   * Claude Code UserPromptSubmit response format:
   *   Block:   { decision: "block", reason: "..." }  (top-level fields)
   *   Allow:   {} or omit decision
   *   Context: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "..." } }
   *
   * NOTE: "continue: false" stops the entire session, NOT the individual prompt.
   * Use "decision: block" to reject a single prompt.
   */
  transformUserPromptSubmit(coreResult) {
    // Blocked - reject the prompt using top-level decision field
    if (coreResult.blocked) {
      return {
        decision: 'block',
        reason: coreResult.message || 'Implementation request blocked by Wogi Flow'
      };
    }

    // Compose additionalContext from up to four pieces:
    //   1. systemReminder (research protocol) OR message (warning)
    //   2. phasePrompt (phase-specific context)
    //   3. overduePrompt (wf-d3e67abe — silent-halt surfacing, manager-only)
    const pieces = [];
    if (coreResult.systemReminder) pieces.push(coreResult.systemReminder);
    else if (coreResult.message) pieces.push(coreResult.message);
    if (coreResult.phasePrompt) pieces.push(coreResult.phasePrompt);
    if (coreResult.overduePrompt) pieces.push(coreResult.overduePrompt);

    if (pieces.length === 0) {
      // Allowed - empty response means allow
      return {};
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: pieces.join('\n\n')
      }
    };
  }

  /**
   * Transform TaskCompleted result (Claude Code 2.1.33+)
   */
  transformTaskCompleted(coreResult) {
    if (!coreResult.enabled) {
      return { continue: true };
    }

    // Gap A (v2.20.0) — inject auto-pickup additionalContext when workspace
    // worker has queued channel dispatches. Core already decided whether this
    // applies (only fires in workspace worker mode + autoPickupChannelDispatches
    // config + at least one queued dispatch).
    const hookSpecificOutput = {
      hookEventName: 'TaskCompleted',
      completed: coreResult.completed,
      taskId: coreResult.taskId
    };
    if (coreResult.workspaceAutoPickup?.additionalContext) {
      hookSpecificOutput.additionalContext = coreResult.workspaceAutoPickup.additionalContext;
    }

    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message }),
      hookSpecificOutput
    };
  }

  /**
   * Transform ConfigChange result (Claude Code latest)
   * Always non-blocking - informational only
   */
  transformConfigChange(coreResult) {
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message })
    };
  }

  /**
   * Transform WorktreeCreate result (Claude Code 2.1.50+)
   * Copies essential .workflow/state files to the new worktree.
   */
  transformWorktreeCreate(coreResult) {
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message })
    };
  }

  /**
   * Transform WorktreeRemove result (Claude Code 2.1.50+)
   * Cleans up session state from the removed worktree.
   */
  transformWorktreeRemove(coreResult) {
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message })
    };
  }

  /**
   * Transform TaskCreated result (Claude Code 2.1.84+)
   * Fires when a task is created via TaskCreate.
   * Links native tasks to the active WogiFlow task for tracking.
   */
  transformTaskCreated(coreResult) {
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message }),
      hookSpecificOutput: {
        hookEventName: 'TaskCreated',
        linked: coreResult.linked || false,
        wogiTaskId: coreResult.wogiTaskId || null
      }
    };
  }

  /**
   * Transform InstructionsLoaded result
   * Fires when CLAUDE.md or .claude/rules/*.md files are loaded into context.
   * Used for: package-check suggestions, rule conflict detection, auto-onboard detection.
   */
  transformInstructionsLoaded(coreResult) {
    if (!coreResult.enabled) {
      return { continue: true };
    }

    const parts = [];
    if (coreResult.message) parts.push(coreResult.message);
    if (coreResult.warnings && coreResult.warnings.length > 0) {
      parts.push(coreResult.warnings.join('\n'));
    }

    if (parts.length === 0) {
      return { continue: true };
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'InstructionsLoaded',
        additionalContext: parts.join('\n\n')
      }
    };
  }

  /**
   * Transform PreCompact result (Claude Code 2.1.105+)
   * Saves state before compaction and optionally blocks it.
   *
   * PreCompact hooks can block compaction by returning { decision: "block" }.
   * The entry point handles __raw output for block decisions.
   * This transform handles the allow case.
   */
  transformPreCompact(coreResult) {
    // Block decisions are handled as __raw in the entry point
    // This handles the allow path
    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message })
    };
  }

  /**
   * Transform PostCompact result (Claude Code 2.1.76+)
   * Re-injects critical state after context compaction.
   * Always non-blocking — informational only.
   *
   * NOTE: Claude Code only recognizes hookSpecificOutput for PreToolUse,
   * UserPromptSubmit, and PostToolUse. PostCompact must use systemMessage
   * to inject context back after compaction.
   */
  transformPostCompact(coreResult) {
    if (!coreResult.enabled || !coreResult.hasContext) {
      return { continue: true };
    }

    return {
      continue: true,
      systemMessage: coreResult.message
    };
  }

  /**
   * Generate Claude Code hook configuration
   */
  generateConfig(rules, projectRoot, transportConfig) {
    const scriptsDir = path.join(projectRoot, 'scripts', 'hooks', 'entry', 'claude-code');
    const hooks = {};

    // Transport config: { transport: 'command'|'http', url, headers, allowedEnvVars }
    // Default: 'command' (local script execution)
    const transport = transportConfig?.transport || 'command';
    const httpOpts = transport === 'http' ? {
      url: transportConfig.url,
      headers: transportConfig.headers || {},
      allowedEnvVars: transportConfig.allowedEnvVars || []
    } : null;

    // Helper to build hook entry for a given event
    const hookEntry = (eventName, scriptFile, timeout) => buildHookEntry(
      transport, eventName,
      { command: `node "${path.join(scriptsDir, scriptFile)}"`, timeout },
      httpOpts ? { ...httpOpts, timeout } : null
    );

    // SessionStart hook (always 'command' — HTTP not supported)
    if (rules.sessionContext?.enabled !== false) {
      hooks.SessionStart = [{
        hooks: [hookEntry('SessionStart', 'session-start.js', HOOK_TIMEOUTS.SESSION_START)]
      }];
    }

    // NOTE: Setup hook removed — not in official Claude Code schema.
    // The setup.js entry script still exists for manual use.

    // UserPromptSubmit hook (implementation gate)
    if (rules.implementationGate?.enabled !== false) {
      hooks.UserPromptSubmit = [{
        hooks: [hookEntry('UserPromptSubmit', 'user-prompt-submit.js', HOOK_TIMEOUTS.USER_PROMPT_SUBMIT)]
      }];
    }

    // PreToolUse hooks — matcher must be a SUPERSET of the inline gated-tools list
    // in pre-tool-use.js and GATED_TOOLS in routing-gate.js.
    // Extra: Skill (routing-clear + skill tracking), TodoWrite (todowrite-gate)
    const preToolUseMatchers = [];

    // Task gating, routing gate, TodoWrite gating, Skill tracking, Bash strict adherence
    if (rules.taskGating?.enabled !== false || rules.todoWriteGate?.enabled !== false) {
      preToolUseMatchers.push({
        matcher: 'Edit|Write|TodoWrite|Skill|Bash|Read|Glob|Grep|EnterPlanMode|Agent|NotebookEdit|WebSearch|WebFetch',
        hooks: [hookEntry('PreToolUse', 'pre-tool-use.js', HOOK_TIMEOUTS.PRE_TOOL_USE)]
      });
    }

    if (preToolUseMatchers.length > 0) {
      hooks.PreToolUse = preToolUseMatchers;
    }

    // PostToolUse hooks for validation (Edit/Write/Bash only)
    // IMPORTANT: matcher MUST be present. Without it, PostToolUse fires on ALL tools
    // (Read, Glob, Grep, WebSearch, etc.), adding hook overhead to every read operation
    // with zero validation benefit. This was causing unnecessary token consumption
    // in target projects where generateConfig() produces the settings.
    if (rules.validation?.enabled !== false) {
      hooks.PostToolUse = [{
        matcher: 'Edit|Write|Bash',
        hooks: [hookEntry('PostToolUse', 'post-tool-use.js', HOOK_TIMEOUTS.POST_TOOL_USE)]
      }];
    }

    // Stop hook for loop enforcement
    if (rules.loopEnforcement?.enabled !== false) {
      hooks.Stop = [{
        hooks: [hookEntry('Stop', 'stop.js', HOOK_TIMEOUTS.STOP)]
      }];
    }

    // SessionEnd hook for auto-logging
    if (rules.autoLogging?.enabled !== false) {
      hooks.SessionEnd = [{
        hooks: [hookEntry('SessionEnd', 'session-end.js', HOOK_TIMEOUTS.SESSION_END)]
      }];
    }

    // TaskCompleted hook for post-task cleanup (Claude Code 2.1.33+)
    if (rules.taskCompleted?.enabled !== false) {
      hooks.TaskCompleted = [{
        hooks: [hookEntry('TaskCompleted', 'task-completed.js', HOOK_TIMEOUTS.TASK_COMPLETED)]
      }];
    }

    // TaskCreated hook — link native tasks to WogiFlow task (Claude Code 2.1.84+)
    if (rules.taskCreated?.enabled !== false) {
      hooks.TaskCreated = [{
        hooks: [hookEntry('TaskCreated', 'task-created.js', HOOK_TIMEOUTS.TASK_CREATED)]
      }];
    }

    // WorktreeCreate hook — copy essential state to new worktree (Claude Code 2.1.50+)
    if (rules.worktreeLifecycle?.enabled !== false) {
      hooks.WorktreeCreate = [{
        hooks: [hookEntry('WorktreeCreate', 'worktree-create.js', HOOK_TIMEOUTS.WORKTREE_CREATE)]
      }];
    }

    // WorktreeRemove hook — clean up session state from removed worktree (Claude Code 2.1.50+)
    if (rules.worktreeLifecycle?.enabled !== false) {
      hooks.WorktreeRemove = [{
        hooks: [hookEntry('WorktreeRemove', 'worktree-remove.js', HOOK_TIMEOUTS.WORKTREE_REMOVE)]
      }];
    }

    // ConfigChange hook — detect mid-session config changes (Claude Code 2.1.63+)
    if (rules.configChange?.enabled !== false) {
      hooks.ConfigChange = [{
        hooks: [hookEntry('ConfigChange', 'config-change.js', HOOK_TIMEOUTS.CONFIG_CHANGE)]
      }];
    }

    // PreCompact hook — save state + block during critical phases (Claude Code 2.1.105+)
    if (rules.preCompact?.enabled !== false) {
      hooks.PreCompact = [{
        hooks: [hookEntry('PreCompact', 'pre-compact.js', HOOK_TIMEOUTS.PRE_COMPACT)]
      }];
    }

    // PostCompact hook — re-inject state after compaction (Claude Code 2.1.76+)
    if (rules.postCompact?.enabled !== false) {
      hooks.PostCompact = [{
        hooks: [hookEntry('PostCompact', 'post-compact.js', HOOK_TIMEOUTS.POST_COMPACT)]
      }];
    }

    // InstructionsLoaded hook — package check, rule conflicts, auto-onboard
    if (rules.instructionsLoaded?.enabled !== false) {
      hooks.InstructionsLoaded = [{
        hooks: [hookEntry('InstructionsLoaded', 'instructions-loaded.js', HOOK_TIMEOUTS.INSTRUCTIONS_LOADED)]
      }];
    }

    // Final safety filter: only emit hooks that are in CLAUDE_CODE_EVENTS
    const filteredHooks = {};
    for (const [key, value] of Object.entries(hooks)) {
      if (CLAUDE_CODE_EVENTS.includes(key)) {
        filteredHooks[key] = value;
      }
    }

    return { hooks: filteredHooks };
  }

  /**
   * Get install instructions
   */
  getInstallInstructions() {
    return `Claude Code hooks will be installed to ${this.getLocalConfigPath()}

To use:
1. Run: ./scripts/flow hooks setup
2. Hooks are automatically loaded by Claude Code

To remove:
- Run: ./scripts/flow hooks remove`;
  }
}

// Export singleton instance
const claudeCodeAdapter = new ClaudeCodeAdapter();

module.exports = {
  ClaudeCodeAdapter,
  claudeCodeAdapter,
  CLAUDE_CODE_EVENTS
};
