#!/usr/bin/env node

/**
 * Wogi Flow - Rules Sync
 *
 * Syncs decisions.md (source of truth) to .claude/rules/ (Claude Code native format)
 * Each ## section in decisions.md becomes a separate rule file with optional path scoping.
 *
 * Usage:
 *   node scripts/flow-rules-sync.js          # Sync decisions.md to .claude/rules/
 *   node scripts/flow-rules-sync.js --json   # Output JSON result
 *   node scripts/flow-rules-sync.js --dry-run # Preview without writing
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  writeFile,
  dirExists,
  success,
  warn,
  info,
  error,
  parseFlags,
  outputJson
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const RULES_DIR = path.join(PROJECT_ROOT, '.claude', 'rules');

// Keywords that indicate a rule should ALWAYS be applied (not agent_requested)
const ALWAYS_APPLY_KEYWORDS = [
  'general', 'always', 'project', 'naming', 'coding', 'standard',
  'convention', 'must', 'never', 'critical', 'security'
];

// Path scoping based on section title keywords
// These help Claude Code load rules only when working on relevant files
const PATH_SCOPE_MAPPING = {
  // Component-related rules
  'component': 'src/components/**/*',
  'ui': 'src/components/**/*',
  'design': 'src/components/**/*',

  // API/Backend rules
  'api': 'src/api/**/*',
  'backend': 'src/api/**/*',
  'endpoint': 'src/api/**/*',
  'controller': 'src/**/*.controller.*',
  'service': 'src/**/*.service.*',

  // Testing rules
  'test': '**/*.{test,spec}.*',
  'testing': '**/*.{test,spec}.*',

  // Style rules
  'style': '**/*.{css,scss,sass,less}',
  'css': '**/*.{css,scss,sass,less}',

  // Database rules
  'database': 'src/**/*.{entity,model,migration,schema}.*',
  'entity': 'src/**/*.entity.*',
  'model': 'src/**/*.model.*',

  // Config rules
  'config': '*.config.*',
  'configuration': '*.config.*'
};

// ============================================================
// Section Parsing
// ============================================================

/**
 * Parse decisions.md into sections
 * @param {string} content - File content
 * @returns {Array<{title: string, content: string, level: number}>}
 */
function parseMarkdownSections(content) {
  const sections = [];
  const lines = content.split('\n');

  let currentSection = null;
  let currentContent = [];

  for (const line of lines) {
    // Match ## or ### headers (level 2 or 3)
    const headerMatch = line.match(/^(#{2,3})\s+(.+)$/);

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        const trimmedContent = currentContent.join('\n').trim();
        // Only include sections with actual content (not just placeholders)
        if (trimmedContent && !trimmedContent.startsWith('<!--')) {
          sections.push({
            title: currentSection.title,
            content: trimmedContent,
            level: currentSection.level
          });
        }
      }

      // Start new section
      currentSection = {
        title: headerMatch[2].trim(),
        level: headerMatch[1].length
      };
      currentContent = [];
    } else if (currentSection) {
      // Skip section separator lines
      if (line.trim() !== '---') {
        currentContent.push(line);
      }
    }
  }

  // Save last section
  if (currentSection) {
    const trimmedContent = currentContent.join('\n').trim();
    if (trimmedContent && !trimmedContent.startsWith('<!--')) {
      sections.push({
        title: currentSection.title,
        content: trimmedContent,
        level: currentSection.level
      });
    }
  }

  return sections;
}

/**
 * Convert title to filename-safe slug
 * @param {string} title - Section title
 * @returns {string} - Slugified filename
 */
// Local slugify removed in favor of canonical flow-output slugify (wf-7072d3ac).
const { slugify: _slugify } = require('./flow-output');
const slugify = (title) => _slugify(title, { maxLength: 50 });

/**
 * Determine path scope for a section based on title keywords
 * @param {string} title - Section title
 * @returns {string|null} - Glob pattern or null for no scoping
 */
function getPathScope(title) {
  const lowerTitle = title.toLowerCase();

  for (const [keyword, pathPattern] of Object.entries(PATH_SCOPE_MAPPING)) {
    if (lowerTitle.includes(keyword)) {
      return pathPattern;
    }
  }

  return null; // No scoping - rule applies everywhere
}

/**
 * Check if a rule should always be applied based on title keywords
 * @param {string} title - Section title
 * @returns {boolean} - True if rule should always apply
 */
function shouldAlwaysApply(title) {
  const lowerTitle = title.toLowerCase();
  return ALWAYS_APPLY_KEYWORDS.some(keyword => lowerTitle.includes(keyword));
}

/**
 * Extract the first sentence from content for description
 * @param {string} content - Section content
 * @returns {string} - First sentence (max 100 chars)
 */
function extractFirstSentence(content) {
  // Remove markdown formatting
  const cleaned = content
    .replace(/^[-*]\s+/gm, '') // Remove list markers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
    .replace(/`([^`]+)`/g, '$1') // Remove code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
    .trim();

  // Find first sentence
  const sentenceMatch = cleaned.match(/^[^.!?\n]+[.!?]?/);
  if (sentenceMatch) {
    let sentence = sentenceMatch[0].trim();
    if (sentence.length > 100) {
      sentence = sentence.substring(0, 97) + '...';
    }
    return sentence;
  }

  // Fallback to first line
  const firstLine = cleaned.split('\n')[0].trim();
  if (firstLine.length > 100) {
    return firstLine.substring(0, 97) + '...';
  }
  return firstLine || 'Project rule';
}

/**
 * Generate rule file content with frontmatter
 * @param {Object} section - Section object
 * @returns {string} - Rule file content
 */
function generateRuleFile(section) {
  const { title, content } = section;
  const pathScope = getPathScope(title);
  const alwaysApply = shouldAlwaysApply(title);
  const description = extractFirstSentence(content);

  // Always add frontmatter with type and description
  let output = '---\n';
  if (pathScope) {
    output += `globs: ${pathScope}\n`;
  }
  output += `alwaysApply: ${alwaysApply}\n`;
  output += `description: "${title} - ${description.replace(/"/g, '\\"')}"\n`;
  output += '---\n\n';

  // Add header and content
  output += `# ${title}\n\n`;
  output += content;
  output += '\n';

  return output;
}

