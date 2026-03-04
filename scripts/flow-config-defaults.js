#!/usr/bin/env node

/**
 * Wogi Flow - Configuration Defaults
 *
 * Contains all static default values that never change per-project.
 * These were previously hardcoded inline in config.json, bloating it
 * with ~300 lines of data that no user would ever customize.
 *
 * Usage:
 *   const { CONFIG_DEFAULTS, getDefaultsForKey, mergeWithDefaults } = require('./flow-config-defaults');
 *
 *   // Get defaults for a specific config section
 *   const phases = getDefaultsForKey('phases.definitions');
 *
 *   // Merge user config with defaults (user values override)
 *   const fullConfig = mergeWithDefaults(userConfig);
 */

'use strict';

// ============================================================
// 1. Framework Detection Patterns
//    Used by: learning.skill.frameworkDetectionPatterns
// ============================================================

const FRAMEWORK_DETECTION_PATTERNS = {
  nestjs: [
    '*.module.ts',
    '*.controller.ts',
    '*.service.ts',
    '@nestjs/*'
  ],
  react: [
    '*.tsx',
    '*.jsx',
    'use*.ts',
    'react',
    'react-dom'
  ],
  vue: [
    '*.vue',
    'vue',
    '@vue/*'
  ],
  angular: [
    '*.component.ts',
    '*.module.ts',
    '@angular/*'
  ],
  fastapi: [
    'main.py',
    'fastapi',
    'pydantic'
  ],
  django: [
    'manage.py',
    'django',
    'settings.py'
  ],
  express: [
    'app.js',
    'express',
    'router.js'
  ]
};

// ============================================================
// 2. Official Docs URLs
//    Used by: learning.skill.officialDocsUrls
// ============================================================

const OFFICIAL_DOCS_URLS = {
  nestjs: 'https://docs.nestjs.com',
  react: 'https://react.dev',
  vue: 'https://vuejs.org/guide',
  angular: 'https://angular.io/docs',
  fastapi: 'https://fastapi.tiangolo.com',
  django: 'https://docs.djangoproject.com',
  express: 'https://expressjs.com/en/guide'
};

// ============================================================
// 3. Phase Definitions
//    Used by: phases.definitions
// ============================================================

const PHASE_DEFINITIONS = [
  {
    id: 'contract',
    name: 'Contract',
    description: 'Define interfaces, types, API contracts',
    focus: ['types', 'interfaces', 'contracts'],
    output: 'Type definitions and API contracts'
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    description: 'Create file structure, stub implementations',
    focus: ['structure', 'stubs', 'scaffolding'],
    output: 'File structure with stub implementations'
  },
  {
    id: 'core',
    name: 'Core Logic',
    description: 'Implement main business logic',
    focus: ['logic', 'implementation', 'happy-path'],
    output: 'Working happy-path implementation'
  },
  {
    id: 'edge-cases',
    name: 'Edge Cases',
    description: 'Handle edge cases and error states',
    focus: ['errors', 'edge-cases', 'validation'],
    output: 'Robust error handling'
  },
  {
    id: 'polish',
    name: 'Polish',
    description: 'Optimization, cleanup, documentation',
    focus: ['optimization', 'cleanup', 'docs'],
    output: 'Production-ready code'
  }
];

// ============================================================
// 4. Priority Level Definitions
//    Used by: priorities.levels
// ============================================================

const PRIORITY_LEVELS = {
  P0: {
    label: 'Critical',
    description: 'Drop everything'
  },
  P1: {
    label: 'High',
    description: 'Do today'
  },
  P2: {
    label: 'Medium',
    description: 'Do this week'
  },
  P3: {
    label: 'Low',
    description: 'Do when possible'
  },
  P4: {
    label: 'Backlog',
    description: 'Someday'
  }
};

// ============================================================
// 5. Story Classification Keywords
//    Used by: storyDecomposition.classification.keywords
// ============================================================

const CLASSIFICATION_KEYWORDS = {
  epic: [
    'system',
    'architecture',
    'migration',
    'redesign',
    'platform',
    'infrastructure',
    'overhaul'
  ],
  story: [
    'feature',
    'flow',
    'integration',
    'module',
    'workflow',
    'implement'
  ],
  task: [
    'add',
    'fix',
    'update',
    'change',
    'remove',
    'button',
    'field',
    'tweak'
  ]
};

