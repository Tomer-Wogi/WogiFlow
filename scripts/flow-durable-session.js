#!/usr/bin/env node

/**
 * Wogi Flow - Durable Session Manager
 *
 * Unified step tracking that survives crashes/context resets.
 * Replaces both loop-session.json and hybrid-session.json with
 * a single durable-session.json.
 *
 * Features:
 * - Step-based execution for all task types
 * - Resume from exact step after crash
 * - Skip completed steps automatically
 * - Suspension support (time, poll, manual, file-based)
 * - Backward compatibility with existing APIs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getConfig, getProjectRoot, MAX_SESSION_HISTORY, withLock, writeJson, ensureDir, safeJsonParse } = require('./flow-utils');
const { validateCommand } = require('./flow-workflow');
const { validatePathWithinProject } = require('./flow-security');

// ============================================================================
// Constants
// ============================================================================

const SESSION_VERSION = '2.0';
const SESSION_FILE = 'durable-session.json';
const HISTORY_FILE = 'durable-history.json';
const LEGACY_HYBRID_FILE = 'hybrid-session.json'; // Deprecated, cleaned up on new session
// MAX_HISTORY imported from flow-utils as MAX_SESSION_HISTORY

const STEP_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  SUSPENDED: 'suspended'
};

const STEP_TYPE = {
  ACCEPTANCE_CRITERIA: 'acceptance-criteria',
  HYBRID_EXECUTION: 'hybrid-execution',
  QUALITY_GATE: 'quality-gate',
  CUSTOM: 'custom'
};

const SUSPENSION_TYPE = {
  CI_CD: 'ci-cd',
  SCHEDULED: 'scheduled',
  RATE_LIMIT: 'rate-limit',
  HUMAN_REVIEW: 'human-review',
  EXTERNAL_EVENT: 'external-event',
  LONG_RUNNING: 'long-running'
};

const RESUME_CONDITION = {
  TIME: 'time',
  POLL: 'poll',
  MANUAL: 'manual',
  FILE: 'file'
};

// ============================================================================
// Path Helpers
// ============================================================================

function getSessionPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.workflow', 'state', SESSION_FILE);
}

function getHistoryPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.workflow', 'state', HISTORY_FILE);
}

function getLegacyHybridPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.workflow', 'state', LEGACY_HYBRID_FILE);
}

/**
 * Clean up legacy hybrid-session.json if it exists
 * Called when creating a new durable session to prevent orphaned state
 */
function cleanupLegacyHybridSession() {
  const legacyPath = getLegacyHybridPath();
  if (fs.existsSync(legacyPath)) {
    try {
      fs.unlinkSync(legacyPath);
      console.log('[Migration] Removed legacy hybrid-session.json - now using durable-session.json');
    } catch (err) {
      // Non-fatal - just log and continue
      console.warn(`[Warning] Could not remove legacy hybrid-session.json: ${err.message}`);
    }
  }
}

// ============================================================================
// Core Session Management
// ============================================================================

/**
 * Create a new durable session
 * @param {string} taskId - Task identifier (e.g., "TASK-042")
 * @param {string} taskType - Type: "task", "loop", "bulk"
 * @param {Array} steps - Array of step definitions
 * @returns {Object} Created session
 */
function createDurableSession(taskId, taskType, steps = []) {
  const sessionPath = getSessionPath();

  // Check if session already exists for this task
  const existing = loadDurableSession();
  if (existing && existing.taskId === taskId) {
    // Return existing session for resume
    return existing;
  }

  // Clean up legacy hybrid-session.json if present (migration to v2.0)
  cleanupLegacyHybridSession();

  const session = createSessionObject(taskId, taskType, steps);
  saveDurableSession(session);
  return session;
}

/**
 * Create a new durable session with file locking (async version)
 * SECURITY: Prevents race conditions when multiple processes try to create sessions
 *
 * @param {string} taskId - Task identifier
 * @param {string} taskType - Type: "task", "loop", "bulk"
 * @param {Array} steps - Array of step definitions
 * @returns {Promise<Object>} Created or existing session
 */
async function createDurableSessionAsync(taskId, taskType, steps = [], options = {}) {
  const sessionPath = getSessionPath();

  return withLock(sessionPath, () => {
    // Check if session already exists for this task (inside lock)
    const existing = loadDurableSession();
    if (existing && existing.taskId === taskId) {
      // v4.1: If existing is a bulk session and we're starting a task, upgrade it
      // This preserves the task queue when transitioning from /wogi-bulk to /wogi-start
      if (existing.taskType === 'bulk' && taskType === 'task') {
        if (process.env.DEBUG) {
          console.log(`[Session] Upgrading bulk session to task session for ${taskId}`);
        }
        // Preserve queue data
        const preservedQueue = existing.taskQueue;

        // Create new task session
        const session = createSessionObject(taskId, taskType, steps, options);

        // Restore queue data
        if (preservedQueue && preservedQueue.enabled) {
          session.taskQueue = preservedQueue;
        }

        saveDurableSession(session);
        return session;
      }

      // Return existing session for resume (non-bulk case)
      return existing;
    }

    // v4.1: Check if there's an existing session with a different taskId but an active queue
    // that includes this taskId - preserve the queue data
    if (existing && existing.taskQueue?.enabled) {
      const queuedTasks = existing.taskQueue.tasks || [];
      if (queuedTasks.includes(taskId)) {
        if (process.env.DEBUG) {
          console.log(`[Session] Preserving queue data when switching to task ${taskId}`);
        }
        // Create new session for new task but preserve queue
        const preservedQueue = { ...existing.taskQueue };
        // Update queue index to point to this task
        const taskIndex = queuedTasks.indexOf(taskId);
        if (taskIndex >= 0) {
          preservedQueue.currentIndex = taskIndex;
        }

        cleanupLegacyHybridSession();
        const session = createSessionObject(taskId, taskType, steps, options);
        session.taskQueue = preservedQueue;
        saveDurableSession(session);
        return session;
      }
    }

    // Clean up legacy hybrid-session.json if present (migration to v2.0)
    cleanupLegacyHybridSession();

    const session = createSessionObject(taskId, taskType, steps, options);
    saveDurableSession(session);
    return session;
  });
}

