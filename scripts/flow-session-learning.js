#!/usr/bin/env node

/**
 * Wogi Flow - Session Learning Analysis
 *
 * Analyzes all changes from today's session to identify patterns and learnings:
 * - Parses request-log.md for today's entries
 * - Checks review results from tech-debt.json
 * - Groups by tags/types to find recurring patterns
 * - Auto-applies high-confidence learnings (90%+), prompts for others
 *
 * Called by flow-session-end.js, can also run standalone.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  getConfig,
  readFile,
  color,
  success,
  info,
  warn,
  safeJsonParse
} = require('./flow-utils');

// Import shared parsing functions from log manager (DRY - avoid duplication)
const { parseEntries } = require('./flow-log-manager');

// ============================================================
// Constants
// ============================================================

const FEEDBACK_PATTERNS_PATH = path.join(PATHS.state, 'feedback-patterns.md');
const DECISIONS_PATH = path.join(PATHS.state, 'decisions.md');
const TECH_DEBT_PATH = path.join(PATHS.state, 'tech-debt.json');
const READY_PATH = PATHS.ready;
const REQUEST_LOG_PATH = PATHS.requestLog;

/**
 * Get today's date as YYYY-MM-DD string
 */
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Default configuration
const DEFAULT_CONFIG = {
  enabled: true,
  autoApplyThreshold: 90,
  minOccurrences: 2,
  confidenceThreshold: 70,
  scope: 'today',
  analyzeReviews: true,
  analyzeRetries: true,
  analyzeFixes: true
};

// Confidence calculation: base + (frequency bonus)
const BASE_CONFIDENCE = 60;
const CONFIDENCE_PER_OCCURRENCE = 10;
const MAX_CONFIDENCE = 95;

// ============================================================
// Configuration
// ============================================================

/**
 * Get session learning configuration
 */
function getSessionLearningConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONFIG,
    ...(config?.sessionLearning || {})
  };
}

// ============================================================
// Data Gathering
// ============================================================

// Note: parseEntries is imported from flow-log-manager.js to avoid code duplication

/**
 * Filter entries to today only
 */
function filterTodayEntries(entries) {
  const today = getTodayDateString();

  return entries.filter(entry => {
    // Date format is "YYYY-MM-DD HH:MM"
    return entry.date && entry.date.startsWith(today);
  });
}

/**
 * Gather all session data
 */
