'use strict';

/**
 * Phase-transition Auto-Review trigger (wf-8d635d0e / E1).
 *
 * Called after a successful phase transition. When the transition is
 * `coding → validating` and `config.autoReview.enabled`, fire a detached
 * background review worker. Non-blocking by design (AC5) — parent returns
 * immediately; the worker writes findings asynchronously.
 *
 * Failure-mode: any error from the spawn path is swallowed and logged via
 * DEBUG only. Auto-review is an advisory signal layered on top of the
 * existing Completion Truth Gate — a crash here must never fail the
 * primary phase transition.
 */

const { getConfig } = require('../../flow-utils');

function isAutoReviewEnabled(cfg) {
  try {
    const c = cfg || getConfig();
    return c?.autoReview?.enabled === true;
  } catch (_err) {
    return false;
  }
}

/**
 * Trigger a background auto-review when appropriate.
 *
 * @param {string} from - prior phase
 * @param {string} to   - new phase
 * @param {string} taskId
 * @param {Object} [opts]
 * @param {Function} [opts.starter] — injectable startReview (tests)
 * @returns {{ started:boolean, reason?:string, handle?:Object }}
 */
function maybeStartAutoReview(from, to, taskId, opts = {}) {
  if (from !== 'coding' || to !== 'validating') {
    return { started: false, reason: 'not-validating-transition' };
  }
  if (!taskId) {
    return { started: false, reason: 'no-task-id' };
  }
  if (!isAutoReviewEnabled(opts.config)) {
    return { started: false, reason: 'disabled' };
  }

  const starter = opts.starter || require('../../../lib/worktree-review').startReview;
  try {
    const handle = starter({ taskId, repoRoot: opts.repoRoot });
    return { started: true, handle };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[auto-review] startReview failed: ${err.message}`);
    }
    return { started: false, reason: 'spawn-error', error: String(err.message || err) };
  }
}

module.exports = { maybeStartAutoReview, isAutoReviewEnabled };
