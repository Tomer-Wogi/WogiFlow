#!/usr/bin/env node

/**
 * Wogi Flow - Routing Gate (Core Module)
 *
 * CLI-agnostic routing enforcement logic.
 * Blocks Bash calls when no /wogi-* command has been invoked first.
 *
 * Design:
 * - UserPromptSubmit sets .routing-pending flag (if no active task)
 * - PreToolUse(Skill wogi-*) clears the flag
 * - PreToolUse(Bash) checks the flag and blocks if set
 * - Fail-open: routing gate is a convenience enforcement, not a hard security boundary
 */

const fs = require('fs');
const path = require('path');

const { getConfig, getReadyData, PATHS, safeJsonParseString } = require('../../flow-utils');

// Include session ID in flag path to prevent concurrent sessions from
// interfering with each other.
// CRITICAL FIX (Gap 3): When CLAUDE_CODE_SESSION_ID is not set, use a single
// shared flag file instead of PID-based paths. PIDs differ between hook processes
// (UserPromptSubmit writes pid-123, PreToolUse reads pid-456 — never match).
// With session ID set, each session gets its own flag. Without it, a single
// shared flag works for the common single-session use case.
// Sanitize SESSION_ID to prevent path traversal (only allow alphanumeric, hyphens, underscores)
const RAW_SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID || null;
// Sanitize + cap length to prevent path traversal and ENAMETOOLONG errors
const SESSION_ID = RAW_SESSION_ID ? RAW_SESSION_ID.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : null;
const ROUTING_FLAG_PATH = SESSION_ID
  ? path.join(PATHS.state, `.routing-pending-${SESSION_ID}`)
  : path.join(PATHS.state, '.routing-pending');

// "Routing cleared" marker — prevents re-setting the flag during skill execution.
// When /wogi-start chains to /wogi-extract-review, the skill expansion text triggers
// UserPromptSubmit which would re-set the routing flag. The cleared marker prevents this.
const ROUTING_CLEARED_PATH = SESSION_ID
  ? path.join(PATHS.state, `.routing-cleared-${SESSION_ID}`)
  : path.join(PATHS.state, '.routing-cleared');

// TTL for the cleared marker — 5 minutes is enough for any skill chain to complete
const ROUTING_CLEARED_TTL_MS = 5 * 60 * 1000;

/**
 * Check if routing gate is enabled in config
 * @param {Object} [config] - Pre-loaded config (optional, falls back to getConfig())
 * @returns {boolean}
 */
function isRoutingGateEnabled(config) {
  try {
    if (!config) config = getConfig();
    return config.hooks?.rules?.routingGate?.enabled !== false;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Config read error: ${err.message}`);
    }
    // Fail-closed: if config can't be read, enforce the gate.
    // Users who installed WogiFlow expect routing enforcement.
    // Failing open here would silently bypass routing on config corruption.
    return true;
  }
}

/**
 * Check if there's an active task in ready.json inProgress
 * @returns {boolean}
 */
function hasActiveTask() {
  try {
    const readyData = getReadyData();
    return Array.isArray(readyData.inProgress) && readyData.inProgress.length > 0;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Ready data read error: ${err.message}`);
    }
    // Fail-open: if can't read ready.json, assume active task exists
    return true;
  }
}

/**
 * Check if routing was recently cleared (a /wogi-* skill is executing).
 * Prevents re-setting the flag during chained skill execution.
 * @returns {boolean}
 */
function isRoutingRecentlyCleared() {
  try {
    const content = fs.readFileSync(ROUTING_CLEARED_PATH, 'utf-8');
    const data = safeJsonParseString(content, {});
    if (data.timestamp) {
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age < ROUTING_CLEARED_TTL_MS) {
        return true;
      }
      // Stale marker — clean up
      try { fs.unlinkSync(ROUTING_CLEARED_PATH); } catch { /* ignore */ }
    }
    return false;
  } catch {
    // ENOENT (no marker) or any other error — treat as not cleared.
    // Fail-open here is correct: if we can't confirm routing was cleared,
    // the routing gate should enforce normally rather than silently bypassing.
    return false;
  }
}

/**
 * Set the routing-pending flag (called by UserPromptSubmit)
 * Only sets if no active task exists and routing gate is enabled.
 * Also skips if routing was recently cleared (skill chain in progress).
 * @returns {{ set: boolean, reason: string }}
 */
