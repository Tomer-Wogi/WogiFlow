#!/usr/bin/env node

/**
 * Wogi Flow - Phase-Read Gate (Core Module)
 *
 * Enforces that the AI reads the correct phase instruction file before
 * using Edit/Write/Bash in that phase. This enables on-demand loading
 * of phase instructions instead of loading the full wogi-start.md upfront.
 *
 * State file: .workflow/state/phase-reads.json
 * Fail-open: If state file is missing/corrupt, allow the tool call.
 *
 * Gate execution order note: This gate runs in PreToolUse AFTER phase-gate
 * and BEFORE routing-gate. The phase-gate pre-filter ensures this gate
 * only fires in phases where routing has already completed, so the
 * "read phase file" message can't surface before "route through /wogi-start".
 *
 * Three entry points:
 *   recordPhaseRead(filePath)    — called when Read targets a phase file
 *   checkPhaseReadGate(toolName) — called before Edit/Write/Bash
 *   clearPhaseReads()            — called on new task start, session-end, post-compact
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse, getCanonicalStateDir, isLinkedWorktree } = require('../../flow-utils');

// Exported for tests (main-tree path). The gate resolves these paths CANONICALLY
// at call time (see workflowPhasePath / phaseReadsPath) so it cannot be evaded
// from a git worktree, where the gitignored phase file is absent (wf-e5e57361 /
// RC2). In the main working tree the canonical path equals this constant.
const PHASE_READS_FILE = path.join(PATHS.state, 'phase-reads.json');

// Lazy canonical resolvers — `stateDir` override is injectable for tests.
function workflowPhasePath(stateDir) { return path.join(stateDir || getCanonicalStateDir(), 'workflow-phase.json'); }
function phaseReadsPath(stateDir) { return path.join(stateDir || getCanonicalStateDir(), 'phase-reads.json'); }

/**
 * True if the canonical ready.json shows a task in-progress. Used to fail the
 * gate CLOSED (rather than open) when phase state is unresolvable inside a
 * worktree of an in-progress task — the gate-evasion shape from RC2.
 */
function hasCanonicalInProgressTask(stateDir) {
  try {
    const ready = safeJsonParse(path.join(stateDir || getCanonicalStateDir(), 'ready.json'), { inProgress: [] });
    return Array.isArray(ready.inProgress) && ready.inProgress.length > 0;
  } catch (_err) {
    return false;
  }
}

// Maps workflow phases to required instruction files
const PHASE_FILE_REGISTRY = {
  exploring: '.claude/docs/phases/01-explore.md',
  spec_review: '.claude/docs/phases/02-spec.md',
  coding: '.claude/docs/phases/03-implement.md',
  validating: '.claude/docs/phases/04-verify.md',
  completing: '.claude/docs/phases/05-complete.md'
};

// Phases that don't require a phase file read
const EXEMPT_PHASES = new Set(['idle', 'routing']);

/**
 * Record that a phase instruction file was read.
 * Called from PreToolUse when toolName === 'Read'.
 *
 * Path matching is rooted to the project via path.relative, preventing
 * cross-project path forgery — e.g., reading /tmp/foo/.claude/docs/phases/03-implement.md
 * does NOT satisfy the gate for the current project.
 */
function recordPhaseRead(filePath) {
  if (!filePath || typeof filePath !== 'string') return;

  // Resolve to project-relative path. If the file is outside the project,
  // path.relative produces a path starting with '..' which will never match
  // any entry in PHASE_FILE_REGISTRY.
  let projectRelative;
  try {
    projectRelative = path.relative(PATHS.root, path.resolve(filePath));
  } catch (_err) {
    return; // Invalid path — fail-open, don't record
  }

  // Normalize path separators for cross-platform matching (Windows uses \)
  projectRelative = projectRelative.split(path.sep).join('/');

  // Check if this file matches a phase instruction file (project-rooted only)
  let matchedPhase = null;
  for (const [phase, requiredFile] of Object.entries(PHASE_FILE_REGISTRY)) {
    if (projectRelative === requiredFile) {
      matchedPhase = phase;
      break;
    }
  }

  if (!matchedPhase) return;

  // Read-modify-write on phase-reads.json.
  // Locking is intentionally omitted: phase transitions are sequential, and
  // fail-open semantics mean a lost write just means the gate asks for a
  // re-read — safe degradation, not a correctness bug.
  try {
    const readsFile = phaseReadsPath();
    const existing = safeJsonParse(readsFile, {});
    if (!existing.reads) existing.reads = {};

    existing.reads[matchedPhase] = {
      file: PHASE_FILE_REGISTRY[matchedPhase],
      at: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(readsFile), { recursive: true });
    fs.writeFileSync(readsFile, JSON.stringify(existing, null, 2));

    if (process.env.DEBUG) {
      console.error(`[PhaseReadGate] Recorded read of ${PHASE_FILE_REGISTRY[matchedPhase]} for phase ${matchedPhase}`);
    }
  } catch (_err) {
    // Fail-open: recording failure should not block anything
    if (process.env.DEBUG) {
      console.error(`[PhaseReadGate] Failed to record phase read: ${_err.message}`);
    }
  }
}

