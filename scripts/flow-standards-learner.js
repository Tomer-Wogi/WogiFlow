#!/usr/bin/env node

/**
 * Wogi Flow - Standards Learner
 *
 * Learns from standards violations to prevent recurrence:
 * - Records violations to feedback-patterns.md
 * - Promotes patterns to decisions.md after threshold occurrences
 * - Generates prevention prompts for future tasks
 * - Syncs rules to .claude/rules/ directory
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  readFile,
  writeFile,
  getConfig,
  color
} = require('./flow-utils');

// ============================================================================
// Constants
// ============================================================================

const FEEDBACK_PATTERNS_PATH = path.join(PATHS.state, 'feedback-patterns.md');
const DECISIONS_PATH = path.join(PATHS.state, 'decisions.md');
const RULES_DIR = path.join(process.cwd(), '.claude', 'rules');

// Violation type to learning category mapping
const VIOLATION_LEARNING_MAP = {
  'naming-conventions': {
    category: 'code-style',
    subcategory: 'naming',
    patterns: {
      'catch-block': {
        pattern: 'Use err in catch blocks',
        preventionPrompt: 'When writing try/catch, always use `err` as the catch variable, never `e`.',
        ruleTemplate: `### Catch Block Variables
**Rule**: Use \`err\` for all catch blocks in this codebase.
**Avoid**: \`e\`, \`error\`, \`ex\`, \`exception\`
**Example**: \`catch (err) { console.error(err.message); }\``
      },
      'file-naming': {
        pattern: 'Kebab-case file names',
        preventionPrompt: 'File names must be kebab-case (flow-utils.js, not flowUtils.js).',
        ruleTemplate: `### File Names
**Rule**: Use kebab-case for all file names.
**Good**: \`flow-utils.js\`, \`my-component.tsx\`
**Bad**: \`flowUtils.js\`, \`MyComponent.tsx\``
      }
    }
  },
  'component-duplication': {
    category: 'architecture',
    subcategory: 'component-reuse',
    patterns: {
      'similar-component': {
        pattern: 'Check app-map before creating components',
        preventionPrompt: 'BEFORE creating a new component, check app-map.md for existing similar components.',
        ruleTemplate: `### Component Reuse
**Rule**: Always check app-map.md before creating components.
**Priority**: Use existing → Add variant → Extend → Create new (last resort)`
      }
    }
  },
  'function-duplication': {
    category: 'architecture',
    subcategory: 'function-reuse',
    patterns: {
      'similar-function': {
        pattern: 'Check function-map before creating utilities',
        preventionPrompt: 'BEFORE creating a new utility function, check function-map.md for existing similar functions.',
        ruleTemplate: `### Function Reuse
**Rule**: Always check function-map.md before creating utility functions.
**Consider**: Can you extend an existing function instead?`
      }
    }
  },
  'security': {
    category: 'security',
    subcategory: 'security-patterns',
    patterns: {
      'json-parse': {
        pattern: 'Use safeJsonParse for external data',
        preventionPrompt: 'Use safeJsonParse() from flow-utils.js instead of raw JSON.parse().',
        ruleTemplate: `### JSON Parsing Safety
**Rule**: Use \`safeJsonParse()\` from flow-utils.js instead of raw \`JSON.parse()\`.
**Why**: Protects against prototype pollution and handles errors gracefully.`
      },
      'file-read': {
        pattern: 'Wrap file reads in try-catch',
        preventionPrompt: 'Always wrap fs.readFileSync() in try-catch, even after existence checks.',
        ruleTemplate: `### File Read Safety
**Rule**: Wrap \`fs.readFileSync()\` in try-catch, even after \`fileExists()\` check.
**Why**: Race conditions, permissions, symlinks can still cause failures.`
      }
    }
  }
};

// ============================================================================
// Pattern Analysis
// ============================================================================

/**
 * Analyze a violation and generate learning insight
 * @param {Object} violation - The standards violation
 * @param {Object} taskContext - Task context (title, type, filesToChange)
 * @returns {Object} Learning analysis
 */
