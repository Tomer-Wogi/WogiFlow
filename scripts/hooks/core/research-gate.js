#!/usr/bin/env node

/**
 * Wogi Flow - Research Gate (Core Module)
 *
 * CLI-agnostic research gating logic.
 * Detects questions that require research verification before answering.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../flow-utils');
const {
  checkResearchGate,
  isResearchEnabled: _isResearchEnabled,
  getResearchConfig,
  CONFIDENCE,
  DEPTHS
} = require('../../flow-research-protocol');

/**
 * Check if research gate should block or warn for a prompt
 *
 * @param {Object} options
 * @param {string} options.prompt - User's input prompt
 * @param {string} [options.source] - Source of prompt (manual, paste, etc.)
 * @returns {Object} Result: { allowed, blocked, message, reason, questionType, suggestedDepth }
 */
function checkResearchRequirement(options = {}) {
  const { prompt } = options;

  // Empty or invalid prompt - allow
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'empty_prompt'
    };
  }

  // CRITICAL: Snapshot config ONCE at the start to avoid race conditions
  // Multiple reads could return different values if config file changes mid-execution
  let config;
  try {
    config = getResearchConfig();
    if (!config || typeof config !== 'object') {
      // Invalid config - graceful degradation
      return {
        allowed: true,
        blocked: false,
        message: null,
        reason: 'config_error'
      };
    }
  } catch (err) {
    // Config load failed - graceful degradation
    if (process.env.DEBUG) {
      console.error(`[Research Gate] Config load failed: ${err.message}`);
    }
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'config_error'
    };
  }

  // Check if research is enabled using cached config
  if (!config.enabled) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'research_disabled'
    };
  }

  // Check the research gate
  const gateResult = checkResearchGate(prompt);

  if (!gateResult.required) {
    // Not required, but may have a suggestion
    if (gateResult.message) {
      return {
        allowed: true,
        blocked: false,
        warning: true,
        message: gateResult.message,
        reason: 'research_suggested',
        questionType: gateResult.type,
        suggestedDepth: gateResult.depth
      };
    }

    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'no_research_needed'
    };
  }

  // Research is required - inject protocol steps (don't block)
  // Use already-cached config (no additional read)

  // Generate the research protocol instructions to inject
  const protocolSteps = generateResearchProtocolSteps(prompt, gateResult.type, gateResult.depth);

  if (config.strictMode) {
    // Strict mode: Allow but inject mandatory research protocol
    return {
      allowed: true,
      blocked: false,
      researchRequired: true,
      injectProtocol: true,
      protocolSteps,
      message: `Research protocol auto-triggered for ${gateResult.type} question.`,
      reason: 'research_auto_triggered',
      questionType: gateResult.type,
      suggestedDepth: gateResult.depth
    };
  }

  // Warn mode: Allow with optional research suggestion
  return {
    allowed: true,
    blocked: false,
    warning: true,
    message: gateResult.message,
    reason: 'research_recommended',
    questionType: gateResult.type,
    suggestedDepth: gateResult.depth,
    suggestedCommand: generateResearchCommand(prompt, gateResult.depth)
  };
}

/**
 * Generate the suggested research command
 * @param {string} prompt - The user's question
 * @param {string} depth - Suggested depth
 * @returns {string}
 */
