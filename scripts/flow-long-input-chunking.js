#!/usr/bin/env node

/**
 * Wogi Flow - Transcript Chunking Module
 *
 * Extracted from flow-transcript-digest.js for maintainability.
 * Handles durable session persistence (E5-S3) and large transcript chunking (E5-S4).
 *
 * Dependencies: Requires core functions from flow-transcript-digest.js
 */

const fs = require('fs');
const path = require('path');

// Core functions are injected via init() to avoid circular dependencies
let digestCore = null;

/**
 * Initialize with core digest functions
 * @param {object} core - Core functions from flow-transcript-digest.js
 */
function init(core) {
  digestCore = core;
}

// Helper to ensure init was called
function requireInit() {
  if (!digestCore) {
    throw new Error('flow-transcript-chunking not initialized. Call init() first.');
  }
}

// Proxy functions to core module
function loadActiveDigest() { requireInit(); return digestCore.loadActiveDigest(); }
function saveActiveDigest(d) { requireInit(); return digestCore.saveActiveDigest(d); }
function countWords(t) { requireInit(); return digestCore.countWords(t); }
function now() { requireInit(); return digestCore.now(); }
function measureInputMetrics(t) { requireInit(); return digestCore.measureInputMetrics(t); }

// Paths - temp processing files, cleaned up after completion
const TMP_DIR = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
const _STATE_DIR = TMP_DIR; // Alias for backward compatibility (kept for reference)

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
  } catch (_err) {
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
    } catch (_err) { /* ignore parse errors */ }
  }

  // Check statements
  const stmtPath = path.join(digestPath, 'statement-map.json');
  if (fs.existsSync(stmtPath)) {
    try {
      const stmtMap = JSON.parse(fs.readFileSync(stmtPath, 'utf8'));
      progress.statements_count = stmtMap.statements?.length || 0;
      progress.passes_completed.push('statements');
      progress.phase = 'statements';
    } catch (_err) { /* ignore parse errors */ }
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
    } catch (_err) { /* ignore parse errors */ }
  }

  // Check stories
  const storiesPath = path.join(digestPath, 'stories.json');
  if (fs.existsSync(storiesPath)) {
    try {
      const stories = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
      progress.stories_generated = stories.stories?.length || 0;
      progress.stories_approved = stories.stories?.filter(s => s.approval_status === 'approved')?.length || 0;
      progress.phase = 'stories';
    } catch (_err) { /* ignore parse errors */ }
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

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Initialization
  init,
  
  // Durable Session Persistence (E5-S3)
  DURABLE_DIGEST_PATH,
  DURABLE_DIGEST_VERSION,
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
