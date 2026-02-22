#!/usr/bin/env node

'use strict';

/**
 * Wogi Flow - Registry Manager
 *
 * Plugin-based orchestrator for all code registries. Loads registry plugins,
 * activates them based on detected tech stack, orchestrates scans, and
 * generates registry-manifest.json for dynamic discovery by consuming systems.
 *
 * Usage:
 *   flow registry-manager scan         # Scan all active registries
 *   flow registry-manager list         # List registered plugins + status
 *   flow registry-manager manifest     # Regenerate manifest only
 *   flow registry-manager status       # Show detailed activation status
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, safeJsonParse, color, success, warn, error, info } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const MANIFEST_PATH = path.join(STATE_DIR, 'registry-manifest.json');
const REGISTRIES_DIR = path.join(__dirname, 'registries');

// ============================================================
// RegistryPlugin Base Class
// ============================================================

/**
 * Base class for all registry plugins.
 * Each plugin must provide static metadata and implement core methods.
 *
 * Subclasses MUST override:
 *   - static id, name, mapFile, indexFile, category, type
 *   - activateWhen(stack)
 *   - scan(), prune(), save(), generateMap()
 */
class RegistryPlugin {
  // Plugin metadata — subclasses MUST override these
  static id = 'base';
  static name = 'Base Registry';
  static mapFile = null;
  static indexFile = null;
  static category = 'code';       // code | database | architecture
  static type = 'base';

  constructor() {
    this._active = false;
  }

  /**
   * Determine if this plugin should be active for the given stack.
   * Default plugins (functions, APIs, components) always return true.
   * Stack-specific plugins check for ORM, framework, language, etc.
   *
   * @param {Object} stack - Output from detectStack()
   * @returns {boolean} True if plugin should activate
   */
  activateWhen(stack) {
    return true;
  }

  /**
   * Scan the codebase and populate this registry.
   * @returns {Object|null} Registry data or null if nothing found
   */
  async scan() {
    throw new Error(`${this.constructor.name}.scan() not implemented`);
  }

  /**
   * Remove entries whose source files no longer exist.
   * @returns {number} Number of pruned entries
   */
  prune() {
    throw new Error(`${this.constructor.name}.prune() not implemented`);
  }

  /**
   * Save the machine-readable index file.
   */
  save() {
    throw new Error(`${this.constructor.name}.save() not implemented`);
  }

  /**
   * Generate the human-readable map file.
   */
  generateMap() {
    throw new Error(`${this.constructor.name}.generateMap() not implemented`);
  }

  /**
   * Get plugin metadata as a plain object (for manifest).
   * @returns {Object} Plugin descriptor
   */
  getDescriptor() {
    const ctor = this.constructor;
    return {
      id: ctor.id,
      name: ctor.name,
      mapFile: ctor.mapFile,
      indexFile: ctor.indexFile,
      category: ctor.category,
      type: ctor.type,
      enabled: true,
      active: this._active,
      activateWhen: this._getActivateWhenLabel()
    };
  }

  /**
   * Human-readable label for activation condition.
   * @returns {string}
   */
  _getActivateWhenLabel() {
    return 'always';
  }
}

// ============================================================
// RegistryManager
// ============================================================

class RegistryManager {
  constructor() {
    this.plugins = [];
    this.activePlugins = [];
    this.stack = null;
  }

  /**
   * Load all registry plugins from the registries/ directory.
   * Also reads config for per-plugin overrides (enabled/disabled).
   */
  loadPlugins() {
    const config = getConfig();
    const registriesConfig = this._resolveRegistriesConfig(config);

    // Auto-discover plugin files in registries/ directory
    if (!fs.existsSync(REGISTRIES_DIR)) {
      warn('No registries directory found at scripts/registries/');
      return;
    }

    // Allowlist of known safe registry plugin filenames
    const ALLOWED_REGISTRY_FILES = new Set([
      'function-registry.js',
      'api-registry.js',
      'component-registry.js',
      'schema-registry.js',
      'service-registry.js'
    ]);

    const pluginFiles = fs.readdirSync(REGISTRIES_DIR)
      .filter(f => f.endsWith('-registry.js') && ALLOWED_REGISTRY_FILES.has(f))
      .sort();

    for (const file of pluginFiles) {
      try {
        const pluginModule = require(path.join(REGISTRIES_DIR, file));
        const PluginClass = pluginModule.default || pluginModule[Object.keys(pluginModule).find(k => {
          const val = pluginModule[k];
          return typeof val === 'function' && val.prototype instanceof RegistryPlugin;
        })] || pluginModule;

        // Handle modules that export { SomeRegistry } or export default SomeRegistry
        const Plugin = typeof PluginClass === 'function' && PluginClass.id
          ? PluginClass
          : null;

        if (!Plugin) {
          // Try to find exported class that has static id
          let found = false;
          for (const key of Object.keys(pluginModule)) {
            if (typeof pluginModule[key] === 'function' && pluginModule[key].id) {
              this._registerPlugin(pluginModule[key], registriesConfig);
              found = true;
              break;
            }
          }
          if (!found) {
            warn(`Plugin ${file}: no RegistryPlugin export found — skipping`);
          }
          continue;
        }

        this._registerPlugin(Plugin, registriesConfig);
      } catch (err) {
        warn(`Failed to load plugin ${file}: ${err.message}`);
      }
    }
  }

