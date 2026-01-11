#!/usr/bin/env node

/**
 * Wogi Flow - Loop Enforcer
 *
 * Ensures self-completing loops actually complete. When enforced:true,
 * the loop cannot be exited until all acceptance criteria pass.
 *
 * v2.0: Now delegates to flow-durable-session.js for unified step tracking.
 * Legacy loop-session.json is still supported for backward compatibility.
 */

const fs = require('fs');
const path = require('path');
const { getConfig, getProjectRoot, writeJson } = require('./flow-utils');

// v2.0: Import durable session for unified tracking
const durableSession = require('./flow-durable-session');

/**
 * Sanitize a string for safe use in shell commands
 * Only allows alphanumeric, underscore, hyphen, and dot characters
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeShellArg(str) {
  if (!str || typeof str !== 'string') return '';
  // Only allow safe characters: alphanumeric, underscore, hyphen, dot
  return str.replace(/[^a-zA-Z0-9_.-]/g, '');
}

/**
 * Escape a path for safe use in shell commands
 * @param {string} p - Path to escape
 * @returns {string} - Escaped path
 */
function escapeShellPath(p) {
  if (!p || typeof p !== 'string') return '';
  // Escape special shell characters in paths
  return p.replace(/(["\s'$`\\!*?#~<>^()[\]{}|;&])/g, '\\$1');
}

/**
 * Check if loop enforcement is enabled
 */
function isEnforcementEnabled() {
  const config = getConfig();
  return config.loops?.enforced === true;
}

/**
 * Check if exit blocking is enabled
 */
function isExitBlocked() {
  const config = getConfig();
  return config.loops?.blockExitUntilComplete === true;
}

/**
 * Check if verification is required before marking criteria complete
 */
function isVerificationRequired() {
  const config = getConfig();
  return config.loops?.requireVerification !== false; // Default true
}

/**
 * Check if skipping is blocked (must complete or explicitly skip with approval)
 */
function isSkipBlocked() {
  const config = getConfig();
  return config.loops?.blockOnSkip !== false; // Default true
}

/**
 * Check if Simple Mode is enabled
 */
function isSimpleModeEnabled() {
  const config = getConfig();
  return config.loops?.simpleMode?.enabled === true;
}

/**
 * Check if regression re-check is enabled
 */
function isRecheckEnabled() {
  const config = getConfig();
  return config.loops?.recheckAllAfterFix !== false; // Default true
}

/**
 * Attempt to skip a criterion (requires approval if blockOnSkip is true)
 * Returns { allowed: boolean, message: string }
 */
function canSkipCriterion(criterionId, approvalGiven = false) {
  const config = getConfig();
  const session = getActiveLoop();

  if (!session) {
    return { allowed: false, message: 'No active loop session' };
  }

  const criterion = session.acceptanceCriteria.find(c => c.id === criterionId);
  if (!criterion) {
    return { allowed: false, message: `Criterion ${criterionId} not found` };
  }

  // If blockOnSkip is false, always allow
  if (!isSkipBlocked()) {
    return { allowed: true, message: 'Skip allowed (blockOnSkip: false)' };
  }

  // If blockOnSkip is true, require explicit approval
  if (!approvalGiven) {
    return {
      allowed: false,
      message: `⚠️ Cannot skip "${criterion.description}" without approval.\n` +
               `Options:\n` +
               `  1. Complete the criterion\n` +
               `  2. Get explicit approval to skip\n` +
               `  3. Abort the task`,
      requiresApproval: true
    };
  }

  return { allowed: true, message: 'Skip approved by user' };
}

/**
 * Get active loop session
 * v2.0: Delegates to durable session with backward-compatible format
 */
function getActiveLoop() {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    return durableSession.getActiveLoop();
  }

  // Legacy fallback: read loop-session.json directly
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  } catch (parseError) {
    // Always log parse errors (corrupted session files are actionable issues)
    console.warn(`[Warning] Could not parse loop session file: ${parseError.message}`);
    if (process.env.DEBUG) {
      console.warn(`[DEBUG] Session path: ${sessionPath}`);
    }
    return null;
  }
}

/**
 * Start a new enforcement loop session
 * v2.0: Delegates to durable session for unified tracking
 */
function startLoop(taskId, acceptanceCriteria) {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    const session = durableSession.createDurableSession(taskId, 'task', acceptanceCriteria);
    // Return backward-compatible format
    return durableSession.getActiveLoop();
  }

  // Legacy fallback: write to loop-session.json directly
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  const session = {
    taskId,
    startedAt: new Date().toISOString(),
    acceptanceCriteria: acceptanceCriteria.map((c, i) => ({
      id: `AC-${i + 1}`,
      description: c,
      status: 'pending',
      attempts: 0,
      lastAttempt: null,
      verificationResult: null
    })),
    iteration: 0,
    retries: 0,
    status: 'in_progress'
  };

  writeJson(sessionPath, session);
  return session;
}

