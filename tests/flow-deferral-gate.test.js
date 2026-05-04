'use strict';

/**
 * Tests for the mechanical Deferral Authorization Gate (wf-f9912af6).
 *
 * Covers:
 *   - detectDeferralChanges (transition detection, grandfathering)
 *   - checkWriteGate (Write/Edit blocking)
 *   - checkBashGate (mutating bash commands with deferral content)
 *   - Auth marker write/load/expiry/consume
 *   - No-defer-pin overrides positive auth
 *   - Classifier intent detection (positive / negative / none)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GATE_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'deferral-gate.js');
const CLASSIFIER_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'deferral-classifier.js');
const FLOW_PATHS = path.resolve(__dirname, '..', 'scripts', 'flow-paths.js');
const FLOW_UTILS = path.resolve(__dirname, '..', 'scripts', 'flow-utils.js');
const FLOW_IO = path.resolve(__dirname, '..', 'scripts', 'flow-io.js');

function evictCaches() {
  [GATE_PATH, CLASSIFIER_PATH, FLOW_PATHS, FLOW_UTILS, FLOW_IO].forEach((p) => {
    try { delete require.cache[require.resolve(p)]; } catch (_err) { /* */ }
  });
}

function withProject(fn) {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-deferral-test-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.workflow', 'config.json'), JSON.stringify({ deferralGate: { enabled: true } }));
  process.chdir(tmp);
  try {
    evictCaches();
    const gate = require(GATE_PATH);
    const classifier = require(CLASSIFIER_PATH);
    fn(tmp, gate, classifier);
  } finally {
    process.chdir(originalCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* */ }
    evictCaches();
  }
}

const DUMMY_CONFIG = { deferralGate: { enabled: true, authTtlSeconds: 600 } };

function reviewWith(findings) {
  return JSON.stringify({ reviewDate: '2026-05-04T00:00:00Z', findings });
}

describe('deferral-gate — detectDeferralChanges', () => {
  it('detects transition into deferred from non-deferred', () => {
    withProject((_tmp, gate) => {
      const prev = { findings: [{ id: 'F1', status: 'fixed' }] };
      const curr = { findings: [{ id: 'F1', status: 'deferred' }] };
      const changes = gate.detectDeferralChanges(prev, curr);
      assert.strictEqual(changes.length, 1);
      assert.strictEqual(changes[0].id, 'F1');
      assert.strictEqual(changes[0].newStatus, 'deferred');
    });
  });

  it('grandfathers pre-existing deferrals (same finding, deferred → deferred)', () => {
    withProject((_tmp, gate) => {
      const prev = { findings: [{ id: 'F1', status: 'deferred' }] };
      const curr = { findings: [{ id: 'F1', status: 'deferred-adversary-found' }] };
      const changes = gate.detectDeferralChanges(prev, curr);
      assert.strictEqual(changes.length, 0, 'deferred → deferred-* must be grandfathered');
    });
  });

  it('detects new finding introduced as deferred (initial-write case)', () => {
    withProject((_tmp, gate) => {
      const prev = { findings: [] };
      const curr = { findings: [{ id: 'F2', status: 'deferred' }] };
      const changes = gate.detectDeferralChanges(prev, curr);
      assert.strictEqual(changes.length, 1);
    });
  });

  it('handles null prev (initial review write)', () => {
    withProject((_tmp, gate) => {
      const curr = { findings: [{ id: 'F1', status: 'deferred' }] };
      const changes = gate.detectDeferralChanges(null, curr);
      assert.strictEqual(changes.length, 1, 'initial write with deferred finding must be flagged');
    });
  });

  it('does NOT flag fixed → fixed or deferred → fixed', () => {
    withProject((_tmp, gate) => {
      const prev = { findings: [{ id: 'F1', status: 'deferred' }, { id: 'F2', status: 'fixed' }] };
      const curr = { findings: [{ id: 'F1', status: 'fixed' }, { id: 'F2', status: 'fixed' }] };
      const changes = gate.detectDeferralChanges(prev, curr);
      assert.strictEqual(changes.length, 0);
    });
  });
});

