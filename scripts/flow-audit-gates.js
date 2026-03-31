#!/usr/bin/env node

/**
 * Wogi Flow - Audit Gate 0: Pre-Agent Baseline Checks
 *
 * Runs BEFORE the 7 analysis agents to establish a project health baseline.
 * These are hard, verifiable checks — not AI judgment. They produce quantitative
 * metrics that cap the final audit score.
 *
 * A project that can't build should never score higher than D, regardless
 * of how elegant its architecture is.
 *
 * Commands:
 *   flow-audit-gates.js run          — Run all Gate 0 checks
 *   flow-audit-gates.js build        — Build check only
 *   flow-audit-gates.js typecheck    — Typecheck only
 *   flow-audit-gates.js lint         — Lint check only
 *   flow-audit-gates.js lint-config  — Lint config integrity
 *   flow-audit-gates.js tests        — Test check only
 *   flow-audit-gates.js scripts      — Package.json script completeness
 *   flow-audit-gates.js dead-exports — Find exported functions with no importers
 *   flow-audit-gates.js eslint-disable — Count eslint-disable comments
 *   flow-audit-gates.js dep-health   — Dependency health (outdated, deprecated)
 *   flow-audit-gates.js git-health   — Git history health indicators
 *   flow-audit-gates.js env-hygiene  — Environment/config hygiene
 *   flow-audit-gates.js test-coverage — Test coverage metrics
 *   flow-audit-gates.js framework    — Auto-detect framework
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { PATHS, getConfig, safeJsonParse, color } = require('./flow-utils');

// ============================================================
// Score Cap Thresholds
// ============================================================

/** Grade values for comparison (higher = better) */
const GRADE_VALUES = { 'A+': 97, 'A': 93, 'A-': 90, 'B+': 87, 'B': 83, 'B-': 80, 'C+': 77, 'C': 73, 'C-': 70, 'D+': 67, 'D': 63, 'D-': 60, 'F': 50 };

/**
 * Convert a numeric score to a letter grade.
 * @param {number} score — 0-100
 * @returns {string} letter grade
 */
