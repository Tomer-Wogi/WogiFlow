#!/usr/bin/env node

/**
 * Enhanced Tech Stack Wizard for Wogi Flow v2.0
 * Interactive questionnaire with summary UI, drill-down customization,
 * and "Let AI decide" option for intelligent defaults
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');

// Import centralized tech options
const {
  PLATFORM_TYPES,
  FOCUS_AREAS,
  FRONTEND_FRAMEWORKS,
  BACKEND_FRAMEWORKS,
  MOBILE_FRAMEWORKS,
  STATE_MANAGEMENT,
  FORM_LIBRARIES,
  STYLING_OPTIONS,
  DATA_FETCHING,
  ANIMATION_LIBRARIES,
  VALIDATION_LIBRARIES,
  DATABASE_OPTIONS,
  ORM_OPTIONS,
  AUTH_OPTIONS,
  TESTING_OPTIONS,
  ADDITIONAL_TOOLS,
  MOBILE_TOOLS,
  ECOSYSTEMS,
  BEST_DEFAULTS,
  getOptionsForFramework,
  getEcosystemDefaults,
  collectTechnologiesFromSelections
} = require('./flow-tech-options');

// ============================================
// COLORS & FORMATTING
// ============================================

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// ============================================
// WIZARD CLASS
// ============================================

class EnhancedStackWizard {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.selections = {};
    this.detectedFramework = process.env.DETECTED_FRAMEWORK || null;
  }

  async run() {
    this.printHeader();

    try {
      // Phase 1: Platform & Focus
      await this.askPlatformAndFocus();

      // Phase 2: Core Frameworks
      await this.askCoreFrameworks();

      // Phase 3: Show Summary with Defaults & Allow Customization
      await this.showSummaryAndCustomize();

      // Phase 4: Testing & Tools
      await this.askTestingAndTools();

      // Phase 4.5: Workflow Steps (v2.2)
      await this.askWorkflowSteps();

      // Phase 5: Final Summary & Generation
      await this.finalizeAndGenerate();

    } finally {
      this.rl.close();
    }

    return this.selections;
  }

  printHeader() {
    console.log('\n' + c('cyan', '='.repeat(60)));
    console.log(c('cyan', '  Enhanced Tech Stack Wizard'));
    console.log(c('cyan', '  Configure your project and generate framework-specific skills'));
    console.log(c('cyan', '='.repeat(60)) + '\n');

    if (this.detectedFramework) {
      console.log(c('green', `  Detected framework: ${this.detectedFramework}`));
      console.log(c('dim', '  Recommendations will be based on this detection.\n'));
    }
  }

  // ============================================
  // PHASE 1: Platform & Focus
  // ============================================

  async askPlatformAndFocus() {
    // Platform type
    console.log(c('bold', 'Step 1: Platform Type\n'));
    this.selections.projectType = await this.askSingleChoice(
      'What platform are you building for?',
      PLATFORM_TYPES,
      this.detectedFramework ? this.inferProjectType() : null
    );

    // Focus area (conditional)
    if (this.needsFocusQuestion()) {
      console.log(c('bold', '\nStep 2: Focus Area\n'));
      this.selections.focus = await this.askSingleChoice(
        "What's your focus?",
        FOCUS_AREAS,
        this.inferFocus()
      );
    } else {
      this.selections.focus = this.inferFocus();
    }
  }

  needsFocusQuestion() {
    const type = this.selections.projectType;
    return ['web', 'fullstack', 'other'].includes(type);
  }

  inferProjectType() {
    if (!this.detectedFramework) return null;
    const mobileFrameworks = ['react-native', 'expo', 'flutter'];
    const backendFrameworks = ['nestjs', 'express', 'fastify', 'fastapi', 'django', 'flask'];

    if (mobileFrameworks.includes(this.detectedFramework)) return 'mobile';
    if (backendFrameworks.includes(this.detectedFramework)) return 'backend';
    return 'fullstack';
  }

  inferFocus() {
    const type = this.selections.projectType;
    if (['backend', 'cli', 'library'].includes(type)) return 'backend';
    if (['mobile', 'desktop'].includes(type)) return 'frontend';
    return 'both';
  }

  // ============================================
  // PHASE 2: Core Frameworks
  // ============================================

  async askCoreFrameworks() {
    // Frontend framework
    if (this.needsFrontend()) {
      console.log(c('bold', '\nStep 3: Frontend Framework\n'));

      const frameworkOptions = this.selections.projectType === 'mobile'
        ? MOBILE_FRAMEWORKS
        : FRONTEND_FRAMEWORKS;

      const defaultFramework = this.detectedFramework || (
        this.selections.projectType === 'mobile' ? 'expo' : 'nextjs'
      );

      this.selections.frontend = await this.askGroupedChoice(
        'Select your frontend framework:',
        frameworkOptions,
        defaultFramework
      );
    }

    // Backend framework
    if (this.needsBackend()) {
      console.log(c('bold', '\nStep 4: Backend Framework\n'));

      const defaultBackend = this.detectedFramework &&
        BACKEND_FRAMEWORKS.some(f => f.value === this.detectedFramework)
        ? this.detectedFramework
        : 'nestjs';

      this.selections.backend = await this.askGroupedChoice(
        'Select your backend framework:',
        BACKEND_FRAMEWORKS,
        defaultBackend
      );
    }
  }

  needsFrontend() {
    return ['frontend', 'both'].includes(this.selections.focus);
  }

  needsBackend() {
    return ['backend', 'both'].includes(this.selections.focus);
  }

  // ============================================
  // PHASE 3: Summary with Defaults + Customization
  // ============================================

  async showSummaryAndCustomize() {
    // Apply intelligent defaults based on selected frameworks
    this.applyEcosystemDefaults();

    // Show summary with all defaults
    let continueCustomizing = true;

    while (continueCustomizing) {
      this.printConfigurationSummary();

      const choice = await this.askSummaryAction();

      switch (choice) {
        case '1':
          await this.customizeFrontendStack();
          break;
        case '2':
          await this.customizeBackendStack();
          break;
        case '3':
          await this.customizeTestingStack();
          break;
        case '4':
          // Accept all recommendations
          continueCustomizing = false;
          break;
        case '5':
          // Let AI decide
          this.applyAIDefaults();
          continueCustomizing = false;
          break;
        default:
          continueCustomizing = false;
      }
    }
  }

  applyEcosystemDefaults() {
    // Frontend ecosystem defaults
    if (this.selections.frontend) {
      const ecosystem = getEcosystemDefaults(this.selections.frontend);
      if (ecosystem && ecosystem.defaults) {
        if (!this.selections.stateManagement) {
          this.selections.stateManagement = ecosystem.defaults.stateManagement;
        }
        if (!this.selections.forms) {
          this.selections.forms = ecosystem.defaults.forms;
        }
        if (!this.selections.styling) {
          this.selections.styling = ecosystem.defaults.styling;
        }
        if (!this.selections.dataFetching) {
          this.selections.dataFetching = ecosystem.defaults.dataFetching;
        }
        if (!this.selections.validation) {
          this.selections.validation = ecosystem.defaults.validation;
        }
      }
    }

    // Backend ecosystem defaults
    if (this.selections.backend) {
      const ecosystem = getEcosystemDefaults(this.selections.backend);
      if (ecosystem && ecosystem.defaults) {
        if (!this.selections.orm) {
          this.selections.orm = ecosystem.defaults.orm;
        }
        if (!this.selections.database) {
          this.selections.database = ecosystem.defaults.database;
        }
        if (!this.selections.auth) {
          this.selections.auth = ecosystem.defaults.auth;
        }
        if (!this.selections.validation && ecosystem.defaults.validation) {
          this.selections.validation = ecosystem.defaults.validation;
        }
      }
    }

    // Testing defaults
    if (!this.selections.testing) {
      this.selections.testing = 'vitest';
    }
    if (!this.selections.e2e) {
      this.selections.e2e = 'playwright';
    }
  }

  applyAIDefaults() {
    console.log(c('cyan', '\n  Applying AI-recommended defaults...\n'));

    // Use best defaults for everything
    Object.assign(this.selections, {
      stateManagement: BEST_DEFAULTS.stateManagement,
      forms: BEST_DEFAULTS.forms,
      styling: BEST_DEFAULTS.styling,
      dataFetching: BEST_DEFAULTS.dataFetching,
      animation: BEST_DEFAULTS.animation,
      validation: BEST_DEFAULTS.validation,
      orm: BEST_DEFAULTS.orm,
      database: BEST_DEFAULTS.database,
      auth: BEST_DEFAULTS.auth,
      testing: BEST_DEFAULTS.testing,
      e2e: BEST_DEFAULTS.e2e
    });

    // Mark as AI-configured
    this.selections.aiConfigured = true;
  }

  printConfigurationSummary() {
    console.log('\n' + c('bold', '━━━ Your Tech Stack Configuration ━━━') + '\n');

    // Frontend section
    if (this.selections.frontend && this.selections.frontend !== 'none') {
      const frontendLabel = this.getLabel(FRONTEND_FRAMEWORKS, this.selections.frontend) ||
                           this.getLabel(MOBILE_FRAMEWORKS, this.selections.frontend);
      console.log(`Frontend: ${c('green', frontendLabel)}`);

      if (this.selections.stateManagement) {
        console.log(`├── ${this.formatSelection('State Management', this.selections.stateManagement, STATE_MANAGEMENT)}`);
      }
      if (this.selections.forms) {
        console.log(`├── ${this.formatSelection('Forms', this.selections.forms, FORM_LIBRARIES)}`);
      }
      if (this.selections.styling) {
        console.log(`├── ${this.formatSelection('Styling', this.selections.styling, STYLING_OPTIONS)}`);
      }
      if (this.selections.dataFetching) {
        console.log(`├── ${this.formatSelection('Data Fetching', this.selections.dataFetching, DATA_FETCHING)}`);
      }
      if (this.selections.animation) {
        console.log(`└── ${this.formatSelection('Animation', this.selections.animation, ANIMATION_LIBRARIES)}`);
      } else {
        console.log(`└── [ ] Animation: (none selected)`);
      }
      console.log();
    }

    // Backend section
    if (this.selections.backend && this.selections.backend !== 'none') {
      const backendLabel = this.getLabel(BACKEND_FRAMEWORKS, this.selections.backend);
      console.log(`Backend: ${c('green', backendLabel)}`);

      if (this.selections.orm) {
        console.log(`├── ${this.formatSelection('ORM', this.selections.orm, ORM_OPTIONS)}`);
      }
      if (this.selections.database) {
        console.log(`├── ${this.formatSelection('Database', this.selections.database, DATABASE_OPTIONS)}`);
      }
      if (this.selections.auth) {
        console.log(`├── ${this.formatSelection('Auth', this.selections.auth, AUTH_OPTIONS)}`);
      }
      if (this.selections.validation) {
        console.log(`└── ${this.formatSelection('Validation', this.selections.validation, VALIDATION_LIBRARIES)}`);
      }
      console.log();
    }

    // Testing section
    console.log('Testing:');
    if (this.selections.testing) {
      console.log(`├── ${this.formatSelection('Unit', this.selections.testing, TESTING_OPTIONS)}`);
    }
    if (this.selections.e2e) {
      console.log(`└── ${this.formatSelection('E2E', this.selections.e2e, TESTING_OPTIONS)}`);
    }

    console.log('\n' + c('bold', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n');
  }

  formatSelection(label, value, options) {
    const opt = options.find(o => o.value === value);
    const displayLabel = opt ? opt.label : value;
    const isRecommended = opt && opt.recommended;
    return `[${c('green', '✓')}] ${label}: ${displayLabel}${isRecommended ? c('dim', ' (Recommended)') : ''}`;
  }

  getLabel(options, value) {
    const opt = options.find(o => o.value === value);
    return opt ? opt.label : value;
  }

  async askSummaryAction() {
    console.log('Options:');
    if (this.selections.frontend && this.selections.frontend !== 'none') {
      console.log('  (1) Customize Frontend stack');
    }
    if (this.selections.backend && this.selections.backend !== 'none') {
      console.log('  (2) Customize Backend stack');
    }
    console.log('  (3) Customize Testing stack');
    console.log('  (4) Accept all recommendations');
    console.log('  (5) Let AI decide best options for my project');
    console.log();

    return await this.askQuestion('Your choice [4]: ') || '4';
  }

  // ============================================
  // CUSTOMIZATION FUNCTIONS
  // ============================================

  async customizeFrontendStack() {
    console.log(c('bold', '\n  Customizing Frontend Stack\n'));

    // State management
    const stateOptions = getOptionsForFramework(STATE_MANAGEMENT, this.selections.frontend);
    if (stateOptions.length > 0) {
      this.selections.stateManagement = await this.askSingleChoice(
        'State management:',
        stateOptions,
        this.selections.stateManagement
      );
    }

    // Forms
    const formOptions = getOptionsForFramework(FORM_LIBRARIES, this.selections.frontend);
    if (formOptions.length > 0) {
      this.selections.forms = await this.askSingleChoice(
        'Form handling:',
        formOptions,
        this.selections.forms
      );
    }

    // Styling
    const styleOptions = getOptionsForFramework(STYLING_OPTIONS, this.selections.frontend);
    this.selections.styling = await this.askSingleChoice(
      'Styling approach:',
      styleOptions,
      this.selections.styling
    );

    // Data fetching
    const dataOptions = getOptionsForFramework(DATA_FETCHING, this.selections.frontend);
    if (dataOptions.length > 0) {
      this.selections.dataFetching = await this.askSingleChoice(
        'Data fetching:',
        dataOptions,
        this.selections.dataFetching
      );
    }

    // Animation (optional)
    const animOptions = getOptionsForFramework(ANIMATION_LIBRARIES, this.selections.frontend);
    if (animOptions.length > 0) {
      this.selections.animation = await this.askSingleChoice(
        'Animation (optional):',
        animOptions,
        this.selections.animation
      );
    }
  }

  async customizeBackendStack() {
    console.log(c('bold', '\n  Customizing Backend Stack\n'));

    // Database
    this.selections.database = await this.askGroupedChoice(
      'Database:',
      DATABASE_OPTIONS,
      this.selections.database
    );

    // ORM
    const ormOptions = getOptionsForFramework(ORM_OPTIONS, this.selections.backend);
    if (ormOptions.length > 0) {
      this.selections.orm = await this.askSingleChoice(
        'ORM / Database client:',
        ormOptions,
        this.selections.orm
      );
    }

    // Auth
    const authOptions = getOptionsForFramework(AUTH_OPTIONS, this.selections.backend);
    if (authOptions.length > 0) {
      this.selections.auth = await this.askSingleChoice(
        'Authentication:',
        authOptions,
        this.selections.auth
      );
    }

    // Validation
    const validOptions = getOptionsForFramework(VALIDATION_LIBRARIES, this.selections.backend);
    if (validOptions.length > 0) {
      this.selections.validation = await this.askSingleChoice(
        'Validation:',
        validOptions,
        this.selections.validation
      );
    }
  }

  async customizeTestingStack() {
    console.log(c('bold', '\n  Customizing Testing Stack\n'));

    // Unit testing
    const unitOptions = TESTING_OPTIONS.filter(o => o.group === 'Unit' || o.group === null);
    this.selections.testing = await this.askSingleChoice(
      'Unit testing framework:',
      unitOptions,
      this.selections.testing
    );

    // E2E testing
    const e2eOptions = TESTING_OPTIONS.filter(o => o.group === 'E2E' || o.group === null);
    this.selections.e2e = await this.askSingleChoice(
      'E2E testing framework:',
      e2eOptions,
      this.selections.e2e
    );
  }

  // ============================================
  // PHASE 4: Testing & Additional Tools
  // ============================================

  async askTestingAndTools() {
    // Additional tools (multi-select)
    console.log(c('bold', '\nAdditional Tools (optional)\n'));
    console.log('Select additional tools (comma-separated numbers or "none"):');

    for (const opt of ADDITIONAL_TOOLS) {
      console.log(`  (${opt.key}) ${opt.label}`);
    }

    const answer = await this.askQuestion('\nYour choices [none]: ') || 'none';

    if (answer.toLowerCase() !== 'none' && answer !== '') {
      const keys = answer.split(',').map(k => k.trim());
      this.selections.additionalTools = keys
        .map(k => ADDITIONAL_TOOLS.find(o => o.key === k))
        .filter(Boolean)
        .map(o => o.value);
    } else {
      this.selections.additionalTools = [];
    }
  }

  // ============================================
  // PHASE 4.5: Workflow Steps (v2.2)
  // ============================================

  async askWorkflowSteps() {
    console.log(c('bold', '\n━━━ Workflow Steps Configuration ━━━'));
    console.log(c('dim', 'These steps run automatically during task execution.\n'));

    // Define available workflow steps with descriptions
    const workflowSteps = [
      // Testing
      { key: '1', name: 'regressionTest', label: 'Regression Test', desc: 'Test random completed tasks', default: true, mode: 'warn', when: 'afterTask', category: 'testing' },
      { key: '2', name: 'browserTest', label: 'Browser Test', desc: 'Suggest browser tests for UI changes', default: true, mode: 'prompt', when: 'afterTask', category: 'testing' },
      { key: '3', name: 'prTestAnalyzer', label: 'PR Test Analyzer', desc: 'Check coverage + quality for modified files', default: true, mode: 'warn', when: 'beforeCommit', category: 'testing' },

      // Quality
      { key: '4', name: 'securityScan', label: 'Security Scan', desc: 'npm audit + secrets check', default: true, mode: 'block', when: 'beforeCommit', category: 'quality' },
      { key: '5', name: 'codeComplexityCheck', label: 'Code Complexity', desc: 'Quantitative complexity analysis', default: false, mode: 'warn', when: 'afterTask', category: 'quality' },
      { key: '6', name: 'codeSimplifier', label: 'Code Simplifier', desc: 'AI qualitative suggestions (nesting, long functions)', default: false, mode: 'prompt', when: 'afterTask', category: 'quality' },
      { key: '7', name: 'codeReview', label: 'Code Review', desc: 'Hybrid multi-agent review for large/high-risk', default: false, mode: 'warn', when: 'afterTask', category: 'quality' },
      { key: '8', name: 'silentFailureHunter', label: 'Silent Failure Hunter', desc: 'Detect empty catch, swallowed errors', default: false, mode: 'warn', when: 'afterTask', category: 'quality' },
      { key: '9', name: 'commentAnalyzer', label: 'Comment Analyzer', desc: 'Flag TODOs, stale comments, JSDoc accuracy', default: false, mode: 'warn', when: 'afterTask', category: 'quality' },
      { key: 'a', name: 'coverageCheck', label: 'Coverage Check', desc: 'Verify test coverage meets threshold', default: false, mode: 'warn', when: 'beforeCommit', category: 'quality' },

      // Documentation
      { key: 'b', name: 'updateKnowledgeBase', label: 'Update Knowledge Base', desc: 'Document learnings after tasks', default: false, mode: 'prompt', when: 'afterTask', category: 'docs' },
      { key: 'c', name: 'updateChangelog', label: 'Update Changelog', desc: 'Add CHANGELOG.md entries', default: false, mode: 'prompt', when: 'beforeCommit', category: 'docs' },
    ];

    console.log('Available steps:\n');

    // Group by category
    const testing = workflowSteps.filter(s => s.category === 'testing');
    const quality = workflowSteps.filter(s => s.category === 'quality');
    const docs = workflowSteps.filter(s => s.category === 'docs');

    console.log(c('cyan', 'Testing:'));
    for (const step of testing) {
      const defaultMark = step.default ? c('green', ' (ON)') : '';
      console.log(`  (${step.key}) ${step.label} - ${step.desc}${defaultMark}`);
    }

    console.log(c('cyan', '\nQuality Analysis:'));
    console.log(c('dim', '  Note: codeComplexityCheck (quantitative) and codeSimplifier (qualitative)'));
    console.log(c('dim', '  can be enabled together for comprehensive analysis.\n'));
    for (const step of quality) {
      const defaultMark = step.default ? c('green', ' (ON)') : '';
      console.log(`  (${step.key}) ${step.label} - ${step.desc}${defaultMark}`);
    }

    console.log(c('cyan', '\nDocumentation:'));
    for (const step of docs) {
      const defaultMark = step.default ? c('green', ' (ON)') : '';
      console.log(`  (${step.key}) ${step.label} - ${step.desc}${defaultMark}`);
    }

    console.log(c('dim', '\nType numbers to toggle (e.g., "4,5" to enable knowledge base + changelog)'));
    console.log(c('dim', 'Press Enter to accept defaults, or "all" to enable all steps.'));

    const answer = await this.askQuestion('\nToggle steps [Enter for defaults]: ');

    // Build the workflowSteps config
    const config = {};
    for (const step of workflowSteps) {
      config[step.name] = {
        enabled: step.default,
        mode: step.mode,
        when: step.when
      };
    }

    // Process user selections
    if (answer && answer.toLowerCase() === 'all') {
      // Enable all
      for (const step of workflowSteps) {
        config[step.name].enabled = true;
      }
      console.log(c('green', '\nAll workflow steps enabled.'));
    } else if (answer && answer.trim() !== '') {
      // Toggle specific steps
      const keys = answer.split(',').map(k => k.trim());
      for (const key of keys) {
        const step = workflowSteps.find(s => s.key === key);
        if (step) {
          config[step.name].enabled = !config[step.name].enabled;
          const status = config[step.name].enabled ? 'enabled' : 'disabled';
          console.log(`  ${step.label}: ${status}`);
        }
      }
    } else {
      console.log(c('dim', '\nUsing default workflow steps configuration.'));
    }

    this.selections.workflowSteps = config;
  }

  // ============================================
  // PHASE 5: Final Summary & Generation
  // ============================================

  async finalizeAndGenerate() {
    // Show final summary
    console.log(c('bold', '\n━━━ Final Tech Stack ━━━\n'));
    this.printFinalSummary();

    // Confirm and generate
    const proceed = await this.askConfirmation(
      '\nGenerate skills and fetch documentation? [Y/n] '
    );

    if (proceed) {
      await this.generateSkills();
    } else {
      console.log('\nSkipped skill generation. You can run this later with:');
      console.log('  /wogi-setup-stack\n');
      this.saveSelectionsToFile();
    }
  }

  printFinalSummary() {
    const platform = PLATFORM_TYPES.find(p => p.value === this.selections.projectType);
    console.log(`Platform: ${platform?.label || this.selections.projectType}`);

    if (this.selections.frontend && this.selections.frontend !== 'none') {
      const fe = [...FRONTEND_FRAMEWORKS, ...MOBILE_FRAMEWORKS].find(f => f.value === this.selections.frontend);
      console.log(`Frontend: ${fe?.label || this.selections.frontend}`);
    }

    if (this.selections.backend && this.selections.backend !== 'none') {
      const be = BACKEND_FRAMEWORKS.find(f => f.value === this.selections.backend);
      console.log(`Backend: ${be?.label || this.selections.backend}`);
    }

    // Collect all technologies for display
    const techs = collectTechnologiesFromSelections(this.selections);
    if (techs.length > 0) {
      console.log(`\nTechnologies (${techs.length}):`);
      for (const tech of techs) {
        console.log(`  - ${tech.label}`);
      }
    }

    if (this.selections.aiConfigured) {
      console.log(c('dim', '\n  Auto-configured with AI recommendations'));
    }

    // Show workflow steps
    if (this.selections.workflowSteps) {
      const enabled = Object.entries(this.selections.workflowSteps)
        .filter(([_, cfg]) => cfg.enabled)
        .map(([name, _]) => name);

      if (enabled.length > 0) {
        console.log(`\nWorkflow Steps (${enabled.length} enabled):`);
        for (const name of enabled) {
          console.log(`  - ${name}`);
        }
      }
    }
  }

  async generateSkills() {
    console.log(c('cyan', '\nGenerating skills...'));

    const technologies = collectTechnologiesFromSelections(this.selections);

    if (technologies.length === 0) {
      console.log('No technologies selected that require skill generation.');
      return;
    }

    // Show which technologies have pre-built templates
    try {
      const { listPrebuiltSkills, normalizeSkillId } = require('./flow-skill-generator');
      const prebuiltSet = new Set(listPrebuiltSkills());
      const prebuiltCount = technologies.filter(t => prebuiltSet.has(normalizeSkillId(t.value))).length;
      const generateCount = technologies.length - prebuiltCount;

      console.log(`\n  Creating skills for ${technologies.length} technologies:`);
      if (prebuiltCount > 0) {
        console.log(c('green', `    ${prebuiltCount} pre-built (instant, zero context cost)`));
      }
      if (generateCount > 0) {
        console.log(c('yellow', `    ${generateCount} will be generated (may use Context7)`));
      }
    } catch (err) {
      console.log(`\n  Creating skills for ${technologies.length} technologies...`);
    }

    try {
      const generator = require('./flow-skill-generator');
      await generator.generateSkills(technologies, this.selections);

      console.log(c('green', '\n✅ Skills generated successfully!\n'));

      // Print generated skills
      const skillsDir = path.join(process.cwd(), '.claude', 'skills');
      if (fs.existsSync(skillsDir)) {
        const skills = fs.readdirSync(skillsDir).filter(f =>
          fs.statSync(path.join(skillsDir, f)).isDirectory() && f !== '_template'
        );

        if (skills.length > 0) {
          console.log('Skills created in .claude/skills/:');
          for (const skill of skills) {
            console.log(`  - ${skill}/`);
          }
        }
      }

      console.log(c('yellow', '\n💡 You can review and customize these skills:'));
      console.log('   cat .claude/skills/[skill-name]/skill.md\n');
      console.log('To regenerate with different settings:');
      console.log('   /wogi-setup-stack\n');

    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        console.log(c('yellow', '\nSkill generator not found. Creating placeholder...'));
        this.saveSelectionsToFile();
      } else {
        console.error('\nError generating skills:', err.message);
        console.log('\nSaving selections for later processing...');
        this.saveSelectionsToFile();
      }
    }
  }

  saveSelectionsToFile() {
    const projectRoot = process.cwd();
    const selectionsPath = path.join(projectRoot, '.workflow', 'state', 'stack-selections.json');

    try {
      fs.mkdirSync(path.dirname(selectionsPath), { recursive: true });
      fs.writeFileSync(selectionsPath, JSON.stringify(this.selections, null, 2));
      console.log(`\nSelections saved to: ${selectionsPath}`);
      console.log('Run skill generation later with: /wogi-setup-stack --generate');
    } catch (err) {
      console.error('Failed to save selections:', err.message);
    }
  }

  // ============================================
  // INPUT HELPERS
  // ============================================

  askQuestion(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async askSingleChoice(question, options, defaultValue = null) {
    const MAX_RETRIES = 10;
    let retries = 0;

    console.log(`${question}`);

    for (const opt of options) {
      const isDefault = opt.value === defaultValue;
      const isRecommended = opt.recommended;
      let marker = '';
      if (isDefault) marker = c('green', ' [current]');
      else if (isRecommended) marker = c('dim', ' (Recommended)');
      console.log(`  (${opt.key}) ${opt.label}${marker}`);
    }

    while (retries < MAX_RETRIES) {
      const defaultKey = options.find(o => o.value === defaultValue)?.key || options[0].key;
      const answer = await this.askQuestion(`\nYour choice [${defaultKey}]: `) || defaultKey;

      const option = options.find(o => o.key === answer);
      if (option) {
        return option.value;
      }

      retries++;
      if (retries < MAX_RETRIES) {
        console.log(`  Invalid choice. ${MAX_RETRIES - retries} attempts remaining.`);
      }
    }

    console.log('  Using default.');
    return defaultValue || options[0].value;
  }

  async askGroupedChoice(question, options, defaultValue = null) {
    const MAX_RETRIES = 10;
    let retries = 0;

    console.log(`${question}`);

    // Group options
    const groups = {};
    for (const opt of options) {
      const group = opt.group || 'Options';
      if (!groups[group]) groups[group] = [];
      groups[group].push(opt);
    }

    // Print grouped options
    for (const [groupName, groupOpts] of Object.entries(groups)) {
      if (groupName !== 'Options' && groupName !== null) {
        console.log(`  ${c('dim', `[${groupName}]`)}`);
      }
      for (const opt of groupOpts) {
        const isDefault = opt.value === defaultValue;
        const isRecommended = opt.recommended;
        let marker = '';
        if (isDefault) marker = c('green', ' [current]');
        else if (isRecommended) marker = c('dim', ' (Recommended)');
        console.log(`  (${opt.key}) ${opt.label}${marker}`);
      }
    }

    while (retries < MAX_RETRIES) {
      const defaultKey = options.find(o => o.value === defaultValue)?.key || options[0].key;
      const answer = await this.askQuestion(`\nYour choice [${defaultKey}]: `) || defaultKey;

      const option = options.find(o => o.key === answer);
      if (option) {
        return option.value;
      }

      retries++;
      if (retries < MAX_RETRIES) {
        console.log(`  Invalid choice. ${MAX_RETRIES - retries} attempts remaining.`);
      }
    }

    console.log('  Using default.');
    return defaultValue || options[0].value;
  }

  async askConfirmation(prompt) {
    const answer = await this.askQuestion(prompt);
    return answer.toLowerCase() !== 'n';
  }
}

// ============================================
// EXPORTS & CLI
// ============================================

module.exports = { EnhancedStackWizard };

// Run if called directly
if (require.main === module) {
  const wizard = new EnhancedStackWizard();
  wizard.run()
    .then((selections) => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Wizard error:', error);
      process.exit(1);
    });
}
