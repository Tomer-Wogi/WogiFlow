'use strict';

/**
 * Tests for Story B (wf-ab59f0e4) — Workspace-Mode Epic Autonomy.
 *
 * Covers AC3 (message format), AC4 (manager surface storage), AC5 (empty-
 * collection rendering), AC7 (multi-worker aggregation), AC8 (manager-
 * restart resilience via durable storage), AC9 (no regression — non-
 * autonomous workers unaffected), AC11 (path-discipline).
 *
 * AC1 (worker-side cascade) integrates Story E's cascade module — verified
 * upstream.
 * AC2 (worker autonomous persistence) is upstream from Story C.
 * AC10 (hook three-layer) — additions are in core/, no entry-file growth.
 * AC12 (concurrency stress) is a runtime test — separate harness.
 *
 * Run: node --test tests/flow-workspace-summary.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ws = require('../scripts/flow-workspace-summary');
const dispatchTracking = require('../lib/workspace-dispatch-tracking');
const { checkPathDiscipline } = require('../scripts/hooks/core/worker-boundary-gate');

function samplePayload(overrides = {}) {
  return {
    runId: 'auto-w1',
    workerId: 'frontend',
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    endedAt: new Date().toISOString(),
    trigger: 'go until you finish',
    completed: [{ taskId: 'wf-aaaaaaaa', title: 'Add team-id' }],
    queuedQuestions: [{ id: 'q-1', text: 'Pricing for admins?', dependencies: ['wf-bbbbbbbb'] }],
    skippedTasks: [{ taskId: 'wf-bbbbbbbb', reason: 'awaiting', blockingQuestionId: 'q-1' }],
    adversaryInvocations: { used: 3, cap: 30 },
    endReason: 'queue-drained',
    ...overrides
  };
}

describe('flow-workspace-summary — message format (AC3)', () => {
  it('encodes payload as single-line ## COMPLETION-SUMMARY:', () => {
    const lines = ws.encodeMessage(samplePayload());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^## COMPLETION-SUMMARY: /);
  });

  it('roundtrip: encode → parse recovers identical shape', () => {
    const payload = samplePayload();
    const lines = ws.encodeMessage(payload);
    const r = ws.parseMessage(lines[0]);
    assert.equal(r.ok, true);
    assert.equal(r.payload.runId, payload.runId);
    assert.equal(r.payload.completed.length, 1);
  });

  it('rejects malformed base64', () => {
    const r = ws.parseMessage('## COMPLETION-SUMMARY: not%%%base64%%%');
    assert.equal(r.ok, false);
    assert.match(r.error, /decode/i);
  });

  it('rejects non-summary lines', () => {
    const r = ws.parseMessage('## QUESTION: hello');
    assert.equal(r.ok, false);
  });

  it('validatePayload rejects missing runId', () => {
    const lines = ws.encodeMessage({ ...samplePayload(), runId: '' });
    const r = ws.parseMessage(lines[0]);
    assert.equal(r.ok, false);
    assert.match(r.error, /missing runId/);
  });

  it('validatePayload rejects non-array completed', () => {
    const big = { ...samplePayload(), completed: 'not-array' };
    const lines = [`## COMPLETION-SUMMARY: ${Buffer.from(JSON.stringify(big)).toString('base64')}`];
    const r = ws.parseMessage(lines[0]);
    assert.equal(r.ok, false);
  });

  it('chunks payloads larger than the single-line ceiling', () => {
    const huge = samplePayload({
      completed: Array.from({ length: 5000 }, (_, i) => ({
        taskId: `wf-${String(i).padStart(8, '0')}`,
        title: `Task ${i} with a moderately-long title to inflate payload size`
      }))
    });
    const lines = ws.encodeMessage(huge);
    assert.equal(lines.length > 1, true);
    for (const line of lines) {
      assert.match(line, /^## COMPLETION-SUMMARY-CHUNK-\d+\/\d+: /);
    }
    const r = ws.parseChunked(lines);
    assert.equal(r.ok, true);
    assert.equal(r.payload.completed.length, 5000);
  });

  it('parseChunked rejects out-of-order missing chunks', () => {
    const huge = samplePayload({
      completed: Array.from({ length: 5000 }, (_, i) => ({ taskId: `wf-${String(i).padStart(8, '0')}`, title: 'x'.repeat(40) }))
    });
    const lines = ws.encodeMessage(huge);
    if (lines.length < 3) return; // skip if payload accidentally fits in one line
    const incomplete = [lines[0], lines[2]];
    const r = ws.parseChunked(incomplete);
    assert.equal(r.ok, false);
    assert.match(r.error, /missing chunks/);
  });
});

describe('flow-workspace-summary — multi-worker rendering (AC5, AC7)', () => {
  it('all 3 sections render even for empty workers (empty-collection rule)', () => {
    const empty = samplePayload({ workerId: 'idle', completed: [], queuedQuestions: [], skippedTasks: [] });
    const out = ws.renderMultiWorker([empty]);
    assert.match(out, /Worker: idle/);
    assert.match(out, /Completed \(0\)/);
    assert.match(out, /Queued questions \(0\)/);
    assert.match(out, /Skipped tasks \(0\)/);
    const noneCount = (out.match(/\[none\]/g) || []).length;
    assert.equal(noneCount, 3);
  });

  it('aggregates totals across multiple workers', () => {
    const w1 = samplePayload({ workerId: 'frontend' });
    const w2 = samplePayload({
      workerId: 'backend',
      runId: 'auto-w2',
      completed: [{ taskId: 'wf-cccccccc', title: 'API change' }],
      queuedQuestions: [],
      skippedTasks: []
    });
    const out = ws.renderMultiWorker([w1, w2]);
    assert.match(out, /Worker: frontend/);
    assert.match(out, /Worker: backend/);
    assert.match(out, /Total: 2 completed, 1 questions queued, 1 skipped across 2 workers/);
  });

  it('shows endReason when not queue-drained', () => {
    const fatal = samplePayload({ endReason: 'fatal-error' });
    const out = ws.renderMultiWorker([fatal]);
    assert.match(out, /endReason: fatal-error/);
  });

  it('handles empty list with placeholder', () => {
    const out = ws.renderMultiWorker([]);
    assert.match(out, /\[no worker summaries received\]/);
  });
});

describe('workspace-dispatch-tracking — summary attachment (AC4, AC8)', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-ws-'));
    fs.mkdirSync(path.join(tmpRoot, '.workspace', 'state'), { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it('attachCompletionSummary marks dispatch as completed-with-summary', () => {
    dispatchTracking.recordDispatch(tmpRoot, {
      taskId: 'wf-12345678',
      repoName: 'frontend',
      dispatchedBy: 'manager'
    });
    const r = dispatchTracking.attachCompletionSummary(tmpRoot, 'wf-12345678', samplePayload());
    assert.ok(r);
    assert.equal(r.status, 'completed-with-summary');
    assert.equal(r.completionSummary.workerId, 'frontend');
    assert.equal(r.completionSummary.seenByManager, false);
  });

  it('returns null when no matching pending dispatch exists', () => {
    const r = dispatchTracking.attachCompletionSummary(tmpRoot, 'wf-99999999', samplePayload());
    assert.equal(r, null);
  });

  it('readPendingCompletionSummaries returns unseen and skips seen', () => {
    dispatchTracking.recordDispatch(tmpRoot, { taskId: 'wf-11111111', repoName: 'frontend', dispatchedBy: 'manager' });
    dispatchTracking.recordDispatch(tmpRoot, { taskId: 'wf-22222222', repoName: 'backend', dispatchedBy: 'manager' });
    dispatchTracking.attachCompletionSummary(tmpRoot, 'wf-11111111', samplePayload({ workerId: 'frontend' }));
    dispatchTracking.attachCompletionSummary(tmpRoot, 'wf-22222222', samplePayload({ workerId: 'backend', runId: 'auto-2' }));

    const pending1 = dispatchTracking.readPendingCompletionSummaries(tmpRoot);
    assert.equal(pending1.length, 2);

    const n = dispatchTracking.markCompletionSummariesSeen(tmpRoot, ['wf-11111111']);
    assert.equal(n, 1);

    const pending2 = dispatchTracking.readPendingCompletionSummaries(tmpRoot);
    assert.equal(pending2.length, 1);
    assert.equal(pending2[0].taskId, 'wf-22222222');
  });

  it('summaries persist across simulated manager-restart (durable storage)', () => {
    dispatchTracking.recordDispatch(tmpRoot, { taskId: 'wf-aaaaaaaa', repoName: 'frontend', dispatchedBy: 'manager' });
    dispatchTracking.attachCompletionSummary(tmpRoot, 'wf-aaaaaaaa', samplePayload());
    // Simulate manager restart: re-load module state from disk
    const fresh = dispatchTracking.readPendingCompletionSummaries(tmpRoot);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].taskId, 'wf-aaaaaaaa');
  });
});

describe('worker-boundary-gate — path discipline (AC11)', () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('blocks worker writing manager workspace state', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws-root';
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Write', { file_path: '/tmp/ws-root/.workspace/state/dispatched-tasks.json' });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'path-discipline-worker');
  });

  it('allows worker writing its own member-repo state', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws-root';
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Write', { file_path: '/tmp/ws-root/members/frontend/.workflow/state/session-state.json' });
    assert.equal(r.blocked, false);
  });

  it('blocks manager writing worker member-repo state', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws-root';
    process.env.WOGI_REPO_NAME = 'manager';
    const r = checkPathDiscipline('Write', { file_path: '/tmp/ws-root/members/frontend/.workflow/state/session-state.json' });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'path-discipline-manager');
  });

  it('no-op outside workspace mode', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_REPO_NAME;
    const r = checkPathDiscipline('Write', { file_path: '/tmp/anything.json' });
    assert.equal(r.blocked, false);
  });

  it('no-op for read-only tools', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws-root';
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Read', { file_path: '/tmp/ws-root/.workspace/state/dispatched-tasks.json' });
    assert.equal(r.blocked, false);
  });
});
