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
 * P-F2 (audit 2026-05-29): loadGateDeps previously eagerly `require()`d ~16 gate
 * modules on EVERY PreToolUse invocation (the hook runs on every Claude tool
 * call). Most gates are tool-scoped — e.g. commit-log / deploy / git-safety only
 * matter for Bash, phase-read only for Edit/Write — so a plain Read paid the
 * parse cost of a dozen modules it never exercised. The requires are now deferred
 * behind per-module memoized loaders: each gate module is parsed only the first
 * time one of its functions is actually called, which the orchestrator does
 * conditionally by tool. loadGateDeps itself now performs NO requires at build
 * time, so it cannot throw on load (it only constructs thin wrapper closures) —
 * an important property because the entry runs with failMode:'block', so a throw
 * here would block every tool with no recovery path.
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
 * Memoized lazy module loader. Returns a getter that requires `modPath` on first
 * call and caches the result (or caches a load failure). Never re-requires.
 *
 * @param {string} modPath - module path to require lazily
 * @param {Object} [opts]
 * @param {boolean} [opts.crash=false] - if true, a require failure PROPAGATES
 *   (used for canonical-install core gates whose absence means a broken install).
 *   If false, a require failure resolves to `null` and `onError` is invoked once.
 * @param {(err: Error) => void} [opts.onError] - called once on require failure (crash:false only)
 * @returns {() => (object|null)} getter
 */
function lazyModule(modPath, opts = {}) {
  const { crash = false, onError } = opts;
  let cached = null;
  let loaded = false;
  return function get() {
    if (!loaded) {
      loaded = true;
      try {
        cached = require(modPath);
      } catch (err) {
        if (crash) {
          // Reset so a transient failure can be retried, then propagate —
          // preserves the prior "crash on broken install" semantics, deferred
          // to first call instead of at loadGateDeps() time.
          loaded = false;
          throw err;
        }
        cached = null;
        if (onError) {
          try { onError(err); } catch (_e) { /* never let logging break the gate */ }
        }
      }
    }
    return cached;
  };
}

/**
 * Wrap a single exported gate function behind a lazy module getter.
 * For optional gates (crash:false), falls back to `shim` when the module is
 * absent or doesn't export `name`.
 */
function lazyGateFn(get, name, shim) {
  return (...args) => {
    const mod = get();
    if (mod && typeof mod[name] === 'function') {
      return mod[name](...args);
    }
    return shim(...args);
  };
}

const _debug = (msg) => { if (process.env.DEBUG) console.error(msg); };

/**
 * Build the dependency object expected by runPreToolGates(input, deps).
 *
 * Each gate is loaded lazily inside its own memoized getter so a missing module
 * in an older install fails open (no-op shim) rather than crashing the entire
 * PreToolUse pipeline, AND the module is only parsed when its gate is actually
 * dispatched. Behavior preserved verbatim from the prior eager implementation.
 *
 * @returns {Object} deps shape consumed by pre-tool-orchestrator
 */
