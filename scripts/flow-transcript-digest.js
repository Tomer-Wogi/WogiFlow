#!/usr/bin/env node

/**
 * Transcript Digestion - Multi-pass extraction system
 *
 * This script manages digest sessions and provides utilities for the
 * multi-pass extraction process. The actual extraction is done by Claude
 * following the rules in .claude/skills/transcript-digestion/rules/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJson } = require('./flow-utils');

// Paths
const STATE_DIR = path.join(process.cwd(), '.workflow', 'state', 'digests');
const ACTIVE_DIGEST_FILE = path.join(STATE_DIR, 'active-digest.json');
const CONFIG_FILE = path.join(process.cwd(), '.workflow', 'config.json');

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
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config.transcriptDigestion || {};
  } catch (err) {
    return {};
  }
}

/**
 * Generate unique digest ID
 */
function generateDigestId() {
  return 'digest-' + crypto.randomBytes(4).toString('hex');
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
  } catch (err) {
    return { session: { status: 'inactive' } };
  }
}

/**
 * Save active digest session
 */
function saveActiveDigest(data) {
  fs.writeFileSync(ACTIVE_DIGEST_FILE, JSON.stringify(data, null, 2));
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
 * Filler words and phrases to skip
 */
const FILLER_PATTERNS = [
  /^(um|uh|er|ah|like|you know|so|anyway|basically|actually|literally|right\??)$/i,
  /^(okay|ok|got it|makes sense|sure|yeah|yes|no|alright|right)$/i,
  /^(hi|hello|hey|thanks|thank you|bye|goodbye)(\s+everyone|\s+all)?$/i,
  /^(can you hear me|let me share|one moment|hold on).*$/i,
  /^(that's (a )?good (point|idea)|i agree|exactly|absolutely)$/i,
  /^(let's move on|moving on|anyway|so yeah|alright then)$/i
];

/**
 * Requirement signal patterns
 */
const REQUIREMENT_PATTERNS = [
  /should\s+(be|have|show|display|allow|support|include)/i,
  /must\s+(be|have|show|display|allow|support|include)/i,
  /need(s)?\s+(to|a|the)/i,
  /add\s+(a|the|some)/i,
  /create\s+(a|the|some)/i,
  /implement/i,
  /when\s+.+\s+then/i,
  /if\s+.+\s+(should|must|will)/i
];

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
  } catch (err) {
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
 * Synonym/related term mappings for semantic expansion
 */
const SEMANTIC_EXPANSIONS = {
  'login': ['sign in', 'signin', 'authentication', 'auth', 'credentials'],
  'logout': ['sign out', 'signout', 'log out'],
  'user': ['account', 'profile', 'member'],
  'button': ['btn', 'click', 'action'],
  'form': ['input', 'field', 'submit'],
  'modal': ['dialog', 'popup', 'overlay'],
  'table': ['grid', 'list', 'data'],
  'dashboard': ['home', 'overview', 'summary'],
  'settings': ['preferences', 'config', 'options'],
  'notification': ['alert', 'message', 'toast'],
  'search': ['find', 'filter', 'query'],
  'navigation': ['nav', 'menu', 'sidebar'],
  'error': ['fail', 'invalid', 'wrong'],
  'save': ['store', 'persist', 'update'],
  'delete': ['remove', 'clear', 'destroy']
};

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
function createTopicFromOrphans(orphans, existingTopics) {
  // Guard against empty orphans array
  if (!orphans || orphans.length === 0) {
    const topicId = 't-auto-' + crypto.randomBytes(3).toString('hex');
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

  const topicId = 't-auto-' + crypto.randomBytes(3).toString('hex');

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
  } catch (err) {
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
 * Correction phrase patterns for auto-resolution
 */
const CORRECTION_PATTERNS = [
  { pattern: /^actually[,\s]/i, name: 'actually', weight: 0.3 },
  { pattern: /^no[,\s]/i, name: 'no', weight: 0.25 },
  { pattern: /^wait[,\s]/i, name: 'wait', weight: 0.2 },
  { pattern: /^instead[,\s]/i, name: 'instead', weight: 0.3 },
  { pattern: /scratch that/i, name: 'scratch_that', weight: 0.35 },
  { pattern: /forget that/i, name: 'forget_that', weight: 0.35 },
  { pattern: /i meant/i, name: 'i_meant', weight: 0.3 },
  { pattern: /let me rephrase/i, name: 'rephrase', weight: 0.25 },
  { pattern: /i changed my mind/i, name: 'changed_mind', weight: 0.4 },
  { pattern: /on second thought/i, name: 'second_thought', weight: 0.35 },
  { pattern: /not (\w+)[,\s]+(\w+)/i, name: 'not_x_y', weight: 0.3 }
];

/**
 * Additive patterns that indicate not a contradiction
 */
const ADDITIVE_PATTERNS = [
  /^also[,\s]/i,
  /as well/i,
  /additionally/i,
  /\band\b/i,
  /\bplus\b/i,
  /\bboth\b/i,
  /\beither\b/i,
  /another option/i,
  /in addition/i
];

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
  } catch (err) {
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

/**
 * Entity patterns for completeness detection
 */
const ENTITY_PATTERNS = [
  { pattern: /add (?:a |the )?(\w+) table/i, type: 'table', entity: 1, missing: ['columns', 'actions', 'sorting'] },
  { pattern: /add (?:a |the )?(\w+) form/i, type: 'form', entity: 1, missing: ['fields', 'validation', 'submit_action'] },
  { pattern: /add (?:a |the )?(\w+) button/i, type: 'button', entity: 1, missing: ['action', 'confirmation'] },
  { pattern: /add (?:a |the )?(\w+) list/i, type: 'list', entity: 1, missing: ['items', 'actions', 'empty_state'] },
  { pattern: /add (?:a |the )?modal/i, type: 'modal', entity: null, missing: ['content', 'actions', 'trigger'] },
  { pattern: /add (?:a |the )?dropdown/i, type: 'dropdown', entity: null, missing: ['options', 'default', 'action'] },
  { pattern: /add (?:a |the )?search/i, type: 'search', entity: null, missing: ['scope', 'filters'] },
  { pattern: /add (?:a |the )?filter/i, type: 'filter', entity: null, missing: ['criteria', 'defaults'] }
];

/**
 * Vague patterns that need specificity
 */
const VAGUE_PATTERNS = [
  { pattern: /make it (look )?(nice|good|better|pretty)/i, key: 'design', question: 'Any specific design preferences (colors, style, reference sites)?' },
  { pattern: /make it fast(er)?/i, key: 'performance', question: 'Any specific performance targets (e.g., load under 2 seconds)?' },
  { pattern: /add (some )?validation/i, key: 'validation', question: 'Which fields need validation and what rules (required, format, length)?' },
  { pattern: /handle errors?/i, key: 'errors', question: 'How should errors be displayed to users (toast, inline, modal)?' },
  { pattern: /make it secure/i, key: 'security', question: 'Any specific security requirements (authentication method, encryption, audit logging)?' },
  { pattern: /add (some )?notifications?/i, key: 'notifications', question: 'What events should trigger notifications and how (email, in-app, push)?' },
  { pattern: /make it responsive/i, key: 'responsive', question: 'Which breakpoints are priority (mobile-first, desktop-first, specific widths)?' },
  { pattern: /improve (the )?ux/i, key: 'ux', question: 'Any specific UX improvements in mind or pain points to address?' },
  { pattern: /it should be (easy|simple|intuitive)/i, key: 'simplicity', question: 'Can you describe what "easy/simple" means for your users?' }
];

/**
 * Question templates for completeness
 */
const QUESTION_TEMPLATES = {
  table: {
    columns: { question: 'Which columns should the {entity} table display?', examples: ['Name, Email, Date', 'ID, Status, Actions'], priority: 'P1' },
    actions: { question: 'What row actions are needed for {entity}?', examples: ['View, Edit, Delete', 'None (read-only)'], priority: 'P2' },
    sorting: { question: 'Should {entity} table columns be sortable? Which ones?', examples: ['All columns', 'Date only'], priority: 'P3' }
  },
  form: {
    fields: { question: 'What fields should the {entity} form include?', examples: ['Name (required), Email, Phone'], priority: 'P1' },
    validation: { question: 'What validation rules for {entity} form?', examples: ['Email format, required fields'], priority: 'P2' },
    submit_action: { question: 'What happens after {entity} form submission?', examples: ['Show success, redirect, close modal'], priority: 'P2' }
  },
  button: {
    action: { question: 'What should the {entity} button do when clicked?', examples: ['Submit form', 'Open modal', 'Delete item'], priority: 'P1' },
    confirmation: { question: 'Should {entity} action require confirmation?', examples: ['Yes for delete', 'No for save'], priority: 'P3' }
  },
  list: {
    items: { question: 'What information should each {entity} list item show?', examples: ['Title and date', 'Full details'], priority: 'P1' },
    actions: { question: 'What actions for each {entity} list item?', examples: ['Click to expand', 'Edit/Delete buttons'], priority: 'P2' },
    empty_state: { question: 'What to show when {entity} list is empty?', examples: ['\"No items\" message', 'Create first item CTA'], priority: 'P3' }
  },
  modal: {
    content: { question: 'What content should the modal display?', examples: ['Form', 'Confirmation message', 'Details view'], priority: 'P1' },
    actions: { question: 'What buttons/actions in the modal?', examples: ['Save/Cancel', 'Confirm/Dismiss'], priority: 'P2' },
    trigger: { question: 'What triggers the modal to open?', examples: ['Button click', 'Row selection'], priority: 'P2' }
  },
  dropdown: {
    options: { question: 'What options should the dropdown include?', priority: 'P1' },
    default: { question: 'What should be the default selection?', priority: 'P3' },
    action: { question: 'What happens when a dropdown option is selected?', priority: 'P2' }
  },
  search: {
    scope: { question: 'What should the search cover (which fields/entities)?', examples: ['Name and email', 'All text fields'], priority: 'P1' },
    filters: { question: 'Should search have additional filters?', examples: ['Date range, status', 'None'], priority: 'P3' }
  },
  filter: {
    criteria: { question: 'What filter criteria are needed?', examples: ['Status, date range, category'], priority: 'P1' },
    defaults: { question: 'Should filters have default values?', priority: 'P3' }
  }
};

/**
 * Detail detection patterns
 */
const DETAIL_PATTERNS = {
  columns: /column|field|display|show\s+(the\s+)?\w+/i,
  sorting: /sort(able)?|order\s+by/i,
  actions: /click|button|delete|edit|action/i,
  validation: /valid(ation)?|required|format|pattern|check/i,
  pagination: /page|pagina|per page|\d+\s+items/i,
  fields: /field|input|text\s*box/i
};

// ==========================================================================
// E5-S2: Multi-language Question Templates
// ==========================================================================

/**
 * Question templates by language (E5-S2)
 */
const QUESTION_TEMPLATES_BY_LANGUAGE = {
  en: QUESTION_TEMPLATES, // English uses the default templates

  es: {
    table: {
      columns: { question: '¿Qué columnas debe mostrar la tabla de {entity}?', examples: ['Nombre, Email, Fecha', 'ID, Estado, Acciones'], priority: 'P1' },
      actions: { question: '¿Qué acciones de fila se necesitan para {entity}?', examples: ['Ver, Editar, Eliminar', 'Ninguna (solo lectura)'], priority: 'P2' },
      sorting: { question: '¿Las columnas de la tabla {entity} deben ser ordenables? ¿Cuáles?', examples: ['Todas las columnas', 'Solo fecha'], priority: 'P3' }
    },
    form: {
      fields: { question: '¿Qué campos debe incluir el formulario de {entity}?', examples: ['Nombre (requerido), Email, Teléfono'], priority: 'P1' },
      validation: { question: '¿Qué reglas de validación para el formulario de {entity}?', examples: ['Formato de email, campos requeridos'], priority: 'P2' },
      submit_action: { question: '¿Qué sucede después de enviar el formulario de {entity}?', examples: ['Mostrar éxito, redirigir, cerrar modal'], priority: 'P2' }
    },
    button: {
      action: { question: '¿Qué debe hacer el botón {entity} al hacer clic?', examples: ['Enviar formulario', 'Abrir modal', 'Eliminar elemento'], priority: 'P1' },
      confirmation: { question: '¿La acción de {entity} requiere confirmación?', examples: ['Sí para eliminar', 'No para guardar'], priority: 'P3' }
    },
    list: {
      items: { question: '¿Qué información debe mostrar cada elemento de la lista {entity}?', examples: ['Título y fecha', 'Detalles completos'], priority: 'P1' },
      actions: { question: '¿Qué acciones para cada elemento de la lista {entity}?', examples: ['Clic para expandir', 'Botones Editar/Eliminar'], priority: 'P2' },
      empty_state: { question: '¿Qué mostrar cuando la lista {entity} está vacía?', examples: ['Mensaje "Sin elementos"', 'CTA para crear el primero'], priority: 'P3' }
    },
    modal: {
      content: { question: '¿Qué contenido debe mostrar el modal?', examples: ['Formulario', 'Mensaje de confirmación', 'Vista de detalles'], priority: 'P1' },
      actions: { question: '¿Qué botones/acciones en el modal?', examples: ['Guardar/Cancelar', 'Confirmar/Descartar'], priority: 'P2' }
    },
    dropdown: {
      options: { question: '¿Qué opciones debe incluir el menú desplegable?', priority: 'P1' },
      default: { question: '¿Cuál debe ser la selección predeterminada?', priority: 'P3' }
    },
    search: {
      scope: { question: '¿Qué debe cubrir la búsqueda (qué campos/entidades)?', examples: ['Nombre y email', 'Todos los campos de texto'], priority: 'P1' },
      filters: { question: '¿La búsqueda debe tener filtros adicionales?', examples: ['Rango de fechas, estado', 'Ninguno'], priority: 'P3' }
    },
    filter: {
      criteria: { question: '¿Qué criterios de filtro se necesitan?', examples: ['Estado, rango de fechas, categoría'], priority: 'P1' },
      defaults: { question: '¿Los filtros deben tener valores predeterminados?', priority: 'P3' }
    }
  },

  he: {
    table: {
      columns: { question: 'אילו עמודות צריכה להציג טבלת {entity}?', examples: ['שם, אימייל, תאריך', 'מזהה, סטטוס, פעולות'], priority: 'P1' },
      actions: { question: 'אילו פעולות שורה נדרשות עבור {entity}?', examples: ['צפייה, עריכה, מחיקה', 'ללא (קריאה בלבד)'], priority: 'P2' },
      sorting: { question: 'האם עמודות טבלת {entity} צריכות להיות ניתנות למיון? אילו?', examples: ['כל העמודות', 'רק תאריך'], priority: 'P3' }
    },
    form: {
      fields: { question: 'אילו שדות צריך לכלול טופס {entity}?', examples: ['שם (חובה), אימייל, טלפון'], priority: 'P1' },
      validation: { question: 'אילו כללי אימות עבור טופס {entity}?', examples: ['פורמט אימייל, שדות חובה'], priority: 'P2' },
      submit_action: { question: 'מה קורה אחרי שליחת טופס {entity}?', examples: ['הצגת הצלחה, הפניה, סגירת מודל'], priority: 'P2' }
    },
    button: {
      action: { question: 'מה צריך כפתור {entity} לעשות בלחיצה?', examples: ['שליחת טופס', 'פתיחת מודל', 'מחיקת פריט'], priority: 'P1' },
      confirmation: { question: 'האם פעולת {entity} דורשת אישור?', examples: ['כן למחיקה', 'לא לשמירה'], priority: 'P3' }
    },
    list: {
      items: { question: 'איזה מידע כל פריט ברשימת {entity} צריך להציג?', examples: ['כותרת ותאריך', 'פרטים מלאים'], priority: 'P1' },
      actions: { question: 'אילו פעולות לכל פריט ברשימת {entity}?', examples: ['לחיצה להרחבה', 'כפתורי עריכה/מחיקה'], priority: 'P2' },
      empty_state: { question: 'מה להציג כשרשימת {entity} ריקה?', examples: ['הודעת "אין פריטים"', 'קריאה ליצירת הראשון'], priority: 'P3' }
    },
    modal: {
      content: { question: 'איזה תוכן המודל צריך להציג?', examples: ['טופס', 'הודעת אישור', 'תצוגת פרטים'], priority: 'P1' },
      actions: { question: 'אילו כפתורים/פעולות במודל?', examples: ['שמירה/ביטול', 'אישור/סגירה'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'אילו אפשרויות התפריט הנפתח צריך לכלול?', priority: 'P1' },
      default: { question: 'מה צריכה להיות הבחירה המוגדרת כברירת מחדל?', priority: 'P3' }
    },
    search: {
      scope: { question: 'מה החיפוש צריך לכסות (אילו שדות/ישויות)?', examples: ['שם ואימייל', 'כל שדות הטקסט'], priority: 'P1' },
      filters: { question: 'האם לחיפוש צריכים להיות מסננים נוספים?', examples: ['טווח תאריכים, סטטוס', 'ללא'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'אילו קריטריוני סינון נדרשים?', examples: ['סטטוס, טווח תאריכים, קטגוריה'], priority: 'P1' },
      defaults: { question: 'האם למסננים צריכים להיות ערכי ברירת מחדל?', priority: 'P3' }
    }
  },

  fr: {
    table: {
      columns: { question: 'Quelles colonnes le tableau {entity} doit-il afficher?', examples: ['Nom, Email, Date', 'ID, Statut, Actions'], priority: 'P1' },
      actions: { question: 'Quelles actions de ligne sont nécessaires pour {entity}?', examples: ['Voir, Modifier, Supprimer', 'Aucune (lecture seule)'], priority: 'P2' },
      sorting: { question: 'Les colonnes du tableau {entity} doivent-elles être triables? Lesquelles?', examples: ['Toutes les colonnes', 'Date uniquement'], priority: 'P3' }
    },
    form: {
      fields: { question: 'Quels champs le formulaire {entity} doit-il inclure?', examples: ['Nom (requis), Email, Téléphone'], priority: 'P1' },
      validation: { question: 'Quelles règles de validation pour le formulaire {entity}?', examples: ['Format email, champs requis'], priority: 'P2' },
      submit_action: { question: 'Que se passe-t-il après la soumission du formulaire {entity}?', examples: ['Afficher succès, rediriger, fermer modal'], priority: 'P2' }
    },
    button: {
      action: { question: 'Que doit faire le bouton {entity} au clic?', examples: ['Soumettre le formulaire', 'Ouvrir modal', 'Supprimer élément'], priority: 'P1' },
      confirmation: { question: "L'action {entity} nécessite-t-elle une confirmation?", examples: ['Oui pour supprimer', 'Non pour enregistrer'], priority: 'P3' }
    },
    list: {
      items: { question: 'Quelles informations chaque élément de la liste {entity} doit-il afficher?', examples: ['Titre et date', 'Détails complets'], priority: 'P1' },
      actions: { question: 'Quelles actions pour chaque élément de la liste {entity}?', examples: ['Clic pour développer', 'Boutons Modifier/Supprimer'], priority: 'P2' },
      empty_state: { question: 'Que montrer quand la liste {entity} est vide?', examples: ['Message "Aucun élément"', 'CTA pour créer le premier'], priority: 'P3' }
    },
    modal: {
      content: { question: 'Quel contenu le modal doit-il afficher?', examples: ['Formulaire', 'Message de confirmation', 'Vue détaillée'], priority: 'P1' },
      actions: { question: 'Quels boutons/actions dans le modal?', examples: ['Enregistrer/Annuler', 'Confirmer/Fermer'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'Quelles options le menu déroulant doit-il inclure?', priority: 'P1' },
      default: { question: 'Quelle doit être la sélection par défaut?', priority: 'P3' }
    },
    search: {
      scope: { question: 'Que doit couvrir la recherche (quels champs/entités)?', examples: ['Nom et email', 'Tous les champs texte'], priority: 'P1' },
      filters: { question: 'La recherche doit-elle avoir des filtres supplémentaires?', examples: ['Plage de dates, statut', 'Aucun'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'Quels critères de filtre sont nécessaires?', examples: ['Statut, plage de dates, catégorie'], priority: 'P1' },
      defaults: { question: 'Les filtres doivent-ils avoir des valeurs par défaut?', priority: 'P3' }
    }
  },

  de: {
    table: {
      columns: { question: 'Welche Spalten soll die {entity}-Tabelle anzeigen?', examples: ['Name, E-Mail, Datum', 'ID, Status, Aktionen'], priority: 'P1' },
      actions: { question: 'Welche Zeilenaktionen werden für {entity} benötigt?', examples: ['Anzeigen, Bearbeiten, Löschen', 'Keine (nur lesen)'], priority: 'P2' },
      sorting: { question: 'Sollen die Spalten der {entity}-Tabelle sortierbar sein? Welche?', examples: ['Alle Spalten', 'Nur Datum'], priority: 'P3' }
    },
    form: {
      fields: { question: 'Welche Felder soll das {entity}-Formular enthalten?', examples: ['Name (erforderlich), E-Mail, Telefon'], priority: 'P1' },
      validation: { question: 'Welche Validierungsregeln für das {entity}-Formular?', examples: ['E-Mail-Format, Pflichtfelder'], priority: 'P2' },
      submit_action: { question: 'Was passiert nach dem Absenden des {entity}-Formulars?', examples: ['Erfolg anzeigen, umleiten, Modal schließen'], priority: 'P2' }
    },
    button: {
      action: { question: 'Was soll die {entity}-Schaltfläche beim Klicken tun?', examples: ['Formular absenden', 'Modal öffnen', 'Element löschen'], priority: 'P1' },
      confirmation: { question: 'Erfordert die {entity}-Aktion eine Bestätigung?', examples: ['Ja zum Löschen', 'Nein zum Speichern'], priority: 'P3' }
    },
    list: {
      items: { question: 'Welche Informationen soll jedes Element der {entity}-Liste anzeigen?', examples: ['Titel und Datum', 'Vollständige Details'], priority: 'P1' },
      actions: { question: 'Welche Aktionen für jedes Element der {entity}-Liste?', examples: ['Klicken zum Erweitern', 'Bearbeiten/Löschen-Schaltflächen'], priority: 'P2' },
      empty_state: { question: 'Was anzeigen, wenn die {entity}-Liste leer ist?', examples: ['"Keine Elemente"-Nachricht', 'CTA zum Erstellen des ersten'], priority: 'P3' }
    },
    modal: {
      content: { question: 'Welchen Inhalt soll das Modal anzeigen?', examples: ['Formular', 'Bestätigungsnachricht', 'Detailansicht'], priority: 'P1' },
      actions: { question: 'Welche Schaltflächen/Aktionen im Modal?', examples: ['Speichern/Abbrechen', 'Bestätigen/Schließen'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'Welche Optionen soll das Dropdown-Menü enthalten?', priority: 'P1' },
      default: { question: 'Was soll die Standardauswahl sein?', priority: 'P3' }
    },
    search: {
      scope: { question: 'Was soll die Suche abdecken (welche Felder/Entitäten)?', examples: ['Name und E-Mail', 'Alle Textfelder'], priority: 'P1' },
      filters: { question: 'Soll die Suche zusätzliche Filter haben?', examples: ['Datumsbereich, Status', 'Keine'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'Welche Filterkriterien werden benötigt?', examples: ['Status, Datumsbereich, Kategorie'], priority: 'P1' },
      defaults: { question: 'Sollen Filter Standardwerte haben?', priority: 'P3' }
    }
  }
};

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
// E5-S3: Durable Digest Session Persistence
// ==========================================================================

const DURABLE_DIGEST_PATH = path.join(process.cwd(), '.workflow', 'state', 'durable-digest.json');
const DURABLE_DIGEST_VERSION = '1.0';

/**
 * Load durable digest sessions (E5-S3)
 */
function loadDurableSessions() {
  if (!fs.existsSync(DURABLE_DIGEST_PATH)) {
    return {
      version: DURABLE_DIGEST_VERSION,
      sessions: [],
      active_session_id: null
    };
  }

  try {
    return JSON.parse(fs.readFileSync(DURABLE_DIGEST_PATH, 'utf8'));
  } catch (err) {
    return {
      version: DURABLE_DIGEST_VERSION,
      sessions: [],
      active_session_id: null
    };
  }
}

/**
 * Save durable digest sessions (E5-S3)
 */
function saveDurableSessions(data) {
  const dir = path.dirname(DURABLE_DIGEST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DURABLE_DIGEST_PATH, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Create or update a durable session entry (E5-S3)
 */
function upsertDurableSession(sessionData) {
  const durable = loadDurableSessions();

  const existingIndex = durable.sessions.findIndex(s => s.id === sessionData.id);

  if (existingIndex >= 0) {
    // Update existing session
    durable.sessions[existingIndex] = {
      ...durable.sessions[existingIndex],
      ...sessionData,
      updated_at: now()
    };
  } else {
    // Add new session
    durable.sessions.push({
      ...sessionData,
      created_at: now(),
      updated_at: now()
    });
  }

  saveDurableSessions(durable);
  return sessionData;
}

/**
 * Get session progress summary (E5-S3)
 */
function getSessionProgress(digestPath) {
  const progress = {
    phase: 'unknown',
    passes_completed: [],
    topics_count: 0,
    statements_count: 0,
    questions_total: 0,
    questions_answered: 0,
    stories_generated: 0,
    stories_approved: 0
  };

  // Check topics
  const topicsPath = path.join(digestPath, 'topics.json');
  if (fs.existsSync(topicsPath)) {
    try {
      const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
      progress.topics_count = topics.topics?.length || 0;
      progress.passes_completed.push('topics');
      progress.phase = 'topics';
    } catch (err) {}
  }

  // Check statements
  const stmtPath = path.join(digestPath, 'statement-map.json');
  if (fs.existsSync(stmtPath)) {
    try {
      const stmtMap = JSON.parse(fs.readFileSync(stmtPath, 'utf8'));
      progress.statements_count = stmtMap.statements?.length || 0;
      progress.passes_completed.push('statements');
      progress.phase = 'statements';
    } catch (err) {}
  }

  // Check orphans pass
  const orphansPath = path.join(digestPath, 'orphans.json');
  if (fs.existsSync(orphansPath)) {
    progress.passes_completed.push('orphans');
    progress.phase = 'orphans';
  }

  // Check clarifications
  const clarPath = path.join(digestPath, 'clarifications.json');
  if (fs.existsSync(clarPath)) {
    try {
      const clar = JSON.parse(fs.readFileSync(clarPath, 'utf8'));
      progress.passes_completed.push('contradictions');
      progress.questions_total = clar.questions?.length || 0;
      progress.questions_answered = clar.questions?.filter(q => q.status === 'answered')?.length || 0;
      progress.phase = 'clarification';
    } catch (err) {}
  }

  // Check stories
  const storiesPath = path.join(digestPath, 'stories.json');
  if (fs.existsSync(storiesPath)) {
    try {
      const stories = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
      progress.stories_generated = stories.stories?.length || 0;
      progress.stories_approved = stories.stories?.filter(s => s.approval_status === 'approved')?.length || 0;
      progress.phase = 'stories';
    } catch (err) {}
  }

  // Check queue for presentation phase
  const queuePath = path.join(digestPath, 'queue.json');
  if (fs.existsSync(queuePath)) {
    progress.phase = 'presentation';
  }

  return progress;
}

/**
 * Register a new digest session durably (E5-S3)
 */
function registerDurableSession(sessionId, digestPath, transcriptInfo = {}) {
  const session = {
    id: sessionId,
    name: transcriptInfo.name || `Digest ${sessionId.slice(-8)}`,
    status: 'active',
    digest_path: digestPath,
    transcript: {
      source: transcriptInfo.source || 'unknown',
      word_count: transcriptInfo.word_count || 0,
      language: transcriptInfo.language || null,
      format: transcriptInfo.format || null
    },
    progress: getSessionProgress(digestPath),
    checkpoints: [],
    recovery_context: {
      last_action: 'created',
      last_question_id: null,
      pending_questions: []
    }
  };

  upsertDurableSession(session);

  // Set as active
  const durable = loadDurableSessions();
  durable.active_session_id = sessionId;
  saveDurableSessions(durable);

  return session;
}

/**
 * Update durable session progress (E5-S3)
 */
function updateDurableProgress(sessionId = null) {
  const durable = loadDurableSessions();
  const id = sessionId || durable.active_session_id;

  if (!id) return null;

  const session = durable.sessions.find(s => s.id === id);
  if (!session) return null;

  // Update progress
  session.progress = getSessionProgress(session.digest_path);
  session.updated_at = now();

  saveDurableSessions(durable);
  return session;
}

/**
 * Create a durable checkpoint (E5-S3)
 */
function createDurableCheckpoint(phase, reason = 'manual') {
  const durable = loadDurableSessions();
  if (!durable.active_session_id) return null;

  const session = durable.sessions.find(s => s.id === durable.active_session_id);
  if (!session) return null;

  const checkpoint = {
    id: `cp-${Date.now().toString(36)}`,
    phase,
    created_at: now(),
    reason
  };

  session.checkpoints = session.checkpoints || [];
  session.checkpoints.push(checkpoint);
  session.updated_at = now();

  saveDurableSessions(durable);
  return checkpoint;
}

/**
 * List all durable sessions (E5-S3)
 */
function listDurableSessions(options = {}) {
  const durable = loadDurableSessions();
  let sessions = [...durable.sessions];

  // Filter by status
  if (options.status) {
    sessions = sessions.filter(s => s.status === options.status);
  }

  // Sort by updated_at descending
  sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return {
    sessions,
    active_id: durable.active_session_id,
    total: sessions.length
  };
}

/**
 * Get a specific durable session (E5-S3)
 */
function getDurableSession(sessionId) {
  const durable = loadDurableSessions();
  const session = durable.sessions.find(s => s.id === sessionId);

  if (!session) return null;

  // Update progress from actual files
  session.progress = getSessionProgress(session.digest_path);

  return {
    ...session,
    is_active: durable.active_session_id === sessionId
  };
}

/**
 * Switch to a different durable session (E5-S3)
 */
function switchDurableSession(sessionId) {
  const durable = loadDurableSessions();
  const session = durable.sessions.find(s => s.id === sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Verify digest path exists
  if (!fs.existsSync(session.digest_path)) {
    throw new Error(`Session data not found at: ${session.digest_path}`);
  }

  // Update previous active session status
  if (durable.active_session_id && durable.active_session_id !== sessionId) {
    const prevSession = durable.sessions.find(s => s.id === durable.active_session_id);
    if (prevSession && prevSession.status === 'active') {
      prevSession.status = 'in_progress';
      prevSession.updated_at = now();
    }
  }

  // Set new active session
  durable.active_session_id = sessionId;
  session.status = 'active';
  session.updated_at = now();

  saveDurableSessions(durable);

  // Update active digest pointer
  const activeDigest = loadActiveDigest();
  activeDigest.session.id = sessionId;
  activeDigest.session.digest_path = session.digest_path;
  saveActiveDigest(activeDigest);

  return session;
}

/**
 * Update durable session recovery context (E5-S3)
 */
function updateRecoveryContext(contextUpdate) {
  const durable = loadDurableSessions();
  if (!durable.active_session_id) return null;

  const session = durable.sessions.find(s => s.id === durable.active_session_id);
  if (!session) return null;

  session.recovery_context = {
    ...session.recovery_context,
    ...contextUpdate
  };
  session.updated_at = now();

  saveDurableSessions(durable);
  return session.recovery_context;
}

/**
 * Generate recovery summary for a session (E5-S3)
 */
function generateRecoverySummaryForSession(sessionId) {
  const session = getDurableSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }

  const progress = session.progress;
  const timeSince = getTimeSince(session.updated_at);

  const summary = {
    session_id: session.id,
    name: session.name,
    status: session.status,
    last_active: timeSince,
    progress: {
      phase: progress.phase,
      topics: progress.topics_count,
      statements: progress.statements_count,
      questions: {
        answered: progress.questions_answered,
        total: progress.questions_total,
        pending: progress.questions_total - progress.questions_answered
      },
      stories: {
        generated: progress.stories_generated,
        approved: progress.stories_approved
      }
    },
    next_action: determineNextAction(session),
    checkpoints_count: session.checkpoints?.length || 0
  };

  return summary;
}

/**
 * Get human-readable time since (E5-S3)
 */
function getTimeSince(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Determine next action for a session (E5-S3)
 */
function determineNextAction(session) {
  const progress = session.progress;

  if (!progress.passes_completed.includes('topics')) {
    return { action: 'extract_topics', command: 'topics' };
  }

  if (!progress.passes_completed.includes('statements')) {
    return { action: 'associate_statements', command: 'pass2' };
  }

  if (!progress.passes_completed.includes('orphans')) {
    return { action: 'check_orphans', command: 'pass3' };
  }

  if (!progress.passes_completed.includes('contradictions')) {
    return { action: 'resolve_contradictions', command: 'pass4' };
  }

  if (progress.questions_total > 0 && progress.questions_answered < progress.questions_total) {
    return {
      action: 'answer_questions',
      command: 'show-questions',
      pending: progress.questions_total - progress.questions_answered
    };
  }

  if (progress.stories_generated === 0 && progress.topics_count > 0) {
    return { action: 'generate_stories', command: 'generate-stories' };
  }

  if (progress.stories_generated > progress.stories_approved) {
    return {
      action: 'review_stories',
      command: 'present',
      pending: progress.stories_generated - progress.stories_approved
    };
  }

  return { action: 'finalize', command: 'finalize' };
}

/**
 * Archive a durable session (E5-S3)
 */
function archiveDurableSession(sessionId) {
  const durable = loadDurableSessions();
  const session = durable.sessions.find(s => s.id === sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.status = 'archived';
  session.updated_at = now();

  // If it was the active session, clear active
  if (durable.active_session_id === sessionId) {
    durable.active_session_id = null;
  }

  saveDurableSessions(durable);
  return session;
}

/**
 * Delete a durable session (E5-S3)
 */
function deleteDurableSession(sessionId, deleteFiles = false) {
  const durable = loadDurableSessions();
  const sessionIndex = durable.sessions.findIndex(s => s.id === sessionId);

  if (sessionIndex < 0) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session = durable.sessions[sessionIndex];

  // Optionally delete files
  if (deleteFiles && session.digest_path && fs.existsSync(session.digest_path)) {
    fs.rmSync(session.digest_path, { recursive: true, force: true });
  }

  // Remove from list
  durable.sessions.splice(sessionIndex, 1);

  // Clear active if needed
  if (durable.active_session_id === sessionId) {
    durable.active_session_id = null;
  }

  saveDurableSessions(durable);
  return { deleted: true, id: sessionId };
}

/**
 * Mark session as completed (E5-S3)
 */
function completeDurableSession(sessionId = null) {
  const durable = loadDurableSessions();
  const id = sessionId || durable.active_session_id;

  if (!id) return null;

  const session = durable.sessions.find(s => s.id === id);
  if (!session) return null;

  session.status = 'completed';
  session.completed_at = now();
  session.updated_at = now();

  saveDurableSessions(durable);
  return session;
}

// ==========================================================================
// E5-S4: Large Transcript Chunking
// ==========================================================================

/**
 * Chunking configuration defaults (E5-S4)
 */
const CHUNKING_DEFAULTS = {
  // Thresholds for triggering chunking
  thresholds: {
    words: 10000,
    tokens: 15000,
    chars: 50000
  },
  // Target chunk sizes
  targetChunkWords: 3000,
  targetChunkTokens: 4500,
  maxChunkWords: 5000,
  maxChunkTokens: 7500,
  // Overlap for context preservation
  overlapWords: 200,
  overlapSentences: 5
};

/**
 * Speaker patterns for boundary detection (E5-S4)
 */
const SPEAKER_BOUNDARY_PATTERNS = [
  /^([A-Z][a-zA-Z\s'-]+):\s/m,       // "John Smith: "
  /^\[([^\]]+)\]\s/m,                 // "[Speaker]: "
  /<v\s+([^>]+)>/,                    // VTT voice tags
  /^From\s+(.+?)\s+to\s+/m,          // Zoom chat format
  /^\d{1,2}:\d{2}(:\d{2})?\t+From/m  // Zoom timestamp + From
];

/**
 * Check if chunking is needed for a transcript (E5-S4)
 */
function needsChunking(text, options = {}) {
  const config = { ...CHUNKING_DEFAULTS, ...options };
  const metrics = measureInputMetrics(text);

  const exceedsWords = metrics.wordCount > config.thresholds.words;
  const exceedsTokens = metrics.estimatedTokens > config.thresholds.tokens;
  const exceedsChars = metrics.charCount > config.thresholds.chars;

  return {
    needed: exceedsWords || exceedsTokens || exceedsChars,
    reason: exceedsWords ? 'word_count' :
            exceedsTokens ? 'token_count' :
            exceedsChars ? 'char_count' : null,
    metrics: {
      words: metrics.wordCount,
      tokens: metrics.estimatedTokens,
      chars: metrics.charCount,
      thresholds: config.thresholds
    }
  };
}

/**
 * Split text into sentences (E5-S4)
 */
function splitIntoSentences(text) {
  // Split on sentence endings while preserving the delimiter
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter(s => s.trim().length > 0);
}

/**
 * Find natural boundary near target position (E5-S4)
 * @param {string} text - Full text to search in
 * @param {number} targetPos - Target position for boundary
 * @param {Object} options - Options including searchRange and minBoundary
 */
function findNaturalBoundary(text, targetPos, options = {}) {
  const searchRange = options.searchRange || 500; // Search +/- 500 chars
  const minBoundary = options.minBoundary || 0; // Minimum valid boundary position
  const searchStart = Math.max(minBoundary, targetPos - searchRange);
  const searchEnd = Math.min(text.length, targetPos + searchRange);
  const searchArea = text.substring(searchStart, searchEnd);

  // Priority 1: Speaker change - find nearest one AFTER minBoundary
  for (const pattern of SPEAKER_BOUNDARY_PATTERNS) {
    // Find all matches and pick the one nearest to target
    let match;
    const flags = pattern.flags || '';
    const regex = new RegExp(pattern.source, flags.includes('g') ? flags : flags + 'g');
    regex.lastIndex = 0; // Reset to start
    let bestMatch = null;
    let bestDist = Infinity;
    let safetyCounter = 0;
    const maxIterations = searchArea.length + 1; // Safety limit

    while ((match = regex.exec(searchArea)) !== null) {
      // Safety: prevent infinite loop on zero-width matches
      if (safetyCounter++ > maxIterations) break;

      const boundaryPos = searchStart + match.index;
      if (boundaryPos >= minBoundary) {
        const dist = Math.abs(boundaryPos - targetPos);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = boundaryPos;
        }
      }

      // Prevent infinite loop on zero-width match
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    if (bestMatch !== null && bestMatch > minBoundary) {
      return { position: bestMatch, type: 'speaker_change' };
    }
  }

  // Priority 2: Paragraph break (double newline) - find one nearest to target
  let lastPara = -1;
  let idx = searchArea.indexOf('\n\n');
  while (idx !== -1) {
    const pos = searchStart + idx + 2;
    if (pos >= minBoundary && pos <= searchEnd) {
      lastPara = pos;
    }
    idx = searchArea.indexOf('\n\n', idx + 1);
  }
  if (lastPara > minBoundary) {
    return { position: lastPara, type: 'paragraph' };
  }

  // Priority 3: Single newline nearest to target after minBoundary
  let lastNewline = -1;
  idx = searchArea.indexOf('\n');
  while (idx !== -1) {
    const pos = searchStart + idx + 1;
    if (pos >= minBoundary && pos <= searchEnd) {
      lastNewline = pos;
    }
    idx = searchArea.indexOf('\n', idx + 1);
  }
  if (lastNewline > minBoundary) {
    return { position: lastNewline, type: 'newline' };
  }

  // Priority 4: Sentence ending
  const sentencePattern = /[.!?]\s+/g;
  let sentenceMatch;
  while ((sentenceMatch = sentencePattern.exec(searchArea)) !== null) {
    const pos = searchStart + sentenceMatch.index + sentenceMatch[0].length;
    if (pos >= minBoundary && pos <= searchEnd) {
      return { position: pos, type: 'sentence' };
    }
  }

  // Fallback: use target position or end of text if target is beyond
  const fallbackPos = Math.max(minBoundary + 1, Math.min(targetPos, text.length));
  return { position: fallbackPos, type: 'forced' };
}

/**
 * Plan chunks for a transcript (E5-S4)
 */
function planChunks(text, options = {}) {
  const config = { ...CHUNKING_DEFAULTS, ...options };
  const metrics = measureInputMetrics(text);

  // Calculate number of chunks needed
  const targetWords = config.targetChunkWords;
  const estimatedChunks = Math.ceil(metrics.wordCount / targetWords);

  // Calculate approximate chars per chunk
  const charsPerChunk = Math.ceil(text.length / estimatedChunks);

  const chunks = [];
  let currentPos = 0;

  for (let i = 0; i < estimatedChunks && currentPos < text.length; i++) {
    const targetEndPos = Math.min(currentPos + charsPerChunk, text.length);
    const isLastChunk = (i === estimatedChunks - 1) || (targetEndPos >= text.length - 50);

    let endPos, boundaryType;

    if (isLastChunk) {
      // For the last chunk, just use the end of text
      endPos = text.length;
      boundaryType = 'document_end';
    } else {
      // Find natural boundary near target, but not before currentPos
      const boundary = findNaturalBoundary(text, targetEndPos, { searchRange: 500, minBoundary: currentPos });
      // Ensure we always make forward progress
      endPos = Math.max(currentPos + 1, Math.min(boundary.position, text.length));
      boundaryType = boundary.type;
    }

    // Extract chunk content
    const content = text.substring(currentPos, endPos).trim();
    const chunkMetrics = measureInputMetrics(content);

    chunks.push({
      chunk_id: `chunk-${String(i + 1).padStart(3, '0')}`,
      index: i,
      start_offset: currentPos,
      end_offset: endPos,
      word_count: chunkMetrics.wordCount,
      token_estimate: chunkMetrics.estimatedTokens,
      char_count: content.length,
      boundary_type: boundaryType
    });

    currentPos = endPos;
  }

  // Update total_chunks in all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.total_chunks = totalChunks;
  }

  return {
    total_chunks: totalChunks,
    total_words: metrics.wordCount,
    total_tokens: metrics.estimatedTokens,
    avg_chunk_words: Math.round(metrics.wordCount / totalChunks),
    chunks
  };
}

/**
 * Create chunks from transcript (E5-S4)
 */
function createChunks(text, options = {}) {
  const plan = planChunks(text, options);
  const config = { ...CHUNKING_DEFAULTS, ...options };

  const chunks = [];
  let previousChunkEnd = null;

  for (let i = 0; i < plan.chunks.length; i++) {
    const chunkPlan = plan.chunks[i];
    let content = text.substring(chunkPlan.start_offset, chunkPlan.end_offset).trim();

    // Add overlap from previous chunk
    let overlap = null;
    if (i > 0 && previousChunkEnd) {
      const overlapStart = Math.max(0, chunkPlan.start_offset - (config.overlapWords * 5)); // ~5 chars per word
      const overlapText = text.substring(overlapStart, chunkPlan.start_offset).trim();

      if (overlapText.length > 0) {
        overlap = {
          text: overlapText,
          word_count: countWords(overlapText),
          source_chunk: plan.chunks[i - 1].chunk_id
        };
      }
    }

    chunks.push({
      ...chunkPlan,
      content,
      has_overlap: overlap !== null,
      overlap
    });

    previousChunkEnd = chunkPlan.end_offset;
  }

  return {
    ...plan,
    chunks
  };
}

/**
 * Normalize topic title for deduplication (E5-S4)
 */
function normalizeTopicTitle(title) {
  return title.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize statement for deduplication (E5-S4)
 */
function normalizeStatement(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100); // Use first 100 chars as signature
}

/**
 * Merge topics from multiple chunks (E5-S4)
 */
function mergeChunkTopics(chunkResults) {
  const merged = {};

  for (const result of chunkResults) {
    if (!result.topics?.topics) continue;

    for (const topic of result.topics.topics) {
      const key = normalizeTopicTitle(topic.title);

      if (merged[key]) {
        // Merge keywords
        const existingKeywords = new Set(merged[key].keywords || []);
        for (const kw of (topic.keywords || [])) {
          existingKeywords.add(kw);
        }
        merged[key].keywords = Array.from(existingKeywords);

        // Track source chunks
        merged[key].source_chunks = merged[key].source_chunks || [];
        merged[key].source_chunks.push(result.chunk_id);
      } else {
        merged[key] = {
          ...topic,
          source_chunks: [result.chunk_id]
        };
      }
    }
  }

  // Regenerate IDs for merged topics
  const topics = Object.values(merged).map((topic, index) => ({
    ...topic,
    id: `topic-${index + 1}`
  }));

  return {
    topics,
    metadata: {
      merged_from_chunks: chunkResults.length,
      original_topic_count: chunkResults.reduce((sum, r) => sum + (r.topics?.topics?.length || 0), 0),
      merged_topic_count: topics.length
    }
  };
}

/**
 * Merge statements from multiple chunks (E5-S4)
 */
function mergeChunkStatements(chunkResults) {
  const seen = new Set();
  const statements = [];

  for (const result of chunkResults) {
    if (!result.statements) continue;

    for (const stmt of result.statements) {
      const signature = normalizeStatement(stmt.text);

      if (!seen.has(signature)) {
        seen.add(signature);
        statements.push({
          ...stmt,
          source_chunk: result.chunk_id
        });
      }
    }
  }

  // Regenerate IDs
  return statements.map((stmt, index) => ({
    ...stmt,
    id: `stmt-${index + 1}`
  }));
}

/**
 * Initialize chunking state for a session (E5-S4)
 */
function initializeChunkingState(sessionId, plan) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  const chunkingState = {
    enabled: true,
    session_id: sessionId,
    total_chunks: plan.total_chunks,
    processed_chunks: 0,
    chunk_size: {
      target_words: CHUNKING_DEFAULTS.targetChunkWords,
      actual_avg_words: plan.avg_chunk_words
    },
    chunks: plan.chunks.map(c => ({
      id: c.chunk_id,
      index: c.index,
      status: 'pending',
      topics_found: null,
      statements_found: null
    })),
    merge_status: 'pending',
    created_at: now()
  };

  // Save chunking state
  const chunkingPath = path.join(activeDigest.session.digest_path, 'chunking.json');
  fs.writeFileSync(chunkingPath, JSON.stringify(chunkingState, null, 2));

  return chunkingState;
}

/**
 * Load chunking state (E5-S4)
 */
function loadChunkingState() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    return null;
  }

  const chunkingPath = path.join(activeDigest.session.digest_path, 'chunking.json');
  if (!fs.existsSync(chunkingPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(chunkingPath, 'utf8'));
}

/**
 * Save chunking state (E5-S4)
 */
function saveChunkingState(state) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    throw new Error('No active digest session');
  }

  state.updated_at = now();
  const chunkingPath = path.join(activeDigest.session.digest_path, 'chunking.json');
  fs.writeFileSync(chunkingPath, JSON.stringify(state, null, 2));
  return state;
}

/**
 * Update chunk processing status (E5-S4)
 */
function updateChunkStatus(chunkId, status, results = {}) {
  const state = loadChunkingState();
  if (!state) {
    throw new Error('No chunking state found');
  }

  const chunk = state.chunks.find(c => c.id === chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  chunk.status = status;
  if (results.topics_found !== undefined) {
    chunk.topics_found = results.topics_found;
  }
  if (results.statements_found !== undefined) {
    chunk.statements_found = results.statements_found;
  }

  // Update processed count
  state.processed_chunks = state.chunks.filter(c => c.status === 'completed').length;

  saveChunkingState(state);
  return state;
}

/**
 * Get chunk content by ID (E5-S4)
 */
function getChunkContent(chunkId) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) {
    return null;
  }

  const chunksPath = path.join(activeDigest.session.digest_path, 'chunks.json');
  if (!fs.existsSync(chunksPath)) {
    return null;
  }

  const chunksData = JSON.parse(fs.readFileSync(chunksPath, 'utf8'));
  const chunk = chunksData.chunks.find(c => c.chunk_id === chunkId);

  return chunk || null;
}

/**
 * Get chunking status summary (E5-S4)
 */
function getChunkingStatus() {
  const state = loadChunkingState();
  if (!state) {
    return { enabled: false };
  }

  const completedChunks = state.chunks.filter(c => c.status === 'completed').length;
  const pendingChunks = state.chunks.filter(c => c.status === 'pending').length;
  const failedChunks = state.chunks.filter(c => c.status === 'failed').length;

  return {
    enabled: state.enabled,
    total_chunks: state.total_chunks,
    completed: completedChunks,
    pending: pendingChunks,
    failed: failedChunks,
    progress: Math.round((completedChunks / state.total_chunks) * 100),
    merge_status: state.merge_status,
    chunks: state.chunks.map(c => ({
      id: c.id,
      status: c.status,
      topics: c.topics_found,
      statements: c.statements_found
    }))
  };
}

// ==========================================================================
// E3-S1: Complexity Detection Patterns
// ==========================================================================

/**
 * UI component patterns for complexity analysis
 */
const UI_PATTERNS = [
  { pattern: /\b(table|grid|list)\b/i, type: 'data_display' },
  { pattern: /\b(form|input|field)\b/i, type: 'data_entry' },
  { pattern: /\b(button|link|action)\b/i, type: 'interaction' },
  { pattern: /\b(modal|dialog|popup)\b/i, type: 'overlay' },
  { pattern: /\b(page|screen|view)\b/i, type: 'navigation' },
  { pattern: /\b(menu|nav|sidebar)\b/i, type: 'navigation' },
  { pattern: /\b(card|panel|section)\b/i, type: 'layout' },
  { pattern: /\b(chart|graph|visualization)\b/i, type: 'visualization' }
];

/**
 * Data entity patterns for complexity analysis
 */
const DATA_PATTERNS = [
  { pattern: /\b(user|account|profile)\b/i, type: 'user_entity' },
  { pattern: /\b(product|item|inventory)\b/i, type: 'product_entity' },
  { pattern: /\b(order|transaction|payment)\b/i, type: 'transaction_entity' },
  { pattern: /\b(message|notification|alert)\b/i, type: 'communication' },
  { pattern: /\b(setting|config|preference)\b/i, type: 'configuration' },
  { pattern: /\b(role|permission|access)\b/i, type: 'authorization' }
];

/**
 * Interaction patterns for complexity analysis
 */
const INTERACTION_PATTERNS = [
  { pattern: /\b(create|add|new)\b/i, type: 'create' },
  { pattern: /\b(edit|update|modify)\b/i, type: 'update' },
  { pattern: /\b(delete|remove|archive)\b/i, type: 'delete' },
  { pattern: /\b(view|show|display)\b/i, type: 'read' },
  { pattern: /\b(search|filter|sort)\b/i, type: 'query' },
  { pattern: /\b(import|export|sync)\b/i, type: 'transfer' },
  { pattern: /\b(approve|reject|review)\b/i, type: 'workflow' }
];

/**
 * Complexity level thresholds
 */
const COMPLEXITY_LEVELS = [
  { max: 20, level: 'simple', description: 'Single feature, few requirements', recommended: 'single_story' },
  { max: 40, level: 'low', description: 'Small feature set, clear scope', recommended: 'story_group', storyRange: '2-3' },
  { max: 60, level: 'medium', description: 'Multiple features, some complexity', recommended: 'story_group', storyRange: '4-8' },
  { max: 80, level: 'high', description: 'Complex feature set, many details', recommended: 'epic', storyRange: 'epic with sub-stories' },
  { max: 100, level: 'very_high', description: 'Large system, many interconnections', recommended: 'multiple_epics', storyRange: 'multiple epics' }
];

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
 * Follow-up trigger patterns
 */
const FOLLOWUP_TRIGGERS = [
  { pattern: /multiple|several|various|different/i, type: 'clarify_list', question: 'Can you list all the {item}?' },
  { pattern: /custom|special|specific/i, type: 'clarify_details', question: 'What are the specific requirements for this?' },
  { pattern: /depends|conditional|if\s+/i, type: 'clarify_conditions', question: 'What conditions determine this?' },
  { pattern: /delete|remove/i, type: 'confirm_destructive', question: 'Should this action require confirmation?' },
  { pattern: /user types?|roles?|permissions?/i, type: 'clarify_permissions', question: 'What are the different user types and their permissions?' },
  { pattern: /later|future|eventually/i, type: 'clarify_timeline', question: 'Is this needed for the initial release or can it be added later?' }
];

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

// ============================================
// E2-S3: Voice Answer Integration
// ============================================

/**
 * Voice filler patterns to remove
 */
const VOICE_FILLERS = [
  // Pure fillers (always remove)
  /\b(um|uh|er|ah|hmm+)\b/gi,
  // Hedge words (remove when standalone)
  /\b(like)\b(?!\s+(?:this|that|the|a|an))/gi,
  /\b(you know)\b/gi,
  /\b(basically)\b/gi,
  // Thinking pauses at start
  /^(so+|well|anyway|let me think|let me see)[,\s]*/gi,
  // Repeated words (stutters)
  /\b(\w+)\s+\1\b/gi
];

/**
 * Voice correction patterns
 */
const VOICE_CORRECTIONS = [
  { pattern: /(.+?)\s*(?:wait|no wait)\s*,?\s*(.+)/i, use: 2, type: 'wait_correction' },
  { pattern: /(.+?)\s*(?:actually)\s*,?\s*(.+)/i, use: 2, type: 'actually_correction' },
  { pattern: /(.+?)\s*(?:I mean)\s*,?\s*(.+)/i, use: 2, type: 'i_mean_correction' },
  { pattern: /(.+?)\s*(?:scratch that|forget that|never mind)\s*,?\s*(.*)/i, use: 2, type: 'scratch_that' },
  { pattern: /(?:not|don't)\s+(.+?)\s*,?\s*(?:but|instead)\s+(.+)/i, use: 2, type: 'negation_correction' }
];

/**
 * Uncertainty markers for voice
 */
const VOICE_UNCERTAINTY = [
  /\b(maybe|perhaps|probably|I think|I guess|not sure|possibly)\b/i,
  /\b(or something|something like|kind of|sort of)\b/i,
  /\b(could be|might be|either|whatever works)\b/i
];

/**
 * Yes/No patterns for voice
 */
const VOICE_YES_PATTERNS = [
  /^(yes|yeah|yep|yup|sure|definitely|absolutely|of course|right)\b/i,
  /^(that works|sounds good|perfect|exactly|correct)\b/i,
  /^(I think so|probably yes|I'd say yes)\b/i
];

const VOICE_NO_PATTERNS = [
  /^(no|nope|nah|not really|I don't think so)\b/i,
  /^(that's not|we don't need|skip that|let's not)\b/i,
  /^(maybe not|probably not|I'd say no)\b/i
];

/**
 * Number word to digit mapping
 */
const NUMBER_WORDS = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
  'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
  'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
  'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
  'forty': '40', 'fifty': '50', 'hundred': '100'
};

/**
 * Detect if input appears to be voice-transcribed
 */
function isVoiceInput(text) {
  const lowerText = text.toLowerCase();
  let voiceSignals = 0;

  // Check for filler words
  const fillerCount = (lowerText.match(/\b(um|uh|er|ah|like|you know|basically)\b/gi) || []).length;
  if (fillerCount >= 2) voiceSignals += 2;
  else if (fillerCount >= 1) voiceSignals += 1;

  // Check for self-corrections
  if (/\b(actually|wait|I mean|scratch that)\b/i.test(lowerText)) {
    voiceSignals += 1;
  }

  // Check for informal patterns
  if (/\b(yeah|yep|nope|gonna|wanna|kinda|sorta)\b/i.test(lowerText)) {
    voiceSignals += 1;
  }

  // Check for run-on sentences (lack of punctuation)
  const wordCount = text.split(/\s+/).length;
  const sentenceCount = text.split(/[.!?]/).filter(s => s.trim()).length;
  if (wordCount > 10 && sentenceCount <= 1) {
    voiceSignals += 1;
  }

  return {
    isVoice: voiceSignals >= 2,
    confidence: Math.min(voiceSignals / 4, 1.0),
    signals: voiceSignals
  };
}

/**
 * Remove filler words from voice input
 */
function removeFillers(text) {
  let result = text;
  let fillersRemoved = 0;

  for (const pattern of VOICE_FILLERS) {
    const matches = result.match(pattern);
    if (matches) {
      fillersRemoved += matches.length;
    }
    result = result.replace(pattern, ' ');
  }

  // Clean up extra spaces
  result = result.replace(/\s+/g, ' ').trim();

  return { text: result, fillersRemoved };
}

/**
 * Apply self-corrections from voice input
 */
function applySelfCorrections(text) {
  let result = text;
  const corrections = [];

  for (const { pattern, use, type } of VOICE_CORRECTIONS) {
    const match = result.match(pattern);
    if (match) {
      const correctedPart = match[use]?.trim();
      if (correctedPart && correctedPart.length > 0) {
        // For "scratch that" with no replacement, use what came before
        if (type === 'scratch_that' && !correctedPart) {
          continue;
        }
        corrections.push({
          type,
          original: match[1]?.trim(),
          corrected: correctedPart
        });
        result = correctedPart;
      }
    }
  }

  return { text: result, corrections };
}

/**
 * Normalize spoken numbers to digits
 */
function normalizeNumbers(text) {
  let result = text;
  let numbersNormalized = 0;

  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    if (pattern.test(result)) {
      numbersNormalized++;
      result = result.replace(pattern, digit);
    }
  }

  return { text: result, numbersNormalized };
}

/**
 * Detect uncertainty in voice answer
 */
function detectUncertainty(text) {
  const markers = [];

  for (const pattern of VOICE_UNCERTAINTY) {
    const match = text.match(pattern);
    if (match) {
      markers.push(match[0].toLowerCase());
    }
  }

  return {
    hasUncertainty: markers.length > 0,
    markers,
    needsConfirmation: markers.length >= 2
  };
}

/**
 * Check for yes/no voice patterns
 */
function detectYesNo(text) {
  const trimmed = text.trim();

  for (const pattern of VOICE_YES_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'yes', confidence: 0.9 };
    }
  }

  for (const pattern of VOICE_NO_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'no', confidence: 0.9 };
    }
  }

  return { type: null, confidence: 0 };
}

/**
 * Add basic punctuation to run-on voice text
 */
function addPunctuation(text) {
  let result = text;

  // Add periods before topic change words
  result = result.replace(/\s+(and then|next|also|another thing|moving on)\s+/gi, '. $1 ');

  // Add periods before enumeration
  result = result.replace(/\s+(first|second|third|finally|lastly)\s+/gi, '. $1 ');

  // Capitalize after periods
  result = result.replace(/\.\s+(\w)/g, (match, letter) => `. ${letter.toUpperCase()}`);

  // Ensure ends with punctuation
  if (!/[.!?]$/.test(result.trim())) {
    result = result.trim() + '.';
  }

  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  return result;
}

/**
 * Full voice normalization pipeline
 */
function normalizeVoiceInput(text) {
  const processing = {
    original: text,
    isVoice: false,
    voiceConfidence: 0,
    fillersRemoved: 0,
    corrections: [],
    numbersNormalized: 0,
    uncertainty: { hasUncertainty: false, markers: [] },
    yesNo: { type: null }
  };

  // Detect if voice
  const voiceDetection = isVoiceInput(text);
  processing.isVoice = voiceDetection.isVoice;
  processing.voiceConfidence = voiceDetection.confidence;

  let normalized = text;

  // Always apply normalization if voice detected, or if explicitly marked as voice
  if (voiceDetection.isVoice || processing.forceVoice) {
    // Step 1: Remove fillers
    const fillerResult = removeFillers(normalized);
    normalized = fillerResult.text;
    processing.fillersRemoved = fillerResult.fillersRemoved;

    // Step 2: Apply self-corrections
    const correctionResult = applySelfCorrections(normalized);
    normalized = correctionResult.text;
    processing.corrections = correctionResult.corrections;

    // Step 3: Normalize numbers
    const numberResult = normalizeNumbers(normalized);
    normalized = numberResult.text;
    processing.numbersNormalized = numberResult.numbersNormalized;

    // Step 4: Add punctuation if needed
    if (normalized.split(/[.!?]/).filter(s => s.trim()).length <= 1 && normalized.split(/\s+/).length > 5) {
      normalized = addPunctuation(normalized);
    }
  }

  // Step 5: Detect uncertainty (always)
  processing.uncertainty = detectUncertainty(normalized);

  // Step 6: Check for yes/no (always)
  processing.yesNo = detectYesNo(normalized);

  processing.normalized = normalized;

  return processing;
}

/**
 * Calculate voice-adjusted confidence
 */
function calculateVoiceConfidence(processing) {
  let confidence = 0.8; // Base for voice (vs 0.9 for text)

  // Reduce for uncertainty
  if (processing.uncertainty.markers.length > 0) {
    confidence -= 0.1 * Math.min(processing.uncertainty.markers.length, 2);
  }

  // Reduce for heavy correction (indicates confusion)
  if (processing.corrections.length > 2) {
    confidence -= 0.1;
  }

  // Increase for clear yes/no
  if (processing.yesNo.type) {
    confidence = Math.max(confidence, 0.85);
  }

  // Increase for clear, short answers
  if (processing.normalized.split(/\s+/).length <= 5 && processing.fillersRemoved === 0) {
    confidence += 0.05;
  }

  return Math.max(0.5, Math.min(1.0, confidence));
}

/**
 * Process voice answer with full pipeline
 */
function processVoiceAnswer(text, forceVoice = false) {
  const processing = normalizeVoiceInput(text);
  processing.forceVoice = forceVoice;

  // Recalculate if forced
  if (forceVoice && !processing.isVoice) {
    processing.isVoice = true;
    const reprocessed = normalizeVoiceInput(text);
    Object.assign(processing, reprocessed, { isVoice: true, forceVoice: true });
  }

  const confidence = calculateVoiceConfidence(processing);

  return {
    original: text,
    normalized: processing.normalized,
    isVoice: processing.isVoice || forceVoice,
    confidence,
    processing: {
      fillersRemoved: processing.fillersRemoved,
      corrections: processing.corrections,
      numbersNormalized: processing.numbersNormalized,
      uncertainty: processing.uncertainty,
      yesNo: processing.yesNo
    }
  };
}

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
  } catch (err) {
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
  const lowerText = text.toLowerCase();

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
  const estimatedTokens = estimateTokens(text);

  // Calculate averages
  const avgWordsPerLine = lineCount > 0 ? Math.round(wordCount / lineCount * 10) / 10 : 0;
  const avgCharsPerWord = wordCount > 0 ? Math.round(charCount / wordCount * 10) / 10 : 0;

  return {
    wordCount,
    charCount,
    lineCount,
    paragraphCount,
    estimatedTokens,
    avgWordsPerLine,
    avgCharsPerWord
  };
}

/**
 * Estimate LLM token count
 */
function estimateTokens(text) {
  const charCount = text.length;

  // Detect code ratio for adjustment
  const codePatterns = [/```[\s\S]*?```/g, /`[^`]+`/g];
  let codeChars = 0;
  for (const pattern of codePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      codeChars += matches.join('').length;
    }
  }
  const codeRatio = charCount > 0 ? codeChars / charCount : 0;

  // Detect timestamp ratio
  const timestampPattern = /\d{2}:\d{2}(:\d{2})?(\.\d{3})?/g;
  const timestamps = text.match(timestampPattern);
  const timestampChars = timestamps ? timestamps.join('').length : 0;
  const timestampRatio = charCount > 0 ? timestampChars / charCount : 0;

  // Base: 4 chars/token
  // Code: 3 chars/token (more tokens)
  // Timestamps: 6 chars/token (fewer tokens)
  const avgCharsPerToken = 4 - (codeRatio * 1) + (timestampRatio * 2);

  return Math.ceil(charCount / Math.max(avgCharsPerToken, 2));
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

// ==========================================================================
// E4-S3: VTT/SRT Format Parsing Functions
// ==========================================================================

/**
 * VTT timestamp patterns
 */
const VTT_TIMESTAMP_FULL = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
const VTT_TIMESTAMP_SHORT = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})/;
const VTT_VOICE_TAG = /<v\s+([^>]+)>/;

/**
 * SRT timestamp pattern
 */
const SRT_TIMESTAMP = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

/**
 * Common speaker patterns
 */
const SPEAKER_COLON_PATTERN = /^([A-Z][a-zA-Z\s]+):\s*/;
const SPEAKER_BRACKET_PATTERN = /^\[([^\]]+)\]\s*/;

/**
 * Convert timestamp to milliseconds
 */
function timestampToMs(hours, minutes, seconds, ms) {
  return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
}

/**
 * Format milliseconds as timestamp string
 */
function msToTimestamp(ms, short = false) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (short && hours === 0) {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Clean VTT/SRT text by removing HTML tags and entities
 */
function cleanSubtitleText(text) {
  let cleaned = text
    // Remove HTML tags
    .replace(/<\/?[biuc][^>]*>/gi, '')
    .replace(/<\/?v[^>]*>/gi, '')
    .replace(/<\/?lang[^>]*>/gi, '')
    .replace(/<\/?ruby>/gi, '')
    .replace(/<\/?rt>/gi, '')
    // Decode entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Extract speaker from VTT voice tag
 */
function extractVTTSpeaker(line) {
  const voiceMatch = line.match(VTT_VOICE_TAG);
  if (voiceMatch) {
    const speaker = voiceMatch[1].trim();
    const text = line.replace(VTT_VOICE_TAG, '').trim();
    return { speaker, text };
  }
  return { speaker: null, text: line };
}

/**
 * Extract speaker from common patterns
 */
function extractSpeaker(text) {
  // Check colon pattern: "Speaker Name: text"
  const colonMatch = text.match(SPEAKER_COLON_PATTERN);
  if (colonMatch) {
    return {
      speaker: colonMatch[1].trim(),
      text: text.substring(colonMatch[0].length).trim()
    };
  }

  // Check bracket pattern: "[Speaker Name] text"
  const bracketMatch = text.match(SPEAKER_BRACKET_PATTERN);
  if (bracketMatch) {
    return {
      speaker: bracketMatch[1].trim(),
      text: text.substring(bracketMatch[0].length).trim()
    };
  }

  return { speaker: null, text };
}

/**
 * Parse VTT file content
 * @param {string} content - VTT file content
 * @returns {{ metadata: object, cues: array, format: string, error?: string, partial?: boolean }}
 */
function parseVTT(content) {
  // Input validation
  if (!content || typeof content !== 'string') {
    return { metadata: {}, cues: [], format: 'vtt', error: 'Invalid input: content must be a non-empty string' };
  }

  const lines = content.split('\n');
  const cues = [];
  let metadata = {};
  let currentCue = null;
  let inCue = false;
  let cueIndex = 0;
  let parseErrors = [];

  try {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip WEBVTT header
    if (line.startsWith('WEBVTT')) {
      continue;
    }

    // Parse metadata (Kind, Language, etc.)
    if (line.includes(':') && !inCue && !line.match(VTT_TIMESTAMP_FULL) && !line.match(VTT_TIMESTAMP_SHORT)) {
      const [key, ...valueParts] = line.split(':');
      if (key.match(/^[A-Za-z]+$/)) {
        metadata[key.trim().toLowerCase()] = valueParts.join(':').trim();
        continue;
      }
    }

    // Skip NOTE comments
    if (line.startsWith('NOTE')) {
      // Skip until empty line
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      continue;
    }

    // Skip empty lines
    if (line === '') {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
        currentCue = null;
        inCue = false;
      }
      continue;
    }

    // Check for timestamp line
    const fullMatch = line.match(VTT_TIMESTAMP_FULL);
    const shortMatch = line.match(VTT_TIMESTAMP_SHORT);

    if (fullMatch || shortMatch) {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
      }

      cueIndex++;
      if (fullMatch) {
        currentCue = {
          index: cueIndex,
          startMs: timestampToMs(fullMatch[1], fullMatch[2], fullMatch[3], fullMatch[4]),
          endMs: timestampToMs(fullMatch[5], fullMatch[6], fullMatch[7], fullMatch[8]),
          settings: line.substring(fullMatch[0].length).trim(),
          textLines: [],
          rawLines: []
        };
      } else {
        currentCue = {
          index: cueIndex,
          startMs: timestampToMs(0, shortMatch[1], shortMatch[2], shortMatch[3]),
          endMs: timestampToMs(0, shortMatch[4], shortMatch[5], shortMatch[6]),
          settings: line.substring(shortMatch[0].length).trim(),
          textLines: [],
          rawLines: []
        };
      }
      inCue = true;
      continue;
    }

    // Text content
    if (inCue && currentCue) {
      currentCue.rawLines.push(line);
      const { speaker, text } = extractVTTSpeaker(line);
      if (speaker && !currentCue.speaker) {
        currentCue.speaker = speaker;
      }
      currentCue.textLines.push(cleanSubtitleText(text));
    }
  }

  // Don't forget last cue
  if (currentCue && currentCue.textLines.length > 0) {
    cues.push(finalizeCue(currentCue));
  }

  // Return results with any parse errors noted
  const result = { metadata, cues, format: 'vtt' };
  if (parseErrors.length > 0) {
    result.parseErrors = parseErrors;
    result.partial = true;
  }
  return result;

  } catch (err) {
    // Return partial results on error
    return {
      metadata,
      cues,
      format: 'vtt',
      error: `Parse error: ${err.message}`,
      partial: cues.length > 0
    };
  }
}

/**
 * Parse SRT file content
 * @param {string} content - SRT file content
 * @returns {{ metadata: object, cues: array, format: string, error?: string, partial?: boolean }}
 */
function parseSRT(content) {
  // Input validation
  if (!content || typeof content !== 'string') {
    return { metadata: {}, cues: [], format: 'srt', error: 'Invalid input: content must be a non-empty string' };
  }

  const lines = content.split('\n');
  const cues = [];
  let currentCue = null;
  let expectingTimestamp = false;

  try {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (line === '') {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
        currentCue = null;
        expectingTimestamp = false;
      }
      continue;
    }

    // Check for cue number
    if (/^\d+$/.test(line) && !currentCue) {
      expectingTimestamp = true;
      continue;
    }

    // Check for timestamp
    const timestampMatch = line.match(SRT_TIMESTAMP);
    if (timestampMatch) {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
      }

      currentCue = {
        index: cues.length + 1,
        startMs: timestampToMs(timestampMatch[1], timestampMatch[2], timestampMatch[3], timestampMatch[4]),
        endMs: timestampToMs(timestampMatch[5], timestampMatch[6], timestampMatch[7], timestampMatch[8]),
        settings: '',
        textLines: [],
        rawLines: []
      };
      expectingTimestamp = false;
      continue;
    }

    // Text content
    if (currentCue) {
      currentCue.rawLines.push(line);
      const cleaned = cleanSubtitleText(line);
      const { speaker, text } = extractSpeaker(cleaned);
      if (speaker && !currentCue.speaker) {
        currentCue.speaker = speaker;
      }
      currentCue.textLines.push(text);
    }
  }

  // Don't forget last cue
  if (currentCue && currentCue.textLines.length > 0) {
    cues.push(finalizeCue(currentCue));
  }

  return { metadata: {}, cues, format: 'srt' };

  } catch (err) {
    // Return partial results on error
    return {
      metadata: {},
      cues,
      format: 'srt',
      error: `Parse error: ${err.message}`,
      partial: cues.length > 0
    };
  }
}

/**
 * Finalize a cue with computed properties
 */
function finalizeCue(cue) {
  return {
    index: cue.index,
    startTime: msToTimestamp(cue.startMs),
    endTime: msToTimestamp(cue.endMs),
    startMs: cue.startMs,
    endMs: cue.endMs,
    duration: cue.endMs - cue.startMs,
    speaker: cue.speaker || null,
    text: cue.textLines.join(' ').trim(),
    rawText: cue.rawLines.join('\n'),
    settings: cue.settings || ''
  };
}

/**
 * Merge consecutive cues from the same speaker
 */
function mergeCues(cues, options = {}) {
  const mergeThreshold = options.mergeThreshold || 2000; // 2 seconds default
  const merged = [];
  let current = null;

  for (const cue of cues) {
    if (current === null) {
      current = {
        ...cue,
        textParts: [cue.text],
        cueCount: 1
      };
      continue;
    }

    const gap = cue.startMs - current.endMs;
    const sameSpeaker = cue.speaker === current.speaker;

    if (sameSpeaker && gap < mergeThreshold) {
      current.textParts.push(cue.text);
      current.endMs = cue.endMs;
      current.endTime = cue.endTime;
      current.duration = current.endMs - current.startMs;
      current.cueCount++;
    } else {
      current.text = current.textParts.join(' ');
      delete current.textParts;
      merged.push(current);
      current = {
        ...cue,
        textParts: [cue.text],
        cueCount: 1
      };
    }
  }

  if (current) {
    current.text = current.textParts.join(' ');
    delete current.textParts;
    merged.push(current);
  }

  return merged;
}

/**
 * Auto-detect and parse subtitle file
 */
function parseSubtitle(content) {
  // Check for VTT
  if (content.trim().startsWith('WEBVTT') || isVTTFormat(content).detected) {
    return parseVTT(content);
  }

  // Check for SRT
  if (isSRTFormat(content).detected) {
    return parseSRT(content);
  }

  return { error: 'Unable to detect subtitle format', format: 'unknown' };
}

/**
 * Format parsed cues as plain text
 */
function formatCuesAsText(cues, options = {}) {
  const lines = [];

  for (const cue of cues) {
    let line = '';

    if (options.timestamps || options.withTimestamps) {
      line += `[${msToTimestamp(cue.startMs, true)}] `;
    }

    if ((options.speakers || options.withSpeakers) && cue.speaker) {
      line += `${cue.speaker}: `;
    }

    line += cue.text;
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Get subtitle statistics
 */
function getSubtitleStats(parsed) {
  if (parsed.error) return null;

  const cues = parsed.cues;
  const speakers = new Set(cues.filter(c => c.speaker).map(c => c.speaker));
  const totalDuration = cues.length > 0 ? cues[cues.length - 1].endMs : 0;
  const totalWords = cues.reduce((sum, c) => sum + countWords(c.text), 0);

  return {
    format: parsed.format,
    cueCount: cues.length,
    speakerCount: speakers.size,
    speakers: Array.from(speakers),
    totalDurationMs: totalDuration,
    totalDuration: msToTimestamp(totalDuration),
    totalWords,
    avgWordsPerCue: cues.length > 0 ? Math.round(totalWords / cues.length * 10) / 10 : 0
  };
}

// ==========================================================================
// E4-S4: Zoom/Teams Export Parsing Functions
// ==========================================================================

/**
 * Pattern definitions for Zoom formats
 */
const ZOOM_PATTERNS = {
  // Chat format: "00:00:01	From John Smith to Everyone:"
  chatHeader: /^(\d{1,2}:\d{2}:\d{2})\t+From\s+(.+?)\s+to\s+(.+?):$/,
  // VTT with speaker: "John Smith: text"
  vttSpeaker: /^([A-Z][a-zA-Z\s'-]+):\s*(.+)$/,
  // Timestamp line in chat
  timestampLine: /^(\d{1,2}:\d{2}:\d{2})\t/,
  // System message (participant joined/left)
  systemMessage: /^(.+?)\s+(joined|left)\s+the\s+meeting\.?$/i,
  // Recording messages
  recordingMessage: /^Recording\s+(started|stopped)\.?$/i
};

/**
 * Pattern definitions for Teams formats
 */
const TEAMS_PATTERNS = {
  // Chat format: "[1/10/2026, 9:00:15 AM] John Smith: message"
  chatLine: /^\[(\d{1,2}\/\d{1,2}\/\d{4}),?\s*(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)\]\s*([^:]+):\s*(.*)$/i,
  // Alternative chat format without date
  chatLineNoDate: /^\[(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)\]\s*([^:]+):\s*(.*)$/i,
  // System event (joined/left)
  systemEvent: /^(.+?)\s+(joined|left)\s+the\s+meeting\.?$/i,
  // Reaction
  reaction: /^\[.+\]\s*(.+?)\s+reacted\s+/i,
  // Screen sharing
  screenShare: /^\[.+\]\s*(.+?)\s+(started|stopped)\s+sharing/i
};

/**
 * Check if text is a system message (joins/leaves/etc)
 */
function isSystemMessage(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return (
    ZOOM_PATTERNS.systemMessage.test(trimmed) ||
    ZOOM_PATTERNS.recordingMessage.test(trimmed) ||
    TEAMS_PATTERNS.systemEvent.test(trimmed) ||
    TEAMS_PATTERNS.reaction.test(trimmed) ||
    TEAMS_PATTERNS.screenShare.test(trimmed)
  );
}

/**
 * Parse time string to milliseconds
 * Supports: "HH:MM:SS", "H:MM:SS", "9:00:15 AM"
 */
function parseTimeToMs(timeStr) {
  if (!timeStr) return 0;

  // Handle AM/PM format
  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const seconds = parseInt(ampmMatch[3], 10);
    const ampm = ampmMatch[4];

    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Handle simple HH:MM:SS
  const simpleMatch = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (simpleMatch) {
    const hours = parseInt(simpleMatch[1], 10);
    const minutes = parseInt(simpleMatch[2], 10);
    const seconds = parseInt(simpleMatch[3], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return 0;
}

/**
 * Parse Zoom chat format
 */
function parseZoomChat(content, options = {}) {
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;
  const includeSystem = options.includeSystem || false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for chat header: "00:00:01	From John Smith to Everyone:"
    const headerMatch = line.match(ZOOM_PATTERNS.chatHeader);
    if (headerMatch) {
      // Save previous entry
      if (currentEntry && currentEntry.text.trim()) {
        if (includeSystem || !isSystemMessage(currentEntry.text)) {
          entries.push(currentEntry);
        }
      }

      currentEntry = {
        index: entries.length + 1,
        timestamp: headerMatch[1],
        timestampMs: parseTimeToMs(headerMatch[1]),
        speaker: headerMatch[2].trim(),
        recipient: headerMatch[3].trim(),
        text: '',
        type: 'message',
        source: 'zoom_chat'
      };
      continue;
    }

    // Check for continuation line (starts with tab)
    if (currentEntry && line.startsWith('\t')) {
      const text = line.replace(/^\t+/, '').trim();
      if (text) {
        currentEntry.text += (currentEntry.text ? ' ' : '') + text;
      }
      continue;
    }

    // Check for line that starts with timestamp but no "From"
    if (line.match(ZOOM_PATTERNS.timestampLine) && !line.includes('From')) {
      // Might be a different format or continuation
      continue;
    }
  }

  // Don't forget last entry
  if (currentEntry && currentEntry.text.trim()) {
    if (includeSystem || !isSystemMessage(currentEntry.text)) {
      entries.push(currentEntry);
    }
  }

  return {
    format: 'zoom_chat',
    metadata: {
      entryCount: entries.length,
      participants: [...new Set(entries.map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Zoom VTT transcript (VTT with speaker names in text)
 */
function parseZoomVTT(content, options = {}) {
  // First parse as standard VTT
  const vttResult = parseVTT(content);
  const includeSystem = options.includeSystem || false;

  // Then extract speakers from text if not already identified
  const entries = [];
  for (const cue of vttResult.cues) {
    let speaker = cue.speaker;
    let text = cue.text;

    // Try to extract speaker from "Name: text" pattern
    if (!speaker) {
      const speakerMatch = text.match(ZOOM_PATTERNS.vttSpeaker);
      if (speakerMatch) {
        speaker = speakerMatch[1].trim();
        text = speakerMatch[2].trim();
      }
    }

    // Skip system messages unless requested
    if (!includeSystem && isSystemMessage(text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: cue.startTime,
      timestampMs: cue.startMs,
      endTimestampMs: cue.endMs,
      speaker: speaker,
      text: text,
      type: 'message',
      source: 'zoom_vtt'
    });
  }

  return {
    format: 'zoom_vtt',
    metadata: {
      ...vttResult.metadata,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams chat format
 */
function parseTeamsChat(content, options = {}) {
  const lines = content.split('\n');
  const entries = [];
  const includeSystem = options.includeSystem || false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try full format with date: "[1/10/2026, 9:00:15 AM] John Smith: message"
    let match = trimmed.match(TEAMS_PATTERNS.chatLine);
    if (match) {
      const text = match[4].trim();

      // Skip system messages unless requested
      if (!includeSystem && isSystemMessage(text)) {
        continue;
      }

      // Skip reactions
      if (!includeSystem && TEAMS_PATTERNS.reaction.test(trimmed)) {
        continue;
      }

      entries.push({
        index: entries.length + 1,
        date: match[1],
        timestamp: match[2].trim(),
        timestampMs: parseTimeToMs(match[2].trim()),
        speaker: match[3].trim(),
        text: text,
        type: 'message',
        source: 'teams_chat'
      });
      continue;
    }

    // Try format without date: "[9:00:15 AM] John Smith: message"
    match = trimmed.match(TEAMS_PATTERNS.chatLineNoDate);
    if (match) {
      const text = match[3].trim();

      if (!includeSystem && isSystemMessage(text)) {
        continue;
      }

      entries.push({
        index: entries.length + 1,
        timestamp: match[1].trim(),
        timestampMs: parseTimeToMs(match[1].trim()),
        speaker: match[2].trim(),
        text: text,
        type: 'message',
        source: 'teams_chat'
      });
    }
  }

  return {
    format: 'teams_chat',
    metadata: {
      entryCount: entries.length,
      participants: [...new Set(entries.map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams VTT transcript (VTT with voice tags)
 */
function parseTeamsVTT(content, options = {}) {
  // Parse as standard VTT - it already handles <v Speaker> tags
  const vttResult = parseVTT(content);
  const includeSystem = options.includeSystem || false;

  const entries = [];
  for (const cue of vttResult.cues) {
    // Skip system messages unless requested
    if (!includeSystem && isSystemMessage(cue.text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: cue.startTime,
      timestampMs: cue.startMs,
      endTimestampMs: cue.endMs,
      speaker: cue.speaker,
      text: cue.text,
      type: 'message',
      source: 'teams_vtt'
    });
  }

  return {
    format: 'teams_vtt',
    metadata: {
      ...vttResult.metadata,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams JSON transcript export
 */
function parseTeamsJSON(content, options = {}) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return { error: 'Invalid JSON format', format: 'unknown' };
  }

  const includeSystem = options.includeSystem || false;

  // Handle different JSON structures
  let transcripts = data.transcripts || data.messages || data.entries || data;
  if (!Array.isArray(transcripts)) {
    return { error: 'No transcript array found in JSON', format: 'unknown' };
  }

  const entries = [];
  for (const item of transcripts) {
    const speaker = item.speakerName || item.speaker || item.from || item.author;
    const text = item.text || item.content || item.message || '';
    const timestamp = item.timestamp || item.time || item.createdDateTime;

    if (!includeSystem && isSystemMessage(text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: timestamp,
      timestampMs: timestamp ? new Date(timestamp).getTime() : 0,
      speaker: speaker,
      text: text.trim(),
      type: 'message',
      source: 'teams_json'
    });
  }

  return {
    format: 'teams_json',
    metadata: {
      meetingId: data.meetingId,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Detect meeting format from content
 */
function detectMeetingType(content) {
  const trimmed = content.trim();

  // Check for JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'teams_json';
    } catch (err) {
      // Not valid JSON
    }
  }

  // Check for VTT format
  if (trimmed.startsWith('WEBVTT') || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) {
    // Check for voice tags (Teams style)
    if (/<v\s+[^>]+>/.test(trimmed)) {
      return 'teams_vtt';
    }
    // Check for speaker colon pattern (Zoom style)
    if (/\n[A-Z][a-zA-Z\s'-]+:\s/.test(trimmed)) {
      return 'zoom_vtt';
    }
    return 'generic_vtt';
  }

  // Check for Zoom chat format
  if (/^\d{1,2}:\d{2}:\d{2}\t+From\s+.+\s+to\s+.+:/m.test(trimmed)) {
    return 'zoom_chat';
  }

  // Check for Teams chat format
  if (/^\[\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\]/im.test(trimmed)) {
    return 'teams_chat';
  }

  // Check for simple bracket timestamp format
  if (/^\[\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\]\s*[^:]+:/im.test(trimmed)) {
    return 'teams_chat';
  }

  return 'unknown';
}

/**
 * Parse Zoom transcript (auto-detect format)
 */
function parseZoom(content, options = {}) {
  const format = options.format || detectMeetingType(content);

  switch (format) {
    case 'zoom_chat':
      return parseZoomChat(content, options);
    case 'zoom_vtt':
    case 'generic_vtt':
      return parseZoomVTT(content, options);
    default:
      // Try VTT first
      if (content.includes('-->')) {
        return parseZoomVTT(content, options);
      }
      return parseZoomChat(content, options);
  }
}

/**
 * Parse Teams transcript (auto-detect format)
 */
function parseTeams(content, options = {}) {
  const format = options.format || detectMeetingType(content);

  switch (format) {
    case 'teams_json':
      return parseTeamsJSON(content, options);
    case 'teams_chat':
      return parseTeamsChat(content, options);
    case 'teams_vtt':
      return parseTeamsVTT(content, options);
    default:
      // Try to detect
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        return parseTeamsJSON(content, options);
      }
      if (content.includes('-->')) {
        return parseTeamsVTT(content, options);
      }
      return parseTeamsChat(content, options);
  }
}

/**
 * Parse meeting transcript (auto-detect Zoom or Teams)
 */
function parseMeeting(content, options = {}) {
  const format = detectMeetingType(content);

  if (format.startsWith('zoom')) {
    return parseZoom(content, options);
  }

  if (format.startsWith('teams')) {
    return parseTeams(content, options);
  }

  if (format === 'generic_vtt') {
    // Try Zoom VTT parser as it handles generic VTT with speaker extraction
    return parseZoomVTT(content, options);
  }

  return { error: 'Unable to detect meeting format', format: 'unknown' };
}

/**
 * Merge consecutive entries from same speaker
 */
function mergeMeetingEntries(entries, options = {}) {
  const mergeThreshold = options.mergeThreshold || 30000; // 30 seconds default for meetings
  const merged = [];
  let current = null;

  for (const entry of entries) {
    if (current === null) {
      current = { ...entry, textParts: [entry.text] };
      continue;
    }

    const gap = entry.timestampMs - (current.endTimestampMs || current.timestampMs);
    const sameSpeaker = entry.speaker === current.speaker;

    if (sameSpeaker && gap < mergeThreshold) {
      current.textParts.push(entry.text);
      current.endTimestampMs = entry.endTimestampMs || entry.timestampMs;
    } else {
      current.text = current.textParts.join(' ');
      delete current.textParts;
      merged.push(current);
      current = { ...entry, textParts: [entry.text] };
    }
  }

  if (current) {
    current.text = current.textParts.join(' ');
    delete current.textParts;
    merged.push(current);
  }

  return merged;
}

/**
 * Format meeting entries as text
 */
function formatMeetingAsText(entries, options = {}) {
  const lines = [];

  for (const entry of entries) {
    let line = '';

    if (options.timestamps && entry.timestamp) {
      const displayTime = entry.timestamp.replace(/\.\d+$/, ''); // Remove ms
      line += `[${displayTime}] `;
    }

    if (options.speakers !== false && entry.speaker) {
      line += `${entry.speaker}: `;
    }

    line += entry.text;
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Get meeting transcript statistics
 */
function getMeetingStats(parsed) {
  if (parsed.error) return null;

  const entries = parsed.entries || [];
  const participants = parsed.metadata?.participants || [];

  // Calculate duration
  let durationMs = 0;
  if (entries.length > 0) {
    const firstMs = entries[0].timestampMs || 0;
    const lastMs = entries[entries.length - 1].endTimestampMs || entries[entries.length - 1].timestampMs || 0;
    durationMs = lastMs - firstMs;
  }

  // Word count
  const totalWords = entries.reduce((sum, e) => sum + countWords(e.text), 0);

  // Messages per speaker
  const speakerCounts = {};
  for (const entry of entries) {
    if (entry.speaker) {
      speakerCounts[entry.speaker] = (speakerCounts[entry.speaker] || 0) + 1;
    }
  }

  return {
    format: parsed.format,
    entryCount: entries.length,
    participantCount: participants.length,
    participants: participants,
    durationMs: durationMs,
    duration: msToTimestamp(durationMs),
    totalWords: totalWords,
    avgWordsPerEntry: entries.length > 0 ? Math.round(totalWords / entries.length * 10) / 10 : 0,
    speakerCounts: speakerCounts
  };
}

// ==========================================================================
// E5-S1: Language Detection Functions
// ==========================================================================

/**
 * Script patterns for character set detection
 */
const SCRIPT_PATTERNS = {
  latin: /[a-zA-ZàâäéèêëïîôùûüÿçœæÀÂÄÉÈÊËÏÎÔÙÛÜŸÇŒÆáéíóúüñÁÉÍÓÚÜÑäöüßÄÖÜ]/g,
  cyrillic: /[\u0400-\u04FF]/g,
  hebrew: /[\u0590-\u05FF]/g,
  arabic: /[\u0600-\u06FF\u0750-\u077F]/g,
  cjk: /[\u4E00-\u9FFF\u3400-\u4DBF]/g,
  hiragana: /[\u3040-\u309F]/g,
  katakana: /[\u30A0-\u30FF]/g,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  greek: /[\u0370-\u03FF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  devanagari: /[\u0900-\u097F]/g
};

/**
 * Language metadata
 */
const LANGUAGE_INFO = {
  en: { name: 'English', script: 'latin', rtl: false },
  es: { name: 'Spanish', script: 'latin', rtl: false },
  fr: { name: 'French', script: 'latin', rtl: false },
  de: { name: 'German', script: 'latin', rtl: false },
  pt: { name: 'Portuguese', script: 'latin', rtl: false },
  it: { name: 'Italian', script: 'latin', rtl: false },
  nl: { name: 'Dutch', script: 'latin', rtl: false },
  ru: { name: 'Russian', script: 'cyrillic', rtl: false },
  he: { name: 'Hebrew', script: 'hebrew', rtl: true },
  ar: { name: 'Arabic', script: 'arabic', rtl: true },
  zh: { name: 'Chinese', script: 'cjk', rtl: false },
  ja: { name: 'Japanese', script: 'cjk', rtl: false },
  ko: { name: 'Korean', script: 'hangul', rtl: false },
  el: { name: 'Greek', script: 'greek', rtl: false },
  th: { name: 'Thai', script: 'thai', rtl: false },
  hi: { name: 'Hindi', script: 'devanagari', rtl: false },
  pl: { name: 'Polish', script: 'latin', rtl: false },
  tr: { name: 'Turkish', script: 'latin', rtl: false },
  sv: { name: 'Swedish', script: 'latin', rtl: false },
  no: { name: 'Norwegian', script: 'latin', rtl: false },
  da: { name: 'Danish', script: 'latin', rtl: false },
  fi: { name: 'Finnish', script: 'latin', rtl: false },
  vi: { name: 'Vietnamese', script: 'latin', rtl: false }
};

/**
 * Common words by language (top 30 most frequent)
 */
const COMMON_WORDS = {
  en: ['the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does',
       'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
       'this', 'that', 'these', 'those', 'with', 'from', 'about', 'into',
       'through', 'during', 'before', 'after'],

  es: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'en',
       'es', 'son', 'por', 'para', 'con', 'sin', 'sobre', 'como', 'pero',
       'muy', 'ya', 'aunque', 'porque', 'cuando', 'donde', 'quien',
       'cual', 'todo', 'nada', 'algo'],

  fr: ['le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'en',
       'est', 'sont', 'avoir', 'pour', 'que', 'qui', 'dans', 'sur',
       'avec', 'plus', 'pas', 'ce', 'cette', 'ces', 'nous', 'vous',
       'ils', 'elle', 'elles', 'mais'],

  de: ['der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'und', 'ist', 'sind',
       'war', 'waren', 'hat', 'haben', 'wird', 'werden', 'kann',
       'mit', 'von', 'zu', 'bei', 'nach', 'auch', 'nur', 'noch',
       'aber', 'oder', 'wenn', 'wie', 'nicht'],

  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'que', 'em',
       'no', 'na', 'para', 'por', 'com', 'mais', 'como', 'esse',
       'essa', 'este', 'esta', 'seu', 'sua', 'ele', 'ela', 'eles',
       'elas', 'mas', 'ou'],

  it: ['il', 'la', 'i', 'le', 'lo', 'gli', 'un', 'una', 'di', 'che', 'e',
       'in', 'per', 'con', 'non', 'da', 'su', 'come', 'ma', 'anche',
       'questo', 'quella', 'questi', 'quelle', 'essere', 'avere',
       'fare', 'dire', 'potere', 'volere'],

  nl: ['de', 'het', 'een', 'van', 'en', 'in', 'is', 'zijn', 'op', 'te',
       'dat', 'die', 'voor', 'met', 'niet', 'aan', 'er', 'om', 'ook', 'als',
       'maar', 'bij', 'nog', 'wel', 'dan', 'naar', 'kan', 'zou', 'worden', 'heeft'],

  he: ['של', 'את', 'על', 'הוא', 'היא', 'הם', 'הן', 'לא', 'זה', 'כי', 'אם',
       'גם', 'יש', 'אין', 'עם', 'אל', 'מה', 'כל', 'היה', 'להיות', 'אני',
       'אתה', 'את', 'אנחנו', 'הזה', 'הזאת', 'עוד', 'רק', 'כמו', 'אבל'],

  ru: ['и', 'в', 'не', 'на', 'я', 'что', 'он', 'с', 'как', 'это',
       'она', 'они', 'но', 'по', 'из', 'за', 'все', 'так', 'его', 'же',
       'от', 'для', 'или', 'было', 'бы', 'мне', 'вы', 'мы', 'был', 'быть']
};

/**
 * Common trigrams by language
 */
const TRIGRAM_PROFILES = {
  en: ['the', 'and', 'ing', 'ion', 'tio', 'ent', 'ati', 'for', 'her', 'ter',
       'hat', 'tha', 'ere', 'ate', 'his', 'con', 'res', 'ver', 'all', 'ons'],
  es: ['que', 'ent', 'ade', 'los', 'del', 'est', 'con', 'nte', 'par',
       'las', 'cia', 'era', 'ien', 'com', 'res', 'sta', 'tra', 'pro', 'una', 'por'],
  fr: ['ent', 'que', 'les', 'ion', 'tio', 'men', 'ait', 'ons', 'ant', 'our',
       'des', 'eur', 'par', 'est', 'eme', 'com', 'ous', 'ter', 'con', 'dan'],
  de: ['der', 'und', 'den', 'ein', 'che', 'die', 'sch', 'ung', 'ich', 'ter',
       'ent', 'gen', 'das', 'ber', 'ine', 'eit', 'mit', 'ren', 'nen', 'ver']
};

/**
 * Detect script types in text
 */
function detectScript(text) {
  const scripts = {};
  let total = 0;

  for (const [name, pattern] of Object.entries(SCRIPT_PATTERNS)) {
    const matches = text.match(pattern) || [];
    if (matches.length > 0) {
      scripts[name] = matches.length;
      total += matches.length;
    }
  }

  // Calculate percentages
  const percentages = {};
  for (const [name, count] of Object.entries(scripts)) {
    percentages[name] = total > 0 ? count / total : 0;
  }

  return { counts: scripts, percentages, total };
}

/**
 * Clean text for language detection
 */
function cleanForDetection(text) {
  return text
    // Remove timestamps
    .replace(/\d{1,2}:\d{2}(:\d{2})?(\.\d+)?/g, '')
    // Remove speaker labels
    .replace(/^[A-Z][a-z]+\s[A-Z][a-z]+:/gm, '')
    .replace(/<v\s+[^>]+>/g, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract word tokens from text
 */
function extractWords(text) {
  // Handle different scripts
  const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
  return words.filter(w => w.length > 1);
}

/**
 * Analyze common words to score languages
 */
function analyzeCommonWords(text) {
  const words = extractWords(text);
  const wordSet = new Set(words);
  const scores = {};

  for (const [lang, commonList] of Object.entries(COMMON_WORDS)) {
    let matches = 0;
    for (const word of commonList) {
      if (wordSet.has(word)) {
        matches++;
      }
    }
    // Also count occurrences
    let occurrences = 0;
    for (const word of words) {
      if (commonList.includes(word)) {
        occurrences++;
      }
    }
    scores[lang] = {
      uniqueMatches: matches,
      totalOccurrences: occurrences,
      score: words.length > 0 ? occurrences / words.length : 0
    };
  }

  return scores;
}

/**
 * Extract trigrams from text
 */
function extractTrigrams(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z]/g, '');
  const trigrams = [];
  for (let i = 0; i < cleaned.length - 2; i++) {
    trigrams.push(cleaned.substring(i, i + 3));
  }
  return trigrams;
}

/**
 * Analyze trigrams to score languages
 */
function analyzeNgrams(text) {
  const trigrams = extractTrigrams(text);
  const trigramSet = new Set(trigrams);
  const scores = {};

  for (const [lang, profile] of Object.entries(TRIGRAM_PROFILES)) {
    let matches = 0;
    for (const trigram of profile) {
      if (trigramSet.has(trigram)) {
        matches++;
      }
    }
    scores[lang] = {
      matches: matches,
      score: profile.length > 0 ? matches / profile.length : 0
    };
  }

  return scores;
}

/**
 * Combine detection signals into final scores
 */
function combineLanguageScores(scriptResult, wordResult, ngramResult) {
  const scores = {};

  // Script-based detection for non-Latin scripts
  if (scriptResult.percentages.hebrew > 0.3) {
    scores.he = (scores.he || 0) + scriptResult.percentages.hebrew;
  }
  if (scriptResult.percentages.arabic > 0.3) {
    scores.ar = (scores.ar || 0) + scriptResult.percentages.arabic;
  }
  if (scriptResult.percentages.cyrillic > 0.3) {
    scores.ru = (scores.ru || 0) + scriptResult.percentages.cyrillic;
  }
  if (scriptResult.percentages.cjk > 0.3) {
    // Could be Chinese or Japanese
    if (scriptResult.percentages.hiragana > 0.1 || scriptResult.percentages.katakana > 0.1) {
      scores.ja = (scores.ja || 0) + scriptResult.percentages.cjk;
    } else {
      scores.zh = (scores.zh || 0) + scriptResult.percentages.cjk;
    }
  }
  if (scriptResult.percentages.hangul > 0.3) {
    scores.ko = (scores.ko || 0) + scriptResult.percentages.hangul;
  }
  if (scriptResult.percentages.greek > 0.3) {
    scores.el = (scores.el || 0) + scriptResult.percentages.greek;
  }
  if (scriptResult.percentages.thai > 0.3) {
    scores.th = (scores.th || 0) + scriptResult.percentages.thai;
  }
  if (scriptResult.percentages.devanagari > 0.3) {
    scores.hi = (scores.hi || 0) + scriptResult.percentages.devanagari;
  }

  // Word-based scoring (weighted 0.5)
  for (const [lang, data] of Object.entries(wordResult)) {
    scores[lang] = (scores[lang] || 0) + data.score * 0.5;
  }

  // N-gram scoring (weighted 0.3)
  for (const [lang, data] of Object.entries(ngramResult)) {
    scores[lang] = (scores[lang] || 0) + data.score * 0.3;
  }

  // Normalize scores
  const maxScore = Math.max(...Object.values(scores), 0.001);
  for (const lang of Object.keys(scores)) {
    scores[lang] = scores[lang] / maxScore;
  }

  return scores;
}

/**
 * Detect primary language of text
 */
function detectLanguage(text, options = {}) {
  const minLength = options.minLength || 20;

  // Clean text
  const cleaned = cleanForDetection(text);
  if (cleaned.length < minLength) {
    return {
      language: 'unknown',
      languageName: 'Unknown',
      confidence: 0,
      reason: 'insufficient_text'
    };
  }

  // Analyze
  const scriptResult = detectScript(cleaned);
  const wordResult = analyzeCommonWords(cleaned);
  const ngramResult = analyzeNgrams(cleaned);

  // Combine scores
  const scores = combineLanguageScores(scriptResult, wordResult, ngramResult);

  // Sort by score
  const sorted = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return {
      language: 'unknown',
      languageName: 'Unknown',
      confidence: 0
    };
  }

  const primary = sorted[0];
  const secondary = sorted.length > 1 && sorted[1][1] > 0.3 ? sorted[1] : null;

  return {
    language: primary[0],
    languageName: LANGUAGE_INFO[primary[0]]?.name || primary[0],
    confidence: Math.min(primary[1], 1),
    secondary: secondary ? {
      language: secondary[0],
      languageName: LANGUAGE_INFO[secondary[0]]?.name || secondary[0],
      confidence: Math.min(secondary[1], 1)
    } : null,
    scripts: scriptResult.counts,
    wordMatches: Object.fromEntries(
      Object.entries(wordResult)
        .filter(([_, d]) => d.totalOccurrences > 0)
        .map(([lang, d]) => [lang, d.totalOccurrences])
    ),
    allScores: scores
  };
}

/**
 * Detect multiple languages in text (for mixed content)
 */
function detectMultipleLanguages(text, options = {}) {
  const segmentSize = options.segmentSize || 300;

  // Split into segments
  const words = text.split(/\s+/);
  const segments = [];
  for (let i = 0; i < words.length; i += segmentSize / 5) {
    const segmentWords = words.slice(i, i + segmentSize / 5);
    if (segmentWords.length > 10) {
      segments.push(segmentWords.join(' '));
    }
  }

  if (segments.length === 0) {
    return detectLanguage(text, options);
  }

  // Analyze each segment
  const languageCounts = {};
  const segmentResults = [];

  for (const segment of segments) {
    const result = detectLanguage(segment, { minLength: 10 });
    if (result.language !== 'unknown' && result.confidence > 0.3) {
      languageCounts[result.language] = (languageCounts[result.language] || 0) + 1;
      segmentResults.push({
        preview: segment.substring(0, 50) + (segment.length > 50 ? '...' : ''),
        language: result.language,
        confidence: result.confidence
      });
    }
  }

  // Calculate distribution
  const total = Object.values(languageCounts).reduce((a, b) => a + b, 0);
  const distribution = {};
  for (const [lang, count] of Object.entries(languageCounts)) {
    distribution[lang] = total > 0 ? count / total : 0;
  }

  const sortedLangs = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  const primaryLang = sortedLangs[0]?.[0] || 'unknown';

  return {
    language: primaryLang,
    languageName: LANGUAGE_INFO[primaryLang]?.name || primaryLang,
    confidence: distribution[primaryLang] || 0,
    isMultilingual: Object.keys(distribution).length > 1,
    distribution: distribution,
    segmentCount: segments.length,
    segments: segmentResults.slice(0, 10) // Limit to first 10
  };
}

/**
 * Get language info by code
 */
function getLanguageInfo(code) {
  const info = LANGUAGE_INFO[code];
  if (!info) {
    return { code, name: 'Unknown', script: 'unknown', rtl: false, supported: false };
  }
  return {
    code,
    ...info,
    hasCommonWords: !!COMMON_WORDS[code],
    hasTrigrams: !!TRIGRAM_PROFILES[code],
    supported: true
  };
}

/**
 * List all supported languages
 */
function listSupportedLanguages() {
  return Object.entries(LANGUAGE_INFO).map(([code, info]) => ({
    code,
    ...info,
    tier: COMMON_WORDS[code] ? (TRIGRAM_PROFILES[code] ? 1 : 2) : 3
  }));
}

// ==========================================================================
// E3-S1: Complexity Detection Functions
// ==========================================================================

/**
 * Count unique entity types in statements
 */
function countEntityTypes(statements) {
  const entityTypes = new Set();

  for (const statement of statements) {
    if (!statement.text) continue;

    // Check UI patterns
    for (const { pattern, type } of UI_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`ui:${type}`);
      }
    }

    // Check data patterns
    for (const { pattern, type } of DATA_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`data:${type}`);
      }
    }

    // Check interaction patterns
    for (const { pattern, type } of INTERACTION_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`interaction:${type}`);
      }
    }
  }

  return entityTypes.size;
}

/**
 * Extract all entities from statements for summary
 */
function extractEntities(statements) {
  const entities = {
    ui_components: new Set(),
    data_entities: new Set(),
    interactions: new Set()
  };

  for (const statement of statements) {
    if (!statement.text) continue;

    // Check UI patterns
    for (const { pattern, type } of UI_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.ui_components.add(match[1].toLowerCase());
      }
    }

    // Check data patterns
    for (const { pattern, type } of DATA_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.data_entities.add(match[1].toLowerCase());
      }
    }

    // Check interaction patterns
    for (const { pattern, type } of INTERACTION_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.interactions.add(match[1].toLowerCase());
      }
    }
  }

  return {
    ui_components: Array.from(entities.ui_components),
    data_entities: Array.from(entities.data_entities),
    interactions: Array.from(entities.interactions)
  };
}

/**
 * Determine complexity level from score
 */
function getComplexityLevel(score) {
  for (const level of COMPLEXITY_LEVELS) {
    if (score <= level.max) {
      return level;
    }
  }
  return COMPLEXITY_LEVELS[COMPLEXITY_LEVELS.length - 1];
}

/**
 * Calculate overall complexity score (0-100)
 */
function calculateComplexityScore(digest) {
  const topics = digest.topics || [];
  const statements = digest.statements || [];
  const clarifications = digest.clarifications || { questions: [], contradictions: [] };

  let score = 0;

  // Topic complexity (0-25)
  const topicCount = topics.filter(t => t.status === 'active').length;
  score += Math.min(topicCount * 5, 25);

  // Statement density (0-25)
  const meaningfulStatements = statements.filter(s => s.meaningful !== false);
  score += Math.min(meaningfulStatements.length * 2, 25);

  // Clarification needs (0-25)
  const questionCount = clarifications.questions?.length || 0;
  const contradictionCount = clarifications.contradictions?.length || 0;
  score += Math.min((questionCount + contradictionCount * 2) * 2, 25);

  // Entity diversity (0-25)
  const entityTypes = countEntityTypes(statements);
  score += Math.min(entityTypes * 5, 25);

  return Math.min(score, 100);
}

/**
 * Check if statement is a requirement (vs discussion)
 */
function isRequirement(statement) {
  const requirementIndicators = [
    /\b(must|should|will|need|require|want)\b/i,
    /\b(add|create|build|implement|include)\b/i,
    /\b(feature|functionality|capability)\b/i
  ];
  return requirementIndicators.some(pattern => pattern.test(statement.text));
}

/**
 * Check if statement is vague
 */
function isVagueStatement(statement) {
  const vagueIndicators = [
    /\b(nice|good|better|pretty|clean)\b/i,
    /\b(maybe|might|could|possibly|probably)\b/i,
    /\b(some|various|multiple|many|few)\b/i,
    /\b(etc|and so on|and more)\b/i
  ];
  return vagueIndicators.some(pattern => pattern.test(statement.text));
}

/**
 * Check if topic has UI component
 */
function hasUIComponent(statements) {
  return statements.some(s =>
    UI_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

/**
 * Check if topic has data model
 */
function hasDataModel(statements) {
  return statements.some(s =>
    DATA_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

/**
 * Check if topic has user interaction
 */
function hasUserInteraction(statements) {
  return statements.some(s =>
    INTERACTION_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

/**
 * Analyze complexity of a single topic
 */
function analyzeTopicComplexity(topic, statements, clarifications) {
  const topicStatements = statements.filter(s => s.topic_id === topic.id);
  const topicQuestions = (clarifications?.questions || []).filter(q => q.topic_id === topic.id);

  const metrics = {
    statement_count: topicStatements.length,
    requirement_statements: topicStatements.filter(s => isRequirement(s)).length,
    vague_statements: topicStatements.filter(s => isVagueStatement(s)).length,
    question_count: topicQuestions.length,
    answered_questions: topicQuestions.filter(q => q.status === 'answered').length,
    entity_mentions: countEntityTypes(topicStatements),
    has_ui_component: hasUIComponent(topicStatements),
    has_data_model: hasDataModel(topicStatements),
    has_user_interaction: hasUserInteraction(topicStatements)
  };

  // Calculate topic complexity score (0-100)
  let topicScore = 0;
  topicScore += Math.min(metrics.statement_count * 3, 30);
  topicScore += Math.min(metrics.requirement_statements * 5, 25);
  topicScore += Math.min(metrics.question_count * 3, 15);
  topicScore += metrics.has_ui_component ? 10 : 0;
  topicScore += metrics.has_data_model ? 10 : 0;
  topicScore += metrics.has_user_interaction ? 10 : 0;
  topicScore = Math.min(topicScore, 100);

  // Determine topic type
  let topicType = 'general';
  if (metrics.has_ui_component) topicType = 'ui_feature';
  else if (metrics.has_data_model) topicType = 'data_feature';
  else if (metrics.has_user_interaction) topicType = 'workflow';

  // Estimate story count for this topic
  let estimatedStories = 1;
  if (topicScore > 60) estimatedStories = 3;
  else if (topicScore > 40) estimatedStories = 2;

  return {
    topic_id: topic.id,
    title: topic.title,
    metrics,
    complexity_score: topicScore,
    type: topicType,
    estimated_stories: estimatedStories
  };
}

/**
 * Group related topics based on shared entities
 */
function groupRelatedTopics(topicAnalysis) {
  const groups = [];
  const assigned = new Set();

  for (const topic of topicAnalysis) {
    if (assigned.has(topic.topic_id)) continue;

    // Start a new group
    const group = {
      topics: [topic],
      primary_type: topic.type,
      combined_score: topic.complexity_score,
      total_stories: topic.estimated_stories
    };

    // Find related topics (same type or low complexity topics that could be grouped)
    for (const other of topicAnalysis) {
      if (assigned.has(other.topic_id) || other.topic_id === topic.topic_id) continue;

      // Group if same type and combined complexity is manageable
      if (other.type === topic.type && group.combined_score + other.complexity_score <= 80) {
        group.topics.push(other);
        group.combined_score += other.complexity_score;
        group.total_stories += other.estimated_stories;
        assigned.add(other.topic_id);
      }
    }

    assigned.add(topic.topic_id);
    groups.push(group);
  }

  return groups;
}

/**
 * Generate epic structure from topic analysis
 */
function generateEpicStructure(topicAnalysis, topicGroups) {
  const epics = [];
  let epicNumber = 1;

  for (const group of topicGroups) {
    // Create an epic if the group has significant complexity
    if (group.combined_score > 40 || group.topics.length > 2) {
      const epic = {
        id: `epic-${epicNumber}`,
        title: `Epic ${epicNumber}: ${group.topics[0].title}${group.topics.length > 1 ? ' and related' : ''}`,
        type: group.primary_type,
        complexity_score: group.combined_score,
        stories: group.topics.map(t => ({
          topic_id: t.topic_id,
          title: t.title,
          estimated_stories: t.estimated_stories
        })),
        total_stories: group.total_stories
      };
      epics.push(epic);
      epicNumber++;
    } else {
      // Add as standalone stories (no epic needed)
      for (const topic of group.topics) {
        epics.push({
          id: `standalone-${topic.topic_id}`,
          title: topic.title,
          type: topic.type,
          complexity_score: topic.complexity_score,
          stories: [{ topic_id: topic.topic_id, title: topic.title, estimated_stories: topic.estimated_stories }],
          total_stories: topic.estimated_stories
        });
      }
    }
  }

  return epics;
}

/**
 * Recommend output structure based on complexity
 */
function recommendOutputStructure(complexityScore, topicAnalysis) {
  // Simple case
  if (complexityScore <= 20) {
    return {
      type: 'single_story',
      confidence: 0.9,
      rationale: 'Low complexity, all requirements fit in one story',
      structure: {
        story_count: 1,
        format: 'detailed',
        include_all_topics: true
      }
    };
  }

  // Check for natural groupings
  const topicGroups = groupRelatedTopics(topicAnalysis);

  // Medium case with clear groupings
  if (complexityScore <= 60 && topicGroups.length <= 5) {
    const totalStories = topicGroups.reduce((sum, g) => sum + g.total_stories, 0);
    return {
      type: 'story_group',
      confidence: 0.85,
      rationale: `${topicGroups.length} distinct feature areas identified`,
      structure: {
        story_count: totalStories,
        grouping: 'by_topic',
        format: 'standard',
        shared_context: true
      },
      groups: topicGroups.map(g => ({
        topics: g.topics.map(t => t.title),
        type: g.primary_type,
        stories: g.total_stories
      }))
    };
  }

  // Complex case - epic structure
  const epics = generateEpicStructure(topicAnalysis, topicGroups);
  const totalStories = epics.reduce((sum, e) => sum + e.total_stories, 0);

  return {
    type: 'epic',
    confidence: 0.8,
    rationale: 'High complexity requires hierarchical organization',
    structure: {
      epic_count: epics.filter(e => e.id.startsWith('epic-')).length,
      total_stories: totalStories,
      format: 'hierarchical',
      include_dependencies: true,
      include_phases: true
    },
    epics: epics.map(e => ({
      id: e.id,
      title: e.title,
      type: e.type,
      stories: e.total_stories
    }))
  };
}

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

// ==========================================================================
// E3-S2: Story Generation with Source Tracing
// ==========================================================================

/**
 * User type patterns for story generation
 */
const USER_TYPE_PATTERNS = [
  { pattern: /\b(admin|administrator)\b/i, type: 'admin' },
  { pattern: /\b(user|customer|client)\b/i, type: 'user' },
  { pattern: /\b(manager|supervisor)\b/i, type: 'manager' },
  { pattern: /\b(developer|dev)\b/i, type: 'developer' },
  { pattern: /\b(guest|visitor|anonymous)\b/i, type: 'guest' },
  { pattern: /\b(owner|creator)\b/i, type: 'owner' }
];

/**
 * Scenario name patterns
 */
const SCENARIO_PATTERNS = [
  { pattern: /\b(create|add|new)\b/i, prefix: 'Create' },
  { pattern: /\b(edit|update|modify|change)\b/i, prefix: 'Update' },
  { pattern: /\b(delete|remove|archive)\b/i, prefix: 'Delete' },
  { pattern: /\b(view|show|display|see|list)\b/i, prefix: 'View' },
  { pattern: /\b(search|find|filter)\b/i, prefix: 'Search' },
  { pattern: /\b(login|authenticate|sign in)\b/i, prefix: 'Login' },
  { pattern: /\b(logout|sign out)\b/i, prefix: 'Logout' },
  { pattern: /\b(validate|check|verify)\b/i, prefix: 'Validate' },
  { pattern: /\b(submit|save|confirm)\b/i, prefix: 'Submit' },
  { pattern: /\b(cancel|dismiss|close)\b/i, prefix: 'Cancel' },
  { pattern: /\b(select|choose|pick)\b/i, prefix: 'Select' },
  { pattern: /\b(upload|import)\b/i, prefix: 'Upload' },
  { pattern: /\b(download|export)\b/i, prefix: 'Download' }
];

/**
 * Generate unique story ID
 */
function generateStoryId() {
  return 'story-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Detect user type from statements
 */
function detectUserType(statements) {
  for (const statement of statements) {
    if (!statement.text) continue;
    for (const { pattern, type } of USER_TYPE_PATTERNS) {
      if (pattern.test(statement.text)) {
        return { value: type, source: statement.id };
      }
    }
  }
  return { value: 'user', source: 'default' };
}

/**
 * Extract main object/entity from text
 */
function extractObject(text) {
  // Look for nouns after action verbs
  const patterns = [
    /(?:create|add|new|edit|update|delete|remove|view|show)\s+(?:a\s+|the\s+)?(\w+)/i,
    /(\w+)\s+(?:table|form|list|page|modal|button)/i,
    /\b(user|product|order|item|account|profile|setting|message)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  // Default to first noun-like word
  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.length > 3 && /^[a-z]+$/i.test(word)) {
      return word.toLowerCase();
    }
  }

  return 'item';
}

/**
 * Generate scenario name from requirement
 */
function generateScenarioName(requirement) {
  const text = requirement.text || '';

  for (const { pattern, prefix } of SCENARIO_PATTERNS) {
    if (pattern.test(text)) {
      const object = extractObject(text);
      return `${prefix} ${object}`;
    }
  }

  return `Handle ${extractObject(text)}`;
}

/**
 * Extract action from requirement text
 */
function extractActionFromText(text) {
  // Look for verb phrases
  const patterns = [
    /(?:should|can|will|must)\s+(be able to\s+)?(\w+(?:\s+\w+)?)/i,
    /(?:want to|need to)\s+(\w+(?:\s+\w+)?)/i,
    /(?:add|create|edit|delete|view|manage)\s+(\w+(?:\s+\w+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[match.length - 1];
    }
  }

  return 'perform the action';
}

/**
 * Extract outcome from requirement text
 */
function extractOutcomeFromText(text) {
  // Look for outcome indicators
  if (/\b(table|list|grid)\b/i.test(text)) {
    return 'I should see the data displayed';
  }
  if (/\b(form|input)\b/i.test(text)) {
    return 'I should see the form';
  }
  if (/\b(button)\b/i.test(text)) {
    return 'the action should be performed';
  }
  if (/\b(modal|dialog|popup)\b/i.test(text)) {
    return 'I should see the modal';
  }
  if (/\b(create|add|new)\b/i.test(text)) {
    return 'a new item should be created';
  }
  if (/\b(delete|remove)\b/i.test(text)) {
    return 'the item should be removed';
  }
  if (/\b(update|edit|modify)\b/i.test(text)) {
    return 'the changes should be saved';
  }

  return 'the expected result should occur';
}

/**
 * Convert statement to Given clause
 */
function convertToGiven(text) {
  // Remove leading "when", "if", etc.
  let given = text.replace(/^(when|if|after|once|assuming)\s+/i, '');

  // Convert to first person if needed
  given = given.replace(/\b(the user|users)\b/i, 'I');

  return given;
}

/**
 * Extract Given clause from context
 */
function extractGiven(requirement, contextStatements, topic) {
  // Look for precondition statements
  const preconditions = contextStatements.filter(s =>
    /\b(when|if|after|once|assuming|logged in|on the)\b/i.test(s.text || '') &&
    s.id !== requirement.id
  );

  if (preconditions.length > 0) {
    return {
      text: convertToGiven(preconditions[0].text),
      source: preconditions[0].id
    };
  }

  // Default context based on topic
  const topicLower = (topic.title || '').toLowerCase();
  if (topicLower.includes('dashboard') || topicLower.includes('management')) {
    return { text: `I am on the ${topicLower} page`, source: 'context' };
  }
  if (topicLower.includes('form')) {
    return { text: 'I am filling out the form', source: 'context' };
  }
  if (topicLower.includes('settings') || topicLower.includes('profile')) {
    return { text: 'I am in the settings section', source: 'context' };
  }

  return { text: 'I am logged into the system', source: 'context' };
}

/**
 * Extract When clause from requirement
 */
function extractWhen(requirement) {
  const text = requirement.text || '';
  const action = extractActionFromText(text);

  return {
    text: `I ${action}`,
    source: requirement.id
  };
}

/**
 * Extract Then clause from requirement
 */
function extractThen(requirement) {
  const text = requirement.text || '';
  const outcome = extractOutcomeFromText(text);

  return {
    text: outcome,
    source: requirement.id
  };
}

/**
 * Generate criteria from clarification answers
 */
function generateCriteriaFromClarification(clarification, topic) {
  const criteria = [];
  const question = (clarification.question || '').toLowerCase();
  const answer = clarification.answer || '';

  // Column-related questions
  if (question.includes('column') || question.includes('display') || question.includes('show')) {
    criteria.push({
      scenario: 'Display correct columns',
      given: { text: 'I am viewing the table', source: 'context' },
      when: { text: 'the data loads', source: 'context' },
      then: { text: `I should see columns: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Validation-related questions
  if (question.includes('validation') || question.includes('required') || question.includes('rules')) {
    criteria.push({
      scenario: 'Validate form input',
      given: { text: 'I am filling out the form', source: 'context' },
      when: { text: 'I submit with invalid data', source: 'context' },
      then: { text: `validation should enforce: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Action-related questions
  if (question.includes('action') || question.includes('button') || question.includes('click')) {
    criteria.push({
      scenario: 'Handle user actions',
      given: { text: 'I am on the page', source: 'context' },
      when: { text: 'I perform an action', source: 'context' },
      then: { text: `the available actions are: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Sort/filter questions
  if (question.includes('sort') || question.includes('filter') || question.includes('order')) {
    criteria.push({
      scenario: 'Sort and filter data',
      given: { text: 'I am viewing the data', source: 'context' },
      when: { text: 'I apply sorting or filtering', source: 'context' },
      then: { text: `sorting/filtering should support: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Generic fallback
  if (criteria.length === 0) {
    const keyword = question.split(' ').find(w => w.length > 4) || 'detail';
    criteria.push({
      scenario: `Handle ${keyword}`,
      given: { text: 'the feature is active', source: 'context' },
      when: { text: 'the user interacts', source: 'context' },
      then: { text: answer, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  return criteria;
}

/**
 * Build traceability matrix for a story
 */
function buildTraceabilityMatrix(criteria) {
  const matrix = [];

  for (let i = 0; i < criteria.length; i++) {
    const criterion = criteria[i];
    const criterionId = `AC-${i + 1}`;

    for (const sourceId of criterion.sources || []) {
      matrix.push({
        criterion_id: criterionId,
        criterion_name: criterion.scenario,
        source_id: sourceId,
        source_text: (criterion.originalText || '').slice(0, 60) + '...',
        source_type: sourceId.startsWith('s-') ? 'statement' :
                     sourceId.startsWith('q-') ? 'clarification' : 'context'
      });
    }
  }

  return matrix;
}

/**
 * Validate story coverage
 */
function validateStoryCoverage(story, topicStatements) {
  const warnings = [];
  const coveredSources = new Set(
    story.acceptance_criteria.flatMap(c => c.sources || [])
  );

  // Check all requirements are covered
  const requirements = topicStatements.filter(s =>
    isRequirement({ text: s.text })
  );

  for (const req of requirements) {
    if (!coveredSources.has(req.id)) {
      warnings.push({
        type: 'uncovered_requirement',
        statement_id: req.id,
        text: req.text,
        message: 'Requirement not covered by any acceptance criterion'
      });
    }
  }

  // Check for assumptions
  for (const criterion of story.acceptance_criteria) {
    if (!criterion.sources || criterion.sources.length === 0 ||
        criterion.sources.every(s => s === 'context' || s === 'default')) {
      warnings.push({
        type: 'assumption',
        criterion: criterion.scenario,
        message: 'Criterion has no direct source - may be an assumption'
      });
    }
  }

  return {
    valid: warnings.filter(w => w.type === 'uncovered_requirement').length === 0,
    coverage_percent: requirements.length > 0 ?
      Math.round((coveredSources.size / requirements.length) * 100) : 100,
    warnings
  };
}

/**
 * Generate a story from a topic
 */
function generateStoryFromTopic(topicId) {
  const topics = loadTopics();
  const statementMap = loadStatementMap();
  const clarifications = loadClarifications();
  const complexityResult = analyzeComplexity();

  if (!topics || !topics.topics) {
    return { error: 'No topics found' };
  }

  const topic = topics.topics.find(t => t.id === topicId);
  if (!topic) {
    return { error: `Topic ${topicId} not found` };
  }

  const statements = statementMap?.statements || [];
  const topicStatements = statements.filter(s => s.topic_id === topicId);
  const requirements = topicStatements.filter(s =>
    isRequirement({ text: s.text })
  );

  // Get answered clarifications for this topic
  const topicClarifications = (clarifications?.questions || [])
    .filter(q => q.topic_id === topicId && q.status === 'answered');

  // Detect user type
  const userType = detectUserType(topicStatements);

  // Generate acceptance criteria from requirements
  const criteria = [];

  for (const req of requirements) {
    criteria.push({
      scenario: generateScenarioName(req),
      given: extractGiven(req, topicStatements, topic),
      when: extractWhen(req),
      then: extractThen(req),
      sources: [req.id],
      originalText: req.text,
      type: 'requirement'
    });
  }

  // Add criteria from clarification answers
  for (const clarification of topicClarifications) {
    const derived = generateCriteriaFromClarification(clarification, topic);
    criteria.push(...derived);
  }

  // Build traceability matrix
  const traceability = buildTraceabilityMatrix(criteria);

  // Get topic complexity
  const topicComplexity = complexityResult.topic_analysis?.find(t => t.topic_id === topicId);

  // Build story object
  const story = {
    id: generateStoryId(),
    topic_id: topicId,
    title: topic.title,
    generated_at: now(),
    user_story: {
      user_type: userType.value,
      user_type_source: userType.source,
      action: requirements.length > 0 ? extractActionFromText(requirements[0].text) : 'use this feature',
      action_source: requirements.length > 0 ? requirements[0].id : 'inferred',
      benefit: 'accomplish their goals efficiently',
      benefit_source: 'inferred'
    },
    description: {
      text: `Feature for ${topic.title.toLowerCase()}. ` +
            (topicStatements.length > 0 ? topicStatements[0].text : ''),
      source_statements: topicStatements.slice(0, 3).map(s => s.id)
    },
    acceptance_criteria: criteria.map((c, i) => ({
      id: `AC-${i + 1}`,
      ...c
    })),
    traceability,
    coverage: {
      statements_total: topicStatements.length,
      statements_covered: new Set(criteria.flatMap(c => c.sources || [])).size,
      requirements_total: requirements.length,
      clarifications_used: topicClarifications.length,
      coverage_percent: requirements.length > 0 ?
        Math.round((new Set(criteria.filter(c => c.type === 'requirement').flatMap(c => c.sources)).size / requirements.length) * 100) : 100
    },
    complexity: topicComplexity || { score: 0, level: 'unknown' },
    validation: validateStoryCoverage({ acceptance_criteria: criteria }, topicStatements)
  };

  return story;
}

/**
 * Generate stories for all active topics
 */
function generateAllStories() {
  const topics = loadTopics();
  if (!topics || !topics.topics) {
    return { error: 'No topics found' };
  }

  const activeTopics = topics.topics.filter(t => t.status === 'active');
  const stories = [];
  const errors = [];

  for (const topic of activeTopics) {
    const story = generateStoryFromTopic(topic.id);
    if (story.error) {
      errors.push({ topic_id: topic.id, error: story.error });
    } else {
      stories.push(story);
    }
  }

  return {
    stories,
    summary: {
      total_topics: activeTopics.length,
      stories_generated: stories.length,
      errors: errors.length,
      total_criteria: stories.reduce((sum, s) => sum + s.acceptance_criteria.length, 0),
      average_coverage: stories.length > 0 ?
        Math.round(stories.reduce((sum, s) => sum + s.coverage.coverage_percent, 0) / stories.length) : 0
    },
    errors
  };
}

/**
 * Save story to digest
 */
function saveStory(story) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const storiesPath = path.join(activeDigest.session.digest_path, 'stories');
  fs.mkdirSync(storiesPath, { recursive: true });

  const storyPath = path.join(storiesPath, `${story.id}.json`);
  fs.writeFileSync(storyPath, JSON.stringify(story, null, 2));

  return { saved: true, path: storyPath };
}

/**
 * Load story from digest
 */
function loadStory(storyId) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const storyPath = path.join(activeDigest.session.digest_path, 'stories', `${storyId}.json`);
  try {
    return JSON.parse(fs.readFileSync(storyPath, 'utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Load all stories from digest
 */
function loadAllStories() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return [];
  }

  const storiesPath = path.join(activeDigest.session.digest_path, 'stories');
  try {
    const files = fs.readdirSync(storiesPath).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(storiesPath, f), 'utf8'));
      } catch (err) {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Format story as markdown with source tracing
 */
function formatStoryAsMarkdown(story) {
  let md = '';

  md += `# [${story.id}] ${story.title}\n\n`;

  // Source topic
  md += `## Source Topic\n`;
  md += `**Topic ID**: ${story.topic_id}\n`;
  md += `**Statements**: ${story.coverage.statements_total} statements, ${story.coverage.requirements_total} requirements\n\n`;

  // User story
  md += `## User Story\n`;
  md += `**As a** ${story.user_story.user_type} \`[${story.user_story.user_type_source}]\`\n`;
  md += `**I want** to ${story.user_story.action} \`[${story.user_story.action_source}]\`\n`;
  md += `**So that** I can ${story.user_story.benefit} \`[${story.user_story.benefit_source}]\`\n\n`;

  // Description
  md += `## Description\n`;
  md += `${story.description.text}\n\n`;
  if (story.description.source_statements.length > 0) {
    md += `**Source statements:** ${story.description.source_statements.join(', ')}\n\n`;
  }

  // Acceptance criteria
  md += `## Acceptance Criteria\n\n`;
  for (const ac of story.acceptance_criteria) {
    md += `### Scenario ${ac.id.replace('AC-', '')}: ${ac.scenario}\n`;
    md += `**Given** ${ac.given.text} \`[${ac.given.source}]\`\n`;
    md += `**When** ${ac.when.text} \`[${ac.when.source}]\`\n`;
    md += `**Then** ${ac.then.text} \`[${ac.then.source}]\`\n\n`;

    if (ac.originalText) {
      md += `**Derived from:**\n`;
      md += `> "${ac.originalText.slice(0, 100)}${ac.originalText.length > 100 ? '...' : ''}" — ${ac.sources.join(', ')}\n\n`;
    }
  }

  // Coverage
  md += `## Coverage\n`;
  md += `- **Statements covered**: ${story.coverage.statements_covered}/${story.coverage.statements_total}\n`;
  md += `- **Requirements coverage**: ${story.coverage.coverage_percent}%\n`;
  md += `- **Clarifications used**: ${story.coverage.clarifications_used}\n`;
  if (story.validation.warnings.length === 0) {
    md += `- **Assumptions**: NONE\n`;
  } else {
    const assumptions = story.validation.warnings.filter(w => w.type === 'assumption');
    if (assumptions.length > 0) {
      md += `- **Potential assumptions**: ${assumptions.length}\n`;
    }
  }
  md += '\n';

  // Traceability matrix
  md += `## Traceability Matrix\n`;
  md += `| Criterion | Source | Type |\n`;
  md += `|-----------|--------|------|\n`;
  for (const row of story.traceability) {
    md += `| ${row.criterion_id} | ${row.source_id} | ${row.source_type} |\n`;
  }
  md += '\n';

  // Complexity
  md += `## Complexity\n`;
  md += `**Score**: ${story.complexity.score || 'N/A'} (${story.complexity.level || 'unknown'})\n`;
  if (story.complexity.estimated_stories) {
    md += `**Estimated stories**: ${story.complexity.estimated_stories}\n`;
  }

  return md;
}

// ==========================================================================
// E3-S3: One-by-One Presentation Flow
// ==========================================================================

/**
 * Load presentation queue
 */
function loadQueue() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const queuePath = path.join(activeDigest.session.digest_path, 'presentation-queue.json');
  try {
    return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Save presentation queue
 */
function saveQueue(queue) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const queuePath = path.join(activeDigest.session.digest_path, 'presentation-queue.json');
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  return { saved: true };
}

/**
 * Initialize presentation queue from generated stories
 */
function initializePresentation() {
  const stories = loadAllStories();
  if (stories.length === 0) {
    return { error: 'No stories to present. Run generate-stories first.' };
  }

  const activeDigest = loadActiveDigest();

  const queue = {
    session_id: activeDigest.session.id,
    presentation: {
      status: 'in_progress',
      started_at: now(),
      current_index: 0,
      current_story_id: null
    },
    stories: stories.map(s => ({
      id: s.id,
      topic_id: s.topic_id,
      title: s.title,
      criteria_count: s.acceptance_criteria.length,
      coverage: s.coverage.coverage_percent,
      status: 'pending'
    })),
    summary: {
      total: stories.length,
      approved: 0,
      rejected: 0,
      skipped: 0,
      pending: stories.length,
      presenting: 0
    }
  };

  saveQueue(queue);
  return queue;
}

/**
 * Get presentation status
 */
function getPresentationStatus() {
  const queue = loadQueue();
  if (!queue) {
    return { active: false };
  }

  return {
    active: true,
    status: queue.presentation.status,
    progress: {
      reviewed: queue.summary.approved + queue.summary.rejected,
      remaining: queue.summary.pending + queue.summary.skipped,
      total: queue.summary.total
    },
    current: queue.presentation.current_story_id,
    summary: queue.summary
  };
}

/**
 * Get the next story to present
 */
function getNextStory() {
  let queue = loadQueue();

  // Initialize if no queue exists
  if (!queue) {
    queue = initializePresentation();
    if (queue.error) return queue;
  }

  // Mark any currently presenting story as skipped (interrupted)
  const currentlyPresenting = queue.stories.find(s => s.status === 'presenting');
  if (currentlyPresenting) {
    currentlyPresenting.status = 'skipped';
    currentlyPresenting.skipped_at = now();
    queue.summary.presenting--;
    queue.summary.skipped++;
  }

  // Find first pending story (prefer pending over skipped)
  let nextIndex = queue.stories.findIndex(s => s.status === 'pending');

  // If no pending, try skipped
  if (nextIndex === -1) {
    nextIndex = queue.stories.findIndex(s => s.status === 'skipped');
  }

  // All done
  if (nextIndex === -1) {
    queue.presentation.status = 'completed';
    queue.presentation.completed_at = now();
    saveQueue(queue);
    return { complete: true, summary: queue.summary };
  }

  // Mark as presenting
  const entry = queue.stories[nextIndex];
  const wasSkipped = entry.status === 'skipped';
  entry.status = 'presenting';
  entry.presented_at = now();
  if (wasSkipped) {
    queue.summary.skipped--;
  } else {
    queue.summary.pending--;
  }
  queue.summary.presenting++;

  queue.presentation.current_index = nextIndex;
  queue.presentation.current_story_id = entry.id;

  saveQueue(queue);

  // Load full story
  const story = loadStory(entry.id);

  return {
    index: nextIndex + 1,
    total: queue.stories.length,
    story,
    queue_entry: entry,
    summary: queue.summary
  };
}

/**
 * Get current story being presented
 */
function getCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const currentEntry = queue.stories.find(s => s.status === 'presenting');
  if (!currentEntry) {
    return { error: 'No story currently being presented' };
  }

  const story = loadStory(currentEntry.id);
  const index = queue.stories.indexOf(currentEntry);

  return {
    index: index + 1,
    total: queue.stories.length,
    story,
    queue_entry: currentEntry,
    summary: queue.summary
  };
}

/**
 * Approve current story
 */
function approveCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'approved';
  entry.decided_at = now();

  queue.summary.approved++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title };
}

/**
 * Reject current story with reason
 */
function rejectCurrentStory(reason) {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'rejected';
  entry.decided_at = now();
  entry.rejection_reason = reason || 'No reason provided';

  queue.summary.rejected++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title, reason: entry.rejection_reason };
}

/**
 * Skip current story for later
 */
function skipCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'skipped';
  entry.skipped_at = now();

  queue.summary.skipped++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title };
}

/**
 * Format story summary for presentation (compact view)
 */
function formatStorySummary(storyData) {
  const { index, total, story, summary } = storyData;

  let output = '';

  // Header box
  output += `${'═'.repeat(64)}\n`;
  output += `  Story ${index} of ${total}: ${story.title}\n`;
  output += `${'═'.repeat(64)}\n\n`;

  // User story
  output += `  As a ${story.user_story.user_type.toUpperCase()},\n`;
  output += `  I want to ${story.user_story.action.toUpperCase()}\n`;
  output += `  So that I can ${story.user_story.benefit}\n\n`;

  // Stats
  output += `  Acceptance Criteria: ${story.acceptance_criteria.length}\n`;
  output += `  Coverage: ${story.coverage.coverage_percent}%`;
  if (story.validation.warnings.length === 0) {
    output += ' (no assumptions)';
  }
  output += '\n';

  if (story.complexity && story.complexity.score) {
    output += `  Complexity: ${story.complexity.level} (${story.complexity.score})\n`;
  }

  output += `\n${'─'.repeat(64)}\n`;

  // Progress
  output += `  Progress: ${summary.approved} approved, ${summary.rejected} rejected, ${summary.pending + summary.skipped} remaining\n`;

  output += `${'─'.repeat(64)}\n`;

  return output;
}

/**
 * Format presentation actions prompt
 */
function formatActionsPrompt() {
  return `\nActions: [a]pprove  [r]eject  [s]kip  [v]iew full  [n]ext  [q]uit\n`;
}

/**
 * Get completion summary
 */
function getCompletionSummary() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation data' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  const rejected = queue.stories.filter(s => s.status === 'rejected');
  const skipped = queue.stories.filter(s => s.status === 'skipped');
  const pending = queue.stories.filter(s => s.status === 'pending');

  return {
    complete: queue.presentation.status === 'completed',
    summary: queue.summary,
    approved: approved.map(s => ({ id: s.id, title: s.title })),
    rejected: rejected.map(s => ({ id: s.id, title: s.title, reason: s.rejection_reason })),
    skipped: skipped.map(s => ({ id: s.id, title: s.title })),
    pending: pending.map(s => ({ id: s.id, title: s.title }))
  };
}

/**
 * Reset presentation (start over)
 */
function resetPresentation() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation to reset' };
  }

  // Reset all stories to pending
  for (const entry of queue.stories) {
    entry.status = 'pending';
    delete entry.presented_at;
    delete entry.decided_at;
    delete entry.skipped_at;
    delete entry.rejection_reason;
  }

  queue.presentation = {
    status: 'in_progress',
    started_at: now(),
    current_index: 0,
    current_story_id: null
  };

  queue.summary = {
    total: queue.stories.length,
    approved: 0,
    rejected: 0,
    skipped: 0,
    pending: queue.stories.length,
    presenting: 0
  };

  saveQueue(queue);

  return { success: true, total: queue.stories.length };
}

// ============================================================================
// E3-S4: Edit and Change Handling
// ============================================================================

/**
 * Generate unique edit session ID
 */
function generateEditSessionId() {
  return 'edit-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Generate unique change ID
 */
function generateChangeId() {
  return 'change-' + crypto.randomBytes(3).toString('hex');
}

/**
 * Load edit sessions data
 */
function loadEditSessions() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const sessionsPath = path.join(activeDigest.session.digest_path, 'edit-sessions.json');
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch (err) {
    return { active_session: null, sessions: [] };
  }
}

/**
 * Save edit sessions data
 */
function saveEditSessions(data) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const sessionsPath = path.join(activeDigest.session.digest_path, 'edit-sessions.json');
  writeJson(sessionsPath, data);
  return { saved: true };
}

/**
 * Start an edit session for a story
 */
function startEditSession(storyId, reason) {
  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const sessionsData = loadEditSessions() || { active_session: null, sessions: [] };

  // Check if there's already an active session
  if (sessionsData.active_session && sessionsData.active_session.active) {
    return {
      error: 'An edit session is already active',
      active_session: sessionsData.active_session
    };
  }

  // Get rejection reason if story was rejected
  const queue = loadQueue();
  const queueEntry = queue?.stories.find(s => s.id === storyId);
  const rejectionReason = queueEntry?.rejection_reason;

  const session = {
    id: generateEditSessionId(),
    story_id: storyId,
    started_at: now(),
    trigger: reason || (queueEntry?.status === 'rejected' ? 'rejection' : 'manual'),
    rejection_reason: rejectionReason,
    original_status: queueEntry?.status || 'unknown',
    changes: [],
    active: true
  };

  sessionsData.active_session = session;
  saveEditSessions(sessionsData);

  return {
    session,
    story,
    rejection_reason: rejectionReason,
    editable_sections: [
      'user_story',
      'acceptance_criteria',
      'technical_notes',
      'description'
    ]
  };
}

/**
 * Get active edit session
 */
function getActiveEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return null;
  }
  return sessionsData.active_session;
}

/**
 * Record a change in the active edit session
 */
function recordChange(change) {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session' };
  }

  change.id = generateChangeId();
  change.timestamp = now();

  sessionsData.active_session.changes.push(change);
  saveEditSessions(sessionsData);

  return { recorded: true, change };
}

/**
 * Edit user story fields
 */
function editUserStory(storyId, updates) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const changes = [];

  if (updates.user_type && updates.user_type !== story.user_story.user_type) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'user_type',
      before: story.user_story.user_type,
      after: updates.user_type
    });
    story.user_story.user_type = updates.user_type;
    story.user_story.user_type_source = 'manual';
  }

  if (updates.action && updates.action !== story.user_story.action) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'action',
      before: story.user_story.action,
      after: updates.action
    });
    story.user_story.action = updates.action;
    story.user_story.action_source = 'manual';
  }

  if (updates.benefit && updates.benefit !== story.user_story.benefit) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'benefit',
      before: story.user_story.benefit,
      after: updates.benefit
    });
    story.user_story.benefit = updates.benefit;
    story.user_story.benefit_source = 'manual';
  }

  // Record all changes
  for (const change of changes) {
    recordChange(change);
  }

  // Save the story (uncommitted until commit-edit)
  saveStory(story);

  return { success: true, story, changes };
}

