'use strict';

/**
 * Wogi Flow — Long-Input Enforcement Gate (P11.5 mechanical layer)
 *
 * The methodology rules + Adversary check (P11.5) are not enough on their
 * own — text rules can be ignored. This gate makes the enforcement
 * MECHANICAL by injecting a hard instruction when a long-form prompt
 * arrives without a source-link, forcing the AI to run
 * /wogi-extract-review before any work.
 *
 * Three triggers (in order of strictness):
 *
 *   STRICT (worker-side channel-dispatch): when a workspace worker
 *     receives a channel message that's long-form without a
 *     source-link, inject a forcing instruction. This is the direct
 *     fix for the wogi-hub 2026-04-27 incident — manager compressed
 *     a 50-line prompt into a 5-bullet contract; worker had no
 *     mechanical reason to know the prompt was lossy. With this
 *     gate, worker auto-routes to /wogi-extract-review on receipt.
 *
 *   FORCE (any long-form prompt without source-link): inject the
 *     same forcing instruction for all sessions, not just workers.
 *     The user typing a 50-line prompt directly into a manager
 *     session ALSO benefits from being routed to extraction.
 *
 *   SUGGEST (ambiguous): below the strict threshold but still
 *     long-ish — surface the option without forcing.
 *
 * Detection heuristics:
 *   - >40 lines or ≥5 discrete items (same as long-input-gate)
 *   - Source-link patterns: `## Original Request (verbatim)`,
 *     `.workflow/changes/wf-XXXXXXXX.md` references, `spec: <path>`,
 *     `wf-XXXXXXXX` IDs in the message body.
 *
 * Public API:
 *   detectLongFormPrompt(text) → boolean
 *   hasSourceLink(text) → boolean
 *   shouldForceExtractReview({text, source, env}) → {forced, reason}
 *   buildEnforcementMessage(reason) → instruction text
 *   markLongInputPending(payload) → writes .workflow/state/long-input-pending.json
 *   clearLongInputPending() → clears the marker
 *   isLongInputPending() → boolean
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../../flow-utils');
const { safeJsonParse } = require('../../flow-io');

const PENDING_PATH = path.join(PATHS.state, 'long-input-pending.json');

const LONG_LINE_THRESHOLD = 40;
const LONG_ITEM_THRESHOLD = 5;

// Imperative verbs that suggest the prompt is task-like (vs. prose / log dump).
// When ≥2 imperatives are present alongside structural items, the prompt is
// almost certainly work-creating and the gate fires.
const TASK_IMPERATIVES = [
  /\b(?:add|build|create|implement|fix|refactor|remove|delete|rename|move|extract|consolidate|migrate|update|enhance|integrate|connect|map|route|enforce|preserve|validate|check)\b/i
];

// Patterns that indicate a source-link — at least one must be present for the
// gate to PASS a long-form prompt without forcing extract-review.
const SOURCE_LINK_PATTERNS = [
  /^##\s+Original Request \(verbatim\)\s*$/m,
  /\.workflow\/changes\/wf-[a-f0-9]{8}/i,
  /\.workflow\/specs\/wf-[a-f0-9]{8}/i,
  /^spec:\s*[^\s]+\.md/im,
  /^source:\s*[^\s]+\.md/im,
  /\bwf-[a-f0-9]{8}\b/i  // bare wf-ID reference
];

function countDiscreteItems(text) {
  if (typeof text !== 'string') return 0;
  let count = 0;
  for (const line of text.split('\n')) {
    if (/^\s*[-*]\s+/.test(line)) count++;
    else if (/^\s*\d+[.)]\s+/.test(line)) count++;
  }
  return count;
}

function detectLongFormPrompt(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const lineCount = text.split('\n').filter(l => l.trim()).length;
  if (lineCount > LONG_LINE_THRESHOLD) return true;
  if (countDiscreteItems(text) >= LONG_ITEM_THRESHOLD) return true;
  return false;
}

function hasSourceLink(text) {
  if (typeof text !== 'string') return false;
  return SOURCE_LINK_PATTERNS.some(re => re.test(text));
}

function hasTaskSignals(text) {
  if (typeof text !== 'string') return false;
  let imperativeHits = 0;
  for (const re of TASK_IMPERATIVES) {
    const m = text.match(new RegExp(re.source, 'gi'));
    if (m) imperativeHits += m.length;
  }
  return imperativeHits >= 2;
}

/**
 * Detect whether the current prompt is a channel-dispatched message in
 * worker mode. UserPromptSubmit gets `parsedInput.source` from Claude
 * Code's hook payload — channel-dispatched prompts arrive with a
 * channel-specific source identifier. We also check env vars to confirm
 * worker context. Defensive: returns false in any edge case.
 */
