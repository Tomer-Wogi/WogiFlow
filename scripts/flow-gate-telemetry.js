#!/usr/bin/env node

/**
 * Wogi Flow - Gate Telemetry & Self-Assessment Framework
 *
 * Central recorder for every WogiFlow quality / verification / logic gate.
 * Captures: when a gate fired, what it caught, whether downstream signals
 * (user corrections, task failures) later contradicted its verdict.
 *
 * The purpose is self-assessment: over time, we can see which gates catch
 * real issues, which rubber-stamp, and where the coverage gaps are.
 *
 * Design constraints:
 * - Append-only JSONL (efficient appends, streaming reads, no lock contention).
 * - Schema-versioned events (v field on every event).
 * - Privacy: no full prompts or user messages stored. Hashes + short summaries only.
 * - Bounded storage: rotation at 10 MB by default.
 * - Cross-referenceable: session-corrections can be correlated back to gates
 *   that passed a plan the user later corrected.
 *
 * Story: wf-faf340cf (IGR Story 0 — foundation)
 * Epic: wf-b00262b1 (IGR implementation)
 *
 * Usage:
 *   const { recordGateEvent, getGateStats } = require('./flow-gate-telemetry');
 *
 *   recordGateEvent({
 *     gateId: 'logic-adversary',
 *     gateVersion: '1.0',
 *     taskId: 'wf-XXXXXXXX',
 *     verdict: 'CONCERN',
 *     findingCount: 3,
 *     findingSummary: ['principle 5: contradicts decision X', ...],
 *     iterations: 2,
 *     durationMs: 8421,
 *   });
 *
 * CLI:
 *   node scripts/flow-gate-telemetry.js stats [--since=7d] [--gate=ID]
 *   node scripts/flow-gate-telemetry.js rotate
 *   node scripts/flow-gate-telemetry.js schema
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PATHS } = require('./flow-paths');
const { ensureDir, fileExists, safeJsonParse } = require('./flow-io');
const { success, warn, info, color } = require('./flow-output');

// ============================================================
// Constants
// ============================================================

const SCHEMA_VERSION = 1;

/** Telemetry log path (JSONL, append-only) */
const TELEMETRY_LOG = path.join(PATHS.state, 'gate-telemetry.jsonl');

/** Archive directory for rotated logs */
const TELEMETRY_ARCHIVE = path.join(PATHS.state, 'gate-telemetry-archive');

/** Rotate when the active log exceeds this size */
const ROTATE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Verdicts allowed on a gate event */
const VALID_VERDICTS = new Set(['PASS', 'CONCERN', 'FAIL', 'ERROR', 'SKIP']);

/**
 * Canonical gate IDs known to the telemetry system.
 * New gates register themselves on first recordGateEvent() — this set exists
 * for documentation and CLI --gate filtering. Additions are non-breaking.
 */
const KNOWN_GATES = new Set([
  // Existing gates (retroactively instrumented by this story)
  'skeptical-evaluator',    // Step 3.56 — post-implementation diff review
  'scope-confidence',       // Step 1.45 — assumption verification
  'standards-gate',         // Step 3.7 — naming/security/reuse
  'runtime-verification',   // Step 3.58 — auto-test generation
  'integration-wiring',     // Step 3.6 — import / export chain check
  'criteria-verification',  // Step 3.5 — acceptance criteria coverage
  // IGR gates (added by subsequent stories)
  'logic-adversary',        // Stage 4 — pre-spec plan adversary
  'intent-framing',         // Stage 2 — per-task intent grounding
  'architect-pass',         // Stage 3 — plan quality
  'completion-truth-gate',  // Stage 6 — evidence-tier audit
]);

// ============================================================
// Event recording
// ============================================================

