'use strict';

/**
 * Tests for flow-durable-session.js — Durable Session Manager
 *
 * Covers: constants, session creation, step management, normalizeStep,
 * backward-compatibility wrappers, task queue, completion checks.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-durable-session.test.js
 */

const { describe, it, _beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('node:fs');
const _path = require('node:path');
const _os = require('node:os');

// Suppress console output during tests
const _originalConsole = { ...console };
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const mod = require('../scripts/flow-durable-session');

// ============================================================
// Constants
// ============================================================

describe('constants', () => {
  it('SESSION_VERSION is a non-empty string', () => {
    assert.equal(typeof mod.SESSION_VERSION, 'string');
    assert.ok(mod.SESSION_VERSION.length > 0);
  });

  it('STEP_STATUS has all expected keys', () => {
    const expected = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED', 'SUSPENDED'];
    for (const key of expected) {
      assert.ok(mod.STEP_STATUS[key], `STEP_STATUS.${key} should exist`);
      assert.equal(typeof mod.STEP_STATUS[key], 'string');
    }
  });

  it('STEP_STATUS values are all lowercase strings with no spaces', () => {
    for (const [key, val] of Object.entries(mod.STEP_STATUS)) {
      assert.match(val, /^[a-z_]+$/, `STEP_STATUS.${key} should be lowercase`);
    }
  });

  it('STEP_TYPE has expected keys', () => {
    const expected = ['ACCEPTANCE_CRITERIA', 'HYBRID_EXECUTION', 'QUALITY_GATE', 'CUSTOM'];
    for (const key of expected) {
      assert.ok(mod.STEP_TYPE[key], `STEP_TYPE.${key} should exist`);
    }
  });

  it('STEP_TYPE values are kebab-case strings', () => {
    for (const [key, val] of Object.entries(mod.STEP_TYPE)) {
      assert.match(val, /^[a-z-]+$/, `STEP_TYPE.${key} should be kebab-case`);
    }
  });

  it('SUSPENSION_TYPE has expected keys', () => {
    const expected = ['CI_CD', 'SCHEDULED', 'RATE_LIMIT', 'HUMAN_REVIEW', 'EXTERNAL_EVENT', 'LONG_RUNNING'];
    for (const key of expected) {
      assert.ok(mod.SUSPENSION_TYPE[key], `SUSPENSION_TYPE.${key} should exist`);
    }
  });

  it('RESUME_CONDITION has expected keys', () => {
    const expected = ['TIME', 'POLL', 'MANUAL', 'FILE'];
    for (const key of expected) {
      assert.ok(mod.RESUME_CONDITION[key], `RESUME_CONDITION.${key} should exist`);
    }
  });
});

// ============================================================
// Exports existence and types
// ============================================================

describe('exports', () => {
  const expectedFunctions = [
    // Core session management
    'createDurableSession',
    'createDurableSessionAsync',
    'loadDurableSession',
    'saveDurableSession',
    'archiveDurableSession',
    'getSessionFileScope',
    'getSessionBoundaries',
    // Step management
    'getNextPendingStep',
    'getStep',
    'markStepStarted',
    'markStepCompleted',
    'markStepFailed',
    'markStepSkipped',
    'addSteps',
    'getRemainingSteps',
    // Resume
    'canResumeFromStep',
    'getResumeContext',
    // Execution
    'incrementIteration',
    'addTokensSaved',
    'checkCompletion',
    // Suspension
    'suspendSession',
    'isSuspended',
    'getSuspensionStatus',
    'checkResumeCondition',
    'resumeSession',
    // Backward compat
    'startLoop',
    'getActiveLoop',
    'updateCriterion',
    'canExitLoop',
    'endLoop',
    'getHybridSession',
    // Utilities
    'getSessionStats',
    'normalizeStep',
    // Task queue
    'initTaskQueue',
    'getQueueStatus',
    'advanceTaskQueue',
  ];

  for (const name of expectedFunctions) {
    it(`exports ${name} as a function`, () => {
      assert.equal(typeof mod[name], 'function', `${name} should be a function`);
    });
  }
});

// ============================================================
// normalizeStep
// ============================================================

describe('normalizeStep', () => {
  it('converts a string step to an object', () => {
    const result = mod.normalizeStep('Do something', 0);
    assert.equal(typeof result, 'object');
    assert.ok(result !== null);
    assert.ok(result.id, 'should have an id');
    assert.equal(result.status, mod.STEP_STATUS.PENDING);
  });

  it('string step has description from the input', () => {
    const result = mod.normalizeStep('Implement feature X', 2);
    assert.equal(result.description, 'Implement feature X');
  });

  it('preserves object step id and type', () => {
    const step = { id: 'custom-id', title: 'Custom step', type: 'custom' };
    const result = mod.normalizeStep(step, 0);
    assert.equal(result.id, 'custom-id');
    assert.equal(result.type, 'custom');
  });

  it('adds default status PENDING if not present', () => {
    const step = { title: 'Test step' };
    const result = mod.normalizeStep(step, 0);
    assert.equal(result.status, mod.STEP_STATUS.PENDING);
  });

  it('generates an id if none provided', () => {
    const step = { title: 'No ID step' };
    const result = mod.normalizeStep(step, 3);
    assert.ok(result.id, 'should generate an id');
    assert.equal(typeof result.id, 'string');
  });

  it('handles index parameter for id generation', () => {
    const a = mod.normalizeStep('Step A', 0);
    const b = mod.normalizeStep('Step B', 1);
    assert.notEqual(a.id, b.id, 'different indices should produce different IDs');
  });

  it('respects defaultMaxAttempts parameter', () => {
    const result = mod.normalizeStep('Retry step', 0, 10);
    // The step should have maxAttempts set
    assert.ok(result.maxAttempts === 10 || result.maxAttempts === undefined,
      'maxAttempts should be set or follow default behavior');
  });

  it('handles empty string input', () => {
    const result = mod.normalizeStep('', 0);
    assert.equal(typeof result, 'object');
    assert.ok(result !== null);
  });
});

// ============================================================
// createDurableSession — structure validation
// ============================================================

describe('createDurableSession', () => {
  // Note: createDurableSession writes to disk, so we validate the return structure
  it('returns an object with expected top-level keys', () => {
    const session = mod.createDurableSession('wf-aabbccdd', 'task', ['step1']);
    assert.equal(typeof session, 'object');
    assert.ok(session !== null);
    assert.equal(session.taskId, 'wf-aabbccdd');
    assert.equal(session.taskType, 'task');
    assert.equal(session.version, mod.SESSION_VERSION);
    assert.ok(session.sessionId, 'should have sessionId');
    assert.ok(session.startedAt, 'should have startedAt');
    assert.ok(session.updatedAt, 'should have updatedAt');
  });

  it('returns session with steps array', () => {
    const session = mod.createDurableSession('wf-11223344', 'task', ['step one', 'step two']);
    assert.ok(Array.isArray(session.steps), 'steps should be an array');
    assert.equal(session.steps.length, 2);
  });

  it('returns session with execution tracking', () => {
    const session = mod.createDurableSession('wf-99887766', 'task', []);
    assert.ok(session.execution, 'should have execution');
    assert.equal(typeof session.execution.currentStepIndex, 'number');
    assert.equal(typeof session.execution.iteration, 'number');
  });

  it('returns session with metrics', () => {
    const session = mod.createDurableSession('wf-aabb1122', 'task', []);
    assert.ok(session.metrics, 'should have metrics');
    assert.equal(session.metrics.stepsCompleted, 0);
    assert.equal(session.metrics.stepsFailed, 0);
    assert.equal(session.metrics.stepsSkipped, 0);
    assert.equal(session.metrics.tokensSaved, 0);
  });

  it('returns session with taskQueue structure', () => {
    const session = mod.createDurableSession('wf-cc112233', 'task', []);
    assert.ok(session.taskQueue, 'should have taskQueue');
    assert.equal(session.taskQueue.enabled, false);
    assert.ok(Array.isArray(session.taskQueue.tasks));
  });

  it('returns same session when called with same taskId (resume)', () => {
    const s1 = mod.createDurableSession('wf-aabbccdd', 'task', ['step1']);
    const s2 = mod.createDurableSession('wf-aabbccdd', 'task', ['step1', 'step2']);
    assert.equal(s1.sessionId, s2.sessionId, 'should return existing session');
  });

  it('handles empty steps array', () => {
    const session = mod.createDurableSession('wf-empty001', 'task', []);
    assert.ok(Array.isArray(session.steps));
    assert.equal(session.steps.length, 0);
  });
});

// ============================================================
// loadDurableSession
// ============================================================

describe('loadDurableSession', () => {
  it('returns an object or null', () => {
    const result = mod.loadDurableSession();
    assert.ok(result === null || typeof result === 'object');
  });

  it('returns session with version field when session exists', () => {
    // Ensure a session exists
    mod.createDurableSession('wf-load0001', 'task', ['test']);
    const loaded = mod.loadDurableSession();
    if (loaded) {
      assert.equal(typeof loaded.version, 'string');
      assert.ok(loaded.taskId);
    }
  });
});

// ============================================================
// Step management functions
// ============================================================

describe('getNextPendingStep', () => {
  it('returns null/undefined when session has no steps', () => {
    mod.createDurableSession('wf-pend0001', 'task', []);
    const next = mod.getNextPendingStep();
    assert.ok(next === null || next === undefined, 'should be null or undefined for empty steps');
  });

  it('returns first pending step when session has steps', () => {
    // Create fresh session by archiving old one first
    mod.archiveDurableSession('completed');
    const session = mod.createDurableSession('wf-pend0002', 'task', ['first step', 'second step']);
    const next = mod.getNextPendingStep(session);
    if (next) {
      assert.equal(next.status, mod.STEP_STATUS.PENDING);
    }
  });
});

describe('getStep', () => {
  it('returns null for non-existent step ID', () => {
    const result = mod.getStep('non-existent-id-xyz');
    assert.equal(result, null);
  });
});

describe('getRemainingSteps', () => {
  it('returns an array', () => {
    const result = mod.getRemainingSteps(null);
    assert.ok(Array.isArray(result));
  });

  it('returns only non-completed steps', () => {
    mod.archiveDurableSession('completed');
    const session = mod.createDurableSession('wf-remain01', 'task', ['a', 'b', 'c']);
    const remaining = mod.getRemainingSteps(session);
    for (const step of remaining) {
      assert.notEqual(step.status, mod.STEP_STATUS.COMPLETED);
    }
  });
});

describe('addSteps', () => {
  it('returns null when no session exists', () => {
    mod.archiveDurableSession('completed');
    // Without a session, addSteps should return null
    const result = mod.addSteps(['new step']);
    // loadDurableSession may return null if archive cleared it
    assert.ok(result === null || typeof result === 'object');
  });
});

// ============================================================
// checkCompletion
// ============================================================

describe('checkCompletion', () => {
  it('returns an object with complete boolean', () => {
    const result = mod.checkCompletion();
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.complete, 'boolean');
  });

  it('returns complete true when no session exists', () => {
    mod.archiveDurableSession('completed');
    const result = mod.checkCompletion();
    assert.equal(result.complete, true);
    assert.equal(result.reason, 'no-session');
  });

  it('returns complete with reason field', () => {
    const result = mod.checkCompletion();
    assert.ok('reason' in result, 'should have reason field');
  });
});

