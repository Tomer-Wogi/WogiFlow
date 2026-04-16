#!/usr/bin/env node

/**
 * Wogi Flow Installer
 *
 * Handles project initialization with `flow init`.
 * Creates the .workflow directory structure, configures CLI bridges,
 * and sets up the project for use with the selected AI CLI.
 *
 * @module lib/installer
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// Shared utilities
const { copyDir, safeReadJson } = require('./utils');
const { getTodayDate } = require('../scripts/flow-output');

// Package root (where wogi-flow is installed)
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Read version from package.json (single source of truth)
const pkg = safeReadJson(path.join(PACKAGE_ROOT, 'package.json')) || {};
const PACKAGE_VERSION = pkg.version || '1.0.0';

// Supported CLIs
const SUPPORTED_CLIS = {
  claude: {
    name: 'Claude Code',
    dir: '.claude',
    configFile: 'CLAUDE.md',
    description: 'Anthropic Claude Code CLI (the only supported CLI)'
  }
};

// Default configuration - version read from package.json
// Note: 'cli' here is the CLI key for interactive selection, not the config.cli object
const DEFAULT_CONFIG = {
  version: PACKAGE_VERSION,
  projectName: '',
  cliKey: 'claude',
  projectType: 'unknown'
};

/**
 * Get the full default config with all WogiFlow features configured.
 * Used by both `flow init` and `/wogi-onboard` to ensure config parity.
 *
 * Delegates to CONFIG_DEFAULTS from flow-config-defaults.js (single source of truth).
 *
 * @param {Object} [overrides={}] - Project-specific overrides to merge on top of defaults
 * @returns {Object} Complete config object
 */
function getDefaultConfig(overrides = {}) {
  // Load shared defaults (single source of truth)
  let configDefaults;
  try {
    configDefaults = require('../scripts/flow-config-defaults');
  } catch (err) {
    // Fallback: if module not available, use minimal defaults
    console.warn('Warning: Could not load flow-config-defaults.js:', err.message);
    return {
      $schema: './config.schema.json',
      version: PACKAGE_VERSION,
      projectName: overrides.projectName || '',
      cli: { type: 'claude-code' },
      ...overrides
    };
  }

  // Start from shared defaults, then apply overrides
  const base = configDefaults.mergeWithDefaults({
    $schema: './config.schema.json',
    version: overrides.version !== undefined ? overrides.version : PACKAGE_VERSION,
    projectName: overrides.projectName !== undefined ? overrides.projectName : '',
    cli: { type: 'claude-code' }
  });

  // Apply project-type-aware registry defaults
  const projectType = overrides.projectType || 'unknown';
  if (projectType && projectType !== 'unknown') {
    base.registries = getRegistriesForProjectType(projectType);
  }

  // Deep merge any remaining overrides
  return deepMerge(base, overrides);
}

// Old 600+ lines of inline defaults removed (v1.10.0 — audit wf-cf977256).
// Now unified in scripts/flow-config-defaults.js (single source of truth).

/**
 * Detect project type from project files.
 * @param {string} projectRoot - Project root directory
 * @returns {string} One of: 'frontend', 'backend', 'fullstack', 'library', 'cli', 'python', 'golang', 'unknown'
 */
function detectProjectType(projectRoot) {
  // Check for Python project
  const pythonFiles = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'];
  for (const file of pythonFiles) {
    if (fs.existsSync(path.join(projectRoot, file))) {
      return 'python';
    }
  }

  // Check for Go project
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'golang';
  }

  // Check for Node.js / JavaScript project
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const pkg = safeReadJson(packageJsonPath);
  if (!pkg) {
    return 'unknown';
  }

  const allDeps = Object.assign(
    Object.create(null),
    pkg.dependencies || {},
    pkg.devDependencies || {}
  );

  const hasFrontend = !!(allDeps.react || allDeps.vue || allDeps.next || allDeps.nuxt ||
    allDeps['@angular/core'] || allDeps.svelte || allDeps['@sveltejs/kit'] ||
    allDeps.vite || allDeps['react-dom'] || allDeps['@vue/cli-service']);

  const hasBackend = !!(allDeps.express || allDeps.fastify || allDeps['@nestjs/core'] ||
    allDeps.koa || allDeps.hapi || allDeps['@hapi/hapi'] || allDeps.hono);

  if (hasFrontend && hasBackend) {
    return 'fullstack';
  }
  if (hasFrontend) {
    return 'frontend';
  }
  if (hasBackend) {
    return 'backend';
  }

  // Check if it's a CLI tool
  if (pkg.bin) {
    return 'cli';
  }

  // Check if it's a library (has main/exports but no bin and not frontend/backend)
  if (pkg.main || pkg.exports || pkg.module) {
    return 'library';
  }

  return 'unknown';
}

