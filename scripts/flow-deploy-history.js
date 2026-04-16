#!/usr/bin/env node

/**
 * Wogi Flow - Deploy History & Revert-First Protocol
 *
 * Tracks deploy history and implements the revert-first protocol
 * for production crashes. Part of Mechanical Enforcement Gates v3.0.
 *
 * Commands:
 *   flow deploy-history add <commit> [env]  — Record a deploy
 *   flow deploy-history show                — Show deploy history
 *   flow deploy-history last-good           — Show last known-good deploy
 *   flow deploy-history detect <text>       — Detect production crash keywords
 *
 * The revert-first protocol is a WORKFLOW MODIFICATION, not a blocking hook.
 * When a production crash is detected:
 *   1. Present the revert option with last-good commit
 *   2. If forward-fix chosen, reduce strike threshold
 *   3. Track the decision in state
 */

'use strict';

const path = require('node:path');
const { getConfig, PATHS, safeJsonParse, writeJson } = require('./flow-utils');
const { recordDeploy, getLastGoodDeploy, DEPLOY_HISTORY_PATH } = require('./hooks/core/deploy-gate');

// ============================================================
// Production Crash Detection
// ============================================================

/** Default keywords that suggest a production crash */
const DEFAULT_CRASH_KEYWORDS = [
  'production', 'crash', 'down', 'outage',
  '500 errors', "users can't", 'site is broken',
  'live issue', 'prod is broken', 'prod down',
  'users are seeing', 'in production', 'affecting users',
  'critical bug', 'service down', 'api down',
  'white screen in prod', 'deployment broke'
];

/**
 * Check if revert-first protocol is enabled
 * @param {Object} [config]
 * @returns {boolean}
 */
function isRevertFirstEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.revertFirst?.enabled === true;
}

/**
 * Get revert-first configuration
 * @param {Object} [config]
 * @returns {Object}
 */
function getRevertFirstConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.revertFirst ?? {};
  return {
    enabled: gate.enabled === true,
    keywords: gate.keywords ?? DEFAULT_CRASH_KEYWORDS,
    deployHistoryRetention: gate.deployHistoryRetention ?? 50,
    oldDeployWarningDays: gate.oldDeployWarningDays ?? 7
  };
}

/**
 * Detect if a bug description suggests a production crash.
 * @param {string} description - Bug report text
 * @param {Object} [config]
 * @returns {{ isProductionCrash: boolean, matchedKeywords: string[], confidence: 'high'|'medium'|'low' }}
 */
function detectProductionCrash(description, config) {
  const revertConfig = getRevertFirstConfig(config);
  if (!description) {
    return { isProductionCrash: false, matchedKeywords: [], confidence: 'low' };
  }

  const lower = description.toLowerCase();
  const matched = revertConfig.keywords.filter(kw => lower.includes(kw.toLowerCase()));

  let confidence = 'low';
  if (matched.length >= 3) confidence = 'high';
  else if (matched.length >= 1) confidence = 'medium';

  return {
    isProductionCrash: matched.length >= 1,
    matchedKeywords: matched,
    confidence
  };
}

/**
 * Generate the revert-first recommendation message.
 * Called by /wogi-bug when production crash is confirmed.
 * @param {Object} [options]
 * @param {boolean} [options.hasDeployHistory] - Whether deploy history exists
 * @returns {string} Formatted recommendation message
 */
