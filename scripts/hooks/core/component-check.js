#!/usr/bin/env node

/**
 * Wogi Flow - Component Check (Core Module)
 *
 * CLI-agnostic component reuse detection with hybrid matching.
 * Uses combination of:
 * - String similarity (Levenshtein)
 * - Semantic similarity (keywords, categories, purpose)
 * - AI decision prompts for ambiguous cases
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');
const fs = require('fs');

// Import from parent scripts directory
const { getConfig, PATHS } = require('../../flow-utils');
const {
  calculateStringSimilarity,
  findSimilarItems,
  generateAIDecisionPrompt,
  generateContextBlock,
  getMatchConfig
} = require('../../flow-semantic-match');

/**
 * Check if component reuse checking is enabled
 * @returns {boolean}
 */
function isComponentCheckEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.componentReuse?.enabled !== false;
}

/**
 * Get component patterns to check
 * @returns {string[]} Glob patterns for component directories
 */
function getComponentPatterns() {
  const config = getConfig();
  return config.hooks?.rules?.componentReuse?.patterns ||
         config.componentRules?.directories ||
         ['**/components/**', '**/ui/**', '**/src/components/**'];
}

/**
 * Get similarity threshold (legacy - now uses semantic matching thresholds)
 * @returns {number} Threshold (0-100)
 */
function getSimilarityThreshold() {
  const config = getConfig();
  // Use new semantic matching threshold if available
  const semanticConfig = config.semanticMatching?.thresholds;
  if (semanticConfig) {
    return semanticConfig.possibleMatch || 50;
  }
  // Fall back to legacy threshold
  return config.hooks?.rules?.componentReuse?.threshold || 70;
}

/**
 * Check if a file path matches component patterns
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function isComponentPath(filePath) {
  const patterns = getComponentPatterns();
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    // Simple pattern matching (supports ** and *)
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');

    if (new RegExp(regexPattern).test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Load the component index
 * @returns {Object|null} Component index or null
 */
