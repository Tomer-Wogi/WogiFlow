#!/usr/bin/env node

/**
 * Wogi Flow - Active Pattern Enforcement
 *
 * Ensures that learned patterns from decisions.md, app-map.md, and skills
 * are actively injected into prompts and enforced during code generation.
 *
 * Key Features:
 * - Extracts relevant patterns based on task context
 * - Injects patterns prominently into prompts
 * - Validates output against patterns
 * - Requires citation of patterns in generated code
 *
 * Usage:
 *   const { injectPatterns, validateAgainstPatterns } = require('./flow-pattern-enforcer');
 *   const enrichedPrompt = injectPatterns(prompt, task, projectRoot);
 *
 * Part of v1.8.0 - Active Learning Enforcement
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  getConfig,
  PATHS,
  fileExists,
  readFile,
  writeFile,
  withLockSync,
  info,
  success,
  warn,
  error
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

// ============================================================
// Pattern Extraction
// ============================================================

/**
 * Load all patterns from decisions.md
 */
function loadDecisionPatterns(projectRoot = PROJECT_ROOT) {
  const decisionsPath = path.join(projectRoot, '.workflow', 'state', 'decisions.md');

  // Read file directly in try-catch (no pre-check to avoid TOCTOU race condition)
  let content;
  try {
    content = fs.readFileSync(decisionsPath, 'utf-8');
  } catch (err) {
    // File doesn't exist or can't be read - this is normal for new projects
    if (err.code !== 'ENOENT') {
      warn(`Could not read decisions.md: ${err.message}`);
    }
    return [];
  }

  const patterns = [];

  // Extract each section as a pattern category
  const sections = content.match(/## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g) || [];

  for (const section of sections) {
    const match = section.match(/## ([^\n]+)\n([\s\S]*)/);
    if (match) {
      const category = match[1].trim();
      const rules = match[2].trim();

      // Extract individual rules (lines starting with - or *)
      const ruleLines = rules.match(/^[\s]*[-*]\s+.+$/gm) || [];

      patterns.push({
        category,
        rules: ruleLines.map(r => r.replace(/^[\s]*[-*]\s+/, '').trim()),
        raw: rules
      });
    }
  }

  return patterns;
}

/**
 * Load components from app-map.md
 */
function loadAppMapComponents(projectRoot = PROJECT_ROOT) {
  const appMapPath = path.join(projectRoot, '.workflow', 'state', 'app-map.md');

  // Read file directly in try-catch (no pre-check to avoid TOCTOU race condition)
  let content;
  try {
    content = fs.readFileSync(appMapPath, 'utf-8');
  } catch (err) {
    // File doesn't exist or can't be read - this is normal for new projects
    if (err.code !== 'ENOENT') {
      warn(`Could not read app-map.md: ${err.message}`);
    }
    return [];
  }

  const components = [];

  // Extract table rows (| Component | Variants | ... |)
  const tableRows = content.match(/^\|[^|]+\|[^|]+\|.+\|$/gm) || [];

  for (const row of tableRows) {
    if (row.includes('---') || row.toLowerCase().includes('component')) continue;

    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      components.push({
        name: cells[0],
        variants: cells[1] ? cells[1].split(',').map(v => v.trim()) : [],
        description: cells[2] || '',
        path: cells[3] || ''
      });
    }
  }

  return components;
}

/**
 * Load skill patterns for a given file type
 */
function loadSkillPatterns(projectRoot, fileExtension, taskDescription = '') {
  const skillsDir = path.join(projectRoot, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return null;

  // Map file extensions to skills
  const extensionToSkill = {
    '.module.ts': 'nestjs',
    '.controller.ts': 'nestjs',
    '.service.ts': 'nestjs',
    '.tsx': 'react',
    '.jsx': 'react',
    '.vue': 'vue',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go'
  };

  // Find matching skill
  let skillName = null;
  for (const [ext, skill] of Object.entries(extensionToSkill)) {
    if (fileExtension.endsWith(ext)) {
      skillName = skill;
      break;
    }
  }

  // Also check task description for framework mentions
  if (!skillName && taskDescription) {
    const frameworks = ['nestjs', 'react', 'vue', 'angular', 'express', 'fastapi', 'django'];
    for (const fw of frameworks) {
      if (taskDescription.toLowerCase().includes(fw)) {
        skillName = fw;
        break;
      }
    }
  }

  if (!skillName) return null;

  const skillDir = path.join(skillsDir, skillName);
  if (!fs.existsSync(skillDir)) return null;

  const patterns = { skillName, patterns: null, antiPatterns: null };

  // Load patterns (no pre-check to avoid TOCTOU race condition)
  const patternsPath = path.join(skillDir, 'knowledge', 'patterns.md');
  try {
    patterns.patterns = fs.readFileSync(patternsPath, 'utf-8');
  } catch (err) {
    // File doesn't exist - this is normal, skill may not have patterns
    if (err.code !== 'ENOENT' && process.env.DEBUG) {
      console.error(`[DEBUG] Failed to read patterns.md: ${err.message}`);
    }
  }

  // Load anti-patterns (no pre-check to avoid TOCTOU race condition)
  const antiPatternsPath = path.join(skillDir, 'knowledge', 'anti-patterns.md');
  try {
    patterns.antiPatterns = fs.readFileSync(antiPatternsPath, 'utf-8');
  } catch (err) {
    // File doesn't exist - this is normal, skill may not have anti-patterns
    if (err.code !== 'ENOENT' && process.env.DEBUG) {
      console.error(`[DEBUG] Failed to read anti-patterns.md: ${err.message}`);
    }
  }

  return patterns;
}

/**
 * Extract patterns relevant to a specific task
 */
function extractRelevantPatterns(task, projectRoot = PROJECT_ROOT) {
  const relevant = {
    decisions: [],
    components: [],
    skill: null,
    keywords: []
  };

  // Extract keywords from task
  const taskText = `${task.description || ''} ${task.file || ''} ${task.action || ''}`.toLowerCase();
  relevant.keywords = taskText
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Load all patterns
  const decisionPatterns = loadDecisionPatterns(projectRoot);
  const appMapComponents = loadAppMapComponents(projectRoot);

  // Filter decision patterns by relevance
  for (const pattern of decisionPatterns) {
    const categoryLower = pattern.category.toLowerCase();
    const rulesLower = pattern.rules.join(' ').toLowerCase();

    // Check for keyword matches
    const isRelevant = relevant.keywords.some(kw =>
      categoryLower.includes(kw) || rulesLower.includes(kw)
    );

    // Always include certain categories
    const alwaysInclude = ['naming', 'file', 'import', 'general', 'coding'];
    const shouldAlwaysInclude = alwaysInclude.some(ai => categoryLower.includes(ai));

    if (isRelevant || shouldAlwaysInclude) {
      relevant.decisions.push(pattern);
    }
  }

  // Filter components by relevance
  for (const component of appMapComponents) {
    const componentLower = `${component.name} ${component.variants.join(' ')} ${component.description}`.toLowerCase();

    if (relevant.keywords.some(kw => componentLower.includes(kw))) {
      relevant.components.push(component);
    }
  }

  // Load skill patterns if applicable
  if (task.file) {
    relevant.skill = loadSkillPatterns(projectRoot, task.file, task.description);
  }

  return relevant;
}

// ============================================================
// Pattern Injection
// ============================================================

/**
 * Format patterns for prompt injection
 */
function formatPatternsForPrompt(relevantPatterns, config = {}) {
  const { requireCitation = false } = config;
  let output = '';

  // Header
  output += `\n## ⚠️ MANDATORY PATTERNS - MUST FOLLOW ⚠️\n\n`;
  output += `The following patterns are REQUIRED. Violations will be rejected.\n\n`;

  // Decision patterns
  if (relevantPatterns.decisions.length > 0) {
    output += `### Project Rules (from decisions.md)\n\n`;

    for (const pattern of relevantPatterns.decisions) {
      output += `**${pattern.category}**\n`;
      for (const rule of pattern.rules.slice(0, 5)) { // Limit rules per category
        output += `- ${rule}\n`;
      }
      output += '\n';
    }
  }

  // Existing components
  if (relevantPatterns.components.length > 0) {
    output += `### Existing Components (from app-map.md) - REUSE THESE\n\n`;
    output += `| Component | Variants | Path |\n`;
    output += `|-----------|----------|------|\n`;

    for (const comp of relevantPatterns.components.slice(0, 10)) {
      output += `| ${comp.name} | ${comp.variants.join(', ')} | ${comp.path} |\n`;
    }
    output += '\n';
  }

  // Skill patterns
  if (relevantPatterns.skill) {
    output += `### ${relevantPatterns.skill.skillName} Patterns\n\n`;

    if (relevantPatterns.skill.patterns) {
      output += `**DO:**\n${relevantPatterns.skill.patterns.slice(0, 1000)}\n\n`;
    }

    if (relevantPatterns.skill.antiPatterns) {
      output += `**DON'T:**\n${relevantPatterns.skill.antiPatterns.slice(0, 500)}\n\n`;
    }
  }

  // Citation requirement
  if (requireCitation) {
    output += `### Citation Requirement\n\n`;
    output += `You MUST include a comment citing which pattern you're following:\n`;
    output += `\`\`\`typescript\n`;
    output += `// Following: "Use kebab-case for files" (decisions.md)\n`;
    output += `// Reusing: Button component (app-map.md)\n`;
    output += `\`\`\`\n\n`;
  }

  return output;
}

/**
 * Inject patterns into a prompt
 */
function injectPatterns(prompt, task, projectRoot = PROJECT_ROOT) {
  const config = getConfig();
  const enforcement = config.enforcement || {};

  const relevantPatterns = extractRelevantPatterns(task, projectRoot);

  // Skip if no patterns found
  if (relevantPatterns.decisions.length === 0 &&
      relevantPatterns.components.length === 0 &&
      !relevantPatterns.skill) {
    return prompt;
  }

  const patternSection = formatPatternsForPrompt(relevantPatterns, {
    requireCitation: enforcement.requirePatternCitation || false
  });

  // Inject patterns at the beginning of the prompt (high visibility)
  return patternSection + '\n---\n\n' + prompt;
}

// ============================================================
// Pattern Validation
// ============================================================

/**
 * Validation rules based on pattern categories
 */
const VALIDATION_RULES = {
  'naming': [
    { pattern: /PascalCase/i, check: (code) => /[A-Z][a-z]+[A-Z]/.test(code), inverse: false },
    { pattern: /kebab-case/i, check: (code, files) => files?.every(f => /^[a-z0-9-]+\.[a-z]+$/.test(path.basename(f))), inverse: false },
    { pattern: /camelCase/i, check: (code) => /[a-z]+[A-Z][a-z]+/.test(code), inverse: false }
  ],
  'import': [
    { pattern: /absolute.*@\//i, check: (code) => code.includes('@/'), inverse: false },
    { pattern: /relative.*\.\.\//i, check: (code) => !code.includes('../'), inverse: true }
  ]
};

/**
 * Validate code against extracted patterns
 */
function validateAgainstPatterns(code, patterns, files = []) {
  const violations = [];
  const passes = [];

  for (const pattern of patterns.decisions) {
    const categoryLower = pattern.category.toLowerCase();

    for (const rule of pattern.rules) {
      const ruleLower = rule.toLowerCase();

      // Check naming conventions
      if (categoryLower.includes('naming') || ruleLower.includes('naming')) {
        if (ruleLower.includes('kebab-case') && files.length > 0) {
          const nonKebab = files.filter(f => !/^[a-z0-9-]+\.[a-z]+$/.test(path.basename(f)));
          if (nonKebab.length > 0) {
            violations.push({
              rule: rule,
              category: pattern.category,
              message: `Files not in kebab-case: ${nonKebab.join(', ')}`
            });
          } else {
            passes.push({ rule: rule, category: pattern.category });
          }
        }
      }

      // Check import patterns
      if (categoryLower.includes('import') || ruleLower.includes('import')) {
        if (ruleLower.includes('absolute') && ruleLower.includes('@/')) {
          if (!code.includes('@/') && code.includes('../')) {
            violations.push({
              rule: rule,
              category: pattern.category,
              message: 'Using relative imports instead of absolute @/ imports'
            });
          } else if (code.includes('@/')) {
            passes.push({ rule: rule, category: pattern.category });
          }
        }
      }

      // Check forbidden patterns
      if (ruleLower.includes('never') || ruleLower.includes('don\'t') || ruleLower.includes('avoid')) {
        // Extract what to avoid
        const avoidMatch = ruleLower.match(/(?:never|don't|avoid)\s+(?:use\s+)?(.+?)(?:\.|$)/);
        if (avoidMatch) {
          const forbidden = avoidMatch[1].trim();
          if (code.toLowerCase().includes(forbidden)) {
            violations.push({
              rule: rule,
              category: pattern.category,
              message: `Code contains forbidden pattern: "${forbidden}"`
            });
          }
        }
      }
    }
  }

  // Check component reuse
  if (patterns.components.length > 0) {
    const createdNew = code.match(/(?:function|const|class)\s+([A-Z][a-zA-Z]+)/g) || [];

    for (const created of createdNew) {
      const name = created.replace(/(?:function|const|class)\s+/, '');
      const existing = patterns.components.find(c =>
        c.name.toLowerCase() === name.toLowerCase()
      );

      if (existing) {
        violations.push({
          rule: `Reuse existing component: ${existing.name}`,
          category: 'Component Reuse',
          message: `Created new "${name}" but "${existing.name}" already exists at ${existing.path}`
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    passes,
    summary: violations.length === 0
      ? `✓ All ${passes.length} pattern checks passed`
      : `✗ ${violations.length} violations, ${passes.length} passes`
  };
}

/**
 * Check if code includes required citations
 */
function validateCitations(code, patterns) {
  const citations = code.match(/\/\/\s*(?:Following|Reusing|Pattern):\s*.+/gi) || [];

  return {
    hasCitations: citations.length > 0,
    citations: citations,
    message: citations.length > 0
      ? `Found ${citations.length} pattern citations`
      : 'No pattern citations found (required when enforcement.requirePatternCitation is true)'
  };
}

// ============================================================
// Session Context Loading
// ============================================================

/**
 * Generate session start summary showing loaded patterns
 */
function generateSessionSummary(projectRoot = PROJECT_ROOT) {
  const decisions = loadDecisionPatterns(projectRoot);
  const components = loadAppMapComponents(projectRoot);
  const config = getConfig();

  let summary = '\n';
  summary += '┌─────────────────────────────────────────────────────────────┐\n';
  summary += '│  📋 PROJECT CONTEXT LOADED                                   │\n';
  summary += '├─────────────────────────────────────────────────────────────┤\n';

  // Decisions summary
  const ruleCount = decisions.reduce((acc, d) => acc + d.rules.length, 0);
  summary += `│  decisions.md: ${ruleCount} rules in ${decisions.length} categories\n`;

  for (const d of decisions.slice(0, 3)) {
    summary += `│    • ${d.category}: ${d.rules.length} rules\n`;
  }
  if (decisions.length > 3) {
    summary += `│    • ... and ${decisions.length - 3} more categories\n`;
  }

  // Components summary
  summary += `│\n│  app-map.md: ${components.length} components registered\n`;

  for (const c of components.slice(0, 3)) {
    summary += `│    • ${c.name} (${c.variants.length} variants)\n`;
  }
  if (components.length > 3) {
    summary += `│    • ... and ${components.length - 3} more components\n`;
  }

  // Skills summary
  const skillsDir = path.join(projectRoot, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    const skills = fs.readdirSync(skillsDir).filter(d =>
      fs.statSync(path.join(skillsDir, d)).isDirectory() && !d.startsWith('_')
    );
    if (skills.length > 0) {
      summary += `│\n│  .claude/skills/: ${skills.join(', ')}\n`;
    }
  }

  summary += '│\n│  ⚠️  THESE RULES ARE MANDATORY FOR ALL WORK                │\n';
  summary += '└─────────────────────────────────────────────────────────────┘\n';

  return summary;
}

// ============================================================
// Cross-Session Pattern Enforcement (v6.0)
// ============================================================

// Rule categories based on request content keywords
const CROSS_SESSION_CATEGORY_KEYWORDS = {
  'Development Setup': ['localhost', 'port', 'server', 'run', 'start', 'dev', 'development', 'npm', 'yarn'],
  'Code Style': ['naming', 'format', 'style', 'convention', 'lint', 'prettier', 'eslint'],
  'Security': ['security', 'auth', 'password', 'token', 'secret', 'credential', 'permission'],
  'Architecture': ['architecture', 'structure', 'pattern', 'module', 'component', 'service'],
  'Testing': ['test', 'spec', 'jest', 'mocha', 'coverage', 'e2e', 'unit'],
  'Git & Workflow': ['commit', 'branch', 'merge', 'pr', 'push', 'git']
};

/**
 * Detect the best category for a pattern based on its request text
 */
function detectCrossSessionCategory(request) {
  const requestLower = request.toLowerCase();

  for (const [category, keywords] of Object.entries(CROSS_SESSION_CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (requestLower.includes(keyword)) {
        return category;
      }
    }
  }

  return 'General';
}

/**
 * Generate a rule slug from request text
 */
function generateCrossSessionRuleSlug(request) {
  return request
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/**
 * Generate rule text for decisions.md from a cross-session pattern
 */
function generateCrossSessionRule(pattern, userReason = '') {
  const today = new Date().toISOString().split('T')[0];
  const category = detectCrossSessionCategory(pattern.representativeRequest);
  const slug = generateCrossSessionRuleSlug(pattern.representativeRequest);

  const requestText = pattern.representativeRequest
    .replace(/^["']|["']$/g, '')
    .trim();

  const rule = `
### ${slug} (${today})
**Source**: Cross-session pattern (${pattern.count} occurrences across ${pattern.sessionCount} sessions)
**Category**: ${category}

${requestText}

${userReason ? `**Reason**: ${userReason}` : ''}
`.trim();

  return { rule, category, slug };
}

/**
 * Add a cross-session rule to decisions.md
 * Uses file locking to prevent race conditions with concurrent writes
 */
function addCrossSessionRuleToDecisions(rule, category) {
  const decisionsPath = path.join(PATHS.state, 'decisions.md');

  try {
    // Use file locking to prevent race conditions
    return withLockSync(decisionsPath, () => {
      if (!fileExists(decisionsPath)) {
        const template = `# Project Decisions

This document captures project-level coding rules and patterns.

## Development Setup

## Code Style

## Security

## Architecture

## Testing

## Git & Workflow

## General

`;
        writeFile(decisionsPath, template);
      }

      let content = readFile(decisionsPath, '');

      const sectionHeader = `## ${category}`;
      const sectionIndex = content.indexOf(sectionHeader);

      if (sectionIndex === -1) {
        // Category doesn't exist - add it with the rule
        content += `\n${sectionHeader}\n\n${rule}\n`;
      } else {
        const afterSection = content.slice(sectionIndex + sectionHeader.length);
        const nextSectionMatch = afterSection.match(/\n## /);

        if (nextSectionMatch) {
          const insertPoint = sectionIndex + sectionHeader.length + nextSectionMatch.index;
          content = content.slice(0, insertPoint) + '\n' + rule + '\n' + content.slice(insertPoint);
        } else {
          content += '\n' + rule + '\n';
        }
      }

      writeFile(decisionsPath, content);
      return { success: true };
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Add a cross-session rule to .claude/rules/ directory
 * Uses PROJECT_ROOT for consistent path resolution
 */
function addCrossSessionRuleToClaudeRules(pattern, category) {
  try {
    // Validate pattern has required fields
    if (!pattern?.representativeRequest) {
      return { success: false, error: 'Invalid pattern: missing representativeRequest' };
    }

    const categoryToDir = {
      'Development Setup': 'workflow',
      'Code Style': 'code-style',
      'Security': 'security',
      'Architecture': 'architecture',
      'Testing': 'testing',
      'Git & Workflow': 'workflow',
      'General': 'general'
    };

    const subdir = categoryToDir[category] || 'general';
    // Use PROJECT_ROOT instead of process.cwd() for consistent path resolution
    const rulesDir = path.join(PROJECT_ROOT, '.claude', 'rules', subdir);

    // Validate path is within project (defense in depth)
    // Use path.sep check to prevent prefix-matching attacks (e.g., /project vs /project-evil)
    const resolvedRulesDir = path.resolve(rulesDir);
    const normalizedRoot = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
    if (!resolvedRulesDir.startsWith(normalizedRoot) && resolvedRulesDir !== PROJECT_ROOT) {
      return { success: false, error: 'Invalid rules directory: outside project' };
    }

    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }

    const slug = generateCrossSessionRuleSlug(pattern.representativeRequest);
    const rulePath = path.join(rulesDir, `${slug}.md`);

    // Validate rule path is within rules directory
    // Use path.sep check to prevent prefix-matching attacks
    const resolvedRulePath = path.resolve(rulePath);
    const normalizedRulesDir = resolvedRulesDir.endsWith(path.sep) ? resolvedRulesDir : resolvedRulesDir + path.sep;
    if (!resolvedRulePath.startsWith(normalizedRulesDir) && resolvedRulePath !== resolvedRulesDir) {
      return { success: false, error: 'Invalid rule path: potential traversal' };
    }

    // Escape markdown special characters in user content
    const requestText = pattern.representativeRequest
      .replace(/^["']|["']$/g, '')
      .replace(/`/g, '\\`')           // Escape backticks
      .replace(/</g, '&lt;')          // Escape angle brackets
      .replace(/>/g, '&gt;')
      .trim();

    const alwaysApply = ['Development Setup', 'Security'].includes(category);

    // Escape description for YAML frontmatter (handle all YAML special chars)
    const escapedDescription = requestText
      .slice(0, 100)
      .replace(/\\/g, '\\\\')         // Escape backslashes first
      .replace(/"/g, '\\"')           // Escape double quotes
      .replace(/\n/g, '\\n')          // Escape newlines
      .replace(/\r/g, '\\r')          // Escape carriage returns
      .replace(/\t/g, '\\t');         // Escape tabs

    const content = `---
alwaysApply: ${alwaysApply}
description: "${escapedDescription}"
---

# ${category} Rule

${requestText}

**Source**: Detected from ${pattern.count} occurrences across ${pattern.sessionCount} sessions.
`;

    writeFile(rulePath, content);
    return { success: true, path: rulePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Enforce a cross-session pattern by creating rules
 *
 * @param {Object} pattern - The pattern to enforce
 * @param {Object} options - Enforcement options
 * @param {string} options.reason - User-provided reason for the rule
 * @param {string} options.saveTo - Where to save: 'decisions', 'rules', or 'both'
 * @returns {Object} Result with success status and details
 */
function enforceCrossSessionPattern(pattern, options = {}) {
  const config = getConfig();
  const crossSessionConfig = config?.crossSessionLearning || {};

  const {
    reason = '',
    saveTo = crossSessionConfig.saveTo || 'both'
  } = options;

  const results = {
    success: true,
    errors: [],
    targets: []
  };

  const { rule, category } = generateCrossSessionRule(pattern, reason);

  if (saveTo === 'decisions' || saveTo === 'both') {
    const decisionsResult = addCrossSessionRuleToDecisions(rule, category);
    if (decisionsResult.success) {
      results.targets.push('decisions.md');
      info(`Added rule to decisions.md under "${category}"`);
    } else {
      results.errors.push(`decisions.md: ${decisionsResult.error}`);
    }
  }

  if (saveTo === 'rules' || saveTo === 'both') {
    const rulesResult = addCrossSessionRuleToClaudeRules(pattern, category);
    if (rulesResult.success) {
      results.targets.push(rulesResult.path);
      info(`Created rule at ${rulesResult.path}`);
    } else {
      results.errors.push(`.claude/rules/: ${rulesResult.error}`);
    }
  }

  if (results.errors.length > 0) {
    results.success = false;
    for (const err of results.errors) {
      error(err);
    }
  } else {
    success(`Pattern enforced: "${pattern.representativeRequest.slice(0, 50)}..."`);
  }

  return results;
}

/**
 * Format cross-session patterns for display to user
 */
function formatCrossSessionPatternsForDisplay(patterns) {
  if (patterns.length === 0) {
    return 'No cross-session patterns detected.';
  }

  let output = '--- Cross-Session Patterns Detected ---\n\n';

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    const category = detectCrossSessionCategory(p.representativeRequest);

    output += `${i + 1}. "${p.representativeRequest}"\n`;
    output += `   Occurrences: ${p.count} times across ${p.sessionCount} session(s)\n`;
    output += `   First seen: ${p.firstSeen}, Last seen: ${p.lastSeen}\n`;
    output += `   Category: ${category}\n`;
    output += '\n';
  }

  output += 'Would you like to enforce any of these patterns as permanent rules?\n';

  return output;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Pattern loading
  loadDecisionPatterns,
  loadAppMapComponents,
  loadSkillPatterns,
  extractRelevantPatterns,

  // Pattern injection
  formatPatternsForPrompt,
  injectPatterns,

  // Validation
  validateAgainstPatterns,
  validateCitations,

  // Session helpers
  generateSessionSummary,

  // Cross-session pattern enforcement (v6.0)
  CROSS_SESSION_CATEGORY_KEYWORDS,
  detectCrossSessionCategory,
  generateCrossSessionRuleSlug,
  generateCrossSessionRule,
  addCrossSessionRuleToDecisions,
  addCrossSessionRuleToClaudeRules,
  enforceCrossSessionPattern,
  formatCrossSessionPatternsForDisplay
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'summary': {
      console.log(generateSessionSummary());
      break;
    }

    case 'patterns': {
      const patterns = loadDecisionPatterns();
      console.log('\nDecision Patterns:\n');
      for (const p of patterns) {
        console.log(`## ${p.category}`);
        for (const r of p.rules) {
          console.log(`  - ${r}`);
        }
        console.log('');
      }
      break;
    }

    case 'components': {
      const components = loadAppMapComponents();
      console.log('\nRegistered Components:\n');
      for (const c of components) {
        console.log(`  ${c.name}: ${c.variants.join(', ') || 'no variants'}`);
      }
      break;
    }

    case 'validate': {
      const filePath = args[1];
      if (!filePath) {
        console.error('Usage: flow-pattern-enforcer validate <file>');
        process.exit(1);
      }

      let code;
      try {
        code = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        console.error(`Error: Could not read file '${filePath}': ${err.message}`);
        process.exit(1);
      }
      const patterns = extractRelevantPatterns({ file: filePath, description: '' });
      const result = validateAgainstPatterns(code, patterns, [filePath]);

      console.log('\nValidation Result:\n');
      console.log(result.summary);

      if (result.violations.length > 0) {
        console.log('\nViolations:');
        for (const v of result.violations) {
          console.log(`  ✗ [${v.category}] ${v.rule}`);
          console.log(`    ${v.message}`);
        }
      }
      break;
    }

    default: {
      console.log(`
Wogi Flow - Pattern Enforcer

Usage:
  node flow-pattern-enforcer.js <command>

Commands:
  summary         Show session context summary
  patterns        List all decision patterns
  components      List registered components
  validate <file> Validate a file against patterns

Examples:
  node flow-pattern-enforcer.js summary
  node flow-pattern-enforcer.js validate src/components/Button.tsx
`);
    }
  }
}
