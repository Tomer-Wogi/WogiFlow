#!/usr/bin/env node

/**
 * Wogi Flow - Guided Edit Mode
 *
 * Step-by-step guided editing for multi-file changes.
 * Inspired by Augment Code's "Next Edit" feature.
 *
 * Use cases:
 * - Large refactors (rename component across 20 files)
 * - Library upgrades (update imports everywhere)
 * - Schema changes (add field to entity + DTOs + validators)
 *
 * Usage:
 *   node scripts/flow-guided-edit.js start "rename Button to BaseButton"
 *   node scripts/flow-guided-edit.js next       # Show next file
 *   node scripts/flow-guided-edit.js approve    # Approve current
 *   node scripts/flow-guided-edit.js reject     # Reject current
 *   node scripts/flow-guided-edit.js status     # Show progress
 *   node scripts/flow-guided-edit.js abort      # Cancel session
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  getProjectRoot,
  getConfig,
  PATHS,
  color,
  success,
  warn,
  error,
  readFile,
  writeFile,
  writeJson
} = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const SESSION_FILE = path.join(PATHS.state, 'guided-edit-session.json');

// ============================================================
// Session Management
// ============================================================

/**
 * Load current guided edit session
 */
function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save guided edit session
 */
function saveSession(session) {
  writeJson(SESSION_FILE, session);
}

/**
 * Clear guided edit session
 */
function clearSession() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

// ============================================================
// File Analysis
// ============================================================

/**
 * Extract search pattern from description
 * Returns { search: string, replace: string, type: 'rename'|'find'|'pattern' }
 */
