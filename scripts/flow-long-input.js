#!/usr/bin/env node

/**
 * Long Input Processing - Multi-pass extraction system (Orchestrator)
 *
 * Ensures nothing is missed from long/complex inputs (transcripts, prompts,
 * specs, documents). Uses a 4-pass extraction system:
 *   Pass 1: Topic extraction
 *   Pass 2: Statement association
 *   Pass 3: Orphan check
 *   Pass 4: Contradiction resolution
 *
 * This file is the orchestrator — domain logic is in:
 *   flow-long-input-association.js    — statement splitting, association, statement map I/O
 *   flow-long-input-contradictions.js — contradiction detection, orphan resolution, clarification I/O
 *   flow-long-input-passes.js         — runPass2/3/4, runFullPipeline, quickProcess
 *   flow-long-input-parsing.js        — VTT/SRT/meeting parsing
 *   flow-long-input-language.js       — language detection
 *   flow-long-input-stories.js        — story generation, presentation, editing, export
 *   flow-long-input-chunking.js       — durable sessions, chunking
 *   flow-long-input-constants.js      — shared patterns and constants
 *   flow-long-input-voice.js          — voice input processing
 *   flow-long-input-detection.js      — large input detection, content classification
 *   flow-long-input-complexity.js     — complexity scoring
 *
 * Renamed from flow-transcript-digest.js in v1.8.0
 */

const fs = require('node:fs');
const path = require('node:path');
const { estimateTokens, generateHashId, getConfig, safeJsonParse, PATHS } = require('./flow-utils');
const { success: printSuccess, warn: printWarn } = require('./flow-output');

// Import extracted sub-modules
const transcriptParsing = require('./flow-long-input-parsing');
const transcriptLanguage = require('./flow-long-input-language');
const transcriptStories = require('./flow-long-input-stories');
const transcriptChunking = require('./flow-long-input-chunking');
const longInputConstants = require('./flow-long-input-constants');
const longInputVoice = require('./flow-long-input-voice');
const longInputDetection = require('./flow-long-input-detection');
const longInputComplexity = require('./flow-long-input-complexity');
const longInputAssociation = require('./flow-long-input-association');
const longInputContradictions = require('./flow-long-input-contradictions');
const longInputPasses = require('./flow-long-input-passes');

// Destructure language functions
const {
  detectLanguage, detectMultipleLanguages, getLanguageInfo, LANGUAGE_INFO
} = transcriptLanguage;

// Destructure parsing functions
const {
  parseVTT, parseSRT, parseSubtitle, mergeCues, formatCuesAsText, getSubtitleStats,
  parseZoom, parseTeams, parseMeeting, mergeMeetingEntries, formatMeetingAsText, getMeetingStats
} = transcriptParsing;

// Destructure chunking functions
const {
  loadDurableSessions, listDurableSessions, getDurableSession, switchDurableSession,
  archiveDurableSession, deleteDurableSession, generateRecoverySummaryForSession,
  getTimeSince, needsChunking, planChunks, getChunkingStatus
} = transcriptChunking;

const { listSupportedLanguages } = transcriptLanguage;

// Destructure story functions
const {
  generateStoryFromTopic, generateAllStories, saveStory, loadStory, loadAllStories,
  formatStoryAsMarkdown, getPresentationStatus, getNextStory, getCurrentStory,
  approveCurrentStory, rejectCurrentStory, skipCurrentStory, formatStorySummary,
  formatActionsPrompt, getCompletionSummary, resetPresentation,
  startEditSession, editUserStory, editCriterion, addCriterion, removeCriterion,
  getEditChanges, commitEditSession, cancelEditSession, getEditHistory, listEditableStories,
  previewExport, exportApprovedStories, finalizeDigestion
} = transcriptStories;

// Destructure constants
const {
  FILLER_PATTERNS, REQUIREMENT_PATTERNS, SEMANTIC_EXPANSIONS,
  CORRECTION_PATTERNS, ADDITIVE_PATTERNS,
  ENTITY_PATTERNS, VAGUE_PATTERNS, QUESTION_TEMPLATES,
  DETAIL_PATTERNS, QUESTION_TEMPLATES_BY_LANGUAGE, FOLLOWUP_TRIGGERS,
  UI_PATTERNS, DATA_PATTERNS, INTERACTION_PATTERNS, COMPLEXITY_LEVELS
} = longInputConstants;

// Destructure voice functions
const {
  isVoiceInput, removeFillers, applySelfCorrections, normalizeNumbers,
  detectUncertainty, detectYesNo, addPunctuation, normalizeVoiceInput,
  calculateVoiceConfidence, processVoiceAnswer
} = longInputVoice;

// Destructure detection functions
const {
  measureInputMetrics, isVTTFormat, isSRTFormat, detectMeetingFormat,
  detectInputFormat, analyzeInput, evaluateTrigger,
  generateRecommendationMessage, detectLargeInput,
  scoreContentType, normalizeScore, classifyContentTypes,
  getDetailedClassification, shouldExcludeContent
} = longInputDetection;

// Destructure complexity functions
const {
  countEntityTypes, extractEntities, getComplexityLevel,
  calculateComplexityScore, isRequirement, isVagueStatement,
  hasUIComponent, hasDataModel, hasUserInteraction,
  analyzeTopicComplexity, groupRelatedTopics,
  generateEpicStructure, recommendOutputStructure
} = longInputComplexity;

// Destructure association functions
const {
  isMeaningfulStatement, splitIntoStatements, calculateAssociationConfidence,
  associateStatements, saveStatementMap, loadStatementMap
} = longInputAssociation;

// Destructure contradiction functions
const {
  detectContradictions, resolveOrphan, detectCorrectionPhrase, isAdditive,
  calculateResolutionConfidence, generateContradictionQuestion,
  saveClarifications, loadClarifications
} = longInputContradictions;

// Destructure passes functions
const {
  extractKeyPhrase, createTopicFromOrphans, ensureGeneralTopic,
  saveOrphans, loadOrphans, runPass2, runPass3, runPass4,
  runFullPipeline, quickProcess, generateQuickSummary
} = longInputPasses;

// Paths - temp processing files go to .workflow/tmp/, cleaned up after completion
const TMP_DIR = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
const STATE_DIR = TMP_DIR; // Alias for backward compatibility during migration
const ACTIVE_DIGEST_FILE = path.join(TMP_DIR, 'active-digest.json');

