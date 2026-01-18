#!/usr/bin/env node

/**
 * Wogi Flow - Work Item Linking
 *
 * Intelligent routing for linking work items in the hierarchy.
 * Detects parent/child types and routes to the appropriate module.
 *
 * Usage:
 *   node scripts/flow-item-link.js <parent> <child>
 *
 * Examples:
 *   flow-item-link pl-a1b2c3d4 ep-e5f6g7h8   # Add epic to plan
 *   flow-item-link pl-a1b2c3d4 ft-i9j0k1l2   # Add feature to plan
 *   flow-item-link ep-a1b2c3d4 ft-e5f6g7h8   # Add feature to epic
 *   flow-item-link ft-a1b2c3d4 wf-e5f6g7h8   # Add story to feature
 *   flow-item-link ep-a1b2c3d4 wf-e5f6g7h8   # Add story directly to epic
 */

const {
  color,
  success,
  warn,
  error,
  info,
  parseFlags
} = require('./flow-utils');

// ============================================================
// Type Detection
// ============================================================

/**
 * Detect item type from ID prefix
 * Validates format: xx-XXXXXXXX where xx is pl/ep/ft/wf
 *
 * @param {string} itemId - Item ID
 * @returns {string|null} Type or null if invalid
 */
function detectType(itemId) {
  if (!itemId || typeof itemId !== 'string') return null;

  // Validate length (prefix-8hexchars = 11 chars minimum)
  if (itemId.length < 11 || itemId.length > 20) return null;

  // Validate format: prefix-hexchars
  const validFormat = /^(pl|ep|ft|wf)-[a-f0-9]{8}(-\d+)?$/i;
  if (!validFormat.test(itemId)) return null;

  const prefix = itemId.substring(0, 2).toLowerCase();
  const typeMap = {
    'pl': 'plan',
    'ep': 'epic',
    'ft': 'feature',
    'wf': 'story'
  };

  return typeMap[prefix] || null;
}

/**
 * Validate linking hierarchy
 * @param {string} parentType - Parent type
 * @param {string} childType - Child type
 * @returns {Object} Validation result
 */
function validateHierarchy(parentType, childType) {
  const validLinks = {
    plan: ['epic', 'feature'],
    epic: ['feature', 'story'],
    feature: ['story']
  };

  const allowed = validLinks[parentType] || [];

  if (!allowed.includes(childType)) {
    return {
      valid: false,
      error: `Cannot link ${childType} to ${parentType}. Valid children for ${parentType}: ${allowed.join(', ') || 'none'}`
    };
  }

  return { valid: true };
}

// ============================================================
// Link Operations
// ============================================================

/**
 * Link a child to a parent
 * @param {string} parentId - Parent item ID
 * @param {string} childId - Child item ID
 * @returns {Object} Result
 */
function link(parentId, childId) {
  const parentType = detectType(parentId);
  const childType = detectType(childId);

  if (!parentType) {
    return { error: `Invalid parent ID: ${parentId}. Expected pl-*, ep-*, ft-*, or wf-*` };
  }

  if (!childType) {
    return { error: `Invalid child ID: ${childId}. Expected pl-*, ep-*, ft-*, or wf-*` };
  }

  // Validate hierarchy
  const validation = validateHierarchy(parentType, childType);
  if (!validation.valid) {
    return { error: validation.error };
  }

  // Route to appropriate module
  try {
    if (parentType === 'plan') {
      const flowPlan = require('./flow-plan');
      return flowPlan.addToPlan(parentId, childId);
    }

    if (parentType === 'epic') {
      const flowEpics = require('./flow-epics');
      if (childType === 'feature') {
        return flowEpics.addFeatureToEpic(parentId, childId);
      } else if (childType === 'story') {
        return flowEpics.addStoryToEpic(parentId, childId);
      }
    }

    if (parentType === 'feature') {
      const flowFeature = require('./flow-feature');
      return flowFeature.addStoryToFeature(parentId, childId);
    }

    return { error: `Unsupported parent type: ${parentType}` };
  } catch (err) {
    return { error: `Link failed: ${err.message}` };
  }
}

/**
 * Unlink a child from a parent
 * @param {string} parentId - Parent item ID
 * @param {string} childId - Child item ID
 * @returns {Object} Result
 */
function unlink(parentId, childId) {
  const parentType = detectType(parentId);
  const childType = detectType(childId);

  if (!parentType || !childType) {
    return { error: 'Invalid parent or child ID' };
  }

  try {
    if (parentType === 'plan') {
      const flowPlan = require('./flow-plan');
      return flowPlan.removeFromPlan(parentId, childId);
    }

    if (parentType === 'epic') {
      const flowEpics = require('./flow-epics');
      if (childType === 'feature') {
        return flowEpics.removeFeatureFromEpic(parentId, childId);
      } else if (childType === 'story') {
        return flowEpics.removeStoryFromEpic(parentId, childId);
      }
    }

    if (parentType === 'feature') {
      const flowFeature = require('./flow-feature');
      return flowFeature.removeStoryFromFeature(parentId, childId);
    }

    return { error: `Unsupported parent type: ${parentType}` };
  } catch (err) {
    return { error: `Unlink failed: ${err.message}` };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  detectType,
  validateHierarchy,
  link,
  unlink
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  if (flags.help || positional.length < 2) {
    console.log(`
Wogi Flow - Link Work Items

Usage:
  flow item-link <parent> <child>        Link child to parent
  flow item-link unlink <parent> <child> Remove link

Valid Links:
  plan    → epic, feature
  epic    → feature, story
  feature → story

Examples:
  flow item-link pl-a1b2c3d4 ep-e5f6g7h8   # Add epic to plan
  flow item-link ep-a1b2c3d4 ft-e5f6g7h8   # Add feature to epic
  flow item-link ft-a1b2c3d4 wf-e5f6g7h8   # Add story to feature

Options:
  --help    Show this help
`);
    process.exit(0);
  }

  const command = positional[0];

  // Check if first arg is 'unlink' command
  if (command === 'unlink') {
    const parentId = positional[1];
    const childId = positional[2];

    if (!parentId || !childId) {
      error('Usage: flow item-link unlink <parent> <child>');
      process.exit(1);
    }

    const result = unlink(parentId, childId);
    if (result.error) {
      error(result.error);
      process.exit(1);
    }

    if (result.warning) {
      warn(result.warning);
    } else {
      success(`Unlinked ${childId} from ${parentId}`);
    }
  } else {
    // Default: link operation
    const parentId = positional[0];
    const childId = positional[1];

    if (!parentId || !childId) {
      error('Usage: flow item-link <parent> <child>');
      process.exit(1);
    }

    const parentType = detectType(parentId);
    const childType = detectType(childId);

    const result = link(parentId, childId);

    if (result.error) {
      error(result.error);
      process.exit(1);
    }

    if (result.warning) {
      warn(result.warning);
    } else {
      success(`Linked ${childType} ${childId} to ${parentType} ${parentId}`);
    }
  }
}
