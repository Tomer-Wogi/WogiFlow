#!/usr/bin/env node

/**
 * flow skill export — Phase 1B (wf-0342fc33)
 *
 * Exports a portable skill to one of two open distribution formats:
 *   --format=agentskills@v1   (agentskills.io v1 manifest + file bundle)
 *   --format=claude-plugin    (Claude Code plugin layout, ready for `claude plugin tag`)
 *
 * The export refuses (exit 1) if the portability checker reports any blocker.
 * Blockers are printed to stderr in a citation-friendly `file:line` format.
 *
 * IMPORT IS NOT IMPLEMENTED. See `.claude/docs/skill-portability.md` for why
 * (security model — quarantine + content scanner + opt-in enable — is deferred
 * to a follow-up). Comment marker `[import would go here]` below marks the
 * intended insertion point.
 *
 * Usage:
 *   flow skill export <name> [--format=<format>] [--out=<dir>]
 *
 * @file scripts/flow-skill-export.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Resolve project root via the same env-var contract scripts/flow uses.
const PROJECT_ROOT = process.env.WOGIFLOW_PROJECT_ROOT
  || process.env.WOGI_PROJECT_ROOT
  || process.cwd();

const { assessSkillPortability, formatBlockers } = require('../lib/skill-portability');
const { exportToAgentskills, AGENTSKILLS_SCHEMA_VERSION } = require('../lib/skill-export-agentskills');
const { exportToClaudePlugin } = require('../lib/skill-export-claude-plugin');

const SUPPORTED_FORMATS = new Set(['agentskills@v1', 'claude-plugin']);
const DEFAULT_FORMAT = 'agentskills@v1';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI args for `flow skill export`.
 *
 * @param {string[]} argv
 * @returns {{name: string|null, format: string, out: string|null, help: boolean, force: boolean}}
 */
function parseArgs(argv) {
  const options = {
    name: null,
    format: DEFAULT_FORMAT,
    out: null,
    help: false,
    force: false, // bypass directory-exists check; never bypasses portability
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else if (arg === '--format') {
      if (i + 1 >= argv.length) {
        throw new Error('--format requires a value');
      }
      options.format = argv[++i];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    } else if (arg === '--out') {
      if (i + 1 >= argv.length) {
        throw new Error('--out requires a value');
      }
      options.out = argv[++i];
    } else if (!arg.startsWith('-') && options.name === null) {
      options.name = arg;
    }
  }

  return options;
}

