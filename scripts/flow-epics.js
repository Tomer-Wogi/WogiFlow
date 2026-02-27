#!/usr/bin/env node

/**
 * Wogi Flow - Epic Management System
 *
 * Hierarchical task management with progress propagation.
 * Based on recursive language model principles - decompose large work
 * into manageable chunks with automatic status roll-up.
 *
 * Hierarchy:
 * - Epic (L0): Large initiative, 15+ files, multiple stories
 * - Story (L1): User-facing feature, 5-15 files, multiple tasks
 * - Task (L2): Implementable unit, 1-5 files
 * - Subtask (L3): Atomic operation, 1 file
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  ensureDir,
  color,
  success,
  warn,
  error,
  info,
  findAllWithParent,
  normalizeTask,
  CLASSIFICATION_LEVELS,
  generateEpicId
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const EPICS_STATE_PATH = path.join(PATHS.state, 'epics.json');
const EPICS_DIR = PATHS.epics;

const STATUS_WEIGHTS = {
  completed: 1.0,
  inProgress: 0.5,
  ready: 0.0,
  blocked: 0.0
};

// ============================================================
// Epic State Management
// ============================================================

/**
 * Load epics state
 * @returns {Object} Epics state
 */
function loadEpicsState() {
  if (!fs.existsSync(EPICS_STATE_PATH)) {
    return { epics: {}, version: '1.0.0' };
  }
  try {
    return readJson(EPICS_STATE_PATH) || { epics: {}, version: '1.0.0' };
  } catch {
    return { epics: {}, version: '1.0.0' };
  }
}

/**
 * Save epics state
 * @param {Object} state - State to save
 */
function saveEpicsState(state) {
  ensureDir(path.dirname(EPICS_STATE_PATH));
  state.lastUpdated = new Date().toISOString();
  writeJson(EPICS_STATE_PATH, state);
}

/**
 * Load ready.json for task data
 * @returns {Object} Ready data
 */
function loadReadyData() {
  if (!fs.existsSync(PATHS.ready)) {
    return { ready: [], inProgress: [], recentlyCompleted: [] };
  }
  try {
    return readJson(PATHS.ready) || { ready: [], inProgress: [], recentlyCompleted: [] };
  } catch {
    return { ready: [], inProgress: [], recentlyCompleted: [] };
  }
}

// ============================================================
// Epic File Operations
// ============================================================

/**
 * Generate epic markdown template
 * @param {string} epicId - Epic ID
 * @param {string} title - Epic title
 * @param {Object} options - Options (description, stories)
 * @returns {string} Markdown content
 */
function generateEpicTemplate(epicId, title, options = {}) {
  const { description = '', stories = [] } = options;
  const now = new Date().toISOString();
  const storiesContent = stories.length > 0
    ? stories.map(s => `- ${s}`).join('\n')
    : '<!-- No stories yet. Add with: flow epics add-story ' + epicId + ' wf-XXXXXXXX -->';

  return `# Epic: ${title}

## Overview
<!-- PIN: overview -->
${description || '[Describe the strategic goal and scope of this epic]'}

## Success Metrics
<!-- PIN: success-metrics -->
- [ ] [Key result 1]
- [ ] [Key result 2]
- [ ] [Key result 3]

## Features
<!-- PIN: features -->
<!-- Features that belong to this epic -->

## Stories
<!-- PIN: stories -->
${storiesContent}

## Dependencies
<!-- PIN: dependencies -->
- None

## Status: ready
## Progress: 0%
## Created: ${now}
## Updated: ${now}
`;
}

/**
 * Create epic markdown file
 * @param {string} epicId - Epic ID
 * @param {string} title - Epic title
 * @param {Object} options - Options
 * @returns {string} File path
 */
