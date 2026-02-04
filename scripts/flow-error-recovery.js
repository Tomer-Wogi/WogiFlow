#!/usr/bin/env node

/**
 * Wogi Flow - Recursive Error Recovery
 *
 * Hierarchical error analysis and targeted fix strategies.
 * Based on recursive language model principles - decompose errors
 * into categories and fix at the appropriate level.
 *
 * Error Hierarchy (fix from bottom to top):
 * 1. Syntax - Parse errors, missing brackets, typos
 * 2. Type - Type mismatches, missing properties, wrong arguments
 * 3. Runtime - Null access, undefined methods, async issues
 * 4. Logic - Wrong behavior, failed assertions, edge cases
 *
 * Each level has specific fix strategies that don't affect higher levels.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  ensureDir,
  color,
  success,
  warn,
  error,
  info
} = require('./flow-utils');

// Import adaptive learning for strategy tracking
let adaptiveLearning;
try {
  adaptiveLearning = require('./flow-adaptive-learning');
} catch (err) {
  // Module not available - adaptive learning is optional
  adaptiveLearning = null;
}

// ============================================================
// Constants
// ============================================================

const ERROR_RECOVERY_STATE_PATH = path.join(PATHS.state, 'error-recovery.json');

/**
 * Error hierarchy levels (fix from lowest to highest)
 */
const ERROR_LEVELS = {
  SYNTAX: 0,     // Parse errors - fix first
  TYPE: 1,       // Type errors - fix after syntax
  RUNTIME: 2,    // Runtime errors - fix after types
  LOGIC: 3       // Logic errors - fix last
};

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS = {
  [ERROR_LEVELS.SYNTAX]: [
    /SyntaxError/i,
    /Unexpected token/i,
    /Unexpected end of/i,
    /Missing \)/i,
    /Missing \}/i,
    /Missing ;/i,
    /Invalid or unexpected token/i,
    /Unterminated string/i
  ],
  [ERROR_LEVELS.TYPE]: [
    /TypeError.*is not a function/i,
    /TypeError.*cannot read propert/i,
    /TS\d{4}:/i,  // TypeScript errors
    /Type.*is not assignable/i,
    /Property.*does not exist/i,
    /Argument of type.*is not assignable/i,
    /Expected \d+ arguments/i,
    /has no exported member/i
  ],
  [ERROR_LEVELS.RUNTIME]: [
    /ReferenceError/i,
    /undefined is not/i,
    /null is not/i,
    /Cannot read propert.*of (undefined|null)/i,
    /ENOENT/i,
    /EACCES/i,
    /ECONNREFUSED/i,
    /timeout/i,
    /promise.*reject/i
  ],
  [ERROR_LEVELS.LOGIC]: [
    /AssertionError/i,
    /Expected.*but got/i,
    /expect\(.*\)\./i,  // Jest assertions
    /assertion failed/i,
    /test failed/i,
    /does not match/i
  ]
};

/**
 * Fix strategies for each level
 */
const FIX_STRATEGIES = {
  [ERROR_LEVELS.SYNTAX]: [
    'Check for missing closing brackets/braces/parentheses',
    'Verify string literals are properly closed',
    'Check for missing semicolons or commas',
    'Verify template literal syntax',
    'Check for reserved word usage as identifiers'
  ],
  [ERROR_LEVELS.TYPE]: [
    'Check function signatures match call sites',
    'Verify imported types/interfaces exist',
    'Add null checks before property access',
    'Ensure generic type parameters are specified',
    'Check for optional vs required properties'
  ],
  [ERROR_LEVELS.RUNTIME]: [
    'Add defensive null/undefined checks',
    'Verify file paths exist before access',
    'Add try-catch around async operations',
    'Check environment variables are set',
    'Verify API endpoints are reachable'
  ],
  [ERROR_LEVELS.LOGIC]: [
    'Review business logic against requirements',
    'Check edge cases and boundary conditions',
    'Verify data transformations are correct',
    'Check conditional logic flow',
    'Review test expectations match behavior'
  ]
};

// ============================================================
// Error State Management
// ============================================================

/**
 * Load error recovery state
 * @returns {Object} Error recovery state
 */
