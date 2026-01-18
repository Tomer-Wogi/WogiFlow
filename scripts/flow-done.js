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

// v1.9.0 regression testing and browser test suggestions (legacy - now in workflow steps)
const { runRegressionTests } = require('./flow-regression');
const { suggestBrowserTests } = require('./flow-browser-suggest');

// v2.2 modular workflow steps
const { runSteps, getAllSteps } = require('./flow-workflow-steps');

// v2.0 durable session support
const { loadDurableSession, archiveDurableSession } = require('./flow-durable-session');

// v2.1 task enforcement as explicit quality gate
const { canExitLoop, getActiveLoop } = require('./flow-task-enforcer');

// v2.5 checkpoint system
const { Checkpoint } = require('./flow-checkpoint');

// v3.0 epic progress propagation
const { updateEpicProgress, listEpics } = require('./flow-epics');

// v3.1 spec verification gate
const { verifySpecDeliverables, formatVerificationResults } = require('./flow-spec-verifier');

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
  } catch (_err) {
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
    return { archived: [], archivedFolder: null };
  }

  // Get current year-month for archive folder
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const targetDir = path.join(archiveDir, yearMonth);

  const archived = [];
  let archivedFolder = null;
  // SECURITY: Escape special regex characters to prevent ReDoS attacks
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskPattern = new RegExp(`^${escapedTaskId}(-\\d+)?\\.md$`, 'i');

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
          return { archived, archivedFolder };
        }
      }
    }

    // Second pass: check for flat files matching taskId
    for (const entry of entries) {
      if (entry.isFile() && taskPattern.test(entry.name)) {
        const sourcePath = path.join(changesDir, entry.name);

        // Ensure archive directory exists
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const targetPath = path.join(targetDir, entry.name);
        fs.renameSync(sourcePath, targetPath);
        archived.push({ from: entry.name, to: path.join(yearMonth, entry.name) });
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] archiveChangeSpec: ${err.message}`);
  }

  return { archived, archivedFolder };
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

  if (requireSpecVerification || !skipSpecCheck) {
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

  // v1.7.0: Track task completion in session state and memory blocks
  try {
    trackTaskComplete(taskId);
    clearCurrentTask();

    // Add completion as a key fact
    const taskTitle = result.task?.title || taskId;
    addKeyFact(`Completed: ${taskTitle}`);
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Task tracking: ${err.message}`);
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
          const readyData = require('./flow-utils').readJson(PATHS.ready) || {};
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

  // v2.3: Archive change spec and update implementation timeline
  try {
    const taskTitle = result.task?.title || taskId;
    const specArchive = archiveChangeSpec(taskId);
    if (specArchive.archivedFolder) {
      console.log(color('dim', `📦 Archived feature folder: ${specArchive.archivedFolder}/`));
    } else if (specArchive.archived.length > 0) {
      console.log(color('dim', `📦 Archived ${specArchive.archived.length} spec file(s)`));
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

  // v1.9.0: Suggest browser tests for UI tasks (legacy - skipped if using workflowSteps)
  const usingBrowserWorkflowStep = config.workflowSteps?.browserTest?.enabled;
  if (!usingBrowserWorkflowStep && config.browserTesting?.enabled && config.browserTesting?.runOnTaskComplete) {
    try {
      const browserSuggestion = suggestBrowserTests(taskId, result.task);
      if (browserSuggestion.suggested && browserSuggestion.flows.length > 0) {
        console.log('');
        console.log(color('cyan', '🌐 Browser tests available:'));
        browserSuggestion.flows.forEach(flow => {
          console.log(color('dim', `   - ${flow}`));
        });
        console.log(color('dim', `   Run: /wogi-test-browser ${browserSuggestion.flows[0]}`));
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Browser test suggestion: ${err.message}`);
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
