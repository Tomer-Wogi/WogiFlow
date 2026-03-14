#!/usr/bin/env node

/**
 * Wogi Flow - PostCompact (Core Module)
 *
 * CLI-agnostic logic for the PostCompact hook.
 * Claude Code 2.1.76+ fires this event after context compaction completes.
 *
 * Purpose: Restore critical state that may have been lost during compaction.
 * - Re-inject durable session context (current task, completed steps, remaining work)
 * - Re-inject active decisions and routing state
 * - Ensure routing-pending flag is set (compaction = new context, needs re-routing)
 *
 * This hook is non-blocking (fail-open). Compaction should never be prevented
 * by a state restoration failure.
 */

/**
 * Sanitize a string value before injecting into AI context.
 * Strips markdown heading markers and truncates to prevent prompt manipulation.
 *
 * @param {string} value - Raw string from state files
 * @param {number} [maxLen=200] - Maximum length
 * @returns {string} Sanitized string
 */
function sanitize(value, maxLen = 200) {
  return String(value).replace(/^#+\s/gm, '').slice(0, maxLen);
}

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
    const { getReadyData } = require('../../flow-utils');
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
    const { PATHS, safeJsonParse } = require('../../flow-utils');
    const path = require('node:path');
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
