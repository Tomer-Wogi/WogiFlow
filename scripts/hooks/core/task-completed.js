#!/usr/bin/env node

/**
 * Wogi Flow - Task Completed (Core Module)
 *
 * CLI-agnostic task completion logic.
 * Called when a sub-agent task finishes (Claude Code 2.1.33+ TaskCompleted event).
 *
 * Handles:
 * - Moving completed tasks from inProgress to recentlyCompleted in ready.json
 * - Logging completion to request-log.md
 * - Updating durable-history.json
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('node:path');
const fs = require('node:fs');

// Import from parent scripts directory
const { getConfig, PATHS, safeJsonParse, writeJson, withLock, validateTaskId, archiveCompletedTasksToLog } = require('../../flow-utils');
const { resetPhase, isPhaseGateEnabled } = require('./phase-gate');
const { clearOnTaskComplete } = require('../../flow-hook-status');
const { checkGateLatch, clearGateLatch } = require('../../flow-gate-latch');

// Deploy gate (v3.0 — mechanical enforcement gates)
let deployGateModule = null;
try {
  deployGateModule = require('./deploy-gate');
} catch (_err) {
  // Deploy gate not available — skip
}

/**
 * Check if task completed handling is enabled
 * @returns {boolean}
 */
function isTaskCompletedEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.taskCompleted?.enabled !== false;
}

/**
 * Handle task completion event
 * @param {Object} input - Parsed hook input
 * @returns {Object} Core result
 */
