#!/usr/bin/env node

/**
 * Wogi Flow - Session Context (Core Module)
 *
 * CLI-agnostic session context gathering.
 * Gathers context to inject at session start.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');
const fs = require('fs');

// Import from parent scripts directory
const { getConfig, PATHS, getReadyData, safeJsonParse } = require('../../flow-utils');
const setupCheck = require('./setup-check');
const { findParallelizable, getParallelConfig } = require('../../flow-parallel');

/**
 * Check if session context is enabled
 * @returns {boolean}
 */
function isSessionContextEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.sessionContext?.enabled !== false;
}

/**
 * Get suspended task info
 * @returns {Object|null} Suspended task info or null
 */
function getSuspendedTask() {
  const suspensionPath = path.join(PATHS.state, 'suspension.json');
  if (!fs.existsSync(suspensionPath)) {
    return null;
  }

  const suspension = safeJsonParse(suspensionPath, null);
  if (!suspension || !suspension.taskId || suspension.status === 'resumed') {
    return null;
  }

  return suspension;
}

/**
 * Get current task in progress
 * @returns {Object|null} Current task or null
 */
function getCurrentTask() {
  try {
    const readyData = getReadyData();
    if (readyData.inProgress && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      return typeof task === 'string' ? { id: task } : task;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Get pending task summary (always shown, not just for parallel)
 * Ensures task queue awareness survives context compaction
 * @returns {Object|null} Task queue summary
 */
function getPendingTaskSummary() {
  try {
    const readyData = getReadyData();
    const ready = readyData.ready || [];
    const inProgress = readyData.inProgress || [];
    const blocked = readyData.blocked || [];

    return {
      readyCount: ready.length,
      inProgressCount: inProgress.length,
      blockedCount: blocked.length,
      readyTaskIds: ready.slice(0, 10).map(t => typeof t === 'object' ? t.id : t),
      inProgressTaskIds: inProgress.map(t => typeof t === 'object' ? t.id : t)
    };
  } catch (err) {
    return null;
  }
}

/**
 * Get key decisions from decisions.md
 * @param {number} maxEntries - Max number of decisions to return
 * @returns {Array} Key decisions
 */
function getKeyDecisions(maxEntries = 5) {
  if (!fs.existsSync(PATHS.decisions)) {
    return [];
  }

  try {
    // Wrap in try-catch per security-patterns.md Rule #1
    // Race conditions/permission changes can cause fs.readFileSync to fail even after existsSync
    const content = fs.readFileSync(PATHS.decisions, 'utf-8');
    const decisions = [];

    // Parse markdown sections
    const sections = content.split(/^##\s+/m).slice(1);

    for (const section of sections.slice(0, maxEntries)) {
      const lines = section.split('\n');
      const title = lines[0].trim();
      const body = lines.slice(1).join('\n').trim();

      if (title && body) {
        decisions.push({
          title,
          summary: body.split('\n')[0].substring(0, 150)
        });
      }
    }

    return decisions;
  } catch (err) {
    return [];
  }
}

/**
 * Get recent activity from request log
 * @param {number} maxEntries - Max entries to return
 * @returns {Array} Recent activity
 */
function getRecentActivity(maxEntries = 3) {
  if (!fs.existsSync(PATHS.requestLog)) {
    return [];
  }

  try {
    // Wrap in try-catch per security-patterns.md Rule #1
    // Race conditions/permission changes can cause fs.readFileSync to fail even after existsSync
    const content = fs.readFileSync(PATHS.requestLog, 'utf-8');
    const entries = [];

    // Split-then-parse pattern to avoid ReDoS risk (safer than [\s\S]*? regex)
    // Split by section headers first, then parse each section
    const sections = content.split(/^###\s+R-/m).slice(1); // Remove empty first element

    for (const section of sections) {
      if (entries.length >= maxEntries) break;

      // Parse section header: "XXX | 2026-01-21..."
      const headerMatch = section.match(/^(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})/);
      if (!headerMatch) continue;

      const id = `R-${headerMatch[1]}`;

      // Extract request line
      const requestMatch = section.match(/\*\*Request\*\*:\s*"?([^"\n]+)"?/);
      const request = requestMatch ? requestMatch[1] : 'Unknown';

      entries.push({ id, request });
    }

    return entries.reverse(); // Most recent first
  } catch (err) {
    return [];
  }
}

/**
 * Get session state summary
 * @returns {Object|null} Session state or null
 */
function getSessionState() {
  const sessionPath = path.join(PATHS.state, 'session-state.json');
  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  const state = safeJsonParse(sessionPath, null);
  if (!state) {
    return null;
  }

  return {
    lastActive: state.lastActive,
    recentFiles: (state.recentFiles || []).slice(0, 5),
    recentDecisions: (state.recentDecisions || []).slice(0, 3)
  };
}

/**
 * Gather all session context
 * @param {Object} options
 * @param {boolean} options.includeSuspended - Include suspended task info
 * @param {boolean} options.includeDecisions - Include key decisions
 * @param {boolean} options.includeActivity - Include recent activity
 * @returns {Object} Session context
 */
function gatherSessionContext(options = {}) {
  const config = getConfig();
  const hookConfig = config.hooks?.rules?.sessionContext || {};

  const {
    includeSuspended = hookConfig.loadSuspendedTasks !== false,
    includeDecisions = hookConfig.loadDecisions !== false,
    includeActivity = hookConfig.loadRecentActivity !== false
  } = options;

  if (!isSessionContextEnabled()) {
    return {
      enabled: false,
      context: null
    };
  }

  const context = {
    timestamp: new Date().toISOString(),
    projectName: config.projectName || path.basename(PATHS.root)
  };

  // Suspended task
  if (includeSuspended) {
    const suspended = getSuspendedTask();
    if (suspended) {
      context.suspendedTask = {
        taskId: suspended.taskId,
        reason: suspended.reason,
        resumeCondition: suspended.resumeCondition,
        suspendedAt: suspended.suspendedAt
      };
    }
  }

  // Current task
  const currentTask = getCurrentTask();
  if (currentTask) {
    context.currentTask = currentTask;
  }

  // Key decisions
  if (includeDecisions) {
    context.keyDecisions = getKeyDecisions(5);
  }

  // Recent activity
  if (includeActivity) {
    context.recentActivity = getRecentActivity(3);
  }

  // Session state
  const sessionState = getSessionState();
  if (sessionState) {
    context.sessionState = sessionState;
  }

  // Setup check - high priority if setup is needed
  const setupContext = setupCheck.getSetupContext();
  if (setupContext && setupContext.needsSetup) {
    context.setupRequired = setupContext;
  }

  // Pending task summary (always include - survives compaction)
  const pendingTasks = getPendingTaskSummary();
  if (pendingTasks && (pendingTasks.readyCount > 0 || pendingTasks.inProgressCount > 0)) {
    context.pendingTasks = pendingTasks;
  }

  // Parallel execution detection
  try {
    const parallelConfig = getParallelConfig();
    if (parallelConfig.enabled && parallelConfig.autoSuggest) {
      const readyData = getReadyData();
      const readyTasks = readyData.ready || [];
      if (readyTasks.length >= 2) {
        const parallelizable = findParallelizable(readyTasks);
        if (parallelizable.length >= 2) {
          context.parallelExecution = {
            available: true,
            count: parallelizable.length,
            taskIds: parallelizable.map(t => t.id || t),
            worktreeEnabled: config.worktree?.enabled || false
          };
        }
      }
    }
  } catch (err) {
    // Non-critical - don't fail session start, but log for debugging
    if (process.env.DEBUG) {
      console.error(`[session-context] Parallel detection failed: ${err.message}`);
    }
  }

  return {
    enabled: true,
    context
  };
}

/**
 * Format context for injection into a session
 * @param {Object} context - Context from gatherSessionContext
 * @returns {string} Formatted context string
 */
function formatContextForInjection(context) {
  if (!context || !context.context) {
    return '';
  }

  const ctx = context.context;
  let output = '## Wogi Flow Session Context\n\n';

  // PRIORITY: Setup required - show first if needs setup
  if (ctx.setupRequired && ctx.setupRequired.needsSetup) {
    output += `### ⚠️ Setup Required\n`;
    output += `WogiFlow needs initial configuration.\n`;
    if (ctx.setupRequired.projectName) {
      output += `Detected project: **${ctx.setupRequired.projectName}**\n`;
    }
    output += `\nRun \`/wogi-init\` or say "setup wogiflow" to configure.\n\n`;
  }

  // Suspended task alert
  if (ctx.suspendedTask) {
    output += `### Suspended Task\n`;
    output += `Task **${ctx.suspendedTask.taskId}** is suspended.\n`;
    output += `- Reason: ${ctx.suspendedTask.reason || 'Not specified'}\n`;
    if (ctx.suspendedTask.resumeCondition) {
      output += `- Resume condition: ${ctx.suspendedTask.resumeCondition}\n`;
    }
    output += `\nRun \`/wogi-resume\` to continue.\n\n`;
  }

  // Current task
  if (ctx.currentTask) {
    output += `### Current Task\n`;
    output += `Working on: **${ctx.currentTask.id}**\n`;
    if (ctx.currentTask.title) {
      output += `Title: ${ctx.currentTask.title}\n`;
    }
    output += '\n';
  }

  // Pending work summary (always show if tasks exist - survives compaction)
  if (ctx.pendingTasks) {
    const p = ctx.pendingTasks;
    if (p.readyCount > 0 || p.inProgressCount > 0 || p.blockedCount > 0) {
      output += `### 📋 Pending Work\n`;
      if (p.inProgressCount > 0) {
        output += `- **In Progress**: ${p.inProgressCount} task(s) - ${p.inProgressTaskIds.join(', ')}\n`;
      }
      if (p.readyCount > 0) {
        output += `- **Ready**: ${p.readyCount} task(s)`;
        if (p.readyCount <= 5) {
          output += ` - ${p.readyTaskIds.join(', ')}`;
        }
        output += `\n`;
      }
      if (p.blockedCount > 0) {
        output += `- **Blocked**: ${p.blockedCount} task(s)\n`;
      }
      output += `\nRun \`/wogi-ready\` for full task list.\n\n`;
    }
  }

  // Parallel execution available
  if (ctx.parallelExecution && ctx.parallelExecution.available) {
    output += `### ⚡ Parallel Execution Available\n`;
    output += `**${ctx.parallelExecution.count} tasks** can run in parallel (no dependencies).\n`;
    output += `Tasks: ${ctx.parallelExecution.taskIds.join(', ')}\n`;
    if (ctx.parallelExecution.worktreeEnabled) {
      output += `Worktree isolation: ✓ enabled\n`;
    } else {
      output += `Worktree isolation: ⚠️ disabled (enable for safe parallel execution)\n`;
    }
    output += `\nConsider running these tasks in parallel for faster completion.\n\n`;
  }

  // Key decisions
  if (ctx.keyDecisions && ctx.keyDecisions.length > 0) {
    output += `### Key Decisions\n`;
    for (const decision of ctx.keyDecisions) {
      output += `- **${decision.title}**: ${decision.summary}\n`;
    }
    output += '\n';
  }

  // Recent activity
  if (ctx.recentActivity && ctx.recentActivity.length > 0) {
    output += `### Recent Activity\n`;
    for (const activity of ctx.recentActivity) {
      output += `- ${activity.id}: ${activity.request}\n`;
    }
    output += '\n';
  }

  return output;
}

module.exports = {
  isSessionContextEnabled,
  getSuspendedTask,
  getCurrentTask,
  getPendingTaskSummary,
  getKeyDecisions,
  getRecentActivity,
  getSessionState,
  gatherSessionContext,
  formatContextForInjection
};
