#!/usr/bin/env node

/**
 * Wogi Flow — Story Creation Quality Gates (wf-63c0f4cc)
 *
 * Five P0 specification-quality gates enforced at story-creation time:
 *
 *   1. longInputGate         — large input → /wogi-extract-review
 *   2. itemReconciliation    — 3+ items must all map to criteria/sub-tasks
 *   3. consumerImpactAnalysis — refactoring keywords → grep consumers
 *   4. scopeConfidenceAudit  — verify assumptions about what exists
 *   5. intentBootstrapCoord  — schedule IGR bootstrap if missing, no duplicate prompt
 *
 * All gates fail-open: any internal error logs a warning and continues.
 * Gates enforce SPEC quality, not EXECUTION quality — those remain
 * /wogi-start's job.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { getConfig, PATHS, safeJsonParse } = require('./flow-utils');

// Refactoring keywords — case-insensitive, word-boundary. Word boundaries
// prevent "transfer" from matching "trans" and "research" from matching "re".
const REFACTOR_KEYWORDS = [
  'refactor', 'rename', 'restructure', 'migrate', 'replace',
  'consolidate', 'split', 'extract', 'move'
];

const REFACTOR_RE = new RegExp(`\\b(${REFACTOR_KEYWORDS.join('|')})\\b`, 'i');

// ============================================================
// Gate 1: Long Input Detection
// ============================================================

/**
 * Count discrete items in free-form text:
 *   - numbered list items  (^\d+[.)])
 *   - bullet list items    (^[-*•])
 *   - semicolon-separated requests (; in single line)
 *   - " and also " / " plus " as item separators
 *
 * @param {string} text
 * @returns {number}
 */
function countDiscreteItems(text) {
  if (!text || typeof text !== 'string') return 0;
  let count = 0;

  // Numbered list items (^1., ^2), etc.)
  const numberedMatches = text.match(/^\s*\d+[.)]\s+\S/gm);
  if (numberedMatches) count += numberedMatches.length;

  // Bullet list items
  const bulletMatches = text.match(/^\s*[-*•]\s+\S/gm);
  if (bulletMatches) count += bulletMatches.length;

  // Semicolon separators — count items = semicolons + 1 when text is a
  // single-line (or nearly so) run of 2+ semicolons. Heuristic keeps us from
  // treating a multi-sentence paragraph as "many items".
  const lines = text.split(/\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 3) {
    const semiCount = (text.match(/;/g) || []).length;
    if (semiCount >= 2) count += semiCount + 1;
  }

  // " and also ", " plus " connectors
  const andAlsoMatches = text.match(/\b(and also|plus)\b/gi);
  if (andAlsoMatches) count += andAlsoMatches.length;

  return count;
}

/**
 * Gate 1: check whether input should route to /wogi-extract-review.
 *
 * @param {string} input
 * @param {Object} [opts] - { bypassLongInput, lineThreshold, itemThreshold }
 * @returns {{route: boolean, reason?: string, lineCount?: number, itemCount?: number}}
 */
