#!/usr/bin/env node

/**
 * Wogi Flow - Runtime Verification Gate
 *
 * Ensures UI tasks are verified through actual browser interaction,
 * not just static analysis (TypeScript, build, bundle grep).
 *
 * Verification Hierarchy (highest to lowest):
 *   1. WebMCP browser verification (automated, default when configured)
 *   2. Playwright/Puppeteer test generation (automated, runnable)
 *   3. User verification checklist (manual, always available)
 *
 * The gate activates for tasks that touch UI files (*.tsx, *.jsx, *.vue,
 * *.svelte, *.css, *.styled.*) and blocks completion until behavioral
 * evidence is provided.
 *
 * Commands:
 *   flow-runtime-verification.js detect <files...>  — Detect if task needs UI verification
 *   flow-runtime-verification.js classify <files...> — Classify risk level (high/standard)
 *   flow-runtime-verification.js checklist <spec>    — Generate user verification checklist
 *   flow-runtime-verification.js playwright <spec>   — Generate Playwright test script
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getConfig, safeJsonParse } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/** File patterns that trigger UI runtime verification */
const UI_FILE_PATTERNS = [
  /\.tsx$/,
  /\.jsx$/,
  /\.vue$/,
  /\.svelte$/,
  /\.css$/,
  /\.scss$/,
  /\.styled\./,
  /\.module\.css$/,
  /\.module\.scss$/
];

/** Patterns in code that indicate state mutation (high-risk) */
const HIGH_RISK_PATTERNS = [
  'useMutation',
  'invalidateQueries',
  'queryClient',
  'setQueryData',
  'onMutate',
  'optimistic',
  'useState.*fetch',
  'onSubmit',
  'handleSubmit',
  'useReducer'
];

/** Banned verification methods — these NEVER count as evidence */
const BANNED_EVIDENCE = [
  'bundle_grep',           // grep deployed bundle for function names
  'build_success_only',    // "vite build succeeds"
  'code_reading_only',     // "I read the code and it's logically correct"
  'type_check_only',       // "tsc --noEmit passes"
  'deploy_success_only'    // "aws s3 sync completes"
];

/** Evidence tier definitions */
const EVIDENCE_TIERS = {
  STATIC: { level: 0, name: 'Static', sufficient: false, description: 'Compilation, build, lint passed' },
  STRUCTURAL: { level: 1, name: 'Structural', sufficient: false, description: 'File exists, component imported, route registered' },
  OBSERVATIONAL: { level: 2, name: 'Observational', sufficient: true, description: 'Page loads, feature renders, no console errors' },
  INTERACTIVE: { level: 3, name: 'Interactive', sufficient: true, description: 'Clicked/typed/submitted and observed expected result persist' },
  AUTOMATED: { level: 4, name: 'Automated', sufficient: true, description: 'Test script exercised scenario and asserted result' }
};

// ============================================================
// Detection: Does this task need UI verification?
// ============================================================

/**
 * Detect whether a set of changed files requires UI runtime verification.
 *
 * @param {string[]} changedFiles — list of changed file paths
 * @returns {{ needsVerification: boolean, uiFiles: string[], reason: string }}
 */
function detectUIVerification(changedFiles) {
  const uiFiles = changedFiles.filter(f =>
    UI_FILE_PATTERNS.some(p => p.test(f))
  );

  if (uiFiles.length === 0) {
    return { needsVerification: false, uiFiles: [], reason: 'No UI files changed' };
  }

  return {
    needsVerification: true,
    uiFiles,
    reason: `${uiFiles.length} UI file(s) changed: ${uiFiles.slice(0, 5).join(', ')}${uiFiles.length > 5 ? '...' : ''}`
  };
}

// ============================================================
// Classification: Standard vs High-Risk
// ============================================================

