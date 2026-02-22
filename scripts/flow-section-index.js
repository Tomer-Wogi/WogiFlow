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
  'variant-naming': ['variant', 'size', 'intent', 'state', 'primary', 'secondary'],

  // Model profiles (Hybrid Mode Intelligence)
  'model-profile': ['profile', 'model', 'llm', 'executor'],
  'model-learning': ['learning', 'failure', 'retry', 'missing'],
  'model-settings': ['settings', 'optimal', 'example', 'context-density'],

  // Task types (Hybrid Mode Intelligence)
  'task-create': ['create', 'new', 'add', 'implement', 'build'],
  'task-modify': ['modify', 'update', 'change', 'edit', 'alter'],
  'task-refactor': ['refactor', 'restructure', 'reorganize', 'extract'],
  'task-fix': ['fix', 'bug', 'error', 'issue', 'broken', 'debug'],
  'task-integrate': ['integrate', 'connect', 'wire', 'combine', 'api'],

  // Context generation (Hybrid Mode Intelligence)
  'available-imports': ['import', 'available', 'imports', 'import-map'],
  'project-exports': ['export', 'exports', 'available-components'],
  'code-patterns': ['pattern', 'patterns', 'convention', 'style'],
  'project-context': ['context', 'project', 'codebase', 'structure']
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
// Generic PIN Document Parser
// ============================================================

/**
 * Parse any markdown document with explicit PIN markers
 * Supports: <!-- PIN: xxx --> and <!-- PINS: a, b, c --> formats
 * @param {string} content - File content
 * @param {string} sourceName - Source identifier (e.g., "product.md")
 * @returns {Object[]} - Array of indexed sections
 */
