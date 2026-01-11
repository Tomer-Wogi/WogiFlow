#!/usr/bin/env node

/**
 * Wogi Flow - Command Metrics Tracking
 *
 * Tracks command success/failure rates to surface problematic tools.
 * Based on insight that tool reliability is a primary bottleneck.
 *
 * Usage as module:
 *   const { recordCommandResult, getProblematicCommands } = require('./flow-metrics');
 *   recordCommandResult('npm test', { success: true, duration: 2340 });
 *
 * Usage as CLI:
 *   flow metrics              # Show metrics summary
 *   flow metrics --json       # Output as JSON
 *   flow metrics --reset      # Clear metrics
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, PATHS, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const METRICS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'command-metrics.json');

// ============================================================
// Metrics Data Structure
// ============================================================

function getEmptyMetrics() {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    commands: {},
    recentFailures: [],
    summary: {
      totalRuns: 0,
      totalSuccesses: 0,
      totalFailures: 0
    }
  };
}

function loadMetrics() {
  try {
    if (fs.existsSync(METRICS_PATH)) {
      return JSON.parse(fs.readFileSync(METRICS_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error(`${colors.yellow}Warning: Could not load metrics, starting fresh${colors.reset}`);
  }
  return getEmptyMetrics();
}

function saveMetrics(metrics) {
  metrics.lastUpdated = new Date().toISOString();
  const dir = path.dirname(METRICS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Normalize command for consistent tracking
 * Removes dynamic parts like file paths, timestamps
 */
function normalizeCommand(command) {
  return command
    .replace(/\/[^\s]+\.(ts|tsx|js|jsx|json|md)/g, '*.{ext}')  // Normalize file paths
    .replace(/\d{13,}/g, '{timestamp}')                         // Remove timestamps
    .replace(/--fix\s+\S+/g, '--fix {file}')                   // Normalize eslint fix
    .trim();
}

/**
 * Record a command execution result
 * @param {string} command - The command that was run
 * @param {object} result - { success: boolean, duration?: number, exitCode?: number, errorType?: string }
 */
function recordCommandResult(command, result) {
  const config = getConfig();
  if (!config.metrics?.enabled) return;

  const metrics = loadMetrics();
  const key = normalizeCommand(command);

  // Initialize command entry if needed
  if (!metrics.commands[key]) {
    metrics.commands[key] = {
      totalRuns: 0,
      successes: 0,
      failures: 0,
      avgDuration: 0,
      lastRun: null,
      lastSuccess: null,
      lastFailure: null,
      errorTypes: {}
    };
  }

  const cmd = metrics.commands[key];
  cmd.totalRuns++;
  cmd.lastRun = new Date().toISOString();

  if (result.success) {
    cmd.successes++;
    cmd.lastSuccess = cmd.lastRun;
  } else {
    cmd.failures++;
    cmd.lastFailure = cmd.lastRun;

    // Track error types
    if (result.errorType) {
      cmd.errorTypes[result.errorType] = (cmd.errorTypes[result.errorType] || 0) + 1;
    }

    // Add to recent failures (keep last 20)
    metrics.recentFailures.unshift({
      command: key,
      timestamp: cmd.lastRun,
      exitCode: result.exitCode || null,
      errorType: result.errorType || null,
      errorSummary: result.errorSummary || null
    });
    metrics.recentFailures = metrics.recentFailures.slice(0, 20);
  }

  // Update average duration
  if (result.duration) {
    const prevTotal = cmd.avgDuration * (cmd.totalRuns - 1);
    cmd.avgDuration = Math.round((prevTotal + result.duration) / cmd.totalRuns);
  }

  // Update summary
  metrics.summary.totalRuns++;
  if (result.success) {
    metrics.summary.totalSuccesses++;
  } else {
    metrics.summary.totalFailures++;
  }

  saveMetrics(metrics);
}

/**
 * Get commands with failure rate above threshold
 * @param {number} threshold - Failure rate threshold (0-1), default 0.3
 */
function getProblematicCommands(threshold = 0.3) {
  const metrics = loadMetrics();

  return Object.entries(metrics.commands)
    .filter(([_, cmd]) => {
      const failureRate = cmd.failures / cmd.totalRuns;
      return failureRate > threshold && cmd.totalRuns >= 3; // Minimum 3 runs for significance
    })
    .map(([key, cmd]) => ({
      command: key,
      failureRate: (cmd.failures / cmd.totalRuns * 100).toFixed(1) + '%',
      totalRuns: cmd.totalRuns,
      failures: cmd.failures,
      topErrors: Object.entries(cmd.errorTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => `${type} (${count})`),
      lastFailure: cmd.lastFailure
    }))
    .sort((a, b) => parseFloat(b.failureRate) - parseFloat(a.failureRate));
}

/**
 * Get overall metrics summary
 */
