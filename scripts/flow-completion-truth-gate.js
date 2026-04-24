#!/usr/bin/env node

/**
 * Wogi Flow - Completion Truth Gate
 *
 * IGR Stage 6. The most-impactful gate in the IGR layer.
 *
 * Per Agent A's session-history mining: false completion is the #1 failure mode
 * (31 incidents — more than every other category combined). This gate prevents
 * the orchestrator from saying "done" when the evidence does not support it.
 *
 * Story: wf-76312197 (IGR Stage 6)
 * Epic: wf-b00262b1 (IGR)
 *
 * Design (R2):
 *   - Reuses EVIDENCE_TIERS from flow-runtime-verification.js (single source of truth)
 *   - Extends EXISTING durable-session step.verificationProof storage
 *     (boolean → optional { tier, observation, at } object)
 *   - Coexists with verificationProofGate (richer auditor; coarser baseline)
 *   - No new state file (.workflow/state/evidence-records/ was rejected in R2)
 *
 * Reuses (no parallel implementations):
 *   - flow-runtime-verification.js → EVIDENCE_TIERS constant
 *   - flow-durable-session.js     → loadDurableSession, saveDurableSession
 *   - flow-gate-telemetry.js      → recordGateEvent
 *
 * Usage (programmatic):
 *   const { recordEvidence, auditCompletionClaim, downgradeClaim,
 *           completionTruthGate, getStepEvidence } =
 *     require('./flow-completion-truth-gate');
 *
 *   // 1. Record evidence as a criterion is verified
 *   recordEvidence({ taskId, criterionId: 'ac-1', tier: 3,
 *                    observation: 'Clicked Submit, refreshed, persists' });
 *
 *   // 2. Audit at completion time
 *   const audit = auditCompletionClaim(taskId, claimedCriteria);
 *
 *   // 3. Downgrade the claim language if blocked
 *   const safeText = downgradeClaim('Task is done.', audit);
 */

const _fs = require('node:fs');
const _path = require('node:path');

const { } = require('./flow-paths');
const { } = require('./flow-io');
const { getConfig } = require('./flow-config-loader');
const { } = require('./flow-output');

const gateTelemetry = require('./flow-gate-telemetry');

// Lazy-loaded to keep Story 6 independently testable
let _evidenceTiers;
function _getEvidenceTiers() {
  if (_evidenceTiers) return _evidenceTiers;
  try {
    _evidenceTiers = require('./flow-runtime-verification').EVIDENCE_TIERS;
  } catch (_err) {
    // Fallback definition — same shape as canonical, used only when runtime-verification module unavailable
    _evidenceTiers = {
      STATIC: { level: 0, name: 'Static', sufficient: false },
      STRUCTURAL: { level: 1, name: 'Structural', sufficient: false },
      OBSERVATIONAL: { level: 2, name: 'Observational', sufficient: true },
      INTERACTIVE: { level: 3, name: 'Interactive', sufficient: true },
      AUTOMATED: { level: 4, name: 'Automated', sufficient: true },
    };
  }
  return _evidenceTiers;
}

const TIER_NAMES = ['STATIC', 'STRUCTURAL', 'OBSERVATIONAL', 'INTERACTIVE', 'AUTOMATED'];

// Words that, in a completion claim, must be backed by Tier ≥ minTierForDone
const DONE_WORDS = ['done', 'completed', 'complete', 'deployed', 'shipped', 'finished'];

// ============================================================
// Disabled-mode short-circuit
// ============================================================

function isTruthGateDisabled() {
  const cfg = getConfig();
  const igr = cfg.intentGroundedReasoning || {};
  if (igr.enabled === false) return { disabled: true, reason: 'igr-disabled' };
  const tg = igr.completionTruthGate || {};
  if (tg.enabled === false) return { disabled: true, reason: 'truth-gate-disabled' };
  return { disabled: false };
}

function getMinTierForDone() {
  const cfg = getConfig();
  return cfg.intentGroundedReasoning?.completionTruthGate?.minTierForDone ?? 3;
}

function shouldBlockOnFalseCompletion() {
  const cfg = getConfig();
  return cfg.intentGroundedReasoning?.completionTruthGate?.blockFalseCompletion !== false;
}

// ============================================================
// Evidence shape normalization (handles legacy + new shapes)
// ============================================================

/**
 * Given a durable-session step, return uniform evidence shape:
 *   { highestTier: 0..4, observations: [{tier, observation, at}, ...] }
 *
 * Handles three shapes:
 *   1. step.verificationProof === true  (legacy)  → highestTier=3, generic observation
 *   2. step.verificationProof === false/null      → highestTier=-1 (no evidence)
 *   3. step.verificationProof === { tier, observation, at }    → highestTier=tier
 *   4. step.verificationProof === { tiers: [...], highestTier } → as given
 */
function getStepEvidence(step) {
  if (!step) return { highestTier: -1, observations: [] };
  const vp = step.verificationProof;
  if (vp === undefined || vp === null || vp === false) {
    return { highestTier: -1, observations: [] };
  }
  if (vp === true) {
    // Legacy: assume Tier 3 (behaviorally verified — the historical implicit assumption)
    return {
      highestTier: 3,
      observations: [
        {
          tier: 3,
          observation: '(legacy boolean proof — assumed Tier 3)',
          at: step.completedAt || null,
        },
      ],
    };
  }
  if (typeof vp === 'object') {
    if (Array.isArray(vp.tiers)) {
      const tiers = vp.tiers.filter((t) => typeof t.tier === 'number');
      const highest = tiers.length ? Math.max(...tiers.map((t) => t.tier)) : -1;
      return {
        highestTier: typeof vp.highestTier === 'number' ? vp.highestTier : highest,
        observations: tiers,
      };
    }
    if (typeof vp.tier === 'number') {
      return {
        highestTier: vp.tier,
        observations: [{ tier: vp.tier, observation: vp.observation || '', at: vp.at || null }],
      };
    }
  }
  return { highestTier: -1, observations: [] };
}

