#!/usr/bin/env node

/**
 * Wogi Flow - Cross-Artifact Consistency Checker
 *
 * Validates that app-map.md, function-map.md, and api-map.md
 * are consistent with each other and the actual codebase.
 *
 * Inspired by: GitHub Spec Kit's cross-artifact analysis
 * where multiple specification documents are validated against
 * each other for consistency.
 *
 * Checks performed:
 * 1. app-map vs codebase: Do listed components actually exist?
 * 2. function-map vs codebase: Do listed functions actually exist?
 * 3. api-map vs codebase: Do listed API endpoints actually exist?
 * 4. Cross-map: Are references between maps consistent?
 * 5. Orphan detection: Find files not in any map
 *
 * Usage:
 *   node flow-consistency-check.js check [--json] [--fix]
 *   node flow-consistency-check.js orphans
 *   node flow-consistency-check.js stats
 *
 * Programmatic:
 *   const { runConsistencyCheck } = require('./flow-consistency-check');
 *   const results = runConsistencyCheck();
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  getConfig,
  success,
  warn,
  error,
  safeJsonParse,
  isPathWithinProject
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/** File extensions considered as source code */
const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.go', '.rs', '.java', '.kt'
]);

/** Directories to skip during scanning */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '__pycache__', '.workflow', '.claude', 'coverage'
]);

/** Default directories to check for orphan detection */
const DEFAULT_COMPONENT_DIRS = ['src/components', 'src/hooks', 'src/services', 'src/pages'];

/** Maximum directory scan depth (prevents symlink loops and stack overflow) */
const MAX_SCAN_DEPTH = 20;

// ============================================================
// Map Parsing
// ============================================================

/** Header row indicators to skip during table parsing */
const HEADER_NAMES = new Set(['component', 'function', 'name', 'method', 'endpoint']);

/**
 * Read a map file and return its content, or null if unavailable
 * @param {string} fileName - Map file name (e.g., 'app-map.md')
 * @returns {string|null} File content or null
 */
function readMapFile(fileName) {
  const mapPath = path.join(PATHS.state, fileName);
  if (!fs.existsSync(mapPath)) {
    return null;
  }
  try {
    return fs.readFileSync(mapPath, 'utf-8');
  } catch (err) {
    warn(`Failed to read ${fileName}: ${err.message}`);
    return null;
  }
}

/**
 * Check if a table row name is a header row
 * @param {string} name - Parsed name from table
 * @returns {boolean}
 */
function isHeaderRow(name) {
  return name.includes('---') || HEADER_NAMES.has(name.toLowerCase());
}

/**
 * Extract component entries from app-map.md
 * Parses markdown tables and lists to find component references.
 *
 * Supports multiple table formats:
 *   2-col: | Name | path/to/file.tsx |
 *   4-col: | Component | Variants | path/to/file.tsx | Details |
 *   (any column containing a file-like path is extracted)
 *
 * @returns {Object[]} Array of { name, path, type }
 */
function parseAppMap() {
  const content = readMapFile('app-map.md');
  if (!content) return [];

  const entries = [];

  // Parse table rows generically: extract the first column as name,
  // then find a column containing a file path (with extension).
  // This handles 2-col, 3-col, and 4-col tables.
  const lines = content.split('\n');
  for (const line of lines) {
    // Must be a table row
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 2) continue;

    const name = cells[0].replace(/`/g, '').trim();
    if (isHeaderRow(name)) continue;
    // Skip separator rows
    if (/^[-:]+$/.test(name)) continue;
    // Skip italic placeholder rows
    if (name.startsWith('_') && name.endsWith('_')) continue;

    // Find a cell that looks like a file path (contains a dot-extension)
    const pathCell = cells.find((c, i) => i > 0 && /[a-zA-Z0-9_/-]+\.[a-z]{1,5}/.test(c));
    if (!pathCell) continue;
    // Extract the path, stripping backticks, markdown links, etc.
    const fileMatch = pathCell.match(/`?([^`\s()\[\]]+\.[a-z]{1,5})`?/);
    if (!fileMatch) continue;
    const filePath = fileMatch[1].trim();

    entries.push({ name, path: filePath, type: 'component', source: 'app-map' });
  }

  // Parse list entries: - **ComponentName** (`path/to/file.tsx`)
  // Requires bold marker (**Name**) immediately after bullet to avoid matching prose lines
  const listPattern = /^[-*]\s+\*\*([^*]+)\*\*\s*\(?`([^`]+\.[a-z]+)`\)?/gim;
  let match;
  while ((match = listPattern.exec(content)) !== null) {
    const name = match[1].trim();
    const filePath = match[2].trim();
    entries.push({ name, path: filePath, type: 'component', source: 'app-map' });
  }

  return entries;
}

/**
 * Extract function entries from function-map.md
 *
 * Supports two formats:
 *   Table: | functionName | path/to/file.js | description |
 *   Heading: ### functionName / **File**: path/to/file.js
 *
 * @returns {Object[]} Array of { name, path, type }
 */
function parseFunctionMap() {
  const content = readMapFile('function-map.md');
  if (!content) return [];

  const entries = [];

  // Format 1: Table rows: | functionName | path/to/file.js | description |
  const tablePattern = /\|\s*`?([^|`]+?)`?\s*\|\s*`?([^|`]+\.[a-z]+)`?\s*\|/gi;
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    const name = match[1].trim();
    const filePath = match[2].trim();
    if (isHeaderRow(name)) continue;
    entries.push({ name, path: filePath, type: 'function', source: 'function-map' });
  }

  // Format 2: Heading + **File** metadata (actual format used by function-map.md)
  // ### functionName
  // **File**: path/to/file.js
  const lines = content.split('\n');
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    // Skip fenced code blocks
    if (lines[i].trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const headingMatch = lines[i].match(/^###\s+(\w+)/);
    if (!headingMatch) continue;
    const name = headingMatch[1];
    // Look for **File**: in the next few lines
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (lines[j].trimStart().startsWith('```')) break;
      const fileMatch = lines[j].match(/\*\*File\*\*:\s*(.+)/);
      if (fileMatch) {
        const filePath = fileMatch[1].trim();
        entries.push({ name, path: filePath, type: 'function', source: 'function-map' });
        break;
      }
      // Stop if we hit another heading
      if (lines[j].startsWith('###')) break;
    }
  }

  return entries;
}