function setRoutingPending() {
  if (!isRoutingGateEnabled()) {
    return { set: false, reason: 'routing_gate_disabled' };
  }

  if (hasActiveTask()) {
    return { set: false, reason: 'active_task_exists' };
  }

  // Check if a /wogi-* skill recently cleared routing — don't re-set during skill chains.
  // When /wogi-start chains to /wogi-extract-review, the skill expansion text triggers
  // UserPromptSubmit. Without this check, the flag gets re-set and blocks subsequent tools.
  if (isRoutingRecentlyCleared()) {
    if (process.env.DEBUG) {
      console.error('[routing-gate] Skipping flag set — routing recently cleared (skill chain active)');
    }
    return { set: false, reason: 'routing_recently_cleared' };
  }

  try {
    // Ensure state directory exists
    const stateDir = path.dirname(ROUTING_FLAG_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid
    }), 'utf-8');

    if (process.env.DEBUG) {
      console.error('[routing-gate] Set routing-pending flag');
    }

    return { set: true, reason: 'flag_set' };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to set flag: ${err.message}`);
    }
    // Fail-open: if can't write flag, don't enforce
    return { set: false, reason: 'write_error' };
  }
}

/**
 * Clear the routing-pending flag (called by PreToolUse when Skill wogi-* is invoked).
 * Also writes a "routing-cleared" marker to prevent re-setting during chained skill execution.
 * @returns {{ cleared: boolean, reason: string }} cleared=true if flag was deleted or already absent;
 *   cleared=false only on non-ENOENT unlink error (flag may still exist on disk).
 */
function clearRoutingPending() {
  let flagDeleted = false;
  try {
    // Direct unlink — no TOCTOU race from existsSync+unlinkSync
    fs.unlinkSync(ROUTING_FLAG_PATH);
    flagDeleted = true;
    if (process.env.DEBUG) {
      console.error('[routing-gate] Cleared routing-pending flag');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      flagDeleted = true; // Already gone — effectively cleared
    } else if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to clear flag: ${err.message}`);
    }
  }

  // Write "routing-cleared" marker to prevent re-setting during skill chains.
  // Even if the unlink above failed, the marker prevents setRoutingPending() and
  // isRoutingPending() from blocking tools during an active skill execution.
  try {
    fs.writeFileSync(ROUTING_CLEARED_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid
    }), 'utf-8');
    if (process.env.DEBUG) {
      console.error('[routing-gate] Wrote routing-cleared marker');
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to write cleared marker: ${err.message}`);
    }
  }

  return { cleared: flagDeleted, reason: flagDeleted ? 'flag_cleared' : 'unlink_error' };
}

// Max age for routing flag before it's considered stale (30 minutes)
// 5 min was too short — complex tasks with explore phases, spec generation,
// and approval gates can take 15-20 min before first Bash call.
const ROUTING_FLAG_TTL_MS = 30 * 60 * 1000;

/**
 * Check if the routing-pending flag is set and not stale
 * @returns {boolean}
 */
function isRoutingPending() {
  // Check cleared marker FIRST — if routing was recently cleared by a /wogi-* skill,
  // the flag should be considered inactive even if it was re-set by a stale
  // UserPromptSubmit during skill execution.
  if (isRoutingRecentlyCleared()) {
    if (process.env.DEBUG) {
      console.error('[routing-gate] Routing recently cleared — flag overridden');
    }
    return false;
  }

  try {
    const content = fs.readFileSync(ROUTING_FLAG_PATH, 'utf-8');
    // Check TTL — stale flags from crashed sessions shouldn't block
    const data = safeJsonParseString(content, {});
    if (data.timestamp) {
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age > ROUTING_FLAG_TTL_MS) {
        // Flag is stale — clean it up and return false
        try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch (err) { /* ignore cleanup failure */ }
        if (process.env.DEBUG) {
          console.error(`[routing-gate] Cleaned stale flag (${Math.round(age / 1000)}s old)`);
        }
        return false;
      }
    }
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to check flag: ${err.message}`);
    }
    // Fail-CLOSED: if can't read flag, assume routing IS pending.
    // But check if the file is stale via stat — prevents indefinite blocking
    // from transient errors (EMFILE, EIO) or permanent errors (EACCES).
    try {
      const stat = fs.statSync(ROUTING_FLAG_PATH);
      const age = Date.now() - stat.mtimeMs;
      if (age > ROUTING_FLAG_TTL_MS) {
        try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch { /* ignore */ }
        return false; // Stale flag — don't block
      }
    } catch {
      // statSync also failed — truly can't access the file
    }
    return true;
  }
}

/**
 * Check the routing gate for a tool call (called by PreToolUse)
 *
 * @param {string} toolName - The tool being called (e.g., 'Bash')
 * @param {Object} [config] - Pre-loaded config (optional, falls back to getConfig())
 * @returns {{ allowed: boolean, blocked: boolean, reason: string, message: string|null }}
 */
