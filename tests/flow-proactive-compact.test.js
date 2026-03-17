'use strict';

/**
 * Tests for flow-proactive-compact.js — Proactive Compaction Manager
 *
 * Covers: exports, getProactiveCompactionConfig, shouldCompactAtPhase,
 * generateCompactionContext, formatCompactionMessage.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-proactive-compact.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const mod = require('../scripts/flow-proactive-compact');

// ============================================================
// Exports existence and types
// ============================================================

describe('exports', () => {
  const expectedFunctions = [
    'getProactiveCompactionConfig',
    'shouldCompactAtPhase',
    'handlePhaseBoundary',
    'generateCompactionContext',
    'formatCompactionMessage',
  ];

  for (const name of expectedFunctions) {
    it(`exports ${name} as a function`, () => {
      assert.equal(typeof mod[name], 'function', `${name} should be a function`);
    });
  }
});

// ============================================================
// getProactiveCompactionConfig
// ============================================================

describe('getProactiveCompactionConfig', () => {
  it('returns an object', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config, 'object');
    assert.ok(config !== null);
  });

  it('has enabled boolean', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config.enabled, 'boolean');
  });

  it('has triggerThreshold as a number between 0 and 1', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config.triggerThreshold, 'number');
    assert.ok(config.triggerThreshold > 0, 'triggerThreshold should be > 0');
    assert.ok(config.triggerThreshold <= 1, 'triggerThreshold should be <= 1');
  });

  it('default triggerThreshold is 0.80', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(config.triggerThreshold, 0.80);
  });

  it('has useHaiku boolean', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config.useHaiku, 'boolean');
  });

  it('has phases array', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.ok(Array.isArray(config.phases), 'phases should be an array');
    assert.ok(config.phases.length > 0, 'phases should not be empty');
  });

  it('phases include expected phase names', () => {
    const config = mod.getProactiveCompactionConfig();
    const expectedPhases = ['exploring', 'spec_review', 'scenario', 'criteria_check', 'validating'];
    for (const phase of expectedPhases) {
      assert.ok(config.phases.includes(phase), `phases should include "${phase}"`);
    }
  });

  it('has safeThreshold as a number', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config.safeThreshold, 'number');
  });

  it('has emergencyThreshold as a number', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.equal(typeof config.emergencyThreshold, 'number');
  });

  it('emergencyThreshold > triggerThreshold', () => {
    const config = mod.getProactiveCompactionConfig();
    assert.ok(config.emergencyThreshold > config.triggerThreshold,
      `emergencyThreshold (${config.emergencyThreshold}) should be > triggerThreshold (${config.triggerThreshold})`);
  });
});

// ============================================================
// shouldCompactAtPhase
// ============================================================

describe('shouldCompactAtPhase', () => {
  it('returns object with shouldCompact boolean', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.50,
      taskId: 'wf-test0001'
    });
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.shouldCompact, 'boolean');
  });

  it('returns reason string', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.50,
      taskId: 'wf-test0001'
    });
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  });

  it('returns shouldCompact false when below threshold', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.30,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, false);
  });

  it('returns shouldCompact true when above trigger threshold', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.85,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, true);
  });

  it('returns shouldCompact true for emergency threshold', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.98,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, true);
    assert.ok(result.reason.includes('emergency'));
  });

  it('returns shouldCompact false for non-trigger phase', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'non-existent-phase',
      contextPercent: 0.90,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, false);
    assert.ok(result.reason.includes('not in trigger list'));
  });

  it('returns checkpoint as null when not compacting', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0.30,
      taskId: 'wf-test0001'
    });
    assert.equal(result.checkpoint, null);
  });

  it('handles edge case at exactly the threshold', () => {
    const config = mod.getProactiveCompactionConfig();
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: config.triggerThreshold,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, true);
  });

  it('handles contextPercent of 0', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 0,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, false);
  });

  it('handles contextPercent of 1.0', () => {
    const result = mod.shouldCompactAtPhase({
      phase: 'exploring',
      contextPercent: 1.0,
      taskId: 'wf-test0001'
    });
    assert.equal(result.shouldCompact, true);
  });

  it('works with all valid phases', () => {
    const config = mod.getProactiveCompactionConfig();
    for (const phase of config.phases) {
      const result = mod.shouldCompactAtPhase({
        phase,
        contextPercent: 0.50,
        taskId: 'wf-test0001'
      });
      assert.equal(typeof result.shouldCompact, 'boolean');
    }
  });
});

// ============================================================
// generateCompactionContext
// ============================================================

describe('generateCompactionContext', () => {
  it('returns empty string for null checkpoint', () => {
    const result = mod.generateCompactionContext(null);
    assert.equal(result, '');
  });

  it('returns empty string for undefined checkpoint', () => {
    const result = mod.generateCompactionContext(undefined);
    assert.equal(result, '');
  });

  it('returns string containing task ID', () => {
    const checkpoint = {
      taskId: 'wf-abc12345',
      taskTitle: 'Test Task',
      currentPhase: 'exploring',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('wf-abc12345'));
  });

  it('includes task title in output', () => {
    const checkpoint = {
      taskId: 'wf-title001',
      taskTitle: 'My Amazing Task',
      currentPhase: 'spec_review',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('My Amazing Task'));
  });

  it('includes current phase', () => {
    const checkpoint = {
      taskId: 'wf-phase001',
      currentPhase: 'validating',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('validating'));
  });

  it('includes changed files when present', () => {
    const checkpoint = {
      taskId: 'wf-files001',
      currentPhase: 'scenario',
      lastUpdated: new Date().toISOString(),
      changedFiles: ['src/app.ts', 'src/utils.ts'],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('src/app.ts'));
    assert.ok(result.includes('src/utils.ts'));
  });

  it('includes verification results when present', () => {
    const checkpoint = {
      taskId: 'wf-verify01',
      currentPhase: 'validating',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [
        { passed: true, command: 'npm test' },
        { passed: false, command: 'npm run lint' },
      ],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('PASS'));
    assert.ok(result.includes('FAIL'));
    assert.ok(result.includes('npm test'));
  });

  it('includes completed phases list', () => {
    const checkpoint = {
      taskId: 'wf-phases01',
      currentPhase: 'scenario',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: ['exploring', 'spec_review'],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('exploring'));
    assert.ok(result.includes('spec_review'));
  });

  it('includes scenario information when present', () => {
    const checkpoint = {
      taskId: 'wf-scen0001',
      currentPhase: 'scenario',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
      scenarios: {
        total: 3,
        completed: [
          { index: 1, title: 'Scenario A', passed: true },
        ],
        pending: [
          { index: 2, title: 'Scenario B' },
          { index: 3, title: 'Scenario C' },
        ],
      },
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('Scenario A'));
    assert.ok(result.includes('Scenario B'));
    assert.ok(result.includes('1/3'));
  });

  it('includes spec path when present', () => {
    const checkpoint = {
      taskId: 'wf-spec0001',
      specPath: '.workflow/specs/wf-spec0001.md',
      currentPhase: 'exploring',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('.workflow/specs/wf-spec0001.md'));
  });

  it('includes resume instructions', () => {
    const checkpoint = {
      taskId: 'wf-resume01',
      currentPhase: 'scenario',
      lastUpdated: new Date().toISOString(),
      changedFiles: [],
      verificationResults: [],
      completedPhases: [],
    };
    const result = mod.generateCompactionContext(checkpoint);
    assert.ok(result.includes('ON RESUME'));
  });
});

// ============================================================
// formatCompactionMessage
// ============================================================

describe('formatCompactionMessage', () => {
  it('returns string when compaction not needed', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: false, reason: 'below threshold' },
      0.50
    );
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('50%'));
    assert.ok(result.includes('no compaction needed'));
  });

  it('returns string when compaction is needed', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: true, reason: 'proactive: context at 85%' },
      0.85
    );
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('85%'));
    assert.ok(result.includes('Compacting'));
  });

  it('includes reason in output when compacting', () => {
    const reason = 'emergency: context at 95%';
    const result = mod.formatCompactionMessage(
      { compactionNeeded: true, reason },
      0.95
    );
    assert.ok(result.includes(reason));
  });

  it('mentions /wogi-pre-compact when compaction needed', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: true, reason: 'test' },
      0.90
    );
    assert.ok(result.includes('/wogi-pre-compact'));
  });

  it('rounds percentage correctly', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: false, reason: 'test' },
      0.789
    );
    // 0.789 rounds to 79
    assert.ok(result.includes('79%'));
  });

  it('handles 0% context', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: false, reason: 'test' },
      0
    );
    assert.ok(result.includes('0%'));
  });

  it('handles 100% context', () => {
    const result = mod.formatCompactionMessage(
      { compactionNeeded: true, reason: 'test' },
      1.0
    );
    assert.ok(result.includes('100%'));
  });
});
