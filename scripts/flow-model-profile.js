#!/usr/bin/env node

/**
 * Wogi Flow - Model Profile Manager
 *
 * Manages per-model learning profiles for hybrid mode.
 * Each model can have different optimal settings based on learned behavior.
 *
 * Features:
 * - CRUD operations for model profiles
 * - PIN-based selective loading for task-specific context
 * - Instruction richness calculation based on learned preferences
 * - Failure tracking and pattern detection
 *
 * Part of Hybrid Mode Intelligence System
 *
 * Usage:
 *   const { getModelProfile, updateModelProfile } = require('./flow-model-profile');
 *
 *   // Get profile for a model
 *   const profile = getModelProfile('qwen3-coder', 'create');
 *
 *   // Update after learning
 *   updateModelProfile('qwen3-coder', { taskType: 'create', ... });
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  writeFile,
  fileExists,
  dirExists,
  success,
  warn,
  info,
  error,
  parseFlags,
  outputJson,
  safeJsonParse
} = require('./flow-utils');

const { getSectionsByPins, readIndex } = require('./flow-section-index');

// ============================================================
// Configuration
// ============================================================

const PROFILES_DIR = path.join(PATHS.state, 'model-profiles');
const TEMPLATE_PATH = path.join(PROFILES_DIR, '_template.md');

// Default profile settings
const DEFAULT_SETTINGS = {
  optimal_example_count: 2,
  needs_explicit_imports: true,
  type_inline_threshold: 50,
  preferred_prompt_structure: 'task-first',
  context_density: 'standard'
};

// Task types with their default requirements
const TASK_TYPES = {
  create: {
    defaultNeeds: ['Component example', 'full prop types'],
    defaultStruggles: []
  },
  modify: {
    defaultNeeds: ['Full file context', 'clear diff markers'],
    defaultStruggles: []
  },
  refactor: {
    defaultNeeds: ['Dependency map', 'before/after examples'],
    defaultStruggles: []
  },
  fix: {
    defaultNeeds: ['Error context', 'stack trace', 'related code'],
    defaultStruggles: []
  },
  integrate: {
    defaultNeeds: ['API documentation', 'connection patterns'],
    defaultStruggles: []
  }
};

// ============================================================
// Profile Path Utilities
// ============================================================

/**
 * Normalize model ID for file naming
 * @param {string} modelId - Raw model identifier
 * @returns {string} - Normalized ID (kebab-case)
 */
