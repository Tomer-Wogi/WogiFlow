#!/usr/bin/env node

/**
 * Wogi Flow - Dynamic Context Gatherer
 *
 * Intelligently gathers context for tasks based on:
 * - Task description analysis
 * - Section-level references (not full files)
 * - Model context preferences
 * - Token budget optimization
 *
 * Replaces hardcoded limits with dynamic, quality-aware selection.
 *
 * Part of Smart Context System (Phase 2)
 *
 * Usage:
 *   const { gatherContext } = require('./flow-context-gatherer');
 *
 *   const context = await gatherContext({
 *     task: 'Add user authentication',
 *     model: 'claude-sonnet-4',
 *     maxTokens: 50000
 *   });
 */

const fs = require('fs');
const path = require('path');

const {
  PATHS,
  getConfig,
  fileExists,
  readFile,
  estimateTokens,
  info,
  warn,
  success
} = require('./flow-utils');

const {
  getSectionsForTask,
  getSecuritySections,
  getComponentSections,
  getNamingConventionSections,
  formatSectionsAsContext,
  ensureIndex
} = require('./flow-section-resolver');

// Use model preferences from instruction-richness (single source of truth)
const { getModelContextPreferences } = require('./flow-instruction-richness');

// ============================================================
// Configuration
// ============================================================

/**
 * Default context gathering configuration
 */
const DEFAULT_CONFIG = {
  strategy: 'dynamic',       // 'dynamic' | 'fixed'
  maxContextTokens: 100000,
  reserveOutputTokens: 8000,
  minRelevanceScore: 0.1,
  fallbackToFullContext: true,
  includeContent: true,
  useSectionReferences: true,
  fallbackLimits: {
    maxFilesHard: 50,
    maxTokensHard: 150000
  },
  // Maximum budget overflow allowed for forced includes (10%)
  maxBudgetOverflow: 0.1
};

/**
 * Context type priorities
 */
const CONTEXT_PRIORITIES = {
  security_rules: 1.0,
  required_patterns: 0.95,
  target_sections: 0.90,
  component_rules: 0.85,
  naming_conventions: 0.80,
  related_sections: 0.70,
  general_patterns: 0.60
};

// ============================================================
// Configuration Loading
// ============================================================

/**
 * Get context gathering configuration
 */
function getContextConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONFIG,
    ...(config.autoContext || {})
  };
}

/**
 * Get model context preferences
 * Uses the single source of truth from flow-instruction-richness.js
 * @param {string} modelName - Model name
 * @returns {Object} - Context preferences for the model
 */
function getModelPreferences(modelName) {
  return getModelContextPreferences(modelName);
}

// ============================================================
// Task Analysis
// ============================================================

/**
 * Analyze task to determine context requirements
 * @param {string} taskDescription - Task description
 * @returns {Object} - Task analysis
 */
function analyzeTask(taskDescription) {
  const descLower = taskDescription.toLowerCase();

  const analysis = {
    needsSecurityContext: false,
    needsComponentContext: false,
    needsNamingContext: false,
    needsAPIContext: false,
    needsFileContext: false,
    complexity: 'medium',
    estimatedContextNeeds: 'standard'
  };

  // Security keywords
  if (/security|auth|password|token|encrypt|validate|sanitize|injection/i.test(descLower)) {
    analysis.needsSecurityContext = true;
    analysis.estimatedContextNeeds = 'high';
  }

  // Component keywords
  if (/component|button|input|form|modal|dialog|ui|widget|screen/i.test(descLower)) {
    analysis.needsComponentContext = true;
  }

  // Naming/style keywords
  if (/name|rename|naming|convention|style|format|file/i.test(descLower)) {
    analysis.needsNamingContext = true;
  }

  // API keywords
  if (/api|endpoint|route|controller|service|request|response/i.test(descLower)) {
    analysis.needsAPIContext = true;
    analysis.estimatedContextNeeds = 'high';
  }

  // File operation keywords
  if (/file|read|write|fs|path|directory/i.test(descLower)) {
    analysis.needsFileContext = true;
    analysis.needsSecurityContext = true; // File ops need security rules
  }

  // Complexity estimation
  const wordCount = taskDescription.split(/\s+/).length;
  if (wordCount < 10) {
    analysis.complexity = 'small';
    analysis.estimatedContextNeeds = 'minimal';
  } else if (wordCount > 50) {
    analysis.complexity = 'large';
    analysis.estimatedContextNeeds = 'high';
  }

  return analysis;
}

// ============================================================
// Context Gathering
// ============================================================

