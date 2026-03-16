'use strict';

/**
 * Contract Surface Scanner
 *
 * Detects and catalogs a project's integration surface:
 * - HTTP client calls (what endpoints the project CONSUMES)
 * - Route definitions (what endpoints the project EXPOSES)
 * - Event emitters/listeners (pub/sub surface)
 * - Shared type imports (cross-package type contracts)
 * - Environment variables (runtime configuration surface)
 *
 * TEAMS-ONLY feature: generates .workflow/state/contract-surface.json
 * which the wogiflow-cloud orchestration agent consumes.
 * Only activates when a user is logged into a team.
 *
 * Output: contract-surface.json (machine-readable)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const CONTRACT_SURFACE_VERSION = '1.0.0';

// Directories to always skip
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.workflow',
  'coverage', '__tests__', '__mocks__', '.next', '.nuxt',
  '.svelte-kit', '.output', 'vendor', '.cache', 'tmp'
]);

// File extensions to scan
const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.mjs'
]);

// ============================================================
// File Walking
// ============================================================

/**
 * Walk a directory tree, yielding source files.
 * @param {string} dir - Directory to walk
 * @param {Object} options
 * @param {number} options.maxDepth - Maximum recursion depth (default 6)
 * @param {number} options.maxFiles - Maximum files to return (default 500)
 * @returns {string[]} Array of absolute file paths
 */
function walkSourceFiles(dir, options = {}) {
  const maxDepth = options.maxDepth || 6;
  const maxFiles = options.maxFiles || 500;
  const files = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(currentDir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(path.join(currentDir, entry.name));
        }
      }
    }
  }

  walk(dir, 0);
  return files;
}

// ============================================================
// HTTP Client Scanner
// ============================================================

/**
 * Scan for HTTP client calls (endpoints this project CONSUMES).
 * Detects: axios, fetch, $fetch, ky, got, custom http clients.
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object[]} Array of { method, path, source, client }
 */