function gatherSessionData() {
  const data = {
    requestLogEntries: [],
    completedTasks: [],
    techDebtIssues: [],
    reviewFindings: []
  };

  // 1. Parse request-log.md
  if (fileExists(REQUEST_LOG_PATH)) {
    try {
      const content = readFile(REQUEST_LOG_PATH, '');
      const allEntries = parseEntries(content);
      data.requestLogEntries = filterTodayEntries(allEntries);
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Parse request-log: ${err.message}`);
    }
  }

  // 2. Get completed tasks from ready.json
  if (fileExists(READY_PATH)) {
    try {
      const ready = safeJsonParse(READY_PATH, { recentlyCompleted: [] });
      const today = getTodayDateString();

      data.completedTasks = (ready.recentlyCompleted || []).filter(task => {
        return task.completedAt && task.completedAt.startsWith(today);
      });
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Parse ready.json: ${err.message}`);
    }
  }

  // 3. Get tech debt issues (from reviews)
  if (fileExists(TECH_DEBT_PATH)) {
    try {
      const techDebt = safeJsonParse(TECH_DEBT_PATH, { ledger: [] });
      const today = getTodayDateString();

      data.techDebtIssues = (techDebt.ledger || []).filter(issue => {
        return issue.createdAt && issue.createdAt.startsWith(today);
      });

      // Extract review findings (issues tagged with review source)
      data.reviewFindings = data.techDebtIssues.filter(issue =>
        issue.source === 'review' || issue.category
      );
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Parse tech-debt.json: ${err.message}`);
    }
  }

  return data;
}

// ============================================================
// Pattern Detection
// ============================================================

/**
 * Detect patterns from session data
 */
function detectPatterns(sessionData) {
  const patterns = [];
  const config = getSessionLearningConfig();

  // 1. Group request-log entries by type
  if (config.analyzeFixes) {
    const fixPatterns = detectFixPatterns(sessionData.requestLogEntries);
    patterns.push(...fixPatterns);
  }

  // 2. Group by tags
  const tagPatterns = detectTagPatterns(sessionData.requestLogEntries);
  patterns.push(...tagPatterns);

  // 3. Analyze review findings
  if (config.analyzeReviews && sessionData.reviewFindings.length > 0) {
    const reviewPatterns = detectReviewPatterns(sessionData.reviewFindings);
    patterns.push(...reviewPatterns);
  }

  // Filter by minimum occurrences
  return patterns.filter(p => p.occurrences >= config.minOccurrences);
}

/**
 * Detect patterns from fix-type entries
 */
function detectFixPatterns(entries) {
  const patterns = [];
  const fixEntries = entries.filter(e => e.type === 'fix' || e.type === 'bugfix');

  // Group by tags
  const tagGroups = {};
  for (const entry of fixEntries) {
    if (!entry.tags) continue;

    // Extract individual tags
    const tags = entry.tags.split(/\s+/).filter(t => t.startsWith('#'));
    for (const tag of tags) {
      if (!tagGroups[tag]) {
        tagGroups[tag] = [];
      }
      tagGroups[tag].push(entry);
    }
  }

  // Create patterns from groups with 2+ occurrences
  for (const [tag, tagEntries] of Object.entries(tagGroups)) {
    if (tagEntries.length >= 2) {
      patterns.push({
        name: `fix-pattern-${slugify(tag)}`,
        type: 'fix-pattern',
        description: `Fixed ${tag} issues ${tagEntries.length} times`,
        occurrences: tagEntries.length,
        confidence: calculateConfidence(tagEntries.length),
        source: 'session-analysis',
        details: tagEntries.map(e => e.id).join(', ')
      });
    }
  }

  return patterns;
}

/**
 * Detect patterns from tags
 */
function detectTagPatterns(entries) {
  const patterns = [];
  const tagCounts = {};

  for (const entry of entries) {
    if (!entry.tags) continue;

    const tags = entry.tags.split(/\s+/).filter(t => t.startsWith('#'));
    for (const tag of tags) {
      if (!tagCounts[tag]) {
        tagCounts[tag] = { count: 0, types: new Set(), entries: [] };
      }
      tagCounts[tag].count++;
      if (entry.type) tagCounts[tag].types.add(entry.type);
      tagCounts[tag].entries.push(entry.id);
    }
  }

  // Create patterns from frequently used tags
  for (const [tag, data] of Object.entries(tagCounts)) {
    if (data.count >= 3) {
      const types = Array.from(data.types).join(', ');
      patterns.push({
        name: `recurring-tag-${slugify(tag)}`,
        type: 'tag-pattern',
        description: `Tag ${tag} appeared ${data.count} times (types: ${types})`,
        occurrences: data.count,
        confidence: calculateConfidence(data.count),
        source: 'session-analysis',
        details: data.entries.join(', ')
      });
    }
  }

  return patterns;
}

/**
 * Detect patterns from review findings
 */
function detectReviewPatterns(findings) {
  const patterns = [];
  const categoryGroups = {};

  for (const finding of findings) {
    const category = finding.category || finding.severity || 'general';
    if (!categoryGroups[category]) {
      categoryGroups[category] = [];
    }
    categoryGroups[category].push(finding);
  }

  for (const [category, items] of Object.entries(categoryGroups)) {
    if (items.length >= 2) {
      patterns.push({
        name: `review-${slugify(category)}`,
        type: 'review-pattern',
        description: `${items.length} ${category} issues found in reviews`,
        occurrences: items.length,
        confidence: calculateConfidence(items.length),
        source: 'session-review',
        recommendation: `Consider adding rule for ${category} prevention`
      });
    }
  }

  return patterns;
}

// ============================================================
// Cross-Session Pattern Detection (v6.0)
// ============================================================

// Lazy-load dependencies to avoid circular imports
let _getAllRequestEntries = null;
let _calculateCombinedSimilarity = null;

function getLogManager() {
  if (!_getAllRequestEntries) {
    const logManager = require('./flow-log-manager');
    _getAllRequestEntries = logManager.getAllRequestEntries;
    // Validate the export exists and is a function
    if (typeof _getAllRequestEntries !== 'function') {
      throw new Error('flow-log-manager.getAllRequestEntries is not available or not a function');
    }
  }
  return _getAllRequestEntries;
}

function getSemanticMatch() {
  if (!_calculateCombinedSimilarity) {
    try {
      const semanticMatch = require('./flow-semantic-match');
      // Wrap to return 0-1 scale (original returns 0-100 percentage)
      _calculateCombinedSimilarity = (a, b) => {
        const result = semanticMatch.calculateCombinedSimilarity(a, b);
        // Handle both object result and raw number
        const score = typeof result === 'object' ? result.combined : result;
        return score / 100; // Convert to 0-1 scale
      };
    } catch (err) {
      // Fallback to simple string matching if semantic module not available
      _calculateCombinedSimilarity = (a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        if (aLower === bLower) return 1.0;
        if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.7;
        return 0;
      };
    }
  }
  return _calculateCombinedSimilarity;
}

/**
 * Normalize request text for comparison
 * Removes quotes, punctuation, and normalizes whitespace
 */
function normalizeRequest(text) {
  if (!text) return '';
  return text
    .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
    .replace(/[^\w\s:/.@-]/g, ' ')  // Keep technical punctuation (:, /, ., @, -)
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim()
    .toLowerCase();
}

/**
 * Group similar requests together using semantic matching
 */
function groupSimilarRequests(entries, similarityThreshold = 0.7) {
  const calculateSimilarity = getSemanticMatch();
  const groups = [];
  const used = new Set();

  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;

    const entry = entries[i];
    const normalizedRequest = normalizeRequest(entry.request);
    if (!normalizedRequest) continue;

    const group = {
      representativeRequest: entry.request,
      normalizedRequest,
      entries: [entry],
      dates: [entry.date],
      ids: [entry.id]
    };

    // Find similar entries
    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(j)) continue;

      const otherEntry = entries[j];
      const otherNormalized = normalizeRequest(otherEntry.request);
      if (!otherNormalized) continue;

      const similarity = calculateSimilarity(normalizedRequest, otherNormalized);

      if (similarity >= similarityThreshold) {
        group.entries.push(otherEntry);
        group.dates.push(otherEntry.date);
        group.ids.push(otherEntry.id);
        used.add(j);
      }
    }

    used.add(i);
    groups.push(group);
  }

  return groups;
}

/**
 * Detect patterns across multiple sessions
 *
 * Scans request-log entries across lookback period and groups similar requests.
 * Returns patterns that occurred minOccurrences or more times.
 *
 * @param {Object} options - Configuration
 * @param {number} options.lookbackDays - How many days to scan (default: 30)
 * @param {number} options.minOccurrences - Minimum occurrences to report (default: 3)
 * @param {number} options.similarityThreshold - Semantic similarity threshold (default: 0.7)
 * @returns {Array} Array of cross-session patterns
 */
function detectCrossSessionPatterns(options = {}) {
  const config = getConfig();
  const crossSessionConfig = config?.crossSessionLearning || {};

  const {
    lookbackDays = crossSessionConfig.lookbackDays || 30,
    minOccurrences = crossSessionConfig.minOccurrences || 3,
    similarityThreshold = crossSessionConfig.similarityThreshold || 0.7
  } = options;

  // Get all entries within lookback period
  const getAllEntries = getLogManager();
  const entries = getAllEntries({ lookbackDays, includeArchives: true });

  if (entries.length === 0) {
    return [];
  }

  // Group similar requests
  const groups = groupSimilarRequests(entries, similarityThreshold);

  // Filter to patterns with enough occurrences
  const patterns = [];

  for (const group of groups) {
    if (group.entries.length >= minOccurrences) {
      // Count unique sessions (by date)
      const uniqueDates = new Set(group.dates.map(d => d?.slice(0, 10))).size;

      patterns.push({
        representativeRequest: group.representativeRequest,
        normalizedRequest: group.normalizedRequest,
        count: group.entries.length,
        sessionCount: uniqueDates,
        firstSeen: group.dates[group.dates.length - 1], // Oldest
        lastSeen: group.dates[0], // Most recent
        entryIds: group.ids,
        confidence: calculateConfidence(group.entries.length),
        type: 'cross-session-request'
      });
    }
  }

  // Sort by count descending
  patterns.sort((a, b) => b.count - a.count);

  return patterns;
}

// ============================================================
// Learning Generation
// ============================================================

/**
 * Generate learnings from patterns
 */
function generateLearnings(patterns, sessionData) {
  const learnings = [];

  for (const pattern of patterns) {
    const learning = {
      pattern: pattern.name,
      description: pattern.description,
      confidence: pattern.confidence,
      source: pattern.source,
      occurrences: pattern.occurrences,
      recommendation: getRecommendation(pattern),
      target: getTargetFile(pattern)
    };

    learnings.push(learning);
  }

  // Add task-based insights
  if (sessionData.completedTasks.length >= 2) {
    const taskTypes = sessionData.completedTasks.map(t => t.type).filter(Boolean);
    const typeCount = {};
    for (const type of taskTypes) {
      typeCount[type] = (typeCount[type] || 0) + 1;
    }

    for (const [type, count] of Object.entries(typeCount)) {
      if (count >= 2) {
        learnings.push({
          pattern: `task-focus-${type}`,
          description: `Completed ${count} ${type} tasks this session`,
          confidence: 70,
          source: 'session-tasks',
          occurrences: count,
          recommendation: 'Monitor',
          target: 'none'
        });
      }
    }
  }

  return learnings;
}

/**
 * Get recommendation based on pattern type
 */
function getRecommendation(pattern) {
  if (pattern.confidence >= 90) {
    return 'Add to decisions.md';
  } else if (pattern.confidence >= 70) {
    return 'Monitor in feedback-patterns.md';
  } else {
    return 'Note for observation';
  }
}

/**
 * Get target file for learning
 */
function getTargetFile(pattern) {
  if (pattern.confidence >= 90 && pattern.type === 'fix-pattern') {
    return 'decisions.md';
  }
  return 'feedback-patterns.md';
}

// ============================================================
// Learning Application
// ============================================================

/**
 * Apply learnings to appropriate files
 */
function applyLearnings(learnings, options = {}) {
  const config = getSessionLearningConfig();
  const applied = [];
  const skipped = [];

  for (const learning of learnings) {
    // Check if should auto-apply
    const shouldAutoApply = learning.confidence >= config.autoApplyThreshold;

    if (shouldAutoApply || options.force) {
      let applySuccess = false;

      // Route based on target file
      if (learning.target === 'decisions.md') {
        // High-confidence patterns go to decisions.md
        applySuccess = addToDecisions(learning);
        // Also add to feedback-patterns for tracking
        addToFeedbackPatterns(learning);
      } else if (learning.target === 'feedback-patterns.md') {
        // Medium-confidence patterns go to feedback-patterns.md only
        applySuccess = addToFeedbackPatterns(learning);
      } else {
        // Default: feedback-patterns.md
        applySuccess = addToFeedbackPatterns(learning);
      }

      if (applySuccess) {
        applied.push(learning);
      } else {
        skipped.push(learning);
      }
    } else {
      skipped.push(learning);
    }
  }

  return { applied, skipped };
}

/**
 * Add learning to feedback-patterns.md
 */
function addToFeedbackPatterns(learning) {
  if (!fileExists(FEEDBACK_PATTERNS_PATH)) {
    warn('feedback-patterns.md not found');
    return false;
  }

  try {
    let content = fs.readFileSync(FEEDBACK_PATTERNS_PATH, 'utf-8');
    const today = getTodayDateString();

    // Check if pattern already exists
    if (content.includes(learning.pattern)) {
      // Update count instead of adding duplicate
      return true;
    }

    // Find or create Session Analysis section
    const sectionHeader = '## Session Analysis Patterns';
    const tableHeader = '| Date | Pattern | Source | Count | Confidence | Status |';
    const tableSeparator = '|------|---------|--------|-------|------------|--------|';

    const newRow = `| ${today} | ${learning.pattern} | ${learning.source} | ${learning.occurrences} | ${learning.confidence}% | Monitor |`;

    if (content.includes(sectionHeader)) {
      // Add to existing section
      const sectionEnd = content.indexOf('\n## ', content.indexOf(sectionHeader) + 1);
      const insertPos = sectionEnd > 0 ? sectionEnd : content.length;

      // Find the table and add row
      const tableEnd = content.lastIndexOf('|', insertPos);
      if (tableEnd > content.indexOf(sectionHeader)) {
        const lineEnd = content.indexOf('\n', tableEnd);
        content = content.slice(0, lineEnd + 1) + newRow + '\n' + content.slice(lineEnd + 1);
      }
    } else {
      // Add new section before "## Promotion History" or at end
      const newSection = `\n---\n\n${sectionHeader}\n\n${tableHeader}\n${tableSeparator}\n${newRow}\n`;

      if (content.includes('## Promotion History')) {
        content = content.replace('## Promotion History', newSection + '\n## Promotion History');
      } else {
        content = content.trimEnd() + newSection;
      }
    }

    fs.writeFileSync(FEEDBACK_PATTERNS_PATH, content, 'utf-8');
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] addToFeedbackPatterns: ${err.message}`);
    return false;
  }
}

