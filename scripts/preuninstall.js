#!/usr/bin/env node

/**
 * WogiFlow preuninstall script
 *
 * Runs before npm uninstall to clean up WogiFlow-created files.
 *
 * Uses .claude/.wogiflow-manifest.json to selectively delete only
 * WogiFlow-owned files, preserving user-created content (custom skills,
 * rules, docs, hooks).
 *
 * Fallback: If no manifest exists (upgrade from older version), uses
 * legacy behavior with a warning.
 *
 * Always removes:
 * - .workflow/ directory (entirely WogiFlow-owned state and config)
 * - CLAUDE.md (if contains WogiFlow marker)
 *
 * Selectively removes (via manifest):
 * - .claude/commands/wogi-*.md (WogiFlow slash commands)
 * - .claude/docs/* (only WogiFlow-tracked files)
 * - .claude/skills/* (only WogiFlow-tracked skills)
 * - .claude/hooks/* (only WogiFlow-tracked hooks)
 * - .claude/rules/* (only WogiFlow-tracked rules)
 *
 * Preserves:
 * - User-created files in any .claude/ subdirectory
 * - .claude/ directory structure
 * - User's git history
 */

const fs = require('node:fs');
const path = require('node:path');

// Get project root (where npm uninstall is run)
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

const CLAUDE_DIR = path.join(PROJECT_ROOT, '.claude');
const MANIFEST_PATH = path.join(CLAUDE_DIR, '.wogiflow-manifest.json');
const CLAUDE_MD_PATH = path.join(PROJECT_ROOT, 'CLAUDE.md');

// WogiFlow marker in CLAUDE.md — more explicit to avoid false positives
const WOGIFLOW_MARKER = 'WogiFlow methodology';

// Debug logging helper
function debugLog(message) {
  if (process.env.DEBUG || process.env.WOGIFLOW_DEBUG) {
    process.stderr.write(`[preuninstall] ${message}\n`);
  }
}

/**
 * Read the WogiFlow manifest file.
 * @returns {{ files: string[], directories: string[] } | null}
 */
function readManifest() {
  try {
    const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    if (manifest && Array.isArray(manifest.files)) {
      return manifest;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Delete a single file, returning whether it was removed.
 */
function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      debugLog(`Failed to remove ${filePath}: ${err.message}`);
    }
    return false;
  }
}

/**
 * Recursively remove a directory.
 */
function removeDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    debugLog(`Failed to remove ${dirPath}: ${err.message}`);
    return false;
  }
}

/**
 * Remove empty directories bottom-up within a base directory.
 * Only removes dirs that became empty after file deletion.
 */
function cleanupEmptyDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(baseDir, entry.name);
        cleanupEmptyDirs(subDir);
        // After recursing, check if dir is now empty
        try {
          const remaining = fs.readdirSync(subDir);
          if (remaining.length === 0) {
            fs.rmdirSync(subDir);
          }
        } catch (err) {
          // Dir already gone or inaccessible
        }
      }
    }
  } catch (err) {
    debugLog(`cleanupEmptyDirs error: ${err.message}`);
  }
}

/**
 * Manifest-based cleanup: delete only files listed in the manifest.
 * Returns summary of what was removed/preserved.
 */
function manifestBasedCleanup(manifest) {
  const removed = [];
  const preserved = [];

  // Delete individual files from manifest
  for (const relPath of manifest.files) {
    const fullPath = path.join(CLAUDE_DIR, relPath);
    if (removeFile(fullPath)) {
      removed.push(relPath);
    }
  }

  // Delete the manifest file itself
  removeFile(MANIFEST_PATH);

  // Clean up empty directories left behind
  const dirsToClean = ['commands', 'docs', 'skills', 'hooks', 'rules'];
  for (const dir of dirsToClean) {
    const dirPath = path.join(CLAUDE_DIR, dir);
    cleanupEmptyDirs(dirPath);
    // Remove top-level dir if now empty
    try {
      const remaining = fs.readdirSync(dirPath);
      if (remaining.length === 0) {
        fs.rmdirSync(dirPath);
      } else {
        for (const f of remaining) {
          preserved.push(path.join(dir, f));
        }
      }
    } catch (err) {
      // Dir doesn't exist or already removed
    }
  }

  // Delete directories owned entirely by WogiFlow
  const dirResults = [];
  for (const dir of (manifest.directories || [])) {
    const dirPath = path.join(PROJECT_ROOT, dir);
    if (fs.existsSync(dirPath)) {
      const didRemove = removeDir(dirPath);
      dirResults.push({ path: dir, removed: didRemove });
    }
  }

  return { removed, preserved, dirResults };
}

/**
 * Legacy cleanup for installations without a manifest.
 * Uses the old behavior: recursive delete of known dirs + pattern matching for commands.
 */