// ============================================================
// Simple Mode - Lightweight loop without formal criteria
// ============================================================

/**
 * Start a Simple Mode loop
 * Uses completion promise detection instead of formal acceptance criteria
 *
 * @param {string} taskId - Task identifier
 * @param {string} completionPromise - String to detect in output for completion
 */
function startSimpleLoop(taskId, completionPromise = null) {
  const config = getConfig();
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'simple-loop-session.json');

  // Use configured completion promise or default
  const promise = completionPromise || config.loops?.simpleMode?.completionPromise || 'TASK_COMPLETE';
  const maxIterations = config.loops?.simpleMode?.maxIterations || 10;

  const session = {
    taskId,
    mode: 'simple',
    startedAt: new Date().toISOString(),
    completionPromise: promise,
    maxIterations,
    iteration: 0,
    status: 'in_progress',
    outputs: [] // Store recent outputs to check for completion
  };

  writeJson(sessionPath, session);
  return session;
}

/**
 * Get active Simple Mode loop
 */
function getSimpleLoop() {
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'simple-loop-session.json');

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Record output in Simple Mode loop and check for completion
 *
 * @param {string} output - Output to check for completion promise
 * @returns {object} - { completed: boolean, message: string }
 */
function recordSimpleOutput(output) {
  const session = getSimpleLoop();
  if (!session) {
    return { completed: false, message: 'No active simple loop' };
  }

  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'simple-loop-session.json');

  // Store output (keep last 5)
  session.outputs = session.outputs || [];
  session.outputs.push({
    timestamp: new Date().toISOString(),
    content: output.substring(0, 500) // Truncate long outputs
  });
  if (session.outputs.length > 5) {
    session.outputs = session.outputs.slice(-5);
  }

  // Check for completion promise
  const completed = output.includes(session.completionPromise);

  if (completed) {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    writeJson(sessionPath, session);
    return {
      completed: true,
      message: `Completion promise detected: "${session.completionPromise}"`
    };
  }

  // Check max iterations
  session.iteration++;
  if (session.iteration >= session.maxIterations) {
    session.status = 'max_iterations';
    session.completedAt = new Date().toISOString();
    writeJson(sessionPath, session);
    return {
      completed: true,
      message: `Max iterations (${session.maxIterations}) reached`,
      reason: 'max_iterations'
    };
  }

  writeJson(sessionPath, session);
  return {
    completed: false,
    message: `Iteration ${session.iteration}/${session.maxIterations}`,
    iteration: session.iteration
  };
}

/**
 * End Simple Mode loop
 */
function endSimpleLoop(status = 'completed') {
  const session = getSimpleLoop();
  if (!session) return null;

  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'simple-loop-session.json');

  session.status = status;
  session.endedAt = new Date().toISOString();

  // Archive to history
  const historyPath = path.join(projectRoot, '.workflow', 'state', 'simple-loop-history.json');
  let history = [];
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch { history = []; }
  }
  history.push(session);
  if (history.length > 50) {
    history = history.slice(-50);
  }
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  // Remove active session
  fs.unlinkSync(sessionPath);
  return session;
}

/**
 * Check if Simple Mode loop can exit
 */
function canExitSimpleLoop() {
  const session = getSimpleLoop();
  if (!session) {
    return { canExit: true, reason: 'no-active-simple-loop' };
  }

  if (session.status === 'completed' || session.status === 'max_iterations') {
    return {
      canExit: true,
      reason: session.status,
      message: `Simple loop ${session.status}`
    };
  }

  return {
    canExit: false,
    reason: 'in_progress',
    message: `Simple loop iteration ${session.iteration}/${session.maxIterations}. Output "${session.completionPromise}" to complete.`
  };
}

// ============================================================
// Criterion Updates with Regression Re-check
// ============================================================

/**
 * Update criterion status in loop session
 * v2.0: Delegates to durable session
 * v2.2: Adds regression re-check after fixing any criterion
 */