/**
 * Create a session object (internal helper)
 * @param {string} taskId - Task identifier
 * @param {string} taskType - Type: "task", "loop", "bulk"
 * @param {Array} steps - Array of step definitions
 * @param {Object} options - Additional options
 * @param {Object} options.filesToChange - File scope from spec (create/modify/delete arrays)
 */
function createSessionObject(taskId, taskType, steps = [], options = {}) {
  return {
    version: SESSION_VERSION,
    sessionId: `sess-${Date.now()}`,
    taskId,
    taskType,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Cache config once to avoid repeated access in loop
    steps: (() => {
      const config = getConfig();
      const defaultMaxAttempts = config.durableSteps?.defaultMaxAttempts || 5;
      return steps.map((step, index) => normalizeStep(step, index, defaultMaxAttempts));
    })(),

    execution: {
      currentStepIndex: 0,
      iteration: 0,
      totalRetries: 0,
      checkpointsCreated: 0
    },

    suspension: null,

    metrics: {
      stepsCompleted: 0,
      stepsFailed: 0,
      stepsSkipped: 0,
      tokensSaved: 0
    },

    // Task queue for multi-task execution (v2.1)
    taskQueue: {
      enabled: false,
      tasks: [],           // Array of task IDs to process
      currentIndex: 0,     // Current position in queue
      source: null,        // How queue was created: "bulk", "natural", "manual"
      queuedAt: null,
      completedTasks: []   // Track completed task IDs
    },

    // v4.0: File scope for runtime enforcement (from spec's filesToChange)
    filesToChange: options.filesToChange || null
  };
}

/**
 * Normalize a step to the standard schema
 * @param {string|Object} step - Step definition
 * @param {number} index - Step index
 * @param {number} defaultMaxAttempts - Default max attempts from config (passed to avoid repeated getConfig calls)
 */
function normalizeStep(step, index, defaultMaxAttempts = 5) {
  // Handle string input (backward compat with acceptance criteria)
  if (typeof step === 'string') {
    return {
      id: `step-${String(index + 1).padStart(3, '0')}`,
      type: STEP_TYPE.ACCEPTANCE_CRITERIA,
      description: step,
      status: STEP_STATUS.PENDING,
      priority: index + 1,
      startedAt: null,
      completedAt: null,
      attempts: 0,
      maxAttempts: defaultMaxAttempts,
      lastAttemptAt: null,
      verificationProof: null,
      error: null,
      metadata: {}
    };
  }

  // Handle object input
  return {
    id: step.id || `step-${String(index + 1).padStart(3, '0')}`,
    type: step.type || STEP_TYPE.CUSTOM,
    description: step.description || step.action || '',
    status: step.status || STEP_STATUS.PENDING,
    priority: step.priority || index + 1,
    startedAt: step.startedAt || null,
    completedAt: step.completedAt || null,
    attempts: step.attempts || 0,
    maxAttempts: step.maxAttempts || defaultMaxAttempts,
    lastAttemptAt: step.lastAttemptAt || null,
    verificationProof: step.verificationProof || null,
    error: step.error || null,
    metadata: step.metadata || {}
  };
}

/**
 * Load the current durable session
 * @returns {Object|null} Session or null if none exists
 */
function loadDurableSession() {
  const sessionPath = getSessionPath();

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    // Use safeJsonParse to prevent prototype pollution
    const session = safeJsonParse(sessionPath, null);

    // Validate session structure
    if (!session || typeof session !== 'object') {
      if (process.env.DEBUG) {
        console.warn('[DEBUG] Invalid session: not an object');
      }
      return null;
    }

    // Ensure steps array exists
    if (!Array.isArray(session.steps)) {
      session.steps = [];
    }

    // Ensure execution object exists
    if (!session.execution || typeof session.execution !== 'object') {
      session.execution = {
        currentStepIndex: 0,
        iteration: 0,
        totalRetries: 0,
        checkpointsCreated: 0
      };
    }

    // Ensure metrics object exists
    if (!session.metrics || typeof session.metrics !== 'object') {
      session.metrics = {
        stepsCompleted: 0,
        stepsFailed: 0,
        stepsSkipped: 0,
        tokensSaved: 0
      };
    }

    return session;
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn(`[DEBUG] Could not parse durable session: ${err.message}`);
    }
    return null;
  }
}

/**
 * Get file scope from current durable session
 * Used by scope-gate for runtime enforcement
 * @returns {Object|null} filesToChange object or null if no scope defined
 */
function getSessionFileScope() {
  const session = loadDurableSession();
  return session?.filesToChange || null;
}

/**
 * Get boundary declarations from current durable session
 * Used by scope-gate for runtime boundary enforcement
 * @returns {string[]|null} Array of boundary patterns or null if no boundaries defined
 */
function getSessionBoundaries() {
  const session = loadDurableSession();
  return session?.boundaries || null;
}

/**
 * Save the durable session
 * @param {Object} session - Session to save
 */
function saveDurableSession(session) {
  const sessionPath = getSessionPath();

  // Ensure directory exists
  ensureDir(path.dirname(sessionPath));

  session.updatedAt = new Date().toISOString();
  // Use atomic writeJson to prevent data corruption on concurrent access
  writeJson(sessionPath, session);
}

/**
 * Archive the session to history and remove active session
 * @param {string} status - Final status: "completed", "failed", "cancelled"
 * @returns {Object|null} Archived session
 */
