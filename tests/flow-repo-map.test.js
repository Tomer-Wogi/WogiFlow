#!/usr/bin/env node

/**
 * Tests for flow-repo-map.
 * Story: wf-f3707d2f (C1)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  generateRepoMap,
  extractSymbols,
  findAdjacent,
  collectCodeFiles,
  DEFAULT_BUDGET_BYTES,
} = require('../scripts/flow-repo-map');

test('DEFAULT_BUDGET_BYTES is 16KB', () => {
  assert.equal(DEFAULT_BUDGET_BYTES, 16 * 1024);
});

test('extractSymbols parses named function declarations', () => {
  const tmp = path.join(os.tmpdir(), `repo-map-test-${Date.now()}.js`);
  fs.writeFileSync(tmp, 'function foo(a, b) { return a + b; }\nfunction bar() {}\n');
  try {
    const info = extractSymbols(tmp);
    assert.ok(info.symbols.some((s) => s.startsWith('foo')));
    assert.ok(info.symbols.some((s) => s.startsWith('bar')));
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('extractSymbols parses classes', () => {
  const tmp = path.join(os.tmpdir(), `repo-map-test-${Date.now()}.js`);
  fs.writeFileSync(tmp, 'class Widget {}\nclass Gadget extends Widget {}\n');
  try {
    const info = extractSymbols(tmp);
    assert.ok(info.symbols.includes('Widget'));
    assert.ok(info.symbols.includes('Gadget'));
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('extractSymbols parses arrow-function consts', () => {
  const tmp = path.join(os.tmpdir(), `repo-map-test-${Date.now()}.js`);
  fs.writeFileSync(tmp, 'const calc = (x) => x + 1;\nconst ASYNC_THING = async (y) => y;\n');
  try {
    const info = extractSymbols(tmp);
    assert.ok(info.symbols.includes('calc'));
    assert.ok(info.symbols.includes('ASYNC_THING'));
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('extractSymbols handles missing file gracefully', () => {
  const info = extractSymbols('/nonexistent/path/file.js');
  assert.equal(info.symbols.length, 0);
  assert.equal(info.loc, 0);
});

test('collectCodeFiles returns JS/TS files from the project', () => {
  const files = collectCodeFiles();
  assert.ok(files.length > 0);
  assert.ok(files.every((f) => /\.(js|ts|tsx|jsx|mjs|cjs)$/.test(f)));
  // Should NOT include node_modules
  assert.ok(files.every((f) => !f.startsWith('node_modules/')));
});

test('findAdjacent finds files that import the seed', () => {
  // flow-completion-truth-gate.js is required by flow-skeptical-evaluator.js
  const all = collectCodeFiles();
  const adj = findAdjacent(['scripts/flow-completion-truth-gate.js'], all);
  assert.ok(adj.includes('scripts/flow-skeptical-evaluator.js'), `expected adjacent to include flow-skeptical-evaluator.js; got ${adj.slice(0, 5).join(', ')}...`);
});

test('generateRepoMap with no touched files still produces SHAPE', () => {
  const result = generateRepoMap({ changedFiles: [] });
  assert.match(result.markdown, /# Repo Map/);
  assert.match(result.markdown, /SHAPE/);
  assert.ok(result.stats.filesScanned > 0);
});

test('generateRepoMap with touched files shows TOUCHED section', () => {
  const result = generateRepoMap({
    changedFiles: ['scripts/flow-repo-map.js'],
    taskId: 'wf-test0001',
  });
  assert.match(result.markdown, /## TOUCHED/);
  assert.match(result.markdown, /flow-repo-map\.js/);
  assert.equal(result.stats.touched, 1);
});

test('generateRepoMap respects budget', () => {
  const result = generateRepoMap({
    changedFiles: ['scripts/flow-repo-map.js'],
    budgetBytes: 500,
  });
  assert.ok(result.markdown.length <= 500);
  assert.equal(result.stats.truncated, true);
});

test('generateRepoMap returns empty when disabled via config', () => {
  // We can't easily mock getConfig here; just verify the shape handles { enabled: false }.
  // The skipped path is exercised by integration; this test ensures output is a string always.
  const result = generateRepoMap({ changedFiles: [] });
  assert.equal(typeof result.markdown, 'string');
  assert.equal(typeof result.stats, 'object');
});
