#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to:
 * 1. Create minimal directory structure
 * 2. Copy .claude/commands/ (slash commands) - ESSENTIAL for immediate use
 * 3. Copy scripts/ (workflow scripts) - ensures scripts are updated on npm update
 * 4. Create pending-setup.json marker for AI to detect
 * 5. Print instructions to start AI assistant
 *
 * Full setup (config, skills, etc.) is done by the AI via /wogi-init command.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Get project root (where npm install was run, not node_modules/wogiflow)
// Validate INIT_CWD: must be an absolute path that exists (prevents injected values)
const RAW_INIT_CWD = process.env.INIT_CWD;
const PROJECT_ROOT = (RAW_INIT_CWD && path.isAbsolute(RAW_INIT_CWD) && fs.existsSync(RAW_INIT_CWD))
  ? RAW_INIT_CWD
  : process.cwd();

// Package root (where wogiflow is installed in node_modules)
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Directory structure (relative to project root)
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

// File permissions for security
const DIR_MODE = 0o755;  // rwxr-xr-x for directories
const FILE_MODE = 0o644; // rw-r--r-- for files

// Dangerous keys for prototype pollution protection
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Timeout for CLAUDE.md regeneration child process (ms)
// Override with WOGIFLOW_REGEN_TIMEOUT env var for slow systems
const REGEN_TIMEOUT = parseInt(process.env.WOGIFLOW_REGEN_TIMEOUT, 10) || 15000;

/**
 * Safe JSON parse with shallow prototype pollution protection.
 * Checks top-level keys only — sufficient for config/settings objects
 * which are flat structures (hooks, version, flags). Nested pollution
 * would require a recursive check, but our configs don't nest untrusted data.
 *
 * Inline copy — postinstall.js can't reliably require flow-utils.js
 * because it runs from npm context before scripts/ is fully copied.
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value on parse failure
 * @returns {Object} Parsed object or defaultValue
 */
function safeJsonParseString(jsonString, defaultValue = null) {
  try {
    const parsed = JSON.parse(jsonString);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaultValue;
    }
    // Check top-level keys only (shallow) — see JSDoc for rationale
    for (const key of Object.keys(parsed)) {
      if (DANGEROUS_KEYS.has(key)) {
        return defaultValue;
      }
    }
    return parsed;
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Safely close a file descriptor, ignoring errors
 * @param {number|null} fd - File descriptor to close
 */
function safeClose(fd) {
  if (fd !== null) {
    try { fs.closeSync(fd); } catch (err) { /* intentionally ignored */ }
  }
}

/**
 * Create minimal directory structure
 */
function createMinimalStructure() {
  const dirs = [
    WORKFLOW_DIR,
    STATE_DIR,
    path.join(WORKFLOW_DIR, 'changes'),
    path.join(WORKFLOW_DIR, 'specs')
  ];

  for (const dir of dirs) {
    // recursive:true handles existing dirs gracefully, no need for existsSync check
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }

  // Create minimal ready.json
  const readyPath = path.join(STATE_DIR, 'ready.json');
  if (!fs.existsSync(readyPath)) {
    fs.writeFileSync(readyPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: []
    }, null, 2), { mode: FILE_MODE });
  }
}

/**
 * Create pending-setup.json marker for AI to detect
 * Uses exclusive write flag to prevent race conditions
 */
