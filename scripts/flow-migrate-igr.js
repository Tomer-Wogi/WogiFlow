#!/usr/bin/env node

/**
 * Wogi Flow - IGR Migration CLI
 *
 * Idempotent migration to bring an existing WogiFlow project up to the IGR layer.
 * Run on existing installs after upgrading WogiFlow to the version that includes IGR.
 *
 * Story: wf-61de2974 (Story 7 fast-follow)
 * Epic: wf-b00262b1 (IGR)
 *
 * What it does (idempotent — safe to re-run):
 *   1. Adds intentGroundedReasoning + gateTelemetry blocks to .workflow/config.json (default-on)
 *      WITHOUT clobbering existing values.
 *   2. Confirms .workflow/state/ exists.
 *   3. Reports whether intent artifacts (product.md, domain-model.md, glossary.md, user-journeys.md) exist.
 *   4. Reports whether the GATE_REGISTRY has completionTruth registered (sanity check).
 *   5. Reports IGR's installed scripts and personas.
 *   6. Optionally runs intent bootstrap with --bootstrap flag.
 *
 * Usage:
 *   node scripts/flow-migrate-igr.js          # migrate config + report status
 *   node scripts/flow-migrate-igr.js --bootstrap   # ALSO scaffold intent artifacts
 *   node scripts/flow-migrate-igr.js --status      # report only, do not modify config
 *   node scripts/flow-migrate-igr.js --disable     # set enabled: false (rollback)
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, ensureDir, safeJsonParse } = require('./flow-io');
const { color, info, success, warn, error } = require('./flow-output');

const REQUIRED_INTENT_ARTIFACTS = [
  'product.md',
  'domain-model.md',
  'glossary.md',
  'user-journeys.md',
];

const REQUIRED_IGR_SCRIPTS = [
  'flow-gate-telemetry.js',
  'flow-logic-adversary.js',
  'flow-intent-bootstrap.js',
  'flow-trap-zone.js',
  'flow-intent-framing.js',
  'flow-architect-pass.js',
  'flow-completion-truth-gate.js',
];

const REQUIRED_PERSONAS = ['logic-adversary.md', 'architect.md'];
const REQUIRED_RUBRICS = ['logic-constitution-v1.md', 'logic-constitution-v2.md'];

// ARCH-002 fix (2026-04-13): use shared parseArgs from flow-cli-utils
const { parseArgs } = require('./flow-cli-utils');

function ensureIgrConfig(opts = {}) {
  const configPath = PATHS.config;
  if (!fileExists(configPath)) {
    error(`config.json not found at ${configPath} — is this a WogiFlow project?`);
    process.exit(1);
  }
  // Use safeJsonParse per security-patterns.md §2 — guards against prototype pollution.
  // Fall back to raw parse only if safeJsonParse returns null AND the file is non-empty.
  const config = safeJsonParse(configPath, null);
  if (config === null) {
    error(`config.json is not valid JSON or contains dangerous keys (__proto__, constructor, prototype)`);
    process.exit(1);
  }
  if (typeof config !== 'object' || Array.isArray(config)) {
    error(`config.json must be a JSON object at root`);
    process.exit(1);
  }

  let modified = false;

  // Add gateTelemetry if missing
  if (!config.gateTelemetry) {
    config.gateTelemetry = {
      _comment: 'IGR Story 0 — per-gate self-assessment log. See .claude/docs/gate-telemetry.md.',
      enabled: true,
      rotateSizeBytes: 10485760,
      crossReferenceOnCorrection: true,
    };
    modified = true;
    info('Added gateTelemetry block');
  }

  // Add intentGroundedReasoning if missing — preserve any existing values
  if (!config.intentGroundedReasoning) {
    config.intentGroundedReasoning = {
      _comment: 'Intent-Grounded Reasoning (IGR). See .claude/docs/intent-grounded-reasoning.md.',
      enabled: opts.disable ? false : true,
      completionTruthGate: {
        enabled: true,
        minTierForDone: 3,
        blockFalseCompletion: true,
      },
    };
    modified = true;
    info(`Added intentGroundedReasoning block (enabled: ${!opts.disable})`);
  } else if (opts.disable && config.intentGroundedReasoning.enabled !== false) {
    config.intentGroundedReasoning.enabled = false;
    modified = true;
    info('Set intentGroundedReasoning.enabled = false (disable mode)');
  } else if (!opts.disable && config.intentGroundedReasoning.enabled === undefined) {
    config.intentGroundedReasoning.enabled = true;
    modified = true;
    info('Set intentGroundedReasoning.enabled = true');
  }

  if (modified && !opts.statusOnly) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    success(`Wrote ${configPath}`);
  } else if (!modified) {
    info('config.json — no changes needed');
  } else {
    info('--status mode: skipping write');
  }

  return config;
}

function reportStatus(config) {
  console.log('');
  console.log(color('bold', '━━━ IGR Migration Status ━━━'));
  console.log(`Master flag (intentGroundedReasoning.enabled): ${config.intentGroundedReasoning?.enabled === true ? color('green', 'ON') : color('yellow', 'OFF')}`);
  console.log(`Gate telemetry (gateTelemetry.enabled): ${config.gateTelemetry?.enabled !== false ? color('green', 'ON') : color('yellow', 'OFF')}`);
  console.log(`Truth Gate (completionTruthGate.enabled): ${config.intentGroundedReasoning?.completionTruthGate?.enabled !== false ? color('green', 'ON') : color('yellow', 'OFF')}`);
  console.log('');

  console.log(color('bold', 'Intent artifacts:'));
  let missingArtifacts = 0;
  for (const a of REQUIRED_INTENT_ARTIFACTS) {
    const p = path.join(PATHS.state, a);
    const exists = fileExists(p);
    if (!exists) missingArtifacts++;
    console.log(`  ${exists ? color('green', '✓') : color('yellow', '✗')} ${a}`);
  }
  if (missingArtifacts > 0) {
    console.log(color('yellow', `  ${missingArtifacts} of ${REQUIRED_INTENT_ARTIFACTS.length} missing — run with --bootstrap to scaffold drafts`));
  }
  console.log('');

  console.log(color('bold', 'IGR scripts:'));
  let missingScripts = 0;
  for (const s of REQUIRED_IGR_SCRIPTS) {
    const p = path.join(__dirname, s);
    const exists = fileExists(p);
    if (!exists) missingScripts++;
    console.log(`  ${exists ? color('green', '✓') : color('red', '✗')} scripts/${s}`);
  }
  if (missingScripts > 0) {
    console.log(color('red', `  ${missingScripts} of ${REQUIRED_IGR_SCRIPTS.length} missing — IGR may not be fully installed; reinstall WogiFlow`));
  }
  console.log('');

  console.log(color('bold', 'Personas + rubrics:'));
  for (const p of REQUIRED_PERSONAS) {
    const fp = path.join(PATHS.workflow, 'agents', p);
    const exists = fileExists(fp);
    console.log(`  ${exists ? color('green', '✓') : color('red', '✗')} .workflow/agents/${p}`);
  }
  for (const r of REQUIRED_RUBRICS) {
    const fp = path.join(PATHS.workflow, 'rubrics', r);
    const exists = fileExists(fp);
    console.log(`  ${exists ? color('green', '✓') : color('red', '✗')} .workflow/rubrics/${r}`);
  }
  console.log('');

  console.log(color('bold', 'Gate registry:'));
  try {
    const { GATE_REGISTRY } = require('./flow-done-gates');
    const present = 'completionTruth' in GATE_REGISTRY;
    console.log(`  ${present ? color('green', '✓') : color('red', '✗')} completionTruth registered`);
  } catch (err) {
    console.log(color('red', `  ✗ Cannot inspect GATE_REGISTRY: ${err.message}`));
  }
  console.log('');

  if (missingArtifacts > 0 && config.intentGroundedReasoning?.enabled) {
    console.log(color('yellow', 'Note: IGR is enabled but intent artifacts are missing.'));
    console.log(color('yellow', '      The Adversary will run in degraded mode (4 of 10 principles SKIP).'));
    console.log(color('yellow', '      Run: node scripts/flow-migrate-igr.js --bootstrap   to scaffold artifacts.'));
    console.log('');
  }
}

function maybeBootstrap(opts) {
  if (!opts.bootstrap) return;
  console.log(color('bold', '━━━ Running Intent Bootstrap ━━━'));
  try {
    const { bootstrap } = require('./flow-intent-bootstrap');
    const result = bootstrap({ autoConfirm: true });
    console.log(`Verdict: ${result.verdict}`);
    console.log(`Created: ${result.artifactsCreated.length}, Skipped: ${result.artifactsSkipped.length}, Failed: ${result.artifactsFailed.length}`);
    if (result.trapZoneCount > 0) {
      console.log(`Trap zones detected: ${result.trapZoneCount}`);
    }
  } catch (err) {
    error(`Bootstrap failed: ${err.message}`);
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    bootstrap: !!args.bootstrap,
    statusOnly: !!args.status,
    disable: !!args.disable,
  };

  console.log(color('bold', '━━━ flow migrate igr ━━━'));
  if (opts.disable) {
    info('Disable mode — setting intentGroundedReasoning.enabled = false');
  } else if (opts.statusOnly) {
    info('Status-only mode — not writing config');
  } else {
    info('Migrating config to enable IGR (idempotent)');
  }
  console.log('');

  const config = ensureIgrConfig(opts);
  reportStatus(config);
  maybeBootstrap(opts);

  if (opts.disable) {
    success('IGR disabled. To re-enable: node scripts/flow-migrate-igr.js');
  } else if (opts.statusOnly) {
    info('Status report complete.');
  } else {
    success('Migration complete. Next steps:');
    console.log('  1. Run intent bootstrap if artifacts missing: node scripts/flow-migrate-igr.js --bootstrap');
    console.log('  2. Verify telemetry: node scripts/flow-gate-telemetry.js stats');
    console.log('  3. Read the operator guide: .claude/docs/intent-grounded-reasoning.md');
  }
}

if (require.main === module) {
  main();
}

module.exports = { ensureIgrConfig, reportStatus, REQUIRED_INTENT_ARTIFACTS, REQUIRED_IGR_SCRIPTS };
