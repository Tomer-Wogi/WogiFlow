#!/usr/bin/env node

/**
 * Wogi Flow - Eval Judge
 *
 * Multi-judge scoring logic for evaluating WogiFlow task output quality.
 * Uses 1 Opus + 2 Sonnet judges, takes median score per dimension.
 *
 * Scoring dimensions (1-10 scale):
 * - Completeness: Did the implementation address all acceptance criteria?
 * - Accuracy: Is the code correct, handling edge cases?
 * - Workflow compliance: Did it follow WogiFlow patterns?
 * - Token efficiency: How many tokens/iterations to reach passing state?
 * - Quality: Code quality, readability, maintainability
 *
 * Part of S3: Eval System
 */

const path = require('path');
const {
  getConfig,
  PATHS,
  readJson,
  writeJson,
  fileExists,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const SCORING_DIMENSIONS = [
  'completeness',
  'accuracy',
  'workflowCompliance',
  'tokenEfficiency',
  'quality'
];

const DEFAULT_EVAL_CONFIG = {
  judges: { opus: 1, sonnet: 2 },
  scoringDimensions: SCORING_DIMENSIONS,
  passingThreshold: 6
};

// ============================================================
// Judge Prompt Templates
// ============================================================

/**
 * Generate the judge prompt for evaluating task output.
 *
 * @param {Object} params - Judge parameters
 * @param {string} params.taskId - Task ID
 * @param {string} params.specContent - Task specification content
 * @param {string} params.implementationDiff - Git diff of implementation
 * @param {number} params.iterations - Number of iterations taken
 * @param {number} params.tokenEstimate - Tokens used
 * @returns {string} Judge prompt
 */
function buildJudgePrompt(params) {
  const { taskId, specContent, implementationDiff, iterations, tokenEstimate } = params;

  return `You are an expert code reviewer evaluating AI-generated implementation quality.

## Task: ${taskId}

## Specification
${specContent}

## Implementation Diff
\`\`\`diff
${implementationDiff}
\`\`\`

## Performance Metrics
- Iterations to pass: ${iterations}
- Estimated tokens: ${tokenEstimate}

## Instructions

Score this implementation on 5 dimensions (1-10 scale):

1. **Completeness** (1-10): Did the implementation address ALL acceptance criteria from the spec?
   - 10 = All criteria fully implemented with edge cases
   - 5 = Most criteria implemented, some gaps
   - 1 = Major criteria missing

2. **Accuracy** (1-10): Is the code correct and does it handle edge cases?
   - 10 = No bugs, robust error handling, covers edge cases
   - 5 = Works for happy path, missing some error handling
   - 1 = Fundamental logic errors

3. **Workflow Compliance** (1-10): Did it follow WogiFlow patterns (spec-first, criteria check, wiring, standards)?
   - 10 = Perfect adherence to workflow patterns
   - 5 = Mostly follows patterns with some deviations
   - 1 = Ignores workflow patterns entirely

4. **Token Efficiency** (1-10): How efficiently were tokens/iterations used?
   - 10 = Minimal iterations, efficient token usage
   - 5 = Reasonable iterations with some waste
   - 1 = Excessive iterations or token waste

5. **Quality** (1-10): Code quality, readability, and maintainability
   - 10 = Clean, readable, well-structured, follows conventions
   - 5 = Functional but could be cleaner
   - 1 = Messy, hard to maintain, inconsistent style

## Output Format

Return ONLY a JSON object (no markdown, no explanation):
{
  "completeness": <number>,
  "accuracy": <number>,
  "workflowCompliance": <number>,
  "tokenEfficiency": <number>,
  "quality": <number>,
  "notes": "<brief justification for scores>"
}`;
}

// ============================================================
// Scoring Functions
// ============================================================

/**
 * Calculate median of an array of numbers.
 *
 * @param {number[]} values - Array of numbers
 * @returns {number} Median value
 */
function median(values) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Aggregate scores from multiple judges using median.
 *
 * @param {Object[]} judgeScores - Array of score objects from judges
 * @returns {Object} Aggregated scores with median per dimension
 */
function aggregateScores(judgeScores) {
  if (judgeScores.length === 0) {
    return {
      scores: Object.fromEntries(SCORING_DIMENSIONS.map((d) => [d, 0])),
      overall: 0,
      judgeCount: 0,
      confidence: 'none'
    };
  }

  const aggregated = {};

  for (const dim of SCORING_DIMENSIONS) {
    const values = judgeScores
      .map((j) => j[dim])
      .filter((v) => typeof v === 'number' && v >= 1 && v <= 10);
    aggregated[dim] = values.length > 0 ? median(values) : 0;
  }

  // Overall = average of medians
  const dimValues = Object.values(aggregated);
  const overall = dimValues.length > 0
    ? +(dimValues.reduce((s, v) => s + v, 0) / dimValues.length).toFixed(2)
    : 0;

  // Confidence based on judge agreement
  const maxSpread = Math.max(
    ...SCORING_DIMENSIONS.map((dim) => {
      const vals = judgeScores.map((j) => j[dim]).filter((v) => typeof v === 'number');
      if (vals.length < 2) return 0;
      return Math.max(...vals) - Math.min(...vals);
    })
  );

  let confidence;
  if (maxSpread <= 2) confidence = 'high';
  else if (maxSpread <= 4) confidence = 'medium';
  else confidence = 'low';

  return {
    scores: aggregated,
    overall,
    judgeCount: judgeScores.length,
    confidence
  };
}

/**
 * Parse a judge's response into a scores object.
 * Handles JSON embedded in text.
 *
 * @param {string} response - Judge's raw response
 * @returns {Object|null} Parsed scores or null
 */
function parseJudgeResponse(response) {
  if (!response || typeof response !== 'string') return null;

  // Try direct JSON parse first (use safe parse to prevent prototype pollution)
  try {
    const parsed = JSON.parse(response.trim());
    if (typeof parsed === 'object' && parsed !== null) {
      // Reject keys that could cause prototype pollution
      if ('__proto__' in parsed || 'constructor' in parsed || 'prototype' in parsed) {
        return null;
      }
      if (isValidScoreObject(parsed)) return parsed;
    }
  } catch {
    // Not direct JSON
  }

  // Try extracting JSON from text (use greedy match to capture full object)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        if ('__proto__' in parsed || 'constructor' in parsed || 'prototype' in parsed) {
          return null;
        }
        if (isValidScoreObject(parsed)) return parsed;
      }
    } catch {
      // Failed to parse extracted JSON
    }
  }

  return null;
}

