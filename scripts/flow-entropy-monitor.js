#!/usr/bin/env node

/**
 * Wogi Flow - Memory Entropy Monitor
 *
 * Monitors memory health and triggers automatic cleanup when needed.
 *
 * Commands:
 *   ./scripts/flow entropy          - Show entropy stats
 *   ./scripts/flow entropy --auto   - Auto-compact if entropy > threshold
 *   ./scripts/flow entropy --decay  - Apply relevance decay
 *   ./scripts/flow entropy --history - Show entropy history
 *
 * Part of v1.8.0 - Automatic Memory Management
 */

const fs = require('fs');
const path = require('path');
const memoryDb = require('./flow-memory-db');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = process.env.WOGI_PROJECT_ROOT || process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

// ============================================================
// Output Formatting
// ============================================================

function color(c, text) {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    reset: '\x1b[0m'
  };
  return `${colors[c] || ''}${text}${colors.reset}`;
}

function formatEntropy(entropy) {
  if (entropy < 0.4) return color('green', `${entropy} (healthy)`);
  if (entropy < 0.7) return color('yellow', `${entropy} (moderate)`);
  return color('red', `${entropy} (needs cleanup)`);
}

function formatStatus(status) {
  switch (status) {
    case 'healthy': return color('green', 'HEALTHY');
    case 'moderate': return color('yellow', 'MODERATE');
    case 'needs_cleanup': return color('red', 'NEEDS CLEANUP');
    default: return status;
  }
}

function formatPercent(value, max) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  return `${bar} ${pct}%`;
}

// ============================================================
// Commands
// ============================================================

/**
 * Show entropy statistics
 */
async function showEntropy(config) {
  const memoryConfig = {
    maxLocalFacts: config.memory?.maxLocalFacts || 1000
  };

  const stats = await memoryDb.getEntropyStats(memoryConfig);

  console.log(color('cyan', '\nMemory Entropy Report'));
  console.log('═'.repeat(50));

  console.log(`\nStatus: ${formatStatus(stats.status)}`);
  console.log(`Entropy Score: ${formatEntropy(stats.entropy)}`);

  console.log(`\n${color('blue', 'Facts')}`);
  console.log(`  Active:     ${stats.totalFacts}/${stats.maxFacts}`);
  console.log(`  Capacity:   ${formatPercent(stats.totalFacts, stats.maxFacts)}`);
  console.log(`  Cold:       ${stats.coldFacts} (archived)`);

  console.log(`\n${color('blue', 'Health Metrics')}`);
  console.log(`  Avg Relevance:    ${Math.round(stats.avgRelevance * 100)}%`);
  console.log(`  Never Accessed:   ${stats.neverAccessed} (${Math.round((stats.neverAccessed / Math.max(1, stats.totalFacts)) * 100)}%)`);
  console.log(`  Low Relevance:    ${stats.lowRelevanceCount} (<30%)`);
  console.log(`  Avg Age:          ${stats.avgAgeDays} days`);

  console.log(`\n${color('blue', 'Entropy Components')}`);
  console.log(`  Capacity (30%):      ${Math.round(Math.min(1, stats.totalFacts / stats.maxFacts) * 100)}%`);
  console.log(`  Age (20%):           ${Math.round(Math.min(1, stats.avgAgeDays / 30) * 100)}%`);
  console.log(`  Never Accessed (25%):${Math.round((stats.totalFacts > 0 ? stats.neverAccessed / stats.totalFacts : 0) * 100)}%`);
  console.log(`  Low Relevance (25%): ${Math.round((stats.totalFacts > 0 ? stats.lowRelevanceCount / stats.totalFacts : 0) * 100)}%`);

  if (stats.needsCompaction) {
    console.log(`\n${color('yellow', '⚠ Memory needs compaction')}`);
    console.log(`  Run: ${color('cyan', './scripts/flow compact-memory')}`);
    console.log(`  Or:  ${color('cyan', './scripts/flow entropy --auto')}`);
  }

  console.log('');

  return stats;
}

