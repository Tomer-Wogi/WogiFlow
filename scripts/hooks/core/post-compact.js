#!/usr/bin/env node

/**
 * Wogi Flow - PostCompact (Core Module)
 *
 * CLI-agnostic logic for the PostCompact hook.
 * Claude Code 2.1.76+ fires this event after context compaction completes.
 *
 * Purpose: Restore critical state that may have been lost during compaction.
 * - Re-inject durable session context (current task, completed steps, remaining work)
 * - Re-inject acceptance criteria with completion status
 * - Re-inject changed files and last request-log entry
 * - Ensure routing-pending flag is set (compaction = new context, needs re-routing)
 *
 * This hook is non-blocking (fail-open). Compaction should never be prevented
 * by a state restoration failure.
 *
 * v2.0: Hoisted shared requires, added criteria/files/log restoration,
 *       fixed criteria done status to read from scenarios.completed[]
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse, getReadyData } = require('../../flow-utils');
const { sanitizeForContext: sanitize } = require('../../flow-io');

/**
 * Handle PostCompact event.
 * Gathers critical context that needs to be re-injected after compaction.
 *
 * @returns {Object} Result with context to re-inject
 */
function handlePostCompact() {
  const contextParts = [];

  // 1. Restore durable session state (current task progress)
  try {
    const { loadDurableSession } = require('../../flow-durable-session');
    const session = loadDurableSession();
    if (session && session.taskId) {
      const steps = (session.steps || []).slice(0, 100);
      const completed = steps.filter(s => s.status === 'completed').length;
      const total = steps.length;
      const remaining = steps
        .filter(s => s.status === 'pending' || s.status === 'in_progress')
        .map(s => sanitize(s.description || s.title || s.id, 100))
        .slice(0, 10);

      contextParts.push(`**Active Task**: ${sanitize(session.taskId, 50)} (${completed}/${total} steps completed)`);
      if (remaining.length > 0) {
        contextParts.push(`**Remaining steps**: ${remaining.join(', ')}`);
      }
      if (session.type) {
        contextParts.push(`**Task type**: ${sanitize(session.type, 50)}`);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Durable session restore failed: ${err.message}`);
    }
  }

  // 2. Check for active task in ready.json (fallback if no durable session)
  try {
    const readyData = getReadyData();
    if (Array.isArray(readyData.inProgress) && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      if (task && task.id) {
        // Only add if not already covered by durable session
        if (!contextParts.some(p => p.includes(task.id))) {
          contextParts.push(`**Active Task (from ready.json)**: ${sanitize(task.id, 50)} — ${sanitize(task.title || 'untitled')}`);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Ready.json read failed: ${err.message}`);
    }
  }

  // 2b. Load acceptance criteria and changed files from task checkpoint
  try {
    const checkpointPath = path.join(PATHS.state, 'task-checkpoint.json');
    const checkpoint = safeJsonParse(checkpointPath, null);
    if (checkpoint && checkpoint.taskId) {
      // Inject acceptance criteria with completion status
      // Derive done status from scenarios.completed[] (the authoritative source)
      // rather than criteria[].done (which is never updated after initialization)
      const completedIndices = new Set(
        (checkpoint.scenarios?.completed || []).map(s => s.index)
      );

      if (Array.isArray(checkpoint.criteria) && checkpoint.criteria.length > 0) {
        const criteriaLines = checkpoint.criteria.slice(0, 15).map((c, i) => {
          const isDone = completedIndices.has(i);
          const status = isDone ? '✓' : '○';
          return `  ${status} ${sanitize(c.text || c.description || c.id, 120)}`;
        });
        const done = checkpoint.criteria.filter((_, i) => completedIndices.has(i)).length;
        contextParts.push(`**Acceptance Criteria** (${done}/${checkpoint.criteria.length} done):\n${criteriaLines.join('\n')}`);
      }

      // Inject changed files list
      if (Array.isArray(checkpoint.changedFiles) && checkpoint.changedFiles.length > 0) {
        const files = checkpoint.changedFiles.slice(0, 20).map(f => `  - ${sanitize(f, 100)}`);
        contextParts.push(`**Changed files this session** (${checkpoint.changedFiles.length}):\n${files.join('\n')}`);
      }
    }

    // Fallback: get changed files from git if checkpoint doesn't have them
    if (!checkpoint || !checkpoint.changedFiles || checkpoint.changedFiles.length === 0) {
      try {
        const { execFileSync } = require('node:child_process');
        const gitFiles = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
          encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (gitFiles) {
          const files = gitFiles.split('\n').filter(Boolean).slice(0, 20);
          contextParts.push(`**Uncommitted changes** (${files.length} files):\n${files.map(f => `  - ${f}`).join('\n')}`);
        }
      } catch (_err) {
        // git not available or no changes — skip silently
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Criteria/files restore failed: ${err.message}`);
    }
  }

  // 2c. Load last request-log entry number
  try {
    const logPath = path.join(PATHS.state, 'request-log.md');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      // Find the last R-NNN entry
      const matches = content.match(/^### R-(\d+)/gm);
      if (matches && matches.length > 0) {
        const lastEntry = matches[0]; // First match = most recent (file is reverse-chronological)
        const num = lastEntry.match(/R-(\d+)/)?.[1];
        if (num) {
          contextParts.push(`**Last request-log entry**: R-${num} (next entry should be R-${parseInt(num, 10) + 1})`);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Request-log read failed: ${err.message}`);
    }
  }

  // 2d. Clear phase-reads state
  // After compaction, the AI has fresh context but phase-reads.json still
  // records that the phase file was "read" — in a prior context that no
  // longer exists. Clear it so the gate forces the AI to re-read the current
  // phase's instructions in the new context. Without this, the AI executes
  // the phase without its instruction file loaded.
  try {
    const { clearPhaseReads } = require('./phase-read-gate');
    clearPhaseReads();
    if (process.env.DEBUG) {
      console.error('[post-compact] Phase-reads cleared');
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Phase-reads clear failed: ${err.message}`);
    }
  }

  // 3. Re-set routing-pending flag
  // After compaction, the AI has fresh context and may try to act without routing.
  // Setting routing-pending ensures the next tool use goes through routing checks.
  let routingReArmed = false;
  try {
    const { setRoutingPending } = require('./routing-gate');
    setRoutingPending();
    routingReArmed = true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Routing-pending set failed: ${err.message}`);
    }
    contextParts.push('**WARNING**: Routing enforcement could not be re-armed. Invoke `/wogi-start` manually before any implementation work.');
  }

  // 4. Load current workflow phase
  try {
    const phasePath = path.join(PATHS.state, 'workflow-phase.json');
    const phaseData = safeJsonParse(phasePath, {});
    if (phaseData.phase && phaseData.phase !== 'idle') {
      contextParts.push(`**Current workflow phase**: ${sanitize(phaseData.phase, 50)}`);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Phase read failed: ${err.message}`);
    }
  }

  // 5. Check for auto-compaction circuit breaker state (Claude Code 2.1.76+)
  // Claude Code stops auto-compaction after 3 consecutive failures.
  // If we detect repeated compactions in quick succession, warn about potential issues.
  try {
    const compactStatePath = path.join(PATHS.state, '.compact-tracker.json');
    const tracker = safeJsonParse(compactStatePath, { count: 0, lastAt: null });
    const now = Date.now();
    const lastAt = tracker.lastAt ? new Date(tracker.lastAt).getTime() : 0;
    const timeSinceLast = now - lastAt;

    // If compaction happened less than 2 minutes ago, increment counter
    if (timeSinceLast < 2 * 60 * 1000 && lastAt > 0) {
      tracker.count = (tracker.count || 0) + 1;
    } else {
      tracker.count = 1;
    }
    tracker.lastAt = new Date().toISOString();

    fs.writeFileSync(compactStatePath, JSON.stringify(tracker, null, 2));

    if (tracker.count >= 3) {
      contextParts.push('**WARNING**: Multiple compactions detected in quick succession. Claude Code 2.1.89+ stops auto-compaction after 3 consecutive thrash cycles. If context keeps growing, consider starting a new session.');
    }

    // CC 2.1.89 context-budget awareness: when 2+ compactions happened in quick succession,
    // instruct Claude to load context incrementally to avoid the thrash loop.
    if (tracker.count >= 2) {
      contextParts.push('**Context budget: LOW** — 2+ compactions in quick succession. To avoid a thrash loop:\n' +
        '- Load context ON DEMAND only (Read specific files when needed, not bulk)\n' +
        '- Use the manifest in SessionStart context to know what exists\n' +
        '- Prefer targeted `Read` of specific sections over loading entire registry files\n' +
        '- Skip non-essential context (community knowledge, memory recall)');
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[post-compact] Compact tracker failed: ${err.message}`);
    }
  }

  // Build the result
  if (contextParts.length === 0) {
    return {
      enabled: true,
      message: null,
      hasContext: false,
      routingReArmed
    };
  }

  const contextMessage = [
    '## Post-Compaction State Recovery',
    '',
    'Context was compacted. Here is your restored state:',
    '',
    ...contextParts,
    '',
    '**IMPORTANT**: Route your next action through `/wogi-start` — compaction does NOT exempt you from routing.'
  ].join('\n');

  return {
    enabled: true,
    message: contextMessage,
    hasContext: true,
    routingReArmed
  };
}

module.exports = { handlePostCompact };