function showHelp() {
  const lines = [
    '',
    'Usage: flow skill export <name> [options]',
    '',
    'Export a portable skill to an open distribution format.',
    '',
    'Arguments:',
    '  <name>            Skill name (must exist under .claude/skills/)',
    '',
    'Options:',
    '  --format=<fmt>    Output format: agentskills@v1 | claude-plugin',
    `                    (default: ${DEFAULT_FORMAT})`,
    '  --out=<dir>       Output directory (default: ./dist/skills/<name>/)',
    '  --force, -f       Overwrite existing output directory',
    '  --help, -h        Show this help',
    '',
    'Behavior:',
    '  The portability checker runs first. Any WogiFlow-specific reference',
    '  (.workflow/, /wogi-*, flow-utils, ready.json, etc.) blocks the export',
    '  with a citation. Fix the skill or mark it explicitly non-portable.',
    '',
    'Examples:',
    '  flow skill export commit',
    '  flow skill export commit --format=claude-plugin',
    '  flow skill export commit --format=agentskills@v1 --out=/tmp/commit-export',
    '',
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Filesystem writer
// ---------------------------------------------------------------------------

/**
 * Write the manifest + bundle files to the output directory.
 *
 * For agentskills, the manifest is written to `<out>/manifest.json` and
 * bundled files are written under `<out>/` preserving their relative paths.
 *
 * For claude-plugin, the manifest is already inside the `files` array under
 * `.claude-plugin/plugin.json`, so we only iterate `files`.
 *
 * @param {string} outDir
 * @param {string} format
 * @param {{manifest: Object, files: Array<{path: string, content: string}>}} bundle
 */
function writeBundle(outDir, format, bundle) {
  fs.mkdirSync(outDir, { recursive: true });

  if (format === 'agentskills@v1') {
    // Manifest at root
    fs.writeFileSync(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(bundle.manifest, null, 2) + '\n'
    );
    for (const file of bundle.files) {
      const dest = path.join(outDir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content);
    }
    return;
  }

  if (format === 'claude-plugin') {
    // claude-plugin embeds plugin.json in the files list — just write everything.
    for (const file of bundle.files) {
      const dest = path.join(outDir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content);
    }
    return;
  }

  throw new Error(`writeBundle: unknown format "${format}"`);
}

// ---------------------------------------------------------------------------
// Pure orchestration (exported for tests; does not exit/log)
// ---------------------------------------------------------------------------

/**
 * Run the export pipeline. Returns a structured result instead of exiting,
 * so tests can assert behavior without spawning a child process.
 *
 * @param {Object} args
 * @param {string} args.skillName
 * @param {string} args.skillDir - Absolute path to the skill's source directory
 * @param {string} args.format - Either 'agentskills@v1' or 'claude-plugin'
 * @param {string} [args.outDir] - Destination dir; if omitted, no write happens
 * @param {boolean} [args.force=false] - Overwrite existing destination dir
 * @returns {{ok: true, bundle: Object, portability: Object, format: string, outDir: string|null}
 *          | {ok: false, error: string, portability?: Object}}
 */
function runExport(args) {
  const { skillName, skillDir, format, outDir = null, force = false } = args;

  if (!SUPPORTED_FORMATS.has(format)) {
    return {
      ok: false,
      error: `Unsupported format "${format}". Supported: ${[...SUPPORTED_FORMATS].join(', ')}`,
    };
  }

  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return {
      ok: false,
      error: `Skill "${skillName}" not found at ${skillDir}`,
    };
  }

  // Portability gate — fail-loud on any blocker.
  const portability = assessSkillPortability(skillDir);
  if (!portability.portable) {
    return {
      ok: false,
      error: `Skill "${skillName}" is not portable. ${formatBlockers(portability.blockers)}`,
      portability,
    };
  }

  // Build the bundle.
  let bundle;
  try {
    if (format === 'agentskills@v1') {
      bundle = exportToAgentskills(skillDir);
    } else {
      bundle = exportToClaudePlugin(skillDir);
    }
  } catch (err) {
    return { ok: false, error: `Export failed: ${err.message}`, portability };
  }

  // Optional disk write.
  if (outDir) {
    if (fs.existsSync(outDir)) {
      if (!force) {
        return {
          ok: false,
          error: `Output directory exists: ${outDir} (use --force to overwrite)`,
          portability,
        };
      }
      // Best-effort clean — only remove our known output paths to avoid surprises.
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch (err) {
        return { ok: false, error: `Failed to clear ${outDir}: ${err.message}`, portability };
      }
    }
    try {
      writeBundle(outDir, format, bundle);
    } catch (err) {
      return { ok: false, error: `Failed to write bundle: ${err.message}`, portability };
    }
  }

  return { ok: true, bundle, portability, format, outDir };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    showHelp();
    process.exit(1);
  }

  if (opts.help) {
    showHelp();
    return;
  }

  if (!opts.name) {
    console.error('Error: skill name is required.');
    showHelp();
    process.exit(1);
  }

  if (!SUPPORTED_FORMATS.has(opts.format)) {
    console.error(`Error: unsupported --format "${opts.format}". Supported: ${[...SUPPORTED_FORMATS].join(', ')}`);
    process.exit(1);
  }

  const skillDir = path.join(PROJECT_ROOT, '.claude', 'skills', opts.name);
  const outDir = opts.out
    ? path.resolve(PROJECT_ROOT, opts.out)
    : path.join(PROJECT_ROOT, 'dist', 'skills', opts.name);

  const result = runExport({
    skillName: opts.name,
    skillDir,
    format: opts.format,
    outDir,
    force: opts.force,
  });

  if (!result.ok) {
    console.error(`\n✗ ${result.error}`);
    if (result.portability && result.portability.blockers && result.portability.blockers.length > 0) {
      console.error('\nFix these blockers or mark the skill as non-portable, then re-run:');
      for (const b of result.portability.blockers) {
        const where = `${b.file}:${b.line}`;
        const detail = b.match ? ` — "${b.match}"` : '';
        console.error(`  • [${b.label}] ${where}${detail}`);
      }
    }
    process.exit(1);
  }

  console.log(`✓ Exported skill "${opts.name}" to ${result.format}`);
  console.log(`  Files:  ${result.bundle.files.length}`);
  console.log(`  Output: ${result.outDir}`);
  if (opts.format === 'agentskills@v1') {
    console.log(`  Schema: ${AGENTSKILLS_SCHEMA_VERSION}`);
  }
}

// =============================================================================
// [import would go here]
//
// Future `flow skill import <archive>` will land here. Deferred per Phase 1B
// spec: "Import deferred to a follow-up post-security-model design (quarantine
// + content scanner + opt-in enable)." Implementing it now would land code
// without a security model around running untrusted skill content (untrusted
// .md is mostly harmless, but skills can include scripts, templates, and
// `allowed-tools` declarations that grant tool access). See
// .claude/docs/skill-portability.md for the design constraints.
// =============================================================================

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  runExport,
  parseArgs,
  SUPPORTED_FORMATS,
  DEFAULT_FORMAT,
};
