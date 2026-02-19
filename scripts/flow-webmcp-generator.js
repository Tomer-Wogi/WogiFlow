#!/usr/bin/env node

/**
 * Wogi Flow - WebMCP Tool Generator
 *
 * Generates WebMCP tool definitions from component analysis.
 * Scans app-map for interactive components, analyzes source files
 * for props/handlers, and outputs navigator.modelContext tool schemas.
 *
 * Usage:
 *   flow webmcp-generate scan         # Scan components, generate tools.json
 *   flow webmcp-generate show         # Display generated tools summary
 *   flow webmcp-generate export       # Output tools JSON to stdout
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getProjectRoot, getConfig, color, success, warn, error } = require('./flow-utils');
const { readJson, writeJson, ensureDir, fileExists } = require('./flow-file-ops');
const { BaseScanner, PROJECT_ROOT } = require('./flow-scanner-base');

const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const WEBMCP_DIR = path.join(WORKFLOW_DIR, 'webmcp');
const TOOLS_PATH = path.join(WEBMCP_DIR, 'tools.json');
const APP_MAP_PATH = path.join(STATE_DIR, 'app-map.md');

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  directories: [
    'src/components',
    'src/app',
    'src/pages',
    'src/views',
    'src/screens',
    'app',
    'components',
    'pages',
    'views'
  ],

  filePatterns: ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte'],

  excludePatterns: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.stories.*',
    '**/node_modules/**',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/dist/**',
    '**/build/**'
  ]
};

// Interactive prop patterns by framework
const INTERACTIVE_PATTERNS = {
  react: {
    handlers: /\b(onClick|onChange|onSubmit|onBlur|onFocus|onKeyDown|onKeyUp|onSelect|onToggle|onClose|onOpen)\b/g,
    props: /\b(value|checked|selected|disabled|placeholder|label|title|type|name|href|to)\b/g,
    formElements: /\b(input|textarea|select|button|form|checkbox|radio|switch)\b/i
  },
  vue: {
    handlers: /@(click|change|submit|blur|focus|keydown|keyup|select|close|open)\b/g,
    props: /\b(v-model|:value|:checked|:selected|:disabled|:placeholder|:label)\b/g,
    formElements: /\b(input|textarea|select|button|form|el-checkbox|el-radio|el-switch)\b/i
  },
  svelte: {
    handlers: /\bon:(click|change|submit|blur|focus|keydown|keyup|select|close|open)\b/g,
    props: /\b(bind:value|bind:checked|bind:group|disabled|placeholder|label)\b/g,
    formElements: /\b(input|textarea|select|button|form)\b/i
  }
};

// Map handler names to tool verb prefixes
const HANDLER_TO_VERB = {
  onClick: 'click',
  onChange: 'update',
  onSubmit: 'submit',
  onBlur: 'leave',
  onFocus: 'focus',
  onKeyDown: 'type_in',
  onSelect: 'select',
  onToggle: 'toggle',
  onClose: 'close',
  onOpen: 'open',
  // Vue/Svelte equivalents
  click: 'click',
  change: 'update',
  submit: 'submit',
  blur: 'leave',
  focus: 'focus',
  keydown: 'type_in',
  select: 'select',
  close: 'close',
  open: 'open'
};

// ============================================================
// WebMCP Generator Class
// ============================================================

class WebMCPGenerator extends BaseScanner {
  constructor(config = {}) {
    super({
      configKey: 'webmcpGenerator',
      directories: DEFAULT_CONFIG.directories,
      filePatterns: DEFAULT_CONFIG.filePatterns,
      excludePatterns: DEFAULT_CONFIG.excludePatterns,
      ...config
    });

    this.tools = [];
    this.components = [];
    this.framework = null;
    this.toolsRegistry = {
      version: '1.0.0',
      generatedAt: null,
      projectRoot: PROJECT_ROOT,
      framework: null,
      toolCount: 0,
      tools: []
    };
  }

  // ----------------------------------------------------------
  // Framework Detection
  // ----------------------------------------------------------

  /**
   * Detect the primary UI framework from package.json and file extensions
   * @returns {string} 'react' | 'vue' | 'svelte' | 'unknown'
   */
  detectFramework() {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {})
      };

      if (allDeps.react || allDeps['react-dom'] || allDeps.next) return 'react';
      if (allDeps.vue || allDeps.nuxt) return 'vue';
      if (allDeps.svelte || allDeps['@sveltejs/kit']) return 'svelte';
    } catch {
      // package.json not found or invalid
    }

    return 'unknown';
  }

  // ----------------------------------------------------------
  // App-Map Parsing
  // ----------------------------------------------------------

  /**
   * Parse app-map.md to extract registered components
   * @returns {Array<{name: string, variants: string[], path: string, section: string}>}
   */
  parseAppMap() {
    if (!fileExists(APP_MAP_PATH)) {
      warn('No app-map.md found. Scanning directories directly.');
      return [];
    }

    try {
      const content = fs.readFileSync(APP_MAP_PATH, 'utf-8');
      const components = [];
      let currentSection = '';

      const lines = content.split('\n');
      for (const line of lines) {
        // Detect section headers
        const sectionMatch = line.match(/^##\s+(.+)/);
        if (sectionMatch) {
          currentSection = sectionMatch[1].trim().toLowerCase();
          continue;
        }

        // Parse table rows (skip header and separator rows)
        if (line.startsWith('|') && !line.includes('---') && !line.includes('Component') && !line.includes('Screen') && !line.includes('Modal')) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length < 2) continue;

          // Skip placeholder/example rows
          if (cells[0].startsWith('_') && cells[0].endsWith('_')) continue;

          const entry = { section: currentSection };

          if (currentSection === 'screens') {
            entry.name = cells[0];
            entry.route = cells[1];
            entry.path = '';
            entry.variants = [];
          } else if (currentSection === 'modals') {
            entry.name = cells[0];
            entry.trigger = cells[1];
            entry.path = '';
            entry.variants = [];
          } else if (currentSection === 'components') {
            entry.name = cells[0];
            entry.variants = cells[1] ? cells[1].split(',').map(v => v.trim()) : [];
            entry.path = cells[2] ? cells[2].replace(/`/g, '') : '';
          }

          if (entry.name) {
            components.push(entry);
          }
        }
      }

      return components;
    } catch (err) {
      warn(`Failed to parse app-map.md: ${err.message}`);
      return [];
    }
  }

  // ----------------------------------------------------------
  // Component Source Analysis
  // ----------------------------------------------------------

  /**
   * Analyze a source file for interactive patterns
   * @param {string} filePath - Full path to component file
   * @returns {Object} { handlers: string[], props: string[], isInteractive: boolean }
   */
  analyzeComponentFile(filePath) {
    const result = { handlers: [], props: [], isInteractive: false, isForm: false };

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fw = this.framework || 'react';
      const patterns = INTERACTIVE_PATTERNS[fw] || INTERACTIVE_PATTERNS.react;

      // Find handlers
      const handlerMatches = content.match(patterns.handlers);
      if (handlerMatches) {
        result.handlers = [...new Set(handlerMatches)];
      }

      // Find props
      const propMatches = content.match(patterns.props);
      if (propMatches) {
        result.props = [...new Set(propMatches)];
      }

      // Check for form elements
      result.isForm = patterns.formElements.test(content);
      result.isInteractive = result.handlers.length > 0 || result.isForm;

      // Extract TypeScript interface/type for props
      result.propTypes = this.extractPropTypes(content, fw);

      return result;
    } catch (err) {
      warn(`Failed to analyze ${filePath}: ${err.message}`);
      return result;
    }
  }

  /**
   * Extract prop type definitions from component source
   * @param {string} content - File content
   * @param {string} framework - Framework name
   * @returns {Object} Map of prop name → { type, required, description }
   */
  extractPropTypes(content, framework) {
    const propTypes = {};

    if (framework === 'react') {
      // Match TypeScript interface/type Props patterns
      const interfaceMatch = content.match(/(?:interface|type)\s+\w*Props\w*\s*(?:=\s*)?\{([^}]+)\}/s);
      if (interfaceMatch) {
        const body = interfaceMatch[1];
        const propLines = body.split('\n');

        for (const line of propLines) {
          const propMatch = line.match(/^\s*(\w+)(\??):\s*(.+?)(?:;|$)/);
          if (propMatch) {
            const [, name, optional, rawType] = propMatch;
            propTypes[name] = {
              type: this.tsTypeToJsonSchemaType(rawType.trim()),
              required: !optional
            };
          }
        }
      }
    }

    // Vue defineProps pattern
    if (framework === 'vue') {
      const propsMatch = content.match(/defineProps<\{([^}]+)\}>/s);
      if (propsMatch) {
        const body = propsMatch[1];
        const propLines = body.split('\n');

        for (const line of propLines) {
          const propMatch = line.match(/^\s*(\w+)(\??):\s*(.+?)(?:;|$)/);
          if (propMatch) {
            const [, name, optional, rawType] = propMatch;
            propTypes[name] = {
              type: this.tsTypeToJsonSchemaType(rawType.trim()),
              required: !optional
            };
          }
        }
      }
    }

    // Svelte export let pattern
    if (framework === 'svelte') {
      const exportMatches = content.matchAll(/export\s+let\s+(\w+)(?::\s*(\w+))?\s*(?:=\s*(.+?))?;/g);
      for (const match of exportMatches) {
        const [, name, tsType, defaultVal] = match;
        propTypes[name] = {
          type: this.tsTypeToJsonSchemaType(tsType || 'string'),
          required: !defaultVal
        };
      }
    }

    return propTypes;
  }

  /**
   * Convert a TypeScript type string to JSON Schema type
   * @param {string} tsType - TypeScript type
   * @returns {string} JSON Schema type
   */
  tsTypeToJsonSchemaType(tsType) {
    const normalized = tsType.replace(/\s/g, '').toLowerCase();

    if (normalized === 'string') return 'string';
    if (normalized === 'number') return 'number';
    if (normalized === 'boolean') return 'boolean';
    if (normalized.endsWith('[]') || normalized.startsWith('array<')) return 'array';
    if (normalized === 'null' || normalized === 'undefined') return 'null';
    if (normalized.includes('|')) return 'string'; // Union types default to string
    if (normalized.startsWith('(') || normalized.includes('=>')) return 'string'; // Functions
    return 'object';
  }

  // ----------------------------------------------------------
  // Tool Definition Generation
  // ----------------------------------------------------------

  /**
   * Generate a tool name from component name and handler
   * @param {string} componentName - Component name (e.g., "LoginForm")
   * @param {string} handler - Handler name (e.g., "onSubmit")
   * @returns {string} Tool name in verb_object snake_case (e.g., "submit_login_form")
   */
  generateToolName(componentName, handler) {
    // Get verb from handler
    const cleanHandler = handler.replace(/^on:|^@|^on/, '');
    const verb = HANDLER_TO_VERB[cleanHandler] || HANDLER_TO_VERB[handler] || cleanHandler.toLowerCase();

    // Convert PascalCase to snake_case
    const objectName = componentName
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/__+/g, '_');

    return `${verb}_${objectName}`;
  }

  /**
   * Generate a tool description from component context
   * @param {string} componentName - Component name
   * @param {string} handler - Handler name
   * @param {string} section - App-map section (screens, modals, components)
   * @returns {string} Natural language description
   */
  generateToolDescription(componentName, handler, section) {
    const cleanHandler = handler.replace(/^on:|^@|^on/, '');
    const verb = HANDLER_TO_VERB[cleanHandler] || cleanHandler;

    const readableName = componentName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

    const sectionContext = {
      screens: 'on the page',
      modals: 'in the modal dialog',
      components: 'in the UI'
    };

    const context = sectionContext[section] || 'in the UI';

    return `${this.capitalizeFirst(verb)} the ${readableName} ${context}. Triggers the ${cleanHandler} handler.`;
  }

  /**
   * Generate inputSchema from component props
   * @param {Object} propTypes - Map of prop name → { type, required }
   * @param {string[]} relevantProps - Props relevant to this handler
   * @returns {Object} JSON Schema object
   */
  generateInputSchema(propTypes, relevantProps) {
    const properties = {};
    const required = [];

    for (const propName of relevantProps) {
      const propInfo = propTypes[propName];
      if (propInfo) {
        properties[propName] = {
          type: propInfo.type,
          description: `The ${propName} value`
        };
        if (propInfo.required) {
          required.push(propName);
        }
      } else {
        properties[propName] = {
          type: 'string',
          description: `The ${propName} value`
        };
      }
    }

    // If no relevant props found, add a minimal schema
    if (Object.keys(properties).length === 0) {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: []
      };
    }

    return {
      type: 'object',
      additionalProperties: false,
      properties,
      required
    };
  }

  /**
   * Determine annotations for a tool based on handler type
   * @param {string} handler - Handler name
   * @returns {Object} WebMCP annotations
   */
  generateAnnotations(handler) {
    const cleanHandler = handler.replace(/^on:|^@|^on/, '').toLowerCase();

    // Read-only handlers
    const readOnly = ['focus', 'blur', 'select', 'open', 'close', 'toggle'].includes(cleanHandler);

    // Destructive handlers
    const destructive = ['delete', 'remove', 'clear', 'reset'].includes(cleanHandler);

    return {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: ['select', 'toggle', 'focus'].includes(cleanHandler),
      openWorldHint: ['submit'].includes(cleanHandler)
    };
  }

  /**
   * Generate a single WebMCP tool definition from component analysis
   * @param {Object} component - Component entry from app-map
   * @param {string} handler - Handler name
   * @param {Object} analysis - Source file analysis result
   * @returns {Object} WebMCP tool definition
   */
  generateToolDefinition(component, handler, analysis) {
    const name = this.generateToolName(component.name, handler);
    const description = this.generateToolDescription(component.name, handler, component.section);

    // Determine which props are relevant to this handler
    const relevantProps = analysis.props.filter(p =>
      !['onClick', 'onChange', 'onSubmit', 'onBlur', 'onFocus'].includes(p)
    );

    const inputSchema = this.generateInputSchema(analysis.propTypes, relevantProps);
    const annotations = this.generateAnnotations(handler);

    return {
      name,
      description,
      inputSchema,
      annotations,
      _meta: {
        componentName: component.name,
        componentPath: component.path,
        handler,
        section: component.section,
        generatedAt: new Date().toISOString()
      }
    };
  }

  // ----------------------------------------------------------
  // Main Scan Pipeline
  // ----------------------------------------------------------

  /**
   * Run the full scan pipeline
   * @returns {Object} Tools registry
   */
  async scan() {
    console.log(color('cyan', '\nWebMCP Tool Generator'));
    console.log(color('gray', '═'.repeat(50)));

    // 1. Detect framework
    this.framework = this.detectFramework();
    console.log(`\nFramework: ${color('cyan', this.framework)}`);

    // 2. Parse app-map
    const appMapComponents = this.parseAppMap();
    console.log(`App-map components: ${color('cyan', String(appMapComponents.length))}`);

    // 3. Also scan directories for components not in app-map
    const scannedComponents = await this.scanForComponents();
    console.log(`Directory scan: ${color('cyan', String(scannedComponents.length))} component files found`);

    // 4. Merge: app-map components take priority, add scanned ones not in app-map
    const allComponents = [...appMapComponents];
    const appMapNames = new Set(appMapComponents.map(c => c.name.toLowerCase()));

    for (const scanned of scannedComponents) {
      if (!appMapNames.has(scanned.name.toLowerCase())) {
        allComponents.push(scanned);
      }
    }

    console.log(`Total components: ${color('cyan', String(allComponents.length))}`);

    // 5. Analyze each component and generate tools
    this.tools = [];
    let interactiveCount = 0;

    for (const component of allComponents) {
      const sourcePath = this.resolveComponentPath(component);
      if (!sourcePath) continue;

      const analysis = this.analyzeComponentFile(sourcePath);
      if (!analysis.isInteractive) continue;

      interactiveCount++;

      // Generate a tool for each handler
      for (const handler of analysis.handlers) {
        const tool = this.generateToolDefinition(component, handler, analysis);
        this.tools.push(tool);
      }

      // If it's a form with no explicit handlers, add a submit tool
      if (analysis.isForm && analysis.handlers.length === 0) {
        const tool = this.generateToolDefinition(component, 'onSubmit', analysis);
        this.tools.push(tool);
      }
    }

    console.log(`Interactive components: ${color('cyan', String(interactiveCount))}`);
    console.log(`Tools generated: ${color('cyan', String(this.tools.length))}`);

    if (this.tools.length > 50) {
      warn(`Generated ${this.tools.length} tools (WebMCP recommends <50 per page). Consider grouping related tools.`);
    }

    // 6. Build registry
    this.toolsRegistry = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      projectRoot: PROJECT_ROOT,
      framework: this.framework,
      toolCount: this.tools.length,
      tools: this.tools
    };

    return this.toolsRegistry;
  }

  /**
   * Scan directories for component files
   * @returns {Array<{name: string, path: string, section: string, variants: string[]}>}
   */
  async scanForComponents() {
    const components = [];
    const dirs = this.findDirectories();

    for (const dir of dirs) {
      await this.scanDirectoryRecursive(dir, (filePath) => {
        const relativePath = path.relative(PROJECT_ROOT, filePath);
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);

        // Skip index files and utilities
        if (basename === 'index' || basename.startsWith('use')) return;

        // Check if it looks like a component (PascalCase or has component extension)
        const isPascalCase = /^[A-Z][a-zA-Z0-9]+$/.test(basename);
        const isComponentFile = ['.tsx', '.jsx', '.vue', '.svelte'].includes(ext);

        if (isPascalCase && isComponentFile) {
          components.push({
            name: basename,
            path: relativePath,
            section: 'components',
            variants: []
          });
        }
      });
    }

    return components;
  }

  /**
   * Resolve a component's source file path
   * @param {Object} component - Component entry
   * @returns {string|null} Full path to source file, or null if not found
   */
  resolveComponentPath(component) {
    if (!component.path) return null;

    // Try the path as-is
    const directPath = path.join(PROJECT_ROOT, component.path);
    if (fileExists(directPath)) return directPath;

    // Try common extensions
    const extensions = ['.tsx', '.jsx', '.vue', '.svelte', '.ts', '.js'];
    for (const ext of extensions) {
      const withExt = directPath + ext;
      if (fileExists(withExt)) return withExt;
    }

    // Try index files in directory
    for (const ext of extensions) {
      const indexPath = path.join(directPath, `index${ext}`);
      if (fileExists(indexPath)) return indexPath;
    }

    return null;
  }

  // ----------------------------------------------------------
  // Output
  // ----------------------------------------------------------

  /**
   * Save tools registry to .workflow/webmcp/tools.json
   */
  save() {
    ensureDir(WEBMCP_DIR);

    try {
      const output = JSON.stringify(this.toolsRegistry, null, 2);
      fs.writeFileSync(TOOLS_PATH, output, 'utf-8');
      success(`Saved ${this.tools.length} tools to ${path.relative(PROJECT_ROOT, TOOLS_PATH)}`);
    } catch (err) {
      error(`Failed to save tools: ${err.message}`);
    }
  }

  /**
   * Display tools summary
   */
  showSummary() {
    if (!fileExists(TOOLS_PATH)) {
      error('No tools.json found. Run `flow webmcp-generate scan` first.');
      return;
    }

    try {
      const registry = JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf-8'));

      console.log(color('cyan', '\nWebMCP Tools Summary'));
      console.log(color('gray', '═'.repeat(50)));
      console.log(`Framework: ${color('cyan', registry.framework || 'unknown')}`);
      console.log(`Generated: ${color('gray', registry.generatedAt || 'unknown')}`);
      console.log(`Total tools: ${color('cyan', String(registry.toolCount || 0))}`);

      if (registry.tools && registry.tools.length > 0) {
        console.log(color('gray', '\n─'.repeat(25)));

        // Group by component
        const byComponent = {};
        for (const tool of registry.tools) {
          const comp = tool._meta?.componentName || 'unknown';
          if (!byComponent[comp]) byComponent[comp] = [];
          byComponent[comp].push(tool);
        }

        for (const [comp, tools] of Object.entries(byComponent)) {
          console.log(`\n  ${color('cyan', comp)} (${tools.length} tools):`);
          for (const tool of tools) {
            const ro = tool.annotations?.readOnlyHint ? ' [read-only]' : '';
            const dest = tool.annotations?.destructiveHint ? ' [destructive]' : '';
            console.log(`    ${color('green', tool.name)}${color('gray', ro + dest)}`);
            console.log(`      ${color('gray', tool.description)}`);
          }
        }
      } else {
        console.log(color('yellow', '\nNo tools generated. Components may not have interactive patterns.'));
      }

      console.log('');
    } catch (err) {
      error(`Failed to read tools.json: ${err.message}`);
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'scan': {
      const generator = new WebMCPGenerator();
      await generator.scan();
      generator.save();
      break;
    }

    case 'show':
      new WebMCPGenerator().showSummary();
      break;

    case 'export': {
      if (!fileExists(TOOLS_PATH)) {
        error('No tools.json found. Run `flow webmcp-generate scan` first.');
        process.exit(1);
      }
      try {
        const content = fs.readFileSync(TOOLS_PATH, 'utf-8');
        process.stdout.write(content);
      } catch (err) {
        error(`Failed to read tools.json: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
Usage: flow webmcp-generate <command>

Commands:
  scan      Scan components and generate WebMCP tool definitions
  show      Display generated tools summary
  export    Output tools.json to stdout

Output: .workflow/webmcp/tools.json

Examples:
  flow webmcp-generate scan
  flow webmcp-generate show
  flow webmcp-generate export > tools.json
`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

module.exports = { WebMCPGenerator };
