'use strict';

/**
 * Tests for flow-io.js — file I/O operations, JSON handling, locking
 *
 * Development-only — not distributed to end users.
 * Run: node --test tests/flow-io.test.js
 */

const { describe, it, _beforeEach, _afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  readJson,
  writeJson,
  safeJsonParse,
  safeJsonParseString,
  fileExists,
  dirExists,
  _ensureDir,
  readFile,
  _writeFile,
  validateJson,
  _listDirs,
  listFiles,
  countFiles,
  checkForDangerousKeys,
  acquireLock,
  cleanupStaleLocks,
} = require('../scripts/flow-io');

// ============================================================
// Test Helpers
// ============================================================

const TEST_DIR = path.join(os.tmpdir(), `flow-io-test-${process.pid}-${Date.now()}`);
const dirsToClean = [TEST_DIR];

function tmpFile(name) {
  return path.join(TEST_DIR, name);
}

function writeTestJson(name, data) {
  const filePath = tmpFile(name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function writeTestFile(name, content) {
  const filePath = tmpFile(name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Suppress console.error during tests that trigger expected warnings
let originalConsoleError;
let originalConsoleLog;

function suppressConsole() {
  originalConsoleError = console.error;
  originalConsoleLog = console.log;
  console.error = () => {};
  console.log = () => {};
}

function restoreConsole() {
  if (originalConsoleError) console.error = originalConsoleError;
  if (originalConsoleLog) console.log = originalConsoleLog;
}

// ============================================================
// Setup / Teardown
// ============================================================

// Create test directory before all tests
fs.mkdirSync(TEST_DIR, { recursive: true });

after(() => {
  restoreConsole();
  for (const dir of dirsToClean) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// ============================================================
// Tests: readJson
// ============================================================

describe('readJson', () => {
  it('reads valid JSON file and returns parsed object', () => {
    const filePath = writeTestJson('valid.json', { name: 'test', count: 42 });
    const result = readJson(filePath);
    assert.deepEqual(result, { name: 'test', count: 42 });
  });

  it('returns defaultValue for missing file', () => {
    const result = readJson(tmpFile('nonexistent.json'), { fallback: true });
    assert.deepEqual(result, { fallback: true });
  });

  it('returns defaultValue for invalid JSON', () => {
    const filePath = writeTestFile('invalid.json', '{ broken json !!!');
    const result = readJson(filePath, { error: true });
    assert.deepEqual(result, { error: true });
  });

  it('detects prototype pollution (__proto__ key)', () => {
    // Write raw JSON with __proto__ key (can't use JSON.stringify as it strips it)
    const filePath = writeTestFile('proto.json', '{"__proto__": {"admin": true}}');
    const result = readJson(filePath, { safe: true });
    assert.deepEqual(result, { safe: true });
  });

  it('throws when file missing and no defaultValue', () => {
    assert.throws(() => {
      readJson(tmpFile('does-not-exist.json'));
    }, /Failed to read JSON/);
  });
});

// ============================================================
// Tests: writeJson
// ============================================================

describe('writeJson', () => {
  it('writes JSON and can be read back', () => {
    const filePath = tmpFile('write-test.json');
    writeJson(filePath, { hello: 'world', num: 7 });
    const result = readJson(filePath);
    assert.deepEqual(result, { hello: 'world', num: 7 });
  });

  it('uses atomic write (temp file + rename)', () => {
    // Verify no leftover .tmp files after successful write
    const filePath = tmpFile('atomic-test.json');
    writeJson(filePath, { atomic: true });

    const tempPath = filePath + '.tmp.' + process.pid;
    assert.equal(fs.existsSync(tempPath), false, 'Temp file should not exist after successful write');
    assert.equal(fs.existsSync(filePath), true, 'Target file should exist');
  });

  it('overwrites existing file', () => {
    const filePath = writeTestJson('overwrite.json', { version: 1 });
    writeJson(filePath, { version: 2 });
    const result = readJson(filePath);
    assert.deepEqual(result, { version: 2 });
  });
});

// ============================================================
// Tests: safeJsonParse
// ============================================================

describe('safeJsonParse', () => {
  it('reads valid JSON file', () => {
    const filePath = writeTestJson('safe-valid.json', { key: 'value' });
    const result = safeJsonParse(filePath);
    assert.deepEqual(result, { key: 'value' });
  });

  it('returns defaultValue for missing file', () => {
    const result = safeJsonParse(tmpFile('safe-missing.json'), { def: true });
    assert.deepEqual(result, { def: true });
  });

  it('rejects non-object JSON (array returns default)', () => {
    const filePath = writeTestFile('safe-array.json', '[1, 2, 3]');
    suppressConsole();
    try {
      const result = safeJsonParse(filePath, { isDefault: true });
      assert.deepEqual(result, { isDefault: true });
    } finally {
      restoreConsole();
    }
  });

  it('detects __proto__ key', () => {
    const filePath = writeTestFile('safe-proto.json', '{"__proto__": {"admin": true}}');
    suppressConsole();
    try {
      const result = safeJsonParse(filePath, { blocked: true });
      assert.deepEqual(result, { blocked: true });
    } finally {
      restoreConsole();
    }
  });

  it('detects nested __proto__ key', () => {
    const filePath = writeTestFile('safe-nested-proto.json',
      '{"data": {"nested": {"__proto__": {"admin": true}}}}'
    );
    suppressConsole();
    try {
      const result = safeJsonParse(filePath, { blocked: true });
      assert.deepEqual(result, { blocked: true });
    } finally {
      restoreConsole();
    }
  });

  it('returns null as default when no defaultValue provided', () => {
    const result = safeJsonParse(tmpFile('safe-no-default.json'));
    assert.equal(result, null);
  });
});

// ============================================================
// Tests: safeJsonParseString
// ============================================================

describe('safeJsonParseString', () => {
  it('parses valid JSON string', () => {
    const result = safeJsonParseString('{"name": "test"}');
    assert.deepEqual(result, { name: 'test' });
  });

  it('returns defaultValue for invalid string', () => {
    const result = safeJsonParseString('not json at all', { fallback: true });
    assert.deepEqual(result, { fallback: true });
  });

  it('detects prototype pollution', () => {
    const result = safeJsonParseString('{"__proto__": {"admin": true}}', { safe: true });
    assert.deepEqual(result, { safe: true });
  });

  it('allows arrays (unlike safeJsonParse)', () => {
    const result = safeJsonParseString('[1, 2, 3]');
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('returns defaultValue for null JSON', () => {
    const result = safeJsonParseString('null', { def: true });
    assert.deepEqual(result, { def: true });
  });

  it('returns defaultValue for primitive JSON', () => {
    const result = safeJsonParseString('42', { def: true });
    assert.deepEqual(result, { def: true });
  });
});

// ============================================================
// Tests: safeJsonParseStringStrip + stripDangerousKeys
// (audit dup-004 consolidation 2026-04-26)
// ============================================================

describe('safeJsonParseStringStrip', () => {
  const { safeJsonParseStringStrip, stripDangerousKeys } = require('../scripts/flow-io');

  it('parses valid JSON and returns object as-is when no dangerous keys', () => {
    assert.deepEqual(safeJsonParseStringStrip('{"name":"test"}'), { name: 'test' });
  });

  it('strips top-level __proto__ recursively (returns sanitized object, not defaultValue)', () => {
    const r = safeJsonParseStringStrip('{"a":1,"__proto__":"bad"}', null);
    assert.deepEqual(r, { a: 1 });
  });

  it('strips nested constructor key recursively', () => {
    const r = safeJsonParseStringStrip('{"a":1,"nested":{"constructor":"x","good":2}}', null);
    assert.deepEqual(r, { a: 1, nested: { good: 2 } });
  });

  it('strips dangerous keys inside arrays', () => {
    const r = safeJsonParseStringStrip('[{"prototype":1,"keep":2},{"__proto__":3}]', null);
    assert.deepEqual(r, [{ keep: 2 }, {}]);
  });

  it('returns defaultValue on parse error', () => {
    assert.equal(safeJsonParseStringStrip('not json', 'fallback'), 'fallback');
  });

  it('returns defaultValue on null/primitive (consistent with safeJsonParseString)', () => {
    assert.equal(safeJsonParseStringStrip('null', 'fallback'), 'fallback');
    assert.equal(safeJsonParseStringStrip('42', 'fallback'), 'fallback');
  });

  it('stripDangerousKeys mutates in place and is idempotent', () => {
    const obj = { a: 1, __proto__: 'bad', nested: { constructor: 2, good: 3 } };
    const r = stripDangerousKeys(obj);
    assert.equal(r, obj);
    assert.deepEqual(obj, { a: 1, nested: { good: 3 } });
    stripDangerousKeys(obj); // idempotent
    assert.deepEqual(obj, { a: 1, nested: { good: 3 } });
  });

  it('stripDangerousKeys bounded against pathological deep input (within cap)', () => {
    let deep = { good: 1 };
    for (let i = 0; i < 100; i++) deep = { nest: deep };
    // 100 levels < cap (256) — should walk normally, no sentinel
    const r = stripDangerousKeys(deep);
    assert.equal(typeof r, 'object');
    // Sentinel only fires past 256
  });

  it('stripDangerousKeys returns STRIP_TOO_DEEP sentinel past depth cap (SEC-001 fix)', () => {
    let deep = { good: 1 };
    for (let i = 0; i < 300; i++) deep = { nest: deep };
    const r = stripDangerousKeys(deep);
    // Sentinel returned; caller is responsible for treating as failure
    assert.ok(r && r.__wogiTooDeep === true, 'expected STRIP_TOO_DEEP sentinel');
  });

  it('safeJsonParseStringStrip returns defaultValue when depth cap exceeded (SEC-001 fail-safe)', () => {
    // Build pathological JSON string with 300 levels of nesting
    let json = '{"good":1}';
    for (let i = 0; i < 300; i++) json = `{"nest":${json}}`;
    const r = safeJsonParseStringStrip(json, 'fallback');
    // Without the fix: would return partially-stripped object (HIGH severity bypass)
    // With the fix: returns the defaultValue
    assert.equal(r, 'fallback');
  });

  it('safeJsonParseStringStrip with __proto__ at depth >cap → defaultValue (no leak)', () => {
    // Most important test: hostile __proto__ deep in tree must NOT survive
    let inner = '{"polluted":true}';
    for (let i = 0; i < 270; i++) inner = `{"a":${inner}}`;
    const wrapped = `{"__proto__":${inner}}`;
    const r = safeJsonParseStringStrip(wrapped, null);
    // Either fully scrubbed object OR null — must NOT contain __proto__ anywhere reachable
    if (r !== null) {
      assert.equal(Object.prototype.hasOwnProperty.call(r, '__proto__'), false);
    }
    // Verify Object.prototype is clean
    assert.equal(({}).polluted, undefined, 'Object.prototype must not be polluted');
  });
});

// ============================================================
// Tests: checkForDangerousKeys
// ============================================================

describe('checkForDangerousKeys', () => {
  it('returns null for safe objects', () => {
    assert.equal(checkForDangerousKeys({ a: 1, b: { c: 2 } }), null);
  });

  it('detects __proto__', () => {
    // Use Object.create(null) to avoid prototype chain issues
    const obj = Object.create(null);
    obj['__proto__'] = { admin: true };
    const result = checkForDangerousKeys(obj);
    assert.ok(result !== null, 'Should detect __proto__');
    assert.ok(result.includes('__proto__'));
  });

  it('detects constructor key', () => {
    const obj = Object.create(null);
    obj.constructor = { prototype: {} };
    const result = checkForDangerousKeys(obj);
    assert.ok(result !== null, 'Should detect constructor');
    assert.ok(result.includes('constructor'));
  });

  it('detects nested dangerous keys', () => {
    const inner = Object.create(null);
    inner['__proto__'] = true;
    const result = checkForDangerousKeys({ deep: { nested: inner } });
    assert.ok(result !== null, 'Should detect nested __proto__');
  });

  it('handles empty object', () => {
    assert.equal(checkForDangerousKeys({}), null);
  });

  it('handles arrays within objects', () => {
    assert.equal(checkForDangerousKeys({ items: [1, 'two', { safe: true }] }), null);
  });
});

// ============================================================
// Tests: fileExists / dirExists
// ============================================================

describe('fileExists', () => {
  it('returns true for existing file', () => {
    const filePath = writeTestFile('exists-test.txt', 'hello');
    assert.equal(fileExists(filePath), true);
  });

  it('returns false for missing file', () => {
    assert.equal(fileExists(tmpFile('does-not-exist.txt')), false);
  });
});

describe('dirExists', () => {
  it('returns true for existing directory', () => {
    assert.equal(dirExists(TEST_DIR), true);
  });

  it('returns false for files', () => {
    const filePath = writeTestFile('not-a-dir.txt', 'content');
    assert.equal(dirExists(filePath), false);
  });

  it('returns false for nonexistent path', () => {
    assert.equal(dirExists(tmpFile('no-such-dir')), false);
  });
});

// ============================================================
// Tests: validateJson
// ============================================================

describe('validateJson', () => {
  it('returns { valid: true } for valid JSON', () => {
    const filePath = writeTestJson('validate-good.json', { ok: true });
    const result = validateJson(filePath);
    assert.deepEqual(result, { valid: true });
  });

  it('returns { valid: false, error: ... } for invalid JSON', () => {
    const filePath = writeTestFile('validate-bad.json', '{ broken');
    const result = validateJson(filePath);
    assert.equal(result.valid, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });
});

// ============================================================
// Tests: readFile
// ============================================================

describe('readFile', () => {
  it('reads text file', () => {
    const filePath = writeTestFile('read-text.txt', 'Hello, world!');
    const result = readFile(filePath);
    assert.equal(result, 'Hello, world!');
  });

  it('returns defaultValue for missing file', () => {
    const result = readFile(tmpFile('missing-text.txt'), 'default content');
    assert.equal(result, 'default content');
  });

  it('throws when file missing and no defaultValue', () => {
    assert.throws(() => {
      readFile(tmpFile('no-default.txt'));
    }, /Failed to read file/);
  });
});

// ============================================================
// Tests: listFiles
// ============================================================

describe('listFiles', () => {
  it('returns files in directory', () => {
    const subDir = path.join(TEST_DIR, 'list-files-test');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(subDir, 'b.js'), 'b');
    fs.writeFileSync(path.join(subDir, 'c.txt'), 'c');

    const result = listFiles(subDir);
    assert.ok(Array.isArray(result));
    assert.ok(result.includes('a.txt'));
    assert.ok(result.includes('b.js'));
    assert.ok(result.includes('c.txt'));
  });

  it('filters by extension', () => {
    const subDir = path.join(TEST_DIR, 'list-files-filter');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'x.txt'), 'x');
    fs.writeFileSync(path.join(subDir, 'y.js'), 'y');
    fs.writeFileSync(path.join(subDir, 'z.txt'), 'z');

    const result = listFiles(subDir, '.txt');
    assert.ok(result.includes('x.txt'));
    assert.ok(result.includes('z.txt'));
    assert.ok(!result.includes('y.js'));
  });

  it('returns empty array for nonexistent directory', () => {
    const result = listFiles(tmpFile('no-such-dir'));
    assert.deepEqual(result, []);
  });
});

// ============================================================
// Tests: countFiles
// ============================================================

describe('countFiles', () => {
  it('counts files recursively with depth limit', () => {
    const subDir = path.join(TEST_DIR, 'count-files-test');
    const nested = path.join(subDir, 'sub1', 'sub2');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(subDir, 'sub1', 'b.txt'), 'b');
    fs.writeFileSync(path.join(nested, 'c.txt'), 'c');

    const result = countFiles(subDir);
    assert.ok(result >= 3, `Expected at least 3 files, got ${result}`);
  });

  it('filters by extension', () => {
    const subDir = path.join(TEST_DIR, 'count-ext-test');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'a.js'), 'a');
    fs.writeFileSync(path.join(subDir, 'b.txt'), 'b');
    fs.writeFileSync(path.join(subDir, 'c.js'), 'c');

    const jsCount = countFiles(subDir, ['.js']);
    assert.equal(jsCount, 2);
  });

  it('returns 0 for nonexistent directory', () => {
    assert.equal(countFiles(tmpFile('no-count-dir')), 0);
  });

  it('respects depth limit', () => {
    const subDir = path.join(TEST_DIR, 'depth-test');
    const deep = path.join(subDir, 'l1', 'l2', 'l3');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'top.txt'), 'top');
    fs.writeFileSync(path.join(deep, 'deep.txt'), 'deep');

    // maxDepth=1 should only see top-level files
    const shallow = countFiles(subDir, [], 1);
    assert.equal(shallow, 1, 'Depth 1 should only count top-level files');
  });
});

// ============================================================
// Tests: acquireLock
// ============================================================

describe('acquireLock', () => {
  it('acquires and releases lock', async () => {
    const lockTarget = tmpFile('lock-target.json');
    fs.writeFileSync(lockTarget, '{}');

    const release = await acquireLock(lockTarget, { staleMs: 5000 });
    assert.equal(typeof release, 'function');

    // Lock directory should exist
    assert.equal(fs.existsSync(lockTarget + '.lock'), true);

    // Release should remove the lock
    release();
    assert.equal(fs.existsSync(lockTarget + '.lock'), false);
  });

  it('detects stale locks and recovers', async () => {
    const lockTarget = tmpFile('stale-lock-target.json');
    fs.writeFileSync(lockTarget, '{}');

    // Create a fake stale lock
    const lockDir = lockTarget + '.lock';
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'info.json'), JSON.stringify({
      pid: 99999,
      timestamp: Date.now() - 120000, // 2 minutes ago — definitely stale
      file: lockTarget
    }));

    // Should recover from stale lock
    const release = await acquireLock(lockTarget, { staleMs: 1000, retries: 5, retryDelay: 50 });
    assert.equal(typeof release, 'function');
    release();
  });
});