// ============================================
// Core session/utility functions (stay here)
// ============================================

function loadConfig() {
  try {
    const config = getConfig();
    return config.longInputGate || config.transcriptDigestion || {};
  } catch (_err) {
    return {};
  }
}

function generateDigestId() {
  return generateHashId('digest', '', '');
}

function now() {
  return new Date().toISOString();
}

function loadActiveDigest() {
  const data = safeJsonParse(ACTIVE_DIGEST_FILE, null);
  if (!data || !data.session) {
    return { session: { status: 'inactive' } };
  }
  return data;
}

function saveActiveDigest(data) {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = ACTIVE_DIGEST_FILE + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, ACTIVE_DIGEST_FILE);
}

function createSession(transcript, options = {}) {
  const digestId = generateDigestId();
  const digestPath = path.join(PATHS.state, digestId);

  fs.mkdirSync(digestPath, { recursive: true });
  fs.writeFileSync(path.join(digestPath, 'transcript.md'), transcript);

  const topics = {
    topics: [],
    metadata: {
      total_topics: 0, active_topics: 0, clarified_topics: 0, generated_topics: 0,
      detected_at: null, last_updated: now(),
      transcript_word_count: countWords(transcript), detection_method: 'pass-1-extraction'
    }
  };
  fs.writeFileSync(path.join(digestPath, 'topics.json'), JSON.stringify(topics, null, 2));

  const statementMap = {
    statements: [],
    metadata: {
      total_statements: 0, meaningful_statements: 0, mapped_statements: 0,
      orphan_statements: 0, contradictions_detected: 0, contradictions_resolved: 0,
      coverage_percentage: 0
    }
  };
  fs.writeFileSync(path.join(digestPath, 'statement-map.json'), JSON.stringify(statementMap, null, 2));

  const clarifications = {
    questions: [], contradictions: [],
    metadata: {
      total_questions: 0, answered_questions: 0, pending_questions: 0,
      total_contradictions: 0, resolved_contradictions: 0,
      auto_resolved_count: 0, user_resolved_count: 0
    }
  };
  fs.writeFileSync(path.join(digestPath, 'clarifications.json'), JSON.stringify(clarifications, null, 2));

  const conversation = {
    session_id: digestId, started_at: now(), last_interaction: now(),
    interactions: [{
      id: `i-${Date.now().toString(36)}`, type: 'session_started', timestamp: now(),
      data: { word_count: countWords(transcript), content_type: options.contentType || 'unknown' }
    }],
    checkpoints: []
  };
  fs.writeFileSync(path.join(digestPath, 'conversation.json'), JSON.stringify(conversation, null, 2));

  const orphans = {
    orphans: [],
    coverage: { total_meaningful: 0, mapped: 0, orphans_remaining: 0, percentage: 0 }
  };
  fs.writeFileSync(path.join(digestPath, 'orphans.json'), JSON.stringify(orphans, null, 2));

  const activeDigest = {
    session: {
      id: digestId, started_at: now(), last_activity: now(),
      status: 'active', phase: 'ingestion', digest_path: digestPath
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
      source: options.source || 'paste', format: options.format || 'plain',
      language: options.language || null, word_count: countWords(transcript),
      chunked: false, chunk_count: 0
    },
    output: { stories_created: [], tasks_added_to_ready: [] }
  };

  saveActiveDigest(activeDigest);
  return { digestId, digestPath, activeDigest };
}

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function updatePhase(phase, status, data = {}) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.phases) { console.error('No active digest session'); return null; }
  activeDigest.phases[phase] = { ...activeDigest.phases[phase], status, ...data };
  if (status === 'in_progress' && !activeDigest.phases[phase].started_at) {
    activeDigest.phases[phase].started_at = now();
  }
  if (status === 'completed') { activeDigest.phases[phase].completed_at = now(); }
  activeDigest.session.last_activity = now();
  activeDigest.session.phase = phase;
  saveActiveDigest(activeDigest);
  return activeDigest;
}

function saveTopics(topics) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { throw new Error('No active digest session'); }
  const topicsPath = path.join(activeDigest.session.digest_path, 'topics.json');
  const topicsData = {
    topics: topics.topics || topics,
    metadata: {
      total_topics: (topics.topics || topics).length,
      active_topics: (topics.topics || topics).filter(t => t.status === 'active').length,
      clarified_topics: (topics.topics || topics).filter(t => t.clarification_complete).length,
      generated_topics: (topics.topics || topics).filter(t => t.stories_generated).length,
      detected_at: now(), last_updated: now(),
      transcript_word_count: activeDigest.input?.word_count ?? 0,
      detection_method: 'pass-1-extraction'
    }
  };
  fs.writeFileSync(topicsPath, JSON.stringify(topicsData, null, 2));
  updatePhase('topic_extraction', 'completed', { topics_found: topicsData.topics.length });
  return topicsData;
}

function loadTopics() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { return null; }
  const topicsPath = path.join(activeDigest.session.digest_path, 'topics.json');
  const data = safeJsonParse(topicsPath, null);
  if (!data) return null;
  return data;
}

function getStatus() {
  const activeDigest = loadActiveDigest();
  if (activeDigest.session.status === 'inactive') { return { active: false }; }
  return { active: true, id: activeDigest.session.id, phase: activeDigest.session.phase, phases: activeDigest.phases, input: activeDigest.input };
}

function shouldTriggerDigestion(text) {
  const config = loadConfig();
  const threshold = config.autoTriggerThreshold ?? 2000;
  const wordCount = countWords(text);
  if (wordCount < threshold) { return { trigger: false, reason: 'below_threshold', wordCount }; }
  const contentType = classifyContent(text);
  if (contentType.type === 'requirements' || contentType.type === 'transcript') { return { trigger: true, reason: 'auto', wordCount, contentType }; }
  if (contentType.type === 'code') { return { trigger: false, reason: 'code_detected', wordCount, contentType }; }
  return { trigger: 'ask', reason: 'ambiguous', wordCount, contentType };
}

