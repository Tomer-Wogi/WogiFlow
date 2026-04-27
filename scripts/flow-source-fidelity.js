#!/usr/bin/env node

/**
 * Wogi Flow — Source Fidelity Verifier (P11.5 mechanical check)
 *
 * Verifies that a spec file complies with the Source Fidelity Rule
 * (methodology-rules.hbs / Logic Constitution v2 sub-principle 11.5):
 *
 *   T1 — Verbatim source preserved (`## Original Request (verbatim)`)
 *   T2 — Item manifest reconciles every source item
 *   T3 — Per-item: each source item has either a matching AC or a
 *        defer-with-reason line (heuristic — full coverage check is
 *        adversary's job; this CLI is the Tier-2 evidence the
 *        adversary may invoke)
 *
 * Lossy spec-authoring is the documented root cause of the wogi-hub
 * 2026-04-27 incident (5 of 12 user-named features survived from
 * prompt → spec → build because the manager compressed the prompt
 * into a 5-bullet contract). This verifier runs at spec_review and at
 * the spec-write gate.
 *
 * Usage:
 *   node scripts/flow-source-fidelity.js check <spec-file>
 *   node scripts/flow-source-fidelity.js check <spec-file> --json
 *   node scripts/flow-source-fidelity.js check <spec-file> --strict
 *
 * Exit codes:
 *   0 — spec passes (verbatim block present + item manifest present
 *       OR source is short enough to skip the rule)
 *   1 — spec fails (T1 or T2 violated; details printed to stderr)
 *   2 — couldn't read spec / not a spec file
 *
 * Programmatic:
 *   const { checkSourceFidelity } = require('./flow-source-fidelity');
 *   const result = checkSourceFidelity(specPath, { strict: false });
 *   // result: { ok, source, items, missing, warnings, exempt }
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERBATIM_HEADER_REGEX = /^##\s+Original Request \(verbatim\)\s*$/m;
const MANIFEST_HEADER_REGEX = /^##\s+Item Manifest\s*$/m;
// Triggers the rule when the verbatim source is "long" — same threshold
// as the long-input gate (40 lines OR ≥5 discrete items).
const LONG_LINE_THRESHOLD = 40;
const LONG_ITEM_THRESHOLD = 5;

function detectDiscreteItems(text) {
  if (typeof text !== 'string') return 0;
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) count++;          // bullet
    else if (/^\s*\d+[.)]\s+/.test(line)) count++;  // numbered
    else if (/;.*;/.test(line)) count++;            // semicolon-list
  }
  return count;
}

function extractBlock(content, headerRegex) {
  const match = headerRegex.exec(content);
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  // Block ends at next ## heading at the same level
  const rest = content.slice(startIdx);
  const nextHeader = /^##\s+\S/m.exec(rest);
  const blockEnd = nextHeader ? startIdx + nextHeader.index : content.length;
  return content.slice(startIdx, blockEnd).trim();
}

/**
 * Parse the verbatim source block and count its discrete items.
 * Returns the body text + item count.
 */
function parseVerbatim(content) {
  const block = extractBlock(content, VERBATIM_HEADER_REGEX);
  if (block === null) return null;
  return {
    text: block,
    lineCount: block.split('\n').filter(l => l.trim()).length,
    itemCount: detectDiscreteItems(block)
  };
}

/**
 * Parse the item manifest. Each line of the form
 *   - <item> → AC<n>
 *   - <item> → defer-with-reason: <reason>
 * Lines without "→" or with empty mappings are flagged.
 */
function parseManifest(content) {
  const block = extractBlock(content, MANIFEST_HEADER_REGEX);
  if (block === null) return null;
  const entries = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/^[-*]\s+/.test(line)) continue;
    const body = line.replace(/^[-*]\s+/, '');
    const arrowIdx = body.indexOf('→');
    if (arrowIdx === -1) {
      entries.push({ item: body, mapping: null, raw: rawLine });
      continue;
    }
    const item = body.slice(0, arrowIdx).trim();
    const mapping = body.slice(arrowIdx + 1).trim();
    entries.push({ item, mapping, raw: rawLine });
  }
  return { entries, raw: block };
}

/**
 * Decide whether the rule applies to this spec by checking either the
 * verbatim block (if present) or the spec body itself for the
 * long-prompt threshold.
 */
function ruleApplies(content, verbatim) {
  // If verbatim exists AND has content, it's the canonical signal of
  // long-form-ness. Otherwise fall back to inspecting the spec body —
  // an empty verbatim block doesn't exempt the spec from the rule.
  if (verbatim && (verbatim.lineCount > LONG_LINE_THRESHOLD || verbatim.itemCount >= LONG_ITEM_THRESHOLD)) {
    return true;
  }
  // Body inspection: catches both "no verbatim block at all" AND
  // "verbatim block present but empty" — both mean the rule should fire
  // if the surrounding spec content qualifies as long-form.
  const bodyLines = content.split('\n').filter(l => l.trim()).length;
  const bodyItems = detectDiscreteItems(content);
  return bodyLines > LONG_LINE_THRESHOLD || bodyItems >= LONG_ITEM_THRESHOLD;
}

