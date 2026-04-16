#!/usr/bin/env node

/**
 * Wogi Flow — Structure-Change Sensor
 *
 * Detects folder-restructure patterns in a git diff range so /wogi-finalize
 * and cross-repo audit workflows can flag merges that will produce
 * modify/delete conflicts rather than routine content conflicts.
 *
 * Patterns detected (all evaluated against `git diff --name-status <range>`):
 *
 *   1. FOLDER_PER_COMPONENT   — `X.tsx` deleted  +  `X/X.tsx` added
 *   2. SPLIT_INTO_SUBMODULE   — `X.ts`  deleted  +  one or more `<dir>/X-*.ts`
 *                               or `<dir>/<other>.ts` added at deeper depth
 *   3. BARREL_INTRODUCTION    — `X.ts`  deleted  +  `X/index.ts` added
 *   4. RENAME_NEW_HOME        — single file deletion + single file addition,
 *                               same basename, different directory
 *
 * The sensor is intentionally pattern-based and bounded: no full-diff parsing,
 * no AST walks. Downstream callers (wogi-finalize merge-plan gate) use the
 * output to drive a percentage threshold — when restructure-matched files
 * exceed `restructureThreshold` (default 20%) of the changed set, a structural
 * warning is surfaced.
 *
 * Usage (CLI):
 *   flow-structure-sensor.js <base>..<branch>
 *     → emits one JSON object on stdout
 *
 * Usage (module):
 *   const { detectStructureChanges } = require('./flow-structure-sensor');
 *   const result = detectStructureChanges({ base: 'master', branch: 'feature/x' });
 *
 * Exit codes:
 *   0 — success (patterns may or may not be present; see result.warn)
 *   1 — git invocation failed or invalid range
 */

'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_RESTRUCTURE_THRESHOLD = 0.20;

/**
 * Run `git diff --name-status` and return the parsed entries.
 * Each entry is { status: 'A'|'D'|'M'|'R100'|..., path: string, origPath?: string }.
 */
function getDiffEntries({ range, cwd }) {
  const args = ['diff', '--name-status', range];
  let output;
  try {
    output = execFileSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`git diff failed: ${err.message || err}`);
  }
  const entries = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    if (!status) continue;
    // R/C statuses carry two paths: origPath, newPath
    if (/^R/.test(status) || /^C/.test(status)) {
      if (parts.length >= 3) {
        entries.push({ status, origPath: parts[1], path: parts[2] });
      }
    } else {
      entries.push({ status, path: parts[1] });
    }
  }
  return entries;
}

/**
 * Analyze entries for restructure patterns.
 * Returns:
 *   {
 *     range, totalChanged, restructureCount, ratio, warn,
 *     patterns: [{ type, deleted, added, basename }]
 *   }
 */
