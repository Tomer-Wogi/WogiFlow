#!/usr/bin/env node

/**
 * Wogi Flow - Git Post-Commit Hook
 *
 * Auto-closes auto-created tasks when their files are committed.
 * This prevents stale tasks from accumulating in the queue.
 *
 * Install: Copy or symlink to .git/hooks/post-commit
 * Or run: flow hooks install
 */

const { execSync } = require('child_process');
const path = require('path');

// Resolve paths relative to this script's location
const scriptsDir = path.resolve(__dirname, '../..');
const { getReadyData, saveReadyData, info, color } = require(path.join(scriptsDir, 'flow-utils'));

/**
 * Get list of files changed in the most recent commit
 * @returns {string[]} Array of file paths
 */
function getCommittedFiles() {
  try {
    const output = execSync('git diff-tree --no-commit-id --name-only -r HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Extract filename from task title
 * Handles titles like "Fix flow-utils.js" or "Create postinstall.js"
 * @param {string} title - Task title
 * @returns {string|null} Extracted filename or null
 */
function extractFilenameFromTitle(title) {
  if (!title) return null;

  // Common patterns: "Fix filename.js", "Create filename.js", "Update filename.js"
  const match = title.match(/^(?:Fix|Create|Update|Edit)\s+(.+)$/i);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Check if any committed files match a task's expected filename
 * @param {Object} task - Task object
 * @param {string[]} committedFiles - List of committed file paths
 * @returns {boolean} True if task matches committed files
 */
function taskMatchesCommittedFiles(task, committedFiles) {
  const expectedFilename = extractFilenameFromTitle(task.title);
  if (!expectedFilename) return false;

  // Check if any committed file ends with the expected filename
  return committedFiles.some(filePath => {
    const fileName = path.basename(filePath);
    return fileName === expectedFilename || filePath.endsWith(expectedFilename);
  });
}

/**
 * Auto-close auto-created tasks that match committed files
 */
function autoCloseMatchingTasks() {
  const committedFiles = getCommittedFiles();
  if (committedFiles.length === 0) return;

  const readyData = getReadyData();
  const inProgress = readyData.inProgress || [];

  // Find auto-created tasks
  const autoCreatedTasks = inProgress.filter(task =>
    typeof task === 'object' && task.autoCreated === true
  );

  if (autoCreatedTasks.length === 0) return;

  // Check each auto-created task against committed files
  const tasksToClose = [];

  for (const task of autoCreatedTasks) {
    if (taskMatchesCommittedFiles(task, committedFiles)) {
      tasksToClose.push(task);
    }
  }

  if (tasksToClose.length === 0) return;

  // Close matching tasks
  for (const task of tasksToClose) {
    // Remove from inProgress
    const index = readyData.inProgress.findIndex(t =>
      typeof t === 'object' && t.id === task.id
    );
    if (index !== -1) {
      readyData.inProgress.splice(index, 1);
    }

    // Add to recentlyCompleted with metadata
    const completedTask = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
      autoCompleted: true,
      completedBy: 'post-commit-hook'
    };

    readyData.recentlyCompleted = readyData.recentlyCompleted || [];
    readyData.recentlyCompleted.unshift(completedTask);

    // Keep only last 10
    readyData.recentlyCompleted = readyData.recentlyCompleted.slice(0, 10);

    // Output notification (visible in git output)
    console.log(`${color('green', '✓')} Auto-closed task: ${task.id} (${task.title})`);
  }

  // Save changes
  saveReadyData(readyData);

  if (tasksToClose.length > 0) {
    info(`${tasksToClose.length} auto-created task(s) closed by commit`);
  }
}

// Run if executed directly (as git hook)
if (require.main === module) {
  try {
    autoCloseMatchingTasks();
  } catch (err) {
    // Don't fail the commit if hook errors
    if (process.env.DEBUG) {
      console.error(`[post-commit] Error: ${err.message}`);
    }
  }
}

module.exports = {
  getCommittedFiles,
  extractFilenameFromTitle,
  taskMatchesCommittedFiles,
  autoCloseMatchingTasks
};
