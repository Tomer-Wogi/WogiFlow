'use strict';

/**
 * Tests for the worktree gate-evasion fix + circumvention guidance
 * (wf-e5e57361 / RC2 + RC3-adjacent guidance).
 *
 * RC2: the phase gates must resolve the workflow phase from the CANONICAL
 * (main-repo) state dir, not cwd — so a git worktree (which lacks the gitignored
 * workflow-phase.json) cannot present an "ungated idle" context. When phase is
 * unresolvable inside a worktree while a task is in-progress, the gate must fail
 * CLOSED, not open.
 *
 * AC3: shipped worker guidance must explicitly forbid gate circumvention.
 *
 * Run: NODE_ENV=test node --test tests/flow-worktree-gate-evasion.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};

const flowPaths = require('../scripts/flow-paths');
const prg = require('../scripts/hooks/core/phase-read-gate');

let TMP;
function makeState({ withPhase = null, inProgress = true } = {}) {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-wt-'));
  const state = path.join(TMP, '.workflow', 'state');
  fs.mkdirSync(state, { recursive: true });
  const ready = inProgress ? { inProgress: [{ id: 'wf-deadbeef', title: 'T' }] } : { inProgress: [] };
  fs.writeFileSync(path.join(state, 'ready.json'), JSON.stringify(ready));
  if (withPhase) {
    fs.writeFileSync(path.join(state, 'workflow-phase.json'), JSON.stringify({ phase: withPhase, taskId: 'wf-deadbeef' }));
  }
  return state;
}
afterEach(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_err) {} });

const enabledConfig = { hooks: { rules: { phaseReadGate: { enabled: true } } } };

describe('flow-paths canonical resolution (RC2)', () => {
  it('getCanonicalStateDir() resolves to an existing .workflow/state dir', () => {
    const dir = flowPaths.getCanonicalStateDir();
    assert.ok(dir.endsWith(path.join('.workflow', 'state')), `unexpected: ${dir}`);
    assert.ok(fs.existsSync(dir), 'canonical state dir should exist');
  });

  it('in the main working tree, isLinkedWorktree() is false', () => {
    assert.equal(flowPaths.isLinkedWorktree(), false);
  });

  it('isLinkedWorktree() honors the WOGI_FORCE_WORKTREE test seam', () => {
    const prev = process.env.WOGI_FORCE_WORKTREE;
    process.env.WOGI_FORCE_WORKTREE = '1';
    try {
      assert.equal(flowPaths.isLinkedWorktree(), true);
    } finally {
      if (prev === undefined) delete process.env.WOGI_FORCE_WORKTREE; else process.env.WOGI_FORCE_WORKTREE = prev;
    }
  });
});

describe('phase-read-gate worktree fail-closed (RC2)', () => {
  it('BLOCKS Edit inside a worktree of an in-progress task when phase is unresolvable', () => {
    const state = makeState({ withPhase: null, inProgress: true }); // no phase file (worktree shape)
    const r = prg.checkPhaseReadGate('Edit', enabledConfig, {
      stateDir: state,
      isLinkedWorktree: () => true,
      hasInProgressTask: () => true
    });
    assert.equal(r.blocked, true);
    assert.match(r.message, /worktree/i);
    assert.match(r.message, /NOT evadable/i);
  });

  it('does NOT block when NOT in a worktree (normal main-tree fail-open)', () => {
    const state = makeState({ withPhase: null, inProgress: true });
    const r = prg.checkPhaseReadGate('Edit', enabledConfig, {
      stateDir: state,
      isLinkedWorktree: () => false,
      hasInProgressTask: () => true
    });
    assert.equal(r.blocked, false);
  });

  it('does NOT block in a worktree when no task is in-progress', () => {
    const state = makeState({ withPhase: null, inProgress: false });
    const r = prg.checkPhaseReadGate('Edit', enabledConfig, {
      stateDir: state,
      isLinkedWorktree: () => true,
      hasInProgressTask: () => false
    });
    assert.equal(r.blocked, false);
  });

  it('resolves the canonical phase from the injected state dir (worktree sees the SAME phase as main)', () => {
    // With a resolvable phase, the worktree behaves exactly like the main tree:
    // coding phase + the phase doc not yet read → normal block (read the doc),
    // NOT the fail-closed worktree message.
    const state = makeState({ withPhase: 'coding', inProgress: true });
    const r = prg.checkPhaseReadGate('Edit', enabledConfig, {
      stateDir: state,
      isLinkedWorktree: () => true,
      hasInProgressTask: () => true
    });
    assert.equal(r.blocked, true);
    assert.match(r.message, /requires reading the phase instruction file/i);
  });

  it('hasCanonicalInProgressTask reads ready.json from the given state dir', () => {
    const state = makeState({ inProgress: true });
    assert.equal(prg.hasCanonicalInProgressTask(state), true);
    const empty = makeState({ inProgress: false });
    assert.equal(prg.hasCanonicalInProgressTask(empty), false);
  });
});

describe('shipped guidance forbids gate circumvention (AC3)', () => {
  const repoRoot = path.resolve(__dirname, '..');

  it('the live worker channel instructions forbid worktree/marker circumvention', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'lib', 'workspace-channel-server.js'), 'utf-8');
    assert.match(src, /GATE CIRCUMVENTION IS PROHIBITED/);
    assert.match(src, /Do NOT create a git worktree/);
    assert.match(src, /NEVER IDLE WHILE A TASK IS IN-PROGRESS/);
  });

  it('the stall directive forbids circumvention and offers proceed-or-escalate', () => {
    const gate = require('../scripts/hooks/core/worker-continuation-gate');
    const directive = gate.buildStallDirective({
      taskId: 'wf-deadbeef', phase: 'spec_review', remaining: 0, total: 0,
      attempt: 1, k: 4, autonomous: true, env: { WOGI_MANAGER_PORT: '8800', WOGI_REPO_NAME: 'frontend' }
    });
    assert.match(directive, /Do NOT create a git worktree/);
    assert.match(directive, /## QUESTION:/);
    assert.match(directive, /PRE-APPROVED/);
  });

  it('the methodology-rules partial ships the never-idle + no-circumvention contract', () => {
    const hbs = fs.readFileSync(path.join(repoRoot, '.workflow', 'templates', 'partials', 'methodology-rules.hbs'), 'utf-8');
    assert.match(hbs, /Never idle while in-progress/);
    assert.match(hbs, /Gate circumvention is PROHIBITED/);
  });

  it('the worker-tool-first-turn contract doc ships the prohibition', () => {
    const doc = fs.readFileSync(path.join(repoRoot, '.claude', 'rules', '_internal', 'worker-tool-first-turn.md'), 'utf-8');
    assert.match(doc, /gate circumvention is prohibited/i);
    assert.match(doc, /getCanonicalStateDir/);
  });
});
