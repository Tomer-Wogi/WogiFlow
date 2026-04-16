#!/usr/bin/env node

/**
 * Wogi Flow - Test Generation from Spec Criteria
 *
 * Parses task spec acceptance criteria (Given/When/Then) and generates
 * executable test file scaffolds. Part of the Auto-Testing Suite (Step 1.7).
 *
 * Generated tests deliberately FAIL until the feature is implemented (TDD).
 *
 * Usage (CLI):
 *   node flow-test-generate.js wf-XXXXXXXX
 *   node flow-test-generate.js wf-XXXXXXXX --detect-only
 *
 * Usage (library):
 *   const { parseSpecCriteria, detectTestConventions, categoriseCriterion, generateTestScaffold } = require('./flow-test-generate');
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeJsonParse, PATHS } = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');

// ============================================================
// Criterion Categorisation Keywords
// ============================================================

const CATEGORY_KEYWORDS = {
  ui: [
    'page shows', 'user sees', 'displays', 'renders', 'screen', 'visible',
    'clicks', 'button', 'modal', 'form', 'input', 'navigates', 'appears',
    'layout', 'user clicks', 'sees', 'shown', 'hidden', 'toggle'
  ],
  api: [
    'api returns', 'endpoint', 'response', 'status code', 'request',
    'returns json', 'post', 'get', 'put', 'delete', 'header', 'payload',
    'authenticated', 'http', '200', '400', '404', '500', 'rest'
  ],
  integration: [
    'calls api then', 'data flows from', 'end-to-end', 'full flow',
    'persists', 'syncs', 'propagates', 'data integrity', 'calls.*verif'
  ],
  unit: [
    'calculates', 'transforms', 'validates', 'returns', 'throws', 'parses',
    'converts', 'filters', 'sorts', 'maps', 'reduces', 'creates', 'generates',
    'computes', 'extracts', 'normalizes', 'merges'
  ]
};

// ============================================================
// Test Framework Templates
// ============================================================

const FRAMEWORK_IMPORTS = {
  vitest: {
    esm: "import { describe, it, expect, beforeEach, afterEach } from 'vitest';",
    cjs: "const { describe, it, expect, beforeEach, afterEach } = require('vitest');"
  },
  jest: {
    esm: "// Jest globals are auto-available (describe, it, expect)",
    cjs: "// Jest globals are auto-available (describe, it, expect)"
  },
  mocha: {
    esm: "import { describe, it, beforeEach, afterEach } from 'mocha';\nimport { expect } from 'chai';",
    cjs: "const { expect } = require('chai');"
  },
  'node:test': {
    esm: "import { describe, it, beforeEach, afterEach } from 'node:test';\nimport assert from 'node:assert/strict';",
    cjs: "const { describe, it, beforeEach, afterEach } = require('node:test');\nconst assert = require('node:assert/strict');"
  }
};

const ASSERTION_STYLE = {
  vitest: (desc) => `expect(true).toBe(false); // TODO: ${desc}`,
  jest: (desc) => `expect(true).toBe(false); // TODO: ${desc}`,
  mocha: (desc) => `expect(true).to.equal(false); // TODO: ${desc}`,
  'node:test': (desc) => `assert.strictEqual(true, false, '${desc.replace(/'/g, "\\'")}');`
};

// ============================================================
// Spec Parsing
// ============================================================

/**
 * Parse Given/When/Then acceptance criteria from a spec markdown file.
 *
 * Expects format:
 *   ### AC1: Title
 *   **Given** precondition
 *   **When** action
 *   **Then** assertion
 *
 * @param {string} specPath - Absolute path to the spec .md file
 * @returns {Array<{id: string, title: string, given: string, when: string, then: string, raw: string}>}
 */
