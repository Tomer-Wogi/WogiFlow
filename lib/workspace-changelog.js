#!/usr/bin/env node

/**
 * Wogi Workspace — Cross-Repo Changelog Aggregation
 *
 * Aggregates request-log entries from all member repos into a unified
 * timeline showing the full story of cross-repo changes.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { WORKSPACE_CONFIG_FILE } = require('./workspace');

// ============================================================
// Request Log Parsing
// ============================================================

/**
 * Parse a member's request-log.md into structured entries.
 *
 * @param {string} logContent — raw request-log.md content
 * @param {string} repoName — name of the repo
 * @returns {Array<Object>} parsed entries
 */
function parseRequestLog(logContent, repoName) {
  const entries = [];
  const sections = logContent.split(/^### /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const header = lines[0] || '';

    // Parse header: R-XXX | YYYY-MM-DD HH:MM
    const headerMatch = header.match(/R-(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (!headerMatch) continue;

    const entry = {
      repo: repoName,
      id: `R-${headerMatch[1]}`,
      date: headerMatch[2],
      time: headerMatch[3],
      // Note: request-log times are treated as local time (no timezone in format)
      timestamp: new Date(`${headerMatch[2]}T${headerMatch[3]}:00`).toISOString(),
      type: '',
      tags: [],
      request: '',
      result: '',
      files: []
    };

    // Parse fields
    for (const line of lines.slice(1)) {
      const typeMatch = line.match(/\*\*Type\*\*:\s*(.+)/);
      if (typeMatch) entry.type = typeMatch[1].trim();

      const tagsMatch = line.match(/\*\*Tags\*\*:\s*(.+)/);
      if (tagsMatch) entry.tags = tagsMatch[1].trim().split(/\s+/);

      const reqMatch = line.match(/\*\*Request\*\*:\s*"?(.+?)"?\s*$/);
      if (reqMatch) entry.request = reqMatch[1].trim();

      const resMatch = line.match(/\*\*Result\*\*:\s*(.+)/);
      if (resMatch) entry.result = resMatch[1].trim();

      const filesMatch = line.match(/\*\*Files\*\*:\s*(.+)/);
      if (filesMatch) entry.files = filesMatch[1].trim().split(/[,\s]+/).filter(Boolean);
    }

    entries.push(entry);
  }

  return entries;
}

// ============================================================
// Changelog Aggregation
// ============================================================

/**
 * Aggregate request logs from all workspace members into a unified timeline.
 *
 * @param {string} workspaceRoot
 * @param {Object} [options]
 * @param {string} [options.since] — only entries after this date (YYYY-MM-DD)
 * @param {number} [options.limit] — max entries (default: 50)
 * @returns {{ entries: Array<Object>, memberCount: number, totalEntries: number }}
 */
function aggregateChangelogs(workspaceRoot, options = {}) {
  const { since = '', limit = 50 } = options;
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_err) {
    return { entries: [], memberCount: 0, totalEntries: 0 };
  }

  let allEntries = [];
  let memberCount = 0;

  for (const [name, memberConfig] of Object.entries(config.members || {})) {
    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const logPath = path.join(memberPath, '.workflow', 'state', 'request-log.md');

    try {
      if (!fs.existsSync(logPath)) continue;
      const content = fs.readFileSync(logPath, 'utf-8');
      const entries = parseRequestLog(content, name);
      allEntries = allEntries.concat(entries);
      memberCount++;
    } catch (_err) {
      // Skip unreadable logs
    }
  }

  // Filter by date if specified
  if (since) {
    const sinceTime = new Date(since).getTime();
    allEntries = allEntries.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }

  // Sort by timestamp (newest first)
  allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalEntries = allEntries.length;

  // Apply limit
  if (limit > 0) {
    allEntries = allEntries.slice(0, limit);
  }

  return { entries: allEntries, memberCount, totalEntries };
}

/**
 * Format aggregated changelog as markdown.
 *
 * @param {Object} result — from aggregateChangelogs()
 * @returns {string} formatted markdown
 */
function formatAggregatedChangelog(result) {
  const lines = [
    '# Workspace Changelog',
    '',
    `*${result.memberCount} repos, ${result.totalEntries} entries*`,
    ''
  ];

  let currentDate = '';
  for (const entry of result.entries) {
    if (entry.date !== currentDate) {
      currentDate = entry.date;
      lines.push(`## ${currentDate}`);
      lines.push('');
    }

    const typeIcon = {
      new: '+',
      fix: '!',
      change: '~',
      refactor: '>'
    }[entry.type] || '*';

    lines.push(`- \`${entry.time}\` **${entry.repo}** [${typeIcon}${entry.type}] ${entry.request || entry.result}`);
  }

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseRequestLog,
  aggregateChangelogs,
  formatAggregatedChangelog
};
