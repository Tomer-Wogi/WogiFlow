#!/usr/bin/env node

/**
 * Wogi Flow - Learnings Aggregation
 *
 * Aggregates learnings across all skills and corrections to:
 * - Identify patterns that should be promoted
 * - Surface recurring issues
 * - Suggest knowledge base updates
 *
 * Usage:
 *   flow aggregate              # Show aggregated learnings summary
 *   flow aggregate --detailed   # Show full details
 *   flow aggregate --promote    # Interactive promotion wizard
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  dirExists,
  readFile,
  writeFile,
  listDirs,
  color,
  success,
  warn
} = require('./flow-utils');
const { syncDecisionsToRules } = require('./flow-rules-sync');

// ============================================================
// Paths
// ============================================================

const SKILLS_DIR = PATHS.skills;
const CORRECTIONS_DIR = path.join(PROJECT_ROOT, '.workflow', 'corrections');

// ============================================================
// Data Collection
// ============================================================

/**
 * Parse learnings from a learnings.md file
 */
function parseLearningsFile(filePath) {
  if (!fileExists(filePath)) return [];

  const content = readFile(filePath, '');
  const learnings = [];

  // Match learning entries: ### YYYY-MM-DD - Title
  const entryRegex = /^### (\d{4}-\d{2}-\d{2}) - (.+)$/gm;
  let match;

  while ((match = entryRegex.exec(content)) !== null) {
    const date = match[1];
    const title = match[2];
    const startIndex = match.index + match[0].length;

    // Find end of entry (next ### or end of file)
    const nextMatch = content.slice(startIndex).match(/^### \d{4}-\d{2}-\d{2}/m);
    const endIndex = nextMatch ? startIndex + nextMatch.index : content.length;
    const entryContent = content.slice(startIndex, endIndex).trim();

    // Extract fields
    const contextMatch = entryContent.match(/\*\*Context\*\*:\s*(.+)/);
    const issueMatch = entryContent.match(/\*\*Issue\*\*:\s*(.+)/);
    const learningMatch = entryContent.match(/\*\*Learning\*\*:\s*(.+)/);
    const filesMatch = entryContent.match(/\*\*Files\*\*:\s*(.+)/);

    learnings.push({
      date,
      title,
      context: contextMatch ? contextMatch[1] : '',
      issue: issueMatch ? issueMatch[1] : '',
      learning: learningMatch ? learningMatch[1] : '',
      files: filesMatch ? filesMatch[1].split(',').map(f => f.trim()) : [],
      source: filePath
    });
  }

  return learnings;
}

/**
 * Parse feedback patterns from feedback-patterns.md
 */
function parseFeedbackPatterns() {
  if (!fileExists(PATHS.feedbackPatterns)) return [];

  const content = readFile(PATHS.feedbackPatterns, '');
  const patterns = [];

  // Parse table rows: | date | correction | count | promoted | status |
  const tableRegex = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*"?([^|"]+)"?\s*\|\s*(\d+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|/gm;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const [, date, correction, count, promotedTo, status] = match;
    patterns.push({
      date,
      correction: correction.trim(),
      count: parseInt(count, 10),
      promotedTo: promotedTo.trim() || null,
      status: status.trim(),
      source: 'feedback-patterns.md'
    });
  }

  return patterns;
}

/**
 * Parse corrections from corrections directory
 */
