#!/usr/bin/env node

/**
 * Wogi Flow - Context Estimator
 *
 * Estimates how much context a specific task will consume.
 * Used by /wogi-start to decide if compaction is needed before starting.
 *
 * Instead of arbitrary thresholds (50k warn, 80k compact), this estimates
 * the actual context needs for a task and only compacts if:
 *   current_usage + estimated_need > safe_threshold (95%)
 */

const fs = require('fs');
const path = require('path');
const { getConfig, PATHS, safeJsonParse } = require('./flow-utils');

/**
 * Default estimation config (can be overridden in config.json)
 */
const DEFAULT_ESTIMATION_CONFIG = {
  perFile: 0.02,           // 2% per file
  perCriterion: 0.03,      // 3% per acceptance criterion
  perSpecChars: 0.002,     // 0.2% per 100 chars of spec
  refactorBuffer: 0.10,    // +10% for refactor/migration tasks
  defaultSmallTask: 0.10,  // Default 10% for tasks without signals
  defaultMediumTask: 0.25, // Default 25% for medium tasks
  defaultLargeTask: 0.40   // Default 40% for large tasks
};

const DEFAULT_REFACTOR_KEYWORDS = [
  'refactor', 'migration', 'overhaul', 'redesign', 'rewrite',
  'restructure', 'rearchitect', 'modernize', 'upgrade'
];

// Valid task ID pattern — enforces wf-[8 hex] format and prevents path traversal
// Also accepts legacy TASK-NNN/BUG-NNN and sub-tasks wf-XXXXXXXX-NN
const VALID_TASK_ID_PATTERN = /^(wf-[a-f0-9]{8}(-\d{2})?|(TASK|BUG)-\d{3,})$/i;

/**
 * Validate task ID format — must be wf-[8 hex chars] or legacy TASK-NNN/BUG-NNN.
 * Also prevents path traversal attacks.
 * @param {string} taskId - Task ID to validate
 * @returns {boolean} True if valid
 */
function isValidTaskId(taskId) {
  return typeof taskId === 'string' && VALID_TASK_ID_PATTERN.test(taskId);
}

/**
 * Get smart compaction config from config.json
 * @returns {Object} Smart compaction configuration
 */
function getSmartCompactionConfig() {
  const config = getConfig();
  const smartConfig = config.smartCompaction || {};

  let safeThreshold = smartConfig.safeThreshold || 0.95;
  let emergencyThreshold = smartConfig.emergencyThreshold || 0.90;

  // Claude Code 2.1.50+: CLAUDE_CODE_DISABLE_1M_CONTEXT reduces the context window.
  // Lower thresholds to account for the smaller available context.
  const disableExtendedContext = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
  const reducedContext = disableExtendedContext === 'true' || disableExtendedContext === '1';
  if (reducedContext) {
    safeThreshold = Math.min(safeThreshold, 0.85);
    emergencyThreshold = Math.min(emergencyThreshold, 0.80);
    if (process.env.DEBUG) {
      console.log('[context-estimator] CLAUDE_CODE_DISABLE_1M_CONTEXT detected — thresholds reduced (safe: 0.85, emergency: 0.80)');
    }
  }

  return {
    enabled: smartConfig.enabled !== false,
    safeThreshold,
    emergencyThreshold,
    reducedContext,
    estimation: {
      ...DEFAULT_ESTIMATION_CONFIG,
      ...(smartConfig.estimation || {})
    },
    refactorKeywords: smartConfig.refactorKeywords || DEFAULT_REFACTOR_KEYWORDS
  };
}

/**
 * Read spec file content if it exists
 * @param {string} taskId - Task ID
 * @returns {string|null} Spec content or null
 */
function readSpecFile(taskId) {
  // Validate taskId to prevent path traversal (Security Rule)
  if (!isValidTaskId(taskId)) {
    return null;
  }

  const specPath = path.join(PATHS.root, '.workflow', 'specs', `${taskId}.md`);

  // Use try-catch only, no existsSync (prevents TOCTOU race condition)
  try {
    return fs.readFileSync(specPath, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Log unexpected errors in DEBUG mode
      if (process.env.DEBUG) {
        console.error(`[context-estimator] Warning reading spec: ${err.code}`);
      }
    }
    // Fall through to check changes directory
  }

  // Also check changes directory
  const changesDir = path.join(PATHS.root, '.workflow', 'changes');
  try {
    const entries = fs.readdirSync(changesDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip non-directories and symlinks (security measure)
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      const changePath = path.join(changesDir, entry.name, `${taskId}.md`);
      try {
        return fs.readFileSync(changePath, 'utf-8');
      } catch (err) {
        // File doesn't exist in this subdir, continue searching
        if (err.code !== 'ENOENT') {
          if (process.env.DEBUG) {
            console.error(`[context-estimator] Warning reading change: ${err.code}`);
          }
        }
      }
    }
  } catch (err) {
    // Changes directory doesn't exist or can't be read - that's fine
    if (err.code !== 'ENOENT' && process.env.DEBUG) {
      console.error(`[context-estimator] Warning reading changes dir: ${err.code}`);
    }
  }

  return null;
}