function updateCriterion(criterionId, status, verificationResult = null, context = {}) {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    // Map old AC-N format to new step-NNN format if needed
    const stepId = criterionId.startsWith('AC-')
      ? `step-${criterionId.replace('AC-', '').padStart(3, '0')}`
      : criterionId;

    durableSession.updateCriterion(stepId, status, verificationResult);

    // v2.2: Regression re-check after completion
    if (status === 'completed' && isRecheckEnabled()) {
      performRegressionRecheck(criterionId, context);
    }

    return durableSession.getActiveLoop();
  }

  // Legacy fallback: update loop-session.json directly
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  const session = getActiveLoop();
  if (!session) return null;

  const criterion = session.acceptanceCriteria.find(c => c.id === criterionId);
  if (criterion) {
    criterion.status = status;
    criterion.attempts++;
    criterion.lastAttempt = new Date().toISOString();
    criterion.verificationResult = verificationResult;
  }

  // v2.2: Regression re-check after completing a criterion
  if (status === 'completed' && isRecheckEnabled()) {
    const regressions = performRegressionRecheck(criterionId, context);
    if (regressions.length > 0) {
      session.lastRegressionCheck = {
        timestamp: new Date().toISOString(),
        triggeredBy: criterionId,
        regressions: regressions
      };
    }
  }

  writeJson(sessionPath, session);
  return session;
}

/**
 * Perform regression re-check on all previously completed criteria
 * CRITICAL: After fixing ANY criterion, re-verify ALL criteria
 *
 * @param {string} excludeCriterionId - Criterion that was just completed (exclude from recheck)
 * @param {object} context - Verification context (changedFiles, testResults, etc.)
 * @returns {array} - Array of regressions found
 */
function performRegressionRecheck(excludeCriterionId, context = {}) {
  const config = getConfig();
  const session = getActiveLoop();

  if (!session) return [];

  const regressions = [];
  const completedCriteria = session.acceptanceCriteria
    .filter(c => c.status === 'completed' && c.id !== excludeCriterionId);

  if (completedCriteria.length === 0) return [];

  console.log('\n\u{1F504} Re-verifying all completed criteria for regression...');

  for (const criterion of completedCriteria) {
    const result = verifyCriterion(criterion, context);

    // If verification returned passed: false, we have a regression
    if (result.passed === false) {
      regressions.push({
        criterionId: criterion.id,
        description: criterion.description,
        message: result.message,
        verification: result.verification
      });

      // Handle based on config
      const onRegression = config.loops?.regressionOnRecheck || 'warn';

      if (onRegression === 'block') {
        // Mark criterion as failed - must be fixed
        criterion.status = 'failed';
        criterion.verificationResult = `REGRESSION: ${result.message}`;
        console.log(`\u{26A0}\u{FE0F} REGRESSION DETECTED in ${criterion.id}: ${criterion.description}`);
        console.log(`   ${result.message}`);
      } else if (onRegression === 'warn') {
        // Warn but don't change status
        console.log(`\u{26A0}\u{FE0F} Warning: Possible regression in ${criterion.id}: ${criterion.description}`);
        console.log(`   ${result.message}`);
      }
      // 'auto-fix' mode would attempt to fix, but that's handled at a higher level
    } else if (result.passed === true) {
      console.log(`\u{2714}\u{FE0F} ${criterion.id} still passes`);
    }
    // null = couldn't verify, skip
  }

  if (regressions.length > 0) {
    console.log(`\n\u{1F6A8} ${regressions.length} regression(s) detected!`);
  } else if (completedCriteria.length > 0) {
    console.log('\u{2705} All previously completed criteria still pass\n');
  }

  return regressions;
}

/**
 * Check if loop can exit (all criteria met or max retries reached)
 * v2.0: Uses durable session completion check
 */
