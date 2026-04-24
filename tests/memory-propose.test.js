'use strict';

/**
 * Tests for lib/memory-proposal-store.js + flow-memory propose/approve/reject
 * subcommands + session-end-memory-proposals hook.
 *
 * Story: wf-4434851f — IGR artifact edit proposals.
 *
 * Covers (per spec AC #7):
 *   - propose round-trip (all 3 ops: append, replace-section, replace-all)
 *   - approve round-trip (applies the op, archives the proposal)
 *   - reject round-trip (archives without touching artifact)
 *   - section-boundary safety (3 malformed cases)
 * Plus supporting coverage:
 *   - input validation (invalid block/op, missing content, missing rationale)
 *   - session-end summarizer surfacing
 *
 * Isolation: each test uses a tmpdir project root via WOGI_PROJECT_ROOT + cache bust.
 *
 * Run: node --test tests/memory-propose.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Silence library chatter
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

// ============================================================
// Test harness — tmpdir project root with fresh module cache
// ============================================================

let TMP_ROOT;
let store;
let sessionEndHook;

function setupTmpProject() {
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-memory-propose-test-'));
  fs.mkdirSync(path.join(TMP_ROOT, '.workflow', 'state'), { recursive: true });
  process.env.WOGI_PROJECT_ROOT = TMP_ROOT;

  for (const key of Object.keys(require.cache)) {
    if (
      key.includes('flow-paths') ||
      key.includes('memory-proposal-store') ||
      key.includes('session-end-memory-proposals')
    ) {
      delete require.cache[key];
    }
  }

  store = require('../lib/memory-proposal-store');
  sessionEndHook = require('../scripts/hooks/core/session-end-memory-proposals');
}

function teardownTmpProject() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch (_err) { /* ignore */ }
  delete process.env.WOGI_PROJECT_ROOT;
}

function writeContent(name, body) {
  const p = path.join(TMP_ROOT, '.workflow', 'scratch-' + name + '.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function writeArtifact(block, body) {
  const p = store.pathFor.artifact(block);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function readArtifact(block) {
  const p = store.pathFor.artifact(block);
  return fs.readFileSync(p, 'utf-8');
}

// ============================================================
// Input validation
// ============================================================

describe('createProposal — input validation', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('rejects invalid block', () => {
    const c = writeContent('x', 'x');
    assert.throws(
      () => store.createProposal({ block: 'bogus', op: 'append', contentFile: c }),
      /invalid block/
    );
  });

  it('rejects invalid op', () => {
    const c = writeContent('x', 'x');
    assert.throws(
      () => store.createProposal({ block: 'product', op: 'zap', contentFile: c }),
      /invalid op/
    );
  });

  it('rejects missing --content', () => {
    assert.throws(
      () => store.createProposal({ block: 'product', op: 'append' }),
      /--content is required/
    );
  });

  it('rejects content file not on disk', () => {
    assert.throws(
      () => store.createProposal({
        block: 'product', op: 'append',
        contentFile: path.join(TMP_ROOT, 'does-not-exist.md'),
      }),
      /content file not found/
    );
  });

  it('rejects replace-all without rationale', () => {
    const c = writeContent('x', 'x');
    assert.throws(
      () => store.createProposal({ block: 'product', op: 'replace-all', contentFile: c }),
      /replace-all requires --rationale/
    );
  });

  it('rejects content path outside project root', () => {
    const outside = path.join(os.tmpdir(), 'outside-memory-' + Date.now() + '.md');
    fs.writeFileSync(outside, 'x', 'utf-8');
    try {
      assert.throws(
        () => store.createProposal({
          block: 'product', op: 'append', contentFile: outside,
        }),
        /escapes project root/
      );
    } finally {
      try { fs.unlinkSync(outside); } catch (_err) { /* ignore */ }
    }
  });
});

// ============================================================
// AC #1 + #7 — propose round-trip (all 3 ops)
// ============================================================

describe('AC1/7 — propose round-trip: append', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages append with metadata + content on disk', () => {
    const c = writeContent('append', '## New Concept\n\nA shiny addition.\n');
    const rec = store.createProposal({
      block: 'glossary',
      op: 'append',
      contentFile: c,
      rationale: 'define a new term surfaced this session',
    });

    assert.equal(rec.block, 'glossary');
    assert.equal(rec.op, 'append');
    assert.equal(rec.status, 'pending');
    assert.equal(rec.proposedBy, 'agent');
    assert.match(rec.id, /^mprop-[a-f0-9]{8}$/);
    assert.ok(rec.proposedAt.includes('T'));
    assert.equal(rec.rationale, 'define a new term surfaced this session');
    assert.equal(rec.section, null);

    // Staged content written
    const stagedAbs = path.resolve(TMP_ROOT, rec.contentPath);
    assert.ok(fs.existsSync(stagedAbs));
    assert.equal(fs.readFileSync(stagedAbs, 'utf-8'), '## New Concept\n\nA shiny addition.\n');

    // Record persisted + visible via listProposals
    const list = store.listProposals({ status: 'pending' });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, rec.id);
  });

  it('records proposedBy=user when specified', () => {
    const c = writeContent('u', 'x');
    const rec = store.createProposal({
      block: 'product', op: 'append', contentFile: c, proposedBy: 'user',
    });
    assert.equal(rec.proposedBy, 'user');
  });
});

