#!/usr/bin/env node

/**
 * Wogi Workspace — SQLite IPC Index (wf-3635574e / G3)
 *
 * Per-worker SQLite-backed atomicity index over the JSON message bus.
 *
 * Layout (per AC2):
 *   .workspace/state/ipc/<repoName>/inbound.db   — manager is sole writer
 *   .workspace/state/ipc/<repoName>/outbound.db  — worker is sole writer
 *
 * Schema (per AC1):
 *   messages(id TEXT PK, kind TEXT, payload TEXT, created_at TEXT, consumed_at TEXT)
 *
 * Role (Path B — index on top of JSON):
 *   JSON files in `.workspace/messages/` remain the authoritative store.
 *   SQLite indexes (id, status, direction) and provides atomic read-and-mark
 *   for consumer hot paths. On SQLite unavailability, callers transparently
 *   use JSON (per AC5).
 *
 * Design notes:
 *   - sql.js (pure-WASM) is used — already a required dep.
 *   - Init is async; all public APIs are async.
 *   - Single-writer contract is enforced by directory layout + caller convention.
 *   - Persistence: db.export() + atomic temp-file-rename (same pattern as
 *     scripts/flow-memory-db.js).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeJsonParse } = require('../scripts/flow-io');

// ============================================================
// Module-level state
// ============================================================

let SQL = null;
let sqlInitPromise = null;
let sqlUnavailableReason = null;
const openDbs = new Map(); // dbPath -> { db, dirty }

// ============================================================
// Constants
// ============================================================

const VALID_DIRECTIONS = new Set(['inbound', 'outbound']);
const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    consumed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_unconsumed
    ON messages(consumed_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_kind
    ON messages(kind);
`;

// ============================================================
// sql.js lifecycle
// ============================================================

/**
 * Lazy-load sql.js. Idempotent. Caches unavailability reason on failure.
 * @returns {Promise<object|null>} SQL namespace, or null if unavailable.
 */
async function ensureSqlJs() {
  if (SQL) return SQL;
  if (sqlUnavailableReason) return null;
  if (sqlInitPromise) return sqlInitPromise;

  sqlInitPromise = (async () => {
    try {
      const initSqlJs = require('sql.js');
      SQL = await initSqlJs();
      return SQL;
    } catch (err) {
      sqlUnavailableReason = err && err.message ? err.message : String(err);
      return null;
    }
  })();

  return sqlInitPromise;
}

/**
 * Check if SQLite IPC is available in this process. Side-effect-free after first call.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  const sql = await ensureSqlJs();
  return !!sql;
}

/**
 * Why SQLite is unavailable (if it is). For diagnostics + AC5 deprecation warning.
 * @returns {string|null}
 */
function unavailableReason() {
  return sqlUnavailableReason;
}

// ============================================================
// Path helpers
// ============================================================

function validateRepoName(repoName) {
  if (!VALID_NAME.test(repoName || '')) {
    throw new Error(`Invalid repoName: ${JSON.stringify(repoName)} (must match ${VALID_NAME})`);
  }
}

function validateDirection(direction) {
  if (!VALID_DIRECTIONS.has(direction)) {
    throw new Error(`Invalid direction: ${direction} (must be inbound|outbound)`);
  }
}

function ipcRoot(workspaceRoot) {
  return path.join(workspaceRoot, '.workspace', 'state', 'ipc');
}

function dbPath(workspaceRoot, repoName, direction) {
  validateRepoName(repoName);
  validateDirection(direction);
  return path.join(ipcRoot(workspaceRoot), repoName, `${direction}.db`);
}

// ============================================================
// DB open / close / persist
// ============================================================

async function openDb(dbFilePath) {
  const sql = await ensureSqlJs();
  if (!sql) return null;

  if (openDbs.has(dbFilePath)) {
    return openDbs.get(dbFilePath).db;
  }

  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

  let db;
  if (fs.existsSync(dbFilePath)) {
    const buf = fs.readFileSync(dbFilePath);
    db = new sql.Database(buf);
  } else {
    db = new sql.Database();
  }

  db.run(SCHEMA_SQL);
  openDbs.set(dbFilePath, { db, dirty: false });
  return db;
}

