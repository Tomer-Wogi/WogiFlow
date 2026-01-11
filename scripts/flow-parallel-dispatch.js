#!/usr/bin/env node

/**
 * flow-parallel-dispatch.js
 *
 * Phase 4.1: Parallel Dispatch System
 *
 * Execute independent subtasks on multiple models simultaneously.
 * Detects independent subtasks, dispatches them in parallel, and aggregates results.
 *
 * Usage:
 *   node flow-parallel-dispatch.js analyze "<task description>"
 *   node flow-parallel-dispatch.js execute --plan <plan.json>
 *   node flow-parallel-dispatch.js status
 *
 * @module flow-parallel-dispatch
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Imports
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');

const {
  getConfig,
  parseFlags,
  info,
  success,
  warn,
  error,
  color,
  outputJson,
  printHeader,
  printSection,
  safeJsonParse
} = require('./flow-utils');

const { analyzeTask } = require('./flow-task-analyzer');
const { routeTask } = require('./flow-model-router');
const { loadRegistry } = require('./flow-models');

// ============================================================
// Constants
// ============================================================

/**
 * Maximum concurrent dispatches.
 */
const MAX_CONCURRENT_DEFAULT = 3;

/**
 * Timeout for individual task execution (ms).
 */
const TASK_TIMEOUT_DEFAULT = 300000; // 5 minutes

/**
 * Minimum confidence required to parallelize.
 */
const MIN_INDEPENDENCE_CONFIDENCE = 0.7;

/**
 * Subtask dependency types.
 */
const DEPENDENCY_TYPES = {
  NONE: 'none',
  SEQUENTIAL: 'sequential',
  SHARED_FILE: 'shared_file',
  DATA_FLOW: 'data_flow',
  API_DEPENDENCY: 'api_dependency'
};

/**
 * Dispatch status values.
 */
const DISPATCH_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled'
};

/**
 * Default parallel dispatch configuration.
 */
const DEFAULT_PARALLEL_CONFIG = {
  enabled: true,
  maxConcurrent: MAX_CONCURRENT_DEFAULT,
  taskTimeout: TASK_TIMEOUT_DEFAULT,
  minIndependenceConfidence: MIN_INDEPENDENCE_CONFIDENCE,
  aggregationStrategy: 'merge', // 'merge' | 'best' | 'vote'
  retryOnFailure: true,
  maxRetries: 2
};

// ============================================================
// State
// ============================================================

const STATE_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'parallel-dispatch.json');

/**
 * Get default dispatch state.
 * @returns {Object} Default state
 */
function getDefaultState() {
  return {
    active: [],
    completed: [],
    stats: {
      totalDispatches: 0,
      successfulDispatches: 0,
      failedDispatches: 0,
      averageParallelism: 0,
      totalTimeSaved: 0
    }
  };
}

let dispatchState = getDefaultState();

// ============================================================
// Configuration
// ============================================================

/**
 * Get parallel dispatch configuration from config.json with defaults.
 * @returns {Object} Parallel dispatch configuration
 */
function getParallelConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_PARALLEL_CONFIG,
    ...(config.parallelDispatch || {})
  };
}

// ============================================================
// State Management
// ============================================================

/**
 * Load dispatch state from file using safe JSON parsing.
 */
function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    const loaded = safeJsonParse(STATE_PATH, null);
    if (loaded && typeof loaded === 'object') {
      // Validate structure before using
      dispatchState = {
        active: Array.isArray(loaded.active) ? loaded.active : [],
        completed: Array.isArray(loaded.completed) ? loaded.completed : [],
        stats: { ...getDefaultState().stats, ...(loaded.stats || {}) }
      };
    }
  }
}

/**
 * Save dispatch state to file.
 */
function saveState() {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(dispatchState, null, 2));
  } catch (e) {
    warn(`Could not save dispatch state: ${e.message}`);
  }
}

// ============================================================
// Subtask Analysis
// ============================================================

/**
 * Analyze a task and identify independent subtasks.
 * @param {Object} params - Analysis parameters
 * @param {string} params.description - Task description
 * @param {Object} [params.context] - Additional context
 * @returns {Object} Subtask analysis result
 */
