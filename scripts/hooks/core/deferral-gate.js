#!/usr/bin/env node

/**
 * Wogi Flow — Mechanical Deferral Authorization Gate (wf-f9912af6)
 *
 * Prevents the AI from silently writing `status: deferred*` to review/audit
 * findings. The CLAUDE.md "Review-Findings Anti-Deferral" rule was honor-
 * system; this gate makes it mechanical.
 *
 * Pattern: PreToolUse intercepts Write/Edit/Bash to .workflow/state/last-review.json
 * (and last-audit.json). It compares the new content against the prior on-disk
 * content. If any finding's status transitions INTO a `deferred*` state and no
 * valid authorization marker is present, the write is blocked.
 *
 * Authorization comes from one of:
 *   - User's UserPromptSubmit message contains explicit defer phrases
 *     ("defer X", "fix critical only", "ship as-is", etc.) → classifier
 *     writes deferral-authorization.json
 *   - Explicit CLI: `node scripts/flow-defer-auth.js grant ...`
 *
 * Negative intent ("fix everything", "no deferrals", "I don't want tech debt")
 * writes a no-defer-pin.json that HARD-BLOCKS deferrals for the current turn,
 * overriding any auth marker.
 *
 * Fail-open: any parse error, missing config, or unexpected exception falls
 * through (allow the write). The block path is for confirmed deferral attempts
 * with no auth — every other case allows the write.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../../flow-utils');
const { safeJsonParse } = require('../../flow-io');

const AUTH_FILE = 'deferral-authorization.json';
const NO_DEFER_PIN_FILE = 'no-defer-pin.json';
const BLOCK_LOG_FILE = 'deferral-block-log.json';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes
const TARGET_BASENAMES = new Set(['last-review.json', 'last-audit.json']);

function getAuthPath() { return path.join(PATHS.state, AUTH_FILE); }
function getNoDeferPinPath() { return path.join(PATHS.state, NO_DEFER_PIN_FILE); }
function getBlockLogPath() { return path.join(PATHS.state, BLOCK_LOG_FILE); }

function isGateEnabled(config) {
  const cfg = config?.deferralGate;
  if (cfg === false) return false;
  if (cfg && typeof cfg === 'object' && cfg.enabled === false) return false;
  return true;
}

function getAuthTtlSeconds(config) {
  const v = config?.deferralGate?.authTtlSeconds;
  if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  return DEFAULT_TTL_SECONDS;
}

/**
 * Match deferral-style status values. Conservative: any string starting with
 * "deferred" (case-insensitive), plus common synonyms.
 */
const DEFERRAL_STATUS_RX = /^(?:deferred(?:[-_].*)?|wont-?fix|won-?t-?fix|skipped|dismissed-low-priority)$/i;

function isDeferralStatus(status) {
  return typeof status === 'string' && DEFERRAL_STATUS_RX.test(status.trim());
}

/**
 * Identify findings whose status transitions INTO a deferral state.
 * Pre-existing deferrals (same finding, same status) are grandfathered.
 *
 * @param {Object|null} prevContent - parsed prior file content, or null if file didn't exist
 * @param {Object} newContent - parsed new file content
 * @returns {Array<{id: string, prevStatus: string|null, newStatus: string}>}
 */
function detectDeferralChanges(prevContent, newContent) {
  const changes = [];
  const newFindings = Array.isArray(newContent?.findings) ? newContent.findings : [];
  const prevByIdMap = new Map();
  if (prevContent && Array.isArray(prevContent.findings)) {
    for (const f of prevContent.findings) {
      if (f && typeof f.id === 'string') prevByIdMap.set(f.id, f);
    }
  }
  for (const f of newFindings) {
    if (!f || typeof f.id !== 'string' || !isDeferralStatus(f.status)) continue;
    const prev = prevByIdMap.get(f.id);
    const prevStatus = prev?.status || null;
    if (prevStatus && isDeferralStatus(prevStatus)) continue; // grandfathered
    changes.push({ id: f.id, prevStatus, newStatus: f.status });
  }
  return changes;
}

function loadAuth() {
  const auth = safeJsonParse(getAuthPath(), null);
  if (!auth || typeof auth !== 'object') return null;
  // Expiry check
  if (auth.expiresAt) {
    const exp = Date.parse(auth.expiresAt);
    if (Number.isFinite(exp) && exp < Date.now()) return null;
  }
  return auth;
}

function loadNoDeferPin() {
  const pin = safeJsonParse(getNoDeferPinPath(), null);
  if (!pin || typeof pin !== 'object') return null;
  if (pin.expiresAt) {
    const exp = Date.parse(pin.expiresAt);
    if (Number.isFinite(exp) && exp < Date.now()) return null;
  }
  return pin;
}

function clearAuth() {
  try { fs.unlinkSync(getAuthPath()); } catch (_err) { /* fine if absent */ }
}

function clearNoDeferPin() {
  try { fs.unlinkSync(getNoDeferPinPath()); } catch (_err) { /* fine if absent */ }
}

