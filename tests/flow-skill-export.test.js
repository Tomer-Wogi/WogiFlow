'use strict';

/**
 * Tests for lib/skill-export-agentskills.js + lib/skill-export-claude-plugin.js
 * + scripts/flow-skill-export.js (Phase 1B — wf-0342fc33).
 *
 * Covers:
 *   - Round-trip serialization to agentskills@v1 has all required fields.
 *   - Round-trip serialization to claude-plugin format has plugin.json + skill files.
 *   - `flow skill export` refuses (ok:false) when portability fails.
 *   - Schema-version pin: agentskills output has schemaVersion === 'agentskills@v1'.
 *   - Output writer creates files on disk under outDir.
 *
 * Run: NODE_ENV=test node --test tests/flow-skill-export.test.js
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
  exportToAgentskills,
  AGENTSKILLS_SCHEMA_VERSION,
} = require('../lib/skill-export-agentskills');
const {
  exportToClaudePlugin,
} = require('../lib/skill-export-claude-plugin');
const {
  runExport,
  SUPPORTED_FORMATS,
  parseArgs,
} = require('../scripts/flow-skill-export');

// ============================================================
// Test harness
// ============================================================

let TMP_ROOT;

function setupTmp() {
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-export-test-'));
}

function teardownTmp() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch (_err) { /* ignore */ }
}

const PORTABLE_SKILL_MD = `---
name: example
version: 2.1.3
description: A clean portable skill
license: MIT
compatibility: Claude Code 2.1+
user-invocable: true
portable: true
---

# Example Skill

This is the body.

## When to Use
- Whenever
`;

function makePortableSkill(name = 'example', body = PORTABLE_SKILL_MD, extras = {}) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'skill.md'), body, 'utf-8');
  for (const [rel, content] of Object.entries(extras)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return dir;
}

function makeNonPortableSkill(name = 'bad') {
  return makePortableSkill(name, `---
name: ${name}
version: 1.0.0
description: References WogiFlow state
license: MIT
---

# Bad

Reads .workflow/state/ready.json then runs /wogi-start.
`);
}

// ============================================================
// exportToAgentskills — manifest shape
// ============================================================

describe('exportToAgentskills — manifest shape (round-trip)', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('produces an agentskills@v1 manifest with all required fields', () => {
    const dir = makePortableSkill('example', PORTABLE_SKILL_MD, {
      'knowledge/learnings.md': '# Learnings\n',
    });
    const { manifest, files } = exportToAgentskills(dir);

    // Schema version pin
    assert.equal(manifest.schemaVersion, 'agentskills@v1');
    assert.equal(manifest.schemaVersion, AGENTSKILLS_SCHEMA_VERSION);

    // Core required fields
    assert.equal(manifest.name, 'example');
    assert.equal(manifest.version, '2.1.3');
    assert.equal(manifest.description, 'A clean portable skill');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.compatibility, 'Claude Code 2.1+');
    assert.ok(typeof manifest.instructions === 'string'
      && manifest.instructions.length > 0,
      'manifest.instructions should be the post-frontmatter body');
    assert.equal(manifest.instructions.includes('# Example Skill'), true);
    assert.ok(Array.isArray(manifest.files));
    assert.deepEqual(manifest.dependencies, []);

    // Source provenance present
    assert.equal(typeof manifest.source, 'object');
    assert.equal(manifest.source.type, 'wogiflow');

    // Files: at least skill.md + learnings.md
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('skill.md'));
    assert.ok(paths.includes('knowledge/learnings.md'));
    // Round-trip: every file in manifest.files matches a file in files[]
    assert.deepEqual(manifest.files.sort(), paths);
  });

  it('JSON-serializes and parses back without loss', () => {
    const dir = makePortableSkill();
    const { manifest } = exportToAgentskills(dir);
    const serialized = JSON.stringify(manifest);
    const reparsed = JSON.parse(serialized);
    assert.equal(reparsed.schemaVersion, 'agentskills@v1');
    assert.equal(reparsed.name, manifest.name);
    assert.equal(reparsed.version, manifest.version);
    assert.equal(reparsed.instructions, manifest.instructions);
  });

  it('respects opts.name / opts.version / opts.sourceUrl', () => {
    const dir = makePortableSkill();
    const { manifest } = exportToAgentskills(dir, {
      name: 'override-name',
      version: '9.9.9',
      sourceUrl: 'https://example.com/x',
    });
    assert.equal(manifest.name, 'override-name');
    assert.equal(manifest.version, '9.9.9');
    assert.equal(manifest.source.url, 'https://example.com/x');
  });

  it('falls back to dir basename when frontmatter is missing name', () => {
    const dir = makePortableSkill('basename-test', `---
version: 1.0.0
description: No name field
---

body
`);
    const { manifest } = exportToAgentskills(dir);
    assert.equal(manifest.name, 'basename-test');
  });
});

