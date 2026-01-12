#!/usr/bin/env node

/**
 * Wogi Flow - Section Index Generator
 *
 * Creates a section-level index from decisions.md and app-map.md for
 * targeted context loading. Enables "pin" lookups and section references.
 *
 * Features:
 * - Parses decisions.md into indexed sections with semantic pins
 * - Parses app-map.md tables into indexed rows
 * - Auto-regenerates on file change (via watcher)
 * - Supports content hashing for change detection
 *
 * Part of Smart Context System (Phase 1)
 *
 * Usage:
 *   node scripts/flow-section-index.js           # Generate index
 *   node scripts/flow-section-index.js --watch   # Watch for changes
 *   node scripts/flow-section-index.js --json    # Output JSON result
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  writeFile,
  fileExists,
  dirExists,
  success,
  warn,
  info,
  error,
  parseFlags,
  outputJson,
  safeJsonParse
} = require('./flow-utils');

// Re-use existing section parser from flow-rules-sync
const { parseMarkdownSections, slugify } = require('./flow-rules-sync');

// ============================================================
// Configuration
// ============================================================

const INDEX_PATH = path.join(PATHS.state, 'section-index.json');
const DEBOUNCE_MS = 500;

// Keywords that generate semantic pins for different rule types
const PIN_KEYWORDS = {
  // Error handling
  'try-catch': ['try', 'catch', 'error', 'exception', 'throw', 'safe'],
  'error-handling': ['error', 'handle', 'exception', 'fail', 'catch'],

  // File operations
  'fs-read': ['fs', 'read', 'file', 'readFile', 'readFileSync'],
  'fs-write': ['fs', 'write', 'file', 'writeFile', 'writeFileSync'],
  'file-safety': ['file', 'path', 'fs', 'exists', 'check'],

  // JSON operations
  'json-parse': ['json', 'parse', 'JSON.parse', 'stringify'],
  'json-safety': ['json', 'safe', 'parse', 'validate'],

  // Security
  'prototype-pollution': ['prototype', '__proto__', 'constructor', 'injection'],
  'path-traversal': ['path', 'traversal', '..', 'join', 'resolve'],
  'input-validation': ['validate', 'sanitize', 'input', 'user'],

  // Components
  'component-creation': ['component', 'create', 'new', 'add'],
  'component-naming': ['component', 'name', 'naming', 'convention'],
  'component-reuse': ['component', 'reuse', 'existing', 'variant'],

  // Naming conventions
  'naming-convention': ['naming', 'convention', 'case', 'kebab', 'camel'],
  'file-naming': ['file', 'name', 'naming', 'kebab-case'],

  // Architecture
  'model-architecture': ['model', 'architecture', 'system', 'design'],
  'api-pattern': ['api', 'endpoint', 'route', 'controller'],

  // UI/UX
  'variant-naming': ['variant', 'size', 'intent', 'state', 'primary', 'secondary']
};

// ============================================================
// Pin Generation
// ============================================================

/**
 * Generate semantic pins for a section based on title and content
 * @param {string} title - Section title
 * @param {string} content - Section content
 * @returns {string[]} - Array of pins
 */
function generatePins(title, content) {
  const pins = new Set();
  const combined = `${title} ${content}`.toLowerCase();

  // Add pins based on keyword matches
  for (const [pin, keywords] of Object.entries(PIN_KEYWORDS)) {
    const matchCount = keywords.filter(kw => combined.includes(kw.toLowerCase())).length;
    // Require at least 2 keyword matches or strong single match
    if (matchCount >= 2 || (matchCount === 1 && combined.includes(pin.replace(/-/g, ' ')))) {
      pins.add(pin);
    }
  }

  // Extract significant words from title as pins
  const titleWords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(w));

  titleWords.forEach(w => pins.add(w));

  // Generate compound pins from title
  const titleSlug = slugify(title);
  pins.add(titleSlug);

  return Array.from(pins);
}

/**
 * Generate content hash for change detection
 * @param {string} content - Content to hash
 * @returns {string} - MD5 hash (first 8 chars)
 */
function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
}

// ============================================================
// Decisions.md Parser
// ============================================================

/**
 * Parse decisions.md into indexed sections with hierarchical structure
 * @param {string} content - File content
 * @returns {Object[]} - Array of indexed sections
 */