async function handleTaskCompleted(input) {
  if (!isTaskCompletedEnabled()) {
    return { enabled: false, message: 'Task completed handling is disabled' };
  }

  const result = {
    enabled: true,
    completed: false,
    taskId: null,
    message: null
  };

  try {
    // Read-modify-write ready.json under lock to prevent concurrent corruption
    const readyPath = path.join(PATHS.state, 'ready.json');
    // completedTask is set inside the lock callback and read after — intentional closure sharing
    let completedTask;

    await withLock(readyPath, async () => {
      const ready = safeJsonParse(readyPath, {
        inProgress: [],
        ready: [],
        recentlyCompleted: [],
        blocked: [],
        backlog: []
      });

      // Check if there's a task in progress
      if (!ready.inProgress || ready.inProgress.length === 0) {
        result.message = 'No tasks in progress';
        return;
      }

      // Try to match a specific task from input (supports parallel execution),
      // fall back to inProgress[0] when no identifying info is available
      const rawTaskId = input.taskId || input.toolInput?.taskId;
      const inputTaskId = rawTaskId && validateTaskId(rawTaskId).valid ? rawTaskId : null;
      if (inputTaskId) {
        completedTask = ready.inProgress.find(t => t.id === inputTaskId);
      }
      if (!completedTask) {
        completedTask = ready.inProgress[0];
      }

      // Normalize string entries to objects (prevents .id on string returning undefined)
      if (typeof completedTask === 'string') {
        completedTask = { id: completedTask, title: completedTask, type: 'unknown' };
      }
      if (!completedTask || !completedTask.id) {
        result.message = 'Could not identify completed task (invalid entry in inProgress)';
        return;
      }
      result.taskId = completedTask.id;

      // Gate latch check — verify quality gates have passed before allowing completion.
      // Without this, agents can call TaskUpdate and bypass all quality gates.
      // The latch is written by flow-done.js after gates pass.
      const config = getConfig();
      const requireGateLatch = config.enforcement?.requireGateLatch !== false;
      if (requireGateLatch) {
        const latchResult = checkGateLatch(completedTask.id);
        if (!latchResult.valid) {
          result.message = `BLOCKED: ${latchResult.reason} ` +
            'Quality gates must pass before a task can be completed. ' +
            'Run the full /wogi-start pipeline (Step 4: Quality Gates) or `flow done` first.';
          result.gateBlocked = true;
          return;
        }
      }

      // Deploy gate: P0/P1 verification check (v3.0)
      if (deployGateModule) {
        try {
          const deployCheck = deployGateModule.checkCompletionGate(completedTask, config);
          if (deployCheck.blocked) {
            result.message = `BLOCKED: ${deployCheck.reason}`;
            result.gateBlocked = true;
            return;
          }
        } catch (err) {
          // Fail-open: deploy gate errors should not block completion
          if (process.env.DEBUG) {
            console.error(`[Task Completed] Deploy gate error (fail-open): ${err.message}`);
          }
        }
      }

      // Move task to recentlyCompleted
      completedTask.status = 'completed';
      completedTask.completedAt = new Date().toISOString();

      // Strip progress prefix from title (e.g., "[3/5] Title" → "Title")
      // Done inside the lock to avoid race conditions with progress tracker
      if (completedTask.title) {
        completedTask.title = completedTask.title.replace(/^\[\d+\/\d+\]\s*/, '');
      }

      // Remove from inProgress
      ready.inProgress = ready.inProgress.filter(t =>
        (typeof t === 'string' ? t : t.id) !== completedTask.id
      );

      // Add to recentlyCompleted (at the beginning)
      if (!ready.recentlyCompleted) {
        ready.recentlyCompleted = [];
      }
      ready.recentlyCompleted.unshift(completedTask);

      // Keep recentlyCompleted trimmed to last 10, archive overflow
      if (ready.recentlyCompleted.length > 10) {
        const overflow = ready.recentlyCompleted.slice(10);
        archiveCompletedTasksToLog(overflow);
        ready.recentlyCompleted = ready.recentlyCompleted.slice(0, 10);
      }

      // Update timestamp
      ready.lastUpdated = new Date().toISOString();

      // Write back (atomic via writeJson)
      try {
        writeJson(readyPath, ready);
        result.completed = true;
        result.message = `Task ${completedTask.id} (${completedTask.title}) moved to completed`;
      } catch (_err) {
        result.message = 'Failed to update ready.json';
      }
    });

    // Early return if no task was found (set inside lock callback)
    if (!completedTask || !completedTask.id) {
      return result;
    }

    // Reset workflow phase to idle on task completion
    if (result.completed && isPhaseGateEnabled()) {
      try {
        resetPhase();
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Phase reset failed: ${err.message}`);
        }
      }
    }

    // Clear hook status on task completion (single aggregated state file)
    if (result.completed) {
      try {
        clearOnTaskComplete();
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Hook status clear failed: ${err.message}`);
        }
      }
    }

    // Clear gate latch after successful completion
    if (result.completed) {
      try {
        clearGateLatch();
      } catch (_err) {
        // Non-critical
      }
    }

    // F6: Clear enforcement gate state on task completion
    if (result.completed && completedTask?.id) {
      try {
        const { clearStrikes } = require('./strike-gate');
        clearStrikes(completedTask.id);
      } catch (_err) { /* Non-critical */ }
      try {
        const { clearScopeState } = require('./bugfix-scope-gate');
        clearScopeState(completedTask.id);
      } catch (_err) { /* Non-critical */ }
      try {
        const { clearState } = require('./scope-mutation-gate');
        clearState();
      } catch (_err) { /* Non-critical */ }
    }

    // Clear progress tracker state on task completion
    if (result.completed) {
      try {
        const { clearProgress } = require('../../flow-progress-tracker');
        clearProgress();
      } catch (err) {
        // Non-fatal — progress tracker may not exist in older installs
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Progress clear failed: ${err.message}`);
        }
      }
    }

    // Update durable history if it exists (under lock to prevent concurrent corruption)
    if (result.completed) {
      try {
        const historyPath = path.join(PATHS.state, 'durable-history.json');
        if (fs.existsSync(historyPath)) {
          await withLock(historyPath, async () => {
            const history = safeJsonParse(historyPath, { completions: [] });
            if (!history.completions) {
              history.completions = [];
            }
            history.completions.push({
              taskId: completedTask.id,
              title: completedTask.title,
              completedAt: completedTask.completedAt,
              type: completedTask.type,
              feature: completedTask.feature
            });
            writeJson(historyPath, history);
          });
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] History write failed: ${err.message}`);
        }
      }
    }

    // Record task performance stats (fire-and-forget)
    try {
      const { recordTaskCompletion } = require('../../flow-stats-collector');
      const statsRecord = {
        taskId: completedTask.id,
        model: input.model || process.env.CLAUDE_MODEL || 'unknown',
        taskType: completedTask.type || 'unknown',
        iterations: input.iterations || 1,
        firstAttemptPass: input.firstAttemptPass !== false,
        tokenEstimate: input.tokenEstimate || 0,
        wallClockMs: input.wallClockMs || 0,
        qualityGateResults: input.qualityGateResults || [],
        changedFiles: input.changedFiles || [],
        scenarioCount: input.scenarioCount || 0
      };
      recordTaskCompletion(statsRecord).catch((err) => {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Stats recording failed: ${err.message}`);
        }
      });
    } catch (_err) {
      // Non-critical - stats collector may not be available
    }

    // Clear task checkpoint after completion (fire-and-forget)
    try {
      const { clearCheckpoint } = require('../../flow-task-checkpoint');
      clearCheckpoint(completedTask.id);
    } catch (_err) {
      // Non-critical - checkpoint may not exist
    }

    // Mark all non-rejected observations for this task as committed (fire-and-forget)
    try {
      const memoryDb = require('../../flow-memory-db');
      memoryDb.markTaskObservationsCommitted(completedTask.id).catch(() => {
        // Non-critical - silently ignore DB errors
      });
    } catch (_err) {
      // Non-critical - memory DB may not be available
    }

    // Memory pipeline: remember task completion decisions (fire-and-forget)
    try {
      const memoryDb = require('../../flow-memory-db');
      const decisions = input.decisions || input.summary || completedTask.title || '';
      memoryDb.rememberCompletion(
        completedTask.id,
        completedTask.title || '',
        typeof decisions === 'string' ? decisions : JSON.stringify(decisions)
      ).catch(() => {
        // Non-critical - memory pipeline may not be available
      });
    } catch (_err) {
      // Non-critical - memory DB may not be available
    }

    // Generate completion summary (fire-and-forget)
    if (result.completed) {
      try {
        const { generateCompletionSummary } = require('../../flow-task-completion-summary');
        const summaryResult = generateCompletionSummary(completedTask, input);
        if (process.env.DEBUG && !summaryResult.success) {
          console.error(`[Task Completed] Summary generation: ${summaryResult.reason || 'unknown'}`);
        }
      } catch (_err) {
        // Non-critical - summary generator may not be available
      }
    }

    // Auto-scan all active registries if configured (fire-and-forget)
    try {
      const { RegistryManager } = require('../../flow-registry-manager');
      const manager = new RegistryManager();
      manager.loadPlugins();
      manager.activatePlugins();
      manager.scanAll().catch((err) => {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Registry scan failed: ${err.message}`);
        }
      });
    } catch (_err) {
      // Non-critical - registry manager may not be available
    }
    // Workspace: write structured task-complete message to .workspace/messages/
    // The Stop hook sends a freeform curl to the manager as a fallback, but this
    // structured message is the VERIFIED completion signal — it went through quality
    // gates (gate latch check above). The manager should trust these over freeform reports.
    if (result.completed && process.env.WOGI_WORKSPACE_ROOT) {
      try {
        const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;

        // Validate workspace root — must be absolute and exist (mirrors stop.js pattern)
        if (!path.isAbsolute(workspaceRoot) || !fs.existsSync(workspaceRoot)) {
          throw new Error(`Invalid WOGI_WORKSPACE_ROOT: ${workspaceRoot}`);
        }

        const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
        const repoName = process.env.WOGI_REPO_NAME || 'unknown';

        if (fs.existsSync(messagesDir)) {
          const msgId = `msg-${completedTask.id}-${Date.now()}`;
          // Sanitize changedFiles: limit count and path length, strip newlines
          const rawFiles = input.changedFiles || [];
          const changedFiles = rawFiles.slice(0, 20).map(f =>
            String(f).replace(/[\n\r]/g, '').slice(0, 200)
          );
          const qualityGates = input.qualityGateResults || [];
          const evidenceTier = input.evidenceTier || 'unknown';

          const message = {
            id: msgId,
            from: repoName,
            to: 'manager',
            type: 'task-complete',
            subject: `Task completed: ${completedTask.title || completedTask.id}`,
            body: [
              `**Task**: ${completedTask.id} — ${completedTask.title || ''}`,
              `**Type**: ${completedTask.type || 'unknown'}`,
              changedFiles.length > 0 ? `**Files changed**: ${changedFiles.join(', ')}` : null,
              qualityGates.length > 0 ? `**Quality gates**: ${qualityGates.map(g => `${g.name}: ${g.passed ? 'PASS' : 'FAIL'}`).join(', ')}` : null,
              `**Verification evidence**: ${evidenceTier}`,
            ].filter(Boolean).join('\n'),
            taskId: completedTask.id,
            status: 'pending',
            verified: true,
            evidenceTier,
            timestamp: new Date().toISOString()
          };

          fs.writeFileSync(
            path.join(messagesDir, `${msgId}.json`),
            JSON.stringify(message, null, 2),
            { mode: 0o644 }
          );
        }
      } catch (err) {
        // Workspace message is the VERIFIED completion signal. A silent failure
        // produces "workers stopped writing since <date>" incidents that are
        // indistinguishable from "no tasks completed recently" — surface on
        // stderr unconditionally so regressions are visible in worker logs.
        // (diagnostic D1, 2026-04-16 honesty-infrastructure review.)
        const reason = err && err.message ? err.message : 'unknown';
        const root = process.env.WOGI_WORKSPACE_ROOT || '(unset)';
        const repo = process.env.WOGI_REPO_NAME || '(unset)';
        console.error(
          `[Task Completed] workspace message write FAILED for ${completedTask.id}: ${reason} (root=${root}, repo=${repo})`
        );
      }
    }

    // Compound from success — capture positive patterns (fire-and-forget)
    if (result.completed) {
      try {
        const config = getConfig();
        if (config.skillLearning?.enabled) {
          const { writeToFeedbackPatterns } = require('../../flow-learning-orchestrator');
          const taskType = completedTask.type || 'unknown';
          const changedFiles = input.changedFiles || [];
          const criteriaCount = input.scenarioCount || completedTask.criteria || 0;
          const firstPass = input.firstAttemptPass !== false;

          // Only record success patterns for non-trivial tasks that passed on first attempt
          if (firstPass && changedFiles.length >= 2 && criteriaCount >= 2) {
            const today = new Date().toISOString().split('T')[0];
            const filesSummary = changedFiles.slice(0, 5).map(f => path.basename(f)).join(', ');
            const entryText = `success-pattern: ${taskType} task (${criteriaCount} criteria, ${changedFiles.length} files) completed first-pass. Files: ${filesSummary}`;
            const tableRow = `| ${today} | ${entryText} | 1 | - | #success |`;

            writeToFeedbackPatterns({
              content: tableRow,
              entryText,
              caller: 'task-completed-success',
            }).catch(() => {
              // Non-critical
            });
          }
        }
      } catch (_err) {
        // Non-critical — success pattern capture may not be available
      }
    }

    // Skill learning extraction (fire-and-forget)
    if (result.completed) {
      try {
        const { isLearningEnabled, extractLearningContext, matchFilesToSkills, appendLearning, discoverSkills, ensureKnowledgeDir, formatSemanticChanges } = require('../../flow-skill-learn');
        const config = getConfig();
        if (isLearningEnabled(config, 'task')) {
          const changedFiles = input.changedFiles || [];
          if (changedFiles.length > 0) {
            const skills = discoverSkills();
            const { matches: skillMap } = matchFilesToSkills(changedFiles, skills);
            const context = extractLearningContext(changedFiles, 'task');

            // Enrich context with task info
            context.summary = `Task ${completedTask.id}: ${completedTask.title || ''}`;
            context.taskType = completedTask.type || 'unknown';

            for (const [skillName, matchedFiles] of skillMap) {
              if (matchedFiles.length > 0) {
                const skill = skills.find(s => s.name === skillName);
                const skillDir = skill?.path;
                if (skillDir) {
                  ensureKnowledgeDir(skillDir);
                  const entry = [
                    `### ${context.summary}`,
                    `**Type**: ${context.type} | **Trigger**: task-complete`,
                    `**Files**: ${matchedFiles.join(', ')}`,
                  ];
                  if (context.semanticChanges.length > 0) {
                    entry.push(`**Changes**: ${formatSemanticChanges(context.semanticChanges).slice(0, 200)}`);
                  }
                  entry.push('');
                  appendLearning(skillDir, entry.join('\n'));
                }
              }
            }
          }
        }
      } catch (_err) {
        // Non-critical — skill learning may not be available
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Skill learning failed: ${_err.message}`);
        }
      }
    }

    // Check pending queue — notify user if items are waiting
    try {
      const { getPendingCount } = require('../../flow-pending');
      const pendingCount = getPendingCount();
      if (pendingCount > 0) {
        result.pendingQueue = {
          count: pendingCount,
          message: `You have ${pendingCount} pending item${pendingCount !== 1 ? 's' : ''} queued. Run /wogi-pending --list to review, or I'll process them next.`
        };
      }
    } catch (_err) {
      // Non-critical — pending module may not be available
    }

    // Task-boundary session restart (wf-39e9dc09) — experimental, opt-in.
    // MUST run AFTER all state-write cleanup above. No-ops unless:
    //   1. config.taskBoundaryReset.enabled === true
    //   2. WOGI_WRAPPER_PID env var is set (proves wogi-claude wrapper is running us)
    //   3. WOGI_RESTART_FLAG env var is set
    //   4. Task completed cleanly (result.completed === true)
    //
    // When triggered, writes a restart-flag file and sends SIGTERM to our parent
    // (Claude Code). The wrapper sees the flag on claude's clean exit and
    // restarts with a fresh context. State files are already flushed to disk.
    if (result.completed && completedTask?.id) {
      try {
        const { maybeTriggerRestart } = require('./task-boundary-reset');
        const restartResult = maybeTriggerRestart({
          taskId: completedTask.id,
          taskTitle: completedTask.title
        });
        if (restartResult.triggered) {
          result.taskBoundaryRestart = {
            triggered: true,
            flagPath: restartResult.flagPath
          };
          result.message = (result.message || '') +
            ' [Task-boundary restart triggered — session will restart on clean exit]';
        } else if (process.env.DEBUG) {
          console.error(`[Task Completed] Restart skipped: ${restartResult.reason}`);
        }
      } catch (err) {
        // Fail-open — restart failure must not block task completion
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Restart module error: ${err.message}`);
        }
      }
    }
  } catch (err) {
    result.message = `Task completed handler error: ${err.message}`;
  }

  // Gap A (v2.20.0) — workspace worker auto-pickup of queued channel dispatches.
  //
  // Without this, a worker completes a task, reports to manager, then ends the
  // turn. Any channel-dispatches that landed while the worker was busy remain
  // in ready.json indefinitely — the worker sits idle ("awaiting signal").
  //
  // Fix: when a workspace worker's task completes and queued channel dispatches
  // exist, emit additionalContext instructing the AI to auto-invoke
  // /wogi-start <nextId> in the SAME turn, before the Stop hook fires.
  //
  // Only runs in worker mode (WOGI_WORKSPACE_ROOT + WOGI_REPO_NAME !== 'manager').
  // Manager sessions deliberately do NOT auto-pickup — that would hijack user
  // orchestration.
  if (result.completed && isWorkspaceWorker()) {
    try {
      const pickup = findQueuedChannelDispatches();
      if (pickup.count > 0) {
        result.workspaceAutoPickup = {
          nextTaskId: pickup.nextTaskId,
          queuedCount: pickup.count,
          additionalContext: buildAutoPickupContext(pickup)
        };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Task Completed] Auto-pickup check failed (non-fatal): ${err.message}`);
      }
    }
  }

  return result;
}

