#!/usr/bin/env node

/**
 * AC Scope-Preservation Checklist (wf-fe8ef64d / B1).
 *
 * Extends the existing Item Reconciliation Gate (scripts/flow-story-gates.js):
 *   - Reconciliation verifies items → criteria at CREATION time only.
 *   - Scope-preservation snapshots the originally-stated ACs at creation,
 *     then re-verifies at task CLOSE time that none were silently dropped,
 *     merged, or reshaped during implementation.
 *
 * Data at rest:
 *   .workflow/state/ac-snapshots/<taskId>.json
 *
 * Consumer wiring:
 *   - scripts/flow-story.js calls snapshotCriteria() after generating the
 *     acceptance criteria list.
 *   - scripts/flow-bug.js does the same.
 *   - scripts/flow-done.js calls verifyScopePreservation() as a quality gate
 *     before moving a task to completed.
 *
 * Story: wf-fe8ef64d (B1)
 * Epic: wf-34290000
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, safeJsonParse } = require('./flow-io');

const SNAPSHOT_DIR = path.join(PATHS.state, 'ac-snapshots');

function _ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function _snapshotPath(taskId) {
  if (!/^wf-[a-f0-9]{8}(-\d{2})?$/i.test(String(taskId || ''))) {
    throw new TypeError(`invalid taskId: ${taskId}`);
  }
  return path.join(SNAPSHOT_DIR, `${taskId}.json`);
}

/**
 * Persist the original acceptance criteria as a baseline for close-time verification.
 * Idempotent: a second call for the same taskId with unchanged content is a no-op.
 *
 * @param {string} taskId
 * @param {string[]} criteria - array of criterion strings
 * @param {object} [meta] - optional metadata (title, createdAt, rawInput)
 * @returns {{ok: boolean, path?: string, skipped?: boolean, reason?: string}}
 */
function snapshotCriteria(taskId, criteria, meta = {}) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return { ok: false, reason: 'criteria must be a non-empty array' };
  }
  _ensureDir();
  const p = _snapshotPath(taskId);
  const payload = {
    taskId,
    snapshotAt: new Date().toISOString(),
    criteria: criteria.map((c, i) => ({ id: `ac-${i + 1}`, text: String(c).trim() })),
    meta,
  };
  // Idempotency: if an existing snapshot has the same texts in the same order, skip.
  if (fileExists(p)) {
    const prev = safeJsonParse(p, null);
    if (prev && Array.isArray(prev.criteria) && prev.criteria.length === payload.criteria.length) {
      const same = prev.criteria.every((c, i) => c.text === payload.criteria[i].text);
      if (same) return { ok: true, path: p, skipped: true, reason: 'identical snapshot exists' };
    }
  }
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  return { ok: true, path: p };
}

/**
 * Load a prior snapshot.
 * @param {string} taskId
 * @returns {object|null}
 */
function loadSnapshot(taskId) {
  const p = _snapshotPath(taskId);
  if (!fileExists(p)) return null;
  return safeJsonParse(p, null);
}

/**
 * Token-overlap coverage check. Reuses the heuristic from flow-story-gates.js
 * but returns a per-criterion verdict instead of a single boolean.
 *
 * @param {string} original - original criterion text
 * @param {string[]} current - current criterion texts
 * @returns {{ status: 'preserved'|'modified'|'dropped', matchIdx: number, overlap: number }}
 */
function _matchCriterion(original, current) {
  const STOPWORDS = new Set([
    'with', 'from', 'that', 'this', 'have', 'make', 'been', 'were', 'their',
    'they', 'them', 'will', 'should', 'would', 'could', 'there', 'into',
    'when', 'then', 'than', 'which', 'what', 'your', 'given',
    // User-story boilerplate — every criterion contains these, so they dilute signal
    'user', 'users', 'admin', 'admins', 'administrator', 'administrators',
    'able', 'must', 'shall', 'action',
  ]);
  const tokenize = (s) => new Set(
    String(s).toLowerCase().match(/\b[a-z]{4,}\b/g)?.filter((w) => !STOPWORDS.has(w)) || []
  );
  const origTokens = tokenize(original);
  if (origTokens.size === 0) return { status: 'dropped', matchIdx: -1, overlap: 0 };

  let best = { idx: -1, overlap: 0 };
  current.forEach((c, idx) => {
    const ct = tokenize(c);
    let overlap = 0;
    for (const t of origTokens) {
      if (ct.has(t)) overlap++;
    }
    if (overlap > best.overlap) best = { idx, overlap };
  });

  const orig = origTokens.size;
  if (best.overlap === 0) return { status: 'dropped', matchIdx: -1, overlap: 0 };

  // Strong match: ≥ 75% overlap AND ≥ 2 absolute tokens (or ≥ orig when orig < 2) → preserved.
  // Weak match: any non-zero overlap that didn't reach the strong bar → modified.
  // Rationale: uploading a photo vs. deleting a photo share "profile|photo" at 67%,
  // but the verb difference makes it a distinct criterion — flag as modified for review.
  const ratio = best.overlap / orig;
  const minAbsolute = Math.min(2, orig);
  const preserved = ratio >= 0.75 && best.overlap >= minAbsolute;
  return {
    status: preserved ? 'preserved' : 'modified',
    matchIdx: best.idx,
    overlap: best.overlap,
  };
}

