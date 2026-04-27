'use strict';

/**
 * Tests for flow-source-fidelity.js (P11.5 mechanical check).
 *
 * Pins the regression class diagnosed in the wogi-hub 2026-04-27
 * Customers > Services incident: long user prompt → manager-side
 * compression to a 5-bullet "owner-locked decisions" contract → spec
 * built from the contract, not the prompt → 5 of 12 user-named features
 * survive. The verifier's job is to refuse to approve specs derived
 * from long prompts that don't preserve the verbatim source.
 *
 * Run: node --test tests/flow-source-fidelity.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sf = require('../scripts/flow-source-fidelity');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-srcfid-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});

function writeSpec(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('detectDiscreteItems — counts items by structural marker', () => {
  it('counts bullet items', () => {
    assert.equal(sf.detectDiscreteItems('- one\n- two\n- three'), 3);
    assert.equal(sf.detectDiscreteItems('* a\n* b'), 2);
  });

  it('counts numbered items', () => {
    assert.equal(sf.detectDiscreteItems('1. one\n2. two\n3) three'), 3);
  });

  it('counts semicolon-separated lines', () => {
    assert.equal(sf.detectDiscreteItems('do x; do y; do z'), 1); // single line, two semicolons
    assert.equal(sf.detectDiscreteItems('do x; do y;\nthen p; q;'), 2);
  });

  it('returns 0 for prose paragraphs', () => {
    assert.equal(sf.detectDiscreteItems('Just a single sentence with no markers.'), 0);
  });
});

describe('checkSourceFidelity — exempt path (short specs)', () => {
  it('passes a short spec with no verbatim block', () => {
    const p = writeSpec('short.md', '# Story\n\nFix the typo on the login button.');
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, true);
    assert.equal(r.exempt, true);
  });

  it('passes a 3-item spec (under threshold)', () => {
    const p = writeSpec('short3.md', `# Story
- Fix typo
- Update tests
- Bump version`);
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, true);
    assert.equal(r.exempt, true);
  });
});

describe('checkSourceFidelity — long-prompt enforcement (T1)', () => {
  it('fails a long-prompt spec with no verbatim block (the wogi-hub regression)', () => {
    const lines = ['# Story Spec', '## Acceptance Criteria'];
    for (let i = 0; i < 50; i++) lines.push(`- AC${i}: do thing ${i}`);
    const p = writeSpec('long-no-verbatim.md', lines.join('\n'));
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, false);
    assert.equal(r.exempt, false);
    assert.ok(r.missing.some(m => m.startsWith('T1:')),
      'expected T1 verbatim-block-missing failure, got: ' + JSON.stringify(r.missing));
  });

  it('passes a long-prompt spec WITH verbatim block', () => {
    const verbatim = Array.from({ length: 50 }, (_, i) => `- item ${i}`).join('\n');
    const spec = `# Story Spec

## Original Request (verbatim)

${verbatim}

## Acceptance Criteria

- AC1: do thing 1
- AC2: do thing 2`;
    const p = writeSpec('long-with-verbatim.md', spec);
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, true);
    assert.equal(r.exempt, false);
    assert.equal(r.verbatim.itemCount, 50);
  });

  it('triggers on ≥5 discrete items in spec body even if body is short', () => {
    const spec = `# Story
- one
- two
- three
- four
- five
- six`;
    const p = writeSpec('many-items.md', spec);
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, false);
    assert.ok(r.missing.some(m => m.startsWith('T1:')));
  });
});

describe('checkSourceFidelity — item manifest (T2)', () => {
  function longSpec(extra = '') {
    const verbatim = Array.from({ length: 50 }, (_, i) => `- item ${i}`).join('\n');
    return `# Story Spec

## Original Request (verbatim)

${verbatim}

${extra}

## Acceptance Criteria

- AC1
- AC2`;
  }

  it('warns when manifest is absent (default mode)', () => {
    const p = writeSpec('no-manifest.md', longSpec());
    const r = sf.checkSourceFidelity(p, { strict: false });
    assert.equal(r.ok, true, 'manifest is recommended, not required by default');
    assert.ok(r.warnings.some(w => w.startsWith('T2:')));
  });

  it('blocks when manifest is absent (--strict)', () => {
    const p = writeSpec('no-manifest-strict.md', longSpec());
    const r = sf.checkSourceFidelity(p, { strict: true });
    assert.equal(r.ok, false);
    assert.ok(r.missing.some(m => m.startsWith('T2:')));
  });

  it('passes a complete manifest', () => {
    const manifest = `## Item Manifest

- Two tabs Services + Integration → defer-with-reason: deprecated by 2026-04-26 owner decision
- Service block dropdown 1 → AC1
- Service block dropdown 2 → AC2`;
    const p = writeSpec('with-manifest.md', longSpec(manifest));
    const r = sf.checkSourceFidelity(p, { strict: true });
    assert.equal(r.ok, true);
    assert.equal(r.manifest.entries.length, 3);
  });

  it('warns about manifest entries missing mapping', () => {
    const manifest = `## Item Manifest

- proper item → AC1
- orphan item with no arrow`;
    const p = writeSpec('manifest-orphan.md', longSpec(manifest));
    const r = sf.checkSourceFidelity(p, { strict: false });
    assert.ok(r.warnings.some(w => /orphan item/.test(w)));
  });
});

describe('checkSourceFidelity — wogi-hub regression case (Tier-3 simulation)', () => {
  // regression-tier3
  // Pin the ACTUAL wogi-hub prompt that triggered the incident. If a spec
  // derived from this prompt doesn't preserve it verbatim, the verifier
  // BLOCKS — preventing the same regression from shipping again.
  it('the wogi-hub prompt qualifies as long-form (>40 lines OR ≥5 items)', () => {
    const wogiHubPrompt = `Customers > Services (call it services and not integrations)
Connect To Jira
Add Service Block

When Adding a Service Block

Dropdown to select Department / Service / Team / Employee
2nd Dropdown - Select from the existing selected entity from the first dropdown
3rd dropdown - a drop down of all applicable rate
- Customer Rate (it could be per class or flat)
- Customer department rate (same flat / per class)
- Department rate
- Service rate
- Employee rate
- Customer (will add another input field)

After we map this to the service block we also need to decide the routing rules.
- Customer manager
- customer department manager
- Entity manager of the service
- Claimable
- admin

Then we need to define the rules for estimation.
We can also have a checkbox that everything that comes from this service block has to be estimated.

Underneath the service blocks we have three rules.
1. catch all default rate
2. external discussion display rule
3. default routing for unmatched tasks`;
    assert.equal(sf.detectDiscreteItems(wogiHubPrompt) >= 5, true,
      'wogi-hub prompt must qualify as long-form');
  });

  it('a 5-bullet "contract summary" spec derived from a long prompt → BLOCKED', () => {
    // Simulating what the wogi-hub manager wrote: a 5-bullet "owner-locked
    // decisions" without preserving the original 50-line user prompt.
    const contractSummary = `# wf-c23dc072 — Services + Integration consolidation

## Owner-locked decisions (5 bullets)

1. Rename Work Blocks → Services
2. Add tag/project/status mapping (multi)
3. Customer-level applicable rate cascade (5 entries)
4. Per-customer routing dropdown
5. Catch-all rule preserved

## Acceptance Criteria

- AC1: tab + section rename
- AC2: matcher arrays UI
- AC3: customer-level rate cascade
- AC4: customer-level routing
- AC5: catch-all preserved`;
    const p = writeSpec('contract-summary.md', contractSummary);
    const r = sf.checkSourceFidelity(p, { strict: false });
    // The spec qualifies as long-form by item count (≥5 items in the
    // bullet contract) — verifier expects a verbatim block of the
    // ORIGINAL user prompt, not the 5-bullet derivative.
    assert.equal(r.ok, false,
      'contract-summary spec without verbatim source MUST be blocked — this is the wogi-hub regression');
    assert.ok(r.missing.some(m => m.startsWith('T1:')));
  });
});

describe('checkSourceFidelity — error paths', () => {
  it('returns failure for missing spec file', () => {
    const r = sf.checkSourceFidelity(path.join(tmpDir, 'nonexistent.md'));
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes('spec-file-not-found'));
  });

  it('returns failure for null/undefined path', () => {
    assert.equal(sf.checkSourceFidelity(null).ok, false);
    assert.equal(sf.checkSourceFidelity(undefined).ok, false);
  });

  it('verbatim-block-empty failure', () => {
    const verbatimItems = Array.from({ length: 50 }, (_, i) => `- item ${i}`).join('\n');
    const spec = `# Story

## Original Request (verbatim)

## Acceptance Criteria

${verbatimItems}`;
    const p = writeSpec('empty-verbatim.md', spec);
    const r = sf.checkSourceFidelity(p);
    assert.equal(r.ok, false);
    assert.ok(r.missing.some(m => m.includes('empty')));
  });
});