/**
 * Check if the required phase file has been read before allowing Edit/Write/Bash.
 * Returns { blocked: true/false, message?: string }
 *
 * Fail-open on the following conditions (the prompt text should reflect this):
 * - Config disabled (phaseReadGate.enabled === false OR falls back to phaseGate.enabled === false)
 * - No workflow-phase.json (task hasn't transitioned)
 * - Unknown phase (not in PHASE_FILE_REGISTRY)
 * - Any exception during check
 *
 * @param {string} toolName
 * @param {Object} [config] - Optional config object
 * @param {Object} [deps] - Injectable seams for tests:
 *   { stateDir, isLinkedWorktree, hasInProgressTask }
 */
function checkPhaseReadGate(toolName, config, deps = {}) {
  try {
    // Respect phaseReadGate config with fallback to phaseGate (backwards compat).
    // If phaseReadGate.enabled is explicitly false, skip. If it's undefined,
    // fall through to phaseGate.enabled check.
    const phaseReadGateEnabled = config?.hooks?.rules?.phaseReadGate?.enabled;
    const phaseGateEnabled = config?.hooks?.rules?.phaseGate?.enabled;

    if (phaseReadGateEnabled === false) {
      return { blocked: false };
    }
    if (phaseReadGateEnabled === undefined && phaseGateEnabled === false) {
      return { blocked: false };
    }

    // RC2 (wf-e5e57361): resolve phase from the CANONICAL state dir, not cwd —
    // a git worktree lacks the gitignored phase file, so a cwd-relative read
    // would fail-open to an unrestricted "idle" phase ("ungated context").
    const stateDir = deps.stateDir || getCanonicalStateDir();
    const inWorktree = (deps.isLinkedWorktree || isLinkedWorktree);
    const hasInProgress = (deps.hasInProgressTask || hasCanonicalInProgressTask);

    // Read current phase (canonically)
    const phaseData = safeJsonParse(workflowPhasePath(stateDir), null);
    if (!phaseData || !phaseData.phase) {
      // RC2 fail-CLOSED: a missing phase file inside a linked worktree while a
      // task is in-progress (per canonical ready.json) is the gate-evasion
      // shape — block mutation tools instead of failing open.
      if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') &&
          inWorktree(stateDir) && hasInProgress(stateDir)) {
        return {
          blocked: true,
          message: 'Phase gate (RC2): a task is in progress but the workflow phase ' +
            'could not be resolved, and you appear to be operating from a git worktree. ' +
            'Gates are NOT evadable by working from a worktree — phase is resolved from ' +
            'the canonical (main-repo) state. Return to the main working tree and satisfy ' +
            'the gate legitimately, or channel-escalate to the manager. Do NOT create ' +
            'worktrees or write gate-satisfying markers to bypass this.'
        };
      }
      return { blocked: false }; // No phase data = fail-open (normal main-tree)
    }

    const currentPhase = phaseData.phase;

    // Exempt phases don't need a file read
    if (EXEMPT_PHASES.has(currentPhase)) {
      return { blocked: false };
    }

    // Check if phase has a required file
    const requiredFile = PHASE_FILE_REGISTRY[currentPhase];
    if (!requiredFile) {
      return { blocked: false }; // Unknown phase = fail-open
    }

    // Check if that file has been read
    const readData = safeJsonParse(phaseReadsPath(stateDir), {});
    const reads = readData.reads || {};

    if (reads[currentPhase]) {
      return { blocked: false }; // Phase file was read
    }

    // Phase file not read — block the tool
    return {
      blocked: true,
      message: `Phase "${currentPhase}" requires reading the phase instruction file first.\n\n` +
        `Please read: ${requiredFile}\n\n` +
        `Phase files contain the step-by-step instructions for this phase of task execution. ` +
        `The PreToolUse hook blocks ${toolName} until the phase file is loaded.`
    };
  } catch (_err) {
    // Fail-open on any error
    if (process.env.DEBUG) {
      console.error(`[PhaseReadGate] Gate check error (fail-open): ${_err.message}`);
    }
    return { blocked: false };
  }
}

/**
 * Clear phase reads state.
 * Called when:
 *   - A new task starts (pre-tool-use.js Skill hook)
 *   - A session ends (session-end.js)
 *   - Context is compacted (post-compact.js) — forces re-read in new context
 */
function clearPhaseReads() {
  try {
    const readsFile = phaseReadsPath();
    fs.mkdirSync(path.dirname(readsFile), { recursive: true });
    fs.writeFileSync(readsFile, JSON.stringify({ reads: {} }, null, 2));
  } catch (_err) {
    if (process.env.DEBUG) {
      console.error(`[PhaseReadGate] Failed to clear phase reads: ${_err.message}`);
    }
  }
}

module.exports = {
  recordPhaseRead,
  checkPhaseReadGate,
  clearPhaseReads,
  hasCanonicalInProgressTask,
  workflowPhasePath,
  phaseReadsPath,
  PHASE_FILE_REGISTRY,
  PHASE_READS_FILE
};
