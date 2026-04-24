'use strict';

/**
 * Tests for wf-8d635d0e / E1 — Parallel-Worktree Auto-Review.
 *
 * Covers:
 *   1. Findings incorporation round-trip (writeFindings → readFindings, last-write-wins)
 *   2. awaitFindings timeout path (unverified-review-timeout)
 *   3. High-severity finding → downgradeClaim banner + softModeWarn activation
 *   4. Gate passthrough when no findings are present (behaviour unchanged)
 *   5. runReview injects a custom reviewer and writes `complete` record
 *   6. maybeStartAutoReview gating (wrong transition / disabled config / no task)
 *
 * Run: NODE_ENV=test node --test tests/auto-review.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Silence gate console chatter in tests.
const _origLog = console.log;
const _origWarn = console.warn;
const _origErr = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const {
  FINDINGS_FILE,
  readFindings,
  writeFindings,
  awaitFindings,
  runReview,
  summarizeFindingsForAudit,
  _internal,
} = require('../lib/worktree-review');

const {
  auditCompletionClaim,
  downgradeClaim,
} = require('../scripts/flow-completion-truth-gate');

const {
  maybeStartAutoReview,
} = require('../scripts/hooks/core/phase-transition-auto-review');

// ============================================================
// Snapshot / restore findings file so tests don't clobber real state.
// ============================================================

let originalFindings = null;
before(() => {
  try { originalFindings = fs.readFileSync(FINDINGS_FILE, 'utf-8'); } catch (_err) { originalFindings = null; }
});
after(() => {
  if (originalFindings !== null) fs.writeFileSync(FINDINGS_FILE, originalFindings);
  else { try { fs.unlinkSync(FINDINGS_FILE); } catch (_err) {} }
  console.log = _origLog;
  console.warn = _origWarn;
  console.error = _origErr;
});
beforeEach(() => {
  try { fs.unlinkSync(FINDINGS_FILE); } catch (_err) {}
});

// ============================================================
// 1. Findings file round-trip + last-write-wins
// ============================================================

describe('findings file I/O', () => {
  it('writeFindings + readFindings round-trip', () => {
    writeFindings({ taskId: 't-1', status: 'complete', findings: [{ severity: 'low', file: 'a.js', line: 3, claim: 'x', evidence: 'y' }] });
    const rec = readFindings('t-1');
    assert.equal(rec.taskId, 't-1');
    assert.equal(rec.status, 'complete');
    assert.equal(rec.findings.length, 1);
    assert.equal(rec.findings[0].severity, 'low');
  });

  it('last-write-wins per taskId', () => {
    writeFindings({ taskId: 't-2', status: 'in-progress', findings: [] });
    writeFindings({ taskId: 't-2', status: 'complete', findings: [{ severity: 'high', file: 'x', line: 1, claim: 'c', evidence: 'e' }] });
    const rec = readFindings('t-2');
    assert.equal(rec.status, 'complete');
    assert.equal(rec.findings[0].severity, 'high');
    // And only one record per task in the underlying array:
    const all = _internal.readAll();
    const matches = all.filter((r) => r.taskId === 't-2');
    assert.equal(matches.length, 1);
  });

  it('readFindings returns null for unknown taskId', () => {
    assert.equal(readFindings('t-missing'), null);
  });

  it('writeFindings throws on missing taskId', () => {
    assert.throws(() => writeFindings({ status: 'complete' }), /taskId/);
  });
});

// ============================================================
// 2. awaitFindings timeout
// ============================================================

describe('awaitFindings timeout path', () => {
  it('returns unverified-review-timeout when no terminal record arrives', async () => {
    writeFindings({ taskId: 't-timeout', status: 'in-progress', startedAt: '2026-04-24T00:00:00Z', findings: [] });
    const rec = await awaitFindings('t-timeout', 80);
    assert.equal(rec.status, 'unverified-review-timeout');
    assert.equal(rec.timeoutMs, 80);
  });

  it('returns the terminal record when it arrives before timeout', async () => {
    writeFindings({ taskId: 't-quick', status: 'complete', findings: [] });
    const rec = await awaitFindings('t-quick', 1000);
    assert.equal(rec.status, 'complete');
  });
});

// ============================================================
// 3. High-severity finding → softModeWarn + downgrade banner
// ============================================================

describe('completion-truth-gate integration — high-severity findings', () => {
  it('high-severity finding flips softModeWarn on even when criteria are sufficient', () => {
    writeFindings({
      taskId: 't-hi',
      status: 'complete',
      findings: [
        { severity: 'high', file: 'src/x.js', line: 10, claim: 'debugger statement', evidence: 'debugger;' },
      ],
    });
    // No claimed criteria — audit on its own would report 0/0/clean. The
    // auto-review signal must still surface.
    const audit = auditCompletionClaim('t-hi', []);
    assert.ok(audit.autoReview);
    assert.equal(audit.autoReview.highSeverityCount, 1);
    assert.equal(audit.softModeWarn, true);
  });

  it('downgradeClaim banner includes a line per high-severity finding', () => {
    writeFindings({
      taskId: 't-hi2',
      status: 'complete',
      findings: [
        { severity: 'high', file: 'a.js', line: 1, claim: 'merge conflict marker', evidence: '<<<<<<< HEAD' },
        { severity: 'high', file: 'b.js', line: 42, claim: 'debugger statement', evidence: 'debugger;' },
      ],
    });
    const audit = auditCompletionClaim('t-hi2', []);
    const { text } = downgradeClaim('Task is done.', audit);
    assert.ok(/Auto-review: 2 high-severity/.test(text), `banner should mention high-severity count; got: ${text}`);
    assert.ok(/a\.js:1/.test(text));
    assert.ok(/b\.js:42/.test(text));
  });

  it('medium/low findings produce informational banner without softModeWarn', () => {
    writeFindings({
      taskId: 't-med',
      status: 'complete',
      findings: [
        { severity: 'medium', file: 'x.js', line: 1, claim: 'FIXME', evidence: 'FIXME foo' },
        { severity: 'low', file: 'y.js', line: 2, claim: 'TODO', evidence: 'TODO bar' },
      ],
    });
    const audit = auditCompletionClaim('t-med', []);
    assert.equal(audit.autoReview.highSeverityCount, 0);
    // softModeWarn should NOT be flipped for med/low alone.
    assert.equal(audit.softModeWarn, false);
  });
});

// ============================================================
// 4. Gate passthrough when no findings
// ============================================================

describe('completion-truth-gate — passthrough on no findings', () => {
  it('audit has no autoReview property and downgradeClaim returns untouched text', () => {
    // Ensure no record for this task:
    const audit = auditCompletionClaim('t-none', []);
    assert.equal(audit.autoReview, undefined);
    assert.equal(audit.softModeWarn, false);
    assert.equal(audit.blocked, false);
    const { text, replaced } = downgradeClaim('Task is done.', audit);
    assert.equal(replaced, false);
    assert.equal(text, 'Task is done.');
  });
});

// ============================================================
// 5. runReview uses injected reviewer + writes complete record
// ============================================================

describe('runReview with injected reviewer', () => {
  it('writes in-progress then complete, preserving injected findings', async () => {
    const fakeFindings = [
      { severity: 'medium', file: 'f.js', line: 7, claim: 'TODO', evidence: 'TODO: x' },
    ];
    const rec = await runReview({
      taskId: 't-run',
      worktreePath: '/tmp',
      baseBranch: 'HEAD',
      reviewer: () => fakeFindings,
    });
    assert.equal(rec.status, 'complete');
    assert.equal(rec.findings.length, 1);
    assert.equal(rec.findings[0].claim, 'TODO');
    // And the file reflects the final record:
    const onDisk = readFindings('t-run');
    assert.equal(onDisk.status, 'complete');
  });

  it('reviewer that throws produces an error record, not a crash', async () => {
    const rec = await runReview({
      taskId: 't-err',
      worktreePath: '/tmp',
      baseBranch: 'HEAD',
      reviewer: () => { throw new Error('boom'); },
    });
    assert.equal(rec.status, 'error');
    assert.equal(rec.findings.length, 0);
    assert.ok(rec.error.includes('boom'));
  });
});

// ============================================================
// 6. maybeStartAutoReview gating
// ============================================================

describe('maybeStartAutoReview gating', () => {
  it('no-op on non-validating transitions', () => {
    const res = maybeStartAutoReview('routing', 'coding', 'wf-x', { starter: () => { throw new Error('should not fire'); } });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'not-validating-transition');
  });

  it('no-op when disabled in config', () => {
    const res = maybeStartAutoReview('coding', 'validating', 'wf-y', {
      config: { autoReview: { enabled: false } },
      starter: () => { throw new Error('should not fire'); },
    });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'disabled');
  });

  it('no-op when taskId missing', () => {
    const res = maybeStartAutoReview('coding', 'validating', null, {
      config: { autoReview: { enabled: true } },
    });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'no-task-id');
  });

  it('invokes starter on coding→validating when enabled', () => {
    let called = null;
    const res = maybeStartAutoReview('coding', 'validating', 'wf-z', {
      config: { autoReview: { enabled: true } },
      starter: (o) => { called = o; return { taskId: o.taskId, pid: 12345 }; },
    });
    assert.equal(res.started, true);
    assert.equal(called.taskId, 'wf-z');
    assert.equal(res.handle.pid, 12345);
  });

  it('swallows starter errors (never fails the primary transition)', () => {
    const res = maybeStartAutoReview('coding', 'validating', 'wf-w', {
      config: { autoReview: { enabled: true } },
      starter: () => { throw new Error('spawn fail'); },
    });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'spawn-error');
    assert.ok(res.error.includes('spawn fail'));
  });
});

// ============================================================
// 7. summarizeFindingsForAudit shape
// ============================================================

describe('summarizeFindingsForAudit', () => {
  it('returns {present:false} when no record', () => {
    const res = summarizeFindingsForAudit('t-absent');
    assert.equal(res.present, false);
  });

  it('counts severities correctly and flags timeout', () => {
    writeFindings({
      taskId: 't-counts',
      status: 'complete',
      findings: [
        { severity: 'high', file: 'a', line: 1, claim: 'x', evidence: 'y' },
        { severity: 'high', file: 'b', line: 2, claim: 'x', evidence: 'y' },
        { severity: 'medium', file: 'c', line: 3, claim: 'x', evidence: 'y' },
        { severity: 'low', file: 'd', line: 4, claim: 'x', evidence: 'y' },
      ],
    });
    const res = summarizeFindingsForAudit('t-counts');
    assert.equal(res.present, true);
    assert.equal(res.counts.high, 2);
    assert.equal(res.counts.medium, 1);
    assert.equal(res.counts.low, 1);
    assert.equal(res.highSeverityCount, 2);
    assert.equal(res.timedOut, false);
  });

  it('flags timedOut when status is unverified-review-timeout', () => {
    writeFindings({ taskId: 't-to', status: 'unverified-review-timeout', findings: [] });
    const res = summarizeFindingsForAudit('t-to');
    assert.equal(res.timedOut, true);
  });
});
