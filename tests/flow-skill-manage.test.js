'use strict';

/**
 * Tests for flow-skill-manage CLI + lib/skill-proposal-store.js +
 * session-end-skill-proposals hook.
 *
 * Covers: propose/patch/remove staging, promote round-trip (new + patch + remove),
 * reject cleanup, archive direct path, session-end surfacing, input validation.
 *
 * Isolation: each test uses a tmpdir project root via WOGI_PROJECT_ROOT + cache bust.
 *
 * Run: NODE_ENV=test node --test tests/flow-skill-manage.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-skill-manage-test-'));
  // Create required directory skeleton so the store can operate
  fs.mkdirSync(path.join(TMP_ROOT, '.workflow', 'state'), { recursive: true });
  fs.mkdirSync(path.join(TMP_ROOT, '.claude', 'skills'), { recursive: true });
  process.env.WOGI_PROJECT_ROOT = TMP_ROOT;

  // Bust caches so flow-paths re-evaluates PROJECT_ROOT
  for (const key of Object.keys(require.cache)) {
    if (key.includes('flow-paths') || key.includes('skill-proposal-store') || key.includes('session-end-skill-proposals')) {
      delete require.cache[key];
    }
  }

  store = require('../lib/skill-proposal-store');
  sessionEndHook = require('../scripts/hooks/core/session-end-skill-proposals');
}

function teardownTmpProject() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch (_err) { /* ignore */ }
  delete process.env.WOGI_PROJECT_ROOT;
}

function writeContent(name, body) {
  const p = path.join(TMP_ROOT, 'scratch-' + name + '.md');
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function writeActiveSkill(name, body) {
  const p = store.pathFor.activeSkill(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

// ============================================================
// createProposal — validation
// ============================================================

describe('createProposal — input validation', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('rejects invalid action', () => {
    assert.throws(
      () => store.createProposal({ action: 'zap', skillName: 'foo' }),
      /invalid action/
    );
  });

  it('rejects missing skill name', () => {
    assert.throws(
      () => store.createProposal({ action: 'propose', skillName: '' }),
      /skill name is required/
    );
  });

  it('rejects invalid skill name format', () => {
    assert.throws(
      () => store.createProposal({ action: 'propose', skillName: 'Has Spaces' }),
      /invalid skill name/
    );
  });

  it('rejects propose without --content', () => {
    assert.throws(
      () => store.createProposal({ action: 'propose', skillName: 'foo' }),
      /--content is required/
    );
  });

  it('rejects remove when active skill is missing', () => {
    assert.throws(
      () => store.createProposal({ action: 'remove', skillName: 'nonexistent' }),
      /no active skill/
    );
  });

  it('rejects content file outside project root', () => {
    const outside = path.join(os.tmpdir(), 'outside-' + Date.now() + '.md');
    fs.writeFileSync(outside, 'x', 'utf-8');
    try {
      assert.throws(
        () => store.createProposal({
          action: 'propose',
          skillName: 'foo',
          contentFile: outside,
        }),
        /escapes project root/
      );
    } finally {
      try { fs.unlinkSync(outside); } catch (_err) { /* ignore */ }
    }
  });
});

// ============================================================
// AC 1: propose round-trip
// ============================================================

describe('AC1 — propose round-trip', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages new skill to pending/ with metadata', () => {
    const src = writeContent('react-hooks', '# React Hooks\n\nPatterns.\n');
    const rec = store.createProposal({
      action: 'propose',
      skillName: 'react-hooks',
      contentFile: src,
      rationale: 'capture hook patterns',
    });

    assert.equal(rec.action, 'propose');
    assert.equal(rec.skillName, 'react-hooks');
    assert.equal(rec.status, 'pending');
    assert.equal(rec.proposedBy, 'agent');
    assert.match(rec.id, /^prop-[a-f0-9]{8}$/);
    assert.ok(rec.proposedAt.includes('T'));
    assert.equal(rec.rationale, 'capture hook patterns');

    // Pending content written
    const pendingPath = store.pathFor.pendingSkill('react-hooks');
    assert.ok(fs.existsSync(pendingPath));
    assert.equal(fs.readFileSync(pendingPath, 'utf-8'), '# React Hooks\n\nPatterns.\n');

    // Proposal record persisted
    const list = store.listProposals({ status: 'pending' });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, rec.id);
  });

  it('records proposedBy=user when specified', () => {
    const src = writeContent('user-skill', 'x');
    const rec = store.createProposal({
      action: 'propose',
      skillName: 'user-skill',
      contentFile: src,
      proposedBy: 'user',
    });
    assert.equal(rec.proposedBy, 'user');
  });
});

// ============================================================
// AC 2: patch round-trip
// ============================================================

