'use strict';

/**
 * Architecture/Service Registry Plugin
 *
 * Detects and tracks service architecture components:
 * - NestJS: controllers, services, modules, guards, middleware
 * - Express/Fastify: middleware, route handlers
 * - Django: views, viewsets, serializers
 * - Go: HTTP handlers, interfaces
 *
 * Produces: service-map.md (human-readable) + service-index.json (machine-readable)
 */

const fs = require('fs');
const path = require('path');
const { RegistryPlugin } = require('../flow-registry-manager');
const { getProjectRoot, safeJsonParse: safeJsonParseFile } = require('../flow-utils');

const PROJECT_ROOT = getProjectRoot();
const STATE_DIR = path.join(PROJECT_ROOT, '.workflow', 'state');
const INDEX_PATH = path.join(STATE_DIR, 'service-index.json');
const MAP_PATH = path.join(STATE_DIR, 'service-map.md');

// Decorator/annotation patterns per framework
const NESTJS_PATTERNS = {
  controller: /@Controller\(\s*['"]([^'"]*)['"]\s*\)/,
  get: /@Get\(\s*['"]?([^'")\s]*)?['"]?\s*\)/,
  post: /@Post\(\s*['"]?([^'")\s]*)?['"]?\s*\)/,
  put: /@Put\(\s*['"]?([^'")\s]*)?['"]?\s*\)/,
  patch: /@Patch\(\s*['"]?([^'")\s]*)?['"]?\s*\)/,
  delete: /@Delete\(\s*['"]?([^'")\s]*)?['"]?\s*\)/,
  injectable: /@Injectable\(\)/,
  module: /@Module\(\s*\{/,
  guard: /@UseGuards\(\s*([^)]+)\)/
};

const DJANGO_PATTERNS = {
  viewset: /class\s+(\w+)\(.*(?:ViewSet|ModelViewSet|GenericViewSet)\)/,
  apiView: /class\s+(\w+)\(.*(?:APIView|GenericAPIView)\)/,
  view: /class\s+(\w+)\(.*(?:View|TemplateView|ListView|DetailView)\)/,
  serializer: /class\s+(\w+)\(.*(?:Serializer|ModelSerializer)\)/
};

class ServiceRegistry extends RegistryPlugin {
  static id = 'services';
  static name = 'Service/Architecture Registry';
  static mapFile = 'service-map.md';
  static indexFile = 'service-index.json';
  static category = 'architecture';
  static type = 'services';

  constructor() {
    super();
    this.controllers = [];
    this.services = [];
    this.middleware = [];
    this.modules = [];
    this.metadata = {};
    this._cachedPkg = undefined; // Cache package.json across methods
  }

  _getPackageJson() {
    if (this._cachedPkg !== undefined) return this._cachedPkg;
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    try {
      this._cachedPkg = safeJsonParseFile(pkgPath, {});
    } catch {
      this._cachedPkg = {};
    }
    return this._cachedPkg;
  }

  /**
   * Activate when a backend framework is detected.
   */
  activateWhen(stack) {
    if (!stack) return false;

    // Check for backend frameworks
    if (stack.frameworks) {
      if (stack.frameworks.backend) return true;
      if (stack.frameworks.fullStack) return true;
    }

    // Check package.json for backend packages (cached)
    try {
      const pkg = this._getPackageJson();
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const backendPkgs = ['@nestjs/core', 'express', 'fastify', '@hapi/hapi', 'koa'];
      if (backendPkgs.some(p => allDeps[p])) return true;
    } catch {
      // ignore
    }

    // Check for Django (manage.py)
    if (fs.existsSync(path.join(PROJECT_ROOT, 'manage.py'))) return true;

    // Check for Go (go.mod with net/http)
    const goModPath = path.join(PROJECT_ROOT, 'go.mod');
    if (fs.existsSync(goModPath)) return true;

    return false;
  }

  async scan() {
    this.controllers = [];
    this.services = [];
    this.middleware = [];
    this.modules = [];
    this.metadata = {};

    // Detect framework and scan
    const framework = this._detectFramework();
    this.metadata.framework = framework;

    switch (framework) {
      case 'nestjs':
        this._scanNestJS();
        break;
      case 'express':
      case 'fastify':
        this._scanExpress();
        break;
      case 'django':
        this._scanDjango();
        break;
      case 'go':
        this._scanGo();
        break;
      default:
        return null;
    }

    if (this.controllers.length === 0 && this.services.length === 0 && this.middleware.length === 0) {
      return null;
    }

    return this._buildIndex();
  }

  prune() {
    const allArrays = [this.controllers, this.services, this.middleware, this.modules];
    let removed = 0;

    for (const arr of allArrays) {
      const before = arr.length;
      const pruned = arr.filter(item => {
        if (!item.file) return true;
        return fs.existsSync(path.join(PROJECT_ROOT, item.file));
      });
      removed += before - pruned.length;
      arr.length = 0;
      arr.push(...pruned);
    }

    if (removed > 0) {
      this.save();
      this.generateMap();
    }
    return removed;
  }

  save() {
    const index = this._buildIndex();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  }

  generateMap() {
    const lines = ['# Service Map\n'];

    if (this.metadata.framework) {
      lines.push(`**Framework**: ${this.metadata.framework}`);
      lines.push('');
    }

    // Controllers table
    if (this.controllers.length > 0) {
      lines.push('## Controllers\n');
      lines.push('| Controller | Route Prefix | Methods | File |');
      lines.push('|-----------|-------------|---------|------|');

      for (const ctrl of this.controllers) {
        const methods = ctrl.methods.length > 0
          ? ctrl.methods.map(m => `${m.verb} ${m.path}`).join(', ')
          : '-';
        lines.push(`| ${ctrl.name} | ${ctrl.routePrefix || '/'} | ${methods} | ${ctrl.file} |`);
      }
      lines.push('');
    }

    // Services table
    if (this.services.length > 0) {
      lines.push('## Services\n');
      lines.push('| Service | Injected Into | Dependencies | File |');
      lines.push('|---------|--------------|-------------|------|');

      for (const svc of this.services) {
        const injectedInto = svc.injectedInto.length > 0 ? svc.injectedInto.join(', ') : '-';
        const deps = svc.dependencies.length > 0 ? svc.dependencies.join(', ') : '-';
        lines.push(`| ${svc.name} | ${injectedInto} | ${deps} | ${svc.file} |`);
      }
      lines.push('');
    }

    // Middleware table
    if (this.middleware.length > 0) {
      lines.push('## Middleware\n');
      lines.push('| Middleware | Applied To | File |');
      lines.push('|-----------|-----------|------|');

      for (const mw of this.middleware) {
        lines.push(`| ${mw.name} | ${mw.appliedTo || '*'} | ${mw.file} |`);
      }
      lines.push('');
    }

    // Modules table (NestJS)
    if (this.modules.length > 0) {
      lines.push('## Modules\n');
      lines.push('| Module | Imports | Exports | Providers | File |');
      lines.push('|--------|---------|---------|-----------|------|');

      for (const mod of this.modules) {
        const imports = mod.imports.length > 0 ? mod.imports.join(', ') : '-';
        const exports = mod.exports.length > 0 ? mod.exports.join(', ') : '-';
        const providers = mod.providers.length > 0 ? mod.providers.join(', ') : '-';
        lines.push(`| ${mod.name} | ${imports} | ${exports} | ${providers} | ${mod.file} |`);
      }
      lines.push('');
    }

    if (this.controllers.length === 0 && this.services.length === 0) {
      lines.push('*No services detected. Run `flow registry-manager scan` after adding backend code.*\n');
    }

    lines.push(`---\n*Auto-generated by Service Registry — ${new Date().toISOString().split('T')[0]}*\n`);

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(MAP_PATH, lines.join('\n'));
  }

  _getActivateWhenLabel() {
    return 'backend framework detected (NestJS, Express, Django, Go)';
  }

  // ============================================================
  // Framework Detection
  // ============================================================

  _detectFramework() {
    // Use cached package.json
    try {
      const pkg = this._getPackageJson();
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['@nestjs/core']) return 'nestjs';
      if (allDeps['express']) return 'express';
      if (allDeps['fastify']) return 'fastify';
    } catch {
      // ignore
    }

    if (fs.existsSync(path.join(PROJECT_ROOT, 'manage.py'))) return 'django';
    if (fs.existsSync(path.join(PROJECT_ROOT, 'go.mod'))) return 'go';

    return null;
  }

  // ============================================================
  // NestJS Scanner
  // ============================================================

  _scanNestJS() {
    const searchDirs = ['src', 'apps', 'libs'];

    for (const dir of searchDirs) {
      const fullDir = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(fullDir)) {
        this._findNestJSFiles(fullDir);
      }
    }
  }

  _findNestJSFiles(dir, depth = 0) {
    if (depth > 8) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist') continue;
        const fullPath = path.resolve(dir, entry.name);

        // Ensure resolved path stays within project root
        if (!fullPath.startsWith(PROJECT_ROOT)) continue;

        if (entry.isDirectory()) {
          this._findNestJSFiles(fullPath, depth + 1);
        } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
                   // Pre-filter: skip spec/test files and likely non-NestJS files
                   !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.test.ts') &&
                   !entry.name.endsWith('.d.ts')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(PROJECT_ROOT, fullPath);

            if (content.includes('@Controller')) {
              this._parseNestJSController(content, relPath);
            }
            if (content.includes('@Injectable')) {
              this._parseNestJSService(content, relPath);
            }
            if (content.includes('@Module')) {
              this._parseNestJSModule(content, relPath);
            }
            if (content.includes('CanActivate') || content.includes('@UseGuards')) {
              this._parseNestJSMiddleware(content, relPath, 'guard');
            }
            if (content.includes('NestMiddleware')) {
              this._parseNestJSMiddleware(content, relPath, 'middleware');
            }
          } catch (err) {
            // Skip unreadable files
          }
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  _parseNestJSController(content, filePath) {
    const ctrlMatch = content.match(NESTJS_PATTERNS.controller);
    if (!ctrlMatch) return;

    const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/);
    if (!classMatch) return;

    const routePrefix = ctrlMatch[1] || '/';
    const methods = [];

    // Parse route methods
    const methodPatterns = [
      { regex: /@Get\(\s*['"]?([^'")\s]*)?['"]?\s*\)/g, verb: 'GET' },
      { regex: /@Post\(\s*['"]?([^'")\s]*)?['"]?\s*\)/g, verb: 'POST' },
      { regex: /@Put\(\s*['"]?([^'")\s]*)?['"]?\s*\)/g, verb: 'PUT' },
      { regex: /@Patch\(\s*['"]?([^'")\s]*)?['"]?\s*\)/g, verb: 'PATCH' },
      { regex: /@Delete\(\s*['"]?([^'")\s]*)?['"]?\s*\)/g, verb: 'DELETE' }
    ];

    for (const { regex, verb } of methodPatterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        methods.push({ verb, path: match[1] || '/' });
      }
    }

    this.controllers.push({
      name: classMatch[1],
      routePrefix,
      methods,
      file: filePath
    });
  }

  _parseNestJSService(content, filePath) {
    // Only parse @Injectable services that aren't controllers or guards
    if (content.includes('@Controller') || content.includes('CanActivate')) return;

    const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/);
    if (!classMatch) return;

    // Parse constructor dependencies
    const dependencies = [];
    const ctorMatch = content.match(/constructor\s*\(([^)]*)\)/s);
    if (ctorMatch) {
      const params = ctorMatch[1];
      const depRegex = /(?:private|readonly|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)/g;
      let depMatch;
      while ((depMatch = depRegex.exec(params)) !== null) {
        dependencies.push(depMatch[2]);
      }
    }

    this.services.push({
      name: classMatch[1],
      dependencies,
      injectedInto: [], // Populated in post-processing
      file: filePath
    });
  }

  _parseNestJSModule(content, filePath) {
    const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/);
    if (!classMatch) return;

    const extractArray = (key) => {
      const regex = new RegExp(key + '\\s*:\\s*\\[([^\\]]*)', 's');
      const match = content.match(regex);
      if (!match) return [];
      return match[1].match(/\w+/g) || [];
    };

    this.modules.push({
      name: classMatch[1],
      imports: extractArray('imports'),
      exports: extractArray('exports'),
      providers: extractArray('providers'),
      controllers: extractArray('controllers'),
      file: filePath
    });
  }

  _parseNestJSMiddleware(content, filePath, type) {
    const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/);
    if (!classMatch) return;

    this.middleware.push({
      name: classMatch[1],
      type,
      appliedTo: '*',
      file: filePath
    });
  }

  // ============================================================
  // Express/Fastify Scanner
  // ============================================================

  _scanExpress() {
    const searchDirs = ['src', 'routes', 'middleware', 'src/routes', 'src/middleware', 'lib'];

    for (const dir of searchDirs) {
      const fullDir = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(fullDir)) {
        this._findExpressFiles(fullDir);
      }
    }
  }

  _findExpressFiles(dir, depth = 0) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const fullPath = path.resolve(dir, entry.name);

        // Ensure resolved path stays within project root
        if (!fullPath.startsWith(PROJECT_ROOT)) continue;

        if (entry.isDirectory()) {
          this._findExpressFiles(fullPath, depth + 1);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(PROJECT_ROOT, fullPath);

            // Detect route handlers
            if (content.match(/router\.(get|post|put|patch|delete)\s*\(/i) ||
                content.match(/app\.(get|post|put|patch|delete)\s*\(/i)) {
              this._parseExpressRoutes(content, relPath);
            }

            // Detect middleware
            if (content.match(/(?:module\.exports|export\s+(?:default|const))\s*=?\s*(?:function|\((?:req|request),\s*(?:res|response),\s*next\))/)) {
              this.middleware.push({
                name: path.basename(relPath, path.extname(relPath)),
                type: 'middleware',
                appliedTo: '*',
                file: relPath
              });
            }
          } catch (err) {
            // Skip
          }
        }
      }
    } catch (err) {
      // Skip
    }
  }

  _parseExpressRoutes(content, filePath) {
    const methods = [];
    const routeRegex = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      methods.push({ verb: match[1].toUpperCase(), path: match[2] });
    }

    if (methods.length > 0) {
      const name = path.basename(filePath, path.extname(filePath));
      this.controllers.push({
        name: name + 'Routes',
        routePrefix: '/',
        methods,
        file: filePath
      });
    }
  }

  // ============================================================
  // Django Scanner
  // ============================================================

  _scanDjango() {
    // Find all apps by looking for views.py files
    this._findDjangoFiles(PROJECT_ROOT, 0);
  }

  _findDjangoFiles(dir, depth) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (['node_modules', '.git', '__pycache__', 'venv', '.venv', 'env'].includes(entry.name)) continue;
        const fullPath = path.resolve(dir, entry.name);

        // Ensure resolved path stays within project root
        if (!fullPath.startsWith(PROJECT_ROOT)) continue;

        if (entry.isDirectory()) {
          this._findDjangoFiles(fullPath, depth + 1);
        } else if (entry.name === 'views.py' || entry.name === 'serializers.py') {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(PROJECT_ROOT, fullPath);
            this._parseDjangoFile(content, relPath);
          } catch (err) {
            // Skip
          }
        }
      }
    } catch (err) {
      // Skip
    }
  }

  _parseDjangoFile(content, filePath) {
    // ViewSets and APIViews
    for (const [, pattern] of Object.entries(DJANGO_PATTERNS)) {
      const regex = new RegExp(pattern.source, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const className = match[1];
        const isSerializer = className.includes('Serializer');

        if (isSerializer) {
          this.services.push({
            name: className,
            dependencies: [],
            injectedInto: [],
            file: filePath
          });
        } else {
          this.controllers.push({
            name: className,
            routePrefix: '/',
            methods: [],
            file: filePath
          });
        }
      }
    }
  }

  // ============================================================
  // Go Scanner
  // ============================================================

  _scanGo() {
    this._findGoHandlers(PROJECT_ROOT, 0);
  }

  _findGoHandlers(dir, depth) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (['vendor', '.git', 'node_modules'].includes(entry.name)) continue;
        const fullPath = path.resolve(dir, entry.name);

        // Ensure resolved path stays within project root
        if (!fullPath.startsWith(PROJECT_ROOT)) continue;

        if (entry.isDirectory()) {
          this._findGoHandlers(fullPath, depth + 1);
        } else if (entry.name.endsWith('.go')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('http.Handler') || content.includes('HandleFunc') || content.includes('gin.Context')) {
              const relPath = path.relative(PROJECT_ROOT, fullPath);
              this._parseGoFile(content, relPath);
            }
          } catch (err) {
            // Skip
          }
        }
      }
    } catch (err) {
      // Skip
    }
  }

  _parseGoFile(content, filePath) {
    // Parse HTTP handler functions
    const handlerRegex = /func\s+(\w+)\s*\(\s*\w+\s+(?:http\.ResponseWriter|[\*]?gin\.Context)/g;
    let match;
    const methods = [];

    while ((match = handlerRegex.exec(content)) !== null) {
      methods.push({ verb: 'HANDLER', path: match[1] });
    }

    // Parse HandleFunc registrations
    const routeRegex = /(?:Handle(?:Func)?|(?:GET|POST|PUT|DELETE))\s*\(\s*["']([^"']+)["']/g;
    while ((match = routeRegex.exec(content)) !== null) {
      methods.push({ verb: 'ROUTE', path: match[1] });
    }

    if (methods.length > 0) {
      const name = path.basename(filePath, '.go');
      this.controllers.push({
        name,
        routePrefix: '/',
        methods,
        file: filePath
      });
    }
  }

  // ============================================================
  // Index Builder
  // ============================================================

  _buildIndex() {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      framework: this.metadata.framework || 'unknown',
      controllers: this.controllers.map(c => ({
        name: c.name,
        routePrefix: c.routePrefix,
        methods: c.methods,
        file: c.file
      })),
      services: this.services.map(s => ({
        name: s.name,
        dependencies: s.dependencies,
        injectedInto: s.injectedInto,
        file: s.file
      })),
      middleware: this.middleware.map(m => ({
        name: m.name,
        type: m.type,
        appliedTo: m.appliedTo,
        file: m.file
      })),
      modules: this.modules.map(m => ({
        name: m.name,
        imports: m.imports,
        exports: m.exports,
        providers: m.providers,
        file: m.file
      })),
      summary: {
        controllerCount: this.controllers.length,
        serviceCount: this.services.length,
        middlewareCount: this.middleware.length,
        moduleCount: this.modules.length
      }
    };
  }
}

module.exports = { ServiceRegistry };
