#!/usr/bin/env node

/**
 * Long Input Processing - Multi-pass extraction system
 *
 * Ensures nothing is missed from long/complex inputs (transcripts, prompts,
 * specs, documents). Uses a 4-pass extraction system:
 *   Pass 1: Topic extraction
 *   Pass 2: Statement association
 *   Pass 3: Orphan check
 *   Pass 4: Contradiction resolution
 *
 * Renamed from flow-transcript-digest.js in v1.8.0
 */

const fs = require('fs');
const path = require('path');
const { estimateTokens, generateHashId, getConfig } = require('./flow-utils');
const { success: printSuccess, warn: printWarn } = require('./flow-output');

// Import extracted modules (renamed from transcript-* to long-input-*)
const transcriptParsing = require('./flow-long-input-parsing');
const transcriptLanguage = require('./flow-long-input-language');
const transcriptStories = require('./flow-long-input-stories');
const transcriptChunking = require('./flow-long-input-chunking');

// Import extracted constant/function modules
const longInputConstants = require('./flow-long-input-constants');
const longInputVoice = require('./flow-long-input-voice');
const longInputDetection = require('./flow-long-input-detection');
const longInputComplexity = require('./flow-long-input-complexity');

// Destructure commonly used language functions
const {
  detectLanguage,
  detectMultipleLanguages,
  getLanguageInfo,
  LANGUAGE_INFO
} = transcriptLanguage;

// Destructure commonly used parsing functions
const {
  parseVTT,
  parseSRT,
  parseSubtitle,
  mergeCues,
  formatCuesAsText,
  getSubtitleStats,
  parseZoom,
  parseTeams,
  parseMeeting,
  mergeMeetingEntries,
  formatMeetingAsText,
  getMeetingStats
} = transcriptParsing;

// Destructure commonly used chunking functions
const {
  loadDurableSessions,
  listDurableSessions,
  getDurableSession,
  switchDurableSession,
  archiveDurableSession,
  deleteDurableSession,
  generateRecoverySummaryForSession,
  getTimeSince,
  needsChunking,
  planChunks,
  getChunkingStatus
} = transcriptChunking;

// Destructure additional language utilities
const { listSupportedLanguages } = transcriptLanguage;

// Destructure commonly used story functions
const {
  generateStoryFromTopic,
  generateAllStories,
  saveStory,
  loadStory,
  loadAllStories,
  formatStoryAsMarkdown,
  // initializePresentation - available if needed
  getPresentationStatus,
  getNextStory,
  getCurrentStory,
  approveCurrentStory,
  rejectCurrentStory,
  skipCurrentStory,
  formatStorySummary,
  formatActionsPrompt,
  getCompletionSummary,
  resetPresentation,
  // Edit session functions
  startEditSession,
  editUserStory,
  editCriterion,
  addCriterion,
  removeCriterion,
  getEditChanges,
  commitEditSession,
  cancelEditSession,
  getEditHistory,
  listEditableStories,
  // Export functions
  previewExport,
  exportApprovedStories,
  finalizeDigestion
} = transcriptStories;

// Destructure constants from extracted module
const {
  FILLER_PATTERNS, REQUIREMENT_PATTERNS, SEMANTIC_EXPANSIONS,
  CORRECTION_PATTERNS, ADDITIVE_PATTERNS,
  ENTITY_PATTERNS, VAGUE_PATTERNS, QUESTION_TEMPLATES,
  DETAIL_PATTERNS, QUESTION_TEMPLATES_BY_LANGUAGE, FOLLOWUP_TRIGGERS,
  UI_PATTERNS, DATA_PATTERNS, INTERACTION_PATTERNS, COMPLEXITY_LEVELS
} = longInputConstants;

// Destructure voice processing functions from extracted module
const {
  isVoiceInput, removeFillers, applySelfCorrections, normalizeNumbers,
  detectUncertainty, detectYesNo, addPunctuation, normalizeVoiceInput,
  calculateVoiceConfidence, processVoiceAnswer
} = longInputVoice;

// Destructure detection functions from extracted module
const {
  measureInputMetrics, isVTTFormat, isSRTFormat, detectMeetingFormat,
  detectInputFormat, analyzeInput, evaluateTrigger,
  generateRecommendationMessage, detectLargeInput,
  scoreContentType, normalizeScore, classifyContentTypes,
  getDetailedClassification, shouldExcludeContent
} = longInputDetection;

// Destructure complexity functions from extracted module
const {
  countEntityTypes, extractEntities, getComplexityLevel,
  calculateComplexityScore, isRequirement, isVagueStatement,
  hasUIComponent, hasDataModel, hasUserInteraction,
  analyzeTopicComplexity, groupRelatedTopics,
  generateEpicStructure, recommendOutputStructure
} = longInputComplexity;

// Paths - temp processing files go to .workflow/tmp/, cleaned up after completion
const TMP_DIR = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
const STATE_DIR = TMP_DIR; // Alias for backward compatibility during migration
const ACTIVE_DIGEST_FILE = path.join(TMP_DIR, 'active-digest.json');
// Colors for CLI output
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

/**
 * Load configuration
 */
function loadConfig() {
  try {
    const config = getConfig();
    return config.longInputGate || config.transcriptDigestion || {};
  } catch (_err) {
    return {};
  }
}

/**
 * Generate unique digest ID
 */
function generateDigestId() {
  return generateHashId('digest', '', '');
}

/**
 * Get current timestamp in ISO format
 */
function now() {
  return new Date().toISOString();
}

/**
 * Load active digest session
 */
function loadActiveDigest() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_DIGEST_FILE, 'utf8'));
  } catch (_err) {
    return { session: { status: 'inactive' } };
  }
}

/**
 * Save active digest session
 */
function saveActiveDigest(data) {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = ACTIVE_DIGEST_FILE + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, ACTIVE_DIGEST_FILE);
}

/**
 * Create new digest session
 */
function createSession(transcript, options = {}) {
  const digestId = generateDigestId();
  const digestPath = path.join(STATE_DIR, digestId);

  // Create digest directory
  fs.mkdirSync(digestPath, { recursive: true });

  // Save transcript
  fs.writeFileSync(path.join(digestPath, 'transcript.md'), transcript);

  // Initialize topics.json
  const topics = {
    topics: [],
    metadata: {
      total_topics: 0,
      active_topics: 0,
      clarified_topics: 0,
      generated_topics: 0,
      detected_at: null,
      last_updated: now(),
      transcript_word_count: countWords(transcript),
      detection_method: 'pass-1-extraction'
    }
  };
  fs.writeFileSync(path.join(digestPath, 'topics.json'), JSON.stringify(topics, null, 2));

  // Initialize statement-map.json
  const statementMap = {
    statements: [],
    metadata: {
      total_statements: 0,
      meaningful_statements: 0,
      mapped_statements: 0,
      orphan_statements: 0,
      contradictions_detected: 0,
      contradictions_resolved: 0,
      coverage_percentage: 0
    }
  };
  fs.writeFileSync(path.join(digestPath, 'statement-map.json'), JSON.stringify(statementMap, null, 2));

  // Initialize clarifications.json
  const clarifications = {
    questions: [],
    contradictions: [],
    metadata: {
      total_questions: 0,
      answered_questions: 0,
      pending_questions: 0,
      total_contradictions: 0,
      resolved_contradictions: 0,
      auto_resolved_count: 0,
      user_resolved_count: 0
    }
  };
  fs.writeFileSync(path.join(digestPath, 'clarifications.json'), JSON.stringify(clarifications, null, 2));

  // Initialize conversation.json (E2-S4)
  const conversation = {
    session_id: digestId,
    started_at: now(),
    last_interaction: now(),
    interactions: [{
      id: `i-${Date.now().toString(36)}`,
      type: 'session_started',
      timestamp: now(),
      data: {
        word_count: countWords(transcript),
        content_type: options.contentType || 'unknown'
      }
    }],
    checkpoints: []
  };
  fs.writeFileSync(path.join(digestPath, 'conversation.json'), JSON.stringify(conversation, null, 2));

  // Initialize orphans.json
  const orphans = {
    orphans: [],
    coverage: {
      total_meaningful: 0,
      mapped: 0,
      orphans_remaining: 0,
      percentage: 0
    }
  };
  fs.writeFileSync(path.join(digestPath, 'orphans.json'), JSON.stringify(orphans, null, 2));

  // Update active digest
  const activeDigest = {
    session: {
      id: digestId,
      started_at: now(),
      last_activity: now(),
      status: 'active',
      phase: 'ingestion',
      digest_path: digestPath
    },
    phases: {
      ingestion: { status: 'completed', started_at: now(), completed_at: now() },
      topic_extraction: { status: 'pending', started_at: null, completed_at: null, topics_found: 0 },
      statement_mapping: { status: 'pending', started_at: null, completed_at: null, statements_mapped: 0 },
      orphan_check: { status: 'pending', started_at: null, completed_at: null, orphans_resolved: 0 },
      contradiction_resolution: { status: 'pending', started_at: null, completed_at: null, contradictions_resolved: 0 },
      clarification: { status: 'pending', started_at: null, completed_at: null, questions_answered: 0, questions_total: 0 },
      story_generation: { status: 'pending', started_at: null, completed_at: null, stories_generated: 0 },
      approval: { status: 'pending', started_at: null, completed_at: null, stories_approved: 0, stories_pending: 0, current_story_index: 0 }
    },
    input: {
      source: options.source || 'paste',
      format: options.format || 'plain',
      language: options.language || null,
      word_count: countWords(transcript),
      chunked: false,
      chunk_count: 0
    },
    output: {
      stories_created: [],
      tasks_added_to_ready: []
    }
  };

  saveActiveDigest(activeDigest);

  return { digestId, digestPath, activeDigest };
}

/**
 * Count words in text
 */
function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Update phase status
 */
function updatePhase(phase, status, data = {}) {
  const activeDigest = loadActiveDigest();

  if (!activeDigest.phases) {
    console.error('No active digest session');
    return null;
  }

  activeDigest.phases[phase] = {
    ...activeDigest.phases[phase],
    status,
    ...data
  };

  if (status === 'in_progress' && !activeDigest.phases[phase].started_at) {
    activeDigest.phases[phase].started_at = now();
  }

  if (status === 'completed') {
    activeDigest.phases[phase].completed_at = now();
  }

  activeDigest.session.last_activity = now();
  activeDigest.session.phase = phase;

  saveActiveDigest(activeDigest);
  return activeDigest;
}

/**
 * Check if statement is meaningful (contains requirements/substance)
 */
function isMeaningfulStatement(text) {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 5) return { meaningful: false, reason: 'too_short' };

  // Check filler patterns
  for (const pattern of FILLER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { meaningful: false, reason: 'filler' };
    }
  }

  // Check for requirement signals
  for (const pattern of REQUIREMENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { meaningful: true, reason: 'requirement_signal' };
    }
  }

  // Check word count - very short statements without requirement signals are likely filler
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4) {
    return { meaningful: false, reason: 'too_brief' };
  }

  // Default to meaningful if substantial enough
  return { meaningful: true, reason: 'substantial' };
}

/**
 * Split transcript into statements
 */
function splitIntoStatements(text) {
  const statements = [];
  let position = 0;

  // Split by sentence boundaries and speaker changes
  const segments = text.split(/(?<=[.!?])\s+|(?=^[A-Z][a-z]+:|\[\d{2}:\d{2})/gm);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // Extract speaker if present
    const speakerMatch = trimmed.match(/^([A-Z][a-z]+):\s*/);
    const speaker = speakerMatch ? speakerMatch[1] : null;
    const content = speakerMatch ? trimmed.slice(speakerMatch[0].length) : trimmed;

    // Extract timestamp if present
    const timestampMatch = trimmed.match(/^\[?(\d{2}:\d{2}(?::\d{2})?)\]?\s*/);
    const timestamp = timestampMatch ? timestampMatch[1] : null;

    if (content.trim()) {
      statements.push({
        text: content.trim(),
        speaker,
        timestamp,
        position
      });
    }

    position += segment.length;
  }

  return statements;
}

/**
 * Calculate association confidence between statement and topic
 */
function calculateAssociationConfidence(statement, topic) {
  let confidence = 0.5; // Base confidence
  const reasons = [];

  const statementLower = statement.text.toLowerCase();
  const topicTitle = topic.title.toLowerCase();

  // Entity match - highest confidence
  if (topic.entities) {
    for (const entity of topic.entities) {
      if (statementLower.includes(entity.toLowerCase())) {
        confidence = Math.max(confidence, 0.9);
        reasons.push(`entity_match:${entity}`);
      }
    }
  }

  // Title word match
  const titleWords = topicTitle.split(/\s+/).filter(w => w.length > 3);
  for (const word of titleWords) {
    if (statementLower.includes(word)) {
      confidence = Math.max(confidence, 0.8);
      reasons.push(`title_match:${word}`);
    }
  }

  // Keyword match
  if (topic.keywords) {
    for (const keyword of topic.keywords) {
      if (statementLower.includes(keyword.toLowerCase())) {
        confidence = Math.max(confidence, 0.75);
        reasons.push(`keyword_match:${keyword}`);
      }
    }
  }

  return { confidence, reasons };
}

