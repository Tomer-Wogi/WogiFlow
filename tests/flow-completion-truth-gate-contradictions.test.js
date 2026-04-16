'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scanForClaimContradictions, DISAGREEMENT_WORDS } = require('../scripts/flow-completion-truth-gate');

test('scanForClaimContradictions — returns scanned:false for non-task input', () => {
  assert.deepEqual(scanForClaimContradictions(null), { contradictions: [], scanned: false, reason: 'not-a-task-object' });
  assert.deepEqual(scanForClaimContradictions('x'), { contradictions: [], scanned: false, reason: 'not-a-task-object' });
  assert.deepEqual(scanForClaimContradictions([]), { contradictions: [], scanned: false, reason: 'not-a-task-object' });
});

test('scanForClaimContradictions — Class A: done-word in notes with partial status', () => {
  const task = {
    id: 'wf-aaa',
    status: 'completed-partial',
    notes: 'shipped end-to-end after review.',
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.scanned, true);
  assert.equal(res.contradictions.length, 1);
  assert.equal(res.contradictions[0].class, 'A');
  assert.equal(res.contradictions[0].field, 'notes');
  assert.ok(/completed-partial/i.test(res.contradictions[0].structuralEvidence));
});

test('scanForClaimContradictions — Class A: multiple free-text fields flagged independently', () => {
  const task = {
    id: 'wf-bbb',
    status: 'blocked',
    result: 'Done. All criteria met.',
    summary: 'Shipped yesterday.',
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 2);
  const fields = res.contradictions.map((c) => c.field).sort();
  assert.deepEqual(fields, ['result', 'summary']);
});

test('scanForClaimContradictions — Class A: no contradiction when status is completed', () => {
  const task = {
    id: 'wf-ccc',
    status: 'completed',
    notes: 'shipped end-to-end.',
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 0);
});

test('scanForClaimContradictions — Class B: "0 outages" with hotfixes entries', () => {
  const task = {
    id: 'wf-ddd',
    status: 'completed',
    result: 'No major issues encountered. 0 outages during rollout.',
    hotfixes: [{ sha: 'abc123', note: 'fix 400s on whitelist' }],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.scanned, true);
  assert.equal(res.contradictions.length, 1);
  assert.equal(res.contradictions[0].class, 'B');
  assert.ok(res.contradictions[0].structuralEvidence.includes('hotfixes'));
});

test('scanForClaimContradictions — Class B: childTasks[].hotfixes detected', () => {
  const task = {
    id: 'wf-eee',
    status: 'completed',
    result: 'Shipped cleanly — zero regressions.',
    childTasks: [
      { id: 'wf-fff', hotfixes: ['abc', 'def'] },
    ],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 1);
  assert.equal(res.contradictions[0].class, 'B');
  assert.ok(res.contradictions[0].structuralEvidence.includes('childTasks'));
});

test('scanForClaimContradictions — Class B: bare "outage" without negation does NOT fire', () => {
  const task = {
    id: 'wf-ggg',
    status: 'completed',
    result: 'Handled one outage gracefully; rolled forward.',
    hotfixes: ['abc'],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 0, 'positive description should not be flagged');
});

test('scanForClaimContradictions — Class B: "incidentally" is not a false match', () => {
  const task = {
    id: 'wf-hhh',
    status: 'completed',
    notes: 'We incidentally improved coverage. No issues.',
    hotfixes: ['abc'],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 0);
});

test('scanForClaimContradictions — Class A+B: both classes can co-occur', () => {
  const task = {
    id: 'wf-iii',
    status: 'completed-partial',
    result: 'Shipped end-to-end with 0 outages.',
    hotfixes: ['abc'],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 2);
  const classes = res.contradictions.map((c) => c.class).sort();
  assert.deepEqual(classes, ['A', 'B']);
});

test('scanForClaimContradictions — array text fields are flattened', () => {
  const task = {
    id: 'wf-jjj',
    status: 'completed-partial',
    notes: ['Phase 1 landed.', 'Shipped end-to-end.'],
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 1);
});

test('scanForClaimContradictions — snippet includes context around the hit', () => {
  const task = {
    id: 'wf-kkk',
    status: 'blocked',
    result: 'After extensive review we finally shipped the migration safely.',
  };
  const res = scanForClaimContradictions(task);
  assert.equal(res.contradictions.length, 1);
  const snip = res.contradictions[0].snippet;
  assert.ok(/shipped/i.test(snip), `snippet should contain the hit: ${snip}`);
});

test('DISAGREEMENT_WORDS is exported and covers documented categories', () => {
  assert.ok(Array.isArray(DISAGREEMENT_WORDS));
  for (const w of ['outage', 'incident', 'regression', 'rollback', 'revert', 'hotfix']) {
    assert.ok(DISAGREEMENT_WORDS.includes(w), `missing: ${w}`);
  }
});
