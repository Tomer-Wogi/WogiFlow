'use strict';

/**
 * Tests for lib/skill-portability.js (Phase 1B — wf-0342fc33).
 *
 * Covers: clean skill is portable, .workflow/state reference blocks,
 * /wogi-* slash command blocks, flow-utils import blocks, blocker citations
 * include file:line, manifest portable:false short-circuits, missing skill.md.
 *
 * Run: NODE_ENV=test node --test tests/flow-skill-portability.test.js
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

const {
  assessSkillPortability,
  formatBlockers,
  parseFrontmatter,
} = require('../lib/skill-portability');

// ============================================================
// Test harness — tmpdir skill scaffolding
// ============================================================

let TMP_ROOT;

function setupTmp() {
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-portability-test-'));
}

function teardownTmp() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch (_err) { /* ignore */ }
}

/**
 * Write a skill into the tmpdir.
 *
 * @param {string} name
 * @param {string} skillMdBody
 * @param {Object} [extraFiles] - { 'knowledge/learnings.md': 'body', ... }
 * @returns {string} absolute path to skill dir
 */
function makeSkill(name, skillMdBody, extraFiles = {}) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'skill.md'), skillMdBody, 'utf-8');
  for (const [rel, body] of Object.entries(extraFiles)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body, 'utf-8');
  }
  return dir;
}

const PORTABLE_FRONTMATTER = `---
name: clean-skill
version: 1.0.0
description: A skill with no WogiFlow-specific references
license: MIT
portable: true
---

# Clean Skill

This skill talks about git commits and code review. Nothing project-specific.

## When to Use
- Composing commit messages
- Reviewing pull requests
`;

// ============================================================
// assessSkillPortability — clean skill case
// ============================================================

describe('assessSkillPortability — clean skill', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('returns portable: true for a skill with no WogiFlow references', () => {
    const dir = makeSkill('clean', PORTABLE_FRONTMATTER, {
      'knowledge/examples.md': '# Examples\n\nA simple example.\n',
    });
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.skillMdPath, path.join(dir, 'skill.md'));
    assert.equal(result.manifest.name, 'clean-skill');
    assert.equal(result.manifest.portable, 'true');
  });

  it('scans nested directories and counts scanned files', () => {
    const dir = makeSkill('clean', PORTABLE_FRONTMATTER, {
      'knowledge/a.md': '# A\n',
      'knowledge/b.md': '# B\n',
      'templates/t.template': 'template body\n',
    });
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, true);
    assert.ok(result.scannedFiles.length >= 3,
      `expected ≥3 scanned files, got ${result.scannedFiles.length}`);
  });
});

// ============================================================
// assessSkillPortability — .workflow/state reference blocks
// ============================================================

describe('assessSkillPortability — .workflow/state reference', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('blocks when skill.md references .workflow/state/', () => {
    const skillMd = `---
name: bad-skill
version: 1.0.0
description: References WogiFlow state files
license: MIT
---

# Bad Skill

This skill reads .workflow/state/ready.json directly. That's project-specific.
`;
    const dir = makeSkill('bad', skillMd);
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    assert.ok(result.blockers.length >= 1, 'expected at least one blocker');

    // Citation accuracy: at least one blocker cites skill.md with a line >= 1
    const stateBlocker = result.blockers.find((b) =>
      b.label.includes('wogiflow-state-path'));
    assert.ok(stateBlocker, 'expected a wogiflow-state-path blocker');
    assert.equal(stateBlocker.file, 'skill.md');
    assert.ok(stateBlocker.line >= 1, 'expected line >= 1');
    assert.ok(stateBlocker.match.includes('.workflow/'),
      `expected match to contain .workflow/, got "${stateBlocker.match}"`);
  });

  it('blocks when an auxiliary file references .workflow/', () => {
    const dir = makeSkill('bad-aux', PORTABLE_FRONTMATTER, {
      'knowledge/notes.md': '# Notes\n\nLook at .workflow/state/decisions.md for context.\n',
    });
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    // Two blockers expected: .workflow/ + decisions.md
    assert.ok(result.blockers.some((b) => b.file === 'knowledge/notes.md'),
      'expected blocker citing knowledge/notes.md');
  });
});

// ============================================================
// assessSkillPortability — /wogi-* slash command blocks
// ============================================================

describe('assessSkillPortability — /wogi-* slash command', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('blocks when skill.md invokes a /wogi-* slash command', () => {
    const skillMd = `---
name: bad-slash
version: 1.0.0
description: Invokes a WogiFlow slash command
license: MIT
---

# Bad Slash Skill

To finalize this work, run /wogi-finalize and let it merge.
`;
    const dir = makeSkill('bad-slash', skillMd);
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    const slashBlocker = result.blockers.find((b) =>
      b.label === '/wogi-* slash command');
    assert.ok(slashBlocker, 'expected a /wogi-* slash command blocker');
    assert.equal(slashBlocker.match, '/wogi-finalize');
  });

  it('does not block on non-wogi slash commands', () => {
    const skillMd = `---
name: ok-slash
version: 1.0.0
description: References generic slash commands
license: MIT
---

# OK Slash Skill

Run /help or /status — these are generic Claude Code commands, not WogiFlow.
`;
    const dir = makeSkill('ok-slash', skillMd);
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, true);
  });
});

