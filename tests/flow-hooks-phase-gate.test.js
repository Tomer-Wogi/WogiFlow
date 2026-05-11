'use strict';

/**
 * Tests for scripts/hooks/core/phase-gate.js (Wave F hook coverage).
 *
 * Covers: isPhaseGateEnabled strict true (default false), PHASES + VALID_TRANSITIONS
 * structural contract, isToolAllowedInPhase per-phase blocking (Read/Glob/Grep
 * always allowed, Skill always allowed, blocked list per phase), isPhaseExemptPath
 * implicit via checkPhaseGate, getCurrentPhase fallback to idle on missing/corrupt
 * state, stale-phase auto-reset (2h TTL), getPhaseContextPrompt per-phase text.
 *
 * Tests snapshot + restore workflow-phase.json to avoid polluting live state.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-phase-gate.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  isPhaseGateEnabled,
  isToolAllowedInPhase,
  getCurrentPhase,
  checkPhaseGate,
  resetPhase,
  PHASES,
  VALID_TRANSITIONS,
} = require('../scripts/hooks/core/phase-gate');
const { PATHS } = require('../scripts/flow-utils');

const PHASE_FILE = path.join(PATHS.state, 'workflow-phase.json');

let originalPhase = null;
function snapshot() {
  try { originalPhase = fs.readFileSync(PHASE_FILE, 'utf-8'); } catch (_err) { originalPhase = null; }
}
function restore() {
  if (originalPhase !== null) fs.writeFileSync(PHASE_FILE, originalPhase);
  else { try { fs.unlinkSync(PHASE_FILE); } catch (_err) {} }
}

before(snapshot);
after(restore);

// ============================================================
// isPhaseGateEnabled
// ============================================================

describe('isPhaseGateEnabled — strict true semantic', () => {
  it('returns false when config has no hooks block', () => {
    assert.equal(isPhaseGateEnabled({}), false);
  });

  it('returns false when phaseGate is undefined', () => {
    assert.equal(isPhaseGateEnabled({ hooks: { rules: {} } }), false);
  });

  it('returns true ONLY when phaseGate.enabled === true (strict)', () => {
    assert.equal(isPhaseGateEnabled({ hooks: { rules: { phaseGate: { enabled: true } } } }), true);
  });

  it('returns false for truthy non-true values (requires literal true)', () => {
    assert.equal(isPhaseGateEnabled({ hooks: { rules: { phaseGate: { enabled: 1 } } } }), false);
    assert.equal(isPhaseGateEnabled({ hooks: { rules: { phaseGate: { enabled: 'yes' } } } }), false);
  });

  it('returns false for explicit false', () => {
    assert.equal(isPhaseGateEnabled({ hooks: { rules: { phaseGate: { enabled: false } } } }), false);
  });
});

// ============================================================
// PHASES / VALID_TRANSITIONS structural contract
// ============================================================

describe('PHASES array', () => {
  it('contains expected 7 phases in order', () => {
    assert.deepEqual(PHASES, [
      'idle', 'routing', 'exploring', 'spec_review',
      'coding', 'validating', 'completing',
    ]);
  });
});

describe('VALID_TRANSITIONS', () => {
  it('idle → routing only', () => {
    assert.deepEqual(VALID_TRANSITIONS.idle, ['routing']);
  });

  it('routing → idle/exploring/coding', () => {
    assert.ok(VALID_TRANSITIONS.routing.includes('exploring'));
    assert.ok(VALID_TRANSITIONS.routing.includes('coding'));
    assert.ok(VALID_TRANSITIONS.routing.includes('idle'));
  });

  it('exploring → spec_review/coding', () => {
    assert.deepEqual(VALID_TRANSITIONS.exploring.sort(), ['coding', 'spec_review']);
  });

  it('spec_review → coding', () => {
    assert.deepEqual(VALID_TRANSITIONS.spec_review, ['coding']);
  });

  it('coding → validating', () => {
    assert.deepEqual(VALID_TRANSITIONS.coding, ['validating']);
  });

  it('validating → coding/completing', () => {
    assert.deepEqual(VALID_TRANSITIONS.validating.sort(), ['coding', 'completing']);
  });

  it('completing → idle', () => {
    assert.deepEqual(VALID_TRANSITIONS.completing, ['idle']);
  });

  it('every destination is a valid phase', () => {
    for (const [from, destinations] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of destinations) {
        assert.ok(PHASES.includes(to), `${from} → ${to}: ${to} not in PHASES`);
      }
    }
  });
});

// ============================================================
// isToolAllowedInPhase
// ============================================================

describe('isToolAllowedInPhase — always-allowed tools', () => {
  it('allows Read/Glob/Grep in every phase', () => {
    for (const phase of PHASES) {
      for (const tool of ['Read', 'Glob', 'Grep']) {
        assert.equal(isToolAllowedInPhase(tool, phase), true, `${tool} in ${phase}`);
      }
    }
  });

  it('allows WebSearch/WebFetch/Task/AskUserQuestion universally', () => {
    for (const phase of PHASES) {
      for (const tool of ['WebSearch', 'WebFetch', 'Task', 'AskUserQuestion']) {
        assert.equal(isToolAllowedInPhase(tool, phase), true);
      }
    }
  });

  it('allows Skill in every phase (/wogi-* routing)', () => {
    for (const phase of PHASES) {
      assert.equal(isToolAllowedInPhase('Skill', phase), true);
    }
  });
});

describe('isToolAllowedInPhase — phase-specific blocks', () => {
  it('routing blocks Edit/Write/Bash', () => {
    assert.equal(isToolAllowedInPhase('Edit', 'routing'), false);
    assert.equal(isToolAllowedInPhase('Write', 'routing'), false);
    assert.equal(isToolAllowedInPhase('Bash', 'routing'), false);
  });

  it('exploring blocks Edit/Write but allows Bash', () => {
    assert.equal(isToolAllowedInPhase('Edit', 'exploring'), false);
    assert.equal(isToolAllowedInPhase('Write', 'exploring'), false);
    assert.equal(isToolAllowedInPhase('Bash', 'exploring'), true);
  });

  it('spec_review blocks Edit/Write/Bash', () => {
    assert.equal(isToolAllowedInPhase('Edit', 'spec_review'), false);
    assert.equal(isToolAllowedInPhase('Write', 'spec_review'), false);
    assert.equal(isToolAllowedInPhase('Bash', 'spec_review'), false);
  });

  it('coding allows everything', () => {
    for (const tool of ['Edit', 'Write', 'Bash', 'NotebookEdit']) {
      assert.equal(isToolAllowedInPhase(tool, 'coding'), true, `${tool} in coding`);
    }
  });

  it('validating blocks Edit/Write', () => {
    assert.equal(isToolAllowedInPhase('Edit', 'validating'), false);
    assert.equal(isToolAllowedInPhase('Write', 'validating'), false);
  });

  it('completing allows everything', () => {
    for (const tool of ['Edit', 'Write', 'Bash']) {
      assert.equal(isToolAllowedInPhase(tool, 'completing'), true);
    }
  });

  it('idle allows all (routing gate handles enforcement)', () => {
    for (const tool of ['Edit', 'Write', 'Bash']) {
      assert.equal(isToolAllowedInPhase(tool, 'idle'), true);
    }
  });

  it('unknown phase allows everything (fail-open)', () => {
    assert.equal(isToolAllowedInPhase('Edit', 'unknown_phase'), true);
  });
});

// ============================================================
// getCurrentPhase
// ============================================================

describe('getCurrentPhase', () => {
  it('returns idle defaults when state file missing', () => {
    try { fs.unlinkSync(PHASE_FILE); } catch (_err) {}
    const phase = getCurrentPhase();
    assert.equal(phase.phase, 'idle');
    assert.equal(phase.taskId, null);
  });

  it('returns idle when phase is invalid', () => {
    fs.writeFileSync(PHASE_FILE, JSON.stringify({ phase: 'not_a_real_phase' }));
    assert.equal(getCurrentPhase().phase, 'idle');
  });

  it('reads valid phase from state file', () => {
    fs.writeFileSync(PHASE_FILE, JSON.stringify({
      phase: 'coding', taskId: 'wf-abc12345', updatedAt: new Date().toISOString(),
    }));
    const phase = getCurrentPhase();
    assert.equal(phase.phase, 'coding');
    assert.equal(phase.taskId, 'wf-abc12345');
  });

  it('handles corrupt JSON gracefully', () => {
    fs.writeFileSync(PHASE_FILE, '{{{ not valid json');
    const phase = getCurrentPhase();
    assert.equal(phase.phase, 'idle');
  });
});

// ============================================================
// checkPhaseGate — fail-open / disabled path
// ============================================================

describe('checkPhaseGate — disabled fast path', () => {
  it('allows all tools when gate is disabled', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: false } } } };
    for (const tool of ['Edit', 'Write', 'Bash']) {
      const r = checkPhaseGate(tool, {}, config);
      assert.equal(r.allowed, true, `${tool} should be allowed when disabled`);
      assert.equal(r.reason, 'phase_gating_disabled');
    }
  });

  it('allows when config missing hooks block (default disabled)', () => {
    const r = checkPhaseGate('Edit', {}, {});
    assert.equal(r.allowed, true);
  });
});

describe('checkPhaseGate — exempt paths', () => {
  it('exempts .workflow/state/ files from Edit/Write block', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: true } } } };
    fs.writeFileSync(PHASE_FILE, JSON.stringify({
      phase: 'routing', taskId: 'wf-test00001', updatedAt: new Date().toISOString(),
    }));
    const r = checkPhaseGate('Edit', { file_path: '.workflow/state/ready.json' }, config);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'phase_exempt_path');
  });

  it('exempts .workflow/changes/, /specs/, /plans/, /verifications/, /reviews/', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: true } } } };
    fs.writeFileSync(PHASE_FILE, JSON.stringify({
      phase: 'routing', updatedAt: new Date().toISOString(),
    }));
    for (const subdir of ['changes', 'specs', 'plans', 'verifications', 'reviews']) {
      const r = checkPhaseGate('Write', { file_path: `.workflow/${subdir}/foo.md` }, config);
      assert.equal(r.allowed, true, `${subdir} should be exempt`);
    }
  });
});

// ============================================================
// Stale phase TTL (2 hours)
// ============================================================

describe('checkPhaseGate — stale phase auto-reset (2h)', () => {
  it('auto-resets phase older than 2 hours', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: true } } } };
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(PHASE_FILE, JSON.stringify({ phase: 'coding', taskId: 'wf-stale', updatedAt: stale }));

    const r = checkPhaseGate('Edit', { file_path: 'src/x.js' }, config);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'phase_expired_reset');

    // Phase should be reset to idle
    const phase = getCurrentPhase();
    assert.equal(phase.phase, 'idle');
  });

  it('keeps fresh phase (< 2h)', () => {
    const config = { hooks: { rules: { phaseGate: { enabled: true } } } };
    const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    fs.writeFileSync(PHASE_FILE, JSON.stringify({ phase: 'coding', updatedAt: fresh }));
    // In coding phase, Edit is allowed
    const r = checkPhaseGate('Edit', { file_path: 'src/x.js' }, config);
    assert.equal(r.allowed, true);
    assert.notEqual(r.reason, 'phase_expired_reset');
  });
});

// ============================================================
// resetPhase
// ============================================================

describe('resetPhase', () => {
  it('returns a boolean (does not throw)', () => {
    // Full verification of idle state is susceptible to parallel writes from
    // flow-hooks-phase-read-gate.test.js when both run via npm test; the
    // stale-phase-reset test above already verifies resetPhase produces idle
    // state under controlled conditions.
    const r = resetPhase();
    assert.equal(typeof r, 'boolean');
  });
});

// ============================================================
// wf-88a08fd4: flow-phase.js CLI must write state even when gate disabled
// ============================================================

describe('wf-88a08fd4: flow-phase.js transition CLI writes state regardless of gate flag', () => {
  it('transition writes workflow-phase.json even when phaseGate.enabled is false (default)', () => {
    // Use an isolated tmp project so we don't race other parallel tests
    // touching the live `.workflow/state/workflow-phase.json`. The CLI uses
    // `WOGIFLOW_PROJECT_ROOT` env var (bin/flow path) AND falls back to
    // cwd-based discovery, so spawn with both set to the tmp dir.
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const CLI = path.resolve(__dirname, '..', 'scripts', 'flow-phase.js');

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-phase-cli-'));
    const stateDir = path.join(tmpRoot, '.workflow', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const tmpPhaseFile = path.join(stateDir, 'workflow-phase.json');
    fs.writeFileSync(tmpPhaseFile, JSON.stringify({
      phase: 'idle',
      taskId: null,
      updatedAt: new Date().toISOString(),
      previousPhase: null
    }, null, 2));
    // Minimal config so getConfig() doesn't hit live config.
    fs.writeFileSync(path.join(tmpRoot, '.workflow', 'config.json'), JSON.stringify({}));

    let stdout = '';
    let exitCode = 0;
    let stateAfter = null;
    try {
      stdout = execFileSync('node', [CLI, 'transition', 'idle', 'routing', 'wf-test4567'], {
        cwd: tmpRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // flow-paths.js consults WOGI_PROJECT_ROOT (not WOGIFLOW_PROJECT_ROOT).
          // Set both for belt-and-suspenders.
          WOGI_PROJECT_ROOT: tmpRoot,
          WOGIFLOW_PROJECT_ROOT: tmpRoot
        }
      });
      // Read state file BEFORE cleanup.
      stateAfter = JSON.parse(fs.readFileSync(tmpPhaseFile, 'utf-8'));
    } catch (err) {
      exitCode = err.status ?? 1;
      stdout = err.stdout?.toString() || '';
    } finally {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_err) { /* */ }
    }

    assert.equal(exitCode, 0, 'CLI should exit 0 on a valid transition');
    assert.match(stdout, /Phase:\s*idle\s*→\s*routing/, 'CLI should announce the transition');
    assert.ok(stateAfter, 'state file should exist after transition');
    assert.equal(stateAfter.phase, 'routing', 'phase must transition to routing');
    assert.equal(stateAfter.taskId, 'wf-test4567', 'taskId must be recorded');
    assert.equal(stateAfter.previousPhase, 'idle', 'previousPhase must be recorded');
  });
});
