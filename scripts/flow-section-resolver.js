#!/usr/bin/env node

/**
 * Wogi Flow - Section Resolver
 *
 * High-level API for resolving section references and gathering
 * targeted context. Combines the section index with database operations.
 *
 * Features:
 * - Resolve section IDs to content
 * - Find sections by pins/keywords
 * - Find sections relevant to a task description
 * - Combine multiple sections into formatted context
 *
 * Part of Smart Context System (Phase 1)
 *
 * Usage:
 *   const { getSection, getSectionsForTask } = require('./flow-section-resolver');
 *
 *   // Get specific section
 *   const section = await getSection('coding-standards:security-patterns-2026-01-11');
 *
 *   // Get sections for a task
 *   const sections = await getSectionsForTask('Add user authentication');
 */

const {
  PATHS,
  fileExists,
  readFile,
  info,
  warn
} = require('./flow-utils');

const {
  readIndex,
  getSectionById: getIndexSectionById,
  getSectionsByPins: getIndexSectionsByPins,
  generateSectionIndex,
  needsRegeneration
} = require('./flow-section-index');

const {
  syncSectionsFromIndex,
  searchSectionsByPins: dbSearchSectionsByPins,
  searchSectionsBySimilarity,
  getSectionById: dbGetSectionById,
  getSectionsBySource,
  getSectionStats
} = require('./flow-memory-db');

// ============================================================
// Configuration
// ============================================================

// Keywords that indicate task types for context matching
const TASK_KEYWORDS = {
  component: ['component', 'button', 'input', 'form', 'modal', 'dialog', 'ui', 'widget'],
  security: ['security', 'auth', 'authentication', 'authorization', 'password', 'token', 'jwt', 'encrypt'],
  api: ['api', 'endpoint', 'route', 'controller', 'service', 'rest', 'graphql', 'request', 'response'],
  database: ['database', 'db', 'sql', 'query', 'model', 'entity', 'migration', 'schema'],
  testing: ['test', 'spec', 'mock', 'stub', 'jest', 'vitest', 'coverage'],
  error: ['error', 'exception', 'catch', 'throw', 'handle', 'fail', 'retry'],
  file: ['file', 'fs', 'read', 'write', 'path', 'directory', 'folder'],
  config: ['config', 'configuration', 'settings', 'options', 'environment', 'env'],
  refactor: ['refactor', 'clean', 'organize', 'improve', 'optimize', 'rename']
};

// ============================================================
// Index Management
// ============================================================

/**
 * Ensure section index is up to date
 * @returns {Object} - Index object
 */
async function ensureIndex() {
  // Check if index needs regeneration
  if (needsRegeneration()) {
    const result = generateSectionIndex({ force: true });
    if (result.success) {
      // Sync to database
      const index = readIndex();
      if (index) {
        await syncSectionsFromIndex(index);
      }
    }
  }

  return readIndex();
}

/**
 * Force regenerate index and sync to database
 * @returns {Object} - { indexStats, dbStats }
 */
async function refreshIndex() {
  const indexResult = generateSectionIndex({ force: true });
  const index = readIndex();

  let dbResult = { synced: 0, updated: 0, unchanged: 0 };
  if (index) {
    dbResult = await syncSectionsFromIndex(index);
  }

  return {
    indexStats: indexResult.stats,
    dbStats: dbResult
  };
}

// ============================================================
// Section Resolution
// ============================================================

/**
 * Get a single section by ID
 * @param {string} sectionId - Section ID (e.g., "coding-standards:security-patterns")
 * @param {Object} options - { useDatabase: boolean, trackAccess: boolean }
 * @returns {Object|null} - Section object or null
 */
async function getSection(sectionId, options = {}) {
  const { useDatabase = true, trackAccess = true } = options;

  // Try database first (has access tracking)
  if (useDatabase) {
    const dbSection = await dbGetSectionById(sectionId, trackAccess);
    if (dbSection) return dbSection;
  }

  // Fall back to index file
  const indexSection = getIndexSectionById(sectionId);
  return indexSection;
}

/**
 * Get multiple sections by IDs
 * @param {string[]} sectionIds - Array of section IDs
 * @param {Object} options - { useDatabase: boolean }
 * @returns {Object[]} - Array of section objects
 */
