#!/usr/bin/env node

/**
 * Wogi Flow - Quality Gate Report Formatting
 *
 * Extracted from flow-done.js — formats quality gate results,
 * error recovery analysis, and failure artifacts.
 */

const path = require('node:path');
const { PATHS, color, writeJson } = require('./flow-utils');

// v3.1 recursive error recovery (optional)
let errorRecovery;
try {
  errorRecovery = require('./flow-error-recovery');
} catch (_err) {
  errorRecovery = null;
}

let hypothesisGenerator;
try {
  hypothesisGenerator = require('./flow-hypothesis-generator');
} catch (_err) {
  hypothesisGenerator = null;
}

const LAST_FAILURE_PATH = path.join(PATHS.state, 'last-failure.json');

/**
 * Print the summary of failed gates.
 * @param {string[]} failed - List of failed gate names
 */
function printFailureSummary(failed) {
  if (failed.length > 0) {
    console.log('');
    console.log(color('red', `Failed gates: ${failed.join(', ')}`));
  }
}

/**
 * Save a failure artifact to disk for AI self-repair.
 * @param {string} taskId
 * @param {string[]} failedGates
 * @param {object} errors - Map of gate name to error output
 */
function saveFailureArtifact(taskId, failedGates, errors) {
  try {
    writeJson(LAST_FAILURE_PATH, {
      taskId,
      timestamp: new Date().toISOString(),
      failedGates,
      errors
    });
    console.log('');
    console.log(color('dim', `Failure details saved to: ${LAST_FAILURE_PATH}`));
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Failed to save failure artifact: ${err.message}`);
  }
}

/**
 * Print error recovery analysis with hypotheses for failed gates.
 * @param {object} gateResult - { failed: string[], errors: object }
 * @param {object} config - Project config
 */
function printErrorRecoveryAnalysis(gateResult, config) {
  if (!errorRecovery || config.errorRecovery?.enabled === false) return;

  console.log('');
  console.log(color('cyan', '\u2501'.repeat(50)));
  console.log(color('cyan', 'Error Recovery Analysis'));
  console.log(color('cyan', '\u2501'.repeat(50)));

  for (const gate of gateResult.failed) {
    const errorText = gateResult.errors[gate] || '';
    if (!errorText) continue;

    try {
      const classified = errorRecovery.classifyError(errorText);
      const levelName = errorRecovery.getLevelName(classified.level);
      console.log(`${gate}: ${color('yellow', levelName || 'unknown')} error`);

      const suggestions = errorRecovery.getSuggestedFixes(classified.level, errorText);
      if (suggestions?.length > 0) {
        console.log('  Suggested fixes:');
        suggestions.slice(0, 3).forEach(fix => {
          console.log(`    \u2192 ${fix}`);
        });
      }

      if (hypothesisGenerator) {
        const hypotheses = hypothesisGenerator.generateHypotheses(errorText, classified);
        if (hypotheses?.length > 0) {
          console.log('  Hypotheses:');
          hypotheses.slice(0, 2).forEach(h => {
            console.log(`    \u2022 ${h.hypothesis} (${Math.round(h.likelihood * 100)}% likelihood)`);
          });
        }
      }
      console.log('');
    } catch (analysisErr) {
      if (process.env.DEBUG) console.error(`[DEBUG] Error analysis: ${analysisErr.message}`);
    }
  }
}

/**
 * Print the final failure message with tips.
 */
function printFinalFailureMessage() {
  console.log('');
  color('red', 'Quality gates failed. Fix issues before completing.');
  console.log(color('red', 'Quality gates failed. Fix issues before completing.'));
  console.log(color('dim', 'Tip: Review the error output above or check .workflow/state/last-failure.json'));
}

module.exports = {
  LAST_FAILURE_PATH,
  printFailureSummary,
  saveFailureArtifact,
  printErrorRecoveryAnalysis,
  printFinalFailureMessage,
};
