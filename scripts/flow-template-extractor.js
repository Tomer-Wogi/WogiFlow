#!/usr/bin/env node

/**
 * Wogi Flow - Template Extraction Engine
 *
 * Extracts representative file skeletons from a codebase to use
 * as templates for AI-generated code. Creates structural templates
 * for components, services, tests, routes, hooks, and configs.
 *
 * Usage:
 *   flow template-extract [options]
 *   node scripts/flow-template-extractor.js [options]
 *
 * Options:
 *   --project <path>     Project to extract from (default: current)
 *   --output <dir>       Output directory (default: .workflow/templates/extracted/)
 *   --types <types>      Types: component,service,test,route,hook,config (default: all)
 *   --json               JSON output for scripting
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ============================================================================
// Constants
// ============================================================================

const FILE_TYPES = {
  component: {
    label: 'Component',
    patterns: [/\.(tsx|jsx)$/, /component/i],
    markers: ['React', 'useState', 'useEffect', 'export default', 'props', 'render'],
    extensions: ['.tsx', '.jsx'],
    minMarkers: 1
  },
  service: {
    label: 'Service/Utility',
    patterns: [/\.service\.|\.util\.|\.helper\.|\/services\/|\/utils\/|\/helpers\//],
    markers: ['class ', 'async ', 'export', 'function '],
    extensions: ['.ts', '.js', '.tsx', '.jsx'],
    minMarkers: 1
  },
  test: {
    label: 'Test',
    patterns: [/\.test\.|\.spec\.|__tests__\//],
    markers: ['describe(', 'it(', 'test(', 'expect(', 'jest', 'vitest'],
    extensions: ['.ts', '.js', '.tsx', '.jsx'],
    minMarkers: 1
  },
  route: {
    label: 'API Route/Controller',
    patterns: [/\.controller\.|\.route\.|\/routes\/|\/controllers\/|\/api\//],
    markers: ['@Controller', '@Get', '@Post', 'router.', 'app.get', 'app.post', 'express'],
    extensions: ['.ts', '.js'],
    minMarkers: 1
  },
  hook: {
    label: 'Hook/Composable',
    patterns: [/\/hooks\/|\/composables\//],
    markers: ['use', 'useState', 'useEffect', 'export function use', 'export const use'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    minMarkers: 1
  },
  config: {
    label: 'Configuration',
    patterns: [/\.config\.|\/config\//],
    markers: ['module.exports', 'export default', 'defineConfig'],
    extensions: ['.ts', '.js', '.json'],
    minMarkers: 1
  }
};

const IGNORE_PATTERNS = [
  'node_modules', 'dist', 'build', '.git', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor'
];

// Colors for CLI
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

// ============================================================================
// File Classification
// ============================================================================

/**
 * Classify a file into a type category
 */
function classifyFile(filePath, content) {
  const ext = path.extname(filePath);

  for (const [type, config] of Object.entries(FILE_TYPES)) {
    // Check extension
    if (!config.extensions.includes(ext)) continue;

    // Check path patterns
    const pathMatch = config.patterns.some(p => p.test(filePath));
    if (!pathMatch) continue;

    // Check content markers
    const markerCount = config.markers.filter(m => content.includes(m)).length;
    if (markerCount >= config.minMarkers) {
      return type;
    }
  }

  // Fallback: classify by content heuristics
  if (['.tsx', '.jsx'].includes(ext) && (content.includes('return (') || content.includes('return <'))) {
    return 'component';
  }
  if (content.includes('describe(') && content.includes('it(')) {
    return 'test';
  }
  if (filePath.startsWith('use') || /export\s+(function|const)\s+use[A-Z]/.test(content)) {
    return 'hook';
  }

  return null;
}

/**
 * Scan project and classify all source files
 */
function classifyProjectFiles(projectRoot) {
  const classified = {};
  for (const type of Object.keys(FILE_TYPES)) {
    classified[type] = [];
  }

  const files = getSourceFiles(projectRoot);

  for (const file of files) {
    const fullPath = path.join(projectRoot, file);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // Skip very small or very large files
    const lines = content.split('\n').length;
    if (lines < 5 || lines > 500) continue;

    const type = classifyFile(file, content);
    if (type && classified[type]) {
      classified[type].push({
        path: file,
        content,
        lines,
        lastModified: getGitFileDate(projectRoot, file)
      });
    }
  }

  return classified;
}

/**
 * Get all source files in the project
 */
