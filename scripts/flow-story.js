#!/usr/bin/env node

/**
 * Wogi Flow - Story Creation with Deep Decomposition
 *
 * Creates detailed stories with acceptance criteria.
 * Supports --deep flag for automatic decomposition into sub-tasks.
 * Stories are stored flat in .workflow/changes/ and archived when completed.
 *
 * Usage:
 *   flow story "Add login form"              # Create standard story
 *   flow story "Add login form" --deep       # Create with decomposition
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  colors,
  getConfig,
  getConfigValue,
  generateTaskId,
  parseFlags,
  outputJson,
  withLock,
  safeJsonParse,
  isPathWithinProject
} = require('./flow-utils');

// Import context orchestrator for product context
let contextOrchestrator = null;
try {
  contextOrchestrator = require('./flow-context-orchestrator');
} catch (_err) {
  // Context orchestrator not available - continue without it
}

// Import parallel execution detection
const { findParallelizable, getParallelConfig } = require('./flow-parallel');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CHANGES_DIR = path.join(WORKFLOW_DIR, 'changes');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const READY_PATH = path.join(STATE_DIR, 'ready.json');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

/**
 * Generate a task ID for a story
 * Uses hash-based IDs (wf-XXXXXXXX format)
 */
function getTaskId(title) {
  return generateTaskId(title);
}

/**
 * Generate a sub-task ID
 * Sub-tasks use parent ID with numeric suffix: wf-a1b2c3d4-01, wf-a1b2c3d4-02, etc.
 */
function getSubTaskId(parentId, subNum) {
  return `${parentId}-${String(subNum).padStart(2, '0')}`;
}

/**
 * Get product context for story generation
 * @returns {Object|null} Product overview or null
 */
function getProductContextForStory() {
  if (!contextOrchestrator) {
    return null;
  }

  try {
    return contextOrchestrator.getProductOverview();
  } catch (_err) {
    // Intentionally silent - product context is optional enhancement
    // Debug: uncomment to diagnose issues
    // console.error('[getProductContextForStory] Error:', _err.message);
    return null;
  }
}

/**
 * Generate story template content
 */
function generateStoryTemplate(taskId, title) {
  // Get product context if available
  const productContext = getProductContextForStory();
  const productSection = productContext && productContext.name
    ? `
## Product Context
<!-- PIN: product-context -->
**Product**: ${productContext.name}
${productContext.tagline ? `**Tagline**: ${productContext.tagline}` : ''}
${productContext.type ? `**Type**: ${productContext.type}` : ''}

---
`
    : '';

  return `# [${taskId}] ${title}
${productSection}

## User Story
**As a** [user type]
**I want** [action/capability]
**So that** [benefit/value]

## Description
[2-4 sentences explaining the context, what needs to be built, and why it matters.]

## Acceptance Criteria

### Scenario 1: Happy path
**Given** [initial context/state]
**When** [action taken]
**Then** [expected outcome]
**And** [additional outcome if needed]

### Scenario 2: Alternative path
**Given** [context]
**When** [action]
**Then** [outcome]

### Scenario 3: Error handling
**Given** [context]
**When** [invalid action or error condition]
**Then** [error handling behavior]

### WIRING (Required for UI components)
**IMPORTANT**: If this feature creates new components, specify where they wire into:

- **Component**: [NewComponent.tsx]
- **Wires into**: [ParentComponent.tsx]
- **Triggered by**: [onClick on table row / button click / route navigation]
- **Verification**: [Component is imported AND rendered when trigger fires]

*Delete this section if no new UI components are created.*

## Technical Notes
- **Components**:
  - Use existing: [check app-map.md]
  - Create new: [add to app-map after]
- **API**: [endpoints if any]
- **State**: [state management notes]
- **Constraints**: [technical limitations]

## Test Strategy
- [ ] Unit: [what to test]
- [ ] Integration: [what to test]
- [ ] E2E: [user flow to verify]

## Dependencies
- None

## Complexity
[Low / Medium / High] - [justification]

## Out of Scope
- [What this does NOT include]

## Boundaries (DO NOT MODIFY)
Files and paths that must NOT be touched during this task, even if related:

- [path/to/stable-file.js] — [reason: stable, tested, unrelated]

*Delete this section if no boundary protections are needed. Boundaries are enforced by the scope gate at runtime.*
`;
}