// ============================================================
// 6. Cloud Provider Model Lists
//    Used by: models.hybrid.cloudProviders
// ============================================================

const CLOUD_PROVIDER_MODELS = {
  openai: {
    models: ['gpt-4o-mini', 'gpt-4o'],
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY'
  },
  anthropic: {
    models: ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307'],
    defaultModel: 'claude-3-5-haiku-latest',
    envKey: 'ANTHROPIC_API_KEY'
  },
  google: {
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash-exp',
    envKey: 'GOOGLE_API_KEY'
  }
};

// ============================================================
// 7. Smart Compaction Refactor Keywords
//    Used by: context.smart.refactorKeywords
// ============================================================

const REFACTOR_KEYWORDS = [
  'refactor',
  'migration',
  'overhaul',
  'redesign',
  'rewrite',
  'restructure',
  'rearchitect'
];

// ============================================================
// 8. Workflow Step Defaults
//    Used by: workflowSteps.*
// ============================================================

const WORKFLOW_STEP_DEFAULTS = {
  regressionTest: {
    enabled: false,
    mode: 'warn',
    when: 'afterTask'
  },
  securityScan: {
    enabled: false,
    mode: 'block',
    when: 'beforeCommit',
    config: {
      severity: 'high'
    }
  },
  updateKnowledgeBase: {
    enabled: false,
    mode: 'prompt',
    when: 'afterTask'
  },
  updateChangelog: {
    enabled: false,
    mode: 'prompt',
    when: 'beforeCommit'
  },
  codeComplexityCheck: {
    enabled: false,
    mode: 'warn',
    when: 'afterTask',
    config: {
      threshold: 10
    }
  },
  coverageCheck: {
    enabled: false,
    mode: 'warn',
    when: 'beforeCommit',
    config: {
      minCoverage: 80
    }
  },
  codeSimplifier: {
    enabled: false,
    mode: 'prompt',
    when: 'afterTask',
    config: {
      maxFunctionLines: 50,
      maxNestingDepth: 3,
      suggestExtraction: true,
      requireVerificationAfterApply: true
    }
  },
  codeReview: {
    enabled: false,
    mode: 'warn',
    when: 'afterTask',
    config: {
      multiAgentThreshold: 5,
      highRiskPatterns: ['auth', 'payment', 'security', 'crypto'],
      confidenceThreshold: 80
    }
  },
  prTestAnalyzer: {
    enabled: false,
    mode: 'warn',
    when: 'beforeCommit',
    config: {
      checkCoverage: true,
      checkQuality: true,
      minCoverageForModified: 70
    }
  },
  silentFailureHunter: {
    enabled: false,
    mode: 'warn',
    when: 'afterTask',
    config: {
      checkEmptyCatch: true,
      checkLogOnlyCatch: true,
      checkUnhandledAsync: true,
      checkPromiseChains: true
    }
  },
  commentAnalyzer: {
    enabled: false,
    mode: 'warn',
    when: 'afterTask',
    config: {
      flagTodo: true,
      flagFixme: true,
      checkJsdoc: true,
      flagCommentedCode: true,
      flagStale: true
    }
  }
};

// ============================================================
// 9. Review Agents
//    Used by: review.agents
// ============================================================

const REVIEW_AGENTS = {
  core: ['code-logic', 'security', 'architecture'],
  optional: ['performance'],
  projectRules: true,
  projectRulesSource: 'decisions.md',
  maxParallelAgents: 6
};

// ============================================================
// 10. Context Scoring Priorities
//     Used by: context.scoring.priorities
// ============================================================

const CONTEXT_SCORING_PRIORITIES = {
  required_types: 1,
  target_file: 0.95,
  error_context: 0.93,
  direct_imports: 0.9,
  interface_definitions: 0.88,
  api_contracts: 0.85,
  related_imports: 0.8,
  test_files: 0.75,
  patterns: 0.7,
  similar_implementations: 0.65,
  documentation: 0.5,
  examples: 0.45,
  config_files: 0.4,
  full_files: 0.3
};