function classifyContent(text) {
  const codePatterns = [/```[\s\S]*```/g, /function\s+\w+\s*\(/g, /const\s+\w+\s*=/g, /import\s+.*from/g, /class\s+\w+/g];
  let codeMatches = 0;
  for (const pattern of codePatterns) { const matches = text.match(pattern); if (matches) codeMatches += matches.length; }
  if (codeMatches > 10) { return { type: 'code', confidence: 0.8 }; }
  const reqPatterns = [/we need/gi, /should have/gi, /must support/gi, /add a feature/gi, /implement/gi, /the \w+ should/gi];
  let reqMatches = 0;
  for (const pattern of reqPatterns) { const matches = text.match(pattern); if (matches) reqMatches += matches.length; }
  if (reqMatches > 5) { return { type: 'requirements', confidence: 0.85 }; }
  const transcriptPatterns = [/^\d{2}:\d{2}/gm, /^speaker \d+:/gim, /^\[.*\]:/gm, /^[A-Z][a-z]+:/gm];
  let transcriptMatches = 0;
  for (const pattern of transcriptPatterns) { const matches = text.match(pattern); if (matches) transcriptMatches += matches.length; }
  if (transcriptMatches > 10) { return { type: 'transcript', confidence: 0.9 }; }
  return { type: 'unknown', confidence: 0.5 };
}

// ============================================
// Multi-language question support (E5-S2)
// ============================================

function getQuestionTemplates(languageCode) {
  if (QUESTION_TEMPLATES_BY_LANGUAGE[languageCode]) { return QUESTION_TEMPLATES_BY_LANGUAGE[languageCode]; }
  return QUESTION_TEMPLATES_BY_LANGUAGE.en;
}

function generateLocalizedQuestion(templateKey, detailKey, entity, language = 'en') {
  const isLanguageSupported = Object.hasOwn(QUESTION_TEMPLATES_BY_LANGUAGE, language);
  const effectiveLang = isLanguageSupported ? language : 'en';
  const templates = getQuestionTemplates(language);
  const template = templates[templateKey]?.[detailKey];
  if (!template) {
    const enTemplate = QUESTION_TEMPLATES[templateKey]?.[detailKey];
    if (enTemplate) {
      return { question: enTemplate.question.replace('{entity}', entity), examples: enTemplate.examples || null, priority: enTemplate.priority || 'P2', language: 'en', fallback: true };
    }
    return null;
  }
  return { question: template.question.replace('{entity}', entity), examples: template.examples || null, priority: template.priority || 'P2', language: effectiveLang, fallback: !isLanguageSupported };
}

function detectSessionLanguage() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { throw new Error('No active digest session'); }
  const digestDir = activeDigest.session.digest_path;
  const transcriptPath = path.join(digestDir, 'transcript.txt');
  if (!fs.existsSync(transcriptPath)) { return { detected: false, reason: 'No transcript file found' }; }
  const transcript = fs.readFileSync(transcriptPath, 'utf8');
  const langResult = detectLanguage(transcript);
  const multiResult = detectMultipleLanguages(transcript, { segmentSize: 500 });
  activeDigest.session.detected_language = langResult.language;
  activeDigest.session.language_confidence = langResult.confidence;
  activeDigest.session.is_multilingual = multiResult.isMultilingual;
  activeDigest.session.language_distribution = multiResult.distribution || {};
  saveActiveDigest(activeDigest);
  return { detected: true, language: langResult.language, languageName: LANGUAGE_INFO[langResult.language]?.name || 'Unknown', confidence: langResult.confidence, isMultilingual: multiResult.isMultilingual, distribution: multiResult.distribution };
}

function getTopicLanguage(topicId) {
  const topics = loadTopics();
  const stmtMap = loadStatementMap();
  const activeDigest = loadActiveDigest();
  if (!topics || !stmtMap) { return activeDigest.session?.detected_language || 'en'; }
  const topic = topics.topics.find(t => t.id === topicId);
  if (!topic) { return activeDigest.session?.detected_language || 'en'; }
  if (topic.language) { return topic.language; }
  const topicStatements = stmtMap.statements.filter(s => s.topic_id === topicId && s.meaningful);
  if (topicStatements.length === 0) { return activeDigest.session?.detected_language || 'en'; }
  const combinedText = topicStatements.map(s => s.text).join('\n');
  const result = detectLanguage(combinedText);
  return result.language;
}

function setLanguagePreference(languageCode) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { throw new Error('No active digest session'); }
  const info = getLanguageInfo(languageCode);
  if (!info.supported) { throw new Error(`Unsupported language code: ${languageCode}`); }
  activeDigest.session.preferred_language = languageCode;
  saveActiveDigest(activeDigest);
  return { set: true, language: languageCode, languageName: info.name };
}

function getEffectiveLanguage(topicId = null) {
  const activeDigest = loadActiveDigest();
  if (activeDigest.session?.preferred_language) { return activeDigest.session.preferred_language; }
  if (topicId) { const topicLang = getTopicLanguage(topicId); if (topicLang && QUESTION_TEMPLATES_BY_LANGUAGE[topicLang]) { return topicLang; } }
  if (activeDigest.session?.detected_language && QUESTION_TEMPLATES_BY_LANGUAGE[activeDigest.session.detected_language]) { return activeDigest.session.detected_language; }
  return 'en';
}

function getSessionLanguageInfo() {
  const activeDigest = loadActiveDigest();
  return {
    detected: activeDigest.session?.detected_language || null, detectedName: LANGUAGE_INFO[activeDigest.session?.detected_language]?.name || null,
    confidence: activeDigest.session?.language_confidence || null, preferred: activeDigest.session?.preferred_language || null,
    preferredName: LANGUAGE_INFO[activeDigest.session?.preferred_language]?.name || null, isMultilingual: activeDigest.session?.is_multilingual || false,
    distribution: activeDigest.session?.language_distribution || {}, effective: getEffectiveLanguage()
  };
}

// ============================================
// Question Generation (E2-S1)
// ============================================

function isDetailProvided(detail, topicId, statements) {
  const topicStatements = statements.filter(s => s.topic_id === topicId && s.meaningful);
  const pattern = DETAIL_PATTERNS[detail];
  if (!pattern) return false;
  return topicStatements.some(s => pattern.test(s.text));
}

function extractEntityFromStatement(statement, pattern) {
  const match = statement.text.match(pattern.pattern);
  if (match && pattern.entity !== null) { return match[pattern.entity]; }
  return pattern.type;
}

