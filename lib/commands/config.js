'use strict';

/**
 * `flow config` — inspect and compact the project's .workflow/config.json.
 *
 * Subcommands:
 *   flow config show          Show the current (on-disk) config as written
 *   flow config show --full   Show the fully-merged config (defaults + overrides)
 *   flow config show --diff   Show only the keys this project overrides
 *   flow config compact       Rewrite config.json to lean form (overrides only)
 *   flow config compact --dry Preview the compacted form without writing
 *
 * Added in v2.19.0 alongside the lean-config-on-init change. See
 * `lib/installer.js` `buildLeanInstallConfig()` for the write-time counterpart.
 */

const fs = require('node:fs');
const path = require('node:path');

function resolveProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.workflow', 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Not in a WogiFlow project (no .workflow/config.json found)');
}

function readProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return { configPath, raw, parsed: JSON.parse(raw) };
}

function configCommand(args) {
  const sub = args[0];
  const flags = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }

  const projectRoot = resolveProjectRoot();

  if (sub === 'show') {
    return showConfig(projectRoot, flags);
  }

  if (sub === 'compact') {
    return compactConfig(projectRoot, flags);
  }

  console.error(`Unknown config subcommand: ${sub}`);
  printHelp();
  process.exit(1);
}

function showConfig(projectRoot, flags) {
  const { configPath, parsed } = readProjectConfig(projectRoot);
  const { mergeWithDefaults, computeLeanConfig } = require('../../scripts/flow-config-defaults');

  if (flags.includes('--full')) {
    const merged = mergeWithDefaults(parsed);
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  if (flags.includes('--diff')) {
    const merged = mergeWithDefaults(parsed);
    const lean = computeLeanConfig(merged);
    console.log(JSON.stringify(lean, null, 2));
    return;
  }

  // Default: show what's on disk.
  const relPath = path.relative(projectRoot, configPath);
  console.log(`# ${relPath} (on disk — ${Object.keys(parsed).length} top-level keys)`);
  console.log(JSON.stringify(parsed, null, 2));
  console.log('');
  console.log('# Tips:');
  console.log('#   flow config show --full   see the fully-merged config (defaults + overrides)');
  console.log('#   flow config show --diff   see only the keys this project overrides');
  console.log('#   flow config compact       shrink this file to overrides-only');
}

function compactConfig(projectRoot, flags) {
  const { configPath, parsed } = readProjectConfig(projectRoot);
  const { mergeWithDefaults, computeLeanConfig } = require('../../scripts/flow-config-defaults');

  // mergeWithDefaults → computeLeanConfig round-trip produces the canonical
  // lean form. Doing it via merge-first ensures any keys that used to have
  // non-default values but now match a new default get correctly removed.
  const merged = mergeWithDefaults(parsed);
  const lean = computeLeanConfig(merged);

  const beforeBytes = JSON.stringify(parsed, null, 2).length;
  const afterBytes = JSON.stringify(lean, null, 2).length;
  const savedPct = beforeBytes > 0 ? Math.round(((beforeBytes - afterBytes) / beforeBytes) * 100) : 0;

  if (flags.includes('--dry') || flags.includes('--dry-run')) {
    console.log('# Preview — would write:');
    console.log(JSON.stringify(lean, null, 2));
    console.log('');
    console.log(`# Before: ${beforeBytes} bytes, ${Object.keys(parsed).length} top-level keys`);
    console.log(`# After:  ${afterBytes} bytes, ${Object.keys(lean).length} top-level keys (-${savedPct}%)`);
    console.log('# Run without --dry to apply.');
    return;
  }

  // Backup first — compaction is reversible, but cheap insurance is free.
  const backupPath = `${configPath}.bak-${Date.now()}`;
  fs.copyFileSync(configPath, backupPath);

  fs.writeFileSync(configPath, JSON.stringify(lean, null, 2) + '\n');

  console.log(`✓ Compacted ${path.relative(projectRoot, configPath)}`);
  console.log(`  Before: ${beforeBytes} bytes, ${Object.keys(parsed).length} top-level keys`);
  console.log(`  After:  ${afterBytes} bytes, ${Object.keys(lean).length} top-level keys (-${savedPct}%)`);
  console.log(`  Backup: ${path.relative(projectRoot, backupPath)}`);
  console.log('');
  console.log('Runtime behavior is unchanged — defaults merge in at read time.');
  console.log('Verify with: flow config show --full');
}

function printHelp() {
  console.log(`Usage: flow config <subcommand> [flags]

Inspect and compact the project's .workflow/config.json.

Subcommands:
  show                  Show the current config as written on disk
  show --full           Show the fully-merged config (defaults + overrides)
  show --diff           Show only the keys this project overrides
  compact               Rewrite config.json to overrides-only form
  compact --dry         Preview the compacted form without writing

Why "lean" configs (v2.19.0+):
  The runtime config loader merges CONFIG_DEFAULTS on every read, so any key
  matching the default is redundant noise. New installs write lean configs by
  default. Existing fat configs still work identically — run 'flow config
  compact' to shrink them.
`);
}

module.exports = { configCommand, showConfig, compactConfig, resolveProjectRoot };
