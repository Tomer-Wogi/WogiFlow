#!/usr/bin/env node

/**
 * Wogi Flow - Research Protocol
 *
 * CLI-agnostic core research logic that enforces rigorous information
 * gathering before AI agents make claims or answer questions.
 *
 * This module implements the Zero-Trust Research Protocol:
 *
 * For EXTERNAL COMPARISON research ("What can we learn from X?"):
 * - Phase 0: External Research - Understand what X has FIRST
 * - Phase 1: Scope Mapping - Identify local files to compare (informed by Phase 0)
 * - Phase 2: Local Evidence Gathering - Read local files for each external finding
 * - Phase 3: (skipped for comparison - already did external in Phase 0)
 * - Phase 4: Assumption Check - List and verify assumptions
 * - Phase 5: Synthesis - Generate research report with citations
 * - Phase 6: Recommendation Verification - Verify each recommendation doesn't already exist
 *
 * For STANDARD research (capability, existence, architecture questions):
 * - Phase 1: Scope Mapping - Identify all relevant files and sources
 * - Phase 2: Local Evidence Gathering - Read all files in scope
 * - Phase 3: External Verification - Web search for external tools
 * - Phase 4: Assumption Check - List and verify assumptions
 * - Phase 5: Synthesis - Generate research report with citations
 *
 * Phase 0 is critical for comparison research because you need to know what the
 * external tool HAS before you can search locally for equivalent features.
 */

const fs = require('fs');
const path = require('path');
const { getConfig, PATHS, safeJsonParse } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/** Maximum files to read per research session */
const MAX_FILES_PER_RESEARCH = 50;

/** Maximum URLs to fetch per research session */
const MAX_URLS_PER_RESEARCH = 10;

/** Maximum assumptions to track */
const MAX_ASSUMPTIONS = 20;

/** Random ID suffix length for uniqueness */
const RANDOM_ID_LENGTH = 6;

/** Maximum content length for evidence entries */
const MAX_CONTENT_LENGTH = 500;

/** Report generation limits */
const REPORT_LIMITS = {
  MAX_CLAIM_LENGTH: 50,
  MAX_SOURCE_LENGTH: 40,
  TRUNCATION_SUFFIX: '...'
};

/** Tech acronyms to preserve in keyword extraction (length <= 2) */
const TECH_ACRONYMS = new Set(['api', 'cli', 'sdk', 'ui', 'ux', 'go', 'js', 'ts', 'sql', 'jwt', 'ai', 'ml', 'db']);

/** Confidence levels */
const CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

/** Research depths */
const DEPTHS = {
  QUICK: 'quick',
  STANDARD: 'standard',
  DEEP: 'deep',
  EXHAUSTIVE: 'exhaustive'
};

/** Evidence source types */
const SOURCE_TYPES = {
  FILE_READ: 'file_read',
  WEB_SEARCH: 'web_search',
  LIVE_DOCS: 'live_docs',
  TRAINING_DATA: 'training_data',
  USER_PROVIDED: 'user_provided',
  CACHED_VERIFICATION: 'cached_verification'
};

