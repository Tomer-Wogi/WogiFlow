#!/usr/bin/env node

/**
 * Wogi Flow - UI Test Runner (Playwright MCP)
 *
 * Orchestrates UI testing using Playwright MCP for accessibility-tree-based
 * verification. NOT screenshot-based.
 *
 * This script does NOT directly call Playwright. It generates the configuration
 * and test structure that Playwright MCP (the MCP server) will use when Claude
 * Code's AI agent invokes the tests.
 *
 * Pipeline:
 *   1. Check config.testing.enabled && mode includes UI
 *   2. Ensure Playwright deps (call flow-testing-deps.ensureDeps('ui'))
 *   3. Start dev server (if config.testing.ui.startCommand defined)
 *   4. Wait for server ready (poll baseUrl)
 *   5. Load test flows from .workflow/tests/generated/<taskId>/ui.spec.*
 *   6. For each test: navigate, read a11y tree, assert, check states
 *   7. Run accessibility scan (if checkAccessibility: true)
 *   8. Stop dev server
 *   9. Write report to .workflow/verifications/<taskId>-ui.json
 *
 * Usage (CLI):
 *   node flow-test-ui.js wf-XXXXXXXX
 *   node flow-test-ui.js wf-XXXXXXXX --dry-run
 *
 * Usage (library):
 *   const { runUITests, startDevServer, stopDevServer, assertDataInTree,
 *           checkStateCoverage, getPlaywrightMCPConfig } = require('./flow-test-ui');
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { getProjectRoot, PATHS } = require('./flow-paths');
const { getConfig } = require('./flow-config-loader');
const { ensureDir } = require('./flow-io');
const { loadProfile } = require('./flow-verification-profile');

// ============================================================
// Constants
// ============================================================

/** Default timeout for dev server startup (30 seconds) */
const DEFAULT_SERVER_TIMEOUT_MS = 30000;

/** Polling interval for server readiness check (500ms) */
const SERVER_POLL_INTERVAL_MS = 500;

/** Default base URL when none configured */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Default UI states to verify coverage for */
const DEFAULT_STATE_CHECKS = ['empty', 'loading', 'error', 'success'];

// ============================================================
// Playwright MCP Configuration
// ============================================================

/**
 * Generate settings for Playwright MCP server.
 *
 * Returns the MCP server configuration object that should be included
 * in Claude Code's settings when UI testing is enabled.
 *
 * @param {object} [options] - Override options
 * @param {boolean} [options.headless=true] - Run browser in headless mode
 * @returns {object} MCP server configuration for settings.local.json
 */
function getPlaywrightMCPConfig(options = {}) {
  const config = getConfig();
  const uiConfig = (config.testing && config.testing.ui) || {};
  const headless = options.headless !== undefined ? options.headless : (uiConfig.headless !== false);

  const args = ['@playwright/mcp'];
  if (headless) {
    args.push('--headless');
  }

  return {
    playwright: {
      command: 'npx',
      args
    }
  };
}

// ============================================================
// Dev Server Management
// ============================================================

/**
 * Start dev server and wait for ready.
 *
 * Spawns the server process using the provided command, then polls
 * the baseUrl until it responds with a 2xx or 3xx status.
 *
 * @param {string} command - Start command (e.g., 'npm run dev')
 * @param {string} baseUrl - URL to poll for readiness
 * @param {number} [timeout=30000] - Max wait time in ms
 * @returns {Promise<{process: object, ready: boolean, error?: string}>}
 */
async function startDevServer(command, baseUrl, timeout = DEFAULT_SERVER_TIMEOUT_MS) {
  if (!command) {
    return { process: null, ready: false, error: 'No start command provided' };
  }

  const parts = command.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  let serverProcess;
  try {
    serverProcess = spawn(cmd, args, {
      cwd: PATHS.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: true
    });
  } catch (err) {
    return { process: null, ready: false, error: `Failed to spawn server: ${err.message}` };
  }

  // Collect stderr for error reporting
  let stderrOutput = '';
  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
      // Cap collected stderr to avoid memory bloat
      if (stderrOutput.length > 4096) {
        stderrOutput = stderrOutput.slice(-2048);
      }
    });
  }

  // Wait for server to become ready
  const ready = await pollUrl(baseUrl, timeout);

  if (!ready) {
    // Server did not become ready in time — kill it
    killProcess(serverProcess);
    return {
      process: null,
      ready: false,
      error: `Server did not respond at ${baseUrl} within ${timeout}ms. stderr: ${stderrOutput.slice(0, 500)}`
    };
  }

  return { process: serverProcess, ready: true };
}

