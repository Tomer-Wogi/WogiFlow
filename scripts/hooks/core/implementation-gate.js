#!/usr/bin/env node

/**
 * Wogi Flow - Implementation Gate (Core Module)
 *
 * Detects implementation requests from user prompts and blocks them
 * if no active task exists. Guides users to /wogi-story or /wogi-start.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const { getConfig } = require('../../flow-utils');
const { getActiveTask } = require('./task-gate');

/**
 * Patterns that indicate an implementation request
 * These should trigger the gate when no task is active
 */
// Maximum prompt length to process (prevent DoS)
const MAX_PROMPT_LENGTH = 10000;

const IMPLEMENTATION_PATTERNS = [
  // Direct action verbs (bounded character classes to prevent ReDoS)
  /\b(add|create|build|implement|make|write)\s+(a\s+)?[\w\s]{1,100}/i,
  /\b(fix|repair|resolve|patch)\s+[\w\s]{0,50}(bug|issue|error|problem)/i,
  /\b(fix|repair|resolve|patch)\s+(the\s+)?[\w]{1,50}/i,
  /\b(update|modify|change|edit|refactor)\s+(the\s+)?[\w\s]{1,100}/i,
  /\b(remove|delete|drop)\s+(the\s+)?[\w\s]{1,100}/i,
  /\b(integrate|connect|hook\s+up)\s+[\w\s]{1,100}/i,

  // Feature/component creation
  /\b(new\s+)?(feature|component|module|service|hook|util)/i,
  // Bounded pattern to prevent ReDoS (was: /\badd\s+.*\s+(to|into|for)\s+/i)
  /\badd\s+[\w\s]{1,100}\s+(to|into|for)\s+/i,

  // Task-like requests
  /\bwe\s+need\s+(to\s+)?/i,
  /\bshould\s+(add|create|implement|fix)/i,
  /\blet'?s\s+(add|create|implement|fix|build)/i,
  /\bcan\s+you\s+(add|create|implement|fix|build)/i,
  /\bplease\s+(add|create|implement|fix|build)/i,

  // Specific requests (bounded to prevent ReDoS - was using .*)
  /\bmake\s+[\w\s]{1,100}\s+work/i,
  /\bget\s+[\w\s]{1,100}\s+working/i,
  /\bset\s+up\s+/i
];

/**
 * Patterns that indicate exploration/questions (NOT implementation)
 * These should NOT trigger the gate
 */
const EXPLORATION_PATTERNS = [
  /\bwhat\s+(does|is|are|do)\b/i,
  /\bhow\s+(does|do|can|to|would)\b/i,
  /\bwhy\s+(does|do|is|are)\b/i,
  /\bwhere\s+(is|are|do|does|can)\b/i,
  /\bshow\s+me\b/i,
  /\bexplain\b/i,
  /\bdescribe\b/i,
  /\blist\s+(all|the)\b/i,
  /\bfind\s+(all|the|where)\b/i,
  /\bsearch\s+(for|the)\b/i,
  /\bread\s+(the|this)\b/i,
  /\blook\s+(at|for|into)\b/i,
  /\bunderstand\b/i,
  /\banalyze\b/i,
  /\breview\s+(the|this|my)/i,
  /\bcheck\s+(if|whether|the)/i,
  /\bcan\s+(claude|you)\s+(access|read|see)/i
];

/**
 * WogiFlow command patterns that should always be allowed
 */
const WOGI_COMMAND_PATTERNS = [
  /^\s*\/wogi-/i,
  /^\s*\/flow\s+/i,
  /\brun\s+(\/)?wogi-/i
];

// Maximum length for prompt display (DRY helper)
const MAX_DISPLAY_LENGTH = 80;

/**
 * Truncate prompt for display in messages
 * @param {string} prompt - The prompt to truncate
 * @param {number} maxLength - Maximum length (default: 80)
 * @returns {string} Truncated prompt with ellipsis if needed
 */
function truncatePrompt(prompt, maxLength = MAX_DISPLAY_LENGTH) {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt.length > maxLength ? prompt.slice(0, maxLength) + '...' : prompt;
}

/**
 * Check if implementation gate should be enforced
 * @returns {boolean}
 */
function isImplementationGateEnabled() {
  const config = getConfig();

  // Check hooks config first
  if (config.hooks?.rules?.implementationGate?.enabled === false) {
    return false;
  }

  // Fall back to enforcement config
  if (config.enforcement?.strictMode === false) {
    return false;
  }

  return true;
}

/**
 * Check if soft mode is enabled (warn instead of block)
 * @returns {boolean}
 */
function isSoftModeEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.implementationGate?.softMode === true ||
         config.enforcement?.softMode === true;
}

/**
 * Detect if prompt is a WogiFlow command (always allowed)
 * @param {string} prompt
 * @returns {boolean}
 */
function isWogiCommand(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  return WOGI_COMMAND_PATTERNS.some(pattern => pattern.test(prompt));
}

/**
 * Detect if prompt is primarily exploratory (questions, reading)
 * @param {string} prompt
 * @returns {boolean}
 */
function isExplorationRequest(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;

  // Check if it matches exploration patterns
  const matchesExploration = EXPLORATION_PATTERNS.some(pattern => pattern.test(prompt));

  // Short prompts that are questions are exploratory
  const isQuestion = prompt.trim().endsWith('?') && prompt.length < 200;

  return matchesExploration || isQuestion;
}

