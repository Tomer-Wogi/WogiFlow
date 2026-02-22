#!/usr/bin/env node

/**
 * Zero-Loss Extraction Module
 *
 * PHILOSOPHY: Capture 100% of content, let humans confirm nothing is missing.
 *
 * This module replaces the lossy extraction approach with a zero-loss system:
 * 1. CAPTURE EVERYTHING - no filtering at extraction stage
 * 2. DEDUPLICATE - merge similar items intelligently
 * 3. CLASSIFY - score items by confidence (not filter)
 * 4. REVIEW - mandatory human review before proceeding
 * 5. CONFIRM - user explicitly confirms the list is complete
 *
 * The old approach: Input → Filter → Filter → Output (70-80% lost)
 * The new approach: Input → Capture All → Dedupe → Review → Confirm → Output (100% captured)
 */

// fs and path not needed - this module is pure extraction logic
// File I/O is handled by flow-extraction-review.js

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default extraction options
 */
const DEFAULT_OPTIONS = {
  // Similarity threshold for deduplication (0-1)
  // Higher = stricter matching, fewer merges
  // Lower = more aggressive deduplication
  similarityThreshold: 0.8,

  // Maximum statements to extract (prevents DoS on huge inputs)
  maxStatements: 10000,

  // Maximum text length per pattern match (prevents ReDoS)
  maxPatternMatchLength: 200
};

/**
 * Patterns that indicate HIGH confidence this is a task/requirement
 * These are SCORING patterns, not FILTERING patterns
 * Note: Unbounded quantifiers limited to 200 chars to prevent ReDoS
 */
const HIGH_CONFIDENCE_PATTERNS = [
  // Explicit requirements
  /\bshould\s+(be|have|show|display|allow|support|include|enable)/i,
  /\bmust\s+(be|have|show|display|allow|support|include|enable)/i,
  /\bneed(s)?\s+(to|a|the)/i,

  // Action verbs
  /\badd\s+(a|the|some|an)/i,
  /\bcreate\s+(a|the|some|an)/i,
  /\bimplement\b/i,
  /\bbuild\s+(a|the|some|an)/i,
  /\bmake\s+(a|the|some|an|it|this|sure)/i,

  // Conditional requirements (bounded to prevent ReDoS)
  /\bwhen\s+.{3,100}\s+then\b/i,
  /\bif\s+.{3,100}\s+(should|must|will|can)\b/i,

  // Conversational task indicators
  /\b(i|we)\s+would\s+like\b/i,
  /\b(i|we)\s+want\s+(to|a|the)/i,
  /\bcan\s+(we|you|they)\s+(have|add|get|see|make)/i,
  /\blet['']?s\s+(add|create|build|make|change|fix|update|remove)/i,

  // Action requests (bounded to prevent ReDoS)
  /\bchange\s+.{2,100}\s+to\b/i,
  /\bmove\s+.{2,100}\s+to\b/i,
  /\bremove\s+(the|this|that|a|an)/i,
  /\bhide\s+(the|this|that|a|an)/i,
  /\bdisable\s+(the|this|that|a|an)/i,
  /\benable\s+(the|this|that|a|an)/i,
  /\bdelete\s+(the|this|that|a|an)/i,
  /\bupdate\s+(the|this|that|a|an)/i,
  /\bfix\s+(the|this|that|a|an)/i,

  // Ensure/verify patterns
  /\bensure\s+(that|the)/i,
  /\bverify\s+(that|the)/i,
  /\bcheck\s+(that|the|if)/i,

  // User experience patterns
  /\b(user|they|customer|client)\s+(should|can|will|must)\s+(see|be able|have)/i,
  /\bit\s+should\s+be\s+(possible|able|easy)/i,

  // Interaction patterns
  /\bwhen\s+(i|user|they|clicking|selecting|pressing)/i,
  /\bafter\s+(clicking|selecting|opening|closing|saving)/i,
  /\bon\s+(click|tap|hover|focus|submit)/i,

  // Display/show patterns
  /\bshow\s+(the|a|an|me|us)/i,
  /\bdisplay\s+(the|a|an)/i,
];

