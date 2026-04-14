#!/usr/bin/env node

/**
 * Wogi Flow - PreCompact (Core Module)
 *
 * CLI-agnostic logic for the PreCompact hook.
 * Claude Code 2.1.105+ fires this event BEFORE context compaction.
 *
 * Purpose: Save critical state before compaction so PostCompact can restore it.
 * - Save task checkpoint (phase, scenarios, criteria, changed files)
 * - Save progress tracker state
 * - Save durable session snapshot
 * - Block compaction during critical phases (mid-commit, mid-validation)
 *
 * The hook can:
 * - Allow compaction: return { decision: 'allow' }
 * - Block compaction: return { decision: 'block', reason: '...' }
 *
 * This hook is fail-open: errors default to allowing compaction.
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse, getConfig } = require('../../flow-utils');

/**
 * Phases where compaction should be BLOCKED because interruption
 * would leave state inconsistent.
 *
 * These phases involve multi-step atomic operations where partial
 * completion creates broken state that PostCompact cannot repair.
 */
const BLOCK_PHASES = new Set([
  'validating',       // Mid-quality-gate — partial gate results are misleading
  'completing',       // Mid-finalization — task state transition in progress
  'wiring_check',     // Mid-wiring verification — half-checked is worse than unchecked
  'standards_check',  // Mid-standards gate — same reasoning
]);

/**
 * Handle PreCompact event.
 * Saves state and decides whether to allow or block compaction.
 *
 * @returns {Object} Result with decision and optional reason
 */
function handlePreCompact() {
  const savedItems = [];
  let shouldBlock = false;
  let blockReason = '';

  // 1. Check current workflow phase — block if critical
  try {
    const phasePath = path.join(PATHS.state, 'workflow-phase.json');
    const phaseData = safeJsonParse(phasePath, {});
    const currentPhase = phaseData.phase;

    if (currentPhase && BLOCK_PHASES.has(currentPhase)) {
      shouldBlock = true;
      blockReason = `Compaction blocked: workflow is in '${currentPhase}' phase. This phase involves atomic operations that cannot be safely interrupted. Compaction will be allowed once the phase completes.`;
    }
  } catch (_err) {
    // Phase check failure — don't block, just skip
  }

  // 2. Save task checkpoint (even if blocking — ensures state is persisted)
  try {
    const { loadCheckpoint } = require('../../flow-task-checkpoint');
    const checkpoint = loadCheckpoint();
    if (checkpoint && checkpoint.taskId) {
      // Checkpoint already exists on disk (saved at phase boundaries).
      // Touch the lastUpdated timestamp so PostCompact knows it's fresh.
      const checkpointPath = path.join(PATHS.state, 'task-checkpoint.json');
      checkpoint.lastUpdated = new Date().toISOString();
      checkpoint.preCompactSave = true;
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      savedItems.push(`task-checkpoint (${checkpoint.taskId}, phase: ${checkpoint.currentPhase})`);
    }
  } catch (_err) {
    // Checkpoint save failure is non-fatal
  }

  // 3. Save durable session snapshot
  try {
    const { loadDurableSession } = require('../../flow-durable-session');
    const session = loadDurableSession();
    if (session && session.taskId) {
      // Durable session is already on disk. Mark that pre-compact ran.
      const sessionPath = path.join(PATHS.state, 'durable-session.json');
      const sessionData = safeJsonParse(sessionPath, {});
      sessionData.preCompactAt = new Date().toISOString();
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
      savedItems.push(`durable-session (${session.taskId})`);
    }
  } catch (_err) {
    // Session save failure is non-fatal
  }

  // 4. Save progress tracker state
  try {
    const progressPath = path.join(PATHS.state, 'task-progress.json');
    if (fs.existsSync(progressPath)) {
      const progress = safeJsonParse(progressPath, {});
      if (progress.taskId) {
        progress.preCompactAt = new Date().toISOString();
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
        savedItems.push(`task-progress (${progress.phase || 'unknown phase'})`);
      }
    }
  } catch (_err) {
    // Progress save failure is non-fatal
  }

  // 5. Save compact tracker for thrash detection (used by PostCompact)
  try {
    const compactTrackerPath = path.join(PATHS.state, '.compact-tracker.json');
    const tracker = safeJsonParse(compactTrackerPath, { count: 0, lastAt: null });
    const now = Date.now();
    const lastAt = tracker.lastAt ? new Date(tracker.lastAt).getTime() : 0;

    if ((now - lastAt) < 2 * 60 * 1000 && lastAt > 0) {
      tracker.count = (tracker.count || 0) + 1;
    } else {
      tracker.count = 1;
    }
    tracker.lastAt = new Date().toISOString();
    tracker.preCompactSaved = true;
    fs.writeFileSync(compactTrackerPath, JSON.stringify(tracker, null, 2));
  } catch (_err) {
    // Tracker failure is non-fatal
  }

  // 6. Save state drift snapshot (so PostCompact/next session can detect external changes)
  try {
    const { saveSnapshot } = require('../../flow-state-drift-detector');
    saveSnapshot();
    savedItems.push('state-drift-snapshot');
  } catch (_err) {
    // Non-fatal
  }

  // Build result
  if (shouldBlock) {
    return {
      decision: 'block',
      reason: blockReason,
      savedItems
    };
  }

  return {
    decision: 'allow',
    savedItems,
    message: savedItems.length > 0
      ? `PreCompact: saved ${savedItems.length} state item(s) before compaction.`
      : null
  };
}

module.exports = { handlePreCompact, BLOCK_PHASES };
