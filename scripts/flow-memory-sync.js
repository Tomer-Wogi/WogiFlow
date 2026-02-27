#!/usr/bin/env node

/**
 * Wogi Flow - Memory to Instructions Sync
 *
 * See MEMORY-ARCHITECTURE.md for how this fits with other memory/knowledge modules.
 *
 * Promotes high-relevance facts and patterns to decisions.md
 * This is the "self-editing core memory" feature.
 *
 * Commands:
 *   ./scripts/flow memory-sync             - Check for patterns to promote
 *   ./scripts/flow memory-sync --auto      - Auto-promote without asking
 *   ./scripts/flow memory-sync --list      - List candidates only
 *   ./scripts/flow memory-sync --promote <id> - Promote specific fact
 *
 * Part of v1.8.0 - Automatic Memory Management
 */

const fs = require('fs');
const path = require('path');
const memoryDb = require('./flow-memory-db');

// Lazy-load to avoid circular dependency
let _syncDecisionsToRules = null;
function syncDecisionsToRules() {
  if (!_syncDecisionsToRules) {
    _syncDecisionsToRules = require('./flow-rules-sync').syncDecisionsToRules;
  }
  return _syncDecisionsToRules();
}

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = process.env.WOGI_PROJECT_ROOT || process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow', 'config.json');
const DECISIONS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'decisions.md');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      // Basic prototype pollution check
      if (parsed && (parsed.__proto__ || parsed.constructor || parsed.prototype)) {
        return {};
      }
      return parsed;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[memory-sync] Failed to load config: ${err.message}`);
    }
  }
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

// ============================================================
// Pattern Analysis
// ============================================================

/**
 * Extract patterns from facts by category
 */
async function analyzePatterns() {
  const facts = await memoryDb.getAllFacts();
  const patterns = {};

  for (const fact of facts) {
    const category = fact.category || 'general';
    if (!patterns[category]) {
      patterns[category] = [];
    }
    patterns[category].push(fact);
  }

  // Sort each category by relevance/access count
  for (const category of Object.keys(patterns)) {
    patterns[category].sort((a, b) => {
      const scoreA = (a.relevance_score || 0.5) * (1 + (a.access_count || 0) * 0.1);
      const scoreB = (b.relevance_score || 0.5) * (1 + (b.access_count || 0) * 0.1);
      return scoreB - scoreA;
    });
  }

  return patterns;
}

/**
 * Get current decisions.md content
 */
function loadDecisions() {
  try {
    if (fs.existsSync(DECISIONS_PATH)) {
      return fs.readFileSync(DECISIONS_PATH, 'utf-8');
    }
  } catch {}
  return '';
}

/**
 * Check if a fact is already in decisions.md
 */
function isAlreadyInDecisions(fact, decisionsContent) {
  // Simple check - see if key phrases exist
  const keywords = fact.split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 5);

  let matches = 0;
  for (const keyword of keywords) {
    if (decisionsContent.toLowerCase().includes(keyword.toLowerCase())) {
      matches++;
    }
  }

  // If more than half of keywords match, likely already there
  return matches > keywords.length / 2;
}

/**
 * Format fact for decisions.md
 */
function formatForDecisions(fact) {
  // Map category to decisions.md section
  const sectionMap = {
    'naming': 'Naming Conventions',
    'pattern': 'Coding Patterns',
    'architecture': 'Architecture Decisions',
    'styling': 'Styling Rules',
    'testing': 'Testing Conventions',
    'error-handling': 'Error Handling',
    'general': 'General Rules',
    'api': 'API Patterns',
    'component': 'Component Patterns'
  };

  const section = sectionMap[fact.category] || 'Learned Patterns';

  return {
    section,
    rule: `- ${fact.fact}`,
    source: fact.source_context ? `(Source: ${fact.source_context})` : '(Auto-promoted from memory)'
  };
}

/**
 * Append rule to decisions.md
 */
function appendToDecisions(formatted, decisionsContent) {
  const lines = decisionsContent.split('\n');
  let sectionIndex = -1;

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(formatted.section) && lines[i].startsWith('#')) {
      sectionIndex = i;
      break;
    }
  }

  if (sectionIndex === -1) {
    // Section doesn't exist, append at end
    return decisionsContent.trim() + `\n\n## ${formatted.section}\n\n${formatted.rule}\n`;
  }

  // Find end of section (next heading or end of file)
  let insertIndex = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      insertIndex = i;
      break;
    }
  }

  // Insert before next section
  lines.splice(insertIndex, 0, formatted.rule);

  return lines.join('\n');
}

