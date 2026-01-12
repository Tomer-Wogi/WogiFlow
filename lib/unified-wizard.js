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

// Package root
const PACKAGE_ROOT = path.resolve(__dirname, '..');

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
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.name) {
          detectedName = pkg.name;
        }
      } catch {
        // Ignore parse errors
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

    if (!importPath || !fs.existsSync(importPath)) {
      console.log(c('yellow', '  Path not found. Continuing with fresh setup.\n'));
      return false;
    }

    try {
      await this.importConfig(importPath);
      console.log(c('green', '  ✓ Configuration imported successfully!\n'));
      return true;
    } catch (err) {
      console.log(c('yellow', `  Import failed: ${err.message}. Continuing with fresh setup.\n`));
      return false;
    }
  }

  async importConfig(importPath) {
    // Check if it's a directory or file
    const stat = fs.statSync(importPath);

    if (stat.isDirectory()) {
      // Import from .workflow directory
      const configPath = path.join(importPath, 'config.json');
      if (fs.existsSync(configPath)) {
        const imported = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.config = { ...this.config, ...imported };
      }

      // Copy state files
      const statePath = path.join(importPath, 'state');
      if (fs.existsSync(statePath)) {
        const targetState = path.join(this.projectRoot, '.workflow', 'state');
        fs.mkdirSync(targetState, { recursive: true });
        // Copy decisions.md, stack.md, etc.
        const filesToCopy = ['decisions.md', 'stack.md', 'architecture.md'];
        for (const file of filesToCopy) {
          const src = path.join(statePath, file);
          const dest = path.join(targetState, file);
          if (fs.existsSync(src) && !fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
          }
        }
      }
    } else {
      // Import from export file (JSON)
      const exported = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
      this.config = { ...this.config, ...exported.config };
    }
  }

  async runStackWizard() {
    console.log(c('cyan', '\n━━━ Tech Stack Configuration ━━━\n'));

    try {
      // Try to load the enhanced stack wizard
      const { EnhancedStackWizard } = require('../scripts/flow-stack-wizard');
      const wizard = new EnhancedStackWizard();

      // Transfer readline to stack wizard
      wizard.rl = this.rl;

      // Run the wizard (it will use our readline)
      this.config.stackSelections = await wizard.run();

    } catch (err) {
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

    // Detect language
    if (fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'));

      // Check for TypeScript
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        findings.language = 'TypeScript';
      } else {
        findings.language = 'JavaScript';
      }

      // Detect framework
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
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

      findings.packageManager = fs.existsSync(path.join(this.projectRoot, 'yarn.lock')) ? 'Yarn' :
                                fs.existsSync(path.join(this.projectRoot, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
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
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java'];

    const walk = (dir, depth = 0) => {
      if (depth > 5) return; // Limit depth
      if (!fs.existsSync(dir)) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            count++;
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    walk(this.projectRoot);
    return count;
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

    // Create config.json
    const configContent = {
      version: '2.0.0',
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
        this.copyDirRecursive(src, dest);
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

Generated by Wogi Flow v2.0.0
`;
      fs.writeFileSync(path.join(cliDir, 'CLAUDE.md'), claudeMd);
    }

    console.log('  ' + c('green', '✓') + ` Created ${cli.dir}/ for ${cli.name}`);
  }

  async copyScripts() {
    const src = path.join(PACKAGE_ROOT, 'scripts');
    const dest = path.join(this.projectRoot, 'scripts');

    if (fs.existsSync(src)) {
      this.copyDirRecursive(src, dest);

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
      if (generator && generator.generateSkills && this.config.stackSelections) {
        await generator.generateSkills(this.config.stackSelections);
        console.log('  ' + c('green', '✓') + ' Generated framework skills');
      }
    } catch {
      // Skill generation is optional
      console.log('  ' + c('dim', '○') + ' Skill generation skipped');
    }
  }

  async saveScanFindings() {
    const stackPath = path.join(this.projectRoot, '.workflow', 'state', 'stack.md');
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
    console.log('  ' + c('green', '✓') + ' Saved project analysis');
  }

  copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
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
