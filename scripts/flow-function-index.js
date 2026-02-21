#!/usr/bin/env node

/**
 * Wogi Flow - Function Registry Builder
 *
 * Scans the codebase and builds an index of utility functions
 * with their signatures, parameters, return types, and JSDoc descriptions.
 *
 * Usage:
 *   flow function-index scan         # Full scan of codebase
 *   flow function-index show <func>  # Show function details
 *   flow function-index export       # Export registry as JSON
 *   flow function-index map          # Regenerate function-map.md
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, success, warn, error, safeJsonParse } = require('./flow-utils');
const {
  findSimilarItems,
  generateAIDecisionPrompt,
  generateContextBlock,
  getMatchConfig
} = require('./flow-semantic-match');
const { BaseScanner, PROJECT_ROOT } = require('./flow-scanner-base');

const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const INDEX_PATH = path.join(STATE_DIR, 'function-index.json');
const MAP_PATH = path.join(STATE_DIR, 'function-map.md');

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  directories: [
    'src/utils',
    'src/lib',
    'src/helpers',
    'utils',
    'lib',
    'helpers',
    'src/shared',
    'shared'
  ],

  filePatterns: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'],

  excludePatterns: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.stories.*',
    '**/node_modules/**',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/dist/**',
    '**/build/**',
    '**/index.ts',
    '**/index.js'
  ]
};

// ============================================================
// Function Scanner (extends BaseScanner)
// ============================================================

class FunctionScanner extends BaseScanner {
  constructor(config = {}) {
    super({
      configKey: 'functionRegistry',
      directories: DEFAULT_CONFIG.directories,
      filePatterns: DEFAULT_CONFIG.filePatterns,
      excludePatterns: DEFAULT_CONFIG.excludePatterns,
      ...config
    });

    this.registry = {
      version: '1.0.0',
      scannedAt: null,
      projectRoot: PROJECT_ROOT,
      functions: [],
      categories: {}
    };
  }

  /**
   * Scan directory recursively for functions
   */
  async scanDirectory(dir) {
    await this.scanDirectoryRecursive(dir, (fullPath) => this.scanFile(fullPath));
  }

  /**
   * Scan a single file for exported functions
   */
  async scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(PROJECT_ROOT, filePath);
      const category = this.getCategoryFromPath(relativePath);

