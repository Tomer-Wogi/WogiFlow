#!/usr/bin/env node

/**
 * Wogi Flow — Epic Decompose-and-Run Cascade (Story E / wf-e28b6cd8)
 *
 * After /wogi-start <epicId> completes decomposition, this helper picks
 * what happens next:
 *
 *   Option A — direct same-session invocation
 *     Returns `{ action: 'invoke-skill', taskId: <firstChild> }`. The
 *     wogi-start prompt then immediately calls
 *     Skill(skill="wogi-start", args=<firstChild>) in the SAME turn.
 *     Pro: zero latency. Con: epic + first-story share context.
 *
 *   Option B — clean-completion-marker cascade (restart)
 *     Writes the marker file with `nextTaskId` set, returns
 *     `{ action: 'restart-with-marker' }`. SessionStart's AUTO-PICKUP
 *     block reads the marker and starts the first child in a fresh
 *     session. Pro: fresh context per story. Con: restart latency.
 *
 *   None — abort
 *     `{ action: 'abort', reason }`. Caller emits a warning, ends turn.
 *
 * Strategy resolution:
 *   - autonomousMode.cascadeStrategy: "auto" | "direct" | "restart"
 *   - "auto" (default) → restart when autonomous mode active, direct
 *     otherwise.
 *   - "direct" → always Option A.
 *   - "restart" → always Option B.
 *
 * Edge cases (Phase 4 of spec):
 *   1. Epic decomposes to 0 stories → action='abort', reason='no-children'
 *   2. Epic decomposes to 1 story → cascade normally
 *   3. Epic has pre-existing child stories → no decomp, cascade to first
 *   4. Worker mode → same mechanism (ready.json is member-repo-aware)
 *   5. Cascade target missing/malformed → action='abort', reason='target-missing'
 *
 * Programmatic:
 *   const cascade = require('./flow-epic-cascade');
 *   const result = cascade.resolveCascade({ epicId });
 *   // result: { action: 'invoke-skill' | 'restart-with-marker' | 'abort', taskId?, reason? }
 *
 * Note on AC1 (latency measurement): the spec calls for a 10-cycle
 * wall-clock measurement of the SIGTERM/relaunch cycle. That cannot be
 * meaningfully measured from inside a Node script — it requires
 * instrumenting the wogi-claude wrapper across actual restarts. Captured
 * as runtime-deferred; tracked under future test infrastructure.
 */

const { getConfig, getReadyData } = require('./flow-utils');
const { writeCleanCompletionMarker } = require('./hooks/core/task-boundary-reset');

const VALID_STRATEGIES = new Set(['auto', 'direct', 'restart']);

function getCascadeStrategy() {
  const cfg = getConfig().autonomousMode || {};
  const raw = cfg.cascadeStrategy;
  if (typeof raw === 'string' && VALID_STRATEGIES.has(raw)) return raw;
  return 'auto';
}

function findEpicInQueue(epicId) {
  const data = getReadyData();
  const allLists = [data.ready, data.inProgress, data.blocked, data.recentlyCompleted].filter(Array.isArray);
  for (const list of allLists) {
    const found = list.find(t => t && t.id === epicId);
    if (found) return found;
  }
  return null;
}

/**
 * Resolve the first child story for an epic from the ready queue (children
 * land in `data.ready` after decomposition). Skips epics; respects natural
 * order so the first appended child wins.
 *
 * @param {string} epicId
 * @returns {{taskId:string,title:string}|null}
 */
function resolveFirstChildStory(epicId) {
  const data = getReadyData();
  const queue = Array.isArray(data.ready) ? data.ready : [];
  const candidate = queue.find(t =>
    t && t.id !== epicId && t.parentEpic === epicId && t.type !== 'epic'
  );
  if (candidate) {
    return { taskId: candidate.id, title: candidate.title || null };
  }
  // Fallback: read epic's stories array if parentEpic isn't set.
  const epic = findEpicInQueue(epicId);
  if (epic && Array.isArray(epic.stories) && epic.stories.length) {
    for (const childId of epic.stories) {
      const child = queue.find(t => t && t.id === childId && t.type !== 'epic');
      if (child) return { taskId: child.id, title: child.title || null };
    }
  }
  return null;
}

/**
 * Decide and (for restart strategy) write the marker.
 *
 * @param {object} input
 * @param {string} input.epicId
 * @param {boolean} [input.autonomousActive] - Override the live session
 *   flag (used by tests). Defaults to flow-session-state.isAutonomousActive().
 * @returns {{action:string, taskId?:string, title?:string, reason?:string, strategy:string}}
 */
function resolveCascade({ epicId, autonomousActive, strategy: strategyOverride } = {}) {
  if (!epicId) {
    return { action: 'abort', reason: 'no-epic-id', strategy: 'auto' };
  }

  const child = resolveFirstChildStory(epicId);
  if (!child) {
    return { action: 'abort', reason: 'no-children', strategy: 'auto' };
  }

  const strategy = (typeof strategyOverride === 'string' && VALID_STRATEGIES.has(strategyOverride))
    ? strategyOverride
    : getCascadeStrategy();
  let mode;
  if (strategy === 'direct') {
    mode = 'invoke-skill';
  } else if (strategy === 'restart') {
    mode = 'restart-with-marker';
  } else {
    let isAuto = autonomousActive;
    if (typeof isAuto !== 'boolean') {
      try {
        isAuto = require('./flow-session-state').isAutonomousActive();
      } catch (_err) { isAuto = false; }
    }
    mode = isAuto ? 'restart-with-marker' : 'invoke-skill';
  }

  if (mode === 'restart-with-marker') {
    try {
      writeCleanCompletionMarker(epicId, `Epic decomposed; cascade to ${child.taskId}`, {
        nextTaskId: child.taskId
      });
    } catch (err) {
      return {
        action: 'abort',
        reason: `marker-write-failed: ${err.message}`,
        strategy
      };
    }
  }

  return { action: mode, taskId: child.taskId, title: child.title, strategy };
}

module.exports = {
  getCascadeStrategy,
  resolveFirstChildStory,
  resolveCascade,
  VALID_STRATEGIES: [...VALID_STRATEGIES]
};

if (require.main === module) {
  const [,, cmd, arg] = process.argv;
  if (cmd === 'resolve') {
    const r = resolveCascade({ epicId: arg });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'strategy') {
    console.log(getCascadeStrategy());
  } else {
    console.log('Usage: flow-epic-cascade <resolve <epicId>|strategy>');
  }
}