function markDirty(dbFilePath) {
  const entry = openDbs.get(dbFilePath);
  if (entry) entry.dirty = true;
}

/**
 * Persist the DB to disk atomically (temp file + rename).
 * Safe against mid-write crash: readers see either old or new file, never torn.
 */
async function persistDb(dbFilePath) {
  const entry = openDbs.get(dbFilePath);
  if (!entry || !entry.dirty) return;

  const data = entry.db.export();
  const buffer = Buffer.from(data);
  const tempPath = `${dbFilePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, dbFilePath);
    entry.dirty = false;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_err) { /* best effort */ }
    throw err;
  }
}

/**
 * Close a specific DB (persists first if dirty).
 */
async function closeDb(dbFilePath) {
  const entry = openDbs.get(dbFilePath);
  if (!entry) return;
  if (entry.dirty) await persistDb(dbFilePath);
  entry.db.close();
  openDbs.delete(dbFilePath);
}

/**
 * Close all open DBs. Useful for tests and process shutdown.
 */
async function closeAll() {
  const paths = Array.from(openDbs.keys());
  for (const p of paths) {
    try { await closeDb(p); } catch (_err) { /* continue */ }
  }
}

// ============================================================
// Core operations
// ============================================================

/**
 * Index a message. Idempotent by id (UPSERT).
 *
 * @param {string} workspaceRoot
 * @param {string} repoName — the per-worker DB the message belongs to
 * @param {string} direction — 'inbound' (manager→worker) or 'outbound' (worker→manager)
 * @param {Object} msg
 * @param {string} msg.id
 * @param {string} msg.kind — e.g. 'task-dispatch', 'task-complete', 'question'
 * @param {Object} msg.payload — arbitrary JSON-serializable
 * @param {string} [msg.createdAt] — ISO; defaults to now
 * @param {string|null} [msg.consumedAt] — ISO or null; defaults to null
 * @returns {Promise<boolean>} true if indexed, false if SQLite unavailable
 */
async function indexMessage(workspaceRoot, repoName, direction, msg) {
  if (!msg || typeof msg.id !== 'string' || !msg.id) {
    throw new Error('indexMessage: msg.id required');
  }
  if (typeof msg.kind !== 'string' || !msg.kind) {
    throw new Error('indexMessage: msg.kind required');
  }

  const dbFilePath = dbPath(workspaceRoot, repoName, direction);
  const db = await openDb(dbFilePath);
  if (!db) return false;

  const payloadJson = JSON.stringify(msg.payload ?? {});
  const createdAt = msg.createdAt || new Date().toISOString();
  const consumedAt = msg.consumedAt || null;

  db.run(
    `INSERT INTO messages (id, kind, payload, created_at, consumed_at)
     VALUES ($id, $kind, $payload, $created_at, $consumed_at)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       payload = excluded.payload,
       created_at = excluded.created_at,
       consumed_at = COALESCE(messages.consumed_at, excluded.consumed_at)`,
    {
      $id: msg.id,
      $kind: msg.kind,
      $payload: payloadJson,
      $created_at: createdAt,
      $consumed_at: consumedAt
    }
  );

  markDirty(dbFilePath);
  await persistDb(dbFilePath);
  return true;
}

/**
 * List unconsumed messages (read-only — does NOT mark consumed).
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @param {string} direction
 * @param {Object} [opts]
 * @param {string} [opts.kind] — filter by kind
 * @param {number} [opts.limit]
 * @returns {Promise<Array<{id, kind, payload, createdAt}>>} empty array if unavailable
 */
async function listUnconsumed(workspaceRoot, repoName, direction, opts = {}) {
  const dbFilePath = dbPath(workspaceRoot, repoName, direction);
  if (!fs.existsSync(dbFilePath)) return [];
  const db = await openDb(dbFilePath);
  if (!db) return [];

  let sql = `SELECT id, kind, payload, created_at
             FROM messages
             WHERE consumed_at IS NULL`;
  const params = {};
  if (opts.kind) {
    sql += ` AND kind = $kind`;
    params.$kind = opts.kind;
  }
  sql += ` ORDER BY created_at ASC`;
  if (Number.isInteger(opts.limit) && opts.limit > 0) {
    sql += ` LIMIT ${opts.limit}`;
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push({
      id: r.id,
      kind: r.kind,
      payload: parsePayload(r.payload),
      createdAt: r.created_at
    });
  }
  stmt.free();
  return rows;
}

/**
 * Atomically read unconsumed messages and mark every examined row consumed.
 *
 * AC3. Within one process this is atomic (single-threaded JS + SQLite txn).
 * Cross-process atomicity relies on single-writer contract (AC2) — only one
 * process writes any given DB file.
 *
 * Optional verifier: receives each candidate row; return `true` to include
 * the row in the return value, `false` to exclude. ALL examined rows (up
 * to `limit`) get `consumed_at` set regardless — this prevents leaked
 * index entries when JSON authority says a row is already resolved.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @param {string} direction
 * @param {Object} [opts]
 * @param {string} [opts.kind]
 * @param {number} [opts.limit]
 * @param {(row) => boolean} [opts.verifier]
 * @returns {Promise<Array<{id, kind, payload, createdAt, consumedAt}>>} returned rows
 */
async function readAndMarkConsumed(workspaceRoot, repoName, direction, opts = {}) {
  const dbFilePath = dbPath(workspaceRoot, repoName, direction);
  if (!fs.existsSync(dbFilePath)) return [];
  const db = await openDb(dbFilePath);
  if (!db) return [];

  db.run('SAVEPOINT read_and_mark');
  try {
    const candidates = await listUnconsumed(workspaceRoot, repoName, direction, opts);
    if (candidates.length === 0) {
      db.run('RELEASE read_and_mark');
      return [];
    }

    const verifier = typeof opts.verifier === 'function' ? opts.verifier : null;
    const returned = verifier ? candidates.filter(verifier) : candidates;

    // Mark ALL examined rows consumed — prevents index-leak when verifier skips.
    const consumedAt = new Date().toISOString();
    const allIds = candidates.map(r => r.id);
    const placeholders = allIds.map(() => '?').join(',');
    db.run(
      `UPDATE messages SET consumed_at = ? WHERE id IN (${placeholders}) AND consumed_at IS NULL`,
      [consumedAt, ...allIds]
    );
    db.run('RELEASE read_and_mark');

    markDirty(dbFilePath);
    await persistDb(dbFilePath);

    return returned.map(r => ({ ...r, consumedAt }));
  } catch (err) {
    try { db.run('ROLLBACK TO read_and_mark'); db.run('RELEASE read_and_mark'); } catch (_err) { /* best effort */ }
    throw err;
  }
}

/**
 * Sync the index from an authoritative JSON messages directory.
 *
 * Path B pattern: JSON files remain authoritative; SQLite is a derived index.
 * This helper scans `.workspace/messages/msg-*.json` and indexes any ids not
 * already present. Idempotent — safe to call before each atomic-consume.
 *
 * Does NOT overwrite existing rows' `consumed_at`; UPSERT preserves it via
 * COALESCE in indexMessage's ON CONFLICT clause.
 *
 * @param {string} workspaceRoot
 * @returns {Promise<{scanned, indexed, skipped}>}
 */
async function syncFromJsonDir(workspaceRoot) {
  const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
  if (!fs.existsSync(messagesDir)) return { scanned: 0, indexed: 0, skipped: 0 };
  if (!(await isAvailable())) return { scanned: 0, indexed: 0, skipped: 0 };

  const files = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
  let indexed = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(messagesDir, file);
    const msg = safeJsonParse(filePath, null);
    if (!msg || !msg.id) { skipped++; continue; }

    const route = routeMessageForIndex(msg);
    if (!route) { skipped++; continue; }

    const consumedAt = inferConsumedFromJson(msg);
    const ok = await indexMessage(workspaceRoot, route.repoName, route.direction, {
      id: msg.id,
      kind: typeof msg.type === 'string' ? msg.type : 'unknown',
      payload: msg,
      createdAt: msg.timestamp || new Date().toISOString(),
      consumedAt
    });
    if (ok) indexed++; else skipped++;
  }

  return { scanned: files.length, indexed, skipped };
}

function routeMessageForIndex(msg) {
  const from = typeof msg.from === 'string' ? msg.from : '';
  const to = typeof msg.to === 'string' ? msg.to : '';

  if (from === 'manager' && to && to !== 'all' && to !== 'manager') {
    return { repoName: to, direction: 'inbound' };
  }
  if (to === 'manager' && from) {
    return { repoName: from, direction: 'outbound' };
  }
  if (to === 'all' && from && from !== 'manager') {
    return { repoName: from, direction: 'outbound' };
  }
  if (from && to && from !== to) {
    return { repoName: to, direction: 'inbound' };
  }
  return null;
}

function inferConsumedFromJson(msg) {
  if (typeof msg.consumed_at === 'string') return msg.consumed_at;
  if (typeof msg.consumedAt === 'string') return msg.consumedAt;
  if (msg.status && msg.status !== 'pending') {
    return msg.updatedAt || msg.resolvedAt || null;
  }
  return null;
}

/**
 * Mark a specific set of message ids as consumed (no read).
 *
 * @returns {Promise<number>} number of rows updated
 */
async function markConsumed(workspaceRoot, repoName, direction, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const dbFilePath = dbPath(workspaceRoot, repoName, direction);
  if (!fs.existsSync(dbFilePath)) return 0;
  const db = await openDb(dbFilePath);
  if (!db) return 0;

  const consumedAt = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  db.run(
    `UPDATE messages SET consumed_at = ? WHERE id IN (${placeholders}) AND consumed_at IS NULL`,
    [consumedAt, ...ids]
  );
  // sql.js doesn't expose rows-affected directly; count via SELECT changes()
  const res = db.exec('SELECT changes() AS n');
  const n = (res[0] && res[0].values[0] && res[0].values[0][0]) || 0;
  markDirty(dbFilePath);
  await persistDb(dbFilePath);
  return n;
}

/**
 * Count rows by status. Diagnostic / metrics.
 * @returns {Promise<{total, unconsumed, consumed}>} zeros if unavailable
 */
async function stats(workspaceRoot, repoName, direction) {
  const dbFilePath = dbPath(workspaceRoot, repoName, direction);
  if (!fs.existsSync(dbFilePath)) return { total: 0, unconsumed: 0, consumed: 0 };
  const db = await openDb(dbFilePath);
  if (!db) return { total: 0, unconsumed: 0, consumed: 0 };

  const row = db.exec(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE consumed_at IS NULL) AS unconsumed,
      COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed
    FROM messages
  `);
  const vals = (row[0] && row[0].values[0]) || [0, 0, 0];
  return { total: vals[0] || 0, unconsumed: vals[1] || 0, consumed: vals[2] || 0 };
}

/**
 * List all repo names with IPC dirs under workspaceRoot.
 * @returns {Array<string>}
 */
function listIndexedRepos(workspaceRoot) {
  const root = ipcRoot(workspaceRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => {
    try {
      const st = fs.statSync(path.join(root, name));
      return st.isDirectory() && VALID_NAME.test(name);
    } catch (_err) {
      return false;
    }
  });
}

// ============================================================
// Helpers
// ============================================================

function parsePayload(raw) {
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    // Prototype-pollution guard
    if (parsed && typeof parsed === 'object') {
      delete parsed.__proto__;
      delete parsed.constructor;
      delete parsed.prototype;
    }
    return parsed;
  } catch (_err) {
    return { _raw: raw, _parseError: true };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Lifecycle
  isAvailable,
  unavailableReason,
  closeDb,
  closeAll,
  // Paths
  ipcRoot,
  dbPath,
  listIndexedRepos,
  // Core ops
  indexMessage,
  listUnconsumed,
  readAndMarkConsumed,
  markConsumed,
  syncFromJsonDir,
  routeMessageForIndex,
  stats,
  // Constants
  SCHEMA_SQL
};
