'use strict';

/**
 * Tests for flow-promote.js (wf-6a352aae).
 *
 * Covers: getPromotionConfig defaults, normalizePrincipleId, normalizeIssueKey,
 * groupAdversaryFindings (FAIL/CONCERN only, dedupes by taskId+round),
 * threshold detection, pattern-phrase one-shot via lastPromotedAt, pending
 * promotions queue I/O, scanForPromotions on synthetic data.
 *
 * Run: NODE_ENV=test node --test tests/flow-promote.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const _os = require('node:os');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const promote = require('../scripts/flow-promote');
const { PATHS } = require('../scripts/flow-utils');

// We seed adversary-runs and correction-patterns into the real .workflow/state/
// directories under unique sub-dirs to avoid collision with live data.
const TEST_SUFFIX = `_test_${process.pid}_${Date.now()}`;
const _TEST_RUN_DIR = path.join(PATHS.state, 'adversary-runs', TEST_SUFFIX);
const PATTERNS_FILE = path.join(PATHS.state, 'correction-patterns.json');
const PENDING_FILE = path.join(PATHS.state, 'pending-promotions.json');

function writeRun(name, payload) {
  // We write into the main adversary-runs dir so loadAdversaryRuns picks them up.
  const full = path.join(PATHS.state, 'adversary-runs', name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function clearTestRuns(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (_err) {}
  }
}

function clearPatterns() {
  try { fs.unlinkSync(PATTERNS_FILE); } catch (_err) {}
}

function clearPending() {
  try { fs.unlinkSync(PENDING_FILE); } catch (_err) {}
}

describe('getPromotionConfig — defaults', () => {
  it('returns sane defaults', () => {
    const cfg = promote.getPromotionConfig();
    assert.equal(typeof cfg.autoAtSessionEnd, 'boolean');
    assert.equal(typeof cfg.adversaryPromotionThreshold, 'number');
    assert.equal(typeof cfg.patternToFeedbackThreshold, 'number');
    assert.ok(cfg.adversaryPromotionThreshold >= 1);
    assert.ok(cfg.patternToFeedbackThreshold >= 1);
  });

  it('exposes PROMOTION_DEFAULTS as a frozen object', () => {
    assert.equal(typeof promote.PROMOTION_DEFAULTS, 'object');
    assert.equal(Object.isFrozen(promote.PROMOTION_DEFAULTS), true);
    assert.equal(promote.PROMOTION_DEFAULTS.adversaryPromotionThreshold, 2);
    assert.equal(promote.PROMOTION_DEFAULTS.patternToFeedbackThreshold, 3);
  });
});

describe('normalizePrincipleId', () => {
  it('lowercases and adds p prefix to bare numbers', () => {
    assert.equal(promote.normalizePrincipleId('P11.2'), 'p11.2');
    assert.equal(promote.normalizePrincipleId('11.2'), 'p11.2');
    assert.equal(promote.normalizePrincipleId(2), 'p2');
    assert.equal(promote.normalizePrincipleId('P3'), 'p3');
  });

  it('returns empty for null / undefined / empty', () => {
    assert.equal(promote.normalizePrincipleId(null), '');
    assert.equal(promote.normalizePrincipleId(undefined), '');
    assert.equal(promote.normalizePrincipleId(''), '');
  });
});

describe('normalizeIssueKey', () => {
  it('lowercases and collapses whitespace', () => {
    assert.equal(promote.normalizeIssueKey('  Foo   BAR  baz  '), 'foo bar baz');
  });

  it('strips trailing punctuation', () => {
    assert.equal(promote.normalizeIssueKey('Issue text.'), 'issue text');
    assert.equal(promote.normalizeIssueKey('Issue!'), 'issue');
  });

  it('truncates to 80 chars', () => {
    const long = 'x'.repeat(200);
    assert.equal(promote.normalizeIssueKey(long).length, 80);
  });
});

describe('groupAdversaryFindings — counting', () => {
  it('groups identical findings across different runs', () => {
    const runs = [
      { taskId: 'wf-task1', round: 1, principles: [{ id: 'P11.2', verdict: 'CONCERN', issue: 'config not in known_keys' }] },
      { taskId: 'wf-task2', round: 1, principles: [{ id: 'P11.2', verdict: 'CONCERN', issue: 'config not in known_keys' }] },
    ];
    const groups = promote.groupAdversaryFindings(runs);
    assert.equal(groups.size, 1);
    const g = [...groups.values()][0];
    assert.equal(g.hits.size, 2);
    assert.equal(g.principleId, 'p11.2');
  });

  it('ignores PASS/SKIP verdicts (only counts FAIL/CONCERN)', () => {
    const runs = [
      { taskId: 'wf-task1', round: 1, principles: [
        { id: 'P3', verdict: 'PASS', issue: 'fine' },
        { id: 'P5', verdict: 'SKIP', issue: 'skipped' },
        { id: 'P8', verdict: 'CONCERN', issue: 'real concern' },
      ]},
    ];
    const groups = promote.groupAdversaryFindings(runs);
    assert.equal(groups.size, 1);
    assert.equal([...groups.values()][0].principleId, 'p8');
  });

  it('does not double-count the same task+round', () => {
    const runs = [
      { taskId: 'wf-task1', round: 1, principles: [{ id: 'P11.2', verdict: 'FAIL', issue: 'same' }] },
      { taskId: 'wf-task1', round: 1, principles: [{ id: 'P11.2', verdict: 'FAIL', issue: 'same' }] },
    ];
    const groups = promote.groupAdversaryFindings(runs);
    assert.equal([...groups.values()][0].hits.size, 1);
  });

  it('groups normalize variant principle id formats together', () => {
    const runs = [
      { taskId: 'wf-task1', round: 1, principles: [{ id: 'P11.2', verdict: 'FAIL', issue: 'same issue' }] },
      { taskId: 'wf-task2', round: 1, principles: [{ id: '11.2', verdict: 'FAIL', issue: 'same issue' }] },
    ];
    const groups = promote.groupAdversaryFindings(runs);
    assert.equal(groups.size, 1);
    assert.equal([...groups.values()][0].hits.size, 2);
  });
});

describe('findAdversaryPromotions — threshold gate', () => {
  let testFiles = [];

  beforeEach(() => {
    testFiles = [];
    clearPending();
  });

  afterEach(() => {
    clearTestRuns(testFiles);
    clearPending();
  });

  it('promotes a finding that hits N=2 threshold', () => {
    testFiles.push(writeRun(`${TEST_SUFFIX}-r1-task1.json`, {
      taskId: 'wf-test-task1', round: 1,
      principles: [{ id: 'P11.2', verdict: 'CONCERN', issue: 'unique-test-issue-aaa' }],
    }));
    testFiles.push(writeRun(`${TEST_SUFFIX}-r1-task2.json`, {
      taskId: 'wf-test-task2', round: 1,
      principles: [{ id: 'P11.2', verdict: 'CONCERN', issue: 'unique-test-issue-aaa' }],
    }));
    const promotions = promote.findAdversaryPromotions(2);
    const ours = promotions.filter(p => p.key.includes('unique-test-issue-aaa'));
    assert.equal(ours.length, 1);
    assert.equal(ours[0].count, 2);
    assert.equal(ours[0].kind, 'adversary');
    assert.equal(ours[0].feedbackEntry.source, 'adversary-finding');
  });

  it('does NOT promote a single-occurrence finding', () => {
    testFiles.push(writeRun(`${TEST_SUFFIX}-single.json`, {
      taskId: 'wf-test-single', round: 1,
      principles: [{ id: 'P5', verdict: 'FAIL', issue: 'unique-test-issue-bbb' }],
    }));
    const promotions = promote.findAdversaryPromotions(2);
    const ours = promotions.filter(p => p.key.includes('unique-test-issue-bbb'));
    assert.equal(ours.length, 0);
  });
});

describe('findPatternPhrasePromotions — one-shot via lastPromotedAt', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('promotes a phrase that meets confirmedHits >= threshold', () => {
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify([
      { phrase: 'unique-promote-test-phrase', confirmedHits: 5, hits: 0, falsePositives: 0 },
    ]));
    const promotions = promote.findPatternPhrasePromotions(3);
    const ours = promotions.filter(p => p.key.includes('unique-promote-test-phrase'));
    assert.equal(ours.length, 1);
    assert.equal(ours[0].count, 5);
    assert.equal(ours[0].kind, 'pattern-phrase');
  });

  it('skips phrases with lastPromotedAt set', () => {
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify([
      { phrase: 'already-promoted-xyz', confirmedHits: 10, lastPromotedAt: '2026-04-15T00:00:00Z' },
    ]));
    const promotions = promote.findPatternPhrasePromotions(3);
    assert.equal(promotions.filter(p => p.key.includes('already-promoted-xyz')).length, 0);
  });

  it('skips phrases below threshold', () => {
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify([
      { phrase: 'too-few-hits-zzz', confirmedHits: 2 },
    ]));
    const promotions = promote.findPatternPhrasePromotions(3);
    assert.equal(promotions.filter(p => p.key.includes('too-few-hits-zzz')).length, 0);
  });

  it('returns [] when correction-patterns.json is absent', () => {
    clearPatterns();
    const promotions = promote.findPatternPhrasePromotions(3);
    assert.equal(promotions.length, 0);
  });
});

describe('pending-promotions queue', () => {
  beforeEach(() => clearPending());
  afterEach(() => clearPending());

  it('returns null when file is absent', () => {
    assert.equal(promote.loadPendingPromotions(), null);
  });

  it('writePendingPromotions persists; loadPendingPromotions reads', async () => {
    const r = await promote.writePendingPromotions({
      adversary: [{ kind: 'adversary', key: 'k1', count: 2, feedbackEntry: { date: '2026-04-15', pattern: 'x', source: 'adversary-finding', count: 2, confidence: 80, status: 'Monitor' } }],
      patternPhrase: [],
    });
    assert.equal(r.written, true);
    assert.equal(r.count, 1);
    const loaded = promote.loadPendingPromotions();
    assert.ok(loaded);
    assert.equal(loaded.promotions.length, 1);
  });

  it('clears pending file when scan finds no promotions', async () => {
    fs.writeFileSync(PENDING_FILE, JSON.stringify({ proposedAt: 'old', promotions: [{ kind: 'x' }] }));
    const r = await promote.writePendingPromotions({ adversary: [], patternPhrase: [] });
    assert.equal(r.written, false);
    assert.equal(promote.loadPendingPromotions(), null);
  });
});

describe('scanForPromotions — integration', () => {
  let testFiles = [];

  beforeEach(() => {
    testFiles = [];
    clearPatterns();
    clearPending();
  });

  afterEach(() => {
    clearTestRuns(testFiles);
    clearPatterns();
    clearPending();
  });

  it('returns both adversary and pattern-phrase promotions when both meet thresholds', () => {
    testFiles.push(writeRun(`${TEST_SUFFIX}-mix-1.json`, {
      taskId: 'wf-mix-1', round: 1,
      principles: [{ id: 'P7', verdict: 'CONCERN', issue: 'unique-mix-finding-ccc' }],
    }));
    testFiles.push(writeRun(`${TEST_SUFFIX}-mix-2.json`, {
      taskId: 'wf-mix-2', round: 1,
      principles: [{ id: 'P7', verdict: 'CONCERN', issue: 'unique-mix-finding-ccc' }],
    }));
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify([
      { phrase: 'mix-test-phrase-ddd', confirmedHits: 4 },
    ]));
    const scan = promote.scanForPromotions({ adversaryPromotionThreshold: 2, patternToFeedbackThreshold: 3 });
    const adv = scan.adversary.filter(p => p.key.includes('unique-mix-finding-ccc'));
    const pat = scan.patternPhrase.filter(p => p.key.includes('mix-test-phrase-ddd'));
    assert.equal(adv.length, 1);
    assert.equal(pat.length, 1);
  });
});