// ============================================================
// 11. Research Triggers
//     Used by: research.triggers
// ============================================================

const RESEARCH_TRIGGERS = {
  feasibilityQuestions: 'deep',
  capabilityQuestions: 'standard',
  existenceQuestions: 'standard',
  architectureQuestions: 'deep',
  integrationQuestions: 'standard'
};

// ============================================================
// Full CONFIG_DEFAULTS object
//
// Mirrors the config.json structure so mergeWithDefaults can
// deep-merge defaults into a user config.
// ============================================================

const CONFIG_DEFAULTS = {
  learning: {
    skill: {
      frameworkDetectionPatterns: FRAMEWORK_DETECTION_PATTERNS,
      officialDocsUrls: OFFICIAL_DOCS_URLS
    }
  },
  phases: {
    definitions: PHASE_DEFINITIONS
  },
  priorities: {
    levels: PRIORITY_LEVELS
  },
  storyDecomposition: {
    classification: {
      keywords: CLASSIFICATION_KEYWORDS
    }
  },
  models: {
    hybrid: {
      cloudProviders: CLOUD_PROVIDER_MODELS
    }
  },
  context: {
    smart: {
      refactorKeywords: REFACTOR_KEYWORDS
    },
    scoring: {
      priorities: CONTEXT_SCORING_PRIORITIES
    }
  },
  workflowSteps: WORKFLOW_STEP_DEFAULTS,
  review: {
    agents: REVIEW_AGENTS
  },
  research: {
    triggers: RESEARCH_TRIGGERS
  }
};

// ============================================================
// Utility: Deep merge (defaults filled where user config is missing)
// ============================================================

/**
 * Check if a value is a plain object (not array, null, Date, etc.)
 * @param {*} val
 * @returns {boolean}
 */
function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

/**
 * Deep merge two objects. Values in `override` take precedence.
 * Arrays are NOT merged — override replaces entirely.
 *
 * @param {Object} base - The defaults (base values)
 * @param {Object} override - The user config (takes precedence)
 * @returns {Object} Merged result (new object, inputs not mutated)
 */
function deepMerge(base, override) {
  const result = {};

  // Start with all keys from base
  for (const key of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;

    if (Object.prototype.hasOwnProperty.call(override, key)) {
      // Both have the key — decide how to merge
      if (isPlainObject(base[key]) && isPlainObject(override[key])) {
        result[key] = deepMerge(base[key], override[key]);
      } else {
        // Override wins for primitives, arrays, and non-object types
        result[key] = override[key];
      }
    } else {
      // Only in base — use default
      result[key] = base[key];
    }
  }

  // Add keys that only exist in override (user-specific config)
  for (const key of Object.keys(override)) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = override[key];
    }
  }

  return result;
}

/**
 * Get default values for a specific config key path.
 *
 * @param {string} keyPath - Dot-separated path (e.g., 'phases.definitions', 'learning.skill.frameworkDetectionPatterns')
 * @returns {*} The default value at that path, or undefined if not found
 *
 * @example
 *   getDefaultsForKey('phases.definitions')
 *   // => [{ id: 'contract', ... }, { id: 'skeleton', ... }, ...]
 *
 *   getDefaultsForKey('priorities.levels.P0')
 *   // => { label: 'Critical', description: 'Drop everything' }
 */
function getDefaultsForKey(keyPath) {
  if (!keyPath || typeof keyPath !== 'string') return undefined;

  const parts = keyPath.split('.');
  let current = CONFIG_DEFAULTS;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Merge a user config with CONFIG_DEFAULTS.
 * User values override defaults; missing keys are filled from defaults.
 *
 * @param {Object} userConfig - The user's config.json (parsed)
 * @returns {Object} Full config with all defaults filled in
 *
 * @example
 *   const stripped = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
 *   const full = mergeWithDefaults(stripped);
 *   // full.phases.definitions is populated even if stripped config omitted it
 */
function mergeWithDefaults(userConfig) {
  if (!userConfig || typeof userConfig !== 'object') {
    return { ...CONFIG_DEFAULTS };
  }
  return deepMerge(CONFIG_DEFAULTS, userConfig);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Full defaults object matching config structure
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
  getDefaultsForKey,
  mergeWithDefaults
};