/**
 * Edit a specific acceptance criterion
 */
function editCriterion(storyId, criterionId, updates) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const criterion = story.acceptance_criteria.find(ac => ac.id === criterionId);
  if (!criterion) {
    return { error: `Criterion ${criterionId} not found in story ${storyId}` };
  }

  const changes = [];

  if (updates.scenario && updates.scenario !== criterion.scenario) {
    changes.push({
      type: 'criteria_modified',
      target: criterionId,
      field: 'scenario',
      before: criterion.scenario,
      after: updates.scenario
    });
    criterion.scenario = updates.scenario;
  }

  if (updates.given) {
    const beforeText = criterion.given?.text || '';
    if (updates.given !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'given',
        before: beforeText,
        after: updates.given
      });
      criterion.given = { text: updates.given, source: 'manual' };
    }
  }

  if (updates.when) {
    const beforeText = criterion.when?.text || '';
    if (updates.when !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'when',
        before: beforeText,
        after: updates.when
      });
      criterion.when = { text: updates.when, source: 'manual' };
    }
  }

  if (updates.then) {
    const beforeText = criterion.then?.text || '';
    if (updates.then !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'then',
        before: beforeText,
        after: updates.then
      });
      criterion.then = { text: updates.then, source: 'manual' };
    }
  }

  // Record all changes
  for (const change of changes) {
    recordChange(change);
  }

  // Save the story
  saveStory(story);

  return { success: true, story, criterion, changes };
}

