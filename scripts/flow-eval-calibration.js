#!/usr/bin/env node

/**
 * Wogi Flow - Eval Calibration
 *
 * Stores and retrieves calibrated eval examples for anchoring judge scores.
 * Prevents score drift by providing few-shot examples of what high and low
 * scores look like in practice.
 *
 * Based on Anthropic's harness design research finding that "few-shot examples
 * with detailed score breakdowns calibrated evaluator judgment, reducing score
 * drift across iterations."
 *
 * Usage:
 *   node flow-eval-calibration.js save <taskId> <quality>  — save as calibration example
 *   node flow-eval-calibration.js get                       — get calibration examples for prompt injection
 *   node flow-eval-calibration.js list                      — list all calibration examples
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse, writeJson } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const CALIBRATION_PATH = path.join(PATHS.state, 'eval-calibration.json');
const MAX_EXAMPLES_PER_QUALITY = 3; // Keep 3 high, 3 low

// ============================================================
// Storage
// ============================================================

/**
 * Load calibration data
 * @returns {Object} { high: [], low: [], lastUpdated }
 */
function loadCalibration() {
  return safeJsonParse(CALIBRATION_PATH, {
    high: [],
    low: [],
    lastUpdated: null
  });
}

/**
 * Save a completed eval as a calibration example.
 * Called after /wogi-eval produces scores.
 *
 * @param {Object} params
 * @param {string} params.taskId — the task that was evaluated
 * @param {string} params.quality — "high" or "low"
 * @param {Object} params.scores — { completeness, accuracy, workflowCompliance, tokenEfficiency, quality }
 * @param {string} params.specSummary — brief spec description (first 500 chars)
 * @param {string} params.diffSummary — brief diff description (file count, line count)
 * @param {string} params.notes — judge's justification notes
 */
function saveCalibrationExample(params) {
  const { taskId, quality, scores, specSummary, diffSummary, notes } = params;

  if (quality !== 'high' && quality !== 'low') {
    throw new Error('Quality must be "high" or "low"');
  }

  const cal = loadCalibration();
  const example = {
    taskId,
    scores,
    specSummary: (specSummary || '').slice(0, 500),
    diffSummary: (diffSummary || '').slice(0, 200),
    notes: (notes || '').slice(0, 500),
    savedAt: new Date().toISOString()
  };

  cal[quality].unshift(example);

  // Keep only MAX_EXAMPLES_PER_QUALITY
  if (cal[quality].length > MAX_EXAMPLES_PER_QUALITY) {
    cal[quality] = cal[quality].slice(0, MAX_EXAMPLES_PER_QUALITY);
  }

  cal.lastUpdated = new Date().toISOString();
  writeJson(CALIBRATION_PATH, cal);

  return example;
}

/**
 * Auto-classify and save an eval result as calibration.
 * High = average score >= 8. Low = average score <= 4.
 *
 * @param {Object} evalResult — from flow-eval.js
 * @returns {Object|null} saved example or null if score is in the middle range
 */
function autoSaveFromEval(evalResult) {
  if (!evalResult || !evalResult.scores) return null;

  const scores = evalResult.scores;
  const values = Object.values(scores).filter(v => typeof v === 'number');
  if (values.length === 0) return null;

  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

  let quality = null;
  if (avg >= 8) quality = 'high';
  else if (avg <= 4) quality = 'low';
  else return null; // Middle range — not a good calibration anchor

  return saveCalibrationExample({
    taskId: evalResult.taskId,
    quality,
    scores,
    specSummary: evalResult.specSummary || '',
    diffSummary: evalResult.diffSummary || '',
    notes: evalResult.notes || ''
  });
}

// ============================================================
// Retrieval (for prompt injection)
// ============================================================

/**
 * Get calibration examples formatted for injection into judge/evaluator prompts.
 * Returns 1 high + 1 low example (if available).
 *
 * @returns {string} formatted calibration text, or empty string if no examples
 */
