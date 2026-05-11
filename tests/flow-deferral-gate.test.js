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

// wf-4a5b7a6f (2026-05-11): the prior implementation false-positively blocked
// any Bash command that contained both the literal string "last-review.json"
// AND the bare word "deferred" anywhere — including in heredoc release notes,
// commit messages, and markdown blockquotes. Fix: structural tokenizer +
// JSON-shape-only deferral-content check.
describe('wf-4a5b7a6f — checkBashGate over-trigger regressions', () => {
  it('does NOT block `gh release create` with notes that mention both terms as text', () => {
    withProject((_tmp, gate) => {
      const cmd = `gh release create v2.30.3 --title "release" --notes "see last-review.json for the 7 deferred findings we addressed"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false, 'mere mentions in --notes text must not trigger the gate');
    });
  });

  it('does NOT block heredoc release notes containing markdown blockquote `>`', () => {
    withProject((_tmp, gate) => {
      const cmd = `gh release create v2.30.3 --notes "$(cat <<'EOF'
> "I don't like tech debt"

See last-review.json for the deferred items.
EOF
)"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false, 'markdown blockquote `>` inside heredoc must not match shell redirect');
    });
  });

  it('does NOT block git commit with message mentioning both terms', () => {
    withProject((_tmp, gate) => {
      const cmd = `git commit -m "fix: close deferred findings in last-review.json"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false, 'commit messages are not mutations of the target');
    });
  });

  it('does NOT block bare-word "deferred" in prose with a write to a DIFFERENT file', () => {
    withProject((_tmp, gate) => {
      const cmd = `echo "the deferred work is logged" > /tmp/notes.txt`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false);
    });
  });

  it('STILL blocks a shell redirect of deferred JSON content into the target file', () => {
    withProject((_tmp, gate) => {
      const cmd = `echo '{"findings":[{"id":"F1","status":"deferred"}]}' > .workflow/state/last-review.json`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true, 'genuine shell redirect of deferred JSON must still block');
    });
  });

  it('STILL blocks tee writes of deferred content to the target file', () => {
    withProject((_tmp, gate) => {
      const cmd = `echo '{"findings":[{"id":"F1","status":"deferred"}]}' | tee .workflow/state/last-review.json`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
    });
  });

  it('STILL blocks node writeFileSync to target with deferred status', () => {
    withProject((_tmp, gate) => {
      const cmd = `node -e "require('fs').writeFileSync('.workflow/state/last-review.json', '{\\"findings\\":[{\\"status\\":\\"deferred\\"}]}')"`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, true);
    });
  });

  it('does NOT block prose with "wont-fix" / "skipped" as text (JSON-shape required)', () => {
    withProject((_tmp, gate) => {
      const cmd = `gh release create --notes "this PR is wont-fix and we skipped F5. last-review.json is updated."`;
      const r = gate.checkBashGate(cmd, DUMMY_CONFIG);
      assert.strictEqual(r.blocked, false, 'mere mention of wont-fix/skipped as prose must not block');
    });
  });
});

describe('wf-4a5b7a6f — stripQuotedContent helper', () => {
  it('removes content inside single quotes', () => {
    const { stripQuotedContent } = require('../scripts/hooks/core/deferral-gate');
    const out = stripQuotedContent(`echo 'hello world' > file`);
    assert.match(out, /^echo\s+''\s+>\s+file$/);
  });

  it('removes content inside double quotes (including escapes)', () => {
    const { stripQuotedContent } = require('../scripts/hooks/core/deferral-gate');
    const out = stripQuotedContent(`echo "hello \\"world\\"" > file`);
    assert.match(out, /^echo\s+""\s+>\s+file$/);
  });

  it('removes backtick content', () => {
    const { stripQuotedContent } = require('../scripts/hooks/core/deferral-gate');
    const out = stripQuotedContent('echo `date` > file');
    assert.match(out, /^echo\s+``\s+>\s+file$/);
  });

  it('removes heredoc body', () => {
    const { stripQuotedContent } = require('../scripts/hooks/core/deferral-gate');
    const cmd = `cat <<'EOF' > file
some > "blockquote"
last-review.json
EOF`;
    const out = stripQuotedContent(cmd);
    assert.equal(out.includes('blockquote'), false);
    assert.equal(out.includes('last-review.json'), false);
  });

  it('preserves shell redirects OUTSIDE quotes', () => {
    const { stripQuotedContent } = require('../scripts/hooks/core/deferral-gate');
    const out = stripQuotedContent(`echo 'x' > target.json`);
    assert.match(out, />\s+target\.json/);
  });
});

// wf-b8839d99 (2026-05-11): the prior regex-based intent-detection block was
// removed. Intent-classification accuracy is now tested in
// tests/flow-deferral-classifier-ai.test.js (prompt-building + fail-open
// paths). Live-API accuracy is verified via separate regression-style
// integration tests. See the spec for rationale.
