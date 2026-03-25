/**
 * Wogi Flow - Centralized Failure Categories
 *
 * Provides standardized failure categorization used across the system:
 * - Model Stats: Track failures by type
 * - Cascade Fallback: Decide when to escalate to more capable models
 * - Adaptive Learning: Categorize what went wrong
 * - Loop Retry Learning: Identify root causes
 *
 * Each category has:
 * - code: Machine-readable identifier
 * - description: Human-readable explanation
 * - severity: low | medium | high | critical
 * - escalate: Whether to trigger model escalation
 * - patterns: Regex patterns for detection
 * - strategy: Refinement strategy key
 */

/**
 * Severity levels for failure categories
 */
const Severity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Failure categories with detection patterns, severity, and escalation rules
 */
const FailureCategory = {
  // ============================================================
  // Parse/Syntax Errors - Usually fixable with retry
  // ============================================================

  PARSE_ERROR: {
    code: 'parse_error',
    description: 'Failed to parse response or output',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /parse error/i,
      /json parse/i,
      /invalid json/i,
      /unexpected end of json/i,
      /failed to parse/i
    ],
    strategy: 'format_fix'
  },

  SYNTAX_ERROR: {
    code: 'syntax_error',
    description: 'Invalid syntax in generated code',
    severity: Severity.HIGH,
    escalate: false,
    patterns: [
      /unexpected token/i,
      /parsing error/i,
      /syntax error/i,
      /unterminated string/i,
      /expected.*but got/i,
      /missing.*after/i
    ],
    strategy: 'syntax_fix'
  },

  // ============================================================
  // Import/Module Errors - Context issue, rarely needs escalation
  // ============================================================

  IMPORT_ERROR: {
    code: 'import_error',
    description: 'Module import failed or incorrect path',
    severity: Severity.HIGH,
    escalate: false,
    patterns: [
      /cannot find module/i,
      /module not found/i,
      /no exported member/i,
      /has no exported member/i,
      /cannot resolve/i,
      /failed to resolve import/i,
      /missing import/i
    ],
    strategy: 'import_fix'
  },

  // ============================================================
  // Type Errors - Common, usually fixable with better context
  // ============================================================

  TYPE_ERROR: {
    code: 'type_error',
    description: 'TypeScript/type mismatch',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /type '.*' is not assignable/i,
      /property '.*' does not exist/i,
      /argument of type/i,
      /expected \d+ arguments/i,
      /missing property/i,
      /is not a valid/i,
      /typescript error/i,
      /TS\d{4}/
    ],
    strategy: 'type_fix'
  },

  // ============================================================
  // Runtime Errors - Execution-time failures
  // ============================================================

  RUNTIME_ERROR: {
    code: 'runtime_error',
    description: 'Error during execution',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /runtime error/i,
      /execution failed/i,
      /uncaught exception/i,
      /unhandled rejection/i,
      /crash/i
    ],
    strategy: 'generic_fix'
  },

  // ============================================================
  // API/Rate Limit Errors - External constraints
  // ============================================================

  RATE_LIMIT: {
    code: 'rate_limit',
    description: 'API rate limit exceeded',
    severity: Severity.LOW,
    escalate: false,
    patterns: [
      /rate limit/i,
      /too many requests/i,
      /429/,
      /quota exceeded/i,
      /throttled/i
    ],
    strategy: 'wait_retry'
  },

  API_ERROR: {
    code: 'api_error',
    description: 'External API call failed',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /api error/i,
      /request failed/i,
      /network error/i,
      /timeout/i,
      /connection refused/i,
      /ECONNREFUSED/,
      /ETIMEDOUT/
    ],
    strategy: 'retry'
  },

  // ============================================================
  // Context/Capability Issues - May need model escalation
  // ============================================================

  CONTEXT_OVERFLOW: {
    code: 'context_overflow',
    description: 'Context window exceeded',
    severity: Severity.HIGH,
    escalate: true,
    patterns: [
      /context.*overflow/i,
      /context.*exceeded/i,
      /too many tokens/i,
      /maximum context length/i,
      /context window/i,
      /token limit/i
    ],
    strategy: 'context_reduction'
  },

  CAPABILITY_MISMATCH: {
    code: 'capability_mismatch',
    description: 'Model lacks required capability for this task',
    severity: Severity.HIGH,
    escalate: true,
    patterns: [
      /capability.*mismatch/i,
      /not capable/i,
      /cannot perform/i,
      /unsupported.*operation/i,
      /model.*limitation/i,
      /beyond.*capabilities/i
    ],
    strategy: 'escalate'
  },

  // ============================================================
  // Output Quality Issues - Model may need escalation
  // ============================================================

  HALLUCINATION: {
    code: 'hallucination',
    description: 'Model produced incorrect/fabricated output',
    severity: Severity.HIGH,
    escalate: true,
    patterns: [
      /does not exist/i,
      /is not defined/i,
      /cannot read property/i,
      /undefined is not/i,
      /hallucination/i,
      /fabricated/i,
      /invented/i
    ],
    strategy: 'context_fix'
  },

  INCOMPLETE_OUTPUT: {
    code: 'incomplete_output',
    description: 'Response was truncated or incomplete',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /unexpected end of/i,
      /\.\.\./,
      /\/\/ \.\.\./,
      /TODO:/i,
      /FIXME:/i,
      /incomplete/i,
      /truncated/i
    ],
    strategy: 'completion_fix'
  },

  MARKDOWN_POLLUTION: {
    code: 'markdown_pollution',
    description: 'Model included markdown or explanatory text in code',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /```typescript/,
      /```jsx/,
      /```tsx/,
      /```javascript/,
      /Here's the/i,
      /Here is the/i,
      /I'll create/i,
      /Let me/i
    ],
    strategy: 'format_fix'
  },

  // ============================================================
  // Task/Context Issues - Process problems, not model issues
  // ============================================================

  MISSING_CONTEXT: {
    code: 'missing_context',
    description: 'Task needed more context loading',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /context not loaded/i,
      /file not found/i,
      /component not in app-map/i,
      /unknown component/i
    ],
    strategy: 'context_load'
  },

  INCOMPLETE_REQUIREMENTS: {
    code: 'incomplete_requirements',
    description: 'Acceptance criteria were unclear',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [
      /acceptance criteria unclear/i,
      /missing acceptance/i,
      /requirements not defined/i,
      /scope unclear/i,
      /what should.*do/i
    ],
    strategy: 'clarify'
  },

  COMPONENT_REUSE_MISS: {
    code: 'component_reuse_miss',
    description: 'Should have reused existing component',
    severity: Severity.LOW,
    escalate: false,
    patterns: [
      /component already exists/i,
      /duplicate component/i,
      /use existing/i,
      /similar component/i,
      /app-map has/i
    ],
    strategy: 'context_load'
  },

  PATTERN_VIOLATION: {
    code: 'pattern_violation',
    description: 'Did not follow project patterns',
    severity: Severity.LOW,
    escalate: false,
    patterns: [
      /pattern violation/i,
      /convention not followed/i,
      /style mismatch/i,
      /naming convention/i,
      /project pattern/i,
      /lint error/i,
      /eslint/i
    ],
    strategy: 'pattern_fix'
  },

  EXTERNAL_DEPENDENCY: {
    code: 'external_dependency',
    description: 'Waiting on CI/tests/external systems',
    severity: Severity.LOW,
    escalate: false,
    patterns: [
      /ci failed/i,
      /test failed/i,
      /waiting for/i,
      /external api/i
    ],
    strategy: 'wait_retry'
  },

  // ============================================================
  // Unknown/Catch-all
  // ============================================================

  UNKNOWN: {
    code: 'unknown',
    description: 'Unclassified error',
    severity: Severity.MEDIUM,
    escalate: false,
    patterns: [],
    strategy: 'generic_fix'
  }
};