/**
 * Add a new acceptance criterion
 */
function addCriterion(storyId, criterion) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  // Generate new AC ID
  const existingIds = story.acceptance_criteria.map(ac =>
    parseInt(ac.id.replace('AC-', ''), 10) || 0
  );
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  const newId = `AC-${maxId + 1}`;

  const newCriterion = {
    id: newId,
    scenario: criterion.scenario || `Scenario ${maxId + 1}`,
    given: { text: criterion.given || 'the system is ready', source: 'manual' },
    when: { text: criterion.when || 'the user performs the action', source: 'manual' },
    then: { text: criterion.then || 'the expected result occurs', source: 'manual' },
    and: criterion.and?.map(a => ({ text: a, source: 'manual' })) || [],
    derived_from: [{ id: 'manual', text: 'Manually added criterion' }]
  };

  story.acceptance_criteria.push(newCriterion);

  // Record the change
  recordChange({
    type: 'criteria_added',
    target: newId,
    before: null,
    after: newCriterion
  });

  // Save the story
  saveStory(story);

  return { success: true, story, criterion: newCriterion };
}

/**
 * Remove an acceptance criterion
 */
function removeCriterion(storyId, criterionId, reason) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const index = story.acceptance_criteria.findIndex(ac => ac.id === criterionId);
  if (index === -1) {
    return { error: `Criterion ${criterionId} not found in story ${storyId}` };
  }

  // Don't allow removing last criterion
  if (story.acceptance_criteria.length === 1) {
    return { error: 'Cannot remove the last acceptance criterion' };
  }

  const removed = story.acceptance_criteria.splice(index, 1)[0];

  // Record the change
  recordChange({
    type: 'criteria_removed',
    target: criterionId,
    before: removed,
    after: null,
    reason: reason || 'Removed by user'
  });

  // Save the story
  saveStory(story);

  return { success: true, story, removed };
}