/**
 * Main verification entry point.
 * @param {string} specPath
 * @param {object} [options]
 * @param {boolean} [options.strict] — if true, T2 (manifest) is mandatory
 * @returns {{ok, exempt, missing, warnings, verbatim, manifest, specPath}}
 */
function checkSourceFidelity(specPath, options = {}) {
  if (!specPath || !fs.existsSync(specPath)) {
    return { ok: false, missing: ['spec-file-not-found'], warnings: [], exempt: false, specPath };
  }
  const content = fs.readFileSync(specPath, 'utf-8');
  const verbatim = parseVerbatim(content);
  const manifest = parseManifest(content);
  const applies = ruleApplies(content, verbatim);

  if (!applies) {
    return {
      ok: true,
      exempt: true,
      reason: 'spec-below-long-input-threshold',
      verbatim, manifest, missing: [], warnings: [], specPath
    };
  }

  const missing = [];
  const warnings = [];

  if (!verbatim) {
    missing.push('T1: missing `## Original Request (verbatim)` block (rule applies — source is long-form)');
  } else if (verbatim.lineCount === 0) {
    missing.push('T1: `## Original Request (verbatim)` block is empty');
  }

  if (!manifest) {
    if (options.strict) {
      missing.push('T2: missing `## Item Manifest` block (--strict required)');
    } else {
      warnings.push('T2: no `## Item Manifest` block — recommended for full P11.5 compliance');
    }
  } else {
    for (const entry of manifest.entries) {
      if (!entry.mapping) {
        warnings.push(`T2: manifest entry "${entry.item}" has no mapping (expected "→ AC<n>" or "→ defer-with-reason: <reason>")`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    exempt: false,
    missing,
    warnings,
    verbatim,
    manifest,
    specPath
  };
}

function formatResult(result, opts = {}) {
  if (opts.json) {
    const slim = {
      ok: result.ok,
      exempt: result.exempt || false,
      reason: result.reason || null,
      missing: result.missing,
      warnings: result.warnings,
      verbatim: result.verbatim ? {
        lineCount: result.verbatim.lineCount,
        itemCount: result.verbatim.itemCount
      } : null,
      manifestEntries: result.manifest ? result.manifest.entries.length : 0,
      specPath: result.specPath
    };
    return JSON.stringify(slim, null, 2);
  }
  const lines = [];
  lines.push(`Source Fidelity Check — ${result.specPath}`);
  lines.push('━'.repeat(58));
  if (result.exempt) {
    lines.push(`⏭  EXEMPT — ${result.reason || 'rule does not apply'}`);
    return lines.join('\n');
  }
  if (result.ok) {
    lines.push('✓ PASS');
  } else {
    lines.push('✗ FAIL');
  }
  if (result.verbatim) {
    lines.push(`  Verbatim block:  ${result.verbatim.lineCount} non-empty lines, ${result.verbatim.itemCount} discrete items`);
  } else {
    lines.push('  Verbatim block:  ABSENT');
  }
  if (result.manifest) {
    lines.push(`  Item manifest:   ${result.manifest.entries.length} entries`);
  } else {
    lines.push('  Item manifest:   ABSENT');
  }
  if (result.missing.length) {
    lines.push('');
    lines.push('Missing (BLOCKING):');
    for (const m of result.missing) lines.push(`  - ${m}`);
  }
  if (result.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}

module.exports = {
  checkSourceFidelity,
  parseVerbatim,
  parseManifest,
  ruleApplies,
  detectDiscreteItems,
  LONG_LINE_THRESHOLD,
  LONG_ITEM_THRESHOLD
};

if (require.main === module) {
  const [,, cmd, ...rest] = process.argv;
  if (cmd === 'check') {
    const target = rest.find(a => !a.startsWith('--'));
    const json = rest.includes('--json');
    const strict = rest.includes('--strict');
    if (!target) {
      process.stderr.write('Usage: flow-source-fidelity check <spec-file> [--json] [--strict]\n');
      process.exit(2);
    }
    const result = checkSourceFidelity(target, { strict });
    const formatted = formatResult(result, { json });
    if (result.ok || result.exempt) {
      process.stdout.write(formatted + '\n');
      process.exit(0);
    } else {
      process.stderr.write(formatted + '\n');
      process.exit(1);
    }
  } else {
    process.stderr.write('Usage: flow-source-fidelity check <spec-file> [--json] [--strict]\n');
    process.exit(2);
  }
}