/**
 * Detect if the current process is a workspace worker (not a manager and not a
 * single-repo session). Requires WOGI_WORKSPACE_ROOT env var set by the worker
 * spawn path AND WOGI_REPO_NAME to be something other than 'manager'.
 *
 * @returns {boolean}
 */
function isWorkspaceWorker() {
  if (!process.env.WOGI_WORKSPACE_ROOT) return false;
  const repo = process.env.WOGI_REPO_NAME;
  if (!repo || repo === 'manager') return false;
  return true;
}

/**
 * Scan ready.json for channel-dispatched tasks that are queued but not in
 * progress. Returns the oldest pending task (FIFO — channel dispatches should
 * be processed in arrival order).
 *
 * Tagging conventions recognized (in priority order):
 *   1. task.channelSource === 'wogi-workspace-channel' (explicit tag)
 *   2. task.source starts with 'workspace:' (existing tag from
 *      lib/workspace-routing.js decomposeToRepoTasks at line 428)
 *   3. task.dispatchedBy === 'workspace-manager' (alternate explicit tag)
 *
 * Tasks already in inProgress are NOT counted — the AI already has work to do.
 *
 * @returns {{ count: number, nextTaskId: string|null, nextTaskTitle: string|null }}
 */
function findQueuedChannelDispatches() {
  const config = getConfig();
  if (config.workspace?.autoPickupChannelDispatches === false) {
    return { count: 0, nextTaskId: null, nextTaskTitle: null };
  }

  const readyPath = path.join(PATHS.state, 'ready.json');
  const ready = safeJsonParse(readyPath, { ready: [], inProgress: [] });

  // If anything is in progress, the worker already has direction. Don't auto-pickup.
  if ((ready.inProgress || []).length > 0) {
    return { count: 0, nextTaskId: null, nextTaskTitle: null };
  }

  const queued = (ready.ready || []).filter(isChannelDispatched);
  if (queued.length === 0) {
    return { count: 0, nextTaskId: null, nextTaskTitle: null };
  }

  // FIFO — pick the earliest created. Tasks without createdAt fall through
  // to input order (JavaScript sort is stable for equal keys).
  const sorted = [...queued].sort((a, b) => {
    const at = a.createdAt || a.created || '';
    const bt = b.createdAt || b.created || '';
    return at.localeCompare(bt);
  });
  const next = sorted[0];

  return {
    count: queued.length,
    nextTaskId: next?.id || null,
    nextTaskTitle: next?.title || null
  };
}