function scoreToGrade(score) {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

// ============================================================
// Gate 0 Checks
// ============================================================

/**
 * Run a project script and capture results.
 * @param {string} scriptName — npm script name (e.g., 'build', 'typecheck')
 * @param {number} [timeout=60000] — timeout in ms
 * @returns {{ exists: boolean, passed: boolean, output: string, errorCount: number }}
 */
function runProjectScript(scriptName, timeout = 60000) {
  const pkgPath = path.join(PATHS.root, 'package.json');
  const pkg = safeJsonParse(pkgPath, {});
  const scripts = pkg.scripts || {};

  if (!scripts[scriptName]) {
    return { exists: false, passed: false, output: `Script "${scriptName}" not defined in package.json`, errorCount: 0 };
  }

  try {
    const output = execFileSync('npm', ['run', scriptName], {
      cwd: PATHS.root,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    });
    return { exists: true, passed: true, output: output.substring(0, 5000), errorCount: 0 };
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    // Count error lines
    const errorCount = (output.match(/error TS\d+|Error:|ERROR/gi) || []).length;
    return { exists: true, passed: false, output: output.substring(0, 5000), errorCount };
  }
}

/**
 * Gate: Build check — does the project compile?
 */
function checkBuild() {
  const result = runProjectScript('build', 120000);
  let scoreCap = 100;
  if (result.exists && !result.passed) scoreCap = 63; // D max

  return {
    gate: 'build',
    ...result,
    scoreCap,
    severity: result.passed ? 'pass' : 'critical',
    message: !result.exists ? 'No build script defined' :
      result.passed ? 'Build succeeds' :
        `Build FAILS — project cannot be deployed (cap: D)`
  };
}

/**
 * Gate: Typecheck — how many type errors?
 */
function checkTypecheck() {
  const result = runProjectScript('typecheck', 120000);

  // Parse error count from output
  let errorCount = result.errorCount;
  if (!errorCount && result.output) {
    // Try to parse TS error count from "Found N errors" pattern
    const match = result.output.match(/Found (\d+) errors?/i);
    if (match) errorCount = parseInt(match[1], 10);
    // Or count "error TS" lines
    if (!errorCount) {
      errorCount = (result.output.match(/error TS\d+/g) || []).length;
    }
  }

  let scoreCap = 100;
  if (errorCount > 500) scoreCap = 67;      // D+ max
  else if (errorCount > 100) scoreCap = 73;  // C max
  else if (errorCount > 50) scoreCap = 77;   // C+ max

  return {
    gate: 'typecheck',
    ...result,
    errorCount,
    scoreCap,
    severity: !result.exists ? 'info' :
      result.passed ? 'pass' :
        errorCount > 100 ? 'critical' : 'high',
    message: !result.exists ? 'No typecheck script defined' :
      result.passed ? 'Typecheck passes (0 errors)' :
        `Typecheck FAILS: ${errorCount} error(s) (cap: ${scoreToGrade(scoreCap)})`
  };
}

/**
 * Gate: Lint check — count errors vs warnings.
 */
function checkLint() {
  const result = runProjectScript('lint', 60000);

  // Parse error/warning counts
  let errorCount = 0;
  let warningCount = 0;
  if (result.output) {
    // ESLint format: "N problems (X errors, Y warnings)"
    const match = result.output.match(/(\d+) problems?\s*\((\d+) errors?,\s*(\d+) warnings?\)/);
    if (match) {
      errorCount = parseInt(match[2], 10);
      warningCount = parseInt(match[3], 10);
    }
  }

  let scoreCap = 100;
  if (errorCount > 50) scoreCap = 73; // C max

  return {
    gate: 'lint',
    ...result,
    errorCount,
    warningCount,
    scoreCap,
    severity: !result.exists ? 'info' :
      errorCount > 50 ? 'critical' :
        errorCount > 0 ? 'high' :
          warningCount > 50 ? 'medium' : 'pass',
    message: !result.exists ? 'No lint script defined' :
      errorCount === 0 && warningCount === 0 ? 'Lint passes (0 errors, 0 warnings)' :
        `Lint: ${errorCount} error(s), ${warningCount} warning(s)${scoreCap < 100 ? ` (cap: ${scoreToGrade(scoreCap)})` : ''}`
  };
}

/**
 * Gate: Lint config integrity — detect downgraded rules.
 * Checks if rules that should be 'error' (per recommended presets) are set to 'warn' or 'off'.
 */
function checkLintConfigIntegrity() {
  const result = {
    gate: 'lint-config',
    exists: false,
    downgradedRules: [],
    scorePenalty: 0,
    severity: 'pass',
    message: 'No lint config found'
  };

  // Find ESLint config
  const configFiles = [
    'eslint.config.js', 'eslint.config.ts', 'eslint.config.mjs',
    '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc'
  ];

  let configPath = null;
  for (const f of configFiles) {
    const p = path.join(PATHS.root, f);
    if (fs.existsSync(p)) { configPath = p; break; }
  }
  if (!configPath) return result;

  result.exists = true;
  let content;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch (_err) {
    result.message = 'Lint config found but unreadable';
    return result;
  }

  // Rules that should be 'error' per recommended presets
  const SHOULD_BE_ERROR = [
    'react-hooks/rules-of-hooks',
    'react-hooks/exhaustive-deps',
    'no-undef',
    'no-unused-vars',
    '@typescript-eslint/no-unused-vars',
    'no-dupe-keys',
    'no-duplicate-case',
    'no-unreachable',
    'no-constant-condition',
    'no-empty-pattern',
    'no-self-assign',
    'no-unsafe-negation',
    'no-loss-of-precision',
    'no-import-assign'
  ];

  for (const rule of SHOULD_BE_ERROR) {
    // Check for patterns like: 'rule-name': 'warn' or "rule-name": "warn" or 'rule-name': 'off'
    const escaped = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const warnPattern = new RegExp(`['"]${escaped}['"]\\s*:\\s*['"](?:warn|off|0)['"]`);
    if (warnPattern.test(content)) {
      result.downgradedRules.push(rule);
    }
  }

  if (result.downgradedRules.length > 0) {
    result.scorePenalty = Math.min(15, result.downgradedRules.length * 3);
    result.severity = result.downgradedRules.length > 3 ? 'critical' : 'high';
    result.message = `Lint config: ${result.downgradedRules.length} rule(s) downgraded from error to warn/off (-${result.scorePenalty} pts): ${result.downgradedRules.join(', ')}`;
  } else {
    result.message = 'Lint config integrity: no downgraded rules detected';
  }

  return result;
}

/**
 * Gate: Tests — do tests pass?
 */
function checkTests() {
  const result = runProjectScript('test', 120000);
  return {
    gate: 'tests',
    ...result,
    scoreCap: 100, // Test failure doesn't cap, but is a HIGH finding
    severity: !result.exists ? 'info' :
      result.passed ? 'pass' : 'high',
    message: !result.exists ? 'No test script defined' :
      result.passed ? 'Tests pass' : 'Tests FAIL'
  };
}

/**
 * Gate: Package.json script completeness.
 */
function checkScriptCompleteness() {
  const pkgPath = path.join(PATHS.root, 'package.json');
  const pkg = safeJsonParse(pkgPath, {});
  const scripts = pkg.scripts || {};

  const EXPECTED = ['build', 'test', 'lint', 'typecheck', 'dev'];
  const missing = EXPECTED.filter(s => !scripts[s] && !scripts[`${s}:check`]);

  return {
    gate: 'scripts',
    missing,
    present: EXPECTED.filter(s => scripts[s] || scripts[`${s}:check`]),
    severity: missing.length > 2 ? 'high' : missing.length > 0 ? 'medium' : 'pass',
    message: missing.length === 0 ? 'All expected scripts present' :
      `Missing scripts: ${missing.join(', ')} (${missing.length}/${EXPECTED.length})`
  };
}

// ============================================================
// Extended Checks (run alongside agents)
// ============================================================

/**
 * Count eslint-disable comments across the project.
 */
function countEslintDisables() {
  try {
    const output = execFileSync('grep', [
      '-r', 'eslint-disable',
      '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx',
      '-c', '.'
    ], { cwd: PATHS.root, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    const lines = output.trim().split('\n').filter(Boolean);
    let total = 0;
    const byFile = [];
    for (const line of lines) {
      const match = line.match(/:(\d+)$/);
      if (match) {
        const count = parseInt(match[1], 10);
        total += count;
        if (count > 3) byFile.push({ file: line.replace(/:(\d+)$/, ''), count });
      }
    }
    return {
      total,
      byFile: byFile.sort((a, b) => b.count - a.count).slice(0, 10),
      severity: total > 50 ? 'high' : total > 20 ? 'medium' : total > 0 ? 'low' : 'pass'
    };
  } catch (_err) {
    return { total: 0, byFile: [], severity: 'pass' };
  }
}

/**
 * Detect project framework from package.json.
 */
function detectFramework() {
  const pkgPath = path.join(PATHS.root, 'package.json');
  const pkg = safeJsonParse(pkgPath, {});
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const frameworks = [];
  if (allDeps['next']) frameworks.push({ name: 'nextjs', version: allDeps['next'] });
  if (allDeps['react']) frameworks.push({ name: 'react', version: allDeps['react'] });
  if (allDeps['vue']) frameworks.push({ name: 'vue', version: allDeps['vue'] });
  if (allDeps['svelte'] || allDeps['@sveltejs/kit']) frameworks.push({ name: 'svelte', version: allDeps['svelte'] || allDeps['@sveltejs/kit'] });
  if (allDeps['@angular/core']) frameworks.push({ name: 'angular', version: allDeps['@angular/core'] });
  if (allDeps['@nestjs/core']) frameworks.push({ name: 'nestjs', version: allDeps['@nestjs/core'] });
  if (allDeps['express']) frameworks.push({ name: 'express', version: allDeps['express'] });
  if (allDeps['fastify']) frameworks.push({ name: 'fastify', version: allDeps['fastify'] });
  if (allDeps['hono']) frameworks.push({ name: 'hono', version: allDeps['hono'] });

  const hasTypescript = !!allDeps['typescript'];
  const hasMonorepo = fs.existsSync(path.join(PATHS.root, 'packages')) ||
    fs.existsSync(path.join(PATHS.root, 'apps')) ||
    (pkg.workspaces && pkg.workspaces.length > 0);

  return { frameworks, hasTypescript, hasMonorepo, language: hasTypescript ? 'typescript' : 'javascript' };
}

/**
 * Check git health indicators.
 */
function checkGitHealth() {
  const result = {
    commitFrequency: 'unknown',
    staleBranches: 0,
    uncommittedFiles: 0,
    conventionalCommits: false,
    recentCommits: 0
  };

  try {
    // Commits in last 30 days
    const recent = execSync('git log --oneline --since="30 days ago" 2>/dev/null | wc -l', {
      cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
    }).trim();
    result.recentCommits = parseInt(recent, 10) || 0;
    result.commitFrequency = result.recentCommits > 60 ? 'high' :
      result.recentCommits > 20 ? 'medium' :
        result.recentCommits > 0 ? 'low' : 'inactive';

    // Stale branches (>30 days, not merged)
    try {
      const branches = execSync('git branch -r --no-merged 2>/dev/null | wc -l', {
        cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
      }).trim();
      result.staleBranches = parseInt(branches, 10) || 0;
    } catch (_err) { /* non-critical */ }

    // Uncommitted changes
    try {
      const status = execSync('git status --porcelain 2>/dev/null | wc -l', {
        cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
      }).trim();
      result.uncommittedFiles = parseInt(status, 10) || 0;
    } catch (_err) { /* non-critical */ }

    // Check if last 10 commits use conventional format
    try {
      const msgs = execSync('git log --oneline -10 2>/dev/null', {
        cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
      }).trim();
      const lines = msgs.split('\n').filter(Boolean);
      const conventional = lines.filter(l => /^\w+ (feat|fix|docs|style|refactor|perf|test|chore|ci|build)\(?/.test(l));
      result.conventionalCommits = conventional.length >= lines.length * 0.5;
    } catch (_err) { /* non-critical */ }
  } catch (_err) {
    // Git not available
  }

  return result;
}

/**
 * Check environment/config hygiene.
 */
function checkEnvHygiene() {
  const checks = [];

  // .env.example exists?
  const hasEnvExample = fs.existsSync(path.join(PATHS.root, '.env.example'));
  const hasEnv = fs.existsSync(path.join(PATHS.root, '.env'));
  const hasGitignore = fs.existsSync(path.join(PATHS.root, '.gitignore'));

  checks.push({
    check: '.env.example',
    status: hasEnvExample ? 'pass' : (hasEnv ? 'fail' : 'na'),
    message: hasEnvExample ? '.env.example exists' :
      hasEnv ? '.env exists but no .env.example — other devs can\'t set up' : 'No .env files'
  });

  // .env in .gitignore?
  if (hasGitignore && hasEnv) {
    let gitignore = '';
    try {
      gitignore = fs.readFileSync(path.join(PATHS.root, '.gitignore'), 'utf-8');
    } catch (_err) {
      // Unreadable — skip this check
    }
    const envIgnored = gitignore.split('\n').some(l => l.trim() === '.env' || l.trim() === '.env*');
    checks.push({
      check: '.env in .gitignore',
      status: envIgnored ? 'pass' : 'fail',
      message: envIgnored ? '.env is gitignored' : 'WARNING: .env is NOT in .gitignore — secrets may be committed'
    });
  }

  // CI config exists?
  const ciConfigs = [
    '.github/workflows',
    '.gitlab-ci.yml',
    'Jenkinsfile',
    '.circleci/config.yml',
    'bitbucket-pipelines.yml'
  ];
  const hasCI = ciConfigs.some(c => fs.existsSync(path.join(PATHS.root, c)));
  checks.push({
    check: 'CI configuration',
    status: hasCI ? 'pass' : 'fail',
    message: hasCI ? 'CI pipeline configured' : 'No CI configuration found — no automated quality enforcement'
  });

  // Docker?
  const hasDocker = fs.existsSync(path.join(PATHS.root, 'Dockerfile')) ||
    fs.existsSync(path.join(PATHS.root, 'docker-compose.yml'));
  if (hasDocker) {
    checks.push({ check: 'Docker', status: 'info', message: 'Dockerfile/docker-compose found' });
  }

  return checks;
}

// ============================================================
// Score Capping
// ============================================================

/**
 * Calculate the Gate 0 score cap from all gate results.
 * The final audit score = min(gate0_cap, weighted_agent_score)
 *
 * @param {Array<Object>} gateResults — results from all gates
 * @returns {{ scoreCap: number, grade: string, penalties: number, reasons: string[] }}
 */
function calculateScoreCap(gateResults) {
  let cap = 100;
  let penalties = 0;
  const reasons = [];

  for (const gate of gateResults) {
    if (gate.scoreCap !== undefined && gate.scoreCap < cap) {
      cap = gate.scoreCap;
      reasons.push(`${gate.gate}: ${gate.message}`);
    }
    if (gate.scorePenalty) {
      penalties += gate.scorePenalty;
      reasons.push(`${gate.gate}: -${gate.scorePenalty} pts (${gate.message})`);
    }
  }

  const effectiveCap = Math.max(50, cap - penalties);

  return {
    scoreCap: effectiveCap,
    grade: scoreToGrade(effectiveCap),
    penalties,
    reasons
  };
}

// ============================================================
// Trend Comparison
// ============================================================

/**
 * Compare current gate results with previous audit.
 * @param {Object} currentResults — from runAllGates()
 * @param {Object} [previousAudit] — from last-audit.json
 * @returns {Array<Object>} deltas
 */
function compareTrend(currentResults, previousAudit) {
  if (!previousAudit || !previousAudit.gate0) return [];

  const deltas = [];
  const prev = previousAudit.gate0;

  for (const gate of currentResults.gates) {
    const prevGate = prev.gates?.find(g => g.gate === gate.gate);
    if (!prevGate) continue;

    if (gate.errorCount !== undefined && prevGate.errorCount !== undefined) {
      const delta = gate.errorCount - prevGate.errorCount;
      if (delta !== 0) {
        deltas.push({
          gate: gate.gate,
          metric: 'errorCount',
          previous: prevGate.errorCount,
          current: gate.errorCount,
          delta,
          improved: delta < 0
        });
      }
    }
  }

  return deltas;
}

// ============================================================
// Main: Run All Gates
// ============================================================

/**
 * Run all Gate 0 checks and return consolidated results.
 * @returns {Object} gate results with score cap
 */
function runAllGates() {
  const gates = [];

  gates.push(checkBuild());
  gates.push(checkTypecheck());
  gates.push(checkLint());
  gates.push(checkLintConfigIntegrity());
  gates.push(checkTests());
  gates.push(checkScriptCompleteness());

  const cap = calculateScoreCap(gates);
  const framework = detectFramework();

  // Load previous audit for trend comparison
  let trend = [];
  const lastAuditPath = path.join(PATHS.state, 'last-audit.json');
  const previousAudit = safeJsonParse(lastAuditPath, null);
  if (previousAudit) {
    trend = compareTrend({ gates }, previousAudit);
  }

  return {
    gates,
    cap,
    framework,
    eslintDisables: countEslintDisables(),
    gitHealth: checkGitHealth(),
    envHygiene: checkEnvHygiene(),
    trend,
    timestamp: new Date().toISOString()
  };
}

// ============================================================
// CLI
// ============================================================

function main() {
  const command = process.argv[2] || 'run';

  switch (command) {
    case 'run': {
      const results = runAllGates();
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'build':
      console.log(JSON.stringify(checkBuild(), null, 2));
      break;

    case 'typecheck':
      console.log(JSON.stringify(checkTypecheck(), null, 2));
      break;

    case 'lint':
      console.log(JSON.stringify(checkLint(), null, 2));
      break;

    case 'lint-config':
      console.log(JSON.stringify(checkLintConfigIntegrity(), null, 2));
      break;

    case 'tests':
      console.log(JSON.stringify(checkTests(), null, 2));
      break;

    case 'scripts':
      console.log(JSON.stringify(checkScriptCompleteness(), null, 2));
      break;

    case 'eslint-disable':
      console.log(JSON.stringify(countEslintDisables(), null, 2));
      break;

    case 'framework':
      console.log(JSON.stringify(detectFramework(), null, 2));
      break;

    case 'git-health':
      console.log(JSON.stringify(checkGitHealth(), null, 2));
      break;

    case 'env-hygiene':
      console.log(JSON.stringify(checkEnvHygiene(), null, 2));
      break;

    case 'dead-exports': {
      // Delegated to the AI agent — this is a hint for the agent prompt
      console.log('Dead export detection requires AI analysis. Use the audit agent prompt.');
      break;
    }

    case 'dep-health': {
      // Uses existing flow-audit.js outdated + audit
      try {
        const { getOutdatedDeps, getAuditResults } = require('./flow-audit');
        console.log(JSON.stringify({
          outdated: getOutdatedDeps(),
          vulnerabilities: getAuditResults()
        }, null, 2));
      } catch (err) {
        console.log(JSON.stringify({ error: err.message }, null, 2));
      }
      break;
    }

    case 'test-coverage': {
      // Try to run coverage command
      const pkgPath = path.join(PATHS.root, 'package.json');
      const pkg = safeJsonParse(pkgPath, {});
      const scripts = pkg.scripts || {};
      const scriptName = scripts['test:coverage'] ? 'test:coverage' : (scripts['coverage'] ? 'coverage' : null);
      if (scriptName) {
        try {
          const output = execFileSync('npm', ['run', scriptName], {
            cwd: PATHS.root, encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe']
          });
          console.log(JSON.stringify({ available: true, output: output.substring(0, 3000) }, null, 2));
        } catch (err) {
          console.log(JSON.stringify({ available: true, error: (err.stdout || err.stderr || '').substring(0, 2000) }, null, 2));
        }
      } else {
        // Check test file ratio
        try {
          const testFiles = execFileSync('sh', ['-c', 'find . -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | grep -v node_modules | wc -l'], {
            cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
          }).trim();
          const srcFiles = execFileSync('sh', ['-c', 'find . \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) 2>/dev/null | grep -v node_modules | grep -vE "\\.(test|spec)\\." | wc -l'], {
            cwd: PATHS.root, encoding: 'utf-8', timeout: 5000
          }).trim();
          console.log(JSON.stringify({
            available: false,
            testFiles: parseInt(testFiles, 10) || 0,
            sourceFiles: parseInt(srcFiles, 10) || 0,
            ratio: parseInt(srcFiles, 10) > 0 ? ((parseInt(testFiles, 10) / parseInt(srcFiles, 10)) * 100).toFixed(1) + '%' : '0%'
          }, null, 2));
        } catch (_err) {
          console.log(JSON.stringify({ available: false, testFiles: 0, sourceFiles: 0, ratio: '0%' }, null, 2));
        }
      }
      break;
    }

    default:
      console.log(`
Wogi Flow - Audit Gate 0: Pre-Agent Baseline Checks

Usage: flow-audit-gates.js <command>

Commands:
  run           Run all Gate 0 checks (default)
  build         Build check only
  typecheck     Typecheck only
  lint          Lint check only
  lint-config   Lint config integrity (downgraded rules)
  tests         Test check only
  scripts       Package.json script completeness
  eslint-disable  Count eslint-disable comments
  framework     Auto-detect project framework
  git-health    Git history health indicators
  env-hygiene   Environment/config hygiene
  dep-health    Dependency health (outdated + vulnerabilities)
  test-coverage Test coverage metrics
  dead-exports  Dead export detection (requires AI agent)
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Gate 0 checks
  checkBuild,
  checkTypecheck,
  checkLint,
  checkLintConfigIntegrity,
  checkTests,
  checkScriptCompleteness,

  // Extended checks
  countEslintDisables,
  detectFramework,
  checkGitHealth,
  checkEnvHygiene,

  // Score
  calculateScoreCap,
  scoreToGrade,
  GRADE_VALUES,

  // Trend
  compareTrend,

  // Main
  runAllGates
};

if (require.main === module) {
  main();
}
