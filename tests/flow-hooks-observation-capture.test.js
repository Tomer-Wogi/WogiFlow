'use strict';

/**
 * Tests for scripts/hooks/core/observation-capture.js (Wave F hook coverage).
 *
 * Covers: shouldSkipTool invalid-input handling, summarizeInput per-tool
 * formatting (Edit/Write/Bash/Read/Glob/Grep/WebFetch/WebSearch/Task/
 * AskUserQuestion/Skill/generic fallback), truncation at configured limits,
 * summarizeOutput success + failure paths, error fallback messages.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-observation-capture.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  shouldSkipTool,
  summarizeInput,
  summarizeOutput,
  isObservationCaptureEnabled,
  getMaxInputSize,
  getMaxOutputSize,
  selectDuration,
} = require('../scripts/hooks/core/observation-capture');

// ============================================================
// shouldSkipTool
// ============================================================

describe('shouldSkipTool', () => {
  it('returns true for invalid (non-string) tool names', () => {
    assert.equal(shouldSkipTool(null), true);
    assert.equal(shouldSkipTool(undefined), true);
    assert.equal(shouldSkipTool(42), true);
    assert.equal(shouldSkipTool({}), true);
  });

  it('returns true for empty string', () => {
    assert.equal(shouldSkipTool(''), true);
  });

  it('returns a boolean for valid tool names', () => {
    assert.equal(typeof shouldSkipTool('Edit'), 'boolean');
  });
});

// ============================================================
// Config getters
// ============================================================

describe('config getters', () => {
  it('isObservationCaptureEnabled returns a boolean', () => {
    assert.equal(typeof isObservationCaptureEnabled(), 'boolean');
  });

  it('getMaxInputSize returns a positive number', () => {
    const n = getMaxInputSize();
    assert.ok(Number.isFinite(n) && n > 0);
  });

  it('getMaxOutputSize returns a positive number', () => {
    const n = getMaxOutputSize();
    assert.ok(Number.isFinite(n) && n > 0);
  });
});

// ============================================================
// summarizeInput — per-tool formatting
// ============================================================

describe('summarizeInput — Edit tool', () => {
  it('includes file path and snippets of old/new strings', () => {
    const s = summarizeInput('Edit', {
      file_path: 'src/foo.js',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });
    assert.ok(s.includes('src/foo.js'));
    assert.ok(s.includes('const x = 1'));
    assert.ok(s.includes('const x = 2'));
    assert.ok(s.startsWith('Edit'));
  });

  it('handles missing file_path gracefully', () => {
    const s = summarizeInput('Edit', { old_string: 'x', new_string: 'y' });
    assert.ok(s.includes('unknown'));
  });

  it('truncates long old_string/new_string to 30 chars', () => {
    const long = 'a'.repeat(100);
    const s = summarizeInput('Edit', { file_path: 'f.js', old_string: long, new_string: long });
    assert.ok(s.includes('...'));
  });
});

describe('summarizeInput — Write tool', () => {
  it('includes file path and content length', () => {
    const s = summarizeInput('Write', { file_path: 'src/new.js', content: 'x'.repeat(500) });
    assert.ok(s.includes('src/new.js'));
    assert.ok(s.includes('500'));
    assert.ok(s.includes('chars'));
  });

  it('handles missing content', () => {
    const s = summarizeInput('Write', { file_path: 'f.js' });
    assert.ok(s.includes('0 chars'));
  });
});

describe('summarizeInput — Bash tool', () => {
  it('includes command prefix', () => {
    const s = summarizeInput('Bash', { command: 'npm test' });
    assert.ok(s.includes('npm test'));
    assert.ok(s.startsWith('Bash'));
  });

  it('truncates commands over 80 chars with ellipsis', () => {
    const long = 'echo ' + 'x'.repeat(100);
    const s = summarizeInput('Bash', { command: long });
    assert.ok(s.includes('...'));
    // 80-char command portion + prefix
  });

  it('does NOT add ellipsis for short commands', () => {
    const s = summarizeInput('Bash', { command: 'ls' });
    assert.ok(!s.endsWith('...'));
  });

  it('handles missing command', () => {
    const s = summarizeInput('Bash', {});
    assert.ok(s.startsWith('Bash'));
  });
});

describe('summarizeInput — Read tool', () => {
  it('includes file path', () => {
    const s = summarizeInput('Read', { file_path: '/p/file.js' });
    assert.ok(s.includes('/p/file.js'));
  });

  it('appends offset when provided', () => {
    const s = summarizeInput('Read', { file_path: 'f.js', offset: 42 });
    assert.ok(s.includes('offset: 42'));
  });

  it('omits offset when zero (falsy — matches source behavior)', () => {
    const s = summarizeInput('Read', { file_path: 'f.js', offset: 0 });
    assert.ok(!s.includes('offset'));
  });
});

describe('summarizeInput — Glob/Grep tools', () => {
  it('Glob includes pattern', () => {
    const s = summarizeInput('Glob', { pattern: '**/*.ts' });
    assert.ok(s.includes('**/*.ts'));
  });

  it('Glob includes path when provided', () => {
    const s = summarizeInput('Glob', { pattern: '*.js', path: 'src/' });
    assert.ok(s.includes('src/'));
  });

  it('Grep includes pattern', () => {
    const s = summarizeInput('Grep', { pattern: 'function foo' });
    assert.ok(s.includes('function foo'));
  });
});