function parseSpecCriteria(specPath) {
  if (!fs.existsSync(specPath)) {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(specPath, 'utf-8');
  } catch (_err) {
    return [];
  }

  const criteria = [];
  // Split by AC headers (### AC1: Title or ### AC-1: Title)
  const acPattern = /^###\s+(AC[\d-]+):\s*(.+)$/gm;
  const matches = [...content.matchAll(acPattern)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = match[1].trim();
    const title = match[2].trim();

    // Get the content between this AC header and the next one (or end of file)
    const startIdx = match.index + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const section = content.slice(startIdx, endIdx);

    // Extract Given/When/Then (support both **Given** and **Given**: formats)
    const givenMatch = section.match(/\*\*Given\*\*:?\s*(.+?)(?=\*\*When\*\*|\n\n|$)/s);
    const whenMatch = section.match(/\*\*When\*\*:?\s*(.+?)(?=\*\*Then\*\*|\n\n|$)/s);
    const thenMatch = section.match(/\*\*Then\*\*:?\s*(.+?)(?=\*\*Files\*\*|\n###|\n\n\n|$)/s);

    criteria.push({
      id,
      title,
      given: givenMatch ? givenMatch[1].trim() : '',
      when: whenMatch ? whenMatch[1].trim() : '',
      then: thenMatch ? thenMatch[1].trim() : '',
      raw: section.trim()
    });
  }

  return criteria;
}

// ============================================================
// Test Convention Detection
// ============================================================

/**
 * Detect the project's existing test conventions by scanning package.json
 * and existing test files.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {{ framework: string, importStyle: 'esm'|'cjs', fileExtension: string, hasDescribeBlocks: boolean, assertionLib: string }}
 */
function detectTestConventions(projectRoot) {
  const root = projectRoot || PATHS.root;
  const result = {
    framework: 'vitest',
    importStyle: 'esm',
    fileExtension: '.ts',
    hasDescribeBlocks: true,
    assertionLib: 'expect'
  };

  // --- Detect framework from package.json ---
  const packageJsonPath = path.join(root, 'package.json');
  let allDeps = {};

  const pkg = safeJsonParse(packageJsonPath, null);
  if (pkg) {
    allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check for "type": "module" in package.json
    if (pkg.type === 'module') {
      result.importStyle = 'esm';
    }
  }

  // Priority order: vitest > jest > mocha > node:test
  if (allDeps['vitest']) {
    result.framework = 'vitest';
  } else if (allDeps['jest'] || allDeps['@jest/core'] || allDeps['ts-jest']) {
    result.framework = 'jest';
  } else if (allDeps['mocha']) {
    result.framework = 'mocha';
    result.assertionLib = 'chai';
  } else {
    result.framework = 'node:test';
    result.assertionLib = 'assert';
  }

  // --- Detect file extension from existing tests ---
  const testDirs = ['__tests__', 'test', 'tests', 'src'];
  for (const dir of testDirs) {
    const fullDir = path.join(root, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const files = findTestFiles(fullDir, 0);
      if (files.length > 0) {
        // Check if most tests use .ts or .js
        const tsCount = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx')).length;
        const jsCount = files.filter(f => f.endsWith('.js') || f.endsWith('.jsx')).length;
        result.fileExtension = tsCount >= jsCount ? '.ts' : '.js';

        // Check import style from first test file
        try {
          const sampleContent = fs.readFileSync(files[0], 'utf-8');
          if (sampleContent.includes('import ') && !sampleContent.includes('require(')) {
            result.importStyle = 'esm';
          } else if (sampleContent.includes('require(')) {
            result.importStyle = 'cjs';
          }

          // Check for describe blocks
          result.hasDescribeBlocks = /describe\s*\(/.test(sampleContent);
        } catch (_err) {
          // sample read failure — keep defaults
        }

        break; // Found test files, stop searching
      }
    } catch (_err) {
      // dir scan failure — try next
    }
  }

  return result;
}

/**
 * Recursively find test files in a directory.
 * @param {string} dir - Directory to search
 * @param {number} depth - Current recursion depth
 * @returns {string[]} Array of test file paths
 */
function findTestFiles(dir, depth) {
  if (depth > 4) return [];
  const results = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.workflow'].includes(entry.name)) continue;
        results.push(...findTestFiles(path.join(dir, entry.name), depth + 1));
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(path.join(dir, entry.name));
      }
    }
  } catch (_err) {
    // Read error — skip
  }

  return results;
}

