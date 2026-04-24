'use strict';

/**
 * Tests for feature dossier + logic rules system (wf-557cf08a).
 *
 * Covers:
 *   - parseDossier() extracts slug/status/owners/sections
 *   - matchFeatures() scores candidates from index + inline match patterns
 *   - validateSpecAgainstDossier() flags rejected alternatives + removed elements
 *   - appendEvent() writes to the change log
 *   - parseRulesFile() extracts rule metadata + applies-to + enforcement grep
 *   - matchRulesForFiles() returns rules whose scope matches files/keywords
 *
 * Run: NODE_ENV=test node --test tests/flow-feature-dossier.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

let tmpRoot;
let origCwd;
let origEnv;
let dossierLib;
let rulesLib;

before(() => {
  origCwd = process.cwd();
  origEnv = { ...process.env };
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-dossier-'));
  fs.mkdirSync(path.join(tmpRoot, '.workflow', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, '.workflow', 'dossiers'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.workflow', 'config.json'), JSON.stringify({
    featureDossier: { enabled: true, autoMatchConfidence: 1, blockOnContradiction: true }
  }));
  fs.writeFileSync(path.join(tmpRoot, '.workflow', 'state', 'ready.json'), JSON.stringify({
    inProgress: [], ready: [], blocked: [], recentlyCompleted: [], backlog: []
  }));
  try { execSync('git init -q', { cwd: tmpRoot }); } catch (_err) { /* noop */ }
  process.env.WOGI_PROJECT_ROOT = tmpRoot;
  delete process.env.WOGI_WORKSPACE_ROOT;
  process.chdir(tmpRoot);
  // Force module reload under new root
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/scripts/flow-') || key.includes('/scripts/hooks/')) {
      delete require.cache[key];
    }
  }
  dossierLib = require(path.join(origCwd, 'scripts', 'flow-feature-dossier'));
  rulesLib = require(path.join(origCwd, 'scripts', 'flow-logic-rules'));
});

after(() => {
  process.chdir(origCwd);
  process.env = origEnv;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_err) { /* noop */ }
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/scripts/flow-') || key.includes('/scripts/hooks/')) {
      delete require.cache[key];
    }
  }
});

function writeDossier(slug, content) {
  const p = path.join(tmpRoot, '.workflow', 'dossiers', `${slug}.md`);
  fs.writeFileSync(p, content);
  return p;
}

function writeRules(content) {
  const p = path.join(tmpRoot, '.workflow', 'dossiers', '_logic-rules.md');
  fs.writeFileSync(p, content);
  return p;
}

describe('parseDossier', () => {
  beforeEach(() => {
    const idx = path.join(tmpRoot, '.workflow', 'dossiers', 'index.json');
    fs.writeFileSync(idx, JSON.stringify({ version: '1.0.0', patterns: [], slugs: {} }));
    for (const f of fs.readdirSync(path.join(tmpRoot, '.workflow', 'dossiers'))) {
      if (f.endsWith('.md') && f !== '_template.md') {
        fs.unlinkSync(path.join(tmpRoot, '.workflow', 'dossiers', f));
      }
    }
  });

  it('extracts metadata and sections', () => {
    writeDossier('customer-page', `# Customer Page

<!-- slug: customer-page -->
<!-- status: active -->
<!-- owners: fe, be -->
<!-- created: 2026-03-20 -->

## Canonical Summary

The customer page shows employee seats. No free-form contact persons.

## Match Patterns

- route: /customers
- keyword: customer page
- file: src/pages/Customer*

## Removed Elements

- 2026-03-20: Contact person block → removed, reason: every person needs a seat, enforcement-grep: \`ContactPersonBlock\`
`);
    const d = dossierLib.loadDossier('customer-page');
    assert.ok(d, 'dossier loads');
    assert.equal(d.slug, 'customer-page');
    assert.equal(d.status, 'active');
    assert.deepEqual(d.owners, ['fe', 'be']);
    assert.ok(d.sections['Canonical Summary']);
    assert.ok(d.sections['Match Patterns']);
    assert.ok(d.sections['Removed Elements']);
  });
});

describe('matchFeatures', () => {
  beforeEach(() => {
    const idx = path.join(tmpRoot, '.workflow', 'dossiers', 'index.json');
    fs.writeFileSync(idx, JSON.stringify({ version: '1.0.0', patterns: [], slugs: {} }));
    for (const f of fs.readdirSync(path.join(tmpRoot, '.workflow', 'dossiers'))) {
      if (f.endsWith('.md') && f !== '_template.md') {
        fs.unlinkSync(path.join(tmpRoot, '.workflow', 'dossiers', f));
      }
    }
  });

  it('scores matches from inline Match Patterns', () => {
    writeDossier('services', `# Services

<!-- slug: services -->
<!-- status: active -->

## Canonical Summary

Department-owned services assigned to customers.

## Match Patterns

- keyword: services
- route: /services
- file: src/pages/Services*
- component: ServiceCard
`);
    const matches = dossierLib.matchFeatures({
      title: 'merge services and integrations',
      files: ['src/pages/Services.tsx']
    });
    assert.ok(matches.length > 0, 'finds matches');
    assert.equal(matches[0].slug, 'services');
    assert.ok(matches[0].score >= 2, `score should be >= 2, got ${matches[0].score}`);
  });

  it('returns empty when nothing matches', () => {
    const matches = dossierLib.matchFeatures({ title: 'unrelated work', files: [] });
    assert.equal(matches.length, 0);
  });
});