// ============================================================
// exportToClaudePlugin — manifest shape + layout
// ============================================================

describe('exportToClaudePlugin — manifest shape (round-trip)', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('produces a Claude Code plugin manifest at .claude-plugin/plugin.json', () => {
    const dir = makePortableSkill('plugin-x', PORTABLE_SKILL_MD, {
      'knowledge/learnings.md': '# learnings\n',
    });
    const { manifest, files } = exportToClaudePlugin(dir);

    assert.equal(manifest.name, 'example'); // from frontmatter
    assert.equal(manifest.version, '2.1.3');
    assert.equal(manifest.description, 'A clean portable skill');
    assert.equal(manifest.license, 'MIT');
    assert.equal(typeof manifest.author, 'object');
    assert.equal(typeof manifest.author.name, 'string');

    // plugin.json must be in files at .claude-plugin/plugin.json
    const pluginJson = files.find((f) => f.path === '.claude-plugin/plugin.json');
    assert.ok(pluginJson, 'expected .claude-plugin/plugin.json in files');
    const reparsed = JSON.parse(pluginJson.content);
    assert.equal(reparsed.name, manifest.name);
    assert.equal(reparsed.version, manifest.version);

    // skill.md normalized to SKILL.md under skills/<name>/
    const skillFile = files.find((f) => f.path === `skills/${manifest.name}/SKILL.md`);
    assert.ok(skillFile, `expected skills/${manifest.name}/SKILL.md`);
    assert.ok(skillFile.content.includes('# Example Skill'));

    // Aux file preserved
    const aux = files.find((f) =>
      f.path === `skills/${manifest.name}/knowledge/learnings.md`);
    assert.ok(aux, 'expected knowledge file under skills/<name>/');
  });

  it('respects opts.author / opts.name / opts.version', () => {
    const dir = makePortableSkill();
    const { manifest } = exportToClaudePlugin(dir, {
      name: 'custom',
      version: '0.5.0',
      author: 'Acme Co.',
    });
    assert.equal(manifest.name, 'custom');
    assert.equal(manifest.version, '0.5.0');
    assert.equal(manifest.author.name, 'Acme Co.');
  });
});

// ============================================================
// runExport — refuses on portability failure
// ============================================================

