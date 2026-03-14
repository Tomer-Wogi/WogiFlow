'use strict';

/**
 * Long Input Processing - Large Input Detection & Content Classification
 *
 * E4-S1: Large input detection (VTT, SRT, meeting transcript format detection,
 *         threshold evaluation, trigger recommendations)
 * E4-S2: Content type classification (pattern-based scoring, type determination,
 *         processing recommendations)
 *
 * Extracted from flow-long-input.js.
 */

const { estimateTokens, getConfig } = require('./flow-utils');

// ============================================
// Helpers (injected via init)
// ============================================

let _countWords = null;
let _classifyContent = null;
let _initialized = false;

/**
 * Initialize with functions from the main module to avoid circular deps.
 * @param {Object} deps - { countWords, classifyContent }
 */
function init(deps) {
  _countWords = deps.countWords;
  _classifyContent = deps.classifyContent;
  _initialized = true;
}

function countWords(text) {
  if (_countWords) return _countWords(text);
  // Fallback
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function classifyContent(text) {
  if (_classifyContent) return _classifyContent(text);
  return { type: 'unknown', confidence: 0.5 };
}

function loadConfig() {
  try {
    const config = getConfig();
    return config.longInputGate || config.transcriptDigestion || {};
  } catch (_err) {
    return {};
  }
}

// ==========================================================================
// E4-S1: Large Input Detection Functions
// ==========================================================================

/**
 * VTT format patterns
 */
const VTT_PATTERNS = {
  header: /^WEBVTT/m,
  timestamp: /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/g,
  cue: /^\d+$/m
};

/**
 * SRT format patterns
 */
const SRT_PATTERNS = {
  timestamp: /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g,
  cueWithTimestamp: /^\d+\n\d{2}:\d{2}/gm
};

/**
 * Meeting transcript patterns
 */
const MEETING_PATTERNS = {
  // Zoom format
  zoom: /^\d{2}:\d{2}:\d{2}\s+From\s+.+\s+to\s+/m,
  zoomTranscript: /^\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]/m,
  // Teams format
  teams: /^\d{1,2}:\d{2}\s+(AM|PM)\s+/mi,
  teamsExport: /^From:\s+.+\nSent:\s+/m,
  // Google Meet
  meet: /^\[\d{2}:\d{2}\]\s+[A-Za-z]/m,
  // Generic formats
  genericSpeaker: /^[A-Z][a-z]+\s[A-Z][a-z]+:\s/m,
  genericTimestamp: /^\[\d{2}:\d{2}(:\d{2})?\]\s/m
};

/**
 * Measure detailed input metrics
 */
function measureInputMetrics(text) {
  const wordCount = countWords(text);
  const charCount = text.length;
  const lines = text.split('\n');
  const lineCount = lines.length;

  // Count paragraphs (separated by 2+ newlines)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const paragraphCount = paragraphs.length;

  // Estimate tokens (rough: ~4 chars/token for English)
  const estimatedTokens_ = estimateTokens(text);

  // Calculate averages
  const avgWordsPerLine = lineCount > 0 ? Math.round(wordCount / lineCount * 10) / 10 : 0;
  const avgCharsPerWord = wordCount > 0 ? Math.round(charCount / wordCount * 10) / 10 : 0;

  return {
    wordCount,
    charCount,
    lineCount,
    paragraphCount,
    estimatedTokens: estimatedTokens_,
    avgWordsPerLine,
    avgCharsPerWord
  };
}

/**
 * Detect VTT subtitle format
 */
function isVTTFormat(text) {
  // Check for WEBVTT header
  if (VTT_PATTERNS.header.test(text)) {
    return { detected: true, confidence: 0.95 };
  }

  // Check for VTT timestamps
  const timestamps = text.match(VTT_PATTERNS.timestamp);
  if (timestamps && timestamps.length > 5) {
    return { detected: true, confidence: 0.85 };
  }

  return { detected: false, confidence: 0 };
}