function parseDecisionsSections(content) {
  const sections = [];
  const lines = content.split('\n');

  let currentCategory = null;
  let currentSection = null;
  let currentContent = [];
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match ## headers (categories)
    const categoryMatch = line.match(/^##\s+(.+)$/);
    if (categoryMatch) {
      // Save previous section
      if (currentSection && currentContent.length > 0) {
        const trimmedContent = currentContent.join('\n').trim();
        if (trimmedContent && !trimmedContent.startsWith('<!--')) {
          sections.push(createDecisionSection(
            currentCategory,
            currentSection,
            trimmedContent,
            lineStart,
            i - 1
          ));
        }
      }

      currentCategory = categoryMatch[1].trim();
      currentSection = null;
      currentContent = [];
      continue;
    }

    // Match ### headers (sections within category)
    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      // Save previous section
      if (currentSection && currentContent.length > 0) {
        const trimmedContent = currentContent.join('\n').trim();
        if (trimmedContent && !trimmedContent.startsWith('<!--')) {
          sections.push(createDecisionSection(
            currentCategory,
            currentSection,
            trimmedContent,
            lineStart,
            i - 1
          ));
        }
      }

      currentSection = sectionMatch[1].trim();
      currentContent = [];
      lineStart = i + 1;
      continue;
    }

    // Accumulate content
    if (currentSection && line.trim() !== '---') {
      currentContent.push(line);
    } else if (currentCategory && !currentSection && line.trim() && line.trim() !== '---') {
      // Content directly under category (no subsection)
      currentSection = currentCategory;
      currentContent.push(line);
      lineStart = i;
    }
  }

  // Save last section
  if (currentSection && currentContent.length > 0) {
    const trimmedContent = currentContent.join('\n').trim();
    if (trimmedContent && !trimmedContent.startsWith('<!--')) {
      sections.push(createDecisionSection(
        currentCategory,
        currentSection,
        trimmedContent,
        lineStart,
        lines.length - 1
      ));
    }
  }

  return sections;
}

/**
 * Create a decision section object
 */
function createDecisionSection(category, title, content, lineStart, lineEnd) {
  const categorySlug = category ? slugify(category) : 'general';
  const titleSlug = slugify(title);
  const id = `${categorySlug}:${titleSlug}`;

  return {
    id,
    title,
    category: category || 'General',
    pins: generatePins(title, content),
    lineStart: lineStart + 1, // 1-indexed
    lineEnd: lineEnd + 1,
    content,
    contentHash: hashContent(content)
  };
}

// ============================================================
// App-Map.md Parser
// ============================================================

/**
 * Parse app-map.md tables into indexed rows
 * @param {string} content - File content
 * @returns {Object[]} - Array of indexed rows
 */
function parseAppMapRows(content) {
  const rows = [];
  const lines = content.split('\n');

  let currentCategory = null;
  let tableHeaders = null;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match ## headers (categories: Screens, Modals, Components)
    const categoryMatch = line.match(/^##\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      tableHeaders = null;
      inTable = false;
      continue;
    }

    // Match table header row
    if (line.startsWith('|') && line.includes('|') && !tableHeaders) {
      tableHeaders = parseTableRow(line);
      inTable = true;
      continue;
    }

    // Skip separator row
    if (line.match(/^\|[-\s|]+\|$/)) {
      continue;
    }

    // Parse table data row
    if (inTable && line.startsWith('|') && tableHeaders) {
      const cells = parseTableRow(line);
      if (cells.length > 0 && !cells[0].startsWith('_')) { // Skip example rows
        const row = createAppMapRow(currentCategory, tableHeaders, cells, i + 1);
        if (row) {
          rows.push(row);
        }
      }
    }

    // End of table
    if (inTable && !line.startsWith('|') && line.trim() !== '') {
      inTable = false;
      tableHeaders = null;
    }
  }

  return rows;
}

/**
 * Parse a table row into cells
 */
function parseTableRow(line) {
  return line
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell.length > 0);
}

/**
 * Create an app-map row object
 */