function checkLongInput(input, opts = {}) {
  if (opts.bypassLongInput) return { route: false, reason: 'bypass' };

  try {
    const config = getConfig();
    const lineThreshold = Number.isFinite(opts.lineThreshold)
      ? opts.lineThreshold
      : (config.longInputGate?.lineThreshold || 40);
    const itemThreshold = Number.isFinite(opts.itemThreshold)
      ? opts.itemThreshold
      : 5;
    const enabled = config.longInputGate?.enabled !== false;
    if (!enabled) return { route: false, reason: 'disabled' };

    const text = String(input || '');
    const lineCount = text.split(/\n/).length;
    const itemCount = countDiscreteItems(text);

    if (lineCount >= lineThreshold) {
      return { route: true, reason: 'line-count', lineCount, itemCount };
    }
    if (itemCount >= itemThreshold) {
      return { route: true, reason: 'item-count', lineCount, itemCount };
    }
    return { route: false, lineCount, itemCount };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[story-gates] longInputGate failed (fail-open): ${err.message}`);
    }
    return { route: false, reason: 'error' };
  }
}

// ============================================================
// Gate 2: Item Reconciliation
// ============================================================

/**
 * Enumerate items from multi-item input. Returns a numbered list.
 * Strategy: pick whichever of {numbered, bullets, lines, semi-separated}
 * produces the most items.
 *
 * @param {string} input
 * @returns {Array<string>}
 */
function enumerateItems(input) {
  const text = String(input || '');
  const candidates = [];

  // Numbered items (keep content after the number marker)
  const numbered = [];
  for (const m of text.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)) {
    numbered.push(m[1].trim());
  }
  if (numbered.length > 0) candidates.push(numbered);

  // Bullet items
  const bullets = [];
  for (const m of text.matchAll(/^\s*[-*•]\s+(.+)$/gm)) {
    bullets.push(m[1].trim());
  }
  if (bullets.length > 0) candidates.push(bullets);

  // Semicolon-separated (single-line)
  if (/;/.test(text) && text.split(/\n/).filter(l => l.trim()).length <= 3) {
    const parts = text.split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push(parts);
  }

  // " and also " / " plus "
  if (/\b(and also|plus)\b/i.test(text)) {
    const parts = text.split(/\b(?:and also|plus)\b/i).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push(parts);
  }

  if (candidates.length === 0) return [];
  return candidates.reduce((max, c) => (c.length > max.length ? c : max), []);
}

/**
 * Gate 2: build reconciliation manifest. Runs BEFORE decomposition so
 * enumerated items can drive sub-task generation.
 *
 * @param {string} input
 * @param {Object} [opts]
 * @returns {{active: boolean, items: Array<string>, count: number}}
 */
function reconcileItems(input, opts = {}) {
  try {
    const config = getConfig();
    const enabled = config.storyFlow?.itemReconciliation?.enabled !== false;
    const minItems = opts.minItems ?? config.storyFlow?.itemReconciliation?.minItems ?? 3;
    if (!enabled) return { active: false, items: [], count: 0 };

    const items = enumerateItems(input);
    if (items.length < minItems) {
      return { active: false, items, count: items.length };
    }
    return { active: true, items, count: items.length };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[story-gates] itemReconciliation failed (fail-open): ${err.message}`);
    }
    return { active: false, items: [], count: 0 };
  }
}

/**
 * Verify each enumerated item appears in at least one criterion/sub-task.
 * Matching: a criterion is considered to "cover" an item if it shares
 * >= MIN_OVERLAP distinct keyword tokens (length >= 4) with the item.
 *
 * @param {Array<string>} items
 * @param {Array<string>} criteria — criterion texts + sub-task objectives
 * @returns {{allMapped: boolean, unmapped: Array<string>}}
 */
function verifyItemCoverage(items, criteria) {
  const STOPWORDS = new Set([
    'with', 'from', 'that', 'this', 'have', 'make', 'been', 'were', 'their',
    'they', 'them', 'will', 'should', 'would', 'could', 'there', 'into',
    'when', 'then', 'than', 'which', 'what', 'your', 'mine', 'ours'
  ]);
  const MIN_OVERLAP = 1;
  const tokenize = (s) => new Set(
    String(s).toLowerCase().match(/\b[a-z]{4,}\b/g)?.filter(w => !STOPWORDS.has(w)) || []
  );

  const criterionTokens = criteria.map(tokenize);
  const unmapped = [];
  for (const item of items) {
    const itemTokens = tokenize(item);
    if (itemTokens.size === 0) continue; // Skip items with no indexable tokens
    const covered = criterionTokens.some(ct => {
      let overlap = 0;
      for (const t of itemTokens) {
        if (ct.has(t) && ++overlap >= MIN_OVERLAP) return true;
      }
      return false;
    });
    if (!covered) unmapped.push(item);
  }
  return { allMapped: unmapped.length === 0, unmapped };
}

// ============================================================
// Gate 3: Consumer Impact Analysis
// ============================================================

/**
 * Extract likely module / path tokens from input for consumer-grep seeds.
 * Heuristic: filenames (foo.js, bar.ts), quoted strings, CamelCase words,
 * kebab-case identifiers.
 *
 * @param {string} input
 * @returns {Array<string>}
 */