function writeAuth({ scope = 'all', source = 'unspecified', grantedBy = 'user-prompt', ttlSec, config } = {}) {
  try {
    const ttl = Number.isFinite(ttlSec) ? ttlSec : getAuthTtlSeconds(config);
    const now = Date.now();
    const payload = {
      version: 1,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      scope,
      grantedBy,
      source: typeof source === 'string' ? source.slice(0, 1000) : 'unspecified'
    };
    fs.mkdirSync(path.dirname(getAuthPath()), { recursive: true });
    const tmp = `${getAuthPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, getAuthPath());
    return payload;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[deferral-gate] writeAuth failed: ${err.message}`);
    return null;
  }
}

function writeNoDeferPin({ source = 'unspecified', ttlSec = 1800 } = {}) {
  try {
    const now = Date.now();
    const payload = {
      version: 1,
      pinnedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSec * 1000).toISOString(),
      source: typeof source === 'string' ? source.slice(0, 1000) : 'unspecified'
    };
    fs.mkdirSync(path.dirname(getNoDeferPinPath()), { recursive: true });
    const tmp = `${getNoDeferPinPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, getNoDeferPinPath());
    // Clear any auth — negative intent overrides positive
    clearAuth();
    return payload;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[deferral-gate] writeNoDeferPin failed: ${err.message}`);
    return null;
  }
}

/**
 * Authorization check — given a list of finding IDs being deferred, does the
 * current auth marker cover ALL of them?
 *
 * @param {Array<{id: string}>} deferralChanges
 * @returns {{ authorized: boolean, reason: string }}
 */
function isAuthorized(deferralChanges) {
  // No-defer pin overrides everything
  const pin = loadNoDeferPin();
  if (pin) {
    return { authorized: false, reason: `no-defer-pin active (pinned at ${pin.pinnedAt}, source: ${pin.source})` };
  }

  const auth = loadAuth();
  if (!auth) return { authorized: false, reason: 'no-auth-marker' };
  if (auth.scope === 'all') return { authorized: true, reason: 'auth-scope-all' };
  if (Array.isArray(auth.scope)) {
    const authedSet = new Set(auth.scope);
    const uncovered = deferralChanges.filter(c => !authedSet.has(c.id)).map(c => c.id);
    if (uncovered.length === 0) return { authorized: true, reason: 'auth-covers-all-findings' };
    return { authorized: false, reason: `auth-missing-findings: ${uncovered.join(', ')}` };
  }
  return { authorized: false, reason: 'auth-malformed-scope' };
}

function consumeAuth(_deferralChanges) {
  // Auth is single-use: once a deferral write succeeds, the marker is removed
  // to prevent reuse on subsequent unrelated deferrals.
  clearAuth();
}

function logBlock({ filePath, changes, reason }) {
  try {
    const logPath = getBlockLogPath();
    const existing = safeJsonParse(logPath, { entries: [] });
    if (!Array.isArray(existing.entries)) existing.entries = [];
    existing.entries.push({
      blockedAt: new Date().toISOString(),
      filePath,
      findingIds: changes.map(c => c.id),
      reason
    });
    // Keep only last 100 entries
    if (existing.entries.length > 100) {
      existing.entries = existing.entries.slice(-100);
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
  } catch (_err) { /* best effort */ }
}

function isTargetFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const base = path.basename(filePath);
  return TARGET_BASENAMES.has(base);
}

/**
 * Validate a Write/Edit operation against the deferral gate.
 *
 * @param {string} filePath - path being written/edited
 * @param {string|Object} newContentRaw - new file content (string from Write/Edit, or pre-parsed object)
 * @param {Object} config
 * @returns {{ blocked: boolean, message?: string }}
 */
