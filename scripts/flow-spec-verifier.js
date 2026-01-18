#!/usr/bin/env node

/**
 * Wogi Flow - Spec Verifier
 *
 * Parses spec files to extract promised deliverables (files to create/modify)
 * and verifies they exist before allowing task completion.
 *
 * This prevents implementation gaps where specs promise files that are never created.
 *
 * Usage:
 *   const { verifySpecDeliverables } = require('./flow-spec-verifier');
 *   const result = verifySpecDeliverables('wf-XXXXXXXX');
 *   if (!result.passed) {
 *     console.log('Missing:', result.missing);
 *   }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  PATHS,
  getConfig,
  success,
  warn,
  error,
  info,
  color,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * Patterns for extracting file paths from spec content
 */
const FILE_EXTRACTION_PATTERNS = [
  // Markdown table cells with backticked paths
  // | `scripts/flow-foo.js` | Description |
  {
    name: 'table-backtick',
    pattern: /\|\s*`([^`]+\.[a-z]+)`\s*\|/gi,
    group: 1
  },
  // Markdown table cells with plain paths
  // | scripts/flow-foo.js | Description |
  {
    name: 'table-plain',
    pattern: /\|\s*((?:scripts|src|\.claude|\.workflow)\/[^\s|]+\.[a-z]+)\s*\|/gi,
    group: 1
  },
  // Backticked paths in lists
  // - `scripts/flow-foo.js`
  // - Create `scripts/flow-foo.js`
  {
    name: 'list-backtick',
    pattern: /[-*]\s*(?:Create\s+|Modify\s+|Update\s+)?`([^`]+\.[a-z]+)`/gi,
    group: 1
  },
  // Code blocks with file paths (as comments or strings)
  // // File: scripts/flow-foo.js
  // 'scripts/flow-foo.js'
  {
    name: 'code-comment',
    pattern: /(?:\/\/\s*(?:File|Path):?\s*|['"])([^\s'"]+\.[a-z]+)/gi,
    group: 1
  },
  // Inline backticked paths that look like files
  // The file `scripts/flow-foo.js` should...
  {
    name: 'inline-backtick',
    pattern: /`((?:scripts|src|\.claude|\.workflow|config)[^\s`]*\.[a-z]+)`/gi,
    group: 1
  }
];

/**
 * Section headers that indicate file lists (INCLUDE these)
 */
const FILE_SECTION_HEADERS = [
  /^#+\s*(?:New\s+)?Files?\s*(?:to\s+)?(?:Create|Created)?\s*\(?/i,
  /^#+\s*(?:Modified|Changed)\s+Files?\s*/i,
  /^#+\s*Files?\s+Summary/i,
  /^#+\s*Implementation\s+(?:Files|Summary)/i,
  /^#+\s*Deliverables/i,
  /^#+\s*Technical\s+Notes/i,
  /^#+\s*Components/i
];

/**
 * Section headers that contain EXAMPLES, not real deliverables (EXCLUDE these)
 */
const EXAMPLE_SECTION_HEADERS = [
  /^#+\s*Acceptance\s+Criteria/i,
  /^#+\s*Scenario\s+\d+/i,
  /^#+\s*Test\s+Strategy/i,
  /^#+\s*Examples?/i,
  /^#+\s*Out\s+of\s+Scope/i,
  /^#+\s*User\s+Story/i
];

// ============================================================
// Spec File Discovery
// ============================================================

/**
 * Find spec file for a task
 * @param {string} taskId - Task ID
 * @returns {string|null} Path to spec file or null
 */
function findSpecFile(taskId) {
  // Check .workflow/changes/ for task-specific spec
  const changesDir = path.join(PATHS.workflow, 'changes');

  // Direct match: wf-XXXXXXXX.md
  const directPath = path.join(changesDir, `${taskId}.md`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // Check subdirectories
  if (fs.existsSync(changesDir)) {
    try {
      const subdirs = fs.readdirSync(changesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const subdir of subdirs) {
        const subPath = path.join(changesDir, subdir, `${taskId}.md`);
        if (fs.existsSync(subPath)) {
          return subPath;
        }
      }
    } catch (err) {
      // readdirSync failed (permission error, etc.)
      if (process.env.DEBUG) console.error(`[DEBUG] Failed to read changes dir: ${err.message}`);
    }
  }

  // Check for *-spec.md files that might reference the task
  // Escape taskId to prevent ReDoS
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedTaskIdShort = taskId.replace('wf-', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specPattern = new RegExp(`${escapedTaskId}|${escapedTaskIdShort}`, 'i');
  if (fs.existsSync(changesDir)) {
    try {
      const files = fs.readdirSync(changesDir)
        .filter(f => f.endsWith('-spec.md') || f.endsWith('-spec-final.md'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(changesDir, file), 'utf-8');
          if (specPattern.test(content)) {
            return path.join(changesDir, file);
          }
        } catch (err) {
          // File read failed (race condition, permission), skip this file
          if (process.env.DEBUG) console.error(`[DEBUG] Failed to read ${file}: ${err.message}`);
        }
      }
    } catch (err) {
      // readdirSync failed
      if (process.env.DEBUG) console.error(`[DEBUG] Failed to read changes dir: ${err.message}`);
    }
  }

  return null;
}

/**
 * Find all potential spec files for a task (including related specs)
 * @param {string} taskId - Task ID
 * @returns {string[]} Array of spec file paths
 */
function findAllRelatedSpecs(taskId) {
  const specs = [];
  const mainSpec = findSpecFile(taskId);
  if (mainSpec) specs.push(mainSpec);

  // Also check for -final versions
  const changesDir = path.join(PATHS.workflow, 'changes');
  if (fs.existsSync(changesDir)) {
    const files = fs.readdirSync(changesDir);

    // Find specs with similar names
    const taskBase = taskId.replace('wf-', '');
    for (const file of files) {
      if (file.includes(taskBase) && file.endsWith('.md')) {
        const fullPath = path.join(changesDir, file);
        if (!specs.includes(fullPath)) {
          specs.push(fullPath);
        }
      }
    }
  }

  return specs;
}

// ============================================================
// Spec Parsing
// ============================================================

/**
 * Parse a spec file and extract deliverables
 * Uses section-aware parsing to distinguish real deliverables from examples
 * @param {string} specPath - Path to spec file
 * @returns {Object} Parsed deliverables
 */
function parseSpecDeliverables(specPath) {
  if (!fs.existsSync(specPath)) {
    return { error: `Spec file not found: ${specPath}`, files: [] };
  }

  // Wrap in try-catch per security pattern #1 (race conditions, permissions)
  let content;
  try {
    content = fs.readFileSync(specPath, 'utf-8');
  } catch (err) {
    return { error: `Failed to read spec file: ${err.message}`, files: [] };
  }

  const deliverables = {
    specPath,
    newFiles: [],
    modifiedFiles: [],
    allFiles: [],
    sections: []
  };

  // Split content into sections for targeted extraction
  // Track code blocks to avoid parsing headers inside them
  const lines = content.split('\n');
  const sections = [];
  let currentSection = { name: 'preamble', content: [], isExample: false };
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code block state
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      currentSection.content.push(line);
      continue;
    }

    // If inside a code block, treat as content (not headers)
    if (inCodeBlock) {
      currentSection.content.push(line);
      continue;
    }

    // Check if this is a header (only outside code blocks)
    if (/^#+\s+/.test(line)) {
      // Save previous section
      if (currentSection.content.length > 0) {
        sections.push(currentSection);
      }

      // Determine if this is an example section
      const isExample = EXAMPLE_SECTION_HEADERS.some(p => p.test(line));
      const isFileSection = FILE_SECTION_HEADERS.some(p => p.test(line));

      currentSection = {
        name: line.trim(),
        content: [],
        isExample,
        isFileSection
      };

      if (isFileSection) {
        deliverables.sections.push(line.trim());
      }
    } else {
      currentSection.content.push(line);
    }
  }
  // Add final section
  if (currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  // Extract files only from non-example sections
  const foundFiles = new Map(); // path -> section info

  for (const section of sections) {
    // Skip example sections (acceptance criteria, scenarios, etc.)
    if (section.isExample) {
      continue;
    }

    const sectionContent = section.content.join('\n');

    for (const patternDef of FILE_EXTRACTION_PATTERNS) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = regex.exec(sectionContent)) !== null) {
        const filePath = match[patternDef.group];

        // Validate it looks like a real file path
        if (isValidFilePath(filePath) && !foundFiles.has(filePath)) {
          foundFiles.set(filePath, section.name);
        }
      }
    }
  }

  // Categorize files
  for (const [filePath, sectionName] of foundFiles) {
    // Determine if new or modified based on context
    const isNew = isLikelyNewFile(content, filePath);

    if (isNew) {
      deliverables.newFiles.push(filePath);
    } else {
      deliverables.modifiedFiles.push(filePath);
    }

    deliverables.allFiles.push({
      path: filePath,
      type: isNew ? 'new' : 'modified',
      section: sectionName
    });
  }

  return deliverables;
}

/**
 * Check if a string looks like a valid file path
 * @param {string} str - String to check
 * @returns {boolean}
 */
function isValidFilePath(str) {
  if (!str || str.length < 3) return false;

  // Must have an extension
  if (!/\.[a-z]{1,4}$/i.test(str)) return false;

  // Filter out URLs
  if (/^https?:\/\//i.test(str)) return false;

  // Filter out version strings
  if (/^\d+\.\d+\.\d+/.test(str)) return false;

  // Filter out glob patterns
  if (/\*/.test(str)) return false;

  // Filter out template placeholders
  if (/\{|\}|\[|\]/.test(str)) return false;

  // Must look like a path
  if (!/[/\\]/.test(str) && !/^\./.test(str)) {
    // Single filename must be in known directory patterns
    return false;
  }

  // Filter out common false positives
  const falsePositives = [
    'package.json', // Usually means "modify", not the file itself
    'node_modules',
    '.git',
    '.env'
  ];

  for (const fp of falsePositives) {
    if (str === fp) return false;
  }

  return true;
}

/**
 * Determine if a file is likely new or modified based on context
 * @param {string} content - Spec content
 * @param {string} filePath - File path
 * @returns {boolean} True if likely new
 */
function isLikelyNewFile(content, filePath) {
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Check context around file mention
  const patterns = [
    new RegExp(`create[^\\n]*${escapedPath}`, 'i'),
    new RegExp(`new[^\\n]*${escapedPath}`, 'i'),
    new RegExp(`${escapedPath}[^\\n]*\\(new\\)`, 'i'),
    new RegExp(`\\|\\s*Create\\s*\\|[^|]*${escapedPath}`, 'i')
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) return true;
  }

  // Check if under "New Files" section
  const newFilesMatch = content.match(/#{1,3}\s*New\s+Files[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n*$)/i);
  if (newFilesMatch && newFilesMatch[1].includes(filePath)) {
    return true;
  }

  // Default: check if file exists (if exists, it's modified; if not, it's new)
  return !fs.existsSync(filePath);
}

/**
 * Find which section a file was mentioned in
 * @param {string} content - Spec content
 * @param {string} filePath - File path
 * @returns {string|null} Section name
 */
function findFileSection(content, filePath) {
  const lines = content.split('\n');
  let currentSection = null;

  for (const line of lines) {
    // Track section headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      currentSection = headerMatch[2].trim();
    }

    // Check if this line contains the file
    if (line.includes(filePath)) {
      return currentSection;
    }
  }

  return null;
}

// ============================================================
// File Verification
// ============================================================

/**
 * Verify a single file exists and is valid
 * @param {string} filePath - Path to verify
 * @param {Object} options - Verification options
 * @returns {Object} Verification result
 */
function verifyFile(filePath, options = {}) {
  const { validateSyntax = true } = options;

  const result = {
    path: filePath,
    exists: false,
    syntaxValid: null,
    error: null
  };

  // Check existence
  if (!fs.existsSync(filePath)) {
    result.error = 'File does not exist';
    return result;
  }

  result.exists = true;

  // Check if empty
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    result.error = 'File is empty';
    return result;
  }

  // Validate syntax based on extension
  if (validateSyntax) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      try {
        // Use execFileSync with array args to prevent command injection
        execFileSync('node', ['--check', filePath], { stdio: 'pipe' });
        result.syntaxValid = true;
      } catch (err) {
        result.syntaxValid = false;
        result.error = `Syntax error: ${err.message.split('\n')[0]}`;
      }
    } else if (ext === '.json') {
      // Use safeJsonParse per security pattern (prototype pollution protection)
      const parsed = safeJsonParse(filePath, null);
      if (parsed === null) {
        // safeJsonParse returns null on error
        result.syntaxValid = false;
        result.error = 'Invalid JSON or failed to parse';
      } else {
        result.syntaxValid = true;
      }
    } else if (ext === '.ts' || ext === '.tsx') {
      // For TypeScript, just check file is non-empty
      // Full type checking is too slow for verification
      result.syntaxValid = true;
    } else if (ext === '.md') {
      result.syntaxValid = true;
    } else {
      result.syntaxValid = true; // Skip syntax check for unknown types
    }
  }

  return result;
}

/**
 * Verify all deliverables from a spec
 * @param {Object} deliverables - Parsed deliverables
 * @param {Object} options - Verification options
 * @returns {Object} Verification results
 */
function verifyDeliverables(deliverables, options = {}) {
  const results = {
    specPath: deliverables.specPath,
    totalFiles: deliverables.allFiles.length,
    verified: 0,
    missing: [],
    invalid: [],
    passed: true
  };

  if (deliverables.allFiles.length === 0) {
    results.noDeliverables = true;
    return results;
  }

  for (const file of deliverables.allFiles) {
    const verification = verifyFile(file.path, options);

    if (!verification.exists) {
      results.missing.push({
        ...file,
        error: verification.error
      });
      results.passed = false;
    } else if (verification.syntaxValid === false) {
      results.invalid.push({
        ...file,
        error: verification.error
      });
      results.passed = false;
    } else {
      results.verified++;
    }
  }

  return results;
}

// ============================================================
// Main Verification Function
// ============================================================

/**
 * Verify spec deliverables for a task
 * @param {string} taskId - Task ID
 * @param {Object} options - Options
 * @returns {Object} Verification result
 */
function verifySpecDeliverables(taskId, options = {}) {
  const config = getConfig();
  const specConfig = config.tasks?.specVerification || {};

  const {
    validateSyntax = specConfig.validateSyntax !== false,
    allowSkipWithFlag = specConfig.allowSkipWithFlag !== false,
    skipCheck = false
  } = options;

  // Find spec file
  const specPath = findSpecFile(taskId);

  if (!specPath) {
    return {
      taskId,
      hasSpec: false,
      skipped: true,
      reason: 'No spec file found for task',
      passed: true // No spec = no verification needed
    };
  }

  // Check if verification should be skipped
  if (skipCheck) {
    if (!allowSkipWithFlag) {
      return {
        taskId,
        hasSpec: true,
        specPath,
        passed: false,
        error: 'Spec verification cannot be skipped (config: allowSkipWithFlag is false)'
      };
    }

    return {
      taskId,
      hasSpec: true,
      specPath,
      skipped: true,
      reason: 'Verification skipped with --skip-spec-check flag',
      passed: true,
      warning: 'Spec verification was skipped - deliverables not verified'
    };
  }

  // Parse spec
  const deliverables = parseSpecDeliverables(specPath);

  if (deliverables.error) {
    return {
      taskId,
      hasSpec: true,
      specPath,
      passed: false,
      error: deliverables.error
    };
  }

  if (deliverables.allFiles.length === 0) {
    return {
      taskId,
      hasSpec: true,
      specPath,
      passed: true,
      noDeliverables: true,
      message: 'Spec found but no file deliverables detected'
    };
  }

  // Verify deliverables
  const verification = verifyDeliverables(deliverables, { validateSyntax });

  return {
    taskId,
    hasSpec: true,
    specPath,
    deliverables: deliverables.allFiles,
    ...verification
  };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format verification results for display
 * @param {Object} results - Verification results
 * @returns {string} Formatted output
 */
function formatVerificationResults(results) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Spec Verification');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  if (!results.hasSpec) {
    lines.push('ℹ No spec file found - verification skipped');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Spec: ${results.specPath}`);
  lines.push('');

  if (results.skipped) {
    lines.push(`⚠ ${results.reason || 'Verification skipped'}`);
    if (results.warning) {
      lines.push(`  ${results.warning}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  if (results.noDeliverables) {
    lines.push('ℹ No file deliverables detected in spec');
    lines.push('');
    return lines.join('\n');
  }

  // Show results
  const icon = results.passed ? '✓' : '✗';
  const status = results.passed ? 'passed' : 'FAILED';

  lines.push(`${icon} Spec verification ${status} (${results.verified}/${results.totalFiles} deliverables)`);
  lines.push('');

  if (results.missing.length > 0) {
    lines.push('Missing files:');
    for (const file of results.missing) {
      lines.push(`  ✗ ${file.path}`);
      if (file.section) {
        lines.push(`    (listed in: ${file.section})`);
      }
    }
    lines.push('');
  }

  if (results.invalid.length > 0) {
    lines.push('Invalid files:');
    for (const file of results.invalid) {
      lines.push(`  ✗ ${file.path}`);
      lines.push(`    ${file.error}`);
    }
    lines.push('');
  }

  if (!results.passed) {
    lines.push('To proceed anyway, use: --skip-spec-check');
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Discovery
  findSpecFile,
  findAllRelatedSpecs,

  // Parsing
  parseSpecDeliverables,

  // Verification
  verifyFile,
  verifyDeliverables,
  verifySpecDeliverables,

  // Formatting
  formatVerificationResults,

  // Constants (for testing)
  FILE_EXTRACTION_PATTERNS,
  FILE_SECTION_HEADERS
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'verify': {
      const taskId = args[1];
      if (!taskId) {
        error('Usage: flow-spec-verifier verify <taskId>');
        process.exit(1);
      }

      const skipCheck = args.includes('--skip-spec-check');
      const results = verifySpecDeliverables(taskId, { skipCheck });

      console.log(formatVerificationResults(results));

      if (!results.passed && !results.skipped) {
        process.exit(1);
      }
      break;
    }

    case 'parse': {
      const specPath = args[1];
      if (!specPath) {
        error('Usage: flow-spec-verifier parse <spec-path>');
        process.exit(1);
      }

      const deliverables = parseSpecDeliverables(specPath);
      console.log(JSON.stringify(deliverables, null, 2));
      break;
    }

    case 'find': {
      const taskId = args[1];
      if (!taskId) {
        error('Usage: flow-spec-verifier find <taskId>');
        process.exit(1);
      }

      const specPath = findSpecFile(taskId);
      if (specPath) {
        success(`Found spec: ${specPath}`);
      } else {
        warn('No spec file found');
      }
      break;
    }

    default:
      console.log(`
Spec Verifier

Usage: node flow-spec-verifier <command> [options]

Commands:
  verify <taskId>     Verify all deliverables from task's spec
  parse <spec-path>   Parse a spec file and show deliverables
  find <taskId>       Find spec file for a task

Options:
  --skip-spec-check   Skip verification (with warning)

Examples:
  node flow-spec-verifier verify wf-abc123
  node flow-spec-verifier parse .workflow/changes/my-spec.md
  node flow-spec-verifier find wf-abc123
`);
  }
}
