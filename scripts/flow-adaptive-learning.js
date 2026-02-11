#!/usr/bin/env node

/**
 * Wogi Flow - Adaptive Learning for Hybrid Mode
 *
 * When a task fails with an executor model, this module:
 * 1. Analyzes WHY it failed
 * 2. Refines the prompt based on the failure
 * 3. Tracks what refinements were needed
 * 4. On success, updates the model adapter with learnings
 *
 * This creates a feedback loop that improves prompts over time.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getProjectRoot, colors } = require('./flow-utils');
const { storeSingleLearning, getAdapterPath } = require('./flow-model-adapter');
const {
  FailureCategory,
  detectCategory,
  shouldEscalate: checkShouldEscalate
} = require('../.workflow/lib/failure-categories');
const { validateRepoFormat, safeGitCommand, sanitizeCommitMessage } = require('./flow-security');

const PROJECT_ROOT = getProjectRoot();
const LEARNING_LOG_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'adaptive-learning.json');
const STRATEGY_STATS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'strategy-effectiveness.json');

// ============================================================
// Failure Analysis
// ============================================================

/**
 * Error categories with detection patterns and fix strategies
 * Now uses centralized FailureCategory from .workflow/lib/failure-categories.js
 *
 * Legacy mapping for backward compatibility - maps to centralized categories
 */
const ERROR_CATEGORIES = {
  IMPORT_ERROR: FailureCategory.IMPORT_ERROR,
  TYPE_ERROR: FailureCategory.TYPE_ERROR,
  SYNTAX_ERROR: FailureCategory.SYNTAX_ERROR,
  MARKDOWN_POLLUTION: FailureCategory.MARKDOWN_POLLUTION,
  INCOMPLETE_OUTPUT: FailureCategory.INCOMPLETE_OUTPUT,
  HALLUCINATION: FailureCategory.HALLUCINATION,
  // Additional categories from centralized module
  PARSE_ERROR: FailureCategory.PARSE_ERROR,
  RUNTIME_ERROR: FailureCategory.RUNTIME_ERROR,
  RATE_LIMIT: FailureCategory.RATE_LIMIT,
  API_ERROR: FailureCategory.API_ERROR,
  CONTEXT_OVERFLOW: FailureCategory.CONTEXT_OVERFLOW,
  CAPABILITY_MISMATCH: FailureCategory.CAPABILITY_MISMATCH,
  MISSING_CONTEXT: FailureCategory.MISSING_CONTEXT,
  PATTERN_VIOLATION: FailureCategory.PATTERN_VIOLATION,
  UNKNOWN: FailureCategory.UNKNOWN
};

/**
 * Analyze a failure and categorize it
 * Uses centralized detectCategory for consistent categorization
 * @param {string} error - Error message or output
 * @param {string} output - Model's output
 * @param {object} context - Task context
 * @returns {object} Failure analysis
 */
function analyzeFailure(error, output, context = {}) {
  const errorStr = String(error);
  const outputStr = String(output || '');

  // Use centralized detection
  const detection = detectCategory(errorStr, outputStr);

  const analysis = {
    timestamp: new Date().toISOString(),
    categories: detection.all.map(match => ({
      category: match.category,
      strategy: match.strategy,
      description: match.description,
      severity: match.severity,
      escalate: match.escalate,
      matchedPattern: match.matchedPattern
    })),
    primaryCategory: detection.primary.category,
    strategy: detection.primary.strategy,
    severity: detection.primary.severity,
    shouldEscalate: detection.shouldEscalate,
    details: {},
    rawError: errorStr.slice(0, 500),
    outputSample: outputStr.slice(0, 300)
  };

  // Extract specific details based on category
  analysis.details = extractErrorDetails(errorStr, analysis.primaryCategory);

  return analysis;
}

/**
 * Extract specific details from error based on category
 */
