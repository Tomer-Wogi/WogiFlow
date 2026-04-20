#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreToolUse Hook (Entry)
 *
 * Thin CLI-specific entry point. Parses input, wires dependencies, and calls
 * the shared pre-tool-orchestrator (see scripts/hooks/core/pre-tool-orchestrator.js).
 *
 * Extraction history (wf-94cc3b72 / TD-002): this file previously contained
 * the full 470-line gate cascade inline. The cascade now lives in the core
 * orchestrator so it can be unit-tested and reused by non-Claude-Code CLIs.
 *
 * v4.0: Added scope gating
 * v6.0: Added routing gate
 * v7.0: Orchestrator extraction (this file → ~70 LOC wiring layer)
 */

'use strict';

const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { checkTodoWriteGate } = require('../../core/todowrite-gate');
const { checkRoutingGate, clearRoutingPending, hasActiveTask } = require('../../core/routing-gate');
const { checkPhaseGate } = require('../../core/phase-gate');
const { checkCommitLogGate } = require('../../core/commit-log-gate');
const { runPreToolGates } = require('../../core/pre-tool-orchestrator');

// Defensive lazy-loaders for gates that may be absent in older installs.
// Fail-open (no-op shims) instead of crashing the entire PreToolUse hook.
let recordPhaseRead = () => {}, checkPhaseReadGate = () => ({ blocked: false }), clearPhaseReads = () => {};
try {
  const prg = require('../../core/phase-read-gate');
  recordPhaseRead = prg.recordPhaseRead;
  checkPhaseReadGate = prg.checkPhaseReadGate;
  clearPhaseReads = prg.clearPhaseReads;
} catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Phase-read gate not loaded: ${_err.message}`); }

let recordEvidenceRead = () => {}, checkSpecWriteGate = () => ({ blocked: false }), clearResearchEvidence = () => {};
try {
  const reg = require('../../core/research-evidence-gate');
  recordEvidenceRead = reg.recordEvidenceRead;
  checkSpecWriteGate = reg.checkSpecWriteGate;
  clearResearchEvidence = reg.clearResearchEvidence;
} catch (err) {
  // CL-004: load failure for a gate file that SHOULD be present is a
  // deployment issue worth surfacing even without DEBUG set. Silently
  // shimming masks broken installs. Preserve fail-open (shims above)
  // so the hook pipeline still works, but log to stderr so operators see it.
  console.error(`[Hook] WARNING: Research-evidence gate failed to load — gate is disabled. ${err.message}`);
}

const _noop = () => ({ allowed: true, blocked: false });
let checkDeployGate = _noop, checkWriteBlock = _noop;
try { const dg = require('../../core/deploy-gate'); checkDeployGate = dg.checkDeployGate; checkWriteBlock = dg.checkWriteBlock; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Deploy gate not loaded: ${_err.message}`); }
let checkStrikeGate = _noop;
try { checkStrikeGate = require('../../core/strike-gate').checkStrikeGate; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Strike gate not loaded: ${_err.message}`); }
let checkBugfixScope = _noop;
try { checkBugfixScope = require('../../core/bugfix-scope-gate').checkBugfixScope; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Bugfix scope gate not loaded: ${_err.message}`); }
let checkScopeMutation = _noop;
try { checkScopeMutation = require('../../core/scope-mutation-gate').checkScopeMutation; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Scope mutation gate not loaded: ${_err.message}`); }
let checkGitSafety = _noop;
try { checkGitSafety = require('../../core/git-safety-gate').checkGitSafety; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Git safety gate not loaded: ${_err.message}`); }
let checkManagerBoundary = _noop;
try { checkManagerBoundary = require('../../core/manager-boundary-gate').checkManagerBoundary; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Manager boundary gate not loaded: ${_err.message}`); }
let checkWorkerBoundary = _noop;
try { checkWorkerBoundary = require('../../core/worker-boundary-gate').checkWorkerBoundary; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Worker boundary gate not loaded: ${_err.message}`); }

const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending } = require('../../../flow-durable-session');
const { getConfig } = require('../../../flow-utils');
const { readHookStatus } = require('../../../flow-hook-status');
const { runHook } = require('../shared/hook-runner');

// Lazy-load strict adherence (avoids circular deps + startup cost).
let _strictAdherence = null;
function getStrictAdherence() {
  if (!_strictAdherence) {
    try {
      _strictAdherence = require('../../../flow-strict-adherence');
    } catch (_err) {
      _strictAdherence = { isEnabled: () => false, validateCommand: () => ({ valid: true }), validateFileName: () => ({ valid: true }) };
    }
  }
  return _strictAdherence;
}

runHook('PreToolUse', async ({ input, parsedInput }) => {
  const hookStart = process.hrtime.bigint();

  // Empty input — allow through
  if (!input || Object.keys(input).length === 0) {
    return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  }

  const deps = {
    // Gates
    checkScopeGate, checkComponentReuse, checkTodoWriteGate,
    checkRoutingGate, clearRoutingPending, hasActiveTask,
    checkPhaseGate, checkCommitLogGate,
    recordPhaseRead, checkPhaseReadGate, clearPhaseReads,
    recordEvidenceRead, checkSpecWriteGate, clearResearchEvidence,
    checkDeployGate, checkWriteBlock,
    checkStrikeGate, checkBugfixScope, checkScopeMutation,
    checkGitSafety, checkManagerBoundary, checkWorkerBoundary,
    // Side-effect helpers
    markSkillPending,
    // Config + runtime
    getConfig, readHookStatus, getStrictAdherence,
  };

  const coreResult = runPreToolGates({ input, parsedInput }, deps);

  // Fast path (no transform needed — short-circuit to allow)
  if (coreResult._fastPath) {
    if (process.env.DEBUG) {
      const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
      console.error(`[Hook] PreToolUse fast-path: ${elapsed.toFixed(1)}ms`);
    }
    return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  }

  if (coreResult.blocked) {
    const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
    return { __raw: true, ...output };
  }

  if (process.env.DEBUG) {
    const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
    console.error(`[Hook] PreToolUse latency: ${elapsed.toFixed(1)}ms`);
  }

  return coreResult;
}, { failMode: 'block' });
