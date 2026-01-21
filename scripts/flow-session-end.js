#!/usr/bin/env node

/**
 * Wogi Flow - End Session Properly
 *
 * Ensures all workflow state is saved, optionally commits and pushes.
 */

const { execSync, execFileSync, spawnSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  getConfig,
  getConfigValue,
  readFile,
  writeFile,
  isGitRepo,
  getGitStatus,
  color,
  printSection,
  success,
  warn
} = require('./flow-utils');

// v1.7.0 context memory management
const { showContextBreakdown, checkContextHealth } = require('./flow-context-monitor');
const { resetSessionContext, getSessionContext, writeMemoryBlocks, readMemoryBlocks } = require('./flow-memory-blocks');
const { saveSessionSummary, loadSessionState } = require('./flow-session-state');
const { autoArchiveIfNeeded, getLogStats } = require('./flow-log-manager');

// v2.5.0 stale task cleanup
const { getReadyData, saveReadyData } = require('./flow-utils');

// v1.8.0 automatic memory management
let memoryDb = null;
try {
  memoryDb = require('./flow-memory-db');
} catch (err) {
  // Memory module not available
}

// v2.4.0 session learning analysis
let sessionLearning = null;
try {
  sessionLearning = require('./flow-session-learning');
} catch (err) {
  // Session learning module not available
}

// v2.6.0 model selection persistence
let modelConfig = null;
try {
  modelConfig = require('./flow-model-config');
} catch (err) {
  // Model config module not available
}

/**
 * Prompt user for input
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Check session-end requirements from config
 */
function checkRequirements() {
  if (!fileExists(PATHS.config)) return;

  console.log(color('yellow', 'Checking session-end requirements...'));

  const config = getConfig();
  const steps = config.mandatorySteps?.onSessionEnd || [];

  if (steps.length > 0) {
    console.log('Required:');
    for (const step of steps) {
      console.log(`  • ${step}`);
    }
  }

  console.log('');
}

/**
 * Handle uncommitted changes
 */
async function handleUncommittedChanges() {
  const git = getGitStatus();

  if (!git.isRepo) return;

  if (git.uncommitted > 0) {
    console.log(color('yellow', `Uncommitted changes: ${git.uncommitted} files`));

    try {
      const status = execSync('git status --short', { encoding: 'utf-8' });
      console.log(status);
    } catch {
      // Ignore
    }

    const confirm = await prompt('Commit all changes? (y/N) ');

    if (confirm.toLowerCase() === 'y') {
      const msg = await prompt('Commit message: ');
      const commitMsg = msg || 'checkpoint: end of session';

      try {
        execSync('git add -A', { stdio: 'pipe' });
        // Use execFileSync to prevent command injection from commit message
        execFileSync('git', ['commit', '-m', commitMsg], { stdio: 'pipe' });
        success('Changes committed');
      } catch (err) {
        warn(`Commit failed: ${err.message}`);
      }
    }
  } else {
    success('No uncommitted changes');
  }

  console.log('');
}

/**
 * Update progress.md timestamp
 */