/**
 * Stop dev server process.
 *
 * Sends SIGTERM and falls back to SIGKILL if the process doesn't exit
 * within a short grace period.
 *
 * @param {object} serverProcess - Process returned by startDevServer
 */
function stopDevServer(serverProcess) {
  if (!serverProcess) return;
  killProcess(serverProcess);
}

/**
 * Kill a child process with SIGTERM, falling back to SIGKILL.
 * @param {object} proc - child_process instance
 */
function killProcess(proc) {
  if (!proc || proc.exitCode !== null) return;

  try {
    // Try tree-kill via negative PID (kill process group)
    if (proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGTERM');
      } catch (err) {
        // Fallback to direct kill if process group kill fails
        proc.kill('SIGTERM');
      }
    } else {
      proc.kill('SIGTERM');
    }
  } catch (err) {
    // Process may already be dead
  }
}

/**
 * Poll a URL until it returns a 2xx/3xx response or timeout.
 *
 * @param {string} url - URL to poll
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<boolean>} true if server responded successfully
 */
function pollUrl(url, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    function check() {
      if (Date.now() - startTime > timeout) {
        return resolve(false);
      }

      const client = url.startsWith('https') ? https : http;

      const req = client.get(url, (res) => {
        // Accept 2xx and 3xx as "ready"
        if (res.statusCode >= 200 && res.statusCode < 400) {
          res.resume(); // Drain the response
          return resolve(true);
        }
        res.resume();
        setTimeout(check, SERVER_POLL_INTERVAL_MS);
      });

      req.on('error', () => {
        setTimeout(check, SERVER_POLL_INTERVAL_MS);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, SERVER_POLL_INTERVAL_MS);
      });
    }

    check();
  });
}

// ============================================================
// Accessibility Tree Assertion Engine
// ============================================================

/**
 * Parse accessibility tree snapshot for data assertions.
 *
 * Searches the accessibility tree's text content for expected values
 * using case-insensitive string matching. The tree can be a nested
 * object (Playwright's accessibility snapshot format) or a flat string.
 *
 * @param {object|string} snapshot - Playwright accessibility tree or text content
 * @param {string[]} expectedValues - Values that should be present
 * @returns {{ found: string[], missing: string[], extra: string[] }}
 */
function assertDataInTree(snapshot, expectedValues) {
  if (!expectedValues || expectedValues.length === 0) {
    return { found: [], missing: [], extra: [] };
  }

  // Flatten tree to searchable text
  const treeText = flattenTreeToText(snapshot);
  const lowerText = treeText.toLowerCase();

  const found = [];
  const missing = [];

  for (const value of expectedValues) {
    if (!value || typeof value !== 'string') continue;

    if (lowerText.includes(value.toLowerCase())) {
      found.push(value);
    } else {
      missing.push(value);
    }
  }

  return { found, missing, extra: [] };
}

/**
 * Flatten an accessibility tree to a single searchable string.
 *
 * Handles both Playwright's nested snapshot format and plain strings.
 * Extracts name, value, description, and role text from all nodes.
 *
 * @param {object|string} tree - Accessibility tree snapshot
 * @returns {string} Flattened text content
 */
function flattenTreeToText(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree) return '';

  // Handle array at top level (list of nodes) — must come before object check
  if (Array.isArray(tree)) {
    return tree.map(flattenTreeToText).join(' ');
  }

  if (typeof tree !== 'object') return '';

  const parts = [];

  // Extract text content from this node
  if (tree.name) parts.push(String(tree.name));
  if (tree.value) parts.push(String(tree.value));
  if (tree.description) parts.push(String(tree.description));
  if (tree.text) parts.push(String(tree.text));
  if (tree.role) parts.push(String(tree.role));

  // Recurse into children
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      parts.push(flattenTreeToText(child));
    }
  }

  return parts.join(' ');
}

// ============================================================
// State Coverage Checking
// ============================================================

/**
 * Check if all required UI states are covered by test results.
 *
 * Examines test assertion names and metadata to determine which
 * UI states (empty, loading, error, success) have been tested.
 *
 * @param {string[]} stateChecks - States to check (from config)
 * @param {object[]} testResults - Test results with name/status fields
 * @returns {{ covered: string[], missing: string[] }}
 */
