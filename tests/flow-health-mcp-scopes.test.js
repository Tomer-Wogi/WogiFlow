'use strict';

/**
 * Tests for flow-health.js MCP scope duplicate detection.
 *
 * Covers: checkMcpScopes(), normalizeMcpConfig().
 * Mirrors Claude Code 2.1.110 /doctor warning for divergent MCP definitions
 * across user, project, and local settings scopes.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-health-mcp-scopes.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.argv = ['node', 'flow-health.js', 'status'];
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const { checkMcpScopes, normalizeMcpConfig } = require('../scripts/flow-health');

let tmpDir;
function writeScope(name, obj) {
  const file = path.join(tmpDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-health-mcp-'));
});

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
});

describe('normalizeMcpConfig', () => {
  it('returns equal strings for objects with reordered keys', () => {
    const a = { command: 'node', args: ['a.js'], env: { A: '1', B: '2' } };
    const b = { env: { B: '2', A: '1' }, args: ['a.js'], command: 'node' };
    assert.equal(normalizeMcpConfig(a), normalizeMcpConfig(b));
  });

  it('returns different strings when arg order differs (order is significant)', () => {
    const a = { command: 'node', args: ['a', 'b'] };
    const b = { command: 'node', args: ['b', 'a'] };
    assert.notEqual(normalizeMcpConfig(a), normalizeMcpConfig(b));
  });

  it('returns different strings when values differ', () => {
    const a = { command: 'node', url: 'http://a' };
    const b = { command: 'node', url: 'http://b' };
    assert.notEqual(normalizeMcpConfig(a), normalizeMcpConfig(b));
  });

  it('handles null and primitives', () => {
    assert.equal(normalizeMcpConfig(null), JSON.stringify(null));
    assert.equal(normalizeMcpConfig('x'), JSON.stringify('x'));
  });
});

describe('checkMcpScopes', () => {
  it('reports zero servers when no scope files exist', () => {
    const result = checkMcpScopes({
      userSettingsPath: path.join(tmpDir, 'missing-user.json'),
      projectSettingsPath: path.join(tmpDir, 'missing-project.json'),
      localSettingsPath: path.join(tmpDir, 'missing-local.json')
    });
    assert.equal(result.uniqueServers, 0);
    assert.equal(result.duplicates.length, 0);
    assert.equal(result.parseErrors.length, 0);
    assert.equal(result.scopesChecked, 0);
  });

  it('reports no duplicates when the same server is defined identically in two scopes', () => {
    const identicalCfg = { command: 'node', args: ['server.js'] };
    const userFile = writeScope('user-ident', { mcpServers: { memory: identicalCfg } });
    const projectFile = writeScope('project-ident', { mcpServers: { memory: { args: ['server.js'], command: 'node' } } });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 0, 'identical configs should not be flagged');
    assert.equal(result.uniqueServers, 1);
    assert.equal(result.scopesChecked, 2);
  });

  it('flags a server with divergent config across user and project scopes', () => {
    const userFile = writeScope('user-div', { mcpServers: { figma: { url: 'http://localhost:3000' } } });
    const projectFile = writeScope('project-div', { mcpServers: { figma: { url: 'http://localhost:9999' } } });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].name, 'figma');
    assert.deepEqual(result.duplicates[0].scopes, ['user', 'project']);
  });

  it('flags divergent configs across all three scopes', () => {
    const userFile = writeScope('user-3', { mcpServers: { atlassian: { url: 'http://u' } } });
    const projectFile = writeScope('project-3', { mcpServers: { atlassian: { url: 'http://p' } } });
    const localFile = writeScope('local-3', { mcpServers: { atlassian: { url: 'http://l' } } });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: localFile
    });
    assert.equal(result.duplicates.length, 1);
    assert.deepEqual(result.duplicates[0].scopes, ['user', 'project', 'local']);
  });

  it('ignores non-conflicting unique servers even when scopes overlap on a different server', () => {
    const userFile = writeScope('user-mixed', { mcpServers: { figma: { url: 'http://a' }, memory: { command: 'm' } } });
    const projectFile = writeScope('project-mixed', { mcpServers: { figma: { url: 'http://b' }, gmail: { command: 'g' } } });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 1, 'only figma diverges');
    assert.equal(result.duplicates[0].name, 'figma');
    assert.equal(result.uniqueServers, 3, 'figma + memory + gmail');
  });

  it('tolerates settings files with no mcpServers field', () => {
    const userFile = writeScope('user-nomcp', { permissions: { allow: [] } });
    const projectFile = writeScope('project-nomcp', { mcpServers: { only: { command: 'x' } } });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 0);
    assert.equal(result.uniqueServers, 1);
    assert.equal(result.scopesChecked, 2);
  });

  it('tolerates mcpServers being null or an array (malformed)', () => {
    const userFile = writeScope('user-null', { mcpServers: null });
    const projectFile = writeScope('project-array', { mcpServers: [] });

    const result = checkMcpScopes({
      userSettingsPath: userFile,
      projectSettingsPath: projectFile,
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 0);
    assert.equal(result.uniqueServers, 0);
  });

  it('captures a parse error when a settings file has invalid JSON', () => {
    const badFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badFile, '{ invalid json');
    const result = checkMcpScopes({
      userSettingsPath: badFile,
      projectSettingsPath: path.join(tmpDir, 'missing.json'),
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 0);
    assert.equal(result.parseErrors.length, 1);
    assert.equal(result.parseErrors[0].file, badFile);
    assert.match(result.parseErrors[0].error, /invalid JSON/);
  });

  it('captures a parse error when settings file is valid JSON but a top-level array (safeJsonParse rejection)', () => {
    // safeJsonParse rejects non-object top-level JSON. The raw-read fallback
    // should categorize this as "rejected by safeJsonParse" since raw JSON.parse
    // would succeed on a top-level array.
    const arrayFile = path.join(tmpDir, 'array-toplevel.json');
    fs.writeFileSync(arrayFile, '[{"mcpServers": {"x": {}}}]');
    const result = checkMcpScopes({
      userSettingsPath: arrayFile,
      projectSettingsPath: path.join(tmpDir, 'missing.json'),
      localSettingsPath: path.join(tmpDir, 'missing.json')
    });
    assert.equal(result.duplicates.length, 0);
    assert.equal(result.parseErrors.length, 1);
    assert.match(result.parseErrors[0].error, /rejected by safeJsonParse|non-object/);
  });
});