function loadErrorState() {
  if (!fs.existsSync(ERROR_RECOVERY_STATE_PATH)) {
    return {
      currentSession: null,
      recoveryHistory: [],
      patterns: {}
    };
  }
  try {
    return readJson(ERROR_RECOVERY_STATE_PATH) || {
      currentSession: null,
      recoveryHistory: [],
      patterns: {}
    };
  } catch (err) {
    // Log error for debugging but return default state
    if (process.env.DEBUG) console.error('Failed to load error state:', err.message);
    return {
      currentSession: null,
      recoveryHistory: [],
      patterns: {}
    };
  }
}

/**
 * Save error recovery state
 * @param {Object} state - State to save
 */
function saveErrorState(state) {
  ensureDir(path.dirname(ERROR_RECOVERY_STATE_PATH));
  writeJson(ERROR_RECOVERY_STATE_PATH, state);
}

// ============================================================
// Error Classification
// ============================================================

/**
 * Classify an error into the hierarchy
 * @param {string} errorText - Error message or output
 * @returns {Object} Classification result
 */
function classifyError(errorText) {
  if (!errorText) {
    return { level: ERROR_LEVELS.LOGIC, confidence: 0.3, patterns: [] };
  }

  const matches = [];

  // Check each level's patterns
  for (const [level, patterns] of Object.entries(ERROR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(errorText)) {
        matches.push({
          level: parseInt(level),
          pattern: pattern.source,
          match: errorText.match(pattern)?.[0]
        });
      }
    }
  }

  if (matches.length === 0) {
    // Default to logic error if no patterns match
    return {
      level: ERROR_LEVELS.LOGIC,
      confidence: 0.3,
      patterns: [],
      reason: 'No known patterns matched'
    };
  }

  // Return lowest level (most fundamental error type)
  matches.sort((a, b) => a.level - b.level);
  const primaryMatch = matches[0];

  return {
    level: primaryMatch.level,
    levelName: getLevelName(primaryMatch.level),
    confidence: matches.length > 1 ? 0.7 : 0.9,
    patterns: matches,
    reason: `Matched ${primaryMatch.pattern}`
  };
}

/**
 * Get human-readable level name
 * @param {number} level - Error level
 * @returns {string} Level name
 */
function getLevelName(level) {
  const names = ['SYNTAX', 'TYPE', 'RUNTIME', 'LOGIC'];
  return names[level] || 'UNKNOWN';
}

// ============================================================
// Recursive Error Analysis
// ============================================================

/**
 * Analyze errors hierarchically
 * @param {string} errorOutput - Full error output
 * @returns {Object} Hierarchical analysis
 */
function analyzeErrorsHierarchically(errorOutput) {
  const analysis = {
    levels: {},
    primaryLevel: null,
    totalErrors: 0,
    recommendation: null
  };

  // Split by common error delimiters
  const errorChunks = errorOutput.split(/(?=(?:Error|error|ERR|TypeError|SyntaxError|ReferenceError):)/g)
    .filter(chunk => chunk.trim().length > 0);

  for (const chunk of errorChunks) {
    const classification = classifyError(chunk);
    const levelName = getLevelName(classification.level);

    if (!analysis.levels[levelName]) {
      analysis.levels[levelName] = {
        count: 0,
        errors: [],
        strategies: FIX_STRATEGIES[classification.level] || []
      };
    }

    analysis.levels[levelName].count++;
    analysis.levels[levelName].errors.push({
      text: chunk.substring(0, 200),
      classification
    });
    analysis.totalErrors++;
  }

  // Determine primary level (lowest = most fundamental)
  for (const level of [ERROR_LEVELS.SYNTAX, ERROR_LEVELS.TYPE, ERROR_LEVELS.RUNTIME, ERROR_LEVELS.LOGIC]) {
    const levelName = getLevelName(level);
    if (analysis.levels[levelName] && analysis.levels[levelName].count > 0) {
      analysis.primaryLevel = levelName;
      break;
    }
  }

  // Generate recommendation
  analysis.recommendation = generateRecommendation(analysis);

  return analysis;
}

/**
 * Generate fix recommendation based on analysis
 * @param {Object} analysis - Hierarchical analysis
 * @returns {string} Recommendation
 */
function generateRecommendation(analysis) {
  if (!analysis.primaryLevel) {
    return 'No errors detected. Run tests to verify behavior.';
  }

  const levelInfo = analysis.levels[analysis.primaryLevel];
  const otherLevels = Object.keys(analysis.levels).filter(l => l !== analysis.primaryLevel);

  let recommendation = `Fix ${analysis.primaryLevel} errors first (${levelInfo.count} found).`;

  if (otherLevels.length > 0) {
    recommendation += ` Then address: ${otherLevels.join(', ')}.`;
  }

  const strategies = levelInfo.strategies || [];
  if (strategies.length > 0) {
    recommendation += '\n\nStrategies:\n';
    for (const strategy of strategies.slice(0, 3)) {
      recommendation += `• ${strategy}\n`;
    }
  }

  return recommendation;
}

