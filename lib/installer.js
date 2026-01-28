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

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Shared utilities
const { copyDir, safeReadJson } = require('./utils');

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
    description: 'Anthropic Claude Code CLI'
  },
  gemini: {
    name: 'Gemini CLI',
    dir: '.gemini',
    configFile: 'GEMINI.md',
    description: 'Google Gemini CLI'
  },
  opencode: {
    name: 'OpenCode',
    dir: '.opencode',
    configFile: 'config.yaml',
    description: 'OpenCode CLI'
  }
};

// Default configuration - version read from package.json
const DEFAULT_CONFIG = {
  version: PACKAGE_VERSION,
  projectName: '',
  cli: 'claude',
  strictMode: true,
  releaseChannel: 'stable'
};

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
   1. Start your AI assistant: claude, gemini, or opencode
   2. Say "setup wogiflow" or run /wogi-init

   The AI wizard provides:
   • Pattern import from other projects
   • Tech stack selection with Context7 docs
   • Intelligent code review rules

Options:
  --cli, -c <name>    Select CLI (claude, gemini, opencode)
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

  // Create config.json
  const configPath = path.join(workflowDir, 'config.json');
  const configContent = {
    version: config.version,
    projectName: config.projectName,
    cli: config.cli,
    enforcement: {
      strictMode: config.strictMode,
      requireTasks: true,
      requireApproval: true
    },
    releaseChannel: config.releaseChannel,
    autoUpdate: {
      enabled: true,
      notifyOnly: true
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));

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
    { name: 'api-map.md', content: '# API Registry\n\nAPI calls registry. Run `flow api-index scan` to populate.\n\n---\n' }
  ];

  for (const file of stateFiles) {
    const filePath = path.join(workflowDir, 'state', file.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, file.content);
    }
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
    lastUpdated: new Date().toISOString().split('T')[0]
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
  },
  gemini: {
    packageDir: '.claude', // Share Claude's resources as base, bridge customizes output
    rulesFile: 'GEMINI.md',
    templateName: 'gemini-md.hbs',
    subdirs: ['commands', 'docs', 'rules', 'skills']
  },
  opencode: {
    packageDir: '.claude',
    rulesFile: '.opencode/agents.md',
    templateName: 'opencode-agents-md.hbs',
    subdirs: ['docs', 'skills']
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

  // Generate the rules/instructions file (CLAUDE.md, GEMINI.md, etc.)
  // First try to use the bridge for proper template rendering
  try {
    const bridgesPath = path.join(projectRoot, '.workflow', 'bridges');
    if (fs.existsSync(bridgesPath)) {
      const bridges = require(bridgesPath);
      const bridge = bridges.getBridge({ projectDir: projectRoot, cliType: cliKey === 'claude' ? 'claude-code' : cliKey === 'gemini' ? 'gemini-cli' : cliKey, verbose: false });
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

## Quick Start

\`\`\`bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
\`\`\`

## Core Commands

- \`/wogi-ready\` - Show available tasks
- \`/wogi-start TASK-X\` - Start a task
- \`/wogi-status\` - Project overview
- \`/wogi-health\` - Check workflow health

Run \`flow bridge sync\` to regenerate this file with full template.

Generated by Wogi Flow v${config.version}
`;

  // Determine output path (handle nested paths like .opencode/agents.md)
  const rulesFilePath = resources.rulesFile.includes('/')
    ? path.join(projectRoot, resources.rulesFile)
    : path.join(projectRoot, resources.rulesFile);

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
    console.log('  1. Start your AI assistant:');
    console.log('     \x1b[32mclaude\x1b[0m  (Claude Code)');
    console.log('     \x1b[32mgemini\x1b[0m  (Gemini CLI)');
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
    config.cli = options.cli || 'claude';
    console.log(`Using quick mode with ${SUPPORTED_CLIS[config.cli].name}`);
  } else {
    // Interactive mode
    const rl = createReadline();

    try {
      // Confirm project name
      config.projectName = await ask(rl, 'Project name', config.projectName);

      // Select CLI
      config.cli = options.cli || await selectOption(
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
      console.log(`  CLI: ${SUPPORTED_CLIS[config.cli].name}`);
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

  console.log('\nInstalling Wogi Flow...\n');

  // Create structure
  createWorkflowStructure(projectRoot, config);

  // Create CLI config
  createCLIConfig(projectRoot, config.cli, config);

  // Copy scripts
  copyScripts(projectRoot);

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
}

module.exports = { init };