      if (this.parser) {
        this.parseWithBabel(content, relativePath, category);
      } else {
        this.parseWithRegex(content, relativePath, category);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`Error scanning ${filePath}: ${err.message}`);
      }
    }
  }

  /**
   * Parse file with Babel AST
   */
  parseWithBabel(content, filePath, category) {
    try {
      const ast = this.parser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy']
      });

      this.traverse(ast, {
        ExportNamedDeclaration: (nodePath) => {
          const declaration = nodePath.node.declaration;
          if (!declaration) return;

          if (declaration.type === 'FunctionDeclaration' && declaration.id) {
            this.extractFunction(declaration, filePath, category, content);
          } else if (declaration.type === 'VariableDeclaration') {
            for (const decl of declaration.declarations) {
              if (decl.init &&
                  (decl.init.type === 'ArrowFunctionExpression' ||
                   decl.init.type === 'FunctionExpression')) {
                this.extractFunctionFromVariable(decl, filePath, category, content);
              }
            }
          }
        },
        ExportDefaultDeclaration: (nodePath) => {
          const declaration = nodePath.node.declaration;
          if (declaration.type === 'FunctionDeclaration' && declaration.id) {
            this.extractFunction(declaration, filePath, category, content, true);
          }
        }
      });
    } catch (err) {
      // Fall back to regex if babel fails
      this.parseWithRegex(content, filePath, category);
    }
  }

  /**
   * Extract function info from AST node
   */
  extractFunction(node, filePath, category, content, isDefault = false) {
    const name = node.id.name;
    const params = this.extractParams(node.params);
    const returnType = this.extractReturnType(node);
    const jsdoc = this.extractJSDoc(content, node.start);

    this.addFunction({
      name,
      params,
      returnType,
      description: jsdoc.description || '',
      file: filePath,
      category,
      isDefault,
      line: node.loc?.start?.line || 0
    });
  }

  /**
   * Extract function from variable declaration
   */
  extractFunctionFromVariable(decl, filePath, category, content) {
    const name = decl.id.name;
    const init = decl.init;
    const params = this.extractParams(init.params);
    const returnType = this.extractReturnType(init) || this.extractTypeFromAnnotation(decl);
    const jsdoc = this.extractJSDoc(content, decl.start);

    this.addFunction({
      name,
      params,
      returnType,
      description: jsdoc.description || '',
      file: filePath,
      category,
      isDefault: false,
      line: decl.loc?.start?.line || 0
    });
  }

  /**
   * Extract return type from function
   */
  extractReturnType(node) {
    if (node.returnType?.typeAnnotation) {
      return this.typeAnnotationToString(node.returnType.typeAnnotation);
    }
    return null;
  }

  /**
   * Extract type from variable annotation
   */
  extractTypeFromAnnotation(decl) {
    if (decl.id.typeAnnotation?.typeAnnotation) {
      const annotation = decl.id.typeAnnotation.typeAnnotation;
      // Try to extract return type from function type annotation
      if (annotation.type === 'TSFunctionType' && annotation.typeAnnotation) {
        return this.typeAnnotationToString(annotation.typeAnnotation.typeAnnotation);
      }
    }
    return null;
  }

  /**
   * Parse file with regex (fallback)
   */
  parseWithRegex(content, filePath, category) {
    // Match exported function declarations
    const functionRegex = /export\s+(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?\s*\{/g;
    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      const [, isAsync, name, generics, paramsStr, returnType] = match;
      const params = this.parseParamsFromString(paramsStr);
      const jsdoc = this.extractJSDocBefore(content, match.index);

      this.addFunction({
        name,
        params,
        returnType: returnType || (isAsync ? 'Promise<any>' : null),
        description: jsdoc,
        file: filePath,
        category,
        isDefault: false,
        line: this.getLineNumber(content, match.index)
      });
    }

    // Match exported const arrow functions
    const arrowRegex = /export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*([^\s=>]+))?\s*=>/g;

    while ((match = arrowRegex.exec(content)) !== null) {
      const [, name, returnType] = match;
      const jsdoc = this.extractJSDocBefore(content, match.index);

      this.addFunction({
        name,
        params: [],
        returnType,
        description: jsdoc,
        file: filePath,
        category,
        isDefault: false,
        line: this.getLineNumber(content, match.index)
      });
    }
  }

  /**
   * Add function to registry
   */
  addFunction(func) {
    // Check for duplicates
    const existing = this.registry.functions.find(
      f => f.name === func.name && f.file === func.file
    );
    if (existing) return;

    this.registry.functions.push(func);

    // Add to categories
    if (!this.registry.categories[func.category]) {
      this.registry.categories[func.category] = [];
    }
    this.registry.categories[func.category].push(func.name);
  }

  /**
   * Run the scan
   */
  async scan() {
    console.log('\n' + color('cyan', '🔍 Scanning codebase for utility functions...') + '\n');

    const directories = this.findDirectories();
    if (directories.length === 0) {
      console.log(color('yellow', '   No utility directories found'));
      console.log('   Searched:', this.config.directories.join(', '));
      return null;
    }

    console.log(`   Parser: ${this.parser ? 'Babel AST' : 'Regex-based'}`);
    console.log(`   Directories: ${directories.map(d => path.relative(PROJECT_ROOT, d)).join(', ')}`);

    for (const dir of directories) {
      await this.scanDirectory(dir);
    }

    this.registry.scannedAt = new Date().toISOString();

    console.log(`\n   Found ${color('green', this.registry.functions.length)} functions`);
    console.log(`   Categories: ${Object.keys(this.registry.categories).join(', ')}`);

    return this.registry;
  }

  /**
   * Prune entries whose source files no longer exist
   */
  prune() {
    const before = this.registry.functions.length;
    this.registry.functions = this.registry.functions.filter(func => {
      const fullPath = path.isAbsolute(func.file) ? func.file : path.join(PROJECT_ROOT, func.file);
      return fs.existsSync(fullPath);
    });
    const removed = before - this.registry.functions.length;

    // Rebuild categories from surviving functions
    this.registry.categories = {};
    for (const func of this.registry.functions) {
      if (!this.registry.categories[func.category]) {
        this.registry.categories[func.category] = [];
      }
      this.registry.categories[func.category].push(func.name);
    }

    if (removed > 0) {
      console.log(`   Pruned ${color('yellow', removed)} orphaned entries (source files deleted)`);
    }
    return removed;
  }

  /**
   * Save registry to file
   */
  save() {
    this.prune();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(this.registry, null, 2));
    success(`Saved to ${path.relative(PROJECT_ROOT, INDEX_PATH)}`);
  }

  /**
   * Generate human-readable map
   */
  generateMap() {
    const lines = [
      '# Function Registry',
      '',
      'Quick reference of utility functions. **Check before creating anything new.**',
      '',
      '> Auto-generated by `flow function-index scan`. Do not edit manually.',
      '',
      '---',
      ''
    ];

    // Group by category
    const categories = Object.keys(this.registry.categories).sort();

    for (const category of categories) {
      const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
      lines.push(`## ${categoryName}`, '');
      lines.push('| Function | Purpose | File | Parameters |');
      lines.push('|----------|---------|------|------------|');

      const funcs = this.registry.functions
        .filter(f => f.category === category)
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const func of funcs) {
        const params = func.params.map(p => `${p.name}: ${p.type}`).join(', ') || '-';
        const purpose = func.description || '-';
        const file = func.file;
        lines.push(`| \`${func.name}\` | ${purpose} | \`${file}\` | ${params} |`);
      }

      lines.push('');
    }

    lines.push('---', '');
    lines.push('## Rules', '');
    lines.push('1. **Before creating** → Search this file');
    lines.push('2. **If similar exists** → Extend with parameter, don\'t create new');
    lines.push('3. **After creating** → Run `flow function-index scan` to update');
    lines.push('');

    const content = lines.join('\n');
    fs.writeFileSync(MAP_PATH, content);
    success(`Generated ${path.relative(PROJECT_ROOT, MAP_PATH)}`);
  }
}