function analyzeCompleteness(statement, topicId, allStatements) {
  const gaps = [];
  const text = statement.text.toLowerCase();
  for (const entityPattern of ENTITY_PATTERNS) {
    if (entityPattern.pattern.test(text)) {
      const entity = extractEntityFromStatement(statement, entityPattern);
      for (const detail of entityPattern.missing) {
        if (!isDetailProvided(detail, topicId, allStatements)) {
          gaps.push({ type: entityPattern.type, entity, detail, statementId: statement.id });
        }
      }
    }
  }
  return gaps;
}

function detectVagueness(statement) {
  for (const vague of VAGUE_PATTERNS) {
    if (vague.pattern.test(statement.text)) { return { isVague: true, key: vague.key, question: vague.question }; }
  }
  return { isVague: false };
}

let questionCounter = 0;
function generateQuestionId() { questionCounter++; return `q-${String(questionCounter).padStart(3, '0')}`; }

function generateQuestionsForTopic(topic, statements, allStatements) {
  const questions = [];
  const topicStatements = statements.filter(s => s.topic_id === topic.id && s.meaningful && !s.superseded);
  for (const statement of topicStatements) {
    const gaps = analyzeCompleteness(statement, topic.id, allStatements);
    for (const gap of gaps) {
      const template = QUESTION_TEMPLATES[gap.type]?.[gap.detail];
      if (template) {
        questions.push({ id: generateQuestionId(), type: 'completeness', topic_id: topic.id, topic_title: topic.title, statement_id: statement.id, question: template.question.replace('{entity}', gap.entity), detail: gap.detail, examples: template.examples || null, priority: template.priority || 'P2', status: 'pending', answer: null, created_at: now() });
      }
    }
    const vagueness = detectVagueness(statement);
    if (vagueness.isVague) {
      questions.push({ id: generateQuestionId(), type: 'specificity', topic_id: topic.id, topic_title: topic.title, statement_id: statement.id, question: vagueness.question, original_statement: statement.text, priority: 'P2', status: 'pending', answer: null, created_at: now() });
    }
  }
  return questions;
}

function generateAllQuestions() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { throw new Error('No active digest session'); }
  const topics = loadTopics();
  const stmtMap = loadStatementMap();
  let clarifications = loadClarifications();
  if (!topics || !stmtMap) { throw new Error('Topics and statement map required - run passes 1-2 first'); }
  if (!clarifications) { clarifications = { questions: [], contradictions: [], by_topic: {}, metadata: { total_questions: 0, pending_questions: 0, answered_questions: 0 } }; }
  questionCounter = clarifications.questions?.length || 0;
  const allQuestions = [];
  const byTopic = {};
  for (const topic of topics.topics) {
    const topicQuestions = generateQuestionsForTopic(topic, stmtMap.statements, stmtMap.statements);
    if (topicQuestions.length > 0) { allQuestions.push(...topicQuestions); byTopic[topic.id] = topicQuestions.map(q => q.id); }
  }
  clarifications.questions = [...(clarifications.questions || []), ...allQuestions];
  clarifications.by_topic = { ...(clarifications.by_topic || {}), ...byTopic };
  const byType = { completeness: 0, specificity: 0, ambiguity: 0 };
  const byPriority = { P1: 0, P2: 0, P3: 0 };
  for (const q of clarifications.questions) { byType[q.type] = (byType[q.type] || 0) + 1; byPriority[q.priority] = (byPriority[q.priority] || 0) + 1; }
  clarifications.metadata = { ...clarifications.metadata, total_questions: clarifications.questions.length, pending_questions: clarifications.questions.filter(q => q.status === 'pending').length, answered_questions: clarifications.questions.filter(q => q.status === 'answered').length, by_type: byType, by_priority: byPriority };
  saveClarifications(clarifications);
  updatePhase('clarification', 'in_progress', { questions_total: allQuestions.length, questions_answered: 0 });
  return { questions: allQuestions, by_topic: byTopic, stats: { total: allQuestions.length, by_type: byType, by_priority: byPriority, topics_with_questions: Object.keys(byTopic).length } };
}

// ============================================
// Conversation Loop (E2-S2)
// ============================================

function extractKeywordsFromQuestion(question) {
  const stopWords = ['what', 'which', 'how', 'should', 'the', 'a', 'an', 'for', 'to', 'of', 'in', 'be', 'are', 'is'];
  const words = question.text || question.question;
  return words.toLowerCase().replace(/[?.,!]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
}

function parseAnswers(userResponse, questions) {
  const answers = [];
  const text = userResponse.trim();
  const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s*(.+?)(?=\n\s*\d+[.)]|\n*$)/gs;
  const numberedMatches = [...text.matchAll(numberedPattern)];
  if (numberedMatches.length > 0) {
    for (const match of numberedMatches) { const num = parseInt(match[1], 10); const answer = match[2].trim(); if (num >= 1 && num <= questions.length) { answers.push({ question_id: questions[num - 1].id, answer, confidence: 0.95, match_method: 'numbered' }); } }
    return answers;
  }
  for (const question of questions) {
    const keywords = extractKeywordsFromQuestion(question);
    for (const keyword of keywords) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [new RegExp(`(?:for\\s+(?:the\\s+)?)?${escapedKeyword}[,:]\\s*(.+?)(?:\\.|$|\\n)`, 'i'), new RegExp(`${escapedKeyword}\\s+(?:should\\s+(?:be|have|show)\\s+)?(.+?)(?:\\.|$|\\n)`, 'i')];
      for (const pattern of patterns) { const match = text.match(pattern); if (match && match[1] && match[1].trim().length > 2) { const existing = answers.find(a => a.question_id === question.id); if (!existing) { answers.push({ question_id: question.id, answer: match[1].trim(), confidence: 0.85, match_method: 'keyword', matched_keyword: keyword }); } break; } }
    }
  }
  if (questions.length === 1 && answers.length === 0 && text.length > 2) { answers.push({ question_id: questions[0].id, answer: text, confidence: 0.8, match_method: 'single_question' }); }
  if (answers.length === 0 && questions.length > 1) {
    const segments = text.split(/[.]\s+/).filter(s => s.trim().length > 2);
    if (segments.length === questions.length) { for (let i = 0; i < segments.length; i++) { answers.push({ question_id: questions[i].id, answer: segments[i].trim(), confidence: 0.7, match_method: 'sequential' }); } }
  }
  return answers;
}