// ============================================================
// Recovery Session Management
// ============================================================

/**
 * Start a new error recovery session
 * @param {string} taskId - Task ID
 * @param {string} errorOutput - Initial error output
 * @returns {Object} Recovery session
 */
function startRecoverySession(taskId, errorOutput) {
  const state = loadErrorState();

  const analysis = analyzeErrorsHierarchically(errorOutput);

  const session = {
    id: `recovery-${Date.now()}`,
    taskId,
    startedAt: new Date().toISOString(),
    initialAnalysis: analysis,
    attempts: [],
    currentLevel: analysis.primaryLevel,
    status: 'active',
    resolved: false
  };

  state.currentSession = session;
  saveErrorState(state);

  return session;
}

/**
 * Record a fix attempt
 * @param {string} level - Error level being fixed
 * @param {string} strategy - Strategy applied
 * @param {string} newOutput - Output after fix attempt
 * @returns {Object} Updated session
 */
function recordFixAttempt(level, strategy, newOutput) {
  const state = loadErrorState();
  const session = state.currentSession;

  if (!session) {
    return { error: 'No active recovery session' };
  }

  const newAnalysis = analyzeErrorsHierarchically(newOutput);

  const attempt = {
    timestamp: new Date().toISOString(),
    level,
    strategy,
    beforeCount: session.attempts.length > 0
      ? session.attempts[session.attempts.length - 1].afterCount
      : session.initialAnalysis.totalErrors,
    afterCount: newAnalysis.totalErrors,
    analysis: newAnalysis,
    improved: newAnalysis.totalErrors < (session.attempts.length > 0
      ? session.attempts[session.attempts.length - 1].afterCount
      : session.initialAnalysis.totalErrors)
  };

  session.attempts.push(attempt);
  session.currentLevel = newAnalysis.primaryLevel;

  // Check for architectural reassessment trigger (3-strike rule)
  const reassessmentResult = checkArchitecturalReassessment(session, level, state);
  if (reassessmentResult.triggered) {
    session.architecturalReassessment = reassessmentResult;
  }

  if (newAnalysis.totalErrors === 0) {
    session.resolved = true;
    session.status = 'resolved';
    session.completedAt = new Date().toISOString();

    // Move to history
    state.recoveryHistory.push(session);
    state.currentSession = null;

    // Track successful strategy
    trackSuccessfulStrategy(level, strategy, state);
  }

  saveErrorState(state);

  return session;
}

/**
 * Check if architectural reassessment should be triggered (3-strike rule)
 * @param {Object} session - Current recovery session
 * @param {string} currentLevel - Current error level being fixed
 * @param {Object} state - Error recovery state
 * @returns {Object} Reassessment result
 */
function checkArchitecturalReassessment(session, currentLevel, state) {
  // Get config for architectural reassessment
  let config;
  try {
    config = require('./flow-utils').getConfig();
  } catch (err) {
    config = {};
  }

  const reassessmentConfig = config.errorRecovery?.architecturalReassessment || {};
  if (!reassessmentConfig.enabled) {
    return { triggered: false, reason: 'disabled' };
  }

  const strikeCount = reassessmentConfig.strikeCount || 3;

  // Count consecutive failures at the same error level
  const recentAttempts = session.attempts.slice(-strikeCount);
  const consecutiveFailures = recentAttempts.filter(a =>
    a.level === currentLevel && !a.improved
  ).length;

  if (consecutiveFailures < strikeCount) {
    return { triggered: false, consecutiveFailures };
  }

  // 3 strikes reached - trigger architectural reassessment
  return {
    triggered: true,
    consecutiveFailures,
    currentLevel,
    analysis: generateArchitecturalAnalysis(session, currentLevel),
    recommendation: null, // Will be populated by agent
    status: 'pending_analysis'
  };
}

/**
 * Generate architectural analysis for reassessment
 * @param {Object} session - Current recovery session
 * @param {string} level - Error level that triggered reassessment
 * @returns {Object} Architectural analysis
 */
