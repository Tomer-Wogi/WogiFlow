#!/usr/bin/env node

/**
 * Wogi Flow - Gate Latch
 *
 * Records when quality gates have passed for a task.
 * The TaskCompleted hook checks for this latch before allowing
 * a task to move to recentlyCompleted.
 *
 * Without the latch, agents can call TaskUpdate(status: "completed")
 * and bypass all quality gates. The latch ensures that the only path
 * to completion goes through the quality gate pipeline.
 *
 * Flow:
 * 1. flow-done.js runs quality gates → gates pass → writes latch
 * 2. Agent calls TaskUpdate → TaskCompleted hook fires
 * 3. Hook checks latch → if present and recent → allows completion
 * 4. If no latch → blocks completion with actionable error message
 *
 * Latch file: .workflow/state/.gates-passed.json
 * TTL: 30 minutes (stale latches are ignored)
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse } = require('./flow-utils');

/** Latch time-to-live in milliseconds (30 minutes) */
const LATCH_TTL_MS = 30 * 60 * 1000;

/** Path to the gate latch file */
const LATCH_PATH = path.join(PATHS.state, '.gates-passed.json');

/**
 * Record that quality gates have passed for a task.
 * Called by flow-done.js after all gates pass.
 *
 * @param {string} taskId - The task ID that passed gates
 * @param {string[]} gatesPassed - Names of gates that passed
 * @returns {{ written: boolean, path: string }}
 */
function setGateLatch(taskId, gatesPassed = []) {
  try {
    const latch = {
      taskId,
      gatesPassed,
      passedAt: new Date().toISOString(),
      pid: process.pid
    };
    fs.writeFileSync(LATCH_PATH, JSON.stringify(latch, null, 2));
    return { written: true, path: LATCH_PATH };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[gate-latch] Failed to write latch: ${err.message}`);
    }
    return { written: false, path: LATCH_PATH };
  }
}

/**
 * Check if quality gates have passed for a task.
 * Returns the latch data if valid, null if no latch or expired.
 *
 * @param {string} taskId - The task ID to check
 * @returns {{ valid: boolean, latch: Object|null, reason: string }}
 */
function checkGateLatch(taskId) {
  const latch = safeJsonParse(LATCH_PATH, null);

  if (!latch) {
    return {
      valid: false,
      latch: null,
      reason: 'No gate latch found. Quality gates have not been run for this task.'
    };
  }

  // Check task ID matches
  if (latch.taskId !== taskId) {
    return {
      valid: false,
      latch,
      reason: `Gate latch is for task ${latch.taskId}, not ${taskId}.`
    };
  }

  // Check TTL
  const passedAt = new Date(latch.passedAt).getTime();
  const age = Date.now() - passedAt;
  if (age > LATCH_TTL_MS) {
    return {
      valid: false,
      latch,
      reason: `Gate latch expired (${Math.round(age / 60000)} min old, TTL is ${LATCH_TTL_MS / 60000} min).`
    };
  }

  return {
    valid: true,
    latch,
    reason: `Gates passed at ${latch.passedAt} (${latch.gatesPassed.length} gates)`
  };
}

/**
 * Clear the gate latch after task completion.
 * Prevents stale latches from persisting.
 */
function clearGateLatch() {
  try {
    if (fs.existsSync(LATCH_PATH)) {
      fs.unlinkSync(LATCH_PATH);
    }
  } catch (_err) {
    // Non-critical
  }
}

module.exports = { setGateLatch, checkGateLatch, clearGateLatch, LATCH_PATH };