  /**
   * Register a single plugin class, applying config overrides.
   * @param {Function} PluginClass - The plugin class
   * @param {Object[]} registriesConfig - Resolved registries config array
   */
  _registerPlugin(PluginClass, registriesConfig) {
    const pluginConfig = registriesConfig.find(r => r.id === PluginClass.id);

    // Check if explicitly disabled in config
    if (pluginConfig && pluginConfig.enabled === false) {
      return;
    }

    const instance = new PluginClass();
    this.plugins.push(instance);
  }

  /**
   * Resolve registries config from both old-format and new-format.
   * Old format: separate functionRegistry, apiRegistry, componentIndex keys
   * New format: unified registries[] array
   *
   * @param {Object} config - Full config object
   * @returns {Object[]} Normalized registries array
   */
  _resolveRegistriesConfig(config) {
    // New format takes priority
    if (config.registries && Array.isArray(config.registries)) {
      return config.registries;
    }

    // Fall back to old format — build registries array from individual sections
    const registries = [];

    if (config.componentIndex) {
      registries.push({
        id: 'components',
        enabled: config.componentIndex.autoScan !== false,
        directories: config.componentIndex.directories || config.componentIndex.scanDirs,
        ...config.componentIndex
      });
    }

    if (config.functionRegistry) {
      registries.push({
        id: 'functions',
        enabled: config.functionRegistry.enabled !== false,
        directories: config.functionRegistry.directories || config.functionRegistry.scanDirs,
        ...config.functionRegistry
      });
    }

    if (config.apiRegistry) {
      registries.push({
        id: 'apis',
        enabled: config.apiRegistry.enabled !== false,
        directories: config.apiRegistry.directories || config.apiRegistry.scanDirs,
        ...config.apiRegistry
      });
    }

    return registries;
  }

  /**
   * Activate plugins based on detected tech stack.
   * Calls activateWhen(stack) on each loaded plugin.
   */
  activatePlugins() {
    // Detect stack
    try {
      const { detectStack } = require('./flow-context-init');
      this.stack = detectStack(PROJECT_ROOT);
    } catch (err) {
      this.stack = null;
    }

    this.activePlugins = [];

    for (const plugin of this.plugins) {
      try {
        const shouldActivate = plugin.activateWhen(this.stack);
        plugin._active = shouldActivate;
        if (shouldActivate) {
          this.activePlugins.push(plugin);
        }
      } catch (err) {
        warn(`Plugin ${plugin.constructor.id} activation check failed: ${err.message}`);
        plugin._active = false;
      }
    }
  }

  /**
   * Scan all active registries.
   * @returns {Object} Scan results summary
   */
  async scanAll() {
    const results = {};

    await Promise.all(this.activePlugins.map(async (plugin) => {
      const id = plugin.constructor.id;
      try {
        const registry = await plugin.scan();
        if (registry) {
          plugin.save();
          plugin.generateMap();
          results[id] = { success: true };
        } else {
          results[id] = { success: true, empty: true };
        }
      } catch (err) {
        results[id] = { success: false, error: err.message };
        warn(`Scan failed for ${id}: ${err.message}`);
      }
    }));

    // Generate manifest after all scans
    this.generateManifest();

    return results;
  }

