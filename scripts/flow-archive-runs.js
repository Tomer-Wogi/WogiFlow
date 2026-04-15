#!/usr/bin/env node

/**
 * Wogi Flow - Archive Runs (stale-cleanup)
 *
 * Manual-only archival for adversary-runs/*.json + gate-telemetry.jsonl.
 *
 * Story: wf-6a352aae (epic-episodic-memory). User-approved scope:
 *   - archive.adversaryRunsDays: 30
 *   - archive.telemetryMaxLines: 5000
 *   - archive.autoAtSessionEnd: false (manual-only — destructive operations)
 *
 * Boundaries:
 *   - Files referenced by the active task-checkpoint are NEVER archived.
 *   - Original content is preserved in gzip form; nothing deleted.
 *   - Idempotent: re-running on the same input writes no duplicate archives.
 *
 * Usage (programmatic):
 *   const { archiveAdversaryRuns, archiveTelemetryLog, archiveAll } = require('./flow-archive-runs');
 *   const result = await archiveAll({ dryRun: false });
 *
 * CLI:
 *   node scripts/flow-archive-runs.js              # archive (writes + moves)
 *   node scripts/flow-archive-runs.js --dry-run    # preview only
 *   node scripts/flow-archive-runs.js status       # show what would archive
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { createReadStream, createWriteStream } = require('node:fs');

const {
  PATHS,
  safeJsonParse,
  writeJson,
  ensureDir,
  withLock,
} = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');

// ============================================================================
// Constants & paths
// ============================================================================

const ADVERSARY_RUNS_DIR = path.join(PATHS.state, 'adversary-runs');
const ADVERSARY_ARCHIVE_DIR = path.join(ADVERSARY_RUNS_DIR, '_archive');
const ADVERSARY_INDEX_FILE = path.join(ADVERSARY_ARCHIVE_DIR, 'index.json');
const TELEMETRY_LOG = path.join(PATHS.state, 'gate-telemetry.jsonl');
const TELEMETRY_ARCHIVE_DIR = path.join(PATHS.state, '_archive');
const TASK_CHECKPOINT_FILE = path.join(PATHS.state, 'task-checkpoint.json');

const ARCHIVE_DEFAULTS = Object.freeze({
  autoAtSessionEnd: false,
  adversaryRunsDays: 30,
  telemetryMaxLines: 5000,
});

// ============================================================================
// Config
// ============================================================================

function getArchiveConfig() {
  let cfg = {};
  try {
    cfg = getConfig() || {};
  } catch (_err) {
    cfg = {};
  }
  const a = cfg.archive || {};
  return {
    autoAtSessionEnd: a.autoAtSessionEnd === true,
    adversaryRunsDays: Number.isFinite(a.adversaryRunsDays)
      ? a.adversaryRunsDays
      : ARCHIVE_DEFAULTS.adversaryRunsDays,
    telemetryMaxLines: Number.isFinite(a.telemetryMaxLines)
      ? a.telemetryMaxLines
      : ARCHIVE_DEFAULTS.telemetryMaxLines,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read active taskId from task-checkpoint.json (used as do-not-archive guard).
 */
function getActiveTaskId() {
  if (!fs.existsSync(TASK_CHECKPOINT_FILE)) return null;
  const checkpoint = safeJsonParse(TASK_CHECKPOINT_FILE, null);
  return checkpoint?.taskId || null;
}

function ageDays(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs / (1000 * 60 * 60 * 24);
  } catch (_err) {
    return 0;
  }
}

