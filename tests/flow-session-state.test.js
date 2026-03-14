'use strict';

/**
 * Tests for flow-session-state.js — session state manager
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-session-state.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Suppress console output during tests
let originalLog, originalWarn, originalError;
beforeEach(() => {
  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

const mod = require('../scripts/flow-session-state');

// ============================================================
// Module loading
// ============================================================

describe('Module loading', () => {
  it('loads without error', () => {
    assert.ok(mod !== null && mod !== undefined);
  });

  it('exports an object', () => {
    assert.equal(typeof mod, 'object');
  });
});

// ============================================================
// Exported functions exist
// ============================================================

describe('Exported functions', () => {
  const expectedFunctions = [
    'getSessionStateConfig',
    'loadSessionState',
    'saveSessionState',
    'saveSessionStateAsync',
    'clearSession',
    'getDefaultState',
    'isResumingSession',
    'getTimeSinceLastActive',
    'setCliSessionId',
    'getCliSessionId',
    'trackTaskStart',
    'trackTaskComplete',
    'trackTaskCompleteAsync',
    'getCurrentTask',
    'clearStaleCurrentTask',
    'clearStaleCurrentTaskAsync',
    'trackFileModified',
    'getRecentFiles',
    'trackDecision',
    'getRecentDecisions',
    'updateContextSnapshot',
    'addKeyFact',
    'setBlockers',
    'saveSessionSummary',
    'getResumeContext',
    'checkAndDisplayResumeContext',
    'trackError',
    'trackBypassAttempt',
    'getBypassTracking',
    'hasWorkflowBypasses',
    'getBypassSummary',
    'clearBypassTracking',
  ];

  for (const fn of expectedFunctions) {
    it(`exports ${fn} as a function`, () => {
      assert.equal(typeof mod[fn], 'function', `${fn} should be a function`);
    });
  }
});

// ============================================================
// Exported constants
// ============================================================

describe('Exported constants', () => {
  it('exports DEFAULTS as an object', () => {
    assert.equal(typeof mod.DEFAULTS, 'object');
    assert.ok(mod.DEFAULTS !== null);
  });

  it('DEFAULTS has expected keys', () => {
    assert.equal(typeof mod.DEFAULTS.enabled, 'boolean');
    assert.equal(typeof mod.DEFAULTS.autoRestore, 'boolean');
    assert.equal(typeof mod.DEFAULTS.maxGapHours, 'number');
    assert.equal(typeof mod.DEFAULTS.trackFiles, 'boolean');
    assert.equal(typeof mod.DEFAULTS.trackDecisions, 'boolean');
    assert.equal(typeof mod.DEFAULTS.maxRecentFiles, 'number');
    assert.equal(typeof mod.DEFAULTS.maxRecentDecisions, 'number');
  });

  it('exports SESSION_PATH as a string', () => {
    assert.equal(typeof mod.SESSION_PATH, 'string');
    assert.ok(mod.SESSION_PATH.endsWith('session-state.json'));
  });
});

// ============================================================
// getDefaultState()
// ============================================================

describe('getDefaultState()', () => {
  it('returns an object', () => {
    const state = mod.getDefaultState();
    assert.equal(typeof state, 'object');
    assert.ok(state !== null);
  });

  it('has expected structure', () => {
    const state = mod.getDefaultState();
    assert.equal(state.lastActive, null);
    assert.equal(state.cliSessionId, null);
    assert.equal(state.currentTask, null);
    assert.ok(Array.isArray(state.recentFiles));
    assert.ok(Array.isArray(state.recentDecisions));
    assert.equal(typeof state.contextSnapshot, 'object');
    assert.equal(typeof state.metrics, 'object');
    assert.equal(state.lastSessionSummary, null);
  });

  it('metrics has expected initial values', () => {
    const state = mod.getDefaultState();
    assert.equal(state.metrics.tasksCompleted, 0);
    assert.equal(state.metrics.filesModified, 0);
    assert.equal(state.metrics.errorsEncountered, 0);
    assert.equal(state.metrics.sessionCount, 0);
  });

  it('contextSnapshot has expected structure', () => {
    const state = mod.getDefaultState();
    assert.ok(Array.isArray(state.contextSnapshot.keyFacts));
    assert.equal(state.contextSnapshot.inProgress, null);
    assert.ok(Array.isArray(state.contextSnapshot.blockers));
  });

  it('bypassTracking has expected structure', () => {
    const state = mod.getDefaultState();
    assert.equal(state.bypassTracking.count, 0);
    assert.ok(Array.isArray(state.bypassTracking.attempts));
    assert.ok(Array.isArray(state.bypassTracking.autoCreatedTasks));
  });
});

// ============================================================
// loadSessionState()
// ============================================================

describe('loadSessionState()', () => {
  it('returns an object', () => {
    const state = mod.loadSessionState();
    assert.equal(typeof state, 'object');
    assert.ok(state !== null);
  });

  it('returned state has default structure fields', () => {
    const state = mod.loadSessionState();
    // Should always have these fields (merged with defaults)
    assert.ok('lastActive' in state);
    assert.ok('currentTask' in state);
    assert.ok('recentFiles' in state);
    assert.ok('metrics' in state);
  });
});

// ============================================================
// getSessionStateConfig()
// ============================================================

describe('getSessionStateConfig()', () => {
  it('returns an object', () => {
    const config = mod.getSessionStateConfig();
    assert.equal(typeof config, 'object');
  });

  it('has enabled property', () => {
    const config = mod.getSessionStateConfig();
    assert.equal(typeof config.enabled, 'boolean');
  });

  it('has maxGapHours as a number', () => {
    const config = mod.getSessionStateConfig();
    assert.equal(typeof config.maxGapHours, 'number');
    assert.ok(config.maxGapHours > 0);
  });
});

// ============================================================
// trackTaskStart()
// ============================================================

describe('trackTaskStart()', () => {
  it('does not throw when called', () => {
    assert.doesNotThrow(() => mod.trackTaskStart('wf-test1234', 'Test task'));
  });

  it('returns an object (the updated state)', () => {
    const result = mod.trackTaskStart('wf-test5678', 'Another task');
    assert.equal(typeof result, 'object');
    assert.ok(result !== null);
  });

  it('sets currentTask with id and title', () => {
    const result = mod.trackTaskStart('wf-abcd1234', 'My task title');
    assert.ok(result.currentTask !== null);
    assert.equal(result.currentTask.id, 'wf-abcd1234');
    assert.equal(result.currentTask.title, 'My task title');
    assert.equal(typeof result.currentTask.startedAt, 'string');
  });
});

// ============================================================
// trackBypassAttempt()
// ============================================================

describe('trackBypassAttempt()', () => {
  it('does not throw when called with no args', () => {
    assert.doesNotThrow(() => mod.trackBypassAttempt());
  });

  it('does not throw when called with options', () => {
    assert.doesNotThrow(() =>
      mod.trackBypassAttempt({
        filePath: '/test/file.js',
        operation: 'edit',
        reason: 'no active task',
        taskId: 'wf-00000001',
      })
    );
  });

  it('returns an object', () => {
    const result = mod.trackBypassAttempt({ reason: 'test' });
    assert.equal(typeof result, 'object');
  });
});

// ============================================================
// setCliSessionId()
// ============================================================

describe('setCliSessionId()', () => {
  it('returns a promise', () => {
    const result = mod.setCliSessionId(null);
    assert.ok(result instanceof Promise || typeof result === 'object');
  });

  it('handles null sessionId without throwing', async () => {
    const result = await mod.setCliSessionId(null);
    assert.equal(typeof result, 'object');
  });
});

// ============================================================
// getCurrentTask()
// ============================================================

describe('getCurrentTask()', () => {
  it('returns null or an object', () => {
    const task = mod.getCurrentTask();
    assert.ok(task === null || typeof task === 'object');
  });
});

// ============================================================
// getRecentFiles()
// ============================================================

describe('getRecentFiles()', () => {
  it('returns an array', () => {
    const files = mod.getRecentFiles();
    assert.ok(Array.isArray(files));
  });

  it('respects limit parameter', () => {
    const files = mod.getRecentFiles(2);
    assert.ok(files.length <= 2);
  });
});

// ============================================================
// getRecentDecisions()
// ============================================================

describe('getRecentDecisions()', () => {
  it('returns an array', () => {
    const decisions = mod.getRecentDecisions();
    assert.ok(Array.isArray(decisions));
  });
});

// ============================================================
// getBypassTracking()
// ============================================================

describe('getBypassTracking()', () => {
  it('returns an object with expected structure', () => {
    const tracking = mod.getBypassTracking();
    assert.equal(typeof tracking, 'object');
    assert.equal(typeof tracking.count, 'number');
    assert.ok(Array.isArray(tracking.attempts));
    assert.ok(Array.isArray(tracking.autoCreatedTasks));
  });
});

// ============================================================
// hasWorkflowBypasses()
// ============================================================

describe('hasWorkflowBypasses()', () => {
  it('returns a boolean', () => {
    const result = mod.hasWorkflowBypasses();
    assert.equal(typeof result, 'boolean');
  });
});

// ============================================================
// isResumingSession()
// ============================================================

describe('isResumingSession()', () => {
  it('returns a boolean', () => {
    const result = mod.isResumingSession();
    assert.equal(typeof result, 'boolean');
  });
});

// ============================================================
// getTimeSinceLastActive()
// ============================================================

describe('getTimeSinceLastActive()', () => {
  it('returns null or a string', () => {
    const result = mod.getTimeSinceLastActive();
    assert.ok(result === null || typeof result === 'string');
  });
});

// ============================================================
// trackError()
// ============================================================

describe('trackError()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => mod.trackError('test'));
  });

  it('returns an object', () => {
    const result = mod.trackError();
    assert.equal(typeof result, 'object');
  });
});
