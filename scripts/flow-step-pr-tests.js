#!/usr/bin/env node

/**
 * Wogi Flow - PR Test Analyzer Step
 *
 * Analyzes test coverage and quality for modified files.
 * Checks: coverage for modified files, test quality (mocks, edge cases),
 * and ensures tests exist for new functionality.
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run PR test analysis as a workflow step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {} } = options;
  const checkCoverage = stepConfig.checkCoverage !== false;
  const checkQuality = stepConfig.checkQuality !== false;
  const minCoverageForModified = stepConfig.minCoverageForModified || 70;

  // Filter to source files (not test files)
  const sourceExtensions = ['.js', '.ts', '.jsx', '.tsx'];
  const sourceFiles = files.filter(f =>
    sourceExtensions.some(ext => f.endsWith(ext)) &&
    !f.includes('.test.') &&
    !f.includes('.spec.') &&
    !f.includes('.d.ts') &&
    !f.includes('__tests__') &&
    !f.includes('__mocks__')
  );

  if (sourceFiles.length === 0) {
    return { passed: true, message: 'No source files to analyze' };
  }

  const issues = [];
  const coverageReport = {};
  const qualityReport = {};

  // Check coverage for modified files
  if (checkCoverage) {
    const coverageIssues = await analyzeCoverage(sourceFiles, minCoverageForModified);
    issues.push(...coverageIssues.issues);
    Object.assign(coverageReport, coverageIssues.report);
  }

  // Check test quality
  if (checkQuality) {
    const qualityIssues = await analyzeTestQuality(sourceFiles, files);
    issues.push(...qualityIssues.issues);
    Object.assign(qualityReport, qualityIssues.report);
  }

  // Report findings
  if (issues.length > 0) {
    console.log(colors.yellow + '\n  PR Test Analysis Issues:' + colors.reset);
    for (const issue of issues) {
      const icon = issue.severity === 'high' ? '\u{1F534}' : '\u{1F7E1}';
      console.log(`    ${icon} ${issue.file}`);
      console.log(`       ${issue.type}: ${issue.message}`);
      if (issue.suggestion) {
        console.log(colors.dim + `       \u{2192} ${issue.suggestion}` + colors.reset);
      }
    }
  }

  const highSeverity = issues.filter(i => i.severity === 'high');

  return {
    passed: highSeverity.length === 0,
    message: issues.length === 0
      ? `Test analysis passed (${sourceFiles.length} files)`
      : `${issues.length} issue(s) found (${highSeverity.length} high severity)`,
    details: {
      issues,
      coverage: coverageReport,
      quality: qualityReport,
    },
  };
}

/**
 * Analyze test coverage for modified files
 */
