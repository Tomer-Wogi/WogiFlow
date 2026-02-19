#!/usr/bin/env node

/**
 * Wogi Flow - Complete Task
 *
 * Runs quality gates and moves task from inProgress to completed.
 */

const { execSync, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  getConfig,
  moveTaskAsync,
  findTask,
  readFile,
  readJson,
  safeJsonParse,
  writeJson,
  color,
  success,
  warn,
  error
} = require('./flow-utils');

// v1.7.0 context memory management
const { warnIfContextHigh } = require('./flow-context-monitor');
const { clearCurrentTask, addKeyFact } = require('./flow-memory-blocks');
const { trackTaskComplete } = require('./flow-session-state');
const { autoArchiveIfNeeded } = require('./flow-log-manager');

// v1.9.0 regression testing (legacy - now in workflow steps)
const { runRegressionTests } = require('./flow-regression');

// v2.2 modular workflow steps
const { runSteps, getAllSteps } = require('./flow-workflow-steps');

// v2.0 durable session support
const { loadDurableSession, archiveDurableSession } = require('./flow-durable-session');

// v5.1 prompt capture and clarification learning
const { processTaskCompletion, getRefinementCount } = require('./flow-prompt-capture');

// v2.1 task enforcement as explicit quality gate
const { canExitLoop, getActiveLoop } = require('./flow-task-enforcer');

// v2.5 checkpoint system
const { Checkpoint } = require('./flow-checkpoint');

