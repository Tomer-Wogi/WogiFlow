#!/usr/bin/env node

/**
 * Wogi Flow - Best-of-N Pattern
 *
 * For high-risk tasks, spawn 2-3 implementation agents with different
 * approaches. Opus selects the best. Also serves as fallback:
 * if primary implementation fails 3x, try alternative candidates.
 *
 * Part of S5: Best-of-N Pattern
 *
 * Usage:
 *   flow best-of-n check <taskId>    Check if task qualifies for Best-of-N
 *   flow best-of-n config             Show Best-of-N configuration
 */

const path = require('path');
const {
  getConfig,
  PATHS,
  readJson,
  validateTaskId
} = require('./flow-utils');
const { analyzeTask, analyzeComplexity } = require('./flow-task-analyzer');

// ============================================================
// Constants
// ============================================================

const DEFAULT_BESTOFN_CONFIG = {
  enabled: true,
  autoSuggestThreshold: 'high',
  defaultN: 3,
  temperatureRange: [0.3, 0.7, 1.0],
  maxConcurrent: 3,
  failureThresholdForFallback: 3
};

// High-risk task types that benefit from Best-of-N
const HIGH_RISK_TASK_TYPES = new Set([
  'architecture',
  'migration',
  'refactor'
]);

// Keywords that signal high risk regardless of type
const HIGH_RISK_KEYWORDS = [
  'migration',
  'rewrite',
  'restructure',
  'rearchitect',
  'overhaul',
  'redesign',
  'replace',
  'breaking change'
];

// ============================================================
// Risk Assessment
// ============================================================

/**
 * Assess whether a task qualifies for Best-of-N.
 *
 * @param {Object} params - Assessment parameters
 * @param {string} params.taskType - Task type (feature, bugfix, refactor, etc.)
 * @param {string} params.description - Task description
 * @param {number} [params.fileCount] - Number of files expected to change
 * @param {string[]} [params.changedFiles] - List of files to change
 * @returns {Object} Risk assessment
 */
function assessRisk(params) {
  const { taskType, description, fileCount = 0, changedFiles = [] } = params;
  const config = getBestOfNConfig();

  const factors = [];
  let riskLevel = 'low';

  // Check task type
  if (HIGH_RISK_TASK_TYPES.has(taskType)) {
    factors.push(`Task type "${taskType}" is inherently high-risk`);
    riskLevel = 'high';
  }

  // Check keywords in description
  const descLower = (description || '').toLowerCase();
  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (descLower.includes(keyword)) {
      factors.push(`Contains high-risk keyword: "${keyword}"`);
      riskLevel = 'high';
      break;
    }
  }

  // Check file count
  if (fileCount > 10 || changedFiles.length > 10) {
    factors.push(`Large scope: ${fileCount || changedFiles.length} files`);
    if (riskLevel !== 'high') riskLevel = 'medium';
  }

  // Check complexity via task analyzer
  try {
    const complexity = analyzeComplexity(description || '');
    if (complexity.level === 'high') {
      factors.push(`Complexity analysis: HIGH (score: ${complexity.score})`);
      riskLevel = 'high';
    } else if (complexity.level === 'medium' && fileCount > 5) {
      factors.push(`Medium complexity + many files`);
      if (riskLevel !== 'high') riskLevel = 'medium';
    }
  } catch (err) {
    // Non-critical — analyzer may not fully parse
  }

  // Determine if Best-of-N should be suggested
  const thresholdMap = { low: 1, medium: 2, high: 3 };
  const riskScore = thresholdMap[riskLevel] || 1;
  const thresholdScore = thresholdMap[config.autoSuggestThreshold] || 3;
  const shouldSuggest = config.enabled && riskScore >= thresholdScore;

  return {
    riskLevel,
    factors,
    shouldSuggest,
    suggestedN: shouldSuggest ? config.defaultN : 0,
    config
  };
}

/**
 * Determine variation strategy based on available models.
 *
 * @param {number} n - Number of candidates to generate
 * @returns {Object} Variation strategy
 */
function getVariationStrategy(n) {
  const config = getConfig();
  const hasExternalModels = !!(
    config.hybrid?.cloudProviders?.openai?.envKey ||
    config.hybrid?.cloudProviders?.anthropic?.envKey
  );

  if (hasExternalModels) {
    // Different models at default temperature
    return {
      type: 'multi-model',
      description: 'Different models with default temperature',
      candidates: generateModelCandidates(n)
    };
  }

  // Same model, different temperatures
  const bestOfNConfig = getBestOfNConfig();
  const temps = bestOfNConfig.temperatureRange.slice(0, n);

  return {
    type: 'temperature-variation',
    description: 'Same model with temperature variation',
    candidates: temps.map((temp, i) => ({
      id: `candidate-${i + 1}`,
      model: 'opus',
      temperature: temp,
      label: `Approach ${i + 1} (temp=${temp})`
    }))
  };
}

/**
 * Generate model candidates for multi-model Best-of-N.
 *
 * @param {number} n - Number of candidates
 * @returns {Object[]} Model candidates
 */
function generateModelCandidates(n) {
  const candidates = [
    { id: 'candidate-1', model: 'opus', temperature: 0.7, label: 'Opus (primary)' },
    { id: 'candidate-2', model: 'sonnet', temperature: 0.7, label: 'Sonnet (alternative)' },
    { id: 'candidate-3', model: 'opus', temperature: 1.0, label: 'Opus (creative)' }
  ];

  return candidates.slice(0, n);
}

// ============================================================
// Judge Prompt
// ============================================================

/**
 * Build the judge prompt for selecting the best candidate.
 *
 * @param {Object} params - Judge parameters
 * @param {string} params.specContent - Task specification
 * @param {Object[]} params.candidates - Candidate implementations
 * @returns {string} Judge prompt
 */
