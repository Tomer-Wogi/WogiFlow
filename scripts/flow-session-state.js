#!/usr/bin/env node

/**
 * Wogi Flow - Session State Manager
 *
 * Persists and restores session context across Claude sessions.
 * Enables automatic continuity when resuming work.
 *
 * Key features:
 * - Tracks current task across sessions
 * - Remembers recently modified files
 * - Stores session decisions
 * - Provides resume context for fast pickup
 *
 * Part of v1.7.0 Context Memory Management
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  STATE_DIR,
  color,
  success,
  error,
  readJson,
  writeJson,
  fileExists,
  printHeader,
  withLock
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const SESSION_PATH = path.join(STATE_DIR, 'session-state.json');

// Default configuration
const DEFAULTS = {
  enabled: true,
  autoRestore: true,
  maxGapHours: 24, // Consider session "resumed" if within this gap
  trackFiles: true,
  trackDecisions: true,
  maxRecentFiles: 20,
  maxRecentDecisions: 10
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get session state configuration
 */
function getSessionStateConfig() {
  const config = getConfig();
  return {
    ...DEFAULTS,
    ...(config.sessionState || {})
  };
}

// ============================================================
// Default State
// ============================================================

/**
 * Default session state structure
 */
function getDefaultState() {
  return {
    lastActive: null,
    cliSessionId: null,    // CLI-provided session ID (e.g., CLAUDE_SESSION_ID)
    currentTask: null,
    recentFiles: [],
    recentDecisions: [],
    contextSnapshot: {
      keyFacts: [],
      inProgress: null,
      blockers: []
    },
    metrics: {
      tasksCompleted: 0,
      filesModified: 0,
      errorsEncountered: 0,
      sessionCount: 0
    },
    lastSessionSummary: null,
    // Bypass tracking for enforcement
    bypassTracking: {
      count: 0,           // Number of bypasses in this session
      attempts: [],       // Array of bypass attempt details
      autoCreatedTasks: [] // Tasks that were auto-created (bypasses)
    }
  };
}

// ============================================================
// Core Operations
// ============================================================

/**
 * Load session state from file
 * Returns default state if file doesn't exist or is invalid
 */
function loadSessionState() {
  if (!fileExists(SESSION_PATH)) {
    return getDefaultState();
  }

  try {
    const state = readJson(SESSION_PATH, null);
    if (!state) return getDefaultState();

    // Merge with defaults to handle schema evolution
    return {
      ...getDefaultState(),
      ...state
    };
  } catch (parseError) {
    // Log in debug mode to help diagnose issues
    if (process.env.DEBUG) {
      console.warn(`[DEBUG] Could not parse session state: ${parseError.message}`);
    }
    return getDefaultState();
  }
}

/**
 * Save session state to file (with locking for concurrent access safety)
 */
async function saveSessionStateAsync(updates = {}) {
  return withLock(SESSION_PATH, async () => {
    const current = loadSessionState();
    const newState = {
      ...current,
      ...updates,
      lastActive: new Date().toISOString()
    };
    writeJson(SESSION_PATH, newState);
    return newState;
  });
}

/**
 * Save session state to file (sync version for backward compatibility)
 * Note: Use saveSessionStateAsync when possible for concurrent safety
 */
function saveSessionState(updates = {}) {
  const current = loadSessionState();
  const newState = {
    ...current,
    ...updates,
    lastActive: new Date().toISOString()
  };

  writeJson(SESSION_PATH, newState);
  return newState;
}

/**
 * Clear session state (for fresh start)
 */
function clearSession() {
  if (fileExists(SESSION_PATH)) {
    fs.unlinkSync(SESSION_PATH);
  }
  return getDefaultState();
}

// ============================================================
// Session Detection
// ============================================================

/**
 * Check if this is a resumed session (within maxGapHours)
 */
function isResumingSession() {
  const config = getSessionStateConfig();
  if (!config.enabled) return false;

  const state = loadSessionState();
  if (!state.lastActive) return false;

  const lastActive = new Date(state.lastActive);
  const hoursSince = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);

  return hoursSince < config.maxGapHours;
}

/**
 * Get time since last activity
 */