/**
 * Classify the risk level of a UI task based on code patterns.
 * High-risk tasks involve state mutation and require extra verification.
 *
 * @param {string[]} changedFiles — files to analyze
 * @returns {{ risk: 'high'|'standard', reasons: string[], highRiskFiles: string[] }}
 */
function classifyRisk(changedFiles) {
  const highRiskFiles = [];
  const reasons = [];

  for (const filePath of changedFiles) {
    const absPath = path.resolve(PATHS.root, filePath);
    try {
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');

      for (const pattern of HIGH_RISK_PATTERNS) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(content)) {
          if (!highRiskFiles.includes(filePath)) {
            highRiskFiles.push(filePath);
            reasons.push(`${filePath}: contains ${pattern}`);
          }
        }
      }
    } catch (_err) {
      // Skip unreadable files
    }
  }

  return {
    risk: highRiskFiles.length > 0 ? 'high' : 'standard',
    reasons,
    highRiskFiles
  };
}

// ============================================================
// Checklist Generation (Fallback — always available)
// ============================================================

/**
 * Generate a user verification checklist from acceptance criteria.
 *
 * @param {Object} params
 * @param {string[]} params.criteria — acceptance criteria from the spec
 * @param {string} params.pagePath — URL path to verify (e.g., '/customers/123/integration')
 * @param {string} params.risk — 'high' or 'standard'
 * @returns {string} formatted checklist for the user
 */
