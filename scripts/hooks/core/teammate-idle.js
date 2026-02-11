#!/usr/bin/env node

/**
 * Wogi Flow - Teammate Idle (Core Module)
 *
 * CLI-agnostic teammate idle logic.
 * Called when a teammate agent becomes idle (Claude Code 2.1.33+ TeammateIdle event).
 *
 * Handles:
 * - Reading ready.json for available tasks
 * - Finding parallelizable tasks that don't conflict with active work
 * - Building rich task context for dispatch (acceptance criteria, files, patterns)
 * - Checking file conflicts to avoid multiple teammates touching same files
 * - Registering teammate state for visibility
 *
 * Supports two dispatch modes:
 * - "suggest": Returns task ID and title (original behavior)
 * - "dispatch": Returns full task context for immediate execution
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');

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

  // Late-load to avoid circular dependency issues during startup
  const { getAgentTeamsConfig, checkFileConflicts, buildTaskContext, markTeammateIdle: markIdle } = require('../../flow-agent-teams');
  const agentTeamsConfig = getAgentTeamsConfig();

  const result = {
    enabled: true,
    hasTask: false,
    suggestedTaskId: null,
    dispatchMode: agentTeamsConfig.teammateDispatch.mode,
    taskContext: null,
    message: null
  };

  try {
    // Mark this teammate as idle if we can identify them
    const teammateId = input.sessionId || input.source;
    if (teammateId) {
      try {
        markIdle(teammateId);
      } catch {
        // Non-critical, continue
      }
    }

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

    // Find the best task (highest priority without file conflicts)
    let suggested = null;
    let skippedConflicts = [];

    for (const task of availableTasks) {
      if (agentTeamsConfig.teammateDispatch.avoidFileConflicts) {
        const conflict = checkFileConflicts(task);
        if (conflict.hasConflict) {
          skippedConflicts.push({
            taskId: task.id,
            files: conflict.conflictingFiles,
            teammate: conflict.conflictingTeammate
          });
          continue;
        }
      }
      suggested = task;
      break;
    }

    if (!suggested) {
      const conflictMsg = skippedConflicts.length > 0
        ? ` (${skippedConflicts.length} task(s) skipped due to file conflicts with active teammates)`
        : '';
      result.message = `No conflict-free tasks available${conflictMsg}`;
      return result;
    }

    // Build the result
    result.hasTask = true;
    result.suggestedTaskId = suggested.id;

    // In dispatch mode, include full task context
    if (agentTeamsConfig.teammateDispatch.mode === 'dispatch' && agentTeamsConfig.teammateDispatch.includeContext) {
      result.taskContext = buildTaskContext(suggested);
      result.message = `Dispatching task: ${suggested.id} - ${suggested.title} (${suggested.priority || 'P2'})` +
        `\n\nRun: /wogi-start ${suggested.id}` +
        `\n\nDescription: ${suggested.description || 'No description'}` +
        (result.taskContext.files.length > 0
          ? `\n\nFiles to change:\n${result.taskContext.files.map(f => `  - ${f}`).join('\n')}`
          : '') +
        (result.taskContext.acceptanceCriteria.length > 0
          ? `\n\nAcceptance Criteria:\n${result.taskContext.acceptanceCriteria.map(c => `  - ${c}`).join('\n')}`
          : '');
    } else {
      result.message = `Suggested task: ${suggested.id} - ${suggested.title} (${suggested.priority || 'P2'})` +
        `\n\nRun: /wogi-start ${suggested.id}`;
    }

    // Note skipped conflicts in message
    if (skippedConflicts.length > 0) {
      result.message += `\n\nNote: ${skippedConflicts.length} higher-priority task(s) skipped due to file conflicts`;
    }

  } catch (err) {
    result.message = `Teammate idle handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleTeammateIdle, isTeammateIdleEnabled };
