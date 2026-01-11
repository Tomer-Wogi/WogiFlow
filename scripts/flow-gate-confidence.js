#!/usr/bin/env node

/**
 * flow-gate-confidence.js
 *
 * Phase 4.3: Quality Gate Confidence System
 *
 * Analyzes AI responses to detect confidence levels.
 * Don't auto-apply low-confidence changes.
 *
 * Usage:
 *   node flow-gate-confidence.js analyze "<response text>"
 *   node flow-gate-confidence.js check --file <file>
 *   node flow-gate-confidence.js stats
 *
 * @module flow-gate-confidence
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Imports
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');

const {
  getConfig,
  parseFlags,
  info,
  success,
  warn,
  error,
  color,
  outputJson,
  printHeader,
  printSection,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * High confidence markers - indicate the model is sure.
 */
const HIGH_CONFIDENCE_MARKERS = [
  // Direct confidence statements
  "I'm confident",
  "I am confident",
  "This will work",
  "This is correct",
  "This is the right",
  "Straightforward",
  "Simple fix",
  "Standard approach",
  "Best practice",
  "Recommended way",

  // Certainty indicators
  "Definitely",
  "Certainly",
  "Absolutely",
  "Without a doubt",
  "Clearly",
  "Obviously",

  // Knowledge indicators
  "I know that",
  "This is because",
  "The reason is",
  "According to the docs",
  "Per the documentation",

  // Action confidence
  "Here's the solution",
  "The fix is",
  "You should",
  "You need to",
  "Make sure to"
];

/**
 * Low confidence markers - indicate uncertainty.
 */
const LOW_CONFIDENCE_MARKERS = [
  // Uncertainty hedges
  "I think",
  "I believe",
  "I assume",
  "I suppose",
  "I guess",
  "I'm not sure",
  "I'm not certain",
  "I'm not entirely sure",
  "I'm unsure",

  // Possibility hedges
  "Might work",
  "May work",
  "Could work",
  "Should work",
  "Possibly",
  "Perhaps",
  "Maybe",
  "Probably",

  // Uncertainty indicators
  "Not entirely sure",
  "Not completely certain",
  "Hard to say",
  "Difficult to tell",
  "Unclear",
  "Uncertain",

  // Conditional language
  "If I understand correctly",
  "If I'm not mistaken",
  "Unless I'm wrong",
  "Assuming that",
  "Depending on",

  // Exploration language
  "Let me try",
  "We could try",
  "One option might be",
  "Worth trying",
  "Experiment with",

  // Risk indicators
  "Risky",
  "Potentially problematic",
  "Might break",
  "Could cause issues",
  "Watch out for"
];

/**
 * Question markers - indicate the model needs more info.
 */
const QUESTION_MARKERS = [
  "Could you clarify",
  "Can you confirm",
  "Do you want",
  "Would you like",
  "Should I",
  "Which approach",
  "What do you prefer",
  "Is this what you meant",
  "Am I understanding correctly"
];

/**
 * Confidence levels.
 */
const CONFIDENCE_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NEEDS_CLARIFICATION: 'needs_clarification'
};

/**
 * Default gate confidence configuration.
 */
const DEFAULT_GATE_CONFIG = {
  enabled: true,
  autoApplyThreshold: 0.7,
  requireApprovalThreshold: 0.5,
  blockThreshold: 0.3,
  trackHistory: true,
  maxHistoryEntries: 100
};

// ============================================================
// State
// ============================================================

const STATE_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'gate-confidence.json');

/**
 * Get default confidence state.
 * @returns {Object} Default state
 */
function getDefaultState() {
  return {
    history: [],
    stats: {
      totalAnalyzed: 0,
      byLevel: {
        high: 0,
        medium: 0,
        low: 0,
        needs_clarification: 0
      },
      autoApplied: 0,
      manualApproved: 0,
      blocked: 0
    }
  };
}

let confidenceState = getDefaultState();

// ============================================================
// Configuration
// ============================================================