function generateArchitecturalAnalysis(session, level) {
  const recentErrors = session.attempts
    .filter(a => a.level === level)
    .map(a => a.analysis?.levels?.[level]?.errors || [])
    .flat()
    .slice(-5);

  const errorPatterns = {};
  for (const err of recentErrors) {
    const pattern = err.classification?.reason || 'unknown';
    errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
  }

  return {
    level,
    totalAttempts: session.attempts.length,
    failedAttempts: session.attempts.filter(a => !a.improved).length,
    errorPatterns,
    strategiesAttempted: [...new Set(session.attempts.map(a => a.strategy))],
    questions: [
      'Is the current approach fundamentally flawed?',
      'Are there dependencies or assumptions that are incorrect?',
      'Would a different architectural pattern solve this more cleanly?',
      'Is this error indicative of a design-level issue?'
    ]
  };
}

/**
 * Record architectural reassessment decision
 * @param {string} decision - 'continue' or 'switch'
 * @param {string} reasoning - Agent's reasoning
 * @param {Object} alternativeApproach - If switching, the new approach details
 * @returns {Object} Updated session
 */
function recordArchitecturalDecision(decision, reasoning, alternativeApproach = null) {
  const state = loadErrorState();
  const session = state.currentSession;

  if (!session || !session.architecturalReassessment) {
    return { error: 'No active reassessment pending' };
  }

  session.architecturalReassessment.status = decision === 'continue' ? 'continue_confirmed' : 'switch_proposed';
  session.architecturalReassessment.decision = decision;
  session.architecturalReassessment.reasoning = reasoning;
  session.architecturalReassessment.decidedAt = new Date().toISOString();

  if (decision === 'switch' && alternativeApproach) {
    session.architecturalReassessment.alternativeApproach = alternativeApproach;
    session.architecturalReassessment.status = 'awaiting_approval';
  }

  saveErrorState(state);

  return session;
}

/**
 * Record user approval/rejection of alternative approach
 * @param {boolean} approved - Whether user approved the switch
 * @returns {Object} Updated session
 */
function recordApprovalDecision(approved) {
  const state = loadErrorState();
  const session = state.currentSession;

  if (!session?.architecturalReassessment || session.architecturalReassessment.status !== 'awaiting_approval') {
    return { error: 'No approach awaiting approval' };
  }

  session.architecturalReassessment.approved = approved;
  session.architecturalReassessment.approvedAt = new Date().toISOString();
  session.architecturalReassessment.status = approved ? 'approach_switched' : 'continue_original';

  // Reset attempts counter if switching approach
  if (approved) {
    session.switchedApproach = true;
    session.attemptsSinceSwitch = 0;
  }

  saveErrorState(state);

  return session;
}

/**
 * Format architectural reassessment prompt for display
 * @param {Object} reassessment - Reassessment data
 * @returns {string} Formatted prompt
 */
function formatArchitecturalReassessment(reassessment) {
  const lines = [];

  lines.push('');
  lines.push('━'.repeat(60));
  lines.push('  ⚠️  ARCHITECTURAL REASSESSMENT TRIGGERED');
  lines.push('━'.repeat(60));
  lines.push('');
  lines.push(`${reassessment.consecutiveFailures} consecutive failures at ${reassessment.currentLevel} level.`);
  lines.push('');
  lines.push('This pattern suggests the issue may be architectural rather than');
  lines.push('a simple bug. The agent should analyze:');
  lines.push('');

  for (const question of reassessment.analysis?.questions || []) {
    lines.push(`  • ${question}`);
  }

  lines.push('');
  lines.push('Strategies already attempted:');
  for (const strategy of (reassessment.analysis?.strategiesAttempted || []).slice(0, 5)) {
    lines.push(`  - ${strategy}`);
  }

  lines.push('');
  lines.push('━'.repeat(60));
  lines.push('');
  lines.push('NEXT STEPS:');
  lines.push('1. Analyze if the current approach is fundamentally sound');
  lines.push('2. If sound: Document reasoning and continue');
  lines.push('3. If not: Research alternatives, propose new approach for approval');
  lines.push('');

  return lines.join('\n');
}

/**
 * Track successful strategies for learning
 * @param {string} level - Error level
 * @param {string} strategy - Successful strategy
 * @param {Object} state - Error state
 */