// ============================================================
// Evidence recording
// ============================================================

/**
 * Record a tier-classified observation against a criterion's durable-session step.
 * Idempotent on identical (tier, observation) pairs.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.criterionId - Step ID in the durable session.
 * @param {number} opts.tier - 0..4
 * @param {string} opts.observation - Short description (≤200 chars).
 * @returns {{ ok:boolean, reason?:string, highestTier?:number }}
 */
function recordEvidence({ taskId, criterionId, tier, observation }) {
  if (typeof tier !== 'number' || tier < 0 || tier > 4) {
    return { ok: false, reason: 'tier must be 0..4' };
  }
  if (!criterionId) {
    return { ok: false, reason: 'criterionId required' };
  }

  let durable;
  try {
    durable = require('./flow-durable-session');
  } catch (_err) {
    return { ok: false, reason: 'durable-session module unavailable' };
  }

  const session = durable.loadDurableSession();
  if (!session || !session.steps) {
    return { ok: false, reason: 'no durable session' };
  }
  if (taskId && session.taskId !== taskId) {
    return { ok: false, reason: `taskId mismatch: session=${session.taskId} requested=${taskId}` };
  }

  const step = session.steps.find((s) => s.id === criterionId);
  if (!step) {
    return { ok: false, reason: `criterion ${criterionId} not found in durable session` };
  }

  const obs = String(observation || '').slice(0, 200);
  const at = new Date().toISOString();

  // Normalize current state then merge new observation
  const current = getStepEvidence(step);
  const observations = [...current.observations];

  // Idempotency: skip if identical (tier, observation) pair already present
  const exists = observations.some(
    (o) => o.tier === tier && o.observation === obs
  );
  if (!exists) {
    observations.push({ tier, observation: obs, at });
  }

  // CL-003 fix (2026-04-13): cap observations + use reduce instead of spread
  // to avoid RangeError on large arrays (Math.max(...array) exceeds call-stack
  // limit ~100k args). Also caps per-step observation log to 50 entries.
  const MAX_OBSERVATIONS_PER_STEP = 50;
  if (observations.length > MAX_OBSERVATIONS_PER_STEP) {
    observations.splice(0, observations.length - MAX_OBSERVATIONS_PER_STEP);
  }
  const highestTier = observations.reduce((max, o) => (o.tier > max ? o.tier : max), tier);

  step.verificationProof = {
    highestTier,
    tiers: observations,
  };

  durable.saveDurableSession(session);
  return { ok: true, highestTier };
}

// ============================================================
// Audit
// ============================================================

/**
 * Audit a list of claimed-completed criteria against their evidence.
 *
 * @param {string} taskId
 * @param {Array<{id:string, text?:string, claimed:string}>} claimedCriteria
 *   - id: durable-session step id
 *   - text: human-readable description (used for display)
 *   - claimed: the word the orchestrator used ('done', 'completed', 'implemented', etc.)
 * @returns {{ perCriterion:Array, blocked:boolean, minTier:number,
 *             sufficientCount:number, insufficientCount:number,
 *             evidenceRecordsExisted:boolean }}
 */
function auditCompletionClaim(taskId, claimedCriteria) {
  const minTier = getMinTierForDone();

  let session = null;
  try {
    const durable = require('./flow-durable-session');
    session = durable.loadDurableSession();
  } catch (_err) {
    /* fall through — no session */
  }

  const evidenceRecordsExisted = !!(session && session.steps && session.steps.length > 0);

  const perCriterion = (claimedCriteria || []).map((c) => {
    const step = session?.steps?.find(
      (s) => s.id === c.id || (c.text && s.description && normalizeText(s.description) === normalizeText(c.text))
    );
    const evidence = getStepEvidence(step);
    const claimedDone = !!c.claimed && DONE_WORDS.includes(String(c.claimed).toLowerCase());
    const sufficient = evidence.highestTier >= minTier;
    let verdict;
    if (!claimedDone) verdict = 'NOT_CLAIMED_DONE';
    else if (sufficient) verdict = 'DONE';
    else if (evidence.highestTier >= 0) verdict = 'IMPLEMENTED_UNVERIFIED';
    else verdict = 'INSUFFICIENT';

    return {
      id: c.id,
      text: c.text || step?.description || c.id,
      claimedDone,
      highestTier: evidence.highestTier,
      tierName: evidence.highestTier >= 0 ? TIER_NAMES[evidence.highestTier] : 'NONE',
      sufficient,
      verdict,
      observationCount: evidence.observations.length,
    };
  });

  const insufficient = perCriterion.filter((p) => p.claimedDone && !p.sufficient);
  const sufficient = perCriterion.filter((p) => p.claimedDone && p.sufficient);

  return {
    perCriterion,
    blocked: insufficient.length > 0 && shouldBlockOnFalseCompletion(),
    softModeWarn: insufficient.length > 0 && !shouldBlockOnFalseCompletion(),
    minTier,
    sufficientCount: sufficient.length,
    insufficientCount: insufficient.length,
    totalClaimed: perCriterion.filter((p) => p.claimedDone).length,
    evidenceRecordsExisted,
  };
}

