#!/usr/bin/env node

/**
 * Integration Pass - Breaking changes, contract drift, dependency conflicts
 *
 * This is a conditional pass that runs when changes affect multiple files
 * or API boundaries. It checks for integration issues that might not be
 * caught by individual file analysis.
 *
 * Checks:
 * - API contract changes
 * - Breaking interface changes
 * - Import/export mismatches
 * - Dependency conflicts
 * - Type compatibility
 * - Cross-module state sharing issues
 */

const path = require('path');
const { readFile, PATHS, getConfig } = require('../flow-utils');

/**
 * API contract patterns
 */
const API_CONTRACT_PATTERNS = [
  {
    // Function signature change detection
    pattern: /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    extract: (match) => ({
      name: match[1],
      params: match[2].split(',').map(p => p.trim()).filter(Boolean)
    }),
    type: 'function-export'
  },
  {
    // Interface definition
    pattern: /export\s+interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?\s*\{([^}]*)\}/g,
    extract: (match) => ({
      name: match[1],
      fields: match[2].split(/[;\n]/).map(f => f.trim()).filter(Boolean)
    }),
    type: 'interface-export'
  },
  {
    // Type definition
    pattern: /export\s+type\s+(\w+)\s*=\s*([^;]+)/g,
    extract: (match) => ({
      name: match[1],
      definition: match[2].trim()
    }),
    type: 'type-export'
  },
  {
    // Class export with methods
    pattern: /export\s+class\s+(\w+)/g,
    extract: (match) => ({
      name: match[1],
      type: 'class'
    }),
    type: 'class-export'
  }
];

/**
 * Breaking change indicators
 */
const BREAKING_CHANGE_PATTERNS = [
  {
    pattern: /(?:\/\/|\/\*)\s*(?:BREAKING|DEPRECATED|TODO:\s*remove)/gi,
    severity: 'high',
    message: 'Breaking change comment found - verify downstream impact',
    type: 'breaking-comment'
  },
  {
    // Optional parameter made required
    pattern: /(\w+)\?\s*:\s*\w+\s+→\s+\1\s*:\s*\w+/g,
    severity: 'high',
    message: 'Optional parameter may have become required',
    type: 'signature-change'
  },
  {
    // Return type change
    pattern: /:\s*(?:void|null)\s+→\s+:\s*(?!void|null)\w+|:\s*(?!void|null)\w+\s+→\s+:\s*(?:void|null)/g,
    severity: 'high',
    message: 'Return type change detected',
    type: 'return-change'
  }
];

/**
 * Import/export mismatch patterns
 */
const IMPORT_EXPORT_PATTERNS = [
  {
    pattern: /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    type: 'named-import'
  },
  {
    pattern: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    type: 'default-import'
  },
  {
    pattern: /export\s+\{([^}]+)\}/g,
    type: 'named-export'
  },
  {
    pattern: /export\s+default\s+/g,
    type: 'default-export'
  }
];

/**
 * Cross-module patterns to check
 */
const CROSS_MODULE_PATTERNS = [
  {
    pattern: /global\.\w+\s*=/g,
    severity: 'high',
    message: 'Global state mutation - may cause cross-module side effects',
    type: 'global-state'
  },
  {
    pattern: /window\.\w+\s*=/g,
    severity: 'medium',
    message: 'Window object mutation - potential cross-module conflict',
    type: 'global-state'
  },
  {
    pattern: /process\.env\.\w+\s*=/g,
    severity: 'high',
    message: 'Environment variable mutation at runtime - affects all modules',
    type: 'env-mutation'
  },
  {
    pattern: /let\s+\w+\s*=[^;]+;\s*export\s+/g,
    severity: 'medium',
    message: 'Mutable exported variable - importers may see unexpected changes',
    type: 'mutable-export'
  }
];

/**
 * Extract exports from a file
 * @param {string} content - File content
 * @returns {Object[]} Array of export definitions
 */
function extractExports(content) {
  const exports = [];

  for (const patternDef of API_CONTRACT_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      exports.push({
        ...patternDef.extract(match),
        type: patternDef.type,
        position: match.index
      });
    }
  }

  return exports;
}