/**
 * Get gate confidence configuration from config.json with defaults.
 * @returns {Object} Gate confidence configuration
 */
function getGateConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_GATE_CONFIG,
    ...(config.gateConfidence || {})
  };
}

// ============================================================
// State Management
// ============================================================

/**
 * Load confidence state from file using safe JSON parsing.
 */
function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    const loaded = safeJsonParse(STATE_PATH, null);
    if (loaded && typeof loaded === 'object') {
      const defaults = getDefaultState();
      // Validate structure before using
      confidenceState = {
        history: Array.isArray(loaded.history) ? loaded.history : [],
        stats: {
          ...defaults.stats,
          ...(loaded.stats || {}),
          byLevel: { ...defaults.stats.byLevel, ...(loaded.stats?.byLevel || {}) }
        }
      };
    }
  }
}

/**
 * Save confidence state to file.
 */
function saveState() {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(confidenceState, null, 2));
  } catch (err) {
    warn(`Could not save confidence state: ${err.message}`);
  }
}

// ============================================================
// Confidence Analysis
// ============================================================

/**
 * Analyze text for confidence level.
 * @param {string} text - Text to analyze
 * @param {Object} options - Analysis options
 * @returns {Object} Confidence analysis result
 */
function analyzeConfidence(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return {
      level: CONFIDENCE_LEVELS.LOW,
      score: 0,
      error: 'Invalid input'
    };
  }

  const textLower = text.toLowerCase();
  const analysis = {
    highMarkers: [],
    lowMarkers: [],
    questionMarkers: [],
    segments: []
  };

  // Find high confidence markers
  for (const marker of HIGH_CONFIDENCE_MARKERS) {
    if (textLower.includes(marker.toLowerCase())) {
      analysis.highMarkers.push(marker);
    }
  }

  // Find low confidence markers
  for (const marker of LOW_CONFIDENCE_MARKERS) {
    if (textLower.includes(marker.toLowerCase())) {
      analysis.lowMarkers.push(marker);
    }
  }

  // Find question markers
  for (const marker of QUESTION_MARKERS) {
    if (textLower.includes(marker.toLowerCase())) {
      analysis.questionMarkers.push(marker);
    }
  }

  // Calculate base score using normalized weights to prevent unbounded values
  const totalMarkers = analysis.highMarkers.length + analysis.lowMarkers.length + analysis.questionMarkers.length;

  let score;
  if (totalMarkers === 0) {
    // No markers found - neutral score
    score = 0.5;
  } else {
    // Normalize weights based on total markers found (max influence capped)
    const highInfluence = Math.min(analysis.highMarkers.length, 5) * 0.08;  // Max +0.4
    const lowInfluence = Math.min(analysis.lowMarkers.length, 5) * -0.1;    // Max -0.5
    const questionInfluence = Math.min(analysis.questionMarkers.length, 3) * -0.12; // Max -0.36

    // Start from neutral (0.5) and adjust
    score = 0.5 + highInfluence + lowInfluence + questionInfluence;

    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));
  }

  // Determine level
  let level;
  if (analysis.questionMarkers.length > 0) {
    level = CONFIDENCE_LEVELS.NEEDS_CLARIFICATION;
  } else if (score >= 0.7) {
    level = CONFIDENCE_LEVELS.HIGH;
  } else if (score >= 0.4) {
    level = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    level = CONFIDENCE_LEVELS.LOW;
  }

  // Analyze specific segments for more granular scoring
  analysis.segments = analyzeSegments(text);

  // Adjust score based on segment analysis
  const segmentScores = analysis.segments.map(s => s.confidence);
  if (segmentScores.length > 0) {
    const avgSegmentScore = segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length;
    score = (score + avgSegmentScore) / 2; // Blend marker and segment scores
  }

  const result = {
    level,
    score: Math.round(score * 100) / 100,
    markers: {
      high: analysis.highMarkers,
      low: analysis.lowMarkers,
      questions: analysis.questionMarkers
    },
    segments: analysis.segments,
    recommendation: getRecommendation(level, score),
    timestamp: new Date().toISOString()
  };

  // Track in history if enabled
  const config = getGateConfig();
  if (config.trackHistory && options.track !== false) {
    loadState();
    confidenceState.stats.totalAnalyzed++;
    confidenceState.stats.byLevel[level]++;
    confidenceState.history.push({
      score,
      level,
      timestamp: result.timestamp,
      textPreview: text.slice(0, 100) + (text.length > 100 ? '...' : '')
    });

    // Keep only recent history
    if (confidenceState.history.length > config.maxHistoryEntries) {
      confidenceState.history = confidenceState.history.slice(-config.maxHistoryEntries);
    }

    saveState();
  }

  return result;
}

