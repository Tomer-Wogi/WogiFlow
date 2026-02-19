#!/usr/bin/env node

/**
 * Wogi Flow - Modular Workflow Steps
 *
 * Configurable plug-in steps that run at various points in the task workflow.
 * Developers can enable/disable steps via config or interactive setup.
 *
 * Usage:
 *   const { runSteps, listSteps, getStepConfig } = require('./flow-workflow-steps');
 *   await runSteps('afterTask', { taskId: 'TASK-001', files: [...] });
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

// ============================================================
// Step Registry - All available workflow steps
// ============================================================

/**
 * Step definitions with metadata
 * Each step has:
 *   - name: Unique identifier
 *   - description: Human-readable description
 *   - category: Grouping for UI
 *   - defaultMode: Default mode (block/warn/prompt/auto)
 *   - defaultWhen: Default execution point
 *   - defaultEnabled: Whether enabled by default
 *   - handler: Function that executes the step
 *   - configKey: Legacy config key for backwards compatibility
 */
const STEP_REGISTRY = {
  regressionTest: {
    name: 'regressionTest',
    description: 'Test random completed tasks to catch regressions',
    category: 'testing',
    defaultMode: 'warn',
    defaultWhen: 'afterTask',
    defaultEnabled: true,
    configKey: 'regressionTesting',
    handlerPath: './flow-step-regression',
  },
  securityScan: {
    name: 'securityScan',
    description: 'Run npm audit and security checks',
    category: 'quality',
    defaultMode: 'block',
    defaultWhen: 'beforeCommit',
    defaultEnabled: true,
    configKey: 'security',
    handlerPath: './flow-step-security',
  },
  updateKnowledgeBase: {
    name: 'updateKnowledgeBase',
    description: 'Document learnings in knowledge base',
    category: 'documentation',
    defaultMode: 'prompt',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    handlerPath: './flow-step-knowledge',
  },
  updateChangelog: {
    name: 'updateChangelog',
    description: 'Add entry to CHANGELOG.md',
    category: 'documentation',
    defaultMode: 'prompt',
    defaultWhen: 'beforeCommit',
    defaultEnabled: false,
    handlerPath: './flow-step-changelog',
  },
  codeComplexityCheck: {
    name: 'codeComplexityCheck',
    description: 'Flag functions exceeding complexity threshold',
    category: 'quality',
    defaultMode: 'warn',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    defaultConfig: { threshold: 10 },
    handlerPath: './flow-step-complexity',
  },
  coverageCheck: {
    name: 'coverageCheck',
    description: 'Ensure test coverage meets threshold',
    category: 'quality',
    defaultMode: 'warn',
    defaultWhen: 'beforeCommit',
    defaultEnabled: false,
    defaultConfig: { minCoverage: 80 },
    handlerPath: './flow-step-coverage',
  },
  codeSimplifier: {
    name: 'codeSimplifier',
    description: 'AI-powered code simplification suggestions (qualitative)',
    category: 'quality',
    defaultMode: 'prompt',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    defaultConfig: {
      maxFunctionLines: 50,
      maxNestingDepth: 3,
      suggestExtraction: true,
    },
    handlerPath: './flow-step-simplifier',
  },
  codeReview: {
    name: 'codeReview',
    description: 'Hybrid code review (multi-agent for big/high-risk)',
    category: 'quality',
    defaultMode: 'warn',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    defaultConfig: {
      multiAgentThreshold: 5,
      highRiskPatterns: ['auth', 'payment', 'security', 'crypto'],
      confidenceThreshold: 80,
    },
    handlerPath: './flow-step-review',
  },
  prTestAnalyzer: {
    name: 'prTestAnalyzer',
    description: 'Analyze test coverage and quality for modified files',
    category: 'testing',
    defaultMode: 'warn',
    defaultWhen: 'beforeCommit',
    defaultEnabled: true,
    defaultConfig: {
      checkCoverage: true,
      checkQuality: true,
      minCoverageForModified: 70,
    },
    handlerPath: './flow-step-pr-tests',
  },
  silentFailureHunter: {
    name: 'silentFailureHunter',
    description: 'Detect empty catch blocks and swallowed errors',
    category: 'quality',
    defaultMode: 'warn',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    defaultConfig: {
      checkEmptyCatch: true,
      checkLogOnlyCatch: true,
      checkUnhandledAsync: true,
      checkPromiseChains: true,
    },
    handlerPath: './flow-step-silent-failures',
  },
  commentAnalyzer: {
    name: 'commentAnalyzer',
    description: 'Analyze comment quality (TODOs, stale, JSDoc accuracy)',
    category: 'quality',
    defaultMode: 'warn',
    defaultWhen: 'afterTask',
    defaultEnabled: false,
    defaultConfig: {
      flagTodo: true,
      flagFixme: true,
      checkJsdoc: true,
      flagCommentedCode: true,
      flagStale: true,
    },
    handlerPath: './flow-step-comments',
  },
};