/**
 * Validate that a parsed object has the expected score dimensions.
 *
 * @param {Object} obj - Parsed object
 * @returns {boolean} True if valid
 */
function isValidScoreObject(obj) {
  if (typeof obj !== 'object' || obj === null) return false;

  for (const dim of SCORING_DIMENSIONS) {
    if (typeof obj[dim] !== 'number') return false;
    if (obj[dim] < 1 || obj[dim] > 10) return false;
  }

  return true;
}

/**
 * Get the judge configuration from config.json.
 *
 * @returns {Object} Judge config
 */
function getEvalConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_EVAL_CONFIG,
    ...(config.eval || {})
  };
}

/**
 * Build the judge composition (which models and how many).
 *
 * @returns {{ model: string, count: number }[]}
 */
function getJudgeComposition() {
  const config = getEvalConfig();
  const judges = [];

  if (config.judges.opus > 0) {
    judges.push({ model: 'opus', count: config.judges.opus });
  }
  if (config.judges.sonnet > 0) {
    judges.push({ model: 'sonnet', count: config.judges.sonnet });
  }

  return judges;
}

/**
 * Format eval results for display.
 *
 * @param {Object} evalResult - Full eval result
 * @returns {string} Formatted display
 */
function formatEvalResults(evalResult) {
  const lines = [];
  const { taskId, aggregated, judgeResults } = evalResult;

  lines.push('Eval Results');
  lines.push('═'.repeat(50));
  lines.push(`Task: ${taskId}`);
  lines.push(`Judges: ${aggregated.judgeCount} (confidence: ${aggregated.confidence})`);
  lines.push(`Overall: ${aggregated.overall}/10`);
  lines.push('');
  lines.push('Dimension Scores (median):');
  lines.push('─'.repeat(40));

  for (const dim of SCORING_DIMENSIONS) {
    const score = aggregated.scores[dim];
    const bar = '█'.repeat(Math.round(score)) + '░'.repeat(10 - Math.round(score));
    lines.push(`  ${dim.padEnd(22)} ${bar} ${score}/10`);
  }

  if (judgeResults && judgeResults.length > 0) {
    lines.push('');
    lines.push('Individual Judges:');
    lines.push('─'.repeat(40));

    for (let i = 0; i < judgeResults.length; i++) {
      const j = judgeResults[i];
      if (j.notes) {
        lines.push(`  Judge ${i + 1} (${j.model}): ${j.notes}`);
      }
    }
  }

  const config = getEvalConfig();
  const passing = aggregated.overall >= config.passingThreshold;
  lines.push('');
  lines.push(passing
    ? `PASS (threshold: ${config.passingThreshold})`
    : `FAIL (threshold: ${config.passingThreshold})`
  );

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command] = process.argv.slice(2);

  switch (command) {
    case 'config':
      console.log(JSON.stringify(getEvalConfig(), null, 2));
      break;

    case 'composition':
      console.log(JSON.stringify(getJudgeComposition(), null, 2));
      break;

    default:
      console.log(`
Eval Judge

Usage: flow-eval-judge.js <command>

Commands:
  config        Show eval configuration
  composition   Show judge composition (models + counts)

Note: Actual judge invocation happens via the Agent tool in /wogi-eval.
This module provides the scoring logic and prompt templates.
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  SCORING_DIMENSIONS,
  buildJudgePrompt,
  median,
  aggregateScores,
  parseJudgeResponse,
  getEvalConfig,
  getJudgeComposition,
  formatEvalResults
};

if (require.main === module) {
  main();
}
