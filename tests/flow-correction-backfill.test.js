'use strict';

/**
 * Tests for backfillPendingCorrections (wf-6c58953a Fix B).
 *
 * Uses tmpdir-based test fixtures to avoid touching real project state.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { backfillPendingCorrections } = require('../scripts/flow-correction-backfill');

function makeTmpProject(records) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-backfill-test-'));
  fs.mkdirSync(path.join(tmpDir, '.workflow', 'state'), { recursive: true });
  if (records !== null) {
    fs.writeFileSync(
      path.join(tmpDir, '.workflow', 'state', 'pending-corrections.json'),
      JSON.stringify(records, null, 2)
    );
  }
  return tmpDir;
}

function cleanupTmp(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('backfillPendingCorrections — populates null whatWasWrong from userMessage', () => {
  const tmpDir = makeTmpProject([
    {
      id: 'CORR-test1',
      userMessage: "Don't do it. Stop assuming.",
      whatWasWrong: null,
      whatUserWants: null,
      method: 'regex-hook'
    }
  ]);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 1);
    assert.equal(result.backfilled, 1);
    assert.equal(result.written, true);

    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workflow/state/pending-corrections.json'), 'utf-8'));
    assert.equal(updated[0].whatWasWrong, "Don't do it. Stop assuming.");
    assert.match(updated[0].enrichmentSource, /^backfill-\d{4}-\d{2}-\d{2}$/);
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — leaves already-populated records untouched', () => {
  const tmpDir = makeTmpProject([
    {
      id: 'CORR-already-fixed',
      userMessage: 'something',
      whatWasWrong: 'AI did something wrong',
      whatUserWants: 'be better',
      method: 'ai'
    }
  ]);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 1);
    assert.equal(result.backfilled, 0);
    assert.equal(result.alreadyPopulated, 1);
    // No write needed
    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workflow/state/pending-corrections.json'), 'utf-8'));
    assert.equal(updated[0].whatWasWrong, 'AI did something wrong');
    assert.equal(updated[0].enrichmentSource, undefined); // never touched
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — mixed records: backfills nulls, leaves populated', () => {
  const tmpDir = makeTmpProject([
    { id: 'a', userMessage: 'first frustration', whatWasWrong: null, whatUserWants: null },
    { id: 'b', userMessage: 'unrelated', whatWasWrong: 'already extracted', whatUserWants: null },
    { id: 'c', userMessage: 'third frustration', whatWasWrong: null, whatUserWants: null }
  ]);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 3);
    assert.equal(result.backfilled, 2); // a + c
    assert.equal(result.alreadyPopulated, 1); // b

    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workflow/state/pending-corrections.json'), 'utf-8'));
    assert.equal(updated[0].whatWasWrong, 'first frustration');
    assert.equal(updated[1].whatWasWrong, 'already extracted'); // unchanged
    assert.equal(updated[1].enrichmentSource, undefined); // unchanged
    assert.equal(updated[2].whatWasWrong, 'third frustration');
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — dry-run does not write', () => {
  const tmpDir = makeTmpProject([
    { id: 'a', userMessage: 'frustration', whatWasWrong: null, whatUserWants: null }
  ]);
  try {
    const result = backfillPendingCorrections(tmpDir, { dryRun: true });
    assert.equal(result.backfilled, 1);
    assert.equal(result.written, false);
    assert.equal(result.dryRun, true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workflow/state/pending-corrections.json'), 'utf-8'));
    assert.equal(onDisk[0].whatWasWrong, null); // file unchanged
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — missing pending-corrections.json: graceful', () => {
  const tmpDir = makeTmpProject(null);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 0);
    assert.equal(result.backfilled, 0);
    assert.equal(result.written, false);
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — empty array: no-op', () => {
  const tmpDir = makeTmpProject([]);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 0);
    assert.equal(result.backfilled, 0);
    assert.equal(result.written, false);
  } finally {
    cleanupTmp(tmpDir);
  }
});

test('backfillPendingCorrections — record with empty userMessage: skipped (no signal)', () => {
  const tmpDir = makeTmpProject([
    { id: 'a', userMessage: '', whatWasWrong: null, whatUserWants: null },
    { id: 'b', userMessage: '   ', whatWasWrong: null, whatUserWants: null }
  ]);
  try {
    const result = backfillPendingCorrections(tmpDir);
    assert.equal(result.found, 2);
    assert.equal(result.backfilled, 0); // both skipped
  } finally {
    cleanupTmp(tmpDir);
  }
});
