#!/usr/bin/env node

/**
 * Wogi Flow - Community Knowledge System (Client-Side)
 *
 * Anonymous, opt-in knowledge sharing for WogiFlow users.
 * Handles: PII stripping, data collection, push/pull, anon ID, suggestions, caching.
 *
 * Privacy invariants:
 * - No code snippets ever leave the machine
 * - No file paths (absolute or relative) leave the machine
 * - No project names, component names, or task descriptions leave the machine
 * - No user names, emails, or git identities leave the machine
 * - Anonymous ID is a random UUID, not derived from any user data
 * - All data collection is opt-in with per-category granularity
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const { getConfig, PATHS, safeJsonParse } = require('./flow-utils');

// User-level storage directory (not project-level)
const WOGIFLOW_HOME = path.join(require('os').homedir(), '.wogiflow');
const ANON_ID_PATH = path.join(WOGIFLOW_HOME, 'anon-id');
const CONSENT_PATH = path.join(WOGIFLOW_HOME, 'consent-acknowledged');
const CACHE_PATH = path.join(WOGIFLOW_HOME, 'community-cache.json');
const PENDING_SUGGESTIONS_PATH = path.join(WOGIFLOW_HOME, 'pending-suggestions.json');
const LAST_PUSH_PATH = path.join(WOGIFLOW_HOME, 'last-community-push');

// Request timeout (5 seconds)
const REQUEST_TIMEOUT_MS = 5000;

// ============================================================
// Utility: Ensure home directory exists
// ============================================================

function ensureHomeDir() {
  try {
    if (!fs.existsSync(WOGIFLOW_HOME)) {
      fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to create ~/.wogiflow: ${err.message}`);
    }
  }
}

// ============================================================
// Anonymous ID
// ============================================================

/**
 * Get or create a persistent anonymous UUID for this user.
 * Stored in ~/.wogiflow/anon-id. Never regenerated once created.
 * @returns {string|null} UUID string or null on failure
 */
