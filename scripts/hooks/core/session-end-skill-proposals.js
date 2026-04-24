'use strict';

/**
 * Wogi Flow — Session End: Skill Proposal Surfacing
 *
 * Reads pending skill proposals staged by `flow skill propose|patch|remove`
 * and returns a structured summary for the session-end adapter to display.
 *
 * Agent-proposed changes do NOT auto-apply. The user reviews at session-end
 * and runs `flow skill promote <name>` / `flow skill reject <name>`.
 */

const store = require('../../../lib/skill-proposal-store');

function summarizePendingProposals() {
  let pending;
  try {
    pending = store.listProposals({ status: 'pending' });
  } catch (_err) {
    return null;
  }
  if (!pending || pending.length === 0) return null;

  const byAction = { propose: 0, patch: 0, remove: 0 };
  const lines = [];
  for (const p of pending) {
    byAction[p.action] = (byAction[p.action] || 0) + 1;
    const icon = p.action === 'propose' ? '+' : p.action === 'patch' ? '~' : '-';
    const rationale = p.rationale ? ` — ${p.rationale}` : '';
    lines.push(`  ${icon} ${p.skillName} (${p.action}, ${p.id})${rationale}`);
  }

  return {
    count: pending.length,
    byAction,
    proposals: pending,
    lines,
    message: formatMessage(pending.length, byAction, lines),
  };
}

function formatMessage(count, byAction, lines) {
  const plural = count !== 1 ? 's' : '';
  const breakdown = Object.entries(byAction)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${a}`)
    .join(', ');
  return [
    `${count} pending skill proposal${plural} (${breakdown}):`,
    ...lines,
    '',
    'Review with: flow skill pending',
    'Approve:     flow skill promote <name>',
    'Discard:     flow skill reject <name>',
  ].join('\n');
}

module.exports = { summarizePendingProposals };