/**
 * Extract imports from a file
 * @param {string} content - File content
 * @returns {Object[]} Array of import definitions
 */
function extractImports(content) {
  const imports = [];

  // Named imports
  const namedPattern = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedPattern.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      return {
        original: parts[0].trim(),
        alias: parts[1]?.trim() || parts[0].trim()
      };
    });
    imports.push({
      type: 'named',
      names,
      source: match[2]
    });
  }

  // Default imports
  const defaultPattern = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultPattern.exec(content)) !== null) {
    imports.push({
      type: 'default',
      name: match[1],
      source: match[2]
    });
  }

  return imports;
}

/**
 * Check for integration issues between files
 * @param {Object[]} files - Array of file objects
 * @returns {Object[]} Array of integration issues
 */
function checkCrossFileIntegration(files) {
  const issues = [];
  const exportMap = new Map(); // path -> exports
  const importMap = new Map(); // path -> imports

  // Build export and import maps
  for (const file of files) {
    const content = file.content || '';
    exportMap.set(file.path, extractExports(content));
    importMap.set(file.path, extractImports(content));
  }

  // Check for import/export mismatches within the changed files
  const projectRoot = process.cwd();

  for (const [filePath, imports] of importMap.entries()) {
    for (const imp of imports) {
      // Only check relative imports (local files)
      if (!imp.source.startsWith('.')) continue;

      // Resolve import path
      const dir = path.dirname(filePath);
      const resolvedPath = path.resolve(dir, imp.source);

      // SECURITY: Validate resolved path stays within project root
      // Prevents path traversal attacks via malicious relative imports
      if (!resolvedPath.startsWith(projectRoot)) {
        issues.push({
          severity: 'high',
          message: `Suspicious import path "${imp.source}" resolves outside project`,
          file: filePath,
          type: 'path-traversal',
          resolvedPath
        });
        continue;
      }

      // Find matching export file
      const exportFile = files.find(f =>
        f.path.startsWith(resolvedPath) ||
        f.path === resolvedPath + '.ts' ||
        f.path === resolvedPath + '.js' ||
        f.path === resolvedPath + '/index.ts' ||
        f.path === resolvedPath + '/index.js'
      );

      if (exportFile) {
        const fileExports = exportMap.get(exportFile.path) || [];

        if (imp.type === 'named') {
          // Check each named import exists
          for (const { original } of imp.names) {
            const exportExists = fileExports.some(e =>
              e.name === original ||
              (exportFile.content || '').includes(`export { ${original}`) ||
              (exportFile.content || '').includes(`export const ${original}`) ||
              (exportFile.content || '').includes(`export function ${original}`) ||
              (exportFile.content || '').includes(`export class ${original}`)
            );

            if (!exportExists) {
              issues.push({
                severity: 'high',
                message: `Import "${original}" may not exist in "${imp.source}"`,
                file: filePath,
                type: 'import-mismatch',
                relatedFile: exportFile.path
              });
            }
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Check for breaking changes
 * @param {Object} file - File object
 * @returns {Object[]} Array of issues
 */
function checkBreakingChanges(file) {
  const issues = [];
  const content = file.content || '';

  // Check for breaking change comments/patterns
  for (const patternDef of BREAKING_CHANGE_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;

      issues.push({
        severity: patternDef.severity,
        message: patternDef.message,
        file: file.path,
        line: lineNumber,
        type: patternDef.type
      });
    }
  }

  return issues;
}

/**
 * Check for cross-module issues
 * @param {Object} file - File object
 * @returns {Object[]} Array of issues
 */
function checkCrossModuleIssues(file) {
  const issues = [];
  const content = file.content || '';

  for (const patternDef of CROSS_MODULE_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;

      issues.push({
        severity: patternDef.severity,
        message: patternDef.message,
        file: file.path,
        line: lineNumber,
        type: patternDef.type,
        snippet: match[0].substring(0, 40)
      });
    }
  }

  return issues;
}

/**
 * Check for disconnected modules (files that export but aren't imported anywhere)
 * @param {Object[]} files - Array of file objects
 * @param {Object} context - Review context with project files
 * @returns {Object[]} Array of disconnected module warnings
 */
function checkDisconnectedModules(files, context = {}) {
  const issues = [];

  // Build a map of all exports in the changed files
  const newExports = new Map();
  for (const file of files) {
    const content = file.content || '';
    const exports = extractExports(content);

    // Check if this file has module.exports or export statements
    const hasExports = exports.length > 0 ||
      content.includes('module.exports') ||
      content.includes('export default') ||
      /export\s+{/.test(content) ||
      /export\s+const\s+/.test(content);

    if (hasExports) {
      newExports.set(file.path, { exports, hasExports });
    }
  }

  // Now check which new export files are actually imported somewhere
  const importedFiles = new Set();

  for (const file of files) {
    const content = file.content || '';
    const imports = extractImports(content);

    for (const imp of imports) {
      // Mark relative imports as "imported"
      if (imp.source.startsWith('.') || imp.source.startsWith('/')) {
        // Normalize the import path
        const resolvedImport = imp.source.replace(/^\.\//, '').replace(/\.(js|ts|jsx|tsx)$/, '');
        importedFiles.add(resolvedImport);

        // Also add variations
        importedFiles.add(imp.source);
        importedFiles.add(imp.source + '.js');
        importedFiles.add(imp.source + '.ts');
        importedFiles.add(imp.source + '/index');
        importedFiles.add(imp.source + '/index.js');
        importedFiles.add(imp.source + '/index.ts');
      }
    }
  }

  // Check which exported files aren't imported by anything in the changed set
  for (const [filePath] of newExports) {
    const fileName = filePath.replace(/\.(js|ts|jsx|tsx)$/, '');
    const baseName = filePath.split('/').pop()?.replace(/\.(js|ts|jsx|tsx)$/, '');

    // Check if any import references this file
    const isImported = Array.from(importedFiles).some(imp =>
      imp.includes(baseName) ||
      fileName.endsWith(imp) ||
      imp.endsWith(fileName)
    );

    // Also check if it's a CLI entry point (has main check)
    const content = files.find(f => f.path === filePath)?.content || '';
    const isCLI = content.includes('require.main === module') ||
                  content.includes('#!/usr/bin/env node');

    if (!isImported && !isCLI) {
      issues.push({
        severity: 'medium',
        message: `New module "${filePath}" has exports but isn't imported anywhere in the changed files`,
        file: filePath,
        type: 'disconnected-module',
        suggestion: 'Ensure this module is imported/wired into the application. If it\'s a CLI tool, add require.main check.'
      });
    }
  }

  return issues;
}

/**
 * Analyze dependency graph complexity
 * @param {Object[]} files - Array of file objects
 * @returns {Object} Analysis results
 */
function analyzeDependencyGraph(files) {
  const graph = new Map(); // file -> [dependencies]
  const reverseGraph = new Map(); // file -> [dependents]

  // Build graphs
  for (const file of files) {
    const imports = extractImports(file.content || '');
    const deps = imports
      .filter(i => i.source.startsWith('.'))
      .map(i => i.source);

    graph.set(file.path, deps);

    // Build reverse graph
    for (const dep of deps) {
      if (!reverseGraph.has(dep)) {
        reverseGraph.set(dep, []);
      }
      reverseGraph.get(dep).push(file.path);
    }
  }

  // Find high-impact files (many dependents)
  const highImpact = [];
  for (const [file, dependents] of reverseGraph.entries()) {
    if (dependents.length >= 5) {
      highImpact.push({ file, dependentCount: dependents.length });
    }
  }

  // Find circular dependency hints
  const visited = new Set();
  const circularHints = [];
  const MAX_DEPTH = 50; // Prevent stack overflow on deep dependency chains

  function detectCircular(file, stack = [], depth = 0) {
    // Depth limit to prevent stack overflow
    if (depth > MAX_DEPTH) return;

    if (stack.includes(file)) {
      circularHints.push([...stack, file]);
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    const deps = graph.get(file) || [];
    for (const dep of deps) {
      detectCircular(dep, [...stack, file], depth + 1);
    }
  }

  for (const file of files) {
    detectCircular(file.path);
  }

  return {
    totalFiles: files.length,
    highImpactFiles: highImpact,
    potentialCircular: circularHints.slice(0, 5) // Limit to first 5
  };
}

/**
 * Run the integration pass
 * @param {Object} context - Review context
 * @returns {Promise<Object>} Pass results
 */
async function run(context) {
  const { files = [], previousResults = {} } = context;

  const issues = [];
  const suggestions = [];
  const filesToExamine = [];
  const metrics = {
    filesChecked: files.length,
    issuesByType: {},
    crossFileIssues: 0,
    highImpactFiles: 0
  };

  // Check each file for individual issues
  for (const file of files) {
    // Breaking change detection
    const breakingIssues = checkBreakingChanges(file);
    for (const issue of breakingIssues) {
      issues.push(issue);
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
    }

    // Cross-module issues
    const crossModuleIssues = checkCrossModuleIssues(file);
    for (const issue of crossModuleIssues) {
      issues.push(issue);
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
    }

    // Mark files with issues for follow-up
    if (breakingIssues.length > 0 || crossModuleIssues.some(i => i.severity === 'high')) {
      filesToExamine.push(file.path);
    }
  }

  // Cross-file integration checks (only if multiple files)
  if (files.length >= 2) {
    const crossFileIssues = checkCrossFileIntegration(files);
    for (const issue of crossFileIssues) {
      issues.push(issue);
      metrics.crossFileIssues++;
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
    }
  }

  // Disconnected module check - catch modules that export but aren't imported
  const disconnectedIssues = checkDisconnectedModules(files, context);
  for (const issue of disconnectedIssues) {
    issues.push(issue);
    metrics.issuesByType['disconnected-module'] = (metrics.issuesByType['disconnected-module'] || 0) + 1;
    filesToExamine.push(issue.file);
  }

  // Dependency graph analysis
  const graphAnalysis = analyzeDependencyGraph(files);
  metrics.highImpactFiles = graphAnalysis.highImpactFiles.length;

  // Generate issues for high-impact files
  for (const { file, dependentCount } of graphAnalysis.highImpactFiles) {
    issues.push({
      severity: 'info',
      message: `High-impact file with ${dependentCount} dependents - changes here affect many files`,
      file,
      type: 'high-impact',
      dependentCount
    });
    filesToExamine.push(file);
  }

  // Generate circular dependency warnings
  if (graphAnalysis.potentialCircular.length > 0) {
    for (const cycle of graphAnalysis.potentialCircular) {
      issues.push({
        severity: 'high',
        message: `Potential circular dependency: ${cycle.join(' → ')}`,
        file: cycle[0],
        type: 'circular-dependency'
      });
    }
  }

  // Generate suggestions
  if (metrics.crossFileIssues > 0) {
    suggestions.push({
      message: 'Import/export mismatches detected - verify all imports resolve correctly',
      priority: 'high'
    });
  }

  if (metrics.highImpactFiles > 2) {
    suggestions.push({
      message: 'Multiple high-impact files changed - consider staged rollout',
      priority: 'medium'
    });
  }

  if (graphAnalysis.potentialCircular.length > 0) {
    suggestions.push({
      message: 'Circular dependencies detected - refactor to break cycles',
      priority: 'high'
    });
  }

  if (metrics.issuesByType['global-state'] > 0) {
    suggestions.push({
      message: 'Global state mutations detected - consider using proper state management',
      priority: 'medium'
    });
  }

  if (metrics.issuesByType['breaking-comment'] > 0) {
    suggestions.push({
      message: 'Breaking change comments found - ensure changelog is updated',
      priority: 'high'
    });
  }

  if (metrics.issuesByType['disconnected-module'] > 0) {
    suggestions.push({
      message: 'Disconnected modules detected - ensure new modules are imported/wired into the application',
      priority: 'high'
    });
  }

  return {
    issues,
    suggestions,
    filesToExamine: [...new Set(filesToExamine)],
    metrics,
    dependencyAnalysis: graphAnalysis
  };
}

module.exports = { run };