function buildSelectionPrompt(params) {
  const { specContent, candidates } = params;

  const candidateBlocks = candidates.map((c, i) => `
### Candidate ${i + 1}: ${c.label}
Model: ${c.model}, Temperature: ${c.temperature}

\`\`\`
${c.output || '(implementation output)'}
\`\`\`
`).join('\n');

  return `You are selecting the best implementation from ${candidates.length} candidates.

## Task Specification
${specContent}

## Candidates
${candidateBlocks}

## Instructions

Evaluate each candidate against the specification's acceptance criteria.
Score each on: correctness, completeness, code quality, approach elegance.

Return ONLY a JSON object (no markdown, no explanation):
{
  "winner": <1-based index of best candidate>,
  "scores": [
    { "candidate": 1, "correctness": <1-10>, "completeness": <1-10>, "quality": <1-10>, "elegance": <1-10>, "overall": <1-10> },
    ...
  ],
  "reasoning": "<brief explanation of why the winner was selected>"
}`;
}

/**
 * Parse the judge's selection response.
 *
 * @param {string} response - Judge's raw response
 * @returns {Object|null} Parsed selection or null
 */
function parseSelectionResponse(response) {
  if (!response || typeof response !== 'string') return null;

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(response.trim());
    if (parsed.winner && parsed.scores) return parsed;
  } catch (err) {
    // Not direct JSON
  }

  // Try extracting JSON from text
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.winner && parsed.scores) return parsed;
    } catch (err) {
      // Failed to parse
    }
  }

  return null;
}

// ============================================================
// Fallback Logic
// ============================================================

/**
 * Check if a task should trigger Best-of-N as fallback after repeated failures.
 *
 * @param {string} taskType - Task type
 * @param {number} failureCount - Number of consecutive failures
 * @returns {Object} Fallback recommendation
 */
function checkFallbackTrigger(taskType, failureCount) {
  const config = getBestOfNConfig();

  if (!config.enabled) {
    return { shouldFallback: false, reason: 'Best-of-N is disabled' };
  }

  const threshold = config.failureThresholdForFallback;

  // High-risk tasks: fallback to Best-of-N after threshold failures
  if (failureCount >= threshold && isHighRiskTaskType(taskType)) {
    return {
      shouldFallback: true,
      reason: `${failureCount} failures on high-risk task — spawning alternative approaches`,
      suggestedN: 2,
      strategy: 'alternative'
    };
  }

  // Simple tasks: suggest debug-hypothesis instead
  if (failureCount >= threshold && !isHighRiskTaskType(taskType)) {
    return {
      shouldFallback: false,
      reason: `${failureCount} failures on ${taskType} task — suggest /wogi-debug-hypothesis instead`,
      suggestDebug: true
    };
  }

  return { shouldFallback: false };
}

/**
 * Check if a task type is considered high-risk.
 *
 * @param {string} taskType - Task type
 * @returns {boolean}
 */
function isHighRiskTaskType(taskType) {
  return HIGH_RISK_TASK_TYPES.has(taskType);
}

// ============================================================
// Config
// ============================================================

/**
 * Get Best-of-N configuration from config.json.
 *
 * @returns {Object} Config
 */
function getBestOfNConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_BESTOFN_CONFIG,
    ...(config.bestOfN || {})
  };
}

// ============================================================
// Display Helpers
// ============================================================

/**
 * Format a risk assessment for display.
 *
 * @param {Object} assessment - Risk assessment from assessRisk()
 * @returns {string} Formatted display
 */
function formatRiskAssessment(assessment) {
  const lines = [];
  lines.push('Best-of-N Risk Assessment');
  lines.push('─'.repeat(40));
  lines.push(`Risk Level: ${assessment.riskLevel.toUpperCase()}`);
  lines.push(`Suggested: ${assessment.shouldSuggest ? `Yes (N=${assessment.suggestedN})` : 'No'}`);

  if (assessment.factors.length > 0) {
    lines.push('');
    lines.push('Risk Factors:');
    for (const factor of assessment.factors) {
      lines.push(`  - ${factor}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'check': {
      const taskType = args[0] || 'feature';
      const description = args.slice(1).join(' ') || 'Example task';
      const assessment = assessRisk({ taskType, description, fileCount: 5 });
      console.log(formatRiskAssessment(assessment));
      break;
    }

    case 'config':
      console.log(JSON.stringify(getBestOfNConfig(), null, 2));
      break;

    case 'strategy': {
      const n = parseInt(args[0], 10) || 3;
      const strategy = getVariationStrategy(n);
      console.log(JSON.stringify(strategy, null, 2));
      break;
    }

    case 'fallback': {
      const taskType = args[0] || 'feature';
      const failures = parseInt(args[1], 10) || 3;
      const result = checkFallbackTrigger(taskType, failures);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log(`
Best-of-N Pattern

Usage: flow-best-of-n.js <command> [args]

Commands:
  check <taskType> [description]   Check if task qualifies for Best-of-N
  config                           Show Best-of-N configuration
  strategy [n]                     Show variation strategy for N candidates
  fallback <taskType> <failures>   Check fallback trigger

Best-of-N spawns multiple implementation approaches and selects the best.
Triggered automatically for high-risk tasks or as fallback after repeated failures.
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  assessRisk,
  getVariationStrategy,
  buildSelectionPrompt,
  parseSelectionResponse,
  checkFallbackTrigger,
  isHighRiskTaskType,
  getBestOfNConfig,
  formatRiskAssessment,
  HIGH_RISK_TASK_TYPES,
  HIGH_RISK_KEYWORDS
};

if (require.main === module) {
  main();
}
