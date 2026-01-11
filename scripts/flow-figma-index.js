#!/usr/bin/env node

/**
 * Wogi Flow - Component Registry Builder
 *
 * Scans the codebase and builds an index of existing components
 * with their properties, variants, CSS tokens, and structure.
 *
 * Supports: React, Vue, Svelte, Angular (auto-detected)
 *
 * Usage:
 *   flow figma scan              # Full scan of codebase
 *   flow figma show <component>  # Show component details
 *   flow figma export            # Export registry as JSON
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const REGISTRY_PATH = path.join(WORKFLOW_DIR, 'state', 'component-registry.json');

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  componentDirs: [
    'src/components',
    'components',
    'src/ui',
    'ui',
    'app/components',
    'src/lib/components',
    'lib/components'
  ],

  frameworkPatterns: {
    react: ['**/*.tsx', '**/*.jsx'],
    vue: ['**/*.vue'],
    svelte: ['**/*.svelte'],
    angular: ['**/*.component.ts']
  },

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

  tokenSources: [
    'src/styles/tokens.css',
    'src/styles/variables.css',
    'src/theme.ts',
    'src/theme.js',
    'tailwind.config.js',
    'tailwind.config.ts',
    'src/styles/theme.css'
  ]
};

// ============================================================
// Framework Detection
// ============================================================

function detectFramework(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return 'react'; // Default
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['vue'] || deps['nuxt']) return 'vue';
    if (deps['svelte'] || deps['@sveltejs/kit']) return 'svelte';
    if (deps['@angular/core']) return 'angular';
    if (deps['react'] || deps['next'] || deps['gatsby']) return 'react';

    return 'react'; // Default
  } catch {
    return 'react';
  }
}

// ============================================================
// Component Scanner
// ============================================================

class ComponentScanner {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.framework = detectFramework(PROJECT_ROOT);
    this.registry = {
      version: '1.0.0',
      scannedAt: null,
      projectRoot: PROJECT_ROOT,
      framework: this.framework,
      components: [],
      tokens: {
        colors: {},
        spacing: {},
        typography: {},
        radius: {},
        shadows: {}
      }
    };

