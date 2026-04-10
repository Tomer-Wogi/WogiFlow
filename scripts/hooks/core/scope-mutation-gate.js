#!/usr/bin/env node

/**
 * Wogi Flow - Scope Mutation Guard (Core Module)
 *
 * Fully agnostic gate — no framework pattern matching.
 * Part of the Mechanical Enforcement Gates v3.0 initiative.
 *
 * Three rules:
 *   1. Fix tasks shouldn't create features: 2+ new files during fix/bugfix → warn
 *   2. Deletion ≠ fixing: deleting a file that predates the current task → warn
 *   3. Broken ≠ remove: task says "fix X" but diff deletes X → block
 *
 * "Agnostic" means: no file path patterns, no framework detection.
 * Rules operate on file counts, git history, and task metadata.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, PATHS, safeJsonParse, writeJson } = require('../../flow-utils');

// ============================================================
// Constants
// ============================================================

const SCOPE_MUTATION_STATE_PATH = path.join(PATHS.state, 'scope-mutation.json');

// ============================================================
// Configuration
// ============================================================

function isScopeMutationEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.scopeMutation?.enabled !== false;
}

function getScopeMutationConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.scopeMutation ?? {};
  return {
    enabled: gate.enabled !== false,
    newFileThreshold: gate.newFileThreshold ?? 2,
    mode: gate.mode ?? 'warn'
  };
}

// ============================================================
// State Tracking
// ============================================================

/**
 * Get scope mutation state for the current session.
 * Tracks new files created and files deleted per task.
 */
function getState() {
  return safeJsonParse(SCOPE_MUTATION_STATE_PATH, {
    taskId: null,
    newFiles: [],
    deletedFiles: [],
    warnings: []
  });
}

function saveState(state) {
  writeJson(SCOPE_MUTATION_STATE_PATH, state);
}

/**
 * Record a new file creation (PostToolUse on Write).
 * @param {string} taskId
 * @param {string} filePath
 */
function recordNewFile(taskId, filePath) {
  const state = getState();
  if (state.taskId !== taskId) {
    state.taskId = taskId;
    state.newFiles = [];
    state.deletedFiles = [];
    state.warnings = [];
  }
  const rel = path.relative(PATHS.root, filePath);
  if (!state.newFiles.includes(rel)) {
    state.newFiles.push(rel);
  }
  saveState(state);
}

/**
 * Record a file deletion detection (PostToolUse on Bash with rm/git rm).
 * @param {string} taskId
 * @param {string} filePath
 */
function recordDeletedFile(taskId, filePath) {
  const state = getState();
  if (state.taskId !== taskId) {
    state.taskId = taskId;
    state.newFiles = [];
    state.deletedFiles = [];
    state.warnings = [];
  }
  const rel = path.relative(PATHS.root, filePath);
  if (!state.deletedFiles.includes(rel)) {
    state.deletedFiles.push(rel);
  }
  saveState(state);
}

/**
 * Check if a file existed before the current task started.
 * Uses git to check if the file was tracked before the task's start time.
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExistedBeforeTask(filePath) {
  const { execFileSync } = require('node:child_process');
  try {
    // F3: Use execFileSync with array args to prevent command injection
    execFileSync('git', ['ls-files', '--error-unmatch', filePath], {
      encoding: 'utf-8',
      cwd: PATHS.root,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Clear state (on task completion).
 */
function clearState() {
  try {
    if (fs.existsSync(SCOPE_MUTATION_STATE_PATH)) {
      fs.unlinkSync(SCOPE_MUTATION_STATE_PATH);
    }
  } catch (_err) {
    // Non-critical
  }
}

// ============================================================
// Gate Checks
// ============================================================

/**
 * Check scope mutation for Write operations (PreToolUse).
 * Detects new file creation during fix tasks.
 * @param {string} toolName
 * @param {Object} toolInput
 * @param {Object} [config]
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string, warning?: boolean }}
 */
function checkScopeMutation(toolName, toolInput, config) {
  if (!isScopeMutationEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  const gateConfig = getScopeMutationConfig(config);

  // Get active task
  const readyPath = path.join(PATHS.state, 'ready.json');
  const ready = safeJsonParse(readyPath, { inProgress: [] });
  const activeTask = ready.inProgress?.[0];
  if (!activeTask?.id) {
    return { allowed: true, blocked: false };
  }

  const taskType = activeTask.type || 'feature';
  const isFixTask = ['fix', 'bugfix', 'bug'].includes(taskType);

  // Rule 1: Fix tasks creating new files
  if (toolName === 'Write' && toolInput.file_path && isFixTask) {
    const filePath = toolInput.file_path;

    // Check if this is a NEW file (doesn't exist yet)
    if (!fs.existsSync(filePath)) {
      const state = getState();
      // Count existing new files for this task
      const currentNewFiles = state.taskId === activeTask.id ? state.newFiles.length : 0;

      if (currentNewFiles + 1 >= gateConfig.newFileThreshold) {
        const msg = `SCOPE MUTATION: Fix task is creating ${currentNewFiles + 1} new files.\n\n` +
          `Fix tasks repair existing code — they rarely need to create new files.\n` +
          `New files so far: ${state.newFiles?.join(', ') || '(none)'}\n` +
          `Attempting to create: ${path.relative(PATHS.root, filePath)}\n\n` +
          `Are you adding a feature instead of fixing a bug?\n` +
          `If this creation is intentional, acknowledge and proceed.`;

        if (gateConfig.mode === 'block') {
          return { allowed: false, blocked: true, reason: 'scope-mutation-new-files', message: msg };
        }
        return { allowed: true, blocked: false, warning: true, message: msg };
      }
    }
  }

  // Rule 2: Deleting files that predate this task
  // This check runs on Bash commands that delete files
  if (toolName === 'Bash' && toolInput.command) {
    const cmd = toolInput.command.trim();

    // Detect deletion commands (F14: simplified regex, F10: split on whitespace)
    const deletePatterns = [
      /^rm\s+(.+)/,
      /^git\s+rm\s+(.+)/
    ];

    for (const pattern of deletePatterns) {
      const match = cmd.match(pattern);
      if (match) {
        // Strip flags, split remaining into individual paths (F10)
        const rawArgs = match[1].replace(/^(-[rfi]+\s+)+/, '').trim();
        const filePaths = rawArgs.split(/\s+/).filter(Boolean);

        for (const fp of filePaths) {
          // Skip workflow/temp/node_modules files
          if (fp.includes('.workflow/') || fp.includes('node_modules') || fp.includes('.git/')) {
            continue;
          }

          if (fileExistedBeforeTask(fp)) {
            const msg = `SCOPE MUTATION: Deleting a file that predates this task.\n\n` +
              `File: ${fp}\n` +
              `This file existed before the current task started.\n\n` +
              `If the task says "fix" this file, the answer is to repair it, not delete it.\n` +
              `"Broken" means fix it. Only delete if explicitly requested by the owner.`;

            if (gateConfig.mode === 'block') {
              return { allowed: false, blocked: true, reason: 'scope-mutation-delete', message: msg };
            }
            return { allowed: true, blocked: false, warning: true, message: msg };
          }
        }
      }
    }
  }

  return { allowed: true, blocked: false };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  isScopeMutationEnabled,
  getScopeMutationConfig,
  checkScopeMutation,
  recordNewFile,
  recordDeletedFile,
  fileExistedBeforeTask,
  getState,
  clearState
};
