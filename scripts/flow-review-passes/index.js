#!/usr/bin/env node

/**
 * Multi-Pass Review Orchestrator
 *
 * Coordinates sequential review passes with fresh context isolation.
 * Based on recursive language model principles - multi-pass beats single-pass
 * for complex review tasks.
 *
 * Pass Flow:
 * 1. Structure (Haiku) - File organization, naming, anti-patterns
 * 2. Logic (Sonnet) - Business logic, edge cases
 * 3. Security (Sonnet, conditional) - OWASP, injection risks
 * 4. Integration (Sonnet, conditional) - Breaking changes, contracts
 */

const path = require('path');
const { getConfig, readJson, writeJson, PATHS, success, warn, error, info } = require('../flow-utils');

// Import pass modules
const structurePass = require('./structure');
const logicPass = require('./logic');
const securityPass = require('./security');
const integrationPass = require('./integration');

/**
 * Pass definitions with default settings
 */
const PASS_DEFINITIONS = {
  structure: {
    name: 'Structure',
    module: structurePass,
    model: 'haiku',
    enabled: true,
    conditional: false,
    description: 'File organization, naming, known anti-patterns'
  },
  logic: {
    name: 'Logic',
    module: logicPass,
    model: 'sonnet',
    enabled: true,
    conditional: false,
    description: 'Business logic, edge cases, algorithm correctness'
  },
  security: {
    name: 'Security',
    module: securityPass,
    model: 'sonnet',
    enabled: true,
    conditional: true,
    description: 'OWASP checks, injection risks, credential exposure',
    triggers: ['security', 'auth', 'password', 'token', 'api', 'input', 'sql', 'query']
  },
  integration: {
    name: 'Integration',
    module: integrationPass,
    model: 'sonnet',
    enabled: true,
    conditional: true,
    description: 'Breaking changes, contract drift, dependency conflicts',
    triggers: { minFiles: 5, hasApiChanges: true }
  }
};

/**
 * Check if a conditional pass should run
 * @param {string} passName - Name of the pass
 * @param {Object} context - Review context with files, content, etc.
 * @returns {boolean} Whether the pass should run
 */
function shouldRunConditionalPass(passName, context) {
  const pass = PASS_DEFINITIONS[passName];
  if (!pass.conditional) return true;

  // Security pass: runs if security patterns detected
  if (passName === 'security') {
    const allContent = (context.files || [])
      .map(f => f.content || '')
      .join(' ')
      .toLowerCase();

    return pass.triggers.some(trigger => allContent.includes(trigger));
  }

  // Integration pass: runs if many files or API changes
  if (passName === 'integration') {
    const fileCount = (context.files || []).length;
    const hasApiChanges = (context.files || []).some(f =>
      /\.(api|service|controller)\.(ts|js)$/i.test(f.path) ||
      f.content?.includes('endpoint') ||
      f.content?.includes('API')
    );

    return fileCount >= pass.triggers.minFiles || hasApiChanges;
  }

  return true;
}

/**
 * Merge pass config from user settings
 * @param {Object} defaultConfig - Default pass configuration
 * @param {Object} userConfig - User's config.json settings
 * @returns {Object} Merged configuration
 */
function mergePassConfig(defaultConfig, userConfig) {
  if (!userConfig) return defaultConfig;

  return {
    ...defaultConfig,
    enabled: userConfig.enabled !== undefined ? userConfig.enabled : defaultConfig.enabled,
    model: userConfig.model || defaultConfig.model,
    conditional: userConfig.conditional !== undefined ? userConfig.conditional : defaultConfig.conditional
  };
}

/**
 * Run a single review pass
 * @param {string} passName - Name of the pass to run
 * @param {Object} context - Review context
 * @param {Object} previousResults - Results from previous passes
 * @returns {Promise<Object>} Pass results
 */
