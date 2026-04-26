'use strict';

/**
 * Tests for autonomous walk-away mode (Story C / wf-d712002e)
 * Sprint 1 coverage: NL trigger detection, session-state persistence,
 * decision-authority autonomous routing, question queue + dependency classifier.
 *
 * Run: node --test tests/flow-autonomous-mode.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const detector = require('../scripts/flow-autonomous-detector');
const decisionAuthority = require('../scripts/flow-decision-authority');
const queue = require('../scripts/flow-question-queue');
const sessionState = require('../scripts/flow-session-state');

describe('flow-autonomous-detector — NL trigger detection (AC1)', () => {
  it('matches "go until you finish"', () => {
    const r = detector.detect('OK go until you finish, walk away');
    assert.equal(r.autonomous, true);
    assert.equal(r.source, 'phrase-match');
    assert.equal(r.trigger, 'go until you finish');
  });

  it('is case-insensitive', () => {
    assert.equal(detector.detect('GO UNTIL DONE').autonomous, true);
    assert.equal(detector.detect('Autonomous Mode please').autonomous, true);
  });

  it('does NOT match unrelated implementation imperatives', () => {
    assert.equal(detector.detect('add a button').autonomous, false);
    assert.equal(detector.detect('fix the bug in login').autonomous, false);
  });

  it('detects stop/pause phrases', () => {
    assert.equal(detector.detectStop('stop'), true);
    assert.equal(detector.detectStop('pause'), true);
    assert.equal(detector.detectStop('stop the run'), true);
    assert.equal(detector.detectStop('continue'), false);
  });

  it('async detect fails CLOSED on classifier error', async () => {
    const r = await detector.detectAsync('do all of these things plz', {
      aiClassifier: () => { throw new Error('classifier down'); }
    });
    assert.equal(r.autonomous, false);
    assert.equal(r.source, 'classifier-error');
  });

  it('async detect fails CLOSED on classifier returning bad shape', async () => {
    const r = await detector.detectAsync('mystery phrase', {
      aiClassifier: async () => ({ wrong: 'shape' })
    });
    assert.equal(r.autonomous, false);
  });

  it('async detect honors classifier when confidence ≥ threshold', async () => {
    const r = await detector.detectAsync('please run through everything autopilot', {
      aiClassifier: async () => ({ autonomous: true, confidence: 0.9 }),
      minConfidence: 0.7
    });
    assert.equal(r.autonomous, true);
    assert.equal(r.source, 'classifier');
  });

  it('async detect rejects classifier when below threshold', async () => {
    const r = await detector.detectAsync('vague request', {
      aiClassifier: async () => ({ autonomous: true, confidence: 0.5 }),
      minConfidence: 0.7
    });
    assert.equal(r.autonomous, false);
  });
});

describe('flow-session-state — autonomousMode disk persistence (AC2)', () => {
  beforeEach(() => {
    sessionState._resetAutonomousCacheForTests();
    if (sessionState.isAutonomousActive()) sessionState.deactivateAutonomousMode();
  });

  it('activate writes to session-state.json', () => {
    const r = sessionState.activateAutonomousMode({ trigger: 'go until done' });
    assert.equal(r.active, true);
    assert.match(r.runId, /^auto-/);
    assert.equal(sessionState.isAutonomousActive(), true);
    sessionState.deactivateAutonomousMode();
  });

  it('rehydrate from disk after cache invalidation simulates SIGTERM cycle', () => {
    sessionState.activateAutonomousMode({ trigger: 'go until done' });
    sessionState._resetAutonomousCacheForTests();
    const r = sessionState.rehydrateAutonomousFromDisk();
    assert.equal(r.hydrated, true);
    assert.equal(sessionState.isAutonomousActive(), true);
    sessionState.deactivateAutonomousMode();
  });

  it('staleness check clears expired autonomous flag', () => {
    sessionState.activateAutonomousMode({ trigger: 'go until done' });
    const state = sessionState.loadSessionState();
    state.autonomousMode.activatedAt = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    sessionState.saveSessionState({ autonomousMode: state.autonomousMode });
    sessionState._resetAutonomousCacheForTests();
    const r = sessionState.rehydrateAutonomousFromDisk();
    assert.equal(r.hydrated, false);
    assert.equal(r.reason, 'stale');
    assert.equal(sessionState.isAutonomousActive(), false);
  });

  it('deactivate clears both disk and cache', () => {
    sessionState.activateAutonomousMode({ trigger: 'go until done' });
    sessionState.deactivateAutonomousMode();
    assert.equal(sessionState.isAutonomousActive(), false);
    assert.equal(sessionState.getAutonomousMode(), null);
  });
});

describe('flow-session-state — shared adversary counter (AC6)', () => {
  beforeEach(() => {
    sessionState._resetAutonomousCacheForTests();
    if (sessionState.isAutonomousActive()) sessionState.deactivateAutonomousMode();
  });

  it('increments shared counter across sources', () => {
    sessionState.activateAutonomousMode({ trigger: 'autonomous mode' });
    sessionState.incrementAdversaryInvocation('lowConfidence');
    sessionState.incrementAdversaryInvocation('igr');
    sessionState.incrementAdversaryInvocation('manual');
    const mode = sessionState.getAutonomousMode();
    assert.equal(mode.adversaryInvocations.used, 3);
    assert.equal(mode.adversaryInvocations.breakdown.autonomousLowConfidence, 1);
    assert.equal(mode.adversaryInvocations.breakdown.igrArchitect, 1);
    assert.equal(mode.adversaryInvocations.breakdown.manual, 1);
    sessionState.deactivateAutonomousMode();
  });

  it('signals cap exhaustion', () => {
    sessionState.activateAutonomousMode({ trigger: 'autonomous mode' });
    const cfg = sessionState.getAutonomousConfig();
    let last;
    for (let i = 0; i < cfg.maxAdversaryInvocations + 1; i++) {
      last = sessionState.incrementAdversaryInvocation('manual');
    }
    assert.equal(last.allowed, false);
    sessionState.deactivateAutonomousMode();
  });
});

describe('flow-decision-authority — autonomous override (AC3, AC4)', () => {
  beforeEach(() => {
    sessionState._resetAutonomousCacheForTests();
    if (sessionState.isAutonomousActive()) sessionState.deactivateAutonomousMode();
  });

  it('routes productBehavior to queue-for-review when autonomous=true', () => {
    const r = decisionAuthority.classifyDecision(
      'should we charge admin users for billing seats',
      { autonomous: true }
    );
    assert.equal(r.authority, 'queue-for-review');
    assert.equal(r.category, 'productBehavior');
  });

  it('routes ux to queue-for-review when autonomous=true', () => {
    const r = decisionAuthority.classifyDecision(
      'add a hover animation to navigation menu',
      { autonomous: true }
    );
    assert.equal(r.authority, 'queue-for-review');
  });

  it('keeps engineering as agent-decides in autonomous mode', () => {
    const r = decisionAuthority.classifyDecision(
      'rename function calculateTotal to computeTotal',
      { autonomous: true }
    );
    assert.equal(r.authority, 'agent-decides');
  });

  it('routes low-confidence to adversary-loop in autonomous mode', () => {
    const r = decisionAuthority.classifyDecision(
      'do something or other',
      { autonomous: true }
    );
    assert.equal(r.confidence, 'low');
    assert.equal(r.authority, 'adversary-loop');
  });

  it('non-autonomous behavior is unchanged (no regression — AC11)', () => {
    const r = decisionAuthority.classifyDecision(
      'should we charge admin users for billing seats',
      { autonomous: false }
    );
    assert.equal(r.authority, 'owner-decides');
  });

  it('reads autonomous flag from session-state when not passed (default)', () => {
    sessionState.activateAutonomousMode({ trigger: 'go until done' });
    const r = decisionAuthority.classifyDecision('should we change the pricing tiers');
    assert.equal(r.autonomous, true);
    assert.equal(r.authority, 'queue-for-review');
    sessionState.deactivateAutonomousMode();
  });

  it('batchClassify applies autonomous override BEFORE batch-overflow (Blocker 1 fix)', () => {
    const decisions = [
      'should we charge admin users for billing seats',
      'add a hover animation',
      'change the default permission for new users',
      'should the email notification subject change',
      'business rule: tax calculation for EU users',
      'pricing tier for enterprise plan'
    ];
    const r = decisionAuthority.batchClassify(decisions, { autonomous: true });
    const queued = r.classified.filter(d => d.authority === 'queue-for-review');
    const downgraded = r.classified.filter(d => d.authority === 'agent-decides-report-after' && d.downgraded);
    assert.equal(queued.length > 0, true, 'productBehavior/ux should route to queue, not overflow');
    assert.equal(downgraded.length, 0, 'no decisions should be batch-overflow downgraded when autonomous routing handled them');
  });
});

describe('flow-question-queue — CRUD + atomic writes (AC5)', () => {
  beforeEach(() => queue.clearQueue());

  it('addQuestion creates a queue entry with stable shape', () => {
    const e = queue.addQuestion({
      text: 'Should the API include team-id?',
      classifiedBucket: 'productBehavior',
      taskContext: 'wf-aaaaaaaa',
      runId: 'auto-test'
    });
    assert.match(e.id, /^q-/);
    assert.equal(e.answered, false);
    assert.equal(e.taskContext, 'wf-aaaaaaaa');
    const loaded = queue.loadQueue();
    assert.equal(loaded.questions.length, 1);
  });

  it('skipTask records dependent-task skip', () => {
    const q = queue.addQuestion({ text: 'Q', taskContext: 'wf-11111111' });
    queue.skipTask({ taskId: 'wf-22222222', reason: 'depends on Q', blockingQuestionId: q.id });
    assert.equal(queue.listSkippedTasks().length, 1);
    assert.equal(queue.listSkippedTasks()[0].blockingQuestionId, q.id);
  });

  it('skipTask is idempotent (does not duplicate same taskId)', () => {
    queue.skipTask({ taskId: 'wf-11111111', reason: 'first' });
    queue.skipTask({ taskId: 'wf-11111111', reason: 'second' });
    assert.equal(queue.listSkippedTasks().length, 1);
    assert.equal(queue.listSkippedTasks()[0].reason, 'second');
  });

  it('atomic write — partial-write simulation does not corrupt queue', () => {
    queue.addQuestion({ text: 'first' });
    const tmpDir = os.tmpdir();
    const garbageTmp = path.join(path.dirname(queue.QUEUE_PATH), 'question-queue.json.tmp.99999');
    fs.writeFileSync(garbageTmp, '{"questions":[{"text":"corrupt');
    const loaded = queue.loadQueue();
    assert.equal(loaded.questions.length, 1, 'real file unaffected by tmp file');
    try { fs.unlinkSync(garbageTmp); } catch (_e) { /* ignore */ }
    void tmpDir;
  });
});

