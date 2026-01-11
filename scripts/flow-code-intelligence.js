#!/usr/bin/env node

/**
 * Wogi Flow - Code Intelligence (Priority 5: Better Code Understanding)
 *
 * Enhanced code analysis with:
 * - Import/export relationship mapping
 * - Type dependencies
 * - Function call graphs
 * - Semantic code search
 *
 * Uses semantic code analysis for better understanding.
 *
 * Usage:
 *   const { analyzeRelationships, findRelatedCode } = require('./flow-code-intelligence');
 *   const relationships = await analyzeRelationships('src/components/Button.tsx');
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, PATHS, colors } = require('./flow-utils');
const { safeGrep, safeFind, escapeRegex } = require('./flow-security');

const PROJECT_ROOT = getProjectRoot();

// ============================================================
// Relationship Analysis
// ============================================================

/**
 * Analyze import/export relationships for a file
 *
 * @param {string} filePath - Path to the file to analyze
 * @returns {object} Relationships object
 */
function analyzeRelationships(filePath) {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);

  if (!fs.existsSync(fullPath)) {
    return { error: 'File not found' };
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const relPath = path.relative(PROJECT_ROOT, fullPath);

  const relationships = {
    file: relPath,
    analyzedAt: new Date().toISOString(),
    imports: extractImports(content, path.dirname(fullPath)),
    exports: extractExports(content),
    dependencies: {
      internal: [],
      external: []
    },
    dependents: [],
    types: extractTypeUsage(content),
    functions: extractFunctions(content)
  };

  // Categorize imports
  for (const imp of relationships.imports) {
    if (imp.source.startsWith('.') || imp.source.startsWith('@/')) {
      relationships.dependencies.internal.push(imp);
    } else {
      relationships.dependencies.external.push(imp);
    }
  }

  return relationships;
}

/**
 * Extract imports from file content
 */
function extractImports(content, fileDir) {
  const imports = [];

  // ES6 imports
  const importRegex = /import\s+(?:(\{[^}]+\})|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const namedImports = match[1] || match[3];
    const defaultImport = match[2];
    const source = match[4];

    const imp = {
      source,
      default: defaultImport || null,
      named: []
    };

    if (namedImports) {
      imp.named = namedImports
        .replace(/[{}]/g, '')
        .split(',')
        .map(s => s.trim().split(' as ')[0].trim())
        .filter(Boolean);
    }

    imports.push(imp);
  }

  // Side-effect imports
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      sideEffect: true
    });
  }

  // Dynamic imports
  const dynamicRegex = /import\(['"]([^'"]+)['"]\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      dynamic: true
    });
  }

  return imports;
}

/**
 * Extract exports from file content
 */
function extractExports(content) {
  const exports = {
    default: null,
    named: [],
    types: []
  };

  // Default export
  const defaultMatch = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  if (defaultMatch) {
    exports.default = defaultMatch[1];
  }

  // Named exports
  const namedRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
  let match;
  while ((match = namedRegex.exec(content)) !== null) {
    if (!exports.named.includes(match[1])) {
      exports.named.push(match[1]);
    }
  }

  // Export block
  const blockRegex = /export\s+\{([^}]+)\}/g;
  while ((match = blockRegex.exec(content)) !== null) {
    const items = match[1].split(',').map(s => s.trim().split(' as ')[0].trim());
    for (const item of items) {
      if (item && !exports.named.includes(item)) {
        exports.named.push(item);
      }
    }
  }

  // Type exports
  const typeRegex = /export\s+(?:type|interface)\s+(\w+)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exports.types.push(match[1]);
  }

  return exports;
}

/**
 * Extract type usage from file content
 */
function extractTypeUsage(content) {
  const types = {
    interfaces: [],
    types: [],
    generics: []
  };

  // Interface definitions
  const interfaceRegex = /interface\s+(\w+)(?:<([^>]+)>)?/g;
  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    types.interfaces.push({
      name: match[1],
      generics: match[2] ? match[2].split(',').map(s => s.trim()) : []
    });
  }

  // Type definitions
  const typeRegex = /type\s+(\w+)(?:<([^>]+)>)?\s*=/g;
  while ((match = typeRegex.exec(content)) !== null) {
    types.types.push({
      name: match[1],
      generics: match[2] ? match[2].split(',').map(s => s.trim()) : []
    });
  }

  // Generic usage
  const genericRegex = /:\s*(\w+)<([^>]+)>/g;
  while ((match = genericRegex.exec(content)) !== null) {
    types.generics.push({
      type: match[1],
      params: match[2].split(',').map(s => s.trim())
    });
  }

  return types;
}

