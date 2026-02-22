#!/usr/bin/env node

/**
 * Wogi Flow - Memory Database Module
 *
 * See MEMORY-ARCHITECTURE.md for how this fits with other memory/knowledge modules.
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
 * Updated v10.1 - Code review fixes (SQL safety, DRY, constants)
 */

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./flow-file-ops');

// ============================================================
// Constants (extracted from magic numbers)
// ============================================================

const DEFAULTS = {
  CHUNK_SIZE: 500,
  MIN_CHUNK_LENGTH: 30,
  MAX_LOCAL_FACTS: 1000,
  DECAY_RATE: 0.033,                    // ~1/30, decay over 30 days
  NEVER_ACCESSED_PENALTY: 0.1,
  RELEVANCE_THRESHOLD: 0.3,
  COLD_RETENTION_DAYS: 90,
  MERGE_SIMILARITY_THRESHOLD: 0.95,
  MIN_PROMOTION_RELEVANCE: 0.8,
  MIN_PROMOTION_ACCESS_COUNT: 3,
  MAX_INPUT_SIZE: 2000,
  MAX_OUTPUT_SIZE: 2000,
  OBSERVATION_RETENTION_DAYS: 30,
  DEFAULT_SEARCH_LIMIT: 10,
  DEFAULT_OBSERVATION_LIMIT: 20,
  SIMILARITY_THRESHOLD: 0.1,
  MIN_SECTIONS_BEFORE_FILTER: 3,
  RELEVANCE_BOOST: 0.1,
  MAX_RELEVANCE: 1.0,
  MIN_RELEVANCE: 0.1,
  NEVER_ACCESSED_AGE_DAYS: 7
};

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = process.env.WOGI_PROJECT_ROOT || process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const MEMORY_DIR = path.join(WORKFLOW_DIR, 'memory');
const DB_PATH = path.join(MEMORY_DIR, 'local.db');

// ============================================================
// Safe JSON Helpers (using shared flow-utils where available)
// ============================================================

// Import safeJsonParseString from flow-utils if available
let safeJsonParseString;
try {
  const flowUtils = require('./flow-utils');
  safeJsonParseString = flowUtils.safeJsonParseString;
} catch (err) {
  // Fallback if flow-utils not available (e.g., in MCP server context)
  safeJsonParseString = null;
}

/**
 * Safely parse pins JSON with validation
 * Prevents prototype pollution and validates structure
 * @param {string} pinsJson - JSON string of pins array
 * @returns {string[]} - Parsed pins array (empty on error)
 */