/**
 * Record a gate event to the telemetry log.
 *
 * Required fields: gateId, verdict.
 * Recommended: taskId, gateVersion, findingCount, durationMs.
 *
 * Returns the enriched event (with auto-filled ts, invocationId, v, inputHash).
 *
 * @param {Object} event - The gate event to record.
 * @param {string} event.gateId - Canonical gate ID (e.g., 'logic-adversary').
 * @param {string} event.verdict - 'PASS' | 'CONCERN' | 'FAIL' | 'ERROR' | 'SKIP'.
 * @param {string} [event.taskId] - Task being evaluated.
 * @param {string} [event.gateVersion] - Rubric/logic version of the gate.
 * @param {number} [event.findingCount] - How many issues caught.
 * @param {string[]} [event.findingSummary] - Short descriptions (≤200 chars each).
 * @param {number} [event.iterations] - Iteration count for looped gates.
 * @param {number} [event.durationMs] - How long the gate took.
 * @param {string} [event.input] - Input content to hash (will be hashed + discarded).
 * @param {Object} [event.metadata] - Gate-specific extras.
 * @returns {Object} The enriched event as written.
 */
function recordGateEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('recordGateEvent: event must be an object');
  }
  if (!event.gateId || typeof event.gateId !== 'string') {
    throw new TypeError('recordGateEvent: gateId is required');
  }
  if (!event.verdict || !VALID_VERDICTS.has(event.verdict)) {
    throw new TypeError(
      `recordGateEvent: verdict must be one of ${[...VALID_VERDICTS].join(', ')}`
    );
  }

  const enriched = {
    v: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    invocationId: 'evt-' + crypto.randomBytes(6).toString('hex'),
    gateId: event.gateId,
    gateVersion: event.gateVersion || 'unversioned',
    taskId: event.taskId || null,
    verdict: event.verdict,
    findingCount: typeof event.findingCount === 'number' ? event.findingCount : null,
    findingSummary: Array.isArray(event.findingSummary)
      ? event.findingSummary.map((s) => String(s).slice(0, 200))
      : [],
    iterations: typeof event.iterations === 'number' ? event.iterations : null,
    durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
    inputHash: event.input ? hashInput(event.input) : null,
    downstream: {
      userCorrectedAfterPass: false,
      blockedByGate: event.verdict === 'FAIL',
    },
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  };

  try {
    ensureDir(PATHS.state);
    fs.appendFileSync(TELEMETRY_LOG, JSON.stringify(enriched) + '\n', 'utf-8');
    rotateIfNeeded();
  } catch (err) {
    // Never throw from telemetry — it is never more important than the task.
    warn(`gate-telemetry: failed to record event for ${event.gateId}: ${err.message}`);
  }

  return enriched;
}

/**
 * Correlate a later-observed failure signal with an earlier gate verdict.
 *
 * SEC-002 fix (2026-04-13): previously used read-modify-writeFileSync which
 * races with concurrent appendFileSync calls from other hook processes and
 * silently drops events that arrive between the read and the overwrite.
 *
 * Now uses append-only semantics — writes a correction-annotation event
 * (gateId: `miss:<origGateId>`) tagged with the original event's
 * invocationId reference. Stats aggregation joins annotations back to their
 * origin events. No file rewrite, no race window.
 *
 * @param {string} gateId
 * @param {string} taskId
 * @param {Object} correction - { userMessage, durableRule, at }
 * @returns {number} Number of annotation events written (0 or 1).
 */
function correlateMiss(gateId, taskId, correction) {
  if (!fileExists(TELEMETRY_LOG)) return 0;

  // Find the most-recent PASS event for this gate+task. We need ONLY the
  // invocationId; we don't rewrite the event itself.
  const lines = readLogLines(TELEMETRY_LOG);
  let targetEvent = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ev = safeParseLine(lines[i]);
    if (!ev) continue;
    if (ev.gateId === gateId && ev.taskId === taskId && ev.verdict === 'PASS') {
      targetEvent = ev;
      break;
    }
  }
  if (!targetEvent) return 0;

  // Append a correction-annotation event — append-only, race-safe.
  const annotation = {
    v: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    invocationId: 'evt-' + crypto.randomBytes(6).toString('hex'),
    gateId: 'miss:' + gateId,
    gateVersion: '1.0',
    taskId,
    verdict: 'MISS',
    findingCount: 1,
    findingSummary: [(correction?.durableRule || '').slice(0, 200)],
    iterations: null,
    durationMs: null,
    inputHash: null,
    downstream: {
      annotatesInvocationId: targetEvent.invocationId,
      annotatesGateId: gateId,
      correctionAt: correction?.at || new Date().toISOString(),
      correctionRule: (correction?.durableRule || '').slice(0, 200),
    },
    metadata: {
      kind: 'correction-annotation',
      annotatedVerdictWas: 'PASS',
    },
  };
  try {
    ensureDir(PATHS.state);
    fs.appendFileSync(TELEMETRY_LOG, JSON.stringify(annotation) + '\n', 'utf-8');
    rotateIfNeeded();
    return 1;
  } catch (err) {
    warn(`gate-telemetry: correlateMiss annotation write failed: ${err.message}`);
    return 0;
  }
}

