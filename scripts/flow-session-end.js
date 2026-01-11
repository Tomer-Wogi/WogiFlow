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

// v1.8.0 automatic memory management
let memoryDb = null;
try {
  memoryDb = require('./flow-memory-db');
} catch (err) {
  // Memory module not available
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

  // Handle uncommitted changes
  await handleUncommittedChanges();

  // Update progress
  updateProgress();

  // Extract skill learnings
  extractSkillLearnings();

  // v1.7.0: Save session summary
  saveSessionSummaryToState();

  // v1.7.0: Auto-archive request log
  archiveRequestLogIfNeeded();

  // v1.7.0: Show context health
  showContextHealthSummary();

  // v1.8.0: Automatic memory management
  await automaticMemoryManagement();

  console.log('');

  // Offer to push
  await offerPush();

  // Show summary
  showSummary();
}

main().catch(e => {
  console.error(console.error('Error:', err.message));
  process.exit(1);
});
