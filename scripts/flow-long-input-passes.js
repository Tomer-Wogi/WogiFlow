/**
 * Long Input Processing - Multi-Pass Pipeline
 *
 * Extracted from flow-long-input.js
 * Contains runPass2, runPass3, runPass4, runFullPipeline, quickProcess,
 * and supporting functions for orphan clustering and topic creation.
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateHashId } = require('./flow-utils');

// These are injected via init()
let _loadActiveDigest = null;
let _updatePhase = null;
let _now = null;
let _countWords = null;
let _loadTopics = null;
let _saveTopics = null;
let _splitIntoStatements = null;
let _isMeaningfulStatement = null;
let _associateStatements = null;
let _saveStatementMap = null;
let _loadStatementMap = null;
let _detectContradictions = null;
let _resolveOrphan = null;
let _calculateResolutionConfidence = null;
let _generateContradictionQuestion = null;
let _isAdditive = null;
let _detectCorrectionPhrase = null;
let _saveClarifications = null;
let _loadClarifications = null;
let _createSession = null;

/**
 * Initialize with core functions from other modules.
 * @param {Object} deps
 */
function _requireInit(fnName) {
  if (!_loadActiveDigest) {
    throw new Error(`flow-long-input-passes: init() must be called before ${fnName}()`);
  }
}

function init(deps) {
  _loadActiveDigest = deps.loadActiveDigest;
  _updatePhase = deps.updatePhase;
  _now = deps.now;
  _countWords = deps.countWords;
  _loadTopics = deps.loadTopics;
  _saveTopics = deps.saveTopics;
  _splitIntoStatements = deps.splitIntoStatements;
  _isMeaningfulStatement = deps.isMeaningfulStatement;
  _associateStatements = deps.associateStatements;
  _saveStatementMap = deps.saveStatementMap;
  _loadStatementMap = deps.loadStatementMap;
  _detectContradictions = deps.detectContradictions;
  _resolveOrphan = deps.resolveOrphan;
  _calculateResolutionConfidence = deps.calculateResolutionConfidence;
  _generateContradictionQuestion = deps.generateContradictionQuestion;
  _isAdditive = deps.isAdditive;
  _detectCorrectionPhrase = deps.detectCorrectionPhrase;
  _saveClarifications = deps.saveClarifications;
  _loadClarifications = deps.loadClarifications;
  _createSession = deps.createSession;
}

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
 * Create a new topic from orphan statements
 */
function createTopicFromOrphans(orphans, _existingTopics) {
  // Guard against empty orphans array
  if (!orphans || orphans.length === 0) {
    const topicId = generateHashId('t-auto', 'empty', 'fallback');
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
      created_at: _now()
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
    created_at: _now()
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
  const activeDigest = _loadActiveDigest();
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
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const { safeJsonParse } = require('./flow-utils');
  const orphansPath = path.join(activeDigest.session.digest_path, 'orphans.json');
  const data = safeJsonParse(orphansPath, null);
  if (!data) return null;
  return data;
}

/**
 * Process Pass 2: Statement Association
 */
function runPass2() {
  _requireInit('runPass2');
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load transcript
  const transcriptPath = path.join(activeDigest.session.digest_path, 'transcript.md');
  const transcript = fs.readFileSync(transcriptPath, 'utf8');

  // Load topics from Pass 1
  const topicsData = _loadTopics();
  if (!topicsData || !topicsData.topics.length) {
    throw new Error('No topics found - run Pass 1 first');
  }

  // Update phase status
  _updatePhase('statement_mapping', 'in_progress');

  // Split into statements
  const statements = _splitIntoStatements(transcript);

  // Associate with topics
  const mappedStatements = _associateStatements(statements, topicsData.topics);

  // Detect contradictions
  const contradictions = _detectContradictions(mappedStatements);

  // Mark contradicting statements
  for (const contradiction of contradictions) {
    const stmt1 = mappedStatements.find(s => s.id === contradiction.statement1_id);
    const stmt2 = mappedStatements.find(s => s.id === contradiction.statement2_id);
    if (stmt1) stmt1.contradicts = contradiction.statement2_id;
    if (stmt2) stmt2.contradicts = contradiction.statement1_id;
  }

  // Save statement map
  const result = _saveStatementMap({
    statements: mappedStatements,
    contradictions
  });

  return result;
}

/**
 * Process Pass 3: Orphan Check
 */
function runPass3() {
  _requireInit('runPass3');
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load statement map
  const stmtMap = _loadStatementMap();
  if (!stmtMap) {
    throw new Error('No statement map found - run Pass 2 first');
  }

  // Load topics
  const topicsData = _loadTopics();
  if (!topicsData) {
    throw new Error('No topics found');
  }

  // Update phase
  _updatePhase('orphan_check', 'in_progress');

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
    _updatePhase('orphan_check', 'completed', { orphans_resolved: 0 });
    return result;
  }

  const resolved = [];
  const stillOrphans = [];
  const newTopics = [];
  let topics = [...topicsData.topics];

  // First pass: try to resolve each orphan
  for (const orphan of orphanStatements) {
    const resolution = _resolveOrphan(orphan, topics);

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
    _saveTopics({ topics });
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
  _updatePhase('orphan_check', 'completed', {
    orphans_resolved: resolved.length,
    new_topics: newTopics.length,
    remaining_orphans: stillOrphans.length
  });

  return result;
}

/**
 * Process Pass 4: Contradiction Resolution
 */
function runPass4() {
  _requireInit('runPass4');
  const activeDigest = _loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    throw new Error('No active digest session');
  }

  // Load statement map
  const stmtMap = _loadStatementMap();
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
    _updatePhase('contradiction_resolution', 'completed', result.stats);
    return result;
  }

  // Update phase
  _updatePhase('contradiction_resolution', 'in_progress');

  const resolved = [];
  const pending = [];
  const additive = [];

  // Load or create clarifications
  let clarifications = _loadClarifications();

  // Process each contradiction
  for (const contradiction of contradictions) {
    const stmt1 = stmtMap.statements.find(s => s.id === contradiction.statement1_id);
    const stmt2 = stmtMap.statements.find(s => s.id === contradiction.statement2_id);

    if (!stmt1 || !stmt2) continue;

    const resolution = _calculateResolutionConfidence(stmt1, stmt2, contradiction);

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
      contradiction.resolved_at = _now();

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

      const question = _generateContradictionQuestion(stmt1, stmt2, contradiction);

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
        created_at: _now()
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

  _saveClarifications(clarifications);

  const stats = {
    total: contradictions.length,
    auto_resolved: resolved.length,
    needs_clarification: pending.length,
    additive_not_contradiction: additive.length
  };

  _updatePhase('contradiction_resolution', 'completed', stats);

  return {
    resolved,
    pending,
    additive,
    stats
  };
}

