#!/usr/bin/env node

/**
 * Wogi Flow - Loop Check (Core Module)
 *
 * CLI-agnostic loop enforcement logic.
 * Verifies acceptance criteria are complete before allowing task completion.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');
const fs = require('fs');

// Import from parent scripts directory
const { getConfig, PATHS } = require('../../flow-utils');
const { checkQueueContinuation, advanceTaskQueue, checkPendingSkillExecution } = require('../../flow-durable-session');

/**
 * Check if loop enforcement is enabled
 * @returns {boolean}
 */
function isLoopEnforcementEnabled() {
  const config = getConfig();

  // Check hooks config first
  if (config.hooks?.rules?.loopEnforcement?.enabled === false) {
    return false;
  }

  // Fall back to loops config
  if (config.loops?.enforced === false) {
    return false;
  }

  if (config.loops?.enabled === false) {
    return false;
  }

  return true;
}

/**
 * Get the active loop session (if any)
 * @returns {Object|null} Loop session or null
 */
function getActiveLoopSession() {
  try {
    const loopSessionPath = path.join(PATHS.state, 'loop-session.json');
    if (!fs.existsSync(loopSessionPath)) {
      return null;
    }

    const session = JSON.parse(fs.readFileSync(loopSessionPath, 'utf-8'));
    if (session.status !== 'active') {
      return null;
    }

    return session;
  } catch (err) {
    return null;
  }
}

/**
 * Check if criteria are complete
 * @param {Object} session - Loop session
 * @returns {Object} Criteria status
 */
function checkCriteriaStatus(session) {
  if (!session || !session.acceptanceCriteria) {
    return {
      total: 0,
      completed: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      allComplete: true
    };
  }

  const criteria = session.acceptanceCriteria;
  const completed = criteria.filter(c => c.status === 'completed' || c.status === 'passed').length;
  const pending = criteria.filter(c => c.status === 'pending' || !c.status).length;
  const failed = criteria.filter(c => c.status === 'failed').length;
  const skipped = criteria.filter(c => c.status === 'skipped').length;

  return {
    total: criteria.length,
    completed,
    pending,
    failed,
    skipped,
    allComplete: pending === 0 && failed === 0,
    criteria
  };
}

/**
 * Check if the current loop can exit (task can complete)
 * @returns {Object} Result: { canExit, blocked, message, reason, criteriaStatus }
 */
