#!/usr/bin/env node

/**
 * Wogi Flow - Project Analyzer
 *
 * Analyzes a project and populates config.json with hybrid projectContext settings.
 * Called during onboarding to ensure the local LLM has all the context it needs.
 *
 * Usage:
 *   node flow-project-analyzer.js [project-root]
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = process.argv[2] || getProjectRoot();
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow/config.json');

// ============================================================
// Detection Functions
// ============================================================

/**
 * Detect UI framework from package.json and project files
 */
function detectUIFramework() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) return 'next';
    if (deps['@angular/core']) return 'angular';
    if (deps['vue']) return 'vue';
    if (deps['svelte']) return 'svelte';
    if (deps['react-native']) return 'react-native';
    if (deps['react']) return 'react';
    if (deps['@nestjs/core']) return 'nestjs';
    if (deps['express']) return 'express';
    if (deps['fastify']) return 'fastify';

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect styling approach from dependencies and project files
 */
function detectStylingApproach() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check dependencies
    if (deps['styled-components']) return 'styled-components';
    if (deps['@emotion/react'] || deps['@emotion/styled']) return 'emotion';
    if (deps['tailwindcss']) return 'tailwind';
    if (deps['sass'] || deps['node-sass']) return 'sass';
    if (deps['less']) return 'less';

    // Check for tailwind config
    if (fs.existsSync(path.join(PROJECT_ROOT, 'tailwind.config.js')) ||
        fs.existsSync(path.join(PROJECT_ROOT, 'tailwind.config.ts'))) {
      return 'tailwind';
    }

    // Check for CSS modules usage
    const srcDir = path.join(PROJECT_ROOT, 'src');
    if (fs.existsSync(srcDir)) {
      const hasCSSModules = findFiles(srcDir, /\.module\.css$/).length > 0;
      if (hasCSSModules) return 'css-modules';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Find files matching a pattern in a directory
 */
function findFiles(dir, pattern, results = [], depth = 0) {
  if (depth > 5) return results; // Limit depth

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip common excluded directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'].includes(entry.name)) continue;
        findFiles(fullPath, pattern, results, depth + 1);
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }

  return results;
}

/**
 * Find component directories in the project
 */
function findComponentDirs() {
  const possibleDirs = [
    'src/components',
    'components',
    'src/shared/components',
    'apps/web/src/components',
    'packages/ui/src',
    'src/ui',
  ];

  return possibleDirs.filter(dir => {
    const fullPath = path.join(PROJECT_ROOT, dir);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  });
}

/**
 * Find type file directories/patterns
 */
function findTypeDirs() {
  const possiblePatterns = [
    'src/types',
    'types',
    'src/@types',
    '@types',
  ];

  const foundDirs = possiblePatterns.filter(dir => {
    const fullPath = path.join(PROJECT_ROOT, dir);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  });

  // Also look for types.ts files in features
  const typeFiles = findFiles(path.join(PROJECT_ROOT, 'src'), /types\.ts$/);
  if (typeFiles.length > 0) {
    // Extract patterns from found type files
    const patterns = new Set();
    for (const file of typeFiles) {
      const relative = path.relative(PROJECT_ROOT, file);
      // Create a pattern from the path
      if (relative.includes('features/')) {
        patterns.add('src/features/*/api/types.ts');
      } else if (relative.includes('modules/')) {
        patterns.add('src/modules/*/types.ts');
      }
    }
    foundDirs.push(...patterns);
  }

  return foundDirs.length > 0 ? foundDirs : ['src/types/*.ts'];
}

/**
 * Scan a component directory and extract available components with their exports
 */
function scanComponentExports(componentDir) {
  const components = {};
  const fullDir = path.join(PROJECT_ROOT, componentDir);

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

      // Try to find exports from index file
      for (const indexFile of [indexPath, indexTsxPath]) {
        if (fs.existsSync(indexFile)) {
          const content = fs.readFileSync(indexFile, 'utf-8');

          // Match export { X, Y, Z }
          const reExports = content.match(/export\s+{\s*([^}]+)\s*}/g);
          if (reExports) {
            for (const match of reExports) {
              const names = match.replace(/export\s*{\s*/, '').replace(/\s*}/, '').split(',');
              exports.push(...names.map(n => n.trim().split(' ')[0]).filter(n => n));
            }
          }

          // Match export const/function/class X
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
          importPath: `@/components/${entry.name}`
        };
      }
    }
  } catch {
    // Ignore scan errors
  }

  return components;
}

