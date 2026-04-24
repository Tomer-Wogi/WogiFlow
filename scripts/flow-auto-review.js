#!/usr/bin/env node
'use strict';

/**
 * Wogi Flow — Auto-Review CLI (wf-8d635d0e / E1)
 *
 * Usage:
 *   flow-auto-review.js start  --task <id> [--repoRoot <path>]
 *   flow-auto-review.js status --task <id>
 *   flow-auto-review.js await  --task <id> [--timeoutMs 90000]
 */

const { startReview, readFindings, awaitFindings, DEFAULT_TIMEOUT_MS } = require('../lib/worktree-review');
const { getConfig } = require('./flow-utils');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return out;
}

function autoReviewEnabled() {
  try {
    const cfg = getConfig();
    return cfg?.autoReview?.enabled === true;
  } catch (_err) {
    return false;
  }
}

function getTimeoutMs() {
  try {
    const cfg = getConfig();
    const v = cfg?.autoReview?.timeoutMs;
    return typeof v === 'number' && v > 0 ? v : DEFAULT_TIMEOUT_MS;
  } catch (_err) {
    return DEFAULT_TIMEOUT_MS;
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command) {
    console.error('Usage: flow-auto-review.js <start|status|await> --task <id> [opts]');
    process.exit(1);
  }

  if (command === 'start') {
    if (!autoReviewEnabled()) {
      // Silent no-op when disabled — matches flow-phase.js convention.
      process.exit(0);
    }
    const taskId = args.task;
    if (!taskId) {
      console.error('flow-auto-review start requires --task <id>');
      process.exit(1);
    }
    const repoRoot = args.repoRoot || process.cwd();
    const handle = startReview({ taskId, repoRoot });
    console.log(JSON.stringify({ ok: true, ...handle }));
    return;
  }

  if (command === 'status') {
    const taskId = args.task;
    if (!taskId) {
      console.error('flow-auto-review status requires --task <id>');
      process.exit(1);
    }
    const rec = readFindings(taskId);
    console.log(JSON.stringify(rec || { taskId, status: 'none' }, null, 2));
    return;
  }

  if (command === 'await') {
    const taskId = args.task;
    if (!taskId) {
      console.error('flow-auto-review await requires --task <id>');
      process.exit(1);
    }
    const timeoutMs = args.timeoutMs ? parseInt(args.timeoutMs, 10) : getTimeoutMs();
    const rec = await awaitFindings(taskId, timeoutMs);
    console.log(JSON.stringify(rec, null, 2));
    return;
  }

  console.error(`Unknown subcommand: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
