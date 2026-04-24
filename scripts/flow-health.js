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

const fs = require('node:fs');
const path = require('node:path');
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
  validatePermissions,
  parseFlags,
  outputJson,
  checkSpecMigration,
  safeJsonParse,
  readJson,
  meetsVersion,
  getFdCommand,
  getConfig
} = require('./flow-utils')
const { color, printSection, printHeader, success, warn, error } = require('./flow-output');;

const { execSync, execFileSync } = require('node:child_process');

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
    const meetsMin = meetsVersion(major, minor, patch, 2, 1, 23);

    // 2.1.50+ features: worktree hooks, agent isolation, agent listing
    const meets2150 = meetsVersion(major, minor, patch, 2, 1, 50);

    // 2.1.72+ features: ExitWorktree, model param on Agent, fd/lsof auto-approval,
    // effort levels simplified, /plan description, prompt cache fix
    const meets2172 = meetsVersion(major, minor, patch, 2, 1, 72);

    // 2.1.73+ fixes: SessionStart double-fire, hook context pollution, subagent model on Bedrock/Vertex
    const meets2173 = meetsVersion(major, minor, patch, 2, 1, 73);

    // 2.1.75+: 1M context default, accurate token estimation, async hook suppression,
    // hook source display, memory file timestamps
    const meets2175 = meetsVersion(major, minor, patch, 2, 1, 75);

    return { version, meetsMinimum: meetsMin, meets2150, meets2172, meets2173, meets2175 };
  } catch (_err) {
    return { version: null, meetsMinimum: true, meets2150: false, meets2172: false, meets2173: false, meets2175: false };
  }
}

/**
 * Normalize an MCP server config so two equivalent objects compare equal
 * after JSON.stringify. Recursively sorts object keys and stringifies arrays
 * in their original order (order is meaningful for args).
 *
 * @param {*} cfg - An MCP server config value (typically an object, but may be primitive)
 * @returns {string} Canonical JSON representation suitable for equality comparison
 */
function normalizeMcpConfig(cfg) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        out[k] = sortKeys(v[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(cfg));
}

/**
 * Check MCP server definitions across the three Claude Code settings scopes:
 *   - user:    ~/.claude/settings.json
 *   - project: <project>/.claude/settings.json
 *   - local:   <project>/.claude/settings.local.json
 *
 * Mirrors the /doctor warning added in Claude Code 2.1.110: a server defined
 * in multiple scopes with divergent config is almost always a mistake — the
 * lowest-priority scope silently loses, and users debug ghost endpoints.
 *
 * Identical duplicate definitions are intentionally NOT flagged — some teams
 * duplicate for portability. Only divergent configs surface.
 *
 * @param {Object} [opts]
 * @param {string} [opts.userSettingsPath] - Override path to user scope (for tests)
 * @param {string} [opts.projectSettingsPath] - Override path to project scope (for tests)
 * @param {string} [opts.localSettingsPath] - Override path to local scope (for tests)
 * @returns {{
 *   duplicates: Array<{name: string, scopes: string[]}>,
 *   uniqueServers: number,
 *   parseErrors: Array<{file: string, error: string}>,
 *   scopesChecked: number
 * }}
 */
