#!/usr/bin/env node

/**
 * Wogi Flow - Operational Standards Scanner
 *
 * Detects operational standards from a project:
 * - Package manager (npm, yarn, pnpm, bun)
 * - Dev server configuration (ports, host)
 * - Scripts from package.json
 * - Environment variable patterns
 * - API route patterns and naming conventions
 * - Git workflow patterns (branch naming, commit format)
 *
 * Usage:
 *   node flow-operational-scanner.js [project-root]
 *   node flow-operational-scanner.js --analyze
 *   node flow-operational-scanner.js --json
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, safeJsonParse, colors, outputJson } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

// Maximum file results to prevent memory issues on large codebases
const MAX_FILE_RESULTS = 1000;

// Maximum config file size for regex matching (prevent ReDoS)
const MAX_CONFIG_FILE_SIZE = 100 * 1024; // 100KB

const LOCKFILE_TO_MANAGER = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun'
};

const CONFIG_FILES_FOR_PORT = [
  { file: 'vite.config.ts', pattern: /server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s },
  { file: 'vite.config.js', pattern: /server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s },
  { file: 'vite.config.mjs', pattern: /server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s },
  { file: 'next.config.js', pattern: /port\s*:\s*(\d+)/ },
  { file: 'next.config.mjs', pattern: /port\s*:\s*(\d+)/ },
  { file: 'nuxt.config.ts', pattern: /port\s*:\s*(\d+)/ },
  { file: 'angular.json', pattern: /"port"\s*:\s*(\d+)/ },
  { file: 'webpack.config.js', pattern: /port\s*:\s*(\d+)/ },
  { file: '.env', pattern: /^PORT=(\d+)/m },
  { file: '.env.local', pattern: /^PORT=(\d+)/m },
  { file: '.env.development', pattern: /^PORT=(\d+)/m }
];

const API_ROUTE_DIRS = [
  'src/app/api',      // Next.js App Router
  'pages/api',        // Next.js Pages Router
  'src/pages/api',    // Next.js Pages Router (src)
  'src/routes/api',   // SvelteKit
  'routes/api',       // Remix
  'src/api',          // Generic
  'api'               // Root api folder
];

// ============================================================
// Package Manager Detection
// ============================================================

/**
 * Detect package manager from lockfiles and package.json
 */
function detectPackageManager(projectRoot) {
  const result = {
    tool: null,
    version: null,
    source: null,
    command: null
  };

  // Check for lockfiles (most reliable)
  for (const [lockfile, manager] of Object.entries(LOCKFILE_TO_MANAGER)) {
    const lockPath = path.join(projectRoot, lockfile);
    if (fs.existsSync(lockPath)) {
      result.tool = manager;
      result.source = lockfile;
      break;
    }
  }

  // Check package.json for packageManager field (newer standard)
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    // Use safeJsonParse for prototype pollution protection
    const pkg = safeJsonParse(pkgPath, null);
    if (pkg) {
      // packageManager field (e.g., "pnpm@8.15.0")
      if (pkg.packageManager) {
        const match = pkg.packageManager.match(/^(npm|yarn|pnpm|bun)@([\d.]+)/);
        if (match) {
          result.tool = result.tool || match[1];
          result.version = match[2];
          if (!result.source) result.source = 'package.json#packageManager';
        }
      }

      // engines.npm/yarn/pnpm
      if (pkg.engines) {
        for (const manager of ['pnpm', 'yarn', 'npm']) {
          if (pkg.engines[manager] && !result.version) {
            result.version = pkg.engines[manager].replace(/[^0-9.]/g, '');
          }
        }
      }
    }
  }

  // Default to npm if nothing found
  if (!result.tool) {
    result.tool = 'npm';
    result.source = 'default';
  }

  // Set the command prefix
  result.command = result.tool === 'npm' ? 'npm run' : result.tool;

  return result;
}

// ============================================================
// Dev Server Detection
// ============================================================

/**
 * Detect dev server port from config files
 */