function normalizeModelId(modelId) {
  if (!modelId) return 'unknown';
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get profile file path for a model
 * @param {string} modelId - Model identifier
 * @returns {string} - Full path to profile file
 */
function getProfilePath(modelId) {
  const normalized = normalizeModelId(modelId);
  return path.join(PROFILES_DIR, `${normalized}.md`);
}

// ============================================================
// Profile Parsing
// ============================================================

/**
 * Parse a model profile markdown file into structured data
 * @param {string} content - Profile file content
 * @returns {Object} - Parsed profile data
 */
function parseProfileContent(content) {
  const profile = {
    settings: { ...DEFAULT_SETTINGS },
    taskLearnings: {},
    failures: []
  };

  // Parse General Settings section
  const settingsMatch = content.match(/## General Settings[\s\S]*?(?=##|$)/);
  if (settingsMatch) {
    const settingsText = settingsMatch[0];

    // Extract key-value pairs
    const keyValueRegex = /- (\w+):\s*(.+)/g;
    let match;
    while ((match = keyValueRegex.exec(settingsText)) !== null) {
      const key = match[1];
      let value = match[2].trim();

      // Parse value type
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = parseInt(value);

      profile.settings[key] = value;
    }
  }

  // Parse task-specific sections
  for (const taskType of Object.keys(TASK_TYPES)) {
    const taskTitle = taskType.charAt(0).toUpperCase() + taskType.slice(1);
    const taskRegex = new RegExp(`### ${taskTitle} Tasks[\\s\\S]*?(?=###|## |$)`);
    const taskMatch = content.match(taskRegex);

    if (taskMatch) {
      const taskText = taskMatch[0];
      const learning = {
        successRate: null,
        needs: [],
        struggles: []
      };

      // Extract success rate
      const rateMatch = taskText.match(/Success rate:\s*([\d.]+)%?/i);
      if (rateMatch) {
        learning.successRate = parseFloat(rateMatch[1]);
      }

      // Extract needs
      const needsMatch = taskText.match(/Needs:\s*(.+)/i);
      if (needsMatch) {
        learning.needs = needsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }

      // Extract struggles
      const strugglesMatch = taskText.match(/Struggles with:\s*(.+)/i);
      if (strugglesMatch && !strugglesMatch[1].includes('To be learned')) {
        learning.struggles = strugglesMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }

      profile.taskLearnings[taskType] = learning;
    }
  }

  // Parse failures table
  const failuresMatch = content.match(/## Failure Learnings[\s\S]*$/);
  if (failuresMatch) {
    const tableRegex = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
    let rowMatch;
    while ((rowMatch = tableRegex.exec(failuresMatch[0])) !== null) {
      profile.failures.push({
        date: rowMatch[1],
        taskType: rowMatch[2].trim(),
        error: rowMatch[3].trim(),
        missingInfo: rowMatch[4].trim(),
        fixApplied: rowMatch[5].trim()
      });
    }
  }

  return profile;
}

/**
 * Serialize profile data back to markdown
 * @param {string} modelId - Model identifier
 * @param {Object} profile - Profile data
 * @returns {string} - Markdown content
 */
function serializeProfile(modelId, profile) {
  const normalized = normalizeModelId(modelId);
  const displayName = modelId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let content = `<!-- Model Profile for ${displayName} -->
<!-- PINS: model-profile, ${normalized}, local-llm -->

# ${displayName} Profile

## General Settings
<!-- PIN: ${normalized}-settings -->
`;

  // Add settings
  for (const [key, value] of Object.entries(profile.settings)) {
    content += `- ${key}: ${value}\n`;
  }

  content += `
## Task-Specific Learnings
`;

  // Add task sections
  for (const [taskType, defaults] of Object.entries(TASK_TYPES)) {
    const taskTitle = taskType.charAt(0).toUpperCase() + taskType.slice(1);
    const learning = profile.taskLearnings[taskType] || {};

    content += `
### ${taskTitle} Tasks
<!-- PIN: ${normalized}-${taskType} -->
- Success rate: ${learning.successRate !== null && learning.successRate !== undefined ? `${learning.successRate}%` : 'N/A'}
- Needs: ${(learning.needs && learning.needs.length > 0) ? learning.needs.join(', ') : defaults.defaultNeeds.join(', ')}
- Struggles with: ${(learning.struggles && learning.struggles.length > 0) ? learning.struggles.join(', ') : '(To be learned)'}
`;
  }

  content += `
## Failure Learnings
<!-- PIN: ${normalized}-failures -->
| Date | Task Type | Error | Missing Info | Fix Applied |
|------|-----------|-------|--------------|-------------|
`;

  // Add failure rows (last 20)
  const recentFailures = (profile.failures || []).slice(-20);
  for (const failure of recentFailures) {
    content += `| ${failure.date} | ${failure.taskType} | ${failure.error} | ${failure.missingInfo} | ${failure.fixApplied} |\n`;
  }

  return content;
}

// ============================================================
// Profile CRUD Operations
// ============================================================

/**
 * Get model profile with optional PIN-based selective loading
 * @param {string} modelId - Model identifier
 * @param {string|null} taskType - Optional task type to load specific section
 * @returns {Object} - Profile data or defaults
 */
function getModelProfile(modelId, taskType = null) {
  const profilePath = getProfilePath(modelId);

  // Check if profile exists
  if (!fileExists(profilePath)) {
    return createDefaultProfile(modelId);
  }

  try {
    const content = readFile(profilePath);
    const profile = parseProfileContent(content);
    profile.modelId = modelId;
    profile.profilePath = profilePath;

    // If task type specified, also try PIN-based loading for additional context
    if (taskType) {
      const normalized = normalizeModelId(modelId);
      const pins = [`${normalized}-${taskType}`, `${normalized}-settings`];

      try {
        const sections = getSectionsByPins(pins);
        // Validate sections is an array before storing
        if (Array.isArray(sections)) {
          profile._pinSections = sections.filter(s => s && typeof s === 'object');
        }
      } catch (err) {
        // PIN lookup optional, continue without it
      }
    }

    return profile;
  } catch (err) {
    warn(`Error reading profile for ${modelId}: ${err.message}`);
    return createDefaultProfile(modelId);
  }
}

/**
 * Create a default profile for a new model
 * @param {string} modelId - Model identifier
 * @returns {Object} - Default profile data
 */
function createDefaultProfile(modelId) {
  return {
    modelId,
    settings: { ...DEFAULT_SETTINGS },
    taskLearnings: {},
    failures: [],
    isDefault: true
  };
}

/**
 * Save or create a model profile
 * @param {string} modelId - Model identifier
 * @param {Object} profile - Profile data
 * @returns {Object} - Result with success status
 */
function saveModelProfile(modelId, profile) {
  // Ensure directory exists
  if (!dirExists(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  const profilePath = getProfilePath(modelId);
  const content = serializeProfile(modelId, profile);

  try {
    writeFile(profilePath, content);
    return { success: true, path: profilePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update model profile after learning from a task
 * @param {string} modelId - Model identifier
 * @param {Object} learning - Learning data from task execution
 * @returns {Object} - Updated profile
 */
function updateModelProfile(modelId, learning) {
  const profile = getModelProfile(modelId);

  // Update based on learning type
  if (learning.taskType && learning.success !== undefined) {
    // Update task-specific learning
    if (!profile.taskLearnings[learning.taskType]) {
      profile.taskLearnings[learning.taskType] = {
        successRate: null,
        needs: [],
        struggles: [],
        attempts: 0,
        successes: 0
      };
    }

    const taskLearning = profile.taskLearnings[learning.taskType];
    taskLearning.attempts = (taskLearning.attempts || 0) + 1;

    if (learning.success) {
      taskLearning.successes = (taskLearning.successes || 0) + 1;
    }

    // Calculate new success rate
    taskLearning.successRate = Math.round(
      (taskLearning.successes / taskLearning.attempts) * 100
    );

    // Add needs if specified
    if (learning.neededContext && !taskLearning.needs.includes(learning.neededContext)) {
      taskLearning.needs.push(learning.neededContext);
    }

    // Add struggles if failed
    if (!learning.success && learning.errorCategory) {
      if (!taskLearning.struggles.includes(learning.errorCategory)) {
        taskLearning.struggles.push(learning.errorCategory);
      }
    }
  }

  // Add failure record if provided
  if (learning.failure) {
    const date = new Date().toISOString().split('T')[0];
    profile.failures.push({
      date,
      taskType: learning.taskType || 'unknown',
      error: (learning.failure.error || '').slice(0, 50),
      missingInfo: learning.failure.missingInfo || 'Unknown',
      fixApplied: learning.failure.fixApplied || 'N/A'
    });
    // Keep only last 100 failures to prevent unbounded growth
    if (profile.failures.length > 100) {
      profile.failures = profile.failures.slice(-100);
    }
  }

  // Update settings if provided
  if (learning.settings) {
    Object.assign(profile.settings, learning.settings);
  }

  // Save updated profile
  profile.isDefault = false;
  saveModelProfile(modelId, profile);

  return profile;
}

/**
 * Delete a model profile
 * @param {string} modelId - Model identifier
 * @returns {Object} - Result with success status
 */
function deleteModelProfile(modelId) {
  const profilePath = getProfilePath(modelId);

  if (!fileExists(profilePath)) {
    return { success: false, error: 'Profile not found' };
  }

  try {
    fs.unlinkSync(profilePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * List all model profiles
 * @returns {Object[]} - Array of profile summaries
 */
function listModelProfiles() {
  if (!dirExists(PROFILES_DIR)) {
    return [];
  }

  try {
    const files = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'));

    return files.map(file => {
      const modelId = file.replace('.md', '');
      const profile = getModelProfile(modelId);
      return {
        modelId,
        file,
        isDefault: profile.isDefault || false,
        settings: profile.settings,
        taskCount: Object.keys(profile.taskLearnings).length,
        failureCount: profile.failures.length
      };
    });
  } catch (err) {
    warn(`Error listing profiles: ${err.message}`);
    return [];
  }
}

// ============================================================
// Instruction Richness Calculation
// ============================================================

/**
 * Calculate instruction richness based on learned profile
 * This replaces the fixed 3-level system with learned preferences
 *
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type (create, modify, refactor, fix, integrate)
 * @param {number} tokenBudget - Available token budget
 * @returns {Object} - Instruction richness configuration
 */
function getInstructionRichness(modelId, taskType, tokenBudget = 8192) {
  const profile = getModelProfile(modelId, taskType);
  const settings = profile.settings;
  const taskLearning = profile.taskLearnings[taskType] || {};

  // Base configuration from settings
  const richness = {
    exampleCount: settings.optimal_example_count || 2,
    inlineTypes: tokenBudget < (settings.type_inline_threshold || 50),
    includeImportMap: settings.needs_explicit_imports !== false,
    promptStructure: settings.preferred_prompt_structure || 'task-first',
    contextDensity: settings.context_density || 'standard'
  };

  // Adjust based on task-specific learning
  if (taskLearning.successRate !== null) {
    // Lower success rate = more examples and context
    if (taskLearning.successRate < 60) {
      richness.exampleCount = Math.min(richness.exampleCount + 2, 5);
      richness.contextDensity = 'comprehensive';
    } else if (taskLearning.successRate < 80) {
      richness.exampleCount = Math.min(richness.exampleCount + 1, 4);
      richness.contextDensity = 'detailed';
    }
  }

  // Add specific needs based on learning
  richness.additionalContext = [];

  if (taskLearning.needs && taskLearning.needs.length > 0) {
    richness.additionalContext = [...taskLearning.needs];
  }

  // Mark struggles to warn about
  richness.knownStruggles = taskLearning.struggles || [];

  // Include profile metadata
  richness.modelId = modelId;
  richness.taskType = taskType;
  richness.profileBased = !profile.isDefault;

  return richness;
}

/**
 * Get recommended context sections for a task
 * Uses both profile learning and PIN system
 *
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type
 * @param {string} taskDescription - Task description for additional matching
 * @returns {Object} - Context recommendation
 */
function getContextRecommendation(modelId, taskType, taskDescription = '') {
  const richness = getInstructionRichness(modelId, taskType);

  const recommendation = {
    richness,
    pins: [],
    sections: [],
    priority: 'standard'
  };

  // Build PIN list based on task type and learned needs
  const normalized = normalizeModelId(modelId);

  // Always include model-specific settings
  recommendation.pins.push(`${normalized}-settings`);
  recommendation.pins.push(`${normalized}-${taskType}`);

  // Add task-type specific PINs
  const taskPins = {
    create: ['component-creation', 'component-naming', 'task-create'],
    modify: ['file-safety', 'task-modify'],
    refactor: ['component-reuse', 'task-refactor'],
    fix: ['error-handling', 'try-catch', 'task-fix'],
    integrate: ['api-pattern', 'task-integrate']
  };

  if (taskPins[taskType]) {
    recommendation.pins.push(...taskPins[taskType]);
  }

  // Add PINs based on learned needs
  for (const need of richness.additionalContext) {
    const needLower = need.toLowerCase();
    if (needLower.includes('type')) recommendation.pins.push('json-safety');
    if (needLower.includes('import')) recommendation.pins.push('fs-read');
    if (needLower.includes('error')) recommendation.pins.push('error-handling');
    if (needLower.includes('pattern')) recommendation.pins.push('naming-convention');
  }

  // Determine priority based on success rate
  const taskLearning = getModelProfile(modelId).taskLearnings[taskType] || {};
  if (taskLearning.successRate !== null) {
    if (taskLearning.successRate < 60) {
      recommendation.priority = 'high';
    } else if (taskLearning.successRate < 80) {
      recommendation.priority = 'elevated';
    }
  }

  // Try to load sections by PIN
  try {
    recommendation.sections = getSectionsByPins(recommendation.pins);
  } catch (err) {
    // PIN lookup optional
  }

  return recommendation;
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Wogi Flow - Model Profile Manager

Usage: node scripts/flow-model-profile.js <command> [options]

Commands:
  list                    List all model profiles
  get <model-id>          Get profile for a model
  create <model-id>       Create a new profile from template
  update <model-id>       Update profile (interactive)
  delete <model-id>       Delete a profile
  richness <model-id> <task-type>  Calculate instruction richness

Options:
  --json                  Output as JSON
  --task-type=<type>      Task type (create, modify, refactor, fix, integrate)
  --help                  Show this help message

Examples:
  node scripts/flow-model-profile.js list
  node scripts/flow-model-profile.js get qwen3-coder
  node scripts/flow-model-profile.js richness qwen3-coder create --json
`);
    process.exit(0);
  }

  switch (command) {
  case 'list': {
    const profiles = listModelProfiles();

    if (flags.json) {
      outputJson(profiles);
      return;
    }

    if (profiles.length === 0) {
      info('No model profiles found.');
      info(`Create one with: node scripts/flow-model-profile.js create <model-id>`);
      return;
    }

    console.log('\nModel Profiles:\n');
    for (const p of profiles) {
      const status = p.isDefault ? '(default)' : `(${p.taskCount} task types, ${p.failureCount} failures)`;
      console.log(`  ${p.modelId} ${status}`);
    }
    console.log('');
    break;
  }

  case 'get': {
    const modelId = positional[1];
    if (!modelId) {
      error('Model ID required');
      process.exit(1);
    }

    const profile = getModelProfile(modelId, flags['task-type']);

    if (flags.json) {
      outputJson(profile);
      return;
    }

    console.log(`\nProfile for ${modelId}:\n`);
    console.log('Settings:');
    for (const [key, value] of Object.entries(profile.settings)) {
      console.log(`  ${key}: ${value}`);
    }

    if (Object.keys(profile.taskLearnings).length > 0) {
      console.log('\nTask Learnings:');
      for (const [taskType, learning] of Object.entries(profile.taskLearnings)) {
        const rate = learning.successRate !== null ? `${learning.successRate}%` : 'N/A';
        console.log(`  ${taskType}: ${rate} success`);
        if (learning.needs.length > 0) {
          console.log(`    Needs: ${learning.needs.join(', ')}`);
        }
        if (learning.struggles.length > 0) {
          console.log(`    Struggles: ${learning.struggles.join(', ')}`);
        }
      }
    }

    if (profile.failures.length > 0) {
      console.log(`\nRecent Failures: ${profile.failures.length}`);
    }
    console.log('');
    break;
  }

  case 'create': {
    const modelId = positional[1];
    if (!modelId) {
      error('Model ID required');
      process.exit(1);
    }

    const profile = createDefaultProfile(modelId);
    const result = saveModelProfile(modelId, profile);

    if (result.success) {
      success(`Created profile at ${result.path}`);
    } else {
      error(`Failed to create profile: ${result.error}`);
      process.exit(1);
    }
    break;
  }

  case 'delete': {
    const modelId = positional[1];
    if (!modelId) {
      error('Model ID required');
      process.exit(1);
    }

    const result = deleteModelProfile(modelId);
    if (result.success) {
      success(`Deleted profile for ${modelId}`);
    } else {
      error(`Failed to delete profile: ${result.error}`);
      process.exit(1);
    }
    break;
  }

  case 'richness': {
    const modelId = positional[1];
    const taskType = positional[2] || flags['task-type'] || 'create';

    if (!modelId) {
      error('Model ID required');
      process.exit(1);
    }

    const richness = getInstructionRichness(modelId, taskType);

    if (flags.json) {
      outputJson(richness);
      return;
    }

    console.log(`\nInstruction Richness for ${modelId} (${taskType}):\n`);
    console.log(`  Examples: ${richness.exampleCount}`);
    console.log(`  Inline Types: ${richness.inlineTypes ? 'Yes' : 'No'}`);
    console.log(`  Import Map: ${richness.includeImportMap ? 'Yes' : 'No'}`);
    console.log(`  Prompt Structure: ${richness.promptStructure}`);
    console.log(`  Context Density: ${richness.contextDensity}`);

    if (richness.additionalContext.length > 0) {
      console.log(`  Additional Context: ${richness.additionalContext.join(', ')}`);
    }

    if (richness.knownStruggles.length > 0) {
      console.log(`  Known Struggles: ${richness.knownStruggles.join(', ')}`);
    }

    console.log(`\n  Profile-based: ${richness.profileBased ? 'Yes (learned)' : 'No (defaults)'}`);
    console.log('');
    break;
  }

  case 'recommend': {
    const modelId = positional[1];
    const taskType = positional[2] || flags['task-type'] || 'create';
    const taskDesc = flags.task || positional.slice(3).join(' ') || '';

    if (!modelId) {
      error('Model ID required');
      process.exit(1);
    }

    const recommendation = getContextRecommendation(modelId, taskType, taskDesc);

    if (flags.json) {
      outputJson(recommendation);
      return;
    }

    console.log(`\nContext Recommendation for ${modelId} (${taskType}):\n`);
    console.log(`  Priority: ${recommendation.priority}`);
    console.log(`  PINs to load: ${recommendation.pins.join(', ')}`);

    if (recommendation.sections.length > 0) {
      console.log(`  Sections found: ${recommendation.sections.length}`);
      for (const section of recommendation.sections.slice(0, 5)) {
        console.log(`    - ${section.id} (score: ${section.matchScore?.toFixed(2) || 'N/A'})`);
      }
    }
    console.log('');
    break;
  }

  default:
    error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Profile CRUD
  getModelProfile,
  saveModelProfile,
  updateModelProfile,
  deleteModelProfile,
  listModelProfiles,
  createDefaultProfile,

  // Path utilities
  getProfilePath,
  normalizeModelId,

  // Parsing
  parseProfileContent,
  serializeProfile,

  // Instruction richness
  getInstructionRichness,
  getContextRecommendation,

  // Constants
  PROFILES_DIR,
  DEFAULT_SETTINGS,
  TASK_TYPES
};

// Run if called directly
if (require.main === module) {
  main();
}
