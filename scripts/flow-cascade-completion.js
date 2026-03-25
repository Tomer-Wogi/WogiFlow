#!/usr/bin/env node
/**
 * Wogi Flow - Cascade Completion (v3.2)
 *
 * Handles story->feature->epic->plan progress propagation.
 * When a work item completes, checks if parent items can be auto-completed.
 *
 * Extracted from flow-done.js for modularity.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, color, warn, safeJsonParse } = require('./flow-utils');

// v3.0 epic progress propagation
const { listEpics, getEpic } = require('./flow-epics');

// v3.2 hierarchical work item management
let flowFeature;
let flowPlan;
try {
  flowFeature = require('./flow-feature');
  flowPlan = require('./flow-plan');
} catch (err) {
  // Modules optional - graceful degradation
  flowFeature = null;
  flowPlan = null;
}

// ============================================================
// Parent Lookup Functions
// ============================================================

/**
 * Find parent feature for a story
 * @param {string} storyId - Story ID (wf-XXXXXXXX)
 * @returns {Object|null} Feature object or null
 */
function findParentFeature(storyId) {
  if (!flowFeature) return null;

  try {
    const features = flowFeature.listFeatures();
    for (const feature of features) {
      if (feature.stories && feature.stories.includes(storyId)) {
        return feature;
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] findParentFeature: ${err.message}`);
  }
  return null;
}

/**
 * Find parent epic for a feature
 * @param {string} featureId - Feature ID (ft-XXXXXXXX)
 * @returns {Object|null} Epic object or null
 */
function findParentEpic(featureId) {
  try {
    const epics = listEpics();
    for (const epic of epics) {
      if (epic.features && epic.features.includes(featureId)) {
        return epic;
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] findParentEpic: ${err.message}`);
  }
  return null;
}

/**
 * Find parent plan for an epic
 * @param {string} epicId - Epic ID (ep-XXXXXXXX)
 * @returns {Object|null} Plan object or null
 */
function findParentPlan(epicId) {
  if (!flowPlan) return null;

  try {
    const plans = flowPlan.listPlans();
    for (const plan of plans) {
      if (plan.epics && plan.epics.includes(epicId)) {
        return plan;
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] findParentPlan: ${err.message}`);
  }
  return null;
}

// ============================================================
// Completion Check Functions
// ============================================================

/**
 * Check if all stories in a feature are complete
 * @param {Object} feature - Feature object
 * @returns {boolean} True if all stories are complete
 */
function allStoriesComplete(feature) {
  if (!feature.stories || feature.stories.length === 0) {
    return false;  // No stories = not complete
  }

  try {
    // Use safeJsonParse per security-patterns.md Rule #2 (protects against prototype pollution)
    const readyData = safeJsonParse(PATHS.ready, { ready: [], inProgress: [], recentlyCompleted: [] });

    for (const storyId of feature.stories) {
      // Story must be in recentlyCompleted to be considered complete
      const isComplete = (readyData.recentlyCompleted || []).some(
        t => (typeof t === 'string' ? t : t.id) === storyId
      );
      if (!isComplete) {
        return false;
      }
    }
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] allStoriesComplete: ${err.message}`);
    return false;
  }
}

/**
 * Check if all features in an epic are complete
 * @param {Object} epic - Epic object
 * @returns {boolean} True if all features are complete
 */