/**
 * Mapping of canonical script keys to common package.json script name variants.
 * Used by detectProjectScripts() to auto-populate config.scripts.
 */
const SCRIPT_MAPPINGS = {
  typecheck: ['type-check', 'typecheck', 'tsc', 'check-types', 'check:types', 'types', 'types:check'],
  lint: ['lint', 'eslint', 'lint:check'],
  test: ['test', 'test:unit', 'jest', 'vitest', 'mocha'],
  build: ['build', 'compile', 'bundle'],
  fix: ['fix', 'lint:fix', 'format', 'prettier'],
  coverage: ['coverage', 'test:coverage', 'test:cov']
};

/**
 * Detect the package manager from lockfiles in the project root.
 * @param {string} root - Project root directory
 * @returns {string} Package manager name: 'bun', 'pnpm', 'yarn', or 'npm'
 */
function detectPackageManagerFromRoot(root) {
  try {
    if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  } catch (_err) { /* fall through */ }
  return 'npm';
}

/**
 * Detect project scripts from package.json and map them to canonical config keys.
 * Reads the `scripts` section and matches known names to config.scripts keys.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Detected scripts mapped to canonical keys (e.g., { typecheck: 'pnpm type-check', lint: 'yarn lint' })
 */
function detectProjectScripts(projectRoot) {
  const detected = {};
  const packageJsonPath = path.join(projectRoot, 'package.json');

  let pkgData;
  try {
    pkgData = safeReadJson(packageJsonPath);
  } catch (err) {
    return detected;
  }

  if (!pkgData || !pkgData.scripts || typeof pkgData.scripts !== 'object') {
    return detected;
  }

  const scripts = pkgData.scripts;

  for (const [canonicalKey, variants] of Object.entries(SCRIPT_MAPPINGS)) {
    for (const variant of variants) {
      if (Object.hasOwn(scripts, variant)) {
        // Detect package manager for correct prefix
        const pm = detectPackageManagerFromRoot(projectRoot);
        const prefix = pm === 'npm' ? 'npm run' : pm === 'bun' ? 'bun run' : pm;
        detected[canonicalKey] = `${prefix} ${variant}`;
        break; // Use first match
      }
    }
  }

  return detected;
}

/**
 * Detect TypeScript configuration mode from tsconfig.json.
 * Distinguishes between standard mode and project references mode.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} 'project-references', 'standard', or null if no tsconfig
 */
function detectTsConfigMode(projectRoot) {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  const tsconfig = safeReadJson(tsconfigPath, null);
  if (!tsconfig) return null; // no tsconfig
  // Project references mode
  if (Array.isArray(tsconfig.references) && tsconfig.references.length > 0) {
    const hasEmptyFiles = Array.isArray(tsconfig.files) && tsconfig.files.length === 0;
    if (hasEmptyFiles) return 'project-references';
  }
  return 'standard';
}

/**
 * Get registry configuration based on detected project type.
 * Only enables registries relevant to the project type.
 *
 * @param {string} projectType - Detected project type
 * @returns {Array} Registry configuration array
 */
function getRegistriesForProjectType(projectType) {
  const componentRegistry = {
    id: 'components',
    enabled: false,
    activateWhen: 'frontend',
    autoScan: true,
    scanOn: ['sessionStart', 'afterTask', 'preCommit'],
    staleAfterMinutes: 60,
    directories: ['src/components', 'src/hooks', 'src/services', 'src/pages', 'src/modules', 'app'],
    ignore: ['*.test.*', '*.spec.*', '*.stories.*', 'index.ts', 'index.js', '__tests__', '__mocks__']
  };
  const functionRegistry = {
    id: 'functions',
    enabled: false,
    activateWhen: 'always',
    directories: ['src/utils', 'src/lib', 'src/helpers'],
    scanOn: ['sessionStart', 'afterTask'],
    autoUpdate: true
  };
  const apiRegistry = {
    id: 'apis',
    enabled: false,
    activateWhen: 'always',
    directories: ['src/api', 'src/services'],
    scanOn: ['sessionStart', 'afterTask'],
    autoUpdate: true
  };
  const schemaRegistry = { id: 'schemas', enabled: 'auto', activateWhen: 'orm' };
  const serviceRegistry = { id: 'services', enabled: 'auto', activateWhen: 'backend' };

  switch (projectType) {
    case 'frontend':
      // Enable component registry for frontend
      componentRegistry.enabled = true;
      functionRegistry.enabled = true;
      return [componentRegistry, functionRegistry, apiRegistry, schemaRegistry, serviceRegistry];

    case 'backend':
      // Enable service + API registries for backend
      apiRegistry.enabled = true;
      functionRegistry.enabled = true;
      serviceRegistry.enabled = true;
      return [componentRegistry, functionRegistry, apiRegistry, schemaRegistry, serviceRegistry];

    case 'fullstack':
      // Enable all registries for fullstack
      componentRegistry.enabled = true;
      functionRegistry.enabled = true;
      apiRegistry.enabled = true;
      serviceRegistry.enabled = true;
      return [componentRegistry, functionRegistry, apiRegistry, schemaRegistry, serviceRegistry];

    default:
      // Default: function registry enabled, rest on demand
      functionRegistry.enabled = true;
      return [componentRegistry, functionRegistry, apiRegistry, schemaRegistry, serviceRegistry];
  }
}