// v5.0: TodoWrite sync for completion reports (optional - graceful degradation)
let todoWriteSync = null;
try {
  todoWriteSync = require('./flow-todowrite-sync');
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-todowrite-sync not available: ${err.message}`);
}
const getTodoWriteStats = todoWriteSync?.getTodoWriteStats || (() => null);
const clearTodoWriteState = todoWriteSync?.clearTodoWriteState || (() => {});

// v3.0 epic progress propagation
const { updateEpicProgress, listEpics, getEpic } = require('./flow-epics');

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

// v3.1 spec verification gate
const { verifySpecDeliverables, formatVerificationResults } = require('./flow-spec-verifier');

// v3.1 recursive error recovery (with hypothesis generation)
let errorRecovery;
try {
  errorRecovery = require('./flow-error-recovery');
} catch (err) {
  // Module optional - graceful degradation
  errorRecovery = null;
}

let hypothesisGenerator;
try {
  hypothesisGenerator = require('./flow-hypothesis-generator');
} catch (err) {
  hypothesisGenerator = null;
}

// Path for last failure artifact
const LAST_FAILURE_PATH = path.join(PATHS.state, 'last-failure.json');

/**
 * Get files modified in current task (from git)
 */
function getModifiedFiles() {
  try {
    // Get staged and unstaged changes
    const staged = execSync('git diff --cached --name-only', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split('\n').filter(Boolean);

    const unstaged = execSync('git diff --name-only', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split('\n').filter(Boolean);

    const untracked = execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split('\n').filter(Boolean);

    // Combine and dedupe
    const all = [...new Set([...staged, ...unstaged, ...untracked])];
    return all.filter(f => f && f.length > 0);
  } catch (err) {
    // Log in DEBUG mode instead of silently swallowing
    if (process.env.DEBUG) console.error(`[DEBUG] getModifiedFiles: ${err.message}`);
    return [];
  }
}

/**
 * Truncate error output to reasonable length
 */
function truncateOutput(text, maxLines = 30, maxChars = 2000) {
  if (!text) return '';
  const lines = text.split('\n').slice(0, maxLines);
  let result = lines.join('\n');
  if (result.length > maxChars) {
    result = result.substring(0, maxChars) + '\n... (truncated)';
  }
  return result;
}

/**
 * Run quality gates from config
 */
function runQualityGates(taskId) {
  if (!fileExists(PATHS.config)) {
    return { passed: true, failed: [], errors: {} };
  }

  console.log(color('yellow', 'Running quality gates...'));
  console.log('');

  const config = getConfig();
  const gates = config.qualityGates?.feature?.require || [];
  const testing = config.testing || {};
  const failed = [];
  const errors = {}; // Store error output for correction artifact

  for (const gate of gates) {
    if (gate === 'tests') {
      if (testing.runAfterTask || testing.runBeforeCommit) {
        console.log('  Running tests...');
        const result = spawnSync('npm', ['test'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        if (result.status === 0) {
          console.log(`  ${color('green', '✓')} tests passed`);
        } else {
          console.log(`  ${color('red', '✗')} tests failed`);
          // Capture error output
          const errorOutput = result.stderr || result.stdout || '';
          if (errorOutput) {
            console.log(color('dim', '  Error output:'));
            const truncated = truncateOutput(errorOutput, 20, 1000);
            truncated.split('\n').forEach(line => {
              console.log(color('dim', `    ${line}`));
            });
          }
          errors.tests = errorOutput;
          failed.push('tests');
        }
      } else {
        console.log(`  ${color('yellow', '○')} tests (not configured to run)`);
      }
    } else if (gate === 'lint') {
      console.log('  Running lint...');
      let result = spawnSync('npm', ['run', 'lint'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        // Try auto-fix
        console.log(`  ${color('yellow', '⟳')} lint issues found, attempting auto-fix...`);
        spawnSync('npm', ['run', 'lint', '--', '--fix'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Re-run lint to check if issues are fixed
        result = spawnSync('npm', ['run', 'lint'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.status === 0) {
          console.log(`  ${color('green', '✓')} lint passed (auto-fixed)`);
        } else {
          console.log(`  ${color('red', '✗')} lint failed (manual fix required)`);
          const errorOutput = result.stderr || result.stdout || '';
          if (errorOutput) {
            console.log(color('dim', '  Remaining issues:'));
            const truncated = truncateOutput(errorOutput, 15, 800);
            truncated.split('\n').forEach(line => {
              console.log(color('dim', `    ${line}`));
            });
          }
          errors.lint = errorOutput;
          failed.push('lint');
        }
      } else {
        console.log(`  ${color('green', '✓')} lint passed`);
      }
    } else if (gate === 'typecheck') {
      console.log('  Running typecheck...');
      const result = spawnSync('npm', ['run', 'typecheck'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      if (result.status === 0) {
        console.log(`  ${color('green', '✓')} typecheck passed`);
      } else {
        console.log(`  ${color('red', '✗')} typecheck failed`);
        const errorOutput = result.stderr || result.stdout || '';
        if (errorOutput) {
          console.log(color('dim', '  Type errors:'));
          const truncated = truncateOutput(errorOutput, 20, 1000);
          truncated.split('\n').forEach(line => {
            console.log(color('dim', `    ${line}`));
          });
        }
        errors.typecheck = errorOutput;
        failed.push('typecheck');
      }
    } else if (gate === 'requestLogEntry') {
      // Check if request-log has an entry for this task
      try {
        const content = readFile(PATHS.requestLog, '');
        if (content.includes(taskId)) {
          console.log(`  ${color('green', '✓')} requestLogEntry (found in request-log)`);
        } else {
          console.log(`  ${color('yellow', '○')} requestLogEntry (add entry to request-log.md)`);
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`[DEBUG] requestLogEntry check: ${err.message}`);
        console.log(`  ${color('yellow', '○')} requestLogEntry (could not check)`);
      }
    } else if (gate === 'appMapUpdate') {
      console.log(`  ${color('yellow', '○')} appMapUpdate (verify manually if components created)`);
    } else if (gate === 'loopComplete') {
      // v2.1: Explicit loop completion check
      const activeLoop = getActiveLoop();
      if (!activeLoop) {
        // No active loop - either completed or not used
        console.log(`  ${color('green', '✓')} loopComplete (no active loop session)`);
      } else {
        const exitResult = canExitLoop();
        if (exitResult.canExit) {
          console.log(`  ${color('green', '✓')} loopComplete (${exitResult.reason})`);
        } else {
          console.log(`  ${color('red', '✗')} loopComplete (${exitResult.pending || 0} pending, ${exitResult.failed || 0} failed)`);
          errors.loopComplete = exitResult.message || 'Loop not complete';
          failed.push('loopComplete');
        }
      }
    } else if (gate === 'noNewFeatures') {
      // Refactor-specific gate - manual check
      console.log(`  ${color('yellow', '○')} noNewFeatures (verify no behavior changes)`);
    } else {
      console.log(`  ${color('yellow', '○')} ${gate} (manual check)`);
    }
  }

  if (failed.length > 0) {
    console.log('');
    console.log(color('red', `Failed gates: ${failed.join(', ')}`));
  }

  return { passed: failed.length === 0, failed, errors };
}

/**
 * Get conventional commit prefix from task type
 * @param {string} taskType - Type of task (feature, bugfix, refactor, docs, etc.)
 * @returns {string} Conventional commit prefix
 */
function getCommitPrefix(taskType) {
  const prefixMap = {
    feature: 'feat',
    feat: 'feat',
    bugfix: 'fix',
    bug: 'fix',
    fix: 'fix',
    refactor: 'refactor',
    docs: 'docs',
    documentation: 'docs',
    test: 'test',
    tests: 'test',
    chore: 'chore',
    style: 'style',
    perf: 'perf',
    ci: 'ci'
  };
  return prefixMap[taskType?.toLowerCase()] || 'feat';
}

/**
 * Archive change spec file when task completes
 * Handles both flat files and feature folders
 * Moves from .workflow/changes/ to .workflow/archive/specs/[YYYY-MM]/
 * @param {string} taskId - Task ID to archive
 */
function archiveChangeSpec(taskId) {
  const changesDir = path.join(PATHS.workflow, 'changes');
  const archiveDir = path.join(PATHS.workflow, 'archive', 'specs');

  if (!fs.existsSync(changesDir)) {
    return { archived: [], archivedFolder: null, skipped: [] };
  }

  // Get current year-month for archive folder
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const targetDir = path.join(archiveDir, yearMonth);

  const archived = [];
  const skipped = []; // Track files that don't match standard naming
  let archivedFolder = null;
  // SECURITY: Escape special regex characters to prevent ReDoS attacks
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskPattern = new RegExp(`^${escapedTaskId}(-\\d+)?\\.md$`, 'i');
  // Standard naming pattern: wf-XXXXXXXX.md or wf-XXXXXXXX-NN.md
  const standardPattern = /^wf-[a-f0-9]{8}(-\d+)?\.md$/i;

  try {
    const entries = fs.readdirSync(changesDir, { withFileTypes: true });

    // First pass: check for feature folders containing this task
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'README.md') {
        const subDir = path.join(changesDir, entry.name);
        const subFiles = fs.readdirSync(subDir);

        // Check if this folder contains files for this task
        const matchingFiles = subFiles.filter(f => taskPattern.test(f));

        if (matchingFiles.length > 0) {
          // Archive the entire feature folder
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          const targetFolderPath = path.join(targetDir, entry.name);
          fs.renameSync(subDir, targetFolderPath);
          archivedFolder = entry.name;
          archived.push({ from: `${entry.name}/`, to: path.join(yearMonth, entry.name) + '/', isFolder: true });

          // Don't continue checking flat files if we found a folder
          return { archived, archivedFolder, skipped };
        }
      }
    }

    // Second pass: check for flat files matching taskId, track non-conforming files
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        if (taskPattern.test(entry.name)) {
          const sourcePath = path.join(changesDir, entry.name);

          // Ensure archive directory exists
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          const targetPath = path.join(targetDir, entry.name);
          fs.renameSync(sourcePath, targetPath);
          archived.push({ from: entry.name, to: path.join(yearMonth, entry.name) });
        } else if (!standardPattern.test(entry.name)) {
          // Track non-conforming files (don't match wf-XXXXXXXX pattern)
          skipped.push(entry.name);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] archiveChangeSpec: ${err.message}`);
  }

  return { archived, archivedFolder, skipped };
}