/**
 * Detect SRT subtitle format
 */
function isSRTFormat(text) {
  const timestamps = text.match(SRT_PATTERNS.timestamp);
  const cueNumbers = text.match(SRT_PATTERNS.cueWithTimestamp);

  if (timestamps && timestamps.length > 3 && cueNumbers && cueNumbers.length > 3) {
    return { detected: true, confidence: 0.9 };
  }

  if (timestamps && timestamps.length > 5) {
    return { detected: true, confidence: 0.7 };
  }

  return { detected: false, confidence: 0 };
}

/**
 * Detect meeting transcript format
 */
function detectMeetingFormat(text) {
  // Zoom format
  if (MEETING_PATTERNS.zoom.test(text) || MEETING_PATTERNS.zoomTranscript.test(text)) {
    return { format: 'zoom', confidence: 0.9 };
  }

  // Teams format
  if (MEETING_PATTERNS.teams.test(text) || MEETING_PATTERNS.teamsExport.test(text)) {
    return { format: 'teams', confidence: 0.9 };
  }

  // Google Meet
  if (MEETING_PATTERNS.meet.test(text)) {
    return { format: 'google_meet', confidence: 0.85 };
  }

  // Generic speaker format
  const speakerMatches = text.match(MEETING_PATTERNS.genericSpeaker);
  if (speakerMatches && speakerMatches.length > 5) {
    return { format: 'generic_transcript', confidence: 0.75 };
  }

  // Generic timestamp format
  const timestampMatches = text.match(MEETING_PATTERNS.genericTimestamp);
  if (timestampMatches && timestampMatches.length > 10) {
    return { format: 'generic_transcript', confidence: 0.7 };
  }

  return null;
}

/**
 * Detect input format (VTT, SRT, meeting, requirements, code)
 */
function detectInputFormat(text) {
  // Check VTT
  const vtt = isVTTFormat(text);
  if (vtt.detected) {
    return { type: 'subtitle', subtype: 'vtt', confidence: vtt.confidence };
  }

  // Check SRT
  const srt = isSRTFormat(text);
  if (srt.detected) {
    return { type: 'subtitle', subtype: 'srt', confidence: srt.confidence };
  }

  // Check meeting formats
  const meeting = detectMeetingFormat(text);
  if (meeting) {
    return { type: 'transcript', subtype: meeting.format, confidence: meeting.confidence };
  }

  // Fall back to basic classification
  const basic = classifyContent(text);
  return { type: basic.type, subtype: null, confidence: basic.confidence };
}

/**
 * Comprehensive input analysis
 */
function analyzeInput(text) {
  const metrics = measureInputMetrics(text);
  const format = detectInputFormat(text);
  const config = loadConfig();
  const triggerConfig = config.autoTrigger || {};

  // Default thresholds
  const minWordCount = triggerConfig.minWordCount || 2000;
  const minTokenCount = triggerConfig.minTokenCount || 3000;

  // Apply format multipliers
  const multipliers = triggerConfig.formatMultipliers || {
    vtt: 0.7,
    srt: 0.7,
    transcript: 1.0,
    requirements: 0.8
  };

  const multiplier = multipliers[format.subtype] || multipliers[format.type] || 1.0;
  const effectiveWordThreshold = Math.round(minWordCount * multiplier);
  const effectiveTokenThreshold = Math.round(minTokenCount * multiplier);

  // Check thresholds
  const thresholds = {
    wordCount: {
      threshold: effectiveWordThreshold,
      value: metrics.wordCount,
      exceeded: metrics.wordCount >= effectiveWordThreshold
    },
    estimatedTokens: {
      threshold: effectiveTokenThreshold,
      value: metrics.estimatedTokens,
      exceeded: metrics.estimatedTokens >= effectiveTokenThreshold
    }
  };

  // Calculate overall confidence
  let confidence = 0;

  // Size-based confidence
  if (thresholds.wordCount.exceeded && thresholds.estimatedTokens.exceeded) {
    confidence += 0.4;
  } else if (thresholds.wordCount.exceeded || thresholds.estimatedTokens.exceeded) {
    confidence += 0.25;
  }

  // Format-based confidence
  if (format.type === 'transcript' || format.type === 'subtitle') {
    confidence += 0.4 * format.confidence;
  } else if (format.type === 'requirements') {
    confidence += 0.35 * format.confidence;
  } else if (format.type === 'code') {
    confidence -= 0.3; // Reduce confidence for code
  }

  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    metrics,
    format,
    thresholds,
    confidence: Math.round(confidence * 100) / 100
  };
}

