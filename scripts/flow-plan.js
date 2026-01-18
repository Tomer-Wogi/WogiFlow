#!/usr/bin/env node

/**
 * Wogi Flow - Plan Management System
 *
 * Plans are the highest level in the work item hierarchy.
 * They coordinate large initiatives across multiple epics and features.
 *
 * Hierarchy:
 * - Plan (pl-XXXXXXXX) → references Epics or Features
 * - Epic (ep-XXXXXXXX) → references Features
 * - Feature (ft-XXXXXXXX) → references Stories
 * - Story (wf-XXXXXXXX) → implementation specs
 *
 * File format: .workflow/plans/pl-XXXXXXXX.md
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  ensureDir,
  success,
  warn,
  error,
  info,
  parseFlags,
  outputJson,
  generatePlanId,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const PLANS_DIR = PATHS.plans;
const PLANS_INDEX_PATH = path.join(PATHS.state, 'plans.json');

// ============================================================
// Plan Index Management
// ============================================================

/**
 * Load plans index
 * @returns {Object} Plans index
 */
function loadPlansIndex() {
  if (!fs.existsSync(PLANS_INDEX_PATH)) {
    return { plans: {}, version: '1.0.0' };
  }
  try {
    return safeJsonParse(PLANS_INDEX_PATH, { plans: {}, version: '1.0.0' });
  } catch {
    return { plans: {}, version: '1.0.0' };
  }
}

/**
 * Save plans index
 * @param {Object} index - Index to save
 */
function savePlansIndex(index) {
  ensureDir(PATHS.state);
  index.lastUpdated = new Date().toISOString();
  writeJson(PLANS_INDEX_PATH, index);
}

// ============================================================
// Plan File Operations
// ============================================================

/**
 * Generate plan markdown template
 * @param {string} planId - Plan ID
 * @param {string} title - Plan title
 * @param {Object} options - Options (description, goal)
 * @returns {string} Markdown content
 */
function generatePlanTemplate(planId, title, options = {}) {
  const { description = '', goal = '' } = options;
  const now = new Date().toISOString();

  return `# Plan: ${title}

## Goal
<!-- PIN: goal -->
${goal || '[What is the end state this plan achieves?]'}

## Description
<!-- PIN: description -->
${description || '[Strategic context and motivation for this plan]'}

## Success Criteria
<!-- PIN: success-criteria -->
- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
- [ ] [Measurable outcome 3]

## Items
<!-- PIN: items -->
<!-- Add epics and features using: flow link ${planId} ep-XXXXXXXX or ft-XXXXXXXX -->

### Epics
<!-- Epics that are part of this plan -->

### Features
<!-- Standalone features in this plan -->

## Timeline
<!-- PIN: timeline -->
| Phase | Description | Target |
|-------|-------------|--------|
| Phase 1 | [Description] | [Date] |

## Status: ready
## Progress: 0%
## Created: ${now}
## Updated: ${now}
`;
}

/**
 * Parse plan file to extract metadata
 * @param {string} planId - Plan ID
 * @returns {Object|null} Plan data or null if not found
 */
function parsePlanFile(planId) {
  const filePath = path.join(PLANS_DIR, `${planId}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    const plan = {
      id: planId,
      title: '',
      goal: '',
      description: '',
      epics: [],
      features: [],
      status: 'ready',
      progress: 0,
      createdAt: null,
      updatedAt: null
    };

    // Parse title from first heading
    const titleMatch = content.match(/^# Plan: (.+)$/m);
    if (titleMatch) {
      plan.title = titleMatch[1].trim();
    }

    // Parse epics
    const epicMatches = content.matchAll(/- (ep-[a-f0-9]{8})/gi);
    for (const match of epicMatches) {
      plan.epics.push(match[1]);
    }

    // Parse features
    const featureMatches = content.matchAll(/- (ft-[a-f0-9]{8})/gi);
    for (const match of featureMatches) {
      plan.features.push(match[1]);
    }

    // Parse status
    const statusMatch = content.match(/^## Status: (\w+)/m);
    if (statusMatch) {
      plan.status = statusMatch[1];
    }

    // Parse progress
    const progressMatch = content.match(/^## Progress: (\d+)%/m);
    if (progressMatch) {
      plan.progress = parseInt(progressMatch[1], 10);
    }

    // Parse timestamps
    const createdMatch = content.match(/^## Created: (.+)/m);
    if (createdMatch) {
      plan.createdAt = createdMatch[1].trim();
    }
    const updatedMatch = content.match(/^## Updated: (.+)/m);
    if (updatedMatch) {
      plan.updatedAt = updatedMatch[1].trim();
    }

    return plan;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] parsePlanFile: ${err.message}`);
    return null;
  }
}