function checkMcpScopes(opts = {}) {
  const os = require('node:os');
  const scopes = [
    { file: opts.userSettingsPath || path.join(os.homedir(), '.claude', 'settings.json'), label: 'user' },
    { file: opts.projectSettingsPath || path.join(PROJECT_ROOT, '.claude', 'settings.json'), label: 'project' },
    { file: opts.localSettingsPath || path.join(PROJECT_ROOT, '.claude', 'settings.local.json'), label: 'local' }
  ];

  const parseErrors = [];
  const serverByName = new Map();
  let scopesChecked = 0;

  // Sentinel object for safeJsonParse so we can distinguish "file failed to
  // parse" (returned sentinel) from "file parsed but had no mcpServers" (returned
  // object without the key). safeJsonParse is mandated by security-patterns.md §2
  // (prototype-pollution guard + non-object validation) — we layer a raw-read
  // fallback on top to categorize the failure cause for health output.
  const PARSE_SENTINEL = Object.create(null);

  for (const scope of scopes) {
    if (!fileExists(scope.file)) continue;
    scopesChecked++;
    const json = safeJsonParse(scope.file, PARSE_SENTINEL);
    if (json === PARSE_SENTINEL) {
      // safeJsonParse returned the sentinel — categorize: read failure vs JSON
      // parse failure vs non-object vs prototype-pollution rejection.
      let raw;
      try {
        raw = fs.readFileSync(scope.file, 'utf-8');
      } catch (err) {
        parseErrors.push({ file: scope.file, error: `read failed: ${err.message}` });
        continue;
      }
      try {
        JSON.parse(raw);
        // Raw parse succeeded — safeJsonParse rejected for structural reason
        // (non-object top level, or dangerous __proto__/constructor keys).
        parseErrors.push({ file: scope.file, error: 'rejected by safeJsonParse (non-object or prototype-pollution guard)' });
      } catch (err) {
        parseErrors.push({ file: scope.file, error: `invalid JSON: ${err.message}` });
      }
      continue;
    }
    const mcp = json.mcpServers;
    if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) continue;

    for (const name of Object.keys(mcp)) {
      if (!serverByName.has(name)) serverByName.set(name, []);
      serverByName.get(name).push({ scope: scope.label, config: mcp[name] });
    }
  }

  const duplicates = [];
  for (const [name, entries] of serverByName.entries()) {
    if (entries.length < 2) continue;
    const canonical = normalizeMcpConfig(entries[0].config);
    const allSame = entries.every(e => normalizeMcpConfig(e.config) === canonical);
    if (!allSame) {
      duplicates.push({ name, scopes: entries.map(e => e.scope) });
    }
  }

  return {
    duplicates,
    uniqueServers: serverByName.size,
    parseErrors,
    scopesChecked
  };
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
  } catch (_err) {
    // Fallback: just check app-map.md
    requiredFiles.push({ path: PATHS.appMap, name: '.workflow/state/app-map.md' });
  }

  for (const file of requiredFiles) {
    if (fileExists(file.path)) {
      success(`${file.name}`);
    } else {
      error(`${file.name} - MISSING`);
      issues++;
    }
  }

  // Check CLI-specific rules file
  let cliType = 'claude-code'; // default
  if (fileExists(PATHS.config)) {
    try {
      const config = getConfig();
      cliType = config.cli?.type || 'claude-code';
    } catch (_err) {}
  }

  // Only Claude Code is supported
  const rulesFile = { path: path.join(PROJECT_ROOT, 'CLAUDE.md'), name: 'CLAUDE.md' };
  if (fileExists(rulesFile.path)) {
    success(`${rulesFile.name} (${cliType})`);
  } else {
    error(`${rulesFile.name} - MISSING (${cliType})`);
    issues++;
  }

  // Check WogiFlow version
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'node_modules', 'wogiflow', 'package.json');
    if (fileExists(pkgPath)) {
      const pkg = readJson(pkgPath, null);
      if (pkg) {
        success(`WogiFlow version: ${pkg.version}`);
      }
    }
  } catch (_err) {
    // Non-critical — skip silently
  }

  // Check Claude Code version (if applicable)
  if (cliType === 'claude-code') {
    const versionCheck = checkClaudeCodeVersion();
    if (versionCheck.version) {
      if (versionCheck.meetsMinimum) {
        success(`Claude Code version: ${versionCheck.version}`);
      } else {
        console.log(`  ${color('yellow', '○')} Claude Code version: ${versionCheck.version} (2.1.23+ recommended)`);
        console.log(`    ${color('dim', '→ Older versions may have silent search failures and shared system issues')}`);
        warnings++;
      }

      // Report 2.1.50+ features
      if (versionCheck.meets2150) {
        success(`Claude Code 2.1.50+ features available:`);
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
            success(`claude agents: ${agentCount} agent(s) configured`);
          } else {
            console.log(`  ${color('dim', '○')} claude agents: no agents configured`);
          }
        } catch (_err) {
          console.log(`  ${color('dim', '○')} claude agents: command unavailable`);
        }
      }

      // Report 2.1.72+ features
      if (versionCheck.meets2172) {
        success(`Claude Code 2.1.72+ features available:`);
        console.log(`    ${color('dim', '→ ExitWorktree tool for clean worktree exit')}`);
        console.log(`    ${color('dim', '→ Agent model parameter for hybrid routing')}`);
        console.log(`    ${color('dim', '→ /plan description argument')}`);
        console.log(`    ${color('dim', '→ Simplified effort levels (low/medium/high)')}`);
        console.log(`    ${color('dim', '→ Prompt cache optimization (up to 12x savings)')}`);

        // Check for fd/fdfind availability (auto-approved in 2.1.72+)
        const fdCmd = getFdCommand();
        if (fdCmd) {
          success(`${fdCmd}: available (auto-approved for fast file search)`);
        } else {
          console.log(`  ${color('dim', '○')} fd/fdfind: not installed (install for faster file search)`);
        }

        // Check for lsof availability (auto-approved in 2.1.72+)
        try {
          execFileSync('lsof', ['-v'], { stdio: 'pipe', timeout: 3000 });
          success(`lsof: available (auto-approved for diagnostics)`);
        } catch (_err) {
          console.log(`  ${color('dim', '○')} lsof: not available`);
        }
      }

      // Report 2.1.73+ fixes
      if (versionCheck.meets2173) {
        success(`Claude Code 2.1.73+ fixes applied:`);
        console.log(`    ${color('dim', '→ SessionStart hooks fire exactly once on resume')}`);
        console.log(`    ${color('dim', '→ Hook JSON output no longer pollutes context')}`);
        console.log(`    ${color('dim', '→ Subagent model parameter works on Bedrock/Vertex/Foundry')}`);
        console.log(`    ${color('dim', '→ modelOverrides setting for custom provider model IDs')}`);
      }

      // Report 2.1.75+ features
      if (versionCheck.meets2175) {
        success(`Claude Code 2.1.75+ features available:`);
        console.log(`    ${color('dim', '→ 1M context window default for Opus (Max/Team/Enterprise)')}`);
        console.log(`    ${color('dim', '→ Accurate token estimation (no thinking/tool_use over-counting)')}`);
        console.log(`    ${color('dim', '→ Relaxed compaction thresholds (safe: 80%, emergency: 92%)')}`);
        console.log(`    ${color('dim', '→ Hook source displayed in permission prompts')}`);
        console.log(`    ${color('dim', '→ Memory file last-modified timestamps for freshness')}`);
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
      success(`${dir.name}/`);
    } else {
      error(`${dir.name}/ - MISSING`);
      issues++;
    }
  }

  // Check universal structure directories (optional but recommended)
  console.log('');
  printSection('Checking universal structure...');

  const universalDirs = [
    { path: PATHS.modelsDir, name: '.workflow/models' },
    { path: PATHS.bridges, name: '.workflow/bridges' },
    { path: PATHS.templates, name: '.workflow/templates' },
  ];

  for (const dir of universalDirs) {
    if (dirExists(dir.path)) {
      success(`${dir.name}/`);
    } else {
      console.log(`  ${color('yellow', '○')} ${dir.name}/ - not found (run 'flow migrate' to add)`);
      warnings++;
    }
  }

  // Check model registry
  const registryPath = path.join(PATHS.workflow, 'models', 'registry.json');
  if (fileExists(registryPath)) {
    const result = validateJson(registryPath);
    if (result.valid) {
      success(`Model registry valid`);
    } else {
      error(`Model registry invalid JSON`);
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
  } catch (_err) {
    // Knowledge sync not available
  }

  for (const file of knowledgeFiles) {
    if (fileExists(file.path)) {
      // Check sync status if available
      const categoryStatus = driftStatus?.categories?.[file.category];
      if (categoryStatus?.status === 'drifted') {
        warn(`${file.name} - out of sync (${categoryStatus.reason})`);
        warnings++;
      } else {
        success(`${file.name}`);
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
      success(`Valid JSON`);
    } else {
      error(`Invalid JSON syntax`);
      issues++;
    }
  }

  // Validate ready.json
  console.log('');
  printSection('Validating ready.json...');

  if (fileExists(PATHS.ready)) {
    const result = validateJson(PATHS.ready);
    if (result.valid) {
      success(`Valid JSON`);
    } else {
      error(`Invalid JSON syntax`);
      issues++;
    }
  }

  // Check TypeScript project references vs typecheck command
  console.log('');
  printSection('Checking typecheck configuration...');

  if (fileExists(PATHS.config)) {
    try {
      const config = safeJsonParse(PATHS.config, {});
      const typecheckCmd = config.scripts?.typecheck || null;
      const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');

      if (fileExists(tsconfigPath)) {
        try {
          const tsconfig = safeJsonParse(tsconfigPath, {});
          const hasProjectRefs = Array.isArray(tsconfig.references) && tsconfig.references.length > 0;
          const hasEmptyFiles = Array.isArray(tsconfig.files) && tsconfig.files.length === 0;
          const isProjectRefsMode = hasProjectRefs && hasEmptyFiles;

          if (isProjectRefsMode) {
            const cmdIsNoEmit = !typecheckCmd || typecheckCmd.includes('tsc --noEmit') || typecheckCmd === 'npx tsc --noEmit';
            if (cmdIsNoEmit) {
              warn(`TypeScript project references detected but typecheck command may not support them`);
              console.log(`    ${color('dim', '→ Consider: configure config.scripts.typecheck to use tsc --build --force')}`);
              warnings++;
            } else {
              success(`Typecheck command: ${typecheckCmd}`);
              console.log(`    ${color('dim', '→ Project references mode detected — command appears compatible')}`);
            }
          } else if (typecheckCmd) {
            success(`Typecheck command: ${typecheckCmd}`);
          } else {
            console.log(`  ${color('yellow', '○')} No typecheck command configured — auto-detection will handle this`);
          }
        } catch (err) {
          console.log(`  ${color('yellow', '○')} Could not parse tsconfig.json: ${err.message}`);
        }
      } else if (typecheckCmd) {
        success(`Typecheck command: ${typecheckCmd} (no tsconfig.json found)`);
      } else {
        console.log(`  ${color('dim', '○')} No tsconfig.json found — typecheck not applicable`);
      }
    } catch (err) {
      warn(`Could not check typecheck configuration: ${err.message}`);
      warnings++;
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
      warn(`Could not read CLAUDE.md: ${err.message}`);
      warnings++;
      claudeMdContent = '';
      claudeMdSize = 0;
    }
    const sizeKb = Math.round(claudeMdSize / 1024);

    // Check CLAUDE.md size (should be under 20KB for reliable loading)
    if (sizeKb <= 20) {
      success(`CLAUDE.md size: ${sizeKb}KB (under 20KB limit)`);
    } else {
      warn(`CLAUDE.md size: ${sizeKb}KB (over 20KB - may get truncated)`);
      warnings++;
    }

    // Check if enforcement section is at top (within first 100 lines)
    const lines = claudeMdContent.split('\n').slice(0, 100);
    const hasEnforcementAtTop = lines.some(line =>
      line.includes('MANDATORY') && line.includes('Task Gating')
    );

    if (hasEnforcementAtTop) {
      success(`Enforcement section: FOUND at top of CLAUDE.md`);
    } else {
      warn(`Enforcement section not found at top of CLAUDE.md`);
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
          success(`Strict mode: ENABLED`);
        } else if (config.enforcement?.strictMode === false) {
          warn(`Strict mode: DISABLED (Claude may skip task creation)`);
          warnings++;
        } else {
          warn(`Strict mode: NOT CONFIGURED (add enforcement section to config.json)`);
          warnings++;
        }
      } catch (_err) {
        warn(`Could not parse config.json for strict mode check`);
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
      warn(`App-map may be out of sync`);
      console.log('    Run: ./scripts/flow update-map scan src/components');
      warnings++;
    } else {
      success(`App-map appears in sync`);
    }
  } else {
    warn(`src/components/ not found (may be OK for new projects)`);
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
        warn(`${validation.analysis.duplicates.length} duplicate rule(s) found`);
        for (const dup of validation.analysis.duplicates.slice(0, 3)) {
          console.log(`    - ${dup}`);
        }
        warnings++;
      } else {
        success(`No duplicate rules`);
      }

      // Show overly broad rules (issue)
      if (validation.analysis.overbroad.length > 0) {
        warn(`${validation.analysis.overbroad.length} overly broad rule(s)`);
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
        success(`respectGitignore: enabled`);
      } else {
        console.log(`  ${color('yellow', '○')} respectGitignore: not set`);
      }

    } catch (_err) {
      warn(`Could not parse settings.local.json`);
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
        success(`PreToolUse matcher includes EnterPlanMode`);
      } else {
        error(`PreToolUse matcher MISSING EnterPlanMode — Claude can bypass /wogi-start`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate hooks")}`);
        issues++;
      }

      if (hasCorrectMatcher) {
        success(`PreToolUse matcher has core tools (Edit|Write|Bash|Skill)`);
      } else if (preToolHooks.length > 0) {
        warn(`PreToolUse matcher may be outdated — missing core tools`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate hooks")}`);
        warnings++;
      }

      if (hookScriptsMissing.length > 0) {
        error(`${hookScriptsMissing.length} hook script(s) MISSING:`);
        for (const missing of hookScriptsMissing.slice(0, 5)) {
          console.log(`    - ${missing}`);
        }
        console.log(`    ${color('dim', "→ Run 'npm install -D wogiflow' or 'flow init' to restore scripts")}`);
        issues++;
      } else if (preToolHooks.length > 0) {
        success(`All hook scripts exist`);
      }
    } catch (err) {
      warn(`Could not parse settings.local.json for hooks: ${err.message}`);
      warnings++;
    }
  } else {
    warn(`.claude/settings.local.json not found — hooks not configured`);
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
        success(`CLAUDE.md contains routing instructions`);
      } else {
        error(`CLAUDE.md has NO routing instructions — Claude will bypass /wogi-start`);
        console.log(`    ${color('dim', "→ Run 'flow bridge sync' to regenerate CLAUDE.md from template")}`);
        issues++;
      }
    } catch (_err) {
      // Already warned about CLAUDE.md read failure above
    }
  }

  // Check MCP server definitions across scopes (mirrors Claude Code 2.1.110 /doctor)
  console.log('');
  printSection('Checking MCP server scopes...');

  const mcp = checkMcpScopes();
  if (mcp.parseErrors.length > 0) {
    for (const e of mcp.parseErrors) {
      warn(`Could not parse ${e.file}: ${e.error}`);
    }
    warnings += mcp.parseErrors.length;
  }
  if (mcp.uniqueServers === 0) {
    console.log(`  ${color('dim', '○')} No MCP servers defined in user / project / local scopes`);
  } else if (mcp.duplicates.length === 0) {
    success(`No conflicting MCP server definitions across ${mcp.scopesChecked} scope(s)`);
  } else {
    for (const f of mcp.duplicates) {
      warn(`MCP server "${f.name}" has divergent config in scopes: ${f.scopes.join(' + ')}`);
      console.log(`    ${color('dim', '→ Consolidate into a single scope; /doctor will flag this too')}`);
    }
    warnings += mcp.duplicates.length;
  }

  // Check anti-deferral rule compliance (decisions.md:75)
  console.log('');
  printSection('Checking anti-deferral rule compliance...');
  const deferralViolations = checkAntiDeferralCompliance();
  if (deferralViolations.length === 0) {
    success('No anti-deferral violations in ready.json');
  } else {
    for (const v of deferralViolations) {
      warn(`${v.id} (${v.list}): "${v.note.substring(0, 80)}..."`);
    }
    warn(`${deferralViolations.length} task(s) in "ready/in-progress" with deferral language — move to "blocked" with dependsOn`);
    warn(`Rule: .workflow/state/decisions.md §Review-Findings Anti-Deferral`);
    warnings += deferralViolations.length;
  }

  // Completion-claim honesty scan (2026-04-16 honesty-infrastructure)
  console.log('');
  printSection('Checking completion-claim honesty...');
  const honestyHits = checkCompletionClaimHonesty();
  if (honestyHits.length === 0) {
    success('No claim-vs-state contradictions in ready.json');
  } else {
    for (const h of honestyHits) {
      warn(`${h.id} (${h.class === 'A' ? 'status-mismatch' : 'negation-vs-evidence'}): "${h.snippet}"`);
    }
    warn(`${honestyHits.length} contradiction(s): free-text claim disagrees with structured state`);
    warn(`Gate: scripts/flow-completion-truth-gate.js → scanForClaimContradictions`);
    warnings += honestyHits.length;
  }

  // Check .gitignore sync
  console.log('');
  printSection('Checking .gitignore sync...');

  try {
    const { checkGitignoreHealth } = require('./flow-gitignore');
    const gitignoreHealth = checkGitignoreHealth();
    if (gitignoreHealth.ok) {
      success(`All required .gitignore entries present`);
    } else {
      for (const m of gitignoreHealth.missing) {
        warn(`Missing: ${m.pattern} (${m.description})`);
      }
      warn(`Run: node scripts/flow-gitignore.js sync`);
      warnings += gitignoreHealth.missing.length;
    }
  } catch (_err) {
    console.log(`  ${color('yellow', '○')} Gitignore check unavailable`);
  }

  // Check git status
  console.log('');
  printSection('Checking git status...');

  const git = getGitStatus();
  if (git.isRepo) {
    if (git.clean) {
      success(`Working directory clean`);
    } else {
      warn(`${git.uncommitted} uncommitted changes`);
      warnings++;
    }
  } else {
    warn(`Not a git repository`);
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

  // Knowledge linting
  console.log('');
  printSection('Knowledge linting...');

  // 1. Check section-index freshness
  if (fileExists(PATHS.sectionIndex)) {
    try {
      const indexStat = fs.statSync(PATHS.sectionIndex);
      const indexAge = Date.now() - indexStat.mtimeMs;
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (indexAge > maxAge) {
        const days = Math.round(indexAge / (24 * 60 * 60 * 1000));
        warn(`section-index.json is ${days} days old — may be stale`);
        console.log(`    ${color('dim', "→ Run 'node scripts/flow-section-index.js --force' to regenerate")}`);
        warnings++;
      } else {
        success(`section-index.json is fresh`);
      }
    } catch (_err) {
      warn(`Could not check section-index.json age`);
      warnings++;
    }
  } else {
    warn(`section-index.json not found — knowledge navigation unavailable`);
    console.log(`    ${color('dim', "→ Run 'node scripts/flow-section-index.js --force' to generate")}`);
    warnings++;
  }

  // 2. Check feedback-patterns.md for stale/duplicate entries
  if (fileExists(PATHS.feedbackPatterns)) {
    try {
      const fpContent = fs.readFileSync(PATHS.feedbackPatterns, 'utf-8');
      const fpLines = fpContent.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Date'));
      const totalPatterns = fpLines.length;
      const needsSkill = fpLines.filter(l => l.includes('#needs-skill')).length;
      const promoted = fpLines.filter(l => l.includes('Fixed') || l.includes('Promoted')).length;
      const stale = fpLines.filter(l => {
        const dateMatch = l.match(/\d{4}-\d{2}-\d{2}/);
        if (!dateMatch) return false;
        const entryDate = new Date(dateMatch[0]);
        const age = Date.now() - entryDate.getTime();
        return age > 90 * 24 * 60 * 60 * 1000; // older than 90 days
      }).length;

      if (totalPatterns > 0) {
        success(`feedback-patterns.md: ${totalPatterns} entries`);
        if (needsSkill > totalPatterns * 0.7) {
          warn(`${needsSkill}/${totalPatterns} entries are #needs-skill — skill gap detected`);
          console.log(`    ${color('dim', '→ Consider creating skills for common file patterns')}`);
          warnings++;
        }
        if (stale > 0) {
          warn(`${stale} entries older than 90 days — consider archiving`);
          warnings++;
        }
        if (promoted > 0) {
          console.log(`  ${color('dim', 'ℹ')} ${promoted} patterns promoted/fixed`);
        }
      }
    } catch (_err) {
      warn(`Could not parse feedback-patterns.md`);
      warnings++;
    }
  }

  // 3. Check decisions.md references are still valid
  if (fileExists(PATHS.decisions)) {
    try {
      const decContent = fs.readFileSync(PATHS.decisions, 'utf-8');
      const fileRefs = decContent.match(/`[^`]*\.(js|ts|md|json)`/g) || [];
      let orphanedRefs = 0;
      const checkedRefs = new Set();

      for (const ref of fileRefs) {
        const filePath = ref.replace(/`/g, '');
        if (checkedRefs.has(filePath)) continue;
        checkedRefs.add(filePath);

        // Resolve relative to project root, trying common prefixes
        const candidates = [
          path.join(PROJECT_ROOT, filePath),
          path.join(PROJECT_ROOT, '.workflow', filePath),
          path.join(PROJECT_ROOT, '.claude', filePath),
        ];

        const exists = candidates.some(c => fileExists(c));
        if (!exists && !filePath.includes('*') && !filePath.includes('{')) {
          orphanedRefs++;
        }
      }

      if (orphanedRefs > 0) {
        warn(`decisions.md has ${orphanedRefs} reference(s) to files that may no longer exist`);
        warnings++;
      } else if (fileRefs.length > 0) {
        success(`decisions.md file references verified (${checkedRefs.size} checked)`);
      }
    } catch (_err) {
      warn(`Could not lint decisions.md references`);
      warnings++;
    }
  }

  // 4. Check skill feedback loop — verify skills with learnings get loaded
  try {
    const skillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');
    if (dirExists(skillsDir)) {
      const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '_template' && d.name !== 'README.md');

      let skillsWithLearnings = 0;
      for (const dir of skillDirs) {
        const learningsPath = path.join(skillsDir, dir.name, 'knowledge', 'learnings.md');
        if (fileExists(learningsPath)) {
          try {
            const content = fs.readFileSync(learningsPath, 'utf-8').trim();
            if (content.length > 50) { // Non-empty learnings
              skillsWithLearnings++;
            }
          } catch (_err) {}
        }
      }

      const config = getConfig();
      const loadLearnings = config.skills?.loadLearnings !== false;

      if (skillsWithLearnings > 0 && !loadLearnings) {
        warn(`${skillsWithLearnings} skill(s) have learnings but skills.loadLearnings is disabled`);
        console.log(`    ${color('dim', '→ Set skills.loadLearnings: true in config.json to use accumulated learnings')}`);
        warnings++;
      } else if (skillsWithLearnings > 0) {
        success(`${skillsWithLearnings} skill(s) with learnings — feedback loop active`);
      } else if (skillDirs.length > 0) {
        console.log(`  ${color('dim', 'ℹ')} ${skillDirs.length} skill(s) installed — no learnings yet`);
      }
    }
  } catch (_err) {
    // Skills directory check is non-critical
  }

  // 5. Check registry maps for orphaned file references
  try {
    const { getActiveRegistries, STATE_DIR: stateDir } = require('./flow-utils');
    const registries = getActiveRegistries();
    let totalOrphans = 0;
    let totalChecked = 0;

    for (const reg of registries) {
      const mapPath = path.join(stateDir, reg.mapFile);
      if (!fileExists(mapPath)) continue;

      try {
        const mapContent = fs.readFileSync(mapPath, 'utf-8');
        // Extract file paths from markdown table rows (typically in a "File" or "Path" column)
        const pathRefs = mapContent.match(/(?:src|lib|scripts|components|pages|app)\/[\w/.-]+\.\w+/g) || [];
        const unique = [...new Set(pathRefs)];

        for (const ref of unique) {
          totalChecked++;
          const fullPath = path.join(PROJECT_ROOT, ref);
          if (!fileExists(fullPath)) {
            totalOrphans++;
          }
        }
      } catch (_err) {
        // Skip unreadable maps
      }
    }

    if (totalOrphans > 0) {
      warn(`Registry maps have ${totalOrphans} orphaned file reference(s) (${totalChecked} checked)`);
      console.log(`    ${color('dim', "→ Run 'flow registry-manager scan' to update maps")}`);
      warnings++;
    } else if (totalChecked > 0) {
      success(`Registry map file references verified (${totalChecked} checked)`);
    }
  } catch (_err) {
    // Registry system unavailable — skip silently
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
      success(`${agent}.md`);
    } else {
      error(`${agent}.md - MISSING (core agent)`);
      issues++;
    }
  }

  for (const agent of optionalAgents) {
    const agentPath = path.join(agentsDir, `${agent}.md`);
    if (fileExists(agentPath)) {
      success(`${agent}.md (optional)`);
    }
  }

  // B7 (wf-c3b5afab): Surface gate miss-rate summary — rubber-stamping visibility
  console.log('');
  printSection('Checking gate telemetry...');
  printGateMissRateSummary();

  // Summary
  console.log('');
  console.log('========================');

  if (issues === 0 && warnings === 0) {
    success('Workflow is healthy!');
  } else if (issues === 0) {
    warn(`${warnings} warning(s), but no critical issues`);
  } else {
    error(`${issues} issue(s), ${warnings} warning(s)`);
    console.log('');
    console.log("Run './scripts/flow init' to fix missing files");
  }

  return { issues, warnings };
}