  /**
   * Prune all active registries.
   * @returns {Object} Prune results { [id]: removedCount }
   */
  pruneAll() {
    const results = {};

    for (const plugin of this.activePlugins) {
      const id = plugin.constructor.id;
      try {
        const removed = plugin.prune();
        results[id] = removed;
      } catch (err) {
        results[id] = -1;
        warn(`Prune failed for ${id}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Generate registry-manifest.json listing all plugins with their metadata.
   * This is the single source of truth for consuming systems to discover registries.
   */
  generateManifest() {
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      registries: this.plugins.map(plugin => ({
        ...plugin.getDescriptor(),
        active: plugin._active !== false
      }))
    };

    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    } catch (err) {
      warn(`Failed to write manifest: ${err.message}`);
    }

    return manifest;
  }

  /**
   * Get list of active plugin descriptors.
   * @returns {Object[]} Array of plugin descriptor objects
   */
  getActiveDescriptors() {
    return this.activePlugins.map(p => p.getDescriptor());
  }

  /**
   * Get list of all plugin descriptors.
   * @returns {Object[]} Array of plugin descriptor objects
   */
  getAllDescriptors() {
    return this.plugins.map(p => p.getDescriptor());
  }
}

// ============================================================
// Exports (MUST be set before CLI code runs to avoid circular dep)
// ============================================================

// Re-export getActiveRegistries from flow-utils (single source of truth)
const { getActiveRegistries } = require('./flow-utils');

module.exports = {
  RegistryPlugin,
  RegistryManager,
  getActiveRegistries,
  MANIFEST_PATH
};

// ============================================================
// CLI
// ============================================================

function printList(manager) {
  console.log('\n' + color('cyan', '━'.repeat(50)));
  console.log(color('cyan', '  Registry Plugins'));
  console.log(color('cyan', '━'.repeat(50)) + '\n');

  for (const plugin of manager.plugins) {
    const desc = plugin.getDescriptor();
    const statusIcon = desc.active ? color('green', '●') : color('yellow', '○');
    const statusText = desc.active ? color('green', 'active') : color('yellow', 'inactive');
    console.log(`  ${statusIcon} ${color('white', desc.name)} (${desc.id})`);
    console.log(`    Category: ${desc.category} | Type: ${desc.type}`);
    console.log(`    Map: ${desc.mapFile || '(none)'} | Index: ${desc.indexFile || '(none)'}`);
    console.log(`    Status: ${statusText} | Activate when: ${desc.activateWhen}`);
    console.log('');
  }

  console.log(`  Total: ${manager.plugins.length} plugins, ${manager.activePlugins.length} active\n`);
}

function printStatus(manager) {
  console.log('\n' + color('cyan', '━'.repeat(50)));
  console.log(color('cyan', '  Registry Manager Status'));
  console.log(color('cyan', '━'.repeat(50)) + '\n');

  // Stack info
  if (manager.stack) {
    console.log('  Detected Stack:');
    if (manager.stack.language) console.log(`    Language: ${manager.stack.language}`);
    if (manager.stack.orm) console.log(`    ORM: ${manager.stack.orm}`);
    if (manager.stack.frameworks) {
      if (manager.stack.frameworks.frontend) console.log(`    Frontend: ${manager.stack.frameworks.frontend}`);
      if (manager.stack.frameworks.backend) console.log(`    Backend: ${manager.stack.frameworks.backend}`);
      if (manager.stack.frameworks.fullStack) console.log(`    Full-Stack: ${manager.stack.frameworks.fullStack}`);
    }
    console.log('');
  }

  // Manifest info
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const manifest = safeJsonParse(MANIFEST_PATH, {});
      console.log(`  Manifest: ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
      console.log(`  Generated: ${manifest.generatedAt || 'unknown'}`);
      console.log(`  Version: ${manifest.version || 'unknown'}`);
      console.log(`  Registries: ${(manifest.registries || []).length}`);
    } catch (err) {
      console.log(`  Manifest: ${color('red', 'error reading')}`);
    }
  } else {
    console.log(`  Manifest: ${color('yellow', 'not generated yet')}`);
  }

  console.log('');
  printList(manager);
}

async function main() {
  const command = process.argv[2] || 'scan';

  const manager = new RegistryManager();
  manager.loadPlugins();
  manager.activatePlugins();

  switch (command) {
    case 'scan': {
      console.log('\n' + color('cyan', '🔍 Registry Manager — Scanning all active registries...') + '\n');
      const results = await manager.scanAll();

      console.log('\n' + color('cyan', '━'.repeat(50)));
      console.log(color('cyan', '  Scan Results'));
      console.log(color('cyan', '━'.repeat(50)));

      for (const [id, result] of Object.entries(results)) {
        if (result.success && !result.empty) {
          success(`  ${id}: scanned`);
        } else if (result.success && result.empty) {
          info(`  ${id}: no items found`);
        } else {
          error(`  ${id}: ${result.error}`);
        }
      }

      console.log('');
      success(`Manifest saved to ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
      console.log('');
      break;
    }

    case 'list':
      printList(manager);
      break;

    case 'manifest':
      manager.generateManifest();
      success(`Manifest saved to ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
      break;

    case 'status':
      printStatus(manager);
      break;

    default:
      console.log(`
Usage: flow registry-manager <command>

Commands:
  scan        Scan all active registries (default)
  list        List registered plugins and their status
  manifest    Regenerate registry-manifest.json
  status      Show detailed activation status with stack info

Examples:
  flow registry-manager scan
  flow registry-manager list
  flow registry-manager status
`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
