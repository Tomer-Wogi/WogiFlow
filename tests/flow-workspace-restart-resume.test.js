'use strict';

/**
 * Tests for S5 manager restart + resume + ack (epic-workspace-sustained-exec / wf-ee87a24e):
 *   - session-start-worker resume-in-progress branch (resume the SAME task,
 *     don't go idle / pick another) + worker-ready ack
 *   - live channel server: POST /restart writes the wrapper flag + returns 202;
 *     /status carries version-drift fields
 *
 * The /restart handler SIGTERMs the server's parent. To keep the test runner
 * safe, the server is spawned under `sh -c` (no exec) so the parent that gets
 * signalled is the throwaway shell, not this test process.
 *
 * Run: NODE_ENV=test node --test tests/flow-workspace-restart-resume.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

// ---- resume-in-progress branch (unit) ----
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-resume-'));
fs.mkdirSync(path.join(ROOT, '.workflow', 'state'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.workspace', 'messages'), { recursive: true });
process.env.WOGI_PROJECT_ROOT = ROOT;
process.env.WOGI_WORKSPACE_ROOT = ROOT;
process.env.WOGI_REPO_NAME = 'backend';

const { handleWorkerSessionStart } = require('../scripts/hooks/core/session-start-worker');
const subtaskState = require('../lib/workspace-subtask-state');
const STATE = path.join(ROOT, '.workflow', 'state');

after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_err) {} });

describe('S5 session-start: resume-in-progress', () => {
  it('resumes the in-progress task when sub-tasks remain', () => {
    fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify({ inProgress: [{ id: 'wf-res00001', title: 'X' }], ready: [] }));
    subtaskState.write('wf-res00001', [
      { id: '01', status: 'completed' }, { id: '02', status: 'pending' }, { id: '03', status: 'pending' }
    ]);
    const r = handleWorkerSessionStart();
    assert.equal(r.branch, 'resume-in-progress');
    assert.equal(r.taskId, 'wf-res00001');
    assert.equal(r.remaining, 2);
    assert.match(r.context, /Skill\(skill="wogi-start", args="wf-res00001"\)/);
    assert.match(r.context, /must NOT be redone/);
    subtaskState.clear();
  });

  it('does NOT resume when the in-progress task has 0 remaining sub-tasks', () => {
    fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify({ inProgress: [{ id: 'wf-res00002' }], ready: [] }));
    subtaskState.write('wf-res00002', [{ id: '01', status: 'completed' }]);
    const r = handleWorkerSessionStart();
    assert.notEqual(r.branch, 'resume-in-progress');
    subtaskState.clear();
  });

  it('posts a worker-ready ack on resume', () => {
    // clear bus
    const dir = path.join(ROOT, '.workspace', 'messages');
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
    fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify({ inProgress: [{ id: 'wf-res00003' }], ready: [] }));
    subtaskState.write('wf-res00003', [{ id: '01', status: 'pending' }]);
    const r = handleWorkerSessionStart();
    assert.equal(r.branch, 'resume-in-progress');
    const { readMessages } = require('../lib/workspace-messages');
    assert.ok(readMessages(ROOT, { type: 'worker-ready' }).length >= 1);
    subtaskState.clear();
  });
});

// ---- live /restart + /status version fields ----
function req(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end();
  });
}

describe('S5 live channel server: /restart + version fields', () => {
  let child;
  const port = 8000 + Math.floor(Math.random() * 900);
  const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-restart-srv-'));
  const flagPath = path.join(workerRoot, '.workflow', 'state', 'restart-requested');
  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(path.join(workerRoot, '.workflow', 'state', 'ready.json'), JSON.stringify({ inProgress: [] }));

  after(() => {
    try { if (child) child.kill('SIGKILL'); } catch (_err) {}
    try { fs.rmSync(workerRoot, { recursive: true, force: true }); } catch (_err) {}
  });

  it('POST /restart writes the wrapper flag and returns 202; /status has version fields', async () => {
    const serverPath = path.resolve(__dirname, '../lib/workspace-channel-server.js');
    // Spawn under `sh -c` (NO exec) so the server's parent — the one it SIGTERMs
    // — is the throwaway shell, not this test process.
    child = spawn('sh', ['-c', `node "${serverPath}"`], {
      cwd: workerRoot,
      env: { ...process.env, WOGI_CHANNEL_PORT: String(port), WOGI_REPO_NAME: 'backend', WOGI_WORKSPACE_ROOT: workerRoot, WOGI_RESTART_FLAG: flagPath },
      stdio: ['pipe', 'ignore', 'ignore'], detached: false
    });
    await new Promise(r => setTimeout(r, 600));

    // /status carries version fields (same version → no drift)
    const status = await req(port, 'GET', '/status');
    const sbody = JSON.parse(status.body);
    assert.equal(status.status, 200);
    assert.ok('versionDrift' in sbody);
    assert.equal(sbody.versionDrift, false); // running from the same checkout
    assert.ok(sbody.serverVersion); // version string present

    // unauthorized sender is rejected
    const forbidden = await req(port, 'POST', '/restart', { 'X-Wogi-From': 'frontend', 'Content-Length': 0 });
    assert.equal(forbidden.status, 403);
    assert.equal(fs.existsSync(flagPath) && fs.readFileSync(flagPath, 'utf-8').includes('manager-restart'), false);

    // manager-triggered restart → 202 + flag written
    const ok = await req(port, 'POST', '/restart', { 'X-Wogi-From': 'manager', 'Content-Length': 0 });
    assert.equal(ok.status, 202);
    assert.match(ok.body, /restarting/);
    // flag file written with the manager-restart reason
    await new Promise(r => setTimeout(r, 50));
    assert.ok(fs.existsSync(flagPath));
    assert.match(fs.readFileSync(flagPath, 'utf-8'), /manager-restart/);
  });
});
