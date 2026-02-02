#!/usr/bin/env node

/**
 * Wogi Flow - Request Log Manager
 *
 * Implements summary buffer pattern for request-log.md:
 * - Keeps recent entries in main log
 * - Archives older entries to monthly files
 * - Maintains summary of archived content
 *
 * Inspired by LangChain's SummaryBufferMemory pattern.
 *
 * Part of v1.7.0 Context Memory Management
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  WORKFLOW_DIR,
  STATE_DIR,
  colors,
  color,
  warn,
  success,
  error,
  readFile,
  writeFile,
  fileExists,
  dirExists,
  countRequestLogEntries,
  printHeader
} = require('./flow-utils');

// v9.0: Memory database for queryable log storage
let memoryDb = null;
try {
  memoryDb = require('./flow-memory-db');
} catch (err) {
  // Memory module not available - fallback to MD-only
  if (process.env.DEBUG) {
    console.error(`[log-manager] Memory DB not available: ${err.message}`);
  }
}

// ============================================================
// Constants
// ============================================================

const LOG_PATH = PATHS.requestLog;
const ARCHIVE_DIR = path.join(WORKFLOW_DIR, 'archive');
const SUMMARY_PATH = path.join(STATE_DIR, 'request-log-summary.md');

// Default configuration
const DEFAULTS = {
  enabled: true,
  autoArchive: true,
  maxRecentEntries: 50,
  keepRecent: 30,
  createSummary: true
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get log manager configuration
 */
function getLogManagerConfig() {
  const config = getConfig();
  return {
    ...DEFAULTS,
    ...(config.requestLog || {})
  };
}

// ============================================================
// Entry Parsing
// ============================================================

/**
 * Parse entries from request-log content
 * Returns array of { id, raw, type, tags, request, result, date }
 */
function parseEntries(content) {
  const entries = [];

  // Match entry blocks starting with ### R-NNN
  const entryRegex = /### (R-\d+)\s*\|\s*([^\n]+)\n([\s\S]*?)(?=### R-|\Z|$)/g;
  let match;

  while ((match = entryRegex.exec(content)) !== null) {
    const id = match[1];
    const dateStr = match[2].trim();
    const body = match[3];

    entries.push({
      id,
      date: dateStr,
      raw: match[0].trim(),
      type: extractField(body, 'Type'),
      tags: extractField(body, 'Tags'),
      request: extractField(body, 'Request'),
      result: extractField(body, 'Result'),
      files: extractField(body, 'Files')
    });
  }

  return entries;
}

/**
 * Extract a field value from entry body
 */
function extractField(text, field) {
  const match = text.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+)`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Get the header portion of the log (before entries)
 */
function getLogHeader(content) {
  // Find where entries start (first ### R-)
  const entryStart = content.indexOf('### R-');
  if (entryStart === -1) {
    return content;
  }
  return content.slice(0, entryStart);
}

// ============================================================
// Archive Operations
// ============================================================

/**
 * Check if archival is needed based on entry count
 */
function shouldArchive() {
  const config = getLogManagerConfig();
  if (!config.autoArchive) return false;

  const currentCount = countRequestLogEntries();
  return currentCount > config.maxRecentEntries;
}

/**
 * Archive old entries and optionally create summary
 * Returns { archived, remaining, archivePath }
 */
function archiveOldEntries() {
  const config = getLogManagerConfig();

  if (!fileExists(LOG_PATH)) {
    return { archived: 0, remaining: 0, archivePath: null };
  }

  const content = readFile(LOG_PATH, '');
  const entries = parseEntries(content);

  if (entries.length <= config.keepRecent) {
    return { archived: 0, remaining: entries.length, archivePath: null };
  }

  // Split into archive and keep
  const toArchive = entries.slice(0, entries.length - config.keepRecent);
  const toKeep = entries.slice(-config.keepRecent);

  // Ensure archive directory exists
  if (!dirExists(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  // Create archive file (monthly grouping)
  const archiveDate = new Date().toISOString().slice(0, 7); // YYYY-MM
  const archivePath = path.join(ARCHIVE_DIR, `request-log-${archiveDate}.md`);

  // Prepare archive content
  const archiveContent = toArchive.map(e => e.raw).join('\n\n');

  // Write to archive first - only update main log if archive succeeds
  try {
    if (fileExists(archivePath)) {
      // Append to existing archive
      const existing = readFile(archivePath, '');
      writeFile(archivePath, existing + '\n\n' + archiveContent);
    } else {
      // Create new archive with header
      const archiveHeader = `# Request Log Archive - ${archiveDate}

