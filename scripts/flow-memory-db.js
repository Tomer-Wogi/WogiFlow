#!/usr/bin/env node

/**
 * Wogi Flow - Memory Database Module
 *
 * Shared database operations for memory storage.
 * Used by both MCP server and CLI tools.
 *
 * Features:
 * - SQLite database with sql.js
 * - Embeddings via @xenova/transformers
 * - Facts, proposals, and PRD storage
 * - Semantic similarity search
 *
 * Part of v1.8.0 - Consolidated memory storage
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = process.env.WOGI_PROJECT_ROOT || process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const MEMORY_DIR = path.join(WORKFLOW_DIR, 'memory');
const DB_PATH = path.join(MEMORY_DIR, 'local.db');

// ============================================================
// Database Singleton
// ============================================================

let SQL = null;
let db = null;
let embedder = null;
let initPromise = null;

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Initialize database (singleton)
 */
async function initDatabase() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    ensureDir(MEMORY_DIR);

    // Initialize sql.js
    if (!SQL) {
      const initSqlJs = require('sql.js');
      SQL = await initSqlJs();
    }

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        fact TEXT NOT NULL,
        category TEXT,
        scope TEXT DEFAULT 'local',
        model TEXT,
        embedding TEXT,
        source_context TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_accessed TEXT,
        access_count INTEGER DEFAULT 0,
        recall_count INTEGER DEFAULT 0,
        relevance_score REAL DEFAULT 1.0,
        promoted_to TEXT
      )
    `);

    // Cold storage for demoted facts
    db.run(`
      CREATE TABLE IF NOT EXISTS facts_cold (
        id TEXT PRIMARY KEY,
        fact TEXT NOT NULL,
        category TEXT,
        scope TEXT DEFAULT 'local',
        model TEXT,
        embedding TEXT,
        source_context TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_accessed TEXT,
        access_count INTEGER DEFAULT 0,
        recall_count INTEGER DEFAULT 0,
        relevance_score REAL,
        promoted_to TEXT,
        archived_at TEXT DEFAULT (datetime('now')),
        archive_reason TEXT
      )
    `);

    // Memory metrics for tracking entropy over time
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        total_facts INTEGER,
        cold_facts INTEGER,
        entropy_score REAL,
        avg_relevance REAL,
        never_accessed INTEGER,
        action_taken TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        category TEXT,
        rationale TEXT,
        source_context TEXT,
        status TEXT DEFAULT 'pending',
        votes TEXT DEFAULT '[]',
        synced INTEGER DEFAULT 0,
        remote_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        decided_at TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS prd_chunks (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        section TEXT,
        content TEXT,
        chunk_type TEXT,
        embedding TEXT,
        file_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Migrate existing databases - add new columns if they don't exist
    const migrations = [
      'ALTER TABLE facts ADD COLUMN last_accessed TEXT',
      'ALTER TABLE facts ADD COLUMN access_count INTEGER DEFAULT 0',
      'ALTER TABLE facts ADD COLUMN recall_count INTEGER DEFAULT 0',
      'ALTER TABLE facts ADD COLUMN relevance_score REAL DEFAULT 1.0',
      'ALTER TABLE facts ADD COLUMN promoted_to TEXT'
    ];
    for (const migration of migrations) {
      try { db.run(migration); } catch {}
    }

    // Create indexes
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_model ON facts(model)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_relevance ON facts(relevance_score)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_accessed ON facts(last_accessed)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_facts_cold_archived ON facts_cold(archived_at)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)'); } catch {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_prd_prd_id ON prd_chunks(prd_id)'); } catch {}

    saveDatabase();
    return db;
  })();

  return initPromise;
}

/**
 * Save database to disk
 */
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

/**
 * Close database
 */
function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    initPromise = null;
  }
}

// ============================================================
// Embeddings
// ============================================================

// Track if embeddings are available
let embeddingsAvailable = null; // null = unknown, true/false after first check

/**
 * Get embedder (lazy load)
 * Returns null if @xenova/transformers is not installed
 */
async function getEmbedder() {
  if (embeddingsAvailable === false) return null;

  if (!embedder) {
    try {
      const { pipeline } = await import('@xenova/transformers');
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      embeddingsAvailable = true;
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
        embeddingsAvailable = false;
        if (process.env.DEBUG) {
          console.warn('[DEBUG] @xenova/transformers not installed - semantic search disabled');
        }
        return null;
      }
      throw e; // Re-throw other errors
    }
  }
  return embedder;
}

/**
 * Get embedding for text
 * Returns null if embeddings are not available
 */
async function getEmbedding(text) {
  const embed = await getEmbedder();
  if (!embed) return null;
  const result = await embed(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

/**
 * Calculate cosine similarity
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================
// Utility Functions
// ============================================================

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function embeddingToJson(embedding) {
  return JSON.stringify(embedding);
}

function jsonToEmbedding(json) {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function queryToRows(result) {
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// ============================================================
// Facts Operations
// ============================================================

/**
 * Store a fact
 */
async function storeFact({ fact, category, scope, model, sourceContext }) {
  await initDatabase();
  const id = generateId('fact');
  const embedding = await getEmbedding(fact);

  db.run(`
    INSERT INTO facts (id, fact, category, scope, model, embedding, source_context)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, fact, category || 'general', scope || 'local', model || null, embeddingToJson(embedding), sourceContext || null]);
  saveDatabase();

  return { id, stored: true };
}