describe('runExport — portability gate', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('refuses (ok: false) when the skill is not portable', () => {
    const dir = makeNonPortableSkill('bad');
    const result = runExport({
      skillName: 'bad',
      skillDir: dir,
      format: 'agentskills@v1',
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not portable'),
      `expected "not portable" in error, got: ${result.error}`);
    assert.ok(result.portability);
    assert.equal(result.portability.portable, false);
    assert.ok(result.portability.blockers.length >= 1);
  });

  it('refuses on portability failure for claude-plugin too', () => {
    const dir = makeNonPortableSkill('bad2');
    const result = runExport({
      skillName: 'bad2',
      skillDir: dir,
      format: 'claude-plugin',
    });
    assert.equal(result.ok, false);
    assert.equal(result.portability.portable, false);
  });

  it('succeeds (ok: true) for a portable skill', () => {
    const dir = makePortableSkill('good');
    const result = runExport({
      skillName: 'good',
      skillDir: dir,
      format: 'agentskills@v1',
    });
    assert.equal(result.ok, true);
    assert.equal(result.bundle.manifest.schemaVersion, 'agentskills@v1');
  });

  it('reports an error on an unsupported format', () => {
    const dir = makePortableSkill('good');
    const result = runExport({
      skillName: 'good',
      skillDir: dir,
      format: 'bogus-format',
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Unsupported format'));
  });

  it('reports an error when the skill directory is missing', () => {
    const result = runExport({
      skillName: 'missing',
      skillDir: path.join(TMP_ROOT, 'does-not-exist'),
      format: 'agentskills@v1',
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });
});

// ============================================================
// runExport — disk write
// ============================================================

describe('runExport — disk write', () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  it('writes manifest.json + bundled files to outDir for agentskills@v1', () => {
    const dir = makePortableSkill('write-test', PORTABLE_SKILL_MD, {
      'knowledge/k.md': '# k\n',
    });
    const outDir = path.join(TMP_ROOT, 'out');
    const result = runExport({
      skillName: 'write-test',
      skillDir: dir,
      format: 'agentskills@v1',
      outDir,
    });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(outDir, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'skill.md')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'knowledge', 'k.md')), true);

    // Round-trip: read manifest.json off disk and verify schema pin
    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    assert.equal(onDisk.schemaVersion, 'agentskills@v1');
    assert.equal(onDisk.name, 'example');
  });

  it('writes .claude-plugin/plugin.json + skills/<name>/SKILL.md for claude-plugin', () => {
    const dir = makePortableSkill('plugin-out');
    const outDir = path.join(TMP_ROOT, 'plugout');
    const result = runExport({
      skillName: 'plugin-out',
      skillDir: dir,
      format: 'claude-plugin',
      outDir,
    });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(outDir, '.claude-plugin', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'skills', 'example', 'SKILL.md')), true);

    const pluginManifest = JSON.parse(fs.readFileSync(
      path.join(outDir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    assert.equal(pluginManifest.name, 'example');
    assert.equal(pluginManifest.version, '2.1.3');
  });

  it('refuses to overwrite an existing outDir without --force', () => {
    const dir = makePortableSkill('overwrite-test');
    const outDir = path.join(TMP_ROOT, 'pre-existing');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'sentinel.txt'), 'do not lose me', 'utf-8');

    const result = runExport({
      skillName: 'overwrite-test',
      skillDir: dir,
      format: 'agentskills@v1',
      outDir,
      force: false,
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('exists'));
    // Sentinel preserved
    assert.equal(fs.existsSync(path.join(outDir, 'sentinel.txt')), true);
  });

  it('overwrites when --force is set', () => {
    const dir = makePortableSkill('overwrite-force');
    const outDir = path.join(TMP_ROOT, 'force-out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'old.txt'), 'old', 'utf-8');

    const result = runExport({
      skillName: 'overwrite-force',
      skillDir: dir,
      format: 'agentskills@v1',
      outDir,
      force: true,
    });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(outDir, 'manifest.json')), true);
  });
});

// ============================================================
// CLI arg parsing
// ============================================================

describe('parseArgs', () => {
  it('parses positional name and --format / --out as flags', () => {
    const opts = parseArgs(['my-skill', '--format=claude-plugin', '--out=/tmp/x']);
    assert.equal(opts.name, 'my-skill');
    assert.equal(opts.format, 'claude-plugin');
    assert.equal(opts.out, '/tmp/x');
  });

  it('parses --format and --out with space separator', () => {
    const opts = parseArgs(['my-skill', '--format', 'claude-plugin', '--out', '/tmp/y']);
    assert.equal(opts.format, 'claude-plugin');
    assert.equal(opts.out, '/tmp/y');
  });

  it('defaults format to agentskills@v1', () => {
    const opts = parseArgs(['my-skill']);
    assert.equal(opts.format, 'agentskills@v1');
  });

  it('sets help on --help / -h', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
  });

  it('sets force on --force / -f', () => {
    assert.equal(parseArgs(['x', '--force']).force, true);
    assert.equal(parseArgs(['x', '-f']).force, true);
  });

  it('throws when --format is provided without value', () => {
    assert.throws(() => parseArgs(['x', '--format']));
  });
});

// ============================================================
// SUPPORTED_FORMATS sanity
// ============================================================

describe('SUPPORTED_FORMATS', () => {
  it('exposes both formats', () => {
    assert.ok(SUPPORTED_FORMATS.has('agentskills@v1'));
    assert.ok(SUPPORTED_FORMATS.has('claude-plugin'));
  });
});
