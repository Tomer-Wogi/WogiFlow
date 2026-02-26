#!/usr/bin/env node

/**
 * Wogi Flow - Standards Gate
 *
 * Bridge between wogi-start and standards checker with task context awareness.
 * Provides smart scoping based on task type and formats violations for retry loop.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  readFile,
  safeJsonParse,
  getConfig,
  color
} = require('./flow-utils');

const {
  runStandardsCheck,
  formatStandardsResults,
  collectReuseCandidates,
  TASK_CHECK_MAP
} = require('./flow-standards-checker');

// Learning integration
let standardsLearner;
try {
  standardsLearner = require('./flow-standards-learner');
} catch (err) {
  standardsLearner = null;
}

// ============================================================================
// Task Context Loading
// ============================================================================

/**
 * Load task context from ready.json and spec file
 * @param {string} taskId - Task ID
 * @returns {Object|null} Task context or null if not found
 */
function loadTaskContext(taskId) {
  const readyPath = path.join(PATHS.state, 'ready.json');
  const ready = safeJsonParse(readyPath, { inProgress: [], ready: [] });

  // Find task in inProgress or ready
  let task = ready.inProgress?.find(t => t.id === taskId);
  if (!task) {
    task = ready.ready?.find(t => t.id === taskId);
  }

  if (!task) {
    return null;
  }

  // Load spec if available
  let spec = null;
  if (task.specPath && fileExists(task.specPath)) {
    spec = readFile(task.specPath, '');
  }

  // Extract files to change from spec (only if spec is a non-empty string)
  const filesToChange = (spec && typeof spec === 'string' && spec.trim().length > 0)
    ? extractFilesToChange(spec)
    : [];

  return {
    id: taskId,
    title: task.title,
    type: task.type || 'feature',
    priority: task.priority,
    specPath: task.specPath,
    filesToChange,
    spec
  };
}

/**
 * Extract files to change from spec content
 * @param {string} specContent - Spec file content
 * @returns {string[]} Array of file paths
 */
function extractFilesToChange(specContent) {
  if (!specContent) return [];

  const files = [];

  // Look for "Files to Change" or "Technical Notes" sections
  const patterns = [
    /files?\s+to\s+change[:\s]*\n([\s\S]*?)(?=\n##|\n\n##|$)/i,
    /technical\s+notes[:\s]*\n([\s\S]*?)(?=\n##|\n\n##|$)/i,
    /components?[:\s]*\n([\s\S]*?)(?=\n##|\n-\s*\*\*|$)/i
  ];

  for (const pattern of patterns) {
    const match = specContent.match(pattern);
    if (match) {
      // Extract file paths from the section
      const section = match[1];
      const fileMatches = section.match(/`([^`]+\.(ts|tsx|js|jsx|json|md))`/g) || [];
      for (const fileMatch of fileMatches) {
        const filePath = fileMatch.replace(/`/g, '');
        if (filePath && !files.includes(filePath)) {
          files.push(filePath);
        }
      }
    }
  }

  return files;
}

/**
 * Infer task type from file paths if not explicitly set
 * @param {string} taskType - Explicit task type (may be generic)
 * @param {string[]} changedFiles - Files changed in this task
 * @returns {string} Inferred task type
 */
function inferTaskType(taskType, changedFiles) {
  // If already specific, use it
  if (['component', 'utility', 'api', 'bugfix', 'refactor'].includes(taskType)) {
    return taskType;
  }

  // Infer from file paths
  const hasComponents = changedFiles.some(f =>
    f.includes('/components/') || f.includes('Component') || f.endsWith('.tsx')
  );
  const hasUtils = changedFiles.some(f =>
    f.includes('/utils/') || f.includes('/lib/') || f.includes('/helpers/')
  );
  const hasApi = changedFiles.some(f =>
    f.includes('/api/') || f.includes('/services/') || f.includes('.service.')
  );

  if (hasApi) return 'api';
  if (hasComponents && !hasUtils) return 'component';
  if (hasUtils && !hasComponents) return 'utility';

  // Default based on original type
  if (taskType === 'bug' || taskType === 'bugfix') return 'bugfix';
  if (taskType === 'refactor') return 'refactor';

  return 'feature'; // Default to feature (runs all checks)
}

// ============================================================================
// Standards Gate Functions
// ============================================================================

/**
 * Run standards check scoped to current task
 * @param {Object} taskContext - Task context from loadTaskContext or provided directly
 * @param {Object[]} files - Files with path and content to check
 * @param {Object} options - Additional options
 * @returns {Object} Check results with feedback for retry loop
 */
