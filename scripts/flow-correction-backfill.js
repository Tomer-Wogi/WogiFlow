#!/usr/bin/env node

/**
 * Wogi Flow — Pending-Corrections Backfill (wf-6c58953a)
 *
 * Backfills records in `.workflow/state/pending-corrections.json` that have
 * null `whatWasWrong` / `whatUserWants` fields. The fix lands at code level
 * (flow-correction-detector.js Layer 1+2 reconciliation), but historical
 * records persisted before the fix already have null fields. This tool
 * applies the same deterministic-fallback extraction retroactively.
 *
 * Strategy:
 *   - Read pending-corrections.json
 *   - For each record where userMessage is populated AND
 *     (whatWasWrong is null OR whatUserWants is null)
 *   - Apply deterministic extraction: whatWasWrong = first 200 chars of
 *     userMessage; whatUserWants stays null (intent inference is an LLM job
 *     — honest null > wrong guess; live extractor will populate going forward)
 *   - Mark `enrichmentSource: "backfill-<date>"` so consumers can distinguish
 *     backfilled from live extractions
 *   - Atomic write: write-temp + rename
 *
 * Usage:
 *   node scripts/flow-correction-backfill.js                        # current project
 *   node scripts/flow-correction-backfill.js --project=<path>      # explicit project
 *   node scripts/flow-correction-backfill.js --dry-run             # report only
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-utils');
const { safeJsonParseString } = require('./flow-io');
const { deterministicWhatWasWrong } = require('./flow-correction-detector');

const BACKFILL_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

/**
 * Backfill a single project's pending-corrections.json.
 *
 * @param {string} projectRoot — project directory containing .workflow/
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] — if true, return what WOULD change without writing
 * @returns {{ found: number, backfilled: number, alreadyPopulated: number, written: boolean, path: string|null, dryRun: boolean }}
 */
function backfillPendingCorrections(projectRoot, opts = {}) {
  const { dryRun = false } = opts;
  const pcPath = path.join(projectRoot, '.workflow', 'state', 'pending-corrections.json');

  const result = {
    found: 0,
    backfilled: 0,
    alreadyPopulated: 0,
    written: false,
    path: null,
    dryRun
  };

  if (!fs.existsSync(pcPath)) {
    result.path = pcPath;
    return result;
  }

  let content;
  try {
    content = fs.readFileSync(pcPath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read pending-corrections at ${pcPath}: ${err.message}`);
  }

  const records = safeJsonParseString(content, []);
  if (!Array.isArray(records)) {
    throw new Error(`Expected array at ${pcPath}; got ${typeof records}`);
  }

  result.found = records.length;
  result.path = pcPath;

  let changed = false;
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const userMsg = r.userMessage;
    if (typeof userMsg !== 'string' || !userMsg.trim()) continue;

    const needsFill = (r.whatWasWrong == null) && (r.whatUserWants == null);
    if (!needsFill) {
      result.alreadyPopulated += 1;
      continue;
    }

    // Apply deterministic extraction (whatWasWrong only — whatUserWants
    // stays null; intent inference is the live extractor's job going forward)
    r.whatWasWrong = deterministicWhatWasWrong(userMsg);
    r.enrichmentSource = `backfill-${BACKFILL_DATE}`;
    result.backfilled += 1;
    changed = true;
  }

  if (changed && !dryRun) {
    // Atomic write: write-temp + rename
    const tmpPath = `${pcPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2) + '\n');
    fs.renameSync(tmpPath, pcPath);
    result.written = true;
  }

  return result;
}

// ============================================================
// CLI
// ============================================================

function main() {
  const argv = process.argv.slice(2);
  const projArg = argv.find(a => a.startsWith('--project='));
  const dryRun = argv.includes('--dry-run');

  const projectRoot = projArg ? projArg.slice('--project='.length) : PATHS.root;

  let result;
  try {
    result = backfillPendingCorrections(projectRoot, { dryRun });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    project: projectRoot,
    pendingCorrectionsPath: result.path,
    found: result.found,
    backfilled: result.backfilled,
    alreadyPopulated: result.alreadyPopulated,
    written: result.written,
    dryRun: result.dryRun
  }, null, 2));
}

module.exports = {
  backfillPendingCorrections
};

if (require.main === module) {
  main();
}
