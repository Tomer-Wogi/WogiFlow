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

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, safeJsonParse, getConfig, getTodayDate } = require('./flow-utils');

const PROJECT_ROOT = process.argv[2] || getProjectRoot();

// Validate PROJECT_ROOT is a real directory (SEC007: prevents path injection via argv)
if (!fs.existsSync(PROJECT_ROOT) || !fs.statSync(PROJECT_ROOT).isDirectory()) {
  console.error(`Error: Invalid project root: ${PROJECT_ROOT}`);
  process.exit(1);
}

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

  const pkg = safeJsonParse(packageJsonPath, null);
  if (!pkg) return null;
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
}

/**
 * Detect data-fetching library from package.json dependencies.
 * Returns the primary data-fetching library name or null.
 * @param {string} [projectRoot] - Project root (defaults to module-level PROJECT_ROOT)
 */
function detectDataFetchingLibrary(projectRoot) {
  const packageJsonPath = path.join(projectRoot || PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;

  const pkg = safeJsonParse(packageJsonPath, null);
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Priority order: higher-level abstractions first, transport libs last
  if (deps['@tanstack/react-query'] || deps['react-query']) return 'react-query';
  if (deps['swr']) return 'swr';
  if (deps['@apollo/client'] || deps['apollo-client']) return 'apollo';
  if (deps['@trpc/react-query'] || deps['@trpc/client']) return 'trpc';
  if (deps['axios']) return 'axios'; // Transport library — lowest priority

  return null;
}

/**
 * Detect styling approach from dependencies and project files
 */
function detectStylingApproach() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;

  const pkg = safeJsonParse(packageJsonPath, null);
  if (!pkg) return null;
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

      // Skip common excluded directories (including WogiFlow internals)
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.workflow', '.claude'].includes(entry.name)) continue;
        findFiles(fullPath, pattern, results, depth + 1);
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch (_err) {
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
  } catch (_err) {
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
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'jest.config.js',
    'jest.config.ts',
    'vitest.config.ts',
    'vitest.config.js',
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
      const pkg = safeJsonParse(packageJsonPath, null);
      if (pkg) {
        const reactVersion = pkg.dependencies?.react || pkg.devDependencies?.react || '';
        if (reactVersion && !reactVersion.includes('16.')) {
          warnings.push("Don't import React directly - use named imports (useState, useCallback)");
        }
      }
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
    // Placeholder for monorepo package exclusion logic
    // TODO: Read packages/ dir and auto-exclude internal package types
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
// Project Type Detection (for Auto-Testing Suite)
// ============================================================

/** UI framework indicators in package.json dependencies (with detection weights) */
const UI_FRAMEWORK_DEPS = {
  react: 'react',
  vue: 'vue',
  svelte: 'svelte',
  angular: '@angular/core',
  next: 'next',
  nuxt: 'nuxt',
  gatsby: 'gatsby',
  remix: '@remix-run/react',
  'react-native': 'react-native',
  expo: 'expo',
  solid: 'solid-js',
  qwik: '@builder.io/qwik'
};

/** API/backend framework indicators in package.json dependencies */
const API_FRAMEWORK_DEPS = {
  express: 'express',
  fastify: 'fastify',
  koa: 'koa',
  hono: 'hono',
  nestjs: '@nestjs/core',
  hapi: '@hapi/hapi'
};

/** Test framework indicators in package.json devDependencies */
const TEST_FRAMEWORK_DEPS = {
  jest: 'jest',
  vitest: 'vitest',
  mocha: 'mocha',
  playwright: '@playwright/test',
  cypress: 'cypress',
  'testing-library': '@testing-library/react'
};

/** Directory indicators for UI presence */
const UI_DIRECTORIES = [
  'src/components', 'src/pages', 'app', 'pages', 'src/views',
  'src/screens', 'src/ui'
];

/** Directory indicators for API/backend presence */
const API_DIRECTORIES = [
  'routes', 'api', 'controllers', 'server', 'src/routes',
  'src/controllers', 'src/api'
];

/** File indicators for API presence */
const API_FILES = ['openapi.yaml', 'openapi.json', 'swagger.json', 'swagger.yaml'];

/**
 * Default detection weights for weighted scoring (Option C).
 * Each signal contributes a weight to uiScore/apiScore.
 * hasUI/hasAPI are true when the score >= threshold.
 * Configurable via config.detection.weights and config.detection.thresholds.
 */
const DEFAULT_DETECTION_WEIGHTS = {
  uiFrameworkDep: 0.95,     // Definitive: you don't install react for fun
  apiFrameworkDep: 0.95,    // Definitive: express/fastify = real backend
  uiDirectory: 0.3,         // Weak: could be client-side routing
  apiDirectory: 0.25,       // Weak: src/routes/ could be React Router
  apiFile: 0.8,             // Strong: openapi.yaml = real API
  testFrameworkDep: 0.9     // Definitive for test detection
};

const DEFAULT_DETECTION_THRESHOLDS = {
  ui: 0.5,
  api: 0.5
};

/**
 * Detect project type using weighted scoring.
 *
 * Each signal (dependency, directory, file) contributes a weight to uiScore/apiScore.
 * hasUI/hasAPI are true only when the accumulated score >= threshold (default 0.5).
 * This prevents weak signals (like src/routes/ existing) from triggering false positives.
 *
 * Weights and thresholds are configurable via config.detection.weights and
 * config.detection.thresholds. Manual overrides via config.detection.overrides
 * take precedence over scoring.
 *
 * @param {string} [projectRoot] - Project root (defaults to module-level PROJECT_ROOT)
 * @returns {{ hasUI: boolean, hasAPI: boolean, projectType: string, uiFramework: string|null, apiFramework: string|null, testFramework: string|null, uiScore: number, apiScore: number }}
 */
function detectProjectType(projectRoot) {
  const root = projectRoot || PROJECT_ROOT;

  // --- Load configurable weights/thresholds/overrides ---
  let weights = { ...DEFAULT_DETECTION_WEIGHTS };
  let thresholds = { ...DEFAULT_DETECTION_THRESHOLDS };
  let overrides = null;
  try {
    const configPath = path.join(root, '.workflow', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = safeJsonParse(configPath, null);
      if (cfg && cfg.detection) {
        if (cfg.detection.weights) {
          weights = { ...weights, ...cfg.detection.weights };
        }
        if (cfg.detection.thresholds) {
          thresholds = { ...thresholds, ...cfg.detection.thresholds };
        }
        if (cfg.detection.overrides) {
          overrides = cfg.detection.overrides;
        }
      }
    }
  } catch (err) {
    // Config read failure — use defaults
  }

  let uiScore = 0;
  let apiScore = 0;
  const result = {
    hasUI: false,
    hasAPI: false,
    projectType: 'library',
    uiFramework: null,
    apiFramework: null,
    testFramework: null,
    uiScore: 0,
    apiScore: 0
  };

  // --- Read package.json ---
  const packageJsonPath = path.join(root, 'package.json');
  let deps = {};
  let devDeps = {};

  if (fs.existsSync(packageJsonPath)) {
    const pkg = safeJsonParse(packageJsonPath, null);
    if (pkg) {
      deps = pkg.dependencies || {};
      devDeps = pkg.devDependencies || {};
    }
  }

  const allDeps = { ...deps, ...devDeps };

  // --- Detect UI framework (high-weight signal) ---
  for (const [name, depKey] of Object.entries(UI_FRAMEWORK_DEPS)) {
    if (deps[depKey] || devDeps[depKey]) {
      uiScore += weights.uiFrameworkDep;
      if (!result.uiFramework) {
        result.uiFramework = name;
      }
    }
  }

  // --- Detect API framework (high-weight signal) ---
  for (const [name, depKey] of Object.entries(API_FRAMEWORK_DEPS)) {
    if (deps[depKey] || devDeps[depKey]) {
      apiScore += weights.apiFrameworkDep;
      if (!result.apiFramework) {
        result.apiFramework = name;
      }
    }
  }

  // --- Directory-based detection (low-weight signals) ---
  for (const dir of UI_DIRECTORIES) {
    const fullPath = path.join(root, dir);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        uiScore += weights.uiDirectory;
        break; // Only count one directory match
      }
    } catch (err) {
      // stat failure — skip
    }
  }

  for (const dir of API_DIRECTORIES) {
    const fullPath = path.join(root, dir);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        apiScore += weights.apiDirectory;
        break; // Only count one directory match
      }
    } catch (err) {
      // stat failure — skip
    }
  }

  // --- API file indicators (strong signal) ---
  for (const file of API_FILES) {
    if (fs.existsSync(path.join(root, file))) {
      apiScore += weights.apiFile;
      break; // Only count once
    }
  }

  // --- Detect test framework ---
  for (const [name, depKey] of Object.entries(TEST_FRAMEWORK_DEPS)) {
    if (allDeps[depKey]) {
      if (!result.testFramework) {
        result.testFramework = name;
      }
    }
  }

  // --- Apply thresholds to determine hasUI/hasAPI ---
  result.uiScore = uiScore;
  result.apiScore = apiScore;
  result.hasUI = uiScore >= thresholds.ui;
  result.hasAPI = apiScore >= thresholds.api;

  // --- Apply manual overrides (highest precedence) ---
  if (overrides) {
    if (typeof overrides.hasUI === 'boolean') result.hasUI = overrides.hasUI;
    if (typeof overrides.hasAPI === 'boolean') result.hasAPI = overrides.hasAPI;
    if (typeof overrides.projectType === 'string') {
      result.projectType = overrides.projectType;
      return result; // Skip auto-determination
    }
  }

  // --- Determine project type ---
  if (result.hasUI && result.hasAPI) {
    result.projectType = 'fullstack';
  } else if (result.hasUI && !result.hasAPI) {
    result.projectType = 'frontend';
  } else if (!result.hasUI && result.hasAPI) {
    result.projectType = 'backend';
  } else {
    result.projectType = 'library';
  }

  return result;
}