/**
 * Deep merge two objects. Target values are overwritten by source values.
 * Arrays are replaced, not concatenated.
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
const UNSAFE_MERGE_KEYS = new Set([
  '__proto__', 'constructor', 'prototype',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
]);

function deepMerge(target, source) {
  const result = Object.assign(Object.create(null), target);
  for (const key of Object.keys(source)) {
    if (UNSAFE_MERGE_KEYS.has(key)) continue;
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Parse command line arguments with bounds checking
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    cli: null,
    force: false,
    yes: false,
    help: false,
    basic: false  // Skip AI-driven setup recommendation
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--cli' || arg === '-c') {
      // Bounds check before accessing next argument
      if (i + 1 >= args.length) {
        console.error('Error: --cli requires a value');
        options.help = true;
        break;
      }
      options.cli = args[++i];
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--basic' || arg === '-b') {
      options.basic = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Usage: flow init [options]

Initialize Wogi Flow in the current directory.

💡 RECOMMENDED: Use AI-driven setup for the best experience:
   1. Start Claude Code
   2. Say "setup wogiflow" or run /wogi-init

   The AI wizard provides:
   • Pattern import from other projects
   • Tech stack selection with Context7 docs
   • Intelligent code review rules

Options:
  --cli, -c <name>    Select CLI (claude only)
  --basic, -b         Skip AI-setup recommendation, use basic CLI setup
  --force, -f         Overwrite existing configuration
  --yes, -y           Accept all defaults without prompting
  --help, -h          Show this help message

Examples:
  flow init                    # Recommended: suggests AI-driven setup
  flow init --basic            # Basic CLI setup (skip AI recommendation)
  flow init --cli claude -y    # Quick setup with defaults
  flow init --force            # Reinitialize existing project
`);
}

/**
 * Create readline interface for user input
 * @returns {readline.Interface}
 */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Ask a question and get user input
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - Question to ask
 * @param {string} defaultValue - Default value
 * @returns {Promise<string>} User's answer
 */