/** Question type patterns for auto-trigger (bounded to prevent ReDoS) */
const QUESTION_PATTERNS = {
  feasibility: [
    /\bcan\s+(i|we|you|claude)\s+(do|use|implement|integrate)/i,
    /\bis\s+it\s+(possible|feasible)\s+to/i,
    /\bwould\s+it\s+work\s+if/i,
    /\bcan\s+[\w\s]{1,100}\s+support/i  // Bounded to prevent ReDoS
  ],
  capability: [
    /\bdoes\s+[\w\s]{1,100}\s+(support|have|allow|enable)/i,  // Bounded
    /\bcan\s+[\w\s]{1,100}\s+(do|handle|process)/i,  // Bounded
    /\bis\s+[\w\s]{1,100}\s+(supported|available|possible)/i,  // Bounded
    /\bwhat\s+(features?|capabilities?)\s+does/i
  ],
  existence: [
    /\bis\s+there\s+(a|any)/i,
    /\bdoes\s+[\w\s]{1,100}\s+exist/i,  // Bounded
    /\bwhere\s+(is|are|can\s+i\s+find)/i,
    /\bdo\s+(you|they)\s+have/i
  ],
  architecture: [
    /\bhow\s+(does|do|is|should)\s+[\w\s]{1,100}\s+(work|structured|designed|organized)/i,  // Bounded
    /\bwhat\s+is\s+the\s+(architecture|structure|design)/i,
    /\bhow\s+(to|should\s+i)\s+(architect|design|structure)/i
  ],
  integration: [
    /\bhow\s+(do|to)\s+(i|we)\s+(integrate|connect|hook|wire)/i,
    /\bcan\s+[\w\s]{1,100}\s+(integrate|work)\s+with/i,  // Bounded
    /\bhow\s+does\s+[\w\s]{1,100}\s+integrate/i  // Bounded
  ],
  comparison: [
    /\bwhat\s+can\s+(we|i)\s+learn\s+from/i,
    /\bwhat\s+does\s+[\w\s]{1,50}\s+do\s+(better|differently)/i,  // Bounded
    /\bhow\s+does\s+[\w\s]{1,50}\s+compare\s+to/i,  // Bounded
    /\bwhat\s+(features?|patterns?)\s+from\s+[\w\s]{1,50}\s+should/i,  // Bounded
    /\banything\s+(we|i)\s+can\s+(learn|adopt|borrow)\s+from/i,
    /\bwhat\s+(insights?|lessons?)\s+from\s+[\w\s]{1,50}/i  // Bounded
  ]
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get research configuration from config.json
 * @returns {Object} Research config with defaults
 */
function getResearchConfig() {
  const config = getConfig();
  const research = config.research || {};

  return {
    enabled: research.enabled !== false,
    defaultDepth: research.defaultDepth || DEPTHS.STANDARD,
    strictMode: research.strictMode !== false,
    autoTrigger: research.autoTrigger !== false,
    maxTokensPerDepth: research.maxTokensPerDepth || {
      [DEPTHS.QUICK]: 5000,
      [DEPTHS.STANDARD]: 20000,
      [DEPTHS.DEEP]: 50000,
      [DEPTHS.EXHAUSTIVE]: 100000
    },
    requireCitations: research.requireCitations !== false,
    cacheVerifications: research.cacheVerifications !== false,
    cacheExpiryHours: research.cacheExpiryHours || 24,
    triggers: research.triggers || {
      feasibilityQuestions: DEPTHS.DEEP,
      capabilityQuestions: DEPTHS.STANDARD,
      existenceQuestions: DEPTHS.STANDARD,
      architectureQuestions: DEPTHS.DEEP,
      integrationQuestions: DEPTHS.STANDARD,
      comparisonQuestions: DEPTHS.DEEP  // Comparison research needs thorough verification
    },
    budgetMode: research.budgetMode || 'soft',
    negativeEvidenceRule: research.negativeEvidenceRule !== false,
    assumptionTracking: research.assumptionTracking !== false
  };
}

/**
 * Check if research protocol is enabled
 * @returns {boolean}
 */
function isResearchEnabled() {
  return getResearchConfig().enabled;
}

// ============================================================
// Question Classification
// ============================================================

/**
 * Detect the type of question being asked
 * @param {string} question - The user's question
 * @returns {{type: string|null, confidence: string, suggestedDepth: string}}
 */
function classifyQuestion(question) {
  if (!question || typeof question !== 'string') {
    return { type: null, confidence: CONFIDENCE.LOW, suggestedDepth: DEPTHS.STANDARD };
  }

  const config = getResearchConfig();
  const triggers = config.triggers;

  for (const [type, patterns] of Object.entries(QUESTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(question)) {
        const triggerKey = `${type}Questions`;
        const suggestedDepth = triggers[triggerKey] || DEPTHS.STANDARD;
        return {
          type,
          confidence: CONFIDENCE.MEDIUM,
          suggestedDepth
        };
      }
    }
  }

  return { type: null, confidence: CONFIDENCE.LOW, suggestedDepth: DEPTHS.STANDARD };
}

/**
 * Check if a question should auto-trigger research
 * @param {string} question - The user's question
 * @returns {{shouldTrigger: boolean, type: string|null, depth: string}}
 */
