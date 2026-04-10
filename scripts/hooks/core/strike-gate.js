#!/usr/bin/env node

/**
 * Wogi Flow - Strike Escalation Gate (Core Module)
 *
 * Mechanical strike counter grouped by task ID.
 * Part of the Mechanical Enforcement Gates v3.0 initiative.
 *
 * Strike thresholds:
 *   - Strike 2 (blockThreshold): Blocks Edit/Write until hypothesis documented
 *   - Strike 3 (escalateThreshold): Auto-escalates L3→L2, requires mini-spec
 *   - Strike 4+ (hardBlockThreshold): Hard blocks all implementation tools
 *
 * Strike increment triggers (ONLY these):
 *   - Runtime verification failure (smoke test / API test)
 *   - User re-reports same issue (task bounced back to inProgress)
 *   - Skeptical evaluator grades overall FAIL
 *
 * NOT triggers: lint errors, typecheck errors, build failures
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, PATHS, safeJsonParse, writeJson } = require('../../flow-utils');

// ============================================================
// Constants
// ============================================================

const STRIKE_TRACKER_PATH = path.join(PATHS.state, 'strike-tracker.json');

// ============================================================
// Configuration
// ============================================================

/**
 * Check if strike escalation is enabled
 * @param {Object} [config] - Config object
 * @returns {boolean}
 */
function isStrikeGateEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.strikeEscalation?.enabled !== false;
}

/**
 * Get strike gate configuration with defaults
 * @param {Object} [config] - Config object
 * @returns {Object}
 */
function getStrikeConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.strikeEscalation ?? {};
  return {
    enabled: gate.enabled !== false,
    blockThreshold: gate.blockThreshold ?? 2,
    escalateThreshold: gate.escalateThreshold ?? 3,
    hardBlockThreshold: gate.hardBlockThreshold ?? 4,
    productionCrashThreshold: gate.productionCrashThreshold ?? 2
  };
}

// ============================================================
// Strike Tracker State
// ============================================================

/**
 * Read the strike tracker state.
 * @returns {{ tasks: Object }}
 */
function getStrikeTracker() {
  return safeJsonParse(STRIKE_TRACKER_PATH, { tasks: {} });
}

/**
 * Save the strike tracker state.
 * @param {Object} tracker
 */
function saveStrikeTracker(tracker) {
  writeJson(STRIKE_TRACKER_PATH, tracker);
}

/**
 * Get strike data for a specific task.
 * @param {string} taskId
 * @returns {{ strikes: number, attempts: Array, lastStrike: string|null, escalated: boolean, hypothesis: string|null, productionCrash: boolean }}
 */
function getTaskStrikes(taskId) {
  const tracker = getStrikeTracker();
  return tracker.tasks[taskId] ?? {
    strikes: 0,
    attempts: [],
    lastStrike: null,
    escalated: false,
    hypothesis: null,
    productionCrash: false
  };
}

/**
 * Record a strike for a task.
 * Called by: runtime verification failure, task bounce-back, skeptical evaluator FAIL.
 * @param {string} taskId
 * @param {Object} [details]
 * @param {string} [details.description] - What was attempted
 * @param {string[]} [details.filesChanged] - Files that were modified
 * @param {string} [details.verificationResult] - What verification said
 * @param {string} [details.trigger] - What caused the strike (verification-failure, task-bounce, evaluator-fail)
 * @returns {{ strikes: number, escalated: boolean, action: string }}
 */