function scanHttpClients(projectRoot, options = {}) {
  const files = walkSourceFiles(projectRoot, options);
  const results = [];

  // Patterns for HTTP client calls
  const patterns = [
    // axios.get('/api/...'), axios.post('/api/...')
    { regex: /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, client: 'axios' },
    // axios({ method: 'GET', url: '/api/...' })
    { regex: /\baxios\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`\n]+)['"`][^}]*method\s*:\s*['"`](\w+)['"`]/gi, client: 'axios', methodSwap: true },
    { regex: /\baxios\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*url\s*:\s*['"`]([^'"`\n]+)['"`]/gi, client: 'axios' },
    // fetch('/api/...'), fetch(`${BASE}/api/...`) — negative lookbehind to avoid matching $fetch
    { regex: /(?<!\$)\bfetch\s*\(\s*['"`]([^'"`\n]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`])?/gi, client: 'fetch', pathFirst: true },
    // $fetch('/api/...') (Nuxt)
    { regex: /\$fetch\s*\(\s*['"`]([^'"`\n]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`])?/gi, client: '$fetch', pathFirst: true },
    // ky.get('/api/...'), ky.post('/api/...')
    { regex: /\bky\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, client: 'ky' },
    // got.get('/api/...'), got.post('/api/...')
    { regex: /\bgot\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, client: 'got' },
    // http.get('/api/...'), http.post('/api/...')
    { regex: /\bhttp\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, client: 'http' },
    // api.get('/api/...'), apiClient.post('/api/...')
    { regex: /\b(?:api|apiClient|httpClient|client)\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, client: 'custom' },
  ];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);
    const lines = content.split('\n');

    for (const pattern of patterns) {
      // Reset lastIndex for global regex
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        let method, urlPath;

        if (pattern.pathFirst) {
          urlPath = match[1];
          method = (match[2] || 'GET').toUpperCase();
        } else if (pattern.methodSwap) {
          urlPath = match[1];
          method = match[2].toUpperCase();
        } else {
          method = match[1].toUpperCase();
          urlPath = match[2];
        }

        // Calculate line number
        const lineNum = content.substring(0, match.index).split('\n').length;

        results.push({
          method,
          path: urlPath,
          source: `${relPath}:${lineNum}`,
          client: pattern.client
        });
      }
    }
  }

  return results;
}

// ============================================================
// Route Definition Scanner
// ============================================================

/**
 * Scan for route/endpoint definitions (what this project EXPOSES).
 * Detects: Express, Fastify, Hono, NestJS decorators, Next.js file routes.
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object[]} Array of { method, path, source, handler, framework }
 */
function scanRouteDefinitions(projectRoot, options = {}) {
  const files = walkSourceFiles(projectRoot, options);
  const results = [];

  // Express/Fastify/Hono route patterns
  const routePatterns = [
    // app.get('/api/...', handler), router.post('/api/...')
    { regex: /\b(?:app|router|server|fastify)\s*\.\s*(get|post|put|patch|delete|all|head|options)\s*\(\s*['"`]([^'"`\n]+)['"`]\s*(?:,\s*(\w+))?/gi, framework: 'express' },
    // fastify.route({ method: 'GET', url: '/api/...' })
    { regex: /\bfastify\s*\.\s*route\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*url\s*:\s*['"`]([^'"`\n]+)['"`]/gi, framework: 'fastify' },
    // Hono: app.get('/api/...')
    { regex: /\bnew\s+Hono[\s\S]{0,200}?\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, framework: 'hono', honoStyle: true },
    // NestJS decorators: @Get('/api/...'), @Post('/api/...')
    { regex: /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`\n]+)['"`]\s*\)/g, framework: 'nestjs' },
  ];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);

    for (const pattern of routePatterns) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        let method, routePath, handler;

        if (pattern.honoStyle) {
          routePath = match[1];
          method = 'GET'; // Simplified; actual method is in the chained call
          handler = '';
        } else if (pattern.framework === 'nestjs') {
          method = match[1].toUpperCase();
          routePath = match[2];
          // Try to find the method name after the decorator
          const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 200);
          const handlerMatch = afterMatch.match(/(?:async\s+)?(\w+)\s*\(/);
          handler = handlerMatch ? handlerMatch[1] : '';
        } else {
          method = match[1].toUpperCase();
          routePath = match[2];
          handler = match[3] || '';
        }

        const lineNum = content.substring(0, match.index).split('\n').length;

        results.push({
          method,
          path: routePath,
          source: `${relPath}:${lineNum}`,
          handler,
          framework: pattern.framework
        });
      }
    }
  }

  // Scan for Next.js file-based API routes
  const nextjsRoutes = scanNextjsApiRoutes(projectRoot);
  results.push(...nextjsRoutes);

  return results;
}

/**
 * Detect Next.js file-based API routes.
 * @param {string} projectRoot
 * @returns {Object[]}
 */
function scanNextjsApiRoutes(projectRoot) {
  const results = [];

  // pages/api/**/*.ts (Pages Router)
  const pagesApiDir = path.join(projectRoot, 'pages', 'api');
  if (fs.existsSync(pagesApiDir)) {
    const files = walkSourceFiles(pagesApiDir, { maxDepth: 4, maxFiles: 100 });
    for (const filePath of files) {
      const relPath = path.relative(projectRoot, filePath);
      const routePath = '/api/' + path.relative(pagesApiDir, filePath)
        .replace(/\\/g, '/')
        .replace(/\.(ts|js|tsx|jsx)$/, '')
        .replace(/\/index$/, '');

      results.push({
        method: 'ALL',
        path: routePath,
        source: relPath,
        handler: 'default',
        framework: 'nextjs-pages'
      });
    }
  }

  // app/api/**/route.ts (App Router)
  const appApiDir = path.join(projectRoot, 'app', 'api');
  if (fs.existsSync(appApiDir)) {
    const files = walkSourceFiles(appApiDir, { maxDepth: 4, maxFiles: 100 });
    for (const filePath of files) {
      const basename = path.basename(filePath);
      if (!basename.startsWith('route.')) continue;

      const relPath = path.relative(projectRoot, filePath);
      const routePath = '/api/' + path.relative(appApiDir, path.dirname(filePath))
        .replace(/\\/g, '/');

      // Read file to detect exported methods (GET, POST, etc.)
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        continue;
      }

      const methods = [];
      const methodPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
      let match;
      while ((match = methodPattern.exec(content)) !== null) {
        methods.push(match[1]);
      }

      if (methods.length === 0) methods.push('ALL');

      for (const method of methods) {
        results.push({
          method,
          path: routePath === '/api/.' ? '/api' : routePath,
          source: relPath,
          handler: method.toLowerCase(),
          framework: 'nextjs-app'
        });
      }
    }
  }

  return results;
}