// ============================================================
// Tests: cleanupStaleLocks
// ============================================================

describe('cleanupStaleLocks', () => {
  it('removes old locks', () => {
    const lockDir = path.join(TEST_DIR, 'cleanup-locks-test');
    fs.mkdirSync(lockDir, { recursive: true });

    // Create a stale lock
    const staleLock = path.join(lockDir, 'file.json.lock');
    fs.mkdirSync(staleLock, { recursive: true });
    fs.writeFileSync(path.join(staleLock, 'info.json'), JSON.stringify({
      pid: 99999,
      timestamp: Date.now() - 120000, // 2 minutes ago
      file: 'file.json'
    }));

    const cleaned = cleanupStaleLocks(lockDir, 1000); // 1 second stale threshold
    assert.ok(cleaned >= 1, `Expected at least 1 cleaned lock, got ${cleaned}`);
    assert.equal(fs.existsSync(staleLock), false, 'Stale lock should be removed');
  });

  it('returns 0 for nonexistent directory', () => {
    assert.equal(cleanupStaleLocks(tmpFile('no-lock-dir')), 0);
  });

  it('does not remove fresh locks', () => {
    const lockDir = path.join(TEST_DIR, 'fresh-locks-test');
    fs.mkdirSync(lockDir, { recursive: true });

    // Create a fresh lock
    const freshLock = path.join(lockDir, 'fresh.json.lock');
    fs.mkdirSync(freshLock, { recursive: true });
    fs.writeFileSync(path.join(freshLock, 'info.json'), JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(), // Just now
      file: 'fresh.json'
    }));

    const cleaned = cleanupStaleLocks(lockDir, 60000); // 60 second threshold
    assert.equal(cleaned, 0, 'Should not clean fresh locks');
    assert.equal(fs.existsSync(freshLock), true, 'Fresh lock should remain');
  });
});
