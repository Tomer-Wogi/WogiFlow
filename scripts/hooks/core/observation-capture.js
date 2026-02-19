#!/usr/bin/env node

/**
 * Wogi Flow - Observation Capture (Core Module)
 *
 * Automatically captures tool uses for memory system.
 * Every tool execution is recorded with smart summarization.
 *
 * Part of v10.0 - Automatic Memory Enhancement
 * Updated v10.1 - Code review fixes (validation, config caching, DRY)
 */

const path = require('path');

// ============================================================
// Constants
// ============================================================

const DEFAULTS = {
  MAX_INPUT_SIZE: 2000,
  MAX_OUTPUT_SIZE: 2000,
  ENABLED: true,
  SKIP_TOOLS: []
};

// ============================================================
// Lazy-loaded Dependencies (avoid circular imports)
// ============================================================

// Import from parent scripts directory
const { getConfig } = require('../../flow-utils');

// Lazy-load memory-db to avoid circular dependencies
let memoryDb = null;
function getMemoryDb() {
  if (!memoryDb) {
    memoryDb = require('../../flow-memory-db');
  }
  return memoryDb;
}

// Lazy-load memory-blocks for current task
let memoryBlocks = null;
function getMemoryBlocks() {
  if (!memoryBlocks) {
    memoryBlocks = require('../../flow-memory-blocks');
  }
  return memoryBlocks;
}

// ============================================================
// Configuration Helpers (consolidated - single config read)
// ============================================================

/**
 * Get observation capture settings from config
 * Consolidates multiple getConfig() calls into a single read
 * @returns {Object} - Observation capture settings
 */
function getObservationSettings() {
  const config = getConfig();
  const obsConfig = config.automaticMemory?.observationCapture || {};
  return {
    enabled: obsConfig.enabled !== false,
    skipTools: obsConfig.skipTools || DEFAULTS.SKIP_TOOLS,
    maxInputSize: obsConfig.maxInputSize || DEFAULTS.MAX_INPUT_SIZE,
    maxOutputSize: obsConfig.maxOutputSize || DEFAULTS.MAX_OUTPUT_SIZE
  };
}

/**
 * Check if observation capture is enabled
 * @returns {boolean}
 */
function isObservationCaptureEnabled() {
  return getObservationSettings().enabled;
}

/**
 * Check if a tool should be skipped
 * @param {string} toolName - Name of the tool
 * @returns {boolean}
 */
function shouldSkipTool(toolName) {
  if (!toolName || typeof toolName !== 'string') return true;
  return getObservationSettings().skipTools.includes(toolName);
}

/**
 * Get max input size from config
 * @returns {number}
 */
function getMaxInputSize() {
  return getObservationSettings().maxInputSize;
}

/**
 * Get max output size from config
 * @returns {number}
 */
function getMaxOutputSize() {
  return getObservationSettings().maxOutputSize;
}

// ============================================================
// Smart Summarization
// ============================================================

/**
 * Summarize tool input based on tool type
 * @param {string} toolName - Name of the tool
 * @param {Object} toolInput - Tool input object
 * @returns {string} - Compact summary
 */
function summarizeInput(toolName, toolInput) {
  if (!toolInput) return `${toolName}: (no input)`;

  try {
    switch (toolName) {
      case 'Edit':
        return `Edit ${toolInput.file_path || 'unknown'}: "${(toolInput.old_string || '').slice(0, 30)}..." → "${(toolInput.new_string || '').slice(0, 30)}..."`;

      case 'Write':
        return `Write ${toolInput.file_path || 'unknown'} (${(toolInput.content || '').length} chars)`;

      case 'Bash':
        return `Bash: ${(toolInput.command || '').slice(0, 80)}${(toolInput.command || '').length > 80 ? '...' : ''}`;

      case 'Read':
        return `Read ${toolInput.file_path || 'unknown'}${toolInput.offset ? ` (offset: ${toolInput.offset})` : ''}`;

      case 'Glob':
        return `Glob "${toolInput.pattern || ''}"${toolInput.path ? ` in ${toolInput.path}` : ''}`;

      case 'Grep':
        return `Grep "${toolInput.pattern || ''}"${toolInput.path ? ` in ${toolInput.path}` : ''}`;

      case 'WebFetch':
        return `WebFetch ${toolInput.url || 'unknown'}`;

      case 'WebSearch':
        return `WebSearch "${toolInput.query || ''}"`;

      case 'Task':
        return `Task [${toolInput.subagent_type || 'unknown'}]: ${(toolInput.description || toolInput.prompt || '').slice(0, 50)}`;

      case 'AskUserQuestion':
        const firstQ = (toolInput.questions || [])[0];
        return `AskUserQuestion: ${firstQ?.question?.slice(0, 50) || 'no question'}`;

      case 'Skill':
        return `Skill: ${toolInput.skill || 'unknown'}${toolInput.args ? ` (${toolInput.args.slice(0, 30)})` : ''}`;

      default:
        // Generic summarization
        const inputStr = JSON.stringify(toolInput);
        return `${toolName}: ${inputStr.slice(0, 60)}${inputStr.length > 60 ? '...' : ''}`;
    }
  } catch (err) {
    return `${toolName}: (summarization failed)`;
  }
}

/**
 * Summarize tool output based on tool type
 * @param {string} toolName - Name of the tool
 * @param {*} toolResponse - Tool response
 * @param {boolean} success - Whether the tool succeeded
 * @returns {string} - Compact summary
 */