function generateRevertRecommendation(_options) {
  const lastDeploy = getLastGoodDeploy();
  const revertConfig = getRevertFirstConfig();

  if (!lastDeploy.found) {
    return `━━━ REVERT-FIRST PROTOCOL ━━━

Production crash detected. No deploy history is tracked.

If you know the last good commit, provide it and I'll create a revert.
Otherwise, check your deployment platform for the last successful deploy hash.

Options:
  [1] Provide a commit hash to revert to
  [2] Forward-fix (reduced strike threshold — escalation after ${revertConfig.deployHistoryRetention} failures)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  const deploy = lastDeploy.deploy;
  const deployAge = Math.floor((Date.now() - new Date(deploy.timestamp).getTime()) / (1000 * 60 * 60 * 24));
  const isOld = deployAge > revertConfig.oldDeployWarningDays;

  let warnings = '';
  if (isOld) {
    warnings += `\n⚠️  Last deploy was ${deployAge} days ago. Reverting may remove recent features.`;
  }
  warnings += '\n⚠️  If the issue involves database migrations or data changes, revert may not help.';

  return `━━━ REVERT-FIRST PROTOCOL ━━━

Production crash detected.

Last successful deploy:
  Commit: ${deploy.commitHash}
  Date:   ${deploy.timestamp}
  Env:    ${deploy.environment}

RECOMMENDED: Revert to ${deploy.commitHash.slice(0, 8)} to restore service immediately,
then forward-fix on a branch.
${warnings}

Options:
  [1] Revert — \`git revert ${deploy.commitHash.slice(0, 8)}..HEAD\` (restores service now)
  [2] Forward-fix (strike threshold reduced — escalation after 2 failures)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Record the production crash decision (revert or forward-fix).
 * @param {string} taskId
 * @param {'revert'|'forward-fix'} decision
 * @param {string} [commitHash] - Revert target commit (if reverting)
 */
function recordCrashDecision(taskId, decision, commitHash) {
  const statePath = path.join(PATHS.state, 'crash-decisions.json');
  const decisions = safeJsonParse(statePath, { decisions: [] });

  decisions.decisions.unshift({
    taskId,
    decision,
    commitHash: commitHash ?? null,
    timestamp: new Date().toISOString()
  });

  // Keep last 20
  if (decisions.decisions.length > 20) {
    decisions.decisions = decisions.decisions.slice(0, 20);
  }

  writeJson(statePath, decisions);
}

// ============================================================
// CLI Commands
// ============================================================

function cmdAdd(commitHash, environment) {
  if (!commitHash) {
    console.error('Usage: flow deploy-history add <commit-hash> [environment]');
    process.exit(1);
  }
  recordDeploy({
    commitHash,
    environment: environment || 'production'
  });
  console.log(`✓ Recorded deploy: ${commitHash.slice(0, 8)} (${environment || 'production'})`);
}

function cmdShow() {
  const history = safeJsonParse(DEPLOY_HISTORY_PATH, { deploys: [] });
  console.log('━━━ Deploy History ━━━\n');
  if (history.deploys.length === 0) {
    console.log('No deploy history recorded.');
    console.log('Record deploys with: flow deploy-history add <commit-hash> [environment]');
    return;
  }
  for (const d of history.deploys.slice(0, 15)) {
    const age = Math.floor((Date.now() - new Date(d.timestamp).getTime()) / (1000 * 60 * 60));
    const ageStr = age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
    console.log(`  ${d.commitHash.slice(0, 8)} | ${d.environment.padEnd(12)} | ${d.timestamp} (${ageStr})`);
  }
  console.log(`\nTotal: ${history.deploys.length} deploys`);
}

function cmdLastGood() {
  const last = getLastGoodDeploy();
  if (!last.found) {
    console.log('No deploy history. Record with: flow deploy-history add <hash>');
    process.exit(1);
  }
  console.log(`Last known-good deploy:`);
  console.log(`  Commit: ${last.deploy.commitHash}`);
  console.log(`  Date:   ${last.deploy.timestamp}`);
  console.log(`  Env:    ${last.deploy.environment}`);
}

function cmdDetect(text) {
  if (!text) {
    console.error('Usage: flow deploy-history detect "<bug description>"');
    process.exit(1);
  }
  const result = detectProductionCrash(text);
  console.log(JSON.stringify(result, null, 2));
  if (result.isProductionCrash) {
    console.log('\n' + generateRevertRecommendation());
  }
}

// ============================================================
// CLI Entrypoint
// ============================================================

// CLI entrypoint (only when run directly)
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'add':
      cmdAdd(args[1], args[2]);
      break;
    case 'show':
      cmdShow();
      break;
    case 'last-good':
      cmdLastGood();
      break;
    case 'detect':
      cmdDetect(args.slice(1).join(' '));
      break;
    default:
      console.log('Usage: flow deploy-history <add|show|last-good|detect>');
      if (!command) process.exit(1);
  }
}

// ============================================================
// Exports (for programmatic use)
// ============================================================

module.exports = {
  isRevertFirstEnabled,
  getRevertFirstConfig,
  detectProductionCrash,
  generateRevertRecommendation,
  recordCrashDecision,
  recordDeploy
};