function analyzeViolationForLearning(violation, taskContext = {}) {
  const violationType = violation.type;
  const mapping = VIOLATION_LEARNING_MAP[violationType];

  if (!mapping) {
    return {
      canLearn: false,
      reason: `No learning mapping for violation type: ${violationType}`
    };
  }

  // Determine specific pattern within the type
  let specificPattern = null;
  const message = (violation.message || '').toLowerCase();

  if (violationType === 'naming-conventions') {
    if (message.includes('catch') || message.includes('err')) {
      specificPattern = mapping.patterns['catch-block'];
    } else if (message.includes('file') || message.includes('kebab')) {
      specificPattern = mapping.patterns['file-naming'];
    }
  } else if (violationType === 'component-duplication') {
    specificPattern = mapping.patterns['similar-component'];
  } else if (violationType === 'function-duplication') {
    specificPattern = mapping.patterns['similar-function'];
  } else if (violationType === 'security') {
    if (message.includes('json') || message.includes('parse')) {
      specificPattern = mapping.patterns['json-parse'];
    } else if (message.includes('file') || message.includes('read')) {
      specificPattern = mapping.patterns['file-read'];
    }
  }

  if (!specificPattern) {
    specificPattern = Object.values(mapping.patterns)[0] || {
      pattern: `${violationType} violation`,
      preventionPrompt: `Avoid ${violationType} violations.`,
      ruleTemplate: `### ${violationType}\nRule: Follow project standards.`
    };
  }

  return {
    canLearn: true,
    violationType,
    category: mapping.category,
    subcategory: mapping.subcategory,
    patternName: specificPattern.pattern,
    preventionPrompt: specificPattern.preventionPrompt,
    ruleTemplate: specificPattern.ruleTemplate,
    file: violation.file,
    line: violation.line,
    message: violation.message,
    taskId: taskContext?.id,
    taskType: taskContext?.type
  };
}

// ============================================================================
// Feedback Patterns Management
// ============================================================================

/**
 * Parse feedback-patterns.md to get current pattern counts
 * @returns {Object} Map of pattern name to count
 */
function parsePatternCounts() {
  if (!fileExists(FEEDBACK_PATTERNS_PATH)) {
    return {};
  }

  const content = readFile(FEEDBACK_PATTERNS_PATH, '');
  const counts = {};

  // Parse the patterns log table
  // Format: | Date | Correction | Count | Promoted To | Status |
  const tableRegex = /\|\s*[\d-]+\s*\|\s*([^|]+)\s*\|\s*(\d+)\s*\|/g;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const correction = match[1].trim();
    const count = parseInt(match[2], 10);
    counts[correction] = count;
  }

  return counts;
}

/**
 * Record a violation to feedback-patterns.md
 * @param {Object} learning - Learning analysis from analyzeViolationForLearning
 * @returns {Object} Result with newCount and shouldPromote
 */