// ============================================================
// Constants (avoids magic numbers scattered through analysis)
// ============================================================
const FILE_SAMPLE_LIMIT = 20;       // Max files to sample for convention detection
const ISSUE_SCAN_LIMIT = 100;       // Max files to scan for potential issues
const CONSOLE_SCAN_LIMIT = 50;      // Max files to scan for console statements
const LARGE_FILE_THRESHOLD = 500;   // Lines above which a file is flagged
const CONSOLE_WARN_THRESHOLD = 10;  // Minimum console statements to flag

/** Log only when running as CLI (not when required as a library) */
const isCLI = require.main === module;
function log(...args) {
  if (isCLI) console.log(...args);
}

// ============================================================
// Main Analysis Function
// ============================================================

function analyzeProject() {
  log('Analyzing project for hybrid mode configuration...\n');

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
  log(`UI Framework: ${analysis.uiFramework || 'not detected'}`);
  log(`Styling: ${analysis.stylingApproach || 'not detected'}`);
  log(`Component dirs: ${analysis.componentDirs.length > 0 ? analysis.componentDirs.join(', ') : 'none found'}`);
  log(`Components found: ${Object.keys(analysis.availableComponents).length}`);
  log(`Type locations: ${Object.keys(analysis.typeLocations).length > 0 ? JSON.stringify(analysis.typeLocations) : 'default'}`);
  log('');

  return analysis;
}

