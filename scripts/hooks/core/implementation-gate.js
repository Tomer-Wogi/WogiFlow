#!/usr/bin/env node

/**
 * Wogi Flow - Implementation Gate (Core Module)
 *
 * Routes all user prompts through /wogi-start when no active task exists.
 * Instead of blocking, injects context that makes Claude automatically
 * invoke /wogi-start which handles AI-based routing (questions, bugs,
 * features, operational tasks, etc.).
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
  /\bwhat\s+(does|is|are|do|did|should|would|could|can)\b/i,
  /\bhow\s+(does|do|can|to|would|should|could|did)\b/i,
  /\bwhy\s+(does|do|is|are|did|didn't|doesn't|don't|isn't|aren't|can't|won't|wouldn't|shouldn't|couldn't|hasn't|haven't|wasn't|weren't)\b/i,
  /\bwhere\s+(is|are|do|does|can|did|should)\b/i,
  /\bwho\s+(is|are|does|did|should|can)\b/i,
  /\bwhen\s+(does|do|did|is|are|should|will)\b/i,
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
  /\bcan\s+(claude|you)\s+(access|read|see)/i,
  /\bit'?s\s+supposed\s+to\b/i,
  /\bisn'?t\s+(it|that|this)\b/i
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

  // Prompts containing question marks are likely exploratory
  // Check for '?' anywhere in the prompt (not just at end - multi-sentence prompts
  // often have the question mid-text followed by additional context)
  const hasQuestionMark = prompt.length < 500 && prompt.includes('?');

  return matchesExploration || hasQuestionMark;
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
 * v5.2: Simplified to a binary check: active task or not.
 * No regex classification - /wogi-start handles routing with AI understanding.
 *
 * Flow:
 * 1. Active task exists → allow (Claude works on the task)
 * 2. /wogi-* command → allow (always pass through)
 * 3. No active task → block (user must route through /wogi-start)
 * 4. /wogi-start handles routing: questions proceed, implementation creates tasks
 *
 * @param {Object} options
 * @param {string} options.prompt - User's input prompt
 * @param {string} [options.source] - Source of prompt (manual, paste, etc.)
 * @returns {Object} Result: { allowed, blocked, message, reason }
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

  // WogiFlow commands always allowed (/wogi-start handles routing)
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

  // Check for active task
  const activeTask = getActiveTask();

  if (activeTask) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      task: activeTask,
      reason: 'task_active'
    };
  }

  // No active task - inject routing context so Claude automatically invokes /wogi-start
  // /wogi-start will use AI understanding to decide:
  //   Questions/exploration → proceed directly
  //   Operational (git/npm) → execute directly
  //   Implementation → create story/task first
  //   Research → use zero-trust protocol
  //   Bugs → investigate and fix properly
  return {
    allowed: true,
    blocked: false,
    systemReminder: generateRoutingContext(prompt),
    reason: 'no_active_task_route'
  };
}

/**
 * Generate routing context injected as additionalContext when no task is active.
 * This makes Claude automatically invoke /wogi-start via the Skill tool,
 * so the user never needs to type any command manually.
 *
 * /wogi-start handles ALL routing with AI understanding:
 * - Questions → answered directly
 * - Research → zero-trust research protocol
 * - Operational (git, npm) → executed directly
 * - Implementation → creates tracked task first
 * - Bugs → investigation + tracked fix
 */
function generateRoutingContext(prompt) {
  return `MANDATORY ROUTING — NO ACTIVE WOGIFLOW TASK

You MUST invoke the Skill tool with skill="wogi-start" and pass the user's FULL original prompt as args BEFORE doing anything else.

DO NOT:
- Answer implementation questions directly
- Create, edit, or write any files
- Make assumptions about the codebase
- Research or answer questions on your own (WogiFlow has a zero-trust research protocol)
- Truncate or summarize the user's prompt

DO:
- Immediately invoke: Skill(skill="wogi-start", args="<user's full original prompt>")
- Let /wogi-start classify and route: questions, research, bugs, features, operational tasks
- Follow the workflow /wogi-start sets up

The user installed WogiFlow so ALL work goes through proper workflows with guardrails.
Bypassing this is a workflow violation.`;
}

/**
 * Classify a request into categories for auto-routing
 * Used by /wogi-start to decide how to handle a request
 *
 * @param {string} prompt - The user's request
 * @returns {{category: string, confidence: string, action: string, matches?: string[]}}
 *   - category: 'exploration'|'operational'|'bug'|'quick-fix'|'implementation'|'unknown'
 *   - confidence: 'high'|'medium'|'low'
 *   - action: 'proceed'|'execute'|'create-bug'|'auto-task'|'create-story'|'ask'
 *   - matches: Array of matched pattern strings (only for 'implementation' category)
 *
 * @example
 * classifyRequest("add a logout button")
 * // => { category: 'implementation', confidence: 'medium', action: 'create-story', matches: ['add a logout'] }
 *
 * classifyRequest("push to github")
 * // => { category: 'operational', confidence: 'high', action: 'execute', matches: [] }
 */
function classifyRequest(prompt) {
  // Return consistent structure with matches array for all categories
  const makeResult = (category, confidence, action, matches = []) => ({
    category,
    confidence,
    action,
    matches
  });

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return makeResult('unknown', 'low', 'ask');
  }

  // Truncate overly long prompts for safety
  const processedPrompt = prompt.length > MAX_PROMPT_LENGTH
    ? prompt.slice(0, MAX_PROMPT_LENGTH)
    : prompt;

  // Priority order: exploration > operational > bug > quick-fix > implementation

  // 1. Exploration requests - proceed without task
  if (isExplorationRequest(processedPrompt)) {
    return makeResult('exploration', 'high', 'proceed');
  }

  // 2. Operational commands - execute directly
  if (matchesAnyPattern(processedPrompt, OPERATIONAL_PATTERNS)) {
    return makeResult('operational', 'high', 'execute');
  }

  // 3. Bug reports - route to /wogi-bug
  if (matchesAnyPattern(processedPrompt, BUG_PATTERNS)) {
    return makeResult('bug', 'medium', 'create-bug');
  }

  // 4. Quick fixes - auto-create task and execute
  if (matchesAnyPattern(processedPrompt, QUICK_FIX_PATTERNS)) {
    return makeResult('quick-fix', 'medium', 'auto-task');
  }

  // 5. Implementation requests - route to /wogi-story
  const impl = detectImplementationIntent(processedPrompt);
  if (impl.isImplementation) {
    return makeResult('implementation', impl.confidence, 'create-story', impl.matches);
  }

  // Unknown - ask for clarification
  return makeResult('unknown', 'low', 'ask');
}

module.exports = {
  // Classification functions (used by /wogi-start for routing, not for blocking)
  classifyRequest,
  detectImplementationIntent,
  isExplorationRequest,
  checkImplementationGate,

  // Gate status functions
  isImplementationGateEnabled,
  isWogiCommand,

  // Message generators
  generateRoutingContext,

  // Utilities
  truncatePrompt,
  matchesAnyPattern,
  calculateConfidence,

  // Pattern arrays (used by classifyRequest for /wogi-start routing)
  IMPLEMENTATION_PATTERNS,
  EXPLORATION_PATTERNS,
  OPERATIONAL_PATTERNS,
  BUG_PATTERNS,
  QUICK_FIX_PATTERNS
};