function generateChecklist(params) {
  const { criteria = [], pagePath = '/', risk = 'standard' } = params;
  const lines = [];

  lines.push('━━━ USER VERIFICATION CHECKLIST ━━━');
  lines.push(`Page: ${pagePath}`);
  lines.push(`Risk: ${risk.toUpperCase()}`);
  lines.push('');
  lines.push('I cannot verify UI behavior from the CLI. Please check:');
  lines.push('');

  for (let i = 0; i < criteria.length; i++) {
    lines.push(`□ ${i + 1}. ${criteria[i]}`);
  }

  lines.push('');

  if (risk === 'high') {
    lines.push('HIGH-RISK EXTRA CHECKS (state mutation detected):');
    lines.push('□ After each action, wait 3 seconds (refetch/re-render)');
    lines.push('□ Refresh the page (F5) and verify changes persisted');
    lines.push('□ Navigate away and back — is the state still correct?');
    lines.push('□ Check browser DevTools console for errors');
    lines.push('');
  }

  lines.push('Reply "verified" when all checks pass, or describe what\'s broken.');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// Playwright Test Generation
// ============================================================

/**
 * Generate a Playwright test script from acceptance criteria.
 *
 * @param {Object} params
 * @param {string[]} params.criteria — acceptance criteria
 * @param {string} params.pagePath — URL path
 * @param {string} params.taskId — for the test file name
 * @param {string} params.risk — 'high' or 'standard'
 * @returns {{ script: string, filePath: string }}
 */
function generatePlaywrightTest(params) {
  const { criteria = [], pagePath = '/', taskId = 'unknown', risk = 'standard' } = params;

  const lines = [
    '// Auto-generated runtime verification test',
    `// Task: ${taskId}`,
    `// Generated: ${new Date().toISOString()}`,
    `// Risk level: ${risk}`,
    '//',
    '// Run: npx playwright test <this-file>',
    "// Or:  npx playwright test --headed <this-file>  (to watch)",
    '',
    "import { test, expect } from '@playwright/test';",
    '',
    `test.describe('Runtime Verification: ${taskId}', () => {`,
    ''
  ];

  for (let i = 0; i < criteria.length; i++) {
    const criterion = criteria[i];
    const safeCriterion = criterion.replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const safePath = pagePath.replace(/'/g, "\\'").replace(/`/g, '\\`');
    lines.push(`  test('Criterion ${i + 1}: ${safeCriterion}', async ({ page }) => {`);
    lines.push(`    await page.goto('${safePath}');`);
    lines.push('');
    lines.push(`    // TODO: Implement verification for: ${criterion}`);
    lines.push('    // 1. Perform the user action');
    lines.push('    // 2. Assert the expected result');
    lines.push('    // 3. Wait for any async updates');
    lines.push('');

    if (risk === 'high') {
      lines.push('    // HIGH-RISK: State mutation detected — verify persistence');
      lines.push('    await page.waitForTimeout(3000); // Wait for refetch');
      lines.push('    // Assert the state is still correct after refetch');
      lines.push('');
      lines.push('    // Persistence check: reload and verify');
      lines.push('    await page.reload();');
      lines.push('    await page.waitForLoadState("networkidle");');
      lines.push('    // Assert the state survived page reload');
    }

    lines.push('  });');
    lines.push('');
  }

  lines.push('});');

  const script = lines.join('\n');
  const fileName = `verify-${taskId}.spec.ts`;
  const filePath = path.join(PATHS.root, 'tests', 'verification', fileName);

  return { script, filePath, fileName };
}

// ============================================================
// WebMCP Verification Instructions
// ============================================================

/**
 * Generate WebMCP browser verification instructions.
 * These are injected into the AI's context when WebMCP is available.
 *
 * @param {Object} params
 * @param {string[]} params.criteria — acceptance criteria
 * @param {string} params.pagePath — URL path
 * @param {string} params.risk — 'high' or 'standard'
 * @param {string} params.devServerUrl — dev server URL (e.g., 'http://localhost:5173')
 * @returns {string} WebMCP verification instructions
 */
function generateWebMCPInstructions(params) {
  const { criteria = [], pagePath = '/', risk = 'standard', devServerUrl = 'http://localhost:5173' } = params;
  const fullUrl = `${devServerUrl}${pagePath}`;

  const lines = [];
  lines.push('━━━ WEBMCP RUNTIME VERIFICATION ━━━');
  lines.push('');
  lines.push('Use the browser MCP tools to verify each criterion:');
  lines.push('');
  lines.push(`1. Navigate: mcp_browser_navigate("${fullUrl}")`);
  lines.push('2. Wait for page load: mcp_browser_wait_for_load_state("networkidle")');
  lines.push('3. Screenshot BEFORE any changes: mcp_browser_screenshot()');
  lines.push('');

  for (let i = 0; i < criteria.length; i++) {
    lines.push(`CRITERION ${i + 1}: ${criteria[i]}`);
    lines.push('  ACTION: [perform the user action via mcp_browser_click/type/select]');
    lines.push('  WAIT: mcp_browser_wait_for_timeout(2000)');
    lines.push('  VERIFY: mcp_browser_screenshot() — check the result visually');
    lines.push('  ASSERT: mcp_browser_evaluate("document.querySelector(...)") — check DOM state');
    lines.push('');
  }

  if (risk === 'high') {
    lines.push('HIGH-RISK EXTRA STEPS:');
    lines.push('  After all criteria verified:');
    lines.push('  1. Wait 3 seconds: mcp_browser_wait_for_timeout(3000)');
    lines.push('  2. Screenshot again: mcp_browser_screenshot() — check state persisted');
    lines.push(`  3. Reload: mcp_browser_navigate("${fullUrl}")`);
    lines.push('  4. Wait: mcp_browser_wait_for_load_state("networkidle")');
    lines.push('  5. Screenshot: mcp_browser_screenshot() — check state survived reload');
    lines.push('');
  }

  lines.push('Record results in BEHAVIORAL EVIDENCE LOG:');
  lines.push('  For each criterion: ACTION → EXPECTED → OBSERVED → VERDICT');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// Behavioral Evidence Log Template
// ============================================================

/**
 * Generate a Behavioral Evidence Log template.
 *
 * @param {string} taskId
 * @param {string[]} criteria
 * @returns {string} BEL template
 */
function generateBELTemplate(taskId, criteria) {
  const lines = [
    '━━━ BEHAVIORAL EVIDENCE LOG ━━━',
    `Task: ${taskId}`,
    `Verified on: [localhost:PORT or deployed URL]`,
    `Time: ${new Date().toISOString()}`,
    `Method: [WEBMCP / PLAYWRIGHT / USER_CHECKLIST]`,
    ''
  ];

  for (const criterion of criteria) {
    lines.push(`CRITERION: "${criterion}"`);
    lines.push('  ACTION: [exact user action performed]');
    lines.push('  EXPECTED: [what should happen]');
    lines.push('  OBSERVED: [what ACTUALLY appeared — describe the UI, not the code]');
    lines.push('  WAIT: [waited N seconds for refetch/re-render]');
    lines.push('  VERDICT: PASS / FAIL');
    lines.push('  EVIDENCE TIER: [OBSERVATIONAL / INTERACTIVE / AUTOMATED]');
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ============================================================
// Repeat Failure Detection
// ============================================================

/**
 * Check if this task has had repeated failures (Groundhog Day detector).
 *
 * @param {string} taskId
 * @returns {{ strikeCount: number, previousAttempts: string[], requiresDifferentApproach: boolean }}
 */
function checkRepeatFailures(taskId) {
  // Validate taskId format
  if (!/^wf-[0-9a-f]{8}$/i.test(taskId)) {
    return { strikeCount: 0, requiresDifferentApproach: false };
  }

  const feedbackPath = path.join(PATHS.state, 'feedback-patterns.md');
  let strikeCount = 0;

  try {
    if (fs.existsSync(feedbackPath)) {
      const content = fs.readFileSync(feedbackPath, 'utf-8');
      // Look for REPEAT-FAILURE entries mentioning this task
      const pattern = new RegExp(`REPEAT-FAILURE.*${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      const matches = content.match(pattern);
      if (matches) {
        strikeCount = matches.length;
      }

      // Also count task-related entries
      const taskPattern = new RegExp(`Strike count: (\\d+).*${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const strikeMatch = content.match(taskPattern);
      if (strikeMatch) {
        strikeCount = Math.max(strikeCount, parseInt(strikeMatch[1], 10));
      }
    }
  } catch (_err) {
    // Non-critical
  }

  return {
    strikeCount,
    requiresDifferentApproach: strikeCount >= 2
  };
}

// ============================================================
// Backend Detection and API Test Generation
// ============================================================

/** File patterns that indicate backend/API work */
const BACKEND_FILE_PATTERNS = [
  /\.controller\./,
  /\.service\./,
  /\.resolver\./,
  /\.handler\./,
  /\/routes?\//,
  /\/api\//,
  /\/controllers?\//,
  /\/endpoints?\//,
  /\.dto\./,
  /\.guard\./,
  /\.middleware\./,
  /\.interceptor\./
];

/**
 * Detect whether a set of changed files requires backend API verification.
 *
 * @param {string[]} changedFiles
 * @returns {{ needsVerification: boolean, apiFiles: string[], reason: string }}
 */
function detectAPIVerification(changedFiles) {
  const apiFiles = changedFiles.filter(f =>
    BACKEND_FILE_PATTERNS.some(p => p.test(f))
  );

  if (apiFiles.length === 0) {
    return { needsVerification: false, apiFiles: [], reason: 'No API/backend files changed' };
  }

  return {
    needsVerification: true,
    apiFiles,
    reason: `${apiFiles.length} API file(s) changed: ${apiFiles.slice(0, 5).join(', ')}${apiFiles.length > 5 ? '...' : ''}`
  };
}

/**
 * Generate an API integration test script (like Postman but baked in).
 * Tests request/response shapes, status codes, and data persistence.
 *
 * @param {Object} params
 * @param {Array<Object>} params.endpoints — endpoints to test: { method, path, description, requestBody?, expectedStatus?, expectedFields? }
 * @param {string[]} params.criteria — acceptance criteria from spec
 * @param {string} params.taskId
 * @param {string} params.baseUrl — API base URL (e.g., 'http://localhost:3000')
 * @returns {{ script: string, filePath: string, fileName: string }}
 */
function generateAPITest(params) {
  const { endpoints = [], criteria = [], taskId = 'unknown', baseUrl = 'http://localhost:3000' } = params;

  const lines = [
    '// Auto-generated API integration test',
    `// Task: ${taskId}`,
    `// Generated: ${new Date().toISOString()}`,
    '//',
    '// Run: node --test <this-file>',
    '// Or:  npx vitest run <this-file>',
    '',
    "const { describe, it } = require('node:test');",
    "const assert = require('node:assert/strict');",
    '',
    `const BASE_URL = process.env.API_URL || '${baseUrl}';`,
    '',
    '/**',
    ' * Helper: make HTTP request and parse JSON response',
    ' */',
    'async function apiRequest(method, path, body = null, headers = {}) {',
    '  const url = `${BASE_URL}${path}`;',
    '  const options = {',
    '    method,',
    "    headers: { 'Content-Type': 'application/json', ...headers },",
    '  };',
    '  if (body) options.body = JSON.stringify(body);',
    '',
    '  const response = await fetch(url, options);',
    '  const contentType = response.headers.get("content-type") || "";',
    '  const data = contentType.includes("json") ? await response.json() : await response.text();',
    '',
    '  return { status: response.status, data, headers: Object.fromEntries(response.headers) };',
    '}',
    '',
    `describe('API Integration: ${taskId}', () => {`,
    ''
  ];

  // Generate tests from endpoints
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const method = (ep.method || 'GET').toUpperCase();
    const epPath = ep.path || '/';
    const desc = ep.description || `${method} ${epPath}`;
    const expectedStatus = ep.expectedStatus || 200;

    lines.push(`  it('${desc.replace(/'/g, "\\'")}', async () => {`);

    if (ep.requestBody) {
      lines.push(`    const body = ${JSON.stringify(ep.requestBody, null, 4).split('\n').join('\n    ')};`);
      lines.push(`    const res = await apiRequest('${method}', '${epPath}', body);`);
    } else {
      lines.push(`    const res = await apiRequest('${method}', '${epPath}');`);
    }

    lines.push('');
    lines.push(`    // Status code check`);
    lines.push(`    assert.equal(res.status, ${expectedStatus}, \`Expected ${expectedStatus}, got \${res.status}: \${JSON.stringify(res.data)}\`);`);

    if (ep.expectedFields && ep.expectedFields.length > 0) {
      lines.push('');
      lines.push('    // Response shape check');
      for (const field of ep.expectedFields) {
        lines.push(`    assert.ok(res.data.${field} !== undefined, 'Response missing field: ${field}');`);
      }
    }

    if (ep.persistenceCheck) {
      lines.push('');
      lines.push('    // Persistence check: re-fetch and verify data was stored');
      lines.push(`    const verify = await apiRequest('GET', '${ep.persistenceCheck}');`);
      lines.push(`    assert.equal(verify.status, 200, 'Persistence check: GET failed');`);
      if (ep.expectedFields && ep.expectedFields.length > 0) {
        for (const field of ep.expectedFields) {
          lines.push(`    assert.ok(verify.data.${field} !== undefined, 'Persistence: field ${field} not stored');`);
        }
      }
    }

    lines.push('  });');
    lines.push('');
  }

  // Generate tests from criteria (for endpoints not explicitly listed)
  if (criteria.length > 0 && endpoints.length === 0) {
    for (let i = 0; i < criteria.length; i++) {
      lines.push(`  it('Criterion ${i + 1}: ${criteria[i].replace(/'/g, "\\'")}', async () => {`);
      lines.push(`    // TODO: Implement API test for: ${criteria[i]}`);
      lines.push('    // 1. Make the API request');
      lines.push('    // 2. Assert status code');
      lines.push('    // 3. Assert response shape');
      lines.push('    // 4. If mutation: re-fetch and verify persistence');
      lines.push('  });');
      lines.push('');
    }
  }

  lines.push('});');

  const script = lines.join('\n');
  const fileName = `api-verify-${taskId}.test.js`;
  const filePath = path.join(PATHS.root, 'tests', 'verification', fileName);

  return { script, filePath, fileName };
}

/**
 * Generate curl-based API verification commands (quick manual check).
 *
 * @param {Array<Object>} endpoints — { method, path, requestBody?, expectedStatus? }
 * @param {string} baseUrl
 * @returns {string} formatted curl commands
 */
function generateCurlVerification(endpoints, baseUrl = 'http://localhost:3000') {
  const lines = ['━━━ API CURL VERIFICATION ━━━', ''];

  for (const ep of endpoints) {
    const method = (ep.method || 'GET').toUpperCase();
    const url = `${baseUrl}${ep.path}`;

    let cmd = `curl -s -w "\\n%{http_code}" -X ${method}`;
    cmd += ` -H "Content-Type: application/json"`;
    if (ep.requestBody) {
      // Escape single quotes for shell safety: replace ' with '\''
      const jsonBody = JSON.stringify(ep.requestBody).replace(/'/g, "'\\''");
      cmd += ` -d '${jsonBody}'`;
    }
    cmd += ` "${url}"`;

    lines.push(`# ${ep.description || `${method} ${ep.path}`}`);
    lines.push(`# Expected: ${ep.expectedStatus || 200}`);
    lines.push(cmd);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ============================================================
// Combined Task Type Detection
// ============================================================

/**
 * Detect the task type (frontend, backend, or full-stack) from changed files.
 *
 * @param {string[]} changedFiles
 * @returns {{ type: 'frontend'|'backend'|'fullstack'|'other', frontend: Object, backend: Object }}
 */
function detectTaskType(changedFiles) {
  const frontend = detectUIVerification(changedFiles);
  const backend = detectAPIVerification(changedFiles);

  let type = 'other';
  if (frontend.needsVerification && backend.needsVerification) type = 'fullstack';
  else if (frontend.needsVerification) type = 'frontend';
  else if (backend.needsVerification) type = 'backend';

  return { type, frontend, backend };
}

// ============================================================
// Verification Method Selection
// ============================================================

/**
 * Determine the best available verification method.
 *
 * @returns {{ method: 'webmcp'|'playwright'|'checklist', available: boolean, reason: string }}
 */
function selectVerificationMethod() {
  const config = getConfig();

  // 1. Check for WebMCP (default, highest priority)
  if (config.webmcp?.enabled) {
    return { method: 'webmcp', available: true, reason: 'WebMCP is configured — using browser verification' };
  }

  // Check for .mcp.json with browser-related servers
  const mcpPath = path.join(PATHS.root, '.mcp.json');
  const mcpConfig = safeJsonParse(mcpPath, null);
  if (mcpConfig) {
    const servers = mcpConfig.mcpServers || {};
    const hasBrowser = Object.keys(servers).some(k =>
      k.includes('browser') || k.includes('puppeteer') || k.includes('playwright')
    );
    if (hasBrowser) {
      return { method: 'webmcp', available: true, reason: 'Browser MCP server detected in .mcp.json' };
    }
  }

  // 2. Check for Playwright/Puppeteer
  const pkgPath = path.join(PATHS.root, 'package.json');
  const pkg = safeJsonParse(pkgPath, {});
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  if (allDeps['@playwright/test'] || allDeps['playwright']) {
    return { method: 'playwright', available: true, reason: 'Playwright detected in dependencies' };
  }

  if (allDeps['puppeteer'] || allDeps['puppeteer-core']) {
    return { method: 'playwright', available: true, reason: 'Puppeteer detected — generating Playwright-compatible test' };
  }

  // 3. Fallback: user checklist
  return { method: 'checklist', available: true, reason: 'No browser automation available — using manual verification checklist' };
}

// ============================================================
// CLI
// ============================================================

function main() {
  const command = process.argv[2] || 'help';
  const args = process.argv.slice(3);

  switch (command) {
    case 'detect': {
      const result = detectUIVerification(args);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'classify': {
      const result = classifyRisk(args);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'method': {
      const result = selectVerificationMethod();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'checklist': {
      const criteria = args;
      console.log(generateChecklist({ criteria, pagePath: '/', risk: 'standard' }));
      break;
    }

    case 'playwright': {
      const criteria = args;
      const { script } = generatePlaywrightTest({ criteria, pagePath: '/', taskId: 'manual', risk: 'standard' });
      console.log(script);
      break;
    }

    case 'task-type': {
      const result = detectTaskType(args);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'api-test': {
      const criteria = args;
      const { script } = generateAPITest({ criteria, taskId: 'manual', baseUrl: 'http://localhost:3000' });
      console.log(script);
      break;
    }

    case 'api-detect': {
      const result = detectAPIVerification(args);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'repeat': {
      const taskId = args[0] || 'unknown';
      const result = checkRepeatFailures(taskId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log(`
Wogi Flow - Runtime Verification Gate

Usage: flow-runtime-verification.js <command> [args...]

Commands:
  detect <files...>     Detect if task needs UI verification
  api-detect <files...> Detect if task needs API verification
  task-type <files...>  Detect task type (frontend/backend/fullstack)
  classify <files...>   Classify risk level (high/standard)
  method                Determine best verification method
  checklist <criteria>  Generate user verification checklist
  playwright <criteria> Generate Playwright test script
  api-test <criteria>   Generate API integration test script
  repeat <taskId>       Check for repeat failures
`);
  }
}

// ============================================================
// IGR bridge — pipe runtime-verification observations into Truth Gate's evidence store
// (Story 7 fast-follow: closes the loop so Tier 3 observations from Step 3.58 automatically
// inform the Step 3.9 Truth Gate without manual recordEvidence calls.)
// ============================================================

/**
 * Record a runtime-verification observation as tier-classified evidence on the
 * Truth Gate's durable-session storage. Thin bridge — no parallel storage.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.criterionId - durable-session step id
 * @param {string} opts.tierName - one of EVIDENCE_TIERS keys (STATIC|STRUCTURAL|OBSERVATIONAL|INTERACTIVE|AUTOMATED)
 * @param {string} opts.observation - short human description (≤200 chars)
 * @returns {{ ok:boolean, reason?:string }}
 */
function recordVerificationEvidence({ taskId, criterionId, tierName, observation }) {
  const tierEntry = EVIDENCE_TIERS[String(tierName || '').toUpperCase()];
  if (!tierEntry) {
    return { ok: false, reason: `unknown tier name: ${tierName}` };
  }
  let truthGate;
  try {
    truthGate = require('./flow-completion-truth-gate');
  } catch (_err) {
    return { ok: false, reason: 'truth-gate module unavailable' };
  }
  return truthGate.recordEvidence({
    taskId,
    criterionId,
    tier: tierEntry.level,
    observation,
  });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Detection
  detectUIVerification,
  detectAPIVerification,
  detectTaskType,
  classifyRisk,
  UI_FILE_PATTERNS,
  BACKEND_FILE_PATTERNS,
  HIGH_RISK_PATTERNS,

  // Evidence
  EVIDENCE_TIERS,
  BANNED_EVIDENCE,
  recordVerificationEvidence,  // IGR Story 7 fast-follow — bridge to Truth Gate

  // Frontend verification
  selectVerificationMethod,
  generateChecklist,
  generatePlaywrightTest,
  generateWebMCPInstructions,
  generateBELTemplate,

  // Backend verification
  generateAPITest,
  generateCurlVerification,

  // Repeat failure
  checkRepeatFailures
};

if (require.main === module) {
  main();
}
