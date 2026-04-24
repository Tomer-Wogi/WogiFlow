#!/usr/bin/env node

/**
 * Wogi Workspace — IPC Migration / Re-Index (wf-3635574e / G3, AC4)
 *
 * One-shot + idempotent script that rebuilds the per-worker SQLite IPC index
 * (under `.workspace/state/ipc/<repoName>/{inbound,outbound}.db`) from the
 * authoritative JSON sources:
 *
 *   - `.workspace/messages/msg-*.json` (message bus)
 *   - `.workspace/state/dispatched-tasks.json` (ring buffer — optional)
 *
 * Routing per message `from`/`to`:
 *   from == 'manager'         → <to>/inbound.db
 *   to   == 'manager'         → <from>/outbound.db
 *   to   == 'all'             → <from>/outbound.db (broadcast)
 *   worker → worker           → <to>/inbound.db (manager-brokered semantics)
 *
 * Idempotent: UPSERT on message id. Re-running scans all JSON again and
 * re-writes, which is safe — consumed_at is preserved via COALESCE in the
 * UPSERT path (see workspace-ipc-sqlite.js).
 *
 * Usage:
 *   node scripts/flow-workspace-migrate-ipc.js <workspaceRoot> [--quiet]
 *   node scripts/flow-workspace-migrate-ipc.js --help
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ipc = require('../lib/workspace-ipc-sqlite');

const USAGE = `Usage: flow-workspace-migrate-ipc.js <workspaceRoot> [--quiet]

Rebuilds the SQLite IPC index from existing JSON message bus + dispatch
tracking files. Safe to run repeatedly; does not delete JSON files.

Options:
  --quiet    Suppress per-file log output.
  --help     Show this help.
`;

function log(quiet, ...args) {
  if (!quiet) console.log(...args);
}

function parseArgs(argv) {
  const args = { workspaceRoot: null, quiet: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--quiet' || a === '-q') { args.quiet = true; continue; }
    if (!args.workspaceRoot) { args.workspaceRoot = a; continue; }
  }
  return args;
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

/**
 * Decide which repo's DB and which direction an existing JSON message belongs to.
 */
function routeMessage(msg) {
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

function inferConsumedAt(msg) {
  if (typeof msg.consumed_at === 'string') return msg.consumed_at;
  if (typeof msg.consumedAt === 'string') return msg.consumedAt;
  if (msg.status && msg.status !== 'pending') {
    return msg.updatedAt || msg.resolvedAt || null;
  }
  return null;
}

async function migrateMessages(workspaceRoot, quiet) {
  const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
  if (!fs.existsSync(messagesDir)) {
    log(quiet, `[migrate-ipc] No messages dir at ${messagesDir} — skipping.`);
    return { scanned: 0, indexed: 0, skipped: 0 };
  }

  const files = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
  let indexed = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(messagesDir, file);
    const msg = safeReadJson(filePath);
    if (!msg || !msg.id) { skipped++; continue; }

    const route = routeMessage(msg);
    if (!route) { skipped++; continue; }

    const kind = typeof msg.type === 'string' ? msg.type : 'unknown';
    const ok = await ipc.indexMessage(workspaceRoot, route.repoName, route.direction, {
      id: msg.id,
      kind,
      payload: msg,
      createdAt: msg.timestamp || new Date().toISOString(),
      consumedAt: inferConsumedAt(msg)
    });

    if (ok) {
      indexed++;
      log(quiet, `[migrate-ipc] indexed ${msg.id} → ${route.repoName}/${route.direction}.db (${kind})`);
    } else {
      skipped++;
    }
  }

  return { scanned: files.length, indexed, skipped };
}

async function migrateDispatches(workspaceRoot, quiet) {
  const dispatchPath = path.join(workspaceRoot, '.workspace', 'state', 'dispatched-tasks.json');
  if (!fs.existsSync(dispatchPath)) {
    log(quiet, `[migrate-ipc] No dispatched-tasks.json — skipping dispatch index.`);
    return { scanned: 0, indexed: 0, skipped: 0 };
  }

  const state = safeReadJson(dispatchPath);
  if (!state || !Array.isArray(state.dispatches)) {
    return { scanned: 0, indexed: 0, skipped: 0 };
  }

  let indexed = 0;
  let skipped = 0;

  for (const rec of state.dispatches) {
    if (!rec || !rec.taskId || !rec.repoName) { skipped++; continue; }

    // Synthesize a stable message id from taskId + dispatchedAt.
    const id = `disp-${rec.taskId}-${Date.parse(rec.dispatchedAt || '') || 0}`.substring(0, 80);

    const ok = await ipc.indexMessage(workspaceRoot, rec.repoName, 'inbound', {
      id,
      kind: 'task-dispatch',
      payload: rec,
      createdAt: rec.dispatchedAt || new Date().toISOString(),
      consumedAt: rec.reconciledAt || (rec.status && rec.status !== 'pending' ? new Date().toISOString() : null)
    });

    if (ok) indexed++;
    else skipped++;
  }

  return { scanned: state.dispatches.length, indexed, skipped };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(USAGE); process.exit(0); }

  const workspaceRoot = args.workspaceRoot
    || process.env.WOGI_WORKSPACE_ROOT
    || process.cwd();

  if (!fs.existsSync(workspaceRoot)) {
    console.error(`[migrate-ipc] Workspace root does not exist: ${workspaceRoot}`);
    process.exit(2);
  }

  if (!(await ipc.isAvailable())) {
    console.error(`[migrate-ipc] SQLite (sql.js) unavailable: ${ipc.unavailableReason()}`);
    console.error(`[migrate-ipc] AC5 fallback active — JSON message bus will continue to serve reads/writes.`);
    console.error(`[migrate-ipc] No migration performed.`);
    process.exit(3);
  }

  log(args.quiet, `[migrate-ipc] workspaceRoot: ${workspaceRoot}`);
  log(args.quiet, `[migrate-ipc] SQLite ready.`);

  const msgRes = await migrateMessages(workspaceRoot, args.quiet);
  log(args.quiet, `[migrate-ipc] messages: scanned=${msgRes.scanned} indexed=${msgRes.indexed} skipped=${msgRes.skipped}`);

  const dispRes = await migrateDispatches(workspaceRoot, args.quiet);
  log(args.quiet, `[migrate-ipc] dispatches: scanned=${dispRes.scanned} indexed=${dispRes.indexed} skipped=${dispRes.skipped}`);

  await ipc.closeAll();

  const repos = ipc.listIndexedRepos(workspaceRoot);
  log(args.quiet, `[migrate-ipc] indexed repos: ${repos.join(', ') || '(none)'}`);
  log(args.quiet, `[migrate-ipc] done.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[migrate-ipc] FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { routeMessage, migrateMessages, migrateDispatches };
