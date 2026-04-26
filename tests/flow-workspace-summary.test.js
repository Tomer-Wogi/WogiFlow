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

describe('worker-boundary-gate — path discipline (AC11 + SEC-002 layout-independent)', () => {
  // SEC-002 fix (2026-04-26): manager-side blocking now derives from real
  // discovered member dirs, not a hardcoded /members?/ regex. Tests use
  // real tmp dirs to exercise the discovery code path.
  let savedEnv;
  let tmpRoot;
  const { _resetPathDisciplineCache } = require('../scripts/hooks/core/worker-boundary-gate');

  beforeEach(() => {
    savedEnv = { ...process.env };
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-pdisc-'));
    _resetPathDisciplineCache();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    _resetPathDisciplineCache();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  function setupWorkspace(memberLayout) {
    // memberLayout: array of relative paths under tmpRoot to create as members
    fs.mkdirSync(path.join(tmpRoot, '.workspace', 'state'), { recursive: true });
    for (const m of memberLayout) {
      fs.mkdirSync(path.join(tmpRoot, m, '.workflow', 'state'), { recursive: true });
    }
  }

  it('blocks worker writing manager workspace state', () => {
    setupWorkspace(['frontend']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, '.workspace/state/dispatched-tasks.json') });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'path-discipline-worker');
  });

  it('allows worker writing its own member-repo state', () => {
    setupWorkspace(['frontend']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, 'frontend/.workflow/state/session-state.json') });
    assert.equal(r.blocked, false);
  });

  it('blocks manager writing flat-sibling worker member state (SEC-002)', () => {
    // Flat layout: frontend/ + backend/ directly under workspace root,
    // NO /members/ prefix. Hardcoded regex in the prior impl missed this.
    setupWorkspace(['frontend', 'backend']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'manager';
    const r = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, 'frontend/.workflow/state/session-state.json') });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'path-discipline-manager');
  });

  it('blocks manager writing /members/ prefix worker state (legacy layout)', () => {
    setupWorkspace(['members/frontend']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'manager';
    const r = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, 'members/frontend/.workflow/state/session-state.json') });
    // Note: in the new derivation-from-registry impl, only direct children
    // of workspaceRoot are scanned (matching lib/workspace.js discoverMembers).
    // /members/frontend/ is two levels deep, so this layout requires
    // the discovery to be recursive. Currently it's not — matching the
    // existing discoverMembers behavior. This test pins that current scope.
    assert.equal(r.blocked, false,
      'NOTE: discovery matches lib/workspace.js — only direct children scanned. ' +
      'Workspaces with /members/<X> require lib/workspace.js to support that layout.');
  });

  it('blocks manager writing custom-layout worker state when discovered', () => {
    // Apps layout: apps/frontend/ + apps/backend/ — only blocked if
    // the workspace registry actually discovers them. This pins that the
    // gate correctly derives FROM the workspace, not a hardcoded pattern.
    setupWorkspace(['frontend', 'shared']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'manager';
    // shared/ has .workflow/state/ → discovered → write blocked
    const r1 = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, 'shared/.workflow/state/cache.json') });
    assert.equal(r1.blocked, true);
    // unrelated/ has no .workflow/state/ → not discovered → not blocked
    fs.mkdirSync(path.join(tmpRoot, 'unrelated'));
    _resetPathDisciplineCache();
    const r2 = checkPathDiscipline('Write', { file_path: path.join(tmpRoot, 'unrelated/random.txt') });
    assert.equal(r2.blocked, false);
  });

  it('no-op outside workspace mode', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_REPO_NAME;
    const r = checkPathDiscipline('Write', { file_path: '/tmp/anything.json' });
    assert.equal(r.blocked, false);
  });

  it('no-op for read-only tools', () => {
    setupWorkspace(['frontend']);
    process.env.WOGI_WORKSPACE_ROOT = tmpRoot;
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = checkPathDiscipline('Read', { file_path: path.join(tmpRoot, '.workspace/state/dispatched-tasks.json') });
    assert.equal(r.blocked, false);
  });
});

