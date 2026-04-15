#!/usr/bin/env node

/**
 * Wogi Flow - Request Log Operations
 *
 * Read/count/append operations for request-log.md. Extracted from
 * flow-utils.js (wf-94cc3b72 epic — flow-utils decomposition).
 *
 * Uses appendFileSync for atomic append (avoids read-modify-write race).
 */

'use strict';

const fs = require('node:fs');
const { PATHS } = require('./flow-paths');
const { readFile } = require('./flow-io');
const { error } = require('./flow-output');

/**
 * Get the current AI CLI session ID (kept local to avoid circular flow-utils dep).
 * @returns {string|null}
 */
function getSessionId() {
  return process.env.CLAUDE_SESSION_ID
      || process.env.AI_SESSION_ID
      || null;
}

/**
 * Count entries in request-log.md
 * @returns {number}
 */
function countRequestLogEntries() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-/gm);
    return matches ? matches.length : 0;
  } catch (_err) {
    return 0;
  }
}

/**
 * Get the last request log entry (header line only)
 * @returns {string|null}
 */
function getLastRequestLogEntry() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-.*$/gm);
    return matches ? matches[matches.length - 1] : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Get the highest request ID number from request-log.md.
 * More robust than counting — handles gaps and deleted entries.
 * @returns {number}
 */
function getHighestRequestId() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/### R-(\d{3,})/g);
    if (!matches || matches.length === 0) return 0;

    const numbers = matches.map(m => {
      const num = m.match(/R-(\d+)/);
      return num ? parseInt(num[1], 10) : 0;
    });
    return Math.max(...numbers);
  } catch (_err) {
    return 0;
  }
}

/**
 * Get next request ID (highest existing + 1, zero-padded to 3 digits).
 * @returns {string} e.g., 'R-042'
 */
function getNextRequestId() {
  const highestId = getHighestRequestId();
  return `R-${String(highestId + 1).padStart(3, '0')}`;
}

/**
 * Append an entry to request-log.md.
 * @param {Object} entry
 * @param {string} entry.type - new | fix | change | refactor
 * @param {string[]} entry.tags - e.g., ['#figma', '#component:Button']
 * @param {string} entry.request - What was requested
 * @param {string} entry.result - What was done
 * @param {string[]} [entry.files] - Files changed
 * @param {string} [entry.sessionId] - CLI session ID (auto-detected if absent)
 * @returns {string|null} Assigned R-ID, or null on failure.
 */
function addRequestLogEntry(entry) {
  const { type, tags, request, result, files = [], sessionId } = entry;
  const id = getNextRequestId();
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  const session = sessionId || getSessionId();
  const sessionLine = session ? `\n**Session**: ${session}` : '';

  const filesLine = files.length > 0 ? `\n**Files**: ${files.join(', ')}` : '';
  const tagsStr = tags.join(' ');

  const logEntry = `
### ${id} | ${timestamp}
**Type**: ${type}
**Tags**: ${tagsStr}${sessionLine}
**Request**: "${request}"
**Result**: ${result}${filesLine}
`;

  try {
    fs.appendFileSync(PATHS.requestLog, logEntry);
    return id;
  } catch (err) {
    error(`Failed to add request log entry: ${err.message}`);
    return null;
  }
}

module.exports = {
  countRequestLogEntries,
  getLastRequestLogEntry,
  getHighestRequestId,
  getNextRequestId,
  addRequestLogEntry,
};
