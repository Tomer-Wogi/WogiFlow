'use strict';

/**
 * Tests for scripts/hooks/core/gate-orchestrator.js (wf-35742353).
 *
 * Verifies the priority order, single-remediation selection, and the queued
 * footer rendering that prevents the gate-cascade conflict described in the
 * 2026-05-10 wogiflow-cli bug report.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-gate-orchestrator.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  REMEDIATION_PRIORITY,
  pickTopRemediation,
  renderRemediation,
  selectAndRender
} = require('../scripts/hooks/core/gate-orchestrator');

describe('gate-orchestrator — REMEDIATION_PRIORITY structural contract', () => {
  it('lists the four remediations in expected order', () => {
    assert.deepEqual(REMEDIATION_PRIORITY, [
      'long-input-pending',
      'routing',
      'research-required',
      'workspace-overdue'
    ]);
  });

  it('is frozen (cannot be mutated by callers)', () => {
    assert.throws(() => { REMEDIATION_PRIORITY.push('foo'); }, /read only|frozen|immutable|Cannot add/i);
  });
});

describe('gate-orchestrator — pickTopRemediation', () => {
  it('returns null/empty when no gates active', () => {
    assert.deepEqual(pickTopRemediation([]), { top: null, queued: [] });
    assert.deepEqual(pickTopRemediation(null), { top: null, queued: [] });
    assert.deepEqual(pickTopRemediation(undefined), { top: null, queued: [] });
  });

  it('picks long-input-pending over research-required', () => {
    const r = pickTopRemediation([
      { id: 'research-required', message: 'read evidence' },
      { id: 'long-input-pending', message: 'invoke extract-review' }
    ]);
    assert.equal(r.top.id, 'long-input-pending');
    assert.equal(r.top.message, 'invoke extract-review');
    assert.deepEqual(r.queued, ['research-required']);
  });

  it('picks routing over research-required + workspace-overdue', () => {
    const r = pickTopRemediation([
      { id: 'workspace-overdue', message: 'silent worker' },
      { id: 'research-required', message: 'read evidence' },
      { id: 'routing', message: 'invoke wogi-start' }
    ]);
    assert.equal(r.top.id, 'routing');
    assert.deepEqual(r.queued, ['research-required', 'workspace-overdue']);
  });

  it('ignores entries with empty messages', () => {
    const r = pickTopRemediation([
      { id: 'long-input-pending', message: '' },
      { id: 'research-required', message: 'read evidence' }
    ]);
    assert.equal(r.top.id, 'research-required');
    assert.deepEqual(r.queued, []);
  });

  it('unknown gate ids sort to the bottom', () => {
    const r = pickTopRemediation([
      { id: 'totally-made-up', message: 'mystery' },
      { id: 'routing', message: 'go' }
    ]);
    assert.equal(r.top.id, 'routing');
    assert.deepEqual(r.queued, ['totally-made-up']);
  });
});

describe('gate-orchestrator — renderRemediation', () => {
  it('returns the top message unchanged when no queued items', () => {
    const out = renderRemediation({ id: 'routing', message: 'go to wogi-start' }, []);
    assert.equal(out, 'go to wogi-start');
  });

  it('appends a queued footer when other gates are pending', () => {
    const out = renderRemediation(
      { id: 'long-input-pending', message: 'RESOLVE LONG-INPUT' },
      ['research-required']
    );
    assert.match(out, /^RESOLVE LONG-INPUT/);
    assert.match(out, /\[gate-orchestrator\] Also queued/);
    assert.match(out, /research-required/);
  });

  it('returns empty string for missing top', () => {
    assert.equal(renderRemediation(null, []), '');
    assert.equal(renderRemediation(undefined, []), '');
  });
});

describe('gate-orchestrator — selectAndRender end-to-end', () => {
  it('wf-35742353 cascade case: long-input + research-required → only long-input surfaces', () => {
    const out = selectAndRender({
      'long-input-pending': '🚨 Invoke /wogi-extract-review NOW.',
      'research-required': 'RESEARCH-REQUIRED VIOLATION: read evidence first.'
    });
    // long-input wins; research-required appears only in queued footer
    assert.match(out, /Invoke \/wogi-extract-review NOW\./);
    assert.match(out, /Also queued.*research-required/);
    // The full research-required prose is NOT in the surfaced text — that's
    // the point of the orchestrator. Only one full message at a time.
    assert.equal(out.includes('RESEARCH-REQUIRED VIOLATION'), false);
  });

  it('only one gate active → no queued footer', () => {
    const out = selectAndRender({
      'research-required': 'read evidence'
    });
    assert.equal(out, 'read evidence');
  });

  it('returns empty string when no gates active', () => {
    assert.equal(selectAndRender({}), '');
    assert.equal(selectAndRender({ 'long-input-pending': null, 'research-required': '' }), '');
    assert.equal(selectAndRender(null), '');
  });
});
