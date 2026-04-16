#!/usr/bin/env node

/**
 * Wogi Flow - Commit Log Gate (Core Module)
 *
 * Blocks git commit when there's an active task but request-log.md
 * hasn't been staged. Mechanical enforcement — same pattern as routing gate.
 *
 * Whitelist (commit allowed without log entry):
 * - No active task in ready.json
 * - Merge commits
 * - State-only commits (all files under .workflow/ or .claude/)
 * - Gate disabled via config.enforcement.commitLogGate.enabled: false
 *
 * v1.0: Initial implementation — pre-commit blocking gate
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getConfig, getReadyData, PATHS } = require('../../flow-utils');

/**
 * Check if a Bash command contains a git commit
 * @param {string} command - The Bash command string
 * @returns {boolean}
 */
function isGitCommit(command) {
  if (!command || typeof command !== 'string') return false;
  // Match git commit at start or after chain operators (&&, ;, ||)
  return /(?:^|&&\s*|;\s*|\|\|\s*)git\s+commit\b/.test(command.trim());
}

/**
 * Check if the command is a merge-related commit (whitelisted)
 * @param {string} command - The Bash command string
 * @returns {boolean}
 */
function isMergeCommit(command) {
  // git merge --continue or similar
  if (/git\s+merge/.test(command)) return true;
  // Commit message starts with "Merge" (from -m flag)
  const msgMatch = command.match(/-m\s+["']([^"']*)/);
  if (msgMatch && /^Merge\b/i.test(msgMatch[1])) return true;
  return false;
}

/**
 * Get list of staged file paths (relative to repo root)
 * @returns {string[]}
 */
function getStagedFiles() {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[commit-log-gate] getStagedFiles error: ${err.message}`);
    }
    return [];
  }
}

/**
 * Check if a git commit should be blocked due to missing request-log entry.
 *
 * @param {string} command - The Bash command being executed
 * @param {Object} [config] - Pre-loaded config (optional)
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string }}
 */
function checkCommitLogGate(command, config) {
  // Only check git commit commands
  if (!isGitCommit(command)) {
    return { allowed: true, blocked: false };
  }

  // Load config if not provided
  if (!config) {
    try { config = getConfig(); } catch (_err) { config = {}; }
  }

  // Check if gate is enabled (default: enabled when enforcement section exists)
  if (config.enforcement?.commitLogGate?.enabled === false) {
    return { allowed: true, blocked: false };
  }

  // Check for active task in ready.json
  let readyData;
  try {
    readyData = getReadyData();
  } catch (_err) {
    // Can't read ready.json → fail-open (don't block work)
    return { allowed: true, blocked: false };
  }

  if (!readyData.inProgress || readyData.inProgress.length === 0) {
    // No active task → allow (non-task commit)
    return { allowed: true, blocked: false };
  }

  // Whitelist merge commits
  if (isMergeCommit(command)) {
    return { allowed: true, blocked: false };
  }

  // Get staged files to check
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    // No staged files → commit will fail on its own, don't add noise
    return { allowed: true, blocked: false };
  }

  // Whitelist state-only commits (e.g., pre-compact, wogi-pre-compact state saves)
  const allStateOrConfig = stagedFiles.every(f =>
    f.startsWith('.workflow/') || f.startsWith('.claude/')
  );
  if (allStateOrConfig) {
    return { allowed: true, blocked: false };
  }

  // Check if request-log.md contains an entry for the active task.
  // We check file content instead of git staging because .workflow/ may be
  // in .gitignore (intentional user choice to keep state files out of git).
  // Checking staged files would silently fail when the directory is gitignored.
  const task = readyData.inProgress[0];
  const taskId = (typeof task === 'string' ? task : task.id) || 'unknown';

  const logPath = path.join(PATHS.state, 'request-log.md');
  let hasLogEntry = false;
  try {
    const logContent = fs.readFileSync(logPath, 'utf-8');
    hasLogEntry = logContent.includes(taskId);
  } catch (_err) {
    // File doesn't exist or can't be read — no log entry
  }

  if (hasLogEntry) {
    return { allowed: true, blocked: false };
  }

  return {
    allowed: false,
    blocked: true,
    reason: 'commit_without_log_entry',
    message: [
      `BLOCKED: Active task ${taskId} but no request-log entry found.`,
      'Add a request-log entry before committing.',
      `Append a ### R-[N] entry referencing ${taskId} to .workflow/state/request-log.md following the existing format.`
    ].join(' ')
  };
}

module.exports = { checkCommitLogGate, isGitCommit, isMergeCommit };
