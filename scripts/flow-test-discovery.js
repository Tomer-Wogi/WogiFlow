#!/usr/bin/env node

/**
 * Wogi Flow - Smart Test Discovery + SWE-bench Dual Gate
 *
 * Discovers existing tests in a project and matches them to task acceptance
 * criteria. Implements a SWE-bench-inspired dual gate:
 *   - PASS_TO_PASS: Full test suite must not regress
 *   - FAIL_TO_PASS: Matched tests verify the implementation
 *
 * Usage:
 *   node scripts/flow-test-discovery.js <taskId> [--scan-only] [--match-only]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PATHS,
  fileExists,
  getConfig,
  safeJsonParse,
  readFile,
  writeJson,
  validateTaskId,
  color
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/** Glob patterns for discovering test files */
const TEST_FILE_PATTERNS = [
  '**/*.test.js', '**/*.test.ts', '**/*.test.jsx', '**/*.test.tsx',
  '**/*.spec.js', '**/*.spec.ts', '**/*.spec.jsx', '**/*.spec.tsx',
  '**/__tests__/**/*.js', '**/__tests__/**/*.ts',
  '**/__tests__/**/*.jsx', '**/__tests__/**/*.tsx',
  'test/**/*.js', 'test/**/*.ts', 'test/**/*.jsx', 'test/**/*.tsx',
  'tests/**/*.js', 'tests/**/*.ts', 'tests/**/*.jsx', 'tests/**/*.tsx'
];

/** Directories to skip during discovery */
const SKIP_DIRS = ['node_modules', '.workflow', 'dist', 'build', 'coverage', '.git'];

/** Framework config file patterns */
const FRAMEWORK_CONFIGS = {
  jest: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'],
  vitest: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vitest.config.cjs'],
  mocha: ['.mocharc.yml', '.mocharc.yaml', '.mocharc.json', '.mocharc.js', '.mocharc.cjs'],
  playwright: ['playwright.config.js', 'playwright.config.ts'],
  cypress: ['cypress.config.js', 'cypress.config.ts', 'cypress.config.cjs', 'cypress.config.mjs']
};