function getTimeSinceLastActive() {
  const state = loadSessionState();
  if (!state.lastActive) return null;

  const lastActive = new Date(state.lastActive);
  const ms = Date.now() - lastActive.getTime();

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m ago`;
  }
  return `${minutes}m ago`;
}

// ============================================================
// CLI Session ID
// ============================================================

/**
 * Set the CLI session ID (e.g., from CLAUDE_SESSION_ID)
 * This is called during session start to associate Wogi Flow state with the CLI session.
 *
 * Uses async version with locking to prevent race conditions when multiple
 * hooks fire simultaneously.
 *
 * @param {string} sessionId - The CLI-provided session ID
 * @returns {Promise<Object>} Updated session state
 */
async function setCliSessionId(sessionId) {
  if (!sessionId) return loadSessionState();
  return saveSessionStateAsync({ cliSessionId: sessionId });
}

/**
 * Get the stored CLI session ID
 * @returns {string|null} The CLI session ID or null
 */
function getCliSessionId() {
  const state = loadSessionState();
  return state.cliSessionId || null;
}

// ============================================================
// Task Tracking
// ============================================================

/**
 * Track task start
 */
function trackTaskStart(taskId, taskTitle, metadata = {}) {
  // saveSessionState already loads current state and merges
  return saveSessionState({
    currentTask: {
      id: taskId,
      title: taskTitle,
      startedAt: new Date().toISOString(),
      ...metadata
    }
  });
}

/**
 * Track task completion (async version with locking)
 * @param {string} _taskId - Task ID being completed (unused, kept for API)
 * @returns {Promise<Object>} Updated session state
 */
async function trackTaskCompleteAsync(_taskId) {
  return withLock(SESSION_PATH, async () => {
    const current = loadSessionState();
    const metrics = current.metrics || {};
    const newState = {
      ...current,
      currentTask: null,
      metrics: {
        ...metrics,
        tasksCompleted: (metrics.tasksCompleted || 0) + 1
      },
      lastActive: new Date().toISOString()
    };
    writeJson(SESSION_PATH, newState);
    return newState;
  });
}

/**
 * Track task completion (sync version for backward compatibility)
 * @deprecated Use trackTaskCompleteAsync for concurrent safety
 */
function trackTaskComplete(_taskId) {
  const state = loadSessionState();
  const newMetrics = {
    ...state.metrics,
    tasksCompleted: (state.metrics?.tasksCompleted || 0) + 1
  };

  return saveSessionState({
    currentTask: null,
    metrics: newMetrics
  });
}

/**
 * Get current task
 */
function getCurrentTask() {
  const state = loadSessionState();
  return state.currentTask;
}

/**
 * Clear stale current task if it's already completed
 * Called on session start to prevent showing completed tasks as "in progress"
 * Uses async version with locking for concurrent safety
 * @returns {Promise<boolean>} True if a stale task was cleared
 */
async function clearStaleCurrentTaskAsync() {
  return withLock(SESSION_PATH, async () => {
    const state = loadSessionState();
    if (!state.currentTask) return false;

    const taskId = typeof state.currentTask === 'object'
      ? state.currentTask.id
      : state.currentTask;

    if (!taskId) return false;

    // Check ready.json for this task
    try {
      const { getReadyData } = require('./flow-utils');
      const readyData = getReadyData();

      // Check if task is in recentlyCompleted
      const recentlyCompleted = readyData.recentlyCompleted || [];
      const isCompleted = recentlyCompleted.some(task =>
        (typeof task === 'object' ? task.id : task) === taskId
      );

      // Also check it's not in inProgress (shouldn't happen, but defensive)
      const inProgress = readyData.inProgress || [];
      const isInProgress = inProgress.some(task =>
        (typeof task === 'object' ? task.id : task) === taskId
      );

      // Invariant check: task should not be in both places
      if (isCompleted && isInProgress && process.env.DEBUG) {
        console.error(`[session-state] BUG: Task ${taskId} in both recentlyCompleted AND inProgress`);
      }

      if (isCompleted) {
        // Task was completed but session state wasn't updated - fix it now
        writeJson(SESSION_PATH, { ...state, currentTask: null, lastActive: new Date().toISOString() });
        if (process.env.DEBUG) {
          console.error(`[session-state] Cleared stale currentTask: ${taskId}`);
        }
        return true;
      }
    } catch (err) {
      // Non-critical - don't fail session start
      if (process.env.DEBUG) {
        console.error(`[session-state] clearStaleCurrentTask error: ${err.message}`);
      }
    }

    return false;
  });
}

/**
 * Clear stale current task (sync wrapper for backward compatibility)
 * @returns {boolean} True if a stale task was cleared
 * @deprecated Use clearStaleCurrentTaskAsync for concurrent safety
 */
function clearStaleCurrentTask() {
  const state = loadSessionState();
  if (!state.currentTask) return false;

  const taskId = typeof state.currentTask === 'object'
    ? state.currentTask.id
    : state.currentTask;

  if (!taskId) return false;

  try {
    const { getReadyData } = require('./flow-utils');
    const readyData = getReadyData();
    const recentlyCompleted = readyData.recentlyCompleted || [];
    const isCompleted = recentlyCompleted.some(task =>
      (typeof task === 'object' ? task.id : task) === taskId
    );

    if (isCompleted) {
      saveSessionState({ currentTask: null });
      if (process.env.DEBUG) {
        console.error(`[session-state] Cleared stale currentTask: ${taskId}`);
      }
      return true;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[session-state] clearStaleCurrentTask error: ${err.message}`);
    }
  }

  return false;
}