function extractConsumerSeeds(input) {
  const text = String(input || '');
  const seeds = new Set();

  // Filenames with extension
  for (const m of text.matchAll(/\b([a-z0-9][\w-]*\.(?:js|ts|tsx|jsx|mjs|cjs|json|md))\b/gi)) {
    seeds.add(m[1]);
  }
  // Quoted strings (single line, non-empty, reasonable length)
  for (const m of text.matchAll(/['"`]([^'"`\n]{3,60})['"`]/g)) {
    const v = m[1].trim();
    // Skip natural-language-ish quoted strings
    if (/^[A-Za-z][\w./-]*$/.test(v)) seeds.add(v);
  }
  // kebab-case or snake_case or CamelCase identifiers with length >= 6
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*[-_][a-z0-9][\w-]{2,}|[A-Z][a-z]+[A-Z][A-Za-z]{3,})\b/g)) {
    seeds.add(m[1]);
  }
  return [...seeds];
}

/**
 * Gate 3: run Consumer Impact Analysis when refactoring keywords are present.
 * Uses git grep (fast, respects .gitignore). Fail-open if git is unavailable.
 *
 * @param {string} input
 * @param {Object} [opts]
 * @param {string} [opts.cwd]
 * @returns {{active: boolean, seeds?: Array, matches?: Array, breakingCount?: number, phasedMigrationRecommended?: boolean, reason?: string}}
 */
function analyzeConsumerImpact(input, opts = {}) {
  try {
    const config = getConfig();
    const enabled = config.storyFlow?.consumerImpactAnalysis?.enabled !== false;
    const breakingThreshold = opts.breakingThreshold
      ?? config.storyFlow?.consumerImpactAnalysis?.breakingThreshold
      ?? 5;
    if (!enabled) return { active: false, reason: 'disabled' };

    const text = String(input || '');
    if (!REFACTOR_RE.test(text)) {
      return { active: false, reason: 'no-refactor-keyword' };
    }

    const seeds = extractConsumerSeeds(text);
    if (seeds.length === 0) {
      return { active: true, seeds: [], matches: [], breakingCount: 0, reason: 'no-seeds' };
    }

    const cwd = opts.cwd || PATHS.root;
    const matches = [];
    for (const seed of seeds.slice(0, 10)) { // cap to 10 seeds
      try {
        // git grep -l: files containing seed; -i: case-insensitive; --fixed-strings for literal
        const safeSeed = seed.replace(/\x00/g, '');
        if (!safeSeed) continue;
        const out = execSync('git grep -l --fixed-strings -i -- ' + JSON.stringify(safeSeed), {
          cwd,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const files = out.split('\n').map(s => s.trim()).filter(Boolean);
        for (const file of files) {
          matches.push({ seed, file, kind: classifyConsumerKind(file) });
        }
      } catch (_err) {
        // No matches (exit 1) or git not available — skip
      }
    }

    // Classify as BREAKING if the match file looks like a consumer (imports /
    // requires pattern possible). Heuristic: any .js/.ts file that is not the
    // seed itself. Without deeper analysis we treat all non-doc/non-test
    // matches as BREAKING candidates.
    const breaking = matches.filter(m => m.kind === 'code');
    const breakingCount = new Set(breaking.map(m => m.file)).size;

    return {
      active: true,
      seeds,
      matches,
      breakingCount,
      phasedMigrationRecommended: breakingCount >= breakingThreshold
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[story-gates] consumerImpactAnalysis failed (fail-open): ${err.message}`);
    }
    return { active: false, reason: 'error' };
  }
}