describe('validateSpecAgainstDossier', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(path.join(tmpRoot, '.workflow', 'dossiers'))) {
      if (f.endsWith('.md') && f !== '_template.md') {
        fs.unlinkSync(path.join(tmpRoot, '.workflow', 'dossiers', f));
      }
    }
  });

  it('flags spec that reintroduces a removed element', () => {
    writeDossier('customer', `# Customer

<!-- slug: customer -->
<!-- status: active -->

## Removed Elements

- 2026-03-20: Contact person block → removed, reason: seats only, enforcement-grep: \`ContactPersonBlock\`
`);
    const d = dossierLib.loadDossier('customer');
    const spec = 'Add a ContactPersonBlock component to the customer page.';
    const issues = dossierLib.validateSpecAgainstDossier(spec, d);
    assert.ok(issues.length > 0, 'flags reintroduction');
    assert.ok(issues.some(i => i.kind === 'removed-element-pattern' || i.kind === 'removed-element'),
      `expected removed-element issue, got: ${JSON.stringify(issues)}`);
  });

  it('flags spec that mentions rejected alternative', () => {
    writeDossier('merge-pattern', `# Merge Pattern

<!-- slug: merge-pattern -->
<!-- status: active -->

## Rejected Alternatives

- 2026-04-15: stack-two-components pattern → REJECTED, reason: user picked merged-card
`);
    const d = dossierLib.loadDossier('merge-pattern');
    const spec = 'Implement the merge using the stack-two-components pattern.';
    const issues = dossierLib.validateSpecAgainstDossier(spec, d);
    assert.ok(issues.length > 0, `should flag rejected mention, got: ${JSON.stringify(issues)}`);
    assert.equal(issues[0].kind, 'rejected-alternative');
  });

  it('passes when spec is aligned', () => {
    writeDossier('clean', `# Clean Feature

<!-- slug: clean -->
<!-- status: active -->

## Rejected Alternatives

- 2026-01-01: old-design-xyz → REJECTED, reason: deprecated
`);
    const d = dossierLib.loadDossier('clean');
    const spec = 'Implement the feature per the approved wireframe.';
    const issues = dossierLib.validateSpecAgainstDossier(spec, d);
    assert.equal(issues.length, 0);
  });
});

describe('appendEvent', () => {
  it('appends a row to the change log', () => {
    writeDossier('a-feature', `# A Feature

<!-- slug: a-feature -->

## Change Log

| Date | Task ID | Event | Note |
|------|---------|-------|------|
`);
    dossierLib.appendEvent('a-feature', {
      taskId: 'wf-12345678',
      type: 'touched',
      note: 'Refactored header',
      date: '2026-04-24'
    });
    const content = fs.readFileSync(path.join(tmpRoot, '.workflow', 'dossiers', 'a-feature.md'), 'utf-8');
    assert.ok(content.includes('wf-12345678'), 'wrote task id');
    assert.ok(content.includes('Refactored header'), 'wrote note');
  });
});

describe('logic rules', () => {
  beforeEach(() => {
    const p = path.join(tmpRoot, '.workflow', 'dossiers', '_logic-rules.md');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('parses and matches rules by file pattern', () => {
    writeRules(`# Logic Rules

## RULE: every-person-needs-seat

<!-- id: every-person-needs-seat -->
<!-- status: active -->
<!-- created: 2026-03-20 -->

**Statement**: Every person in the system must have a seat.
**Why**: Consistent permission model.
**Applies to**:
- pattern: src/**/Customer*
- keyword: contact person

**Enforcement grep**: \`ContactPersonBlock\`
**Origin**: wf-abc
`);
    const rules = rulesLib.listRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, 'every-person-needs-seat');
    assert.equal(rules[0].status, 'active');
    assert.ok(rules[0].statement.includes('Every person'));
    assert.equal(rules[0].enforcementGrep, 'ContactPersonBlock');

    const matches = rulesLib.matchRulesForFiles(['src/pages/CustomerDetail.tsx']);
    assert.equal(matches.length, 1, `expected 1 match, got ${matches.length}`);
    assert.equal(matches[0].id, 'every-person-needs-seat');
  });

  it('returns no matches when scope does not apply', () => {
    writeRules(`# Logic Rules

## RULE: scoped-rule

<!-- status: active -->

**Statement**: x
**Applies to**:
- pattern: src/**/Employee*
**Enforcement grep**: \`EmployeeThing\`
`);
    const matches = rulesLib.matchRulesForFiles(['src/pages/Customer.tsx']);
    assert.equal(matches.length, 0);
  });

  it('skips deprecated rules', () => {
    writeRules(`# Logic Rules

## RULE: old-rule

<!-- status: deprecated -->

**Statement**: old
**Applies to**:
- pattern: src/**
**Enforcement grep**: \`X\`
`);
    const matches = rulesLib.matchRulesForFiles(['src/foo.ts']);
    assert.equal(matches.length, 0);
  });
});