function shouldAutoTrigger(question) {
  const config = getResearchConfig();

  if (!config.enabled || !config.autoTrigger) {
    return { shouldTrigger: false, type: null, depth: DEPTHS.STANDARD };
  }

  const classification = classifyQuestion(question);

  if (classification.type) {
    return {
      shouldTrigger: true,
      type: classification.type,
      depth: classification.suggestedDepth
    };
  }

  return { shouldTrigger: false, type: null, depth: DEPTHS.STANDARD };
}

// ============================================================
// Assumption Tracking
// ============================================================

/**
 * Create an assumption entry
 * @param {string} claim - What is being assumed
 * @param {string} source - Where this assumption comes from
 * @param {string} confidence - HIGH, MEDIUM, or LOW
 * @returns {Object} Assumption entry
 */
function createAssumption(claim, source, confidence = CONFIDENCE.LOW) {
  return {
    id: `assumption-${Date.now()}-${Math.random().toString(36).slice(2, 2 + RANDOM_ID_LENGTH)}`,
    claim,
    source,
    confidence,
    verified: false,
    verificationSource: null,
    createdAt: new Date().toISOString()
  };
}

/**
 * Mark an assumption as verified
 * @param {Object} assumption - The assumption to verify
 * @param {string} verificationSource - Where verification came from
 * @returns {Object} Updated assumption
 */
function verifyAssumption(assumption, verificationSource) {
  return {
    ...assumption,
    verified: true,
    verificationSource,
    confidence: CONFIDENCE.HIGH,
    verifiedAt: new Date().toISOString()
  };
}

/**
 * Get unverified assumptions that need attention
 * @param {Object[]} assumptions - Array of assumptions
 * @returns {Object[]} Unverified assumptions sorted by confidence (LOW first)
 */
function getUnverifiedAssumptions(assumptions) {
  return assumptions
    .filter(a => !a.verified)
    .sort((a, b) => {
      const order = { [CONFIDENCE.LOW]: 0, [CONFIDENCE.MEDIUM]: 1, [CONFIDENCE.HIGH]: 2 };
      return (order[a.confidence] || 0) - (order[b.confidence] || 0);
    });
}

// ============================================================
// Evidence Chain
// ============================================================

/**
 * Create an evidence entry
 * @param {string} claim - The claim being supported
 * @param {string} sourceType - One of SOURCE_TYPES
 * @param {string} sourceLocation - File path, URL, or description
 * @param {string} content - The relevant content/quote
 * @param {string} confidence - HIGH, MEDIUM, or LOW
 * @returns {Object} Evidence entry
 */
function createEvidence(claim, sourceType, sourceLocation, content, confidence = CONFIDENCE.MEDIUM) {
  const contentTruncated = content ? content.length > MAX_CONTENT_LENGTH : false;
  return {
    id: `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 2 + RANDOM_ID_LENGTH)}`,
    claim,
    sourceType,
    sourceLocation,
    content: content ? content.slice(0, MAX_CONTENT_LENGTH) : null,
    contentTruncated,
    confidence,
    createdAt: new Date().toISOString()
  };
}

/**
 * Build an evidence chain for a set of claims
 * @param {Object[]} evidenceItems - Array of evidence entries
 * @returns {Object} Evidence chain with statistics
 */
function buildEvidenceChain(evidenceItems) {
  const byConfidence = {
    [CONFIDENCE.HIGH]: [],
    [CONFIDENCE.MEDIUM]: [],
    [CONFIDENCE.LOW]: []
  };

  for (const item of evidenceItems) {
    const conf = item.confidence || CONFIDENCE.LOW;
    if (byConfidence[conf]) {
      byConfidence[conf].push(item);
    }
  }

  const totalHigh = byConfidence[CONFIDENCE.HIGH].length;
  const totalMedium = byConfidence[CONFIDENCE.MEDIUM].length;
  const totalLow = byConfidence[CONFIDENCE.LOW].length;
  const total = totalHigh + totalMedium + totalLow;

  // Calculate overall confidence
  // Rule: Any LOW evidence pulls down confidence; otherwise HIGH if any HIGH, else MEDIUM if any MEDIUM
  let overallConfidence = CONFIDENCE.LOW;
  if (totalLow > 0) {
    // Any low evidence pulls down overall confidence
    overallConfidence = CONFIDENCE.LOW;
  } else if (totalHigh > 0) {
    // No low evidence, and we have high evidence
    overallConfidence = CONFIDENCE.HIGH;
  } else if (totalMedium > 0) {
    // No low evidence, no high evidence, but have medium
    overallConfidence = CONFIDENCE.MEDIUM;
  }

  return {
    items: evidenceItems,
    byConfidence,
    stats: {
      total,
      high: totalHigh,
      medium: totalMedium,
      low: totalLow
    },
    overallConfidence
  };
}