// ============================================================
// CLI Commands
// ============================================================

function showFunction(name) {
  if (!fs.existsSync(INDEX_PATH)) {
    error('No function index found. Run `flow function-index scan` first.');
    process.exit(1);
  }

  try {
    const registry = safeJsonParse(INDEX_PATH, {});

    if (!name) {
      // List all functions
      console.log('\n' + color('cyan', 'Registered Functions:') + '\n');

      for (const category of Object.keys(registry.categories).sort()) {
        console.log(color('yellow', `\n${category}:`));
        for (const funcName of registry.categories[category].sort()) {
          console.log(`  - ${funcName}`);
        }
      }

      console.log(`\nTotal: ${registry.functions.length} functions`);
      console.log(`Last scanned: ${registry.scannedAt}`);
      return;
    }

    // Find specific function
    const func = registry.functions.find(f =>
      f.name.toLowerCase() === name.toLowerCase()
    );

    if (!func) {
      error(`Function '${name}' not found in registry`);
      process.exit(1);
    }

    console.log('\n' + color('cyan', `Function: ${func.name}`) + '\n');
    console.log(`  File: ${func.file}:${func.line}`);
    console.log(`  Category: ${func.category}`);
    if (func.description) {
      console.log(`  Description: ${func.description}`);
    }
    console.log(`  Parameters:`);
    if (func.params.length === 0) {
      console.log('    (none)');
    } else {
      for (const param of func.params) {
        console.log(`    - ${param.name}: ${param.type}`);
      }
    }
    if (func.returnType) {
      console.log(`  Returns: ${func.returnType}`);
    }

  } catch (err) {
    error(`Failed to read index: ${err.message}`);
    process.exit(1);
  }
}

