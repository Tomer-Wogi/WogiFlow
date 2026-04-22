#!/usr/bin/env node

/**
 * Wogi Flow - Complete Task
 *
 * Runs quality gates and moves task from inProgress to completed.
 */

const cp = require('node:child_process');
const { execFileSync } = cp;
// Use indirect access for spawnSync/execSync so tests can mock them
const _cp = { spawnSync: cp.spawnSync, execSync: cp.execSync };
const spawnSync = (...args) => _cp.spawnSync(...args);
const execSync = (...args) => _cp.execSync(...args);
const fs = require('node:fs');
const path = require('node:path');
const _flowUtils = require('./flow-utils');
const { PATHS, moveTaskAsync, findTask, writeJson, color, success, warn, error, getTodayDate } = _flowUtils;
// Indirect access for testable functions — tests can swap _io members
const _io = {
  getConfig: _flowUtils.getConfig,
  fileExists: _flowUtils.fileExists,
  readFile: _flowUtils.readFile,
  readJson: _flowUtils.readJson,
  safeJsonParse: _flowUtils.safeJsonParse,
  safeJsonParseString: _flowUtils.safeJsonParseString,
  validateTaskId: _flowUtils.validateTaskId
};
const getConfig = (...args) => _io.getConfig(...args);
const fileExists = (...args) => _io.fileExists(...args);
const readFile = (...args) => _io.readFile(...args);
const readJson = (...args) => _io.readJson(...args);
const safeJsonParse = (...args) => _io.safeJsonParse(...args);
const safeJsonParseString = (...args) => _io.safeJsonParseString(...args);
const validateTaskId = (...args) => _io.validateTaskId(...args);

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
const { processTaskCompletion } = require('./flow-prompt-capture');

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
const { updateEpicProgress, listEpics } = require('./flow-epics');

// v3.2 cascade completion (extracted to flow-cascade-completion.js)
const {
  findParentFeature: _findParentFeature, findParentEpic: _findParentEpic, findParentPlan: _findParentPlan,
  allStoriesComplete: _allStoriesComplete, allFeaturesComplete: _allFeaturesComplete, allEpicsComplete: _allEpicsComplete,
  markFeatureComplete: _markFeatureComplete, markEpicComplete: _markEpicComplete, markPlanComplete: _markPlanComplete,
  archiveByType: _archiveByType, archiveCompletedParent: _archiveCompletedParent, cascadeCompletion,
  CASCADE_MAX_DEPTH: _CASCADE_MAX_DEPTH, _VALID_CASCADE_TYPES
} = require('./flow-cascade-completion');

// v3.1 spec verification gate
const { verifySpecDeliverables, formatVerificationResults } = require('./flow-spec-verifier');

// v5.2 verification profiles
const { loadProfile: loadVerificationProfile } = require('./flow-verification-profile');

// v2.3 extracted gate handlers and report formatting
const { runGate } = require('./flow-done-gates');
const {
  LAST_FAILURE_PATH,
  printFailureSummary,
  saveFailureArtifact,
  printErrorRecoveryAnalysis,
  printFinalFailureMessage,
} = require('./flow-done-report');

/**
 * Get files modified in current task (from git)
 */