/**
 * Update config.json with analyzed project context
 */
function updateConfig(analysis) {
  if (!fs.existsSync(CONFIG_PATH)) {
    log('Warning: config.json not found. Run flow init first.');
    return false;
  }

  try {
    const config = getConfig();
    if (!config || Object.keys(config).length === 0) return false;

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

    log('✓ Updated config.json with project context');
    log(`  Framework: ${analysis.uiFramework || 'not detected'}`);
    log(`  Styling: ${analysis.stylingApproach || 'not detected'}`);
    log(`  Component patterns: ${config.frameworkConfig.componentPatterns.length}`);
    return true;
  } catch (err) {
    log(`Error updating config: ${err.message}`);
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
    log('✓ Cleared hybrid context cache');
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
    const tsFiles = findFiles(srcDir, /\.tsx?$/).slice(0, FILE_SAMPLE_LIMIT);

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

  } catch (_err) {
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
    // Check for large files
    const allFiles = findFiles(srcDir, /\.(ts|tsx|js|jsx)$/);
    for (const file of allFiles.slice(0, ISSUE_SCAN_LIMIT)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n').length;
        if (lines > LARGE_FILE_THRESHOLD) {
          issues.push({
            type: 'large-file',
            severity: 'warning',
            file: path.relative(PROJECT_ROOT, file),
            message: `Large file (${lines} lines) - consider splitting`
          });
        }
      } catch (_err) { /* File read error during size check — skip */ }
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

    for (const comp of componentFiles.slice(0, FILE_SAMPLE_LIMIT)) {
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
    for (const file of allFiles.slice(0, CONSOLE_SCAN_LIMIT)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const matches = content.match(/console\.(log|warn|error)\(/g);
        if (matches) consoleCount += matches.length;
      } catch (_err) { /* File read error during console scan — skip */ }
    }
    if (consoleCount > CONSOLE_WARN_THRESHOLD) {
      issues.push({
        type: 'console-statements',
        severity: 'info',
        message: `Found ${consoleCount} console statements - consider removing for production`
      });
    }

  } catch (_err) {
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

    // Detect data-fetching library
    stats.dataFetchingLibrary = detectDataFetchingLibrary();

  } catch (_err) {
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

Generated: ${getTodayDate()}

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

  log(`✓ Generated codebase insights: ${insightsPath}`);
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
  const config = getConfig();
  if (config.codebaseInsights?.enabled !== false) {
    saveCodebaseInsights();
  }

  if (success) {
    log('\n✓ Project analysis complete!');
    log('  The local LLM will now have accurate context about your project.');
    log('  Run "flow hybrid enable" to start using hybrid mode.');
  }

  process.exit(success ? 0 : 1);
}

module.exports = {
  analyzeProject,
  updateConfig,
  detectUIFramework,
  detectDataFetchingLibrary,
  detectStylingApproach,
  detectProjectType,
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
  saveCodebaseInsights,
  // Detection constants (for config reference)
  DEFAULT_DETECTION_WEIGHTS,
  DEFAULT_DETECTION_THRESHOLDS
};