// Lazy load handlers to avoid circular dependencies
function getHandler(stepName) {
  const step = STEP_REGISTRY[stepName];
  if (!step) return null;

  // Lazy load the handler from handlerPath
  if (!step._handler && step.handlerPath) {
    try {
      step._handler = require(step.handlerPath);
    } catch (err) {
      // Handler not implemented yet
      if (process.env.DEBUG) {
        console.warn(`[DEBUG] Failed to load handler for ${stepName}: ${err.message}`);
      }
      return null;
    }
  }
  return step._handler;
}

// ============================================================
// Configuration Resolution
// ============================================================

/**
 * Get step configuration, merging defaults with user config
 * Supports legacy config keys for backwards compatibility
 */
function getStepConfig(stepName) {
  const config = getConfig();
  const stepDef = STEP_REGISTRY[stepName];

  if (!stepDef) {
    return null;
  }

  // Check new workflowSteps config first
  const workflowSteps = config.workflowSteps || {};
  const userConfig = workflowSteps[stepName] || {};

  // Fall back to legacy config if workflowSteps not defined for this step
  let legacyEnabled = null;
  let legacyConfig = {};

  if (stepDef.configKey && !workflowSteps[stepName]) {
    const legacySection = config[stepDef.configKey];
    if (legacySection) {
      legacyEnabled = legacySection.enabled !== false;
      legacyConfig = legacySection;
    }
  }

  return {
    enabled: userConfig.enabled ?? legacyEnabled ?? stepDef.defaultEnabled,
    mode: userConfig.mode || stepDef.defaultMode,
    when: userConfig.when || stepDef.defaultWhen,
    triggerFor: userConfig.triggerFor || stepDef.triggerFor,
    config: { ...stepDef.defaultConfig, ...legacyConfig, ...userConfig.config },
  };
}

/**
 * Get all steps with their resolved configuration
 */
function getAllSteps() {
  const steps = {};
  for (const stepName of Object.keys(STEP_REGISTRY)) {
    steps[stepName] = {
      ...STEP_REGISTRY[stepName],
      ...getStepConfig(stepName),
    };
  }
  return steps;
}

// ============================================================
// Step Execution
// ============================================================

/**
 * Run all enabled steps for a given execution point
 *
 * @param {string} when - Execution point: 'afterTask', 'beforeCommit', 'afterCommit', 'onSessionEnd'
 * @param {object} context - Context object with taskId, files, etc.
 * @returns {object} - { success: boolean, results: { stepName: { passed, message, blocked } } }
 */
async function runSteps(when, context = {}) {
  const results = {};
  let allPassed = true;
  let blocked = false;

  const allSteps = getAllSteps();

  for (const [stepName, step] of Object.entries(allSteps)) {
    // Skip disabled steps
    if (!step.enabled) {
      continue;
    }

    // Skip steps not for this execution point
    if (step.when !== when) {
      continue;
    }

    // Check file trigger patterns
    if (step.triggerFor && context.files) {
      const hasMatchingFile = context.files.some(file => {
        return step.triggerFor.some(pattern => {
          const ext = pattern.replace('*', '');
          return file.endsWith(ext);
        });
      });
      if (!hasMatchingFile) {
        continue;
      }
    }

    // Get handler
    const handler = getHandler(stepName);
    if (!handler || typeof handler.run !== 'function') {
      results[stepName] = { passed: true, skipped: true, message: 'Handler not implemented' };
      continue;
    }

    // Execute step
    console.log(colors.cyan + `\n[${stepName}] ` + colors.reset + step.description);

    try {
      const result = await handler.run({
        ...context,
        stepConfig: step.config,
        mode: step.mode,
      });

      results[stepName] = result;

      // Handle result based on mode
      if (!result.passed) {
        if (step.mode === 'block') {
          console.log(colors.red + `  BLOCKED: ${result.message}` + colors.reset);
          blocked = true;
          allPassed = false;
        } else if (step.mode === 'warn') {
          console.log(colors.yellow + `  WARNING: ${result.message}` + colors.reset);
          // Warnings don't block, but track that something failed
        } else if (step.mode === 'prompt') {
          // Prompts are handled by the handler itself
        }
      } else {
        console.log(colors.green + `  PASSED` + colors.reset);
      }

    } catch (err) {
      results[stepName] = { passed: false, error: err.message };
      console.log(colors.red + `  ERROR: ${err.message}` + colors.reset);

      if (step.mode === 'block') {
        blocked = true;
        allPassed = false;
      }
    }
  }

  return { success: allPassed, blocked, results };
}