function analyzeSubtasks({ description, context = {} }) {
  const analysis = analyzeTask({ title: description, type: context.type || 'feature' });

  // Extract potential subtasks from the description
  const subtasks = extractSubtasks(description, analysis);

  // Analyze dependencies between subtasks
  const dependencies = analyzeDependencies(subtasks);

  // Identify which subtasks can run in parallel
  const parallelGroups = identifyParallelGroups(subtasks, dependencies);

  // Calculate parallelization metrics
  const metrics = calculateParallelMetrics(subtasks, parallelGroups);

  return {
    originalTask: description,
    analysis,
    subtasks,
    dependencies,
    parallelGroups,
    metrics,
    canParallelize: metrics.parallelizableRatio >= MIN_INDEPENDENCE_CONFIDENCE,
    recommendation: generateRecommendation(metrics, parallelGroups)
  };
}

/**
 * Extract subtasks from a task description.
 * @param {string} description - Task description
 * @param {Object} analysis - Task analysis
 * @returns {Array} List of subtasks
 */
function extractSubtasks(description, analysis) {
  const subtasks = [];

  // Pattern 1: Numbered list items
  const numberedPattern = /(?:^|\n)\s*(\d+)\.\s+(.+?)(?=\n\s*\d+\.|\n\n|$)/gs;
  let match;
  while ((match = numberedPattern.exec(description)) !== null) {
    subtasks.push({
      id: `subtask-${match[1]}`,
      description: match[2].trim(),
      order: parseInt(match[1]),
      type: inferSubtaskType(match[2], analysis)
    });
  }

  // Pattern 2: Bullet points
  if (subtasks.length === 0) {
    const bulletPattern = /(?:^|\n)\s*[-*•]\s+(.+?)(?=\n\s*[-*•]|\n\n|$)/gs;
    let order = 1;
    while ((match = bulletPattern.exec(description)) !== null) {
      subtasks.push({
        id: `subtask-${order}`,
        description: match[1].trim(),
        order: order++,
        type: inferSubtaskType(match[1], analysis)
      });
    }
  }

  // Pattern 3: "and" separated tasks
  if (subtasks.length === 0) {
    const andPattern = /\b(add|create|update|fix|implement|remove|refactor)\s+([^,]+?)(?:\s+and\s+|\s*,\s*|\s*$)/gi;
    let order = 1;
    while ((match = andPattern.exec(description)) !== null) {
      subtasks.push({
        id: `subtask-${order}`,
        description: `${match[1]} ${match[2]}`.trim(),
        order: order++,
        type: inferSubtaskType(`${match[1]} ${match[2]}`, analysis)
      });
    }
  }

  // If no subtasks found, treat the whole task as a single subtask
  if (subtasks.length === 0) {
    subtasks.push({
      id: 'subtask-1',
      description: description,
      order: 1,
      type: analysis.taskType || 'unknown'
    });
  }

  // Enrich subtasks with additional analysis
  return subtasks.map(subtask => ({
    ...subtask,
    files: inferAffectedFiles(subtask.description),
    complexity: inferComplexity(subtask.description),
    estimatedTokens: estimateTokens(subtask.description)
  }));
}

/**
 * Infer the type of a subtask from its description.
 * @param {string} description - Subtask description
 * @param {Object} analysis - Parent task analysis
 * @returns {string} Subtask type
 */
function inferSubtaskType(description, analysis) {
  const lower = description.toLowerCase();

  if (/\b(create|add|implement|build)\b/.test(lower)) return 'create';
  if (/\b(update|modify|change|edit)\b/.test(lower)) return 'update';
  if (/\b(fix|repair|resolve|debug)\b/.test(lower)) return 'fix';
  if (/\b(refactor|reorganize|restructure)\b/.test(lower)) return 'refactor';
  if (/\b(remove|delete|deprecate)\b/.test(lower)) return 'remove';
  if (/\b(test|verify|validate)\b/.test(lower)) return 'test';
  if (/\b(document|comment|describe)\b/.test(lower)) return 'docs';

  return analysis.taskType || 'unknown';
}

