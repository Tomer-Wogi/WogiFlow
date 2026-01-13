#!/usr/bin/env node

/**
 * Wogi Flow - Product Scanner
 *
 * Scans a project to infer product information for product.md generation.
 * Used during /wogi-init when user selects "Scan project and infer".
 *
 * Features:
 * - Extracts name/description from package.json
 * - Parses README.md for product description
 * - Infers project type from dependencies
 * - Detects features from routes/pages/screens
 *
 * Usage:
 *   node scripts/flow-product-scanner.js [projectRoot]
 *   node scripts/flow-product-scanner.js --json
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  fileExists,
  readFile,
  safeJsonParse,
  parseFlags,
  outputJson,
  info,
  warn
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

// Framework detection patterns
const FRAMEWORK_PATTERNS = {
  'next': { type: 'web-app', label: 'Next.js' },
  'react': { type: 'web-app', label: 'React' },
  'vue': { type: 'web-app', label: 'Vue.js' },
  'svelte': { type: 'web-app', label: 'Svelte' },
  'angular': { type: 'web-app', label: 'Angular' },
  'express': { type: 'api', label: 'Express' },
  'fastify': { type: 'api', label: 'Fastify' },
  'nestjs': { type: 'api', label: 'NestJS' },
  '@nestjs/core': { type: 'api', label: 'NestJS' },
  'hono': { type: 'api', label: 'Hono' },
  'react-native': { type: 'mobile-app', label: 'React Native' },
  'expo': { type: 'mobile-app', label: 'Expo' },
  'electron': { type: 'desktop-app', label: 'Electron' },
  'tauri': { type: 'desktop-app', label: 'Tauri' },
  'commander': { type: 'cli', label: 'CLI Tool' },
  'yargs': { type: 'cli', label: 'CLI Tool' }
};

// ============================================================
// Package.json Extraction
// ============================================================

/**
 * Extract product info from package.json
 * @param {string} projectRoot - Project root path
 * @returns {Object|null} - Extracted info
 */
function extractFromPackageJson(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fileExists(pkgPath)) {
    return null;
  }

  const pkg = safeJsonParse(pkgPath, null);
  if (!pkg) {
    return null;
  }

  return {
    name: pkg.name || null,
    description: pkg.description || null,
    keywords: pkg.keywords || [],
    version: pkg.version || null,
    repository: pkg.repository?.url || pkg.repository || null,
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {})
  };
}

// ============================================================
// README Extraction
// ============================================================

/**
 * Extract product description from README.md
 * @param {string} projectRoot - Project root path
 * @returns {Object|null} - Extracted info
 */
function extractFromReadme(projectRoot) {
  const readmePaths = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'readme.md'),
    path.join(projectRoot, 'Readme.md')
  ];

  let readmePath = null;
  for (const p of readmePaths) {
    if (fileExists(p)) {
      readmePath = p;
      break;
    }
  }

  if (!readmePath) {
    return null;
  }

  try {
    const content = readFile(readmePath);
    const lines = content.split('\n');

    let title = null;
    let description = null;
    let features = [];

    // Extract title (first # header)
    for (const line of lines) {
      if (line.startsWith('# ')) {
        title = line.replace(/^#\s+/, '').trim();
        break;
      }
    }

    // Extract description (first non-header, non-empty line after title)
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith('# ')) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('!')) {
        description = line.trim();
        break;
      }
    }

    // Extract features (look for ## Features section)
    let inFeatures = false;
    for (const line of lines) {
      if (line.match(/^##\s+features/i)) {
        inFeatures = true;
        continue;
      }
      if (inFeatures && line.startsWith('## ')) {
        break;
      }
      if (inFeatures && line.startsWith('- ')) {
        features.push(line.replace(/^-\s+/, '').trim());
      }
    }

    return {
      title,
      description,
      features: features.slice(0, 5) // Max 5 features
    };
  } catch (err) {
    warn(`Error reading README: ${err.message}`);
    return null;
  }
}

// ============================================================
// Project Type Inference
// ============================================================

/**
 * Infer project type from dependencies
 * @param {Object} pkgInfo - Package.json extracted info
 * @returns {Object} - { type, framework, confidence }
 */
