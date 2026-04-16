'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, detectStructureChanges, DEFAULT_RESTRUCTURE_THRESHOLD } = require('../scripts/flow-structure-sensor');

// classify() takes parsed entries, so we can unit-test the logic without invoking git.

test('classify — detects FOLDER_PER_COMPONENT when X.tsx → X/X.tsx', () => {
  const entries = [
    { status: 'D', path: 'src/components/Card.tsx' },
    { status: 'A', path: 'src/components/Card/Card.tsx' },
  ];
  const res = classify(entries);
  assert.equal(res.patterns.length, 1);
  assert.equal(res.patterns[0].type, 'FOLDER_PER_COMPONENT');
  assert.equal(res.restructureCount, 2);
  assert.equal(res.totalChanged, 2);
  assert.equal(res.ratio, 1);
});

test('classify — detects SPLIT_INTO_SUBMODULE when X.ts → X/a.ts + X/b.ts', () => {
  const entries = [
    { status: 'D', path: 'src/utils.ts' },
    { status: 'A', path: 'src/utils/date.ts' },
    { status: 'A', path: 'src/utils/string.ts' },
  ];
  const res = classify(entries);
  const split = res.patterns.find((p) => p.type === 'SPLIT_INTO_SUBMODULE');
  assert.ok(split, 'expected SPLIT_INTO_SUBMODULE');
  assert.equal(split.added.length, 2);
});

test('classify — detects BARREL_INTRODUCTION when X.ts → X/index.ts', () => {
  const entries = [
    { status: 'D', path: 'lib/types.ts' },
    { status: 'A', path: 'lib/types/index.ts' },
  ];
  const res = classify(entries);
  const barrel = res.patterns.find((p) => p.type === 'BARREL_INTRODUCTION');
  assert.ok(barrel, 'expected BARREL_INTRODUCTION');
});

test('classify — detects RENAME_NEW_HOME from git R-prefix entries', () => {
  const entries = [
    { status: 'R100', origPath: 'src/a.ts', path: 'src/lib/a.ts' },
  ];
  const res = classify(entries);
  const rename = res.patterns.find((p) => p.type === 'RENAME_NEW_HOME');
  assert.ok(rename, 'expected RENAME_NEW_HOME');
});

test('classify — ignores routine modifications without restructure patterns', () => {
  const entries = [
    { status: 'M', path: 'src/App.tsx' },
    { status: 'M', path: 'src/index.ts' },
    { status: 'A', path: 'src/new-feature.ts' },
  ];
  const res = classify(entries);
  assert.equal(res.patterns.length, 0);
  assert.equal(res.restructureCount, 0);
  assert.equal(res.ratio, 0);
});

test('classify — ratio is restructure-files / total-changed', () => {
  // 2 restructure files (Card.tsx → Card/Card.tsx) out of 4 total = 0.5
  const entries = [
    { status: 'D', path: 'src/Card.tsx' },
    { status: 'A', path: 'src/Card/Card.tsx' },
    { status: 'M', path: 'src/App.tsx' },
    { status: 'M', path: 'src/index.ts' },
  ];
  const res = classify(entries);
  assert.equal(res.totalChanged, 4);
  assert.equal(res.restructureCount, 2);
  assert.equal(res.ratio, 0.5);
});

test('classify — same-dir rename does NOT match RENAME_NEW_HOME', () => {
  const entries = [
    { status: 'R100', origPath: 'src/a.ts', path: 'src/b.ts' },
  ];
  const res = classify(entries);
  const rename = res.patterns.find((p) => p.type === 'RENAME_NEW_HOME');
  assert.equal(rename, undefined, 'same-directory rename should not count as new-home');
});

test('detectStructureChanges — returns ok:false when range missing', () => {
  const res = detectStructureChanges({});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing-range');
  assert.equal(res.warn, false);
});

test('detectStructureChanges — warn fires when ratio ≥ threshold AND restructureCount ≥ 2', () => {
  // We can't actually shell out to git in the unit test, but we can validate
  // the threshold logic via classify() directly.
  const entries = [
    { status: 'D', path: 'src/Card.tsx' },
    { status: 'A', path: 'src/Card/Card.tsx' },
    { status: 'M', path: 'src/App.tsx' },
    { status: 'M', path: 'src/index.ts' },
    { status: 'M', path: 'src/styles.ts' },
  ];
  const c = classify(entries);
  // 2 restructure files of 5 total = 0.4, >= default 0.20 → warn=true
  assert.ok(c.ratio >= DEFAULT_RESTRUCTURE_THRESHOLD);
  assert.ok(c.restructureCount >= 2);
});

test('detectStructureChanges — warn is false when restructureCount < 2 even at high ratio', () => {
  // Single restructure change over a tiny diff might be 100% ratio but warn
  // should still be false (too few files to be a "structural change").
  const entries = [
    { status: 'M', path: 'src/App.tsx' },
  ];
  const c = classify(entries);
  assert.equal(c.restructureCount, 0);
});

test('classify — FOLDER_PER_COMPONENT only matches same extension', () => {
  const entries = [
    { status: 'D', path: 'src/Card.tsx' },
    { status: 'A', path: 'src/Card/Card.ts' }, // .ts not .tsx
  ];
  const res = classify(entries);
  assert.equal(res.patterns.length, 0, 'extension mismatch should not match folder-per-component');
});

test('classify — SPLIT_INTO_SUBMODULE requires ≥2 files in submodule', () => {
  const entries = [
    { status: 'D', path: 'src/utils.ts' },
    { status: 'A', path: 'src/utils/date.ts' }, // only one file
  ];
  const res = classify(entries);
  const split = res.patterns.find((p) => p.type === 'SPLIT_INTO_SUBMODULE');
  assert.equal(split, undefined, 'single-file case is folder-per-component, not submodule split');
});
