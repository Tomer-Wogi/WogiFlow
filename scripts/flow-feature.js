#!/usr/bin/env node

/**
 * Wogi Flow - Feature Management System
 *
 * Features group related stories into coherent product capabilities.
 * Features reference stories; only stories contain implementation details.
 *
 * Hierarchy:
 * - Plan (pl-XXXXXXXX) → references Epics or Features
 * - Epic (ep-XXXXXXXX) → references Features
 * - Feature (ft-XXXXXXXX) → references Stories
 * - Story (wf-XXXXXXXX) → implementation specs (what Claude implements)
 *
 * File format: .workflow/features/ft-XXXXXXXX.md
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  readFile,
  ensureDir,
  fileExists,
  color,
  success,
  warn,
  error,
  info,
  parseFlags,
  outputJson,
  generateFeatureId,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const FEATURES_DIR = PATHS.features;
const FEATURES_INDEX_PATH = path.join(PATHS.state, 'features.json');

// ============================================================
// Feature Index Management
// ============================================================

/**
 * Load features index
 * @returns {Object} Features index
 */
function loadFeaturesIndex() {
  if (!fs.existsSync(FEATURES_INDEX_PATH)) {
    return { features: {}, version: '1.0.0' };
  }
  try {
    return safeJsonParse(FEATURES_INDEX_PATH, { features: {}, version: '1.0.0' });
  } catch {
    return { features: {}, version: '1.0.0' };
  }
}

/**
 * Save features index
 * @param {Object} index - Index to save
 */
function saveFeaturesIndex(index) {
  ensureDir(PATHS.state);
  index.lastUpdated = new Date().toISOString();
  writeJson(FEATURES_INDEX_PATH, index);
}

// ============================================================
// Feature File Operations
// ============================================================

/**
 * Generate feature markdown template
 * @param {string} featureId - Feature ID
 * @param {string} title - Feature title
 * @param {Object} options - Options (description, parent)
 * @returns {string} Markdown content
 */
function generateFeatureTemplate(featureId, title, options = {}) {
  const { description = '', parent = null } = options;
  const parentLine = parent ? `epic: ${parent}` : 'None';
  const now = new Date().toISOString();

  return `# Feature: ${title}

## Description
<!-- PIN: description -->
${description || '[Describe what this feature delivers to users]'}

## User Value
<!-- PIN: user-value -->
**As a** [user type]
**I want** [this feature]
**So that** [benefit/value]

## Stories
<!-- PIN: stories -->
<!-- Stories are referenced by ID. Add new stories using: flow link ${featureId} wf-XXXXXXXX -->

## Parent
${parentLine}

## Status: ready
## Progress: 0%
## Created: ${now}
## Updated: ${now}
`;
}

/**
 * Parse feature file to extract metadata
 * @param {string} featureId - Feature ID
 * @returns {Object|null} Feature data or null if not found
 */
function parseFeatureFile(featureId) {
  const filePath = path.join(FEATURES_DIR, `${featureId}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const feature = {
      id: featureId,
      title: '',
      description: '',
      stories: [],
      parent: null,
      status: 'ready',
      progress: 0,
      createdAt: null,
      updatedAt: null
    };

    // Parse title from first heading
    const titleMatch = content.match(/^# Feature: (.+)$/m);
    if (titleMatch) {
      feature.title = titleMatch[1].trim();
    }

    // Parse stories section
    const storiesSection = content.match(/## Stories\n<!-- PIN: stories -->\n([\s\S]*?)(?=\n## |$)/);
    if (storiesSection) {
      const storyMatches = storiesSection[1].matchAll(/- (wf-[a-f0-9]{8})/gi);
      for (const match of storyMatches) {
        feature.stories.push(match[1]);
      }
    }

    // Parse parent
    const parentMatch = content.match(/^## Parent\n(?:epic: )?(ep-[a-f0-9]{8}|None)/mi);
    if (parentMatch && parentMatch[1] !== 'None') {
      feature.parent = parentMatch[1];
    }

    // Parse status
    const statusMatch = content.match(/^## Status: (\w+)/m);
    if (statusMatch) {
      feature.status = statusMatch[1];
    }

    // Parse progress
    const progressMatch = content.match(/^## Progress: (\d+)%/m);
    if (progressMatch) {
      feature.progress = parseInt(progressMatch[1], 10);
    }

    // Parse timestamps
    const createdMatch = content.match(/^## Created: (.+)/m);
    if (createdMatch) {
      feature.createdAt = createdMatch[1].trim();
    }
    const updatedMatch = content.match(/^## Updated: (.+)/m);
    if (updatedMatch) {
      feature.updatedAt = updatedMatch[1].trim();
    }

    return feature;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] parseFeatureFile: ${err.message}`);
    return null;
  }
}