async function getSections(sectionIds, options = {}) {
  const sections = [];

  for (const id of sectionIds) {
    const section = await getSection(id, options);
    if (section) {
      sections.push(section);
    }
  }

  return sections;
}

/**
 * Get sections matching pins/keywords
 * @param {string[]} pins - Pins to match
 * @param {Object} options - { limit: number, useDatabase: boolean }
 * @returns {Object[]} - Matching sections with scores
 */
async function getSectionsByPins(pins, options = {}) {
  const { limit = 10, useDatabase = true } = options;

  if (useDatabase) {
    return await dbSearchSectionsByPins(pins, { limit });
  }

  // Fall back to index
  return getIndexSectionsByPins(pins).slice(0, limit);
}

/**
 * Get sections relevant to a task description
 * Uses keyword extraction and semantic matching
 * @param {string} taskDescription - Task description
 * @param {Object} options - { limit: number, minScore: number }
 * @returns {Object[]} - Relevant sections
 */
async function getSectionsForTask(taskDescription, options = {}) {
  const { limit = 5, minScore = 0.1 } = options;

  // Extract keywords/pins from task description
  const extractedPins = extractPinsFromTask(taskDescription);

  // Search by pins first (fast)
  const pinMatches = await dbSearchSectionsByPins(extractedPins, { limit: limit * 2 });

  // Also try semantic search if available
  const semanticMatches = await searchSectionsBySimilarity(taskDescription, { limit: limit * 2 });

  // Combine and deduplicate
  const combined = new Map();

  for (const section of pinMatches) {
    combined.set(section.id, {
      ...section,
      score: section.matchScore || 0,
      matchType: 'pin'
    });
  }

  for (const section of semanticMatches) {
    if (combined.has(section.id)) {
      // Boost score if matched by both methods
      const existing = combined.get(section.id);
      existing.score = Math.max(existing.score, section.similarity || 0) * 1.2;
      existing.matchType = 'both';
    } else {
      combined.set(section.id, {
        ...section,
        score: section.similarity || 0,
        matchType: 'semantic'
      });
    }
  }

  // Sort by score and filter
  const results = Array.from(combined.values())
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Extract pins/keywords from a task description
 * @param {string} taskDescription - Task description
 * @returns {string[]} - Extracted pins
 */
function extractPinsFromTask(taskDescription) {
  const pins = new Set();
  const descLower = taskDescription.toLowerCase();

  // Match against task keyword categories
  for (const [category, keywords] of Object.entries(TASK_KEYWORDS)) {
    const matchCount = keywords.filter(kw => descLower.includes(kw)).length;
    if (matchCount > 0) {
      pins.add(category);
      // Add the specific keywords that matched
      keywords.filter(kw => descLower.includes(kw)).forEach(kw => pins.add(kw));
    }
  }

  // Extract PascalCase words (likely component names)
  const pascalMatches = taskDescription.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g);
  if (pascalMatches) {
    pascalMatches.forEach(m => pins.add(m.toLowerCase()));
  }

  // Extract significant words
  const words = descLower
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['that', 'this', 'with', 'from', 'have', 'will', 'should', 'could', 'would'].includes(w));

  words.forEach(w => pins.add(w));

  return Array.from(pins);
}

// ============================================================
// Context Formatting
// ============================================================

/**
 * Format sections into context string for prompts
 * @param {Object[]} sections - Array of section objects
 * @param {Object} options - { format: 'full' | 'summary' | 'reference' }
 * @returns {string} - Formatted context
 */
function formatSectionsAsContext(sections, options = {}) {
  const { format = 'full' } = options;

  if (sections.length === 0) {
    return '';
  }

  let context = '## Relevant Project Rules\n\n';

  for (const section of sections) {
    const source = section.source || 'unknown';
    const category = section.category || 'General';

    switch (format) {
      case 'reference':
        // Just the title and ID
        context += `- **${section.title}** (${source}:${section.id})\n`;
        break;

      case 'summary':
        // Title and first line of content
        const firstLine = section.content?.split('\n')[0] || '';
        context += `### ${section.title}\n`;
        context += `*From: ${source} > ${category}*\n`;
        context += `${firstLine}\n\n`;
        break;

      case 'full':
      default:
        // Full content
        context += `### ${section.title}\n`;
        context += `*From: ${source} > ${category}*\n\n`;
        context += `${section.content}\n\n`;
        break;
    }
  }

  return context.trim();
}