/**
 * Patterns that indicate MEDIUM confidence
 * Note: Unbounded quantifiers limited to 200 chars to prevent ReDoS
 */
const MEDIUM_CONFIDENCE_PATTERNS = [
  // Softer requests
  /\bmaybe\s+(we|you|it)\s+(could|should|can)/i,
  /\bperhaps\s+(we|you|it)/i,
  /\bit\s+would\s+be\s+(nice|good|better|great)/i,
  /\bwhat\s+if\s+(we|you|it)/i,

  // Questions that imply tasks (bounded to prevent ReDoS)
  /\bcan\s+we\s+.{5,200}\?/i,
  /\bshould\s+we\s+.{5,200}\?/i,
  /\bwhat\s+about\s+.{5,200}\?/i,
  /\bhow\s+about\s+.{5,200}\?/i,

  // Future tense discussions
  /\bwe'll\s+(need|have|want)\s+to/i,
  /\bgoing\s+to\s+(need|have|want)\s+to/i,

  // Consideration patterns
  /\bconsider\s+(adding|removing|changing)/i,
  /\bthink\s+about\s+(adding|removing|changing)/i,
];

/**
 * Patterns that indicate this is PURELY conversational filler
 * These items are STILL CAPTURED but marked as low-priority
 */
const FILLER_PATTERNS = [
  /^(um+|uh+|er+|ah+|hmm+)$/i,
  /^(okay|ok|got it|makes sense|sure|yeah|yep|yes|no|nope|alright|right|correct)$/i,
  /^(hi|hello|hey)(\s+(everyone|all|there))?$/i,
  /^(thanks|thank you|bye|goodbye|see you)(\s+.{0,10})?$/i,
  /^(can you hear me|let me share|one moment|hold on|one sec)$/i,
  /^(exactly|absolutely|totally|definitely|precisely)$/i,
];

// =============================================================================
// ZERO-LOSS STATEMENT EXTRACTION
// =============================================================================

/**
 * Split text using multiple strategies to capture everything
 * Returns array of statement objects with extraction metadata
 */
function extractAllStatements(text) {
  const statements = [];
  const seen = new Set(); // For basic deduplication
  let globalId = 0;

  // Strategy 1: Sentence boundaries (period, exclamation, question)
  const sentenceSplits = splitBySentence(text);
  for (const s of sentenceSplits) {
    const normalized = normalizeForDedup(s.text);
    if (!seen.has(normalized) && s.text.trim().length > 0) {
      seen.add(normalized);
      statements.push({
        id: `stmt-${++globalId}`,
        text: s.text.trim(),
        extraction_method: 'sentence_boundary',
        position: s.position,
        speaker: s.speaker,
        timestamp: s.timestamp
      });
    }
  }

  // Strategy 2: Line breaks (each line could be a distinct item)
  const lineSplits = splitByLine(text);
  for (const s of lineSplits) {
    const normalized = normalizeForDedup(s.text);
    if (!seen.has(normalized) && s.text.trim().length > 0) {
      seen.add(normalized);
      statements.push({
        id: `stmt-${++globalId}`,
        text: s.text.trim(),
        extraction_method: 'line_break',
        position: s.position,
        speaker: s.speaker,
        timestamp: s.timestamp
      });
    }
  }

  // Strategy 3: Speaker changes
  const speakerSplits = splitBySpeaker(text);
  for (const s of speakerSplits) {
    const normalized = normalizeForDedup(s.text);
    if (!seen.has(normalized) && s.text.trim().length > 0) {
      seen.add(normalized);
      statements.push({
        id: `stmt-${++globalId}`,
        text: s.text.trim(),
        extraction_method: 'speaker_change',
        position: s.position,
        speaker: s.speaker,
        timestamp: s.timestamp
      });
    }
  }

  // Strategy 4: Bullet points and numbered lists
  const listSplits = splitByListItems(text);
  for (const s of listSplits) {
    const normalized = normalizeForDedup(s.text);
    if (!seen.has(normalized) && s.text.trim().length > 0) {
      seen.add(normalized);
      statements.push({
        id: `stmt-${++globalId}`,
        text: s.text.trim(),
        extraction_method: 'list_item',
        position: s.position,
        speaker: s.speaker,
        timestamp: s.timestamp
      });
    }
  }

  // Strategy 5: Comma-separated items when followed by action verbs
  const commaSplits = splitByCommaWithAction(text);
  for (const s of commaSplits) {
    const normalized = normalizeForDedup(s.text);
    if (!seen.has(normalized) && s.text.trim().length > 0) {
      seen.add(normalized);
      statements.push({
        id: `stmt-${++globalId}`,
        text: s.text.trim(),
        extraction_method: 'comma_action',
        position: s.position,
        speaker: s.speaker,
        timestamp: s.timestamp
      });
    }
  }

  return statements;
}