/**
 * Generate sub-task template
 */
function generateSubTaskTemplate(parentId, subNum, objective, doneCriteria, deps = []) {
  const subTaskId = getSubTaskId(parentId, subNum);
  const depStr = deps.length > 0
    ? deps.map(d => `- ${d}`).join('\n')
    : '- None (can start immediately)';

  // Check if this looks like a UI component task
  const isUIComponent = /component|ui|layout|modal|panel|dialog|form|page|screen/i.test(objective);

  const wiringSection = isUIComponent ? `
## Wiring Requirements
- **Component file**: [path to created component]
- **Wires into**: [parent component that imports this]
- **Triggered by**: [user action that renders this component]
- **Verification**: Component is imported AND rendered when triggered
` : '';

  return {
    id: subTaskId,
    content: `# [${subTaskId}] ${objective}

## Objective
${objective}

## Done Criteria
${doneCriteria.map(c => `- [ ] ${c}`).join('\n')}
${isUIComponent ? '- [ ] **WIRING**: Component is imported in parent\n- [ ] **WIRING**: Component renders when triggered' : ''}

## Dependencies
${depStr}
${wiringSection}
## Scope
S - Single focused objective

## Parent
Part of [${parentId}]
`
  };
}

/**
 * Analyze title and suggest decomposition
 */
function analyzeForDecomposition(title) {
  const titleLower = title.toLowerCase();

  // Common patterns that suggest complexity
  const complexityIndicators = {
    auth: ['login', 'logout', 'register', 'signup', 'authentication', 'password', 'session'],
    form: ['form', 'input', 'validation', 'submit'],
    crud: ['create', 'read', 'update', 'delete', 'edit', 'list', 'view'],
    ui: ['component', 'modal', 'dialog', 'dropdown', 'table', 'grid', 'card'],
    api: ['api', 'endpoint', 'fetch', 'request', 'integration'],
    state: ['state', 'store', 'context', 'redux', 'zustand']
  };

  const detectedPatterns = [];
  for (const [pattern, keywords] of Object.entries(complexityIndicators)) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      detectedPatterns.push(pattern);
    }
  }

  // Suggest sub-tasks based on patterns
  const suggestedSubTasks = [];

  if (detectedPatterns.includes('auth')) {
    suggestedSubTasks.push(
      { objective: 'Create UI layout and structure', criteria: ['Layout renders correctly', 'Responsive design works'] },
      { objective: 'Add form inputs with validation', criteria: ['Inputs accept user data', 'Validation feedback shows'] },
      { objective: 'Implement API integration', criteria: ['API calls work', 'Errors handled'] },
      { objective: 'Handle success flow', criteria: ['Success redirects work', 'State updates correctly'] },
      { objective: 'Handle error states', criteria: ['Error messages display', 'User can retry'] },
      { objective: 'Add loading states', criteria: ['Loading indicator shows', 'UI disabled during load'] }
    );
  } else if (detectedPatterns.includes('form')) {
    suggestedSubTasks.push(
      { objective: 'Create form layout', criteria: ['Form renders correctly', 'Labels and inputs aligned'] },
      { objective: 'Add input validation', criteria: ['Validation rules work', 'Error messages show'] },
      { objective: 'Implement form submission', criteria: ['Submit triggers correctly', 'Data sent properly'] },
      { objective: 'Handle submission states', criteria: ['Loading state works', 'Success/error handled'] }
    );
  } else if (detectedPatterns.includes('crud')) {
    suggestedSubTasks.push(
      { objective: 'Create list/display view', criteria: ['Data displays correctly', 'Empty state handled'] },
      { objective: 'Add create functionality', criteria: ['Create form works', 'New items appear'] },
      { objective: 'Add edit functionality', criteria: ['Edit form populates', 'Changes save correctly'] },
      { objective: 'Add delete functionality', criteria: ['Delete confirmation works', 'Items removed correctly'] }
    );
  } else if (detectedPatterns.includes('ui')) {
    suggestedSubTasks.push(
      { objective: 'Create component structure', criteria: ['Component renders', 'Props typed correctly'], isUIComponent: true },
      { objective: 'Add styling and variants', criteria: ['Styles applied', 'Variants work'] },
      { objective: 'Add interactivity', criteria: ['Events handled', 'State updates'] },
      { objective: 'Handle edge cases', criteria: ['Empty state works', 'Error state works', 'Loading state works'] },
      { objective: 'Wire component into parent', criteria: ['Component imported in parent', 'Component renders when triggered', 'User can access the component'], isWiringTask: true }
    );
  }

  return {
    patterns: detectedPatterns,
    suggestedSubTasks,
    shouldDecompose: suggestedSubTasks.length >= 3
  };
}

