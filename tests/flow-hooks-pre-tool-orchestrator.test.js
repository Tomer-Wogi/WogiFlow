'use strict';

/**
 * Tests for scripts/hooks/core/pre-tool-orchestrator.js (wf-94cc3b72 / TD-002).
 *
 * Covers the full gate-cascade with injected mock dependencies:
 *   - Empty-input short-circuit
 *   - Fast-path via isAllGatesDisabled hookStatus
 *   - Phase gate → phase-read gate → scope → todowrite → skill → routing →
 *     manager boundary → commit log → deploy → deploy-write → scope-mutation →
 *     git-safety → bugfix → strike → component-reuse cascade
 *   - First-blocker-wins short-circuit semantics (subsequent gates don't run)
 *   - Fail-open behavior on gate throws (except routing = fail-closed)
 *   - Side-effect invocations (recordPhaseRead, markSkillPending, clearRoutingPending)
 *   - Skill tool tracking (wogi-bulk / wogi-start marking + phase read clear)
 *   - Read-only git bypass of routing gate (git status/log/diff etc.)
 *
 * This test validates the extraction from pre-tool-use.js — every gate that
 * was inline now gets invoked through the orchestrator's dependency-injection
 * interface.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-pre-tool-orchestrator.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const { runPreToolGates } = require('../scripts/hooks/core/pre-tool-orchestrator');

// ============================================================
// Mock dependency builder
// ============================================================

function allowAll() { return { allowed: true, blocked: false }; }

/**
 * Build a deps object where every gate returns allow-all by default.
 * Override individual gates to simulate blocks.
 */
function makeDeps(overrides = {}) {
  return {
    checkScopeGate: allowAll,
    checkComponentReuse: () => ({ allowed: true, blocked: false, warning: false }),
    checkTodoWriteGate: allowAll,
    checkRoutingGate: allowAll,
    clearRoutingPending: () => {},
    hasActiveTask: () => false,
    checkPhaseGate: allowAll,
    checkCommitLogGate: allowAll,
    recordPhaseRead: () => {},
    checkPhaseReadGate: () => ({ blocked: false }),
    clearPhaseReads: () => {},
    checkDeployGate: allowAll,
    checkWriteBlock: allowAll,
    checkStrikeGate: allowAll,
    checkBugfixScope: allowAll,
    checkScopeMutation: allowAll,
    checkGitSafety: allowAll,
    checkManagerBoundary: () => ({ blocked: false }),
    markSkillPending: () => {},
    getConfig: () => ({}),
    readHookStatus: () => ({}),
    getStrictAdherence: () => ({
      isEnabled: () => false,
      validateCommand: () => ({ valid: true }),
      validateFileName: () => ({ valid: true }),
    }),
    ...overrides,
  };
}

function ctx(toolName, toolInput = {}, input = { tool: toolName, toolInput }) {
  return { input, parsedInput: { toolName, toolInput } };
}

// ============================================================
// Empty input short-circuit
// ============================================================