function safeParsePins(pinsJson) {
  if (!pinsJson || pinsJson === '[]') return [];

  try {
    // Use shared utility if available
    if (safeJsonParseString) {
      const parsed = safeJsonParseString(pinsJson, null);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(p => typeof p === 'string');
    }

    // Fallback: Check for prototype pollution attempts
    if (/__proto__|constructor|prototype/i.test(pinsJson)) {
      if (process.env.DEBUG) {
        console.warn('[safeParsePins] Suspicious content detected in pins JSON');
      }
      return [];
    }

    const parsed = JSON.parse(pinsJson);

    // Validate it's an array of strings
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(p => typeof p === 'string');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[safeParsePins] Parse error: ${err.message}`);
    }
    return [];
  }
}

// ============================================================
// Database Singleton
// ============================================================

let SQL = null;
let db = null;
let embedder = null;
let initPromise = null;

// ensureDir imported from flow-file-ops

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

    // Section index table for Smart Context System (Phase 1)
    db.run(`
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        category TEXT,
        title TEXT NOT NULL,
        pins TEXT,
        content TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        content_hash TEXT,
        embedding TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // v9.0: Request log table for queryable history
    db.run(`
      CREATE TABLE IF NOT EXISTS request_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT DEFAULT (datetime('now')),
        type TEXT CHECK(type IN ('new','fix','change','refactor','other')),
        tags TEXT,
        request TEXT,
        result TEXT,
        files TEXT,
        task_id TEXT
      )
    `);

    // v10.0: Observations table for automatic tool use capture
    db.run(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        tool_name TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        full_input TEXT,
        full_output TEXT,
        timestamp TEXT DEFAULT (datetime('now')),
        success INTEGER DEFAULT 1,
        duration_ms INTEGER,
        context_task_id TEXT,
        relevance_score REAL DEFAULT 1.0
      )
    `);

    // Migrate existing databases - add new columns if they don't exist
    const migrations = [
      'ALTER TABLE facts ADD COLUMN last_accessed TEXT',
      'ALTER TABLE facts ADD COLUMN access_count INTEGER DEFAULT 0',
      'ALTER TABLE facts ADD COLUMN recall_count INTEGER DEFAULT 0',
      'ALTER TABLE facts ADD COLUMN relevance_score REAL DEFAULT 1.0',
      'ALTER TABLE facts ADD COLUMN promoted_to TEXT',
      // v10.1: Rejected-approach tagging on observations
      'ALTER TABLE observations ADD COLUMN exploration_status TEXT',
      'ALTER TABLE observations ADD COLUMN rejection_reason TEXT'
    ];
    for (const migration of migrations) {
      try {
        db.run(migration);
      } catch (err) {
        // Expected error if column already exists - only log unexpected errors
        if (process.env.DEBUG && !err.message?.includes('duplicate column')) {
          console.error(`[migration] ${migration}: ${err.message}`);
        }
      }
    }

    // Create indexes - helper to reduce repetition
    const createIndex = (sql) => {
      try {
        db.run(sql);
      } catch (err) {
        if (process.env.DEBUG && !err.message?.includes('already exists')) {
          console.error(`[index] ${sql}: ${err.message}`);
        }
      }
    };

    // Facts indexes
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_model ON facts(model)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_relevance ON facts(relevance_score)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_accessed ON facts(last_accessed)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_facts_cold_archived ON facts_cold(archived_at)');

    // Other table indexes
    createIndex('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_prd_prd_id ON prd_chunks(prd_id)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_sections_source ON sections(source)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_sections_category ON sections(category)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_sections_hash ON sections(content_hash)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_request_log_type ON request_log(type)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_request_log_task_id ON request_log(task_id)');

    // Observations indexes
    createIndex('CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_obs_tool ON observations(tool_name)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_obs_timestamp ON observations(timestamp)');
    createIndex('CREATE INDEX IF NOT EXISTS idx_obs_task ON observations(context_task_id)');

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
      throw err; // Re-throw other errors
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

// Counter for additional uniqueness within same millisecond
let idCounter = 0;

/**
 * Generate a unique ID with prefix
 * Uses timestamp + random + counter for guaranteed uniqueness
 * @param {string} prefix - ID prefix (e.g., 'fact', 'obs')
 * @returns {string} - Unique ID
 */
function generateId(prefix) {
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${idCounter.toString().padStart(3, '0')}`;
}

function embeddingToJson(embedding) {
  return JSON.stringify(embedding);
}

function jsonToEmbedding(json) {
  try {
    return JSON.parse(json);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[jsonToEmbedding] Parse error: ${err.message}`);
    }
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
// DRY: Module-level count/grouped helpers (used by multiple functions)
// ============================================================

/**
 * Execute a COUNT query and return the result
 * @param {string} sql - SQL query returning a single count
 * @param {Array} params - Query parameters
 * @returns {number} - Count result
 */
function dbCount(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return 0;
  return result[0].values[0][0];
}

/**
 * Execute a GROUP BY query and return as object
 * @param {string} sql - SQL query with GROUP BY returning key-value pairs
 * @returns {Object} - Key-value mapping
 */
function dbGrouped(sql) {
  const result = db.exec(sql);
  if (!result.length) return {};
  return Object.fromEntries(result[0].values.map(row => [row[0] || 'null', row[1]]));
}

/**
 * Execute an AVG query and return the result
 * @param {string} sql - SQL query returning a single average
 * @returns {number} - Average result
 */
function dbAvg(sql) {
  const result = db.exec(sql);
  if (!result.length || !result[0].values.length || result[0].values[0][0] === null) return 0;
  return result[0].values[0][0];
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

  return {
    facts: {
      total: dbCount('SELECT COUNT(*) FROM facts'),
      byCategory: dbGrouped('SELECT category, COUNT(*) FROM facts GROUP BY category'),
      byScope: dbGrouped('SELECT scope, COUNT(*) FROM facts GROUP BY scope')
    },
    proposals: {
      pending: dbCount('SELECT COUNT(*) FROM proposals WHERE status = ?', ['pending']),
      total: dbCount('SELECT COUNT(*) FROM proposals')
    },
    prds: {
      total: dbCount('SELECT COUNT(DISTINCT prd_id) FROM prd_chunks'),
      chunks: dbCount('SELECT COUNT(*) FROM prd_chunks')
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
  const maxFacts = config.maxLocalFacts || DEFAULTS.MAX_LOCAL_FACTS;

  const totalFacts = dbCount('SELECT COUNT(*) FROM facts');
  const coldFacts = dbCount('SELECT COUNT(*) FROM facts_cold');
  const neverAccessed = dbCount('SELECT COUNT(*) FROM facts WHERE last_accessed IS NULL');
  const avgRelevance = dbAvg('SELECT AVG(relevance_score) FROM facts');
  const avgAgeDays = dbAvg(`
    SELECT AVG(julianday('now') - julianday(created_at))
    FROM facts
  `);
  const lowRelevanceCount = dbCount(`SELECT COUNT(*) FROM facts WHERE relevance_score < ${DEFAULTS.RELEVANCE_THRESHOLD}`);

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
// Request Log Operations (v9.0)
// ============================================================

/**
 * Add a request log entry to the database
 * @param {Object} entry - { id, type, tags, request, result, files, taskId }
 * @returns {Object} - { id, stored: boolean }
 */
async function addRequestLogEntry(entry) {
  await initDatabase();

  const id = entry.id || generateId('log');
  const tags = Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : entry.tags || '[]';
  const files = Array.isArray(entry.files) ? JSON.stringify(entry.files) : entry.files || '[]';

  db.run(`
    INSERT INTO request_log (id, type, tags, request, result, files, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    entry.type || 'other',
    tags,
    entry.request || '',
    entry.result || '',
    files,
    entry.taskId || null
  ]);

  saveDatabase();
  return { id, stored: true };
}

/**
 * Search request log entries
 * @param {Object} options - { query, type, tag, since, limit }
 * @returns {Object[]} - Matching entries
 */
async function searchRequestLog(options = {}) {
  await initDatabase();
  const { query, type, tag, since, taskId, limit = 50 } = options;

  let sql = 'SELECT * FROM request_log WHERE 1=1';
  const params = [];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  if (taskId) {
    sql += ' AND task_id = ?';
    params.push(taskId);
  }

  if (tag) {
    // Search in JSON tags array
    sql += ' AND tags LIKE ?';
    params.push(`%${tag}%`);
  }

  if (since) {
    sql += ' AND timestamp >= ?';
    params.push(since);
  }

  if (query) {
    sql += ' AND (request LIKE ? OR result LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(sql, params);
  const entries = queryToRows(result);

  // Parse JSON fields
  return entries.map(e => ({
    ...e,
    tags: e.tags ? JSON.parse(e.tags) : [],
    files: e.files ? JSON.parse(e.files) : []
  }));
}

/**
 * Get request log entry by ID
 * @param {string} entryId - Entry ID
 * @returns {Object|null} - Entry or null
 */
async function getRequestLogEntry(entryId) {
  await initDatabase();
  const result = db.exec('SELECT * FROM request_log WHERE id = ?', [entryId]);
  const rows = queryToRows(result);

  if (rows.length === 0) return null;

  const entry = rows[0];
  return {
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : [],
    files: entry.files ? JSON.parse(entry.files) : []
  };
}

/**
 * Get request log statistics
 * @returns {Object} - Stats about request log
 */
async function getRequestLogStats() {
  await initDatabase();

  return {
    total: dbCount('SELECT COUNT(*) FROM request_log'),
    byType: dbGrouped('SELECT type, COUNT(*) FROM request_log GROUP BY type'),
    last7Days: dbCount(`SELECT COUNT(*) FROM request_log WHERE timestamp >= datetime('now', '-7 days')`),
    last30Days: dbCount(`SELECT COUNT(*) FROM request_log WHERE timestamp >= datetime('now', '-30 days')`)
  };
}

// ============================================================
// Observations Operations (v10.0 - Automatic Tool Capture)
// ============================================================

/**
 * Store an observation (tool use capture)
 * @param {Object} options - { sessionId, toolName, inputSummary, outputSummary, fullInput, fullOutput, success, durationMs, contextTaskId }
 * @returns {Object} - { id, stored: boolean }
 */
async function storeObservation(options) {
  await initDatabase();

  const {
    sessionId,
    toolName,
    inputSummary,
    outputSummary,
    fullInput,
    fullOutput,
    success = 1,
    durationMs,
    contextTaskId,
    explorationStatus,
    rejectionReason
  } = options;

  const id = generateId('obs');

  db.run(`
    INSERT INTO observations (id, session_id, tool_name, input_summary, output_summary, full_input, full_output, success, duration_ms, context_task_id, exploration_status, rejection_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, sessionId || null, toolName, inputSummary || null, outputSummary || null, fullInput || null, fullOutput || null, success, durationMs || null, contextTaskId || null, explorationStatus || null, rejectionReason || null]);

  saveDatabase();
  return { id, stored: true };
}

/**
 * Search observations with compact results (progressive disclosure step 1)
 * Returns only IDs and summaries for ~10x token savings
 * @param {Object} options - { query, toolFilter, since, limit }
 * @returns {Object[]} - Compact observation records
 */
async function searchObservationsCompact(options = {}) {
  await initDatabase();
  const { query, toolFilter, since, limit = 20 } = options;

  let sql = `SELECT id, tool_name, input_summary, output_summary, timestamp, success, context_task_id, exploration_status, rejection_reason
             FROM observations WHERE 1=1`;
  const params = [];

  if (toolFilter) {
    sql += ' AND tool_name = ?';
    params.push(toolFilter);
  }

  if (since) {
    sql += ' AND timestamp >= ?';
    params.push(since);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(sql, params);
  let observations = queryToRows(result);

  // If query provided, filter by text match in summaries
  if (query) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    observations = observations.filter(obs => {
      const searchText = `${obs.input_summary || ''} ${obs.output_summary || ''} ${obs.tool_name}`.toLowerCase();
      return queryWords.some(w => searchText.includes(w));
    });
  }

  return observations.map(obs => ({
    id: obs.id,
    toolName: obs.tool_name,
    inputSummary: obs.input_summary,
    outputSummary: obs.output_summary,
    timestamp: obs.timestamp,
    success: obs.success === 1,
    contextTaskId: obs.context_task_id,
    explorationStatus: obs.exploration_status || null,
    rejectionReason: obs.rejection_reason || null
  }));
}

/**
 * Get full observation details by IDs (progressive disclosure step 2)
 * @param {string[]} ids - Observation IDs to fetch
 * @param {Object} options - { includeFull: boolean }
 * @returns {Object[]} - Full observation records
 */
async function getObservationsByIds(ids, options = {}) {
  await initDatabase();
  const { includeFull = true } = options;

  if (!ids || ids.length === 0) return [];

  // Validate and sanitize IDs - must be strings, filter out any non-strings
  const validIds = ids.filter(id => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) return [];

  // Use parameterized queries - one placeholder per ID (safe from SQL injection)
  const placeholders = validIds.map(() => '?').join(',');
  const columns = includeFull
    ? '*'
    : 'id, session_id, tool_name, input_summary, output_summary, timestamp, success, duration_ms, context_task_id, exploration_status, rejection_reason';

  const sql = `SELECT ${columns} FROM observations WHERE id IN (${placeholders})`;
  const result = db.exec(sql, validIds);
  const observations = queryToRows(result);

  return observations.map(obs => ({
    id: obs.id,
    sessionId: obs.session_id,
    toolName: obs.tool_name,
    inputSummary: obs.input_summary,
    outputSummary: obs.output_summary,
    fullInput: includeFull ? obs.full_input : undefined,
    fullOutput: includeFull ? obs.full_output : undefined,
    timestamp: obs.timestamp,
    success: obs.success === 1,
    durationMs: obs.duration_ms,
    contextTaskId: obs.context_task_id,
    relevanceScore: obs.relevance_score,
    explorationStatus: obs.exploration_status || null,
    rejectionReason: obs.rejection_reason || null
  }));
}

/**
 * Get timeline context around an anchor point
 * @param {Object} options - { anchor (ID or timestamp), before, after, toolFilter }
 * @returns {Object} - { anchor, before: [], after: [] }
 */
async function getTimelineContext(options = {}) {
  await initDatabase();
  const { anchor, before = 3, after = 3, toolFilter } = options;

  if (!anchor) return { anchor: null, before: [], after: [] };

  // Determine if anchor is an ID or timestamp
  let anchorTimestamp;
  let anchorObs = null;

  // Try to find as observation ID first
  const idResult = db.exec('SELECT timestamp FROM observations WHERE id = ?', [anchor]);
  const idRows = queryToRows(idResult);

  if (idRows.length > 0) {
    anchorTimestamp = idRows[0].timestamp;
    const obsResult = await getObservationsByIds([anchor], { includeFull: false });
    anchorObs = obsResult[0] || null;
  } else {
    // Treat as timestamp
    anchorTimestamp = anchor;
  }

  // Build tool filter clause
  const toolClause = toolFilter ? ' AND tool_name = ?' : '';
  const toolParams = toolFilter ? [toolFilter] : [];

  // Get observations before anchor
  const beforeSql = `SELECT id, tool_name, input_summary, output_summary, timestamp, success, context_task_id
                     FROM observations
                     WHERE timestamp < ?${toolClause}
                     ORDER BY timestamp DESC
                     LIMIT ?`;
  const beforeResult = db.exec(beforeSql, [anchorTimestamp, ...toolParams, before]);
  const beforeObs = queryToRows(beforeResult).reverse();

  // Get observations after anchor
  const afterSql = `SELECT id, tool_name, input_summary, output_summary, timestamp, success, context_task_id
                    FROM observations
                    WHERE timestamp > ?${toolClause}
                    ORDER BY timestamp ASC
                    LIMIT ?`;
  const afterResult = db.exec(afterSql, [anchorTimestamp, ...toolParams, after]);
  const afterObs = queryToRows(afterResult);

  const formatObs = (obs) => ({
    id: obs.id,
    toolName: obs.tool_name,
    inputSummary: obs.input_summary,
    outputSummary: obs.output_summary,
    timestamp: obs.timestamp,
    success: obs.success === 1,
    contextTaskId: obs.context_task_id
  });

  return {
    anchor: anchorObs,
    anchorTimestamp,
    before: beforeObs.map(formatObs),
    after: afterObs.map(formatObs)
  };
}

/**
 * Get recent observations (for dashboard or quick review)
 * @param {Object} options - { limit, toolFilter, sessionId }
 * @returns {Object[]} - Recent observations
 */
async function getRecentObservations(options = {}) {
  await initDatabase();
  const { limit = 20, toolFilter, sessionId } = options;

  let sql = `SELECT id, session_id, tool_name, input_summary, output_summary, timestamp, success, duration_ms, context_task_id
             FROM observations WHERE 1=1`;
  const params = [];

  if (toolFilter) {
    sql += ' AND tool_name = ?';
    params.push(toolFilter);
  }

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(sql, params);
  const observations = queryToRows(result);

  return observations.map(obs => ({
    id: obs.id,
    sessionId: obs.session_id,
    toolName: obs.tool_name,
    inputSummary: obs.input_summary,
    outputSummary: obs.output_summary,
    timestamp: obs.timestamp,
    success: obs.success === 1,
    durationMs: obs.duration_ms,
    contextTaskId: obs.context_task_id
  }));
}

/**
 * Get observation statistics
 * @returns {Object} - Stats about observations
 */
async function getObservationStats() {
  await initDatabase();

  return {
    total: dbCount('SELECT COUNT(*) FROM observations'),
    byTool: dbGrouped('SELECT tool_name, COUNT(*) FROM observations GROUP BY tool_name'),
    successRate: dbCount('SELECT ROUND(AVG(success) * 100, 1) FROM observations'),
    last24Hours: dbCount(`SELECT COUNT(*) FROM observations WHERE timestamp >= datetime('now', '-1 day')`),
    last7Days: dbCount(`SELECT COUNT(*) FROM observations WHERE timestamp >= datetime('now', '-7 days')`),
    avgDurationMs: dbCount('SELECT ROUND(AVG(duration_ms)) FROM observations WHERE duration_ms IS NOT NULL')
  };
}

/**
 * Extract high-value observations as solution facts before purge.
 * High-value = successful + non-trivial tool + linked to a completed task.
 * Promotes them to the facts table with category 'solution' and structured context.
 *
 * Note: Solution facts use category='solution'. Use searchFacts({ category: 'solution' })
 * to query them specifically, or exclude them from general searches with a different category.
 *
 * @param {Object} options - { retentionDays, minDurationMs, excludeTools }
 * @returns {Object} - { extracted: number, details: Array }
 */
async function extractHighValueObservations(options = {}) {
  await initDatabase();

  const {
    retentionDays = DEFAULTS.OBSERVATION_RETENTION_DAYS,
    minDurationMs = 100,
    excludeTools = ['Read', 'Glob', 'Grep']  // trivial read-only tools
  } = options;

  // [M2] Input validation - coerce to safe defaults
  const safeRetentionDays = (typeof retentionDays === 'number' && retentionDays >= 0) ? retentionDays : 30;
  const safeMinDuration = (typeof minDurationMs === 'number' && minDurationMs >= 0) ? minDurationMs : 100;
  const safeExcludeTools = Array.isArray(excludeTools) ? excludeTools.filter(t => typeof t === 'string') : [];

  // Find observations that are about to expire AND are high-value
  // Note: If safeExcludeTools is empty, NOT IN () matches all rows (desired)
  const excludePlaceholders = safeExcludeTools.map(() => '?').join(',');
  const sql = `
    SELECT id, tool_name, input_summary, output_summary, timestamp, duration_ms, context_task_id
    FROM observations
    WHERE timestamp < datetime('now', '-' || ? || ' days')
      AND success = 1
      AND context_task_id IS NOT NULL
      AND context_task_id != ''
      AND tool_name NOT IN (${excludePlaceholders})
      AND (duration_ms IS NULL OR duration_ms >= ?)
    ORDER BY timestamp ASC
  `;
  const params = [safeRetentionDays, ...safeExcludeTools, safeMinDuration];
  const result = db.exec(sql, params);
  const candidates = queryToRows(result);

  if (candidates.length === 0) return { extracted: 0, details: [] };

  // [M3] Group by task with resource limits to prevent OOM on large tables
  const MAX_TASK_GROUPS = 500;
  const MAX_OBS_PER_TASK = 100;
  const taskGroups = {};
  let taskCount = 0;

  for (const obs of candidates) {
    const taskId = obs.context_task_id;
    if (!taskGroups[taskId]) {
      if (taskCount >= MAX_TASK_GROUPS) break;
      taskGroups[taskId] = [];
      taskCount++;
    }
    if (taskGroups[taskId].length < MAX_OBS_PER_TASK) {
      taskGroups[taskId].push(obs);
    }
  }

  // [L2] Sensitive data patterns to filter from promoted facts
  const SENSITIVE_RE = /api[_-]?key|password|secret|token|bearer|authorization/i;
  const containsSensitive = (text) => text && SENSITIVE_RE.test(text);

  const extracted = [];

  for (const [taskId, observations] of Object.entries(taskGroups)) {
    // [C1] Wrap each task extraction in try-catch for resilience
    try {
      if (observations.length === 0) continue;

      const toolChain = observations.map(o => o.tool_name);
      const uniqueTools = [...new Set(toolChain)];

      const solutionContext = {
        taskId,
        toolsUsed: uniqueTools,
        stepCount: observations.length,
        observationIds: observations.map(o => o.id),
        timestamp: observations[0].timestamp
      };

      // Build the fact text from the most informative observations
      // (Edit and Bash observations carry the most solution value)
      const keyObs = observations.filter(o =>
        ['Edit', 'Write', 'Bash', 'Task', 'NotebookEdit'].includes(o.tool_name)
      );

      // [L2] Filter out observations containing sensitive data
      const summaryParts = (keyObs.length > 0 ? keyObs : observations.slice(0, 5))
        .filter(o => !containsSensitive(o.input_summary) && !containsSensitive(o.output_summary))
        .map(o => `${o.tool_name}: ${o.input_summary || ''}${o.output_summary ? ' → ' + o.output_summary : ''}`)
        .slice(0, 8);

      if (summaryParts.length === 0) continue; // all observations were sensitive

      const factText = `[Solution for ${taskId}] ${summaryParts.join('; ')}`;

      // [H1] Dedup check using parameterized json_extract instead of LIKE interpolation
      const existingResult = db.exec(
        `SELECT id FROM facts WHERE category = 'solution' AND json_extract(source_context, '$.taskId') = ?`,
        [taskId]
      );
      if (queryToRows(existingResult).length > 0) continue;

      // [C1] Handle null/failing embeddings gracefully
      const factId = generateId('fact');
      const embedding = await getEmbedding(factText);

      if (!embedding) continue; // skip if embeddings unavailable

      db.run(`
        INSERT INTO facts (id, fact, category, scope, model, embedding, source_context, relevance_score)
        VALUES (?, ?, 'solution', 'local', NULL, ?, ?, 0.7)
      `, [factId, factText, embeddingToJson(embedding), JSON.stringify(solutionContext)]);

      extracted.push({ factId, taskId, toolsUsed: uniqueTools, stepCount: observations.length });
    } catch (err) {
      // Continue with next task instead of failing entire extraction
      if (process.env.DEBUG) {
        console.error(`[extractHighValueObservations] Failed for ${taskId}:`, err.message);
      }
    }
  }

  // Phase 2: Extract rejection patterns as facts
  const rejectionSql = `
    SELECT id, tool_name, input_summary, rejection_reason, timestamp, context_task_id
    FROM observations
    WHERE timestamp < datetime('now', '-' || ? || ' days')
      AND exploration_status = 'rejected'
      AND rejection_reason IS NOT NULL
      AND rejection_reason != ''
    ORDER BY timestamp ASC
  `;
  const rejResult = db.exec(rejectionSql, [safeRetentionDays]);
  const rejCandidates = queryToRows(rejResult);

  const rejectionPatterns = [];
  // Group by task for dedup
  const rejTaskGroups = {};
  for (const obs of rejCandidates) {
    const taskId = obs.context_task_id || 'unknown';
    if (!rejTaskGroups[taskId]) rejTaskGroups[taskId] = [];
    if (rejTaskGroups[taskId].length < 10) rejTaskGroups[taskId].push(obs);
  }

  for (const [taskId, observations] of Object.entries(rejTaskGroups)) {
    try {
      // Dedup check
      const existingResult = db.exec(
        `SELECT id FROM facts WHERE category = 'rejection-pattern' AND json_extract(source_context, '$.taskId') = ?`,
        [taskId]
      );
      if (queryToRows(existingResult).length > 0) continue;

      const summaryParts = observations
        .filter(o => !SENSITIVE_RE.test(o.rejection_reason || '') && !SENSITIVE_RE.test(o.input_summary || ''))
        .map(o => `${o.tool_name}: ${o.input_summary || ''} — rejected: ${(o.rejection_reason || '').slice(0, 200)}`)
        .slice(0, 5);

      if (summaryParts.length === 0) continue;

      const factText = `[Rejected approach for ${taskId}] ${summaryParts.join('; ')}`;
      const factId = generateId('fact');
      const embedding = await getEmbedding(factText);
      if (!embedding) continue;

      const rejContext = {
        taskId,
        rejectedTools: [...new Set(observations.map(o => o.tool_name))],
        rejectionCount: observations.length,
        observationIds: observations.map(o => o.id),
        timestamp: observations[0].timestamp
      };

      db.run(`
        INSERT INTO facts (id, fact, category, scope, model, embedding, source_context, relevance_score)
        VALUES (?, ?, 'rejection-pattern', 'local', NULL, ?, ?, 0.8)
      `, [factId, factText, embeddingToJson(embedding), JSON.stringify(rejContext)]);

      rejectionPatterns.push({ factId, taskId, count: observations.length });
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[extractHighValueObservations] Rejection pattern for ${taskId}:`, err.message);
      }
    }
  }

  if (extracted.length > 0 || rejectionPatterns.length > 0) saveDatabase();

  return { extracted: extracted.length, details: extracted, rejectionPatterns: rejectionPatterns.length };
}

