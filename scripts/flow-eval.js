#!/usr/bin/env node

/**
 * Wogi Flow - Eval Engine
 *
 * Measures WogiFlow output quality by re-evaluating completed tasks.
 * Uses completed tasks as benchmarks: read the spec, examine the diff,
 * spawn multi-judge scoring.
 *
 * Part of S3: Eval System
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getConfig,
  PATHS,
  readJson,
  writeJson,
  fileExists,
  safeJsonParse,
  validateTaskId
} = require('./flow-utils');
const { loadStats } = require('./flow-stats-collector');
const {
  buildJudgePrompt,
  aggregateScores,
  getEvalConfig,
  getJudgeComposition,
  formatEvalResults
} = require('./flow-eval-judge');

// ============================================================
// Constants
// ============================================================

const EVALS_DIR = path.join(PATHS.root, '.workflow', 'evals');

// ============================================================
// Core Functions
// ============================================================

/**
 * Prepare eval data for a completed task.
 * Reads the spec and git diff without spawning judges.
 *
 * @param {string} taskId - Task ID to evaluate
 * @returns {Object|null} Eval input data or null if not found
 */
function prepareEvalData(taskId) {
  if (!taskId || !validateTaskId(taskId).valid) {
    return null;
  }

  // Find spec file
  const specPath = findSpecFile(taskId);
  if (!specPath) {
    return { error: `No spec file found for ${taskId}` };
  }

  let specContent;
  try {
    specContent = fs.readFileSync(specPath, 'utf-8');
  } catch (err) {
    return { error: `Cannot read spec: ${err.message}` };
  }

  // Find the task in stats to get metadata
  const stats = loadStats();
  const taskRecord = stats.recentTasks.find((t) => t.taskId === taskId);

  // Get implementation diff
  const diff = getTaskDiff(taskId, taskRecord);

  return {
    taskId,
    specPath,
    specContent,
    implementationDiff: diff,
    iterations: taskRecord?.iterations || 1,
    tokenEstimate: taskRecord?.tokenEstimate || 0,
    model: taskRecord?.model || 'unknown',
    taskType: taskRecord?.taskType || 'unknown',
    changedFiles: taskRecord?.changedFiles || []
  };
}

/**
 * Get the git diff for a task's implementation.
 *
 * @param {string} taskId - Task ID
 * @param {Object} [taskRecord] - Task record from stats
 * @returns {string} Git diff output
 */