/**
 * Extract function definitions
 */
function extractFunctions(content) {
  const functions = [];

  // Regular functions
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: match[2].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean),
      async: content.slice(match.index - 10, match.index).includes('async')
    });
  }

  // Arrow functions (const/let)
  const arrowRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    functions.push({
      name: match[1],
      type: 'arrow',
      async: content.slice(match.index, match.index + 100).includes('async')
    });
  }

  return functions.slice(0, 20); // Limit to 20
}

// ============================================================
// Dependency Graph
// ============================================================

/**
 * Build dependency graph for a set of files
 *
 * @param {string[]} filePaths - Files to analyze
 * @returns {object} Dependency graph
 */
function buildDependencyGraph(filePaths) {
  const graph = {
    nodes: [],
    edges: [],
    clusters: {}
  };

  const nodeMap = new Map();

  for (const filePath of filePaths) {
    const relationships = analyzeRelationships(filePath);
    if (relationships.error) continue;

    const nodeId = relationships.file;

    // Add node
    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        id: nodeId,
        exports: relationships.exports,
        category: categorizeFile(nodeId)
      });
      graph.nodes.push(nodeMap.get(nodeId));
    }

    // Add edges for internal dependencies
    for (const dep of relationships.dependencies.internal) {
      const resolvedPath = resolveImportPath(dep.source, path.dirname(filePath));
      if (resolvedPath) {
        graph.edges.push({
          from: nodeId,
          to: resolvedPath,
          type: 'import',
          imports: [...(dep.named || []), dep.default].filter(Boolean)
        });
      }
    }
  }

  // Group into clusters
  for (const node of graph.nodes) {
    const category = node.category;
    if (!graph.clusters[category]) {
      graph.clusters[category] = [];
    }
    graph.clusters[category].push(node.id);
  }

  return graph;
}

/**
 * Categorize file based on path
 */
function categorizeFile(filePath) {
  const lower = filePath.toLowerCase();

  if (lower.includes('/components/')) return 'components';
  if (lower.includes('/hooks/') || lower.match(/\/use\w+\./)) return 'hooks';
  if (lower.includes('/services/')) return 'services';
  if (lower.includes('/pages/') || lower.includes('/app/')) return 'pages';
  if (lower.includes('/api/')) return 'api';
  if (lower.includes('/utils/') || lower.includes('/lib/')) return 'utils';
  if (lower.includes('/types/')) return 'types';

  return 'other';
}

/**
 * Resolve import path to actual file
 */
function resolveImportPath(importSource, fromDir) {
  if (!importSource.startsWith('.')) {
    // Handle alias imports like @/
    if (importSource.startsWith('@/')) {
      importSource = importSource.replace('@/', 'src/');
    } else {
      return null; // External package
    }
  }

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

  for (const ext of extensions) {
    const candidate = path.join(fromDir, importSource + ext);
    const relPath = path.relative(PROJECT_ROOT, candidate);

    if (fs.existsSync(path.join(PROJECT_ROOT, relPath))) {
      return relPath;
    }
  }

  return null;
}

// ============================================================
// Related Code Search
// ============================================================

/**
 * Find code related to a given file or function
 *
 * @param {string} query - File path, function name, or keyword
 * @param {object} options - Search options
 */
async function findRelatedCode(query, options = {}) {
  const results = {
    query,
    timestamp: new Date().toISOString(),
    directDependencies: [],
    reverseDependencies: [],
    similarFiles: [],
    relatedFunctions: []
  };

  // If query is a file path, analyze its relationships
  if (query.includes('/') || query.includes('.')) {
    const relationships = analyzeRelationships(query);
    if (!relationships.error) {
      results.directDependencies = relationships.dependencies.internal
        .map(d => d.source)
        .slice(0, 10);

      // Find files that import this file
      results.reverseDependencies = await findFilesImporting(query);
    }
  }

  // Search for keyword in codebase
  results.similarFiles = await searchCodebase(query, options.maxResults || 10);

  return results;
}

/**
 * Find files that import a given file
 */
async function findFilesImporting(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));

  // Use safe grep with escaped pattern to prevent injection
  const pattern = `from.*${escapeRegex(basename)}`;
  return safeGrep(pattern, {
    cwd: PROJECT_ROOT,
    searchDir: 'src/',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    maxResults: 20
  });
}

