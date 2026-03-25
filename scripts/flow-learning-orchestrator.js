/**
 * Learning Orchestrator — Centralized Write Mediator
 *
 * ALL writes to feedback-patterns.md and decisions.md MUST go through this module.
 * Direct fs.writeFileSync to these files from learning modules is prohibited.
 *
 * Features:
 *   - Centralized write API with dedup checking
 *   - Write locking via acquireLock to prevent race conditions
 *   - Fuzzy dedup: rejects writes that duplicate existing entries
 *
 * Sub-modules (lazy-loaded to avoid startup cost):
 *   - flow-skill-learn.js          — Skill discovery and learning
 *   - flow-session-learning.js     — Session-level pattern detection
 *   - flow-adaptive-learning.js    — Failure analysis and adaptive retry
 *   - flow-pattern-extractor.js    — Codebase pattern extraction
 *   - flow-pattern-enforcer.js     — Decision/pattern enforcement
 *   - flow-instruction-richness.js — Model-aware instruction tuning
 *   - flow-loop-retry-learning.js  — Loop retry root cause analysis
 *   - flow-tiered-learning.js      — Multi-tier pattern classification
 *   - flow-failure-learning.js     — Failure-specific learning capture
 *   - flow-auto-learn.js           — Automatic pattern capture from reviews/bugfixes
 *   - flow-standards-learner.js    — Standards violation learning
 */

const fs = require('node:fs');
const { PATHS } = require('./flow-paths');
const { acquireLock, readFile, writeFile, fileExists } = require('./flow-io');

// ============================================================
// Constants
// ============================================================

const DEDUP_SIMILARITY_THRESHOLD = 0.85; // 85% similarity = duplicate

// ============================================================
// Lazy Loaders
// ============================================================

function getSkillLearning() { return require('./flow-skill-learn'); }
function getSessionLearning() { return require('./flow-session-learning'); }
function getAdaptiveLearning() { return require('./flow-adaptive-learning'); }
function getPatternExtractor() { return require('./flow-pattern-extractor'); }
function getPatternEnforcer() { return require('./flow-pattern-enforcer'); }
function getInstructionRichness() { return require('./flow-instruction-richness'); }
function getLoopRetryLearning() { return require('./flow-loop-retry-learning'); }
function getTieredLearning() { return require('./flow-tiered-learning'); }
function getFailureLearning() { return require('./flow-failure-learning'); }
function getAutoLearn() { return require('./flow-auto-learn'); }
function getStandardsLearner() { return require('./flow-standards-learner'); }

// ============================================================
// Dedup Utilities
// ============================================================

/**
 * Normalize text for dedup comparison: lowercase, strip punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeForDedup(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute bigram similarity between two strings (Dice coefficient).
 * Returns 0..1 where 1 = identical.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function bigramSimilarity(a, b) {
  const na = normalizeForDedup(a);
  const nb = normalizeForDedup(b);

  if (na === nb) return 1.0;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigramsA = new Set();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  const bigramsB = new Set();
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Check if an entry already exists in file content (fuzzy match).
 * Checks both exact substring and bigram similarity against existing entries.
 *
 * @param {string} content - Current file content
 * @param {string} entryText - The new entry text to check
 * @returns {{ isDuplicate: boolean, matchedText?: string, similarity?: number }}
 */
function checkDuplicate(content, entryText) {
  if (!content || !entryText) return { isDuplicate: false };

  const normalizedEntry = normalizeForDedup(entryText);
  if (!normalizedEntry || normalizedEntry.length < 5) return { isDuplicate: false };

  // Exact substring check (case-insensitive)
  if (content.toLowerCase().includes(normalizedEntry)) {
    return { isDuplicate: true, matchedText: entryText, similarity: 1.0 };
  }

  // Extract existing entries from tables (pipe-delimited rows) and headings
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header rows and separators
    if (!trimmed || trimmed.startsWith('|---') || trimmed.startsWith('| Date')) continue;

    // Table row: extract content cells
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      // Check cells 1 and 2 (pattern/correction columns)
      for (let i = 1; i < Math.min(cells.length, 3); i++) {
        const sim = bigramSimilarity(cells[i], entryText);
        if (sim >= DEDUP_SIMILARITY_THRESHOLD) {
          return { isDuplicate: true, matchedText: cells[i], similarity: sim };
        }
      }
    }

    // Heading: ### Pattern Name
    if (trimmed.startsWith('###')) {
      const heading = trimmed.replace(/^###\s*/, '').replace(/\s*\([\d-]+\)$/, '');
      const sim = bigramSimilarity(heading, entryText);
      if (sim >= DEDUP_SIMILARITY_THRESHOLD) {
        return { isDuplicate: true, matchedText: heading, similarity: sim };
      }
    }
  }

  return { isDuplicate: false };
}

// ============================================================
// Centralized Write API
// ============================================================

