#!/usr/bin/env node

/**
 * Wogi Flow - Long Input Gate (Core Module)
 *
 * Detects long/complex inputs and triggers appropriate processing.
 * Uses smart defaults based on content type:
 *   - transcript/spec/requirements → full extraction
 *   - code → skip
 *   - other → quick scan
 *
 * Part of the Long Input Processing pipeline (formerly transcript-digestion).
 */

const path = require('path');

// Import from parent scripts directory
const { getConfig, safeJsonParse } = require('../../flow-utils');

// Default configuration
const DEFAULTS = {
  enabled: true,
  charThreshold: 2000,      // Characters to trigger gate
  lineThreshold: 50,        // Lines to trigger gate
  smartDefault: true,       // Use content-based defaults
  contentRules: {
    transcript: 'full',     // Meeting notes, voice transcripts
    spec: 'full',           // Specifications, PRDs
    requirements: 'full',   // Feature requirements
    code: 'skip',           // Code snippets - no extraction needed
    default: 'quick'        // Unknown content - quick scan
  }
};

/**
 * Content type patterns for classification
 */
const CONTENT_PATTERNS = {
  transcript: [
    /\b(meeting|discussion|call|transcript)\b/i,
    /\b(said|mentioned|asked|replied)\b/i,
    /\b(speaker|participant)\s*[:\d]/i,
    /\[\d{1,2}:\d{2}(:\d{2})?\]/,           // Timestamps [00:00:00]
    /^\s*-?\s*[A-Z][a-z]+:/m                // Speaker: format
  ],
  spec: [
    /\b(specification|spec|prd|requirement|feature)\b/i,
    /\b(must|shall|should|will)\s+(be|have|support|allow)\b/i,
    /\b(user story|acceptance criteria|given.+when.+then)\b/i,
    /\b(functional|non-functional|technical)\s+requirement/i
  ],
  requirements: [
    /\b(feature|functionality|capability)\b/i,
    /\b(user wants|users need|allow users to)\b/i,
    /\b(add|implement|create|build)\s+a?\s*(new|the)?\s*(feature|page|component|button)/i,
    /as a .+, i want .+, so that/i          // User story format
  ],
  code: [
    /^(import|export|const|let|var|function|class|interface|type)\s/m,
    /\b(async|await|return|throw|try|catch)\b/,
    /[{}\[\]();=]\s*$/m,                    // Code endings
    /^\s*(\/\/|\/\*|\*|#)/m,                // Comments
    /\.(ts|js|tsx|jsx|py|go|rs|java|rb)$/   // File extensions mentioned
  ]
};

/**
 * Get long input gate configuration
 */
function getLongInputConfig() {
  const config = getConfig();
  return {
    ...DEFAULTS,
    ...(config.longInputGate || config.transcriptDigestion || {})
  };
}

/**
 * Check if long input gate is enabled
 */
function isLongInputGateEnabled() {
  const config = getLongInputConfig();
  return config.enabled !== false;
}

/**
 * Check if input exceeds thresholds
 */
function exceedsThresholds(input) {
  if (!input || typeof input !== 'string') {
    return { exceeds: false };
  }

  const config = getLongInputConfig();
  const charCount = input.length;
  const lineCount = input.split('\n').length;

  const exceedsChars = charCount >= config.charThreshold;
  const exceedsLines = lineCount >= config.lineThreshold;

  return {
    exceeds: exceedsChars || exceedsLines,
    charCount,
    lineCount,
    charThreshold: config.charThreshold,
    lineThreshold: config.lineThreshold,
    reason: exceedsChars ? 'chars' : (exceedsLines ? 'lines' : null)
  };
}

/**
 * Classify content type based on patterns
 */
function classifyContent(input) {
  if (!input || typeof input !== 'string') {
    return { type: 'unknown', confidence: 0, matches: [] };
  }

  const scores = {};
  const matches = {};

  for (const [type, patterns] of Object.entries(CONTENT_PATTERNS)) {
    scores[type] = 0;
    matches[type] = [];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        scores[type]++;
        matches[type].push(pattern.source.slice(0, 30) + '...');
      }
    }
  }

  // Find highest scoring type
  let bestType = 'unknown';
  let bestScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Calculate confidence (0-1)
  const maxPossible = CONTENT_PATTERNS[bestType]?.length || 1;
  const confidence = Math.min(bestScore / maxPossible, 1);

  return {
    type: bestScore > 0 ? bestType : 'unknown',
    confidence,
    scores,
    matches: matches[bestType] || []
  };
}