/**
 * Update plan file with new data
 * @param {string} planId - Plan ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} Success
 */
function updatePlanFile(planId, updates) {
  const filePath = path.join(PLANS_DIR, `${planId}.md`);
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

    // Update epics section
    if (updates.epics !== undefined) {
      const epicsContent = updates.epics.length > 0
        ? updates.epics.map(e => `- ${e}`).join('\n')
        : '<!-- No epics yet -->';

      content = content.replace(
        /### Epics\n<!-- Epics that are part of this plan -->\n[\s\S]*?(?=\n### Features)/,
        `### Epics\n<!-- Epics that are part of this plan -->\n${epicsContent}\n\n`
      );
    }

    // Update features section
    if (updates.features !== undefined) {
      const featuresContent = updates.features.length > 0
        ? updates.features.map(f => `- ${f}`).join('\n')
        : '<!-- No features yet -->';

      content = content.replace(
        /### Features\n<!-- Standalone features in this plan -->\n[\s\S]*?(?=\n## Timeline)/,
        `### Features\n<!-- Standalone features in this plan -->\n${featuresContent}\n\n`
      );
    }

    // Update timestamp
    content = content.replace(/^## Updated: .+/m, `## Updated: ${new Date().toISOString()}`);

    fs.writeFileSync(filePath, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] updatePlanFile: ${err.message}`);
    return false;
  }
}

// ============================================================
// Plan Operations
// ============================================================

/**
 * Create a new plan
 * @param {string} title - Plan title
 * @param {Object} options - Options (description, goal)
 * @returns {Object} Created plan
 */
function createPlan(title, options = {}) {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return { error: 'Title is required and must be a non-empty string' };
  }

  // Ensure plans directory exists
  ensureDir(PLANS_DIR);

  const planId = generatePlanId(title);
  const filePath = path.join(PLANS_DIR, `${planId}.md`);

  // Check for collision
  if (fs.existsSync(filePath)) {
    return { error: `Plan file already exists: ${filePath}` };
  }

  // Generate and write plan file
  const content = generatePlanTemplate(planId, title, options);
  fs.writeFileSync(filePath, content);

  // Update index
  const index = loadPlansIndex();
  index.plans[planId] = {
    id: planId,
    title,
    epics: [],
    features: [],
    status: 'ready',
    progress: 0,
    createdAt: new Date().toISOString()
  };
  savePlansIndex(index);

  return {
    id: planId,
    title,
    filePath
  };
}

/**
 * Add an item (epic or feature) to a plan
 * @param {string} planId - Plan ID
 * @param {string} itemId - Item ID (ep-* or ft-*)
 * @returns {Object} Result
 */
function addToPlan(planId, itemId) {
  const plan = parsePlanFile(planId);
  if (!plan) {
    return { error: `Plan ${planId} not found` };
  }

  const isEpic = itemId.startsWith('ep-');
  const isFeature = itemId.startsWith('ft-');

  if (!isEpic && !isFeature) {
    return { error: 'Invalid item ID format. Expected ep-XXXXXXXX or ft-XXXXXXXX' };
  }

  const list = isEpic ? 'epics' : 'features';
  if (plan[list].includes(itemId)) {
    return { warning: `${itemId} is already in plan ${planId}` };
  }

  plan[list].push(itemId);
  updatePlanFile(planId, { [list]: plan[list] });

  // Update index
  const index = loadPlansIndex();
  if (index.plans[planId]) {
    index.plans[planId][list] = plan[list];
    index.plans[planId].updatedAt = new Date().toISOString();
    savePlansIndex(index);
  }

  return {
    success: true,
    planId,
    itemId,
    itemType: isEpic ? 'epic' : 'feature',
    total: plan[list].length
  };
}

/**
 * Remove an item from a plan
 * @param {string} planId - Plan ID
 * @param {string} itemId - Item ID
 * @returns {Object} Result
 */
function removeFromPlan(planId, itemId) {
  const plan = parsePlanFile(planId);
  if (!plan) {
    return { error: `Plan ${planId} not found` };
  }

  const isEpic = itemId.startsWith('ep-');
  const list = isEpic ? 'epics' : 'features';

  const idx = plan[list].indexOf(itemId);
  if (idx < 0) {
    return { warning: `${itemId} is not in plan ${planId}` };
  }

  plan[list].splice(idx, 1);
  updatePlanFile(planId, { [list]: plan[list] });

  // Update index
  const index = loadPlansIndex();
  if (index.plans[planId]) {
    index.plans[planId][list] = plan[list];
    savePlansIndex(index);
  }

  return { success: true, planId, itemId };
}

/**
 * Get plan details
 * @param {string} planId - Plan ID
 * @returns {Object|null} Plan details or null
 */
function getPlan(planId) {
  return parsePlanFile(planId);
}

/**
 * List all plans
 * @returns {Object[]} Array of plans
 */
function listPlans() {
  const index = loadPlansIndex();
  const plans = [];

  for (const planId of Object.keys(index.plans)) {
    const plan = parsePlanFile(planId);
    if (plan) {
      plans.push(plan);
    }
  }

  return plans;
}

/**
 * Calculate plan progress from children
 * @param {string} planId - Plan ID
 * @returns {Object} Progress info
 */
function getPlanProgress(planId) {
  const plan = parsePlanFile(planId);
  if (!plan) {
    return { error: `Plan ${planId} not found` };
  }

  const totalItems = plan.epics.length + plan.features.length;
  if (totalItems === 0) {
    return {
      planId,
      progress: 0,
      totalItems: 0,
      completedItems: 0,
      status: 'ready'
    };
  }

  // Load epic and feature progress
  // NOTE: Progress value conventions differ by type (historical design decision):
  // - epics.json stores progress as 0-1 (decimal)
  // - features.json stores progress as 0-100 (percentage)
  // - plans.json stores progress as 0-100 (percentage)
  // We normalize everything to 0-1 here, then convert to 0-100 at the end.
  let totalProgress = 0;
  let completedCount = 0;
  let inProgressCount = 0;

  // Check epic progress (stored as 0-1)
  const epicsIndex = safeJsonParse(path.join(PATHS.state, 'epics.json'), { epics: {} });
  for (const epicId of plan.epics) {
    const epic = epicsIndex.epics[epicId];
    if (epic) {
      totalProgress += epic.progress || 0;  // Already 0-1
      if (epic.status === 'completed') completedCount++;
      else if (epic.status === 'inProgress') inProgressCount++;
    }
  }

  // Check feature progress (stored as 0-100, normalize to 0-1)
  const featuresIndex = safeJsonParse(path.join(PATHS.state, 'features.json'), { features: {} });
  for (const featureId of plan.features) {
    const feature = featuresIndex.features[featureId];
    if (feature) {
      totalProgress += (feature.progress || 0) / 100;  // Normalize 0-100 to 0-1
      if (feature.status === 'completed') completedCount++;
      else if (feature.status === 'inProgress') inProgressCount++;
    }
  }

  const progress = Math.round((totalProgress / totalItems) * 100);

  // Determine status
  let status = 'ready';
  if (completedCount === totalItems) {
    status = 'completed';
  } else if (inProgressCount > 0 || completedCount > 0) {
    status = 'inProgress';
  }

  // Update plan file
  updatePlanFile(planId, { progress, status });

  // Update index
  const index = loadPlansIndex();
  if (index.plans[planId]) {
    index.plans[planId].progress = progress;
    index.plans[planId].status = status;
    savePlansIndex(index);
  }

  return {
    planId,
    progress,
    totalItems,
    completedItems: completedCount,
    inProgressItems: inProgressCount,
    status
  };
}

/**
 * Delete a plan
 * @param {string} planId - Plan ID
 * @returns {Object} Result
 */
function deletePlan(planId) {
  const filePath = path.join(PLANS_DIR, `${planId}.md`);
  if (!fs.existsSync(filePath)) {
    return { error: `Plan ${planId} not found` };
  }

  fs.unlinkSync(filePath);

  // Update index
  const index = loadPlansIndex();
  delete index.plans[planId];
  savePlansIndex(index);

  return { deleted: planId };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format plan summary for display
 * @param {Object} plan - Plan object
 * @returns {string} Formatted summary
 */
function formatPlanSummary(plan) {
  const lines = [];
  const progressBar = '█'.repeat(Math.floor(plan.progress / 5)) + '░'.repeat(20 - Math.floor(plan.progress / 5));

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Plan: ${plan.title || plan.id}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(`ID: ${plan.id}`);
  lines.push(`Progress: [${progressBar}] ${plan.progress}%`);
  lines.push(`Status: ${plan.status}`);
  lines.push(`Epics: ${plan.epics?.length || 0}`);
  lines.push(`Features: ${plan.features?.length || 0}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format plans list for display
 * @param {Object[]} plans - Array of plans
 * @returns {string} Formatted list
 */
function formatPlansList(plans) {
  if (plans.length === 0) {
    return 'No plans found. Create one with: flow plan "<title>"';
  }

  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Plans');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  for (const plan of plans) {
    const statusIcon = plan.status === 'completed' ? '✓' :
                       plan.status === 'inProgress' ? '→' : '·';
    const totalItems = (plan.epics?.length || 0) + (plan.features?.length || 0);
    lines.push(`${statusIcon} ${plan.id}: ${plan.title || 'Untitled'}`);
    lines.push(`    Progress: ${plan.progress}% | Items: ${totalItems}`);
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
  createPlan,
  getPlan,
  listPlans,
  deletePlan,

  // Item management
  addToPlan,
  removeFromPlan,

  // Progress tracking
  getPlanProgress,

  // Index management
  loadPlansIndex,
  savePlansIndex,

  // File operations
  parsePlanFile,
  updatePlanFile,

  // Formatting
  formatPlanSummary,
  formatPlansList,

  // Constants
  PLANS_DIR,
  PLANS_INDEX_PATH
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Wogi Flow - Plan Management

Usage:
  flow plan create "<title>"              Create a new plan
  flow plan show <planId>                 Show plan details
  flow plan list                          List all plans
  flow plan add <planId> <itemId>         Add epic/feature to plan
  flow plan remove <planId> <itemId>      Remove item from plan
  flow plan progress <planId>             Show plan progress
  flow plan delete <planId>               Delete a plan

Options:
  --goal "<text>"      Set goal when creating
  --json               Output as JSON
  --help               Show this help

Examples:
  flow plan create "Q1 2026 Product Roadmap"
  flow plan add pl-a1b2c3d4 ep-e5f6g7h8
  flow plan add pl-a1b2c3d4 ft-i9j0k1l2
`);
    process.exit(0);
  }

  switch (command) {
    case 'create': {
      const title = positional[1];
      if (!title) {
        error('Title is required: flow plan create "<title>"');
        process.exit(1);
      }

      const result = createPlan(title, { goal: flags.goal });
      if (result.error) {
        error(result.error);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, ...result });
      } else {
        success(`Created plan: ${result.id}`);
        console.log(`  File: ${result.filePath}`);
        console.log(`  Title: ${result.title}`);
        console.log('');
        info('Next: Add epics/features with: flow plan add ' + result.id + ' ep-XXXXXXXX');
      }
      break;
    }

    case 'show': {
      const planId = positional[1];
      if (!planId) {
        error('Plan ID required: flow plan show <planId>');
        process.exit(1);
      }

      const plan = getPlan(planId);
      if (!plan) {
        error(`Plan ${planId} not found`);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, plan });
      } else {
        console.log(formatPlanSummary(plan));
        if (plan.epics.length > 0) {
          console.log('Epics:');
          plan.epics.forEach(e => console.log(`  - ${e}`));
        }
        if (plan.features.length > 0) {
          console.log('Features:');
          plan.features.forEach(f => console.log(`  - ${f}`));
        }
      }
      break;
    }

    case 'list': {
      const plans = listPlans();

      if (flags.json) {
        outputJson({ success: true, plans });
      } else {
        console.log(formatPlansList(plans));
      }
      break;
    }

    case 'add': {
      const planId = positional[1];
      const itemId = positional[2];
      if (!planId || !itemId) {
        error('Usage: flow plan add <planId> <itemId>');
        process.exit(1);
      }

      const result = addToPlan(planId, itemId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      if (result.warning) {
        warn(result.warning);
      } else {
        success(`Added ${result.itemType} ${itemId} to plan ${planId}`);
      }
      break;
    }

    case 'remove': {
      const planId = positional[1];
      const itemId = positional[2];
      if (!planId || !itemId) {
        error('Usage: flow plan remove <planId> <itemId>');
        process.exit(1);
      }

      const result = removeFromPlan(planId, itemId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      if (result.warning) {
        warn(result.warning);
      } else {
        success(`Removed ${itemId} from plan ${planId}`);
      }
      break;
    }

    case 'progress': {
      const planId = positional[1];
      if (!planId) {
        error('Plan ID required: flow plan progress <planId>');
        process.exit(1);
      }

      const progress = getPlanProgress(planId);
      if (progress.error) {
        error(progress.error);
        process.exit(1);
      }

      if (flags.json) {
        outputJson({ success: true, ...progress });
      } else {
        success(`Plan ${planId}: ${progress.progress}%`);
        console.log(`  Completed: ${progress.completedItems}/${progress.totalItems} items`);
        console.log(`  Status: ${progress.status}`);
      }
      break;
    }

    case 'delete': {
      const planId = positional[1];
      if (!planId) {
        error('Plan ID required: flow plan delete <planId>');
        process.exit(1);
      }

      const result = deletePlan(planId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }

      success(`Deleted plan ${planId}`);
      break;
    }

    default:
      error(`Unknown command: ${command}`);
      console.log('Run: flow plan --help');
      process.exit(1);
  }
}
