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
 * Operational patterns (execute directly, no task needed)
 * These are release/deploy/maintenance actions
 */
const OPERATIONAL_PATTERNS = [
  /\b(push|pull|fetch|merge|rebase|commit|checkout)\b/i,
  /\bgit\s+(push|pull|status|diff|log|branch)/i,
  /\b(publish|deploy|release)\s+(to|on)?\s*(npm|pypi|docker|prod|staging)?/i,
  /\bnpm\s+(publish|test|run|build|install)/i,
  /\b(run|execute)\s+(the\s+)?(tests?|build|lint|format)/i,
  /\b(update|bump)\s+(the\s+)?(deps?|dependencies|version)/i,
  /\bsync\s+(with\s+)?(remote|origin|upstream)/i
];

/**
 * Bug patterns (route to /wogi-bug)
 */
const BUG_PATTERNS = [
  /\bbug\b/i,
  /\b(broken|not\s+working|doesn't\s+work|fails?|crash)/i,
  /\b(should|supposed\s+to)\s+but\s+(doesn't|isn't|won't)/i,
  /\berror\s+(in|when|while)/i
];

/**
 * Quick fix patterns (auto-create task + execute)
 */
const QUICK_FIX_PATTERNS = [
  /\b(typo|typos|spelling)/i,
  /\b(change|update)\s+(the\s+)?(text|label|title|color)/i,
  /\bsimple\s+(fix|change)/i
];

/**
 * Review patterns (route to /wogi-review or /wogi-peer-review)
 */
const REVIEW_PATTERNS = [
  /\bcode\s+review\b/i,
  /\breview\s+(what\s+we|our|the\s+code|the\s+changes|changes|diff|pr)\b/i,
  /\bplease\s+review\b/i,
  /\breview\s+this\s+session\b/i
];

const PEER_REVIEW_PATTERNS = [
  /\bpeer\s+review\b/i,
  /\bmulti[- ]?model\s+review\b/i
];

/**
 * Research patterns (route to /wogi-research)
 * Matches capability/feasibility/existence questions requiring verification
 */
const RESEARCH_PATTERNS = [
  /\bdoes\s+[\w\s]{1,50}\s+support\b/i,
  /\bis\s+it\s+possible\s+to\b/i,
  /\bcan\s+[\w\s]{1,30}\s+do\b/i,
  /\bresearch\s+(this|whether|if|how|the)\b/i,
  /\bverify\s+(if|whether|that|this)\b/i,
  /\bis\s+there\s+(a|an)\b/i,
  /\bdoes\s+[\w\s]{1,30}\s+exist\b/i,
  /\bcan\s+we\s+(use|integrate|leverage)\b/i,
  /\bwhat\s+are\s+the\s+options\s+for\b/i,
  /\bfeasibility\s+of\b/i,
  /\binvestigate\s+(feasibility|whether|if|options)\b/i
];

/**
 * Debug/hypothesis patterns (route to /wogi-debug-hypothesis)
 */
const DEBUG_PATTERNS = [
  /\bdebug\s+(this|the|a)\b/i,
  /\bcompeting\s+theor(y|ies)\b/i,
  /\bparallel\s+debug\b/i,
  /\broot\s+cause\b/i,
  /\bhypothes[ie]s\s+debug\b/i,
  /\binvestigate\s+(the\s+)?(bug|issue|error|crash|failure|root\s+cause)\b/i
];

/**
 * Workflow command patterns - map specific phrases to specific /wogi-* commands
 */
const WORKFLOW_COMMAND_MAP = [
  { patterns: [/\b(morning|daily)\s+briefing\b/i, /\bwhat\s+should\s+I\s+work\s+on\b/i, /\bstart\s+my\s+day\b/i], command: '/wogi-morning' },
  { patterns: [/\bshow\s+(me\s+)?tasks\b/i, /\bwhat'?s\s+ready\b/i, /\bavailable\s+tasks\b/i], command: '/wogi-ready' },
  { patterns: [/\bproject\s+status\b/i, /\bwhere\s+are\s+we\b/i, /\bshow\s+status\b/i], command: '/wogi-status' },
  { patterns: [/\b(check|workflow)\s+health\b/i, /\bis\s+everything\s+ok\b/i], command: '/wogi-health' },
  { patterns: [/\bwrap\s+up\b/i, /\bend\s+session\b/i, /\bthat'?s\s+all\b/i], command: '/wogi-session-end' },
  { patterns: [/\bcompact\s+context\b/i, /\b(save|free\s+up)\s+context\b/i, /\brunning\s+low\s+on\s+context\b/i], command: '/wogi-compact' },
  { patterns: [/\bshow\s+(the\s+)?roadmap\b/i, /\bwhat'?s\s+planned\b/i, /\bfuture\s+work\b/i, /\bdeferred\s+items\b/i], command: '/wogi-roadmap' },
  { patterns: [/\b(daily\s+)?standup(\s+report|\s+summary)?\b/i], command: '/wogi-standup' }
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

// Confidence threshold for high confidence classification
const HIGH_CONFIDENCE_MATCH_THRESHOLD = 2;

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
 * Check if prompt matches any pattern in an array (DRY helper)
 * @param {string} prompt - The prompt to test
 * @param {RegExp[]} patterns - Array of regex patterns
 * @returns {boolean} True if any pattern matches
 */
function matchesAnyPattern(prompt, patterns) {
  if (!prompt || !patterns) return false;
  try {
    return patterns.some(p => p.test(prompt));
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Pattern match error: ${err.message}`);
    return false;
  }
}

/**
 * Calculate confidence based on match count
 * @param {number} matchCount - Number of pattern matches
 * @returns {string} 'high', 'medium', or 'low'
 */
function calculateConfidence(matchCount) {
  if (matchCount >= HIGH_CONFIDENCE_MATCH_THRESHOLD) return 'high';
  if (matchCount >= 1) return 'medium';
  return 'low';
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

// NOTE: softMode is deprecated. Use hooks.rules.implementationGate.mode = 'warn' instead.
// Kept for backwards compatibility - maps to mode='warn'
function isSoftModeEnabled() {
  const config = getConfig();
  // Check legacy softMode, map to mode='warn'
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
  const matchesExploration = matchesAnyPattern(prompt, EXPLORATION_PATTERNS);

  // Short prompts that are questions are exploratory
  // Check length BEFORE calling trim() to avoid processing long strings
  const isQuestion = prompt.length < 200 && prompt.trim().endsWith('?');

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

  try {
    for (const pattern of IMPLEMENTATION_PATTERNS) {
      const match = prompt.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Pattern match error: ${err.message}`);
    return { isImplementation: false, confidence: 'low', matches: [] };
  }

  if (matches.length === 0) {
    return { isImplementation: false, confidence: 'low', matches: [] };
  }

  // Use standardized confidence calculation
  const confidence = calculateConfidence(matches.length);

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
  // v4.2: Use 'mode' config as canonical control (softMode is deprecated fallback)
  let config;
  try {
    config = getConfig();
    // Defensive: ensure config is an object
    if (!config || typeof config !== 'object') {
      config = {};
    }
  } catch (err) {
    // Config load failed - default to warn mode for safety
    if (process.env.DEBUG) {
      console.error(`[Implementation Gate] Config load failed: ${err.message}`);
    }
    config = {};
  }

  let mode = config.hooks?.rules?.implementationGate?.mode;

  // Backward compatibility: if mode not set, check legacy softMode
  if (!mode) {
    const softMode = isSoftModeEnabled();
    mode = softMode ? 'warn' : 'block';
  }

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

/wogi-start will intelligently route to the right workflow:
- Review → /wogi-review | Research → /wogi-research | Debug → /wogi-debug-hypothesis
- Operational (git, npm, deploy) → execute directly
- Bug report → /wogi-bug | Implementation → /wogi-story`;
}

/**
 * @deprecated Use generateBlockingMessage instead. Kept for backwards compatibility.
 */
function generateBlockMessage(prompt) {
  return generateBlockingMessage(prompt);
}

/**
 * Generate blocking message (v4.2 strict enforcement)
 * This message appears when implementation is detected without active task
 */
function generateBlockingMessage(prompt) {
  return `Implementation request detected without active task.

To proceed, run:
  /wogi-start "${truncatePrompt(prompt)}"

WogiFlow will triage and route:
- Review/research/debug → appropriate workflow command
- Operational (git/npm/deploy) → execute directly
- Small fix → execute + log
- Larger task → create story/bug first`;
}

/**
 * Match a prompt against the WORKFLOW_COMMAND_MAP
 * @param {string} prompt - The prompt to check
 * @returns {{matched: boolean, command: string|null}} Match result
 */
function matchWorkflowCommand(prompt) {
  for (const entry of WORKFLOW_COMMAND_MAP) {
    if (entry.patterns.some(p => p.test(prompt))) {
      return { matched: true, command: entry.command };
    }
  }
  return { matched: false, command: null };
}

/**
 * Classify a request into categories for auto-routing
 * Used by /wogi-start to decide how to handle a request
 *
 * @param {string} prompt - The user's request
 * @returns {{category: string, confidence: string, action: string, command?: string, matches?: string[]}}
 *   - category: 'workflow'|'review'|'research'|'debug'|'exploration'|'operational'|'bug'|'quick-fix'|'implementation'|'unknown'
 *   - confidence: 'high'|'medium'|'low'
 *   - action: 'route-command'|'proceed'|'execute'|'create-bug'|'auto-task'|'create-story'|'ask'
 *   - command: (optional) specific /wogi-* command to route to
 *   - matches: Array of matched pattern strings
 *
 * @example
 * classifyRequest("code review")
 * // => { category: 'review', confidence: 'high', action: 'route-command', command: '/wogi-review' }
 *
 * classifyRequest("add a logout button")
 * // => { category: 'implementation', confidence: 'medium', action: 'create-story', matches: ['add a logout'] }
 */
function classifyRequest(prompt) {
  // Return consistent structure with matches array for all categories
  const makeResult = (category, confidence, action, matches = [], command = undefined) => ({
    category,
    confidence,
    action,
    ...(command && { command }),
    matches
  });

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return makeResult('unknown', 'low', 'ask');
  }

  // Truncate overly long prompts for safety
  const processedPrompt = prompt.length > MAX_PROMPT_LENGTH
    ? prompt.slice(0, MAX_PROMPT_LENGTH)
    : prompt;

  // Priority order: workflow > peer-review > review > research > debug > exploration > operational > bug > quick-fix > implementation

  // 1. Workflow commands - route to specific /wogi-* command
  const workflow = matchWorkflowCommand(processedPrompt);
  if (workflow.matched) {
    return makeResult('workflow', 'high', 'route-command', [], workflow.command);
  }

  // 2. Peer review - route to /wogi-peer-review (before general review)
  if (matchesAnyPattern(processedPrompt, PEER_REVIEW_PATTERNS)) {
    return makeResult('review', 'high', 'route-command', [], '/wogi-peer-review');
  }

  // 3. Code review - route to /wogi-review
  if (matchesAnyPattern(processedPrompt, REVIEW_PATTERNS)) {
    return makeResult('review', 'high', 'route-command', [], '/wogi-review');
  }

  // 4. Research requests - route to /wogi-research
  if (matchesAnyPattern(processedPrompt, RESEARCH_PATTERNS)) {
    return makeResult('research', 'high', 'route-command', [], '/wogi-research');
  }

  // 5. Debug/hypothesis requests - route to /wogi-debug-hypothesis
  if (matchesAnyPattern(processedPrompt, DEBUG_PATTERNS)) {
    return makeResult('debug', 'high', 'route-command', [], '/wogi-debug-hypothesis');
  }

  // 6. Exploration requests - proceed without task
  if (isExplorationRequest(processedPrompt)) {
    return makeResult('exploration', 'high', 'proceed');
  }

  // 7. Operational commands - execute directly
  if (matchesAnyPattern(processedPrompt, OPERATIONAL_PATTERNS)) {
    return makeResult('operational', 'high', 'execute');
  }

  // 8. Bug reports - route to /wogi-bug
  if (matchesAnyPattern(processedPrompt, BUG_PATTERNS)) {
    return makeResult('bug', 'medium', 'create-bug');
  }

  // 9. Quick fixes - auto-create task and execute
  if (matchesAnyPattern(processedPrompt, QUICK_FIX_PATTERNS)) {
    return makeResult('quick-fix', 'medium', 'auto-task');
  }

  // 10. Implementation requests - route to /wogi-story
  const impl = detectImplementationIntent(processedPrompt);
  if (impl.isImplementation) {
    return makeResult('implementation', impl.confidence, 'create-story', impl.matches);
  }

  // Unknown - ask for clarification
  return makeResult('unknown', 'low', 'ask');
}

module.exports = {
  // Classification functions
  classifyRequest,
  detectImplementationIntent,
  isExplorationRequest,
  checkImplementationGate,

  // Gate status functions
  isImplementationGateEnabled,
  isSoftModeEnabled,
  isWogiCommand,

  // Message generators
  generateWarningMessage,
  generateRoutingMessage,
  generateBlockMessage,  // @deprecated - use generateBlockingMessage
  generateBlockingMessage,

  // Utilities
  truncatePrompt,
  matchesAnyPattern,
  calculateConfidence,

  // Pattern arrays (for testing and extension)
  IMPLEMENTATION_PATTERNS,
  EXPLORATION_PATTERNS,
  OPERATIONAL_PATTERNS,
  BUG_PATTERNS,
  QUICK_FIX_PATTERNS,
  REVIEW_PATTERNS,
  PEER_REVIEW_PATTERNS,
  RESEARCH_PATTERNS,
  DEBUG_PATTERNS,
  WORKFLOW_COMMAND_MAP,

  // Workflow command matcher
  matchWorkflowCommand
};