/**
 * Generate glob patterns for component discovery based on detected framework
 * This is a simplified, one-time detection that generates patterns for later use
 */
function generateComponentGlobPatterns(uiFramework, componentDirs) {
  const patterns = [];

  // Base component patterns
  for (const dir of componentDirs) {
    patterns.push(`${dir}/**/*.tsx`);
    patterns.push(`${dir}/**/*.jsx`);
  }

  // Framework-specific patterns
  switch (uiFramework) {
    case 'next':
      // Next.js app router components
      patterns.push('app/**/*.tsx');
      patterns.push('app/**/page.tsx');
      patterns.push('app/**/layout.tsx');
      // Pages router
      patterns.push('pages/**/*.tsx');
      break;

    case 'react':
    case 'react-native':
      // Common React patterns
      patterns.push('src/**/*.tsx');
      patterns.push('src/**/*.jsx');
      break;

    case 'vue':
      patterns.push('src/**/*.vue');
      patterns.push('components/**/*.vue');
      break;

    case 'angular':
      patterns.push('src/**/*.component.ts');
      patterns.push('src/**/*.component.html');
      break;

    case 'svelte':
      patterns.push('src/**/*.svelte');
      break;

    case 'nestjs':
      // NestJS modules and controllers
      patterns.push('src/**/*.module.ts');
      patterns.push('src/**/*.controller.ts');
      patterns.push('src/**/*.service.ts');
      break;

    case 'express':
    case 'fastify':
      patterns.push('src/**/*.ts');
      patterns.push('src/routes/**/*.ts');
      patterns.push('src/controllers/**/*.ts');
      break;
  }

  // Default fallback if no framework detected
  if (patterns.length === 0) {
    patterns.push('src/**/*.ts');
    patterns.push('src/**/*.tsx');
    patterns.push('src/**/*.js');
    patterns.push('src/**/*.jsx');
  }

  return [...new Set(patterns)]; // Dedupe
}

/**
 * Generate simplified framework config for storing in config.json
 * This provides all the info needed without re-detection
 */
function generateFrameworkConfig(analysis) {
  return {
    framework: analysis.uiFramework,
    styling: analysis.stylingApproach,
    componentPatterns: generateComponentGlobPatterns(analysis.uiFramework, analysis.componentDirs),
    testPatterns: generateTestGlobPatterns(analysis.uiFramework),
    configFiles: detectConfigFiles(),
    detectedAt: new Date().toISOString()
  };
}

/**
 * Generate test file glob patterns based on framework
 */
function generateTestGlobPatterns(uiFramework) {
  const patterns = [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '__tests__/**/*.ts',
    '__tests__/**/*.tsx',
  ];

  // Framework-specific test patterns
  if (uiFramework === 'angular') {
    patterns.push('**/*.spec.ts');
  }

  if (uiFramework === 'nestjs') {
    patterns.push('test/**/*.e2e-spec.ts');
  }

  return patterns;
}

/**
 * Detect important config files in the project
 */
function detectConfigFiles() {
  const configFiles = {};
  const checkFiles = [
    'tsconfig.json',
    'package.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    'next.config.js',
    'next.config.mjs',
    'vite.config.ts',
    'webpack.config.js',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    'jest.config.js',
    'vitest.config.ts',
  ];

  for (const file of checkFiles) {
    const fullPath = path.join(PROJECT_ROOT, file);
    if (fs.existsSync(fullPath)) {
      configFiles[file] = true;
    }
  }

  return configFiles;
}

/**
 * Detect type import locations based on project structure
 */
function detectTypeLocations() {
  const locations = {};

  // Check for common patterns
  const featureTypesExist = findFiles(path.join(PROJECT_ROOT, 'src'), /\/api\/types\.ts$/).length > 0;
  if (featureTypesExist) {
    locations['features'] = '../api/types';
  }

  const sharedTypesDir = path.join(PROJECT_ROOT, 'src/types');
  if (fs.existsSync(sharedTypesDir)) {
    locations['shared'] = '@/types';
  }

  return locations;
}

/**
 * Generate warnings based on detected framework
 */