function generateResearchCommand(prompt, depth) {
  const truncated = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
  // Escape in correct order: backslashes first, then quotes, then control chars
  const escaped = truncated
    .replace(/\\/g, '\\\\')    // Escape backslashes first
    .replace(/"/g, '\\"')      // Then quotes
    .replace(/\n/g, ' ')       // Replace newlines with space (cleaner for command)
    .replace(/\r/g, '')        // Remove carriage returns
    .replace(/\t/g, ' ');      // Replace tabs with space

  if (depth === DEPTHS.STANDARD) {
    return `/wogi-research "${escaped}"`;
  }
  return `/wogi-research --${depth} "${escaped}"`;
}

/**
 * Generate research protocol steps to inject into AI context
 * @param {string} question - The user's question
 * @param {string} type - Question type (capability, feasibility, existence, comparison, etc.)
 * @param {string} depth - Research depth
 * @returns {string} Protocol steps as markdown
 */
function generateResearchProtocolSteps(question, type, depth) {
  const depthLimits = {
    [DEPTHS.QUICK]: { files: 3, urls: 1, desc: 'Quick verification' },
    [DEPTHS.STANDARD]: { files: 10, urls: 3, desc: 'Standard research' },
    [DEPTHS.DEEP]: { files: 25, urls: 5, desc: 'Deep investigation' },
    [DEPTHS.EXHAUSTIVE]: { files: 50, urls: 10, desc: 'Exhaustive audit' }
  };

  const limits = depthLimits[depth] || depthLimits[DEPTHS.STANDARD];

  // For comparison questions, use the external-first flow
  if (type === 'comparison') {
    return generateComparisonProtocolSteps(question, depth, limits);
  }

  // Standard research flow for other question types
  return `## Research Protocol Auto-Triggered

**Question Type**: ${type}
**Depth**: ${depth} (${limits.desc})
**Limits**: Up to ${limits.files} files, ${limits.urls} web searches

### BEFORE ANSWERING, YOU MUST:

**Phase 1: Scope Mapping**
- Identify all relevant local files (use Glob/Grep)
- Identify external tools/libraries mentioned
- List documentation sources to check

**Phase 2: Local Evidence Gathering**
- Read ALL relevant files in scope (don't skim)
- Extract specific quotes that support or refute claims
- Note file paths and line numbers

**Phase 3: External Verification**
- For external tools: Web search "[tool] [feature] documentation ${new Date().getFullYear()}"
- Read official docs, not just training data
- Extract quotes with URLs

**Phase 4: Assumption Check**
- List assumptions you're making
- Mark each: [VERIFIED] with source or [UNVERIFIED]
- Go back to Phase 2/3 for unverified items

**Phase 5: Synthesis**
- Only now answer the question
- Cite sources for each claim
- State confidence level (HIGH/MEDIUM/LOW)
- Acknowledge what you couldn't verify

**Phase 6: Recommendation Verification (if making recommendations)**
For ANY recommendation ("We should add X", "Consider implementing Y"):
Use this EXACT format:

\`\`\`
### Verification: [recommendation title]
- **Searched**: [Glob/Grep commands used]
- **Files checked**: [list of files read]
- **Status**: EXISTS | PARTIAL | MISSING
- **Evidence**: [quote from code] or "Not found after searching X, Y, Z"
\`\`\`

If Status = EXISTS → Do NOT recommend (acknowledge it exists)
If Status = PARTIAL → Recommend enhancement only
If Status = MISSING → Safe to recommend

### FORBIDDEN:
- Claiming "X doesn't exist" without exhaustive search
- Using training data for external tool capabilities
- Skipping verification steps
- Making recommendations without verification block

Proceed with research now.`;
}

/**
 * Generate protocol steps for external comparison research
 * Key difference: External research happens FIRST (Phase 0)
 * @param {string} question - The user's question
 * @param {string} depth - Research depth
 * @param {Object} limits - Depth limits
 * @returns {string} Protocol steps as markdown
 */
function generateComparisonProtocolSteps(question, depth, limits) {
  return `## Research Protocol Auto-Triggered (COMPARISON MODE)

**Question Type**: comparison (external-first flow)
**Depth**: ${depth} (${limits.desc})
**Limits**: Up to ${limits.files} files, ${limits.urls} web searches

### CRITICAL: For comparison research, do EXTERNAL research FIRST

You're comparing an external tool/project to the local codebase.
You must understand what the EXTERNAL thing has BEFORE you can search locally.

### BEFORE ANSWERING, YOU MUST:

**Phase 0: External Research (DO THIS FIRST)**
- Web search the external tool/repository
- Read their documentation, README, source code
- List the features, patterns, or approaches they have
- Extract specific capabilities with evidence
- **OUTPUT**: A clear list of "External tool X has: [features]"

**Phase 1: Scope Mapping (informed by Phase 0)**
- For EACH feature found in Phase 0:
  - Identify local files that might have equivalent functionality
  - Use search patterns based on what you learned externally
- Generate targeted search queries

**Phase 2: Local Evidence Gathering**
- For EACH external feature, search the local codebase
- Read ALL potentially relevant local files
- Note specific implementations with file paths and line numbers

**Phase 4: Assumption Check**
- List assumptions you're making
- Mark each: [VERIFIED] with source or [UNVERIFIED]
- Go back to verify any unverified items

**Phase 5: Synthesis**
- Generate comparison table: External Feature | Local Equivalent | Status
- Cite sources for each claim
- State confidence level (HIGH/MEDIUM/LOW)

**Phase 6: Recommendation Verification (MANDATORY)**
Before presenting ANY recommendation ("We should add X"):
- FIRST: Search local codebase for equivalent (Glob/Grep)
- SECOND: Read at least one potentially relevant file
- THIRD: Use this EXACT verification format for EACH recommendation:

\`\`\`
### Verification: [recommendation title]
- **Searched**: [Glob/Grep commands used]
- **Files checked**: [list of files read]
- **Status**: EXISTS | PARTIAL | MISSING
- **Evidence**: [quote from code] or "Not found after searching X, Y, Z"
\`\`\`

**CRITICAL RULES:**
- If Status = **EXISTS** → DO NOT RECOMMEND (acknowledge it exists instead)
- If Status = **PARTIAL** → Recommend enhancement, cite what exists
- If Status = **MISSING** → Safe to recommend as new feature
- Recommendations WITHOUT this verification block are INVALID
- **ONLY recommend features marked MISSING or PARTIAL**

### FORBIDDEN:
- Starting with local research before understanding the external tool
- Recommending features without verifying they don't already exist
- Claiming local codebase lacks something without exhaustive search
- Skipping Phase 6 verification for ANY recommendation

Proceed with Phase 0 (external research) now.`;
}

/**
 * Check if a prompt contains claims that need verification
 * This is for post-response validation, not blocking
 *
 * @param {string} response - The AI's response
 * @returns {Object} Result with claims that need verification
 */
function detectUnverifiedClaims(response) {
  if (!response || typeof response !== 'string') {
    return { hasClaims: false, claims: [] };
  }

  const claimPatterns = [
    // Capability claims
    /(?:it|this|that)\s+(does\s*n['o]t|doesn't|cannot|can't)\s+(?:support|have|allow|work)/gi,
    /(?:is|are)\s+(not\s+supported|unavailable|impossible)/gi,

    // Existence claims (bounded to prevent ReDoS)
    /there\s+(?:is|are)\s+no\s+[\w\s]{1,50}(?:for|to|in)/gi,
    /(?:it|this)\s+does\s*n['o]t\s+exist/gi,

    // Certainty claims without citation (already bounded)
    /(?:definitely|certainly|always|never)\s+[\w\s]{5,30}/gi,

    // Version-specific claims (often stale)
    /(?:as\s+of|since|in)\s+(?:version|v\.?)\s*[\d.]{1,20}/gi
  ];

  const claims = [];
  for (const pattern of claimPatterns) {
    const matches = response.match(pattern);
    if (matches) {
      claims.push(...matches.map(m => ({
        text: m.trim(),
        needsVerification: true,
        confidence: CONFIDENCE.LOW
      })));
    }
  }

  // Deduplicate
  const seen = new Set();
  const uniqueClaims = claims.filter(c => {
    const key = c.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    hasClaims: uniqueClaims.length > 0,
    claims: uniqueClaims.slice(0, 10) // Limit to 10 claims
  };
}

/**
 * Format verification warning for detected claims
 * @param {Object[]} claims - Claims that need verification
 * @returns {string} Warning message
 */
function formatClaimWarning(claims) {
  if (!claims || claims.length === 0) return '';

  const lines = [
    '**Unverified claims detected:**',
    ''
  ];

  for (const claim of claims.slice(0, 5)) {
    lines.push(`- "${claim.text}"`);
  }

  if (claims.length > 5) {
    lines.push(`- ... and ${claims.length - 5} more`);
  }

  lines.push('');
  lines.push('Consider verifying with `/wogi-research` before accepting these claims.');

  return lines.join('\n');
}

// ============================================================
// Research Cache
// ============================================================

/**
 * Get the research cache file path
 * @returns {string}
 */
function getCachePath() {
  const config = getResearchConfig();
  const cachePath = config.cache?.path || '.workflow/state/research-cache.json';
  return path.isAbsolute(cachePath) ? cachePath : path.join(PATHS.root, cachePath);
}

/**
 * Read the research cache
 * @returns {Object} Cache object with entries keyed by normalized query
 */
function readCache() {
  const cachePath = getCachePath();
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Research Cache] Read failed: ${err.message}`);
    }
  }
  return { entries: {}, lastCleanup: null };
}

/**
 * Write to the research cache
 * @param {Object} cache - Cache object to write
 */
function writeCache(cache) {
  const cachePath = getCachePath();
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Research Cache] Write failed: ${err.message}`);
    }
  }
}

/**
 * Normalize a query for cache key lookup
 * @param {string} query - Raw query string
 * @returns {string} Normalized key
 */
function normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Look up a query in the research cache
 * @param {string} query - The research query
 * @returns {Object|null} Cached result or null if not found / expired
 */
function lookupCache(query) {
  const config = getResearchConfig();
  if (!config.cache?.enabled) return null;

  const cache = readCache();
  const key = normalizeQuery(query);
  const entry = cache.entries[key];

  if (!entry) return null;

  const ttlMs = (config.cache.ttlHours || 24) * 60 * 60 * 1000;
  const age = Date.now() - new Date(entry.cachedAt).getTime();

  if (age > ttlMs) {
    // Expired - remove entry
    delete cache.entries[key];
    writeCache(cache);
    return null;
  }

  return entry;
}

/**
 * Store a research result in the cache
 * @param {string} query - The research query
 * @param {Object} result - The research result to cache
 */
function cacheResult(query, result) {
  const config = getResearchConfig();
  if (!config.cache?.enabled) return;

  const cache = readCache();
  const key = normalizeQuery(query);
  const maxEntries = config.cache.maxEntries || 200;

  // Evict oldest entries if at capacity
  const keys = Object.keys(cache.entries);
  if (keys.length >= maxEntries) {
    const sorted = keys.sort((a, b) =>
      new Date(cache.entries[a].cachedAt) - new Date(cache.entries[b].cachedAt)
    );
    const toEvict = sorted.slice(0, keys.length - maxEntries + 1);
    for (const k of toEvict) {
      delete cache.entries[k];
    }
  }

  cache.entries[key] = {
    query: query.slice(0, 200),
    result,
    cachedAt: new Date().toISOString()
  };

  writeCache(cache);
}

/**
 * Check if research is mandatory for current context
 * @param {string} context - 'explore_phase', 'history', or 'general'
 * @returns {boolean}
 */
function isResearchMandatory(context) {
  const config = getResearchConfig();
  if (context === 'explore_phase') {
    return config.mandatoryInExplorePhase !== false;
  }
  if (context === 'history') {
    return config.mandatoryForHistoryResearch !== false;
  }
  return false;
}

module.exports = {
  checkResearchRequirement,
  generateResearchCommand,
  generateResearchProtocolSteps,
  detectUnverifiedClaims,
  formatClaimWarning,
  lookupCache,
  cacheResult,
  isResearchMandatory,
  normalizeQuery
};