/**
 * Convert title to URL-safe slug for folder names
 * @param {string} title - Title to slugify
 * @returns {string} Slugified title
 */
function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')     // Remove non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')       // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, '')       // Trim hyphens from start/end
    .substring(0, 50);             // Limit length
}

/**
 * Create story with optional deep decomposition
 * - Simple stories: flat in .workflow/changes/
 * - Decomposed stories: grouped in feature folder
 * - Dry-run mode: preview what would be created without writing files
 */
async function createStory(title, options = {}) {
  // Input validation
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('Title is required and must be a non-empty string');
  }

  const config = getConfig();
  const decompositionConfig = config.storyDecomposition || {};
  const dryRun = options.dryRun || false;

  // Get priority from options or config
  const defaultPriority = getConfigValue('priorities.defaultPriority', 'P2');
  const priority = options.priority || defaultPriority;

  // Generate hash-based task ID
  const taskId = getTaskId(title);

  // Check if decomposition needed (before creating files)
  const analysis = analyzeForDecomposition(title);
  const shouldDecompose = options.deep ||
    (decompositionConfig.autoDecompose && analysis.shouldDecompose);

  // Determine target directory: feature folder for decomposed, flat for simple
  let targetDir = CHANGES_DIR;
  let featureFolder = null;

  if (shouldDecompose && analysis.suggestedSubTasks.length > 0) {
    // Create feature folder for decomposed stories
    featureFolder = slugify(title);
    targetDir = path.join(CHANGES_DIR, featureFolder);

    // Security: Validate path is within project (defense against path traversal)
    if (!isPathWithinProject(targetDir, PROJECT_ROOT)) {
      throw new Error(`Security: Target directory "${targetDir}" is outside project root`);
    }

    // Only create directory in non-dry-run mode
    if (!dryRun) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }

  // Only ensure changes directory exists in non-dry-run mode
  if (!dryRun) {
    fs.mkdirSync(CHANGES_DIR, { recursive: true });
  }

  // Create main story file (or just compute path in dry-run mode)
  const storyContent = generateStoryTemplate(taskId, title);
  const storyFile = path.join(targetDir, `${taskId}.md`);
  if (!dryRun) {
    fs.writeFileSync(storyFile, storyContent);
  }

  const result = {
    taskId,
    title,
    priority,
    storyFile,
    featureFolder,  // null for flat, folder name for decomposed
    subTasks: [],
    dryRun  // Include dry-run flag in result
  };

  const shouldSuggest = !options.deep &&
    !decompositionConfig.autoDecompose &&
    decompositionConfig.autoDetect &&
    analysis.shouldDecompose;

  if (shouldSuggest) {
    result.decompositionSuggested = true;
    result.suggestedCount = analysis.suggestedSubTasks.length;
    result.patterns = analysis.patterns;
  }

  if (shouldDecompose && analysis.suggestedSubTasks.length > 0) {
    // Create sub-task files in feature folder
    let subNum = 1;
    const subTaskIds = [];

    for (const sub of analysis.suggestedSubTasks) {
      // Use previous ID from array for clarity (avoids recalculating)
      const deps = subTaskIds.length > 0 ? [subTaskIds[subTaskIds.length - 1]] : [];
      const subTask = generateSubTaskTemplate(taskId, subNum, sub.objective, sub.criteria, deps);

      const subTaskFile = path.join(targetDir, `${subTask.id}.md`);
      if (!dryRun) {
        fs.writeFileSync(subTaskFile, subTask.content);
      }

      subTaskIds.push(subTask.id);
      result.subTasks.push({
        id: subTask.id,
        objective: sub.objective,
        file: subTaskFile,
        // Propagate wiring flags from analysis
        isUIComponent: sub.isUIComponent || false,
        isWiringTask: sub.isWiringTask || false
      });
      subNum++;
    }

    // Update ready.json with parent and sub-tasks (with file locking)
    // Skip in dry-run mode to avoid polluting the task queue
    if (!dryRun && fs.existsSync(READY_PATH)) {
      try {
        await withLock(READY_PATH, async () => {
          const ready = safeJsonParse(READY_PATH, { ready: [] });
          ready.ready = ready.ready || [];

          // Add parent task with new format
          ready.ready.push({
            id: taskId,
            title,
            type: 'parent',
            subTasks: subTaskIds,
            status: 'ready',
            priority,
            createdAt: new Date().toISOString()
          });

          // Add sub-tasks with new format
          for (let i = 0; i < result.subTasks.length; i++) {
            const sub = result.subTasks[i];
            const taskEntry = {
              id: sub.id,
              title: sub.objective,
              type: 'sub-task',
              parent: taskId,
              status: 'ready',
              priority,
              dependencies: i > 0 ? [result.subTasks[i - 1].id] : [],
              createdAt: new Date().toISOString()
            };

            // Add wiring metadata for UI components
            if (sub.isUIComponent || sub.isWiringTask) {
              taskEntry.requiresWiring = true;
              taskEntry.wiringNotes = 'Component must be imported and rendered in parent';
            }

            ready.ready.push(taskEntry);
          }

          ready.lastUpdated = new Date().toISOString();
          fs.writeFileSync(READY_PATH, JSON.stringify(ready, null, 2));
        });
        result.addedToReady = true;
      } catch (err) {
        result.addedToReady = false;
        result.readyError = err.message;
      }
    } else if (dryRun) {
      result.addedToReady = false;
      result.wouldAddToReady = true;
    }

    result.decomposed = true;

    // Check if sub-tasks can run in parallel
    try {
      const parallelConfig = getParallelConfig();
      if (parallelConfig.enabled && result.subTasks.length >= 2) {
        // Build task objects for parallel detection
        const taskObjects = result.subTasks.map((sub, idx) => ({
          id: sub.id,
          title: sub.objective,
          dependencies: idx > 0 ? [result.subTasks[idx - 1].id] : []
        }));

        const parallelizable = findParallelizable(taskObjects);
        if (parallelizable.length >= 2) {
          const config = getConfig();
          result.parallelExecution = {
            available: true,
            count: parallelizable.length,
            taskIds: parallelizable.map(t => t.id),
            worktreeEnabled: config.worktree?.enabled || false
          };
        }
      }
    } catch (_err) {
      // Non-critical - continue without parallel info
    }
  }

  return result;
}