function runTaskStandardsCheck(taskContext, files, options = {}) {
  const config = getConfig();
  const standardsConfig = config.standardsCompliance || {};

  // Check if standards compliance is enabled
  if (standardsConfig.enabled === false) {
    return {
      passed: true,
      blocked: false,
      skipped: true,
      reason: 'Standards compliance disabled in config',
      violations: [],
      feedback: null
    };
  }

  // Determine task type (infer if needed)
  const taskType = inferTaskType(
    taskContext?.type || options.taskType || 'feature',
    files.map(f => f.path)
  );

  // Get changed paths for targeted checks
  const changedPaths = taskContext?.filesToChange || options.changedPaths || [];

  // Determine which checks to run based on config
  const alwaysCheck = standardsConfig.alwaysCheck || ['naming', 'security'];
  const scopeByTaskType = standardsConfig.scopeByTaskType !== false;

  // Build check options
  // Similarity thresholds are now managed by flow-semantic-match.js via getMatchConfig()
  // The standards checker loads semantic matching config internally
  const checkOptions = {
    taskType: scopeByTaskType ? taskType : 'feature',
    changedPaths
  };

  // Run the standards check
  const results = runStandardsCheck(files, checkOptions);

  // Determine if we should block based on mode
  const mode = standardsConfig.mode || 'block';
  const shouldBlock = mode === 'block' && results.blocked;

  // Generate feedback for retry loop if violations found
  let feedback = null;
  if (results.violations.length > 0) {
    feedback = formatViolationsForRetry(results.violations, taskType);
  }

  // Collect reuse candidates (AI-as-judge, separate from violations)
  let reuseCandidates = [];
  const semanticConfig = config.semanticMatching || {};
  const reuseConfig = config.hooks?.rules?.componentReuse || {};
  const aiAsJudge = semanticConfig.aiAsJudge !== false && reuseConfig.aiAsJudge !== false;
  const allRegistries = reuseConfig.allRegistries !== false;

  if (aiAsJudge && allRegistries) {
    try {
      reuseCandidates = collectReuseCandidates(files, {
        taskType,
        changedPaths,
        allRegistries
      });
    } catch (err) {
      // Non-blocking — reuse candidate collection is best-effort
    }
  }

  // Format reuse candidates for AI consumption
  let reuseCandidateContext = null;
  if (reuseCandidates.length > 0) {
    reuseCandidateContext = formatReuseCandidatesForAI(reuseCandidates, aiAsJudge);
  }

  // Learn from violations if learning is enabled
  let learningResults = null;
  if (standardsConfig.learning?.enabled !== false && results.violations.length > 0 && standardsLearner) {
    learningResults = standardsLearner.learnFromViolations(results.violations, taskContext);
  }

  // Get prevention prompts for context
  let preventionPrompts = [];
  if (standardsConfig.learning?.includePreventionPrompts && standardsLearner) {
    preventionPrompts = standardsLearner.getPreventionPrompts(taskType, files.map(f => f.path));
  }

  return {
    ...results,
    blocked: shouldBlock,
    mode,
    taskType,
    taskId: taskContext?.id,
    feedback,
    checksRun: results.checksRun,
    reuseCandidates,
    reuseCandidateContext,
    aiAsJudge,
    learningResults,
    preventionPrompts
  };
}

/**
 * Format violations for agent feedback in retry loop
 * @param {Object[]} violations - Array of violations
 * @param {string} taskType - Task type for context
 * @returns {string} Formatted feedback prompt
 */