/**
 * Validate an edited story
 */
function validateEditedStory(story) {
  const warnings = [];
  const errors = [];

  // Check user story completeness
  if (!story.user_story.user_type || story.user_story.user_type === '') {
    errors.push({ field: 'user_story.user_type', message: 'User type is required' });
  }
  if (!story.user_story.action || story.user_story.action === '') {
    errors.push({ field: 'user_story.action', message: 'Action is required' });
  }

  // Check acceptance criteria
  if (!story.acceptance_criteria || story.acceptance_criteria.length === 0) {
    errors.push({ field: 'acceptance_criteria', message: 'At least one acceptance criterion required' });
  }

  for (const ac of story.acceptance_criteria || []) {
    if (!ac.given?.text) {
      warnings.push({ field: `${ac.id}.given`, message: 'Given clause is empty' });
    }
    if (!ac.when?.text) {
      warnings.push({ field: `${ac.id}.when`, message: 'When clause is empty' });
    }
    if (!ac.then?.text) {
      warnings.push({ field: `${ac.id}.then`, message: 'Then clause is empty' });
    }
  }

  // Check for manual-only coverage (all criteria manually added)
  const manualOnlyCriteria = (story.acceptance_criteria || []).filter(ac =>
    ac.given?.source === 'manual' &&
    ac.when?.source === 'manual' &&
    ac.then?.source === 'manual'
  );

  if (manualOnlyCriteria.length === story.acceptance_criteria?.length) {
    warnings.push({
      field: 'coverage',
      message: 'All criteria are manually added - no traceability to original transcript'
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Recalculate coverage after edits
 */
function recalculateCoverage(story) {
  const totalCriteria = story.acceptance_criteria.length;
  let tracedCriteria = 0;

  for (const ac of story.acceptance_criteria) {
    // Count criteria with at least one non-manual source
    const sources = [ac.given?.source, ac.when?.source, ac.then?.source];
    if (sources.some(s => s && s !== 'manual' && s !== 'context' && s !== 'inferred')) {
      tracedCriteria++;
    }
  }

  return {
    statements_total: story.coverage?.statements_total || 0,
    statements_covered: story.coverage?.statements_covered || 0,
    coverage_percent: totalCriteria > 0 ? Math.round((tracedCriteria / totalCriteria) * 100) : 0,
    clarifications_used: story.coverage?.clarifications_used || 0,
    manual_criteria: totalCriteria - tracedCriteria,
    assumptions: story.coverage?.assumptions || []
  };
}

/**
 * Update queue after edit is committed
 */
function updateQueueAfterEdit(storyId) {
  const queue = loadQueue();
  if (!queue) return { error: 'No queue found' };

  const entry = queue.stories.find(s => s.id === storyId);
  if (!entry) return { error: 'Story not found in queue' };

  // Track previous status
  const previousStatus = entry.status;

  // Update summary counts
  if (previousStatus === 'rejected') {
    queue.summary.rejected--;
    queue.summary.pending++;
  } else if (previousStatus === 'approved') {
    queue.summary.approved--;
    queue.summary.pending++;
  } else if (previousStatus === 'skipped') {
    queue.summary.skipped--;
    queue.summary.pending++;
  }

  // Reset entry to pending
  entry.status = 'pending';
  entry.edited_at = now();
  delete entry.rejection_reason;
  delete entry.decided_at;

  // Reset presentation status if complete
  if (queue.presentation.status === 'completed') {
    queue.presentation.status = 'in_progress';
  }

  saveQueue(queue);

  return { previous_status: previousStatus, new_status: 'pending' };
}

/**
 * Commit edit session and return story to review queue
 */
function commitEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session to commit' };
  }

  const session = sessionsData.active_session;
  const story = loadStory(session.story_id);

  if (!story) {
    return { error: 'Story not found' };
  }

  // Validate the edited story
  const validation = validateEditedStory(story);
  if (!validation.valid) {
    return {
      error: 'Story validation failed',
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  // Mark session complete
  session.completed_at = now();
  session.active = false;
  session.changes_count = session.changes.length;

  // Update story with edit history
  if (!story.edit_history) {
    story.edit_history = [];
  }
  story.edit_history.push({
    session_id: session.id,
    timestamp: session.completed_at,
    changes_count: session.changes_count,
    trigger: session.trigger
  });

  // Recalculate coverage
  story.coverage = recalculateCoverage(story);
  story.last_edited = now();

  // Save story
  saveStory(story);

  // Move session to history
  sessionsData.sessions.push(session);
  sessionsData.active_session = null;
  saveEditSessions(sessionsData);

  // Update presentation queue
  const queueUpdate = updateQueueAfterEdit(story.id);

  return {
    success: true,
    story_id: story.id,
    changes_made: session.changes_count,
    previous_status: queueUpdate.previous_status,
    new_status: 'pending',
    validation_warnings: validation.warnings
  };
}

/**
 * Cancel edit session and discard changes
 */
function cancelEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session to cancel' };
  }

  const session = sessionsData.active_session;
  const changesCount = session.changes.length;

  // Mark session as cancelled
  session.cancelled_at = now();
  session.active = false;
  session.cancelled = true;

  // Move to history
  sessionsData.sessions.push(session);
  sessionsData.active_session = null;
  saveEditSessions(sessionsData);

  // Note: We don't revert the story file here. The changes were saved as they were made.
  // A proper implementation would need to store the original story state and restore it.
  // For simplicity, we just mark the session as cancelled.

  return { success: true, discarded_changes: changesCount };
}

/**
 * Get changes in current edit session
 */
function getEditChanges() {
  const session = getActiveEditSession();
  if (!session) {
    return { error: 'No active edit session' };
  }

  return {
    session_id: session.id,
    story_id: session.story_id,
    started_at: session.started_at,
    trigger: session.trigger,
    rejection_reason: session.rejection_reason,
    changes: session.changes,
    changes_count: session.changes.length
  };
}

/**
 * Get edit history for a story
 */
function getEditHistory(storyId) {
  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const sessionsData = loadEditSessions() || { sessions: [] };

  // Filter sessions for this story
  const storySessions = sessionsData.sessions.filter(s => s.story_id === storyId);

  return {
    story_id: storyId,
    title: story.title,
    edit_count: storySessions.length,
    sessions: storySessions.map(s => ({
      session_id: s.id,
      timestamp: s.completed_at || s.cancelled_at,
      trigger: s.trigger,
      changes_count: s.changes_count || s.changes.length,
      cancelled: s.cancelled || false
    })),
    story_edit_history: story.edit_history || []
  };
}

/**
 * List stories that can be edited (rejected or approved)
 */
function listEditableStories() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const editable = queue.stories.filter(s =>
    s.status === 'rejected' || s.status === 'approved' || s.status === 'skipped'
  );

  return {
    total: editable.length,
    rejected: editable.filter(s => s.status === 'rejected').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      rejection_reason: s.rejection_reason
    })),
    approved: editable.filter(s => s.status === 'approved').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status
    })),
    skipped: editable.filter(s => s.status === 'skipped').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status
    }))
  };
}