// ============================================================
// Aggregation / stats
// ============================================================

/**
 * Aggregate telemetry events into per-gate stats.
 *
 * @param {Object} [options]
 * @param {Date|string|number} [options.since] - Only include events at/after this time.
 * @param {string} [options.gateId] - Filter to a single gate.
 * @returns {Object} { totalEvents, perGate: { gateId: stats } }
 */
function getGateStats(options = {}) {
  const sinceMs = options.since ? new Date(options.since).getTime() : 0;
  const targetGate = options.gateId || null;

  const stats = { totalEvents: 0, perGate: {} };

  if (!fileExists(TELEMETRY_LOG)) return stats;

  // SEC-002 fix: miss correlations are now append-only annotation events with
  // gateId `miss:<original>`. Two passes: (1) collect annotations keyed by
  // (gateId, invocationId) so we can credit the miss back to the origin gate;
  // (2) tabulate gate events, joining annotations in at the origin.
  const missesByOriginGate = new Map(); // originGateId → Set<invocationId>
  for (const line of readLogLines(TELEMETRY_LOG)) {
    const ev = safeParseLine(line);
    if (!ev || !ev.gateId || !ev.gateId.startsWith('miss:')) continue;
    const originGateId = ev.downstream?.annotatesGateId || ev.gateId.slice('miss:'.length);
    const originInvocationId = ev.downstream?.annotatesInvocationId;
    if (!originInvocationId) continue;
    if (!missesByOriginGate.has(originGateId)) missesByOriginGate.set(originGateId, new Set());
    missesByOriginGate.get(originGateId).add(originInvocationId);
  }

  for (const line of readLogLines(TELEMETRY_LOG)) {
    const ev = safeParseLine(line);
    if (!ev) continue;
    if (sinceMs && new Date(ev.ts).getTime() < sinceMs) continue;
    if (targetGate && ev.gateId !== targetGate) continue;

    // Skip annotation events themselves when tabulating per-gate stats UNLESS
    // the caller explicitly filtered to the miss:<gate> pseudo-gate.
    if (ev.gateId && ev.gateId.startsWith('miss:') && (!targetGate || !targetGate.startsWith('miss:'))) {
      continue;
    }

    stats.totalEvents++;
    const g = (stats.perGate[ev.gateId] = stats.perGate[ev.gateId] || {
      invocations: 0,
      verdicts: { PASS: 0, CONCERN: 0, FAIL: 0, ERROR: 0, SKIP: 0 },
      totalFindings: 0,
      totalIterations: 0,
      totalDurationMs: 0,
      missedAfterPass: 0,
    });

    g.invocations++;
    g.verdicts[ev.verdict] = (g.verdicts[ev.verdict] || 0) + 1;
    if (typeof ev.findingCount === 'number') g.totalFindings += ev.findingCount;
    if (typeof ev.iterations === 'number') g.totalIterations += ev.iterations;
    if (typeof ev.durationMs === 'number') g.totalDurationMs += ev.durationMs;

    // Count miss: (a) legacy in-line mutation (userCorrectedAfterPass flag on the event itself)
    // or (b) new append-only annotation joined by invocationId.
    if (ev.downstream?.userCorrectedAfterPass) g.missedAfterPass++;
    else if (missesByOriginGate.get(ev.gateId)?.has(ev.invocationId)) g.missedAfterPass++;
  }

  for (const gateId of Object.keys(stats.perGate)) {
    const g = stats.perGate[gateId];
    g.passRate = g.invocations ? g.verdicts.PASS / g.invocations : 0;
    g.catchRate = g.invocations
      ? (g.verdicts.CONCERN + g.verdicts.FAIL) / g.invocations
      : 0;
    g.missRate = g.verdicts.PASS ? g.missedAfterPass / g.verdicts.PASS : 0;
    g.avgFindings = g.invocations ? g.totalFindings / g.invocations : 0;
    g.avgIterations = g.invocations ? g.totalIterations / g.invocations : 0;
    g.avgDurationMs = g.invocations ? g.totalDurationMs / g.invocations : 0;
  }

  return stats;
}

