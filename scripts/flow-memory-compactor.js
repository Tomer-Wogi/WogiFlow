#!/usr/bin/env node

/**
 * Wogi Flow - Memory Compactor
 *
 * Manages memory compaction: demotion, cold storage, merging, and purging.
 *
 * Commands:
 *   ./scripts/flow compact-memory           - Full compaction
 *   ./scripts/flow compact-memory --demote  - Only demote low-relevance facts
 *   ./scripts/flow compact-memory --merge   - Only merge duplicates
 *   ./scripts/flow compact-memory --purge   - Only purge old cold facts
 *   ./scripts/flow compact-memory --restore <id> - Restore from cold storage
 *   ./scripts/flow compact-memory --cold    - List cold storage contents
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
  if (entropy < 0.4) return color('green', `${entropy}`);
  if (entropy < 0.7) return color('yellow', `${entropy}`);
  return color('red', `${entropy}`);
}

// ============================================================
// Commands
// ============================================================

/**
 * Full compaction - all operations
 */
async function fullCompaction(config) {
  console.log(color('cyan', '\nMemory Compaction'));
  console.log('═'.repeat(50));

  const memoryConfig = { maxLocalFacts: config.memory?.maxLocalFacts || 1000 };
  const beforeStats = await memoryDb.getEntropyStats(memoryConfig);

  console.log(`\nBefore: ${beforeStats.totalFacts} facts | Entropy: ${formatEntropy(beforeStats.entropy)}`);

  const results = {};

  // 1. Apply relevance decay
  console.log(`\n${color('blue', '1. Applying relevance decay...')}`);
  results.decay = await memoryDb.applyRelevanceDecay({
    decayRate: config.automaticMemory?.relevanceDecay?.decayRate || 0.033,
    neverAccessedPenalty: config.automaticMemory?.relevanceDecay?.neverAccessedPenalty || 0.1
  });
  console.log(`   ${color('green', '✓')} Updated ${results.decay.decayed} facts`);

  // 2. Demote low-relevance facts
  console.log(`\n${color('blue', '2. Demoting low-relevance facts...')}`);
  results.demotion = await memoryDb.demoteToColdStorage({
    relevanceThreshold: config.automaticMemory?.demotion?.relevanceThreshold || 0.3
  });
  console.log(`   ${color('green', '✓')} Demoted ${results.demotion.demoted} facts to cold storage`);

  // 3. Merge similar facts
  console.log(`\n${color('blue', '3. Merging duplicate facts...')}`);
  results.merge = await memoryDb.mergeSimilarFacts({
    mergeSimilarityThreshold: 0.95
  });
  console.log(`   ${color('green', '✓')} Merged ${results.merge.merged} duplicate pairs`);

  // 4. Purge old cold facts
  console.log(`\n${color('blue', '4. Purging old cold storage...')}`);
  results.purge = await memoryDb.purgeColdFacts({
    coldRetentionDays: config.automaticMemory?.demotion?.coldRetentionDays || 90
  });
  console.log(`   ${color('green', '✓')} Purged ${results.purge.purged} old facts`);

  // 5. Extract high-value observations before purge
  const obsExtractConfig = config.automaticMemory?.observationExtraction || {};
  if (obsExtractConfig.enabled !== false) {
    console.log(`\n${color('blue', '5. Extracting solution knowledge from expiring observations...')}`);
    results.obsExtract = await memoryDb.purgeOldObservations(
      config.automaticMemory?.observationCapture?.retentionDays || 30,
      {
        minDurationMs: obsExtractConfig.minDurationMs || 100,
        excludeTools: obsExtractConfig.excludeTools || ['Read', 'Glob', 'Grep']
      }
    );
    console.log(`   ${color('green', '✓')} Extracted ${results.obsExtract.extracted} solution facts, purged ${results.obsExtract.purged} old observations`);
    if (results.obsExtract.rejectionPatterns > 0) {
      console.log(`   ${color('green', '✓')} Promoted ${results.obsExtract.rejectionPatterns} rejection patterns to facts`);
    }
  }

  // Record metric
  await memoryDb.recordMemoryMetric('full_compact');

  // Final stats
  const afterStats = await memoryDb.getEntropyStats(memoryConfig);

  console.log(color('cyan', '\n═══════════════════════════════════════════════════'));
  console.log(color('cyan', 'Summary'));
  console.log('═'.repeat(50));

  console.log(`\nActive Facts:  ${beforeStats.totalFacts} → ${afterStats.totalFacts}`);
  console.log(`Cold Storage:  ${beforeStats.coldFacts} → ${afterStats.coldFacts}`);
  console.log(`Entropy:       ${formatEntropy(beforeStats.entropy)} → ${formatEntropy(afterStats.entropy)}`);
  console.log(`Avg Relevance: ${Math.round(beforeStats.avgRelevance * 100)}% → ${Math.round(afterStats.avgRelevance * 100)}%`);
  if (results.obsExtract) {
    console.log(`Solutions:     ${results.obsExtract.extracted} extracted from observations`);
    if (results.obsExtract.rejectionPatterns > 0) {
      console.log(`Rejections:    ${results.obsExtract.rejectionPatterns} rejection patterns promoted`);
    }
  }

  console.log(color('green', '\n✓ Compaction complete\n'));

  return { before: beforeStats, after: afterStats, results };
}

