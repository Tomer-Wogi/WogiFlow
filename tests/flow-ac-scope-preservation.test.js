#!/usr/bin/env node

/**
 * Tests for AC Scope-Preservation Checklist.
 * Story: wf-fe8ef64d (B1)
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  snapshotCriteria,
  loadSnapshot,
  verifyScopePreservation,
  formatChecklist,
  SNAPSHOT_DIR,
} = require('../scripts/flow-ac-scope-preservation');

const TEST_TASK_IDS = ['wf-aaaa0001', 'wf-aaaa0002', 'wf-aaaa0003'];

afterEach(() => {
  for (const id of TEST_TASK_IDS) {
    const p = path.join(SNAPSHOT_DIR, `${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('snapshotCriteria rejects empty criteria', () => {
  const r = snapshotCriteria('wf-aaaa0001', []);
  assert.equal(r.ok, false);
});

test('snapshotCriteria rejects invalid taskId', () => {
  assert.throws(() => snapshotCriteria('not-a-task', ['c1']), /invalid taskId/);
});

test('snapshotCriteria writes a well-formed snapshot', () => {
  const r = snapshotCriteria('wf-aaaa0001', ['User can log in', 'User can log out']);
  assert.equal(r.ok, true);
  const loaded = loadSnapshot('wf-aaaa0001');
  assert.equal(loaded.taskId, 'wf-aaaa0001');
  assert.equal(loaded.criteria.length, 2);
  assert.equal(loaded.criteria[0].id, 'ac-1');
  assert.equal(loaded.criteria[0].text, 'User can log in');
});

test('snapshotCriteria is idempotent for identical content', () => {
  snapshotCriteria('wf-aaaa0002', ['a', 'b']);
  const r2 = snapshotCriteria('wf-aaaa0002', ['a', 'b']);
  assert.equal(r2.skipped, true);
});

test('verifyScopePreservation flags dropped or collapsed criteria', () => {
  snapshotCriteria('wf-aaaa0001', [
    'User can upload a profile photo',
    'User can delete a profile photo',
    'Profile photo is resized to 200x200',
  ]);
  const r = verifyScopePreservation('wf-aaaa0001', [
    'User can upload a profile photo',
    'Profile photo is resized to 200x200',
  ]);
  assert.equal(r.ok, false);
  // "delete" is either dropped (no tokens match) or collapsed into "upload" (merge).
  // Either way, scope preservation is BLOCKED — the user lost an intent.
  const lostCount = r.dropped.length + r.modified.filter((m) => m.id === 'ac-2').length;
  assert.ok(lostCount >= 1, 'ac-2 (delete) must surface as dropped OR modified');
});

test('verifyScopePreservation detects 2-into-1 collapse as not-ok', () => {
  snapshotCriteria('wf-aaaa0002', [
    'Users can upload widgets to the storage bucket',
    'Users can delete widgets from the storage bucket',
  ]);
  const r = verifyScopePreservation('wf-aaaa0002', [
    'Users can upload widgets to the storage bucket',
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.collapseDetected, true);
});

test('verifyScopePreservation marks well-preserved criteria as preserved', () => {
  snapshotCriteria('wf-aaaa0001', [
    'User can upload a profile photo',
  ]);
  const r = verifyScopePreservation('wf-aaaa0001', [
    'User can upload a profile photo',
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.preserved.length, 1);
  assert.equal(r.dropped.length, 0);
});

test('verifyScopePreservation detects added criteria', () => {
  snapshotCriteria('wf-aaaa0001', ['Original criterion about uploading photos']);
  const r = verifyScopePreservation('wf-aaaa0001', [
    'Original criterion about uploading photos',
    'New criterion about deleting videos',
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.added.length, 1);
  assert.match(r.added[0].text, /deleting videos/);
});

test('verifyScopePreservation fails when no snapshot exists', () => {
  const r = verifyScopePreservation('wf-aaaa0003', ['anything']);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no snapshot/);
});

test('formatChecklist renders a complete report', () => {
  snapshotCriteria('wf-aaaa0001', [
    'Users can upload profile photos to cloud storage',
    'Administrators can schedule automated backup jobs',
  ]);
  const r = verifyScopePreservation('wf-aaaa0001', [
    'Users can upload profile photos to cloud storage',
  ]);
  const s = formatChecklist(r, 'wf-aaaa0001');
  assert.match(s, /AC Scope-Preservation Checklist/);
  assert.match(s, /BLOCKED/);
  assert.match(s, /DROPPED/);
});
