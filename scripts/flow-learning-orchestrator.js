'use strict';

/**
 * Learning Orchestrator Facade
 *
 * Coordinates all learning pipeline modules with a unified API.
 * Existing direct imports continue working — this facade is additive.
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

  try { stats.tiered = getTieredLearning().getLearningStats(); } catch (err) { stats.tiered = null; }
  try { stats.failure = getFailureLearning().getLearningStats(); } catch (err) { stats.failure = null; }
  try { stats.loop = getLoopRetryLearning().getLearningStats(); } catch (err) { stats.loop = null; }
  try { stats.auto = getAutoLearn().showStatus(); } catch (err) { stats.auto = null; }

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
  } catch (err) {
    patterns.decisions = [];
  }

  try {
    patterns.skills = getPatternEnforcer().loadSkillPatterns(context.skills || []);
  } catch (err) {
    patterns.skills = [];
  }

  try {
    patterns.tiered = getTieredLearning().getPatternsByTier(context.tier || 'all');
  } catch (err) {
    patterns.tiered = [];
  }

  return patterns;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Unified API
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
