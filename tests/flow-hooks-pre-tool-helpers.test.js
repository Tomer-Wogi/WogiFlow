'use strict';

/**
 * Tests for scripts/hooks/core/pre-tool-helpers.js (wf-93b48ca1 extraction).
 *
 * Covers: parseSubagentContext (agent-id validation regex, agent-type
 * allowlist, read-only type classification) + isAllGatesDisabled (fast-path
 * predicate over hook-status shape).
 *
 * This file is the first unit test for anything in scripts/hooks/core/ — it
 * establishes the pattern for wf-e9e31c7c (hook coverage story).
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-pre-tool-helpers.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  parseSubagentContext,
  isAllGatesDisabled,
  VALID_AGENT_TYPES,
  READ_ONLY_AGENT_TYPES,
} = require('../scripts/hooks/core/pre-tool-helpers');

// ============================================================
// parseSubagentContext
// ============================================================

describe('parseSubagentContext — agent ID validation', () => {
  it('accepts valid alphanumeric / underscore / hyphen IDs', () => {
    const r = parseSubagentContext({ agent_id: 'agent-123_abc' });
    assert.equal(r.agentId, 'agent-123_abc');
    assert.equal(r.isSubagent, true);
  });

  it('rejects empty string', () => {
    const r = parseSubagentContext({ agent_id: '' });
    assert.equal(r.agentId, null);
    assert.equal(r.isSubagent, false);
  });

  it('rejects IDs with spaces', () => {
    const r = parseSubagentContext({ agent_id: 'my agent' });
    assert.equal(r.agentId, null);
  });

  it('rejects IDs with special chars', () => {
    const r = parseSubagentContext({ agent_id: 'agent$%@' });
    assert.equal(r.agentId, null);
  });

  it('rejects IDs over 128 chars', () => {
    const r = parseSubagentContext({ agent_id: 'a'.repeat(129) });
    assert.equal(r.agentId, null);
  });

  it('accepts IDs exactly 128 chars', () => {
    const r = parseSubagentContext({ agent_id: 'a'.repeat(128) });
    assert.equal(r.agentId, 'a'.repeat(128));
  });

  it('rejects non-string agent_id', () => {
    assert.equal(parseSubagentContext({ agent_id: 123 }).agentId, null);
    assert.equal(parseSubagentContext({ agent_id: null }).agentId, null);
    assert.equal(parseSubagentContext({ agent_id: undefined }).agentId, null);
  });
});

describe('parseSubagentContext — agent type allowlist', () => {
  it('accepts known types', () => {
    for (const t of VALID_AGENT_TYPES) {
      const r = parseSubagentContext({ agent_id: 'a', agent_type: t });
      assert.equal(r.agentType, t, `should accept ${t}`);
    }
  });

  it('rejects unknown types', () => {
    const r = parseSubagentContext({ agent_id: 'a', agent_type: 'NotAReal-Type' });
    assert.equal(r.agentType, null);
  });

  it('rejects non-string agent_type', () => {
    assert.equal(parseSubagentContext({ agent_id: 'a', agent_type: 42 }).agentType, null);
  });
});

describe('parseSubagentContext — subagentReadOnly classification', () => {
  it('marks Explore / Plan / code-reviewer / bug-analyzer as read-only', () => {
    for (const t of ['Explore', 'Plan', 'code-reviewer', 'bug-analyzer']) {
      const r = parseSubagentContext({ agent_id: 'a', agent_type: t });
      assert.equal(r.subagentReadOnly, true, `${t} should be read-only`);
    }
  });

  it('does NOT mark general-purpose or statusline-setup as read-only', () => {
    const r1 = parseSubagentContext({ agent_id: 'a', agent_type: 'general-purpose' });
    const r2 = parseSubagentContext({ agent_id: 'a', agent_type: 'statusline-setup' });
    assert.equal(r1.subagentReadOnly, false);
    assert.equal(r2.subagentReadOnly, false);
  });

  it('is false when not a subagent (no agent_id)', () => {
    const r = parseSubagentContext({ agent_type: 'Explore' });
    assert.equal(r.isSubagent, false);
    assert.equal(r.subagentReadOnly, false);
  });
});

describe('parseSubagentContext — edge cases', () => {
  it('handles null input', () => {
    const r = parseSubagentContext(null);
    assert.equal(r.isSubagent, false);
    assert.equal(r.agentId, null);
    assert.equal(r.agentType, null);
  });

  it('handles undefined input', () => {
    const r = parseSubagentContext(undefined);
    assert.equal(r.isSubagent, false);
  });

  it('handles empty object', () => {
    const r = parseSubagentContext({});
    assert.equal(r.isSubagent, false);
  });

  it('READ_ONLY_AGENT_TYPES is a subset of VALID_AGENT_TYPES', () => {
    for (const t of READ_ONLY_AGENT_TYPES) {
      assert.ok(VALID_AGENT_TYPES.has(t), `${t} must be in VALID`);
    }
  });
});

// ============================================================
// isAllGatesDisabled
// ============================================================

describe('isAllGatesDisabled — hook-status fast path', () => {
  function buildHookStatus(overrides = {}) {
    return {
      enforcement: {
        taskGating: false,
        scopeGating: false,
        routingGate: false,
        commitLogGate: false,
        todoWriteGate: false,
        loopEnforcement: false,
        deployGate: false,
        strikeEscalation: false,
        bugfixScope: false,
        scopeMutation: false,
        gitSafety: false,
        ...(overrides.enforcement || {}),
      },
      componentReuse: false,
      phaseGate: false,
      phaseReadGate: false,
      ...overrides,
    };
  }

  it('returns true when all gates are explicitly disabled', () => {
    assert.equal(isAllGatesDisabled(buildHookStatus()), true);
  });

  it('returns false when any enforcement gate is enabled', () => {
    const hs = buildHookStatus({ enforcement: { taskGating: true } });
    assert.equal(isAllGatesDisabled(hs), false);
  });

  it('returns false when componentReuse is enabled', () => {
    const hs = buildHookStatus({ componentReuse: true });
    assert.equal(isAllGatesDisabled(hs), false);
  });

  it('returns false when phaseGate is enabled', () => {
    const hs = buildHookStatus({ phaseGate: true });
    assert.equal(isAllGatesDisabled(hs), false);
  });

  it('returns false when phaseReadGate is enabled', () => {
    const hs = buildHookStatus({ phaseReadGate: true });
    assert.equal(isAllGatesDisabled(hs), false);
  });

  it('returns false when enforcement is null / missing', () => {
    assert.equal(isAllGatesDisabled({ componentReuse: false, phaseGate: false, phaseReadGate: false }), false);
  });

  it('returns false for null input', () => {
    assert.equal(isAllGatesDisabled(null), false);
  });

  it('returns false for undefined input', () => {
    assert.equal(isAllGatesDisabled(undefined), false);
  });

  it('requires STRICT false — treats undefined / missing fields as not-disabled', () => {
    // If any field is undefined rather than explicitly false, the check should return false
    // (conservative — don't fast-path unless every gate is proven disabled).
    const hs = buildHookStatus();
    delete hs.enforcement.deployGate;
    assert.equal(isAllGatesDisabled(hs), false);
  });
});