async function checkLoopExit() {
  if (!isLoopEnforcementEnabled()) {
    return {
      canExit: true,
      blocked: false,
      message: null,
      reason: 'loop_enforcement_disabled'
    };
  }

  const session = getActiveLoopSession();

  if (!session) {
    // v4.1: Check if a skill is pending execution before allowing exit
    // This fixes the bug where /wogi-bulk loads but Claude stops before executing
    const pendingSkill = checkPendingSkillExecution();
    if (pendingSkill.hasPendingSkill) {
      return {
        canExit: false,
        blocked: true,
        message: pendingSkill.message,
        reason: 'skill_pending_execution',
        skillName: pendingSkill.skillName
      };
    }

    return {
      canExit: true,
      blocked: false,
      message: null,
      reason: 'no_active_loop'
    };
  }

  const criteriaStatus = checkCriteriaStatus(session);

  if (criteriaStatus.allComplete) {
    // Task criteria complete - check if there are more tasks in queue
    const queueResult = checkQueueContinuation();

    if (queueResult.shouldContinue) {
      // Advance queue and signal to continue to next task
      advanceTaskQueue();
      return {
        canExit: false,
        blocked: false,
        continueToNext: true,
        nextTaskId: queueResult.nextTaskId,
        remaining: queueResult.remaining,
        message: queueResult.message,
        reason: 'queue_has_more_tasks',
        criteriaStatus
      };
    }

    if (queueResult.shouldPrompt) {
      // Pause between tasks (if configured)
      return {
        canExit: false,
        blocked: false,
        shouldPrompt: true,
        nextTaskId: queueResult.nextTaskId,
        message: queueResult.message,
        reason: 'queue_pause_between_tasks',
        criteriaStatus
      };
    }

    // No queue or queue complete - allow exit
    return {
      canExit: true,
      blocked: false,
      message: queueResult.reason === 'queue_complete'
        ? queueResult.message
        : `All ${criteriaStatus.completed} acceptance criteria completed.`,
      reason: queueResult.reason === 'queue_complete' ? 'queue_complete' : 'criteria_complete',
      criteriaStatus
    };
  }

  // Check if max retries/iterations exceeded
  const config = getConfig();
  const maxRetries = config.loops?.maxRetries || 5;
  const maxIterations = config.loops?.maxIterations || 20;

  if (session.retries >= maxRetries) {
    return {
      canExit: true,
      blocked: false,
      message: `Max retries (${maxRetries}) reached. Allowing exit.`,
      reason: 'max_retries_exceeded',
      criteriaStatus
    };
  }

  if (session.iterations >= maxIterations) {
    return {
      canExit: true,
      blocked: false,
      message: `Max iterations (${maxIterations}) reached. Allowing exit.`,
      reason: 'max_iterations_exceeded',
      criteriaStatus
    };
  }

  // Approach thrashing detection: 3+ rejected observations on same file within last hour
  try {
    const memoryDb = require('../../flow-memory-db');
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rejected = await memoryDb.searchRejectedObservations({
      taskId: session.taskId,
      since: oneHourAgo,
      limit: 50
    });

    if (rejected.length >= 3) {
      // Group by file to detect same-file thrashing
      const fileCounts = {};
      for (const r of rejected) {
        const fileMatch = (r.inputSummary || '').match(/(?:file_path|path|file).*?([^\s,'"]+\.\w+)/i);
        if (fileMatch) {
          const file = fileMatch[1];
          fileCounts[file] = (fileCounts[file] || 0) + 1;
        }
      }

      const thrashingFiles = Object.entries(fileCounts)
        .filter(([, count]) => count >= 3)
        .map(([file, count]) => ({ file, count }));

      if (thrashingFiles.length > 0) {
        const thrashingWarning = `\n⚠️ APPROACH THRASHING DETECTED:\n` +
          thrashingFiles.map(f => `  ${f.file}: ${f.count} failed attempts in the last hour`).join('\n') +
          `\n\nConsider a different strategy:\n` +
          `  - Try a completely different approach to the problem\n` +
          `  - Check if the file structure or API has changed\n` +
          `  - Ask the user for guidance on the correct approach\n`;

        return {
          canExit: false,
          blocked: true,
          message: generateBlockMessage(criteriaStatus, session) + thrashingWarning,
          reason: 'criteria_incomplete_with_thrashing',
          criteriaStatus,
          thrashingFiles
        };
      }
    }
  } catch {
    // Non-critical - don't fail loop check for thrashing detection
  }

  // Block exit - criteria not complete
  return {
    canExit: false,
    blocked: true,
    message: generateBlockMessage(criteriaStatus, session),
    reason: 'criteria_incomplete',
    criteriaStatus
  };
}

/**
 * Generate block message for incomplete criteria
 */
function generateBlockMessage(criteriaStatus, session) {
  let msg = `Cannot complete task. Acceptance criteria not met.\n\n`;

  if (criteriaStatus.pending > 0) {
    msg += `**Pending (${criteriaStatus.pending}):**\n`;
    const pending = criteriaStatus.criteria.filter(c => c.status === 'pending' || !c.status);
    pending.forEach(c => {
      msg += `- ${c.description || c.text || c}\n`;
    });
  }

  if (criteriaStatus.failed > 0) {
    msg += `\n**Failed (${criteriaStatus.failed}):**\n`;
    const failed = criteriaStatus.criteria.filter(c => c.status === 'failed');
    failed.forEach(c => {
      msg += `- ${c.description || c.text || c}\n`;
      if (c.error || c.verificationResult) {
        msg += `  Error: ${c.error || c.verificationResult}\n`;
      }
    });
  }

  msg += `\nComplete all criteria or use /wogi-done ${session.taskId} --force to override.`;

  return msg;
}

module.exports = {
  isLoopEnforcementEnabled,
  getActiveLoopSession,
  checkCriteriaStatus,
  checkLoopExit,
  generateBlockMessage
};
