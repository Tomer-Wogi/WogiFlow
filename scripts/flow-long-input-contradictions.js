/**
 * Long Input Processing - Contradiction Detection & Resolution
 *
 * Extracted from flow-long-input.js
 * Handles contradiction detection between statements, orphan resolution via
 * semantic expansion, correction phrase detection, and clarification persistence.
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeJsonParse } = require('./flow-utils');

const {
  SEMANTIC_EXPANSIONS,
  CORRECTION_PATTERNS,
  ADDITIVE_PATTERNS
} = require('./flow-long-input-constants');

// These are injected via init()
let _loadActiveDigest = null;
let _calculateAssociationConfidence = null;

/**
 * Initialize with core functions from other modules.
 * @param {Object} deps
 */
function init(deps) {
  _loadActiveDigest = deps.loadActiveDigest;
  _calculateAssociationConfidence = deps.calculateAssociationConfidence;
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
 * Enhanced confidence calculation with semantic expansion
 */
function calculateExpandedConfidence(statement, topic) {
  let confidence = 0.5;
  const reasons = [];
  const statementLower = statement.text.toLowerCase();

  // Standard matching first
  const { confidence: baseConf, reasons: baseReasons } = _calculateAssociationConfidence(statement, topic);
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
  const activeDigest = _loadActiveDigest();
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
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const clarPath = path.join(activeDigest.session.digest_path, 'clarifications.json');
  const defaultClarifications = {
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
  const data = safeJsonParse(clarPath, null);
  if (!data) return defaultClarifications;
  if (!data.questions) data.questions = [];
  if (!data.contradictions) data.contradictions = [];
  if (!data.metadata) data.metadata = defaultClarifications.metadata;
  return data;
}

module.exports = {
  init,
  detectContradictions,
  calculateExpandedConfidence,
  resolveOrphan,
  detectCorrectionPhrase,
  isAdditive,
  calculateResolutionConfidence,
  generateContradictionQuestion,
  saveClarifications,
  loadClarifications
};