function captureAnswer(questionId, answer, source = 'text') {
  const clarifications = loadClarifications();
  if (!clarifications) { throw new Error('No clarifications found'); }
  const question = clarifications.questions.find(q => q.id === questionId);
  if (!question) { throw new Error(`Question ${questionId} not found`); }
  question.status = 'answered'; question.answer = answer; question.answered_at = now(); question.answer_source = source;
  clarifications.metadata.answered_questions = (clarifications.metadata.answered_questions || 0) + 1;
  clarifications.metadata.pending_questions = clarifications.questions.filter(q => q.status === 'pending').length;
  saveClarifications(clarifications);
  return question;
}

function createDerivedStatement(question, answer) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) { throw new Error('No active digest session'); }
  const stmtMap = loadStatementMap();
  if (!stmtMap) { throw new Error('No statement map found'); }
  const maxId = stmtMap.statements.map(s => parseInt(s.id.replace('s-', '').replace('derived-', ''), 10) || 0).reduce((max, id) => Math.max(max, id), 0);
  const newId = `s-derived-${String(maxId + 1).padStart(3, '0')}`;
  let text;
  if (question.detail) { const entity = question.question.match(/the (\w+) (table|form|button|list|modal)/i)?.[1] || ''; text = `The ${entity} ${question.detail} should be: ${answer}`; } else { text = answer; }
  const derivedStatement = { id: newId, text, topic_id: question.topic_id, source: 'clarification', clarification_id: question.id, meaningful: true, confidence: 1.0, created_at: now() };
  stmtMap.statements.push(derivedStatement); stmtMap.metadata.total_statements++; stmtMap.metadata.meaningful_statements++; stmtMap.metadata.mapped_statements++;
  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));
  return derivedStatement;
}

function checkFollowups(answer, question) {
  const followups = [];
  for (const trigger of FOLLOWUP_TRIGGERS) {
    if (trigger.pattern.test(answer)) { const entity = question.detail || 'item'; followups.push({ type: trigger.type, triggered_by: trigger.pattern.source, question: trigger.question.replace('{item}', entity), parent_question_id: question.id, topic_id: question.topic_id, priority: 'P2' }); }
  }
  return followups;
}

function addFollowupQuestions(followups) {
  if (followups.length === 0) return [];
  const clarifications = loadClarifications();
  const addedQuestions = [];
  for (const followup of followups) {
    const exists = clarifications.questions.some(q => q.topic_id === followup.topic_id && q.question.toLowerCase().includes(followup.question.toLowerCase().slice(0, 30)));
    if (!exists) { const newQuestion = { id: generateQuestionId(), type: 'followup', topic_id: followup.topic_id, parent_question_id: followup.parent_question_id, question: followup.question, priority: followup.priority, status: 'pending', answer: null, created_at: now() }; clarifications.questions.push(newQuestion); addedQuestions.push(newQuestion); }
  }
  clarifications.metadata.total_questions = clarifications.questions.length;
  clarifications.metadata.pending_questions = clarifications.questions.filter(q => q.status === 'pending').length;
  saveClarifications(clarifications);
  return addedQuestions;
}

function checkCompletion() {
  const clarifications = loadClarifications();
  if (!clarifications) { return { complete: false, error: 'No clarifications found' }; }
  const pendingQuestions = clarifications.questions.filter(q => q.status === 'pending');
  const pendingContradictions = clarifications.contradictions.filter(c => c.status === 'pending');
  const complete = pendingQuestions.length === 0 && pendingContradictions.length === 0;
  const result = { complete, pending_questions: pendingQuestions.length, pending_contradictions: pendingContradictions.length, answered_questions: clarifications.questions.filter(q => q.status === 'answered').length, resolved_contradictions: clarifications.contradictions.filter(c => c.status === 'resolved').length, total_questions: clarifications.questions.length, total_contradictions: clarifications.contradictions.length };
  if (complete) { updatePhase('clarification', 'completed', { questions_total: result.total_questions, questions_answered: result.answered_questions }); }
  return result;
}

function getQuestionsForPresentation(topicId = null, limit = 5) {
  const clarifications = loadClarifications();
  if (!clarifications) return [];
  let pendingQuestions = clarifications.questions.filter(q => q.status === 'pending');
  if (topicId) { pendingQuestions = pendingQuestions.filter(q => q.topic_id === topicId); }
  const priorityOrder = { P1: 0, P2: 1, P3: 2 };
  pendingQuestions.sort((a, b) => { const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2); if (pDiff !== 0) return pDiff; return new Date(a.created_at) - new Date(b.created_at); });
  return pendingQuestions.slice(0, limit);
}

function formatQuestionsForUser(questions) {
  if (questions.length === 0) return null;
  const byTopic = {};
  for (const q of questions) { const topicKey = q.topic_title || q.topic_id || 'General'; if (!byTopic[topicKey]) { byTopic[topicKey] = []; } byTopic[topicKey].push(q); }
  let output = '';
  for (const [topic, qs] of Object.entries(byTopic)) {
    output += `## Topic: ${topic} (${qs.length} question${qs.length > 1 ? 's' : ''})\n\n`;
    for (let i = 0; i < qs.length; i++) { const q = qs[i]; output += `${i + 1}. **[${q.priority}]** ${q.question}\n`; if (q.examples && q.examples.length > 0) { output += `   _Examples: "${q.examples.join('" or "')}"_\n`; } output += '\n'; }
  }
  output += '---\n\nYou can answer all at once or one at a time. Just reply naturally!';
  return output;
}

