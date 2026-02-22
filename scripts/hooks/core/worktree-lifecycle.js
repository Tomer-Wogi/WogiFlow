#!/usr/bin/env node

/**
 * Wogi Flow - Worktree Lifecycle (Core Module)
 *
 * CLI-agnostic logic for WorktreeCreate and WorktreeRemove hooks.
 * Claude Code 2.1.50+ fires these events when worktrees are created/removed.
 *
 * WorktreeCreate: Copies essential .workflow/state files to the new worktree
 * so that task context and decisions are available in the isolated environment.
 *
 * WorktreeRemove: Cleans up session state from the removed worktree to prevent
 * stale data from accumulating.
 */

const fs = require('fs');
const path = require('path');

/**
 * Essential state files to copy into new worktrees.
 * These files provide task awareness and project rules in isolated contexts.
 * Computed lazily to avoid freezing the registry list at require-time.
 */
const CORE_STATE_FILES = ['ready.json', 'decisions.md'];

function getEssentialStateFiles() {
  try {
    const { getRegistryMapFiles } = require('../../flow-utils');
    return [...CORE_STATE_FILES, ...getRegistryMapFiles()];
  } catch {
    return [...CORE_STATE_FILES, 'app-map.md', 'function-map.md', 'api-map.md'];
  }
}

/**
 * Session-specific files to clean up when a worktree is removed.
 */
const SESSION_FILES_TO_CLEAN = [
  'session-state.json',
  'durable-session.json'
];

/**
 * Handle WorktreeCreate event.
 * Copies essential state files from the main worktree to the new one.
 *
 * @param {Object} options
 * @param {string} options.worktreePath - Path to the new worktree
 * @param {string} options.projectRoot - Path to the main project root
 * @returns {Object} Result with message and copied file list
 */
function handleWorktreeCreate(options = {}) {
  const { worktreePath, projectRoot } = options;

  if (!worktreePath || !projectRoot) {
    return {
      enabled: true,
      message: null,
      copied: []
    };
  }

  const sourceStateDir = path.join(projectRoot, '.workflow', 'state');
  const targetStateDir = path.join(worktreePath, '.workflow', 'state');

  // Validate paths are within expected boundaries
  const resolvedSource = path.resolve(sourceStateDir);
  const resolvedProject = path.resolve(projectRoot);
  const resolvedWorktree = path.resolve(worktreePath);
  if (!resolvedSource.startsWith(resolvedProject + path.sep)) {
    return { enabled: true, message: 'Invalid source path', copied: [] };
  }
  if (!resolvedWorktree.startsWith(resolvedProject + path.sep) && resolvedWorktree !== resolvedProject) {
    return { enabled: true, message: 'Invalid worktree path — must be within project root', copied: [] };
  }

  const copied = [];

  try {
    // Ensure target .workflow/state directory exists
    fs.mkdirSync(targetStateDir, { recursive: true });

    for (const fileName of getEssentialStateFiles()) {
      const sourcePath = path.join(sourceStateDir, fileName);
      const targetPath = path.join(targetStateDir, fileName);

      try {
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          copied.push(fileName);
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[worktree-lifecycle] Failed to copy ${fileName}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    return {
      enabled: true,
      message: `WorktreeCreate: Failed to set up state directory: ${err.message}`,
      copied: []
    };
  }

  return {
    enabled: true,
    message: copied.length > 0
      ? `WorktreeCreate: Copied ${copied.length} state file(s) to worktree`
      : 'WorktreeCreate: No state files to copy',
    copied
  };
}

/**
 * Handle WorktreeRemove event.
 * Cleans up session-specific state files from the removed worktree path.
 *
 * @param {Object} options
 * @param {string} options.worktreePath - Path to the worktree being removed
 * @param {string} options.projectRoot - Path to the main project root
 * @returns {Object} Result with message and cleaned file list
 */
function handleWorktreeRemove(options = {}) {
  const { worktreePath, projectRoot } = options;

  if (!worktreePath || !projectRoot) {
    return {
      enabled: true,
      message: null,
      cleaned: []
    };
  }

  // Don't clean up the main project — only worktrees
  const resolvedWorktree = path.resolve(worktreePath);
  const resolvedProject = path.resolve(projectRoot);
  if (resolvedWorktree === resolvedProject) {
    return {
      enabled: true,
      message: 'WorktreeRemove: Skipped — cannot clean main project',
      cleaned: []
    };
  }
  if (!resolvedWorktree.startsWith(resolvedProject + path.sep)) {
    return {
      enabled: true,
      message: 'WorktreeRemove: Invalid worktree path — must be within project root',
      cleaned: []
    };
  }

  const stateDir = path.join(worktreePath, '.workflow', 'state');
  const cleaned = [];

  for (const fileName of SESSION_FILES_TO_CLEAN) {
    const filePath = path.join(stateDir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleaned.push(fileName);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[worktree-lifecycle] Failed to clean ${fileName}: ${err.message}`);
      }
    }
  }

  return {
    enabled: true,
    message: cleaned.length > 0
      ? `WorktreeRemove: Cleaned ${cleaned.length} session file(s) from worktree`
      : 'WorktreeRemove: No session files to clean',
    cleaned
  };
}

module.exports = {
  handleWorktreeCreate,
  handleWorktreeRemove,
  getEssentialStateFiles,
  SESSION_FILES_TO_CLEAN
};
