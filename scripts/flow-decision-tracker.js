#!/usr/bin/env node

/**
 * Wogi Flow - Decision Amendment Tracker
 *
 * Tracks all changes to decisions.md with rationale, timestamp,
 * impact assessment, and source pattern. Creates an audit trail
 * for rule evolution.
 *
 * Inspired by: GitHub Spec Kit's constitutional governance model
 * where every rule change is tracked with rationale.
 *
 * Usage:
 *   node flow-decision-tracker.js record <section> <action> <rationale>
 *   node flow-decision-tracker.js history [section]
 *   node flow-decision-tracker.js diff <amendment-id>
 *
 * Programmatic:
 *   const { recordAmendment, getHistory } = require('./flow-decision-tracker');
 *   recordAmendment({ section, action, rationale, source });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  PATHS,
  getConfig,
  success,
  warn,
  error,
  safeJsonParse,
  isPathWithinProject
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const AMENDMENT_ACTIONS = ['add', 'modify', 'remove', 'promote', 'deprecate'];
const AMENDMENT_SOURCES = ['manual', 'auto-promoted', 'review-finding', 'user-feedback', 'competitor-inspired'];

// ============================================================
// Amendment Log Management
// ============================================================

/**
 * Get the amendment log file path
 * @returns {string}
 */
function getLogPath() {
  const config = getConfig();
  const defaultPath = '.workflow/state/decision-amendments.json';
  const candidate = path.join(
    PATHS.root,
    config.decisions?.amendmentTracking?.logFile || defaultPath
  );
  if (!isPathWithinProject(candidate)) {
    warn('Ignoring unsafe logFile config value, using default.');
    return path.join(PATHS.root, defaultPath);
  }
  return candidate;
}

/**
 * Read the amendment log
 * @returns {Object} Amendment log
 */
function readLog() {
  const logPath = getLogPath();
  const defaultLog = { version: '1.0', amendments: [] };

  if (!fs.existsSync(logPath)) {
    return defaultLog;
  }

  const log = safeJsonParse(logPath, defaultLog);
  if (!log.amendments) {
    log.amendments = [];
  }
  return log;
}

/**
 * Write the amendment log
 * @param {Object} log - Amendment log
 */
