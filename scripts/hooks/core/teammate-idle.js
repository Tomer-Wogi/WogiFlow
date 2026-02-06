#!/usr/bin/env node

/**
 * Wogi Flow - Teammate Idle (Core Module)
 *
 * CLI-agnostic teammate idle logic.
 * Called when a teammate agent becomes idle (Claude Code 2.1.33+ TeammateIdle event).
 *
 * Handles:
 * - Reading ready.json for available tasks
 * - Finding parallelizable tasks that don't conflict
 * - Suggesting next task for the idle agent
 *
 * This is EXPERIMENTAL and disabled by default.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');
const fs = require('fs');

// Import from parent scripts directory
const { getConfig, PATHS, safeJsonParse } = require('../../flow-utils');

/**
 * Check if teammate idle handling is enabled
 * @returns {boolean}
 */
function isTeammateIdleEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.teammateIdle?.enabled === true;
}

/**
 * Handle teammate idle event
 * @param {Object} input - Parsed hook input
 * @returns {Object} Core result
 */
function handleTeammateIdle(input) {
  if (!isTeammateIdleEnabled()) {
    return { enabled: false, hasTask: false, message: 'Teammate idle handling is disabled (experimental)' };
  }

  const result = {
    enabled: true,
    hasTask: false,
    suggestedTaskId: null,
    message: null
  };

  try {
    // Read current ready.json
    const readyPath = path.join(PATHS.state, 'ready.json');
    const ready = safeJsonParse(readyPath, {
      inProgress: [],
      ready: [],
      blocked: [],
      backlog: []
    });

    // Tasks in the ready array are already not blocked and not in progress
    const availableTasks = [...(ready.ready || [])];

    if (availableTasks.length === 0) {
      result.message = 'No tasks available for parallel execution';
      return result;
    }

    // Sort by priority (P0 > P1 > P2 > P3 > P4)
    availableTasks.sort((a, b) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
      const aPriority = priorityOrder[a.priority] ?? 3;
      const bPriority = priorityOrder[b.priority] ?? 3;
      return aPriority - bPriority;
    });

    // Suggest the highest priority task
    const suggested = availableTasks[0];
    result.hasTask = true;
    result.suggestedTaskId = suggested.id;
    result.message = `Suggested task: ${suggested.id} - ${suggested.title} (${suggested.priority || 'P2'})`;

  } catch (err) {
    result.message = `Teammate idle handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleTeammateIdle, isTeammateIdleEnabled };