/**
 * Associate statements with topics
 */
function associateStatements(statements, topics) {
  const mappedStatements = [];
  let currentTopicId = null;
  let statementId = 1;

  for (const stmt of statements) {
    const meaningfulCheck = isMeaningfulStatement(stmt.text);

    const mappedStatement = {
      id: `s-${String(statementId).padStart(3, '0')}`,
      text: stmt.text,
      position: stmt.position,
      timestamp: stmt.timestamp,
      speaker: stmt.speaker,
      meaningful: meaningfulCheck.meaningful
    };

    if (!meaningfulCheck.meaningful) {
      mappedStatement.topic_id = null;
      mappedStatement.skip_reason = meaningfulCheck.reason;
    } else {
      // Find best matching topic
      let bestMatch = { topicId: null, confidence: 0, reasons: [] };

      for (const topic of topics) {
        const { confidence, reasons } = calculateAssociationConfidence(stmt, topic);
        if (confidence > bestMatch.confidence) {
          bestMatch = { topicId: topic.id, confidence, reasons };
        }
      }

      // Use context continuity if no strong match
      if (bestMatch.confidence < 0.6 && currentTopicId) {
        bestMatch = {
          topicId: currentTopicId,
          confidence: 0.6,
          reasons: ['context_continuity']
        };
      }

      mappedStatement.topic_id = bestMatch.topicId;
      mappedStatement.confidence = bestMatch.confidence;
      mappedStatement.association_reason = bestMatch.reasons.join(',') || 'context_continuity';
      mappedStatement.clarification_needed = bestMatch.confidence < 0.7;

      if (mappedStatement.clarification_needed) {
        mappedStatement.clarification_question =
          `You mentioned "${stmt.text.slice(0, 50)}..." - which feature does this relate to?`;
      }

      // Update current topic for context continuity
      if (bestMatch.confidence >= 0.7) {
        currentTopicId = bestMatch.topicId;
      }
    }

    mappedStatements.push(mappedStatement);
    statementId++;
  }

  return mappedStatements;
}

/**
 * Detect contradictions between statements
 */
function detectContradictions(statements) {
  const contradictions = [];
  const meaningfulStatements = statements.filter(s => s.meaningful);

  // Contradiction patterns
  const opposites = [
    ['left', 'right'],
    ['top', 'bottom'],
    ['show', 'hide'],
    ['enable', 'disable'],
    ['add', 'remove'],
    ['include', 'exclude'],
    ['before', 'after'],
    ['above', 'below']
  ];

  for (let i = 0; i < meaningfulStatements.length; i++) {
    for (let j = i + 1; j < meaningfulStatements.length; j++) {
      const stmt1 = meaningfulStatements[i];
      const stmt2 = meaningfulStatements[j];

      // Only check statements in same topic
      if (stmt1.topic_id !== stmt2.topic_id) continue;

      const text1 = stmt1.text.toLowerCase();
      const text2 = stmt2.text.toLowerCase();

      // Check for opposite words
      for (const [word1, word2] of opposites) {
        if ((text1.includes(word1) && text2.includes(word2)) ||
            (text1.includes(word2) && text2.includes(word1))) {
          contradictions.push({
            statement1_id: stmt1.id,
            statement2_id: stmt2.id,
            type: 'opposite_values',
            attribute: `${word1}/${word2}`,
            resolution: 'pending'
          });
        }
      }

      // Check for number conflicts (same attribute, different values)
      const numbers1 = text1.match(/\d+/g);
      const numbers2 = text2.match(/\d+/g);
      if (numbers1 && numbers2) {
        // Simple heuristic: if both mention numbers in similar context
        const commonWords = text1.split(/\s+/).filter(w => text2.includes(w) && w.length > 3);
        if (commonWords.length > 2 && numbers1[0] !== numbers2[0]) {
          contradictions.push({
            statement1_id: stmt1.id,
            statement2_id: stmt2.id,
            type: 'quantity_conflict',
            values: [numbers1[0], numbers2[0]],
            resolution: 'pending'
          });
        }
      }
    }
  }

  return contradictions;
}

/**
 * Save statement map to digest
 */
function saveStatementMap(statementMap) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');

  // Calculate metadata
  const meaningful = statementMap.statements.filter(s => s.meaningful);
  const mapped = meaningful.filter(s => s.topic_id !== null);
  const orphans = meaningful.filter(s => s.topic_id === null);

  const data = {
    statements: statementMap.statements,
    contradictions: statementMap.contradictions || [],
    metadata: {
      total_statements: statementMap.statements.length,
      meaningful_statements: meaningful.length,
      mapped_statements: mapped.length,
      orphan_statements: orphans.length,
      contradictions_detected: (statementMap.contradictions || []).length,
      contradictions_resolved: 0,
      coverage_percentage: meaningful.length > 0
        ? Math.round((mapped.length / meaningful.length) * 100 * 10) / 10
        : 0
    }
  };

  fs.writeFileSync(mapPath, JSON.stringify(data, null, 2));

  // Update phase
  updatePhase('statement_mapping', 'completed', {
    statements_mapped: mapped.length,
    orphans_found: orphans.length,
    contradictions_found: (statementMap.contradictions || []).length
  });

  return data;
}

/**
 * Load statement map from digest
 */
function loadStatementMap() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  try {
    return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Process Pass 2: Statement Association
 */
function runPass2() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load transcript
  const transcriptPath = path.join(activeDigest.session.digest_path, 'transcript.md');
  const transcript = fs.readFileSync(transcriptPath, 'utf8');

  // Load topics from Pass 1
  const topicsData = loadTopics();
  if (!topicsData || !topicsData.topics.length) {
    throw new Error('No topics found - run Pass 1 first');
  }

  // Update phase status
  updatePhase('statement_mapping', 'in_progress');

  // Split into statements
  const statements = splitIntoStatements(transcript);

  // Associate with topics
  const mappedStatements = associateStatements(statements, topicsData.topics);

  // Detect contradictions
  const contradictions = detectContradictions(mappedStatements);

  // Mark contradicting statements
  for (const contradiction of contradictions) {
    const stmt1 = mappedStatements.find(s => s.id === contradiction.statement1_id);
    const stmt2 = mappedStatements.find(s => s.id === contradiction.statement2_id);
    if (stmt1) stmt1.contradicts = contradiction.statement2_id;
    if (stmt2) stmt2.contradicts = contradiction.statement1_id;
  }

  // Save statement map
  const result = saveStatementMap({
    statements: mappedStatements,
    contradictions
  });

  return result;
}

// ============================================
// Pass 3: Orphan Check
// ============================================

/**
 * Extract key phrase from statement for topic naming
 */
function extractKeyPhrase(text) {
  // Remove common words
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'should', 'must', 'will', 'can', 'be', 'it', 'we', 'i', 'to', 'for', 'of', 'in', 'on', 'with'];
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));

  // Get first 2-3 meaningful words
  const keyWords = words.slice(0, 3);
  if (keyWords.length === 0) return 'Misc';

  // Capitalize
  return keyWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Enhanced confidence calculation with semantic expansion
 */
function calculateExpandedConfidence(statement, topic) {
  let confidence = 0.5;
  const reasons = [];
  const statementLower = statement.text.toLowerCase();

  // Standard matching first
  const { confidence: baseConf, reasons: baseReasons } = calculateAssociationConfidence(statement, topic);
  if (baseConf > confidence) {
    confidence = baseConf;
    reasons.push(...baseReasons);
  }

  // Semantic expansion - check synonyms
  for (const [term, synonyms] of Object.entries(SEMANTIC_EXPANSIONS)) {
    const allTerms = [term, ...synonyms];
    const topicTitle = topic.title.toLowerCase();
    const topicKeywords = (topic.keywords || []).map(k => k.toLowerCase());

    for (const syn of allTerms) {
      // Statement contains synonym and topic contains related term
      if (statementLower.includes(syn)) {
        for (const related of allTerms) {
          if (topicTitle.includes(related) || topicKeywords.includes(related)) {
            confidence = Math.max(confidence, 0.7);
            reasons.push(`semantic_expansion:${syn}->${related}`);
          }
        }
      }
    }
  }

  return { confidence, reasons };
}

/**
 * Try to resolve a single orphan statement
 */
function resolveOrphan(orphan, topics) {
  const candidates = [];

  // Try enhanced matching against all topics
  for (const topic of topics) {
    const { confidence, reasons } = calculateExpandedConfidence(orphan, topic);
    if (confidence >= 0.5) {
      candidates.push({ topic, confidence, reasons });
    }
  }

  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Resolution decision
  if (candidates.length === 0) {
    return {
      resolved: false,
      method: 'no_match',
      confidence: 0
    };
  }

  const best = candidates[0];

  // Clear winner
  if (best.confidence >= 0.6 && (candidates.length === 1 || best.confidence - candidates[1].confidence > 0.15)) {
    return {
      resolved: true,
      method: 'semantic_expansion',
      topic_id: best.topic.id,
      confidence: best.confidence,
      reasons: best.reasons
    };
  }

  // Ambiguous - multiple close matches
  if (candidates.length > 1 && candidates[0].confidence - candidates[1].confidence < 0.1) {
    return {
      resolved: false,
      method: 'ambiguous',
      possible_topics: candidates.slice(0, 3).map(c => c.topic.id),
      confidence: best.confidence
    };
  }

  // Low confidence winner
  return {
    resolved: best.confidence >= 0.5,
    method: best.confidence >= 0.5 ? 'context_reanalysis' : 'low_confidence',
    topic_id: best.confidence >= 0.5 ? best.topic.id : null,
    confidence: best.confidence,
    reasons: best.reasons
  };
}

/**
 * Create a new topic from orphan statements
 */
function createTopicFromOrphans(orphans, _existingTopics) {
  // Guard against empty orphans array
  if (!orphans || orphans.length === 0) {
    const topicId = generateHashId('t-auto', '', '');
    return {
      id: topicId,
      title: 'Miscellaneous',
      description: 'Auto-generated topic for uncategorized statements',
      source: 'orphan_resolution',
      entities: [],
      keywords: [],
      statements: [],
      needs_review: true,
      confidence: 0.5,
      created_at: now()
    };
  }

  const topicId = generateHashId('t-auto', '', '');

  // Extract common keywords from orphans
  const allWords = orphans.flatMap(o =>
    o.text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );

  // Count word frequencies
  const wordCounts = {};
  for (const word of allWords) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }

  // Get most common words as keywords
  const keywords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  // Generate title from first orphan
  const title = extractKeyPhrase(orphans[0].text);

  return {
    id: topicId,
    title: title,
    description: `Auto-generated from ${orphans.length} orphan statement(s)`,
    source: 'orphan_resolution',
    entities: [],
    keywords,
    statements: orphans.map(o => o.id),
    needs_review: true,
    confidence: 0.7,
    created_at: now()
  };
}

/**
 * Ensure General topic exists
 */
function ensureGeneralTopic(topics) {
  let general = topics.find(t => t.id === 't-general');
  if (!general) {
    general = {
      id: 't-general',
      title: 'General Requirements',
      description: 'Miscellaneous requirements that apply broadly or do not fit specific features',
      source: 'catch_all',
      entities: [],
      keywords: ['general', 'overall', 'misc'],
      statements: [],
      needs_review: true,
      confidence: 1.0
    };
    topics.push(general);
  }
  return general;
}

/**
 * Save orphan resolution results
 */
function saveOrphans(orphansData) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  const orphansPath = path.join(activeDigest.session.digest_path, 'orphans.json');
  fs.writeFileSync(orphansPath, JSON.stringify(orphansData, null, 2));
  return orphansData;
}

/**
 * Load orphan data
 */