// ============================================================
// Cascade Completion (v3.2)
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
    console.log(color('green', `  ✓ Feature ${featureId} auto-completed (all stories done)`));

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
    console.log(color('green', `  ✓ Epic ${epicId} auto-completed (all features/stories done)`));

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
    console.log(color('green', `  ✓ Plan ${planId} auto-completed (all epics done)`));

    // Archive the completed plan
    if (archive) {
      archiveCompletedParent(planId, 'plan');
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] markPlanComplete: ${err.message}`);
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
      console.log(color('dim', `  📦 Archived ${itemType} ${itemId} to ${result.yearMonth}/`));

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

/**
 * Maximum recursion depth for cascade completion
 * Hierarchy is: subtask/story → feature → epic → plan (max 4 levels)
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

/**
 * Update implementation timeline with completed task
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title/description
 */
function updateImplementationTimeline(taskId, taskTitle) {
  const timelinePath = path.join(PATHS.state, 'implementation-timeline.md');

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = now.getDate();
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Calculate week number in month
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekNum = Math.ceil((day + firstDay.getDay()) / 7);

  // Calculate week start/end dates
  const weekStart = new Date(now);
  weekStart.setDate(day - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekRange = `${monthName.slice(0, 3)} ${weekStart.getDate()}-${weekEnd.getDate()}`;

  const entry = `- [x] ${taskId}: ${taskTitle} (${dateStr})`;
  const weekHeader = `### Week ${weekNum} (${weekRange})`;
  const monthHeader = `## ${yearMonth}`;

  try {
    let content = '';
    if (fs.existsSync(timelinePath)) {
      content = fs.readFileSync(timelinePath, 'utf-8');
    } else {
      // Create new file with header
      content = '# Implementation Timeline\n\nTasks completed, organized by date.\n\n';
    }

    // Check if this task is already logged
    if (content.includes(taskId)) {
      return { updated: false, reason: 'already logged' };
    }

    // Find or create month section
    if (!content.includes(monthHeader)) {
      // Add new month section at the top (after header)
      const headerEnd = content.indexOf('\n\n', content.indexOf('# Implementation Timeline'));
      const insertPos = headerEnd > 0 ? headerEnd + 2 : content.length;
      content = content.slice(0, insertPos) + `${monthHeader}\n\n${weekHeader}\n${entry}\n\n` + content.slice(insertPos);
    } else {
      // Month exists, find or create week section
      const monthPos = content.indexOf(monthHeader);
      const nextMonthMatch = content.slice(monthPos + monthHeader.length).match(/\n## \d{4}-\d{2}/);
      const monthEnd = nextMonthMatch
        ? monthPos + monthHeader.length + nextMonthMatch.index
        : content.length;

      const monthSection = content.slice(monthPos, monthEnd);

      if (!monthSection.includes(`Week ${weekNum}`)) {
        // Add new week section after month header
        const weekInsertPos = monthPos + monthHeader.length + 1;
        content = content.slice(0, weekInsertPos) + `\n${weekHeader}\n${entry}\n` + content.slice(weekInsertPos);
      } else {
        // Week exists, add entry under it
        const weekPos = content.indexOf(`Week ${weekNum}`, monthPos);
        const lineEnd = content.indexOf('\n', weekPos);
        content = content.slice(0, lineEnd + 1) + entry + '\n' + content.slice(lineEnd + 1);
      }
    }

    fs.writeFileSync(timelinePath, content, 'utf-8');
    return { updated: true };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] updateImplementationTimeline: ${err.message}`);
    return { updated: false, reason: err.message };
  }
}

/**
 * Commit changes if any
 * @param {string} commitMsg - Commit message
 * @param {string} [taskType='feature'] - Task type for commit prefix
 */
function commitChanges(commitMsg, taskType = 'feature') {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (status.trim()) {
      console.log('');
      console.log(color('yellow', 'Committing changes...'));
      // Use execFileSync to prevent command injection
      execFileSync('git', ['add', '-A'], { stdio: 'pipe' });
      const prefix = getCommitPrefix(taskType);
      execFileSync('git', ['commit', '-m', `${prefix}: ${commitMsg}`], { stdio: 'pipe' });
      success('Changes committed');
    }
  } catch (err) {
    // Log git errors but don't fail the task completion
    warn(`Git operation skipped: ${err.message || 'not a git repo or no changes'}`);
  }
}

async function main() {
  const taskId = process.argv[2];
  const commitMsg = process.argv[3] || `Complete ${taskId}`;
  const skipSpecCheck = process.argv.includes('--skip-spec-check');
  const forceComplete = process.argv.includes('--force');

  if (!taskId) {
    console.log('Usage: flow done <task-id> [commit-message] [--skip-spec-check] [--force]');
    process.exit(1);
  }

  if (!fileExists(PATHS.ready)) {
    error('No ready.json found');
    process.exit(1);
  }

  // v3.1: Spec verification gate - verify all promised deliverables exist
  const doneConfig = getConfig();
  const requireSpecVerification = doneConfig.tasks?.requireSpecVerification !== false;

  if (requireSpecVerification && !skipSpecCheck) {
    console.log(color('cyan', 'Running spec verification...'));
    const specResult = verifySpecDeliverables(taskId, { skipCheck: skipSpecCheck });

    if (specResult.hasSpec && !specResult.passed && !specResult.skipped) {
      console.log('');
      console.log(formatVerificationResults(specResult));

      // Save failure artifact
      try {
        writeJson(LAST_FAILURE_PATH, {
          taskId,
          timestamp: new Date().toISOString(),
          type: 'spec-verification',
          specPath: specResult.specPath,
          missing: specResult.missing,
          invalid: specResult.invalid
        });
      } catch (err) {
        if (process.env.DEBUG) console.error(`[DEBUG] Failed to save spec failure: ${err.message}`);
      }

      if (forceComplete) {
        warn('Spec verification failed but continuing with --force');
      } else {
        error('Spec verification failed. Implement missing deliverables or use --skip-spec-check');
        console.log(color('dim', 'Missing files must be created before task can be completed.'));
        process.exit(1);
      }
    } else if (specResult.hasSpec && specResult.passed) {
      success(`Spec verification passed (${specResult.verified}/${specResult.totalFiles} deliverables)`);
    } else if (specResult.skipped && specResult.warning) {
      warn(specResult.warning);
    }
    console.log('');
  }

  // Run quality gates
  const gateResult = runQualityGates(taskId);

  if (!gateResult.passed) {
    // Create correction artifact for AI self-repair
    try {
      writeJson(LAST_FAILURE_PATH, {
        taskId,
        timestamp: new Date().toISOString(),
        failedGates: gateResult.failed,
        errors: gateResult.errors
      });
      console.log('');
      console.log(color('dim', `Failure details saved to: ${LAST_FAILURE_PATH}`));
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Failed to save failure artifact: ${err.message}`);
    }

    // v3.1: Error recovery analysis with hypotheses
    if (errorRecovery && doneConfig.errorRecovery?.enabled !== false) {
      console.log('');
      console.log(color('cyan', '━'.repeat(50)));
      console.log(color('cyan', '🔍 Error Recovery Analysis'));
      console.log(color('cyan', '━'.repeat(50)));

      // Analyze each failed gate
      for (const gate of gateResult.failed) {
        const errorText = gateResult.errors[gate] || '';
        if (errorText) {
          try {
            // Classify the error
            const classified = errorRecovery.classifyError(errorText);
            const levelName = errorRecovery.getLevelName(classified.level);
            console.log(`${gate}: ${color('yellow', levelName || 'unknown')} error`);

            // Get fix suggestions
            const suggestions = errorRecovery.getSuggestedFixes(classified.level, errorText);
            if (suggestions && suggestions.length > 0) {
              console.log(`  Suggested fixes:`);
              suggestions.slice(0, 3).forEach(fix => {
                console.log(`    → ${fix}`);
              });
            }

            // Generate hypotheses if available
            if (hypothesisGenerator) {
              const hypotheses = hypothesisGenerator.generateHypotheses(errorText, classified);
              if (hypotheses && hypotheses.length > 0) {
                console.log(`  Hypotheses:`);
                hypotheses.slice(0, 2).forEach(h => {
                  console.log(`    • ${h.hypothesis} (${Math.round(h.likelihood * 100)}% likelihood)`);
                });
              }
            }
            console.log('');
          } catch (analysisErr) {
            if (process.env.DEBUG) console.error(`[DEBUG] Error analysis: ${analysisErr.message}`);
          }
        }
      }
    }

    console.log('');
    error('Quality gates failed. Fix issues before completing.');
    console.log(color('dim', 'Tip: Review the error output above or check .workflow/state/last-failure.json'));
    process.exit(1);
  }

  console.log('');

  // Check if task exists
  const found = findTask(taskId);

  if (!found) {
    console.log(color('red', `Task ${taskId} not found in any queue`));
    process.exit(1);
  }

  if (found.list !== 'inProgress') {
    console.log(color('red', `Task ${taskId} is in ${found.list}, not inProgress`));
    process.exit(1);
  }

  // Move task from inProgress to recentlyCompleted (with file locking)
  const result = await moveTaskAsync(taskId, 'inProgress', 'recentlyCompleted');

  if (!result.success) {
    error(result.error);
    process.exit(1);
  }

  console.log(color('green', `✓ Completed: ${taskId}`));

  // v5.0: Show TodoWrite completion stats if available
  if (todoWriteSync) {
    try {
      const todoStats = getTodoWriteStats();
      if (todoStats && todoStats.taskId === taskId) {
        const { stats, completionPercent } = todoStats;
        console.log('');
        console.log(color('cyan', '━'.repeat(40)));
        console.log(color('cyan', '📋 Progress Summary'));
        console.log(color('cyan', '━'.repeat(40)));
        console.log(`Criteria: ${stats.completed}/${stats.total} completed (${completionPercent}%)`);

        if (todoStats.criteria && todoStats.criteria.length > 0) {
          todoStats.criteria.forEach((c, i) => {
            const icon = c.status === 'completed' ? color('green', '●') :
                         c.status === 'in_progress' ? color('yellow', '◐') : color('dim', '○');
            const statusColor = c.status === 'completed' ? 'green' :
                               c.status === 'in_progress' ? 'yellow' : 'dim';
            console.log(`  ${icon} ${color(statusColor, c.content)}`);
          });
        }
        console.log(color('cyan', '━'.repeat(40)));

        // Clear the TodoWrite state now that task is complete
        clearTodoWriteState();
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] TodoWrite stats: ${err.message}`);
    }
  }

  // v2.0: Archive durable session if one exists for this task
  try {
    const durableSession = loadDurableSession();
    if (durableSession && durableSession.taskId === taskId) {
      const archived = archiveDurableSession('completed');
      if (archived && process.env.DEBUG) {
        console.log(color('dim', `Archived durable session: ${archived.metrics.stepsCompleted} steps completed`));
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Durable session archive: ${err.message}`);
  }

  // v5.1: Process prompt capture and generate clarification learning entry if needed
  try {
    const taskTitle = result.task?.title || taskId;
    const learningResult = processTaskCompletion(taskId, taskTitle);

    if (learningResult.generated) {
      console.log('');
      console.log(color('cyan', '━'.repeat(40)));
      console.log(color('cyan', '📝 Clarification Learning'));
      console.log(color('cyan', '━'.repeat(40)));
      console.log(`Refinements during task: ${learningResult.refinementCount}`);
      console.log(`Learning entry created: ${learningResult.entry.id}`);
      console.log(color('dim', 'See .workflow/state/clarifications.md for details'));

      // v5.1.1: Flag high-refinement patterns (3+) to feedback-patterns.md
      if (learningResult.refinementCount >= 3) {
        try {
          const feedbackPath = path.join(PATHS.state, 'feedback-patterns.md');
          const today = new Date().toISOString().split('T')[0];
          const truncatedInitial = learningResult.entry.initial?.length > 50
            ? learningResult.entry.initial.slice(0, 50) + '...'
            : learningResult.entry.initial || 'unclear request';

          const patternEntry = `| ${today} | high-refinement-request | "${truncatedInitial}" | 1 | Monitor |\n`;

          // Append to feedback-patterns.md
          if (fileExists(feedbackPath)) {
            const content = readFile(feedbackPath, '');
            // Find the auto-captured patterns section or append at end
            if (content.includes('## Auto-Captured Patterns')) {
              // Insert after the table header
              const tableMatch = content.match(/(## Auto-Captured Patterns[\s\S]*?\|---.*?\|)\n/);
              if (tableMatch) {
                const insertPoint = tableMatch.index + tableMatch[0].length;
                const newContent = content.slice(0, insertPoint) + patternEntry + content.slice(insertPoint);
                fs.writeFileSync(feedbackPath, newContent);
              }
            }
          }

          console.log(color('yellow', `⚠ High-refinement pattern flagged (${learningResult.refinementCount} clarifications needed)`));
          console.log(color('dim', 'Consider adding clearer guidance to decisions.md'));
        } catch (flagErr) {
          if (process.env.DEBUG) console.error(`[DEBUG] High-refinement flagging: ${flagErr.message}`);
        }
      }

      console.log(color('cyan', '━'.repeat(40)));
    } else if (process.env.DEBUG) {
      console.log(color('dim', `No clarification learning needed: ${learningResult.reason}`));
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Clarification learning: ${err.message}`);
  }

  // v1.7.0: Track task completion in session state and memory blocks
  // v3.2.1: Improved error handling - don't silently swallow failures
  try {
    trackTaskComplete(taskId);
  } catch (err) {
    warn(`Session state update failed: ${err.message}`);
    if (process.env.DEBUG) console.error(`[DEBUG] trackTaskComplete: ${err.stack}`);
  }

  try {
    clearCurrentTask();
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] clearCurrentTask: ${err.message}`);
  }

  try {
    // Add completion as a key fact
    const taskTitle = result.task?.title || taskId;
    addKeyFact(`Completed: ${taskTitle}`);
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] addKeyFact: ${err.message}`);
  }

  // v1.7.0: Auto-archive request log if threshold exceeded
  try {
    const archiveResult = autoArchiveIfNeeded();
    if (archiveResult && archiveResult.archived > 0) {
      success(`Archived ${archiveResult.archived} request log entries`);
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Auto-archive: ${err.message}`);
  }

  // v3.0: Propagate progress to parent epics if applicable
  try {
    const config = getConfig();
    if (config.storyDecomposition?.propagateProgress !== false) {
      const epics = listEpics();
      for (const epic of epics) {
        // Update epic progress if this task is part of it
        if (epic.stories?.includes(taskId) || epic.stories?.some(s => {
          // Check if task is a child of any story in this epic
          // Use safeJsonParse per security-patterns.md Rule #2
          const readyData = safeJsonParse(PATHS.ready, {});
          const allTasks = [...(readyData.ready || []), ...(readyData.inProgress || []), ...(readyData.recentlyCompleted || [])];
          return allTasks.some(t => t && typeof t === 'object' && t.parent === s && t.id === taskId);
        })) {
          const progressResult = updateEpicProgress(epic.id);
          if (progressResult.epic && !progressResult.error) {
            const pct = Math.round(progressResult.epic.progress * 100);
            console.log(color('dim', `📊 Epic "${epic.title}" progress: ${pct}%`));
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Epic progress propagation: ${err.message}`);
  }

  // v3.2: Cascade completion up the hierarchy
  // When a story completes, auto-complete parent feature if all stories done
  // When a feature completes, auto-complete parent epic if all features done
  // When an epic completes, auto-complete parent plan if all epics done
  try {
    const taskType = result.task?.type || 'story';
    cascadeCompletion(taskId, taskType);
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Cascade completion: ${err.message}`);
  }

  // v2.3: Archive change spec and update implementation timeline
  try {
    const taskTitle = result.task?.title || taskId;
    const specArchive = archiveChangeSpec(taskId);
    if (specArchive.archivedFolder) {
      console.log(color('dim', `📦 Archived feature folder: ${specArchive.archivedFolder}/`));
    } else if (specArchive.archived.length > 0) {
      console.log(color('dim', `📦 Archived ${specArchive.archived.length} spec file(s)`));
    }

    // Warn about orphaned files that don't follow naming convention
    if (specArchive.skipped && specArchive.skipped.length > 0) {
      console.log('');
      console.log(color('yellow', '⚠️  Found files in .workflow/changes/ that don\'t follow naming convention:'));
      specArchive.skipped.forEach(f => console.log(color('yellow', `   • ${f}`)));
      console.log(color('dim', '   Expected format: wf-XXXXXXXX.md or wf-XXXXXXXX-NN.md'));
      console.log(color('dim', '   Run: flow health --fix to clean up, or manually archive to .workflow/archive/specs/'));
    }

    const timelineResult = updateImplementationTimeline(taskId, taskTitle);
    if (timelineResult.updated && process.env.DEBUG) {
      console.log(color('dim', '📋 Updated implementation timeline'));
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Spec archive/timeline: ${err.message}`);
  }

  // v2.2: Run afterTask workflow steps
  const modifiedFiles = getModifiedFiles();
  const taskTitle = result.task?.title || taskId;
  const taskType = result.task?.type || 'feature';

  try {
    const allSteps = getAllSteps();
    const hasAfterTaskSteps = Object.values(allSteps).some(s => s.enabled && s.when === 'afterTask');

    if (hasAfterTaskSteps) {
      console.log('');
      console.log(color('cyan', 'Running afterTask workflow steps...'));
      const afterTaskResult = await runSteps('afterTask', {
        taskId,
        taskTitle,
        taskType,
        files: modifiedFiles,
      });

      if (afterTaskResult.blocked) {
        error('Workflow step blocked task completion');
        process.exit(1);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] afterTask steps: ${err.message}`);
  }

  // Auto-capture learnings from bug fixes
  if (taskType === 'bugfix' || taskType === 'fix') {
    try {
      const { captureFromBugFix } = require('./flow-auto-learn');
      captureFromBugFix(taskId, modifiedFiles, taskTitle);
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] auto-learn: ${err.message}`);
    }
  }

  // v2.2: Run beforeCommit workflow steps
  try {
    const allSteps = getAllSteps();
    const hasBeforeCommitSteps = Object.values(allSteps).some(s => s.enabled && s.when === 'beforeCommit');

    if (hasBeforeCommitSteps) {
      console.log('');
      console.log(color('cyan', 'Running beforeCommit workflow steps...'));
      const beforeCommitResult = await runSteps('beforeCommit', {
        taskId,
        taskTitle,
        taskType,
        files: modifiedFiles,
      });

      if (beforeCommitResult.blocked) {
        error('Workflow step blocked commit');
        process.exit(1);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] beforeCommit steps: ${err.message}`);
  }

  // Commit if there are changes (use task type for commit prefix)
  commitChanges(commitMsg, taskType);

  // v2.5: Create checkpoint after task completion if configured
  const config = getConfig();
  if (config.checkpoint?.enabled && config.checkpoint?.onTaskComplete) {
    try {
      const checkpoint = new Checkpoint(config);
      const cp = checkpoint.create(`Task complete: ${taskId} - ${result.task?.title || commitMsg}`);
      if (cp) {
        console.log(color('dim', `📍 Checkpoint created: ${cp.id}`));
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Checkpoint creation: ${err.message}`);
    }
  }

  // v1.9.0: Run regression tests if configured (legacy - skipped if using workflowSteps)
  const usingWorkflowSteps = config.workflowSteps?.regressionTest?.enabled;
  if (!usingWorkflowSteps && config.regressionTesting?.enabled && config.regressionTesting?.runOnTaskComplete) {
    console.log('');
    try {
      const regressionResult = await runRegressionTests({ force: true });
      if (!regressionResult.success && config.regressionTesting?.onFailure === 'block') {
        warn('Regression tests failed - review before continuing');
        process.exit(1);
      } else if (!regressionResult.success) {
        warn('Regression tests failed - consider reviewing');
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Regression tests: ${err.message}`);
    }
  }

  // v2.0: Refresh component index after task if configured
  const scanOn = config.componentIndex?.scanOn || [];
  if (config.componentIndex?.autoScan !== false && scanOn.includes('afterTask')) {
    try {
      console.log(color('dim', '🔄 Refreshing component index...'));
      execFileSync('bash', ['scripts/flow-map-index', 'scan', '--quiet'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000
      });
      if (process.env.DEBUG) {
        console.log(color('dim', '   Component index updated'));
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Component index refresh: ${err.message}`);
    }
  }

  // v2.7: Refresh function registry after task if configured
  const funcScanOn = config.functionRegistry?.scanOn || [];
  if (config.functionRegistry?.enabled && config.functionRegistry?.autoUpdate !== false &&
      funcScanOn.includes('afterTask')) {
    try {
      if (process.env.DEBUG) console.log(color('dim', '🔄 Refreshing function registry...'));
      execFileSync('node', ['scripts/flow-function-index.js', 'scan'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000
      });
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Function registry refresh: ${err.message}`);
    }
  }

  // v2.7: Refresh API registry after task if configured
  const apiScanOn = config.apiRegistry?.scanOn || [];
  if (config.apiRegistry?.enabled && config.apiRegistry?.autoUpdate !== false &&
      apiScanOn.includes('afterTask')) {
    try {
      if (process.env.DEBUG) console.log(color('dim', '🔄 Refreshing API registry...'));
      execFileSync('node', ['scripts/flow-api-index.js', 'scan'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000
      });
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] API registry refresh: ${err.message}`);
    }
  }

  // v1.7.0: Check context health after task
  if (config.contextMonitor?.checkAfterTask !== false) {
    warnIfContextHigh();
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