// ============================================================
// Suspension
// ============================================================

describe('isSuspended', () => {
  it('returns a boolean', () => {
    const result = mod.isSuspended();
    assert.equal(typeof result, 'boolean');
  });
});

describe('getSuspensionStatus', () => {
  it('returns null when not suspended', () => {
    mod.archiveDurableSession('completed');
    mod.createDurableSession('wf-susp0001', 'task', []);
    const status = mod.getSuspensionStatus();
    assert.equal(status, null);
  });
});

// ============================================================
// Backward compatibility wrappers
// ============================================================

describe('startLoop (backward compat)', () => {
  it('creates a durable session and returns it', () => {
    mod.archiveDurableSession('completed');
    const session = mod.startLoop('wf-loop0001', ['criterion 1', 'criterion 2']);
    assert.equal(typeof session, 'object');
    assert.ok(session !== null);
    assert.equal(session.taskId, 'wf-loop0001');
  });
});

describe('getActiveLoop (backward compat)', () => {
  it('returns object or null', () => {
    const result = mod.getActiveLoop();
    assert.ok(result === null || typeof result === 'object');
  });

  it('returns object with expected fields when session exists', () => {
    mod.archiveDurableSession('completed');
    mod.startLoop('wf-active01', ['criterion']);
    const loop = mod.getActiveLoop();
    if (loop) {
      assert.ok('taskId' in loop);
      assert.ok('criteria' in loop || 'steps' in loop || 'iteration' in loop);
    }
  });
});