/**
 * Extract API endpoint entries from api-map.md
 *
 * Supports two formats:
 *   Table: | GET | /api/users | path/to/handler.ts | description |
 *   Heading: ### GET /api/users / **File**: path/to/handler.ts
 *
 * @returns {Object[]} Array of { name, path, type, method, endpoint }
 */
function parseApiMap() {
  const content = readMapFile('api-map.md');
  if (!content) return [];

  const entries = [];

  // Format 1: Table rows: | GET | /api/users | path/to/handler.ts | description |
  const tablePattern = /\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*([^|]+?)\s*\|\s*`?([^|`]+\.[a-z]+)`?\s*\|/gi;
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    const method = match[1].trim();
    const endpoint = match[2].trim();
    const filePath = match[3].trim();

    entries.push({
      name: `${method} ${endpoint}`,
      path: filePath,
      type: 'api',
      method,
      endpoint,
      source: 'api-map'
    });
  }

  // Format 2: Heading + **File** metadata (actual format used by api-map.md)
  // ### GET /api/users
  // **File**: path/to/handler.ts
  const lines = content.split('\n');
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const headingMatch = lines[i].match(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
    if (!headingMatch) continue;
    const method = headingMatch[1].toUpperCase();
    const endpoint = headingMatch[2];
    // Look for **File**: in the next few lines
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (lines[j].trimStart().startsWith('```')) break;
      const fileMatch = lines[j].match(/\*\*File\*\*:\s*(.+)/);
      if (fileMatch) {
        const filePath = fileMatch[1].trim();
        entries.push({
          name: `${method} ${endpoint}`,
          path: filePath,
          type: 'api',
          method,
          endpoint,
          source: 'api-map'
        });
        break;
      }
      if (lines[j].startsWith('###')) break;
    }
  }

  return entries;
}

/**
 * Parse any additional registry maps (schema-map, service-map, etc.)
 * Uses a generic table parser to extract file path references.
 * @returns {Object[]} Array of { name, path, type, source }
 */
function parseAdditionalRegistryMaps() {
  const entries = [];
  try {
    const { getActiveRegistries } = require('./flow-utils');
    const knownMaps = new Set(['app-map.md', 'function-map.md', 'api-map.md']);
    for (const reg of getActiveRegistries()) {
      if (knownMaps.has(reg.mapFile)) continue; // Already handled by specific parsers
      const content = readMapFile(reg.mapFile);
      if (!content) continue;
      // Generic parser: extract table rows with file paths
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.startsWith('|') || line.includes('---')) continue;
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length < 2) continue;
        const name = cols[0];
        if (isHeaderRow(name)) continue;
        // Find a column containing a file path
        const pathCol = cols.find(c => /\.(ts|js|tsx|jsx|py|go|prisma|java|kt|rb|rs)$/.test(c));
        if (pathCol) {
          entries.push({ name, path: pathCol, type: reg.type || reg.id, source: reg.mapFile });
        }
      }
    }
  } catch (err) {
    // Fallback: no additional registries — log if debug enabled
    if (process.env.DEBUG) {
      console.error(`[consistency-check] Registry scan fallback: ${err.message}`);
    }
  }
  return entries;
}