function legacyCleanup() {
  const DIRS_TO_REMOVE = [
    path.join(PROJECT_ROOT, '.workflow'),
    path.join(CLAUDE_DIR, 'docs'),
    path.join(CLAUDE_DIR, 'skills'),
    path.join(CLAUDE_DIR, 'hooks'),
    path.join(CLAUDE_DIR, 'rules')
  ];

  const dirResults = [];
  for (const dir of DIRS_TO_REMOVE) {
    const relativePath = path.relative(PROJECT_ROOT, dir);
    if (fs.existsSync(dir)) {
      const didRemove = removeDir(dir);
      dirResults.push({ path: relativePath, removed: didRemove });
    } else {
      dirResults.push({ path: relativePath, removed: false });
    }
  }

  // Selective deletion for commands (existing safe pattern)
  const commandsDir = path.join(CLAUDE_DIR, 'commands');
  const removedCommands = [];
  if (fs.existsSync(commandsDir)) {
    try {
      const files = fs.readdirSync(commandsDir);
      for (const file of files) {
        if (file.startsWith('wogi-') && file.endsWith('.md')) {
          const filePath = path.join(commandsDir, file);
          if (removeFile(filePath)) {
            removedCommands.push(file);
          }
        }
      }
    } catch (err) {
      debugLog(`Failed to read commands directory: ${err.message}`);
    }
  }

  return { dirResults, removedCommands };
}

/**
 * Remove CLAUDE.md if it contains WogiFlow marker.
 */
function removeClaudeMd() {
  try {
    const content = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8');
    if (content.includes(WOGIFLOW_MARKER)) {
      fs.unlinkSync(CLAUDE_MD_PATH);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Clean up empty .claude directory if nothing left.
 */
function cleanupClaudeDir() {
  try {
    const remaining = fs.readdirSync(CLAUDE_DIR);
    if (remaining.length === 0) {
      fs.rmdirSync(CLAUDE_DIR);
      return { removed: true, preserved: [] };
    }
    // Filter out hidden files we own
    const userFiles = remaining.filter(f => f !== '.wogiflow-manifest.json');
    if (userFiles.length === 0) {
      removeFile(MANIFEST_PATH);
      fs.rmdirSync(CLAUDE_DIR);
      return { removed: true, preserved: [] };
    }
    return { removed: false, preserved: userFiles };
  } catch (err) {
    return { removed: false, preserved: [] };
  }
}

/**
 * Check if we should be silent.
 */
function shouldBeSilent() {
  return process.env.CI || process.env.WOGIFLOW_SILENT_UNINSTALL;
}

/**
 * Main entry point.
 */
function main() {
  const silent = shouldBeSilent();
  const manifest = readManifest();
  const useManifest = manifest !== null;

  let result;

  if (useManifest) {
    // Manifest-based: selective deletion, preserves user content
    result = manifestBasedCleanup(manifest);
  } else {
    // Legacy: no manifest found, use old behavior with warning
    result = legacyCleanup();
    if (!silent) {
      process.stderr.write('\n\x1b[33mWarning:\x1b[0m No WogiFlow manifest found — using legacy cleanup.\n');
      process.stderr.write('User-created files in .claude/ may be affected.\n\n');
    }
  }

  // Always: remove CLAUDE.md if WogiFlow-generated
  const claudeMdRemoved = removeClaudeMd();

  // Always: clean up .claude/ if empty
  const claudeDir = cleanupClaudeDir();

  // Output summary
  if (!silent) {
    process.stderr.write('\n\x1b[36mWogiFlow cleanup:\x1b[0m\n');

    if (useManifest) {
      if (result.removed.length > 0) {
        process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${result.removed.length} WogiFlow file(s)\n`);
      }
      for (const dir of (result.dirResults || [])) {
        if (dir.removed) {
          process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${dir.path}/\n`);
        }
      }
      if (result.preserved.length > 0) {
        process.stderr.write(`\n\x1b[32m✓ Preserved ${result.preserved.length} user file(s):\x1b[0m\n`);
        for (const f of result.preserved.slice(0, 10)) {
          process.stderr.write(`    ${f}\n`);
        }
        if (result.preserved.length > 10) {
          process.stderr.write(`    ... and ${result.preserved.length - 10} more\n`);
        }
      }
    } else {
      // Legacy output
      for (const dir of (result.dirResults || [])) {
        if (dir.removed) {
          process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${dir.path}/\n`);
        }
      }
      if (result.removedCommands && result.removedCommands.length > 0) {
        process.stderr.write(`  \x1b[31m✗\x1b[0m Removed ${result.removedCommands.length} command(s)\n`);
      }
    }

    if (claudeMdRemoved) {
      process.stderr.write(`  \x1b[31m✗\x1b[0m Removed CLAUDE.md\n`);
    }

    if (claudeDir.preserved.length > 0) {
      process.stderr.write(`\n\x1b[33mPreserved:\x1b[0m ${claudeDir.preserved.join(', ')} (not WogiFlow files)\n`);
    }

    process.stderr.write('\n\x1b[2mWogiFlow has been uninstalled. Your git history is preserved.\x1b[0m\n\n');
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