/**
 * Purge old observations based on retention policy.
 * Calls extractHighValueObservations first to preserve solution knowledge.
 * @param {number} retentionDays - Days to retain (default: 30)
 * @param {Object} extractConfig - Config for extraction (passed to extractHighValueObservations)
 * @returns {Object} - { purged: number, extracted: number }
 */
async function purgeOldObservations(retentionDays = 30, extractConfig = {}) {
  await initDatabase();

  // Extract high-value observations before purging
  const extractResult = await extractHighValueObservations({
    retentionDays,
    ...extractConfig
  });

  db.run(`
    DELETE FROM observations
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `, [retentionDays]);

  const purged = db.getRowsModified();
  saveDatabase();

  return { purged, extracted: extractResult.extracted };
}

/**
 * Update exploration status and rejection reason for an observation
 * @param {string} id - Observation ID
 * @param {string} status - Exploration status ('rejected', 'committed', 'exploring', or null)
 * @param {string} [reason] - Rejection reason (optional, only used with 'rejected' status)
 * @returns {Object} - { updated: boolean }
 */
async function updateObservationStatus(id, status, reason) {
  await initDatabase();

  if (!id || typeof id !== 'string') return { updated: false };

  const validStatuses = ['rejected', 'committed', 'exploring', null];
  if (!validStatuses.includes(status)) return { updated: false };

  db.run(`
    UPDATE observations
    SET exploration_status = ?, rejection_reason = ?
    WHERE id = ?
  `, [status, reason || null, id]);

  const updated = db.getRowsModified() > 0;
  if (updated) saveDatabase();

  return { updated };
}