function normalizeText(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ============================================================
// Language downgrade
// ============================================================

/**
 * Given an original completion text and an audit result, return the rewritten text.
 * Replaces "done"/"completed"/"deployed" with safer language when audit.blocked.
 *
 * Pure function — no I/O, no telemetry.
 *
 * @param {string} originalText
 * @param {Object} audit - From auditCompletionClaim
 * @returns {{ text:string, replaced:boolean, summary:string }}
 */
function downgradeClaim(originalText, audit) {
  if (!audit || (!audit.blocked && !audit.softModeWarn)) {
    return { text: originalText, replaced: false, summary: 'no downgrade needed' };
  }

  const { sufficientCount, insufficientCount, totalClaimed, minTier } = audit;
  const tierName = TIER_NAMES[minTier] || `Tier ${minTier}`;

  // Replace done-words with the safer "implemented (unverified)" formula
  const downgradedWord = 'implemented (unverified)';
  const re = new RegExp(`\\b(${DONE_WORDS.join('|')})\\b`, 'gi');
  const rewritten = String(originalText || '').replace(re, downgradedWord);

  const banner =
    `\n\n⚠ Completion Truth Gate: ${sufficientCount}/${totalClaimed} criteria reach the required ${tierName} (≥ Tier ${minTier}) evidence threshold. ` +
    `${insufficientCount} criteria are implemented but unverified — recommend manual verification before announcing completion.`;

  return {
    text: rewritten + banner,
    replaced: rewritten !== originalText,
    summary: `${insufficientCount} insufficient of ${totalClaimed} claimed`,
  };
}

// ============================================================
// Quality-gate handler (matches flow-done-gates.js interface)
// ============================================================

/**
 * Handler conforming to flow-done-gates.js interface.
 * Reads claimed criteria from the durable session (steps marked acceptance-criteria,
 * status completed) and audits each against tier evidence.
 */
function completionTruthGate(ctx) {
  const dis = isTruthGateDisabled();
  if (dis.disabled) {
    if (ctx?.color) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} completionTruth (${dis.reason})`);
    }
    return { passed: true, skipped: true };
  }

  const start = Date.now();
  let session = null;
  try {
    session = require('./flow-durable-session').loadDurableSession();
  } catch (_err) {
    /* no-op */
  }

  if (!session || !session.taskId) {
    if (ctx?.color) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} completionTruth (no durable session — skipping)`);
    }
    recordTelemetry('SKIP', { reason: 'no-session', durationMs: Date.now() - start });
    return { passed: true };
  }

  // Build claimed-criteria list from completed acceptance-criteria steps
  const normalizeStepType = (t) => (t || '').toLowerCase().replace(/_/g, '-');
  const claimedCriteria = (session.steps || [])
    .filter((s) => s.status === 'completed' && normalizeStepType(s.type) === 'acceptance-criteria')
    .map((s) => ({ id: s.id, text: s.description || s.title || s.id, claimed: 'done' }));

  if (claimedCriteria.length === 0) {
    if (ctx?.color) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} completionTruth (no completed criteria — skipping)`);
    }
    recordTelemetry('SKIP', { reason: 'no-criteria', durationMs: Date.now() - start });
    return { passed: true };
  }

  const audit = auditCompletionClaim(session.taskId, claimedCriteria);
  const downgrade = downgradeClaim('Task is done.', audit);
  const verdict = audit.blocked ? 'FAIL' : audit.softModeWarn ? 'CONCERN' : 'PASS';

  recordTelemetry(verdict, {
    durationMs: Date.now() - start,
    minTier: audit.minTier,
    totalClaimed: audit.totalClaimed,
    sufficientCount: audit.sufficientCount,
    insufficientCount: audit.insufficientCount,
    evidenceRecordsExisted: audit.evidenceRecordsExisted,
    softModeActive: !shouldBlockOnFalseCompletion(),
    taskId: session.taskId,
  });

  if (verdict === 'PASS') {
    if (ctx?.success) {
      ctx.success(
        `completionTruth (${audit.sufficientCount}/${audit.totalClaimed} criteria at Tier ${audit.minTier}+)`
      );
    }
    return { passed: true, details: { audit } };
  }

  if (verdict === 'CONCERN') {
    if (ctx?.warn) {
      ctx.warn(
        `completionTruth — soft mode (${audit.insufficientCount}/${audit.totalClaimed} criteria below Tier ${audit.minTier})`
      );
    }
    return { passed: true, details: { audit, downgradedClaim: downgrade.text } };
  }

  // FAIL
  if (ctx?.error) {
    ctx.error(
      `completionTruth (${audit.insufficientCount}/${audit.totalClaimed} criteria claimed done but evidence below Tier ${audit.minTier})`
    );
    for (const c of audit.perCriterion.filter((p) => p.claimedDone && !p.sufficient).slice(0, 5)) {
      console.log(
        ctx.color('dim', `    - tier=${c.highestTier} (${c.tierName}): ${(c.text || '').slice(0, 100)}`)
      );
    }
  }
  return {
    passed: false,
    errorOutput: downgrade.text,
    details: { audit, downgradedClaim: downgrade.text },
  };
}

// ============================================================
// Telemetry helper
// ============================================================

function recordTelemetry(verdict, runCtx = {}) {
  gateTelemetry.recordGateEvent({
    gateId: 'completion-truth-gate',
    gateVersion: '1.0',
    taskId: runCtx.taskId || null,
    verdict,
    findingCount: runCtx.insufficientCount ?? 0,
    findingSummary: runCtx.insufficientSummary || [],
    durationMs: runCtx.durationMs,
    metadata: {
      minTier: runCtx.minTier ?? null,
      totalClaimed: runCtx.totalClaimed ?? null,
      sufficientCount: runCtx.sufficientCount ?? null,
      insufficientCount: runCtx.insufficientCount ?? null,
      evidenceRecordsExisted: runCtx.evidenceRecordsExisted ?? null,
      softModeActive: runCtx.softModeActive ?? null,
      reason: runCtx.reason || null,
    },
  });
}

// ============================================================
// Claim-vs-state contradiction scanner (2026-04-16 honesty-infra review)
// ============================================================

/**
 * Done-words must be preceded by a negation to qualify as a "no outage" claim.
 * We keep the list narrow to avoid false positives on routine phrasing.
 */
const NEGATION_PREFIXES = /\b(?:no|zero|0|without(?: any)?|not a single)\s+/i;

/**
 * State-disagreement words a user would recognize as "the work did NOT go cleanly":
 * hotfix/hotfixes (committed after-the-fact repair), regression, outage, incident,
 * P0/P1, rollback, revert. Regex is intentionally anchored so "incidentally" does
 * not match.
 */
const DISAGREEMENT_WORDS = ['outage', 'outages', 'incident', 'incidents', 'regression', 'regressions', 'rollback', 'rollbacks', 'revert', 'reverts', 'hotfix', 'hotfixes'];
const _DISAGREEMENT_RE = new RegExp(`\\b(?:${DISAGREEMENT_WORDS.join('|')})\\b`, 'i');

const PARTIAL_STATUSES = new Set(['completed-partial', 'completed_partial', 'partial', 'in-progress', 'in_progress', 'blocked', 'failed']);

/**
 * Scan a task-shaped object (from ready.json, completed-archive.json, or a durable
 * session snapshot) for contradictions between its free-text claim fields and its
 * structured state fields.
 *
 * Free-text fields scanned: `notes`, `result`, `summary`, `description`.
 * Structured fields inspected: `status`, `childTasks[].hotfixes`, `hotfixes`,
 * `incidents`, `regressions`.
 *
 * Two contradiction classes:
 *   A) **done-word vs partial-status** — notes say "shipped end-to-end" while
 *      status is "completed-partial". If the notes claim completion but the
 *      status is not `completed`, emit a contradiction.
 *   B) **negated-disagreement vs evidence-of-disagreement** — result says
 *      "0 outages" while `childTasks[].hotfixes` is non-empty, or notes say
 *      "no regressions" while a `regressions` array has entries.
 *
 * Return shape:
 *   {
 *     contradictions: [
 *       { class: 'A'|'B', field, snippet, structuralEvidence, suggestion }, ...
 *     ],
 *     scanned: true,
 *     reason: '...'  // when scanned=false (e.g., input not a task)
 *   }
 *
 * @param {Object} task - task-shaped object
 * @returns {Object}
 */
function scanForClaimContradictions(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { contradictions: [], scanned: false, reason: 'not-a-task-object' };
  }

  const contradictions = [];
  const freeTextFields = ['notes', 'result', 'summary', 'description'];

  const status = String(task.status || '').toLowerCase().trim();
  const isPartial = PARTIAL_STATUSES.has(status);

  // Evidence that the work hit real disagreement (would invalidate "0 outages" claims).
  const hotfixes = collectArrayEntries(task, ['hotfixes', 'incidents', 'regressions']);
  const childHotfixes = Array.isArray(task.childTasks)
    ? task.childTasks.flatMap((c) => collectArrayEntries(c, ['hotfixes', 'incidents', 'regressions']))
    : [];
  const hasDisagreementEvidence = hotfixes.length > 0 || childHotfixes.length > 0;

  for (const field of freeTextFields) {
    const text = extractText(task[field]);
    if (!text) continue;

    // Class A: done-word + partial status
    if (isPartial) {
      const hit = findDoneWordHit(text);
      if (hit) {
        contradictions.push({
          class: 'A',
          field,
          snippet: snippetAround(text, hit.index, hit.word.length),
          structuralEvidence: `task.status = "${task.status}"`,
          suggestion: `Reconcile: either update status to "completed" (if actually done) or soften the ${field} wording (e.g., "implemented" / "partially shipped")`,
        });
      }
    }

    // Class B: negated-disagreement + evidence of disagreement
    if (hasDisagreementEvidence) {
      const bHit = findNegatedDisagreement(text);
      if (bHit) {
        const evidenceSummary = [
          hotfixes.length > 0 ? `task.hotfixes/incidents/regressions has ${hotfixes.length} entry(ies)` : null,
          childHotfixes.length > 0 ? `childTasks[].hotfixes has ${childHotfixes.length} entry(ies)` : null,
        ].filter(Boolean).join(' + ');
        contradictions.push({
          class: 'B',
          field,
          snippet: snippetAround(text, bHit.index, bHit.length),
          structuralEvidence: evidenceSummary,
          suggestion: `Either remove the negation (e.g., "one hotfix resolved in X min" instead of "0 outages") or move the disagreement entries off this task`,
        });
      }
    }
  }

  return { contradictions, scanned: true };
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(' ');
  return '';
}

function findDoneWordHit(text) {
  const re = new RegExp(`\\b(?:${DONE_WORDS.join('|')})\\b(?:\\s+end-to-end)?`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  return { word: m[0], index: m.index };
}

function findNegatedDisagreement(text) {
  // Walk every occurrence of a disagreement word and check if it's preceded
  // (within the same sentence, up to ~40 chars) by a negation prefix.
  const re = new RegExp(`\\b(${DISAGREEMENT_WORDS.join('|')})\\b`, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const windowStart = Math.max(0, m.index - 40);
    const window = text.slice(windowStart, m.index);
    if (NEGATION_PREFIXES.test(window)) {
      return { index: m.index, length: m[0].length };
    }
  }
  return null;
}

function snippetAround(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function collectArrayEntries(obj, keys) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) out.push(...v.filter((x) => x !== null && x !== undefined && x !== ''));
  }
  return out;
}

// ============================================================
// Commit-vs-diff consistency scanner (v2.25.1 — H2b from Waves 1-3 review)
// ============================================================

/**
 * Parse a commit message for "fixes X" / "closes X" / "F1, F2, M1" style claims
 * that should be verifiable against the diff.
 *
 * Heuristics — conservative to avoid false positives:
 *   1. Bracketed finding IDs: `F1`, `F2`, `M1`, `H3`, `L5`, or `SEC-001`/`PERF-002`
 *   2. Task IDs: `wf-XXXXXXXX` that appear as "fixes wf-...", "closes wf-...", etc.
 *   3. File paths mentioned in fix-context: "fixes `path/to/file.js`"
 *
 * Returns the structured claims a diff-consistency check can verify.
 *
 * @param {string} commitMessage
 * @returns {{claims: Array<{kind: 'finding-id'|'task-id'|'file', value: string, raw: string}>}}
 */
function parseCommitMessageClaims(commitMessage) {
  const claims = [];
  if (typeof commitMessage !== 'string' || commitMessage.trim().length === 0) {
    return { claims };
  }

  // Finding IDs: F1, F2, M1, H3, L5, SEC-001, PERF-002, etc.
  //   - Single-letter + digits: match on word boundary
  //   - ALLCAPS-dashnum: SEC-001, PERF-002
  const findingRe = /\b(?:F\d+|H\d+|M\d+|L\d+|[A-Z]{2,6}-\d+)\b/g;
  for (const m of commitMessage.matchAll(findingRe)) {
    claims.push({ kind: 'finding-id', value: m[0], raw: m[0] });
  }

  // Task IDs (wf-XXXXXXXX) — only count if preceded by fix/close/resolve verb
  const taskRe = /\b(?:fix(?:es|ed)?|clos(?:es|ed)?|resolv(?:es|ed)?|address(?:es|ed)?)\s+(wf-[0-9a-f]{8})\b/gi;
  for (const m of commitMessage.matchAll(taskRe)) {
    claims.push({ kind: 'task-id', value: m[1], raw: m[0] });
  }

  // File paths in backticks after fix/address verbs: `fixes \`path/to/file.js\``
  const fileRe = /(?:fix(?:es|ed)?|address(?:es|ed)?|updat(?:es|ed)?)\s+`([^`\n]{3,120})`/gi;
  for (const m of commitMessage.matchAll(fileRe)) {
    // Only count values that look like file paths (have an extension or a slash)
    const val = m[1];
    if (/[./]/.test(val) && !val.includes(' ')) {
      claims.push({ kind: 'file', value: val, raw: m[0] });
    }
  }

  // Dedup
  const seen = new Set();
  return {
    claims: claims.filter(c => {
      const k = `${c.kind}::${c.value.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
  };
}