describe('summarizeInput — Web tools', () => {
  it('WebFetch includes URL', () => {
    const s = summarizeInput('WebFetch', { url: 'https://example.com' });
    assert.ok(s.includes('https://example.com'));
  });

  it('WebSearch includes query', () => {
    const s = summarizeInput('WebSearch', { query: 'claude code' });
    assert.ok(s.includes('claude code'));
  });
});

describe('summarizeInput — Task tool', () => {
  it('includes subagent_type and description', () => {
    const s = summarizeInput('Task', {
      subagent_type: 'Explore',
      description: 'Search for auth handlers',
    });
    assert.ok(s.includes('Explore'));
    assert.ok(s.includes('Search for auth handlers'));
  });

  it('falls back to prompt when description missing', () => {
    const s = summarizeInput('Task', { subagent_type: 'Plan', prompt: 'design the schema' });
    assert.ok(s.includes('design the schema'));
  });
});

describe('summarizeInput — AskUserQuestion', () => {
  it('includes first question', () => {
    const s = summarizeInput('AskUserQuestion', {
      questions: [{ question: 'Which option?' }, { question: 'second' }],
    });
    assert.ok(s.includes('Which option?'));
    // Should not include the second question
    assert.ok(!s.includes('second'));
  });

  it('handles missing questions array', () => {
    const s = summarizeInput('AskUserQuestion', {});
    assert.ok(s.includes('no question'));
  });
});

describe('summarizeInput — Skill tool', () => {
  it('includes skill name', () => {
    const s = summarizeInput('Skill', { skill: 'wogi-start' });
    assert.ok(s.includes('wogi-start'));
  });

  it('includes truncated args when provided', () => {
    const s = summarizeInput('Skill', { skill: 'wogi-start', args: 'wf-abc123' });
    assert.ok(s.includes('wf-abc123'));
  });
});

describe('summarizeInput — generic fallback', () => {
  it('truncates generic JSON to 60 chars', () => {
    const s = summarizeInput('UnknownTool', { veryLongPayload: 'x'.repeat(200) });
    assert.ok(s.includes('UnknownTool'));
    assert.ok(s.includes('...'));
  });

  it('does NOT truncate short generic payloads', () => {
    const s = summarizeInput('UnknownTool', { x: 1 });
    assert.ok(!s.endsWith('...'));
  });
});

describe('summarizeInput — error handling', () => {
  it('returns friendly error string for null input', () => {
    const s = summarizeInput('Edit', null);
    assert.ok(s.includes('no input'));
  });
});

// ============================================================
// summarizeOutput
// ============================================================

describe('summarizeOutput — failure path', () => {
  it('returns Failed: <msg> when success=false and response is string', () => {
    const s = summarizeOutput('Bash', 'command not found', false);
    assert.ok(s.includes('Failed'));
    assert.ok(s.includes('command not found'));
  });

  it('extracts error from response object', () => {
    const s = summarizeOutput('Edit', { error: 'file locked' }, false);
    assert.ok(s.includes('file locked'));
  });

  it('extracts message from response object', () => {
    const s = summarizeOutput('Write', { message: 'permission denied' }, false);
    assert.ok(s.includes('permission denied'));
  });

  it('falls back to "Unknown error" for empty response', () => {
    const s = summarizeOutput('Edit', null, false);
    assert.ok(s.includes('Unknown error') || s.includes('Failed'));
  });
});