function loadGateDeps() {
  // --- Always-required core gates (canonical install; absence = broken install,
  // so these propagate on first call rather than shimming). ---
  const _scope = lazyModule('./scope-gate', { crash: true });
  const _component = lazyModule('./component-check', { crash: true });
  const _todowrite = lazyModule('./todowrite-gate', { crash: true });
  const _routing = lazyModule('./routing-gate', { crash: true });
  const _phase = lazyModule('./phase-gate', { crash: true });
  const _commitLog = lazyModule('./commit-log-gate', { crash: true });

  const checkScopeGate = (...a) => _scope().checkScopeGate(...a);
  const checkComponentReuse = (...a) => _component().checkComponentReuse(...a);
  const checkTodoWriteGate = (...a) => _todowrite().checkTodoWriteGate(...a);
  const checkRoutingGate = (...a) => _routing().checkRoutingGate(...a);
  const clearRoutingPending = (...a) => _routing().clearRoutingPending(...a);
  const hasActiveTask = (...a) => _routing().hasActiveTask(...a);
  const checkPhaseGate = (...a) => _phase().checkPhaseGate(...a);
  const checkCommitLogGate = (...a) => _commitLog().checkCommitLogGate(...a);

  // --- Defensive optional gates — fail-open with shim if module absent. ---
  const _phaseRead = lazyModule('./phase-read-gate', {
    onError: (e) => _debug(`[Hook] Phase-read gate not loaded: ${e.message}`),
  });
  const recordPhaseRead = lazyGateFn(_phaseRead, 'recordPhaseRead', () => {});
  const checkPhaseReadGate = lazyGateFn(_phaseRead, 'checkPhaseReadGate', _phaseNoop);
  const clearPhaseReads = lazyGateFn(_phaseRead, 'clearPhaseReads', () => {});

  // wf-037f8d66: Architect-required gate (mechanical Layer 2 enforcement)
  const _architect = lazyModule('./architect-required-gate', {
    onError: (e) => _debug(`[Hook] Architect-required gate not loaded: ${e.message}`),
  });
  const checkArchitectRequired = lazyGateFn(_architect, 'checkArchitectRequired', () => ({ blocked: false }));

  // research-evidence-gate: CL-004 — a load failure for a gate file that SHOULD
  // be present is a deployment issue worth surfacing without DEBUG. Silently
  // shimming masks broken installs; stderr makes the operator aware. Fail-open
  // shims keep the pipeline working.
  const _research = lazyModule('./research-evidence-gate', {
    onError: (e) => console.error(`[Hook] WARNING: Research-evidence gate failed to load — gate is disabled. ${e.message}`),
  });
  const recordEvidenceRead = lazyGateFn(_research, 'recordEvidenceRead', () => {});
  const checkSpecWriteGate = lazyGateFn(_research, 'checkSpecWriteGate', _phaseNoop);
  const clearResearchEvidence = lazyGateFn(_research, 'clearResearchEvidence', () => {});

  const _deploy = lazyModule('./deploy-gate', {
    onError: (e) => _debug(`[Hook] Deploy gate not loaded: ${e.message}`),
  });
  const checkDeployGate = lazyGateFn(_deploy, 'checkDeployGate', _noop);
  const checkWriteBlock = lazyGateFn(_deploy, 'checkWriteBlock', _noop);

  const _strike = lazyModule('./strike-gate', {
    onError: (e) => _debug(`[Hook] Strike gate not loaded: ${e.message}`),
  });
  const checkStrikeGate = lazyGateFn(_strike, 'checkStrikeGate', _noop);

  const _bugfix = lazyModule('./bugfix-scope-gate', {
    onError: (e) => _debug(`[Hook] Bugfix scope gate not loaded: ${e.message}`),
  });
  const checkBugfixScope = lazyGateFn(_bugfix, 'checkBugfixScope', _noop);

  const _scopeMut = lazyModule('./scope-mutation-gate', {
    onError: (e) => _debug(`[Hook] Scope mutation gate not loaded: ${e.message}`),
  });
  const checkScopeMutation = lazyGateFn(_scopeMut, 'checkScopeMutation', _noop);

  const _gitSafety = lazyModule('./git-safety-gate', {
    onError: (e) => _debug(`[Hook] Git safety gate not loaded: ${e.message}`),
  });
  const checkGitSafety = lazyGateFn(_gitSafety, 'checkGitSafety', _noop);

  const _managerBoundary = lazyModule('./manager-boundary-gate', {
    onError: (e) => _debug(`[Hook] Manager boundary gate not loaded: ${e.message}`),
  });
  const checkManagerBoundary = lazyGateFn(_managerBoundary, 'checkManagerBoundary', _noop);

  const _workerBoundary = lazyModule('./worker-boundary-gate', {
    onError: (e) => _debug(`[Hook] Worker boundary gate not loaded: ${e.message}`),
  });
  const checkWorkerBoundary = lazyGateFn(_workerBoundary, 'checkWorkerBoundary', _noop);
  const checkPathDiscipline = lazyGateFn(_workerBoundary, 'checkPathDiscipline', _noop);

  // Long-input-pending gate (P11.6 mechanical layer). Consults the marker
  // file written by user-prompt-submit when a long-form prompt arrives
  // without a source-link, and blocks mutating tools until the AI either
  // runs /wogi-extract-review or dismisses the marker explicitly.
  const _longInput = lazyModule('./long-input-enforcement', {
    onError: (e) => _debug(`[Hook] Long-input-pending gate not loaded: ${e.message}`),
  });
  const checkLongInputPendingGate = lazyGateFn(_longInput, 'checkLongInputPendingGate', _noop);

  // wf-e399bd8d — Self-adversary gate. Intercepts AskUserQuestion for
  // implementation-class questions, requires the AI to run a self-adversary
  // loop first. Fail-open via _noop if module fails to load.
  const _selfAdversary = lazyModule('./self-adversary-gate', {
    onError: (e) => _debug(`[Hook] Self-adversary gate not loaded: ${e.message}`),
  });
  const checkSelfAdversaryGate = lazyGateFn(_selfAdversary, 'checkSelfAdversaryGate', _noop);

  // --- CLI-agnostic helpers (not gates per se but consumed by the orchestrator).
  // flow-utils / flow-hook-status / flow-durable-session are loaded lazily too;
  // markSkillPending in particular is only called when a /wogi-* Skill is seen. ---
  const _durable = lazyModule('./../../flow-durable-session', { crash: true });
  const _utils = lazyModule('./../../flow-utils', { crash: true });
  const _hookStatus = lazyModule('./../../flow-hook-status', { crash: true });

  const markSkillPending = (...a) => _durable().markSkillPending(...a);
  const getConfig = (...a) => _utils().getConfig(...a);
  const readHookStatus = (...a) => _hookStatus().readHookStatus(...a);

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
    checkArchitectRequired, // wf-037f8d66
    recordEvidenceRead, checkSpecWriteGate, clearResearchEvidence,
    checkDeployGate, checkWriteBlock,
    checkStrikeGate, checkBugfixScope, checkScopeMutation,
    checkGitSafety, checkManagerBoundary, checkWorkerBoundary, checkPathDiscipline,
    checkLongInputPendingGate,
    checkSelfAdversaryGate,
    // Side-effect helpers
    markSkillPending,
    // Config + runtime
    getConfig, readHookStatus, getStrictAdherence
  };
}

module.exports = {
  loadGateDeps
};
