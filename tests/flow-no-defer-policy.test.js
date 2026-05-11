'use strict';

/**
 * Tests for scripts/hooks/core/no-defer-policy.js (wf-b8839d99).
 *
 * Verifies that an active no-defer policy in decisions.md triggers a pin
 * refresh, and that the absence of policy is a no-op.
 *
 * Run: NODE_ENV=test node --test tests/flow-no-defer-policy.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withProject(fn) {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-no-defer-policy-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.workflow', 'config.json'), JSON.stringify({}));
  process.chdir(tmp);
  // Evict caches so flow-paths discovers the tmp project
  delete require.cache[require.resolve('../scripts/flow-paths')];
  delete require.cache[require.resolve('../scripts/flow-utils')];
  delete require.cache[require.resolve('../scripts/hooks/core/no-defer-policy')];
  delete require.cache[require.resolve('../scripts/hooks/core/deferral-gate')];
  try {
    const policy = require('../scripts/hooks/core/no-defer-policy');
    const gate = require('../scripts/hooks/core/deferral-gate');
    fn(tmp, policy, gate);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/flow-paths')];
    delete require.cache[require.resolve('../scripts/flow-utils')];
    delete require.cache[require.resolve('../scripts/hooks/core/no-defer-policy')];
    delete require.cache[require.resolve('../scripts/hooks/core/deferral-gate')];
  }
}

describe('no-defer-policy — detectPolicy', () => {
  it('returns active:false when decisions.md is absent', () => {
    withProject((_tmp, policy) => {
      assert.deepEqual(policy.detectPolicy(), { active: false });
    });
  });

  it('returns active:false when decisions.md has no policy header', () => {
    withProject((tmp, policy) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '# Decisions\n\n## Some Other Decision\nRandom content.\n');
      assert.deepEqual(policy.detectPolicy(), { active: false });
    });
  });

  it('returns active:true when "No-Deferral Policy" header is present with "active" marker', () => {
    withProject((tmp, policy) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '# Decisions\n\n## No-Deferral Policy\nStatus: active. Owner does not authorize deferrals under any circumstance.\n');
      const r = policy.detectPolicy();
      assert.equal(r.active, true);
      assert.match(r.header, /No-Deferral Policy/);
    });
  });

  it('also accepts "Anti-Tech-Debt Policy" header', () => {
    withProject((tmp, policy) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '## Anti-Tech-Debt Policy\n\nEnforced project-wide.\n');
      assert.equal(policy.detectPolicy().active, true);
    });
  });

  it('returns active:false when header exists but no "active|enabled|enforced" marker', () => {
    withProject((tmp, policy) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '## No-Deferral Policy\nWe used to have this rule but no longer.\n');
      assert.equal(policy.detectPolicy().active, false);
    });
  });

  it('is case-insensitive on the header', () => {
    withProject((tmp, policy) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '## NO-DEFERRAL POLICY\n\nEnabled.\n');
      assert.equal(policy.detectPolicy().active, true);
    });
  });
});

describe('no-defer-policy — refreshFromPolicy', () => {
  it('writes a pin when policy is active', () => {
    withProject((tmp, policy, gate) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '## No-Deferral Policy\n\nActive — never defer findings.\n');
      const r = policy.refreshFromPolicy();
      assert.equal(r.refreshed, true);
      const pin = gate.loadNoDeferPin();
      assert.ok(pin, 'pin must be written');
      assert.equal(pin.standing, true);
      assert.equal(pin.grantedBy, 'decisions-policy');
    });
  });

  it('returns refreshed:false when no policy active (no-op)', () => {
    withProject((tmp, policy, gate) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '# Decisions\n\nNothing relevant.\n');
      const r = policy.refreshFromPolicy();
      assert.equal(r.refreshed, false);
      assert.equal(gate.loadNoDeferPin(), null);
    });
  });

  it('the resulting pin has a long TTL (≥7 days)', () => {
    withProject((tmp, policy, gate) => {
      fs.writeFileSync(path.join(tmp, '.workflow', 'state', 'decisions.md'),
        '## No-Deferral Policy\n\nActive.\n');
      policy.refreshFromPolicy();
      const pin = gate.loadNoDeferPin();
      const ttlMs = Date.parse(pin.expiresAt) - Date.parse(pin.pinnedAt);
      assert.ok(ttlMs >= 7 * 24 * 3600 * 1000, `pin TTL ${ttlMs / 86400000} days should be >= 7`);
    });
  });
});