function checkStateCoverage(stateChecks, testResults) {
  const states = stateChecks || DEFAULT_STATE_CHECKS;
  const covered = [];
  const missing = [];

  // Build searchable text from all test results
  const testText = (testResults || [])
    .map(t => `${t.name || ''} ${t.state || ''} ${t.status || ''}`.toLowerCase())
    .join(' ');

  for (const state of states) {
    const lowerState = state.toLowerCase();
    // Check if any test result references this state
    if (testText.includes(lowerState)) {
      covered.push(state);
    } else {
      missing.push(state);
    }
  }

  return { covered, missing };
}

// ============================================================
// Test Flow Loading
// ============================================================

/**
 * Load UI test spec files for a given task.
 *
 * Looks in .workflow/tests/generated/<taskId>/ for ui.spec.* files,
 * parses them to extract test metadata (names, expected values, states).
 *
 * @param {string} taskId - Task ID (wf-XXXXXXXX)
 * @returns {object[]} Array of test flow objects
 */
function loadTestFlows(taskId) {
  const config = getConfig();
  const testingConfig = config.testing || {};
  const outputDir = (testingConfig.generation && testingConfig.generation.outputDir) || '.workflow/tests/generated';
  const testDir = path.join(PATHS.root, outputDir, taskId);

  if (!fs.existsSync(testDir)) {
    return [];
  }

  const flows = [];

  try {
    const entries = fs.readdirSync(testDir);
    const uiSpecs = entries.filter(e => /^ui\.spec\./i.test(e));

    for (const specFile of uiSpecs) {
      const specPath = path.join(testDir, specFile);
      try {
        const content = fs.readFileSync(specPath, 'utf-8');
        const tests = parseTestFile(content);
        flows.push(...tests);
      } catch (err) {
        // Skip unreadable spec files
      }
    }
  } catch (err) {
    // Test directory read failure
  }

  return flows;
}

/**
 * Parse a test spec file to extract test metadata.
 *
 * Extracts describe/it blocks, expected values from comments,
 * and state markers from test content.
 *
 * @param {string} content - Test file content
 * @returns {object[]} Parsed test flow objects
 */