function trackSuccessfulStrategy(level, strategy, state) {
  if (!state.patterns[level]) {
    state.patterns[level] = {};
  }

  if (!state.patterns[level][strategy]) {
    state.patterns[level][strategy] = { count: 0, lastUsed: null };
  }

  state.patterns[level][strategy].count++;
  state.patterns[level][strategy].lastUsed = new Date().toISOString();

  // Also track in adaptive learning if available
  if (adaptiveLearning?.trackStrategyEffectiveness) {
    adaptiveLearning.trackStrategyEffectiveness('error-recovery', `${level}:${strategy}`, true);
  }
}

/**
 * Get current recovery session
 * @returns {Object|null} Current session
 */
function getCurrentRecoverySession() {
  const state = loadErrorState();
  return state.currentSession;
}

/**
 * Abort recovery session
 * @returns {Object} Result
 */
function abortRecoverySession() {
  const state = loadErrorState();

  if (state.currentSession) {
    state.currentSession.status = 'aborted';
    state.currentSession.completedAt = new Date().toISOString();
    state.recoveryHistory.push(state.currentSession);
    state.currentSession = null;
    saveErrorState(state);
    return { aborted: true };
  }

  return { error: 'No active session to abort' };
}

// ============================================================
// Suggested Fixes
// ============================================================

/**
 * Get suggested fixes for current session
 * @returns {Object} Suggested fixes
 */
function getSuggestedFixes() {
  const session = getCurrentRecoverySession();

  if (!session) {
    return { error: 'No active recovery session' };
  }

  const state = loadErrorState();
  const level = session.currentLevel;
  const levelNum = ERROR_LEVELS[level] ?? ERROR_LEVELS.LOGIC;

  // Get base strategies
  const strategies = [...(FIX_STRATEGIES[levelNum] || [])];

  // Prioritize historically successful strategies
  const historical = state.patterns[level] || {};
  const sorted = Object.entries(historical)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([strategy]) => strategy);

  const prioritized = [
    ...sorted.filter(s => strategies.includes(s)),
    ...strategies.filter(s => !sorted.includes(s))
  ];

  return {
    level,
    strategies: prioritized,
    analysis: session.attempts.length > 0
      ? session.attempts[session.attempts.length - 1].analysis
      : session.initialAnalysis,
    attemptCount: session.attempts.length
  };
}

/**
 * Get best strategy for a level based on history
 * @param {string} level - Error level
 * @returns {string|null} Best strategy
 */
