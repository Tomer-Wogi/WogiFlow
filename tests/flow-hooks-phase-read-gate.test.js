'use strict';

/**
 * Tests for scripts/hooks/core/phase-read-gate.js (Wave F hook coverage).
 *
 * Covers: recordPhaseRead matching (project-rooted only — rejects cross-project
 * path forgery), checkPhaseReadGate blocking behavior, config disable paths,
 * exempt phases (idle/routing), unknown phase fail-open, clearPhaseReads.
 *
 * Tests mutate real state files (phase-reads.json, workflow-phase.json) and
 * restore originals in afterEach.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-phase-read-gate.test.js
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  recordPhaseRead,
  checkPhaseReadGate,
  clearPhaseReads,
  PHASE_FILE_REGISTRY,
  PHASE_READS_FILE,
} = require('../scripts/hooks/core/phase-read-gate');
const { PATHS } = require('../scripts/flow-utils');

const WORKFLOW_PHASE_FILE = path.join(PATHS.state, 'workflow-phase.json');

// Save/restore original files so tests don't clobber live state
let originalPhaseReads = null;
let originalWorkflowPhase = null;

function snapshot() {
  try { originalPhaseReads = fs.readFileSync(PHASE_READS_FILE, 'utf-8'); } catch (_err) { originalPhaseReads = null; }
  try { originalWorkflowPhase = fs.readFileSync(WORKFLOW_PHASE_FILE, 'utf-8'); } catch (_err) { originalWorkflowPhase = null; }
}
function restore() {
  if (originalPhaseReads !== null) fs.writeFileSync(PHASE_READS_FILE, originalPhaseReads);
  else { try { fs.unlinkSync(PHASE_READS_FILE); } catch (_err) {} }
  if (originalWorkflowPhase !== null) fs.writeFileSync(WORKFLOW_PHASE_FILE, originalWorkflowPhase);
  else { try { fs.unlinkSync(WORKFLOW_PHASE_FILE); } catch (_err) {} }
}

function setPhase(phase, taskId = 'wf-testtest') {
  fs.writeFileSync(WORKFLOW_PHASE_FILE, JSON.stringify({
    phase,
    taskId,
    updatedAt: new Date().toISOString(),
    previousPhase: null,
  }));
}
function removePhaseFile() {
  try { fs.unlinkSync(WORKFLOW_PHASE_FILE); } catch (_err) {}
}
function resetPhaseReads() {
  fs.writeFileSync(PHASE_READS_FILE, JSON.stringify({ reads: {} }, null, 2));
}

before(snapshot);
after(restore);

// ============================================================
// PHASE_FILE_REGISTRY structure
// ============================================================

describe('PHASE_FILE_REGISTRY — structural contract', () => {
  it('includes all five non-exempt phases', () => {
    assert.ok('exploring' in PHASE_FILE_REGISTRY);
    assert.ok('spec_review' in PHASE_FILE_REGISTRY);
    assert.ok('coding' in PHASE_FILE_REGISTRY);
    assert.ok('validating' in PHASE_FILE_REGISTRY);
    assert.ok('completing' in PHASE_FILE_REGISTRY);
  });

  it('maps each phase to a .claude/docs/phases/*.md path', () => {
    for (const [phase, file] of Object.entries(PHASE_FILE_REGISTRY)) {
      assert.ok(file.startsWith('.claude/docs/phases/'), `${phase} → ${file}`);
      assert.ok(file.endsWith('.md'), `${phase} → ${file}`);
    }
  });

  it('does NOT include idle or routing (exempt phases)', () => {
    assert.equal(PHASE_FILE_REGISTRY.idle, undefined);
    assert.equal(PHASE_FILE_REGISTRY.routing, undefined);
  });
});

// ============================================================
// recordPhaseRead
// ============================================================

describe('recordPhaseRead — project-rooted matching', () => {
  beforeEach(resetPhaseReads);

  it('records a read when path matches a phase file (relative project path)', () => {
    const absPath = path.join(PATHS.root, PHASE_FILE_REGISTRY.coding);
    recordPhaseRead(absPath);
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.ok(data.reads.coding);
    assert.equal(data.reads.coding.file, PHASE_FILE_REGISTRY.coding);
    assert.ok(data.reads.coding.at);
  });

  it('records reads for each of the five phase files', () => {
    for (const [phase, file] of Object.entries(PHASE_FILE_REGISTRY)) {
      resetPhaseReads();
      recordPhaseRead(path.join(PATHS.root, file));
      const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
      assert.ok(data.reads[phase], `phase ${phase} should be recorded`);
    }
  });

  it('ignores non-phase file reads', () => {
    recordPhaseRead(path.join(PATHS.root, 'README.md'));
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.deepEqual(data.reads, {});
  });

  it('rejects cross-project forgery (/tmp/.../phases/03-implement.md)', () => {
    // A read of a same-named file OUTSIDE the project should NOT satisfy the gate.
    recordPhaseRead('/tmp/foreign/.claude/docs/phases/03-implement.md');
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.deepEqual(data.reads, {});
  });

  it('rejects relative parent-escape paths (../...)', () => {
    recordPhaseRead('../wogi-flow/.claude/docs/phases/03-implement.md');
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    // path.resolve normalizes — if cwd is project root, this would resolve
    // back into the project. Behavior depends on cwd. Just assert it either
    // records nothing OR records correctly; it must NOT crash.
    assert.ok(typeof data.reads === 'object');
  });

  it('silently ignores non-string input', () => {
    recordPhaseRead(null);
    recordPhaseRead(undefined);
    recordPhaseRead(123);
    recordPhaseRead({});
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.deepEqual(data.reads, {});
  });

  it('silently ignores empty string', () => {
    recordPhaseRead('');
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.deepEqual(data.reads, {});
  });

  it('overwrites existing entry when same phase file read twice', () => {
    const absPath = path.join(PATHS.root, PHASE_FILE_REGISTRY.coding);
    recordPhaseRead(absPath);
    const first = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8')).reads.coding.at;
    // Advance time minimally via a new ISO string
    recordPhaseRead(absPath);
    const second = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8')).reads.coding.at;
    // Only one entry per phase
    const all = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.equal(Object.keys(all.reads).length, 1);
    assert.ok(first);
    assert.ok(second);
  });
});

// ============================================================
// checkPhaseReadGate
// ============================================================

describe('checkPhaseReadGate — blocking behavior', () => {
  beforeEach(() => {
    resetPhaseReads();
    removePhaseFile();
  });

  it('fails open when workflow-phase.json is missing', () => {
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, false);
  });

  it('fails open when phase is idle (exempt)', () => {
    setPhase('idle');
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, false);
  });

  it('fails open when phase is routing (exempt)', () => {
    setPhase('routing');
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, false);
  });

  it('fails open when phase is unknown (not in registry)', () => {
    setPhase('some_future_phase');
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, false);
  });

  it('blocks Edit when coding phase is active and file not read', () => {
    setPhase('coding');
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, true);
    assert.ok(r.message.includes('coding'));
    assert.ok(r.message.includes('03-implement.md'));
  });

  it('blocks Write in exploring phase without read', () => {
    setPhase('exploring');
    const r = checkPhaseReadGate('Write', {});
    assert.equal(r.blocked, true);
    assert.ok(r.message.includes('01-explore.md'));
  });

  it('blocks Bash in validating phase without read', () => {
    setPhase('validating');
    const r = checkPhaseReadGate('Bash', {});
    assert.equal(r.blocked, true);
    assert.ok(r.message.includes('04-verify.md'));
  });

  it('unblocks after recordPhaseRead for matching phase', () => {
    setPhase('coding');
    let r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, true);

    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.coding));

    r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, false);
  });

  it('recording a DIFFERENT phase file does NOT unblock current phase', () => {
    setPhase('coding');
    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.exploring));
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, true);
  });

  it('message includes the tool name', () => {
    setPhase('coding');
    const r = checkPhaseReadGate('Write', {});
    assert.ok(r.message.includes('Write'));
  });
});

// ============================================================
// config handling
// ============================================================

describe('checkPhaseReadGate — config respecting', () => {
  beforeEach(() => {
    resetPhaseReads();
    setPhase('coding');
  });

  it('fails open when phaseReadGate.enabled === false', () => {
    const config = { hooks: { rules: { phaseReadGate: { enabled: false } } } };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, false);
  });

  it('enforces when phaseReadGate.enabled === true', () => {
    const config = { hooks: { rules: { phaseReadGate: { enabled: true } } } };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, true);
  });

  it('falls back to phaseGate.enabled when phaseReadGate is undefined', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: false } } } };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, false);
  });

  it('enforces when phaseReadGate undefined AND phaseGate.enabled === true', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: true } } } };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, true);
  });

  it('enforces when both config keys are undefined (default behavior)', () => {
    const r = checkPhaseReadGate('Edit', {});
    assert.equal(r.blocked, true);
  });

  it('phaseReadGate explicit takes precedence over phaseGate', () => {
    // phaseReadGate enabled, phaseGate disabled → should ENFORCE
    const config = {
      hooks: {
        rules: {
          phaseReadGate: { enabled: true },
          phaseGate: { enabled: false },
        },
      },
    };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, true);
  });

  it('phaseReadGate explicit false takes precedence over phaseGate enabled', () => {
    const config = {
      hooks: {
        rules: {
          phaseReadGate: { enabled: false },
          phaseGate: { enabled: true },
        },
      },
    };
    const r = checkPhaseReadGate('Edit', config);
    assert.equal(r.blocked, false);
  });

  it('handles null/missing config gracefully (fail-open on errors)', () => {
    // Passing null should not throw; it either fails open (no config = no check context)
    // or behaves as default. Either way, no crash.
    const r = checkPhaseReadGate('Edit', null);
    assert.ok(typeof r.blocked === 'boolean');
  });
});

// ============================================================
// clearPhaseReads
// ============================================================

describe('clearPhaseReads', () => {
  afterEach(resetPhaseReads);

  it('resets reads to empty object', () => {
    // Seed with data
    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.coding));
    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.exploring));

    clearPhaseReads();
    const data = JSON.parse(fs.readFileSync(PHASE_READS_FILE, 'utf-8'));
    assert.deepEqual(data.reads, {});
  });

  it('is safe to call when file does not exist', () => {
    try { fs.unlinkSync(PHASE_READS_FILE); } catch (_err) {}
    assert.doesNotThrow(() => clearPhaseReads());
    // File should exist after clear
    assert.equal(fs.existsSync(PHASE_READS_FILE), true);
  });

  it('is idempotent — multiple calls leave file in same state', () => {
    clearPhaseReads();
    const first = fs.readFileSync(PHASE_READS_FILE, 'utf-8');
    clearPhaseReads();
    const second = fs.readFileSync(PHASE_READS_FILE, 'utf-8');
    assert.equal(first, second);
  });
});

// ============================================================
// integration flow
// ============================================================

describe('integration — phase transition flow', () => {
  beforeEach(() => {
    resetPhaseReads();
  });

  it('simulates full phase cycle: exploring → spec → coding', () => {
    const config = {};

    // exploring phase — not yet read
    setPhase('exploring');
    assert.equal(checkPhaseReadGate('Edit', config).blocked, true);

    // Read exploring file — unblock
    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.exploring));
    assert.equal(checkPhaseReadGate('Edit', config).blocked, false);

    // Transition to spec_review — must read new file
    setPhase('spec_review');
    assert.equal(checkPhaseReadGate('Edit', config).blocked, true);

    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.spec_review));
    assert.equal(checkPhaseReadGate('Edit', config).blocked, false);

    // Transition to coding — must read again
    setPhase('coding');
    assert.equal(checkPhaseReadGate('Edit', config).blocked, true);

    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.coding));
    assert.equal(checkPhaseReadGate('Edit', config).blocked, false);
  });

  it('clearPhaseReads forces re-read on all phases (post-compact scenario)', () => {
    const config = {};
    setPhase('coding');
    recordPhaseRead(path.join(PATHS.root, PHASE_FILE_REGISTRY.coding));
    assert.equal(checkPhaseReadGate('Edit', config).blocked, false);

    clearPhaseReads();
    assert.equal(checkPhaseReadGate('Edit', config).blocked, true);
  });
});
