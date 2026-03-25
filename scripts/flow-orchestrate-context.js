#!/usr/bin/env node
/**
 * Project Context Generator - Extracted from flow-orchestrate.js
 *
 * Generates and caches a comprehensive project context document.
 * This context is generated once (expensive) and reused for all steps (free).
 *
 * The context includes:
 * - Type definitions from the project
 * - Theme structure and correct access paths
 * - Component patterns from existing code
 * - Available components list
 * - Critical rules and conventions
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, colors, getConfig, PATHS } = require('./flow-utils');
const {
  buildExportMap,
  loadCachedExportMap,
  saveExportMapCache,
  formatComponentWithUsage,
  setProjectRoot: setExportScannerRoot
} = require('./flow-export-scanner');

// Set export scanner project root to match
setExportScannerRoot(PATHS.root);

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

class ProjectContextGenerator {
  constructor(projectRoot = PATHS.root) {
    this.projectRoot = projectRoot;
    this.contextPath = path.join(projectRoot, '.workflow/state/hybrid-context.md');
    this.cacheMaxAge = 60 * 60 * 1000; // 1 hour

    // Load config for project-specific settings
    this.config = this.loadProjectConfig();

    // Export map (loaded lazily)
    this._exportMap = null;
  }

  /**
   * Get or build the export map (with caching)
   */
  getExportMap() {
    if (this._exportMap) return this._exportMap;

    // Try cached first
    this._exportMap = loadCachedExportMap();
    if (this._exportMap) return this._exportMap;

    // Build fresh export map
    const fullConfig = { hybrid: { projectContext: this.config } };
    this._exportMap = buildExportMap(fullConfig);
    saveExportMapCache(this._exportMap);

    return this._exportMap;
  }

  /**
   * Load project-specific settings from config.json
   */
  loadProjectConfig() {
    try {
      const config = getConfig();
      return config.hybrid?.projectContext || {};
    } catch (_err) {
      return {};
    }
  }

  /**
   * Check if we have a valid cached context (less than 1 hour old)
   */
  hasValidCache() {
    try {
      if (!fs.existsSync(this.contextPath)) return false;
      const stats = fs.statSync(this.contextPath);
      const ageMs = Date.now() - stats.mtimeMs;
      return ageMs < this.cacheMaxAge;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Get cached context or null
   */
  getCachedContext() {
    if (!this.hasValidCache()) return null;
    try {
      return fs.readFileSync(this.contextPath, 'utf-8');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Save generated context to cache
   */
  saveContext(context) {
    try {
      const dir = path.dirname(this.contextPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.contextPath, context);
    } catch (err) {
      log('yellow', `   ⚠️ Could not cache context: ${err.message}`);
    }
  }

  /**
   * Simple glob implementation using fs
   */
  globSync(pattern) {
    const results = [];
    const basePath = this.projectRoot;

    const parts = pattern.split('/');
    const searchDir = (currentPath, remainingParts) => {
      if (remainingParts.length === 0) {
        if (fs.existsSync(currentPath)) results.push(currentPath);
        return;
      }

      const [current, ...rest] = remainingParts;

      if (current === '*' || current === '**') {
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              searchDir(path.join(currentPath, entry.name), rest);
              if (current === '**') {
                searchDir(path.join(currentPath, entry.name), remainingParts);
              }
            } else if (rest.length === 0) {
              results.push(path.join(currentPath, entry.name));
            }
          }
        } catch (_err) {}
      } else if (current.includes('*')) {
        try {
          const regex = new RegExp('^' + current.replace(/\*/g, '[^/]*') + '$');
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (regex.test(entry.name)) {
              if (entry.isDirectory()) {
                searchDir(path.join(currentPath, entry.name), rest);
              } else if (rest.length === 0) {
                results.push(path.join(currentPath, entry.name));
              }
            }
          }
        } catch (_err) {}
      } else {
        const nextPath = path.join(currentPath, current);
        if (fs.existsSync(nextPath)) {
          searchDir(nextPath, rest);
        }
      }
    };

    searchDir(basePath, parts);
    return results.map(p => path.relative(basePath, p));
  }

  /**
   * Read file with line limit
   */
  readFile(filePath, maxLines = 100) {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
      if (!fs.existsSync(fullPath)) return null;
      const content = fs.readFileSync(fullPath, 'utf-8');
      return content.split('\n').slice(0, maxLines).join('\n');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Check if a path should be excluded based on config
   */
  shouldExcludePath(filePath) {
    const excludeDirs = this.config.excludeDirectories || ['__tests__', '__mocks__', 'node_modules', '.git'];
    return excludeDirs.some(dir => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`));
  }

  /**
   * Check if a type definition should be excluded based on config patterns
   */
  shouldExcludeType(typeName) {
    const excludePatterns = this.config.excludeTypePatterns || [];
    if (excludePatterns.length === 0) return false;

    return excludePatterns.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(typeName);
      } catch (_err) {
        return typeName.toLowerCase().includes(pattern.toLowerCase());
      }
    });
  }

  /**
   * Filter type content to exclude irrelevant types
   */
  filterTypesContent(content, filePath) {
    if (this.shouldExcludePath(filePath)) return null;

    const lines = content.split('\n');
    const filtered = [];
    let skipBlock = false;
    let braceCount = 0;

    for (const line of lines) {
      // Check if this line starts a type we want to exclude
      const typeMatch = line.match(/(?:export\s+)?(?:interface|type)\s+(\w+)/);
      if (typeMatch && this.shouldExcludeType(typeMatch[1])) {
        skipBlock = true;
        braceCount = 0;
      }

      if (skipBlock) {
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
        if (braceCount <= 0 && line.includes('}')) {
          skipBlock = false;
        }
        continue;
      }

      filtered.push(line);
    }

    const result = filtered.join('\n').trim();
    return result.length > 10 ? result : null;
  }

  /**
   * Scan a directory for components and their exports
   */
  scanComponentExports(componentDir) {
    const components = {};
    const fullDir = path.join(this.projectRoot, componentDir);

    if (!fs.existsSync(fullDir)) return components;

    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const compPath = path.join(fullDir, entry.name);
        const indexPath = path.join(compPath, 'index.ts');
        const indexTsxPath = path.join(compPath, 'index.tsx');
        const mainFile = path.join(compPath, `${entry.name}.tsx`);

        let exports = [];
        let importPath = `@/components/${entry.name}`;

        // Try to find exports from index file
        for (const indexFile of [indexPath, indexTsxPath]) {
          if (fs.existsSync(indexFile)) {
            const content = fs.readFileSync(indexFile, 'utf-8');
            const exportMatches = content.match(/export\s+{\s*([^}]+)\s*}/g);
            if (exportMatches) {
              for (const match of exportMatches) {
                const names = match.replace(/export\s*{\s*/, '').replace(/\s*}/, '').split(',');
                exports.push(...names.map(n => n.trim()).filter(n => n && !n.includes(' as ')));
              }
            }
            // Also check for named exports
            const namedExports = content.match(/export\s+(?:const|function|class)\s+(\w+)/g);
            if (namedExports) {
              for (const match of namedExports) {
                const name = match.split(/\s+/).pop();
                if (name && !exports.includes(name)) exports.push(name);
              }
            }
            break;
          }
        }

        // If no index, try main file
        if (exports.length === 0 && fs.existsSync(mainFile)) {
          const content = fs.readFileSync(mainFile, 'utf-8');
          const namedExports = content.match(/export\s+(?:const|function|class)\s+(\w+)/g);
          if (namedExports) {
            for (const match of namedExports) {
              const name = match.split(/\s+/).pop();
              if (name) exports.push(name);
            }
          }
        }

        if (exports.length > 0) {
          components[entry.name] = {
            exports: [...new Set(exports)],
            importPath
          };
        }
      }
    } catch (err) {
      // Ignore scan errors
    }

    return components;
  }

  /**
   * Get default type patterns based on common project structures
   */
  getDefaultTypePatterns() {
    return [
      'src/types/*.ts',
      'src/types/index.ts',
      'src/*/types.ts',
      'src/features/*/api/types.ts',
      'src/**/types/*.ts',
      'apps/*/src/types/*.ts',
      'apps/*/src/features/*/api/types.ts',
    ];
  }

  /**
   * Get default component patterns based on common project structures
   */
  getDefaultComponentDirs() {
    const possibleDirs = [
      'src/components',
      'components',
      'apps/web/src/components',
      'src/shared/components',
    ];

    return possibleDirs.filter(dir => {
      const fullPath = path.join(this.projectRoot, dir);
      return fs.existsSync(fullPath);
    });
  }

  /**
   * Gather project files for context generation (config-driven)
   */
  gatherProjectFiles() {
    const files = {};

    // 1. Use config type directories or detect them
    const typeDirs = this.config.typeDirs?.length > 0
      ? this.config.typeDirs
      : this.getDefaultTypePatterns();

    for (const pattern of typeDirs) {
      const matches = this.globSync(pattern);
      for (const match of matches.slice(0, 5)) {
        if (this.shouldExcludePath(match)) continue;
        const content = this.readFile(match, 150);
        if (content) {
          const filtered = this.filterTypesContent(content, match);
          if (filtered) files[match] = filtered;
        }
      }
    }

    // 2. Use config component directories or detect them
    const componentDirs = this.config.componentDirs?.length > 0
      ? this.config.componentDirs
      : this.getDefaultComponentDirs();

    // Read sample components (2-3 examples)
    let componentCount = 0;
    for (const dir of componentDirs) {
      if (componentCount >= 3) break;
      const pattern = `${dir}/**/*.tsx`;
      const matches = this.globSync(pattern)
        .filter(f => !f.includes('.spec') && !f.includes('.test') && !f.includes('index') && !this.shouldExcludePath(f));
      for (const match of matches.slice(0, 2)) {
        const content = this.readFile(match, 80);
        if (content) {
          files[match] = content;
          componentCount++;
        }
        if (componentCount >= 3) break;
      }
    }

    // 3. Read component index files
    for (const dir of componentDirs) {
      const indexPath = `${dir}/index.ts`;
      const content = this.readFile(indexPath, 50);
      if (content) files[indexPath] = content;
    }

    return files;
  }

  /**
   * Generate available imports section from export map
   * Now includes components with usage examples, hooks, services, types, and utils
   */
  generateAvailableImportsSection() {
    let section = '## Available Imports\n\n';
    section += '**CRITICAL:** Only use imports listed below. DO NOT guess import paths.\n';
    section += '**CRITICAL:** Use string literals for variant/size props, NOT object access.\n\n';

    const exportMap = this.getExportMap();

    // Components - with usage examples and warnings
    if (Object.keys(exportMap.components).length > 0) {
      section += '### Components\n\n';

      for (const [name, info] of Object.entries(exportMap.components)) {
        // Use the formatComponentWithUsage helper if component has details
        const hasDetails = info.usageExample ||
          (info.props && Object.keys(info.props).length > 0) ||
          (info.arrayExports && info.arrayExports.length > 0);

        if (hasDetails) {
          section += formatComponentWithUsage(name, info);
        } else {
          // Fallback to simple format
          section += `#### ${name}\n\n`;
          section += '```typescript\n';
          if (info.exports.length > 0) {
            section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
          } else if (info.defaultExport) {
            section += `import ${info.defaultExport} from '${info.importPath}';\n`;
          }
          section += '```\n\n';
        }
      }

      // Collect all array exports for global warning
      const allArrayExports = [];
      for (const [name, info] of Object.entries(exportMap.components)) {
        if (info.arrayExports && info.arrayExports.length > 0) {
          allArrayExports.push(...info.arrayExports);
        }
      }

      if (allArrayExports.length > 0) {
        section += '#### ⚠️ CRITICAL: Array Exports Warning\n\n';
        section += `The following exports are **ARRAYS** (for iteration), **NOT objects**:\n`;
        section += `\`${allArrayExports.join('`, `')}\`\n\n`;
        section += '**WRONG:** `variant={cardVariants.default}` ❌\n';
        section += '**CORRECT:** `variant="default"` ✅\n\n';
      }
    }

    // Hooks - with file name vs export name warning
    if (Object.keys(exportMap.hooks).length > 0) {
      section += '### Hooks\n\n';
      section += '**IMPORTANT:** Use exact hook names shown below. File names may differ from export names.\n\n';

      for (const [fileName, info] of Object.entries(exportMap.hooks)) {
        section += `#### ${fileName}\n`;
        section += '```typescript\n';
        if (info.exports.length > 0) {
          section += `// File: ${fileName}.ts\n`;
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
        section += '```\n\n';
      }

      section += '**Common Hook Mistakes:**\n';
      section += '- ❌ `useAuthStore()` → Check actual export (might be `useAuthState()`)\n';
      section += '- ❌ Using file name as function name → Use the actual exported function name\n\n';
    }

    // Services
    if (Object.keys(exportMap.services).length > 0) {
      section += '### Services\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.services)) {
        if (info.exports.length > 0) {
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Types
    if (Object.keys(exportMap.types).length > 0) {
      section += '### Types\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.types)) {
        if (info.types && info.types.length > 0) {
          section += `import type { ${info.types.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Utils
    if (Object.keys(exportMap.utils).length > 0) {
      section += '### Utilities\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.utils)) {
        if (info.exports.length > 0) {
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Check if we found anything
    const totalExports = Object.keys(exportMap.components).length +
      Object.keys(exportMap.hooks).length +
      Object.keys(exportMap.services).length +
      Object.keys(exportMap.types).length +
      Object.keys(exportMap.utils).length;

    if (totalExports === 0) {
      section += '_No exports found. Define imports inline or use TODO comments._\n\n';
    }

    return section;
  }

  /**
   * @deprecated Use generateAvailableImportsSection instead
   */
  generateAvailableComponentsSection() {
    return this.generateAvailableImportsSection();
  }

  /**
   * Generate project-specific warnings from config
   */
  generateWarningsSection() {
    const warnings = this.config.projectWarnings || [];
    const doNotImport = this.config.doNotImport || ['React'];

    if (warnings.length === 0 && doNotImport.length <= 1) return '';

    let section = '## Project-Specific Warnings\n\n';

    if (doNotImport.length > 0) {
      section += '**DO NOT import these:**\n';
      for (const item of doNotImport) {
        section += `- ❌ \`${item}\`\n`;
      }
      section += '\n';
    }

    if (warnings.length > 0) {
      section += '**Additional warnings:**\n';
      for (const warning of warnings) {
        section += `- ⚠️ ${warning}\n`;
      }
      section += '\n';
    }

    return section;
  }

  /**
   * Generate type locations section from config
   */
  generateTypeLocationsSection() {
    const typeLocations = this.config.typeLocations || {};

    if (Object.keys(typeLocations).length === 0) return '';

    let section = '## Type Import Paths\n\n';
    section += '| Context | Import From |\n';
    section += '|---------|-------------|\n';

    for (const [context, importPath] of Object.entries(typeLocations)) {
      section += `| ${context} | \`${importPath}\` |\n`;
    }
    section += '\n';

    return section;
  }

  /**
   * Generate custom rules section from config
   */
  generateCustomRulesSection() {
    const rules = this.config.customRules || [];

    if (rules.length === 0) return '';

    let section = '## Project Coding Rules\n\n';
    for (const rule of rules) {
      section += `- ${rule}\n`;
    }
    section += '\n';

    return section;
  }

  /**
   * Generate dynamic context based on detected UI framework
   */
  generateFrameworkGuidance() {
    const uiFramework = this.config.uiFramework;
    const stylingApproach = this.config.stylingApproach;

    if (!uiFramework && !stylingApproach) return '';

    let section = '## Framework & Styling\n\n';

    if (uiFramework) {
      section += `**UI Framework:** ${uiFramework}\n\n`;
    }

    if (stylingApproach) {
      section += `**Styling Approach:** ${stylingApproach}\n\n`;

      // Add framework-specific guidance
      switch (stylingApproach.toLowerCase()) {
        case 'styled-components':
          section += `### Styled Components Patterns
- Use transient props: \`$active\`, \`$variant\`, \`$size\` (prefix with $)
- Theme access: \`\${({ theme }) => theme.colors.X}\`
- Add displayName: \`Component.displayName = 'Component'\`
\n`;
          break;
        case 'tailwind':
        case 'tailwindcss':
          section += `### Tailwind Patterns
- Use className for styling
- Use cn() utility if available for conditional classes
- Follow project's class naming conventions
\n`;
          break;
        case 'css-modules':
          section += `### CSS Modules Patterns
- Import styles: \`import styles from './Component.module.css'\`
- Use: \`className={styles.container}\`
\n`;
          break;
      }
    }

    return section;
  }

  /**
   * Generate smart context from project files (config-driven)
   */
  generateSmartContext(projectFiles) {
    let context = '# Project Context for Code Generation\n\n';
    context += '> This context is auto-generated from your project configuration.\n';
    context += '> Local LLM: Use this as your primary reference.\n\n';

    // 1. Available components (FIRST - most important for imports)
    context += this.generateAvailableComponentsSection();

    // 2. Framework/styling guidance
    context += this.generateFrameworkGuidance();

    // 3. Type locations
    context += this.generateTypeLocationsSection();

    // 4. Project-specific warnings
    context += this.generateWarningsSection();

    // 5. Custom rules
    context += this.generateCustomRulesSection();

    // 6. Type Definitions (filtered)
    context += '## Type Definitions\n\n';
    let hasTypes = false;
    for (const [filePath, content] of Object.entries(projectFiles)) {
      if (filePath.includes('types')) {
        context += `### From \`${filePath}\`\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
        hasTypes = true;
      }
    }
    if (!hasTypes) {
      context += '_No type files found. Define types inline if needed._\n\n';
    }

    // 7. Component patterns (sample)
    context += '## Component Patterns\n\n';
    let sampleShown = false;
    for (const [filePath, content] of Object.entries(projectFiles)) {
      if (filePath.includes('components/') && filePath.endsWith('.tsx') && !sampleShown) {
        context += `### Sample Pattern (from \`${filePath}\`)\n`;
        context += 'Follow this pattern for new components:\n';
        context += '```typescript\n' + content + '\n```\n\n';
        sampleShown = true;
      }
    }
    if (!sampleShown) {
      context += '_No sample components found._\n\n';
    }

    // 8. Universal rules
    context += `## Universal Rules

### Import Rules
- ❌ NEVER: \`import React from 'react'\` (causes TS6133 error in React 17+)
- ✅ CORRECT: \`import { useState, useCallback } from 'react'\`
- ❌ NEVER invent import paths - use only what's listed above
- ✅ If unsure, define types inline or use TODO comment

### Export Rules
- ✅ Named exports: \`export function ComponentName() {}\`
- ✅ Props interface: \`interface ComponentNameProps {}\`

---

**Remember:** If you're unsure about an import path, DON'T GUESS. Use inline code or a TODO comment.

`;

    return context;
  }

  /**
   * Minimal context fallback when no project files found
   */
  getMinimalContext() {
    let context = `# Project Context for Code Generation

## Critical Rules

### Imports
- ❌ NEVER: \`import React from 'react'\` - causes TS6133 unused variable error
- ✅ CORRECT: \`import { useState, useCallback } from 'react'\`
- ❌ NEVER invent import paths - only import what you know exists

### Exports
- ✅ Use named exports: \`export function ComponentName\`
- ✅ Define Props interface: \`interface ComponentNameProps {}\`

`;

    // Add any configured warnings even in minimal mode
    context += this.generateWarningsSection();
    context += this.generateCustomRulesSection();

    return context;
  }

  /**
   * Generate or retrieve project context
   */
  getOrGenerateContext() {
    // Check cache first
    const cached = this.getCachedContext();
    if (cached) {
      return { context: cached, fromCache: true };
    }

    // Gather project files
    const projectFiles = this.gatherProjectFiles();

    if (Object.keys(projectFiles).length === 0) {
      const minimal = this.getMinimalContext();
      return { context: minimal, fromCache: false };
    }

    // Generate context from files
    const context = this.generateSmartContext(projectFiles);

    // Cache it
    this.saveContext(context);

    return { context, fromCache: false };
  }

  /**
   * Force regenerate context (bypass cache)
   */
  regenerateContext() {
    const projectFiles = this.gatherProjectFiles();
    const context = Object.keys(projectFiles).length > 0
      ? this.generateSmartContext(projectFiles)
      : this.getMinimalContext();

    this.saveContext(context);
    return context;
  }
}

module.exports = { ProjectContextGenerator };