function loadOrphans() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const orphansPath = path.join(activeDigest.session.digest_path, 'orphans.json');
  try {
    return JSON.parse(fs.readFileSync(orphansPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Process Pass 3: Orphan Check
 */
function runPass3() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load statement map
  const stmtMap = loadStatementMap();
  if (!stmtMap) {
    throw new Error('No statement map found - run Pass 2 first');
  }

  // Load topics
  const topicsData = loadTopics();
  if (!topicsData) {
    throw new Error('No topics found');
  }

  // Update phase
  updatePhase('orphan_check', 'in_progress');

  // Find orphans
  const orphanStatements = stmtMap.statements.filter(s => s.meaningful && s.topic_id === null);

  if (orphanStatements.length === 0) {
    // No orphans - 100% coverage
    const result = {
      orphans: [],
      resolved: [],
      new_topics_created: [],
      coverage: {
        total_meaningful: stmtMap.metadata.meaningful_statements,
        mapped: stmtMap.metadata.meaningful_statements,
        clarification_needed: 0,
        percentage: 100,
        target: 100
      }
    };

    saveOrphans(result);
    updatePhase('orphan_check', 'completed', { orphans_resolved: 0 });
    return result;
  }

  const resolved = [];
  const stillOrphans = [];
  const newTopics = [];
  let topics = [...topicsData.topics];

  // First pass: try to resolve each orphan
  for (const orphan of orphanStatements) {
    const resolution = resolveOrphan(orphan, topics);

    if (resolution.resolved) {
      // Update statement in map
      orphan.topic_id = resolution.topic_id;
      orphan.confidence = resolution.confidence;
      orphan.association_reason = resolution.reasons?.join(',') || resolution.method;

      resolved.push({
        id: orphan.id,
        original_topic_id: null,
        resolved_topic_id: resolution.topic_id,
        resolution_method: resolution.method,
        confidence: resolution.confidence
      });
    } else {
      stillOrphans.push({
        ...orphan,
        resolution_attempted: true,
        resolution_result: resolution.method,
        possible_topics: resolution.possible_topics || [],
        needs_clarification: true,
        clarification_question: `You mentioned "${orphan.text.slice(0, 50)}..." - which feature does this relate to?`
      });
    }
  }

  // Second pass: cluster remaining orphans that might form new topics
  const unresolved = stillOrphans.filter(o => o.resolution_result === 'no_match');
  if (unresolved.length >= 2) {
    // Simple clustering: group orphans with similar words
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < unresolved.length; i++) {
      if (used.has(i)) continue;

      const cluster = [unresolved[i]];
      used.add(i);

      const words1 = new Set(unresolved[i].text.toLowerCase().split(/\s+/).filter(w => w.length > 3));

      for (let j = i + 1; j < unresolved.length; j++) {
        if (used.has(j)) continue;

        const words2 = new Set(unresolved[j].text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const common = [...words1].filter(w => words2.has(w));

        if (common.length >= 2) {
          cluster.push(unresolved[j]);
          used.add(j);
        }
      }

      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    // Create new topics from clusters
    for (const cluster of clusters) {
      const newTopic = createTopicFromOrphans(cluster, topics);
      topics.push(newTopic);
      newTopics.push({
        id: newTopic.id,
        title: newTopic.title,
        statements_assigned: cluster.map(o => o.id)
      });

      // Update statements
      for (const orphan of cluster) {
        const stmtInMap = stmtMap.statements.find(s => s.id === orphan.id);
        if (stmtInMap) {
          stmtInMap.topic_id = newTopic.id;
          stmtInMap.confidence = 0.7;
          stmtInMap.association_reason = 'topic_clustering';
        }

        resolved.push({
          id: orphan.id,
          original_topic_id: null,
          resolved_topic_id: newTopic.id,
          resolution_method: 'topic_clustering',
          confidence: 0.7
        });

        // Remove from stillOrphans
        const idx = stillOrphans.findIndex(o => o.id === orphan.id);
        if (idx >= 0) stillOrphans.splice(idx, 1);
      }
    }
  }

  // Third pass: assign remaining low-priority orphans to General
  const veryLowConfidence = stillOrphans.filter(o =>
    o.resolution_result === 'no_match' || o.confidence < 0.3
  );

  if (veryLowConfidence.length > 0) {
    const general = ensureGeneralTopic(topics);

    for (const orphan of veryLowConfidence) {
      const stmtInMap = stmtMap.statements.find(s => s.id === orphan.id);
      if (stmtInMap) {
        stmtInMap.topic_id = general.id;
        stmtInMap.confidence = 0.5;
        stmtInMap.association_reason = 'general_assignment';
      }

      resolved.push({
        id: orphan.id,
        original_topic_id: null,
        resolved_topic_id: general.id,
        resolution_method: 'general_assignment',
        confidence: 0.5
      });

      // Remove from stillOrphans
      const idx = stillOrphans.findIndex(o => o.id === orphan.id);
      if (idx >= 0) stillOrphans.splice(idx, 1);
    }
  }

  // Update topics if new ones were created
  if (newTopics.length > 0) {
    saveTopics({ topics });
  }

  // Save updated statement map
  const meaningful = stmtMap.statements.filter(s => s.meaningful);
  const mapped = meaningful.filter(s => s.topic_id !== null);
  stmtMap.metadata.mapped_statements = mapped.length;
  stmtMap.metadata.orphan_statements = stillOrphans.length;
  stmtMap.metadata.coverage_percentage = meaningful.length > 0
    ? Math.round((mapped.length / meaningful.length) * 100 * 10) / 10
    : 0;

  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));

  // Prepare result
  const result = {
    orphans: stillOrphans,
    resolved,
    new_topics_created: newTopics,
    coverage: {
      total_meaningful: meaningful.length,
      mapped: mapped.length,
      clarification_needed: stillOrphans.length,
      percentage: stmtMap.metadata.coverage_percentage,
      target: 100
    }
  };

  saveOrphans(result);
  updatePhase('orphan_check', 'completed', {
    orphans_resolved: resolved.length,
    new_topics: newTopics.length,
    remaining_orphans: stillOrphans.length
  });

  return result;
}

// ============================================
// Pass 4: Contradiction Resolution
// ============================================

/**
 * Check if statement contains a correction phrase
 */
function detectCorrectionPhrase(text) {
  for (const { pattern, name, weight } of CORRECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { detected: true, phrase: name, weight };
    }
  }
  return { detected: false, phrase: null, weight: 0 };
}

/**
 * Check if statement is additive (not a real contradiction)
 */
function isAdditive(text) {
  return ADDITIVE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Calculate resolution confidence for a contradiction
 */
function calculateResolutionConfidence(stmt1, stmt2, contradiction) {
  let confidence = 0.5;
  let reasons = [];

  // Check for correction phrase in stmt2 (later statement)
  const correction = detectCorrectionPhrase(stmt2.text);
  if (correction.detected) {
    confidence += correction.weight;
    reasons.push(`correction_phrase:${correction.phrase}`);
  }

  // Same speaker increases confidence
  if (stmt1.speaker && stmt2.speaker && stmt1.speaker === stmt2.speaker) {
    confidence += 0.15;
    reasons.push('same_speaker');
  }

  // Position difference - later statements typically override
  const positionDiff = stmt2.position - stmt1.position;
  if (positionDiff > 500) {  // Significant distance
    confidence += 0.1;
    reasons.push('later_position');
  }

  // Check if stmt2 explicitly references the attribute
  const attr = contradiction.attribute;
  if (attr) {
    const [word1, word2] = attr.split('/');
    if (stmt2.text.toLowerCase().includes(word1) || stmt2.text.toLowerCase().includes(word2)) {
      confidence += 0.1;
      reasons.push('explicit_attribute_reference');
    }
  }

  // Check for additive pattern - might not be a real contradiction
  if (isAdditive(stmt2.text)) {
    confidence = 0.3;  // Low confidence - likely not a contradiction
    reasons = ['additive_pattern'];
  }

  return {
    confidence: Math.min(confidence, 1.0),
    reasons,
    winner: confidence >= 0.5 ? stmt2.id : null,
    isAdditive: isAdditive(stmt2.text)
  };
}

/**
 * Generate clarification question for unresolved contradiction
 */
function generateContradictionQuestion(stmt1, stmt2, contradiction) {
  const attr = contradiction.attribute || 'value';
  const [val1, val2] = attr.split('/');

  // Extract the actual values from statements if possible
  const extractValue = (text, hints) => {
    for (const hint of hints || []) {
      if (text.toLowerCase().includes(hint.toLowerCase())) {
        return hint;
      }
    }
    return text.slice(0, 50);
  };

  const value1 = val1 || extractValue(stmt1.text, []);
  const value2 = val2 || extractValue(stmt2.text, []);

  return {
    question: `You mentioned "${stmt1.text.slice(0, 60)}" but later said "${stmt2.text.slice(0, 60)}". Which do you prefer?`,
    options: [
      { id: 'opt-1', text: value1, statement_id: stmt1.id },
      { id: 'opt-2', text: value2, statement_id: stmt2.id },
      { id: 'opt-3', text: 'Both are needed', resolution: 'keep_both' }
    ],
    attribute: attr
  };
}

/**
 * Save clarifications to file
 */
function saveClarifications(clarifications) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  const clarPath = path.join(activeDigest.session.digest_path, 'clarifications.json');
  fs.writeFileSync(clarPath, JSON.stringify(clarifications, null, 2));
  return clarifications;
}

/**
 * Load clarifications from file
 */
function loadClarifications() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const clarPath = path.join(activeDigest.session.digest_path, 'clarifications.json');
  try {
    return JSON.parse(fs.readFileSync(clarPath, 'utf8'));
  } catch (_err) {
    return {
      questions: [],
      contradictions: [],
      metadata: {
        total_questions: 0,
        answered_questions: 0,
        pending_questions: 0,
        total_contradictions: 0,
        resolved_contradictions: 0,
        auto_resolved_count: 0,
        user_resolved_count: 0
      }
    };
  }
}

/**
 * Process Pass 4: Contradiction Resolution
 */
function runPass4() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load statement map
  const stmtMap = loadStatementMap();
  if (!stmtMap) {
    throw new Error('No statement map found - run Pass 2 first');
  }

  const contradictions = stmtMap.contradictions || [];
  if (contradictions.length === 0) {
    const result = {
      resolved: [],
      pending: [],
      additive: [],
      stats: {
        total: 0,
        auto_resolved: 0,
        needs_clarification: 0,
        additive_not_contradiction: 0
      }
    };
    updatePhase('contradiction_resolution', 'completed', result.stats);
    return result;
  }

  // Update phase
  updatePhase('contradiction_resolution', 'in_progress');

  const resolved = [];
  const pending = [];
  const additive = [];

  // Load or create clarifications
  let clarifications = loadClarifications();

  // Process each contradiction
  for (const contradiction of contradictions) {
    const stmt1 = stmtMap.statements.find(s => s.id === contradiction.statement1_id);
    const stmt2 = stmtMap.statements.find(s => s.id === contradiction.statement2_id);

    if (!stmt1 || !stmt2) continue;

    const resolution = calculateResolutionConfidence(stmt1, stmt2, contradiction);

    if (resolution.isAdditive) {
      // Not actually a contradiction
      contradiction.resolution = 'not_contradiction';
      contradiction.reason = 'additive_pattern';
      additive.push({
        statement1_id: contradiction.statement1_id,
        statement2_id: contradiction.statement2_id,
        reason: 'Both statements are valid (additive)'
      });

      // Remove from contradictions
      continue;
    }

    if (resolution.confidence >= 0.8) {
      // Auto-resolve
      contradiction.resolution = 'auto_resolved';
      contradiction.winner = resolution.winner;
      contradiction.reason = resolution.reasons.join(',');
      contradiction.confidence = resolution.confidence;
      contradiction.resolved_at = now();

      // Mark loser as superseded
      const loser = resolution.winner === stmt2.id ? stmt1 : stmt2;
      const winner = resolution.winner === stmt2.id ? stmt2 : stmt1;

      loser.superseded = true;
      loser.superseded_by = winner.id;
      loser.superseded_reason = resolution.reasons[0] || 'auto_resolved';

      winner.supersedes = loser.id;
      winner.is_correction = true;

      resolved.push({
        statement1_id: contradiction.statement1_id,
        statement2_id: contradiction.statement2_id,
        winner: resolution.winner,
        confidence: resolution.confidence,
        reason: resolution.reasons.join(',')
      });
    } else {
      // Needs clarification
      contradiction.resolution = 'clarification_needed';
      contradiction.confidence = resolution.confidence;

      const question = generateContradictionQuestion(stmt1, stmt2, contradiction);

      // Add to clarifications
      const clarId = `c-${String(clarifications.contradictions.length + 1).padStart(3, '0')}`;
      clarifications.contradictions.push({
        id: clarId,
        type: contradiction.type,
        attribute: contradiction.attribute,
        statements: [contradiction.statement1_id, contradiction.statement2_id],
        topic_id: stmt1.topic_id || stmt2.topic_id,
        question: question.question,
        options: question.options,
        status: 'pending',
        created_at: now()
      });

      contradiction.clarification_id = clarId;

      pending.push({
        statement1_id: contradiction.statement1_id,
        statement2_id: contradiction.statement2_id,
        clarification_id: clarId,
        confidence: resolution.confidence
      });
    }
  }

  // Filter out additive patterns from contradictions list
  stmtMap.contradictions = contradictions.filter(c => c.resolution !== 'not_contradiction');

  // Update clarifications metadata
  clarifications.metadata.total_contradictions = contradictions.length;
  clarifications.metadata.auto_resolved_count = resolved.length;
  clarifications.metadata.pending_questions = pending.length;

  // Save updated files
  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));

  saveClarifications(clarifications);

  const stats = {
    total: contradictions.length,
    auto_resolved: resolved.length,
    needs_clarification: pending.length,
    additive_not_contradiction: additive.length
  };

  updatePhase('contradiction_resolution', 'completed', stats);

  return {
    resolved,
    pending,
    additive,
    stats
  };
}

// ============================================
// Question Generation (E2-S1)
// ============================================

// ==========================================================================
// E5-S2: Multi-language Question Templates
// ==========================================================================

/**
 * Get question templates for a specific language (E5-S2)
 */
