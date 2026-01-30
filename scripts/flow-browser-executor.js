#!/usr/bin/env node

/**
 * Wogi Flow - Browser Test Executor
 *
 * Executes browser test flows using Claude Code's Chrome integration.
 * Maps flow steps to Chrome MCP tools for automated browser testing.
 *
 * Usage:
 *   flow browser-exec <flow-name>     Execute a specific test flow
 *   flow browser-exec all             Execute all test flows
 *   flow browser-exec --check         Check Chrome connection status
 *
 * Requires:
 *   - Claude Code v2.0.73+ with Chrome integration
 *   - Claude in Chrome extension v1.0.36+
 *   - Run with: claude --chrome
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, success, warn, error } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const FLOWS_DIR = path.join(PROJECT_ROOT, '.workflow', 'tests', 'flows');
const RESULTS_DIR = path.join(PROJECT_ROOT, '.workflow', 'tests', 'results');

// ============================================================
// Chrome Connection Check
// ============================================================

/**
 * Check if Chrome integration is available.
 *
 * Note: This function provides guidance for the user/AI on how to
 * check Chrome status. The actual Chrome MCP tools are invoked
 * by Claude Code, not directly by this script.
 *
 * @returns {object} - { connected: boolean, message: string, instructions?: string }
 */
function checkChromeConnection() {
  // Chrome integration is managed by Claude Code, not this script.
  // This function returns guidance on how to check and enable it.

  return {
    connected: null, // Unknown - Claude Code needs to check via /chrome command
    message: 'Chrome connection status must be checked via Claude Code',
    instructions: `
To check Chrome integration status:
1. Run the /chrome command in Claude Code
2. If not connected, run: claude --chrome
3. Ensure Claude in Chrome extension (v1.0.36+) is installed

Required for browser testing:
- Claude Code v2.0.73+
- Claude in Chrome extension
- Paid Claude plan (Pro/Team/Enterprise)
`.trim(),
    checkCommand: '/chrome'
  };
}

/**
 * Get Chrome connection instructions for display
 */