function createEpicFile(epicId, title, options = {}) {
  ensureDir(EPICS_DIR);
  const filePath = path.join(EPICS_DIR, `${epicId}.md`);
  const content = generateEpicTemplate(epicId, title, options);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Parse epic markdown file
 * @param {string} epicId - Epic ID
 * @returns {Object|null} Epic data or null
 */
function parseEpicFile(epicId) {
  const filePath = path.join(EPICS_DIR, `${epicId}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const epic = {
      id: epicId,
      title: '',
      description: '',
      features: [],
      stories: [],
      status: 'ready',
      progress: 0
    };

    // Parse title
    const titleMatch = content.match(/^# Epic: (.+)$/m);
    if (titleMatch) {
      epic.title = titleMatch[1].trim();
    }

    // Parse features
    const featureMatches = content.matchAll(/- (ft-[a-f0-9]{8})/gi);
    for (const match of featureMatches) {
      epic.features.push(match[1]);
    }

    // Parse stories
    const storyMatches = content.matchAll(/- (wf-[a-f0-9]{8})/gi);
    for (const match of storyMatches) {
      epic.stories.push(match[1]);
    }

    // Parse status
    const statusMatch = content.match(/^## Status: (\w+)/m);
    if (statusMatch) {
      epic.status = statusMatch[1];
    }

    // Parse progress
    const progressMatch = content.match(/^## Progress: (\d+)%/m);
    if (progressMatch) {
      epic.progress = parseInt(progressMatch[1], 10);
    }

    return epic;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] parseEpicFile: ${err.message}`);
    return null;
  }
}

/**
 * Update epic markdown file
 * @param {string} epicId - Epic ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} Success
 */
