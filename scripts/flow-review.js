#!/usr/bin/env node

/**
 * Wogi Flow - Code Review
 *
 * Comprehensive code review with verification gates and multi-pass AI analysis.
 * v3.1: Integrates spec verification and multi-pass review system.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  getConfig,
  color,
  success,
  warn,
  error,
  info
} = require('./flow-utils');

// v3.1 spec verification
const { verifySpecDeliverables, formatVerificationResults } = require('./flow-spec-verifier');

// v3.1 multi-pass review system
let multiPassReview;
try {
  multiPassReview = require('./flow-review-passes');
} catch (err) {
  multiPassReview = null;
}

// v4.0 standards compliance checker
let standardsChecker;
try {
  standardsChecker = require('./flow-standards-checker');
} catch (err) {
  standardsChecker = null;
}

// ============================================================
// Get Changed Files
// ============================================================

/**
 * Get list of changed files from git
 * @param {Object} options - Options
 * @returns {string[]} List of changed file paths
 */
function getChangedFiles(options = {}) {
  const { staged = false, commits = 0 } = options;
  const files = new Set();

  try {
    if (commits > 0) {
      // Get files changed in last N commits
      // Validate commits is a safe integer to prevent injection
      const safeCommits = Math.max(1, Math.min(Math.floor(commits), 1000));
      const commitFiles = execFileSync('git', ['diff', '--name-only', `HEAD~${safeCommits}`, 'HEAD'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split('\n').filter(Boolean);
      commitFiles.forEach(f => files.add(f));
    } else if (staged) {
      // Only staged files
      const stagedFiles = execFileSync('git', ['diff', '--name-only', '--staged'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split('\n').filter(Boolean);
      stagedFiles.forEach(f => files.add(f));
    } else {
      // All changes (unstaged + staged)
      const unstaged = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split('\n').filter(Boolean);
      unstaged.forEach(f => files.add(f));

      const stagedChanges = execFileSync('git', ['diff', '--name-only', '--staged'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split('\n').filter(Boolean);
      stagedChanges.forEach(f => files.add(f));
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Git error: ${err.message}`);
  }

  return Array.from(files).filter(f => f && f.length > 0);
}

/**
 * Load file content for review
 * @param {string} filePath - File path
 * @returns {Object} File info with content
 */
function loadFileContent(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    // Read directly and let the try-catch handle missing files
    // Avoids TOCTOU race condition between exists check and read
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { path: filePath, content };
  } catch (err) {
    // Handle both file not found (ENOENT) and other errors
    const errorMsg = err.code === 'ENOENT' ? 'File not found' : err.message;
    return { path: filePath, content: '', error: errorMsg };
  }
}

// ============================================================
// Verification Gates
// ============================================================

/**
 * Run verification gates
 * @param {string[]} files - Files to verify
 * @param {Object} options - Options
 * @returns {Object} Gate results
 */
function runVerificationGates(files, options = {}) {
  const { taskId, skipSpecVerify = false } = options;
  const config = getConfig();
  const results = {
    gates: [],
    allPassed: true,
    criticalFailed: false
  };

  // Spec verification (if task has spec)
  if (!skipSpecVerify && taskId) {
    try {
      const specResult = verifySpecDeliverables(taskId, { silent: true });
      const passed = specResult.verified && specResult.results?.every(r => r.exists);
      results.gates.push({
        name: 'Spec Verification',
        passed,
        details: passed
          ? `${specResult.results?.length || 0} deliverables exist`
          : `Missing: ${specResult.results?.filter(r => !r.exists).map(r => r.file).join(', ')}`
      });
      if (!passed) {
        results.allPassed = false;
        results.criticalFailed = true;
      }
    } catch (err) {
      // Spec verification optional if no spec exists
      if (process.env.DEBUG) console.error(`[DEBUG] Spec verify: ${err.message}`);
    }
  }

  // Lint check
  if (config.qualityGates?.lint !== false) {
    try {
      execFileSync('npm', ['run', 'lint'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      results.gates.push({ name: 'Lint', passed: true });
    } catch (err) {
      results.gates.push({ name: 'Lint', passed: false, details: 'Lint errors found' });
      results.allPassed = false;
    }
  }

  // TypeCheck
  if (config.qualityGates?.typecheck !== false) {
    try {
      execFileSync('npm', ['run', 'typecheck'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      results.gates.push({ name: 'TypeCheck', passed: true });
    } catch (err) {
      results.gates.push({ name: 'TypeCheck', passed: false, details: 'Type errors found' });
      results.allPassed = false;
    }
  }

  // Tests
  if (config.qualityGates?.tests !== false) {
    try {
      execFileSync('npm', ['test'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      results.gates.push({ name: 'Tests', passed: true });
    } catch (err) {
      results.gates.push({ name: 'Tests', passed: false, details: 'Test failures' });
      results.allPassed = false;
    }
  }

  return results;
}

// ============================================================
// Multi-Pass Review
// ============================================================

/**
 * Run multi-pass review
 * @param {Object[]} files - Files with content
 * @param {Object} options - Review options
 * @returns {Promise<Object>} Review results
 */
async function runMultiPass(files, options = {}) {
  if (!multiPassReview) {
    return {
      error: 'Multi-pass review module not available',
      available: false
    };
  }

  const context = { files };
  const result = await multiPassReview.runMultiPassReview(context, options);
  return result;
}

// ============================================================
// Auto Multi-Pass Detection
// ============================================================

/**
 * Determine if multi-pass should be auto-enabled based on file characteristics
 * @param {string[]} files - List of file paths
 * @param {Object[]} filesWithContent - Files with content loaded
 * @param {Object} config - Config object
 * @returns {Object} { shouldUse: boolean, reason: string }
 */
function shouldAutoEnableMultiPass(files, filesWithContent, config) {
  const reviewConfig = config.review || {};
  const autoConfig = reviewConfig.autoMultiPass || {};

  // Check if auto-multipass is disabled
  if (autoConfig.enabled === false) {
    return { shouldUse: false, reason: 'disabled in config' };
  }

  // Threshold settings (with defaults)
  const fileThreshold = autoConfig.fileThreshold || 5;
  const securityPatterns = autoConfig.securityPatterns || ['password', 'token', 'auth', 'secret', 'credential', 'api_key', 'apikey'];
  const alwaysForTypes = autoConfig.alwaysForTypes || ['.env', 'auth', 'security', 'credential'];

  // Check file count
  if (files.length >= fileThreshold) {
    return { shouldUse: true, reason: `${files.length} files (>= ${fileThreshold} threshold)` };
  }

  // Check for security-sensitive files
  const hasSecurityFile = files.some(f =>
    alwaysForTypes.some(type => f.toLowerCase().includes(type))
  );
  if (hasSecurityFile) {
    return { shouldUse: true, reason: 'security-sensitive files detected' };
  }

  // Check content for security patterns
  const allContent = filesWithContent.map(f => f.content || '').join(' ').toLowerCase();
  const hasSecurityPatterns = securityPatterns.some(pattern => allContent.includes(pattern));
  if (hasSecurityPatterns) {
    return { shouldUse: true, reason: 'security patterns in content' };
  }

  // Check for API/service files
  const hasApiFiles = files.some(f =>
    /\.(api|service|controller|handler)\.(ts|js)$/i.test(f) ||
    f.includes('/api/') ||
    f.includes('/routes/')
  );
  if (hasApiFiles) {
    return { shouldUse: true, reason: 'API/service files detected' };
  }

  return { shouldUse: false, reason: 'no triggers met' };
}

// ============================================================
// Format Output
// ============================================================

/**
 * Format verification gate results
 * @param {Object} results - Gate results
 * @returns {string} Formatted output
 */
function formatGateResults(results) {
  const lines = [];
  lines.push('═══════════════════════════════════════');
  lines.push('VERIFICATION GATES');
  lines.push('═══════════════════════════════════════');

  for (const gate of results.gates) {
    const icon = gate.passed ? '✓' : '✗';
    const colorFn = gate.passed ? 'green' : 'red';
    let line = `${icon} ${gate.name}: ${gate.passed ? 'passed' : 'FAILED'}`;
    if (gate.details) {
      line += ` (${gate.details})`;
    }
    lines.push(color(colorFn, line));
  }

  lines.push('');
  const summary = results.allPassed ? 'All gates passed' : `${results.gates.filter(g => !g.passed).length} gate(s) failed`;
  lines.push(results.allPassed ? color('green', `✓ ${summary}`) : color('red', `✗ ${summary}`));

  return lines.join('\n');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse options
  const staged = args.includes('--staged');

  // Parse --commits with support for both --commits=N and --commits N formats
  let commits = 0;
  const commitsIdx = args.findIndex(a => a === '--commits' || a.startsWith('--commits='));
  if (commitsIdx !== -1) {
    const commitsArg = args[commitsIdx];
    if (commitsArg.includes('=')) {
      // --commits=N format
      const parsed = parseInt(commitsArg.split('=')[1], 10);
      commits = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 1000));
    } else if (commitsIdx + 1 < args.length && !args[commitsIdx + 1].startsWith('-')) {
      // --commits N format (next argument is the value)
      const parsed = parseInt(args[commitsIdx + 1], 10);
      commits = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 1000));
    }
  }

  const skipVerify = args.includes('--skip-verify');
  const verifyOnly = args.includes('--verify-only');
  const multipass = args.includes('--multipass');
  const jsonOutput = args.includes('--json');
  const taskIdArg = args.find(a => a.startsWith('--task='));
  const taskId = taskIdArg ? taskIdArg.split('=')[1] : null;

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Code Review (v4.0)

Usage: flow review [options]

Options:
  --staged          Only review staged changes
  --commits=N       Include last N commits
  --skip-verify     Skip verification gates (AI only)
  --verify-only     Only run verification gates
  --multipass       Force multi-pass review mode
  --no-multipass    Disable auto multi-pass detection
  --skip-standards  Skip project standards compliance check
  --task=ID         Task ID for spec verification
  --json            Output as JSON
  -h, --help        Show this help

Phases:
  1. Verification Gates - lint, typecheck, tests, spec verification
  2. AI Review - multi-pass code/logic/security/architecture analysis
  3. Standards Compliance - decisions.md, app-map, naming conventions (STRICT)

Standards compliance (Phase 3) checks:
  - decisions.md coding rules
  - app-map.md component reuse (>80% similarity = violation)
  - function-map.md utility duplication
  - naming-conventions.md (kebab-case files, 'err' in catch blocks)
  - security-patterns.md (raw JSON.parse, unprotected fs.readFileSync)

Multi-pass is auto-enabled when:
  - 5+ files changed
  - Security-sensitive files detected (auth, credential, .env)
  - Security patterns in content (password, token, secret, etc.)
  - API/service files detected

Configure in config.json under review.autoMultiPass.
`);
    process.exit(0);
  }

  // Get changed files
  const changedFiles = getChangedFiles({ staged, commits });

  if (changedFiles.length === 0) {
    console.log(color('yellow', 'No changes found to review.'));
    console.log('');
    console.log('To review recent commits: flow review --commits=3');
    console.log('To review staged files: flow review --staged');
    process.exit(0);
  }

  console.log('');
  console.log(color('cyan', '╔══════════════════════════════════════════════════════════╗'));
  console.log(color('cyan', '║  Code Review                                              ║'));
  console.log(color('cyan', '╚══════════════════════════════════════════════════════════╝'));
  console.log('');
  console.log(`Files to review: ${changedFiles.length}`);
  changedFiles.slice(0, 10).forEach(f => console.log(`  • ${f}`));
  if (changedFiles.length > 10) {
    console.log(`  ... and ${changedFiles.length - 10} more`);
  }
  console.log('');

  // Run verification gates
  if (!skipVerify) {
    const gateResults = runVerificationGates(changedFiles, { taskId });
    console.log(formatGateResults(gateResults));
    console.log('');

    if (gateResults.criticalFailed) {
      console.log(color('red', '⛔ Critical verification failed. Fix issues before proceeding.'));
      process.exit(1);
    }
  }

  // If verify-only, stop here
  if (verifyOnly) {
    console.log(color('green', '✓ Verification complete.'));
    process.exit(0);
  }

  // Load file contents for AI review
  const filesWithContent = changedFiles.map(f => loadFileContent(f));

  // Determine if multi-pass should be used (explicit flag or auto-detected)
  const config = getConfig();
  const noMultipass = args.includes('--no-multipass');
  let useMultiPass = multipass;
  let multiPassReason = 'requested via --multipass flag';

  if (!multipass && !noMultipass && multiPassReview) {
    // Auto-detect if multi-pass should be enabled
    const autoResult = shouldAutoEnableMultiPass(changedFiles, filesWithContent, config);
    if (autoResult.shouldUse) {
      useMultiPass = true;
      multiPassReason = `auto-enabled: ${autoResult.reason}`;
    }
  }

  // Run multi-pass review if needed
  if (useMultiPass) {
    if (!multiPassReview) {
      console.log(color('red', '✗ Multi-pass review module not available.'));
      process.exit(1);
    }

    console.log(color('cyan', `Running multi-pass review (${multiPassReason})...`));
    console.log('');

    const result = await runMultiPass(filesWithContent, {
      earlyExitOnCritical: !args.includes('--no-early-exit'),
      passForward: !args.includes('--no-forward')
    });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else if (typeof multiPassReview.formatResults === 'function') {
      console.log(multiPassReview.formatResults(result));
    } else {
      // Fallback if formatResults is not available
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    // Standard review - just output files for Claude AI agents
    console.log(color('cyan', '═══════════════════════════════════════'));
    console.log(color('cyan', 'Ready for AI Review'));
    console.log(color('cyan', '═══════════════════════════════════════'));
    console.log('');
    console.log('Files loaded for review:');
    filesWithContent.forEach(f => {
      const status = f.error ? color('red', `✗ ${f.error}`) : color('green', '✓ loaded');
      console.log(`  • ${f.path} ${status}`);
    });
    console.log('');
    console.log(color('dim', 'Use --multipass for automated multi-pass review.'));
  }

  // ========================================================================
  // Phase 3: Standards Compliance Check (v4.0)
  // ========================================================================
  const skipStandards = args.includes('--skip-standards');

  if (!skipStandards && standardsChecker) {
    console.log('');
    console.log(color('cyan', 'Running project standards compliance check...'));

    const standardsResult = standardsChecker.runStandardsCheck(filesWithContent);

    if (jsonOutput) {
      console.log(JSON.stringify({ standards: standardsResult }, null, 2));
    } else {
      console.log(standardsChecker.formatStandardsResults(standardsResult));
    }

    // Block if must-fix violations found
    if (standardsResult.blocked) {
      console.log('');
      console.log(color('red', '⛔ Standards violations must be fixed before completing review.'));
      console.log(color('dim', 'All code must follow the same conventions. Fix the violations above.'));
      process.exit(1);
    }
  } else if (!standardsChecker && !skipStandards) {
    console.log(color('dim', 'Standards checker not available. Skipping Phase 3.'));
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