/**
 * Split by sentence boundaries
 * Note: Avoids lookbehind regex for Node.js < 8.10 compatibility
 */
function splitBySentence(text) {
  const results = [];

  // Split on sentence-ending punctuation followed by whitespace
  // Using match instead of split with lookbehind for compatibility
  const sentencePattern = /[^.!?]+[.!?]+/g;
  let match;
  let lastIndex = 0;

  while ((match = sentencePattern.exec(text)) !== null) {
    const part = match[0].trim();
    if (part) {
      const { speaker, timestamp, content } = extractMetadata(part);
      results.push({
        text: content,
        position: match.index,
        speaker,
        timestamp
      });
    }
    lastIndex = sentencePattern.lastIndex;
  }

  // Capture any remaining text after the last sentence
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex).trim();
    if (remaining) {
      const { speaker, timestamp, content } = extractMetadata(remaining);
      results.push({
        text: content,
        position: lastIndex,
        speaker,
        timestamp
      });
    }
  }

  return results;
}

/**
 * Split by line breaks
 */
function splitByLine(text) {
  const results = [];
  const lines = text.split(/\n+/);
  let position = 0;

  for (const line of lines) {
    if (line.trim()) {
      const { speaker, timestamp, content } = extractMetadata(line);
      results.push({
        text: content,
        position,
        speaker,
        timestamp
      });
    }
    position += line.length + 1;
  }

  return results;
}

/**
 * Split by speaker changes
 */
function splitBySpeaker(text) {
  const results = [];

  // Various speaker formats
  const speakerPatterns = [
    /^([A-Z][a-zA-Z\s'-]+):\s*/gm,           // "John Smith: "
    /^\[([^\]]+)\]:\s*/gm,                    // "[Speaker]: "
    /^From\s+([^:]+):\s*/gm,                  // "From John: "
    /^\d{1,2}:\d{2}(?::\d{2})?\s+([^:]+):\s*/gm  // "10:30 John: "
  ];

  let lastEnd = 0;
  let currentSpeaker = null;

  for (const pattern of speakerPatterns) {
    let match;
    const regex = new RegExp(pattern.source, 'gm');

    while ((match = regex.exec(text)) !== null) {
      // Get content before this speaker
      if (match.index > lastEnd && currentSpeaker) {
        const content = text.substring(lastEnd, match.index).trim();
        if (content) {
          results.push({
            text: content,
            position: lastEnd,
            speaker: currentSpeaker,
            timestamp: null
          });
        }
      }

      currentSpeaker = match[1];
      lastEnd = match.index + match[0].length;
    }
  }

  // Get remaining content
  if (lastEnd < text.length) {
    const content = text.substring(lastEnd).trim();
    if (content) {
      results.push({
        text: content,
        position: lastEnd,
        speaker: currentSpeaker,
        timestamp: null
      });
    }
  }

  return results;
}

/**
 * Split by list items (bullets, numbers)
 */
function splitByListItems(text) {
  const results = [];

  // Match numbered lists, bullets, dashes, asterisks
  const listPattern = /^[\s]*(?:[-*•]|\d+[.)]\s*)\s*(.+)$/gm;

  let match;
  while ((match = listPattern.exec(text)) !== null) {
    if (match[1].trim()) {
      results.push({
        text: match[1].trim(),
        position: match.index,
        speaker: null,
        timestamp: null
      });
    }
  }

  return results;
}

/**
 * Split by commas when followed by action patterns
 */