describe('deferral-gate — checkWriteGate', () => {
  it('blocks Write of last-review.json that introduces a deferral without auth', () => {
    withProject((tmp, gate) => {
      // Pre-existing review with no deferrals
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      // New content tries to defer F1
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
      assert.match(r.message, /Deferral-gate BLOCKED/);
      assert.match(r.message, /F1/);
    });
  });

  it('blocks Write of last-audit.json (same gate applies to audits)', () => {
    withProject((tmp, gate) => {
      const auditPath = path.join(tmp, '.workflow', 'state', 'last-audit.json');
      fs.writeFileSync(auditPath, reviewWith([{ id: 'A1', status: 'open' }]));
      const newContent = reviewWith([{ id: 'A1', status: 'wont-fix' }]);
      const r = gate.checkWriteGate(auditPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
    });
  });

  it('allows Write when auth marker is present and covers all findings', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      gate.writeAuth({ scope: 'all', source: 'test grant', config: DUMMY_CONFIG });
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('blocks when auth scope is specific finding IDs and the deferral is for a different ID', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }, { id: 'F2', status: 'fixed' }]));
      gate.writeAuth({ scope: ['F2'], source: 'test grant', config: DUMMY_CONFIG });
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }, { id: 'F2', status: 'fixed' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true, 'auth for F2 should not authorize deferring F1');
    });
  });

  it('allows when status changes from deferred → fixed (cleanup path)', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'deferred' }]));
      const newContent = reviewWith([{ id: 'F1', status: 'fixed' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('blocks initial review write that includes deferrals', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      // No prior file
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
    });
  });

  it('allows initial review write without deferrals', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      const newContent = reviewWith([{ id: 'F1', status: 'fixed' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('returns blocked:false for non-target files (passthrough)', () => {
    withProject((tmp, gate) => {
      const otherPath = path.join(tmp, 'something-else.json');
      const r = gate.checkWriteGate(otherPath, reviewWith([{ id: 'F1', status: 'deferred' }]), DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('returns blocked:false when gate is disabled in config', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, { deferralGate: { enabled: false } });
      assert.strictEqual(r.blocked, false);
    });
  });
});

describe('deferral-gate — auth expiry + consumption', () => {
  it('expired auth marker is treated as absent', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      // Write an auth marker that's already expired
      const past = new Date(Date.now() - 60_000).toISOString();
      fs.writeFileSync(gate.getAuthPath(), JSON.stringify({
        version: 1, grantedAt: past, expiresAt: past, scope: 'all', grantedBy: 'test', source: 't'
      }));
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true, 'expired auth must NOT authorize');
    });
  });

  it('auth is consumed (deleted) after a successful deferral write', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      gate.writeAuth({ scope: 'all', source: 'test', config: DUMMY_CONFIG });
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
      // Auth should be gone now
      assert.strictEqual(gate.loadAuth(), null, 'auth marker should be consumed after use');
    });
  });
});

