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

const fs = require('node:fs');
const path = require('node:path');

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

// TTL for the cleared marker — 15 seconds is enough for any skill chain to complete.
// Previously 5 minutes, which created a bypass window: any user message sent within
// 5 min of a /wogi-* command would skip routing entirely.
// Skill chains happen within a single AI response (milliseconds to seconds), so 15s
// is generous. New user turns always take > 15s (user reads response, types next message).
const ROUTING_CLEARED_TTL_MS = 15 * 1000;

/**
 * Check if routing gate is enabled in config
 * @param {Object} [config] - Pre-loaded config (optional, falls back to getConfig())
 * @returns {boolean}
 */
function isRoutingGateEnabled(config) {
  try {
    if (!config) config = getConfig();
    return config.enforcement?.routingGate?.enabled !== false;
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
    // Fail-closed: if can't read ready.json, assume no active task.
    // Fail-open here was a bypass vector — corrupted ready.json would make
    // subagent routing think a task exists and skip the routing gate.
    return false;
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
      try { fs.unlinkSync(ROUTING_CLEARED_PATH); } catch (_err) { /* ignore */ }
    }
    return false;
  } catch (_err) {
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

  // REMOVED: hasActiveTask() skip (was bypass vector).
  // Previously, if an in-progress task existed from a prior turn, the routing flag
  // was never set — allowing the AI to use all tools without invoking /wogi-start.
  // CLAUDE.md explicitly states: "Continue where we left off still requires /wogi-start."
  // Every new user message MUST route through a /wogi-* command, regardless of active tasks.

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

    // Keep hook-status aggregator in sync with the flag file (wf-7c36aaed prep
    // for future perf-003 — once synced, routing-gate reads can come from
    // hook-status cache instead of direct file reads).
    try {
      const { setRouting } = require('../../flow-hook-status');
      setRouting({ pending: true, cleared: false });
    } catch (_err) { /* non-critical */ }

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

  // Update aggregated hook status
  try {
    const { setRouting } = require('../../flow-hook-status');
    setRouting({ pending: false, cleared: true, clearedAt: new Date().toISOString() });
  } catch (_err) { /* non-blocking */ }

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
        try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch (_err) { /* ignore */ }
        return false; // Stale flag — don't block
      }
    } catch (_err) {
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
 * @param {Object} [toolInput] - Tool input (optional, used for v2.20.0 diagnostic bypass)
 * @returns {{ allowed: boolean, blocked: boolean, reason: string, message: string|null }}
 */
function checkRoutingGate(toolName, config, toolInput) {
  // Gate ALL tools that allow the AI to act without routing through /wogi-start.
  // Edit/Write/NotebookEdit were the critical gap: AI could edit ready.json (exempt
  // from task gate) to create a fake active task, then edit anything freely.
  // This set must include EVERY tool that reads, writes, or executes.
  const GATED_TOOLS = new Set([
    'Bash', 'EnterPlanMode', 'Read', 'Glob', 'Grep',
    'Edit', 'Write', 'NotebookEdit',
    'WebSearch', 'WebFetch',
    'Agent'
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

  // REMOVED: hasActiveTask() double-check bypass (was bypass vector).
  // Previously, if an active task existed, the gate would auto-clear and allow.
  // This meant any in-progress task from a prior turn bypassed routing entirely.
  // The only way to clear routing-pending is to invoke a /wogi-* skill.

  // Gap D (v2.20.0) — diagnostic curl bypass for workspace workers.
  // When a manager sends an INTROSPECTION/DIAGNOSTIC channel message, the
  // worker needs to curl-reply to localhost:8800 with a structured "## " body.
  // Without this bypass, answering diagnostic questions forces the worker to
  // create a fake task just to satisfy routing — which is itself an
  // anti-pattern. Narrow allowlist: Bash + curl + localhost:manager-port +
  // body starts with "## " + config flag enabled.
  try {
    if (toolName === 'Bash' && isDiagnosticCurlBypass(toolInput, config)) {
      return {
        allowed: true,
        blocked: false,
        reason: 'diagnostic_curl_bypass',
        message: null
      };
    }
  } catch (_err) {
    // Fail-closed — if bypass check errors, default to the normal block path.
  }

  // Block: routing is pending and no /wogi-* command has been invoked this turn
  // NOTE: This message is shown to the AI as permissionDecisionReason.
  // It must be prescriptive enough that the AI invokes /wogi-start instead of
  // trying workarounds or suggesting the user run commands manually.
  return {
    allowed: false,
    blocked: true,
    reason: 'routing_pending',
    message: [
      'BLOCKED: You must route through /wogi-start before using ANY tool.',
      'Invoke Skill(skill="wogi-start", args="<the user\'s request>") NOW.',
      'Do NOT output text first. Do NOT explain. Do NOT rationalize.',
      '"I already know the answer" is not a valid reason to skip routing.',
      '"This is just a conversation" is not a valid reason — conversation mode is a routing OUTCOME inside /wogi-start, not an exemption from it.',
      'After context compaction, having prior context does NOT grant bypass permission.',
      'The ONLY way to unblock tools is to invoke /wogi-start.'
    ].join(' ')
  };
}

/**
 * Gap D — recognize a narrow curl-to-manager bypass for diagnostic replies.
 *
 * Allowed iff ALL hold:
 *   - config.workspace.diagnosticCurlBypass !== false
 *   - Tool is Bash and command contains a single curl to
 *     http(s)://(127\\.0\\.0\\.1|localhost):{managerPort} (default 8800)
 *   - The curl body (`-d`, `--data`, `--data-binary`, `--data-raw`) starts
 *     with "## " (structured channel reply marker)
 *   - Body contains one of the diagnostic markers: "INTROSPECTION",
 *     "DIAGNOSTIC", "## QUESTION:", or "## ANSWER:" (so generic curl-to-8800
 *     doesn't escape routing — only diagnostic/question/answer replies do)
 *
 * This bypass is specifically NARROW by design — we want to unblock diagnostic
 * round-trips without opening a back door. Generic curl to any URL, curl to a
 * different port, or curl with a non-"## " body all still hit the normal block.
 *
 * @param {Object} toolInput - Bash tool input ({ command: string, ... })
 * @param {Object} config - Loaded config
 * @returns {boolean}
 */
function isDiagnosticCurlBypass(toolInput, config) {
  if (!toolInput || typeof toolInput !== 'object') return false;
  if (config?.workspace?.diagnosticCurlBypass === false) return false;

  const command = String(toolInput.command || '');
  if (!command.includes('curl')) return false;

  // Must target localhost or 127.0.0.1 on the manager port.
  const managerPort = process.env.WOGI_MANAGER_PORT ||
                      String(config?.workspace?.managerPort || '8800');
  // Validate port shape first — prevents regex injection.
  if (!/^\d{2,5}$/.test(String(managerPort))) return false;
  const portPattern = new RegExp(
    `https?://(?:127\\.0\\.0\\.1|localhost):${managerPort}(?:[/\\s"'\\\\]|$)`
  );
  if (!portPattern.test(command)) return false;

  // Extract the body argument. Recognized flags: -d, --data, --data-binary,
  // --data-raw, --data-urlencode. The body can be:
  //   (a) literal string: -d "## ANSWER: ..."
  //   (b) @-  (from stdin — we can't inspect)
  //   (c) @filename
  const bodyMatch = command.match(
    /--data(?:-binary|-raw|-urlencode)?\s+(['"])([\s\S]*?)\1|-d\s+(['"])([\s\S]*?)\3/
  );
  const literalBody = bodyMatch ? (bodyMatch[2] || bodyMatch[4] || '') : '';

  // Stdin / file bodies (@-) cannot be inspected — we conservatively reject
  // them for this bypass. The worker should use literal `-d "## ..."` instead.
  if (/--data(?:-binary|-raw|-urlencode)?\s+@|-d\s+@/.test(command) && !literalBody) {
    return false;
  }

  if (!literalBody.startsWith('## ')) return false;

  // Final marker check — body must contain one of the diagnostic markers.
  const markers = ['INTROSPECTION', 'DIAGNOSTIC', '## QUESTION:', '## ANSWER:'];
  return markers.some(m => literalBody.includes(m));
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
function incrementStopAttempts(maxAttempts = 10) {
  try {
    const content = fs.readFileSync(ROUTING_FLAG_PATH, 'utf-8');
    const data = safeJsonParseString(content, { timestamp: new Date().toISOString() });

    // Validate counter to prevent manipulation (Infinity/NaN would bypass maxAttempts)
    const rawAttempts = data.stopAttempts;
    const attempts = (Number.isFinite(rawAttempts) && rawAttempts >= 0 ? Math.floor(rawAttempts) : 0) + 1;
    if (attempts >= maxAttempts) {
      // Max retries reached — clear flag to prevent infinite loop
      try { fs.unlinkSync(ROUTING_FLAG_PATH); } catch (_err) { /* ignore */ }
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
  isDiagnosticCurlBypass,
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