/**
 * Add high-confidence learning to decisions.md
 */
function addToDecisions(learning) {
  if (!fileExists(DECISIONS_PATH)) {
    warn('decisions.md not found');
    return false;
  }

  try {
    let content = fs.readFileSync(DECISIONS_PATH, 'utf-8');
    const today = getTodayDateString();

    // Check if pattern already exists
    if (content.includes(learning.pattern)) {
      return true; // Already exists
    }

    // Create decision entry
    const decisionEntry = `
### ${learning.pattern} (${today})
<!-- PIN: ${learning.pattern} -->

**Source**: Session analysis (${learning.occurrences} occurrences, ${learning.confidence}% confidence)

${learning.description}

**Recommendation**: ${learning.recommendation}
`;

    // Find Session Learnings section or create one
    const sectionHeader = '## Session-Learned Patterns';

    if (content.includes(sectionHeader)) {
      // Add after section header
      const sectionIndex = content.indexOf(sectionHeader);
      const nextSection = content.indexOf('\n## ', sectionIndex + sectionHeader.length);
      const insertPos = nextSection > 0 ? nextSection : content.length;
      content = content.slice(0, insertPos) + decisionEntry + content.slice(insertPos);
    } else {
      // Add new section at the end
      content = content.trimEnd() + '\n\n---\n\n' + sectionHeader + '\n' + decisionEntry;
    }

    fs.writeFileSync(DECISIONS_PATH, content, 'utf-8');
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] addToDecisions: ${err.message}`);
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Convert string to kebab-case slug
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Calculate confidence based on occurrences
 */
function calculateConfidence(occurrences) {
  const confidence = BASE_CONFIDENCE + (occurrences * CONFIDENCE_PER_OCCURRENCE);
  return Math.min(confidence, MAX_CONFIDENCE);
}

// ============================================================
// Display Functions
// ============================================================

/**
 * Display learnings to console
 */
function displayLearnings(learnings) {
  console.log('');
  console.log(color('cyan', '[Session Learning Analysis]'));
  console.log('');

  if (learnings.length === 0) {
    console.log(color('dim', '   No patterns detected in today\'s session.'));
    return;
  }

  // Group by recommendation
  const highConfidence = learnings.filter(l => l.confidence >= 90);
  const mediumConfidence = learnings.filter(l => l.confidence >= 70 && l.confidence < 90);
  const lowConfidence = learnings.filter(l => l.confidence < 70);

  if (highConfidence.length > 0) {
    console.log(color('green', 'High Confidence (will auto-apply):'));
    for (const l of highConfidence) {
      console.log(`   • "${l.pattern}" - ${l.description}`);
      console.log(color('dim', `     → ${l.recommendation}`));
    }
    console.log('');
  }

  if (mediumConfidence.length > 0) {
    console.log(color('yellow', 'Medium Confidence (needs approval):'));
    for (const l of mediumConfidence) {
      console.log(`   • "${l.pattern}" - ${l.description}`);
      console.log(color('dim', `     → ${l.recommendation}`));
    }
    console.log('');
  }

  if (lowConfidence.length > 0) {
    console.log(color('dim', 'Low Confidence (observation only):'));
    for (const l of lowConfidence) {
      console.log(color('dim', `   • "${l.pattern}" - ${l.description}`));
    }
    console.log('');
  }
}

/**
 * Display summary of applied learnings
 */
function displaySummary(result) {
  console.log('');
  if (result.applied.length > 0) {
    const decisionsCount = result.applied.filter(l => l.target === 'decisions.md').length;
    const patternsCount = result.applied.length - decisionsCount;

    if (decisionsCount > 0) {
      success(`Applied ${decisionsCount} high-confidence learning(s) to decisions.md`);
    }
    if (patternsCount > 0) {
      success(`Applied ${patternsCount} learning(s) to feedback-patterns.md`);
    }
  }
  if (result.skipped.length > 0) {
    info(`${result.skipped.length} learning(s) below auto-apply threshold (need manual approval)`);
  }
}

// ============================================================
// Main Analysis Function
// ============================================================

/**
 * Main entry point - analyze session and return learnings
 */
function analyzeSessionLearnings(options = {}) {
  const config = getSessionLearningConfig();

  if (!config.enabled) {
    return { learnings: [], patterns: [], applied: [], skipped: [] };
  }

  // 1. Gather session data
  const sessionData = gatherSessionData();

  // 2. Detect patterns
  const patterns = detectPatterns(sessionData);

  // 3. Generate learnings
  const learnings = generateLearnings(patterns, sessionData);

  // 4. Display if requested
  if (options.display !== false) {
    displayLearnings(learnings);
  }

  // 5. Apply learnings
  let result = { applied: [], skipped: learnings };
  if (options.apply !== false && learnings.length > 0) {
    result = applyLearnings(learnings, options);
    if (options.display !== false) {
      displaySummary(result);
    }
  }

  return {
    sessionData,
    patterns,
    learnings,
    ...result
  };
}

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {
    help: args.includes('--help') || args.includes('-h'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    json: args.includes('--json')
  };

  if (flags.help) {
    console.log(`
Wogi Flow - Session Learning Analysis

Analyzes today's session for patterns and learnings.

Usage:
  flow session-learning              Analyze and apply learnings
  flow session-learning --dry-run    Show what would be learned without applying
  flow session-learning --force      Apply all learnings regardless of confidence
  flow session-learning --json       Output as JSON

Options:
  --dry-run    Preview learnings without applying
  --force      Apply all learnings (ignore confidence threshold)
  --json       Output JSON format

Called automatically by /wogi-session-end when sessionLearning.enabled is true.
`);
    process.exit(0);
  }

  // Run analysis
  const result = analyzeSessionLearnings({
    display: !flags.json,
    apply: !flags.dryRun,
    force: flags.force
  });

  if (flags.json) {
    console.log(JSON.stringify({
      success: true,
      entriesAnalyzed: result.sessionData?.requestLogEntries?.length || 0,
      tasksCompleted: result.sessionData?.completedTasks?.length || 0,
      patternsDetected: result.patterns?.length || 0,
      learningsGenerated: result.learnings?.length || 0,
      applied: result.applied?.length || 0,
      skipped: result.skipped?.length || 0,
      learnings: result.learnings
    }, null, 2));
  } else if (result.learnings.length === 0) {
    console.log('');
    info('No significant patterns detected in today\'s session.');
    console.log(color('dim', 'This is normal for short sessions or varied work.'));
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  analyzeSessionLearnings,
  gatherSessionData,
  detectPatterns,
  detectCrossSessionPatterns,  // v6.0 cross-session analysis
  generateLearnings,
  applyLearnings,
  displayLearnings,
  getSessionLearningConfig
};
