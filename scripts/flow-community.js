'use strict';

/**
 * Wogi Flow - Community Knowledge Module
 *
 * Anonymous, privacy-first knowledge sharing across WogiFlow users.
 * Handles: push/pull community knowledge, PII stripping, data collection,
 * anonymous ID management, suggestion submission, and local caching.
 *
 * Uses ONLY Node.js built-in modules — no external dependencies.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const { PATHS, safeJsonParse, safeJsonParseString } = require('./flow-utils');

// ~/.wogiflow/ directory for user-level state (persists across projects)
const WOGIFLOW_HOME = path.join(os.homedir(), '.wogiflow');
const ANON_ID_PATH = path.join(WOGIFLOW_HOME, 'anon-id');
const COMMUNITY_CACHE_PATH = path.join(WOGIFLOW_HOME, 'community-cache.json');
const PENDING_SUGGESTIONS_PATH = path.join(WOGIFLOW_HOME, 'pending-suggestions.json');
const LAST_PUSH_PATH = path.join(WOGIFLOW_HOME, 'last-community-push');
const CONSENT_PATH = path.join(WOGIFLOW_HOME, 'consent-acknowledged');

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 512 * 1024; // 512KB max response size

// ──────────────────────────────────────────────
// Anonymous ID
// ──────────────────────────────────────────────

/**
 * Get or create anonymous UUID for this user.
 * Stored in ~/.wogiflow/anon-id (persists across projects).
 * Never regenerated once created.
 * @returns {string} UUID v4
 */
function getOrCreateAnonId() {
  try {
    // Ensure ~/.wogiflow/ exists
    if (!fs.existsSync(WOGIFLOW_HOME)) {
      fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
    }

    // Reuse existing ID
    if (fs.existsSync(ANON_ID_PATH)) {
      const existing = fs.readFileSync(ANON_ID_PATH, 'utf-8').trim();
      if (existing && existing.length >= 32) {
        return existing;
      }
    }

    // Generate new UUID v4
    const id = crypto.randomUUID();
    fs.writeFileSync(ANON_ID_PATH, id, 'utf-8');
    return id;
  } catch (err) {
    // Fallback: in-memory only (won't persist)
    if (process.env.DEBUG) {
      console.error(`[flow-community] Failed to manage anon ID: ${err.message}`);
    }
    return crypto.randomUUID();
  }
}

/**
 * Check if consent has been acknowledged.
 * @returns {boolean}
 */
function isConsentAcknowledged() {
  try {
    return fs.existsSync(CONSENT_PATH);
  } catch {
    return false;
  }
}

/**
 * Mark consent as acknowledged.
 */