// ============================================================
// Research Scope
// ============================================================

/**
 * Create a research scope for a question
 * @param {string} question - The research question
 * @param {string} depth - Research depth
 * @returns {Object} Research scope definition
 */
function createResearchScope(question, depth = DEPTHS.STANDARD) {
  const config = getResearchConfig();
  const maxTokens = config.maxTokensPerDepth[depth] || 20000;

  return {
    id: `research-${Date.now()}-${Math.random().toString(36).slice(2, 2 + RANDOM_ID_LENGTH)}`,
    question,
    depth,
    maxTokens,
    localFiles: [],
    externalSources: [],
    keywords: extractKeywords(question),
    createdAt: new Date().toISOString(),
    status: 'pending',
    tokensUsed: 0
  };
}

/**
 * Extract keywords from a question for searching
 * @param {string} question - The question to extract keywords from
 * @returns {string[]} Array of keywords
 */
function extractKeywords(question) {
  if (!question || typeof question !== 'string') return [];

  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
    'at', 'by', 'from', 'this', 'that', 'these', 'those', 'it', 'its',
    'i', 'you', 'we', 'they', 'he', 'she', 'what', 'which', 'who', 'how',
    'when', 'where', 'why', 'if', 'or', 'and', 'but', 'not'
  ]);

  const words = question.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => {
      // Keep words longer than 2 chars that aren't stop words
      if (word.length > 2) return !stopWords.has(word);
      // Also keep short tech acronyms (api, js, go, etc.)
      return TECH_ACRONYMS.has(word);
    });

  // Deduplicate while preserving order
  return [...new Set(words)];
}

/**
 * Add files to research scope
 * @param {Object} scope - Research scope
 * @param {string[]} files - File paths to add
 * @returns {Object} Updated scope
 */
function addFilesToScope(scope, files) {
  const existing = new Set(scope.localFiles);
  const newFiles = files.filter(f => !existing.has(f));
  const limited = newFiles.slice(0, MAX_FILES_PER_RESEARCH - scope.localFiles.length);

  return {
    ...scope,
    localFiles: [...scope.localFiles, ...limited]
  };
}

/**
 * Add external sources to research scope
 * @param {Object} scope - Research scope
 * @param {string[]} sources - URLs or source identifiers
 * @returns {Object} Updated scope
 */
function addExternalSourcesToScope(scope, sources) {
  const existing = new Set(scope.externalSources);
  const newSources = sources.filter(s => !existing.has(s));
  const limited = newSources.slice(0, MAX_URLS_PER_RESEARCH - scope.externalSources.length);

  return {
    ...scope,
    externalSources: [...scope.externalSources, ...limited]
  };
}

// ============================================================
// Research Session
// ============================================================

/**
 * Check if a question is about external comparison
 * @param {string} question - The question to check
 * @returns {boolean} True if this is external comparison research
 */
function isExternalComparisonQuestion(question) {
  if (!question || typeof question !== 'string') return false;

  // Check if it matches comparison patterns
  const isComparison = QUESTION_PATTERNS.comparison.some(p => p.test(question));
  if (!isComparison) return false;

  // External comparison indicators - mentions external entity
  const externalIndicators = [
    /\bfrom\s+[\w-]+/i,           // "from Crush", "from React"
    /\b(repository|repo|project|tool|library|framework)\b/i,
    /https?:\/\//i,               // Contains URL
    /github\.com/i,               // GitHub reference
    /\btheir\b/i,                 // "their approach"
    /\b(external|other|another)\b/i
  ];

  return externalIndicators.some(p => p.test(question));
}