function getBestStrategy(level) {
  const state = loadErrorState();
  const historical = state.patterns[level];

  if (!historical || Object.keys(historical).length === 0) {
    const levelNum = ERROR_LEVELS[level];
    return FIX_STRATEGIES[levelNum]?.[0] || null;
  }

  const [best] = Object.entries(historical)
    .sort((a, b) => b[1].count - a[1].count);

  return best ? best[0] : null;
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format analysis for display
 * @param {Object} analysis - Error analysis
 * @returns {string} Formatted output
 */
function formatAnalysis(analysis) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Error Analysis (Hierarchical)');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  if (analysis.totalErrors === 0) {
    lines.push('✓ No errors detected!');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Total Errors: ${analysis.totalErrors}`);
  lines.push(`Primary Level: ${analysis.primaryLevel}`);
  lines.push('');

  // Show hierarchy
  for (const level of ['SYNTAX', 'TYPE', 'RUNTIME', 'LOGIC']) {
    const levelInfo = analysis.levels[level];
    if (!levelInfo) continue;

    const icon = level === analysis.primaryLevel ? '→' : '·';
    lines.push(`${icon} ${level}: ${levelInfo.count} error(s)`);

    for (const err of levelInfo.errors.slice(0, 2)) {
      lines.push(`    ${err.text.substring(0, 60)}...`);
    }
    lines.push('');
  }

  lines.push('Recommendation:');
  lines.push(analysis.recommendation);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format recovery session status
 * @param {Object} session - Recovery session
 * @returns {string} Formatted output
 */
function formatRecoveryStatus(session) {
  if (!session) {
    return 'No active recovery session.';
  }

  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Recovery Session: ${session.id}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  lines.push(`Task: ${session.taskId}`);
  lines.push(`Status: ${session.status}`);
  lines.push(`Current Level: ${session.currentLevel}`);
  lines.push(`Attempts: ${session.attempts.length}`);
  lines.push('');

  // Progress
  const initialCount = session.initialAnalysis.totalErrors;
  const currentCount = session.attempts.length > 0
    ? session.attempts[session.attempts.length - 1].afterCount
    : initialCount;

  const fixed = initialCount - currentCount;
  const pct = initialCount > 0 ? Math.round((fixed / initialCount) * 100) : 0;

  lines.push(`Progress: ${fixed}/${initialCount} errors fixed (${pct}%)`);
  lines.push('');

  // Recent attempts
  if (session.attempts.length > 0) {
    lines.push('Recent Attempts:');
    for (const attempt of session.attempts.slice(-3)) {
      const icon = attempt.improved ? '✓' : '✗';
      lines.push(`  ${icon} ${attempt.level}: ${attempt.strategy.substring(0, 40)}...`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  ERROR_LEVELS,
  ERROR_PATTERNS,
  FIX_STRATEGIES,

  // Classification
  classifyError,
  analyzeErrorsHierarchically,
  getLevelName,

  // Session management
  startRecoverySession,
  recordFixAttempt,
  getCurrentRecoverySession,
  abortRecoverySession,

  // Suggestions
  getSuggestedFixes,
  getBestStrategy,

  // Architectural reassessment (v5.0 - 3-strike rule)
  checkArchitecturalReassessment,
  generateArchitecturalAnalysis,
  recordArchitecturalDecision,
  recordApprovalDecision,
  formatArchitecturalReassessment,

  // Formatting
  formatAnalysis,
  formatRecoveryStatus,

  // State management
  loadErrorState,
  saveErrorState
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'analyze': {
      const errorText = args.slice(1).join(' ') || process.stdin.read();
      if (!errorText) {
        console.log('Usage: flow error-recovery analyze "error text"');
        console.log('   or: cat error.log | flow error-recovery analyze');
        process.exit(1);
      }
      const analysis = analyzeErrorsHierarchically(errorText);
      console.log(formatAnalysis(analysis));
      break;
    }

    case 'start': {
      const taskId = args[1];
      const errorFile = args[2];

      if (!taskId) {
        error('Usage: flow error-recovery start <taskId> [error-file]');
        process.exit(1);
      }

      let errorText = '';
      if (errorFile && fs.existsSync(errorFile)) {
        errorText = fs.readFileSync(errorFile, 'utf-8');
      } else {
        error('Provide error file or pipe error output');
        process.exit(1);
      }

      const session = startRecoverySession(taskId, errorText);
      console.log(formatRecoveryStatus(session));
      console.log('');
      console.log(formatAnalysis(session.initialAnalysis));
      break;
    }

    case 'status': {
      const session = getCurrentRecoverySession();
      console.log(formatRecoveryStatus(session));
      break;
    }

    case 'suggest': {
      const suggestions = getSuggestedFixes();
      if (suggestions.error) {
        error(suggestions.error);
        process.exit(1);
      }

      console.log('═══════════════════════════════════════════════════');
      console.log(`  Suggested Fixes for ${suggestions.level}`);
      console.log('═══════════════════════════════════════════════════');
      console.log('');
      for (let i = 0; i < suggestions.strategies.length; i++) {
        console.log(`${i + 1}. ${suggestions.strategies[i]}`);
      }
      console.log('');
      break;
    }

    case 'record': {
      const level = args[1];
      const strategy = args[2];
      const outputFile = args[3];

      if (!level || !strategy || !outputFile) {
        error('Usage: flow error-recovery record <level> <strategy> <output-file>');
        process.exit(1);
      }

      const newOutput = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, 'utf-8')
        : '';

      const result = recordFixAttempt(level, strategy, newOutput);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }

      if (result.resolved) {
        success('All errors resolved!');
      } else {
        info(`Errors remaining: ${result.attempts[result.attempts.length - 1].afterCount}`);
      }
      console.log(formatRecoveryStatus(result));
      break;
    }

    case 'abort': {
      const result = abortRecoverySession();
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      warn('Recovery session aborted');
      break;
    }

    default:
      console.log(`
Recursive Error Recovery

Usage: node flow-error-recovery <command> [options]

Commands:
  analyze "error text"           Analyze errors hierarchically
  start <taskId> <error-file>    Start recovery session
  status                         Show current session status
  suggest                        Get suggested fixes
  record <level> <strategy> <file>  Record fix attempt
  abort                          Abort current session

Error Hierarchy (fix from bottom to top):
  1. SYNTAX  - Parse errors, missing brackets
  2. TYPE    - Type mismatches, wrong arguments
  3. RUNTIME - Null access, async issues
  4. LOGIC   - Wrong behavior, failed tests
`);
  }
}