// ============================================================
// Rotation
// ============================================================

/**
 * Rotate the active log to the archive directory if it exceeds ROTATE_SIZE_BYTES.
 * Archive filename: gate-telemetry-YYYYMMDD-HHMMSS.jsonl
 *
 * @returns {string|null} Path to archived file, or null if no rotation occurred.
 */
function rotateIfNeeded() {
  if (!fileExists(TELEMETRY_LOG)) return null;

  let size;
  try {
    size = fs.statSync(TELEMETRY_LOG).size;
  } catch (_err) {
    return null;
  }

  if (size < ROTATE_SIZE_BYTES) return null;

  // CL-005 fix (2026-04-13): atomic rotation under concurrent processes.
  // Race scenario: two processes both pass the size check, both attempt rename.
  // We use linkSync as a lock primitive — only one process succeeds. The loser
  // observes ENOENT/EEXIST on the lock and skips rotation (the winner did it).
  ensureDir(TELEMETRY_ARCHIVE);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '-').slice(0, 19);
  const archivePath = path.join(TELEMETRY_ARCHIVE, `gate-telemetry-${stamp}.jsonl`);
  const lockPath = TELEMETRY_LOG + '.rotate.lock';

  // Acquire lock via exclusive create — atomic per POSIX/Win32.
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another process is rotating right now. Check if its lock is stale (>60s).
      try {
        const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (lockAge > 60000) {
          fs.unlinkSync(lockPath);
        }
      } catch (_err) { /* lock vanished — winner finished */ }
      return null;
    }
    warn(`gate-telemetry: rotation lock failed: ${err.message}`);
    return null;
  }

  try {
    // Re-check size under lock — another process may have rotated already.
    if (!fileExists(TELEMETRY_LOG) || fs.statSync(TELEMETRY_LOG).size < ROTATE_SIZE_BYTES) {
      return null;
    }
    fs.renameSync(TELEMETRY_LOG, archivePath);
    return archivePath;
  } catch (err) {
    warn(`gate-telemetry: rotation failed: ${err.message}`);
    return null;
  } finally {
    try { fs.closeSync(lockFd); } catch (_err) { /* no-op */ }
    try { fs.unlinkSync(lockPath); } catch (_err) { /* no-op */ }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Hash an input value to a short, stable string.
 * Objects are stringified canonically (sorted keys).
 */
function hashInput(input) {
  const h = crypto.createHash('sha1');
  if (typeof input === 'string') {
    h.update(input);
  } else if (input && typeof input === 'object') {
    h.update(JSON.stringify(input, Object.keys(input).sort()));
  } else {
    h.update(String(input));
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Read log lines without loading the full file into one string when avoidable.
 * For small files (< 10 MB), a single read is fine; we rotate before exceeding.
 */
function readLogLines(logPath) {
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter((l) => l.trim().length > 0);
  } catch (_err) {
    return [];
  }
}

function safeParseLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

/**
 * Parse human-friendly duration strings like "7d", "24h", "30m" into ms.
 */
function parseSince(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d+)([dhms])$/);
  if (!m) {
    const asDate = new Date(s);
    return isNaN(asDate.getTime()) ? 0 : Date.now() - asDate.getTime();
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms = { d: 86400e3, h: 3600e3, m: 60e3, s: 1000 }[unit];
  return n * ms;
}

// ============================================================
// Schema exposure
// ============================================================

const SCHEMA = {
  version: SCHEMA_VERSION,
  requiredFields: ['gateId', 'verdict'],
  recommendedFields: ['taskId', 'gateVersion', 'findingCount', 'durationMs'],
  verdicts: [...VALID_VERDICTS],
  knownGates: [...KNOWN_GATES],
  eventShape: {
    v: 'integer — schema version',
    ts: 'ISO-8601 string — event time',
    invocationId: 'string — unique per event',
    gateId: 'string — canonical gate identifier',
    gateVersion: 'string — version of the gate logic/rubric at record time',
    taskId: 'string|null — task being evaluated',
    verdict: 'PASS|CONCERN|FAIL|ERROR|SKIP',
    findingCount: 'number|null',
    findingSummary: 'string[] — short descriptions, each ≤200 chars',
    iterations: 'number|null',
    durationMs: 'number|null',
    inputHash: 'string|null — 16-char sha1 prefix of hashed input',
    downstream: {
      userCorrectedAfterPass: 'boolean — cross-referenced from session-corrections',
      blockedByGate: 'boolean',
      correctionAt: 'ISO timestamp|undefined',
      correctionRule: 'string|undefined — short summary',
    },
    metadata: 'object — gate-specific extras',
  },
};

// ============================================================
// CLI
// ============================================================

function cliStats(argv) {
  const args = parseArgs(argv);
  const opts = {};
  if (args.since) opts.since = Date.now() - parseSince(args.since);
  if (args.gate) opts.gateId = args.gate;

  const stats = getGateStats(opts);
  if (stats.totalEvents === 0) {
    info('No gate telemetry events recorded yet.');
    return;
  }

  const headers = ['gateId', 'invocations', 'pass%', 'catch%', 'miss%', 'avgMs', 'misses'];
  const rows = Object.entries(stats.perGate).map(([id, g]) => [
    id,
    g.invocations.toString(),
    (g.passRate * 100).toFixed(1) + '%',
    (g.catchRate * 100).toFixed(1) + '%',
    (g.missRate * 100).toFixed(1) + '%',
    g.avgDurationMs.toFixed(0),
    g.missedAfterPass.toString(),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const line = (r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  console.log(color('bold', line(headers)));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log();
  console.log(`Total events: ${stats.totalEvents}`);
  if (opts.since) console.log(`Since: ${new Date(opts.since).toISOString()}`);
}

function cliRotate() {
  const archived = rotateIfNeeded();
  if (archived) {
    success(`Rotated telemetry log to ${archived}`);
  } else if (!fileExists(TELEMETRY_LOG)) {
    info('No telemetry log to rotate.');
  } else {
    info('Telemetry log below rotation threshold — no action taken.');
  }
}

function cliSchema() {
  console.log(JSON.stringify(SCHEMA, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (const token of argv) {
    const m = token.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (token.startsWith('--')) out[token.slice(2)] = true;
  }
  return out;
}

// ============================================================
// Main
// ============================================================

if (require.main === module) {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'stats':
      cliStats(rest);
      break;
    case 'rotate':
      cliRotate();
      break;
    case 'schema':
      cliSchema();
      break;
    case 'record': {
      // Used by other scripts via child_process when they cannot require() us
      // directly (e.g., shell hook entry points). Reads JSON from stdin.
      let raw = '';
      process.stdin.on('data', (chunk) => (raw += chunk));
      process.stdin.on('end', () => {
        try {
          const event = JSON.parse(raw);
          const written = recordGateEvent(event);
          console.log(JSON.stringify({ ok: true, invocationId: written.invocationId }));
        } catch (err) {
          console.error(JSON.stringify({ ok: false, error: err.message }));
          process.exit(1);
        }
      });
      break;
    }
    default:
      console.log(`Usage: node scripts/flow-gate-telemetry.js <command> [options]

Commands:
  stats [--since=7d] [--gate=ID]    Print per-gate stats table
  rotate                             Rotate the telemetry log if over threshold
  schema                             Print the event schema as JSON
  record                             Read a JSON event from stdin and append it

Examples:
  flow gate-stats --since=30d
  flow gate-stats --gate=logic-adversary
  echo '{"gateId":"test","verdict":"PASS"}' | node scripts/flow-gate-telemetry.js record
`);
  }
}

module.exports = {
  recordGateEvent,
  correlateMiss,
  getGateStats,
  rotateIfNeeded,
  SCHEMA,
  SCHEMA_VERSION,
  VALID_VERDICTS,
  KNOWN_GATES,
  TELEMETRY_LOG,
  TELEMETRY_ARCHIVE,
};