function parseCorrections() {
  if (!dirExists(CORRECTIONS_DIR)) return [];

  const corrections = [];
  const files = fs.readdirSync(CORRECTIONS_DIR)
    .filter(f => f.startsWith('CORR-') && f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(CORRECTIONS_DIR, file);
    const content = readFile(filePath, '');

    const idMatch = content.match(/^# (CORR-\d+) - (.+)$/m);
    const dateMatch = content.match(/\*\*Date\*\*:\s*(.+)$/m);
    const taskMatch = content.match(/\*\*Task\*\*:\s*(.+)$/m);
    const skillMatch = content.match(/\*\*Skill\*\*:\s*(.+)$/m);
    const tagsMatch = content.match(/\*\*Tags\*\*:\s*(.+)$/m);

    // Extract sections
    const whatHappenedMatch = content.match(/## What Happened\n+([\s\S]*?)(?=\n## |$)/);
    const whatShouldMatch = content.match(/## What Should Happen\n+([\s\S]*?)(?=\n## |$)/);
    const rootCauseMatch = content.match(/## Root Cause\n+([\s\S]*?)(?=\n## |$)/);

    corrections.push({
      id: idMatch ? idMatch[1] : file.replace('.md', ''),
      title: idMatch ? idMatch[2] : 'Unknown',
      date: dateMatch ? dateMatch[1] : 'Unknown',
      task: taskMatch ? taskMatch[1] : null,
      skill: skillMatch ? skillMatch[1] : null,
      tags: tagsMatch ? tagsMatch[1].match(/#\w+/g) || [] : [],
      whatHappened: whatHappenedMatch ? whatHappenedMatch[1].trim() : '',
      whatShould: whatShouldMatch ? whatShouldMatch[1].trim() : '',
      rootCause: rootCauseMatch ? rootCauseMatch[1].trim() : '',
      source: filePath
    });
  }

  return corrections;
}

/**
 * Collect all learnings from all skills
 */
function collectSkillLearnings() {
  const allLearnings = [];

  if (!dirExists(SKILLS_DIR)) return allLearnings;

  const skillDirs = listDirs(SKILLS_DIR)
    .filter(d => d !== '_template');

  for (const skillName of skillDirs) {
    const learningsPath = path.join(SKILLS_DIR, skillName, 'knowledge', 'learnings.md');
    const learnings = parseLearningsFile(learningsPath);

    for (const learning of learnings) {
      allLearnings.push({
        ...learning,
        skill: skillName
      });
    }
  }

  return allLearnings;
}

// ============================================================
// Analysis
// ============================================================

/**
 * Find patterns that occur multiple times
 */
function findRecurringPatterns(data) {
  const { learnings, patterns, corrections } = data;
  const recurring = [];

  // Group by similar issues/learnings
  const issueGroups = {};

  // From learnings
  for (const l of learnings) {
    const key = normalizeText(l.learning || l.issue || l.title);
    if (!issueGroups[key]) {
      issueGroups[key] = { count: 0, sources: [], dates: [], type: 'learning' };
    }
    issueGroups[key].count++;
    issueGroups[key].sources.push(l.source);
    issueGroups[key].dates.push(l.date);
    issueGroups[key].original = l.learning || l.issue || l.title;
  }

  // From corrections
  for (const c of corrections) {
    const key = normalizeText(c.whatShould || c.title);
    if (!issueGroups[key]) {
      issueGroups[key] = { count: 0, sources: [], dates: [], type: 'correction' };
    }
    issueGroups[key].count++;
    issueGroups[key].sources.push(c.source);
    issueGroups[key].dates.push(c.date);
    issueGroups[key].original = c.whatShould || c.title;
  }

  // Find recurring (3+ times)
  for (const [_key, data] of Object.entries(issueGroups)) {
    if (data.count >= 3) {
      recurring.push({
        pattern: data.original,
        count: data.count,
        type: data.type,
        sources: [...new Set(data.sources)],
        lastSeen: data.dates.sort().reverse()[0]
      });
    }
  }

  // Also add patterns from feedback-patterns that have count >= 3
  for (const p of patterns) {
    if (p.count >= 3 && !p.promotedTo) {
      recurring.push({
        pattern: p.correction,
        count: p.count,
        type: 'feedback',
        sources: ['feedback-patterns.md'],
        lastSeen: p.date
      });
    }
  }

  return recurring.sort((a, b) => b.count - a.count);
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

/**
 * Group learnings by skill
 */
function groupBySkill(learnings) {
  const groups = {};

  for (const l of learnings) {
    const skill = l.skill || 'general';
    if (!groups[skill]) {
      groups[skill] = [];
    }
    groups[skill].push(l);
  }

  return groups;
}

/**
 * Get recent learnings (last 30 days)
 */
function getRecentLearnings(learnings, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return learnings.filter(l => {
    const date = new Date(l.date);
    return date >= cutoff;
  });
}

// ============================================================
// Output
// ============================================================

/**
 * Print summary
 */
function printSummary(data, options = {}) {
  const { learnings, patterns, corrections } = data;

  console.log(color('cyan', '═══════════════════════════════════════════════════'));
  console.log(color('cyan', '            Learnings Aggregation Summary'));
  console.log(color('cyan', '═══════════════════════════════════════════════════'));
  console.log('');

  // Overview
  console.log(color('yellow', 'Overview'));
  console.log(`  Total learnings: ${learnings.length}`);
  console.log(`  Feedback patterns: ${patterns.length}`);
  console.log(`  Corrections: ${corrections.length}`);
  console.log('');

  // By skill
  const bySkill = groupBySkill(learnings);
  if (Object.keys(bySkill).length > 0) {
    console.log(color('yellow', 'By Skill'));
    for (const [skill, items] of Object.entries(bySkill)) {
      console.log(`  ${skill}: ${items.length} learnings`);
    }
    console.log('');
  }

  // Recent activity
  const recent = getRecentLearnings(learnings);
  console.log(color('yellow', 'Recent Activity (30 days)'));
  console.log(`  New learnings: ${recent.length}`);
  console.log('');

  // Patterns needing promotion
  const recurring = findRecurringPatterns(data);
  if (recurring.length > 0) {
    console.log(color('yellow', 'Patterns Ready for Promotion'));
    console.log(color('dim', '  (Occurred 3+ times - should become permanent rules)'));
    console.log('');

    for (const r of recurring.slice(0, 5)) {
      console.log(`  ${color('green', '●')} ${r.pattern.slice(0, 60)}${r.pattern.length > 60 ? '...' : ''}`);
      console.log(`    Count: ${r.count} | Last: ${r.lastSeen} | Type: ${r.type}`);
    }

    if (recurring.length > 5) {
      console.log(`  ... and ${recurring.length - 5} more`);
    }
    console.log('');
  }

  // Pending feedback patterns
  const pending = patterns.filter(p => p.status === 'Pending' && p.count < 3);
  if (pending.length > 0) {
    console.log(color('yellow', 'Pending Patterns (Need More Occurrences)'));
    for (const p of pending.slice(0, 5)) {
      console.log(`  ${color('dim', '○')} ${p.correction} (${p.count}/3)`);
    }
    console.log('');
  }

  // Detailed view
  if (options.detailed && learnings.length > 0) {
    console.log(color('yellow', 'All Learnings'));
    console.log('');
    for (const l of learnings.slice(0, 20)) {
      console.log(`  ${color('cyan', l.date)} | ${l.skill || 'general'}`);
      console.log(`    ${l.title}`);
      if (l.learning) console.log(`    ${color('dim', l.learning.slice(0, 80))}`);
      console.log('');
    }
  }
}

/**
 * Interactive promotion wizard
 */
async function runPromotionWizard(data) {
  const recurring = findRecurringPatterns(data);

  if (recurring.length === 0) {
    console.log('No patterns ready for promotion (need 3+ occurrences).');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = (q) => new Promise(r => rl.question(q, r));

  console.log(color('cyan', 'Pattern Promotion Wizard'));
  console.log('');
  console.log('The following patterns have occurred 3+ times and');
  console.log('should be promoted to permanent instruction files.');
  console.log('');

  for (let i = 0; i < Math.min(5, recurring.length); i++) {
    const r = recurring[i];

    console.log(`${color('yellow', `[${i + 1}]`)} ${r.pattern}`);
    console.log(`    Count: ${r.count} | Type: ${r.type}`);
    console.log('');

    const action = await prompt('Promote to (d)ecisions.md, (a)gents, (s)kip, (q)uit? ');

    if (action.toLowerCase() === 'q') {
      break;
    }

    if (action.toLowerCase() === 'd') {
      appendToDecisions(r.pattern);
      success(`Added to decisions.md`);
    } else if (action.toLowerCase() === 'a') {
      const agent = await prompt('Which agent file? (e.g., developer): ');
      if (agent) {
        appendToAgent(agent, r.pattern);
        success(`Added to agents/${agent}.md`);
      }
    }

    console.log('');
  }

  rl.close();
}

/**
 * Append pattern to decisions.md
 */
function appendToDecisions(pattern) {
  const decisionsPath = PATHS.decisions;
  let content = readFile(decisionsPath, '# Decisions\n\n');

  const date = new Date().toISOString().split('T')[0];
  const entry = `\n## ${date} - Promoted Pattern\n\n**Rule**: ${pattern}\n**Source**: Aggregated from learnings (3+ occurrences)\n\n`;

  content += entry;
  writeFile(decisionsPath, content);

  // Sync to .claude/rules/ for Claude Code integration
  syncDecisionsToRules();
}

/**
 * Append pattern to an agent file
 */
function appendToAgent(agentName, pattern) {
  const agentPath = path.join(PROJECT_ROOT, 'agents', `${agentName}.md`);

  if (!fileExists(agentPath)) {
    warn(`Agent file not found: ${agentPath}`);
    return;
  }

  let content = readFile(agentPath, '');
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n\n## Learned Pattern (${date})\n\n${pattern}\n`;

  content += entry;
  writeFile(agentPath, content);
}

// ============================================================
// Programmatic API
// ============================================================

/**
 * Get aggregated data for programmatic use
 * @returns {Object} { learnings, patterns, corrections }
 */
function getAggregatedData() {
  return {
    learnings: collectSkillLearnings(),
    patterns: parseFeedbackPatterns(),
    corrections: parseCorrections()
  };
}

/**
 * Get patterns ready for promotion (3+ occurrences)
 * @returns {Array} Array of promotion candidates
 */
function getPromotionCandidates() {
  const data = getAggregatedData();
  return findRecurringPatterns(data);
}

/**
 * Check if there are patterns ready for promotion
 * @returns {Object} { hasPromotions, count, candidates }
 */
function checkPromotionStatus() {
  const candidates = getPromotionCandidates();
  return {
    hasPromotions: candidates.length > 0,
    count: candidates.length,
    candidates: candidates.slice(0, 5) // Top 5 only
  };
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const detailed = args.includes('--detailed');
  const promote = args.includes('--promote');

  // Collect all data
  const data = getAggregatedData();

  if (promote) {
    runPromotionWizard(data);
  } else {
    printSummary(data, { detailed });
  }
}

// Only run main if called directly (not required as module)
if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = {
  getAggregatedData,
  getPromotionCandidates,
  checkPromotionStatus,
  findRecurringPatterns,
  appendToDecisions
};
