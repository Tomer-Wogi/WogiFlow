'use strict';

/**
 * Component Registry Plugin
 *
 * Discovers React, Vue, and Svelte components and generates a machine-readable
 * component index. Complements the manual app-map.md (does NOT replace it).
 *
 * Scans configured directories for:
 * - React: function/class components, hooks (use* pattern)
 * - Vue: .vue SFC files
 * - Svelte: .svelte files
 *
 * Output: component-index.json (machine-readable), app-map.md entries (additive)
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, success, warn } = require('../flow-utils');
const { RegistryPlugin } = require('../flow-registry-manager');
const { BaseScanner, PROJECT_ROOT } = require('../flow-scanner-base');

const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const INDEX_PATH = path.join(STATE_DIR, 'component-index.json');

// ============================================================
// Component Scanner (extends BaseScanner for directory walking)
// ============================================================

const DEFAULT_DIRECTORIES = [
  'src/components',
  'src/hooks',
  'src/pages',
  'src/modules',
  'src/views',
  'src/ui',
  'components',
  'app'
];

class ComponentScanner extends BaseScanner {
  constructor(config = {}) {
    const globalConfig = getConfig();
    const componentConfig = globalConfig.componentIndex || {};

    super({
      configKey: 'componentIndex',
      directories: componentConfig.directories || componentConfig.scanDirs || DEFAULT_DIRECTORIES,
      filePatterns: ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.ts', '**/*.js'],
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
      ...config
    });

    this.registry = {
      version: '1.0.0',
      scannedAt: null,
      projectRoot: PROJECT_ROOT,
      components: [],
      hooks: [],
      categories: {}
    };
  }

  /**
   * Scan a single file for component exports.
   * @param {string} filePath - Full path to file
   */
  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(PROJECT_ROOT, filePath);
      const ext = path.extname(filePath);
      const category = this.getCategoryFromPath(relativePath);

      if (ext === '.vue') {
        this._scanVueFile(content, relativePath, category);
      } else if (ext === '.svelte') {
        this._scanSvelteFile(content, relativePath, category);
      } else {
        this._scanJSXFile(content, relativePath, category);
      }
    } catch (err) {
      // Skip files that can't be read
    }
  }

  /**
   * Detect React components and hooks from JSX/TSX files.
   */
  _scanJSXFile(content, relativePath, category) {
    const fileName = path.basename(relativePath, path.extname(relativePath));

    // Detect exported function components: export function ComponentName or export default function
    const exportFuncPattern = /export\s+(?:default\s+)?function\s+([A-Z]\w+)/g;
    let match;
    while ((match = exportFuncPattern.exec(content)) !== null) {
      this._addComponent(match[1], relativePath, category, 'react', content, match.index);
    }

    // Detect arrow function exports: export const ComponentName = ...
    const exportConstPattern = /export\s+(?:default\s+)?const\s+([A-Z]\w+)\s*[=:]/g;
    while ((match = exportConstPattern.exec(content)) !== null) {
      // Check if it looks like a component (returns JSX or is a React.FC)
      const name = match[1];
      if (this._looksLikeComponent(content, name)) {
        this._addComponent(name, relativePath, category, 'react', content, match.index);
      }
    }

    // Detect hooks: export function useXxx or export const useXxx
    const hookPattern = /export\s+(?:default\s+)?(?:function|const)\s+(use[A-Z]\w+)/g;
    while ((match = hookPattern.exec(content)) !== null) {
      this._addHook(match[1], relativePath, category, content, match.index);
    }

    // Detect class components: export class X extends (React.)Component
    const classPattern = /export\s+(?:default\s+)?class\s+(\w+)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/g;
    while ((match = classPattern.exec(content)) !== null) {
      this._addComponent(match[1], relativePath, category, 'react-class', content, match.index);
    }

    // Default export detection for PascalCase file names
    if (/^[A-Z]/.test(fileName) && /export\s+default/.test(content)) {
      const exists = this.registry.components.some(c =>
        c.file === relativePath && c.name === fileName
      );
      if (!exists && this._looksLikeComponent(content, fileName)) {
        this._addComponent(fileName, relativePath, category, 'react', content, 0);
      }
    }
  }

  /**
   * Detect Vue SFC components.
   */
  _scanVueFile(content, relativePath, category) {
    const fileName = path.basename(relativePath, '.vue');
    const name = fileName.charAt(0).toUpperCase() + fileName.slice(1);
    this._addComponent(name, relativePath, category, 'vue', content, 0);
  }

  /**
   * Detect Svelte components.
   */
  _scanSvelteFile(content, relativePath, category) {
    const fileName = path.basename(relativePath, '.svelte');
    const name = fileName.charAt(0).toUpperCase() + fileName.slice(1);
    this._addComponent(name, relativePath, category, 'svelte', content, 0);
  }

  /**
   * Heuristic: does the content look like it defines a React component?
   */
  _looksLikeComponent(content, _name) {
    return (
      content.includes('React') ||
      content.includes('jsx') ||
      content.includes('tsx') ||
      /<\w/.test(content) ||    // JSX tags
      /React\.FC/.test(content) ||
      /React\.Component/.test(content) ||
      /return\s*\(?\s*</.test(content)
    );
  }

  _addComponent(name, file, category, framework, content, position) {
    // Deduplicate using Set for O(1) lookup
    if (!this._componentKeys) this._componentKeys = new Set();
    const key = `${name}::${file}`;
    if (this._componentKeys.has(key)) return;
    this._componentKeys.add(key);

    const line = content ? this.getLineNumber(content, position) : 1;
    const description = content ? this.extractJSDocBefore(content, position) : '';

    this.registry.components.push({
      name,
      file,
      category,
      framework,
      description,
      line
    });

    if (!this.registry.categories[category]) {
      this.registry.categories[category] = [];
    }
    if (!this.registry.categories[category].includes(name)) {
      this.registry.categories[category].push(name);
    }
  }

  _addHook(name, file, category, content, position) {
    if (!this._hookKeys) this._hookKeys = new Set();
    const key = `${name}::${file}`;
    if (this._hookKeys.has(key)) return;
    this._hookKeys.add(key);

    const line = content ? this.getLineNumber(content, position) : 1;
    const description = content ? this.extractJSDocBefore(content, position) : '';

    this.registry.hooks.push({
      name,
      file,
      category,
      description,
      line
    });
  }

  async scan() {
    console.log('\n' + color('cyan', '🔍 Scanning codebase for components...') + '\n');

    const directories = this.findDirectories();
    if (directories.length === 0) {
      console.log(color('yellow', '   No component directories found'));
      console.log('   Searched:', this.config.directories.join(', '));
      return null;
    }

    console.log(`   Directories: ${directories.map(d => path.relative(PROJECT_ROOT, d)).join(', ')}`);

    for (const dir of directories) {
      await this.scanDirectoryRecursive(dir, (filePath) => {
        this.scanFile(filePath);
      });
    }

    this.registry.scannedAt = new Date().toISOString();

    console.log(`\n   Found ${color('green', this.registry.components.length)} components`);
    console.log(`   Found ${color('green', this.registry.hooks.length)} hooks`);
    console.log(`   Categories: ${Object.keys(this.registry.categories).join(', ') || '(none)'}`);

    return this.registry;
  }

  prune() {
    const before = this.registry.components.length + this.registry.hooks.length;

    this.registry.components = this.registry.components.filter(c => {
      const fullPath = path.isAbsolute(c.file) ? c.file : path.join(PROJECT_ROOT, c.file);
      return fs.existsSync(fullPath);
    });

    this.registry.hooks = this.registry.hooks.filter(h => {
      const fullPath = path.isAbsolute(h.file) ? h.file : path.join(PROJECT_ROOT, h.file);
      return fs.existsSync(fullPath);
    });

    // Rebuild categories
    this.registry.categories = {};
    for (const comp of this.registry.components) {
      if (!this.registry.categories[comp.category]) {
        this.registry.categories[comp.category] = [];
      }
      this.registry.categories[comp.category].push(comp.name);
    }

    const after = this.registry.components.length + this.registry.hooks.length;
    const removed = before - after;
    if (removed > 0) {
      console.log(`   Pruned ${color('yellow', removed)} orphaned entries`);
    }
    return removed;
  }

  save() {
    this.prune();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(this.registry, null, 2));
    success(`Saved to ${path.relative(PROJECT_ROOT, INDEX_PATH)}`);
  }

  generateMap() {
    // Component registry generates component-index.json only.
    // It does NOT overwrite app-map.md — that remains human-curated.
    // The index is complementary: auto-generated for machine use.
    success(`Component index available at ${path.relative(PROJECT_ROOT, INDEX_PATH)}`);
  }
}

// ============================================================
// ComponentRegistry Plugin (wraps ComponentScanner)
// ============================================================

class ComponentRegistry extends RegistryPlugin {
  static id = 'components';
  static name = 'Component Registry';
  static mapFile = 'app-map.md';
  static indexFile = 'component-index.json';
  static category = 'code';
  static type = 'components';

  constructor() {
    super();
    this.scanner = new ComponentScanner();
  }

  activateWhen(stack) {
    // Activate for any frontend framework, or if component directories exist
    if (!stack) return true; // Default: always try
    if (stack.frameworks) {
      if (stack.frameworks.frontend) return true;
      if (stack.frameworks.fullStack) return true;
    }
    // Also activate if component directories exist even without detected framework
    return this.scanner.findDirectories().length > 0;
  }

  async scan() {
    return this.scanner.scan();
  }

  prune() {
    return this.scanner.prune();
  }

  save() {
    this.scanner.save();
  }

  generateMap() {
    this.scanner.generateMap();
  }

  _getActivateWhenLabel() {
    return 'frontend framework or component directories exist';
  }
}

module.exports = { ComponentRegistry, ComponentScanner };