function archiveDurableSession(status = 'completed') {
  const session = loadDurableSession();
  if (!session) return null;

  // Finalize session
  session.status = status;
  session.endedAt = new Date().toISOString();

  // Calculate final metrics
  session.metrics.stepsCompleted = session.steps.filter(s => s.status === STEP_STATUS.COMPLETED).length;
  session.metrics.stepsFailed = session.steps.filter(s => s.status === STEP_STATUS.FAILED).length;
  session.metrics.stepsSkipped = session.steps.filter(s => s.status === STEP_STATUS.SKIPPED).length;

  // Load and update history
  const historyPath = getHistoryPath();
  let history = [];

  if (fs.existsSync(historyPath)) {
    // Use safeJsonParse to prevent prototype pollution
    const parsed = safeJsonParse(historyPath, []);
    history = Array.isArray(parsed) ? parsed : [];
  }

  history.push(session);

  // Keep only last N sessions
  if (history.length > MAX_SESSION_HISTORY) {
    history = history.slice(-MAX_SESSION_HISTORY);
  }

  // Use atomic writeJson for history file
  writeJson(historyPath, history);

  // Remove active session
  const sessionPath = getSessionPath();
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }

  // Trigger loop retry learning analysis for completed sessions
  const config = getConfig();
  if (config.skillLearning?.learnFromLoopRetries !== false && status === 'completed') {
    try {
      const { analyzeCompletedSession } = require('./flow-loop-retry-learning');
      analyzeCompletedSession(session);
    } catch (err) {
      // Silent fail - learning is non-critical
      if (process.env.DEBUG) {
        console.warn('[DEBUG] Loop retry learning failed:', err.message);
      }
    }
  }

  return session;
}

// ============================================================================
// Step Management
// ============================================================================

/**
 * Get the next pending step
 * @param {Object} session - Current session
 * @returns {Object|null} Next pending step or null
 */
function getNextPendingStep(session) {
  if (!session) session = loadDurableSession();
  if (!session) return null;

  return session.steps.find(s =>
    s.status === STEP_STATUS.PENDING ||
    s.status === STEP_STATUS.FAILED
  );
}

/**
 * Get step by ID
 * @param {string} stepId - Step ID
 * @returns {Object|null} Step or null
 */
function getStep(stepId) {
  const session = loadDurableSession();
  if (!session) return null;

  return session.steps.find(s => s.id === stepId);
}

/**
 * Mark a step as started (in_progress)
 * @param {string} stepId - Step ID
 * @returns {Object|null} Updated session
 */
function markStepStarted(stepId) {
  const session = loadDurableSession();
  if (!session) return null;

  const step = session.steps.find(s => s.id === stepId);
  if (!step) return null;

  step.status = STEP_STATUS.IN_PROGRESS;
  step.startedAt = new Date().toISOString();
  step.attempts++;
  step.lastAttemptAt = new Date().toISOString();

  // Update current step index
  const stepIndex = session.steps.findIndex(s => s.id === stepId);
  session.execution.currentStepIndex = stepIndex;

  saveDurableSession(session);
  return session;
}

/**
 * Mark a step as completed
 * @param {string} stepId - Step ID
 * @param {string|Object} verificationProof - Proof of completion
 * @returns {Object|null} Updated session
 */
function markStepCompleted(stepId, verificationProof = null) {
  const session = loadDurableSession();
  if (!session) return null;

  const step = session.steps.find(s => s.id === stepId);
  if (!step) return null;

  step.status = STEP_STATUS.COMPLETED;
  step.completedAt = new Date().toISOString();
  step.verificationProof = verificationProof;
  step.error = null;

  session.metrics.stepsCompleted++;

  saveDurableSession(session);
  return session;
}

/**
 * Mark a step as failed
 * @param {string} stepId - Step ID
 * @param {string|Object} error - Error details
 * @returns {Object|null} Updated session
 */
function markStepFailed(stepId, error = null) {
  const session = loadDurableSession();
  if (!session) return null;

  const step = session.steps.find(s => s.id === stepId);
  if (!step) return null;

  step.status = STEP_STATUS.FAILED;
  step.error = error;

  session.metrics.stepsFailed++;
  session.execution.totalRetries++;

  saveDurableSession(session);
  return session;
}

/**
 * Mark a step as skipped
 * @param {string} stepId - Step ID
 * @param {string} reason - Reason for skipping
 * @returns {Object|null} Updated session
 */
function markStepSkipped(stepId, reason = null) {
  const session = loadDurableSession();
  if (!session) return null;

  const step = session.steps.find(s => s.id === stepId);
  if (!step) return null;

  step.status = STEP_STATUS.SKIPPED;
  step.completedAt = new Date().toISOString();
  step.verificationProof = reason ? `Skipped: ${reason}` : 'Skipped by user';

  session.metrics.stepsSkipped++;

  saveDurableSession(session);
  return session;
}

/**
 * Add new steps to an existing session
 * @param {Array} newSteps - Steps to add
 * @returns {Object|null} Updated session
 */
function addSteps(newSteps) {
  const session = loadDurableSession();
  if (!session) return null;

  const startIndex = session.steps.length;
  // Cache config once to avoid repeated access in loop
  const config = getConfig();
  const defaultMaxAttempts = config.durableSteps?.defaultMaxAttempts || 5;
  const normalizedSteps = newSteps.map((s, i) => normalizeStep(s, startIndex + i, defaultMaxAttempts));

  session.steps.push(...normalizedSteps);

  saveDurableSession(session);
  return session;
}

// ============================================================================
// Resume Support
// ============================================================================

/**
 * Check if session can be resumed from a specific step
 * @param {Object} session - Session to check
 * @returns {Object} Resume info: { canResume, fromStep, completedCount }
 */