/**
 * Extract acceptance criteria count from spec content
 * @param {string} specContent - Spec file content
 * @returns {number} Number of acceptance criteria
 */
function extractCriteriaCount(specContent) {
  if (!specContent) return 0;

  let count = 0;

  // Count Given/When/Then patterns (use [\s\S] to match across newlines)
  const gwtMatches = specContent.match(/\bGiven\b[\s\S]*?\bWhen\b[\s\S]*?\bThen\b/gi);
  if (gwtMatches) {
    count += gwtMatches.length;
  }

  // Count numbered acceptance criteria
  const numberedMatches = specContent.match(/^\s*\d+\.\s+/gm);
  if (numberedMatches) {
    count = Math.max(count, numberedMatches.length);
  }

  // Count checkbox items in acceptance sections
  const checkboxMatches = specContent.match(/^\s*[-*]\s*\[[ x]\]/gmi);
  if (checkboxMatches) {
    count = Math.max(count, checkboxMatches.length);
  }

  return count;
}

/**
 * Extract expected file count from spec content
 * @param {string} specContent - Spec file content
 * @returns {number} Estimated number of files to change
 */
function extractFileCount(specContent) {
  if (!specContent) return 0;

  let files = new Set();

  // Find file paths (common patterns)
  // Note: Removed overly broad pattern that matched any word.extension
  const filePatterns = [
    /[`"]([a-zA-Z0-9_\-/.]+\.(ts|tsx|js|jsx|json|md|css|scss))[`"]/g,
    /(?:src|lib|scripts|components|pages)\/[\w\-/]+\.\w+/g
  ];

  for (const pattern of filePatterns) {
    const matches = specContent.matchAll(pattern);
    for (const match of matches) {
      const file = match[1] || match[0];
      if (file && !file.includes('example') && !file.includes('sample')) {
        files.add(file);
      }
    }
  }

  return files.size;
}

/**
 * Estimate context needs for a specific task
 * @param {Object} task - Task object from ready.json
 * @param {Object} [configOverride] - Optional config override
 * @returns {Object} Estimation result
 */
function estimateTaskContextNeeds(task, configOverride = null) {
  const config = configOverride || getSmartCompactionConfig();
  const est = config.estimation;

  let estimate = 0;
  const factors = {
    criteria: 0,
    files: 0,
    specChars: 0,
    refactorBuffer: false,
    parentMultiplier: 1,
    usedDefault: null
  };

  // Read spec file if available
  const specContent = readSpecFile(task.id);

  // Acceptance criteria from task or spec
  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    factors.criteria = task.acceptanceCriteria.length;
  } else if (specContent) {
    factors.criteria = extractCriteriaCount(specContent);
  }
  estimate += factors.criteria * est.perCriterion;

  // Expected files from task, spec, or heuristic
  if (task.filesToChange && task.filesToChange.length > 0) {
    factors.files = task.filesToChange.length;
  } else if (specContent) {
    factors.files = extractFileCount(specContent);
  }

  // Fallback: estimate files from criteria count
  if (factors.files === 0 && factors.criteria > 0) {
    factors.files = Math.ceil(factors.criteria * 0.5);
  }

  // Default minimum files
  if (factors.files === 0) {
    factors.files = 2;
  }

  estimate += factors.files * est.perFile;

  // Spec file content contribution
  if (specContent) {
    factors.specChars = specContent.length;
    estimate += (specContent.length / 500) * est.perSpecChars;
  }

  // Refactor buffer
  const title = (task.title || '').toLowerCase();
  const description = (task.description || '').toLowerCase();
  const combinedText = `${title} ${description}`;

  if (config.refactorKeywords.some(kw => combinedText.includes(kw))) {
    factors.refactorBuffer = true;
    estimate += est.refactorBuffer;
  }

  // Parent task: scale by subtask count
  if (task.type === 'parent' && task.subTasks && task.subTasks.length > 0) {
    factors.parentMultiplier = 1 + (task.subTasks.length * 0.3);
    estimate *= factors.parentMultiplier;
  }

  // Fallback to defaults if no signals
  if (estimate < 0.05) {
    // Determine task size from type or other signals
    if (task.type === 'epic' || (task.subTasks && task.subTasks.length > 5)) {
      estimate = est.defaultLargeTask;
      factors.usedDefault = 'large';
    } else if (task.type === 'story' || factors.criteria >= 3) {
      estimate = est.defaultMediumTask;
      factors.usedDefault = 'medium';
    } else {
      estimate = est.defaultSmallTask;
      factors.usedDefault = 'small';
    }
  }

  // Cap at 80% - no single task should need more
  estimate = Math.min(estimate, 0.80);

  return {
    estimate,
    estimatePercent: Math.round(estimate * 100),
    factors,
    taskId: task.id,
    taskTitle: task.title
  };
}

