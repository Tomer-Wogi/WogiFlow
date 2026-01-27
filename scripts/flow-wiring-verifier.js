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
  color
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
 * Find a file by partial name in common directories
 */
function findFileByName(filename) {
  const basename = path.basename(filename);

  for (const dir of SEARCH_DIRS) {
    const searchDir = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(searchDir)) continue;

    try {
      // Use execFileSync with array arguments to prevent command injection
      const result = execFileSync('find', [
        searchDir,
        '-name',
        basename,
        '-type',
        'f'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const files = result.trim().split('\n').filter(Boolean);
      if (files.length > 0) {
        return files[0]; // Return first match
      }
    } catch (err) {
      // Ignore errors (find returns non-zero if no matches on some systems)
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
// Exports
// ============================================================

/**
 * Public API:
 * - verifyWiring(taskId) - Verify wiring for a task's deliverables
 * - checkFileWiring(filePath) - Check if a single file is wired
 * - formatResult(result) - Format verification result for display
 *
 * Internal helpers (exported for testing, prefix with _ in future refactor):
 * - isEntryPoint, findImports, extractExportName, parseSpecForWiringRequirements
 */
module.exports = {
  // Public API
  verifyWiring,
  checkFileWiring,
  formatResult,

  // Internal helpers (exported for testing)
  isEntryPoint,
  findImports,
  extractExportName,
  parseSpecForWiringRequirements
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: flow-wiring-verifier <task-id>');
    console.log('       flow-wiring-verifier check <file-path>');
    console.log('');
    console.log('Examples:');
    console.log('  flow-wiring-verifier wf-abc12345');
    console.log('  flow-wiring-verifier check src/components/MyComponent.tsx');
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