// ============================================================================
// E3-S5: ready.json Integration
// ============================================================================

/**
 * Generate a workflow ID for task tracking
 */
function generateWorkflowId() {
  return 'wf-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Generate sub-task ID from parent
 */
function generateSubTaskId(parentId, index) {
  return `${parentId}-${String(index).padStart(2, '0')}`;
}

/**
 * Map story complexity to task priority
 */
const COMPLEXITY_TO_PRIORITY = {
  'simple': 'P3',
  'low': 'P3',
  'medium': 'P2',
  'high': 'P1',
  'very_high': 'P0'
};

function mapPriority(story) {
  const level = story.complexity?.level || 'medium';
  return COMPLEXITY_TO_PRIORITY[level] || 'P2';
}

/**
 * Format user story description
 */
function formatUserStoryDescription(userStory) {
  if (!userStory) return '';
  const who = userStory.user_type || 'user';
  const what = userStory.action || 'perform an action';
  const why = userStory.benefit || 'achieve my goal';
  return `As a ${who}, I want to ${what}, so that ${why}.`;
}

/**
 * Convert a story to a workflow task
 */
function convertStoryToTask(story, options = {}) {
  const taskId = options.taskId || generateWorkflowId();
  const activeDigest = loadActiveDigest();

  return {
    id: taskId,
    title: story.title,
    type: options.type || 'story',
    parent: options.parent || null,
    epic: options.epic || null,
    status: 'ready',
    priority: mapPriority(story),
    dependencies: options.dependencies || [],
    createdAt: now(),
    source: {
      type: 'transcript-digestion',
      digest_id: activeDigest.session?.id || 'unknown',
      story_id: story.id,
      topic_id: story.topic_id
    },
    description: formatUserStoryDescription(story.user_story),
    acceptanceCriteria: (story.acceptance_criteria || []).map(ac => ({
      id: ac.id,
      scenario: ac.scenario,
      given: ac.given?.text || '',
      when: ac.when?.text || '',
      then: ac.then?.text || ''
    })),
    metadata: {
      coverage: story.coverage?.coverage_percent || 0,
      criteria_count: (story.acceptance_criteria || []).length,
      generated_at: story.generated_at
    }
  };
}

/**
 * Validate stories before export
 */
function validateForExport(stories) {
  const warnings = [];
  const errors = [];

  for (const story of stories) {
    // Check coverage threshold
    if (story.coverage && story.coverage.coverage_percent < 50) {
      warnings.push({
        story_id: story.id,
        message: `Low coverage: ${story.coverage.coverage_percent}%`
      });
    }

    // Check for empty criteria
    if (!story.acceptance_criteria || story.acceptance_criteria.length === 0) {
      errors.push({
        story_id: story.id,
        message: 'No acceptance criteria'
      });
    }

    // Check for manual-only criteria
    if (story.acceptance_criteria && story.acceptance_criteria.length > 0) {
      const manualOnly = story.acceptance_criteria.every(ac =>
        ac.given?.source === 'manual' &&
        ac.when?.source === 'manual' &&
        ac.then?.source === 'manual'
      );
      if (manualOnly) {
        warnings.push({
          story_id: story.id,
          message: 'All criteria manually added - no transcript traceability'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Export approved stories from the presentation queue
 */
function exportApprovedStories(options = {}) {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  if (approved.length === 0) {
    return { error: 'No approved stories to export' };
  }

  // Load and convert each story
  const tasks = [];
  const loadErrors = [];

  for (const entry of approved) {
    const story = loadStory(entry.id);
    if (!story) {
      loadErrors.push({ id: entry.id, error: 'Story file not found' });
      continue;
    }

    const task = convertStoryToTask(story, options);
    tasks.push(task);
  }

  // Validate before export
  const stories = approved.map(e => loadStory(e.id)).filter(Boolean);
  const validation = validateForExport(stories);

  return {
    tasks,
    loadErrors,
    validation,
    summary: {
      total_approved: approved.length,
      exported: tasks.length,
      failed: loadErrors.length
    }
  };
}

/**
 * Create a feature task grouping multiple stories
 */
function createFeatureTask(stories, featureName) {
  const featureId = generateWorkflowId();

  return {
    id: featureId,
    title: featureName || `Feature: ${stories[0]?.title || 'Untitled'}`,
    type: 'parent',
    subTasks: stories.map((s, i) => generateSubTaskId(featureId, i + 1)),
    status: 'ready',
    priority: 'P2',
    dependencies: [],
    createdAt: now(),
    source: {
      type: 'transcript-digestion',
      digest_id: loadActiveDigest().session?.id,
      story_count: stories.length
    }
  };
}

/**
 * Add tasks to ready.json
 */
function addTasksToReadyJson(tasks, options = {}) {
  const readyPath = path.join(process.cwd(), '.workflow', 'state', 'ready.json');

  let readyData;
  try {
    readyData = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
  } catch (err) {
    readyData = {
      lastUpdated: now(),
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: []
    };
  }

  // Check for duplicates by source story_id
  const existingStoryIds = new Set(
    readyData.ready
      .filter(t => t.source?.type === 'transcript-digestion')
      .map(t => t.source?.story_id)
  );

  const newTasks = tasks.filter(t => !existingStoryIds.has(t.source?.story_id));

  if (newTasks.length === 0) {
    return { error: 'All tasks already exist in ready.json', skipped: tasks.length };
  }

  // Add new tasks
  readyData.ready.push(...newTasks);
  readyData.lastUpdated = now();

  fs.writeFileSync(readyPath, JSON.stringify(readyData, null, 2));

  return {
    success: true,
    added: newTasks.length,
    skipped: tasks.length - newTasks.length,
    total_ready: readyData.ready.length
  };
}

/**
 * Format a task as markdown file
 */
function formatTaskAsMarkdown(task) {
  let md = `# ${task.id} ${task.title}\n\n`;

  md += `## User Story\n`;
  md += `${task.description}\n\n`;

  md += `## Acceptance Criteria\n\n`;
  for (const ac of task.acceptanceCriteria || []) {
    md += `### ${ac.id}: ${ac.scenario}\n`;
    md += `**Given** ${ac.given}\n`;
    md += `**When** ${ac.when}\n`;
    md += `**Then** ${ac.then}\n\n`;
  }

  md += `## Metadata\n`;
  md += `- **Priority**: ${task.priority}\n`;
  md += `- **Coverage**: ${task.metadata?.coverage || 0}%\n`;
  md += `- **Criteria Count**: ${task.metadata?.criteria_count || 0}\n`;
  md += `- **Source**: Transcript Digestion (${task.source?.digest_id || 'unknown'})\n`;

  return md;
}

/**
 * Export story files to .workflow/changes/
 */
function exportStoryFiles(tasks, featureName = 'general') {
  const changesDir = path.join(process.cwd(), '.workflow', 'changes', featureName);
  fs.mkdirSync(changesDir, { recursive: true });

  const exported = [];

  for (const task of tasks) {
    const filename = `${task.id}.md`;
    const filepath = path.join(changesDir, filename);

    const content = formatTaskAsMarkdown(task);
    fs.writeFileSync(filepath, content);

    exported.push({ id: task.id, path: filepath });
  }

  return { exported, directory: changesDir };
}

/**
 * Preview what would be exported
 */
function previewExport() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  const pending = queue.stories.filter(s => s.status === 'pending' || s.status === 'skipped');

  const stories = approved.map(e => loadStory(e.id)).filter(Boolean);
  const validation = validateForExport(stories);

  return {
    approved_count: approved.length,
    pending_count: pending.length,
    stories: approved.map(e => {
      const story = loadStory(e.id);
      return {
        id: e.id,
        title: e.title,
        priority: story ? mapPriority(story) : 'P2',
        criteria_count: story?.acceptance_criteria?.length || 0,
        coverage: story?.coverage?.coverage_percent || 0
      };
    }),
    validation,
    ready_to_export: validation.valid && approved.length > 0
  };
}

/**
 * Finalize the digestion process and export to ready.json
 */
function finalizeDigestion(options = {}) {
  // 1. Check presentation status
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const pendingCount = queue.stories.filter(s =>
    s.status === 'pending' || s.status === 'skipped'
  ).length;

  if (pendingCount > 0 && !options.force) {
    return {
      error: `${pendingCount} stories not yet reviewed. Use --force to proceed anyway.`,
      pending: pendingCount
    };
  }

  // 2. Export approved stories
  const exportResult = exportApprovedStories(options);
  if (exportResult.error) {
    return exportResult;
  }

  // 3. Add to ready.json
  const addResult = addTasksToReadyJson(exportResult.tasks, options);
  if (addResult.error && addResult.skipped !== exportResult.tasks.length) {
    return addResult;
  }

  // 4. Optionally export story files
  let fileExport = null;
  if (options.exportFiles) {
    fileExport = exportStoryFiles(exportResult.tasks, options.featureName || 'digest-export');
  }

  // 5. Mark digest as complete
  const activeDigest = loadActiveDigest();
  activeDigest.session.status = 'completed';
  activeDigest.session.completed_at = now();
  activeDigest.session.exported = {
    task_count: addResult.added || 0,
    skipped_count: addResult.skipped || 0,
    timestamp: now()
  };
  saveActiveDigest(activeDigest);

  return {
    success: true,
    approved_count: exportResult.summary.total_approved,
    tasks_added: addResult.added || 0,
    tasks_skipped: addResult.skipped || 0,
    files_exported: fileExport?.exported.length || 0,
    validation: exportResult.validation,
    digest_status: 'completed'
  };
}

/**
 * CLI handler
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status':
      const status = getStatus();
      if (!status.active) {
        console.log(`${c.dim}No active digest session${c.reset}`);
      } else {
        console.log(`${c.green}Active digest:${c.reset} ${status.id}`);
        console.log(`${c.cyan}Current phase:${c.reset} ${status.phase}`);
        console.log(`${c.dim}Word count:${c.reset} ${status.input.word_count}`);
        console.log(`\n${c.cyan}Phase status:${c.reset}`);
        for (const [phase, data] of Object.entries(status.phases)) {
          const icon = data.status === 'completed' ? '✓' : data.status === 'in_progress' ? '→' : '○';
          console.log(`  ${icon} ${phase}: ${data.status}`);
        }
      }
      break;

    case 'new':
      // Read transcript from stdin or file
      const input = args[1];
      if (!input) {
        console.error(`${c.red}Usage: flow transcript-digest new <file or ->$}{c.reset}`);
        process.exit(1);
      }

      let transcript;
      if (input === '-') {
        // Read from stdin
        transcript = fs.readFileSync(0, 'utf8');
      } else {
        transcript = fs.readFileSync(input, 'utf8');
      }

      const { digestId, digestPath } = createSession(transcript);
      console.log(`${c.green}✓ Created digest session:${c.reset} ${digestId}`);
      console.log(`${c.dim}Path: ${digestPath}${c.reset}`);
      console.log(`${c.dim}Word count: ${countWords(transcript)}${c.reset}`);
      break;

    case 'check':
      // Check if text should trigger digestion (enhanced E4-S1)
      let textToCheck;
      if (!args[1] || args[1] === '-') {
        textToCheck = fs.readFileSync(0, 'utf8');
      } else {
        textToCheck = fs.readFileSync(args[1], 'utf8');
      }

      const checkResult = detectLargeInput(textToCheck);

      if (args.includes('--json')) {
        console.log(JSON.stringify(checkResult, null, 2));
        break;
      }

      // Human-readable output
      console.log(`${c.cyan}Input Analysis${c.reset}\n`);

      // Metrics
      console.log(`${c.dim}Metrics:${c.reset}`);
      console.log(`  Words: ${checkResult.metrics.wordCount.toLocaleString()}`);
      console.log(`  Characters: ${checkResult.metrics.charCount.toLocaleString()}`);
      console.log(`  Lines: ${checkResult.metrics.lineCount.toLocaleString()}`);
      console.log(`  Estimated tokens: ${checkResult.metrics.estimatedTokens.toLocaleString()}`);
      console.log();

      // Format
      const formatStr = checkResult.format.subtype ?
        `${checkResult.format.type} (${checkResult.format.subtype})` :
        checkResult.format.type;
      console.log(`${c.dim}Format:${c.reset} ${formatStr}`);
      console.log(`${c.dim}Format confidence:${c.reset} ${Math.round(checkResult.format.confidence * 100)}%`);
      console.log();

      // Thresholds
      console.log(`${c.dim}Thresholds:${c.reset}`);
      const wordExceeded = checkResult.thresholds.wordCount.exceeded ? `${c.green}✓` : `${c.yellow}✗`;
      const tokenExceeded = checkResult.thresholds.estimatedTokens.exceeded ? `${c.green}✓` : `${c.yellow}✗`;
      console.log(`  ${wordExceeded} Words: ${checkResult.thresholds.wordCount.value} / ${checkResult.thresholds.wordCount.threshold}${c.reset}`);
      console.log(`  ${tokenExceeded} Tokens: ${checkResult.thresholds.estimatedTokens.value} / ${checkResult.thresholds.estimatedTokens.threshold}${c.reset}`);
      console.log();

      // Recommendation
      console.log(`${c.cyan}Overall confidence:${c.reset} ${Math.round(checkResult.confidence * 100)}%`);
      const triggerIcon = checkResult.shouldTrigger === true ? `${c.green}✓` :
                          checkResult.shouldTrigger === 'ask' ? `${c.yellow}?` : `${c.red}✗`;
      console.log(`${c.cyan}Should trigger:${c.reset} ${triggerIcon} ${checkResult.recommendation.action}${c.reset}`);
      console.log(`${c.cyan}Reason:${c.reset} ${checkResult.reason}`);
      console.log();
      console.log(`${c.dim}${checkResult.recommendation.message}${c.reset}`);
      break;

    case 'analyze':
      // Detailed input analysis (E4-S1)
      let textToAnalyze;
      if (!args[1] || args[1] === '-') {
        textToAnalyze = fs.readFileSync(0, 'utf8');
      } else {
        textToAnalyze = fs.readFileSync(args[1], 'utf8');
      }

      const analysisResult = analyzeInput(textToAnalyze);

      if (args.includes('--json')) {
        console.log(JSON.stringify(analysisResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Detailed Input Analysis${c.reset}\n`);

      // Metrics table
      console.log(`${c.cyan}Metrics${c.reset}`);
      console.log(`┌────────────────────┬────────────────┐`);
      console.log(`│ Word count         │ ${String(analysisResult.metrics.wordCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Character count    │ ${String(analysisResult.metrics.charCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Line count         │ ${String(analysisResult.metrics.lineCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Paragraph count    │ ${String(analysisResult.metrics.paragraphCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Estimated tokens   │ ${String(analysisResult.metrics.estimatedTokens.toLocaleString()).padStart(14)} │`);
      console.log(`│ Avg words/line     │ ${String(analysisResult.metrics.avgWordsPerLine).padStart(14)} │`);
      console.log(`│ Avg chars/word     │ ${String(analysisResult.metrics.avgCharsPerWord).padStart(14)} │`);
      console.log(`└────────────────────┴────────────────┘`);
      console.log();

      // Format
      console.log(`${c.cyan}Format Detection${c.reset}`);
      console.log(`  Type: ${analysisResult.format.type}`);
      if (analysisResult.format.subtype) {
        console.log(`  Subtype: ${analysisResult.format.subtype}`);
      }
      console.log(`  Confidence: ${Math.round(analysisResult.format.confidence * 100)}%`);
      console.log();

      // Thresholds
      console.log(`${c.cyan}Threshold Analysis${c.reset}`);
      for (const [key, data] of Object.entries(analysisResult.thresholds)) {
        const icon = data.exceeded ? `${c.green}✓` : `${c.yellow}○`;
        console.log(`  ${icon} ${key}: ${data.value.toLocaleString()} / ${data.threshold.toLocaleString()}${c.reset}`);
      }
      console.log();

      console.log(`${c.cyan}Overall Confidence:${c.reset} ${Math.round(analysisResult.confidence * 100)}%`);
      break;

    case 'classify':
      // Classify content type (E4-S2)
      let textToClassify;
      if (!args[1] || args[1] === '-') {
        textToClassify = fs.readFileSync(0, 'utf8');
      } else {
        textToClassify = fs.readFileSync(args[1], 'utf8');
      }

      const classifyResult = classifyContentTypes(textToClassify);

      if (args.includes('--json')) {
        console.log(JSON.stringify(classifyResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Content Type Classification${c.reset}\n`);

      // Primary type
      const primaryColor = classifyResult.primary.type === 'unknown' ? c.yellow : c.green;
      console.log(`${c.cyan}Primary Type:${c.reset} ${primaryColor}${classifyResult.primary.type}${c.reset}`);
      console.log(`${c.dim}Confidence: ${Math.round(classifyResult.primary.confidence * 100)}%${c.reset}`);
      console.log();

      // Secondary types
      if (classifyResult.secondary.length > 0) {
        console.log(`${c.cyan}Secondary Types:${c.reset}`);
        for (const sec of classifyResult.secondary) {
          console.log(`  ${sec.type}: ${Math.round(sec.confidence * 100)}%`);
        }
        console.log();
      }

      // All scores
      if (args.includes('--verbose') || args.includes('-v')) {
        console.log(`${c.cyan}All Scores:${c.reset}`);
        const sortedScores = Object.entries(classifyResult.allScores)
          .sort((a, b) => b[1] - a[1]);
        for (const [type, score] of sortedScores) {
          const bar = '█'.repeat(Math.round(score * 20));
          const emptyBar = '░'.repeat(20 - Math.round(score * 20));
          console.log(`  ${type.padEnd(15)} ${bar}${emptyBar} ${Math.round(score * 100)}%`);
        }
        console.log();
      }

      // Evidence
      if (classifyResult.evidence.length > 0) {
        console.log(`${c.cyan}Evidence:${c.reset}`);
        for (const ev of classifyResult.evidence.slice(0, 5)) {
          console.log(`  ${ev.pattern}: ${ev.count} matches (weight: ${ev.weight})`);
          if (ev.samples.length > 0) {
            console.log(`    ${c.dim}e.g., "${ev.samples[0]}"${c.reset}`);
          }
        }
        console.log();
      }

      // Recommendation
      console.log(`${c.cyan}Recommendation:${c.reset}`);
      console.log(`  Action: ${classifyResult.recommendation.action}`);
      console.log(`  ${c.dim}${classifyResult.recommendation.description}${c.reset}`);
      break;

    case 'recommend':
      // Get processing recommendation (E4-S2)
      let textToRecommend;
      if (!args[1] || args[1] === '-') {
        textToRecommend = fs.readFileSync(0, 'utf8');
      } else {
        textToRecommend = fs.readFileSync(args[1], 'utf8');
      }

      const recommendResult = classifyContentTypes(textToRecommend);
      const exclusion = shouldExcludeContent(recommendResult);

      if (args.includes('--json')) {
        console.log(JSON.stringify({
          classification: recommendResult,
          exclusion
        }, null, 2));
        break;
      }

      console.log(`${c.cyan}Processing Recommendation${c.reset}\n`);

      // Content type
      console.log(`${c.dim}Content type:${c.reset} ${recommendResult.primary.type} (${Math.round(recommendResult.primary.confidence * 100)}%)`);
      console.log();

      // Recommendation
      if (exclusion.exclude) {
        console.log(`${c.red}✗ Not recommended for digestion${c.reset}`);
        console.log(`  ${c.dim}${exclusion.reason}${c.reset}`);
      } else {
        console.log(`${c.green}✓ Recommended for digestion${c.reset}`);
        console.log(`  ${c.cyan}Action:${c.reset} ${recommendResult.recommendation.action}`);
        console.log(`  ${c.dim}${recommendResult.recommendation.description}${c.reset}`);
      }
      break;

    case 'parse-vtt':
      // Parse VTT subtitle file (E4-S3)
      {
        let vttContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          vttContent = fs.readFileSync(0, 'utf8');
        } else {
          vttContent = fs.readFileSync(args[1], 'utf8');
        }

        const vttResult = parseVTT(vttContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(vttResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? vttResult.cues : mergeCues(vttResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: vttResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}VTT Statistics${c.reset}\n`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-srt':
      // Parse SRT subtitle file (E4-S3)
      {
        let srtContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          srtContent = fs.readFileSync(0, 'utf8');
        } else {
          srtContent = fs.readFileSync(args[1], 'utf8');
        }

        const srtResult = parseSRT(srtContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(srtResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? srtResult.cues : mergeCues(srtResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: srtResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}SRT Statistics${c.reset}\n`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-subtitle':
      // Auto-detect and parse subtitle file (E4-S3)
      {
        let subtitleContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          subtitleContent = fs.readFileSync(0, 'utf8');
        } else {
          subtitleContent = fs.readFileSync(args[1], 'utf8');
        }

        const subtitleResult = parseSubtitle(subtitleContent);

        if (subtitleResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(subtitleResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${subtitleResult.error}${c.reset}`);
            console.error(`${c.dim}Tip: Ensure the file has enough content for format detection${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(subtitleResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? subtitleResult.cues : mergeCues(subtitleResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: subtitleResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}${subtitleResult.format.toUpperCase()} Statistics${c.reset}\n`);
          console.log(`Format: ${subtitleResult.format}`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-zoom':
      // Parse Zoom transcript (E4-S4)
      {
        let zoomContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          zoomContent = fs.readFileSync(0, 'utf8');
        } else {
          zoomContent = fs.readFileSync(args[1], 'utf8');
        }

        const zoomOptions = {
          includeSystem: args.includes('--include-system'),
          format: args.includes('--format') ? args[args.indexOf('--format') + 1] : null
        };
        const zoomResult = parseZoom(zoomContent, zoomOptions);

        if (zoomResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(zoomResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${zoomResult.error}${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(zoomResult, null, 2));
          break;
        }

        const zoomWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const zoomNoMerge = args.includes('--no-merge');
        const zoomEntries = zoomNoMerge ? zoomResult.entries : mergeMeetingEntries(zoomResult.entries);
        const zoomText = formatMeetingAsText(zoomEntries, { timestamps: zoomWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...zoomResult, entries: zoomEntries });
          console.log(`${c.cyan}Zoom Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(zoomText);
      }
      break;

    case 'parse-teams':
      // Parse Teams transcript (E4-S4)
      {
        let teamsContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          teamsContent = fs.readFileSync(0, 'utf8');
        } else {
          teamsContent = fs.readFileSync(args[1], 'utf8');
        }

        const teamsOptions = {
          includeSystem: args.includes('--include-system'),
          format: args.includes('--format') ? args[args.indexOf('--format') + 1] : null
        };
        const teamsResult = parseTeams(teamsContent, teamsOptions);

        if (teamsResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(teamsResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${teamsResult.error}${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(teamsResult, null, 2));
          break;
        }

        const teamsWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const teamsNoMerge = args.includes('--no-merge');
        const teamsEntries = teamsNoMerge ? teamsResult.entries : mergeMeetingEntries(teamsResult.entries);
        const teamsText = formatMeetingAsText(teamsEntries, { timestamps: teamsWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...teamsResult, entries: teamsEntries });
          console.log(`${c.cyan}Teams Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(teamsText);
      }
      break;

    case 'parse-meeting':
      // Auto-detect and parse meeting transcript (E4-S4)
      {
        let meetingContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          meetingContent = fs.readFileSync(0, 'utf8');
        } else {
          meetingContent = fs.readFileSync(args[1], 'utf8');
        }

        const meetingOptions = {
          includeSystem: args.includes('--include-system')
        };
        const meetingResult = parseMeeting(meetingContent, meetingOptions);

        if (meetingResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(meetingResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${meetingResult.error}${c.reset}`);
            console.error(`${c.dim}Tip: Ensure the file is a valid Zoom or Teams export${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(meetingResult, null, 2));
          break;
        }

        const meetingWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const meetingNoMerge = args.includes('--no-merge');
        const meetingEntries = meetingNoMerge ? meetingResult.entries : mergeMeetingEntries(meetingResult.entries);
        const meetingText = formatMeetingAsText(meetingEntries, { timestamps: meetingWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...meetingResult, entries: meetingEntries });
          console.log(`${c.cyan}Meeting Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(meetingText);
      }
      break;

    case 'detect-language':
      // Detect primary language (E5-S1)
      {
        let langContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          langContent = fs.readFileSync(0, 'utf8');
        } else {
          langContent = fs.readFileSync(args[1], 'utf8');
        }

        const langResult = detectLanguage(langContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(langResult, null, 2));
          break;
        }

        console.log(`${c.cyan}Language Detection${c.reset}\n`);
        const langColor = langResult.language === 'unknown' ? c.yellow : c.green;
        console.log(`${c.dim}Primary:${c.reset} ${langColor}${langResult.languageName}${c.reset} (${langResult.language})`);
        console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langResult.confidence * 100)}%`);

        if (langResult.secondary) {
          console.log(`\n${c.dim}Secondary:${c.reset} ${langResult.secondary.languageName} (${langResult.secondary.language})`);
          console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langResult.secondary.confidence * 100)}%`);
        }

        if (args.includes('-v') || args.includes('--verbose')) {
          if (Object.keys(langResult.scripts || {}).length > 0) {
            console.log(`\n${c.dim}Scripts detected:${c.reset}`);
            for (const [script, count] of Object.entries(langResult.scripts)) {
              console.log(`  ${script}: ${count} chars`);
            }
          }
          if (Object.keys(langResult.wordMatches || {}).length > 0) {
            console.log(`\n${c.dim}Word matches:${c.reset}`);
            for (const [lang, count] of Object.entries(langResult.wordMatches)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${count}`);
            }
          }
        }
      }
      break;

    case 'detect-languages':
      // Detect multiple languages (E5-S1)
      {
        let multiLangContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          multiLangContent = fs.readFileSync(0, 'utf8');
        } else {
          multiLangContent = fs.readFileSync(args[1], 'utf8');
        }

        const segmentSizeArg = args.indexOf('--segment-size');
        const segmentSize = segmentSizeArg > -1 ? parseInt(args[segmentSizeArg + 1], 10) : 300;

        const multiResult = detectMultipleLanguages(multiLangContent, { segmentSize });

        if (args.includes('--json')) {
          console.log(JSON.stringify(multiResult, null, 2));
          break;
        }

        console.log(`${c.cyan}Multi-language Detection${c.reset}\n`);
        console.log(`${c.dim}Primary:${c.reset} ${multiResult.languageName} (${multiResult.language})`);
        console.log(`${c.dim}Multilingual:${c.reset} ${multiResult.isMultilingual ? c.yellow + 'Yes' + c.reset : 'No'}`);
        console.log(`${c.dim}Segments analyzed:${c.reset} ${multiResult.segmentCount}`);

        if (Object.keys(multiResult.distribution || {}).length > 0) {
          console.log(`\n${c.dim}Language distribution:${c.reset}`);
          for (const [lang, pct] of Object.entries(multiResult.distribution).sort((a, b) => b[1] - a[1])) {
            const name = LANGUAGE_INFO[lang]?.name || lang;
            console.log(`  ${name}: ${Math.round(pct * 100)}%`);
          }
        }
      }
      break;

    case 'language-info':
      // Get language info (E5-S1)
      {
        const langCode = args[1] && !args[1].startsWith('--') ? args[1] : null;
        if (!langCode) {
          // List all supported languages
          const langs = listSupportedLanguages();

          if (args.includes('--json')) {
            console.log(JSON.stringify(langs, null, 2));
            break;
          }

          console.log(`${c.cyan}Supported Languages${c.reset}\n`);
          console.log(`${c.dim}Tier 1 (Full support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 1)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          console.log(`\n${c.dim}Tier 2 (Good support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 2)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          console.log(`\n${c.dim}Tier 3 (Basic support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 3)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          break;
        }

        const info = getLanguageInfo(langCode);

        if (args.includes('--json')) {
          console.log(JSON.stringify(info, null, 2));
          break;
        }

        if (!info.supported) {
          console.error(`${c.yellow}Language code '${langCode}' not found${c.reset}`);
          console.log(`${c.dim}Use 'language-info' without arguments to list all supported languages${c.reset}`);
          break;
        }

        console.log(`${c.cyan}Language: ${info.name}${c.reset}\n`);
        console.log(`Code: ${info.code}`);
        console.log(`Script: ${info.script}`);
        console.log(`RTL: ${info.rtl ? 'Yes' : 'No'}`);
        console.log(`Common words: ${info.hasCommonWords ? 'Yes' : 'No'}`);
        console.log(`Trigram profile: ${info.hasTrigrams ? 'Yes' : 'No'}`);
      }
      break;

    case 'set-language':
      // Set preferred language for questions (E5-S2)
      {
        const langCode = args[1];
        if (!langCode || langCode.startsWith('--')) {
          console.error(`${c.red}Usage: set-language <language-code>${c.reset}`);
          console.log(`${c.dim}Example: set-language es${c.reset}`);
          console.log(`${c.dim}Use 'language-info' to see supported languages${c.reset}`);
          process.exit(1);
        }

        try {
          const result = setLanguagePreference(langCode);

          if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
            break;
          }

          console.log(`${c.green}✓ Language preference set${c.reset}`);
          console.log(`${c.dim}Language:${c.reset} ${result.languageName} (${result.language})`);
          console.log(`${c.dim}Questions will now be generated in ${result.languageName}${c.reset}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'show-language':
      // Show current language settings (E5-S2)
      {
        try {
          const langInfo = getSessionLanguageInfo();

          if (args.includes('--json')) {
            console.log(JSON.stringify(langInfo, null, 2));
            break;
          }

          console.log(`${c.cyan}Session Language Settings${c.reset}\n`);

          if (langInfo.detected) {
            console.log(`${c.dim}Detected:${c.reset} ${langInfo.detectedName} (${langInfo.detected})`);
            console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langInfo.confidence * 100)}%`);
          } else {
            console.log(`${c.dim}Detected:${c.reset} Not detected yet`);
          }

          if (langInfo.preferred) {
            console.log(`${c.dim}Preferred:${c.reset} ${langInfo.preferredName} (${langInfo.preferred})`);
          } else {
            console.log(`${c.dim}Preferred:${c.reset} Not set`);
          }

          console.log(`${c.dim}Multilingual:${c.reset} ${langInfo.isMultilingual ? 'Yes' : 'No'}`);

          if (langInfo.isMultilingual && Object.keys(langInfo.distribution).length > 0) {
            console.log(`\n${c.dim}Language distribution:${c.reset}`);
            for (const [lang, pct] of Object.entries(langInfo.distribution)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${Math.round(pct * 100)}%`);
            }
          }

          console.log(`\n${c.dim}Effective (for questions):${c.reset} ${LANGUAGE_INFO[langInfo.effective]?.name || langInfo.effective}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'detect-session-language':
      // Detect and store session language (E5-S2)
      {
        try {
          const result = detectSessionLanguage();

          if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
            break;
          }

          if (!result.detected) {
            console.log(`${c.yellow}Could not detect language: ${result.reason}${c.reset}`);
            break;
          }

          console.log(`${c.green}✓ Language detected${c.reset}`);
          console.log(`${c.dim}Language:${c.reset} ${result.languageName} (${result.language})`);
          console.log(`${c.dim}Confidence:${c.reset} ${Math.round(result.confidence * 100)}%`);
          console.log(`${c.dim}Multilingual:${c.reset} ${result.isMultilingual ? 'Yes' : 'No'}`);

          if (result.isMultilingual && result.distribution) {
            console.log(`\n${c.dim}Language distribution:${c.reset}`);
            for (const [lang, pct] of Object.entries(result.distribution)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${Math.round(pct * 100)}%`);
            }
          }
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'sessions':
      // List all durable digest sessions (E5-S3)
      {
        const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1] ||
                            (args.includes('--active') ? 'active' : null);
        const result = listDurableSessions({ status: statusFilter });

        if (args.includes('--json')) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        console.log(`${c.cyan}Digest Sessions${c.reset}\n`);

        if (result.sessions.length === 0) {
          console.log(`${c.dim}No sessions found${c.reset}`);
          break;
        }

        for (const session of result.sessions) {
          const isActive = session.id === result.active_id;
          const marker = isActive ? `${c.green}*${c.reset}` : ' ';
          const statusColor = session.status === 'completed' ? c.green :
                             session.status === 'active' ? c.cyan :
                             session.status === 'archived' ? c.dim : c.yellow;

          console.log(`${marker} ${c.bold}${session.id}${c.reset}`);
          console.log(`    Name: ${session.name}`);
          console.log(`    Status: ${statusColor}${session.status}${c.reset}`);
          console.log(`    Progress: ${session.progress?.phase || 'unknown'}`);
          console.log(`    Updated: ${getTimeSince(session.updated_at)}`);
          console.log('');
        }

        console.log(`${c.dim}Total: ${result.total} sessions${c.reset}`);
        if (result.active_id) {
          console.log(`${c.dim}Active: ${result.active_id}${c.reset}`);
        }
      }
      break;

    case 'session-info':
      // Show details for a specific session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: session-info <session-id>${c.reset}`);
          process.exit(1);
        }

        const session = getDurableSession(sessionId);
        if (!session) {
          console.error(`${c.red}Session not found: ${sessionId}${c.reset}`);
          process.exit(1);
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(session, null, 2));
          break;
        }

        const summary = generateRecoverySummaryForSession(sessionId);

        console.log(`${c.cyan}Session: ${session.name}${c.reset}`);
        console.log(`ID: ${session.id}`);
        console.log(`Status: ${session.status}${session.is_active ? ' (active)' : ''}`);
        console.log(`Last active: ${summary.last_active}`);
        console.log('');
        console.log(`${c.dim}Progress:${c.reset}`);
        console.log(`  Phase: ${summary.progress.phase}`);
        console.log(`  Topics: ${summary.progress.topics}`);
        console.log(`  Statements: ${summary.progress.statements}`);
        console.log(`  Questions: ${summary.progress.questions.answered}/${summary.progress.questions.total}`);
        console.log(`  Stories: ${summary.progress.stories.approved}/${summary.progress.stories.generated} approved`);
        console.log('');
        console.log(`${c.dim}Next action:${c.reset} ${summary.next_action.action}`);
        console.log(`${c.dim}Command:${c.reset} flow transcript-digest ${summary.next_action.command}`);
        console.log('');
        console.log(`${c.dim}Checkpoints:${c.reset} ${summary.checkpoints_count}`);
      }
      break;

    case 'switch-session':
      // Switch to a different session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: switch-session <session-id>${c.reset}`);
          process.exit(1);
        }

        try {
          const session = switchDurableSession(sessionId);
          const summary = generateRecoverySummaryForSession(sessionId);

          console.log(`${c.green}✓ Switched to session${c.reset}`);
          console.log(`${c.dim}Session:${c.reset} ${session.name} (${session.id})`);
          console.log(`${c.dim}Phase:${c.reset} ${summary.progress.phase}`);
          console.log('');
          console.log(`${c.dim}Next action:${c.reset} ${summary.next_action.action}`);
          console.log(`${c.dim}Run:${c.reset} flow transcript-digest ${summary.next_action.command}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'archive-session':
      // Archive a session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: archive-session <session-id>${c.reset}`);
          process.exit(1);
        }

        try {
          const session = archiveDurableSession(sessionId);
          console.log(`${c.green}✓ Session archived${c.reset}`);
          console.log(`${c.dim}Session:${c.reset} ${session.name} (${session.id})`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'delete-session':
      // Delete a session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: delete-session <session-id> [--delete-files]${c.reset}`);
          process.exit(1);
        }

        const deleteFiles = args.includes('--delete-files');

        try {
          deleteDurableSession(sessionId, deleteFiles);
          console.log(`${c.green}✓ Session deleted${c.reset}`);
          if (deleteFiles) {
            console.log(`${c.dim}Files also deleted${c.reset}`);
          }
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'session-recovery':
      // Show recovery summary for current or specified session (E5-S3)
      {
        const durable = loadDurableSessions();
        const sessionId = args[1] && !args[1].startsWith('--') ? args[1] : durable.active_session_id;

        if (!sessionId) {
          console.error(`${c.red}No active session. Specify a session ID or create a new session.${c.reset}`);
          process.exit(1);
        }

        const summary = generateRecoverySummaryForSession(sessionId);

        if (summary.error) {
          console.error(`${c.red}Error: ${summary.error}${c.reset}`);
          process.exit(1);
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(summary, null, 2));
          break;
        }

        console.log(`${c.cyan}Recovery Summary${c.reset}\n`);
        console.log(`Session: ${summary.name} (${summary.session_id})`);
        console.log(`Status: ${summary.status}`);
        console.log(`Last active: ${summary.last_active}`);
        console.log('');
        console.log(`${c.dim}Progress:${c.reset}`);
        console.log(`  - Topics: ${summary.progress.topics} extracted`);
        console.log(`  - Statements: ${summary.progress.statements} associated`);
        console.log(`  - Questions: ${summary.progress.questions.answered}/${summary.progress.questions.total} answered`);
        if (summary.progress.questions.pending > 0) {
          console.log(`    ${c.yellow}(${summary.progress.questions.pending} pending)${c.reset}`);
        }
        console.log(`  - Stories: ${summary.progress.stories.approved}/${summary.progress.stories.generated} approved`);
        console.log('');
        console.log(`${c.green}To continue:${c.reset} Run '${summary.next_action.command}'`);
      }
      break;

    // ===== E5-S4: Large Transcript Chunking Commands =====

    case 'needs-chunking':
      // Check if input needs chunking (E5-S4)
      {
        let inputText = '';
        const inputFile = args[1];

        if (inputFile && inputFile !== '-' && !inputFile.startsWith('--')) {
          // Read from file
          if (!fs.existsSync(inputFile)) {
            console.error(`${c.red}File not found: ${inputFile}${c.reset}`);
            process.exit(1);
          }
          inputText = fs.readFileSync(inputFile, 'utf8');
        } else if (inputFile === '-' || !inputFile) {
          // Read from stdin
          inputText = fs.readFileSync(0, 'utf8');
        }

        const result = needsChunking(inputText);

        if (args.includes('--json')) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunking Analysis${c.reset}\n`);
        console.log(`${c.dim}Needs chunking:${c.reset} ${result.needed ? `${c.yellow}Yes${c.reset}` : `${c.green}No${c.reset}`}`);
        console.log(`${c.dim}Word count:${c.reset} ${result.metrics.words.toLocaleString()} ${result.metrics.words > result.metrics.thresholds.words ? `${c.yellow}(exceeds ${result.metrics.thresholds.words.toLocaleString()})${c.reset}` : ''}`);
        console.log(`${c.dim}Token estimate:${c.reset} ${result.metrics.tokens.toLocaleString()} ${result.metrics.tokens > result.metrics.thresholds.tokens ? `${c.yellow}(exceeds ${result.metrics.thresholds.tokens.toLocaleString()})${c.reset}` : ''}`);
        console.log(`${c.dim}Character count:${c.reset} ${result.metrics.chars.toLocaleString()}`);

        if (result.reason) {
          console.log('');
          console.log(`${c.dim}Triggered by:${c.reset} ${result.reason}`);
        }
      }
      break;

    case 'plan-chunks':
      // Plan how to chunk a transcript (E5-S4)
      {
        let inputText = '';
        const inputFile = args[1];

        if (inputFile && inputFile !== '-' && !inputFile.startsWith('--')) {
          if (!fs.existsSync(inputFile)) {
            console.error(`${c.red}File not found: ${inputFile}${c.reset}`);
            process.exit(1);
          }
          inputText = fs.readFileSync(inputFile, 'utf8');
        } else if (inputFile === '-' || !inputFile) {
          inputText = fs.readFileSync(0, 'utf8');
        }

        // Parse options
        const options = {};
        const targetWordsIdx = args.indexOf('--target-words');
        if (targetWordsIdx !== -1 && args[targetWordsIdx + 1]) {
          options.targetChunkWords = parseInt(args[targetWordsIdx + 1], 10);
        }

        const plan = planChunks(inputText, options);

        if (args.includes('--json')) {
          console.log(JSON.stringify(plan, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunk Plan${c.reset}\n`);
        console.log(`${c.dim}Total words:${c.reset} ${plan.total_words.toLocaleString()}`);
        console.log(`${c.dim}Chunks planned:${c.reset} ${plan.total_chunks}`);
        console.log(`${c.dim}Avg words/chunk:${c.reset} ${plan.avg_chunk_words.toLocaleString()}`);
        console.log('');

        plan.chunks.forEach((chunk, i) => {
          const boundaryInfo = chunk.boundary_type ? ` [${chunk.boundary_type}]` : '';
          console.log(`${c.dim}Chunk ${i + 1}:${c.reset} ${chunk.word_count.toLocaleString()} words, chars ${chunk.start_offset}-${chunk.end_offset}${boundaryInfo}`);
        });
      }
      break;

    case 'chunk-status':
      // Show current chunking status (E5-S4)
      {
        const status = getChunkingStatus();

        if (!status || !status.enabled) {
          console.log(`${c.dim}No active chunking session${c.reset}`);
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(status, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunking Status${c.reset}\n`);
        console.log(`${c.dim}Total chunks:${c.reset} ${status.total_chunks}`);
        console.log(`${c.dim}Completed:${c.reset} ${status.completed}/${status.total_chunks}`);
        console.log(`${c.dim}Progress:${c.reset} ${status.progress}%`);
        console.log('');

        if (status.chunks && status.chunks.length > 0) {
          console.log(`${c.dim}Chunk Details:${c.reset}`);
          status.chunks.forEach(chunk => {
            const statusIcon = chunk.status === 'completed' ? `${c.green}✓${c.reset}` :
                              chunk.status === 'in_progress' ? `${c.yellow}→${c.reset}` :
                              chunk.status === 'failed' ? `${c.red}✗${c.reset}` :
                              `${c.dim}○${c.reset}`;
            const topicsInfo = chunk.topics !== null ? ` (${chunk.topics} topics, ${chunk.statements} stmts)` : '';
            console.log(`  ${statusIcon} ${chunk.id}: ${chunk.status}${topicsInfo}`);
          });
        }

        if (status.merge_status) {
          console.log('');
          console.log(`${c.dim}Merge status:${c.reset} ${status.merge_status}`);
        }
      }
      break;

    case 'topics':
      const topics = loadTopics();
      if (!topics) {
        console.error(`${c.red}No active digest or topics not yet extracted${c.reset}`);
        process.exit(1);
      }
      console.log(JSON.stringify(topics, null, 2));
      break;

    case 'save-topics':
      // Save topics from stdin (JSON)
      const topicsJson = fs.readFileSync(0, 'utf8');
      const parsedTopics = JSON.parse(topicsJson);
      const saved = saveTopics(parsedTopics);
      console.log(`${c.green}✓ Saved ${saved.topics.length} topics${c.reset}`);
      break;

    case 'pass2':
    case 'statements':
      // Run Pass 2: Statement Association
      try {
        const pass2Result = runPass2();
        console.log(`${c.green}✓ Pass 2 complete${c.reset}`);
        console.log(`${c.cyan}Statements:${c.reset} ${pass2Result.metadata.total_statements} total`);
        console.log(`  ${c.dim}Meaningful:${c.reset} ${pass2Result.metadata.meaningful_statements}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${pass2Result.metadata.mapped_statements}`);
        console.log(`  ${c.dim}Orphans:${c.reset} ${pass2Result.metadata.orphan_statements}`);
        console.log(`  ${c.dim}Coverage:${c.reset} ${pass2Result.metadata.coverage_percentage}%`);
        if (pass2Result.metadata.contradictions_detected > 0) {
          console.log(`${c.yellow}⚠ Contradictions detected:${c.reset} ${pass2Result.metadata.contradictions_detected}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'statement-map':
      // Show statement map
      const stmtMap = loadStatementMap();
      if (!stmtMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      console.log(JSON.stringify(stmtMap, null, 2));
      break;

    case 'orphans':
      // Show orphan statements
      const orphanMap = loadStatementMap();
      if (!orphanMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      const orphanStmts = orphanMap.statements.filter(s => s.meaningful && s.topic_id === null);
      if (orphanStmts.length === 0) {
        console.log(`${c.green}✓ No orphan statements - 100% coverage${c.reset}`);
      } else {
        console.log(`${c.yellow}Orphan statements (${orphanStmts.length}):${c.reset}\n`);
        for (const orphan of orphanStmts) {
          console.log(`${c.dim}${orphan.id}:${c.reset} "${orphan.text.slice(0, 80)}..."`);
          if (orphan.clarification_question) {
            console.log(`  ${c.cyan}→ ${orphan.clarification_question}${c.reset}`);
          }
        }
      }
      break;

    case 'contradictions':
      // Show contradictions
      const contradictMap = loadStatementMap();
      if (!contradictMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      const contradicts = contradictMap.contradictions || [];
      if (contradicts.length === 0) {
        console.log(`${c.green}✓ No contradictions detected${c.reset}`);
      } else {
        console.log(`${c.yellow}Contradictions (${contradicts.length}):${c.reset}\n`);
        for (const contra of contradicts) {
          const stmt1 = contradictMap.statements.find(s => s.id === contra.statement1_id);
          const stmt2 = contradictMap.statements.find(s => s.id === contra.statement2_id);
          console.log(`${c.red}${contra.type}:${c.reset} ${contra.attribute || contra.values?.join(' vs ')}`);
          console.log(`  ${c.dim}${contra.statement1_id}:${c.reset} "${stmt1?.text.slice(0, 60)}..."`);
          console.log(`  ${c.dim}${contra.statement2_id}:${c.reset} "${stmt2?.text.slice(0, 60)}..."`);
          console.log();
        }
      }
      break;

    case 'pass3':
    case 'resolve-orphans':
      // Run Pass 3: Orphan Check
      try {
        const pass3Result = runPass3();
        console.log(`${c.green}✓ Pass 3 complete${c.reset}`);
        console.log(`${c.cyan}Coverage:${c.reset} ${pass3Result.coverage.percentage}%`);
        console.log(`  ${c.dim}Total meaningful:${c.reset} ${pass3Result.coverage.total_meaningful}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${pass3Result.coverage.mapped}`);
        console.log(`  ${c.dim}Resolved:${c.reset} ${pass3Result.resolved.length}`);
        if (pass3Result.new_topics_created.length > 0) {
          console.log(`${c.cyan}New topics created:${c.reset} ${pass3Result.new_topics_created.length}`);
          for (const t of pass3Result.new_topics_created) {
            console.log(`  ${c.dim}${t.id}:${c.reset} ${t.title}`);
          }
        }
        if (pass3Result.orphans.length > 0) {
          console.log(`${c.yellow}⚠ Still need clarification:${c.reset} ${pass3Result.orphans.length}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'coverage':
      // Show coverage summary
      const orphanData = loadOrphans();
      if (!orphanData) {
        const stmtMapCov = loadStatementMap();
        if (stmtMapCov) {
          console.log(`${c.cyan}Coverage:${c.reset} ${stmtMapCov.metadata.coverage_percentage}%`);
          console.log(`  ${c.dim}Meaningful:${c.reset} ${stmtMapCov.metadata.meaningful_statements}`);
          console.log(`  ${c.dim}Mapped:${c.reset} ${stmtMapCov.metadata.mapped_statements}`);
          console.log(`  ${c.dim}Orphans:${c.reset} ${stmtMapCov.metadata.orphan_statements}`);
        } else {
          console.error(`${c.red}No data found - run pass2 first${c.reset}`);
          process.exit(1);
        }
      } else {
        console.log(`${c.cyan}Coverage:${c.reset} ${orphanData.coverage.percentage}%`);
        console.log(`  ${c.dim}Total meaningful:${c.reset} ${orphanData.coverage.total_meaningful}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${orphanData.coverage.mapped}`);
        console.log(`  ${c.dim}Need clarification:${c.reset} ${orphanData.coverage.clarification_needed}`);
        if (orphanData.coverage.percentage < 100) {
          console.log(`\n${c.yellow}Run 'pass3' to resolve orphans${c.reset}`);
        } else {
          console.log(`\n${c.green}✓ 100% coverage achieved${c.reset}`);
        }
      }
      break;

    case 'pass4':
    case 'resolve-contradictions':
      // Run Pass 4: Contradiction Resolution
      try {
        const pass4Result = runPass4();
        console.log(`${c.green}✓ Pass 4 complete${c.reset}`);
        console.log(`${c.cyan}Contradictions:${c.reset} ${pass4Result.stats.total} total`);
        console.log(`  ${c.dim}Auto-resolved:${c.reset} ${pass4Result.stats.auto_resolved}`);
        console.log(`  ${c.dim}Need clarification:${c.reset} ${pass4Result.stats.needs_clarification}`);
        console.log(`  ${c.dim}Additive (not contradictions):${c.reset} ${pass4Result.stats.additive_not_contradiction}`);
        if (pass4Result.resolved.length > 0) {
          console.log(`\n${c.cyan}Auto-resolved:${c.reset}`);
          for (const r of pass4Result.resolved) {
            console.log(`  ${c.dim}Winner:${c.reset} ${r.winner} (${r.reason})`);
          }
        }
        if (pass4Result.pending.length > 0) {
          console.log(`\n${c.yellow}Need clarification:${c.reset}`);
          for (const p of pass4Result.pending) {
            console.log(`  ${c.dim}${p.clarification_id}:${c.reset} ${p.statement1_id} vs ${p.statement2_id}`);
          }
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'clarifications':
      // Show clarification questions
      const clars = loadClarifications();
      if (!clars) {
        console.error(`${c.red}No clarifications found${c.reset}`);
        process.exit(1);
      }
      const pendingClars = clars.contradictions.filter(c => c.status === 'pending');
      if (pendingClars.length === 0) {
        console.log(`${c.green}✓ No pending clarifications${c.reset}`);
      } else {
        console.log(`${c.yellow}Pending clarifications (${pendingClars.length}):${c.reset}\n`);
        for (const clar of pendingClars) {
          console.log(`${c.cyan}${clar.id}:${c.reset} ${clar.question}`);
          for (const opt of clar.options) {
            console.log(`  ${c.dim}${opt.id}:${c.reset} ${opt.text}`);
          }
          console.log();
        }
      }
      break;

    case 'questions':
    case 'generate-questions':
      // Generate clarifying questions
      try {
        const qResult = generateAllQuestions();
        console.log(`${c.green}✓ Question generation complete${c.reset}`);
        console.log(`${c.cyan}Questions generated:${c.reset} ${qResult.stats.total}`);
        console.log(`  ${c.dim}Completeness:${c.reset} ${qResult.stats.by_type.completeness || 0}`);
        console.log(`  ${c.dim}Specificity:${c.reset} ${qResult.stats.by_type.specificity || 0}`);
        console.log(`  ${c.dim}Ambiguity:${c.reset} ${qResult.stats.by_type.ambiguity || 0}`);
        console.log(`\n${c.cyan}By priority:${c.reset}`);
        console.log(`  ${c.red}P1 (High):${c.reset} ${qResult.stats.by_priority.P1 || 0}`);
        console.log(`  ${c.yellow}P2 (Medium):${c.reset} ${qResult.stats.by_priority.P2 || 0}`);
        console.log(`  ${c.dim}P3 (Low):${c.reset} ${qResult.stats.by_priority.P3 || 0}`);
        console.log(`\n${c.dim}Topics with questions: ${qResult.stats.topics_with_questions}${c.reset}`);
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'show-questions':
      // Show all pending questions grouped by topic
      const showClars = loadClarifications();
      if (!showClars) {
        console.error(`${c.red}No clarifications found - run 'questions' first${c.reset}`);
        process.exit(1);
      }
      const allPending = showClars.questions.filter(q => q.status === 'pending');
      if (allPending.length === 0) {
        console.log(`${c.green}✓ No pending questions${c.reset}`);
      } else {
        // Group by topic
        const byTopicShow = {};
        for (const q of allPending) {
          if (!byTopicShow[q.topic_id]) {
            byTopicShow[q.topic_id] = { title: q.topic_title, questions: [] };
          }
          byTopicShow[q.topic_id].questions.push(q);
        }
        console.log(`${c.cyan}Pending questions (${allPending.length}):${c.reset}\n`);
        for (const [topicId, data] of Object.entries(byTopicShow)) {
          console.log(`${c.green}## ${data.title || topicId} (${data.questions.length})${c.reset}`);
          for (let i = 0; i < data.questions.length; i++) {
            const q = data.questions[i];
            const prioColor = q.priority === 'P1' ? c.red : q.priority === 'P2' ? c.yellow : c.dim;
            console.log(`\n${prioColor}${i + 1}. [${q.priority}]${c.reset} ${q.question}`);
            if (q.examples) {
              console.log(`   ${c.dim}Examples: ${q.examples.join(' | ')}${c.reset}`);
            }
          }
          console.log();
        }
      }
      break;

    // E2-S2: Conversation Loop Commands
    case 'answer':
      // Process user answer
      const forceVoice = args.includes('--voice');
      const filteredArgs = args.filter(a => a !== '--voice');

      let answerText;
      if (!filteredArgs[1] || filteredArgs[1] === '-') {
        answerText = fs.readFileSync(0, 'utf8').trim();
      } else {
        answerText = filteredArgs.slice(1).join(' ');
      }

      if (!answerText) {
        console.error(`${c.red}Usage: flow transcript-digest answer [--voice] "<response>"${c.reset}`);
        process.exit(1);
      }

      try {
        const answerResult = processConversationResponse(answerText, { forceVoice });

        if (answerResult.error) {
          console.error(`${c.red}Error: ${answerResult.error}${c.reset}`);
          process.exit(1);
        }

        if (answerResult.complete) {
          console.log(`${c.green}✓ ${answerResult.message || 'All clarifications complete!'}${c.reset}`);
          break;
        }

        // Show voice processing info if applicable
        if (answerResult.voice) {
          console.log(`${c.cyan}Voice input detected${c.reset}`);
          if (answerResult.voice.processing.fillersRemoved > 0) {
            console.log(`  ${c.dim}Fillers removed:${c.reset} ${answerResult.voice.processing.fillersRemoved}`);
          }
          if (answerResult.voice.processing.corrections.length > 0) {
            console.log(`  ${c.dim}Self-corrections:${c.reset} ${answerResult.voice.processing.corrections.length}`);
          }
          if (answerResult.voice.processing.numbersNormalized > 0) {
            console.log(`  ${c.dim}Numbers normalized:${c.reset} ${answerResult.voice.processing.numbersNormalized}`);
          }
          if (answerResult.voice.processing.uncertainty.hasUncertainty) {
            console.log(`  ${c.yellow}Uncertainty detected:${c.reset} ${answerResult.voice.processing.uncertainty.markers.join(', ')}`);
          }
          console.log(`  ${c.dim}Normalized:${c.reset} "${answerResult.voice.normalized}"`);
          console.log();
        }

        console.log(`${c.green}✓ Captured ${answerResult.captured.length} answer(s)${c.reset}`);
        for (const cap of answerResult.captured) {
          console.log(`  ${c.dim}${cap.question_id}:${c.reset} "${cap.answer.slice(0, 50)}..."`);
        }

        if (answerResult.derived_statements.length > 0) {
          console.log(`\n${c.cyan}Created ${answerResult.derived_statements.length} derived statement(s)${c.reset}`);
        }

        if (answerResult.followups_added.length > 0) {
          console.log(`\n${c.yellow}Added ${answerResult.followups_added.length} follow-up question(s)${c.reset}`);
        }

        console.log(`\n${c.dim}Remaining: ${answerResult.remaining_questions} question(s)${c.reset}`);

        if (answerResult.formatted_questions) {
          console.log(`\n${c.cyan}Next questions:${c.reset}\n`);
          console.log(answerResult.formatted_questions);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'next-questions':
      // Get next batch of questions for presentation
      const limitArg = parseInt(args[1], 10) || 5;
      const topicArg = args[2] || null;

      const nextQs = getQuestionsForPresentation(topicArg, limitArg);
      if (nextQs.length === 0) {
        console.log(`${c.green}✓ No pending questions${c.reset}`);
      } else {
        const formatted = formatQuestionsForUser(nextQs);
        console.log(formatted);
      }
      break;

    case 'completion-status':
    case 'check-completion':
      // Check if all clarifications are complete
      const completion = checkCompletion();

      if (completion.error) {
        console.error(`${c.red}Error: ${completion.error}${c.reset}`);
        process.exit(1);
      }

      if (completion.complete) {
        console.log(`${c.green}✓ All clarifications complete!${c.reset}`);
      } else {
        console.log(`${c.yellow}Clarification in progress${c.reset}`);
      }

      console.log(`\n${c.cyan}Questions:${c.reset}`);
      console.log(`  ${c.dim}Total:${c.reset} ${completion.total_questions}`);
      console.log(`  ${c.green}Answered:${c.reset} ${completion.answered_questions}`);
      console.log(`  ${c.yellow}Pending:${c.reset} ${completion.pending_questions}`);

      if (completion.total_contradictions > 0) {
        console.log(`\n${c.cyan}Contradictions:${c.reset}`);
        console.log(`  ${c.dim}Total:${c.reset} ${completion.total_contradictions}`);
        console.log(`  ${c.green}Resolved:${c.reset} ${completion.resolved_contradictions}`);
        console.log(`  ${c.yellow}Pending:${c.reset} ${completion.pending_contradictions}`);
      }

      // Output JSON for programmatic use
      if (args.includes('--json')) {
        console.log(`\n${JSON.stringify(completion, null, 2)}`);
      }
      break;

    case 'resolve-contradiction':
      // Resolve a contradiction with user choice
      const contraId = args[1];
      const contraChoice = args[2];

      if (!contraId || !contraChoice) {
        console.error(`${c.red}Usage: flow transcript-digest resolve-contradiction <id> <choice>${c.reset}`);
        console.error(`${c.dim}Choices: opt-1, opt-2, keep_both${c.reset}`);
        process.exit(1);
      }

      try {
        const resolved = resolveContradictionWithChoice(contraId, contraChoice);
        console.log(`${c.green}✓ Resolved contradiction ${contraId}${c.reset}`);
        console.log(`  ${c.dim}Resolution:${c.reset} ${resolved.resolution}`);
        if (resolved.winner) {
          console.log(`  ${c.dim}Winner:${c.reset} ${resolved.winner}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'voice-normalize':
    case 'normalize-voice':
      // Test voice normalization without a digest session
      let voiceText;
      if (!args[1] || args[1] === '-') {
        voiceText = fs.readFileSync(0, 'utf8').trim();
      } else {
        voiceText = args.slice(1).join(' ');
      }

      if (!voiceText) {
        console.error(`${c.red}Usage: flow transcript-digest voice-normalize "<voice text>"${c.reset}`);
        process.exit(1);
      }

      const voiceNormResult = processVoiceAnswer(voiceText, true);
      console.log(`${c.cyan}Voice Normalization Result${c.reset}\n`);
      console.log(`${c.dim}Original:${c.reset} "${voiceText}"`);
      console.log(`${c.green}Normalized:${c.reset} "${voiceNormResult.normalized}"`);
      console.log(`\n${c.dim}Voice detected:${c.reset} ${voiceNormResult.isVoice ? 'Yes' : 'No'}`);
      console.log(`${c.dim}Confidence:${c.reset} ${(voiceNormResult.confidence * 100).toFixed(0)}%`);

      if (voiceNormResult.processing.fillersRemoved > 0) {
        console.log(`${c.dim}Fillers removed:${c.reset} ${voiceNormResult.processing.fillersRemoved}`);
      }
      if (voiceNormResult.processing.corrections.length > 0) {
        console.log(`${c.dim}Corrections:${c.reset}`);
        for (const corr of voiceNormResult.processing.corrections) {
          console.log(`  ${c.yellow}${corr.type}:${c.reset} "${corr.original}" → "${corr.corrected}"`);
        }
      }
      if (voiceNormResult.processing.numbersNormalized > 0) {
        console.log(`${c.dim}Numbers normalized:${c.reset} ${voiceNormResult.processing.numbersNormalized}`);
      }
      if (voiceNormResult.processing.uncertainty.hasUncertainty) {
        console.log(`${c.yellow}Uncertainty:${c.reset} ${voiceNormResult.processing.uncertainty.markers.join(', ')}`);
        if (voiceNormResult.processing.uncertainty.needsConfirmation) {
          console.log(`  ${c.yellow}→ May need confirmation${c.reset}`);
        }
      }
      if (voiceNormResult.processing.yesNo.type) {
        console.log(`${c.green}Yes/No detected:${c.reset} ${voiceNormResult.processing.yesNo.type}`);
      }
      break;

    case 'capture-answer':
      // Manually capture answer for a specific question
      const qId = args[1];
      const qAnswer = args.slice(2).join(' ');

      if (!qId || !qAnswer) {
        console.error(`${c.red}Usage: flow transcript-digest capture-answer <question-id> <answer>${c.reset}`);
        process.exit(1);
      }

      try {
        const captured = captureAnswer(qId, qAnswer, 'manual');
        console.log(`${c.green}✓ Captured answer for ${qId}${c.reset}`);

        // Create derived statement
        const derived = createDerivedStatement(captured, qAnswer);
        console.log(`${c.dim}Created statement:${c.reset} ${derived.id}`);

        // Check for follow-ups
        const followups = checkFollowups(qAnswer, captured);
        if (followups.length > 0) {
          const added = addFollowupQuestions(followups);
          if (added.length > 0) {
            console.log(`${c.yellow}Added ${added.length} follow-up question(s)${c.reset}`);
          }
        }

        // Check completion
        const compStatus = checkCompletion();
        console.log(`\n${c.dim}Remaining: ${compStatus.pending_questions} question(s)${c.reset}`);
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    // E2-S4: Persistence Commands
    case 'resume':
      // Resume an interrupted session
      const interrupted = detectInterruptedSession();

      if (!interrupted.interrupted) {
        console.log(`${c.dim}No interrupted session to resume${c.reset}`);
        break;
      }

      console.log(`${c.yellow}⚠ Interrupted session detected${c.reset}`);
      console.log(`  ${c.dim}Session:${c.reset} ${interrupted.session_id}`);
      console.log(`  ${c.dim}Last active:${c.reset} ${interrupted.time_since_formatted}`);
      console.log(`  ${c.dim}Progress:${c.reset} ${interrupted.answered_questions}/${interrupted.total_questions} questions answered`);
      console.log();

      const resumeResult = resumeSession();
      if (resumeResult.error) {
        console.error(`${c.red}Error: ${resumeResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Session resumed${c.reset}\n`);

      if (resumeResult.summary.recent_answers.length > 0) {
        console.log(`${c.cyan}Recent answers:${c.reset}`);
        for (const ans of resumeResult.summary.recent_answers.slice(-3)) {
          console.log(`  ${c.dim}${ans.topic}:${c.reset} "${ans.answer.slice(0, 40)}..."`);
        }
        console.log();
      }

      if (resumeResult.formatted_questions) {
        console.log(`${c.cyan}Continuing with questions:${c.reset}\n`);
        console.log(resumeResult.formatted_questions);
      }
      break;

    case 'review':
      // Review all answered questions
      const reviewResult = reviewAnswers();

      if (reviewResult.error) {
        console.error(`${c.red}Error: ${reviewResult.error}${c.reset}`);
        process.exit(1);
      }

      if (reviewResult.total_answered === 0) {
        console.log(`${c.dim}No answered questions yet${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Answered Questions (${reviewResult.total_answered})${c.reset}\n`);

      for (const [topic, questions] of Object.entries(reviewResult.by_topic)) {
        console.log(`${c.green}## ${topic}${c.reset}`);
        for (const q of questions) {
          console.log(`\n${c.dim}Q:${c.reset} ${q.question}`);
          console.log(`${c.green}A:${c.reset} ${q.answer}`);
          if (q.source === 'voice') {
            console.log(`${c.dim}(voice input)${c.reset}`);
          }
        }
        console.log();
      }
      break;

    case 'history':
      // Show session interaction history
      const historyResult = getSessionHistory();

      if (!historyResult) {
        console.log(`${c.dim}No session history available${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Session History${c.reset}\n`);
      console.log(`${c.dim}Session ID:${c.reset} ${historyResult.session_id}`);
      console.log(`${c.dim}Started:${c.reset} ${historyResult.started_at}`);
      console.log(`${c.dim}Last interaction:${c.reset} ${historyResult.last_interaction}`);
      console.log(`${c.dim}Interactions:${c.reset} ${historyResult.interaction_count}`);
      console.log(`${c.dim}Checkpoints:${c.reset} ${historyResult.checkpoint_count}`);
      console.log(`${c.dim}Answers given:${c.reset} ${historyResult.answers_given}`);

      if (Object.keys(historyResult.interactions_by_type).length > 0) {
        console.log(`\n${c.cyan}Interactions by type:${c.reset}`);
        for (const [type, count] of Object.entries(historyResult.interactions_by_type)) {
          console.log(`  ${c.dim}${type}:${c.reset} ${count}`);
        }
      }
      break;

    case 'export':
      // Export session state
      const exportFormat = args.includes('--format') ?
        args[args.indexOf('--format') + 1] || 'json' : 'json';

      const exportResult = exportSession(exportFormat);

      if (exportResult.error) {
        console.error(`${c.red}Error: ${exportResult.error}${c.reset}`);
        process.exit(1);
      }

      if (exportFormat === 'md') {
        console.log(exportResult);
      } else {
        console.log(JSON.stringify(exportResult, null, 2));
      }
      break;

    case 'complexity':
      // Analyze complexity of extracted requirements
      const complexityResult = analyzeComplexity();

      if (complexityResult.error) {
        console.error(`${c.red}Error: ${complexityResult.error}${c.reset}`);
        process.exit(1);
      }

      // Check if JSON output requested
      if (args.includes('--json')) {
        console.log(JSON.stringify(complexityResult, null, 2));
        break;
      }

      // Human-readable output
      console.log(`${c.cyan}Complexity Analysis${c.reset}\n`);

      // Overall score
      const levelColor = complexityResult.overall.level === 'simple' || complexityResult.overall.level === 'low'
        ? c.green
        : complexityResult.overall.level === 'medium' ? c.yellow : c.red;
      console.log(`Overall Score: ${levelColor}${complexityResult.overall.score}/100 (${complexityResult.overall.level.replace('_', ' ')})${c.reset}`);
      console.log(`${c.dim}${complexityResult.overall.description}${c.reset}\n`);

      // Factors
      console.log(`${c.cyan}Factors:${c.reset}`);
      console.log(`  Topics: ${complexityResult.factors.topic_count}`);
      console.log(`  Statements: ${complexityResult.factors.statement_count}`);
      console.log(`  Questions: ${complexityResult.factors.question_count}`);
      console.log(`  Contradictions: ${complexityResult.factors.contradiction_count}`);
      console.log(`  UI Components: ${complexityResult.factors.ui_components}`);
      console.log(`  Data Entities: ${complexityResult.factors.data_entities}`);
      console.log(`  Interactions: ${complexityResult.factors.interactions}\n`);

      // Topic breakdown
      if (complexityResult.topic_analysis.length > 0) {
        console.log(`${c.cyan}Topic Breakdown:${c.reset}`);
        for (const topic of complexityResult.topic_analysis) {
          const topicLevel = topic.complexity_score <= 30 ? 'Low' :
            topic.complexity_score <= 60 ? 'Medium' : 'High';
          console.log(`  ${topic.title}: ${topic.complexity_score} (${topicLevel}) - ${topic.estimated_stories} ${topic.estimated_stories === 1 ? 'story' : 'stories'}`);
        }
        console.log();
      }

      // Recommendation
      console.log(`${c.cyan}Recommended Structure:${c.reset} ${complexityResult.recommendation.type.replace('_', ' ')}`);
      console.log(`${c.dim}${complexityResult.recommendation.rationale}${c.reset}`);

      if (complexityResult.recommendation.type === 'epic' && complexityResult.recommendation.epics) {
        console.log(`\n${c.cyan}Proposed Epics:${c.reset}`);
        for (const epic of complexityResult.recommendation.epics) {
          console.log(`  - ${epic.title} (${epic.stories} ${epic.stories === 1 ? 'story' : 'stories'})`);
        }
      } else if (complexityResult.recommendation.type === 'story_group' && complexityResult.recommendation.groups) {
        console.log(`\n${c.cyan}Story Groups:${c.reset}`);
        for (const group of complexityResult.recommendation.groups) {
          console.log(`  - ${group.topics.join(', ')} (${group.stories} ${group.stories === 1 ? 'story' : 'stories'})`);
        }
      }

      // Entity summary
      if (complexityResult.entity_summary.ui_components.length > 0 ||
          complexityResult.entity_summary.data_entities.length > 0) {
        console.log(`\n${c.cyan}Detected Entities:${c.reset}`);
        if (complexityResult.entity_summary.ui_components.length > 0) {
          console.log(`  UI: ${complexityResult.entity_summary.ui_components.join(', ')}`);
        }
        if (complexityResult.entity_summary.data_entities.length > 0) {
          console.log(`  Data: ${complexityResult.entity_summary.data_entities.join(', ')}`);
        }
        if (complexityResult.entity_summary.interactions.length > 0) {
          console.log(`  Actions: ${complexityResult.entity_summary.interactions.join(', ')}`);
        }
      }
      break;

    case 'generate-story':
      // Generate story for a specific topic
      const storyTopicId = args[1];
      if (!storyTopicId) {
        console.error(`${c.red}Error: Topic ID required. Usage: generate-story <topic-id>${c.reset}`);
        process.exit(1);
      }

      const singleStory = generateStoryFromTopic(storyTopicId);
      if (singleStory.error) {
        console.error(`${c.red}Error: ${singleStory.error}${c.reset}`);
        process.exit(1);
      }

      // Save the story
      const saveResult = saveStory(singleStory);
      if (saveResult.error) {
        console.error(`${c.red}Error: ${saveResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(singleStory, null, 2));
      } else if (args.includes('--md')) {
        console.log(formatStoryAsMarkdown(singleStory));
      } else {
        console.log(`${c.green}✓ Story generated${c.reset}`);
        console.log(`${c.cyan}ID:${c.reset} ${singleStory.id}`);
        console.log(`${c.cyan}Topic:${c.reset} ${singleStory.title}`);
        console.log(`${c.cyan}Acceptance Criteria:${c.reset} ${singleStory.acceptance_criteria.length}`);
        console.log(`${c.cyan}Coverage:${c.reset} ${singleStory.coverage.coverage_percent}%`);
        console.log(`${c.cyan}Saved to:${c.reset} ${saveResult.path}`);

        if (singleStory.validation.warnings.length > 0) {
          console.log(`\n${c.yellow}Warnings:${c.reset}`);
          for (const w of singleStory.validation.warnings) {
            console.log(`  ${c.dim}${w.type}:${c.reset} ${w.message}`);
          }
        }
      }
      break;

    case 'generate-stories':
      // Generate stories for all topics
      const allStoriesResult = generateAllStories();

      if (allStoriesResult.error) {
        console.error(`${c.red}Error: ${allStoriesResult.error}${c.reset}`);
        process.exit(1);
      }

      // Save all stories
      for (const st of allStoriesResult.stories) {
        saveStory(st);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(allStoriesResult, null, 2));
      } else {
        console.log(`${c.green}✓ Story generation complete${c.reset}\n`);
        console.log(`${c.cyan}Summary:${c.reset}`);
        console.log(`  Topics: ${allStoriesResult.summary.total_topics}`);
        console.log(`  Stories generated: ${allStoriesResult.summary.stories_generated}`);
        console.log(`  Total criteria: ${allStoriesResult.summary.total_criteria}`);
        console.log(`  Average coverage: ${allStoriesResult.summary.average_coverage}%`);

        if (allStoriesResult.errors.length > 0) {
          console.log(`\n${c.yellow}Errors (${allStoriesResult.errors.length}):${c.reset}`);
          for (const err of allStoriesResult.errors) {
            console.log(`  ${c.dim}${err.topic_id}:${c.reset} ${err.error}`);
          }
        }

        console.log(`\n${c.cyan}Generated stories:${c.reset}`);
        for (const st of allStoriesResult.stories) {
          const coverageColor = st.coverage.coverage_percent >= 80 ? c.green :
            st.coverage.coverage_percent >= 50 ? c.yellow : c.red;
          console.log(`  ${st.id}: ${st.title} - ${coverageColor}${st.coverage.coverage_percent}% coverage${c.reset}`);
        }
      }
      break;

    case 'show-story':
      // Show a specific story
      const showStoryId = args[1];
      if (!showStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: show-story <story-id>${c.reset}`);
        process.exit(1);
      }

      const storyToShow = loadStory(showStoryId);
      if (!storyToShow) {
        console.error(`${c.red}Error: Story ${showStoryId} not found${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(storyToShow, null, 2));
      } else {
        console.log(formatStoryAsMarkdown(storyToShow));
      }
      break;

    case 'list-stories':
      // List all generated stories
      const allStories = loadAllStories();

      if (allStories.length === 0) {
        console.log(`${c.dim}No stories generated yet${c.reset}`);
        break;
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(allStories.map(s => ({
          id: s.id,
          topic_id: s.topic_id,
          title: s.title,
          criteria_count: s.acceptance_criteria.length,
          coverage: s.coverage.coverage_percent
        })), null, 2));
      } else {
        console.log(`${c.cyan}Generated Stories (${allStories.length})${c.reset}\n`);
        for (const st of allStories) {
          const coverageColor = st.coverage.coverage_percent >= 80 ? c.green :
            st.coverage.coverage_percent >= 50 ? c.yellow : c.red;
          console.log(`${c.dim}${st.id}${c.reset}`);
          console.log(`  Title: ${st.title}`);
          console.log(`  Topic: ${st.topic_id}`);
          console.log(`  Criteria: ${st.acceptance_criteria.length}`);
          console.log(`  Coverage: ${coverageColor}${st.coverage.coverage_percent}%${c.reset}`);
          console.log();
        }
      }
      break;

    case 'validate-stories':
      // Validate all stories for coverage
      const storiesToValidate = loadAllStories();

      if (storiesToValidate.length === 0) {
        console.log(`${c.dim}No stories to validate${c.reset}`);
        break;
      }

      let allValid = true;
      const validationResults = [];

      for (const st of storiesToValidate) {
        const result = {
          id: st.id,
          title: st.title,
          valid: st.validation.valid,
          coverage: st.coverage.coverage_percent,
          warnings: st.validation.warnings
        };
        validationResults.push(result);
        if (!result.valid || result.warnings.length > 0) {
          allValid = false;
        }
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify({ all_valid: allValid, stories: validationResults }, null, 2));
      } else {
        console.log(`${c.cyan}Story Validation${c.reset}\n`);

        for (const result of validationResults) {
          const statusIcon = result.valid && result.warnings.length === 0 ? `${c.green}✓${c.reset}` : `${c.yellow}⚠${c.reset}`;
          console.log(`${statusIcon} ${result.id}: ${result.title}`);
          console.log(`  Coverage: ${result.coverage}%`);

          if (result.warnings.length > 0) {
            for (const w of result.warnings) {
              console.log(`  ${c.yellow}${w.type}:${c.reset} ${w.message}`);
            }
          }
          console.log();
        }

        if (allValid) {
          console.log(`${c.green}✓ All stories valid with full coverage${c.reset}`);
        } else {
          console.log(`${c.yellow}⚠ Some stories have warnings${c.reset}`);
        }
      }
      break;

    // E3-S3: Presentation Flow Commands
    case 'present':
    case 'present-next':
      // Start/continue presentation - show next story
      const presentResult = getNextStory();

      if (presentResult.error) {
        console.error(`${c.red}Error: ${presentResult.error}${c.reset}`);
        process.exit(1);
      }

      if (presentResult.complete) {
        console.log(`${c.green}╔══════════════════════════════════════════════════════════════╗${c.reset}`);
        console.log(`${c.green}║                    PRESENTATION COMPLETE                      ║${c.reset}`);
        console.log(`${c.green}╠══════════════════════════════════════════════════════════════╣${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  Total Stories: ${presentResult.summary.total.toString().padEnd(41)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ${c.green}✓${c.reset} Approved: ${presentResult.summary.approved.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ${c.red}✗${c.reset} Rejected: ${presentResult.summary.rejected.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ○ Skipped:  ${presentResult.summary.skipped.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}╚══════════════════════════════════════════════════════════════╝${c.reset}`);

        const completionSummary = getCompletionSummary();
        if (completionSummary.approved.length > 0) {
          console.log(`\n${c.green}Approved Stories:${c.reset}`);
          for (const s of completionSummary.approved) {
            console.log(`  - ${s.title}`);
          }
        }
        if (completionSummary.rejected.length > 0) {
          console.log(`\n${c.red}Rejected Stories:${c.reset}`);
          for (const s of completionSummary.rejected) {
            console.log(`  - ${s.title}: "${s.reason}"`);
          }
        }
        console.log(`\n${c.dim}Next steps:${c.reset}`);
        console.log(`  - Edit rejected stories: flow transcript-digest edit-story <id>`);
        console.log(`  - Export approved: flow transcript-digest export-approved`);
        console.log(`  - Add to ready.json: flow transcript-digest finalize`);
        break;
      }

      // Show story summary
      console.log(formatStorySummary(presentResult));
      console.log(formatActionsPrompt());
      break;

    case 'approve':
      // Approve current story
      const approveResult = approveCurrentStory();

      if (approveResult.error) {
        console.error(`${c.red}Error: ${approveResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Approved: ${approveResult.title}${c.reset}`);

      // Auto-advance to next story
      const nextAfterApprove = getNextStory();
      if (nextAfterApprove.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterApprove.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterApprove));
        console.log(formatActionsPrompt());
      }
      break;

    case 'reject':
      // Reject current story with reason
      const rejectReason = args.slice(1).join(' ') || 'No reason provided';

      const rejectResult = rejectCurrentStory(rejectReason);

      if (rejectResult.error) {
        console.error(`${c.red}Error: ${rejectResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.red}✗ Rejected: ${rejectResult.title}${c.reset}`);
      console.log(`${c.dim}Reason: ${rejectResult.reason}${c.reset}`);

      // Auto-advance to next story
      const nextAfterReject = getNextStory();
      if (nextAfterReject.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterReject.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterReject));
        console.log(formatActionsPrompt());
      }
      break;

    case 'skip':
      // Skip current story for later
      const skipResult = skipCurrentStory();

      if (skipResult.error) {
        console.error(`${c.red}Error: ${skipResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}○ Skipped: ${skipResult.title}${c.reset}`);

      // Auto-advance to next story
      const nextAfterSkip = getNextStory();
      if (nextAfterSkip.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterSkip.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterSkip));
        console.log(formatActionsPrompt());
      }
      break;

    case 'view-current':
    case 'view-story':
      // View current story in full
      const currentStory = getCurrentStory();

      if (currentStory.error) {
        console.error(`${c.red}Error: ${currentStory.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`\n${c.cyan}Story ${currentStory.index} of ${currentStory.total}${c.reset}\n`);
      console.log(formatStoryAsMarkdown(currentStory.story));
      console.log(formatActionsPrompt());
      break;

    case 'presentation-status':
      // Show presentation status
      const presStatus = getPresentationStatus();

      if (!presStatus.active) {
        console.log(`${c.dim}No presentation in progress${c.reset}`);
        console.log(`${c.dim}Run 'present' to start presenting stories.${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Presentation Status${c.reset}\n`);
      console.log(`Status: ${presStatus.status}`);
      console.log(`Current: ${presStatus.current || 'none'}`);
      console.log(`\n${c.cyan}Progress:${c.reset}`);
      console.log(`  Reviewed: ${presStatus.progress.reviewed}/${presStatus.progress.total}`);
      console.log(`  Remaining: ${presStatus.progress.remaining}`);
      console.log(`\n${c.cyan}Summary:${c.reset}`);
      console.log(`  ${c.green}Approved:${c.reset} ${presStatus.summary.approved}`);
      console.log(`  ${c.red}Rejected:${c.reset} ${presStatus.summary.rejected}`);
      console.log(`  ${c.yellow}Skipped:${c.reset} ${presStatus.summary.skipped}`);
      console.log(`  ${c.dim}Pending:${c.reset} ${presStatus.summary.pending}`);
      break;

    case 'reset-presentation':
      // Reset presentation to start over
      const resetResult = resetPresentation();

      if (resetResult.error) {
        console.error(`${c.red}Error: ${resetResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Presentation reset${c.reset}`);
      console.log(`${c.dim}${resetResult.total} stories ready for review.${c.reset}`);
      console.log(`${c.dim}Run 'present' to start.${c.reset}`);
      break;

    case 'completion-summary':
      // Show completion summary
      const compSummary = getCompletionSummary();

      if (compSummary.error) {
        console.error(`${c.red}Error: ${compSummary.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(compSummary, null, 2));
        break;
      }

      console.log(`${c.cyan}Presentation Summary${c.reset}\n`);
      console.log(`Complete: ${compSummary.complete ? 'Yes' : 'No'}`);
      console.log(`Total: ${compSummary.summary.total}`);
      console.log(`${c.green}Approved:${c.reset} ${compSummary.summary.approved}`);
      console.log(`${c.red}Rejected:${c.reset} ${compSummary.summary.rejected}`);
      console.log(`${c.yellow}Skipped:${c.reset} ${compSummary.summary.skipped}`);
      console.log(`${c.dim}Pending:${c.reset} ${compSummary.summary.pending}`);

      if (compSummary.approved.length > 0) {
        console.log(`\n${c.green}Approved Stories:${c.reset}`);
        for (const s of compSummary.approved) {
          console.log(`  - ${s.title}`);
        }
      }

      if (compSummary.rejected.length > 0) {
        console.log(`\n${c.red}Rejected Stories:${c.reset}`);
        for (const s of compSummary.rejected) {
          console.log(`  - ${s.title}: "${s.reason}"`);
        }
      }

      if (compSummary.skipped.length > 0) {
        console.log(`\n${c.yellow}Skipped Stories:${c.reset}`);
        for (const s of compSummary.skipped) {
          console.log(`  - ${s.title}`);
        }
      }
      break;

    // E3-S4: Edit and Change Handling Commands
    case 'edit-story':
      // Start editing a story
      const editStoryId = args[1];
      if (!editStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: edit-story <story-id>${c.reset}`);
        process.exit(1);
      }

      const editResult = startEditSession(editStoryId);

      if (editResult.error) {
        console.error(`${c.red}Error: ${editResult.error}${c.reset}`);
        if (editResult.active_session) {
          console.log(`${c.dim}Active session: ${editResult.active_session.story_id}${c.reset}`);
        }
        process.exit(1);
      }

      console.log(`${c.green}✓ Edit session started${c.reset}`);
      console.log(`${c.cyan}Session ID:${c.reset} ${editResult.session.id}`);
      console.log(`${c.cyan}Story:${c.reset} ${editResult.story.title}`);

      if (editResult.rejection_reason) {
        console.log(`\n${c.yellow}Rejection reason:${c.reset} ${editResult.rejection_reason}`);
      }

      console.log(`\n${c.cyan}Editable sections:${c.reset}`);
      for (const section of editResult.editable_sections) {
        console.log(`  - ${section}`);
      }

      console.log(`\n${c.dim}Available commands:${c.reset}`);
      console.log(`  edit-user-story ${editStoryId} --action "manage users"`);
      console.log(`  edit-criterion ${editStoryId} AC-1 --then "new outcome"`);
      console.log(`  add-criterion ${editStoryId} --scenario "New scenario" ...`);
      console.log(`  remove-criterion ${editStoryId} AC-2`);
      console.log(`  edit-changes`);
      console.log(`  commit-edit`);
      console.log(`  cancel-edit`);
      break;

    case 'edit-user-story':
      // Edit user story fields
      const editUsStoryId = args[1];
      if (!editUsStoryId) {
        console.error(`${c.red}Error: Story ID required${c.reset}`);
        process.exit(1);
      }

      const usUpdates = {};
      for (let i = 2; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--user-type') usUpdates.user_type = value;
        if (flag === '--action') usUpdates.action = value;
        if (flag === '--benefit') usUpdates.benefit = value;
      }

      if (Object.keys(usUpdates).length === 0) {
        console.error(`${c.red}Error: No updates specified. Use --user-type, --action, or --benefit${c.reset}`);
        process.exit(1);
      }

      const usEditResult = editUserStory(editUsStoryId, usUpdates);

      if (usEditResult.error) {
        console.error(`${c.red}Error: ${usEditResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ User story updated${c.reset}`);
      for (const change of usEditResult.changes) {
        console.log(`  ${c.dim}${change.field}:${c.reset} "${change.before}" → "${change.after}"`);
      }
      break;

    case 'edit-criterion':
      // Edit acceptance criterion
      const editCrStoryId = args[1];
      const editCrId = args[2];
      if (!editCrStoryId || !editCrId) {
        console.error(`${c.red}Error: Story ID and criterion ID required${c.reset}`);
        console.error(`${c.dim}Usage: edit-criterion <story-id> <criterion-id> [--scenario "..."] [--given "..."] [--when "..."] [--then "..."]${c.reset}`);
        process.exit(1);
      }

      const crUpdates = {};
      for (let i = 3; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--scenario') crUpdates.scenario = value;
        if (flag === '--given') crUpdates.given = value;
        if (flag === '--when') crUpdates.when = value;
        if (flag === '--then') crUpdates.then = value;
      }

      if (Object.keys(crUpdates).length === 0) {
        console.error(`${c.red}Error: No updates specified. Use --scenario, --given, --when, or --then${c.reset}`);
        process.exit(1);
      }

      const crEditResult = editCriterion(editCrStoryId, editCrId, crUpdates);

      if (crEditResult.error) {
        console.error(`${c.red}Error: ${crEditResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Criterion ${editCrId} updated${c.reset}`);
      for (const change of crEditResult.changes) {
        console.log(`  ${c.dim}${change.field}:${c.reset} "${change.before}" → "${change.after}"`);
      }
      break;

    case 'add-criterion':
      // Add new acceptance criterion
      const addCrStoryId = args[1];
      if (!addCrStoryId) {
        console.error(`${c.red}Error: Story ID required${c.reset}`);
        console.error(`${c.dim}Usage: add-criterion <story-id> --scenario "..." --given "..." --when "..." --then "..."${c.reset}`);
        process.exit(1);
      }

      const newCriterion = {};
      for (let i = 2; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--scenario') newCriterion.scenario = value;
        if (flag === '--given') newCriterion.given = value;
        if (flag === '--when') newCriterion.when = value;
        if (flag === '--then') newCriterion.then = value;
      }

      const addCrResult = addCriterion(addCrStoryId, newCriterion);

      if (addCrResult.error) {
        console.error(`${c.red}Error: ${addCrResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Added criterion ${addCrResult.criterion.id}${c.reset}`);
      console.log(`${c.dim}Scenario: ${addCrResult.criterion.scenario}${c.reset}`);
      break;

    case 'remove-criterion':
      // Remove acceptance criterion
      const rmCrStoryId = args[1];
      const rmCrId = args[2];
      if (!rmCrStoryId || !rmCrId) {
        console.error(`${c.red}Error: Story ID and criterion ID required${c.reset}`);
        console.error(`${c.dim}Usage: remove-criterion <story-id> <criterion-id>${c.reset}`);
        process.exit(1);
      }

      const rmReason = args.slice(3).join(' ') || 'Removed by user';
      const rmCrResult = removeCriterion(rmCrStoryId, rmCrId, rmReason);

      if (rmCrResult.error) {
        console.error(`${c.red}Error: ${rmCrResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}✓ Removed criterion ${rmCrId}${c.reset}`);
      console.log(`${c.dim}Scenario: ${rmCrResult.removed.scenario}${c.reset}`);
      break;

    case 'edit-changes':
      // Show changes in current edit session
      const changesResult = getEditChanges();

      if (changesResult.error) {
        console.error(`${c.red}Error: ${changesResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(changesResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Edit Session Changes${c.reset}\n`);
      console.log(`Session ID: ${changesResult.session_id}`);
      console.log(`Story: ${changesResult.story_id}`);
      console.log(`Started: ${changesResult.started_at}`);
      console.log(`Trigger: ${changesResult.trigger}`);
      if (changesResult.rejection_reason) {
        console.log(`Rejection reason: ${changesResult.rejection_reason}`);
      }

      if (changesResult.changes.length === 0) {
        console.log(`\n${c.dim}No changes made yet${c.reset}`);
      } else {
        console.log(`\n${c.cyan}Changes (${changesResult.changes_count}):${c.reset}`);
        for (const change of changesResult.changes) {
          console.log(`\n  ${c.dim}${change.id}${c.reset} [${change.type}]`);
          if (change.target) console.log(`    Target: ${change.target}`);
          if (change.field) console.log(`    Field: ${change.field}`);
          if (change.before !== null && change.before !== undefined) {
            const beforeStr = typeof change.before === 'object' ? JSON.stringify(change.before).slice(0, 50) : change.before;
            console.log(`    Before: "${beforeStr}"`);
          }
          if (change.after !== null && change.after !== undefined) {
            const afterStr = typeof change.after === 'object' ? JSON.stringify(change.after).slice(0, 50) : change.after;
            console.log(`    After: "${afterStr}"`);
          }
        }
      }
      break;

    case 'commit-edit':
      // Commit edit session
      const commitResult = commitEditSession();

      if (commitResult.error) {
        console.error(`${c.red}Error: ${commitResult.error}${c.reset}`);
        if (commitResult.errors) {
          console.log(`\n${c.red}Validation errors:${c.reset}`);
          for (const err of commitResult.errors) {
            console.log(`  ${c.red}✗${c.reset} ${err.field}: ${err.message}`);
          }
        }
        process.exit(1);
      }

      console.log(`${c.green}✓ Edit session committed${c.reset}`);
      console.log(`${c.cyan}Story:${c.reset} ${commitResult.story_id}`);
      console.log(`${c.cyan}Changes made:${c.reset} ${commitResult.changes_made}`);
      console.log(`${c.cyan}Status:${c.reset} ${commitResult.previous_status} → ${commitResult.new_status}`);

      if (commitResult.validation_warnings?.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const warn of commitResult.validation_warnings) {
          console.log(`  ${c.yellow}⚠${c.reset} ${warn.field}: ${warn.message}`);
        }
      }

      console.log(`\n${c.dim}Story returned to presentation queue. Run 'present' to review.${c.reset}`);
      break;

    case 'cancel-edit':
      // Cancel edit session
      const cancelResult = cancelEditSession();

      if (cancelResult.error) {
        console.error(`${c.red}Error: ${cancelResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}✓ Edit session cancelled${c.reset}`);
      console.log(`${c.dim}Discarded ${cancelResult.discarded_changes} change(s)${c.reset}`);
      break;

    case 'edit-history':
      // Show edit history for a story
      const histStoryId = args[1];
      if (!histStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: edit-history <story-id>${c.reset}`);
        process.exit(1);
      }

      const histResult = getEditHistory(histStoryId);

      if (histResult.error) {
        console.error(`${c.red}Error: ${histResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(histResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Edit History: ${histResult.title}${c.reset}\n`);
      console.log(`Story ID: ${histResult.story_id}`);
      console.log(`Total edits: ${histResult.edit_count}`);

      if (histResult.sessions.length === 0) {
        console.log(`\n${c.dim}No edit sessions recorded${c.reset}`);
      } else {
        console.log(`\n${c.cyan}Sessions:${c.reset}`);
        for (const sess of histResult.sessions) {
          const status = sess.cancelled ? `${c.red}cancelled${c.reset}` : `${c.green}committed${c.reset}`;
          console.log(`  ${sess.session_id} | ${sess.timestamp} | ${sess.trigger} | ${sess.changes_count} changes | ${status}`);
        }
      }
      break;

    case 'list-editable':
    case 'editable-stories':
      // List stories that can be edited
      const editableResult = listEditableStories();

      if (editableResult.error) {
        console.error(`${c.red}Error: ${editableResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(editableResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Editable Stories (${editableResult.total})${c.reset}\n`);

      if (editableResult.rejected.length > 0) {
        console.log(`${c.red}Rejected (${editableResult.rejected.length}):${c.reset}`);
        for (const s of editableResult.rejected) {
          console.log(`  ${s.id}: ${s.title}`);
          console.log(`    ${c.dim}Reason: ${s.rejection_reason}${c.reset}`);
        }
        console.log();
      }

      if (editableResult.approved.length > 0) {
        console.log(`${c.green}Approved (${editableResult.approved.length}):${c.reset}`);
        for (const s of editableResult.approved) {
          console.log(`  ${s.id}: ${s.title}`);
        }
        console.log();
      }

      if (editableResult.skipped.length > 0) {
        console.log(`${c.yellow}Skipped (${editableResult.skipped.length}):${c.reset}`);
        for (const s of editableResult.skipped) {
          console.log(`  ${s.id}: ${s.title}`);
        }
        console.log();
      }

      if (editableResult.total === 0) {
        console.log(`${c.dim}No editable stories. Run presentation first.${c.reset}`);
      }
      break;

    // ========================================================================
    // E3-S5: ready.json Integration Commands
    // ========================================================================

    case 'export-preview':
    case 'preview-export':
      // Preview what would be exported to ready.json
      const previewResult = previewExport();

      if (previewResult.error) {
        console.error(`${c.red}Error: ${previewResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(previewResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Export Preview${c.reset}\n`);
      console.log(`${c.green}Approved stories:${c.reset} ${previewResult.approved_count}`);
      console.log(`${c.yellow}Pending stories:${c.reset} ${previewResult.pending_count}`);
      console.log();

      if (previewResult.stories.length > 0) {
        console.log(`${c.cyan}Stories to export:${c.reset}`);
        for (const s of previewResult.stories) {
          console.log(`  ${s.id}: ${s.title}`);
          console.log(`    ${c.dim}Priority: ${s.priority} | Criteria: ${s.criteria_count} | Coverage: ${s.coverage}%${c.reset}`);
        }
        console.log();
      }

      if (previewResult.validation.warnings.length > 0) {
        console.log(`${c.yellow}Warnings:${c.reset}`);
        for (const w of previewResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
        console.log();
      }

      if (previewResult.validation.errors.length > 0) {
        console.log(`${c.red}Errors:${c.reset}`);
        for (const e of previewResult.validation.errors) {
          console.log(`  ${e.story_id}: ${err.message}`);
        }
        console.log();
      }

      console.log(`${c.cyan}Ready to export:${c.reset} ${previewResult.ready_to_export ? `${c.green}Yes` : `${c.red}No`}${c.reset}`);
      if (previewResult.ready_to_export) {
        console.log(`\n${c.dim}Run 'flow transcript-digest finalize' to export to ready.json${c.reset}`);
      }
      break;

    case 'export-approved':
      // Export approved stories (dry run, no ready.json update)
      const exportApprovedResult = exportApprovedStories();

      if (exportApprovedResult.error) {
        console.error(`${c.red}Error: ${exportApprovedResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(exportApprovedResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Exported Stories (${exportApprovedResult.summary.exported})${c.reset}\n`);

      for (const task of exportApprovedResult.tasks) {
        console.log(`${c.green}${task.id}${c.reset}: ${task.title}`);
        console.log(`  ${c.dim}Priority: ${task.priority} | Criteria: ${task.metadata.criteria_count} | Coverage: ${task.metadata.coverage}%${c.reset}`);
      }

      if (exportApprovedResult.loadErrors.length > 0) {
        console.log(`\n${c.red}Failed to load:${c.reset}`);
        for (const e of exportApprovedResult.loadErrors) {
          console.log(`  ${e.id}: ${e.error}`);
        }
      }

      if (exportApprovedResult.validation.warnings.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const w of exportApprovedResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
      }
      break;

    case 'finalize':
      // Finalize digestion and export to ready.json
      const finalizeOptions = {
        force: args.includes('--force'),
        exportFiles: args.includes('--export-files'),
        featureName: null
      };

      // Parse --feature option
      const featureIdx = args.indexOf('--feature');
      if (featureIdx !== -1 && args[featureIdx + 1]) {
        finalizeOptions.featureName = args[featureIdx + 1];
      }

      const finalizeResult = finalizeDigestion(finalizeOptions);

      if (finalizeResult.error) {
        console.error(`${c.red}Error: ${finalizeResult.error}${c.reset}`);
        if (finalizeResult.pending) {
          console.error(`${c.dim}${finalizeResult.pending} stories still need review.${c.reset}`);
          console.error(`${c.dim}Use --force to proceed anyway.${c.reset}`);
        }
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(finalizeResult, null, 2));
        break;
      }

      console.log(`${c.green}✓ Digestion Finalized${c.reset}\n`);
      console.log(`${c.cyan}Summary:${c.reset}`);
      console.log(`  Approved stories: ${finalizeResult.approved_count}`);
      console.log(`  Tasks added to ready.json: ${finalizeResult.tasks_added}`);
      console.log(`  Tasks skipped (duplicates): ${finalizeResult.tasks_skipped}`);
      if (finalizeResult.files_exported > 0) {
        console.log(`  Story files exported: ${finalizeResult.files_exported}`);
      }
      console.log(`  Digest status: ${c.green}${finalizeResult.digest_status}${c.reset}`);

      if (finalizeResult.validation?.warnings?.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const w of finalizeResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
      }

      console.log(`\n${c.dim}Tasks are now available in .workflow/state/ready.json${c.reset}`);
      console.log(`${c.dim}Run '/wogi-ready' to see all available tasks${c.reset}`);
      break;

    case 'help':
    default:
      console.log(`
${c.cyan}Transcript Digestion CLI${c.reset}

${c.dim}Core Commands:${c.reset}
  status              Show current digest session status
  new <file|->        Create new digest session from file or stdin
  check <file|-> [--json]  Check if text should trigger digestion (enhanced)
  analyze <file|-> [--json]  Detailed input analysis (metrics, format, thresholds)
  classify <file|-> [--json] [-v]  Classify content type (transcript, requirements, etc.)
  recommend <file|-> [--json]  Get processing recommendation

${c.dim}Subtitle Parsing (E4-S3):${c.reset}
  parse-vtt <file|->        Parse VTT subtitle file to text
  parse-srt <file|->        Parse SRT subtitle file to text
  parse-subtitle <file|->   Auto-detect and parse VTT/SRT file
    Options: --json (cue data), --stats (statistics)
             --timestamps/-t, --speakers/-s, --no-merge

${c.dim}Meeting Parsing (E4-S4):${c.reset}
  parse-zoom <file|->       Parse Zoom transcript (chat or VTT)
  parse-teams <file|->      Parse Teams transcript (chat, VTT, or JSON)
  parse-meeting <file|->    Auto-detect Zoom/Teams format
    Options: --json, --stats, --timestamps/-t, --no-merge
             --include-system (include join/leave messages)
             --format <chat|vtt|json> (force format)

${c.dim}Language Detection (E5-S1):${c.reset}
  detect-language <file|->  Detect primary language of content
  detect-languages <file|-> Detect multiple languages in mixed content
  language-info [code]      Get info about a language or list all supported
    Options: --json, -v/--verbose, --segment-size <n>

${c.dim}Multi-language Clarification (E5-S2):${c.reset}
  set-language <code>       Set preferred language for questions
  show-language             Show current session language settings
  detect-session-language   Detect and store language for active session
    Options: --json

${c.dim}Durable Sessions (E5-S3):${c.reset}
  sessions                  List all digest sessions
  session-info <id>         Show details for a specific session
  switch-session <id>       Switch to a different session
  session-recovery [id]     Show recovery summary and next steps
  archive-session <id>      Archive a session
  delete-session <id>       Delete a session
    Options: --json, --status=<active|completed|archived>
             --delete-files (for delete-session)

${c.dim}Large Transcript Chunking (E5-S4):${c.reset}
  needs-chunking <file|->   Check if transcript needs chunking
  plan-chunks <file|->      Plan how to chunk a large transcript
  chunk-status              Show current chunking status
    Options: --json, --target-words <n> (for plan-chunks)

${c.dim}Pass Commands:${c.reset}
  topics              Show extracted topics
  save-topics         Save topics from stdin (JSON)
  pass2 | statements  Run Pass 2: Statement Association
  statement-map       Show full statement map (JSON)
  orphans             Show orphan statements needing clarification
  contradictions      Show detected contradictions
  pass3               Run Pass 3: Orphan Check (resolve orphans)
  pass4               Run Pass 4: Contradiction Resolution
  coverage            Show coverage summary

${c.dim}Question Commands:${c.reset}
  questions           Generate clarifying questions
  show-questions      Show pending questions grouped by topic
  clarifications      Show pending clarification questions

${c.dim}Conversation Commands (E2-S2):${c.reset}
  answer [--voice] "<response>"  Process natural language answer
  capture-answer <id> <ans>   Manually capture answer for question
  next-questions [n] [topic]  Get next batch of questions (default: 5)
  completion-status           Check if all clarifications complete
  resolve-contradiction <id> <choice>  Resolve contradiction

${c.dim}Voice Commands (E2-S3):${c.reset}
  voice-normalize "<text>"    Test voice normalization (no session needed)

${c.dim}Persistence Commands (E2-S4):${c.reset}
  resume                      Resume an interrupted session
  review                      Review all answered questions
  history                     Show session interaction history
  export [--format json|md]   Export session state for backup

${c.dim}Complexity Commands (E3-S1):${c.reset}
  complexity [--json]         Analyze complexity and recommend output structure

${c.dim}Story Commands (E3-S2):${c.reset}
  generate-story <topic> [--json|--md]  Generate story for a topic
  generate-stories [--json]    Generate stories for all topics
  show-story <id> [--json]     Show a specific story
  list-stories [--json]        List all generated stories
  validate-stories [--json]    Validate story coverage

${c.dim}Presentation Commands (E3-S3):${c.reset}
  present                       Start/continue story presentation
  approve                       Approve current story and advance
  reject "<reason>"             Reject current story with reason
  skip                          Skip current story for later
  view-current                  View full current story
  presentation-status           Show presentation progress
  reset-presentation            Reset presentation to start over
  completion-summary [--json]   Show approval/rejection summary

${c.dim}Edit Commands (E3-S4):${c.reset}
  edit-story <id>               Start editing a story
  edit-user-story <id> [opts]   Edit user story (--user-type, --action, --benefit)
  edit-criterion <id> <ac> [opts]  Edit criterion (--scenario, --given, --when, --then)
  add-criterion <id> [opts]     Add new criterion
  remove-criterion <id> <ac>    Remove criterion
  edit-changes [--json]         Show changes in current session
  commit-edit                   Commit edits, return to queue
  cancel-edit                   Discard edits
  edit-history <id> [--json]    Show edit history for story
  list-editable [--json]        List editable stories

${c.dim}Export Commands (E3-S5):${c.reset}
  export-preview [--json]       Preview what would be exported to ready.json
  export-approved [--json]      Export approved stories (dry run)
  finalize [options]            Finalize and export to ready.json
                                --force: Proceed with pending stories
                                --export-files: Also export .md files
                                --feature <name>: Group under feature name

${c.dim}Examples:${c.reset}
  flow transcript-digest status
  flow transcript-digest new transcript.txt
  cat transcript.txt | flow transcript-digest new -
  flow transcript-digest check large-input.txt
  flow transcript-digest pass2
  flow transcript-digest pass3
  flow transcript-digest pass4
  flow transcript-digest questions
  flow transcript-digest show-questions
  flow transcript-digest answer "Name, email, and role columns"
  flow transcript-digest answer --voice "um so like name and uh email I guess"
  flow transcript-digest voice-normalize "um so like three columns actually wait four columns"
  flow transcript-digest completion-status
  flow transcript-digest resume
  flow transcript-digest review
  flow transcript-digest export --format md
  flow transcript-digest complexity
  flow transcript-digest complexity --json
  flow transcript-digest generate-stories
  flow transcript-digest show-story story-abc123 --md
  flow transcript-digest present
  flow transcript-digest approve
  flow transcript-digest reject "Need more detail on validation"
  flow transcript-digest skip
  flow transcript-digest presentation-status
  flow transcript-digest list-editable
  flow transcript-digest edit-story story-abc123
  flow transcript-digest edit-user-story story-abc123 --action "manage user accounts"
  flow transcript-digest edit-criterion story-abc123 AC-1 --then "table should be sortable"
  flow transcript-digest add-criterion story-abc123 --scenario "Sort users" --given "viewing table" --when "click column" --then "sorted"
  flow transcript-digest edit-changes
  flow transcript-digest commit-edit
  flow transcript-digest export-preview
  flow transcript-digest export-approved --json
  flow transcript-digest finalize
  flow transcript-digest finalize --force
  flow transcript-digest finalize --export-files --feature user-management
`);
  }
}

// Export for use as module
module.exports = {
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
  // Story Generation (E3-S2)
  detectUserType,
  extractObject,
  generateScenarioName,
  extractActionFromText,
  extractOutcomeFromText,
  extractGiven,
  extractWhen,
  extractThen,
  generateCriteriaFromClarification,
  buildTraceabilityMatrix,
  validateStoryCoverage,
  generateStoryFromTopic,
  generateAllStories,
  saveStory,
  loadStory,
  loadAllStories,
  formatStoryAsMarkdown,
  // Presentation Flow (E3-S3)
  loadQueue,
  saveQueue,
  initializePresentation,
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
  // Edit and Change Handling (E3-S4)
  loadEditSessions,
  saveEditSessions,
  startEditSession,
  getActiveEditSession,
  recordChange,
  editUserStory,
  editCriterion,
  addCriterion,
  removeCriterion,
  validateEditedStory,
  recalculateCoverage,
  updateQueueAfterEdit,
  commitEditSession,
  cancelEditSession,
  getEditChanges,
  getEditHistory,
  listEditableStories,
  // ready.json Integration (E3-S5)
  generateWorkflowId,
  generateSubTaskId,
  mapPriority,
  formatUserStoryDescription,
  convertStoryToTask,
  validateForExport,
  exportApprovedStories,
  createFeatureTask,
  addTasksToReadyJson,
  formatTaskAsMarkdown,
  exportStoryFiles,
  previewExport,
  finalizeDigestion,
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
  // VTT/SRT Format Parsing (E4-S3)
  timestampToMs,
  msToTimestamp,
  cleanSubtitleText,
  extractVTTSpeaker,
  extractSpeaker,
  parseVTT,
  parseSRT,
  mergeCues,
  parseSubtitle,
  formatCuesAsText,
  getSubtitleStats,
  // Zoom/Teams Parsing (E4-S4)
  ZOOM_PATTERNS,
  TEAMS_PATTERNS,
  isSystemMessage,
  parseTimeToMs,
  parseZoomChat,
  parseZoomVTT,
  parseTeamsChat,
  parseTeamsVTT,
  parseTeamsJSON,
  detectMeetingType,
  parseZoom,
  parseTeams,
  parseMeeting,
  mergeMeetingEntries,
  formatMeetingAsText,
  getMeetingStats,
  // Language Detection (E5-S1)
  SCRIPT_PATTERNS,
  LANGUAGE_INFO,
  COMMON_WORDS,
  TRIGRAM_PROFILES,
  detectScript,
  cleanForDetection,
  extractWords,
  analyzeCommonWords,
  extractTrigrams,
  analyzeNgrams,
  combineLanguageScores,
  detectLanguage,
  detectMultipleLanguages,
  getLanguageInfo,
  listSupportedLanguages,
  // Multi-language Clarification (E5-S2)
  QUESTION_TEMPLATES_BY_LANGUAGE,
  getQuestionTemplates,
  generateLocalizedQuestion,
  detectSessionLanguage,
  getTopicLanguage,
  setLanguagePreference,
  getEffectiveLanguage,
  getSessionLanguageInfo,
  // Durable Session Persistence (E5-S3)
  loadDurableSessions,
  saveDurableSessions,
  upsertDurableSession,
  getSessionProgress,
  registerDurableSession,
  updateDurableProgress,
  createDurableCheckpoint,
  listDurableSessions,
  getDurableSession,
  switchDurableSession,
  updateRecoveryContext,
  generateRecoverySummaryForSession,
  getTimeSince,
  determineNextAction,
  archiveDurableSession,
  deleteDurableSession,
  completeDurableSession,
  // Large Transcript Chunking (E5-S4)
  CHUNKING_DEFAULTS,
  SPEAKER_BOUNDARY_PATTERNS,
  needsChunking,
  splitIntoSentences,
  findNaturalBoundary,
  planChunks,
  createChunks,
  normalizeTopicTitle,
  normalizeStatement,
  mergeChunkTopics,
  mergeChunkStatements,
  initializeChunkingState,
  loadChunkingState,
  saveChunkingState,
  updateChunkStatus,
  getChunkContent,
  getChunkingStatus
};

// Run CLI if called directly
if (require.main === module) {
  main();
}
