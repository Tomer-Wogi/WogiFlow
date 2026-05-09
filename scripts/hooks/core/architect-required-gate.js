#!/usr/bin/env node

/**
 * Wogi Flow - Architect-Required Gate (wf-037f8d66)
 *
 * Closes the methodology gap where the IGR Architect/Adversary pass at
 * spec_review IS specced (per .claude/docs/phases/02-spec.md) but enforcement
 * is prompt-only — the agent can skip Architect and go straight to coding.
 *
 * This gate fires on Edit/Write during the `coding` phase for L1+ tasks when
 * config.intentGroundedReasoning.enabled is true and no evidence of an
 * Architect run exists for the current task.
 *
 * Evidence marker: `.workflow/state/architect-runs/<task-id>.json` written
 * by flow-architect-pass.js on successful completion.
 *
 * Scope:
 *   - L0 (epic) / L1 (story) tasks: Architect required → gate enforces
 *   - L2 / L3 tasks: skip spec_review entirely (correctly) → gate is a no-op
 *
 * Fail-open: any error reading state/config → allow tool call. Same pattern
 * as research-evidence-gate.js.
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS } = require('../../flow-utils');

const ARCHITECT_RUNS_DIR = path.join(PATHS.state, 'architect-runs');

/**
 * Compute path to the Architect-run evidence marker for a task.
 */
function getArchitectRunPath(taskId) {
  if (!taskId || typeof taskId !== 'string') return null;
  return path.join(ARCHITECT_RUNS_DIR, `${taskId}.json`);
}

/**
 * Write an Architect-run evidence marker. Called by flow-architect-pass.js
 * on successful completion. Atomic write-temp + rename.
 *
 * @param {Object} payload — { taskId, completedAt, model, plan }
 * @returns {{ written: boolean, path: string|null }}
 */
function writeArchitectRunMarker(payload) {
  if (!payload || !payload.taskId) {
    return { written: false, path: null };
  }
  try {
    if (!fs.existsSync(ARCHITECT_RUNS_DIR)) {
      fs.mkdirSync(ARCHITECT_RUNS_DIR, { recursive: true });
    }
    const filePath = getArchitectRunPath(payload.taskId);
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify({
      taskId: payload.taskId,
      completedAt: payload.completedAt || new Date().toISOString(),
      model: payload.model || null,
      plan: payload.plan || null
    }, null, 2));
    fs.renameSync(tmpPath, filePath);
    return { written: true, path: filePath };
  } catch (_err) {
    return { written: false, path: null };
  }
}

/**
 * Check whether an Architect run is recorded for a given task.
 * @param {string} taskId
 * @returns {boolean}
 */
function hasArchitectRun(taskId) {
  const p = getArchitectRunPath(taskId);
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch (_err) {
    return false;
  }
}

/**
 * Determine whether the current task requires Architect (L1+ only).
 * @param {Object} taskMeta — task record from ready.json (has level, type)
 * @returns {boolean}
 */
function requiresArchitect(taskMeta) {
  if (!taskMeta || typeof taskMeta !== 'object') return false;
  const level = (taskMeta.level || '').toUpperCase();
  // L0 (epic) and L1 (story) require Architect.
  // L2 (task) / L3 (subtask) bypass spec_review correctly.
  return level === 'L0' || level === 'L1';
}

/**
 * Read whether the gate is enabled from config.
 * Default: enabled when IGR is enabled.
 */
function isGateEnabled(config) {
  const igr = config?.intentGroundedReasoning;
  if (!igr || igr.enabled === false) return false;
  // Explicit toggle on the gate itself overrides
  if (config?.architectRequiredGate?.enabled === false) return false;
  return true;
}

/**
 * Main gate check.
 *
 * @param {Object} ctx — { phase, taskId, taskMeta, config, toolName }
 * @returns {{ blocked: boolean, reason?: string, message?: string }}
 */
function checkArchitectRequired(ctx) {
  const { phase, taskId, taskMeta, config, toolName } = ctx || {};

  // Only fires on tools that mutate state (Edit/Write/Bash/TodoWrite)
  const mutationTools = new Set(['Edit', 'Write', 'TodoWrite', 'Bash']);
  if (!toolName || !mutationTools.has(toolName)) {
    return { blocked: false };
  }

  // Only fires during coding phase
  if (phase !== 'coding') {
    return { blocked: false };
  }

  // Gate disabled (or IGR off)
  if (!isGateEnabled(config)) {
    return { blocked: false };
  }

  // No active task → not in scope (gate doesn't apply)
  if (!taskId) {
    return { blocked: false };
  }

  // L2/L3 tasks bypass spec_review correctly — gate is a no-op
  if (!requiresArchitect(taskMeta)) {
    return { blocked: false };
  }

  // Check for evidence marker
  if (hasArchitectRun(taskId)) {
    return { blocked: false };
  }

  // Block: Architect required but no evidence
  return {
    blocked: true,
    reason: 'architect-required',
    message: [
      `ARCHITECT-REQUIRED GATE: task ${taskId} is L1+ in coding phase but no `,
      `Architect run is recorded at ${getArchitectRunPath(taskId)}.\n\n`,
      `Per .claude/docs/phases/02-spec.md Step 1.55, L1+ tasks must run an `,
      `Architect pass before coding. Invoke:\n\n`,
      `  node scripts/flow-architect-pass.js run --task=${taskId}\n\n`,
      `Then retry your edit. To opt out for this task only, set `,
      `config.architectRequiredGate.enabled = false (project-level), or use `,
      `\`flow architect-skip --task=${taskId} --reason="..."\` (single-task escape; `,
      `not yet implemented — opens follow-up wf if needed).`
    ].join('')
  };
}

module.exports = {
  checkArchitectRequired,
  writeArchitectRunMarker,
  hasArchitectRun,
  requiresArchitect,
  getArchitectRunPath,
  isGateEnabled,
  ARCHITECT_RUNS_DIR
};