/**
 * Run the full 4-pass pipeline in one call.
 *
 * Chains: createSession -> runPass2 -> runPass3 -> runPass4
 *
 * Pass 1 (topic extraction) is handled by the AI via the command spec --
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
  _requireInit('runFullPipeline');
  const { transcript, topics, contentType } = options;

  if (!transcript) throw new Error('transcript is required');
  if (!topics || !topics.length) throw new Error('topics array is required');

  // Step 1: Create session with transcript
  const session = _createSession(transcript, { contentType: contentType || 'transcript' });
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
      detected_at: _now(),
      last_updated: _now(),
      transcript_word_count: _countWords(transcript),
      detection_method: 'unified-pipeline'
    }
  };
  _saveTopics(topicsData);
  _updatePhase('topic_extraction', 'completed', { topics_found: topics.length });

  // Step 3: Run Pass 2 -- statement mapping + contradiction detection
  let pass2Result;
  try {
    pass2Result = runPass2();
  } catch (err) {
    return { error: `Pass 2 failed: ${err.message}`, phase: 'statement_mapping' };
  }

  // Step 4: Run Pass 3 -- orphan check and resolution
  let pass3Result;
  try {
    pass3Result = runPass3();
  } catch (err) {
    return { error: `Pass 3 failed: ${err.message}`, phase: 'orphan_check' };
  }

  // Step 5: Run Pass 4 -- contradiction resolution
  let pass4Result;
  try {
    pass4Result = runPass4();
  } catch (err) {
    return { error: `Pass 4 failed: ${err.message}`, phase: 'contradiction_resolution' };
  }

  // Step 6: Collect clarification questions (from contradictions + orphans)
  const clarifications = _loadClarifications();
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
  const stmtMap = _loadStatementMap();
  const finalTopics = _loadTopics();

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

/**
 * Quick process mode - single-pass extraction without interactive clarification.
 * Used by the long input gate for fast feedback.
 *
 * @param {string} input - The input text to process
 * @param {Object} _options - Processing options
 * @returns {Object} Quick scan results
 */
function quickProcess(input, _options = {}) {
  if (!input || typeof input !== 'string') {
    return { error: 'No input provided' };
  }

  const startTime = Date.now();

  // 1. Split into statements (returns objects with .text property)
  const statements = _splitIntoStatements(input);
  // isMeaningfulStatement returns {meaningful: bool, reason: string}, filter on .meaningful
  const meaningfulStatements = statements.filter(s => _isMeaningfulStatement(s.text).meaningful);

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
          const isCorrection = _detectCorrectionPhrase(text);

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

module.exports = {
  init,
  extractKeyPhrase,
  createTopicFromOrphans,
  ensureGeneralTopic,
  saveOrphans,
  loadOrphans,
  runPass2,
  runPass3,
  runPass4,
  runFullPipeline,
  quickProcess,
  generateQuickSummary
};