/**
 * Update feature file with new data
 * @param {string} featureId - Feature ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} Success
 */
function updateFeatureFile(featureId, updates) {
  const filePath = path.join(FEATURES_DIR, `${featureId}.md`);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    let content = fs.readFileSync(filePath, 'utf-8');

    // Update status
    if (updates.status !== undefined) {
      content = content.replace(/^## Status: \w+/m, `## Status: ${updates.status}`);
    }

    // Update progress
    if (updates.progress !== undefined) {
      content = content.replace(/^## Progress: \d+%/m, `## Progress: ${updates.progress}%`);
    }

    // Update stories
    if (updates.stories !== undefined) {
      const storiesContent = updates.stories.length > 0
        ? updates.stories.map(s => `- ${s}`).join('\n')
        : '<!-- No stories yet -->';

      content = content.replace(
        /## Stories\n<!-- PIN: stories -->\n[\s\S]*?(?=\n## Parent)/,
        `## Stories\n<!-- PIN: stories -->\n${storiesContent}\n\n`
      );
    }

    // Update timestamp
    content = content.replace(/^## Updated: .+/m, `## Updated: ${new Date().toISOString()}`);

    fs.writeFileSync(filePath, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] updateFeatureFile: ${err.message}`);
    return false;
  }
}

// ============================================================
// Feature Operations
// ============================================================

/**
 * Create a new feature
 * @param {string} title - Feature title
 * @param {Object} options - Options (description, parent)
 * @returns {Object} Created feature
 */
function createFeature(title, options = {}) {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return { error: 'Title is required and must be a non-empty string' };
  }

  // Ensure features directory exists
  ensureDir(FEATURES_DIR);

  const featureId = generateFeatureId(title);
  const filePath = path.join(FEATURES_DIR, `${featureId}.md`);

  // Check for collision (extremely unlikely with crypto hash)
  if (fs.existsSync(filePath)) {
    return { error: `Feature file already exists: ${filePath}` };
  }

  // Generate and write feature file
  const content = generateFeatureTemplate(featureId, title, options);
  fs.writeFileSync(filePath, content);

  // Update index
  const index = loadFeaturesIndex();
  index.features[featureId] = {
    id: featureId,
    title,
    parent: options.parent || null,
    stories: [],
    status: 'ready',
    progress: 0,
    createdAt: new Date().toISOString()
  };
  saveFeaturesIndex(index);

  return {
    id: featureId,
    title,
    filePath,
    parent: options.parent || null
  };
}

/**
 * Add a story to a feature
 * @param {string} featureId - Feature ID
 * @param {string} storyId - Story ID to add
 * @returns {Object} Result
 */
function addStoryToFeature(featureId, storyId) {
  const feature = parseFeatureFile(featureId);
  if (!feature) {
    return { error: `Feature ${featureId} not found` };
  }

  if (!storyId || !storyId.startsWith('wf-')) {
    return { error: 'Invalid story ID format. Expected wf-XXXXXXXX' };
  }

  if (feature.stories.includes(storyId)) {
    return { warning: `Story ${storyId} is already in feature ${featureId}` };
  }

  // Update file
  feature.stories.push(storyId);
  updateFeatureFile(featureId, { stories: feature.stories });

  // Update index
  const index = loadFeaturesIndex();
  if (index.features[featureId]) {
    index.features[featureId].stories = feature.stories;
    index.features[featureId].updatedAt = new Date().toISOString();
    saveFeaturesIndex(index);
  }

  return { success: true, featureId, storyId, totalStories: feature.stories.length };
}

/**
 * Remove a story from a feature
 * @param {string} featureId - Feature ID
 * @param {string} storyId - Story ID to remove
 * @returns {Object} Result
 */
function removeStoryFromFeature(featureId, storyId) {
  const feature = parseFeatureFile(featureId);
  if (!feature) {
    return { error: `Feature ${featureId} not found` };
  }

  const idx = feature.stories.indexOf(storyId);
  if (idx < 0) {
    return { warning: `Story ${storyId} is not in feature ${featureId}` };
  }

  feature.stories.splice(idx, 1);
  updateFeatureFile(featureId, { stories: feature.stories });

  // Update index
  const index = loadFeaturesIndex();
  if (index.features[featureId]) {
    index.features[featureId].stories = feature.stories;
    index.features[featureId].updatedAt = new Date().toISOString();
    saveFeaturesIndex(index);
  }

  return { success: true, featureId, storyId, totalStories: feature.stories.length };
}

/**
 * Get feature details
 * @param {string} featureId - Feature ID
 * @returns {Object|null} Feature details or null
 */
function getFeature(featureId) {
  return parseFeatureFile(featureId);
}

/**
 * List all features
 * @returns {Object[]} Array of features
 */
function listFeatures() {
  const index = loadFeaturesIndex();
  const features = [];

  for (const featureId of Object.keys(index.features)) {
    const feature = parseFeatureFile(featureId);
    if (feature) {
      features.push(feature);
    }
  }

  return features;
}

/**
 * Calculate feature progress from story completion
 *
 * NOTE: Features with no stories return 0% progress and 'ready' status.
 * This is intentional - a feature cannot be "complete" until it has at least
 * one story that is completed. This matches the behavior of allStoriesComplete()
 * in flow-done.js which treats no-stories as not-complete.
 *
 * @param {string} featureId - Feature ID
 * @returns {Object} Progress info with featureId, progress, totalStories, completedStories, status
 */
function getFeatureProgress(featureId) {
  const feature = parseFeatureFile(featureId);
  if (!feature) {
    return { error: `Feature ${featureId} not found` };
  }

  // Features without stories are considered 'ready' (not started), not 'complete'
  // A feature needs at least one completed story to have progress
  if (feature.stories.length === 0) {
    return {
      featureId,
      progress: 0,
      totalStories: 0,
      completedStories: 0,
      status: 'ready'  // Not 'completed' - no work to complete doesn't mean done
    };
  }

  // Load ready.json to check story completion
  const readyPath = PATHS.ready;
  if (!fs.existsSync(readyPath)) {
    return {
      featureId,
      progress: 0,
      totalStories: feature.stories.length,
      completedStories: 0,
      status: 'ready'
    };
  }

  const readyData = safeJsonParse(readyPath, { ready: [], inProgress: [], recentlyCompleted: [] });

  // Count completed stories
  let completedCount = 0;
  let inProgressCount = 0;

  for (const storyId of feature.stories) {
    // Check recentlyCompleted
    const isCompleted = (readyData.recentlyCompleted || []).some(
      t => (typeof t === 'string' ? t : t.id) === storyId
    );
    if (isCompleted) {
      completedCount++;
      continue;
    }

    // Check inProgress
    const isInProgress = (readyData.inProgress || []).some(
      t => (typeof t === 'string' ? t : t.id) === storyId
    );
    if (isInProgress) {
      inProgressCount++;
    }
  }

  const progress = Math.round((completedCount / feature.stories.length) * 100);

  // Determine status
  let status = 'ready';
  if (completedCount === feature.stories.length) {
    status = 'completed';
  } else if (inProgressCount > 0 || completedCount > 0) {
    status = 'inProgress';
  }

  // Update feature file with progress
  updateFeatureFile(featureId, { progress, status });

  // Update index
  const index = loadFeaturesIndex();
  if (index.features[featureId]) {
    index.features[featureId].progress = progress;
    index.features[featureId].status = status;
    saveFeaturesIndex(index);
  }

  return {
    featureId,
    progress,
    totalStories: feature.stories.length,
    completedStories: completedCount,
    inProgressStories: inProgressCount,
    status
  };
}

/**
 * Get all stories in a feature
 * @param {string} featureId - Feature ID
 * @returns {string[]} Array of story IDs
 */
function getFeatureStories(featureId) {
  const feature = parseFeatureFile(featureId);
  if (!feature) {
    return [];
  }
  return feature.stories;
}

/**
 * Delete a feature
 * @param {string} featureId - Feature ID
 * @returns {Object} Result
 */
function deleteFeature(featureId) {
  const filePath = path.join(FEATURES_DIR, `${featureId}.md`);
  if (!fs.existsSync(filePath)) {
    return { error: `Feature ${featureId} not found` };
  }

  fs.unlinkSync(filePath);

  // Update index
  const index = loadFeaturesIndex();
  delete index.features[featureId];
  saveFeaturesIndex(index);

  return { deleted: featureId };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format feature summary for display
 * @param {Object} feature - Feature object
 * @returns {string} Formatted summary
 */
function formatFeatureSummary(feature) {
  const lines = [];
  const progressBar = '█'.repeat(Math.floor(feature.progress / 5)) + '░'.repeat(20 - Math.floor(feature.progress / 5));

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Feature: ${feature.title || feature.id}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(`ID: ${feature.id}`);
  lines.push(`Progress: [${progressBar}] ${feature.progress}%`);
  lines.push(`Status: ${feature.status}`);
  lines.push(`Stories: ${feature.stories?.length || 0}`);
  if (feature.parent) {
    lines.push(`Parent Epic: ${feature.parent}`);
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format features list for display
 * @param {Object[]} features - Array of features
 * @returns {string} Formatted list
 */
function formatFeaturesList(features) {
  if (features.length === 0) {
    return 'No features found. Create one with: flow feature "<title>"';
  }

  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Features');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  for (const feature of features) {
    const statusIcon = feature.status === 'completed' ? '✓' :
                       feature.status === 'inProgress' ? '→' : '·';
    lines.push(`${statusIcon} ${feature.id}: ${feature.title || 'Untitled'}`);
    lines.push(`    Progress: ${feature.progress}% | Stories: ${feature.stories?.length || 0}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');
  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core operations
  createFeature,
  getFeature,
  listFeatures,
  deleteFeature,

  // Story management
  addStoryToFeature,
  removeStoryFromFeature,
  getFeatureStories,

  // Progress tracking
  getFeatureProgress,

  // Index management
  loadFeaturesIndex,
  saveFeaturesIndex,

  // File operations
  parseFeatureFile,
  updateFeatureFile,

  // Formatting
  formatFeatureSummary,
  formatFeaturesList,

  // Constants
  FEATURES_DIR,
  FEATURES_INDEX_PATH
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Wogi Flow - Feature Management

Usage:
  flow feature create "<title>"           Create a new feature
  flow feature show <featureId>           Show feature details
  flow feature list                       List all features
  flow feature add-story <featureId> <storyId>    Add story to feature
  flow feature remove-story <featureId> <storyId> Remove story from feature
  flow feature progress <featureId>       Show feature progress
  flow feature delete <featureId>         Delete a feature

Options:
  --parent <epicId>    Set parent epic when creating
  --json               Output as JSON
  --help               Show this help

Examples:
  flow feature create "User Authentication"
  flow feature create "Payment System" --parent ep-a1b2c3d4
  flow feature add-story ft-a1b2c3d4 wf-e5f6g7h8
`);
    process.exit(0);
  }

  switch (command) {
    case 'create': {
      const title = positional[1];
      if (!title) {
        error('Title is required: flow feature create "<title>"');
        process.exit(1);
      }

      const result = createFeature(title, { parent: flags.parent });
      if (result.error) {
        error(result.error);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, ...result });
      } else {
        success(`Created feature: ${result.id}`);
        console.log(`  File: ${result.filePath}`);
        console.log(`  Title: ${result.title}`);
        if (result.parent) {
          console.log(`  Parent: ${result.parent}`);
        }
        console.log('');
        info('Next: Add stories with: flow feature add-story ' + result.id + ' wf-XXXXXXXX');
      }
      break;
    }

    case 'show': {
      const featureId = positional[1];
      if (!featureId) {
        error('Feature ID required: flow feature show <featureId>');
        process.exit(1);
      }

      const feature = getFeature(featureId);
      if (!feature) {
        error(`Feature ${featureId} not found`);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, feature });
      } else {
        console.log(formatFeatureSummary(feature));
        if (feature.stories.length > 0) {
          console.log('Stories:');
          feature.stories.forEach(s => console.log(`  - ${s}`));
        }
      }
      break;
    }

    case 'list': {
      const features = listFeatures();

      if (flags.json) {
        outputJson({ success: true, features });
      } else {
        console.log(formatFeaturesList(features));
      }
      break;
    }

    case 'add-story': {
      const featureId = positional[1];
      const storyId = positional[2];
      if (!featureId || !storyId) {
        error('Usage: flow feature add-story <featureId> <storyId>');
        process.exit(1);
      }

      const result = addStoryToFeature(featureId, storyId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      if (result.warning) {
        warn(result.warning);
      } else {
        success(`Added story ${storyId} to feature ${featureId}`);
        console.log(`  Total stories: ${result.totalStories}`);
      }
      break;
    }

    case 'remove-story': {
      const featureId = positional[1];
      const storyId = positional[2];
      if (!featureId || !storyId) {
        error('Usage: flow feature remove-story <featureId> <storyId>');
        process.exit(1);
      }

      const result = removeStoryFromFeature(featureId, storyId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      if (result.warning) {
        warn(result.warning);
      } else {
        success(`Removed story ${storyId} from feature ${featureId}`);
      }
      break;
    }

    case 'progress': {
      const featureId = positional[1];
      if (!featureId) {
        error('Feature ID required: flow feature progress <featureId>');
        process.exit(1);
      }

      const progress = getFeatureProgress(featureId);
      if (progress.error) {
        error(progress.error);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, ...progress });
      } else {
        success(`Feature ${featureId}: ${progress.progress}%`);
        console.log(`  Completed: ${progress.completedStories}/${progress.totalStories} stories`);
        console.log(`  Status: ${progress.status}`);
      }
      break;
    }

    case 'delete': {
      const featureId = positional[1];
      if (!featureId) {
        error('Feature ID required: flow feature delete <featureId>');
        process.exit(1);
      }

      const result = deleteFeature(featureId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }

      success(`Deleted feature ${featureId}`);
      break;
    }

    default:
      error(`Unknown command: ${command}`);
      console.log('Run: flow feature --help');
      process.exit(1);
  }
}
