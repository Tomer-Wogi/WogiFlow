'use strict';

/**
 * Tests for scripts/hooks/core/todowrite-gate.js (Wave F hook coverage).
 *
 * Covers: isTrackingTodo pattern matching + allowlist, isImplementationTodo
 * classification, classifyTodo (completed status override, unknown fallback),
 * checkTodoWriteGate branching (no todos / gate disabled / no impl todos /
 * active task / blocking vs warn-only), message generators.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-todowrite-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  isTodoWriteGateEnabled,
  isTrackingTodo,
  isImplementationTodo,
  classifyTodo,
  checkTodoWriteGate,
  generateWarningMessage,
  generateBlockMessage,
  IMPLEMENTATION_TODO_PATTERNS,
  TRACKING_TODO_PATTERNS,
  ALWAYS_ALLOWED_TODOS,
} = require('../scripts/hooks/core/todowrite-gate');

// ============================================================
// isTodoWriteGateEnabled
// ============================================================

describe('isTodoWriteGateEnabled', () => {
  it('returns true with no config blocks', () => {
    assert.equal(isTodoWriteGateEnabled({}), true);
  });

  it('returns false when todoWriteGate.enabled === false', () => {
    assert.equal(isTodoWriteGateEnabled({ enforcement: { todoWriteGate: { enabled: false } } }), false);
  });

  it('returns false when strictMode === false', () => {
    assert.equal(isTodoWriteGateEnabled({ enforcement: { strictMode: false } }), false);
  });

  it('returns true when strictMode is true', () => {
    assert.equal(isTodoWriteGateEnabled({ enforcement: { strictMode: true } }), true);
  });
});

// ============================================================
// isTrackingTodo
// ============================================================

describe('isTrackingTodo — explicit allowlist', () => {
  it('matches all ALWAYS_ALLOWED_TODOS', () => {
    for (const entry of ALWAYS_ALLOWED_TODOS) {
      assert.equal(isTrackingTodo(entry), true, `should match: ${entry}`);
    }
  });

  it('matches allowlist prefix (e.g., "Run tests for Profile")', () => {
    assert.equal(isTrackingTodo('run tests for the profile page'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isTrackingTodo('RUN TESTS'), true);
    assert.equal(isTrackingTodo('Run Tests'), true);
  });
});

describe('isTrackingTodo — pattern matching', () => {
  it('detects testing/validation verbs', () => {
    assert.equal(isTrackingTodo('run tests'), true);
    assert.equal(isTrackingTodo('verify the output'), true);
    assert.equal(isTrackingTodo('validate the schema'), true);
    assert.equal(isTrackingTodo('test the feature'), true);
  });

  it('detects git verbs', () => {
    assert.equal(isTrackingTodo('commit changes'), true);
    assert.equal(isTrackingTodo('push to remote'), true);
    assert.equal(isTrackingTodo('stage files'), true);
    assert.equal(isTrackingTodo('git rebase onto main'), true);
  });

  it('detects update-log verbs', () => {
    assert.equal(isTrackingTodo('update request-log'), true);
    assert.equal(isTrackingTodo('update app-map'), true);
  });

  it('detects completion verbs', () => {
    assert.equal(isTrackingTodo('mark as complete'), true);
    assert.equal(isTrackingTodo('close task'), true);
    assert.equal(isTrackingTodo('finalize work'), true);
  });

  it('returns false for non-string or empty', () => {
    assert.equal(isTrackingTodo(null), false);
    assert.equal(isTrackingTodo(undefined), false);
    assert.equal(isTrackingTodo(''), false);
    assert.equal(isTrackingTodo(42), false);
  });
});

// ============================================================
// isImplementationTodo
// ============================================================

describe('isImplementationTodo — creation/modification patterns', () => {
  it('detects "Create X"', () => {
    assert.equal(isImplementationTodo('Create a Profile component'), true);
  });

  it('detects "Implement Y"', () => {
    assert.equal(isImplementationTodo('Implement user authentication'), true);
  });

  it('detects "Add Z feature"', () => {
    assert.equal(isImplementationTodo('Add dark mode toggle'), true);
  });

  it('detects "Fix bug in X"', () => {
    assert.equal(isImplementationTodo('Fix bug in the login flow'), true);
  });

  it('detects refactor/modify verbs', () => {
    assert.equal(isImplementationTodo('Refactor the auth module'), true);
    assert.equal(isImplementationTodo('Modify the schema'), true);
  });

  it('detects component/service/module keywords', () => {
    assert.equal(isImplementationTodo('Build a new service'), true);
    assert.equal(isImplementationTodo('Design a component'), true);
  });

  it('tracking todos override implementation patterns', () => {
    // "update request-log" hits tracking first
    assert.equal(isImplementationTodo('update request-log'), false);
    // "commit changes" — 'commit' is tracking
    assert.equal(isImplementationTodo('commit changes'), false);
  });

  it('returns false for non-matching todos', () => {
    assert.equal(isImplementationTodo('think about it'), false);
    assert.equal(isImplementationTodo('consider options'), false);
  });

  it('returns false for non-string input', () => {
    assert.equal(isImplementationTodo(null), false);
    assert.equal(isImplementationTodo(123), false);
  });
});

// ============================================================
// classifyTodo
// ============================================================

describe('classifyTodo — object with content+status', () => {
  it('returns unknown for missing content', () => {
    const r = classifyTodo({});
    assert.equal(r.type, 'unknown');
    assert.equal(r.reason, 'no_content');
  });

  it('returns unknown for null input', () => {
    const r = classifyTodo(null);
    assert.equal(r.type, 'unknown');
  });

  it('classifies completed status as tracking (regardless of content)', () => {
    const r = classifyTodo({ content: 'Create database schema', status: 'completed' });
    assert.equal(r.type, 'tracking');
    assert.equal(r.reason, 'completed_status');
  });

  it('classifies tracking content', () => {
    const r = classifyTodo({ content: 'run tests', status: 'pending' });
    assert.equal(r.type, 'tracking');
    assert.equal(r.reason, 'tracking_pattern');
  });

  it('classifies implementation content', () => {
    const r = classifyTodo({ content: 'Create Profile component', status: 'pending' });
    assert.equal(r.type, 'implementation');
    assert.equal(r.reason, 'implementation_pattern');
  });

  it('falls back to unknown for ambiguous content', () => {
    const r = classifyTodo({ content: 'think about architecture', status: 'pending' });
    assert.equal(r.type, 'unknown');
    assert.equal(r.reason, 'no_pattern_match');
  });
});

// ============================================================
// checkTodoWriteGate — branching
// ============================================================

describe('checkTodoWriteGate — empty/missing input', () => {
  it('allows empty todos array', () => {
    const r = checkTodoWriteGate({ todos: [] });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_todos');
  });

  it('allows missing todos field', () => {
    const r = checkTodoWriteGate({});
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_todos');
  });

  it('allows non-array todos', () => {
    const r = checkTodoWriteGate({ todos: 'not an array' });
    assert.equal(r.allowed, true);
  });
});

describe('checkTodoWriteGate — gate disabled', () => {
  it('allows any todos when gate disabled', () => {
    const config = { enforcement: { todoWriteGate: { enabled: false } } };
    const r = checkTodoWriteGate({
      todos: [{ content: 'Create complex feature', status: 'pending' }],
    }, config);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'gate_disabled');
  });

  it('allows any todos when strictMode disabled', () => {
    const config = { enforcement: { strictMode: false } };
    const r = checkTodoWriteGate({
      todos: [{ content: 'Create feature', status: 'pending' }],
    }, config);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'gate_disabled');
  });
});

describe('checkTodoWriteGate — only tracking todos', () => {
  const GATE_ON = { enforcement: { todoWriteGate: { enabled: true }, strictMode: true } };

  it('allows pure tracking todos', () => {
    const r = checkTodoWriteGate({
      todos: [
        { content: 'run tests', status: 'pending' },
        { content: 'commit changes', status: 'pending' },
        { content: 'push to remote', status: 'pending' },
      ],
    }, GATE_ON);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_implementation_todos');
    assert.ok(Array.isArray(r.trackingTodos));
    assert.equal(r.trackingTodos.length, 3);
  });

  it('allows unknown todos without implementation', () => {
    const r = checkTodoWriteGate({
      todos: [{ content: 'think about this', status: 'pending' }],
    }, GATE_ON);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_implementation_todos');
  });
});

describe('checkTodoWriteGate — warn-only mode', () => {
  it('allows impl todos with warn-only and no active task', () => {
    const config = {
      enforcement: {
        todoWriteGate: { blockImplementationWithoutTask: false },
      },
    };
    const r = checkTodoWriteGate({
      todos: [{ content: 'Create new component', status: 'pending' }],
    }, config);
    // Either warn_only (if no active task) OR task_active (if live ready.json has one)
    assert.equal(r.allowed, true);
    assert.ok(['warn_only', 'task_active'].includes(r.reason), `unexpected: ${r.reason}`);
  });
});

// ============================================================
// message generators
// ============================================================

describe('message generators', () => {
  it('generateBlockMessage mentions /wogi-start + /wogi-story', () => {
    const msg = generateBlockMessage(
      [{ content: 'Create X' }],
      [{ content: 'run tests' }]
    );
    assert.ok(msg.includes('BLOCKED'));
    assert.ok(msg.includes('/wogi-start') || msg.includes('/wogi-story'));
    assert.ok(msg.includes('Create X'));
  });

  it('generateBlockMessage handles empty tracking list', () => {
    const msg = generateBlockMessage([{ content: 'Add feature' }], []);
    assert.ok(msg.includes('Add feature'));
  });

  it('generateBlockMessage truncates to 5 impl todos', () => {
    const todos = Array.from({ length: 10 }, (_, i) => ({ content: `Create thing ${i}` }));
    const msg = generateBlockMessage(todos, []);
    // 5 lines of content
    assert.ok(msg.includes('thing 0'));
    assert.ok(msg.includes('thing 4'));
    // thing 5+ should NOT appear
    assert.ok(!msg.includes('thing 5'));
  });

  it('generateWarningMessage uses "Warning" prefix', () => {
    const msg = generateWarningMessage([{ content: 'Create X' }], []);
    assert.ok(msg.toLowerCase().includes('warning'));
    assert.ok(msg.includes('/wogi-story'));
  });
});

// ============================================================
// exports
// ============================================================

describe('module exports', () => {
  it('exports pattern arrays', () => {
    assert.ok(Array.isArray(IMPLEMENTATION_TODO_PATTERNS));
    assert.ok(Array.isArray(TRACKING_TODO_PATTERNS));
    assert.ok(Array.isArray(ALWAYS_ALLOWED_TODOS));
    assert.ok(IMPLEMENTATION_TODO_PATTERNS.length > 0);
    assert.ok(TRACKING_TODO_PATTERNS.length > 0);
  });
});