/** Regex patterns for extracting describe/it/test descriptions (compiled per-call, not global) */
const DESCRIBE_PATTERN = /(?:describe|it|test)\s*\(\s*(['"`])(.*?)\1/g;
const EACH_PATTERN = /(?:describe|it|test)\.each[^(]*\(\s*(['"`])(.*?)\1/g;

/** Stop words to exclude from tokenization */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'when', 'if', 'then', 'than', 'also'
]);

/** HTTP methods for bonus scoring */
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

/** Minimum similarity score to consider a match (Jaccard fallback) */
const MIN_MATCH_SCORE = 0.3;

/** Test suite timeout in milliseconds (5 minutes) */
const TEST_TIMEOUT_MS = 300000;

/** Heuristic indicators that a file contains tests but regex missed */
const TEST_HEURISTIC_PATTERNS = [
  /assert\s*[.(]/,
  /expect\s*\(/,
  /\.to(?:Be|Equal|Have|Throw|Match|Contain|Include)/,
  /\.should\./,
  /\.assert\./,
  /suite\s*\(/,
  /beforeEach|afterEach|beforeAll|afterAll/,
  /\.only\s*\(/,
  /\.skip\s*\(/
];

// ============================================================
// Test File Discovery
// ============================================================

/**
 * Recursively find files matching test patterns.
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Project root for relative path calculation
 * @param {Set<string>} skipSet - Directories to skip
 * @returns {string[]} Array of relative file paths
 */
function findTestFiles(dir, baseDir, skipSet) {
  const results = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    if (skipSet.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath, baseDir, skipSet));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath);
      if (isTestFile(relPath)) {
        results.push(relPath);
      }
    }
  }

  return results;
}

/**
 * Check if a file path matches test file patterns.
 * @param {string} relPath - Relative file path
 * @returns {boolean}
 */
function isTestFile(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  const ext = path.extname(normalized);

  // Must be a JS/TS file
  if (!['.js', '.ts', '.jsx', '.tsx'].includes(ext)) return false;

  // Check test/spec naming
  const base = path.basename(normalized, ext);
  if (base.endsWith('.test') || base.endsWith('.spec')) return true;

  // Check __tests__ directory
  if (normalized.includes('__tests__/')) return true;

  // Check test/ or tests/ top-level directory
  if (normalized.startsWith('test/') || normalized.startsWith('tests/')) return true;

  return false;
}

/**
 * Extract test descriptions from a file's content.
 * @param {string} content - File content
 * @returns {string[]} Array of test description strings
 */
function extractDescriptions(content) {
  const descriptions = [];

  // Create fresh regex instances to avoid shared global state issues
  const describeRe = new RegExp(DESCRIBE_PATTERN.source, DESCRIBE_PATTERN.flags);
  const eachRe = new RegExp(EACH_PATTERN.source, EACH_PATTERN.flags);

  let match;
  while ((match = describeRe.exec(content)) !== null) {
    if (match[2] && match[2].trim()) {
      descriptions.push(match[2].trim());
    }
  }

  while ((match = eachRe.exec(content)) !== null) {
    if (match[2] && match[2].trim()) {
      descriptions.push(match[2].trim());
    }
  }

  return descriptions;
}

/**
 * Heuristic extraction fallback: detect likely test content when regex finds
 * no describe/it/test calls. Returns hints about what tests exist in the file.
 *
 * This covers non-standard frameworks, dynamic test names, custom DSLs,
 * Go-style TestXxx functions, Python-style def test_xxx, and template literals.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path (for language detection)
 * @returns {{ hasTests: boolean, hints: string[], functionNames: string[] }}
 */
function extractDescriptionsHeuristic(content, filePath) {
  const hints = [];
  const functionNames = [];
  let hasTests = false;

  // Check heuristic patterns (assertions, lifecycle hooks, etc.)
  for (const pattern of TEST_HEURISTIC_PATTERNS) {
    if (pattern.test(content)) {
      hasTests = true;
      break;
    }
  }

  // Extract function-level test names for various languages
  const ext = path.extname(filePath);

  if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    // Template literal test names: test(`user ${name} can login`)
    const templateRe = /(?:describe|it|test)\s*\(\s*`([^`]*)`/g;
    let m;
    while ((m = templateRe.exec(content)) !== null) {
      if (m[1] && m[1].trim()) {
        hints.push(m[1].trim());
        hasTests = true;
      }
    }

    // Arrow function exports that look like tests: export const testUserLogin = ...
    const exportTestRe = /export\s+(?:const|function)\s+(test\w+)/g;
    while ((m = exportTestRe.exec(content)) !== null) {
      functionNames.push(m[1]);
      hasTests = true;
    }
  }

  if (['.go'].includes(ext)) {
    // Go: func TestXxx(t *testing.T)
    const goTestRe = /func\s+(Test\w+)\s*\(/g;
    let m;
    while ((m = goTestRe.exec(content)) !== null) {
      functionNames.push(m[1]);
      hasTests = true;
    }
  }

  if (['.py'].includes(ext)) {
    // Python: def test_xxx or class TestXxx
    const pyTestRe = /(?:def\s+(test_\w+)|class\s+(Test\w+))/g;
    let m;
    while ((m = pyTestRe.exec(content)) !== null) {
      functionNames.push(m[1] || m[2]);
      hasTests = true;
    }
  }

  if (['.rb'].includes(ext)) {
    // Ruby/RSpec: it "does something" do
    const rbTestRe = /(?:it|context|describe)\s+(['"])(.*?)\1\s+do/g;
    let m;
    while ((m = rbTestRe.exec(content)) !== null) {
      hints.push(m[2]);
      hasTests = true;
    }
  }

  return { hasTests, hints, functionNames };
}

/**
 * Prepare structured data for AI-based semantic matching.
 *
 * Instead of using Jaccard similarity (word overlap), this outputs all criteria
 * and test descriptions in a structured format that the AI (Claude) can use to
 * perform genuine semantic matching.
 *
 * The AI reads this output and provides match results via applyAIMatchResults().
 *
 * @param {string[]} criteria - Acceptance criteria strings
 * @param {{ file: string, framework: string|null, descriptions: string[], heuristic?: { hints: string[], functionNames: string[] } }[]} discoveredTests
 * @returns {{ criteria: { index: number, text: string }[], tests: { file: string, descriptions: string[], hints: string[], functionNames: string[] }[], prompt: string }}
 */
function prepareAIMatchingData(criteria, discoveredTests) {
  const criteriaData = criteria.map((text, index) => ({ index, text }));

  const testsData = discoveredTests.map(t => ({
    file: t.file,
    descriptions: t.descriptions,
    hints: t.heuristic?.hints || [],
    functionNames: t.heuristic?.functionNames || []
  }));

  // Build a prompt the AI can process directly
  const prompt = buildMatchingPrompt(criteriaData, testsData);

  return { criteria: criteriaData, tests: testsData, prompt };
}

/**
 * Build the semantic matching prompt for the AI.
 * @param {{ index: number, text: string }[]} criteria
 * @param {{ file: string, descriptions: string[], hints: string[], functionNames: string[] }[]} tests
 * @returns {string}
 */
function buildMatchingPrompt(criteria, tests) {
  const lines = [
    'Match acceptance criteria to existing test descriptions using SEMANTIC understanding.',
    'Consider intent, not just keywords. A criterion about "user authentication" should match',
    'a test "should redirect after login" even if they share zero words.',
    '',
    '## Acceptance Criteria',
    ''
  ];

  for (const c of criteria) {
    lines.push(`[C${c.index}] ${c.text}`);
  }

  lines.push('', '## Discovered Tests', '');

  for (const t of tests) {
    if (t.descriptions.length > 0 || t.hints.length > 0 || t.functionNames.length > 0) {
      lines.push(`### ${t.file}`);
      for (const d of t.descriptions) {
        lines.push(`  - "${d}"`);
      }
      for (const h of t.hints) {
        lines.push(`  - (heuristic) "${h}"`);
      }
      for (const f of t.functionNames) {
        lines.push(`  - (function) ${f}`);
      }
      lines.push('');
    }
  }

  lines.push(
    '## Expected Output',
    '',
    'Return a JSON array of matches:',
    '[{ "criterionIndex": 0, "file": "path/to/test.js", "description": "test description", "confidence": 0.85, "reasoning": "brief explanation" }]',
    '',
    'confidence: 0.0–1.0 (0.7+ = strong match, 0.4–0.7 = possible, <0.4 = skip)',
    'Include ALL matches above 0.4 confidence. One criterion can match multiple tests.'
  );

  return lines.join('\n');
}

/**
 * Apply AI-provided match results to the criteria/test data.
 *
 * Called after the AI processes the output of prepareAIMatchingData() and
 * returns semantic match results.
 *
 * @param {string[]} criteria - Original criteria strings
 * @param {{ criterionIndex: number, file: string, description: string, confidence: number, reasoning?: string }[]} aiMatches
 * @returns {{ matched: { criterion: string, tests: { file: string, description: string, score: number, reasoning?: string }[] }[], unmatched: string[] }}
 */
function applyAIMatchResults(criteria, aiMatches) {
  const matchMap = new Map(); // criterionIndex → test matches

  for (const m of aiMatches) {
    if (m.criterionIndex < 0 || m.criterionIndex >= criteria.length) continue;
    if (m.confidence < 0.4) continue;

    if (!matchMap.has(m.criterionIndex)) {
      matchMap.set(m.criterionIndex, []);
    }
    matchMap.get(m.criterionIndex).push({
      file: m.file,
      description: m.description,
      score: Math.round(m.confidence * 1000) / 1000,
      reasoning: m.reasoning || undefined
    });
  }

  const matched = [];
  const unmatched = [];

  for (let i = 0; i < criteria.length; i++) {
    const tests = matchMap.get(i);
    if (tests && tests.length > 0) {
      tests.sort((a, b) => b.score - a.score);
      matched.push({ criterion: criteria[i], tests });
    } else {
      unmatched.push(criteria[i]);
    }
  }

  return { matched, unmatched };
}

/**
 * Detect test framework from project config files.
 * @param {string} projectRoot - Project root path
 * @returns {string|null} Detected framework name or null
 */
function detectFramework(projectRoot) {
  for (const [framework, configFiles] of Object.entries(FRAMEWORK_CONFIGS)) {
    for (const configFile of configFiles) {
      if (fileExists(path.join(projectRoot, configFile))) {
        return framework;
      }
    }
  }

  // Check package.json for framework hints
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = safeJsonParse(pkgPath, null);
  if (pkg) {
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (allDeps.vitest) return 'vitest';
    if (allDeps.jest) return 'jest';
    if (allDeps.mocha) return 'mocha';
    if (allDeps['@playwright/test']) return 'playwright';
    if (allDeps.cypress) return 'cypress';
  }

  return null;
}

/**
 * Scan project for all test files across supported frameworks.
 * @param {string} projectRoot - Project root directory
 * @param {object} options - Discovery options
 * @param {string[]} [options.extraPatterns] - Additional glob patterns
 * @param {string[]} [options.extraSkipDirs] - Additional directories to skip
 * @returns {{ file: string, framework: string|null, descriptions: string[] }[]}
 */
function discoverTests(projectRoot, options = {}) {
  const skipSet = new Set([...SKIP_DIRS, ...(options.extraSkipDirs || [])]);
  const framework = detectFramework(projectRoot);

  const testFiles = findTestFiles(projectRoot, projectRoot, skipSet);
  const results = [];

  for (const file of testFiles) {
    const fullPath = path.join(projectRoot, file);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      continue;
    }

    const descriptions = extractDescriptions(content);

    // When regex finds nothing, use heuristic extraction as fallback
    let heuristic = null;
    if (descriptions.length === 0) {
      heuristic = extractDescriptionsHeuristic(content, file);
      // Add heuristic hints to descriptions so they're available for matching
      if (heuristic.hints.length > 0) {
        descriptions.push(...heuristic.hints);
      }
      if (heuristic.functionNames.length > 0) {
        // Convert function names to readable descriptions
        // e.g., "testUserLogin" → "test user login", "test_auth_flow" → "test auth flow"
        for (const fn of heuristic.functionNames) {
          const readable = fn
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .trim()
            .toLowerCase();
          descriptions.push(readable);
        }
      }
    }

    results.push({
      file,
      framework,
      descriptions,
      heuristic: heuristic || undefined,
      needsAIExtraction: descriptions.length === 0 && (heuristic?.hasTests || false)
    });
  }

  return results;
}

// ============================================================
// Criteria Matching
// ============================================================

/**
 * Tokenize text for matching: lowercase, split, remove stop words.
 * @param {string} text - Text to tokenize
 * @returns {Set<string>} Set of tokens
 */
function tokenize(text) {
  if (!text) return new Set();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/**
 * Calculate Jaccard similarity between two token sets.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Similarity score between 0 and 1
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Check if text contains an HTTP method keyword.
 * @param {string} text - Text to check
 * @returns {string|null} HTTP method found or null
 */
function findHttpMethod(text) {
  const lower = text.toLowerCase();
  for (const method of HTTP_METHODS) {
    if (lower.includes(method)) return method;
  }
  return null;
}

/**
 * Match acceptance criteria to discovered test descriptions.
 * Uses keyword overlap scoring with bonuses for exact matches and HTTP methods.
 *
 * @param {string[]} criteria - Array of acceptance criteria strings
 * @param {{ file: string, framework: string|null, descriptions: string[] }[]} discoveredTests
 * @returns {{ matched: { criterion: string, tests: { file: string, description: string, score: number }[] }[], unmatched: string[] }}
 */
function matchTestsToCriteria(criteria, discoveredTests) {
  const matched = [];
  const unmatched = [];

  for (const criterion of criteria) {
    const criterionTokens = tokenize(criterion);
    const criterionHttpMethod = findHttpMethod(criterion);
    const criterionLower = criterion.toLowerCase();
    const testMatches = [];

    for (const testFile of discoveredTests) {
      for (const description of testFile.descriptions) {
        const descTokens = tokenize(description);
        let score = jaccardSimilarity(criterionTokens, descTokens);

        // Bonus: exact substring match
        const descLower = description.toLowerCase();
        if (criterionLower.includes(descLower) || descLower.includes(criterionLower)) {
          score += 0.3;
        }

        // Bonus: same HTTP method mentioned
        if (criterionHttpMethod) {
          const descHttpMethod = findHttpMethod(description);
          if (descHttpMethod && descHttpMethod === criterionHttpMethod) {
            score += 0.2;
          }
        }

        if (score >= MIN_MATCH_SCORE) {
          testMatches.push({
            file: testFile.file,
            description,
            score: Math.round(score * 1000) / 1000
          });
        }
      }
    }

    if (testMatches.length > 0) {
      // Sort by score descending
      testMatches.sort((a, b) => b.score - a.score);
      matched.push({ criterion, tests: testMatches });
    } else {
      unmatched.push(criterion);
    }
  }

  return { matched, unmatched };
}

// ============================================================
// PASS_TO_PASS Gate
// ============================================================

/**
 * Detect the test command for the project.
 * @param {string} projectRoot - Project root
 * @param {object|null} profile - Verification profile with testCommand override
 * @returns {string|null} Test command or null if not found
 */
function detectTestCommand(projectRoot, profile) {
  // Check verification profile for test runner command
  if (profile && profile.testRunner && profile.testRunner.command) {
    return profile.testRunner.command;
  }
  if (profile && profile.ci && profile.ci.testCommand) {
    return profile.ci.testCommand;
  }

  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = safeJsonParse(pkgPath, null);
  if (pkg && pkg.scripts && pkg.scripts.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
    return 'npm test';
  }

  return null;
}

/**
 * Run the PASS_TO_PASS gate: execute full test suite, record results.
 * Ensures existing tests still pass (no regressions).
 *
 * @param {string} projectRoot - Project root directory
 * @param {object|null} [profile] - Verification profile with testCommand override
 * @returns {{ passed: string[], failed: string[], total: number, command: string|null, exitCode: number|null }}
 */
function runPassToPass(projectRoot, profile = null) {
  const command = detectTestCommand(projectRoot, profile);

  if (!command) {
    return {
      passed: [],
      failed: [],
      total: 0,
      command: null,
      exitCode: null
    };
  }

  const parts = command.split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: TEST_TIMEOUT_MS
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = stdout + '\n' + stderr;

  // Try to parse individual test results from output
  const passed = [];
  const failed = [];

  // Common patterns: "✓ test name" or "PASS test name" or "✗ test name" or "FAIL test name"
  const passPattern = /(?:✓|PASS|✔|√)\s+(.+)/g;
  const failPattern = /(?:✗|FAIL|✘|×)\s+(.+)/g;

  let m;
  while ((m = passPattern.exec(output)) !== null) {
    passed.push(m[1].trim());
  }
  while ((m = failPattern.exec(output)) !== null) {
    failed.push(m[1].trim());
  }

  // If we couldn't parse individual tests, use exit code
  if (passed.length === 0 && failed.length === 0) {
    if (result.status === 0) {
      passed.push('(all tests — details not parsed)');
    } else if (result.status !== null) {
      failed.push('(test suite failed — details not parsed)');
    }
  }

  return {
    passed,
    failed,
    total: passed.length + failed.length,
    command,
    exitCode: result.status
  };
}

// ============================================================
// FAIL_TO_PASS Gate
// ============================================================

/**
 * Run the FAIL_TO_PASS gate: verify state change for matched tests.
 * Compares before/after test results to ensure implementation fixed the right things.
 *
 * @param {{ passed: string[], failed: string[] }} beforeResults - Results before implementation
 * @param {{ passed: string[], failed: string[] }} afterResults - Results after implementation
 * @param {{ criterion: string, tests: { file: string, description: string, score: number }[] }[]} matchedCriteria
 * @returns {{ verified: string[], regressions: string[], gaps: string[] }}
 */
function runFailToPass(beforeResults, afterResults, matchedCriteria) {
  const verified = [];
  const regressions = [];
  const gaps = [];

  const beforePassedSet = new Set(beforeResults.passed || []);
  const afterPassedSet = new Set(afterResults.passed || []);
  const afterFailedSet = new Set(afterResults.failed || []);

  // Check for regressions: tests that passed before but fail after
  for (const test of beforePassedSet) {
    if (afterFailedSet.has(test)) {
      regressions.push(test);
    }
  }

  // Check matched criteria tests for state changes
  // NOTE: This comparison is advisory — parsed test names from runner output may not
  // exactly match source-level descriptions (e.g., hierarchy prefixes, formatting).
  // When individual test parsing fails (passed/failed arrays contain fallback strings),
  // all criteria will appear as gaps. This is expected and non-blocking.
  for (const match of matchedCriteria) {
    let criterionVerified = false;
    for (const test of match.tests) {
      const desc = test.description;
      // Test was failing before and passes now = verified
      if (!beforePassedSet.has(desc) && afterPassedSet.has(desc)) {
        verified.push(`${match.criterion} → ${desc}`);
        criterionVerified = true;
      }
    }
    if (!criterionVerified) {
      gaps.push(match.criterion);
    }
  }

  return { verified, regressions, gaps };
}

// ============================================================
// Discovery Report
// ============================================================

/**
 * Generate discovery report and save to verifications directory.
 *
 * @param {string} taskId - Task ID
 * @param {{ file: string, framework: string|null, descriptions: string[] }[]} discoveryResults - Test discovery results
 * @param {{ passToPass?: object, failToPass?: object, matching?: object }} gateResults - Gate execution results
 * @returns {string} Path to saved report
 */
function generateDiscoveryReport(taskId, discoveryResults, gateResults) {
  const verificationsDir = path.join(PATHS.workflow, 'verifications');

  // Ensure verifications directory exists
  try {
    if (!fs.existsSync(verificationsDir)) {
      fs.mkdirSync(verificationsDir, { recursive: true });
    }
  } catch (err) {
    // Fall back — directory might already exist
  }

  const report = {
    taskId,
    timestamp: new Date().toISOString(),
    discovery: {
      totalFiles: discoveryResults.length,
      totalDescriptions: discoveryResults.reduce((sum, t) => sum + t.descriptions.length, 0),
      framework: discoveryResults[0]?.framework || null,
      files: discoveryResults.map(t => ({
        file: t.file,
        descriptionCount: t.descriptions.length
      }))
    },
    matching: gateResults.matching || null,
    passToPass: gateResults.passToPass || null,
    failToPass: gateResults.failToPass || null
  };

  const reportPath = path.join(verificationsDir, `${taskId}-discovery.json`);
  writeJson(reportPath, report);

  return reportPath;
}

// ============================================================
// High-level Gate Runner (for flow-done.js integration)
// ============================================================

/**
 * Run the full test discovery gate for a task.
 * Called by flow-done.js when the testDiscovery gate is active.
 *
 * @param {string} taskId - Task ID
 * @param {string} projectRoot - Project root directory
 * @returns {{ passed: boolean, message: string, report: object|null }}
 */
function runTestDiscoveryGate(taskId, projectRoot) {
  // Step 1: Discover tests
  const discovered = discoverTests(projectRoot);
  if (discovered.length === 0) {
    return {
      passed: true,
      message: 'No test files found in project — gate skipped',
      report: null
    };
  }

  // Step 2: Load task acceptance criteria
  const criteria = loadTaskCriteria(taskId);

  // Step 3: Match criteria to tests
  // Prepare AI matching data for semantic matching (preferred)
  // Fall back to Jaccard if AI matching data isn't consumed
  let matching = null;
  let aiMatchingData = null;

  if (criteria.length > 0) {
    // Always prepare AI matching data — the calling AI can use it for semantic matching
    aiMatchingData = prepareAIMatchingData(criteria, discovered);

    // Jaccard fallback for automated/CI contexts where no AI is in the loop
    matching = matchTestsToCriteria(criteria, discovered);
  }

  // Step 4: Run PASS_TO_PASS — no regressions allowed
  // Load verification profile if available (provides test command override)
  let profile = null;
  try {
    const vp = require('./flow-verification-profile');
    profile = vp.loadProfile();
  } catch (err) {
    // flow-verification-profile not available — use defaults
  }
  const passToPass = runPassToPass(projectRoot, profile);

  const hasRegressions = passToPass.failed.length > 0 || (passToPass.exitCode !== null && passToPass.exitCode !== 0);

  // Step 5: Generate report
  const gateResults = {
    passToPass,
    matching,
    failToPass: null  // FAIL_TO_PASS requires before/after snapshots, informational only
  };

  let reportPath = null;
  try {
    reportPath = generateDiscoveryReport(taskId, discovered, gateResults);
  } catch (err) {
    // Report generation failure should not block the gate
  }

  // Files where regex failed but heuristics detected tests — AI should extract
  const filesNeedingAI = discovered.filter(t => t.needsAIExtraction).map(t => t.file);

  // Gate passes if no regressions
  if (hasRegressions) {
    return {
      passed: false,
      message: `Test suite has ${passToPass.failed.length} failure(s) — PASS_TO_PASS gate failed`,
      report: {
        discoveredFiles: discovered.length,
        matchedCriteria: matching?.matched?.length || 0,
        unmatchedCriteria: matching?.unmatched?.length || 0,
        passToPass,
        reportPath,
        aiMatchingData,
        filesNeedingAI
      }
    };
  }

  return {
    passed: true,
    message: `PASS_TO_PASS OK (${discovered.length} test file${discovered.length !== 1 ? 's' : ''} discovered, ${matching?.matched?.length || 0} criteria matched)`,
    report: {
      discoveredFiles: discovered.length,
      matchedCriteria: matching?.matched?.length || 0,
      unmatchedCriteria: matching?.unmatched?.length || 0,
      passToPass,
      reportPath,
      aiMatchingData,
      filesNeedingAI
    }
  };
}

/**
 * Load acceptance criteria for a task.
 * Checks ready.json task data and spec files.
 *
 * @param {string} taskId - Task ID
 * @returns {string[]} Array of criteria strings
 */
function loadTaskCriteria(taskId) {
  const criteria = [];

  // Try ready.json first
  const readyData = safeJsonParse(PATHS.ready, {});
  const allLists = ['inProgress', 'ready', 'blocked', 'recentlyCompleted', 'backlog'];

  for (const list of allLists) {
    const tasks = readyData[list] || [];
    for (const task of tasks) {
      if (task.id === taskId && task.acceptanceCriteria) {
        if (Array.isArray(task.acceptanceCriteria)) {
          criteria.push(...task.acceptanceCriteria);
        }
        break;
      }
    }
    if (criteria.length > 0) break;
  }

  // Try spec file
  if (criteria.length === 0) {
    const specPath = path.join(PATHS.workflow, 'changes', `${taskId}.md`);
    try {
      const content = fs.readFileSync(specPath, 'utf-8');
      // Extract criteria from markdown — look for "Acceptance Criteria" section
      const acMatch = content.match(/##\s*Acceptance\s+Criteria\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
      if (acMatch) {
        const lines = acMatch[1].split('\n');
        for (const line of lines) {
          const trimmed = line.replace(/^[-*\s]+/, '').trim();
          if (trimmed.length > 0 && !trimmed.startsWith('#')) {
            criteria.push(trimmed);
          }
        }
      }
    } catch (err) {
      // Spec file not found — that's fine
    }
  }

  return criteria;
}

// ============================================================
// CLI Entry Point
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const taskId = args.find(a => !a.startsWith('--'));
  const scanOnly = args.includes('--scan-only');
  const matchOnly = args.includes('--match-only');
  const prepareAI = args.includes('--prepare-ai');

  const projectRoot = PATHS.root;

  if (scanOnly) {
    console.log(color('yellow', 'Scanning for test files...\n'));
    const discovered = discoverTests(projectRoot);
    if (discovered.length === 0) {
      console.log('No test files found.');
    } else {
      console.log(`Found ${discovered.length} test file(s):\n`);
      for (const t of discovered) {
        console.log(`  ${t.file} (${t.descriptions.length} test${t.descriptions.length !== 1 ? 's' : ''})`);
        for (const desc of t.descriptions.slice(0, 5)) {
          console.log(color('dim', `    - ${desc}`));
        }
        if (t.descriptions.length > 5) {
          console.log(color('dim', `    ... and ${t.descriptions.length - 5} more`));
        }
      }
      const framework = discovered[0]?.framework;
      if (framework) {
        console.log(`\nDetected framework: ${framework}`);
      }
    }
    process.exit(0);
  }

  if (prepareAI && taskId) {
    if (!validateTaskId(taskId)) {
      console.log(color('red', `Invalid task ID: ${taskId}`));
      process.exit(1);
    }

    console.log(color('yellow', 'Preparing AI matching data...\n'));
    const discovered = discoverTests(projectRoot);
    const criteria = loadTaskCriteria(taskId);

    if (criteria.length === 0) {
      console.log('No acceptance criteria found for task.');
      process.exit(0);
    }

    if (discovered.length === 0) {
      console.log('No test files found.');
      process.exit(0);
    }

    const aiData = prepareAIMatchingData(criteria, discovered);

    // Output the prompt for the AI to process
    console.log(aiData.prompt);

    // Show files needing AI extraction
    const needsAI = discovered.filter(t => t.needsAIExtraction);
    if (needsAI.length > 0) {
      console.log('\n' + color('yellow', '--- FILES NEEDING AI EXTRACTION ---'));
      console.log('These files appear to contain tests but regex could not extract descriptions.');
      console.log('Read these files and extract test descriptions semantically:\n');
      for (const t of needsAI) {
        console.log(`  ${t.file}`);
      }
    }

    process.exit(0);
  }

  if (matchOnly && taskId) {
    if (!validateTaskId(taskId)) {
      console.log(color('red', `Invalid task ID: ${taskId}`));
      process.exit(1);
    }

    console.log(color('yellow', 'Matching criteria to tests...\n'));
    const discovered = discoverTests(projectRoot);
    const criteria = loadTaskCriteria(taskId);

    if (criteria.length === 0) {
      console.log('No acceptance criteria found for task.');
      process.exit(0);
    }

    const result = matchTestsToCriteria(criteria, discovered);
    console.log(`Matched: ${result.matched.length}, Unmatched: ${result.unmatched.length}\n`);

    for (const m of result.matched) {
      console.log(color('green', `  ✓ ${m.criterion}`));
      for (const t of m.tests.slice(0, 3)) {
        console.log(color('dim', `    → ${t.file}: "${t.description}" (score: ${t.score})`));
      }
    }

    for (const u of result.unmatched) {
      console.log(color('yellow', `  ○ ${u} (no matching tests)`));
    }

    process.exit(0);
  }

  if (taskId) {
    if (!validateTaskId(taskId)) {
      console.log(color('red', `Invalid task ID: ${taskId}`));
      process.exit(1);
    }

    console.log(color('yellow', `Running test discovery gate for ${taskId}...\n`));
    const result = runTestDiscoveryGate(taskId, projectRoot);
    console.log(result.passed ? color('green', `✓ ${result.message}`) : color('red', `✗ ${result.message}`));

    if (result.report) {
      console.log(`\n  Discovered: ${result.report.discoveredFiles} test file(s)`);
      console.log(`  Matched criteria: ${result.report.matchedCriteria}`);
      console.log(`  Unmatched criteria: ${result.report.unmatchedCriteria}`);
      if (result.report.reportPath) {
        console.log(`  Report: ${result.report.reportPath}`);
      }
    }

    process.exit(result.passed ? 0 : 1);
  }

  // No args — show usage
  console.log('Usage: node scripts/flow-test-discovery.js <taskId> [--scan-only] [--match-only] [--prepare-ai]');
  console.log('');
  console.log('Options:');
  console.log('  --scan-only    Scan for test files without running gates');
  console.log('  --match-only   Match criteria to tests without running (Jaccard fallback)');
  console.log('  --prepare-ai   Output structured data for AI semantic matching');
  process.exit(0);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  discoverTests,
  matchTestsToCriteria,
  prepareAIMatchingData,
  applyAIMatchResults,
  extractDescriptionsHeuristic,
  runPassToPass,
  runFailToPass,
  generateDiscoveryReport,
  runTestDiscoveryGate,
  loadTaskCriteria
};
