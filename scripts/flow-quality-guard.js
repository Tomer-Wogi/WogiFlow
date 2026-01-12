#!/usr/bin/env node

/**
 * Wogi Flow - Quality Guard
 *
 * Ensures context optimization doesn't compromise quality.
 * Part of Smart Context System (Phase 5)
 *
 * Core Principle: Quality is non-negotiable. If dynamic context
 * fails quality checks, automatically escalate to full context.
 *
 * Features:
 * - Verify context sufficiency before execution
 * - Identify required patterns for task types
 * - Auto-escalate to full context on quality failures
 * - Log context gaps for learning and improvement
 *
 * Usage:
 *   const { verifyContextSufficiency } = require('./flow-quality-guard');
 *
 *   const check = verifyContextSufficiency(task, context, model);
 *   if (!check.sufficient) {
 *     // Auto-escalate to full context
 *   }
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  readFile,
  writeFile,
  info,
  warn,
  success,
  estimateTokens
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

/**
 * Patterns required for different task categories
 */
const REQUIRED_PATTERNS = {
  security: {
    keywords: ['security', 'auth', 'password', 'token', 'encrypt', 'validate', 'sanitize'],
    requiredSections: ['security', 'try-catch', 'error-handling'],
    requiredPins: ['security', 'input-validation', 'try-catch']
  },
  component: {
    keywords: ['component', 'button', 'input', 'form', 'modal', 'ui', 'widget'],
    requiredSections: ['component', 'naming', 'variant'],
    requiredPins: ['component', 'naming-convention', 'component-reuse']
  },
  api: {
    keywords: ['api', 'endpoint', 'route', 'controller', 'service', 'request'],
    requiredSections: ['api', 'error-handling', 'validation'],
    requiredPins: ['api', 'error-handling', 'try-catch']
  },
  file: {
    keywords: ['file', 'fs', 'read', 'write', 'path', 'directory'],
    requiredSections: ['file-safety', 'try-catch', 'path-validation'],
    requiredPins: ['try-catch', 'file-safety', 'path-traversal']
  },
  database: {
    keywords: ['database', 'db', 'sql', 'query', 'model', 'migration'],
    requiredSections: ['database', 'query-safety', 'transaction'],
    requiredPins: ['database', 'sql-injection', 'transaction']
  }
};

/**
 * Context gap log path
 */
const CONTEXT_GAP_LOG = path.join(PROJECT_ROOT, '.workflow', 'state', 'context-gaps.json');

/**
 * Coverage thresholds for context sufficiency
 * Different models need different coverage levels based on their capabilities
 */
const COVERAGE_THRESHOLDS = {
  default: 0.7,         // Default: 70% coverage required
  comprehensive: 0.85,  // Haiku/Local LLMs need higher coverage
  concise: 0.5          // Opus can infer more from less context
};

// ============================================================
// Pattern Analysis
// ============================================================

/**
 * Identify task category from description
 * @param {string} taskDescription - Task description
 * @returns {string[]} - Categories that apply
 */
function identifyTaskCategories(taskDescription) {
  const descLower = taskDescription.toLowerCase();
  const categories = [];

  for (const [category, config] of Object.entries(REQUIRED_PATTERNS)) {
    const matchCount = config.keywords.filter(kw => descLower.includes(kw)).length;
    if (matchCount > 0) {
      categories.push(category);
    }
  }

  return categories;
}

/**
 * Get required patterns for a task
 * @param {string} taskDescription - Task description
 * @returns {Object} - Required patterns
 */
function identifyRequiredPatterns(taskDescription) {
  const categories = identifyTaskCategories(taskDescription);

  const requiredSections = new Set();
  const requiredPins = new Set();

  for (const category of categories) {
    const config = REQUIRED_PATTERNS[category];
    if (config) {
      config.requiredSections.forEach(s => requiredSections.add(s));
      config.requiredPins.forEach(p => requiredPins.add(p));
    }
  }

  return {
    categories,
    sections: Array.from(requiredSections),
    pins: Array.from(requiredPins)
  };
}

/**
 * Extract patterns from gathered context
 * @param {Object} context - Context result from gatherContext
 * @returns {Object} - Extracted patterns
 */
function extractPatternsFromContext(context) {
  const sections = context.sections || [];
  const includedSections = new Set();
  const includedPins = new Set();

  for (const section of sections) {
    // Add section category
    if (section.category) {
      includedSections.add(section.category.toLowerCase());
    }

    // Add section ID parts
    if (section.id) {
      section.id.split(/[-:_]/).forEach(part => {
        if (part.length > 2) {
          includedSections.add(part.toLowerCase());
        }
      });
    }

    // Add pins
    if (section.pins && Array.isArray(section.pins)) {
      section.pins.forEach(p => includedPins.add(p.toLowerCase()));
    }

    // Extract pins from content if available
    if (section.content) {
      // Look for common pattern keywords in content
      const contentLower = section.content.toLowerCase();
      if (contentLower.includes('try-catch') || contentLower.includes('try {')) {
        includedPins.add('try-catch');
      }
      if (contentLower.includes('security') || contentLower.includes('secure')) {
        includedPins.add('security');
      }
      if (contentLower.includes('validate') || contentLower.includes('validation')) {
        includedPins.add('validation');
      }
    }
  }

  return {
    sections: Array.from(includedSections),
    pins: Array.from(includedPins)
  };
}