/**
 * Analyze text segments for confidence.
 * @param {string} text - Text to analyze
 * @returns {Array} Segment analysis
 */
function analyzeSegments(text) {
  const segments = [];

  // Split into paragraphs/sections
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i].trim();

    // Detect code blocks
    if (paragraph.startsWith('```') || paragraph.startsWith('    ')) {
      segments.push({
        type: 'code',
        confidence: 0.8, // Code blocks are generally confident
        preview: paragraph.slice(0, 50)
      });
      continue;
    }

    // Analyze paragraph confidence
    let confidence = 0.5;

    // Check for hedging at start of paragraph
    if (/^(I think|Maybe|Perhaps|Possibly|It might)/i.test(paragraph)) {
      confidence -= 0.2;
    }

    // Check for confident starts
    if (/^(This will|Here's|The solution|To fix)/i.test(paragraph)) {
      confidence += 0.2;
    }

    // Check for explanations (usually confident)
    if (/because|since|therefore|as a result/i.test(paragraph)) {
      confidence += 0.1;
    }

    // Check for warnings/caveats
    if (/warning|caution|note:|important:|be careful/i.test(paragraph)) {
      confidence -= 0.1; // Not necessarily low confidence, but cautionary
    }

    segments.push({
      type: 'text',
      confidence: Math.max(0, Math.min(1, confidence)),
      preview: paragraph.slice(0, 50)
    });
  }

  return segments;
}

/**
 * Get recommendation based on confidence.
 * @param {string} level - Confidence level
 * @param {number} score - Confidence score
 * @returns {Object} Recommendation
 */
function getRecommendation(level, score) {
  const config = getGateConfig();

  if (level === CONFIDENCE_LEVELS.NEEDS_CLARIFICATION) {
    return {
      action: 'ask',
      message: 'The response contains questions - clarification needed before proceeding',
      autoApply: false
    };
  }

  if (score >= config.autoApplyThreshold) {
    return {
      action: 'auto-apply',
      message: 'High confidence - safe to apply automatically',
      autoApply: true
    };
  }

  if (score >= config.requireApprovalThreshold) {
    return {
      action: 'approve',
      message: 'Medium confidence - review before applying',
      autoApply: false
    };
  }

  if (score >= config.blockThreshold) {
    return {
      action: 'review',
      message: 'Low confidence - careful review recommended',
      autoApply: false
    };
  }

  return {
    action: 'block',
    message: 'Very low confidence - do not apply without verification',
    autoApply: false
  };
}

// ============================================================
// Quality Gate Integration
// ============================================================

/**
 * Check if a response should be auto-applied.
 * @param {string} response - AI response text
 * @returns {Object} Gate check result
 */
function checkGate(response) {
  const analysis = analyzeConfidence(response);
  const config = getGateConfig();

  return {
    passed: analysis.score >= config.autoApplyThreshold,
    confidence: analysis,
    action: analysis.recommendation.action,
    requiresApproval: !analysis.recommendation.autoApply
  };
}

/**
 * Valid decision types for recordDecision.
 */
const VALID_DECISIONS = ['auto-apply', 'approved', 'blocked'];

/**
 * Record a gate decision.
 * @param {Object} params - Decision parameters
 * @throws {Error} If decision is not a valid type
 */