/**
 * Demote only
 */
async function demoteOnly(config) {
  console.log(color('cyan', '\nDemoting Low-Relevance Facts'));
  console.log('═'.repeat(50));

  const threshold = config.automaticMemory?.demotion?.relevanceThreshold || 0.3;
  console.log(`Threshold: ${Math.round(threshold * 100)}% relevance\n`);

  const result = await memoryDb.demoteToColdStorage({ relevanceThreshold: threshold });

  if (result.demoted === 0) {
    console.log(color('green', '✓ No facts below threshold - nothing to demote\n'));
  } else {
    console.log(color('green', `✓ Demoted ${result.demoted} facts to cold storage\n`));
  }

  await memoryDb.recordMemoryMetric('demote');

  return result;
}

/**
 * Merge only
 */
async function mergeOnly() {
  console.log(color('cyan', '\nMerging Duplicate Facts'));
  console.log('═'.repeat(50));

  console.log('Similarity threshold: 95%\n');

  const result = await memoryDb.mergeSimilarFacts({ mergeSimilarityThreshold: 0.95 });

  if (result.merged === 0) {
    console.log(color('green', '✓ No duplicates found\n'));
  } else {
    console.log(color('green', `✓ Merged ${result.merged} duplicate pairs\n`));

    if (result.details.length > 0 && result.details.length <= 10) {
      console.log('Details:');
      for (const d of result.details) {
        console.log(`  Kept: ${d.kept.substring(0, 20)}... | Deleted: ${d.deleted.substring(0, 20)}...`);
      }
      console.log('');
    }
  }

  await memoryDb.recordMemoryMetric('merge');

  return result;
}

/**
 * Purge only
 */
async function purgeOnly(config) {
  console.log(color('cyan', '\nPurging Old Cold Storage'));
  console.log('═'.repeat(50));

  const retentionDays = config.automaticMemory?.demotion?.coldRetentionDays || 90;
  console.log(`Retention: ${retentionDays} days\n`);

  const result = await memoryDb.purgeColdFacts({ coldRetentionDays: retentionDays });

  if (result.purged === 0) {
    console.log(color('green', '✓ No facts older than retention period\n'));
  } else {
    console.log(color('green', `✓ Purged ${result.purged} old facts\n`));
  }

  await memoryDb.recordMemoryMetric('purge');

  return result;
}

/**
 * List cold storage contents
 */