function ask(rl, question, defaultValue = '') {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * Ask a yes/no question
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - Question to ask
 * @param {boolean} defaultValue - Default value
 * @returns {Promise<boolean>}
 */
async function askYesNo(rl, question, defaultValue = true) {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `${question} ${hint}`, '');
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

/**
 * Select from a list of options
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - Question to ask
 * @param {Object} options - Options object {key: {name, description}}
 * @param {string} defaultKey - Default selection
 * @returns {Promise<string>} Selected key
 */
async function selectOption(rl, question, options, defaultKey) {
  console.log(`\n${question}`);
  const keys = Object.keys(options);
  keys.forEach((key, index) => {
    const opt = options[key];
    const marker = key === defaultKey ? '>' : ' ';
    console.log(`  ${marker} ${index + 1}. ${opt.name} - ${opt.description}`);
  });

  const answer = await ask(rl, 'Enter number or name', defaultKey);

  // Check if answer is a number
  const num = parseInt(answer, 10);
  if (!isNaN(num) && num >= 1 && num <= keys.length) {
    return keys[num - 1];
  }

  // Check if answer matches a key
  if (options[answer.toLowerCase()]) {
    return answer.toLowerCase();
  }

  return defaultKey;
}

// copyDir is imported from ./utils

/**
 * Create the .workflow directory structure
 * @param {string} projectRoot - Project root directory
 * @param {Object} config - Configuration options
 */
function createWorkflowStructure(projectRoot, config) {
  const workflowDir = path.join(projectRoot, '.workflow');

  // Create main directories
  const dirs = [
    'state',
    'changes/general',
    'models',
    'templates',
    'agents',
    'bridges',
    'roadmap',
    'specs',
    'verifications',
    // v1.0.4 - Additional workflow directories
    'traces',       // Code flow traces from /wogi-trace
    'checkpoints',  // Session state snapshots
    'corrections'   // Individual correction records from /wogi-correct
  ];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(workflowDir, dir), { recursive: true });
  }

  // Ensure .workflow/ uses CommonJS — required when project root has "type": "module"
  // Without this, Node.js inherits ESM from the project root and .workflow/bridges/*.js
  // (which use require/module.exports) crash with "require is not defined".
  // Same pattern as scripts/package.json.
  const workflowPkgPath = path.join(workflowDir, 'package.json');
  try {
    fs.writeFileSync(workflowPkgPath, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  // Create config.json — LEAN by default (v2.19.0+).
  // Only project-specific identity keys + any overrides the installer selected
  // interactively are written. The runtime loader (flow-config-loader.js)
  // merges CONFIG_DEFAULTS on every read via mergeWithDefaults(), so a lean
  // file behaves identically to a fully-specified one.
  //
  // This replaces the prior behavior of dumping the full ~300-line default
  // tree on every `flow init`, which was confusing (users thought they had
  // to maintain all those keys) and brittle (every new default shipped in a
  // release became stale in every existing project's config file).
  const configPath = path.join(workflowDir, 'config.json');
  const fullConfig = getDefaultConfig({
    version: config.version,
    projectName: config.projectName,
    projectType: config.projectType || 'unknown',
    strictMode: config.strictMode
  });
  const leanConfig = buildLeanInstallConfig(fullConfig, config);
  fs.writeFileSync(configPath, JSON.stringify(leanConfig, null, 2) + '\n');
  // To inspect the fully-merged config (defaults + your overrides), run:
  //   flow config show --full
  // To compact an existing fat config back to lean form, run:
  //   flow config compact

  // Sync .gitignore entries for enabled features. Pass the fully-merged
  // config (not the lean on-disk form) so gitignore can see all enabled
  // feature flags, including those inherited from defaults.
  try {
    const { syncGitignore } = require('../scripts/flow-gitignore');
    syncGitignore(fullConfig);
  } catch (_err) {
    // Non-blocking — gitignore sync should never fail installation
  }

  // Create ready.json
  const readyPath = path.join(workflowDir, 'state', 'ready.json');
  const readyContent = {
    lastUpdated: new Date().toISOString(),
    ready: [],
    inProgress: [],
    blocked: [],
    recentlyCompleted: []
  };
  fs.writeFileSync(readyPath, JSON.stringify(readyContent, null, 2));

  // Create empty state files
  const stateFiles = [
    { name: 'request-log.md', content: '# Request Log\n\nAutomatic log of all requests that changed files.\n\n---\n' },
    { name: 'decisions.md', content: '# Project Decisions\n\nKey decisions and patterns for this project.\n\n---\n' },
    { name: 'app-map.md', content: '# Application Map\n\nComponent registry for this project.\n\n---\n' },
    { name: 'progress.md', content: '# Progress Notes\n\nSession handoff notes.\n\n---\n' },
    { name: 'function-map.md', content: '# Function Registry\n\nUtility function registry. Run `flow function-index scan` to populate.\n\n---\n' },
    { name: 'api-map.md', content: '# API Registry\n\nAPI calls registry. Run `flow api-index scan` to populate.\n\n---\n' },
    { name: 'prompt-history.json', content: '{\n  "prompts": [],\n  "version": 1\n}\n' }
  ];

  for (const file of stateFiles) {
    const filePath = path.join(workflowDir, 'state', file.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, file.content);
    }
  }

  // Create registry manifest (dynamic registry discovery)
  const registryManifestPath = path.join(workflowDir, 'state', 'registry-manifest.json');
  if (!fs.existsSync(registryManifestPath)) {
    const registryManifestContent = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      registries: [
        { id: 'components', name: 'Component Registry', mapFile: 'app-map.md', indexFile: 'component-index.json', category: 'code', type: 'components', active: true },
        { id: 'functions', name: 'Function Registry', mapFile: 'function-map.md', indexFile: 'function-index.json', category: 'code', type: 'functions', active: true },
        { id: 'apis', name: 'API Registry', mapFile: 'api-map.md', indexFile: 'api-index.json', category: 'code', type: 'apis', active: true }
      ]
    };
    fs.writeFileSync(registryManifestPath, JSON.stringify(registryManifestContent, null, 2));
  }

  // Create model registry
  const registryPath = path.join(workflowDir, 'models', 'registry.json');
  const registryContent = {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    models: {}
  };
  fs.writeFileSync(registryPath, JSON.stringify(registryContent, null, 2));

  // Create folder manifest (v1.0.4)
  const manifestPath = path.join(workflowDir, 'manifest.json');
  const manifestContent = {
    version: config.version,
    description: 'Folder purposes and expected contents for WogiFlow',
    folders: {
      state: { purpose: 'Runtime workflow state', managed: true },
      specs: { purpose: 'Project specification documents', managed: true },
      traces: { purpose: 'Code flow traces', createdBy: '/wogi-trace', emptyIsOk: true },
      checkpoints: { purpose: 'Session state snapshots', createdBy: '/wogi-checkpoint', emptyIsOk: true },
      corrections: { purpose: 'Individual correction records', createdBy: '/wogi-correct', emptyIsOk: true },
      changes: { purpose: 'Feature proposals and tasks', managed: true },
      templates: { purpose: 'Handlebars templates', managed: true },
      agents: { purpose: 'AI agent prompt definitions', managed: true },
      bridges: { purpose: 'CLI bridge configurations', managed: true },
      models: { purpose: 'Model registry and tracking', managed: true }
    },
    lastUpdated: getTodayDate()
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));

  // Copy standard workflow subdirectories from package
  const workflowSubdirs = ['templates', 'agents', 'bridges'];
  for (const subdir of workflowSubdirs) {
    const src = path.join(PACKAGE_ROOT, '.workflow', subdir);
    const dest = path.join(workflowDir, subdir);
    if (fs.existsSync(src)) {
      copyDir(src, dest);
    }
  }

  // Copy capability files (per-model knowledge) from package
  const capSrc = path.join(PACKAGE_ROOT, '.workflow', 'models', 'capabilities');
  const capDest = path.join(workflowDir, 'models', 'capabilities');
  if (fs.existsSync(capSrc)) {
    try {
      copyDir(capSrc, capDest);
      console.log('  Copied model capability files');
    } catch (err) {
      console.warn(`  Warning: Failed to copy capability files: ${err.message}`);
    }
  }

  console.log('  Created .workflow/ directory structure');
}

