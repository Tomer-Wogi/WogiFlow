#!/usr/bin/env node

/**
 * Wogi Flow - Skill Learning Engine
 *
 * Extracts learnings from work and updates skills automatically.
 * Called by:
 *   - Pre-commit hook (--trigger=commit)
 *   - Task completion (--trigger=task)
 *   - Context compaction (--trigger=compact)
 *   - Manual invocation (--trigger=manual)
 *
 * Usage:
 *   flow skill-learn                    # Auto-detect trigger
 *   flow skill-learn --trigger=commit   # Called from pre-commit
 *   flow skill-learn --skill=nestjs     # Target specific skill
 *   flow skill-learn --dry-run          # Show what would be updated
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getProjectRoot, getConfig, colors } = require('./flow-utils');
const { getAllSkills, getSkillDir } = require('./flow-skill-matcher');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const SKILLS_DIR = path.join(PROJECT_ROOT, '.claude', 'skills');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

// Alias getConfig as loadConfig for minimal code changes
const loadConfig = getConfig;

function isLearningEnabled(config, trigger) {
  if (!config?.skillLearning?.enabled) return false;
  if (!config?.skillLearning?.autoExtract) return false;

  const triggers = config.skillLearning.triggers || {};
  switch (trigger) {
    case 'commit': return triggers.onCommit !== false;
    case 'task': return triggers.onTaskComplete !== false;
    case 'compact': return triggers.onCompact !== false;
    case 'manual': return true;
    default: return true;
  }
}

// ============================================================
// Skill Discovery (delegates to flow-skill-matcher.js)
// ============================================================

function discoverSkills() {
  const allSkills = getAllSkills();
  return allSkills.map(s => {
    const skillPath = getSkillDir(s.name);
    return {
      name: s.name,
      path: skillPath,
      version: s.metadata?.version || '1.0.0',
      description: s.metadata?.description || '',
      filePatterns: s.filePatterns || [],
      hasKnowledge: fs.existsSync(path.join(skillPath, 'knowledge'))
    };
  });
}

// ============================================================
// Change Analysis
// ============================================================

function getChangedFiles(staged = false) {
  try {
    const cmd = staged
      ? 'git diff --cached --name-only'
      : 'git diff HEAD --name-only';
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    return [];
  }
}

function getRecentCommitFiles(count = 1) {
  try {
    const cmd = `git diff HEAD~${count} --name-only`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    return [];
  }
}

function matchFilesToSkills(files, skills) {
  const matches = new Map(); // skill -> files
  const unmatched = [];

  for (const file of files) {
    let matched = false;

    for (const skill of skills) {
      for (const pattern of skill.filePatterns) {
        if (matchPattern(file, pattern)) {
          if (!matches.has(skill.name)) {
            matches.set(skill.name, []);
          }
          matches.get(skill.name).push(file);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      unmatched.push(file);
    }
  }

  return { matches, unmatched };
}

function matchPattern(file, pattern) {
  // Simple glob matching
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(regex).test(file);
}

// ============================================================
// Semantic Diff Analysis
// ============================================================

/**
 * Extract semantic changes from git diff
 * Analyzes what actually changed, not just which files
 */
function extractSemanticChanges(files, staged = false) {
  const changes = [];

  for (const file of files) {
    try {
      const cmd = staged
        ? `git diff --cached -U3 -- "${file}"`
        : `git diff HEAD -U3 -- "${file}"`;
      const diff = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

      if (!diff.trim()) continue;

      const fileChanges = analyzeDiff(diff, file);
      if (fileChanges.length > 0) {
        changes.push({ file, changes: fileChanges });
      }
    } catch (err) {
      // Skip files that can't be diffed
    }
  }

  return changes;
}

/**
 * Analyze a diff to extract semantic patterns
 */
function analyzeDiff(diff, filename) {
  const changes = [];
  const lines = diff.split('\n');
  const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---'));

  // Detect function signature changes
  const funcSigChanges = detectFunctionSignatureChanges(added, removed);
  if (funcSigChanges.length > 0) {
    changes.push(...funcSigChanges);
  }

  // Detect import changes
  const importChanges = detectImportChanges(added, removed);
  if (importChanges.length > 0) {
    changes.push(...importChanges);
  }

  // Detect type annotation changes (TypeScript)
  const typeChanges = detectTypeChanges(added, removed);
  if (typeChanges.length > 0) {
    changes.push(...typeChanges);
  }

  // Detect pattern adoption (error handling, null checks, etc.)
  const patternChanges = detectPatternChanges(added, removed);
  if (patternChanges.length > 0) {
    changes.push(...patternChanges);
  }

  // Detect naming convention changes
  const namingChanges = detectNamingChanges(added, removed, filename);
  if (namingChanges.length > 0) {
    changes.push(...namingChanges);
  }

  return changes;
}

