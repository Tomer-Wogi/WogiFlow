#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI Adapter
 *
 * Transforms core hook results to Gemini CLI's hook format.
 * Handles SessionStart, BeforeAgent, BeforeTool, AfterTool, SessionEnd.
 *
 * Gemini CLI Hook Documentation:
 * - Input: JSON via stdin with session_id, cwd, hook_event_name, etc.
 * - Output: JSON with decision (allow/deny), reason, hookSpecificOutput
 * - Exit codes: 0 = success, 2 = system block, other = warning
 */

const path = require('path');
const { BaseAdapter } = require('./base-adapter');

// Import from parent scripts directory
let PATHS;
try {
  PATHS = require('../../flow-utils').PATHS;
} catch (err) {
  // Fallback paths
  PATHS = {
    root: process.cwd(),
    gemini: path.join(process.cwd(), '.gemini')
  };
}

// ============================================================
// Hook Timeout Constants (in milliseconds)
// ============================================================

const HOOK_TIMEOUTS = {
  SESSION_START: 10000,
  BEFORE_AGENT: 5000,
  BEFORE_TOOL: 5000,
  AFTER_TOOL: 60000,
  SESSION_END: 10000
};

/**
 * Gemini CLI Hook Events
 * Based on Gemini CLI hooks documentation
 */
const GEMINI_CLI_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeAgent',
  'AfterAgent',
  'BeforeTool',
  'AfterTool',
  'BeforeModel',
  'AfterModel',
  'Notification'
];

/**
 * Gemini CLI Adapter
 */
class GeminiAdapter extends BaseAdapter {
  constructor() {
    super('gemini-cli');
  }

  /**
   * Get Gemini CLI's settings path
   */
  getConfigPath() {
    return path.join(PATHS.gemini || path.join(process.cwd(), '.gemini'), 'settings.json');
  }

  /**
   * Get supported events
   */
  getSupportedEvents() {
    return GEMINI_CLI_EVENTS;
  }

  /**
   * Check if Gemini CLI is likely available
   */
  isAvailable() {
    const fs = require('fs');
    const geminiDir = PATHS.gemini || path.join(process.cwd(), '.gemini');
    return fs.existsSync(geminiDir);
  }

  /**
   * Parse Gemini CLI hook input
   * Normalizes Gemini CLI input format to internal format
   */
  parseInput(input) {
    return {
      sessionId: input.session_id,
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      hookEvent: input.hook_event_name,
      timestamp: input.timestamp,

      // BeforeTool/AfterTool specific
      toolName: input.tool_name,
      toolInput: input.tool_input,
      toolResponse: input.tool_response,
      mcpContext: input.mcp_context,

      // BeforeAgent specific
      prompt: input.prompt,

      // SessionStart specific
      source: input.source
    };
  }

  /**
   * Transform core result to Gemini CLI format
   * @param {string} event - Event name
   * @param {Object} coreResult - Result from core module
   * @returns {Object} Gemini CLI formatted response
   */
  transformResult(event, coreResult) {
    switch (event) {
      case 'SessionStart':
        return this.transformSessionStart(coreResult);
      case 'BeforeAgent':
        return this.transformBeforeAgent(coreResult);
      case 'BeforeTool':
        return this.transformBeforeTool(coreResult);
      case 'AfterTool':
        return this.transformAfterTool(coreResult);
      case 'SessionEnd':
        return this.transformSessionEnd(coreResult);
      default:
        return { continue: true, decision: 'allow' };
    }
  }

  /**
   * Transform SessionStart result
   * Injects workflow context at session start
   */
  transformSessionStart(coreResult) {
    if (!coreResult.enabled || !coreResult.context) {
      return { continue: true, decision: 'allow' };
    }

    // Format context for injection
    const { formatContextForInjection } = require('../core/session-context');
    const contextText = formatContextForInjection(coreResult);

    return {
      continue: true,
      decision: 'allow',
      hookSpecificOutput: {
        additionalContext: contextText
      }
    };
  }

  /**
   * Transform BeforeAgent result (equivalent to UserPromptSubmit)
   * Implementation gate - checks if request should be routed through workflow
   */
  transformBeforeAgent(coreResult) {
    // Blocked - deny the prompt
    if (coreResult.blocked) {
      return {
        continue: false,
        decision: 'deny',
        reason: coreResult.message || 'Implementation request blocked by Wogi Flow',
        hookSpecificOutput: {
          suggestedAction: coreResult.suggestedAction
        }
      };
    }

    // Warning - allow but inject context
    if (coreResult.message && !coreResult.blocked) {
      return {
        continue: true,
        decision: 'allow',
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          additionalContext: coreResult.message
        }
      };
    }