function createPendingSetupMarker() {
  const markerPath = path.join(STATE_DIR, 'pending-setup.json');

  // Check-then-act is non-atomic, but EEXIST handling below provides safety
  if (fs.existsSync(path.join(WORKFLOW_DIR, 'config.json'))) {
    return;
  }

  // Use 'wx' flag for atomic creation - fails if file already exists
  // This prevents race conditions when multiple npm installs run in parallel
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      status: 'pending_ai_setup',
      createdAt: new Date().toISOString(),
      projectRoot: PROJECT_ROOT,
      version: '1.0'
    }, null, 2), { flag: 'wx', mode: FILE_MODE });
  } catch (err) {
    // EEXIST means file already exists - that's fine, another process created it
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Recursively copy a directory
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {boolean} mergeMode - If true, only copy files that don't exist in dest
 * @param {number} depth - Current recursion depth (for infinite loop protection)
 */
function copyDir(src, dest, mergeMode = false, depth = 0) {
  // Prevent infinite recursion via symlinks
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    if (process.env.DEBUG) {
      console.error(`[postinstall] Max directory depth exceeded: ${src}`);
    }
    return;
  }

  fs.mkdirSync(dest, { recursive: true, mode: DIR_MODE });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip symbolic links (security measure - prevents traversal attacks)
    if (entry.isSymbolicLink()) {
      continue;
    }

    // Validate entry name to prevent path traversal
    if (entry.name.includes('/') || entry.name.includes('\\') || entry.name === '..' || entry.name === '.') {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, mergeMode, depth + 1);
    } else {
      // In merge mode, skip files that already exist
      if (mergeMode && fs.existsSync(destPath)) {
        continue;
      }
      try {
        fs.copyFileSync(srcPath, destPath);
        // Skip chmod on Windows where it's unsupported and adds per-file overhead
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(destPath, FILE_MODE);
          } catch (err) {
            if (process.env.DEBUG) {
              console.error(`[postinstall] chmod failed: ${err.message}`);
            }
          }
        }
      } catch (err) {
        // Log but continue - one file failure shouldn't stop the entire install
        if (process.env.DEBUG) {
          console.error(`[postinstall] Failed to copy ${entry.name}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Copy essential .claude/ resources from package to project
 * This ensures commands are available immediately after npm install
 *
 * ALWAYS overwrites WogiFlow-owned files (commands, docs, rules, settings hooks)
 * to ensure npm update actually applies changes.
 * User-customizable files (config.json, ready.json, decisions.md) are NOT touched.
 */
function copyClaudeResources() {
  const claudeDir = path.join(PROJECT_ROOT, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true, mode: DIR_MODE });

  // Copy commands (always overwrite - these are WogiFlow skill definitions)
  const packageCommands = path.join(PACKAGE_ROOT, '.claude', 'commands');
  const projectCommands = path.join(claudeDir, 'commands');
  if (fs.existsSync(packageCommands)) {
    copyDir(packageCommands, projectCommands, false);
  }

  // Copy docs (always overwrite - these are WogiFlow documentation)
  const packageDocs = path.join(PACKAGE_ROOT, '.claude', 'docs');
  const projectDocs = path.join(claudeDir, 'docs');
  if (fs.existsSync(packageDocs)) {
    copyDir(packageDocs, projectDocs, false);
  }

  // Copy rules (always overwrite - these are WogiFlow coding rules)
  const packageRules = path.join(PACKAGE_ROOT, '.claude', 'rules');
  const projectRules = path.join(claudeDir, 'rules');
  if (fs.existsSync(packageRules)) {
    copyDir(packageRules, projectRules, false);
  }

  // Copy settings.json (hook configuration) - ESSENTIAL for hooks to work
  // ALWAYS update hooks section on every install/update to ensure new hook logic applies
  const packageSettings = path.join(PACKAGE_ROOT, '.claude', 'settings.json');
  const projectSettings = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(packageSettings)) {
    if (fs.existsSync(projectSettings)) {
      // Always merge hooks from package into existing settings
      try {
        // Use safeJsonParseString for prototype pollution protection
        const existing = safeJsonParseString(fs.readFileSync(projectSettings, 'utf-8'), {});
        const ours = safeJsonParseString(fs.readFileSync(packageSettings, 'utf-8'), {});
        // Always update hooks (core WogiFlow functionality)
        existing.hooks = ours.hooks;
        existing._wogiFlowManaged = true;
        existing._wogiFlowVersion = ours._wogiFlowVersion || '1.0.0';
        fs.writeFileSync(projectSettings, JSON.stringify(existing, null, 2), { mode: FILE_MODE });
      } catch (err) {
        // Parse error on existing file - overwrite with ours
        if (process.env.DEBUG) {
          console.error(`[postinstall] settings.json merge failed, overwriting: ${err.message}`);
        }
        try {
          fs.copyFileSync(packageSettings, projectSettings);
        } catch (err) {
          if (process.env.DEBUG) {
            console.error(`[postinstall] settings.json copy failed: ${err.message}`);
          }
        }
      }
    } else {
      // No existing settings - copy ours directly
      try {
        fs.copyFileSync(packageSettings, projectSettings);
        try {
          fs.chmodSync(projectSettings, FILE_MODE);
        } catch (err) { /* non-critical */ }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[postinstall] settings.json initial copy failed: ${err.message}`);
        }
      }
    }
  }

  // Note: skills/ is NOT copied here - /wogi-init will set up project-specific skills
}