/**
 * Gather all potentially relevant sections for a task
 * @param {string} taskDescription - Task description
 * @param {Object} taskAnalysis - Task analysis from analyzeTask()
 * @returns {Object[]} - All relevant sections with priorities
 */
async function gatherAllSections(taskDescription, taskAnalysis) {
  const sections = [];

  // Ensure index is up to date
  await ensureIndex();

  // 1. Get sections directly matching task description
  const taskSections = await getSectionsForTask(taskDescription, {
    limit: 10,
    minScore: 0.05
  });

  for (const section of taskSections) {
    sections.push({
      ...section,
      priority: CONTEXT_PRIORITIES.target_sections,
      reason: 'Matches task description'
    });
  }

  // 2. Add security sections if needed
  if (taskAnalysis.needsSecurityContext) {
    const securitySections = await getSecuritySections();
    for (const section of securitySections) {
      if (!sections.find(s => s.id === section.id)) {
        sections.push({
          ...section,
          priority: CONTEXT_PRIORITIES.security_rules,
          reason: 'Task involves security-sensitive operations'
        });
      }
    }
  }

  // 3. Add component sections if needed
  if (taskAnalysis.needsComponentContext) {
    const componentSections = await getComponentSections();
    for (const section of componentSections) {
      if (!sections.find(s => s.id === section.id)) {
        sections.push({
          ...section,
          priority: CONTEXT_PRIORITIES.component_rules,
          reason: 'Task involves UI components'
        });
      }
    }
  }

  // 4. Add naming convention sections if needed
  if (taskAnalysis.needsNamingContext) {
    const namingSections = await getNamingConventionSections();
    for (const section of namingSections) {
      if (!sections.find(s => s.id === section.id)) {
        sections.push({
          ...section,
          priority: CONTEXT_PRIORITIES.naming_conventions,
          reason: 'Task involves naming/style'
        });
      }
    }
  }

  return sections;
}

/**
 * Score and rank sections for inclusion
 * @param {Object[]} sections - Sections to score
 * @param {Object} taskAnalysis - Task analysis
 * @param {Object} modelPrefs - Model preferences
 * @returns {Object[]} - Scored and sorted sections
 */