// ============================================================
// Codebase Scanning
// ============================================================

/**
 * Get all source files in the project
 * @returns {string[]} Array of relative file paths
 */
function getSourceFiles() {
  const files = [];

  function scan(dir, relativePath, depth) {
    if (depth > MAX_SCAN_DEPTH) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath, relPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(relPath);
        }
      }
    }
  }

  scan(PATHS.root, '', 0);
  return files;
}

// ============================================================
// Consistency Checks
// ============================================================

/**
 * Check if a map entry's file exists in the codebase
 * @param {Object} entry - Map entry with path
 * @returns {Object} Check result
 */
function checkFileExists(entry) {
  const fullPath = path.join(PATHS.root, entry.path);

  if (!isPathWithinProject(fullPath)) {
    return {
      entry,
      exists: false,
      severity: 'error',
      message: `Unsafe path blocked: ${entry.path} (listed in ${entry.source} as "${entry.name}")`
    };
  }

  const exists = fs.existsSync(fullPath);

  return {
    entry,
    exists,
    severity: exists ? 'ok' : 'error',
    message: exists
      ? `Found: ${entry.path}`
      : `Missing: ${entry.path} (listed in ${entry.source} as "${entry.name}")`
  };
}

/**
 * Run all consistency checks
 * @param {Object} [options] - Options
 * @returns {Object} Check results
 */
function runConsistencyCheck(options = {}) {
  const config = getConfig();
  const consistencyConfig = config.consistency || {};

  if (!consistencyConfig.enabled) {
    return { skipped: true, reason: 'Consistency checking is disabled' };
  }

  const checks = consistencyConfig.checks || {};
  const results = {
    timestamp: new Date().toISOString(),
    checks: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    }
  };

  // Cache parsed results to avoid double I/O
  const appMapEntries = checks.appMapVsCodebase !== false || checks.orphanDetection !== false ? parseAppMap() : [];
  const functionMapEntries = checks.functionMapVsCodebase !== false || checks.orphanDetection !== false ? parseFunctionMap() : [];
  const apiMapEntries = checks.apiMapVsCodebase !== false || checks.orphanDetection !== false ? parseApiMap() : [];
  const additionalEntries = checks.orphanDetection !== false ? parseAdditionalRegistryMaps() : [];

  // 1. App-map vs codebase
  if (checks.appMapVsCodebase !== false) {
    for (const entry of appMapEntries) {
      const result = checkFileExists(entry);
      results.checks.push(result);
      results.summary.total++;
      if (result.exists) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
    }
  }

  // 2. Function-map vs codebase
  if (checks.functionMapVsCodebase !== false) {
    for (const entry of functionMapEntries) {
      const result = checkFileExists(entry);
      results.checks.push(result);
      results.summary.total++;
      if (result.exists) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
    }
  }

  // 3. API-map vs codebase
  if (checks.apiMapVsCodebase !== false) {
    for (const entry of apiMapEntries) {
      const result = checkFileExists(entry);
      results.checks.push(result);
      results.summary.total++;
      if (result.exists) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
    }
  }

  // 4. Orphan detection
  if (checks.orphanDetection !== false) {
    const allMapPaths = new Set();
    const allEntries = [...appMapEntries, ...functionMapEntries, ...apiMapEntries];

    for (const entry of allEntries) {
      allMapPaths.add(entry.path);
    }

    // Get configured source directories
    const componentDirs = config.componentIndex?.directories || DEFAULT_COMPONENT_DIRS;
    const sourceFiles = getSourceFiles();

    const orphans = [];
    for (const file of sourceFiles) {
      // Only check files in configured directories
      const inConfiguredDir = componentDirs.some(dir => file.startsWith(dir));
      if (!inConfiguredDir) continue;

      // Skip test files and index files
      if (/\.(test|spec|stories)\./i.test(file)) continue;
      if (/^index\.[jt]sx?$/.test(path.basename(file))) continue;

      if (!allMapPaths.has(file)) {
        orphans.push(file);
      }
    }

    const maxOrphans = consistencyConfig.maxOrphans || 10;
    const displayOrphans = orphans.slice(0, maxOrphans);

    if (orphans.length > 0) {
      results.orphans = {
        total: orphans.length,
        displayed: displayOrphans,
        truncated: orphans.length > maxOrphans
      };
      results.summary.warnings += orphans.length;
    }
  }

  // TODO: Implement crossMapConsistency check (config key exists but check is not yet implemented)
  // This would verify that components referenced in one map exist in others
  // (e.g., a function used by a component is also in function-map)

  // Determine overall status
  const mode = consistencyConfig.mode || 'warn';
  const orphanMode = consistencyConfig.orphanMode || 'warn';
  results.passed = results.summary.failed === 0;
  // Orphans block only when orphanMode is explicitly set to 'block'
  const orphansBlock = orphanMode === 'block' && results.summary.warnings > 0;
  results.blocked = (mode === 'block' && !results.passed) || orphansBlock;

  return results;
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format consistency check results for display
 * @param {Object} results - Check results
 * @returns {string} Formatted output
 */
