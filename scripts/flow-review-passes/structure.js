#!/usr/bin/env node

/**
 * Structure Pass - File organization, naming, anti-patterns
 *
 * This is a fast, lightweight pass that runs first.
 * Uses pattern matching and heuristics (no LLM call required for basic checks).
 * Can optionally call Haiku for more nuanced analysis.
 *
 * Checks:
 * - File naming conventions
 * - Directory structure
 * - Known anti-patterns from decisions.md
 * - Import organization
 * - Export patterns
 */

const path = require('path');
const { readFile, PATHS, getConfig } = require('../flow-utils');

/**
 * File naming patterns to check
 */
const NAMING_PATTERNS = {
  kebabCase: /^[a-z][a-z0-9-]*\.[a-z]+$/,
  camelCase: /^[a-z][a-zA-Z0-9]*\.[a-z]+$/,
  pascalCase: /^[A-Z][a-zA-Z0-9]*\.[a-z]+$/,
  snakeCase: /^[a-z][a-z0-9_]*\.[a-z]+$/
};

/**
 * Common structural anti-patterns
 */
const STRUCTURAL_ANTI_PATTERNS = [
  {
    pattern: /^(utils|helpers|misc|common|shared)\.([tj]sx?)$/i,
    severity: 'medium',
    message: 'Generic catch-all file detected - consider splitting by domain'
  },
  {
    pattern: /\.bak$/,
    severity: 'low',
    message: 'Backup file should be removed'
  },
  {
    pattern: /\.orig$/,
    severity: 'low',
    message: 'Merge artifact file should be removed'
  },
  {
    pattern: /copy(\d+)?\.([tj]sx?)$/i,
    severity: 'medium',
    message: 'File copy detected - should be properly named or removed'
  },
  {
    pattern: /^index\.(ts|js)x?$/,
    severity: 'info',
    message: 'Index file - ensure it only re-exports, no logic'
  }
];

/**
 * Content-based anti-patterns
 */
const CONTENT_ANTI_PATTERNS = [
  {
    pattern: /console\.(log|debug|info)\(/g,
    severity: 'low',
    message: 'Console statement found - consider removing or using proper logging'
  },
  {
    pattern: /debugger;/g,
    severity: 'high',
    message: 'Debugger statement found - must be removed'
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/g,
    severity: 'info',
    message: 'TODO/FIXME comment found - consider addressing'
  },
  {
    pattern: /\/\/ @ts-ignore/g,
    severity: 'medium',
    message: '@ts-ignore found - type issue should be properly fixed'
  },
  {
    pattern: /\/\/ eslint-disable/g,
    severity: 'info',
    message: 'ESLint disable found - ensure it\'s necessary'
  },
  {
    pattern: /any\s*[;,)>]/g,
    severity: 'medium',
    message: 'Explicit "any" type found - consider using proper typing'
  }
];

/**
 * Import organization checks
 */
const IMPORT_PATTERNS = {
  // Relative imports going too deep
  deepRelative: /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\//g,
  // Mixed import styles
  mixedImports: /(require\(|from\s+['"]).*(require\(|from\s+['"])/s,
  // Circular import indicators
  circularIndicator: /\/\/.*circular/i
};

/**
 * Load project-specific patterns from decisions.md
 */
function loadProjectPatterns() {
  try {
    const decisions = readFile(PATHS.decisions, '');
    const patterns = [];

    // Extract anti-patterns marked in decisions.md
    // Format: - **Anti-pattern**: [pattern] - [reason]
    const antiPatternRegex = /\*\*Anti-pattern\*\*:\s*`?([^`\n]+)`?\s*-\s*(.+)/gi;
    let match;
    while ((match = antiPatternRegex.exec(decisions)) !== null) {
      patterns.push({
        pattern: new RegExp(match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        severity: 'medium',
        message: `Project anti-pattern: ${match[2]}`,
        source: 'decisions.md'
      });
    }

    return patterns;
  } catch {
    return [];
  }
}

/**
 * Check file naming convention
 * @param {string} filePath - Path to file
 * @param {string} expectedConvention - Expected naming convention
 * @returns {Object|null} Issue if naming doesn't match
 */
function checkNaming(filePath, expectedConvention = 'kebab-case') {
  const fileName = path.basename(filePath);

  // Skip common exceptions
  if (['README.md', 'CHANGELOG.md', 'LICENSE', 'Dockerfile'].includes(fileName)) {
    return null;
  }

  // Check against expected convention
  const conventionMap = {
    'kebab-case': NAMING_PATTERNS.kebabCase,
    'camelCase': NAMING_PATTERNS.camelCase,
    'PascalCase': NAMING_PATTERNS.pascalCase,
    'snake_case': NAMING_PATTERNS.snakeCase
  };

  const pattern = conventionMap[expectedConvention];
  if (pattern && !pattern.test(fileName)) {
    return {
      severity: 'low',
      message: `File "${fileName}" doesn't follow ${expectedConvention} convention`,
      file: filePath,
      type: 'naming'
    };
  }

  return null;
}

/**
 * Check file for structural anti-patterns
 * @param {Object} file - File object with path and content
 * @returns {Object[]} Array of issues
 */
