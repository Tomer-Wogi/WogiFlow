#!/usr/bin/env node

/**
 * Wogi Flow - Unified Onboarding Wizard
 *
 * Comprehensive setup wizard that runs on npm postinstall.
 * Combines project setup, tech stack configuration, and project scanning.
 *
 * Flow:
 * 1. Welcome + Project name
 * 2. New or existing project?
 * 3. Import config? (for solo devs)
 * 4. IF NEW → Tech stack wizard → generate skills
 *    IF EXISTING → Scan project → show findings → approve
 * 5. CLI preference + final setup
 * 6. Success!
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Import shared utilities
const { copyDir } = require('./utils');

// Import security utilities from flow-utils
let safeJsonParse, isPathWithinProject;
try {
  const utils = require('../scripts/flow-utils');
  safeJsonParse = utils.safeJsonParse;
  isPathWithinProject = utils.isPathWithinProject;
} catch {
  // Fallback implementations if flow-utils not available
  safeJsonParse = (filePath, defaultValue = null) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (/__proto__|constructor\s*["'`:]|prototype\s*["'`:]/i.test(content)) {
        return defaultValue;
      }
      return JSON.parse(content);
    } catch {
      return defaultValue;
    }
  };
  isPathWithinProject = (targetPath, baseDir = process.cwd()) => {
    const resolved = path.resolve(targetPath);
    const resolvedBase = path.resolve(baseDir);
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
  };
}

// Package root
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Read version from package.json (single source of truth)
const pkg = safeJsonParse(path.join(PACKAGE_ROOT, 'package.json'), {});
const PACKAGE_VERSION = pkg.version || '1.0.0';

// Constants (extracted from magic numbers)
const MAX_DIRECTORY_DEPTH = 5;
const MAX_FILE_COUNT = 10000;
const SOURCE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java'];
const ALLOWED_CONFIG_KEYS = ['projectName', 'projectType', 'cli', 'strictMode', 'stackSelections', 'scanFindings'];
const ALLOWED_IMPORT_FILES = ['decisions.md', 'stack.md', 'architecture.md'];

// Colors
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// Supported CLIs
const SUPPORTED_CLIS = {
  claude: { name: 'Claude Code', dir: '.claude', description: 'Anthropic Claude Code CLI' },
  gemini: { name: 'Gemini CLI', dir: '.gemini', description: 'Google Gemini CLI' },
  opencode: { name: 'OpenCode', dir: '.opencode', description: 'OpenCode CLI' }
};

/**
 * Unified Wizard Class
 */
class UnifiedWizard {
  constructor() {
    this.rl = null;
    this.config = {
      projectName: '',
      projectType: '', // 'new' | 'existing'
      cli: 'claude',
      strictMode: true,
      importPath: null,
      stackSelections: null,
      scanFindings: null
    };
    this.projectRoot = process.cwd();
  }

  /**
   * Run the unified wizard
   */
  async run() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      // Step 1: Welcome
      this.printWelcome();

      // Step 2: Project name
      await this.askProjectName();

      // Step 3: New or existing project?
      await this.askProjectType();

      // Step 4: Import config option (for solo devs)
      const imported = await this.askImportConfig();
      if (imported) {
        await this.finalizeSetup();
        return this.config;
      }

      // Step 5: Branch based on project type
      if (this.config.projectType === 'new') {
        await this.runStackWizard();
      } else {
        await this.runProjectScanner();
      }

      // Step 6: CLI preference
      await this.askCLIPreference();

      // Step 7: Strict mode
      await this.askStrictMode();

      // Step 8: Show summary and confirm
      const confirmed = await this.showSummaryAndConfirm();
      if (!confirmed) {
        console.log(c('yellow', '\nSetup cancelled. Run `flow init` to try again.\n'));
        return null;
      }

      // Step 9: Create everything
      await this.finalizeSetup();

      // Step 10: Success
      this.printSuccess();