/**
 * Check commit message claims against the staged diff. Each claim must appear
 * somewhere in the diff (a file path in the changed-files list OR the token
 * appearing as-is in the diff body).
 *
 * @param {string} commitMessage
 * @param {Object} [opts]
 * @param {string} [opts.diffText] — raw `git diff --staged` output
 * @param {string[]} [opts.changedFiles] — staged file list (alternative input)
 * @returns {{ok: boolean, totalClaims: number, missingClaims: Array, verifiedClaims: Array}}
 */
function verifyCommitMessageAgainstDiff(commitMessage, opts = {}) {
  const { claims } = parseCommitMessageClaims(commitMessage);
  if (claims.length === 0) return { ok: true, totalClaims: 0, missingClaims: [], verifiedClaims: [] };

  const diffText = typeof opts.diffText === 'string' ? opts.diffText : '';
  const changedFiles = Array.isArray(opts.changedFiles) ? opts.changedFiles : [];
  const haystack = [diffText, ...changedFiles].join('\n');

  const missingClaims = [];
  const verifiedClaims = [];

  for (const claim of claims) {
    let found = false;
    if (claim.kind === 'file') {
      // File claims verify by exact path match (or suffix) in changed-files list
      found = changedFiles.some(f => f === claim.value || f.endsWith('/' + claim.value) || f.endsWith(claim.value));
      if (!found) found = diffText.includes(claim.value);
    } else {
      // finding-id + task-id: plain substring search in the haystack
      found = haystack.includes(claim.value);
    }
    (found ? verifiedClaims : missingClaims).push(claim);
  }

  return {
    ok: missingClaims.length === 0,
    totalClaims: claims.length,
    missingClaims,
    verifiedClaims
  };
}

