#!/usr/bin/env node

/**
 * Wogi Flow - API Registry Builder
 *
 * Scans the codebase and builds an index of API calls and endpoints
 * with their methods, parameters, and response types.
 *
 * Usage:
 *   flow api-index scan           # Full scan of codebase
 *   flow api-index show <name>    # Show endpoint details
 *   flow api-index export         # Export registry as JSON
 *   flow api-index map            # Regenerate api-map.md
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
const INDEX_PATH = path.join(STATE_DIR, 'api-index.json');
const MAP_PATH = path.join(STATE_DIR, 'api-map.md');

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  directories: [
    'src/api',
    'src/services',
    'src/lib/api',
    'api',
    'services',
    'src/data',
    'src/queries',
    'src/mutations'
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
    '**/build/**'
  ],

  // Common HTTP client patterns to detect
  httpPatterns: {
    fetch: /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g,
    axios: /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*[`'"]([^`'"]+)[`'"]/g,
    axiosInstance: /\.(get|post|put|patch|delete|head|options)\s*\(\s*[`'"]([^`'"]+)[`'"]/g
  }
};

// ============================================================
// API Scanner (extends BaseScanner)
// ============================================================

class APIScanner extends BaseScanner {
  constructor(config = {}) {
    super({
      configKey: 'apiRegistry',
      directories: DEFAULT_CONFIG.directories,
      filePatterns: DEFAULT_CONFIG.filePatterns,
      excludePatterns: DEFAULT_CONFIG.excludePatterns,
      ...config
    });

    this.registry = {
      version: '1.0.0',
      scannedAt: null,
      projectRoot: PROJECT_ROOT,
      endpoints: [],
      services: {},
      clientFunctions: []
    };
  }

  /**
   * Scan directory recursively
   */
  async scanDirectory(dir) {
    await this.scanDirectoryRecursive(dir, (fullPath) => this.scanFile(fullPath));
  }

  /**
   * Scan a single file for API calls
   */
  async scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(PROJECT_ROOT, filePath);
      const service = this.getServiceFromPath(relativePath);

      // Scan for exported API functions
      if (this.parser) {
        this.parseWithBabel(content, relativePath, service);
      } else {
        this.parseWithRegex(content, relativePath, service);
      }

      // Also scan for inline API calls
      this.scanForHTTPCalls(content, relativePath, service);

    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`Error scanning ${filePath}: ${err.message}`);
      }
    }
  }

  /**
   * Get service name from file path (alias for getCategoryFromPath)
   */
  getServiceFromPath(relativePath) {
    return this.getCategoryFromPath(relativePath);
  }

  /**
   * Parse file with Babel AST
   */
  parseWithBabel(content, filePath, service) {
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
            this.extractAPIFunction(declaration, filePath, service, content);
          } else if (declaration.type === 'VariableDeclaration') {
            for (const decl of declaration.declarations) {
              if (decl.init &&
                  (decl.init.type === 'ArrowFunctionExpression' ||
                   decl.init.type === 'FunctionExpression')) {
                this.extractAPIFunctionFromVariable(decl, filePath, service, content);
              }
            }
          }
        }
      });
    } catch (err) {
      // Fall back to regex if babel fails
      this.parseWithRegex(content, filePath, service);
    }
  }

  /**
   * Extract API function info from AST
   */
  extractAPIFunction(node, filePath, service, content) {
    const name = node.id.name;

    // Check if this looks like an API function
    const isAPIFunction = this.isLikelyAPIFunction(name, content, node.start, node.end);
    if (!isAPIFunction.likely) return;

    const params = this.extractParams(node.params);
    const jsdoc = this.extractJSDoc(content, node.start);

    this.addClientFunction({
      name,
      params,
      method: isAPIFunction.method || this.inferMethodFromName(name),
      endpoint: isAPIFunction.endpoint,
      description: jsdoc.description || '',
      file: filePath,
      service,
      line: node.loc?.start?.line || 0
    });
  }

  /**
   * Extract API function from variable
   */
  extractAPIFunctionFromVariable(decl, filePath, service, content) {
    const name = decl.id.name;
    const init = decl.init;

    // Find the function body bounds
    const bodyStart = init.body?.start || decl.start;
    const bodyEnd = init.body?.end || decl.end;

    const isAPIFunction = this.isLikelyAPIFunction(name, content, bodyStart, bodyEnd);
    if (!isAPIFunction.likely) return;

    const params = this.extractParams(init.params);
    const jsdoc = this.extractJSDoc(content, decl.start);

    this.addClientFunction({
      name,
      params,
      method: isAPIFunction.method || this.inferMethodFromName(name),
      endpoint: isAPIFunction.endpoint,
      description: jsdoc.description || '',
      file: filePath,
      service,
      line: decl.loc?.start?.line || 0
    });
  }

  /**
   * Check if function looks like an API function
   */
  isLikelyAPIFunction(name, content, startPos, endPos) {
    // Check name patterns
    const apiNamePatterns = [
      /^(get|fetch|load|retrieve|query)/i,
      /^(post|create|add|save|submit)/i,
      /^(put|update|modify|patch)/i,
      /^(delete|remove|destroy)/i,
      /(api|endpoint|request|mutation|query)$/i
    ];

    const nameMatches = apiNamePatterns.some(p => p.test(name));

    // Check function body for HTTP calls
    const funcBody = content.substring(startPos, endPos);
    const httpPatterns = [
      /fetch\s*\(/,
      /axios\./,
      /\.get\s*\(/,
      /\.post\s*\(/,
      /\.put\s*\(/,
      /\.patch\s*\(/,
      /\.delete\s*\(/,
      /httpClient/i,
      /apiClient/i,
      /useSWR/,
      /useQuery/,
      /useMutation/
    ];

    const bodyMatches = httpPatterns.some(p => p.test(funcBody));

    // Try to extract endpoint and method from body
    let endpoint = null;
    let method = null;

    // Match endpoint patterns
    const endpointMatch = funcBody.match(/[`'"]\/api\/([^`'"]+)[`'"]/);
    if (endpointMatch) {
      endpoint = '/api/' + endpointMatch[1];
    } else {
      const urlMatch = funcBody.match(/[`'"](\/[a-z][a-z0-9/:-]*)[`'"]/i);
      if (urlMatch) {
        endpoint = urlMatch[1];
      }
    }

    // Match method
    const methodMatch = funcBody.match(/\.(get|post|put|patch|delete|head|options)\s*\(/i);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
    }

    return {
      likely: nameMatches || bodyMatches,
      endpoint,
      method
    };
  }

  /**
   * Infer HTTP method from function name
   */
  inferMethodFromName(name) {
    const lower = name.toLowerCase();
    if (/^(get|fetch|load|retrieve|query|find|list|read)/.test(lower)) return 'GET';
    if (/^(post|create|add|save|submit|send)/.test(lower)) return 'POST';
    if (/^(put|update|set|modify|replace)/.test(lower)) return 'PUT';
    if (/^(patch|partial)/.test(lower)) return 'PATCH';
    if (/^(delete|remove|destroy|clear)/.test(lower)) return 'DELETE';
    return 'GET';
  }

  /**
   * Parse with regex (fallback)
   */
  parseWithRegex(content, filePath, service) {
    // Match exported async functions
    const funcRegex = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const [fullMatch, isAsync, name, paramsStr] = match;

      // Check if it looks like an API function
      if (!this.isLikelyAPIFunctionFromName(name) && !this.hasHTTPCall(content, match.index)) {
        continue;
      }

      const jsdoc = this.extractJSDocBefore(content, match.index);

      this.addClientFunction({
        name,
        params: this.parseParamsFromString(paramsStr),
        method: this.inferMethodFromName(name),
        endpoint: null,
        description: jsdoc,
        file: filePath,
        service,
        line: this.getLineNumber(content, match.index)
      });
    }

    // Match exported const arrow functions
    const arrowRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;

    while ((match = arrowRegex.exec(content)) !== null) {
      const [fullMatch, name] = match;

      if (!this.isLikelyAPIFunctionFromName(name) && !this.hasHTTPCall(content, match.index)) {
        continue;
      }

      const jsdoc = this.extractJSDocBefore(content, match.index);

      this.addClientFunction({
        name,
        params: [],
        method: this.inferMethodFromName(name),
        endpoint: null,
        description: jsdoc,
        file: filePath,
        service,
        line: this.getLineNumber(content, match.index)
      });
    }
  }

  /**
   * Check if name looks like an API function
   */
  isLikelyAPIFunctionFromName(name) {
    return /^(get|fetch|load|post|create|put|update|patch|delete|remove|query|mutation)/i.test(name) ||
           /(api|endpoint|request)$/i.test(name);
  }

  /**
   * Check if there's an HTTP call after a position
   */
  hasHTTPCall(content, position) {
    const nextChunk = content.substring(position, position + 500);
    return /fetch\(|axios\.|\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(/.test(nextChunk);
  }

  /**
   * Scan for inline HTTP calls
   */
  scanForHTTPCalls(content, filePath, service) {
    // Match fetch calls with URL
    const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{[^}]*method:\s*[`'"](\w+)[`'"])?/g;
    let match;

    while ((match = fetchRegex.exec(content)) !== null) {
      const [, url, method] = match;
      if (url.startsWith('/') || url.includes('api')) {
        this.addEndpoint({
          endpoint: url,
          method: (method || 'GET').toUpperCase(),
          file: filePath,
          service,
          line: this.getLineNumber(content, match.index),
          source: 'fetch'
        });
      }
    }

    // Match axios calls
    const axiosRegex = /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;

    while ((match = axiosRegex.exec(content)) !== null) {
      const [, method, url] = match;
      this.addEndpoint({
        endpoint: url,
        method: method.toUpperCase(),
        file: filePath,
        service,
        line: this.getLineNumber(content, match.index),
        source: 'axios'
      });
    }
  }

  /**
   * Add endpoint to registry
   */
  addEndpoint(endpoint) {
    // Check for duplicates
    const existing = this.registry.endpoints.find(
      e => e.endpoint === endpoint.endpoint && e.method === endpoint.method
    );
    if (existing) return;

    this.registry.endpoints.push(endpoint);
  }

  /**
   * Add client function to registry
   */
  addClientFunction(func) {
    // Check for duplicates
    const existing = this.registry.clientFunctions.find(
      f => f.name === func.name && f.file === func.file
    );
    if (existing) return;

    this.registry.clientFunctions.push(func);

    // Add to services
    if (!this.registry.services[func.service]) {
      this.registry.services[func.service] = [];
    }
    this.registry.services[func.service].push(func.name);
  }

  /**
   * Run the scan
   */
  async scan() {
    console.log('\n' + color('cyan', '🔍 Scanning codebase for API calls...') + '\n');

    const directories = this.findDirectories();
    if (directories.length === 0) {
      console.log(color('yellow', '   No API directories found'));
      console.log('   Searched:', this.config.directories.join(', '));
      return null;
    }

    console.log(`   Parser: ${this.parser ? 'Babel AST' : 'Regex-based'}`);
    console.log(`   Directories: ${directories.map(d => path.relative(PROJECT_ROOT, d)).join(', ')}`);

    for (const dir of directories) {
      await this.scanDirectory(dir);
    }

    this.registry.scannedAt = new Date().toISOString();

    console.log(`\n   Found ${color('green', this.registry.clientFunctions.length)} API functions`);
    console.log(`   Found ${color('green', this.registry.endpoints.length)} inline endpoints`);
    console.log(`   Services: ${Object.keys(this.registry.services).join(', ') || '(none)'}`);

    return this.registry;
  }

  /**
   * Prune entries whose source files no longer exist
   */
  prune() {
    const beforeEndpoints = this.registry.endpoints.length;
    const beforeFunctions = this.registry.clientFunctions.length;

    this.registry.endpoints = this.registry.endpoints.filter(ep => {
      if (!ep.file) return true; // keep entries without file paths
      const fullPath = path.isAbsolute(ep.file) ? ep.file : path.join(PROJECT_ROOT, ep.file);
      return fs.existsSync(fullPath);
    });

    this.registry.clientFunctions = this.registry.clientFunctions.filter(func => {
      const fullPath = path.isAbsolute(func.file) ? func.file : path.join(PROJECT_ROOT, func.file);
      return fs.existsSync(fullPath);
    });

    // Rebuild services from surviving functions
    this.registry.services = {};
    for (const func of this.registry.clientFunctions) {
      if (!this.registry.services[func.service]) {
        this.registry.services[func.service] = [];
      }
      this.registry.services[func.service].push(func.name);
    }

    const removed = (beforeEndpoints - this.registry.endpoints.length) +
                    (beforeFunctions - this.registry.clientFunctions.length);
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
      '# API Registry',
      '',
      'Quick reference of API calls and endpoints. **Check before creating anything new.**',
      '',
      '> Auto-generated by `flow api-index scan`. Do not edit manually.',
      '',
      '---',
      ''
    ];

    // Client Functions by Service
    const services = Object.keys(this.registry.services).sort();

    if (services.length > 0) {
      lines.push('## API Client Functions', '');

      for (const service of services) {
        const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
        lines.push(`### ${serviceName}`, '');
        lines.push('| Function | Method | Endpoint | File |');
        lines.push('|----------|--------|----------|------|');

        const funcs = this.registry.clientFunctions
          .filter(f => f.service === service)
          .sort((a, b) => a.name.localeCompare(b.name));

        for (const func of funcs) {
          const endpoint = func.endpoint || '-';
          lines.push(`| \`${func.name}\` | ${func.method} | ${endpoint} | \`${func.file}\` |`);
        }

        lines.push('');
      }
    }

    // Endpoints discovered inline
    if (this.registry.endpoints.length > 0) {
      lines.push('## Endpoints', '');
      lines.push('| Endpoint | Method | Source | File |');
      lines.push('|----------|--------|--------|------|');

      const sortedEndpoints = [...this.registry.endpoints].sort((a, b) =>
        a.endpoint.localeCompare(b.endpoint)
      );

      for (const ep of sortedEndpoints) {
        lines.push(`| \`${ep.endpoint}\` | ${ep.method} | ${ep.source} | \`${ep.file}\` |`);
      }

      lines.push('');
    }

    lines.push('---', '');
    lines.push('## Rules', '');
    lines.push('1. **Before creating** → Search this file for existing API calls');
    lines.push('2. **If similar exists** → Extend with parameter or options');
    lines.push('3. **After creating** → Run `flow api-index scan` to update');
    lines.push('');

    const content = lines.join('\n');
    fs.writeFileSync(MAP_PATH, content);
    success(`Generated ${path.relative(PROJECT_ROOT, MAP_PATH)}`);
  }
}

// ============================================================
// CLI Commands
// ============================================================

function showEndpoint(name) {
  if (!fs.existsSync(INDEX_PATH)) {
    error('No API index found. Run `flow api-index scan` first.');
    process.exit(1);
  }

  try {
    const registry = safeJsonParse(INDEX_PATH, {});

    if (!name) {
      // List all
      console.log('\n' + color('cyan', 'Registered API Functions:') + '\n');

      for (const service of Object.keys(registry.services).sort()) {
        console.log(color('yellow', `\n${service}:`));
        for (const funcName of registry.services[service].sort()) {
          const func = registry.clientFunctions.find(f => f.name === funcName);
          console.log(`  - ${funcName} [${func?.method || '?'}]`);
        }
      }

      if (registry.endpoints.length > 0) {
        console.log(color('yellow', '\nEndpoints:'));
        for (const ep of registry.endpoints.slice(0, 10)) {
          console.log(`  - ${ep.method} ${ep.endpoint}`);
        }
        if (registry.endpoints.length > 10) {
          console.log(`  ... and ${registry.endpoints.length - 10} more`);
        }
      }

      console.log(`\nTotal: ${registry.clientFunctions.length} functions, ${registry.endpoints.length} endpoints`);
      console.log(`Last scanned: ${registry.scannedAt}`);
      return;
    }

    // Find specific function or endpoint
    const func = registry.clientFunctions.find(f =>
      f.name.toLowerCase() === name.toLowerCase()
    );

    const endpoint = registry.endpoints.find(e =>
      e.endpoint.includes(name)
    );

    if (func) {
      console.log('\n' + color('cyan', `API Function: ${func.name}`) + '\n');
      console.log(`  File: ${func.file}:${func.line}`);
      console.log(`  Service: ${func.service}`);
      console.log(`  Method: ${func.method}`);
      if (func.endpoint) {
        console.log(`  Endpoint: ${func.endpoint}`);
      }
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
    } else if (endpoint) {
      console.log('\n' + color('cyan', `Endpoint: ${endpoint.endpoint}`) + '\n');
      console.log(`  Method: ${endpoint.method}`);
      console.log(`  File: ${endpoint.file}:${endpoint.line}`);
      console.log(`  Source: ${endpoint.source}`);
    } else {
      error(`'${name}' not found in registry`);
      process.exit(1);
    }

  } catch (err) {
    error(`Failed to read index: ${err.message}`);
    process.exit(1);
  }
}

function exportRegistry() {
  if (!fs.existsSync(INDEX_PATH)) {
    error('No API index found. Run `flow api-index scan` first.');
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(INDEX_PATH, 'utf-8');
    console.log(content);
  } catch (err) {
    error(`Failed to read API index: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Check if a new API function name would match existing APIs using hybrid matching
 * @param {string} name - API function name to check
 * @param {string} purpose - Optional purpose/description
 */
function checkAPI(name, purpose) {
  if (!fs.existsSync(INDEX_PATH)) {
    warn('No API index found. Run `flow api-index scan` first.');
    return;
  }

  if (!name) {
    error('Usage: flow api-index check <name> [purpose]');
    process.exit(1);
  }

  try {
    const registry = safeJsonParse(INDEX_PATH, {});
    const matchConfig = getMatchConfig();

    // Transform registry for matching
    const apis = registry.clientFunctions.map(f => ({
      name: f.name,
      description: f.description || '',
      purpose: f.description || '',
      file: f.file,
      method: f.method,
      endpoint: f.endpoint,
      params: f.params,
      service: f.service
    }));

    // Find similar using hybrid matching
    const similar = findSimilarItems(name, apis, 'apis', { purpose });

    console.log('\n' + color('cyan', `Checking: "${name}"`) + '\n');
    if (purpose) {
      console.log(`  Purpose: ${purpose}\n`);
    }

    if (similar.length === 0) {
      console.log(color('green', '✓ No similar API functions found. Safe to create.'));
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
        console.log(`     Method: ${item.method}, File: ${item.file}`);
        if (item.endpoint) console.log(`     Endpoint: ${item.endpoint}`);
        if (item.description) console.log(`     Purpose: ${item.description}`);
      }
      console.log('');
    }

    if (likely.length > 0) {
      console.log(color('yellow', '🟡 LIKELY MATCHES (70-89%):'));
      for (const item of likely) {
        console.log(`   ${item.name} - ${item.scores.combined}% (string: ${item.scores.string}%, semantic: ${item.scores.semantic}%)`);
        console.log(`     Method: ${item.method}, File: ${item.file}`);
        if (item.endpoint) console.log(`     Endpoint: ${item.endpoint}`);
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
      console.log(generateAIDecisionPrompt(name, purpose, similar, 'apis'));
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
      const scanner = new APIScanner();
      const registry = await scanner.scan();
      if (registry) {
        scanner.save();
        scanner.generateMap();
      }
      break;
    }

    case 'show':
      showEndpoint(arg);
      break;

    case 'export':
      exportRegistry();
      break;

    case 'map': {
      if (!fs.existsSync(INDEX_PATH)) {
        error('No API index found. Run `flow api-index scan` first.');
        process.exit(1);
      }
      try {
        const scanner = new APIScanner();
        scanner.registry = safeJsonParse(INDEX_PATH, {});
        scanner.generateMap();
      } catch (err) {
        error(`Failed to read or parse API index: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'check': {
      const purpose = process.argv[4];
      checkAPI(arg, purpose);
      break;
    }

    default:
      console.log(`
Usage: flow api-index <command> [options]

Commands:
  scan              Scan codebase for API calls
  show [name]       Show API function or endpoint details
  check <name> [purpose]  Check if API name matches existing (hybrid matching)
  export            Export registry as JSON
  map               Regenerate api-map.md

Examples:
  flow api-index scan
  flow api-index show fetchUsers
  flow api-index check getUserProfile "Fetch user profile data"
  flow api-index export > api.json
`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { APIScanner };