/**
 * Check emergency threshold - shared logic for task and non-task work
 * @param {number} currentContextPercent - Current context usage (0-1)
 * @param {Object} config - Smart compaction config
 * @returns {Object|null} Emergency result if triggered, null otherwise
 */
function checkEmergencyThreshold(currentContextPercent, config) {
  if (currentContextPercent >= config.emergencyThreshold) {
    return {
      shouldCompact: true,
      reason: `Emergency threshold reached (${Math.round(currentContextPercent * 100)}% >= ${Math.round(config.emergencyThreshold * 100)}%)`,
      current: currentContextPercent,
      currentPercent: Math.round(currentContextPercent * 100),
      estimated: null,
      estimatedPercent: null,
      projected: null,
      projectedPercent: null,
      threshold: config.emergencyThreshold,
      thresholdPercent: Math.round(config.emergencyThreshold * 100),
      emergency: true,
      config
    };
  }
  return null;
}

/**
 * Check if compaction is needed before starting a task
 * @param {Object} task - Task object
 * @param {number} currentContextPercent - Current context usage (0-1)
 * @returns {Object} Decision result
 */
function shouldCompactBeforeTask(task, currentContextPercent) {
  const config = getSmartCompactionConfig();

  if (!config.enabled) {
    return {
      shouldCompact: false,
      reason: 'Smart compaction disabled',
      config
    };
  }

  // Check emergency threshold first (extracted for DRY)
  const emergencyResult = checkEmergencyThreshold(currentContextPercent, config);
  if (emergencyResult) {
    return emergencyResult;
  }

  // Estimate task needs
  const estimation = estimateTaskContextNeeds(task, config);
  const projected = currentContextPercent + estimation.estimate;

  const shouldCompact = projected > config.safeThreshold;

  return {
    shouldCompact,
    reason: shouldCompact
      ? `Projected ${Math.round(projected * 100)}% exceeds safe threshold ${Math.round(config.safeThreshold * 100)}%`
      : `Projected ${Math.round(projected * 100)}% within safe threshold ${Math.round(config.safeThreshold * 100)}%`,
    current: currentContextPercent,
    currentPercent: Math.round(currentContextPercent * 100),
    estimated: estimation.estimate,
    estimatedPercent: estimation.estimatePercent,
    projected,
    projectedPercent: Math.round(projected * 100),
    threshold: config.safeThreshold,
    thresholdPercent: Math.round(config.safeThreshold * 100),
    emergency: false,
    factors: estimation.factors,
    config
  };
}

/**
 * Check if compaction is needed for non-task work
 * Uses the default small task estimate
 * @param {number} currentContextPercent - Current context usage (0-1)
 * @returns {Object} Decision result
 */
function shouldCompactForNonTaskWork(currentContextPercent) {
  const config = getSmartCompactionConfig();

  if (!config.enabled) {
    return {
      shouldCompact: false,
      reason: 'Smart compaction disabled',
      config
    };
  }

  // Check emergency threshold first (extracted for DRY)
  const emergencyResult = checkEmergencyThreshold(currentContextPercent, config);
  if (emergencyResult) {
    return emergencyResult;
  }

  // Use default small task estimate for non-task work
  const estimate = config.estimation.defaultSmallTask;
  const projected = currentContextPercent + estimate;

  const shouldCompact = projected > config.safeThreshold;

  return {
    shouldCompact,
    reason: shouldCompact
      ? `Non-task work: projected ${Math.round(projected * 100)}% exceeds safe threshold`
      : `Non-task work: projected ${Math.round(projected * 100)}% within safe threshold`,
    current: currentContextPercent,
    currentPercent: Math.round(currentContextPercent * 100),
    estimated: estimate,
    estimatedPercent: Math.round(estimate * 100),
    projected,
    projectedPercent: Math.round(projected * 100),
    threshold: config.safeThreshold,
    thresholdPercent: Math.round(config.safeThreshold * 100),
    emergency: false,
    isNonTask: true,
    config
  };
}

/**
 * Format estimation result for display
 * @param {Object} result - Result from shouldCompactBeforeTask
 * @returns {string} Formatted string
 */
