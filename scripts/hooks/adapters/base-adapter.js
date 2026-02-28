#!/usr/bin/env node

/**
 * Wogi Flow - Base Adapter
 *
 * Base class for CLI-specific hook adapters.
 * Each CLI (Claude Code, Gemini, Codex, etc.) extends this class.
 */

/**
 * Base adapter class
 * Provides common functionality and defines the interface for CLI adapters.
 */
class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Get the CLI's hook configuration path
   * @returns {string} Path to hook config file
   */
  getConfigPath() {
    throw new Error('getConfigPath() must be implemented by subclass');
  }

  /**
   * Get supported hook events for this CLI
   * @returns {string[]} Array of event names
   */
  getSupportedEvents() {
    throw new Error('getSupportedEvents() must be implemented by subclass');
  }

  /**
   * Transform core result to CLI-specific format
   * @param {string} event - Event name (e.g., 'PreToolUse')
   * @param {Object} coreResult - Result from core module
   * @returns {Object} CLI-specific format
   */
  transformResult(event, coreResult) {
    throw new Error('transformResult() must be implemented by subclass');
  }

  /**
   * Parse incoming hook input from CLI
   * @param {Object} input - Raw input from CLI
   * @returns {Object} Normalized input
   */
  parseInput(input) {
    return input; // Default: pass through
  }

  /**
   * Generate hook configuration for this CLI
   * @param {Object} rules - Hook rules from config
   * @param {string} projectRoot - Project root path
   * @param {Object} [transportConfig] - Transport config: { transport, url, headers, allowedEnvVars }
   * @returns {Object} CLI-specific hook configuration
   */
  generateConfig(rules, projectRoot, transportConfig) {
    throw new Error('generateConfig() must be implemented by subclass');
  }

  /**
   * Get the install command for this CLI's hooks
   * @returns {string} Install instructions
   */
  getInstallInstructions() {
    return `Install hooks for ${this.name}`;
  }

  /**
   * Check if this CLI is available/installed
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}

/**
 * Standard result format from core modules
 * All adapters expect this format from core modules.
 */
const CoreResultSchema = {
  // Common fields
  allowed: Boolean,     // Whether action is allowed
  blocked: Boolean,     // Whether action is blocked
  message: String,      // Human-readable message
  reason: String,       // Machine-readable reason code

  // Optional fields
  warning: Boolean,     // Is this a warning (vs block)?
  task: Object,         // Active task info
  similar: Array,       // Similar components found
  results: Array,       // Validation results
  criteriaStatus: Object, // Loop criteria status

  // Research gate fields
  questionType: String,      // Type of question (feasibility, capability, etc.)
  suggestedDepth: String,    // Suggested research depth
  suggestedCommand: String   // Suggested command to run
};

/**
 * Research result format from research gate
 */
const ResearchResultSchema = {
  allowed: Boolean,          // Whether to allow without research
  blocked: Boolean,          // Whether to block for research
  warning: Boolean,          // Whether to warn (suggest research)
  message: String,           // Message to show user
  reason: String,            // Reason code
  questionType: String,      // Type of question detected
  suggestedDepth: String,    // Suggested research depth
  suggestedCommand: String   // Suggested /wogi-research command
};

module.exports = {
  BaseAdapter,
  CoreResultSchema,
  ResearchResultSchema
};