function getTaskDiff(taskId, taskRecord) {
  // Try to find the commit for this task
  try {
    const output = execFileSync('git', [
      'log',
      '--oneline',
      '--all',
      `--grep=${taskId}`,
      '-1',
      '--format=%H'
    ], {
      cwd: PATHS.root,
      encoding: 'utf-8',
      timeout: 10000
    }).trim();

    if (output && /^[a-f0-9]{40}$/.test(output)) {
      // Get the diff for that commit (SHA validated)
      const diff = execFileSync('git', [
        'diff',
        `${output}^..${output}`,
        '--stat',
        '--',
        '*.js',
        '*.ts',
        '*.tsx',
        '*.jsx',
        '*.json',
        '*.yaml',
        '*.yml',
        '*.md'
      ], {
        cwd: PATHS.root,
        encoding: 'utf-8',
        timeout: 10000
      }).trim();

      // Also get the full diff but limited
      const fullDiff = execFileSync('git', [
        'diff',
        `${output}^..${output}`,
        '--',
        '*.js',
        '*.ts',
        '*.tsx',
        '*.jsx'
      ], {
        cwd: PATHS.root,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 100 * 1024 // 100KB limit
      }).trim();

      return `${diff}\n\n${fullDiff.substring(0, 50000)}`; // Limit to 50K chars
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[eval] Git diff failed: ${err.message}`);
    }
  }

  // Fallback: list the changed files if we have them
  if (taskRecord?.changedFiles?.length > 0) {
    return `Changed files: ${taskRecord.changedFiles.join(', ')}\n(No commit found for diff)`;
  }

  return '(No diff available)';
}

/**
 * Find the spec file for a task.
 *
 * @param {string} taskId - Task ID
 * @returns {string|null} Path to spec file or null
 */
function findSpecFile(taskId) {
  // Check common locations
  const candidates = [
    path.join(PATHS.root, '.workflow', 'specs', `${taskId}.md`),
    path.join(PATHS.root, '.workflow', 'changes', `${taskId}.md`)
  ];

  // Also search subdirectories of changes/
  try {
    const changesDir = path.join(PATHS.root, '.workflow', 'changes');
    if (fs.existsSync(changesDir)) {
      const entries = fs.readdirSync(changesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push(
            path.join(changesDir, entry.name, `${taskId}.md`)
          );
        }
      }
    }
  } catch {
    // Ignore directory scan errors
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Ignore
    }
  }

  // Check ready.json for specPath
  try {
    const ready = readJson(path.join(PATHS.state, 'ready.json'), {});
    const allTasks = [
      ...(ready.inProgress || []),
      ...(ready.ready || []),
      ...(ready.recentlyCompleted || []),
      ...(ready.backlog || [])
    ];
    const task = allTasks.find((t) => t.id === taskId);
    if (task?.specPath) {
      const fullPath = path.resolve(PATHS.root, task.specPath);
      // Validate path stays within project root (prevent path traversal)
      if (!fullPath.startsWith(PATHS.root)) return null;
      if (fs.existsSync(fullPath)) return fullPath;
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Save eval results to the evals directory.
 *
 * @param {Object} evalResult - Full eval result
 * @returns {string} Path to saved file
 */
function saveEvalResult(evalResult) {
  // Ensure evals directory exists
  try {
    if (!fs.existsSync(EVALS_DIR)) {
      fs.mkdirSync(EVALS_DIR, { recursive: true });
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[eval] Cannot create evals dir: ${err.message}`);
    }
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${evalResult.taskId}-eval-${timestamp}.json`;
  const filePath = path.join(EVALS_DIR, fileName);

  try {
    writeJson(filePath, evalResult);
    return filePath;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[eval] Save failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Load all eval results for comparison.
 *
 * @param {number} [limit=20] - Max results to load
 * @returns {Object[]} Array of eval results
 */
function loadEvalHistory(limit = 20) {
  try {
    if (!fs.existsSync(EVALS_DIR)) return [];

    const files = fs.readdirSync(EVALS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map((f) => {
      try {
        return readJson(path.join(EVALS_DIR, f), null);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the list of recently completed tasks eligible for eval.
 *
 * @param {number} [limit=10] - Max tasks
 * @returns {Object[]} Task records from stats
 */
function getEvalCandidates(limit = 10) {
  const stats = loadStats();
  return stats.recentTasks
    .filter((t) => t.taskId && t.model)
    .slice(0, limit);
}

/**
 * Generate a comparison report from eval history.
 *
 * @returns {string} Formatted comparison
 */
function generateComparisonReport() {
  const history = loadEvalHistory(50);
  if (history.length === 0) {
    return 'No eval history available. Run /wogi-eval on completed tasks to build history.';
  }

  const lines = [];
  lines.push('Eval History Comparison');
  lines.push('═'.repeat(60));
  lines.push('');

  // Group by model
  const byModel = {};
  for (const evalResult of history) {
    const model = evalResult.model || 'unknown';
    if (!byModel[model]) byModel[model] = [];
    byModel[model].push(evalResult);
  }

  for (const [model, evals] of Object.entries(byModel)) {
    const overalls = evals
      .filter((e) => e.aggregated?.overall)
      .map((e) => e.aggregated.overall);

    if (overalls.length === 0) continue;

    const avg = +(overalls.reduce((s, v) => s + v, 0) / overalls.length).toFixed(2);
    const trend = overalls.length >= 3
      ? (overalls[0] > overalls[overalls.length - 1] ? 'improving'
        : overalls[0] === overalls[overalls.length - 1] ? 'stable' : 'declining')
      : 'insufficient data';

    lines.push(`${model}: ${evals.length} evals, avg ${avg}/10 (${trend})`);
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'prepare': {
      const taskId = args[0];
      if (!taskId) {
        console.error('Usage: flow-eval.js prepare <taskId>');
        process.exit(1);
      }
      const data = prepareEvalData(taskId);
      if (data?.error) {
        console.error(data.error);
        process.exit(1);
      }
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'candidates': {
      const candidates = getEvalCandidates(parseInt(args[0], 10) || 10);
      if (candidates.length === 0) {
        console.log('No completed tasks found for evaluation.');
      } else {
        console.log('Eval Candidates:');
        for (const c of candidates) {
          console.log(`  ${c.taskId} (${c.model}, ${c.taskType}) — ${c.iterations} iterations`);
        }
      }
      break;
    }

    case 'history': {
      const history = loadEvalHistory();
      if (history.length === 0) {
        console.log('No eval history.');
      } else {
        for (const h of history) {
          console.log(`${h.taskId}: ${h.aggregated?.overall || '?'}/10 (${h.aggregated?.confidence || '?'})`);
        }
      }
      break;
    }

    case 'compare':
      console.log(generateComparisonReport());
      break;

    default:
      console.log(`
Eval Engine

Usage: flow-eval.js <command> [args]

Commands:
  prepare <taskId>    Prepare eval data (spec + diff) for a task
  candidates [limit]  Show tasks eligible for evaluation
  history             Show eval history
  compare             Compare eval results over time

Note: Full evaluation with judges happens via /wogi-eval slash command,
which uses the Agent tool to spawn judge agents.
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  EVALS_DIR,
  prepareEvalData,
  findSpecFile,
  saveEvalResult,
  loadEvalHistory,
  getEvalCandidates,
  generateComparisonReport
};

if (require.main === module) {
  main();
}