function getQuestionTemplates(languageCode) {
  // Check if we have templates for this language
  if (QUESTION_TEMPLATES_BY_LANGUAGE[languageCode]) {
    return QUESTION_TEMPLATES_BY_LANGUAGE[languageCode];
  }
  // Fall back to English
  return QUESTION_TEMPLATES_BY_LANGUAGE.en;
}

/**
 * Generate a localized question (E5-S2)
 */
function generateLocalizedQuestion(templateKey, detailKey, entity, language = 'en') {
  // Check if language is directly supported
  const isLanguageSupported = QUESTION_TEMPLATES_BY_LANGUAGE.hasOwnProperty(language);
  const effectiveLang = isLanguageSupported ? language : 'en';

  const templates = getQuestionTemplates(language);
  const template = templates[templateKey]?.[detailKey];

  if (!template) {
    // Fall back to English if template not found
    const enTemplate = QUESTION_TEMPLATES[templateKey]?.[detailKey];
    if (enTemplate) {
      return {
        question: enTemplate.question.replace('{entity}', entity),
        examples: enTemplate.examples || null,
        priority: enTemplate.priority || 'P2',
        language: 'en',
        fallback: true
      };
    }
    return null;
  }

  return {
    question: template.question.replace('{entity}', entity),
    examples: template.examples || null,
    priority: template.priority || 'P2',
    language: effectiveLang,
    fallback: !isLanguageSupported
  };
}

/**
 * Detect and store session language (E5-S2)
 */
function detectSessionLanguage() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load the original transcript
  const digestDir = activeDigest.session.digest_path;
  const transcriptPath = path.join(digestDir, 'transcript.txt');

  if (!fs.existsSync(transcriptPath)) {
    return {
      detected: false,
      reason: 'No transcript file found'
    };
  }

  const transcript = fs.readFileSync(transcriptPath, 'utf8');

  // Detect primary language
  const langResult = detectLanguage(transcript);

  // Detect if multi-language
  const multiResult = detectMultipleLanguages(transcript, { segmentSize: 500 });

  // Update session with language info
  activeDigest.session.detected_language = langResult.language;
  activeDigest.session.language_confidence = langResult.confidence;
  activeDigest.session.is_multilingual = multiResult.isMultilingual;
  activeDigest.session.language_distribution = multiResult.distribution || {};

  saveActiveDigest(activeDigest);

  return {
    detected: true,
    language: langResult.language,
    languageName: LANGUAGE_INFO[langResult.language]?.name || 'Unknown',
    confidence: langResult.confidence,
    isMultilingual: multiResult.isMultilingual,
    distribution: multiResult.distribution
  };
}

/**
 * Get language for a topic (E5-S2)
 */
function getTopicLanguage(topicId) {
  const topics = loadTopics();
  const stmtMap = loadStatementMap();
  const activeDigest = loadActiveDigest();

  if (!topics || !stmtMap) {
    return activeDigest.session?.detected_language || 'en';
  }

  // Find the topic
  const topic = topics.topics.find(t => t.id === topicId);
  if (!topic) {
    return activeDigest.session?.detected_language || 'en';
  }

  // If topic has a stored language, use it
  if (topic.language) {
    return topic.language;
  }

  // Detect language from topic's statements
  const topicStatements = stmtMap.statements.filter(s => s.topic_id === topicId && s.meaningful);
  if (topicStatements.length === 0) {
    return activeDigest.session?.detected_language || 'en';
  }

  // Combine statement text and detect
  const combinedText = topicStatements.map(s => s.text).join('\n');
  const result = detectLanguage(combinedText);

  return result.language;
}

/**
 * Set user language preference (E5-S2)
 */
function setLanguagePreference(languageCode) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Validate language code
  const info = getLanguageInfo(languageCode);
  if (!info.supported) {
    throw new Error(`Unsupported language code: ${languageCode}`);
  }

  activeDigest.session.preferred_language = languageCode;
  saveActiveDigest(activeDigest);

  return {
    set: true,
    language: languageCode,
    languageName: info.name
  };
}

/**
 * Get effective language for question generation (E5-S2)
 */
function getEffectiveLanguage(topicId = null) {
  const activeDigest = loadActiveDigest();

  // Priority 1: User preference
  if (activeDigest.session?.preferred_language) {
    return activeDigest.session.preferred_language;
  }

  // Priority 2: Topic-specific language
  if (topicId) {
    const topicLang = getTopicLanguage(topicId);
    if (topicLang && QUESTION_TEMPLATES_BY_LANGUAGE[topicLang]) {
      return topicLang;
    }
  }

  // Priority 3: Session detected language
  if (activeDigest.session?.detected_language &&
      QUESTION_TEMPLATES_BY_LANGUAGE[activeDigest.session.detected_language]) {
    return activeDigest.session.detected_language;
  }

  // Default: English
  return 'en';
}

/**
 * Get session language info (E5-S2)
 */
function getSessionLanguageInfo() {
  const activeDigest = loadActiveDigest();

  return {
    detected: activeDigest.session?.detected_language || null,
    detectedName: LANGUAGE_INFO[activeDigest.session?.detected_language]?.name || null,
    confidence: activeDigest.session?.language_confidence || null,
    preferred: activeDigest.session?.preferred_language || null,
    preferredName: LANGUAGE_INFO[activeDigest.session?.preferred_language]?.name || null,
    isMultilingual: activeDigest.session?.is_multilingual || false,
    distribution: activeDigest.session?.language_distribution || {},
    effective: getEffectiveLanguage()
  };
}

// ==========================================================================
// E3-S1: Complexity Detection Patterns
// ==========================================================================

/**
 * Check if a detail is already mentioned in topic statements
 */
function isDetailProvided(detail, topicId, statements) {
  const topicStatements = statements.filter(s => s.topic_id === topicId && s.meaningful);
  const pattern = DETAIL_PATTERNS[detail];
  if (!pattern) return false;
  return topicStatements.some(s => pattern.test(s.text));
}

/**
 * Extract entity name from statement
 */
function extractEntityFromStatement(statement, pattern) {
  const match = statement.text.match(pattern.pattern);
  if (match && pattern.entity !== null) {
    return match[pattern.entity];
  }
  return pattern.type;
}

/**
 * Analyze statement for completeness gaps
 */
function analyzeCompleteness(statement, topicId, allStatements) {
  const gaps = [];
  const text = statement.text.toLowerCase();

  for (const entityPattern of ENTITY_PATTERNS) {
    if (entityPattern.pattern.test(text)) {
      const entity = extractEntityFromStatement(statement, entityPattern);

      for (const detail of entityPattern.missing) {
        if (!isDetailProvided(detail, topicId, allStatements)) {
          gaps.push({
            type: entityPattern.type,
            entity,
            detail,
            statementId: statement.id
          });
        }
      }
    }
  }

  return gaps;
}

/**
 * Check if statement is vague
 */
function detectVagueness(statement) {
  for (const vague of VAGUE_PATTERNS) {
    if (vague.pattern.test(statement.text)) {
      return {
        isVague: true,
        key: vague.key,
        question: vague.question
      };
    }
  }
  return { isVague: false };
}

/**
 * Generate question ID
 */
let questionCounter = 0;
function generateQuestionId() {
  questionCounter++;
  return `q-${String(questionCounter).padStart(3, '0')}`;
}

/**
 * Generate questions for a topic
 */
function generateQuestionsForTopic(topic, statements, allStatements) {
  const questions = [];
  const topicStatements = statements.filter(s => s.topic_id === topic.id && s.meaningful && !s.superseded);

  for (const statement of topicStatements) {
    // Check completeness
    const gaps = analyzeCompleteness(statement, topic.id, allStatements);
    for (const gap of gaps) {
      const template = QUESTION_TEMPLATES[gap.type]?.[gap.detail];
      if (template) {
        questions.push({
          id: generateQuestionId(),
          type: 'completeness',
          topic_id: topic.id,
          topic_title: topic.title,
          statement_id: statement.id,
          question: template.question.replace('{entity}', gap.entity),
          detail: gap.detail,
          examples: template.examples || null,
          priority: template.priority || 'P2',
          status: 'pending',
          answer: null,
          created_at: now()
        });
      }
    }

    // Check vagueness
    const vagueness = detectVagueness(statement);
    if (vagueness.isVague) {
      questions.push({
        id: generateQuestionId(),
        type: 'specificity',
        topic_id: topic.id,
        topic_title: topic.title,
        statement_id: statement.id,
        question: vagueness.question,
        original_statement: statement.text,
        priority: 'P2',
        status: 'pending',
        answer: null,
        created_at: now()
      });
    }
  }

  return questions;
}

/**
 * Run question generation
 */
function generateAllQuestions() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load data
  const topics = loadTopics();
  const stmtMap = loadStatementMap();
  let clarifications = loadClarifications();

  if (!topics || !stmtMap) {
    throw new Error('Topics and statement map required - run passes 1-2 first');
  }

  // Initialize clarifications if null (no file exists yet)
  if (!clarifications) {
    clarifications = {
      questions: [],
      contradictions: [],
      by_topic: {},
      metadata: {
        total_questions: 0,
        pending_questions: 0,
        answered_questions: 0
      }
    };
  }

  // Reset question counter based on existing questions
  questionCounter = clarifications.questions?.length || 0;

  // Generate questions for each topic
  const allQuestions = [];
  const byTopic = {};

  for (const topic of topics.topics) {
    const topicQuestions = generateQuestionsForTopic(topic, stmtMap.statements, stmtMap.statements);

    if (topicQuestions.length > 0) {
      allQuestions.push(...topicQuestions);
      byTopic[topic.id] = topicQuestions.map(q => q.id);
    }
  }

  // Merge with existing clarifications
  clarifications.questions = [
    ...(clarifications.questions || []),
    ...allQuestions
  ];
  clarifications.by_topic = {
    ...(clarifications.by_topic || {}),
    ...byTopic
  };

  // Update metadata
  const byType = { completeness: 0, specificity: 0, ambiguity: 0 };
  const byPriority = { P1: 0, P2: 0, P3: 0 };

  for (const q of clarifications.questions) {
    byType[q.type] = (byType[q.type] || 0) + 1;
    byPriority[q.priority] = (byPriority[q.priority] || 0) + 1;
  }

  clarifications.metadata = {
    ...clarifications.metadata,
    total_questions: clarifications.questions.length,
    pending_questions: clarifications.questions.filter(q => q.status === 'pending').length,
    answered_questions: clarifications.questions.filter(q => q.status === 'answered').length,
    by_type: byType,
    by_priority: byPriority
  };

  // Save
  saveClarifications(clarifications);

  // Update phase
  updatePhase('clarification', 'in_progress', {
    questions_total: allQuestions.length,
    questions_answered: 0
  });

  return {
    questions: allQuestions,
    by_topic: byTopic,
    stats: {
      total: allQuestions.length,
      by_type: byType,
      by_priority: byPriority,
      topics_with_questions: Object.keys(byTopic).length
    }
  };
}

// ============================================
// E2-S2: Clarification Conversation Loop
// ============================================

/**
 * Keywords to extract from questions for matching
 */
function extractKeywordsFromQuestion(question) {
  const stopWords = ['what', 'which', 'how', 'should', 'the', 'a', 'an', 'for', 'to', 'of', 'in', 'be', 'are', 'is'];
  const words = question.text || question.question;
  return words.toLowerCase()
    .replace(/[?.,!]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));
}

/**
 * Parse user response and match answers to questions
 */
function parseAnswers(userResponse, questions) {
  const answers = [];
  const text = userResponse.trim();

  // Try numbered responses first (1. answer, 2. answer)
  const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s*(.+?)(?=\n\s*\d+[.)]|\n*$)/gs;
  const numberedMatches = [...text.matchAll(numberedPattern)];

  if (numberedMatches.length > 0) {
    for (const match of numberedMatches) {
      const num = parseInt(match[1], 10);
      const answer = match[2].trim();
      if (num >= 1 && num <= questions.length) {
        answers.push({
          question_id: questions[num - 1].id,
          answer,
          confidence: 0.95,
          match_method: 'numbered'
        });
      }
    }
    return answers;
  }

  // Try explicit keyword matches (for X, the Y should, etc.)
  for (const question of questions) {
    const keywords = extractKeywordsFromQuestion(question);

    for (const keyword of keywords) {
      // Escape special regex characters in keyword
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Pattern: "for [keyword], [answer]" or "[keyword]: [answer]"
      const patterns = [
        new RegExp(`(?:for\\s+(?:the\\s+)?)?${escapedKeyword}[,:]\\s*(.+?)(?:\\.|$|\\n)`, 'i'),
        new RegExp(`${escapedKeyword}\\s+(?:should\\s+(?:be|have|show)\\s+)?(.+?)(?:\\.|$|\\n)`, 'i')
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].trim().length > 2) {
          // Check if we already have an answer for this question
          const existing = answers.find(a => a.question_id === question.id);
          if (!existing) {
            answers.push({
              question_id: question.id,
              answer: match[1].trim(),
              confidence: 0.85,
              match_method: 'keyword',
              matched_keyword: keyword
            });
          }
          break;
        }
      }
    }
  }

  // If only one question and no matches yet, assume entire response is the answer
  if (questions.length === 1 && answers.length === 0 && text.length > 2) {
    answers.push({
      question_id: questions[0].id,
      answer: text,
      confidence: 0.8,
      match_method: 'single_question'
    });
  }

  // For sequential responses separated by periods or commas
  if (answers.length === 0 && questions.length > 1) {
    const segments = text.split(/[.]\s+/).filter(s => s.trim().length > 2);
    if (segments.length === questions.length) {
      for (let i = 0; i < segments.length; i++) {
        answers.push({
          question_id: questions[i].id,
          answer: segments[i].trim(),
          confidence: 0.7,
          match_method: 'sequential'
        });
      }
    }
  }

  return answers;
}

