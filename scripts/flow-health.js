#!/usr/bin/env node

/**
 * Wogi Flow - Health Check
 *
 * Verifies workflow files are in sync and properly configured.
 *
 * Usage:
 *   flow health         Standard health check
 *   flow health --deep  Deep audit with folder/file analysis
 *   flow health --json  JSON output
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  WORKFLOW_DIR,
  fileExists,
  dirExists,
  validateJson,
  countAppMapComponents,
  countRequestLogEntries,
  getLastRequestLogEntry,
  getGitStatus,
  countFiles,
  color,
  printSection,
  printHeader,
  success,
  warn,
  error,
  info,
  validatePermissions,
  parseFlags,
  outputJson,
  checkSpecMigration,
  safeJsonParse
} = require('./flow-utils');

const { execSync } = require('child_process');

/**
 * Check Claude Code version and compare against minimum recommended (2.1.23)
 * @returns {{ version: string|null, meetsMinimum: boolean }}
 */
function checkClaudeCodeVersion() {
  try {
    const output = execSync('claude --version 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Parse version from output like "claude 2.1.23" or "Claude Code 2.1.23"
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (!match) {
      return { version: null, meetsMinimum: true };
    }

    const version = match[1];
    const [major, minor, patch] = version.split('.').map(Number);

    // Minimum recommended: 2.1.23
    const meetsMinimum = major > 2 ||
      (major === 2 && minor > 1) ||
      (major === 2 && minor === 1 && patch >= 23);

    // 2.1.50+ features: worktree hooks, agent isolation, agent listing
    const meets2150 = major > 2 ||
      (major === 2 && minor > 1) ||
      (major === 2 && minor === 1 && patch >= 50);

    return { version, meetsMinimum, meets2150 };
  } catch {
    return { version: null, meetsMinimum: true, meets2150: false };
  }
}

function main() {
  console.log(color('cyan', 'Wogi Flow Health Check'));
  console.log('========================');
  console.log('');

  let issues = 0;
  let warnings = 0;

  // Check required files
  printSection('Checking required files...');

  const requiredFiles = [
    { path: PATHS.config, name: '.workflow/config.json' },
    { path: PATHS.ready, name: '.workflow/state/ready.json' },
    { path: PATHS.requestLog, name: '.workflow/state/request-log.md' },
    { path: PATHS.decisions, name: '.workflow/state/decisions.md' },
    { path: PATHS.progress, name: '.workflow/state/progress.md' },
  ];

  // Add all active registry map files to required files check
  try {
    const { getActiveRegistries, STATE_DIR: stateDir } = require('./flow-utils');
    for (const reg of getActiveRegistries()) {
      requiredFiles.push({
        path: path.join(stateDir, reg.mapFile),
        name: `.workflow/state/${reg.mapFile}`
      });
    }
  } catch {
    // Fallback: just check app-map.md
    requiredFiles.push({ path: PATHS.appMap, name: '.workflow/state/app-map.md' });
  }

  for (const file of requiredFiles) {
    if (fileExists(file.path)) {
      console.log(`  ${color('green', '✓')} ${file.name}`);
    } else {
      console.log(`  ${color('red', '✗')} ${file.name} - MISSING`);
      issues++;
    }
  }

  // Check CLI-specific rules file
  let cliType = 'claude-code'; // default
  if (fileExists(PATHS.config)) {
    try {
      const config = require(PATHS.config);
      cliType = config.cli?.type || 'claude-code';
    } catch {}
  }

  // Only Claude Code is supported
  const rulesFile = { path: path.join(PROJECT_ROOT, 'CLAUDE.md'), name: 'CLAUDE.md' };
  if (fileExists(rulesFile.path)) {
    console.log(`  ${color('green', '✓')} ${rulesFile.name} (${cliType})`);
  } else {
    console.log(`  ${color('red', '✗')} ${rulesFile.name} - MISSING (${cliType})`);
    issues++;
  }

  // Check Claude Code version (if applicable)
  if (cliType === 'claude-code') {
    const versionCheck = checkClaudeCodeVersion();
    if (versionCheck.version) {
      if (versionCheck.meetsMinimum) {
        console.log(`  ${color('green', '✓')} Claude Code version: ${versionCheck.version}`);
      } else {
        console.log(`  ${color('yellow', '○')} Claude Code version: ${versionCheck.version} (2.1.23+ recommended)`);
        console.log(`    ${color('dim', '→ Older versions may have silent search failures and shared system issues')}`);
        warnings++;
      }

      // Report 2.1.50+ features
      if (versionCheck.meets2150) {
        console.log(`  ${color('green', '✓')} Claude Code 2.1.50+ features available:`);
        console.log(`    ${color('dim', '→ WorktreeCreate/WorktreeRemove hooks')}`);
        console.log(`    ${color('dim', '→ Agent isolation: "worktree" mode')}`);
        console.log(`    ${color('dim', '→ claude agents CLI command')}`);

        // Run 'claude agents' diagnostic
        try {
          const agentsOutput = execSync('claude agents 2>/dev/null || echo ""', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000
          }).trim();
          if (agentsOutput) {
            const agentCount = agentsOutput.split('\n').filter(l => l.trim()).length;
            console.log(`  ${color('green', '✓')} claude agents: ${agentCount} agent(s) configured`);
          } else {
            console.log(`  ${color('dim', '○')} claude agents: no agents configured`);
          }
        } catch {
          console.log(`  ${color('dim', '○')} claude agents: command unavailable`);
        }
      }
    }
  }

  // Check required directories
  console.log('');
  printSection('Checking directories...');

  const requiredDirs = [
    { path: PATHS.components, name: '.workflow/state/components' },
    { path: PATHS.specs, name: '.workflow/specs' },
    { path: PATHS.changes, name: '.workflow/changes' },
    { path: PATHS.bugs, name: '.workflow/bugs' },
    { path: PATHS.archive, name: '.workflow/archive' },
    { path: path.join(PROJECT_ROOT, 'agents'), name: 'agents' },
    { path: path.join(PROJECT_ROOT, 'scripts'), name: 'scripts' },
  ];

  for (const dir of requiredDirs) {
    if (dirExists(dir.path)) {
      console.log(`  ${color('green', '✓')} ${dir.name}/`);
    } else {
      console.log(`  ${color('red', '✗')} ${dir.name}/ - MISSING`);
      issues++;
    }
  }

  // Check universal structure directories (optional but recommended)
  console.log('');
  printSection('Checking universal structure...');

  const universalDirs = [
    { path: path.join(PROJECT_ROOT, '.workflow', 'models'), name: '.workflow/models' },
    { path: path.join(PROJECT_ROOT, '.workflow', 'bridges'), name: '.workflow/bridges' },
    { path: path.join(PROJECT_ROOT, '.workflow', 'templates'), name: '.workflow/templates' },
  ];

  for (const dir of universalDirs) {
    if (dirExists(dir.path)) {
      console.log(`  ${color('green', '✓')} ${dir.name}/`);
    } else {
      console.log(`  ${color('yellow', '○')} ${dir.name}/ - not found (run 'flow migrate' to add)`);
      warnings++;
    }
  }

  // Check model registry
  const registryPath = path.join(PROJECT_ROOT, '.workflow', 'models', 'registry.json');
  if (fileExists(registryPath)) {
    const result = validateJson(registryPath);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Model registry valid`);
    } else {
      console.log(`  ${color('red', '✗')} Model registry invalid JSON`);
      issues++;
    }
  }

  // Check knowledge files (optional - generated by onboard)
  console.log('');
  printSection('Checking knowledge files...');

  // Use getSpecFilePath for backward compatibility (checks specs/ then state/)
  const { getSpecFilePath } = require('./flow-utils');
  const knowledgeFiles = [
    { path: getSpecFilePath('stack', { warnOnOld: false }) || PATHS.specsStack, name: 'stack.md', category: 'stack' },
    { path: getSpecFilePath('architecture', { warnOnOld: false }) || PATHS.specsArchitecture, name: 'architecture.md', category: 'architecture' },
    { path: getSpecFilePath('testing', { warnOnOld: false }) || PATHS.specsTesting, name: 'testing.md', category: 'testing' },
  ];

  // Try to load drift detection
  let driftStatus = null;
  try {
    const { checkAllDrift } = require('./flow-knowledge-sync');
    driftStatus = checkAllDrift();
  } catch {
    // Knowledge sync not available
  }

  for (const file of knowledgeFiles) {
    if (fileExists(file.path)) {
      // Check sync status if available
      const categoryStatus = driftStatus?.categories?.[file.category];
      if (categoryStatus?.status === 'drifted') {
        console.log(`  ${color('yellow', '⚠')} ${file.name} - out of sync (${categoryStatus.reason})`);
        warnings++;
      } else {
        console.log(`  ${color('green', '✓')} ${file.name}`);
      }
    } else {
      console.log(`  ${color('yellow', '○')} ${file.name} - not found (run 'flow onboard' to generate)`);
      warnings++;
    }
  }

  // Show sync recommendation if drift detected
  if (driftStatus?.anyDrift) {
    console.log('');
    console.log(`    ${color('dim', "Run 'flow knowledge-sync regenerate' to update")}`);
  }

  // Validate config.json
  console.log('');
  printSection('Validating config.json...');

  if (fileExists(PATHS.config)) {
    const result = validateJson(PATHS.config);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Valid JSON`);
    } else {
      console.log(`  ${color('red', '✗')} Invalid JSON syntax`);
      issues++;
    }
  }

  // Validate ready.json
  console.log('');
  printSection('Validating ready.json...');

  if (fileExists(PATHS.ready)) {
    const result = validateJson(PATHS.ready);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Valid JSON`);
    } else {
      console.log(`  ${color('red', '✗')} Invalid JSON syntax`);
      issues++;
    }
  }

  // Check enforcement settings
  console.log('');
  printSection('Checking enforcement...');

  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
  if (fileExists(claudeMdPath)) {
    let claudeMdContent, claudeMdSize;
    try {
      claudeMdContent = fs.readFileSync(claudeMdPath, 'utf-8');
      claudeMdSize = Buffer.byteLength(claudeMdContent, 'utf-8');
    } catch (err) {
      console.log(`  ${color('yellow', '⚠')} Could not read CLAUDE.md: ${err.message}`);
      warnings++;
      claudeMdContent = '';
      claudeMdSize = 0;
    }
    const sizeKb = Math.round(claudeMdSize / 1024);

    // Check CLAUDE.md size (should be under 20KB for reliable loading)
    if (sizeKb <= 20) {
      console.log(`  ${color('green', '✓')} CLAUDE.md size: ${sizeKb}KB (under 20KB limit)`);
    } else {
      console.log(`  ${color('yellow', '⚠')} CLAUDE.md size: ${sizeKb}KB (over 20KB - may get truncated)`);
      warnings++;
    }

    // Check if enforcement section is at top (within first 100 lines)
    const lines = claudeMdContent.split('\n').slice(0, 100);
    const hasEnforcementAtTop = lines.some(line =>
      line.includes('MANDATORY') && line.includes('Task Gating')
    );

    if (hasEnforcementAtTop) {
      console.log(`  ${color('green', '✓')} Enforcement section: FOUND at top of CLAUDE.md`);
    } else {
      console.log(`  ${color('yellow', '⚠')} Enforcement section not found at top of CLAUDE.md`);
      warnings++;
    }
  }

  // Check strict mode in config
  if (fileExists(PATHS.config)) {
    const configResult = validateJson(PATHS.config);
    if (configResult.valid) {
      try {
        const config = safeJsonParse(PATHS.config, {});
        if (config.enforcement?.strictMode === true) {
          console.log(`  ${color('green', '✓')} Strict mode: ENABLED`);
        } else if (config.enforcement?.strictMode === false) {
          console.log(`  ${color('yellow', '⚠')} Strict mode: DISABLED (Claude may skip task creation)`);
          warnings++;
        } else {
          console.log(`  ${color('yellow', '⚠')} Strict mode: NOT CONFIGURED (add enforcement section to config.json)`);
          warnings++;
        }
      } catch (err) {
        console.log(`  ${color('yellow', '⚠')} Could not parse config.json for strict mode check`);
        warnings++;
      }
    }
  }

  // Check app-map sync
  console.log('');
  printSection('Checking app-map sync...');

  const srcComponents = path.join(PROJECT_ROOT, 'src', 'components');
  if (dirExists(srcComponents)) {
    const componentCount = countFiles(srcComponents, ['.tsx', '.jsx']);
    const mappedCount = countAppMapComponents();

    console.log(`  Components in src/: ${componentCount}`);
    console.log(`  Components in app-map: ${mappedCount}`);

    if (componentCount > mappedCount + 5) {
      console.log(`  ${color('yellow', '⚠')} App-map may be out of sync`);
      console.log('    Run: ./scripts/flow update-map scan src/components');
      warnings++;
    } else {
      console.log(`  ${color('green', '✓')} App-map appears in sync`);
    }
  } else {
    console.log(`  ${color('yellow', '⚠')} src/components/ not found (may be OK for new projects)`);
  }

  // Check permission rules (Claude Code specific)
  console.log('');
  printSection('Checking permission rules...');

  const settingsPath = path.join(PROJECT_ROOT, '.claude', 'settings.local.json');
  if (fileExists(settingsPath)) {
    try {
      const settings = safeJsonParse(settingsPath, {});
      const permissions = settings.permissions?.allow || [];

      // Use shared validation function
      const validation = validatePermissions(permissions);

      console.log(`  Total rules: ${validation.analysis.total}`);

      // Show duplicates (warning)
      if (validation.analysis.duplicates.length > 0) {
        console.log(`  ${color('yellow', '⚠')} ${validation.analysis.duplicates.length} duplicate rule(s) found`);
        for (const dup of validation.analysis.duplicates.slice(0, 3)) {
          console.log(`    - ${dup}`);
        }
        warnings++;
      } else {
        console.log(`  ${color('green', '✓')} No duplicate rules`);
      }

      // Show overly broad rules (issue)
      if (validation.analysis.overbroad.length > 0) {
        console.log(`  ${color('yellow', '⚠')} ${validation.analysis.overbroad.length} overly broad rule(s)`);
        for (const ob of validation.analysis.overbroad) {
          console.log(`    - ${ob}`);
        }
        warnings++;
      }

      // Show shadowed rules (info only)
      if (validation.analysis.shadowed.length > 0) {
        console.log(`  ${color('dim', 'ℹ')} ${validation.analysis.shadowed.length} rule(s) shadowed by wildcards (OK but redundant)`);
      }

      // Check for respectGitignore
      if (settings.respectGitignore === true) {
        console.log(`  ${color('green', '✓')} respectGitignore: enabled`);
      } else {
        console.log(`  ${color('yellow', '○')} respectGitignore: not set`);
      }

    } catch (err) {
      console.log(`  ${color('yellow', '⚠')} Could not parse settings.local.json`);
      warnings++;
    }
  } else {
    console.log(`  ${color('yellow', '○')} .claude/settings.local.json not found (run 'flow bridge sync')`);
  }

  // Check hook integrity
  console.log('');
  printSection('Checking hook integrity...');

  const settingsLocalPath = path.join(PROJECT_ROOT, '.claude', 'settings.local.json');
  if (fileExists(settingsLocalPath)) {
    try {
      const settings = safeJsonParse(settingsLocalPath, {});
      const hooks = settings.hooks || {};

      // Check PreToolUse matcher includes EnterPlanMode
      const preToolHooks = hooks.PreToolUse || [];
      let hasEnterPlanMode = false;
      let hasCorrectMatcher = false;
      let hookScriptsMissing = [];

      for (const hookEntry of preToolHooks) {
        const matcher = hookEntry.matcher || '';
        if (matcher.includes('EnterPlanMode')) {
          hasEnterPlanMode = true;
        }
        if (matcher.includes('Edit') && matcher.includes('Write') && matcher.includes('Bash') && matcher.includes('Skill')) {
          hasCorrectMatcher = true;
        }

        // Check hook script files exist
        for (const h of (hookEntry.hooks || [])) {
          if (h.command) {
            // Extract script path from command like: node "/path/to/script.js"
            const scriptMatch = h.command.match(/node\s+"([^"]+)"/);
            if (scriptMatch) {
              const scriptPath = scriptMatch[1];
              if (!fileExists(scriptPath)) {
                hookScriptsMissing.push(scriptPath);
              }
            }
          }
        }
      }

      // Also check other hook types for missing scripts
      for (const hookType of ['PostToolUse', 'UserPromptSubmit', 'SessionStart']) {
        for (const hookEntry of (hooks[hookType] || [])) {
          for (const h of (hookEntry.hooks || [])) {
            if (h.command) {
              const scriptMatch = h.command.match(/node\s+"([^"]+)"/);
              if (scriptMatch && !fileExists(scriptMatch[1])) {
                hookScriptsMissing.push(scriptMatch[1]);
              }
            }
          }
        }
      }

      if (hasEnterPlanMode) {
        console.log(`  ${color('green', '✓')} PreToolUse matcher includes EnterPlanMode`);
      } else {
        console.log(`  ${color('red', '✗')} PreToolUse matcher MISSING EnterPlanMode — Claude can bypass /wogi-start`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate hooks")}`);
        issues++;
      }

      if (hasCorrectMatcher) {
        console.log(`  ${color('green', '✓')} PreToolUse matcher has core tools (Edit|Write|Bash|Skill)`);
      } else if (preToolHooks.length > 0) {
        console.log(`  ${color('yellow', '⚠')} PreToolUse matcher may be outdated — missing core tools`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate hooks")}`);
        warnings++;
      }

      if (hookScriptsMissing.length > 0) {
        console.log(`  ${color('red', '✗')} ${hookScriptsMissing.length} hook script(s) MISSING:`);
        for (const missing of hookScriptsMissing.slice(0, 5)) {
          console.log(`    - ${missing}`);
        }
        console.log(`    ${color('dim', "→ Run 'npm install -D wogiflow' or 'flow init' to restore scripts")}`);
        issues++;
      } else if (preToolHooks.length > 0) {
        console.log(`  ${color('green', '✓')} All hook scripts exist`);
      }
    } catch (err) {
      console.log(`  ${color('yellow', '⚠')} Could not parse settings.local.json for hooks: ${err.message}`);
      warnings++;
    }
  } else {
    console.log(`  ${color('yellow', '⚠')} .claude/settings.local.json not found — hooks not configured`);
    console.log(`    ${color('dim', "→ Run 'flow bridge sync' to generate hooks")}`);
    warnings++;
  }

  // Check CLAUDE.md has routing instructions (not just product description)
  if (fileExists(claudeMdPath)) {
    try {
      const claudeContent = fs.readFileSync(claudeMdPath, 'utf-8');
      const hasRouting = claudeContent.includes('wogi-start') && (
        claudeContent.includes('Task Gating') ||
        claudeContent.includes('MUST route') ||
        claudeContent.includes('MANDATORY')
      );
      if (hasRouting) {
        console.log(`  ${color('green', '✓')} CLAUDE.md contains routing instructions`);
      } else {
        console.log(`  ${color('red', '✗')} CLAUDE.md has NO routing instructions — Claude will bypass /wogi-start`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate CLAUDE.md from template")}`);
        issues++;
      }
    } catch (err) {
      // Already warned about CLAUDE.md read failure above
    }
  }

  // Check git status
  console.log('');
  printSection('Checking git status...');

  const git = getGitStatus();
  if (git.isRepo) {
    if (git.clean) {
      console.log(`  ${color('green', '✓')} Working directory clean`);
    } else {
      console.log(`  ${color('yellow', '⚠')} ${git.uncommitted} uncommitted changes`);
      warnings++;
    }
  } else {
    console.log(`  ${color('yellow', '⚠')} Not a git repository`);
    warnings++;
  }

  // Check request-log
  console.log('');
  printSection('Checking request-log...');

  if (fileExists(PATHS.requestLog)) {
    const entryCount = countRequestLogEntries();
    console.log(`  Total entries: ${entryCount}`);

    if (entryCount > 0) {
      const lastEntry = getLastRequestLogEntry();
      if (lastEntry) {
        console.log(`  Last entry: ${lastEntry}`);
      }
    }
  }

  // Check agents
  console.log('');
  printSection('Checking agents...');

  const agentsDir = path.join(PROJECT_ROOT, 'agents');
  const coreAgents = ['orchestrator', 'developer', 'reviewer', 'tester'];
  const optionalAgents = ['accessibility', 'security', 'performance', 'docs', 'design-system', 'onboarding'];

  for (const agent of coreAgents) {
    const agentPath = path.join(agentsDir, `${agent}.md`);
    if (fileExists(agentPath)) {
      console.log(`  ${color('green', '✓')} ${agent}.md`);
    } else {
      console.log(`  ${color('red', '✗')} ${agent}.md - MISSING (core agent)`);
      issues++;
    }
  }

  for (const agent of optionalAgents) {
    const agentPath = path.join(agentsDir, `${agent}.md`);
    if (fileExists(agentPath)) {
      console.log(`  ${color('green', '✓')} ${agent}.md (optional)`);
    }
  }

  // Summary
  console.log('');
  console.log('========================');

  if (issues === 0 && warnings === 0) {
    console.log(color('green', '✓ Workflow is healthy!'));
  } else if (issues === 0) {
    console.log(color('yellow', `⚠ ${warnings} warning(s), but no critical issues`));
  } else {
    console.log(color('red', `✗ ${issues} issue(s), ${warnings} warning(s)`));
    console.log('');
    console.log("Run './scripts/flow init' to fix missing files");
  }

  return { issues, warnings };
}

