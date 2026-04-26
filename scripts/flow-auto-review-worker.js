#!/usr/bin/env node
'use strict';

/**
 * Auto-Review Worker (detached child invoked by lib/worktree-review.js).
 *
 * Responsibilities:
 *   1. Create an isolated worktree via flow-worktree.createWorktree.
 *   2. Invoke the runReview() core on the worktree (heuristic reviewer).
 *   3. Discard the worktree.
 *
 * Exit code is always 0 — findings are communicated via
 * `.workflow/state/auto-review-findings.json`, not via exit status. The
 * parent process has already unref()'d this child; nothing is watching stderr.
 */

const { runReview, writeFindings } = require('../lib/worktree-review');

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

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const taskId = args.task;
  const repoRoot = args.repoRoot || process.cwd();

  if (!taskId) {
    process.exit(0);
  }

  let worktree = null;
  try {
    const { createWorktree, discardWorktree } = require('./flow-worktree');
    worktree = await createWorktree({
      taskId: `review-${taskId}`,
      baseBranch: args.baseBranch || undefined,
      repoRoot,
    });

    // Use the base branch for diff so the reviewer sees the task's changes.
    const baseBranch = worktree.baseBranch || 'HEAD~1';
    await runReview({
      taskId,
      worktreePath: worktree.path,
      baseBranch,
    });

    try { await discardWorktree(worktree, { force: true }); } catch (_err) { /* noop */ }
  } catch (err) {
    writeFindings({
      taskId,
      status: 'error',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      findings: [],
      error: String(err.message || err),
    });
    if (worktree) {
      try {
        const { discardWorktree } = require('./flow-worktree');
        await discardWorktree(worktree, { force: true });
      } catch (_err) { /* noop */ }
    }
  }
  // Normal exit.
})();
