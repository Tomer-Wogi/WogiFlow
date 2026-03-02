#!/usr/bin/env node

/**
 * Wogi Flow - Revision Tracker
 *
 * Detects when users manually revise files from completed tasks.
 * This is the ground-truth quality signal: if a user edits files
 * right after AI completion, the AI's work wasn't good enough.
 *
 * Called on session start to check for revisions since last session.
 *
 * Part of S2: Model Performance Tracking
 */

const { execFileSync } = require('child_process');
const path = require('path');
const {
  getConfig,
  PATHS,
  readJson,
  fileExists
} = require('./flow-utils');
const { recordRevision, loadStats } = require('./flow-stats-collector');

// ============================================================
// Constants
// ============================================================

/**
 * Maximum number of completed tasks to check for revisions.
 * Limits git diff operations on session start.
 */
const MAX_TASKS_TO_CHECK = 20;

/**
 * Maximum age (in days) of completed tasks to check.
 * Old tasks are unlikely to have meaningful revision signals.
 */
const MAX_AGE_DAYS = 7;

// ============================================================
// Core Functions
// ============================================================

/**
 * Detect user revisions to recently completed tasks.
 * Compares current file state to the commit that completed each task.
 *
 * @returns {Promise<Object[]>} Array of { taskId, model, taskType, revisedFiles }
 */
async function detectRevisions() {
  const stats = loadStats();
  const now = Date.now();
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  // Get recent completed tasks that have changedFiles recorded
  const candidates = stats.recentTasks
    .filter((t) => {
      if (!t.changedFiles || t.changedFiles.length === 0) return false;
      const age = now - new Date(t.timestamp).getTime();
      return age < maxAge;
    })
    .slice(0, MAX_TASKS_TO_CHECK);

  if (candidates.length === 0) {
    return [];
  }

  const revisions = [];

  for (const task of candidates) {
    try {
      const revisedFiles = checkTaskForRevisions(task);
      if (revisedFiles.length > 0) {
        revisions.push({
          taskId: task.taskId,
          model: task.model,
          taskType: task.taskType,
          revisedFiles,
          completedAt: task.timestamp
        });
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[revision-tracker] Check failed for ${task.taskId}: ${err.message}`);
      }
    }
  }

  return revisions;
}

/**
 * Check if any files from a completed task have been modified since completion.
 *
 * @param {Object} task - Task record from stats
 * @returns {string[]} Array of revised file paths
 */
function checkTaskForRevisions(task) {
  const { changedFiles, timestamp } = task;
  if (!changedFiles || changedFiles.length === 0) return [];

  // Validate timestamp is an ISO-8601 date string (prevent injection via --since)
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(timestamp)) {
    if (process.env.DEBUG) {
      console.error(`[revision-tracker] Invalid timestamp format: ${timestamp}`);
    }
    return [];
  }

  const revisedFiles = [];

  for (const filePath of changedFiles) {
    // Validate filePath: no shell metacharacters, must be relative, no path traversal
    if (!filePath || /[;&|`$]/.test(filePath) || filePath.includes('..') || path.isAbsolute(filePath)) {
      if (process.env.DEBUG) {
        console.error(`[revision-tracker] Skipping invalid file path: ${filePath}`);
      }
      continue;
    }

    try {
      // Check if file has been modified since task completion
      // Use git log to find commits after the task timestamp
      const output = execFileSync('git', [
        'log',
        '--oneline',
        `--since=${timestamp}`,
        '--',
        filePath
      ], {
        cwd: PATHS.root,
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      if (output) {
        // There are commits touching this file after task completion
        // Filter out the task's own commit (first commit after timestamp is likely ours)
        const lines = output.split('\n').filter(Boolean);

        // If there's more than 1 commit since timestamp, user revised
        // (1st commit = task completion, 2nd+ = user revision)
        if (lines.length > 1) {
          revisedFiles.push(filePath);
        }
      }
    } catch (err) {
      // Git command failed — file may not be tracked
      if (process.env.DEBUG) {
        console.error(`[revision-tracker] git log failed for ${filePath}: ${err.message}`);
      }
    }
  }

  return revisedFiles;
}

/**
 * Run revision detection and record findings.
 * Called from session-start hook.
 *
 * @returns {Promise<{ checked: number, revisionsFound: number, details: Object[] }>}
 */
async function checkAndRecordRevisions() {
  const config = getConfig();
  if (config.metrics?.enabled === false) {
    return { checked: 0, revisionsFound: 0, details: [] };
  }

  const revisions = await detectRevisions();

  // Record each revision in stats
  for (const rev of revisions) {
    await recordRevision(rev.taskId);
  }

  return {
    checked: Math.min(loadStats().recentTasks.length, MAX_TASKS_TO_CHECK),
    revisionsFound: revisions.length,
    details: revisions
  };
}

/**
 * Format revision report for display.
 *
 * @param {Object} result - Result from checkAndRecordRevisions
 * @returns {string} Formatted report
 */
function formatRevisionReport(result) {
  if (result.revisionsFound === 0) {
    return `Revision check: ${result.checked} tasks checked, no revisions detected.`;
  }

  const lines = [];
  lines.push(`Revision check: ${result.revisionsFound} revision(s) detected`);
  lines.push('');

  for (const rev of result.details) {
    lines.push(`  ${rev.taskId} (${rev.model}, ${rev.taskType}):`);
    for (const f of rev.revisedFiles) {
      lines.push(`    - ${f}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [command] = process.argv.slice(2);

  switch (command) {
    case 'check': {
      const result = await checkAndRecordRevisions();
      console.log(formatRevisionReport(result));
      break;
    }

    case 'json': {
      const result = await checkAndRecordRevisions();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log(`
Revision Tracker

Usage: flow-revision-tracker.js <command>

Commands:
  check   Detect and record user revisions (formatted output)
  json    Detect and record user revisions (JSON output)

This checks if users manually modified files from recently completed tasks,
indicating the AI's work needed correction.
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  detectRevisions,
  checkAndRecordRevisions,
  formatRevisionReport
};

if (require.main === module) {
  main();
}