function canResumeFromStep(session) {
  if (!session) session = loadDurableSession();
  if (!session) {
    return { canResume: false, reason: 'no-session' };
  }

  // Check if suspended
  if (session.suspension) {
    const resumeCheck = checkResumeCondition(session.suspension);
    if (!resumeCheck.canResume) {
      return {
        canResume: false,
        reason: 'suspended',
        suspension: session.suspension,
        conditionStatus: resumeCheck
      };
    }
  }

  const completed = session.steps.filter(s => s.status === STEP_STATUS.COMPLETED);
  const pending = session.steps.filter(s =>
    s.status === STEP_STATUS.PENDING ||
    s.status === STEP_STATUS.FAILED ||
    s.status === STEP_STATUS.IN_PROGRESS
  );

  if (pending.length === 0) {
    return { canResume: false, reason: 'all-complete', completedCount: completed.length };
  }

  const nextStep = pending[0];

  return {
    canResume: true,
    fromStep: nextStep,
    completedCount: completed.length,
    totalSteps: session.steps.length,
    pendingCount: pending.length
  };
}

/**
 * Get context for resuming a session
 * @param {Object} session - Session to get context for
 * @returns {Object} Resume context
 */
function getResumeContext(session) {
  if (!session) session = loadDurableSession();
  if (!session) return null;

  const resumeInfo = canResumeFromStep(session);

  return {
    taskId: session.taskId,
    taskType: session.taskType,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    ...resumeInfo,
    iteration: session.execution.iteration,
    retries: session.execution.totalRetries,
    metrics: session.metrics,
    suspension: session.suspension
  };
}

/**
 * Skip all completed steps and return remaining work
 * @param {Object} session - Session to process
 * @returns {Array} Remaining steps to execute
 */
function getRemainingSteps(session) {
  if (!session) session = loadDurableSession();
  if (!session) return [];

  return session.steps.filter(s =>
    s.status === STEP_STATUS.PENDING ||
    s.status === STEP_STATUS.FAILED ||
    s.status === STEP_STATUS.IN_PROGRESS
  );
}

// ============================================================================
// Execution Tracking
// ============================================================================

/**
 * Increment iteration counter
 * @returns {Object|null} Updated session
 */
function incrementIteration() {
  const session = loadDurableSession();
  if (!session) return null;

  session.execution.iteration++;

  saveDurableSession(session);
  return session;
}

/**
 * Update tokens saved (for hybrid mode tracking)
 * @param {number} tokens - Tokens saved
 * @returns {Object|null} Updated session
 */
function addTokensSaved(tokens) {
  const session = loadDurableSession();
  if (!session) return null;

  session.metrics.tokensSaved += tokens;

  saveDurableSession(session);
  return session;
}

/**
 * Check if all steps are complete
 * @returns {Object} Completion status
 */
function checkCompletion() {
  const session = loadDurableSession();
  if (!session) {
    return { complete: true, reason: 'no-session' };
  }

  const config = getConfig();

  const pending = session.steps.filter(s => s.status === STEP_STATUS.PENDING);
  const failed = session.steps.filter(s => s.status === STEP_STATUS.FAILED);
  const completed = session.steps.filter(s => s.status === STEP_STATUS.COMPLETED);
  const skipped = session.steps.filter(s => s.status === STEP_STATUS.SKIPPED);
  const inProgress = session.steps.filter(s => s.status === STEP_STATUS.IN_PROGRESS);
  const suspended = session.steps.filter(s => s.status === STEP_STATUS.SUSPENDED);

  // Session is suspended - not complete, waiting for resume
  if (suspended.length > 0) {
    return {
      complete: false,
      suspended: true,
      suspendedSteps: suspended.length,
      reason: 'session-suspended',
      summary: `Session suspended with ${suspended.length} step(s) waiting to resume`
    };
  }

  // All done?
  if (pending.length === 0 && failed.length === 0 && inProgress.length === 0) {
    return {
      complete: true,
      reason: 'all-complete',
      summary: `All ${completed.length} steps completed${skipped.length > 0 ? ` (${skipped.length} skipped)` : ''}`
    };
  }

  // Max retries?
  const maxRetries = config.durableSteps?.maxRetries || config.loops?.maxRetries || 5;
  if (session.execution.totalRetries >= maxRetries) {
    return {
      complete: true,
      reason: 'max-retries',
      forced: true,
      summary: `Max retries (${maxRetries}) reached. ${failed.length} steps still failing.`
    };
  }

  // Max iterations?
  const maxIterations = config.durableSteps?.maxIterations || config.loops?.maxIterations || 20;
  if (session.execution.iteration >= maxIterations) {
    return {
      complete: true,
      reason: 'max-iterations',
      forced: true,
      summary: `Max iterations (${maxIterations}) reached.`
    };
  }

  // SECURITY: Max duration check to prevent indefinitely running sessions
  const maxDurationMs = (config.durableSteps?.maxDurationMinutes || 120) * 60 * 1000; // Default 2 hours
  const sessionDuration = Date.now() - new Date(session.startedAt).getTime();
  if (sessionDuration >= maxDurationMs) {
    return {
      complete: true,
      reason: 'max-duration',
      forced: true,
      summary: `Max session duration (${config.durableSteps?.maxDurationMinutes || 120} minutes) reached.`
    };
  }

  return {
    complete: false,
    pending: pending.length,
    failed: failed.length,
    inProgress: inProgress.length,
    completed: completed.length,
    skipped: skipped.length,
    suspended: suspended.length
  };
}

// ============================================================================
// Suspension Support
// ============================================================================

/**
 * Suspend the current session
 * @param {Object} suspensionConfig - Suspension configuration
 * @returns {Object|null} Updated session
 */
function suspendSession(suspensionConfig) {
  const session = loadDurableSession();
  if (!session) return null;

  // Find current step
  const currentStep = session.steps.find(s => s.status === STEP_STATUS.IN_PROGRESS);

  session.suspension = {
    type: suspensionConfig.type,
    reason: suspensionConfig.reason || `Suspended: ${suspensionConfig.type}`,
    suspendedAt: new Date().toISOString(),
    suspendedAtStep: currentStep?.id || null,
    resumeCondition: suspensionConfig.resumeCondition,
    notifications: suspensionConfig.notifications || {
      onSuspend: true,
      onResume: true,
      reminderAfterHours: 24
    }
  };

  // Mark current step as suspended
  if (currentStep) {
    currentStep.status = STEP_STATUS.SUSPENDED;
  }

  saveDurableSession(session);
  return session;
}