/**
 * Write to feedback-patterns.md through the orchestrator.
 * Acquires a lock, checks for duplicates, then applies the write.
 *
 * @param {Object} params
 * @param {string} params.content - Full new content to write (replaces file)
 * @param {string} [params.entryText] - Key text of the new entry (for dedup)
 * @param {string} params.caller - Calling module name (for logging)
 * @param {boolean} [params.skipDedup=false] - Skip dedup check (for bulk rewrites)
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
async function writeToFeedbackPatterns({ content, entryText, caller, skipDedup = false }) {
  const filePath = PATHS.feedbackPatterns;

  const release = await acquireLock(filePath, { retries: 5, retryDelay: 100 });
  try {
    // Dedup check
    if (!skipDedup && entryText) {
      const currentContent = fileExists(filePath) ? readFile(filePath, '') : '';
      const dupCheck = checkDuplicate(currentContent, entryText);
      if (dupCheck.isDuplicate) {
        if (process.env.DEBUG) {
          console.log(`[orchestrator] Dedup rejected write from ${caller}: "${entryText}" matches "${dupCheck.matchedText}" (${(dupCheck.similarity * 100).toFixed(0)}%)`);
        }
        return { success: false, reason: 'duplicate', matchedText: dupCheck.matchedText, similarity: dupCheck.similarity };
      }
    }

    writeFile(filePath, content);
    if (process.env.DEBUG) {
      console.log(`[orchestrator] ${caller} wrote to feedback-patterns.md`);
    }
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    release();
  }
}

/**
 * Write to decisions.md through the orchestrator.
 * Acquires a lock, checks for duplicates, then applies the write.
 *
 * @param {Object} params
 * @param {string} params.content - Full new content to write (replaces file)
 * @param {string} [params.entryText] - Key text of the new entry (for dedup)
 * @param {string} params.caller - Calling module name (for logging)
 * @param {boolean} [params.skipDedup=false] - Skip dedup check (for bulk rewrites)
 * @param {boolean} [params.syncRules=false] - Trigger rules sync after write
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
async function writeToDecisions({ content, entryText, caller, skipDedup = false, syncRules = false }) {
  const filePath = PATHS.decisions;

  const release = await acquireLock(filePath, { retries: 5, retryDelay: 100 });
  try {
    // Dedup check
    if (!skipDedup && entryText) {
      const currentContent = fileExists(filePath) ? readFile(filePath, '') : '';
      const dupCheck = checkDuplicate(currentContent, entryText);
      if (dupCheck.isDuplicate) {
        if (process.env.DEBUG) {
          console.log(`[orchestrator] Dedup rejected write from ${caller}: "${entryText}" matches "${dupCheck.matchedText}" (${(dupCheck.similarity * 100).toFixed(0)}%)`);
        }
        return { success: false, reason: 'duplicate', matchedText: dupCheck.matchedText, similarity: dupCheck.similarity };
      }
    }

    writeFile(filePath, content);
    if (process.env.DEBUG) {
      console.log(`[orchestrator] ${caller} wrote to decisions.md`);
    }

    // Optionally sync rules after write
    if (syncRules) {
      try {
        require('./flow-rules-sync');
      } catch (_err) {
        // Non-fatal — rules sync is optional
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    release();
  }
}

/**
 * Read-modify-write helper for feedback-patterns.md.
 * Acquires lock, reads current content, calls modifier, writes result.
 *
 * @param {Function} modifier - (currentContent: string) => { content: string, entryText?: string }
 * @param {Object} opts - { caller: string, skipDedup?: boolean }
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
async function modifyFeedbackPatterns(modifier, { caller, skipDedup = false } = {}) {
  const filePath = PATHS.feedbackPatterns;

  const release = await acquireLock(filePath, { retries: 5, retryDelay: 100 });
  try {
    const currentContent = fileExists(filePath) ? readFile(filePath, '') : '';
    const result = modifier(currentContent);

    if (!result || !result.content) {
      return { success: false, reason: 'modifier returned no content' };
    }

    // Dedup check
    if (!skipDedup && result.entryText) {
      const dupCheck = checkDuplicate(currentContent, result.entryText);
      if (dupCheck.isDuplicate) {
        if (process.env.DEBUG) {
          console.log(`[orchestrator] Dedup rejected modify from ${caller}: "${result.entryText}" matches "${dupCheck.matchedText}"`);
        }
        return { success: false, reason: 'duplicate', matchedText: dupCheck.matchedText };
      }
    }

    writeFile(filePath, result.content);
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    release();
  }
}

/**
 * Read-modify-write helper for decisions.md.
 * Acquires lock, reads current content, calls modifier, writes result.
 *
 * @param {Function} modifier - (currentContent: string) => { content: string, entryText?: string }
 * @param {Object} opts - { caller: string, skipDedup?: boolean, syncRules?: boolean }
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
async function modifyDecisions(modifier, { caller, skipDedup = false, syncRules = false } = {}) {
  const filePath = PATHS.decisions;

  const release = await acquireLock(filePath, { retries: 5, retryDelay: 100 });
  try {
    const currentContent = fileExists(filePath) ? readFile(filePath, '') : '';
    const result = modifier(currentContent);

    if (!result || !result.content) {
      return { success: false, reason: 'modifier returned no content' };
    }

    // Dedup check
    if (!skipDedup && result.entryText) {
      const dupCheck = checkDuplicate(currentContent, result.entryText);
      if (dupCheck.isDuplicate) {
        if (process.env.DEBUG) {
          console.log(`[orchestrator] Dedup rejected modify from ${caller}: "${result.entryText}" matches "${dupCheck.matchedText}"`);
        }
        return { success: false, reason: 'duplicate', matchedText: dupCheck.matchedText };
      }
    }

    writeFile(filePath, result.content);

    if (syncRules) {
      try {
        require('./flow-rules-sync');
      } catch (_err) {
        // Non-fatal
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    release();
  }
}

// ============================================================
// Unified API
// ============================================================

/**
 * Unified learning entry point. Delegates to the appropriate
 * sub-module based on learning type.
 *
 * @param {string} type - Learning type:
 *   'skill'     — Skill discovery/learning
 *   'session'   — Session-level pattern analysis
 *   'failure'   — Learn from a failure
 *   'adaptive'  — Adaptive retry with learning
 *   'pattern'   — Extract codebase patterns
 *   'enforce'   — Enforce decision patterns
 *   'standards' — Learn from standards violations
 *   'tiered'    — Record tiered pattern result
 *   'auto'      — Auto-capture from review/bugfix
 *   'loop'      — Loop retry analysis
 * @param {Object} context - Type-specific context data
 * @returns {Promise<Object>} Learning result
 */