function classifyConsumerKind(file) {
  if (/\.(md|txt)$/i.test(file)) return 'doc';
  if (/(^|\/)tests?\//i.test(file) || /\.(test|spec)\.(js|ts|tsx|jsx)$/i.test(file)) return 'test';
  if (/\.(json|ya?ml|toml)$/i.test(file)) return 'config';
  return 'code';
}

// ============================================================
// Gate 4: Scope-Confidence Audit
// ============================================================

// Assumption patterns: capture the noun phrase being claimed.
const ASSUMPTION_PATTERNS = [
  { label: 'new', re: /\bnew\s+([a-z][\w-]{2,}(?:\s+[a-z][\w-]{2,}){0,2})\b/gi },
  { label: 'existing', re: /\bexisting\s+([a-z][\w-]{2,}(?:\s+[a-z][\w-]{2,}){0,2})\b/gi },
  { label: 'the-service', re: /\bthe\s+([A-Z][A-Za-z]{2,})\s+(?:service|table|endpoint|component|module|hook)\b/g }
];

/**
 * Extract assumptions from input.
 *
 * @param {string} input
 * @returns {Array<{label: string, phrase: string}>}
 */
function extractAssumptions(input) {
  const text = String(input || '');
  const out = [];
  for (const { label, re } of ASSUMPTION_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const phrase = (m[1] || '').trim();
      if (phrase && phrase.length >= 3) out.push({ label, phrase });
    }
  }
  // De-dupe by phrase
  const seen = new Set();
  return out.filter(a => {
    const k = `${a.label}::${a.phrase.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Gate 4: audit assumptions against the codebase.
 *
 * @param {string} input
 * @param {Object} [opts]
 * @returns {{active: boolean, assumptions: Array, reason?: string}}
 */
function auditScopeConfidence(input, opts = {}) {
  try {
    const config = getConfig();
    const enabled = config.storyFlow?.scopeConfidenceAudit?.enabled !== false;
    if (!enabled) return { active: false, assumptions: [], reason: 'disabled' };

    const raw = extractAssumptions(input);
    if (raw.length === 0) return { active: false, assumptions: [], reason: 'no-assumptions' };

    const cwd = opts.cwd || PATHS.root;
    const assumptions = raw.map(a => {
      let status = 'UNVERIFIED';
      try {
        const safe = a.phrase.replace(/\x00/g, '');
        const out = execSync('git grep -l --fixed-strings -i -- ' + JSON.stringify(safe), {
          cwd, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (out.length > 0) {
          // Exists in codebase.
          //   label=existing → VERIFIED (matches assumption)
          //   label=new      → CONTRADICTED (user said new, but it exists)
          //   label=the-X    → VERIFIED
          status = a.label === 'new' ? 'CONTRADICTED' : 'VERIFIED';
        } else {
          //   label=existing → CONTRADICTED (said existing but not found)
          //   label=new      → VERIFIED (truly new)
          //   label=the-X    → UNVERIFIED
          if (a.label === 'existing') status = 'CONTRADICTED';
          else if (a.label === 'new') status = 'VERIFIED';
          else status = 'UNVERIFIED';
        }
      } catch (_err) {
        // git grep exit 1 = no match
        if (a.label === 'new') status = 'VERIFIED';
        else if (a.label === 'existing') status = 'CONTRADICTED';
        else status = 'UNVERIFIED';
      }
      return { ...a, status };
    });

    return { active: true, assumptions };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[story-gates] scopeConfidenceAudit failed (fail-open): ${err.message}`);
    }
    return { active: false, assumptions: [], reason: 'error' };
  }
}

// ============================================================
// Gate 5: Intent Bootstrap Coordination
// ============================================================

/**
 * Gate 5: schedule IGR bootstrap if artifacts missing + not already scheduled.
 * Writes a per-session coordination flag to session-state.json so /wogi-start
 * does not re-prompt.
 *
 * @param {Object} [opts] - { sessionStatePath }
 * @returns {{active: boolean, scheduled?: boolean, reason?: string}}
 */
function coordinateIntentBootstrap(opts = {}) {
  try {
    const config = getConfig();
    const igrEnabled = config.intentGroundedReasoning?.enabled;
    if (!igrEnabled) return { active: false, reason: 'igr-disabled' };

    const stateDir = PATHS.state;
    const artifacts = ['product.md', 'domain-model.md', 'user-journeys.md', 'glossary.md'];
    const allExist = artifacts.every(f => fs.existsSync(path.join(stateDir, f)));
    if (allExist) return { active: true, scheduled: false, reason: 'artifacts-exist' };

    const sessionPath = opts.sessionStatePath || path.join(stateDir, 'session-state.json');
    const session = safeJsonParse(sessionPath, {}) || {};

    if (session.intentBootstrapScheduledAt) {
      return { active: true, scheduled: false, reason: 'already-scheduled' };
    }

    // Write the coordination flag. The actual bootstrap run is fire-and-forget
    // and delegated to /wogi-session-end (Option C [2]). The flag tells
    // /wogi-start to skip its own prompt.
    session.intentBootstrapScheduledAt = new Date().toISOString();
    session.intentBootstrapScheduledBy = '/wogi-story';
    try {
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[story-gates] session-state write failed: ${err.message}`);
      }
      return { active: true, scheduled: false, reason: 'write-error' };
    }

    return { active: true, scheduled: true };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[story-gates] intentBootstrapCoord failed (fail-open): ${err.message}`);
    }
    return { active: false, reason: 'error' };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Gates
  checkLongInput,
  reconcileItems,
  analyzeConsumerImpact,
  auditScopeConfidence,
  coordinateIntentBootstrap,

  // Helpers (exposed for tests)
  countDiscreteItems,
  enumerateItems,
  verifyItemCoverage,
  extractConsumerSeeds,
  extractAssumptions,
  classifyConsumerKind,
  REFACTOR_KEYWORDS
};
