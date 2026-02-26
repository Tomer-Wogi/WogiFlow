#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Adapter
 *
 * Transforms core hook results to Claude Code's hook format.
 * Handles SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd.
 */

const path = require('path');
const fs = require('fs');
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
  STOP: 5,                // Loop enforcement check
  SESSION_END: 10,        // Session cleanup/logging
  TASK_COMPLETED: 10,     // Post-task cleanup (Claude Code 2.1.33+)
  TEAMMATE_IDLE: 5,       // Task dispatch for idle agents (Claude Code 2.1.33+)
  CONFIG_CHANGE: 5        // Mid-session config change detection (Claude Code latest)
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
];

/**
 * Extended hook events — some now officially supported in Claude Code 2.1.59+.
 * TaskCompleted was added to CLAUDE_CODE_EVENTS above.
 * See: https://code.claude.com/docs/en/hooks for the full event list.
 */
// const EXTENDED_EVENTS_NOT_YET_VERIFIED = [
//   'SubagentStart',   // Supported but not yet used by WogiFlow
//   'SubagentStop',    // Supported but not yet used by WogiFlow
//   'Notification',    // Supported but not yet used by WogiFlow
//   'ConfigChange',    // Speculated for config changes
//   'WorktreeCreate',  // Speculated for worktree creation
//   'WorktreeRemove',  // Speculated for worktree removal
// ];

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

    // Research protocol triggered - inject protocol steps as additional context
    if (coreResult.systemReminder) {
      // Append phase prompt if present
      const context = coreResult.phasePrompt
        ? `${coreResult.systemReminder}\n\n${coreResult.phasePrompt}`
        : coreResult.systemReminder;
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: context
        }
      };
    }

    // Warning - allow but inject context with the warning message
    if (coreResult.message && !coreResult.blocked) {
      // Append phase prompt if present
      const context = coreResult.phasePrompt
        ? `${coreResult.message}\n\n${coreResult.phasePrompt}`
        : coreResult.message;
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: context
        }
      };
    }

    // Phase prompt only (no other context to inject)
    if (coreResult.phasePrompt) {
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: coreResult.phasePrompt
        }
      };
    }

    // Allowed - empty response means allow
    return {};
  }

  /**
   * Transform TaskCompleted result (Claude Code 2.1.33+)
   */
  transformTaskCompleted(coreResult) {
    if (!coreResult.enabled) {
      return { continue: true };
    }

    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message }),
      hookSpecificOutput: {
        hookEventName: 'TaskCompleted',
        completed: coreResult.completed,
        taskId: coreResult.taskId
      }
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
   * Generate Claude Code hook configuration
   */
  generateConfig(rules, projectRoot) {
    const scriptsDir = path.join(projectRoot, 'scripts', 'hooks', 'entry', 'claude-code');
    const hooks = {};

    // SessionStart hook
    if (rules.sessionContext?.enabled !== false) {
      hooks.SessionStart = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'session-start.js')}"`,
          timeout: HOOK_TIMEOUTS.SESSION_START
        }]
      }];
    }

    // NOTE: Setup hook removed — not in official Claude Code schema.
    // The setup.js entry script still exists for manual use.

    // UserPromptSubmit hook (implementation gate)
    if (rules.implementationGate?.enabled !== false) {
      hooks.UserPromptSubmit = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'user-prompt-submit.js')}"`,
          timeout: HOOK_TIMEOUTS.USER_PROMPT_SUBMIT
        }]
      }];
    }

    // PreToolUse hooks for Edit/Write/TodoWrite
    const preToolUseMatchers = [];

    // Task gating for Edit/Write + TodoWrite gating + Skill tracking + Bash strict adherence
    if (rules.taskGating?.enabled !== false || rules.todoWriteGate?.enabled !== false) {
      preToolUseMatchers.push({
        matcher: 'Edit|Write|TodoWrite|Skill|Bash|Read|Glob|Grep|EnterPlanMode',
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'pre-tool-use.js')}"`,
          timeout: HOOK_TIMEOUTS.PRE_TOOL_USE
        }]
      });
    }

    if (preToolUseMatchers.length > 0) {
      hooks.PreToolUse = preToolUseMatchers;
    }

    // PostToolUse hooks for validation + observation capture (all tools)
    if (rules.validation?.enabled !== false) {
      hooks.PostToolUse = [{
        // No matcher - fires for ALL tools so observation capture works universally
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'post-tool-use.js')}"`,
          timeout: HOOK_TIMEOUTS.POST_TOOL_USE
        }]
      }];
    }

    // Stop hook for loop enforcement
    if (rules.loopEnforcement?.enabled !== false) {
      hooks.Stop = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'stop.js')}"`,
          timeout: HOOK_TIMEOUTS.STOP
        }]
      }];
    }

    // SessionEnd hook for auto-logging
    if (rules.autoLogging?.enabled !== false) {
      hooks.SessionEnd = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'session-end.js')}"`,
          timeout: HOOK_TIMEOUTS.SESSION_END
        }]
      }];
    }

    // TaskCompleted hook for post-task cleanup (Claude Code 2.1.33+)
    if (rules.taskCompleted?.enabled !== false) {
      hooks.TaskCompleted = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'task-completed.js')}"`,
          timeout: HOOK_TIMEOUTS.TASK_COMPLETED
        }]
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
