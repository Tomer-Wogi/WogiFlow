#!/usr/bin/env node

/**
 * Wogi Flow - Technical Debt Manager
 *
 * Tracks, manages, and helps resolve technical debt accumulated across sessions.
 * Issues are captured from session reviews and persisted for tracking over time.
 *
 * Usage:
 *   CLI:
 *     flow tech-debt                    # Show summary
 *     flow tech-debt list               # List all open items
 *     flow tech-debt list --aging       # Show only aging items
 *     flow tech-debt list --fixable     # Show only auto-fixable items
 *     flow tech-debt fix                # Run auto-fixes (batch)
 *     flow tech-debt dismiss <id>       # Mark as won't-fix
 *     flow tech-debt promote <id>       # Create task from debt item
 *
 *   Programmatic:
 *     const { TechDebtManager } = require('./flow-tech-debt');
 *     const manager = new TechDebtManager();
 *     manager.addIssues(issues);
 *     manager.getStats();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import shared utilities from flow-utils
const {
  colors: c,
  safeJsonParse,
  writeJson,
  fileExists,
  getProjectRoot,
  ensureDir,
  generateTaskId
} = require('./flow-utils');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AGING_THRESHOLD = 3;  // Sessions before item is "aging"
const AUTO_FIXABLE_TYPES = [
  'console.log',
  'unused-import',
  'debugger',
  'trailing-whitespace',
  'empty-catch'
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate unique debt item ID (6 bytes for better collision resistance)
 */
function generateDebtId() {
  return 'td-' + crypto.randomBytes(6).toString('hex');
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Safe JSON write with atomic temp file pattern
 */
function safeWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  writeJson(filePath, data);
}

// ============================================================================
// Tech Debt Manager Class
// ============================================================================

class TechDebtManager {
  constructor(projectRoot = null) {
    this.projectRoot = projectRoot || getProjectRoot();
    this.debtFilePath = path.join(this.projectRoot, '.workflow', 'state', 'tech-debt.json');
    this.configPath = path.join(this.projectRoot, '.workflow', 'config.json');
    this.readyPath = path.join(this.projectRoot, '.workflow', 'state', 'ready.json');
    this.data = this.load();
    this.config = this.loadConfig();
  }

  /**
   * Load tech debt data from file
   */
  load() {
    const defaultData = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      issues: [],
      stats: {
        totalOpen: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        autoFixable: 0
      }
    };

