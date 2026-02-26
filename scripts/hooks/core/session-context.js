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
const { getBypassTracking } = require('../../flow-session-state');

/**
 * Detect if Claude Code is running in SIMPLE mode.
 * SIMPLE mode (CLAUDE_CODE_SIMPLE=true) disables hooks, MCP, and CLAUDE.md.
 * When detected, WogiFlow enforcement is silently broken.
 *
 * @returns {{ isSimpleMode: boolean, envValue: string|undefined }}
 */
function detectSimpleMode() {
  const envValue = process.env.CLAUDE_CODE_SIMPLE;
  const isSimpleMode = envValue === 'true' || envValue === '1';
  return { isSimpleMode, envValue };
}

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
 * @param {Object} [readyData] - Pre-loaded ready.json data (avoids duplicate file read)
 * @returns {Object|null} Current task or null
 */
function getCurrentTask(readyData) {
  try {
    const data = readyData || getReadyData();
    if (data.inProgress && data.inProgress.length > 0) {
      const task = data.inProgress[0];
      return typeof task === 'string' ? { id: task } : task;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get pending task summary (always shown, not just for parallel)
 * Ensures task queue awareness survives context compaction
 * @param {Object} [readyData] - Pre-loaded ready.json data (avoids duplicate file read)
 * @returns {Object|null} Task queue summary
 */
function getPendingTaskSummary(readyData) {
  try {
    const data = readyData || getReadyData();
    const ready = data.ready || [];
    const inProgress = data.inProgress || [];
    const blocked = data.blocked || [];

    return {
      readyCount: ready.length,
      inProgressCount: inProgress.length,
      blockedCount: blocked.length,
      readyTaskIds: ready.slice(0, 10).map(t => typeof t === 'object' ? t.id : t),
      inProgressTaskIds: inProgress.map(t => typeof t === 'object' ? t.id : t)
    };
  } catch {
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
  } catch {
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
    // Only read the tail of the file to avoid unbounded memory usage on large logs
    const fd = fs.openSync(PATHS.requestLog, 'r');
    const stat = fs.fstatSync(fd);
    const TAIL_BYTES = 8192; // 8KB tail is enough for ~20 recent entries
    const readStart = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    fs.readSync(fd, buf, 0, buf.length, readStart);
    fs.closeSync(fd);
    const content = buf.toString('utf-8');
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
  } catch {
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
async function gatherSessionContext(options = {}) {
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

  // Cache readyData once to avoid triple file read (getCurrentTask + getPendingTaskSummary + parallel check)
  let readyData;
  try {
    readyData = getReadyData();
  } catch {
    readyData = { ready: [], inProgress: [], blocked: [] };
  }

  // Current task
  const currentTask = getCurrentTask(readyData);
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
  const pendingTasks = getPendingTaskSummary(readyData);
  if (pendingTasks && (pendingTasks.readyCount > 0 || pendingTasks.inProgressCount > 0)) {
    context.pendingTasks = pendingTasks;
  }

  // Parallel execution detection (uses cached readyData — no extra file read)
  try {
    const parallelConfig = getParallelConfig();
    if (parallelConfig.enabled) {
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

  // Rejected approach warnings (surface past failed approaches for current task)
  try {
    const currentTaskId = context.currentTask?.id;
    if (currentTaskId) {
      const memoryDb = require('../../flow-memory-db');
      const rejected = await memoryDb.searchRejectedObservations({ taskId: currentTaskId, limit: 10 });
      if (rejected.length > 0) {
        context.rejectedApproaches = rejected.map(r => ({
          toolName: r.toolName,
          inputSummary: r.inputSummary,
          rejectionReason: r.rejectionReason,
          timestamp: r.timestamp
        }));
      }
    }
  } catch (err) {
    // Non-critical - memory DB may not be initialized
    if (process.env.DEBUG) {
      console.error(`[session-context] Rejected approach lookup failed: ${err.message}`);
    }
  }

  // Completed skill invocations (prevents re-execution after context compaction)
  // Claude Code re-injects "The following skills were invoked in this session" with
  // original ARGUMENTS, which can cause the AI to re-execute completed one-time actions
  // like /wogi-review. This counter-instruction tells the AI not to re-run them.
  try {
    const lastReviewPath = path.join(PATHS.state, 'last-review.json');
    if (fs.existsSync(lastReviewPath)) {
      const lastReview = safeJsonParse(lastReviewPath, null);
      if (lastReview && lastReview.reviewDate) {
        context.completedSkills = context.completedSkills || [];
        context.completedSkills.push({
          skill: 'wogi-review',
          completedAt: lastReview.reviewDate
          // NOTE: scope intentionally omitted — including it causes stale ARGUMENTS
          // to leak into new invocations (see wf-cr-7f42a1 bug fix)
        });
      }
    }
  } catch {
    // Non-critical
  }

  // Bypass tracking (enforcement reminders)
  // Only include if warnOnBypass is enabled and there were previous bypasses
  if (config.enforcement?.warnOnBypass !== false) {
    try {
      const bypassTracking = getBypassTracking();
      if (bypassTracking && bypassTracking.count > 0) {
        context.bypassReminder = {
          count: bypassTracking.count,
          autoCreatedTasks: bypassTracking.autoCreatedTasks || [],
          recentAttempts: (bypassTracking.attempts || []).slice(-3)
        };
      }
    } catch (err) {
      // Non-critical - don't fail session start
      if (process.env.DEBUG) {
        console.error(`[session-context] Bypass tracking failed: ${err.message}`);
      }
    }
  }

  // CLAUDE_CODE_SIMPLE mode detection (Claude Code 2.1.50+)
  // When SIMPLE mode is active, hooks/MCP/CLAUDE.md are disabled.
  // This warning only fires if the hook somehow still runs (e.g., during transition).
  const simpleMode = detectSimpleMode();
  if (simpleMode.isSimpleMode) {
    context.simpleModeWarning = {
      active: true,
      envValue: simpleMode.envValue
    };
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

  // CRITICAL: CLAUDE_CODE_SIMPLE mode warning (highest priority)
  if (ctx.simpleModeWarning && ctx.simpleModeWarning.active) {
    output += `### CLAUDE_CODE_SIMPLE Mode Detected\n`;
    output += `**WogiFlow enforcement is DISABLED.** CLAUDE_CODE_SIMPLE=true disables hooks, MCP, and CLAUDE.md.\n`;
    output += `All WogiFlow rules, task gating, scope gating, and validation are inactive.\n\n`;
    output += `To restore full workflow enforcement:\n`;
    output += `\`\`\`bash\nunset CLAUDE_CODE_SIMPLE\n\`\`\`\n\n`;
  }

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

  // Rejected approach warnings
  if (ctx.rejectedApproaches && ctx.rejectedApproaches.length > 0) {
    output += `### ⚠️ Previously Rejected Approaches\n`;
    output += `The following approaches were tried and failed for this task. **Do not retry these:**\n\n`;
    for (const r of ctx.rejectedApproaches) {
      output += `- **${r.toolName}**: ${r.inputSummary || 'unknown action'}\n`;
      if (r.rejectionReason) {
        output += `  Reason: ${r.rejectionReason}\n`;
      }
    }
    output += '\n';
  }

  // Completed skills warning (prevents re-execution from stale system-reminders)
  if (ctx.completedSkills && ctx.completedSkills.length > 0) {
    output += `### Completed Skills (DO NOT Re-Execute)\n`;
    output += `The following skills have ALREADY been completed. Claude Code may show them in `;
    output += `"skills invoked in this session" with old ARGUMENTS — those are stale references. `;
    output += `**Do NOT re-execute these skills unless the user explicitly asks again.**\n\n`;
    for (const s of ctx.completedSkills) {
      output += `- **/${s.skill}**: Completed at ${s.completedAt}\n`;
    }
    output += '\n';
    // STALE ARGUMENTS WARNING — prevents old scope from influencing new invocations
    output += `**CRITICAL — Stale ARGUMENTS Warning:**\n`;
    output += `Claude Code's system-reminders may show ARGUMENTS from PREVIOUS skill invocations. `;
    output += `These ARGUMENTS are stale and MUST be ignored. When a user invokes a skill again, `;
    output += `use ONLY the user's current message and any new args passed via the Skill tool. `;
    output += `Never inherit scope, file lists, or commit ranges from stale ARGUMENTS.\n\n`;
  }

  // Bypass reminder (enforcement)
  if (ctx.bypassReminder && ctx.bypassReminder.count > 0) {
    output += `### ⚠️ Workflow Bypass Reminder\n`;
    output += `**${ctx.bypassReminder.count} bypass attempt(s)** detected in this session.\n`;

    if (ctx.bypassReminder.autoCreatedTasks && ctx.bypassReminder.autoCreatedTasks.length > 0) {
      output += `Auto-created tasks: ${ctx.bypassReminder.autoCreatedTasks.join(', ')}\n`;
    }

    output += `\n**Remember:** Always use \`/wogi-start\` before making changes.\n`;
    output += `The user installed WogiFlow to track all work - bypassing breaks their trust.\n\n`;
  }

  // Community knowledge (pulled from server)
  if (ctx.communityKnowledge && typeof ctx.communityKnowledge === 'object') {
    const ck = ctx.communityKnowledge;
    const items = [];

    // Model intelligence
    if (Array.isArray(ck.modelIntelligence)) {
      for (const item of ck.modelIntelligence.slice(0, 5)) {
        if (item.model && (item.strengths || item.adjustments)) {
          const detail = item.adjustments || item.strengths;
          items.push(`Community: ${item.model} — ${detail}`);
        }
      }
    }

    // Error strategies
    if (Array.isArray(ck.errorStrategies)) {
      for (const item of ck.errorStrategies.slice(0, 3)) {
        if (item.category && item.strategy) {
          items.push(`Community: ${item.category} — ${item.strategy}`);
        }
      }
    }

    // Patterns
    if (Array.isArray(ck.patterns)) {
      for (const item of ck.patterns.slice(0, 3)) {
        if (item.description) {
          items.push(`Community: ${item.description}`);
        }
      }
    }

    if (items.length > 0) {
      output += `### Community Knowledge\n`;
      for (const item of items) {
        output += `- ${item}\n`;
      }
      output += '\n';
    }
  }

  return output;
}

module.exports = {
  isSessionContextEnabled,
  detectSimpleMode,
  getSuspendedTask,
  getCurrentTask,
  getPendingTaskSummary,
  getKeyDecisions,
  getRecentActivity,
  getSessionState,
  gatherSessionContext,
  formatContextForInjection
};
