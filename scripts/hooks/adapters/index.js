#!/usr/bin/env node

/**
 * Wogi Flow - Adapters Index
 *
 * Registry of CLI adapters. Only Claude Code is supported.
 */

const { BaseAdapter, CoreResultSchema } = require('./base-adapter');
const { ClaudeCodeAdapter, claudeCodeAdapter, CLAUDE_CODE_EVENTS } = require('./claude-code');

/**
 * Adapter registry (Claude Code only)
 */
const adapters = {
  'claude-code': claudeCodeAdapter
};

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