function detectDevServer(projectRoot) {
  const result = {
    port: null,
    host: 'localhost',
    https: false,
    source: null
  };

  for (const { file, pattern } of CONFIG_FILES_FOR_PORT) {
    const filePath = path.join(projectRoot, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Skip overly large config files to prevent ReDoS attacks
      if (content.length > MAX_CONFIG_FILE_SIZE) continue;
      const match = content.match(pattern);
      if (match) {
        result.port = parseInt(match[1], 10);
        result.source = file;

        // Check for host configuration
        const hostMatch = content.match(/host\s*:\s*['"]([^'"]+)['"]/);
        if (hostMatch) result.host = hostMatch[1];

        // Check for HTTPS
        if (content.includes('https: true') || content.includes('https:true')) {
          result.https = true;
        }

        break;
      }
    } catch (err) {
      // Log read errors in debug mode for troubleshooting
      if (process.env.DEBUG) {
        console.error(`Debug: Failed to read ${filePath}: ${err.message}`);
      }
    }
  }

  // Check package.json scripts for port hints
  if (!result.port) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      // Use safeJsonParse for prototype pollution protection
      const pkg = safeJsonParse(pkgPath, null);
      if (pkg) {
        const devScript = pkg.scripts?.dev || pkg.scripts?.start || '';
        const portMatch = devScript.match(/--port[=\s]+(\d+)|PORT=(\d+)|-p\s*(\d+)/);
        if (portMatch) {
          // Find first non-undefined match group
          const portValue = portMatch[1] || portMatch[2] || portMatch[3];
          if (portValue) {
            result.port = parseInt(portValue, 10);
            result.source = 'package.json#scripts';
          }
        }
      }
    }
  }

  // Default port based on common frameworks if not detected
  if (!result.port) {
    result.port = 3000; // Most common default
    result.source = 'default';
  }

  return result;
}

// ============================================================
// Scripts Extraction
// ============================================================

/**
 * Extract all scripts from package.json
 */
function extractScripts(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};

  // Use safeJsonParse for prototype pollution protection
  const pkg = safeJsonParse(pkgPath, {});
  return pkg.scripts || {};
}

/**
 * Get normalized script commands with package manager prefix
 */
function getNormalizedScripts(projectRoot, packageManager) {
  const scripts = extractScripts(projectRoot);
  const prefix = packageManager.command;

  const normalized = {};
  const commonScripts = ['dev', 'build', 'start', 'test', 'lint', 'typecheck', 'format'];

  for (const name of commonScripts) {
    if (scripts[name]) {
      normalized[name] = packageManager.tool === 'npm'
        ? `npm run ${name}`
        : `${packageManager.tool} ${name}`;
    }
  }

  // Also include any custom scripts
  for (const [name, command] of Object.entries(scripts)) {
    if (!normalized[name]) {
      normalized[name] = packageManager.tool === 'npm'
        ? `npm run ${name}`
        : `${packageManager.tool} ${name}`;
    }
  }

  return normalized;
}

// ============================================================
// Environment Variables Detection
// ============================================================

/**
 * Detect environment variable patterns from .env files and code
 */
function detectEnvPatterns(projectRoot) {
  const result = {
    prefix: null,
    examples: [],
    source: null
  };

  // Check .env.example first (most reliable for patterns)
  const envFiles = ['.env.example', '.env.sample', '.env.template', '.env.local', '.env'];

  for (const envFile of envFiles) {
    const envPath = path.join(projectRoot, envFile);
    if (!fs.existsSync(envPath)) continue;

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const keys = content.match(/^[A-Z][A-Z0-9_]*/gm) || [];

      if (keys.length > 0) {
        result.examples = [...new Set(keys)].slice(0, 10);
        result.source = envFile;

        // Detect common prefixes
        const prefixes = {};
        for (const key of keys) {
          const parts = key.split('_');
          if (parts.length > 1) {
            const prefix = parts[0] + '_';
            prefixes[prefix] = (prefixes[prefix] || 0) + 1;
          }
        }

        // Find most common prefix
        const sortedPrefixes = Object.entries(prefixes)
          .filter(([prefix]) => ['VITE_', 'NEXT_PUBLIC_', 'NUXT_', 'REACT_APP_'].includes(prefix))
          .sort((a, b) => b[1] - a[1]);

        if (sortedPrefixes.length > 0) {
          result.prefix = sortedPrefixes[0][0];
        }

        break;
      }
    } catch (err) {
      // Ignore
    }
  }

  // Detect from code if no .env file
  if (!result.prefix) {
    const srcDir = path.join(projectRoot, 'src');
    if (fs.existsSync(srcDir)) {
      // Quick scan for env usage patterns
      const patterns = {
        'import.meta.env.VITE_': 'VITE_',
        'process.env.NEXT_PUBLIC_': 'NEXT_PUBLIC_',
        'process.env.REACT_APP_': 'REACT_APP_',
        'useRuntimeConfig': 'NUXT_'
      };

      try {
        const files = findFilesRecursive(srcDir, /\.(ts|tsx|js|jsx)$/, 3);
        for (const file of files.slice(0, 20)) {
          const content = fs.readFileSync(file, 'utf-8');
          for (const [pattern, prefix] of Object.entries(patterns)) {
            if (content.includes(pattern)) {
              result.prefix = prefix;
              result.source = 'code-analysis';
              break;
            }
          }
          if (result.prefix) break;
        }
      } catch (err) {
        // Ignore
      }
    }
  }

  return result;
}