function getModifiedFiles() {
  try {
    // Single git call replaces 3 sequential execSync calls
    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const staged = [];
    const unstaged = [];
    const untracked = [];

    if (porcelain) {
      for (const line of porcelain.split('\n')) {
        if (!line || line.length < 3) continue;
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        // Handle renamed files: "R  old -> new" — take the new name
        const rawPath = line.slice(3);
        const fileName = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath;
        if (indexStatus === '?' && workTreeStatus === '?') {
          untracked.push(fileName);
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') staged.push(fileName);
          if (workTreeStatus !== ' ' && workTreeStatus !== '?') unstaged.push(fileName);
        }
      }
    }

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
 * Check for outstanding MUST_FIX findings from last review
 * @returns {{ hasOutstanding: boolean, findings: Array, count: number }}
 */
function checkOutstandingFindings() {
  const reviewPath = path.join(PATHS.state, 'last-review.json');
  const review = safeJsonParse(reviewPath, null);
  if (!review || !Array.isArray(review.findings)) {
    return { hasOutstanding: false, findings: [], count: 0 };
  }

  const outstanding = review.findings.filter(f =>
    (f.severity === 'critical' || f.severity === 'high' || f.type === 'project-rule-violation') &&
    f.status !== 'fixed' && f.status !== 'dismissed' && f.status !== 'waived'
  );

  return {
    hasOutstanding: outstanding.length > 0,
    findings: outstanding,
    count: outstanding.length
  };
}

/**
 * Run quality gates from config.
 *
 * Orchestration layer — delegates to individual gate handlers in flow-done-gates.js
 * and report formatting to flow-done-report.js.
 */
function runQualityGates(taskId, taskType) {
  if (taskId && !validateTaskId(taskId).valid) {
    console.log(color('red', `Invalid task ID format: ${String(taskId).slice(0, 30)}`));
    return { passed: false, failed: ['invalidTaskId'], errors: { invalidTaskId: 'Task ID failed validation' } };
  }

  if (!fileExists(PATHS.config)) {
    return { passed: true, failed: [], errors: {} };
  }

  console.log(color('yellow', 'Running quality gates...'));
  console.log('');

  const verificationProfile = loadVerificationProfile();
  const config = getConfig();
  const normalizedType = (taskType ?? 'feature').toLowerCase();
  const gates = config.qualityGates?.[normalizedType]?.require
    ?? config.qualityGates?.feature?.require
    ?? [];

  // Warn if testing gates are present but no verification profile exists
  if (!verificationProfile) {
    const hasTestingGates = gates.some(g => ['generatedTestsPass', 'uiVerification', 'apiVerification'].includes(g));
    if (hasTestingGates && config.testing?.enabled) {
      console.log(color('yellow', '  Note: No verification profile found. Run --setup to auto-detect project test infrastructure.'));
      console.log('');
    }
  }

  // Cache outstanding findings — shared by outstandingFindings and preRelease gates
  let cachedOutstandingFindings = null;
  function getOutstandingFindings() {
    if (!cachedOutstandingFindings) {
      cachedOutstandingFindings = checkOutstandingFindings();
    }
    return cachedOutstandingFindings;
  }

  // Build shared context for gate handlers
  const ctx = {
    taskId,
    taskType,
    normalizedType,
    config,
    gates,
    spawnSync,
    getModifiedFiles,
    truncateOutput,
    fileExists,
    readFile,
    readJson,
    safeJsonParse,
    safeJsonParseString,
    validateTaskId,
    color,
    success,
    warn,
    error,
    verificationProfile,
    getOutstandingFindings,
  };

  const failed = [];
  const errors = {};

  for (const gate of gates) {
    const result = runGate(gate, ctx);

    if (!result.passed) {
      failed.push(gate);
      if (result.errorOutput) {
        errors[gate] = result.errorOutput;
      }
    }

    // Handle sub-gates (e.g., removalImpact from integrationWiring)
    if (result.subGates) {
      for (const [subName, subResult] of Object.entries(result.subGates)) {
        if (!subResult.passed) {
          failed.push(subName);
          if (subResult.errorOutput) {
            errors[subName] = subResult.errorOutput;
          }
        }
      }
    }
  }

  printFailureSummary(failed);
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

// Cascade completion functions imported from ./flow-cascade-completion (see require at top)

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

  // Look up task type for type-specific quality gates
  const preGateTask = findTask(taskId);
  const taskTypeForGates = preGateTask?.task?.type ?? 'feature';

  // Run quality gates (type-aware since v1.9.1)
  const gateResult = runQualityGates(taskId, taskTypeForGates);

  if (!gateResult.passed) {
    saveFailureArtifact(taskId, gateResult.failed, gateResult.errors);
    printErrorRecoveryAnalysis(gateResult, doneConfig);
    printFinalFailureMessage();
    process.exit(1);
  }

  // Write gate latch — proves quality gates passed for this task.
  // The TaskCompleted hook checks this latch before allowing completion.
  // Without it, agents can call TaskUpdate and bypass all gates.
  try {
    const { setGateLatch } = require('./flow-gate-latch');
    const gates = getConfig().qualityGates?.[taskTypeForGates]?.require
      ?? getConfig().qualityGates?.feature?.require ?? [];
    setGateLatch(taskId, gates);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-done] Gate latch write failed: ${err.message}`);
    }
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

  success(`Completed: ${taskId}`);

  // wf-39e9dc09 Phase 1 — mark task-just-completed so the next Stop-hook
  // invocation can trigger a session restart when taskBoundaryReset is on
  // and the wogi-claude wrapper is running. Safe no-op otherwise (the marker
  // is cheap; Phase 2 checks preconditions before acting on it).
  try {
    const { markRestartPending } = require('./hooks/core/task-boundary-reset');
    markRestartPending({
      taskId,
      source: 'flow-done'
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-done] markRestartPending failed (non-fatal): ${err.message}`);
    }
  }

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
          todoStats.criteria.forEach((c, _i) => {
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
          const today = getTodayDate();
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
                // Route through orchestrator for locking and dedup
                try {
                  const { writeToFeedbackPatterns: writeFP } = require('./flow-learning-orchestrator');
                  writeFP({ content: newContent, entryText: 'high-refinement-request', caller: 'flow-done/highRefinementFlag' }).catch(() => {});
                } catch (_err) { /* fallback: already computed newContent but orchestrator unavailable */ }
              }
            }
          }

          warn(`High-refinement pattern flagged (${learningResult.refinementCount} clarifications needed)`);
          console.log(color('dim', 'Consider adding clearer guidance to decisions.md'));
        } catch (err) {
          if (process.env.DEBUG) console.error(`[DEBUG] High-refinement flagging: ${err.message}`);
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
          const allTasks = [...(readyData.ready ?? []), ...(readyData.inProgress ?? []), ...(readyData.recentlyCompleted ?? [])];
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
    const taskType = result.task?.type ?? 'story';
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
      warn('️  Found files in .workflow/changes/ that don\'t follow naming convention:');
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
  const scanOn = config.componentIndex?.scanOn ?? [];
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
  const funcScanOn = config.functionRegistry?.scanOn ?? [];
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
  const apiScanOn = config.apiRegistry?.scanOn ?? [];
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

// Test-only exports — not part of public API
if (process.env.NODE_ENV === 'test') {
  module.exports = {
    _test: {
      runQualityGates,
      getModifiedFiles,
      checkOutstandingFindings,
      _cp, // Allows tests to swap spawnSync/execSync
      _io  // Allows tests to swap getConfig/fileExists/readFile/etc.
    }
  };
} else {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