/**
 * Detect if prompt contains implementation intent
 * @param {string} prompt
 * @returns {{isImplementation: boolean, confidence: string, matches: string[]}}
 */
function detectImplementationIntent(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { isImplementation: false, confidence: 'low', matches: [] };
  }

  const matches = [];

  for (const pattern of IMPLEMENTATION_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  if (matches.length === 0) {
    return { isImplementation: false, confidence: 'low', matches: [] };
  }

  // Determine confidence based on number of matches
  // Simplified: any match from IMPLEMENTATION_PATTERNS is a strong signal
  const confidence = matches.length >= 2 ? 'high' : 'medium';

  return { isImplementation: true, confidence, matches };
}

/**
 * Check implementation gate for a user prompt
 *
 * @param {Object} options
 * @param {string} options.prompt - User's input prompt
 * @param {string} [options.source] - Source of prompt (manual, paste, etc.)
 * @returns {Object} Result: { allowed, blocked, message, reason, confidence, suggestedAction }
 */
function checkImplementationGate(options = {}) {
  const { prompt } = options;

  // Empty or invalid prompt - allow
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'empty_prompt'
    };
  }

  // Truncate overly long prompts to prevent DoS via regex processing
  const processedPrompt = prompt.length > MAX_PROMPT_LENGTH
    ? prompt.slice(0, MAX_PROMPT_LENGTH)
    : prompt;

  // WogiFlow commands always allowed (check original prompt for commands)
  if (isWogiCommand(prompt)) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'wogi_command'
    };
  }

  // Check if gate is enabled
  if (!isImplementationGateEnabled()) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'gate_disabled'
    };
  }

  // Exploration requests always allowed (use truncated prompt for safety)
  if (isExplorationRequest(processedPrompt)) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'exploration_request'
    };
  }

  // Check for implementation intent (use truncated prompt for safety)
  const { isImplementation, confidence, matches } = detectImplementationIntent(processedPrompt);

  if (!isImplementation) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'no_implementation_intent'
    };
  }

  // Has implementation intent - check for active task
  const activeTask = getActiveTask();

  if (activeTask) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      task: activeTask,
      reason: 'task_active',
      confidence,
      matches
    };
  }

  // No active task and implementation intent detected
  const softMode = isSoftModeEnabled();

  if (softMode) {
    return {
      allowed: true,
      blocked: false,
      message: generateWarningMessage(prompt),
      reason: 'warn_only',
      confidence,
      suggestedAction: 'create-story',
      matches
    };
  }

  // v4.2: Block and route through /wogi-start
  // /wogi-start will triage: operational (execute directly), small fix (execute + log), or implementation (create task)
  const config = getConfig();
  const mode = config.hooks?.rules?.implementationGate?.mode || 'block';

  if (mode === 'off') {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'gate_mode_off'
    };
  }

  if (mode === 'warn') {
    return {
      allowed: true,
      blocked: false,
      message: generateRoutingMessage(prompt),
      reason: 'route_to_wogi_start',
      confidence,
      suggestedAction: 'wogi-start',
      matches
    };
  }

  // Default: mode === 'block' - strict enforcement
  return {
    allowed: false,
    blocked: true,
    message: generateBlockingMessage(prompt),
    reason: 'route_to_wogi_start',
    confidence,
    suggestedAction: 'wogi-start',
    suggestedCommand: `/wogi-start "${truncatePrompt(prompt)}"`,
    matches
  };
}

/**
 * Generate warning message (soft mode)
 */
function generateWarningMessage(prompt) {
  return `Warning: No active WogiFlow task.

Consider: /wogi-start "${truncatePrompt(prompt)}"

This will execute directly (git/npm/deploy) or create a story first (features/fixes).`;
}

/**
 * Generate routing message - instructs Claude to use /wogi-start
 * /wogi-start will intelligently decide what to do
 */
function generateRoutingMessage(prompt) {
  return `Route this request through /wogi-start.

Use: /wogi-start "${truncatePrompt(prompt)}"

/wogi-start will intelligently decide:
- Execute directly if operational (git, npm, deploy, review, commit)
- Create a story first if implementation (add feature, fix bug, refactor)`;
}

/**
 * Generate block message (hard mode) - kept for backwards compatibility
 */
function generateBlockMessage(prompt) {
  return generateRoutingMessage(prompt);
}

/**
 * Generate blocking message (v4.2 strict enforcement)
 * This message appears when implementation is detected without active task
 */
function generateBlockingMessage(prompt) {
  return `Implementation request detected without active task.

To proceed, run:
  /wogi-start "${truncatePrompt(prompt)}"

WogiFlow will triage and decide:
- If operational (git/npm/deploy) → execute directly
- If small fix → execute + log for learning
- If larger task → create story/bug first`;
}

module.exports = {
  isImplementationGateEnabled,
  isSoftModeEnabled,
  isWogiCommand,
  isExplorationRequest,
  detectImplementationIntent,
  checkImplementationGate,
  generateWarningMessage,
  generateRoutingMessage,
  generateBlockMessage,
  generateBlockingMessage,
  truncatePrompt,
  IMPLEMENTATION_PATTERNS,
  EXPLORATION_PATTERNS
};
