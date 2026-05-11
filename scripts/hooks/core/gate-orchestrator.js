'use strict';

/**
 * Wogi Flow — Gate Orchestrator (wf-35742353)
 *
 * Cross-gate priority and remediation surfacing. Each gate (long-input-pending,
 * routing, research-required, phase-context, overdue-dispatches, etc.) was
 * designed assuming it was the only voice in the room. At the integration
 * point (UserPromptSubmit additionalContext and Stop hook stopReason) they
 * collide and produce conflicting "do this NOW" instructions in the same turn.
 *
 * This module owns the priority order and the picker. The hook entry files
 * and adapters call it instead of stacking messages.
 *
 * Priority (highest first):
 *   1. long-input-pending — user's prompt isn't captured; downstream is
 *      suspect. Resolve before anything else.
 *   2. routing — no task assigned; work would be untracked.
 *   3. research-required — diagnostic prompt needs evidence-reading.
 *   4. workspace-overdue — silent worker death surfacing (manager-only).
 *   5. phase-context — informational phase-prompt injection (not a demand).
 *
 * Categories:
 *   - "remediation": the AI must take a specific action (resolve before
 *     proceeding). At most ONE remediation is surfaced per turn — the
 *     highest-priority active one wins; others get a one-line "queued"
 *     footer so the AI knows more work follows.
 *   - "info": informational, always passes through alongside the top
 *     remediation. Examples: phase-context, dossier injection.
 *
 * Fail-open philosophy: if classification or formatting errors, return
 * the original message stack unchanged (caller fallback).
 */

const REMEDIATION_PRIORITY = Object.freeze([
  'long-input-pending',
  'routing',
  'research-required',
  'workspace-overdue'
]);

const REMEDIATION_LABELS = Object.freeze({
  'long-input-pending': 'long-input-pending (invoke /wogi-extract-review or `flow long-input-pending dismiss`)',
  'routing': 'routing (invoke /wogi-start)',
  'research-required': 'research-required (read evidence before answering)',
  'workspace-overdue': 'workspace-overdue (a worker dispatch is past its deadline)'
});

/**
 * Pick the top-priority active remediation from a set of (gateId, message) pairs.
 *
 * @param {Array<{id: string, message: string}>} active - gates currently demanding action
 * @returns {{ top: {id, message}|null, queued: string[] }}
 *          top: the highest-priority active gate (null if none)
 *          queued: gateIds of the others (in priority order), for footer rendering
 */
function pickTopRemediation(active) {
  if (!Array.isArray(active) || active.length === 0) {
    return { top: null, queued: [] };
  }
  // Filter to valid entries and sort by priority index.
  const valid = active.filter(g => g && typeof g.id === 'string' && typeof g.message === 'string' && g.message.trim().length > 0);
  if (valid.length === 0) return { top: null, queued: [] };

  const indexed = valid.map(g => ({ ...g, idx: REMEDIATION_PRIORITY.indexOf(g.id) }))
    .map(g => ({ ...g, idx: g.idx === -1 ? Number.POSITIVE_INFINITY : g.idx }));
  indexed.sort((a, b) => a.idx - b.idx);

  const top = { id: indexed[0].id, message: indexed[0].message };
  const queued = indexed.slice(1).map(g => g.id);
  return { top, queued };
}

/**
 * Render the top remediation message with a one-line footer listing queued
 * remediations. If no others are queued, returns the top message unchanged.
 */
function renderRemediation(top, queued) {
  if (!top || typeof top.message !== 'string') return '';
  if (!Array.isArray(queued) || queued.length === 0) return top.message;
  const labels = queued.map(id => REMEDIATION_LABELS[id] || id).join('; ');
  return `${top.message}\n\n[gate-orchestrator] Also queued (resolve after the above): ${labels}`;
}

/**
 * Convenience: take a map of {gateId: message-or-null} and return the rendered
 * top remediation (or empty string when nothing is active).
 */
function selectAndRender(gateMap) {
  if (!gateMap || typeof gateMap !== 'object') return '';
  const active = Object.entries(gateMap)
    .filter(([_id, msg]) => typeof msg === 'string' && msg.trim().length > 0)
    .map(([id, message]) => ({ id, message }));
  const { top, queued } = pickTopRemediation(active);
  return renderRemediation(top, queued);
}

/**
 * wf-6e31850e (A-1, A-6): Stop-hook coordinator. Same priority logic as
 * selectAndRender() but takes BOOLEAN ACTIVE FLAGS (not message strings) and
 * returns `{ topGateId, queued }`. Used by stop.js to decide which gate
 * should fire instead of running multiple gates in cascade.
 *
 * Inputs map gateId -> active boolean. Caller passes flags computed from
 * marker state (isLongInputPending, isRoutingPending, etc.). Return value
 * tells the caller WHICH GATE to delegate to; the gate itself produces the
 * actual stopReason message.
 *
 * @param {Object<string, boolean>} activeFlags
 * @returns {{ topGateId: string|null, queued: string[] }}
 */
function pickStopHookGate(activeFlags) {
  if (!activeFlags || typeof activeFlags !== 'object') return { topGateId: null, queued: [] };
  const active = REMEDIATION_PRIORITY.filter(id => activeFlags[id] === true);
  if (active.length === 0) return { topGateId: null, queued: [] };
  return {
    topGateId: active[0],
    queued: active.slice(1)
  };
}

module.exports = {
  REMEDIATION_PRIORITY,
  REMEDIATION_LABELS,
  pickTopRemediation,
  renderRemediation,
  selectAndRender,
  pickStopHookGate
};