/**
 * Infer files that might be affected by a subtask.
 * @param {string} description - Subtask description
 * @returns {Array} List of inferred file patterns
 */
function inferAffectedFiles(description) {
  const files = [];

  // Extract explicit file references
  const filePattern = /[a-zA-Z0-9_-]+\.(ts|tsx|js|jsx|json|md|css|scss|html|vue|svelte)/g;
  let match;
  while ((match = filePattern.exec(description)) !== null) {
    files.push(match[0]);
  }

  // Infer from component/service mentions
  const componentPattern = /\b([A-Z][a-zA-Z]+(?:Component|Service|Controller|Hook|Provider|Context))\b/g;
  while ((match = componentPattern.exec(description)) !== null) {
    files.push(`*${match[1]}*`);
  }

  return [...new Set(files)];
}

/**
 * Infer complexity of a subtask.
 * @param {string} description - Subtask description
 * @returns {string} Complexity level
 */
function inferComplexity(description) {
  const lower = description.toLowerCase();
  const wordCount = description.split(/\s+/).length;

  // Simple heuristics
  if (wordCount > 50 || /\b(complex|architecture|refactor|migrate)\b/.test(lower)) {
    return 'high';
  }
  if (wordCount > 20 || /\b(integrate|implement|create)\b/.test(lower)) {
    return 'medium';
  }
  return 'low';
}

/**
 * Estimate tokens needed for a subtask.
 * @param {string} description - Subtask description
 * @returns {number} Estimated tokens
 */
function estimateTokens(description) {
  // Rough estimation: 4 chars per token, multiply by complexity factor
  const baseTokens = Math.ceil(description.length / 4);
  const complexityMultiplier = {
    low: 100,
    medium: 500,
    high: 2000
  };
  const complexity = inferComplexity(description);
  return baseTokens + complexityMultiplier[complexity];
}

// ============================================================
// Dependency Analysis
// ============================================================

/**
 * Analyze dependencies between subtasks.
 * @param {Array} subtasks - List of subtasks
 * @returns {Object} Dependency graph
 */
function analyzeDependencies(subtasks) {
  const dependencies = {
    graph: {},
    edges: []
  };

  // Initialize graph
  for (const subtask of subtasks) {
    dependencies.graph[subtask.id] = {
      dependsOn: [],
      blocks: [],
      sharedFiles: []
    };
  }

  // Analyze pairwise dependencies
  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      const dep = detectDependency(subtasks[i], subtasks[j]);
      if (dep.type !== DEPENDENCY_TYPES.NONE) {
        dependencies.edges.push({
          from: subtasks[i].id,
          to: subtasks[j].id,
          ...dep
        });

        if (dep.direction === 'forward') {
          dependencies.graph[subtasks[j].id].dependsOn.push(subtasks[i].id);
          dependencies.graph[subtasks[i].id].blocks.push(subtasks[j].id);
        } else if (dep.direction === 'backward') {
          dependencies.graph[subtasks[i].id].dependsOn.push(subtasks[j].id);
          dependencies.graph[subtasks[j].id].blocks.push(subtasks[i].id);
        }

        if (dep.sharedFiles?.length > 0) {
          dependencies.graph[subtasks[i].id].sharedFiles.push(...dep.sharedFiles);
          dependencies.graph[subtasks[j].id].sharedFiles.push(...dep.sharedFiles);
        }
      }
    }
  }

  return dependencies;
}

/**
 * Detect dependency between two subtasks.
 * @param {Object} taskA - First subtask
 * @param {Object} taskB - Second subtask
 * @returns {Object} Dependency information
 */