async function analyzeCoverage(sourceFiles, minCoverage) {
  const issues = [];
  const report = { checked: [], missing: [], below: [] };

  // Check if coverage report exists
  const coveragePath = path.join(PROJECT_ROOT, 'coverage', 'coverage-summary.json');
  let coverageData = null;

  if (fs.existsSync(coveragePath)) {
    try {
      coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    } catch (err) {
      // Can't read coverage
    }
  }

  for (const file of sourceFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    // Find corresponding test file
    const testPatterns = [
      file.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1'),
      file.replace(/\.(js|ts|jsx|tsx)$/, '.spec.$1'),
      file.replace(/src\//, 'src/__tests__/').replace(/\.(js|ts|jsx|tsx)$/, '.test.$1'),
      file.replace(/src\//, 'tests/').replace(/\.(js|ts|jsx|tsx)$/, '.test.$1'),
    ];

    const hasTest = testPatterns.some(pattern => {
      const testPath = path.join(PROJECT_ROOT, pattern);
      return fs.existsSync(testPath);
    });

    if (!hasTest) {
      // Check if file exports anything testable
      const content = fs.readFileSync(filePath, 'utf8');
      const hasExports = /export\s+(?:default\s+)?(?:function|class|const|let|var)|module\.exports/.test(content);

      if (hasExports) {
        issues.push({
          file,
          type: 'Missing Tests',
          severity: 'high',
          message: 'No test file found for source file with exports',
          suggestion: `Create ${testPatterns[0]}`,
        });
        report.missing.push(file);
      }
      continue;
    }

    report.checked.push(file);

    // Check coverage if available
    if (coverageData) {
      const absPath = path.resolve(PROJECT_ROOT, file);
      const fileCoverage = coverageData[absPath];

      if (fileCoverage) {
        const lineCoverage = fileCoverage.lines?.pct || 0;
        const branchCoverage = fileCoverage.branches?.pct || 0;
        const avgCoverage = (lineCoverage + branchCoverage) / 2;

        if (avgCoverage < minCoverage) {
          issues.push({
            file,
            type: 'Low Coverage',
            severity: avgCoverage < minCoverage / 2 ? 'high' : 'medium',
            message: `Coverage ${avgCoverage.toFixed(1)}% is below ${minCoverage}% threshold`,
            suggestion: 'Add tests for uncovered lines and branches',
          });
          report.below.push({ file, coverage: avgCoverage });
        }
      }
    }
  }

  return { issues, report };
}

/**
 * Analyze test quality for modified files
 */
async function analyzeTestQuality(sourceFiles, allFiles) {
  const issues = [];
  const report = { analyzed: [], concerns: [] };

  // Find test files in the changeset
  const testFiles = allFiles.filter(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')
  );

  for (const testFile of testFiles) {
    const testPath = path.join(PROJECT_ROOT, testFile);
    if (!fs.existsSync(testPath)) continue;

    try {
      const content = fs.readFileSync(testPath, 'utf8');
      report.analyzed.push(testFile);

      // Check for test quality issues
      const qualityChecks = analyzeTestFile(content, testFile);
      issues.push(...qualityChecks);

      if (qualityChecks.length > 0) {
        report.concerns.push({ file: testFile, issues: qualityChecks.length });
      }
    } catch (err) {
      // Skip unreadable files
    }
  }

  // Also check source files for testability concerns
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(PROJECT_ROOT, sourceFile);
    if (!fs.existsSync(sourcePath)) continue;

    try {
      const content = fs.readFileSync(sourcePath, 'utf8');
      const testabilityIssues = checkTestability(content, sourceFile);
      issues.push(...testabilityIssues);
    } catch (err) {
      // Skip unreadable files
    }
  }

  return { issues, report };
}

/**
 * Analyze a test file for quality issues
 */
function analyzeTestFile(content, fileName) {
  const issues = [];

  // Check for empty tests
  const emptyTests = content.match(/(?:it|test)\s*\([^)]+,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/g);
  if (emptyTests) {
    issues.push({
      file: fileName,
      type: 'Empty Tests',
      severity: 'high',
      message: `${emptyTests.length} empty test(s) found`,
      suggestion: 'Add assertions to empty tests or remove them',
    });
  }

  // Check for skipped tests
  const skippedTests = (content.match(/(?:it|test|describe)\.skip/g) || []).length;
  if (skippedTests > 0) {
    issues.push({
      file: fileName,
      type: 'Skipped Tests',
      severity: 'medium',
      message: `${skippedTests} skipped test(s)`,
      suggestion: 'Fix or remove skipped tests before PR',
    });
  }

  // Check for focused tests (only)
  const focusedTests = (content.match(/(?:it|test|describe)\.only/g) || []).length;
  if (focusedTests > 0) {
    issues.push({
      file: fileName,
      type: 'Focused Tests',
      severity: 'high',
      message: `${focusedTests} focused test(s) - will skip other tests`,
      suggestion: 'Remove .only before committing',
    });
  }

  // Check for proper assertions
  const testCount = (content.match(/(?:it|test)\s*\(/g) || []).length;
  const assertionCount = (content.match(/expect\s*\(|assert\./g) || []).length;

  if (testCount > 0 && assertionCount < testCount) {
    issues.push({
      file: fileName,
      type: 'Missing Assertions',
      severity: 'medium',
      message: `${testCount} tests but only ${assertionCount} assertions`,
      suggestion: 'Each test should have at least one assertion',
    });
  }

  // Check for excessive mocking
  const mockCount = (content.match(/jest\.mock|vi\.mock|sinon\.stub|\.mockImplementation/g) || []).length;
  if (mockCount > 10) {
    issues.push({
      file: fileName,
      type: 'Excessive Mocking',
      severity: 'medium',
      message: `${mockCount} mocks - tests may be too coupled to implementation`,
      suggestion: 'Consider testing behavior rather than implementation',
    });
  }

  // Check for hardcoded timeouts
  if (/setTimeout\s*\(\s*[^,]+,\s*\d{4,}/.test(content)) {
    issues.push({
      file: fileName,
      type: 'Hardcoded Timeout',
      severity: 'medium',
      message: 'Test uses hardcoded timeout - may cause flaky tests',
      suggestion: 'Use fake timers or waitFor utilities instead',
    });
  }

  // Check for missing error case tests
  const hasErrorTests = /error|throw|reject|fail|catch/i.test(content);
  if (!hasErrorTests && testCount > 3) {
    issues.push({
      file: fileName,
      type: 'Missing Error Tests',
      severity: 'medium',
      message: 'No error/edge case tests found',
      suggestion: 'Add tests for error conditions and edge cases',
    });
  }

  return issues;
}

/**
 * Check source file for testability concerns
 */
function checkTestability(content, fileName) {
  const issues = [];

  // Check for hard-to-test patterns
  const singletonPattern = /(?:let|var)\s+instance\s*=\s*null.*getInstance/s;
  if (singletonPattern.test(content)) {
    issues.push({
      file: fileName,
      type: 'Singleton Pattern',
      severity: 'medium',
      message: 'Singleton pattern makes testing difficult',
      suggestion: 'Consider dependency injection instead',
    });
  }

  // Check for direct environment access
  const envAccess = (content.match(/process\.env\.\w+/g) || []).length;
  if (envAccess > 3) {
    issues.push({
      file: fileName,
      type: 'Direct Env Access',
      severity: 'medium',
      message: `${envAccess} direct process.env accesses`,
      suggestion: 'Consider using a config module for easier test mocking',
    });
  }

  // Check for complex constructors
  const complexConstructor = /constructor\s*\([^)]*\)\s*\{[^}]{300,}\}/s;
  if (complexConstructor.test(content)) {
    issues.push({
      file: fileName,
      type: 'Complex Constructor',
      severity: 'medium',
      message: 'Constructor has complex logic - hard to test',
      suggestion: 'Move initialization logic to separate methods',
    });
  }

  return issues;
}

module.exports = { run, analyzeCoverage, analyzeTestQuality };