/**
 * Search facts by similarity (with access tracking)
 * Falls back to text search if embeddings are not available
 */
async function searchFacts({ query, category, model, scope, limit = 10, trackAccess = true }) {
  await initDatabase();
  const queryEmbedding = await getEmbedding(query);

  let sql = 'SELECT * FROM facts WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (model) {
    sql += ' AND model = ?';
    params.push(model);
  }
  if (scope) {
    sql += ' AND scope = ?';
    params.push(scope);
  }

  const result = db.exec(sql, params);
  const facts = queryToRows(result);

  // Calculate similarity and rank
  let ranked;
  if (queryEmbedding) {
    // Semantic search with embeddings
    ranked = facts.map(f => {
      const embedding = f.embedding ? jsonToEmbedding(f.embedding) : [];
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return { ...f, similarity, embedding: undefined };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } else {
    // Fallback: simple text matching when embeddings unavailable
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    ranked = facts.map(f => {
      const factLower = f.fact.toLowerCase();
      // Score based on word matches
      const matches = queryWords.filter(w => factLower.includes(w)).length;
      const similarity = queryWords.length > 0 ? matches / queryWords.length : 0;
      return { ...f, similarity, embedding: undefined };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  // Track access for returned facts (strategic forgetting support)
  if (trackAccess && ranked.length > 0) {
    for (const fact of ranked) {
      // Boost relevance when recalled (max 1.0)
      const newRelevance = Math.min(1.0, (fact.relevance_score || 0.5) + 0.1);
      db.run(`
        UPDATE facts SET
          last_accessed = datetime('now'),
          access_count = COALESCE(access_count, 0) + 1,
          recall_count = COALESCE(recall_count, 0) + 1,
          relevance_score = ?
        WHERE id = ?
      `, [newRelevance, fact.id]);
    }
    saveDatabase();
  }

  return ranked.map(({ id, fact, category, scope, model, similarity, created_at, relevance_score, access_count }) => ({
    id, fact, category, scope, model,
    relevance: Math.round(similarity * 100),
    storedRelevance: Math.round((relevance_score || 1.0) * 100),
    accessCount: access_count || 0,
    createdAt: created_at
  }));
}

/**
 * Delete a fact
 */
async function deleteFact(factId) {
  await initDatabase();
  db.run('DELETE FROM facts WHERE id = ?', [factId]);
  const changes = db.getRowsModified();
  saveDatabase();
  return { deleted: changes > 0 };
}

/**
 * Get all facts (for export/sync)
 */
async function getAllFacts({ scope } = {}) {
  await initDatabase();
  let sql = 'SELECT id, fact, category, scope, model, source_context, created_at FROM facts';
  const params = [];
  if (scope) {
    sql += ' WHERE scope = ?';
    params.push(scope);
  }
  const result = db.exec(sql, params);
  return queryToRows(result);
}

// ============================================================
// Proposals Operations
// ============================================================

/**
 * Create a proposal
 */
async function createProposal({ rule, category, rationale, sourceContext }) {
  await initDatabase();
  const id = generateId('proposal');

  db.run(`
    INSERT INTO proposals (id, rule, category, rationale, source_context)
    VALUES (?, ?, ?, ?, ?)
  `, [id, rule, category || 'pattern', rationale || '', sourceContext || null]);
  saveDatabase();

  return { id, status: 'pending' };
}

/**
 * Get proposals by status
 */
async function getProposals(status = 'pending') {
  await initDatabase();
  const result = db.exec(
    `SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC`,
    [status]
  );
  const proposals = queryToRows(result);

  return proposals.map(p => ({
    id: p.id,
    rule: p.rule,
    category: p.category,
    rationale: p.rationale,
    sourceContext: p.source_context,
    status: p.status,
    votes: JSON.parse(p.votes || '[]'),
    synced: !!p.synced,
    remoteId: p.remote_id,
    createdAt: p.created_at
  }));
}

/**
 * Update proposal (for sync)
 */
async function updateProposal(id, updates) {
  await initDatabase();
  const sets = [];
  const params = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  if (updates.synced !== undefined) {
    sets.push('synced = ?');
    params.push(updates.synced ? 1 : 0);
  }
  if (updates.remoteId !== undefined) {
    sets.push('remote_id = ?');
    params.push(updates.remoteId);
  }
  if (updates.votes !== undefined) {
    sets.push('votes = ?');
    params.push(JSON.stringify(updates.votes));
  }

  if (sets.length === 0) return { updated: false };

  params.push(id);
  db.run(`UPDATE proposals SET ${sets.join(', ')} WHERE id = ?`, params);
  saveDatabase();

  return { updated: db.getRowsModified() > 0 };
}

/**
 * Get unsynced proposals
 */
async function getUnsyncedProposals() {
  await initDatabase();
  const result = db.exec('SELECT * FROM proposals WHERE synced = 0 AND status = ?', ['pending']);
  return queryToRows(result);
}

// ============================================================
// PRD Operations
// ============================================================

/**
 * Detect chunk type
 */
function detectChunkType(content) {
  if (/^[-*]\s/m.test(content)) return 'list';
  if (/acceptance criteria|given.*when.*then/i.test(content)) return 'criteria';
  if (/constraint|must not|required|shall not|shall be/i.test(content)) return 'constraint';
  if (/goal|objective|purpose|aim|target/i.test(content)) return 'goal';
  if (/api|endpoint|database|schema|interface|component/i.test(content)) return 'technical';
  return 'description';
}

/**
 * Chunk PRD content
 */
function chunkPRD(content, options = {}) {
  const { chunkSize = 500 } = options;
  const chunks = [];
  const sections = content.split(/(?=^##\s+)/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const titleMatch = section.match(/^(#{2,3})\s+(.+)/m);
    const sectionTitle = titleMatch ? titleMatch[2].trim() : 'Introduction';
    const sectionContent = titleMatch
      ? section.slice(titleMatch[0].length).trim()
      : section.trim();

    const paragraphs = sectionContent.split(/\n\n+/);

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed || trimmed.length < 30) continue;

      const type = detectChunkType(trimmed);

      if (trimmed.length > chunkSize) {
        // Split by sentences
        const sentences = trimmed.split(/(?<=[.!?])\s+/);
        let current = '';

        for (const sentence of sentences) {
          if (current.length + sentence.length > chunkSize && current.length > 30) {
            chunks.push({ section: sectionTitle, content: current.trim(), type });
            current = sentence;
          } else {
            current += (current ? ' ' : '') + sentence;
          }
        }
        if (current.length > 30) {
          chunks.push({ section: sectionTitle, content: current.trim(), type });
        }
      } else {
        chunks.push({ section: sectionTitle, content: trimmed, type });
      }
    }
  }

  return chunks;
}

/**
 * Store PRD chunks
 */
async function storePRD({ content, prdId, fileName }) {
  await initDatabase();
  const chunks = chunkPRD(content);
  const storedChunks = [];

  // Remove old chunks for this PRD
  db.run('DELETE FROM prd_chunks WHERE prd_id = ?', [prdId]);

  for (const chunk of chunks) {
    const id = generateId('prd');
    const embedding = await getEmbedding(chunk.content);

    db.run(`
      INSERT INTO prd_chunks (id, prd_id, section, content, chunk_type, embedding, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, prdId, chunk.section, chunk.content, chunk.type, embeddingToJson(embedding), fileName || null]);

    storedChunks.push({ id, section: chunk.section, type: chunk.type });
  }

  saveDatabase();

  return {
    prdId,
    chunkCount: storedChunks.length,
    sections: [...new Set(storedChunks.map(c => c.section))]
  };
}

/**
 * Get PRD context for a task
 * Falls back to text search if embeddings are not available
 */
async function getPRDContext({ query, maxTokens = 2000, prdId }) {
  await initDatabase();
  const queryEmbedding = await getEmbedding(query);

  let sql = 'SELECT * FROM prd_chunks';
  const params = [];
  if (prdId) {
    sql += ' WHERE prd_id = ?';
    params.push(prdId);
  }

  const result = db.exec(sql, params);
  const chunks = queryToRows(result);

  if (chunks.length === 0) return null;

  // Calculate similarity and rank
  let ranked;
  if (queryEmbedding) {
    // Semantic search with embeddings
    ranked = chunks.map(c => {
      const embedding = c.embedding ? jsonToEmbedding(c.embedding) : [];
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return { ...c, similarity };
    });
  } else {
    // Fallback: simple text matching when embeddings unavailable
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    ranked = chunks.map(c => {
      const contentLower = c.content.toLowerCase();
      const matches = queryWords.filter(w => contentLower.includes(w)).length;
      const similarity = queryWords.length > 0 ? matches / queryWords.length : 0;
      return { ...c, similarity };
    });
  }

  // Sort by similarity, then by type priority
  const typePriority = { constraint: 0, criteria: 1, goal: 2, technical: 3, description: 4, list: 5 };
  ranked.sort((a, b) => {
    if (Math.abs(a.similarity - b.similarity) > 0.1) return b.similarity - a.similarity;
    return (typePriority[a.chunk_type] || 99) - (typePriority[b.chunk_type] || 99);
  });

  // Build context within token limit
  let context = '## Relevant PRD Context\n\n';
  let charCount = context.length;
  const maxChars = maxTokens * 4;
  const includedSections = new Set();

  for (const chunk of ranked) {
    if (chunk.similarity < 0.1 && includedSections.size >= 3) continue;

    const prefix = !includedSections.has(chunk.section) ? `### ${chunk.section}\n` : '';
    const text = prefix + chunk.content + '\n\n';

    if (charCount + text.length > maxChars) break;

    if (prefix) includedSections.add(chunk.section);
    context += text;
    charCount += text.length;
  }

  return {
    context: context.trim(),
    topRelevance: ranked[0] ? Math.round(ranked[0].similarity * 100) : 0
  };
}

/**
 * List stored PRDs
 */
async function listPRDs() {
  await initDatabase();
  const result = db.exec(`
    SELECT prd_id, file_name, COUNT(*) as chunk_count, MIN(created_at) as created_at
    FROM prd_chunks
    GROUP BY prd_id
  `);
  return queryToRows(result);
}

/**
 * Delete a PRD
 */
async function deletePRD(prdId) {
  await initDatabase();
  db.run('DELETE FROM prd_chunks WHERE prd_id = ?', [prdId]);
  const changes = db.getRowsModified();
  saveDatabase();
  return { deleted: changes > 0 };
}

/**
 * Clear all PRDs
 */
async function clearPRDs() {
  await initDatabase();
  db.run('DELETE FROM prd_chunks');
  saveDatabase();
  return { cleared: true };
}

// ============================================================
// Sync State
// ============================================================

async function getSyncState(key) {
  await initDatabase();
  const result = db.exec('SELECT value FROM sync_state WHERE key = ?', [key]);
  const rows = queryToRows(result);
  return rows[0]?.value || null;
}

async function setSyncState(key, value) {
  await initDatabase();
  db.run(`
    INSERT OR REPLACE INTO sync_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `, [key, value]);
  saveDatabase();
}

// ============================================================
// Statistics
// ============================================================

async function getStats() {
  await initDatabase();

  function count(sql, params = []) {
    const result = db.exec(sql, params);
    if (!result.length || !result[0].values.length) return 0;
    return result[0].values[0][0];
  }

  function grouped(sql) {
    const result = db.exec(sql);
    if (!result.length) return {};
    return Object.fromEntries(result[0].values.map(row => [row[0] || 'null', row[1]]));
  }

  return {
    facts: {
      total: count('SELECT COUNT(*) FROM facts'),
      byCategory: grouped('SELECT category, COUNT(*) FROM facts GROUP BY category'),
      byScope: grouped('SELECT scope, COUNT(*) FROM facts GROUP BY scope')
    },
    proposals: {
      pending: count('SELECT COUNT(*) FROM proposals WHERE status = ?', ['pending']),
      total: count('SELECT COUNT(*) FROM proposals')
    },
    prds: {
      total: count('SELECT COUNT(DISTINCT prd_id) FROM prd_chunks'),
      chunks: count('SELECT COUNT(*) FROM prd_chunks')
    }
  };
}

// ============================================================
// Strategic Forgetting & Entropy
// ============================================================

/**
 * Get entropy statistics for memory health
 */
async function getEntropyStats(config = {}) {
  await initDatabase();
  const maxFacts = config.maxLocalFacts || 1000;

  function count(sql, params = []) {
    const result = db.exec(sql, params);
    if (!result.length || !result[0].values.length) return 0;
    return result[0].values[0][0];
  }

  function avg(sql) {
    const result = db.exec(sql);
    if (!result.length || !result[0].values.length || result[0].values[0][0] === null) return 0;
    return result[0].values[0][0];
  }

  const totalFacts = count('SELECT COUNT(*) FROM facts');
  const coldFacts = count('SELECT COUNT(*) FROM facts_cold');
  const neverAccessed = count('SELECT COUNT(*) FROM facts WHERE last_accessed IS NULL');
  const avgRelevance = avg('SELECT AVG(relevance_score) FROM facts');
  const avgAgeDays = avg(`
    SELECT AVG(julianday('now') - julianday(created_at))
    FROM facts
  `);
  const lowRelevanceCount = count('SELECT COUNT(*) FROM facts WHERE relevance_score < 0.3');

  // Calculate entropy score (0-1, higher = needs cleanup)
  const capacityRatio = Math.min(1, totalFacts / maxFacts);
  const ageRatio = Math.min(1, avgAgeDays / 30);
  const neverAccessedRatio = totalFacts > 0 ? neverAccessed / totalFacts : 0;
  const lowRelevanceRatio = totalFacts > 0 ? lowRelevanceCount / totalFacts : 0;

  const entropy = (
    capacityRatio * 0.3 +
    ageRatio * 0.2 +
    neverAccessedRatio * 0.25 +
    lowRelevanceRatio * 0.25
  );

  return {
    totalFacts,
    coldFacts,
    maxFacts,
    neverAccessed,
    avgRelevance: Math.round(avgRelevance * 100) / 100,
    avgAgeDays: Math.round(avgAgeDays * 10) / 10,
    lowRelevanceCount,
    entropy: Math.round(entropy * 1000) / 1000,
    needsCompaction: entropy > 0.7,
    status: entropy < 0.4 ? 'healthy' : entropy < 0.7 ? 'moderate' : 'needs_cleanup'
  };
}

/**
 * Apply relevance decay to facts (run daily or on session end)
 */
async function applyRelevanceDecay(config = {}) {
  await initDatabase();
  const decayRate = config.decayRate || 0.033; // ~1/30, decay over 30 days
  const neverAccessedPenalty = config.neverAccessedPenalty || 0.1;

  // Decay facts based on time since last access
  db.run(`
    UPDATE facts SET
      relevance_score = MAX(0.1, relevance_score * (1.0 - ? * (julianday('now') - julianday(COALESCE(last_accessed, created_at)))))
    WHERE last_accessed IS NOT NULL
  `, [decayRate]);

  // Faster decay for never-accessed facts (older than 7 days)
  db.run(`
    UPDATE facts SET
      relevance_score = MAX(0.1, relevance_score - ?)
    WHERE last_accessed IS NULL
      AND julianday('now') - julianday(created_at) > 7
  `, [neverAccessedPenalty]);

  const changes = db.getRowsModified();
  saveDatabase();

  return { decayed: changes };
}

/**
 * Demote low-relevance facts to cold storage
 */
async function demoteToColdStorage(config = {}) {
  await initDatabase();
  const relevanceThreshold = config.relevanceThreshold || 0.3;

  // Find facts to demote (low relevance, not promoted anywhere)
  const result = db.exec(`
    SELECT * FROM facts
    WHERE relevance_score < ?
      AND (promoted_to IS NULL OR promoted_to = '')
  `, [relevanceThreshold]);
  const toDemote = queryToRows(result);

  let demoted = 0;
  for (const fact of toDemote) {
    // Insert into cold storage
    db.run(`
      INSERT INTO facts_cold (id, fact, category, scope, model, embedding, source_context,
        created_at, updated_at, last_accessed, access_count, recall_count,
        relevance_score, promoted_to, archived_at, archive_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'low_relevance')
    `, [fact.id, fact.fact, fact.category, fact.scope, fact.model, fact.embedding,
        fact.source_context, fact.created_at, fact.updated_at, fact.last_accessed,
        fact.access_count, fact.recall_count, fact.relevance_score, fact.promoted_to]);

    // Delete from active facts
    db.run('DELETE FROM facts WHERE id = ?', [fact.id]);
    demoted++;
  }

  saveDatabase();
  return { demoted };
}

/**
 * Purge old facts from cold storage
 */
async function purgeColdFacts(config = {}) {
  await initDatabase();
  const retentionDays = config.coldRetentionDays || 90;

  db.run(`
    DELETE FROM facts_cold
    WHERE julianday('now') - julianday(archived_at) > ?
  `, [retentionDays]);

  const purged = db.getRowsModified();
  saveDatabase();

  return { purged };
}

/**
 * Find and merge similar facts (deduplication)
 */
async function mergeSimilarFacts(config = {}) {
  await initDatabase();
  const similarityThreshold = config.mergeSimilarityThreshold || 0.95;

  const result = db.exec('SELECT id, fact, embedding, relevance_score FROM facts');
  const facts = queryToRows(result);

  const merged = [];
  const toDelete = new Set();

  for (let i = 0; i < facts.length; i++) {
    if (toDelete.has(facts[i].id)) continue;

    const embeddingA = facts[i].embedding ? jsonToEmbedding(facts[i].embedding) : [];
    if (embeddingA.length === 0) continue;

    for (let j = i + 1; j < facts.length; j++) {
      if (toDelete.has(facts[j].id)) continue;

      const embeddingB = facts[j].embedding ? jsonToEmbedding(facts[j].embedding) : [];
      if (embeddingB.length === 0) continue;

      const similarity = cosineSimilarity(embeddingA, embeddingB);
      if (similarity >= similarityThreshold) {
        // Keep the one with higher relevance, delete the other
        const keepId = facts[i].relevance_score >= facts[j].relevance_score ? facts[i].id : facts[j].id;
        const deleteId = keepId === facts[i].id ? facts[j].id : facts[i].id;

        toDelete.add(deleteId);
        merged.push({ kept: keepId, deleted: deleteId, similarity });
      }
    }
  }

  // Delete duplicates
  for (const id of toDelete) {
    db.run('DELETE FROM facts WHERE id = ?', [id]);
  }

  if (toDelete.size > 0) saveDatabase();

  return { merged: merged.length, details: merged };
}

/**
 * Record entropy metric for tracking over time
 */
async function recordMemoryMetric(action = null) {
  await initDatabase();
  const stats = await getEntropyStats();

  db.run(`
    INSERT INTO memory_metrics (total_facts, cold_facts, entropy_score, avg_relevance, never_accessed, action_taken)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [stats.totalFacts, stats.coldFacts, stats.entropy, stats.avgRelevance, stats.neverAccessed, action]);

  saveDatabase();
  return stats;
}

/**
 * Get memory metrics history
 */
async function getMemoryMetrics(limit = 30) {
  await initDatabase();
  const result = db.exec(`
    SELECT * FROM memory_metrics
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit]);
  return queryToRows(result);
}

/**
 * Mark a fact as promoted (to decisions.md, etc.)
 */
async function markFactPromoted(factId, destination) {
  await initDatabase();
  db.run(`
    UPDATE facts SET promoted_to = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [destination, factId]);
  saveDatabase();
  return { marked: db.getRowsModified() > 0 };
}

/**
 * Get facts that are candidates for promotion (high relevance, frequently accessed)
 */
async function getPromotionCandidates(config = {}) {
  await initDatabase();
  const minRelevance = config.minRelevance || 0.8;
  const minAccessCount = config.minAccessCount || 3;

  const result = db.exec(`
    SELECT * FROM facts
    WHERE relevance_score >= ?
      AND access_count >= ?
      AND (promoted_to IS NULL OR promoted_to = '')
    ORDER BY relevance_score DESC, access_count DESC
  `, [minRelevance, minAccessCount]);

  return queryToRows(result);
}

/**
 * Restore a fact from cold storage
 */
async function restoreFromColdStorage(factId) {
  await initDatabase();

  // Find in cold storage
  const result = db.exec('SELECT * FROM facts_cold WHERE id = ?', [factId]);
  const facts = queryToRows(result);
  if (facts.length === 0) return { restored: false, error: 'Fact not found in cold storage' };

  const fact = facts[0];

  // Insert back into active facts with boosted relevance
  db.run(`
    INSERT INTO facts (id, fact, category, scope, model, embedding, source_context,
      created_at, updated_at, last_accessed, access_count, recall_count, relevance_score, promoted_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, 0.5, ?)
  `, [fact.id, fact.fact, fact.category, fact.scope, fact.model, fact.embedding,
      fact.source_context, fact.created_at, fact.access_count, fact.recall_count, fact.promoted_to]);

  // Remove from cold storage
  db.run('DELETE FROM facts_cold WHERE id = ?', [factId]);

  saveDatabase();
  return { restored: true };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Database management
  initDatabase,
  saveDatabase,
  closeDatabase,

  // Embeddings
  getEmbedding,
  cosineSimilarity,

  // Facts
  storeFact,
  searchFacts,
  deleteFact,
  getAllFacts,

  // Proposals
  createProposal,
  getProposals,
  updateProposal,
  getUnsyncedProposals,

  // PRDs
  chunkPRD,
  storePRD,
  getPRDContext,
  listPRDs,
  deletePRD,
  clearPRDs,

  // Sync
  getSyncState,
  setSyncState,

  // Stats
  getStats,

  // Strategic Forgetting & Entropy
  getEntropyStats,
  applyRelevanceDecay,
  demoteToColdStorage,
  purgeColdFacts,
  mergeSimilarFacts,
  recordMemoryMetric,
  getMemoryMetrics,
  markFactPromoted,
  getPromotionCandidates,
  restoreFromColdStorage,

  // Paths
  DB_PATH,
  MEMORY_DIR
};