function processConversationResponse(userResponse, options = {}) {
  const clarifications = loadClarifications();
  if (!clarifications) { return { error: 'No active clarification session' }; }
  const pendingQuestions = getQuestionsForPresentation(null, 10);
  if (pendingQuestions.length === 0) { return { complete: true, message: 'All questions have been answered!' }; }
  let processedInput = userResponse;
  let voiceProcessing = null;
  const voiceResult = processVoiceAnswer(userResponse, options.forceVoice);
  if (voiceResult.isVoice) { processedInput = voiceResult.normalized; voiceProcessing = voiceResult.processing; }
  const parsedAnswers = parseAnswers(processedInput, pendingQuestions);
  const results = { captured: [], derived_statements: [], followups_added: [], remaining_questions: 0, complete: false, voice: voiceProcessing ? { detected: true, original: userResponse, normalized: processedInput, processing: voiceProcessing } : null };
  const answerSource = voiceProcessing ? 'voice' : 'conversation';
  recordInteraction('answer_received', { raw_input: userResponse, source: answerSource, voice_processed: !!voiceProcessing, parsed_count: parsedAnswers.length });
  for (const parsed of parsedAnswers) {
    const question = pendingQuestions.find(q => q.id === parsed.question_id);
    if (!question) continue;
    captureAnswer(parsed.question_id, parsed.answer, answerSource);
    results.captured.push({ question_id: parsed.question_id, question: question.question, answer: parsed.answer, confidence: parsed.confidence });
    const derivedStmt = createDerivedStatement(question, parsed.answer);
    results.derived_statements.push(derivedStmt);
    const followups = checkFollowups(parsed.answer, question);
    if (followups.length > 0) { const added = addFollowupQuestions(followups); results.followups_added.push(...added); }
  }
  const completion = checkCompletion();
  results.complete = completion.complete;
  results.remaining_questions = completion.pending_questions + completion.pending_contradictions;
  if (!completion.complete) { results.next_questions = getQuestionsForPresentation(null, 5); results.formatted_questions = formatQuestionsForUser(results.next_questions); }
  return results;
}

function resolveContradictionWithChoice(contradictionId, choice) {
  const clarifications = loadClarifications();
  if (!clarifications) { throw new Error('No clarifications found'); }
  const contradiction = clarifications.contradictions.find(c => c.id === contradictionId);
  if (!contradiction) { throw new Error(`Contradiction ${contradictionId} not found`); }
  const stmtMap = loadStatementMap();
  if (!stmtMap) { throw new Error('No statement map found'); }
  if (choice === 'keep_both') { contradiction.status = 'resolved'; contradiction.resolution = 'keep_both'; contradiction.resolved_at = now(); } else {
    const winnerStmtId = contradiction.options?.find(o => o.id === choice)?.statement_id;
    const loserStmtId = contradiction.statements.find(id => id !== winnerStmtId);
    if (winnerStmtId && loserStmtId) { const winner = stmtMap.statements.find(s => s.id === winnerStmtId); const loser = stmtMap.statements.find(s => s.id === loserStmtId); if (winner && loser) { loser.superseded = true; loser.superseded_by = winnerStmtId; loser.superseded_reason = 'user_choice'; winner.supersedes = loserStmtId; } }
    contradiction.status = 'resolved'; contradiction.resolution = 'user_choice'; contradiction.winner = winnerStmtId; contradiction.resolved_at = now();
  }
  clarifications.metadata.resolved_contradictions = (clarifications.metadata.resolved_contradictions || 0) + 1;
  clarifications.metadata.user_resolved_count = (clarifications.metadata.user_resolved_count || 0) + 1;
  const activeDigest = loadActiveDigest();
  const mapPath = path.join(activeDigest.session.digest_path, 'statement-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(stmtMap, null, 2));
  saveClarifications(clarifications);
  return contradiction;
}

// ============================================
// State Persistence (E2-S4)
// ============================================

function generateInteractionId() { return `i-${Date.now().toString(36)}`; }
function generateCheckpointId() { return `cp-${Date.now().toString(36)}`; }

function loadConversation() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) { return null; }
  const convPath = path.join(activeDigest.session.digest_path, 'conversation.json');
  return safeJsonParse(convPath, null);
}

function saveConversation(conversation) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) { throw new Error('No active digest session'); }
  const convPath = path.join(activeDigest.session.digest_path, 'conversation.json');
  fs.writeFileSync(convPath, JSON.stringify(conversation, null, 2));
  return conversation;
}

function initializeConversation(sessionId) {
  return saveConversation({ session_id: sessionId, started_at: now(), last_interaction: now(), interactions: [], checkpoints: [] });
}

function recordInteraction(type, data = {}) {
  let conversation = loadConversation();
  if (!conversation) { const activeDigest = loadActiveDigest(); if (activeDigest.session?.id) { conversation = initializeConversation(activeDigest.session.id); } else { return null; } }
  const interaction = { id: generateInteractionId(), type, timestamp: now(), data };
  conversation.interactions.push(interaction); conversation.last_interaction = now();
  saveConversation(conversation);
  return interaction;
}

function createCheckpoint(reason = 'manual') {
  const conversation = loadConversation();
  if (!conversation) { return null; }
  const clarifications = loadClarifications();
  const topics = loadTopics();
  const activeDigest = loadActiveDigest();
  const checkpoint = {
    id: generateCheckpointId(), timestamp: now(), reason,
    phase: activeDigest.phases ? Object.keys(activeDigest.phases).find(p => activeDigest.phases[p]?.status === 'in_progress') || 'unknown' : 'unknown',
    questions: { total: clarifications?.questions?.length || 0, answered: clarifications?.questions?.filter(q => q.status === 'answered').length || 0, pending: clarifications?.questions?.filter(q => q.status === 'pending').length || 0 },
    contradictions: { total: clarifications?.contradictions?.length || 0, resolved: clarifications?.contradictions?.filter(c => c.status === 'resolved').length || 0 },
    topics: { total: topics?.topics?.length || 0, clarified: topics?.topics?.filter(t => t.clarification_complete).length || 0 },
    awaiting_response: false
  };
  const lastInteraction = conversation.interactions.slice(-1)[0];
  if (lastInteraction?.type === 'questions_presented') { checkpoint.awaiting_response = true; checkpoint.last_questions_presented = lastInteraction.data.question_ids; }
  conversation.checkpoints.push(checkpoint);
  saveConversation(conversation);
  return checkpoint;
}