function parseDescription(description) {
  const desc = description.trim();

  // Pattern: "rename X to Y"
  const renameMatch = desc.match(/rename\s+['"]?(\w+)['"]?\s+to\s+['"]?(\w+)['"]?/i);
  if (renameMatch) {
    return {
      type: 'rename',
      search: renameMatch[1],
      replace: renameMatch[2],
      description: desc
    };
  }

  // Pattern: "replace X with Y"
  const replaceMatch = desc.match(/replace\s+['"]?([^'"]+)['"]?\s+with\s+['"]?([^'"]+)['"]?/i);
  if (replaceMatch) {
    return {
      type: 'replace',
      search: replaceMatch[1],
      replace: replaceMatch[2],
      description: desc
    };
  }

  // Pattern: "find X" - just search
  const findMatch = desc.match(/find\s+['"]?([^'"]+)['"]?/i);
  if (findMatch) {
    return {
      type: 'find',
      search: findMatch[1],
      replace: null,
      description: desc
    };
  }

  // Pattern: "update X" - just search for X
  const updateMatch = desc.match(/update\s+['"]?(\w+)['"]?/i);
  if (updateMatch) {
    return {
      type: 'update',
      search: updateMatch[1],
      replace: null,
      description: desc
    };
  }

  // Default: treat entire description as search term
  return {
    type: 'search',
    search: desc,
    replace: null,
    description: desc
  };
}

/**
 * Find all files containing the search pattern
 */
function findAffectedFiles(search, options = {}) {
  const config = getConfig();

  // Determine source directory: options > config > src > project root
  // But verify the directory exists before using it
  let srcDir = null;

  // Try options first
  if (options.srcDir) {
    srcDir = path.isAbsolute(options.srcDir) ? options.srcDir : path.join(PROJECT_ROOT, options.srcDir);
  }

  // Try config
  if (!srcDir || !fs.existsSync(srcDir)) {
    const configSrcDir = config.guidedEdit?.srcDir;
    if (configSrcDir) {
      const resolved = path.isAbsolute(configSrcDir) ? configSrcDir : path.join(PROJECT_ROOT, configSrcDir);
      if (fs.existsSync(resolved)) {
        srcDir = resolved;
      }
    }
  }

  // Fallback to src/ or project root
  if (!srcDir || !fs.existsSync(srcDir)) {
    const defaultSrc = path.join(PROJECT_ROOT, 'src');
    srcDir = fs.existsSync(defaultSrc) ? defaultSrc : PROJECT_ROOT;
  }

  const extensions = options.extensions || config.guidedEdit?.extensions || ['ts', 'tsx', 'js', 'jsx', 'vue', 'svelte'];

  const results = [];

  try {
    const extPattern = extensions.map(e => `--include="*.${e}"`).join(' ');
    const output = execSync(
      `grep -rl "${search}" ${extPattern} "${srcDir}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    const files = output.split('\n').filter(f => f.trim());

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(search)) {
            matches.push({
              line: i + 1,
              content: lines[i].trim().substring(0, 100)
            });
          }
        }

        results.push({
          path: path.relative(PROJECT_ROOT, file),
          absolutePath: file,
          matchCount: matches.length,
          matches: matches.slice(0, 5), // First 5 matches
          status: 'pending'
        });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // No matches or grep failed
  }

  // Sort by match count (more matches first)
  results.sort((a, b) => b.matchCount - a.matchCount);

  return results;
}

/**
 * Generate a preview of changes for a file
 */
function generatePreview(file, search, replace) {
  if (!replace) {
    return { before: null, after: null, diff: null };
  }

  try {
    const content = fs.readFileSync(file.absolutePath, 'utf-8');
    const newContent = content.replace(new RegExp(search, 'g'), replace);

    if (content === newContent) {
      return { before: content, after: content, diff: null, unchanged: true };
    }

    // Generate simple diff
    const oldLines = content.split('\n');
    const newLines = newContent.split('\n');
    const diff = [];

    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i]) diff.push(`- ${oldLines[i]}`);
        if (newLines[i]) diff.push(`+ ${newLines[i]}`);
      }
    }

    return {
      before: content,
      after: newContent,
      diff: diff.slice(0, 20).join('\n') + (diff.length > 20 ? '\n...' : '')
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// Session Operations
// ============================================================

/**
 * Start a new guided edit session
 */
function startSession(description, options = {}) {
  const existing = loadSession();
  if (existing) {
    error('A guided edit session is already in progress');
    console.log(color('dim', `Description: "${existing.description}"`));
    console.log(color('dim', `Progress: ${existing.files.filter(f => f.status !== 'pending').length}/${existing.files.length}`));
    console.log('');
    console.log('Run: node scripts/flow-guided-edit.js abort  to cancel');
    console.log('     node scripts/flow-guided-edit.js status  to see progress');
    return null;
  }

  const parsed = parseDescription(description);
  console.log(color('cyan', '🔍 Analyzing change...'));
  console.log(`   Type: ${parsed.type}`);
  console.log(`   Search: "${parsed.search}"`);
  if (parsed.replace) {
    console.log(`   Replace: "${parsed.replace}"`);
  }
  console.log('');

  const files = findAffectedFiles(parsed.search, options);

  if (files.length === 0) {
    warn(`No files found containing "${parsed.search}"`);
    return null;
  }

  console.log(color('green', `Found ${files.length} file(s) to review:`));
  for (const file of files.slice(0, 10)) {
    console.log(`   ${file.path} (${file.matchCount} match${file.matchCount > 1 ? 'es' : ''})`);
  }
  if (files.length > 10) {
    console.log(color('dim', `   ... and ${files.length - 10} more`));
  }
  console.log('');

  const session = {
    id: `ge-${Date.now()}`,
    description: parsed.description,
    type: parsed.type,
    search: parsed.search,
    replace: parsed.replace,
    files,
    currentIndex: 0,
    startedAt: new Date().toISOString(),
    stats: {
      approved: 0,
      rejected: 0,
      skipped: 0
    }
  };

  saveSession(session);
  success('Guided edit session started');
  console.log('');
  console.log('Commands:');
  console.log(`  ${color('cyan', 'next')}     - Show next file to review`);
  console.log(`  ${color('green', 'approve')} - Approve and apply change`);
  console.log(`  ${color('yellow', 'reject')}  - Reject and skip file`);
  console.log(`  ${color('dim', 'status')}  - Show progress`);
  console.log(`  ${color('red', 'abort')}   - Cancel session`);

  return session;
}

/**
 * Show the next file to review
 */
function showNext() {
  const session = loadSession();
  if (!session) {
    error('No guided edit session in progress');
    return null;
  }

  // Find next pending file
  const pending = session.files.filter(f => f.status === 'pending');
  if (pending.length === 0) {
    success('All files reviewed!');
    showSummary(session);
    return null;
  }

  const file = pending[0];
  const preview = generatePreview(file, session.search, session.replace);

  console.log(color('cyan', '─'.repeat(60)));
  console.log(color('cyan', `📄 File ${session.files.length - pending.length + 1}/${session.files.length}`));
  console.log(color('cyan', '─'.repeat(60)));
  console.log(`Path: ${file.path}`);
  console.log(`Matches: ${file.matchCount}`);
  console.log('');

  if (file.matches && file.matches.length > 0) {
    console.log(color('dim', 'Match locations:'));
    for (const match of file.matches) {
      console.log(color('dim', `  Line ${match.line}: ${match.content}`));
    }
    console.log('');
  }

  if (preview.diff) {
    console.log(color('yellow', 'Proposed changes:'));
    console.log(preview.diff);
    console.log('');
  } else if (preview.unchanged) {
    console.log(color('dim', '(No actual changes needed - pattern not found in replaceable context)'));
    console.log('');
  }

  console.log(color('cyan', '─'.repeat(60)));
  console.log(`[${color('green', 'a')}]pprove  [${color('yellow', 'r')}]eject  [${color('dim', 's')}]kip  [${color('red', 'q')}]uit`);

  return { session, file, preview };
}

/**
 * Approve the current file's changes
 */
function approveFile() {
  const session = loadSession();
  if (!session) {
    error('No guided edit session in progress');
    return false;
  }

  const pending = session.files.filter(f => f.status === 'pending');
  if (pending.length === 0) {
    warn('No pending files to approve');
    return false;
  }

  const file = pending[0];

  // Apply the change if we have a replacement
  if (session.replace) {
    try {
      const content = fs.readFileSync(file.absolutePath, 'utf-8');
      const newContent = content.replace(new RegExp(session.search, 'g'), session.replace);
      fs.writeFileSync(file.absolutePath, newContent);
    } catch (err) {
      error(`Failed to apply changes: ${err.message}`);
      return false;
    }
  }

  file.status = 'approved';
  session.stats.approved++;
  saveSession(session);

  success(`Approved: ${file.path}`);
  return true;
}

/**
 * Reject the current file's changes
 */
function rejectFile() {
  const session = loadSession();
  if (!session) {
    error('No guided edit session in progress');
    return false;
  }

  const pending = session.files.filter(f => f.status === 'pending');
  if (pending.length === 0) {
    warn('No pending files to reject');
    return false;
  }

  const file = pending[0];
  file.status = 'rejected';
  session.stats.rejected++;
  saveSession(session);

  warn(`Rejected: ${file.path}`);
  return true;
}

/**
 * Skip the current file
 */
function skipFile() {
  const session = loadSession();
  if (!session) {
    error('No guided edit session in progress');
    return false;
  }

  const pending = session.files.filter(f => f.status === 'pending');
  if (pending.length === 0) {
    warn('No pending files to skip');
    return false;
  }

  const file = pending[0];
  file.status = 'skipped';
  session.stats.skipped++;
  saveSession(session);

  console.log(color('dim', `Skipped: ${file.path}`));
  return true;
}

/**
 * Show session status
 */
function showStatus() {
  const session = loadSession();
  if (!session) {
    console.log(color('dim', 'No guided edit session in progress'));
    return null;
  }

  const pending = session.files.filter(f => f.status === 'pending').length;
  const reviewed = session.files.length - pending;

  console.log(color('cyan', '─'.repeat(40)));
  console.log(color('cyan', '📊 Guided Edit Status'));
  console.log(color('cyan', '─'.repeat(40)));
  console.log(`Description: "${session.description}"`);
  console.log(`Type: ${session.type}`);
  console.log(`Search: "${session.search}"`);
  if (session.replace) {
    console.log(`Replace: "${session.replace}"`);
  }
  console.log('');
  console.log(`Progress: ${reviewed}/${session.files.length} files reviewed`);
  console.log(`  ${color('green', '✓')} Approved: ${session.stats.approved}`);
  console.log(`  ${color('yellow', '✗')} Rejected: ${session.stats.rejected}`);
  console.log(`  ${color('dim', '○')} Skipped: ${session.stats.skipped}`);
  console.log(`  ${color('cyan', '•')} Pending: ${pending}`);
  console.log('');

  return session;
}

/**
 * Show summary after completion
 */
function showSummary(session) {
  console.log('');
  console.log(color('cyan', '═'.repeat(40)));
  console.log(color('cyan', '📊 Session Complete'));
  console.log(color('cyan', '═'.repeat(40)));
  console.log(`  ${color('green', '✓')} Approved: ${session.stats.approved}`);
  console.log(`  ${color('yellow', '✗')} Rejected: ${session.stats.rejected}`);
  console.log(`  ${color('dim', '○')} Skipped: ${session.stats.skipped}`);
  console.log('');

  if (session.stats.approved > 0) {
    console.log(color('dim', 'Changes have been applied. Review and commit when ready.'));
  }

  // Clear session
  clearSession();
}

/**
 * Abort the current session
 */
function abortSession() {
  const session = loadSession();
  if (!session) {
    console.log(color('dim', 'No session to abort'));
    return;
  }

  showStatus();
  clearSession();
  warn('Session aborted');
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Guided Edit Mode

Step-by-step guided editing for multi-file changes.

Usage:
  flow guided-edit start "description"   Start a new guided edit session
  flow guided-edit next                  Show next file to review
  flow guided-edit approve               Approve and apply current file's changes
  flow guided-edit reject                Reject current file's changes
  flow guided-edit skip                  Skip current file
  flow guided-edit status                Show progress
  flow guided-edit abort                 Cancel session

Examples:
  flow guided-edit start "rename Button to BaseButton"
  flow guided-edit start "replace console.log with logger.debug"
  flow guided-edit start "find deprecated API calls"

The session tracks progress across files. Use 'approve' to apply changes,
'reject' to skip without changes, or 'skip' to review later.
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'start': {
      const description = args.slice(1).join(' ');
      if (!description) {
        error('Please provide a description');
        console.log('Example: flow guided-edit start "rename Button to BaseButton"');
        process.exit(1);
      }
      startSession(description);
      break;
    }

    case 'next':
    case 'n':
      showNext();
      break;

    case 'approve':
    case 'a':
    case 'yes':
    case 'y':
      if (approveFile()) {
        showNext();
      }
      break;

    case 'reject':
    case 'r':
    case 'no':
      if (rejectFile()) {
        showNext();
      }
      break;

    case 'skip':
    case 's':
      if (skipFile()) {
        showNext();
      }
      break;

    case 'status':
      showStatus();
      break;

    case 'abort':
    case 'cancel':
    case 'q':
      abortSession();
      break;

    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  loadSession,
  saveSession,
  clearSession,
  parseDescription,
  findAffectedFiles,
  generatePreview,
  startSession,
  showNext,
  approveFile,
  rejectFile,
  skipFile,
  showStatus,
  abortSession,
  SESSION_FILE
};

if (require.main === module) {
  main();
}