// ============================================================
// API Route Pattern Detection
// ============================================================

/**
 * Detect API route naming patterns (full scan)
 */
function detectAPIPatterns(projectRoot) {
  const result = {
    style: null,
    examples: [],
    errorFormat: null,
    source: null
  };

  // Find API directories
  let apiDir = null;
  for (const dir of API_ROUTE_DIRS) {
    const fullPath = path.join(projectRoot, dir);
    if (fs.existsSync(fullPath)) {
      apiDir = fullPath;
      result.source = dir;
      break;
    }
  }

  if (!apiDir) return result;

  try {
    // Full scan of API routes
    const routeFiles = findFilesRecursive(apiDir, /\.(ts|js)$/, 5);
    const routeNames = [];

    for (const file of routeFiles) {
      const relativePath = path.relative(apiDir, file);
      // Extract route name from path (e.g., "users/[id]/route.ts" -> "users")
      const routePart = relativePath
        .replace(/\/route\.(ts|js)$/, '')
        .replace(/\.(ts|js)$/, '')
        .replace(/\[.*?\]/g, '') // Remove dynamic segments
        .split('/')[0];

      if (routePart && routePart !== 'index') {
        routeNames.push(routePart);
      }
    }

    if (routeNames.length > 0) {
      result.examples = [...new Set(routeNames)].slice(0, 10);

      // Analyze naming style
      const kebabCount = routeNames.filter(n => n.includes('-')).length;
      const camelCount = routeNames.filter(n => /[a-z][A-Z]/.test(n)).length;
      const snakeCount = routeNames.filter(n => n.includes('_')).length;

      if (kebabCount > camelCount && kebabCount > snakeCount) {
        result.style = 'kebab-case';
      } else if (camelCount > kebabCount && camelCount > snakeCount) {
        result.style = 'camelCase';
      } else if (snakeCount > kebabCount && snakeCount > camelCount) {
        result.style = 'snake_case';
      } else {
        // Default or mixed - check first few examples
        const sample = routeNames[0];
        if (sample && sample.includes('-')) result.style = 'kebab-case';
        else if (sample && /[a-z][A-Z]/.test(sample)) result.style = 'camelCase';
        else result.style = 'lowercase';
      }
    }

    // Detect error response format from code
    for (const file of routeFiles.slice(0, 10)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');

        // Look for error response patterns
        const errorPatterns = [
          { pattern: /res\.status\(\d+\)\.json\(\{\s*error:/s, format: '{ error: string }' },
          { pattern: /res\.status\(\d+\)\.json\(\{\s*message:/s, format: '{ message: string }' },
          { pattern: /NextResponse\.json\(\{\s*error:/s, format: '{ error: string }' },
          { pattern: /return\s+\{\s*error:\s*[^,}]+,\s*code:/s, format: '{ error: string, code: number }' }
        ];

        for (const { pattern, format } of errorPatterns) {
          if (pattern.test(content)) {
            result.errorFormat = format;
            break;
          }
        }
        if (result.errorFormat) break;
      } catch (err) {
        // Ignore
      }
    }
  } catch (err) {
    // Ignore
  }

  return result;
}

// ============================================================
// File Naming Convention Detection
// ============================================================

/**
 * Detect file naming conventions from the project
 */
function detectFileNamingConvention(projectRoot) {
  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) return { style: 'unknown', source: null };

  try {
    const files = findFilesRecursive(srcDir, /\.(ts|tsx|js|jsx)$/, 3);
    const basenames = files.map(f => path.basename(f, path.extname(f)));

    let kebabCount = 0;
    let pascalCount = 0;
    let camelCount = 0;

    // Sample up to 200 files for more accurate naming convention detection
    const NAMING_SAMPLE_SIZE = 200;
    for (const name of basenames.slice(0, NAMING_SAMPLE_SIZE)) {
      if (name === 'index') continue;
      if (name.includes('-')) kebabCount++;
      else if (/^[A-Z]/.test(name)) pascalCount++;
      else if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) camelCount++;
    }

    let style = 'mixed';
    if (kebabCount > pascalCount && kebabCount > camelCount) {
      style = 'kebab-case';
    } else if (pascalCount > kebabCount && pascalCount > camelCount) {
      style = 'PascalCase';
    } else if (camelCount > kebabCount && camelCount > pascalCount) {
      style = 'camelCase';
    }

    return { style, source: 'src/' };
  } catch (err) {
    return { style: 'unknown', source: null };
  }
}

// ============================================================
// Git Workflow Detection
// ============================================================

/**
 * Detect git workflow patterns from history
 */
function detectGitPatterns(projectRoot) {
  const result = {
    branchNaming: null,
    commitFormat: null,
    examples: {
      branches: [],
      commits: []
    },
    source: null
  };

  const gitDir = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitDir)) return result;

  try {
    // Read recent branch names from refs
    const headsDir = path.join(gitDir, 'refs', 'heads');
    if (fs.existsSync(headsDir)) {
      const branches = fs.readdirSync(headsDir).filter(b => b !== 'main' && b !== 'master');
      result.examples.branches = branches.slice(0, 5);

      // Detect branch naming pattern
      const patterns = {
        'feature/': branches.filter(b => b.startsWith('feature/')).length,
        'feat/': branches.filter(b => b.startsWith('feat/')).length,
        'fix/': branches.filter(b => b.startsWith('fix/')).length,
        'bugfix/': branches.filter(b => b.startsWith('bugfix/')).length
      };

      const topPattern = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0];
      if (topPattern && topPattern[1] > 0) {
        result.branchNaming = topPattern[0] + '[type]/[description]';
      }
    }

    // Try to detect commit message format from COMMIT_EDITMSG or recent commits
    const commitMsgFile = path.join(gitDir, 'COMMIT_EDITMSG');
    if (fs.existsSync(commitMsgFile)) {
      const msg = fs.readFileSync(commitMsgFile, 'utf-8').split('\n')[0];
      result.examples.commits.push(msg);

      // Detect conventional commits
      if (/^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?:/.test(msg)) {
        result.commitFormat = 'conventional';
      }
    }

    result.source = '.git';
  } catch (err) {
    // Ignore
  }

  return result;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Recursively find files matching a pattern
 * @param {string} dir - Directory to search
 * @param {RegExp} pattern - File pattern to match
 * @param {number} maxDepth - Maximum directory depth
 * @param {number} depth - Current depth
 * @param {Object} state - Shared state for limiting results
 */
function findFilesRecursive(dir, pattern, maxDepth = 5, depth = 0, state = { count: 0 }) {
  const results = [];
  if (depth > maxDepth) return results;
  if (state.count >= MAX_FILE_RESULTS) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (state.count >= MAX_FILE_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage'].includes(entry.name)) {
          continue;
        }
        results.push(...findFilesRecursive(fullPath, pattern, maxDepth, depth + 1, state));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
        state.count++;
      }
    }
  } catch (err) {
    // Ignore read errors
  }

  return results;
}