function splitByCommaWithAction(text) {
  const results = [];
  const actionStarters = /^(also|and|then|plus|additionally|furthermore|moreover)\s+(we\s+)?(need|want|should|must|have\s+to|add|create|fix|update|change)/i;

  // Split by comma
  const parts = text.split(/,\s+/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();

    // Check if this part starts with action patterns
    if (actionStarters.test(part)) {
      results.push({
        text: part,
        position: 0, // Approximate
        speaker: null,
        timestamp: null
      });
    }
  }

  return results;
}

/**
 * Extract speaker and timestamp metadata from text
 */
function extractMetadata(text) {
  let content = text.trim();
  let speaker = null;
  let timestamp = null;

  // Extract speaker
  const speakerMatch = content.match(/^([A-Z][a-zA-Z\s'-]+):\s*/);
  if (speakerMatch) {
    speaker = speakerMatch[1];
    content = content.slice(speakerMatch[0].length);
  }

  // Extract timestamp
  const timestampMatch = content.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/);
  if (timestampMatch) {
    timestamp = timestampMatch[1];
    content = content.slice(timestampMatch[0].length);
  }

  return { speaker, timestamp, content: content.trim() };
}

/**
 * Normalize text for deduplication comparison
 */
function normalizeForDedup(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100); // Use first 100 chars as signature
}

// =============================================================================
// CONFIDENCE SCORING (NOT FILTERING!)
// =============================================================================

/**
 * Score a statement's confidence that it's a task/requirement
 * NEVER filters - only scores for prioritization
 */
function scoreStatement(text) {
  const trimmed = text.trim();
  const result = {
    confidence: 'medium',  // Default: medium confidence
    score: 0.5,
    signals: [],
    is_filler: false,
    word_count: trimmed.split(/\s+/).length
  };

  // Check for high-confidence patterns
  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      result.confidence = 'high';
      result.score = 0.9;
      result.signals.push('high_confidence_pattern');
      break;
    }
  }

  // Check for medium-confidence patterns (if not already high)
  if (result.confidence !== 'high') {
    for (const pattern of MEDIUM_CONFIDENCE_PATTERNS) {
      if (pattern.test(trimmed)) {
        result.confidence = 'medium';
        result.score = 0.7;
        result.signals.push('medium_confidence_pattern');
        break;
      }
    }
  }

  // Check if it's filler (STILL captured, just marked)
  for (const pattern of FILLER_PATTERNS) {
    if (pattern.test(trimmed)) {
      result.is_filler = true;
      result.signals.push('filler_pattern');
      // Only reduce confidence if no other signals
      if (result.signals.length === 1) {
        result.confidence = 'low';
        result.score = 0.2;
      }
      break;
    }
  }

  // Boost confidence for longer statements (more likely to be substantive)
  if (result.word_count >= 10 && result.confidence !== 'high') {
    result.score = Math.min(result.score + 0.1, 0.9);
    result.signals.push('substantial_length');
  }

  // Lower score for very short statements without patterns
  if (result.word_count < 4 && result.signals.length === 0) {
    result.confidence = 'low';
    result.score = 0.3;
    result.signals.push('brief_no_patterns');
  }

  return result;
}

// =============================================================================
// INTELLIGENT DEDUPLICATION
// =============================================================================

/**
 * Deduplicate statements while preserving all unique information
 * @param {Array} statements - Array of statement objects
 * @param {Object} options - Options including similarityThreshold
 */
