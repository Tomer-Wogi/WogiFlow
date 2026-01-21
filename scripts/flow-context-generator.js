#!/usr/bin/env node

/**
 * Wogi Flow - Model-Routed Context Generator
 *
 * Generates project context using the appropriate model for each task:
 * - Scripts/Haiku: Mechanical tasks (file listing, export extraction)
 * - Sonnet: Pattern identification, component signatures
 * - Opus: Complex architectural analysis (only when needed)
 *
 * This reduces cost by using cheaper models for cheaper tasks.
 *
 * Part of Hybrid Mode Intelligence System
 *
 * Usage:
 *   const { generateProjectContext, runContextTask } = require('./flow-context-generator');
 *
 *   // Generate full project context
 *   const context = await generateProjectContext({ directories: ['src'] });
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  writeFile,
  fileExists,
  dirExists,
  info,
  warn,
  success,
  error: logError,
  parseFlags,
  outputJson,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const CONTEXT_DIR = path.join(PATHS.state, 'context');
const CONTEXT_CACHE_PATH = path.join(CONTEXT_DIR, 'context-cache.json');

// Task definitions with model routing
const CONTEXT_TASKS = {
  // Mechanical tasks - use scripts or Haiku
  listFiles: {
    model: 'script',
    description: 'List files in directories',
    fn: listFilesInDirectory
  },
  extractExports: {
    model: 'haiku',
    description: 'Extract exports from files',
    prompt: EXTRACT_EXPORTS_PROMPT()
  },
  buildImportMap: {
    model: 'haiku',
    description: 'Build import path mapping',
    prompt: BUILD_IMPORT_MAP_PROMPT()
  },
  generatePins: {
    model: 'haiku',
    description: 'Generate PIN markers for content',
    prompt: GENERATE_PINS_PROMPT()
  },

  // Pattern tasks - use Sonnet
  identifyPatterns: {
    model: 'sonnet',
    description: 'Identify code patterns',
    prompt: IDENTIFY_PATTERNS_PROMPT()
  },
  extractComponentSignature: {
    model: 'sonnet',
    description: 'Extract component signatures',
    prompt: EXTRACT_SIGNATURE_PROMPT()
  },

  // Complex tasks - use Opus only if needed
  architecturalAnalysis: {
    model: 'opus',
    description: 'Analyze architecture',
    prompt: ARCHITECTURE_PROMPT()
  }
};

// ============================================================
// Prompt Templates
// ============================================================

function EXTRACT_EXPORTS_PROMPT() {
  return `Analyze these TypeScript/JavaScript files and list all exports.

For each file, output:
- File path
- Named exports (functions, classes, constants)
- Default export (if any)
- Type exports (interfaces, types)

Output as JSON:
{
  "files": [
    {
      "path": "src/components/Button.tsx",
      "namedExports": ["Button", "ButtonProps"],
      "defaultExport": "Button",
      "typeExports": ["ButtonProps", "ButtonVariant"]
    }
  ]
}`;
}

function BUILD_IMPORT_MAP_PROMPT() {
  return `Given these export definitions, build an import map.

For each export, provide the correct import statement.

Output as JSON:
{
  "imports": {
    "Button": "import { Button } from '@/components/Button'",
    "useAuth": "import { useAuth } from '@/hooks/useAuth'"
  }
}`;
}

function GENERATE_PINS_PROMPT() {
  return `Generate semantic PIN markers for this content.

PINs are kebab-case keywords that describe what the content is about.
They enable targeted context loading.

For each section, output 2-5 relevant PINs.

Output as JSON:
{
  "sections": [
    {
      "title": "Authentication Flow",
      "pins": ["authentication", "login", "user-session", "auth-flow"]
    }
  ]
}`;
}

function IDENTIFY_PATTERNS_PROMPT() {
  return `Analyze these code files and identify recurring patterns:

1. Component structure patterns
2. State management patterns
3. API call patterns
4. Error handling patterns
5. Import organization patterns

For each pattern, provide:
- Name
- Description
- Example from codebase
- Files that use this pattern

Output as structured markdown with PIN markers.`;
}

function EXTRACT_SIGNATURE_PROMPT() {
  return `Extract component/function signatures from this code.

For each component/function, provide:
- Name
- Props/parameters with types
- Return type
- Brief description

Output as TypeScript interface definitions.`;
}

function ARCHITECTURE_PROMPT() {
  return `Analyze the architecture of this codebase.

Identify:
1. Layer structure (UI, business logic, data)
2. Key abstractions and their relationships
3. Data flow patterns
4. Integration points

Provide recommendations for maintaining consistency.`;
}

// ============================================================
// Security Utilities
// ============================================================

/**
 * Check for suspicious keys that could indicate prototype pollution
 * @param {*} obj - Object to check
 * @returns {boolean} - True if suspicious keys found
 */
function hasSuspiciousKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;

  const suspiciousKeys = ['__proto__', 'constructor', 'prototype'];

  function checkRecursively(o, depth = 0) {
    if (depth > 10 || !o || typeof o !== 'object') return false;

    for (const key of suspiciousKeys) {
      if (Object.prototype.hasOwnProperty.call(o, key)) {
        return true;
      }
    }

    // Check nested objects (not arrays for performance)
    if (!Array.isArray(o)) {
      for (const value of Object.values(o)) {
        if (typeof value === 'object' && value !== null && checkRecursively(value, depth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  return checkRecursively(obj);
}

// ============================================================
// Script-based Tasks (Free)
// ============================================================

/**
 * List files in directories (script-based, free)
 * @param {string[]} directories - Directories to scan
 * @param {Object} options - Options
 * @returns {Object} - File list by directory
 */
function listFilesInDirectory(directories, options = {}) {
  const {
    extensions = ['.ts', '.tsx', '.js', '.jsx'],
    excludePatterns = ['.test.', '.spec.', '.stories.', '__tests__', 'node_modules']
  } = options;

  const result = { files: [], byDirectory: {} };

  for (const dir of directories) {
    const fullDir = path.isAbsolute(dir) ? dir : path.join(PROJECT_ROOT, dir);

    if (!dirExists(fullDir)) continue;

    const files = scanDirectory(fullDir, extensions, excludePatterns);
    result.byDirectory[dir] = files.map(f => path.relative(PROJECT_ROOT, f));
    result.files.push(...files.map(f => path.relative(PROJECT_ROOT, f)));
  }

  return result;
}

/**
 * Recursively scan a directory for files
 * @param {string} dir - Directory to scan
 * @param {string[]} extensions - File extensions to include
 * @param {string[]} excludePatterns - Patterns to exclude
 * @returns {string[]} - File paths
 */
function scanDirectory(dir, extensions, excludePatterns) {
  const files = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Check exclusions
      if (excludePatterns.some(p => fullPath.includes(p))) continue;

      if (entry.isDirectory()) {
        files.push(...scanDirectory(fullPath, extensions, excludePatterns));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Ignore permission errors
  }

  return files;
}

/**
 * Extract exports from files using regex (script-based, free)
 * @param {string[]} files - File paths
 * @returns {Object} - Exports by file
 */
function extractExportsScript(files) {
  const result = { files: [] };

  for (const file of files) {
    const fullPath = path.isAbsolute(file) ? file : path.join(PROJECT_ROOT, file);

    if (!fileExists(fullPath)) continue;

    try {
      const content = readFile(fullPath);
      const exports = {
        path: file,
        namedExports: [],
        defaultExport: null,
        typeExports: []
      };

      // Extract named exports
      const namedMatches = content.matchAll(/export\s+(?:const|function|class|let|var)\s+(\w+)/g);
      for (const match of namedMatches) {
        exports.namedExports.push(match[1]);
      }

      // Extract named exports from export { }
      const braceMatches = content.matchAll(/export\s*\{([^}]+)\}/g);
      for (const match of braceMatches) {
        const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
        exports.namedExports.push(...names.filter(n => n && !n.includes('type')));
      }

      // Extract default export
      const defaultMatch = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
      if (defaultMatch) {
        exports.defaultExport = defaultMatch[1];
      }

      // Extract type exports
      const typeMatches = content.matchAll(/export\s+(?:type|interface)\s+(\w+)/g);
      for (const match of typeMatches) {
        exports.typeExports.push(match[1]);
      }

      // Dedupe
      exports.namedExports = [...new Set(exports.namedExports)];
      exports.typeExports = [...new Set(exports.typeExports)];

      if (exports.namedExports.length > 0 || exports.defaultExport || exports.typeExports.length > 0) {
        result.files.push(exports);
      }
    } catch (err) {
      // Skip files we can't read
    }
  }

  return result;
}

/**
 * Build import map from exports (script-based, free)
 * @param {Object} exports - Exports data from extractExportsScript
 * @returns {Object} - Import map
 */
function buildImportMapScript(exports) {
  const imports = {};

  for (const file of exports.files) {
    // Convert path to import path
    let importPath = file.path;

    // Convert src/ to @/
    if (importPath.startsWith('src/')) {
      importPath = '@/' + importPath.slice(4);
    }

    // Remove extension
    importPath = importPath.replace(/\.(tsx?|jsx?)$/, '');

    // Add named exports
    for (const exp of file.namedExports) {
      imports[exp] = `import { ${exp} } from '${importPath}'`;
    }

    // Add type exports
    for (const exp of file.typeExports) {
      imports[exp] = `import type { ${exp} } from '${importPath}'`;
    }

    // Add default export
    if (file.defaultExport) {
      imports[file.defaultExport] = `import ${file.defaultExport} from '${importPath}'`;
    }
  }

  return { imports };
}

// ============================================================
// Context Task Runner
// ============================================================

/**
 * Run a context generation task with appropriate model
 * @param {string} taskName - Task name from CONTEXT_TASKS
 * @param {*} input - Task input
 * @param {Object} options - Options including executor
 * @returns {*} - Task result
 */
async function runContextTask(taskName, input, options = {}) {
  const task = CONTEXT_TASKS[taskName];

  if (!task) {
    throw new Error(`Unknown context task: ${taskName}`);
  }

  const { executor, verbose } = options;

  if (verbose) {
    info(`Running ${taskName} with ${task.model}...`);
  }

  // Script-based tasks
  if (task.model === 'script' && task.fn) {
    return task.fn(input, options);
  }

  // If no executor provided, try script fallbacks
  if (!executor) {
    return runScriptFallback(taskName, input, options);
  }

  // AI-based tasks
  const prompt = typeof task.prompt === 'function' ? task.prompt() : task.prompt;
  const fullPrompt = `${prompt}\n\nInput:\n${JSON.stringify(input, null, 2)}`;

  try {
    const response = await executor.generate(fullPrompt, {
      maxTokens: 2000,
      model: task.model
    });

    // Try to parse as JSON with prototype pollution protection
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Check for prototype pollution attempts
        if (hasSuspiciousKeys(parsed)) {
          warn('Suspicious JSON structure detected in AI response');
          return { raw: response, error: 'Suspicious JSON structure' };
        }
        return parsed;
      }
    } catch (err) {
      // Return raw response if not JSON
    }

    return { raw: response };
  } catch (err) {
    warn(`AI task ${taskName} failed: ${err.message}`);
    return runScriptFallback(taskName, input, options);
  }
}

/**
 * Run script-based fallback for AI tasks
 * @param {string} taskName - Task name
 * @param {*} input - Task input
 * @param {Object} options - Options
 * @returns {*} - Fallback result
 */
function runScriptFallback(taskName, input, options = {}) {
  switch (taskName) {
  case 'extractExports':
    return extractExportsScript(input);

  case 'buildImportMap':
    return buildImportMapScript(input);

  case 'generatePins':
    // Simple PIN generation based on content keywords
    return generatePinsScript(input);

  case 'identifyPatterns':
  case 'extractComponentSignature':
  case 'architecturalAnalysis':
    // These require AI, return empty result
    return { warning: `${taskName} requires AI executor`, data: null };

  default:
    return { warning: `No fallback for ${taskName}`, data: null };
  }
}

/**
 * Generate PINs using script (fallback)
 * @param {Object} input - Content to generate PINs for
 * @returns {Object} - Generated PINs
 */
function generatePinsScript(input) {
  const sections = [];

  // Common keywords that become PINs
  const keywords = [
    'auth', 'authentication', 'login', 'user',
    'api', 'endpoint', 'service', 'fetch',
    'component', 'ui', 'button', 'form', 'input',
    'state', 'context', 'store', 'redux',
    'hook', 'effect', 'callback',
    'error', 'handler', 'catch',
    'type', 'interface', 'props',
    'config', 'settings', 'env'
  ];

  const content = typeof input === 'string' ? input : JSON.stringify(input);
  const contentLower = content.toLowerCase();

  const foundPins = keywords.filter(kw => contentLower.includes(kw));

  sections.push({
    title: 'Generated Context',
    pins: foundPins.slice(0, 5)
  });

  return { sections };
}

// ============================================================
// Full Context Generation
// ============================================================

/**
 * Generate comprehensive project context
 * @param {Object} options - Generation options
 * @returns {Object} - Generated context
 */
async function generateProjectContext(options = {}) {
  const {
    directories = ['src'],
    executor = null,
    verbose = false,
    useCache = true
  } = options;

  // Check cache
  if (useCache) {
    const cached = loadContextCache();
    if (cached && !isCacheStale(cached)) {
      if (verbose) info('Using cached context');
      return cached.context;
    }
  }

  const results = {
    generatedAt: new Date().toISOString(),
    files: null,
    exports: null,
    importMap: null,
    patterns: null,
    pins: null
  };

  // Phase 1: Mechanical (scripts)
  if (verbose) info('Phase 1: Listing files...');
  results.files = await runContextTask('listFiles', directories, { verbose });

  if (verbose) info('Phase 1: Extracting exports...');
  results.exports = await runContextTask('extractExports', results.files.files, { verbose });

  if (verbose) info('Phase 1: Building import map...');
  results.importMap = await runContextTask('buildImportMap', results.exports, { verbose });

  // Phase 2: Patterns (Sonnet if available)
  if (executor) {
    if (verbose) info('Phase 2: Identifying patterns...');
    results.patterns = await runContextTask('identifyPatterns', results.files.files.slice(0, 20), { executor, verbose });
  }

  // Phase 3: PINs (Haiku or script)
  if (verbose) info('Phase 3: Generating PINs...');
  results.pins = await runContextTask('generatePins', results, { executor, verbose });

  // Save to cache
  saveContextCache(results);

  // Write to PIN-indexed files
  await writeContextWithPins(results);

  return results;
}

/**
 * Write context to PIN-indexed markdown files
 * @param {Object} context - Generated context
 */
async function writeContextWithPins(context) {
  if (!dirExists(CONTEXT_DIR)) {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
  }

  // Write imports file
  if (context.importMap?.imports) {
    const importsContent = generateImportsMarkdown(context.importMap.imports);
    writeFile(path.join(CONTEXT_DIR, 'available-imports.md'), importsContent);
  }

  // Write exports file
  if (context.exports?.files) {
    const exportsContent = generateExportsMarkdown(context.exports.files);
    writeFile(path.join(CONTEXT_DIR, 'project-exports.md'), exportsContent);
  }

  // Write patterns file if available
  if (context.patterns?.raw) {
    writeFile(path.join(CONTEXT_DIR, 'code-patterns.md'), context.patterns.raw);
  }
}

/**
 * Generate imports markdown with PINs
 * @param {Object} imports - Import map
 * @returns {string} - Markdown content
 */
function generateImportsMarkdown(imports) {
  const lines = [
    '<!-- PINS: available-imports, import-map, project-context -->',
    '',
    '# Available Imports',
    '',
    '<!-- PIN: imports-list -->',
    '',
    'Use these exact import statements:',
    '',
    '```typescript'
  ];

  for (const [name, statement] of Object.entries(imports)) {
    lines.push(statement);
  }

  lines.push('```', '');

  return lines.join('\n');
}

/**
 * Generate exports markdown with PINs
 * @param {Object[]} exports - Export data
 * @returns {string} - Markdown content
 */
function generateExportsMarkdown(exports) {
  const lines = [
    '<!-- PINS: project-exports, available-components, project-context -->',
    '',
    '# Project Exports',
    '',
    '<!-- PIN: exports-by-file -->',
    '',
    '| File | Named Exports | Types |',
    '|------|---------------|-------|'
  ];

  for (const file of exports) {
    const named = file.namedExports.join(', ') || '-';
    const types = file.typeExports.join(', ') || '-';
    lines.push(`| ${file.path} | ${named} | ${types} |`);
  }

  lines.push('');

  return lines.join('\n');
}

// ============================================================
// Cache Management
// ============================================================

/**
 * Load context cache
 * @returns {Object|null} - Cached context or null
 */
function loadContextCache() {
  if (!fileExists(CONTEXT_CACHE_PATH)) return null;
  return safeJsonParse(CONTEXT_CACHE_PATH, null);
}

/**
 * Save context to cache
 * @param {Object} context - Context to cache
 */
function saveContextCache(context) {
  if (!dirExists(CONTEXT_DIR)) {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
  }

  const cache = {
    savedAt: new Date().toISOString(),
    context
  };

  try {
    writeFile(CONTEXT_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    // Not critical
  }
}

/**
 * Check if cache is stale (older than 1 hour)
 * @param {Object} cache - Cache object
 * @returns {boolean} - True if stale
 */
function isCacheStale(cache) {
  if (!cache?.savedAt) return true;

  const savedAt = new Date(cache.savedAt).getTime();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  return (now - savedAt) > hourMs;
}

/**
 * Clear context cache
 */
function clearContextCache() {
  if (fileExists(CONTEXT_CACHE_PATH)) {
    try {
      fs.unlinkSync(CONTEXT_CACHE_PATH);
      return true;
    } catch (err) {
      return false;
    }
  }
  return true;
}

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Wogi Flow - Context Generator

Usage: node scripts/flow-context-generator.js <command> [options]

Commands:
  generate                  Generate full project context
  files [dirs...]           List files in directories
  exports [files...]        Extract exports from files
  imports                   Build import map
  tasks                     List available context tasks
  clear-cache               Clear context cache

Options:
  --verbose                 Show progress
  --no-cache                Don't use cache
  --json                    Output as JSON
  --help                    Show this help message

Examples:
  node scripts/flow-context-generator.js generate --verbose
  node scripts/flow-context-generator.js files src
  node scripts/flow-context-generator.js exports src/components/Button.tsx
`);
    process.exit(0);
  }

  switch (command) {
  case 'generate': {
    const dirs = positional.slice(1);
    const context = await generateProjectContext({
      directories: dirs.length > 0 ? dirs : ['src'],
      verbose: flags.verbose,
      useCache: !flags['no-cache']
    });

    if (flags.json) {
      outputJson(context);
      return;
    }

    success('Context generated successfully');
    console.log(`  Files found: ${context.files?.files?.length || 0}`);
    console.log(`  Exports found: ${context.exports?.files?.length || 0}`);
    console.log(`  Import map entries: ${Object.keys(context.importMap?.imports || {}).length}`);
    console.log(`  Saved to: ${CONTEXT_DIR}`);
    break;
  }

  case 'files': {
    const dirs = positional.slice(1);
    const result = listFilesInDirectory(dirs.length > 0 ? dirs : ['src']);

    if (flags.json) {
      outputJson(result);
      return;
    }

    console.log(`\nFiles found: ${result.files.length}\n`);
    for (const file of result.files.slice(0, 20)) {
      console.log(`  ${file}`);
    }
    if (result.files.length > 20) {
      console.log(`  ... and ${result.files.length - 20} more`);
    }
    break;
  }

  case 'exports': {
    const files = positional.slice(1);
    if (files.length === 0) {
      console.error('Error: File paths required');
      process.exit(1);
    }

    const result = extractExportsScript(files);

    if (flags.json) {
      outputJson(result);
      return;
    }

    console.log('\nExports:\n');
    for (const file of result.files) {
      console.log(`  ${file.path}:`);
      if (file.namedExports.length > 0) {
        console.log(`    Named: ${file.namedExports.join(', ')}`);
      }
      if (file.defaultExport) {
        console.log(`    Default: ${file.defaultExport}`);
      }
      if (file.typeExports.length > 0) {
        console.log(`    Types: ${file.typeExports.join(', ')}`);
      }
    }
    break;
  }

  case 'imports': {
    // First get exports, then build import map
    const files = listFilesInDirectory(['src']);
    const exports = extractExportsScript(files.files);
    const imports = buildImportMapScript(exports);

    if (flags.json) {
      outputJson(imports);
      return;
    }

    console.log('\nImport Map:\n');
    const entries = Object.entries(imports.imports);
    for (const [name, statement] of entries.slice(0, 20)) {
      console.log(`  ${name}: ${statement}`);
    }
    if (entries.length > 20) {
      console.log(`  ... and ${entries.length - 20} more`);
    }
    break;
  }

  case 'tasks': {
    if (flags.json) {
      outputJson(Object.entries(CONTEXT_TASKS).map(([name, task]) => ({
        name,
        model: task.model,
        description: task.description
      })));
      return;
    }

    console.log('\nContext Tasks:\n');
    for (const [name, task] of Object.entries(CONTEXT_TASKS)) {
      console.log(`  ${name}:`);
      console.log(`    Model: ${task.model}`);
      console.log(`    Description: ${task.description}`);
      console.log('');
    }
    break;
  }

  case 'clear-cache': {
    const cleared = clearContextCache();
    if (cleared) {
      success('Context cache cleared');
    } else {
      logError('Failed to clear cache');
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Main functions
  generateProjectContext,
  runContextTask,

  // Script-based tasks
  listFilesInDirectory,
  extractExportsScript,
  buildImportMapScript,
  generatePinsScript,

  // Context writing
  writeContextWithPins,
  generateImportsMarkdown,
  generateExportsMarkdown,

  // Cache management
  loadContextCache,
  saveContextCache,
  clearContextCache,
  isCacheStale,

  // Constants
  CONTEXT_TASKS,
  CONTEXT_DIR
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