function checkWriteGate(filePath, newContentRaw, config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };
    if (!isTargetFile(filePath)) return { blocked: false };

    let newContent;
    if (typeof newContentRaw === 'string') {
      try { newContent = JSON.parse(newContentRaw); } catch (_err) { return { blocked: false }; }
    } else if (newContentRaw && typeof newContentRaw === 'object') {
      newContent = newContentRaw;
    } else {
      return { blocked: false };
    }

    // Load prior content from disk
    const prevContent = fs.existsSync(filePath) ? safeJsonParse(filePath, null) : null;

    const changes = detectDeferralChanges(prevContent, newContent);
    if (changes.length === 0) return { blocked: false };

    const authResult = isAuthorized(changes);
    if (authResult.authorized) {
      consumeAuth(changes);
      return { blocked: false };
    }

    logBlock({ filePath, changes, reason: authResult.reason });
    return {
      blocked: true,
      message: buildBlockMessage(filePath, changes, authResult.reason),
      deferralCount: changes.length
    };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[deferral-gate] checkWriteGate error (fail-open): ${err.message}`);
    return { blocked: false };
  }
}

/**
 * Validate a Bash command against the deferral gate. Two-stage:
 *   Stage 1: does the command mention any target file basename?
 *   Stage 2: does the command also mention `deferred` literal substring?
 * If both → fail SAFE (block) unless we can parse the content and prove auth.
 *
 * For v1 we don't deep-parse the bash command; we conservatively block any
 * Bash that touches a target file AND contains a deferral status literal,
 * pointing the AI at the Write/Edit path (which can be properly inspected).
 */
function checkBashGate(command, config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };
    if (typeof command !== 'string' || !command) return { blocked: false };

    const mentionsTarget = /last-(review|audit)\.json/.test(command);
    if (!mentionsTarget) return { blocked: false };

    // Heuristic: only block when the command appears to MUTATE the file
    // (writeFileSync, redirection >, sed -i, etc.). Pure reads (cat, jq, grep)
    // are allowed.
    const mutates = /(?:writeFileSync|>\s*[^&|]|>>\s*[^&|]|sed\s+-i|tee\s+|fs\.write|rename(?:Sync)?)/.test(command);
    if (!mutates) return { blocked: false };

    const mentionsDeferral = /\bdeferred[-_a-zA-Z0-9]*\b|"status"\s*:\s*"(deferred|wont-?fix|skipped|dismissed)/i.test(command);
    if (!mentionsDeferral) return { blocked: false };

    // We can't easily extract and validate the new content from arbitrary bash.
    // Check auth: if the user has authorized deferrals, allow. Otherwise block.
    const authResult = isAuthorized([{ id: 'unspecified' }]);
    if (authResult.authorized) return { blocked: false };

    logBlock({ filePath: '(bash)', changes: [{ id: 'unparsed-bash' }], reason: `bash-mutates-target-without-auth: ${authResult.reason}` });
    return {
      blocked: true,
      message:
        `Deferral-gate: this Bash command writes to last-review.json or last-audit.json AND ` +
        `contains a deferral status literal, but no deferral authorization is active.\n\n` +
        `Reason: ${authResult.reason}\n\n` +
        `Options:\n` +
        `  1. Mark findings as 'fixed' instead of 'deferred' (after actually fixing them).\n` +
        `  2. Get explicit user authorization. If the user has just told you to defer, run:\n` +
        `       node scripts/flow-defer-auth.js grant --scope=all --reason="<user phrase>"\n` +
        `  3. Use the Write tool with structured JSON content — that path is properly validated\n` +
        `     and will allow the write if status changes are not deferrals.\n\n` +
        `Reminder: CLAUDE.md "Review-Findings Anti-Deferral" — the user decides what to defer, not you.`
    };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[deferral-gate] checkBashGate error (fail-open): ${err.message}`);
    return { blocked: false };
  }
}

function buildBlockMessage(filePath, changes, reason) {
  const findingList = changes.map(c => `  - ${c.id}: ${c.prevStatus || '(new)'} → ${c.newStatus}`).join('\n');
  return (
    `Deferral-gate BLOCKED: write to ${path.basename(filePath)} introduces ${changes.length} ` +
    `deferral${changes.length === 1 ? '' : 's'} without authorization.\n\n` +
    `Findings being deferred:\n${findingList}\n\n` +
    `Reason: ${reason}\n\n` +
    `CLAUDE.md "Review-Findings Anti-Deferral": "Never silently convert a finding to ` +
    `'deferred' without the user explicitly saying 'defer X.'"\n\n` +
    `Options:\n` +
    `  1. Fix the findings instead — mark status: 'fixed' after actually fixing them.\n` +
    `  2. Ask the user explicitly: "Finding X requires ~Y min. Ship / fix / defer? Your call."\n` +
    `  3. If the user already authorized deferrals (e.g., picked option 4 in /wogi-review),\n` +
    `     record that explicitly:\n` +
    `       node scripts/flow-defer-auth.js grant --scope=all --reason="<verbatim user phrase>"\n` +
    `     OR for specific findings:\n` +
    `       node scripts/flow-defer-auth.js grant --findings=F5,F6 --reason="..."\n\n` +
    `If a 'no-defer-pin' is active, the user has explicitly forbidden deferrals — fix the ` +
    `findings or surface them as user-decision items.`
  );
}

module.exports = {
  // Core checks
  checkWriteGate,
  checkBashGate,

  // Auth API (used by classifier + CLI helper)
  loadAuth,
  loadNoDeferPin,
  writeAuth,
  writeNoDeferPin,
  clearAuth,
  clearNoDeferPin,
  consumeAuth,
  isAuthorized,

  // Detection helpers
  detectDeferralChanges,
  isDeferralStatus,
  isTargetFile,

  // Diagnostics
  getAuthPath,
  getNoDeferPinPath,
  getBlockLogPath,
  isGateEnabled,
  getAuthTtlSeconds,

  // Constants
  TARGET_BASENAMES,
  DEFAULT_TTL_SECONDS,
  DEFERRAL_STATUS_RX
};