function acknowledgeConsent() {
  try {
    if (!fs.existsSync(WOGIFLOW_HOME)) {
      fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
    }
    fs.writeFileSync(CONSENT_PATH, new Date().toISOString(), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Failed to store consent: ${err.message}`);
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

What is NEVER shared:
  - Your code, file paths, or project names
  - Task descriptions or acceptance criteria
  - Personal information of any kind

Per-category controls available in config.json → community.categories
Enabling community in config.json IS your consent.
`.trim();
}

// ──────────────────────────────────────────────
// PII Stripping
// ──────────────────────────────────────────────

/**
 * Strip PII from any data before it leaves the machine.
 *
 * Replaces:
 * - Absolute file paths → [PATH]
 * - Project name → [PROJECT]
 * - Email addresses → [EMAIL]
 * - Git usernames → [USER]
 * - Home directory paths → [PATH]
 *
 * @param {*} data - Any data structure (string, object, array)
 * @param {Object} config - WogiFlow config (needs projectName)
 * @returns {*} Sanitized data
 */
function stripPII(data, config) {
  if (data === null || data === undefined) return data;

  const projectName = config?.projectName || '';
  const homeDir = os.homedir();

  // Get git user info for stripping
  let gitUser = '';
  let gitEmail = '';
  try {
    gitUser = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8', timeout: 2000 }).trim();
    gitEmail = execFileSync('git', ['config', 'user.email'], { encoding: 'utf-8', timeout: 2000 }).trim();
  } catch {
    // Git not available or no config — that's fine
  }

  function stripString(str) {
    if (typeof str !== 'string') return str;

    let result = str;

    // Replace absolute paths (Unix and Windows)
    result = result.replace(/(?:\/(?:Users|home|var|tmp|opt|etc|usr|root|app|srv|run|mnt|media|proc|data)\/[^\s,;:'")\]}>]+)/g, '[PATH]');
    result = result.replace(/(?:[A-Z]:\\[^\s,;:'")\]}>]+)/gi, '[PATH]');

    // Replace home directory references
    if (homeDir) {
      result = result.replace(new RegExp(escapeRegex(homeDir), 'g'), '[PATH]');
    }

    // Replace project name (case-insensitive, word boundary)
    if (projectName && projectName.length > 2) {
      result = result.replace(new RegExp(`\\b${escapeRegex(projectName)}\\b`, 'gi'), '[PROJECT]');
    }

    // Replace email patterns
    result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

    // Replace git user/email
    if (gitUser && gitUser.length > 1) {
      result = result.replace(new RegExp(escapeRegex(gitUser), 'g'), '[USER]');
    }
    if (gitEmail && gitEmail.length > 3) {
      result = result.replace(new RegExp(escapeRegex(gitEmail), 'g'), '[EMAIL]');
    }

    return result;
  }

  function stripRecursive(obj) {
    if (typeof obj === 'string') return stripString(obj);
    if (Array.isArray(obj)) return obj.map(stripRecursive);
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const key of Object.keys(obj)) {
        result[key] = stripRecursive(obj[key]);
      }
      return result;
    }
    return obj;
  }

  return stripRecursive(data);
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ──────────────────────────────────────────────
// Data Collection
// ──────────────────────────────────────────────

/**
 * Collect shareable data from local WogiFlow state.
 * Respects per-category toggles in config.community.categories.
 * Returns anonymized, PII-stripped payload ready for push.
 *
 * @param {Object} config - WogiFlow config
 * @returns {Object} Anonymized payload
 */
function collectShareableData(config) {
  const community = config.community || {};
  const categories = community.categories || {};
  const payload = {
    anonId: getOrCreateAnonId(),
    wogiflowVersion: getWogiFlowVersion(),
    timestamp: new Date().toISOString(),
    data: {}
  };

  // Model Intelligence
  if (categories.modelIntelligence !== false) {
    payload.data.modelIntelligence = collectModelIntelligence();
  }

  // Error Recovery
  if (categories.errorRecovery !== false) {
    payload.data.errorRecovery = collectErrorRecovery();
  }

  // Pattern Convergence
  if (categories.patternConvergence !== false) {
    payload.data.patternConvergence = collectPatternConvergence();
  }

  // Session Statistics
  if (categories.sessionStatistics !== false) {
    payload.data.sessionStatistics = collectSessionStatistics();
  }

  // Skill Learnings
  if (categories.skillLearnings !== false) {
    payload.data.skillLearnings = collectSkillLearnings();
  }

  // Strip PII from entire payload
  return stripPII(payload, config);
}

/**
 * Get WogiFlow version from package.json.
 * @returns {string}
 */
let _cachedVersion = null;
function getWogiFlowVersion() {
  if (_cachedVersion) return _cachedVersion;
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = safeJsonParse(pkgPath, {});
    _cachedVersion = pkg.version || 'unknown';
    return _cachedVersion;
  } catch {
    _cachedVersion = 'unknown';
    return _cachedVersion;
  }
}

/**
 * Collect model intelligence from model-adapters.
 * @returns {Array}
 */
function collectModelIntelligence() {
  const items = [];
  try {
    const adaptersDir = PATHS.modelAdapters;
    if (!fs.existsSync(adaptersDir)) return items;

    const files = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.md'));
    for (const file of files.slice(0, 10)) {
      try {
        const content = fs.readFileSync(path.join(adaptersDir, file), 'utf-8');
        // Extract model name from filename (e.g., "claude-sonnet-4.md" → "claude-sonnet-4")
        const modelName = file.replace(/\.md$/, '');

        // Extract strengths/weaknesses/adjustments (look for markdown sections)
        const strengths = extractSection(content, 'strength');
        const weaknesses = extractSection(content, 'weakness');
        const adjustments = extractSection(content, 'adjustment');

        if (strengths || weaknesses || adjustments) {
          items.push({
            model: modelName,
            strengths: strengths || null,
            weaknesses: weaknesses || null,
            adjustments: adjustments || null
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Model adapters dir may not exist
  }
  return items;
}

/**
 * Extract a section from markdown content by keyword.
 * @param {string} content
 * @param {string} keyword
 * @returns {string|null}
 */
function extractSection(content, keyword) {
  const regex = new RegExp(`##?\\s*${keyword}[s]?\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
  const match = content.match(regex);
  if (match && match[1]) {
    const text = match[1].trim();
    // Truncate to 500 chars to limit payload size
    return text.length > 500 ? text.slice(0, 500) + '...' : text;
  }
  return null;
}

/**
 * Collect error recovery strategies.
 * @returns {Array}
 */
function collectErrorRecovery() {
  const items = [];
  try {
    // Check adaptive-learning.json
    const adaptivePath = path.join(PATHS.state, 'adaptive-learning.json');
    if (fs.existsSync(adaptivePath)) {
      const data = safeJsonParse(adaptivePath, {});
      const strategies = data.strategies || data.errorStrategies || [];
      for (const strategy of (Array.isArray(strategies) ? strategies : []).slice(0, 20)) {
        if (strategy.category && strategy.strategy) {
          items.push({
            category: strategy.category,
            strategy: strategy.strategy,
            successRate: strategy.successRate || null
          });
        }
      }
    }

    // Check failure-learnings directory
    const failurePath = path.join(PATHS.workflow, 'failure-learnings');
    if (fs.existsSync(failurePath)) {
      const files = fs.readdirSync(failurePath).filter(f => f.endsWith('.json')).slice(0, 10);
      for (const file of files) {
        try {
          const data = safeJsonParse(path.join(failurePath, file), null);
          if (data && data.errorType && data.resolution) {
            items.push({
              category: data.errorType,
              strategy: data.resolution,
              successRate: data.successRate || null
            });
          }
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Non-critical
  }
  return items;
}

/**
 * Collect universal pattern convergence data.
 * @returns {Array}
 */
function collectPatternConvergence() {
  const items = [];
  try {
    // From feedback-patterns.md — extract universal patterns (not project-specific)
    const patternsPath = PATHS.feedbackPatterns;
    if (fs.existsSync(patternsPath)) {
      const content = fs.readFileSync(patternsPath, 'utf-8');
      // Parse markdown table rows: | date | pattern-name | description | count | status |
      const rows = content.match(/\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|/g) || [];
      for (const row of rows.slice(0, 20)) {
        const cols = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 4 && cols[1] && cols[2]) {
          // Only include patterns with 2+ occurrences (universal signals)
          const count = parseInt(cols[3], 10);
          if (count >= 2) {
            items.push({
              pattern: cols[1],
              description: cols[2],
              occurrences: count
            });
          }
        }
      }
    }
  } catch {
    // Non-critical
  }
  return items;
}

/**
 * Collect aggregated session statistics (no individual data).
 * @returns {Object}
 */
function collectSessionStatistics() {
  const stats = {};
  try {
    const metricsPath = PATHS.commandMetrics;
    if (fs.existsSync(metricsPath)) {
      const data = safeJsonParse(metricsPath, {});
      // Only share aggregated counts, not individual commands
      stats.totalCommands = data.totalCommands || 0;
      stats.topCommands = {};
      if (data.commands && typeof data.commands === 'object') {
        // Top 5 most-used command names (no arguments or details)
        const sorted = Object.entries(data.commands)
          .map(([cmd, info]) => [cmd, typeof info === 'number' ? info : (info.count || 0)])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        for (const [cmd, count] of sorted) {
          stats.topCommands[cmd] = count;
        }
      }
    }

    // Model usage stats
    const modelStatsPath = PATHS.modelStats;
    if (fs.existsSync(modelStatsPath)) {
      const data = safeJsonParse(modelStatsPath, {});
      if (data.models && typeof data.models === 'object') {
        stats.modelUsage = {};
        for (const [model, info] of Object.entries(data.models)) {
          stats.modelUsage[model] = typeof info === 'number' ? info : (info.sessions || info.count || 0);
        }
      }
    }
  } catch {
    // Non-critical
  }
  return stats;
}

/**
 * Collect skill learnings from skill knowledge directories.
 * @returns {Array}
 */
function collectSkillLearnings() {
  const items = [];
  try {
    const skillsDir = PATHS.skills;
    if (!fs.existsSync(skillsDir)) return items;

    const skillNames = fs.readdirSync(skillsDir).filter(d => {
      try {
        return fs.statSync(path.join(skillsDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const skillName of skillNames.slice(0, 10)) {
      const knowledgeDir = path.join(skillsDir, skillName, 'knowledge');
      if (!fs.existsSync(knowledgeDir)) continue;

      const knowledgeFiles = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md')).slice(0, 5);
      for (const file of knowledgeFiles) {
        try {
          const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
          // Truncate to 300 chars
          const truncated = content.length > 300 ? content.slice(0, 300) + '...' : content;
          items.push({
            skill: skillName,
            type: file.replace(/\.md$/, ''),
            content: truncated
          });
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Non-critical
  }
  return items;
}

// ──────────────────────────────────────────────
// HTTP Helpers
// ──────────────────────────────────────────────

/**
 * Validate server URL to prevent SSRF attacks.
 * Enforces HTTPS-only and blocks private/internal addresses.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isAllowedServerUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // Enforce HTTPS only
    if (url.protocol !== 'https:') return false;
    // Block localhost and loopback
    // URL.hostname returns IPv6 with bracket delimiters (e.g., '[::1]') — strip them
    const rawHostname = url.hostname.toLowerCase();
    const hostname = rawHostname.startsWith('[') ? rawHostname.slice(1, -1) : rawHostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    // Block IPv6 private/loopback ranges
    if (hostname.startsWith('::ffff:')) return false;      // IPv4-mapped IPv6
    if (hostname.startsWith('fe80:') || hostname.startsWith('fe80::')) return false;  // Link-local
    if (hostname.startsWith('fc00:') || hostname.startsWith('fd00:')) return false;   // Unique local (RFC 4193)
    // Block private IP ranges (RFC-1918 + link-local)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
    if (ipMatch) {
      const a = parseInt(ipMatch[1], 10);
      const b = parseInt(ipMatch[2], 10);
      if (a === 10) return false;                          // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false;  // 172.16.0.0/12
      if (a === 192 && b === 168) return false;            // 192.168.0.0/16
      if (a === 169 && b === 254) return false;            // 169.254.0.0/16 (link-local)
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Make an HTTPS request with timeout. Fire-and-forget pattern.
 * @param {string} method - HTTP method
 * @param {string} urlStr - Full URL
 * @param {Object|null} body - JSON body (null for GET)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<{statusCode: number, body: string}|null>}
 */
function httpRequest(method, urlStr, body = null, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      if (!isAllowedServerUrl(urlStr)) {
        if (process.env.DEBUG) {
          console.error(`[flow-community] Blocked request to disallowed URL: ${urlStr}`);
        }
        resolve(null);
        return;
      }

      const url = new URL(urlStr);
      // isAllowedServerUrl already enforces HTTPS — use https directly
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'User-Agent': `WogiFlow/${getWogiFlowVersion()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: timeoutMs
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          // Check size BEFORE appending to prevent single oversized chunk from buffering
          if (data.length + chunk.length > MAX_RESPONSE_BYTES) {
            req.destroy();
            resolve(null);
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: data });
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    } catch {
      resolve(null);
    }
  });
}

// ──────────────────────────────────────────────
// Push / Pull
// ──────────────────────────────────────────────

/**
 * Push community data to server. Fire-and-forget with timeout.
 * @param {Object} payload - Anonymized, PII-stripped payload
 * @param {Object} config - WogiFlow config
 * @returns {Promise<boolean>} true if push succeeded
 */
async function pushToServer(payload, config) {
  const community = config.community || {};
  const serverUrl = community.serverUrl || 'https://api.wogiflow.com';

  try {
    const result = await httpRequest('POST', `${serverUrl}/api/community/contribute`, payload);

    if (result && result.statusCode >= 200 && result.statusCode < 300) {
      // Update last push timestamp
      try {
        if (!fs.existsSync(WOGIFLOW_HOME)) {
          fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
        }
        fs.writeFileSync(LAST_PUSH_PATH, new Date().toISOString(), 'utf-8');
      } catch {
        // Non-critical
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Pull community knowledge from server.
 * Uses cache if fresh (< cacheTtlHours).
 * @param {Object} config - WogiFlow config
 * @returns {Promise<Object|null>} Community knowledge or null
 */
async function pullFromServer(config) {
  const community = config.community || {};
  const serverUrl = community.serverUrl || 'https://api.wogiflow.com';
  const cacheTtlHours = community.cacheTtlHours || 24;

  // Check cache first
  const cached = loadCommunityCache();
  if (cached && cached._cachedAt) {
    const cacheAge = Date.now() - new Date(cached._cachedAt).getTime();
    const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;
    if (cacheAge < cacheTtlMs) {
      return cached;
    }
  }

  // Determine lastSync timestamp
  let lastSync = '1970-01-01T00:00:00.000Z';
  if (cached && cached._cachedAt) {
    lastSync = cached._cachedAt;
  }

  try {
    const encodedSince = encodeURIComponent(lastSync);
    const result = await httpRequest('GET', `${serverUrl}/api/community/knowledge?since=${encodedSince}`);

    if (result && result.statusCode >= 200 && result.statusCode < 300) {
      try {
        const knowledge = safeJsonParseString(result.body);
        if (!knowledge || typeof knowledge !== 'object') return cached || null;
        knowledge._cachedAt = new Date().toISOString();
        saveCommunityCache(knowledge);
        return knowledge;
      } catch {
        return cached || null;
      }
    }

    // Server unreachable — use stale cache
    return cached || null;
  } catch {
    return cached || null;
  }
}

// ──────────────────────────────────────────────
// Suggestions
// ──────────────────────────────────────────────

/**
 * Submit a suggestion to the community server.
 * If offline, queues to pending-suggestions.json.
 *
 * @param {string} text - Suggestion text
 * @param {string} type - idea|bug|improvement (default: idea)
 * @param {Object} config - WogiFlow config
 * @returns {Promise<boolean>} true if submitted (or queued)
 */
async function submitSuggestion(text, type, config) {
  if (!text || !text.trim()) return false;

  const community = config.community || {};
  const serverUrl = community.serverUrl || 'https://api.wogiflow.com';
  const validTypes = ['idea', 'bug', 'improvement'];
  const suggestionType = validTypes.includes(type) ? type : 'idea';

  // Strip PII from suggestion text before sending
  const strippedText = stripPII(text.trim(), config);

  const suggestion = {
    anonId: getOrCreateAnonId(),
    type: suggestionType,
    content: typeof strippedText === 'string' ? strippedText : text.trim(),
    wogiflowVersion: getWogiFlowVersion(),
    submittedAt: new Date().toISOString()
  };

  try {
    const result = await httpRequest('POST', `${serverUrl}/api/community/suggest`, suggestion);

    if (result && result.statusCode >= 200 && result.statusCode < 300) {
      return true;
    }

    // Server unreachable — queue for retry
    queuePendingSuggestion(suggestion);
    return true; // Queued counts as success from user perspective
  } catch {
    queuePendingSuggestion(suggestion);
    return true;
  }
}

/**
 * Queue a suggestion for later retry.
 * @param {Object} suggestion
 */
function queuePendingSuggestion(suggestion) {
  try {
    if (!fs.existsSync(WOGIFLOW_HOME)) {
      fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
    }

    let pending = [];
    if (fs.existsSync(PENDING_SUGGESTIONS_PATH)) {
      try {
        const content = fs.readFileSync(PENDING_SUGGESTIONS_PATH, 'utf-8');
        const parsed = safeJsonParseString(content, []);
        if (Array.isArray(parsed)) {
          pending = parsed;
        }
      } catch {
        // Corrupt file — start fresh
      }
    }

    // Cap at 50 pending suggestions
    if (pending.length >= 50) {
      pending = pending.slice(-49);
    }

    pending.push(suggestion);
    fs.writeFileSync(PENDING_SUGGESTIONS_PATH, JSON.stringify(pending, null, 2), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Failed to queue suggestion: ${err.message}`);
    }
  }
}

/**
 * Retry pending suggestions from queue.
 * Called during session-start hook.
 * @param {Object} config - WogiFlow config
 * @returns {Promise<void>}
 */
async function retryPendingSuggestions(config) {
  try {
    if (!fs.existsSync(PENDING_SUGGESTIONS_PATH)) return;

    const content = fs.readFileSync(PENDING_SUGGESTIONS_PATH, 'utf-8');
    let pending;
    try {
      pending = safeJsonParseString(content, null);
    } catch {
      return;
    }

    if (!Array.isArray(pending) || pending.length === 0) return;

    const community = config.community || {};
    const serverUrl = community.serverUrl || 'https://api.wogiflow.com';
    const stillPending = [];

    for (const suggestion of pending) {
      try {
        const result = await httpRequest('POST', `${serverUrl}/api/community/suggest`, suggestion);
        if (!result || result.statusCode < 200 || result.statusCode >= 300) {
          stillPending.push(suggestion);
        }
        // Successfully sent — don't re-add
      } catch {
        stillPending.push(suggestion);
      }
    }

    if (stillPending.length === 0) {
      // All sent — remove the file
      try { fs.unlinkSync(PENDING_SUGGESTIONS_PATH); } catch { /* ignore */ }
    } else {
      fs.writeFileSync(PENDING_SUGGESTIONS_PATH, JSON.stringify(stillPending, null, 2), 'utf-8');
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Failed to retry suggestions: ${err.message}`);
    }
  }
}

// ──────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────

/**
 * Load community cache from ~/.wogiflow/community-cache.json.
 * @returns {Object|null}
 */
function loadCommunityCache() {
  try {
    if (!fs.existsSync(COMMUNITY_CACHE_PATH)) return null;
    const content = fs.readFileSync(COMMUNITY_CACHE_PATH, 'utf-8');
    return safeJsonParseString(content, null);
  } catch {
    return null;
  }
}

/**
 * Save community cache to ~/.wogiflow/community-cache.json.
 * @param {Object} data
 */
function saveCommunityCache(data) {
  try {
    if (!fs.existsSync(WOGIFLOW_HOME)) {
      fs.mkdirSync(WOGIFLOW_HOME, { recursive: true });
    }
    fs.writeFileSync(COMMUNITY_CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Failed to save cache: ${err.message}`);
    }
  }
}

// ──────────────────────────────────────────────
// Community Knowledge Merge (Phase C2)
// ──────────────────────────────────────────────

const COMMUNITY_MARKER = '<!-- community-knowledge-v1 -->';

/**
 * Merge pulled community knowledge into local state files.
 * Idempotent — safe to call multiple times with the same data.
 *
 * @param {Object} knowledge - Pulled community knowledge from server/cache
 * @param {Object} config - WogiFlow config
 * @returns {{ modelIntelligence: number, errorStrategies: number, patterns: number }} Merge counts
 */
function mergeCommunityKnowledge(knowledge, config) {
  const counts = { modelIntelligence: 0, errorStrategies: 0, patterns: 0 };
  if (!knowledge || typeof knowledge !== 'object') return counts;

  try {
    if (Array.isArray(knowledge.modelIntelligence)) {
      counts.modelIntelligence = mergeModelIntelligence(knowledge.modelIntelligence);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Model intelligence merge failed: ${err.message}`);
    }
  }

  try {
    if (Array.isArray(knowledge.errorStrategies)) {
      counts.errorStrategies = mergeErrorStrategies(knowledge.errorStrategies);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Error strategies merge failed: ${err.message}`);
    }
  }

  try {
    if (Array.isArray(knowledge.patterns)) {
      counts.patterns = mergePatterns(knowledge.patterns);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-community] Patterns merge failed: ${err.message}`);
    }
  }

  return counts;
}

/**
 * Merge community model intelligence into local model adapter files.
 * Only updates files that already exist — never creates new adapter files.
 *
 * @param {Array} items - Model intelligence entries [{model, strengths, weaknesses, adjustments}]
 * @returns {number} Number of entries merged
 */
function mergeModelIntelligence(items) {
  let merged = 0;
  const adaptersDir = PATHS.modelAdapters;

  try {
    if (!fs.existsSync(adaptersDir)) return 0;
  } catch {
    return 0;
  }

  for (const item of items.slice(0, 20)) {
    if (!item.model) continue;

    // Normalize model name to kebab-case filename
    const modelFile = item.model.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
    const filePath = path.join(adaptersDir, `${modelFile}.md`);

    try {
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const detail = (item.adjustments || item.strengths || item.weaknesses || '').slice(0, 500);
      if (!detail) continue;

      // Check if community section already exists
      if (content.includes(COMMUNITY_MARKER)) {
        // Scope dedup check to community section only (not full file)
        const markerIndex = content.indexOf(COMMUNITY_MARKER);
        const communitySection = content.slice(markerIndex);
        if (communitySection.includes(detail)) {
          continue; // Already merged
        }
        // Append at END of community section (next ## heading or EOF) for chronological order
        const afterMarker = content.slice(markerIndex);
        const nextHeadingMatch = afterMarker.match(/\n## /);
        const insertPoint = nextHeadingMatch
          ? markerIndex + nextHeadingMatch.index
          : content.length;
        const newLine = `- ${detail}\n`;
        const updated = content.slice(0, insertPoint) + newLine + content.slice(insertPoint);
        fs.writeFileSync(filePath, updated, 'utf-8');
        merged++;
      } else {
        // Add new community section at end of file
        const section = `\n\n## Community Learnings\n${COMMUNITY_MARKER}\n- ${detail}\n`;
        fs.writeFileSync(filePath, content.trimEnd() + section, 'utf-8');
        merged++;
      }
    } catch {
      // Skip individual file failures
    }
  }

  return merged;
}

/**
 * Merge community error strategies into local adaptive-learning.json.
 * Deduplicates by category+strategy pair.
 *
 * @param {Array} items - Error strategy entries [{category, strategy, successRate}]
 * @returns {number} Number of entries merged
 */
function mergeErrorStrategies(items) {
  const filePath = path.join(PATHS.state, 'adaptive-learning.json');
  let data = {};

  try {
    if (fs.existsSync(filePath)) {
      data = safeJsonParse(filePath, {});
    }
  } catch {
    data = {};
  }

  if (!data.communityStrategies) {
    data.communityStrategies = [];
  }

  // Build dedup set from existing community strategies
  const existing = new Set(
    data.communityStrategies.map(s => `${(s.category || '').toLowerCase()}::${(s.strategy || '').toLowerCase()}`)
  );

  let merged = 0;
  for (const item of items.slice(0, 50)) {
    if (!item.category || !item.strategy) continue;

    const key = `${item.category.toLowerCase()}::${item.strategy.toLowerCase()}`;
    if (existing.has(key)) continue;

    data.communityStrategies.push({
      category: item.category,
      strategy: item.strategy,
      successRate: item.successRate || null,
      source: 'community',
      mergedAt: new Date().toISOString()
    });
    existing.add(key);
    merged++;
  }

  if (merged > 0) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[flow-community] Failed to write adaptive-learning.json: ${err.message}`);
      }
    }
  }

  return merged;
}

/**
 * Merge community patterns into local feedback-patterns.md.
 * Adds with "community-" prefix and "Informational" status.
 * Deduplicates by checking for existing community entries with same pattern name.
 *
 * @param {Array} items - Pattern entries [{pattern, description, occurrences}]
 * @returns {number} Number of entries merged
 */
function mergePatterns(items) {
  const filePath = PATHS.feedbackPatterns;

  let content = '';
  try {
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      return 0; // Don't create the file if it doesn't exist
    }
  } catch {
    return 0;
  }

  let merged = 0;
  const today = new Date().toISOString().split('T')[0];
  const newRows = [];

  for (const item of items.slice(0, 20)) {
    if (!item.description) continue;

    const patternName = item.pattern
      ? `community-${item.pattern}`
      : `community-${item.description.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    // Check if this community pattern already exists
    if (content.includes(patternName)) continue;

    const description = item.description.slice(0, 500).replace(/\|/g, '/'); // Escape pipes for table, cap length
    const occurrences = item.occurrences || 1;
    newRows.push(`| ${today} | ${patternName} | Community: ${description} | ${occurrences} | Informational |`);
    merged++;
  }

  if (newRows.length > 0) {
    // Find the end of the Patterns Log table to insert before pending patterns
    const tableEnd = content.indexOf('\n\n### ');
    if (tableEnd !== -1) {
      const updated = content.slice(0, tableEnd) + '\n' + newRows.join('\n') + content.slice(tableEnd);
      try {
        fs.writeFileSync(filePath, updated, 'utf-8');
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[flow-community] Failed to write feedback-patterns.md: ${err.message}`);
        }
      }
    } else {
      // Append at end
      try {
        fs.writeFileSync(filePath, content.trimEnd() + '\n' + newRows.join('\n') + '\n', 'utf-8');
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[flow-community] Failed to write feedback-patterns.md: ${err.message}`);
        }
      }
    }
  }

  return merged;
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  collectShareableData,
  stripPII,
  pushToServer,
  pullFromServer,
  mergeCommunityKnowledge,
  getOrCreateAnonId,
  submitSuggestion,
  retryPendingSuggestions,
  loadCommunityCache,
  saveCommunityCache,
  isConsentAcknowledged,
  acknowledgeConsent,
  getConsentMessage,
  // Exposed for testing
  WOGIFLOW_HOME,
  COMMUNITY_CACHE_PATH,
  PENDING_SUGGESTIONS_PATH
};