/**
 * Check if session is suspended
 * @returns {boolean}
 */
function isSuspended() {
  const session = loadDurableSession();
  return session?.suspension !== null;
}

/**
 * Get suspension status
 * @returns {Object|null} Suspension details or null
 */
function getSuspensionStatus() {
  const session = loadDurableSession();
  if (!session || !session.suspension) return null;

  const resumeCheck = checkResumeCondition(session.suspension);

  return {
    ...session.suspension,
    canResume: resumeCheck.canResume,
    resumeReason: resumeCheck.reason,
    taskId: session.taskId
  };
}

/**
 * Check if resume condition is met
 * @param {Object} suspension - Suspension object
 * @returns {Object} { canResume: boolean, reason: string }
 */
function checkResumeCondition(suspension) {
  if (!suspension || !suspension.resumeCondition) {
    return { canResume: true, reason: 'no-condition' };
  }

  const condition = suspension.resumeCondition;

  switch (condition.type) {
    case RESUME_CONDITION.TIME:
      return checkTimeCondition(condition.time);

    case RESUME_CONDITION.POLL:
      return checkPollCondition(condition.poll);

    case RESUME_CONDITION.MANUAL:
      return checkManualCondition(condition.manual);

    case RESUME_CONDITION.FILE:
      return checkFileCondition(condition.file);

    default:
      return { canResume: false, reason: `Unknown condition type: ${condition.type}` };
  }
}

/**
 * Check time-based resume condition
 */
function checkTimeCondition(config) {
  if (!config || !config.resumeAfter) {
    return { canResume: true, reason: 'no-time-set' };
  }

  const resumeTime = new Date(config.resumeAfter);
  const now = new Date();

  if (now >= resumeTime) {
    return { canResume: true, reason: 'time-elapsed' };
  }

  const remaining = Math.ceil((resumeTime - now) / 1000);
  return {
    canResume: false,
    reason: 'waiting-for-time',
    remainingSeconds: remaining,
    resumeAt: config.resumeAfter
  };
}

/**
 * Check poll-based resume condition (e.g., CI/CD)
 *
 * SECURITY: Commands are validated before execution to prevent injection.
 * Only safe commands (no dangerous patterns) are allowed.
 */