describe('AC1/7 — propose round-trip: replace-section', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages replace-section when heading exists', () => {
    writeArtifact('domain-model', '# Domain Model\n\n## Roles\n\nAdmin, User.\n\n## Entities\n\nFoo, Bar.\n');
    const c = writeContent('roles', '## Roles\n\nAdmin, User, Manager.\n');
    const rec = store.createProposal({
      block: 'domain-model',
      op: 'replace-section',
      contentFile: c,
      section: 'Roles',
    });
    assert.equal(rec.op, 'replace-section');
    assert.equal(rec.section, 'Roles');
    // Artifact untouched until approval
    assert.ok(readArtifact('domain-model').includes('Admin, User.'));
    assert.ok(!readArtifact('domain-model').includes('Manager'));
  });
});

describe('AC1/7 — propose round-trip: replace-all', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages replace-all with rationale', () => {
    const c = writeContent('product', '# Product\n\nAll new content.\n');
    const rec = store.createProposal({
      block: 'product',
      op: 'replace-all',
      contentFile: c,
      rationale: 'product pivot — previous content obsolete',
    });
    assert.equal(rec.op, 'replace-all');
    assert.equal(rec.rationale, 'product pivot — previous content obsolete');
  });
});

// ============================================================
// AC #3 — section-boundary safety (malformed cases)
// ============================================================

describe('AC3/7 — section-boundary safety', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('rejects replace-section when heading does not exist', () => {
    writeArtifact('domain-model', '# Domain Model\n\n## Roles\n\nAdmin.\n');
    const c = writeContent('ghost', '## Ghost\n\nNope.\n');
    assert.throws(
      () => store.createProposal({
        block: 'domain-model', op: 'replace-section',
        contentFile: c, section: 'Ghost',
      }),
      /section validation failed.*heading not found/
    );
    // Artifact unchanged
    assert.ok(readArtifact('domain-model').includes('Admin.'));
    // No proposal staged
    assert.equal(store.listProposals({ status: 'pending' }).length, 0);
  });

  it('rejects replace-section when heading is ambiguous (duplicate)', () => {
    writeArtifact('glossary',
      '# Glossary\n\n## Term\n\nFirst.\n\n## Other\n\nx\n\n## Term\n\nSecond.\n');
    const c = writeContent('dup', '## Term\n\nReplacement.\n');
    assert.throws(
      () => store.createProposal({
        block: 'glossary', op: 'replace-section',
        contentFile: c, section: 'Term',
      }),
      /ambiguous heading/
    );
    assert.equal(store.listProposals({ status: 'pending' }).length, 0);
  });

  it('rejects replace-section when --section is missing', () => {
    writeArtifact('glossary', '# Glossary\n\n## Any\n\nx\n');
    const c = writeContent('nosec', '## Any\n\ny\n');
    assert.throws(
      () => store.createProposal({
        block: 'glossary', op: 'replace-section', contentFile: c,
      }),
      /replace-section requires --section/
    );
    assert.equal(store.listProposals({ status: 'pending' }).length, 0);
  });

  it('rejects replace-section when artifact is missing', () => {
    const c = writeContent('x', '## Heading\n\nstuff\n');
    assert.throws(
      () => store.createProposal({
        block: 'user-journeys', op: 'replace-section',
        contentFile: c, section: 'Heading',
      }),
      /artifact missing/
    );
  });
});

// ============================================================
// AC #4 — approve round-trip
// ============================================================