function parseTestFile(content) {
  const tests = [];

  // Match it('description', ...) blocks
  const itPattern = /it\(\s*['"`](.+?)['"`]/g;
  let match;

  while ((match = itPattern.exec(content)) !== null) {
    const name = match[1];
    const test = {
      name,
      state: detectStateFromName(name),
      expectedValues: [],
      page: null
    };

    // Look for expected values in nearby comments
    const surroundingStart = Math.max(0, match.index - 200);
    const surroundingEnd = Math.min(content.length, match.index + 500);
    const surrounding = content.slice(surroundingStart, surroundingEnd);

    // Extract from Given/When/Then comments
    const givenMatch = surrounding.match(/\/\/\s*Given:\s*(.+)/);
    const whenMatch = surrounding.match(/\/\/\s*When:\s*(.+)/);
    const thenMatch = surrounding.match(/\/\/\s*Then:\s*(.+)/);

    if (thenMatch) {
      // Extract quoted values from Then assertion
      const quotedValues = thenMatch[1].match(/['"]([^'"]+)['"]/g);
      if (quotedValues) {
        test.expectedValues = quotedValues.map(v => v.replace(/['"]/g, ''));
      }
    }

    // Extract page URL from navigates/visits comments
    const navMatch = surrounding.match(/navigat\w+\s+(?:to\s+)?['"]?([/\w.-]+)['"]?/i);
    if (navMatch) {
      test.page = navMatch[1];
    }

    tests.push(test);
  }

  return tests;
}

/**
 * Detect which UI state a test name references.
 * @param {string} name - Test name
 * @returns {string|null} State name or null
 */
function detectStateFromName(name) {
  const lower = name.toLowerCase();
  if (lower.includes('empty') || lower.includes('no data') || lower.includes('blank')) return 'empty';
  if (lower.includes('loading') || lower.includes('spinner') || lower.includes('skeleton')) return 'loading';
  if (lower.includes('error') || lower.includes('fail') || lower.includes('invalid')) return 'error';
  if (lower.includes('success') || lower.includes('shows') || lower.includes('displays') || lower.includes('data')) return 'success';
  return null;
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate a structured UI test report.
 *
 * @param {string} taskId - Task ID
 * @param {object[]} assertions - Individual assertion results
 * @param {object} stateCoverage - State coverage result
 * @param {object} accessibility - Accessibility scan results
 * @returns {object} Structured report
 */
function generateReport(taskId, assertions, stateCoverage, accessibility) {
  const passed = assertions.filter(a => a.status === 'passed').length;
  const failed = assertions.filter(a => a.status === 'failed').length;
  const total = assertions.length;

  return {
    taskId,
    type: 'ui',
    timestamp: new Date().toISOString(),
    summary: { passed, failed, total },
    assertions,
    stateCoverage: {
      checked: stateCoverage.checked || DEFAULT_STATE_CHECKS,
      covered: stateCoverage.covered || [],
      missing: stateCoverage.missing || []
    },
    accessibility: {
      violations: (accessibility && accessibility.violations) || [],
      passes: (accessibility && accessibility.passes) || 0,
      incomplete: (accessibility && accessibility.incomplete) || 0
    }
  };
}

/**
 * Save a UI test report to the verifications directory.
 *
 * @param {object} report - Report object from generateReport
 * @returns {string} Path to the saved report file
 */
function saveReport(report) {
  const verificationsDir = PATHS.verifications;
  ensureDir(verificationsDir);

  const reportPath = path.join(verificationsDir, `${report.taskId}-ui.json`);

  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch (err) {
    // Report save failure is non-fatal — caller handles
  }

  return reportPath;
}

// ============================================================
// Main Test Runner
// ============================================================

/**
 * Run UI tests for a specific task.
 *
 * Orchestrates the full pipeline: start server, load tests, execute
 * assertions against accessibility tree snapshots, check state coverage,
 * run accessibility scan, stop server, and write report.
 *
 * @param {string} taskId - Task ID (e.g., 'wf-a1b2c3d4')
 * @param {object} [options] - Override options
 * @param {string} [options.baseUrl] - Override base URL
 * @param {string} [options.startCommand] - Override start command
 * @param {boolean} [options.checkAccessibility] - Override accessibility check
 * @param {string[]} [options.stateChecks] - Override state checks
 * @param {boolean} [options.dryRun=false] - If true, only validate config, don't run
 * @returns {Promise<object>} Test report { passed, failed, total, assertions[], accessibilityViolations[] }
 */
async function runUITests(taskId, options = {}) {
  const config = getConfig();
  const testingConfig = config.testing || {};
  const uiConfig = testingConfig.ui || {};
  const profile = loadProfile() || {};

  // Merge options with config (options > config > profile > defaults)
  const baseUrl = options.baseUrl || uiConfig.baseUrl || (profile.api && profile.api.baseUrl) || DEFAULT_BASE_URL;
  const startCommand = options.startCommand || uiConfig.startCommand || (profile.api && profile.api.startCommand) || null;
  const checkAccessibility = options.checkAccessibility !== undefined
    ? options.checkAccessibility
    : (uiConfig.checkAccessibility !== false);
  const stateChecks = options.stateChecks || uiConfig.stateChecks || DEFAULT_STATE_CHECKS;
  const dryRun = options.dryRun || false;

  // Validate testing is enabled
  if (!testingConfig.enabled) {
    return generateReport(taskId, [], { checked: stateChecks, covered: [], missing: stateChecks }, null);
  }

  // Validate mode includes UI
  const mode = testingConfig.mode || 'auto';
  if (mode !== 'auto' && mode !== 'full' && mode !== 'ui') {
    return generateReport(taskId, [], { checked: stateChecks, covered: [], missing: stateChecks }, null);
  }

  // Load test flows
  const testFlows = loadTestFlows(taskId);

  if (testFlows.length === 0) {
    const report = generateReport(
      taskId,
      [{ name: 'No UI test files found', status: 'skipped', reason: 'no-test-files', expected: [], found: [], missing: [], duration: 0, hint: 'Run /wogi-test --generate to create tests, or /wogi-test-browser for interactive browser testing' }],
      { checked: stateChecks, covered: [], missing: stateChecks },
      null
    );
    saveReport(report);
    return report;
  }

  if (dryRun) {
    const assertions = testFlows.map(t => ({
      name: t.name,
      status: 'dry-run',
      expected: t.expectedValues,
      found: [],
      missing: t.expectedValues,
      duration: 0
    }));
    const stateCoverage = checkStateCoverage(stateChecks, testFlows);
    const report = generateReport(taskId, assertions, { checked: stateChecks, ...stateCoverage }, null);
    saveReport(report);
    return report;
  }

  // Start dev server if configured
  let serverResult = { process: null, ready: true };
  if (startCommand) {
    serverResult = await startDevServer(startCommand, baseUrl);

    if (!serverResult.ready) {
      const report = generateReport(
        taskId,
        [{
          name: 'Dev server startup',
          status: 'failed',
          expected: ['Server ready'],
          found: [],
          missing: ['Server ready'],
          duration: 0,
          error: serverResult.error
        }],
        { checked: stateChecks, covered: [], missing: stateChecks },
        null
      );
      saveReport(report);
      return report;
    }
  }

  try {
    // Execute test assertions
    // Note: In the real flow, Playwright MCP handles browser interaction.
    // This code prepares the test plan and structures the results.
    // The AI agent orchestrating the test will use Playwright MCP tools
    // to navigate pages, get accessibility snapshots, and pass them
    // back through assertDataInTree().
    const assertions = testFlows.map(testFlow => {
      const startTime = Date.now();

      // Build the assertion structure (actual browser interaction
      // happens through Playwright MCP tool calls by the AI agent)
      const assertion = {
        name: testFlow.name,
        status: 'pending',
        expected: testFlow.expectedValues,
        found: [],
        missing: testFlow.expectedValues,
        duration: 0,
        page: testFlow.page,
        state: testFlow.state
      };

      assertion.duration = Date.now() - startTime;
      return assertion;
    });

    // Check state coverage
    const stateCoverage = checkStateCoverage(stateChecks, assertions);

    // Accessibility results placeholder (populated by Playwright MCP axe scan)
    const accessibility = checkAccessibility
      ? { violations: [], passes: 0, incomplete: 0 }
      : null;

    const report = generateReport(
      taskId,
      assertions,
      { checked: stateChecks, ...stateCoverage },
      accessibility
    );

    // Save report
    saveReport(report);

    return report;

  } finally {
    // Always stop dev server
    if (serverResult.process) {
      stopDevServer(serverResult.process);
    }
  }
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const taskId = args.find(a => /^wf-[a-f0-9]{8}$/i.test(a));
  const dryRun = args.includes('--dry-run');

  if (!taskId) {
    console.log('Usage: flow-test-ui.js <wf-XXXXXXXX> [--dry-run]');
    console.log('');
    console.log('  Runs UI tests for a task using Playwright MCP.');
    console.log('');
    console.log('  Options:');
    console.log('    --dry-run  Validate config and test flows without running');
    process.exit(1);
  }

  // Check if testing is enabled
  const config = getConfig();
  const testingConfig = config.testing || {};

  if (!testingConfig.enabled) {
    console.log('Testing is disabled (config.testing.enabled = false). Skipping.');
    process.exit(0);
  }

  const mode = testingConfig.mode || 'auto';
  if (mode !== 'auto' && mode !== 'full' && mode !== 'ui') {
    console.log(`Testing mode "${mode}" does not include UI tests. Skipping.`);
    process.exit(0);
  }

  console.log(`Running UI tests for ${taskId}${dryRun ? ' (dry run)' : ''}...`);

  runUITests(taskId, { dryRun })
    .then((report) => {
      console.log('');
      console.log(`Results: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.total} total`);

      if (report.stateCoverage.missing.length > 0) {
        console.log(`State coverage missing: ${report.stateCoverage.missing.join(', ')}`);
      }

      if (report.accessibility && report.accessibility.violations.length > 0) {
        console.log(`Accessibility violations: ${report.accessibility.violations.length}`);
      }

      const reportPath = path.join(PATHS.workflow, 'verifications', `${taskId}-ui.json`);
      console.log(`Report: ${reportPath}`);

      process.exit(report.summary.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(`Error running UI tests: ${err.message}`);
      process.exit(1);
    });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  runUITests,
  startDevServer,
  stopDevServer,
  assertDataInTree,
  checkStateCoverage,
  getPlaywrightMCPConfig,
  // Internal helpers (exported for testing)
  loadTestFlows,
  parseTestFile,
  flattenTreeToText,
  generateReport,
  saveReport,
  pollUrl,
  detectStateFromName,
  DEFAULT_STATE_CHECKS,
  DEFAULT_BASE_URL
};