    const data = safeJsonParse(this.debtFilePath, defaultData);
    return data;
  }

  /**
   * Load config for tech debt settings
   */
  loadConfig() {
    const config = safeJsonParse(this.configPath, {});
    return config.techDebt || {
      enabled: true,
      promptOnSessionEnd: true,
      showInMorningBriefing: true,
      agingThreshold: DEFAULT_AGING_THRESHOLD,
      autoFix: {
        enabled: true,
        types: AUTO_FIXABLE_TYPES
      },
      debtBudget: {
        enabled: false,
        maxOpenItems: 20
      }
    };
  }

  /**
   * Save tech debt data to file
   */
  save() {
    this.data.lastUpdated = new Date().toISOString();
    this.updateStats();
    safeWriteJson(this.debtFilePath, this.data);
  }

  /**
   * Update statistics
   */
  updateStats() {
    const openIssues = this.data.issues.filter(i => i.status === 'open');

    this.data.stats = {
      totalOpen: openIssues.length,
      bySeverity: {
        critical: openIssues.filter(i => i.severity === 'critical').length,
        high: openIssues.filter(i => i.severity === 'high').length,
        medium: openIssues.filter(i => i.severity === 'medium').length,
        low: openIssues.filter(i => i.severity === 'low').length
      },
      autoFixable: openIssues.filter(i => i.autoFixable).length
    };
  }

  /**
   * Create unique key for deduplication
   */
  createIssueKey(issue) {
    return `${issue.file}:${issue.line}:${issue.description}`.toLowerCase();
  }

  /**
   * Determine if an issue is auto-fixable
   */
  isAutoFixable(issue) {
    const fixablePatterns = [
      /console\.(log|debug|info|warn)/i,
      /unused\s+(import|variable|parameter)/i,
      /debugger\s+statement/i,
      /trailing\s+whitespace/i,
      /empty\s+catch/i
    ];

    const desc = issue.description.toLowerCase();
    return fixablePatterns.some(pattern => pattern.test(desc));
  }

  /**
   * Add issues from session review
   * Deduplicates and updates session count for existing issues
   */
  addIssues(issues) {
    const today = getCurrentDate();
    const existingKeys = new Map(
      this.data.issues.map(i => [this.createIssueKey(i), i])
    );

    let added = 0;
    let updated = 0;

    for (const issue of issues) {
      const key = this.createIssueKey(issue);
      const existing = existingKeys.get(key);

      if (existing) {
        // Update existing issue
        existing.sessionsSeen = (existing.sessionsSeen || 1) + 1;
        existing.lastSeen = today;
        updated++;
      } else {
        // Add new issue
        const newIssue = {
          id: generateDebtId(),
          file: issue.file,
          line: issue.line || 0,
          category: issue.category || 'code',
          severity: issue.severity || 'low',
          description: issue.description,
          fix: issue.fix || '',
          firstSeen: today,
          lastSeen: today,
          sessionsSeen: 1,
          status: 'open',
          autoFixable: this.isAutoFixable(issue)
        };

        this.data.issues.push(newIssue);
        existingKeys.set(key, newIssue);
        added++;
      }
    }

    this.save();
    return { added, updated };
  }

  /**
   * Get all open issues
   */
  getOpenIssues() {
    return this.data.issues.filter(i => i.status === 'open');
  }

  /**
   * Get aging issues (seen >= threshold sessions)
   */
  getAgingIssues() {
    const threshold = this.config.agingThreshold || DEFAULT_AGING_THRESHOLD;
    return this.getOpenIssues().filter(i => i.sessionsSeen >= threshold);
  }

  /**
   * Get auto-fixable issues
   */
  getAutoFixable() {
    return this.getOpenIssues().filter(i => i.autoFixable);
  }

  /**
   * Get issues by severity
   */
  getBySeverity(severity) {
    return this.getOpenIssues().filter(i => i.severity === severity);
  }

  /**
   * Mark issue as fixed
   */
  markFixed(id) {
    const issue = this.data.issues.find(i => i.id === id);
    if (issue) {
      issue.status = 'fixed';
      issue.fixedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Mark issue as dismissed (won't fix)
   */
  dismiss(id, reason = '') {
    const issue = this.data.issues.find(i => i.id === id);
    if (issue) {
      issue.status = 'dismissed';
      issue.dismissedAt = new Date().toISOString();
      issue.dismissReason = reason;
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Promote debt item to task in ready.json
   */
  promoteToTask(id) {
    const issue = this.data.issues.find(i => i.id === id && i.status === 'open');
    if (!issue) {
      return { success: false, error: 'Issue not found or not open' };
    }

    const ready = safeJsonParse(this.readyPath, { ready: [], inProgress: [] });

    // Check if already promoted
    const existingTask = ready.ready.find(t => t.debtItemId === id);
    if (existingTask) {
      return { success: false, error: 'Already promoted to task' };
    }

    // Create task
    const task = {
      id: generateTaskId(`debt-${issue.description.slice(0, 30)}`),
      title: `Fix tech debt: ${issue.description.slice(0, 50)}`,
      type: 'refactor',
      priority: issue.severity === 'critical' ? 'high' : (issue.severity === 'high' ? 'medium' : 'low'),
      source: 'tech-debt',
      debtItemId: issue.id,
      file: issue.file,
      line: issue.line,
      created: new Date().toISOString()
    };

    ready.ready.push(task);
    safeWriteJson(this.readyPath, ready);

    issue.promotedToTask = task.id;
    this.save();

    return { success: true, taskId: task.id };
  }

  /**
   * Get statistics
   */
  getStats() {
    this.updateStats();
    return {
      ...this.data.stats,
      agingCount: this.getAgingIssues().length
    };
  }

  /**
   * Run auto-fixes for all auto-fixable issues
   * Returns list of files modified
   */
  runAutoFix() {
    const fixableIssues = this.getAutoFixable();
    const fixedFiles = new Map();
    const fixed = [];
    const failed = [];

    // Group by file
    const byFile = new Map();
    for (const issue of fixableIssues) {
      if (!byFile.has(issue.file)) {
        byFile.set(issue.file, []);
      }
      byFile.get(issue.file).push(issue);
    }

    // Process each file
    for (const [filePath, issues] of byFile) {
      const fullPath = path.join(this.projectRoot, filePath);

      if (!fs.existsSync(fullPath)) {
        for (const issue of issues) {
          failed.push({ issue, reason: 'File not found' });
        }
        continue;
      }

      try {
        let content = fs.readFileSync(fullPath, 'utf-8');
        let lines = content.split('\n');
        const linesToRemove = new Set();

        // Collect lines to fix
        for (const issue of issues) {
          const desc = issue.description.toLowerCase();

          // console.log - remove line
          if (/console\.(log|debug|info|warn)/i.test(desc)) {
            if (issue.line > 0 && issue.line <= lines.length) {
              const line = lines[issue.line - 1];
              if (/console\.(log|debug|info|warn)\s*\(/.test(line)) {
                linesToRemove.add(issue.line - 1);
                fixed.push(issue);
                continue;
              }
            }
          }

          // debugger - remove line
          if (/debugger\s+statement/i.test(desc)) {
            if (issue.line > 0 && issue.line <= lines.length) {
              const line = lines[issue.line - 1];
              if (/^\s*debugger\s*;?\s*$/.test(line)) {
                linesToRemove.add(issue.line - 1);
                fixed.push(issue);
                continue;
              }
            }
          }

          // empty catch - add comment
          if (/empty\s+catch/i.test(desc)) {
            if (issue.line > 0 && issue.line <= lines.length) {
              const line = lines[issue.line - 1];
              if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
                lines[issue.line - 1] = line.replace(
                  /catch\s*(\([^)]*\))?\s*\{\s*\}/,
                  (match, param) => `catch ${param || '(err)'} { /* intentionally empty */ }`
                );
                fixed.push(issue);
                continue;
              }
            }
          }

          // If we couldn't fix it
          failed.push({ issue, reason: 'Could not apply fix' });
        }

        // Remove lines (in reverse order to preserve line numbers)
        const sortedLinesToRemove = Array.from(linesToRemove).sort((a, b) => b - a);
        for (const lineIndex of sortedLinesToRemove) {
          lines.splice(lineIndex, 1);
        }

        // Write back
        if (linesToRemove.size > 0 || fixed.some(i => i.file === filePath)) {
          fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
          fixedFiles.set(filePath, issues.filter(i => fixed.includes(i)).length);
        }

      } catch (err) {
        for (const issue of issues) {
          failed.push({ issue, reason: err.message });
        }
      }
    }

    // Mark fixed issues
    for (const issue of fixed) {
      this.markFixed(issue.id);
    }

    return {
      fixed: fixed.length,
      failed: failed.length,
      files: Array.from(fixedFiles.keys()),
      details: { fixed, failed }
    };
  }

  /**
   * Create tasks for all aging issues
   */
  promoteAgingToTasks() {
    const aging = this.getAgingIssues().filter(i => !i.promotedToTask);
    const promoted = [];

    for (const issue of aging) {
      const result = this.promoteToTask(issue.id);
      if (result.success) {
        promoted.push({ issue, taskId: result.taskId });
      }
    }

    return promoted;
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function printHeader(text) {
  const width = 60;
  console.log(`${c.cyan}╔${'═'.repeat(width - 2)}╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset}  ${c.bold}${text.padEnd(width - 4)}${c.reset}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}╚${'═'.repeat(width - 2)}╝${c.reset}`);
}

function printSection(text) {
  console.log(`\n${c.yellow}━━━ ${text} ━━━${c.reset}`);
}

function formatIssue(issue, showDetails = true) {
  const severityColors = {
    critical: c.red,
    high: c.yellow,
    medium: c.blue,
    low: c.dim
  };
  const color = severityColors[issue.severity] || c.dim;

  let line = `  ${c.dim}[${issue.id}]${c.reset} ${issue.file}`;
  if (issue.line) line += `:${issue.line}`;
  line += ` ${color}(${issue.severity})${c.reset}`;

  if (issue.sessionsSeen > 1) {
    line += ` ${c.yellow}⚠ ${issue.sessionsSeen} sessions${c.reset}`;
  }

  console.log(line);

  if (showDetails) {
    console.log(`      ${c.dim}${issue.description}${c.reset}`);
    if (issue.fix) {
      console.log(`      ${c.green}Fix: ${issue.fix}${c.reset}`);
    }
  }
}

function showSummary(manager) {
  const stats = manager.getStats();

  printHeader('Technical Debt Dashboard');
  console.log('');

  console.log(`${c.bold}Summary:${c.reset} ${stats.totalOpen} open items`);
  console.log(`  ${c.red}Critical: ${stats.bySeverity.critical}${c.reset}  ` +
              `${c.yellow}High: ${stats.bySeverity.high}${c.reset}  ` +
              `${c.blue}Medium: ${stats.bySeverity.medium}${c.reset}  ` +
              `${c.dim}Low: ${stats.bySeverity.low}${c.reset}`);

  if (stats.agingCount > 0) {
    console.log(`\n${c.yellow}⚠ ${stats.agingCount} items aging (3+ sessions)${c.reset}`);
  }

  if (stats.autoFixable > 0) {
    console.log(`${c.green}✓ ${stats.autoFixable} auto-fixable items available${c.reset}`);
  }

  // Show quick commands
  console.log(`\n${c.dim}Commands:${c.reset}`);
  console.log(`  ${c.cyan}flow tech-debt list${c.reset}          List all items`);
  console.log(`  ${c.cyan}flow tech-debt list --aging${c.reset}  Show aging items`);
  console.log(`  ${c.cyan}flow tech-debt fix${c.reset}           Run auto-fixes`);
}

function showList(manager, options = {}) {
  let issues;
  let title;

  if (options.aging) {
    issues = manager.getAgingIssues();
    title = 'Aging Issues (3+ sessions)';
  } else if (options.fixable) {
    issues = manager.getAutoFixable();
    title = 'Auto-Fixable Issues';
  } else if (options.severity) {
    issues = manager.getBySeverity(options.severity);
    title = `${options.severity.charAt(0).toUpperCase() + options.severity.slice(1)} Issues`;
  } else {
    issues = manager.getOpenIssues();
    title = 'All Open Issues';
  }

  printSection(title);

  if (issues.length === 0) {
    console.log(`  ${c.dim}No issues found${c.reset}`);
    return;
  }

  for (const issue of issues) {
    formatIssue(issue, options.verbose);
  }

  console.log(`\n${c.dim}Total: ${issues.length} items${c.reset}`);
}

function runFix(manager) {
  const fixable = manager.getAutoFixable();

  if (fixable.length === 0) {
    console.log(`${c.yellow}No auto-fixable issues found.${c.reset}`);
    return;
  }

  console.log(`${c.cyan}Running auto-fix on ${fixable.length} items...${c.reset}\n`);

  const result = manager.runAutoFix();

  if (result.fixed > 0) {
    console.log(`${c.green}✓ Fixed ${result.fixed} issues${c.reset}`);
    for (const file of result.files) {
      console.log(`  ${c.dim}${file}${c.reset}`);
    }
  }

  if (result.failed > 0) {
    console.log(`\n${c.yellow}⚠ Could not fix ${result.failed} issues${c.reset}`);
    for (const { issue, reason } of result.details.failed) {
      console.log(`  ${c.dim}[${issue.id}] ${reason}${c.reset}`);
    }
  }
}

function dismissIssue(manager, id, reason) {
  if (manager.dismiss(id, reason)) {
    console.log(`${c.green}✓ Dismissed: ${id}${c.reset}`);
  } else {
    console.log(`${c.red}✗ Issue not found: ${id}${c.reset}`);
  }
}

function promoteIssue(manager, id) {
  const result = manager.promoteToTask(id);
  if (result.success) {
    console.log(`${c.green}✓ Created task: ${result.taskId}${c.reset}`);
  } else {
    console.log(`${c.red}✗ ${result.error}${c.reset}`);
  }
}

function showHelp() {
  console.log(`
${c.bold}Technical Debt Manager${c.reset}

${c.cyan}Usage:${c.reset}
  flow tech-debt                    Show summary dashboard
  flow tech-debt list               List all open items
  flow tech-debt list --aging       Show items seen 3+ sessions
  flow tech-debt list --fixable     Show auto-fixable items
  flow tech-debt list --severity X  Filter by severity (critical/high/medium/low)
  flow tech-debt fix                Run auto-fixes (batch)
  flow tech-debt dismiss <id>       Mark as won't-fix
  flow tech-debt promote <id>       Create task from debt item
  flow tech-debt promote-aging      Create tasks for all aging items

${c.cyan}Options:${c.reset}
  -v, --verbose    Show detailed descriptions
  --help           Show this help

${c.cyan}Examples:${c.reset}
  flow tech-debt list --aging -v    Show aging items with details
  flow tech-debt fix                Auto-fix all safe items
  flow tech-debt dismiss td-abc123  Dismiss a specific item
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'summary';

  const manager = new TechDebtManager();

  // Parse flags
  const flags = {
    aging: args.includes('--aging'),
    fixable: args.includes('--fixable'),
    verbose: args.includes('-v') || args.includes('--verbose'),
    severity: null
  };

  const severityIndex = args.indexOf('--severity');
  if (severityIndex !== -1 && args[severityIndex + 1]) {
    flags.severity = args[severityIndex + 1];
  }

  switch (command) {
    case 'summary':
    case 'status':
      showSummary(manager);
      break;

    case 'list':
      showList(manager, flags);
      break;

    case 'fix':
      runFix(manager);
      break;

    case 'dismiss':
      const dismissId = args[1];
      const reason = args.slice(2).join(' ');
      if (!dismissId) {
        console.log(`${c.red}Usage: flow tech-debt dismiss <id> [reason]${c.reset}`);
        process.exit(1);
      }
      dismissIssue(manager, dismissId, reason);
      break;

    case 'promote':
      const promoteId = args[1];
      if (!promoteId) {
        console.log(`${c.red}Usage: flow tech-debt promote <id>${c.reset}`);
        process.exit(1);
      }
      promoteIssue(manager, promoteId);
      break;

    case 'promote-aging':
      const promoted = manager.promoteAgingToTasks();
      if (promoted.length > 0) {
        console.log(`${c.green}✓ Created ${promoted.length} tasks from aging items:${c.reset}`);
        for (const { issue, taskId } of promoted) {
          console.log(`  ${taskId}: ${issue.description.slice(0, 50)}`);
        }
      } else {
        console.log(`${c.dim}No aging items to promote${c.reset}`);
      }
      break;

    case '--help':
    case 'help':
      showHelp();
      break;

    default:
      console.log(`${c.red}Unknown command: ${command}${c.reset}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  TechDebtManager,
  generateDebtId,
  AUTO_FIXABLE_TYPES,
  DEFAULT_AGING_THRESHOLD
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