// ============================================================
// Deep Audit (v1.0.4)
// ============================================================

/**
 * Check if a directory is empty (ignoring .gitkeep)
 */
function isDirEmpty(dirPath) {
  if (!dirExists(dirPath)) return true;
  const files = fs.readdirSync(dirPath).filter(f => f !== '.gitkeep');
  return files.length === 0;
}

/**
 * Check if directory has subdirectories
 */
function hasSubdirs(dirPath) {
  if (!dirExists(dirPath)) return false;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.some(e => e.isDirectory());
}

/**
 * Load manifest if it exists
 */
function loadManifest() {
  const manifestPath = path.join(WORKFLOW_DIR, 'manifest.json');
  if (fileExists(manifestPath)) {
    try {
      return safeJsonParse(manifestPath, null);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Deep audit function - checks for structural issues
 */
function deepAudit(flags = {}) {
  const issues = [];
  const manifest = loadManifest();

  printHeader('DEEP HEALTH AUDIT');
  console.log('');

  // 1. Check empty directories
  printSection('Empty Directories');
  const expectedDirs = [
    { path: path.join(WORKFLOW_DIR, 'traces'), name: 'traces/', purpose: 'Code flow traces from /wogi-trace' },
    { path: path.join(WORKFLOW_DIR, 'checkpoints'), name: 'checkpoints/', purpose: 'Session state snapshots' },
    { path: path.join(WORKFLOW_DIR, 'corrections'), name: 'corrections/', purpose: 'Individual correction records from /wogi-correct' }
  ];

  for (const dir of expectedDirs) {
    if (dirExists(dir.path) && isDirEmpty(dir.path)) {
      console.log(`  ${color('yellow', '⚠')} ${dir.name}`);
      console.log(`      Purpose: ${dir.purpose}`);
      console.log(`      Action: Run the feature or document why empty`);
      issues.push({
        type: 'empty_directory',
        severity: 'warning',
        path: dir.name,
        message: `Empty directory - ${dir.purpose}`,
        suggestion: 'Run the feature or remove if unneeded'
      });
    } else if (dirExists(dir.path)) {
      const count = fs.readdirSync(dir.path).filter(f => f !== '.gitkeep').length;
      console.log(`  ${color('green', '✓')} ${dir.name} (${count} files)`);
    } else {
      console.log(`  ${color('dim', '○')} ${dir.name} (not created)`);
    }
  }

  // 2. Check misplaced files
  console.log('');
  printSection('Misplaced Files');

  const specMigrations = checkSpecMigration();
  if (specMigrations.length > 0) {
    for (const file of specMigrations) {
      console.log(`  ${color('yellow', '⚠')} ${file.name}.md`);
      console.log(`      Current: state/${file.name}.md`);
      console.log(`      Should be: specs/${file.name}.md`);
      console.log(`      Action: Run 'flow migrate specs'`);
      issues.push({
        type: 'misplaced_file',
        severity: 'warning',
        file: file.name,
        from: `state/${file.name}.md`,
        to: `specs/${file.name}.md`,
        suggestion: "Run 'flow migrate specs' to move"
      });
    }
  } else {
    console.log(`  ${color('green', '✓')} All spec files in correct location`);
  }

  // 3. Check rules structure
  console.log('');
  printSection('Rules Structure');

  const rulesDir = path.join(PROJECT_ROOT, '.claude', 'rules');
  if (dirExists(rulesDir)) {
    const rulesHasSubdirs = hasSubdirs(rulesDir);
    const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));

    if (rulesHasSubdirs) {
      const subdirs = fs.readdirSync(rulesDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      console.log(`  ${color('green', '✓')} Categorized structure (${subdirs.join(', ')})`);
    } else {
      console.log(`  ${color('yellow', '⚠')} Flat structure (${ruleFiles.length} files, no subdirs)`);
      console.log(`      Suggestion: Organize into code-style/, security/, architecture/`);
      issues.push({
        type: 'unstructured',
        severity: 'suggestion',
        path: '.claude/rules/',
        message: `Rules are flat (${ruleFiles.length} files, 0 subdirs)`,
        suggestion: 'Organize into code-style/, security/, architecture/'
      });
    }
  } else {
    console.log(`  ${color('dim', '○')} .claude/rules/ not found`);
  }

  // 4. Check for orphaned implementations
  console.log('');
  printSection('Feature Coverage');

  const features = [
    { name: 'Traces', script: 'scripts/flow-trace', folder: 'traces/', skill: '.claude/commands/wogi-trace.md' },
    { name: 'Checkpoints', script: 'scripts/flow-checkpoint.js', folder: 'checkpoints/', skill: '.claude/commands/wogi-checkpoint.md' },
    { name: 'Corrections', script: 'scripts/flow-correct.js', folder: 'corrections/', skill: '.claude/commands/wogi-correct.md' }
  ];

  for (const feature of features) {
    const scriptExists = fileExists(path.join(PROJECT_ROOT, feature.script));
    const folderExists = dirExists(path.join(WORKFLOW_DIR, feature.folder.replace('/', '')));
    const skillExists = fileExists(path.join(PROJECT_ROOT, feature.skill));

    if (scriptExists && folderExists) {
      console.log(`  ${color('green', '✓')} ${feature.name}: script + folder`);
    } else if (scriptExists && !folderExists) {
      console.log(`  ${color('yellow', '⚠')} ${feature.name}: script exists but folder missing`);
      issues.push({
        type: 'missing_folder',
        severity: 'warning',
        feature: feature.name,
        message: `Script exists but ${feature.folder} missing`
      });
    } else if (!scriptExists && folderExists) {
      console.log(`  ${color('yellow', '⚠')} ${feature.name}: folder exists but no script`);
      issues.push({
        type: 'missing_script',
        severity: 'warning',
        feature: feature.name,
        message: `${feature.folder} exists but no script`
      });
    } else {
      console.log(`  ${color('dim', '○')} ${feature.name}: not implemented`);
    }
  }

  // 5. Check manifest
  console.log('');
  printSection('Folder Manifest');

  if (manifest) {
    console.log(`  ${color('green', '✓')} manifest.json found`);
    const folderCount = Object.keys(manifest.folders || {}).length;
    console.log(`      ${folderCount} folder(s) documented`);
  } else {
    console.log(`  ${color('yellow', '⚠')} manifest.json not found`);
    console.log(`      Suggestion: Create .workflow/manifest.json to document folder purposes`);
    issues.push({
      type: 'missing_manifest',
      severity: 'suggestion',
      message: 'No folder manifest found',
      suggestion: 'Create .workflow/manifest.json to document folder purposes'
    });
  }

  // Summary
  console.log('');
  console.log('═'.repeat(56));

  const warnings = issues.filter(i => i.severity === 'warning').length;
  const suggestions = issues.filter(i => i.severity === 'suggestion').length;
  const errors = issues.filter(i => i.severity === 'error').length;

  console.log(`Summary: ${errors} error(s), ${warnings} warning(s), ${suggestions} suggestion(s)`);

  if (flags.json) {
    outputJson({
      success: errors === 0,
      issues,
      summary: { errors, warnings, suggestions }
    });
  }

  return { issues, errors, warnings, suggestions };
}

// ============================================================
// Main with flags
// ============================================================

function run() {
  const args = process.argv.slice(2);
  const { flags } = parseFlags(args);

  if (flags.deep) {
    const result = deepAudit(flags);
    process.exit(result.errors > 0 ? 1 : 0);
  } else {
    const result = main();
    process.exit(result.issues > 0 ? 1 : 0);
  }
}

run();