function loadComponentIndex() {
  try {
    const indexPath = path.join(PATHS.state, 'component-index.json');
    if (!fs.existsSync(indexPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Parse app-map.md for component entries
 * @returns {Array} Component entries from app-map
 */
function parseAppMap() {
  try {
    const appMapPath = PATHS.appMap;
    if (!fs.existsSync(appMapPath)) {
      return [];
    }

    const content = fs.readFileSync(appMapPath, 'utf-8');
    const components = [];

    // Parse markdown table or list entries
    const lines = content.split('\n');
    for (const line of lines) {
      // Match table rows: | ComponentName | description | path |
      const tableMatch = line.match(/^\|\s*([^|]+)\s*\|/);
      if (tableMatch && !tableMatch[1].includes('---')) {
        const name = tableMatch[1].trim();
        if (name && name !== 'Component' && name !== 'Name') {
          components.push({ name, source: 'app-map' });
        }
      }

      // Match list items: - ComponentName: description
      const listMatch = line.match(/^[-*]\s+\*?\*?([A-Z][a-zA-Z0-9]+)\*?\*?/);
      if (listMatch) {
        components.push({ name: listMatch[1], source: 'app-map' });
      }
    }

    return components;
  } catch (_err) {
    return [];
  }
}

/**
 * Calculate similarity between two strings (Levenshtein-based)
 * Alias for calculateStringSimilarity from flow-semantic-match for backward compatibility.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0-100)
 */
const calculateSimilarity = calculateStringSimilarity;

/**
 * Extract component name from file path
 * @param {string} filePath - File path
 * @returns {string} Extracted component name
 */
function extractComponentName(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath));
  // Remove common suffixes
  return fileName
    .replace(/\.(component|view|container|page|screen)$/i, '')
    .replace(/[-_]/g, '');
}

/**
 * Find similar components using hybrid matching (string + semantic)
 * @param {string} componentName - Name to search for
 * @param {Object} options - Optional: { purpose }
 * @returns {Array} Similar components sorted by combined score
 */
function findSimilarComponents(componentName, options = {}) {
  const registry = [];

  // Build registry from component index
  const index = loadComponentIndex();
  if (index && index.components) {
    for (const comp of index.components) {
      const name = comp.name || extractComponentName(comp.path || '');
      registry.push({
        name,
        path: comp.path,
        description: comp.description || comp.purpose || '',
        source: 'component-index'
      });
    }
  }

  // Add from app-map
  const appMapComponents = parseAppMap();
  for (const comp of appMapComponents) {
    // Avoid duplicates
    if (!registry.some(r => r.name === comp.name)) {
      registry.push({
        name: comp.name,
        description: comp.description || '',
        source: 'app-map'
      });
    }
  }

  // Use hybrid matching
  const similar = findSimilarItems(componentName, registry, 'components', {
    purpose: options.purpose
  });

  // Transform to legacy format for compatibility
  return similar.map(item => ({
    name: item.name,
    path: item.path,
    description: item.description,
    similarity: item.scores.combined,  // Combined score
    stringSimilarity: item.scores.string,
    semanticSimilarity: item.scores.semantic,
    matchLevel: item.matchLevel,
    source: item.source,
    scores: item.scores  // Full scores object
  }));
}

/**
 * Check component reuse for a new file with hybrid matching
 * @param {Object} options
 * @param {string} options.filePath - Path of new file
 * @param {string} options.content - Content of new file (optional)
 * @param {string} options.purpose - Purpose/description of new component (optional)
 * @returns {Object} Result: { allowed, warning, message, similar, aiPrompt }
 */
function checkComponentReuse(options = {}) {
  const { filePath, purpose } = options;

  if (!isComponentCheckEnabled()) {
    return {
      allowed: true,
      warning: false,
      message: null,
      reason: 'component_check_disabled'
    };
  }

  // Only check component paths
  if (!isComponentPath(filePath)) {
    return {
      allowed: true,
      warning: false,
      message: null,
      reason: 'not_component_path'
    };
  }

  const componentName = extractComponentName(filePath);
  const similar = findSimilarComponents(componentName, { purpose });

  if (similar.length === 0) {
    return {
      allowed: true,
      warning: false,
      message: null,
      reason: 'no_similar_found'
    };
  }

  // Found similar components - determine action based on match level
  const config = getConfig();
  const matchConfig = getMatchConfig();
  const shouldBlock = config.hooks?.rules?.componentReuse?.blockOnSimilar === true;
  const shouldInjectContext = config.hooks?.rules?.componentReuse?.injectContext !== false;
  const bestMatch = similar[0];

  // Generate appropriate response based on match level
  let message;
  let aiPrompt = null;
  let contextBlock = null;

  // Always generate message
  message = generateSimilarMessage(componentName, similar);

  // Always generate contextBlock for additionalContext injection (Claude Code 2.1.9+)
  // This allows the AI to see component details in its context, not just warnings
  if (shouldInjectContext) {
    contextBlock = generateContextBlock(componentName, similar, 'components');
  }

  // Generate AI decision prompt for likely matches (when useAIReview enabled)
  if (bestMatch.matchLevel === 'likely' && matchConfig.useAIReview) {
    aiPrompt = generateAIDecisionPrompt(componentName, purpose, similar, 'components');
  }

  if (shouldBlock && bestMatch.matchLevel === 'definite') {
    return {
      allowed: false,
      warning: false,
      blocked: true,
      message,
      similar,
      bestMatch,
      aiPrompt,
      contextBlock,
      reason: 'similar_component_exists'
    };
  }

  return {
    allowed: true,
    warning: true,
    message,
    similar,
    bestMatch,
    aiPrompt,
    contextBlock,
    requiresAIReview: bestMatch.matchLevel === 'likely',
    reason: bestMatch.matchLevel === 'definite'
      ? 'similar_component_warning'
      : 'possible_component_match'
  };
}

/**
 * Generate message about similar components with hybrid scores
 */
function generateSimilarMessage(componentName, similar) {
  const bestMatch = similar[0];

  // Show combined score and breakdown for transparency
  let matchInfo = `${bestMatch.similarity}% combined`;
  if (bestMatch.stringSimilarity !== undefined && bestMatch.semanticSimilarity !== undefined) {
    matchInfo += ` (name: ${bestMatch.stringSimilarity}%, semantic: ${bestMatch.semanticSimilarity}%)`;
  }

  let msg = `Similar component found: ${bestMatch.name} - ${matchInfo}`;

  if (bestMatch.path) {
    msg += `\n  Location: ${bestMatch.path}`;
  }
  if (bestMatch.description) {
    msg += `\n  Purpose: ${bestMatch.description}`;
  }

  // Show match level (text-only for CLI compatibility)
  if (bestMatch.matchLevel) {
    const levelLabels = {
      definite: '[DEFINITE] Strongly consider reusing this component',
      likely: '[LIKELY] Review this component before creating a new one',
      possible: '[POSSIBLE] Shown for awareness - may not be relevant'
    };
    msg += `\n  ${levelLabels[bestMatch.matchLevel] || ''}`;
  }

  if (similar.length > 1) {
    msg += `\n\nOther similar components:`;
    for (const s of similar.slice(1, 4)) {
      msg += `\n- ${s.name} (${s.similarity}%)`;
      if (s.path) msg += ` at ${s.path}`;
    }
  }

  msg += `\n\nRecommended actions:`;
  msg += `\n1. USE existing - if it meets your needs`;
  msg += `\n2. EXTEND - add a variant/prop to existing`;
  msg += `\n3. CREATE new - if purpose is genuinely different`;

  return msg;
}

module.exports = {
  isComponentCheckEnabled,
  getComponentPatterns,
  getSimilarityThreshold,
  isComponentPath,
  loadComponentIndex,
  parseAppMap,
  calculateSimilarity,
  extractComponentName,
  findSimilarComponents,
  checkComponentReuse,
  generateSimilarMessage
};