describe('AC4 — approve: append', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('appends to existing artifact + archives proposal', () => {
    writeArtifact('glossary', '# Glossary\n\n## Old\n\nExisting.\n');
    const c = writeContent('add', '## New Term\n\nFresh.\n');
    const rec = store.createProposal({
      block: 'glossary', op: 'append', contentFile: c,
    });
    const applied = store.approveProposal({ id: rec.id });

    assert.equal(applied.status, 'approved');
    assert.ok(applied.decidedAt);

    const body = readArtifact('glossary');
    assert.ok(body.includes('## Old'));
    assert.ok(body.includes('## New Term'));
    // Append preserves original content
    assert.ok(body.indexOf('## Old') < body.indexOf('## New Term'));

    // Proposal moved from pending/ → applied/
    assert.equal(store.listProposals({ status: 'pending' }).length, 0);
    assert.equal(store.listProposals({ status: 'approved' }).length, 1);
  });

  it('creates artifact on append when missing', () => {
    const c = writeContent('first', '## First\n\nInitial content.\n');
    const rec = store.createProposal({
      block: 'user-journeys', op: 'append', contentFile: c,
    });
    store.approveProposal({ id: rec.id });
    assert.ok(fs.existsSync(store.pathFor.artifact('user-journeys')));
    assert.ok(readArtifact('user-journeys').includes('## First'));
  });
});

describe('AC4 — approve: replace-section', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('replaces only the targeted section; preserves surrounding sections', () => {
    writeArtifact('domain-model',
      '# Domain\n\n## Roles\n\nAdmin, User.\n\n## Entities\n\nFoo, Bar.\n');
    const c = writeContent('r', '## Roles\n\nAdmin, User, Manager, Guest.\n');
    const rec = store.createProposal({
      block: 'domain-model', op: 'replace-section',
      contentFile: c, section: 'Roles',
    });
    store.approveProposal({ id: rec.id });

    const body = readArtifact('domain-model');
    assert.ok(body.includes('Admin, User, Manager, Guest.'));
    assert.ok(!body.includes('Admin, User.\n'));
    // Surrounding sections preserved
    assert.ok(body.startsWith('# Domain'));
    assert.ok(body.includes('## Entities'));
    assert.ok(body.includes('Foo, Bar.'));
  });
});

describe('AC4 — approve: replace-all', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('overwrites the artifact entirely', () => {
    writeArtifact('product', '# Product\n\nOld content.\n');
    const c = writeContent('p', '# Product v2\n\nBrand new.\n');
    const rec = store.createProposal({
      block: 'product', op: 'replace-all',
      contentFile: c, rationale: 'pivot',
    });
    store.approveProposal({ id: rec.id });

    const body = readArtifact('product');
    assert.equal(body.trim(), '# Product v2\n\nBrand new.'.trim());
    assert.ok(!body.includes('Old content.'));
  });
});

describe('AC4 — approve: double-approve guard', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('rejects approving an already-approved proposal', () => {
    const c = writeContent('a', '## Once\n\ny\n');
    const rec = store.createProposal({ block: 'glossary', op: 'append', contentFile: c });
    store.approveProposal({ id: rec.id });
    assert.throws(() => store.approveProposal({ id: rec.id }), /no pending proposal/);
  });

  it('rejects approving unknown id', () => {
    assert.throws(() => store.approveProposal({ id: 'mprop-deadbeef' }), /no pending proposal/);
  });
});

// ============================================================
// AC #5 — reject round-trip
// ============================================================

describe('AC5 — reject round-trip', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('archives record to rejected/ without touching the artifact', () => {
    writeArtifact('glossary', '# Glossary\n\n## Keep\n\nUntouched.\n');
    const before = readArtifact('glossary');

    const c = writeContent('r', '## New\n\nDiscard me.\n');
    const rec = store.createProposal({ block: 'glossary', op: 'append', contentFile: c });
    const rejected = store.rejectProposal({ id: rec.id, reason: 'not domain-appropriate' });

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reason, 'not domain-appropriate');
    assert.ok(rejected.decidedAt);

    // Artifact unchanged
    assert.equal(readArtifact('glossary'), before);

    // Moved to rejected/
    assert.equal(store.listProposals({ status: 'pending' }).length, 0);
    const rejList = store.listProposals({ status: 'rejected' });
    assert.equal(rejList.length, 1);
    assert.equal(rejList[0].id, rec.id);
  });

  it('rejects double-reject', () => {
    const c = writeContent('a', 'x');
    const rec = store.createProposal({ block: 'glossary', op: 'append', contentFile: c });
    store.rejectProposal({ id: rec.id });
    assert.throws(() => store.rejectProposal({ id: rec.id }), /no pending proposal/);
  });
});