function getSourceFiles(projectRoot) {
  const files = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

  function walk(dir, prefix = '') {
    let entries;
    try {
      entries = fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.')) continue;
      if (IGNORE_PATTERNS.includes(name)) continue;

      const relPath = prefix ? `${prefix}/${name}` : name;

      if (entry.isDirectory()) {
        walk(path.join(dir, name), relPath);
      } else if (entry.isFile() && extensions.has(path.extname(name))) {
        // Skip minified/bundled files
        if (name.endsWith('.min.js') || name.endsWith('.bundle.js')) continue;
        files.push(relPath);
      }
    }
  }

  walk('.');
  return files;
}

/**
 * Get file's last commit date via git log
 */
function getGitFileDate(projectRoot, filePath) {
  try {
    const output = execFileSync('git', [
      'log', '-1', '--format=%at', '--', filePath
    ], {
      encoding: 'utf-8',
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timestamp = parseInt(output.trim(), 10);
    if (!isNaN(timestamp) && timestamp > 0) {
      return new Date(timestamp * 1000);
    }
  } catch {
    // Not a git repo or file not tracked
  }

  try {
    return fs.statSync(path.join(projectRoot, filePath)).mtime;
  } catch {
    return new Date(0);
  }
}

// ============================================================================
// Representative Selection
// ============================================================================

/**
 * Score a file for representativeness within its type group
 *
 * Higher score = more representative template candidate.
 * Factors: structural completeness, recency, line count proximity to median.
 */
function scoreFile(file, allFilesOfType) {
  let score = 0;

  // 1. Structural completeness - has all expected sections
  const typeConfig = Object.values(FILE_TYPES).find(t =>
    t.patterns.some(p => p.test(file.path))
  );
  if (typeConfig) {
    const markerCount = typeConfig.markers.filter(m => file.content.includes(m)).length;
    score += (markerCount / typeConfig.markers.length) * 40;
  }

  // 2. Recency - prefer more recently modified files
  const maxDate = Math.max(...allFilesOfType.map(f => f.lastModified?.getTime() || 0));
  const minDate = Math.min(...allFilesOfType.map(f => f.lastModified?.getTime() || 0));
  const dateRange = maxDate - minDate || 1;
  const recencyScore = ((file.lastModified?.getTime() || 0) - minDate) / dateRange;
  score += recencyScore * 30;

  // 3. Line count proximity to median (prefer "typical" files, not outliers)
  const sortedLengths = allFilesOfType.map(f => f.lines).sort((a, b) => a - b);
  const median = sortedLengths[Math.floor(sortedLengths.length / 2)];
  const deviation = Math.abs(file.lines - median) / (median || 1);
  const proximityScore = Math.max(0, 1 - deviation);
  score += proximityScore * 30;

  return score;
}

/**
 * Select the most representative file from a group
 */
function selectRepresentative(filesOfType) {
  if (filesOfType.length === 0) return null;
  if (filesOfType.length === 1) return filesOfType[0];

  // Score all files
  const scored = filesOfType.map(file => ({
    file,
    score: scoreFile(file, filesOfType)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0].file;
}

// ============================================================================
// Template Generation
// ============================================================================

/**
 * Generate a template from a representative file by stripping implementation
 */
function generateTemplate(file, type) {
  const content = file.content;
  const lines = content.split('\n');
  const templateLines = [];
  let insideBody = false;
  let braceDepth = 0;
  let bodyStartDepth = 0;
  let skipUntilCloseBrace = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Always keep: imports, type declarations, interface definitions, exports
    if (isStructuralLine(trimmed, type)) {
      templateLines.push(line);
      continue;
    }

    // Track brace depth for function body detection
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (skipUntilCloseBrace) {
      braceDepth += opens - closes;
      if (braceDepth <= bodyStartDepth) {
        skipUntilCloseBrace = false;
        templateLines.push(line); // closing brace
      }
      continue;
    }

    // Detect function/method body start
    if (isFunctionStart(trimmed, type)) {
      templateLines.push(line);
      if (opens > closes) {
        // Multi-line function - skip body
        bodyStartDepth = braceDepth;
        braceDepth += opens - closes;
        skipUntilCloseBrace = true;
        templateLines.push(getIndent(line) + '  // [IMPLEMENTATION]');
      }
      continue;
    }

    // Keep JSX return structure outline (for components)
    if (type === 'component' && isJsxReturnStart(trimmed)) {
      templateLines.push(line);
      templateLines.push(getIndent(line) + '  {/* [JSX_CONTENT] */}');
      // Skip until matching close
      let jsxDepth = (trimmed.includes('(') ? 1 : 0);
      for (let j = i + 1; j < lines.length; j++) {
        jsxDepth += (lines[j].match(/\(/g) || []).length;
        jsxDepth -= (lines[j].match(/\)/g) || []).length;
        if (jsxDepth <= 0) {
          templateLines.push(lines[j]); // closing paren
          i = j;
          break;
        }
      }
      continue;
    }

    // Keep test structure (describe/it blocks)
    if (type === 'test' && isTestStructureLine(trimmed)) {
      templateLines.push(line);
      continue;
    }

    // Default: keep the line
    braceDepth += opens - closes;
    templateLines.push(line);
  }

  // Build template header
  const header = [
    `// Template: ${FILE_TYPES[type]?.label || type}`,
    `// Source: ${file.path}`,
    `// Extracted: ${new Date().toISOString().split('T')[0]}`,
    `// Lines: ${file.lines} (original) → ${templateLines.length} (template)`,
    '//',
    '// Markers:',
    '//   [IMPLEMENTATION] - Replace with actual business logic',
    '//   [JSX_CONTENT]    - Replace with actual JSX content',
    '//   [TEST_BODY]      - Replace with actual test assertions',
    '',
  ];

  return header.join('\n') + templateLines.join('\n');
}

/**
 * Check if a line is structural (should always be kept)
 */
function isStructuralLine(trimmed, type) {
  // Import statements
  if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && trimmed.includes('require(')) return true;
  if (trimmed.startsWith('from ')) return true;

  // Export statements
  if (trimmed.startsWith('export ')) return true;
  if (trimmed === 'module.exports' || trimmed.startsWith('module.exports')) return true;

  // Type declarations
  if (trimmed.startsWith('interface ') || trimmed.startsWith('type ') || trimmed.startsWith('enum ')) return true;

  // Empty lines and comments
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;

  // Class/function declarations (but not bodies)
  if (trimmed.startsWith('class ') || trimmed.startsWith('abstract class ')) return true;

  // Decorators
  if (trimmed.startsWith('@')) return true;

  // React hooks declarations
  if (/^\s*const\s+\[.*\]\s*=\s*use/.test(trimmed)) return true;

  return false;
}

/**
 * Check if a line starts a function/method body
 */
function isFunctionStart(trimmed, _type) {
  // Arrow functions with body
  if (/=>\s*\{/.test(trimmed) && !trimmed.startsWith('import')) return true;

  // Method definitions
  if (/^\s*(async\s+)?(public|private|protected)?\s*(static\s+)?\w+\s*\(/.test(trimmed) && trimmed.includes('{')) return true;

  // Function declarations
  if (/^\s*(async\s+)?function\s/.test(trimmed) && trimmed.includes('{')) return true;

  return false;
}

/**
 * Check if a line starts a JSX return block
 */
function isJsxReturnStart(trimmed) {
  return /^\s*return\s*\(/.test(trimmed);
}

/**
 * Check if a line is test structure
 */
function isTestStructureLine(trimmed) {
  return /^\s*(describe|it|test|beforeEach|beforeAll|afterEach|afterAll)\s*\(/.test(trimmed);
}

/**
 * Get the indentation of a line
 */
function getIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract templates from a project
 *
 * @param {string} projectRoot - Path to the project
 * @param {Object} options - Extraction options
 * @param {string[]} options.types - File types to extract (default: all)
 * @param {string} options.outputDir - Output directory for templates
 * @returns {Object} Extraction result with templates and metadata
 */
async function extractTemplates(projectRoot, options = {}) {
  const {
    types = Object.keys(FILE_TYPES),
    outputDir = path.join(projectRoot, '.workflow', 'templates', 'extracted')
  } = options;

  const startTime = Date.now();
  const results = {
    templates: {},
    metadata: {
      projectRoot,
      extractedAt: new Date().toISOString(),
      filesScanned: 0,
      typesFound: 0
    }
  };

  // Classify files
  const classified = classifyProjectFiles(projectRoot);

  let totalScanned = 0;
  for (const files of Object.values(classified)) {
    totalScanned += files.length;
  }
  results.metadata.filesScanned = totalScanned;

  // Extract template for each requested type
  for (const type of types) {
    const filesOfType = classified[type];
    if (!filesOfType || filesOfType.length === 0) continue;

    const representative = selectRepresentative(filesOfType);
    if (!representative) continue;

    const template = generateTemplate(representative, type);

    results.templates[type] = {
      type,
      label: FILE_TYPES[type]?.label || type,
      sourcePath: representative.path,
      sourceLines: representative.lines,
      templateLines: template.split('\n').length,
      candidateCount: filesOfType.length,
      template
    };

    results.metadata.typesFound++;
  }

  results.metadata.durationMs = Date.now() - startTime;

  return results;
}

/**
 * Save extracted templates to disk
 */
function saveTemplates(results, outputDir) {
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const saved = [];

  for (const [type, data] of Object.entries(results.templates)) {
    const filename = `${type}.template`;
    const filepath = path.join(outputDir, filename);

    try {
      // Atomic write: temp file + rename
      const tempPath = filepath + '.tmp';
      fs.writeFileSync(tempPath, data.template);
      fs.renameSync(tempPath, filepath);
      saved.push({ type, path: filepath });
    } catch (err) {
      console.error(`${c.red}Error saving ${type} template: ${err.message}${c.reset}`);
    }
  }

  return saved;
}

/**
 * Generate decisions.md entries for extracted templates
 */
function formatTemplateDecisions(results) {
  if (Object.keys(results.templates).length === 0) {
    return '';
  }

  let md = `## File Templates\n\n`;
  md += `Templates extracted from project for consistent file structure.\n\n`;

  for (const [type, data] of Object.entries(results.templates)) {
    md += `### ${data.label} Template\n\n`;
    md += `**Template**: \`.workflow/templates/extracted/${type}.template\`\n`;
    md += `**Source**: \`${data.sourcePath}\` (${data.sourceLines} lines)\n`;
    md += `**Candidates**: ${data.candidateCount} files of this type\n\n`;
    md += `When creating new ${data.label.toLowerCase()} files, follow the structure in this template.\n\n`;
  }

  return md;
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const options = {
    project: null,
    output: null,
    types: Object.keys(FILE_TYPES),
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--project':
        options.project = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--types':
        options.types = args[++i].split(',');
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
${c.bold}Wogi Flow - Template Extraction${c.reset}

${c.cyan}Usage:${c.reset}
  node scripts/flow-template-extractor.js [options]
  flow template-extract [options]

${c.cyan}Options:${c.reset}
  --project <path>     Project to extract from (default: current directory)
  --output <dir>       Output directory (default: .workflow/templates/extracted/)
  --types <types>      Types: component,service,test,route,hook,config (default: all)
  --json               JSON output for scripting
  --help, -h           Show this help

${c.cyan}Examples:${c.reset}
  flow template-extract
  flow template-extract --types component,service,test
  flow template-extract --project /path/to/reference --output ./templates
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    return;
  }

  let projectRoot;
  try {
    projectRoot = options.project || execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    projectRoot = process.cwd();
  }

  const outputDir = options.output || path.join(projectRoot, '.workflow', 'templates', 'extracted');

  console.error(`${c.cyan}Extracting templates...${c.reset}`);
  console.error(`  Project: ${projectRoot}`);
  console.error(`  Types: ${options.types.join(', ')}`);
  console.error('');

  try {
    const results = await extractTemplates(projectRoot, {
      types: options.types,
      outputDir
    });

    console.error(`  Files classified: ${results.metadata.filesScanned}`);
    console.error(`  Types found: ${results.metadata.typesFound}`);
    console.error(`  Duration: ${results.metadata.durationMs}ms`);
    console.error('');

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Save templates to disk
      const saved = saveTemplates(results, outputDir);

      for (const { type, path: filepath } of saved) {
        const data = results.templates[type];
        console.error(`  ${c.green}✓${c.reset} ${data.label}: ${filepath}`);
        console.error(`    ${c.dim}Source: ${data.sourcePath} (${data.candidateCount} candidates)${c.reset}`);
      }

      if (saved.length === 0) {
        console.error(`  ${c.yellow}No templates extracted (no matching files found)${c.reset}`);
      } else {
        console.error('');
        console.error(`${c.green}✓ ${saved.length} template(s) saved to ${outputDir}${c.reset}`);
      }
    }
  } catch (err) {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = {
  extractTemplates,
  saveTemplates,
  formatTemplateDecisions,
  classifyFile,
  classifyProjectFiles,
  selectRepresentative,
  generateTemplate,
  FILE_TYPES
};
