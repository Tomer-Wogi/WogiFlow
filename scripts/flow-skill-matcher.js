#!/usr/bin/env node

/**
 * Wogi Flow - Skill Matcher (Priority 1: Model-Invoked Skills)
 *
 * Automatically matches skills to task context based on:
 * - Task description keywords
 * - File patterns being modified
 * - Task type (feature, bugfix, refactor)
 *
 * Uses model-invoked skills approach.
 *
 * Usage:
 *   const { matchSkills, loadSkillContext } = require('./flow-skill-matcher');
 *   const skills = await matchSkills('implement user authentication');
 *   const context = await loadSkillContext(skills);
 */

const fs = require('fs');
const path = require('path');

// Helpers for SKILL.md standard compatibility (accept both skill.md and SKILL.md)
function hasSkillFile(dir) {
  return fs.existsSync(path.join(dir, 'skill.md')) || fs.existsSync(path.join(dir, 'SKILL.md'));
}

function getSkillFilePath(dir) {
  const lower = path.join(dir, 'skill.md');
  return fs.existsSync(lower) ? lower : path.join(dir, 'SKILL.md');
}
const { getProjectRoot, getConfig, PATHS, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const SKILLS_DIR = path.join(PROJECT_ROOT, '.claude', 'skills');

// Maximum nesting depth for skill directories (prevents runaway recursion)
const MAX_SKILL_NESTING_DEPTH = 3;

// ============================================================
// Nested Skill Discovery
// ============================================================

/**
 * Recursively discover all skills in the skills directory
 * Looks for directories containing skill.md files
 *
 * @param {string} baseDir - Base directory to search
 * @param {string} prefix - Path prefix for nested skills
 * @param {number} depth - Current recursion depth
 * @returns {string[]} Array of skill paths (e.g., ["nestjs", "frontend/react"])
 */
function discoverNestedSkills(baseDir = SKILLS_DIR, prefix = '', depth = 0) {
  if (depth > MAX_SKILL_NESTING_DEPTH) {
    return [];
  }

  const skills = [];

  try {
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden directories, _template, and non-directories
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
        continue;
      }

      const entryPath = path.join(baseDir, entry.name);
      const skillPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (hasSkillFile(entryPath)) {
        skills.push(skillPath);
      }

      // Recursively check subdirectories for more skills
      const nestedSkills = discoverNestedSkills(entryPath, skillPath, depth + 1);
      skills.push(...nestedSkills);
    }
  } catch (err) {
    // Silently ignore permission errors, etc.
  }

  return skills;
}

/**
 * Get the absolute path to a skill directory
 * Handles both flat ("nestjs") and nested ("frontend/react") paths
 */
function getSkillDir(skillName) {
  return path.join(SKILLS_DIR, ...skillName.split('/'));
}

// ============================================================
// Skill Trigger Definitions
// ============================================================

/**
 * Default trigger patterns for skills
 * These are used if the skill.md doesn't define explicit triggers
 */
const DEFAULT_TRIGGERS = {
  'nestjs': {
    keywords: ['nestjs', 'nest', 'module', 'controller', 'service', 'entity', 'dto', 'typeorm', 'backend', 'api'],
    filePatterns: ['*.module.ts', '*.controller.ts', '*.service.ts', '*.entity.ts', '*.dto.ts'],
    taskTypes: ['feature', 'bugfix', 'refactor'],
    categories: ['backend', 'api', 'database']
  },
  'react': {
    keywords: ['react', 'component', 'hook', 'usestate', 'useeffect', 'jsx', 'tsx', 'frontend', 'ui'],
    filePatterns: ['*.tsx', '*.jsx', 'use*.ts', '*.component.tsx'],
    taskTypes: ['feature', 'bugfix', 'refactor'],
    categories: ['frontend', 'ui', 'component']
  },
  'python': {
    keywords: ['python', 'pip', 'django', 'flask', 'fastapi', 'pytest', 'pydantic'],
    filePatterns: ['*.py', 'requirements.txt', 'setup.py', 'pyproject.toml'],
    taskTypes: ['feature', 'bugfix', 'refactor'],
    categories: ['backend', 'scripting']
  },
  'figma-analyzer': {
    keywords: ['figma', 'design', 'ui', 'component', 'design-system', 'tokens'],
    filePatterns: [],
    taskTypes: ['feature'],
    categories: ['design', 'ui']
  }
  // Note: transcript/long-input processing is handled by the longInputGate config,
  // not as a skill. See config.longInputGate in .workflow/config.json
};

// ============================================================
// Skill Loading
// ============================================================