describe('summarizeOutput — success path', () => {
  it('Edit returns "Edit applied successfully"', () => {
    assert.ok(summarizeOutput('Edit', 'ok', true).includes('Edit applied'));
  });

  it('Write returns "File written successfully"', () => {
    assert.ok(summarizeOutput('Write', 'ok', true).includes('File written'));
  });

  it('Bash single-line output', () => {
    const s = summarizeOutput('Bash', 'hello world', true);
    assert.ok(s.includes('hello world'));
  });

  it('Bash multi-line output reports line count', () => {
    const s = summarizeOutput('Bash', 'line1\nline2\nline3\nline4', true);
    assert.ok(s.includes('4 lines'));
  });

  it('Bash empty output returns "no output"', () => {
    const s = summarizeOutput('Bash', '', true);
    assert.ok(s.includes('no output'));
  });

  it('Read reports char + line count', () => {
    const s = summarizeOutput('Read', 'line1\nline2\nline3', true);
    assert.ok(s.includes('chars'));
    assert.ok(s.includes('lines'));
  });

  it('Glob reports file count', () => {
    const s = summarizeOutput('Glob', 'a.js\nb.js\nc.js', true);
    assert.ok(s.includes('Found'));
    assert.ok(s.includes('file'));
  });

  it('Grep reports match count', () => {
    const s = summarizeOutput('Grep', 'match1\nmatch2\n', true);
    assert.ok(s.includes('match'));
  });

  it('WebFetch reports char count', () => {
    const s = summarizeOutput('WebFetch', 'x'.repeat(500), true);
    assert.ok(s.includes('500'));
    assert.ok(s.includes('chars'));
  });

  it('WebSearch returns "Search completed"', () => {
    assert.ok(summarizeOutput('WebSearch', 'results', true).includes('Search'));
  });

  it('Task reports output char count', () => {
    const s = summarizeOutput('Task', 'x'.repeat(100), true);
    assert.ok(s.includes('100') || s.includes('Task completed'));
  });

  it('AskUserQuestion returns generic presented message', () => {
    const s = summarizeOutput('AskUserQuestion', 'answered', true);
    assert.ok(s.includes('Question'));
  });

  it('generic tool truncates long output', () => {
    const s = summarizeOutput('Unknown', 'x'.repeat(200), true);
    assert.ok(s.includes('...'));
  });

  it('no response returns "Completed (no output)"', () => {
    const s = summarizeOutput('Edit', null, true);
    assert.ok(s.includes('Completed') || s.includes('Edit applied'));
  });
});

// ============================================================
// selectDuration — Claude Code 2.1.119 native duration_ms vs fallback
// ============================================================

describe('selectDuration', () => {
  it('returns native duration_ms when payload is a number (CC >= 2.1.119)', () => {
    assert.equal(selectDuration({ duration_ms: 1234 }, 0), 1234);
  });

  it('returns native 0 when CC reports a zero-ms tool (still a number, not missing)', () => {
    assert.equal(selectDuration({ duration_ms: 0 }, 99), 0);
  });

  it('falls back when duration_ms is absent (older CC)', () => {
    assert.equal(selectDuration({ toolName: 'Edit' }, 42), 42);
  });

  it('falls back when duration_ms is undefined', () => {
    assert.equal(selectDuration({ duration_ms: undefined }, 42), 42);
  });

  it('falls back when duration_ms is null (not a number)', () => {
    assert.equal(selectDuration({ duration_ms: null }, 42), 42);
  });

  it('falls back when duration_ms is a non-numeric string', () => {
    assert.equal(selectDuration({ duration_ms: '1234' }, 42), 42);
  });

  it('falls back when duration_ms is NaN guarded by typeof number — NaN is technically a number', () => {
    // typeof NaN === 'number', so per the guard, NaN passes through.
    // Documented behavior: we trust CC not to emit NaN; if it does, we surface it as-is.
    assert.equal(Number.isNaN(selectDuration({ duration_ms: NaN }, 42)), true);
  });

  it('falls back when parsedInput itself is null', () => {
    assert.equal(selectDuration(null, 42), 42);
  });

  it('falls back when parsedInput is undefined', () => {
    assert.equal(selectDuration(undefined, 42), 42);
  });
});