/**
 * Search codebase for keyword
 */
async function searchCodebase(keyword, maxResults = 10) {
  // Use safe grep with escaped pattern to prevent injection
  return safeGrep(keyword, {
    cwd: PROJECT_ROOT,
    searchDir: 'src/',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    maxResults
  });
}

// ============================================================
// Enhanced Component Index
// ============================================================

/**
 * Generate enhanced component index with relationships
 */
async function generateEnhancedIndex() {
  const config = getConfig();
  const indexPath = path.join(PATHS.state, 'component-index.json');

  // Read existing index
  let existingIndex = { components: [] };
  if (fs.existsSync(indexPath)) {
    try {
      existingIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      // Ignore
    }
  }

  // Enhance with relationships
  const enhanced = {
    ...existingIndex,
    lastEnhanced: new Date().toISOString(),
    relationships: {},
    dependencyGraph: {
      nodes: [],
      edges: []
    }
  };

  // Analyze relationships for each component
  const allComponents = [
    ...(existingIndex.components || []),
    ...(existingIndex.hooks || []),
    ...(existingIndex.services || []),
    ...(existingIndex.pages || [])
  ];

  const filePaths = allComponents.map(c => c.path).filter(Boolean);

  // Build dependency graph
  const graph = buildDependencyGraph(filePaths);
  enhanced.dependencyGraph = graph;

  // Add individual relationship data
  for (const comp of allComponents.slice(0, 50)) { // Limit to 50 for performance
    if (comp.path) {
      const rel = analyzeRelationships(comp.path);
      if (!rel.error) {
        enhanced.relationships[comp.path] = {
          imports: rel.dependencies.internal.map(d => d.source),
          exports: rel.exports.named,
          types: rel.types.interfaces.concat(rel.types.types).map(t => t.name)
        };
      }
    }
  }

  // Save enhanced index
  fs.writeFileSync(indexPath, JSON.stringify(enhanced, null, 2), 'utf-8');

  return enhanced;
}

/**
 * Get smart context for a task based on code intelligence
 *
 * @param {string} taskDescription - Task description
 * @param {object} options - Options
 */
