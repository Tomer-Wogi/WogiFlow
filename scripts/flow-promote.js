#!/usr/bin/env node

/**
 * Wogi Flow - Promotion Pipeline
 *
 * Closes audit gaps G6 (feedback-patterns underused) and G8 (adversary findings
 * not promoted) from `.workflow/audits/state-coverage-2026-04-15.md`.
 *
 * Two new feed wires:
 *   1. Adversary-finding promotion — recurring principle FAIL/CONCERN across
 *      adversary-runs/*.json becomes a feedback-pattern entry after N hits.
 *   2. Pattern-phrase promotion — entries in correction-patterns.json
 *      (wf-e6d65edf) that exceed confirmedHits >= patternToFeedbackThreshold
 *      become feedback-pattern entries (one-shot, idempotent via lastPromotedAt).
 *
 * Both wires write through `flow-learning-orchestrator.modifyFeedbackPatterns`
 * — never directly to feedback-patterns.md — so dedup + locking are inherited.
 *
 * Story: wf-6a352aae (epic-episodic-memory). User-approved scope:
 *   - adversaryPromotionThreshold: 2
 *   - patternToFeedbackThreshold: 3
 *   - autoAtSessionEnd: true (writes to pending-promotions.json — interactive
 *     `flow promote --apply` confirms before write to feedback-patterns.md)
 *
 * Usage (programmatic):
 *   const { promoteAll, scanForPromotions, applyPendingPromotions } = require('./flow-promote');
 *   const result = await promoteAll(getConfig());
 *   // → { adversary: { proposed: N, applied: M }, patternPhrase: { ... } }
 *
 * CLI:
 *   node scripts/flow-promote.js scan       # scan and write pending-promotions.json
 *   node scripts/flow-promote.js apply      # apply pending promotions
 *   node scripts/flow-promote.js status     # show pending-promotions.json contents
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  PATHS,
  safeJsonParse,
  safeJsonParseString,
  writeJson,
  ensureDir,
  withLock,
  getTodayDate,
} = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');

// ============================================================================
// Constants & paths
// ============================================================================

const ADVERSARY_RUNS_DIR = path.join(PATHS.state, 'adversary-runs');
const CORRECTION_PATTERNS_FILE = path.join(PATHS.state, 'correction-patterns.json');
const PENDING_PROMOTIONS_FILE = path.join(PATHS.state, 'pending-promotions.json');

const PROMOTION_DEFAULTS = Object.freeze({
  autoAtSessionEnd: true,
  adversaryPromotionThreshold: 2,
  patternToFeedbackThreshold: 3,
});

// ============================================================================
// Config
// ============================================================================

function getPromotionConfig() {
  let cfg = {};
  try {
    cfg = getConfig() || {};
  } catch (_err) {
    cfg = {};
  }
  const p = cfg.promotion || {};
  return {
    autoAtSessionEnd: p.autoAtSessionEnd !== false,
    adversaryPromotionThreshold: Number.isFinite(p.adversaryPromotionThreshold)
      ? p.adversaryPromotionThreshold
      : PROMOTION_DEFAULTS.adversaryPromotionThreshold,
    patternToFeedbackThreshold: Number.isFinite(p.patternToFeedbackThreshold)
      ? p.patternToFeedbackThreshold
      : PROMOTION_DEFAULTS.patternToFeedbackThreshold,
  };
}

// ============================================================================
// Adversary-finding promotion
// ============================================================================

/**
 * Read all adversary-run JSON files (skip _archive subdir).
 * @returns {Array<{filePath, taskId, principles, round}>}
 */
function loadAdversaryRuns() {
  if (!fs.existsSync(ADVERSARY_RUNS_DIR)) return [];
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(ADVERSARY_RUNS_DIR);
  } catch (_err) {
    return [];
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    // _archive is a subdirectory and has no .json extension at the top level;
    // index.json lives inside _archive so won't appear in readdir here.
    const full = path.join(ADVERSARY_RUNS_DIR, name);
    try {
      const raw = fs.readFileSync(full, 'utf-8');
      const parsed = safeJsonParseString(raw, null);
      if (!parsed || typeof parsed !== 'object') continue;
      out.push({
        filePath: full,
        fileName: name,
        taskId: parsed.taskId || null,
        round: parsed.round || null,
        principles: Array.isArray(parsed.principles) ? parsed.principles : [],
      });
    } catch (_err) {
      // Skip malformed file silently (DEBUG-mode log only).
      if (process.env.DEBUG) {
        console.error(`[promote] could not read ${name}: ${_err.message}`);
      }
    }
  }
  return out;
}