function checkPollCondition(config) {
  if (!config || !config.command) {
    return { canResume: false, reason: 'no-poll-command' };
  }

  // SECURITY: Validate command before execution
  const validation = validateCommand(config.command);
  if (validation.blocked) {
    return {
      canResume: false,
      reason: 'poll-command-blocked',
      error: `SECURITY: ${validation.reason}`
    };
  }

  if (!validation.safe) {
    return {
      canResume: false,
      reason: 'poll-command-unsafe',
      error: `SECURITY: Command validation failed - ${validation.reason}`
    };
  }

  try {
    const result = execSync(config.command, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (result === config.expectedValue) {
      return { canResume: true, reason: 'poll-condition-met', value: result };
    }

    return {
      canResume: false,
      reason: 'poll-condition-not-met',
      currentValue: result,
      expectedValue: config.expectedValue
    };
  } catch (err) {
    return {
      canResume: false,
      reason: 'poll-command-failed',
      error: err.message
    };
  }
}

/**
 * Check manual approval condition
 */
function checkManualCondition(config) {
  if (!config) {
    return { canResume: false, reason: 'no-manual-config' };
  }

  if (config.approvedAt && config.approvedBy) {
    return { canResume: true, reason: 'manually-approved' };
  }

  return {
    canResume: false,
    reason: 'awaiting-approval',
    prompt: config.prompt
  };
}

/**
 * Check file-based resume condition
 */
function checkFileCondition(config) {
  if (!config || !config.watchPath) {
    return { canResume: false, reason: 'no-file-path' };
  }

  const projectRoot = getProjectRoot();
  const filePath = path.isAbsolute(config.watchPath)
    ? config.watchPath
    : path.join(projectRoot, config.watchPath);

  // Security: Validate path is within project root to prevent path traversal
  if (!validatePathWithinProject(filePath, projectRoot)) {
    return {
      canResume: false,
      reason: 'path-traversal-blocked',
      error: 'Watch path must be within project directory'
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      canResume: false,
      reason: 'file-not-found',
      watchPath: config.watchPath
    };
  }

  // If expected content specified, check it
  if (config.expectedContent) {
    try {
      // Use safeJsonParse to prevent prototype pollution
      const content = safeJsonParse(filePath, null);
      if (!content) {
        return {
          canResume: false,
          reason: 'file-parse-error',
          error: 'Could not parse file content'
        };
      }
      const matches = deepEqual(content, config.expectedContent);

      if (matches) {
        return { canResume: true, reason: 'file-content-matches' };
      }

      return {
        canResume: false,
        reason: 'file-content-mismatch',
        expected: config.expectedContent,
        actual: content
      };
    } catch (err) {
      return {
        canResume: false,
        reason: 'file-parse-error',
        error: err.message
      };
    }
  }

  // Just check existence
  return { canResume: true, reason: 'file-exists' };
}

/**
 * Resume a suspended session
 * @param {Object} options - Resume options
 * @returns {Object|null} Updated session
 */
function resumeSession(options = {}) {
  const session = loadDurableSession();
  if (!session || !session.suspension) return null;

  // Update manual approval if provided
  if (options.approve && session.suspension.resumeCondition?.type === RESUME_CONDITION.MANUAL) {
    session.suspension.resumeCondition.manual.approvedAt = new Date().toISOString();
    session.suspension.resumeCondition.manual.approvedBy = options.approvedBy || 'user';
  }

  // Check if can resume
  const resumeCheck = checkResumeCondition(session.suspension);
  if (!resumeCheck.canResume && !options.force) {
    return {
      error: 'Cannot resume yet',
      ...resumeCheck
    };
  }

  // Clear suspension
  const suspendedStepId = session.suspension.suspendedAtStep;
  session.suspension = null;

  // Resume suspended step
  if (suspendedStepId) {
    const step = session.steps.find(s => s.id === suspendedStepId);
    if (step && step.status === STEP_STATUS.SUSPENDED) {
      step.status = STEP_STATUS.PENDING;
    }
  }

  saveDurableSession(session);
  return session;
}

// ============================================================================
// Backward Compatibility - Loop Enforcer API
// ============================================================================

/**
 * Start a loop (backward compat with flow-task-enforcer)
 * @deprecated Use createDurableSession instead
 */
function startLoop(taskId, acceptanceCriteria) {
  return createDurableSession(taskId, 'task', acceptanceCriteria);
}

/**
 * Get active loop (backward compat)
 * @deprecated Use loadDurableSession instead
 */
function getActiveLoop() {
  const session = loadDurableSession();
  if (!session) return null;

  // Convert to old format for compatibility
  // Map step-NNN back to AC-N format for backward compatibility
  return {
    taskId: session.taskId,
    startedAt: session.startedAt,
    acceptanceCriteria: session.steps.map((s, index) => ({
      // Convert step-NNN to AC-N format for backward compat
      id: s.id.startsWith('step-') ? `AC-${index + 1}` : s.id,
      description: s.description,
      status: s.status === STEP_STATUS.COMPLETED ? 'completed' :
              s.status === STEP_STATUS.FAILED ? 'failed' :
              s.status === STEP_STATUS.SKIPPED ? 'skipped' : 'pending',
      attempts: s.attempts,
      lastAttempt: s.lastAttemptAt,
      verificationResult: s.verificationProof
    })),
    iteration: session.execution.iteration,
    retries: session.execution.totalRetries,
    status: session.suspension ? 'suspended' : 'in_progress'
  };
}

/**
 * Update criterion (backward compat)
 * @deprecated Use markStepCompleted/markStepFailed instead
 */
function updateCriterion(criterionId, status, verificationResult = null) {
  // Convert AC-N format to step-NNN format for backward compatibility
  const stepId = criterionId.startsWith('AC-')
    ? `step-${criterionId.replace('AC-', '').padStart(3, '0')}`
    : criterionId;

  if (status === 'completed') {
    return markStepCompleted(stepId, verificationResult);
  } else if (status === 'failed') {
    return markStepFailed(stepId, verificationResult);
  } else if (status === 'skipped') {
    return markStepSkipped(stepId, verificationResult);
  }
  return null;
}

/**
 * Can exit loop (backward compat)
 * @deprecated Use checkCompletion instead
 */
function canExitLoop() {
  const completion = checkCompletion();

  return {
    canExit: completion.complete,
    reason: completion.reason,
    summary: completion.summary,
    pending: completion.pending,
    failed: completion.failed,
    completed: completion.completed,
    skipped: completion.skipped
  };
}

/**
 * End loop (backward compat)
 * @deprecated Use archiveDurableSession instead
 */
function endLoop(status = 'completed') {
  return archiveDurableSession(status);
}

// ============================================================================
// Backward Compatibility - Hybrid Session API
// ============================================================================

/**
 * Get hybrid session format (backward compat)
 * @deprecated Use loadDurableSession instead
 */
function getHybridSession() {
  const session = loadDurableSession();
  if (!session) return null;

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    autoExecute: false,
    currentPlan: null,
    executedSteps: session.steps
      .filter(s => s.status === STEP_STATUS.COMPLETED)
      .map(s => s.id),
    failedSteps: session.steps
      .filter(s => s.status === STEP_STATUS.FAILED)
      .map(s => s.id),
    pendingSteps: session.steps
      .filter(s => s.status === STEP_STATUS.PENDING || s.status === STEP_STATUS.IN_PROGRESS)
      .map(s => s.id),
    totalTokensSaved: session.metrics.tokensSaved
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Deep equality check for objects
 */
function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
  if (obj1 === null || obj2 === null) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }

  return true;
}

/**
 * Get session statistics from history
 */
function getSessionStats() {
  const historyPath = getHistoryPath();

  if (!fs.existsSync(historyPath)) {
    return { totalSessions: 0, completed: 0, failed: 0, cancelled: 0, avgSteps: 0, avgTokensSaved: 0 };
  }

  try {
    // Use safeJsonParse to prevent prototype pollution
    const parsed = safeJsonParse(historyPath, []);
    const history = Array.isArray(parsed) ? parsed : [];
    const completed = history.filter(h => h.status === 'completed').length;
    const failed = history.filter(h => h.status === 'failed').length;
    const avgSteps = history.length > 0
      ? history.reduce((sum, h) => sum + (h.steps?.length || 0), 0) / history.length
      : 0;

    return {
      totalSessions: history.length,
      completed,
      failed,
      cancelled: history.length - completed - failed,
      avgSteps: Math.round(avgSteps * 10) / 10,
      avgTokensSaved: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.metrics?.tokensSaved || 0), 0) / history.length)
        : 0
    };
  } catch {
    return { totalSessions: 0, completed: 0, failed: 0, cancelled: 0, avgSteps: 0, avgTokensSaved: 0 };
  }
}

// ============================================================================
// Task Queue Management (v2.1)
// ============================================================================

/**
 * Initialize a task queue for multi-task execution
 * @param {string[]} taskIds - Array of task IDs to queue
 * @param {string} source - Source of queue: "bulk", "natural", "manual"
 * @returns {Object} Updated session
 */