function scoreSections(sections, taskAnalysis, modelPrefs) {
  return sections.map(section => {
    let score = section.priority || 0.5;

    // Boost based on match score from section resolver
    if (section.score) {
      score = score * 0.7 + section.score * 0.3;
    }

    // Boost security sections for security-sensitive tasks
    if (taskAnalysis.needsSecurityContext && section.category?.includes('Security')) {
      score *= 1.2;
    }

    // Model-specific adjustments
    if (modelPrefs.density === 'concise' && section.content?.length > 1000) {
      score *= 0.8; // Prefer shorter sections for concise models
    }
    if (modelPrefs.density === 'comprehensive') {
      score *= 1.1; // Include more for comprehensive models
    }

    return {
      ...section,
      finalScore: Math.min(score, 1.0)
    };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

/**
 * Fit sections within token budget
 * @param {Object[]} scoredSections - Scored sections
 * @param {number} tokenBudget - Available tokens
 * @param {Object} modelPrefs - Model preferences
 * @returns {Object} - { selected, excluded, totalTokens }
 */
function fitWithinBudget(scoredSections, tokenBudget, modelPrefs) {
  const selected = [];
  const excluded = [];
  let totalTokens = 0;

  // Reserve minimum context for quality
  const minBudget = tokenBudget * modelPrefs.minContextForQuality;

  // Hard ceiling to prevent budget overflow (configured max overflow, default 10%)
  const config = getContextConfig();
  const maxOverflow = config.maxBudgetOverflow || 0.1;
  const hardCeiling = tokenBudget * (1 + maxOverflow);

  for (const section of scoredSections) {
    const sectionTokens = estimateTokens(section.content || '');

    if (totalTokens + sectionTokens <= tokenBudget) {
      selected.push({
        ...section,
        tokens: sectionTokens
      });
      totalTokens += sectionTokens;
    } else if (totalTokens < minBudget && totalTokens + sectionTokens <= hardCeiling) {
      // Force include if below minimum quality threshold, but respect hard ceiling
      selected.push({
        ...section,
        tokens: sectionTokens,
        forcedInclude: true
      });
      totalTokens += sectionTokens;
    } else {
      excluded.push({
        ...section,
        tokens: sectionTokens,
        reason: totalTokens >= hardCeiling ? 'Hard ceiling exceeded' : 'Token budget exceeded'
      });
    }
  }

  return {
    selected,
    excluded,
    totalTokens,
    budgetUsed: totalTokens / tokenBudget
  };
}

// ============================================================
// Main API
// ============================================================

/**
 * Gather context for a task
 * @param {Object} params - { task, model, maxTokens, format }
 * @returns {Object} - { context, sections, stats }
 */
async function gatherContext(params) {
  const {
    task,
    model = 'claude-sonnet-4',
    maxTokens = null,
    format = 'full'  // 'full' | 'summary' | 'reference'
  } = params;

  const config = getContextConfig();
  const modelPrefs = getModelPreferences(model);

  // Calculate token budget
  const tokenBudget = maxTokens || (config.maxContextTokens - config.reserveOutputTokens);

  // Analyze task
  const taskAnalysis = analyzeTask(task);

  // Gather all potentially relevant sections
  const allSections = await gatherAllSections(task, taskAnalysis);

  // Score and rank
  const scoredSections = scoreSections(allSections, taskAnalysis, modelPrefs);

  // Fit within budget
  const budgetResult = fitWithinBudget(scoredSections, tokenBudget, modelPrefs);

  // Format sections as context
  const context = formatSectionsAsContext(budgetResult.selected, { format });

  // Build stats
  const stats = {
    taskAnalysis,
    model,
    modelPrefs: {
      density: modelPrefs.density,
      minContextForQuality: modelPrefs.minContextForQuality
    },
    tokenBudget,
    totalSectionsConsidered: allSections.length,
    sectionsIncluded: budgetResult.selected.length,
    sectionsExcluded: budgetResult.excluded.length,
    totalTokens: budgetResult.totalTokens,
    budgetUsed: `${(budgetResult.budgetUsed * 100).toFixed(1)}%`
  };

  return {
    context,
    sections: budgetResult.selected,
    excluded: budgetResult.excluded,
    stats
  };
}

/**
 * Quick gather - get minimal context for simple tasks
 * @param {string} task - Task description
 * @returns {string} - Context string
 */
async function quickGather(task) {
  const result = await gatherContext({
    task,
    model: 'claude-opus-4-5',
    maxTokens: 10000,
    format: 'summary'
  });
  return result.context;
}

/**
 * Full gather - get comprehensive context
 * @param {string} task - Task description
 * @param {string} model - Model name
 * @returns {Object} - Full result with sections and stats
 */
async function fullGather(task, model = 'claude-sonnet-4') {
  return await gatherContext({
    task,
    model,
    format: 'full'
  });
}

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const taskDesc = args.join(' ');

  if (!taskDesc) {
    console.log(`
Usage: node scripts/flow-context-gatherer.js "<task description>"

Options (via environment):
  MODEL=<model>    Model to optimize for (default: claude-sonnet-4)
  TOKENS=<n>       Max tokens to use (default: 92000)
  FORMAT=<fmt>     Output format: full, summary, reference (default: full)

Examples:
  node scripts/flow-context-gatherer.js "Add user authentication"
  MODEL=claude-opus-4-5 node scripts/flow-context-gatherer.js "Fix security bug"
`);
    process.exit(0);
  }

  const model = process.env.MODEL || 'claude-sonnet-4';
  const maxTokens = parseInt(process.env.TOKENS) || null;
  const format = process.env.FORMAT || 'full';

  info(`Gathering context for: "${taskDesc}"`);
  info(`Model: ${model}`);

  const result = await gatherContext({
    task: taskDesc,
    model,
    maxTokens,
    format
  });

  console.log('\n--- STATS ---');
  console.log(JSON.stringify(result.stats, null, 2));

  console.log('\n--- INCLUDED SECTIONS ---');
  for (const section of result.sections) {
    console.log(`  ${section.id} (score: ${section.finalScore?.toFixed(2)}, tokens: ${section.tokens})`);
  }

  if (result.excluded.length > 0) {
    console.log('\n--- EXCLUDED SECTIONS ---');
    for (const section of result.excluded.slice(0, 5)) {
      console.log(`  ${section.id} (reason: ${section.reason})`);
    }
    if (result.excluded.length > 5) {
      console.log(`  ... and ${result.excluded.length - 5} more`);
    }
  }

  console.log('\n--- CONTEXT ---');
  console.log(result.context);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Main API
  gatherContext,
  quickGather,
  fullGather,

  // Utilities
  analyzeTask,
  gatherAllSections,
  scoreSections,
  fitWithinBudget,

  // Configuration
  getContextConfig,
  getModelPreferences,

  // Constants
  CONTEXT_PRIORITIES,
  DEFAULT_CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