function createAppMapRow(category, headers, cells, lineNumber) {
  if (!category || cells.length < 2) return null;

  const categorySlug = slugify(category);
  const name = cells[0].replace(/[`*_]/g, ''); // Remove markdown formatting
  const nameSlug = slugify(name);
  const id = `${categorySlug}:${nameSlug}`;

  // Build data object from headers
  const data = {};
  headers.forEach((header, idx) => {
    if (cells[idx]) {
      data[header.toLowerCase()] = cells[idx].replace(/[`*_]/g, '');
    }
  });

  // Generate pins
  const pins = new Set([nameSlug, name.toLowerCase()]);

  // Add category-based pins
  if (category.toLowerCase().includes('screen')) {
    pins.add('screen');
    pins.add('page');
    pins.add('route');
  } else if (category.toLowerCase().includes('modal')) {
    pins.add('modal');
    pins.add('dialog');
    pins.add('popup');
  } else if (category.toLowerCase().includes('component')) {
    pins.add('component');
    pins.add('ui');
  }

  // Add variant pins if present
  if (data.variants) {
    data.variants.split(',').map(v => v.trim()).forEach(v => pins.add(v.toLowerCase()));
  }

  return {
    id,
    name,
    category,
    pins: Array.from(pins),
    line: lineNumber,
    path: data.path || null,
    status: data.status || null,
    variants: data.variants ? data.variants.split(',').map(v => v.trim()) : [],
    data
  };
}

// ============================================================
// Index Generation
// ============================================================

/**
 * Generate the full section index
 * @returns {Object} - Section index object
 */
function generateIndex() {
  const index = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    sources: {}
  };

  // Parse decisions.md
  if (fileExists(PATHS.decisions)) {
    try {
      const decisionsContent = readFile(PATHS.decisions);
      const sections = parseDecisionsSections(decisionsContent);
      index.sources['decisions.md'] = {
        path: PATHS.decisions,
        lastModified: fs.statSync(PATHS.decisions).mtime.toISOString(),
        contentHash: hashContent(decisionsContent),
        sections
      };
    } catch (err) {
      warn(`Error parsing decisions.md: ${err.message}`);
    }
  }

  // Parse app-map.md
  if (fileExists(PATHS.appMap)) {
    try {
      const appMapContent = readFile(PATHS.appMap);
      const rows = parseAppMapRows(appMapContent);
      index.sources['app-map.md'] = {
        path: PATHS.appMap,
        lastModified: fs.statSync(PATHS.appMap).mtime.toISOString(),
        contentHash: hashContent(appMapContent),
        rows
      };
    } catch (err) {
      warn(`Error parsing app-map.md: ${err.message}`);
    }
  }

  // Calculate stats
  const decisionsSections = index.sources['decisions.md']?.sections?.length || 0;
  const appMapRows = index.sources['app-map.md']?.rows?.length || 0;

  index.stats = {
    totalSections: decisionsSections,
    totalRows: appMapRows,
    totalPins: countUniquePins(index)
  };

  return index;
}

/**
 * Count unique pins across all sources
 */
function countUniquePins(index) {
  const pins = new Set();

  for (const source of Object.values(index.sources)) {
    const items = source.sections || source.rows || [];
    for (const item of items) {
      item.pins?.forEach(p => pins.add(p));
    }
  }

  return pins.size;
}

/**
 * Write index to file
 */
function writeIndex(index) {
  if (!dirExists(PATHS.state)) {
    fs.mkdirSync(PATHS.state, { recursive: true });
  }

  writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  return INDEX_PATH;
}

/**
 * Read existing index
 * Uses safeJsonParse for prototype pollution protection
 */
function readIndex() {
  if (!fileExists(INDEX_PATH)) {
    return null;
  }

  // Use safeJsonParse for security (prototype pollution protection)
  return safeJsonParse(INDEX_PATH, null);
}

/**
 * Check if index needs regeneration
 */
function needsRegeneration() {
  const existingIndex = readIndex();
  if (!existingIndex) return true;

  // Check decisions.md
  if (fileExists(PATHS.decisions)) {
    const currentHash = hashContent(readFile(PATHS.decisions));
    const indexedHash = existingIndex.sources['decisions.md']?.contentHash;
    if (currentHash !== indexedHash) return true;
  }

  // Check app-map.md
  if (fileExists(PATHS.appMap)) {
    const currentHash = hashContent(readFile(PATHS.appMap));
    const indexedHash = existingIndex.sources['app-map.md']?.contentHash;
    if (currentHash !== indexedHash) return true;
  }

  return false;
}

// ============================================================
// File Watcher
// ============================================================

let debounceTimer = null;

/**
 * Start watching source files for changes
 */