function initTaskQueue(taskIds, source = 'manual') {
  let session = loadDurableSession();

  // v4.1: Create a bulk session if none exists
  // This fixes the chicken-and-egg problem where /wogi-bulk needs to
  // initialize the queue BEFORE starting the first task
  if (!session) {
    if (!taskIds || taskIds.length === 0) {
      throw new Error('Cannot initialize empty queue without active session');
    }
    // Create a minimal bulk session for the first task
    session = createSessionObject(taskIds[0], 'bulk', [], {});
    if (process.env.DEBUG) {
      console.log(`[Queue] Created bulk session for first task: ${taskIds[0]}`);
    }
  }

  session.taskQueue = {
    enabled: true,
    tasks: taskIds,
    currentIndex: 0,
    source,
    queuedAt: new Date().toISOString(),
    completedTasks: []
  };

  // Ensure first task matches current session (if session existed)
  if (taskIds[0] && session.taskId !== taskIds[0]) {
    // Update session to match first task in queue
    session.taskId = taskIds[0];
    if (process.env.DEBUG) {
      console.log(`[Queue] Updated session taskId to match first queued task: ${taskIds[0]}`);
    }
  }

  session.updatedAt = new Date().toISOString();
  saveDurableSession(session);
  return session;
}

/**
 * Get current queue status
 * @returns {Object} Queue status: { hasQueue, hasMoreTasks, currentTask, nextTask, remaining, completed }
 */
function getQueueStatus() {
  const session = loadDurableSession();
  if (!session || !session.taskQueue?.enabled) {
    return {
      hasQueue: false,
      hasMoreTasks: false,
      currentTask: session?.taskId || null,
      nextTask: null,
      remaining: 0,
      completed: 0,
      total: 0
    };
  }

  const queue = session.taskQueue;
  const remaining = queue.tasks.length - queue.currentIndex - 1;
  const nextTask = remaining > 0 ? queue.tasks[queue.currentIndex + 1] : null;

  return {
    hasQueue: true,
    hasMoreTasks: remaining > 0,
    currentTask: queue.tasks[queue.currentIndex],
    nextTask,
    remaining,
    completed: queue.completedTasks.length,
    total: queue.tasks.length,
    source: queue.source
  };
}

/**
 * Advance to next task in queue (called when current task completes)
 * @returns {Object} { advanced, nextTaskId, queueComplete }
 */
function advanceTaskQueue() {
  const session = loadDurableSession();
  if (!session || !session.taskQueue?.enabled) {
    return { advanced: false, nextTaskId: null, queueComplete: true };
  }

  const queue = session.taskQueue;

  // Mark current task as completed
  const currentTaskId = queue.tasks[queue.currentIndex];
  if (currentTaskId && !queue.completedTasks.includes(currentTaskId)) {
    queue.completedTasks.push(currentTaskId);
  }

  // Check if more tasks
  if (queue.currentIndex >= queue.tasks.length - 1) {
    // Queue complete
    session.updatedAt = new Date().toISOString();
    saveDurableSession(session);
    return {
      advanced: false,
      nextTaskId: null,
      queueComplete: true,
      completedTasks: queue.completedTasks
    };
  }

  // Advance to next task
  queue.currentIndex++;
  const nextTaskId = queue.tasks[queue.currentIndex];

  session.updatedAt = new Date().toISOString();
  saveDurableSession(session);

  return {
    advanced: true,
    nextTaskId,
    queueComplete: false,
    remaining: queue.tasks.length - queue.currentIndex - 1
  };
}

/**
 * Clear the task queue
 * @returns {boolean} Success
 */
function clearTaskQueue() {
  const session = loadDurableSession();
  if (!session) return false;

  session.taskQueue = {
    enabled: false,
    tasks: [],
    currentIndex: 0,
    source: null,
    queuedAt: null,
    completedTasks: session.taskQueue?.completedTasks || []
  };

  session.updatedAt = new Date().toISOString();
  saveDurableSession(session);
  return true;
}

/**
 * Check if should continue to next task (used by stop hook)
 * @returns {Object} { shouldContinue, nextTaskId, message }
 */
function checkQueueContinuation() {
  const config = getConfig();
  const queueConfig = config.taskQueue || {};

  // Check if queue feature is enabled
  if (queueConfig.enabled === false) {
    return { shouldContinue: false, reason: 'queue_disabled' };
  }

  const status = getQueueStatus();

  if (!status.hasQueue) {
    return { shouldContinue: false, reason: 'no_queue' };
  }

  if (!status.hasMoreTasks) {
    return {
      shouldContinue: false,
      reason: 'queue_complete',
      message: `All ${status.total} tasks completed!`,
      completedTasks: status.completed
    };
  }

  // Check if should pause between tasks
  if (queueConfig.pauseBetweenTasks) {
    return {
      shouldContinue: false,
      shouldPrompt: true,
      nextTaskId: status.nextTask,
      message: `Task complete. Next: ${status.nextTask} (${status.remaining} remaining). Continue?`
    };
  }

  // Auto-continue (default)
  return {
    shouldContinue: true,
    nextTaskId: status.nextTask,
    remaining: status.remaining,
    message: `Task complete. Auto-continuing to: ${status.nextTask}`
  };
}

// ============================================================================
// Skill Execution Tracking (v4.1)
// ============================================================================

const PENDING_SKILL_FILE = 'pending-skill.json';

/**
 * Get path to pending skill state file
 */
function getPendingSkillPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.workflow', 'state', PENDING_SKILL_FILE);
}

/**
 * Mark a skill as pending execution
 * Called when a skill is loaded but not yet executed
 * @param {string} skillName - Name of the skill (e.g., "wogi-bulk", "wogi-start")
 * @param {Object} context - Optional context (taskIds for bulk, etc.)
 * @returns {boolean} Success
 */
function markSkillPending(skillName, context = {}) {
  if (!skillName || typeof skillName !== 'string') {
    return false;
  }

  const pendingPath = getPendingSkillPath();

  try {
    ensureDir(path.dirname(pendingPath));
    const state = {
      skillName,
      markedAt: new Date().toISOString(),
      context,
      status: 'pending'
    };
    writeJson(pendingPath, state);
    if (process.env.DEBUG) {
      console.log(`[Skill] Marked ${skillName} as pending`);
    }
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Skill] Failed to mark skill pending: ${err.message}`);
    }
    return false;
  }
}

/**
 * Mark a skill as executed (clear pending state)
 * Called when skill execution begins (e.g., when /wogi-start creates a session)
 * @returns {boolean} Success
 */
function clearPendingSkill() {
  const pendingPath = getPendingSkillPath();

  try {
    if (fs.existsSync(pendingPath)) {
      fs.unlinkSync(pendingPath);
      if (process.env.DEBUG) {
        console.log('[Skill] Cleared pending skill state');
      }
    }
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Skill] Failed to clear pending skill: ${err.message}`);
    }
    return false;
  }
}