function recordDecision({ analysisId, decision, outcome }) {
  // Validate decision type to prevent silent failures
  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(`Invalid decision type: ${decision}. Must be one of: ${VALID_DECISIONS.join(', ')}`);
  }

  loadState();

  switch (decision) {
    case 'auto-apply':
      confidenceState.stats.autoApplied++;
      break;
    case 'approved':
      confidenceState.stats.manualApproved++;
      break;
    case 'blocked':
      confidenceState.stats.blocked++;
      break;
  }

  saveState();
}

// ============================================================
// Statistics
// ============================================================

/**
 * Get confidence statistics.
 * @returns {Object} Statistics
 */
function getStats() {
  loadState();

  const stats = { ...confidenceState.stats };

  // Calculate additional metrics
  const total = stats.totalAnalyzed || 1;
  stats.percentages = {
    high: ((stats.byLevel.high / total) * 100).toFixed(1),
    medium: ((stats.byLevel.medium / total) * 100).toFixed(1),
    low: ((stats.byLevel.low / total) * 100).toFixed(1),
    needs_clarification: ((stats.byLevel.needs_clarification / total) * 100).toFixed(1)
  };

  // Calculate average score from history
  if (confidenceState.history.length > 0) {
    const scores = confidenceState.history.map(h => h.score);
    stats.averageScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    stats.recentTrend = calculateTrend(confidenceState.history.slice(-20));
  }

  return stats;
}

/**
 * Calculate confidence trend.
 * @param {Array} history - Recent history entries
 * @returns {string} Trend direction
 */