Archived entries from request-log.md.

---

`;
      writeFile(archivePath, archiveHeader + archiveContent);
    }
  } catch (err) {
    // Archive write failed - don't update main log to prevent data loss
    console.error(`Failed to write archive: ${err.message}`);
    return {
      archived: 0,
      remaining: entries.length,
      error: `Archive write failed: ${err.message}`
    };
  }

  // Update summary if enabled
  if (config.createSummary) {
    updateSummary(toArchive, archiveDate);
  }

  // Rewrite main log with only recent entries (only after archive succeeded)
  const header = getLogHeader(content);
  const recentContent = header + toKeep.map(e => e.raw).join('\n\n') + '\n';
  writeFile(LOG_PATH, recentContent);

  return {
    archived: toArchive.length,
    remaining: toKeep.length,
    archivePath
  };
}

/**
 * Update running summary of archived entries
 */
function updateSummary(archivedEntries, archiveDate) {
  let summary;

  if (fileExists(SUMMARY_PATH)) {
    summary = readFile(SUMMARY_PATH, '');
  } else {
    summary = `# Request Log Summary

Compressed history of archived entries.
Search archives in \`.workflow/archive/\` for full details.

---

## Archive Summary

`;
  }

  // Group archived entries by type
  const byType = {};
  for (const entry of archivedEntries) {
    const type = entry.type || 'other';
    if (!byType[type]) byType[type] = [];

    // Extract brief description from request
    let brief = entry.request || entry.id;
    brief = brief.replace(/^["']|["']$/g, ''); // Remove quotes
    if (brief.length > 50) {
      brief = brief.slice(0, 47) + '...';
    }
    byType[type].push(brief);
  }

  // Create summary section for this archive batch
  const date = new Date().toISOString().split('T')[0];
  let newSummary = `\n### Archived ${date} (${archivedEntries.length} entries)\n`;

  for (const [type, requests] of Object.entries(byType)) {
    const displayItems = requests.slice(0, 3);
    const remaining = requests.length - displayItems.length;
    const suffix = remaining > 0 ? ` (+${remaining} more)` : '';
    newSummary += `- **${type}**: ${displayItems.join('; ')}${suffix}\n`;
  }

  writeFile(SUMMARY_PATH, summary + newSummary);
}

// ============================================================
// Dual-Write Operations (v9.0)
// ============================================================

/**
 * Add a request log entry with dual-write (MD + DB)
 * @param {Object} entry - { id, type, tags, request, result, files, taskId }
 * @returns {Object} - { id, mdWritten, dbWritten }
 */
async function addEntry(entry) {
  const result = { id: entry.id, mdWritten: false, dbWritten: false };

  // Generate ID if not provided
  if (!entry.id) {
    const currentCount = countRequestLogEntries() + 1;
    entry.id = `R-${String(currentCount).padStart(3, '0')}`;
  }

  // Format for markdown
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const tagsStr = Array.isArray(entry.tags) ? entry.tags.join(' ') : (entry.tags || '');
  const filesStr = Array.isArray(entry.files) ? entry.files.join(', ') : (entry.files || '');

  const mdEntry = `### ${entry.id} | ${timestamp}
**Type**: ${entry.type || 'change'}
**Tags**: ${tagsStr}
**Request**: "${entry.request || ''}"
**Result**: ${entry.result || ''}
**Files**: ${filesStr}

`;

  // Write to MD
  try {
    if (fileExists(LOG_PATH)) {
      const content = readFile(LOG_PATH, '');
      // Insert after header (find first ### or append)
      const insertPoint = content.indexOf('\n## ');
      if (insertPoint !== -1) {
        const afterHeaders = content.indexOf('\n### R-');
        if (afterHeaders !== -1) {
          // Insert before first entry
          const newContent = content.slice(0, afterHeaders + 1) + mdEntry + content.slice(afterHeaders + 1);
          writeFile(LOG_PATH, newContent);
        } else {
          // No entries yet, append to end
          writeFile(LOG_PATH, content + '\n' + mdEntry);
        }
      } else {
        // Simple append
        writeFile(LOG_PATH, content + '\n' + mdEntry);
      }
      result.mdWritten = true;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[log-manager] MD write failed: ${err.message}`);
    }
  }

  // Write to DB
  if (memoryDb) {
    try {
      await memoryDb.addRequestLogEntry({
        id: entry.id,
        type: entry.type || 'change',
        tags: Array.isArray(entry.tags) ? entry.tags : (entry.tags ? entry.tags.split(/\s+/) : []),
        request: entry.request || '',
        result: entry.result || '',
        files: Array.isArray(entry.files) ? entry.files : (entry.files ? entry.files.split(/,\s*/) : []),
        taskId: entry.taskId || null
      });
      result.dbWritten = true;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[log-manager] DB write failed: ${err.message}`);
      }
    }
  }

  return result;
}

