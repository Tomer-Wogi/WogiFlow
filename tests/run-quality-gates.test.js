'use strict';

/**
 * Smoke tests for runQualityGates() and getModifiedFiles() in flow-done.js
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node tests/run-quality-gates.test.js
 */

process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');

// Load test exports (NODE_ENV=test prevents main() from running)
const { _test } = require('../scripts/flow-done');
const { runQualityGates, getModifiedFiles, _cp, _io } = _test;

// Save originals for cleanup
const origIo = { ..._io };
const origCp = { ..._cp };

let passed = 0;
let failed = 0;

function test(name, fn) {
  // Reset all mocks before each test
  console.log = () => {};
  console.error = () => {};
  _io.getConfig = () => ({ qualityGates: {}, scripts: {}, testing: { enabled: false }, contextMonitor: { checkAfterTask: false } });
  _io.fileExists = (p) => p.endsWith('config.json');
  _io.readFile = (_p, def) => def;
  _io.readJson = (_p, def) => def;
  _io.safeJsonParse = (_p, def) => def;
  _io.safeJsonParseString = (_s, def) => { try { return JSON.parse(_s); } catch { return def; } };
  _io.validateTaskId = (id) => ({ valid: /^wf-[a-f0-9]{8}$/i.test(id), id });
  _cp.spawnSync = () => ({ status: 0, stdout: '', stderr: '' });
  _cp.execSync = () => '';

  try {
    fn();
    passed++;
    process.stderr.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

// ── runQualityGates ──────────────────────────────────────

process.stderr.write('\n\x1b[1mrunQualityGates\x1b[0m\n');

test('fails with invalid taskId', () => {
  const r = runQualityGates('not-valid', 'feature');
  assert.equal(r.passed, false);
  assert.ok(r.failed.includes('invalidTaskId'));
});

test('passes when config file does not exist', () => {
  _io.fileExists = () => false;
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('passes when gate list is empty', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: [] } }, scripts: {}, testing: { enabled: false } });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('returns correct structure', () => {
  const r = runQualityGates('wf-aabbccdd', 'feature');
  assert.ok('passed' in r && 'failed' in r && 'errors' in r);
  assert.ok(Array.isArray(r.failed));
  assert.equal(typeof r.errors, 'object');
});

test('tests gate — passes when npm test succeeds', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['tests'] } }, scripts: { test: 'jest' }, testing: { enabled: false } });
  _cp.spawnSync = () => ({ status: 0, stdout: 'OK', stderr: '' });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('tests gate — fails when npm test fails', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['tests'] } }, scripts: { test: 'jest' }, testing: { enabled: false } });
  _cp.spawnSync = () => ({ status: 1, stdout: '', stderr: 'Test failed' });
  const r = runQualityGates('wf-aabbccdd', 'feature');
  assert.equal(r.passed, false);
  assert.ok(r.failed.includes('tests'));
});

test('skips tests gate when no test script configured', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['tests'] } }, scripts: {}, testing: { enabled: false } });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('requestLogEntry — passes when taskId found in log', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['requestLogEntry'] } }, scripts: {}, testing: { enabled: false } });
  _io.readFile = (p) => p.endsWith('request-log.md') ? 'R-001: wf-aabbccdd done' : '';
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('requestLogEntry — soft warning when taskId not in log (does not fail)', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['requestLogEntry'] } }, scripts: {}, testing: { enabled: false } });
  _io.readFile = () => 'nothing matching here';
  const r = runQualityGates('wf-aabbccdd', 'feature');
  // requestLogEntry is a soft gate — warns but doesn't block
  assert.equal(r.passed, true);
  assert.ok(!r.failed.includes('requestLogEntry'));
});

test('falls back to feature gates for unknown task types', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: [] } }, scripts: {}, testing: { enabled: false } });
  assert.equal(runQualityGates('wf-aabbccdd', 'unknownType').passed, true);
});

test('loopComplete — no active loop passes', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['loopComplete'] } }, scripts: {}, testing: { enabled: false } });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('unknown gate names do not fail', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['someUnknownGate'] } }, scripts: {}, testing: { enabled: false } });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('multiple gates — tests fail, log soft-passes', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['tests', 'requestLogEntry'] } }, scripts: { test: 'jest' }, testing: { enabled: false } });
  _cp.spawnSync = () => ({ status: 1, stdout: '', stderr: 'FAIL' });
  _io.readFile = () => 'wf-aabbccdd found';
  const r = runQualityGates('wf-aabbccdd', 'feature');
  assert.equal(r.passed, false);
  assert.ok(r.failed.includes('tests'));
  assert.ok(!r.failed.includes('requestLogEntry'));
});

test('lint gate — passes on success', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['lint'] } }, scripts: { lint: 'eslint' }, testing: { enabled: false } });
  _cp.spawnSync = () => ({ status: 0, stdout: '', stderr: '' });
  assert.equal(runQualityGates('wf-aabbccdd', 'feature').passed, true);
});

test('typecheck gate — fails on error', () => {
  _io.getConfig = () => ({ qualityGates: { feature: { require: ['typecheck'] } }, scripts: { typecheck: 'tsc' }, testing: { enabled: false } });
  _cp.spawnSync = () => ({ status: 2, stdout: '', stderr: 'TS2322: Type mismatch' });
  const r = runQualityGates('wf-aabbccdd', 'feature');
  assert.equal(r.passed, false);
  assert.ok(r.failed.includes('typecheck'));
});

// ── getModifiedFiles ─────────────────────────────────────

process.stderr.write('\n\x1b[1mgetModifiedFiles\x1b[0m\n');

test('returns empty array on git error', () => {
  _cp.execSync = () => { throw new Error('not a git repo'); };
  assert.deepEqual(getModifiedFiles(), []);
});

test('parses git status --porcelain', () => {
  _cp.execSync = () => 'M  src/app.js\n?? src/new.js\n';
  assert.ok(getModifiedFiles().length > 0);
});

test('returns empty for clean working dir', () => {
  _cp.execSync = () => '';
  assert.deepEqual(getModifiedFiles(), []);
});

// ── Summary ──────────────────────────────────────────────

process.stderr.write(`\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m\n\n`);

// Restore originals
Object.assign(_io, origIo);
Object.assign(_cp, origCp);
process.exit(failed > 0 ? 1 : 0);
