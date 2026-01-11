#!/usr/bin/env node

/**
 * Wogi Flow - Auto Learning System
 *
 * Automatically captures learnings from:
 * - Session reviews (code quality, security, architecture issues)
 * - Bug fixes (patterns that were violated)
 *
 * Logs to feedback-patterns.md and suggests/auto-promotes to decisions.md
 * when patterns reach the promotion threshold.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  getConfig,
  color,
  success,
  info,
  warn
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const FEEDBACK_PATTERNS_PATH = path.join(PATHS.state, 'feedback-patterns.md');
const DECISIONS_PATH = path.join(PATHS.state, 'decisions.md');

// Map issue types to normalized pattern names
const ISSUE_TO_PATTERN = {
  // Security issues
  'security:eval_usage': 'no-eval',
  'security:innerhtml_xss': 'sanitize-html-output',
  'security:hardcoded_credentials': 'use-env-for-secrets',
  'security:missing_error_handling': 'handle-async-errors',
  'security:command_injection': 'sanitize-shell-commands',
  'security:sql_injection': 'use-parameterized-queries',

  // Implementation issues
  'implementation:magic_numbers': 'use-named-constants',
  'implementation:deep_nesting': 'flatten-nested-logic',
  'implementation:duplicate_strings': 'extract-string-constants',
  'implementation:long_function': 'split-long-functions',
  'implementation:complex_condition': 'simplify-conditions',

  // Architecture issues
  'architecture:god_object': 'split-large-files',
  'architecture:mixed_concerns': 'separate-concerns',
  'architecture:tight_coupling': 'reduce-coupling',
  'architecture:circular_dependency': 'break-circular-deps',

  // Basic issues
  'basic:console_log': 'remove-console-logs',
  'basic:todo_fixme': 'resolve-todos-before-merge',
  'basic:empty_catch': 'handle-catch-blocks',
  'basic:debugger': 'remove-debugger-statements',

  // From previous session reviews
  'file_read_no_try_catch': 'try-catch-file-reads',
  'json_parse_unsafe': 'use-safe-json-parse',
  'glob_path_separator': 'glob-no-path-separator',
  'template_prototype': 'template-prototype-protection',
  'json_no_validation': 'validate-json-structure'
};

// Default configuration
const DEFAULT_CONFIG = {
  enabled: true,
  captureFrom: {
    sessionReview: true,
    bugFix: true
  },
  confidenceThreshold: 80,
  promotionThreshold: 3,
  autoPromote: false
};

// Table format constants (DRY)
const TABLE_FORMAT = {
  header: '| Date | Pattern | Source | Count | Confidence | Status |',
  separator: '|------|---------|--------|-------|------------|--------|',
  sectionHeader: '## Auto-Captured Patterns',
  sectionRegex: /## Auto-Captured Patterns\s*\n\n\|[^\n]+\|\s*\n\|[-|\s]+\|\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/
};

// Confidence update weight (0-1, higher means more weight to recent observations)
const CONFIDENCE_WEIGHT_RECENT = 0.7;

// ============================================================
// Configuration
// ============================================================

/**
 * Get auto-learning configuration
 * @returns {Object} Config with defaults applied
 */
function getAutoLearnConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONFIG,
    ...(config?.autoLearning || {})
  };
}

// ============================================================
// Pattern Normalization
// ============================================================

/**
 * Convert issue to normalized pattern name
 * @param {Object} issue - Issue from session review
 * @returns {string} Normalized pattern name
 */
function normalizeIssueToPattern(issue) {
  // Create key from perspective:type
  const perspective = issue.perspective || issue.category || 'unknown';
  const type = issue.type || slugify(issue.description || '');
  const key = `${perspective}:${type}`;

  // Check explicit mapping
  if (ISSUE_TO_PATTERN[key]) {
    return ISSUE_TO_PATTERN[key];
  }

  // Check if type alone matches
  if (ISSUE_TO_PATTERN[type]) {
    return ISSUE_TO_PATTERN[type];
  }

  // Generate from description (kebab-case, max 5 words)
  const desc = issue.description || issue.type || 'unknown-pattern';
  return slugify(desc.split(' ').slice(0, 5).join(' '));
}

/**
 * Convert string to kebab-case
 * @param {string} str - Input string
 * @returns {string} Kebab-case string
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

// ============================================================
// Feedback Patterns File Management
// ============================================================

/**
 * Parse feedback-patterns.md to extract auto-captured patterns
 * @returns {Array} Array of pattern objects
 */