// ============================================================
// CLI Helpers
// ============================================================

/**
 * List all steps with their status
 */
function listSteps() {
  const allSteps = getAllSteps();
  const byCategory = {};

  for (const [stepName, step] of Object.entries(allSteps)) {
    const category = step.category || 'other';
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push({ name: stepName, ...step });
  }

  return byCategory;
}

/**
 * Print step list to console
 */
function printSteps() {
  const byCategory = listSteps();

  console.log(colors.cyan + '\nWorkflow Steps\n' + colors.reset);

  for (const [category, steps] of Object.entries(byCategory)) {
    console.log(colors.yellow + `${category.charAt(0).toUpperCase() + category.slice(1)}:` + colors.reset);

    for (const step of steps) {
      const status = step.enabled ? colors.green + '[ON]' : colors.dim + '[OFF]';
      const mode = step.enabled ? ` (${step.mode})` : '';
      console.log(`  ${status}${colors.reset} ${step.name}${mode} - ${step.description}`);
    }
    console.log('');
  }
}

/**
 * Enable a step
 */
function enableStep(stepName) {
  if (!STEP_REGISTRY[stepName]) {
    return { success: false, error: `Unknown step: ${stepName}` };
  }

  const configPath = path.join(PROJECT_ROOT, '.workflow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!config.workflowSteps) {
    config.workflowSteps = {};
  }

  if (!config.workflowSteps[stepName]) {
    config.workflowSteps[stepName] = {};
  }

  config.workflowSteps[stepName].enabled = true;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { success: true };
}

/**
 * Disable a step
 */
function disableStep(stepName) {
  if (!STEP_REGISTRY[stepName]) {
    return { success: false, error: `Unknown step: ${stepName}` };
  }

  const configPath = path.join(PROJECT_ROOT, '.workflow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!config.workflowSteps) {
    config.workflowSteps = {};
  }

  if (!config.workflowSteps[stepName]) {
    config.workflowSteps[stepName] = {};
  }

  config.workflowSteps[stepName].enabled = false;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { success: true };
}

/**
 * Get step definitions for interactive setup
 */
function getStepDefinitions() {
  return Object.entries(STEP_REGISTRY).map(([name, step]) => ({
    name,
    description: step.description,
    category: step.category,
    defaultEnabled: step.defaultEnabled,
    defaultMode: step.defaultMode,
    defaultWhen: step.defaultWhen,
    defaultConfig: step.defaultConfig,
  }));
}

// ============================================================
// CLI Entry Point
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'list':
      printSteps();
      break;

    case 'enable':
      if (!args[1]) {
        console.log(colors.red + 'Usage: flow step enable <stepName>' + colors.reset);
        process.exit(1);
      }
      const enableResult = enableStep(args[1]);
      if (enableResult.success) {
        console.log(colors.green + `Enabled step: ${args[1]}` + colors.reset);
      } else {
        console.log(colors.red + enableResult.error + colors.reset);
        process.exit(1);
      }
      break;

    case 'disable':
      if (!args[1]) {
        console.log(colors.red + 'Usage: flow step disable <stepName>' + colors.reset);
        process.exit(1);
      }
      const disableResult = disableStep(args[1]);
      if (disableResult.success) {
        console.log(colors.green + `Disabled step: ${args[1]}` + colors.reset);
      } else {
        console.log(colors.red + disableResult.error + colors.reset);
        process.exit(1);
      }
      break;

    default:
      console.log(`
Workflow Steps CLI

Usage:
  flow step list              List all steps with status
  flow step enable <name>     Enable a step
  flow step disable <name>    Disable a step
      `);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  runSteps,
  listSteps,
  printSteps,
  enableStep,
  disableStep,
  getStepConfig,
  getAllSteps,
  getStepDefinitions,
  STEP_REGISTRY,
};