/**
 * CLI-specific resource mappings
 * Maps CLI keys to their package source directories and output file names
 */
const CLI_RESOURCES = {
  claude: {
    packageDir: '.claude',
    rulesFile: 'CLAUDE.md',
    templateName: 'claude-md.hbs',
    subdirs: ['commands', 'docs', 'rules', 'skills']
  }
};

/**
 * Create CLI-specific configuration
 * @param {string} projectRoot - Project root directory
 * @param {string} cliKey - CLI identifier
 * @param {Object} config - Configuration
 */
function createCLIConfig(projectRoot, cliKey, config) {
  const cli = SUPPORTED_CLIS[cliKey];
  if (!cli) {
    console.error(`Unknown CLI: ${cliKey}`);
    return;
  }

  const cliDir = path.join(projectRoot, cli.dir);
  fs.mkdirSync(cliDir, { recursive: true });

  // Get CLI-specific resource configuration
  const resources = CLI_RESOURCES[cliKey];
  if (!resources) {
    console.log(`  ${cli.name} will be configured via bridge sync`);
    console.log(`  Configured ${cli.name}`);
    return;
  }

  // Copy common subdirectories (commands, docs, rules, skills)
  const packageCliDir = path.join(PACKAGE_ROOT, resources.packageDir);
  for (const subdir of resources.subdirs) {
    const packageSubdir = path.join(packageCliDir, subdir);
    const projectSubdir = path.join(cliDir, subdir);
    if (fs.existsSync(packageSubdir)) {
      copyDir(packageSubdir, projectSubdir);
      console.log(`  Copied ${cli.dir}/${subdir}/`);
    }
  }

  // Update the WogiFlow manifest with files copied by /wogi-init
  // (skills are NOT copied by postinstall, so they need to be added here)
  updateManifestAfterInit(cliDir);

  // Generate the rules/instructions file (CLAUDE.md)
  // First try to use the bridge for proper template rendering
  try {
    const bridgesPath = path.join(projectRoot, '.workflow', 'bridges');
    if (fs.existsSync(bridgesPath)) {
      const bridges = require(bridgesPath);
      const bridge = bridges.getBridge({ projectDir: projectRoot, verbose: false });
      if (bridge) {
        bridge.generateRulesFile();
        console.log(`  Created ${resources.rulesFile} (via bridge)`);
        console.log(`  Configured ${cli.name}`);
        return;
      }
    }
  } catch (err) {
    // Bridge not available yet - fall through to simple generation
    if (process.env.DEBUG) {
      console.log(`  Bridge not available: ${err.message}`);
    }
  }

  // Fallback: Create a simple rules file - the bridge will regenerate with full template
  const simpleContent = `# Project Instructions

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

## Quick Start

\`\`\`bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
\`\`\`

## Core Commands

- \`/wogi-ready\` - Show available tasks
- \`/wogi-start TASK-X\` - Start a task (or \`/wogi-start "description"\` to route any request)
- \`/wogi-story "title"\` - Create story with acceptance criteria
- \`/wogi-status\` - Project overview
- \`/wogi-health\` - Check workflow health
- \`/wogi-review\` - Code review
- \`/wogi-bug "description"\` - Report a bug

Run \`flow bridge sync\` to regenerate this file with full template.

Generated by Wogi Flow v${config.version}
`;

  // Determine output path (handle nested paths)
  const rulesFilePath = path.join(projectRoot, resources.rulesFile);

  // Ensure parent directory exists for nested paths
  const rulesFileDir = path.dirname(rulesFilePath);
  if (!fs.existsSync(rulesFileDir)) {
    fs.mkdirSync(rulesFileDir, { recursive: true });
  }

  fs.writeFileSync(rulesFilePath, simpleContent);
  console.log(`  Created ${resources.rulesFile}`);

  console.log(`  Configured ${cli.name}`);
}

