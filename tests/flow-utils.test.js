'use strict';

/**
 * Tests for flow-utils.js — unique functions (not re-exports)
 *
 * Covers: task ID generation/validation, ready.json operations,
 * git utilities, request log, task normalization, version comparison.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-utils.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
const originalConsole = { ...console };
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  generateTaskId,
  generateEpicId,
  generateFeatureId,
  generatePlanId,
  validateTaskId,
  isLegacyTaskId,
  isValidWogiId,
  validateReadyJson,
  normalizeTask,
  findTaskInAllLists,
  meetsVersion,
  isGitRepo,
  countRequestLogEntries,
  getReadyData,
  getSessionId,
  parseFlags,
  getTaskCounts,
  TASK_LIMITS,
} = require('../scripts/flow-utils');

// ============================================================
// generateTaskId
// ============================================================

describe('generateTaskId', () => {
  it('returns a string matching wf-[8 hex chars]', () => {
    const id = generateTaskId('Test task');
    assert.match(id, /^wf-[a-f0-9]{8}$/);
  });

  it('generates unique IDs on repeated calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(generateTaskId(`Task ${i}`));
    }
    assert.equal(ids.size, 50, 'All 50 IDs should be unique');
  });

  it('handles empty string title', () => {
    const id = generateTaskId('');
    assert.match(id, /^wf-[a-f0-9]{8}$/);
  });
});

// ============================================================
// generateEpicId / generateFeatureId / generatePlanId
// ============================================================

describe('generateEpicId', () => {
  it('returns ep-[8 hex chars]', () => {
    const id = generateEpicId('My Epic');
    assert.match(id, /^ep-[a-f0-9]{8}$/);
  });
});

describe('generateFeatureId', () => {
  it('returns ft-[8 hex chars]', () => {
    const id = generateFeatureId('My Feature');
    assert.match(id, /^ft-[a-f0-9]{8}$/);
  });
});

describe('generatePlanId', () => {
  it('returns pl-[8 hex chars]', () => {
    const id = generatePlanId('My Plan');
    assert.match(id, /^pl-[a-f0-9]{8}$/);
  });
});

// ============================================================
// validateTaskId
// ============================================================

describe('validateTaskId', () => {
  it('accepts valid hash-based ID', () => {
    const result = validateTaskId('wf-a1b2c3d4');
    assert.deepStrictEqual(result, { valid: true, format: 'hash' });
  });

  it('accepts uppercase hex in hash-based ID', () => {
    const result = validateTaskId('wf-A1B2C3D4');
    assert.deepStrictEqual(result, { valid: true, format: 'hash' });
  });

  it('accepts legacy TASK format', () => {
    const result = validateTaskId('TASK-001');
    assert.deepStrictEqual(result, { valid: true, format: 'legacy' });
  });

  it('accepts legacy BUG format', () => {
    const result = validateTaskId('BUG-123');
    assert.deepStrictEqual(result, { valid: true, format: 'legacy' });
  });

  it('rejects null', () => {
    const result = validateTaskId(null);
    assert.deepStrictEqual(result, { valid: false, format: null });
  });

  it('rejects empty string', () => {
    const result = validateTaskId('');
    assert.deepStrictEqual(result, { valid: false, format: null });
  });

  it('rejects non-string', () => {
    const result = validateTaskId(42);
    assert.deepStrictEqual(result, { valid: false, format: null });
  });

  it('rejects descriptive IDs', () => {
    const result = validateTaskId('wf-health-001');
    assert.deepStrictEqual(result, { valid: false, format: null });
  });

  it('rejects too-short hex', () => {
    const result = validateTaskId('wf-a1b2');
    assert.deepStrictEqual(result, { valid: false, format: null });
  });

  it('rejects too-long hex', () => {
    const result = validateTaskId('wf-a1b2c3d4e5');
    assert.deepStrictEqual(result, { valid: false, format: null });
  });
});

// ============================================================
// isLegacyTaskId
// ============================================================

describe('isLegacyTaskId', () => {
  it('returns true for TASK-001', () => {
    assert.equal(isLegacyTaskId('TASK-001'), true);
  });

  it('returns true for BUG-999', () => {
    assert.equal(isLegacyTaskId('BUG-999'), true);
  });

  it('returns false for hash-based ID', () => {
    assert.equal(isLegacyTaskId('wf-a1b2c3d4'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isLegacyTaskId(''), false);
  });
});

// ============================================================
// isValidWogiId
// ============================================================

describe('isValidWogiId', () => {
  it('accepts standard task ID', () => {
    assert.equal(isValidWogiId('wf-a1b2c3d4'), true);
  });

  it('accepts sub-task ID', () => {
    assert.equal(isValidWogiId('wf-a1b2c3d4-01'), true);
  });

  it('accepts review fix ID (wf-cr-)', () => {
    assert.equal(isValidWogiId('wf-cr-a1e8f7'), true);
  });

  it('accepts review finding ID (wf-rv-)', () => {
    assert.equal(isValidWogiId('wf-rv-a1b2c3d4'), true);
  });

  it('accepts epic ID', () => {
    assert.equal(isValidWogiId('ep-a1b2c3d4'), true);
  });

  it('accepts feature ID', () => {
    assert.equal(isValidWogiId('ft-a1b2c3d4'), true);
  });

  it('accepts plan ID', () => {
    assert.equal(isValidWogiId('pl-a1b2c3d4'), true);
  });

  it('accepts legacy TASK format', () => {
    assert.equal(isValidWogiId('TASK-100'), true);
  });

  it('rejects null', () => {
    assert.equal(isValidWogiId(null), false);
  });

  it('rejects arbitrary string', () => {
    assert.equal(isValidWogiId('my-random-task'), false);
  });

  it('rejects non-string', () => {
    assert.equal(isValidWogiId(123), false);
  });
});

// ============================================================
// validateReadyJson
// ============================================================

describe('validateReadyJson', () => {
  it('accepts valid structure', () => {
    const data = {
      ready: [{ id: 'wf-a1b2c3d4', title: 'Test' }],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects missing ready array', () => {
    const data = {
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ready')));
  });

  it('rejects missing inProgress array', () => {
    const data = {
      ready: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, false);
  });

  it('rejects task without id', () => {
    const data = {
      ready: [{ title: 'No ID' }],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('id')));
  });

  it('rejects invalid priority format', () => {
    const data = {
      ready: [{ id: 'wf-11111111', priority: 'HIGH' }],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('priority')));
  });

  it('accepts valid priority P0-P4', () => {
    const data = {
      ready: [{ id: 'wf-11111111', priority: 'P2' }],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, true);
  });

  it('accepts empty arrays', () => {
    const data = {
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = validateReadyJson(data);
    assert.equal(result.valid, true);
  });
});

// ============================================================
// normalizeTask
// ============================================================

describe('normalizeTask', () => {
  it('returns string tasks unchanged', () => {
    assert.equal(normalizeTask('wf-a1b2c3d4'), 'wf-a1b2c3d4');
  });

  it('returns null/undefined unchanged', () => {
    assert.equal(normalizeTask(null), null);
    assert.equal(normalizeTask(undefined), undefined);
  });

  it('adds default level L2 for regular tasks', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4', title: 'Test' });
    assert.equal(result.level, 'L2');
  });

  it('sets level L0 for epic type', () => {
    const result = normalizeTask({ id: 'ep-a1b2c3d4', type: 'epic' });
    assert.equal(result.level, 'L0');
  });

  it('sets level L1 for story type', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4', type: 'story' });
    assert.equal(result.level, 'L1');
  });

  it('preserves existing level', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4', level: 'L3' });
    assert.equal(result.level, 'L3');
  });

  it('defaults parent to null', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4' });
    assert.equal(result.parent, null);
  });

  it('preserves existing parent', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4', parent: 'ep-11111111' });
    assert.equal(result.parent, 'ep-11111111');
  });

  it('defaults children to empty array', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4' });
    assert.deepStrictEqual(result.children, []);
  });

  it('defaults progress to null', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4' });
    assert.equal(result.progress, null);
  });

  it('preserves all original fields', () => {
    const result = normalizeTask({ id: 'wf-a1b2c3d4', title: 'Test', custom: 'value' });
    assert.equal(result.title, 'Test');
    assert.equal(result.custom, 'value');
  });
});

// ============================================================
// findTaskInAllLists
// ============================================================

describe('findTaskInAllLists', () => {
  const readyData = {
    ready: [{ id: 'wf-11111111', title: 'Ready task' }],
    inProgress: [{ id: 'wf-22222222', title: 'In progress task' }],
    blocked: [{ id: 'wf-33333333', title: 'Blocked task' }],
    recentlyCompleted: [{ id: 'wf-44444444', title: 'Completed task' }],
  };

  it('finds task in ready list', () => {
    const result = findTaskInAllLists(readyData, 'wf-11111111');
    assert.ok(result);
    assert.equal(result.id, 'wf-11111111');
  });

  it('finds task in inProgress list', () => {
    const result = findTaskInAllLists(readyData, 'wf-22222222');
    assert.ok(result);
    assert.equal(result.id, 'wf-22222222');
  });

  it('finds task in blocked list', () => {
    const result = findTaskInAllLists(readyData, 'wf-33333333');
    assert.ok(result);
    assert.equal(result.id, 'wf-33333333');
  });

  it('finds task in recentlyCompleted list', () => {
    const result = findTaskInAllLists(readyData, 'wf-44444444');
    assert.ok(result);
    assert.equal(result.id, 'wf-44444444');
  });

  it('returns null for non-existent task', () => {
    const result = findTaskInAllLists(readyData, 'wf-99999999');
    assert.equal(result, null);
  });

  it('handles string task entries', () => {
    const data = {
      ready: ['wf-55555555'],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
    };
    const result = findTaskInAllLists(data, 'wf-55555555');
    assert.ok(result);
    assert.equal(result.id, 'wf-55555555');
  });

  it('handles empty lists gracefully', () => {
    const data = { ready: [], inProgress: [], blocked: [], recentlyCompleted: [] };
    const result = findTaskInAllLists(data, 'wf-11111111');
    assert.equal(result, null);
  });

  it('handles missing list keys gracefully', () => {
    const data = {};
    const result = findTaskInAllLists(data, 'wf-11111111');
    assert.equal(result, null);
  });
});

// ============================================================
// meetsVersion
// ============================================================

describe('meetsVersion', () => {
  it('returns true when major is higher', () => {
    assert.equal(meetsVersion(2, 0, 0, 1, 0, 0), true);
  });

  it('returns true when minor is higher with same major', () => {
    assert.equal(meetsVersion(1, 5, 0, 1, 3, 0), true);
  });

  it('returns true when patch is equal', () => {
    assert.equal(meetsVersion(1, 0, 5, 1, 0, 5), true);
  });

  it('returns true when patch is higher', () => {
    assert.equal(meetsVersion(1, 0, 6, 1, 0, 5), true);
  });

  it('returns false when major is lower', () => {
    assert.equal(meetsVersion(1, 0, 0, 2, 0, 0), false);
  });

  it('returns false when minor is lower with same major', () => {
    assert.equal(meetsVersion(1, 2, 0, 1, 3, 0), false);
  });

  it('returns false when patch is lower with same major.minor', () => {
    assert.equal(meetsVersion(1, 0, 4, 1, 0, 5), false);
  });
});

// ============================================================
// isGitRepo
// ============================================================

describe('isGitRepo', () => {
  it('returns a boolean', () => {
    const result = isGitRepo();
    assert.equal(typeof result, 'boolean');
  });

  it('returns true for this project (which is a git repo)', () => {
    assert.equal(isGitRepo(), true);
  });
});

// ============================================================
// countRequestLogEntries
// ============================================================

describe('countRequestLogEntries', () => {
  it('returns a number', () => {
    const count = countRequestLogEntries();
    assert.equal(typeof count, 'number');
  });

  it('returns a non-negative value', () => {
    const count = countRequestLogEntries();
    assert.ok(count >= 0);
  });
});

// ============================================================
// getReadyData
// ============================================================

describe('getReadyData', () => {
  it('returns an object', () => {
    const data = getReadyData();
    assert.equal(typeof data, 'object');
    assert.ok(data !== null);
  });

  it('has expected arrays', () => {
    const data = getReadyData();
    assert.ok(Array.isArray(data.ready), 'ready should be an array');
    assert.ok(Array.isArray(data.inProgress), 'inProgress should be an array');
    assert.ok(Array.isArray(data.blocked), 'blocked should be an array');
    assert.ok(Array.isArray(data.recentlyCompleted), 'recentlyCompleted should be an array');
  });
});

// ============================================================
// getSessionId
// ============================================================

describe('getSessionId', () => {
  it('returns null when no session env vars are set', () => {
    const origClaude = process.env.CLAUDE_SESSION_ID;
    const origAI = process.env.AI_SESSION_ID;
    delete process.env.CLAUDE_SESSION_ID;
    delete process.env.AI_SESSION_ID;

    const result = getSessionId();
    assert.equal(result, null);

    // Restore
    if (origClaude !== undefined) process.env.CLAUDE_SESSION_ID = origClaude;
    if (origAI !== undefined) process.env.AI_SESSION_ID = origAI;
  });

  it('returns CLAUDE_SESSION_ID when set', () => {
    const orig = process.env.CLAUDE_SESSION_ID;
    process.env.CLAUDE_SESSION_ID = 'test-session-123';

    const result = getSessionId();
    assert.equal(result, 'test-session-123');

    if (orig !== undefined) {
      process.env.CLAUDE_SESSION_ID = orig;
    } else {
      delete process.env.CLAUDE_SESSION_ID;
    }
  });
});

// ============================================================
// parseFlags
// ============================================================

describe('parseFlags', () => {
  it('parses --json flag', () => {
    const { flags } = parseFlags(['--json']);
    assert.equal(flags.json, true);
  });

  it('parses --quiet / -q flag', () => {
    const { flags } = parseFlags(['-q']);
    assert.equal(flags.quiet, true);
  });

  it('parses --verbose / -v flag', () => {
    const { flags } = parseFlags(['-v']);
    assert.equal(flags.verbose, true);
  });

  it('parses --help / -h flag', () => {
    const { flags } = parseFlags(['-h']);
    assert.equal(flags.help, true);
  });

  it('parses --dry-run flag', () => {
    const { flags } = parseFlags(['--dry-run']);
    assert.equal(flags.dryRun, true);
  });

  it('collects positional arguments', () => {
    const { positional } = parseFlags(['start', 'wf-a1b2c3d4', '--json']);
    assert.deepStrictEqual(positional, ['start', 'wf-a1b2c3d4']);
  });

  it('parses --key=value flags', () => {
    const { flags } = parseFlags(['--priority=P1']);
    assert.equal(flags.priority, 'P1');
  });

  it('parses --key value flags for known valued flags', () => {
    const { flags } = parseFlags(['--priority', 'P2']);
    assert.equal(flags.priority, 'P2');
  });

  it('defaults all boolean flags to false', () => {
    const { flags } = parseFlags([]);
    assert.equal(flags.json, false);
    assert.equal(flags.quiet, false);
    assert.equal(flags.verbose, false);
    assert.equal(flags.help, false);
    assert.equal(flags.dryRun, false);
  });
});

// ============================================================
// TASK_LIMITS
// ============================================================

describe('TASK_LIMITS', () => {
  it('is an object with positive numbers', () => {
    assert.equal(typeof TASK_LIMITS, 'object');
    for (const [key, value] of Object.entries(TASK_LIMITS)) {
      assert.equal(typeof value, 'number', `TASK_LIMITS.${key} should be a number`);
      assert.ok(value > 0, `TASK_LIMITS.${key} should be positive`);
    }
  });

  it('has MAX_RECENTLY_COMPLETED', () => {
    assert.equal(typeof TASK_LIMITS.MAX_RECENTLY_COMPLETED, 'number');
    assert.equal(TASK_LIMITS.MAX_RECENTLY_COMPLETED, 10);
  });
});

// ============================================================
// getTaskCounts
// ============================================================

describe('getTaskCounts', () => {
  it('returns object with expected keys', () => {
    const counts = getTaskCounts();
    assert.equal(typeof counts, 'object');
    assert.equal(typeof counts.ready, 'number');
    assert.equal(typeof counts.inProgress, 'number');
    assert.equal(typeof counts.blocked, 'number');
    assert.equal(typeof counts.recentlyCompleted, 'number');
  });

  it('all counts are non-negative', () => {
    const counts = getTaskCounts();
    for (const [key, value] of Object.entries(counts)) {
      assert.ok(value >= 0, `${key} count should be non-negative`);
    }
  });
});