function detectFunctionSignatureChanges(added, removed) {
  const changes = [];
  const funcRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*)?(?:\([^)]*\)|async\s*\([^)]*\))/;
  const arrowRegex = /(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:=>|:)/;

  const removedFuncs = new Map();
  const addedFuncs = new Map();

  for (const line of removed) {
    const match = line.match(funcRegex) || line.match(arrowRegex);
    if (match) {
      removedFuncs.set(match[1], line.slice(1).trim());
    }
  }

  for (const line of added) {
    const match = line.match(funcRegex) || line.match(arrowRegex);
    if (match) {
      addedFuncs.set(match[1], line.slice(1).trim());
    }
  }

  // Find functions that were modified (same name, different signature)
  for (const [name, oldSig] of removedFuncs) {
    if (addedFuncs.has(name)) {
      const newSig = addedFuncs.get(name);
      if (oldSig !== newSig) {
        changes.push({
          type: 'function_signature',
          name,
          before: oldSig,
          after: newSig
        });
      }
    }
  }

  return changes;
}

function detectImportChanges(added, removed) {
  const changes = [];
  const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/;
  const requireRegex = /(?:const|let|var)\s+(?:{[^}]+}|\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/;

  const removedImports = new Set();
  const addedImports = new Set();

  for (const line of removed) {
    const match = line.match(importRegex) || line.match(requireRegex);
    if (match) {
      removedImports.add(match[1]);
    }
  }

  for (const line of added) {
    const match = line.match(importRegex) || line.match(requireRegex);
    if (match) {
      addedImports.add(match[1]);
    }
  }

  // New imports
  for (const imp of addedImports) {
    if (!removedImports.has(imp)) {
      changes.push({ type: 'import_added', module: imp });
    }
  }

  // Removed imports
  for (const imp of removedImports) {
    if (!addedImports.has(imp)) {
      changes.push({ type: 'import_removed', module: imp });
    }
  }

  return changes;
}

function detectTypeChanges(added, removed) {
  const changes = [];
  const typeAnnotationRegex = /:\s*([\w<>\[\]|&\s,]+)(?:\s*[=;,)])/;

  // Check for type annotation additions
  const addedTypes = added.filter(l => typeAnnotationRegex.test(l));
  const removedTypes = removed.filter(l => typeAnnotationRegex.test(l));

  if (addedTypes.length > removedTypes.length) {
    changes.push({
      type: 'type_annotation',
      pattern: 'Added type annotations',
      count: addedTypes.length - removedTypes.length
    });
  }

  // Check for specific type improvements (any -> specific type)
  for (const line of removed) {
    if (line.includes(': any') || line.includes(':any')) {
      for (const addLine of added) {
        if (!addLine.includes(': any') && !addLine.includes(':any')) {
          const match = addLine.match(typeAnnotationRegex);
          if (match && match[1] !== 'any') {
            changes.push({
              type: 'type_improvement',
              pattern: 'Replaced any with specific type',
              newType: match[1].trim()
            });
            break;
          }
        }
      }
    }
  }

  return changes;
}