function recordViolationPattern(learning) {
  if (!learning.canLearn) {
    return { recorded: false, reason: learning.reason };
  }

  // Get current counts
  const counts = parsePatternCounts();
  const patternKey = `${learning.violationType}-${learning.patternName}`.replace(/\s+/g, '-').toLowerCase();

  // Current count
  const currentCount = counts[patternKey] || 0;
  const newCount = currentCount + 1;

  // Read current content
  let content = fileExists(FEEDBACK_PATTERNS_PATH)
    ? readFile(FEEDBACK_PATTERNS_PATH, '')
    : getDefaultFeedbackPatternsContent();

  // Check if pattern already exists in table
  const dateStr = new Date().toISOString().split('T')[0];
  const patternRegex = new RegExp(`\\|\\s*[\\d-]+\\s*\\|\\s*${patternKey.replace(/[-]/g, '[-]?')}\\s*\\|\\s*(\\d+)\\s*\\|`, 'i');

  if (patternRegex.test(content)) {
    // Update existing count
    content = content.replace(patternRegex, `| ${dateStr} | ${patternKey} | ${newCount} |`);
  } else {
    // Add new entry to table
    const tableEndMarker = '| _example_ |';
    const newRow = `| ${dateStr} | ${patternKey} | ${newCount} | - | Monitor |\n`;

    if (content.includes(tableEndMarker)) {
      content = content.replace(tableEndMarker, newRow + tableEndMarker);
    } else {
      // Find end of Patterns Log table and insert
      const patternsLogIdx = content.indexOf('## Patterns Log');
      if (patternsLogIdx !== -1) {
        const nextSectionIdx = content.indexOf('\n---', patternsLogIdx);
        if (nextSectionIdx !== -1) {
          content = content.slice(0, nextSectionIdx) + newRow + content.slice(nextSectionIdx);
        }
      }
    }
  }

  // Write updated content
  try {
    fs.writeFileSync(FEEDBACK_PATTERNS_PATH, content, 'utf-8');
  } catch (err) {
    return { recorded: false, reason: err.message };
  }

  // Check if should promote
  const config = getConfig();
  const threshold = config.standardsCompliance?.learning?.promotionThreshold || 3;
  const shouldPromote = newCount >= threshold;

  return {
    recorded: true,
    patternKey,
    newCount,
    shouldPromote,
    threshold
  };
}

/**
 * Get default content for feedback-patterns.md if it doesn't exist
 */
function getDefaultFeedbackPatternsContent() {
  return `# Feedback Patterns

Aggregated patterns from standards violations. Patterns with 3+ occurrences are promoted to decisions.md.

---

## Patterns Log

| Date | Correction | Count | Promoted To | Status |
|------|------------|-------|-------------|--------|
| _example_ | "Use kebab-case for files" | 3 | decisions.md | Done |

---

## Pending Patterns

Patterns that have occurred but not yet promoted.

---
`;
}

// ============================================================================
// Rule Promotion
// ============================================================================

/**
 * Promote a pattern to decisions.md
 * @param {Object} learning - Learning analysis
 * @param {number} count - Number of occurrences
 * @returns {Object} Result
 */
function promoteToDecisions(learning, count) {
  if (!fileExists(DECISIONS_PATH)) {
    return { promoted: false, reason: 'decisions.md not found' };
  }

  let content = readFile(DECISIONS_PATH, '');

  // Check if rule already exists
  if (content.includes(learning.patternName)) {
    return { promoted: false, reason: 'Rule already exists in decisions.md' };
  }

  // Find the appropriate section to add the rule
  const sectionMap = {
    'code-style': '## Coding Standards',
    'architecture': '## Architecture Decisions',
    'security': '## Coding Standards' // Security goes in coding standards
  };

  const targetSection = sectionMap[learning.category] || '## Coding Standards';
  const sectionIdx = content.indexOf(targetSection);

  if (sectionIdx === -1) {
    return { promoted: false, reason: `Section "${targetSection}" not found in decisions.md` };
  }

  // Find the next section after target
  const nextSectionIdx = content.indexOf('\n## ', sectionIdx + targetSection.length);

  // Build the rule entry
  const dateStr = new Date().toISOString().split('T')[0];
  const ruleEntry = `

### ${learning.patternName} (${dateStr})
**Source**: ${count} violations recorded in feedback-patterns.md
**Problem**: ${learning.message || learning.violationType}

${learning.ruleTemplate}
`;

  // Insert the rule
  if (nextSectionIdx !== -1) {
    content = content.slice(0, nextSectionIdx) + ruleEntry + '\n---\n' + content.slice(nextSectionIdx);
  } else {
    content += ruleEntry;
  }

  // Write updated content
  try {
    fs.writeFileSync(DECISIONS_PATH, content, 'utf-8');
  } catch (err) {
    return { promoted: false, reason: err.message };
  }

  // Update feedback-patterns.md to mark as promoted
  try {
    let patternsContent = readFile(FEEDBACK_PATTERNS_PATH, '');
    const patternKey = `${learning.violationType}-${learning.patternName}`.replace(/\s+/g, '-').toLowerCase();
    patternsContent = patternsContent.replace(
      new RegExp(`(\\|\\s*[\\d-]+\\s*\\|\\s*${patternKey}\\s*\\|\\s*\\d+\\s*\\|)\\s*-\\s*\\|\\s*Monitor\\s*\\|`, 'i'),
      `$1 decisions.md | **PROMOTED** |`
    );
    fs.writeFileSync(FEEDBACK_PATTERNS_PATH, patternsContent, 'utf-8');
  } catch (err) {
    // Non-fatal, rule was already promoted to decisions
  }

  return {
    promoted: true,
    section: targetSection,
    patternName: learning.patternName
  };
}