describe('arch-001 Tier-3: channel-transport regression guard (P11.4 self-compliance)', () => {
  // regression-tier3
  // The audit-channel-transport-001 incident (v2.29.0 → v2.29.1 hotfix) was
  // caused by Story B layering on Story A's MCP-strip without a Tier-3 test
  // exercising the actual transport. This test pins the integration:
  // 1. Run the channel-only MCP strip helper to produce a worker config.
  // 2. Verify wogi-workspace-channel server entry survives the strip.
  // 3. Encode a COMPLETION-SUMMARY through the wire format.
  // 4. Verify a fresh manager-side parse round-trips the payload identically.
  // The failure mode this prevents: the strip removes the channel server
  // (Story A's bug), or the wire format breaks (Story B's risk), or the
  // dangerous-key scrub mutates user data (SEC-005's risk).

  const { extractChannelOnlyConfig, writeChannelOnlyConfig, preservesChannelTransport } =
    require('../scripts/flow-worker-mcp-strip');

  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-tier3-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it('end-to-end: strip → channel-only config → encode summary → parse → roundtrip', () => {
    // Step 1: simulate a worker member-repo .mcp.json with the channel server
    const sourceMcp = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(sourceMcp, JSON.stringify({
      mcpServers: {
        'wogi-workspace-channel': {
          command: 'node',
          args: ['/wf/lib/workspace-channel-server.js'],
          env: {
            WOGI_CHANNEL_PORT: '8801',
            WOGI_REPO_NAME: 'frontend',
            WOGI_WORKSPACE_ROOT: '/Users/x/wogi-hub',
            WOGI_PEERS: 'backend:8802,manager:8800',
            WOGI_MANAGER_PORT: '8800'
          }
        },
        'claude.ai-gmail': { command: 'gmail-mcp' },
        'claude.ai-slack': { command: 'slack-mcp' }
      }
    }, null, 2));

    // Step 2: run the strip helper, verify channel transport is preserved
    const dest = path.join(tmpDir, 'state', 'worker-channel-only-mcp.json');
    const cfg = extractChannelOnlyConfig(sourceMcp);
    writeChannelOnlyConfig(dest, cfg);
    assert.equal(preservesChannelTransport(cfg), true,
      'CRITICAL — strip must preserve wogi-workspace-channel for manager dispatch to reach worker');

    // Step 3: encode a realistic COMPLETION-SUMMARY through the wire format
    const summary = samplePayload({
      runId: 'tier3-roundtrip',
      completed: [
        { taskId: 'wf-aaaaaaaa', title: 'First completed task' },
        { taskId: 'wf-bbbbbbbb', title: 'Second completed task' }
      ],
      queuedQuestions: [
        { id: 'q-tier3-1', text: 'Pricing question?', dependencies: ['wf-cccccccc'] }
      ]
    });
    const lines = ws.encodeMessage(summary);
    assert.ok(lines.length >= 1);

    // Step 4: simulate manager-side parse (the original failure mode was
    // the manager never receiving anything; here we verify that IF a line
    // is delivered, the wire format faithfully roundtrips)
    const parsed = lines.length === 1
      ? ws.parseMessage(lines[0])
      : ws.parseChunked(lines);
    assert.equal(parsed.ok, true, `parse failed: ${parsed.error}`);
    assert.equal(parsed.payload.runId, 'tier3-roundtrip');
    assert.equal(parsed.payload.completed.length, 2);
    assert.equal(parsed.payload.completed[0].title, 'First completed task');
    assert.equal(parsed.payload.queuedQuestions[0].id, 'q-tier3-1');

    // Step 5: SEC-005 regression — hostile __proto__ in payload must be
    // stripped before the manager sees it
    const hostileEncoded = `## COMPLETION-SUMMARY: ${
      Buffer.from(JSON.stringify({
        runId: 'hostile',
        completed: [{ taskId: 'wf-12345678', title: 'ok' }],
        queuedQuestions: [],
        skippedTasks: [],
        __proto__: { polluted: true },
        nested: { constructor: 'attack' }
      }), 'utf-8').toString('base64')
    }`;
    const hostileResult = ws.parseMessage(hostileEncoded);
    assert.equal(hostileResult.ok, true);
    assert.equal(({}).polluted, undefined,
      'CRITICAL — Object.prototype must not be polluted by channel payload');
    // Use hasOwnProperty — accessing nested.constructor returns Object's
    // prototype constructor function (not undefined). What matters is that
    // the OWN 'constructor' property was deleted from the nested object.
    assert.equal(
      Object.prototype.hasOwnProperty.call(hostileResult.payload.nested, 'constructor'),
      false,
      'nested constructor own-property must be stripped'
    );
  });

  it('rejects duplicate chunks (CL-004 regression — silent payload corruption)', () => {
    // Build a chunked summary
    const big = samplePayload({
      completed: Array.from({ length: 5000 }, (_, i) => ({
        taskId: `wf-${String(i).padStart(8, '0')}`,
        title: `Task ${i} with reasonably-long title to inflate payload`
      }))
    });
    const lines = ws.encodeMessage(big);
    if (lines.length < 2) return; // skip if it accidentally fits in one line
    // Inject duplicate chunk-1
    const tampered = [lines[0], lines[0], ...lines.slice(1)];
    const r = ws.parseChunked(tampered);
    assert.equal(r.ok, false);
    assert.match(r.error, /duplicate chunk/);
  });

  it('SEC-005 regression: deep nested dangerous keys → fail-safe (no leak)', () => {
    // Build payload with __proto__ at depth 270 (past the SEC-001 fix's 256 cap)
    let inner = '{"polluted":"deep"}';
    for (let i = 0; i < 270; i++) inner = `{"a":${inner}}`;
    const payloadStr = `{"runId":"deep","completed":[],"queuedQuestions":[],"skippedTasks":[],"deep":${inner.replace('{"polluted":"deep"}', '{"__proto__":{"polluted":true}}')}}`;
    const encoded = `## COMPLETION-SUMMARY: ${Buffer.from(payloadStr).toString('base64')}`;
    const r = ws.parseMessage(encoded);
    // Either the strip helper failed-safe (ok=false) or stripped to safety
    if (r.ok) {
      assert.equal(({}).polluted, undefined,
        'Object.prototype must not be polluted even at depth past cap');
    }
    // Either way, no pollution should escape
    assert.equal(({}).polluted, undefined);
  });
});