/**
 * Check if a skill is pending execution
 * Used by stop hook to prevent premature exit
 * @returns {Object|null} Pending skill info or null
 */
function getPendingSkill() {
  const pendingPath = getPendingSkillPath();

  if (!fs.existsSync(pendingPath)) {
    return null;
  }

  try {
    const state = safeJsonParse(pendingPath, null);
    if (!state || state.status !== 'pending') {
      return null;
    }

    // Check for stale pending state (older than 5 minutes = likely abandoned)
    const markedAt = new Date(state.markedAt);
    const ageMs = Date.now() - markedAt.getTime();
    const maxAgeMs = 5 * 60 * 1000; // 5 minutes

    if (ageMs > maxAgeMs) {
      // Stale - clean up and return null
      if (process.env.DEBUG) {
        console.log(`[Skill] Cleaning up stale pending skill (age: ${Math.round(ageMs / 1000)}s)`);
      }
      clearPendingSkill();
      return null;
    }

    return state;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Skill] Failed to read pending skill: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check if execution should be blocked due to pending skill
 * @returns {Object} { hasPendingSkill, skillName, message }
 */
function checkPendingSkillExecution() {
  const pending = getPendingSkill();

  if (!pending) {
    return { hasPendingSkill: false };
  }

  return {
    hasPendingSkill: true,
    skillName: pending.skillName,
    context: pending.context,
    message: `Skill /${pending.skillName} is pending execution. Complete it before stopping.`
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Constants
  SESSION_VERSION,
  STEP_STATUS,
  STEP_TYPE,
  SUSPENSION_TYPE,
  RESUME_CONDITION,

  // Core session management
  createDurableSession,
  createDurableSessionAsync,  // Async version with file locking
  loadDurableSession,
  saveDurableSession,
  archiveDurableSession,
  getSessionFileScope,  // v4.0: Get file scope for runtime enforcement
  getSessionBoundaries, // v5.0: Get boundary declarations for runtime enforcement

  // Step management
  getNextPendingStep,
  getStep,
  markStepStarted,
  markStepCompleted,
  markStepFailed,
  markStepSkipped,
  addSteps,
  getRemainingSteps,

  // Resume support
  canResumeFromStep,
  getResumeContext,

  // Execution tracking
  incrementIteration,
  addTokensSaved,
  checkCompletion,

  // Suspension
  suspendSession,
  isSuspended,
  getSuspensionStatus,
  checkResumeCondition,
  resumeSession,

  // Backward compatibility - Loop Enforcer
  startLoop,
  getActiveLoop,
  updateCriterion,
  canExitLoop,
  endLoop,

  // Backward compatibility - Hybrid Session
  getHybridSession,

  // Utilities
  getSessionStats,
  normalizeStep,

  // Task Queue (v2.1)
  initTaskQueue,
  getQueueStatus,
  advanceTaskQueue,
  clearTaskQueue,
  checkQueueContinuation,

  // Skill Execution Tracking (v4.1)
  markSkillPending,
  clearPendingSkill,
  getPendingSkill,
  checkPendingSkillExecution
};

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status': {
      const session = loadDurableSession();
      if (!session) {
        console.log('No active durable session');
        process.exit(0);
      }

      const completion = checkCompletion();
      const suspension = getSuspensionStatus();

      console.log('\n📊 Durable Session Status');
      console.log('─'.repeat(40));
      console.log(`Task: ${session.taskId}`);
      console.log(`Type: ${session.taskType}`);
      console.log(`Started: ${session.startedAt}`);
      console.log(`Iteration: ${session.execution.iteration}`);
      console.log(`Retries: ${session.execution.totalRetries}`);
      console.log('');
      console.log(`Steps: ${session.steps.length} total`);
      console.log(`  ✅ Completed: ${session.metrics.stepsCompleted}`);
      console.log(`  ❌ Failed: ${session.metrics.stepsFailed}`);
      console.log(`  ⏭️  Skipped: ${session.metrics.stepsSkipped}`);
      console.log(`  ⏳ Pending: ${completion.pending || 0}`);

      if (suspension) {
        console.log('');
        console.log('⏸️  SUSPENDED');
        console.log(`  Type: ${suspension.type}`);
        console.log(`  Reason: ${suspension.reason}`);
        console.log(`  Can Resume: ${suspension.canResume ? 'Yes' : 'No'}`);
        if (!suspension.canResume) {
          console.log(`  Resume Reason: ${suspension.resumeReason}`);
        }
      }

      console.log('─'.repeat(40));
      break;
    }

    case 'stats': {
      const stats = getSessionStats();
      console.log('\n📈 Session Statistics');
      console.log('─'.repeat(40));
      console.log(`Total Sessions: ${stats.totalSessions}`);
      console.log(`Completed: ${stats.completed}`);
      console.log(`Failed: ${stats.failed}`);
      console.log(`Cancelled: ${stats.cancelled}`);
      console.log(`Avg Steps: ${stats.avgSteps}`);
      console.log(`Avg Tokens Saved: ${stats.avgTokensSaved}`);
      console.log('─'.repeat(40));
      break;
    }

    case 'clear': {
      const sessionPath = getSessionPath();
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
        console.log('✅ Active session cleared');
      } else {
        console.log('No active session to clear');
      }
      break;
    }

    default:
      console.log('Usage: node flow-durable-session.js <command>');
      console.log('');
      console.log('Commands:');
      console.log('  status  - Show current session status');
      console.log('  stats   - Show session statistics');
      console.log('  clear   - Clear active session');
  }
}