// ============================================================
// Event Bus Scanner
// ============================================================

/**
 * Scan for event emitters and listeners.
 * Detects: EventEmitter, pubsub, custom event buses.
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object} { emits: [], listensTo: [] }
 */
function scanEventBus(projectRoot, options = {}) {
  const files = walkSourceFiles(projectRoot, options);
  const emits = [];
  const listensTo = [];

  const emitPatterns = [
    // eventEmitter.emit('event-name', ...), this.emit('event-name')
    /\b(?:emit|dispatch)\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    // pubsub.publish('topic', ...)
    /\b(?:publish|trigger|fire|broadcast)\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    // socket.emit('event', ...)
    /\bsocket\s*\.\s*emit\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
  ];

  const listenPatterns = [
    // eventEmitter.on('event-name', ...), this.on('event-name')
    /\b(?:on|addEventListener|addListener)\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    // pubsub.subscribe('topic', ...)
    /\b(?:subscribe|listen)\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    // socket.on('event', ...)
    /\bsocket\s*\.\s*on\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
  ];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);

    for (const pattern of emitPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        emits.push({
          event: match[1],
          source: `${relPath}:${lineNum}`
        });
      }
    }

    for (const pattern of listenPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        listensTo.push({
          event: match[1],
          source: `${relPath}:${lineNum}`
        });
      }
    }
  }

  return { emits, listensTo };
}

// ============================================================
// Shared Types Scanner
// ============================================================

/**
 * Scan for shared type imports (cross-package type contracts).
 * Detects: @shared/*, @org/*, shared package imports.
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object} { imports: [], exports: [] }
 */
function scanSharedTypes(projectRoot, options = {}) {
  const files = walkSourceFiles(projectRoot, options);
  const imports = [];
  const exports = [];

  // Patterns for shared/org-scoped imports
  const importPatterns = [
    // import { X } from '@shared/types' or '@org/common'
    /import\s+(?:type\s+)?(?:\{[^}]+\}|\w+)\s+from\s+['"`](@[^'"`\n/]+\/[^'"`\n]+|@shared\/[^'"`\n]+)['"`]/g,
    // require('@shared/types')
    /require\s*\(\s*['"`](@[^'"`\n/]+\/[^'"`\n]+|@shared\/[^'"`\n]+)['"`]\s*\)/g,
  ];

  // Patterns for type exports (in shared packages)
  const exportPatterns = [
    // export type { X }, export interface X
    /export\s+(?:type|interface)\s+(\w+)/g,
    // export { X } (type re-exports)
    /export\s+\{([^}]+)\}/g,
  ];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);

    // Shared type imports
    for (const pattern of importPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        imports.push({
          package: match[1],
          source: `${relPath}:${lineNum}`
        });
      }
    }

    // Type exports (only in files that look like shared/common)
    if (relPath.includes('shared') || relPath.includes('common') || relPath.includes('types')) {
      for (const pattern of exportPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          const names = match[1]
            ? match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
            : [match[0].split(/\s+/).pop()];

          for (const name of names) {
            if (name && name !== '{' && name !== '}') {
              exports.push({
                name,
                source: `${relPath}:${lineNum}`
              });
            }
          }
        }
      }
    }
  }

  return { imports, exports };
}

// ============================================================
// Environment Variable Scanner
// ============================================================

/**
 * Scan for environment variable usage and .env definitions.
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object} { requires: [], exposes: [] }
 */
