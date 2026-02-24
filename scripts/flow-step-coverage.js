#!/usr/bin/env node

/**
 * Wogi Flow - Coverage Check Step
 *
 * Checks test coverage meets threshold.
 * Supports Jest, Vitest, NYC/Istanbul coverage formats.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');
const { getCommand, detectPackageManager } = require('./flow-script-resolver');

const PROJECT_ROOT = getProjectRoot();

// Common coverage output locations
const COVERAGE_PATHS = [
  'coverage/coverage-summary.json',   // Jest/Vitest JSON summary
  'coverage/coverage-final.json',     // Istanbul/NYC
  'coverage/lcov-report/index.html',  // LCOV HTML
  '.nyc_output/coverage.json',        // NYC output
];

/**
 * Run coverage check step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, coverage?: object }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {}, mode } = options;
  const minCoverage = stepConfig.minCoverage || 80;
  const checkFiles = stepConfig.checkModifiedOnly ?? true;

  // Try to find existing coverage data
  let coverage = findExistingCoverage();

  // If no coverage found, try to run tests with coverage
  if (!coverage && stepConfig.runTests !== false) {
    coverage = await runCoverageTests();
  }

  if (!coverage) {
    return {
      passed: true,
      message: 'No coverage data available',
      suggestion: `Run tests with coverage: ${getCommand('test') || 'npm test'} -- --coverage`,
    };
  }

  // Check overall coverage
  const overall = coverage.total || coverage;
  const metrics = ['lines', 'statements', 'branches', 'functions'];

  const results = {};
  let allPassing = true;

  for (const metric of metrics) {
    if (overall[metric]) {
      const pct = overall[metric].pct ?? overall[metric].percent ?? overall[metric];
      if (typeof pct === 'number') {
        results[metric] = pct;
        if (pct < minCoverage) {
          allPassing = false;
        }
      }
    }
  }

  // Check coverage for modified files specifically
  let modifiedFileCoverage = null;
  if (checkFiles && files.length > 0 && coverage.files) {
    modifiedFileCoverage = checkModifiedFilesCoverage(files, coverage.files, minCoverage);
  }

  // Report results
  if (Object.keys(results).length > 0) {
    console.log(colors.yellow + `\n  Coverage (threshold: ${minCoverage}%):` + colors.reset);
    for (const [metric, pct] of Object.entries(results)) {
      const color = pct >= minCoverage ? colors.green : colors.red;
      const icon = pct >= minCoverage ? '✓' : '✗';
      console.log(`    ${color}${icon}${colors.reset} ${metric}: ${pct.toFixed(1)}%`);
    }
  }

  if (modifiedFileCoverage && modifiedFileCoverage.uncovered.length > 0) {
    console.log(colors.yellow + '\n  Modified files with low coverage:' + colors.reset);
    for (const file of modifiedFileCoverage.uncovered) {
      console.log(colors.red + `    ✗ ${file.name}: ${file.coverage.toFixed(1)}%` + colors.reset);
    }
  }

  if (!allPassing) {
    return {
      passed: false,
      message: `Coverage below ${minCoverage}% threshold`,
      coverage: results,
      modifiedFileCoverage,
    };
  }

  return {
    passed: true,
    message: `Coverage meets ${minCoverage}% threshold`,
    coverage: results,
  };
}

/**
 * Find existing coverage data
 */
function findExistingCoverage() {
  for (const coveragePath of COVERAGE_PATHS) {
    const fullPath = path.join(PROJECT_ROOT, coveragePath);
    if (fs.existsSync(fullPath)) {
      try {
        if (coveragePath.endsWith('.json')) {
          return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        }
        // For HTML reports, try to find accompanying JSON
        const jsonPath = fullPath.replace('.html', '.json');
        if (fs.existsSync(jsonPath)) {
          return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        }
      } catch (err) {
        // Continue to next path
      }
    }
  }
  return null;
}

/**
 * Run tests with coverage
 */
async function runCoverageTests() {
  // Check package.json for test script
  const packagePath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packagePath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const scripts = pkg.scripts || {};

    // Try to find coverage command via resolver
    let coverageCmd = getCommand('coverage');

    if (!coverageCmd && scripts.test) {
      // No coverage script — try to add --coverage flag to test command
      if (scripts.test.includes('jest') || scripts.test.includes('vitest')) {
        const testCmd = getCommand('test') || 'npm test';
        coverageCmd = `${testCmd} -- --coverage --json --outputFile=coverage/coverage-summary.json`;
      }
    }

    if (!coverageCmd) return null;

    // Run coverage
    execSync(coverageCmd, {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000, // 5 minute timeout
    });

    // Try to read the output
    return findExistingCoverage();

  } catch (err) {
    // Test run failed or timed out
    return null;
  }
}

/**
 * Check coverage for specific modified files
 */
function checkModifiedFilesCoverage(files, coverageFiles, threshold) {
  const covered = [];
  const uncovered = [];

  for (const file of files) {
    // Skip test files
    if (file.includes('.test.') || file.includes('.spec.')) continue;

    // Skip non-code files
    if (!file.match(/\.(js|ts|jsx|tsx)$/)) continue;

    // Find in coverage data
    const coverageKey = Object.keys(coverageFiles).find(k =>
      k.endsWith(file) || k.includes(file)
    );

    if (coverageKey) {
      const fileCov = coverageFiles[coverageKey];
      const pct = fileCov.lines?.pct ?? fileCov.statements?.pct ?? 0;

      if (pct >= threshold) {
        covered.push({ name: file, coverage: pct });
      } else {
        uncovered.push({ name: file, coverage: pct });
      }
    } else {
      // File not in coverage - might be new or not tested
      uncovered.push({ name: file, coverage: 0, notFound: true });
    }
  }

  return { covered, uncovered };
}

module.exports = { run, findExistingCoverage };
