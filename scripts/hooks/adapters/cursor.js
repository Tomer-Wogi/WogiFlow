#!/usr/bin/env node

/**
 * Wogi Flow - Cursor IDE Adapter
 *
 * Transforms core hook results to Cursor's hook format.
 *
 * KEY DIFFERENCES FROM CLAUDE CODE:
 * - Uses `continue: false` to block (not `permissionDecision: deny`)
 * - Uses `permission: deny` for shell/MCP hooks
 * - `afterFileEdit` CANNOT block - notification only
 * - No `preToolUse` equivalent - must gate at prompt level
 */

const path = require('path');
const { BaseAdapter } = require('./base-adapter');

// ============================================================
// Cursor Hook Events
// ============================================================

/**
 * Cursor supported hook events
 */
const CURSOR_EVENTS = [
  // Session lifecycle
  'sessionStart',
  'sessionEnd',

  // Prompt submission
  'beforeSubmitPrompt',

  // Shell execution
  'beforeShellExecution',
  'afterShellExecution',

  // MCP tools
  'beforeMCPExecution',
  'afterMCPExecution',

  // File operations
  'beforeReadFile',
  'afterFileEdit',

  // Completion
  'stop',
  'afterAgentResponse',
  'afterAgentThought',

  // Subagent
  'subagentStart',
  'subagentStop',

  // Context
  'preCompact'
];

// ============================================================
// Cursor Adapter Class
// ============================================================

class CursorAdapter extends BaseAdapter {
  constructor() {
    super('cursor');
  }

  /**
   * Get Cursor's config path
   */
  getConfigPath() {
    return '.cursor/hooks.json';
  }

  /**
   * Get supported events
   */
  getSupportedEvents() {
    return CURSOR_EVENTS;
  }

  /**
   * Check if Cursor is likely available
   */
  isAvailable() {
    const fs = require('fs');
    return fs.existsSync('.cursor');
  }

  /**
   * Parse Cursor hook input
   * SECURITY: Validates input types to prevent prototype pollution and path traversal
   */
  parseInput(input) {
    // Helper for safe string extraction
    const safeString = (v, maxLen = 5000) =>
      (typeof v === 'string' && v.length <= maxLen) ? v : undefined;

    // Helper for safe object extraction with RECURSIVE prototype pollution check
    // Returns { safe: true, value: obj } or { safe: false } to distinguish rejection from empty object
    const safeObjectInner = (v, depth = 0) => {
      // Prevent deep recursion DoS
      if (depth > 10) return { safe: false };
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { safe: false };

      // Check if prototype was tampered with (object literal with __proto__ sets prototype)
      const proto = Object.getPrototypeOf(v);
      if (proto !== null && proto !== Object.prototype) {
        return { safe: false }; // Prototype pollution via __proto__ literal
      }

      // Block prototype pollution keys (covers JSON.parse case where __proto__ is own property)
      const dangerous = ['__proto__', 'constructor', 'prototype'];

      // Use Object.getOwnPropertyNames to catch non-enumerable own properties too
      const keys = Object.getOwnPropertyNames(v);
      for (const key of keys) {
        if (dangerous.includes(key)) {
          return { safe: false };
        }
        // Recursively check nested objects
        if (v[key] && typeof v[key] === 'object' && !Array.isArray(v[key])) {
          const nested = safeObjectInner(v[key], depth + 1);
          if (!nested.safe) {
            // Nested object was rejected - reject parent too
            return { safe: false };
          }
        }
      }
      return { safe: true, value: v };
    };

    // Wrapper that returns the value or empty object
    const safeObject = (v) => {
      const result = safeObjectInner(v, 0);
      return result.safe ? result.value : {};
    };

    // Helper to validate array elements (strings only, with length limit)
    // Note: This is for PATH arrays (attachments, workspace roots) so we block traversal
    const safeStringArray = (arr, maxLen = 5000, maxItems = 100) => {
      if (!Array.isArray(arr)) return [];
      return arr
        .slice(0, maxItems)
        .filter(item =>
          typeof item === 'string' &&
          item.length <= maxLen &&
          !item.includes('..') &&   // Block path traversal
          !item.includes('\0')      // Block null byte injection
        );
    };

    // Helper for safe path extraction with traversal check
    // Returns the RESOLVED path for security, not the original string
    const safePath = (v, maxLen = 5000) => {
      const str = safeString(v, maxLen);
      if (!str) return undefined;
      // Block obvious path traversal attempts
      if (str.includes('..') || str.includes('\0')) {
        return undefined;
      }
      // Additional bounds check: ensure path is within cwd
      try {
        const projectRoot = path.resolve(process.cwd());
        const resolvedPath = path.resolve(projectRoot, str);
        if (!resolvedPath.startsWith(projectRoot + path.sep) && resolvedPath !== projectRoot) {
          // Allow exact match to project root, but not escaping it
          return undefined;
        }
        // Return resolved path for security (not original string)
        return resolvedPath;
      } catch {
        return undefined;
      }
    };

    return {
      // Session info
      conversationId: safeString(input.conversation_id),
      generationId: safeString(input.generation_id),

      // Prompt hooks
      prompt: safeString(input.prompt, 100000), // Allow longer prompts

      // Shell hooks
      command: safeString(input.command, 10000),
      cwd: safeString(input.cwd) || process.cwd(),

      // File hooks - use safePath for path traversal protection (returns resolved path)
      filePath: safePath(input.file_path),
      oldContent: safeString(input.old_string, 10000000), // Allow large files
      newContent: safeString(input.new_string, 10000000),

      // MCP hooks
      mcpServer: safeString(input.mcp_server),
      toolName: safeString(input.tool_name),
      toolInput: safeObject(input.tool_input),

      // Attachments - validate as string array
      attachments: safeStringArray(input.attachments),

      // Workspace - validate as string array with path safety
      workspaceRoots: safeStringArray(input.workspace_roots),

      // Stop hook
      status: safeString(input.status),
      loopCount: typeof input.loop_count === 'number' ? input.loop_count : 0
    };
  }