function scanEnvVars(projectRoot, options = {}) {
  const files = walkSourceFiles(projectRoot, options);
  const requires = [];
  const exposesMap = new Map(); // Deduplicate .env entries

  // Scan source files for process.env usage
  const envPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  const envBracketPattern = /process\.env\[['"`]([A-Z_][A-Z0-9_]*)['"`]\]/g;
  // import.meta.env.VITE_* (Vite)
  const viteEnvPattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;

  const seenRequires = new Set();

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);

    for (const pattern of [envPattern, envBracketPattern, viteEnvPattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const varName = match[1];
        // Skip common built-in env vars
        if (['NODE_ENV', 'HOME', 'PATH', 'USER', 'SHELL', 'PWD', 'LANG', 'TERM'].includes(varName)) continue;

        const lineNum = content.substring(0, match.index).split('\n').length;
        const key = `${varName}::${relPath}`;
        if (!seenRequires.has(key)) {
          seenRequires.add(key);
          requires.push({
            name: varName,
            source: `${relPath}:${lineNum}`
          });
        }
      }
    }
  }

  // Scan .env files for defined variables
  const envFiles = ['.env', '.env.example', '.env.local', '.env.development', '.env.production', '.env.test'];
  for (const envFile of envFiles) {
    const envPath = path.join(projectRoot, envFile);
    if (!fs.existsSync(envPath)) continue;

    let content;
    try {
      content = fs.readFileSync(envPath, 'utf-8');
    } catch (err) {
      continue;
    }

    const linePattern = /^([A-Z_][A-Z0-9_]*)\s*=/gm;
    let match;
    while ((match = linePattern.exec(content)) !== null) {
      const varName = match[1];
      if (!exposesMap.has(varName)) {
        exposesMap.set(varName, {
          name: varName,
          source: envFile,
          definedIn: [envFile]
        });
      } else {
        const existing = exposesMap.get(varName);
        if (!existing.definedIn.includes(envFile)) {
          existing.definedIn.push(envFile);
        }
      }
    }
  }

  return {
    requires,
    exposes: Array.from(exposesMap.values())
  };
}

// ============================================================
// Project Type Detection
// ============================================================

/**
 * Detect project type based on file structure and dependencies.
 * @param {string} projectRoot
 * @returns {'frontend'|'backend'|'fullstack'|'library'|'monorepo'|'unknown'}
 */
function detectProjectType(projectRoot) {
  // Check for monorepo indicators
  const hasWorkspaces = fs.existsSync(path.join(projectRoot, 'packages'))
    || fs.existsSync(path.join(projectRoot, 'apps'));
  const hasLerna = fs.existsSync(path.join(projectRoot, 'lerna.json'));
  const hasTurborepo = fs.existsSync(path.join(projectRoot, 'turbo.json'));
  const hasNxJson = fs.existsSync(path.join(projectRoot, 'nx.json'));

  if (hasLerna || hasTurborepo || hasNxJson || hasWorkspaces) {
    // Check if it's truly a monorepo (multiple packages)
    const packagesDir = path.join(projectRoot, 'packages');
    const appsDir = path.join(projectRoot, 'apps');
    let packageCount = 0;

    for (const dir of [packagesDir, appsDir]) {
      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          packageCount += entries.filter(e => e.isDirectory()).length;
        } catch (err) {
          // skip
        }
      }
    }
    if (packageCount > 1) return 'monorepo';
  }

  // Read package.json for dependency analysis
  let pkg = {};
  try {
    const pkgContent = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8');
    pkg = JSON.parse(pkgContent);
  } catch (err) {
    // No package.json or invalid JSON
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Frontend indicators
  const frontendPkgs = ['react', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'vite', 'gatsby'];
  const hasFrontend = frontendPkgs.some(p => allDeps[p]);

  // Backend indicators
  const backendPkgs = ['express', 'fastify', '@nestjs/core', 'koa', '@hapi/hapi', 'hono'];
  const hasBackend = backendPkgs.some(p => allDeps[p]);

  // Library indicators
  if (pkg.main || pkg.module || pkg.exports) {
    const hasNoServer = !hasBackend;
    const hasNoUI = !hasFrontend;
    if (hasNoServer && hasNoUI) return 'library';
  }

  if (hasFrontend && hasBackend) return 'fullstack';
  if (hasFrontend) return 'frontend';
  if (hasBackend) return 'backend';

  // Check for server files
  if (fs.existsSync(path.join(projectRoot, 'server')) ||
      fs.existsSync(path.join(projectRoot, 'manage.py')) ||
      fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'backend';
  }

  // Check for src/components (frontend hint)
  if (fs.existsSync(path.join(projectRoot, 'src', 'components'))) {
    return 'frontend';
  }

  return 'unknown';
}