// ============================================================
// Quality Verification
// ============================================================

/**
 * Verify context sufficiency for a task
 * @param {string} taskDescription - Task description
 * @param {Object} context - Gathered context result
 * @param {string} model - Model being used
 * @returns {Object} - { sufficient, missing, coverage, recommendation }
 */
function verifyContextSufficiency(taskDescription, context, model) {
  const required = identifyRequiredPatterns(taskDescription);
  const included = extractPatternsFromContext(context);

  // Check if no specific patterns required
  if (required.sections.length === 0 && required.pins.length === 0) {
    return {
      sufficient: true,
      reason: 'No specific patterns required for this task',
      categories: [],
      coverage: 1.0
    };
  }

  // Calculate coverage
  const missingSections = required.sections.filter(s =>
    !included.sections.some(is => is.includes(s) || s.includes(is))
  );

  const missingPins = required.pins.filter(p =>
    !included.pins.some(ip => ip.includes(p) || p.includes(ip))
  );

  const totalRequired = required.sections.length + required.pins.length;
  const totalMissing = missingSections.length + missingPins.length;
  const coverage = totalRequired > 0 ? (totalRequired - totalMissing) / totalRequired : 1.0;

  // Determine sufficiency threshold based on model
  let minCoverage = COVERAGE_THRESHOLDS.default;
  try {
    const instructionRichness = require('./flow-instruction-richness');
    const modelPrefs = instructionRichness.getModelContextPreferences(model);
    // Models with comprehensive density need higher coverage
    if (modelPrefs.density === 'comprehensive') {
      minCoverage = COVERAGE_THRESHOLDS.comprehensive;
    } else if (modelPrefs.density === 'concise') {
      minCoverage = COVERAGE_THRESHOLDS.concise;
    }
  } catch {
    // Use default
  }

  const sufficient = coverage >= minCoverage;

  return {
    sufficient,
    coverage,
    minCoverage,
    categories: required.categories,
    required: {
      sections: required.sections,
      pins: required.pins
    },
    included: {
      sections: included.sections,
      pins: included.pins
    },
    missing: {
      sections: missingSections,
      pins: missingPins
    },
    recommendation: sufficient
      ? 'Context is sufficient for quality execution'
      : 'Recommend escalating to full context for quality guarantee'
  };
}

/**
 * Quick check if context is likely sufficient
 * @param {string} taskDescription - Task description
 * @param {Object} context - Gathered context
 * @returns {boolean} - Quick sufficiency check
 */
function isContextLikelySufficient(taskDescription, context) {
  const result = verifyContextSufficiency(taskDescription, context, 'default');
  return result.sufficient;
}

// ============================================================
// Context Gap Logging
// ============================================================

/**
 * Log a context gap for learning
 * @param {Object} params - Gap information
 */