function parsePinnedDocument(content, sourceName) {
  const sections = [];
  const lines = content.split('\n');

  // Extract document-level pins from header comment
  const headerPinsMatch = content.match(/<!--\s*PINS:\s*([^>]+)\s*-->/i);
  const documentPins = headerPinsMatch
    ? headerPinsMatch[1].split(',').map(p => p.trim().toLowerCase())
    : [];

  let currentSection = null;
  let currentContent = [];
  let currentPins = [];
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for PIN marker
    const pinMatch = line.match(/<!--\s*PIN:\s*([^>]+)\s*-->/i);
    if (pinMatch) {
      currentPins = pinMatch[1].split(',').map(p => p.trim().toLowerCase());
      continue;
    }

    // Match ## or ### headers (sections)
    const headerMatch = line.match(/^(#{2,3})\s+(.+)$/);
    if (headerMatch) {
      // Save previous section
      if (currentSection && currentContent.length > 0) {
        const trimmedContent = currentContent.join('\n').trim();
        if (trimmedContent) {
          sections.push(createPinnedSection(
            sourceName,
            currentSection,
            trimmedContent,
            currentPins,
            documentPins,
            lineStart,
            i - 1
          ));
        }
      }

      currentSection = headerMatch[2].trim();
      currentContent = [];
      currentPins = [];
      lineStart = i + 1;
      continue;
    }

    // Accumulate content
    if (currentSection) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection && currentContent.length > 0) {
    const trimmedContent = currentContent.join('\n').trim();
    if (trimmedContent) {
      sections.push(createPinnedSection(
        sourceName,
        currentSection,
        trimmedContent,
        currentPins,
        documentPins,
        lineStart,
        lines.length - 1
      ));
    }
  }

  return sections;
}

/**
 * Create a pinned section object
 */
function createPinnedSection(sourceName, title, content, sectionPins, documentPins, lineStart, lineEnd) {
  const sourceSlug = slugify(sourceName.replace('.md', ''));
  const titleSlug = slugify(title);
  const id = `${sourceSlug}:${titleSlug}`;

  // Combine section pins, document pins, and auto-generated pins
  const allPins = new Set([
    ...sectionPins,
    ...documentPins,
    ...generatePins(title, content)
  ]);

  return {
    id,
    title,
    source: sourceName,
    pins: Array.from(allPins),
    lineStart: lineStart + 1,
    lineEnd: lineEnd + 1,
    content,
    contentHash: hashContent(content)
  };
}

/**
 * Scan specs directory for markdown files with PIN markers
 * @returns {Object} - { files: [{ name, path, sections }] }
 */
function scanSpecsDirectory() {
  const specsDir = PATHS.specs;
  const results = [];

  if (!dirExists(specsDir)) {
    return results;
  }

  try {
    const files = fs.readdirSync(specsDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(specsDir, file);
      try {
        const content = readFile(filePath);

        // Check if file has PIN markers
        if (content.includes('<!-- PIN:') || content.includes('<!-- PINS:')) {
          const sections = parsePinnedDocument(content, file);
          results.push({
            name: file,
            path: filePath,
            lastModified: fs.statSync(filePath).mtime.toISOString(),
            contentHash: hashContent(content),
            sections
          });
        }
      } catch (err) {
        warn(`Error parsing ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    warn(`Error scanning specs directory: ${err.message}`);
  }

  return results;
}

/**
 * Scan a directory for markdown files with PIN markers
 * Generic version of scanSpecsDirectory for any directory
 * @param {string} dirPath - Directory path to scan
 * @param {string} sourceName - Source name for logging
 * @returns {Object[]} - Array of { name, path, sections }
 */
function scanPinnedDirectory(dirPath, sourceName = 'directory') {
  const results = [];

  if (!dirExists(dirPath)) {
    return results;
  }

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      if (file.startsWith('_')) continue; // Skip templates

      const filePath = path.join(dirPath, file);
      try {
        const content = readFile(filePath);

        // Parse as pinned document (always, to extract sections)
        const sections = parsePinnedDocument(content, file);
        if (sections.length > 0) {
          results.push({
            name: file,
            path: filePath,
            lastModified: fs.statSync(filePath).mtime.toISOString(),
            contentHash: hashContent(content),
            sections
          });
        }
      } catch (err) {
        warn(`Error parsing ${sourceName}/${file}: ${err.message}`);
      }
    }
  } catch (err) {
    warn(`Error scanning ${sourceName} directory: ${err.message}`);
  }

  return results;
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

  // Parse all active registry map files (cache registry list for reuse below)
  let activeRegistries = null;
  try {
    const { getActiveRegistries } = require('./flow-utils');
    activeRegistries = getActiveRegistries();
    for (const reg of activeRegistries) {
      const mapPath = path.join(PATHS.state, reg.mapFile);
      if (fileExists(mapPath)) {
        try {
          const mapContent = readFile(mapPath);
          const rows = parseAppMapRows(mapContent); // Generic table parser works for all maps
          index.sources[reg.mapFile] = {
            path: mapPath,
            lastModified: fs.statSync(mapPath).mtime.toISOString(),
            contentHash: hashContent(mapContent),
            rows
          };
        } catch (err) {
          warn(`Error parsing ${reg.mapFile}: ${err.message}`);
        }
      }
    }
  } catch {
    // Fallback: just parse app-map.md
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
  }

  // Parse specs/*.md files with PIN markers
  const specsFiles = scanSpecsDirectory();
  for (const specFile of specsFiles) {
    index.sources[`specs/${specFile.name}`] = {
      path: specFile.path,
      lastModified: specFile.lastModified,
      contentHash: specFile.contentHash,
      sections: specFile.sections
    };
  }

  // Parse model-profiles/*.md files (Hybrid Mode Intelligence)
  const modelProfilesDir = path.join(PATHS.state, 'model-profiles');
  const modelProfileFiles = scanPinnedDirectory(modelProfilesDir, 'model-profiles');
  for (const profileFile of modelProfileFiles) {
    index.sources[`model-profiles/${profileFile.name}`] = {
      path: profileFile.path,
      lastModified: profileFile.lastModified,
      contentHash: profileFile.contentHash,
      sections: profileFile.sections
    };
  }

  // Parse task-types/*.md files (Hybrid Mode Intelligence)
  const taskTypesDir = path.join(PATHS.state, 'task-types');
  const taskTypeFiles = scanPinnedDirectory(taskTypesDir, 'task-types');
  for (const taskFile of taskTypeFiles) {
    index.sources[`task-types/${taskFile.name}`] = {
      path: taskFile.path,
      lastModified: taskFile.lastModified,
      contentHash: taskFile.contentHash,
      sections: taskFile.sections
    };
  }

  // Parse context/*.md files (Hybrid Mode Intelligence)
  const contextDir = path.join(PATHS.state, 'context');
  const contextFiles = scanPinnedDirectory(contextDir, 'context');
  for (const contextFile of contextFiles) {
    index.sources[`context/${contextFile.name}`] = {
      path: contextFile.path,
      lastModified: contextFile.lastModified,
      contentHash: contextFile.contentHash,
      sections: contextFile.sections
    };
  }

  // Calculate stats
  const decisionsSections = index.sources['decisions.md']?.sections?.length || 0;
  // Count rows from all registry map sources
  let allMapRows = 0;
  if (activeRegistries) {
    for (const reg of activeRegistries) {
      allMapRows += index.sources[reg.mapFile]?.rows?.length || 0;
    }
  } else {
    allMapRows = index.sources['app-map.md']?.rows?.length || 0;
  }
  const specsSections = specsFiles.reduce((sum, f) => sum + f.sections.length, 0);
  const modelProfilesSections = modelProfileFiles.reduce((sum, f) => sum + f.sections.length, 0);
  const taskTypeSections = taskTypeFiles.reduce((sum, f) => sum + f.sections.length, 0);
  const contextSections = contextFiles.reduce((sum, f) => sum + f.sections.length, 0);

  index.stats = {
    totalSections: decisionsSections + specsSections + modelProfilesSections + taskTypeSections + contextSections,
    totalRows: allMapRows,
    specsFiles: specsFiles.length,
    modelProfiles: modelProfileFiles.length,
    taskTypes: taskTypeFiles.length,
    contextFiles: contextFiles.length,
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

  // Check all active registry map files
  try {
    const { getActiveRegistries } = require('./flow-utils');
    for (const reg of getActiveRegistries()) {
      const mapPath = path.join(PATHS.state, reg.mapFile);
      if (fileExists(mapPath)) {
        const currentHash = hashContent(readFile(mapPath));
        const indexedHash = existingIndex.sources[reg.mapFile]?.contentHash;
        if (currentHash !== indexedHash) return true;
      }
    }
  } catch {
    // Fallback: just check app-map.md
    if (fileExists(PATHS.appMap)) {
      const currentHash = hashContent(readFile(PATHS.appMap));
      const indexedHash = existingIndex.sources['app-map.md']?.contentHash;
      if (currentHash !== indexedHash) return true;
    }
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
  parsePinnedDocument,
  scanSpecsDirectory,
  scanPinnedDirectory,
  INDEX_PATH,
  PIN_KEYWORDS
};

// Run if called directly
if (require.main === module) {
  main();
}