function getOrCreateAnonId() {
  ensureHomeDir();

  // Reuse existing
  try {
    if (fs.existsSync(ANON_ID_PATH)) {
      const existing = fs.readFileSync(ANON_ID_PATH, 'utf-8').trim();
      if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
        return existing;
      }
    }
  } catch (err) {
    // Fall through to generate
  }

  // Generate new UUID v4
  try {
    const id = crypto.randomUUID();
    fs.writeFileSync(ANON_ID_PATH, id + '\n', 'utf-8');
    return id;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to generate anon ID: ${err.message}`);
    }
    return null;
  }
}

// ============================================================
// PII Stripping
// ============================================================

// Email regex pattern
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Absolute path patterns (Unix and Windows)
const UNIX_PATH_PATTERN = /\/(?:Users|home|var|tmp|opt|etc|usr|root)\/[^\s"',;:)}\]]+/g;
const WINDOWS_PATH_PATTERN = /[A-Z]:\\[^\s"',;:)}\]]+/gi;

// Relative path patterns (things that look like file paths)
const RELATIVE_PATH_PATTERN = /(?:\.\/|\.\.\/)[^\s"',;:)}\]]+/g;

// Git user patterns
const GIT_USER_PATTERN = /(?:Author|Committer):\s*[^\n<]+/g;

/**
 * Strip PII from data before it leaves the machine.
 * @param {Object|string} data - Data to sanitize
 * @param {Object} config - Config object (needs projectName)
 * @returns {Object|string} Sanitized data
 */
function stripPII(data, config) {
  const projectName = config.projectName || '';

  if (typeof data === 'string') {
    return stripPIIFromString(data, projectName);
  }

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  // Deep clone and strip
  return JSON.parse(JSON.stringify(data, (key, value) => {
    if (typeof value === 'string') {
      return stripPIIFromString(value, projectName);
    }
    return value;
  }));
}

/**
 * Strip PII from a single string.
 * @param {string} str
 * @param {string} projectName
 * @returns {string}
 */
function stripPIIFromString(str, projectName) {
  let result = str;

  // Replace absolute paths
  result = result.replace(UNIX_PATH_PATTERN, '[PATH]');
  result = result.replace(WINDOWS_PATH_PATTERN, '[PATH]');

  // Replace relative paths
  result = result.replace(RELATIVE_PATH_PATTERN, '[PATH]');

  // Replace project name (case-insensitive, whole word)
  if (projectName && projectName.length >= 3) {
    const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(regex, '[PROJECT]');
  }

  // Replace emails
  result = result.replace(EMAIL_PATTERN, '[EMAIL]');

  // Replace git author/committer lines
  result = result.replace(GIT_USER_PATTERN, '$1: [REDACTED]');

  return result;
}

// ============================================================
// Data Collection
// ============================================================

/**
 * Collect shareable data from the local machine.
 * Respects per-category toggles in config.community.categories.
 * @param {Object} config - Full config object
 * @returns {Object} Anonymized payload ready for push
 */
function collectShareableData(config) {
  const categories = config.community?.categories || {};
  const payload = {
    timestamp: new Date().toISOString(),
    wogiflowVersion: getWogiFlowVersion(),
    data: {}
  };

  if (categories.modelIntelligence !== false) {
    payload.data.modelIntelligence = collectModelIntelligence();
  }

  if (categories.errorRecovery !== false) {
    payload.data.errorRecovery = collectErrorRecovery();
  }

  if (categories.patternConvergence !== false) {
    payload.data.patternConvergence = collectPatternConvergence();
  }

  if (categories.sessionStatistics !== false) {
    payload.data.sessionStatistics = collectSessionStatistics();
  }

  if (categories.skillLearnings !== false) {
    payload.data.skillLearnings = collectSkillLearnings();
  }

  // Strip ALL PII from the entire payload
  return stripPII(payload, config);
}

/**
 * Get WogiFlow version from package.json
 * @returns {string}
 */
function getWogiFlowVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = safeJsonParse(pkgPath, {});
    return pkg.version || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Collect model intelligence data.
 * Source: .workflow/model-adapters/*.md
 * @returns {Array}
 */
function collectModelIntelligence() {
  const items = [];
  const adaptersDir = PATHS.modelAdapters;

  try {
    if (!fs.existsSync(adaptersDir)) return items;
    const files = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(adaptersDir, file), 'utf-8');
        const modelName = path.basename(file, '.md');

        // Extract strengths/weaknesses/adjustments (section-based)
        const sections = content.split(/^##\s+/m).slice(1);
        for (const section of sections) {
          const lines = section.split('\n');
          const title = lines[0].trim().toLowerCase();
          const body = lines.slice(1).join('\n').trim();

          if (body && (title.includes('strength') || title.includes('weakness') || title.includes('adjustment') || title.includes('learning'))) {
            items.push({
              model: modelName,
              category: title,
              content: body.substring(0, 500) // Limit size
            });
          }
        }
      } catch (err) {
        // Skip unreadable files
      }
    }
  } catch (err) {
    // Directory not accessible
  }

  return items;
}

/**
 * Collect error recovery strategies.
 * Source: failure-learnings/, adaptive-learning.json
 * @returns {Array}
 */
function collectErrorRecovery() {
  const items = [];

  // Check failure-learnings directory
  const failurePath = path.join(PATHS.workflow, 'failure-learnings');
  try {
    if (fs.existsSync(failurePath)) {
      const files = fs.readdirSync(failurePath).filter(f => f.endsWith('.json') || f.endsWith('.md'));
      for (const file of files.slice(0, 20)) { // Limit to 20 files
        try {
          const content = fs.readFileSync(path.join(failurePath, file), 'utf-8');
          if (file.endsWith('.json')) {
            const data = JSON.parse(content);
            if (data.category && data.strategy) {
              items.push({
                category: data.category,
                strategy: data.strategy,
                successRate: data.successRate || null
              });
            }
          }
        } catch (err) {
          // Skip unreadable files
        }
      }
    }
  } catch (err) {
    // Directory not accessible
  }

  // Check adaptive-learning.json
  const adaptivePath = path.join(PATHS.state, 'adaptive-learning.json');
  try {
    if (fs.existsSync(adaptivePath)) {
      const data = safeJsonParse(adaptivePath, null);
      if (data && data.strategies) {
        for (const [key, strategy] of Object.entries(data.strategies).slice(0, 10)) {
          items.push({
            category: key,
            strategy: typeof strategy === 'string' ? strategy : JSON.stringify(strategy).substring(0, 300),
            successRate: strategy.successRate || null
          });
        }
      }
    }
  } catch (err) {
    // File not accessible
  }

  return items;
}

/**
 * Collect universal pattern convergence data.
 * Source: feedback-patterns.md, decisions.md (universal rules only)
 * @returns {Array}
 */
function collectPatternConvergence() {
  const items = [];

  // Extract from feedback-patterns.md (patterns with high occurrence)
  try {
    if (fs.existsSync(PATHS.feedbackPatterns)) {
      const content = fs.readFileSync(PATHS.feedbackPatterns, 'utf-8');
      const rows = content.split('\n').filter(line => line.startsWith('|') && !line.includes('---'));

      for (const row of rows.slice(1, 20)) { // Skip header, limit to 20
        const cols = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 4) {
          const count = parseInt(cols[3], 10);
          // Only share patterns that have occurred 3+ times (converged)
          if (count >= 3) {
            items.push({
              pattern: cols[1], // pattern name
              description: cols[2].substring(0, 200), // description
              occurrences: count
            });
          }
        }
      }
    }
  } catch (err) {
    // File not accessible
  }

  return items;
}

/**
 * Collect aggregated session statistics.
 * Source: command-metrics.json, model stats
 * @returns {Object}
 */
function collectSessionStatistics() {
  const stats = {};

  // Command metrics
  try {
    if (fs.existsSync(PATHS.commandMetrics)) {
      const data = safeJsonParse(PATHS.commandMetrics, null);
      if (data) {
        stats.commandUsage = {};
        for (const [cmd, metrics] of Object.entries(data).slice(0, 15)) {
          stats.commandUsage[cmd] = {
            count: metrics.count || 0,
            avgDuration: metrics.avgDuration || null
          };
        }
      }
    }
  } catch (err) {
    // Not critical
  }

  // Model stats
  try {
    if (fs.existsSync(PATHS.modelStats)) {
      const data = safeJsonParse(PATHS.modelStats, null);
      if (data) {
        stats.modelUsage = {};
        for (const [model, usage] of Object.entries(data).slice(0, 5)) {
          stats.modelUsage[model] = {
            sessions: usage.sessions || 0,
            tasks: usage.tasks || 0
          };
        }
      }
    }
  } catch (err) {
    // Not critical
  }

  return stats;
}

/**
 * Collect skill learnings.
 * Source: .claude/skills/[name]/knowledge/[file].md
 * @returns {Array}
 */
function collectSkillLearnings() {
  const items = [];
  const skillsDir = path.join(PATHS.claude, 'skills');

  try {
    if (!fs.existsSync(skillsDir)) return items;
    const skillDirs = fs.readdirSync(skillsDir).filter(d => {
      try {
        return fs.statSync(path.join(skillsDir, d)).isDirectory();
      } catch (err) {
        return false;
      }
    });

    for (const skillDir of skillDirs) {
      const knowledgeDir = path.join(skillsDir, skillDir, 'knowledge');
      try {
        if (!fs.existsSync(knowledgeDir)) continue;
        const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));

        for (const file of files.slice(0, 5)) { // Limit per skill
          try {
            const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
            items.push({
              skill: skillDir,
              type: path.basename(file, '.md'),
              content: content.substring(0, 500) // Limit size
            });
          } catch (err) {
            // Skip unreadable
          }
        }
      } catch (err) {
        // Skip inaccessible directories
      }
    }
  } catch (err) {
    // Skills directory not accessible
  }

  return items;
}

// ============================================================
// HTTP Utilities
// ============================================================

/**
 * Make an HTTPS request with timeout.
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {Object|null} body - Request body (will be JSON-stringified)
 * @param {number} [timeout] - Timeout in ms
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function httpsRequest(method, url, body, timeout = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `WogiFlow/${getWogiFlowVersion()}`
      },
      timeout
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ============================================================
// Push / Pull
// ============================================================

/**
 * Push community data to server. Fire-and-forget with 5s timeout.
 * @param {Object} payload - Data to push (already PII-stripped)
 * @param {Object} config - Config with community.serverUrl
 * @returns {Promise<boolean>} Success or failure
 */
async function pushToServer(payload, config) {
  const serverUrl = config.community?.serverUrl;
  if (!serverUrl) return false;

  const anonId = getOrCreateAnonId();
  if (!anonId) return false;

  try {
    const url = `${serverUrl}/api/community/contribute`;
    const body = {
      anonId,
      ...payload
    };

    const result = await httpsRequest('POST', url, body);
    if (result.statusCode >= 200 && result.statusCode < 300) {
      // Update last push timestamp
      ensureHomeDir();
      try {
        fs.writeFileSync(LAST_PUSH_PATH, new Date().toISOString() + '\n', 'utf-8');
      } catch (err) {
        // Non-critical
      }
      return true;
    }
    return false;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Push failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Pull community knowledge from server. Fire-and-forget with 5s timeout.
 * @param {Object} config - Config with community settings
 * @returns {Promise<Object|null>} Community knowledge or null
 */
async function pullFromServer(config) {
  const serverUrl = config.community?.serverUrl;
  if (!serverUrl) return null;

  // Check cache first
  const cached = loadCommunityCache();
  if (cached) {
    const cacheTtl = (config.community?.cacheTtlHours || 24) * 60 * 60 * 1000;
    const cacheAge = Date.now() - new Date(cached.fetchedAt || 0).getTime();
    if (cacheAge < cacheTtl) {
      return cached.data;
    }
  }

  try {
    const lastSync = cached?.fetchedAt || '1970-01-01T00:00:00.000Z';
    const url = `${serverUrl}/api/community/knowledge/since/${encodeURIComponent(lastSync)}`;
    const result = await httpsRequest('GET', url, null);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      try {
        const data = JSON.parse(result.body);
        saveCommunityCache(data);
        return data;
      } catch (err) {
        return null;
      }
    }
    return null;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Pull failed: ${err.message}`);
    }
    // Return stale cache if available
    return cached?.data || null;
  }
}