// ============================================================
// Criterion Categorisation
// ============================================================

/**
 * Categorise a criterion as 'ui', 'api', 'unit', or 'integration' based on keywords.
 *
 * @param {{ given: string, when: string, then: string, title: string }} criterion
 * @returns {'ui'|'api'|'unit'|'integration'}
 */
function categoriseCriterion(criterion) {
  const text = `${criterion.title} ${criterion.given} ${criterion.when} ${criterion.then}`.toLowerCase();

  // Score each category
  const scores = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        scores[category]++;
      }
    }
  }

  // Integration has priority when detected (it's more specific)
  if (scores.integration > 0) return 'integration';

  // Find highest scoring category
  let maxScore = 0;
  let bestCategory = 'unit'; // default fallback

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// ============================================================
// Test File Generation
// ============================================================

/**
 * Generate a single test case string for a criterion.
 *
 * @param {{ id: string, title: string, given: string, when: string, then: string }} criterion
 * @param {string} framework - Test framework name
 * @returns {string} Test case code
 */
function generateTestCase(criterion, framework) {
  const assertFn = ASSERTION_STYLE[framework] || ASSERTION_STYLE.vitest;
  const lines = [];

  lines.push(`  describe('${escapeSingleQuotes(criterion.title)}', () => {`);
  const thenText = (criterion.then || '').split('\n')[0].toLowerCase() || 'satisfy acceptance criteria';
  lines.push(`    it('should ${escapeSingleQuotes(thenText)}', () => {`);
  lines.push(`      // Given: ${criterion.given.split('\n')[0]}`);
  lines.push(`      // When: ${criterion.when.split('\n')[0]}`);
  lines.push(`      // Then: ${criterion.then.split('\n')[0]}`);
  lines.push(`      ${assertFn('implement ' + criterion.id)}`);
  lines.push(`    });`);
  lines.push(`  });`);

  return lines.join('\n');
}

/**
 * Generate edge case test cases for a criterion.
 *
 * @param {{ id: string, title: string }} criterion
 * @param {string} category - 'ui' | 'api' | 'unit' | 'integration'
 * @param {string} framework - Test framework name
 * @returns {string} Edge case test code
 */
