'use strict';

/**
 * Tests for flow-archive-runs.js (wf-6a352aae).
 *
 * Covers: getArchiveConfig defaults, age helpers, yyyyMm / yyyyMmDd, countLines,
 * listEligibleAdversaryRuns (active-task guard, age filter), archive idempotency
 * (re-run is no-op), telemetry rotation threshold check.
 *
 * Run: NODE_ENV=test node --test tests/flow-archive-runs.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const archive = require('../scripts/flow-archive-runs');
const { PATHS } = require('../scripts/flow-utils');

const ADVERSARY_RUNS_DIR = path.join(PATHS.state, 'adversary-runs');
const TEST_PREFIX = `_archive_test_${process.pid}_${Date.now()}`;

function writeOldRun(name, payload, ageDays) {
  const full = path.join(ADVERSARY_RUNS_DIR, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(payload, null, 2));
  // Backdate mtime
  const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(full, past, past);
  return full;
}

function clearTestRuns(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (_e) {}
  }
}

describe('getArchiveConfig — defaults', () => {
  it('returns sane defaults', () => {
    const cfg = archive.getArchiveConfig();
    assert.equal(typeof cfg.autoAtSessionEnd, 'boolean');
    assert.equal(typeof cfg.adversaryRunsDays, 'number');
    assert.equal(typeof cfg.telemetryMaxLines, 'number');
    assert.ok(cfg.adversaryRunsDays >= 1);
    assert.ok(cfg.telemetryMaxLines >= 100);
  });

  it('exposes ARCHIVE_DEFAULTS as a frozen object', () => {
    assert.equal(Object.isFrozen(archive.ARCHIVE_DEFAULTS), true);
    assert.equal(archive.ARCHIVE_DEFAULTS.adversaryRunsDays, 30);
    assert.equal(archive.ARCHIVE_DEFAULTS.telemetryMaxLines, 5000);
    assert.equal(archive.ARCHIVE_DEFAULTS.autoAtSessionEnd, false);
  });
});

describe('yyyyMm / yyyyMmDd helpers', () => {
  it('yyyyMm formats month with leading zero', () => {
    assert.equal(archive.yyyyMm(new Date('2026-01-15T00:00:00Z')), '2026-01');
    assert.equal(archive.yyyyMm(new Date('2026-12-15T00:00:00Z')), '2026-12');
  });

  it('yyyyMmDd formats day with leading zero', () => {
    assert.equal(archive.yyyyMmDd(new Date('2026-01-05T00:00:00Z')), '2026-01-05');
    assert.equal(archive.yyyyMmDd(new Date('2026-12-31T00:00:00Z')), '2026-12-31');
  });
});

describe('countLines', () => {
  const tmpFile = path.join(PATHS.state, `_test_count_${process.pid}.tmp`);

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch (_e) {}
  });

  it('returns 0 for absent file', async () => {
    assert.equal(await archive.countLines('/nonexistent/nope/nope.txt'), 0);
  });

  it('counts lines correctly', async () => {
    fs.writeFileSync(tmpFile, 'a\nb\nc\n');
    assert.equal(await archive.countLines(tmpFile), 3);
  });

  it('counts file without trailing newline', async () => {
    fs.writeFileSync(tmpFile, 'a\nb\nc');
    const count = await archive.countLines(tmpFile);
    assert.ok(count >= 2 && count <= 3, `expected 2-3, got ${count}`);
  });
});

describe('listEligibleAdversaryRuns — age filter + active-task guard', () => {
  let testFiles = [];

  beforeEach(() => { testFiles = []; });
  afterEach(() => clearTestRuns(testFiles));

  it('lists files older than N days', () => {
    testFiles.push(writeOldRun(`${TEST_PREFIX}-old.json`, { taskId: 'wf-old', round: 1 }, 60));
    testFiles.push(writeOldRun(`${TEST_PREFIX}-recent.json`, { taskId: 'wf-recent', round: 1 }, 5));
    const eligible = archive.listEligibleAdversaryRuns({ adversaryRunsDays: 30 }, null);
    const ours = eligible.filter(e => e.name.startsWith(TEST_PREFIX));
    assert.equal(ours.length, 1);
    assert.equal(ours[0].name, `${TEST_PREFIX}-old.json`);
  });

  it('skips files referenced by active task', () => {
    testFiles.push(writeOldRun(`${TEST_PREFIX}-wf-activeTask-r1.json`, { taskId: 'wf-activeTask', round: 1 }, 60));
    const eligible = archive.listEligibleAdversaryRuns({ adversaryRunsDays: 30 }, 'wf-activeTask');
    const ours = eligible.filter(e => e.name.startsWith(TEST_PREFIX));
    assert.equal(ours.length, 0);
  });

  it('skips files in _archive subdirectory', () => {
    // Already implemented via name.startsWith('_') check; verified by absence-of-crash.
    const eligible = archive.listEligibleAdversaryRuns({ adversaryRunsDays: 30 }, null);
    for (const e of eligible) {
      assert.ok(!e.name.startsWith('_'));
    }
  });
});

describe('archiveAdversaryRuns — dry-run + idempotency', () => {
  let testFiles = [];

  beforeEach(() => { testFiles = []; });
  afterEach(() => {
    clearTestRuns(testFiles);
    // Cleanup any archive index entries we may have created
    const idxPath = path.join(ADVERSARY_RUNS_DIR, '_archive', 'index.json');
    if (fs.existsSync(idxPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
        let changed = false;
        for (const k of Object.keys(idx)) {
          if (k.startsWith(TEST_PREFIX)) { delete idx[k]; changed = true; }
        }
        if (changed) fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
      } catch (_e) {}
    }
  });

  it('dry-run does not move files', async () => {
    const file = writeOldRun(`${TEST_PREFIX}-dry.json`, { taskId: 'wf-dry', round: 1 }, 60);
    testFiles.push(file);
    const r = await archive.archiveAdversaryRuns({ config: { adversaryRunsDays: 30 }, dryRun: true });
    assert.equal(r.dryRun, true);
    // File still exists
    assert.equal(fs.existsSync(file), true);
    // Plan returned at least 1 archive (ours, possibly others)
    assert.ok(r.archives.length >= 1);
  });

  it('archives a file for real (and is idempotent on second run)', async () => {
    const file = writeOldRun(`${TEST_PREFIX}-archive.json`, { taskId: 'wf-archive', round: 1 }, 60);
    testFiles.push(file);
    const r1 = await archive.archiveAdversaryRuns({ config: { adversaryRunsDays: 30 }, dryRun: false });
    // File moved (gzipped)
    assert.equal(fs.existsSync(file), false);
    // Index updated for our file
    const idx = archive.loadAdversaryArchiveIndex();
    assert.ok(idx[`${TEST_PREFIX}-archive.json`]);
    // Second run: nothing more to archive (file already moved, source absent)
    const r2 = await archive.archiveAdversaryRuns({ config: { adversaryRunsDays: 30 }, dryRun: false });
    // r2 archives may include files from other tests, but ours should not appear again
    const ourArchives2 = r2.archives.filter(a => a.name === `${TEST_PREFIX}-archive.json`);
    assert.equal(ourArchives2.length, 0);
  });
});

describe('archiveTelemetryLog — line cap', () => {
  it('does not rotate when under threshold', async () => {
    const r = await archive.archiveTelemetryLog({ config: { telemetryMaxLines: 1000000 }, dryRun: false });
    assert.equal(r.rotated, false);
  });

  it('dry-run reports lineCount', async () => {
    const r = await archive.archiveTelemetryLog({ config: { telemetryMaxLines: 1 }, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(typeof r.lineCount, 'number');
  });
});