describe('deferral-gate — no-defer-pin overrides positive auth', () => {
  it('hard-blocks even when auth is present', () => {
    withProject((tmp, gate) => {
      const reviewPath = path.join(tmp, '.workflow', 'state', 'last-review.json');
      fs.writeFileSync(reviewPath, reviewWith([{ id: 'F1', status: 'fixed' }]));
      gate.writeAuth({ scope: 'all', source: 'test', config: DUMMY_CONFIG });
      gate.writeNoDeferPin({ source: 'user said no deferrals' });
      // After writeNoDeferPin, auth is cleared (negative-overrides-positive)
      assert.strictEqual(gate.loadAuth(), null);
      const newContent = reviewWith([{ id: 'F1', status: 'deferred' }]);
      const r = gate.checkWriteGate(reviewPath, newContent, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
      assert.match(r.message, /no-defer-pin/i);
    });
  });
});

describe('deferral-gate — checkBashGate', () => {
  it('blocks bash that mutates last-review.json with deferral content (no auth)', () => {
    withProject((_tmp, gate) => {
      const cmd = `node -e "fs.writeFileSync('.workflow/state/last-review.json', JSON.stringify({findings:[{id:'F1',status:'deferred'}]}))"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
    });
  });

  it('allows bash that READS last-review.json (cat/jq/grep)', () => {
    withProject((_tmp, gate) => {
      assert.strictEqual(gate.checkBashGate('cat .workflow/state/last-review.json', DUMMY_CONFIG).blocked, false);
      assert.strictEqual(gate.checkBashGate('jq .findings .workflow/state/last-review.json', DUMMY_CONFIG).blocked, false);
      assert.strictEqual(gate.checkBashGate('grep deferred .workflow/state/last-review.json', DUMMY_CONFIG).blocked, false);
    });
  });

  it('allows bash that mutates the file but does NOT mention deferral', () => {
    withProject((_tmp, gate) => {
      const cmd = `node -e "fs.writeFileSync('.workflow/state/last-review.json', JSON.stringify({findings:[{id:'F1',status:'fixed'}]}))"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('allows bash with deferral content when auth is present', () => {
    withProject((_tmp, gate) => {
      gate.writeAuth({ scope: 'all', source: 'test', config: DUMMY_CONFIG });
      const cmd = `node -e "fs.writeFileSync('.workflow/state/last-review.json', JSON.stringify({findings:[{id:'F1',status:'deferred'}]}))"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });
});

describe('deferral-classifier — intent detection', () => {
  it('detects negative intent: "fix everything"', () => {
    withProject((_tmp, _gate, clf) => {
      const r = clf.classifyDeferralIntent('please fix everything in the review');
      assert.strictEqual(r.intent, 'negative');
    });
  });

  it('detects negative intent: "no deferrals"', () => {
    withProject((_tmp, _gate, clf) => {
      assert.strictEqual(clf.classifyDeferralIntent('I want no deferrals on this').intent, 'negative');
      assert.strictEqual(clf.classifyDeferralIntent("don't defer anything").intent, 'negative');
      assert.strictEqual(clf.classifyDeferralIntent("I don't like tech debt").intent, 'negative');
    });
  });

  it('detects positive intent: "defer this"', () => {
    withProject((_tmp, _gate, clf) => {
      const r = clf.classifyDeferralIntent('please defer this finding for now');
      assert.strictEqual(r.intent, 'positive');
    });
  });

  it('detects positive intent: option N from review menu', () => {
    withProject((_tmp, _gate, clf) => {
      assert.strictEqual(clf.classifyDeferralIntent('option 4').intent, 'positive');
      assert.strictEqual(clf.classifyDeferralIntent('option 2 please').intent, 'positive');
    });
  });

  it('detects positive intent: severity-scoped defer', () => {
    withProject((_tmp, _gate, clf) => {
      assert.strictEqual(clf.classifyDeferralIntent('fix critical only').intent, 'positive');
      assert.strictEqual(clf.classifyDeferralIntent('fix high first').intent, 'positive');
    });
  });

  it('returns none for unrelated prompts', () => {
    withProject((_tmp, _gate, clf) => {
      assert.strictEqual(clf.classifyDeferralIntent('add a button to the login page').intent, 'none');
      assert.strictEqual(clf.classifyDeferralIntent('what is the meaning of life').intent, 'none');
    });
  });

  it('negative takes precedence over positive in mixed prompt', () => {
    withProject((_tmp, _gate, clf) => {
      const r = clf.classifyDeferralIntent('fix everything, also defer F5');
      assert.strictEqual(r.intent, 'negative');
    });
  });

  it('applyClassification writes auth on positive', () => {
    withProject((_tmp, gate, clf) => {
      const r = clf.applyClassification('option 4 please', DUMMY_CONFIG);
      assert.strictEqual(r.applied, true);
      assert.strictEqual(r.intent, 'positive');
      const auth = gate.loadAuth();
      assert.ok(auth, 'auth marker must exist after positive classification');
    });
  });

  it('applyClassification writes no-defer-pin on negative AND clears any prior auth', () => {
    withProject((_tmp, gate, clf) => {
      gate.writeAuth({ scope: 'all', source: 'prior', config: DUMMY_CONFIG });
      assert.ok(gate.loadAuth());
      const r = clf.applyClassification('I want fix everything, no deferrals', DUMMY_CONFIG);
      assert.strictEqual(r.applied, true);
      assert.strictEqual(r.intent, 'negative');
      assert.strictEqual(gate.loadAuth(), null, 'prior auth must be cleared');
      assert.ok(gate.loadNoDeferPin(), 'no-defer-pin must be written');
    });
  });
});