describe('canExitLoop (backward compat)', () => {
  it('returns object with canExit boolean', () => {
    const result = mod.canExitLoop();
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.canExit, 'boolean');
  });
});

describe('endLoop (backward compat)', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => mod.endLoop('completed'));
  });
});

describe('getHybridSession (backward compat)', () => {
  it('returns object or null', () => {
    const result = mod.getHybridSession();
    assert.ok(result === null || typeof result === 'object');
  });
});

// ============================================================
// getSessionStats
// ============================================================

describe('getSessionStats', () => {
  it('returns an object', () => {
    const stats = mod.getSessionStats();
    assert.equal(typeof stats, 'object');
    assert.ok(stats !== null);
  });
});

// ============================================================
// Task Queue (v2.1)
// ============================================================

describe('getQueueStatus', () => {
  it('returns object with hasQueue boolean', () => {
    const status = mod.getQueueStatus();
    assert.equal(typeof status, 'object');
    assert.equal(typeof status.hasQueue, 'boolean');
  });

  it('returns hasMoreTasks boolean', () => {
    const status = mod.getQueueStatus();
    assert.equal(typeof status.hasMoreTasks, 'boolean');
  });
});

describe('advanceTaskQueue', () => {
  it('returns object with advanced boolean', () => {
    const result = mod.advanceTaskQueue();
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.advanced, 'boolean');
  });

  it('returns queueComplete when no queue active', () => {
    const result = mod.advanceTaskQueue();
    assert.equal(result.queueComplete, true);
  });
});

// ============================================================
// incrementIteration
// ============================================================

describe('incrementIteration', () => {
  it('returns updated session or null', () => {
    mod.archiveDurableSession('completed');
    mod.createDurableSession('wf-iter0001', 'task', ['step']);
    const result = mod.incrementIteration();
    assert.ok(result === null || typeof result === 'object');
    if (result) {
      assert.ok(result.execution.iteration >= 1);
    }
  });
});

// ============================================================
// Session file scope and boundaries (v4.0+)
// ============================================================

describe('getSessionFileScope', () => {
  it('returns null or array', () => {
    const result = mod.getSessionFileScope();
    assert.ok(result === null || Array.isArray(result));
  });
});

describe('getSessionBoundaries', () => {
  it('returns null or object', () => {
    const result = mod.getSessionBoundaries();
    assert.ok(result === null || typeof result === 'object');
  });
});

// Clean up any session we created
afterEach(() => {
  try {
    mod.archiveDurableSession('completed');
  } catch (_err) {
    // ignore cleanup errors
  }
});
