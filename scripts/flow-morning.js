#!/usr/bin/env node

/**
 * Wogi Flow - Morning Briefing Command
 *
 * Generates a "where am I?" briefing for starting your day.
 * Pulls from session state, ready tasks, request log, progress, and git.
 *
 * Usage:
 *   flow morning           Human-readable briefing
 *   flow morning --json    JSON output for programmatic access
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  readFile,
  getConfig,
  getReadyData,
  getGitStatus,
  isGitRepo,
  parseFlags,
  outputJson,
  color,
  printHeader,
  printSection
} = require('./flow-utils');

// Use centralized session state module
const { loadSessionState } = require('./flow-session-state');

// v2.6.1: Use centralized state cleanup module
const { cleanupStaleState } = require('./flow-state-cleanup');

// Note: cleanupStaleState is now imported from flow-state-cleanup.js
// Morning briefing calls it with { cleanupStaleTasks: true } to also clean stale auto-created tasks

/**
 * Priority order for sorting (P0 highest, P4 lowest)
 */
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

/**
 * Calculate hours since last active
 */
function getHoursSince(timestamp) {
  if (!timestamp) return null;
  const lastActive = new Date(timestamp);
  const now = new Date();
  const diffMs = now - lastActive;
  return Math.round(diffMs / (1000 * 60 * 60) * 10) / 10; // 1 decimal
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Get session state (delegates to centralized module)
 */
function getSessionState() {
  return loadSessionState();
}

/**
 * Get progress data from progress.md
 */
function getProgressData() {
  const progressPath = PATHS.progress;
  if (!fileExists(progressPath)) {
    return { keyFacts: [], lastSession: null, inProgress: null, next: null, blockers: [] };
  }

  const content = readFile(progressPath, '');
  const result = {
    keyFacts: [],
    lastSession: null,
    inProgress: null,
    next: null,
    blockers: []
  };

  // Extract memory blocks JSON
  const memoryMatch = content.match(/<!-- MEMORY-BLOCKS-START -->\s*```json\s*([\s\S]*?)```\s*<!-- MEMORY-BLOCKS-END -->/);
  if (memoryMatch) {
    try {
      const memoryData = JSON.parse(memoryMatch[1]);
      result.keyFacts = memoryData.keyFacts || [];
      if (memoryData.sessionContext) {
        result.blockers = memoryData.sessionContext.blockers || [];
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Extract sections
  const lastSessionMatch = content.match(/## Last Session\s*\n([\s\S]*?)(?=\n## |$)/);
  if (lastSessionMatch) {
    const lines = lastSessionMatch[1].trim().split('\n').filter(l => l.startsWith('- '));
    result.lastSession = lines.map(l => l.replace(/^- /, '').trim()).filter(l => l && !l.startsWith('['));
  }

  const inProgressMatch = content.match(/## In Progress\s*\n([\s\S]*?)(?=\n## |$)/);
  if (inProgressMatch) {
    const lines = inProgressMatch[1].trim().split('\n').filter(l => l.startsWith('- '));
    result.inProgress = lines.map(l => l.replace(/^- /, '').trim()).filter(l => l && !l.startsWith('['));
  }

  const nextMatch = content.match(/## Next\s*\n([\s\S]*?)(?=\n## |$)/);
  if (nextMatch) {
    const lines = nextMatch[1].trim().split('\n').filter(l => l.startsWith('- '));
    result.next = lines.map(l => l.replace(/^- /, '').trim()).filter(l => l && !l.startsWith('['));
  }

  const blockersMatch = content.match(/## Blockers\s*\n([\s\S]*?)(?=\n## |$)/);
  if (blockersMatch) {
    const lines = blockersMatch[1].trim().split('\n').filter(l => l.startsWith('- '));
    result.blockers = lines.map(l => l.replace(/^- /, '').trim()).filter(l => l && l !== 'None');
  }

  return result;
}

/**
 * Get git changes since last session
 */
function getGitChangesSinceSession(lastActiveTimestamp) {
  if (!isGitRepo() || !lastActiveTimestamp) {
    return { commits: 0, commitDetails: [], newBugs: 0, filesChanged: [] };
  }

  try {
    // Use ISO format for git --since (git understands ISO 8601)
    const sinceDate = new Date(lastActiveTimestamp);
    const since = sinceDate.toISOString();

    // Get commits since last session using execFileSync for safety (no shell injection)
    let logOutput = '';
    try {
      logOutput = execFileSync('git', ['log', '--oneline', `--since=${since}`, '--all'], {
        encoding: 'utf-8',
        cwd: PATHS.root,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch {
      // Git command may fail on some systems or if no commits match
    }
    const commits = logOutput ? logOutput.split('\n').filter(Boolean) : [];

    // Get files changed since last session using --since with diff
    // Note: git diff doesn't support --since, so we use git log instead
    let filesChanged = [];
    try {
      const diffOutput = execFileSync('git', ['log', '--name-only', `--since=${since}`, '--format=', '--all'], {
        encoding: 'utf-8',
        cwd: PATHS.root,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      // Deduplicate file list
      filesChanged = [...new Set(diffOutput.split('\n').filter(Boolean))];
    } catch {
      // Git command may fail on some systems
    }

    // Check for new bugs filed
    const bugsDir = PATHS.bugs;
    let newBugs = 0;
    if (fileExists(bugsDir)) {
      const files = fs.readdirSync(bugsDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(bugsDir, file);
        const stat = fs.statSync(filePath);
        if (new Date(stat.mtime) > new Date(lastActiveTimestamp)) {
          newBugs++;
        }
      }
    }

    return {
      commits: commits.length,
      commitDetails: commits.slice(0, 5), // Last 5 commits
      newBugs,
      filesChanged: filesChanged.slice(0, 10) // Limit to 10
    };
  } catch {
    return { commits: 0, commitDetails: [], newBugs: 0, filesChanged: [] };
  }
}

/**
 * Get recommended tasks sorted by priority
 */
function getRecommendedTasks(limit = 3) {
  const data = getReadyData();
  const tasks = [];

  // Add in-progress tasks first (highest priority - resume what you started)
  const inProgress = data.inProgress || [];
  for (const task of inProgress) {
    const t = typeof task === 'object' ? task : { id: task, title: task };
    tasks.push({
      ...t,
      priority: t.priority || 'P0', // In-progress always top priority
      status: 'in_progress',
      recommendation: 'Continue where you left off'
    });
  }

  // Add ready tasks sorted by priority
  const ready = data.ready || [];
  const sortedReady = [...ready].sort((a, b) => {
    const aPriority = typeof a === 'object' ? (a.priority || 'P2') : 'P2';
    const bPriority = typeof b === 'object' ? (b.priority || 'P2') : 'P2';
    const aOrder = PRIORITY_ORDER[aPriority] ?? 2;
    const bOrder = PRIORITY_ORDER[bPriority] ?? 2;
    return aOrder - bOrder;
  });

  for (const task of sortedReady) {
    const t = typeof task === 'object' ? task : { id: task, title: task };
    tasks.push({
      ...t,
      priority: t.priority || 'P2',
      status: 'ready',
      recommendation: null
    });
  }

  return tasks.slice(0, limit);
}

/**
 * Generate a suggested prompt based on current state
 */
function generateSuggestedPrompt(briefingData) {
  const { currentTask, keyContext, recommendedTasks, progress } = briefingData;

  let prompt = '';

  // If there's a task in progress
  if (currentTask) {
    prompt = `Continue implementing ${currentTask.id}${currentTask.title ? `: ${currentTask.title}` : ''}.`;

    if (keyContext && keyContext.length > 0) {
      prompt += '\n\nContext:\n';
      for (const fact of keyContext.slice(0, 3)) {
        prompt += `- ${fact}\n`;
      }
    }

    if (currentTask.files && currentTask.files.length > 0) {
      prompt += '\nFiles to review:\n';
      for (const file of currentTask.files.slice(0, 3)) {
        prompt += `- ${file}\n`;
      }
    }

    if (progress && progress.inProgress && progress.inProgress.length > 0) {
      prompt += '\nCurrent state:\n';
      for (const item of progress.inProgress.slice(0, 2)) {
        prompt += `- ${item}\n`;
      }
    }

    return prompt.trim();
  }

  // No task in progress - suggest starting the top recommended task
  if (recommendedTasks && recommendedTasks.length > 0) {
    const topTask = recommendedTasks[0];
    prompt = `Start working on ${topTask.id}${topTask.title ? `: ${topTask.title}` : ''}.`;

    if (topTask.priority && topTask.priority !== 'P2') {
      prompt += `\n\nPriority: ${topTask.priority}`;
    }

    return prompt.trim();
  }

  // No tasks at all
  return 'No tasks in queue. Create a new task with: flow story "Your task title"';
}

/**
 * Collect all briefing data
 */
function collectBriefingData() {
  const config = getConfig();
  const morningConfig = config.morningBriefing || {};

  const sessionState = getSessionState();
  const progressData = getProgressData();
  const gitStatus = getGitStatus();

  const hoursAgo = getHoursSince(sessionState.lastActive);
  const gitChanges = morningConfig.showChanges !== false
    ? getGitChangesSinceSession(sessionState.lastActive)
    : { commits: 0, commitDetails: [], newBugs: 0, filesChanged: [] };

  // Determine current task - prioritize in-progress tasks from ready.json (source of truth)
  let currentTask = null;
  const readyData = getReadyData();
  const inProgressTasks = readyData.inProgress || [];

  if (inProgressTasks.length > 0) {
    // Use the most recent in-progress task from ready.json (source of truth)
    const task = inProgressTasks[0];
    currentTask = typeof task === 'object' ? { ...task } : { id: task };
    // Merge in session state files if task IDs match
    if (sessionState.currentTask &&
        sessionState.currentTask.id === currentTask.id &&
        sessionState.recentFiles) {
      currentTask.files = sessionState.recentFiles;
    }
  } else if (sessionState.currentTask) {
    // Fallback to session state only if no in-progress tasks in ready.json
    // Note: Stale task cleanup is already done by clearStaleCurrentTaskAsync() at session start
    // This is a simplified check - if session state has a task, use it (should be valid)
    currentTask = typeof sessionState.currentTask === 'object'
      ? sessionState.currentTask
      : { id: sessionState.currentTask };
    currentTask.files = sessionState.recentFiles || [];
  }

  // Get key context
  const keyContext = [];
  if (sessionState.contextSnapshot && sessionState.contextSnapshot.keyFacts) {
    keyContext.push(...sessionState.contextSnapshot.keyFacts);
  }
  if (progressData.keyFacts) {
    keyContext.push(...progressData.keyFacts);
  }
  // Dedupe
  const uniqueContext = [...new Set(keyContext)];

  // Get blockers
  const blockers = [];
  if (sessionState.contextSnapshot && sessionState.contextSnapshot.blockers) {
    blockers.push(...sessionState.contextSnapshot.blockers);
  }
  if (progressData.blockers) {
    blockers.push(...progressData.blockers);
  }
  // Dedupe
  const uniqueBlockers = [...new Set(blockers)];

  // Get recommended tasks
  const maxTasks = morningConfig.showRecommendedTasks || 3;
  const recommendedTasks = getRecommendedTasks(maxTasks);

  const briefing = {
    lastActive: sessionState.lastActive,
    lastActiveFormatted: formatTimestamp(sessionState.lastActive),
    hoursAgo,
    currentTask,
    keyContext: uniqueContext.slice(0, 5),
    blockers: uniqueBlockers,
    changesSinceLastSession: gitChanges,
    recommendedTasks,
    git: gitStatus,
    progress: progressData,
    metrics: sessionState.metrics,
    suggestedPrompt: null // Will be generated if enabled
  };

  // Generate suggested prompt if enabled
  if (morningConfig.generatePrompt !== false) {
    briefing.suggestedPrompt = generateSuggestedPrompt(briefing);
  }

  return briefing;
}

/**
 * Print human-readable briefing
 */
function printBriefing(briefing) {
  const config = getConfig();
  const morningConfig = config.morningBriefing || {};

  printHeader('MORNING BRIEFING');

  // Last active
  if (morningConfig.showLastSession !== false && briefing.lastActive) {
    const hoursStr = briefing.hoursAgo !== null
      ? ` (${briefing.hoursAgo} hours ago)`
      : '';
    console.log(`${color('yellow', 'Last active:')} ${briefing.lastActiveFormatted}${hoursStr}`);
    console.log('');
  }

  // Current task (where you left off)
  if (briefing.currentTask) {
    printSection('WHERE YOU LEFT OFF');
    const task = briefing.currentTask;
    console.log(`  Task: ${color('cyan', task.id)}${task.title ? ` - ${task.title}` : ''}`);
    if (task.progress) {
      console.log(`  Progress: ${task.progress}`);
    }
    console.log(`  Status: ${color('yellow', 'in_progress')}`);
    if (task.files && task.files.length > 0) {
      console.log(`  Files: ${task.files.slice(0, 3).join(', ')}${task.files.length > 3 ? '...' : ''}`);
    }
    console.log('');
  }

  // Key context
  if (morningConfig.showKeyContext !== false && briefing.keyContext.length > 0) {
    printSection('KEY CONTEXT');
    for (const fact of briefing.keyContext) {
      console.log(`  ${color('dim', '\u2022')} ${fact}`);
    }
    console.log('');
  }

  // Blockers
  if (morningConfig.showBlockers !== false && briefing.blockers.length > 0) {
    printSection('BLOCKERS');
    for (const blocker of briefing.blockers) {
      console.log(`  ${color('red', '\u2022')} ${blocker}`);
    }
    console.log('');
  }

  // Knowledge Sync Check
  if (morningConfig.checkKnowledgeSync !== false) {
    try {
      const { checkAllDrift, markAsSynced } = require('./flow-knowledge-sync');
      const driftStatus = checkAllDrift();

      if (driftStatus.anyDrift) {
        printSection('KNOWLEDGE SYNC');

        // Show what drifted
        const driftedCategories = [];
        for (const [category, status] of Object.entries(driftStatus.categories)) {
          if (status.status === 'drifted') {
            console.log(`  ${color('yellow', '\u26a0')} ${category}.md out of sync (${status.reason})`);
            driftedCategories.push(category);
          }
        }

        // Auto-regenerate if enabled
        if (morningConfig.autoRegenerateKnowledge !== false) {
          try {
            const { spawnSync } = require('child_process');
            const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-knowledge-sync.js');
            const result = spawnSync('node', [scriptPath, 'regenerate'], {
              cwd: PROJECT_ROOT,
              stdio: 'pipe',
              timeout: 30000
            });

            if (result.status === 0) {
              markAsSynced();
              console.log(`  ${color('green', '\u2713')} Auto-regenerated knowledge files`);
            } else {
              console.log(`  ${color('yellow', '!')} Could not auto-regenerate`);
              console.log(`    Run: ${color('cyan', 'flow knowledge-sync regenerate')}`);
            }
          } catch (err) {
            console.log(`  ${color('yellow', '!')} Could not auto-regenerate: ${err.message}`);
            console.log(`    Run: ${color('cyan', 'flow knowledge-sync regenerate')}`);
          }
        } else {
          console.log(`  ${color('dim', 'Run:')} ${color('cyan', 'flow knowledge-sync regenerate')}`);
        }

        console.log('');
      }
    } catch {
      // Knowledge sync not available - skip silently
    }
  }

  // Technical Debt Summary
  if (morningConfig.showTechDebt !== false) {
    try {
      const { TechDebtManager } = require('./flow-tech-debt');
      const debtManager = new TechDebtManager();
      const stats = debtManager.getStats();

      if (stats.totalOpen > 0) {
        printSection('TECHNICAL DEBT');

        // Summary line
        const severityParts = [];
        if (stats.bySeverity.critical > 0) severityParts.push(color('red', `${stats.bySeverity.critical} critical`));
        if (stats.bySeverity.high > 0) severityParts.push(color('yellow', `${stats.bySeverity.high} high`));
        if (stats.bySeverity.medium > 0) severityParts.push(color('blue', `${stats.bySeverity.medium} medium`));
        if (stats.bySeverity.low > 0) severityParts.push(color('dim', `${stats.bySeverity.low} low`));

        console.log(`  Open issues: ${stats.totalOpen} (${severityParts.join(', ')})`);

        // Aging warning
        if (stats.agingCount > 0) {
          console.log(`  ${color('yellow', '\u26a0')} ${stats.agingCount} item${stats.agingCount !== 1 ? 's' : ''} aging (seen 3+ sessions)`);

          // Auto-promote aging items to tasks
          const promoted = debtManager.promoteAgingToTasks();
          if (promoted.length > 0) {
            console.log(`  ${color('green', '\u2713')} ${promoted.length} aging item${promoted.length !== 1 ? 's' : ''} added to task queue`);
          }
        }

        // Auto-fixable hint
        if (stats.autoFixable > 0) {
          console.log(`  ${color('green', '\u2713')} ${stats.autoFixable} auto-fixable - run ${color('cyan', '/wogi-debt fix')}`);
        }

        console.log('');
      }
    } catch {
      // Tech debt manager not available - skip silently
    }
  }

  // Changes since last session
  if (morningConfig.showChanges !== false) {
    const changes = briefing.changesSinceLastSession;
    if (changes.commits > 0 || changes.newBugs > 0) {
      printSection('CHANGES SINCE LAST SESSION');
      if (changes.commits > 0) {
        console.log(`  ${color('cyan', '\u2022')} ${changes.commits} new commit${changes.commits !== 1 ? 's' : ''}`);
        for (const commit of changes.commitDetails.slice(0, 3)) {
          console.log(`    ${color('dim', commit)}`);
        }
      }
      if (changes.newBugs > 0) {
        console.log(`  ${color('yellow', '\u2022')} ${changes.newBugs} new bug${changes.newBugs !== 1 ? 's' : ''} filed`);
      }
      console.log('');
    }
  }

  // Recommended tasks
  if (briefing.recommendedTasks.length > 0) {
    printSection('RECOMMENDED NEXT');
    for (let i = 0; i < briefing.recommendedTasks.length; i++) {
      const task = briefing.recommendedTasks[i];
      const priority = task.priority || 'P2';
      const priorityColor = priority === 'P0' ? 'red' : priority === 'P1' ? 'yellow' : 'dim';
      const status = task.status === 'in_progress' ? color('yellow', ' (in progress)') : '';
      console.log(`  ${i + 1}. ${color(priorityColor, `[${priority}]`)} ${task.id}: ${task.title || 'No title'}${status}`);
      if (task.recommendation) {
        console.log(`     ${color('dim', task.recommendation)}`);
      }
    }
    console.log('');
  }

  // Git status
  if (briefing.git.isRepo && briefing.git.uncommitted > 0) {
    printSection('GIT STATUS');
    console.log(`  ${color('yellow', '\u26a0')} ${briefing.git.uncommitted} uncommitted file${briefing.git.uncommitted !== 1 ? 's' : ''}`);
    console.log('');
  }

  // Suggested prompt
  if (morningConfig.generatePrompt !== false && briefing.suggestedPrompt) {
    printSection('SUGGESTED PROMPT');
    console.log(color('dim', '  \u2500'.repeat(40)));
    const lines = briefing.suggestedPrompt.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log(color('dim', '  \u2500'.repeat(40)));
    console.log('');
  }

  console.log(color('cyan', '\u2550'.repeat(50)));
}

/**
 * Main function
 */
function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  // Check if morning briefing is enabled
  const config = getConfig();
  const morningConfig = config.morningBriefing || {};

  if (morningConfig.enabled === false) {
    if (flags.json) {
      outputJson({
        success: false,
        error: 'Morning briefing is disabled in config',
        hint: 'Set morningBriefing.enabled: true in .workflow/config.json'
      });
    }
    console.log(color('yellow', 'Morning briefing is disabled.'));
    console.log(color('dim', 'Enable it in .workflow/config.json: morningBriefing.enabled: true'));
    process.exit(0);
  }

  // v2.6.1: Clean up stale state before briefing (safety net)
  // Morning briefing also cleans up stale auto-created tasks older than 24h
  const cleanedState = cleanupStaleState({ cleanupStaleTasks: true });
  if (cleanedState.length > 0 && !flags.json) {
    console.log(color('dim', `  (Cleaned stale state: ${cleanedState.join(', ')})`));
    console.log('');
  }

  // Collect briefing data
  const briefing = collectBriefingData();

  // JSON output
  if (flags.json) {
    outputJson({
      success: true,
      briefing
    });
    // outputJson exits
  }

  // Human-readable output
  printBriefing(briefing);
}

// Run
if (require.main === module) {
  main();
}

module.exports = {
  collectBriefingData,
  getSessionState,
  getProgressData,
  getGitChangesSinceSession,
  getRecommendedTasks,
  generateSuggestedPrompt
};