function detectDependency(taskA, taskB) {
  // Check for shared files
  const sharedFiles = taskA.files.filter(f =>
    taskB.files.some(bf => f === bf || f.includes('*') && bf.includes(f.replace('*', '')))
  );

  if (sharedFiles.length > 0) {
    return {
      type: DEPENDENCY_TYPES.SHARED_FILE,
      confidence: 0.8,
      sharedFiles,
      direction: taskA.order < taskB.order ? 'forward' : 'backward',
      reason: `Shared files: ${sharedFiles.join(', ')}`
    };
  }

  // Check for sequential keywords
  const sequentialPatterns = [
    { pattern: /\bthen\b|\bafter\b|\bonce\b.*\bdone\b/i, direction: 'forward' },
    { pattern: /\bbefore\b|\bfirst\b|\bprior\b/i, direction: 'backward' }
  ];

  for (const { pattern, direction } of sequentialPatterns) {
    if (pattern.test(taskB.description)) {
      return {
        type: DEPENDENCY_TYPES.SEQUENTIAL,
        confidence: 0.7,
        direction,
        reason: 'Sequential keyword detected'
      };
    }
  }

  // Check for data flow (create -> use)
  const createsMatch = taskA.description.match(/\b(?:create|add|implement)\s+(\w+)/i);
  const usesMatch = taskB.description.match(/\b(?:use|with|using)\s+(\w+)/i);

  if (createsMatch && usesMatch && createsMatch[1].toLowerCase() === usesMatch[1].toLowerCase()) {
    return {
      type: DEPENDENCY_TYPES.DATA_FLOW,
      confidence: 0.9,
      direction: 'forward',
      reason: `Task B uses ${createsMatch[1]} created by Task A`
    };
  }

  return { type: DEPENDENCY_TYPES.NONE, confidence: 1.0 };
}

// ============================================================
// Parallel Group Identification
// ============================================================

/**
 * Identify groups of subtasks that can run in parallel.
 * @param {Array} subtasks - List of subtasks
 * @param {Object} dependencies - Dependency graph
 * @returns {Array} Groups of parallel subtasks
 */
function identifyParallelGroups(subtasks, dependencies) {
  const groups = [];
  const assigned = new Set();

  // Sort subtasks by order
  const sorted = [...subtasks].sort((a, b) => a.order - b.order);

  for (const subtask of sorted) {
    if (assigned.has(subtask.id)) continue;

    // Find all subtasks that can run with this one
    const parallel = [subtask];
    assigned.add(subtask.id);

    for (const other of sorted) {
      if (assigned.has(other.id)) continue;

      // Check if other can run in parallel with all current group members
      const canParallel = parallel.every(member => {
        const dep = dependencies.edges.find(
          e => (e.from === member.id && e.to === other.id) ||
               (e.from === other.id && e.to === member.id)
        );
        return !dep || dep.type === DEPENDENCY_TYPES.NONE;
      });

      if (canParallel) {
        parallel.push(other);
        assigned.add(other.id);
      }
    }

    groups.push({
      id: `group-${groups.length + 1}`,
      subtasks: parallel,
      canParallelize: parallel.length > 1,
      totalEstimatedTokens: parallel.reduce((sum, t) => sum + t.estimatedTokens, 0)
    });
  }

  return groups;
}

// ============================================================
// Metrics & Recommendations
// ============================================================

/**
 * Calculate parallelization metrics.
 * @param {Array} subtasks - All subtasks
 * @param {Array} parallelGroups - Parallel groups
 * @returns {Object} Metrics
 */
function calculateParallelMetrics(subtasks, parallelGroups) {
  const totalSubtasks = subtasks.length;
  const parallelizableCount = parallelGroups.filter(g => g.canParallelize).reduce(
    (sum, g) => sum + g.subtasks.length, 0
  );

  // Estimate time savings
  const sequentialTime = subtasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
  const parallelTime = parallelGroups.reduce((sum, g) =>
    sum + Math.max(...g.subtasks.map(t => t.estimatedTokens)), 0
  );

  return {
    totalSubtasks,
    parallelizableCount,
    parallelizableRatio: totalSubtasks > 0 ? parallelizableCount / totalSubtasks : 0,
    parallelGroups: parallelGroups.length,
    maxParallelism: Math.max(...parallelGroups.map(g => g.subtasks.length)),
    estimatedSpeedup: sequentialTime > 0 ? sequentialTime / parallelTime : 1,
    sequentialTokens: sequentialTime,
    parallelTokens: parallelTime
  };
}