function updateProgress() {
  if (!fileExists(PATHS.progress)) return;

  console.log(color('yellow', 'Updating progress.md...'));

  try {
    let content = readFile(PATHS.progress);
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Update or add timestamp
    if (content.includes('## Last Updated')) {
      content = content.replace(/## Last Updated.*(\n|$)/, `## Last Updated\n${timestamp}\n`);
    } else {
      content = `## Last Updated\n${timestamp}\n\n${content}`;
    }

    writeFile(PATHS.progress, content);
    success('Progress updated');
  } catch (err) {
    warn(`Failed to update progress: ${err.message}`);
  }
}

/**
 * Extract skill learnings if configured
 */
function extractSkillLearnings() {
  if (!fileExists(PATHS.config)) return;

  const skillLearning = getConfigValue('skillLearning', {});

  if (skillLearning.enabled && skillLearning.autoExtract) {
    console.log('');
    console.log(color('yellow', 'Extracting skill learnings...'));

    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-skill-learn.js');
    if (fileExists(scriptPath)) {
      const result = spawnSync('node', [scriptPath, '--trigger=session-end'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status === 0) {
        success('Skills updated');
      }
    }
  }
}

/**
 * Analyze session for learnings (v2.4.0)
 */
function analyzeSessionForLearnings() {
  if (!sessionLearning) return;

  const config = getConfig();
  const sessionLearningConfig = config.sessionLearning || {};

  // Check if enabled (default: true)
  if (sessionLearningConfig.enabled === false) return;

  try {
    console.log('');
    console.log(color('yellow', 'Analyzing session for learnings...'));

    const result = sessionLearning.analyzeSessionLearnings({
      display: true,
      apply: true
    });

    if (result.learnings && result.learnings.length > 0) {
      if (result.applied && result.applied.length > 0) {
        success(`Applied ${result.applied.length} high-confidence learning(s)`);
      }
      if (result.skipped && result.skipped.length > 0) {
        console.log(color('dim', `${result.skipped.length} pattern(s) noted for observation`));
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Session learning: ${err.message}`);
  }
}

/**
 * Offer to push to remote
 */
async function offerPush() {
  if (!isGitRepo()) return;

  try {
    execSync('git remote get-url origin', { stdio: 'pipe' });

    const confirm = await prompt('Push to remote? (y/N) ');

    if (confirm.toLowerCase() === 'y') {
      execSync('git push', { stdio: 'inherit' });
      success('Pushed to remote');
    }
  } catch {
    // No remote configured, skip
  }
}

/**
 * v1.7.0: Save session summary to state
 */
function saveSessionSummaryToState() {
  console.log('');
  console.log(color('yellow', 'Saving session state...'));

  try {
    const sessionState = loadSessionState();
    const memoryBlocks = readMemoryBlocks();

    // Build summary from session data
    const summary = {
      tasksCompleted: sessionState.metrics?.tasksCompleted || 0,
      filesModified: sessionState.recentFiles?.slice(0, 5) || [],
      decisions: sessionState.recentDecisions?.map(d => d.decision).slice(0, 3) || [],
      summary: memoryBlocks?.keyFacts?.slice(-3).join('; ') || 'Session ended'
    };

    saveSessionSummary(summary);
    success('Session state saved');
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Session save: ${err.message}`);
    warn('Could not save session state');
  }
}

/**
 * v2.6.0: Clear session model selections
 * Resets peer review and hybrid model choices for next session
 */
function clearSessionModelSelections() {
  if (!modelConfig) return;

  try {
    if (modelConfig.hasSessionModels('peerReview') || modelConfig.hasSessionModels('hybrid')) {
      modelConfig.clearSessionModels();
      if (process.env.DEBUG) {
        console.log(color('dim', '  Cleared session model selections'));
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Clear models: ${err.message}`);
  }
}

/**
 * v1.7.0: Archive request log if threshold exceeded
 */
function archiveRequestLogIfNeeded() {
  try {
    const result = autoArchiveIfNeeded();
    if (result && result.archived > 0) {
      console.log('');
      success(`Archived ${result.archived} request log entries`);
      console.log(color('dim', `  Archive: ${result.archivePath}`));
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Archive: ${err.message}`);
  }
}

/**
 * v1.7.0: Show context health summary
 */
function showContextHealthSummary() {
  try {
    const health = checkContextHealth();
    if (health.status !== 'disabled') {
      console.log('');
      console.log(color('yellow', 'Context health:'));
      const statusColor = health.status === 'healthy' ? 'green'
        : health.status === 'warning' ? 'yellow' : 'red';
      console.log(`  Status: ${color(statusColor, health.status.toUpperCase())} (${health.usagePercent}%)`);

      if (health.recommendation) {
        console.log(`  ${color(statusColor, health.recommendation)}`);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Context health: ${err.message}`);
  }
}

/**
 * v1.8.0: Automatic memory management
 * Part of automatic memory management for teams
 */
async function automaticMemoryManagement() {
  if (!memoryDb) return;

  const config = getConfig();
  const memConfig = config.automaticMemory || {};

  if (!memConfig.enabled) return;

  console.log('');
  console.log(color('yellow', 'Automatic memory management:'));

  try {
    // 1. Apply relevance decay
    if (memConfig.relevanceDecay?.enabled !== false) {
      const decayResult = await memoryDb.applyRelevanceDecay({
        decayRate: memConfig.relevanceDecay?.decayRate || 0.033,
        neverAccessedPenalty: memConfig.relevanceDecay?.neverAccessedPenalty || 0.1
      });
      if (decayResult.decayed > 0) {
        console.log(`  Relevance decay: ${decayResult.decayed} facts updated`);
      }
    }

    // 2. Check entropy and compact if needed
    const memoryConfig = { maxLocalFacts: config.memory?.maxLocalFacts || 1000 };
    const entropy = await memoryDb.getEntropyStats(memoryConfig);

    const threshold = memConfig.entropyThreshold || 0.7;
    const statusColor = entropy.status === 'healthy' ? 'green'
      : entropy.status === 'moderate' ? 'yellow' : 'red';

    console.log(`  Entropy: ${color(statusColor, entropy.entropy)} (${entropy.status})`);
    console.log(`  Facts: ${entropy.totalFacts}/${entropy.maxFacts} | Cold: ${entropy.coldFacts}`);

    if (entropy.needsCompaction && memConfig.compactOnSessionEnd) {
      console.log(color('yellow', '  Auto-compacting memory...'));

      // Demote low-relevance facts
      const demotion = await memoryDb.demoteToColdStorage({
        relevanceThreshold: memConfig.demotion?.relevanceThreshold || 0.3
      });
      if (demotion.demoted > 0) {
        console.log(`    Demoted: ${demotion.demoted} facts`);
      }

      // Merge duplicates
      const merge = await memoryDb.mergeSimilarFacts({ mergeSimilarityThreshold: 0.95 });
      if (merge.merged > 0) {
        console.log(`    Merged: ${merge.merged} duplicates`);
      }

      // Purge old cold facts
      const purge = await memoryDb.purgeColdFacts({
        coldRetentionDays: memConfig.demotion?.coldRetentionDays || 90
      });
      if (purge.purged > 0) {
        console.log(`    Purged: ${purge.purged} old facts`);
      }
    }

    // 3. Check for promotion candidates and auto-promote if enabled
    const promoConfig = config.automaticPromotion || {};
    if (promoConfig.enabled) {
      const candidates = await memoryDb.getPromotionCandidates({
        minRelevance: promoConfig.minRelevance || 0.8,
        minAccessCount: promoConfig.threshold || 3
      });

      const unpromoted = candidates.filter(c => !c.promoted_to);
      if (unpromoted.length > 0) {
        console.log(`  ${color('cyan', `${unpromoted.length} pattern(s) ready for promotion`)}`);

        // Auto-promote if approval not required
        if (!promoConfig.requireApproval) {
          try {
            const memorySync = require('./flow-memory-sync');
            if (memorySync && typeof memorySync.autoPromote === 'function') {
              const result = await memorySync.autoPromote(config);
              if (result.promoted > 0) {
                console.log(`  ${color('green', `Auto-promoted ${result.promoted} pattern(s) to decisions.md`)}`);
              }
            } else {
              // Fallback: tell user to run manually
              console.log('    Run: ./scripts/flow memory-sync --auto');
            }
          } catch (err) {
            // Module not available or error, fall back to manual
            console.log('    Run: ./scripts/flow memory-sync --auto');
          }
        } else {
          console.log('    Run: ./scripts/flow memory-sync --auto (approval required)');
        }
      }
    }

    // 4. Record metric
    await memoryDb.recordMemoryMetric('session_end');

    success('Memory management complete');

  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Memory management: ${err.message}`);
    warn('Memory management skipped');
  } finally {
    try {
      memoryDb.closeDatabase();
    } catch {}
  }
}

/**
 * Offer knowledge sync if drifted (v1.9.1)
 */
async function offerKnowledgeSync() {
  const config = getConfig();
  const morningConfig = config.morningBriefing || {};

  // Skip if disabled or if auto-regenerate handled it in morning
  if (morningConfig.checkKnowledgeSync === false) {
    return;
  }

  try {
    const { checkAllDrift, markAsSynced } = require('./flow-knowledge-sync');
    const driftStatus = checkAllDrift();

    if (!driftStatus.anyDrift) {
      return; // All synced
    }

    console.log('');
    console.log(color('cyan', '╔══════════════════════════════════════════════════════════╗'));
    console.log(color('cyan', '║  Knowledge Sync Check                                     ║'));
    console.log(color('cyan', '╚══════════════════════════════════════════════════════════╝'));
    console.log('');

    console.log('Knowledge files are out of sync:');
    for (const [category, status] of Object.entries(driftStatus.categories)) {
      if (status.status === 'drifted') {
        console.log(`  ${color('yellow', '•')} ${category}.md - ${status.reason}`);
      }
    }
    console.log('');

    const answer = await prompt('Regenerate now? (y/N): ');
    if (answer.toLowerCase() === 'y') {
      try {
        const { spawnSync } = require('child_process');
        const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-onboard');
        console.log(color('dim', 'Regenerating knowledge files...'));

        const result = spawnSync('node', [scriptPath, '--update-knowledge'], {
          cwd: PROJECT_ROOT,
          stdio: 'pipe',
          timeout: 30000
        });

        if (result.status === 0) {
          markAsSynced();
          success('Knowledge files regenerated');
        } else {
          warn('Could not regenerate - run: flow knowledge-sync regenerate');
        }
      } catch (err) {
        warn(`Regeneration failed: ${err.message}`);
      }
    } else {
      console.log(color('dim', 'Skipped - run: flow knowledge-sync regenerate'));
    }
  } catch {
    // Knowledge sync not available - skip silently
  }
}

/**
 * Offer tech debt cleanup (v1.9.0)
 */
async function offerDebtCleanup() {
  const config = getConfig();
  const techDebtConfig = config.techDebt || {};

  if (!techDebtConfig.promptOnSessionEnd) {
    return;
  }

  try {
    const { TechDebtManager } = require('./flow-tech-debt');
    const manager = new TechDebtManager();
    const stats = manager.getStats();

    if (stats.totalOpen === 0) {
      return; // No debt to clean up
    }

    console.log('');
    console.log(color('cyan', '╔══════════════════════════════════════════════════════════╗'));
    console.log(color('cyan', '║  Technical Debt Check                                     ║'));
    console.log(color('cyan', '╚══════════════════════════════════════════════════════════╝'));
    console.log('');

    // Summary
    const severityParts = [];
    if (stats.bySeverity.critical > 0) severityParts.push(color('red', `${stats.bySeverity.critical} critical`));
    if (stats.bySeverity.high > 0) severityParts.push(color('yellow', `${stats.bySeverity.high} high`));
    if (stats.bySeverity.medium > 0) severityParts.push(color('blue', `${stats.bySeverity.medium} medium`));
    if (stats.bySeverity.low > 0) severityParts.push(color('dim', `${stats.bySeverity.low} low`));

    console.log(`You have ${color('bold', stats.totalOpen)} open debt items:`);
    console.log(`  ${severityParts.join(', ')}`);

    if (stats.autoFixable > 0) {
      console.log(`  ${color('green', '✓')} ${stats.autoFixable} are auto-fixable`);
    }
    if (stats.agingCount > 0) {
      console.log(`  ${color('yellow', '⚠')} ${stats.agingCount} have been aging (3+ sessions)`);
    }

    console.log('');
    console.log('Would you like to address some debt?');
    console.log('');
    if (stats.autoFixable > 0) {
      console.log(`  ${color('cyan', '[1]')} Quick fixes only (${stats.autoFixable} items)`);
      console.log(`      ${color('dim', 'Auto-fix: remove console.logs, unused imports')}`);
    }
    if (stats.agingCount > 0) {
      console.log(`  ${color('cyan', '[2]')} Aging issues (${stats.agingCount} items)`);
      console.log(`      ${color('dim', 'Items persisting 3+ sessions')}`);
    }
    console.log(`  ${color('cyan', '[3]')} Full cleanup (${stats.totalOpen} items)`);
    console.log(`      ${color('dim', 'Address all open debt')}`);
    console.log(`  ${color('cyan', '[4]')} Skip for now`);
    console.log('');

    const choice = await prompt('Choice [4]: ');

    switch (choice.trim()) {
      case '1':
        if (stats.autoFixable > 0) {
          console.log('');
          console.log(color('cyan', 'Running auto-fixes...'));
          const result = manager.runAutoFix();
          if (result.fixed > 0) {
            success(`Fixed ${result.fixed} issues`);
            for (const file of result.files) {
              console.log(`  ${color('dim', file)}`);
            }
          }
          if (result.failed > 0) {
            warn(`Could not fix ${result.failed} issues`);
          }
        }
        break;

      case '2':
        if (stats.agingCount > 0) {
          console.log('');
          console.log(color('cyan', 'Aging items need manual review:'));
          const aging = manager.getAgingIssues();
          for (const issue of aging) {
            console.log(`  ${color('dim', `[${issue.id}]`)} ${issue.file}:${issue.line}`);
            console.log(`      ${issue.description}`);
          }
          console.log('');
          console.log(color('dim', 'Run /wogi-debt promote <id> to create a task from any item.'));
        }
        break;

      case '3':
        console.log('');
        console.log(color('cyan', 'All open debt items:'));
        const all = manager.getOpenIssues();
        for (const issue of all) {
          const severityColor = issue.severity === 'critical' ? 'red' : issue.severity === 'high' ? 'yellow' : 'dim';
          console.log(`  ${color('dim', `[${issue.id}]`)} ${issue.file}:${issue.line} ${color(severityColor, `(${issue.severity})`)}`);
          console.log(`      ${issue.description}`);
        }
        console.log('');
        console.log(color('dim', 'Run /wogi-debt fix to auto-fix safe items, or /wogi-debt promote <id> to create tasks.'));
        break;

      case '4':
      default:
        console.log(color('dim', 'Skipping debt cleanup.'));
        break;
    }
  } catch {
    // Tech debt manager not available - skip silently
  }
}

/**
 * v2.5.0: Clean up stale auto-created tasks
 *
 * Detects auto-created tasks that have no uncommitted changes
 * and offers to close them.
 */
async function cleanupStaleTasks() {
  try {
    const readyData = getReadyData();
    const inProgress = readyData.inProgress || [];

    // Find auto-created tasks
    const autoCreatedTasks = inProgress.filter(task =>
      typeof task === 'object' && task.autoCreated === true
    );

    if (autoCreatedTasks.length === 0) return;

    // Check git status for uncommitted changes
    let uncommittedFiles = [];
    try {
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      uncommittedFiles = status.trim().split('\n')
        .filter(Boolean)
        .map(line => line.substring(3).trim()); // Remove status prefix
    } catch {
      // Not a git repo or git error, skip
      return;
    }

    // Find stale tasks (auto-created with no matching uncommitted files)
    const staleTasks = autoCreatedTasks.filter(task => {
      // Extract expected filename from title (e.g., "Fix flow-utils.js" -> "flow-utils.js")
      const match = task.title?.match(/^(?:Fix|Create|Update|Edit)\s+(.+)$/i);
      if (!match) return false;

      const expectedFilename = match[1].trim();

      // Check if any uncommitted file matches
      const hasUncommittedChanges = uncommittedFiles.some(file =>
        file.endsWith(expectedFilename) || path.basename(file) === expectedFilename
      );

      return !hasUncommittedChanges;
    });

    if (staleTasks.length === 0) return;

    // Show stale tasks and offer to close them
    console.log('');
    console.log(color('cyan', '╔══════════════════════════════════════════════════════════╗'));
    console.log(color('cyan', '║  Stale Auto-Created Tasks                                ║'));
    console.log(color('cyan', '╚══════════════════════════════════════════════════════════╝'));
    console.log('');

    console.log('Found auto-created tasks with no uncommitted changes:');
    for (const task of staleTasks) {
      const age = task.startedAt
        ? Math.round((Date.now() - new Date(task.startedAt).getTime()) / (1000 * 60 * 60))
        : 0;
      console.log(`  ${color('dim', `[${task.id}]`)} ${task.title} ${color('dim', `(${age}h old)`)}`);
    }
    console.log('');
    console.log(color('dim', 'These tasks may have been committed without being marked done.'));
    console.log('');

    const answer = await prompt(`Close ${staleTasks.length} stale task(s)? (Y/n): `);

    if (answer.toLowerCase() !== 'n') {
      // Close stale tasks
      for (const task of staleTasks) {
        // Remove from inProgress
        const index = readyData.inProgress.findIndex(t =>
          typeof t === 'object' && t.id === task.id
        );
        if (index !== -1) {
          readyData.inProgress.splice(index, 1);
        }

        // Add to recentlyCompleted
        const completedTask = {
          ...task,
          status: 'completed',
          completedAt: new Date().toISOString(),
          autoCompleted: true,
          completedBy: 'session-end-cleanup'
        };

        readyData.recentlyCompleted = readyData.recentlyCompleted || [];
        readyData.recentlyCompleted.unshift(completedTask);
        readyData.recentlyCompleted = readyData.recentlyCompleted.slice(0, 10);
      }

      saveReadyData(readyData);
      success(`Closed ${staleTasks.length} stale task(s)`);
    } else {
      console.log(color('dim', 'Skipped - tasks remain in progress'));
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Stale task cleanup: ${err.message}`);
  }
}

/**
 * Show status summary
 */
function showSummary() {
  console.log('');
  console.log(color('green', 'Session ended cleanly.'));
  console.log('');
  console.log('Summary:');

  const statusScript = path.join(PROJECT_ROOT, 'scripts', 'flow-status.js');
  if (fileExists(statusScript)) {
    try {
      spawnSync('node', [statusScript], {
        encoding: 'utf-8',
        stdio: 'inherit'
      });
    } catch {
      console.log("  (run 'flow status' for details)");
    }
  } else {
    console.log("  (run 'flow status' for details)");
  }
}

async function main() {
  printSection('Ending Session');
  console.log('===============');
  console.log('');

  // Check requirements
  checkRequirements();

  // v2.5.0: Clean up stale auto-created tasks first
  await cleanupStaleTasks();

  // Handle uncommitted changes
  await handleUncommittedChanges();

  // Update progress
  updateProgress();

  // Extract skill learnings
  extractSkillLearnings();

  // v2.4.0: Analyze session for learnings
  analyzeSessionForLearnings();

  // v1.7.0: Save session summary
  saveSessionSummaryToState();

  // v2.6.0: Clear session model selections
  clearSessionModelSelections();

  // v1.7.0: Auto-archive request log
  archiveRequestLogIfNeeded();

  // v1.7.0: Show context health
  showContextHealthSummary();

  // v1.8.0: Automatic memory management
  await automaticMemoryManagement();

  // v1.9.1: Offer knowledge sync if drifted
  await offerKnowledgeSync();

  // v1.9.0: Offer tech debt cleanup
  await offerDebtCleanup();

  console.log('');

  // Offer to push
  await offerPush();

  // Show summary
  showSummary();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