// ============================================================
// AC #6 — session-end surfacing
// ============================================================

describe('AC6 — session-end surfacing', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('returns null when no pending proposals exist', () => {
    const r = sessionEndHook.summarizePendingMemoryProposals();
    assert.equal(r, null);
  });

  it('summarizes pending proposals with diff preview + approve/reject prompts', () => {
    writeArtifact('glossary', '# Glossary\n\n## A\n\nx\n');
    const a = writeContent('a', '## B\n\ny\n');
    const b = writeContent('b', '## A\n\nz\n');
    const c = writeContent('c', '# Product\n\nNew.\n');

    store.createProposal({ block: 'glossary', op: 'append', contentFile: a });
    store.createProposal({ block: 'glossary', op: 'replace-section', contentFile: b, section: 'A' });
    store.createProposal({ block: 'product', op: 'replace-all', contentFile: c, rationale: 'pivot' });

    const r = sessionEndHook.summarizePendingMemoryProposals();
    assert.ok(r);
    assert.equal(r.count, 3);
    assert.equal(r.byOp.append, 1);
    assert.equal(r.byOp['replace-section'], 1);
    assert.equal(r.byOp['replace-all'], 1);
    assert.equal(r.byBlock.glossary, 2);
    assert.equal(r.byBlock.product, 1);
    assert.equal(r.previews.length, 3);
    assert.match(r.message, /3 pending memory proposals/);
    // Approve/reject prompts present
    assert.match(r.message, /flow memory approve/);
    assert.match(r.message, /flow memory reject/);
    // Diff preview present (shows staged content)
    assert.match(r.message, /preview \(first 6 lines/);
  });

  it('handles single-proposal pluralization correctly', () => {
    const c = writeContent('solo', 'x\n');
    store.createProposal({ block: 'glossary', op: 'append', contentFile: c });
    const r = sessionEndHook.summarizePendingMemoryProposals();
    assert.match(r.message, /^1 pending memory proposal /);
    assert.ok(!r.message.startsWith('1 pending memory proposals'));
  });

  it('filters out approved/rejected proposals', () => {
    const a = writeContent('a', 'x\n');
    const b = writeContent('b', 'y\n');
    const c = writeContent('c', 'z\n');

    const r1 = store.createProposal({ block: 'glossary', op: 'append', contentFile: a });
    store.approveProposal({ id: r1.id });

    const r2 = store.createProposal({ block: 'glossary', op: 'append', contentFile: b });
    store.rejectProposal({ id: r2.id });

    store.createProposal({ block: 'glossary', op: 'append', contentFile: c });

    const r = sessionEndHook.summarizePendingMemoryProposals();
    assert.equal(r.count, 1);
  });
});

// ============================================================
// Section parsing unit tests
// ============================================================

describe('parseSections', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('extracts headings level 2–6 with start/end bounds', () => {
    const text = '# Top\n\n## A\n\nA body.\n\n## B\n\nB body.\n\n### B1\n\nnested.\n';
    const sections = store.parseSections(text);
    const byHeading = Object.fromEntries(sections.map(s => [s.heading, s]));
    assert.ok(byHeading.A);
    assert.ok(byHeading.B);
    assert.ok(byHeading.B1);
    // Section A ends at start of ## B (same level stops it)
    const bodyA = text.slice(byHeading.A.start, byHeading.A.end);
    assert.ok(bodyA.includes('A body'));
    assert.ok(!bodyA.includes('B body'));
    // Section B contains nested ### B1
    const bodyB = text.slice(byHeading.B.start, byHeading.B.end);
    assert.ok(bodyB.includes('B1'));
  });

  it('ignores level-1 headings (# Top)', () => {
    const sections = store.parseSections('# Top\n\n## A\n\nx\n');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, 'A');
  });
});

describe('findSectionByHeading', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('reports heading not found', () => {
    const r = store.findSectionByHeading('## A\n\nx\n', 'B');
    assert.ok(r.error);
    assert.match(r.error, /not found/);
  });

  it('reports ambiguous duplicate', () => {
    const r = store.findSectionByHeading('## X\n\n1\n\n## X\n\n2\n', 'X');
    assert.ok(r.error);
    assert.match(r.error, /ambiguous/);
    assert.equal(r.matchCount, 2);
  });

  it('matches exact heading', () => {
    const r = store.findSectionByHeading('## Hello\n\nx\n', 'Hello');
    assert.ok(!r.error);
    assert.equal(r.section.heading, 'Hello');
  });
});
