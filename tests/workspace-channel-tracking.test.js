'use strict';

/**
 * Tests for workspace-channel-tracking.js (v2.29.4 silent-halt RCA fix).
 *
 * Pin the wogi-hub 2026-04-27 incident: a manager that uses raw
 * `curl POST` to dispatch must have its dispatch recorded by the
 * channel server (Fix A), and a worker completion arriving at the
 * manager's channel server must reconcile in real time (Fix B).
 *
 * Run: node --test tests/workspace-channel-tracking.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const tracking = require('../lib/workspace-channel-tracking');

// In-memory mock of the dispatch-tracking module
function makeMockTracking() {
  const records = [];
  let throwOnRecord = false;
  let throwOnReconcile = false;
  return {
    records,
    throwOnRecord(v) { throwOnRecord = v; },
    throwOnReconcile(v) { throwOnReconcile = v; },
    readDispatches() { return records; },
    recordDispatch(workspaceRoot, { taskId, repoName, dispatchedBy }) {
      if (throwOnRecord) throw new Error('boom');
      const record = { taskId, repoName, dispatchedBy, status: 'pending' };
      records.push(record);
      return record;
    },
    reconcileDispatch(workspaceRoot, taskId, status, reason) {
      if (throwOnReconcile) throw new Error('boom');
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        if (r.taskId === taskId && r.status === 'pending') {
          r.status = status;
          r.reconciledReason = reason;
          return r;
        }
      }
      return null;
    }
  };
}

describe('tryRecordInboundDispatch (Fix A)', () => {
  let mock;
  beforeEach(() => { mock = makeMockTracking(); });

  it('records when worker receives /wogi-start from manager', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'recorded');
    assert.equal(result.taskId, 'wf-deadbeef');
    assert.equal(mock.records.length, 1);
    assert.equal(mock.records[0].repoName, 'be');
    assert.equal(mock.records[0].dispatchedBy, 'manager');
  });

  it('accepts workspace-manager as a valid from value', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'workspace-manager',
      body: '/wogi-start wf-12345678'
    }, mock);
    assert.equal(result.action, 'recorded');
  });

  it('skips when manager mode is the receiver', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-not-worker');
    assert.equal(mock.records.length, 0);
  });

  it('skips when from is not the manager', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'fe',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-bad-from');
    assert.equal(mock.records.length, 0);
  });

  it('skips when body is not a /wogi-start dispatch', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '## QUESTION: how do we handle X?'
    }, mock);
    assert.equal(result.action, 'skip-no-match');
    assert.equal(mock.records.length, 0);
  });

  it('skips when workspaceRoot is missing', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-no-root');
  });

  it('skips when body is empty / non-string', () => {
    assert.equal(tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws', repoName: 'be', from: 'manager', body: ''
    }, mock).action, 'skip-empty-body');
    assert.equal(tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws', repoName: 'be', from: 'manager', body: null
    }, mock).action, 'skip-empty-body');
    assert.equal(tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws', repoName: 'be', from: 'manager', body: undefined
    }, mock).action, 'skip-empty-body');
  });

  it('idempotent: skips when a pending record already exists for taskId+repoName', () => {
    // Pre-existing record (e.g., dispatchToChannel already recorded it)
    mock.records.push({ taskId: 'wf-deadbeef', repoName: 'be', status: 'pending' });
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-existing');
    assert.equal(result.taskId, 'wf-deadbeef');
    assert.equal(mock.records.length, 1, 'no duplicate appended');
  });

  it('NOT idempotent across different repoNames (different workers)', () => {
    mock.records.push({ taskId: 'wf-deadbeef', repoName: 'fe', status: 'pending' });
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'recorded');
    assert.equal(mock.records.length, 2);
  });

  it('NOT idempotent across status — a completed record does not block re-dispatch', () => {
    mock.records.push({ taskId: 'wf-deadbeef', repoName: 'be', status: 'completed' });
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'recorded');
    assert.equal(mock.records.length, 2);
  });

  it('handles leading whitespace in body', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '  /wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'recorded');
  });

  it('case-insensitive on wf-id', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start WF-DEADBEEF'
    }, mock);
    assert.equal(result.action, 'recorded');
    assert.equal(result.taskId, 'wf-deadbeef', 'normalized to lowercase');
  });

  it('rejects malformed wf-ids', () => {
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-bad' // too short
    }, mock);
    assert.equal(result.action, 'skip-no-match');
  });

  it('fails open on tracking.recordDispatch throw', () => {
    mock.throwOnRecord(true);
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'error');
    assert.match(result.reason, /boom/);
  });

  it('returns skip-no-root for null/undefined ctx', () => {
    assert.equal(tracking.tryRecordInboundDispatch(null, mock).action, 'skip-no-root');
    assert.equal(tracking.tryRecordInboundDispatch(undefined, mock).action, 'skip-no-root');
    assert.equal(tracking.tryRecordInboundDispatch({}, mock).action, 'skip-no-root');
  });
});

describe('tryReconcileInboundCompletion (Fix B)', () => {
  let mock;
  beforeEach(() => {
    mock = makeMockTracking();
    mock.records.push({ taskId: 'wf-deadbeef', repoName: 'be', status: 'pending' });
  });

  it('reconciles when manager receives ## Results from worker', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-deadbeef\n\nTests passing, ready to merge.'
    }, mock);
    assert.equal(result.action, 'reconciled');
    assert.equal(result.taskId, 'wf-deadbeef');
    assert.equal(mock.records[0].status, 'completed');
    assert.equal(mock.records[0].reconciledReason, 'channel-server-completion');
  });

  it('reconciles on task-complete keyword', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: 'Sending task-complete for wf-deadbeef.'
    }, mock);
    assert.equal(result.action, 'reconciled');
  });

  it('skips when receiver is not manager (worker mode)', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'fe',
      body: '## Results: wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-not-manager');
  });

  it('skips when from is the manager (no self-completion)', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'manager',
      body: '## Results: wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-self');
  });

  it('skips ## QUESTION: escalations even when wf-id is present', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## QUESTION: should wf-deadbeef use approach A or B?'
    }, mock);
    assert.equal(result.action, 'skip-question');
    assert.equal(mock.records[0].status, 'pending');
  });

  it('skips bodies that do not look like completions', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: 'Hey, working on wf-deadbeef. Status update soon.'
    }, mock);
    assert.equal(result.action, 'skip-not-completion');
    assert.equal(mock.records[0].status, 'pending');
  });

  it('skips when no wf-id is in the body', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: tests passing.'
    }, mock);
    assert.equal(result.action, 'skip-no-id');
  });

  it('skip-no-pending when wf-id matches no record', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-99999999'
    }, mock);
    assert.equal(result.action, 'skip-no-pending');
    assert.equal(result.taskId, 'wf-99999999');
  });

  it('idempotent: re-reconcile of completed record skips', () => {
    mock.records[0].status = 'completed';
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-no-pending');
  });

  it('skips when workspaceRoot is missing', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'skip-no-root');
  });

  it('skips empty body', () => {
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: ''
    }, mock);
    assert.equal(result.action, 'skip-empty-body');
  });

  it('fails open on reconcileDispatch throw', () => {
    mock.throwOnReconcile(true);
    const result = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-deadbeef'
    }, mock);
    assert.equal(result.action, 'error');
    assert.match(result.reason, /boom/);
  });

  it('returns skip-no-root for null/undefined ctx', () => {
    assert.equal(tracking.tryReconcileInboundCompletion(null, mock).action, 'skip-no-root');
    assert.equal(tracking.tryReconcileInboundCompletion(undefined, mock).action, 'skip-no-root');
  });
});

describe('end-to-end Fix A + Fix B integration', () => {
  it('Fix A records, Fix B reconciles — full lifecycle', () => {
    const mock = makeMockTracking();

    // 1. Manager dispatches via raw curl. Worker's channel server records it.
    const dispatchResult = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-c333a0b5'
    }, mock);
    assert.equal(dispatchResult.action, 'recorded');
    assert.equal(mock.records.length, 1);
    assert.equal(mock.records[0].status, 'pending');

    // 2. Worker finishes work. Posts results to manager's channel server.
    const completeResult = tracking.tryReconcileInboundCompletion({
      workspaceRoot: '/ws',
      repoName: 'manager',
      from: 'be',
      body: '## Results: wf-c333a0b5\n\nAll AC met. Tests passing.'
    }, mock);
    assert.equal(completeResult.action, 'reconciled');
    assert.equal(mock.records[0].status, 'completed');
    assert.equal(mock.records[0].reconciledReason, 'channel-server-completion');
  });

  it('Fix A is idempotent with dispatchToChannel (no duplicate)', () => {
    const mock = makeMockTracking();

    // Simulate dispatchToChannel having already recorded (manager-side)
    mock.records.push({
      taskId: 'wf-c333a0b5',
      repoName: 'be',
      status: 'pending',
      dispatchedBy: 'manager'
    });

    // Worker's channel server receives the same dispatch and tries to record
    const result = tracking.tryRecordInboundDispatch({
      workspaceRoot: '/ws',
      repoName: 'be',
      from: 'manager',
      body: '/wogi-start wf-c333a0b5'
    }, mock);
    assert.equal(result.action, 'skip-existing');
    assert.equal(mock.records.length, 1, 'no duplicate record');
  });
});