describe('flow-question-queue — dependency classifier (AC7)', () => {
  it('text-match flags task IDs in question text', () => {
    const deps = queue.classifyDependencies(
      'Does wf-12345678 still need the new field?',
      [{ id: 'wf-12345678', title: 'Add field' }, { id: 'wf-87654321', title: 'Other' }]
    );
    assert.deepEqual(deps.sort(), ['wf-12345678']);
  });

  it('text-match flags title substring (>=6 chars)', () => {
    const deps = queue.classifyDependencies(
      'Should the export workflow include team metadata?',
      [{ id: 'wf-11111111', title: 'export workflow setup' }, { id: 'wf-22222222', title: 'unrelated' }]
    );
    assert.equal(deps.includes('wf-11111111'), true);
  });

  it('classifier-unavailable path over-flags ALL pending tasks (fail-safe)', () => {
    const tasks = [{ id: 'wf-aaaaaaaa' }, { id: 'wf-bbbbbbbb' }, { id: 'wf-cccccccc' }];
    const deps = queue.classifyDependenciesSafe('vague unrelated text', tasks, null);
    assert.deepEqual(deps.sort(), ['wf-aaaaaaaa', 'wf-bbbbbbbb', 'wf-cccccccc']);
  });

  it('AI classifier exception falls back to over-flag', () => {
    const tasks = [{ id: 'wf-aaaaaaaa' }, { id: 'wf-bbbbbbbb' }];
    const deps = queue.classifyDependenciesSafe('vague text', tasks, () => { throw new Error('boom'); });
    assert.deepEqual(deps.sort(), ['wf-aaaaaaaa', 'wf-bbbbbbbb']);
  });

  it('union of text-match + AI classifier dedupes', () => {
    const a = queue.unionDependencies(['wf-1', 'wf-2'], ['wf-2', 'wf-3'], ['wf-3']);
    assert.deepEqual(a.sort(), ['wf-1', 'wf-2', 'wf-3']);
  });
});
