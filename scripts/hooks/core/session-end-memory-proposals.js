'use strict';

/**
 * Wogi Flow — Session End: Memory Proposal Surfacing
 *
 * Reads pending IGR-artifact edit proposals staged by `flow memory propose`
 * and returns a structured summary for the session-end adapter to display.
 *
 * Agent-proposed edits do NOT auto-apply. The user reviews at session-end
 * and runs `flow memory approve <id>` / `flow memory reject <id>`.
 *
 * Story: wf-4434851f (IGR artifact edit proposals).
 */

const store = require('../../../lib/memory-proposal-store');

function summarizePendingMemoryProposals() {
  let pending;
  try {
    pending = store.listProposals({ status: 'pending' });
  } catch (_err) {
    return null;
  }
  if (!pending || pending.length === 0) return null;

  const byOp = { append: 0, 'replace-section': 0, 'replace-all': 0 };
  const byBlock = {};
  const previews = [];
  for (const p of pending) {
    byOp[p.op] = (byOp[p.op] || 0) + 1;
    byBlock[p.block] = (byBlock[p.block] || 0) + 1;
    try {
      previews.push(store.previewProposal(p));
    } catch (_err) {
      // Non-fatal — skip a broken preview but keep the rest.
    }
  }

  return {
    count: pending.length,
    byOp,
    byBlock,
    proposals: pending,
    previews,
    message: formatMessage(pending.length, byOp, previews),
  };
}

function formatMessage(count, byOp, previews) {
  const plural = count !== 1 ? 's' : '';
  const breakdown = Object.entries(byOp)
    .filter(([, n]) => n > 0)
    .map(([op, n]) => `${n} ${op}`)
    .join(', ');
  return [
    `${count} pending memory proposal${plural} (${breakdown}):`,
    ...previews,
    '',
    'Review:  flow memory list',
    'Approve: flow memory approve <id>',
    'Reject:  flow memory reject  <id> [--reason <text>]',
  ].join('\n');
}

module.exports = { summarizePendingMemoryProposals };
