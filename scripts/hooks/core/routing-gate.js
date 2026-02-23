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

const { getConfig, getReadyData, PATHS } = require('../../flow-utils');

// Include session ID in flag path to prevent concurrent sessions from
// interfering with each other. Falls back to PID-based path if no session ID.
const SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID || `pid-${process.ppid || process.pid}`;
const ROUTING_FLAG_PATH = path.join(PATHS.state, `.routing-pending-${SESSION_ID}`);

/**
 * Check if routing gate is enabled in config
 * @returns {boolean}
 */
function isRoutingGateEnabled() {
  try {
    const config = getConfig();
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
 * Set the routing-pending flag (called by UserPromptSubmit)
 * Only sets if no active task exists and routing gate is enabled.
 * @returns {{ set: boolean, reason: string }}
 */
function setRoutingPending() {
  if (!isRoutingGateEnabled()) {
    return { set: false, reason: 'routing_gate_disabled' };
  }

  if (hasActiveTask()) {
    return { set: false, reason: 'active_task_exists' };
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
 * Clear the routing-pending flag (called by PreToolUse when Skill wogi-* is invoked)
 * @returns {{ cleared: boolean, reason: string }}
 */
function clearRoutingPending() {
  try {
    // Direct unlink — no TOCTOU race from existsSync+unlinkSync
    fs.unlinkSync(ROUTING_FLAG_PATH);
    if (process.env.DEBUG) {
      console.error('[routing-gate] Cleared routing-pending flag');
    }
    return { cleared: true, reason: 'flag_cleared' };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { cleared: false, reason: 'no_flag_existed' };
    }
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to clear flag: ${err.message}`);
    }
    // Fail-open: if can't delete flag, don't block future calls
    return { cleared: false, reason: 'delete_error' };
  }
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
  try {
    const content = fs.readFileSync(ROUTING_FLAG_PATH, 'utf-8');
    // Check TTL — stale flags from crashed sessions shouldn't block
    try {
      const data = JSON.parse(content);
      if (data.timestamp) {
        const age = Date.now() - new Date(data.timestamp).getTime();
        if (age > ROUTING_FLAG_TTL_MS) {
          // Flag is stale — clean it up and return false
          try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch { /* ignore */ }
          if (process.env.DEBUG) {
            console.error(`[routing-gate] Cleaned stale flag (${Math.round(age / 1000)}s old)`);
          }
          return false;
        }
      }
    } catch {
      // Can't parse flag content — treat as valid (recently written)
    }
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    if (process.env.DEBUG) {
      console.error(`[routing-gate] Failed to check flag: ${err.message}`);
    }
    // Fail-open: if can't check, assume not pending
    return false;
  }
}

/**
 * Check the routing gate for a tool call (called by PreToolUse)
 *
 * @param {string} toolName - The tool being called (e.g., 'Bash')
 * @returns {{ allowed: boolean, blocked: boolean, reason: string, message: string|null }}
 */
function checkRoutingGate(toolName) {
  // Gate Bash and EnterPlanMode calls
  // EnterPlanMode bypasses /wogi-start routing — must be blocked before routing
  const GATED_TOOLS = new Set(['Bash', 'EnterPlanMode']);
  if (!GATED_TOOLS.has(toolName)) {
    return { allowed: true, blocked: false, reason: 'not_gated_tool', message: null };
  }

  // Check if routing gate is enabled
  if (!isRoutingGateEnabled()) {
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
      'BLOCKED: You must route through /wogi-start before using Bash or EnterPlanMode.',
      'ACTION REQUIRED: Invoke the Skill tool with skill="wogi-start" and pass the user\'s request as args.',
      'Example: Skill(skill="wogi-start", args="<the user\'s original request>")',
      '/wogi-start will classify the request (operational, exploration, implementation) and unblock the appropriate tools.',
      'Do NOT suggest the user run commands manually in their terminal.',
      'Do NOT try alternative approaches to bypass this gate.'
    ].join(' ')
  };
}

module.exports = {
  isRoutingGateEnabled,
  hasActiveTask,
  setRoutingPending,
  clearRoutingPending,
  isRoutingPending,
  checkRoutingGate,
  ROUTING_FLAG_PATH
};
