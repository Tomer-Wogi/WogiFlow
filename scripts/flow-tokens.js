/**
 * Wogi Flow - Token Estimation
 *
 * Extracted from flow-utils.js for modularity.
 * Contains token estimation constants and functions.
 *
 * Usage:
 *   const { estimateTokens, TOKEN_ESTIMATION } = require('./flow-tokens');
 */

// ============================================================
// Token Estimation
// ============================================================

/**
 * Token estimation constants.
 */
const TOKEN_ESTIMATION = {
  // Characters per token (varies by content type)
  CHARS_PER_TOKEN_CODE: 3,      // Code is more token-dense
  CHARS_PER_TOKEN_TEXT: 4,      // General text/prose
  CHARS_PER_TOKEN_MIXED: 3.5,   // Mixed content

  // Line-based estimation (for code files)
  TOKENS_PER_LINE: 8,           // Average tokens per line of code

  // Complexity multipliers for task estimation
  COMPLEXITY_MULTIPLIERS: {
    low: 100,
    medium: 500,
    high: 2000
  }
};

/**
 * Estimate token count for text content.
 *
 * Unified token estimation supporting multiple use cases:
 * - Simple text estimation
 * - Code-aware estimation (different density)
 * - Hybrid char+line estimation
 * - Content type auto-detection
 *
 * @param {string} content - Text content to estimate
 * @param {Object} [options] - Estimation options
 * @param {boolean} [options.isCode] - Treat as code (3 chars/token vs 4)
 * @param {boolean} [options.detectCodeRatio] - Auto-detect code vs text ratio
 * @param {boolean} [options.useLineEstimate] - Include line-based estimation (for files)
 * @param {string} [options.complexity] - Add complexity multiplier (low/medium/high)
 * @returns {number} Estimated token count
 *
 * @example
 * // Simple estimation
 * estimateTokens('Hello world');  // ~3
 *
 * @example
 * // Code estimation
 * estimateTokens(codeContent, { isCode: true });
 *
 * @example
 * // File with auto-detection
 * estimateTokens(fileContent, { detectCodeRatio: true, useLineEstimate: true });
 */
function estimateTokens(content, options = {}) {
  if (!content || typeof content !== 'string') return 0;

  const {
    isCode = false,
    detectCodeRatio = false,
    useLineEstimate = false,
    complexity = null
  } = options;

  let estimate;

  if (detectCodeRatio) {
    // Auto-detect code vs text ratio
    const codeRatio = detectCodeContentRatio(content);
    const effectiveCharsPerToken =
      TOKEN_ESTIMATION.CHARS_PER_TOKEN_CODE * codeRatio +
      TOKEN_ESTIMATION.CHARS_PER_TOKEN_TEXT * (1 - codeRatio);
    estimate = Math.ceil(content.length / effectiveCharsPerToken);
  } else if (isCode) {
    estimate = Math.ceil(content.length / TOKEN_ESTIMATION.CHARS_PER_TOKEN_CODE);
  } else {
    estimate = Math.ceil(content.length / TOKEN_ESTIMATION.CHARS_PER_TOKEN_TEXT);
  }

  // Optionally blend with line-based estimate (better for structured code)
  if (useLineEstimate) {
    const lineCount = content.split('\n').length;
    const lineEstimate = lineCount * TOKEN_ESTIMATION.TOKENS_PER_LINE;
    estimate = Math.ceil((estimate + lineEstimate) / 2);
  }

  // Optionally add complexity multiplier (for task estimation)
  if (complexity && TOKEN_ESTIMATION.COMPLEXITY_MULTIPLIERS[complexity]) {
    estimate += TOKEN_ESTIMATION.COMPLEXITY_MULTIPLIERS[complexity];
  }

  return estimate;
}

/**
 * Detect the ratio of code content in text (0 to 1).
 * Uses heuristics like brackets, semicolons, and code block markers.
 *
 * @param {string} content - Content to analyze
 * @returns {number} Code ratio from 0 (all prose) to 1 (all code)
 */
function detectCodeContentRatio(content) {
  if (!content || content.length < 50) return 0;

  // Check for code block markers (markdown)
  const codeBlockPattern = /```[\s\S]*?```/g;
  const inlineCodePattern = /`[^`]+`/g;

  let codeChars = 0;
  const codeBlockMatches = content.match(codeBlockPattern);
  if (codeBlockMatches) {
    codeChars += codeBlockMatches.join('').length;
  }
  const inlineMatches = content.match(inlineCodePattern);
  if (inlineMatches) {
    codeChars += inlineMatches.join('').length;
  }

  // Check for code indicators (brackets, semicolons, etc.)
  const codeIndicators = (content.match(/[{}\[\]();=<>]/g) || []).length;
  const indicatorRatio = codeIndicators / content.length;

  // Combine code block ratio and indicator ratio
  const blockRatio = codeChars / content.length;
  const combinedRatio = Math.min(1, blockRatio + indicatorRatio * 2);

  return combinedRatio;
}

/**
 * Check if content is primarily code (helper for isCode parameter).
 *
 * @param {string} content - Content to check
 * @returns {boolean} True if content appears to be code
 */
function isCodeContent(content) {
  return detectCodeContentRatio(content) > 0.3;
}

/**
 * Estimate complexity of the request
 * @param {string} request - User's request text
 * @returns {'low'|'medium'|'high'} Complexity estimate
 */
function estimateComplexity(request) {
  const lower = request.toLowerCase();
  const wordCount = request.split(/\s+/).length;

  // High complexity indicators
  const highIndicators = [
    'authentication', 'authorization', 'security', 'payment', 'database',
    'migration', 'architecture', 'infrastructure', 'api', 'integration',
    'system', 'platform', 'redesign', 'overhaul', 'refactor entire'
  ];
  if (highIndicators.some(ind => lower.includes(ind))) {
    return 'high';
  }

  // Medium complexity indicators
  const mediumIndicators = [
    'feature', 'flow', 'workflow', 'multiple', 'several', 'across',
    'form validation', 'state management', 'error handling', 'testing'
  ];
  if (mediumIndicators.some(ind => lower.includes(ind)) || wordCount > 30) {
    return 'medium';
  }

  return 'low';
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  TOKEN_ESTIMATION,
  estimateTokens,
  detectCodeContentRatio,
  isCodeContent,
  estimateComplexity,
};