function isChannelDispatchInWorker(source, env = process.env) {
  if (!env.WOGI_WORKSPACE_ROOT) return false;
  if (!env.WOGI_REPO_NAME || env.WOGI_REPO_NAME === 'manager') return false;
  // Channel-dispatched prompts have specific source markers.
  if (typeof source !== 'string') return false;
  return /channel|notifications/i.test(source);
}

/**
 * Decide whether the prompt should force-route to /wogi-extract-review.
 *
 * @param {object} input
 * @param {string} input.text - prompt text
 * @param {string} [input.source] - parsedInput.source from Claude Code
 * @param {object} [input.env] - environment (for testing)
 * @returns {{forced: boolean, level: 'strict'|'force'|'suggest'|'pass', reason: string}}
 */
function shouldForceExtractReview({ text, source, env = process.env } = {}) {
  if (!detectLongFormPrompt(text)) {
    return { forced: false, level: 'pass', reason: 'below-long-input-threshold' };
  }
  // If the prompt already has a source-link, trust it — the upstream
  // already preserved the verbatim source and reconciled items.
  if (hasSourceLink(text)) {
    return { forced: false, level: 'pass', reason: 'source-link-present' };
  }
  // Check task-likeness — pure data dumps (log files, code pastes) shouldn't
  // be forced through extract-review even if they're long.
  if (!hasTaskSignals(text)) {
    return { forced: false, level: 'suggest', reason: 'long-but-no-task-signals' };
  }
  // Worker receiving channel-dispatched long-form without source-link:
  // STRICT — this is the wogi-hub 2026-04-27 failure mode.
  if (isChannelDispatchInWorker(source, env)) {
    return { forced: true, level: 'strict', reason: 'channel-dispatch-without-source-link' };
  }
  // Any other session: long-form + task-like + no source-link → force.
  return { forced: true, level: 'force', reason: 'long-form-task-without-source-link' };
}

function buildEnforcementMessage(reason, level) {
  const header = level === 'strict'
    ? '🚨 STRICT P11.5 ENFORCEMENT — manager compression detected'
    : '🚨 P11.5 ENFORCEMENT — long-form prompt without source-link';
  const body = [];
  body.push(header);
  body.push('');
  if (level === 'strict') {
    body.push('This prompt arrived via channel-dispatch in worker mode and qualifies as');
    body.push('long-form (>40 lines OR ≥5 discrete items) without a source-link. The');
    body.push('manager that dispatched this message SHOULD have included a path to a spec');
    body.push('with `## Original Request (verbatim)`. It did not. This is the exact failure');
    body.push('shape that caused the wogi-hub 2026-04-27 Customers > Services regression.');
    body.push('');
    body.push('You MUST reverse the compression at this layer:');
  } else {
    body.push('This prompt qualifies as long-form (>40 lines OR ≥5 discrete items) AND');
    body.push('contains task-creating signals (imperatives + structured items). Per P11.5,');
    body.push('long-form work-creating prompts MUST go through /wogi-extract-review so');
    body.push('every item is captured and reconciled.');
    body.push('');
    body.push('You MUST:');
  }
  body.push('  1. Invoke `Skill(skill="wogi-extract-review")` BEFORE any other work.');
  body.push('  2. Let extract-review run its 6-phase pipeline (extract → review → topics →');
  body.push('     map → clarify → stories) on this prompt.');
  body.push('  3. Use the resulting stories + item manifest as canonical source.');
  body.push('  4. Any spec or channel-dispatch you write next MUST link to the saved');
  body.push('     spec file and include `## Original Request (verbatim)`.');
  body.push('');
  body.push(`Reason: ${reason}`);
  body.push('');
  body.push('Override (if you genuinely judge this prompt does NOT create work):');
  body.push('  Run `flow long-input-pending dismiss --reason="<concrete reason>"`');
  body.push('  Then proceed. The dismiss is logged for telemetry/learning.');
  return body.join('\n');
}

function markLongInputPending(payload) {
  try {
    fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
    fs.writeFileSync(PENDING_PATH, JSON.stringify({
      markedAt: new Date().toISOString(),
      ...payload
    }, null, 2));
    return true;
  } catch (_err) { return false; }
}