/**
 * Format sections as targeted references for prompts
 * Used when we want to tell the model "follow rule X" without full content
 * @param {Object[]} sections - Array of section objects
 * @returns {string} - Formatted reference string
 */
function formatSectionsAsReferences(sections) {
  if (sections.length === 0) {
    return '';
  }

  const refs = sections.map(s => {
    const source = s.source?.replace('.md', '') || 'decisions';
    return `${source}:${s.id}`;
  });

  return `Follow rules: ${refs.join(', ')}`;
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Get all security-related sections
 * @returns {Object[]} - Security sections
 */
async function getSecuritySections() {
  return await getSectionsByPins([
    'security', 'try-catch', 'error-handling', 'json-safety',
    'prototype-pollution', 'path-traversal', 'input-validation'
  ], { limit: 10 });
}

/**
 * Get all component-related sections
 * @returns {Object[]} - Component sections
 */
async function getComponentSections() {
  return await getSectionsByPins([
    'component', 'component-creation', 'component-reuse',
    'component-naming', 'variant-naming', 'ui'
  ], { limit: 10 });
}

/**
 * Get all naming convention sections
 * @returns {Object[]} - Naming sections
 */
async function getNamingConventionSections() {
  return await getSectionsByPins([
    'naming-convention', 'file-naming', 'variant-naming',
    'naming', 'convention', 'kebab-case'
  ], { limit: 10 });
}

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'refresh':
      info('Refreshing section index...');
      const refreshResult = await refreshIndex();
      console.log('Index stats:', refreshResult.indexStats);
      console.log('DB sync:', refreshResult.dbStats);
      break;

    case 'get':
      const sectionId = args[1];
      if (!sectionId) {
        console.error('Usage: flow-section-resolver get <section-id>');
        process.exit(1);
      }
      const section = await getSection(sectionId);
      if (section) {
        console.log(JSON.stringify(section, null, 2));
      } else {
        console.log(`Section not found: ${sectionId}`);
      }
      break;

    case 'find':
      const pins = args.slice(1);
      if (pins.length === 0) {
        console.error('Usage: flow-section-resolver find <pin1> [pin2] ...');
        process.exit(1);
      }
      const matches = await getSectionsByPins(pins);
      console.log(`Found ${matches.length} matching sections:`);
      for (const m of matches) {
        console.log(`  ${m.id} (score: ${m.matchScore?.toFixed(2) || 'N/A'})`);
      }
      break;

    case 'task':
      const taskDesc = args.slice(1).join(' ');
      if (!taskDesc) {
        console.error('Usage: flow-section-resolver task "<task description>"');
        process.exit(1);
      }
      const relevant = await getSectionsForTask(taskDesc);
      console.log(`Found ${relevant.length} relevant sections for task:`);
      for (const r of relevant) {
        console.log(`  ${r.id} (score: ${r.score?.toFixed(2)}, type: ${r.matchType})`);
      }
      break;

    case 'stats':
      const stats = await getSectionStats();
      console.log('Section statistics:');
      console.log(JSON.stringify(stats, null, 2));
      break;

    default:
      console.log(`
Usage: node scripts/flow-section-resolver.js <command> [args]

Commands:
  refresh              Regenerate index and sync to database
  get <section-id>     Get a section by ID
  find <pins...>       Find sections matching pins
  task "<description>" Find sections relevant to a task
  stats                Show section statistics

Examples:
  node scripts/flow-section-resolver.js get coding-standards:security-patterns-2026-01-11
  node scripts/flow-section-resolver.js find security error-handling
  node scripts/flow-section-resolver.js task "Add user authentication"
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Index management
  ensureIndex,
  refreshIndex,

  // Section resolution
  getSection,
  getSections,
  getSectionsByPins,
  getSectionsForTask,

  // Keyword extraction
  extractPinsFromTask,

  // Formatting
  formatSectionsAsContext,
  formatSectionsAsReferences,

  // Convenience
  getSecuritySections,
  getComponentSections,
  getNamingConventionSections,

  // Re-export stats
  getSectionStats
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