function deduplicateStatements(statements, options = {}) {
  const threshold = options.similarityThreshold || DEFAULT_OPTIONS.similarityThreshold;
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < statements.length; i++) {
    if (assigned.has(i)) continue;

    const group = [statements[i]];
    assigned.add(i);

    for (let j = i + 1; j < statements.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = calculateSimilarity(statements[i].text, statements[j].text);
      if (similarity > threshold) {
        group.push(statements[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  // Merge each group into single representative statement
  return groups.map(group => mergeStatementGroup(group));
}

/**
 * Calculate similarity between two texts (Jaccard similarity)
 */
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(Boolean));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(Boolean));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  // Guard against division by zero (both texts empty = identical)
  if (union.size === 0) return 1;

  return intersection.size / union.size;
}

/**
 * Merge a group of similar statements into one
 */
function mergeStatementGroup(group) {
  if (group.length === 1) {
    return group[0];
  }

  // Pick the longest statement as the representative
  const representative = group.reduce((longest, current) =>
    current.text.length > longest.text.length ? current : longest
  );

  // Combine metadata from all variants
  const speakers = [...new Set(group.map(s => s.speaker).filter(Boolean))];
  const timestamps = [...new Set(group.map(s => s.timestamp).filter(Boolean))];
  const methods = [...new Set(group.map(s => s.extraction_method))];

  return {
    ...representative,
    merged_from: group.length,
    all_speakers: speakers,
    all_timestamps: timestamps,
    extraction_methods: methods,
    variants: group.map(s => s.text)
  };
}

// =============================================================================
// REVIEW PHASE
// =============================================================================

/**
 * Prepare statements for human review
 * Groups by confidence and formats for easy review
 */
function prepareForReview(statements) {
  // Score all statements
  const scored = statements.map(stmt => ({
    ...stmt,
    scoring: scoreStatement(stmt.text)
  }));

  // Group by confidence level (single pass instead of 4 filter passes)
  const groups = scored.reduce((acc, s) => {
    if (s.scoring.is_filler) acc.filler.push(s);
    if (s.scoring.confidence === 'high') acc.high.push(s);
    else if (s.scoring.confidence === 'medium') acc.medium.push(s);
    else if (s.scoring.confidence === 'low') acc.low.push(s);
    return acc;
  }, { high: [], medium: [], low: [], filler: [] });
  const { high: highConfidence, medium: mediumConfidence, low: lowConfidence, filler } = groups;

  return {
    total: statements.length,
    summary: {
      high_confidence: highConfidence.length,
      medium_confidence: mediumConfidence.length,
      low_confidence: lowConfidence.length,
      potential_filler: filler.length
    },
    items: {
      // High confidence items - almost certainly tasks
      high: highConfidence.map(formatForReview),
      // Medium confidence - likely tasks, worth reviewing
      medium: mediumConfidence.map(formatForReview),
      // Low confidence - might be tasks, need review
      low: lowConfidence.map(formatForReview),
      // Filler - probably not tasks, but included for completeness
      filler: filler.map(formatForReview)
    },
    // Flat list for iteration
    all: scored.map(formatForReview)
  };
}

/**
 * Format a statement for human review
 */
function formatForReview(stmt) {
  return {
    id: stmt.id,
    text: stmt.text,
    confidence: stmt.scoring.confidence,
    score: stmt.scoring.score,
    signals: stmt.scoring.signals,
    is_filler: stmt.scoring.is_filler,
    word_count: stmt.scoring.word_count,
    speaker: stmt.speaker,
    timestamp: stmt.timestamp,
    extraction_method: stmt.extraction_method,
    // For merged items
    merged_from: stmt.merged_from,
    variants: stmt.variants,
    // User actions during review
    status: 'pending',  // pending, confirmed, removed, merged
    user_notes: null,
    merged_into: null
  };
}

// =============================================================================
// MAIN EXTRACTION PIPELINE
// =============================================================================

/**
 * Main zero-loss extraction function
 * Returns everything captured, ready for human review
 *
 * @param {string} text - Input text to extract from
 * @param {Object} options - Extraction options
 * @param {number} options.similarityThreshold - Threshold for deduplication (0-1, default 0.8)
 * @param {number} options.maxStatements - Maximum statements to extract (default 10000)
 */
function extractZeroLoss(text, options = {}) {
  const startTime = Date.now();

  // Merge options with defaults
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Input validation
  if (typeof text !== 'string') {
    throw new Error('Input must be a string');
  }

  // Handle empty input
  if (!text.trim()) {
    return {
      extraction_method: 'zero_loss',
      version: '1.0.0',
      processed_at: new Date().toISOString(),
      processing_time_ms: 0,
      input: { char_count: 0, word_count: 0, line_count: 0 },
      extraction: { raw_statements: 0, after_dedup: 0, reduction_rate: '0.0%' },
      review: { total: 0, summary: { high_confidence: 0, medium_confidence: 0, low_confidence: 0, potential_filler: 0 }, items: { high: [], medium: [], low: [], filler: [] }, all: [] },
      metadata: { requires_human_review: false, message: 'Empty input - nothing to extract' }
    };
  }

  // Step 1: Extract ALL statements using multiple strategies
  let rawStatements = extractAllStatements(text);

  // Apply max statement limit to prevent DoS
  let truncated = false;
  if (rawStatements.length > opts.maxStatements) {
    rawStatements = rawStatements.slice(0, opts.maxStatements);
    truncated = true;
  }

  // Step 2: Deduplicate (merge similar items)
  const deduped = deduplicateStatements(rawStatements, opts);

  // Step 3: Prepare for review (score, group, format)
  const reviewReady = prepareForReview(deduped);

  const processingTime = Date.now() - startTime;

  const result = {
    extraction_method: 'zero_loss',
    version: '1.0.0',
    processed_at: new Date().toISOString(),
    processing_time_ms: processingTime,
    input: {
      char_count: text.length,
      word_count: text.split(/\s+/).filter(Boolean).length,
      line_count: text.split('\n').length
    },
    extraction: {
      raw_statements: rawStatements.length,
      after_dedup: deduped.length,
      reduction_rate: rawStatements.length === 0 ? '0.0%' :
        ((rawStatements.length - deduped.length) / rawStatements.length * 100).toFixed(1) + '%',
      truncated,
      max_statements: opts.maxStatements
    },
    review: reviewReady,
    metadata: {
      requires_human_review: true,
      review_instructions: [
        '1. Review ALL items in the high-confidence list - these are almost certainly tasks',
        '2. Check medium-confidence items - many will be valid tasks',
        '3. Scan low-confidence items - some may be tasks phrased informally',
        '4. Review filler items only if you suspect something was missed',
        '5. Mark items as confirmed, removed, or merge similar ones',
        '6. NOTHING IS DELETED - everything is captured for your review'
      ],
      options_used: {
        similarityThreshold: opts.similarityThreshold,
        maxStatements: opts.maxStatements
      }
    }
  };

  if (truncated) {
    result.metadata.warning = `Input exceeded ${opts.maxStatements} statements limit. Some statements may have been truncated.`;
  }

  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Configuration
  DEFAULT_OPTIONS,

  // Main extraction
  extractZeroLoss,
  extractAllStatements,

  // Individual strategies
  splitBySentence,
  splitByLine,
  splitBySpeaker,
  splitByListItems,
  splitByCommaWithAction,

  // Scoring (not filtering!)
  scoreStatement,
  HIGH_CONFIDENCE_PATTERNS,
  MEDIUM_CONFIDENCE_PATTERNS,
  FILLER_PATTERNS,

  // Deduplication
  deduplicateStatements,
  calculateSimilarity,
  mergeStatementGroup,

  // Review
  prepareForReview,
  formatForReview,

  // Utils
  extractMetadata,
  normalizeForDedup
};

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'test') {
    // Test with sample text
    const sample = `
John: We need to add a login button to the header.
Sarah: Yeah, and also we should have a logout option somewhere.
John: Makes sense. Let me share my screen.
Sarah: Can you hear me?
John: Yes. So about the login, I would like it to be on the top right.
Sarah: Got it. And we want to add remember me checkbox too.
John: Exactly. Oh, and change the color to blue.
Sarah: Should we add social login? Like Google and Facebook?
John: Let's add Google first, we can do Facebook later.
Sarah: Ok, also fix the bug where users can't reset their password.
    `;

    const result = extractZeroLoss(sample);
    console.log(JSON.stringify(result, null, 2));
  } else if (args[0] === 'extract') {
    // Read from stdin
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const result = extractZeroLoss(input);
      console.log(JSON.stringify(result, null, 2));
    });
  } else {
    console.log('Zero-Loss Extraction Module');
    console.log('Usage:');
    console.log('  node flow-zero-loss-extraction.js test     # Run with sample text');
    console.log('  node flow-zero-loss-extraction.js extract  # Read from stdin');
    console.log('  echo "text" | node flow-zero-loss-extraction.js extract');
  }
}
