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

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, color, success, warn, PATHS } = require('../flow-utils');
const { RegistryPlugin } = require('../flow-registry-manager');
const { BaseScanner, PROJECT_ROOT } = require('../flow-scanner-base');
const { info } = require('../flow-output');

const INDEX_PATH = path.join(PATHS.state, 'component-index.json');

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
  'app',
  'app/components',
  'app/hooks',
  'lib/components',
  'lib/hooks',
  'pages',
  'packages'
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
    } catch (_err) {
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
    info('Scanning codebase for components...');

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
    fs.mkdirSync(PATHS.state, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(this.registry, null, 2));
    success(`Saved to ${path.relative(PROJECT_ROOT, INDEX_PATH)}`);
  }

  generateMap() {
    const MAP_PATH = PATHS.appMap;

    // Check if app-map.md exists and has content
    let existing = '';
    try {
      existing = fs.readFileSync(MAP_PATH, 'utf-8');
    } catch (_err) {
      // File doesn't exist — will create
    }

    // Use marker to distinguish auto-generated from human-curated
    const AUTO_MARKER = '<!-- AUTO-GENERATED BY COMPONENT SCANNER -->';
    const isAutoGenerated = existing.includes(AUTO_MARKER);
    const hasContent = existing.split('\n').filter(l => l.startsWith('|')).length > 5;

    if (hasContent && !isAutoGenerated) {
      // Human-curated content — merge without overwriting
      this._mergeIntoAppMap(MAP_PATH, existing);
      return;
    }

    // Generate fresh app-map.md from scan results
    const lines = [
      '# App Map',
      '',
      AUTO_MARKER,
      '',
      'Component and page registry. **Check before creating anything new.**',
      '',
      '> Auto-generated by component scanner. Edit to add context.',
      '',
      '---',
      ''
    ];

    // Group components by category
    const categories = {};
    for (const comp of this.registry.components) {
      const cat = comp.category || 'uncategorized';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(comp);
    }

    // Components section
    if (this.registry.components.length > 0) {
      lines.push('## Components', '');

      for (const cat of Object.keys(categories).sort()) {
        const catName = cat.charAt(0).toUpperCase() + cat.slice(1);
        lines.push(`### ${catName}`, '');
        lines.push('| Component | File | Description |');
        lines.push('|-----------|------|-------------|');

        for (const comp of categories[cat].sort((a, b) => a.name.localeCompare(b.name))) {
          const desc = comp.description || '-';
          lines.push(`| \`${comp.name}\` | \`${comp.file}\` | ${desc} |`);
        }
        lines.push('');
      }
    }

    // Hooks section
    if (this.registry.hooks.length > 0) {
      lines.push('## Hooks', '');
      lines.push('| Hook | File | Description |');
      lines.push('|------|------|-------------|');

      for (const hook of this.registry.hooks.sort((a, b) => a.name.localeCompare(b.name))) {
        const desc = hook.description || '-';
        lines.push(`| \`${hook.name}\` | \`${hook.file}\` | ${desc} |`);
      }
      lines.push('');
    }

    lines.push('---', '');
    lines.push('## Rules', '');
    lines.push('1. **Before creating** → Search this file');
    lines.push('2. **If similar exists** → Add variant, don\'t create new');
    lines.push('3. **After creating** → Run `flow registry-manager scan` to update');
    lines.push('');

    fs.writeFileSync(MAP_PATH, lines.join('\n'));
    success(`Generated ${path.relative(PROJECT_ROOT, MAP_PATH)} (${this.registry.components.length} components, ${this.registry.hooks.length} hooks)`);
  }

  /**
   * Merge scanner results into existing app-map.md without overwriting curated content.
   * Adds only components not already present.
   */
  _mergeIntoAppMap(mapPath, existing) {
    // Path containment check (defense-in-depth)
    if (!mapPath.startsWith(PATHS.state)) {
      warn('Write target outside state directory — skipping merge');
      return;
    }

    // Extract names already in app-map (with or without backticks)
    const existingNames = new Set();
    const nameRegex = /\|\s*`?(\w+)`?\s*\|/g;
    let m;
    while ((m = nameRegex.exec(existing)) !== null) {
      existingNames.add(m[1]);
    }

    // Find new components not in app-map
    const newComponents = this.registry.components.filter(c => !existingNames.has(c.name));
    const newHooks = this.registry.hooks.filter(h => !existingNames.has(h.name));

    if (newComponents.length === 0 && newHooks.length === 0) {
      info(`app-map.md is up to date (${existingNames.size} entries)`);
      return;
    }

    // Remove existing "## Auto-Discovered" section if present (prevent duplicates)
    const autoDiscoveredIdx = existing.indexOf('\n## Auto-Discovered');
    const base = autoDiscoveredIdx !== -1 ? existing.substring(0, autoDiscoveredIdx) : existing;

    const additions = ['\n## Auto-Discovered (new entries)', ''];

    if (newComponents.length > 0) {
      additions.push('### Components', '');
      additions.push('| Component | File | Description |');
      additions.push('|-----------|------|-------------|');
      for (const comp of newComponents.sort((a, b) => a.name.localeCompare(b.name))) {
        additions.push(`| \`${comp.name}\` | \`${comp.file}\` | ${comp.description || '-'} |`);
      }
      additions.push('');
    }

    if (newHooks.length > 0) {
      additions.push('### Hooks', '');
      additions.push('| Hook | File | Description |');
      additions.push('|------|------|-------------|');
      for (const hook of newHooks.sort((a, b) => a.name.localeCompare(b.name))) {
        additions.push(`| \`${hook.name}\` | \`${hook.file}\` | ${hook.description || '-'} |`);
      }
      additions.push('');
    }

    fs.writeFileSync(mapPath, base + additions.join('\n'));
    success(`Merged ${newComponents.length} components + ${newHooks.length} hooks into app-map.md`);
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