function canExitLoop() {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    const result = durableSession.canExitLoop();

    // Add enforcement check
    if (!isEnforcementEnabled() && !result.canExit) {
      return { canExit: true, reason: 'enforcement-disabled' };
    }

    // Generate enforcement message if needed
    if (!result.canExit) {
      const session = getActiveLoop();
      if (session) {
        const pending = session.acceptanceCriteria.filter(c => c.status === 'pending');
        const failed = session.acceptanceCriteria.filter(c => c.status === 'failed');
        const skipped = session.acceptanceCriteria.filter(c => c.status === 'skipped');
        result.message = generateEnforcementMessage(session, pending, failed, skipped);
      }
    }

    return result;
  }

  // Legacy fallback
  const session = getActiveLoop();

  if (!session) return { canExit: true, reason: 'no-active-loop' };

  // Not enforced? Can always exit
  if (!isEnforcementEnabled()) {
    return { canExit: true, reason: 'enforcement-disabled' };
  }

  const pending = session.acceptanceCriteria.filter(c => c.status === 'pending');
  const failed = session.acceptanceCriteria.filter(c => c.status === 'failed');
  const completed = session.acceptanceCriteria.filter(c => c.status === 'completed');
  const skipped = session.acceptanceCriteria.filter(c => c.status === 'skipped');

  // All criteria completed or skipped (with approval)?
  if (pending.length === 0 && failed.length === 0) {
    const skipNote = skipped.length > 0 ? ` (${skipped.length} skipped with approval)` : '';
    return {
      canExit: true,
      reason: 'all-complete',
      summary: `All ${completed.length} acceptance criteria passed${skipNote}`,
      skippedCriteria: skipped.map(s => s.description)
    };
  }

  // Max retries exceeded?
  const maxRetries = config.loops?.maxRetries || 5;
  if (session.retries >= maxRetries) {
    return {
      canExit: true,
      reason: 'max-retries',
      summary: `Max retries (${maxRetries}) reached. ${failed.length} criteria still failing.`,
      failedCriteria: failed.map(f => f.description)
    };
  }

  // Max iterations exceeded?
  const maxIterations = config.loops?.maxIterations || 20;
  if (session.iteration >= maxIterations) {
    return {
      canExit: true,
      reason: 'max-iterations',
      summary: `Max iterations (${maxIterations}) reached.`,
      failedCriteria: failed.map(f => f.description)
    };
  }

  // Cannot exit - work to do
  return {
    canExit: false,
    reason: 'incomplete',
    pending: pending.length,
    failed: failed.length,
    completed: completed.length,
    skipped: skipped.length,
    message: generateEnforcementMessage(session, pending, failed, skipped)
  };
}

/**
 * Generate the enforcement message
 */
function generateEnforcementMessage(session, pending, failed, skipped = []) {
  const lines = [
    '🚫 LOOP ENFORCEMENT ACTIVE',
    '─'.repeat(40),
    '',
    `Task: ${session.taskId}`,
    `Iteration: ${session.iteration}`,
    `Retries: ${session.retries}`,
    ''
  ];

  if (pending.length > 0) {
    lines.push(`⏳ Pending (${pending.length}):`);
    pending.forEach(p => lines.push(`   • ${p.description}`));
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push(`❌ Failed (${failed.length}):`);
    failed.forEach(f => {
      lines.push(`   • ${f.description}`);
      if (f.verificationResult) {
        lines.push(`     └─ ${f.verificationResult}`);
      }
    });
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push(`⏭️ Skipped (${skipped.length}):`);
    skipped.forEach(s => lines.push(`   • ${s.description}`));
    lines.push('');
  }

  lines.push('─'.repeat(40));
  lines.push('🔄 You must complete all criteria before exiting.');

  return lines.join('\n');
}

/**
 * Increment loop iteration
 * v2.0: Delegates to durable session
 */
function incrementIteration() {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    durableSession.incrementIteration();
    return getActiveLoop();
  }

  // Legacy fallback
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  const session = getActiveLoop();
  if (!session) return null;

  session.iteration++;
  writeJson(sessionPath, session);
  return session;
}

/**
 * Increment retry count
 * v2.0: Handled via durable session's totalRetries
 */
function incrementRetry() {
  const config = getConfig();

  // v2.0: Use durable session - retries are tracked automatically in markStepFailed
  if (config.durableSteps?.enabled !== false) {
    // Durable session tracks retries per-step, but we can load the session to get total
    const session = durableSession.loadDurableSession();
    if (session) {
      session.execution.totalRetries++;
      durableSession.saveDurableSession(session);
    }
    return getActiveLoop();
  }

  // Legacy fallback
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  const session = getActiveLoop();
  if (!session) return null;

  session.retries++;
  writeJson(sessionPath, session);
  return session;
}

/**
 * End the loop session
 * v2.0: Delegates to durable session archival
 */