async function runPass(passName, context, previousResults = {}) {
  const pass = PASS_DEFINITIONS[passName];
  if (!pass) {
    throw new Error(`Unknown pass: ${passName}`);
  }

  const startTime = Date.now();

  try {
    // Build pass-specific context (context isolation)
    const passContext = {
      ...context,
      previousResults,
      passName,
      model: pass.model
    };

    // Run the pass
    const result = await pass.module.run(passContext);

    return {
      pass: passName,
      name: pass.name,
      model: pass.model,
      success: true,
      duration: Date.now() - startTime,
      issues: result.issues || [],
      suggestions: result.suggestions || [],
      filesToExamine: result.filesToExamine || [],
      metrics: result.metrics || {},
      critical: result.issues?.some(i => i.severity === 'critical') || false
    };
  } catch (err) {
    return {
      pass: passName,
      name: pass.name,
      model: pass.model,
      success: false,
      duration: Date.now() - startTime,
      error: err.message,
      issues: [],
      suggestions: [],
      critical: false
    };
  }
}

/**
 * Run multi-pass review
 * @param {Object} context - Review context
 * @param {Object} options - Review options
 * @returns {Promise<Object>} Combined review results
 */
async function runMultiPassReview(context, options = {}) {
  const config = getConfig();
  const reviewConfig = config.review?.multiPass || {};

  const {
    passes = ['structure', 'logic', 'security', 'integration'],
    earlyExitOnCritical = reviewConfig.earlyExitOnCritical !== false,
    passForward = reviewConfig.passForward !== false,
    parallel = false
  } = options;

  const results = {
    mode: 'multipass',
    startTime: new Date().toISOString(),
    passes: [],
    allIssues: [],
    allSuggestions: [],
    summary: {
      totalPasses: 0,
      passesRun: 0,
      passesSkipped: 0,
      critical: false,
      totalIssues: 0,
      totalSuggestions: 0
    }
  };

  let previousResults = {};
  let hadCritical = false;

  for (const passName of passes) {
    results.summary.totalPasses++;

    // Get pass config (merged with user settings)
    const passDefaults = PASS_DEFINITIONS[passName];
    if (!passDefaults) {
      warn(`Unknown pass "${passName}", skipping`);
      results.summary.passesSkipped++;
      continue;
    }

    const passConfig = mergePassConfig(passDefaults, reviewConfig.passes?.[passName]);

    // Check if pass is enabled
    if (!passConfig.enabled) {
      results.passes.push({
        pass: passName,
        name: passConfig.name,
        skipped: true,
        reason: 'disabled'
      });
      results.summary.passesSkipped++;
      continue;
    }

    // Check conditional pass trigger
    if (passConfig.conditional && !shouldRunConditionalPass(passName, context)) {
      results.passes.push({
        pass: passName,
        name: passConfig.name,
        skipped: true,
        reason: 'condition_not_met'
      });
      results.summary.passesSkipped++;
      continue;
    }

    // Check early exit
    if (hadCritical && earlyExitOnCritical) {
      results.passes.push({
        pass: passName,
        name: passConfig.name,
        skipped: true,
        reason: 'early_exit_critical'
      });
      results.summary.passesSkipped++;
      continue;
    }

    // Run the pass
    info(`Running ${passConfig.name} pass...`);
    const passResult = await runPass(passName, context, passForward ? previousResults : {});

    results.passes.push(passResult);
    results.summary.passesRun++;

    if (passResult.success) {
      results.allIssues.push(...passResult.issues);
      results.allSuggestions.push(...passResult.suggestions);
      results.summary.totalIssues += passResult.issues.length;
      results.summary.totalSuggestions += passResult.suggestions.length;

      if (passResult.critical) {
        hadCritical = true;
        results.summary.critical = true;
      }

      // Pass forward results for next pass
      if (passForward) {
        previousResults[passName] = {
          issues: passResult.issues,
          filesToExamine: passResult.filesToExamine,
          metrics: passResult.metrics
        };
      }
    } else {
      error(`${passConfig.name} pass failed: ${passResult.error}`);
    }
  }

  results.endTime = new Date().toISOString();
  results.totalDuration = results.passes.reduce((sum, p) => sum + (p.duration || 0), 0);

  return results;
}

/**
 * Format review results for display
 * @param {Object} results - Multi-pass review results
 * @returns {string} Formatted output
 */