function classify(entries) {
  const deletions = entries.filter((e) => e.status === 'D').map((e) => e.path);
  const additions = entries.filter((e) => e.status === 'A').map((e) => e.path);
  const renames = entries.filter((e) => /^R/.test(e.status));

  const patterns = [];
  const restructureFiles = new Set();

  const deletedByBasename = new Map();
  for (const p of deletions) {
    const base = path.basename(p, path.extname(p));
    if (!deletedByBasename.has(base)) deletedByBasename.set(base, []);
    deletedByBasename.get(base).push(p);
  }
  const addedByBasename = new Map();
  for (const p of additions) {
    const base = path.basename(p, path.extname(p));
    if (!addedByBasename.has(base)) addedByBasename.set(base, []);
    addedByBasename.get(base).push(p);
  }

  // 1. FOLDER_PER_COMPONENT: X.tsx deleted AND X/X.tsx (same basename/ext) added
  for (const [base, dels] of deletedByBasename) {
    const adds = addedByBasename.get(base) || [];
    for (const del of dels) {
      for (const add of adds) {
        const delDir = path.dirname(del);
        const addDir = path.dirname(add);
        const delExt = path.extname(del);
        const addExt = path.extname(add);
        if (delExt !== addExt) continue;
        // Folder-per-component: addDir = delDir + '/' + base
        if (addDir === path.join(delDir, base)) {
          patterns.push({ type: 'FOLDER_PER_COMPONENT', deleted: del, added: add, basename: base });
          restructureFiles.add(del);
          restructureFiles.add(add);
        }
      }
    }
  }

  // 2. SPLIT_INTO_SUBMODULE: X.ts deleted AND 2+ files added under a dir
  //    named X/ or at deeper depth carrying X's name as dir.
  for (const [base, dels] of deletedByBasename) {
    for (const del of dels) {
      const delDir = path.dirname(del);
      const delExt = path.extname(del);
      const submoduleDir = path.join(delDir, base);
      const adds = additions.filter(
        (a) =>
          path.extname(a) === delExt &&
          (a.startsWith(submoduleDir + path.sep) || a.startsWith(submoduleDir + '/'))
      );
      // Need to see this as a split only if 2+ files land there — single file
      // was already picked up as FOLDER_PER_COMPONENT above.
      if (adds.length >= 2) {
        patterns.push({ type: 'SPLIT_INTO_SUBMODULE', deleted: del, added: adds, basename: base });
        restructureFiles.add(del);
        for (const a of adds) restructureFiles.add(a);
      }
    }
  }

  // 3. BARREL_INTRODUCTION: X.ts deleted AND X/index.ts added (any extension match)
  for (const [base, dels] of deletedByBasename) {
    for (const del of dels) {
      const delDir = path.dirname(del);
      const delExt = path.extname(del);
      const barrelPath = path.join(delDir, base, `index${delExt}`);
      if (additions.includes(barrelPath)) {
        patterns.push({ type: 'BARREL_INTRODUCTION', deleted: del, added: barrelPath, basename: base });
        restructureFiles.add(del);
        restructureFiles.add(barrelPath);
      }
    }
  }

  // 4. RENAME_NEW_HOME: git-reported renames across different directories
  for (const r of renames) {
    if (!r.origPath || !r.path) continue;
    if (path.dirname(r.origPath) !== path.dirname(r.path)) {
      patterns.push({
        type: 'RENAME_NEW_HOME',
        deleted: r.origPath,
        added: r.path,
        basename: path.basename(r.path, path.extname(r.path)),
      });
      restructureFiles.add(r.origPath);
      restructureFiles.add(r.path);
    }
  }

  const totalChanged = entries.length;
  const ratio = totalChanged > 0 ? restructureFiles.size / totalChanged : 0;

  return {
    totalChanged,
    restructureCount: restructureFiles.size,
    ratio,
    patterns,
  };
}

/**
 * Public API — detect structure changes for a git range.
 *
 * @param {Object} opts
 * @param {string} opts.range - Git range (e.g., "master..feature/foo" or a single SHA range).
 *                              If opts.base+opts.branch given, they combine as "base..branch".
 * @param {string} [opts.base]
 * @param {string} [opts.branch]
 * @param {string} [opts.cwd]
 * @param {number} [opts.threshold=0.20] - Ratio above which warn=true.
 * @returns {Object}
 */
function detectStructureChanges(opts = {}) {
  const range = opts.range || (opts.base && opts.branch ? `${opts.base}..${opts.branch}` : null);
  if (!range || typeof range !== 'string') {
    return {
      ok: false,
      reason: 'missing-range',
      totalChanged: 0,
      restructureCount: 0,
      ratio: 0,
      warn: false,
      patterns: [],
    };
  }
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : DEFAULT_RESTRUCTURE_THRESHOLD;

  let entries;
  try {
    entries = getDiffEntries({ range, cwd: opts.cwd });
  } catch (err) {
    return {
      ok: false,
      reason: `git-failed: ${err.message}`,
      range,
      totalChanged: 0,
      restructureCount: 0,
      ratio: 0,
      warn: false,
      patterns: [],
    };
  }

  const classified = classify(entries);
  const warn = classified.ratio >= threshold && classified.restructureCount >= 2;

  return {
    ok: true,
    range,
    threshold,
    totalChanged: classified.totalChanged,
    restructureCount: classified.restructureCount,
    ratio: Number(classified.ratio.toFixed(4)),
    warn,
    patterns: classified.patterns,
  };
}

// ============================================================
// CLI
// ============================================================

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log('Usage: flow-structure-sensor.js <range> [--threshold=N]');
    console.log('  range      — git diff range, e.g. "master..feature/x" or "<sha1>..<sha2>"');
    console.log('  --threshold=N   float 0–1, default 0.20');
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const range = argv[0];
  let threshold = DEFAULT_RESTRUCTURE_THRESHOLD;
  for (const a of argv.slice(1)) {
    const m = a.match(/^--threshold=(.+)$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) threshold = n;
    }
  }
  const result = detectStructureChanges({ range, threshold });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  detectStructureChanges,
  classify,
  getDiffEntries,
  DEFAULT_RESTRUCTURE_THRESHOLD,
};
