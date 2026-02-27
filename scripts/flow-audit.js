#!/usr/bin/env node

/**
 * Wogi Flow - Project Audit Helpers
 *
 * Provides utility functions for the /wogi-audit command.
 * The AI orchestrates the full 7-agent audit; this script
 * provides fast, reliable helper operations.
 *
 * Commands:
 *   flow-audit.js files     - List all project files (excluding generated/deps)
 *   flow-audit.js todos     - Find all TODO/FIXME/HACK comments
 *   flow-audit.js outdated  - Run npm outdated (structured output)
 *   flow-audit.js audit     - Run npm audit (structured output)
 *   flow-audit.js score     - Calculate weighted health score
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PATHS,
  getConfig,
  color,
  safeJsonParse,
  safeJsonParseString
} = require('./flow-utils');

// Default exclusion patterns for project file scanning
const DEFAULT_EXCLUDE = [
  /^node_modules\//,
  /^\.workflow\/state\//,
  /^dist\//,
  /^build\//,
  /^\.git\//,
  /^coverage\//,
  /\.min\.js$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /bun\.lockb$/
];

/**
 * Get all tracked project files, excluding generated/dependency dirs.
 * @param {string[]} extraExcludes - Additional patterns to exclude
 * @returns {string[]}
 */
function getProjectFiles(extraExcludes = []) {
  try {
    const output = execFileSync('git', [
      'ls-files', '--cached', '--others', '--exclude-standard'
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    const config = getConfig();
    // Escape config-sourced strings before RegExp to prevent ReDoS/injection
    const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const configExcludes = (config.audit?.exclude || []).map(p => {
      try { return new RegExp(`^${escapeRegex(p)}/`); } catch (err) { return null; }
    }).filter(Boolean);
    const allExcludes = [...DEFAULT_EXCLUDE, ...configExcludes, ...extraExcludes.map(p => {
      try { return new RegExp(p); } catch (err) { return null; }
    }).filter(Boolean)];

    return output.trim().split('\n').filter(f =>
      f && !allExcludes.some(p => p.test(f))
    );
  } catch (err) {
    console.error(`Error listing files: ${err.message}`);
    return [];
  }
}

/**
 * Find all TODO/FIXME/HACK/WORKAROUND/TEMPORARY comments in the project.
 * @returns {{ type: string, file: string, line: number, text: string }[]}
 */
function findTodos() {
  const patterns = ['TODO', 'FIXME', 'HACK', 'WORKAROUND', 'TEMPORARY'];
  const results = [];

  try {
    // Use git grep instead of system grep — cross-platform, auto-respects .gitignore
    for (const pattern of patterns) {
      try {
        const output = execFileSync('git', [
          'grep', '-n', pattern, '--',
          '*.js', '*.ts', '*.tsx', '*.jsx', '*.mjs', '*.cjs'
        ], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd()
        });

        for (const line of output.trim().split('\n')) {
          if (!line) continue;
          const match = line.match(/^(.+):(\d+):(.+)$/);
          if (match) {
            results.push({
              type: pattern,
              file: match[1],
              line: parseInt(match[2], 10),
              text: match[3].trim()
            });
          }
        }
      } catch {
        // git grep returns exit code 1 when no matches — not an error
      }
    }
  } catch (err) {
    console.error(`Error finding TODOs: ${err.message}`);
  }

  return results;
}

/**
 * Run npm outdated and return structured results.
 * @returns {{ name: string, current: string, wanted: string, latest: string, type: string }[]}
 */
function getOutdatedDeps() {
  try {
    const output = execFileSync('npm', ['outdated', '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const data = safeJsonParseString(output || '{}', {});
    return Object.entries(data).map(([name, info]) => ({
      name,
      current: info.current || 'N/A',
      wanted: info.wanted || 'N/A',
      latest: info.latest || 'N/A',
      type: info.type || 'dependencies'
    }));
  } catch (err) {
    // npm outdated exits with code 1 when outdated deps exist
    try {
      if (err.stdout) {
        const data = safeJsonParseString(err.stdout || '{}', {});
        return Object.entries(data).map(([name, info]) => ({
          name,
          current: info.current || 'N/A',
          wanted: info.wanted || 'N/A',
          latest: info.latest || 'N/A',
          type: info.type || 'dependencies'
        }));
      }
    } catch {
      // Parsing failed
    }
    return [];
  }
}

/**
 * Run npm audit and return structured results.
 * @returns {{ vulnerabilities: number, info: number, low: number, moderate: number, high: number, critical: number }}
 */
function getAuditResults() {
  try {
    const output = execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const data = safeJsonParseString(output || '{}', {});
    const meta = data.metadata?.vulnerabilities || {};
    return {
      vulnerabilities: meta.total || 0,
      info: meta.info || 0,
      low: meta.low || 0,
      moderate: meta.moderate || 0,
      high: meta.high || 0,
      critical: meta.critical || 0
    };
  } catch (err) {
    // npm audit exits with non-zero when vulnerabilities exist
    try {
      if (err.stdout) {
        const data = safeJsonParseString(err.stdout || '{}', {});
        const meta = data.metadata?.vulnerabilities || {};
        return {
          vulnerabilities: meta.total || 0,
          info: meta.info || 0,
          low: meta.low || 0,
          moderate: meta.moderate || 0,
          high: meta.high || 0,
          critical: meta.critical || 0
        };
      }
    } catch {
      // Parsing failed
    }
    return { vulnerabilities: 0, info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  }
}

// Score mapping: letter grades to numeric values
const SCORE_MAP = {
  'A+': 97, 'A': 93, 'A-': 90,
  'B+': 87, 'B': 83, 'B-': 80,
  'C+': 77, 'C': 73, 'C-': 70,
  'D+': 67, 'D': 63, 'D-': 57,
  'F': 40
};

const GRADE_THRESHOLDS = [
  { min: 95, grade: 'A+' }, { min: 90, grade: 'A' }, { min: 87, grade: 'A-' },
  { min: 83, grade: 'B+' }, { min: 80, grade: 'B' }, { min: 77, grade: 'B-' },
  { min: 73, grade: 'C+' }, { min: 70, grade: 'C' }, { min: 67, grade: 'C-' },
  { min: 63, grade: 'D+' }, { min: 60, grade: 'D' }, { min: 57, grade: 'D-' },
  { min: 0, grade: 'F' }
];

/**
 * Calculate weighted health score from individual agent scores.
 * @param {Object} scores - { architecture: "B+", dependencies: "A-", ... }
 * @returns {{ overall: string, numeric: number, breakdown: Object }}
 */
function calculateHealthScore(scores) {
  const config = getConfig();
  const weights = config.audit?.scoring?.weights || {
    architecture: 0.25,
    dependencies: 0.15,
    duplication: 0.15,
    performance: 0.15,
    consistency: 0.10,
    modernization: 0.10,
    techDebt: 0.10
  };

  let totalWeight = 0;
  let weightedSum = 0;
  const breakdown = {};

  for (const [dimension, weight] of Object.entries(weights)) {
    const grade = scores[dimension];
    if (grade && SCORE_MAP[grade] !== undefined) {
      const numeric = SCORE_MAP[grade];
      weightedSum += numeric * weight;
      totalWeight += weight;
      breakdown[dimension] = { grade, numeric, weight };
    }
  }

  const overallNumeric = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const overallGrade = GRADE_THRESHOLDS.find(t => overallNumeric >= t.min)?.grade || 'F';

  return {
    overall: overallGrade,
    numeric: overallNumeric,
    breakdown
  };
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
  const command = process.argv[2];

  switch (command) {
    case 'files': {
      const files = getProjectFiles();
      console.log(JSON.stringify({ count: files.length, files }, null, 2));
      break;
    }

    case 'todos': {
      const todos = findTodos();
      const summary = {};
      for (const todo of todos) {
        summary[todo.type] = (summary[todo.type] || 0) + 1;
      }
      console.log(JSON.stringify({ total: todos.length, summary, items: todos }, null, 2));
      break;
    }

    case 'outdated': {
      const deps = getOutdatedDeps();
      console.log(JSON.stringify({ count: deps.length, packages: deps }, null, 2));
      break;
    }

    case 'audit': {
      const results = getAuditResults();
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'score': {
      // Read scores from CLI arg
      // Usage: node scripts/flow-audit.js score '{"architecture":"B+","dependencies":"A-"}'
      let scores = {};
      const scoresArg = process.argv[3];
      if (scoresArg) {
        scores = safeJsonParseString(scoresArg, null);
        if (scores === null) {
          console.error('Invalid JSON scores argument');
          process.exit(1);
        }
      }
      const result = calculateHealthScore(scores);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default: {
      console.log(`
Wogi Flow - Project Audit Helpers

Usage: flow-audit.js <command>

Commands:
  files      List all project files (excluding generated/deps)
  todos      Find all TODO/FIXME/HACK comments
  outdated   Run npm outdated (structured JSON output)
  audit      Run npm audit (structured JSON output)
  score      Calculate weighted health score from agent grades

Score usage:
  node scripts/flow-audit.js score '{"architecture":"B+","dependencies":"A-"}'
`);
      break;
    }
  }
}

module.exports = {
  getProjectFiles,
  findTodos,
  getOutdatedDeps,
  getAuditResults,
  calculateHealthScore
};

if (require.main === module) {
  main();
}