/**
 * Capture answer for a specific question
 */
function captureAnswer(questionId, answer, source = 'text') {
  const clarifications = loadClarifications();
  if (!clarifications) {
    throw new Error('No clarifications found');
  }

  const question = clarifications.questions.find(q => q.id === questionId);
  if (!question) {
    throw new Error(`Question ${questionId} not found`);
  }

  // Update question status
  question.status = 'answered';
  question.answer = answer;
  question.answered_at = now();
  question.answer_source = source;

  // Update metadata
  clarifications.metadata.answered_questions = (clarifications.metadata.answered_questions || 0) + 1;
  clarifications.metadata.pending_questions = clarifications.questions.filter(q => q.status === 'pending').length;

  saveClarifications(clarifications);

  return question;
}

/**
 * Create a derived statement from clarification answer
 */
function createDerivedStatement(question, answer) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load statement map
  const stmtMap = loadStatementMap();
  if (!stmtMap) {
    throw new Error('No statement map found');
  }

  // Generate ID
  const maxId = stmtMap.statements
    .map(s => parseInt(s.id.replace('s-', '').replace('derived-', ''), 10) || 0)
    .reduce((max, id) => Math.max(max, id), 0);

  const newId = `s-derived-${String(maxId + 1).padStart(3, '0')}`;

  // Create statement text from question and answer
  let text;
  if (question.detail) {
    // Completeness question - create specific statement
    const entity = question.question.match(/the (\w+) (table|form|button|list|modal)/i)?.[1] || '';
    text = `The ${entity} ${question.detail} should be: ${answer}`;
  } else {
    // Specificity question - incorporate answer
    text = answer;
  }

  const derivedStatement = {
    id: newId,
    text,
    topic_id: question.topic_id,
    source: 'clarification',
    clarification_id: question.id,
    meaningful: true,
    confidence: 1.0,
    created_at: now()
  };

  // Add to statement map
  stmtMap.statements.push(derivedStatement);
  stmtMap.metadata.total_statements++;
  stmtMap.metadata.meaningful_statements++;
  stmtMap.metadata.mapped_statements++;

  // Save
  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));

  return derivedStatement;
}

/**
 * Check if an answer should generate follow-up questions
 */
function checkFollowups(answer, question) {
  const followups = [];

  for (const trigger of FOLLOWUP_TRIGGERS) {
    if (trigger.pattern.test(answer)) {
      // Don't generate follow-up if the answer already addresses it
      const entity = question.detail || 'item';

      followups.push({
        type: trigger.type,
        triggered_by: trigger.pattern.source,
        question: trigger.question.replace('{item}', entity),
        parent_question_id: question.id,
        topic_id: question.topic_id,
        priority: 'P2'
      });
    }
  }

  return followups;
}

/**
 * Add follow-up questions to clarifications
 */
function addFollowupQuestions(followups) {
  if (followups.length === 0) return [];

  const clarifications = loadClarifications();
  const addedQuestions = [];

  for (const followup of followups) {
    // Check if similar question already exists
    const exists = clarifications.questions.some(q =>
      q.topic_id === followup.topic_id &&
      q.question.toLowerCase().includes(followup.question.toLowerCase().slice(0, 30))
    );

    if (!exists) {
      const newQuestion = {
        id: generateQuestionId(),
        type: 'followup',
        topic_id: followup.topic_id,
        parent_question_id: followup.parent_question_id,
        question: followup.question,
        priority: followup.priority,
        status: 'pending',
        answer: null,
        created_at: now()
      };

      clarifications.questions.push(newQuestion);
      addedQuestions.push(newQuestion);
    }
  }

  // Update metadata
  clarifications.metadata.total_questions = clarifications.questions.length;
  clarifications.metadata.pending_questions = clarifications.questions.filter(q => q.status === 'pending').length;

  saveClarifications(clarifications);
  return addedQuestions;
}

/**
 * Check if all clarifications are complete
 */
function checkCompletion() {
  const clarifications = loadClarifications();
  if (!clarifications) {
    return { complete: false, error: 'No clarifications found' };
  }

  const pendingQuestions = clarifications.questions.filter(q => q.status === 'pending');
  const pendingContradictions = clarifications.contradictions.filter(c => c.status === 'pending');

  const complete = pendingQuestions.length === 0 && pendingContradictions.length === 0;

  const result = {
    complete,
    pending_questions: pendingQuestions.length,
    pending_contradictions: pendingContradictions.length,
    answered_questions: clarifications.questions.filter(q => q.status === 'answered').length,
    resolved_contradictions: clarifications.contradictions.filter(c => c.status === 'resolved').length,
    total_questions: clarifications.questions.length,
    total_contradictions: clarifications.contradictions.length
  };

  // If complete, update phase
  if (complete) {
    updatePhase('clarification', 'completed', {
      questions_total: result.total_questions,
      questions_answered: result.answered_questions
    });
  }

  return result;
}

/**
 * Get questions for presentation (grouped by topic, prioritized)
 */
function getQuestionsForPresentation(topicId = null, limit = 5) {
  const clarifications = loadClarifications();
  if (!clarifications) return [];

  let pendingQuestions = clarifications.questions.filter(q => q.status === 'pending');

  // Filter by topic if specified
  if (topicId) {
    pendingQuestions = pendingQuestions.filter(q => q.topic_id === topicId);
  }

  // Sort by priority (P1 first) then by creation time
  const priorityOrder = { P1: 0, P2: 1, P3: 2 };
  pendingQuestions.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    if (pDiff !== 0) return pDiff;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  // Limit
  return pendingQuestions.slice(0, limit);
}

/**
 * Format questions for display to user
 */
function formatQuestionsForUser(questions) {
  if (questions.length === 0) return null;

  // Group by topic
  const byTopic = {};
  for (const q of questions) {
    const topicKey = q.topic_title || q.topic_id || 'General';
    if (!byTopic[topicKey]) {
      byTopic[topicKey] = [];
    }
    byTopic[topicKey].push(q);
  }

  let output = '';
  for (const [topic, qs] of Object.entries(byTopic)) {
    output += `## Topic: ${topic} (${qs.length} question${qs.length > 1 ? 's' : ''})\n\n`;

    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      output += `${i + 1}. **[${q.priority}]** ${q.question}\n`;
      if (q.examples && q.examples.length > 0) {
        output += `   _Examples: "${q.examples.join('" or "')}"_\n`;
      }
      output += '\n';
    }
  }

  output += '---\n\nYou can answer all at once or one at a time. Just reply naturally!';

  return output;
}

/**
 * Process user answers in conversation
 * @param {string} userResponse - User's answer text
 * @param {object} options - Processing options
 * @param {boolean} options.forceVoice - Force voice processing
 */
function processConversationResponse(userResponse, options = {}) {
  const clarifications = loadClarifications();
  if (!clarifications) {
    return { error: 'No active clarification session' };
  }

  // Get currently pending questions (prioritized)
  const pendingQuestions = getQuestionsForPresentation(null, 10);
  if (pendingQuestions.length === 0) {
    return {
      complete: true,
      message: 'All questions have been answered!'
    };
  }

  // Process voice input if detected or forced
  let processedInput = userResponse;
  let voiceProcessing = null;

  const voiceResult = processVoiceAnswer(userResponse, options.forceVoice);
  if (voiceResult.isVoice) {
    processedInput = voiceResult.normalized;
    voiceProcessing = voiceResult.processing;
  }

  // Parse the user's response (using normalized text if voice)
  const parsedAnswers = parseAnswers(processedInput, pendingQuestions);

  const results = {
    captured: [],
    derived_statements: [],
    followups_added: [],
    remaining_questions: 0,
    complete: false,
    voice: voiceProcessing ? {
      detected: true,
      original: userResponse,
      normalized: processedInput,
      processing: voiceProcessing
    } : null
  };

  // Determine source (voice or text)
  const answerSource = voiceProcessing ? 'voice' : 'conversation';

  // Record the answer received interaction
  recordInteraction('answer_received', {
    raw_input: userResponse,
    source: answerSource,
    voice_processed: !!voiceProcessing,
    parsed_count: parsedAnswers.length
  });

  // Process each parsed answer
  for (const parsed of parsedAnswers) {
    const question = pendingQuestions.find(q => q.id === parsed.question_id);
    if (!question) continue;

    // Capture the answer
    captureAnswer(parsed.question_id, parsed.answer, answerSource);
    results.captured.push({
      question_id: parsed.question_id,
      question: question.question,
      answer: parsed.answer,
      confidence: parsed.confidence
    });

    // Create derived statement
    const derivedStmt = createDerivedStatement(question, parsed.answer);
    results.derived_statements.push(derivedStmt);

    // Check for follow-ups
    const followups = checkFollowups(parsed.answer, question);
    if (followups.length > 0) {
      const added = addFollowupQuestions(followups);
      results.followups_added.push(...added);
    }
  }

  // Check completion
  const completion = checkCompletion();
  results.complete = completion.complete;
  results.remaining_questions = completion.pending_questions + completion.pending_contradictions;

  // Get next questions if not complete
  if (!completion.complete) {
    results.next_questions = getQuestionsForPresentation(null, 5);
    results.formatted_questions = formatQuestionsForUser(results.next_questions);
  }

  return results;
}

/**
 * Resolve a contradiction with user's choice
 */
function resolveContradictionWithChoice(contradictionId, choice) {
  const clarifications = loadClarifications();
  if (!clarifications) {
    throw new Error('No clarifications found');
  }

  const contradiction = clarifications.contradictions.find(c => c.id === contradictionId);
  if (!contradiction) {
    throw new Error(`Contradiction ${contradictionId} not found`);
  }

  // Load statement map to update
  const stmtMap = loadStatementMap();
  if (!stmtMap) {
    throw new Error('No statement map found');
  }

  if (choice === 'keep_both') {
    // Both are valid - not a real contradiction
    contradiction.status = 'resolved';
    contradiction.resolution = 'keep_both';
    contradiction.resolved_at = now();
  } else {
    // One wins, other is superseded
    const winnerStmtId = contradiction.options?.find(o => o.id === choice)?.statement_id;
    const loserStmtId = contradiction.statements.find(id => id !== winnerStmtId);

    if (winnerStmtId && loserStmtId) {
      const winner = stmtMap.statements.find(s => s.id === winnerStmtId);
      const loser = stmtMap.statements.find(s => s.id === loserStmtId);

      if (winner && loser) {
        loser.superseded = true;
        loser.superseded_by = winnerStmtId;
        loser.superseded_reason = 'user_choice';
        winner.supersedes = loserStmtId;
      }
    }

    contradiction.status = 'resolved';
    contradiction.resolution = 'user_choice';
    contradiction.winner = winnerStmtId;
    contradiction.resolved_at = now();
  }

  // Update metadata
  clarifications.metadata.resolved_contradictions = (clarifications.metadata.resolved_contradictions || 0) + 1;
  clarifications.metadata.user_resolved_count = (clarifications.metadata.user_resolved_count || 0) + 1;

  // Save both
  const activeDigest = loadActiveDigest();
  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));
  saveClarifications(clarifications);

  return contradiction;
}

// E2-S3 (Voice Answer Integration) extracted to flow-long-input-voice.js

// ============================================
// E2-S4: Clarification State Persistence
// ============================================

/**
 * Generate unique interaction ID
 */
function generateInteractionId() {
  return `i-${Date.now().toString(36)}`;
}

/**
 * Generate unique checkpoint ID
 */
function generateCheckpointId() {
  return `cp-${Date.now().toString(36)}`;
}

/**
 * Load conversation history
 */
function loadConversation() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    return null;
  }

  const convPath = path.join(activeDigest.session.digest_path, 'conversation.json');
  if (!fs.existsSync(convPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(convPath, 'utf8'));
}

/**
 * Save conversation history
 */
function saveConversation(conversation) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    throw new Error('No active digest session');
  }

  const convPath = path.join(activeDigest.session.digest_path, 'conversation.json');
  fs.writeFileSync(convPath, JSON.stringify(conversation, null, 2));
  return conversation;
}

/**
 * Initialize conversation history for new session
 */
function initializeConversation(sessionId) {
  const conversation = {
    session_id: sessionId,
    started_at: now(),
    last_interaction: now(),
    interactions: [],
    checkpoints: []
  };

  return saveConversation(conversation);
}

/**
 * Record an interaction in conversation history
 */
