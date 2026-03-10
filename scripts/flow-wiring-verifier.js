#!/usr/bin/env node

/**
 * Wogi Flow - Integration Wiring Verifier
 *
 * Verifies that created files are actually imported/used somewhere in the codebase.
 * This prevents "orphan components" - files that exist but are never wired into the app.
 *
 * Checks:
 * 1. React components are imported in at least one parent
 * 2. Utility functions/hooks are called from somewhere
 * 3. Components mentioned in spec are wired to their intended parents
 *
 * Usage:
 *   const { verifyWiring } = require('./flow-wiring-verifier');
 *   const result = verifyWiring('wf-XXXXXXXX');
 *   if (!result.passed) {
 *     console.log('Unwired:', result.unwired);
 *   }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  readFile,
  success,
  warn,
  error,
  info,
  color,
  getFdCommand
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * File types that need wiring verification
 */
const VERIFIABLE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Entry points that don't need to be imported elsewhere
 */
const ENTRY_POINT_PATTERNS = [
  /^index\.[jt]sx?$/,           // index.ts, index.tsx
  /^main\.[jt]sx?$/,            // main.ts, main.tsx
  /^app\.[jt]sx?$/i,            // App.tsx, app.ts
  /\.config\.[jt]s$/,           // *.config.ts
  /\.test\.[jt]sx?$/,           // *.test.ts
  /\.spec\.[jt]sx?$/,           // *.spec.ts
  /\.stories\.[jt]sx?$/,        // *.stories.tsx
  /^seed\.[jt]s$/,              // seed.ts
  /scripts\//,                  // scripts/ directory
  /\.claude\//,                 // .claude/ directory
  /\.workflow\//                // .workflow/ directory
];

/**
 * Directories to search for imports
 */
const SEARCH_DIRS = ['src', 'apps', 'packages', 'lib', 'components'];

// ============================================================
// Core Functions
// ============================================================

/**
 * Check if a file is an entry point (doesn't need to be imported)
 */
function isEntryPoint(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const filename = path.basename(filePath);

  return ENTRY_POINT_PATTERNS.some(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(filename) || pattern.test(relativePath);
    }
    return filename === pattern || relativePath.includes(pattern);
  });
}

/**
 * Extract the export name from a file (component name, function name, etc.)
 */
function extractExportName(filePath) {
  const filename = path.basename(filePath, path.extname(filePath));

  // Convert kebab-case or snake_case to PascalCase for components
  const pascalCase = filename
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  // Also keep the original filename for named exports
  return {
    pascalCase,
    camelCase: pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1),
    original: filename,
    kebabCase: filename.toLowerCase().replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
  };
}

/**
 * Search for imports of a file in the codebase
 */