function yyyyMm(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function yyyyMmDd(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Stream-gzip a source file to a destination .gz. Cross-platform via Node zlib.
 */
async function gzipFile(srcPath, destPath) {
  ensureDir(path.dirname(destPath));
  await pipeline(createReadStream(srcPath), zlib.createGzip(), createWriteStream(destPath));
}

/**
 * Cross-platform "move": copy then unlink. fs.rename can fail across volumes
 * on Windows; copy+unlink is portable.
 */
function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

// ============================================================================
// Adversary-runs archival
// ============================================================================

function loadAdversaryArchiveIndex() {
  if (!fs.existsSync(ADVERSARY_INDEX_FILE)) return {};
  const idx = safeJsonParse(ADVERSARY_INDEX_FILE, {});
  return idx && typeof idx === 'object' ? idx : {};
}

async function saveAdversaryArchiveIndex(index) {
  ensureDir(ADVERSARY_ARCHIVE_DIR);
  await withLock(ADVERSARY_INDEX_FILE, async () => {
    writeJson(ADVERSARY_INDEX_FILE, index);
  });
}

/**
 * List adversary-run files eligible for archival.
 */
function listEligibleAdversaryRuns(config, activeTaskId) {
  if (!fs.existsSync(ADVERSARY_RUNS_DIR)) return [];
  let entries;
  try {
    entries = fs.readdirSync(ADVERSARY_RUNS_DIR);
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    // _archive is the archive subdirectory (no .json extension, won't reach here);
    // index.json (under _archive) has a parent dir of _archive so won't appear here.
    // We only filter individual run files now.
    const full = path.join(ADVERSARY_RUNS_DIR, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
    } catch (_err) {
      continue;
    }
    // Active-task guard: skip any file whose name contains the active task ID.
    if (activeTaskId && name.includes(activeTaskId)) continue;
    const age = ageDays(full);
    if (age < config.adversaryRunsDays) continue;
    out.push({ name, full, ageDays: Math.round(age * 10) / 10 });
  }
  return out;
}

/**
 * Archive eligible adversary-runs.
 * @returns {{ archived: number, skipped: number, failed: number, archives: Array }}
 */
async function archiveAdversaryRuns(opts = {}) {
  const config = opts.config || getArchiveConfig();
  const dryRun = !!opts.dryRun;
  const activeTaskId = getActiveTaskId();
  const eligible = listEligibleAdversaryRuns(config, activeTaskId);
  const result = { archived: 0, skipped: 0, failed: 0, archives: [], dryRun, activeTaskId };
  if (eligible.length === 0) return result;
  if (dryRun) {
    result.archives = eligible.map((e) => ({
      name: e.name,
      ageDays: e.ageDays,
      destinationDir: path.join(ADVERSARY_ARCHIVE_DIR, yyyyMm(new Date())),
    }));
    return result;
  }
  const index = loadAdversaryArchiveIndex();
  for (const f of eligible) {
    const ymDir = yyyyMm(new Date());
    const destPath = path.join(ADVERSARY_ARCHIVE_DIR, ymDir, `${f.name}.gz`);
    // Idempotency: if archive already exists for this filename, skip.
    if (index[f.name]) {
      result.skipped += 1;
      continue;
    }
    try {
      await gzipFile(f.full, destPath);
      // Read the run to extract metadata for the index. safeJsonParse handles
      // file errors and prototype-pollution per security-patterns.md §2.
      const meta = { taskId: null, round: null };
      const parsed = safeJsonParse(f.full, null);
      if (parsed && typeof parsed === 'object') {
        meta.taskId = parsed.taskId || null;
        meta.round = parsed.round || null;
      }
      const removed = safeUnlink(f.full);
      if (!removed) {
        // Source unlink failed → leave .gz in place; don't update index so
        // a retry will skip (file already gzipped) and complete the unlink later.
        result.failed += 1;
        continue;
      }
      index[f.name] = {
        archivedAt: new Date().toISOString(),
        archivePath: path.relative(PATHS.state, destPath),
        taskId: meta.taskId,
        round: meta.round,
        ageDaysAtArchive: f.ageDays,
      };
      result.archived += 1;
      result.archives.push({ name: f.name, archivePath: index[f.name].archivePath });
    } catch (err) {
      result.failed += 1;
      if (process.env.DEBUG) {
        console.error(`[archive] gzip failed for ${f.name}: ${err.message}`);
      }
    }
  }
  if (result.archived > 0) {
    await saveAdversaryArchiveIndex(index);
  }
  return result;
}

// ============================================================================
// Telemetry-log rotation
// ============================================================================

/**
 * Count lines in a file (streaming, no full-read).
 */
function countLines(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(0);
    let count = 0;
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let trailingNewline = false;
    stream.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '\n') count += 1;
      }
      trailingNewline = chunk[chunk.length - 1] === '\n';
    });
    stream.on('end', () => {
      // If file doesn't end with \n, the last partial line still counts as a line.
      // We're a JSONL log so most lines end with \n; keep the count as-is.
      resolve(count + (trailingNewline ? 0 : (count > 0 || fs.existsSync(filePath) ? 1 : 0)));
    });
    stream.on('error', () => resolve(0));
  });
}

/**
 * Rotate gate-telemetry.jsonl when over the line cap.
 * @returns {{ rotated: boolean, lineCount: number, archivePath?: string, dryRun: boolean }}
 */
async function archiveTelemetryLog(opts = {}) {
  const config = opts.config || getArchiveConfig();
  const dryRun = !!opts.dryRun;
  const lineCount = await countLines(TELEMETRY_LOG);
  if (lineCount <= config.telemetryMaxLines) {
    return { rotated: false, lineCount, dryRun };
  }
  const archivePath = path.join(
    TELEMETRY_ARCHIVE_DIR,
    `gate-telemetry-${yyyyMmDd(new Date())}.jsonl.gz`
  );
  if (dryRun) {
    return { rotated: false, lineCount, archivePath, dryRun: true };
  }
  await withLock(TELEMETRY_LOG, async () => {
    await gzipFile(TELEMETRY_LOG, archivePath);
    // Truncate live file (keeps existing FD-readers from breaking — file replaced).
    fs.writeFileSync(TELEMETRY_LOG, '');
  });
  return { rotated: true, lineCount, archivePath: path.relative(PATHS.state, archivePath), dryRun };
}

// ============================================================================
// Top-level archiveAll
// ============================================================================

async function archiveAll(opts = {}) {
  const config = opts.config || getArchiveConfig();
  const dryRun = !!opts.dryRun;
  const adversary = await archiveAdversaryRuns({ config, dryRun });
  const telemetry = await archiveTelemetryLog({ config, dryRun });
  return { adversary, telemetry, dryRun };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  archiveAll,
  archiveAdversaryRuns,
  archiveTelemetryLog,
  loadAdversaryArchiveIndex,
  listEligibleAdversaryRuns,
  getActiveTaskId,
  getArchiveConfig,
  countLines,
  yyyyMm,
  yyyyMmDd,
  ARCHIVE_DEFAULTS,
};

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cmd = args.find((a) => !a.startsWith('--')) || 'run';
  (async () => {
    if (cmd === 'status') {
      const cfg = getArchiveConfig();
      const eligible = listEligibleAdversaryRuns(cfg, getActiveTaskId());
      const lineCount = await countLines(TELEMETRY_LOG);
      console.log(JSON.stringify({
        adversaryEligible: eligible.length,
        adversaryFiles: eligible.map((e) => `${e.name} (${e.ageDays}d)`),
        telemetryLineCount: lineCount,
        telemetryMaxLines: cfg.telemetryMaxLines,
        wouldRotateTelemetry: lineCount > cfg.telemetryMaxLines,
        activeTaskId: getActiveTaskId(),
      }, null, 2));
      return;
    }
    const r = await archiveAll({ dryRun });
    console.log(JSON.stringify(r, null, 2));
  })().catch((err) => {
    console.error(`[archive] error: ${err.message}`);
    process.exit(1);
  });
}