function exportRegistry() {
  if (!fs.existsSync(INDEX_PATH)) {
    error('No function index found. Run `flow function-index scan` first.');
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(INDEX_PATH, 'utf-8');
    console.log(content);
  } catch (err) {
    error(`Failed to read function index: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Check if a new function name would match existing functions using hybrid matching
 * @param {string} name - Function name to check
 * @param {string} purpose - Optional purpose/description
 */
function checkFunction(name, purpose) {
  if (!fs.existsSync(INDEX_PATH)) {
    warn('No function index found. Run `flow function-index scan` first.');
    return;
  }

  if (!name) {
    error('Usage: flow function-index check <name> [purpose]');
    process.exit(1);
  }

  try {
    const registry = safeJsonParse(INDEX_PATH, {});
    const matchConfig = getMatchConfig();

    // Transform registry functions for matching
    const functions = registry.functions.map(f => ({
      name: f.name,
      description: f.description || '',
      purpose: f.description || '',
      file: f.file,
      params: f.params,
      category: f.category
    }));

    // Find similar using hybrid matching
    const similar = findSimilarItems(name, functions, 'functions', { purpose });

    console.log('\n' + color('cyan', `Checking: "${name}"`) + '\n');
    if (purpose) {
      console.log(`  Purpose: ${purpose}\n`);
    }

    if (similar.length === 0) {
      console.log(color('green', '✓ No similar functions found. Safe to create.'));
      return;
    }

    // Show results by match level
    const definite = similar.filter(s => s.matchLevel === 'definite');
    const likely = similar.filter(s => s.matchLevel === 'likely');
    const possible = similar.filter(s => s.matchLevel === 'possible');

    if (definite.length > 0) {
      console.log(color('red', '🔴 DEFINITE MATCHES (>90%):'));
      for (const item of definite) {
        console.log(`   ${item.name} - ${item.scores.combined}% (string: ${item.scores.string}%, semantic: ${item.scores.semantic}%)`);
        console.log(`     File: ${item.file}`);
        if (item.description) console.log(`     Purpose: ${item.description}`);
      }
      console.log('');
    }

    if (likely.length > 0) {
      console.log(color('yellow', '🟡 LIKELY MATCHES (70-89%):'));
      for (const item of likely) {
        console.log(`   ${item.name} - ${item.scores.combined}% (string: ${item.scores.string}%, semantic: ${item.scores.semantic}%)`);
        console.log(`     File: ${item.file}`);
        if (item.description) console.log(`     Purpose: ${item.description}`);
      }
      console.log('');
    }

    if (possible.length > 0) {
      console.log(color('dim', '🟢 POSSIBLE MATCHES (50-69%):'));
      for (const item of possible.slice(0, 3)) {
        console.log(`   ${item.name} - ${item.scores.combined}%`);
      }
      console.log('');
    }

    // Generate AI decision prompt for likely matches
    if (likely.length > 0 && matchConfig.useAIReview) {
      console.log(color('cyan', '━'.repeat(50)));
      console.log(color('cyan', 'AI Decision Prompt:'));
      console.log(color('cyan', '━'.repeat(50)));
      console.log(generateAIDecisionPrompt(name, purpose, similar, 'functions'));
    }

  } catch (err) {
    error(`Failed to check: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const command = process.argv[2] || 'scan';
  const arg = process.argv[3];

  switch (command) {
    case 'scan': {
      const scanner = new FunctionScanner();
      const registry = await scanner.scan();
      if (registry) {
        scanner.save();
        scanner.generateMap();
      }
      break;
    }

    case 'show':
      showFunction(arg);
      break;

    case 'export':
      exportRegistry();
      break;

    case 'map': {
      if (!fs.existsSync(INDEX_PATH)) {
        error('No function index found. Run `flow function-index scan` first.');
        process.exit(1);
      }
      try {
        const scanner = new FunctionScanner();
        scanner.registry = safeJsonParse(INDEX_PATH, {});
        scanner.generateMap();
      } catch (err) {
        error(`Failed to read or parse function index: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'check': {
      const purpose = process.argv[4];
      checkFunction(arg, purpose);
      break;
    }

    default:
      console.log(`
Usage: flow function-index <command> [options]

Commands:
  scan              Scan codebase for utility functions
  show [name]       Show function details (or list all)
  check <name> [purpose]  Check if function name matches existing (hybrid matching)
  export            Export registry as JSON
  map               Regenerate function-map.md

Examples:
  flow function-index scan
  flow function-index show formatDate
  flow function-index check formatDateTime "Format date and time for display"
  flow function-index export > functions.json
`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { FunctionScanner };