function generateWarnings(uiFramework, stylingApproach) {
  const warnings = [];

  // Framework-specific warnings
  if (uiFramework === 'react' || uiFramework === 'next') {
    // Check React version for JSX transform
    const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const reactVersion = pkg.dependencies?.react || pkg.devDependencies?.react || '';
        if (reactVersion && !reactVersion.includes('16.')) {
          warnings.push("Don't import React directly - use named imports (useState, useCallback)");
        }
      } catch {}
    }
  }

  // Styling-specific warnings
  if (stylingApproach === 'styled-components') {
    warnings.push('Use transient props ($propName) to prevent DOM warnings');
  }

  if (stylingApproach === 'tailwind') {
    // Check if cn utility exists
    const utilsPath = path.join(PROJECT_ROOT, 'src/lib/utils.ts');
    if (!fs.existsSync(utilsPath)) {
      warnings.push("cn() utility may not exist - use clsx or className directly");
    }
  }

  return warnings;
}

/**
 * Detect directories to exclude from type scanning
 */
function detectExcludeDirectories() {
  // Always exclude these
  const excludes = ['__tests__', '__mocks__', 'node_modules', '.git', 'dist', 'build'];

  // Check for monorepo structure and add internal packages
  const packagesDir = path.join(PROJECT_ROOT, 'packages');
  if (fs.existsSync(packagesDir)) {
    try {
      const packages = fs.readdirSync(packagesDir);
      // Internal packages often have types that aren't relevant to app code
      // User can customize this via config
    } catch {}
  }

  return excludes;
}

/**
 * Detect type patterns to exclude (project-specific internal types)
 */
function detectExcludeTypePatterns() {
  // Start with empty - let users configure this per project
  // During onboarding, we'll ask if there are internal types to exclude
  return [];
}

// ============================================================
// Main Analysis Function
// ============================================================

function analyzeProject() {
  console.log('Analyzing project for hybrid mode configuration...\n');

  const analysis = {
    uiFramework: detectUIFramework(),
    stylingApproach: detectStylingApproach(),
    componentDirs: findComponentDirs(),
    typeDirs: findTypeDirs(),
    availableComponents: {},
    typeLocations: detectTypeLocations(),
    doNotImport: ['React'], // Default for React 17+
    excludeTypePatterns: detectExcludeTypePatterns(),
    excludeDirectories: detectExcludeDirectories(),
    projectWarnings: [],
    customRules: [],
  };

  // Scan components
  for (const dir of analysis.componentDirs) {
    const components = scanComponentExports(dir);
    Object.assign(analysis.availableComponents, components);
  }

  // Generate warnings
  analysis.projectWarnings = generateWarnings(analysis.uiFramework, analysis.stylingApproach);

  // Report findings
  console.log(`UI Framework: ${analysis.uiFramework || 'not detected'}`);
  console.log(`Styling: ${analysis.stylingApproach || 'not detected'}`);
  console.log(`Component dirs: ${analysis.componentDirs.length > 0 ? analysis.componentDirs.join(', ') : 'none found'}`);
  console.log(`Components found: ${Object.keys(analysis.availableComponents).length}`);
  console.log(`Type locations: ${Object.keys(analysis.typeLocations).length > 0 ? JSON.stringify(analysis.typeLocations) : 'default'}`);
  console.log('');

  return analysis;
}

/**
 * Update config.json with analyzed project context
 */
function updateConfig(analysis) {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('Warning: config.json not found. Run flow init first.');
    return false;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

    // Ensure hybrid section exists
    if (!config.hybrid) config.hybrid = {};
    if (!config.hybrid.projectContext) config.hybrid.projectContext = {};

    // Update project context
    const ctx = config.hybrid.projectContext;
    ctx.uiFramework = analysis.uiFramework;
    ctx.stylingApproach = analysis.stylingApproach;
    ctx.componentDirs = analysis.componentDirs;
    ctx.typeDirs = analysis.typeDirs;
    ctx.availableComponents = analysis.availableComponents;
    ctx.typeLocations = analysis.typeLocations;
    ctx.doNotImport = analysis.doNotImport;
    ctx.excludeTypePatterns = analysis.excludeTypePatterns;
    ctx.excludeDirectories = analysis.excludeDirectories;
    ctx.projectWarnings = analysis.projectWarnings;
    ctx.customRules = analysis.customRules;

    // Add simplified framework config with glob patterns
    // This is the one-time detection result that can be used without re-scanning
    config.frameworkConfig = generateFrameworkConfig(analysis);

    // Write back
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log('✓ Updated config.json with project context');
    console.log(`  Framework: ${analysis.uiFramework || 'not detected'}`);
    console.log(`  Styling: ${analysis.stylingApproach || 'not detected'}`);
    console.log(`  Component patterns: ${config.frameworkConfig.componentPatterns.length}`);
    return true;
  } catch (err) {
    console.log(`Error updating config: ${err.message}`);
    return false;
  }
}