/**
 * Copy scripts from package to project
 * @param {string} projectRoot - Project root directory
 */
function copyScripts(projectRoot) {
  const packageScripts = path.join(PACKAGE_ROOT, 'scripts');
  const projectScripts = path.join(projectRoot, 'scripts');

  if (fs.existsSync(packageScripts)) {
    copyDir(packageScripts, projectScripts);

    // Make flow script executable
    const flowScript = path.join(projectScripts, 'flow');
    if (fs.existsSync(flowScript)) {
      fs.chmodSync(flowScript, 0o755);
    }

    console.log('  Copied scripts/ directory');
  }
}

/**
 * Main initialization function
 * @param {string[]} args - Command line arguments
 */
async function init(args) {
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  const projectRoot = process.cwd();
  const workflowDir = path.join(projectRoot, '.workflow');

  // Check for existing installation
  if (fs.existsSync(workflowDir) && !options.force) {
    console.log('Wogi Flow is already initialized in this directory.');
    console.log('Use --force to reinitialize.');
    return;
  }

  // Check if this is from a fresh install - recommend AI-driven setup
  const pendingSetupPath = path.join(workflowDir, 'state', 'pending-setup.json');
  const hasPendingSetup = fs.existsSync(pendingSetupPath);

  if (hasPendingSetup && !options.basic && !options.yes) {
    console.log('\n' + '═'.repeat(62));
    console.log('  💡 AI-Driven Setup Recommended');
    console.log('═'.repeat(62));
    console.log('');
    console.log('  For the best experience, use the AI-driven setup wizard:');
    console.log('');
    console.log('  1. Start Claude Code:');
    console.log('     \x1b[32mclaude\x1b[0m  (the official Anthropic CLI)');
    console.log('');
    console.log('  2. Then say: \x1b[33m"setup wogiflow"\x1b[0m or run \x1b[33m/wogi-init\x1b[0m');
    console.log('');
    console.log('  The AI wizard will:');
    console.log('    • Import patterns from other projects');
    console.log('    • Guide you through tech stack selection');
    console.log('    • Generate Context7 documentation skills');
    console.log('    • Set up intelligent code review rules');
    console.log('');
    console.log('═'.repeat(62));
    console.log('');
    console.log('  To continue with basic CLI setup instead:');
    console.log('    \x1b[33mflow init --basic\x1b[0m  or  \x1b[33mflow init -y\x1b[0m');
    console.log('');

    // Ask if they want to continue with basic setup
    const rl = createReadline();
    try {
      const proceed = await askYesNo(rl, 'Continue with basic CLI setup anyway?', false);
      rl.close();
      if (!proceed) {
        console.log('\nGreat! Start your AI assistant and run /wogi-init 🚀\n');
        return;
      }
      console.log('');
    } catch (err) {
      rl.close();
      console.error(`\nSetup prompt failed: ${err.message}`);
      console.log('Run "flow init --basic" to skip the AI recommendation.\n');
      process.exit(1);
    }
  }

  console.log('\n🚀 Wogi Flow Installer\n');

  let config = { ...DEFAULT_CONFIG };

  // Detect project name from package.json or directory name
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const projectPkg = safeReadJson(packageJsonPath);
  if (projectPkg && projectPkg.name) {
    config.projectName = projectPkg.name;
  } else {
    config.projectName = path.basename(projectRoot);
  }

  // Validate CLI option early (before interactive mode)
  if (options.cli && !SUPPORTED_CLIS[options.cli]) {
    console.error(`Unknown CLI: ${options.cli}`);
    console.log(`Supported CLIs: ${Object.keys(SUPPORTED_CLIS).join(', ')}`);
    process.exit(1);
  }

  // Interactive or quick mode
  if (options.yes) {
    // Use defaults and CLI option if provided
    config.cliKey = options.cli || 'claude';
    console.log(`Using quick mode with ${SUPPORTED_CLIS[config.cliKey].name}`);
  } else {
    // Interactive mode
    const rl = createReadline();

    try {
      // Confirm project name
      config.projectName = await ask(rl, 'Project name', config.projectName);

      // Select CLI
      config.cliKey = options.cli || await selectOption(
        rl,
        'Which AI CLI are you using?',
        SUPPORTED_CLIS,
        'claude'
      );

      // Enable strict mode?
      config.strictMode = await askYesNo(
        rl,
        'Enable strict mode (require tasks for changes)?',
        true
      );

      // Confirm
      console.log('\nConfiguration:');
      console.log(`  Project: ${config.projectName}`);
      console.log(`  CLI: ${SUPPORTED_CLIS[config.cliKey].name}`);
      console.log(`  Strict Mode: ${config.strictMode ? 'Yes' : 'No'}`);

      const proceed = await askYesNo(rl, '\nProceed with installation?', true);
      if (!proceed) {
        console.log('Installation cancelled.');
        rl.close();
        return;
      }

      rl.close();
    } catch (err) {
      rl.close();
      console.error(`\nSetup failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Detect project type before creating structure
  config.projectType = detectProjectType(projectRoot);

  // Auto-detect project scripts from package.json
  const detectedScripts = detectProjectScripts(projectRoot);
  // Merge detected scripts on top of config (overwriting null defaults)
  for (const [key, value] of Object.entries(detectedScripts)) {
    if (value) {
      config.scripts[key] = value;
    }
  }

  // If no typecheck script was detected from package.json AND tsconfig
  // uses project references, use tsc --build instead of the default tsc --noEmit
  if (!detectedScripts.typecheck) {
    const tsMode = detectTsConfigMode(projectRoot);
    if (tsMode === 'project-references') {
      const pm = detectPackageManagerFromRoot(projectRoot);
      const exec = pm === 'npm' ? 'npx' : pm === 'yarn' ? 'yarn dlx' : pm === 'pnpm' ? 'pnpm dlx' : 'bunx';
      config.scripts.typecheck = `${exec} tsc --build --force`;
    }
  }

  console.log('\nInstalling Wogi Flow...\n');

  // Create structure
  createWorkflowStructure(projectRoot, config);

  // Create CLI config
  createCLIConfig(projectRoot, config.cliKey, config);

  // Copy scripts
  copyScripts(projectRoot);

  // Populate testing.detected with project analysis results
  try {
    const configPath = path.join(projectRoot, '.workflow', 'config.json');
    if (fs.existsSync(configPath)) {
      const savedConfig = safeReadJson(configPath, null);
      if (!savedConfig) return;
      // Use the more detailed analyzer from flow-project-analyzer if available
      let detection = null;
      try {
        const analyzer = require('../scripts/flow-project-analyzer');
        detection = analyzer.detectProjectType(projectRoot);
      } catch (err) {
        // Fallback: use basic projectType from installer's own detection
        detection = {
          projectType: config.projectType || 'unknown',
          hasUI: ['frontend', 'fullstack'].includes(config.projectType),
          hasAPI: ['backend', 'fullstack'].includes(config.projectType),
          uiFramework: null,
          apiFramework: null,
          testFramework: null
        };
      }
      if (detection) {
        if (!savedConfig.testing) savedConfig.testing = {};
        savedConfig.testing.detected = {
          projectType: detection.projectType,
          hasUI: detection.hasUI,
          hasAPI: detection.hasAPI,
          uiFramework: detection.uiFramework || null,
          apiFramework: detection.apiFramework || null,
          testFramework: detection.testFramework || null
        };
        fs.writeFileSync(configPath, JSON.stringify(savedConfig, null, 2));
        console.log(`  Detected project type: ${detection.projectType}`);
      }
    }
  } catch (err) {
    // Non-fatal — detection can happen later
    console.log(`  Could not auto-detect project type: ${err.message}`);
  }

  // Run probeProject() to generate verification-profile.json
  try {
    const verificationProfile = require('../scripts/flow-verification-profile');
    if (typeof verificationProfile.probeProject === 'function') {
      try {
        await verificationProfile.probeProject(projectRoot);
        console.log('  Generated verification-profile.json');
      } catch (_err) {
        // Non-fatal — profile can be generated later via /wogi-test
      }
    }
  } catch (err) {
    // Non-fatal — flow-verification-profile may not exist yet during initial install
  }

  console.log('\n✅ Wogi Flow initialized successfully!\n');
  console.log('Next steps:');
  console.log('  1. Review .workflow/config.json');
  console.log('  2. Run `/wogi-status` to see project status');
  console.log('  3. Create your first task with `/wogi-story "Task title"`');
  console.log('');
  console.log('Available commands:');
  console.log('  /wogi-ready   - View available tasks');
  console.log('  /wogi-status  - Project overview');
  console.log('  /wogi-health  - Check workflow health');
  console.log('  /wogi-story   - Create a new story');
  console.log('');
  printPromptCachingTip();
}

/**
 * Print the ENABLE_PROMPT_CACHING_1H recommendation for non-subscriber Claude Code users.
 *
 * Claude Pro/Max/Team/Enterprise (OAuth via claude.ai) already get 1-hour prompt-cache TTL.
 * API-key, Bedrock, Vertex, and Foundry users default to 5min TTL — any pause longer than
 * 5min during a WogiFlow session invalidates the cached CLAUDE.md + state-file prefix and
 * re-pays the full input-token cost on the next turn. Enabling 1h TTL gives substantial
 * savings on typical multi-hour sessions.
 *
 * We surface this exactly once, during `flow init` onboarding. The full rationale lives in
 * `.claude/docs/claude-code-compatibility.md` under "Features in 2.1.108+".
 */
function printPromptCachingTip() {
  console.log('💡 Performance tip (API-key / Bedrock / Vertex / Foundry users):');
  console.log('   Set \x1b[33mENABLE_PROMPT_CACHING_1H=1\x1b[0m in your shell profile for 1-hour');
  console.log('   prompt-cache TTL (default is 5min). Claude subscribers already get 1h by default.');
  console.log('   Details: \x1b[36m.claude/docs/claude-code-compatibility.md\x1b[0m (Features in 2.1.108+)');
  console.log('');
}

/**
 * Update the WogiFlow manifest after /wogi-init copies additional files (e.g., skills).
 * Reads existing manifest, walks the .claude/ dir for new files, and merges them in.
 * @param {string} cliDir - The .claude/ directory path
 */
function updateManifestAfterInit(cliDir) {
  const manifestPath = path.join(cliDir, '.wogiflow-manifest.json');
  let manifest;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
    if (!manifest || !Array.isArray(manifest.files)) {
      manifest = { version: 1, files: [], directories: ['.workflow'] };
    }
  } catch (err) {
    // No manifest yet — create a fresh one
    manifest = { version: 1, files: [], directories: ['.workflow'] };
  }

  const existingFiles = new Set(manifest.files);

  // Walk all WogiFlow-owned subdirs to find newly added files
  const ownedDirs = ['commands', 'docs', 'rules', 'skills'];
  for (const dir of ownedDirs) {
    const dirPath = path.join(cliDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDirForManifest(dirPath, cliDir, existingFiles);
  }

  manifest.files = Array.from(existingFiles).sort();
  manifest.generatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[installer] Failed to update manifest: ${err.message}`);
    }
  }
}

