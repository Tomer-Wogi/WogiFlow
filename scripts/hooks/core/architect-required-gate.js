'use strict';

/**
 * Wogi Flow - Architect-Required Gate (wf-037f8d66, hardened in wf-2eafdab0)
 *
 * Closes the methodology gap where the IGR Architect/Adversary pass at
 * spec_review IS specced (per .claude/docs/phases/02-spec.md) but enforcement
 * is prompt-only — the agent can skip Architect and go straight to coding.
 *
 * This gate fires on Edit/Write/Bash during the `coding` phase for L1+ tasks
 * when config.intentGroundedReasoning.enabled is true and no evidence of an
 * Architect run exists for the current task.
 *
 * Evidence marker: read from flow-architect-runs.js (the neutral-location
 * module that BOTH this gate and flow-architect-pass.js consume — keeps
 * hooks/core from owning state hooks/core's parents need to write to).
 *
 * Scope:
 *   - L0 (epic) / L1 (story) tasks: Architect required → gate enforces
 *   - L2 / L3 tasks: skip spec_review entirely (correctly) → gate is a no-op
 *   - type=story/epic with MISSING level: fail-closed (treat as L1)
 *
 * Mutation set: Edit, Write, Bash (NOT TodoWrite — review finding M8: blocking
 * planning before coding is chicken-and-egg).
 *
 * Fail-open: any error reading state/config → allow tool call.
 */

const archRuns = require('../../flow-architect-runs');
const { hasArchitectRun, getArchitectRunPath, writeArchitectRunMarker } = archRuns;

/**
 * Determine whether the current task requires Architect.
 *
 * Returns true for:
 *   - L0 (epic), L1 (story)
 *   - type=story OR type=epic with MISSING/empty level (fail-closed — review M2)
 *
 * Returns false for:
 *   - explicit L2 / L3 (regardless of type)
 *   - missing/null taskMeta
 *   - unknown type with no level signal
 */
function requiresArchitect(taskMeta) {
  if (!taskMeta || typeof taskMeta !== 'object') return false;
  const level = (taskMeta.level || '').toUpperCase();
  // Explicit level takes precedence
  if (level === 'L0' || level === 'L1') return true;
  if (level === 'L2' || level === 'L3') return false;
  // No explicit level — fail-closed for stories/epics (M2 fix).
  // A task created without a level field is untracked-by-pipeline; treating
  // it as "doesn't need architect" lets bypass slip through. Stories/epics
  // are exactly the work-types Architect is for.
  const type = (taskMeta.type || '').toLowerCase();
  if (type === 'story' || type === 'epic') return true;
  return false;
}

/**
 * Read whether the gate is enabled from config.
 * Default: enabled when IGR is enabled.
 */
function isGateEnabled(config) {
  const igr = config?.intentGroundedReasoning;
  if (!igr || igr.enabled === false) return false;
  if (config?.architectRequiredGate?.enabled === false) return false;
  return true;
}

/**
 * Main gate check.
 *
 * @param {Object} ctx — { phase, taskId, taskMeta, config, toolName, specPath? }
 * @returns {{ blocked: boolean, reason?: string, message?: string }}
 */
function checkArchitectRequired(ctx) {
  const { phase, taskId, taskMeta, config, toolName, specPath } = ctx || {};

  // Mutation set: Edit/Write/Bash only. TodoWrite removed (M8).
  const mutationTools = new Set(['Edit', 'Write', 'Bash']);
  if (!toolName || !mutationTools.has(toolName)) return { blocked: false };

  // Only fires during coding phase
  if (phase !== 'coding') return { blocked: false };

  // Gate disabled (or IGR off)
  if (!isGateEnabled(config)) return { blocked: false };

  // No active task → not in scope
  if (!taskId) return { blocked: false };

  // L2/L3 tasks correctly bypass spec_review — gate is a no-op
  if (!requiresArchitect(taskMeta)) return { blocked: false };

  // Check evidence marker (with content validation + optional specHash check)
  if (hasArchitectRun(taskId, specPath)) return { blocked: false };

  return {
    blocked: true,
    reason: 'architect-required',
    message: [
      `ARCHITECT-REQUIRED GATE: task ${taskId} is L1+ in coding phase but no `,
      `valid Architect run is recorded at ${getArchitectRunPath(taskId)}.\n\n`,
      `Per .claude/docs/phases/02-spec.md Step 1.55, L1+ tasks must run an `,
      `Architect pass before coding. Invoke:\n\n`,
      `  node scripts/flow-architect-pass.js run --task=${taskId}\n\n`,
      `Then retry your edit. To opt out for this task only, set `,
      `config.architectRequiredGate.enabled = false (project-level).`
    ].join('')
  };
}

module.exports = {
  checkArchitectRequired,
  // Re-exports from flow-architect-runs for backward compat with existing
  // test suite + flow-architect-pass.js. These pass-throughs let consumers
  // who already require the gate continue to work; new consumers should
  // prefer require('../../flow-architect-runs') directly.
  requiresArchitect,
  isGateEnabled,
  hasArchitectRun,
  getArchitectRunPath,
  writeArchitectRunMarker
};