// B7 (wf-c3b5afab): One-line surface of gates above the miss-rate threshold.
// Uses the same threshold as flow-session-end's watch section (>=10%).
const GATE_MISS_RATE_THRESHOLD = 0.10;
const GATE_MISS_WINDOW = '7d';

function loadGateStatsForHealth() {
  let getGateStats;
  try {
    ({ getGateStats } = require('./flow-gate-telemetry'));
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Gate telemetry: ${err.message}`);
    return null;
  }
  try {
    return getGateStats({ since: GATE_MISS_WINDOW });
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Gate telemetry stats: ${err.message}`);
    return null;
  }
}

function printGateMissRateSummary(stats = loadGateStatsForHealth()) {
  const perGate = stats && stats.perGate ? stats.perGate : null;
  const gates = perGate ? Object.keys(perGate) : [];
  if (!perGate || gates.length === 0) {
    console.log(`  ${color('dim', 'No telemetry yet (baseline)')}`);
    return;
  }

  const over = gates.filter(id => {
    const g = perGate[id];
    return g.verdicts && g.verdicts.PASS > 0 && g.missRate >= GATE_MISS_RATE_THRESHOLD;
  });

  if (over.length === 0) {
    success(`Gate missRate: 0 gates above ${(GATE_MISS_RATE_THRESHOLD * 100).toFixed(0)}% threshold`);
    return;
  }

  warn(`Gate missRate: ${over.length} gate(s) above ${(GATE_MISS_RATE_THRESHOLD * 100).toFixed(0)}% threshold (see /wogi-gate-stats)`);
  for (const id of over.slice(0, 3)) {
    const g = perGate[id];
    console.log(`    ${color('dim', `${id}: ${(g.missRate * 100).toFixed(1)}% miss (${g.missedAfterPass}/${g.verdicts.PASS})`)}`);
  }
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
    } catch (_err) {
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
      warn(`${dir.name}`);
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
      success(`${dir.name} (${count} files)`);
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
      warn(`${file.name}.md`);
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
    success(`All spec files in correct location`);
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
      success(`Categorized structure (${subdirs.join(', ')})`);
    } else {
      warn(`Flat structure (${ruleFiles.length} files, no subdirs)`);
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
    const _skillExists = fileExists(path.join(PROJECT_ROOT, feature.skill));

    if (scriptExists && folderExists) {
      success(`${feature.name}: script + folder`);
    } else if (scriptExists && !folderExists) {
      warn(`${feature.name}: script exists but folder missing`);
      issues.push({
        type: 'missing_folder',
        severity: 'warning',
        feature: feature.name,
        message: `Script exists but ${feature.folder} missing`
      });
    } else if (!scriptExists && folderExists) {
      warn(`${feature.name}: folder exists but no script`);
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
    success(`manifest.json found`);
    const folderCount = Object.keys(manifest.folders || {}).length;
    console.log(`      ${folderCount} folder(s) documented`);
  } else {
    warn(`manifest.json not found`);
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

if (require.main === module) {
  run();
}

/**
 * Detect anti-deferral rule violations in ready.json.
 * A task carrying "defer/deferred" language in blockedNote while in the ready
 * or inProgress arrays contradicts the decisions.md:75 anti-deferral rule,
 * which requires such tasks to be moved to `blocked` with a concrete `dependsOn`.
 * @returns {Array<{id: string, list: string, note: string}>}
 */
function checkAntiDeferralCompliance() {
  const violations = [];
  try {
    const ready = safeJsonParse(PATHS.ready, {});
    const check = (list, arr) => {
      for (const task of arr || []) {
        const note = task.blockedNote || task.deferReason || '';
        if (/\b(deferred?|defer)\b/i.test(note)) {
          violations.push({ id: task.id, list, note });
        }
      }
    };
    check('ready', ready.ready);
    check('inProgress', ready.inProgress);
  } catch (_err) {
    // If ready.json is unreadable, other checks will flag it separately.
  }
  return violations;
}

/**
 * Check completion-claim honesty across ready.json. Uses
 * flow-completion-truth-gate.scanForClaimContradictions to detect:
 *   Class A — done-word in notes/result while status is partial
 *   Class B — "0 outages"-style negation while hotfixes[] is non-empty
 * Returns flattened list of {id, class, field, snippet} for health-report display.
 * @returns {Array<{id: string, class: 'A'|'B', field: string, snippet: string}>}
 */
function checkCompletionClaimHonesty() {
  const hits = [];
  try {
    const { scanForClaimContradictions } = require('./flow-completion-truth-gate');
    const ready = safeJsonParse(PATHS.ready, {});
    const toScan = []
      .concat(Array.isArray(ready.inProgress) ? ready.inProgress : [])
      .concat(Array.isArray(ready.recentlyCompleted) ? ready.recentlyCompleted : []);
    for (const task of toScan) {
      if (!task || typeof task !== 'object') continue;
      const res = scanForClaimContradictions(task);
      if (!res.scanned) continue;
      for (const c of res.contradictions) {
        hits.push({ id: task.id, class: c.class, field: c.field, snippet: c.snippet });
      }
    }
  } catch (_err) {
    // Non-critical; other checks remain.
  }
  return hits;
}

module.exports = { checkMcpScopes, normalizeMcpConfig, checkAntiDeferralCompliance, checkCompletionClaimHonesty, printGateMissRateSummary, GATE_MISS_RATE_THRESHOLD };