function findImports(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const dirPath = path.dirname(relativePath);
  const filename = path.basename(filePath, path.extname(filePath));
  const exportNames = extractExportName(filePath);

  // Build search patterns
  const searchPatterns = [
    // Direct import by path
    `from ['"].*${filename}['"]`,
    `from ['"].*/${filename}['"]`,
    `require\\(['"].*${filename}['"]\\)`,

    // Import by export name
    `import.*${exportNames.pascalCase}`,
    `import.*${exportNames.camelCase}`,

    // Dynamic import
    `import\\(['"].*${filename}['"]\\)`
  ];

  const imports = [];

  for (const pattern of searchPatterns) {
    try {
      // Use execFileSync with array arguments to prevent command injection
      const result = execFileSync('grep', [
        '-rl',
        '-E',
        pattern,
        '--include=*.ts',
        '--include=*.tsx',
        '--include=*.js',
        '--include=*.jsx',
        '.'
      ], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const files = result.trim().split('\n').filter(Boolean);
      for (const file of files) {
        const normalizedFile = file.replace(/^\.\//, '');
        // Don't count self-imports
        if (!normalizedFile.endsWith(path.basename(filePath))) {
          imports.push(normalizedFile);
        }
      }
    } catch (err) {
      // grep returns non-zero if no matches, ignore
    }
  }

  // Deduplicate
  return [...new Set(imports)];
}

/**
 * Check if a file is wired (imported somewhere or is an entry point)
 */
function checkFileWiring(filePath) {
  const result = {
    file: filePath,
    isEntryPoint: false,
    isWired: false,
    importedBy: [],
    exportNames: extractExportName(filePath)
  };

  // Check if it's an entry point
  if (isEntryPoint(filePath)) {
    result.isEntryPoint = true;
    result.isWired = true;
    return result;
  }

  // Find imports
  result.importedBy = findImports(filePath);
  result.isWired = result.importedBy.length > 0;

  return result;
}

/**
 * Parse spec file to extract files that should be wired
 */
function parseSpecForWiringRequirements(specPath) {
  if (!fileExists(specPath)) {
    return { files: [], wiringRequirements: [] };
  }

  const content = readFile(specPath, '');
  const files = [];
  const wiringRequirements = [];

  // Extract files from spec (reuse patterns from flow-spec-verifier)
  const filePatterns = [
    /\|\s*`([^`]+\.[a-z]+)`\s*\|/gi,
    /[-*]\s*(?:Create\s+|Modify\s+|Update\s+)?`([^`]+\.[a-z]+)`/gi,
    /(?:Create|Add|Implement)\s+`([^`]+\.[a-z]+)`/gi
  ];

  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const filePath = match[1].trim();
      if (VERIFIABLE_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
        files.push(filePath);
      }
    }
  }

  // Extract wiring requirements (e.g., "wire into AdminApprovalQueue")
  const wiringPatterns = [
    /\*\*WIRING\*\*:\s*(.+)/gi,
    /wire(?:d?)?\s+(?:into|to)\s+`?([^`\n]+)`?/gi,
    /import(?:ed?)?\s+(?:in|by)\s+`?([^`\n]+)`?/gi,
    /render(?:ed?)?\s+(?:in|by)\s+`?([^`\n]+)`?/gi
  ];

  for (const pattern of wiringPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      wiringRequirements.push(match[1].trim());
    }
  }

  return {
    files: [...new Set(files)],
    wiringRequirements: [...new Set(wiringRequirements)]
  };
}

/**
 * Verify wiring for a task's deliverables
 */
function verifyWiring(taskId) {
  const specPath = path.join(PATHS.changes, `${taskId}.md`);

  const result = {
    taskId,
    passed: true,
    totalFiles: 0,
    wiredFiles: 0,
    unwired: [],
    entryPoints: [],
    warnings: [],
    details: []
  };

  // Parse spec for files and wiring requirements
  const { files, wiringRequirements } = parseSpecForWiringRequirements(specPath);

  if (files.length === 0) {
    result.warnings.push('No verifiable files found in spec');
    return result;
  }

  result.totalFiles = files.length;

  // Check each file
  for (const file of files) {
    const fullPath = path.join(PROJECT_ROOT, file);

    // Skip if file doesn't exist (spec-verifier will catch this)
    if (!fileExists(fullPath)) {
      result.warnings.push(`File not found: ${file}`);
      continue;
    }

    const wiringCheck = checkFileWiring(fullPath);
    result.details.push(wiringCheck);

    if (wiringCheck.isEntryPoint) {
      result.entryPoints.push(file);
      result.wiredFiles++;
    } else if (wiringCheck.isWired) {
      result.wiredFiles++;
    } else {
      result.unwired.push({
        file,
        suggestion: `Import ${wiringCheck.exportNames.pascalCase} in a parent component`
      });
      result.passed = false;
    }
  }

  // Check specific wiring requirements from spec
  for (const requirement of wiringRequirements) {
    // Try to verify the requirement was met
    const parentFile = requirement.replace(/[`'"]/g, '');
    if (parentFile.includes('.tsx') || parentFile.includes('.ts')) {
      // Check if any of our files are imported in this parent
      const parentPath = findFileByName(parentFile);
      if (parentPath && fileExists(parentPath)) {
        const parentContent = readFile(parentPath, '');
        const missingImports = files.filter(file => {
          const basename = path.basename(file, path.extname(file));
          return !parentContent.includes(basename);
        });

        if (missingImports.length > 0) {
          result.warnings.push(
            `Spec requires wiring to ${parentFile}, but these files may not be imported: ${missingImports.join(', ')}`
          );
        }
      }
    }
  }

  return result;
}

/**
 * Find a file by partial name in common directories.
 * Prefers fd/fdfind (faster, auto-approved in Claude Code 2.1.72+) with find fallback.
 * Uses shared getFdCommand() from flow-utils.js.
 */
function findFileByName(filename) {
  const basename = path.basename(filename);
  const fdCmd = getFdCommand();

  for (const dir of SEARCH_DIRS) {
    const searchDir = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(searchDir)) continue;

    try {
      let result;
      if (fdCmd) {
        // fd is faster and auto-approved in Claude Code 2.1.72+
        result = execFileSync(fdCmd, [
          '--type', 'f',
          '--glob', basename,
          '--max-results', '1',
          '--sort-path',
          searchDir
        ], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } else {
        // Fallback to find
        result = execFileSync('find', [
          searchDir,
          '-name',
          basename,
          '-type',
          'f'
        ], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      }

      const files = result.trim().split('\n').filter(Boolean);
      if (files.length > 0) {
        return files[0]; // Return first match
      }
    } catch (err) {
      // Ignore errors (find/fd returns non-zero if no matches on some systems)
    }
  }

  return null;
}

/**
 * Format verification result for display
 */
function formatResult(result) {
  const lines = [];

  if (result.passed) {
    lines.push(color('green', `\u2713 Integration wiring verified (${result.wiredFiles}/${result.totalFiles} files)`));
  } else {
    lines.push(color('red', `\u2717 Integration wiring FAILED (${result.wiredFiles}/${result.totalFiles} files wired)`));
  }

  if (result.unwired.length > 0) {
    lines.push('');
    lines.push(color('yellow', 'Unwired files (not imported anywhere):'));
    for (const item of result.unwired) {
      lines.push(`  ${color('red', '\u2717')} ${item.file}`);
      lines.push(`    ${color('dim', item.suggestion)}`);
    }
  }

  if (result.entryPoints.length > 0) {
    lines.push('');
    lines.push(color('dim', `Entry points (${result.entryPoints.length}): ${result.entryPoints.join(', ')}`));
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(color('yellow', 'Warnings:'));
    for (const warning of result.warnings) {
      lines.push(`  ${color('yellow', '\u26a0')} ${warning}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Removal Impact Detection
// ============================================================

/**
 * Patterns that extract meaningful identifiers from removed lines.
 * Each pattern returns named groups: { name } = the identifier to search for.
 */
const REMOVAL_PATTERNS = [
  // export { Foo, Bar } or export { Foo as Bar }
  { regex: /export\s*\{([^}]+)\}/g, extractor: extractExportNames },
  // export default Foo / export const Foo / export function Foo / export class Foo
  { regex: /export\s+(?:default\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g, extractor: null },
  // Type union members: 'member1' | 'member2' (string literal unions)
  { regex: /['"](\w[\w-]*)['"](?:\s*\||\s*;|\s*$)/g, extractor: null },
  // Type/interface members in a type declaration: type Foo = 'a' | 'b' | 'c'
  { regex: /type\s+\w+\s*=\s*(.+)/g, extractor: extractUnionMembers },
  // Object property with string value: { id: 'internal', label: '...' }
  { regex: /(?:id|key|name|type|value|tab|section|route|path)\s*:\s*['"](\w[\w-]*)['"]/g, extractor: null },
  // Component JSX usage: <FooComponent or </FooComponent
  { regex: /<\/?([A-Z]\w+)/g, extractor: null },
  // Import specifiers: import { Foo, Bar } from ...
  { regex: /import\s*\{([^}]+)\}\s*from/g, extractor: extractImportNames },
  // Enum members: MemberName = 'value' or just MemberName,
  { regex: /^\s*(\w+)\s*[=,]/gm, extractor: null }
];

/**
 * Extract individual export names from "export { Foo, Bar as Baz }"
 */
function extractExportNames(match) {
  const inner = match[1] || match[0];
  return inner.split(',')
    .map(s => s.trim().split(/\s+as\s+/)[0].trim())
    .filter(s => s.length > 0 && /^[A-Z]/.test(s) || s.length > 2);
}

/**
 * Extract individual import names from "import { Foo, Bar }"
 */
function extractImportNames(match) {
  const inner = match[1] || match[0];
  return inner.split(',')
    .map(s => s.trim().split(/\s+as\s+/)[0].trim())
    .filter(s => s.length > 0);
}

/**
 * Extract string literal union members from "type Foo = 'a' | 'b' | 'c'"
 */
function extractUnionMembers(match) {
  const line = match[1] || match[0];
  const members = [];
  const re = /['"](\w[\w-]*)['"]/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    members.push(m[1]);
  }
  return members;
}

/**
 * Minimum identifier length to avoid false positives from short strings
 */
const MIN_IDENTIFIER_LENGTH = 3;

/**
 * Common words that appear in diffs but aren't meaningful identifiers
 */
const NOISE_WORDS = new Set([
  'the', 'and', 'for', 'not', 'but', 'are', 'was', 'has', 'had', 'get', 'set',
  'new', 'try', 'var', 'let', 'null', 'true', 'false', 'void', 'this', 'that',
  'from', 'with', 'case', 'else', 'then', 'than', 'each', 'some', 'none',
  'todo', 'fixme', 'hack', 'note', 'import', 'export', 'return', 'const',
  'function', 'class', 'type', 'interface', 'enum', 'default', 'string',
  'number', 'boolean', 'undefined', 'object', 'any', 'unknown'
]);

/**
 * Get removed lines from git diff for specified files
 */
function getRemovedLines(files) {
  const removedByFile = {};

  for (const file of files) {
    try {
      // Get diff showing removed lines only
      const diff = execFileSync('git', [
        'diff', '--unified=0', '--diff-filter=M', '--', file
      ], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Also check staged diff
      let stagedDiff = '';
      try {
        stagedDiff = execFileSync('git', [
          'diff', '--cached', '--unified=0', '--diff-filter=M', '--', file
        ], {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        // No staged changes for this file
      }

      const combinedDiff = diff + '\n' + stagedDiff;

      // Extract removed lines (lines starting with - but not ---)
      const removed = combinedDiff
        .split('\n')
        .filter(line => line.startsWith('-') && !line.startsWith('---'))
        .map(line => line.substring(1)); // Remove the leading -

      if (removed.length > 0) {
        removedByFile[file] = removed;
      }
    } catch (err) {
      // File may not have changes or not be tracked
    }
  }

  return removedByFile;
}

/**
 * Extract identifiers from removed lines that could be referenced elsewhere
 */
function extractRemovedIdentifiers(removedLines, sourceFile) {
  const identifiers = new Set();

  for (const line of removedLines) {
    // Skip comment lines
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
      continue;
    }

    for (const { regex, extractor } of REMOVAL_PATTERNS) {
      // Reset regex state
      regex.lastIndex = 0;
      let match;

      while ((match = regex.exec(line)) !== null) {
        if (extractor) {
          const names = extractor(match);
          for (const name of names) {
            if (name.length >= MIN_IDENTIFIER_LENGTH && !NOISE_WORDS.has(name.toLowerCase())) {
              identifiers.add(name);
            }
          }
        } else if (match[1]) {
          const name = match[1];
          if (name.length >= MIN_IDENTIFIER_LENGTH && !NOISE_WORDS.has(name.toLowerCase())) {
            identifiers.add(name);
          }
        }
      }
    }
  }

  return [...identifiers];
}

/**
 * Search for references to an identifier in the codebase, excluding the source file
 */
function findReferences(identifier, excludeFile) {
  const refs = [];

  try {
    // Use grep to find references — search for the identifier as a word boundary
    const result = execFileSync('grep', [
      '-rn',
      '--include=*.ts',
      '--include=*.tsx',
      '--include=*.js',
      '--include=*.jsx',
      '-w',
      identifier,
      '.'
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const filePath = line.substring(0, colonIdx).replace(/^\.\//, '');

      // Skip the source file itself
      if (filePath === excludeFile || filePath.endsWith(path.basename(excludeFile))) {
        continue;
      }

      // Skip node_modules, dist, .git
      if (filePath.includes('node_modules/') || filePath.includes('dist/') || filePath.startsWith('.git/')) {
        continue;
      }

      // Skip workflow state files and config
      if (filePath.includes('.workflow/state/') || filePath.includes('.workflow/config')) {
        continue;
      }

      refs.push({
        file: filePath,
        line: line.substring(colonIdx + 1).trim()
      });
    }
  } catch (err) {
    // grep returns non-zero if no matches
  }

  return refs;
}

/**
 * Verify that removed exports/types/identifiers are not still referenced by consumers.
 *
 * This is the reverse of verifyWiring():
 * - verifyWiring() checks: "new file → is it imported somewhere?"
 * - verifyRemovalImpact() checks: "removed export → is anything still using it?"
 *
 * @param {string[]} modifiedFiles - Files changed in the current task
 * @returns {{ passed: boolean, orphanedRefs: Array, identifiersChecked: number, warnings: string[] }}
 */
function verifyRemovalImpact(modifiedFiles) {
  const result = {
    passed: true,
    orphanedRefs: [],
    identifiersChecked: 0,
    warnings: []
  };

  if (!modifiedFiles || modifiedFiles.length === 0) {
    result.warnings.push('No modified files to check for removal impact');
    return result;
  }

  // Filter to code files only
  const codeFiles = modifiedFiles.filter(f =>
    VERIFIABLE_EXTENSIONS.some(ext => f.endsWith(ext))
  );

  if (codeFiles.length === 0) {
    return result;
  }

  // Get removed lines from git diff
  const removedByFile = getRemovedLines(codeFiles);

  if (Object.keys(removedByFile).length === 0) {
    return result;
  }

  // For each file with removals, extract identifiers and search for orphaned references
  for (const [file, removedLines] of Object.entries(removedByFile)) {
    const identifiers = extractRemovedIdentifiers(removedLines, file);
    result.identifiersChecked += identifiers.length;

    for (const identifier of identifiers) {
      const refs = findReferences(identifier, file);

      if (refs.length > 0) {
        // Check if the identifier is ALSO in the file's current content (not fully removed)
        let stillExists = false;
        try {
          const currentContent = readFile(path.join(PROJECT_ROOT, file), '');
          if (currentContent.includes(identifier)) {
            stillExists = true;
          }
        } catch (err) {
          // If we can't read the file, assume it was deleted entirely
        }

        // Only flag if the identifier was truly removed (not just moved within the file)
        if (!stillExists) {
          result.passed = false;
          result.orphanedRefs.push({
            identifier,
            removedFrom: file,
            referencedBy: refs.slice(0, 10), // Cap at 10 refs
            totalRefs: refs.length
          });
        }
      }
    }
  }

  return result;
}

/**
 * Format removal impact result for display
 */
function formatRemovalImpactResult(result) {
  const lines = [];

  if (result.passed) {
    if (result.identifiersChecked > 0) {
      lines.push(color('green', `\u2713 Removal impact check passed (${result.identifiersChecked} identifiers verified)`));
    }
  } else {
    lines.push(color('red', `\u2717 Removal impact check FAILED — ${result.orphanedRefs.length} orphaned reference${result.orphanedRefs.length !== 1 ? 's' : ''}`));
    lines.push('');
    lines.push(color('yellow', 'Files still reference removed exports/types:'));

    for (const ref of result.orphanedRefs) {
      lines.push(`  ${color('red', '\u2717')} "${ref.identifier}" removed from ${ref.removedFrom}`);
      for (const consumer of ref.referencedBy.slice(0, 3)) {
        lines.push(`    ${color('dim', `→ ${consumer.file}`)}${consumer.line ? `: ${consumer.line.substring(0, 80)}` : ''}`);
      }
      if (ref.totalRefs > 3) {
        lines.push(`    ${color('dim', `... and ${ref.totalRefs - 3} more reference${ref.totalRefs - 3 !== 1 ? 's' : ''}`)}`);
      }
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`  ${color('yellow', '\u26a0')} ${warning}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

/**
 * Public API:
 * - verifyWiring(taskId) - Verify wiring for a task's deliverables
 * - verifyRemovalImpact(modifiedFiles) - Verify removed exports aren't still referenced
 * - checkFileWiring(filePath) - Check if a single file is wired
 * - formatResult(result) - Format verification result for display
 * - formatRemovalImpactResult(result) - Format removal impact result for display
 *
 * Internal helpers (exported for testing, prefix with _ in future refactor):
 * - isEntryPoint, findImports, extractExportName, parseSpecForWiringRequirements
 * - getRemovedLines, extractRemovedIdentifiers, findReferences
 */
module.exports = {
  // Public API
  verifyWiring,
  verifyRemovalImpact,
  checkFileWiring,
  formatResult,
  formatRemovalImpactResult,

  // Internal helpers (exported for testing)
  isEntryPoint,
  findImports,
  extractExportName,
  parseSpecForWiringRequirements,
  getRemovedLines,
  extractRemovedIdentifiers,
  findReferences
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: flow-wiring-verifier <task-id>');
    console.log('       flow-wiring-verifier check <file-path>');
    console.log('       flow-wiring-verifier removal-check [file1 file2 ...]');
    console.log('');
    console.log('Examples:');
    console.log('  flow-wiring-verifier wf-abc12345');
    console.log('  flow-wiring-verifier check src/components/MyComponent.tsx');
    console.log('  flow-wiring-verifier removal-check src/types.ts src/Tab.tsx');
    process.exit(1);
  }

  if (args[0] === 'check' && args[1]) {
    // Check single file
    const filePath = path.resolve(args[1]);
    const result = checkFileWiring(filePath);

    console.log(`\nWiring check: ${filePath}\n`);
    console.log(`  Entry point: ${result.isEntryPoint ? 'Yes' : 'No'}`);
    console.log(`  Wired: ${result.isWired ? 'Yes' : 'No'}`);

    if (result.importedBy.length > 0) {
      console.log(`  Imported by:`);
      for (const file of result.importedBy.slice(0, 5)) {
        console.log(`    - ${file}`);
      }
      if (result.importedBy.length > 5) {
        console.log(`    ... and ${result.importedBy.length - 5} more`);
      }
    }

    process.exit(result.isWired ? 0 : 1);
  } else if (args[0] === 'removal-check') {
    // Check removal impact for specified files (or all modified files)
    let files = args.slice(1);
    if (files.length === 0) {
      // Default to all modified files from git
      try {
        const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
          cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim().split('\n').filter(Boolean);
        const unstaged = execFileSync('git', ['diff', '--name-only'], {
          cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim().split('\n').filter(Boolean);
        files = [...new Set([...staged, ...unstaged])];
      } catch (err) {
        console.error('Could not get modified files from git');
        process.exit(1);
      }
    }

    console.log(`\nRemoval impact check: ${files.length} file${files.length !== 1 ? 's' : ''}\n`);
    const result = verifyRemovalImpact(files);
    console.log(formatRemovalImpactResult(result));
    console.log('');

    process.exit(result.passed ? 0 : 1);
  } else {
    // Verify task
    const taskId = args[0];
    const result = verifyWiring(taskId);

    console.log('');
    console.log(formatResult(result));
    console.log('');

    process.exit(result.passed ? 0 : 1);
  }
}