// ============================================================
// Git Utilities
// ============================================================

/**
 * Get current commit SHA.
 * @param {string} projectRoot
 * @returns {string|null}
 */
function getCommitSha(projectRoot) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (err) {
    return null;
  }
}

// ============================================================
// Main Scanner
// ============================================================

/**
 * Run all scanners and compile the contract surface.
 * @param {string} projectRoot - Project root directory
 * @param {Object} options
 * @param {string} options.projectName - Override project name
 * @param {string} options.projectType - Override project type
 * @param {number} options.maxFiles - Max files to scan per scanner (default 500)
 * @param {number} options.maxDepth - Max directory depth (default 6)
 * @param {boolean} options.verbose - Log progress
 * @returns {Object} Contract surface JSON
 */
function scanContracts(projectRoot, options = {}) {
  const verbose = options.verbose || false;

  if (verbose) console.log('Detecting project type...');
  const projectType = options.projectType || detectProjectType(projectRoot);

  if (verbose) console.log(`Project type: ${projectType}`);

  const surface = {
    version: CONTRACT_SURFACE_VERSION,
    projectName: options.projectName || path.basename(projectRoot),
    projectType,
    generatedAt: new Date().toISOString(),
    commitSha: getCommitSha(projectRoot),
    endpoints: {
      consumes: [],
      exposes: []
    },
    events: {
      emits: [],
      listensTo: []
    },
    sharedTypes: {
      imports: [],
      exports: []
    },
    environment: {
      requires: [],
      exposes: []
    }
  };

  const scanOptions = {
    maxFiles: options.maxFiles || 500,
    maxDepth: options.maxDepth || 6
  };

  // HTTP client calls
  if (verbose) console.log('Scanning HTTP client calls...');
  surface.endpoints.consumes = scanHttpClients(projectRoot, scanOptions);
  if (verbose) console.log(`  Found ${surface.endpoints.consumes.length} consumed endpoints`);

  // Route definitions
  if (verbose) console.log('Scanning route definitions...');
  surface.endpoints.exposes = scanRouteDefinitions(projectRoot, scanOptions);
  if (verbose) console.log(`  Found ${surface.endpoints.exposes.length} exposed endpoints`);

  // Event bus
  if (verbose) console.log('Scanning event emitters/listeners...');
  const events = scanEventBus(projectRoot, scanOptions);
  surface.events.emits = events.emits;
  surface.events.listensTo = events.listensTo;
  if (verbose) console.log(`  Found ${events.emits.length} emits, ${events.listensTo.length} listeners`);

  // Shared types
  if (verbose) console.log('Scanning shared type imports...');
  const types = scanSharedTypes(projectRoot, scanOptions);
  surface.sharedTypes.imports = types.imports;
  surface.sharedTypes.exports = types.exports;
  if (verbose) console.log(`  Found ${types.imports.length} imports, ${types.exports.length} exports`);

  // Environment variables
  if (verbose) console.log('Scanning environment variables...');
  const env = scanEnvVars(projectRoot, scanOptions);
  surface.environment.requires = env.requires;
  surface.environment.exposes = env.exposes;
  if (verbose) console.log(`  Found ${env.requires.length} required vars, ${env.exposes.length} defined vars`);

  return surface;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  scanContracts,
  scanHttpClients,
  scanRouteDefinitions,
  scanEventBus,
  scanSharedTypes,
  scanEnvVars,
  detectProjectType,
  walkSourceFiles,
  CONTRACT_SURFACE_VERSION
};