/**
 * Verify scope preservation by comparing current criteria to the original snapshot.
 *
 * @param {string} taskId
 * @param {string[]} currentCriteria
 * @returns {{ok: boolean, reason?: string, preserved: Array, modified: Array, dropped: Array, added: Array}}
 */
function verifyScopePreservation(taskId, currentCriteria) {
  const snap = loadSnapshot(taskId);
  if (!snap) return { ok: false, reason: `no snapshot for ${taskId}`, preserved: [], modified: [], dropped: [], added: [] };
  if (!Array.isArray(currentCriteria)) {
    return { ok: false, reason: 'currentCriteria must be an array', preserved: [], modified: [], dropped: [], added: [] };
  }

  const preserved = [];
  const modified = [];
  const dropped = [];
  const matchedCurrentIdxs = new Set();

  for (const orig of snap.criteria) {
    const m = _matchCriterion(orig.text, currentCriteria);
    if (m.status === 'preserved') {
      preserved.push({ id: orig.id, text: orig.text, currentIdx: m.matchIdx });
      matchedCurrentIdxs.add(m.matchIdx);
    } else if (m.status === 'modified') {
      modified.push({ id: orig.id, text: orig.text, currentIdx: m.matchIdx, currentText: currentCriteria[m.matchIdx], overlap: m.overlap });
      matchedCurrentIdxs.add(m.matchIdx);
    } else {
      dropped.push({ id: orig.id, text: orig.text });
    }
  }

  const added = currentCriteria
    .map((text, idx) => ({ idx, text }))
    .filter(({ idx }) => !matchedCurrentIdxs.has(idx))
    .map(({ text }) => ({ text }));

  // Detect collapse-merges: when two originals matched the same current index,
  // the second original is effectively dropped (merged into the first).
  const currentIdxCounts = {};
  for (const p of preserved) currentIdxCounts[p.currentIdx] = (currentIdxCounts[p.currentIdx] || 0) + 1;
  for (const m of modified) currentIdxCounts[m.currentIdx] = (currentIdxCounts[m.currentIdx] || 0) + 1;
  const collapseDetected = Object.values(currentIdxCounts).some((n) => n > 1);

  return {
    ok: dropped.length === 0 && !collapseDetected,
    collapseDetected,
    preserved,
    modified,
    dropped,
    added,
  };
}

/**
 * Format verification result as a human-readable checklist.
 * @param {object} result - from verifyScopePreservation
 * @param {string} [taskId]
 * @returns {string}
 */
function formatChecklist(result, taskId = '') {
  const lines = [];
  lines.push(`━━━ AC Scope-Preservation Checklist${taskId ? ' — ' + taskId : ''} ━━━`);
  for (const p of result.preserved) lines.push(`  ✓ ${p.id}: ${p.text.slice(0, 80)}`);
  for (const m of result.modified) lines.push(`  ~ ${m.id}: ${m.text.slice(0, 80)}\n      → became: ${String(m.currentText).slice(0, 80)}`);
  for (const d of result.dropped) lines.push(`  ✗ ${d.id}: ${d.text.slice(0, 80)}  [DROPPED — violates anti-deferral]`);
  for (const a of result.added) lines.push(`  + new: ${String(a.text).slice(0, 80)}`);
  lines.push(result.ok ? '  Status: OK — no criteria dropped' : `  Status: BLOCKED — ${result.dropped.length} criterion/criteria dropped`);
  return lines.join('\n');
}

module.exports = {
  snapshotCriteria,
  loadSnapshot,
  verifyScopePreservation,
  formatChecklist,
  SNAPSHOT_DIR,
};

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'snapshot') {
    const taskId = process.argv[3];
    const criteria = process.argv.slice(4);
    console.log(JSON.stringify(snapshotCriteria(taskId, criteria), null, 2));
  } else if (cmd === 'verify') {
    const taskId = process.argv[3];
    const criteria = process.argv.slice(4);
    const r = verifyScopePreservation(taskId, criteria);
    console.log(formatChecklist(r, taskId));
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error('usage: flow-ac-scope-preservation snapshot <taskId> <criterion...>');
    console.error('       flow-ac-scope-preservation verify <taskId> <criterion...>');
    process.exit(2);
  }
}
