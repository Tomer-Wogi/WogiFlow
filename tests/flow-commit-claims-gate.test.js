'use strict';

/**
 * Tests for the commit-vs-diff consistency gate (v2.25.1 — H2b).
 *
 * The gate parses finding IDs / task IDs / file paths from a commit
 * message and verifies each appears in the staged diff or changed-files
 * list. This is the mechanical enforcement layer for the Review-Findings
 * Anti-Deferral rule.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const {
  parseCommitMessageClaims,
  verifyCommitMessageAgainstDiff,
  formatMissingClaimsMessage
} = require('../scripts/flow-completion-truth-gate');

describe('parseCommitMessageClaims', () => {
  it('returns empty for empty/null input', () => {
    assert.deepEqual(parseCommitMessageClaims('').claims, []);
    assert.deepEqual(parseCommitMessageClaims(null).claims, []);
    assert.deepEqual(parseCommitMessageClaims(undefined).claims, []);
  });

  it('parses single-letter finding IDs (F1, M2, H3, L4)', () => {
    const { claims } = parseCommitMessageClaims('fix: addresses F1, F2, M1, H3, L5');
    const values = claims.map(c => c.value).sort();
    assert.deepEqual(values, ['F1', 'F2', 'H3', 'L5', 'M1']);
    assert.ok(claims.every(c => c.kind === 'finding-id'));
  });

  it('parses ALLCAPS-prefix finding IDs (SEC-001, PERF-002)', () => {
    const { claims } = parseCommitMessageClaims('fix: SEC-001 + PERF-002 regression');
    const values = claims.map(c => c.value).sort();
    assert.deepEqual(values, ['PERF-002', 'SEC-001']);
  });

  it('parses task IDs after fix/close/resolve verbs', () => {
    const { claims } = parseCommitMessageClaims(
      'feat: fixes wf-12345678 and closes wf-abcdef01, resolves wf-00112233'
    );
    const taskClaims = claims.filter(c => c.kind === 'task-id');
    const values = taskClaims.map(c => c.value).sort();
    assert.deepEqual(values, ['wf-00112233', 'wf-12345678', 'wf-abcdef01']);
  });

  it('does NOT parse bare wf-IDs without fix/close/resolve verb', () => {
    const { claims } = parseCommitMessageClaims('chore: touching wf-12345678 file');
    const taskClaims = claims.filter(c => c.kind === 'task-id');
    assert.equal(taskClaims.length, 0);
  });

  it('parses file paths in backticks after fix/address verbs', () => {
    const { claims } = parseCommitMessageClaims(
      'fix: addresses `src/auth.js` and updates `lib/worker.js`'
    );
    const fileClaims = claims.filter(c => c.kind === 'file');
    const values = fileClaims.map(c => c.value).sort();
    assert.deepEqual(values, ['lib/worker.js', 'src/auth.js']);
  });

  it('deduplicates repeated claims', () => {
    const { claims } = parseCommitMessageClaims('fix: F1, F1, F1');
    assert.equal(claims.length, 1);
  });
});

describe('verifyCommitMessageAgainstDiff', () => {
  it('ok=true when no claims in message', () => {
    const r = verifyCommitMessageAgainstDiff('chore: trivial update', { diffText: '' });
    assert.equal(r.ok, true);
    assert.equal(r.totalClaims, 0);
  });

  it('ok=true when all claims appear in diff body', () => {
    const r = verifyCommitMessageAgainstDiff('fix: addresses F1, F2, M1', {
      diffText: '+F1 fixed\n+F2 fixed\n+M1 fixed'
    });
    assert.equal(r.ok, true);
    assert.equal(r.totalClaims, 3);
    assert.equal(r.missingClaims.length, 0);
  });

  it('ok=false when a claim is missing from diff (the v2.17.4 incident scenario)', () => {
    const r = verifyCommitMessageAgainstDiff('fix: addresses F1, F2, F3, M1', {
      diffText: 'F1 fixed\nF2 fixed\nF3 fixed'
    });
    assert.equal(r.ok, false);
    assert.equal(r.missingClaims.length, 1);
    assert.equal(r.missingClaims[0].value, 'M1');
    assert.equal(r.verifiedClaims.length, 3);
  });

  it('file claims verify via changed-files list suffix match', () => {
    const r = verifyCommitMessageAgainstDiff('fix: addresses `src/auth.js`', {
      diffText: '',
      changedFiles: ['/some/path/to/src/auth.js']
    });
    assert.equal(r.ok, true);
  });

  it('file claim not in changed-files list → missing', () => {
    const r = verifyCommitMessageAgainstDiff('fix: addresses `src/auth.js`', {
      diffText: '',
      changedFiles: ['/some/path/to/lib/other.js']
    });
    assert.equal(r.ok, false);
    assert.equal(r.missingClaims[0].kind, 'file');
  });

  it('task-id claim verifies via diff substring match', () => {
    const r = verifyCommitMessageAgainstDiff('feat: fixes wf-12345678', {
      diffText: '+ // reference to wf-12345678\n+ doWork()',
      changedFiles: []
    });
    assert.equal(r.ok, true);
  });
});

describe('formatMissingClaimsMessage', () => {
  it('returns null when result is ok', () => {
    const r = verifyCommitMessageAgainstDiff('chore: trivial', {});
    assert.equal(formatMissingClaimsMessage(r), null);
  });

  it('formats missing claims with kind + value + remediation options', () => {
    const r = verifyCommitMessageAgainstDiff('fix: addresses F1, M1', {
      diffText: 'F1 fixed'
    });
    const msg = formatMissingClaimsMessage(r);
    assert.ok(msg);
    assert.match(msg, /Commit message claims 1 item\(s\)/);
    assert.match(msg, /M1/);
    assert.match(msg, /Add the missing fix/);
    assert.match(msg, /Remove the unverified claim/);
  });
});

describe('end-to-end: v2.17.4 incident replay', () => {
  it('would have caught the silent drop of M1 and M3', () => {
    // Historical scenario: commit message claimed "fixes all findings F1, F2, F3, M1"
    // but the diff actually only contained F1, F2, F3 (M1 was silently deferred).
    const commitMsg = 'fix: all review findings addressed — F1, F2, F3, M1';
    const actualDiff = 'index abc..def\n+F1: safeJsonParse applied\n+F2: validated input\n+F3: escaped output';
    const r = verifyCommitMessageAgainstDiff(commitMsg, { diffText: actualDiff });
    assert.equal(r.ok, false);
    assert.equal(r.missingClaims.length, 1);
    assert.equal(r.missingClaims[0].value, 'M1');

    const msg = formatMissingClaimsMessage(r);
    assert.match(msg, /M1/);
    assert.match(msg, /not found/);
  });
});