function allFeaturesComplete(epic) {
  if (!flowFeature) return false;
  if (!epic.features || epic.features.length === 0) {
    // If epic has no features, check stories directly
    if (!epic.stories || epic.stories.length === 0) {
      return false;
    }
    // Check if all direct stories are complete
    try {
      // Use safeJsonParse per security-patterns.md Rule #2
      const readyData = safeJsonParse(PATHS.ready, { ready: [], inProgress: [], recentlyCompleted: [] });
      for (const storyId of epic.stories) {
        const isComplete = (readyData.recentlyCompleted || []).some(
          t => (typeof t === 'string' ? t : t.id) === storyId
        );
        if (!isComplete) return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  try {
    for (const featureId of epic.features) {
      const feature = flowFeature.getFeature(featureId);
      if (!feature || feature.status !== 'completed') {
        return false;
      }
    }
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] allFeaturesComplete: ${err.message}`);
    return false;
  }
}

/**
 * Check if all epics in a plan are complete
 * @param {Object} plan - Plan object
 * @returns {boolean} True if all epics are complete
 */
function allEpicsComplete(plan) {
  if (!plan.epics || plan.epics.length === 0) {
    // Check standalone features in the plan
    if (!flowFeature || !plan.features || plan.features.length === 0) {
      return false;
    }
    for (const featureId of plan.features) {
      const feature = flowFeature.getFeature(featureId);
      if (!feature || feature.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  try {
    for (const epicId of plan.epics) {
      const epic = getEpic(epicId);
      if (!epic || epic.status !== 'completed') {
        return false;
      }
    }
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] allEpicsComplete: ${err.message}`);
    return false;
  }
}

// ============================================================
// Type-Aware Archive System (v3.2)
// ============================================================

/**
 * Archive a work item by type
 * Routes to correct archive directory based on item type
 *
 * | Type    | Source                | Destination                        |
 * |---------|----------------------|-------------------------------------|
 * | story   | .workflow/changes/   | .workflow/archive/specs/YYYY-MM/    |
 * | feature | .workflow/features/  | .workflow/archive/features/YYYY-MM/ |
 * | epic    | .workflow/epics/     | .workflow/archive/epics/YYYY-MM/    |
 * | plan    | .workflow/plans/     | .workflow/archive/plans/YYYY-MM/    |
 *
 * @param {string} itemId - Item ID to archive
 * @param {string} itemType - Type: 'story', 'feature', 'epic', 'plan'
 * @returns {Object} Archive result
 */
function archiveByType(itemId, itemType) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const typeConfig = {
    story: {
      sourceDir: path.join(PATHS.workflow, 'changes'),
      archiveDir: path.join(PATHS.workflow, 'archive', 'specs', yearMonth),
      pattern: /^wf-[a-f0-9]{8}/i
    },
    feature: {
      sourceDir: path.join(PATHS.workflow, 'features'),
      archiveDir: path.join(PATHS.workflow, 'archive', 'features', yearMonth),
      pattern: /^ft-[a-f0-9]{8}/i
    },
    epic: {
      sourceDir: path.join(PATHS.workflow, 'epics'),
      archiveDir: path.join(PATHS.workflow, 'archive', 'epics', yearMonth),
      pattern: /^ep-[a-f0-9]{8}/i
    },
    plan: {
      sourceDir: path.join(PATHS.workflow, 'plans'),
      archiveDir: path.join(PATHS.workflow, 'archive', 'plans', yearMonth),
      pattern: /^pl-[a-f0-9]{8}/i
    }
  };

  const config = typeConfig[itemType];
  if (!config) {
    return { error: `Unknown item type: ${itemType}` };
  }

  const fileName = `${itemId}.md`;
  const sourcePath = path.join(config.sourceDir, fileName);

  if (!fs.existsSync(sourcePath)) {
    return { skipped: true, reason: 'Source file not found' };
  }

  try {
    // Ensure archive directory exists
    if (!fs.existsSync(config.archiveDir)) {
      fs.mkdirSync(config.archiveDir, { recursive: true });
    }

    const targetPath = path.join(config.archiveDir, fileName);
    fs.renameSync(sourcePath, targetPath);

    return {
      archived: true,
      from: sourcePath,
      to: targetPath,
      itemId,
      itemType,
      yearMonth
    };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] archiveByType: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Archive completed parent work item and update indices
 * Called when cascade completion marks a parent as complete
 *
 * @param {string} itemId - Item ID to archive
 * @param {string} itemType - Type: 'feature', 'epic', 'plan'
 */
function archiveCompletedParent(itemId, itemType) {
  try {
    const result = archiveByType(itemId, itemType);

    if (result.archived) {
      console.log(color('dim', `  \u{1F4E6} Archived ${itemType} ${itemId} to ${result.yearMonth}/`));

      // Update the appropriate index
      if (itemType === 'feature' && flowFeature) {
        const index = flowFeature.loadFeaturesIndex();
        if (index.features[itemId]) {
          index.features[itemId].archived = true;
          index.features[itemId].archivedAt = new Date().toISOString();
          flowFeature.saveFeaturesIndex(index);
        }
      } else if (itemType === 'epic') {
        const { loadEpicsState, saveEpicsState } = require('./flow-epics');
        const state = loadEpicsState();
        if (state.epics[itemId]) {
          state.epics[itemId].archived = true;
          state.epics[itemId].archivedAt = new Date().toISOString();
          saveEpicsState(state);
        }
      } else if (itemType === 'plan' && flowPlan) {
        const index = flowPlan.loadPlansIndex();
        if (index.plans[itemId]) {
          index.plans[itemId].archived = true;
          index.plans[itemId].archivedAt = new Date().toISOString();
          flowPlan.savePlansIndex(index);
        }
      }
    }

    return result;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] archiveCompletedParent: ${err.message}`);
    return { error: err.message };
  }
}

// ============================================================
// Mark Complete Functions
// ============================================================

/**
 * Mark a feature as complete and optionally archive
 * @param {string} featureId - Feature ID
 * @param {boolean} archive - Whether to archive (default: true)
 */
function markFeatureComplete(featureId, archive = true) {
  if (!flowFeature) return;

  try {
    flowFeature.updateFeatureFile(featureId, { status: 'completed', progress: 100 });
    const index = flowFeature.loadFeaturesIndex();
    if (index.features[featureId]) {
      index.features[featureId].status = 'completed';
      index.features[featureId].progress = 100;
      flowFeature.saveFeaturesIndex(index);
    }
    console.log(color('green', `  \u2713 Feature ${featureId} auto-completed (all stories done)`));

    // Archive the completed feature
    if (archive) {
      archiveCompletedParent(featureId, 'feature');
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] markFeatureComplete: ${err.message}`);
  }
}