function loadAutoPatterns() {
  if (!fileExists(FEEDBACK_PATTERNS_PATH)) {
    return [];
  }

  try {
    const content = fs.readFileSync(FEEDBACK_PATTERNS_PATH, 'utf-8');

    // Find Auto-Captured Patterns section (using DRY constant)
    const sectionMatch = content.match(TABLE_FORMAT.sectionRegex);
    if (!sectionMatch) {
      return [];
    }

    const tableContent = sectionMatch[1];
    const patterns = [];

    // Parse table rows
    const rows = tableContent.trim().split('\n').filter(line => line.startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 5) {
        patterns.push({
          date: cells[0],
          pattern: cells[1],
          source: cells[2],
          count: parseInt(cells[3], 10) || 1,
          confidence: parseInt(cells[4], 10) || 80,
          status: cells[5] || 'Monitor'
        });
      }
    }

    return patterns;
  } catch (err) {
    warn(`Could not parse feedback-patterns.md: ${err.message}`);
    return [];
  }
}

/**
 * Save auto-captured patterns back to feedback-patterns.md
 * @param {Array} patterns - Array of pattern objects
 */
function saveAutoPatterns(patterns) {
  if (!fileExists(FEEDBACK_PATTERNS_PATH)) {
    warn(`Could not save patterns: feedback-patterns.md not found`);
    return;
  }

  try {
    let content = fs.readFileSync(FEEDBACK_PATTERNS_PATH, 'utf-8');

    // Build new table (using DRY constants)
    const rows = patterns.map(p =>
      `| ${p.date} | ${p.pattern} | ${p.source} | ${p.count} | ${p.confidence}% | ${p.status} |`
    );

    const newSection = `${TABLE_FORMAT.sectionHeader}\n\n${TABLE_FORMAT.header}\n${TABLE_FORMAT.separator}\n${rows.join('\n')}`;

    // Replace or add section
    if (content.includes('## Auto-Captured Patterns')) {
      content = content.replace(
        /## Auto-Captured Patterns[\s\S]*?(?=\n## |\n---\n\n## |$)/,
        newSection + '\n\n'
      );
    } else {
      // Add before "## Promotion History" or at the end
      if (content.includes('## Promotion History')) {
        content = content.replace('## Promotion History', newSection + '\n\n---\n\n## Promotion History');
      } else {
        content = content.trimEnd() + '\n\n---\n\n' + newSection + '\n';
      }
    }

    fs.writeFileSync(FEEDBACK_PATTERNS_PATH, content, 'utf-8');
  } catch (err) {
    warn(`Could not save feedback-patterns.md: ${err.message}`);
  }
}

// ============================================================
// Core Learning Functions
// ============================================================

/**
 * Capture learnings from session review issues
 * @param {Array} issues - Issues from session review
 */
function captureFromSessionReview(issues) {
  const config = getAutoLearnConfig();

  if (!config.enabled || !config.captureFrom.sessionReview) {
    return;
  }

  // Filter by confidence threshold
  const validIssues = issues.filter(i =>
    (i.confidence || 80) >= config.confidenceThreshold
  );

  if (validIssues.length === 0) {
    return;
  }

  const patterns = loadAutoPatterns();
  const today = new Date().toISOString().split('T')[0];
  let capturedCount = 0;
  const promotionCandidates = [];

  for (const issue of validIssues) {
    const patternName = normalizeIssueToPattern(issue);
    const confidence = issue.confidence || 80;

    // Check if pattern already exists
    const existing = patterns.find(p => p.pattern === patternName);

    if (existing) {
      // Increment count and update confidence (weighted average favoring recent)
      existing.count += 1;
      existing.confidence = Math.round(
        (1 - CONFIDENCE_WEIGHT_RECENT) * existing.confidence +
        CONFIDENCE_WEIGHT_RECENT * confidence
      );
      existing.date = today;

      // Check promotion threshold
      if (existing.count >= config.promotionThreshold && existing.status === 'Monitor') {
        existing.status = 'Ready';
        promotionCandidates.push(existing);
      }
    } else {
      // Add new pattern
      patterns.push({
        date: today,
        pattern: patternName,
        source: 'session-review',
        count: 1,
        confidence: confidence,
        status: 'Monitor'
      });
    }

    capturedCount++;
  }

  // Save updated patterns
  saveAutoPatterns(patterns);

  // Report
  if (capturedCount > 0) {
    info(`Auto-learned ${capturedCount} pattern(s) from session review`);
  }

  // Handle promotions
  for (const candidate of promotionCandidates) {
    handlePromotion(candidate, config);
  }
}

/**
 * Capture learnings from bug fix completion
 * @param {string} taskId - Task ID
 * @param {Array} files - Modified files
 * @param {string} description - Task description
 */
