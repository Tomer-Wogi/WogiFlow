#!/usr/bin/env node

/**
 * flow-browser-playwright.js - Playwright fallback for browser debugging
 *
 * Provides browser automation when Chrome MCP is unavailable.
 * Used by /wogi-debug-browser as a fallback backend.
 *
 * Owner: WogiFlow core team
 * Change process: Modify via /wogi-start, review via /wogi-review
 *
 * Usage:
 *   node scripts/flow-browser-playwright.js launch [--headed] [--video <path>]
 *   node scripts/flow-browser-playwright.js navigate <url>
 *   node scripts/flow-browser-playwright.js click <selector>
 *   node scripts/flow-browser-playwright.js type <selector> <text>
 *   node scripts/flow-browser-playwright.js screenshot <path>
 *   node scripts/flow-browser-playwright.js console-errors
 *   node scripts/flow-browser-playwright.js run-flow <flow-json-path>
 *   node scripts/flow-browser-playwright.js close
 *   node scripts/flow-browser-playwright.js check [--quiet]
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { safeJsonParse, isPathWithinProject } = require('./flow-utils');

const PROJECT_ROOT = path.join(__dirname, '..');

// CR-029: Cache playwright install check (won't change during execution)
let _playwrightInstalled = null;

// Runtime detection: check if playwright is installed
function isPlaywrightInstalled() {
  if (_playwrightInstalled !== null) return _playwrightInstalled;
  try {
    require.resolve('playwright');
    _playwrightInstalled = true;
  } catch (err) {
    _playwrightInstalled = false;
  }
  return _playwrightInstalled;
}

// CR-003: Max console messages to prevent unbounded memory growth
const MAX_CONSOLE_MESSAGES = 1000;

// State file for persistent browser session
const STATE_FILE = path.join(__dirname, '..', '.workflow', 'state', 'playwright-session.json');

// CR-008: Remove existsSync pre-check, use try-catch directly (security pattern #1)
// CR-001: Use safeJsonParse instead of raw JSON.parse (security pattern #2)
function loadState() {
  return safeJsonParse(STATE_FILE, null);
}

// CR-019: Atomic write - write to temp file then rename to prevent corruption on crash
function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = STATE_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    throw err;
  }
}

function clearState() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch (err) {
    // Ignore - file may not exist
  }
}

// CR-031: Configurable output - respect --quiet flag
const quiet = process.argv.includes('--quiet');
function output(obj) {
  console.log(JSON.stringify(obj));
}
function log(msg) {
  if (!quiet) console.error(msg);
}

async function launchBrowser(options = {}) {
  if (!isPlaywrightInstalled()) {
    output({
      success: false,
      error: 'Playwright is not installed. Run: npm install --save-optional playwright && npx playwright install chromium'
    });
    process.exit(1);
  }

  const { chromium } = require('playwright');

  const launchOptions = {
    headless: !options.headed
  };

  const contextOptions = {};

  // CR-002: Validate video path is within project
  if (options.videoPath) {
    if (!isPathWithinProject(path.resolve(options.videoPath), PROJECT_ROOT)) {
      output({ success: false, error: 'Video path must be within the project directory' });
      process.exit(1);
    }
    contextOptions.recordVideo = {
      dir: options.videoPath,
      size: { width: 1280, height: 720 }
    };
  }

  // CR-018: Single retry for transient launch failures
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (err) {
    log('Browser launch failed, retrying in 1s...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    browser = await chromium.launch(launchOptions);
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // CR-003: Collect console messages with size cap
  const consoleMessages = [];
  page.on('console', (msg) => {
    if (consoleMessages.length >= MAX_CONSOLE_MESSAGES) {
      consoleMessages.shift(); // Evict oldest
    }
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString()
    });
  });

  // Store connection info (PID-based for reconnection)
  saveState({
    pid: process.pid,
    launched: new Date().toISOString(),
    headed: !!options.headed,
    videoPath: options.videoPath || null
  });

  output({
    success: true,
    message: 'Browser launched',
    headed: !!options.headed,
    videoRecording: !!options.videoPath
  });

  return { browser, context, page, consoleMessages };
}

async function navigateTo(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    output({
      success: true,
      url: page.url(),
      title: await page.title()
    });
  } catch (err) {
    output({
      success: false,
      error: err.message
    });
  }
}

async function click(page, selector) {
  try {
    await page.click(selector, { timeout: 10000 });
    output({
      success: true,
      selector,
      action: 'click'
    });
  } catch (err) {
    output({
      success: false,
      selector,
      error: err.message
    });
  }
}

async function type(page, selector, text) {
  try {
    await page.fill(selector, text, { timeout: 10000 });
    output({
      success: true,
      selector,
      action: 'type'
    });
  } catch (err) {
    output({
      success: false,
      selector,
      error: err.message
    });
  }
}

async function screenshot(page, outputPath) {
  try {
    // CR-002: Validate screenshot path is within project
    const resolvedPath = path.resolve(outputPath);
    if (!isPathWithinProject(resolvedPath, PROJECT_ROOT)) {
      output({ success: false, error: 'Screenshot path must be within the project directory' });
      return;
    }
    // CR-015: Always use recursive:true for idempotent dir creation
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    await page.screenshot({ path: resolvedPath, fullPage: true });
    output({
      success: true,
      path: outputPath
    });
  } catch (err) {
    output({
      success: false,
      error: err.message
    });
  }
}

function getConsoleErrors(consoleMessages) {
  const errors = consoleMessages.filter(m => m.type === 'error');
  output({
    success: true,
    errorCount: errors.length,
    errors: errors.slice(-20) // Last 20 errors
  });
  return errors;
}

async function runFlow(page, flowPath, consoleMessages) {
  try {
    // CR-002: Validate flow path is within project
    const resolvedFlowPath = path.resolve(flowPath);
    if (!isPathWithinProject(resolvedFlowPath, PROJECT_ROOT)) {
      output({ success: false, error: 'Flow path must be within the project directory' });
      return;
    }

    // CR-001: Use safeJsonParse instead of raw JSON.parse
    const flow = safeJsonParse(resolvedFlowPath, null);
    if (!flow || !flow.steps) {
      output({ success: false, error: 'Invalid or missing flow file: ' + flowPath });
      return;
    }

    const results = [];

    for (const step of flow.steps) {
      const stepResult = { action: step.action, description: step.description };

      try {
        switch (step.action) {
          case 'navigate':
            await page.goto(step.url.startsWith('http') ? step.url : `${flow.baseUrl}${step.url}`, {
              waitUntil: 'domcontentloaded',
              timeout: 30000
            });
            stepResult.success = true;
            break;

          case 'wait':
            await page.waitForSelector(step.selector, { timeout: step.timeout || 5000 });
            stepResult.success = true;
            break;

          case 'type':
            await page.fill(step.selector, step.value, { timeout: 10000 });
            stepResult.success = true;
            break;

          case 'click':
            await page.click(step.selector, { timeout: 10000 });
            stepResult.success = true;
            break;

          case 'verify':
            if (step.exists !== undefined) {
              const el = await page.$(step.selector);
              stepResult.success = step.exists ? !!el : !el;
            } else if (step.contains) {
              const text = await page.textContent(step.selector);
              stepResult.success = text && text.includes(step.contains);
            }
            break;

          case 'screenshot': {
            // CR-002 + CR-015: Validate and ensure directory
            const ssDir = path.join(path.dirname(resolvedFlowPath), 'screenshots');
            fs.mkdirSync(ssDir, { recursive: true });
            const ssPath = path.join(ssDir, `${step.name || 'screenshot'}.png`);
            if (isPathWithinProject(ssPath, PROJECT_ROOT)) {
              await page.screenshot({ path: ssPath });
              stepResult.success = true;
              stepResult.path = ssPath;
            } else {
              stepResult.success = false;
              stepResult.error = 'Screenshot path outside project';
            }
            break;
          }

          default:
            stepResult.success = false;
            stepResult.error = `Unknown action: ${step.action}`;
        }
      } catch (err) {
        stepResult.success = false;
        stepResult.error = err.message;
      }

      results.push(stepResult);

      // Stop on failure
      if (!stepResult.success) break;
    }

    const allPassed = results.every(r => r.success);
    const errors = getConsoleErrors(consoleMessages);

    output({
      success: allPassed,
      flow: flow.name,
      stepsRun: results.length,
      stepsTotal: flow.steps.length,
      results,
      consoleErrors: errors.length
    });
  } catch (err) {
    output({
      success: false,
      error: err.message
    });
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--quiet');
  const command = args[0];

  if (!command) {
    output({
      success: false,
      error: 'Usage: flow-browser-playwright.js <command> [args]',
      commands: ['launch', 'navigate', 'click', 'type', 'screenshot', 'console-errors', 'run-flow', 'close', 'check']
    });
    process.exit(1);
  }

  // Special command: check if playwright is installed
  if (command === 'check') {
    output({
      installed: isPlaywrightInstalled(),
      stateFile: loadState() !== null
    });
    return;
  }

  // For launch, start a new browser session
  if (command === 'launch') {
    const headed = args.includes('--headed');
    const videoIdx = args.indexOf('--video');
    const videoPath = videoIdx >= 0 ? args[videoIdx + 1] : null;

    const { browser, context, page, consoleMessages } = await launchBrowser({ headed, videoPath });

    // Keep process alive and listen for commands on stdin
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', async (data) => {
      const cmd = data.trim().split(' ');
      // CR-006: Wrap each command in try-catch for error recovery
      try {
        switch (cmd[0]) {
          case 'navigate':
            await navigateTo(page, cmd[1]);
            break;
          case 'click':
            await click(page, cmd.slice(1).join(' '));
            break;
          case 'type':
            await type(page, cmd[1], cmd.slice(2).join(' '));
            break;
          case 'screenshot':
            await screenshot(page, cmd[1]);
            break;
          case 'console-errors':
            getConsoleErrors(consoleMessages);
            break;
          case 'run-flow':
            await runFlow(page, cmd[1], consoleMessages);
            break;
          case 'close':
            // CR-004: Always close context (finalizes video if recording, releases resources regardless)
            try { await context.close(); } catch (_) { /* ignore */ }
            await browser.close();
            clearState();
            output({ success: true, message: 'Browser closed' });
            process.exit(0);
            break;
          default:
            output({ success: false, error: `Unknown command: ${cmd[0]}` });
        }
      } catch (err) {
        // CR-006: Log error and continue accepting commands instead of crashing
        output({ success: false, error: err.message, recoverable: true });
      }
    });

    // CR-005: Handle graceful shutdown with timeout fallback
    process.on('SIGINT', async () => {
      const forceExitTimer = setTimeout(() => {
        log('Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, 5000);
      try {
        try { await context.close(); } catch (_) { /* ignore */ }
        await browser.close();
        clearState();
      } catch (err) {
        // Best effort cleanup
      }
      clearTimeout(forceExitTimer);
      process.exit(0);
    });

    return; // Keep alive
  }

  // For standalone commands, they need a running session
  output({
    success: false,
    error: `Command "${command}" requires a running browser session. Use "launch" first.`
  });
}

main().catch((err) => {
  output({
    success: false,
    error: err.message
  });
  process.exit(1);
});

module.exports = {
  isPlaywrightInstalled,
  launchBrowser,
  navigateTo,
  click,
  type,
  screenshot,
  getConsoleErrors,
  runFlow
};