/**
 * Update all non-rejected observations for a task to 'committed'
 * @param {string} taskId - Task ID
 * @returns {Object} - { committed: number }
 */
async function markTaskObservationsCommitted(taskId) {
  await initDatabase();

  if (!taskId || typeof taskId !== 'string') return { committed: 0 };

  db.run(`
    UPDATE observations
    SET exploration_status = 'committed'
    WHERE context_task_id = ?
      AND (exploration_status IS NULL OR exploration_status != 'rejected')
  `, [taskId]);

  const committed = db.getRowsModified();
  if (committed > 0) saveDatabase();

  return { committed };
}

/**
 * Search for rejected observations, optionally filtered by task or file
 * @param {Object} options - { taskId, filePath, since, limit }
 * @returns {Object[]} - Rejected observation records
 */
async function searchRejectedObservations(options = {}) {
  await initDatabase();
  const { taskId, filePath, since, limit = 20 } = options;

  let sql = `SELECT id, tool_name, input_summary, rejection_reason, timestamp, context_task_id
             FROM observations WHERE exploration_status = 'rejected'`;
  const params = [];

  if (taskId) {
    sql += ' AND context_task_id = ?';
    params.push(taskId);
  }

  if (filePath) {
    sql += ' AND input_summary LIKE ?';
    params.push(`%${filePath}%`);
  }

  if (since) {
    sql += ' AND timestamp >= ?';
    params.push(since);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(sql, params);
  return queryToRows(result).map(obs => ({
    id: obs.id,
    toolName: obs.tool_name,
    inputSummary: obs.input_summary,
    rejectionReason: obs.rejection_reason,
    timestamp: obs.timestamp,
    contextTaskId: obs.context_task_id
  }));
}

// ============================================================
// Section Index Operations (Smart Context System)
// ============================================================

/**
 * Sync sections from section-index.json to database
 * @param {Object} index - Section index object from flow-section-index.js
 * @returns {Object} - { synced, updated, unchanged }
 */
async function syncSectionsFromIndex(index) {
  await initDatabase();
  const results = { synced: 0, updated: 0, unchanged: 0, deleted: 0 };

  if (!index || !index.sources) {
    return results;
  }

  // Collect all section IDs from index
  const indexSectionIds = new Set();

  for (const [sourceName, sourceData] of Object.entries(index.sources)) {
    const items = sourceData.sections || sourceData.rows || [];

    for (const item of items) {
      indexSectionIds.add(item.id);

      // Check if section exists
      const existing = db.exec('SELECT content_hash FROM sections WHERE id = ?', [item.id]);
      const existingRows = queryToRows(existing);

      if (existingRows.length === 0) {
        // Insert new section
        db.run(`
          INSERT INTO sections (id, source, category, title, pins, content, line_start, line_end, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          item.id,
          sourceName,
          item.category || null,
          item.title || item.name,
          JSON.stringify(item.pins || []),
          item.content || JSON.stringify(item.data || {}),
          item.lineStart || item.line || null,
          item.lineEnd || item.line || null,
          item.contentHash || null
        ]);
        results.synced++;
      } else if (existingRows[0].content_hash !== item.contentHash) {
        // Update existing section if content changed
        db.run(`
          UPDATE sections SET
            category = ?, title = ?, pins = ?, content = ?,
            line_start = ?, line_end = ?, content_hash = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `, [
          item.category || null,
          item.title || item.name,
          JSON.stringify(item.pins || []),
          item.content || JSON.stringify(item.data || {}),
          item.lineStart || item.line || null,
          item.lineEnd || item.line || null,
          item.contentHash || null,
          item.id
        ]);
        results.updated++;
      } else {
        results.unchanged++;
      }
    }
  }

  // Remove sections that are no longer in the index
  const existingResult = db.exec('SELECT id FROM sections');
  const existingIds = queryToRows(existingResult).map(r => r.id);

  for (const existingId of existingIds) {
    if (!indexSectionIds.has(existingId)) {
      db.run('DELETE FROM sections WHERE id = ?', [existingId]);
      results.deleted++;
    }
  }

  saveDatabase();
  return results;
}

/**
 * Search sections by pins (keyword matching)
 * @param {string[]} pins - Pins to match
 * @param {Object} options - { limit, trackAccess }
 * @returns {Object[]} - Matching sections with match scores
 */
async function searchSectionsByPins(pins, options = {}) {
  await initDatabase();
  const { limit = 20, trackAccess = true } = options;

  const result = db.exec('SELECT * FROM sections');
  const sections = queryToRows(result);

  if (sections.length === 0) return [];

  const pinsLower = pins.map(p => p.toLowerCase());

  // Score each section by pin matches
  const scored = sections.map(section => {
    const sectionPins = safeParsePins(section.pins).map(p => p.toLowerCase());
    const matchCount = pinsLower.filter(p => sectionPins.includes(p)).length;
    const matchScore = pinsLower.length > 0 ? matchCount / pinsLower.length : 0;

    return {
      ...section,
      pins: safeParsePins(section.pins),
      matchCount,
      matchScore
    };
  });

  // Filter and sort
  const matches = scored
    .filter(s => s.matchCount > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  // Track access
  if (trackAccess && matches.length > 0) {
    const ids = matches.map(m => m.id);
    db.run(`
      UPDATE sections SET
        access_count = access_count + 1,
        last_accessed = datetime('now')
      WHERE id IN (${ids.map(() => '?').join(',')})
    `, ids);
    saveDatabase();
  }

  return matches;
}

/**
 * Search sections by semantic similarity (with embedding)
 * Falls back to text search if embeddings unavailable
 * @param {string} query - Search query
 * @param {Object} options - { limit, category, trackAccess }
 * @returns {Object[]} - Matching sections with similarity scores
 */
async function searchSectionsBySimilarity(query, options = {}) {
  await initDatabase();
  const { limit = 10, category = null, trackAccess = true } = options;

  const queryEmbedding = await getEmbedding(query);

  let sql = 'SELECT * FROM sections WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  const result = db.exec(sql, params);
  const sections = queryToRows(result);

  if (sections.length === 0) return [];

  let scored;
  if (queryEmbedding) {
    // Semantic search with embeddings
    scored = sections.map(section => {
      const embedding = section.embedding ? jsonToEmbedding(section.embedding) : [];
      const similarity = embedding.length > 0 ? cosineSimilarity(queryEmbedding, embedding) : 0;
      return { ...section, pins: safeParsePins(section.pins), similarity };
    });
  } else {
    // Fallback: text matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    scored = sections.map(section => {
      const contentLower = (section.content + ' ' + section.title).toLowerCase();
      const matches = queryWords.filter(w => contentLower.includes(w)).length;
      const similarity = queryWords.length > 0 ? matches / queryWords.length : 0;
      return { ...section, pins: safeParsePins(section.pins), similarity };
    });
  }

  // Sort and limit
  const matches = scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Track access
  if (trackAccess && matches.length > 0) {
    const ids = matches.filter(m => m.similarity > 0.1).map(m => m.id);
    if (ids.length > 0) {
      db.run(`
        UPDATE sections SET
          access_count = access_count + 1,
          last_accessed = datetime('now')
        WHERE id IN (${ids.map(() => '?').join(',')})
      `, ids);
      saveDatabase();
    }
  }

  return matches;
}

/**
 * Get section by ID
 * @param {string} sectionId - Section ID
 * @param {boolean} trackAccess - Whether to track access
 * @returns {Object|null} - Section object or null
 */
async function getSectionById(sectionId, trackAccess = true) {
  await initDatabase();

  const result = db.exec('SELECT * FROM sections WHERE id = ?', [sectionId]);
  const rows = queryToRows(result);

  if (rows.length === 0) return null;

  const section = rows[0];
  section.pins = safeParsePins(section.pins);

  // Track access
  if (trackAccess) {
    db.run(`
      UPDATE sections SET
        access_count = access_count + 1,
        last_accessed = datetime('now')
      WHERE id = ?
    `, [sectionId]);
    saveDatabase();
  }

  return section;
}

/**
 * Get all sections from a source
 * @param {string} source - Source file name (e.g., "decisions.md")
 * @returns {Object[]} - All sections from that source
 */
async function getSectionsBySource(source) {
  await initDatabase();

  const result = db.exec('SELECT * FROM sections WHERE source = ? ORDER BY line_start', [source]);
  const sections = queryToRows(result);

  return sections.map(s => ({
    ...s,
    pins: safeParsePins(s.pins)
  }));
}

/**
 * Get section statistics
 * @returns {Object} - Stats about sections
 */
async function getSectionStats() {
  await initDatabase();

  return {
    total: dbCount('SELECT COUNT(*) FROM sections'),
    bySource: dbGrouped('SELECT source, COUNT(*) FROM sections GROUP BY source'),
    byCategory: dbGrouped('SELECT category, COUNT(*) FROM sections GROUP BY category'),
    neverAccessed: dbCount('SELECT COUNT(*) FROM sections WHERE access_count = 0'),
    topAccessed: queryToRows(db.exec(`
      SELECT id, title, source, access_count
      FROM sections
      WHERE access_count > 0
      ORDER BY access_count DESC
      LIMIT 5
    `))
  };
}

/**
 * Generate embeddings for sections that don't have them
 * @returns {Object} - { generated, skipped, failed }
 */
async function generateSectionEmbeddings() {
  await initDatabase();
  const results = { generated: 0, skipped: 0, failed: 0 };

  const result = db.exec('SELECT id, content, title FROM sections WHERE embedding IS NULL');
  const sections = queryToRows(result);

  for (const section of sections) {
    try {
      const text = `${section.title}\n${section.content}`;
      const embedding = await getEmbedding(text);

      if (embedding) {
        db.run('UPDATE sections SET embedding = ? WHERE id = ?', [embeddingToJson(embedding), section.id]);
        results.generated++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.failed++;
    }
  }

  saveDatabase();
  return results;
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

  // Sections (Smart Context System)
  syncSectionsFromIndex,
  searchSectionsByPins,
  searchSectionsBySimilarity,
  getSectionById,
  getSectionsBySource,
  getSectionStats,
  generateSectionEmbeddings,

  // Request Log (v9.0)
  addRequestLogEntry,
  searchRequestLog,
  getRequestLogEntry,
  getRequestLogStats,

  // Observations (v10.0 - Automatic Tool Capture)
  storeObservation,
  searchObservationsCompact,
  getObservationsByIds,
  getTimelineContext,
  getRecentObservations,
  getObservationStats,
  extractHighValueObservations,
  purgeOldObservations,
  updateObservationStatus,
  markTaskObservationsCommitted,
  searchRejectedObservations,

  // Paths
  DB_PATH,
  MEMORY_DIR
};