function detectInterruptedSession() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) { return { interrupted: false }; }
  if (activeDigest.session?.status === 'completed') { return { interrupted: false }; }
  const conversation = loadConversation();
  if (!conversation) { return { interrupted: false }; }
  const clarifications = loadClarifications();
  if (!clarifications) { return { interrupted: false }; }
  const pendingQuestions = clarifications.questions?.filter(q => q.status === 'pending') || [];
  if (pendingQuestions.length === 0) { return { interrupted: false }; }
  const lastInteraction = new Date(conversation.last_interaction);
  const timeSinceMs = Date.now() - lastInteraction.getTime();
  const timeSinceMinutes = Math.floor(timeSinceMs / 60000);
  const lastCheckpoint = conversation.checkpoints.slice(-1)[0];
  const lastInteractionData = conversation.interactions.slice(-1)[0];
  const wasAwaitingResponse = lastInteractionData?.type === 'questions_presented';
  return { interrupted: true, session_id: activeDigest.session.id, digest_path: activeDigest.session.digest_path, reason: wasAwaitingResponse ? 'awaiting_response' : 'incomplete', last_interaction: conversation.last_interaction, time_since_minutes: timeSinceMinutes, time_since_formatted: formatTimeSince(timeSinceMs), checkpoint: lastCheckpoint, pending_questions: pendingQuestions.length, answered_questions: clarifications.questions?.filter(q => q.status === 'answered').length || 0, total_questions: clarifications.questions?.length || 0 };
}

function formatTimeSince(ms) {
  const minutes = Math.floor(ms / 60000); const hours = Math.floor(minutes / 60); const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

function generateRecoverySummary() {
  const interrupted = detectInterruptedSession();
  if (!interrupted.interrupted) { return null; }
  const clarifications = loadClarifications();
  const topics = loadTopics();
  const conversation = loadConversation();
  const recentAnswers = clarifications.questions.filter(q => q.status === 'answered').slice(-5).map(q => ({ topic: q.topic_title, question: q.question, answer: q.answer, answered_at: q.answered_at }));
  const pendingByTopic = {};
  for (const q of clarifications.questions.filter(q => q.status === 'pending')) { const topicKey = q.topic_title || q.topic_id; if (!pendingByTopic[topicKey]) { pendingByTopic[topicKey] = []; } pendingByTopic[topicKey].push(q); }
  const topicsStatus = (topics.topics || []).map(t => ({ id: t.id, title: t.title, pending_questions: clarifications.questions.filter(q => q.topic_id === t.id && q.status === 'pending').length, answered_questions: clarifications.questions.filter(q => q.topic_id === t.id && q.status === 'answered').length }));
  return { session_id: interrupted.session_id, started_at: conversation.started_at, last_active: interrupted.last_interaction, time_since: interrupted.time_since_formatted, progress: { answered: interrupted.answered_questions, pending: interrupted.pending_questions, total: interrupted.total_questions, percentage: Math.round((interrupted.answered_questions / interrupted.total_questions) * 100) }, recent_answers: recentAnswers, pending_by_topic: pendingByTopic, topics_status: topicsStatus, checkpoint: interrupted.checkpoint };
}

function resumeSession() {
  const interrupted = detectInterruptedSession();
  if (!interrupted.interrupted) { return { error: 'No interrupted session to resume' }; }
  recordInteraction('session_resumed', { resumed_from: interrupted.checkpoint?.id, time_since: interrupted.time_since_formatted });
  createCheckpoint('resume');
  const nextQuestions = getQuestionsForPresentation(null, 5);
  return { resumed: true, session_id: interrupted.session_id, summary: generateRecoverySummary(), next_questions: nextQuestions, formatted_questions: formatQuestionsForUser(nextQuestions) };
}

function markQuestionsPresented(questionIds, topic = null) { recordInteraction('questions_presented', { question_ids: questionIds, topic }); createCheckpoint('questions_presented'); }

function getSessionHistory() {
  const conversation = loadConversation();
  if (!conversation) { return null; }
  const clarifications = loadClarifications();
  const summary = { session_id: conversation.session_id, started_at: conversation.started_at, last_interaction: conversation.last_interaction, duration_ms: new Date(conversation.last_interaction) - new Date(conversation.started_at), interaction_count: conversation.interactions.length, checkpoint_count: conversation.checkpoints.length, answers_given: clarifications?.questions?.filter(q => q.status === 'answered').length || 0, interactions_by_type: {} };
  for (const interaction of conversation.interactions) { summary.interactions_by_type[interaction.type] = (summary.interactions_by_type[interaction.type] || 0) + 1; }
  return summary;
}

function exportSession(format = 'json') {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session?.digest_path) { return { error: 'No active session' }; }
  const topics = loadTopics(); const statements = loadStatementMap(); const clarifications = loadClarifications(); const conversation = loadConversation();
  const exportData = { exported_at: now(), session: activeDigest.session, phases: activeDigest.phases, topics, statements, clarifications, conversation };
  if (format === 'json') { return exportData; }
  if (format === 'md') { return formatExportAsMarkdown(exportData); }
  return exportData;
}

function formatExportAsMarkdown(data) {
  let md = `# Transcript Digest Export\n\n`;
  md += `**Session ID:** ${data.session.id}\n`; md += `**Exported:** ${data.exported_at}\n\n`;
  md += `## Progress\n\n`;
  const answered = data.clarifications?.questions?.filter(q => q.status === 'answered').length || 0;
  const total = data.clarifications?.questions?.length || 0;
  md += `- Questions answered: ${answered}/${total}\n`; md += `- Topics: ${data.topics?.topics?.length || 0}\n`; md += `- Statements: ${data.statements?.statements?.length || 0}\n\n`;
  md += `## Topics\n\n`;
  for (const topic of (data.topics?.topics || [])) { md += `### ${topic.title}\n`; md += `- Entities: ${(topic.entities || []).join(', ')}\n`; md += `- Keywords: ${(topic.keywords || []).join(', ')}\n\n`; }
  md += `## Answered Questions\n\n`;
  for (const q of (data.clarifications?.questions || []).filter(q => q.status === 'answered')) { md += `### ${q.topic_title || 'General'}\n`; md += `**Q:** ${q.question}\n`; md += `**A:** ${q.answer}\n\n`; }
  md += `## Pending Questions\n\n`;
  for (const q of (data.clarifications?.questions || []).filter(q => q.status === 'pending')) { md += `- [${q.priority}] ${q.question}\n`; }
  return md;
}

function reviewAnswers() {
  const clarifications = loadClarifications();
  if (!clarifications) { return { error: 'No clarifications found' }; }
  const answered = clarifications.questions.filter(q => q.status === 'answered');
  const byTopic = {};
  for (const q of answered) { const topicKey = q.topic_title || q.topic_id || 'General'; if (!byTopic[topicKey]) { byTopic[topicKey] = []; } byTopic[topicKey].push({ id: q.id, question: q.question, answer: q.answer, answered_at: q.answered_at, source: q.answer_source }); }
  return { total_answered: answered.length, by_topic: byTopic };
}