// ============================================================
// File Tracking
// ============================================================

/**
 * Track file modification
 */
function trackFileModified(filePath) {
  const config = getSessionStateConfig();
  if (!config.trackFiles) return null;

  const state = loadSessionState();
  const relPath = path.relative(process.cwd(), filePath);

  // Remove if already in list, add to front
  const recentFiles = [
    relPath,
    ...state.recentFiles.filter(f => f !== relPath)
  ].slice(0, config.maxRecentFiles);

  const newMetrics = {
    ...state.metrics,
    filesModified: (state.metrics?.filesModified || 0) + 1
  };

  return saveSessionState({
    recentFiles,
    metrics: newMetrics
  });
}

/**
 * Get recent files
 */
function getRecentFiles(limit = 10) {
  const state = loadSessionState();
  return state.recentFiles.slice(0, limit);
}

// ============================================================
// Decision Tracking
// ============================================================

/**
 * Track a decision made during session
 */
function trackDecision(decision, context = null) {
  const config = getSessionStateConfig();
  if (!config.trackDecisions) return null;

  const state = loadSessionState();

  const recentDecisions = [
    {
      decision,
      context,
      timestamp: new Date().toISOString()
    },
    ...state.recentDecisions
  ].slice(0, config.maxRecentDecisions);

  return saveSessionState({ recentDecisions });
}

/**
 * Get recent decisions
 */
function getRecentDecisions(limit = 5) {
  const state = loadSessionState();
  return state.recentDecisions.slice(0, limit);
}

// ============================================================
// Context Snapshot
// ============================================================

/**
 * Update context snapshot (key facts, blockers, etc.)
 */
function updateContextSnapshot(updates) {
  const state = loadSessionState();
  const contextSnapshot = {
    ...state.contextSnapshot,
    ...updates
  };
  return saveSessionState({ contextSnapshot });
}

/**
 * Add a key fact
 */
function addKeyFact(fact) {
  const state = loadSessionState();
  const keyFacts = [...(state.contextSnapshot?.keyFacts || [])];

  if (!keyFacts.includes(fact)) {
    keyFacts.push(fact);
    // Keep last 10
    while (keyFacts.length > 10) {
      keyFacts.shift();
    }
  }

  return updateContextSnapshot({ keyFacts });
}

/**
 * Set blockers
 */
function setBlockers(blockers) {
  return updateContextSnapshot({ blockers });
}

// ============================================================
// Session Summary
// ============================================================

/**
 * Save session summary (at session end)
 */
function saveSessionSummary(summary) {
  const state = loadSessionState();
  const newMetrics = {
    ...state.metrics,
    sessionCount: (state.metrics?.sessionCount || 0) + 1
  };

  return saveSessionState({
    lastSessionSummary: {
      ...summary,
      timestamp: new Date().toISOString()
    },
    metrics: newMetrics
  });
}

// ============================================================
// Resume Context
// ============================================================

/**
 * Get resume context for Claude
 * Returns formatted string with key context for picking up work
 */