function endLoop(status = 'completed') {
  const config = getConfig();

  // v2.0: Use durable session if enabled
  if (config.durableSteps?.enabled !== false) {
    return durableSession.endLoop(status);
  }

  // Legacy fallback
  const projectRoot = getProjectRoot();
  const sessionPath = path.join(projectRoot, '.workflow', 'state', 'loop-session.json');

  const session = getActiveLoop();
  if (!session) return null;

  session.status = status;
  session.endedAt = new Date().toISOString();

  // Archive to history
  const historyPath = path.join(projectRoot, '.workflow', 'state', 'loop-history.json');
  let history = [];
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch {
      history = [];
    }
  }
  history.push(session);

  // Keep last 50 sessions
  if (history.length > 50) {
    history = history.slice(-50);
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  // Remove active session
  fs.unlinkSync(sessionPath);

  return session;
}

/**
 * Get loop statistics
 * v2.0: Delegates to durable session stats
 */
function getLoopStats() {
  const config = getConfig();

  // v2.0: Use durable session stats if enabled
  if (config.durableSteps?.enabled !== false) {
    const stats = durableSession.getSessionStats();
    return {
      totalLoops: stats.totalSessions,
      completed: stats.completed,
      failed: stats.failed,
      avgIterations: stats.avgSteps
    };
  }

  // Legacy fallback
  const projectRoot = getProjectRoot();
  const historyPath = path.join(projectRoot, '.workflow', 'state', 'loop-history.json');

  if (!fs.existsSync(historyPath)) {
    return { totalLoops: 0, completed: 0, failed: 0, avgIterations: 0 };
  }

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    const completed = history.filter(h => h.status === 'completed').length;
    const failed = history.filter(h => h.status === 'failed').length;
    const avgIterations = history.length > 0
      ? history.reduce((sum, h) => sum + h.iteration, 0) / history.length
      : 0;

    return {
      totalLoops: history.length,
      completed,
      failed,
      avgIterations: Math.round(avgIterations * 10) / 10
    };
  } catch {
    return { totalLoops: 0, completed: 0, failed: 0, avgIterations: 0 };
  }
}

/**
 * Verify a specific criterion using auto-inference
 * Returns { passed: boolean|null, message: string, verification: string, browserTestSuggested?: boolean }
 */