// ============================================================
// Commands
// ============================================================

/**
 * List promotion candidates
 */
async function listCandidates(config) {
  console.log(color('cyan', '\nPromotion Candidates'));
  console.log('═'.repeat(70));

  const candidates = await memoryDb.getPromotionCandidates({
    minRelevance: config.automaticPromotion?.minRelevance || 0.8,
    minAccessCount: config.automaticPromotion?.threshold || 3
  });

  const decisionsContent = loadDecisions();

  if (candidates.length === 0) {
    console.log(color('gray', '\nNo facts ready for promotion.'));
    console.log('Requirements: 80%+ relevance and 3+ accesses\n');
    return [];
  }

  // Filter out already-promoted
  const notPromoted = candidates.filter(c =>
    !c.promoted_to && !isAlreadyInDecisions(c.fact, decisionsContent)
  );

  if (notPromoted.length === 0) {
    console.log(color('green', '\n✓ All high-relevance facts are already promoted!\n'));
    return [];
  }

  console.log(`\nFound ${color('green', notPromoted.length)} candidates:\n`);

  for (let i = 0; i < Math.min(notPromoted.length, 15); i++) {
    const c = notPromoted[i];
    const relevance = Math.round((c.relevance_score || 0) * 100);
    const category = c.category || 'general';

    console.log(`${color('blue', `[${i + 1}]`)} ${c.id}`);
    console.log(`    ${c.fact.substring(0, 70)}${c.fact.length > 70 ? '...' : ''}`);
    console.log(`    ${color('gray', `Category: ${category} | Relevance: ${relevance}% | Accessed: ${c.access_count || 0}x`)}\n`);
  }

  if (notPromoted.length > 15) {
    console.log(color('gray', `  ... and ${notPromoted.length - 15} more\n`));
  }

  return notPromoted;
}

/**
 * Promote a specific fact
 */
async function promoteFact(factId, dryRun = false) {
  // Get fact details
  const facts = await memoryDb.getAllFacts();
  const fact = facts.find(f => f.id === factId);

  if (!fact) {
    console.log(color('red', `✗ Fact not found: ${factId}`));
    return false;
  }

  const decisionsContent = loadDecisions();

  if (isAlreadyInDecisions(fact.fact, decisionsContent)) {
    console.log(color('yellow', `⚠ Fact appears to already be in decisions.md`));
    console.log(`  ${fact.fact.substring(0, 60)}...`);
    return false;
  }

  const formatted = formatForDecisions(fact);

  console.log(`\n${color('cyan', 'Promoting to decisions.md:')}`);
  console.log(`  Section: ${formatted.section}`);
  console.log(`  Rule: ${formatted.rule}`);

  if (dryRun) {
    console.log(color('yellow', '\n  [Dry run - no changes made]'));
    return true;
  }

  // Update decisions.md
  const newContent = appendToDecisions(formatted, decisionsContent);
  fs.writeFileSync(DECISIONS_PATH, newContent);

  // Sync to .claude/rules/ for Claude Code integration
  syncDecisionsToRules();

  // Mark fact as promoted
  await memoryDb.markFactPromoted(factId, 'decisions.md');

  console.log(color('green', '\n✓ Promoted successfully'));

  return true;
}

/**
 * Interactive promotion
 */
async function interactiveSync(config) {
  console.log(color('cyan', '\nMemory to Instructions Sync'));
  console.log('═'.repeat(70));

  const candidates = await listCandidates(config);

  if (candidates.length === 0) {
    return { promoted: 0 };
  }

  console.log(color('yellow', '\nNote: Use --auto to promote without prompts'));
  console.log('      Use --promote <id> to promote specific fact\n');

  return { candidates: candidates.length };
}

/**
 * Auto-promote all candidates
 */
async function autoPromote(config) {
  console.log(color('cyan', '\nAuto-Promoting Patterns'));
  console.log('═'.repeat(70));

  const candidates = await memoryDb.getPromotionCandidates({
    minRelevance: config.automaticPromotion?.minRelevance || 0.8,
    minAccessCount: config.automaticPromotion?.threshold || 3
  });

  const decisionsContent = loadDecisions();
  let promoted = 0;
  let skipped = 0;
  let currentContent = decisionsContent;

  for (const candidate of candidates) {
    if (candidate.promoted_to) {
      skipped++;
      continue;
    }

    if (isAlreadyInDecisions(candidate.fact, currentContent)) {
      // Mark as promoted even if already there
      await memoryDb.markFactPromoted(candidate.id, 'decisions.md');
      skipped++;
      continue;
    }

    const formatted = formatForDecisions(candidate);
    currentContent = appendToDecisions(formatted, currentContent);

    await memoryDb.markFactPromoted(candidate.id, 'decisions.md');
    promoted++;

    console.log(`${color('green', '✓')} Promoted: ${candidate.fact.substring(0, 50)}...`);
  }

  if (promoted > 0) {
    fs.writeFileSync(DECISIONS_PATH, currentContent);
    // Sync to .claude/rules/ for Claude Code integration
    syncDecisionsToRules();
    await memoryDb.recordMemoryMetric('auto_promote');
  }

  console.log(`\n${color('cyan', 'Summary')}`);
  console.log(`  Promoted: ${promoted}`);
  console.log(`  Skipped:  ${skipped} (already in decisions.md)\n`);

  return { promoted, skipped };
}

