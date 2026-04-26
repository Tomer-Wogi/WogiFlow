'use strict';

/**
 * Wogi Flow — Shared time-formatting helpers.
 *
 * Extracted from flow-completion-summary.js + flow-workspace-summary.js
 * (CL-006 / 2026-04-26 review-fix). Both files implemented identical
 * `formatDuration(startedAt, endedAt)` with already-creeping stylistic
 * divergence. Single source of truth here.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format the wall-clock duration between two ISO timestamps as "m:ss" (or
 * "h:mm:ss" if ≥1 hour). Returns "0:00" for missing inputs or negative
 * durations (clock skew).
 *
 * @param {string} startedAt
 * @param {string} endedAt
 * @returns {string}
 */
function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return '0:00';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${pad2(m % 60)}:${pad2(s)}`;
  }
  return `${m}:${pad2(s)}`;
}

module.exports = {
  pad2,
  formatDuration
};