function clearLongInputPending() {
  try { if (fs.existsSync(PENDING_PATH)) fs.unlinkSync(PENDING_PATH); }
  catch (_err) { /* ignore */ }
}

function isLongInputPending() {
  try { return fs.existsSync(PENDING_PATH); }
  catch (_err) { return false; }
}

function readLongInputPending() {
  // wf-3c968989: safeJsonParse adds DANGEROUS_KEYS protection. Returns null
  // on missing/corrupt/array input — exact behavior match for the prior
  // try/catch + return-null contract.
  return safeJsonParse(PENDING_PATH, null);
}

/**
 * PreToolUse gate consulting the long-input-pending marker.
 * When the marker is present, blocks Edit/Write/Bash/Skill except for
 * a small allowlist that's needed to either run extract-review or
 * dismiss the marker. Returns the same `{blocked, reason?, message?}`
 * shape as the other PreToolUse gates so it composes cleanly in
 * pre-tool-orchestrator.
 *
 * Allowlist (these MUST stay reachable while the marker is present):
 *   - Skill calls to `wogi-extract-review` (the way out)
 *   - Skill calls to `wogi-start` only when args is `--bypass-long-input`
 *     or `wogi-extract-review` (escape hatch routes)
 *   - Bash calls invoking `flow long-input-pending dismiss` or the
 *     extract-review CLI
 *   - Read tool (no state changes)
 *
 * Everything else is blocked with a message redirecting to extract-review.
 */
function checkLongInputPendingGate(toolName, toolInput) {
  if (!isLongInputPending()) return { blocked: false };

  // Read tool is always allowed — investigation is fine while pending.
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    return { blocked: false };
  }

  // Skill tool — allow only the way-out skills
  if (toolName === 'Skill') {
    const skill = (toolInput && toolInput.skill) || '';
    const args = (toolInput && toolInput.args) || '';
    if (skill === 'wogi-extract-review') return { blocked: false };
    if (skill === 'wogi-start' && /(?:^|\s)(?:wogi-extract-review|--bypass-long-input)\b/.test(args)) {
      return { blocked: false };
    }
    // Falls through to block
  }

  // Bash — allow the dismiss / extract-review CLI commands
  if (toolName === 'Bash') {
    const cmd = (toolInput && toolInput.command) || '';
    if (/flow\s+long-input-pending\s+dismiss/.test(cmd)) return { blocked: false };
    if (/flow\s+extract-zero-loss/.test(cmd)) return { blocked: false };
    if (/flow\s+long-input/.test(cmd)) return { blocked: false };
    if (/flow-source-fidelity\.js/.test(cmd)) return { blocked: false };
    // Falls through to block for everything else
  }

  // Block Edit / Write / NotebookEdit unconditionally while pending
  const payload = readLongInputPending();
  const level = payload?.level || 'unknown';
  const reason = payload?.reason || 'long-form prompt without source-link';
  return {
    blocked: true,
    reason: 'long-input-pending',
    message: [
      '🚨 BLOCKED: long-input-pending marker is set.',
      '',
      `A long-form prompt was detected (level: ${level}, reason: ${reason})`,
      'and you have not yet run /wogi-extract-review on it.',
      '',
      'Per P11.6 (Temporal Source Coverage), every item in the user\'s prompt',
      'must be captured before any work begins. Compressing the prompt into a',
      'spec or channel-dispatch is the wogi-hub failure shape — it loses items.',
      '',
      'To unblock:',
      '  1. (RECOMMENDED) Invoke `Skill(skill="wogi-extract-review")` to run',
      '     the 6-phase extraction pipeline. Marker auto-clears on completion.',
      '  2. (ESCAPE HATCH) If this prompt genuinely does NOT create work',
      '     (e.g., it\'s a log dump or pure question), dismiss with:',
      '     `flow long-input-pending dismiss --reason="<concrete reason>"`',
      '',
      'Read/Glob/Grep tools remain available for investigation.'
    ].join('\n')
  };
}

module.exports = {
  PENDING_PATH,
  LONG_LINE_THRESHOLD,
  LONG_ITEM_THRESHOLD,
  detectLongFormPrompt,
  hasSourceLink,
  hasTaskSignals,
  isChannelDispatchInWorker,
  shouldForceExtractReview,
  buildEnforcementMessage,
  markLongInputPending,
  clearLongInputPending,
  isLongInputPending,
  readLongInputPending,
  checkLongInputPendingGate,
  countDiscreteItems
};
