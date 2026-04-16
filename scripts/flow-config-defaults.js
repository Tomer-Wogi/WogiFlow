#!/usr/bin/env node

/**
 * Wogi Flow - Configuration Defaults
 *
 * The SINGLE SOURCE OF TRUTH for all default config values.
 * User's config.json contains only overrides — everything else
 * comes from CONFIG_DEFAULTS via mergeWithDefaults().
 *
 * Like TypeScript's tsconfig.json: users only specify what they
 * want to change. Defaults live here, not in config.json.
 *
 * Usage:
 *   const { CONFIG_DEFAULTS, getDefaultsForKey, mergeWithDefaults } = require('./flow-config-defaults');
 *
 *   // Get defaults for a specific config section
 *   const phases = getDefaultsForKey('phases.definitions');
 *
 *   // Merge user config with defaults (user values override)
 *   const fullConfig = mergeWithDefaults(userConfig);
 *
 * Dead keys removed in v1.10.0 (audit wf-cf977256):
 *   autoLog, autoUpdateAppMap, requireApproval (top-level),
 *   enforcement.requireStoryForMediumTasks, enforcement.taskSizeThresholds,
 *   execution.stuckThreshold, execution.progressCommitInterval,
 *   execution.recheckAfterFix, workflow, reporting, promptTemplates,
 *   bulkLoop, corrections, agents (top-level list)
 */

// ============================================================
// Static Data Constants (large objects extracted for readability)
// ============================================================

const FRAMEWORK_DETECTION_PATTERNS = {
  nestjs: ['*.module.ts', '*.controller.ts', '*.service.ts', '@nestjs/*'],
  react: ['*.tsx', '*.jsx', 'use*.ts', 'react', 'react-dom'],
  nextjs: ['next.config.*', 'app/layout.tsx', 'pages/_app.tsx', 'next'],
  remix: ['remix.config.*', 'app/root.tsx', 'app/routes/*', '@remix-run/*'],
  astro: ['astro.config.*', '*.astro', 'astro'],
  vue: ['*.vue', 'vue', '@vue/*'],
  nuxt: ['nuxt.config.*', 'nuxt'],
  svelte: ['*.svelte', 'svelte', 'svelte.config.*'],
  sveltekit: ['svelte.config.*', 'src/routes/+page.svelte', '@sveltejs/kit'],
  solid: ['solid-js', '*.tsx', 'solid-start'],
  qwik: ['*.tsx', '@builder.io/qwik', 'qwik'],
  angular: ['*.component.ts', '*.module.ts', '@angular/*'],
  express: ['app.js', 'express', 'router.js'],
  hono: ['hono', '@hono/*'],
  fastapi: ['main.py', 'fastapi', 'pydantic'],
  django: ['manage.py', 'django', 'settings.py'],
  flask: ['app.py', 'flask', 'wsgi.py'],
  gin: ['go.mod', 'github.com/gin-gonic/gin'],
  fiber: ['go.mod', 'github.com/gofiber/fiber'],
  actix: ['Cargo.toml', 'actix-web'],
  rocket: ['Cargo.toml', 'rocket']
};

const OFFICIAL_DOCS_URLS = {
  nestjs: 'https://docs.nestjs.com',
  react: 'https://react.dev',
  nextjs: 'https://nextjs.org/docs',
  remix: 'https://remix.run/docs',
  astro: 'https://docs.astro.build',
  vue: 'https://vuejs.org/guide',
  nuxt: 'https://nuxt.com/docs',
  svelte: 'https://svelte.dev/docs',
  sveltekit: 'https://kit.svelte.dev/docs',
  solid: 'https://docs.solidjs.com',
  qwik: 'https://qwik.dev/docs',
  angular: 'https://angular.io/docs',
  express: 'https://expressjs.com/en/guide',
  hono: 'https://hono.dev/docs',
  fastapi: 'https://fastapi.tiangolo.com',
  django: 'https://docs.djangoproject.com',
  flask: 'https://flask.palletsprojects.com',
  gin: 'https://gin-gonic.com/docs',
  fiber: 'https://docs.gofiber.io',
  actix: 'https://actix.rs/docs',
  rocket: 'https://rocket.rs/guide'
};

const PHASE_DEFINITIONS = [
  { id: 'contract', name: 'Contract', description: 'Define interfaces, types, API contracts', focus: ['types', 'interfaces', 'contracts'], output: 'Type definitions and API contracts' },
  { id: 'skeleton', name: 'Skeleton', description: 'Create file structure, stub implementations', focus: ['structure', 'stubs', 'scaffolding'], output: 'File structure with stub implementations' },
  { id: 'core', name: 'Core Logic', description: 'Implement main business logic', focus: ['logic', 'implementation', 'happy-path'], output: 'Working happy-path implementation' },
  { id: 'edge-cases', name: 'Edge Cases', description: 'Handle edge cases and error states', focus: ['errors', 'edge-cases', 'validation'], output: 'Robust error handling' },
  { id: 'polish', name: 'Polish', description: 'Optimization, cleanup, documentation', focus: ['optimization', 'cleanup', 'docs'], output: 'Production-ready code' }
];

const PRIORITY_LEVELS = {
  P0: { label: 'Critical', description: 'Drop everything' },
  P1: { label: 'High', description: 'Do today' },
  P2: { label: 'Medium', description: 'Do this week' },
  P3: { label: 'Low', description: 'Do when possible' },
  P4: { label: 'Backlog', description: 'Someday' }
};

const CLASSIFICATION_KEYWORDS = {
  epic: ['system', 'architecture', 'migration', 'redesign', 'platform', 'infrastructure', 'overhaul'],
  story: ['feature', 'flow', 'integration', 'module', 'workflow', 'implement'],
  task: ['add', 'fix', 'update', 'change', 'remove', 'button', 'field', 'tweak']
};