// CLI handling
if (require.main === module) {
  (async () => {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  if (flags.help || positional.length === 0) {
    console.log(`
Wogi Flow - Story Creation

Usage:
  flow story "<title>"                 Create standard story
  flow story "<title>" --deep          Create with decomposition
  flow story "<title>" --priority P1   Set priority (P0-P4)
  flow story "<title>" --dry-run       Preview without creating files
  flow story "<title>" --deep --json   All options

Options:
  --deep           Automatically decompose into sub-tasks
  --priority <P>   Priority P0-P4 (default: from config, usually P2)
  --dry-run        Preview what would be created without writing files
  --json           Output JSON instead of human-readable

Storage:
  - Simple stories: flat in .workflow/changes/
  - Decomposed stories (--deep): grouped in feature folder
  - Completed stories: auto-archived to .workflow/archive/specs/

Configuration (config.json):
  "storyDecomposition": {
    "autoDetect": true,        // Suggest decomposition when beneficial
    "autoDecompose": false,    // Auto-decompose without asking
  }
  "priorities": {
    "defaultPriority": "P2",   // Default priority for new stories
  }

Examples:
  flow story "Add user login"
  flow story "Add user login" --deep
  flow story "Add user login" --priority P1
`);
    process.exit(0);
  }

  if (positional.length === 0) {
    log('red', 'Error: Title is required');
    process.exit(1);
  }

  const title = positional[0];

  // Validate priority if provided
  let priority = flags.priority;
  if (priority && !/^P[0-4]$/.test(priority)) {
    log('yellow', `Warning: Invalid priority "${priority}", using default`);
    priority = undefined;
  }

  // Create story
  const result = await createStory(title, {
    deep: flags.deep,
    priority,
    dryRun: flags['dry-run'] || flags.dryRun
  });

  // JSON output
  if (flags.json) {
    outputJson({
      success: true,
      ...result
    });
    // outputJson exits, so this won't run
  }

  // Human-readable output
  console.log('');
  if (result.dryRun) {
    log('yellow', `[DRY RUN] Would create story: ${result.taskId}`);
    log('cyan', `  Would write: ${result.storyFile}`);
  } else {
    log('green', `✓ Created story: ${result.taskId}`);
    log('cyan', `  ${result.storyFile}`);
  }
  console.log('');
  log('white', `Title: ${result.title}`);
  log('white', `Priority: ${result.priority}`);
  if (result.featureFolder) {
    log('white', `Feature folder: ${result.featureFolder}/`);
  }

  if (result.decomposed) {
    console.log('');
    log('cyan', `${result.dryRun ? 'Would decompose' : 'Decomposed'} into ${result.subTasks.length} sub-tasks:`);
    result.subTasks.forEach(sub => {
      log('dim', `   ${sub.id}: ${sub.objective}`);
    });
    if (result.addedToReady) {
      console.log('');
      log('green', '✓ Added parent and sub-tasks to ready.json');
    } else if (result.wouldAddToReady) {
      console.log('');
      log('yellow', '[DRY RUN] Would add parent and sub-tasks to ready.json');
    }

    // Show parallel execution info
    if (result.parallelExecution && result.parallelExecution.available) {
      console.log('');
      log('cyan', `⚡ PARALLEL EXECUTION AVAILABLE`);
      log('white', `   ${result.parallelExecution.count} sub-tasks can run in parallel (no dependencies)`);
      log('dim', `   Tasks: ${result.parallelExecution.taskIds.join(', ')}`);
      if (result.parallelExecution.worktreeEnabled) {
        log('green', '   ✓ Worktree isolation enabled - safe for parallel execution');
      } else {
        log('yellow', '   ⚠ Enable worktree for safe parallel: flow worktree enable');
      }
    }
  } else if (result.decompositionSuggested) {
    console.log('');
    log('yellow', `This looks like a complex story (${result.patterns.join(', ')})`);
    log('yellow', `   Consider using --deep to decompose into ~${result.suggestedCount} sub-tasks`);
    log('dim', `   Run: flow story "${title}" --deep`);
  }

  console.log('');
  if (result.dryRun) {
    log('yellow', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('yellow', 'DRY RUN COMPLETE - No files were created');
    log('yellow', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('dim', 'To create for real, run without --dry-run flag');
  } else {
    log('dim', 'Next steps:');
    log('dim', '  1. Fill in the story details');
    log('dim', '  2. Check app-map.md for existing components');
    if (!result.decomposed) {
      log('dim', '  3. Add to ready.json when ready to implement');
    } else {
      log('dim', '  3. Start with: /wogi-start ' + result.subTasks[0].id);
    }
  }
  })().catch(err => {
    log('red', `Error: ${err.message}`);
    process.exit(1);
  });
}

// Export for use by other modules
module.exports = {
  createStory,
  analyzeForDecomposition,
  generateStoryTemplate,
  generateSubTaskTemplate,
  getTaskId,
  getSubTaskId
};
