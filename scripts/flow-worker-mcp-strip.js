#!/usr/bin/env node

/**
 * Wogi Flow — Worker MCP Strip Helper
 *
 * Generates a channel-only MCP config for worker boot. This is the proper
 * fix for the audit-channel-transport-001 regression: Story A originally
 * wrote `{"mcpServers":{}}` (fully empty) for boot speed, which silently
 * stripped the `wogi-workspace-channel` MCP server — leaving manager-side
 * `workspace_send_message` HTTP-POSTs unable to reach the worker.
 *
 * This script reads the worker member-repo's real `.mcp.json`, extracts
 * ONLY the `wogi-workspace-channel` entry, and writes a channel-only
 * config to a destination path. Result:
 *   - claude.ai MCP integrations remain stripped (Story A's boot-speed win)
 *   - The workspace transport remains active (manager dispatch works)
 *
 * Fallback: if the source `.mcp.json` doesn't define
 * `wogi-workspace-channel` (e.g. the worker isn't a workspace member),
 * the destination is written with `{"mcpServers":{}}` — harmless in
 * non-workspace contexts.
 *
 * Usage:
 *   node flow-worker-mcp-strip.js <source-mcp.json> <dest-mcp.json>
 *
 * Programmatic:
 *   const { extractChannelOnlyConfig, writeChannelOnlyConfig } =
 *     require('./flow-worker-mcp-strip');
 *   const cfg = extractChannelOnlyConfig(srcPath);
 *   writeChannelOnlyConfig(destPath, cfg);
 *
 * Exit codes:
 *   0 — success (channel-only or empty config written)
 *   1 — write failure (caller should fall back to no-strip)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHANNEL_SERVER_NAME = 'wogi-workspace-channel';

/**
 * Read the source `.mcp.json` and return the channel-only config object.
 * Never throws; returns the empty-config fallback on any failure.
 */
function extractChannelOnlyConfig(sourcePath) {
  const empty = { mcpServers: {} };
  if (!sourcePath || typeof sourcePath !== 'string') return empty;
  try {
    if (!fs.existsSync(sourcePath)) return empty;
    const raw = fs.readFileSync(sourcePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) return empty;
    const entry = parsed.mcpServers[CHANNEL_SERVER_NAME];
    if (!entry || typeof entry !== 'object') return empty;
    return { mcpServers: { [CHANNEL_SERVER_NAME]: entry } };
  } catch (_err) {
    return empty;
  }
}

/**
 * Atomically write the channel-only config to destPath. Returns true on
 * success, false on failure (caller should fall back).
 */
function writeChannelOnlyConfig(destPath, config) {
  if (!destPath || typeof destPath !== 'string') return false;
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = `${destPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmp, destPath);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Whether the resulting config preserves the channel transport (i.e. the
 * worker will be reachable from the manager). Useful for callers that want
 * to log a warning if dispatch will silently fail.
 */
function preservesChannelTransport(config) {
  return Boolean(
    config &&
    config.mcpServers &&
    config.mcpServers[CHANNEL_SERVER_NAME] &&
    typeof config.mcpServers[CHANNEL_SERVER_NAME] === 'object'
  );
}

module.exports = {
  CHANNEL_SERVER_NAME,
  extractChannelOnlyConfig,
  writeChannelOnlyConfig,
  preservesChannelTransport
};

if (require.main === module) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    process.stderr.write('Usage: flow-worker-mcp-strip <source-mcp.json> <dest-mcp.json>\n');
    process.exit(1);
  }
  const cfg = extractChannelOnlyConfig(src);
  const ok = writeChannelOnlyConfig(dest, cfg);
  if (!ok) {
    process.stderr.write(`[flow-worker-mcp-strip] failed to write ${dest}\n`);
    process.exit(1);
  }
  if (!preservesChannelTransport(cfg)) {
    process.stderr.write(
      `[flow-worker-mcp-strip] WARNING: ${src} did not define ${CHANNEL_SERVER_NAME} — ` +
      `worker will boot but manager dispatch will fail. ` +
      `Run "flow workspace init" in the workspace root to regenerate .mcp.json.\n`
    );
  }
  process.exit(0);
}