/**
 * Apply relevance decay to all facts
 */
async function applyDecay(config) {
  const decayConfig = {
    decayRate: config.automaticMemory?.relevanceDecay?.decayRate || 0.033,
    neverAccessedPenalty: config.automaticMemory?.relevanceDecay?.neverAccessedPenalty || 0.1
  };

  console.log(color('cyan', '\nApplying Relevance Decay'));
  console.log('═'.repeat(50));

  const beforeStats = await memoryDb.getEntropyStats();
  console.log(`Before: Avg Relevance = ${Math.round(beforeStats.avgRelevance * 100)}%`);

  const result = await memoryDb.applyRelevanceDecay(decayConfig);
  console.log(`Decayed ${result.decayed} facts`);

  const afterStats = await memoryDb.getEntropyStats();
  console.log(`After:  Avg Relevance = ${Math.round(afterStats.avgRelevance * 100)}%`);

  // Record metric
  await memoryDb.recordMemoryMetric('decay');

  console.log(color('green', '\n✓ Relevance decay applied'));
}

/**
 * Auto-compact memory if entropy exceeds threshold
 */
async function autoCompact(config) {
  const threshold = config.automaticMemory?.entropyThreshold || 0.7;
  const memoryConfig = {
    maxLocalFacts: config.memory?.maxLocalFacts || 1000
  };

  console.log(color('cyan', '\nAuto-Compact Check'));
  console.log('═'.repeat(50));

  const stats = await memoryDb.getEntropyStats(memoryConfig);
  console.log(`Current Entropy: ${formatEntropy(stats.entropy)}`);
  console.log(`Threshold:       ${threshold}`);

  if (stats.entropy < threshold) {
    console.log(color('green', '\n✓ Memory is healthy, no compaction needed'));
    return { compacted: false, reason: 'below_threshold' };
  }

  console.log(color('yellow', '\n⚠ Entropy exceeds threshold, starting compaction...'));

  const results = {
    decay: null,
    demotion: null,
    merge: null,
    purge: null
  };

  // 1. Apply relevance decay
  console.log('\n1. Applying relevance decay...');
  results.decay = await memoryDb.applyRelevanceDecay({
    decayRate: config.automaticMemory?.relevanceDecay?.decayRate || 0.033,
    neverAccessedPenalty: config.automaticMemory?.relevanceDecay?.neverAccessedPenalty || 0.1
  });
  console.log(`   Decayed: ${results.decay.decayed} facts`);

  // 2. Demote low-relevance facts
  console.log('\n2. Demoting low-relevance facts...');
  results.demotion = await memoryDb.demoteToColdStorage({
    relevanceThreshold: config.automaticMemory?.demotion?.relevanceThreshold || 0.3
  });
  console.log(`   Demoted: ${results.demotion.demoted} facts`);

  // 3. Merge similar facts
  console.log('\n3. Merging duplicate facts...');
  results.merge = await memoryDb.mergeSimilarFacts({
    mergeSimilarityThreshold: 0.95
  });
  console.log(`   Merged: ${results.merge.merged} duplicates`);

  // 4. Purge old cold facts
  console.log('\n4. Purging old cold storage...');
  results.purge = await memoryDb.purgeColdFacts({
    coldRetentionDays: config.automaticMemory?.demotion?.coldRetentionDays || 90
  });
  console.log(`   Purged: ${results.purge.purged} facts`);

  // Record metric
  await memoryDb.recordMemoryMetric('auto_compact');

  // Show after stats
  const afterStats = await memoryDb.getEntropyStats(memoryConfig);

  console.log(color('cyan', '\nCompaction Results'));
  console.log('═'.repeat(50));
  console.log(`Entropy: ${formatEntropy(stats.entropy)} → ${formatEntropy(afterStats.entropy)}`);
  console.log(`Facts:   ${stats.totalFacts} → ${afterStats.totalFacts}`);
  console.log(`Cold:    ${stats.coldFacts} → ${afterStats.coldFacts}`);

  console.log(color('green', '\n✓ Memory compaction complete'));

  return {
    compacted: true,
    before: stats,
    after: afterStats,
    results
  };
}