function getChromeInstructions() {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Chrome Integration Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Browser testing requires Claude Code's Chrome integration.

To enable:
1. Install the Claude in Chrome extension
   https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn

2. Start Claude Code with Chrome enabled:
   claude --chrome

3. Run /chrome to verify connection

Once connected, you can run browser tests with:
   /wogi-test-browser <flow-name>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

// ============================================================
// Flow Loading
// ============================================================

/**
 * Load a test flow from file
 * @param {string} flowName - Name of the flow (without extension)
 * @returns {object|null} - Flow data or null if not found
 */
function loadFlow(flowName) {
  const flowPath = path.join(FLOWS_DIR, `${flowName}.json`);

  if (!fs.existsSync(flowPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(flowPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    error(`Failed to parse flow ${flowName}: ${err.message}`);
    return null;
  }
}

/**
 * List all available test flows
 * @returns {string[]} - Array of flow names
 */
function listFlows() {
  if (!fs.existsSync(FLOWS_DIR)) {
    return [];
  }

  try {
    return fs.readdirSync(FLOWS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (err) {
    return [];
  }
}

// ============================================================
// Step Execution (Instructions for Claude)
// ============================================================

/**
 * Generate execution instructions for a step.
 *
 * These instructions tell Claude how to execute each step
 * using the Chrome MCP tools. The actual execution happens
 * when Claude processes these instructions.
 *
 * @param {object} step - The step to execute
 * @param {number} index - Step index (1-based)
 * @param {object} config - Browser testing config
 * @returns {object} - { action, toolName, params, description }
 */
function getStepInstructions(step, index, config) {
  const baseUrl = config.baseUrl || 'http://localhost:3000';
  const timeout = config.timeout || 30000;

  switch (step.action) {
    case 'navigate':
      const url = step.url.startsWith('http') ? step.url : `${baseUrl}${step.url}`;
      return {
        action: 'navigate',
        toolName: 'browser_navigate',
        params: { url },
        description: step.description || `Navigate to ${step.url}`,
        claudeInstruction: `Navigate to ${url}`
      };

    case 'click':
      return {
        action: 'click',
        toolName: 'browser_click',
        params: { selector: step.selector },
        description: step.description || `Click ${step.selector}`,
        claudeInstruction: `Click the element matching selector: ${step.selector}`
      };

    case 'type':
      return {
        action: 'type',
        toolName: 'browser_type',
        params: { selector: step.selector, text: step.value },
        description: step.description || `Type into ${step.selector}`,
        claudeInstruction: `Type "${step.value}" into the element matching: ${step.selector}`
      };

    case 'wait':
      return {
        action: 'wait',
        toolName: 'browser_wait', // May need to poll
        params: { selector: step.selector, timeout: step.timeout || timeout },
        description: step.description || `Wait for ${step.selector}`,
        claudeInstruction: `Wait for element ${step.selector} to appear (timeout: ${step.timeout || timeout}ms)`
      };

    case 'verify':
      const verifyType = step.exists !== undefined ? 'exists' :
                         step.contains !== undefined ? 'contains' : 'exists';
      return {
        action: 'verify',
        toolName: 'browser_read', // Read DOM to verify
        params: {
          selector: step.selector,
          verifyType,
          expectedValue: step.contains || step.exists
        },
        description: step.description || `Verify ${step.selector}`,
        claudeInstruction: verifyType === 'contains'
          ? `Verify element ${step.selector} contains text "${step.contains}"`
          : `Verify element ${step.selector} exists`
      };

    case 'screenshot':
      return {
        action: 'screenshot',
        toolName: 'browser_screenshot',
        params: { name: step.name },
        description: step.description || `Capture screenshot: ${step.name}`,
        claudeInstruction: `Take a screenshot and save it as ${step.name}`
      };

    default:
      return {
        action: 'unknown',
        toolName: null,
        params: {},
        description: `Unknown action: ${step.action}`,
        claudeInstruction: `Unknown step action: ${step.action}`
      };
  }
}

// ============================================================
// Flow Execution
// ============================================================

/**
 * Generate execution plan for a flow.
 *
 * This doesn't actually execute the flow - it generates
 * instructions that Claude can follow to execute it using
 * Chrome MCP tools.
 *
 * @param {string} flowName - Name of the flow
 * @param {object} options - Execution options
 * @returns {object} - { success, plan, flow, error? }
 */
function generateExecutionPlan(flowName, options = {}) {
  const config = getConfig();
  const browserConfig = config.browserTesting || {};

  // Load the flow
  const flow = loadFlow(flowName);
  if (!flow) {
    return {
      success: false,
      error: `Flow not found: ${flowName}`,
      availableFlows: listFlows()
    };
  }

  // Generate step instructions
  const steps = (flow.steps || []).map((step, index) => ({
    stepNumber: index + 1,
    ...getStepInstructions(step, index + 1, browserConfig),
    originalStep: step
  }));

  return {
    success: true,
    flowName,
    flow: {
      name: flow.name,
      description: flow.description,
      baseUrl: browserConfig.baseUrl || flow.baseUrl,
      tags: flow.tags || [],
      expectedResult: flow.expectedResult
    },
    steps,
    config: {
      timeout: browserConfig.timeout || 30000,
      screenshotOnFailure: browserConfig.screenshotOnFailure !== false,
      stopOnFailure: options.stopOnFailure !== false
    }
  };
}

/**
 * Format execution plan for display
 */
function formatExecutionPlan(plan) {
  if (!plan.success) {
    return `
${color('red', '✗')} ${plan.error}

${plan.availableFlows?.length > 0
  ? `Available flows:\n${plan.availableFlows.map(f => `  - ${f}`).join('\n')}`
  : 'No test flows found. Add flows to .workflow/tests/flows/'}
`.trim();
  }

  const lines = [
    '',
    color('cyan', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`),
    color('cyan', `🧪 Browser Test: ${plan.flowName}`),
    color('cyan', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`),
    '',
    plan.flow.description ? `${plan.flow.description}\n` : '',
    `Base URL: ${plan.flow.baseUrl || '(not set)'}`,
    `Timeout: ${plan.config.timeout}ms`,
    '',
    color('yellow', 'Steps to Execute:'),
    ''
  ];

  for (const step of plan.steps) {
    lines.push(`  ${step.stepNumber}. ${step.claudeInstruction}`);
    if (step.description !== step.claudeInstruction) {
      lines.push(color('dim', `     → ${step.description}`));
    }
  }

  lines.push('');
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (plan.flow.expectedResult) {
    lines.push('');
    lines.push(`Expected result: ${plan.flow.expectedResult}`);
  }

  return lines.join('\n');
}

// ============================================================
// Result Tracking
// ============================================================

/**
 * Create a result object for tracking test execution
 */
function createResult(flowName, plan) {
  return {
    flowName,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'pending', // pending, running, passed, failed
    steps: plan.steps.map(s => ({
      stepNumber: s.stepNumber,
      action: s.action,
      status: 'pending',
      error: null,
      screenshot: null
    })),
    summary: {
      total: plan.steps.length,
      passed: 0,
      failed: 0,
      skipped: 0
    }
  };
}

/**
 * Save test result to file
 */
function saveResult(result) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${result.flowName}-${timestamp}.json`;
  const filePath = path.join(RESULTS_DIR, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    return filePath;
  } catch (err) {
    error(`Failed to save result: ${err.message}`);
    return null;
  }
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Browser Test Executor

Usage:
  flow browser-exec <flow-name>     Generate execution plan for a flow
  flow browser-exec all             Generate plans for all flows
  flow browser-exec --list          List available test flows
  flow browser-exec --check         Show Chrome connection instructions

Test flows are stored in: .workflow/tests/flows/*.json

Note: Actual browser execution happens via Claude Code's Chrome integration.
Run 'claude --chrome' to enable Chrome support, then use /wogi-test-browser.
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--check')) {
    console.log(getChromeInstructions());
    return;
  }

  if (args.includes('--list')) {
    const flows = listFlows();
    if (flows.length === 0) {
      warn('No browser test flows found');
      console.log(`Create flows in: ${FLOWS_DIR}`);
    } else {
      console.log(color('cyan', '\nAvailable browser test flows:'));
      flows.forEach(f => console.log(`  - ${f}`));
      console.log('');
      console.log(color('dim', 'Run: /wogi-test-browser <flow-name>'));
    }
    return;
  }

  const flowName = args[0];

  if (flowName === 'all') {
    const flows = listFlows();
    if (flows.length === 0) {
      warn('No browser test flows found');
      return;
    }

    console.log(color('cyan', `\n🧪 Generating plans for ${flows.length} flow(s)\n`));

    for (const name of flows) {
      const plan = generateExecutionPlan(name);
      console.log(formatExecutionPlan(plan));
      console.log('');
    }
  } else {
    const plan = generateExecutionPlan(flowName);
    console.log(formatExecutionPlan(plan));
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  checkChromeConnection,
  getChromeInstructions,
  loadFlow,
  listFlows,
  getStepInstructions,
  generateExecutionPlan,
  formatExecutionPlan,
  createResult,
  saveResult
};

if (require.main === module) {
  main();
}