function getMetricsSummary() {
  const metrics = loadMetrics();
  const problematic = getProblematicCommands();

  const commandStats = Object.entries(metrics.commands)
    .map(([key, cmd]) => ({
      command: key,
      runs: cmd.totalRuns,
      successRate: cmd.totalRuns > 0
        ? ((cmd.successes / cmd.totalRuns) * 100).toFixed(1) + '%'
        : 'N/A',
      avgDuration: cmd.avgDuration ? `${cmd.avgDuration}ms` : 'N/A',
      lastRun: cmd.lastRun
    }))
    .sort((a, b) => b.runs - a.runs);

  return {
    lastUpdated: metrics.lastUpdated,
    summary: {
      totalCommands: Object.keys(metrics.commands).length,
      totalRuns: metrics.summary.totalRuns,
      overallSuccessRate: metrics.summary.totalRuns > 0
        ? ((metrics.summary.totalSuccesses / metrics.summary.totalRuns) * 100).toFixed(1) + '%'
        : 'N/A',
      problematicCount: problematic.length
    },
    topCommands: commandStats.slice(0, 10),
    problematicCommands: problematic,
    recentFailures: metrics.recentFailures.slice(0, 5)
  };
}

/**
 * Format metrics as human-readable report
 */
function formatMetricsReport() {
  const summary = getMetricsSummary();
  let output = '';

  output += `${colors.cyan}Command Metrics Report${colors.reset}\n`;
  output += `${'═'.repeat(50)}\n\n`;

  // Overall summary
  output += `${colors.bold}Overall Summary${colors.reset}\n`;
  output += `  Total commands tracked: ${summary.summary.totalCommands}\n`;
  output += `  Total runs: ${summary.summary.totalRuns}\n`;
  output += `  Overall success rate: ${summary.summary.overallSuccessRate}\n`;
  output += `  Problematic commands: ${summary.summary.problematicCount}\n`;
  output += `  Last updated: ${summary.lastUpdated}\n\n`;

  // Problematic commands (if any)
  if (summary.problematicCommands.length > 0) {
    output += `${colors.red}${colors.bold}Problematic Commands (>30% failure rate)${colors.reset}\n`;
    for (const cmd of summary.problematicCommands) {
      output += `  ${colors.red}!${colors.reset} ${cmd.command}\n`;
      output += `    Failure rate: ${cmd.failureRate} (${cmd.failures}/${cmd.totalRuns})\n`;
      if (cmd.topErrors.length > 0) {
        output += `    Top errors: ${cmd.topErrors.join(', ')}\n`;
      }
    }
    output += '\n';
  }

  // Top commands by usage
  output += `${colors.bold}Top Commands by Usage${colors.reset}\n`;
  for (const cmd of summary.topCommands.slice(0, 5)) {
    const statusIcon = parseFloat(cmd.successRate) >= 90
      ? colors.green + '✓' + colors.reset
      : parseFloat(cmd.successRate) >= 70
        ? colors.yellow + '~' + colors.reset
        : colors.red + '!' + colors.reset;
    output += `  ${statusIcon} ${cmd.command}\n`;
    output += `    Runs: ${cmd.runs} | Success: ${cmd.successRate} | Avg: ${cmd.avgDuration}\n`;
  }
  output += '\n';

  // Recent failures
  if (summary.recentFailures.length > 0) {
    output += `${colors.bold}Recent Failures${colors.reset}\n`;
    for (const failure of summary.recentFailures) {
      const time = new Date(failure.timestamp).toLocaleString();
      output += `  ${colors.dim}${time}${colors.reset} ${failure.command}\n`;
      if (failure.errorType) {
        output += `    ${colors.red}${failure.errorType}${colors.reset}\n`;
      }
    }
  }

  return output;
}

/**
 * Reset all metrics
 */
function resetMetrics() {
  saveMetrics(getEmptyMetrics());
  console.log(`${colors.green}✓${colors.reset} Metrics reset`);
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Command Metrics

Usage:
  flow metrics              Show metrics summary
  flow metrics --json       Output as JSON
  flow metrics --reset      Clear all metrics
  flow metrics --problems   Show only problematic commands

Options:
  --json       Output in JSON format
  --reset      Clear all metrics data
  --problems   Show commands with high failure rates
  --help, -h   Show this help
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--reset')) {
    resetMetrics();
    process.exit(0);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(getMetricsSummary(), null, 2));
    process.exit(0);
  }

  if (args.includes('--problems')) {
    const problems = getProblematicCommands();
    if (problems.length === 0) {
      console.log(`${colors.green}✓${colors.reset} No problematic commands found`);
    } else {
      console.log(`${colors.red}Found ${problems.length} problematic command(s):${colors.reset}\n`);
      for (const p of problems) {
        console.log(`  ${p.command}`);
        console.log(`    Failure rate: ${p.failureRate}`);
        console.log(`    Top errors: ${p.topErrors.join(', ') || 'Unknown'}\n`);
      }
    }
    process.exit(0);
  }

  // Default: show full report
  console.log(formatMetricsReport());
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  recordCommandResult,
  getProblematicCommands,
  getMetricsSummary,
  formatMetricsReport,
  resetMetrics,
  loadMetrics,
  normalizeCommand
};

if (require.main === module) {
  main();
}