/**
 * Walk a directory and add file paths to the set.
 * @param {string} dir - Directory to walk
 * @param {string} baseDir - Base directory for relative paths
 * @param {Set<string>} fileSet - Set to add relative paths to
 */
function walkDirForManifest(dir, baseDir, fileSet) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === '.DS_Store') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDirForManifest(fullPath, baseDir, fileSet);
      } else {
        fileSet.add(path.relative(baseDir, fullPath));
      }
    }
  } catch (err) {
    // Non-critical — skip unreadable dirs
  }
}

/**
 * Build the lean config written by `flow init` (v2.19.0+).
 *
 * The runtime loader merges CONFIG_DEFAULTS on every read, so we only need to
 * persist values that (a) identify this project or (b) differ from the default.
 * We prefer the `computeLeanConfig()` diff over a hand-picked allowlist so any
 * interactive-install overrides (e.g. strictMode toggled off) are preserved.
 *
 * @param {Object} fullConfig - The fully-merged config object from getDefaultConfig()
 * @param {Object} config - The install-time config selections (projectName, version, etc.)
 * @returns {Object} Lean config suitable for writing to .workflow/config.json
 */
function buildLeanInstallConfig(fullConfig, config) {
  const { computeLeanConfig } = require('../scripts/flow-config-defaults');
  const lean = computeLeanConfig(fullConfig);

  // Ensure identity keys are always present with the expected shape.
  const out = {
    $schema: './config.schema.json',
    version: config.version,
    projectName: config.projectName || '',
    cli: { type: 'claude-code' },
    ...lean
  };

  // Strip identity keys from the lean block so they aren't duplicated.
  // (The spread above means lean's values would win; we want OURS to win.)
  return {
    $schema: out.$schema,
    version: out.version,
    projectName: out.projectName,
    cli: out.cli,
    ...Object.fromEntries(
      Object.entries(lean).filter(([k]) => !['$schema', 'version', 'projectName', 'cli'].includes(k))
    )
  };
}

module.exports = { init, getDefaultConfig, deepMerge, detectProjectType, detectProjectScripts, detectTsConfigMode, getRegistriesForProjectType, buildLeanInstallConfig };