function logContextGap(params) {
  const {
    task,
    model,
    context,
    missing,
    timestamp = new Date().toISOString()
  } = params;

  // Load existing gaps
  let gaps = [];
  try {
    if (fileExists(CONTEXT_GAP_LOG)) {
      const content = readFile(CONTEXT_GAP_LOG);
      gaps = JSON.parse(content);
    }
  } catch {
    gaps = [];
  }

  // Add new gap
  gaps.push({
    timestamp,
    task: task.slice(0, 200), // Truncate long tasks
    model,
    sectionsIncluded: context.sections?.length || 0,
    missing,
    escalated: true
  });

  // Keep last 100 gaps
  if (gaps.length > 100) {
    gaps = gaps.slice(-100);
  }

  // Write back
  try {
    const dir = path.dirname(CONTEXT_GAP_LOG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeFile(CONTEXT_GAP_LOG, JSON.stringify(gaps, null, 2));
  } catch (err) {
    warn(`Could not log context gap: ${err.message}`);
  }
}

/**
 * Get context gap statistics
 * @returns {Object} - Gap statistics
 */
function getContextGapStats() {
  try {
    if (!fileExists(CONTEXT_GAP_LOG)) {
      return { totalGaps: 0, recentGaps: 0, commonMissing: [] };
    }

    const content = readFile(CONTEXT_GAP_LOG);
    const gaps = JSON.parse(content);

    // Count common missing patterns
    const missingCount = {};
    for (const gap of gaps) {
      const allMissing = [
        ...(gap.missing?.sections || []),
        ...(gap.missing?.pins || [])
      ];
      for (const m of allMissing) {
        missingCount[m] = (missingCount[m] || 0) + 1;
      }
    }

    // Sort by frequency
    const commonMissing = Object.entries(missingCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // Recent gaps (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentGaps = gaps.filter(g => g.timestamp > oneDayAgo).length;

    return {
      totalGaps: gaps.length,
      recentGaps,
      commonMissing
    };
  } catch (err) {
    return { totalGaps: 0, recentGaps: 0, commonMissing: [], error: err.message };
  }
}

// ============================================================
// Full Context Fallback
// ============================================================

/**
 * Load full context (fallback when dynamic context insufficient)
 * @param {string} taskDescription - Task description
 * @returns {Promise<Object>} - Full context result
 */
async function loadFullContext(taskDescription) {
  // Try to use the context gatherer with maximum tokens
  try {
    const contextGatherer = require('./flow-context-gatherer');

    return await contextGatherer.gatherContext({
      task: taskDescription,
      model: 'claude-sonnet-4', // Use standard model preferences
      maxTokens: 150000, // Maximum context
      format: 'full'
    });
  } catch (err) {
    // Fallback: return empty context with warning
    warn(`Could not load full context: ${err.message}`);
    return {
      context: '',
      sections: [],
      stats: { fallback: true, error: err.message }
    };
  }
}

/**
 * Gather context with quality guarantee
 * Auto-escalates to full context if dynamic context is insufficient
 *
 * @param {Object} params - { task, model, maxTokens }
 * @returns {Promise<Object>} - Context with quality guarantee
 */
async function gatherContextWithQualityGuard(params) {
  const { task, model, maxTokens = null } = params;

  // First, try dynamic context
  let contextGatherer;
  try {
    contextGatherer = require('./flow-context-gatherer');
  } catch {
    // No context gatherer, return empty
    return { context: '', sections: [], stats: { error: 'Context gatherer not available' } };
  }

  const dynamicResult = await contextGatherer.gatherContext({
    task,
    model,
    maxTokens,
    format: 'full'
  });

  // Verify sufficiency
  const verification = verifyContextSufficiency(task, dynamicResult, model);

  if (verification.sufficient) {
    return {
      ...dynamicResult,
      qualityGuard: {
        verified: true,
        coverage: verification.coverage,
        escalated: false
      }
    };
  }

  // Log the gap
  logContextGap({
    task,
    model,
    context: dynamicResult,
    missing: verification.missing
  });

  // Escalate to full context
  info('Quality guard: Escalating to full context for quality guarantee');
  const fullResult = await loadFullContext(task);

  return {
    ...fullResult,
    qualityGuard: {
      verified: true,
      coverage: verification.coverage,
      escalated: true,
      reason: verification.recommendation,
      missing: verification.missing
    }
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Pattern analysis
  identifyTaskCategories,
  identifyRequiredPatterns,
  extractPatternsFromContext,

  // Quality verification
  verifyContextSufficiency,
  isContextLikelySufficient,

  // Gap logging
  logContextGap,
  getContextGapStats,

  // Context with quality guarantee
  loadFullContext,
  gatherContextWithQualityGuard,

  // Constants
  REQUIRED_PATTERNS,
  CONTEXT_GAP_LOG,
  COVERAGE_THRESHOLDS
};

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'verify': {
      const taskDesc = args.slice(1).join(' ');
      if (!taskDesc) {
        console.error('Usage: flow-quality-guard verify "<task description>"');
        process.exit(1);
      }

      // Get context and verify
      try {
        const contextGatherer = require('./flow-context-gatherer');
        const context = await contextGatherer.gatherContext({
          task: taskDesc,
          model: 'claude-sonnet-4',
          format: 'full'
        });

        const result = verifyContextSufficiency(taskDesc, context, 'claude-sonnet-4');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
      }
      break;
    }

    case 'gaps': {
      const stats = getContextGapStats();
      console.log('\n=== Context Gap Statistics ===\n');
      console.log(`Total gaps logged: ${stats.totalGaps}`);
      console.log(`Recent gaps (24h): ${stats.recentGaps}`);
      if (stats.commonMissing.length > 0) {
        console.log('\nMost commonly missing patterns:');
        for (const { pattern, count } of stats.commonMissing) {
          console.log(`  ${pattern}: ${count} occurrences`);
        }
      }
      break;
    }

    case 'gather': {
      const taskDesc = args.slice(1).join(' ');
      if (!taskDesc) {
        console.error('Usage: flow-quality-guard gather "<task description>"');
        process.exit(1);
      }

      const result = await gatherContextWithQualityGuard({
        task: taskDesc,
        model: 'claude-sonnet-4'
      });

      console.log('\n=== Context with Quality Guard ===\n');
      console.log(`Sections: ${result.sections?.length || 0}`);
      console.log(`Tokens: ${result.stats?.totalTokens || 'unknown'}`);
      console.log(`Quality verified: ${result.qualityGuard?.verified}`);
      console.log(`Escalated: ${result.qualityGuard?.escalated}`);
      if (result.qualityGuard?.missing) {
        console.log(`Missing: ${JSON.stringify(result.qualityGuard.missing)}`);
      }
      break;
    }

    default:
      console.log(`
Usage: node scripts/flow-quality-guard.js <command> [args]

Commands:
  verify "<task>"   Verify if context is sufficient for a task
  gaps              Show context gap statistics
  gather "<task>"   Gather context with quality guarantee

Examples:
  node scripts/flow-quality-guard.js verify "Add user authentication"
  node scripts/flow-quality-guard.js gaps
  node scripts/flow-quality-guard.js gather "Create secure file upload"
`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
