'use strict';

/**
 * Tests for research-evidence-gate.js (Story 15 / wf-a97af500).
 *
 * Covers the 4 public entry points (pass / block / error paths each):
 *   - recordEvidenceRead
 *   - checkSpecWriteGate
 *   - checkDispatchEvidenceGate
 *   - checkPhaseTransitionEvidence
 *   - clearResearchEvidence (helper)
 *
 * Run: node --test tests/flow-hooks-research-evidence-gate.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('../scripts/hooks/core/research-evidence-gate');

// Backup the live evidence file around each test so the project's own
// state isn't polluted by test runs.
let backup = null;
const EVIDENCE_FILE = gate.EVIDENCE_FILE;

function backupEvidence() {
  if (fs.existsSync(EVIDENCE_FILE)) backup = fs.readFileSync(EVIDENCE_FILE);
  else backup = null;
}

function restoreEvidence() {
  if (backup === null) {
    if (fs.existsSync(EVIDENCE_FILE)) fs.unlinkSync(EVIDENCE_FILE);
  } else {
    fs.writeFileSync(EVIDENCE_FILE, backup);
  }
  backup = null;
}

describe('recordEvidenceRead — pass / block / error', () => {
  beforeEach(() => { backupEvidence(); gate.clearResearchEvidence(); });
  afterEach(restoreEvidence);

  it('records evidence files matching EVIDENCE_PREFIXES', () => {
    const filePath = path.join(process.cwd(), '.workflow/state/decisions.md');
    gate.recordEvidenceRead(filePath);
    assert.equal(gate.getEvidenceCount(), 1);
  });

  it('does not record files outside evidence prefixes', () => {
    const filePath = path.join(process.cwd(), 'README.md');
    gate.recordEvidenceRead(filePath);
    assert.equal(gate.getEvidenceCount(), 0);
  });

  it('deduplicates repeated reads of the same file', () => {
    const filePath = path.join(process.cwd(), '.workflow/state/decisions.md');
    gate.recordEvidenceRead(filePath);
    gate.recordEvidenceRead(filePath);
    gate.recordEvidenceRead(filePath);
    assert.equal(gate.getEvidenceCount(), 1);
  });

  it('handles non-string input gracefully (no throw)', () => {
    gate.recordEvidenceRead(null);
    gate.recordEvidenceRead(undefined);
    gate.recordEvidenceRead(123);
    assert.equal(gate.getEvidenceCount(), 0);
  });
});

describe('checkSpecWriteGate — pass / block / error', () => {
  beforeEach(() => { backupEvidence(); gate.clearResearchEvidence(); });
  afterEach(restoreEvidence);

  it('passes when target is NOT a proposal path', () => {
    const r = gate.checkSpecWriteGate(path.join(process.cwd(), 'README.md'), {});
    assert.equal(r.blocked, false);
  });

  it('blocks proposal writes when evidence below threshold', () => {
    const r = gate.checkSpecWriteGate(
      path.join(process.cwd(), '.workflow/changes/wf-12345678.md'),
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, true);
    assert.match(r.message, /Research-before-propose/);
  });

  it('passes proposal writes when evidence meets threshold', () => {
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/decisions.md'));
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/feedback-patterns.md'));
    const r = gate.checkSpecWriteGate(
      path.join(process.cwd(), '.workflow/changes/wf-12345678.md'),
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, false);
  });

  it('passes when gate is disabled via config', () => {
    const r = gate.checkSpecWriteGate(
      path.join(process.cwd(), '.workflow/changes/wf-12345678.md'),
      { hooks: { rules: { researchEvidenceGate: false } } }
    );
    assert.equal(r.blocked, false);
  });

  it('passes when gate is disabled via { enabled: false }', () => {
    const r = gate.checkSpecWriteGate(
      path.join(process.cwd(), '.workflow/changes/wf-12345678.md'),
      { hooks: { rules: { researchEvidenceGate: { enabled: false } } } }
    );
    assert.equal(r.blocked, false);
  });

  it('error path: invalid file_path falls open', () => {
    const r = gate.checkSpecWriteGate(null, {});
    assert.equal(r.blocked, false);
    const r2 = gate.checkSpecWriteGate(undefined, {});
    assert.equal(r2.blocked, false);
  });
});

describe('checkDispatchEvidenceGate — manager-only', () => {
  let savedEnv;
  beforeEach(() => {
    backupEvidence();
    gate.clearResearchEvidence();
    savedEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    restoreEvidence();
  });

  it('passes outside workspace mode (no env vars)', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_REPO_NAME;
    const r = gate.checkDispatchEvidenceGate({});
    assert.equal(r.blocked, false);
  });

  it('passes for workers (not manager)', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'frontend';
    const r = gate.checkDispatchEvidenceGate({});
    assert.equal(r.blocked, false);
  });

  it('blocks manager when below threshold', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    const r = gate.checkDispatchEvidenceGate(
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, true);
    assert.match(r.message, /Research-before-dispatch/);
  });

  it('passes manager when threshold met', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/decisions.md'));
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/feedback-patterns.md'));
    const r = gate.checkDispatchEvidenceGate(
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, false);
  });
});

describe('checkPhaseTransitionEvidence — pass / block', () => {
  beforeEach(() => { backupEvidence(); gate.clearResearchEvidence(); });
  afterEach(restoreEvidence);

  it('passes when target phase is non-proposal (e.g. exploring)', () => {
    const r = gate.checkPhaseTransitionEvidence('idle', 'exploring', {});
    assert.equal(r.blocked, false);
  });

  it('blocks transition to spec_review when below threshold', () => {
    const r = gate.checkPhaseTransitionEvidence('exploring', 'spec_review',
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, true);
    assert.match(r.message, /spec_review/);
  });

  it('blocks transition to coding when below threshold', () => {
    const r = gate.checkPhaseTransitionEvidence('routing', 'coding',
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, true);
  });

  it('passes transition to spec_review when threshold met', () => {
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/decisions.md'));
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/app-map.md'));
    const r = gate.checkPhaseTransitionEvidence('exploring', 'spec_review',
      { hooks: { rules: { researchEvidenceGate: { enabled: true, minEvidence: 2 } } } }
    );
    assert.equal(r.blocked, false);
  });

  it('passes any transition when gate disabled', () => {
    const r = gate.checkPhaseTransitionEvidence('exploring', 'coding',
      { hooks: { rules: { researchEvidenceGate: { enabled: false } } } }
    );
    assert.equal(r.blocked, false);
  });
});

describe('clearResearchEvidence', () => {
  beforeEach(() => { backupEvidence(); gate.clearResearchEvidence(); });
  afterEach(restoreEvidence);

  it('resets the count to zero', () => {
    gate.recordEvidenceRead(path.join(process.cwd(), '.workflow/state/decisions.md'));
    assert.equal(gate.getEvidenceCount(), 1);
    gate.clearResearchEvidence();
    assert.equal(gate.getEvidenceCount(), 0);
  });
});