async function getSmartContext(taskDescription, options = {}) {
  const config = getConfig();
  const indexPath = path.join(PATHS.state, 'component-index.json');

  if (!fs.existsSync(indexPath)) {
    return { files: [], reason: 'No component index' };
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const desc = taskDescription.toLowerCase();

  const relevantFiles = [];
  const seen = new Set();

  // 1. Direct keyword matches
  const allComponents = [
    ...(index.components || []),
    ...(index.hooks || []),
    ...(index.services || []),
    ...(index.pages || [])
  ];

  for (const comp of allComponents) {
    const name = (comp.name || '').toLowerCase();
    const filePath = (comp.path || '').toLowerCase();

    // Check if any word in description matches component
    const words = desc.split(/\s+/).filter(w => w.length > 3);
    for (const word of words) {
      if (name.includes(word) || filePath.includes(word)) {
        if (!seen.has(comp.path)) {
          relevantFiles.push({
            path: comp.path,
            reason: `keyword match: "${word}"`,
            score: 3
          });
          seen.add(comp.path);
        }
        break;
      }
    }
  }

  // 2. Follow relationships for matched files
  if (index.relationships && relevantFiles.length > 0) {
    for (const file of relevantFiles.slice(0, 5)) {
      const rel = index.relationships[file.path];
      if (rel?.imports) {
        for (const imp of rel.imports.slice(0, 3)) {
          // Resolve import to actual path
          const resolved = resolveImportPath(imp, path.dirname(file.path));
          if (resolved && !seen.has(resolved)) {
            relevantFiles.push({
              path: resolved,
              reason: `imported by ${file.path}`,
              score: 2
            });
            seen.add(resolved);
          }
        }
      }
    }
  }

  // Sort by score
  relevantFiles.sort((a, b) => b.score - a.score);

  return {
    files: relevantFiles.slice(0, options.maxFiles || 10),
    totalMatches: relevantFiles.length
  };
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Code Intelligence

Enhanced code analysis with relationships and semantic search.

Usage:
  flow code-intel analyze <file>
  flow code-intel graph [directory]
  flow code-intel related <query>
  flow code-intel enhance

Commands:
  analyze    Analyze relationships for a file
  graph      Build dependency graph
  related    Find related code
  enhance    Enhance component index with relationships

Options:
  --json     Output as JSON
  --help     Show this help

Examples:
  flow code-intel analyze src/components/Button.tsx
  flow code-intel related "authentication"
  flow code-intel enhance
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const target = args[1];
  const jsonOutput = args.includes('--json');

  switch (command) {
    case 'analyze': {
      if (!target) {
        console.log(`${colors.red}Error: File path required${colors.reset}`);
        process.exit(1);
      }

      const relationships = analyzeRelationships(target);

      if (jsonOutput) {
        console.log(JSON.stringify(relationships, null, 2));
      } else {
        console.log(`\n${colors.cyan}File: ${relationships.file}${colors.reset}\n`);

        console.log(`${colors.bold}Imports:${colors.reset}`);
        for (const imp of relationships.imports.slice(0, 10)) {
          console.log(`  ${imp.source}`);
          if (imp.named?.length > 0) {
            console.log(`    → ${imp.named.join(', ')}`);
          }
        }

        console.log(`\n${colors.bold}Exports:${colors.reset}`);
        if (relationships.exports.default) {
          console.log(`  default: ${relationships.exports.default}`);
        }
        if (relationships.exports.named.length > 0) {
          console.log(`  named: ${relationships.exports.named.join(', ')}`);
        }

        console.log(`\n${colors.bold}Functions:${colors.reset}`);
        for (const func of relationships.functions.slice(0, 10)) {
          console.log(`  ${func.async ? 'async ' : ''}${func.name}()`);
        }
      }
      break;
    }

    case 'graph': {
      const dir = target || 'src';

      // Use safe find to prevent command injection
      const files = safeFind(dir, {
        cwd: PROJECT_ROOT,
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        maxResults: 100
      });

      if (files.length === 0) {
        console.log(`${colors.red}Error scanning directory or no files found${colors.reset}`);
        process.exit(1);
      }

      const graph = buildDependencyGraph(files);

      if (jsonOutput) {
        console.log(JSON.stringify(graph, null, 2));
      } else {
        console.log(`\n${colors.cyan}Dependency Graph${colors.reset}\n`);
        console.log(`Nodes: ${graph.nodes.length}`);
        console.log(`Edges: ${graph.edges.length}`);

        console.log(`\n${colors.bold}Clusters:${colors.reset}`);
        for (const [category, items] of Object.entries(graph.clusters)) {
          console.log(`  ${category}: ${items.length} files`);
        }
      }
      break;
    }

    case 'related': {
      if (!target) {
        console.log(`${colors.red}Error: Query required${colors.reset}`);
        process.exit(1);
      }

      const results = await findRelatedCode(target);

      if (jsonOutput) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`\n${colors.cyan}Related to: ${target}${colors.reset}\n`);

        if (results.directDependencies.length > 0) {
          console.log(`${colors.bold}Direct Dependencies:${colors.reset}`);
          for (const dep of results.directDependencies) {
            console.log(`  → ${dep}`);
          }
        }

        if (results.reverseDependencies.length > 0) {
          console.log(`\n${colors.bold}Imported By:${colors.reset}`);
          for (const dep of results.reverseDependencies) {
            console.log(`  ← ${dep}`);
          }
        }

        if (results.similarFiles.length > 0) {
          console.log(`\n${colors.bold}Similar Files:${colors.reset}`);
          for (const file of results.similarFiles) {
            console.log(`  • ${file}`);
          }
        }
      }
      break;
    }

    case 'enhance': {
      console.log(`${colors.cyan}Enhancing component index with relationships...${colors.reset}\n`);
      const enhanced = await generateEnhancedIndex();

      if (jsonOutput) {
        console.log(JSON.stringify(enhanced, null, 2));
      } else {
        console.log(`${colors.green}✓ Enhanced index generated${colors.reset}`);
        console.log(`  Nodes: ${enhanced.dependencyGraph.nodes.length}`);
        console.log(`  Edges: ${enhanced.dependencyGraph.edges.length}`);
        console.log(`  Relationships: ${Object.keys(enhanced.relationships || {}).length}`);
      }
      break;
    }

    default:
      console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  analyzeRelationships,
  extractImports,
  extractExports,
  extractTypeUsage,
  extractFunctions,
  buildDependencyGraph,
  findRelatedCode,
  findFilesImporting,
  searchCodebase,
  generateEnhancedIndex,
  getSmartContext,
  categorizeFile,
  resolveImportPath
};

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