/**
 * Search request log with optional database fallback
 * @param {Object} options - { query, tag, type, since, useDb, limit }
 * @returns {Object[]} - Matching entries
 */
async function searchEntriesAdvanced(options = {}) {
  const { useDb = true, ...searchOptions } = options;

  // Try database first if available
  if (useDb && memoryDb) {
    try {
      const dbResults = await memoryDb.searchRequestLog(searchOptions);
      if (dbResults.length > 0) {
        return dbResults.map(r => ({ ...r, source: 'database' }));
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[log-manager] DB search failed: ${err.message}`);
      }
    }
  }

  // Fallback to MD search
  const mdResults = searchEntries(options.query || options.tag || '', {
    maxResults: options.limit || 20
  });

  return mdResults;
}

// ============================================================
// Auto-Archive Hook
// ============================================================

/**
 * Automatically archive if needed
 * Safe to call frequently - only archives when threshold exceeded
 * Returns result object or null if no action taken
 */
function autoArchiveIfNeeded() {
  const config = getLogManagerConfig();

  if (!config.autoArchive) {
    return null;
  }

  if (!shouldArchive()) {
    return null;
  }

  return archiveOldEntries();
}

// ============================================================
// Search Operations
// ============================================================

/**
 * Search entries in both current log and archives
 * @param {string} query - Search term (tag, type, or text)
 * @param {object} options - { searchArchives, maxResults }
 */
function searchEntries(query, options = {}) {
  const {
    searchArchives = true,
    maxResults = 20
  } = options;

  const results = [];
  const queryLower = query.toLowerCase();

  // Search current log
  if (fileExists(LOG_PATH)) {
    const content = readFile(LOG_PATH, '');
    const entries = parseEntries(content);

    for (const entry of entries) {
      if (matchesQuery(entry, queryLower)) {
        results.push({ ...entry, source: 'current' });
      }
    }
  }

  // Search archives
  if (searchArchives && dirExists(ARCHIVE_DIR)) {
    try {
      const archiveFiles = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.startsWith('request-log-') && f.endsWith('.md'))
        .sort()
        .reverse(); // Most recent first

      for (const file of archiveFiles) {
        if (results.length >= maxResults) break;

        const archivePath = path.join(ARCHIVE_DIR, file);
        const content = readFile(archivePath, '');
        const entries = parseEntries(content);

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (matchesQuery(entry, queryLower)) {
            results.push({ ...entry, source: file });
          }
        }
      }
    } catch {
      // Ignore errors reading archives
    }
  }

  return results.slice(0, maxResults);
}

/**
 * Check if entry matches search query
 */
function matchesQuery(entry, queryLower) {
  const searchable = [
    entry.tags,
    entry.type,
    entry.request,
    entry.result,
    entry.raw
  ].filter(Boolean).join(' ').toLowerCase();

  return searchable.includes(queryLower);
}

/**
 * Get all request entries within a lookback period
 * Used for cross-session pattern detection
 *
 * @param {Object} options - Configuration options
 * @param {number} options.lookbackDays - How many days back to scan (default: 30)
 * @param {boolean} options.includeArchives - Whether to search archives (default: true)
 * @returns {Array} Array of entries with { id, date, request, type, tags, result, files, source }
 */
function getAllRequestEntries(options = {}) {
  const {
    lookbackDays = 30,
    includeArchives = true
  } = options;

  const entries = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  /**
   * Parse date string from entry (handles "YYYY-MM-DD" and "YYYY-MM-DD HH:MM")
   */
  function parseEntryDate(dateStr) {
    if (!dateStr) return null;
    // Extract just the date part (first 10 chars)
    const datePart = dateStr.trim().slice(0, 10);
    const parsed = new Date(datePart);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Check if entry is within lookback period
   */
  function isWithinLookback(entry) {
    const entryDate = parseEntryDate(entry.date);
    if (!entryDate) {
      // Log for debugging - helps identify entries with malformed dates
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Excluding entry with unparseable date: ${entry.id} - "${entry.date}"`);
      }
      return false; // Exclude entries with unparseable dates
    }
    return entryDate >= cutoffDate;
  }

  // Load current log
  if (fileExists(LOG_PATH)) {
    try {
      const content = readFile(LOG_PATH, '');
      const currentEntries = parseEntries(content);

      for (const entry of currentEntries) {
        if (isWithinLookback(entry)) {
          entries.push({ ...entry, source: 'current' });
        }
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Failed to read current log: ${err.message}`);
      }
    }
  }

  // Load archives
  if (includeArchives && dirExists(ARCHIVE_DIR)) {
    try {
      const archiveFiles = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.startsWith('request-log-') && f.endsWith('.md'))
        .sort()
        .reverse(); // Most recent first

      for (const file of archiveFiles) {
        // Quick filter by filename (request-log-YYYY-MM.md)
        const fileMonth = file.match(/request-log-(\d{4}-\d{2})\.md/);
        if (fileMonth) {
          const archiveDate = new Date(fileMonth[1] + '-01');
          // Skip archives older than lookback + 1 month (buffer for partial months)
          const archiveCutoff = new Date(cutoffDate);
          archiveCutoff.setMonth(archiveCutoff.getMonth() - 1);
          if (archiveDate < archiveCutoff) {
            continue;
          }
        }

        const archivePath = path.join(ARCHIVE_DIR, file);
        try {
          const content = readFile(archivePath, '');
          const archiveEntries = parseEntries(content);

          for (const entry of archiveEntries) {
            if (isWithinLookback(entry)) {
              entries.push({ ...entry, source: file });
            }
          }
        } catch (err) {
          if (process.env.DEBUG) {
            console.error(`[DEBUG] Failed to read archive ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Failed to read archive directory: ${err.message}`);
      }
    }
  }

  // Sort by date descending (most recent first)
  entries.sort((a, b) => {
    const dateA = parseEntryDate(a.date);
    const dateB = parseEntryDate(b.date);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  });

  return entries;
}

// ============================================================
// Statistics
// ============================================================

/**
 * Get log statistics
 */
function getLogStats() {
  const stats = {
    currentEntries: countRequestLogEntries(),
    archiveFiles: 0,
    archivedEntries: 0,
    hasSummary: fileExists(SUMMARY_PATH)
  };

  // Count archive entries
  if (dirExists(ARCHIVE_DIR)) {
    try {
      const archiveFiles = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.startsWith('request-log-') && f.endsWith('.md'));

      stats.archiveFiles = archiveFiles.length;

      for (const file of archiveFiles) {
        const content = readFile(path.join(ARCHIVE_DIR, file), '');
        const entries = parseEntries(content);
        stats.archivedEntries += entries.length;
      }
    } catch {
      // Ignore errors
    }
  }

  stats.totalEntries = stats.currentEntries + stats.archivedEntries;
  return stats;
}

// ============================================================
// CLI Interface
// ============================================================

function printUsage() {
  console.log(`
Usage: flow-log-manager.js [command] [args]

Commands:
  status              Show log statistics
  check               Check if archiving is needed
  archive             Force archive old entries
  search <query>      Search entries (current + archives)
  list-archives       List archive files
  --help              Show this help

Examples:
  node scripts/flow-log-manager.js status
  node scripts/flow-log-manager.js search "#component:Button"
  node scripts/flow-log-manager.js archive
`);
}

// Main CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status': {
      const stats = getLogStats();
      const config = getLogManagerConfig();

      printHeader('Request Log Status');
      console.log(`Current entries:  ${stats.currentEntries}`);
      console.log(`Archive files:    ${stats.archiveFiles}`);
      console.log(`Archived entries: ${stats.archivedEntries}`);
      console.log(`Total entries:    ${stats.totalEntries}`);
      console.log(`Summary exists:   ${stats.hasSummary ? 'yes' : 'no'}`);
      console.log('');
      console.log(color('dim', `Config: autoArchive=${config.autoArchive}, maxRecent=${config.maxRecentEntries}, keep=${config.keepRecent}`));
      break;
    }

    case 'check': {
      if (shouldArchive()) {
        const stats = getLogStats();
        const config = getLogManagerConfig();
        warn(`Archive recommended: ${stats.currentEntries} entries (threshold: ${config.maxRecentEntries})`);
      } else {
        success('No archiving needed');
      }
      break;
    }

    case 'archive': {
      const result = archiveOldEntries();
      if (result.archived > 0) {
        success(`Archived ${result.archived} entries to ${result.archivePath}`);
        console.log(`Remaining in log: ${result.remaining} entries`);
      } else {
        console.log('No entries needed archiving');
      }
      break;
    }

    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        error('Please provide a search query');
        process.exit(1);
      }

      const results = searchEntries(query);
      if (results.length === 0) {
        console.log(`No entries found for: ${query}`);
      } else {
        printHeader(`Search Results: "${query}"`);
        for (const entry of results) {
          console.log(`\n${color('cyan', entry.id)} (${entry.source})`);
          if (entry.type) console.log(`  Type: ${entry.type}`);
          if (entry.request) console.log(`  Request: ${entry.request}`);
          if (entry.tags) console.log(`  Tags: ${entry.tags}`);
        }
        console.log(`\n${results.length} result(s) found`);
      }
      break;
    }

    case 'list-archives': {
      if (!dirExists(ARCHIVE_DIR)) {
        console.log('No archive directory');
        break;
      }

      const files = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.startsWith('request-log-') && f.endsWith('.md'))
        .sort()
        .reverse();

      if (files.length === 0) {
        console.log('No archive files');
      } else {
        printHeader('Archive Files');
        for (const file of files) {
          const stat = fs.statSync(path.join(ARCHIVE_DIR, file));
          const size = Math.round(stat.size / 1024);
          console.log(`  ${file} (${size}KB)`);
        }
      }
      break;
    }

    case '--help':
    case '-h':
      printUsage();
      break;

    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getLogManagerConfig,
  DEFAULTS,

  // Parsing
  parseEntries,
  extractField,
  getLogHeader,

  // Archive operations
  shouldArchive,
  archiveOldEntries,
  autoArchiveIfNeeded,
  updateSummary,

  // Search
  searchEntries,
  matchesQuery,

  // Dual-write (v9.0)
  addEntry,
  searchEntriesAdvanced,

  // Cross-session analysis (v6.0)
  getAllRequestEntries,

  // Statistics
  getLogStats,

  // Paths
  LOG_PATH,
  ARCHIVE_DIR,
  SUMMARY_PATH
};