/**
 * Copy scripts from package to project (for npm update scenario)
 * This ensures scripts are updated on npm install/update
 *
 * ALWAYS overwrites WogiFlow-owned scripts to ensure npm update applies changes.
 * Hook scripts, core modules, and adapters must stay in sync with the package version.
 */
function copyScriptsFromPackage() {
  const packageScripts = path.join(PACKAGE_ROOT, 'scripts');
  const projectScripts = path.join(PROJECT_ROOT, 'scripts');

  if (!fs.existsSync(packageScripts)) {
    if (process.env.DEBUG) {
      console.error('[postinstall] Package scripts not found');
    }
    return;
  }

  // Always overwrite scripts to ensure npm update propagates hook/core changes
  copyDir(packageScripts, projectScripts, false);

  // Make flow script executable
  const flowScript = path.join(projectScripts, 'flow');
  if (fs.existsSync(flowScript)) {
    try {
      fs.chmodSync(flowScript, 0o755);
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[postinstall] chmod flow script failed: ${err.message}`);
      }
    }
  }
}

/**
 * Copy WogiFlow-managed .workflow/ subdirectories from package to project.
 * These directories are package-owned and always overwritten on npm update.
 *
 * Managed directories:
 * - bridges/   — CLI bridge modules (base-bridge, claude-bridge)
 * - templates/ — CLAUDE.md Handlebars templates and partials
 * - agents/    — Review agent checklists (security, performance)
 * - lib/       — Shared libraries (config-substitution) used by bridges
 *
 * Without this step, `npx flow bridge sync` would fail because
 * .workflow/bridges/ wouldn't exist in the project directory.
 */
function copyWorkflowManagedDirs() {
  const managedDirs = ['bridges', 'templates', 'agents', 'lib'];

  for (const subdir of managedDirs) {
    const src = path.join(PACKAGE_ROOT, '.workflow', subdir);
    const dest = path.join(WORKFLOW_DIR, subdir);

    if (fs.existsSync(src)) {
      copyDir(src, dest, false);
    }
  }
}

/**
 * Get the WogiFlow package version from package.json
 * @returns {string} Version string or 'unknown'
 */
function getPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Regenerate CLAUDE.md from templates (for npm update scenario).
 * Only runs when config.json exists (project already initialized).
 *
 * Uses execFileSync to run the bridge in an isolated child process.
 * This avoids fragile require() chains from the postinstall npm context
 * where module resolution can fail silently (base-bridge → flow-utils → lib/).
 *
 * Design: The child process runs with cwd=PROJECT_ROOT (not PACKAGE_ROOT)
 * because the bridge uses relative requires that resolve from the project root:
 *   .workflow/bridges/ → base-bridge → ../../scripts/flow-utils → ../.workflow/lib/
 * This is intentional — the bridge must run in the project's directory tree.
 */
function regenerateClaudeMd() {
  // Only regenerate if project is already initialized
  if (!isAlreadyInitialized()) {
    return;
  }

  // Version-based skip gate: avoid redundant child process spawn
  // when the same package version was already used to regenerate
  const versionFile = path.join(STATE_DIR, '.claude-md-regen-version');
  const pkgVersion = getPackageVersion();
  try {
    const lastVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    if (lastVersion === pkgVersion && !process.env.WOGIFLOW_FORCE_REGEN) {
      if (process.env.DEBUG) {
        console.error(`[postinstall] CLAUDE.md already regenerated for v${pkgVersion}, skipping`);
      }
      return;
    }
  } catch (err) {
    // No version file yet — proceed with regen
  }

  // Check that bridges exist (just copied by copyWorkflowManagedDirs)
  const bridgesIndex = path.join(PROJECT_ROOT, '.workflow', 'bridges', 'index.js');
  if (!fs.existsSync(bridgesIndex)) {
    if (process.env.DEBUG) {
      console.error('[postinstall] Bridge module not found, skipping CLAUDE.md regen');
    }
    return;
  }

  try {
    // Pass PROJECT_ROOT via env var instead of string interpolation in -e script.
    // This avoids shell/quoting issues with paths containing special characters.
    const script = [
      'try {',
      '  const { getBridge } = require("./.workflow/bridges");',
      '  const bridge = getBridge({ projectDir: process.env.WOGIFLOW_PROJECT_ROOT });',
      '  bridge.generateRulesFile({ force: true });',
      '  process.exit(0);',
      '} catch (err) {',
      '  process.stderr.write(err.message);',
      '  process.exit(1);',
      '}'
    ].join('\n');

    const result = execFileSync(process.execPath, ['-e', script], {
      cwd: PROJECT_ROOT,
      timeout: REGEN_TIMEOUT,
      env: { ...process.env, WOGIFLOW_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Log stdout in DEBUG mode (may contain diagnostic info from bridge)
    if (process.env.DEBUG && result && result.length > 0) {
      console.error(`[postinstall] CLAUDE.md regen stdout: ${result.toString().trim()}`);
    }

    // Record successful regen version for skip gate
    try {
      fs.writeFileSync(versionFile, pkgVersion, { mode: FILE_MODE });
    } catch (err) {
      // Non-critical — next install will just regen again
    }

    // Respect CI/silent mode for user-facing messages
    if (!shouldBeSilent()) {
      process.stderr.write('\x1b[36mWogiFlow:\x1b[0m Updated CLAUDE.md from latest templates.\n');
    }
  } catch (err) {
    // Non-fatal — CLAUDE.md regeneration failure shouldn't break npm install
    if (!shouldBeSilent()) {
      process.stderr.write('\x1b[33mWogiFlow:\x1b[0m Could not auto-update CLAUDE.md. Run: npx flow bridge sync\n');
    }
    if (process.env.DEBUG) {
      const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      console.error('[postinstall] CLAUDE.md regen failed:', stderr);
    }
  }
}

/**
 * Generate a bootstrap CLAUDE.md for fresh installs.
 * This creates a minimal but functional CLAUDE.md that:
 * - Has task gating rules (soft enforcement matching the hook hard enforcement)
 * - Points to /wogi-init or /wogi-onboard for full setup
 * - Will be overwritten by the full template on bridge sync
 *
 * Without this, fresh installs have hooks (hard enforcement) but no CLAUDE.md
 * (soft enforcement), so Claude Code gets "BLOCKED" errors instead of routing
 * proactively. The bootstrap version provides a smoother first-run experience.
 */
function generateBootstrapClaudeMd() {
  // Only generate if project is NOT initialized (no config.json)
  // If initialized, regenerateClaudeMd() handles it
  if (isAlreadyInitialized()) {
    return;
  }

  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');

  // Don't overwrite an existing CLAUDE.md (user may have created one manually)
  if (fs.existsSync(claudeMdPath)) {
    return;
  }

  const bootstrapContent = `# Project Instructions

You are an AI development assistant using the WogiFlow methodology v1.0.

---

## Task Gating (MANDATORY — NO EXCEPTIONS)

**STOP. Before doing ANYTHING with a user message, you MUST route it through a \`/wogi-*\` command.**

**EVERY user message** MUST be routed through either:
1. **A matching \`/wogi-*\` command** (e.g., "code review" → \`/wogi-review\`, "show tasks" → \`/wogi-ready\`)
2. **\`/wogi-start\`** for everything else (the universal fallback router)

This applies to ALL message types — implementation requests, questions, exploration, research, operational requests. No exceptions.

**You do NOT handle requests directly.** Always invoke a \`/wogi-*\` command first. If you find yourself thinking "this is just a question, I can handle it directly" — that thought is the exact bypass this rule exists to prevent.

**Do NOT use EnterPlanMode directly.** Route through \`/wogi-start\` which will use plan mode internally when appropriate.

---

## Setup Required

This is a **bootstrap** CLAUDE.md. To get the full WogiFlow experience, complete setup:

**New project?**
  Say \`"setup wogiflow"\` or run \`/wogi-init\`

**Existing project?**
  Run \`/wogi-onboard\`

After setup, run \`npx flow bridge sync\` to generate the full CLAUDE.md from templates.

---

## Core Commands

- \`/wogi-ready\` - Show available tasks
- \`/wogi-start TASK-X\` - Start a task (or \`/wogi-start "description"\` to route any request)
- \`/wogi-story "title"\` - Create story with acceptance criteria
- \`/wogi-status\` - Project overview
- \`/wogi-health\` - Check workflow health
- \`/wogi-review\` - Code review
- \`/wogi-bug "description"\` - Report a bug

---

*Bootstrap version — generated by WogiFlow postinstall.*
*Run \`/wogi-init\` or \`/wogi-onboard\`, then \`npx flow bridge sync\` for full version.*
`;

  try {
    fs.writeFileSync(claudeMdPath, bootstrapContent, { mode: FILE_MODE });
    if (!shouldBeSilent()) {
      process.stderr.write('\x1b[36mWogiFlow:\x1b[0m Created bootstrap CLAUDE.md (run /wogi-init or /wogi-onboard for full setup).\n');
    }
  } catch (err) {
    // Non-fatal — bootstrap CLAUDE.md is a UX improvement, not required
    if (process.env.DEBUG) {
      console.error(`[postinstall] Bootstrap CLAUDE.md failed: ${err.message}`);
    }
  }
}

/**
 * Check if we should be completely silent (CI only)
 */
function shouldBeSilent() {
  if (process.env.CI) return true;
  if (process.env.WOGIFLOW_SKIP_POSTINSTALL) return true;
  return false;
}

/**
 * Check if already initialized
 */
function isAlreadyInitialized() {
  return fs.existsSync(path.join(WORKFLOW_DIR, 'config.json'));
}

/**
 * Known WogiFlow extension packages.
 * Each must export registerHooks({ settingsPath, projectRoot })
 */
const EXTENSION_PACKAGES = ['@wogiflow/teams'];

/**
 * Detect and register third-party WogiFlow extensions.
 * Extensions (e.g., @wogiflow/teams) can register their hooks into
 * .claude/settings.json by exporting a registerHooks() function.
 *
 * This runs during postinstall, after core settings are written.
 * If the extension package is not installed, this is a silent no-op.
 */
function detectAndRegisterExtensions() {
  const settingsPath = path.join(PROJECT_ROOT, '.claude', 'settings.json');

  for (const pkg of EXTENSION_PACKAGES) {
    try {
      // require.resolve throws if not installed — expected and silent
      require.resolve(pkg, { paths: [PROJECT_ROOT] });

      // Package is installed — try to load and register
      const extension = require(pkg);

      if (typeof extension.registerHooks === 'function') {
        const result = extension.registerHooks({
          settingsPath,
          projectRoot: PROJECT_ROOT
        });

        if (!shouldBeSilent()) {
          const count = (result && result.hooksRegistered) || 0;
          process.stderr.write(`\x1b[36mWogiFlow:\x1b[0m Registered extension: ${pkg} (${count} hooks)\n`);
        }
      } else if (process.env.DEBUG) {
        console.error(`[postinstall] Extension ${pkg} found but has no registerHooks() export`);
      }
    } catch (err) {
      // Extension not installed — silent skip (expected for most users)
      if (process.env.DEBUG && !err.message.includes('Cannot find module')) {
        console.error(`[postinstall] Extension detection for ${pkg}: ${err.message}`);
      }
    }
  }
}

/**
 * Main entry point (sync - no async operations needed)
 */
function main() {
  // Always create minimal structure first
  createMinimalStructure();

  // Copy essential .claude/ resources (commands, docs, rules)
  // This ensures slash commands are available immediately
  copyClaudeResources();

  // Copy scripts (for npm update scenario)
  // This ensures scripts are updated when running npm install/update
  copyScriptsFromPackage();

  // Copy WogiFlow-managed .workflow/ subdirectories (bridges, templates, agents)
  // These are needed for bridge sync, CLAUDE.md generation, and agent definitions.
  // Always overwrite — these are package-managed, not user-customizable.
  copyWorkflowManagedDirs();

  // Regenerate CLAUDE.md from updated templates (for npm update scenario)
  // This ensures the AI reads fresh instructions matching the new package version.
  // Must run AFTER copyWorkflowManagedDirs() so templates/bridges are up to date.
  regenerateClaudeMd();

  // Generate bootstrap CLAUDE.md for fresh installs (no config.json yet)
  // This provides minimal task gating + setup instructions so Claude Code
  // works immediately. Will be replaced by full template on /wogi-init or /wogi-onboard.
  generateBootstrapClaudeMd();

  // Detect and register third-party WogiFlow extensions (e.g., @wogiflow/teams)
  // Must run AFTER copyClaudeResources() so settings.json exists to append hooks to.
  detectAndRegisterExtensions();

  // Create marker for AI to detect (unless already initialized)
  createPendingSetupMarker();

  // Silent in CI or when explicitly disabled
  if (shouldBeSilent()) {
    return;
  }

  // Try to write directly to terminal, bypassing npm output capture
  // /dev/tty is Unix-specific; npm normally captures postinstall output
  // On Windows or in environments without TTY, fallback to stderr
  let output = process.stderr;
  let ttyFd = null;

  if (process.platform !== 'win32') {
    try {
      // Combine access check and open into single try-catch to avoid TOCTOU
      ttyFd = fs.openSync('/dev/tty', 'w');
      output = { write: (msg) => fs.writeSync(ttyFd, msg) };
    } catch (err) {
      // /dev/tty not available (no terminal, CI, etc.) - fallback to stderr
      ttyFd = null;
    }
  }

  try {
    // Already initialized - confirm update applied
    if (isAlreadyInitialized()) {
      output.write('\x1b[36mWogiFlow:\x1b[0m Updated scripts, hooks, and commands to latest version.\n');
      return;
    }

    // Show setup instructions - point to AI assistant
    const msg = `
\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m             \x1b[1mWogiFlow Installed Successfully!\x1b[0m               \x1b[36m║\x1b[0m
\x1b[36m╠══════════════════════════════════════════════════════════════╣\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[33mTo complete setup, start Claude Code and then:\x1b[0m             \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1mNew project?\x1b[0m                                               \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    Say \x1b[33m"setup wogiflow"\x1b[0m or run \x1b[33m/wogi-init\x1b[0m                  \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[2mSets up workflow from scratch with guided wizard\x1b[0m          \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1mExisting project?\x1b[0m                                          \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    Run \x1b[33m/wogi-onboard\x1b[0m                                        \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[2mAnalyzes your codebase and sets up workflow with context\x1b[0m  \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m

`;
    output.write(msg);
  } finally {
    // Always close TTY file descriptor if opened
    safeClose(ttyFd);
  }
}

// Run
try {
  main();
} catch (err) {
  // Don't fail npm install on postinstall errors
  // Sanitize PACKAGE_ROOT from error messages to avoid leaking internal node_modules paths
  const safeMessage = err.message.replace(PACKAGE_ROOT, '[wogiflow]');
  const errorInfo = process.env.DEBUG ? ` (${err.code || 'unknown'})` : '';
  process.stderr.write(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${safeMessage}${errorInfo}\n`);
  createMinimalStructure();
}