function checkRoutingGate(toolName, config) {
  // Gate ALL tools that allow the AI to act without routing through /wogi-start.
  // Edit/Write/NotebookEdit were the critical gap: AI could edit ready.json (exempt
  // from task gate) to create a fake active task, then edit anything freely.
  // This set must include EVERY tool that reads, writes, or executes.
  const GATED_TOOLS = new Set([
    'Bash', 'EnterPlanMode', 'Read', 'Glob', 'Grep',
    'Edit', 'Write', 'NotebookEdit'
  ]);
  if (!GATED_TOOLS.has(toolName)) {
    return { allowed: true, blocked: false, reason: 'not_gated_tool', message: null };
  }

  // Check if routing gate is enabled
  if (!isRoutingGateEnabled(config)) {
    return { allowed: true, blocked: false, reason: 'routing_gate_disabled', message: null };
  }

  // Check if routing is pending (flag exists)
  if (!isRoutingPending()) {
    return { allowed: true, blocked: false, reason: 'no_routing_pending', message: null };
  }

  // Double-check: if an active task appeared since the flag was set, allow
  if (hasActiveTask()) {
    // Clear the stale flag and allow
    clearRoutingPending();
    return { allowed: true, blocked: false, reason: 'active_task_appeared', message: null };
  }

  // Block: routing is pending and no active task
  // NOTE: This message is shown to the AI as permissionDecisionReason.
  // It must be prescriptive enough that the AI invokes /wogi-start instead of
  // trying workarounds or suggesting the user run commands manually.
  return {
    allowed: false,
    blocked: true,
    reason: 'routing_pending',
    message: [
      'BLOCKED: You must route through /wogi-start before using ANY tool (Bash, Read, Glob, Grep, Edit, Write, NotebookEdit, EnterPlanMode).',
      'ACTION REQUIRED: Invoke the Skill tool with skill="wogi-start" and pass the user\'s request as args.',
      'Example: Skill(skill="wogi-start", args="<the user\'s original request>")',
      '/wogi-start will classify the request (operational, exploration, implementation) and unblock the appropriate tools.',
      'Do NOT read files, search code, edit files, or execute commands without routing first.',
      'Do NOT edit ready.json or any state file to create tasks manually — that is a routing bypass.',
      'Do NOT treat session continuation as implicit permission to skip routing.',
      'Do NOT try alternative approaches to bypass this gate.'
    ].join(' ')
  };
}

/**
 * Increment the stop-attempt counter in the routing flag.
 * Used by the Stop hook instead of clearing the flag outright,
 * giving the AI multiple chances to comply before giving up.
 *
 * NOTE: Read-modify-write is not atomic — concurrent Stop hooks can lose increments.
 * This is acceptable: worst case is one extra attempt before clearing. The TTL-based
 * stale cleanup in isRoutingPending() provides the ultimate safety net.
 *
 * @param {number} maxAttempts - Max attempts before clearing for real
 * @returns {{ cleared: boolean, attempts: number }}
 */
function incrementStopAttempts(maxAttempts = 3) {
  try {
    const content = fs.readFileSync(ROUTING_FLAG_PATH, 'utf-8');
    const data = safeJsonParseString(content, { timestamp: new Date().toISOString() });

    // Validate counter to prevent manipulation (Infinity/NaN would bypass maxAttempts)
    const rawAttempts = data.stopAttempts;
    const attempts = (Number.isFinite(rawAttempts) && rawAttempts >= 0 ? Math.floor(rawAttempts) : 0) + 1;
    if (attempts >= maxAttempts) {
      // Max retries reached — clear flag to prevent infinite loop
      try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch { /* ignore */ }
      if (process.env.DEBUG) {
        console.error(`[routing-gate] Max stop attempts (${maxAttempts}) reached, clearing flag`);
      }
      return { cleared: true, attempts };
    }

    // Increment counter — flag stays active. Reconstruct object to avoid passing through
    // unexpected keys from the parsed payload.
    const updated = { timestamp: data.timestamp || new Date().toISOString(), pid: process.pid, stopAttempts: attempts };
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify(updated), 'utf-8');
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Stop attempt ${attempts}/${maxAttempts}`);
    }
    return { cleared: false, attempts };
  } catch (err) {
    if (err.code === 'ENOENT') return { cleared: true, attempts: 0 };
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to increment stop attempts: ${err.message}`);
    }
    // Fail-closed: assume flag still active
    return { cleared: false, attempts: -1 };
  }
}

module.exports = {
  isRoutingGateEnabled,
  hasActiveTask,
  setRoutingPending,
  clearRoutingPending,
  isRoutingPending,
  isRoutingRecentlyCleared,
  checkRoutingGate,
  incrementStopAttempts,
  ROUTING_FLAG_PATH,
  ROUTING_CLEARED_PATH
};