function recordStrike(taskId, details) {
  const tracker = getStrikeTracker();
  if (!tracker.tasks[taskId]) {
    tracker.tasks[taskId] = {
      strikes: 0,
      attempts: [],
      lastStrike: null,
      escalated: false,
      hypothesis: null,
      productionCrash: false
    };
  }

  const task = tracker.tasks[taskId];
  task.strikes += 1;
  task.lastStrike = new Date().toISOString();
  task.attempts.push({
    timestamp: new Date().toISOString(),
    description: details?.description ?? 'Unknown attempt',
    filesChanged: details?.filesChanged ?? [],
    verificationResult: details?.verificationResult ?? 'failure',
    trigger: details?.trigger ?? 'unknown'
  });

  // Keep last 10 attempts
  if (task.attempts.length > 10) {
    task.attempts = task.attempts.slice(-10);
  }

  // Determine action based on thresholds
  let config;
  try { config = getConfig(); } catch (_err) { config = null; }
  const strikeConfig = getStrikeConfig(config);

  // Use production crash threshold if task is flagged
  const effectiveBlockThreshold = task.productionCrash
    ? strikeConfig.productionCrashThreshold
    : strikeConfig.blockThreshold;
  const effectiveEscalateThreshold = task.productionCrash
    ? strikeConfig.productionCrashThreshold
    : strikeConfig.escalateThreshold;

  let action = 'continue';
  if (task.strikes >= strikeConfig.hardBlockThreshold) {
    action = 'hard-block';
  } else if (task.strikes >= effectiveEscalateThreshold) {
    action = 'escalate';
    task.escalated = true;
  } else if (task.strikes >= effectiveBlockThreshold) {
    action = 'block-until-hypothesis';
  }

  saveStrikeTracker(tracker);

  return {
    strikes: task.strikes,
    escalated: task.escalated,
    action
  };
}

/**
 * Mark a task as production crash (forward-fix mode).
 * Lowers the strike threshold.
 * @param {string} taskId
 */
function markProductionCrash(taskId) {
  const tracker = getStrikeTracker();
  if (!tracker.tasks[taskId]) {
    tracker.tasks[taskId] = {
      strikes: 0,
      attempts: [],
      lastStrike: null,
      escalated: false,
      hypothesis: null,
      productionCrash: true
    };
  } else {
    tracker.tasks[taskId].productionCrash = true;
  }
  saveStrikeTracker(tracker);
}

/**
 * Document hypothesis for a task (lifts strike 2 block).
 * @param {string} taskId
 * @param {string} hypothesis - What was tried, why it failed, what's different
 */
function documentHypothesis(taskId, hypothesis) {
  const tracker = getStrikeTracker();
  if (tracker.tasks[taskId]) {
    tracker.tasks[taskId].hypothesis = hypothesis;
    tracker.tasks[taskId].hypothesisAt = new Date().toISOString();
    saveStrikeTracker(tracker);
  }
}

/**
 * Reset strikes for a task (user escape hatch at strike 4+).
 * @param {string} taskId
 */
function resetStrikes(taskId) {
  const tracker = getStrikeTracker();
  if (tracker.tasks[taskId]) {
    tracker.tasks[taskId].strikes = 0;
    tracker.tasks[taskId].hypothesis = null;
    tracker.tasks[taskId].escalated = false;
    tracker.tasks[taskId].attempts = [];
    saveStrikeTracker(tracker);
  }
}

/**
 * Clear strikes for a task (on successful completion).
 * @param {string} taskId
 */
function clearStrikes(taskId) {
  const tracker = getStrikeTracker();
  delete tracker.tasks[taskId];
  saveStrikeTracker(tracker);
}

// ============================================================
// Gate Checks (called by hooks)
// ============================================================

/**
 * Check strike gate for Edit/Write/Bash operations (PreToolUse).
 * @param {string} toolName - The tool being used (Edit, Write, Bash)
 * @param {Object} [config] - Config object
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string }}
 */