function recordInteraction(type, data = {}) {
  let conversation = loadConversation();

  if (!conversation) {
    const activeDigest = loadActiveDigest();
    if (activeDigest.session?.id) {
      conversation = initializeConversation(activeDigest.session.id);
    } else {
      return null;
    }
  }

  const interaction = {
    id: generateInteractionId(),
    type,
    timestamp: now(),
    data
  };

  conversation.interactions.push(interaction);
  conversation.last_interaction = now();

  saveConversation(conversation);
  return interaction;
}

/**
 * Create a checkpoint for recovery
 */
function createCheckpoint(reason = 'manual') {
  const conversation = loadConversation();
  if (!conversation) {
    return null;
  }

  const clarifications = loadClarifications();
  const topics = loadTopics();
  const activeDigest = loadActiveDigest();

  const checkpoint = {
    id: generateCheckpointId(),
    timestamp: now(),
    reason,
    phase: activeDigest.phases ? Object.keys(activeDigest.phases).find(p =>
      activeDigest.phases[p]?.status === 'in_progress'
    ) || 'unknown' : 'unknown',
    questions: {
      total: clarifications?.questions?.length || 0,
      answered: clarifications?.questions?.filter(q => q.status === 'answered').length || 0,
      pending: clarifications?.questions?.filter(q => q.status === 'pending').length || 0
    },
    contradictions: {
      total: clarifications?.contradictions?.length || 0,
      resolved: clarifications?.contradictions?.filter(c => c.status === 'resolved').length || 0
    },
    topics: {
      total: topics?.topics?.length || 0,
      clarified: topics?.topics?.filter(t => t.clarification_complete).length || 0
    },
    awaiting_response: false
  };

  // Check if we're awaiting response (last interaction was questions_presented)
  const lastInteraction = conversation.interactions.slice(-1)[0];
  if (lastInteraction?.type === 'questions_presented') {
    checkpoint.awaiting_response = true;
    checkpoint.last_questions_presented = lastInteraction.data.question_ids;
  }

  conversation.checkpoints.push(checkpoint);
  saveConversation(conversation);

  return checkpoint;
}

/**
 * Detect if there's an interrupted session
 */
function detectInterruptedSession() {
  const activeDigest = loadActiveDigest();

  if (!activeDigest.session?.digest_path) {
    return { interrupted: false };
  }

  // Check if session is already complete
  if (activeDigest.session?.status === 'completed') {
    return { interrupted: false };
  }

  const conversation = loadConversation();
  if (!conversation) {
    return { interrupted: false };
  }

  // Check if there are pending questions
  const clarifications = loadClarifications();
  if (!clarifications) {
    return { interrupted: false };
  }

  const pendingQuestions = clarifications.questions?.filter(q => q.status === 'pending') || [];
  if (pendingQuestions.length === 0) {
    return { interrupted: false };
  }

  // Calculate time since last interaction
  const lastInteraction = new Date(conversation.last_interaction);
  const timeSinceMs = Date.now() - lastInteraction.getTime();
  const timeSinceMinutes = Math.floor(timeSinceMs / 60000);

  // Get last checkpoint
  const lastCheckpoint = conversation.checkpoints.slice(-1)[0];

  // Check if we were waiting for user input
  const lastInteractionData = conversation.interactions.slice(-1)[0];
  const wasAwaitingResponse = lastInteractionData?.type === 'questions_presented';

  return {
    interrupted: true,
    session_id: activeDigest.session.id,
    digest_path: activeDigest.session.digest_path,
    reason: wasAwaitingResponse ? 'awaiting_response' : 'incomplete',
    last_interaction: conversation.last_interaction,
    time_since_minutes: timeSinceMinutes,
    time_since_formatted: formatTimeSince(timeSinceMs),
    checkpoint: lastCheckpoint,
    pending_questions: pendingQuestions.length,
    answered_questions: clarifications.questions?.filter(q => q.status === 'answered').length || 0,
    total_questions: clarifications.questions?.length || 0
  };
}

/**
 * Format time since last interaction
 */
function formatTimeSince(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Generate recovery summary for interrupted session
 */
function generateRecoverySummary() {
  const interrupted = detectInterruptedSession();
  if (!interrupted.interrupted) {
    return null;
  }

  const clarifications = loadClarifications();
  const topics = loadTopics();
  const conversation = loadConversation();

  // Get recent answered questions for context
  const recentAnswers = clarifications.questions
    .filter(q => q.status === 'answered')
    .slice(-5)
    .map(q => ({
      topic: q.topic_title,
      question: q.question,
      answer: q.answer,
      answered_at: q.answered_at
    }));

  // Get pending questions
  const pendingByTopic = {};
  for (const q of clarifications.questions.filter(q => q.status === 'pending')) {
    const topicKey = q.topic_title || q.topic_id;
    if (!pendingByTopic[topicKey]) {
      pendingByTopic[topicKey] = [];
    }
    pendingByTopic[topicKey].push(q);
  }

  // Get topics status
  const topicsStatus = (topics.topics || []).map(t => ({
    id: t.id,
    title: t.title,
    pending_questions: clarifications.questions.filter(q => q.topic_id === t.id && q.status === 'pending').length,
    answered_questions: clarifications.questions.filter(q => q.topic_id === t.id && q.status === 'answered').length
  }));

  return {
    session_id: interrupted.session_id,
    started_at: conversation.started_at,
    last_active: interrupted.last_interaction,
    time_since: interrupted.time_since_formatted,
    progress: {
      answered: interrupted.answered_questions,
      pending: interrupted.pending_questions,
      total: interrupted.total_questions,
      percentage: Math.round((interrupted.answered_questions / interrupted.total_questions) * 100)
    },
    recent_answers: recentAnswers,
    pending_by_topic: pendingByTopic,
    topics_status: topicsStatus,
    checkpoint: interrupted.checkpoint
  };
}

/**
 * Resume an interrupted session
 */
function resumeSession() {
  const interrupted = detectInterruptedSession();
  if (!interrupted.interrupted) {
    return { error: 'No interrupted session to resume' };
  }

  // Record the resume
  recordInteraction('session_resumed', {
    resumed_from: interrupted.checkpoint?.id,
    time_since: interrupted.time_since_formatted
  });

  // Create a new checkpoint
  createCheckpoint('resume');

  // Get next questions to present
  const nextQuestions = getQuestionsForPresentation(null, 5);

  return {
    resumed: true,
    session_id: interrupted.session_id,
    summary: generateRecoverySummary(),
    next_questions: nextQuestions,
    formatted_questions: formatQuestionsForUser(nextQuestions)
  };
}

/**
 * Mark questions as presented (for tracking)
 */
function markQuestionsPresented(questionIds, topic = null) {
  recordInteraction('questions_presented', {
    question_ids: questionIds,
    topic
  });

  createCheckpoint('questions_presented');
}

/**
 * Get session history summary
 */
function getSessionHistory() {
  const conversation = loadConversation();
  if (!conversation) {
    return null;
  }

  const clarifications = loadClarifications();

  // Group interactions by type
  const summary = {
    session_id: conversation.session_id,
    started_at: conversation.started_at,
    last_interaction: conversation.last_interaction,
    duration_ms: new Date(conversation.last_interaction) - new Date(conversation.started_at),
    interaction_count: conversation.interactions.length,
    checkpoint_count: conversation.checkpoints.length,
    answers_given: clarifications?.questions?.filter(q => q.status === 'answered').length || 0,
    interactions_by_type: {}
  };

  for (const interaction of conversation.interactions) {
    summary.interactions_by_type[interaction.type] = (summary.interactions_by_type[interaction.type] || 0) + 1;
  }

  return summary;
}

/**
 * Export session state for backup
 */
function exportSession(format = 'json') {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    return { error: 'No active session' };
  }

  const topics = loadTopics();
  const statements = loadStatementMap();
  const clarifications = loadClarifications();
  const conversation = loadConversation();

  const exportData = {
    exported_at: now(),
    session: activeDigest.session,
    phases: activeDigest.phases,
    topics,
    statements,
    clarifications,
    conversation
  };

  if (format === 'json') {
    return exportData;
  }

  if (format === 'md') {
    return formatExportAsMarkdown(exportData);
  }

  return exportData;
}

/**
 * Format export as markdown
 */
function formatExportAsMarkdown(data) {
  let md = `# Transcript Digest Export\n\n`;
  md += `**Session ID:** ${data.session.id}\n`;
  md += `**Exported:** ${data.exported_at}\n\n`;

  md += `## Progress\n\n`;
  const answered = data.clarifications?.questions?.filter(q => q.status === 'answered').length || 0;
  const total = data.clarifications?.questions?.length || 0;
  md += `- Questions answered: ${answered}/${total}\n`;
  md += `- Topics: ${data.topics?.topics?.length || 0}\n`;
  md += `- Statements: ${data.statements?.statements?.length || 0}\n\n`;

  md += `## Topics\n\n`;
  for (const topic of (data.topics?.topics || [])) {
    md += `### ${topic.title}\n`;
    md += `- Entities: ${(topic.entities || []).join(', ')}\n`;
    md += `- Keywords: ${(topic.keywords || []).join(', ')}\n\n`;
  }

  md += `## Answered Questions\n\n`;
  for (const q of (data.clarifications?.questions || []).filter(q => q.status === 'answered')) {
    md += `### ${q.topic_title || 'General'}\n`;
    md += `**Q:** ${q.question}\n`;
    md += `**A:** ${q.answer}\n\n`;
  }

  md += `## Pending Questions\n\n`;
  for (const q of (data.clarifications?.questions || []).filter(q => q.status === 'pending')) {
    md += `- [${q.priority}] ${q.question}\n`;
  }

  return md;
}

/**
 * Review all answered questions
 */
function reviewAnswers() {
  const clarifications = loadClarifications();
  if (!clarifications) {
    return { error: 'No clarifications found' };
  }

  const answered = clarifications.questions.filter(q => q.status === 'answered');

  // Group by topic
  const byTopic = {};
  for (const q of answered) {
    const topicKey = q.topic_title || q.topic_id || 'General';
    if (!byTopic[topicKey]) {
      byTopic[topicKey] = [];
    }
    byTopic[topicKey].push({
      id: q.id,
      question: q.question,
      answer: q.answer,
      answered_at: q.answered_at,
      source: q.answer_source
    });
  }

  return {
    total_answered: answered.length,
    by_topic: byTopic
  };
}

/**
 * Save topics to digest
 */
function saveTopics(topics) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  const topicsPath = path.join(activeDigest.session.digest_path, 'topics.json');

  // Ensure proper structure
  const topicsData = {
    topics: topics.topics || topics,
    metadata: {
      total_topics: (topics.topics || topics).length,
      active_topics: (topics.topics || topics).filter(t => t.status === 'active').length,
      clarified_topics: (topics.topics || topics).filter(t => t.clarification_complete).length,
      generated_topics: (topics.topics || topics).filter(t => t.stories_generated).length,
      detected_at: now(),
      last_updated: now(),
      transcript_word_count: activeDigest.input?.word_count || 0,
      detection_method: 'pass-1-extraction'
    }
  };

  fs.writeFileSync(topicsPath, JSON.stringify(topicsData, null, 2));

  // Update phase
  updatePhase('topic_extraction', 'completed', { topics_found: topicsData.topics.length });

  return topicsData;
}

/**
 * Load topics from digest
 */