// ============================================================
// assessSkillPortability — flow-utils import blocks
// ============================================================

describe('assessSkillPortability — flow-utils import', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('blocks when skill content references flow-utils', () => {
    const skillMd = `---
name: bad-util
version: 1.0.0
description: Pulls from flow-utils
license: MIT
---

# Bad Util Skill

Import safeJsonParse from flow-utils to read configs.
`;
    const dir = makeSkill('bad-util', skillMd);
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    const utilBlocker = result.blockers.find((b) =>
      b.label === 'flow-utils import/reference');
    assert.ok(utilBlocker, 'expected a flow-utils blocker');
  });
});

// ============================================================
// assessSkillPortability — manifest portable: false short-circuit
// ============================================================

describe('assessSkillPortability — manifest portable: false', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('treats portable: false as a blocker even when scan finds nothing', () => {
    const skillMd = `---
name: opt-out
version: 1.0.0
description: Author opted out of portability
license: MIT
portable: false
---

# Opt-out Skill

No references here, but the author knows there's an implicit dependency.
`;
    const dir = makeSkill('opt-out', skillMd);
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    const optOut = result.blockers.find((b) =>
      b.label === 'manifest declares portable: false');
    assert.ok(optOut, 'expected the explicit opt-out blocker');
  });
});

// ============================================================
// assessSkillPortability — edge cases
// ============================================================

describe('assessSkillPortability — edge cases', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('returns a blocker when skill.md is missing', () => {
    const dir = path.join(TMP_ROOT, 'no-skill-md');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'no skill.md here', 'utf-8');
    const result = assessSkillPortability(dir);
    assert.equal(result.portable, false);
    assert.ok(result.blockers.some((b) => b.label.includes('skill.md not found')));
  });

  it('returns a blocker when the directory does not exist', () => {
    const result = assessSkillPortability(path.join(TMP_ROOT, 'does-not-exist'));
    assert.equal(result.portable, false);
    assert.ok(result.blockers.some((b) =>
      b.label === 'skill directory does not exist'));
  });

  it('returns a blocker when the path is a file, not a directory', () => {
    const filePath = path.join(TMP_ROOT, 'a.txt');
    fs.writeFileSync(filePath, 'just a file', 'utf-8');
    const result = assessSkillPortability(filePath);
    assert.equal(result.portable, false);
    assert.ok(result.blockers.some((b) => b.label === 'skill path is not a directory'));
  });

  it('returns a blocker on empty input path', () => {
    const result = assessSkillPortability('');
    assert.equal(result.portable, false);
    assert.ok(result.blockers.length >= 1);
  });
});

// ============================================================
// formatBlockers
// ============================================================

describe('formatBlockers', () => {
  it('returns a "no blockers" line for empty input', () => {
    assert.equal(formatBlockers([]), 'No portability blockers found.');
    assert.equal(formatBlockers(null), 'No portability blockers found.');
  });

  it('formats a multi-blocker list with citations', () => {
    const out = formatBlockers([
      { file: 'skill.md', line: 12, match: '.workflow/', label: 'wogiflow-state-path' },
      { file: 'knowledge/a.md', line: 3, match: '/wogi-start', label: '/wogi-* slash command' },
    ]);
    assert.ok(out.includes('Found 2 portability blocker'));
    assert.ok(out.includes('skill.md:12'));
    assert.ok(out.includes('knowledge/a.md:3'));
    assert.ok(out.includes('/wogi-start'));
  });
});

// ============================================================
// parseFrontmatter (smoke test)
// ============================================================

describe('parseFrontmatter', () => {
  it('parses simple key:value pairs', () => {
    const content = `---
name: foo
version: 1.0.0
description: A skill with a colon: in the description
---

# body
`;
    const fm = parseFrontmatter(content);
    assert.equal(fm.name, 'foo');
    assert.equal(fm.version, '1.0.0');
    assert.equal(fm.description, 'A skill with a colon: in the description');
  });

  it('returns empty object when no frontmatter present', () => {
    assert.deepEqual(parseFrontmatter('# just a heading\n'), {});
  });

  it('blocks prototype-pollution keys', () => {
    const content = `---
name: ok
__proto__: bad
constructor: bad
prototype: bad
---

body
`;
    const fm = parseFrontmatter(content);
    assert.equal(fm.name, 'ok');
    // None of the dangerous keys should be own properties on the result.
    assert.equal(Object.prototype.hasOwnProperty.call(fm, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fm, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fm, 'prototype'), false);
  });
});
