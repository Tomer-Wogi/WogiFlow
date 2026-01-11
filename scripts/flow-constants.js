#!/usr/bin/env node

/**
 * Wogi Flow - Constants
 *
 * Centralized magic numbers and configuration constants.
 * Extracted from various files to improve maintainability.
 *
 * Usage:
 *   const { TIMEOUTS, LIMITS, THRESHOLDS } = require('./flow-constants');
 */

// ============================================================
// Timeout Constants (milliseconds)
// ============================================================

const TIMEOUTS = {
  // Command execution
  DEFAULT_COMMAND: 120000,      // 2 minutes - default shell command timeout
  QUICK_COMMAND: 30000,         // 30 seconds - quick operations
  LONG_COMMAND: 300000,         // 5 minutes - build/test operations

  // HTTP requests
  HTTP_DEFAULT: 30000,          // 30 seconds - general HTTP requests
  HTTP_QUICK: 5000,             // 5 seconds - health checks
  HTTP_LONG: 60000,             // 1 minute - large requests
  HTTP_PROVIDER: 120000,        // 2 minutes - LLM provider requests

  // File locking
  LOCK_STALE: 60000,            // 1 minute - lock considered stale
  LOCK_CLEANUP_STALE: 30000,    // 30 seconds - cleanup threshold
  LOCK_RETRY_DELAY: 100,        // 100ms - delay between lock retries

  // LSP/Language Server
  LSP_DEFAULT: 5000,            // 5 seconds - LSP operations
  LSP_ENRICH: 2000,             // 2 seconds - LSP enrichment

  // Polling
  POLL_INTERVAL: 1000,          // 1 second - default polling interval
  ENDPOINT_CHECK: 3000,         // 3 seconds - endpoint availability check

  // Caching
  CACHE_TTL: 300000,            // 5 minutes - default cache TTL for integrations
};

// ============================================================
// Limit Constants
// ============================================================

const LIMITS = {
  // Retries
  LOCK_MAX_RETRIES: 5,
  HTTP_MAX_RETRIES: 3,
  TASK_MAX_RETRIES: 5,

  // History/Storage
  MAX_SESSION_HISTORY: 50,
  MAX_RECENT_FILES: 20,
  MAX_RECENT_DECISIONS: 10,
  MAX_REQUEST_LOG_ENTRIES: 100,
  MAX_WORKFLOW_ITERATIONS: 100,

  // Content
  MAX_REGEX_LENGTH: 100,        // Prevent ReDoS
  MAX_INPUT_LENGTH: 10000,      // Max string for regex testing
  MAX_OUTPUT_SIZE: 1024 * 1024, // 1MB output limit

  // File operations
  MAX_FILE_WALK_DEPTH: 10,
  MAX_CONCURRENT_TASKS: 5,
};

// ============================================================
// Threshold Constants
// ============================================================

const THRESHOLDS = {
  // Success rates (percentages)
  SUCCESS_RATE_HIGH: 90,
  SUCCESS_RATE_MEDIUM: 70,
  SUCCESS_RATE_LOW: 50,

  // Confidence scores
  CONFIDENCE_HIGH: 0.8,
  CONFIDENCE_MEDIUM: 0.5,
  CONFIDENCE_LOW: 0.3,

  // Context management
  CONTEXT_WARN_PERCENT: 70,
  CONTEXT_CRITICAL_PERCENT: 85,

  // Small fix threshold (files)
  SMALL_FIX_FILES: 3,
};

// ============================================================
// Retry Backoff Constants
// ============================================================

const BACKOFF = {
  BASE_DELAY: 1000,             // 1 second base
  MAX_DELAY: 30000,             // 30 seconds max
  MULTIPLIER: 2,                // Exponential multiplier
  JITTER: 0.1,                  // 10% jitter
};

// ============================================================
// Known Config Keys (for validation)
// ============================================================

const KNOWN_CONFIG_KEYS = [
  'hybrid',
  'parallel',
  'worktree',
  'qualityGates',
  'testing',
  'componentRules',
  'mandatorySteps',
  'phases',
  'corrections',
  'skills',
  'autoContext',
  'metrics',
  'figmaAnalyzer',
  'learning',
  'hooks',
  'project',
  'projectType',
  'contextMonitor',
  'requestLog',
  'sessionState',
  'priorities',
  'morningBriefing',
  'commits',
  'enforcement',
  'damageControl',
  'storyDecomposition',
  'specificationMode',
];

module.exports = {
  TIMEOUTS,
  LIMITS,
  THRESHOLDS,
  BACKOFF,
  KNOWN_CONFIG_KEYS,

  // Legacy exports for backwards compatibility
  DEFAULT_COMMAND_TIMEOUT_MS: TIMEOUTS.DEFAULT_COMMAND,
  QUICK_COMMAND_TIMEOUT_MS: TIMEOUTS.QUICK_COMMAND,
  LOCK_STALE_THRESHOLD_MS: TIMEOUTS.LOCK_STALE,
  CLEANUP_LOCK_STALE_MS: TIMEOUTS.LOCK_CLEANUP_STALE,
  LOCK_RETRY_DELAY_MS: TIMEOUTS.LOCK_RETRY_DELAY,
  LOCK_MAX_RETRIES: LIMITS.LOCK_MAX_RETRIES,
  MAX_SESSION_HISTORY: LIMITS.MAX_SESSION_HISTORY,
  MAX_WORKFLOW_ITERATIONS: LIMITS.MAX_WORKFLOW_ITERATIONS,
};