      return this.config;

    } finally {
      if (this.rl) {
        this.rl.close();
      }
    }
  }

  // ============================================
  // UI HELPERS
  // ============================================

  printWelcome() {
    console.log('\n' + c('cyan', '═'.repeat(60)));
    console.log(c('cyan', '  Welcome to Wogi Flow!'));
    console.log(c('cyan', '  AI-powered development workflow management'));
    console.log(c('cyan', '═'.repeat(60)) + '\n');
  }

  printSuccess() {
    console.log('\n' + c('green', '═'.repeat(60)));
    console.log(c('green', '  ✅ Wogi Flow setup complete!'));
    console.log(c('green', '═'.repeat(60)) + '\n');

    console.log('Your project is ready. Here\'s what was created:\n');
    console.log(`  ${c('cyan', '.workflow/')}     - Configuration and state`);
    console.log(`  ${c('cyan', '.claude/')}      - Claude Code integration`);
    console.log(`  ${c('cyan', 'scripts/')}      - CLI commands\n`);

    console.log('Next steps:');
    console.log(`  1. ${c('yellow', './scripts/flow status')} - See project overview`);
    console.log(`  2. ${c('yellow', './scripts/flow ready')}  - View available tasks`);
    console.log(`  3. ${c('yellow', './scripts/flow story "Your task"')} - Create your first task\n`);
  }

  ask(question, defaultValue = '') {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async askYesNo(question, defaultValue = true) {
    const hint = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${hint}`, '');
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
  }

  async askChoice(question, options, defaultKey = null) {
    console.log(`\n${question}\n`);

    const keys = Object.keys(options);
    keys.forEach((key, index) => {
      const opt = options[key];
      const marker = key === defaultKey ? c('green', '>') : ' ';
      const label = typeof opt === 'string' ? opt : opt.name || opt.label;
      const desc = typeof opt === 'object' && opt.description ? ` - ${opt.description}` : '';
      console.log(`  ${marker} (${index + 1}) ${label}${desc}`);
    });

    const answer = await this.ask('\nYour choice', defaultKey || '1');

    // Check if answer is a number
    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= keys.length) {
      return keys[num - 1];
    }

    // Check if answer matches a key
    if (options[answer.toLowerCase()]) {
      return answer.toLowerCase();
    }

    return defaultKey || keys[0];
  }

  // ============================================
  // STEP IMPLEMENTATIONS
  // ============================================

  async askProjectName() {
    // Try to detect from package.json
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    let detectedName = path.basename(this.projectRoot);

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = safeJsonParse(packageJsonPath, null);
        if (pkg && pkg.name) {
          detectedName = pkg.name;
        }
      } catch (err) {
        // Log for debugging but continue with fallback
        if (process.env.DEBUG) {
          console.error(`[DEBUG] Failed to read package.json: ${err.message}`);
        }
      }
    }

    this.config.projectName = await this.ask('Project name', detectedName);
  }

  async askProjectType() {
    const choice = await this.askChoice(
      'Is this a new project or an existing codebase?',
      {
        new: { name: 'New project', description: 'Starting fresh - configure tech stack' },
        existing: { name: 'Existing project', description: 'Scan and analyze current codebase' }
      },
      'existing'
    );

    this.config.projectType = choice;
  }

  async askImportConfig() {
    const wantImport = await this.askYesNo(
      'Import configuration from another WogiFlow project?',
      false
    );

    if (!wantImport) {
      return false;
    }

    const importPath = await this.ask('Path to .workflow/ directory or export file');

    if (!importPath) {
      console.log(c('yellow', '  No path provided. Continuing with fresh setup.\n'));
      return false;
    }

    // Validate path exists
    try {
      fs.accessSync(importPath, fs.constants.R_OK);
    } catch {
      console.log(c('yellow', '  Path not found or not readable. Continuing with fresh setup.\n'));
      return false;
    }

    try {
      await this.importConfig(importPath);
      console.log(c('green', '  ✓ Configuration imported successfully!\n'));
      return true;
    } catch (err) {
      // Sanitize error message - don't expose full paths
      const safeMessage = process.env.DEBUG ? err.message : 'Unable to import configuration';
      console.log(c('yellow', `  Import failed: ${safeMessage}. Continuing with fresh setup.\n`));
      return false;
    }
  }

  /**
   * Validate that imported config only contains allowed keys
   */
  validateImportedConfig(imported) {
    if (!imported || typeof imported !== 'object') {
      return {};
    }
    const validated = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(imported, key)) {
        validated[key] = imported[key];
      }
    }
    return validated;
  }

  async importConfig(importPath) {
    // Wrap all file operations in try-catch per security rules
    let stat;
    try {
      stat = fs.statSync(importPath);
    } catch (err) {
      throw new Error('Path is not accessible');
    }

    if (stat.isDirectory()) {
      // Import from .workflow directory
      const configPath = path.join(importPath, 'config.json');

      try {
        if (fs.existsSync(configPath)) {
          const imported = safeJsonParse(configPath, null);
          if (imported) {
            // Validate and filter allowed keys only
            const validated = this.validateImportedConfig(imported);
            this.config = { ...this.config, ...validated };
          }
        }
      } catch (err) {
        throw new Error('Failed to parse config.json');
      }

      // Copy state files with validation
      const statePath = path.join(importPath, 'state');
      try {
        if (fs.existsSync(statePath)) {
          const targetState = path.join(this.projectRoot, '.workflow', 'state');
          fs.mkdirSync(targetState, { recursive: true });

          // Only copy files from whitelist
          for (const file of ALLOWED_IMPORT_FILES) {
            // Validate filename: alphanumeric, hyphens, dots only (no path separators)
            if (!/^[a-z0-9\-\.]+$/i.test(file) || file.includes('..')) {
              continue;
            }

            const src = path.join(statePath, file);
            const dest = path.join(targetState, file);

            // Defense-in-depth: verify paths stay within expected directories
            if (!isPathWithinProject(src, statePath) || !isPathWithinProject(dest, targetState)) {
              continue;
            }

            try {
              if (fs.existsSync(src) && !fs.existsSync(dest)) {
                fs.copyFileSync(src, dest);
              }
            } catch (copyErr) {
              // Log but continue with other files
              if (process.env.DEBUG) {
                console.error(`[DEBUG] Failed to copy ${file}: ${copyErr.message}`);
              }
            }
          }
        }
      } catch (err) {
        throw new Error('Failed to copy state files');
      }
    } else {
      // Import from export file (JSON)
      try {
        const exported = safeJsonParse(importPath, null);
        if (exported && exported.config) {
          // Validate and filter allowed keys only
          const validated = this.validateImportedConfig(exported.config);
          this.config = { ...this.config, ...validated };
        }
      } catch (err) {
        throw new Error('Failed to parse export file');
      }
    }
  }

  async runStackWizard() {
    console.log(c('cyan', '\n━━━ Tech Stack Configuration ━━━\n'));

    try {
      // Try to load the enhanced stack wizard
      const { EnhancedStackWizard } = require('../scripts/flow-stack-wizard');

      if (!EnhancedStackWizard || typeof EnhancedStackWizard !== 'function') {
        throw new Error('EnhancedStackWizard not found or invalid');
      }

      const wizard = new EnhancedStackWizard();

      // Validate wizard has required properties before transfer
      if (typeof wizard.run !== 'function') {
        throw new Error('Stack wizard missing run() method');
      }

      // Transfer readline to stack wizard
      // Note: This assumes stack wizard accepts external readline interface
      wizard.rl = this.rl;

      // Run the wizard (it will use our readline)
      const result = await wizard.run();
      if (result && typeof result === 'object') {
        this.config.stackSelections = result;
      }

    } catch (err) {
      // Log error in debug mode for troubleshooting
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Stack wizard error: ${err.message}`);
      }
      // Fallback: Ask basic questions
      console.log(c('dim', '  (Running simplified tech stack setup)\n'));
      await this.runSimplifiedStackSetup();
    }
  }

  async runSimplifiedStackSetup() {
    // Basic framework selection
    const framework = await this.askChoice(
      'What\'s your primary framework?',
      {
        nextjs: { name: 'Next.js', description: 'React framework' },
        react: { name: 'React', description: 'UI library' },
        nestjs: { name: 'NestJS', description: 'Node.js backend' },
        express: { name: 'Express', description: 'Minimal Node.js' },
        fastapi: { name: 'FastAPI', description: 'Python backend' },
        other: { name: 'Other', description: 'Something else' }
      },
      'nextjs'
    );

    this.config.stackSelections = { framework };
  }

  async runProjectScanner() {
    console.log(c('cyan', '\n━━━ Scanning Project ━━━\n'));
    console.log('Analyzing your codebase...\n');

    const findings = {
      language: null,
      framework: null,
      database: null,
      testFramework: null,
      packageManager: null,
      files: 0,
      components: []
    };

    // Detect language from package.json
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    try {
      if (fs.existsSync(packageJsonPath)) {
        const pkg = safeJsonParse(packageJsonPath, null);

        // Validate pkg structure before accessing properties
        if (pkg && typeof pkg === 'object') {
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

          // Check for TypeScript
          if (deps.typescript) {
            findings.language = 'TypeScript';
          } else {
            findings.language = 'JavaScript';
          }

          // Detect framework
          if (deps.next) findings.framework = 'Next.js';
          else if (deps.react) findings.framework = 'React';
          else if (deps['@nestjs/core']) findings.framework = 'NestJS';
          else if (deps.express) findings.framework = 'Express';
          else if (deps.vue) findings.framework = 'Vue';

          // Detect test framework
          if (deps.jest) findings.testFramework = 'Jest';
          else if (deps.vitest) findings.testFramework = 'Vitest';
          else if (deps.mocha) findings.testFramework = 'Mocha';

          // Detect database
          if (deps.prisma || deps['@prisma/client']) findings.database = 'Prisma';
          else if (deps.typeorm) findings.database = 'TypeORM';
          else if (deps.mongoose) findings.database = 'MongoDB (Mongoose)';
        }

        // Detect package manager
        try {
          findings.packageManager = fs.existsSync(path.join(this.projectRoot, 'yarn.lock')) ? 'Yarn' :
                                    fs.existsSync(path.join(this.projectRoot, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
        } catch {
          findings.packageManager = 'npm';
        }
      }
    } catch (err) {
      // Log error in debug mode but continue with scan
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Failed to parse package.json: ${err.message}`);
      }
      console.log(c('dim', '  (Unable to detect technologies from package.json)\n'));
    }

    // Count files
    findings.files = this.countSourceFiles();

    // Store findings
    this.config.scanFindings = findings;

    // Display findings
    console.log('  ' + c('green', '✓') + ' Scan complete!\n');
    console.log('  Detected:');
    if (findings.language) console.log(`    Language: ${c('cyan', findings.language)}`);
    if (findings.framework) console.log(`    Framework: ${c('cyan', findings.framework)}`);
    if (findings.database) console.log(`    Database: ${c('cyan', findings.database)}`);
    if (findings.testFramework) console.log(`    Testing: ${c('cyan', findings.testFramework)}`);
    if (findings.packageManager) console.log(`    Package Manager: ${c('cyan', findings.packageManager)}`);
    console.log(`    Source Files: ${c('cyan', findings.files.toString())}`);

    // Ask for approval
    const approved = await this.askYesNo('\nDoes this look correct?', true);
    if (!approved) {
      console.log(c('dim', '\n  You can adjust settings later in .workflow/config.json\n'));
    }
  }

  countSourceFiles() {
    let count = 0;

    const walk = (dir, depth = 0) => {
      // Use constants for limits
      if (depth > MAX_DIRECTORY_DEPTH) return;
      if (count > MAX_FILE_COUNT) return; // Safety limit

      try {
        fs.accessSync(dir, fs.constants.R_OK);
      } catch {
        return; // Skip inaccessible directories
      }

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
            count++;
            if (count > MAX_FILE_COUNT) return;
          }
        }
      } catch (err) {
        // Log permission errors in debug mode
        if (process.env.DEBUG) {
          console.error(`[DEBUG] Cannot read directory ${dir}: ${err.message}`);
        }
      }
    };

    walk(this.projectRoot);
    return Math.min(count, MAX_FILE_COUNT);
  }

  async askCLIPreference() {
    this.config.cli = await this.askChoice(
      'Which AI CLI are you using?',
      SUPPORTED_CLIS,
      'claude'
    );
  }

  async askStrictMode() {
    this.config.strictMode = await this.askYesNo(
      'Enable strict mode (require tasks for code changes)?',
      true
    );
  }

  async showSummaryAndConfirm() {
    console.log('\n' + c('bold', '━━━ Setup Summary ━━━') + '\n');

    console.log(`  Project: ${c('cyan', this.config.projectName)}`);
    console.log(`  Type: ${c('cyan', this.config.projectType === 'new' ? 'New project' : 'Existing project')}`);
    console.log(`  CLI: ${c('cyan', SUPPORTED_CLIS[this.config.cli].name)}`);
    console.log(`  Strict Mode: ${c('cyan', this.config.strictMode ? 'Enabled' : 'Disabled')}`);

    if (this.config.stackSelections) {
      console.log(`  Tech Stack: ${c('cyan', 'Configured')}`);
    }

    if (this.config.scanFindings) {
      console.log(`  Detected: ${c('cyan', this.config.scanFindings.framework || this.config.scanFindings.language || 'Unknown')}`);
    }

    return await this.askYesNo('\nProceed with setup?', true);
  }

  async finalizeSetup() {
    console.log(c('dim', '\nCreating project structure...\n'));

    // Create .workflow structure
    await this.createWorkflowStructure();

    // Create CLI config
    await this.createCLIConfig();

    // Copy scripts
    await this.copyScripts();

    // Generate skills if stack was configured
    if (this.config.stackSelections) {
      await this.generateSkills();
    }

    // Save scan findings
    if (this.config.scanFindings) {
      await this.saveScanFindings();
    }
  }

  async createWorkflowStructure() {
    const workflowDir = path.join(this.projectRoot, '.workflow');

    // Create directories
    const dirs = ['state', 'changes/general', 'models', 'templates', 'agents', 'bridges', 'roadmap', 'specs', 'verifications'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(workflowDir, dir), { recursive: true });
    }

    // Create config.json - version read from package.json
    const configContent = {
      version: PACKAGE_VERSION,
      projectName: this.config.projectName,
      cli: this.config.cli,
      enforcement: {
        strictMode: this.config.strictMode,
        requireTasks: true,
        requireApproval: true
      },
      releaseChannel: 'stable'
    };
    fs.writeFileSync(path.join(workflowDir, 'config.json'), JSON.stringify(configContent, null, 2));

    // Create ready.json
    const readyContent = {
      lastUpdated: new Date().toISOString(),
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: []
    };
    fs.writeFileSync(path.join(workflowDir, 'state', 'ready.json'), JSON.stringify(readyContent, null, 2));

    // Create state files
    const stateFiles = [
      { name: 'request-log.md', content: '# Request Log\n\n---\n' },
      { name: 'decisions.md', content: '# Project Decisions\n\n---\n' },
      { name: 'app-map.md', content: '# Application Map\n\n---\n' },
      { name: 'progress.md', content: '# Progress Notes\n\n---\n' }
    ];

    for (const file of stateFiles) {
      const filePath = path.join(workflowDir, 'state', file.name);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, file.content);
      }
    }

    // Copy templates/agents/bridges from package
    const copyDirs = ['templates', 'agents', 'bridges'];
    for (const dir of copyDirs) {
      const src = path.join(PACKAGE_ROOT, '.workflow', dir);
      const dest = path.join(workflowDir, dir);
      if (fs.existsSync(src)) {
        copyDir(src, dest);
      }
    }

    console.log('  ' + c('green', '✓') + ' Created .workflow/ structure');
  }

  async createCLIConfig() {
    const cli = SUPPORTED_CLIS[this.config.cli];
    const cliDir = path.join(this.projectRoot, cli.dir);

    fs.mkdirSync(cliDir, { recursive: true });
    fs.mkdirSync(path.join(cliDir, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(cliDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(cliDir, 'rules'), { recursive: true });

    // Note: Currently only Claude CLI config is fully implemented
    // Gemini and OpenCode support are placeholders for future development
    if (this.config.cli === 'claude') {
      const claudeMd = `# Project Instructions

You are an AI development assistant using Wogi Flow methodology.

## Quick Start
\`\`\`bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
\`\`\`

## Commands
- \`/wogi-ready\` - Show tasks
- \`/wogi-start TASK-X\` - Start task
- \`/wogi-status\` - Overview

Generated by Wogi Flow v${PACKAGE_VERSION}
`;
      fs.writeFileSync(path.join(cliDir, 'CLAUDE.md'), claudeMd);
    } else {
      // For non-Claude CLIs, create a basic README
      const readmeMd = `# ${cli.name} Configuration

This directory contains configuration for ${cli.name}.

Note: Full ${cli.name} integration is coming soon.
For now, the .workflow/ directory contains the main configuration.

Generated by Wogi Flow v${PACKAGE_VERSION}
`;
      fs.writeFileSync(path.join(cliDir, 'README.md'), readmeMd);
    }

    console.log('  ' + c('green', '✓') + ` Created ${cli.dir}/ for ${cli.name}`);
  }

  async copyScripts() {
    const src = path.join(PACKAGE_ROOT, 'scripts');
    const dest = path.join(this.projectRoot, 'scripts');

    if (fs.existsSync(src)) {
      copyDir(src, dest);

      // Make flow executable
      const flowScript = path.join(dest, 'flow');
      if (fs.existsSync(flowScript)) {
        fs.chmodSync(flowScript, '755');
      }

      console.log('  ' + c('green', '✓') + ' Copied scripts/ directory');
    }
  }

  async generateSkills() {
    try {
      const generator = require('../scripts/flow-skill-generator');
      if (generator && typeof generator.generateSkills === 'function' && this.config.stackSelections) {
        await generator.generateSkills(this.config.stackSelections);
        console.log('  ' + c('green', '✓') + ' Generated framework skills');
      }
    } catch (err) {
      // Skill generation is optional - log in debug mode
      if (process.env.DEBUG) {
        console.error(`[DEBUG] Skill generation error: ${err.message}`);
      }
      console.log('  ' + c('dim', '○') + ' Skill generation skipped');
    }
  }

  async saveScanFindings() {
    // Write to specs/ directory (v1.0.4 - moved from state/)
    const specsDir = path.join(this.projectRoot, '.workflow', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    const stackPath = path.join(specsDir, 'stack.md');
    const findings = this.config.scanFindings;

    const content = `# Tech Stack

Auto-detected by Wogi Flow scanner.

## Core Technologies

| Category | Technology |
|----------|------------|
| Language | ${findings.language || 'Unknown'} |
| Framework | ${findings.framework || 'Unknown'} |
| Database | ${findings.database || 'None detected'} |
| Testing | ${findings.testFramework || 'None detected'} |
| Package Manager | ${findings.packageManager || 'npm'} |

## Statistics

- Source Files: ${findings.files}

---
Last updated: ${new Date().toISOString()}
`;

    fs.writeFileSync(stackPath, content);
    console.log('  ' + c('green', '✓') + ' Saved project analysis to specs/stack.md');
  }

}

/**
 * Run the unified wizard (entry point)
 */
async function runUnifiedWizard() {
  const wizard = new UnifiedWizard();
  return wizard.run();
}

module.exports = {
  UnifiedWizard,
  runUnifiedWizard
};

// Run if called directly
if (require.main === module) {
  runUnifiedWizard()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Wizard error:', err.message);
      process.exit(1);
    });
}
