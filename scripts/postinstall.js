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
 * Safe JSON parse with recursive prototype pollution protection.
 * Checks all nested keys — prevents deep prototype pollution attacks.
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
    if (hasDangerousKeys(parsed)) {
      return defaultValue;
    }
    return parsed;
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Recursively check an object for dangerous prototype-polluting keys.
 * @param {*} obj - Object to check
 * @returns {boolean} True if dangerous keys found
 */
function hasDangerousKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasDangerousKeys(item)) return true;
    }
    return false;
  }
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys(obj[key])) return true;
  }
  return false;
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

  // Create prompt-history.json from template (so prompt history works from first session)
  const promptHistoryPath = path.join(STATE_DIR, 'prompt-history.json');
  if (!fs.existsSync(promptHistoryPath)) {
    const templatePath = path.join(STATE_DIR, 'prompt-history.json.template');
    try {
      const rawContent = fs.existsSync(templatePath)
        ? fs.readFileSync(templatePath, 'utf-8')
        : JSON.stringify({ prompts: [], version: 1 }, null, 2);
      // Validate template is valid JSON before writing (with proto check)
      const parsed = safeJsonParseString(rawContent, { prompts: [], version: 1 });
      fs.writeFileSync(promptHistoryPath, JSON.stringify(parsed, null, 2), { mode: FILE_MODE });
    } catch (err) {
      // Template was corrupted or unreadable — log for debugging, use fallback
      if (process.env.DEBUG) {
        console.error(`[postinstall] Template corruption at ${templatePath}: ${err.message}`);
      }
      fs.writeFileSync(promptHistoryPath, JSON.stringify({
        prompts: [],
        version: 1
      }, null, 2), { mode: FILE_MODE });
    }
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
      // Skip _internal directories — these contain project-specific rules
      // that should not be distributed to user projects
      if (entry.name.startsWith('_')) continue;
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
 * Rewrite hook command paths from local dev paths to package paths.
 * The package's settings.json uses local paths (node scripts/hooks/...)
 * for development. User projects need package paths (node node_modules/wogiflow/scripts/hooks/...).
 * @param {Object} settings - Parsed settings object (mutated in place)
 */
function rewriteHookPaths(settings) {
  if (!settings || !settings.hooks) return;
  for (const hookList of Object.values(settings.hooks)) {
    if (!Array.isArray(hookList)) continue;
    for (const entry of hookList) {
      if (!entry.hooks || !Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) {
        if (hook.command && typeof hook.command === 'string') {
          hook.command = hook.command.replace(
            /^node scripts\//,
            'node node_modules/wogiflow/scripts/'
          );
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
        // Rewrite hook paths: package uses local dev paths (node scripts/hooks/...)
        // but user projects need package paths (node node_modules/wogiflow/scripts/hooks/...)
        rewriteHookPaths(ours);
        // Always update hooks (core WogiFlow functionality)
        existing.hooks = ours.hooks;
        existing._wogiFlowManaged = true;
        existing._wogiFlowVersion = getPackageVersion();
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
      // No existing settings - read, rewrite paths, then write
      try {
        const ours = safeJsonParseString(fs.readFileSync(packageSettings, 'utf-8'), null);
        if (ours) {
          rewriteHookPaths(ours);
          fs.writeFileSync(projectSettings, JSON.stringify(ours, null, 2), { mode: FILE_MODE });
        } else {
          fs.copyFileSync(packageSettings, projectSettings);
        }
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
 * Generate a manifest of all WogiFlow-owned files in .claude/.
 * Used by preuninstall.js to selectively delete only WogiFlow files,
 * preserving user-created content (custom skills, rules, docs).
 */
function generateManifest() {
  const claudeDir = path.join(PROJECT_ROOT, '.claude');
  const manifestPath = path.join(claudeDir, '.wogiflow-manifest.json');
  const files = [];

  // Walk directories that WogiFlow copies into
  const ownedDirs = ['commands', 'docs', 'rules'];
  for (const dir of ownedDirs) {
    const dirPath = path.join(claudeDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDir(dirPath, claudeDir, files);
  }

  // Settings.json is WogiFlow-managed (hooks section)
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    files.push('settings.json');
  }

  const manifest = {
    version: 1,
    generatedBy: 'wogiflow@' + getPackageVersion(),
    generatedAt: new Date().toISOString(),
    files: files,
    directories: ['.workflow']
  };

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: FILE_MODE });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[postinstall] Failed to write manifest: ${err.message}`);
    }
  }
}

/**
 * Recursively walk a directory and collect all file paths relative to baseDir.
 * @param {string} dir - Directory to walk
 * @param {string} baseDir - Base directory for relative paths
 * @param {string[]} files - Array to push relative paths into
 */
function walkDir(dir, baseDir, files) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === '.' || entry.name === '..' || entry.name === '.DS_Store') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir, files);
      } else {
        files.push(path.relative(baseDir, fullPath));
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[postinstall] walkDir error: ${err.message}`);
    }
  }
}

/**
 * Get the WogiFlow package version from package.json
 * @returns {string} Version string or 'unknown'
 */
function getPackageVersion() {
  try {
    const content = fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8');
    const pkg = safeJsonParseString(content, null);
    return (pkg && pkg.version) || 'unknown';
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

  // Check that bridges exist in the package
  const bridgesIndex = path.join(PACKAGE_ROOT, '.workflow', 'bridges', 'index.js');
  if (!fs.existsSync(bridgesIndex)) {
    if (process.env.DEBUG) {
      console.error('[postinstall] Bridge module not found in package, skipping CLAUDE.md regen');
    }
    return;
  }

  try {
    // Load bridges from the PACKAGE (not the project) and generate CLAUDE.md
    // into the PROJECT directory. This avoids needing bridges copied to the project.
    const script = [
      'try {',
      '  const bridgesPath = require("path").join(process.env.WOGIFLOW_PACKAGE_ROOT, ".workflow", "bridges");',
      '  const { getBridge } = require(bridgesPath);',
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
      env: { ...process.env, WOGIFLOW_PROJECT_ROOT: PROJECT_ROOT, WOGIFLOW_PACKAGE_ROOT: PACKAGE_ROOT },
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
 * Migrate stale hooks from settings.local.json.
 *
 * Problem: Early WogiFlow versions (<=1.0.0) wrote hooks to settings.local.json.
 * When npm update installs a newer version, postinstall correctly updates
 * settings.json — but settings.local.json overrides it (Claude Code merges
 * .local on top). The stale hooks have:
 * - Narrow PreToolUse matcher (missing Skill|Bash|Read|Glob|Grep|EnterPlanMode|Agent|NotebookEdit|WebSearch|WebFetch)
 * - Absolute local paths instead of node_modules paths
 * - Missing ConfigChange hook
 *
 * Fix: Detect hooks in settings.local.json with an outdated _wogiFlowVersion
 * and remove them, so the correct settings.json hooks take effect.
 * Permissions are preserved — only the hooks block is removed.
 */
function migrateStaleLocalHooks() {
  const localSettingsPath = path.join(PROJECT_ROOT, '.claude', 'settings.local.json');

  try {
    if (!fs.existsSync(localSettingsPath)) {
      return; // No local settings — nothing to migrate
    }

    const content = fs.readFileSync(localSettingsPath, 'utf-8');
    const local = safeJsonParseString(content, null);

    if (!local || !local.hooks) {
      return; // No hooks in local settings — nothing to migrate
    }

    // Check if local hooks are from an older WogiFlow version
    const localVersion = local._wogiFlowVersion || '0.0.0';
    const currentVersion = getPackageVersion();

    if (localVersion === currentVersion) {
      return; // Versions match — hooks are current, no migration needed
    }

    // Stale hooks detected — remove them so settings.json hooks take effect
    // Preserve everything else (permissions, user overrides)
    delete local.hooks;

    // Update version marker to current
    local._wogiFlowVersion = currentVersion;
    local._wogiFlowHooksMigratedAt = new Date().toISOString();

    fs.writeFileSync(localSettingsPath, JSON.stringify(local, null, 2), { mode: FILE_MODE });

    if (!shouldBeSilent()) {
      process.stderr.write(
        `\x1b[36mWogiFlow:\x1b[0m Migrated stale hooks from settings.local.json (v${localVersion} → v${currentVersion}). Hooks now served from settings.json.\n`
      );
    }

    if (process.env.DEBUG) {
      console.error(`[postinstall] Removed stale hooks from settings.local.json (was v${localVersion}, now v${currentVersion})`);
    }
  } catch (err) {
    // Non-fatal — stale hooks are a UX problem, not a crash-worthy issue
    if (process.env.DEBUG) {
      console.error(`[postinstall] Local hooks migration failed: ${err.message}`);
    }
  }
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

  // Generate manifest of WogiFlow-owned files for safe uninstall
  generateManifest();

  // Migrate stale hooks from settings.local.json (if present).
  // Must run AFTER copyClaudeResources() updates settings.json,
  // so the correct hooks are already in place when stale ones are removed.
  migrateStaleLocalHooks();

  // NOTE: Scripts and .workflow/ managed dirs (bridges, templates, agents, lib) are
  // NO LONGER copied to the project. They live exclusively in the wogiflow package
  // under node_modules/wogiflow/. This keeps user projects clean.

  // Ensure .workflow/package.json exists with "type": "commonjs".
  // Required when the project root has "type": "module" — without it,
  // Node.js inherits ESM and require() calls in hooks fail.
  const workflowPkg = path.join(WORKFLOW_DIR, 'package.json');
  try {
    fs.writeFileSync(workflowPkg, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.warn(`[postinstall] Warning: Failed to create .workflow/package.json: ${err.message}`);
    }
  }

  // Regenerate CLAUDE.md from package templates (for npm update scenario)
  // This ensures the AI reads fresh instructions matching the new package version.
  // Templates are read from the package via PACKAGE_PATHS (no project copy needed).
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
      output.write('\x1b[36mWogiFlow:\x1b[0m Updated hooks and commands to latest version.\n');
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