function isChannelDispatched(task) {
  if (!task || typeof task !== 'object') return false;
  if (task.channelSource === 'wogi-workspace-channel') return true;
  if (task.dispatchedBy === 'workspace-manager') return true;
  if (typeof task.source === 'string' && task.source.startsWith('workspace:')) return true;
  return false;
}

/**
 * Build the additionalContext text that instructs the AI to auto-invoke
 * /wogi-start on the next queued dispatch. Wording is deliberately imperative —
 * hedging ("consider", "you may wish to") was the exact anti-pattern that
 * caused the original silent-stall incident (worker introspection 2026-04-16).
 */
function buildAutoPickupContext({ count, nextTaskId, nextTaskTitle }) {
  const s = count === 1 ? '' : 's';
  return [
    `⚡ WORKSPACE AUTONOMOUS PICKUP (${count} channel dispatch${s} queued):`,
    '',
    `You just completed a task. ${count} more channel-dispatched task${s} ${count === 1 ? 'is' : 'are'} queued in ready.json.`,
    `Next: ${nextTaskId} — ${nextTaskTitle || '(no title)'}`,
    '',
    'AUTONOMOUS MODE CONTRACT (workspace worker):',
    '  • These dispatches are pre-approved by the manager.',
    '  • You MUST start the next one IMMEDIATELY in this same turn.',
    '  • Do NOT end the turn with hedging language ("awaiting signal",',
    '    "let me know if you want", "or will proceed"). Those are forbidden.',
    '  • Visibility is NOT a substitute for action. You can narrate AND act',
    '    in the same turn.',
    '',
    `ACT NOW: Invoke Skill(skill="wogi-start", args="${nextTaskId}")`
  ].join('\n');
}

module.exports = {
  handleTaskCompleted,
  isTaskCompletedEnabled,
  // Exposed for testing (v2.20.0)
  isWorkspaceWorker,
  findQueuedChannelDispatches,
  isChannelDispatched,
  buildAutoPickupContext
};
