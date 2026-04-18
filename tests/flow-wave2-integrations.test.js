'use strict';

/**
 * Wave 2 (2.24.0) integration tests.
 *
 * Validates:
 *   - flow-extraction-review.exportAsItemManifest exists and produces the
 *     expected shape for /wogi-story integration
 *   - Docs contracts for /wogi-feature, /wogi-plan, /wogi-epics, /wogi-test,
 *     /wogi-test-browser, /wogi-test-generate
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', '.claude', 'commands');

// ============================================================
// flow-extraction-review integration
// ============================================================

describe('flow-extraction-review (Wave 2.1)', () => {
  const mod = require('../scripts/flow-extraction-review');

  it('exports exportAsItemManifest', () => {
    assert.equal(typeof mod.exportAsItemManifest, 'function');
  });

  it('throws when called without active session', () => {
    assert.throws(() => mod.exportAsItemManifest(), /No review session active/);
  });

  it('CLI has "manifest" subcommand wired', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'flow-extraction-review.js'), 'utf-8');
    assert.match(src, /case 'manifest':/);
  });

  it('happy path: emits manifest with items + bypassLongInput + intentBootstrapScheduled (v2.25.1 — M1)', () => {
    // The module's TMP_DIR is baked at load-time from process.cwd(), so we
    // write the fixture to the REAL default location, preserve whatever's
    // there today, and restore on cleanup.
    const tmpDir = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
    const reviewFile = path.join(tmpDir, 'review-session.json');

    const preexisting = fs.existsSync(reviewFile) ? fs.readFileSync(reviewFile) : null;
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const session = {
        id: 'review-test123',
        status: 'complete',
        completeness_confirmed: true,
        completeness_confirmed_at: new Date().toISOString(),
        items: [
          { id: 'i1', text: 'Fix the login page', review_status: 'confirmed' },
          { id: 'i2', text: 'Add dark mode toggle', review_status: 'confirmed' },
          { id: 'i3', text: 'Skipped item', review_status: 'removed' },
          { id: 'i4', text: 'Remove mock data', review_status: 'confirmed' }
        ]
      };
      fs.writeFileSync(reviewFile, JSON.stringify(session, null, 2));

      const manifest = mod.exportAsItemManifest();
      assert.equal(manifest.count, 3);
      assert.deepEqual(manifest.items, ['Fix the login page', 'Add dark mode toggle', 'Remove mock data']);
      assert.equal(manifest.bypassLongInput, true);
      assert.equal(manifest.sourceSessionId, 'review-test123');
      assert.equal(typeof manifest.intentBootstrapScheduled, 'boolean');
    } finally {
      if (preexisting) {
        fs.writeFileSync(reviewFile, preexisting);
      } else {
        try { fs.unlinkSync(reviewFile); } catch (_err) { /* ignore */ }
      }
    }
  });
});

// ============================================================
// Planning commands docs contracts
// ============================================================

describe('wogi-feature.md (Wave 2.2)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-feature.md'), 'utf-8');

  it('documents Anti-Deferral Rule', () => {
    assert.match(file, /Anti-Deferral Rule/);
    assert.match(file, /EVERY item the user provided MUST/);
  });

  it('documents P0 Specification-Quality Gates', () => {
    assert.match(file, /P0 Specification-Quality Gates/);
    assert.match(file, /Long Input Gate/);
    assert.match(file, /Item Reconciliation/);
    assert.match(file, /Consumer Impact/);
    assert.match(file, /Scope-Confidence/);
  });

  it('references flow-story-gates module', () => {
    assert.match(file, /flow-story-gates/);
  });
});

describe('wogi-plan.md (Wave 2.2)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-plan.md'), 'utf-8');

  it('documents Anti-Deferral Rule', () => {
    assert.match(file, /Anti-Deferral Rule/);
  });

  it('documents P0 Specification-Quality Gates', () => {
    assert.match(file, /P0 Specification-Quality Gates/);
  });
});

describe('wogi-epics.md (Wave 2.2 addition)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-epics.md'), 'utf-8');

  it('adds P0 Specification-Quality Gates section', () => {
    assert.match(file, /P0 Specification-Quality Gates/);
    assert.match(file, /flow-story-gates/);
  });

  it('preserves existing Anti-Deferral Rule', () => {
    assert.match(file, /Anti-Deferral Rule/);
  });
});

// ============================================================
// Test commands evidence-tier docs
// ============================================================

describe('wogi-test.md (Wave 2.3)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-test.md'), 'utf-8');

  it('documents Evidence Tiers section', () => {
    assert.match(file, /Evidence Tiers/);
  });

  it('documents all 5 tier labels (NONE/STATIC/COMPILED/INTERACTIVE/SHIPPED)', () => {
    for (const lbl of ['NONE', 'STATIC', 'COMPILED', 'INTERACTIVE', 'SHIPPED']) {
      assert.match(file, new RegExp(lbl));
    }
  });

  it('documents JSON output shape with evidenceTier', () => {
    assert.match(file, /evidenceTier/);
    assert.match(file, /evidenceTierLabel/);
  });

  it('references Completion Truth Gate integration', () => {
    assert.match(file, /Truth Gate|truth gate|Step 3\.9/i);
  });
});

describe('wogi-test-browser.md (Wave 2.3)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-test-browser.md'), 'utf-8');

  it('documents Tier 4 SHIPPED emission', () => {
    assert.match(file, /Evidence Tier/);
    assert.match(file, /Tier 4|SHIPPED/);
  });
});

describe('wogi-test-generate.md (Wave 2.3)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-test-generate.md'), 'utf-8');

  it('documents Tier 1 STATIC / Tier 2 COMPILED emission', () => {
    assert.match(file, /Evidence Tier/);
    assert.match(file, /STATIC|COMPILED/);
  });
});

// ============================================================
// extract-review docs contract
// ============================================================

describe('wogi-extract-review.md (Wave 2.1)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-extract-review.md'), 'utf-8');

  it('documents Item Manifest Export section', () => {
    assert.match(file, /Item Manifest Export/);
  });

  it('documents bypassLongInput coordination', () => {
    assert.match(file, /bypassLongInput/);
  });

  it('documents manifest CLI subcommand', () => {
    assert.match(file, /flow extract-zero-loss manifest/);
  });
});