function extractErrorDetails(error, category) {
  const details = {};

  switch (category) {
    case 'IMPORT_ERROR': {
      // Extract module name
      const moduleMatch = error.match(/(?:module|from) ['"]([^'"]+)['"]/i);
      if (moduleMatch) details.moduleName = moduleMatch[1];

      // Extract export name
      const exportMatch = error.match(/(?:member|export) ['"]?(\w+)['"]?/i);
      if (exportMatch) details.exportName = exportMatch[1];
      break;
    }
    case 'TYPE_ERROR': {
      // Extract type names
      const typeMatch = error.match(/type ['"]?([^'"]+)['"]? is not assignable to ['"]?([^'"]+)['"]?/i);
      if (typeMatch) {
        details.actualType = typeMatch[1];
        details.expectedType = typeMatch[2];
      }

      // Extract property name
      const propMatch = error.match(/property ['"]?(\w+)['"]?/i);
      if (propMatch) details.propertyName = propMatch[1];
      break;
    }
    case 'SYNTAX_ERROR': {
      // Extract line number if present
      const lineMatch = error.match(/line (\d+)/i);
      if (lineMatch) details.line = parseInt(lineMatch[1]);
      break;
    }
  }

  return details;
}

// ============================================================
// Prompt Refinement
// ============================================================

/**
 * Refinement strategies for different error types
 */
const REFINEMENT_STRATEGIES = {
  import_fix: {
    prefix: `CRITICAL: Your previous output had IMPORT ERRORS.
Pay close attention to the "Available Imports" section below.
Use EXACT import paths and export names as shown.
Do NOT guess or create new import paths.`,
    suffix: `Remember: Use ONLY imports from the "Available Imports" section. Copy them exactly.`
  },

  type_fix: {
    prefix: `CRITICAL: Your previous output had TYPE ERRORS.
Pay close attention to the type definitions provided.
Match prop types EXACTLY as defined.
Do NOT add optional properties that aren't in the type.`,
    suffix: `Remember: Match types exactly. If unsure, use the simplest valid type.`
  },

  syntax_fix: {
    prefix: `CRITICAL: Your previous output had SYNTAX ERRORS.
Output ONLY valid TypeScript/JavaScript code.
NO markdown fences. NO explanatory text. NO preamble.
Start directly with the code (import statements or first line of code).`,
    suffix: `Remember: Pure code only. The output will be saved directly to a file.`
  },

  format_fix: {
    prefix: `CRITICAL: Your previous output included MARKDOWN or EXPLANATIONS.
Output ONLY the raw code. NO markdown fences (\`\`\`).
NO "Here's the code" text. NO explanations before or after.
Start IMMEDIATELY with the first line of code.`,
    suffix: `CRITICAL: Start your response with actual code (import or first statement). Nothing else.`
  },

  completion_fix: {
    prefix: `CRITICAL: Your previous output was INCOMPLETE.
You MUST output the COMPLETE file content.
Do NOT use "..." or "// rest of code" placeholders.
Do NOT truncate. Include EVERY line.`,
    suffix: `Remember: Complete code only. No placeholders, no truncation.`
  },

  context_fix: {
    prefix: `CRITICAL: Your previous output referenced NON-EXISTENT code.
Use ONLY components, hooks, and utilities that exist in the project.
Check the "Available Components" and "Available Imports" sections.
Do NOT invent or hallucinate imports or function names.`,
    suffix: `Remember: Only use what's explicitly listed in the context. When unsure, keep it simple.`
  },

  generic_fix: {
    prefix: `CRITICAL: Your previous attempt failed. Please try again more carefully.
Follow the instructions exactly. Output only what is requested.`,
    suffix: `Take your time and ensure the output is correct.`
  },

  // Additional strategies for new centralized categories
  wait_retry: {
    prefix: `NOTE: The previous attempt encountered a temporary issue (rate limit or timeout).
This is a retry - the same approach should work.`,
    suffix: `Proceed normally - the temporary issue should be resolved.`
  },

  retry: {
    prefix: `NOTE: The previous attempt failed due to a transient error.
Please try again with the same approach.`,
    suffix: `This should work on retry.`
  },

  context_reduction: {
    prefix: `CRITICAL: Your previous output exceeded context limits.
Please provide a MORE CONCISE response.
Focus only on the essential code - no explanations.
If the task is complex, break it into smaller parts.`,
    suffix: `Keep your response as short as possible while still being complete.`
  },

  escalate: {
    prefix: `NOTE: This task requires capabilities that may need escalation to a more advanced model.
Please attempt the task anyway.`,
    suffix: `If unable to complete, indicate what capability is missing.`
  },

  context_load: {
    prefix: `CRITICAL: Your previous attempt was missing necessary context.
The required components/files are now provided below.
Use ONLY what is explicitly available.`,
    suffix: `Remember: Use the context provided, don't assume or invent.`
  },

  clarify: {
    prefix: `NOTE: The requirements were unclear in the previous attempt.
Please focus on the CORE functionality described.
If unsure, implement the simplest interpretation.`,
    suffix: `When in doubt, keep it simple and focused on the main requirement.`
  },

  pattern_fix: {
    prefix: `CRITICAL: Your previous output didn't follow project patterns.
Review the patterns and conventions described below.
Match the existing code style exactly.`,
    suffix: `Remember: Follow project conventions - check naming, structure, and patterns.`
  }
};

/**
 * Refine prompt based on failure analysis
 * @param {string} originalPrompt - Original prompt
 * @param {object} failure - Failure analysis from analyzeFailure()
 * @param {array} previousAttempts - Previous failure analyses
 * @returns {object} Refined prompt and metadata
 */
function refinePromptForRetry(originalPrompt, failure, previousAttempts = []) {
  const strategy = failure.strategy || 'generic_fix';
  const refinements = REFINEMENT_STRATEGIES[strategy] || REFINEMENT_STRATEGIES.generic_fix;

  // Build refinement context
  let refinementContext = '';

  // Add specific error details
  if (failure.details && Object.keys(failure.details).length > 0) {
    refinementContext += '\n\nSPECIFIC ISSUE:\n';
    for (const [key, value] of Object.entries(failure.details)) {
      refinementContext += `- ${key}: ${value}\n`;
    }
  }

  // Add learnings from previous attempts
  if (previousAttempts.length > 0) {
    refinementContext += '\n\nPREVIOUS ERRORS TO AVOID:\n';
    const uniqueCategories = [...new Set(previousAttempts.map(a => a.primaryCategory))];
    for (const cat of uniqueCategories) {
      const catConfig = ERROR_CATEGORIES[cat];
      if (catConfig) {
        refinementContext += `- ${catConfig.description}\n`;
      }
    }
  }

  // Construct refined prompt
  const refinedPrompt = `${refinements.prefix}
${refinementContext}
---

${originalPrompt}

---
${refinements.suffix}`;

  return {
    prompt: refinedPrompt,
    strategy,
    addedInstructions: {
      prefix: refinements.prefix,
      suffix: refinements.suffix,
      context: refinementContext
    },
    attemptNumber: previousAttempts.length + 2 // +2 because first attempt was 1
  };
}

// ============================================================
// Success Recording
// ============================================================

/**
 * Record a successful recovery to the model adapter
 * @param {string} modelName - Model identifier
 * @param {array} failures - Array of failure analyses that led to success
 * @param {object} successContext - What finally worked
 */
function recordSuccessfulRecovery(modelName, failures, successContext = {}) {
  if (!failures || failures.length === 0) return;

  // Track strategy effectiveness for all strategies used
  const strategiesUsed = [...new Set(failures.map(f => f.strategy))];
  for (const strategy of strategiesUsed) {
    trackStrategyEffectiveness(modelName, strategy, true);
  }

  // Group failures by category
  const categoryCounts = {};
  for (const failure of failures) {
    const cat = failure.primaryCategory;
    if (!categoryCounts[cat]) {
      categoryCounts[cat] = { count: 0, details: [], strategy: failure.strategy };
    }
    categoryCounts[cat].count++;
    if (failure.details && Object.keys(failure.details).length > 0) {
      categoryCounts[cat].details.push(failure.details);
    }
  }

  // Generate learning entry (with deduplication)
  const learnings = [];
  const date = new Date().toISOString().split('T')[0];
  let newLearningsCount = 0;

  for (const [category, data] of Object.entries(categoryCounts)) {
    const config = ERROR_CATEGORIES[category];
    if (!config) continue;

    // Skip if we already have a recent learning for this category
    if (isDuplicateLearning(modelName, category, data.details)) {
      continue;
    }

    newLearningsCount++;
    learnings.push(`### ${date} - Learned from ${data.count} ${category} failures`);
    learnings.push('');
    learnings.push(`**Issue**: ${config.description}`);
    learnings.push(`**Strategy**: ${config.strategy}`);

    // Add specific guidance based on category
    const guidance = generateGuidanceFromFailures(category, data.details);
    if (guidance) {
      learnings.push(`**Do**: ${guidance.do}`);
      learnings.push(`**Don't**: ${guidance.dont}`);
    }

    learnings.push('');
  }

  // Always log to adaptive learning log (for stats)
  logLearning(modelName, failures, successContext);

  if (learnings.length > 0) {
    // Add to model adapter file
    const learningText = learnings.join('\n');
    storeSingleLearning(modelName, learningText, {
      taskId: successContext.taskId || 'adaptive-recovery',
      trigger: 'adaptive-learning',
      sourceContext: `Recovered after ${failures.length} failures`
    });

    console.log(`${colors.green}   ✅ ${newLearningsCount} new learning(s) recorded to ${modelName} adapter${colors.reset}`);
  } else {
    console.log(`${colors.dim}   ℹ️  No new learnings (duplicates skipped)${colors.reset}`);
  }
}

/**
 * Generate specific do/don't guidance from failure details
 */
function generateGuidanceFromFailures(category, details) {
  switch (category) {
    case 'IMPORT_ERROR': {
      const modules = details.map(d => d.moduleName).filter(Boolean);
      const exports = details.map(d => d.exportName).filter(Boolean);
      return {
        do: 'Copy import paths exactly from the "Available Imports" section',
        dont: modules.length > 0
          ? `Don't use these incorrect paths: ${modules.slice(0, 3).join(', ')}`
          : 'Don\'t guess import paths'
      };
    }
    case 'TYPE_ERROR': {
      return {
        do: 'Match prop types exactly as defined in the interface',
        dont: 'Don\'t add extra properties or change required/optional status'
      };
    }
    case 'MARKDOWN_POLLUTION': {
      return {
        do: 'Start response immediately with code (import statement or first line)',
        dont: 'Don\'t include markdown fences, "Here\'s the code", or explanations'
      };
    }
    case 'INCOMPLETE_OUTPUT': {
      return {
        do: 'Output complete, working code with all functions implemented',
        dont: 'Don\'t use "...", "// rest of code", or other placeholders'
      };
    }
    default:
      return null;
  }
}

/**
 * Log learning to persistent file for analysis
 */
function logLearning(modelName, failures, context) {
  let log = { entries: [] };

  if (fs.existsSync(LEARNING_LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
    } catch (err) {
      log = { entries: [] };
    }
  }

  log.entries.push({
    timestamp: new Date().toISOString(),
    model: modelName,
    failureCount: failures.length,
    categories: failures.map(f => f.primaryCategory),
    strategies: failures.map(f => f.strategy),
    context: context.taskId || 'unknown',
    recovered: true
  });

  // Keep last 100 entries
  if (log.entries.length > 100) {
    log.entries = log.entries.slice(-100);
  }

  const dir = path.dirname(LEARNING_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(LEARNING_LOG_PATH, JSON.stringify(log, null, 2));
}

// ============================================================
// Strategy Effectiveness Tracking
// ============================================================

/**
 * Track which strategies lead to successful recovery
 * This helps us learn which refinement strategies work best per model
 */
function trackStrategyEffectiveness(modelName, strategy, succeeded) {
  let stats = {};

  if (fs.existsSync(STRATEGY_STATS_PATH)) {
    try {
      stats = JSON.parse(fs.readFileSync(STRATEGY_STATS_PATH, 'utf-8'));
    } catch (err) {
      stats = {};
    }
  }

  if (!stats[modelName]) {
    stats[modelName] = {};
  }

  if (!stats[modelName][strategy]) {
    stats[modelName][strategy] = { successes: 0, failures: 0 };
  }

  if (succeeded) {
    stats[modelName][strategy].successes++;
  } else {
    stats[modelName][strategy].failures++;
  }

  // Calculate effectiveness rate (guard against division by zero)
  const s = stats[modelName][strategy];
  const total = s.successes + s.failures;
  s.rate = total > 0 ? s.successes / total : 0;

  const dir = path.dirname(STRATEGY_STATS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(STRATEGY_STATS_PATH, JSON.stringify(stats, null, 2));
}

/**
 * Get strategy effectiveness for a model
 */
function getStrategyEffectiveness(modelName) {
  if (!fs.existsSync(STRATEGY_STATS_PATH)) {
    return null;
  }

  try {
    const stats = JSON.parse(fs.readFileSync(STRATEGY_STATS_PATH, 'utf-8'));
    return stats[modelName] || null;
  } catch (err) {
    return null;
  }
}

/**
 * Get the best strategy for a model and error category
 */
function getBestStrategy(modelName, category) {
  const effectiveness = getStrategyEffectiveness(modelName);
  if (!effectiveness) return null;

  const categoryStrategy = ERROR_CATEGORIES[category]?.strategy;
  if (categoryStrategy && effectiveness[categoryStrategy]) {
    const rate = effectiveness[categoryStrategy].rate;
    if (rate < 0.5) {
      // This strategy isn't working well, try generic
      return 'generic_fix';
    }
  }

  return categoryStrategy;
}

// ============================================================
// Learning Deduplication
// ============================================================

/**
 * Check if a similar learning already exists
 */
function isDuplicateLearning(modelName, category, details) {
  const adapterPath = getAdapterPath(modelName);
  if (!fs.existsSync(adapterPath)) return false;

  const content = fs.readFileSync(adapterPath, 'utf-8');
  const learningsMatch = content.match(/## Learnings\n([\s\S]*?)(?=\n## |$)/);
  if (!learningsMatch) return false;

  const learnings = learningsMatch[1];

  // Check if we have a learning for this category in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString().split('T')[0];

  // Find entries with both a recent date AND the category on the same line or nearby
  // Pattern: ### YYYY-MM-DD followed by category on same line
  const categoryEscaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recentCategoryPattern = new RegExp(`### (\\d{4}-\\d{2}-\\d{2}).*?${categoryEscaped}`, 'gi');
  const recentMatches = learnings.match(recentCategoryPattern);

  if (recentMatches) {
    for (const match of recentMatches) {
      const dateMatch = match.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch && dateMatch[1] >= dateStr) {
        return true; // Recent duplicate found - same date+category header
      }
    }
  }

  return false;
}

// ============================================================
// Adaptive Retry Loop
// ============================================================

/**
 * Adaptive retry wrapper for executor calls
 * @param {function} executeFn - Function that executes the task: (prompt) => output
 * @param {function} validateFn - Function that validates output: (output) => { success, error }
 * @param {string} originalPrompt - Original prompt
 * @param {object} options - Options: maxRetries, modelName, taskContext
 * @returns {object} Result with output, success, failures, learningsRecorded
 */
async function adaptiveRetry(executeFn, validateFn, originalPrompt, options = {}) {
  const {
    maxRetries = 5,
    modelName = 'unknown',
    taskContext = {}
  } = options;

  const failures = [];
  let currentPrompt = originalPrompt;
  let lastOutput = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Execute with current prompt
      const output = await executeFn(currentPrompt);
      lastOutput = output;

      // Validate output
      const validation = await validateFn(output);

      if (validation.success) {
        // Success! Record learnings if we had failures
        if (failures.length > 0) {
          recordSuccessfulRecovery(modelName, failures, {
            taskId: taskContext.taskId,
            attemptsTaken: attempt,
            finalPromptLength: currentPrompt.length
          });
        }

        return {
          success: true,
          output,
          attempts: attempt,
          failures,
          learningsRecorded: failures.length > 0
        };
      }

      // Failed validation
      lastError = validation.error;

    } catch (err) {
      lastError = err.message || String(err);
    }

    // Analyze failure
    const failure = analyzeFailure(lastError, lastOutput, taskContext);
    failures.push(failure);

    console.log(`${colors.yellow}   ⚠️  Attempt ${attempt} failed: ${failure.primaryCategory}${colors.reset}`);

    // Refine prompt for next attempt
    if (attempt < maxRetries) {
      const refined = refinePromptForRetry(originalPrompt, failure, failures.slice(0, -1));
      currentPrompt = refined.prompt;
      console.log(`${colors.dim}   📝 Refining prompt with ${refined.strategy} strategy${colors.reset}`);
    }
  }

  // All attempts failed
  return {
    success: false,
    output: lastOutput,
    error: lastError,
    attempts: maxRetries,
    failures,
    learningsRecorded: false
  };
}

// ============================================================
// Community Sharing - Export Learnings
// ============================================================

/**
 * Export aggregated learnings for contribution to wogi-flow
 * This allows users to share their model-specific learnings with the community
 */
function exportLearningsForSharing() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    models: {}
  };

  // Load learning log
  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return { success: false, error: 'No learning data found' };
  }

  const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));

  // Aggregate by model
  for (const entry of log.entries) {
    const model = entry.model;
    if (!exportData.models[model]) {
      exportData.models[model] = {
        totalRecoveries: 0,
        categoryFrequency: {},
        learnings: []
      };
    }

    exportData.models[model].totalRecoveries++;

    for (const cat of entry.categories) {
      exportData.models[model].categoryFrequency[cat] =
        (exportData.models[model].categoryFrequency[cat] || 0) + 1;
    }
  }

  // Load model adapter files and extract learnings sections
  const adaptersDir = path.join(PROJECT_ROOT, '.workflow', 'model-adapters');
  if (fs.existsSync(adaptersDir)) {
    const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of adapterFiles) {
      const modelName = file.replace('.md', '');
      const content = fs.readFileSync(path.join(adaptersDir, file), 'utf-8');

      // Extract learnings section
      const learningsMatch = content.match(/## Learnings\n([\s\S]*?)(?=\n## |$)/);
      if (learningsMatch && learningsMatch[1].trim()) {
        if (!exportData.models[modelName]) {
          exportData.models[modelName] = {
            totalRecoveries: 0,
            categoryFrequency: {},
            learnings: []
          };
        }

        // Parse individual learnings
        const learningBlocks = learningsMatch[1].split(/\n### /).filter(Boolean);
        for (const block of learningBlocks) {
          if (block.includes('Auto-learned') || block.includes('adaptive-learning')) {
            exportData.models[modelName].learnings.push(block.trim());
          }
        }
      }
    }
  }

  // Generate summary
  exportData.summary = {
    totalModels: Object.keys(exportData.models).length,
    totalLearnings: Object.values(exportData.models).reduce((sum, m) => sum + m.learnings.length, 0),
    topIssues: getTopIssues(exportData.models)
  };

  return { success: true, data: exportData };
}

