#!/usr/bin/env node

/**
 * Wogi Flow - OpenCode CLI Adapter
 *
 * Transforms core hook results to OpenCode's plugin format.
 * OpenCode supports native plugins that can BLOCK operations by throwing errors,
 * giving us hard enforcement capability similar to Claude Code hooks.
 *
 * Key differences from Claude Code:
 * - Uses throw to block (not permissionDecision: 'deny')
 * - Different event names (tool.execute.before vs PreToolUse)
 * - Plugin returns objects instead of JSON stdout
 */

const { BaseAdapter } = require('./base-adapter');

// ============================================================
// OpenCode Hook Events
// ============================================================

/**
 * OpenCode supported hook events
 */
const OPENCODE_EVENTS = [
  // Session lifecycle
  'session.start',
  'session.end',

  // Tool execution
  'tool.execute.before',
  'tool.execute.after',

  // Permissions
  'permission.request',
  'permission.grant',
  'permission.deny',

  // UI/Prompt
  'tui.prompt.append',
  'tui.render.before',
  'tui.render.after',

  // Agent
  'agent.start',
  'agent.stop',
  'agent.message'
];

// ============================================================
// OpenCode Adapter Class
// ============================================================

class OpenCodeAdapter extends BaseAdapter {
  constructor() {
    super('opencode');
  }

  /**
   * Get OpenCode's config path
   */
  getConfigPath() {
    return '.opencode/opencode.json';
  }

  /**
   * Get supported events
   */
  getSupportedEvents() {
    return OPENCODE_EVENTS;
  }

  /**
   * Check if OpenCode is likely available
   */
  isAvailable() {
    const fs = require('fs');
    return fs.existsSync('.opencode');
  }

  /**
   * Parse OpenCode plugin input
   * Normalizes input from various OpenCode hook contexts
   * SECURITY: Validates input types to prevent prototype pollution
   */
  parseInput(input) {
    // Helper for safe string extraction
    const safeString = (v, maxLen = 5000) =>
      (typeof v === 'string' && v.length <= maxLen) ? v : undefined;

    // Helper for safe object extraction
    const safeObject = (v) =>
      (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

    return {
      sessionId: safeString(input.session_id) || safeString(input.sessionId),
      toolName: safeString(input.tool_name) || safeString(input.toolName),
      toolInput: safeObject(input.tool_input) || safeObject(input.toolInput) || {},
      toolResponse: safeObject(input.tool_response) || safeObject(input.toolResponse),
      prompt: safeString(input.prompt, 100000), // Allow longer prompts
      source: safeString(input.source),
      reason: safeString(input.reason),
      cwd: safeString(input.cwd) || process.cwd()
    };
  }

  /**
   * Transform core result to OpenCode plugin format
   */
  transformResult(event, coreResult) {
    switch (event) {
      case 'session.start':
        return this.transformSessionStart(coreResult);
      case 'tool.execute.before':
        return this.transformPreToolUse(coreResult);
      case 'tool.execute.after':
        return this.transformPostToolUse(coreResult);
      case 'tui.prompt.append':
        return this.transformPromptAppend(coreResult);
      case 'session.end':
        return this.transformSessionEnd(coreResult);
      default:
        return {};
    }
  }

  /**
   * Transform SessionStart result
   * Injects WogiFlow context at session start
   */
  transformSessionStart(coreResult) {
    if (!coreResult.enabled || !coreResult.context) {
      return {};
    }

    // Format context for injection
    const { formatContextForInjection } = require('../core/session-context');
    const contextText = formatContextForInjection(coreResult);

    return {
      additionalContext: contextText
    };
  }

  /**
   * Transform PreToolUse result (task gating, component check)
   *
   * OpenCode uses throw to block, so we return an object with:
   * - block: true + error: string → caller should throw
   * - systemMessage: string → warning to show
   * - {} → allow silently
   */
  transformPreToolUse(coreResult) {
    // Blocked - OpenCode uses throw to block
    if (coreResult.blocked) {
      return {
        block: true,
        error: coreResult.message || 'Action blocked by WogiFlow'
      };
    }

    // Warning - allow but show message
    if (coreResult.warning && coreResult.message) {
      const result = {
        systemMessage: coreResult.message
      };

      // Include component context if available
      if (coreResult.contextBlock) {
        result.additionalContext = coreResult.contextBlock;
      }

      return result;
    }

    // Allowed
    return {};
  }

  /**
   * Transform PostToolUse result (validation)
   */
  transformPostToolUse(coreResult) {
    // If validation was skipped or passed
    if (coreResult.skipped || coreResult.passed) {
      const message = coreResult.summary || (coreResult.passed ? 'Validation passed' : null);
      return message ? { systemMessage: message } : {};
    }

    // Validation failed
    return {
      systemMessage: coreResult.summary || 'Validation failed',
      severity: coreResult.blocked ? 'error' : 'warning'
    };
  }

  /**
   * Transform prompt append result (research gate)
   */
  transformPromptAppend(coreResult) {
    // Research protocol triggered - inject protocol steps
    if (coreResult.injectProtocol && coreResult.protocolSteps) {
      return {
        additionalContext: coreResult.protocolSteps
      };
    }

    // Suggest research command
    if (coreResult.suggestedCommand) {
      return {
        additionalContext: `Research recommended: ${coreResult.suggestedCommand}`
      };
    }

    // Warning - show but don't inject protocol
    if (coreResult.warning && coreResult.message) {
      return {
        systemMessage: coreResult.message
      };
    }

    return {};
  }

  /**
   * Transform SessionEnd result
   */
  transformSessionEnd(coreResult) {
    // SessionEnd doesn't block, just provides info
    const result = {};

    if (coreResult.warning) {
      result.systemMessage = coreResult.warning;
    }

    if (coreResult.logged) {
      result.systemMessage = `Logged as ${coreResult.requestId}`;
    }

    return result;
  }

  /**
   * Generate OpenCode plugin configuration
   * This is used when setting up hooks via the bridge
   */
  generateConfig(rules, _projectRoot) {
    // OpenCode plugins use a different structure than Claude Code hooks
    // The plugin file itself handles all events
    return {
      plugins: {
        wogiflow: {
          enabled: true,
          path: './.opencode/plugins/wogiflow.js',
          events: this.getEnabledEvents(rules)
        }
      }
    };
  }

  /**
   * Get list of enabled events based on rules
   */
  getEnabledEvents(rules) {
    const events = [];

    if (rules.sessionContext?.enabled !== false) {
      events.push('session.start');
    }

    if (rules.taskGating?.enabled !== false || rules.componentCheck?.enabled !== false) {
      events.push('tool.execute.before');
    }

    if (rules.validation?.enabled !== false) {
      events.push('tool.execute.after');
    }

    if (rules.researchGate?.enabled !== false) {
      events.push('tui.prompt.append');
    }

    if (rules.autoLogging?.enabled !== false) {
      events.push('session.end');
    }

    return events;
  }

  /**
   * Get install instructions
   */
  getInstallInstructions() {
    return `OpenCode hooks installed via WogiFlow plugin at .opencode/plugins/wogiflow.js

To use:
1. Run: flow bridge sync opencode
2. OpenCode automatically loads plugins from .opencode/plugins/

To remove:
- Delete .opencode/plugins/wogiflow.js
- Or set enabled: false in .opencode/opencode.json`;
  }
}

// ============================================================
// Exports
// ============================================================

// Singleton instance
const opencodeAdapter = new OpenCodeAdapter();

module.exports = {
  OpenCodeAdapter,
  opencodeAdapter,
  OPENCODE_EVENTS
};