/**
 * Evaluate whether to trigger digestion
 */
function evaluateTrigger(analysis) {
  const config = loadConfig();
  const triggerConfig = config.autoTrigger || {};

  const excludeTypes = triggerConfig.excludeTypes || ['code', 'documentation'];
  const autoThreshold = triggerConfig.autoThreshold || 0.85;
  const askThreshold = triggerConfig.askThreshold || 0.6;

  // Never trigger for excluded types
  if (excludeTypes.includes(analysis.format.type)) {
    return {
      trigger: false,
      reason: 'excluded_type',
      message: `Content type "${analysis.format.type}" is excluded from auto-trigger.`
    };
  }

  // Auto-trigger for high confidence
  if (analysis.confidence >= autoThreshold) {
    return {
      trigger: true,
      reason: 'auto_high_confidence',
      message: generateRecommendationMessage(analysis)
    };
  }

  // Ask for medium confidence
  if (analysis.confidence >= askThreshold) {
    return {
      trigger: 'ask',
      reason: 'medium_confidence',
      message: generateRecommendationMessage(analysis)
    };
  }

  // Don't trigger for low confidence
  return {
    trigger: false,
    reason: 'low_confidence',
    message: `Input doesn't appear to be a transcript or requirements document (confidence: ${Math.round(analysis.confidence * 100)}%).`
  };
}

/**
 * Generate recommendation message
 */
function generateRecommendationMessage(analysis) {
  const { metrics, format } = analysis;
  const formatName = format.subtype ?
    `${format.subtype.replace('_', ' ')} ${format.type}` :
    format.type;

  if (format.type === 'subtitle') {
    return `This looks like a ${formatName.toUpperCase()} file with ${metrics.wordCount.toLocaleString()} words. Would you like to extract requirements using multi-pass digestion?`;
  }

  if (format.type === 'transcript') {
    const source = format.subtype ?
      format.subtype.charAt(0).toUpperCase() + format.subtype.slice(1) :
      'meeting';
    return `This looks like a ${source} transcript with ${metrics.wordCount.toLocaleString()} words. Would you like to extract requirements using multi-pass digestion?`;
  }

  if (format.type === 'requirements') {
    return `This looks like a requirements document with ${metrics.wordCount.toLocaleString()} words. Would you like to process it using multi-pass digestion?`;
  }

  return `This is a large input with ${metrics.wordCount.toLocaleString()} words (~${metrics.estimatedTokens.toLocaleString()} tokens). Would you like to process it using multi-pass digestion?`;
}

/**
 * Full detection and recommendation
 */
function detectLargeInput(text) {
  if (!_initialized && process.env.DEBUG) {
    console.error('[flow-long-input-detection] Warning: detection functions called before init()');
  }
  const analysis = analyzeInput(text);
  const evaluation = evaluateTrigger(analysis);

  return {
    shouldTrigger: evaluation.trigger,
    confidence: analysis.confidence,
    reason: evaluation.reason,
    metrics: analysis.metrics,
    format: analysis.format,
    thresholds: analysis.thresholds,
    recommendation: {
      action: evaluation.trigger === true ? 'trigger' :
              evaluation.trigger === 'ask' ? 'ask' : 'skip',
      message: evaluation.message
    }
  };
}