async function learn(type, context = {}) {
  switch (type) {
    case 'skill':
      return getSkillLearning().appendLearning(
        context.skillName,
        context.category || 'general',
        context.content,
        context.metadata
      );

    case 'session':
      return getSessionLearning().analyzeSessionLearnings(context);

    case 'failure':
      return getFailureLearning().learnFromFailure(context);

    case 'adaptive':
      return getAdaptiveLearning().adaptiveRetry(context);

    case 'pattern':
      return getPatternExtractor().extractPatterns(context.files || [], context.options);

    case 'enforce':
      return getPatternEnforcer().validateAgainstPatterns(
        context.content,
        context.patterns
      );

    case 'standards':
      return getStandardsLearner().learnFromViolations(context.violations, context.options);

    case 'tiered':
      return getTieredLearning().recordPatternResult(context);

    case 'auto':
      if (context.source === 'review') {
        return getAutoLearn().captureFromSessionReview(context.findings);
      }
      return getAutoLearn().captureFromBugFix(context.bugData);

    case 'loop':
      return getLoopRetryLearning().analyzeCompletedSession(context);

    default:
      return { success: false, error: `Unknown learning type: ${type}` };
  }
}

/**
 * Gather all learning-related statistics across sub-modules.
 *
 * @returns {Object} Aggregated learning stats
 */
function getStats() {
  const stats = {};

  try { stats.tiered = getTieredLearning().getLearningStats(); } catch (_err) { stats.tiered = null; }
  try { stats.failure = getFailureLearning().getLearningStats(); } catch (_err) { stats.failure = null; }
  try { stats.loop = getLoopRetryLearning().getLearningStats(); } catch (_err) { stats.loop = null; }
  try { stats.auto = getAutoLearn().showStatus(); } catch (_err) { stats.auto = null; }

  return stats;
}

/**
 * Load and merge all relevant patterns for a given context.
 * Useful for pre-task pattern loading.
 *
 * @param {Object} context - Task context for pattern relevance
 * @returns {Object} Merged patterns from all sources
 */
function loadRelevantPatterns(context = {}) {
  const patterns = {};

  try {
    patterns.decisions = getPatternEnforcer().loadDecisionPatterns();
  } catch (_err) {
    patterns.decisions = [];
  }

  try {
    patterns.skills = getPatternEnforcer().loadSkillPatterns(context.skills || []);
  } catch (_err) {
    patterns.skills = [];
  }

  try {
    patterns.tiered = getTieredLearning().getPatternsByTier(context.tier || 'all');
  } catch (_err) {
    patterns.tiered = [];
  }

  return patterns;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Centralized write API (MUST be used for all learning file writes)
  writeToFeedbackPatterns,
  writeToDecisions,
  modifyFeedbackPatterns,
  modifyDecisions,

  // Dedup utilities (exposed for testing)
  checkDuplicate,
  bigramSimilarity,
  normalizeForDedup,

  // Unified learning API
  learn,
  getStats,
  loadRelevantPatterns,

  // Direct sub-module access (lazy-loaded getters)
  get skillLearning() { return getSkillLearning(); },
  get sessionLearning() { return getSessionLearning(); },
  get adaptiveLearning() { return getAdaptiveLearning(); },
  get patternExtractor() { return getPatternExtractor(); },
  get patternEnforcer() { return getPatternEnforcer(); },
  get instructionRichness() { return getInstructionRichness(); },
  get loopRetryLearning() { return getLoopRetryLearning(); },
  get tieredLearning() { return getTieredLearning(); },
  get failureLearning() { return getFailureLearning(); },
  get autoLearn() { return getAutoLearn(); },
  get standardsLearner() { return getStandardsLearner(); }
};