// ============================================================
// Utility Functions
// ============================================================

/**
 * Detect failure category from error string
 * @param {string} error - Error message or output
 * @param {string} output - Optional model output to check
 * @returns {Object} Detection result with category and matches
 */
function detectCategory(error, output = '') {
  const errorStr = String(error || '');
  const outputStr = String(output || '');
  const combined = errorStr + '\n' + outputStr;

  const matches = [];

  for (const [key, category] of Object.entries(FailureCategory)) {
    if (key === 'UNKNOWN') continue;

    for (const pattern of category.patterns) {
      if (pattern.test(combined)) {
        matches.push({
          category: key,
          code: category.code,
          severity: category.severity,
          escalate: category.escalate,
          description: category.description,
          strategy: category.strategy,
          matchedPattern: pattern.toString()
        });
        break; // Only count first pattern match per category
      }
    }
  }

  // Sort by severity (critical > high > medium > low)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  matches.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const primary = matches[0] || {
    category: 'UNKNOWN',
    code: 'unknown',
    severity: Severity.MEDIUM,
    escalate: false,
    description: 'Unclassified error',
    strategy: 'generic_fix',
    matchedPattern: null
  };

  return {
    primary,
    all: matches,
    shouldEscalate: matches.some(m => m.escalate)
  };
}

/**
 * Get all categories that suggest escalation
 * @returns {Array} Category keys that have escalate: true
 */
function getEscalationCategories() {
  return Object.entries(FailureCategory)
    .filter(([_, cat]) => cat.escalate)
    .map(([key, _]) => key);
}

/**
 * Get category by code
 * @param {string} code - Category code (e.g., 'parse_error')
 * @returns {Object|null} Category definition or null
 */
function getCategoryByCode(code) {
  for (const [key, category] of Object.entries(FailureCategory)) {
    if (category.code === code) {
      return { key, ...category };
    }
  }
  return null;
}

/**
 * Get all category codes
 * @returns {Array} List of all category codes
 */
function getAllCodes() {
  return Object.values(FailureCategory).map(cat => cat.code);
}

/**
 * Check if a category should trigger model escalation
 * @param {string} categoryKey - Category key (e.g., 'CONTEXT_OVERFLOW')
 * @returns {boolean}
 */
function shouldEscalate(categoryKey) {
  const category = FailureCategory[categoryKey];
  return category ? category.escalate : false;
}

/**
 * Get severity level for a category
 * @param {string} categoryKey - Category key
 * @returns {string} Severity level
 */
function getSeverity(categoryKey) {
  const category = FailureCategory[categoryKey];
  return category ? category.severity : Severity.MEDIUM;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core definitions
  FailureCategory,
  Severity,

  // Detection
  detectCategory,

  // Utilities
  getEscalationCategories,
  getCategoryByCode,
  getAllCodes,
  shouldEscalate,
  getSeverity
};