/**
 * Show entropy history
 */
async function showHistory(limit = 30) {
  console.log(color('cyan', '\nEntropy History'));
  console.log('═'.repeat(70));

  const metrics = await memoryDb.getMemoryMetrics(limit);

  if (metrics.length === 0) {
    console.log(color('gray', 'No history available yet.'));
    return;
  }

  console.log(`${'Timestamp'.padEnd(20)} ${'Facts'.padEnd(8)} ${'Entropy'.padEnd(10)} ${'Action'}`);
  console.log('-'.repeat(70));

  for (const m of metrics) {
    const ts = m.timestamp?.substring(0, 19) || 'N/A';
    const facts = String(m.total_facts || 0).padEnd(8);
    const entropy = String(m.entropy_score || 0).padEnd(10);
    const action = m.action_taken || '-';

    const entropyColor = m.entropy_score < 0.4 ? 'green' : m.entropy_score < 0.7 ? 'yellow' : 'red';

    console.log(`${ts.padEnd(20)} ${facts} ${color(entropyColor, entropy)} ${action}`);
  }

  console.log('');
}

/**
 * Show promotion candidates
 */
async function showPromotionCandidates(config) {
  console.log(color('cyan', '\nPromotion Candidates'));
  console.log('═'.repeat(70));

  const candidates = await memoryDb.getPromotionCandidates({
    minRelevance: config.automaticPromotion?.minRelevance || 0.8,
    minAccessCount: config.automaticPromotion?.threshold || 3
  });

  if (candidates.length === 0) {
    console.log(color('gray', 'No facts ready for promotion.'));
    console.log('Facts need high relevance (80%+) and multiple accesses (3+).\n');
    return [];
  }

  console.log(`Found ${color('green', candidates.length)} candidates:\n`);

  for (const c of candidates.slice(0, 10)) {
    const relevance = Math.round((c.relevance_score || 0) * 100);
    console.log(`  ${color('green', '●')} [${relevance}%] (${c.access_count}x) ${c.fact.substring(0, 60)}...`);
    console.log(`    Category: ${c.category || 'general'} | Scope: ${c.scope || 'local'}`);
  }

  if (candidates.length > 10) {
    console.log(color('gray', `\n  ... and ${candidates.length - 10} more`));
  }

  console.log('');
  return candidates;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  try {
    if (args.includes('--auto')) {
      await autoCompact(config);
    } else if (args.includes('--decay')) {
      await applyDecay(config);
    } else if (args.includes('--history')) {
      const limit = parseInt(args[args.indexOf('--history') + 1]) || 30;
      await showHistory(limit);
    } else if (args.includes('--candidates')) {
      await showPromotionCandidates(config);
    } else if (args.includes('--help') || args.includes('-h')) {
      console.log(`
${color('cyan', 'Memory Entropy Monitor')}

Usage: ./scripts/flow entropy [options]

Options:
  (none)        Show entropy statistics
  --auto        Auto-compact if entropy > threshold
  --decay       Apply relevance decay to all facts
  --history [n] Show entropy history (last n entries, default 30)
  --candidates  Show facts ready for promotion
  --help, -h    Show this help

Examples:
  ./scripts/flow entropy              # Show current status
  ./scripts/flow entropy --auto       # Auto-compact if needed
  ./scripts/flow entropy --history 10 # Show last 10 metrics
`);
    } else {
      await showEntropy(config);
    }
  } catch (err) {
    console.error(color('red', `Error: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    memoryDb.closeDatabase();
  }
}

main();