    // Allowed
    return { continue: true, decision: 'allow' };
  }

  /**
   * Transform BeforeTool result (equivalent to PreToolUse)
   * Task gating, scope validation, component reuse check
   */
  transformBeforeTool(coreResult) {
    // Blocked - deny permission
    if (coreResult.blocked) {
      return {
        continue: false,
        decision: 'deny',
        reason: coreResult.message || 'Action blocked by Wogi Flow',
        hookSpecificOutput: {
          reason: coreResult.reason
        }
      };
    }

    // Warning - allow but show message
    if (coreResult.warning && coreResult.message) {
      return {
        continue: true,
        decision: 'allow',
        systemMessage: coreResult.message,
        hookSpecificOutput: {
          additionalContext: coreResult.contextBlock || coreResult.message
        }
      };
    }

    // Allowed
    return { continue: true, decision: 'allow' };
  }

  /**
   * Transform AfterTool result (equivalent to PostToolUse)
   * Validation results after file edit
   */
  transformAfterTool(coreResult) {
    // Validation skipped or passed
    if (coreResult.skipped || coreResult.passed) {
      const message = coreResult.summary || (coreResult.passed ? 'Validation passed' : null);
      return {
        continue: true,
        decision: 'allow',
        ...(message && { systemMessage: message })
      };
    }

    // Validation failed
    return {
      continue: true,
      decision: 'allow', // Don't block on validation failure, just warn
      systemMessage: coreResult.summary || 'Validation failed',
      hookSpecificOutput: {
        validationFailed: true,
        reason: coreResult.message
      }
    };
  }

  /**
   * Transform SessionEnd result
   * Auto-logging and cleanup
   */
  transformSessionEnd(coreResult) {
    return {
      continue: true,
      decision: 'allow',
      ...(coreResult.warning && { systemMessage: coreResult.warning }),
      ...(coreResult.logged && { systemMessage: `Logged as ${coreResult.requestId}` })
    };
  }

  /**
   * Generate Gemini CLI hook configuration
   * Creates the hooks section for settings.json
   */
  generateConfig(rules, projectRoot) {
    const scriptsDir = path.join(projectRoot, 'scripts', 'hooks', 'entry', 'gemini-cli');
    const hooks = {};

    // SessionStart hook
    if (rules.sessionContext?.enabled !== false) {
      hooks.SessionStart = [{
        hooks: [{
          name: 'wogi-session-start',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'session-start.js')}"`,
          timeout: HOOK_TIMEOUTS.SESSION_START
        }]
      }];
    }

    // BeforeAgent hook (implementation gate)
    if (rules.implementationGate?.enabled !== false) {
      hooks.BeforeAgent = [{
        hooks: [{
          name: 'wogi-implementation-gate',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'before-agent.js')}"`,
          timeout: HOOK_TIMEOUTS.BEFORE_AGENT
        }]
      }];
    }

    // BeforeTool hooks for write operations
    if (rules.taskGating?.enabled !== false) {
      hooks.BeforeTool = [{
        matcher: 'write_file|replace|edit_file',
        hooks: [{
          name: 'wogi-tool-gate',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'before-tool.js')}"`,
          timeout: HOOK_TIMEOUTS.BEFORE_TOOL
        }]
      }];
    }

    // AfterTool hooks for validation
    if (rules.validation?.enabled !== false) {
      hooks.AfterTool = [{
        matcher: 'write_file|replace|edit_file',
        hooks: [{
          name: 'wogi-validation',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'after-tool.js')}"`,
          timeout: HOOK_TIMEOUTS.AFTER_TOOL
        }]
      }];
    }

    // SessionEnd hook
    if (rules.autoLogging?.enabled !== false) {
      hooks.SessionEnd = [{
        hooks: [{
          name: 'wogi-session-end',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'session-end.js')}"`,
          timeout: HOOK_TIMEOUTS.SESSION_END
        }]
      }];
    }

    return { hooksConfig: { enabled: true }, hooks };
  }

  /**
   * Get install instructions for Gemini CLI
   */
  getInstallInstructions() {
    return `Gemini CLI hooks will be installed to ${this.getConfigPath()}

To use:
1. Run: ./scripts/flow bridge sync
2. Ensure cli.type is set to "gemini-cli" in .workflow/config.json
3. Hooks are automatically loaded by Gemini CLI

To verify:
- Run: gemini --version
- Check: .gemini/settings.json for hooks configuration

To remove:
- Delete hooks section from .gemini/settings.json
- Or set hooksConfig.enabled to false`;
  }
}

// Export singleton instance
const geminiAdapter = new GeminiAdapter();

module.exports = {
  GeminiAdapter,
  geminiAdapter,
  GEMINI_CLI_EVENTS,
  HOOK_TIMEOUTS
};