function checkFileStructure(file) {
  const issues = [];
  const fileName = path.basename(file.path);
  const content = file.content || '';

  // Check file name patterns
  for (const antiPattern of STRUCTURAL_ANTI_PATTERNS) {
    if (antiPattern.pattern.test(fileName)) {
      issues.push({
        severity: antiPattern.severity,
        message: antiPattern.message,
        file: file.path,
        type: 'structural'
      });
    }
  }

  // Check content patterns
  for (const antiPattern of CONTENT_ANTI_PATTERNS) {
    const matches = content.match(antiPattern.pattern);
    if (matches && matches.length > 0) {
      issues.push({
        severity: antiPattern.severity,
        message: `${antiPattern.message} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`,
        file: file.path,
        type: 'content',
        count: matches.length
      });
    }
  }

  // Check import patterns
  if (IMPORT_PATTERNS.deepRelative.test(content)) {
    issues.push({
      severity: 'medium',
      message: 'Deep relative import (4+ levels) - consider using path aliases',
      file: file.path,
      type: 'imports'
    });
  }

  if (IMPORT_PATTERNS.circularIndicator.test(content)) {
    issues.push({
      severity: 'high',
      message: 'Circular import comment found - indicates dependency issue',
      file: file.path,
      type: 'imports'
    });
  }

  return issues;
}

/**
 * Check directory structure
 * @param {Object[]} files - Array of file objects
 * @returns {Object[]} Array of issues
 */
function checkDirectoryStructure(files) {
  const issues = [];
  const dirs = new Map();

  // Group files by directory
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (!dirs.has(dir)) {
      dirs.set(dir, []);
    }
    dirs.get(dir).push(file);
  }

  // Check for issues
  for (const [dir, dirFiles] of dirs.entries()) {
    // Too many files in one directory
    if (dirFiles.length > 15) {
      issues.push({
        severity: 'info',
        message: `Directory has ${dirFiles.length} files - consider subdirectories`,
        file: dir,
        type: 'directory'
      });
    }

    // Mixed file types (components + services + utils)
    const types = new Set(dirFiles.map(f => {
      const name = path.basename(f.path).toLowerCase();
      if (name.includes('component') || name.includes('.tsx')) return 'component';
      if (name.includes('service')) return 'service';
      if (name.includes('util') || name.includes('helper')) return 'util';
      if (name.includes('hook') || name.startsWith('use')) return 'hook';
      if (name.includes('.test.') || name.includes('.spec.')) return 'test';
      return 'other';
    }));

    if (types.size >= 4 && !dir.includes('src/') && !dir.includes('lib/')) {
      issues.push({
        severity: 'low',
        message: 'Directory mixes multiple concerns - consider splitting',
        file: dir,
        type: 'directory'
      });
    }
  }

  return issues;
}

/**
 * Run the structure pass
 * @param {Object} context - Review context
 * @returns {Promise<Object>} Pass results
 */
async function run(context) {
  const { files = [], previousResults = {} } = context;
  const config = getConfig();
  const namingConvention = config.componentRules?.namingConvention || 'kebab-case';

  const issues = [];
  const suggestions = [];
  const filesToExamine = [];
  const metrics = {
    filesChecked: 0,
    issuesByType: {}
  };

  // Load project-specific patterns
  const projectPatterns = loadProjectPatterns();
  const allContentPatterns = [...CONTENT_ANTI_PATTERNS, ...projectPatterns];

  // Check each file
  for (const file of files) {
    metrics.filesChecked++;

    // Naming check
    const namingIssue = checkNaming(file.path, namingConvention);
    if (namingIssue) {
      issues.push(namingIssue);
      metrics.issuesByType.naming = (metrics.issuesByType.naming || 0) + 1;
    }

    // Structural check
    const structuralIssues = checkFileStructure(file);
    for (const issue of structuralIssues) {
      issues.push(issue);
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
    }

    // Project-specific pattern check
    for (const antiPattern of projectPatterns) {
      const matches = (file.content || '').match(antiPattern.pattern);
      if (matches && matches.length > 0) {
        issues.push({
          severity: antiPattern.severity,
          message: antiPattern.message,
          file: file.path,
          type: 'project-pattern',
          source: antiPattern.source
        });
      }
    }

    // Mark files with issues for deeper review in next pass
    if (structuralIssues.some(i => i.severity === 'high' || i.severity === 'medium')) {
      filesToExamine.push(file.path);
    }
  }

  // Directory structure check
  const dirIssues = checkDirectoryStructure(files);
  issues.push(...dirIssues);

  // Generate suggestions based on issues
  if (metrics.issuesByType.naming > 3) {
    suggestions.push({
      message: 'Multiple naming convention violations - consider running a bulk rename',
      priority: 'medium'
    });
  }

  if (metrics.issuesByType.content > 5) {
    suggestions.push({
      message: 'Many content anti-patterns - consider running linter with auto-fix',
      priority: 'high'
    });
  }

  if (issues.filter(i => i.type === 'imports').length > 2) {
    suggestions.push({
      message: 'Import structure issues - consider setting up path aliases',
      priority: 'medium'
    });
  }

  return {
    issues,
    suggestions,
    filesToExamine,
    metrics
  };
}

module.exports = { run };