function getResumeContext() {
  const config = getSessionStateConfig();
  if (!config.enabled) return null;

  const state = loadSessionState();
  if (!state.lastActive) return null;

  const lines = [];
  const timeSince = getTimeSinceLastActive();

  lines.push(`**Session resume** (last active: ${timeSince})`);
  lines.push('');

  // Current task
  if (state.currentTask) {
    lines.push(`**Resuming task**: ${state.currentTask.id} - ${state.currentTask.title}`);
  }

  // Recent files
  if (state.recentFiles.length > 0) {
    const recent = state.recentFiles.slice(0, 5);
    lines.push(`**Recently modified**: ${recent.join(', ')}`);
  }

  // Key facts
  if (state.contextSnapshot?.keyFacts?.length > 0) {
    lines.push(`**Key context**:`);
    for (const fact of state.contextSnapshot.keyFacts.slice(0, 5)) {
      lines.push(`  - ${fact}`);
    }
  }

  // Blockers
  if (state.contextSnapshot?.blockers?.length > 0) {
    lines.push(`**Blockers**: ${state.contextSnapshot.blockers.join(', ')}`);
  }

  // Last session summary
  if (state.lastSessionSummary?.summary) {
    lines.push('');
    lines.push(`**Last session**: ${state.lastSessionSummary.summary}`);
  }

  // Metrics
  if (state.metrics?.tasksCompleted > 0) {
    lines.push('');
    lines.push(color('dim', `Metrics: ${state.metrics.tasksCompleted} tasks completed, ${state.metrics.filesModified} files modified`));
  }

  return lines.length > 2 ? lines.join('\n') : null;
}

/**
 * Check for resume and display context if resuming
 * Returns true if resume context was displayed
 */
function checkAndDisplayResumeContext() {
  if (!isResumingSession()) {
    return false;
  }

  const context = getResumeContext();
  if (!context) {
    return false;
  }

  printHeader('Session Resume');
  console.log(context);
  console.log('');

  return true;
}

// ============================================================
// Error Tracking
// ============================================================

/**
 * Track an error encountered
 * @param {string} _errorType - Error type (reserved for future use)
 */
function trackError(_errorType = 'unknown') {
  const state = loadSessionState();
  const newMetrics = {
    ...state.metrics,
    errorsEncountered: (state.metrics?.errorsEncountered || 0) + 1
  };

  return saveSessionState({ metrics: newMetrics });
}

// ============================================================
// Bypass Tracking (Enforcement)
// ============================================================

/**
 * Track a workflow bypass attempt
 * Called when someone tries to edit without /wogi-start
 *
 * @param {Object} options
 * @param {string} options.filePath - File that was being edited
 * @param {string} options.operation - 'edit' or 'write'
 * @param {string} options.reason - Why it was considered a bypass
 * @param {string} options.taskId - Auto-created task ID (if any)
 */
function trackBypassAttempt(options = {}) {
  const state = loadSessionState();
  const { filePath, operation, reason, taskId } = options;

  const bypassTracking = state.bypassTracking || {
    count: 0,
    attempts: [],
    autoCreatedTasks: []
  };

  const attempt = {
    timestamp: new Date().toISOString(),
    filePath,
    operation,
    reason,
    taskId
  };

  bypassTracking.count += 1;
  bypassTracking.attempts.push(attempt);

  // Limit stored attempts to prevent unbounded growth
  if (bypassTracking.attempts.length > 50) {
    bypassTracking.attempts = bypassTracking.attempts.slice(-50);
  }

  // Track auto-created task IDs separately for easy lookup
  if (taskId && !bypassTracking.autoCreatedTasks.includes(taskId)) {
    bypassTracking.autoCreatedTasks.push(taskId);
  }

  return saveSessionState({ bypassTracking });
}

/**
 * Get bypass tracking data for the current session
 * @returns {Object} Bypass tracking data
 */
function getBypassTracking() {
  const state = loadSessionState();
  return state.bypassTracking || {
    count: 0,
    attempts: [],
    autoCreatedTasks: []
  };
}

/**
 * Check if there were any bypasses in this session
 * @returns {boolean}
 */
function hasWorkflowBypasses() {
  const tracking = getBypassTracking();
  return tracking.count > 0;
}

/**
 * Get a summary of bypasses for display
 * @returns {string|null} Summary string or null if no bypasses
 */
function getBypassSummary() {
  const tracking = getBypassTracking();
  if (tracking.count === 0) return null;

  const lines = [];
  lines.push(`⚠️ **Workflow Bypasses Detected**: ${tracking.count} attempt(s)`);

  if (tracking.autoCreatedTasks.length > 0) {
    lines.push(`   Auto-created tasks: ${tracking.autoCreatedTasks.join(', ')}`);
  }

  // Show recent attempts (last 3)
  const recentAttempts = tracking.attempts.slice(-3);
  if (recentAttempts.length > 0) {
    lines.push(`   Recent:`);
    for (const attempt of recentAttempts) {
      const file = attempt.filePath ? path.basename(attempt.filePath) : 'unknown';
      lines.push(`   - ${attempt.operation} ${file} (${attempt.reason})`);
    }
  }

  lines.push('');
  lines.push('   💡 Use /wogi-start before making changes to follow the workflow.');

  return lines.join('\n');
}