/**
 * Sync promoted rule to .claude/rules/ directory
 * @param {Object} learning - Learning analysis
 * @returns {Object} Result
 */
function syncToRulesDir(learning) {
  const config = getConfig();
  if (!config.standardsCompliance?.learning?.autoSyncRules) {
    return { synced: false, reason: 'autoSyncRules disabled in config' };
  }

  const categoryDir = path.join(RULES_DIR, learning.category);

  // Ensure directory exists
  try {
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
  } catch (err) {
    return { synced: false, reason: `Failed to create rules directory: ${err.message}` };
  }

  // Create/update rule file
  const fileName = `${learning.subcategory || learning.category}.md`;
  const filePath = path.join(categoryDir, fileName);

  let existingContent = '';
  if (fileExists(filePath)) {
    existingContent = readFile(filePath, '');
    // Check if rule already exists
    if (existingContent.includes(learning.patternName)) {
      return { synced: false, reason: 'Rule already exists in rules file' };
    }
  }

  // Add rule to file
  const ruleContent = `
## ${learning.patternName}

${learning.ruleTemplate}

---
`;

  const newContent = existingContent + ruleContent;

  try {
    fs.writeFileSync(filePath, newContent, 'utf-8');
  } catch (err) {
    return { synced: false, reason: err.message };
  }

  return {
    synced: true,
    filePath: path.relative(process.cwd(), filePath)
  };
}

// ============================================================================
// Prevention Prompts
// ============================================================================

/**
 * Get prevention prompts for a task based on past violations
 * @param {string} taskType - Task type
 * @param {string[]} changedFiles - Files that will be changed
 * @returns {string[]} Array of prevention prompts
 */
function getPreventionPrompts(taskType, changedFiles = []) {
  const config = getConfig();
  if (!config.standardsCompliance?.learning?.includePreventionPrompts) {
    return [];
  }

  const prompts = [];

  // Always include naming reminders
  prompts.push('REMINDER: Use `err` in catch blocks, not `e`.');
  prompts.push('REMINDER: File names must be kebab-case.');

  // Add task-type specific reminders
  if (taskType === 'component' || taskType === 'feature') {
    prompts.push('REMINDER: Check app-map.md before creating new components.');
  }

  if (taskType === 'utility' || taskType === 'feature') {
    prompts.push('REMINDER: Check function-map.md before creating new utilities.');
  }

  // Add file-specific reminders
  const hasJsFiles = changedFiles.some(f => /\.(js|ts|tsx|jsx)$/.test(f));
  if (hasJsFiles) {
    prompts.push('REMINDER: Use safeJsonParse() instead of raw JSON.parse().');
    prompts.push('REMINDER: Wrap fs.readFileSync() in try-catch.');
  }

  return prompts;
}

/**
 * Format prevention prompts for display
 * @param {string[]} prompts - Array of prompts
 * @returns {string} Formatted string
 */