function verifyCriterion(criterion, context = {}) {
  const { execSync } = require('child_process');
  const { changedFiles = [], testResults = null, lintResults = null } = context;
  const config = getConfig();
  const desc = criterion.description;
  const descLower = desc.toLowerCase();

  // Check if auto-inference is enabled
  const autoInfer = config.loops?.autoInferVerification !== false; // Default true
  if (!autoInfer) {
    return { passed: null, message: '⚠️ Auto-inference disabled', verification: 'disabled' };
  }

  const projectRoot = getProjectRoot();

  // ═══════════════════════════════════════════════════════════════
  // FILE EXISTENCE CHECKS
  // ═══════════════════════════════════════════════════════════════

  const filePatterns = [
    /(?:create|created|add|added|new)\s+(?:a\s+)?(?:file\s+)?["`']?([^\s"`']+\.[a-z]{1,4})["`']?/i,
    /file\s+["`']?([^\s"`']+\.[a-z]{1,4})["`']?\s+(?:created|exists|should exist)/i,
    /["`']([^\s"`']+\.[a-z]{1,4})["`']?\s+(?:file\s+)?(?:created|exists)/i
  ];

  for (const pattern of filePatterns) {
    const match = desc.match(pattern);
    if (match) {
      const filePath = match[1];
      const fullPath = path.join(projectRoot, filePath);
      const exists = fs.existsSync(fullPath);
      return {
        passed: exists,
        message: exists ? `✓ File exists: ${filePath}` : `✗ File not found: ${filePath}`,
        verification: 'file-exists'
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FUNCTION/EXPORT CHECKS
  // ═══════════════════════════════════════════════════════════════

  const funcPatterns = [
    /(?:function|export|method)\s+["`']?(\w+)["`']?\s+(?:exists?\s+)?(?:in|from)\s+["`']?([^\s"`']+)["`']?/i,
    /["`']?([^\s"`']+)["`']?\s+(?:should\s+)?(?:export|have|contain)\s+["`']?(\w+)["`']?/i
  ];

  for (const pattern of funcPatterns) {
    const match = desc.match(pattern);
    if (match) {
      let funcName, filePath;
      // Handle both pattern orders
      if (pattern.source.startsWith('(?:function')) {
        [, funcName, filePath] = match;
      } else {
        [, filePath, funcName] = match;
      }
      const fullPath = path.join(projectRoot, filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const found = content.includes(funcName);
        return {
          passed: found,
          message: found ? `✓ Found "${funcName}" in ${filePath}` : `✗ "${funcName}" not found in ${filePath}`,
          verification: 'function-exists'
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPONENT CHECKS
  // ═══════════════════════════════════════════════════════════════

  const componentMatch = descLower.match(/component\s+["`']?(\w+)["`']?\s+(?:renders?|works?|exists?|displays?)/i);
  if (componentMatch) {
    const componentName = componentMatch[1];
    const searchPaths = ['src/components', 'components', 'src/ui', 'app'];
    for (const searchPath of searchPaths) {
      const searchDir = path.join(projectRoot, searchPath);
      if (fs.existsSync(searchDir)) {
        try {
          // Sanitize component name and escape path for shell safety
          const safeName = sanitizeShellArg(componentName);
          const safeLower = sanitizeShellArg(componentName.toLowerCase());
          const safePath = escapeShellPath(searchDir);
          const files = execSync(
            `find "${safePath}" -name "${safeName}.*" -o -name "${safeLower}.*" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 5000 }
          ).trim();
          if (files) {
            return {
              passed: true,
              message: `✓ Component found: ${files.split('\n')[0]}`,
              verification: 'component-exists'
            };
          }
        } catch (e) { /* continue searching */ }
      }
    }
    return {
      passed: false,
      message: `✗ Component "${componentName}" not found`,
      verification: 'component-exists'
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CLI COMMAND CHECKS
  // ═══════════════════════════════════════════════════════════════

  const cliMatch = descLower.match(/(?:command|cli|flow)\s+["`']?(\w+)["`']?\s+(?:works?|runs?|executes?)/i);
  if (cliMatch) {
    const cmd = cliMatch[1];
    // Sanitize command name for shell safety
    const safeCmd = sanitizeShellArg(cmd);
    try {
      execSync(`./scripts/flow ${safeCmd} --help`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return {
        passed: true,
        message: `✓ Command "flow ${cmd}" works`,
        verification: 'cli-works'
      };
    } catch (e) {
      return {
        passed: false,
        message: `✗ Command "flow ${cmd}" failed: ${e.message.substring(0, 100)}`,
        verification: 'cli-works'
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIG CHECKS
  // ═══════════════════════════════════════════════════════════════

  // Use original desc (not lowercase) to preserve config key case
  const configMatch = desc.match(/(?:config(?:uration)?|settings?)\s+(?:has|contains|includes)\s+["`']?(\w+(?:\.\w+)*)["`']?/i) ||
                      desc.match(/["`']?(\w+(?:\.\w+)*)["`']?\s+(?:in|enabled in)\s+config/i);
  if (configMatch) {
    const configKey = configMatch[1];
    try {
      const currentConfig = getConfig();
      const keys = configKey.split('.');
      let value = currentConfig;
      for (const k of keys) {
        value = value?.[k];
      }
      const exists = value !== undefined;
      return {
        passed: exists,
        message: exists
          ? `✓ Config "${configKey}" exists (value: ${JSON.stringify(value).substring(0, 50)})`
          : `✗ Config "${configKey}" not found`,
        verification: 'config-exists'
      };
    } catch (e) {
      return { passed: false, message: `✗ Config check failed: ${e.message}`, verification: 'config-exists' };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // INTEGRATION CHECKS (Module wired up)
  // ═══════════════════════════════════════════════════════════════

  const integrationMatch = desc.match(/["`']?(\w+)["`']?\s+(?:integrated|wired|connected)\s+(?:into|to|with)\s+["`']?([^\s"`']+)["`']?/i) ||
                           desc.match(/["`']?([^\s"`']+)["`']?\s+(?:requires?|imports?|uses?)\s+["`']?(\w+)["`']?/i);
  if (integrationMatch) {
    const [, moduleA, fileB] = integrationMatch;
    const fullPath = path.join(projectRoot, fileB);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const found = content.includes(moduleA);
      return {
        passed: found,
        message: found ? `✓ "${moduleA}" found in ${fileB}` : `✗ "${moduleA}" not found in ${fileB}`,
        verification: 'integration'
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST CHECKS
  // ═══════════════════════════════════════════════════════════════

  if (descLower.includes('test') && (descLower.includes('pass') || descLower.includes('succeed'))) {
    if (testResults) {
      return {
        passed: testResults.failed === 0,
        message: testResults.failed === 0 ? '✓ All tests pass' : `✗ ${testResults.failed} tests failing`,
        verification: 'tests'
      };
    }
    // Try running tests
    try {
      execSync('npm test -- --passWithNoTests 2>&1 | tail -5', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { passed: true, message: '✓ Tests pass', verification: 'tests' };
    } catch (e) {
      return { passed: false, message: `✗ Tests failed: ${e.message.substring(0, 100)}`, verification: 'tests' };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LINT CHECKS
  // ═══════════════════════════════════════════════════════════════

  if (descLower.includes('lint') && (descLower.includes('pass') || descLower.includes('clean') || descLower.includes('no error'))) {
    if (lintResults) {
      return {
        passed: lintResults.errors === 0,
        message: lintResults.errors === 0 ? '✓ No lint errors' : `✗ ${lintResults.errors} lint errors`,
        verification: 'lint'
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UI/BROWSER TESTING (Claude Browser Extension)
  // ═══════════════════════════════════════════════════════════════

  const uiPatterns = [
    /(?:ui|user interface|page|screen|view)\s+(?:renders?|displays?|shows?|works?)/i,
    /(?:button|form|input|modal|dialog|dropdown)\s+(?:works?|functions?|responds?)/i,
    /(?:click|submit|select|hover)\s+(?:works?|triggers?)/i,
    /user\s+(?:can|should be able to)\s+(?:see|click|submit|enter|select)/i,
    /(?:displays?|shows?|renders?)\s+(?:correctly|properly|as expected)/i
  ];

  const isUITest = uiPatterns.some(p => p.test(desc));
  const suggestBrowserTests = config.loops?.suggestBrowserTests !== false; // Default true
  const browserConfig = config.browserTesting || {};

  if (isUITest && suggestBrowserTests && browserConfig.enabled) {
    return {
      passed: null,
      message: '🌐 UI criterion detected - browser test recommended',
      verification: 'browser-test',
      browserTestSuggested: true,
      suggestedFlow: inferBrowserTestFlow(desc)
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FALLBACK
  // ═══════════════════════════════════════════════════════════════

  const fallbackToManual = config.loops?.fallbackToManual !== false; // Default true
  if (fallbackToManual) {
    return {
      passed: null,
      message: '⚠️ Could not auto-verify - manual check required',
      verification: 'manual'
    };
  }

  return {
    passed: false,
    message: '✗ Could not verify and fallbackToManual is disabled',
    verification: 'failed'
  };
}

/**
 * Infer browser test flow from criterion description
 */
function inferBrowserTestFlow(description) {
  const desc = description.toLowerCase();

  // Try to extract page/screen name (e.g., "the login page renders" -> "login")
  const pageMatch = desc.match(/(?:the\s+)?(\w+)\s+(?:page|screen|view)\s+(?:renders?|displays?|shows?|works?)/i);

  // Try to extract component name (e.g., "the registration form works" -> "registration")
  const componentMatch = desc.match(/(?:the\s+)?(\w+)\s+(?:button|form|modal|dialog|dropdown|input)\s+(?:works?|functions?|responds?|renders?)/i);

  // Try to extract action target (e.g., "click the submit button" -> "submit")
  const actionMatch = desc.match(/(?:click|submit|select|hover|enter)\s+(?:on\s+)?(?:the\s+)?(\w+)/i);

  // Also try to find any named element in quotes
  const quotedMatch = desc.match(/["`'](\w+)["`']/);

  const target = pageMatch?.[1] || componentMatch?.[1] || actionMatch?.[1] || quotedMatch?.[1] || 'unknown';

  return {
    type: pageMatch ? 'page' : componentMatch ? 'component' : 'action',
    target: target,
    action: actionMatch ? actionMatch[0] : 'verify-renders',
    description
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Standard loop functions
  isEnforcementEnabled,
  isExitBlocked,
  isVerificationRequired,
  isSkipBlocked,
  canSkipCriterion,
  getActiveLoop,
  startLoop,
  updateCriterion,
  canExitLoop,
  incrementIteration,
  incrementRetry,
  endLoop,
  getLoopStats,
  verifyCriterion,
  inferBrowserTestFlow,
  generateEnforcementMessage,
  // Simple Mode functions (v2.2)
  isSimpleModeEnabled,
  startSimpleLoop,
  getSimpleLoop,
  recordSimpleOutput,
  endSimpleLoop,
  canExitSimpleLoop,
  // Regression re-check (v2.2)
  isRecheckEnabled,
  performRegressionRecheck
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status': {
      const session = getActiveLoop();
      if (!session) {
        console.log('No active loop session');
        break;
      }

      console.log('\n📊 Active Loop Session\n');
      console.log(`Task: ${session.taskId}`);
      console.log(`Started: ${session.startedAt}`);
      console.log(`Iteration: ${session.iteration}`);
      console.log(`Retries: ${session.retries}`);
      console.log('\nAcceptance Criteria:');
      session.acceptanceCriteria.forEach(c => {
        const icon = c.status === 'completed' ? '✅' : c.status === 'failed' ? '❌' : c.status === 'skipped' ? '⏭️' : '⏳';
        console.log(`  ${icon} ${c.id}: ${c.description}`);
        if (c.verificationResult) {
          console.log(`     └─ ${c.verificationResult}`);
        }
      });

      const exit = canExitLoop();
      console.log(`\nCan exit: ${exit.canExit ? 'Yes' : 'No'} (${exit.reason})`);
      break;
    }

    case 'stats': {
      const stats = getLoopStats();
      console.log('\n📈 Loop Statistics\n');
      console.log(`Total loops: ${stats.totalLoops}`);
      console.log(`Completed: ${stats.completed}`);
      console.log(`Failed: ${stats.failed}`);
      console.log(`Avg iterations: ${stats.avgIterations}`);
      break;
    }

    case 'can-exit': {
      const result = canExitLoop();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.canExit ? 0 : 1);
      break;
    }

    case 'simple-status': {
      const session = getSimpleLoop();
      if (!session) {
        console.log('No active simple loop session');
        break;
      }

      console.log('\n\u{1F504} Simple Mode Loop Session\n');
      console.log(`Task: ${session.taskId}`);
      console.log(`Started: ${session.startedAt}`);
      console.log(`Iteration: ${session.iteration}/${session.maxIterations}`);
      console.log(`Completion Promise: "${session.completionPromise}"`);
      console.log(`Status: ${session.status}`);

      const exit = canExitSimpleLoop();
      console.log(`\nCan exit: ${exit.canExit ? 'Yes' : 'No'} (${exit.reason})`);
      break;
    }

    case 'simple-start': {
      const taskId = args[1] || `SIMPLE-${Date.now()}`;
      const promise = args[2];
      const session = startSimpleLoop(taskId, promise);
      console.log(`\u{2714}\u{FE0F} Simple Mode loop started`);
      console.log(`   Task: ${session.taskId}`);
      console.log(`   Completion Promise: "${session.completionPromise}"`);
      console.log(`   Max Iterations: ${session.maxIterations}`);
      break;
    }

    case 'simple-record': {
      const output = args.slice(1).join(' ');
      if (!output) {
        console.log('Error: Output text required');
        console.log('Usage: node flow-loop-enforcer.js simple-record "output text"');
        process.exit(1);
      }
      const result = recordSimpleOutput(output);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.completed ? 0 : 1);
      break;
    }

    case 'simple-end': {
      const status = args[1] || 'completed';
      const session = endSimpleLoop(status);
      if (session) {
        console.log(`\u{2714}\u{FE0F} Simple loop ended: ${status}`);
      } else {
        console.log('No active simple loop to end');
      }
      break;
    }

    default:
      console.log(`
Wogi Flow - Loop Enforcer

Usage:
  node flow-loop-enforcer.js <command>

Standard Loop Commands:
  status      Show active loop session
  stats       Show loop statistics
  can-exit    Check if loop can be exited (exit code 0=yes, 1=no)

Simple Mode Commands:
  simple-start [taskId] [promise]  Start simple loop with optional completion promise
  simple-status                    Show simple loop status
  simple-record "output"           Record output and check for completion
  simple-end [status]              End simple loop

Configuration (config.json):
  loops.enforced: true              Enable loop enforcement
  loops.blockExitUntilComplete: true  Block session end until complete
  loops.maxRetries: 5               Max retries before forced exit
  loops.maxIterations: 20           Max iterations before forced exit
  loops.recheckAllAfterFix: true    Re-verify all criteria after fixing one
  loops.regressionOnRecheck: "warn" How to handle regressions (warn|block)
  loops.simpleMode.enabled: true    Enable Simple Mode
  loops.simpleMode.completionPromise: "TASK_COMPLETE"
  loops.simpleMode.maxIterations: 10
`);
  }
}