function loadTopics() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const topicsPath = path.join(activeDigest.session.digest_path, 'topics.json');
  try {
    return JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Get digest status
 */
function getStatus() {
  const activeDigest = loadActiveDigest();

  if (activeDigest.session.status === 'inactive') {
    return { active: false };
  }

  return {
    active: true,
    id: activeDigest.session.id,
    phase: activeDigest.session.phase,
    phases: activeDigest.phases,
    input: activeDigest.input
  };
}

/**
 * Check if input should trigger digestion
 */
function shouldTriggerDigestion(text) {
  const config = loadConfig();
  const threshold = config.autoTriggerThreshold || 2000;
  const wordCount = countWords(text);

  if (wordCount < threshold) {
    return { trigger: false, reason: 'below_threshold', wordCount };
  }

  // Check content type
  const contentType = classifyContent(text);

  if (contentType.type === 'requirements' || contentType.type === 'transcript') {
    return { trigger: true, reason: 'auto', wordCount, contentType };
  }

  if (contentType.type === 'code') {
    return { trigger: false, reason: 'code_detected', wordCount, contentType };
  }

  // Ambiguous - suggest asking
  return { trigger: 'ask', reason: 'ambiguous', wordCount, contentType };
}

/**
 * Basic content classification
 */
function classifyContent(text) {
  // Check for code patterns
  const codePatterns = [
    /```[\s\S]*```/g,
    /function\s+\w+\s*\(/g,
    /const\s+\w+\s*=/g,
    /import\s+.*from/g,
    /class\s+\w+/g
  ];

  let codeMatches = 0;
  for (const pattern of codePatterns) {
    const matches = text.match(pattern);
    if (matches) codeMatches += matches.length;
  }

  if (codeMatches > 10) {
    return { type: 'code', confidence: 0.8 };
  }

  // Check for requirements patterns
  const reqPatterns = [
    /we need/gi,
    /should have/gi,
    /must support/gi,
    /add a feature/gi,
    /implement/gi,
    /the \w+ should/gi
  ];

  let reqMatches = 0;
  for (const pattern of reqPatterns) {
    const matches = text.match(pattern);
    if (matches) reqMatches += matches.length;
  }

  if (reqMatches > 5) {
    return { type: 'requirements', confidence: 0.85 };
  }

  // Check for transcript patterns
  const transcriptPatterns = [
    /^\d{2}:\d{2}/gm,  // Timestamps
    /^speaker \d+:/gim,
    /^\[.*\]:/gm,
    /^[A-Z][a-z]+:/gm  // Speaker names
  ];

  let transcriptMatches = 0;
  for (const pattern of transcriptPatterns) {
    const matches = text.match(pattern);
    if (matches) transcriptMatches += matches.length;
  }

  if (transcriptMatches > 10) {
    return { type: 'transcript', confidence: 0.9 };
  }

  return { type: 'unknown', confidence: 0.5 };
}

// E4-S1 (Large Input Detection), E4-S2 (Content Type Classification),
// and E3-S1 (Complexity Detection) functions extracted to:
//   flow-long-input-detection.js, flow-long-input-complexity.js

/**
 * Main complexity analysis function
 */
function analyzeComplexity() {
  const topics = loadTopics();
  const statementMap = loadStatementMap();
  const clarifications = loadClarifications();

  if (!topics || !topics.topics) {
    return { error: 'No topics found. Run Pass 1 first.' };
  }

  const statements = statementMap?.statements || [];

  // Build digest object
  const digest = {
    topics: topics.topics,
    statements,
    clarifications: clarifications || { questions: [], contradictions: [] }
  };

  // Calculate overall complexity
  const overallScore = calculateComplexityScore(digest);
  const level = getComplexityLevel(overallScore);

  // Analyze each topic
  const topicAnalysis = topics.topics
    .filter(t => t.status === 'active')
    .map(t => analyzeTopicComplexity(t, statements, clarifications));

  // Get output recommendation
  const recommendation = recommendOutputStructure(overallScore, topicAnalysis);

  // Extract entity summary
  const entitySummary = extractEntities(statements);

  // Build result
  const result = {
    overall: {
      score: overallScore,
      level: level.level,
      description: level.description,
      confidence: 0.85
    },
    factors: {
      topic_count: topics.topics.filter(t => t.status === 'active').length,
      statement_count: statements.filter(s => s.meaningful !== false).length,
      question_count: clarifications?.questions?.length || 0,
      contradiction_count: clarifications?.contradictions?.length || 0,
      entity_types: countEntityTypes(statements),
      ui_components: entitySummary.ui_components.length,
      data_entities: entitySummary.data_entities.length,
      interactions: entitySummary.interactions.length
    },
    topic_analysis: topicAnalysis,
    recommendation,
    entity_summary: entitySummary
  };

  return result;
}

// Initialize story module with core functions
transcriptStories.init({
  loadActiveDigest,
  saveActiveDigest,
  loadTopics,
  saveTopics,
  loadStatementMap,
  loadClarifications,
  isRequirement,
  isVagueStatement,
  analyzeComplexity,
  REQUIREMENT_PATTERNS,
  VAGUE_PATTERNS,
  ENTITY_PATTERNS
});

// Initialize chunking module with core functions
transcriptChunking.init({
  loadActiveDigest,
  saveActiveDigest,
  countWords,
  now
});

// Initialize detection module with functions from main module
longInputDetection.init({
  countWords,
  classifyContent
});

// ==========================================================================
// Quick Processing Mode
// ==========================================================================

/**
 * Quick process mode - single-pass extraction without interactive clarification.
 * Used by the long input gate for fast feedback.
 *
 * @param {string} input - The input text to process
 * @param {Object} options - Processing options
 * @returns {Object} Quick scan results
 */
function quickProcess(input, _options = {}) {
  if (!input || typeof input !== 'string') {
    return { error: 'No input provided' };
  }

  const startTime = Date.now();

  // 1. Split into statements (returns objects with .text property)
  const statements = splitIntoStatements(input);
  // isMeaningfulStatement returns {meaningful: bool, reason: string}, filter on .meaningful
  const meaningfulStatements = statements.filter(s => isMeaningfulStatement(s.text).meaningful);

  // 2. Quick topic extraction (keyword-based, no full analysis)
  const topicKeywords = new Set();
  const topicPatterns = [
    /\b(add|create|build|implement)\s+(?:a\s+)?(\w+(?:\s+\w+)?)/gi,
    /\b(\w+)\s+(feature|component|page|button|form|table|list)/gi,
    /\b(user|admin|guest)\s+(?:can|should|must|wants?)\s+(\w+)/gi
  ];

  for (const statement of meaningfulStatements) {
    const text = statement.text;
    for (const pattern of topicPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const keyword = (match[2] || match[1]).toLowerCase();
        if (keyword.length > 2) {
          topicKeywords.add(keyword);
        }
      }
    }
  }

  // 3. Quick contradiction detection
  const contradictions = [];
  const seenValues = new Map(); // attribute -> { value, text }

  const valuePatterns = [
    { pattern: /(\d+)\s*(columns?|rows?|items?|pages?)/gi, attr: 'count' },
    { pattern: /(primary|secondary|danger|success)\s*(?:color|button)/gi, attr: 'style' },
    { pattern: /(left|right|center|top|bottom)/gi, attr: 'position' }
  ];

  for (const statement of meaningfulStatements) {
    const text = statement.text;
    for (const { pattern, attr } of valuePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const value = match[1].toLowerCase();
        const key = `${attr}`;

        if (seenValues.has(key) && seenValues.get(key).value !== value) {
          // Check for correction phrase
          const isCorrection = detectCorrectionPhrase(text);

          contradictions.push({
            attribute: attr,
            value1: seenValues.get(key).value,
            value2: value,
            statement1: seenValues.get(key).text.slice(0, 50),
            statement2: text.slice(0, 50),
            autoResolved: isCorrection,
            resolution: isCorrection ? `Later statement (${value}) supersedes` : 'needs_review'
          });
        }

        seenValues.set(key, { value, text });
      }
    }
  }

  const elapsed = Date.now() - startTime;

  return {
    mode: 'quick',
    success: true,
    metrics: {
      totalStatements: statements.length,
      meaningfulStatements: meaningfulStatements.length,
      topicsDetected: topicKeywords.size,
      contradictionsFound: contradictions.length,
      autoResolved: contradictions.filter(c => c.autoResolved).length,
      processingTimeMs: elapsed
    },
    topics: Array.from(topicKeywords),
    contradictions: contradictions.filter(c => !c.autoResolved),
    summary: generateQuickSummary(meaningfulStatements.length, topicKeywords.size, contradictions)
  };
}

/**
 * Generate human-readable summary for quick scan
 */
function generateQuickSummary(statementCount, topicCount, contradictions) {
  const unresolvedCount = contradictions.filter(c => !c.autoResolved).length;

  let summary = `Quick scan complete: ${statementCount} statements, ${topicCount} topics detected.`;

  if (contradictions.length > 0) {
    const autoResolved = contradictions.filter(c => c.autoResolved).length;
    summary += `\n${contradictions.length} potential contradictions found`;
    if (autoResolved > 0) {
      summary += ` (${autoResolved} auto-resolved as corrections)`;
    }
    if (unresolvedCount > 0) {
      summary += `.\n${unresolvedCount} need review.`;
    }
  } else {
    summary += '\nNo obvious contradictions detected.';
  }

  return summary;
}

// =============================================================================
// UNIFIED PIPELINE (runs all passes in sequence)
// =============================================================================

/**
 * Run the full 4-pass pipeline in one call.
 *
 * Chains: createSession → runPass2 → runPass3 → runPass4
 *
 * Pass 1 (topic extraction) is handled by the AI via the command spec —
 * the AI reads the confirmed statements and generates topics.json before
 * calling this function. This function handles Passes 2-4.
 *
 * @param {Object} options
 * @param {string} options.transcript - The full transcript text
 * @param {Object[]} options.topics - Topics array (from AI or extractTopics)
 * @param {string} options.contentType - Content type classification
 * @returns {Object} Consolidated pipeline result
 */
function runFullPipeline(options = {}) {
  const { transcript, topics, contentType } = options;

  if (!transcript) throw new Error('transcript is required');
  if (!topics || !topics.length) throw new Error('topics array is required');

  // Step 1: Create session with transcript
  const session = createSession(transcript, { contentType: contentType || 'transcript' });
  const digestId = session.id || session.session?.id;

  // Step 2: Save the topics (normally done by AI in Pass 1)
  const topicsData = {
    topics: topics.map((t, i) => ({
      id: t.id || `topic-${String(i + 1).padStart(3, '0')}`,
      title: t.title,
      keywords: t.keywords || [],
      description: t.description || '',
      priority: t.priority || 'medium',
      statement_count: 0,
      status: 'active'
    })),
    metadata: {
      total_topics: topics.length,
      active_topics: topics.length,
      clarified_topics: 0,
      generated_topics: 0,
      detected_at: now(),
      last_updated: now(),
      transcript_word_count: countWords(transcript),
      detection_method: 'unified-pipeline'
    }
  };
  saveTopics(topicsData);
  updatePhase('topic_extraction', 'completed', { topics_found: topics.length });

  // Step 3: Run Pass 2 — statement mapping + contradiction detection
  let pass2Result;
  try {
    pass2Result = runPass2();
  } catch (err) {
    return { error: `Pass 2 failed: ${err.message}`, phase: 'statement_mapping' };
  }

  // Step 4: Run Pass 3 — orphan check and resolution
  let pass3Result;
  try {
    pass3Result = runPass3();
  } catch (err) {
    return { error: `Pass 3 failed: ${err.message}`, phase: 'orphan_check' };
  }

  // Step 5: Run Pass 4 — contradiction resolution
  let pass4Result;
  try {
    pass4Result = runPass4();
  } catch (err) {
    return { error: `Pass 4 failed: ${err.message}`, phase: 'contradiction_resolution' };
  }

  // Step 6: Collect clarification questions (from contradictions + orphans)
  const clarifications = loadClarifications();
  const pendingContradictions = (clarifications?.contradictions || [])
    .filter(c => c.status === 'pending');

  const orphanQuestions = (pass3Result?.orphans || [])
    .filter(o => o.needs_clarification)
    .map(o => ({
      type: 'orphan',
      statement_id: o.id,
      question: o.clarification_question,
      text: o.text
    }));

  const allClarificationQuestions = [
    ...pendingContradictions.map(c => ({
      type: 'contradiction',
      id: c.id,
      question: c.question,
      options: c.options
    })),
    ...orphanQuestions
  ];

  // Step 7: Load final state for summary
  const stmtMap = loadStatementMap();
  const finalTopics = loadTopics();

  return {
    success: true,
    digest_id: digestId,
    summary: {
      topics_count: finalTopics?.topics?.length || 0,
      statements_total: stmtMap?.metadata?.total_statements || 0,
      statements_meaningful: stmtMap?.metadata?.meaningful_statements || 0,
      statements_mapped: stmtMap?.metadata?.mapped_statements || 0,
      orphans_found: pass3Result?.orphans?.length || 0,
      orphans_resolved: pass3Result?.resolved?.length || 0,
      new_topics_created: pass3Result?.new_topics_created?.length || 0,
      contradictions_total: pass4Result?.stats?.total || 0,
      contradictions_auto_resolved: pass4Result?.stats?.auto_resolved || 0,
      contradictions_needs_clarification: pass4Result?.stats?.needs_clarification || 0,
      additive_not_contradiction: pass4Result?.stats?.additive_not_contradiction || 0,
      coverage_percentage: pass3Result?.coverage?.percentage || 0
    },
    clarification_questions: allClarificationQuestions,
    topics: finalTopics?.topics || [],
    pass2: pass2Result,
    pass3: pass3Result,
    pass4: pass4Result
  };
}