/**
 * Create a new research session
 * @param {string} question - The research question
 * @param {string} depth - Research depth
 * @param {Object} options - Optional configuration
 * @param {string} options.questionType - Pre-classified question type (if known)
 * @returns {Object} Research session
 */
function createResearchSession(question, depth = DEPTHS.STANDARD, options = {}) {
  const scope = createResearchScope(question, depth);

  // Determine if this is external comparison research
  const isExternalComparison = options.questionType === 'comparison' ||
    isExternalComparisonQuestion(question);

  // Build phases based on question type
  const phases = {};

  // Phase 0: External Research (only for external comparison questions)
  if (isExternalComparison) {
    phases.externalResearch = {
      status: 'pending',
      completedAt: null,
      findings: [],        // What the external tool/project has
      externalSources: []  // URLs/repos researched
    };
  }

  // Standard phases (1-5)
  phases.scopeMapping = { status: 'pending', completedAt: null };
  phases.localEvidence = { status: 'pending', completedAt: null };

  // Phase 3: External Verification - skip for comparison (already did Phase 0)
  if (!isExternalComparison) {
    phases.externalVerification = { status: 'pending', completedAt: null };
  }

  phases.assumptionCheck = { status: 'pending', completedAt: null };
  phases.synthesis = { status: 'pending', completedAt: null };

  // Phase 6: Recommendation Verification (especially important for comparison)
  phases.recommendationVerification = {
    status: 'pending',
    completedAt: null,
    recommendations: []
  };

  return {
    id: scope.id,
    question,
    depth,
    scope,
    isExternalComparison,  // Flag for flow control
    assumptions: [],
    evidence: [],
    findings: [],
    conclusion: null,
    status: 'active',
    phases,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
}

/**
 * Add an assumption to the session
 *
 * IMPORTANT: Callers MUST use the returned session object, as this function
 * returns a new session (immutable pattern) rather than mutating the original.
 *
 * @param {Object} session - Research session
 * @param {string} claim - The assumption claim
 * @param {string} source - Source of the assumption
 * @param {string} confidence - Confidence level
 * @returns {{session: Object, added: boolean, reason: string, error?: string}} Result with updated session and status
 */
function addAssumption(session, claim, source, confidence = CONFIDENCE.LOW) {
  // Validate session object
  if (!session || typeof session !== 'object') {
    return {
      session: session || null,
      added: false,
      reason: 'Invalid session object',
      error: 'INVALID_SESSION'
    };
  }

  // Ensure assumptions array exists
  if (!Array.isArray(session.assumptions)) {
    return {
      session,
      added: false,
      reason: 'Session has no assumptions array',
      error: 'INVALID_SESSION_STRUCTURE'
    };
  }

  if (session.assumptions.length >= MAX_ASSUMPTIONS) {
    return {
      session,
      added: false,
      reason: `Maximum assumptions (${MAX_ASSUMPTIONS}) reached`,
      error: 'LIMIT_EXCEEDED'
    };
  }

  const assumption = createAssumption(claim, source, confidence);
  return {
    session: {
      ...session,
      assumptions: [...session.assumptions, assumption]
    },
    added: true,
    reason: null
  };
}

/**
 * Add evidence to the session
 * @param {Object} session - Research session
 * @param {string} claim - The claim being supported
 * @param {string} sourceType - Source type
 * @param {string} sourceLocation - Source location
 * @param {string} content - Relevant content
 * @param {string} confidence - Confidence level
 * @returns {Object} Updated session
 */
function addEvidence(session, claim, sourceType, sourceLocation, content, confidence = CONFIDENCE.MEDIUM) {
  const evidence = createEvidence(claim, sourceType, sourceLocation, content, confidence);
  return {
    ...session,
    evidence: [...session.evidence, evidence]
  };
}

/**
 * Update session phase status
 * @param {Object} session - Research session
 * @param {string} phase - Phase name
 * @param {string} status - New status
 * @returns {Object} Updated session
 */
function updatePhase(session, phase, status) {
  const phases = { ...session.phases };
  if (phases[phase]) {
    phases[phase] = {
      ...phases[phase],
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : null
    };
  }
  return { ...session, phases };
}

/**
 * Complete the research session
 * @param {Object} session - Research session
 * @param {string} conclusion - Research conclusion
 * @param {string} confidence - Overall confidence
 * @returns {Object} Completed session
 */
function completeSession(session, conclusion, confidence = CONFIDENCE.MEDIUM) {
  return {
    ...session,
    conclusion: {
      text: conclusion,
      confidence,
      timestamp: new Date().toISOString()
    },
    status: 'completed',
    completedAt: new Date().toISOString()
  };
}

// ============================================================
// Research Cache
// ============================================================

/**
 * Get the research cache path
 * @returns {string}
 */
function getCachePath() {
  return path.join(PATHS.state, 'research-cache.json');
}

/**
 * Load research cache
 * @returns {Object} Cache data
 */
function loadCache() {
  const cachePath = getCachePath();
  return safeJsonParse(cachePath, { verifications: {}, lastCleanup: null });
}

/**
 * Save research cache
 * @param {Object} cache - Cache data to save
 */
function saveCache(cache) {
  const cachePath = getCachePath();
  try {
    // Ensure directory exists before writing
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[research-cache] Failed to save cache: ${err.message}`);
    }
  }
}

/**
 * Get cached verification result
 *
 * NOTE: This function has a potential TOCTOU (time-of-check-time-of-use) race
 * condition if multiple processes access the cache simultaneously. For most
 * single-user scenarios this is acceptable. For high-concurrency environments,
 * consider using proper file locking or a database.
 *
 * @param {string} key - Cache key (tool + feature)
 * @returns {Object|null} Cached result or null
 */
function getCachedVerification(key) {
  const config = getResearchConfig();
  if (!config.cacheVerifications) return null;

  const cache = loadCache();
  const entry = cache.verifications[key];

  if (!entry) return null;

  // Check expiry - handle invalid timestamps gracefully
  const expiryMs = config.cacheExpiryHours * 60 * 60 * 1000;
  const entryTime = new Date(entry.timestamp).getTime();

  // If timestamp is invalid (NaN), treat as expired and log for debugging
  if (Number.isNaN(entryTime)) {
    if (process.env.DEBUG) {
      console.error(`[research-cache] Corrupted timestamp for key "${key}", removing entry`);
    }
    delete cache.verifications[key];
    saveCache(cache);
    return null;
  }

  const age = Date.now() - entryTime;

  if (age > expiryMs) {
    // Expired - remove and return null
    delete cache.verifications[key];
    saveCache(cache);
    return null;
  }

  return entry;
}

/**
 * Cache a verification result
 * @param {string} key - Cache key
 * @param {Object} result - Verification result
 */
function cacheVerification(key, result) {
  const config = getResearchConfig();
  if (!config.cacheVerifications) return;

  const cache = loadCache();
  cache.verifications[key] = {
    ...result,
    timestamp: new Date().toISOString()
  };
  saveCache(cache);
}

/**
 * Clean expired cache entries
 */
function cleanupCache() {
  const config = getResearchConfig();
  const cache = loadCache();
  const expiryMs = config.cacheExpiryHours * 60 * 60 * 1000;
  const now = Date.now();

  let cleaned = 0;
  for (const [key, entry] of Object.entries(cache.verifications)) {
    const age = now - new Date(entry.timestamp).getTime();
    if (age > expiryMs) {
      delete cache.verifications[key];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    cache.lastCleanup = new Date().toISOString();
    saveCache(cache);
  }

  return cleaned;
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate a research report
 * @param {Object} session - Completed research session
 * @returns {string} Markdown formatted report
 */
function generateReport(session) {
  const unverified = getUnverifiedAssumptions(session.assumptions);

  const lines = [];

  // Header
  lines.push('# Research Report');
  lines.push('');
  lines.push(`**Question:** ${session.question}`);
  lines.push(`**Depth:** ${session.depth}`);
  lines.push(`**Status:** ${session.status}`);
  lines.push(`**Overall Confidence:** ${session.conclusion?.confidence || 'N/A'}`);
  lines.push('');

  // Conclusion
  if (session.conclusion) {
    lines.push('## Conclusion');
    lines.push('');
    lines.push(session.conclusion.text);
    lines.push('');
  }

  // Evidence Chain
  lines.push('## Evidence Chain');
  lines.push('');
  lines.push('| Claim | Source Type | Source | Confidence |');
  lines.push('|-------|-------------|--------|------------|');

  for (const item of session.evidence) {
    // Escape pipe characters in markdown table cells
    const escapePipe = (s) => s.replace(/\|/g, '\\|');
    const truncate = (s, max) => s.length > max ? s.slice(0, max - REPORT_LIMITS.TRUNCATION_SUFFIX.length) + REPORT_LIMITS.TRUNCATION_SUFFIX : s;

    const claim = escapePipe(truncate(item.claim, REPORT_LIMITS.MAX_CLAIM_LENGTH));
    const source = escapePipe(truncate(item.sourceLocation, REPORT_LIMITS.MAX_SOURCE_LENGTH));
    lines.push(`| ${claim} | ${item.sourceType} | ${source} | ${item.confidence} |`);
  }
  lines.push('');

  // Assumptions
  if (session.assumptions.length > 0) {
    lines.push('## Assumptions');
    lines.push('');

    for (const assumption of session.assumptions) {
      const status = assumption.verified ? '[VERIFIED]' : '[UNVERIFIED]';
      lines.push(`- ${status} ${assumption.claim} (${assumption.confidence})`);
      if (assumption.verificationSource) {
        lines.push(`  - Source: ${assumption.verificationSource}`);
      }
    }
    lines.push('');
  }

  // Warnings
  if (unverified.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    lines.push(`**${unverified.length} unverified assumption(s) remain.**`);
    lines.push('');
    lines.push('The following assumptions could not be verified:');
    for (const a of unverified) {
      lines.push(`- ${a.claim}`);
    }
    lines.push('');
  }

  // Metadata
  lines.push('---');
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **Session ID:** ${session.id}`);
  lines.push(`- **Created:** ${session.createdAt}`);
  lines.push(`- **Completed:** ${session.completedAt || 'N/A'}`);
  lines.push(`- **Files Searched:** ${session.scope.localFiles.length}`);
  lines.push(`- **External Sources:** ${session.scope.externalSources.length}`);
  lines.push(`- **Evidence Items:** ${session.evidence.length}`);
  lines.push(`- **Assumptions Tracked:** ${session.assumptions.length}`);

  return lines.join('\n');
}

// ============================================================
// Negative Evidence Rule
// ============================================================

/**
 * Check if a claim is a negative claim (asserting non-existence)
 * @param {string} claim - The claim to check
 * @returns {boolean}
 */
function isNegativeClaim(claim) {
  if (!claim || typeof claim !== 'string') return false;

  const negativePat = [
    /\bdoes\s*n['o]t\s+(support|have|exist|work)/i,
    /\bis\s*n['o]t\s+(supported|available|possible)/i,
    /\bthere\s+is\s+no/i,
    /\bcannot\s+be\s+done/i,
    /\bno\s+(way|method|support|feature)\s+(to|for)/i,
    /\bdoesn't\s+exist/i,
    /\bnot\s+possible/i
  ];

  return negativePat.some(p => p.test(claim));
}

/**
 * Validate that a negative claim has sufficient evidence
 * @param {string} claim - The negative claim
 * @param {Object[]} evidence - Evidence items
 * @param {Object[]} searchesPerformed - List of searches performed
 * @param {string} depth - Research depth used (determines minimum searches required)
 * @returns {{valid: boolean, message: string}}
 */
function validateNegativeClaim(claim, evidence, searchesPerformed = [], depth = DEPTHS.STANDARD) {
  const config = getResearchConfig();

  if (!config.negativeEvidenceRule) {
    return { valid: true, message: 'Negative evidence rule disabled' };
  }

  // Negative claims require exhaustive search evidence
  // Search requirements scale with depth to ensure claims like "X doesn't exist"
  // have sufficient evidence. Values chosen based on:
  // - QUICK: Minimal verification (2) - for low-stakes quick answers
  // - STANDARD: Basic thoroughness (3) - 2 file + 1 web or similar
  // - DEEP: Comprehensive (5) - multiple file searches + web verification
  // - EXHAUSTIVE: Maximum diligence (10) - production/architecture decisions
  const minSearches = {
    [DEPTHS.QUICK]: 2,
    [DEPTHS.STANDARD]: 3,
    [DEPTHS.DEEP]: 5,
    [DEPTHS.EXHAUSTIVE]: 10
  };

  // Use provided depth, fallback to standard if invalid
  const effectiveDepth = minSearches[depth] ? depth : DEPTHS.STANDARD;
  const requiredSearches = minSearches[effectiveDepth];

  if (searchesPerformed.length < requiredSearches) {
    return {
      valid: false,
      message: `Negative claim "${claim.slice(0, 50)}..." requires at least ${requiredSearches} searches at ${effectiveDepth} depth. Only ${searchesPerformed.length} performed.`
    };
  }

  // Must have evidence of searching, not just absence
  const searchEvidence = evidence.filter(e =>
    e.sourceType === SOURCE_TYPES.WEB_SEARCH ||
    e.sourceType === SOURCE_TYPES.LIVE_DOCS ||
    e.sourceType === SOURCE_TYPES.FILE_READ
  );

  if (searchEvidence.length < 2) {
    return {
      valid: false,
      message: `Negative claim requires documented search evidence. Found: ${searchEvidence.length}`
    };
  }

  return { valid: true, message: 'Sufficient search evidence for negative claim' };
}

// ============================================================
// Research Gate Check
// ============================================================

/**
 * Check if research is required before answering a question
 * @param {string} question - The question being asked
 * @returns {{required: boolean, type: string|null, depth: string, message: string|null}}
 */
function checkResearchGate(question) {
  const config = getResearchConfig();

  if (!config.enabled) {
    return {
      required: false,
      type: null,
      depth: DEPTHS.STANDARD,
      message: null
    };
  }

  const trigger = shouldAutoTrigger(question);

  if (!trigger.shouldTrigger) {
    return {
      required: false,
      type: null,
      depth: DEPTHS.STANDARD,
      message: null
    };
  }

  if (!config.strictMode) {
    return {
      required: false,
      type: trigger.type,
      depth: trigger.depth,
      message: `Consider using /wogi-research for "${trigger.type}" questions`
    };
  }

  return {
    required: true,
    type: trigger.type,
    depth: trigger.depth,
    message: generateResearchGateMessage(question, trigger.type, trigger.depth)
  };
}

/**
 * Generate the research gate blocking message
 * @param {string} question - The question
 * @param {string} type - Question type
 * @param {string} depth - Suggested depth
 * @returns {string}
 */
function generateResearchGateMessage(question, type, depth) {
  const truncated = question.length > 60 ? question.slice(0, 57) + '...' : question;

  return `Research protocol required for ${type} question.

This question requires verification before answering.

To proceed:
  /wogi-research "${truncated}"
  or
  /wogi-research --${depth} "${truncated}"

The research protocol will:
1. Search local files and documentation
2. Verify with external sources (web search)
3. Track and validate assumptions
4. Generate cited conclusions

Why: Claims about capabilities, existence, or feasibility must be verified.`;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getResearchConfig,
  isResearchEnabled,

  // Constants
  CONFIDENCE,
  DEPTHS,
  SOURCE_TYPES,
  QUESTION_PATTERNS,

  // Question Classification
  classifyQuestion,
  shouldAutoTrigger,
  isExternalComparisonQuestion,

  // Assumption Tracking
  createAssumption,
  verifyAssumption,
  getUnverifiedAssumptions,

  // Evidence Chain
  createEvidence,
  buildEvidenceChain,

  // Research Scope
  createResearchScope,
  extractKeywords,
  addFilesToScope,
  addExternalSourcesToScope,

  // Research Session
  createResearchSession,
  addAssumption,
  addEvidence,
  updatePhase,
  completeSession,

  // Cache
  loadCache,
  saveCache,
  getCachedVerification,
  cacheVerification,
  cleanupCache,

  // Report
  generateReport,

  // Negative Evidence
  isNegativeClaim,
  validateNegativeClaim,

  // Research Gate
  checkResearchGate,
  generateResearchGateMessage
};