/**
 * Generate recommendation based on metrics.
 * @param {Object} metrics - Parallelization metrics
 * @param {Array} parallelGroups - Parallel groups
 * @returns {Object} Recommendation
 */
function generateRecommendation(metrics, parallelGroups) {
  if (metrics.totalSubtasks <= 1) {
    return {
      action: 'sequential',
      reason: 'Single task - no parallelization needed',
      confidence: 1.0
    };
  }

  if (metrics.parallelizableRatio < MIN_INDEPENDENCE_CONFIDENCE) {
    return {
      action: 'sequential',
      reason: `Low parallelizable ratio (${(metrics.parallelizableRatio * 100).toFixed(0)}%)`,
      confidence: metrics.parallelizableRatio
    };
  }

  if (metrics.estimatedSpeedup < 1.2) {
    return {
      action: 'sequential',
      reason: 'Minimal speedup expected',
      confidence: 0.6
    };
  }

  return {
    action: 'parallel',
    reason: `${metrics.maxParallelism}x parallelism possible, ~${metrics.estimatedSpeedup.toFixed(1)}x speedup`,
    confidence: metrics.parallelizableRatio,
    suggestedGroups: parallelGroups.filter(g => g.canParallelize)
  };
}

// ============================================================
// Dispatch Execution
// ============================================================

/**
 * Create a dispatch plan from subtask analysis.
 * @param {Object} analysis - Subtask analysis result
 * @returns {Object} Dispatch plan
 */
function createDispatchPlan(analysis) {
  const config = getParallelConfig();
  const registry = loadRegistry();

  const plan = {
    id: `dispatch-${Date.now()}`,
    createdAt: new Date().toISOString(),
    originalTask: analysis.originalTask,
    groups: [],
    estimatedDuration: 0,
    status: DISPATCH_STATUS.PENDING
  };

  for (const group of analysis.parallelGroups) {
    const groupPlan = {
      id: group.id,
      subtasks: group.subtasks.map(subtask => {
        // Route each subtask to optimal model
        const routing = routeTask({
          analysis: {
            taskType: subtask.type,
            complexity: { level: subtask.complexity },
            languages: analysis.analysis.languages || { primary: 'javascript' }
          }
        });

        return {
          id: subtask.id,
          description: subtask.description,
          model: routing.primary?.modelId || 'default',
          estimatedTokens: subtask.estimatedTokens,
          status: DISPATCH_STATUS.PENDING,
          timeout: config.taskTimeout
        };
      }),
      canParallelize: group.canParallelize,
      maxConcurrent: Math.min(group.subtasks.length, config.maxConcurrent)
    };

    plan.groups.push(groupPlan);

    // Estimate duration: parallel time + overhead
    const groupDuration = group.canParallelize
      ? Math.max(...groupPlan.subtasks.map(t => t.estimatedTokens))
      : groupPlan.subtasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
    plan.estimatedDuration += groupDuration;
  }

  return plan;
}

/**
 * Execute a dispatch plan (simulation for now).
 * @param {Object} plan - Dispatch plan
 * @returns {Object} Execution result
 */
