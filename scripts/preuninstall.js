#!/usr/bin/env node

/**
 * WogiFlow preuninstall script
 *
 * Runs before npm uninstall to clean up WogiFlow-created files.
 *
 * Removes:
 * - .workflow/ directory (all WogiFlow state and config)
 * - .claude/commands/wogi-*.md (WogiFlow slash commands)
 * - .claude/docs/ (WogiFlow documentation)
 * - .claude/skills/ (WogiFlow skills - may contain user customizations)
 * - .claude/hooks/ (WogiFlow hooks)
 * - .claude/rules/ (WogiFlow rules)
 * - CLAUDE.md (if contains WogiFlow marker)
 *
 * Preserves:
 * - .claude/ directory structure (user may have other content)
 * - User's git history
 */

const fs = require('fs');
const path = require('path');

// Get project root (where npm uninstall is run)
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

// Directories to remove completely
const DIRS_TO_REMOVE = [
  path.join(PROJECT_ROOT, '.workflow'),
  path.join(PROJECT_ROOT, '.claude', 'docs'),
  path.join(PROJECT_ROOT, '.claude', 'skills'),
  path.join(PROJECT_ROOT, '.claude', 'hooks'),
  path.join(PROJECT_ROOT, '.claude', 'rules')
];

// File patterns to remove
const CLAUDE_COMMANDS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');
const CLAUDE_MD_PATH = path.join(PROJECT_ROOT, 'CLAUDE.md');

// WogiFlow marker in CLAUDE.md
const WOGIFLOW_MARKER = 'WogiFlow';

/**
 * Recursively remove a directory
 */
function removeDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { removed: false, reason: 'not found' };
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return { removed: true };
  } catch (err) {
    return { removed: false, reason: err.message };
  }
}

/**
 * Remove WogiFlow command files (wogi-*.md)
 */
function removeWogiCommands() {
  if (!fs.existsSync(CLAUDE_COMMANDS_DIR)) {
    return { count: 0, files: [] };
  }

  const removed = [];
  try {
    const files = fs.readdirSync(CLAUDE_COMMANDS_DIR);
    for (const file of files) {
      if (file.startsWith('wogi-') && file.endsWith('.md')) {
        const filePath = path.join(CLAUDE_COMMANDS_DIR, file);
        try {
          fs.unlinkSync(filePath);
          removed.push(file);
        } catch (err) {
          // Ignore individual file errors
        }
      }
    }
  } catch (err) {
    // Ignore directory read errors
  }

  return { count: removed.length, files: removed };
}

/**
 * Remove CLAUDE.md if it contains WogiFlow marker
 */
function removeClaudeMd() {
  if (!fs.existsSync(CLAUDE_MD_PATH)) {
    return { removed: false, reason: 'not found' };
  }

  try {
    const content = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8');
    if (content.includes(WOGIFLOW_MARKER)) {
      fs.unlinkSync(CLAUDE_MD_PATH);
      return { removed: true };
    }
    return { removed: false, reason: 'not a WogiFlow file' };
  } catch (err) {
    return { removed: false, reason: err.message };
  }
}

/**
 * Clean up empty .claude directory if nothing left
 */
function cleanupClaudeDir() {
  const claudeDir = path.join(PROJECT_ROOT, '.claude');
  if (!fs.existsSync(claudeDir)) {
    return;
  }

  try {
    const remaining = fs.readdirSync(claudeDir);
    // Only remove if empty or only contains 'commands' with no files
    if (remaining.length === 0) {
      fs.rmdirSync(claudeDir);
    } else if (remaining.length === 1 && remaining[0] === 'commands') {
      const commandsDir = path.join(claudeDir, 'commands');
      const commandFiles = fs.readdirSync(commandsDir);
      if (commandFiles.length === 0) {
        fs.rmdirSync(commandsDir);
        fs.rmdirSync(claudeDir);
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Check if we should be silent
 */
function shouldBeSilent() {
  return process.env.CI || process.env.WOGIFLOW_SILENT_UNINSTALL;
}

/**
 * Main entry point
 */
function main() {
  const silent = shouldBeSilent();
  const results = {
    directories: [],
    commands: null,
    claudeMd: null
  };

  // Remove directories
  for (const dir of DIRS_TO_REMOVE) {
    const relativePath = path.relative(PROJECT_ROOT, dir);
    const result = removeDir(dir);
    results.directories.push({ path: relativePath, ...result });
  }

  // Remove wogi-*.md commands
  results.commands = removeWogiCommands();

  // Remove CLAUDE.md if WogiFlow-generated
  results.claudeMd = removeClaudeMd();

  // Clean up empty .claude directory
  cleanupClaudeDir();

  // Output summary
  if (!silent) {
    const removedDirs = results.directories.filter(d => d.removed);
    const removedCount = removedDirs.length + results.commands.count + (results.claudeMd.removed ? 1 : 0);

    if (removedCount > 0) {
      process.stderr.write('\n\x1b[36mWogiFlow cleanup:\x1b[0m\n');

      for (const dir of removedDirs) {
        process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${dir.path}/\n`);
      }

      if (results.commands.count > 0) {
        process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${results.commands.count} command(s): ${results.commands.files.join(', ')}\n`);
      }

      if (results.claudeMd.removed) {
        process.stderr.write(`  \x1b[31m✗\x1b[0m Removed CLAUDE.md\n`);
      }

      process.stderr.write('\n\x1b[2mWogiFlow has been uninstalled. Your git history is preserved.\x1b[0m\n\n');
    } else {
      process.stderr.write('\x1b[36mWogiFlow:\x1b[0m No files to clean up.\n');
    }
  }
}

// Run
try {
  main();
} catch (err) {
  // Don't fail npm uninstall on preuninstall errors
  if (!process.env.CI) {
    process.stderr.write(`\x1b[33mWogiFlow cleanup warning:\x1b[0m ${err.message}\n`);
  }
}