/**
 * Delete cached context to force regeneration
 */
function clearContextCache() {
  const cachePath = path.join(PROJECT_ROOT, '.workflow/state/hybrid-context.md');
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    console.log('✓ Cleared hybrid context cache');
  }
}

// ============================================================
// Codebase Insights Generation
// ============================================================

/**
 * Detect architecture pattern based on directory structure
 */
function detectArchitecturePattern() {
  const indicators = {
    monorepo: fs.existsSync(path.join(PROJECT_ROOT, 'packages')) ||
              fs.existsSync(path.join(PROJECT_ROOT, 'apps')),
    modular: fs.existsSync(path.join(PROJECT_ROOT, 'src/modules')) ||
             fs.existsSync(path.join(PROJECT_ROOT, 'src/features')),
    layered: fs.existsSync(path.join(PROJECT_ROOT, 'src/controllers')) &&
             fs.existsSync(path.join(PROJECT_ROOT, 'src/services')),
    componentBased: fs.existsSync(path.join(PROJECT_ROOT, 'src/components')),
    pagesBased: fs.existsSync(path.join(PROJECT_ROOT, 'pages')) ||
                fs.existsSync(path.join(PROJECT_ROOT, 'app'))
  };

  if (indicators.monorepo) return { pattern: 'Monorepo', description: 'Multi-package workspace with shared code' };
  if (indicators.modular) return { pattern: 'Modular Monolith', description: 'Feature-based module structure in single deployable' };
  if (indicators.layered) return { pattern: 'Layered Architecture', description: 'Separated controllers, services, and repositories' };
  if (indicators.pagesBased && indicators.componentBased) return { pattern: 'Page-Component Architecture', description: 'Page-based routing with shared components' };
  if (indicators.componentBased) return { pattern: 'Component-Based', description: 'UI component focused structure' };

  return { pattern: 'Simple/Flat', description: 'Basic project structure' };
}

/**
 * Detect naming conventions from file samples
 */
