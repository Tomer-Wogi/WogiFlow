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
      description: '',
      cli: 'claude',
      projectState: '',
      goals: [],
      documentation: [], // Array of {type, inputType, content, summary}
      planningDocs: [],  // Roadmap, issue tracker, etc.
      // Legacy fields for backward compatibility
      projectType: '',
      strictMode: true,
      stackSelections: null,
      scanFindings: null
    };
    this.projectRoot = process.cwd();
  }

  /**
   * Run the unified wizard
   * New flow: CLI first → basics → docs → state → goals → planning → summary → AI handoff
   */
  async run() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      // Step 1: Welcome
      this.printWelcome();

      // Step 2: CLI selection (FIRST)
      await this.askCLI();

      // Step 3: Project name
      await this.askProjectName();

      // Step 4: Description (short or documentation)
      await this.askDescription();

      // Step 5: Project state
      await this.askProjectState();

      // Step 6: Goals (multi-select)
      await this.askGoals();

      // Step 7: Planning documents
      await this.askPlanningDocs();

      // Step 8: Show summary and confirm
      const confirmed = await this.showSummary();
      if (!confirmed) {
        console.log(c('yellow', '\nSetup cancelled. Run `npx flow onboard` to try again.\n'));
        return null;
      }

      // Step 9: Create structure and handoff to AI
      await this.finalizeAndHandoff();

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

  /**
   * Ask with inline placeholder (gray text that disappears when typing)
   * Shows default value in dim/gray after the prompt, user can:
   * - Press Enter to accept the default
   * - Start typing to clear the default and enter custom value
   */
  askWithPlaceholder(question, defaultValue = '') {
    return new Promise((resolve) => {
      // Fallback to regular prompt if no default, no TTY, or readline not available
      if (!defaultValue || !process.stdin.isTTY || !process.stdin.setRawMode) {
        return this.ask(question, defaultValue).then(resolve);
      }

      const prompt = `${question}: `;
      const dim = '\x1b[2m';      // Dim/gray
      const reset = '\x1b[0m';    // Reset
      const clearLine = '\x1b[K'; // Clear to end of line

      // Print prompt with dim default
      process.stdout.write(prompt + dim + defaultValue + reset);

      // Move cursor back to start of default value
      process.stdout.write(`\x1b[${defaultValue.length}D`);

      let userInput = '';
      let usingDefault = true;

      // Pause readline to take over stdin
      this.rl.pause();
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKeypress);
        this.rl.resume();
      };

      const onKeypress = (key) => {
        const char = key.toString();

        // Enter key - accept current value
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(usingDefault ? defaultValue : userInput);
          return;
        }

        // Ctrl+C - exit
        if (char === '\x03') {
          cleanup();
          process.stdout.write('\n');
          process.exit();
        }

        // Backspace
        if (char === '\x7f' || char === '\b') {
          if (userInput.length > 0) {
            userInput = userInput.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }

        // First printable character typed - clear the dim default
        if (usingDefault && char.length === 1 && char >= ' ') {
          usingDefault = false;
          process.stdout.write(clearLine); // Clear the dim default text
        }

        // Regular printable character
        if (char.length === 1 && char >= ' ') {
          userInput += char;
          process.stdout.write(char);
        }
      };

      process.stdin.on('data', onKeypress);
    });
  }

  /**
   * Single-select with arrow key navigation
   * @param {string} question - The question to ask
   * @param {Array} options - Array of {key, label, description?} objects
   * @param {string} defaultKey - Default selected key
   * @returns {Promise<string>} Selected key
   */
  askSingleSelect(question, options, defaultKey = null) {
    return new Promise((resolve) => {
      // Fallback if no TTY
      if (!process.stdin.isTTY || !process.stdin.setRawMode) {
        console.log(`\n${question}\n`);
        options.forEach((opt, i) => {
          const marker = opt.key === defaultKey ? '>' : ' ';
          console.log(`  ${marker} (${i + 1}) ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`);
        });
        return this.ask('Your choice (number)', '1').then(answer => {
          const num = parseInt(answer, 10);
          if (num >= 1 && num <= options.length) {
            resolve(options[num - 1].key);
          } else {
            resolve(defaultKey || options[0].key);
          }
        });
      }

      let selectedIndex = defaultKey ? options.findIndex(o => o.key === defaultKey) : 0;
      if (selectedIndex < 0) selectedIndex = 0;

      const render = () => {
        // Move cursor up to redraw (except first render)
        process.stdout.write(`\x1b[${options.length}A\x1b[J`);
        options.forEach((opt, i) => {
          const selected = i === selectedIndex;
          const marker = selected ? c('cyan', '❯') : ' ';
          const radio = selected ? c('green', '●') : '○';
          const label = selected ? c('bold', opt.label) : opt.label;
          const desc = opt.description ? c('dim', ` - ${opt.description}`) : '';
          console.log(`  ${marker} ${radio} ${label}${desc}`);
        });
        process.stdout.write(c('dim', '\n  [↑↓ to move, Enter to select]'));
      };

      console.log(`\n${question}\n`);
      // Initial render (print blank lines first)
      options.forEach(() => console.log(''));
      console.log('');
      render();

      this.rl.pause();
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        this.rl.resume();
      };

      const onKey = (key) => {
        const seq = key.toString();

        // Arrow up
        if (seq === '\x1b[A' || seq === 'k') {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          render();
          return;
        }

        // Arrow down
        if (seq === '\x1b[B' || seq === 'j') {
          selectedIndex = (selectedIndex + 1) % options.length;
          render();
          return;
        }

        // Enter
        if (seq === '\r' || seq === '\n') {
          cleanup();
          process.stdout.write('\x1b[K\n'); // Clear hint line
          resolve(options[selectedIndex].key);
          return;
        }

        // Ctrl+C
        if (seq === '\x03') {
          cleanup();
          process.stdout.write('\n');
          process.exit();
        }
      };

      process.stdin.on('data', onKey);
    });
  }

  /**
   * Multi-select with checkbox toggle (space to toggle, enter to confirm)
   * @param {string} question - The question to ask
   * @param {Array} options - Array of {key, label, description?, default?} objects
   * @returns {Promise<string[]>} Array of selected keys
   */
  askMultiSelect(question, options) {
    return new Promise((resolve) => {
      // Fallback if no TTY
      if (!process.stdin.isTTY || !process.stdin.setRawMode) {
        console.log(`\n${question}\n`);
        options.forEach((opt, i) => {
          const checked = opt.default ? '[x]' : '[ ]';
          console.log(`  ${checked} (${i + 1}) ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`);
        });
        return this.ask('Select (comma-separated numbers)', '').then(answer => {
          if (!answer) {
            resolve(options.filter(o => o.default).map(o => o.key));
            return;
          }
          const nums = answer.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
          resolve(nums.filter(n => n >= 1 && n <= options.length).map(n => options[n - 1].key));
        });
      }

      let cursorIndex = 0;
      const selected = new Set(options.filter(o => o.default).map(o => o.key));

      const render = () => {
        // Move cursor up to redraw
        process.stdout.write(`\x1b[${options.length}A\x1b[J`);
        options.forEach((opt, i) => {
          const isCursor = i === cursorIndex;
          const isSelected = selected.has(opt.key);
          const cursor = isCursor ? c('cyan', '❯') : ' ';
          const checkbox = isSelected ? c('green', '☑') : '☐';
          const label = isCursor ? c('bold', opt.label) : opt.label;
          const desc = opt.description ? c('dim', ` - ${opt.description}`) : '';
          console.log(`  ${cursor} ${checkbox} ${label}${desc}`);
        });
        process.stdout.write(c('dim', '\n  [↑↓ move, Space toggle, Enter done]'));
      };

      console.log(`\n${question}\n`);
      // Initial render
      options.forEach(() => console.log(''));
      console.log('');
      render();

      this.rl.pause();
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        this.rl.resume();
      };

      const onKey = (key) => {
        const seq = key.toString();

        // Arrow up
        if (seq === '\x1b[A' || seq === 'k') {
          cursorIndex = (cursorIndex - 1 + options.length) % options.length;
          render();
          return;
        }

        // Arrow down
        if (seq === '\x1b[B' || seq === 'j') {
          cursorIndex = (cursorIndex + 1) % options.length;
          render();
          return;
        }

        // Space - toggle
        if (seq === ' ') {
          const key = options[cursorIndex].key;
          if (selected.has(key)) {
            selected.delete(key);
          } else {
            selected.add(key);
          }
          render();
          return;
        }

        // Enter - confirm
        if (seq === '\r' || seq === '\n') {
          cleanup();
          process.stdout.write('\x1b[K\n');
          resolve(Array.from(selected));
          return;
        }

        // Ctrl+C
        if (seq === '\x03') {
          cleanup();
          process.stdout.write('\n');
          process.exit();
        }
      };

      process.stdin.on('data', onKey);
    });
  }

  /**
   * Ask for document input - either paste content or link to file
   * @param {string} docType - Name of the document type (e.g., "PRD", "README")
   * @returns {Promise<{type: 'paste'|'link', content: string, summary: string}>}
   */
  async askDocumentInput(docType) {
    // First ask: paste or link?
    const inputType = await this.askSingleSelect(
      `How do you want to provide the ${docType}?`,
      [
        { key: 'paste', label: 'Paste content', description: 'Paste the document content directly' },
        { key: 'link', label: 'Link to file', description: 'Provide a file path' }
      ],
      'paste'
    );

    if (inputType === 'link') {
      const filePath = await this.ask(`File path for ${docType}`);
      if (!filePath) {
        return { type: 'link', content: '', summary: '[no file provided]' };
      }

      // Validate file exists
      const resolvedPath = path.resolve(this.projectRoot, filePath);
      if (!isPathWithinProject(resolvedPath, this.projectRoot)) {
        console.log(c('yellow', '  Path must be within project directory'));
        return { type: 'link', content: '', summary: '[invalid path]' };
      }

      try {
        fs.accessSync(resolvedPath, fs.constants.R_OK);
        return { type: 'link', content: resolvedPath, summary: `[linked - ${filePath}]` };
      } catch {
        console.log(c('yellow', '  File not found or not readable'));
        return { type: 'link', content: '', summary: '[file not found]' };
      }
    }

    // Paste mode - multi-line input
    console.log(c('dim', `\nPaste ${docType} content (press Enter twice on empty line when done):\n`));

    return new Promise((resolve) => {
      const lines = [];
      let emptyLineCount = 0;

      const lineHandler = (line) => {
        if (line === '') {
          emptyLineCount++;
          if (emptyLineCount >= 2) {
            this.rl.removeListener('line', lineHandler);
            const content = lines.join('\n');
            const lineCount = lines.length;
            const summary = `[pasted - ${lineCount} line${lineCount !== 1 ? 's' : ''}]`;
            console.log(c('green', `  ${summary}\n`));
            resolve({ type: 'paste', content, summary });
            return;
          }
        } else {
          emptyLineCount = 0;
        }
        lines.push(line);
      };

      this.rl.on('line', lineHandler);
    });
  }

  // ============================================
  // STEP IMPLEMENTATIONS (New Flow)
  // ============================================

  /**
   * Step 2: Ask CLI selection (FIRST question)
   */
  async askCLI() {
    const cliOptions = Object.entries(SUPPORTED_CLIS).map(([key, value]) => ({
      key,
      label: value.name,
      description: value.description
    }));

    this.config.cli = await this.askSingleSelect(
      'Which AI CLI are you using?',
      cliOptions,
      'claude'
    );
  }

  /**
   * Step 3: Ask project name
   */
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

    this.config.projectName = await this.askWithPlaceholder('Project name', detectedName);
  }

  /**
   * Step 4: Ask for description (short or documentation)
   */
  async askDescription() {
    const hasDocsChoice = await this.askSingleSelect(
      'How would you like to describe your project?',
      [
        { key: 'short', label: 'Short description', description: '1-2 sentences' },
        { key: 'docs', label: 'I have documentation', description: 'PRD, README, specs, etc.' }
      ],
      'short'
    );

    if (hasDocsChoice === 'short') {
      this.config.description = await this.ask('What does this project do? (1-2 sentences)');
      return;
    }

    // Documentation flow
    const docTypes = await this.askMultiSelect(
      'What documentation do you have?',
      [
        { key: 'prd', label: 'PRD / Product Spec' },
        { key: 'readme', label: 'README' },
        { key: 'architecture', label: 'Architecture docs' },
        { key: 'api', label: 'API documentation' },
        { key: 'other', label: 'Other' }
      ]
    );

    if (docTypes.length === 0) {
      // Fallback to short description
      this.config.description = await this.ask('What does this project do? (1-2 sentences)');
      return;
    }

    // For each selected doc type, get input
    const docTypeNames = {
      prd: 'PRD / Product Spec',
      readme: 'README',
      architecture: 'Architecture docs',
      api: 'API documentation',
      other: 'Other documentation'
    };

    for (const docType of docTypes) {
      const docName = docTypeNames[docType] || docType;
      const input = await this.askDocumentInput(docName);
      this.config.documentation.push({
        type: docType,
        name: docName,
        inputType: input.type,
        content: input.content,
        summary: input.summary
      });
    }
  }

  /**
   * Step 5: Ask project state
   */
  async askProjectState() {
    this.config.projectState = await this.askSingleSelect(
      "What's your project's current state?",
      [
        { key: 'new', label: 'New / early development', description: 'Just starting out' },
        { key: 'mvp', label: 'MVP / working prototype', description: 'Core features working' },
        { key: 'production', label: 'Production with users', description: 'Live and serving users' },
        { key: 'maintenance', label: 'Maintenance mode', description: 'Stable, minimal changes' }
      ],
      'mvp'
    );
  }

  /**
   * Step 6: Ask goals (multi-select)
   */
  async askGoals() {
    this.config.goals = await this.askMultiSelect(
      'What are you trying to accomplish with AI assistance?',
      [
        { key: 'features', label: 'Add new features', default: true },
        { key: 'bugs', label: 'Fix bugs', default: true },
        { key: 'refactor', label: 'Refactor / improve code quality' },
        { key: 'tests', label: 'Add tests' },
        { key: 'docs', label: 'Documentation' },
        { key: 'performance', label: 'Performance optimization' },
        { key: 'security', label: 'Security improvements' }
      ]
    );
  }

  /**
   * Step 7: Ask about planning documents
   */
  async askPlanningDocs() {
    const planningTypes = await this.askMultiSelect(
      'Do you have any existing planning documents the AI should analyze?',
      [
        { key: 'roadmap', label: 'Roadmap / backlog' },
        { key: 'issues', label: 'Issue tracker export' },
        { key: 'techdebt', label: 'Technical debt notes' },
        { key: 'none', label: 'None of these', default: true }
      ]
    );

    // Filter out 'none' and store
    this.config.planningDocs = planningTypes.filter(t => t !== 'none');

    if (this.config.planningDocs.length > 0) {
      console.log(c('dim', '\n  These will be analyzed when the AI scans your project.\n'));
    }
  }

  /**
   * Step 8: Show summary
   */
  async showSummary() {
    const cli = SUPPORTED_CLIS[this.config.cli];

    console.log('\n' + c('cyan', '═'.repeat(60)));
    console.log(c('cyan', '  Setup Summary'));
    console.log(c('cyan', '═'.repeat(60)) + '\n');

    console.log(`  Project: ${c('bold', this.config.projectName)}`);
    console.log(`  CLI: ${c('bold', cli.name)}`);
    console.log(`  State: ${c('bold', this.config.projectState || 'Not specified')}`);

    if (this.config.goals.length > 0) {
      console.log(`  Goals: ${c('bold', this.config.goals.join(', '))}`);
    }

    if (this.config.documentation.length > 0) {
      console.log(`  Documentation: ${c('bold', this.config.documentation.length + ' file(s)')}`);
      this.config.documentation.forEach(doc => {
        console.log(`    - ${doc.name}: ${c('dim', doc.summary)}`);
      });
    } else if (this.config.description) {
      console.log(`  Description: ${c('dim', this.config.description.substring(0, 50) + (this.config.description.length > 50 ? '...' : ''))}`);
    }

    console.log('\n' + c('bold', 'Ready to let the AI analyze your project?'));
    console.log(c('dim', 'This will create the workflow structure and prepare for AI analysis.\n'));

    return await this.askYesNo('Proceed?', true);
  }

  /**
   * Step 9: Finalize and handoff to AI
   */
  async finalizeAndHandoff() {
    console.log(c('dim', '\nCreating project structure...\n'));

    // Create minimal structure
    await this.createWorkflowStructure();
    await this.createCLIConfig();

    // Save onboarding data for AI to read
    await this.saveOnboardingData();

    // Determine if running inside AI session
    const inSession = this.detectAISession();

    if (inSession) {
      // Already in AI session - output trigger for AI to continue
      this.printAITrigger();
    } else {
      // Not in session - show instructions
      this.printHandoffInstructions();
    }
  }

  /**
   * Detect if running inside an AI CLI session
   */
  detectAISession() {
    // Check for common environment indicators
    return !!(
      process.env.CLAUDE_CODE ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GEMINI_CLI ||
      process.env.OPENCODE_SESSION ||
      // Check if parent process looks like an AI CLI
      (process.env._ && (
        process.env._.includes('claude') ||
        process.env._.includes('gemini') ||
        process.env._.includes('opencode')
      ))
    );
  }

  /**
   * Print trigger for AI to continue (when in session)
   */
  printAITrigger() {
    console.log('\n' + c('green', '═'.repeat(60)));
    console.log(c('green', '  ✅ Structure created!'));
    console.log(c('green', '═'.repeat(60)) + '\n');

    console.log('The AI can now analyze your project.\n');
    console.log(c('yellow', 'AI: Please run /wogi-onboard to complete the setup by:'));
    console.log('  • Scanning the codebase for patterns and structure');
    console.log('  • Detecting frameworks, testing, and coding styles');
    console.log('  • Generating component map and architecture docs');
    console.log('  • Creating coding rules based on detected patterns\n');
  }

  /**
   * Print handoff instructions (when not in session)
   */
  printHandoffInstructions() {
    const cli = SUPPORTED_CLIS[this.config.cli];
    const cliCommand = this.config.cli; // 'claude', 'gemini', 'opencode'

    console.log('\n' + c('cyan', '╔════════════════════════════════════════════════════════════╗'));
    console.log(c('cyan', '║') + '  ' + c('bold', 'Almost done! Start your AI CLI to complete setup.') + '         ' + c('cyan', '║'));
    console.log(c('cyan', '╚════════════════════════════════════════════════════════════╝') + '\n');

    console.log(`  Run: ${c('yellow', cliCommand)}\n`);

    console.log('  The AI will:');
    console.log('    • Scan your codebase for patterns');
    console.log('    • Detect frameworks and coding styles');
    console.log('    • Generate component map and architecture docs');
    console.log('    • Ask clarifying questions if needed\n');
  }

  /**
   * Save onboarding data for AI to read
   */
  async saveOnboardingData() {
    const onboardingData = {
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString(),
      projectName: this.config.projectName,
      description: this.config.description,
      cli: this.config.cli,
      projectState: this.config.projectState,
      goals: this.config.goals,
      documentation: this.config.documentation,
      planningDocs: this.config.planningDocs,
      status: 'pending_ai_analysis'
    };

    const onboardingPath = path.join(this.projectRoot, '.workflow', 'state', 'onboarding.json');
    fs.writeFileSync(onboardingPath, JSON.stringify(onboardingData, null, 2));
    console.log('  ' + c('green', '✓') + ' Saved onboarding data for AI analysis');
  }

  // ============================================
  // LEGACY METHODS (kept for backward compatibility)
  // ============================================

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