/**
 * Human-readable message when claims are missing from the diff.
 *
 * @param {Object} result — from verifyCommitMessageAgainstDiff
 * @returns {string|null}
 */
function formatMissingClaimsMessage(result) {
  if (!result || result.ok || !Array.isArray(result.missingClaims) || result.missingClaims.length === 0) {
    return null;
  }
  const lines = [
    `Commit message claims ${result.missingClaims.length} item(s) that do not appear in the staged diff:`
  ];
  for (const c of result.missingClaims) {
    lines.push(`  • ${c.kind === 'finding-id' ? 'Finding' : c.kind === 'task-id' ? 'Task' : 'File'} "${c.value}" — not found`);
  }
  lines.push('');
  lines.push('Options:');
  lines.push('  1. Add the missing fix to the commit now (git add + amend)');
  lines.push('  2. Remove the unverified claim from the commit message');
  lines.push('  3. Acknowledge + proceed (use --force-commit-claims if blocking from a gate)');
  return lines.join('\n');
}

// ============================================================
// Spec-String Bundle Grep (wf-07046456 / B4)
// ============================================================

/**
 * Extract the "string bundle" from a spec: every named artifact the spec promises
 * to produce, consume, or reference. The bundle is the set of concrete strings
 * that MUST appear somewhere in the delivery (diff, changed files, bundle output)
 * for the spec to be honored.
 *
 * Bundles extracted:
 *   - Backtick-quoted identifiers: `functionName`, `ConfigKey`, `module/path.js`
 *   - Double-quoted string literals: "exact error message", "button label"
 *   - File paths with extensions: foo/bar.js, .workflow/state/X.json
 *   - ALLCAPS_CONSTANTS
 *   - Route/URL paths: /api/v1/users, /dashboard/settings
 *
 * @param {string} specMarkdown
 * @returns {{ backtickIds: string[], quotedStrings: string[], filePaths: string[], constants: string[], routes: string[], all: string[] }}
 */