// ============================================================
// Sync Logic
// ============================================================

/**
 * Sync decisions.md to .claude/rules/
 * @param {Object} options - { dryRun: boolean }
 * @returns {Object} - { success: boolean, files: string[], errors: string[] }
 */
function syncDecisionsToRules(options = {}) {
  const { dryRun = false } = options;
  const result = {
    success: true,
    filesCreated: [],
    filesDeleted: [],
    errors: [],
    skipped: []
  };

  // Read decisions.md
  const decisionsPath = PATHS.decisions;
  if (!fs.existsSync(decisionsPath)) {
    result.errors.push(`decisions.md not found at ${decisionsPath}`);
    result.success = false;
    return result;
  }

  const decisionsContent = readFile(decisionsPath);
  const sections = parseMarkdownSections(decisionsContent);

  if (sections.length === 0) {
    result.skipped.push('No sections with content found in decisions.md');
    return result;
  }

  // Create rules directory if needed
  if (!dryRun) {
    if (!dirExists(RULES_DIR)) {
      fs.mkdirSync(RULES_DIR, { recursive: true });
    }

    // Clean existing generated rules
    try {
      const existingFiles = fs.readdirSync(RULES_DIR);
      for (const file of existingFiles) {
        if (file.endsWith('.md') && file !== 'README.md') {
          const filePath = path.join(RULES_DIR, file);
          fs.unlinkSync(filePath);
          result.filesDeleted.push(file);
        }
      }
    } catch (err) {
      result.errors.push(`Error cleaning rules directory: ${err.message}`);
    }
  }

  // Generate rule files
  for (const section of sections) {
    const filename = slugify(section.title) + '.md';
    const filePath = path.join(RULES_DIR, filename);
    const content = generateRuleFile(section);

    if (!dryRun) {
      try {
        writeFile(filePath, content);
        result.filesCreated.push(filename);
      } catch (err) {
        result.errors.push(`Error writing ${filename}: ${err.message}`);
        result.success = false;
      }
    } else {
      result.filesCreated.push(filename);
    }
  }

  // Create/update README
  if (!dryRun) {
    const readmePath = path.join(RULES_DIR, 'README.md');
    const readmeContent = `# Auto-Generated Rules

This directory is auto-generated from \`.workflow/state/decisions.md\`.

**DO NOT EDIT THESE FILES DIRECTLY.**

Edit \`decisions.md\` instead, then run:
\`\`\`bash
node scripts/flow-rules-sync.js
\`\`\`

Or rules will auto-sync when decisions.md is updated.

## How It Works

- Each section in decisions.md becomes a separate rule file
- Rules are path-scoped based on section keywords (e.g., "component" rules only load for component files)
- Claude Code automatically loads these rules for context-aware guidance

## Rule Types

Rules have \`alwaysApply\` frontmatter that determines loading behavior:

- **\`alwaysApply: true\`** - Always loaded (rules with: general, always, project, naming, coding, standard, convention, must, never, critical, security in title)
- **\`alwaysApply: false\`** - Agent-requested: Claude decides whether to load based on description relevance to current task

This saves tokens by not loading React rules when working on backend code, etc.

## Files

${result.filesCreated.map(f => `- ${f}`).join('\n')}

Last synced: ${new Date().toISOString()}
`;
    writeFile(readmePath, readmeContent);
  }

  return result;
}

// ============================================================
// Main
// ============================================================

function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: node scripts/flow-rules-sync.js [options]

Sync decisions.md to .claude/rules/ for Claude Code integration.

Options:
  --dry-run   Preview changes without writing files
  --json      Output result as JSON
  --help      Show this help message

Examples:
  node scripts/flow-rules-sync.js           # Sync rules
  node scripts/flow-rules-sync.js --dry-run # Preview sync
`);
    process.exit(0);
  }

  const result = syncDecisionsToRules({ dryRun: flags.dryRun || flags['dry-run'] });

  if (flags.json) {
    outputJson(result);
    return;
  }

  // Human-readable output
  if (flags.dryRun || flags['dry-run']) {
    info('Dry run - no files written');
  }

  if (result.filesDeleted.length > 0) {
    info(`Cleaned ${result.filesDeleted.length} existing rule files`);
  }

  if (result.filesCreated.length > 0) {
    success(`Generated ${result.filesCreated.length} rule files:`);
    for (const file of result.filesCreated) {
      console.log(`  - ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    for (const msg of result.skipped) {
      warn(msg);
    }
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
    process.exit(1);
  }

  if (result.success) {
    success('Rules synced to .claude/rules/');
  }
}

// Export for use by other scripts
module.exports = {
  syncDecisionsToRules,
  parseMarkdownSections,
  slugify,
  getPathScope,
  shouldAlwaysApply,
  extractFirstSentence,
  generateRuleFile,
  RULES_DIR,
  ALWAYS_APPLY_KEYWORDS
};

// Run if called directly
if (require.main === module) {
  main();
}