describe('AC2 — patch round-trip', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages edit proposal to pending/ (pairs with F3 fuzzy-match)', () => {
    writeActiveSkill('existing', '# Existing\n\nOld content.\n');
    const src = writeContent('existing', '# Existing\n\nNew content.\n');
    const rec = store.createProposal({
      action: 'patch',
      skillName: 'existing',
      contentFile: src,
    });

    assert.equal(rec.action, 'patch');
    assert.equal(rec.status, 'pending');

    const pendingPath = store.pathFor.pendingSkill('existing');
    assert.ok(fs.existsSync(pendingPath));

    // Active unchanged until promote
    const activePath = store.pathFor.activeSkill('existing');
    assert.equal(fs.readFileSync(activePath, 'utf-8'), '# Existing\n\nOld content.\n');
  });
});

// ============================================================
// AC 3: remove round-trip (soft-delete on promote)
// ============================================================

describe('AC3 — remove round-trip', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('stages removal proposal; active skill untouched until promote', () => {
    writeActiveSkill('outdated', '# Outdated\n');
    const rec = store.createProposal({
      action: 'remove',
      skillName: 'outdated',
      rationale: 'superseded',
    });

    assert.equal(rec.action, 'remove');
    assert.equal(rec.contentPath, null);
    assert.equal(rec.status, 'pending');
    assert.ok(fs.existsSync(store.pathFor.activeSkill('outdated')),
      'active skill should remain until promote');
  });

  it('promote moves active → archived/', () => {
    writeActiveSkill('outdated', '# Outdated\n');
    store.createProposal({ action: 'remove', skillName: 'outdated' });

    const applied = store.promoteProposal({ skillName: 'outdated' });
    assert.equal(applied.status, 'approved');

    assert.equal(fs.existsSync(store.pathFor.activeSkill('outdated')), false);
    assert.ok(fs.existsSync(store.pathFor.archivedSkill('outdated')));
    assert.equal(fs.readFileSync(store.pathFor.archivedSkill('outdated'), 'utf-8'), '# Outdated\n');
  });
});

// ============================================================
// AC 4: promote round-trip (user-invoked only, semantic-only)
// ============================================================

describe('AC4 — promote round-trip', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('promote(propose): moves pending/ → active', () => {
    const src = writeContent('new-skill', '# New\n');
    store.createProposal({ action: 'propose', skillName: 'new-skill', contentFile: src });

    const applied = store.promoteProposal({ skillName: 'new-skill' });
    assert.equal(applied.status, 'approved');
    assert.ok(applied.decidedAt);

    const activePath = store.pathFor.activeSkill('new-skill');
    assert.ok(fs.existsSync(activePath));
    assert.equal(fs.readFileSync(activePath, 'utf-8'), '# New\n');
    assert.equal(fs.existsSync(store.pathFor.pendingSkill('new-skill')), false);
  });

  it('promote(patch): overwrites active with pending content', () => {
    writeActiveSkill('target', '# Target\n\nOld.\n');
    const src = writeContent('target', '# Target\n\nNew.\n');
    store.createProposal({ action: 'patch', skillName: 'target', contentFile: src });

    store.promoteProposal({ skillName: 'target' });

    const activePath = store.pathFor.activeSkill('target');
    assert.equal(fs.readFileSync(activePath, 'utf-8'), '# Target\n\nNew.\n');
    assert.equal(fs.existsSync(store.pathFor.pendingSkill('target')), false);
  });

  it('rejects promote of already-approved proposal', () => {
    const src = writeContent('foo', 'x');
    store.createProposal({ action: 'propose', skillName: 'foo', contentFile: src });
    store.promoteProposal({ skillName: 'foo' });
    assert.throws(
      () => store.promoteProposal({ skillName: 'foo' }),
      /no pending proposal/
    );
  });

  it('rejects promote when no matching proposal exists', () => {
    assert.throws(
      () => store.promoteProposal({ skillName: 'ghost' }),
      /no pending proposal/
    );
  });

  it('rejects promote(propose) when active skill already exists', () => {
    writeActiveSkill('clash', '# Existing\n');
    const src = writeContent('clash', '# New\n');
    store.createProposal({ action: 'propose', skillName: 'clash', contentFile: src });
    assert.throws(
      () => store.promoteProposal({ skillName: 'clash' }),
      /active skill already exists/
    );
  });
});

// ============================================================
// reject — pending content cleanup
// ============================================================

describe('reject — discards pending content', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('removes pending/<name>.md on reject', () => {
    const src = writeContent('abandoned', 'x');
    store.createProposal({ action: 'propose', skillName: 'abandoned', contentFile: src });
    assert.ok(fs.existsSync(store.pathFor.pendingSkill('abandoned')));

    const rejected = store.rejectProposal({ skillName: 'abandoned' });
    assert.equal(rejected.status, 'rejected');
    assert.equal(fs.existsSync(store.pathFor.pendingSkill('abandoned')), false);
  });

  it('reject of remove proposal leaves active skill in place', () => {
    writeActiveSkill('keep-me', '# Keep\n');
    store.createProposal({ action: 'remove', skillName: 'keep-me' });
    store.rejectProposal({ skillName: 'keep-me' });
    assert.ok(fs.existsSync(store.pathFor.activeSkill('keep-me')));
  });
});

// ============================================================
// archive — direct, no staging
// ============================================================