async function listColdStorage() {
  console.log(color('cyan', '\nCold Storage Contents'));
  console.log('═'.repeat(70));

  await memoryDb.initDatabase();

  // Direct query for cold storage
  const SQL = require('sql.js');
  const db = await memoryDb.initDatabase();

  // This is a workaround since we don't expose direct query in the module
  // We'll use getEntropyStats to show cold count
  const stats = await memoryDb.getEntropyStats();

  console.log(`\nTotal cold facts: ${stats.coldFacts}`);

  if (stats.coldFacts === 0) {
    console.log(color('gray', '\nNo facts in cold storage.\n'));
    return;
  }

  // Since we can't directly query cold storage through the module,
  // inform user how to restore if needed
  console.log(`
${color('yellow', 'Note:')} To restore a fact from cold storage:
  ./scripts/flow compact-memory --restore <fact_id>

To see fact IDs, check the database directly:
  sqlite3 .workflow/memory/local.db "SELECT id, substr(fact,1,50) FROM facts_cold"
`);
}

/**
 * Restore from cold storage
 */
async function restoreFromCold(factId) {
  console.log(color('cyan', '\nRestoring from Cold Storage'));
  console.log('═'.repeat(50));

  console.log(`Fact ID: ${factId}\n`);

  const result = await memoryDb.restoreFromColdStorage(factId);

  if (result.restored) {
    console.log(color('green', '✓ Fact restored successfully'));
    console.log('Relevance has been reset to 50%\n');
  } else {
    console.log(color('red', `✗ ${result.error || 'Failed to restore'}\n`));
  }

  return result;
}

/**
 * Show compaction stats/preview
 */
async function showPreview(config) {
  console.log(color('cyan', '\nCompaction Preview'));
  console.log('═'.repeat(50));

  const memoryConfig = { maxLocalFacts: config.memory?.maxLocalFacts || 1000 };
  const stats = await memoryDb.getEntropyStats(memoryConfig);

  console.log(`\nCurrent State:`);
  console.log(`  Active Facts: ${stats.totalFacts}`);
  console.log(`  Cold Facts:   ${stats.coldFacts}`);
  console.log(`  Entropy:      ${formatEntropy(stats.entropy)}`);

  console.log(`\n${color('blue', 'Would Affect:')}`);

  const threshold = config.automaticMemory?.demotion?.relevanceThreshold || 0.3;
  console.log(`  Low Relevance (<${Math.round(threshold * 100)}%): ${stats.lowRelevanceCount} facts → would be demoted`);
  console.log(`  Never Accessed:  ${stats.neverAccessed} facts → accelerated decay`);

  // Estimate merged (can't know without running)
  console.log(`  Duplicates:      Unknown (run --merge to detect)`);

  console.log(`\n${color('yellow', 'Run ./scripts/flow compact-memory to execute')}\n`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  try {
    if (args.includes('--demote')) {
      await demoteOnly(config);
    } else if (args.includes('--merge')) {
      await mergeOnly();
    } else if (args.includes('--purge')) {
      await purgeOnly(config);
    } else if (args.includes('--cold') || args.includes('--list')) {
      await listColdStorage();
    } else if (args.includes('--restore')) {
      const idx = args.indexOf('--restore');
      const factId = args[idx + 1];
      if (!factId) {
        console.error(color('red', 'Error: Missing fact ID'));
        console.log('Usage: ./scripts/flow compact-memory --restore <fact_id>');
        process.exit(1);
      }
      await restoreFromCold(factId);
    } else if (args.includes('--preview')) {
      await showPreview(config);
    } else if (args.includes('--help') || args.includes('-h')) {
      console.log(`
${color('cyan', 'Memory Compactor')}

Usage: ./scripts/flow compact-memory [options]

Options:
  (none)            Full compaction (all operations)
  --preview         Show what would be affected without changing
  --demote          Only demote low-relevance facts to cold storage
  --merge           Only merge duplicate facts (>95% similar)
  --purge           Only purge old facts from cold storage
  --cold, --list    Show cold storage contents
  --restore <id>    Restore a fact from cold storage
  --help, -h        Show this help

Examples:
  ./scripts/flow compact-memory             # Full compaction
  ./scripts/flow compact-memory --preview   # Preview changes
  ./scripts/flow compact-memory --demote    # Just demote low relevance
  ./scripts/flow compact-memory --restore fact_12345_abc
`);
    } else {
      await fullCompaction(config);
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