// Export for use as module
module.exports = {
  // Utilities
  now,
  // Core session management
  createSession,
  loadActiveDigest,
  saveActiveDigest,
  updatePhase,
  saveTopics,
  loadTopics,
  getStatus,
  shouldTriggerDigestion,
  classifyContent,
  countWords,
  // Pass 2: Statement Association
  isMeaningfulStatement,
  splitIntoStatements,
  associateStatements,
  detectContradictions,
  saveStatementMap,
  loadStatementMap,
  runPass2,
  // Pass 3: Orphan Check
  resolveOrphan,
  createTopicFromOrphans,
  ensureGeneralTopic,
  saveOrphans,
  loadOrphans,
  runPass3,
  // Pass 4: Contradiction Resolution
  detectCorrectionPhrase,
  isAdditive,
  calculateResolutionConfidence,
  generateContradictionQuestion,
  saveClarifications,
  loadClarifications,
  runPass4,
  // Question Generation (E2-S1)
  analyzeCompleteness,
  detectVagueness,
  generateQuestionsForTopic,
  generateAllQuestions,
  // Conversation Loop (E2-S2)
  parseAnswers,
  captureAnswer,
  createDerivedStatement,
  checkFollowups,
  addFollowupQuestions,
  checkCompletion,
  getQuestionsForPresentation,
  formatQuestionsForUser,
  processConversationResponse,
  resolveContradictionWithChoice,
  // Voice Answer Integration (E2-S3)
  isVoiceInput,
  removeFillers,
  applySelfCorrections,
  normalizeNumbers,
  detectUncertainty,
  detectYesNo,
  addPunctuation,
  normalizeVoiceInput,
  calculateVoiceConfidence,
  processVoiceAnswer,
  // State Persistence (E2-S4)
  loadConversation,
  saveConversation,
  initializeConversation,
  recordInteraction,
  createCheckpoint,
  detectInterruptedSession,
  generateRecoverySummary,
  resumeSession,
  markQuestionsPresented,
  getSessionHistory,
  exportSession,
  reviewAnswers,
  // Complexity Detection (E3-S1)
  countEntityTypes,
  extractEntities,
  getComplexityLevel,
  calculateComplexityScore,
  isRequirement,
  isVagueStatement,
  hasUIComponent,
  hasDataModel,
  hasUserInteraction,
  analyzeTopicComplexity,
  groupRelatedTopics,
  generateEpicStructure,
  recommendOutputStructure,
  analyzeComplexity,
  // Story Generation (E3-S2) - re-exported from flow-transcript-stories.js
  USER_TYPE_PATTERNS: transcriptStories.USER_TYPE_PATTERNS,
  SCENARIO_PATTERNS: transcriptStories.SCENARIO_PATTERNS,
  generateStoryId: transcriptStories.generateStoryId,
  detectUserType: transcriptStories.detectUserType,
  extractObject: transcriptStories.extractObject,
  generateScenarioName: transcriptStories.generateScenarioName,
  extractActionFromText: transcriptStories.extractActionFromText,
  extractOutcomeFromText: transcriptStories.extractOutcomeFromText,
  convertToGiven: transcriptStories.convertToGiven,
  extractGiven: transcriptStories.extractGiven,
  extractWhen: transcriptStories.extractWhen,
  extractThen: transcriptStories.extractThen,
  generateCriteriaFromClarification: transcriptStories.generateCriteriaFromClarification,
  buildTraceabilityMatrix: transcriptStories.buildTraceabilityMatrix,
  validateStoryCoverage: transcriptStories.validateStoryCoverage,
  generateStoryFromTopic: transcriptStories.generateStoryFromTopic,
  generateAllStories: transcriptStories.generateAllStories,
  saveStory: transcriptStories.saveStory,
  loadStory: transcriptStories.loadStory,
  loadAllStories: transcriptStories.loadAllStories,
  formatStoryAsMarkdown: transcriptStories.formatStoryAsMarkdown,
  // Presentation Flow (E3-S3) - re-exported from flow-transcript-stories.js
  loadQueue: transcriptStories.loadQueue,
  saveQueue: transcriptStories.saveQueue,
  initializePresentation: transcriptStories.initializePresentation,
  getPresentationStatus: transcriptStories.getPresentationStatus,
  getNextStory: transcriptStories.getNextStory,
  getCurrentStory: transcriptStories.getCurrentStory,
  approveCurrentStory: transcriptStories.approveCurrentStory,
  rejectCurrentStory: transcriptStories.rejectCurrentStory,
  skipCurrentStory: transcriptStories.skipCurrentStory,
  formatStorySummary: transcriptStories.formatStorySummary,
  formatActionsPrompt: transcriptStories.formatActionsPrompt,
  getCompletionSummary: transcriptStories.getCompletionSummary,
  resetPresentation: transcriptStories.resetPresentation,
  // Edit and Change Handling (E3-S4) - re-exported from flow-transcript-stories.js
  generateEditSessionId: transcriptStories.generateEditSessionId,
  generateChangeId: transcriptStories.generateChangeId,
  loadEditSessions: transcriptStories.loadEditSessions,
  saveEditSessions: transcriptStories.saveEditSessions,
  startEditSession: transcriptStories.startEditSession,
  getActiveEditSession: transcriptStories.getActiveEditSession,
  recordChange: transcriptStories.recordChange,
  editUserStory: transcriptStories.editUserStory,
  editCriterion: transcriptStories.editCriterion,
  addCriterion: transcriptStories.addCriterion,
  removeCriterion: transcriptStories.removeCriterion,
  validateEditedStory: transcriptStories.validateEditedStory,
  recalculateCoverage: transcriptStories.recalculateCoverage,
  updateQueueAfterEdit: transcriptStories.updateQueueAfterEdit,
  commitEditSession: transcriptStories.commitEditSession,
  cancelEditSession: transcriptStories.cancelEditSession,
  getEditChanges: transcriptStories.getEditChanges,
  getEditHistory: transcriptStories.getEditHistory,
  listEditableStories: transcriptStories.listEditableStories,
  // ready.json Integration (E3-S5) - re-exported from flow-transcript-stories.js
  generateWorkflowId: transcriptStories.generateWorkflowId,
  generateSubTaskId: transcriptStories.generateSubTaskId,
  mapPriority: transcriptStories.mapPriority,
  formatUserStoryDescription: transcriptStories.formatUserStoryDescription,
  convertStoryToTask: transcriptStories.convertStoryToTask,
  validateForExport: transcriptStories.validateForExport,
  exportApprovedStories: transcriptStories.exportApprovedStories,
  createFeatureTask: transcriptStories.createFeatureTask,
  addTasksToReadyJson: transcriptStories.addTasksToReadyJson,
  formatTaskAsMarkdown: transcriptStories.formatTaskAsMarkdown,
  exportStoryFiles: transcriptStories.exportStoryFiles,
  previewExport: transcriptStories.previewExport,
  finalizeDigestion: transcriptStories.finalizeDigestion,
  generateAndExportStories: transcriptStories.generateAndExportStories,
  // Large Input Detection (E4-S1)
  measureInputMetrics,
  estimateTokens,
  isVTTFormat,
  isSRTFormat,
  detectMeetingFormat,
  detectInputFormat,
  analyzeInput,
  evaluateTrigger,
  generateRecommendationMessage,
  detectLargeInput,
  // Content Type Classification (E4-S2)
  scoreContentType,
  normalizeScore,
  classifyContentTypes,
  getDetailedClassification,
  shouldExcludeContent,
  // VTT/SRT Format Parsing (E4-S3) - re-exported from flow-transcript-parsing.js
  timestampToMs: transcriptParsing.timestampToMs,
  msToTimestamp: transcriptParsing.msToTimestamp,
  cleanSubtitleText: transcriptParsing.cleanSubtitleText,
  extractVTTSpeaker: transcriptParsing.extractVTTSpeaker,
  extractSpeaker: transcriptParsing.extractSpeaker,
  parseVTT: transcriptParsing.parseVTT,
  parseSRT: transcriptParsing.parseSRT,
  mergeCues: transcriptParsing.mergeCues,
  parseSubtitle: transcriptParsing.parseSubtitle,
  formatCuesAsText: transcriptParsing.formatCuesAsText,
  getSubtitleStats: transcriptParsing.getSubtitleStats,
  // Zoom/Teams Parsing (E4-S4) - re-exported from flow-transcript-parsing.js
  ZOOM_PATTERNS: transcriptParsing.ZOOM_PATTERNS,
  TEAMS_PATTERNS: transcriptParsing.TEAMS_PATTERNS,
  isSystemMessage: transcriptParsing.isSystemMessage,
  parseTimeToMs: transcriptParsing.parseTimeToMs,
  parseZoomChat: transcriptParsing.parseZoomChat,
  parseZoomVTT: transcriptParsing.parseZoomVTT,
  parseTeamsChat: transcriptParsing.parseTeamsChat,
  parseTeamsVTT: transcriptParsing.parseTeamsVTT,
  parseTeamsJSON: transcriptParsing.parseTeamsJSON,
  detectMeetingType: transcriptParsing.detectMeetingType,
  parseZoom: transcriptParsing.parseZoom,
  parseTeams: transcriptParsing.parseTeams,
  parseMeeting: transcriptParsing.parseMeeting,
  mergeMeetingEntries: transcriptParsing.mergeMeetingEntries,
  formatMeetingAsText: transcriptParsing.formatMeetingAsText,
  getMeetingStats: transcriptParsing.getMeetingStats,
  // Language Detection (E5-S1) - re-exported from flow-transcript-language.js
  SCRIPT_PATTERNS: transcriptLanguage.SCRIPT_PATTERNS,
  LANGUAGE_INFO: transcriptLanguage.LANGUAGE_INFO,
  COMMON_WORDS: transcriptLanguage.COMMON_WORDS,
  TRIGRAM_PROFILES: transcriptLanguage.TRIGRAM_PROFILES,
  detectScript: transcriptLanguage.detectScript,
  cleanForDetection: transcriptLanguage.cleanForDetection,
  extractWords: transcriptLanguage.extractWords,
  analyzeCommonWords: transcriptLanguage.analyzeCommonWords,
  extractTrigrams: transcriptLanguage.extractTrigrams,
  analyzeNgrams: transcriptLanguage.analyzeNgrams,
  combineLanguageScores: transcriptLanguage.combineLanguageScores,
  detectLanguage: transcriptLanguage.detectLanguage,
  detectMultipleLanguages: transcriptLanguage.detectMultipleLanguages,
  getLanguageInfo: transcriptLanguage.getLanguageInfo,
  listSupportedLanguages: transcriptLanguage.listSupportedLanguages,
  // Multi-language Clarification (E5-S2)
  QUESTION_TEMPLATES_BY_LANGUAGE,
  getQuestionTemplates,
  generateLocalizedQuestion,
  detectSessionLanguage,
  getTopicLanguage,
  setLanguagePreference,
  getEffectiveLanguage,
  getSessionLanguageInfo,
  // Durable Session Persistence (E5-S3) - re-exported from flow-transcript-chunking.js
  DURABLE_DIGEST_PATH: transcriptChunking.DURABLE_DIGEST_PATH,
  DURABLE_DIGEST_VERSION: transcriptChunking.DURABLE_DIGEST_VERSION,
  loadDurableSessions: transcriptChunking.loadDurableSessions,
  saveDurableSessions: transcriptChunking.saveDurableSessions,
  upsertDurableSession: transcriptChunking.upsertDurableSession,
  getSessionProgress: transcriptChunking.getSessionProgress,
  registerDurableSession: transcriptChunking.registerDurableSession,
  updateDurableProgress: transcriptChunking.updateDurableProgress,
  createDurableCheckpoint: transcriptChunking.createDurableCheckpoint,
  listDurableSessions: transcriptChunking.listDurableSessions,
  getDurableSession: transcriptChunking.getDurableSession,
  switchDurableSession: transcriptChunking.switchDurableSession,
  updateRecoveryContext: transcriptChunking.updateRecoveryContext,
  generateRecoverySummaryForSession: transcriptChunking.generateRecoverySummaryForSession,
  getTimeSince: transcriptChunking.getTimeSince,
  determineNextAction: transcriptChunking.determineNextAction,
  archiveDurableSession: transcriptChunking.archiveDurableSession,
  deleteDurableSession: transcriptChunking.deleteDurableSession,
  completeDurableSession: transcriptChunking.completeDurableSession,
  // Large Transcript Chunking (E5-S4) - re-exported from flow-transcript-chunking.js
  CHUNKING_DEFAULTS: transcriptChunking.CHUNKING_DEFAULTS,
  SPEAKER_BOUNDARY_PATTERNS: transcriptChunking.SPEAKER_BOUNDARY_PATTERNS,
  needsChunking: transcriptChunking.needsChunking,
  splitIntoSentences: transcriptChunking.splitIntoSentences,
  findNaturalBoundary: transcriptChunking.findNaturalBoundary,
  planChunks: transcriptChunking.planChunks,
  createChunks: transcriptChunking.createChunks,
  normalizeTopicTitle: transcriptChunking.normalizeTopicTitle,
  normalizeStatement: transcriptChunking.normalizeStatement,
  mergeChunkTopics: transcriptChunking.mergeChunkTopics,
  mergeChunkStatements: transcriptChunking.mergeChunkStatements,
  initializeChunkingState: transcriptChunking.initializeChunkingState,
  loadChunkingState: transcriptChunking.loadChunkingState,
  saveChunkingState: transcriptChunking.saveChunkingState,
  updateChunkStatus: transcriptChunking.updateChunkStatus,
  getChunkContent: transcriptChunking.getChunkContent,
  getChunkingStatus: transcriptChunking.getChunkingStatus,
  // Quick Processing Mode (for gate integration)
  quickProcess,
  generateQuickSummary,
  // Unified Pipeline (runs all passes in sequence)
  runFullPipeline
};

// Run CLI if called directly
if (require.main === module) {
  require('./flow-long-input-cli').main().catch(err => {
    console.error(`[flow-long-input] Fatal error: ${err.message}`);
    process.exit(1);
  });
}
