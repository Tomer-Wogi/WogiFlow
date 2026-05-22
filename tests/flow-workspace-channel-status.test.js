'use strict';

/**
 * Tests for S4 worker activity status (epic-workspace-sustained-exec / wf-87611c5e):
 *   - computeWorkerStatus state machine (ack-received / work-started /
 *     in-progress / complete / blocked / idle) + subtask counts
 *   - live channel server: GET /status returns the state; GET /health unchanged
 *
 * Run: NODE_ENV=test node --test tests/flow-workspace-channel-status.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { computeWorkerStatus } = require('../lib/workspace-channel-tracking');

function mkState(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-status-'));
  const stateDir = path.join(root, '.workflow', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  for (const [name, obj] of Object.entries(files)) {
    fs.writeFileSync(path.join(stateDir, name), JSON.stringify(obj));
  }
  return { root, state: stateDir };
}

describe('S4 computeWorkerStatus state machine', () => {
  it('idle when nothing in progress and nothing recent', () => {
    const { state } = mkState({ 'ready.json': { inProgress: [], ready: [], recentlyCompleted: [] } });
    assert.equal(computeWorkerStatus({ stateDir: state }).state, 'idle');
  });

  it('ack-received: in-progress but phase not yet active', () => {
    const { state } = mkState({
      'ready.json': { inProgress: [{ id: 'wf-aaaa0001' }] },
      'workflow-phase.json': { phase: 'routing' }
    });
    const s = computeWorkerStatus({ stateDir: state, stalenessMs: 1_000_000 });
    assert.equal(s.state, 'ack-received');
    assert.equal(s.taskId, 'wf-aaaa0001');
  });

  it('in-progress: active phase + fresh activity', () => {
    const { state } = mkState({
      'ready.json': { inProgress: [{ id: 'wf-bbbb0002' }] },
      'workflow-phase.json': { phase: 'coding' },
      'subtask-state.json': { taskId: 'wf-bbbb0002', subtasks: [
        { id: '01', status: 'completed' }, { id: '02', status: 'pending' }, { id: '03', status: 'pending' }
      ] }
    });
    const s = computeWorkerStatus({ stateDir: state, stalenessMs: 1_000_000 });
    assert.equal(s.state, 'in-progress');
    assert.deepEqual(s.subtasks, { total: 3, remaining: 2 });
  });

  it('work-started: active phase but stale heartbeat', () => {
    const { state } = mkState({
      'ready.json': { inProgress: [{ id: 'wf-cccc0003' }] },
      'workflow-phase.json': { phase: 'validating' }
    });
    // now far in the future ⇒ activity is stale
    const s = computeWorkerStatus({ stateDir: state, stalenessMs: 1000, now: Date.now() + 1e9 });
    assert.equal(s.state, 'work-started');
  });

  it('blocked: continuation counter escalated for the task', () => {
    const { state } = mkState({
      'ready.json': { inProgress: [{ id: 'wf-dddd0004' }] },
      'workflow-phase.json': { phase: 'coding' },
      'worker-continuation.json': { taskId: 'wf-dddd0004', escalated: true, count: 30 }
    });
    assert.equal(computeWorkerStatus({ stateDir: state, stalenessMs: 1_000_000 }).state, 'blocked');
  });

  it('complete: nothing in progress, recent completion', () => {
    const { state } = mkState({
      'ready.json': { inProgress: [], recentlyCompleted: [{ id: 'wf-eeee0005', completedAt: new Date().toISOString() }] }
    });
    const s = computeWorkerStatus({ stateDir: state, stalenessMs: 1_000_000 });
    assert.equal(s.state, 'complete');
    assert.equal(s.taskId, 'wf-eeee0005');
  });

  it('fail-open: missing stateDir ⇒ idle, never throws', () => {
    assert.equal(computeWorkerStatus({}).state, 'idle');
    assert.equal(computeWorkerStatus({ stateDir: '/nonexistent/x/y' }).state, 'idle');
  });
});

// ---- Live server integration (S4.1, S4.5) ----

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

describe('S4 live channel server', () => {
  let child;
  const port = 8000 + Math.floor(Math.random() * 900);
  const { root } = mkState({
    'ready.json': { inProgress: [{ id: 'wf-ffff0006' }] },
    'workflow-phase.json': { phase: 'coding' },
    'subtask-state.json': { taskId: 'wf-ffff0006', subtasks: [{ id: '01', status: 'pending' }] }
  });

  after(() => {
    try { if (child) child.kill('SIGKILL'); } catch (_err) {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) {}
  });

  it('serves GET /status and /health (health unchanged)', async () => {
    const serverPath = path.resolve(__dirname, '../lib/workspace-channel-server.js');
    child = spawn(process.execPath, [serverPath], {
      cwd: root,
      env: { ...process.env, WOGI_CHANNEL_PORT: String(port), WOGI_REPO_NAME: 'backend', WOGI_WORKSPACE_ROOT: root },
      stdio: ['pipe', 'ignore', 'ignore']
    });
    // wait for listen
    await new Promise(r => setTimeout(r, 600));

    const health = await getJson(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.repo, 'backend');
    assert.equal(health.body.state, undefined); // /health stays a pure liveness check

    const status = await getJson(port, '/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.repo, 'backend');
    assert.equal(status.body.taskId, 'wf-ffff0006');
    assert.equal(status.body.state, 'in-progress');
    assert.deepEqual(status.body.subtasks, { total: 1, remaining: 1 });
  });
});