function generateEdgeCases(criterion, category, framework) {
  const assertFn = ASSERTION_STYLE[framework] || ASSERTION_STYLE.vitest;
  const lines = [];

  lines.push(`  describe('${escapeSingleQuotes(criterion.title)} — edge cases', () => {`);

  // Common edge cases
  lines.push(`    it('should handle empty state', () => {`);
  lines.push(`      ${assertFn('handle empty state for ' + criterion.id)}`);
  lines.push(`    });`);
  lines.push('');
  lines.push(`    it('should handle error state', () => {`);
  lines.push(`      ${assertFn('handle error state for ' + criterion.id)}`);
  lines.push(`    });`);

  // Category-specific edge cases
  if (category === 'ui') {
    lines.push('');
    lines.push(`    it('should handle loading state', () => {`);
    lines.push(`      ${assertFn('handle loading state for ' + criterion.id)}`);
    lines.push(`    });`);
  } else if (category === 'api') {
    lines.push('');
    lines.push(`    it('should handle network failure', () => {`);
    lines.push(`      ${assertFn('handle network failure for ' + criterion.id)}`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should handle invalid input', () => {`);
    lines.push(`      ${assertFn('handle invalid input for ' + criterion.id)}`);
    lines.push(`    });`);
  } else if (category === 'unit') {
    lines.push('');
    lines.push(`    it('should handle boundary values', () => {`);
    lines.push(`      ${assertFn('handle boundary values for ' + criterion.id)}`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should handle null/undefined input', () => {`);
    lines.push(`      ${assertFn('handle null/undefined for ' + criterion.id)}`);
    lines.push(`    });`);
  } else if (category === 'integration') {
    lines.push('');
    lines.push(`    it('should handle partial failure', () => {`);
    lines.push(`      ${assertFn('handle partial failure for ' + criterion.id)}`);
    lines.push(`    });`);
  }

  lines.push(`  });`);

  return lines.join('\n');
}

/**
 * Escape single quotes in a string for use in JS string literals.
 * @param {string} str
 * @returns {string}
 */
function escapeSingleQuotes(str) {
  return str.replace(/'/g, "\\'");
}

/**
 * Ensure the output directory for generated tests exists.
 *
 * @param {string} taskId - Task ID (wf-XXXXXXXX)
 * @param {string} [outputDir] - Base output directory (defaults to config value)
 * @returns {string} Full path to the task's test output directory
 */
function ensureTestDir(taskId, outputDir) {
  const config = getConfig();
  const baseDir = outputDir || (config.testing && config.testing.generation && config.testing.generation.outputDir) || '.workflow/tests/generated';
  const fullDir = path.join(PATHS.root, baseDir, taskId);

  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  return fullDir;
}

/**
 * Generate test scaffold files for a task based on its spec criteria.
 *
 * @param {string} taskId - Task ID (wf-XXXXXXXX)
 * @param {Array<{id: string, title: string, given: string, when: string, then: string}>} criteria - Parsed criteria
 * @param {{ framework: string, importStyle: 'esm'|'cjs', fileExtension: string }} conventions - Detected test conventions
 * @param {{ includeEdgeCases?: boolean, outputDir?: string, mode?: string }} [testingConfig] - Testing configuration
 * @returns {{ files: Array<{path: string, category: string, testCount: number}>, totalTests: number }}
 */
function generateTestScaffold(taskId, criteria, conventions, testingConfig) {
  const config = testingConfig || {};
  const includeEdgeCases = config.includeEdgeCases !== false;
  const mode = config.mode || 'auto';

  const testDir = ensureTestDir(taskId, config.outputDir);
  const ext = conventions.fileExtension || '.ts';
  const framework = conventions.framework || 'vitest';
  const importStyle = conventions.importStyle || 'esm';

  // Group criteria by category
  const grouped = { unit: [], api: [], ui: [], integration: [] };

  for (const criterion of criteria) {
    const category = categoriseCriterion(criterion);

    // Respect mode filtering
    if (mode !== 'auto' && mode !== 'full') {
      if (mode === 'unit' && category !== 'unit') continue;
      if (mode === 'api' && category !== 'api') continue;
      if (mode === 'ui' && category !== 'ui') continue;
    }

    grouped[category].push(criterion);
  }

  const result = { files: [], totalTests: 0 };
  const importLine = FRAMEWORK_IMPORTS[framework] ? FRAMEWORK_IMPORTS[framework][importStyle] : FRAMEWORK_IMPORTS.vitest.esm;

  for (const [category, categoryCriteria] of Object.entries(grouped)) {
    if (categoryCriteria.length === 0) continue;

    const fileName = `${category}.spec${ext}`;
    const filePath = path.join(testDir, fileName);

    const lines = [];
    lines.push(`// Auto-generated by WogiFlow test generator`);
    lines.push(`// Task: ${taskId}`);
    lines.push(`// Category: ${category}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push(`//`);
    lines.push(`// These tests are designed to FAIL until the feature is implemented.`);
    lines.push(`// Replace placeholder assertions with real ones after implementation.`);
    lines.push('');
    lines.push(importLine);
    lines.push('');

    let testCount = 0;

    // Wrap all criteria in a top-level describe
    const taskLabel = `${taskId} — ${category} tests`;
    lines.push(`describe('${escapeSingleQuotes(taskLabel)}', () => {`);

    for (const criterion of categoryCriteria) {
      lines.push('');
      lines.push(generateTestCase(criterion, framework));
      testCount++;

      if (includeEdgeCases) {
        lines.push('');
        lines.push(generateEdgeCases(criterion, category, framework));
        // Count edge cases based on category
        if (category === 'ui') testCount += 3;
        else if (category === 'api') testCount += 4;
        else if (category === 'unit') testCount += 4;
        else if (category === 'integration') testCount += 3;
        else testCount += 2;
      }
    }

    lines.push('});');
    lines.push('');

    try {
      fs.writeFileSync(filePath, lines.join('\n'));
      result.files.push({ path: filePath, category, testCount });
      result.totalTests += testCount;
    } catch (err) {
      console.error(`Error writing test file ${filePath}: ${err.message}`);
    }
  }

  return result;
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const taskId = args.find(a => /^wf-[a-f0-9]{8}$/i.test(a));
  const detectOnly = args.includes('--detect-only');

  if (!taskId) {
    console.log('Usage: flow-test-generate.js <wf-XXXXXXXX> [--detect-only]');
    console.log('');
    console.log('  Generates test scaffolds from task spec acceptance criteria.');
    console.log('');
    console.log('  Options:');
    console.log('    --detect-only  Only detect test conventions, do not generate');
    process.exit(1);
  }

  // Check if testing is enabled
  const config = getConfig();
  const testingConfig = config.testing || {};

  if (!testingConfig.enabled) {
    console.log('Testing is disabled (config.testing.enabled = false). Skipping.');
    process.exit(0);
  }

  if (!testingConfig.generation || !testingConfig.generation.autoGenerate) {
    console.log('Test generation is disabled (config.testing.generation.autoGenerate = false). Skipping.');
    process.exit(0);
  }

  // Detect conventions
  const conventions = detectTestConventions();
  console.log(`Test framework: ${conventions.framework}`);
  console.log(`Import style: ${conventions.importStyle}`);
  console.log(`File extension: ${conventions.fileExtension}`);
  console.log(`Assertion lib: ${conventions.assertionLib}`);

  if (detectOnly) {
    console.log(JSON.stringify(conventions, null, 2));
    process.exit(0);
  }

  // Parse spec
  const specPath = path.join(PATHS.workflow, 'specs', `${taskId}.md`);

  if (!fs.existsSync(specPath)) {
    console.error(`Spec not found: ${specPath}`);
    process.exit(1);
  }

  const criteria = parseSpecCriteria(specPath);

  if (criteria.length === 0) {
    console.log('No acceptance criteria found in spec. Skipping test generation.');
    process.exit(0);
  }

  console.log(`Found ${criteria.length} acceptance criteria`);

  // Categorise
  for (const c of criteria) {
    const cat = categoriseCriterion(c);
    console.log(`  ${c.id}: ${cat} — ${c.title}`);
  }

  // Generate
  const result = generateTestScaffold(taskId, criteria, conventions, {
    includeEdgeCases: testingConfig.generation.includeEdgeCases !== false,
    outputDir: testingConfig.generation.outputDir,
    mode: testingConfig.mode || 'auto'
  });

  console.log('');
  console.log(`Generated ${result.files.length} test file(s) with ${result.totalTests} total test(s):`);
  for (const file of result.files) {
    console.log(`  ${path.relative(PATHS.root, file.path)} (${file.category}: ${file.testCount} tests)`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseSpecCriteria,
  detectTestConventions,
  categoriseCriterion,
  generateTestScaffold,
  ensureTestDir,
  generateTestCase,
  generateEdgeCases,
  CATEGORY_KEYWORDS,
  FRAMEWORK_IMPORTS,
  ASSERTION_STYLE
};