const CLOUD_PROVIDER_MODELS = {
  openai: { models: ['gpt-4o-mini', 'gpt-4o'], defaultModel: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  anthropic: { models: ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307'], defaultModel: 'claude-3-5-haiku-latest', envKey: 'ANTHROPIC_API_KEY' },
  google: { models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash'], defaultModel: 'gemini-2.0-flash-exp', envKey: 'GOOGLE_API_KEY' }
};

const REFACTOR_KEYWORDS = ['refactor', 'migration', 'overhaul', 'redesign', 'rewrite', 'restructure', 'rearchitect'];

const WORKFLOW_STEP_DEFAULTS = {
  regressionTest: { enabled: false, mode: 'warn', when: 'afterTask' },
  securityScan: { enabled: false, mode: 'block', when: 'beforeCommit', config: { severity: 'high' } },
  updateKnowledgeBase: { enabled: false, mode: 'prompt', when: 'afterTask' },
  updateChangelog: { enabled: false, mode: 'prompt', when: 'beforeCommit' },
  codeComplexityCheck: { enabled: false, mode: 'warn', when: 'afterTask', config: { threshold: 10 } },
  coverageCheck: { enabled: false, mode: 'warn', when: 'beforeCommit', config: { minCoverage: 80 } },
  codeSimplifier: { enabled: false, mode: 'prompt', when: 'afterTask', config: { maxFunctionLines: 50, maxNestingDepth: 3, suggestExtraction: true, requireVerificationAfterApply: true } },
  codeReview: { enabled: false, mode: 'warn', when: 'afterTask', config: { multiAgentThreshold: 5, highRiskPatterns: ['auth', 'payment', 'security', 'crypto'], confidenceThreshold: 80 } },
  prTestAnalyzer: { enabled: false, mode: 'warn', when: 'beforeCommit', config: { checkCoverage: true, checkQuality: true, minCoverageForModified: 70 } },
  silentFailureHunter: { enabled: false, mode: 'warn', when: 'afterTask', config: { checkEmptyCatch: true, checkLogOnlyCatch: true, checkUnhandledAsync: true, checkPromiseChains: true } },
  commentAnalyzer: { enabled: false, mode: 'warn', when: 'afterTask', config: { flagTodo: true, flagFixme: true, checkJsdoc: true, flagCommentedCode: true, flagStale: true } }
};

const REVIEW_AGENTS = {
  core: ['code-logic', 'security', 'architecture'],
  optional: ['performance'],
  projectRules: true,
  projectRulesSource: 'decisions.md',
  maxParallelAgents: 6
};

const CONTEXT_SCORING_PRIORITIES = {
  required_types: 1, target_file: 0.95, error_context: 0.93,
  direct_imports: 0.9, interface_definitions: 0.88, api_contracts: 0.85,
  related_imports: 0.8, test_files: 0.75, patterns: 0.7,
  similar_implementations: 0.65, documentation: 0.5, examples: 0.45,
  config_files: 0.4, full_files: 0.3
};

const RESEARCH_TRIGGERS = {
  feasibilityQuestions: 'deep', capabilityQuestions: 'standard',
  existenceQuestions: 'standard', architectureQuestions: 'deep',
  integrationQuestions: 'standard'
};

// ============================================================
// Full CONFIG_DEFAULTS
//
// Every config key with its default value. User config.json
// only needs to contain overrides — missing keys get these values.
//
// Dead keys removed per audit wf-cf977256:
//   autoLog, autoUpdateAppMap, requireApproval, workflow,
//   reporting, promptTemplates, bulkLoop, corrections, agents,
//   enforcement.requireStoryForMediumTasks, enforcement.taskSizeThresholds,
//   execution.stuckThreshold/progressCommitInterval/recheckAfterFix
// ============================================================

const CONFIG_DEFAULTS = {
  // --- Core ---
  version: '2.0.0',
  _configVersion: 2, // Tracks config schema version for migrations (see flow-config-migrate.js)
  projectName: '',
  cli: {
    type: 'claude-code',
    autoSync: { enabled: false }
  },
  scripts: { lint: null, typecheck: null, test: null, build: null, fix: null, coverage: null },

  // --- Enforcement ---
  enforcement: {
    strictMode: true,
    requireTaskForImplementation: true,
    requireGateLatch: true, // Gate latch: quality gates must pass before TaskCompleted allows completion
    requirePatternCitation: false,
    citationFormat: '// Pattern: {pattern}',
    blockAutoTask: true,
    warnOnBypass: true,
    taskGating: { enabled: true, blockWithoutTask: true, autoCreateTask: false },
    scopeGating: {
      enabled: true,
      mode: 'warn',
      exemptPatterns: ['.workflow/state/**', '.workflow/specs/**', '.workflow/plans/**', 'package.json', 'package-lock.json', 'tsconfig.json']
    },
    implementationGate: { enabled: true },
    todoWriteGate: { enabled: true, blockImplementationWithoutTask: true },
    routingGate: { enabled: true },
    commitLogGate: { enabled: true },
    loopEnforcement: { enabled: true },
    hypothesisGate: {
      enabled: true,
      _comment_hypothesisGate: 'Blocks premature "fixed"/"should work" claims during bug investigation until hypothesis is verified. Pattern: hypothesis → verify → confirm → communicate.',
      blockedPhrases: ['fixed', 'should work', 'go try', 'go refresh'],
      requireExplicitVerification: true
    },
    deployGate: {
      _comment_deployGate: 'Blocks deploy commands unless a valid HMAC-signed verification artifact exists. Off by default — opt in via `flow deploy-gate init`.',
      enabled: false,
      commands: [],
      sourcePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.css'],
      requireForPriorities: ['P0', 'P1'],
      blockWriteToVerifications: true,
      minVerifiedRoutes: 3,
      rejectLoginOnly: true
    },
    strikeEscalation: {
      _comment_strikeEscalation: 'Mechanical strike counter. Blocks Edit/Write after repeated verification failures on the same task.',
      enabled: true,
      blockThreshold: 2,
      escalateThreshold: 3,
      hardBlockThreshold: 4,
      productionCrashThreshold: 2
    },
    bugfixScope: {
      _comment_bugfixScope: 'Pauses L3 bugfixes after N unique non-test files edited, requiring a scope inventory.',
      enabled: true,
      mode: 'warn',
      fileThreshold: 3,
      excludePatterns: ['*.test.*', '*.spec.*', '*.d.ts', '__tests__/**', '__mocks__/**'],
      keywordMatchThreshold: 2,
      fanOutThreshold: 10
    },
    revertFirst: {
      _comment_revertFirst: 'For production crashes: recommends reverting before forward-fixing. Off by default.',
      enabled: false,
      keywords: ['production', 'crash', 'down', 'outage', '500 errors', 'users can\u0027t', 'site is broken', 'live issue'],
      deployHistoryRetention: 50,
      oldDeployWarningDays: 7
    },
    scopeMutation: {
      _comment_scopeMutation: 'Agnostic gate: fix tasks creating 2+ new files → warn. Deleting pre-existing files → warn. No framework pattern matching.',
      enabled: true,
      newFileThreshold: 2,
      mode: 'warn'
    },
    gitSafety: {
      _comment_gitSafety: 'Auto-backup before destructive git operations. Prevents accidental loss of work from prior sessions.',
      enabled: true,
      maxBackwardCommits: 3,
      ageThresholdHours: 24,
      autoBackup: true,
      maxBackupBranches: 3
    }
  },

  // --- Execution ---
  execution: {
    maxIterations: 20,
    blockExitUntilComplete: true,
    autoInferVerification: true,
    maxRetries: 5,
    requireSpecVerification: true,
    specVerification: {
      validateSyntax: true,
      allowSkipWithFlag: true,
      parsePatterns: ['tables', 'code-blocks', 'lists']
    },
    loops: {
      enabled: false,
      enforced: true,
      requireVerification: true,
      blockOnSkip: true,
      commitEvery: 3,
      pauseBetweenScenarios: false,
      fallbackToManual: true,
      simpleMode: { enabled: false },
      recheckAllAfterFix: true,
      regressionOnRecheck: 'warn'
    },
    tdd: {
      enforced: true,
      defaultForTypes: ['bugfix'],
      requireFailingTestFirst: true,
      testFrameworkDetection: true
    }
  },

  // --- Error Recovery ---
  errorRecovery: {
    enabled: false,
    hierarchicalAnalysis: true,
    autoSuggestFixes: true,
    trackSuccessfulStrategies: true,
    maxAttemptsPerLevel: 3,
    architecturalReassessment: { enabled: false },
    recursive: { enabled: false },
    hypothesisGeneration: { usePatterns: true, useAI: false, aiModel: 'haiku' }
  },

  // --- Parallel Execution ---
  parallelExecution: {
    taskQueue: { enabled: false },
    parallel: { enabled: false },
    bulkOrchestrator: {
      enabled: false,
      parallelLimit: 3,
      useWorktrees: true,
      onFailure: 'stop-dependent',
      summaryDepth: 'standard',
      continuous: { enabled: false }
    }
  },

  // --- Session & Workflow ---
  durableSteps: { enabled: false },
  suspension: { enabled: false },
  capture: { autoGroup: true, groupingThreshold: 0.5, maxGroupSize: 5, routing: { enabled: false } },
  phases: { enabled: false, definitions: PHASE_DEFINITIONS },
  mandatorySteps: {
    afterTask: [],
    beforeCommit: [],
    onSessionEnd: ['updateRequestLog', 'updateAppMap']
  },
  priorities: { defaultPriority: 'P2', autoBoostDays: 2, autoBoostAmount: 1, levels: PRIORITY_LEVELS },

  // --- Story Decomposition ---
  storyDecomposition: {
    autoDetect: true,
    autoDecompose: false,
    complexityThreshold: 'medium',
    minSubTasks: 5,
    edgeCases: true,
    loadingStates: true,
    errorStates: true,
    classification: { enabled: false, keywords: CLASSIFICATION_KEYWORDS },
    supportEpics: true,
    propagateProgress: true
  },
  epics: { enabled: false },

  // --- Specification & Questions ---
  clarifyingQuestions: { enabled: false },
  specificationMode: {
    enabled: false,
    mandatory: true,
    mandatoryFor: ['medium', 'large'],
    skipFor: ['small', 'bugfix'],
    requireApproval: true,
    specDirectory: '.workflow/specs',
    template: 'default',
    sections: {
      acceptanceCriteria: true,
      implementationSteps: true,
      filesToChange: true,
      testStrategy: true,
      verificationCommands: true,
      rollbackPlan: false
    },
    autoDetectFiles: true,
    autoSuggestTests: true,
    needsClarification: { enabled: false }
  },

  // --- Quality Gates ---
  qualityGates: {
    preTaskBaseline: { enabled: false },
    feature: {
      require: ['loopComplete', 'tests', 'generatedTestsPass', 'uiVerification', 'apiVerification', 'verificationProof', 'registryUpdate', 'requestLogEntry', 'integrationWiring', 'standardsCompliance'],
      optional: ['review', 'docs', 'webmcpVerification', 'captureGate']
    },
    bugfix: {
      require: ['loopComplete', 'tests', 'generatedTestsPass', 'verificationProof', 'requestLogEntry', 'standardsCompliance'],
      optional: ['learningEnforcement', 'resolutionPopulated', 'review', 'webmcpVerification', 'captureGate']
    },
    refactor: {
      require: ['loopComplete', 'tests', 'noNewFeatures', 'smokeTest', 'standardsCompliance'],
      optional: ['review', 'webmcpVerification', 'captureGate']
    },
    chore: {
      require: ['requestLogEntry', 'outstandingFindings'],
      optional: []
    },
    release: {
      require: ['requestLogEntry', 'outstandingFindings', 'preRelease'],
      optional: []
    },
    fix: {
      require: ['loopComplete', 'requestLogEntry', 'standardsCompliance'],
      optional: ['tests']
    }
  },

  // --- Standards & Compliance ---
  standardsCompliance: {
    enabled: true,
    mode: 'block',
    scopeByTaskType: true,
    alwaysCheck: ['naming', 'security'],
    similarityThreshold: 0.8,
    similarityWarningThreshold: 0.6
  },
  // --- Workspace Sovereignty ---
  workspace: {
    _comment_workerGatesSovereign: 'When true, workers cannot skip their own quality gates even if the manager instructs them to',
    workerGatesSovereign: true,
    managerCanOverrideLevel: false,
    managerCanSkipGates: false,
    _comment_autoPickupChannelDispatches: 'v2.20.0+: After task completion, if channel-dispatched tasks are queued in ready.json, the task-completed hook injects additionalContext instructing the AI to auto-invoke /wogi-start on the next queued task in the same turn. Prevents "Sauteed worker" silent stalls between queued dispatches. The Stop hook also blocks end-of-turn when queued dispatches exist but no task is in progress — making "awaiting signal" language mechanically impossible as a terminal state.',
    autoPickupChannelDispatches: true,
    _comment_diagnosticCurlBypass: 'v2.20.0+: When true, PreToolUse routing gate allows narrow curl-to-manager-port when replying to channel messages tagged INTROSPECTION or DIAGNOSTIC, with body starting "## ". Unblocks diagnostic round-trips without forcing fake task creation. Scope: localhost:8800 only.',
    diagnosticCurlBypass: true
  },
  checkpoint: { enabled: false },
  regressionTesting: { enabled: false },

  // --- Runtime Verification (CC 2.1.89+ enforcement) ---
  // Ensures agents actually test their work before marking done.
  // Without this, agents claim "done" based on static evidence only.
  runtimeVerification: {
    enabled: true,
    autoGenerateTests: true,
    blockOnFailure: true,
    frontend: {
      method: 'webmcp',
      fallback: ['playwright', 'checklist'],
      devServerUrl: 'http://localhost:5173'
    },
    backend: {
      method: 'api-test',
      fallback: ['curl', 'checklist'],
      baseUrl: 'http://localhost:3000'
    },
    testOutput: 'tests/verification',
    persistTests: true
  },

  // --- Detection (Project Type Awareness) ---
  detection: {
    _comment: "Weighted scoring for project type detection. Overrides take precedence over scoring.",
    weights: {
      uiFrameworkDep: 0.95,
      apiFrameworkDep: 0.95,
      uiDirectory: 0.3,
      apiDirectory: 0.25,
      apiFile: 0.8,
      testFrameworkDep: 0.9
    },
    thresholds: {
      ui: 0.5,
      api: 0.5
    },
    overrides: null
  },

  // --- Testing (Auto-Testing Suite) ---
  testing: {
    enabled: false,
    mode: 'auto',
    _comment_mode: "auto|ui|api|full|unit|off — 'auto' uses project detection",
    detected: {
      projectType: null,
      hasUI: false,
      hasAPI: false,
      uiFramework: null,
      apiFramework: null,
      testFramework: null
    },
    ui: {
      provider: 'playwright-mcp',
      headless: true,
      baseUrl: 'http://localhost:3000',
      startCommand: null,
      checkAccessibility: true,
      stateChecks: ['empty', 'loading', 'error', 'success']
    },
    api: {
      provider: 'direct-http',
      baseUrl: 'http://localhost:3001',
      startCommand: null,
      specFile: null
    },
    generation: {
      autoGenerate: true,
      fromSpec: true,
      includeEdgeCases: true,
      outputDir: '.workflow/tests/generated'
    },
    qualityGates: {
      generatedTestsPass: true,
      uiVerification: true,
      apiVerification: true,
      dataIntegrity: true
    }
  },

  // --- Component Reuse ---
  componentReuse: {
    enabled: true,
    threshold: 30,
    allRegistries: true,
    aiAsJudge: true,
    blockOnSimilar: true,
    injectContext: true,
    preferVariants: true,
    requireAppMapEntry: true,
    requireDetailDoc: false,
    autoGenerateStorybook: false,
    storybookPath: 'src/stories'
  },

  // --- Skills ---
  skills: {
    installed: [],
    comingSoon: [],
    autoInvoke: true,
    autoDiscoverNested: true,
    minRelevanceScore: 2,
    autoFetchDocs: true,
    contentPriority: ['skill.md', 'conventions.md', 'anti-patterns.md', 'learnings.md', 'library-reference.md'],
    loadPatterns: true,
    loadAntiPatterns: true,
    loadLearnings: true,
    loadLibraryReference: true,
    loadConventions: true
  },

  // --- Learning ---
  learning: {
    autoPromoteEnabled: false,
    requireUserConfirmation: true,
    session: { enabled: false },
    crossSession: { enabled: false },
    knowledgeRouting: {
      autoDetect: true,
      confirmWithUser: true,
      defaultScope: 'local',
      modelSpecificLearning: true
    },
    modelAdapters: { enabled: false },
    skill: {
      enabled: false,
      frameworkDetectionPatterns: FRAMEWORK_DETECTION_PATTERNS,
      officialDocsUrls: OFFICIAL_DOCS_URLS
    },
    standardsLearning: { enabled: false },
    errorRecoveryLearning: { recordSuccessfulFixes: true, recordFailedHypotheses: true },
    bugFlowLearning: { enabled: false }
  },

  // --- Bug Flow ---
  bugFlow: {
    investigationAgents: {
      errorSourceFinder: { enabled: false },
      patternChecker: { enabled: false },
      dependencyAnalyzer: { enabled: false }
    },
    autoRoute: true,
    inlineDiscovery: {
      maxSearchOperations: 3,
      maxFileReads: 2,
      autoPriorityBoost: true,
      skipDependencyAnalysis: true
    },
    severityOverride: { enabled: false }
  },

  // --- Decide & Retro ---
  decide: {
    requireRationale: true,
    scanForViolations: true,
    maxClarifyingQuestions: 4,
    violationRouting: { quickFixThreshold: 3, storyThreshold: 10, epicThreshold: 25 }
  },
  retrospective: {
    maxQuestions: 3,
    autoSuggestRules: true,
    saveReviewFile: true,
    quickModeDefault: false
  },

  // --- Memory ---
  memory: {
    level: 'off',
    enabled: false,
    localDb: '.workflow/memory/local.db',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    maxLocalFacts: 1000,
    autoRemember: false,
    automatic: {
      enabled: false,
      entropyThreshold: 0.7,
      compactOnSessionEnd: true,
      relevanceDecay: { enabled: false },
      demotion: { relevanceThreshold: 0.3, coldRetentionDays: 90 },
      selfTuning: { enabled: false },
      observationCapture: { enabled: false },
      observationExtraction: { enabled: false }
    },
    promotion: { enabled: false }
  },

  // --- PRD ---
  prd: { enabled: false },

  // --- Context Management ---
  contextManagement: {
    compaction: {
      enabled: false,
      thresholds: { warnAt: 50000, compactAt: 80000, maxExpanded: 20000 },
      summary: { rootMaxLength: 200, sectionMaxLength: 500, detailMaxLength: 1000 },
      relevanceDecay: { enabled: false },
      autoCleanup: true,
      savePath: '.workflow/state/context-tree.json'
    },
    smart: {
      enabled: true,
      safeThreshold: 0.95,
      emergencyThreshold: 0.9,
      estimation: {
        perFile: 0.02, perCriterion: 0.03, perSpecChars: 0.002,
        refactorBuffer: 0.1, defaultSmallTask: 0.1, defaultMediumTask: 0.25, defaultLargeTask: 0.4
      },
      refactorKeywords: REFACTOR_KEYWORDS
    },
    proactive: {
      enabled: true,
      triggerThreshold: 0.75,
      useHaiku: true,
      phases: ['exploring', 'spec_review', 'scenario', 'criteria_check', 'validating']
    },
    monitor: { enabled: false }
  },

  // --- Task Context ---
  taskContext: {
    auto: {
      enabled: false,
      strategy: 'dynamic',
      showLoadedFiles: true,
      includeContent: true,
      useSectionReferences: true,
      maxFilesToLoad: 10,
      maxGrepResults: 10,
      maxComponentMatches: 15,
      maxContentLines: 50,
      useAstGrep: false,
      maxSemanticFacts: 5,
      semanticMinRelevance: 40,
      fallbackLimits: { maxFilesHard: 50, maxTokensHard: 150000 },
      lspEnrichment: { enabled: false }
    },
    scoring: { enabled: false, priorities: CONTEXT_SCORING_PRIORITIES },
    session: { enabled: false }
  },

  // --- Eval ---
  eval: {
    judges: { opus: 1, sonnet: 2 },
    scoringDimensions: ['completeness', 'accuracy', 'workflowCompliance', 'tokenEfficiency', 'quality'],
    passingThreshold: 6
  },

  // --- Best-of-N ---
  bestOfN: {
    enabled: true,
    autoSuggestThreshold: 'high',
    defaultN: 3,
    temperatureRange: [0.3, 0.7, 1],
    maxConcurrent: 3,
    failureThresholdForFallback: 3
  },

  // --- Skeptical Evaluator (Anthropic harness design pattern) ---
  // Spawns a separate sub-agent to evaluate task output before quality gates.
  // Addresses "confident praise bias" where the implementer always thinks it did well.
  skepticalEvaluator: {
    enabled: true,
    _comment_enabled: 'Spawn a separate evaluator agent between Step 3.5 and Step 4',
    maxIterations: 3,
    _comment_maxIterations: 'Max eval→fix cycles before proceeding anyway',
    model: 'sonnet',
    _comment_model: 'Use a different model than the implementer for diversity',
    calibration: true,
    _comment_calibration: 'Inject few-shot calibration examples into evaluator prompt',
    skipForL3: true,
    _comment_skipForL3: 'Skip for trivial L3 subtasks'
  },

  // --- Sprint-Based Context Reset (Anthropic harness design pattern) ---
  // For large tasks (5+ criteria), commit and reset context every N criteria.
  // Fresh context per sprint prevents quality degradation on later criteria.
  sprintReset: {
    enabled: true,
    _comment_enabled: 'Enable sprint-based context resets for large tasks',
    criteriaPerSprint: 3,
    _comment_criteriaPerSprint: 'Number of criteria to complete before a context reset',
    minTaskCriteria: 5,
    _comment_minTaskCriteria: 'Only activate for tasks with this many or more criteria'
  },

  // --- Session Features ---
  morningBriefing: { enabled: false },
  techDebt: {
    enabled: false,
    promptOnSessionEnd: true,
    showInMorningBriefing: true,
    agingThreshold: 3,
    autoFix: { enabled: false },
    debtBudget: { enabled: false }
  },
  requestLog: { enabled: false },

  // --- Registries ---
  registries: [
    {
      id: 'components', enabled: false, activateWhen: 'frontend', autoScan: true,
      scanOn: ['sessionStart', 'afterTask', 'preCommit'], staleAfterMinutes: 60,
      directories: ['src/components', 'src/hooks', 'src/services', 'src/pages', 'src/modules', 'app'],
      ignore: ['*.test.*', '*.spec.*', '*.stories.*', 'index.ts', 'index.js', '__tests__', '__mocks__']
    },
    { id: 'functions', enabled: false, activateWhen: 'always', directories: ['src/utils', 'src/lib', 'src/helpers'], scanOn: ['sessionStart', 'afterTask'], autoUpdate: true },
    { id: 'apis', enabled: false, activateWhen: 'always', directories: ['src/api', 'src/services'], scanOn: ['sessionStart', 'afterTask'], autoUpdate: true },
    { id: 'schemas', enabled: 'auto', activateWhen: 'orm' },
    { id: 'services', enabled: 'auto', activateWhen: 'backend' }
  ],

  // --- Matching & Edit ---
  semanticMatching: { enabled: true },
  guidedEdit: { enabled: false },

  // --- Traces & Worktree ---
  traces: { saveTo: '.workflow/traces', generateDiagrams: true },
  worktree: { enabled: false },

  // --- Finalization ---
  finalization: {
    enabled: true,
    defaultAction: 'ask',
    autoMergeForTypes: ['bugfix', 'quick-fix'],
    requirePRForTypes: [],
    squashOnMerge: true,
    prTemplate: { includeTaskSpec: true, includeCommitList: true, includeFileSummary: true }
  },

  // --- Models ---
  models: {
    providers: {},
    defaults: { includeClaude: false },
    hybrid: {
      enabled: true,
      executor: {
        type: 'local', provider: null, providerEndpoint: null,
        model: null, apiKey: null, contextWindow: null, useFullContext: true
      },
      planner: { adaptToExecutor: true, useAdapterKnowledge: true },
      provider: null, providerEndpoint: null, model: null,
      settings: {
        temperature: 0.7, maxTokens: null, maxRetries: 20, timeout: 120000,
        autoExecute: false, createBranch: false,
        outputReserveRatio: 0.3, outputReserveMax: 4096,
        tokenEstimation: { enabled: false }
      },
      routing: {
        enabled: true,
        rules: [
          { taskType: 'simple-edit', model: 'cheapest', description: 'Typos, text changes, config edits' },
          { taskType: 'code-generation', model: 'mid-tier', description: 'New functions, components, tests' },
          { taskType: 'refactoring', model: 'planner', description: 'Keep on Opus — too complex to delegate' },
          { taskType: 'documentation', model: 'cheapest', description: 'README, comments, docs' }
        ],
        tiers: {
          cheapest: ['claude-3-5-haiku-latest', 'gpt-4o-mini', 'gemini-2.0-flash-exp'],
          'mid-tier': ['claude-3-5-sonnet-latest', 'gpt-4o', 'gemini-1.5-pro'],
          planner: 'current'
        }
      },
      templates: { directory: '.workflow/templates/hybrid' },
      projectContext: {
        uiFramework: null, stylingApproach: null, componentDirs: [],
        typeDirs: ['src/types/*.ts'], availableComponents: {}, typeLocations: {},
        doNotImport: ['React'], excludeTypePatterns: [],
        excludeDirectories: ['__tests__', '__mocks__', 'node_modules', '.git', 'dist', 'build'],
        projectWarnings: [], customRules: []
      },
      cloudProviders: CLOUD_PROVIDER_MODELS
    },
    multiModel: {
      enabled: false,
      routingStrategy: 'quality-first',
      strategies: {
        'quality-first': 'Select highest-capability model matching requirements',
        'cost-optimized': 'Select cheapest model with required capabilities',
        learned: 'Use historical success rates to optimize selection'
      },
      fallbackEnabled: true,
      maxEscalations: 2,
      promptFragments: { enabled: false },
      costBudget: { enabled: false }
    },
    cascade: { enabled: false }
  },

  // --- Gate Confidence ---
  gateConfidence: { enabled: false },

  // --- Long Input Gate ---
  longInputGate: {
    enabled: true,
    charThreshold: 3000,
    lineThreshold: 40,
    smartDefault: true,
    contentRules: { transcript: 'full', spec: 'full', requirements: 'full', code: 'skip', default: 'quick' },
    autoTriggerTypes: ['transcript', 'specs', 'requirements', 'feature-request'],
    clarificationStyle: 'grouped',
    verificationLevel: 'statement',
    storyPresentation: 'user-controlled',
    autoResolveContradictions: true,
    showSourceStatements: true,
    voiceClarification: true,
    supportedLanguages: ['en', 'uk', 'ru', 'he'],
    chunkingThreshold: 10000,
    chunkSize: 5000,
    chunkOverlap: 500,
    outputLanguage: 'en',
    adaptiveComplexity: { enabled: false }
  },

  // --- LSP & Insights ---
  lsp: { enabled: false },
  codebaseInsights: { enabled: false },

  // --- Commits (template-consumed) ---
  commits: {
    requireApproval: { feature: true, bugfix: false, refactor: true, docs: false },
    autoCommitSmallFixes: true,
    smallFixThreshold: 3,
    squashTaskCommits: true,
    commitMessageFormat: 'conventional'
  },

  // --- Security ---
  security: {
    scanBeforeCommit: true,
    blockOnHigh: true,
    checkPatterns: { secrets: true, injection: true, npmAudit: true },
    ignoreFiles: ['*.test.ts', '*.spec.ts']
  },

  // --- Proactive Compaction ---
  proactiveCompaction: {
    enabled: true,
    triggerThreshold: 0.80,
    useHaiku: true,
    phases: ['exploring', 'spec_review', 'scenario', 'criteria_check', 'validating']
  },

  // --- Damage Control ---
  // --- Auto-Compact (context-aware task scheduling) ---
  autoCompact: {
    betweenTasks: true,
    smartOrdering: true,
    respectDependencies: true
  },

  // --- Session Hydration (wf-729ab5c0) ---
  // Controls how much session-episodic content (request-log entries, recent
  // activity) gets injected into SessionStart's additionalContext. Rule-class
  // files (decisions.md, app-map, etc.) are NOT affected — rules don't expire.
  sessionHydration: {
    _comment: 'Recency-based filter for SessionStart episodic-content injection. Complements wf-39e9dc09 task-boundary restart.',
    recencyWindowHours: 48,
    _comment_recencyWindowHours: 'Session-episodic entries older than this are excluded from hydration (still on disk, loadable via Read/Grep on demand). 0 = disable time filter (count-based limits still apply).'
  },

  // --- Task-Boundary Session Restart (wf-39e9dc09) ---
  // EXPERIMENTAL, OPT-IN. When enabled AND the `wogi-claude` wrapper is running,
  // TaskCompleted triggers a clean restart of the Claude Code process so each
  // new task starts with a fresh context. State files persist; the wrapper
  // detects the restart flag and relaunches claude. See lib/wogi-claude for
  // the wrapper. See scripts/hooks/core/task-boundary-reset.js for the trigger.
  //
  // Per-task context reset via wogi-claude wrapper. Validated in v2.17.0 for
  // workspace workers (manager sessions deliberately skip restart to avoid
  // orchestration storms — see resolveClaudeSpawnCommand in lib/workspace.js).
  // Enabled by default as of v2.19.0 after the "Sautéed worker" UX complaint:
  // without it, workers sit idle after task completion instead of restarting
  // fresh and ready for the next dispatch. Users who want the old behavior
  // can set `enabled: false` explicitly.
  taskBoundaryReset: {
    _comment: 'Per-task context reset via wogi-claude wrapper. See lib/wogi-claude.',
    enabled: true,
    maxRestartsPerSession: 50,
    _comment_maxRestartsPerSession: 'Safety cap. The wrapper also has WOGI_MAX_RESTARTS env override.'
  },

  // --- Contract Surface (Teams-only — activated on wogi login) ---
  contractSurface: {
    enabled: false,
    projectType: 'auto',
    scanOn: ['sessionStart', 'afterTask'],
    scanners: {
      httpClients: true,
      routes: true,
      events: true,
      sharedTypes: true,
      envVars: true
    },
    httpClientPatterns: ['axios', 'fetch', 'ky', '$fetch'],
    routePatterns: ['express', 'fastify', 'hono', 'next-api'],
    ignoreEndpoints: ['/health', '/metrics', '/favicon.ico'],
    sharedPackages: [],
    maxFiles: 500
  },

  // --- Damage Control ---
  damageControl: {
    enabled: false,
    patternsFile: '.workflow/damage-control.yaml',
    events: { bash: true, file: true, stop: true, prompt: false },
    promptHook: { enabled: false },
    onBlock: 'error',
    onAsk: 'prompt',
    logging: true
  },

  // --- Multi-Approach ---
  multiApproach: { enabled: false },

  // --- Hooks ---
  hooks: {
    enabled: true,
    targets: ['claude-code'],
    gracefulDegradation: true,
    timeout: 600000,
    rules: {
      intelligence: {
        sessionContext: { enabled: true, loadSuspendedTasks: true, loadDecisions: true, loadRecentActivity: true },
        promptCapture: { enabled: true },
        correctionDetection: { enabled: true },
        validation: { enabled: true, runAfterEdit: true, afterTaskComplete: { enabled: false }, beforeCommit: { enabled: false } }
      },
      lifecycle: {
        taskCompleted: { enabled: true },
        completionSummaries: { enabled: true },
        autoLogging: { enabled: false },
        configChange: { enabled: false },
        setup: { enabled: true, autoOnboard: false, maintenanceTasks: ['healthCheck', 'cleanupLocks'] },
        sessionCleanup: { enabled: true },
        phaseGate: { enabled: true }
      }
    },
    claudeCode: { installPath: '.claude/settings.local.json' }
  },

  // --- Metrics ---
  metrics: { enabled: false },

  // --- Review ---
  review: {
    specFirstGating: true,
    minFindings: 3,
    requireJustificationIfClean: true,
    gitVerifiedClaims: { enabled: false },
    multiPass: { enabled: false },
    fix: {
      persistUnfixed: true,
      taskPrefix: 'wf-rv-',
      severityRouting: { criticalHighRoute: 'full', mediumLowRoute: 'light', securityAlwaysFlag: true },
      batchExecution: { groupBy: ['file', 'category'], sortBy: 'priority' },
      autoRecommendBatchThreshold: 10,
      contextBudget: {
        enabled: true, useSubAgents: true, subAgentContextBudget: 0.7,
        compactionBuffer: 0.15, orchestratorOverhead: 0.1,
        findingCosts: { critical: 0.05, high: 0.04, medium: 0.03, low: 0.02 },
        progressFile: '.workflow/state/review-fix-progress.json'
      }
    },
    peer: { enabled: false },
    triage: { enabled: false },
    agents: REVIEW_AGENTS
  },

  // --- Origin Task Tracing ---
  originTaskTracing: {
    enabled: false,
    annotateCompletedTasks: true,
    traceOrigin: true,
    sameSessionWindow: '2h',
    learningSignal: { enabled: false }
  },

  // --- Research ---
  research: {
    enabled: false,
    defaultDepth: 'standard',
    autoTrigger: true,
    requireVerificationFormat: true,
    mandatoryInExplorePhase: true,
    mandatoryForHistoryResearch: true,
    maxTokensPerDepth: { quick: 5000, standard: 20000, deep: 50000, exhaustive: 100000 },
    requireCitations: true,
    cacheVerifications: true,
    cacheExpiryHours: 24,
    cache: { enabled: false },
    budgetMode: 'soft',
    negativeEvidenceRule: true,
    assumptionTracking: true,
    planMode: {
      explorePhase: { enabled: false },
      researchAgents: {
        codebaseAnalyzer: { enabled: false },
        bestPractices: { enabled: false },
        versionVerifier: { enabled: false },
        riskHistory: { enabled: false },
        standardsPreview: { enabled: false }
      },
      researchDepth: 'thorough',
      deepenPromptThreshold: 'L1'
    },
    triggers: RESEARCH_TRIGGERS
  },

  // --- WebMCP ---
  webmcp: { enabled: false },

  // --- Decisions ---
  decisions: { amendmentTracking: { enabled: false } },

  // --- Community ---
  community: {
    enabled: false,
    anonymousId: null,
    categories: {
      modelIntelligence: true, errorRecovery: true,
      patternConvergence: true, sessionStatistics: true, skillLearnings: true
    },
    pushOnSessionEnd: true,
    pullOnSessionStart: true,
    cacheTtlHours: 24,
    serverUrl: 'https://api.wogiflow.com',
    sync: { enabled: false }
  },

  // --- Misc ---
  consistency: { enabled: false },
  audit: {
    agents: {
      architecture: true, dependencies: true, duplication: true,
      performance: true, consistency: true, modernization: true, techDebt: true
    },
    scoring: {
      enabled: true,
      weights: {
        architecture: 0.25, dependencies: 0.15, duplication: 0.15,
        performance: 0.15, consistency: 0.1, modernization: 0.1, techDebt: 0.1
      }
    },
    exclude: ['node_modules', '.workflow/state', 'dist', 'build'],
    maxFilesPerAgent: 100
  },
  plugins: {
    enabled: true,
    registryPath: '.workflow/state/plugin-registry.json',
    autoDiscoverMcp: true,
    autoScanOnSessionStart: true,
    webSearchFallback: true,
    trackPluginActions: true,
    phaseInjection: true,
    standaloneBypassTask: true
  },

  // --- Externalized Episodic Memory (epic-episodic-memory) ---
  // Default OFF until Wave E regression tests validate ≥30% token savings.
  // See .workflow/audits/state-coverage-2026-04-15.md for design rationale.
  externalMemory: {
    enabled: false,
    thresholds: {
      agentTokens: 2000,
      readLines: 200,
      bashLines: 100
    },
    retention: {
      compressDays: 7,
      evictDays: 30
    },
    exemptions: {
      pathGlobs: [
        '.claude/docs/phases/**',
        '.workflow/state/workflow-phase.json',
        '.workflow/state/task-checkpoint.json'
      ],
      tools: ['TodoWrite', 'Glob', 'Grep']
    },
    capture: {
      enabled: false,
      blockOnMiss: true,
      minLevel: 'L2'
    },
    telemetry: {
      enabled: true
    }
  },

  // --- Workflow Steps ---
  workflowSteps: WORKFLOW_STEP_DEFAULTS
};

// ============================================================
// Utility: Deep merge (defaults filled where user config is missing)
// ============================================================

/**
 * Check if a value is a plain object (not array, null, Date, etc.)
 */
function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

/**
 * Deep merge two objects. Values in `override` take precedence.
 * Arrays are NOT merged — override replaces entirely.
 */
function deepMerge(base, override) {
  const result = {};

  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(base, key)) continue;

    if (Object.hasOwn(override, key)) {
      if (isPlainObject(base[key]) && isPlainObject(override[key])) {
        result[key] = deepMerge(base[key], override[key]);
      } else {
        result[key] = override[key];
      }
    } else {
      result[key] = base[key];
    }
  }

  for (const key of Object.keys(override)) {
    if (!Object.hasOwn(override, key)) continue;
    if (!Object.hasOwn(result, key)) {
      result[key] = override[key];
    }
  }

  return result;
}

/**
 * Get default values for a specific config key path.
 */
function getDefaultsForKey(keyPath) {
  if (!keyPath || typeof keyPath !== 'string') return undefined;

  const parts = keyPath.split('.');
  let current = CONFIG_DEFAULTS;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (!Object.hasOwn(current, part)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Merge a user config with CONFIG_DEFAULTS.
 * User values override defaults; missing keys are filled from defaults.
 */
function mergeWithDefaults(userConfig) {
  if (!userConfig || typeof userConfig !== 'object') {
    return { ...CONFIG_DEFAULTS };
  }
  return deepMerge(CONFIG_DEFAULTS, userConfig);
}

/**
 * Compute the "lean" form of a config — the minimal object that, when passed
 * through mergeWithDefaults(), reproduces the input. Removes every key whose
 * value equals the default. Nested objects are diffed recursively; arrays and
 * primitives are compared by JSON equality.
 *
 * Always preserves these identity keys even if they match defaults:
 *   - `$schema`, `version`, `projectName`, `cli`, `_configVersion`
 * These anchor the file's purpose and let tooling (VS Code JSON schema, config
 * migrations) work correctly on the lean file.
 *
 * Round-trip guarantee:
 *   mergeWithDefaults(computeLeanConfig(full)) deep-equals mergeWithDefaults(full)
 * for any input — verified in tests.
 *
 * @param {Object} fullConfig - A fully-merged config (or any config object)
 * @returns {Object} Lean config containing only overrides + identity keys
 */
function computeLeanConfig(fullConfig) {
  if (!fullConfig || typeof fullConfig !== 'object') {
    return {};
  }
  const IDENTITY_KEYS = new Set(['$schema', 'version', 'projectName', 'cli', '_configVersion', 'projectType']);
  return diffAgainstDefaults(fullConfig, CONFIG_DEFAULTS, IDENTITY_KEYS, true);
}

function diffAgainstDefaults(user, defaults, identityKeys, isRoot) {
  const out = {};
  for (const key of Object.keys(user)) {
    const uVal = user[key];
    const dVal = defaults ? defaults[key] : undefined;

    // Preserve identity keys at the root regardless of equality.
    if (isRoot && identityKeys.has(key)) {
      out[key] = uVal;
      continue;
    }

    // Comment fields (prefix _comment) are metadata from the defaults file —
    // don't propagate into user configs, they bloat without adding meaning.
    if (typeof key === 'string' && key.startsWith('_comment')) {
      continue;
    }

    if (dVal === undefined) {
      // Key doesn't exist in defaults — it's fully user-defined, keep it.
      out[key] = uVal;
      continue;
    }

    if (isPlainObject(uVal) && isPlainObject(dVal)) {
      const nested = diffAgainstDefaults(uVal, dVal, identityKeys, false);
      if (Object.keys(nested).length > 0) {
        out[key] = nested;
      }
      continue;
    }

    // Primitive / array / null comparison via JSON stringify.
    if (JSON.stringify(uVal) !== JSON.stringify(dVal)) {
      out[key] = uVal;
    }
  }
  return out;
}

/**
 * Apply project-type-aware defaults to a config.
 * Strips/disables irrelevant sections based on detected project type.
 * Call AFTER mergeWithDefaults() and detection has populated testing.detected.
 *
 * @param {Object} config - Full merged config
 * @returns {Object} Config with project-type-aware adjustments
 */
function applyProjectTypeDefaults(config) {
  if (!config || typeof config !== 'object') return config;

  const detected = config.testing?.detected;
  if (!detected || !detected.projectType) return config;

  const { hasUI, hasAPI, projectType } = detected;

  // --- Adjust testing mode default ---
  if (config.testing?.mode === 'auto') {
    if (hasUI && !hasAPI) config.testing.mode = 'ui';
    else if (!hasUI && hasAPI) config.testing.mode = 'api';
    else if (hasUI && hasAPI) config.testing.mode = 'full';
  }

  // --- Disable irrelevant testing sections ---
  if (hasUI === false) {
    if (config.testing?.ui && !config.testing.ui._userSet) {
      config.testing.ui = { enabled: false };
    }
    if (config.testing?.qualityGates) {
      config.testing.qualityGates.uiVerification = false;
    }
  }

  if (hasAPI === false) {
    if (config.testing?.api && !config.testing.api._userSet) {
      config.testing.api = { enabled: false };
    }
    if (config.testing?.qualityGates) {
      config.testing.qualityGates.apiVerification = false;
    }
  }

  // --- Adjust top-level quality gates ---
  if (config.qualityGates?.feature?.require) {
    const featureGates = config.qualityGates.feature.require;
    if (hasUI === false) {
      const idx = featureGates.indexOf('uiVerification');
      if (idx !== -1) featureGates.splice(idx, 1);
    }
    if (hasAPI === false) {
      const idx = featureGates.indexOf('apiVerification');
      if (idx !== -1) featureGates.splice(idx, 1);
    }
  }

  return config;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  CONFIG_DEFAULTS,

  // Individual default sections (for direct import)
  FRAMEWORK_DETECTION_PATTERNS,
  OFFICIAL_DOCS_URLS,
  PHASE_DEFINITIONS,
  PRIORITY_LEVELS,
  CLASSIFICATION_KEYWORDS,
  CLOUD_PROVIDER_MODELS,
  REFACTOR_KEYWORDS,
  WORKFLOW_STEP_DEFAULTS,
  REVIEW_AGENTS,
  CONTEXT_SCORING_PRIORITIES,
  RESEARCH_TRIGGERS,

  // Functions
  deepMerge,
  isPlainObject,
  getDefaultsForKey,
  mergeWithDefaults,
  computeLeanConfig,
  applyProjectTypeDefaults
};