function formatResults(results) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('           Multi-Pass Code Review Results          ');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  // Summary
  lines.push(`Passes: ${results.summary.passesRun}/${results.summary.totalPasses} run, ${results.summary.passesSkipped} skipped`);
  lines.push(`Issues: ${results.summary.totalIssues} found${results.summary.critical ? ' (CRITICAL)' : ''}`);
  lines.push(`Suggestions: ${results.summary.totalSuggestions}`);
  lines.push(`Duration: ${results.totalDuration}ms`);
  lines.push('');

  // Per-pass results
  for (const pass of results.passes) {
    if (pass.skipped) {
      lines.push(`○ ${pass.name}: skipped (${pass.reason})`);
    } else if (pass.success) {
      const icon = pass.critical ? '⚠' : '✓';
      lines.push(`${icon} ${pass.name}: ${pass.issues.length} issues, ${pass.suggestions.length} suggestions (${pass.duration}ms)`);
    } else {
      lines.push(`✗ ${pass.name}: FAILED - ${pass.error}`);
    }
  }

  // Issues by severity
  if (results.allIssues.length > 0) {
    lines.push('');
    lines.push('─── Issues ───');

    const critical = results.allIssues.filter(i => i.severity === 'critical');
    const high = results.allIssues.filter(i => i.severity === 'high');
    const medium = results.allIssues.filter(i => i.severity === 'medium');
    const low = results.allIssues.filter(i => i.severity === 'low');

    if (critical.length > 0) {
      lines.push('');
      lines.push('🔴 CRITICAL:');
      critical.forEach(i => lines.push(`   • ${i.message} (${i.file || 'general'})`));
    }

    if (high.length > 0) {
      lines.push('');
      lines.push('🟠 HIGH:');
      high.forEach(i => lines.push(`   • ${i.message} (${i.file || 'general'})`));
    }

    if (medium.length > 0) {
      lines.push('');
      lines.push('🟡 MEDIUM:');
      medium.forEach(i => lines.push(`   • ${i.message} (${i.file || 'general'})`));
    }

    if (low.length > 0) {
      lines.push('');
      lines.push('🟢 LOW:');
      low.forEach(i => lines.push(`   • ${i.message} (${i.file || 'general'})`));
    }
  }

  // Top suggestions
  if (results.allSuggestions.length > 0) {
    lines.push('');
    lines.push('─── Suggestions ───');
    results.allSuggestions.slice(0, 5).forEach(s => {
      lines.push(`   💡 ${s.message}`);
    });
    if (results.allSuggestions.length > 5) {
      lines.push(`   ... and ${results.allSuggestions.length - 5} more`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

// Export for use as module
module.exports = {
  PASS_DEFINITIONS,
  runMultiPassReview,
  runPass,
  shouldRunConditionalPass,
  formatResults
};

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Multi-Pass Review Orchestrator

Usage: node flow-review-passes [options]

Options:
  --files=<paths>     Comma-separated file paths to review
  --passes=<names>    Comma-separated pass names (default: all)
  --no-early-exit     Don't stop on critical issues
  --no-forward        Don't pass results between passes
  --json              Output as JSON
  -h, --help          Show this help

Passes:
  structure    File organization, naming, anti-patterns (Haiku)
  logic        Business logic, edge cases (Sonnet)
  security     OWASP, injection, credentials (Sonnet, conditional)
  integration  Breaking changes, contracts (Sonnet, conditional)
`);
    process.exit(0);
  }

  // Parse arguments
  const files = args.find(a => a.startsWith('--files='))?.slice(8).split(',') || [];
  const passes = args.find(a => a.startsWith('--passes='))?.slice(9).split(',') || null;
  const earlyExit = !args.includes('--no-early-exit');
  const passForward = !args.includes('--no-forward');
  const json = args.includes('--json');

  if (files.length === 0) {
    error('No files specified. Use --files=path1,path2,...');
    process.exit(1);
  }

  // Build context
  const context = {
    files: files.map(f => ({ path: f, content: '' })) // Content would be loaded
  };

  // Run review
  runMultiPassReview(context, {
    passes: passes || undefined,
    earlyExitOnCritical: earlyExit,
    passForward
  }).then(results => {
    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatResults(results));
    }
  }).catch(err => {
    error(`Review failed: ${err.message}`);
    process.exit(1);
  });
}