// ============================================================
// Main Scanner Function
// ============================================================

/**
 * Scan a project for all operational standards
 */
function scanProject(projectRoot) {
  const packageManager = detectPackageManager(projectRoot);
  const devServer = detectDevServer(projectRoot);
  const scripts = getNormalizedScripts(projectRoot, packageManager);
  const envPatterns = detectEnvPatterns(projectRoot);
  const apiPatterns = detectAPIPatterns(projectRoot);
  const fileNaming = detectFileNamingConvention(projectRoot);
  const gitPatterns = detectGitPatterns(projectRoot);

  return {
    scannedAt: new Date().toISOString(),
    projectRoot,
    operational: {
      packageManager,
      devServer,
      scripts
    },
    patterns: {
      apiRoutes: apiPatterns,
      envVars: envPatterns,
      fileNaming,
      gitWorkflow: gitPatterns
    }
  };
}

/**
 * Format scan results for display
 */
function formatResults(results) {
  const lines = [];
  const { operational, patterns } = results;

  lines.push(colors.cyan + '\n=== Operational Standards ===' + colors.reset);

  // Package Manager
  lines.push(colors.white + '\nPackage Manager:' + colors.reset);
  lines.push(`  Tool: ${colors.green}${operational.packageManager.tool}${colors.reset}`);
  if (operational.packageManager.version) {
    lines.push(`  Version: ${operational.packageManager.version}`);
  }
  lines.push(`  Source: ${colors.dim}${operational.packageManager.source}${colors.reset}`);
  lines.push(`  Command: ${colors.yellow}${operational.packageManager.command}${colors.reset}`);

  // Dev Server
  lines.push(colors.white + '\nDev Server:' + colors.reset);
  lines.push(`  URL: ${colors.green}${operational.devServer.https ? 'https' : 'http'}://${operational.devServer.host}:${operational.devServer.port}${colors.reset}`);
  lines.push(`  Source: ${colors.dim}${operational.devServer.source}${colors.reset}`);

  // Scripts
  lines.push(colors.white + '\nAvailable Scripts:' + colors.reset);
  const importantScripts = ['dev', 'build', 'test', 'lint', 'start'];
  for (const name of importantScripts) {
    if (operational.scripts[name]) {
      lines.push(`  ${name}: ${colors.yellow}${operational.scripts[name]}${colors.reset}`);
    }
  }

  lines.push(colors.cyan + '\n=== Code Patterns ===' + colors.reset);

  // API Routes
  if (patterns.apiRoutes.style) {
    lines.push(colors.white + '\nAPI Routes:' + colors.reset);
    lines.push(`  Style: ${colors.green}${patterns.apiRoutes.style}${colors.reset}`);
    if (patterns.apiRoutes.examples.length > 0) {
      lines.push(`  Examples: ${patterns.apiRoutes.examples.join(', ')}`);
    }
    if (patterns.apiRoutes.errorFormat) {
      lines.push(`  Error format: ${patterns.apiRoutes.errorFormat}`);
    }
  }

  // Env Vars
  if (patterns.envVars.prefix || patterns.envVars.examples.length > 0) {
    lines.push(colors.white + '\nEnvironment Variables:' + colors.reset);
    if (patterns.envVars.prefix) {
      lines.push(`  Public prefix: ${colors.green}${patterns.envVars.prefix}*${colors.reset}`);
    }
    if (patterns.envVars.examples.length > 0) {
      lines.push(`  Examples: ${patterns.envVars.examples.slice(0, 5).join(', ')}`);
    }
  }

  // File Naming
  lines.push(colors.white + '\nFile Naming:' + colors.reset);
  lines.push(`  Style: ${colors.green}${patterns.fileNaming.style}${colors.reset}`);

  // Git Workflow
  if (patterns.gitWorkflow.branchNaming || patterns.gitWorkflow.commitFormat) {
    lines.push(colors.white + '\nGit Workflow:' + colors.reset);
    if (patterns.gitWorkflow.branchNaming) {
      lines.push(`  Branch naming: ${colors.green}${patterns.gitWorkflow.branchNaming}${colors.reset}`);
    }
    if (patterns.gitWorkflow.commitFormat) {
      lines.push(`  Commit format: ${colors.green}${patterns.gitWorkflow.commitFormat}${colors.reset}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  scanProject,
  detectPackageManager,
  detectDevServer,
  extractScripts,
  getNormalizedScripts,
  detectEnvPatterns,
  detectAPIPatterns,
  detectFileNamingConvention,
  detectGitPatterns,
  formatResults
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {
    json: args.includes('--json'),
    analyze: args.includes('--analyze'),
    help: args.includes('--help') || args.includes('-h')
  };

  if (flags.help) {
    console.log(`
Wogi Flow - Operational Standards Scanner

Usage:
  flow-operational-scanner [project-root]    Scan a project
  flow-operational-scanner --analyze         Analyze current project
  flow-operational-scanner --json            Output as JSON

Options:
  --json      Output results as JSON
  --analyze   Analyze and display results
  --help      Show this help message

What's Detected:
  - Package manager (npm, yarn, pnpm, bun)
  - Dev server port and configuration
  - Scripts from package.json
  - Environment variable patterns
  - API route naming conventions
  - File naming conventions
  - Git workflow patterns
`);
    process.exit(0);
  }

  const projectRoot = args.find(a => !a.startsWith('--')) || getProjectRoot();
  const results = scanProject(projectRoot);

  if (flags.json) {
    outputJson(results);
  } else {
    console.log(formatResults(results));
  }
}
