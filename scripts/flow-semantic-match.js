#!/usr/bin/env node

/**
 * Wogi Flow - Semantic Matching Utility
 *
 * Provides hybrid matching for components, functions, and APIs:
 * 1. String similarity (Levenshtein) for fast initial filtering
 * 2. Semantic keyword matching for purpose-based similarity
 * 3. AI decision prompt generation for ambiguous cases
 *
 * Unlike fixed 80% threshold, uses:
 * - Combined score: (0.3 * stringSimilarity) + (0.7 * semanticSimilarity)
 * - AI-as-judge for candidates above 50% combined score
 */

const fs = require('fs');
const path = require('path');
const { getConfig, PATHS, color } = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  // Thresholds for different match levels
  thresholds: {
    definiteMatch: 90,      // >= 90%: Definite match, block/warn strongly
    likelyMatch: 70,        // 70-89%: Likely match, suggest AI review
    possibleMatch: 50,      // 50-69%: Possible match, show as candidate
    noMatch: 0              // < 50%: No match
  },
  // Weight for combined scoring
  weights: {
    stringSimilarity: 0.3,
    semanticSimilarity: 0.7
  },
  // Whether to generate AI prompts for review
  useAIReview: true
};

// ============================================================
// Semantic Keywords by Domain
// ============================================================

const SEMANTIC_KEYWORDS = {
  // UI Component categories
  components: {
    layout: ['container', 'wrapper', 'grid', 'flex', 'box', 'stack', 'layout', 'section', 'panel', 'frame'],
    navigation: ['nav', 'menu', 'sidebar', 'header', 'footer', 'breadcrumb', 'tabs', 'pagination', 'stepper'],
    form: ['input', 'field', 'form', 'select', 'checkbox', 'radio', 'toggle', 'switch', 'slider', 'picker'],
    feedback: ['alert', 'toast', 'notification', 'message', 'snackbar', 'banner', 'badge', 'chip', 'tag'],
    data: ['table', 'list', 'grid', 'card', 'tile', 'item', 'row', 'cell', 'data'],
    media: ['image', 'video', 'audio', 'icon', 'avatar', 'thumbnail', 'gallery', 'carousel'],
    overlay: ['modal', 'dialog', 'drawer', 'popover', 'tooltip', 'dropdown', 'menu', 'sheet'],
    action: ['button', 'link', 'action', 'fab', 'icon-button', 'submit', 'cancel', 'cta'],
    text: ['text', 'heading', 'title', 'label', 'paragraph', 'caption', 'description', 'subtitle'],
    loading: ['spinner', 'loader', 'skeleton', 'placeholder', 'progress', 'loading']
  },

  // Function categories
  functions: {
    formatting: ['format', 'stringify', 'prettify', 'display', 'render', 'template', 'mask'],
    parsing: ['parse', 'extract', 'read', 'decode', 'deserialize', 'convert', 'transform'],
    validation: ['validate', 'check', 'verify', 'assert', 'ensure', 'confirm', 'test', 'is'],
    manipulation: ['merge', 'combine', 'split', 'slice', 'filter', 'map', 'reduce', 'sort', 'group'],
    datetime: ['date', 'time', 'timestamp', 'duration', 'interval', 'period', 'schedule', 'timezone'],
    string: ['string', 'text', 'trim', 'pad', 'truncate', 'capitalize', 'lowercase', 'uppercase', 'slug'],
    number: ['number', 'integer', 'float', 'decimal', 'round', 'floor', 'ceil', 'clamp', 'percent'],
    async: ['async', 'await', 'promise', 'debounce', 'throttle', 'delay', 'timeout', 'retry', 'queue'],
    storage: ['storage', 'cache', 'persist', 'save', 'load', 'store', 'retrieve', 'session', 'local'],
    crypto: ['hash', 'encrypt', 'decrypt', 'encode', 'sign', 'token', 'uuid', 'random', 'generate']
  },

  // API categories
  apis: {
    crud: ['create', 'read', 'update', 'delete', 'get', 'post', 'put', 'patch', 'remove', 'add'],
    query: ['query', 'search', 'find', 'filter', 'list', 'fetch', 'load', 'retrieve', 'browse'],
    auth: ['auth', 'login', 'logout', 'register', 'signup', 'signin', 'session', 'token', 'verify'],
    user: ['user', 'profile', 'account', 'member', 'person', 'customer', 'client', 'admin'],
    data: ['data', 'record', 'item', 'entity', 'resource', 'document', 'object', 'model'],
    file: ['file', 'upload', 'download', 'attachment', 'media', 'image', 'document', 'asset'],
    notification: ['notify', 'alert', 'message', 'email', 'sms', 'push', 'webhook', 'event'],
    payment: ['payment', 'checkout', 'order', 'cart', 'invoice', 'subscription', 'billing', 'price'],
    analytics: ['analytics', 'track', 'log', 'metric', 'event', 'report', 'stats', 'monitor'],
    config: ['config', 'settings', 'preferences', 'options', 'feature', 'flag', 'toggle', 'env']
  }
};