function formatPreventionPrompts(prompts) {
  if (prompts.length === 0) return '';

  const lines = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🧠 PREVENTION PROMPTS (from past violations)');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  for (const prompt of prompts) {
    lines.push(`  • ${prompt}`);
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================================
// Main Learning Function
// ============================================================================

/**
 * Process violations and learn from them
 * @param {Object[]} violations - Array of violations
 * @param {Object} taskContext - Task context
 * @returns {Object} Learning results
 */
function learnFromViolations(violations, taskContext = {}) {
  const results = {
    recorded: [],
    promoted: [],
    synced: [],
    errors: []
  };

  for (const violation of violations) {
    // Analyze the violation
    const learning = analyzeViolationForLearning(violation, taskContext);

    if (!learning.canLearn) {
      results.errors.push({ violation: violation.type, reason: learning.reason });
      continue;
    }

    // Record to feedback-patterns.md
    const recordResult = recordViolationPattern(learning);

    if (recordResult.recorded) {
      results.recorded.push({
        patternKey: recordResult.patternKey,
        newCount: recordResult.newCount
      });

      // Check if we should promote
      if (recordResult.shouldPromote) {
        const promoteResult = promoteToDecisions(learning, recordResult.newCount);

        if (promoteResult.promoted) {
          results.promoted.push({
            patternName: learning.patternName,
            section: promoteResult.section
          });

          // Sync to rules directory
          const syncResult = syncToRulesDir(learning);
          if (syncResult.synced) {
            results.synced.push({ filePath: syncResult.filePath });
          }
        }
      }
    } else {
      results.errors.push({ violation: violation.type, reason: recordResult.reason });
    }
  }

  return results;
}

/**
 * Format learning results for display
 * @param {Object} results - Learning results
 * @returns {string} Formatted output
 */
function formatLearningResults(results) {
  const lines = [];

  if (results.recorded.length === 0 && results.promoted.length === 0) {
    return '';
  }

  lines.push('');
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push(color('cyan', '🧠 LEARNING FROM VIOLATIONS'));
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push('');

  if (results.recorded.length > 0) {
    lines.push('Patterns recorded:');
    for (const r of results.recorded) {
      lines.push(`  • ${r.patternKey} (occurrence #${r.newCount})`);
    }
    lines.push('');
  }

  if (results.promoted.length > 0) {
    lines.push(color('green', 'Rules promoted to decisions.md:'));
    for (const p of results.promoted) {
      lines.push(color('green', `  ✓ ${p.patternName} → ${p.section}`));
    }
    lines.push('');
  }

  if (results.synced.length > 0) {
    lines.push(color('green', 'Synced to .claude/rules/:'));
    for (const s of results.synced) {
      lines.push(color('green', `  ✓ ${s.filePath}`));
    }
    lines.push('');
  }

  if (results.errors.length > 0) {
    lines.push(color('yellow', 'Learning errors (non-blocking):'));
    for (const e of results.errors) {
      lines.push(color('dim', `  • ${e.violation}: ${e.reason}`));
    }
    lines.push('');
  }

  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  return lines.join('\n');
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Standards Learner

Usage: node flow-standards-learner.js [command] [options]

Commands:
  prompts [taskType]    Get prevention prompts for a task type
  stats                 Show pattern statistics

Options:
  --json               Output as JSON
  -h, --help           Show this help

Examples:
  node flow-standards-learner.js prompts component
  node flow-standards-learner.js stats
`);
    process.exit(0);
  }

  const command = args[0];
  const jsonOutput = args.includes('--json');

  if (command === 'prompts') {
    const taskType = args[1] || 'feature';
    const prompts = getPreventionPrompts(taskType, []);

    if (jsonOutput) {
      console.log(JSON.stringify({ taskType, prompts }, null, 2));
    } else {
      console.log(formatPreventionPrompts(prompts));
    }
  } else if (command === 'stats') {
    const counts = parsePatternCounts();

    if (jsonOutput) {
      console.log(JSON.stringify(counts, null, 2));
    } else {
      console.log('Pattern Statistics:');
      for (const [pattern, count] of Object.entries(counts)) {
        console.log(`  ${pattern}: ${count} occurrences`);
      }
    }
  } else {
    console.log('Unknown command. Use --help for usage.');
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  analyzeViolationForLearning,
  recordViolationPattern,
  promoteToDecisions,
  syncToRulesDir,
  getPreventionPrompts,
  formatPreventionPrompts,
  learnFromViolations,
  formatLearningResults,
  parsePatternCounts,
  VIOLATION_LEARNING_MAP
};
