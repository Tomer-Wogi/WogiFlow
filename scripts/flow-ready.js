#!/usr/bin/env node

/**
 * Wogi Flow - Show Ready Tasks
 *
 * Displays tasks organized by status from ready.json
 *
 * Usage:
 *   flow ready           Show tasks (human-readable)
 *   flow ready --json    Output JSON for programmatic access
 */

const {
  PATHS,
  fileExists,
  getReadyData,
  getConfig,
  parseFlags,
  outputJson,
  color,
  printSection,
  error,
  warn
} = require('./flow-utils');

// Parallel execution detection
const { findParallelizable, getParallelConfig } = require('./flow-parallel');

/**
 * Priority order for sorting (P0 highest, P4 lowest)
 */
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

/**
 * Sort tasks by priority, then by date
 */
function sortByPriority(tasks) {
  return [...tasks].sort((a, b) => {
    // Handle both string and object tasks
    const aPriority = typeof a === 'object' ? (a.priority || 'P2') : 'P2';
    const bPriority = typeof b === 'object' ? (b.priority || 'P2') : 'P2';

    const aOrder = PRIORITY_ORDER[aPriority] ?? 2;
    const bOrder = PRIORITY_ORDER[bPriority] ?? 2;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    // Secondary sort by date (newer first) - ISO dates can be compared directly
    const aDate = typeof a === 'object' ? (a.createdAt || '') : '';
    const bDate = typeof b === 'object' ? (b.createdAt || '') : '';
    // Direct comparison works for ISO 8601 dates (YYYY-MM-DD...)
    if (bDate > aDate) return 1;
    if (bDate < aDate) return -1;
    return 0;
  });
}

/**
 * Format task for display
 */
function formatTask(task) {
  if (typeof task === 'object') {
    const priority = task.priority || 'P2';
    const id = task.id || '?';
    const title = task.title || 'No title';
    return { priority, id, title, raw: task };
  }
  return { priority: '-', id: task, title: '', raw: task };
}

function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  if (!fileExists(PATHS.ready)) {
    if (flags.json) {
      outputJson({
        success: false,
        error: 'No ready.json found',
        tasks: { ready: [], inProgress: [], blocked: [], recentlyCompleted: [] },
        summary: { total: 0, ready: 0, inProgress: 0, blocked: 0 }
      });
    }
    error('No ready.json found');
    console.log('Run: ./scripts/flow init');
    process.exit(1);
  }

  const data = getReadyData();

  // Validate data structure and warn if corrupted
  if (!data || typeof data !== 'object') {
    warn('ready.json appears corrupted (not an object)');
  } else {
    // Check for expected arrays
    const expectedArrays = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];
    for (const key of expectedArrays) {
      if (data[key] !== undefined && !Array.isArray(data[key])) {
        warn(`ready.json: "${key}" should be an array but found ${typeof data[key]}`);
      }
    }
  }

  // Sort ready tasks by priority
  const ready = sortByPriority(data.ready || []);
  const inProgress = data.inProgress || [];
  const blocked = data.blocked || [];
  const completed = data.recentlyCompleted || [];

  // Calculate summary
  const summary = {
    total: ready.length + inProgress.length + blocked.length,
    ready: ready.length,
    inProgress: inProgress.length,
    blocked: blocked.length,
    recentlyCompleted: completed.length
  };

  // Check for parallel execution potential
  // Get config once and reuse (avoid duplicate getConfig calls)
  const config = getConfig();
  const parallelConfig = getParallelConfig();
  let parallelInfo = null;
  let parallelizableTasks = []; // Store for reuse in display section

  try {
    if (parallelConfig.enabled && ready.length >= 2) {
      parallelizableTasks = findParallelizable(ready);
      if (parallelizableTasks.length >= 2) {
        parallelInfo = {
          available: true,
          count: parallelizableTasks.length,
          taskIds: parallelizableTasks.map(t => t.id || t),
          worktreeEnabled: config.worktree?.enabled || false,
          suggestion: `${parallelizableTasks.length} tasks can run in parallel with worktree isolation`
        };
      }
    }
  } catch (err) {
    // Non-critical - log for debugging but don't fail
    if (process.env.DEBUG) {
      console.error(`[flow-ready] Parallel detection failed: ${err.message}`);
    }
  }

  // JSON output - exit after to avoid human-readable output
  if (flags.json) {
    outputJson({
      success: true,
      tasks: {
        ready,
        inProgress,
        blocked,
        recentlyCompleted: completed
      },
      summary,
      parallel: parallelInfo
    });
    return; // Exit early for JSON mode
  }

  // Human-readable output
  printSection('Task Queue');
  console.log('===========');
  console.log('');

  // Ready tasks (sorted by priority)
  if (ready.length > 0) {
    console.log(color('green', '✓ READY'));
    for (const task of ready) {
      const { priority, id, title } = formatTask(task);
      const priorityColor = priority === 'P0' ? 'red' : priority === 'P1' ? 'yellow' : 'dim';
      console.log(`  ${color(priorityColor, `[${priority}]`)} ${id}: ${title}`);
    }
    console.log('');
  }

  // In progress
  if (inProgress.length > 0) {
    console.log(color('yellow', '⏳ IN PROGRESS'));
    for (const task of inProgress) {
      const { id, title } = formatTask(task);
      console.log(`  • ${id}: ${title}`);
    }
    console.log('');
  }

  // Blocked
  if (blocked.length > 0) {
    console.log(color('red', '🚫 BLOCKED'));
    for (const task of blocked) {
      if (typeof task === 'object') {
        const reason = task.reason || task.blockedBy || 'Unknown';
        console.log(`  • ${task.id || '?'}: ${reason}`);
      } else {
        console.log(`  • ${task}`);
      }
    }
    console.log('');
  }

  // Recently completed
  if (completed.length > 0) {
    console.log(color('cyan', '✅ RECENTLY COMPLETED'));
    for (const task of completed.slice(0, 5)) {
      const { id, title } = formatTask(task);
      console.log(`  • ${id}: ${title}`);
    }
    console.log('');
  }

  // Parallel execution detection (reuse parallelizableTasks computed earlier - no duplicate call)
  if (parallelInfo && parallelConfig.autoSuggest && parallelizableTasks.length >= 2) {
    console.log('');
    console.log(color('cyan', '⚡ PARALLEL EXECUTION AVAILABLE'));
    console.log(`  ${parallelizableTasks.length} tasks can run in parallel (no dependencies between them)`);
    console.log(`  Tasks: ${parallelizableTasks.map(t => t.id || t).join(', ')}`);
    if (parallelConfig.requireWorktree) {
      if (config.worktree?.enabled) {
        console.log(color('green', '  ✓ Worktree isolation enabled - safe for parallel execution'));
      } else {
        console.log(color('yellow', '  ⚠ Enable worktree for safe parallel execution: flow worktree enable'));
      }
    }
    console.log('');
    console.log(color('dim', '  To run in parallel: These tasks can be worked on simultaneously in separate'));
    console.log(color('dim', '  git worktrees. Each task gets its own isolated branch, merged when complete.'));
    console.log('');
  }

  // Summary
  console.log(`Total active: ${summary.total} (${summary.ready} ready, ${summary.inProgress} in progress, ${summary.blocked} blocked)`);
}

if (require.main === module) {
  main();
}

module.exports = { main, sortByPriority, PRIORITY_ORDER };