/**
 * Get top issues across all models
 */
function getTopIssues(models) {
  const allCategories = {};

  for (const model of Object.values(models)) {
    for (const [cat, count] of Object.entries(model.categoryFrequency)) {
      allCategories[cat] = (allCategories[cat] || 0) + count;
    }
  }

  return Object.entries(allCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({
      category,
      count,
      description: ERROR_CATEGORIES[category]?.description || 'Unknown'
    }));
}

/**
 * Format export for PR submission
 */
function formatExportForPR(exportData) {
  const lines = [
    '# Model Adapter Learnings Contribution',
    '',
    `Exported: ${exportData.exportedAt}`,
    `Models: ${exportData.summary.totalModels}`,
    `Learnings: ${exportData.summary.totalLearnings}`,
    '',
    '## Top Issues Encountered',
    ''
  ];

  for (const issue of exportData.summary.topIssues) {
    lines.push(`- **${issue.category}** (${issue.count}x): ${issue.description}`);
  }

  lines.push('', '## Per-Model Learnings', '');

  for (const [model, data] of Object.entries(exportData.models)) {
    if (data.learnings.length === 0) continue;

    lines.push(`### ${model}`, '');
    lines.push(`Recoveries: ${data.totalRecoveries}`, '');

    for (const learning of data.learnings.slice(0, 5)) {
      lines.push('```');
      lines.push(learning);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================
// Automatic PR Contribution
// ============================================================

/**
 * Check if gh CLI is available and authenticated
 */
function checkGitHubCLI() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
    return { available: true };
  } catch (err) {
    return { available: false, error: 'gh CLI not authenticated. Run: gh auth login' };
  }
}

/**
 * Create a PR with learnings to the wogi-flow repository
 * @param {string} upstreamRepo - The upstream repo (e.g., 'owner/wogi-flow')
 * @param {object} options - Options
 */
async function contributeLearnings(upstreamRepo = 'your-org/wogi-flow', options = {}) {
  const { dryRun = false } = options;

  // Check prerequisites
  const ghCheck = checkGitHubCLI();
  if (!ghCheck.available) {
    return { success: false, error: ghCheck.error };
  }

  // Export learnings
  const exportResult = exportLearningsForSharing();
  if (!exportResult.success) {
    return { success: false, error: 'No learnings to contribute' };
  }

  const { data } = exportResult;
  if (data.summary.totalLearnings === 0) {
    return { success: false, error: 'No new learnings to contribute' };
  }

  // Generate unique branch name
  const timestamp = Date.now();
  const branchName = `learnings-contribution-${timestamp}`;

  if (dryRun) {
    console.log(`${colors.cyan}[DRY RUN] Would create PR with:${colors.reset}`);
    console.log(`  Branch: ${branchName}`);
    console.log(`  Models: ${data.summary.totalModels}`);
    console.log(`  Learnings: ${data.summary.totalLearnings}`);
    return { success: true, dryRun: true };
  }

  try {
    // Create contribution file
    const contributionDir = path.join(PROJECT_ROOT, '.workflow', 'contributions');
    if (!fs.existsSync(contributionDir)) {
      fs.mkdirSync(contributionDir, { recursive: true });
    }

    const contributionFile = path.join(contributionDir, `contribution-${timestamp}.md`);
    fs.writeFileSync(contributionFile, formatExportForPR(data));

    // Also create/update model adapter patches
    const patchesDir = path.join(contributionDir, 'patches');
    if (!fs.existsSync(patchesDir)) {
      fs.mkdirSync(patchesDir, { recursive: true });
    }

    for (const [model, modelData] of Object.entries(data.models)) {
      if (modelData.learnings.length === 0) continue;

      const patchContent = [
        `# Learnings for ${model}`,
        '',
        `Contributed: ${data.exportedAt}`,
        `Recoveries: ${modelData.totalRecoveries}`,
        '',
        '## New Learnings',
        '',
        ...modelData.learnings.map(l => `### ${l}`),
        ''
      ].join('\n');

      fs.writeFileSync(path.join(patchesDir, `${model}.md`), patchContent);
    }

    console.log(`${colors.green}✅ Contribution files created in ${contributionDir}${colors.reset}`);
    console.log('');
    console.log(`${colors.cyan}To submit a PR:${colors.reset}`);
    console.log(`  1. Fork ${upstreamRepo} on GitHub`);
    console.log(`  2. Clone your fork`);
    console.log(`  3. Copy files from ${contributionDir} to .workflow/model-adapters/`);
    console.log(`  4. Commit and push`);
    console.log(`  5. Create PR with title: "model-adapters: community learnings"`);
    console.log('');
    console.log(`${colors.dim}Or run with --auto-pr to attempt automatic PR creation (requires fork)${colors.reset}`);

    return {
      success: true,
      contributionDir,
      models: Object.keys(data.models),
      learnings: data.summary.totalLearnings
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Attempt to create PR automatically using gh CLI
 * This requires the user to have forked the wogi-flow repo
 */
async function createAutoPR(upstreamRepo, options = {}) {
  const { forkRepo } = options;

  if (!forkRepo) {
    return { success: false, error: 'Fork repo required. Use --fork=username/wogi-flow' };
  }

  // Validate repository formats to prevent injection
  if (!validateRepoFormat(forkRepo)) {
    return { success: false, error: 'Invalid fork repo format. Expected: owner/repo' };
  }
  if (!validateRepoFormat(upstreamRepo)) {
    return { success: false, error: 'Invalid upstream repo format. Expected: owner/repo' };
  }

  const ghCheck = checkGitHubCLI();
  if (!ghCheck.available) {
    return { success: false, error: ghCheck.error };
  }

  // Export and prepare
  const contribution = await contributeLearnings(upstreamRepo, { dryRun: false });
  if (!contribution.success) {
    return contribution;
  }

  const timestamp = Date.now();
  const branchName = `learnings-${timestamp}`;

  try {
    // Clone fork, create branch, add files, push, create PR
    const tempDir = path.join(PROJECT_ROOT, '.workflow', 'temp-pr');

    console.log(`${colors.cyan}Creating PR automatically...${colors.reset}`);

    // Clone the fork using safe git command (array arguments prevent injection)
    execFileSync('git', ['clone', '--depth', '1', `https://github.com/${forkRepo}.git`, tempDir], { stdio: 'pipe' });

    // Create branch
    safeGitCommand(['checkout', '-b', branchName], { cwd: tempDir });

    // Copy contribution files
    const patchesDir = path.join(contribution.contributionDir, 'patches');
    const targetDir = path.join(tempDir, '.workflow', 'model-adapters');

    if (fs.existsSync(patchesDir)) {
      const patches = fs.readdirSync(patchesDir);
      for (const patch of patches) {
        const src = path.join(patchesDir, patch);
        const dest = path.join(targetDir, patch);

        // Append learnings to existing adapter or create new
        if (fs.existsSync(dest)) {
          const existing = fs.readFileSync(dest, 'utf-8');
          const addition = fs.readFileSync(src, 'utf-8');
          // Append new learnings section
          fs.writeFileSync(dest, existing + '\n' + addition);
        } else {
          fs.copyFileSync(src, dest);
        }
      }
    }

    // Commit using safe git commands
    safeGitCommand(['add', '.'], { cwd: tempDir });
    safeGitCommand(['commit', '-m', 'model-adapters: community learnings from adaptive learning'], { cwd: tempDir });

    // Push
    safeGitCommand(['push', 'origin', branchName], { cwd: tempDir });

    // Create PR using gh with proper argument handling
    const prTitle = 'model-adapters: community learnings contribution';
    const prBody = `## Community Learnings Contribution

This PR adds learnings from adaptive learning sessions.

**Models:** ${contribution.models.join(', ')}
**New Learnings:** ${contribution.learnings}

These learnings help improve prompt refinement for all wogi-flow users.

---
*Auto-generated by wogi-flow adaptive learning system*`;

    const forkOwner = forkRepo.split('/')[0];
    execFileSync('gh', [
      'pr', 'create',
      '--repo', upstreamRepo,
      '--head', `${forkOwner}:${branchName}`,
      '--title', prTitle,
      '--body', prBody
    ], { cwd: tempDir, stdio: 'inherit' });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`${colors.green}✅ PR created successfully!${colors.reset}`);
    return { success: true };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core functions
  analyzeFailure,
  refinePromptForRetry,
  recordSuccessfulRecovery,
  adaptiveRetry,

  // Constants for external use
  ERROR_CATEGORIES,
  REFINEMENT_STRATEGIES,

  // Re-export centralized failure categories for convenience
  FailureCategory,
  detectCategory,
  shouldEscalate: checkShouldEscalate,

  // Utilities
  extractErrorDetails,
  generateGuidanceFromFailures,
  logLearning,

  // Strategy effectiveness
  trackStrategyEffectiveness,
  getStrategyEffectiveness,
  getBestStrategy,

  // Deduplication
  isDuplicateLearning,

  // Community sharing
  exportLearningsForSharing,
  formatExportForPR,
  contributeLearnings,
  createAutoPR,
  checkGitHubCLI
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
    case 'stats': {
      // Show learning statistics
      if (fs.existsSync(LEARNING_LOG_PATH)) {
        const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
        console.log('\n📊 Adaptive Learning Statistics\n');
        console.log(`Total recoveries: ${log.entries.length}`);

        // Group by model
        const byModel = {};
        for (const entry of log.entries) {
          if (!byModel[entry.model]) {
            byModel[entry.model] = { count: 0, categories: {} };
          }
          byModel[entry.model].count++;
          for (const cat of entry.categories) {
            byModel[entry.model].categories[cat] = (byModel[entry.model].categories[cat] || 0) + 1;
          }
        }

        console.log('\nBy model:');
        for (const [model, data] of Object.entries(byModel)) {
          console.log(`\n  ${model}: ${data.count} recoveries`);
          for (const [cat, count] of Object.entries(data.categories)) {
            console.log(`    - ${cat}: ${count}`);
          }
        }
      } else {
        console.log('No adaptive learning data yet.');
      }
      break;
    }

    case 'test': {
      // Test failure analysis
      const testErrors = [
        "Cannot find module '@/components/Button'",
        "Type 'string' is not assignable to type 'number'",
        "Unexpected token, expected '}'",
        "```typescript\nimport React from 'react'",
        "// ... rest of component"
      ];

      console.log('\n🧪 Testing Failure Analysis\n');
      for (const error of testErrors) {
        const analysis = analyzeFailure(error, '');
        console.log(`Error: "${error.slice(0, 50)}..."`);
        console.log(`  Category: ${analysis.primaryCategory}`);
        console.log(`  Strategy: ${analysis.strategy}`);
        console.log('');
      }
      break;
    }

    case 'export': {
      // Export learnings for community contribution
      console.log('\n📤 Exporting Learnings for Community Contribution\n');

      const result = exportLearningsForSharing();

      if (!result.success) {
        console.log(`${colors.yellow}No learning data to export yet.${colors.reset}`);
        console.log('Run some hybrid mode tasks first to generate learnings.');
        process.exit(1);
      }

      const { data } = result;
      console.log(`Models with learnings: ${data.summary.totalModels}`);
      console.log(`Total learnings: ${data.summary.totalLearnings}`);

      if (data.summary.topIssues.length > 0) {
        console.log('\nTop issues encountered:');
        for (const issue of data.summary.topIssues) {
          console.log(`  - ${issue.category} (${issue.count}x): ${issue.description}`);
        }
      }

      // Save export file
      const exportPath = path.join(PROJECT_ROOT, '.workflow', 'learnings-export.json');
      fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
      console.log(`\n${colors.green}✅ Exported to: ${exportPath}${colors.reset}`);

      // Also create PR-ready markdown
      const prPath = path.join(PROJECT_ROOT, '.workflow', 'learnings-contribution.md');
      fs.writeFileSync(prPath, formatExportForPR(data));
      console.log(`${colors.green}✅ PR-ready format: ${prPath}${colors.reset}`);

      console.log(`
${colors.cyan}To contribute these learnings to wogi-flow:${colors.reset}
1. Fork https://github.com/your-org/wogi-flow
2. Copy ${prPath} content to your PR
3. Submit PR with title: "model-adapters: community learnings"

Or use: flow hybrid learning contribute --auto-pr --fork=yourusername/wogi-flow
`);
      break;
    }

    case 'contribute': {
      // Contribute learnings via PR
      console.log('\n🤝 Contributing Learnings to Community\n');

      const autoPR = args.includes('--auto-pr');
      const forkArg = args.find(a => a.startsWith('--fork='));
      const forkRepo = forkArg ? forkArg.split('=')[1] : null;
      const upstreamArg = args.find(a => a.startsWith('--upstream='));
      const upstreamRepo = upstreamArg ? upstreamArg.split('=')[1] : 'your-org/wogi-flow';

      if (autoPR) {
        if (!forkRepo) {
          console.log(`${colors.red}Error: --fork=username/wogi-flow required for auto-PR${colors.reset}`);
          console.log('Example: flow hybrid learning contribute --auto-pr --fork=myuser/wogi-flow');
          process.exit(1);
        }

        const result = await createAutoPR(upstreamRepo, { forkRepo });
        if (!result.success) {
          console.log(`${colors.red}Error: ${result.error}${colors.reset}`);
          process.exit(1);
        }
      } else {
        const result = await contributeLearnings(upstreamRepo);
        if (!result.success) {
          console.log(`${colors.red}Error: ${result.error}${colors.reset}`);
          process.exit(1);
        }
      }
      break;
    }

    case 'effectiveness': {
      // Show strategy effectiveness stats
      console.log('\n📈 Strategy Effectiveness\n');

      if (!fs.existsSync(STRATEGY_STATS_PATH)) {
        console.log('No strategy effectiveness data yet.');
        console.log('Run some hybrid mode tasks first to generate data.');
        break;
      }

      const stats = JSON.parse(fs.readFileSync(STRATEGY_STATS_PATH, 'utf-8'));

      for (const [model, strategies] of Object.entries(stats)) {
        console.log(`\n${colors.cyan}${model}${colors.reset}`);
        for (const [strategy, data] of Object.entries(strategies)) {
          const rate = (data.rate * 100).toFixed(0);
          const color = data.rate > 0.7 ? colors.green : data.rate > 0.5 ? colors.yellow : colors.red;
          console.log(`  ${strategy}: ${color}${rate}%${colors.reset} (${data.successes}/${data.successes + data.failures})`);
        }
      }
      break;
    }

    default:
      console.log(`
Wogi Flow - Adaptive Learning

Usage:
  node flow-adaptive-learning.js <command>

Commands:
  stats           Show learning statistics
  test            Test failure analysis with sample errors
  export          Export learnings for community contribution
  contribute      Create contribution files for PR
  effectiveness   Show strategy effectiveness per model

Options for contribute:
  --auto-pr       Automatically create GitHub PR
  --fork=user/repo  Your fork of wogi-flow (required for --auto-pr)
  --upstream=user/repo  Upstream repo (default: your-org/wogi-flow)

This module enables hybrid mode to learn from failures:
1. When executor fails, analyze WHY
2. Refine prompt based on failure category
3. Retry with improved instructions
4. On success, update model adapter with learnings
5. Share learnings with the community via PR
`);
    }
  })();
}
