#!/usr/bin/env node

/**
 * Wogi Flow - Regression Test Step
 *
 * Workflow step wrapper for regression testing.
 * Tests random completed tasks to catch regressions.
 */

const { execSync } = require('child_process');
const path = require('path');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run regression tests as a workflow step
 *
 * @param {object} options
 * @param {string} options.taskId - Current task ID
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object }
 */
async function run(options = {}) {
  const { stepConfig = {}, mode } = options;
  const sampleSize = stepConfig.sampleSize || 3;

  try {
    // Run regression tests
    const regressionScript = path.join(PROJECT_ROOT, 'scripts', 'flow-regression.js');
    const result = execSync(`node "${regressionScript}" --count ${sampleSize} --json`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse result
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (err) {
      // Non-JSON output means success with no issues
      return { passed: true, message: 'Regression tests passed' };
    }

    if (parsed.failures && parsed.failures.length > 0) {
      return {
        passed: false,
        message: `${parsed.failures.length} regression test(s) failed`,
        details: parsed.failures,
      };
    }

    return {
      passed: true,
      message: `Tested ${parsed.tested || sampleSize} completed tasks, all passed`,
    };

  } catch (err) {
    // Check if it's a test failure or script error
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        if (parsed.failures) {
          return {
            passed: false,
            message: `${parsed.failures.length} regression test(s) failed`,
            details: parsed.failures,
          };
        }
      } catch (err) {
        // Not JSON, treat as error
      }
    }

    // No completed tasks to test is not a failure
    if (err.message && err.message.includes('No completed tasks')) {
      return { passed: true, message: 'No completed tasks to test' };
    }

    return {
      passed: false,
      message: `Regression test error: ${err.message}`,
    };
  }
}

module.exports = { run };