async function executeDispatchPlan(plan) {
  loadState();

  const execution = {
    planId: plan.id,
    startedAt: new Date().toISOString(),
    groups: [],
    results: [],
    status: DISPATCH_STATUS.RUNNING
  };

  dispatchState.active.push(execution);
  saveState();

  try {
    for (const group of plan.groups) {
      const groupResult = {
        id: group.id,
        startedAt: new Date().toISOString(),
        subtasks: []
      };

      if (group.canParallelize) {
        // Simulate parallel execution
        info(`Executing ${group.subtasks.length} subtasks in parallel...`);

        const promises = group.subtasks.map(async (subtask) => {
          return {
            id: subtask.id,
            model: subtask.model,
            status: DISPATCH_STATUS.COMPLETED,
            result: `[Simulated] Would execute: ${subtask.description}`,
            tokens: subtask.estimatedTokens
          };
        });

        groupResult.subtasks = await Promise.all(promises);
      } else {
        // Sequential execution
        for (const subtask of group.subtasks) {
          groupResult.subtasks.push({
            id: subtask.id,
            model: subtask.model,
            status: DISPATCH_STATUS.COMPLETED,
            result: `[Simulated] Would execute: ${subtask.description}`,
            tokens: subtask.estimatedTokens
          });
        }
      }

      groupResult.completedAt = new Date().toISOString();
      execution.groups.push(groupResult);
    }

    execution.status = DISPATCH_STATUS.COMPLETED;
    execution.completedAt = new Date().toISOString();

    // Update stats
    dispatchState.stats.totalDispatches++;
    dispatchState.stats.successfulDispatches++;

    // Move from active to completed
    dispatchState.active = dispatchState.active.filter(e => e.planId !== plan.id);
    dispatchState.completed.push(execution);

    // Keep only last 50 completed
    if (dispatchState.completed.length > 50) {
      dispatchState.completed = dispatchState.completed.slice(-50);
    }

    saveState();

    return execution;
  } catch (e) {
    execution.status = DISPATCH_STATUS.FAILED;
    execution.error = e.message;
    dispatchState.stats.failedDispatches++;
    saveState();
    throw e;
  }
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print subtask analysis results.
 * @param {Object} analysis - Analysis result
 */
function printAnalysis(analysis) {
  printHeader('PARALLEL DISPATCH ANALYSIS');

  printSection('Original Task');
  console.log(`  ${analysis.originalTask}\n`);

  printSection('Subtasks Identified');
  for (const subtask of analysis.subtasks) {
    const complexity = subtask.complexity === 'high' ? '🔴' :
                       subtask.complexity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${complexity} ${subtask.id}: ${subtask.description}`);
    if (subtask.files.length > 0) {
      console.log(color('dim', `     Files: ${subtask.files.join(', ')}`));
    }
  }

  printSection('Dependencies');
  if (analysis.dependencies.edges.length === 0) {
    console.log(color('dim', '  No dependencies detected - all subtasks are independent'));
  } else {
    for (const edge of analysis.dependencies.edges) {
      console.log(`  ${edge.from} → ${edge.to}: ${edge.type} (${edge.reason})`);
    }
  }

  printSection('Parallel Groups');
  for (const group of analysis.parallelGroups) {
    const parallelIcon = group.canParallelize ? '⚡' : '📝';
    console.log(`  ${parallelIcon} ${group.id}: ${group.subtasks.map(t => t.id).join(', ')}`);
  }

  printSection('Metrics');
  const m = analysis.metrics;
  console.log(`  Total subtasks: ${m.totalSubtasks}`);
  console.log(`  Parallelizable: ${m.parallelizableCount} (${(m.parallelizableRatio * 100).toFixed(0)}%)`);
  console.log(`  Max parallelism: ${m.maxParallelism}`);
  console.log(`  Estimated speedup: ${m.estimatedSpeedup.toFixed(1)}x`);

  printSection('Recommendation');
  const r = analysis.recommendation;
  const actionIcon = r.action === 'parallel' ? success('⚡ PARALLEL') : info('📝 SEQUENTIAL');
  console.log(`  ${actionIcon}`);
  console.log(`  ${r.reason}`);
  console.log(color('dim', `  Confidence: ${(r.confidence * 100).toFixed(0)}%`));
}

/**
 * Print dispatch status.
 */
function printStatus() {
  loadState();

  printHeader('PARALLEL DISPATCH STATUS');

  printSection('Configuration');
  const config = getParallelConfig();
  console.log(`  ${color('dim', 'Enabled:')} ${config.enabled ? success('Yes') : warn('No')}`);
  console.log(`  ${color('dim', 'Max concurrent:')} ${config.maxConcurrent}`);
  console.log(`  ${color('dim', 'Task timeout:')} ${config.taskTimeout}ms`);
  console.log(`  ${color('dim', 'Aggregation:')} ${config.aggregationStrategy}`);

  printSection('Statistics');
  const s = dispatchState.stats;
  console.log(`  ${color('dim', 'Total dispatches:')} ${s.totalDispatches}`);
  console.log(`  ${color('dim', 'Successful:')} ${s.successfulDispatches}`);
  console.log(`  ${color('dim', 'Failed:')} ${s.failedDispatches}`);

  printSection('Active Dispatches');
  if (dispatchState.active.length === 0) {
    console.log(color('dim', '  No active dispatches'));
  } else {
    for (const dispatch of dispatchState.active) {
      console.log(`  ${dispatch.planId}: ${dispatch.status}`);
    }
  }

  printSection('Recent Completed');
  const recent = dispatchState.completed.slice(-5);
  if (recent.length === 0) {
    console.log(color('dim', '  No completed dispatches'));
  } else {
    for (const dispatch of recent) {
      const statusIcon = dispatch.status === DISPATCH_STATUS.COMPLETED ? '✓' : '✗';
      console.log(`  ${statusIcon} ${dispatch.planId}`);
    }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  analyzeSubtasks,
  createDispatchPlan,
  executeDispatchPlan,
  getParallelConfig,
  DEPENDENCY_TYPES,
  DISPATCH_STATUS,
  DEFAULT_PARALLEL_CONFIG
};

// ============================================================
// CLI Entry Point
// ============================================================

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Usage: flow parallel <command> [options]

Commands:
  analyze "<task>"    Analyze task for parallel execution opportunities
  plan "<task>"       Create a dispatch plan
  execute --plan <f>  Execute a dispatch plan from file
  status              Show dispatch status and statistics

Options:
  --json              Output as JSON
  --max-concurrent N  Override max concurrent dispatches
  --help              Show this help

Examples:
  flow parallel analyze "Add login form and signup form and password reset"
  flow parallel plan "Create user service and auth service"
  flow parallel status
`);
    return;
  }

  switch (command) {
    case 'analyze': {
      const description = positional.slice(1).join(' ') || flags.task;
      if (!description) {
        error('Please provide a task description');
        process.exit(1);
      }
      // Input length validation (prevent DoS)
      if (description.length > 10000) {
        error('Task description exceeds maximum length (10000 chars)');
        process.exit(1);
      }

      const analysis = analyzeSubtasks({ description });

      if (flags.json) {
        outputJson(analysis);
      } else {
        printAnalysis(analysis);
      }
      break;
    }

    case 'plan': {
      const description = positional.slice(1).join(' ') || flags.task;
      if (!description) {
        error('Please provide a task description');
        process.exit(1);
      }
      // Input length validation (prevent DoS)
      if (description.length > 10000) {
        error('Task description exceeds maximum length (10000 chars)');
        process.exit(1);
      }

      const analysis = analyzeSubtasks({ description });
      const plan = createDispatchPlan(analysis);

      if (flags.json) {
        outputJson(plan);
      } else {
        printAnalysis(analysis);
        printSection('Dispatch Plan');
        console.log(JSON.stringify(plan, null, 2));
      }
      break;
    }

    case 'execute': {
      if (!flags.plan) {
        error('Please provide a plan file with --plan');
        process.exit(1);
      }

      // Validate path is within project directory (prevent path traversal)
      const planPath = path.resolve(flags.plan);
      if (!planPath.startsWith(PROJECT_ROOT)) {
        error('Plan file must be within project directory');
        process.exit(1);
      }

      // Use safe JSON parsing
      const plan = safeJsonParse(planPath, null);
      if (!plan) {
        error('Failed to parse plan file');
        process.exit(1);
      }

      try {
        const result = await executeDispatchPlan(plan);

        if (flags.json) {
          outputJson(result);
        } else {
          success('Dispatch completed');
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (e) {
        error(`Failed to execute plan: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'status':
      if (flags.json) {
        loadState();
        outputJson(dispatchState);
      } else {
        printStatus();
      }
      break;

    default:
      error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    error(e.message);
    process.exit(1);
  });
}