function inferProjectType(pkgInfo) {
  if (!pkgInfo) {
    return { type: 'unknown', framework: null, confidence: 0 };
  }

  const allDeps = [...pkgInfo.dependencies, ...pkgInfo.devDependencies];

  for (const [pattern, info] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (allDeps.some(dep => dep.includes(pattern))) {
      return {
        type: info.type,
        framework: info.label,
        confidence: 0.9
      };
    }
  }

  // Check for common patterns
  if (allDeps.includes('typescript')) {
    return { type: 'library', framework: 'TypeScript', confidence: 0.5 };
  }

  return { type: 'unknown', framework: null, confidence: 0 };
}

// ============================================================
// Feature Detection
// ============================================================

/**
 * Detect features from project structure
 * @param {string} projectRoot - Project root path
 * @returns {Array} - Detected features
 */
function inferFeatures(projectRoot) {
  const features = [];

  // Check for common feature directories/files
  const featureIndicators = [
    { path: 'src/pages', feature: 'Page Routing' },
    { path: 'pages', feature: 'Page Routing' },
    { path: 'app', feature: 'App Router' },
    { path: 'src/app', feature: 'App Router' },
    { path: 'src/components', feature: 'Component Library' },
    { path: 'components', feature: 'Component Library' },
    { path: 'src/api', feature: 'API Layer' },
    { path: 'api', feature: 'API Routes' },
    { path: 'src/services', feature: 'Service Layer' },
    { path: 'src/hooks', feature: 'Custom Hooks' },
    { path: 'src/store', feature: 'State Management' },
    { path: 'src/redux', feature: 'Redux State' },
    { path: 'prisma', feature: 'Database (Prisma)' },
    { path: 'drizzle', feature: 'Database (Drizzle)' },
    { path: 'src/entities', feature: 'Database Entities' },
    { path: '__tests__', feature: 'Test Suite' },
    { path: 'tests', feature: 'Test Suite' },
    { path: 'src/__tests__', feature: 'Test Suite' },
    { path: 'cypress', feature: 'E2E Tests' },
    { path: 'playwright', feature: 'E2E Tests' },
    { path: '.github/workflows', feature: 'CI/CD Pipeline' }
  ];

  for (const indicator of featureIndicators) {
    const fullPath = path.join(projectRoot, indicator.path);
    if (fs.existsSync(fullPath)) {
      features.push({
        name: indicator.feature,
        description: `Detected from ${indicator.path}`,
        confidence: 0.8
      });
    }
  }

  // Detect routes/screens from pages or app directory
  const routeFeatures = detectRoutes(projectRoot);
  features.push(...routeFeatures);

  return features.slice(0, 10); // Max 10 features
}

/**
 * Detect routes from pages/app directory
 * @param {string} projectRoot - Project root path
 * @returns {Array} - Route-based features
 */
function detectRoutes(projectRoot) {
  const features = [];
  const routeDirs = [
    path.join(projectRoot, 'src/pages'),
    path.join(projectRoot, 'pages'),
    path.join(projectRoot, 'src/app'),
    path.join(projectRoot, 'app')
  ];

  for (const routeDir of routeDirs) {
    if (!fs.existsSync(routeDir)) continue;

    try {
      const entries = fs.readdirSync(routeDir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip special files
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        if (entry.name === 'api') continue;

        const name = entry.name
          .replace(/\.(tsx?|jsx?|vue|svelte)$/, '')
          .replace(/^\[.*\]$/, '[dynamic]');

        if (entry.isDirectory() || entry.name.match(/\.(tsx?|jsx?|vue|svelte)$/)) {
          features.push({
            name: `${name.charAt(0).toUpperCase() + name.slice(1)} Page`,
            description: `Route: /${name === 'index' ? '' : name}`,
            confidence: 0.7
          });
        }
      }
    } catch (err) {
      // Ignore read errors
    }
  }

  return features.slice(0, 5); // Max 5 route features
}

// ============================================================
// Main Scanner
// ============================================================

/**
 * Scan project and return inferred product information
 * @param {string} projectRoot - Project root path
 * @returns {Object} - Scanned product info
 */