function calculateTrend(history) {
  if (history.length < 5) return 'insufficient_data';

  const firstHalf = history.slice(0, Math.floor(history.length / 2));
  const secondHalf = history.slice(Math.floor(history.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b.score, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b.score, 0) / secondHalf.length;

  const diff = secondAvg - firstAvg;

  if (diff > 0.1) return 'improving';
  if (diff < -0.1) return 'declining';
  return 'stable';
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print confidence analysis.
 * @param {Object} analysis - Analysis result
 */
function printAnalysis(analysis) {
  printHeader('CONFIDENCE ANALYSIS');

  // Score visualization
  const scoreBar = '█'.repeat(Math.round(analysis.score * 20));
  const emptyBar = '░'.repeat(20 - Math.round(analysis.score * 20));

  const levelColor = analysis.level === 'high' ? success :
                     analysis.level === 'medium' ? warn :
                     analysis.level === 'low' ? error : info;

  printSection('Score');
  console.log(`  ${scoreBar}${emptyBar} ${(analysis.score * 100).toFixed(0)}%`);
  console.log(`  Level: ${levelColor(analysis.level.toUpperCase())}`);

  printSection('Markers Found');
  if (analysis.markers.high.length > 0) {
    console.log(`  ${success('High confidence:')} ${analysis.markers.high.slice(0, 3).join(', ')}`);
  }
  if (analysis.markers.low.length > 0) {
    console.log(`  ${warn('Low confidence:')} ${analysis.markers.low.slice(0, 3).join(', ')}`);
  }
  if (analysis.markers.questions.length > 0) {
    console.log(`  ${info('Questions:')} ${analysis.markers.questions.slice(0, 3).join(', ')}`);
  }

  if (analysis.markers.high.length === 0 &&
      analysis.markers.low.length === 0 &&
      analysis.markers.questions.length === 0) {
    console.log(color('dim', '  No specific markers found'));
  }

  printSection('Recommendation');
  const actionIcon = analysis.recommendation.action === 'auto-apply' ? '✓' :
                     analysis.recommendation.action === 'approve' ? '?' :
                     analysis.recommendation.action === 'ask' ? '❓' : '✗';
  console.log(`  ${actionIcon} ${analysis.recommendation.message}`);
  console.log(`  ${color('dim', 'Auto-apply:')} ${analysis.recommendation.autoApply ? 'Yes' : 'No'}`);
}

/**
 * Print statistics.
 */
function printStats() {
  const stats = getStats();

  printHeader('CONFIDENCE STATISTICS');

  printSection('Overview');
  console.log(`  ${color('dim', 'Total analyzed:')} ${stats.totalAnalyzed}`);
  if (stats.averageScore) {
    console.log(`  ${color('dim', 'Average score:')} ${(stats.averageScore * 100).toFixed(0)}%`);
    console.log(`  ${color('dim', 'Recent trend:')} ${stats.recentTrend}`);
  }

  printSection('Distribution');
  console.log(`  ${success('High:')} ${stats.byLevel.high} (${stats.percentages.high}%)`);
  console.log(`  ${warn('Medium:')} ${stats.byLevel.medium} (${stats.percentages.medium}%)`);
  console.log(`  ${error('Low:')} ${stats.byLevel.low} (${stats.percentages.low}%)`);
  console.log(`  ${info('Needs clarification:')} ${stats.byLevel.needs_clarification} (${stats.percentages.needs_clarification}%)`);

  printSection('Decisions');
  console.log(`  ${color('dim', 'Auto-applied:')} ${stats.autoApplied}`);
  console.log(`  ${color('dim', 'Manual approved:')} ${stats.manualApproved}`);
  console.log(`  ${color('dim', 'Blocked:')} ${stats.blocked}`);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core functions
  analyzeConfidence,
  checkGate,
  recordDecision,
  getStats,

  // Configuration
  getGateConfig,
  CONFIDENCE_LEVELS,
  HIGH_CONFIDENCE_MARKERS,
  LOW_CONFIDENCE_MARKERS,
  QUESTION_MARKERS,
  DEFAULT_GATE_CONFIG
};

// ============================================================
// CLI Entry Point
// ============================================================

function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Usage: flow confidence <command> [options]

Commands:
  analyze "<text>"    Analyze text for confidence level
  check --file <f>    Check confidence of file contents
  stats               Show confidence statistics
  reset               Reset statistics

Options:
  --json              Output as JSON
  --no-track          Don't track in history
  --help              Show this help

Examples:
  flow confidence analyze "I think this might work, but I'm not sure"
  flow confidence analyze "This is the correct solution. Here's the fix:"
  flow confidence check --file response.txt
  flow confidence stats
`);
    return;
  }

  switch (command) {
    case 'analyze': {
      const text = positional.slice(1).join(' ') || flags.text;

      if (!text) {
        error('Please provide text to analyze');
        process.exit(1);
      }

      // Input length validation (prevent DoS)
      if (text.length > 50000) {
        error('Input text exceeds maximum length (50000 chars)');
        process.exit(1);
      }

      const analysis = analyzeConfidence(text, { track: !flags['no-track'] });

      if (flags.json) {
        outputJson(analysis);
      } else {
        printAnalysis(analysis);
      }
      break;
    }

    case 'check': {
      const file = flags.file || positional[1];

      if (!file) {
        error('Please provide a file with --file');
        process.exit(1);
      }

      // Validate path is within project directory (prevent path traversal)
      const filePath = path.resolve(file);
      if (!filePath.startsWith(PROJECT_ROOT)) {
        error('File must be within project directory');
        process.exit(1);
      }

      if (!fs.existsSync(filePath)) {
        error('File not found');
        process.exit(1);
      }

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        error('Failed to read file');
        process.exit(1);
      }

      const gateResult = checkGate(content);

      if (flags.json) {
        outputJson(gateResult);
      } else {
        printAnalysis(gateResult.confidence);
        console.log('');
        console.log(`Gate: ${gateResult.passed ? success('PASSED') : warn('REQUIRES APPROVAL')}`);
      }
      break;
    }

    case 'stats':
      if (flags.json) {
        outputJson(getStats());
      } else {
        printStats();
      }
      break;

    case 'reset':
      confidenceState = {
        history: [],
        stats: {
          totalAnalyzed: 0,
          byLevel: { high: 0, medium: 0, low: 0, needs_clarification: 0 },
          autoApplied: 0,
          manualApproved: 0,
          blocked: 0
        }
      };
      saveState();
      success('Statistics reset');
      break;

    default:
      error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}