function extractSpecStrings(specMarkdown) {
  if (typeof specMarkdown !== 'string' || specMarkdown.length === 0) {
    return { backtickIds: [], quotedStrings: [], filePaths: [], constants: [], routes: [], all: [] };
  }
  // Strip code fences first so we don't double-count bodies of code blocks
  const withoutFences = specMarkdown.replace(/```[\s\S]*?```/g, '');

  const backtickIds = [...new Set(
    [...withoutFences.matchAll(/`([^`\n]{2,80})`/g)].map((m) => m[1].trim())
      .filter((s) => s.length >= 2 && !/^\s*$/.test(s))
  )];
  const quotedStrings = [...new Set(
    [...withoutFences.matchAll(/"([^"\n]{3,120})"/g)].map((m) => m[1].trim())
      .filter((s) => !/^(TODO|FIXME|XXX)$/i.test(s))
  )];
  const filePaths = [...new Set(
    [...withoutFences.matchAll(/\b([\w./-]+\.(?:js|ts|tsx|jsx|md|json|yaml|yml|py|go|rs|sh|toml|hbs))\b/g)].map((m) => m[1])
  )];
  const constants = [...new Set(
    // Require at least one underscore or digit — excludes bare HTTP verbs (POST/GET) and common all-caps words (JSON/HTML/CSV)
    [...withoutFences.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]{1,40}|[A-Z_]{2,}\d+[A-Z0-9_]*)\b/g)].map((m) => m[1])
      .filter((s) => !/^(TODO|FIXME|XXX|NOTE|HACK|TBD|WIP)$/.test(s))
  )];
  const routes = [...new Set(
    [...withoutFences.matchAll(/(?:^|\s|`)(\/[a-z0-9][a-z0-9./_:-]{2,80})(?=[\s`"'.,]|$)/gmi)].map((m) => m[1])
      .filter((s) => !s.startsWith('//') && !s.startsWith('/Users/') && !s.startsWith('/home/'))
  )];

  const all = [...new Set([...backtickIds, ...quotedStrings, ...filePaths, ...constants, ...routes])];
  return { backtickIds, quotedStrings, filePaths, constants, routes, all };
}

/**
 * Verify spec-string coverage against delivery.
 *
 * @param {object} opts
 * @param {string} opts.specMarkdown
 * @param {string} opts.diffText - git diff
 * @param {string[]} [opts.changedFiles]
 * @param {string} [opts.bundleText] - built-bundle text (minified) if available
 * @param {string[]} [opts.additionalSources] - other text sources (e.g., commit message)
 * @param {object} [opts.categoryMins] - minimum coverage ratio per category (default 0.8)
 * @returns {{ ok: boolean, missingByCategory: object, coverage: object, strict: boolean }}
 */
function verifySpecBundleCoverage({
  specMarkdown,
  diffText = '',
  changedFiles = [],
  bundleText = '',
  additionalSources = [],
  categoryMins = {},
}) {
  const bundle = extractSpecStrings(specMarkdown);
  const haystack = [diffText, bundleText, changedFiles.join('\n'), ...additionalSources].join('\n');
  const defaults = { backtickIds: 0.8, quotedStrings: 0.7, filePaths: 1.0, constants: 0.8, routes: 1.0 };
  const mins = { ...defaults, ...categoryMins };

  const coverage = {};
  const missingByCategory = {};
  for (const cat of Object.keys(mins)) {
    const items = bundle[cat] || [];
    if (items.length === 0) { coverage[cat] = { total: 0, hit: 0, ratio: 1, threshold: mins[cat] }; missingByCategory[cat] = []; continue; }
    const missing = items.filter((s) => !haystack.includes(s));
    const hit = items.length - missing.length;
    coverage[cat] = { total: items.length, hit, ratio: hit / items.length, threshold: mins[cat], missing };
    missingByCategory[cat] = missing;
  }

  const strict = Object.entries(coverage).every(([, v]) => v.ratio >= v.threshold);
  return { ok: strict, missingByCategory, coverage, strict };
}

/**
 * Format spec-bundle verification as a human-readable report.
 * @param {object} result
 * @returns {string|null}
 */
function formatSpecBundleResult(result) {
  if (!result) return null;
  const lines = [];
  lines.push(result.ok ? 'Spec-bundle grep OK:' : 'Spec-bundle grep FAIL:');
  for (const [cat, v] of Object.entries(result.coverage)) {
    if (v.total === 0) continue;
    const mark = v.ratio >= v.threshold ? '✓' : '✗';
    lines.push(`  ${mark} ${cat}: ${v.hit}/${v.total} (ratio ${v.ratio.toFixed(2)}, needs ${v.threshold.toFixed(2)})`);
    if (v.ratio < v.threshold && v.missing.length > 0) {
      lines.push(`      missing: ${v.missing.slice(0, 6).map((s) => `"${s}"`).join(', ')}${v.missing.length > 6 ? ', ...' : ''}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// BEL-file grep (wf-10c452f7 / B2) — Bulleted-Expectation List grep
// ============================================================

/**
 * Parse a spec file for BEL (bulleted-expectation list) items. A BEL item is any
 * top-level `- ` or `* ` bullet under an "Acceptance Criteria", "Expectations",
 * "Requirements", or "Success Criteria" heading.
 *
 * @param {string} specMarkdown
 * @returns {Array<{text: string, heading: string}>}
 */
function parseBELItems(specMarkdown) {
  if (typeof specMarkdown !== 'string' || specMarkdown.length === 0) return [];
  const lines = specMarkdown.split('\n');
  const belHeadingRe = /^(#{1,6})\s+(Acceptance Criteria|Expectations|Requirements|Success Criteria|Acceptance|Definition of Done|Criteria)\b/i;
  const anyHeadingRe = /^#{1,6}\s+/;
  const bulletRe = /^\s*[-*]\s+(.+)$/;
  const items = [];

  let inSection = false;
  let currentHeading = '';
  for (const line of lines) {
    const belMatch = line.match(belHeadingRe);
    if (belMatch) { inSection = true; currentHeading = belMatch[2]; continue; }
    if (inSection && anyHeadingRe.test(line) && !line.match(belHeadingRe)) { inSection = false; continue; }
    if (!inSection) continue;
    const b = line.match(bulletRe);
    if (b) items.push({ text: b[1].trim(), heading: currentHeading });
  }
  return items;
}

/**
 * Extract keyword tokens from a BEL item for grep-based coverage detection.
 * Reuses the STOPWORDS heuristic used elsewhere.
 * @param {string} text
 * @returns {string[]}
 */
function _belKeywords(text) {
  const STOPWORDS = new Set([
    'with', 'from', 'that', 'this', 'have', 'make', 'been', 'were', 'their',
    'they', 'them', 'will', 'should', 'would', 'could', 'there', 'into',
    'when', 'then', 'than', 'which', 'what', 'your', 'user', 'users', 'given',
    'able', 'must', 'shall', 'system', 'application', 'feature',
  ]);
  const tokens = String(text).toLowerCase().match(/\b[a-z][a-z0-9_-]{3,}\b/g) || [];
  return [...new Set(tokens.filter((t) => !STOPWORDS.has(t)))];
}

/**
 * Verify each BEL item's keywords appear somewhere in the delivery haystack
 * (commit message + diff + changed-file paths).
 *
 * @param {object} opts
 * @param {string} opts.specMarkdown - the spec content to parse BEL items from
 * @param {string} opts.diffText - output of `git diff` or equivalent
 * @param {string[]} [opts.changedFiles] - changed-file paths
 * @param {string} [opts.commitMessage] - commit message
 * @param {number} [opts.minKeywordHits=2] - min distinct keyword hits per item for coverage
 * @returns {{ ok: boolean, totalItems: number, coveredItems: Array, uncoveredItems: Array }}
 */
function verifyBELAgainstDelivery({ specMarkdown, diffText, changedFiles = [], commitMessage = '', minKeywordHits = 2 }) {
  const items = parseBELItems(specMarkdown);
  if (items.length === 0) return { ok: true, totalItems: 0, coveredItems: [], uncoveredItems: [] };

  const haystack = [diffText || '', commitMessage || '', changedFiles.join(' ')].join('\n').toLowerCase();
  const covered = [];
  const uncovered = [];

  for (const item of items) {
    const keywords = _belKeywords(item.text);
    if (keywords.length === 0) { covered.push({ ...item, hits: 0, keywords: [] }); continue; }

    const hits = keywords.filter((k) => haystack.includes(k));
    const threshold = Math.min(minKeywordHits, keywords.length);
    if (hits.length >= threshold) {
      covered.push({ ...item, hits: hits.length, keywords, matchedKeywords: hits });
    } else {
      uncovered.push({ ...item, hits: hits.length, keywords, matchedKeywords: hits, threshold });
    }
  }

  return {
    ok: uncovered.length === 0,
    totalItems: items.length,
    coveredItems: covered,
    uncoveredItems: uncovered,
  };
}

/**
 * Format BEL verification result as a human-readable report.
 * @param {object} result
 * @param {string} [specPath]
 * @returns {string|null}
 */
function formatBELResult(result, specPath = '') {
  if (!result || result.totalItems === 0) return null;
  if (result.ok) {
    return `BEL gate OK: all ${result.totalItems} expectation(s) from ${specPath || 'spec'} covered by delivery.`;
  }
  const lines = [`BEL gate FAIL: ${result.uncoveredItems.length}/${result.totalItems} expectation(s) not found in delivery (${specPath || 'spec'}):`];
  for (const u of result.uncoveredItems) {
    lines.push(`  ✗ [${u.heading}] "${u.text.slice(0, 80)}"`);
    lines.push(`      matched ${u.hits}/${u.keywords.length} keywords (need ${u.threshold}); missing: ${u.keywords.filter((k) => !u.matchedKeywords.includes(k)).slice(0, 5).join(', ')}`);
  }
  lines.push('');
  lines.push('Options: add the missing implementation, update the spec if the expectation was dropped with user approval, or force with --skip-bel.');
  return lines.join('\n');
}

// ============================================================
// Confidence-Tier Rubric (95 / 85 / 75)
// See .workflow/rubrics/confidence-tiers.md for full rubric.
// Reconciled with EVIDENCE_TIERS (0..4). Story: wf-f14dcfeb (A4).
// ============================================================

const CONFIDENCE_TIERS = { HIGH: 95, MEDIUM: 85, LOW: 75 };

/**
 * Map (evidenceTier, signal strength) → confidencePct per the rubric.
 *
 * @param {Object} opts
 * @param {number} opts.evidenceTier - 0..4 (see EVIDENCE_TIERS)
 * @param {number} [opts.hitCount] - grep/glob match count (for tier 1)
 * @param {number} [opts.fileCount] - distinct files for tier 1 hits
 * @param {number} [opts.observationCount] - corroborating observations (for tier 2)
 * @param {boolean} [opts.hasEvidenceNote] - whether a concrete citation was provided
 * @returns {{ confidencePct: 95|85|75, flagUnverified: boolean, severityCap: 'LOW'|'HIGH'|null, rationale: string }}
 */
function computeConfidenceTier({
  evidenceTier,
  hitCount = 0,
  fileCount = 0,
  observationCount = 0,
  hasEvidenceNote = true,
} = {}) {
  const t = typeof evidenceTier === 'number' ? evidenceTier : -1;

  if (t >= 3) {
    return { confidencePct: 95, flagUnverified: false, severityCap: null, rationale: 'tier >= 3 (interactive/automated)' };
  }
  if (t === 2) {
    if (observationCount >= 2) {
      return { confidencePct: 95, flagUnverified: false, severityCap: null, rationale: 'tier 2 with 2+ corroborating observations' };
    }
    return { confidencePct: 85, flagUnverified: false, severityCap: 'HIGH', rationale: 'tier 2, single observation' };
  }
  if (t === 1) {
    if (hitCount >= 10 && fileCount >= 3) {
      return { confidencePct: 95, flagUnverified: false, severityCap: null, rationale: 'tier 1 with 10+ hits across 3+ files' };
    }
    if (hitCount >= 5) {
      return { confidencePct: 85, flagUnverified: false, severityCap: 'HIGH', rationale: 'tier 1 with 5-9 hits' };
    }
    if (hitCount >= 3 && fileCount >= 2) {
      return { confidencePct: 85, flagUnverified: false, severityCap: 'HIGH', rationale: 'tier 1 with 3+ hits across 2+ files' };
    }
    return { confidencePct: 75, flagUnverified: true, severityCap: 'LOW', rationale: 'tier 1, isolated hits' };
  }
  if (t === 0 || !hasEvidenceNote) {
    return { confidencePct: 75, flagUnverified: true, severityCap: 'LOW', rationale: 'tier 0 (static/source-inference) or no evidenceNote' };
  }
  // t === -1: no evidence
  return { confidencePct: 75, flagUnverified: true, severityCap: 'LOW', rationale: 'no evidence recorded' };
}

/**
 * Validate a finding carries confidencePct in the allowed set.
 * @param {Object} finding
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateConfidencePct(finding) {
  const allowed = [95, 85, 75];
  if (!finding || !allowed.includes(finding.confidencePct)) {
    return { ok: false, reason: `confidencePct must be one of ${allowed.join('|')}; got ${finding?.confidencePct}` };
  }
  if (finding.confidencePct === 75 && !finding.flagUnverified) {
    return { ok: false, reason: 'confidencePct=75 findings MUST set flagUnverified=true' };
  }
  return { ok: true };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  recordEvidence,
  auditCompletionClaim,
  downgradeClaim,
  completionTruthGate,
  getStepEvidence,
  isTruthGateDisabled,
  getMinTierForDone,
  scanForClaimContradictions,
  parseCommitMessageClaims,
  verifyCommitMessageAgainstDiff,
  formatMissingClaimsMessage,
  computeConfidenceTier,
  validateConfidencePct,
  CONFIDENCE_TIERS,
  parseBELItems,
  verifyBELAgainstDelivery,
  formatBELResult,
  extractSpecStrings,
  verifySpecBundleCoverage,
  formatSpecBundleResult,
  TIER_NAMES,
  DONE_WORDS,
  DISAGREEMENT_WORDS,
};