/**
 * Mark an epic as complete and optionally archive
 * @param {string} epicId - Epic ID
 * @param {boolean} archive - Whether to archive (default: true)
 */
function markEpicComplete(epicId, archive = true) {
  try {
    const { updateEpicFile, loadEpicsState, saveEpicsState } = require('./flow-epics');
    updateEpicFile(epicId, { status: 'completed', progress: 100 });
    const state = loadEpicsState();
    if (state.epics[epicId]) {
      state.epics[epicId].status = 'completed';
      state.epics[epicId].progress = 1;  // 0-1 range in epics.json
      saveEpicsState(state);
    }
    console.log(color('green', `  \u2713 Epic ${epicId} auto-completed (all features/stories done)`));

    // Archive the completed epic
    if (archive) {
      archiveCompletedParent(epicId, 'epic');
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] markEpicComplete: ${err.message}`);
  }
}

/**
 * Mark a plan as complete and optionally archive
 * @param {string} planId - Plan ID
 * @param {boolean} archive - Whether to archive (default: true)
 */
function markPlanComplete(planId, archive = true) {
  if (!flowPlan) return;

  try {
    flowPlan.updatePlanFile(planId, { status: 'completed', progress: 100 });
    const index = flowPlan.loadPlansIndex();
    if (index.plans[planId]) {
      index.plans[planId].status = 'completed';
      index.plans[planId].progress = 100;
      flowPlan.savePlansIndex(index);
    }
    console.log(color('green', `  \u2713 Plan ${planId} auto-completed (all epics done)`));

    // Archive the completed plan
    if (archive) {
      archiveCompletedParent(planId, 'plan');
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] markPlanComplete: ${err.message}`);
  }
}

// ============================================================
// Cascade Completion Engine
// ============================================================

/**
 * Maximum recursion depth for cascade completion
 * Hierarchy is: subtask/story -> feature -> epic -> plan (max 4 levels)
 * Set to 10 as safety buffer to handle edge cases like nested sub-stories.
 * In normal operation, cascade should never exceed depth 4.
 */
const CASCADE_MAX_DEPTH = 10;

/**
 * Valid item types for cascade completion
 * Used to validate input and prevent silent failures on typos
 */
const VALID_CASCADE_TYPES = ['subtask', 'story', 'feature', 'epic'];

/**
 * Cascade completion up the hierarchy
 * When a work item completes, check if parent can be auto-completed
 *
 * @param {string} itemId - Completed item ID
 * @param {string} itemType - Type: 'subtask', 'story', 'feature', 'epic'
 * @param {number} depth - Current recursion depth (for safety limit)
 */
function cascadeCompletion(itemId, itemType, depth = 0) {
  if (!itemId || !itemType) return;

  // Validate itemType to catch typos/invalid values early
  if (!VALID_CASCADE_TYPES.includes(itemType)) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] cascadeCompletion: Invalid itemType "${itemType}", expected one of: ${VALID_CASCADE_TYPES.join(', ')}`);
    }
    return;
  }

  // Safety check: prevent infinite recursion
  if (depth >= CASCADE_MAX_DEPTH) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] cascadeCompletion: Max depth (${CASCADE_MAX_DEPTH}) reached, stopping cascade`);
    }
    warn(`Cascade completion stopped at depth ${depth} - possible circular reference`);
    return;
  }

  try {
    if (itemType === 'subtask' || itemType === 'story') {
      // Check if parent feature can be completed
      const feature = findParentFeature(itemId);
      if (feature && allStoriesComplete(feature)) {
        markFeatureComplete(feature.id);
        cascadeCompletion(feature.id, 'feature', depth + 1);
      }
    }

    if (itemType === 'feature') {
      // Check if parent epic can be completed
      const epic = findParentEpic(itemId);
      if (epic && allFeaturesComplete(epic)) {
        markEpicComplete(epic.id);
        cascadeCompletion(epic.id, 'epic', depth + 1);
      }
    }

    if (itemType === 'epic') {
      // Check if parent plan can be completed
      const plan = findParentPlan(itemId);
      if (plan && allEpicsComplete(plan)) {
        markPlanComplete(plan.id);
        // Plan is the top level, no further cascade needed
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] cascadeCompletion: ${err.message}`);
  }
}

module.exports = {
  findParentFeature,
  findParentEpic,
  findParentPlan,
  allStoriesComplete,
  allFeaturesComplete,
  allEpicsComplete,
  markFeatureComplete,
  markEpicComplete,
  markPlanComplete,
  archiveByType,
  archiveCompletedParent,
  cascadeCompletion,
  CASCADE_MAX_DEPTH,
  VALID_CASCADE_TYPES
};
