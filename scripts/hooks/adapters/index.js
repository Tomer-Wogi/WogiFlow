#!/usr/bin/env node

/**
 * Wogi Flow - Adapters Index
 *
 * Registry of all CLI adapters.
 */

const { BaseAdapter, CoreResultSchema } = require('./base-adapter');
const { ClaudeCodeAdapter, claudeCodeAdapter, CLAUDE_CODE_EVENTS } = require('./claude-code');

// Lazy-load Gemini adapter to avoid errors if not installed
let geminiAdapter = null;
let GeminiAdapter = null;
let GEMINI_CLI_EVENTS = null;

try {
  const geminiModule = require('./gemini');
  geminiAdapter = geminiModule.geminiAdapter;
  GeminiAdapter = geminiModule.GeminiAdapter;
  GEMINI_CLI_EVENTS = geminiModule.GEMINI_CLI_EVENTS;
} catch (err) {
  // Gemini adapter not available - that's OK
  if (process.env.DEBUG) {
    console.error(`[Adapters] Gemini adapter not loaded: ${err.message}`);
  }
}

// Lazy-load OpenCode adapter to avoid errors if not installed
let opencodeAdapter = null;
let OpenCodeAdapter = null;
let OPENCODE_EVENTS = null;

try {
  const opencodeModule = require('./opencode');
  opencodeAdapter = opencodeModule.opencodeAdapter;
  OpenCodeAdapter = opencodeModule.OpenCodeAdapter;
  OPENCODE_EVENTS = opencodeModule.OPENCODE_EVENTS;
} catch (err) {
  // OpenCode adapter not available - that's OK
  if (process.env.DEBUG) {
    console.error(`[Adapters] OpenCode adapter not loaded: ${err.message}`);
  }
}

// Lazy-load Cursor adapter to avoid errors if not installed
let cursorAdapter = null;
let CursorAdapter = null;
let CURSOR_EVENTS = null;

try {
  const cursorModule = require('./cursor');
  cursorAdapter = cursorModule.cursorAdapter;
  CursorAdapter = cursorModule.CursorAdapter;
  CURSOR_EVENTS = cursorModule.CURSOR_EVENTS;
} catch (err) {
  // Cursor adapter not available - that's OK
  if (process.env.DEBUG) {
    console.error(`[Adapters] Cursor adapter not loaded: ${err.message}`);
  }
}

/**
 * Adapter registry
 */
const adapters = {
  'claude-code': claudeCodeAdapter
};

// Register Gemini if available
if (geminiAdapter) {
  adapters['gemini-cli'] = geminiAdapter;
}

// Register OpenCode if available
if (opencodeAdapter) {
  adapters['opencode'] = opencodeAdapter;
}

// Register Cursor if available
if (cursorAdapter) {
  adapters['cursor'] = cursorAdapter;
}

/**
 * Get adapter by name
 * @param {string} name - Adapter name
 * @returns {BaseAdapter|null}
 */
function getAdapter(name) {
  return adapters[name] || null;
}

/**
 * Get all available adapters
 * @returns {Object} Map of adapter name to instance
 */
function getAllAdapters() {
  return { ...adapters };
}

/**
 * Get adapters that are available (CLI installed)
 * @returns {Object} Map of available adapters
 */
function getAvailableAdapters() {
  const available = {};
  for (const [name, adapter] of Object.entries(adapters)) {
    if (adapter.isAvailable()) {
      available[name] = adapter;
    }
  }
  return available;
}

/**
 * Register a new adapter
 * @param {string} name - Adapter name
 * @param {BaseAdapter} adapter - Adapter instance
 */
function registerAdapter(name, adapter) {
  if (!(adapter instanceof BaseAdapter)) {
    throw new Error('Adapter must extend BaseAdapter');
  }
  adapters[name] = adapter;
}

module.exports = {
  // Classes
  BaseAdapter,
  ClaudeCodeAdapter,
  CoreResultSchema,

  // Instances
  claudeCodeAdapter,

  // Constants
  CLAUDE_CODE_EVENTS,

  // Functions
  getAdapter,
  getAllAdapters,
  getAvailableAdapters,
  registerAdapter
};

// Conditionally export Gemini if available
if (GeminiAdapter) {
  module.exports.GeminiAdapter = GeminiAdapter;
}
if (geminiAdapter) {
  module.exports.geminiAdapter = geminiAdapter;
}
if (GEMINI_CLI_EVENTS) {
  module.exports.GEMINI_CLI_EVENTS = GEMINI_CLI_EVENTS;
}

// Conditionally export OpenCode if available
if (OpenCodeAdapter) {
  module.exports.OpenCodeAdapter = OpenCodeAdapter;
}
if (opencodeAdapter) {
  module.exports.opencodeAdapter = opencodeAdapter;
}
if (OPENCODE_EVENTS) {
  module.exports.OPENCODE_EVENTS = OPENCODE_EVENTS;
}

// Conditionally export Cursor if available
if (CursorAdapter) {
  module.exports.CursorAdapter = CursorAdapter;
}
if (cursorAdapter) {
  module.exports.cursorAdapter = cursorAdapter;
}
if (CURSOR_EVENTS) {
  module.exports.CURSOR_EVENTS = CURSOR_EVENTS;
}