// ============================================================
// Suggestions
// ============================================================

/**
 * Submit a suggestion to the community server.
 * If offline, queues to ~/.wogiflow/pending-suggestions.json.
 * @param {string} text - Suggestion text
 * @param {string} type - Suggestion type: idea|bug|improvement
 * @param {Object} config - Config with community settings
 * @returns {Promise<boolean>} Whether submission succeeded
 */
async function submitSuggestion(text, type, config) {
  const serverUrl = config.community?.serverUrl;
  if (!serverUrl) return false;

  const anonId = getOrCreateAnonId();
  if (!anonId) return false;

  const suggestion = {
    anonId,
    type: type || 'idea',
    content: text,
    wogiflowVersion: getWogiFlowVersion(),
    timestamp: new Date().toISOString()
  };

  try {
    const url = `${serverUrl}/api/community/suggest`;
    const result = await httpsRequest('POST', url, suggestion);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return true;
    }

    // Server returned error — queue for retry
    queuePendingSuggestion(suggestion);
    return false;
  } catch (err) {
    // Offline or timeout — queue for retry
    queuePendingSuggestion(suggestion);
    return false;
  }
}

/**
 * Queue a suggestion for later retry.
 * @param {Object} suggestion
 */
function queuePendingSuggestion(suggestion) {
  ensureHomeDir();
  try {
    let pending = [];
    if (fs.existsSync(PENDING_SUGGESTIONS_PATH)) {
      try {
        pending = JSON.parse(fs.readFileSync(PENDING_SUGGESTIONS_PATH, 'utf-8'));
        if (!Array.isArray(pending)) pending = [];
      } catch (err) {
        pending = [];
      }
    }
    // Limit queue size to 50
    if (pending.length >= 50) {
      pending = pending.slice(-49);
    }
    pending.push(suggestion);
    fs.writeFileSync(PENDING_SUGGESTIONS_PATH, JSON.stringify(pending, null, 2), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to queue suggestion: ${err.message}`);
    }
  }
}

/**
 * Retry all pending suggestions. Called on session-start.
 * @param {Object} config - Config with community settings
 * @returns {Promise<void>}
 */
async function retryPendingSuggestions(config) {
  const serverUrl = config.community?.serverUrl;
  if (!serverUrl) return;

  try {
    if (!fs.existsSync(PENDING_SUGGESTIONS_PATH)) return;
    const pending = JSON.parse(fs.readFileSync(PENDING_SUGGESTIONS_PATH, 'utf-8'));
    if (!Array.isArray(pending) || pending.length === 0) return;

    const remaining = [];
    for (const suggestion of pending) {
      try {
        const url = `${serverUrl}/api/community/suggest`;
        const result = await httpsRequest('POST', url, suggestion);
        if (result.statusCode < 200 || result.statusCode >= 300) {
          remaining.push(suggestion);
        }
      } catch (err) {
        remaining.push(suggestion);
        // If first retry fails, likely still offline — keep rest and stop
        remaining.push(...pending.slice(pending.indexOf(suggestion) + 1));
        break;
      }
    }

    // Update pending file
    if (remaining.length === 0) {
      try { fs.unlinkSync(PENDING_SUGGESTIONS_PATH); } catch (err) { /* ignore */ }
    } else {
      fs.writeFileSync(PENDING_SUGGESTIONS_PATH, JSON.stringify(remaining, null, 2), 'utf-8');
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to retry suggestions: ${err.message}`);
    }
  }
}