function startWatcher() {
  const filesToWatch = [PATHS.decisions, PATHS.appMap].filter(f => fileExists(f));

  if (filesToWatch.length === 0) {
    warn('No source files found to watch');
    return;
  }

  info(`Watching ${filesToWatch.length} files for changes...`);

  for (const filePath of filesToWatch) {
    fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        // Debounce rapid changes
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          info(`[${new Date().toISOString()}] Change detected, regenerating index...`);
          const index = generateIndex();
          writeIndex(index);
          success(`Section index regenerated (${index.stats.totalSections} sections, ${index.stats.totalRows} rows)`);
        }, DEBOUNCE_MS);
      }
    });
  }

  info('Press Ctrl+C to stop watching');
}

// ============================================================
// Public API
// ============================================================

/**
 * Generate and write section index
 * @param {Object} options - { force: boolean }
 * @returns {Object} - { success, indexPath, stats }
 */
function generateSectionIndex(options = {}) {
  const { force = false } = options;

  // Check if regeneration is needed
  if (!force && !needsRegeneration()) {
    const existingIndex = readIndex();
    return {
      success: true,
      skipped: true,
      indexPath: INDEX_PATH,
      stats: existingIndex.stats
    };
  }

  const index = generateIndex();
  const indexPath = writeIndex(index);

  return {
    success: true,
    skipped: false,
    indexPath,
    stats: index.stats
  };
}

/**
 * Get all sections matching pins
 * @param {string[]} pins - Pins to match
 * @returns {Object[]} - Matching sections
 */
function getSectionsByPins(pins) {
  const index = readIndex();
  if (!index) return [];

  const results = [];
  const pinsLower = pins.map(p => p.toLowerCase());

  for (const source of Object.values(index.sources)) {
    const items = source.sections || source.rows || [];
    for (const item of items) {
      const matchCount = item.pins?.filter(p => pinsLower.includes(p.toLowerCase())).length || 0;
      if (matchCount > 0) {
        results.push({
          ...item,
          source: source.path,
          matchCount,
          matchScore: matchCount / pinsLower.length
        });
      }
    }
  }

  // Sort by match score
  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Get section by ID
 * @param {string} sectionId - Section ID (e.g., "security:file-read-safety")
 * @returns {Object|null} - Section object or null
 */
function getSectionById(sectionId) {
  const index = readIndex();
  if (!index) return null;

  for (const source of Object.values(index.sources)) {
    const items = source.sections || source.rows || [];
    const found = items.find(item => item.id === sectionId);
    if (found) {
      return { ...found, source: source.path };
    }
  }

  return null;
}

// ============================================================
// Main
// ============================================================

function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: node scripts/flow-section-index.js [options]

Generate section-level index from decisions.md and app-map.md.

Options:
  --watch     Watch files for changes and auto-regenerate
  --force     Force regeneration even if no changes detected
  --json      Output result as JSON
  --help      Show this help message

Examples:
  node scripts/flow-section-index.js           # Generate index
  node scripts/flow-section-index.js --watch   # Watch for changes
  node scripts/flow-section-index.js --force   # Force regeneration
`);
    process.exit(0);
  }

  // Watch mode
  if (flags.watch) {
    // Generate initial index
    const result = generateSectionIndex({ force: true });
    if (result.success) {
      success(`Initial index generated: ${result.stats.totalSections} sections, ${result.stats.totalRows} rows`);
    }
    startWatcher();
    return;
  }

  // Generate index
  const result = generateSectionIndex({ force: flags.force });

  if (flags.json) {
    outputJson(result);
    return;
  }

  if (result.skipped) {
    info('Index is up to date (no changes detected)');
    info(`  Sections: ${result.stats.totalSections}`);
    info(`  Rows: ${result.stats.totalRows}`);
    info(`  Unique pins: ${result.stats.totalPins}`);
    return;
  }

  if (result.success) {
    success('Section index generated');
    info(`  Path: ${result.indexPath}`);
    info(`  Sections: ${result.stats.totalSections}`);
    info(`  Rows: ${result.stats.totalRows}`);
    info(`  Unique pins: ${result.stats.totalPins}`);
  } else {
    error('Failed to generate section index');
    process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  generateSectionIndex,
  getSectionsByPins,
  getSectionById,
  readIndex,
  needsRegeneration,
  generatePins,
  parseDecisionsSections,
  parseAppMapRows,
  INDEX_PATH
};

// Run if called directly
if (require.main === module) {
  main();
}
