#!/usr/bin/env node

/**
 * Skill Documentation Freshness Tracker
 * Checks when skills were last updated and flags stale documentation.
 */

const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_FRESHNESS_THRESHOLD_DAYS = 90;

// Dangerous keys that could cause prototype pollution
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ============================================
// FRESHNESS CHECKING
// ============================================

/**
 * Parse YAML frontmatter from a skill.md file.
 * Handles colons in values correctly by only splitting on the first colon.
 * Blocks dangerous keys (__proto__, constructor, prototype).
 * @param {string} content - File content
 * @returns {Object} Parsed frontmatter key-value pairs
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key || DANGEROUS_KEYS.has(key)) continue;
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

/**
 * Get freshness info for all installed skills.
 * @param {string} projectRoot - Project root path
 * @returns {Array<{name: string, source: string, lastDocCheck: string|null, daysSinceCheck: number|null, isStale: boolean, prebuiltVersion: string|null}>}
 */
function getSkillFreshnessReport(projectRoot) {
  const config = loadConfig(projectRoot);
  const threshold = config?.skills?.freshnessThreshold || DEFAULT_FRESHNESS_THRESHOLD_DAYS;
  const skillsDir = path.join(projectRoot, '.claude', 'skills');

  const now = new Date();
  const report = [];

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '_template') continue;

      const skillMdPath = path.join(skillsDir, entry.name, 'skill.md');

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const fm = parseFrontmatter(content);

        // Only use lastDocCheck and lastRefreshed for freshness (not generated — that's creation date)
        const lastDocCheck = fm.lastDocCheck || fm.lastRefreshed || null;
        let daysSinceCheck = null;
        let isStale = false;

        if (lastDocCheck) {
          const checkDate = new Date(lastDocCheck);
          if (!isNaN(checkDate.getTime())) {
            daysSinceCheck = Math.floor((now - checkDate) / (1000 * 60 * 60 * 24));
            isStale = daysSinceCheck > threshold;
          }
        } else {
          // No date means we can't verify freshness — flag as stale
          isStale = true;
        }

        report.push({
          name: entry.name,
          source: fm.source || (fm.incomplete === 'true' ? 'generated-incomplete' : 'generated'),
          lastDocCheck,
          daysSinceCheck,
          isStale,
          prebuiltVersion: fm.prebuiltVersion || null,
          context7: fm.context7 || null
        });
      } catch (err) {
        // Skip unreadable skills (ENOENT, permission errors, etc.)
      }
    }
  } catch (err) {
    // Skills directory doesn't exist or is unreadable
    return [];
  }

  return report.sort((a, b) => {
    // Stale first, then by days since check (descending)
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    return (b.daysSinceCheck || 0) - (a.daysSinceCheck || 0);
  });
}

/**
 * Get only stale skills that need refreshing.
 * @param {string} projectRoot
 * @returns {Array} Stale skills from the freshness report
 */
function getStaleSkills(projectRoot) {
  return getSkillFreshnessReport(projectRoot).filter(s => s.isStale);
}

/**
 * Update the lastDocCheck date in a skill's frontmatter.
 * @param {string} skillDir - Path to skill directory
 * @param {string} [date] - ISO date string (defaults to now)
 */
function updateLastDocCheck(skillDir, date) {
  const skillMdPath = path.join(skillDir, 'skill.md');

  // Validate date format to prevent YAML injection
  const dateStr = date || new Date().toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.error(`Invalid date format: ${dateStr} (expected YYYY-MM-DD)`);
    return;
  }

  try {
    let content = fs.readFileSync(skillMdPath, 'utf-8');

    if (content.match(/^lastDocCheck:/m)) {
      content = content.replace(/^lastDocCheck:.*$/m, `lastDocCheck: "${dateStr}"`);
    } else {
      // Insert before the CLOSING --- delimiter (second occurrence)
      // Match the frontmatter block and insert before its closing ---
      const fmMatch = content.match(/^(---\n[\s\S]*?)\n---/);
      if (fmMatch) {
        const fmContent = fmMatch[1];
        content = content.replace(fmMatch[0], `${fmContent}\nlastDocCheck: "${dateStr}"\n---`);
      }
    }

    fs.writeFileSync(skillMdPath, content, 'utf-8');
  } catch (err) {
    console.error(`Failed to update lastDocCheck for ${skillDir}: ${err.message}`);
  }
}

// ============================================
// CONFIG LOADING
// ============================================

function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (err) {
    return {};
  }
}

// ============================================
// CLI
// ============================================

function printFreshnessReport(report, threshold) {
  const stale = report.filter(s => s.isStale);
  const fresh = report.filter(s => !s.isStale);

  console.log('\n' + '━'.repeat(50));
  console.log('  Documentation Freshness Report');
  console.log('━'.repeat(50));
  console.log(`  Threshold: ${threshold} days`);
  console.log(`  Total skills: ${report.length}`);
  console.log(`  Fresh: ${fresh.length}`);
  console.log(`  Stale: ${stale.length}`);

  if (stale.length > 0) {
    console.log('\n  Stale skills (may need refresh):');
    for (const s of stale) {
      const age = s.daysSinceCheck !== null ? `${s.daysSinceCheck} days` : 'unknown age';
      const source = s.source === 'prebuilt' ? '(pre-built)' : '(generated)';
      console.log(`    - ${s.name} ${source} — ${age}`);
    }
    console.log('\n  Run `/wogi-setup-stack --refresh-stale` to update.');
  } else {
    console.log('\n  All skills are up to date.');
  }

  console.log('━'.repeat(50) + '\n');
}

if (require.main === module) {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot);
  const threshold = config?.skills?.freshnessThreshold || DEFAULT_FRESHNESS_THRESHOLD_DAYS;

  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  if (command === 'check') {
    const report = getSkillFreshnessReport(projectRoot);
    printFreshnessReport(report, threshold);
  } else if (command === 'stale') {
    const stale = getStaleSkills(projectRoot);
    if (stale.length === 0) {
      console.log('No stale skills found.');
    } else {
      console.log(JSON.stringify(stale, null, 2));
    }
  } else if (command === 'bump' && args[1]) {
    // Validate skill name to prevent path traversal
    const skillName = args[1];
    if (!/^[a-z0-9-]+$/.test(skillName)) {
      console.error(`Invalid skill name: ${skillName} (must be lowercase alphanumeric with hyphens)`);
      process.exit(1);
    }
    const skillDir = path.join(projectRoot, '.claude', 'skills', skillName);
    updateLastDocCheck(skillDir);
    console.log(`Updated lastDocCheck for ${skillName}`);
  } else {
    console.log('Usage: node flow-skill-freshness.js [check|stale|bump <skill-name>]');
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  getSkillFreshnessReport,
  getStaleSkills,
  updateLastDocCheck,
  parseFrontmatter,
  DEFAULT_FRESHNESS_THRESHOLD_DAYS
};
