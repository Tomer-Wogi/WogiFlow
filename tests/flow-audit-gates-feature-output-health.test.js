'use strict';

/**
 * Tests for checkFeatureOutputHealth (wf-6c58953a Fix C).
 *
 * The audit dimension that catches "silent feature no-op" bugs.
 * Uses tmpdir fixtures to simulate broken / clean projects.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { checkFeatureOutputHealth } = require('../scripts/flow-audit-gates');

function makeTmpProject({ pendingCorrections, promptHistory, corrections } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-output-health-'));
  fs.mkdirSync(path.join(tmpDir, '.workflow', 'state'), { recursive: true });
  if (pendingCorrections !== undefined) {
    fs.writeFileSync(
      path.join(tmpDir, '.workflow', 'state', 'pending-corrections.json'),
      JSON.stringify(pendingCorrections, null, 2)
    );
  }
  if (promptHistory !== undefined) {
    fs.writeFileSync(
      path.join(tmpDir, '.workflow', 'state', 'prompt-history.json'),
      JSON.stringify(promptHistory, null, 2)
    );
  }
  if (corrections) {
    fs.mkdirSync(path.join(tmpDir, '.workflow', 'corrections'), { recursive: true });
    for (const [name, content] of Object.entries(corrections)) {
      fs.writeFileSync(path.join(tmpDir, '.workflow', 'corrections', name), content);
    }
  }
  return tmpDir;
}

function cleanupTmp(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Rule 1: pending-corrections null-fields ratio

test('checkFeatureOutputHealth — Rule 1: 100% null records → HIGH finding', () => {
  const tmpDir = makeTmpProject({
    pendingCorrections: [
      { id: 'a', userMessage: 'frustration', whatWasWrong: null, whatUserWants: null }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.passed, false);
    assert.equal(result.severity, 'high');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].rule, 'pending-corrections-null-fields');
    assert.equal(result.findings[0].severity, 'high');
    assert.match(result.findings[0].message, /1\/1 \(100%\)/);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 1: 50% null → MEDIUM', () => {
  const tmpDir = makeTmpProject({
    pendingCorrections: [
      { id: 'a', userMessage: 'first', whatWasWrong: null, whatUserWants: null },
      { id: 'b', userMessage: 'second', whatWasWrong: 'extracted', whatUserWants: 'wanted' }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.findings[0].severity, 'medium');
    assert.match(result.findings[0].message, /1\/2 \(50%\)/);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 1: <50% null → no finding', () => {
  const tmpDir = makeTmpProject({
    pendingCorrections: [
      { id: 'a', whatWasWrong: 'a', whatUserWants: 'aa', userMessage: 'x' },
      { id: 'b', whatWasWrong: 'b', whatUserWants: 'bb', userMessage: 'y' },
      { id: 'c', whatWasWrong: 'c', whatUserWants: 'cc', userMessage: 'z' },
      { id: 'd', whatWasWrong: null, whatUserWants: null, userMessage: 'w' }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    const rule1 = result.findings.find(f => f.rule === 'pending-corrections-null-fields');
    assert.equal(rule1, undefined);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 1: empty array → no finding', () => {
  const tmpDir = makeTmpProject({ pendingCorrections: [] });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.passed, true);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 1: missing file → no finding', () => {
  const tmpDir = makeTmpProject({});
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.passed, true);
    assert.equal(result.findings.length, 0);
  } finally { cleanupTmp(tmpDir); }
});

// Rule 2: prompt-history × corrections cross-reference

test('checkFeatureOutputHealth — Rule 2: 3+ frustration + empty corrections/ → HIGH', () => {
  const tmpDir = makeTmpProject({
    promptHistory: [
      { prompt: "don't do that please" },
      { prompt: 'why did you change my code' },
      { prompt: 'stop assuming, you keep getting this wrong' },
      { prompt: 'simple question' }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    const rule2 = result.findings.find(f => f.rule === 'prompt-history-vs-corrections-mismatch');
    assert.equal(rule2 != null, true);
    assert.equal(rule2.severity, 'high');
    assert.match(rule2.message, /3 frustration markers/);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 2: corrections/ has files → no finding', () => {
  const tmpDir = makeTmpProject({
    promptHistory: [
      { prompt: "don't do that" },
      { prompt: 'why did you' },
      { prompt: 'stop' }
    ],
    corrections: { 'CORR-001.md': '# Correction 1' }
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    const rule2 = result.findings.find(f => f.rule === 'prompt-history-vs-corrections-mismatch');
    assert.equal(rule2, undefined);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — Rule 2: <3 frustration → no finding', () => {
  const tmpDir = makeTmpProject({
    promptHistory: [
      { prompt: "don't do that" },
      { prompt: 'how are you' }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    const rule2 = result.findings.find(f => f.rule === 'prompt-history-vs-corrections-mismatch');
    assert.equal(rule2, undefined);
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — both rules fire together', () => {
  const tmpDir = makeTmpProject({
    pendingCorrections: [
      { id: 'a', userMessage: 'x', whatWasWrong: null, whatUserWants: null }
    ],
    promptHistory: [
      { prompt: "don't" }, { prompt: 'why did' }, { prompt: 'stop' }
    ]
  });
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.findings.length, 2);
    assert.equal(result.severity, 'high');
  } finally { cleanupTmp(tmpDir); }
});

test('checkFeatureOutputHealth — clean project: passed=true', () => {
  const tmpDir = makeTmpProject({});
  try {
    const result = checkFeatureOutputHealth(tmpDir);
    assert.equal(result.gate, 'feature-output-health');
    assert.equal(result.passed, true);
    assert.equal(result.severity, 'pass');
    assert.equal(result.findings.length, 0);
  } finally { cleanupTmp(tmpDir); }
});