function updateEpicFile(epicId, updates) {
  const filePath = path.join(EPICS_DIR, `${epicId}.md`);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    let content = fs.readFileSync(filePath, 'utf-8');

    if (updates.status !== undefined) {
      content = content.replace(/^## Status: \w+/m, `## Status: ${updates.status}`);
    }

    if (updates.progress !== undefined) {
      content = content.replace(/^## Progress: \d+%/m, `## Progress: ${updates.progress}%`);
    }

    content = content.replace(/^## Updated: .+/m, `## Updated: ${new Date().toISOString()}`);

    fs.writeFileSync(filePath, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] updateEpicFile: ${err.message}`);
    return false;
  }
}

// ============================================================
// Epic Operations
// ============================================================

/**
 * Create a new epic
 * @param {string} epicId - Epic ID
 * @param {Object} options - Epic options
 * @returns {Object} Created epic
 */
function createEpic(epicId, options = {}) {
  const {
    title = 'Untitled Epic',
    description = '',
    stories = [],
    createFile = true  // v3.2: Also create markdown file
  } = options;

  const state = loadEpicsState();

  if (state.epics[epicId]) {
    return { error: `Epic ${epicId} already exists` };
  }

  const epic = {
    id: epicId,
    title,
    description,
    level: 'L0',
    type: 'epic',
    stories: stories.map(s => typeof s === 'string' ? s : s.id),
    features: [],  // v3.2: Features that belong to this epic
    status: 'ready',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.epics[epicId] = epic;
  saveEpicsState(state);

  // v3.2: Create markdown file for the epic
  let filePath = null;
  if (createFile) {
    filePath = createEpicFile(epicId, title, { description, stories });
    epic.filePath = filePath;
  }

  return epic;
}

/**
 * Add story to epic
 * @param {string} epicId - Epic ID
 * @param {string} storyId - Story ID to add
 * @returns {Object} Updated epic
 */
function addStoryToEpic(epicId, storyId) {
  const state = loadEpicsState();
  const epic = state.epics[epicId];

  if (!epic) {
    return { error: `Epic ${epicId} not found` };
  }

  if (!epic.stories.includes(storyId)) {
    epic.stories.push(storyId);
    epic.updatedAt = new Date().toISOString();
    saveEpicsState(state);
  }

  return epic;
}

/**
 * Remove story from epic
 * @param {string} epicId - Epic ID
 * @param {string} storyId - Story ID to remove
 * @returns {Object} Updated epic
 */
function removeStoryFromEpic(epicId, storyId) {
  const state = loadEpicsState();
  const epic = state.epics[epicId];

  if (!epic) {
    return { error: `Epic ${epicId} not found` };
  }

  const idx = epic.stories.indexOf(storyId);
  if (idx >= 0) {
    epic.stories.splice(idx, 1);
    epic.updatedAt = new Date().toISOString();
    saveEpicsState(state);
  }

  return epic;
}

/**
 * Add feature to epic (v3.2)
 * @param {string} epicId - Epic ID
 * @param {string} featureId - Feature ID to add
 * @returns {Object} Updated epic
 */
function addFeatureToEpic(epicId, featureId) {
  const state = loadEpicsState();
  const epic = state.epics[epicId];

  if (!epic) {
    return { error: `Epic ${epicId} not found` };
  }

  if (!featureId || !featureId.startsWith('ft-')) {
    return { error: 'Invalid feature ID format. Expected ft-XXXXXXXX' };
  }

  // Initialize features array if not present (backward compatibility)
  if (!epic.features) {
    epic.features = [];
  }

  if (!epic.features.includes(featureId)) {
    epic.features.push(featureId);
    epic.updatedAt = new Date().toISOString();
    saveEpicsState(state);
  }

  return epic;
}

/**
 * Remove feature from epic (v3.2)
 * @param {string} epicId - Epic ID
 * @param {string} featureId - Feature ID to remove
 * @returns {Object} Updated epic
 */
function removeFeatureFromEpic(epicId, featureId) {
  const state = loadEpicsState();
  const epic = state.epics[epicId];

  if (!epic) {
    return { error: `Epic ${epicId} not found` };
  }

  if (!epic.features) {
    return epic;
  }

  const idx = epic.features.indexOf(featureId);
  if (idx >= 0) {
    epic.features.splice(idx, 1);
    epic.updatedAt = new Date().toISOString();
    saveEpicsState(state);
  }

  return epic;
}

/**
 * Get epic with full details
 * @param {string} epicId - Epic ID
 * @returns {Object|null} Epic details
 */
function getEpic(epicId) {
  const state = loadEpicsState();
  return state.epics[epicId] || null;
}

/**
 * List all epics
 * @returns {Object[]} All epics
 */
function listEpics() {
  const state = loadEpicsState();
  return Object.values(state.epics);
}

/**
 * Delete epic (does not delete children)
 * @param {string} epicId - Epic ID
 * @returns {Object} Result
 */
function deleteEpic(epicId) {
  const state = loadEpicsState();

  if (!state.epics[epicId]) {
    return { error: `Epic ${epicId} not found` };
  }

  delete state.epics[epicId];
  saveEpicsState(state);

  // Archive the .md file if it exists
  const mdPath = path.join(EPICS_DIR, `${epicId}.md`);
  let archived = false;
  if (fs.existsSync(mdPath)) {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const archiveDir = path.join(PATHS.workflow, 'archive', 'epics', yearMonth);
      ensureDir(archiveDir);
      fs.renameSync(mdPath, path.join(archiveDir, `${epicId}.md`));
      archived = true;
    } catch (err) {
      // Fallback: delete if archive fails
      try { fs.unlinkSync(mdPath); } catch (_err) { /* ignore */ }
    }
  }

  return { deleted: epicId, archived };
}

// ============================================================
// Progress Propagation
// ============================================================

/**
 * Calculate progress for a task based on its children
 * @param {string} taskId - Task ID
 * @param {Object} readyData - Ready data
 * @param {number} depth - Current recursion depth (default 0)
 * @param {number} maxDepth - Maximum recursion depth (default 10)
 * @returns {Object} Progress info
 */
function calculateTaskProgress(taskId, readyData, depth = 0, maxDepth = 10) {
  // Prevent infinite recursion on circular references or deep hierarchies
  if (depth > maxDepth) {
    return { progress: 0, status: 'unknown', childCount: 0, error: 'Max depth exceeded' };
  }

  const children = findAllWithParent(readyData, taskId);

  if (children.length === 0) {
    // Leaf task - use its own status
    const task = findTaskInReady(taskId, readyData);
    if (!task) return { progress: 0, status: 'unknown' };

    const status = task.status || determineTaskStatus(taskId, readyData);
    return {
      progress: STATUS_WEIGHTS[status] || 0,
      status,
      childCount: 0
    };
  }

  // Calculate from children
  let totalWeight = 0;
  let completedWeight = 0;
  const statuses = [];

  for (const child of children) {
    const childProgress = calculateTaskProgress(child.id, readyData, depth + 1, maxDepth);
    totalWeight += 1;
    completedWeight += childProgress.progress;
    statuses.push(childProgress.status);
  }

  const progress = totalWeight > 0 ? completedWeight / totalWeight : 0;

  // Determine aggregate status
  let status = 'ready';
  if (progress >= 1.0) {
    status = 'completed';
  } else if (progress > 0) {
    status = 'inProgress';
  } else if (statuses.includes('blocked')) {
    status = 'blocked';
  }

  return {
    progress,
    status,
    childCount: children.length,
    completedCount: statuses.filter(s => s === 'completed').length
  };
}

/**
 * Find task in ready data
 * @param {string} taskId - Task ID
 * @param {Object} readyData - Ready data
 * @returns {Object|null} Task
 */
function findTaskInReady(taskId, readyData) {
  for (const list of ['ready', 'inProgress', 'recentlyCompleted']) {
    const tasks = readyData[list] || [];
    for (const task of tasks) {
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) {
        return typeof task === 'string' ? { id: task } : task;
      }
    }
  }
  return null;
}

/**
 * Determine task status from ready.json position
 * @param {string} taskId - Task ID
 * @param {Object} readyData - Ready data
 * @returns {string} Status
 */
function determineTaskStatus(taskId, readyData) {
  for (const [list, status] of [
    ['recentlyCompleted', 'completed'],
    ['inProgress', 'inProgress'],
    ['ready', 'ready']
  ]) {
    const tasks = readyData[list] || [];
    for (const task of tasks) {
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) return status;
    }
  }
  return 'unknown';
}

/**
 * Update epic progress from stories
 * @param {string} epicId - Epic ID
 * @returns {Object} Updated progress
 */
function updateEpicProgress(epicId) {
  const state = loadEpicsState();
  const epic = state.epics[epicId];

  if (!epic) {
    return { error: `Epic ${epicId} not found` };
  }

  const readyData = loadReadyData();

  let totalWeight = 0;
  let completedWeight = 0;
  const storyProgresses = [];

  for (const storyId of epic.stories) {
    const progress = calculateTaskProgress(storyId, readyData);
    totalWeight += 1;
    completedWeight += progress.progress;
    storyProgresses.push({
      id: storyId,
      ...progress
    });
  }

  epic.progress = totalWeight > 0 ? completedWeight / totalWeight : 0;

  // Determine epic status
  if (epic.progress >= 1.0) {
    epic.status = 'completed';
  } else if (epic.progress > 0) {
    epic.status = 'inProgress';
  } else {
    epic.status = 'ready';
  }

  epic.updatedAt = new Date().toISOString();
  saveEpicsState(state);

  return {
    epic,
    stories: storyProgresses
  };
}

/**
 * Update all epics' progress
 * @returns {Object[]} Updated epics
 */
function updateAllEpicsProgress() {
  const state = loadEpicsState();
  const results = [];

  for (const epicId of Object.keys(state.epics)) {
    const result = updateEpicProgress(epicId);
    results.push(result);
  }

  return results;
}

// ============================================================
// Hierarchy Building
// ============================================================

/**
 * Build full hierarchy tree from an epic
 * @param {string} epicId - Epic ID
 * @returns {Object} Hierarchy tree
 */
function buildHierarchyTree(epicId) {
  const epic = getEpic(epicId);
  if (!epic) return null;

  const readyData = loadReadyData();

  const tree = {
    ...epic,
    children: []
  };

  for (const storyId of epic.stories) {
    const storyNode = buildStoryTree(storyId, readyData);
    tree.children.push(storyNode);
  }

  return tree;
}

/**
 * Build story tree with tasks
 * @param {string} storyId - Story ID
 * @param {Object} readyData - Ready data
 * @returns {Object} Story tree
 */
function buildStoryTree(storyId, readyData) {
  const story = findTaskInReady(storyId, readyData);
  const progress = calculateTaskProgress(storyId, readyData);

  const node = {
    id: storyId,
    title: story?.title || storyId,
    level: 'L1',
    type: 'story',
    ...progress,
    children: []
  };

  // Find tasks belonging to this story
  const tasks = findAllWithParent(readyData, storyId);

  for (const task of tasks) {
    const taskProgress = calculateTaskProgress(task.id, readyData);
    const subtasks = findAllWithParent(readyData, task.id);

    node.children.push({
      id: task.id,
      title: task.title || task.id,
      level: 'L2',
      type: 'task',
      ...taskProgress,
      children: subtasks.map(st => ({
        id: st.id,
        title: st.title || st.id,
        level: 'L3',
        type: 'subtask',
        status: determineTaskStatus(st.id, readyData),
        progress: STATUS_WEIGHTS[determineTaskStatus(st.id, readyData)] || 0
      }))
    });
  }

  return node;
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format hierarchy tree for display
 * @param {Object} tree - Hierarchy tree
 * @param {number} indent - Indent level
 * @returns {string} Formatted tree
 */
function formatHierarchyTree(tree, indent = 0) {
  const lines = [];
  const prefix = '  '.repeat(indent);

  // Status icon
  const statusIcon = tree.status === 'completed' ? '✓' :
                     tree.status === 'inProgress' ? '→' :
                     tree.status === 'blocked' ? '✗' : '·';

  // Level icon
  const levelIcon = tree.type === 'epic' ? '📦' :
                    tree.type === 'story' ? '📖' :
                    tree.type === 'task' ? '📋' : '▪';

  // Progress bar
  const progressPct = Math.round((tree.progress || 0) * 100);
  const progressBar = `[${progressPct.toString().padStart(3)}%]`;

  lines.push(`${prefix}${statusIcon} ${levelIcon} ${tree.title || tree.id} ${progressBar}`);

  if (tree.children && tree.children.length > 0) {
    for (const child of tree.children) {
      lines.push(formatHierarchyTree(child, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Format epic summary
 * @param {Object} epic - Epic object
 * @returns {string} Formatted summary
 */
function formatEpicSummary(epic) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Epic: ${epic.title || epic.id}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  const progressPct = Math.round((epic.progress || 0) * 100);
  const progressBar = '█'.repeat(Math.floor(progressPct / 5)) + '░'.repeat(20 - Math.floor(progressPct / 5));
  lines.push(`Progress: [${progressBar}] ${progressPct}%`);
  lines.push(`Status: ${epic.status}`);
  lines.push(`Stories: ${epic.stories?.length || 0}`);
  lines.push('');

  if (epic.description) {
    lines.push(`Description: ${epic.description}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format epics list
 * @param {Object[]} epics - List of epics
 * @returns {string} Formatted list
 */
function formatEpicsList(epics) {
  if (epics.length === 0) {
    return 'No epics found. Create one with: flow epics create <epicId> --title "Title"';
  }

  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Active Epics');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  for (const epic of epics) {
    const statusIcon = epic.status === 'completed' ? '✓' :
                       epic.status === 'inProgress' ? '→' : '·';
    const progressPct = Math.round((epic.progress || 0) * 100);

    lines.push(`${statusIcon} ${epic.id}: ${epic.title || 'Untitled'}`);
    lines.push(`    Progress: ${progressPct}% | Stories: ${epic.stories?.length || 0}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');
  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // State management
  loadEpicsState,
  saveEpicsState,
  loadReadyData,

  // Epic operations
  createEpic,
  addStoryToEpic,
  removeStoryFromEpic,
  addFeatureToEpic,      // v3.2: Feature management
  removeFeatureFromEpic, // v3.2: Feature management
  getEpic,
  listEpics,
  deleteEpic,

  // Epic file operations (v3.2)
  createEpicFile,
  parseEpicFile,
  updateEpicFile,
  generateEpicTemplate,

  // Progress propagation
  calculateTaskProgress,
  updateEpicProgress,
  updateAllEpicsProgress,

  // Hierarchy building
  buildHierarchyTree,
  buildStoryTree,

  // Formatting
  formatHierarchyTree,
  formatEpicSummary,
  formatEpicsList,

  // Constants
  EPICS_STATE_PATH,
  EPICS_DIR  // v3.2: Directory path
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'create': {
      const epicId = args[1];
      if (!epicId) {
        error('Usage: flow epics create <epicId> --title "Title" --desc "Description"');
        process.exit(1);
      }

      const titleIdx = args.indexOf('--title');
      const descIdx = args.indexOf('--desc');

      const title = titleIdx >= 0 ? args[titleIdx + 1] : epicId;
      const description = descIdx >= 0 ? args[descIdx + 1] : '';

      const result = createEpic(epicId, { title, description });
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      success(`Created epic: ${epicId}`);
      console.log(formatEpicSummary(result));
      break;
    }

    case 'add-story': {
      const epicId = args[1];
      const storyId = args[2];
      if (!epicId || !storyId) {
        error('Usage: flow epics add-story <epicId> <storyId>');
        process.exit(1);
      }

      const result = addStoryToEpic(epicId, storyId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      success(`Added story ${storyId} to epic ${epicId}`);
      break;
    }

    case 'remove-story': {
      const epicId = args[1];
      const storyId = args[2];
      if (!epicId || !storyId) {
        error('Usage: flow epics remove-story <epicId> <storyId>');
        process.exit(1);
      }

      const result = removeStoryFromEpic(epicId, storyId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      success(`Removed story ${storyId} from epic ${epicId}`);
      break;
    }

    case 'show': {
      const epicId = args[1];
      if (!epicId) {
        error('Usage: flow epics show <epicId>');
        process.exit(1);
      }

      const epic = getEpic(epicId);
      if (!epic) {
        error(`Epic ${epicId} not found`);
        process.exit(1);
      }
      console.log(formatEpicSummary(epic));
      break;
    }

    case 'tree': {
      const epicId = args[1];
      if (!epicId) {
        error('Usage: flow epics tree <epicId>');
        process.exit(1);
      }

      const tree = buildHierarchyTree(epicId);
      if (!tree) {
        error(`Epic ${epicId} not found`);
        process.exit(1);
      }

      console.log('');
      console.log(formatHierarchyTree(tree));
      console.log('');
      break;
    }

    case 'update': {
      const epicId = args[1];
      if (epicId) {
        const result = updateEpicProgress(epicId);
        if (result.error) {
          error(result.error);
          process.exit(1);
        }
        success(`Updated progress for epic ${epicId}: ${Math.round(result.epic.progress * 100)}%`);
      } else {
        const results = updateAllEpicsProgress();
        success(`Updated progress for ${results.length} epics`);
        for (const result of results) {
          if (result.epic) {
            info(`  ${result.epic.id}: ${Math.round(result.epic.progress * 100)}%`);
          }
        }
      }
      break;
    }

    case 'delete': {
      const epicId = args[1];
      if (!epicId) {
        error('Usage: flow epics delete <epicId>');
        process.exit(1);
      }

      const result = deleteEpic(epicId);
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      success(`Deleted epic ${epicId}`);
      break;
    }

    case 'list':
    default: {
      updateAllEpicsProgress(); // Update progress before listing
      console.log(formatEpicsList(listEpics()));
      break;
    }
  }
}