/**
 * Load skill metadata from skill.md
 * Parses YAML frontmatter and extracts trigger configuration
 * Supports both flat ("nestjs") and nested ("frontend/react") skill paths
 */
function loadSkillMetadata(skillName) {
  // Skip template skills
  if (skillName === '_template' || skillName.startsWith('_')) {
    return null;
  }

  // Handle nested paths - get the base name for template checks
  const baseName = skillName.split('/').pop();
  if (baseName.startsWith('_')) {
    return null;
  }

  const skillDir = getSkillDir(skillName);
  const skillPath = getSkillFilePath(skillDir);

  if (!fs.existsSync(skillPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const metadata = { name: skillName };

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Extract key-value pairs
      for (const line of frontmatter.split('\n')) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim();
          metadata[key.trim()] = value;
        }
      }

      // Skip skills marked as not loadable or templates
      if (metadata.loadable === 'false' || metadata.template === 'true') {
        return null;
      }
    }

    // Extract triggers section if present
    const triggersMatch = content.match(/## Triggers\n([\s\S]*?)(?=\n## |$)/);
    if (triggersMatch) {
      metadata.triggers = parseTriggersSection(triggersMatch[1]);
    }

    // Extract file patterns from "File Patterns" section
    const filePatternsMatch = content.match(/## File Patterns\n([\s\S]*?)(?=\n## |$)/);
    if (filePatternsMatch) {
      metadata.filePatterns = parseListSection(filePatternsMatch[1]);
    }

    // Extract "When to Use" section for keyword hints
    const whenToUseMatch = content.match(/## When to Use\n([\s\S]*?)(?=\n## |$)/);
    if (whenToUseMatch) {
      metadata.whenToUse = whenToUseMatch[1].trim();
    }

    return metadata;
  } catch (err) {
    console.warn(`Warning: Could not load skill metadata for ${skillName}: ${err.message}`);
    return null;
  }
}

/**
 * Parse triggers section from skill.md
 */
function parseTriggersSection(section) {
  const triggers = {
    keywords: [],
    filePatterns: [],
    taskTypes: [],
    categories: []
  };

  const lines = section.split('\n');
  let currentKey = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- keywords:')) {
      currentKey = 'keywords';
      const inline = trimmed.replace('- keywords:', '').trim();
      if (inline) {
        triggers.keywords = parseInlineArray(inline);
      }
    } else if (trimmed.startsWith('- file_patterns:') || trimmed.startsWith('- filePatterns:')) {
      currentKey = 'filePatterns';
      const inline = trimmed.replace(/- (file_patterns|filePatterns):/, '').trim();
      if (inline) {
        triggers.filePatterns = parseInlineArray(inline);
      }
    } else if (trimmed.startsWith('- task_types:') || trimmed.startsWith('- taskTypes:')) {
      currentKey = 'taskTypes';
      const inline = trimmed.replace(/- (task_types|taskTypes):/, '').trim();
      if (inline) {
        triggers.taskTypes = parseInlineArray(inline);
      }
    } else if (trimmed.startsWith('- categories:')) {
      currentKey = 'categories';
      const inline = trimmed.replace('- categories:', '').trim();
      if (inline) {
        triggers.categories = parseInlineArray(inline);
      }
    } else if (trimmed.startsWith('- ') && currentKey) {
      const value = trimmed.substring(2).replace(/^["']|["']$/g, '');
      triggers[currentKey].push(value);
    }
  }

  return triggers;
}

/**
 * Parse inline array like ["a", "b", "c"]
 */
function parseInlineArray(str) {
  const match = str.match(/\[([^\]]*)\]/);
  if (match) {
    return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return [];
}

/**
 * Parse list section (bullet points)
 */
function parseListSection(section) {
  return section
    .split('\n')
    .filter(line => line.trim().startsWith('- '))
    .map(line => line.trim().substring(2).replace(/`/g, ''));
}

/**
 * Get all installed skills with their triggers
 * Combines skills from config.json with auto-discovered nested skills
 */
function getAllSkills() {
  const config = getConfig();
  const configuredSkills = config.skills?.installed || [];
  const autoDiscover = config.skills?.autoDiscoverNested !== false; // Default: true
  const skills = [];
  const seenSkills = new Set();

  // First, load configured skills (these take priority)
  for (const skillName of configuredSkills) {
    if (seenSkills.has(skillName)) continue;
    seenSkills.add(skillName);

    const metadata = loadSkillMetadata(skillName);
    // Get default triggers - check both full path and base name
    const baseName = skillName.split('/').pop();
    const defaultTriggers = DEFAULT_TRIGGERS[skillName] || DEFAULT_TRIGGERS[baseName] || {
      keywords: [],
      filePatterns: [],
      taskTypes: ['feature', 'bugfix', 'refactor'],
      categories: []
    };

    skills.push({
      name: skillName,
      metadata: metadata || {},
      triggers: metadata?.triggers || defaultTriggers,
      filePatterns: metadata?.filePatterns || defaultTriggers.filePatterns
    });
  }

  // Then, auto-discover nested skills if enabled
  if (autoDiscover) {
    const discoveredSkills = discoverNestedSkills();

    for (const skillName of discoveredSkills) {
      if (seenSkills.has(skillName)) continue;
      seenSkills.add(skillName);

      const metadata = loadSkillMetadata(skillName);
      if (!metadata) continue; // Skip if can't load metadata

      // Get default triggers - check both full path and base name
      const baseName = skillName.split('/').pop();
      const defaultTriggers = DEFAULT_TRIGGERS[skillName] || DEFAULT_TRIGGERS[baseName] || {
        keywords: [],
        filePatterns: [],
        taskTypes: ['feature', 'bugfix', 'refactor'],
        categories: []
      };

      skills.push({
        name: skillName,
        metadata: metadata || {},
        triggers: metadata?.triggers || defaultTriggers,
        filePatterns: metadata?.filePatterns || defaultTriggers.filePatterns
      });
    }
  }

  return skills;
}

// ============================================================
// Skill Matching
// ============================================================

/**
 * Match skills to task context
 * Returns ranked list of applicable skills with match scores
 *
 * @param {string} taskDescription - Task description text
 * @param {object} options - Matching options
 * @param {string[]} options.filePaths - Files being modified
 * @param {string} options.taskType - Task type (feature, bugfix, refactor)
 * @param {string[]} options.categories - Task categories
 */
function matchSkills(taskDescription, options = {}) {
  const config = getConfig();

  // Check if auto-invoke is enabled
  if (config.skills?.autoInvoke === false) {
    return [];
  }

  const skills = getAllSkills();
  const matches = [];

  const descLower = taskDescription.toLowerCase();
  const filePaths = options.filePaths || [];
  const taskType = options.taskType || 'feature';
  const categories = options.categories || [];

  for (const skill of skills) {
    let score = 0;
    const matchReasons = [];

    // 1. Keyword matching (highest weight)
    const keywords = skill.triggers.keywords || [];
    for (const keyword of keywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        score += 3;
        matchReasons.push(`keyword: "${keyword}"`);
      }
    }

    // 2. File pattern matching
    const filePatterns = skill.filePatterns || skill.triggers.filePatterns || [];
    for (const pattern of filePatterns) {
      const regex = patternToRegex(pattern);
      for (const filePath of filePaths) {
        if (regex.test(filePath)) {
          score += 2;
          matchReasons.push(`file pattern: "${pattern}"`);
          break; // Only count once per pattern
        }
      }
    }

    // 3. Task type matching
    const taskTypes = skill.triggers.taskTypes || [];
    if (taskTypes.includes(taskType)) {
      score += 1;
      matchReasons.push(`task type: "${taskType}"`);
    }

    // 4. Category matching
    const skillCategories = skill.triggers.categories || [];
    for (const cat of categories) {
      if (skillCategories.includes(cat.toLowerCase())) {
        score += 1;
        matchReasons.push(`category: "${cat}"`);
      }
    }

    // Only include skills with score > 0
    if (score > 0) {
      matches.push({
        name: skill.name,
        score,
        reasons: matchReasons,
        metadata: skill.metadata
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Convert glob pattern to regex
 * Uses [^/]* instead of .* to prevent matching directory separators (security)
 */
function patternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')  // Security: don't match path separators
    .replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

// ============================================================
// Skill Context Loading
// ============================================================

/**
 * Load skill context for matched skills
 * Returns combined context from all matched skills
 *
 * Uses minRelevanceScore threshold instead of arbitrary count cap.
 * Content is loaded in priority order (configurable via config.skills.contentPriority):
 *   skill.md → conventions.md → anti-patterns.md → learnings.md → library-reference.md
 * If token budget is tight, library-reference.md (lowest priority) is first to trim.
 *
 * @param {Array} matchedSkills - Skills returned from matchSkills()
 * @param {object} options - Loading options
 * @param {number} options.minRelevanceScore - Min score threshold (default: from config or 2)
 * @param {boolean} options.includePatterns - Include patterns.md
 * @param {boolean} options.includeAntiPatterns - Include anti-patterns.md
 * @param {boolean} options.includeLearnings - Include learnings.md
 * @param {boolean} options.includeLibraryReference - Include library-reference.md
 * @param {boolean} options.includeConventions - Include conventions.md
 * @param {number} options.maxSkills - Legacy: hard cap (overrides threshold if set)
 */
async function loadSkillContext(matchedSkills, options = {}) {
  const config = getConfig();
  const skillsConfig = config.skills || {};

  // Use minRelevanceScore threshold instead of maxSkills cap
  // Legacy support: if options.maxSkills is explicitly set, use it as a hard cap
  const minScore = options.minRelevanceScore || skillsConfig.minRelevanceScore || 2;
  const hardCap = options.maxSkills || null;

  const includePatterns = options.includePatterns !== false;
  const includeAntiPatterns = (options.includeAntiPatterns !== false) && (skillsConfig.loadAntiPatterns !== false);
  const includeLearnings = (options.includeLearnings !== false) && (skillsConfig.loadLearnings !== false);
  const includeLibraryReference = (options.includeLibraryReference !== false) && (skillsConfig.loadLibraryReference !== false);
  const includeConventions = (options.includeConventions !== false) && (skillsConfig.loadConventions !== false);

  // Filter by relevance score threshold (no arbitrary cap)
  let skillsToLoad = matchedSkills.filter(s => s.score >= minScore);

  // Legacy hard cap support
  if (hardCap) {
    skillsToLoad = skillsToLoad.slice(0, hardCap);
  }

  const context = {
    skills: [],
    totalTokenEstimate: 0
  };

  for (const skill of skillsToLoad) {
    // Use getSkillDir to handle nested paths
    const skillDir = getSkillDir(skill.name);
    const skillContext = {
      name: skill.name,
      score: skill.score,
      reasons: skill.reasons,
      files: {}
    };

    // Content loading follows priority order:
    // skill.md → conventions.md → anti-patterns.md → learnings.md → library-reference.md
    // This ensures team knowledge (conventions) loads before generic docs (library-reference)

    // 1. Load skill.md or SKILL.md (always loaded first - metadata + overview)
    const skillMdPath = getSkillFilePath(skillDir);
    if (fs.existsSync(skillMdPath)) {
      skillContext.files['skill.md'] = fs.readFileSync(skillMdPath, 'utf-8');
    }

    const knowledgeDir = path.join(skillDir, 'knowledge');

    // 2. Load conventions.md (highest priority team knowledge)
    if (includeConventions) {
      // Check knowledge/conventions.md first (new location), fall back to rules/conventions.md (legacy)
      const knowledgeConventionsPath = path.join(knowledgeDir, 'conventions.md');
      const rulesConventionsPath = path.join(skillDir, 'rules', 'conventions.md');

      if (fs.existsSync(knowledgeConventionsPath)) {
        skillContext.files['conventions.md'] = fs.readFileSync(knowledgeConventionsPath, 'utf-8');
      } else if (fs.existsSync(rulesConventionsPath)) {
        skillContext.files['conventions.md'] = fs.readFileSync(rulesConventionsPath, 'utf-8');
      }
    }

    // 3. Load anti-patterns.md
    if (includeAntiPatterns && fs.existsSync(knowledgeDir)) {
      const antiPatternsPath = path.join(knowledgeDir, 'anti-patterns.md');
      if (fs.existsSync(antiPatternsPath)) {
        skillContext.files['anti-patterns.md'] = fs.readFileSync(antiPatternsPath, 'utf-8');
      }
    }

    // 4. Load patterns.md (kept for backwards compat, merged with conventions)
    if (includePatterns && fs.existsSync(knowledgeDir)) {
      const patternsPath = path.join(knowledgeDir, 'patterns.md');
      if (fs.existsSync(patternsPath)) {
        skillContext.files['patterns.md'] = fs.readFileSync(patternsPath, 'utf-8');
      }
    }

    // 5. Load learnings.md
    if (includeLearnings && fs.existsSync(knowledgeDir)) {
      const learningsPath = path.join(knowledgeDir, 'learnings.md');
      if (fs.existsSync(learningsPath)) {
        skillContext.files['learnings.md'] = fs.readFileSync(learningsPath, 'utf-8');
      }
    }

    // 6. Load library-reference.md (lowest priority - supplementary, first to trim)
    if (includeLibraryReference && fs.existsSync(knowledgeDir)) {
      const libraryRefPath = path.join(knowledgeDir, 'library-reference.md');
      if (fs.existsSync(libraryRefPath)) {
        const content = fs.readFileSync(libraryRefPath, 'utf-8');
        skillContext.files['library-reference.md'] = `<!-- Library Reference (supplementary) -->\n${content}`;
      }
    }

    // Estimate tokens (rough: 1 token ≈ 4 chars)
    skillContext.tokenEstimate = Object.values(skillContext.files)
      .reduce((sum, content) => sum + Math.ceil(content.length / 4), 0);

    context.skills.push(skillContext);
    context.totalTokenEstimate += skillContext.tokenEstimate;
  }

  return context;
}

/**
 * Format skill context for display/injection
 */
function formatSkillContext(skillContext) {
  let output = '';

  for (const skill of skillContext.skills) {
    output += `\n${'='.repeat(60)}\n`;
    output += `## Skill: ${skill.name} (score: ${skill.score})\n`;
    output += `Matched because: ${skill.reasons.join(', ')}\n`;
    output += `${'='.repeat(60)}\n\n`;

    for (const [filename, content] of Object.entries(skill.files)) {
      output += `### ${filename}\n\n`;
      output += content;
      output += '\n\n';
    }
  }

  return output;
}

/**
 * Get skill summary for display
 */
function getSkillSummary(matchedSkills) {
  if (matchedSkills.length === 0) {
    return `${colors.dim}No skills matched for this task${colors.reset}`;
  }

  let output = `${colors.cyan}🔧 Matched Skills:${colors.reset}\n`;

  for (const skill of matchedSkills.slice(0, 5)) {
    const scoreBar = '●'.repeat(Math.min(skill.score, 5)) + '○'.repeat(Math.max(0, 5 - skill.score));
    output += `   ${colors.green}${skill.name}${colors.reset} [${scoreBar}]\n`;
    output += `   ${colors.dim}${skill.reasons.slice(0, 3).join(', ')}${colors.reset}\n`;
  }

  if (matchedSkills.length > 5) {
    output += `   ${colors.dim}... and ${matchedSkills.length - 5} more${colors.reset}\n`;
  }

  return output;
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Skill Matcher

Matches skills to task context for automatic loading.

Usage:
  flow skill-match "task description"
  flow skill-match "task description" --files src/auth/*.ts
  flow skill-match --list

Options:
  --files <glob>   Files being modified (for pattern matching)
  --type <type>    Task type (feature, bugfix, refactor)
  --json           Output as JSON
  --list           List all installed skills with triggers
  --help, -h       Show this help

Examples:
  flow skill-match "create user authentication module"
  flow skill-match "fix the login component" --type bugfix
  flow skill-match "refactor entities" --files "src/*.entity.ts"
`);
}

function listSkills() {
  const skills = getAllSkills();

  console.log(`${colors.bold}Installed Skills:${colors.reset}\n`);

  for (const skill of skills) {
    console.log(`${colors.cyan}${skill.name}${colors.reset}`);
    console.log(`  Keywords: ${(skill.triggers.keywords || []).slice(0, 5).join(', ')}`);
    console.log(`  File patterns: ${(skill.filePatterns || []).slice(0, 3).join(', ')}`);
    console.log(`  Task types: ${(skill.triggers.taskTypes || []).join(', ')}`);
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--list')) {
    listSkills();
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');

  // Extract options
  const filesIndex = args.indexOf('--files');
  const filePaths = filesIndex >= 0 ? args[filesIndex + 1]?.split(',') || [] : [];

  const typeIndex = args.indexOf('--type');
  const taskType = typeIndex >= 0 ? args[typeIndex + 1] : 'feature';

  // Get description (everything that's not a flag)
  const description = args
    .filter((a, i) =>
      !a.startsWith('--') &&
      i !== filesIndex + 1 &&
      i !== typeIndex + 1
    )
    .join(' ');

  if (!description) {
    console.log(`${colors.red}Error: Please provide a task description${colors.reset}`);
    showHelp();
    process.exit(1);
  }

  const matches = matchSkills(description, { filePaths, taskType });

  if (jsonOutput) {
    console.log(JSON.stringify(matches, null, 2));
  } else {
    console.log(getSkillSummary(matches));

    if (matches.length > 0) {
      console.log(`\n${colors.dim}Loading top skill context...${colors.reset}\n`);
      const context = await loadSkillContext(matches, { minRelevanceScore: matches[0].score });
      console.log(`${colors.dim}Estimated tokens: ~${context.totalTokenEstimate}${colors.reset}`);
    }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  loadSkillMetadata,
  getAllSkills,
  matchSkills,
  loadSkillContext,
  formatSkillContext,
  getSkillSummary,
  discoverNestedSkills,
  getSkillDir,
  DEFAULT_TRIGGERS,
  MAX_SKILL_NESTING_DEPTH
};

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