/**
 * Get recommended action for content type
 */
function getRecommendedAction(contentType) {
  const config = getLongInputConfig();
  const rules = config.contentRules || DEFAULTS.contentRules;

  return rules[contentType] || rules.default || 'quick';
}

/**
 * Check long input gate for a given input
 *
 * @param {Object} options
 * @param {string} options.input - The input text to check
 * @param {string} options.source - Source of input ('task', 'story', 'voice', 'paste')
 * @returns {Object} Gate result
 */
function checkLongInputGate(options = {}) {
  const { input, source = 'unknown' } = options;

  // Check if gate is enabled
  if (!isLongInputGateEnabled()) {
    return {
      triggered: false,
      action: 'skip',
      reason: 'gate_disabled'
    };
  }

  // Check thresholds
  const thresholdResult = exceedsThresholds(input);

  if (!thresholdResult.exceeds) {
    return {
      triggered: false,
      action: 'skip',
      reason: 'below_threshold',
      metrics: thresholdResult
    };
  }

  // Classify content
  const classification = classifyContent(input);

  // Get recommended action
  const config = getLongInputConfig();
  let action;

  if (config.smartDefault) {
    action = getRecommendedAction(classification.type);
  } else {
    action = 'ask'; // Always ask if smart defaults disabled
  }

  return {
    triggered: true,
    action,
    reason: 'threshold_exceeded',
    metrics: thresholdResult,
    classification,
    source,
    message: generateGateMessage(thresholdResult, classification, action)
  };
}

/**
 * Generate user-facing message for gate trigger
 */
function generateGateMessage(metrics, classification, action) {
  const sizeInfo = metrics.reason === 'chars'
    ? `${metrics.charCount.toLocaleString()} characters`
    : `${metrics.lineCount} lines`;

  const typeInfo = classification.confidence > 0.5
    ? `Detected as: ${classification.type}`
    : 'Content type: unknown';

  const actionInfo = {
    full: 'Running full extraction (4-pass with clarifications)',
    quick: 'Running quick scan (single-pass, no clarifications)',
    skip: 'Skipping extraction (code content)',
    ask: 'Please choose processing mode'
  };

  return `Long input detected: ${sizeInfo}
${typeInfo}
Recommended action: ${actionInfo[action] || action}`;
}

/**
 * Format gate result for display
 */
function formatGateResult(result) {
  if (!result.triggered) {
    return null;
  }

  const lines = [
    `Long Input Gate Triggered`,
    ``,
    `Size: ${result.metrics.charCount.toLocaleString()} chars, ${result.metrics.lineCount} lines`,
    `Content Type: ${result.classification.type} (${Math.round(result.classification.confidence * 100)}% confidence)`,
    `Recommended: ${result.action}`,
    ``
  ];

  if (result.action === 'ask') {
    lines.push(
      `Options:`,
      `  1. full  - Complete 4-pass extraction with clarifications`,
      `  2. quick - Fast single-pass scan`,
      `  3. skip  - Proceed without extraction`
    );
  }

  return lines.join('\n');
}

module.exports = {
  // Configuration
  getLongInputConfig,
  isLongInputGateEnabled,
  DEFAULTS,
  CONTENT_PATTERNS,

  // Core functions
  exceedsThresholds,
  classifyContent,
  getRecommendedAction,
  checkLongInputGate,

  // Display
  generateGateMessage,
  formatGateResult
};