function summarizeOutput(toolName, toolResponse, success) {
  if (!success) {
    const errMsg = typeof toolResponse === 'string'
      ? toolResponse
      : (toolResponse?.error || toolResponse?.message || 'Unknown error');
    return `Failed: ${String(errMsg).slice(0, 80)}`;
  }

  if (!toolResponse) return 'Completed (no output)';

  try {
    const responseStr = typeof toolResponse === 'string'
      ? toolResponse
      : JSON.stringify(toolResponse);

    switch (toolName) {
      case 'Edit':
        return 'Edit applied successfully';

      case 'Write':
        return 'File written successfully';

      case 'Bash': {
        const lines = responseStr.split('\n').filter(l => l.trim());
        if (lines.length === 0) return 'Completed (no output)';
        if (lines.length === 1) return `Output: ${lines[0].slice(0, 80)}`;
        return `Output: ${lines[0].slice(0, 50)}... (${lines.length} lines)`;
      }

      case 'Read': {
        const lineCount = (responseStr.match(/\n/g) || []).length + 1;
        return `Read ${responseStr.length} chars, ${lineCount} lines`;
      }

      case 'Glob': {
        const fileCount = (responseStr.match(/\n/g) || []).length + (responseStr.trim() ? 1 : 0);
        return `Found ${fileCount} file(s)`;
      }

      case 'Grep': {
        const matchCount = (responseStr.match(/\n/g) || []).length;
        return `${matchCount} match(es)`;
      }

      case 'WebFetch':
        return `Fetched ${responseStr.length} chars`;

      case 'WebSearch':
        return `Search completed`;

      case 'Task':
        return `Task completed (${responseStr.length} chars output)`;

      case 'AskUserQuestion':
        return 'Question presented to user';

      default:
        return `Completed: ${responseStr.slice(0, 60)}${responseStr.length > 60 ? '...' : ''}`;
    }
  } catch (err) {
    return 'Completed (summarization failed)';
  }
}

// ============================================================
// Main Capture Function
// ============================================================

/**
 * Capture an observation (tool use)
 * Non-blocking - never fails the calling hook
 *
 * @param {Object} options
 * @param {string} options.sessionId - Session ID
 * @param {string} options.toolName - Name of the tool
 * @param {Object} options.toolInput - Tool input
 * @param {*} options.toolResponse - Tool response
 * @param {number} options.duration - Duration in ms
 * @returns {Promise<Object>} - { stored, skipped, id? }
 */
async function captureObservation(options) {
  // Input validation - fail fast if options is invalid
  if (!options || typeof options !== 'object') {
    return { skipped: true, reason: 'invalid_options' };
  }

  const { sessionId, toolName, toolInput, toolResponse, duration, explorationStatus, rejectionReason } = options;

  // Validate required fields
  if (!toolName || typeof toolName !== 'string') {
    return { skipped: true, reason: 'missing_tool_name' };
  }

  try {
    // Check if capture is enabled
    if (!isObservationCaptureEnabled()) {
      return { skipped: true, reason: 'capture_disabled' };
    }

    // Check if tool should be skipped
    if (shouldSkipTool(toolName)) {
      return { skipped: true, reason: 'tool_in_skip_list' };
    }

    // Determine success - handle various response formats safely
    const success = !(
      toolResponse?.error ||
      toolResponse?.isError ||
      (typeof toolResponse === 'string' && toolResponse.toLowerCase().startsWith('error:'))
    );

    // Get current task if any
    let contextTaskId = null;
    try {
      const blocks = getMemoryBlocks();
      const currentTask = blocks.getCurrentTask();
      contextTaskId = currentTask?.id || null;
    } catch (err) {
      // Ignore - task context is optional
    }

    // Generate summaries
    const inputSummary = summarizeInput(toolName, toolInput);
    const outputSummary = summarizeOutput(toolName, toolResponse, success);

    // Truncate full content to config limits
    const maxInputSize = getMaxInputSize();
    const maxOutputSize = getMaxOutputSize();

    let fullInput = null;
    try {
      fullInput = JSON.stringify(toolInput);
      if (fullInput.length > maxInputSize) {
        fullInput = fullInput.slice(0, maxInputSize) + '...[truncated]';
      }
    } catch (err) {
      fullInput = '[serialization failed]';
    }

    let fullOutput = null;
    try {
      fullOutput = typeof toolResponse === 'string'
        ? toolResponse
        : JSON.stringify(toolResponse);
      if (fullOutput.length > maxOutputSize) {
        fullOutput = fullOutput.slice(0, maxOutputSize) + '...[truncated]';
      }
    } catch (err) {
      fullOutput = '[serialization failed]';
    }

    // Store observation
    const db = getMemoryDb();
    const result = await db.storeObservation({
      sessionId: sessionId || 'unknown',
      toolName,
      inputSummary,
      outputSummary,
      fullInput,
      fullOutput,
      success: success ? 1 : 0,
      durationMs: duration,
      contextTaskId,
      explorationStatus: explorationStatus || (success ? null : 'rejected'),
      rejectionReason: rejectionReason || (!success ? (outputSummary || '').slice(0, 500) : null)
    });

    return { stored: true, id: result.id };

  } catch (err) {
    // Non-blocking - log error but don't fail
    if (process.env.DEBUG) {
      console.error(`[observation-capture] Error: ${err.message}`);
    }
    return { skipped: true, reason: 'capture_error', error: err.message };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  isObservationCaptureEnabled,
  shouldSkipTool,
  getMaxInputSize,
  getMaxOutputSize,

  // Summarization
  summarizeInput,
  summarizeOutput,

  // Main capture function
  captureObservation
};