function captureFromBugFix(taskId, files, description) {
  const config = getAutoLearnConfig();

  if (!config.enabled || !config.captureFrom.bugFix) {
    return;
  }

  // Analyze the bug fix to detect patterns
  const detectedPatterns = analyzeBugFix(files, description);

  if (detectedPatterns.length === 0) {
    return;
  }

  const patterns = loadAutoPatterns();
  const today = new Date().toISOString().split('T')[0];
  const promotionCandidates = [];

  for (const detected of detectedPatterns) {
    const existing = patterns.find(p => p.pattern === detected.pattern);

    if (existing) {
      existing.count += 1;
      existing.date = today;

      if (existing.count >= config.promotionThreshold && existing.status === 'Monitor') {
        existing.status = 'Ready';
        promotionCandidates.push(existing);
      }
    } else {
      patterns.push({
        date: today,
        pattern: detected.pattern,
        source: 'bug-fix',
        count: 1,
        confidence: detected.confidence || 85,
        status: 'Monitor'
      });
    }
  }

  saveAutoPatterns(patterns);

  if (detectedPatterns.length > 0) {
    info(`Auto-learned ${detectedPatterns.length} pattern(s) from bug fix ${taskId}`);
  }

  for (const candidate of promotionCandidates) {
    handlePromotion(candidate, config);
  }
}

/**
 * Analyze bug fix files to detect violated patterns
 * @param {Array} files - Modified files
 * @param {string} description - Task description
 * @returns {Array} Detected patterns
 */
function analyzeBugFix(files, description) {
  const detected = [];
  const descLower = (description || '').toLowerCase();

  // Keyword-based pattern detection from description
  const keywordPatterns = [
    { keywords: ['try-catch', 'error handling', 'exception'], pattern: 'handle-async-errors' },
    { keywords: ['json parse', 'json.parse', 'parsing error'], pattern: 'use-safe-json-parse' },
    { keywords: ['null check', 'undefined', 'cannot read property'], pattern: 'null-safety-checks' },
    { keywords: ['path traversal', 'directory traversal'], pattern: 'validate-file-paths' },
    { keywords: ['xss', 'innerhtml', 'script injection'], pattern: 'sanitize-html-output' },
    { keywords: ['sql injection', 'query injection'], pattern: 'use-parameterized-queries' },
    { keywords: ['race condition', 'concurrent', 'async race'], pattern: 'handle-race-conditions' },
    { keywords: ['memory leak', 'cleanup', 'dispose'], pattern: 'cleanup-resources' },
    { keywords: ['validation', 'invalid input', 'input validation'], pattern: 'validate-input' },
    { keywords: ['timeout', 'deadline', 'hung'], pattern: 'add-timeouts' }
  ];

  for (const kp of keywordPatterns) {
    if (kp.keywords.some(k => descLower.includes(k))) {
      detected.push({ pattern: kp.pattern, confidence: 85 });
    }
  }

  // If no keywords matched, try to extract from file changes
  // (Could be enhanced to actually read the diff)
  if (detected.length === 0 && files.length > 0) {
    // Generic "bug fix" pattern based on file type
    const jsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    if (jsFiles.length > 0) {
      detected.push({ pattern: 'review-similar-code', confidence: 70 });
    }
  }

  return detected;
}

// ============================================================
// Promotion Handling
// ============================================================

/**
 * Handle pattern promotion
 * @param {Object} pattern - Pattern to promote
 * @param {Object} config - Auto-learn config
 */
function handlePromotion(pattern, config) {
  if (config.autoPromote) {
    // Auto-promote to decisions.md
    promoteToDecisions(pattern);
    success(`Auto-promoted pattern "${pattern.pattern}" to decisions.md`);
  } else {
    // Notify user
    console.log('');
    console.log(color('yellow', `Pattern ready for promotion: "${pattern.pattern}"`));
    console.log(`  Occurrences: ${pattern.count}`);
    console.log(`  Confidence: ${pattern.confidence}%`);
    console.log(`  Source: ${pattern.source}`);
    console.log(color('dim', '  Run "flow aggregate" to promote, or edit decisions.md manually'));
    console.log('');
  }
}

/**
 * Promote pattern to decisions.md
 * @param {Object} pattern - Pattern to promote
 */