function formatViolationsForRetry(violations, taskType) {
  const lines = [];

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ STANDARDS VIOLATIONS FOUND');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // Group violations by type
  const byType = {};
  for (const v of violations) {
    if (!byType[v.type]) byType[v.type] = [];
    byType[v.type].push(v);
  }

  // Format each group
  for (const [type, typeViolations] of Object.entries(byType)) {
    const typeName = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`📋 ${typeName}:`);
    lines.push('');

    for (const v of typeViolations) {
      const severity = v.severity === 'must-fix' ? '🔴 MUST FIX' : '🟡 WARNING';
      const location = v.line ? `${v.file}:${v.line}` : v.file;

      lines.push(`  ${severity}: ${location}`);
      lines.push(`    → ${v.message}`);
      if (v.suggestion) {
        lines.push(`    💡 Fix: ${v.suggestion}`);
      }
      lines.push('');
    }
  }

  // Add actionable summary
  const mustFixCount = violations.filter(v => v.severity === 'must-fix').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Summary: ${mustFixCount} must-fix, ${warningCount} warnings`);
  lines.push('');

  if (mustFixCount > 0) {
    lines.push('⛔ Task blocked until must-fix violations are resolved.');
    lines.push('');
    lines.push('To proceed:');
    lines.push('  1. Fix each must-fix violation above');
    lines.push('  2. Re-run the standards check');
    lines.push('  3. Continue with task completion');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/**
 * Format reuse candidates for AI-as-judge reasoning.
 * Instructs the AI to reason about PURPOSE (not just scores) and present
 * choices to the user via AskUserQuestion.
 *
 * @param {Array} candidates - From collectReuseCandidates()
 * @param {boolean} aiAsJudge - Whether AI-as-judge mode is active
 * @returns {string} Structured context for AI consumption
 */
function formatReuseCandidatesForAI(candidates, aiAsJudge) {
  if (!candidates || candidates.length === 0) return null;

  const lines = [];

  lines.push('');
  lines.push('<reuse-candidates>');
  lines.push('## Reuse Candidate Check (AI-as-Judge)');
  lines.push('');
  lines.push('The following items in your changes are similar to existing registry entries.');
  lines.push('These are NOT violations — they are candidates for your review.');
  lines.push('');

  if (aiAsJudge) {
    lines.push('**Instructions for AI:**');
    lines.push('1. Read the source code of BOTH the new item and each match');
    lines.push('2. Reason about PURPOSE overlap — do they solve the same problem?');
    lines.push('3. If purpose overlaps significantly, present a multi-select AskUserQuestion:');
    lines.push('   - Option: "Use existing [name]" — reuse directly');
    lines.push('   - Option: "Extend [name]" — add variant to existing');
    lines.push('   - Option: "Create new [name]" — genuinely different purpose');
    lines.push('4. If names are similar but purpose clearly differs, proceed silently');
    lines.push('5. NEVER auto-block based on scores alone — always reason about purpose');
    lines.push('');
  }

  // Group by domain for readability
  const byDomain = {};
  for (const c of candidates) {
    if (!byDomain[c.domain]) byDomain[c.domain] = [];
    byDomain[c.domain].push(c);
  }

  for (const [domain, domainCandidates] of Object.entries(byDomain)) {
    lines.push(`### ${domain} candidates`);
    lines.push('');

    for (const candidate of domainCandidates) {
      lines.push(`**New: "${candidate.newItem}"** (${candidate.file}:${candidate.line || '?'})`);
      lines.push(`Registry: ${candidate.registryFile}`);
      lines.push('');

      for (const match of candidate.matches.slice(0, 3)) {
        const name = match.name || match.title || '?';
        lines.push(`  - **${name}** — ${match.scores.combined}% match`);
        lines.push(`    String: ${match.scores.string}%, Semantic: ${match.scores.semantic}%`);
        if (match.description || match.purpose) {
          lines.push(`    Purpose: ${match.description || match.purpose}`);
        }
        if (match.file || match.path) {
          lines.push(`    Location: \`${match.file || match.path}\``);
        }
      }
      lines.push('');
    }
  }

  lines.push('</reuse-candidates>');

  return lines.join('\n');
}

/**
 * Quick check if a task context has already passed standards
 * @param {Object} taskContext - Task context
 * @returns {boolean} True if already passed
 */
function hasPassedStandards(taskContext) {
  return taskContext?.standardsCheckPassed === true;
}

/**
 * Mark task context as having passed standards check
 * @param {Object} taskContext - Task context to update
 */
function markStandardsPassed(taskContext) {
  if (taskContext) {
    taskContext.standardsCheckPassed = true;
    taskContext.standardsCheckTime = new Date().toISOString();
  }
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Standards Gate

Usage: node flow-standards-gate.js [options] <taskId> [files...]

Options:
  --task-type TYPE     Override task type (component, utility, api, feature, bugfix, refactor)
  --mode MODE          Override mode (block or warn)
  --json               Output as JSON
  -h, --help           Show this help

Examples:
  node flow-standards-gate.js wf-abc123 src/components/MyComp.tsx
  node flow-standards-gate.js --task-type component src/**/*.tsx
  node flow-standards-gate.js --json wf-abc123 src/utils/*.js
`);
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');
  const taskTypeIdx = args.indexOf('--task-type');
  const taskType = taskTypeIdx !== -1 ? args[taskTypeIdx + 1] : null;
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx !== -1 ? args[modeIdx + 1] : null;

  // Filter out option args
  const positionalArgs = args.filter((a, i) =>
    !a.startsWith('-') &&
    args[i - 1] !== '--task-type' &&
    args[i - 1] !== '--mode'
  );

  const taskId = positionalArgs[0]?.startsWith('wf-') ? positionalArgs[0] : null;
  const filePaths = taskId ? positionalArgs.slice(1) : positionalArgs;

  if (filePaths.length === 0) {
    console.log('No files specified. Usage: node flow-standards-gate.js [taskId] [files...]');
    process.exit(1);
  }

  // Load task context if taskId provided
  const taskContext = taskId ? loadTaskContext(taskId) : null;

  // Load file contents
  const files = filePaths.map(f => {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      return { path: f, content };
    } catch (err) {
      return { path: f, content: '', error: err.message };
    }
  });

  // Run the check
  const options = {};
  if (taskType) options.taskType = taskType;
  if (mode) {
    // Update config temporarily
    const config = getConfig();
    config.standardsCompliance = config.standardsCompliance || {};
    config.standardsCompliance.mode = mode;
  }

  const results = runTaskStandardsCheck(taskContext, files, options);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.skipped) {
      console.log(color('dim', `Standards check skipped: ${results.reason}`));
    } else {
      console.log(formatStandardsResults(results));
      if (results.feedback) {
        console.log(results.feedback);
      }
    }
  }

  process.exit(results.blocked ? 1 : 0);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  loadTaskContext,
  extractFilesToChange,
  inferTaskType,
  runTaskStandardsCheck,
  formatViolationsForRetry,
  formatReuseCandidatesForAI,
  hasPassedStandards,
  markStandardsPassed
};