    // Try to load babel for better parsing
    this.parser = null;
    this.traverse = null;
    try {
      this.parser = require('@babel/parser');
      this.traverse = require('@babel/traverse').default;
    } catch {
      // Babel not available, will use regex parsing
    }
  }

  async scan() {
    console.log('\n🔍 Scanning codebase for components...\n');
    console.log(`   Framework detected: ${this.framework}`);

    // Find component directory
    const componentDir = this.findComponentDir();
    if (!componentDir) {
      console.error('❌ No component directory found');
      console.log('   Searched:', this.config.componentDirs.join(', '));
      return null;
    }

    console.log(`   Component directory: ${path.relative(PROJECT_ROOT, componentDir)}`);
    console.log(`   Parser: ${this.parser ? 'Babel AST' : 'Regex-based'}`);

    // Scan for tokens first
    await this.scanTokens();

    // Scan components
    await this.scanDirectory(componentDir);

    // Post-process: calculate signatures
    this.calculateSignatures();

    this.registry.scannedAt = new Date().toISOString();

    // Save registry
    this.saveRegistry();

    console.log(`\n✅ Found ${this.registry.components.length} components`);
    console.log(`📄 Registry saved to: ${path.relative(PROJECT_ROOT, REGISTRY_PATH)}`);

    return this.registry;
  }

  findComponentDir() {
    for (const dir of this.config.componentDirs) {
      const fullPath = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  async scanTokens() {
    console.log('\n📊 Scanning design tokens...');

    for (const tokenSource of this.config.tokenSources) {
      const fullPath = path.join(PROJECT_ROOT, tokenSource);
      if (fs.existsSync(fullPath)) {
        console.log(`   Found: ${tokenSource}`);
        await this.parseTokenFile(fullPath);
      }
    }
  }

  async parseTokenFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const filename = path.basename(filePath);

    if (ext === '.css') {
      this.parseCSSTokens(content);
    } else if (filename.includes('tailwind')) {
      this.parseTailwindConfig(content);
    } else if (ext === '.ts' || ext === '.js') {
      this.parseJSTokens(content);
    }
  }

  parseCSSTokens(content) {
    const varRegex = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
    let match;

    while ((match = varRegex.exec(content)) !== null) {
      const [, name, value] = match;
      const trimmedValue = value.trim();

      if (name.includes('color') || name.includes('bg') ||
          trimmedValue.startsWith('#') || trimmedValue.startsWith('rgb') ||
          trimmedValue.startsWith('hsl')) {
        this.registry.tokens.colors[name] = trimmedValue;
      } else if (name.includes('spacing') || name.includes('gap') ||
                 name.includes('margin') || name.includes('padding')) {
        this.registry.tokens.spacing[name] = trimmedValue;
      } else if (name.includes('font') || name.includes('text') ||
                 name.includes('line-height') || name.includes('letter')) {
        this.registry.tokens.typography[name] = trimmedValue;
      } else if (name.includes('radius') || name.includes('rounded')) {
        this.registry.tokens.radius[name] = trimmedValue;
      } else if (name.includes('shadow')) {
        this.registry.tokens.shadows[name] = trimmedValue;
      }
    }
  }

  parseTailwindConfig(content) {
    // Extract theme extensions from Tailwind
    const colorMatch = content.match(/colors\s*:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
    if (colorMatch) {
      const colorRegex = /['"]?([a-zA-Z0-9-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = colorRegex.exec(colorMatch[1])) !== null) {
        this.registry.tokens.colors[match[1]] = match[2];
      }
    }

    const spacingMatch = content.match(/spacing\s*:\s*\{([^}]+)\}/s);
    if (spacingMatch) {
      const spacingRegex = /['"]?([a-zA-Z0-9-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = spacingRegex.exec(spacingMatch[1])) !== null) {
        this.registry.tokens.spacing[match[1]] = match[2];
      }
    }
  }

  parseJSTokens(content) {
    // Parse JS/TS theme files
    const colorMatch = content.match(/colors?\s*[=:]\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
    if (colorMatch) {
      const colorRegex = /['"]?([a-zA-Z0-9-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = colorRegex.exec(colorMatch[1])) !== null) {
        this.registry.tokens.colors[match[1]] = match[2];
      }
    }
  }

  async scanDirectory(dir, relativePath = '') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        if (this.shouldSkipDirectory(entry.name)) continue;
        await this.scanDirectory(fullPath, relPath);
      } else if (entry.isFile()) {
        if (this.isComponentFile(entry.name)) {
          await this.parseComponentFile(fullPath, relPath);
        }
      }
    }
  }

  shouldSkipDirectory(name) {
    return name === 'node_modules' ||
           name.startsWith('_') ||
           name === '__tests__' ||
           name === '__mocks__' ||
           name === 'dist' ||
           name === 'build' ||
           name === '.git';
  }

  isComponentFile(filename) {
    // Framework-specific patterns
    const patterns = this.config.frameworkPatterns[this.framework] || [];

    for (const pattern of patterns) {
      const ext = pattern.replace('**/*', '');
      if (filename.endsWith(ext)) {
        // Exclude test/story files
        if (filename.includes('.test.') ||
            filename.includes('.spec.') ||
            filename.includes('.stories.')) {
          return false;
        }
        // Exclude index files (usually re-exports)
        if (filename.startsWith('index.')) {
          return false;
        }
        return true;
      }
    }

    return false;
  }

  async parseComponentFile(filePath, relativePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const componentName = path.basename(filePath, ext);

    let component;

    switch (this.framework) {
      case 'vue':
        component = this.parseVueComponent(content, componentName, relativePath, filePath);
        break;
      case 'svelte':
        component = this.parseSvelteComponent(content, componentName, relativePath, filePath);
        break;
      case 'angular':
        component = this.parseAngularComponent(content, componentName, relativePath, filePath);
        break;
      default:
        component = this.parseReactComponent(content, componentName, relativePath, filePath);
    }

    if (component) {
      this.registry.components.push(component);
    }
  }

  parseReactComponent(content, componentName, relativePath, fullPath) {
    const component = this.createBaseComponent(componentName, relativePath, fullPath);

    if (this.parser && this.traverse) {
      return this.parseReactWithBabel(content, component);
    }

    return this.parseReactWithRegex(content, component);
  }

  parseReactWithBabel(content, component) {
    try {
      const ast = this.parser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx']
      });

      this.traverse(ast, {
        ExportNamedDeclaration: (path) => {
          if (path.node.declaration) {
            if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
              component.exports.push(path.node.declaration.id.name);
            } else if (path.node.declaration.type === 'VariableDeclaration') {
              path.node.declaration.declarations.forEach(d => {
                if (d.id && d.id.name) component.exports.push(d.id.name);
              });
            }
          }
        },

        ExportDefaultDeclaration: () => {
          component.exports.push('default');
        },

        TSInterfaceDeclaration: (path) => {
          if (path.node.id.name.includes('Props')) {
            path.node.body.body.forEach(prop => {
              if (prop.type === 'TSPropertySignature' && prop.key && prop.key.name) {
                component.props.push({
                  name: prop.key.name,
                  required: !prop.optional,
                  type: this.extractTypeAnnotation(prop.typeAnnotation)
                });
              }
            });
          }
        },

        JSXElement: (path) => {
          component.structure.elementCount++;

          const openingElement = path.node.openingElement;
          if (openingElement && openingElement.name && openingElement.name.name) {
            const elementName = openingElement.name.name;

            if (/^[A-Z]/.test(elementName)) {
              if (!component.childComponents.includes(elementName)) {
                component.childComponents.push(elementName);
              }
            }
          }

          if (path.node.children && path.node.children.length > 0) {
            component.structure.hasChildren = true;
          }

          // Extract CSS classes
          if (openingElement && openingElement.attributes) {
            openingElement.attributes.forEach(attr => {
              if (attr.type === 'JSXAttribute' && attr.name) {
                if (attr.name.name === 'className' || attr.name.name === 'class') {
                  this.extractCSSFromAttribute(attr, component);
                }
              }
            });
          }
        },

        ImportDeclaration: (path) => {
          const source = path.node.source.value;
          if (!source.startsWith('.') && !source.startsWith('@/') && !source.startsWith('~/')) {
            component.dependencies.push(source);
          }
        }
      });

      component.structure.depth = this.calculateJSXDepth(content);
      component.type = this.classifyComponent(component);
      component.variants = this.extractVariants(component.props);

      return component;

    } catch (err) {
      console.log(`   ⚠️ Babel parse error: ${component.name}`);
      return this.parseReactWithRegex(content, component);
    }
  }

  parseReactWithRegex(content, component) {
    // Extract exports
    const exportMatches = content.match(/export\s+(const|function|default\s+function)\s+(\w+)/g) || [];
    exportMatches.forEach(match => {
      const name = match.replace(/export\s+(const|function|default\s+function)\s+/, '');
      if (name) component.exports.push(name);
    });

    // Extract props interface
    const propsMatch = content.match(/interface\s+\w*Props\s*\{([^}]+)\}/s);
    if (propsMatch) {
      const propLines = propsMatch[1].split('\n');
      propLines.forEach(line => {
        const propMatch = line.match(/^\s*(\w+)(\?)?\s*:\s*(.+?);?\s*$/);
        if (propMatch) {
          component.props.push({
            name: propMatch[1],
            required: !propMatch[2],
            type: propMatch[3].trim()
          });
        }
      });
    }

    // Extract child components (PascalCase in JSX)
    const childMatches = content.match(/<([A-Z][a-zA-Z0-9]*)/g) || [];
    childMatches.forEach(match => {
      const name = match.replace('<', '');
      if (!component.childComponents.includes(name)) {
        component.childComponents.push(name);
      }
    });

    // Extract CSS classes
    const classMatches = content.match(/className=["']([^"']+)["']/g) || [];
    classMatches.forEach(match => {
      const classes = match.replace(/className=["']/, '').replace(/["']$/, '');
      this.extractCSSClasses(classes, component);
    });

    // Count JSX elements
    component.structure.elementCount = (content.match(/<[A-Za-z]/g) || []).length;
    component.structure.depth = this.calculateJSXDepth(content);
    component.structure.hasChildren = content.includes('{children}') || content.includes('children');

    component.type = this.classifyComponent(component);
    component.variants = this.extractVariants(component.props);

    return component;
  }

  parseVueComponent(content, componentName, relativePath, fullPath) {
    const component = this.createBaseComponent(componentName, relativePath, fullPath);

    // Extract script content
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const script = scriptMatch[1];

      // Extract props from defineProps or props option
      const propsMatch = script.match(/defineProps<\{([^}]+)\}>/s) ||
                         script.match(/props:\s*\{([^}]+)\}/s);
      if (propsMatch) {
        const propLines = propsMatch[1].split('\n');
        propLines.forEach(line => {
          const propMatch = line.match(/^\s*(\w+)(\?)?\s*:\s*(.+?),?\s*$/);
          if (propMatch) {
            component.props.push({
              name: propMatch[1],
              required: !propMatch[2],
              type: propMatch[3].trim()
            });
          }
        });
      }
    }

    // Extract template content
    const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const template = templateMatch[1];

      // Count elements
      component.structure.elementCount = (template.match(/<[A-Za-z]/g) || []).length;

      // Extract child components
      const childMatches = template.match(/<([A-Z][a-zA-Z0-9-]*)/g) || [];
      childMatches.forEach(match => {
        const name = match.replace('<', '');
        if (!component.childComponents.includes(name)) {
          component.childComponents.push(name);
        }
      });

      // Extract CSS classes
      const classMatches = template.match(/class=["']([^"']+)["']/g) || [];
      classMatches.forEach(match => {
        const classes = match.replace(/class=["']/, '').replace(/["']$/, '');
        this.extractCSSClasses(classes, component);
      });

      component.structure.hasChildren = template.includes('<slot');
    }

    component.structure.depth = this.calculateJSXDepth(content);
    component.type = this.classifyComponent(component);
    component.variants = this.extractVariants(component.props);

    return component;
  }

  parseSvelteComponent(content, componentName, relativePath, fullPath) {
    const component = this.createBaseComponent(componentName, relativePath, fullPath);

    // Extract script content
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const script = scriptMatch[1];

      // Extract props (export let)
      const propMatches = script.match(/export\s+let\s+(\w+)(?:\s*:\s*([^=;]+))?/g) || [];
      propMatches.forEach(match => {
        const propMatch = match.match(/export\s+let\s+(\w+)(?:\s*:\s*([^=;]+))?/);
        if (propMatch) {
          component.props.push({
            name: propMatch[1],
            required: !match.includes('='),
            type: propMatch[2]?.trim() || 'any'
          });
        }
      });
    }

    // Count elements
    component.structure.elementCount = (content.match(/<[A-Za-z]/g) || []).length;

    // Extract child components (PascalCase)
    const childMatches = content.match(/<([A-Z][a-zA-Z0-9]*)/g) || [];
    childMatches.forEach(match => {
      const name = match.replace('<', '');
      if (!component.childComponents.includes(name)) {
        component.childComponents.push(name);
      }
    });

    // Extract CSS classes
    const classMatches = content.match(/class(?:Name)?=["']([^"']+)["']/g) || [];
    classMatches.forEach(match => {
      const classes = match.replace(/class(?:Name)?=["']/, '').replace(/["']$/, '');
      this.extractCSSClasses(classes, component);
    });

    component.structure.hasChildren = content.includes('<slot');
    component.structure.depth = this.calculateJSXDepth(content);
    component.type = this.classifyComponent(component);
    component.variants = this.extractVariants(component.props);

    return component;
  }

  parseAngularComponent(content, componentName, relativePath, fullPath) {
    const component = this.createBaseComponent(componentName, relativePath, fullPath);

    // Extract @Input() decorators
    const inputMatches = content.match(/@Input\(\)\s*(\w+)(?:\s*:\s*([^;=]+))?/g) || [];
    inputMatches.forEach(match => {
      const propMatch = match.match(/@Input\(\)\s*(\w+)(?:\s*:\s*([^;=]+))?/);
      if (propMatch) {
        component.props.push({
          name: propMatch[1],
          required: !match.includes('?'),
          type: propMatch[2]?.trim() || 'any'
        });
      }
    });

    // Extract selector
    const selectorMatch = content.match(/selector:\s*['"]([^'"]+)['"]/);
    if (selectorMatch) {
      component.angularSelector = selectorMatch[1];
    }

    // Load template if inline
    const templateMatch = content.match(/template:\s*`([\s\S]*?)`/);
    if (templateMatch) {
      const template = templateMatch[1];
      component.structure.elementCount = (template.match(/<[A-Za-z]/g) || []).length;

      // Extract CSS classes
      const classMatches = template.match(/class=["']([^"']+)["']/g) || [];
      classMatches.forEach(match => {
        const classes = match.replace(/class=["']/, '').replace(/["']$/, '');
        this.extractCSSClasses(classes, component);
      });
    }

    component.structure.depth = 2; // Default for Angular
    component.type = this.classifyComponent(component);
    component.variants = this.extractVariants(component.props);

    return component;
  }

  createBaseComponent(name, relativePath, fullPath) {
    return {
      name,
      path: relativePath,
      fullPath,
      type: 'unknown',
      exports: [],
      props: [],
      variants: [],
      cssProperties: [],
      dependencies: [],
      childComponents: [],
      structure: {
        depth: 0,
        elementCount: 0,
        hasChildren: false
      }
    };
  }

  extractTypeAnnotation(typeAnnotation) {
    if (!typeAnnotation) return 'unknown';

    const type = typeAnnotation.typeAnnotation;
    if (!type) return 'unknown';

    switch (type.type) {
      case 'TSStringKeyword': return 'string';
      case 'TSNumberKeyword': return 'number';
      case 'TSBooleanKeyword': return 'boolean';
      case 'TSUnionType':
        return type.types.map(t => {
          if (t.type === 'TSLiteralType' && t.literal) {
            return t.literal.value;
          }
          return t.type.replace('TS', '').replace('Keyword', '').toLowerCase();
        });
      default:
        return type.type.replace('TS', '').replace('Keyword', '').toLowerCase();
    }
  }

  extractCSSFromAttribute(attr, component) {
    if (attr.value) {
      let value = '';

      if (attr.value.type === 'StringLiteral') {
        value = attr.value.value;
      } else if (attr.value.type === 'JSXExpressionContainer') {
        if (attr.value.expression.type === 'TemplateLiteral') {
          value = attr.value.expression.quasis.map(q => q.value.raw).join(' ');
        }
      }

      if (value) {
        this.extractCSSClasses(value, component);
      }
    }
  }

  extractCSSClasses(classString, component) {
    const classes = classString.split(/\s+/).filter(c => c.length > 0);

    classes.forEach(cls => {
      if (cls.match(/^(bg-|text-|border-)/)) {
        component.cssProperties.push({ type: 'color', value: cls });
      } else if (cls.match(/^(p-|m-|gap-|space-|px-|py-|mx-|my-)/)) {
        component.cssProperties.push({ type: 'spacing', value: cls });
      } else if (cls.match(/^(text-|font-|leading-|tracking-)/)) {
        component.cssProperties.push({ type: 'typography', value: cls });
      } else if (cls.match(/^rounded/)) {
        component.cssProperties.push({ type: 'radius', value: cls });
      } else if (cls.match(/^shadow/)) {
        component.cssProperties.push({ type: 'shadow', value: cls });
      } else if (cls.match(/^(w-|h-|min-|max-)/)) {
        component.cssProperties.push({ type: 'sizing', value: cls });
      } else if (cls.match(/^(flex|grid|block|inline)/)) {
        component.cssProperties.push({ type: 'layout', value: cls });
      }
    });
  }

  calculateJSXDepth(content) {
    let maxDepth = 0;
    let currentDepth = 0;

    const matches = content.match(/<\/?[A-Z][^>]*>/g) || [];
    matches.forEach(match => {
      if (match.startsWith('</')) {
        currentDepth--;
      } else if (!match.endsWith('/>')) {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      }
    });

    return maxDepth;
  }

  classifyComponent(component) {
    const childCount = component.childComponents.length;
    const depth = component.structure.depth;
    const elementCount = component.structure.elementCount;

    // Atom: Simple, no child components, low depth
    if (childCount === 0 && depth <= 2 && elementCount <= 5) {
      return 'atom';
    }

    // Molecule: Uses a few atoms, moderate complexity
    if (childCount <= 3 && depth <= 4 && elementCount <= 15) {
      return 'molecule';
    }

    // Organism: Complex, uses multiple molecules/atoms
    return 'organism';
  }

  extractVariants(props) {
    const variants = [];

    props.forEach(prop => {
      if (prop.name === 'variant' || prop.name === 'size' || prop.name === 'color' ||
          prop.name === 'type' || prop.name === 'state' || prop.name === 'appearance') {
        if (Array.isArray(prop.type)) {
          variants.push({
            name: prop.name,
            options: prop.type
          });
        } else if (typeof prop.type === 'string' && prop.type.includes('|')) {
          variants.push({
            name: prop.name,
            options: prop.type.split('|').map(t => t.trim().replace(/['"]/g, ''))
          });
        }
      }
    });

    return variants;
  }

  calculateSignatures() {
    this.registry.components.forEach(component => {
      const signature = {
        css: [...new Set(component.cssProperties.map(p => `${p.type}:${p.value}`))].sort().join('|'),
        structure: `d${component.structure.depth}:e${component.structure.elementCount}:c${component.childComponents.length}`,
        props: component.props.map(p => `${p.name}:${Array.isArray(p.type) ? 'enum' : p.type}`).sort().join('|'),
        variants: component.variants.map(v => `${v.name}:${v.options.length}`).join('|')
      };

      component.signature = signature;
    });
  }

  saveRegistry() {
    const stateDir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this.registry, null, 2));
  }

  loadRegistry() {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    }
    return null;
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, command, ...args] = process.argv;

  const scanner = new ComponentScanner();

  switch (command) {
    case 'scan': {
      await scanner.scan();
      break;
    }

    case 'show': {
      const registry = scanner.loadRegistry();
      if (!registry) {
        console.error('No registry found. Run "scan" first.');
        process.exit(1);
      }

      const componentName = args[0];
      if (componentName) {
        const component = registry.components.find(c =>
          c.name.toLowerCase() === componentName.toLowerCase()
        );

        if (component) {
          console.log(JSON.stringify(component, null, 2));
        } else {
          console.log(`Component "${componentName}" not found.`);
          console.log('\nAvailable components:');
          registry.components.forEach(c => {
            console.log(`  - ${c.name} (${c.type}) - ${c.path}`);
          });
        }
      } else {
        console.log('\n📦 Component Registry\n');
        console.log(`Framework: ${registry.framework}`);
        console.log(`Scanned: ${registry.scannedAt}`);
        console.log(`Components: ${registry.components.length}\n`);

        const grouped = { atom: [], molecule: [], organism: [] };
        registry.components.forEach(c => {
          if (grouped[c.type]) grouped[c.type].push(c);
        });

        for (const [type, components] of Object.entries(grouped)) {
          if (components.length > 0) {
            console.log(`${type.toUpperCase()}S (${components.length}):`);
            components.forEach(c => {
              console.log(`  - ${c.name} → ${c.path}`);
            });
            console.log('');
          }
        }
      }
      break;
    }

    case 'export': {
      const registry = scanner.loadRegistry();
      if (registry) {
        console.log(JSON.stringify(registry, null, 2));
      } else {
        console.error('No registry found. Run "scan" first.');
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
Wogi Flow - Component Registry Builder

Commands:
  scan              Scan codebase and build component registry
  show [name]       Show component details (or list all)
  export            Export registry as JSON

Usage:
  ./scripts/flow figma scan
  ./scripts/flow figma show Button
  ./scripts/flow figma export > registry.json
      `);
  }
}

module.exports = { ComponentScanner, detectFramework };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