function scanProject(projectRoot = PROJECT_ROOT) {
  const pkgInfo = extractFromPackageJson(projectRoot);
  const readmeInfo = extractFromReadme(projectRoot);
  const typeInfo = inferProjectType(pkgInfo);
  const features = inferFeatures(projectRoot);

  // Combine features from README and detected
  const allFeatures = [];
  if (readmeInfo?.features) {
    readmeInfo.features.forEach(f => {
      allFeatures.push({ name: f, description: 'From README', confidence: 0.9 });
    });
  }
  features.forEach(f => {
    if (!allFeatures.find(af => af.name === f.name)) {
      allFeatures.push(f);
    }
  });

  return {
    name: pkgInfo?.name || readmeInfo?.title || path.basename(projectRoot),
    description: pkgInfo?.description || readmeInfo?.description || null,
    type: typeInfo.type,
    framework: typeInfo.framework,
    features: allFeatures.slice(0, 10),
    keywords: pkgInfo?.keywords || [],
    confidence: calculateOverallConfidence(pkgInfo, readmeInfo, typeInfo),
    sources: {
      packageJson: !!pkgInfo,
      readme: !!readmeInfo,
      structure: features.length > 0
    }
  };
}

/**
 * Calculate overall confidence score
 */
function calculateOverallConfidence(pkgInfo, readmeInfo, typeInfo) {
  let score = 0;
  let factors = 0;

  if (pkgInfo?.name) { score += 0.3; factors++; }
  if (pkgInfo?.description) { score += 0.2; factors++; }
  if (readmeInfo?.description) { score += 0.2; factors++; }
  if (typeInfo.type !== 'unknown') { score += 0.3; factors++; }

  return factors > 0 ? Math.round((score / factors) * 100) / 100 : 0;
}

/**
 * Format scan results as a brief summary
 * @param {Object} scanResult - Result from scanProject
 * @returns {string} - Formatted summary
 */
function formatSummary(scanResult) {
  const lines = [
    `Based on scanning your project, I think this is:`,
    ``,
    `  **Name**: ${scanResult.name}`,
    `  **Type**: ${scanResult.type}${scanResult.framework ? ` (${scanResult.framework})` : ''}`,
    `  **Description**: ${scanResult.description || '[not detected]'}`,
    ``
  ];

  if (scanResult.features.length > 0) {
    lines.push(`  **Main Features**:`);
    scanResult.features.slice(0, 3).forEach(f => {
      lines.push(`    - ${f.name}`);
    });
  }

  lines.push(``);
  lines.push(`Is this correct?`);

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const { args, flags } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: node scripts/flow-product-scanner.js [projectRoot] [options]

Scan a project to infer product information.

Options:
  --json      Output as JSON
  --summary   Output as brief summary
  --help      Show this help message

Examples:
  node scripts/flow-product-scanner.js
  node scripts/flow-product-scanner.js /path/to/project --json
  node scripts/flow-product-scanner.js --summary
`);
    process.exit(0);
  }

  const projectRoot = args[0] || PROJECT_ROOT;
  const result = scanProject(projectRoot);

  if (flags.json) {
    outputJson(result);
    return;
  }

  if (flags.summary) {
    console.log(formatSummary(result));
    return;
  }

  // Default: verbose output
  console.log('\nProduct Scan Results\n');
  console.log(`Name: ${result.name}`);
  console.log(`Type: ${result.type}${result.framework ? ` (${result.framework})` : ''}`);
  console.log(`Description: ${result.description || '[not detected]'}`);
  console.log(`Confidence: ${Math.round(result.confidence * 100)}%`);
  console.log(`\nSources: ${Object.entries(result.sources).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

  if (result.features.length > 0) {
    console.log('\nDetected Features:');
    result.features.forEach(f => {
      console.log(`  - ${f.name} (${Math.round(f.confidence * 100)}%)`);
    });
  }

  if (result.keywords.length > 0) {
    console.log(`\nKeywords: ${result.keywords.join(', ')}`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  scanProject,
  extractFromPackageJson,
  extractFromReadme,
  inferProjectType,
  inferFeatures,
  formatSummary
};

// Run if called directly
if (require.main === module) {
  main();
}