  /**
   * Transform core result to Cursor hook format
   */
  transformResult(event, coreResult) {
    switch (event) {
      case 'sessionStart':
        return this.transformSessionStart(coreResult);
      case 'beforeSubmitPrompt':
        return this.transformPromptGate(coreResult);
      case 'beforeShellExecution':
        return this.transformShellGate(coreResult);
      case 'beforeMCPExecution':
        return this.transformMCPGate(coreResult);
      case 'afterFileEdit':
        return this.transformPostEdit(coreResult);
      case 'stop':
        return this.transformStop(coreResult);
      default:
        return {};
    }
  }

  /**
   * Transform SessionStart result
   * Injects context at session start
   */
  transformSessionStart(coreResult) {
    if (!coreResult.enabled || !coreResult.context) {
      return {};
    }

    // Format context for injection
    const { formatContextForInjection } = require('../core/session-context');
    const contextText = formatContextForInjection(coreResult);

    return {
      additional_context: contextText,
      env: {} // Optional environment variables
    };
  }

  /**
   * Transform prompt gate result (beforeSubmitPrompt)
   * PRIMARY ENFORCEMENT for Cursor - blocks implementation requests
   *
   * Cursor format:
   * - { continue: false, user_message: "..." } to block
   * - { continue: true } to allow
   */
  transformPromptGate(coreResult) {
    if (coreResult.blocked) {
      return {
        continue: false,
        user_message: coreResult.message || 'Implementation request blocked. Run /wogi-start first.'
      };
    }

    // Warning - allow but show message
    if (coreResult.warning && coreResult.message) {
      return {
        continue: true,
        user_message: coreResult.message
      };
    }

    return { continue: true };
  }

  /**
   * Transform shell gate result (beforeShellExecution)
   * Enforces strict adherence for shell commands
   *
   * Cursor format:
   * - { permission: "deny", userMessage: "...", agentMessage: "..." } to block
   * - { permission: "allow" } to allow
   */
  transformShellGate(coreResult) {
    if (coreResult.blocked) {
      return {
        permission: 'deny',
        userMessage: coreResult.message || 'Command blocked by WogiFlow',
        agentMessage: coreResult.agentMessage || coreResult.message || 'This command violates project standards.'
      };
    }

    return { permission: 'allow' };
  }

  /**
   * Transform MCP gate result (beforeMCPExecution)
   * Same format as shell gate
   */
  transformMCPGate(coreResult) {
    if (coreResult.blocked) {
      const message = coreResult.message || 'MCP tool blocked by WogiFlow';
      return {
        permission: 'deny',
        userMessage: message,
        agentMessage: coreResult.agentMessage || message
      };
    }

    return { permission: 'allow' };
  }

  /**
   * Transform post-edit result (afterFileEdit)
   * NOTE: This hook CANNOT block - it's notification only
   * Output is logged but does not affect agent behavior
   */
  transformPostEdit(coreResult) {
    // Log validation results but cannot block
    if (coreResult.summary) {
      // Return empty - Cursor doesn't support output from afterFileEdit
      // We log to stderr for visibility instead
      if (!coreResult.passed) {
        console.error(`[WogiFlow] Validation: ${coreResult.summary}`);
      }
    }

    return {};
  }

  /**
   * Transform stop result
   * Can provide followup message for loop continuation
   */
  transformStop(coreResult) {
    if (coreResult.followupMessage) {
      return {
        followup_message: coreResult.followupMessage
      };
    }

    return {};
  }

  /**
   * Generate Cursor hook configuration
   */
  generateConfig(rules, projectRoot) {
    const path = require('path');
    const entryDir = path.join(projectRoot, 'scripts', 'hooks', 'entry', 'cursor');

    const hooks = {
      version: 1,
      hooks: {}
    };

    // sessionStart - always enabled
    hooks.hooks.sessionStart = [{
      command: `node "${path.join(entryDir, 'session-start.js')}"`
    }];

    // beforeSubmitPrompt - prompt gating (primary enforcement)
    if (rules.implementationGate?.enabled !== false) {
      hooks.hooks.beforeSubmitPrompt = [{
        command: `node "${path.join(entryDir, 'before-submit-prompt.js')}"`
      }];
    }

    // beforeShellExecution - strict adherence
    if (rules.strictAdherence?.enabled !== false) {
      hooks.hooks.beforeShellExecution = [{
        command: `node "${path.join(entryDir, 'before-shell.js')}"`
      }];
    }

    // afterFileEdit - validation (cannot block)
    if (rules.validation?.enabled !== false) {
      hooks.hooks.afterFileEdit = [{
        command: `node "${path.join(entryDir, 'after-file-edit.js')}"`
      }];
    }

    // stop - session end
    hooks.hooks.stop = [{
      command: `node "${path.join(entryDir, 'stop.js')}"`
    }];

    return hooks;
  }

  /**
   * Get install instructions
   */
  getInstallInstructions() {
    return `Cursor hooks installed at .cursor/hooks.json

To use:
1. Run: flow bridge sync cursor
2. Cursor automatically loads hooks from .cursor/hooks.json

To remove:
- Delete .cursor/hooks.json
- Or remove specific hooks from the file

Note: Cursor hooks are in beta - APIs may change.`;
  }
}

// ============================================================
// Exports
// ============================================================

const cursorAdapter = new CursorAdapter();

module.exports = {
  CursorAdapter,
  cursorAdapter,
  CURSOR_EVENTS
};