function promoteToDecisions(pattern) {
  if (!fileExists(DECISIONS_PATH)) {
    warn(`Could not promote pattern: decisions.md not found`);
    return;
  }

  try {
    let content = fs.readFileSync(DECISIONS_PATH, 'utf-8');

    // Find Coding Standards section
    const sectionHeader = '## Coding Standards';

    if (!content.includes(sectionHeader)) {
      warn(`Could not promote pattern: Coding Standards section not found in decisions.md`);
      return;
    }

    // Generate rule entry (escape markdown special characters in pattern name)
    const today = new Date().toISOString().split('T')[0];
    const escapedPattern = pattern.pattern.replace(/[#*_\[\]()\\]/g, '\\$&');
    const ruleEntry = `\n### ${escapedPattern} (${today})
**Source**: Auto-learned from ${pattern.count} occurrences (${pattern.source})
**Rule**: [Describe the pattern rule here]
`;

    // Insert after Coding Standards header
    const insertPoint = content.indexOf(sectionHeader) + sectionHeader.length;
    const nextSection = content.indexOf('\n## ', insertPoint);

    if (nextSection > insertPoint) {
      // Insert before next section
      content = content.slice(0, nextSection) + ruleEntry + content.slice(nextSection);
    } else {
      // Append to section
      content = content.slice(0, insertPoint) + ruleEntry + content.slice(insertPoint);
    }

    fs.writeFileSync(DECISIONS_PATH, content, 'utf-8');

    // Update pattern status
    const patterns = loadAutoPatterns();
    const updated = patterns.find(p => p.pattern === pattern.pattern);
    if (updated) {
      updated.status = 'Promoted';
      saveAutoPatterns(patterns);
    }

    // Sync rules
    try {
      require('./flow-rules-sync');
    } catch (syncErr) {
      // Log the failure for debugging
      info(`Note: Rules sync skipped - ${syncErr.code === 'MODULE_NOT_FOUND' ? 'module not found' : syncErr.message}`);
    }
  } catch (err) {
    warn(`Could not promote to decisions.md: ${err.message}`);
  }
}

// ============================================================
// CLI
// ============================================================

/**
 * Show auto-learning status
 */
function showStatus() {
  const config = getAutoLearnConfig();
  const patterns = loadAutoPatterns();

  console.log('');
  console.log(color('cyan', '='.repeat(50)));
  console.log(color('cyan', '        AUTO-LEARNING STATUS'));
  console.log(color('cyan', '='.repeat(50)));
  console.log('');

  // Config
  console.log(color('cyan', 'Configuration'));
  console.log(`  Enabled: ${config.enabled ? 'Yes' : 'No'}`);
  console.log(`  Capture from: ${Object.entries(config.captureFrom).filter(([,v]) => v).map(([k]) => k).join(', ')}`);
  console.log(`  Confidence threshold: ${config.confidenceThreshold}%`);
  console.log(`  Promotion threshold: ${config.promotionThreshold} occurrences`);
  console.log(`  Auto-promote: ${config.autoPromote ? 'Yes' : 'No'}`);
  console.log('');

  // Patterns
  console.log(color('cyan', 'Captured Patterns'));
  if (patterns.length === 0) {
    console.log('  No patterns captured yet');
  } else {
    const ready = patterns.filter(p => p.status === 'Ready');
    const monitoring = patterns.filter(p => p.status === 'Monitor');
    const promoted = patterns.filter(p => p.status === 'Promoted');

    if (ready.length > 0) {
      console.log(color('yellow', `  Ready for promotion (${ready.length}):`));
      for (const p of ready) {
        console.log(`    - ${p.pattern} (${p.count}x, ${p.confidence}%)`);
      }
    }

    if (monitoring.length > 0) {
      console.log(`  Monitoring (${monitoring.length}):`);
      for (const p of monitoring) {
        console.log(`    - ${p.pattern} (${p.count}x, ${p.confidence}%)`);
      }
    }

    if (promoted.length > 0) {
      console.log(color('green', `  Promoted (${promoted.length}):`));
      for (const p of promoted) {
        console.log(`    - ${p.pattern}`);
      }
    }
  }

  console.log('');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  switch (command) {
    case 'status':
      showStatus();
      break;

    case 'test':
      // Test capture with mock issues
      captureFromSessionReview([
        { perspective: 'security', type: 'missing_error_handling', description: 'Missing try-catch', confidence: 85 },
        { perspective: 'implementation', type: 'magic_numbers', description: 'Magic number 42', confidence: 82 }
      ]);
      success('Test capture completed');
      break;

    default:
      console.log('Usage: flow auto-learn [status|test]');
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  captureFromSessionReview,
  captureFromBugFix,
  normalizeIssueToPattern,
  getAutoLearnConfig,
  loadAutoPatterns,
  showStatus
};

if (require.main === module) {
  main();
}
