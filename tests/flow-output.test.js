'use strict';

/**
 * Tests for flow-output.js — terminal output formatting utilities
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-output.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
let originalLog, originalWarn;
beforeEach(() => {
  originalLog = console.log;
  originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
});
afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});

const {
  colors,
  color,
  print,
  printHeader,
  printSection,
  success,
  warn,
  error,
  info,
  showHelp,
  escapeRegex,
  getTodayDate,
} = require('../scripts/flow-output');

// ============================================================
// colors object
// ============================================================

describe('colors object', () => {
  it('has reset key', () => {
    assert.equal(typeof colors.reset, 'string');
  });

  it('has bold key', () => {
    assert.equal(typeof colors.bold, 'string');
  });

  it('has dim key', () => {
    assert.equal(typeof colors.dim, 'string');
  });

  const expectedColors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

  for (const c of expectedColors) {
    it(`has ${c} key`, () => {
      assert.equal(typeof colors[c], 'string');
      assert.ok(colors[c].length > 0, `colors.${c} should not be empty`);
    });
  }

  it('all values are ANSI escape strings', () => {
    for (const [key, value] of Object.entries(colors)) {
      assert.equal(typeof value, 'string', `colors.${key} should be a string`);
      assert.ok(value.startsWith('\x1b['), `colors.${key} should start with ANSI escape`);
    }
  });
});

// ============================================================
// color() function
// ============================================================

describe('color()', () => {
  it('returns a string', () => {
    const result = color('red', 'hello');
    assert.equal(typeof result, 'string');
  });

  it('wraps text with ANSI codes for known colors', () => {
    const result = color('green', 'test');
    assert.ok(result.includes(colors.green), 'should contain green ANSI code');
    assert.ok(result.includes('test'), 'should contain the text');
    assert.ok(result.includes(colors.reset), 'should contain reset code');
  });

  it('returns text with reset when color is unknown', () => {
    const result = color('nonexistent', 'hello');
    assert.ok(result.includes('hello'), 'should still contain the text');
    assert.ok(result.includes(colors.reset), 'should contain reset code');
  });

  it('handles empty text', () => {
    const result = color('red', '');
    assert.equal(typeof result, 'string');
  });

  it('handles special characters in text', () => {
    const result = color('blue', '<script>alert("xss")</script>');
    assert.ok(result.includes('<script>'), 'should preserve text as-is');
  });
});

// ============================================================
// print(), printHeader(), printSection()
// ============================================================

describe('print()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => print('cyan', 'test message'));
  });

  it('does not throw with unknown color', () => {
    assert.doesNotThrow(() => print('nonexistent', 'test'));
  });
});

describe('printHeader()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => printHeader('My Header'));
  });

  it('does not throw with empty string', () => {
    assert.doesNotThrow(() => printHeader(''));
  });
});

describe('printSection()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => printSection('Section Title'));
  });
});

// ============================================================
// Standard messaging functions
// ============================================================

describe('success()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => success('operation completed'));
  });
});

describe('warn()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => warn('something might be wrong'));
  });
});

describe('error()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => error('something failed'));
  });
});

describe('info()', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => info('informational message'));
  });
});

// ============================================================
// showHelp()
// ============================================================

describe('showHelp()', () => {
  it('does not throw with minimal arguments', () => {
    assert.doesNotThrow(() => showHelp('test-script.js', 'A test script', []));
  });

  it('does not throw with commands', () => {
    assert.doesNotThrow(() =>
      showHelp('test-script.js', 'desc', [
        { name: 'run', description: 'Run the thing' },
        { name: 'stop', description: 'Stop the thing' },
      ])
    );
  });

  it('does not throw with options and examples', () => {
    assert.doesNotThrow(() =>
      showHelp('test-script.js', 'desc', [], {
        options: [{ name: '--verbose', description: 'Verbose output' }],
        examples: ['node test-script.js run'],
      })
    );
  });
});

// ============================================================
// escapeRegex()
// ============================================================

describe('escapeRegex()', () => {
  it('escapes special regex characters', () => {
    const result = escapeRegex('hello.world*');
    assert.equal(result, 'hello\\.world\\*');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(escapeRegex(null), '');
    assert.equal(escapeRegex(undefined), '');
  });

  it('returns empty string for non-string input', () => {
    assert.equal(escapeRegex(123), '');
  });

  it('returns same string when no special chars', () => {
    assert.equal(escapeRegex('hello'), 'hello');
  });

  it('escaped string is safe for RegExp constructor', () => {
    const dangerous = 'file.(test)+[0]';
    const escaped = escapeRegex(dangerous);
    assert.doesNotThrow(() => new RegExp(escaped));
  });
});

// ============================================================
// getTodayDate()
// ============================================================

describe('getTodayDate()', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = getTodayDate();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns today\'s date', () => {
    const result = getTodayDate();
    const expected = new Date().toISOString().split('T')[0];
    assert.equal(result, expected);
  });
});
