'use strict';

/**
 * Wogi Flow — PreToolUse Gate Dependency Loader (audit Story 9 / wf-5e94e2c0)
 *
 * Extracted from scripts/hooks/entry/claude-code/pre-tool-use.js to
 * comply with the hook three-layer rule (entry files ≤120 LOC). Owns
 * the defensive lazy-load logic for every gate the orchestrator
 * dispatches to — fail-open shims when modules are absent in older
 * installs, stderr WARNING for the research-evidence-gate-specific
 * deployment-issue case (CL-004).
 *
 * Architect plan: .workflow/changes/wf-5e94e2c0-architect.md
 *
 * Public surface (single function):
 *   loadGateDeps() → deps object for runPreToolGates(input, deps)
 *
 * Cross-Story Tier-3 Rule (P11.4) compliance: the upstream contract is
 * `runPreToolGates`'s deps shape. Tests in
 * tests/flow-hooks-pre-tool-deps.test.js pin the exact key set + shim
 * shapes; the broader pre-tool-orchestrator.test.js exercises the
 * dispatch path end-to-end as the Tier-3 integration check.
 */

const _noop = () => ({ allowed: true, blocked: false });
const _phaseNoop = () => ({ blocked: false });

/**
 * Build the dependency object expected by runPreToolGates(input, deps).
 *
 * Each gate is loaded inside its own try/catch so a missing module in an
 * older install fails open (no-op shim) rather than crashing the entire
 * PreToolUse pipeline. Behavior preserved verbatim from the prior inline
 * implementation in pre-tool-use.js.
 *
 * @returns {Object} deps shape consumed by pre-tool-orchestrator
 */
function loadGateDeps() {
  // Always-required core gates (these are part of the canonical install;
  // crash on load failure is acceptable since the install itself is broken).
  const { checkScopeGate } = require('./scope-gate');
  const { checkComponentReuse } = require('./component-check');
  const { checkTodoWriteGate } = require('./todowrite-gate');
  const { checkRoutingGate, clearRoutingPending, hasActiveTask } = require('./routing-gate');
  const { checkPhaseGate } = require('./phase-gate');
  const { checkCommitLogGate } = require('./commit-log-gate');

  // Defensive lazy-loaders — fail-open with shim if module absent
  let recordPhaseRead = () => {};
  let checkPhaseReadGate = _phaseNoop;
  let clearPhaseReads = () => {};
  try {
    const prg = require('./phase-read-gate');
    recordPhaseRead = prg.recordPhaseRead;
    checkPhaseReadGate = prg.checkPhaseReadGate;
    clearPhaseReads = prg.clearPhaseReads;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Phase-read gate not loaded: ${_err.message}`);
  }

  let recordEvidenceRead = () => {};
  let checkSpecWriteGate = _phaseNoop;
  let clearResearchEvidence = () => {};
  try {
    const reg = require('./research-evidence-gate');
    recordEvidenceRead = reg.recordEvidenceRead;
    checkSpecWriteGate = reg.checkSpecWriteGate;
    clearResearchEvidence = reg.clearResearchEvidence;
  } catch (err) {
    // CL-004: load failure for a gate file that SHOULD be present is a
    // deployment issue worth surfacing without DEBUG. Silently shimming
    // masks broken installs. Fail-open shims above keep the pipeline
    // working; stderr makes the operator aware.
    console.error(`[Hook] WARNING: Research-evidence gate failed to load — gate is disabled. ${err.message}`);
  }

  let checkDeployGate = _noop;
  let checkWriteBlock = _noop;
  try {
    const dg = require('./deploy-gate');
    checkDeployGate = dg.checkDeployGate;
    checkWriteBlock = dg.checkWriteBlock;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Deploy gate not loaded: ${_err.message}`);
  }

  let checkStrikeGate = _noop;
  try {
    checkStrikeGate = require('./strike-gate').checkStrikeGate;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Strike gate not loaded: ${_err.message}`);
  }

  let checkBugfixScope = _noop;
  try {
    checkBugfixScope = require('./bugfix-scope-gate').checkBugfixScope;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Bugfix scope gate not loaded: ${_err.message}`);
  }

  let checkScopeMutation = _noop;
  try {
    checkScopeMutation = require('./scope-mutation-gate').checkScopeMutation;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Scope mutation gate not loaded: ${_err.message}`);
  }

  let checkGitSafety = _noop;
  try {
    checkGitSafety = require('./git-safety-gate').checkGitSafety;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Git safety gate not loaded: ${_err.message}`);
  }

  let checkManagerBoundary = _noop;
  try {
    checkManagerBoundary = require('./manager-boundary-gate').checkManagerBoundary;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Manager boundary gate not loaded: ${_err.message}`);
  }

  let checkWorkerBoundary = _noop;
  let checkPathDiscipline = _noop;
  try {
    const wbg = require('./worker-boundary-gate');
    checkWorkerBoundary = wbg.checkWorkerBoundary;
    checkPathDiscipline = wbg.checkPathDiscipline;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Worker boundary gate not loaded: ${_err.message}`);
  }

  // Long-input-pending gate (P11.6 mechanical layer). Consults the marker
  // file written by user-prompt-submit when a long-form prompt arrives
  // without a source-link, and blocks mutating tools until the AI either
  // runs /wogi-extract-review or dismisses the marker explicitly.
  let checkLongInputPendingGate = _noop;
  try {
    checkLongInputPendingGate = require('./long-input-enforcement').checkLongInputPendingGate;
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[Hook] Long-input-pending gate not loaded: ${_err.message}`);
  }

  // CLI-agnostic helpers (not gates per se but consumed by the orchestrator)
  const { markSkillPending } = require('../../flow-durable-session');
  const { getConfig } = require('../../flow-utils');
  const { readHookStatus } = require('../../flow-hook-status');

  // Strict adherence — lazy to avoid circular deps + startup cost
  let _strictAdherence = null;
  function getStrictAdherence() {
    if (!_strictAdherence) {
      try {
        _strictAdherence = require('../../flow-strict-adherence');
      } catch (_err) {
        _strictAdherence = {
          isEnabled: () => false,
          validateCommand: () => ({ valid: true }),
          validateFileName: () => ({ valid: true })
        };
      }
    }
    return _strictAdherence;
  }

  return {
    // Gates
    checkScopeGate, checkComponentReuse, checkTodoWriteGate,
    checkRoutingGate, clearRoutingPending, hasActiveTask,
    checkPhaseGate, checkCommitLogGate,
    recordPhaseRead, checkPhaseReadGate, clearPhaseReads,
    recordEvidenceRead, checkSpecWriteGate, clearResearchEvidence,
    checkDeployGate, checkWriteBlock,
    checkStrikeGate, checkBugfixScope, checkScopeMutation,
    checkGitSafety, checkManagerBoundary, checkWorkerBoundary, checkPathDiscipline,
    checkLongInputPendingGate,
    // Side-effect helpers
    markSkillPending,
    // Config + runtime
    getConfig, readHookStatus, getStrictAdherence
  };
}

module.exports = {
  loadGateDeps
};