/**
 * Show sync status
 */
async function showStatus(config) {
  console.log(color('cyan', '\nMemory Sync Status'));
  console.log('═'.repeat(50));

  const stats = await memoryDb.getStats();
  const candidates = await memoryDb.getPromotionCandidates({
    minRelevance: config.automaticPromotion?.minRelevance || 0.8,
    minAccessCount: config.automaticPromotion?.threshold || 3
  });

  const autoEnabled = config.automaticPromotion?.enabled || false;
  const requireApproval = config.automaticPromotion?.requireApproval !== false;

  console.log(`\n${color('blue', 'Configuration')}`);
  console.log(`  Auto-promotion:   ${autoEnabled ? color('green', 'Enabled') : color('gray', 'Disabled')}`);
  console.log(`  Require approval: ${requireApproval ? 'Yes' : 'No'}`);
  console.log(`  Min relevance:    ${(config.automaticPromotion?.minRelevance || 0.8) * 100}%`);
  console.log(`  Min accesses:     ${config.automaticPromotion?.threshold || 3}`);

  console.log(`\n${color('blue', 'Memory Status')}`);
  console.log(`  Total facts:      ${stats.facts.total}`);
  console.log(`  Candidates:       ${candidates.filter(c => !c.promoted_to).length} ready`);
  console.log(`  Already promoted: ${candidates.filter(c => c.promoted_to).length}`);

  console.log(`\n${color('blue', 'decisions.md')}`);
  const decisionsContent = loadDecisions();
  const lines = decisionsContent.split('\n').filter(l => l.trim().startsWith('-')).length;
  console.log(`  Rules defined:    ${lines}`);

  console.log('');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  try {
    if (args.includes('--list')) {
      await listCandidates(config);
    } else if (args.includes('--auto')) {
      await autoPromote(config);
    } else if (args.includes('--status')) {
      await showStatus(config);
    } else if (args.includes('--promote')) {
      const idx = args.indexOf('--promote');
      const factId = args[idx + 1];
      if (!factId) {
        console.error(color('red', 'Error: Missing fact ID'));
        console.log('Usage: ./scripts/flow memory-sync --promote <fact_id>');
        process.exit(1);
      }
      const dryRun = args.includes('--dry-run');
      await promoteFact(factId, dryRun);
    } else if (args.includes('--help') || args.includes('-h')) {
      console.log(`
${color('cyan', 'Memory to Instructions Sync')}

Promotes high-relevance facts from memory to decisions.md

Usage: ./scripts/flow memory-sync [options]

Options:
  (none)              Show candidates and status
  --list              List all promotion candidates
  --auto              Auto-promote all candidates
  --status            Show sync configuration and status
  --promote <id>      Promote a specific fact by ID
  --dry-run           With --promote, preview without changing
  --help, -h          Show this help

Promotion Criteria:
  - Relevance score >= 80% (configurable)
  - Access count >= 3 (configurable)
  - Not already in decisions.md
  - Not already marked as promoted

Configure in config.json:
  "automaticPromotion": {
    "enabled": true,      // Enable auto-promotion
    "threshold": 3,       // Min access count
    "minRelevance": 0.8,  // Min relevance score
    "requireApproval": true
  }

Examples:
  ./scripts/flow memory-sync           # Check for patterns
  ./scripts/flow memory-sync --auto    # Auto-promote all
  ./scripts/flow memory-sync --promote fact_123_abc
`);
    } else {
      await interactiveSync(config);
    }
  } catch (err) {
    console.error(color('red', `Error: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    memoryDb.closeDatabase();
  }
}

// ============================================================
// Exports (for use by session-end and other modules)
// ============================================================

module.exports = {
  autoPromote,
  listCandidates,
  promoteFact,
  showStatus,
  loadConfig
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