function getCalibrationPrompt() {
  const cal = loadCalibration();
  const parts = [];

  if (cal.high.length > 0) {
    const ex = cal.high[0];
    parts.push(`## Calibration Example: HIGH QUALITY (reference)

**Task**: ${ex.taskId}
**Spec**: ${ex.specSummary}
**Scores**: completeness=${ex.scores.completeness}, accuracy=${ex.scores.accuracy}, workflowCompliance=${ex.scores.workflowCompliance}, tokenEfficiency=${ex.scores.tokenEfficiency}, quality=${ex.scores.quality}
**Why this scored high**: ${ex.notes}`);
  }

  if (cal.low.length > 0) {
    const ex = cal.low[0];
    parts.push(`## Calibration Example: LOW QUALITY (reference)

**Task**: ${ex.taskId}
**Spec**: ${ex.specSummary}
**Scores**: completeness=${ex.scores.completeness}, accuracy=${ex.scores.accuracy}, workflowCompliance=${ex.scores.workflowCompliance}, tokenEfficiency=${ex.scores.tokenEfficiency}, quality=${ex.scores.quality}
**Why this scored low**: ${ex.notes}`);
  }

  if (parts.length === 0) return '';

  return `
## Score Calibration (anchoring examples)

Use these real examples to calibrate your scoring. They represent the extremes of the scale — most tasks should score between these.

${parts.join('\n\n')}

---
`;
}

/**
 * Get calibration examples as structured data
 * @returns {{ high: Object|null, low: Object|null }}
 */
function getCalibrationExamples() {
  const cal = loadCalibration();
  return {
    high: cal.high[0] || null,
    low: cal.low[0] || null
  };
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'save': {
      const taskId = args[1];
      const quality = args[2];
      if (!taskId || !quality) {
        console.error('Usage: flow-eval-calibration.js save <taskId> <high|low>');
        process.exit(1);
      }
      // Read scores from stdin or eval results
      const evalsDir = path.join(PATHS.workflow, 'evals');
      const evalFiles = fs.existsSync(evalsDir) ? fs.readdirSync(evalsDir).filter(f => f.includes(taskId)) : [];
      if (evalFiles.length === 0) {
        console.error(`No eval results found for task ${taskId}`);
        process.exit(1);
      }
      const evalResult = safeJsonParse(path.join(evalsDir, evalFiles[0]), null);
      if (evalResult) {
        const saved = saveCalibrationExample({
          taskId,
          quality,
          scores: evalResult.aggregated || evalResult.scores || {},
          specSummary: evalResult.spec?.substring(0, 500) || '',
          diffSummary: `${(evalResult.changedFiles || []).length} files changed`,
          notes: evalResult.notes || evalResult.aggregated?.notes || ''
        });
        console.log(`Saved ${quality} calibration example: ${saved.taskId}`);
      }
      break;
    }

    case 'get':
      console.log(getCalibrationPrompt() || 'No calibration examples yet.');
      break;

    case 'list': {
      const cal = loadCalibration();
      console.log(`High examples: ${cal.high.length}`);
      for (const ex of cal.high) {
        const avg = Object.values(ex.scores).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0) / 5;
        console.log(`  ${ex.taskId} — avg ${avg.toFixed(1)} (${ex.savedAt})`);
      }
      console.log(`Low examples: ${cal.low.length}`);
      for (const ex of cal.low) {
        const avg = Object.values(ex.scores).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0) / 5;
        console.log(`  ${ex.taskId} — avg ${avg.toFixed(1)} (${ex.savedAt})`);
      }
      break;
    }

    default:
      console.log('Usage: flow-eval-calibration.js <save|get|list>');
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  loadCalibration,
  saveCalibrationExample,
  autoSaveFromEval,
  getCalibrationPrompt,
  getCalibrationExamples
};

if (require.main === module) {
  main();
}