function checkStrikeGate(toolName, config) {
  if (!isStrikeGateEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  // Get active task from ready.json
  const readyPath = path.join(PATHS.state, 'ready.json');
  const ready = safeJsonParse(readyPath, { inProgress: [] });
  if (!ready.inProgress || ready.inProgress.length === 0) {
    return { allowed: true, blocked: false };
  }

  const activeTask = ready.inProgress[0];
  if (!activeTask || !activeTask.id) {
    return { allowed: true, blocked: false };
  }

  const taskId = activeTask.id;
  const taskStrikes = getTaskStrikes(taskId);

  if (taskStrikes.strikes === 0) {
    return { allowed: true, blocked: false };
  }

  const strikeConfig = getStrikeConfig(config);

  // Use production crash threshold if flagged
  const effectiveBlockThreshold = taskStrikes.productionCrash
    ? strikeConfig.productionCrashThreshold
    : strikeConfig.blockThreshold;
  const effectiveEscalateThreshold = taskStrikes.productionCrash
    ? strikeConfig.productionCrashThreshold
    : strikeConfig.escalateThreshold;

  // Strike 4+: Hard block on ALL implementation tools
  if (taskStrikes.strikes >= strikeConfig.hardBlockThreshold) {
    if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') {
      return {
        allowed: false,
        blocked: true,
        reason: 'strike-hard-block',
        message: `HARD BLOCK: Task ${taskId} has ${taskStrikes.strikes} consecutive failures.\n\n` +
          `This task has failed ${taskStrikes.strikes} times. The current approach is not working.\n\n` +
          `Options:\n` +
          `  (1) Pair debug with user — describe what you've observed and let the user investigate\n` +
          `  (2) Split into subtasks — break this into smaller, independently-verifiable pieces\n` +
          `  (3) User reset — say "reset strikes for ${taskId}" to clear the counter\n\n` +
          `The block lifts only when the user explicitly intervenes.`
      };
    }
  }

  // Strike 3: Block Edit/Write until mini-spec exists
  if (taskStrikes.strikes >= effectiveEscalateThreshold) {
    if (toolName === 'Edit' || toolName === 'Write') {
      // Check if mini-spec exists
      const specPath = path.join(PATHS.workflow, 'specs', `${taskId}.md`);
      if (!fs.existsSync(specPath)) {
        return {
          allowed: false,
          blocked: true,
          reason: 'strike-escalation',
          message: `STRIKE ${taskStrikes.strikes}: Task ${taskId} auto-escalated to L2.\n\n` +
            `This task has failed ${taskStrikes.strikes} times. A mini-spec is required before continuing.\n\n` +
            `Create .workflow/specs/${taskId}.md with these sections:\n` +
            `  1. **Previous Attempts** — what was tried and why each failed\n` +
            `  2. **Root Cause Hypothesis** — what you believe the actual problem is\n` +
            `  3. **All Affected Locations** — every file/location that needs the fix\n\n` +
            `The skeptical evaluator will run on the next implementation attempt.`
        };
      }
      // Mini-spec exists, allow
      return { allowed: true, blocked: false };
    }
  }

  // Strike 2: Block Edit/Write until hypothesis documented
  if (taskStrikes.strikes >= effectiveBlockThreshold) {
    if (toolName === 'Edit' || toolName === 'Write') {
      // Check if hypothesis is documented
      if (taskStrikes.hypothesis) {
        return { allowed: true, blocked: false };
      }

      // Check if a scope inventory exists (cross-gate: bugfix scope gate satisfies this)
      const scopePath = path.join(PATHS.state, `bugfix-scope-${taskId}.json`);
      try {
        const scopeData = safeJsonParse(scopePath, {});
        if (scopeData.scopeInventory) {
          return { allowed: true, blocked: false };
        }
      } catch (_err) {
        // No scope inventory
      }

      return {
        allowed: false,
        blocked: true,
        reason: 'strike-hypothesis-required',
        message: `STRIKE ${taskStrikes.strikes}: Document your hypothesis before continuing.\n\n` +
          `This task has failed ${taskStrikes.strikes} time(s). Before writing more code, document:\n` +
          `  (a) What was tried previously\n` +
          `  (b) Why it failed\n\n` +
          `Write this to .workflow/state/strike-tracker.json under this task's "hypothesis" field,\n` +
          `or create a scope inventory in .workflow/state/bugfix-scope-${taskId}.json.`
      };
    }
  }

  return { allowed: true, blocked: false };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  isStrikeGateEnabled,
  getStrikeConfig,

  // State management
  getStrikeTracker,
  getTaskStrikes,
  recordStrike,
  documentHypothesis,
  resetStrikes,
  clearStrikes,
  markProductionCrash,

  // Gate check (used by hooks)
  checkStrikeGate,

  // Constants
  STRIKE_TRACKER_PATH
};