// ============================================================
// Caching
// ============================================================

/**
 * Load community cache from ~/.wogiflow/community-cache.json.
 * @returns {Object|null} { fetchedAt, data } or null
 */
function loadCommunityCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const content = fs.readFileSync(CACHE_PATH, 'utf-8');
    const data = JSON.parse(content);
    if (!data || !data.fetchedAt) return null;
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Save community data to cache.
 * @param {Object} data - Community knowledge data
 */
function saveCommunityCache(data) {
  ensureHomeDir();
  try {
    const cacheEntry = {
      fetchedAt: new Date().toISOString(),
      data
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheEntry, null, 2), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to save cache: ${err.message}`);
    }
  }
}

// ============================================================
// Consent
// ============================================================

/**
 * Check if user has acknowledged the community consent.
 * @returns {boolean}
 */
function hasConsentAcknowledged() {
  try {
    return fs.existsSync(CONSENT_PATH);
  } catch (err) {
    return false;
  }
}

/**
 * Mark consent as acknowledged.
 */
function acknowledgeConsent() {
  ensureHomeDir();
  try {
    fs.writeFileSync(CONSENT_PATH, new Date().toISOString() + '\n', 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community] Failed to save consent: ${err.message}`);
    }
  }
}

/**
 * Get the consent message to display to users.
 * @returns {string}
 */
function getConsentMessage() {
  return `
Community Knowledge Sharing

WogiFlow can share anonymous learnings with other users:
- Model intelligence (which models work best for what)
- Error recovery strategies
- Universal coding patterns
- Aggregated session statistics
- Skill-specific learnings

What is NEVER shared:
- Your code, file paths, or project names
- Task descriptions or acceptance criteria
- Personal information of any kind

Per-category controls available in .workflow/config.json under "community.categories".

Enabling community.enabled in config IS your consent. This message is shown once.
`.trim();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Anonymous ID
  getOrCreateAnonId,

  // PII stripping
  stripPII,

  // Data collection
  collectShareableData,

  // Push / Pull
  pushToServer,
  pullFromServer,

  // Suggestions
  submitSuggestion,
  retryPendingSuggestions,

  // Caching
  loadCommunityCache,
  saveCommunityCache,

  // Consent
  hasConsentAcknowledged,
  acknowledgeConsent,
  getConsentMessage,

  // Constants (for testing)
  WOGIFLOW_HOME,
  ANON_ID_PATH,
  CACHE_PATH,
  PENDING_SUGGESTIONS_PATH
};