function detectPatternChanges(added, removed) {
  const changes = [];
  const patterns = [
    { name: 'null_check', regex: /\?\.|if\s*\([^)]*(?:===?\s*null|!==?\s*null|!=\s*undefined)/ },
    { name: 'error_handling', regex: /try\s*{|catch\s*\(|\.catch\(/ },
    { name: 'async_await', regex: /async\s+(?:function|\()|\bawait\s/ },
    { name: 'optional_chaining', regex: /\?\.\w+|\?\[/ },
    { name: 'nullish_coalescing', regex: /\?\?/ },
    { name: 'early_return', regex: /^\s*if\s*\([^)]+\)\s*return/ }
  ];

  for (const { name, regex } of patterns) {
    const addedCount = added.filter(l => regex.test(l)).length;
    const removedCount = removed.filter(l => regex.test(l)).length;

    if (addedCount > removedCount) {
      changes.push({
        type: 'pattern_adoption',
        pattern: name,
        added: addedCount - removedCount
      });
    } else if (removedCount > addedCount) {
      changes.push({
        type: 'pattern_removal',
        pattern: name,
        removed: removedCount - addedCount
      });
    }
  }

  return changes;
}

function detectNamingChanges(added, removed, filename) {
  const changes = [];

  // Check for consistent naming pattern adoption
  const camelCaseRegex = /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g;
  const snakeCaseRegex = /\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*\b/g;
  const kebabCaseRegex = /['"][a-z][a-z0-9]*-[a-z][a-z0-9-]*['"]/g;

  const addedCamel = added.join(' ').match(camelCaseRegex)?.length || 0;
  const removedCamel = removed.join(' ').match(camelCaseRegex)?.length || 0;
  const addedSnake = added.join(' ').match(snakeCaseRegex)?.length || 0;
  const removedSnake = removed.join(' ').match(snakeCaseRegex)?.length || 0;

  // Detect migration from snake_case to camelCase
  if (addedCamel > removedCamel && removedSnake > addedSnake) {
    changes.push({
      type: 'naming_convention',
      pattern: 'Migrated from snake_case to camelCase'
    });
  }

  return changes;
}

/**
 * Format semantic changes for human-readable output
 */
function formatSemanticChanges(semanticChanges) {
  if (!semanticChanges || semanticChanges.length === 0) {
    return '';
  }

  const lines = [];

  for (const { file, changes } of semanticChanges) {
    if (changes.length === 0) continue;

    for (const change of changes) {
      switch (change.type) {
        case 'function_signature':
          lines.push(`- **Function signature changed**: \`${change.name}\``);
          lines.push(`  - Before: \`${change.before.slice(0, 60)}${change.before.length > 60 ? '...' : ''}\``);
          lines.push(`  - After: \`${change.after.slice(0, 60)}${change.after.length > 60 ? '...' : ''}\``);
          break;
        case 'import_added':
          lines.push(`- **New import**: \`${change.module}\``);
          break;
        case 'import_removed':
          lines.push(`- **Removed import**: \`${change.module}\``);
          break;
        case 'type_annotation':
          lines.push(`- **Added ${change.count} type annotation(s)**`);
          break;
        case 'type_improvement':
          lines.push(`- **Improved typing**: Replaced \`any\` with \`${change.newType}\``);
          break;
        case 'pattern_adoption':
          lines.push(`- **Adopted pattern**: ${change.pattern.replace(/_/g, ' ')} (+${change.added})`);
          break;
        case 'pattern_removal':
          lines.push(`- **Removed pattern**: ${change.pattern.replace(/_/g, ' ')} (-${change.removed})`);
          break;
        case 'naming_convention':
          lines.push(`- **Naming**: ${change.pattern}`);
          break;
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

// ============================================================
// Learning Extraction
// ============================================================

function extractLearningContext(files, trigger, staged = false) {
  const context = {
    trigger,
    timestamp: new Date().toISOString(),
    files,
    summary: '',
    type: 'observation', // observation | correction | pattern | anti-pattern
    semanticChanges: []
  };

  // Try to get commit message for context
  if (trigger === 'commit') {
    try {
      const msg = execSync('git log -1 --format=%B', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      context.summary = msg.trim().split('\n')[0];
    } catch (err) {
      context.summary = `Changed ${files.length} files`;
    }
  } else {
    context.summary = `${trigger}: Changed ${files.length} files`;
  }

  // Detect if this looks like a fix/correction
  const lowerSummary = context.summary.toLowerCase();
  if (lowerSummary.includes('fix') || lowerSummary.includes('bug') || lowerSummary.includes('error')) {
    context.type = 'correction';
  } else if (lowerSummary.includes('refactor') || lowerSummary.includes('improve')) {
    context.type = 'pattern';
  }

  // Extract semantic changes from the diff
  context.semanticChanges = extractSemanticChanges(files, staged);

  return context;
}

// ============================================================
// Knowledge Updates
// ============================================================

function ensureKnowledgeDir(skillPath) {
  const knowledgeDir = path.join(skillPath, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });

    // Copy templates
    const templateDir = path.join(SKILLS_DIR, '_template', 'knowledge');
    if (fs.existsSync(templateDir)) {
      for (const file of ['learnings.md', 'patterns.md', 'anti-patterns.md', 'conventions.md', 'library-reference.md']) {
        const src = path.join(templateDir, file);
        const dest = path.join(knowledgeDir, file);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  }
  return knowledgeDir;
}

function appendLearning(skillPath, context) {
  const knowledgeDir = ensureKnowledgeDir(skillPath);
  const learningsPath = path.join(knowledgeDir, 'learnings.md');

  const date = context.timestamp.split('T')[0];

  // Format semantic changes for output
  const semanticOutput = formatSemanticChanges(context.semanticChanges);

  const entry = `
### ${date} - ${context.summary}

**Context**: ${context.trigger} trigger
**Trigger**: ${context.trigger}
**Type**: ${context.type}
**Files**: ${context.files.slice(0, 5).join(', ')}${context.files.length > 5 ? ` (+${context.files.length - 5} more)` : ''}
${semanticOutput ? `\n**Semantic Changes**:\n${semanticOutput}\n` : ''}
---
`;

  if (fs.existsSync(learningsPath)) {
    let content = fs.readFileSync(learningsPath, 'utf-8');

    // Find the "Recent Learnings" section and append after it
    const marker = '## Recent Learnings';
    const idx = content.indexOf(marker);
    if (idx !== -1) {
      const insertPoint = content.indexOf('\n', idx + marker.length) + 1;
      content = content.slice(0, insertPoint) + entry + content.slice(insertPoint);
    } else {
      content += '\n## Recent Learnings\n' + entry;
    }

    fs.writeFileSync(learningsPath, content);
    return true;
  }

  return false;
}

function updateSkillVersion(skillPath) {
  const skillMdPath = path.join(skillPath, 'skill.md');
  const legacyPath = path.join(skillPath, 'SKILL.md');
  const mdPath = fs.existsSync(skillMdPath) ? skillMdPath : legacyPath;

  if (!fs.existsSync(mdPath)) return;

  let content = fs.readFileSync(mdPath, 'utf-8');

  // Update lastUpdated
  const today = new Date().toISOString().split('T')[0];
  if (content.includes('lastUpdated:')) {
    content = content.replace(/lastUpdated:\s*[\d-]+/, `lastUpdated: ${today}`);
  }

  // Increment learningCount
  const countMatch = content.match(/learningCount:\s*(\d+)/);
  if (countMatch) {
    const newCount = parseInt(countMatch[1]) + 1;
    content = content.replace(/learningCount:\s*\d+/, `learningCount: ${newCount}`);
  }

  fs.writeFileSync(mdPath, content);
}

// ============================================================
// Feedback Patterns Integration
// ============================================================

/**
 * Extract file extensions/types from a list of files
 */
function getFileSignature(files) {
  const exts = files.map(f => {
    const ext = path.extname(f);
    // Group common patterns
    if (f.includes('.module.')) return '.module.*';
    if (f.includes('.controller.')) return '.controller.*';
    if (f.includes('.service.')) return '.service.*';
    if (f.includes('.entity.')) return '.entity.*';
    if (f.includes('.test.') || f.includes('.spec.')) return '.test.*';
    return ext || 'no-ext';
  });
  return [...new Set(exts)].sort().join(',');
}

/**
 * Log unmatched files to feedback-patterns.md with proper count tracking
 */
function logToFeedbackPatterns(context, unmatchedFiles) {
  const feedbackPath = path.join(STATE_DIR, 'feedback-patterns.md');

  if (!fs.existsSync(feedbackPath)) return;

  let content = fs.readFileSync(feedbackPath, 'utf-8');
  const date = context.timestamp.split('T')[0];

  // Get signature for deduplication
  const signature = getFileSignature(unmatchedFiles);
  const filesPreview = unmatchedFiles.slice(0, 3).join(', ');

  // Look for existing entry with same pattern (by #needs-skill tag and similar file types)
  const tableMarker = '| Date | Correction | Count |';
  const idx = content.indexOf(tableMarker);
  if (idx === -1) return;

  // Find all existing #needs-skill entries
  const lines = content.split('\n');
  let foundExisting = false;
  let existingLineIdx = -1;
  let existingCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('#needs-skill') && line.includes('Files changed with no matching skill')) {
      // Check if same file signature
      const lineSignature = getFileSignature(
        (line.match(/Files changed with no matching skill: ([^|]+)/)?.[1] || '')
          .split(', ')
          .map(f => f.trim())
          .filter(f => f)
      );

      if (lineSignature === signature || lineSignature === '' || signature === '') {
        // Found existing entry with same pattern - increment count
        const countMatch = line.match(/\|\s*(\d+)\s*\|/);
        if (countMatch) {
          existingCount = parseInt(countMatch[1]);
          existingLineIdx = i;
          foundExisting = true;
          break;
        }
      }
    }
  }

  if (foundExisting && existingLineIdx >= 0) {
    // Update existing entry with new count and date
    const newCount = existingCount + 1;
    const newEntry = `| ${date} | Files changed with no matching skill: ${filesPreview} | ${newCount} | - | #needs-skill |`;
    lines[existingLineIdx] = newEntry;
    content = lines.join('\n');
  } else {
    // Add new entry with count 1
    const entry = `| ${date} | Files changed with no matching skill: ${filesPreview} | 1 | - | #needs-skill |`;
    const headerEnd = content.indexOf('\n', content.indexOf('\n', idx) + 1) + 1;
    content = content.slice(0, headerEnd) + entry + '\n' + content.slice(headerEnd);
  }

  fs.writeFileSync(feedbackPath, content);
}

// ============================================================
// Main CLI
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    trigger: 'manual',
    skill: null,
    dryRun: false,
    verbose: false,
    help: false
  };

  for (const arg of args) {
    if (arg.startsWith('--trigger=')) {
      options.trigger = arg.split('=')[1];
    } else if (arg.startsWith('--skill=')) {
      options.skill = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Wogi Flow Skill Learning Engine

Usage:
  flow skill-learn [options]

Options:
  --trigger=TYPE    Trigger type: commit, task, compact, manual (default: manual)
  --skill=NAME      Target specific skill only
  --dry-run         Show what would be updated without making changes
  --verbose, -v     Show detailed output
  --help, -h        Show this help

Examples:
  flow skill-learn                      # Manual learning extraction
  flow skill-learn --trigger=commit     # Called from pre-commit hook
  flow skill-learn --skill=nestjs       # Update only nestjs skill
  flow skill-learn --dry-run            # Preview changes
`);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const config = loadConfig();

  if (!isLearningEnabled(config, options.trigger)) {
    if (options.verbose) {
      log('dim', 'Skill learning disabled for this trigger');
    }
    process.exit(0);
  }

  log('cyan', `\n📚 Skill Learning (${options.trigger})\n`);

  // Get changed files
  const files = options.trigger === 'commit'
    ? getChangedFiles(true)
    : getChangedFiles(false);

  if (files.length === 0) {
    log('dim', 'No changed files to analyze');
    process.exit(0);
  }

  log('white', `Found ${files.length} changed files`);

  // Discover skills
  let skills = discoverSkills();

  if (options.skill) {
    skills = skills.filter(s => s.name === options.skill);
    if (skills.length === 0) {
      log('yellow', `Skill '${options.skill}' not found`);
      process.exit(1);
    }
  }

  log('dim', `Checking against ${skills.length} skills`);

  // Match files to skills
  const { matches, unmatched } = matchFilesToSkills(files, skills);

  // Extract learning context
  const context = extractLearningContext(files, options.trigger);

  // Update matched skills
  let updatedCount = 0;

  for (const [skillName, skillFiles] of matches) {
    const skill = skills.find(s => s.name === skillName);

    log('green', `\n  ✓ ${skillName}: ${skillFiles.length} files`);

    if (options.verbose) {
      for (const f of skillFiles.slice(0, 3)) {
        log('dim', `    - ${f}`);
      }
      if (skillFiles.length > 3) {
        log('dim', `    ... +${skillFiles.length - 3} more`);
      }
    }

    if (!options.dryRun) {
      const skillContext = { ...context, files: skillFiles };
      appendLearning(skill.path, skillContext);
      updateSkillVersion(skill.path);
      updatedCount++;
    }
  }

  // Handle unmatched files
  if (unmatched.length > 0) {
    log('yellow', `\n  ⚠ ${unmatched.length} files with no matching skill`);

    if (options.verbose) {
      for (const f of unmatched.slice(0, 5)) {
        log('dim', `    - ${f}`);
      }
    }

    if (!options.dryRun) {
      logToFeedbackPatterns(context, unmatched);
    }
  }

  // Summary
  console.log('');
  if (options.dryRun) {
    log('yellow', `Dry run: Would update ${matches.size} skill(s)`);
  } else {
    log('green', `✅ Updated ${updatedCount} skill(s)`);
  }
  console.log('');
}

// ============================================================
// Exports (for use by other modules like knowledge-router)
// ============================================================

module.exports = {
  discoverSkills,
  matchFilesToSkills,
  appendLearning,
  ensureKnowledgeDir,
  extractLearningContext,
  isLearningEnabled,
  // Semantic diff analysis
  extractSemanticChanges,
  formatSemanticChanges
};

if (require.main === module) {
  main().catch(e => {
    log('red', `Error: ${err.message}`);
    process.exit(1);
  });
}