function writeLog(log) {
  const logPath = getLogPath();
  const dir = path.dirname(logPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tempPath = logPath + '.tmp.' + process.pid;
    fs.writeFileSync(tempPath, JSON.stringify(log, null, 2));
    fs.renameSync(tempPath, logPath);
  } catch (err) {
    warn(`Failed to write amendment log: ${err.message}`);
  }
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Record a decision amendment
 * @param {Object} params - Amendment details
 * @param {string} params.section - Section of decisions.md affected
 * @param {string} params.action - One of: add, modify, remove, promote, deprecate
 * @param {string} params.rationale - Why this change was made
 * @param {string} [params.source] - Origin: manual, auto-promoted, review-finding, user-feedback
 * @param {string} [params.impactAssessment] - What this change affects
 * @param {string} [params.previousValue] - What the rule was before (for modify/remove)
 * @param {string} [params.newValue] - What the rule is now (for add/modify)
 * @param {string} [params.taskId] - Related task ID if applicable
 * @returns {Object} The recorded amendment
 */
function recordAmendment(params) {
  const config = getConfig();
  const trackingConfig = config.decisions?.amendmentTracking || {};

  if (!trackingConfig.enabled) {
    return { skipped: true, reason: 'Amendment tracking is disabled' };
  }

  const {
    section,
    action,
    rationale,
    source = 'manual',
    impactAssessment = null,
    previousValue = null,
    newValue = null,
    taskId = null
  } = params;

  // Validate required fields
  if (!section || !action || !rationale) {
    return { err: 'Missing required fields: section, action, rationale' };
  }

  if (!AMENDMENT_ACTIONS.includes(action)) {
    return { err: `Invalid action: ${action}. Must be one of: ${AMENDMENT_ACTIONS.join(', ')}` };
  }

  if (source && !AMENDMENT_SOURCES.includes(source)) {
    return { err: `Invalid source: ${source}. Must be one of: ${AMENDMENT_SOURCES.join(', ')}` };
  }

  // Validate rationale if required
  if (trackingConfig.requireRationale && (!rationale || rationale.length < 10)) {
    return { err: 'Rationale must be at least 10 characters when requireRationale is enabled' };
  }

  // Validate impact assessment if required
  if (trackingConfig.requireImpactAssessment && !impactAssessment) {
    return { err: 'Impact assessment is required when requireImpactAssessment is enabled' };
  }

  // Generate amendment record
  const id = `amend-${crypto.randomBytes(4).toString('hex')}`;
  const amendment = {
    id,
    timestamp: new Date().toISOString(),
    section,
    action,
    rationale,
    source: trackingConfig.trackSource ? source : undefined,
    impactAssessment: impactAssessment || undefined,
    previousValue: previousValue || undefined,
    newValue: newValue || undefined,
    taskId: taskId || undefined
  };

  // Clean undefined values
  Object.keys(amendment).forEach(key => {
    if (amendment[key] === undefined) delete amendment[key];
  });

  // Append to log
  const log = readLog();
  log.amendments.push(amendment);
  writeLog(log);

  return amendment;
}

/**
 * Get amendment history, optionally filtered by section
 * @param {string} [section] - Filter by section name
 * @param {number} [limit] - Maximum entries to return
 * @returns {Object[]} Amendment records
 */
function getHistory(section, limit) {
  const log = readLog();
  let amendments = log.amendments || [];

  if (section) {
    amendments = amendments.filter(a =>
      typeof a.section === 'string' && a.section.toLowerCase().includes(section.toLowerCase())
    );
  }

  // Sort by timestamp descending (most recent first)
  amendments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (limit && limit > 0) {
    amendments = amendments.slice(0, limit);
  }

  return amendments;
}

/**
 * Get a specific amendment by ID
 * @param {string} id - Amendment ID
 * @returns {Object|null} Amendment record or null
 */
function getAmendment(id) {
  const log = readLog();
  return (log.amendments || []).find(a => a.id === id) || null;
}

/**
 * Get summary statistics
 * @returns {Object} Statistics
 */
function getStats() {
  const log = readLog();
  const amendments = log.amendments || [];

  const stats = {
    total: amendments.length,
    byAction: {},
    bySource: {},
    bySection: {},
    recentCount: 0
  };

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const a of amendments) {
    // By action
    stats.byAction[a.action] = (stats.byAction[a.action] || 0) + 1;

    // By source
    if (a.source) {
      stats.bySource[a.source] = (stats.bySource[a.source] || 0) + 1;
    }

    // By section
    stats.bySection[a.section] = (stats.bySection[a.section] || 0) + 1;

    // Recent (last 7 days)
    if (new Date(a.timestamp) > oneWeekAgo) {
      stats.recentCount++;
    }
  }

  return stats;
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format amendment history for display
 * @param {Object[]} amendments - Amendment records
 * @returns {string} Formatted output
 */
function formatHistory(amendments) {
  if (amendments.length === 0) {
    return 'No decision amendments recorded.';
  }

  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('  DECISION AMENDMENT HISTORY');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  for (const a of amendments) {
    const date = new Date(a.timestamp).toISOString().split('T')[0];
    const actionIcon = {
      add: '+',
      modify: '~',
      remove: '-',
      promote: '^',
      deprecate: 'x'
    }[a.action] || '?';

    lines.push(`  [${actionIcon}] ${a.id} | ${date} | ${a.section}`);
    lines.push(`      Action: ${a.action}`);
    lines.push(`      Rationale: ${a.rationale}`);
    if (a.source) lines.push(`      Source: ${a.source}`);
    if (a.impactAssessment) lines.push(`      Impact: ${a.impactAssessment}`);
    if (a.taskId) lines.push(`      Task: ${a.taskId}`);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Total: ${amendments.length} amendments`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/**
 * Format statistics for display
 * @param {Object} stats - Statistics
 * @returns {string} Formatted output
 */
function formatStats(stats) {
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('  DECISION AMENDMENT STATS');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`  Total amendments: ${stats.total}`);
  lines.push(`  Last 7 days: ${stats.recentCount}`);
  lines.push('');

  if (Object.keys(stats.byAction).length > 0) {
    lines.push('  By action:');
    for (const [action, count] of Object.entries(stats.byAction)) {
      lines.push(`    ${action}: ${count}`);
    }
    lines.push('');
  }

  if (Object.keys(stats.bySource).length > 0) {
    lines.push('  By source:');
    for (const [source, count] of Object.entries(stats.bySource)) {
      lines.push(`    ${source}: ${count}`);
    }
    lines.push('');
  }

  if (Object.keys(stats.bySection).length > 0) {
    lines.push('  By section:');
    for (const [section, count] of Object.entries(stats.bySection)) {
      lines.push(`    ${section}: ${count}`);
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  recordAmendment,
  getHistory,
  getAmendment,
  getStats,
  formatHistory,
  formatStats
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'record': {
      const section = args[1];
      const action = args[2];
      const rationale = args.slice(3).join(' ');

      if (!section || !action || !rationale) {
        error('Usage: flow-decision-tracker record <section> <action> <rationale>');
        console.log(`  Actions: ${AMENDMENT_ACTIONS.join(', ')}`);
        process.exit(1);
      }

      const result = recordAmendment({ section, action, rationale });
      if (result.err) {
        error(result.err);
        process.exit(1);
      }
      if (result.skipped) {
        warn(result.reason);
        process.exit(0);
      }
      success(`Recorded amendment: ${result.id}`);
      break;
    }

    case 'history': {
      const section = args[1] || null;
      const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 20;
      const amendments = getHistory(section, limit);

      if (args.includes('--json')) {
        console.log(JSON.stringify(amendments, null, 2));
      } else {
        console.log(formatHistory(amendments));
      }
      break;
    }

    case 'stats': {
      const stats = getStats();
      if (args.includes('--json')) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(formatStats(stats));
      }
      break;
    }

    case 'diff': {
      const amendmentId = args[1];
      if (!amendmentId) {
        error('Usage: flow-decision-tracker diff <amendment-id>');
        process.exit(1);
      }
      const amendment = getAmendment(amendmentId);
      if (!amendment) {
        error(`Amendment not found: ${amendmentId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(amendment, null, 2));
      break;
    }

    default:
      console.log(`
Decision Amendment Tracker

Usage: node flow-decision-tracker <command> [options]

Commands:
  record <section> <action> <rationale>  Record a decision amendment
  history [section]                       Show amendment history
  stats                                   Show amendment statistics
  diff <amendment-id>                     Show specific amendment

Actions: ${AMENDMENT_ACTIONS.join(', ')}
Sources: ${AMENDMENT_SOURCES.join(', ')}

Options:
  --json             Output in JSON format
  --limit N          Limit history entries (default: 20)

Examples:
  node flow-decision-tracker record "Coding Standards" add "Added TDD enforcement rule"
  node flow-decision-tracker history "Security" --limit 10
  node flow-decision-tracker stats --json
`);
  }
}