/**
 * Normalize an issue string to a stable key for grouping. Lowercase, collapse
 * whitespace, drop trailing punctuation, take leading 80 chars.
 */
function normalizeIssueKey(issue) {
  return String(issue || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,:]+\s*$/, '')
    .trim()
    .slice(0, 80);
}

/**
 * Normalize a principle ID so different run formats group together. Examples:
 *   "P11.2" → "p11.2"
 *   "11.2"  → "p11.2"
 *   2       → "p2"
 *   "P3"    → "p3"
 */
function normalizePrincipleId(id) {
  let s = String(id || '').trim().toLowerCase();
  if (!s) return '';
  if (!s.startsWith('p')) s = 'p' + s;
  return s;
}

/**
 * Group adversary findings by (principleId, normalizedIssue). Only counts
 * FAIL or CONCERN verdicts — PASS / SKIP do not signal a recurring problem.
 * @returns {Map<string, {principleId, issueKey, hits: Set<string>, examples: Array}>}
 */
function groupAdversaryFindings(runs) {
  const groups = new Map();
  for (const run of runs) {
    for (const principle of run.principles) {
      const verdict = String(principle?.verdict || '').toUpperCase();
      if (verdict !== 'FAIL' && verdict !== 'CONCERN') continue;
      const issueKey = normalizeIssueKey(principle.issue || principle.evidence || '');
      if (!issueKey) continue;
      const principleId = normalizePrincipleId(principle.id);
      if (!principleId) continue;
      const groupKey = `${principleId}::${issueKey}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          principleId,
          issueKey,
          hits: new Set(),
          examples: [],
        });
      }
      const g = groups.get(groupKey);
      // Use taskId+round as the unique-occurrence key so the same finding
      // re-evaluated in round 2 doesn't double-count.
      const occKey = `${run.taskId || run.fileName}::r${run.round || ''}`;
      g.hits.add(occKey);
      if (g.examples.length < 3) {
        g.examples.push({
          taskId: run.taskId,
          fileName: run.fileName,
          issue: String(principle.issue || principle.evidence || '').slice(0, 240),
          remedy: String(principle.remedy || '').slice(0, 240),
        });
      }
    }
  }
  return groups;
}

/**
 * Identify adversary findings that meet the promotion threshold.
 * @returns {Array<{kind: 'adversary', key: string, count: number, feedbackEntry, sourceRef}>}
 */
function findAdversaryPromotions(threshold) {
  const runs = loadAdversaryRuns();
  if (runs.length === 0) return [];
  const groups = groupAdversaryFindings(runs);
  const out = [];
  for (const [groupKey, g] of groups) {
    const count = g.hits.size;
    if (count < threshold) continue;
    const today = getTodayDate();
    const summary = g.issueKey;
    out.push({
      kind: 'adversary',
      key: groupKey,
      count,
      sourceRef: `adversary-runs (${count} occurrences across: ${[...g.hits].slice(0, 5).join(', ')})`,
      feedbackEntry: {
        date: today,
        pattern: `${g.principleId}: ${summary}`,
        source: 'adversary-finding',
        count,
        confidence: Math.min(100, 60 + count * 10),
        status: 'Monitor',
      },
      examples: g.examples,
    });
  }
  return out;
}

// ============================================================================
// Pattern-phrase promotion
// ============================================================================

/**
 * Read correction-patterns.json (file may be absent — treated as empty).
 */
function loadCorrectionPatterns() {
  if (!fs.existsSync(CORRECTION_PATTERNS_FILE)) return [];
  try {
    const raw = fs.readFileSync(CORRECTION_PATTERNS_FILE, 'utf-8');
    const parsed = safeJsonParseString(raw, null);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (_err) {
    return [];
  }
}

/**
 * Identify pattern phrases that meet promotion threshold AND have not been
 * promoted yet (no `lastPromotedAt`).
 */
function findPatternPhrasePromotions(threshold) {
  const patterns = loadCorrectionPatterns();
  if (patterns.length === 0) return [];
  const out = [];
  for (const p of patterns) {
    if (!p || typeof p !== 'object' || !p.phrase) continue;
    const confirmedHits = Number(p.confirmedHits) || 0;
    if (confirmedHits < threshold) continue;
    if (p.lastPromotedAt) continue; // already promoted (one-shot)
    const today = getTodayDate();
    out.push({
      kind: 'pattern-phrase',
      key: `phrase::${String(p.phrase).toLowerCase()}`,
      count: confirmedHits,
      sourceRef: `correction-patterns.json (phrase="${String(p.phrase).slice(0, 80)}", confirmedHits=${confirmedHits})`,
      feedbackEntry: {
        date: today,
        pattern: `correction-phrase: "${p.phrase}"`,
        source: 'pattern-phrase',
        count: confirmedHits,
        confidence: Math.min(100, 65 + confirmedHits * 5),
        status: 'Monitor',
      },
    });
  }
  return out;
}

// ============================================================================
// Pending promotions queue
// ============================================================================

function loadPendingPromotions() {
  if (!fs.existsSync(PENDING_PROMOTIONS_FILE)) return null;
  return safeJsonParse(PENDING_PROMOTIONS_FILE, null);
}

async function savePendingPromotions(payload) {
  ensureDir(path.dirname(PENDING_PROMOTIONS_FILE));
  await withLock(PENDING_PROMOTIONS_FILE, async () => {
    writeJson(PENDING_PROMOTIONS_FILE, payload);
  });
}

async function clearPendingPromotions() {
  if (!fs.existsSync(PENDING_PROMOTIONS_FILE)) return;
  await withLock(PENDING_PROMOTIONS_FILE, async () => {
    try {
      fs.unlinkSync(PENDING_PROMOTIONS_FILE);
    } catch (_err) { /* no-op */ }
  });
}

// ============================================================================
// Scan + write to pending-promotions.json
// ============================================================================

/**
 * Scan both promotion sources and return all promotions meeting thresholds.
 * Does NOT write to feedback-patterns.md — caller decides (auto session-end
 * vs interactive apply).
 */
function scanForPromotions(config) {
  const cfg = config || getPromotionConfig();
  const adversary = findAdversaryPromotions(cfg.adversaryPromotionThreshold);
  const patternPhrase = findPatternPhrasePromotions(cfg.patternToFeedbackThreshold);
  return { adversary, patternPhrase };
}

/**
 * Write proposals into pending-promotions.json. Idempotent: re-running with
 * the same input writes the same payload (same proposedAt is replaced).
 */
async function writePendingPromotions(scan) {
  const all = [...scan.adversary, ...scan.patternPhrase];
  if (all.length === 0) {
    await clearPendingPromotions();
    return { written: false, count: 0 };
  }
  const payload = {
    proposedAt: new Date().toISOString(),
    promotions: all,
  };
  await savePendingPromotions(payload);
  return { written: true, count: all.length };
}

// ============================================================================
// Apply pending promotions (writes to feedback-patterns.md via orchestrator)
// ============================================================================

/**
 * Stamp `lastPromotedAt` on the source pattern in correction-patterns.json so
 * the same phrase is not proposed again. Race-safe via withLock.
 */
async function stampPatternPromoted(phrase) {
  if (!fs.existsSync(CORRECTION_PATTERNS_FILE)) return;
  await withLock(CORRECTION_PATTERNS_FILE, async () => {
    let arr;
    try {
      arr = safeJsonParseString(fs.readFileSync(CORRECTION_PATTERNS_FILE, 'utf-8'), null);
    } catch (_err) {
      return;
    }
    if (!Array.isArray(arr)) return;
    const key = String(phrase).toLowerCase();
    const idx = arr.findIndex(p => String(p?.phrase || '').toLowerCase() === key);
    if (idx < 0) return;
    arr[idx] = { ...arr[idx], lastPromotedAt: new Date().toISOString() };
    writeJson(CORRECTION_PATTERNS_FILE, arr);
  });
}

/**
 * Apply a single promotion via the learning orchestrator.
 */
async function applyPromotion(promotion) {
  const orch = require('./flow-learning-orchestrator');
  const entry = promotion.feedbackEntry;
  const tableRow = `| ${entry.date} | ${entry.pattern} | ${entry.source} | ${entry.count} | ${entry.confidence}% | ${entry.status} |`;
  const result = await orch.modifyFeedbackPatterns(
    (currentContent) => {
      const content = currentContent || '';
      // Append to end (or before "## Promotion History" if present).
      let next;
      if (content.includes('## Promotion History')) {
        next = content.replace('## Promotion History', tableRow + '\n\n## Promotion History');
      } else if (content.length === 0) {
        next = `# Feedback Patterns\n\n## Auto-Captured Patterns\n\n| Date | Pattern | Source | Count | Confidence | Status |\n|------|---------|--------|-------|------------|--------|\n${tableRow}\n`;
      } else {
        next = content + (content.endsWith('\n') ? '' : '\n') + tableRow + '\n';
      }
      return { content: next, entryText: entry.pattern };
    },
    { caller: 'flow-promote/applyPromotion' }
  );
  // After successful write, stamp source.
  if (result.success && promotion.kind === 'pattern-phrase') {
    // Extract phrase from feedbackEntry.pattern: 'correction-phrase: "X"'
    const m = String(entry.pattern).match(/^correction-phrase:\s*"(.+)"$/);
    if (m) await stampPatternPromoted(m[1]);
  }
  return result;
}