function formatEstimationResult(result) {
  const lines = [];

  if (result.emergency) {
    lines.push(`⚠️ EMERGENCY: Context at ${result.currentPercent}% - compaction required`);
    return lines.join('\n');
  }

  if (result.shouldCompact) {
    lines.push(`📊 Context Check: Compaction needed before task`);
  } else {
    lines.push(`📊 Context Check: Proceeding without compaction`);
  }

  lines.push(`   Current: ${result.currentPercent}%`);
  lines.push(`   Task estimate: +${result.estimatedPercent}%`);
  lines.push(`   Projected: ${result.projectedPercent}%`);
  lines.push(`   Safe threshold: ${result.thresholdPercent}%`);

  if (result.factors) {
    const f = result.factors;
    const details = [];
    if (f.criteria > 0) details.push(`${f.criteria} criteria`);
    if (f.files > 0) details.push(`${f.files} files`);
    if (f.refactorBuffer) details.push('+refactor buffer');
    if (f.usedDefault) details.push(`default:${f.usedDefault}`);

    if (details.length > 0) {
      lines.push(`   Factors: ${details.join(', ')}`);
    }
  }

  if (result.config && result.config.reducedContext) {
    lines.push(`   Note: CLAUDE_CODE_DISABLE_1M_CONTEXT active — using reduced thresholds`);
  }

  return lines.join('\n');
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'estimate' && args[1]) {
    // Estimate for a specific task
    const taskId = args[1];

    // Validate taskId to prevent path traversal
    if (!isValidTaskId(taskId)) {
      console.error(`Invalid task ID format: ${taskId}`);
      console.error('Task IDs must contain only alphanumeric characters, hyphens, and underscores.');
      process.exit(1);
    }

    const readyPath = path.join(PATHS.state, 'ready.json');
    const readyData = safeJsonParse(readyPath, { ready: [], inProgress: [] });

    const allTasks = [
      ...(readyData.ready || []),
      ...(readyData.inProgress || []),
      ...(readyData.blocked || [])
    ];

    const task = allTasks.find(t =>
      (typeof t === 'object' && t.id === taskId) || t === taskId
    );

    if (!task) {
      console.error(`Task ${taskId} not found`);
      process.exit(1);
    }

    const taskObj = typeof task === 'object' ? task : { id: task };
    const estimation = estimateTaskContextNeeds(taskObj);

    console.log(`\nTask: ${taskId}`);
    console.log(`Title: ${estimation.taskTitle || 'N/A'}`);
    console.log(`Estimated context need: ${estimation.estimatePercent}%`);
    console.log(`\nFactors:`);
    console.log(`  Criteria: ${estimation.factors.criteria}`);
    console.log(`  Files: ${estimation.factors.files}`);
    console.log(`  Spec chars: ${estimation.factors.specChars}`);
    console.log(`  Refactor buffer: ${estimation.factors.refactorBuffer}`);
    console.log(`  Parent multiplier: ${estimation.factors.parentMultiplier}`);
    if (estimation.factors.usedDefault) {
      console.log(`  Used default: ${estimation.factors.usedDefault}`);
    }

  } else if (command === 'check' && args[1] && args[2]) {
    // Check if compaction needed: check <taskId> <currentPercent>
    const taskId = args[1];

    // Validate taskId to prevent path traversal
    if (!isValidTaskId(taskId)) {
      console.error(`Invalid task ID format: ${taskId}`);
      console.error('Task IDs must contain only alphanumeric characters, hyphens, and underscores.');
      process.exit(1);
    }

    const currentPercent = parseFloat(args[2]) / 100;

    const readyPath = path.join(PATHS.state, 'ready.json');
    const readyData = safeJsonParse(readyPath, { ready: [], inProgress: [] });

    const allTasks = [
      ...(readyData.ready || []),
      ...(readyData.inProgress || []),
      ...(readyData.blocked || [])
    ];

    const task = allTasks.find(t =>
      (typeof t === 'object' && t.id === taskId) || t === taskId
    );

    if (!task) {
      console.error(`Task ${taskId} not found`);
      process.exit(1);
    }

    const taskObj = typeof task === 'object' ? task : { id: task };
    const result = shouldCompactBeforeTask(taskObj, currentPercent);

    console.log(formatEstimationResult(result));

    if (result.shouldCompact) {
      process.exit(1); // Signal that compaction is needed
    }

  } else if (command === 'config') {
    // Show current config
    const config = getSmartCompactionConfig();
    console.log(JSON.stringify(config, null, 2));

  } else {
    console.log(`
Usage:
  node flow-context-estimator.js estimate <taskId>
    Estimate context needs for a task

  node flow-context-estimator.js check <taskId> <currentPercent>
    Check if compaction is needed before starting task
    Example: check wf-abc123 65

  node flow-context-estimator.js config
    Show current smart compaction configuration
`);
  }
}

module.exports = {
  getSmartCompactionConfig,
  estimateTaskContextNeeds,
  shouldCompactBeforeTask,
  shouldCompactForNonTaskWork,
  formatEstimationResult,
  extractCriteriaCount,
  extractFileCount,
  isValidTaskId,
  VALID_TASK_ID_PATTERN
};
