/**
 * Long Input Processing - Statement Association
 *
 * Extracted from flow-long-input.js
 * Handles statement splitting, meaningfulness checks, association with topics,
 * and statement map persistence.
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeJsonParse } = require('./flow-utils');

const { FILLER_PATTERNS, REQUIREMENT_PATTERNS } = require('./flow-long-input-constants');

// These are injected via init()
let _loadActiveDigest = null;
let _updatePhase = null;

/**
 * Initialize with core functions from the main module.
 * @param {Object} deps
 */
function init(deps) {
  _loadActiveDigest = deps.loadActiveDigest;
  _updatePhase = deps.updatePhase;
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
 * Save statement map to digest
 */
function saveStatementMap(statementMap) {
  const activeDigest = _loadActiveDigest();
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
  _updatePhase('statement_mapping', 'completed', {
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
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  const data = safeJsonParse(mapPath, null);
  if (!data) return null;
  return data;
}

module.exports = {
  init,
  isMeaningfulStatement,
  splitIntoStatements,
  calculateAssociationConfidence,
  associateStatements,
  saveStatementMap,
  loadStatementMap
};
