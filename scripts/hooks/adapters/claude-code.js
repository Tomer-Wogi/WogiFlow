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
  USER_PROMPT_SUBMIT: 5,  // Implementation gate check
  PRE_TOOL_USE: 5,        // Pre-edit checks (task gate, component check)
  POST_TOOL_USE: 60,      // Validation (linting, type checking)
  STOP: 5,                // Loop enforcement check
  SESSION_END: 10,        // Session cleanup/logging
  TASK_COMPLETED: 10,     // Post-task cleanup (Claude Code 2.1.33+)
  TEAMMATE_IDLE: 5        // Task dispatch for idle agents (Claude Code 2.1.33+)
};

/**
 * Claude Code Hook Events
 */
const CLAUDE_CODE_EVENTS = [
  'SessionStart',
  'Setup',           // Claude Code 2.1.10+ - triggered by --init, --init-only, --maintenance
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionEnd',
  'Notification',
  'UserPromptSubmit',
  'TaskCompleted',   // Claude Code 2.1.33+ - fired when sub-agent task completes
  'TeammateIdle'     // Claude Code 2.1.33+ - fired when teammate agent becomes idle
];

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
      case 'TeammateIdle':
        return this.transformTeammateIdle(coreResult);
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
    if (coreResult.skipped || coreResult.passed) {
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
        systemMessage: nextTaskMsg,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          decision: 'continue_queue',
          nextTaskId: coreResult.nextTaskId,
          remaining: coreResult.remaining
        }
      };
    }

    // Prompt before continuing to next task (pauseBetweenTasks: true)
    if (coreResult.shouldPrompt) {
      return {
        continue: true,
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          decision: 'prompt_continue',
          nextTaskId: coreResult.nextTaskId
        }
      };
    }

    // Block exit - criteria not complete
    return {
      continue: true, // Force continue
      stopReason: coreResult.message || 'Acceptance criteria not complete',
      hookSpecificOutput: {
        hookEventName: 'Stop',
        decision: 'block',
        reason: coreResult.message
      }
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
   */
  transformUserPromptSubmit(coreResult) {
    // Blocked - prevent prompt processing with clear message
    if (coreResult.blocked) {
      return {
        continue: false, // Block the prompt
        systemMessage: coreResult.message || 'Implementation request blocked by Wogi Flow',
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          decision: 'block',
          reason: coreResult.reason,
          suggestedAction: coreResult.suggestedAction
        }
      };
    }

    // Research protocol triggered - inject protocol steps as additional context
    if (coreResult.systemReminder) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: coreResult.systemReminder
        }
      };
    }

    // Warning - allow but show message
    if (coreResult.message && !coreResult.blocked) {
      return {
        continue: true,
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          decision: 'warn',
          reason: coreResult.reason
        }
      };
    }

    // Allowed
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit'
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
   * Transform TeammateIdle result (Claude Code 2.1.33+)
   */
  transformTeammateIdle(coreResult) {
    if (!coreResult.enabled) {
      return { continue: true };
    }

    if (coreResult.hasTask) {
      return {
        continue: true,
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          hookEventName: 'TeammateIdle',
          hasTask: true,
          suggestedTaskId: coreResult.suggestedTaskId
        }
      };
    }

    return {
      continue: true,
      ...(coreResult.message && { systemMessage: coreResult.message }),
      hookSpecificOutput: {
        hookEventName: 'TeammateIdle',
        hasTask: false
      }
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

    // Setup hook (Claude Code 2.1.10+ --init/--maintenance)
    if (rules.setup?.enabled !== false) {
      hooks.Setup = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'setup.js')}"`,
          timeout: HOOK_TIMEOUTS.SETUP
        }]
      }];
    }

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

    // Task gating for Edit/Write + TodoWrite gating
    if (rules.taskGating?.enabled !== false || rules.todoWriteGate?.enabled !== false) {
      preToolUseMatchers.push({
        matcher: 'Edit|Write|TodoWrite',
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

    // PostToolUse hooks for validation
    if (rules.validation?.enabled !== false) {
      hooks.PostToolUse = [{
        matcher: 'Edit|Write',
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

    // TeammateIdle hook for task dispatch (Claude Code 2.1.33+, experimental)
    if (rules.teammateIdle?.enabled === true) {
      hooks.TeammateIdle = [{
        hooks: [{
          type: 'command',
          command: `node "${path.join(scriptsDir, 'teammate-idle.js')}"`,
          timeout: HOOK_TIMEOUTS.TEAMMATE_IDLE
        }]
      }];
    }

    return { hooks };
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