// ==========================================================================
// E4-S2: Content Type Classification Functions
// ==========================================================================

/**
 * Content type pattern definitions
 */
const CONTENT_TYPE_PATTERNS = {
  transcript: {
    timestamp_hms: /\d{1,2}:\d{2}:\d{2}/g,
    timestamp_hm: /\d{1,2}:\d{2}\s*(AM|PM)?/gi,
    timestamp_bracket: /\[\d{1,2}:\d{2}(:\d{2})?\]/g,
    speaker_colon: /^[A-Z][a-z]+(\s[A-Z][a-z]+)?:/gm,
    speaker_bracket: /^\[[A-Za-z\s]+\]:/gm,
    speaker_numbered: /^Speaker\s*\d+:/gim,
    filler_words: /\b(um|uh|like|you know|I mean)\b/gi
  },
  requirements: {
    must: /\bmust\b/gi,
    should: /\bshould\b/gi,
    shall: /\bshall\b/gi,
    need_to: /\bneed(s)?\s+to\b/gi,
    the_system: /\bthe\s+(system|application|app|software)\s+(should|must|shall|will)\b/gi,
    user_can: /\b(user|admin|customer)\s+(can|should|must|will)\b/gi,
    implement: /\bimplement(s|ed|ing)?\b/gi,
    feature: /\bfeature(s)?\b/gi
  },
  technical_spec: {
    endpoint: /\b(GET|POST|PUT|DELETE|PATCH)\s+\/[\w\/-]+/g,
    http_status: /\b(200|201|400|401|403|404|500)\b/g,
    json_schema: /\{\s*"type"\s*:/g,
    api: /\bAPI\b/g,
    database: /\b(database|table|schema|index|query)\b/gi,
    authentication: /\b(auth|authentication|authorization|OAuth|JWT)\b/gi,
    protocol: /\b(HTTP|HTTPS|WebSocket|REST|GraphQL|gRPC)\b/gi
  },
  meeting_notes: {
    action_item: /\b(action\s*item|action|todo|task)s?:/gi,
    assigned_to: /\bassigned\s+to\b/gi,
    due_date: /\bdue\s*(date|by)?\s*:/gi,
    decision: /\bdecision(s)?:/gi,
    attendees: /\battendees?:/gi,
    agenda: /\bagenda:/gi,
    next_steps: /\bnext\s+steps?:/gi
  },
  user_story: {
    as_a: /\bas\s+a(n)?\s+\w+/gi,
    i_want: /\bI\s+want\s+(to\s+)?\w+/gi,
    so_that: /\bso\s+that\s+\w+/gi,
    given: /\bgiven\s+\w+/gi,
    when_clause: /\bwhen\s+\w+/gi,
    then_clause: /\bthen\s+\w+/gi,
    story_id: /\b(US|STORY|USER-STORY)-?\d+\b/gi
  },
  bug_report: {
    steps_to_reproduce: /\bsteps?\s+(to\s+)?reproduce/gi,
    expected: /\bexpected\s+(result|behavior|outcome)/gi,
    actual: /\bactual\s+(result|behavior|outcome)/gi,
    bug: /\bbug\b/gi,
    issue: /\bissue\b/gi,
    defect: /\bdefect\b/gi,
    bug_id: /\b(BUG|ISSUE|DEFECT)-?\d+\b/gi
  },
  documentation: {
    md_header: /^#{1,6}\s+.+$/gm,
    code_block: /```[\s\S]*?```/g,
    inline_code: /`[^`]+`/g,
    note: /\b(note|tip|warning|important):/gi,
    example: /\bexample(s)?:/gi,
    prerequisites: /\bprerequisites?\b/gi,
    installation: /\binstallation\b/gi
  },
  email_thread: {
    from_header: /^From:\s*.+$/gm,
    to_header: /^To:\s*.+$/gm,
    subject: /^Subject:\s*.+$/gm,
    re_prefix: /^Re:\s*/gm,
    fwd_prefix: /^Fwd?:\s*/gm,
    wrote: /wrote:/gi,
    regards: /\b(regards|best|thanks|cheers),?\s*$/gim
  },
  code: {
    function_decl: /\b(function|def|fn|func)\s+\w+\s*\(/g,
    class_decl: /\bclass\s+\w+/g,
    variable_decl: /\b(const|let|var|int|string|bool)\s+\w+\s*=/g,
    import_stmt: /\b(import|require|from)\s+['"\w]/g,
    export_stmt: /\b(export|module\.exports)\b/g,
    arrow_functions: /=>\s*[\{\(]/g,
    semicolons: /;\s*$/gm
  }
};

/**
 * Pattern weights for scoring
 */
const PATTERN_WEIGHTS = {
  transcript: {
    speaker_colon: 3,
    speaker_bracket: 3,
    speaker_numbered: 3,
    timestamp_hms: 2,
    filler_words: 1
  },
  requirements: {
    the_system: 3,
    user_can: 3,
    must: 2,
    should: 1,
    need_to: 2
  },
  technical_spec: {
    endpoint: 4,
    json_schema: 3,
    api: 2,
    protocol: 2
  },
  meeting_notes: {
    action_item: 4,
    decision: 3,
    attendees: 2,
    agenda: 2
  },
  user_story: {
    as_a: 4,
    i_want: 4,
    so_that: 3,
    given: 2,
    when_clause: 2,
    then_clause: 2
  },
  bug_report: {
    steps_to_reproduce: 5,
    expected: 3,
    actual: 3,
    bug_id: 3
  },
  documentation: {
    md_header: 2,
    code_block: 2,
    example: 2
  },
  email_thread: {
    from_header: 4,
    subject: 3,
    re_prefix: 3
  },
  code: {
    function_decl: 3,
    class_decl: 3,
    import_stmt: 2,
    arrow_functions: 2
  }
};

/**
 * Processing recommendations for each content type
 */
const PROCESSING_RECOMMENDATIONS = {
  transcript: {
    action: 'full_digestion',
    description: 'Full multi-pass digestion recommended for meeting transcript'
  },
  requirements: {
    action: 'story_generation',
    description: 'Direct story generation from requirements document'
  },
  technical_spec: {
    action: 'technical_extraction',
    description: 'Extract technical requirements and constraints'
  },
  meeting_notes: {
    action: 'action_extraction',
    description: 'Extract action items and decisions'
  },
  user_story: {
    action: 'story_validation',
    description: 'Parse and validate existing user stories'
  },
  bug_report: {
    action: 'issue_conversion',
    description: 'Convert to structured issue format'
  },
  documentation: {
    action: 'concept_extraction',
    description: 'Extract key concepts and requirements'
  },
  email_thread: {
    action: 'action_extraction',
    description: 'Extract action items from email thread'
  },
  code: {
    action: 'skip',
    description: 'Code content - digestion not applicable'
  },
  unknown: {
    action: 'manual_review',
    description: 'Content type unclear - manual review recommended'
  }
};

/**
 * Score content for a specific type
 */
function scoreContentType(text, type) {
  const patterns = CONTENT_TYPE_PATTERNS[type];
  const weights = PATTERN_WEIGHTS[type] || {};

  if (!patterns) return { score: 0, evidence: [] };

  let totalScore = 0;
  const evidence = [];

  for (const [name, pattern] of Object.entries(patterns)) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const weight = weights[name] || 1;
      const matchScore = matches.length * weight;
      totalScore += matchScore;

      evidence.push({
        pattern: name,
        count: matches.length,
        weight: weight,
        contribution: matchScore,
        samples: matches.slice(0, 3).map(m => m.substring(0, 50))
      });
    }
  }

  return { score: totalScore, evidence };
}

/**
 * Normalize score based on text length
 */
function normalizeScore(rawScore, wordCount) {
  if (wordCount === 0) return 0;
  // Normalize to 0-1 range, with diminishing returns for very high scores
  const normalized = rawScore / (wordCount * 0.15);
  return Math.min(1, normalized);
}

/**
 * Classify content into types with confidence scores
 */
function classifyContentTypes(text) {
  const wordCount = countWords(text);
  const scores = {};
  const evidence = {};
  const normalizedScores = {};

  // Score each content type
  for (const type of Object.keys(CONTENT_TYPE_PATTERNS)) {
    const result = scoreContentType(text, type);
    scores[type] = result.score;
    evidence[type] = result.evidence;
    normalizedScores[type] = normalizeScore(result.score, wordCount);
  }

  // Sort types by normalized score
  const sortedTypes = Object.entries(normalizedScores)
    .sort((a, b) => b[1] - a[1]);

  // Determine primary type (must exceed threshold)
  const primaryThreshold = 0.25;
  const primary = sortedTypes[0][1] >= primaryThreshold ?
    { type: sortedTypes[0][0], confidence: Math.round(sortedTypes[0][1] * 100) / 100 } :
    { type: 'unknown', confidence: 0 };

  // Determine secondary types
  const secondaryThreshold = 0.15;
  const secondary = sortedTypes
    .slice(1)
    .filter(([_, score]) => score >= secondaryThreshold)
    .map(([type, score]) => ({
      type,
      confidence: Math.round(score * 100) / 100
    }));

  // Get processing recommendation
  const recommendation = PROCESSING_RECOMMENDATIONS[primary.type] || PROCESSING_RECOMMENDATIONS.unknown;

  return {
    primary,
    secondary,
    allScores: Object.fromEntries(
      Object.entries(normalizedScores).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    evidence: evidence[primary.type] || [],
    recommendation,
    metrics: {
      wordCount,
      typesDetected: sortedTypes.filter(([_, s]) => s > 0.1).length
    }
  };
}

/**
 * Get detailed classification with all evidence
 */
function getDetailedClassification(text) {
  const wordCount = countWords(text);
  const allEvidence = {};
  const allScores = {};

  for (const type of Object.keys(CONTENT_TYPE_PATTERNS)) {
    const result = scoreContentType(text, type);
    allScores[type] = {
      raw: result.score,
      normalized: normalizeScore(result.score, wordCount)
    };
    allEvidence[type] = result.evidence;
  }

  return {
    scores: allScores,
    evidence: allEvidence,
    wordCount
  };
}

/**
 * Check if content should be excluded from digestion
 */
function shouldExcludeContent(classification) {
  const excludedTypes = ['code', 'documentation'];
  const excludedActions = ['skip'];

  if (excludedTypes.includes(classification.primary.type)) {
    return {
      exclude: true,
      reason: `Content type "${classification.primary.type}" is not suitable for digestion`
    };
  }

  if (excludedActions.includes(classification.recommendation.action)) {
    return {
      exclude: true,
      reason: classification.recommendation.description
    };
  }

  return { exclude: false };
}

module.exports = {
  // Init
  init,
  // E4-S1: Large Input Detection
  VTT_PATTERNS,
  SRT_PATTERNS,
  MEETING_PATTERNS,
  measureInputMetrics,
  isVTTFormat,
  isSRTFormat,
  detectMeetingFormat,
  detectInputFormat,
  analyzeInput,
  evaluateTrigger,
  generateRecommendationMessage,
  detectLargeInput,
  // E4-S2: Content Type Classification
  CONTENT_TYPE_PATTERNS,
  PATTERN_WEIGHTS,
  PROCESSING_RECOMMENDATIONS,
  scoreContentType,
  normalizeScore,
  classifyContentTypes,
  getDetailedClassification,
  shouldExcludeContent
};