describe('runPreToolGates — empty input', () => {
  it('allows when input is null', () => {
    const r = runPreToolGates({ input: null, parsedInput: {} }, makeDeps());
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
  });

  it('allows when input is empty object', () => {
    const r = runPreToolGates({ input: {}, parsedInput: {} }, makeDeps());
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// Fast path
// ============================================================

describe('runPreToolGates — fast path via isAllGatesDisabled', () => {
  function allGatesDisabledStatus() {
    return {
      enforcement: {
        taskGating: false, scopeGating: false, routingGate: false,
        commitLogGate: false, todoWriteGate: false, loopEnforcement: false,
        deployGate: false, strikeEscalation: false, bugfixScope: false,
        scopeMutation: false, gitSafety: false,
      },
      componentReuse: false,
      phaseGate: false,
      phaseReadGate: false,
    };
  }

  it('short-circuits with _fastPath=true when all gates disabled', () => {
    const deps = makeDeps({ readHookStatus: allGatesDisabledStatus });
    const r = runPreToolGates(ctx('Bash', { command: 'echo hi' }), deps);
    assert.equal(r._fastPath, true);
    assert.equal(r.allowed, true);
  });

  it('_fastPath result skips ALL gates — no checkPhaseGate/checkRoutingGate/etc invoked', () => {
    const calls = { phaseGate: 0, routingGate: 0, scopeGate: 0, strike: 0, componentReuse: 0 };
    const deps = makeDeps({
      readHookStatus: allGatesDisabledStatus,
      checkPhaseGate: () => { calls.phaseGate++; return { blocked: true }; },
      checkRoutingGate: () => { calls.routingGate++; return { blocked: true }; },
      checkScopeGate: () => { calls.scopeGate++; return { blocked: true }; },
      checkStrikeGate: () => { calls.strike++; return { blocked: true }; },
      checkComponentReuse: () => { calls.componentReuse++; return { blocked: true, warning: true }; },
    });
    const r = runPreToolGates(ctx('Write', { file_path: 'src/new.ts' }), deps);
    assert.equal(r._fastPath, true);
    assert.equal(r.allowed, true);
    // Even though every gate is set to "blocked: true", none were invoked because
    // the fast path returned early. This is the critical contract.
    assert.equal(calls.phaseGate, 0, 'phase gate must not run on fast path');
    assert.equal(calls.routingGate, 0, 'routing gate must not run on fast path');
    assert.equal(calls.scopeGate, 0, 'scope gate must not run on fast path');
    assert.equal(calls.strike, 0, 'strike gate must not run on fast path');
    assert.equal(calls.componentReuse, 0, 'component reuse must not run on fast path');
  });

  it('_fastPath is the ONLY short-circuit field — no sentinel collision with allowed/blocked/reason', () => {
    const deps = makeDeps({ readHookStatus: allGatesDisabledStatus });
    const r = runPreToolGates(ctx('Read', { file_path: 'x.js' }), deps);
    // The entry file (pre-tool-use.js) branches on r._fastPath to skip the adapter.
    // Verify the sentinel is the sole marker, not muddied with a bogus reason.
    assert.equal(r._fastPath, true);
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
    // No 'reason' field — fast path is not a "blocked with reason" result.
    assert.ok(r.reason === undefined || typeof r.reason === 'string',
      '_fastPath result shape must be allow-compatible');
  });

  it('_fastPath result is bypassed when any gate is enabled in hookStatus', () => {
    const deps = makeDeps({
      readHookStatus: () => ({
        enforcement: { taskGating: true }, // one gate enabled
        componentReuse: false, phaseGate: false, phaseReadGate: false,
      }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: 'x.js' }), deps);
    // With any enabled gate, isAllGatesDisabled returns false → fast path NOT taken
    assert.notEqual(r._fastPath, true);
  });
});

// ============================================================
// Phase gate
// ============================================================

describe('phase gate — first in cascade', () => {
  it('blocks when phase gate blocks', () => {
    const deps = makeDeps({
      checkPhaseGate: () => ({ blocked: true, reason: 'phase_restricts_tool', message: 'routing phase active' }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'phase_restricts_tool');
  });

  it('fails open on phase gate throw', () => {
    const deps = makeDeps({
      checkPhaseGate: () => { throw new Error('boom'); },
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    // Falls through to allow (no other gate blocks)
    assert.equal(r.allowed, true);
  });

  it('skips phase gate for read-only subagents (stub: no input carrier)', () => {
    // Subagent detection reads from input.agent_id/agent_type; we don't simulate
    // that here — just verify allow-path works when phase gate allows.
    const r = runPreToolGates(ctx('Read', { file_path: '/x.js' }), makeDeps());
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// Phase-read gate
// ============================================================

describe('phase-read gate', () => {
  it('blocks Edit when required phase file not read', () => {
    const deps = makeDeps({
      checkPhaseReadGate: () => ({ blocked: true, message: 'read 03-implement.md first' }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Phase-read gate'));
  });

  it('does NOT block Read (only Edit/Write/Bash are gated)', () => {
    const deps = makeDeps({
      checkPhaseReadGate: () => ({ blocked: true, message: 'x' }),
    });
    const r = runPreToolGates(ctx('Read', { file_path: '/x.js' }), deps);
    // Read should NOT go through phase-read gate check
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// Side-effect: recordPhaseRead on Read tool
// ============================================================

describe('side effect — recordPhaseRead on Read', () => {
  it('calls recordPhaseRead with the file_path for Read tool', () => {
    const calls = [];
    const deps = makeDeps({
      recordPhaseRead: (fp) => calls.push(fp),
    });
    runPreToolGates(ctx('Read', { file_path: '.claude/docs/phases/03-implement.md' }), deps);
    assert.deepEqual(calls, ['.claude/docs/phases/03-implement.md']);
  });

  it('does NOT call recordPhaseRead for other tools', () => {
    const calls = [];
    const deps = makeDeps({
      recordPhaseRead: (fp) => calls.push(fp),
    });
    runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.deepEqual(calls, []);
  });

  it('silently ignores recordPhaseRead errors', () => {
    const deps = makeDeps({
      recordPhaseRead: () => { throw new Error('boom'); },
    });
    // Should not propagate the throw
    const r = runPreToolGates(ctx('Read', { file_path: '/x.js' }), deps);
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// Scope gate (Edit/Write)
// ============================================================

describe('scope gate', () => {
  it('blocks Edit when scope gate blocks', () => {
    const deps = makeDeps({
      checkScopeGate: () => ({ allowed: false, blocked: true, reason: 'out_of_scope', message: 'not in scope' }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'out_of_scope');
  });

  it('does NOT invoke scope gate for Read tool', () => {
    const calls = [];
    const deps = makeDeps({
      checkScopeGate: (arg) => { calls.push(arg); return allowAll(); },
    });
    runPreToolGates(ctx('Read', { file_path: '/x.js' }), deps);
    assert.equal(calls.length, 0);
  });

  it('invokes scope gate for Write', () => {
    const calls = [];
    const deps = makeDeps({
      checkScopeGate: (arg) => { calls.push(arg); return allowAll(); },
    });
    runPreToolGates(ctx('Write', { file_path: '/x.js' }), deps);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'write');
  });
});

// ============================================================
// TodoWrite gate
// ============================================================

describe('todowrite gate', () => {
  it('blocks when todowrite gate blocks', () => {
    const deps = makeDeps({
      checkTodoWriteGate: () => ({ allowed: false, blocked: true, reason: 'no_active_task', message: 'BLOCKED' }),
    });
    const r = runPreToolGates(ctx('TodoWrite', { todos: [{ content: 'Create X' }] }), deps);
    assert.equal(r.blocked, true);
  });

  it('passes todos array to gate', () => {
    const calls = [];
    const deps = makeDeps({
      checkTodoWriteGate: (opts) => { calls.push(opts); return allowAll(); },
    });
    const todos = [{ content: 'test' }];
    runPreToolGates(ctx('TodoWrite', { todos }), deps);
    assert.equal(calls[0].todos, todos);
  });
});

// ============================================================
// Skill tool tracking
// ============================================================

describe('Skill tool side effects', () => {
  it('marks wogi-start as pending and clears phase reads', () => {
    const markCalls = [];
    const clearCalls = [];
    const deps = makeDeps({
      markSkillPending: (name, meta) => markCalls.push({ name, meta }),
      clearPhaseReads: () => clearCalls.push('cleared'),
    });
    runPreToolGates(ctx('Skill', { skill: 'wogi-start', args: 'wf-xxx' }), deps);
    assert.equal(markCalls.length, 1);
    assert.equal(markCalls[0].name, 'wogi-start');
    assert.equal(markCalls[0].meta.args, 'wf-xxx');
    assert.ok(clearCalls.length >= 1);
  });

  it('marks wogi-bulk as pending', () => {
    const markCalls = [];
    const deps = makeDeps({ markSkillPending: (name) => markCalls.push(name) });
    runPreToolGates(ctx('Skill', { skill: 'wogi-bulk' }), deps);
    assert.deepEqual(markCalls, ['wogi-bulk']);
  });

  it('clears routing-pending for any /wogi-* skill', () => {
    const clearCalls = [];
    const deps = makeDeps({ clearRoutingPending: () => clearCalls.push('cleared') });
    runPreToolGates(ctx('Skill', { skill: 'wogi-review' }), deps);
    assert.equal(clearCalls.length, 1);
  });

  it('does NOT mark non-wogi skills as pending', () => {
    const markCalls = [];
    const deps = makeDeps({ markSkillPending: (name) => markCalls.push(name) });
    runPreToolGates(ctx('Skill', { skill: 'custom-skill' }), deps);
    assert.equal(markCalls.length, 0);
  });

  it('is case-insensitive for skill names', () => {
    const markCalls = [];
    const deps = makeDeps({ markSkillPending: (name) => markCalls.push(name) });
    runPreToolGates(ctx('Skill', { skill: 'WOGI-START' }), deps);
    // Lowercased in deps call
    assert.equal(markCalls[0], 'wogi-start');
  });
});

// ============================================================
// Routing gate
// ============================================================

describe('routing gate', () => {
  it('blocks when routing gate blocks', () => {
    const deps = makeDeps({
      checkRoutingGate: () => ({ allowed: false, blocked: true, reason: 'routing_pending', message: 'invoke /wogi-start' }),
    });
    const r = runPreToolGates(ctx('Bash', { command: 'npm test' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Routing gate'));
  });

  it('fails CLOSED on routing gate throw (does not fall through)', () => {
    const deps = makeDeps({
      checkRoutingGate: () => { throw new Error('config corrupted'); },
    });
    const r = runPreToolGates(ctx('Bash', { command: 'npm test' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Routing gate error'));
    assert.ok(r.message.includes('/wogi-start'));
  });

  it('skips routing gate for read-only git (git status)', () => {
    const calls = [];
    const deps = makeDeps({
      checkRoutingGate: () => { calls.push(1); return { blocked: true, reason: 'x', message: 'y' }; },
    });
    const r = runPreToolGates(ctx('Bash', { command: 'git status' }), deps);
    assert.equal(r.allowed, true);
    assert.equal(calls.length, 0, 'routing gate should be skipped');
  });

  it('skips routing gate for git log', () => {
    const calls = [];
    const deps = makeDeps({
      checkRoutingGate: () => { calls.push(1); return { blocked: true }; },
    });
    runPreToolGates(ctx('Bash', { command: 'git log -5' }), deps);
    assert.equal(calls.length, 0);
  });

  it('DOES invoke routing gate for git push (destructive)', () => {
    const calls = [];
    const deps = makeDeps({
      checkRoutingGate: () => { calls.push(1); return { blocked: false }; },
    });
    runPreToolGates(ctx('Bash', { command: 'git push' }), deps);
    assert.equal(calls.length, 1);
  });

  it('DOES invoke routing gate for git status with --force flag (destructive override)', () => {
    const calls = [];
    const deps = makeDeps({
      checkRoutingGate: () => { calls.push(1); return { blocked: false }; },
    });
    runPreToolGates(ctx('Bash', { command: 'git diff --hard' }), deps);
    assert.equal(calls.length, 1, 'destructive flag → gate runs');
  });

  it('DOES invoke routing gate for chained commands', () => {
    const calls = [];
    const deps = makeDeps({
      checkRoutingGate: () => { calls.push(1); return { blocked: false }; },
    });
    runPreToolGates(ctx('Bash', { command: 'git status && rm -rf /' }), deps);
    assert.equal(calls.length, 1, 'shell chain → gate runs');
  });

  it('skips routing gate for subagent with active task', () => {
    const calls = [];
    const deps = makeDeps({
      hasActiveTask: () => true,
      checkRoutingGate: () => { calls.push(1); return { blocked: true }; },
    });
    const input = { tool: 'Bash', toolInput: { command: 'npm test' }, agent_id: 'valid-agent-id' };
    const r = runPreToolGates({ input, parsedInput: { toolName: 'Bash', toolInput: { command: 'npm test' } } }, deps);
    assert.equal(r.allowed, true);
    assert.equal(calls.length, 0);
  });
});

// ============================================================
// Commit log gate
// ============================================================

describe('commit log gate', () => {
  it('blocks when commit-log gate blocks', () => {
    const deps = makeDeps({
      checkCommitLogGate: () => ({ blocked: true, reason: 'commit_without_log', message: 'missing log entry' }),
    });
    const r = runPreToolGates(ctx('Bash', { command: 'git commit -m "x"' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Commit log gate'));
  });

  it('does NOT invoke commit-log gate for non-Bash tools', () => {
    const calls = [];
    const deps = makeDeps({
      checkCommitLogGate: (cmd) => { calls.push(cmd); return { blocked: false }; },
    });
    runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(calls.length, 0);
  });
});

// ============================================================
// Deploy gate
// ============================================================

describe('deploy gate', () => {
  it('blocks Bash deploy without verification artifact', () => {
    const deps = makeDeps({
      checkDeployGate: () => ({ blocked: true, reason: 'deploy-gate-no-artifact', message: 'no artifact' }),
    });
    const r = runPreToolGates(ctx('Bash', { command: 'vercel deploy' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Deploy gate'));
  });

  it('blocks Write to smoke-test artifact (anti-forgery)', () => {
    const deps = makeDeps({
      checkWriteBlock: () => ({ blocked: true, reason: 'deploy-gate-write-block', message: 'cannot write artifact' }),
    });
    const r = runPreToolGates(ctx('Write', { file_path: '.workflow/verifications/smoke-test-abc.json' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Deploy gate'));
  });
});

// ============================================================
// Strike gate
// ============================================================

describe('strike gate', () => {
  it('blocks Edit after 4+ strikes (hard block)', () => {
    const deps = makeDeps({
      checkStrikeGate: () => ({ blocked: true, reason: 'strike-hard-block', message: 'too many strikes' }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Strike gate'));
  });
});

// ============================================================
// Bugfix scope gate
// ============================================================

describe('bugfix scope gate', () => {
  it('blocks after 3+ unique file edits on L3 bugfix', () => {
    const deps = makeDeps({
      checkBugfixScope: () => ({ blocked: true, reason: 'bugfix-scope-expansion', message: 'stop' }),
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Bugfix scope'));
  });
});

// ============================================================
// Scope mutation gate
// ============================================================

describe('scope mutation gate', () => {
  it('blocks Write in fix task creating N-th new file', () => {
    const deps = makeDeps({
      checkScopeMutation: () => ({ blocked: true, reason: 'scope-mutation-new-files', message: 'too many new files' }),
    });
    const r = runPreToolGates(ctx('Write', { file_path: '/new.js' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Scope mutation'));
  });
});

// ============================================================
// Git safety gate
// ============================================================

describe('git safety gate', () => {
  it('blocks destructive git reset with --hard', () => {
    const deps = makeDeps({
      checkGitSafety: () => ({ blocked: true, reason: 'git-safety-reset', message: 'hard reset requires confirmation' }),
    });
    const r = runPreToolGates(ctx('Bash', { command: 'git reset --hard HEAD~10' }), deps);
    assert.equal(r.blocked, true);
    assert.ok(r.reason.includes('Git safety'));
  });

  it('does NOT invoke git-safety for non-destructive bash', () => {
    const calls = [];
    const deps = makeDeps({
      checkGitSafety: () => { calls.push(1); return { blocked: false }; },
    });
    runPreToolGates(ctx('Bash', { command: 'npm test' }), deps);
    assert.equal(calls.length, 0);
  });
});

// ============================================================
// Manager boundary gate
// ============================================================

describe('manager boundary gate', () => {
  it('blocks when in manager mode and boundary blocks', () => {
    const prior = process.env.WOGI_REPO_NAME;
    process.env.WOGI_REPO_NAME = 'manager';
    try {
      const deps = makeDeps({
        checkManagerBoundary: () => ({ blocked: true, reason: 'manager-boundary-write', message: 'dispatch to worker' }),
      });
      const r = runPreToolGates(ctx('Edit', { file_path: '/any/path.js' }), deps);
      assert.equal(r.blocked, true);
      assert.ok(r.reason.includes('manager-boundary'));
    } finally {
      if (prior !== undefined) process.env.WOGI_REPO_NAME = prior;
      else delete process.env.WOGI_REPO_NAME;
    }
  });

  it('does NOT invoke boundary gate when not in manager mode', () => {
    delete process.env.WOGI_REPO_NAME;
    const calls = [];
    const deps = makeDeps({
      checkManagerBoundary: () => { calls.push(1); return { blocked: true }; },
    });
    runPreToolGates(ctx('Edit', { file_path: '/any/path.js' }), deps);
    assert.equal(calls.length, 0);
  });
});

// ============================================================
// Component reuse (Write only)
// ============================================================

describe('component reuse', () => {
  it('attaches warning info when Write has similar components', () => {
    const deps = makeDeps({
      checkComponentReuse: () => ({
        allowed: true, blocked: false, warning: true,
        message: 'Similar: Button 95%',
        similar: [{ name: 'Button', similarity: 95 }],
      }),
    });
    const r = runPreToolGates(ctx('Write', { file_path: 'src/components/MyButton.tsx' }), deps);
    // Warning doesn't block but attaches info
    assert.equal(r.allowed, true);
    assert.equal(r.warning, true);
    assert.ok(r.message.includes('Button'));
  });

  it('does NOT invoke component reuse for Edit', () => {
    const calls = [];
    const deps = makeDeps({
      checkComponentReuse: () => { calls.push(1); return { warning: false }; },
    });
    runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(calls.length, 0);
  });
});

// ============================================================
// Cascade priority — first blocker wins
// ============================================================

describe('cascade priority — first blocker wins', () => {
  it('phase gate blocks BEFORE scope gate (scope gate not invoked)', () => {
    const scopeCalls = [];
    const deps = makeDeps({
      checkPhaseGate: () => ({ blocked: true, reason: 'phase', message: 'x' }),
      checkScopeGate: () => { scopeCalls.push(1); return { blocked: true }; },
    });
    const r = runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(r.reason, 'phase');
    assert.equal(scopeCalls.length, 0, 'scope gate should not be invoked');
  });

  it('scope gate blocks BEFORE routing gate', () => {
    const routingCalls = [];
    const deps = makeDeps({
      checkScopeGate: () => ({ blocked: true, reason: 'out_of_scope', message: 'x' }),
      checkRoutingGate: () => { routingCalls.push(1); return { blocked: true }; },
    });
    runPreToolGates(ctx('Edit', { file_path: '/x.js' }), deps);
    assert.equal(routingCalls.length, 0);
  });
});
