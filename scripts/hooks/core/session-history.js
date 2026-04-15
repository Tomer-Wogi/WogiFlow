/**
 * Wogi Flow - Session History
 *
 * Captures a lightweight digest of each Claude Code session BEFORE a
 * task-boundary restart. After restart, the new session can read this
 * history to know what the prior session did and, if needed, resume it
 * via `claude --resume <cliSessionId>`.
 *
 * This is the "prior-session access" guarantee the user asked for after
 * wf-39e9dc09 landed: state files preserve the durable outcomes, but
 * sometimes you want the full prior conversation too. The resume token
 * is the escape hatch.
 *
 * Storage: `.workflow/state/session-history.json`
 *   {
 *     "version": 1,
 *     "sessions": [
 *       {
 *         "cliSessionId": "b92bc5e3-...",
 *         "endedAt": "2026-04-15T09:40:49.293Z",
 *         "endReason": "task-boundary-restart",
 *         "tasksCompletedInSession": ["wf-00000001"],
 *         "lastActiveTaskTitle": "TEST: trigger restart via flow done",
 *         "resumeCommand": "claude --resume b92bc5e3-..."
 *       },
 *       ...
 *     ]
 *   }
 *
 * Capped at 20 entries (FIFO). Older entries archive-roll into
 * `.workflow/archive/session-history-<date>.json`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS, safeJsonParse, writeJson } = require('../../flow-utils');

const HISTORY_FILE = 'session-history.json';
const MAX_ENTRIES = 20;

function getHistoryPath() {
  return path.join(PATHS.state, HISTORY_FILE);
}

function readHistory() {
  return safeJsonParse(getHistoryPath(), { version: 1, sessions: [] });
}

/**
 * Append a session-end record. Called from Stop hook when a restart is about
 * to fire, so the new session has a pointer to the ended session.
 *
 * @param {Object} entry
 * @param {string} entry.cliSessionId
 * @param {string} [entry.endReason='task-boundary-restart']
 * @param {Array<string>} [entry.tasksCompletedInSession]
 * @param {string} [entry.lastActiveTaskTitle]
 * @returns {{ recorded: boolean, reason?: string }}
 */
function recordSessionEnd(entry) {
  if (!entry || !entry.cliSessionId) {
    return { recorded: false, reason: 'missing-cliSessionId' };
  }
  try {
    const history = readHistory();
    const record = {
      cliSessionId: entry.cliSessionId,
      endedAt: new Date().toISOString(),
      endReason: entry.endReason || 'task-boundary-restart',
      tasksCompletedInSession: Array.isArray(entry.tasksCompletedInSession)
        ? entry.tasksCompletedInSession.slice(-20)
        : [],
      lastActiveTaskTitle: entry.lastActiveTaskTitle || null,
      resumeCommand: `claude --resume ${entry.cliSessionId}`
    };
    history.sessions = history.sessions || [];
    history.sessions.unshift(record);
    // Cap FIFO
    if (history.sessions.length > MAX_ENTRIES) {
      history.sessions = history.sessions.slice(0, MAX_ENTRIES);
    }
    writeJson(getHistoryPath(), history);
    return { recorded: true };
  } catch (err) {
    return { recorded: false, reason: `history-write-failed: ${err.message}` };
  }
}

/**
 * Get the most recent prior session (the one before this one).
 * Returns null if the history is empty or only contains the current session.
 *
 * @param {string} [currentSessionId] — if provided, skip entries matching this ID
 * @returns {Object|null}
 */
function getMostRecentPriorSession(currentSessionId) {
  try {
    const history = readHistory();
    const sessions = history.sessions || [];
    for (const s of sessions) {
      if (currentSessionId && s.cliSessionId === currentSessionId) continue;
      return s;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  recordSessionEnd,
  getMostRecentPriorSession,
  readHistory,
  getHistoryPath
};