/**
 * Apply all pending promotions from pending-promotions.json. Returns a summary.
 */
async function applyPendingPromotions() {
  const pending = loadPendingPromotions();
  if (!pending || !Array.isArray(pending.promotions) || pending.promotions.length === 0) {
    return { applied: 0, skipped: 0, failed: 0 };
  }
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of pending.promotions) {
    try {
      const r = await applyPromotion(p);
      if (r.success) applied += 1;
      else if (r.reason === 'duplicate') skipped += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      if (process.env.DEBUG) {
        console.error(`[promote] apply failed for ${p.key}: ${err.message}`);
      }
    }
  }
  if (failed === 0) {
    await clearPendingPromotions();
  }
  return { applied, skipped, failed };
}

// ============================================================================
// promoteAll — top-level used by session-end hook
// ============================================================================

/**
 * Scan + write pending-promotions.json (no apply). Caller can apply
 * interactively via `flow promote apply`. Designed to be fire-and-forget
 * from the session-end hook.
 *
 * @param {Object} [config]
 * @returns {Promise<{ proposed: number, written: boolean, scan: Object }>}
 */
async function promoteAll(config) {
  const cfg = config || getPromotionConfig();
  const scan = scanForPromotions(cfg);
  const writeResult = await writePendingPromotions(scan);
  return {
    proposed: writeResult.count,
    written: writeResult.written,
    scan,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  promoteAll,
  scanForPromotions,
  writePendingPromotions,
  loadPendingPromotions,
  applyPendingPromotions,
  applyPromotion,
  clearPendingPromotions,
  // Internals exposed for tests
  loadAdversaryRuns,
  groupAdversaryFindings,
  normalizeIssueKey,
  normalizePrincipleId,
  findAdversaryPromotions,
  loadCorrectionPatterns,
  findPatternPhrasePromotions,
  getPromotionConfig,
  PROMOTION_DEFAULTS,
};

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const cmd = process.argv[2];
  (async () => {
    if (cmd === 'scan' || cmd === undefined) {
      const r = await promoteAll();
      console.log(JSON.stringify({
        proposed: r.proposed,
        adversary: r.scan.adversary.length,
        patternPhrase: r.scan.patternPhrase.length,
      }, null, 2));
      if (r.proposed > 0) {
        console.log(`\n${r.proposed} promotion(s) ready. Run \`flow promote apply\` to write to feedback-patterns.md.`);
      } else {
        console.log('No promotions ready.');
      }
    } else if (cmd === 'apply') {
      const r = await applyPendingPromotions();
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'status') {
      const pending = loadPendingPromotions();
      console.log(pending ? JSON.stringify(pending, null, 2) : 'No pending promotions.');
    } else {
      console.log('Usage: node scripts/flow-promote.js [scan|apply|status]');
      process.exit(1);
    }
  })().catch((err) => {
    console.error(`[promote] error: ${err.message}`);
    process.exit(1);
  });
}