// ============================================================
// String Similarity (Levenshtein)
// ============================================================

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0-100)
 */
function calculateStringSimilarity(a, b) {
  if (!a || !b) return 0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 100;

  // Check if one contains the other
  if (aLower.includes(bLower) || bLower.includes(aLower)) {
    const longer = Math.max(a.length, b.length);
    const shorter = Math.min(a.length, b.length);
    return Math.round((shorter / longer) * 100);
  }

  // Levenshtein distance
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (bLower[i - 1] === aLower[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);
  return Math.round(((maxLen - distance) / maxLen) * 100);
}

// ============================================================
// Semantic Similarity
// ============================================================

/**
 * Extract semantic tokens from a name (camelCase, PascalCase, snake_case, kebab-case)
 * @param {string} name - Name to tokenize
 * @returns {string[]} Tokens
 */
function tokenize(name) {
  if (!name) return [];

  return name
    // Split on camelCase boundaries
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split on snake_case and kebab-case
    .replace(/[-_]/g, ' ')
    // Lowercase and split
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Find which category a name belongs to
 * @param {string} name - Name to categorize
 * @param {string} domain - Domain: 'components', 'functions', 'apis'
 * @returns {string[]} Matching categories
 */
function findCategories(name, domain) {
  const tokens = tokenize(name);
  const categories = SEMANTIC_KEYWORDS[domain] || {};
  const matches = [];

  for (const [category, keywords] of Object.entries(categories)) {
    for (const token of tokens) {
      if (keywords.some(kw => kw.includes(token) || token.includes(kw))) {
        if (!matches.includes(category)) {
          matches.push(category);
        }
      }
    }
  }

  return matches;
}

/**
 * Calculate semantic similarity between two names
 * @param {string} nameA - First name
 * @param {string} nameB - Second name
 * @param {string} domain - Domain: 'components', 'functions', 'apis'
 * @param {Object} options - Optional: { purposeA, purposeB } for description-based matching
 * @returns {number} Similarity score (0-100)
 */
function calculateSemanticSimilarity(nameA, nameB, domain, options = {}) {
  const tokensA = tokenize(nameA);
  const tokensB = tokenize(nameB);

  // 1. Token overlap
  const commonTokens = tokensA.filter(t => tokensB.includes(t));
  const tokenOverlap = commonTokens.length / Math.max(tokensA.length, tokensB.length, 1);

  // 2. Category overlap
  const categoriesA = findCategories(nameA, domain);
  const categoriesB = findCategories(nameB, domain);
  const commonCategories = categoriesA.filter(c => categoriesB.includes(c));
  const categoryOverlap = commonCategories.length / Math.max(categoriesA.length, categoriesB.length, 1);

  // 3. Purpose/description similarity (if provided)
  let purposeScore = 0;
  if (options.purposeA && options.purposeB) {
    const purposeTokensA = tokenize(options.purposeA);
    const purposeTokensB = tokenize(options.purposeB);
    const commonPurpose = purposeTokensA.filter(t => purposeTokensB.includes(t));
    purposeScore = commonPurpose.length / Math.max(purposeTokensA.length, purposeTokensB.length, 1);
  }

  // Weighted combination
  let score;
  if (purposeScore > 0) {
    score = (tokenOverlap * 0.3) + (categoryOverlap * 0.3) + (purposeScore * 0.4);
  } else {
    score = (tokenOverlap * 0.5) + (categoryOverlap * 0.5);
  }

  return Math.round(score * 100);
}

// ============================================================
// Combined Scoring
// ============================================================

/**
 * Calculate combined similarity score
 * @param {string} nameA - First name
 * @param {string} nameB - Second name
 * @param {string} domain - Domain: 'components', 'functions', 'apis'
 * @param {Object} options - Optional metadata
 * @returns {Object} { combined, string, semantic, categories }
 */
function calculateCombinedSimilarity(nameA, nameB, domain, options = {}) {
  const config = getMatchConfig();
  const weights = config.weights;

  const stringSimilarity = calculateStringSimilarity(nameA, nameB);
  const semanticSimilarity = calculateSemanticSimilarity(nameA, nameB, domain, options);

  const combined = Math.round(
    (weights.stringSimilarity * stringSimilarity) +
    (weights.semanticSimilarity * semanticSimilarity)
  );

  return {
    combined,
    string: stringSimilarity,
    semantic: semanticSimilarity,
    categoriesA: findCategories(nameA, domain),
    categoriesB: findCategories(nameB, domain)
  };
}

/**
 * Get matching configuration
 */
function getMatchConfig() {
  const config = getConfig();
  const semanticConfig = config.semanticMatching || {};

  return {
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...(semanticConfig.thresholds || {})
    },
    weights: {
      ...DEFAULT_CONFIG.weights,
      ...(semanticConfig.weights || {})
    },
    useAIReview: semanticConfig.useAIReview !== false
  };
}

// ============================================================
// Match Finding
// ============================================================

/**
 * Find similar items using hybrid matching
 * @param {string} name - Name to search for
 * @param {Array} registry - Registry to search in
 * @param {string} domain - Domain: 'components', 'functions', 'apis'
 * @param {Object} options - Optional: { purpose }
 * @returns {Array} Similar items sorted by combined score
 */
function findSimilarItems(name, registry, domain, options = {}) {
  const config = getMatchConfig();
  const minThreshold = config.thresholds.possibleMatch;
  const results = [];

  for (const item of registry) {
    const itemName = item.name || item.title || '';
    const itemPurpose = item.description || item.purpose || '';

    const scores = calculateCombinedSimilarity(name, itemName, domain, {
      purposeA: options.purpose,
      purposeB: itemPurpose
    });

    if (scores.combined >= minThreshold) {
      results.push({
        ...item,
        scores,
        matchLevel: getMatchLevel(scores.combined, config.thresholds)
      });
    }
  }

  return results.sort((a, b) => b.scores.combined - a.scores.combined);
}

/**
 * Get match level description
 */
function getMatchLevel(score, thresholds) {
  if (score >= thresholds.definiteMatch) return 'definite';
  if (score >= thresholds.likelyMatch) return 'likely';
  if (score >= thresholds.possibleMatch) return 'possible';
  return 'none';
}

// ============================================================
// AI Decision Prompt Generation
// ============================================================

/**
 * Generate AI decision prompt for similar items
 * @param {string} newName - Name of item being created
 * @param {string} newPurpose - Purpose/description of new item
 * @param {Array} similar - Similar items found
 * @param {string} domain - Domain: 'components', 'functions', 'apis'
 * @returns {string} AI prompt for decision
 */
function generateAIDecisionPrompt(newName, newPurpose, similar, domain) {
  const domainLabels = {
    components: 'component',
    functions: 'function',
    apis: 'API call'
  };
  const domainLabel = domainLabels[domain] || 'item';

  let prompt = `## Reuse Check: Creating "${newName}"\n\n`;

  if (newPurpose) {
    prompt += `**Purpose:** ${newPurpose}\n\n`;
  }

  prompt += `### Similar existing ${domainLabel}s found:\n\n`;

  for (let i = 0; i < Math.min(similar.length, 5); i++) {
    const item = similar[i];
    const scores = item.scores;

    prompt += `**${i + 1}. ${item.name}**\n`;
    prompt += `   - Match: ${scores.combined}% (string: ${scores.string}%, semantic: ${scores.semantic}%)\n`;
    if (item.description || item.purpose) {
      prompt += `   - Purpose: ${item.description || item.purpose}\n`;
    }
    if (item.file || item.path) {
      prompt += `   - Location: \`${item.file || item.path}\`\n`;
    }
    if (item.params && item.params.length > 0) {
      const paramStr = item.params.map(p => `${p.name}: ${p.type}`).join(', ');
      prompt += `   - Params: ${paramStr}\n`;
    }
    prompt += '\n';
  }

  prompt += `### Decision Required:\n\n`;
  prompt += `Based on the purpose and existing ${domainLabel}s, decide:\n\n`;
  prompt += `1. **EXTEND** - Add a variant or parameter to an existing ${domainLabel}\n`;
  prompt += `2. **CREATE** - Create new (genuinely different purpose)\n`;
  prompt += `3. **USE** - Use the existing ${domainLabel} directly (no changes needed)\n\n`;

  prompt += `**Criteria:**\n`;
  prompt += `- If purpose overlaps significantly (>70%), prefer EXTEND or USE\n`;
  prompt += `- If only names are similar but purpose differs, prefer CREATE\n`;
  prompt += `- Consider maintainability: fewer similar items = easier maintenance\n\n`;

  prompt += `**Your decision:** [EXTEND/CREATE/USE] because [reason]\n`;

  return prompt;
}

/**
 * Generate context block for injection into AI conversation
 */
function generateContextBlock(newName, similar, domain) {
  if (similar.length === 0) return null;

  const bestMatch = similar[0];
  const matchLevel = bestMatch.matchLevel;

  let block = '\n<reuse-check>\n';

  if (matchLevel === 'definite') {
    block += `⚠️ SIMILAR ${domain.toUpperCase().slice(0, -1)} EXISTS: ${bestMatch.name} (${bestMatch.scores.combined}% match)\n`;
    block += `Consider using or extending the existing item instead of creating "${newName}".\n`;
  } else if (matchLevel === 'likely') {
    block += `📋 POTENTIAL MATCH: ${bestMatch.name} (${bestMatch.scores.combined}% match)\n`;
    block += `Review if "${newName}" can extend the existing item.\n`;
  } else {
    block += `ℹ️ SIMILAR ITEMS FOUND:\n`;
    for (const item of similar.slice(0, 3)) {
      block += `  - ${item.name} (${item.scores.combined}%)\n`;
    }
  }

  if (bestMatch.description || bestMatch.purpose) {
    block += `Purpose: ${bestMatch.description || bestMatch.purpose}\n`;
  }
  if (bestMatch.file || bestMatch.path) {
    block += `Location: ${bestMatch.file || bestMatch.path}\n`;
  }

  block += '</reuse-check>\n';

  return block;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  DEFAULT_CONFIG,
  getMatchConfig,

  // String similarity
  calculateStringSimilarity,

  // Semantic similarity
  tokenize,
  findCategories,
  calculateSemanticSimilarity,

  // Combined scoring
  calculateCombinedSimilarity,

  // Match finding
  findSimilarItems,
  getMatchLevel,

  // AI prompt generation
  generateAIDecisionPrompt,
  generateContextBlock,

  // Semantic keywords (for extension)
  SEMANTIC_KEYWORDS
};