function detectConventions() {
  const conventions = {
    files: 'unknown',
    components: 'unknown',
    functions: 'unknown',
    constants: 'unknown',
    imports: 'unknown'
  };

  const srcDir = path.join(PROJECT_ROOT, 'src');
  if (!fs.existsSync(srcDir)) return conventions;

  try {
    // Sample some files
    const tsFiles = findFiles(srcDir, /\.tsx?$/).slice(0, 20);

    // Check file naming
    const fileNames = tsFiles.map(f => path.basename(f, path.extname(f)));
    const kebabCount = fileNames.filter(n => /^[a-z]+(-[a-z]+)*$/.test(n)).length;
    const pascalCount = fileNames.filter(n => /^[A-Z][a-zA-Z]*$/.test(n)).length;
    const camelCount = fileNames.filter(n => /^[a-z][a-zA-Z]*$/.test(n)).length;

    if (kebabCount > pascalCount && kebabCount > camelCount) conventions.files = 'kebab-case';
    else if (pascalCount > camelCount) conventions.files = 'PascalCase';
    else if (camelCount > 0) conventions.files = 'camelCase';

    // Check component naming (from .tsx files)
    const componentFiles = tsFiles.filter(f => f.endsWith('.tsx'));
    if (componentFiles.length > 0) {
      const content = fs.readFileSync(componentFiles[0], 'utf-8');
      if (/export\s+(default\s+)?function\s+[A-Z]/.test(content)) {
        conventions.components = 'PascalCase function components';
      } else if (/const\s+[A-Z][a-zA-Z]+\s*=\s*\(/.test(content)) {
        conventions.components = 'PascalCase arrow function components';
      }
    }

    // Check import style
    if (tsFiles.length > 0) {
      const content = fs.readFileSync(tsFiles[0], 'utf-8');
      if (content.includes('@/')) conventions.imports = 'Absolute with @/ alias';
      else if (content.includes('~/')) conventions.imports = 'Absolute with ~/ alias';
      else if (/from\s+['"]\.\.?\//.test(content)) conventions.imports = 'Relative imports';
    }

  } catch {
    // Ignore errors
  }

  return conventions;
}

/**
 * Detect potential issues in the codebase
 */
function detectPotentialIssues() {
  const issues = [];
  const srcDir = path.join(PROJECT_ROOT, 'src');

  if (!fs.existsSync(srcDir)) return issues;

  try {
    // Check for large files (>500 lines)
    const allFiles = findFiles(srcDir, /\.(ts|tsx|js|jsx)$/);
    for (const file of allFiles.slice(0, 100)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n').length;
        if (lines > 500) {
          issues.push({
            type: 'large-file',
            severity: 'warning',
            file: path.relative(PROJECT_ROOT, file),
            message: `Large file (${lines} lines) - consider splitting`
          });
        }
      } catch {}
    }

    // Check for files without tests
    const componentFiles = allFiles.filter(f =>
      f.includes('/components/') &&
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('.stories.')
    );
    const testFiles = findFiles(srcDir, /\.(test|spec)\.(ts|tsx|js|jsx)$/);
    const testedComponents = new Set(
      testFiles.map(f => path.basename(f).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, ''))
    );

    for (const comp of componentFiles.slice(0, 20)) {
      const baseName = path.basename(comp).replace(/\.(ts|tsx|js|jsx)$/, '');
      if (!testedComponents.has(baseName) && baseName !== 'index') {
        issues.push({
          type: 'missing-test',
          severity: 'info',
          file: path.relative(PROJECT_ROOT, comp),
          message: 'No test file found'
        });
      }
    }

    // Check for console.log statements
    let consoleCount = 0;
    for (const file of allFiles.slice(0, 50)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const matches = content.match(/console\.(log|warn|error)\(/g);
        if (matches) consoleCount += matches.length;
      } catch {}
    }
    if (consoleCount > 10) {
      issues.push({
        type: 'console-statements',
        severity: 'info',
        message: `Found ${consoleCount} console statements - consider removing for production`
      });
    }

  } catch {
    // Ignore errors
  }

  return issues;
}

/**
 * Gather project statistics
 */
function gatherStatistics() {
  const stats = {
    totalFiles: 0,
    typeScriptFiles: 0,
    javaScriptFiles: 0,
    testFiles: 0,
    componentCount: 0,
    hookCount: 0,
    serviceCount: 0
  };

  const srcDir = path.join(PROJECT_ROOT, 'src');
  if (!fs.existsSync(srcDir)) return stats;

  try {
    const allFiles = findFiles(srcDir, /\.(ts|tsx|js|jsx)$/);
    stats.totalFiles = allFiles.length;
    stats.typeScriptFiles = allFiles.filter(f => /\.tsx?$/.test(f)).length;
    stats.javaScriptFiles = allFiles.filter(f => /\.jsx?$/.test(f)).length;
    stats.testFiles = allFiles.filter(f => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f)).length;

    // Count components (files in components/ directory or .tsx files with PascalCase names)
    stats.componentCount = allFiles.filter(f =>
      (f.includes('/components/') || f.includes('/ui/')) &&
      !f.includes('.test.') &&
      !f.includes('.stories.')
    ).length;

    // Count hooks (use*.ts files)
    stats.hookCount = allFiles.filter(f =>
      /\/use[A-Z][a-zA-Z]*\.(ts|tsx)$/.test(f)
    ).length;

    // Count services
    stats.serviceCount = allFiles.filter(f =>
      f.includes('.service.') || f.includes('/services/')
    ).length;

  } catch {
    // Ignore errors
  }

  return stats;
}

/**
 * Generate codebase insights markdown file
 */