/**
 * Clear bypass tracking (e.g., at session end after user acknowledges)
 */
function clearBypassTracking() {
  return saveSessionState({
    bypassTracking: {
      count: 0,
      attempts: [],
      autoCreatedTasks: []
    }
  });
}

// ============================================================
// CLI Interface
// ============================================================

function printUsage() {
  console.log(`
Usage: flow-session-state.js [command] [args]

Commands:
  show              Show current session state
  resume            Show resume context (if resuming)
  clear             Clear session state
  task <id> <title> Set current task
  task done [id]    Mark task complete
  file <path>       Track file modification
  decision <text>   Track a decision
  fact <text>       Add a key fact
  --help            Show this help

Examples:
  node scripts/flow-session-state.js show
  node scripts/flow-session-state.js task TASK-042 "Add login"
  node scripts/flow-session-state.js fact "Using JWT for auth"
`);
}

// Main CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'show': {
      const state = loadSessionState();
      printHeader('Session State');
      console.log(JSON.stringify(state, null, 2));
      break;
    }

    case 'resume': {
      const displayed = checkAndDisplayResumeContext();
      if (!displayed) {
        console.log('No resume context available (new session)');
      }
      break;
    }

    case 'clear': {
      clearSession();
      success('Session state cleared');
      break;
    }

    case 'task': {
      if (args[1] === 'done') {
        const taskId = args[2] || getCurrentTask()?.id;
        if (taskId) {
          trackTaskComplete(taskId);
          success(`Task ${taskId} marked complete`);
        } else {
          error('No task to complete');
        }
      } else if (args[1] && args[2]) {
        trackTaskStart(args[1], args.slice(2).join(' '));
        success(`Started task: ${args[1]}`);
      } else {
        const task = getCurrentTask();
        if (task) {
          console.log(`Current task: ${task.id} - ${task.title}`);
        } else {
          console.log('No current task');
        }
      }
      break;
    }

    case 'file': {
      if (args[1]) {
        trackFileModified(args[1]);
        success(`Tracked file: ${args[1]}`);
      } else {
        const files = getRecentFiles();
        console.log('Recent files:', files.join(', ') || 'none');
      }
      break;
    }

    case 'decision': {
      if (args[1]) {
        trackDecision(args.slice(1).join(' '));
        success('Decision tracked');
      } else {
        const decisions = getRecentDecisions();
        if (decisions.length > 0) {
          console.log('Recent decisions:');
          for (const d of decisions) {
            console.log(`  - ${d.decision}`);
          }
        } else {
          console.log('No recent decisions');
        }
      }
      break;
    }

    case 'fact': {
      if (args[1]) {
        addKeyFact(args.slice(1).join(' '));
        success('Key fact added');
      } else {
        const state = loadSessionState();
        const facts = state.contextSnapshot?.keyFacts || [];
        if (facts.length > 0) {
          console.log('Key facts:');
          facts.forEach((f, i) => console.log(`  ${i}. ${f}`));
        } else {
          console.log('No key facts');
        }
      }
      break;
    }

    case '--help':
    case '-h':
      printUsage();
      break;

    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getSessionStateConfig,
  DEFAULTS,

  // Core operations
  loadSessionState,
  saveSessionState,
  saveSessionStateAsync,  // Concurrent-safe version
  clearSession,
  getDefaultState,

  // Session detection
  isResumingSession,
  getTimeSinceLastActive,

  // CLI Session ID
  setCliSessionId,
  getCliSessionId,

  // Task tracking
  trackTaskStart,
  trackTaskComplete,
  trackTaskCompleteAsync,
  getCurrentTask,
  clearStaleCurrentTask,
  clearStaleCurrentTaskAsync,

  // File tracking
  trackFileModified,
  getRecentFiles,

  // Decision tracking
  trackDecision,
  getRecentDecisions,

  // Context snapshot
  updateContextSnapshot,
  addKeyFact,
  setBlockers,

  // Session summary
  saveSessionSummary,

  // Resume context
  getResumeContext,
  checkAndDisplayResumeContext,

  // Error tracking
  trackError,

  // Bypass tracking (enforcement)
  trackBypassAttempt,
  getBypassTracking,
  hasWorkflowBypasses,
  getBypassSummary,
  clearBypassTracking,

  // Path
  SESSION_PATH
};