function formatResults(results) {
  if (results.skipped) {
    return `Consistency check skipped: ${results.reason}`;
  }

  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('  CROSS-ARTIFACT CONSISTENCY CHECK');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // Group checks by source
  const bySource = {};
  for (const check of results.checks) {
    const source = check.entry.source;
    if (!bySource[source]) bySource[source] = [];
    bySource[source].push(check);
  }

  for (const [source, checks] of Object.entries(bySource)) {
    const passed = checks.filter(c => c.exists).length;
    const total = checks.length;
    const icon = passed === total ? '✓' : '✗';

    lines.push(`  ${icon} ${source}: ${passed}/${total} entries verified`);

    // Show failures
    const failures = checks.filter(c => !c.exists);
    for (const f of failures) {
      lines.push(`    ✗ ${f.entry.name} → ${f.entry.path}`);
    }

    if (failures.length > 0) lines.push('');
  }

  // Show orphans
  if (results.orphans && results.orphans.total > 0) {
    lines.push(`  ⚠ Orphan files: ${results.orphans.total} files not in any map`);
    for (const orphan of results.orphans.displayed) {
      lines.push(`    ? ${orphan}`);
    }
    if (results.orphans.truncated) {
      lines.push(`    ... and ${results.orphans.total - results.orphans.displayed.length} more`);
    }
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const statusIcon = results.passed ? '✓' : '✗';
  const statusText = results.passed ? 'All checks passed' : `${results.summary.failed} inconsistencies found`;
  lines.push(`  ${statusIcon} ${statusText}`);

  if (results.summary.warnings > 0) {
    lines.push(`  ⚠ ${results.summary.warnings} warnings`);
  }

  if (results.blocked) {
    lines.push('');
    lines.push('  ⛔ Task blocked until inconsistencies are resolved.');
    lines.push('  Fix the missing files or update the map entries.');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Parsers
  parseAppMap,
  parseFunctionMap,
  parseApiMap,
  parseAdditionalRegistryMaps,

  // Checks
  runConsistencyCheck,

  // Utilities
  getSourceFiles,

  // Formatting
  formatResults
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  switch (command) {
    case 'check': {
      const results = runConsistencyCheck();

      if (args.includes('--json')) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(formatResults(results));
      }

      if (results.blocked) {
        process.exit(1);
      }
      break;
    }

    case 'orphans': {
      const results = runConsistencyCheck();
      if (results.orphans && results.orphans.total > 0) {
        console.log(`Found ${results.orphans.total} orphan files:`);
        // Show all orphans, not just truncated
        const allMapPaths = new Set();
        const allEntries = [
          ...parseAppMap(),
          ...parseFunctionMap(),
          ...parseApiMap(),
          ...parseAdditionalRegistryMaps()
        ];
        for (const entry of allEntries) allMapPaths.add(entry.path);

        const config = getConfig();
        const componentDirs = config.componentIndex?.directories || DEFAULT_COMPONENT_DIRS;
        const sourceFiles = getSourceFiles();

        for (const file of sourceFiles) {
          const inConfiguredDir = componentDirs.some(dir => file.startsWith(dir));
          if (!inConfiguredDir) continue;
          if (/\.(test|spec|stories)\./i.test(file)) continue;
          if (/^index\.[jt]sx?$/.test(path.basename(file))) continue;
          if (!allMapPaths.has(file)) {
            console.log(`  ${file}`);
          }
        }
      } else {
        success('No orphan files found.');
      }
      break;
    }

    case 'stats': {
      const appMap = parseAppMap();
      const funcMap = parseFunctionMap();
      const apiMap = parseApiMap();
      const additional = parseAdditionalRegistryMaps();

      console.log('Cross-Artifact Stats:');
      console.log(`  app-map entries: ${appMap.length}`);
      console.log(`  function-map entries: ${funcMap.length}`);
      console.log(`  api-map entries: ${apiMap.length}`);
      if (additional.length > 0) console.log(`  additional registry entries: ${additional.length}`);
      console.log(`  Total tracked: ${appMap.length + funcMap.length + apiMap.length + additional.length}`);
      break;
    }

    default:
      console.log(`
Cross-Artifact Consistency Checker

Usage: node flow-consistency-check <command> [options]

Commands:
  check              Run all consistency checks (default)
  orphans            List files not registered in any map
  stats              Show map entry counts

Options:
  --json             Output in JSON format

Examples:
  node flow-consistency-check check
  node flow-consistency-check check --json
  node flow-consistency-check orphans
  node flow-consistency-check stats
`);
  }
}