// ============================================
// Complexity Analysis (stays here — orchestrates sub-modules)
// ============================================

function analyzeComplexity() {
  const topics = loadTopics();
  const statementMap = loadStatementMap();
  const clarifications = loadClarifications();
  if (!topics || !topics.topics) { return { error: 'No topics found. Run Pass 1 first.' }; }
  const statements = statementMap?.statements || [];
  const digest = { topics: topics.topics, statements, clarifications: clarifications || { questions: [], contradictions: [] } };
  const overallScore = calculateComplexityScore(digest);
  const level = getComplexityLevel(overallScore);
  const topicAnalysis = topics.topics.filter(t => t.status === 'active').map(t => analyzeTopicComplexity(t, statements, clarifications));
  const recommendation = recommendOutputStructure(overallScore, topicAnalysis);
  const entitySummary = extractEntities(statements);
  return {
    overall: { score: overallScore, level: level.level, description: level.description, confidence: 0.85 },
    factors: { topic_count: topics.topics.filter(t => t.status === 'active').length, statement_count: statements.filter(s => s.meaningful !== false).length, question_count: clarifications?.questions?.length || 0, contradiction_count: clarifications?.contradictions?.length || 0, entity_types: countEntityTypes(statements), ui_components: entitySummary.ui_components.length, data_entities: entitySummary.data_entities.length, interactions: entitySummary.interactions.length },
    topic_analysis: topicAnalysis, recommendation, entity_summary: entitySummary
  };
}

// ============================================
// Module initialization (wire dependencies)
// ============================================

longInputAssociation.init({
  loadActiveDigest,
  updatePhase
});

longInputContradictions.init({
  loadActiveDigest,
  calculateAssociationConfidence
});

longInputPasses.init({
  loadActiveDigest, updatePhase, now, countWords,
  loadTopics, saveTopics,
  splitIntoStatements, isMeaningfulStatement, associateStatements,
  saveStatementMap, loadStatementMap,
  detectContradictions, resolveOrphan,
  calculateResolutionConfidence, generateContradictionQuestion,
  isAdditive, detectCorrectionPhrase,
  saveClarifications, loadClarifications,
  createSession
});

// Initialize story module with core functions
transcriptStories.init({
  loadActiveDigest, saveActiveDigest, loadTopics, saveTopics,
  loadStatementMap, loadClarifications,
  isRequirement, isVagueStatement, analyzeComplexity,
  REQUIREMENT_PATTERNS, VAGUE_PATTERNS, ENTITY_PATTERNS
});

// Initialize chunking module with core functions
transcriptChunking.init({ loadActiveDigest, saveActiveDigest, countWords, now });

// Initialize detection module with functions from main module
longInputDetection.init({ countWords, classifyContent });

// Export for use as module
module.exports = {
  // Utilities
  now,
  // Core session management
  createSession, loadActiveDigest, saveActiveDigest, updatePhase,
  saveTopics, loadTopics, getStatus, shouldTriggerDigestion, classifyContent, countWords,
  // Pass 2: Statement Association (from flow-long-input-association.js)
  isMeaningfulStatement, splitIntoStatements, associateStatements,
  detectContradictions, saveStatementMap, loadStatementMap, runPass2,
  // Pass 3: Orphan Check (from flow-long-input-passes.js)
  resolveOrphan, createTopicFromOrphans, ensureGeneralTopic,
  saveOrphans, loadOrphans, runPass3,
  // Pass 4: Contradiction Resolution (from flow-long-input-contradictions.js)
  detectCorrectionPhrase, isAdditive, calculateResolutionConfidence,
  generateContradictionQuestion, saveClarifications, loadClarifications, runPass4,
  // Question Generation (E2-S1)
  analyzeCompleteness, detectVagueness, generateQuestionsForTopic, generateAllQuestions,
  // Conversation Loop (E2-S2)
  parseAnswers, captureAnswer, createDerivedStatement, checkFollowups,
  addFollowupQuestions, checkCompletion, getQuestionsForPresentation,
  formatQuestionsForUser, processConversationResponse, resolveContradictionWithChoice,
  // Voice Answer Integration (E2-S3)
  isVoiceInput, removeFillers, applySelfCorrections, normalizeNumbers,
  detectUncertainty, detectYesNo, addPunctuation, normalizeVoiceInput,
  calculateVoiceConfidence, processVoiceAnswer,
  // State Persistence (E2-S4)
  loadConversation, saveConversation, initializeConversation, recordInteraction,
  createCheckpoint, detectInterruptedSession, generateRecoverySummary, resumeSession,
  markQuestionsPresented, getSessionHistory, exportSession, reviewAnswers,
  // Complexity Detection (E3-S1)
  countEntityTypes, extractEntities, getComplexityLevel, calculateComplexityScore,
  isRequirement, isVagueStatement, hasUIComponent, hasDataModel, hasUserInteraction,
  analyzeTopicComplexity, groupRelatedTopics, generateEpicStructure, recommendOutputStructure,
  analyzeComplexity,
  // Story Generation (E3-S2) - re-exported from flow-long-input-stories.js
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
  // Presentation Flow (E3-S3)
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
  // Edit and Change Handling (E3-S4)
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
  // ready.json Integration (E3-S5)
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
  measureInputMetrics, estimateTokens, isVTTFormat, isSRTFormat,
  detectMeetingFormat, detectInputFormat, analyzeInput, evaluateTrigger,
  generateRecommendationMessage, detectLargeInput,
  // Content Type Classification (E4-S2)
  scoreContentType, normalizeScore, classifyContentTypes,
  getDetailedClassification, shouldExcludeContent,
  // VTT/SRT Format Parsing (E4-S3)
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
  // Zoom/Teams Parsing (E4-S4)
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
  // Language Detection (E5-S1)
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
  getQuestionTemplates, generateLocalizedQuestion, detectSessionLanguage,
  getTopicLanguage, setLanguagePreference, getEffectiveLanguage, getSessionLanguageInfo,
  // Durable Session Persistence (E5-S3)
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
  // Large Transcript Chunking (E5-S4)
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
  quickProcess, generateQuickSummary,
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