describe('archive — direct path (user-only)', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('moves active → archived/ immediately without staging', () => {
    writeActiveSkill('deprecated', '# Deprecated\n');
    const r = store.archiveSkill('deprecated');
    assert.equal(r.skillName, 'deprecated');
    assert.match(r.archivedPath, /archived\/deprecated\.md$/);
    assert.equal(fs.existsSync(store.pathFor.activeSkill('deprecated')), false);
    assert.ok(fs.existsSync(store.pathFor.archivedSkill('deprecated')));
  });

  it('rejects archive when no active skill exists', () => {
    assert.throws(() => store.archiveSkill('ghost'), /no active skill/);
  });
});

// ============================================================
// AC 5: session-end surfacing
// ============================================================

describe('AC5 — session-end surfacing', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('returns null when no pending proposals exist', () => {
    const r = sessionEndHook.summarizePendingProposals();
    assert.equal(r, null);
  });

  it('summarizes pending proposals with breakdown + prompts', () => {
    writeActiveSkill('edit-me', '# x\n');
    writeActiveSkill('remove-me', '# y\n');
    const a = writeContent('new-one', 'x');
    const b = writeContent('edit-me', 'y');
    store.createProposal({ action: 'propose', skillName: 'new-one', contentFile: a });
    store.createProposal({ action: 'patch',   skillName: 'edit-me', contentFile: b });
    store.createProposal({ action: 'remove',  skillName: 'remove-me' });

    const r = sessionEndHook.summarizePendingProposals();
    assert.ok(r);
    assert.equal(r.count, 3);
    assert.equal(r.byAction.propose, 1);
    assert.equal(r.byAction.patch, 1);
    assert.equal(r.byAction.remove, 1);
    assert.equal(r.proposals.length, 3);
    assert.match(r.message, /3 pending skill proposals/);
    assert.match(r.message, /flow skill pending/);
    assert.match(r.message, /flow skill promote/);
    assert.match(r.message, /flow skill reject/);
  });

  it('handles single-proposal pluralization correctly', () => {
    const a = writeContent('solo', 'x');
    store.createProposal({ action: 'propose', skillName: 'solo', contentFile: a });
    const r = sessionEndHook.summarizePendingProposals();
    assert.match(r.message, /^1 pending skill proposal /);
    assert.ok(!r.message.startsWith('1 pending skill proposals'));
  });

  it('filters out non-pending (approved/rejected) proposals', () => {
    const a = writeContent('a', 'x');
    store.createProposal({ action: 'propose', skillName: 'approved-skill', contentFile: a });
    store.promoteProposal({ skillName: 'approved-skill' });

    const b = writeContent('b', 'x');
    store.createProposal({ action: 'propose', skillName: 'rejected-skill', contentFile: b });
    store.rejectProposal({ skillName: 'rejected-skill' });

    const c = writeContent('c', 'x');
    store.createProposal({ action: 'propose', skillName: 'still-pending', contentFile: c });

    const r = sessionEndHook.summarizePendingProposals();
    assert.equal(r.count, 1);
    assert.equal(r.proposals[0].skillName, 'still-pending');
  });
});

// ============================================================
// listProposals — filtering & id lookup
// ============================================================

describe('listProposals + findProposal', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('returns all when no filter given', () => {
    const a = writeContent('a', 'x');
    store.createProposal({ action: 'propose', skillName: 'a', contentFile: a });
    store.promoteProposal({ skillName: 'a' });
    const b = writeContent('b', 'x');
    store.createProposal({ action: 'propose', skillName: 'b', contentFile: b });

    assert.equal(store.listProposals().length, 2);
    assert.equal(store.listProposals({ status: 'pending' }).length, 1);
    assert.equal(store.listProposals({ status: 'approved' }).length, 1);
  });

  it('findProposal by id returns exact match', () => {
    const a = writeContent('a', 'x');
    const rec = store.createProposal({ action: 'propose', skillName: 'a', contentFile: a });
    const found = store.findProposal({ id: rec.id });
    assert.equal(found.id, rec.id);
  });
});

// ============================================================
// CLI wrapper — parseArgs
// ============================================================

describe('flow-skill-manage CLI — parseArgs', () => {
  beforeEach(setupTmpProject);
  afterEach(teardownTmpProject);

  it('parses propose with --name --content --rationale', () => {
    const cli = require('../scripts/flow-skill-manage');
    const r = cli.parseArgs(['propose', '--name', 'foo', '--content', 'x.md', '--rationale', 'because']);
    assert.equal(r.subcommand, 'propose');
    assert.equal(r.flags.name, 'foo');
    assert.equal(r.flags.content, 'x.md');
    assert.equal(r.flags.rationale, 'because');
  });

  it('parses promote with positional name', () => {
    const cli = require('../scripts/flow-skill-manage');
    const r = cli.parseArgs(['promote', 'my-skill']);
    assert.equal(r.subcommand, 'promote');
    assert.deepEqual(r.positional, ['my-skill']);
  });

  it('parses pending with --json flag', () => {
    const cli = require('../scripts/flow-skill-manage');
    const r = cli.parseArgs(['pending', '--json']);
    assert.equal(r.subcommand, 'pending');
    assert.equal(r.flags.json, true);
  });
});