function generateCodebaseInsights() {
  const architecture = detectArchitecturePattern();
  const conventions = detectConventions();
  const issues = detectPotentialIssues();
  const stats = gatherStatistics();
  const framework = detectUIFramework();
  const styling = detectStylingApproach();

  const tsRatio = stats.totalFiles > 0
    ? Math.round((stats.typeScriptFiles / stats.totalFiles) * 100)
    : 0;

  let markdown = `# Codebase Insights

Generated: ${new Date().toISOString().split('T')[0]}

## Architecture Pattern

**${architecture.pattern}**

${architecture.description}

## Tech Stack

- **Framework**: ${framework || 'Not detected'}
- **Styling**: ${styling || 'Not detected'}
- **TypeScript**: ${tsRatio}% of codebase

## Conventions Detected

| Aspect | Convention |
|--------|------------|
| Files | ${conventions.files} |
| Components | ${conventions.components} |
| Imports | ${conventions.imports} |

## Statistics

| Metric | Count |
|--------|-------|
| Total source files | ${stats.totalFiles} |
| TypeScript files | ${stats.typeScriptFiles} |
| Test files | ${stats.testFiles} |
| Components | ${stats.componentCount} |
| Hooks | ${stats.hookCount} |
| Services | ${stats.serviceCount} |

`;

  // Add issues section if any
  if (issues.length > 0) {
    markdown += `## Potential Issues

`;
    const grouped = {
      'large-file': [],
      'missing-test': [],
      'console-statements': [],
      'other': []
    };

    for (const issue of issues) {
      const group = grouped[issue.type] || grouped['other'];
      group.push(issue);
    }

    if (grouped['large-file'].length > 0) {
      markdown += `### Large Files\n`;
      for (const issue of grouped['large-file'].slice(0, 5)) {
        markdown += `- [ ] \`${issue.file}\` - ${issue.message}\n`;
      }
      markdown += '\n';
    }

    if (grouped['missing-test'].length > 0) {
      markdown += `### Missing Tests (${grouped['missing-test'].length} files)\n`;
      for (const issue of grouped['missing-test'].slice(0, 5)) {
        markdown += `- [ ] \`${issue.file}\`\n`;
      }
      if (grouped['missing-test'].length > 5) {
        markdown += `- ... and ${grouped['missing-test'].length - 5} more\n`;
      }
      markdown += '\n';
    }

    if (grouped['console-statements'].length > 0) {
      markdown += `### Code Quality\n`;
      for (const issue of grouped['console-statements']) {
        markdown += `- [ ] ${issue.message}\n`;
      }
      markdown += '\n';
    }
  } else {
    markdown += `## Code Health

No significant issues detected.\n`;
  }

  return markdown;
}

/**
 * Save codebase insights to file
 */
function saveCodebaseInsights() {
  const insightsPath = path.join(PROJECT_ROOT, '.workflow', 'state', 'codebase-insights.md');
  const dir = path.dirname(insightsPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const markdown = generateCodebaseInsights();
  fs.writeFileSync(insightsPath, markdown);

  console.log(`✓ Generated codebase insights: ${insightsPath}`);
  return insightsPath;
}

// ============================================================
// CLI
// ============================================================

function printUsage() {
  console.log(`
Wogi Flow - Project Analyzer

Analyzes your project and configures hybrid mode settings so the local LLM
has all the context it needs to generate correct code.

Usage:
  node flow-project-analyzer.js [project-root]

What it detects:
  - UI framework (React, Next.js, Vue, Angular, etc.)
  - Styling approach (styled-components, Tailwind, CSS modules, etc.)
  - Component directories and their exports
  - Type file locations
  - Import conventions

The results are saved to config.json -> hybrid.projectContext
`);
}

// Main
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Generate insights only
  if (process.argv.includes('--insights')) {
    saveCodebaseInsights();
    process.exit(0);
  }

  const analysis = analyzeProject();
  const success = updateConfig(analysis);
  clearContextCache();

  // Also generate codebase insights during full analysis
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (config.codebaseInsights?.enabled !== false) {
    saveCodebaseInsights();
  }

  if (success) {
    console.log('\n✓ Project analysis complete!');
    console.log('  The local LLM will now have accurate context about your project.');
    console.log('  Run "flow hybrid enable" to start using hybrid mode.');
  }

  process.exit(success ? 0 : 1);
}

module.exports = {
  analyzeProject,
  updateConfig,
  detectUIFramework,
  detectStylingApproach,
  scanComponentExports,
  generateComponentGlobPatterns,
  generateFrameworkConfig,
  detectConfigFiles,
  // Codebase insights
  detectArchitecturePattern,
  detectConventions,
  detectPotentialIssues,
  gatherStatistics,
  generateCodebaseInsights,
  saveCodebaseInsights
};
