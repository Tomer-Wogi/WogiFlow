'use strict';

/**
 * Tests for flow-worker-mcp-strip.js (audit-channel-transport-001 fix).
 *
 * Pin the regression: a worker member-repo .mcp.json containing the
 * `wogi-workspace-channel` server alongside other servers must produce
 * a channel-only config that preserves ONLY that server. Workers
 * without the channel server fall back to the empty config.
 *
 * This is the Tier-3-style verification that Story B should have had
 * but didn't: the strip pipeline preserves the transport.
 *
 * Run: node --test tests/flow-worker-mcp-strip.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CHANNEL_SERVER_NAME,
  extractChannelOnlyConfig,
  writeChannelOnlyConfig,
  preservesChannelTransport
} = require('../scripts/flow-worker-mcp-strip');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-strip-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});

function writeMcp(contents) {
  const p = path.join(tmpDir, '.mcp.json');
  fs.writeFileSync(p, JSON.stringify(contents, null, 2));
  return p;
}

describe('extractChannelOnlyConfig — preserves channel transport', () => {
  it('extracts only wogi-workspace-channel from a multi-server config', () => {
    const src = writeMcp({
      mcpServers: {
        'wogi-workspace-channel': {
          command: 'node',
          args: ['/path/to/workspace-channel-server.js'],
          env: { WOGI_CHANNEL_PORT: '8801', WOGI_REPO_NAME: 'frontend' }
        },
        'gmail': { command: 'gmail-mcp' },
        'atlassian': { command: 'atlassian-mcp' },
        'docker': { command: 'docker-mcp' }
      }
    });
    const cfg = extractChannelOnlyConfig(src);
    assert.deepEqual(Object.keys(cfg.mcpServers), [CHANNEL_SERVER_NAME]);
    assert.equal(cfg.mcpServers[CHANNEL_SERVER_NAME].args[0], '/path/to/workspace-channel-server.js');
    assert.equal(cfg.mcpServers[CHANNEL_SERVER_NAME].env.WOGI_CHANNEL_PORT, '8801');
  });

  it('returns empty config when source has no wogi-workspace-channel', () => {
    const src = writeMcp({
      mcpServers: { gmail: { command: 'gmail-mcp' } }
    });
    const cfg = extractChannelOnlyConfig(src);
    assert.deepEqual(cfg, { mcpServers: {} });
  });

  it('returns empty config when source file does not exist', () => {
    const cfg = extractChannelOnlyConfig(path.join(tmpDir, 'nonexistent.json'));
    assert.deepEqual(cfg, { mcpServers: {} });
  });

  it('returns empty config when source is malformed JSON', () => {
    const p = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(p, '{not valid json');
    const cfg = extractChannelOnlyConfig(p);
    assert.deepEqual(cfg, { mcpServers: {} });
  });

  it('returns empty config when source has no mcpServers field', () => {
    const src = writeMcp({ unrelatedField: true });
    const cfg = extractChannelOnlyConfig(src);
    assert.deepEqual(cfg, { mcpServers: {} });
  });

  it('returns empty config when source path is null/undefined', () => {
    assert.deepEqual(extractChannelOnlyConfig(null), { mcpServers: {} });
    assert.deepEqual(extractChannelOnlyConfig(undefined), { mcpServers: {} });
    assert.deepEqual(extractChannelOnlyConfig(123), { mcpServers: {} });
  });
});

describe('writeChannelOnlyConfig — atomic write', () => {
  it('writes the config and returns true', () => {
    const dest = path.join(tmpDir, 'state', 'worker-channel-only-mcp.json');
    const cfg = { mcpServers: { [CHANNEL_SERVER_NAME]: { command: 'x' } } };
    const ok = writeChannelOnlyConfig(dest, cfg);
    assert.equal(ok, true);
    const written = JSON.parse(fs.readFileSync(dest, 'utf-8'));
    assert.deepEqual(written, cfg);
  });

  it('creates intermediate directories', () => {
    const dest = path.join(tmpDir, 'a', 'b', 'c', 'mcp.json');
    const ok = writeChannelOnlyConfig(dest, { mcpServers: {} });
    assert.equal(ok, true);
    assert.equal(fs.existsSync(dest), true);
  });

  it('returns false when dest is invalid (no throw)', () => {
    assert.equal(writeChannelOnlyConfig(null, { mcpServers: {} }), false);
    assert.equal(writeChannelOnlyConfig('', { mcpServers: {} }), false);
  });
});

describe('preservesChannelTransport — diagnostic predicate', () => {
  it('returns true when wogi-workspace-channel is present', () => {
    assert.equal(
      preservesChannelTransport({ mcpServers: { [CHANNEL_SERVER_NAME]: { command: 'node' } } }),
      true
    );
  });

  it('returns false for empty config', () => {
    assert.equal(preservesChannelTransport({ mcpServers: {} }), false);
  });

  it('returns false for null/undefined', () => {
    assert.equal(preservesChannelTransport(null), false);
    assert.equal(preservesChannelTransport(undefined), false);
  });
});

describe('end-to-end strip pipeline (regression Tier-3)', () => {
  it('worker member repo with full .mcp.json → channel-only config preserves transport', () => {
    const src = writeMcp({
      mcpServers: {
        'wogi-workspace-channel': {
          command: 'node',
          args: ['/wf/lib/workspace-channel-server.js'],
          env: {
            WOGI_CHANNEL_PORT: '8801',
            WOGI_REPO_NAME: 'frontend',
            WOGI_PEERS: 'backend:8802,manager:8800',
            WOGI_WORKSPACE_ROOT: '/Users/x/wogi-hub',
            WOGI_MANAGER_PORT: '8800'
          }
        },
        'claude.ai-gmail': { command: 'gmail' },
        'claude.ai-slack': { command: 'slack' }
      }
    });
    const dest = path.join(tmpDir, 'state', 'worker-channel-only-mcp.json');

    const cfg = extractChannelOnlyConfig(src);
    const ok = writeChannelOnlyConfig(dest, cfg);

    assert.equal(ok, true);
    assert.equal(preservesChannelTransport(cfg), true);

    // Read what would actually be passed to claude --mcp-config:
    const actualConfig = JSON.parse(fs.readFileSync(dest, 'utf-8'));
    const servers = Object.keys(actualConfig.mcpServers);
    assert.deepEqual(servers, ['wogi-workspace-channel']);

    // Worker boot speed preserved (claude.ai integrations excluded):
    assert.equal(actualConfig.mcpServers['claude.ai-gmail'], undefined);
    assert.equal(actualConfig.mcpServers['claude.ai-slack'], undefined);

    // Channel transport preserved (manager dispatch will reach this worker):
    assert.equal(actualConfig.mcpServers[CHANNEL_SERVER_NAME].env.WOGI_CHANNEL_PORT, '8801');
    assert.equal(actualConfig.mcpServers[CHANNEL_SERVER_NAME].env.WOGI_REPO_NAME, 'frontend');
  });

  it('non-workspace worker (no .mcp.json) → empty config (graceful fallback)', () => {
    const src = path.join(tmpDir, 'no-mcp-here.json');
    const dest = path.join(tmpDir, 'state', 'worker-channel-only-mcp.json');
    const cfg = extractChannelOnlyConfig(src);
    const ok = writeChannelOnlyConfig(dest, cfg);
    assert.equal(ok, true);
    assert.equal(preservesChannelTransport(cfg), false);
    const actual = JSON.parse(fs.readFileSync(dest, 'utf-8'));
    assert.deepEqual(actual, { mcpServers: {} });
  });
});
