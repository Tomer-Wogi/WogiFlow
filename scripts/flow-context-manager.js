/**
 * Context Manager Facade
 *
 * Coordinates context gathering, scoring, estimation, and monitoring.
 * Existing direct imports continue working — this facade is additive.
 *
 * Sub-modules (lazy-loaded to avoid startup cost):
 *   - flow-auto-context.js          — Keyword extraction, smart/legacy context loading
 *   - flow-context-generator.js     — Project context generation with caching
 *   - flow-context-scoring.js       — Relevance scoring and budget fitting
 *   - flow-context-estimator.js     — Pre-task context estimation and compaction decisions
 *   - flow-context-monitor.js       — Token estimation, health checks, usage warnings
 *   - flow-context-orchestrator.js  — Targeted context retrieval for task IDs
 *   - flow-context-compact/         — Session save, compaction, summary trees
 */

// ============================================================
// Lazy Loaders
// ============================================================

function getAutoContext() { return require('./flow-auto-context'); }
function getContextGenerator() { return require('./flow-context-generator'); }
function getContextScoring() { return require('./flow-context-scoring'); }
function getContextEstimator() { return require('./flow-context-estimator'); }
function getContextMonitor() { return require('./flow-context-monitor'); }
function getContextOrchestrator() { return require('./flow-context-orchestrator'); }
function getContextCompact() { return require('./flow-context-compact'); }

// ============================================================
// Unified API
// ============================================================

/**
 * Gather context for a task. Combines auto-context keyword search
 * with orchestrator's targeted task-ID retrieval.
 *
 * @param {string} taskId - Task identifier (wf-XXXXXXXX)
 * @param {Object} options - Options
 * @param {string} [options.title] - Task title for keyword extraction
 * @param {string} [options.mode] - 'smart' (default) or 'legacy'
 * @returns {Promise<Object>} Gathered context
 */
async function gatherContext(taskId, options = {}) {
  const orchestrator = getContextOrchestrator();

  // If we have a task ID, use targeted context
  if (taskId) {
    try {
      return await orchestrator.getContextForTaskId(taskId);
    } catch (_err) {
      // Fall through to auto-context
    }
  }

  // Fall back to auto-context with keyword extraction
  const autoCtx = getAutoContext();
  if (options.mode === 'legacy') {
    return autoCtx.getLegacyContext(options.title || '');
  }
  return autoCtx.getSmartContext(options.title || '');
}

/**
 * Estimate context usage for an upcoming task.
 * Delegates to flow-context-estimator.
 *
 * @param {Object} task - Task data (id, acceptanceCriteria, files, etc.)
 * @returns {Object} Estimation result with shouldCompact flag
 */
function estimateUsage(task = {}) {
  const estimator = getContextEstimator();
  return estimator.estimateTaskContextNeeds(task);
}

/**
 * Check whether compaction is needed before starting a task.
 *
 * @param {Object} task - Task data
 * @returns {Object} Compaction recommendation
 */
function shouldCompact(task) {
  const estimator = getContextEstimator();
  if (task) {
    return estimator.shouldCompactBeforeTask(task);
  }
  return estimator.shouldCompactForNonTaskWork();
}

/**
 * Score context items by relevance and fit them into a token budget.
 *
 * @param {Array} items - Context items to score
 * @param {Object} options - Scoring options (budget, task, etc.)
 * @returns {Object} Scored and budget-fitted context
 */
function scoreContext(items, options = {}) {
  const scoring = getContextScoring();
  const scored = items.map(item => ({
    ...item,
    relevance: scoring.scoreRelevance(item, options.task || {})
  }));
  return scoring.fitToBudget(scored, options.budget);
}

/**
 * Check context health — token usage, pressure, warnings.
 *
 * @returns {Object} Health status
 */
function checkHealth() {
  const monitor = getContextMonitor();
  return monitor.checkContextHealth();
}

/**
 * Get current context size breakdown.
 *
 * @returns {Object} Context breakdown by category
 */
function getBreakdown() {
  const monitor = getContextMonitor();
  return monitor.getContextBreakdown();
}

/**
 * Run context compaction.
 *
 * @param {Object} options - Compaction options
 * @returns {Promise<Object>} Compaction result
 */
async function compact(options = {}) {
  const compactModule = getContextCompact();
  return compactModule.compact(options);
}

/**
 * Save session context for later resumption.
 *
 * @param {Object} sessionData - Session data to save
 * @returns {Object} Save result
 */
function saveSession(sessionData) {
  const compactModule = getContextCompact();
  return compactModule.saveSession(sessionData);
}

/**
 * Generate full project context (used during onboarding/init).
 *
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated context
 */
async function generateProjectContext(options = {}) {
  const generator = getContextGenerator();
  return generator.generateProjectContext(options);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Unified API
  gatherContext,
  estimateUsage,
  shouldCompact,
  scoreContext,
  checkHealth,
  getBreakdown,
  compact,
  saveSession,
  generateProjectContext,

  // Direct sub-module access (lazy-loaded getters)
  get autoContext() { return getAutoContext(); },
  get contextGenerator() { return getContextGenerator(); },
  get contextScoring() { return getContextScoring(); },
  get contextEstimator() { return getContextEstimator(); },
  get contextMonitor() { return getContextMonitor(); },
  get contextOrchestrator() { return getContextOrchestrator(); },
  get contextCompact() { return getContextCompact(); }
};
