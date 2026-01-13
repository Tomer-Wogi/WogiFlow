#!/usr/bin/env node

/**
 * Wogi Flow - Code Review Step
 *
 * Hybrid code review: multi-agent for big/high-risk tasks, simple for small/low-risk.
 * Uses confidence scoring (0-100) and only reports issues with confidence >= threshold.
 *
 * Multi-agent review runs 3 parallel perspectives:
 * 1. Architecture/Design review
 * 2. Implementation/Logic review
 * 3. Security/Edge cases review
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

// High-risk patterns that trigger multi-agent review
const HIGH_RISK_PATTERNS = [
  'auth', 'authentication', 'authorization',
  'payment', 'billing', 'checkout',
  'security', 'crypto', 'encrypt', 'decrypt',
  'password', 'credential', 'secret', 'token',
  'admin', 'permission', 'role',
  'database', 'migration', 'schema',
];

/**
 * Run code review as a workflow step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @param {string} options.taskType - Type of task (feature/bugfix/refactor)
 * @returns {object} - { passed: boolean, message: string, details?: object[] }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {}, taskType } = options;
  const multiAgentThreshold = stepConfig.multiAgentThreshold || 5;
  const confidenceThreshold = stepConfig.confidenceThreshold || 80;
  const highRiskPatterns = stepConfig.highRiskPatterns || HIGH_RISK_PATTERNS;

  // Filter to reviewable files
  const reviewableExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs'];
  const reviewableFiles = files.filter(f =>
    reviewableExtensions.some(ext => f.endsWith(ext)) &&
    !f.includes('.test.') &&
    !f.includes('.spec.') &&
    !f.includes('.d.ts')
  );

  if (reviewableFiles.length === 0) {
    return { passed: true, message: 'No reviewable files modified' };
  }

  // Determine if high-risk
  const isHighRisk = taskType === 'refactor' ||
    reviewableFiles.some(f => highRiskPatterns.some(p => f.toLowerCase().includes(p)));

  // Choose review mode
  const useMultiAgent = reviewableFiles.length > multiAgentThreshold || isHighRisk;

  let issues;
  if (useMultiAgent) {
    console.log(colors.cyan + '  Running multi-agent code review...' + colors.reset);
    issues = await runMultiAgentReview(reviewableFiles, stepConfig);
  } else {
    console.log(colors.cyan + '  Running simple code review...' + colors.reset);
    issues = await runSimpleReview(reviewableFiles, stepConfig);
  }

  // Filter by confidence threshold
  const reportableIssues = issues.filter(i => i.confidence >= confidenceThreshold);

  if (reportableIssues.length === 0) {
    return {
      passed: true,
      message: useMultiAgent
        ? `Multi-agent review passed (${reviewableFiles.length} files)`
        : `Simple review passed (${reviewableFiles.length} files)`,
    };
  }

  // Report issues
  console.log(colors.yellow + '\n  Code Review Issues:' + colors.reset);

  const criticalIssues = reportableIssues.filter(i => i.severity === 'critical');
  const importantIssues = reportableIssues.filter(i => i.severity === 'important');

  if (criticalIssues.length > 0) {
    console.log(colors.red + '  Critical:' + colors.reset);
    for (const issue of criticalIssues) {
      printIssue(issue);
    }
  }

  if (importantIssues.length > 0) {
    console.log(colors.yellow + '  Important:' + colors.reset);
    for (const issue of importantIssues) {
      printIssue(issue);
    }
  }

  // Critical issues block, important issues warn
  const hasCritical = criticalIssues.length > 0;

  // Auto-capture learnings from issues found
  if (reportableIssues.length > 0) {
    try {
      const { captureFromSessionReview } = require('./flow-auto-learn');
      captureFromSessionReview(reportableIssues);
    } catch (err) {
      // Auto-learn not available or failed - continue silently
    }

    // Also capture to tech debt ledger for persistent tracking
    try {
      const { TechDebtManager } = require('./flow-tech-debt');
      const debtManager = new TechDebtManager();
      const { added, updated } = debtManager.addIssues(reportableIssues.map(issue => ({
        file: issue.file,
        line: issue.line,
        category: issue.perspective || 'code',
        severity: issue.severity === 'critical' ? 'critical' : (issue.severity === 'important' ? 'high' : 'medium'),
        description: issue.description,
        fix: issue.fix || ''
      })));
      if (added > 0 || updated > 0) {
        console.log(colors.dim + `  Tech debt: ${added} new, ${updated} updated` + colors.reset);
      }
    } catch (err) {
      // Tech debt manager not available or failed - continue silently
    }
  }

  return {
    passed: !hasCritical,
    message: `${reportableIssues.length} issue(s) found (${criticalIssues.length} critical, ${importantIssues.length} important)`,
    details: reportableIssues,
  };
}

/**
 * Print a single issue
 */
function printIssue(issue) {
  const confidenceColor = issue.confidence >= 90 ? colors.red : colors.yellow;
  console.log(`    ${issue.file}:${issue.line}`);
  console.log(`      ${issue.description}`);
  console.log(`      ${confidenceColor}Confidence: ${issue.confidence}%${colors.reset}`);
  if (issue.fix) {
    console.log(colors.dim + `      Fix: ${issue.fix}` + colors.reset);
  }
}

/**
 * Run multi-agent review (3 perspectives)
 */
async function runMultiAgentReview(files, config) {
  const allIssues = [];

  for (const file of files) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Run all 3 perspectives
      const architectureIssues = reviewArchitecture(content, file);
      const implementationIssues = reviewImplementation(content, file);
      const securityIssues = reviewSecurity(content, file);

      // Merge and dedupe issues
      const fileIssues = mergeIssues([
        ...architectureIssues,
        ...implementationIssues,
        ...securityIssues,
      ]);

      allIssues.push(...fileIssues);
    } catch (err) {
      // Skip unreadable files
    }
  }

  return allIssues;
}

/**
 * Run simple review (single pass)
 */
async function runSimpleReview(files, config) {
  const allIssues = [];

  for (const file of files) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileIssues = runBasicChecks(content, file);
      allIssues.push(...fileIssues);
    } catch (err) {
      // Skip unreadable files
    }
  }

  return allIssues;
}

/**
 * Architecture/Design review perspective
 */
function reviewArchitecture(content, fileName) {
  const issues = [];
  const lines = content.split('\n');

  // Check for god objects (too many methods/properties)
  const methodCount = (content.match(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\()/g) || []).length;
  if (methodCount > 15) {
    issues.push({
      file: fileName,
      line: 1,
      perspective: 'architecture',
      severity: methodCount > 25 ? 'critical' : 'important',
      confidence: Math.min(95, 70 + methodCount),
      description: `File has ${methodCount} functions - consider splitting into modules`,
      fix: 'Extract related functions into separate modules with clear responsibilities',
    });
  }

  // Check for circular dependency hints
  const imports = content.match(/(?:require|import).*['"](\.\.?\/[^'"]+)['"]/g) || [];
  const uniqueImports = new Set(imports);
  if (uniqueImports.size > 10) {
    issues.push({
      file: fileName,
      line: 1,
      perspective: 'architecture',
      severity: 'important',
      confidence: 75,
      description: `High import count (${uniqueImports.size}) may indicate tight coupling`,
      fix: 'Review dependencies and consider introducing facades or reorganizing modules',
    });
  }

  // Check for mixed concerns
  const hasDOM = /querySelector|getElementById|document\./i.test(content);
  const hasAPI = /fetch|axios|http/i.test(content);
  const hasDB = /query|findOne|insertOne|mongoose|prisma/i.test(content);

  const concerns = [hasDOM, hasAPI, hasDB].filter(Boolean).length;
  if (concerns >= 2) {
    issues.push({
      file: fileName,
      line: 1,
      perspective: 'architecture',
      severity: 'important',
      confidence: 80,
      description: 'File mixes multiple concerns (UI/API/DB)',
      fix: 'Separate into distinct layers: presentation, business logic, data access',
    });
  }

  return issues;
}

/**
 * Implementation/Logic review perspective
 */
function reviewImplementation(content, fileName) {
  const issues = [];
  const lines = content.split('\n');

  // Check for magic numbers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments, imports, and obvious cases
    if (line.trim().startsWith('//') || line.includes('import') || line.includes('require')) continue;

    const magicMatch = line.match(/[^a-zA-Z0-9_](\d{2,})[^a-zA-Z0-9_]/);
    if (magicMatch) {
      const num = parseInt(magicMatch[1]);
      // Skip common values like 100, 1000, ports, etc.
      if (![100, 1000, 10000, 3000, 8080, 8000, 443, 80].includes(num)) {
        issues.push({
          file: fileName,
          line: i + 1,
          perspective: 'implementation',
          severity: 'important',
          confidence: 70,
          description: `Magic number ${num} - consider using a named constant`,
          fix: `Extract to a descriptively named constant: const MEANINGFUL_NAME = ${num}`,
        });
      }
    }
  }

  // Check for deeply nested logic
  let maxIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const indent = (lines[i].match(/^(\s*)/)?.[1] || '').replace(/\t/g, '  ').length;
    if (indent > maxIndent) maxIndent = indent;
    if (indent >= 16) { // 8+ levels
      issues.push({
        file: fileName,
        line: i + 1,
        perspective: 'implementation',
        severity: 'critical',
        confidence: 95,
        description: 'Deeply nested code (8+ levels)',
        fix: 'Use early returns, extract functions, or restructure logic',
      });
      break; // Only report once per file
    }
  }

  // Check for duplicate string literals
  const stringLiterals = content.match(/['"][^'"]{10,}['"]/g) || [];
  const literalCounts = {};
  for (const lit of stringLiterals) {
    literalCounts[lit] = (literalCounts[lit] || 0) + 1;
  }
  for (const [lit, count] of Object.entries(literalCounts)) {
    if (count >= 3) {
      issues.push({
        file: fileName,
        line: 1,
        perspective: 'implementation',
        severity: 'important',
        confidence: 85,
        description: `String literal appears ${count} times - extract to constant`,
        fix: `Create a constant: const MESSAGE = ${lit}`,
      });
    }
  }

  return issues;
}

/**
 * Security/Edge cases review perspective
 */
function reviewSecurity(content, fileName) {
  const issues = [];
  const lines = content.split('\n');

  // Check for unsafe operations
  const unsafePatterns = [
    { pattern: /eval\s*\(/i, desc: 'eval() is dangerous - allows code injection', severity: 'critical', confidence: 100 },
    { pattern: /innerHTML\s*=/i, desc: 'innerHTML can cause XSS - use textContent or sanitize', severity: 'critical', confidence: 95 },
    { pattern: /dangerouslySetInnerHTML/i, desc: 'dangerouslySetInnerHTML requires careful sanitization', severity: 'important', confidence: 85 },
    { pattern: /new Function\s*\(/i, desc: 'new Function() is similar to eval - avoid if possible', severity: 'critical', confidence: 95 },
    { pattern: /document\.write/i, desc: 'document.write can be exploited - use DOM methods', severity: 'important', confidence: 90 },
    { pattern: /exec\s*\(\s*[^)]*\+/i, desc: 'String concatenation in exec() may allow command injection', severity: 'critical', confidence: 90 },
    { pattern: /execSync\s*\(\s*[^)]*\+/i, desc: 'String concatenation in execSync() may allow command injection', severity: 'critical', confidence: 90 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, desc, severity, confidence } of unsafePatterns) {
      if (pattern.test(line)) {
        issues.push({
          file: fileName,
          line: i + 1,
          perspective: 'security',
          severity,
          confidence,
          description: desc,
          fix: 'Review and use safer alternatives',
        });
      }
    }
  }

  // Check for missing error handling in async
  const asyncFunctions = content.match(/async\s+(?:function\s+)?(\w+)/g) || [];
  for (const asyncFunc of asyncFunctions) {
    // Simple heuristic: check if there's a try-catch nearby
    const funcName = asyncFunc.replace(/async\s+(?:function\s+)?/, '');
    const funcIndex = content.indexOf(asyncFunc);
    const funcContext = content.substring(funcIndex, funcIndex + 500);
    if (!funcContext.includes('try') && !funcContext.includes('catch')) {
      issues.push({
        file: fileName,
        line: content.substring(0, funcIndex).split('\n').length,
        perspective: 'security',
        severity: 'important',
        confidence: 70,
        description: `Async function "${funcName}" may lack error handling`,
        fix: 'Add try-catch or ensure errors are handled by the caller',
      });
    }
  }

  // Check for hardcoded credentials
  const credPatterns = [
    /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/i,
    /(?:secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=]{20,}['"]/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments and env references
    if (line.trim().startsWith('//') || line.includes('process.env') || line.includes('.env')) continue;

    for (const pattern of credPatterns) {
      if (pattern.test(line)) {
        issues.push({
          file: fileName,
          line: i + 1,
          perspective: 'security',
          severity: 'critical',
          confidence: 90,
          description: 'Potential hardcoded credential detected',
          fix: 'Use environment variables or a secrets manager',
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Run basic checks (for simple review mode)
 */
function runBasicChecks(content, fileName) {
  const issues = [];
  const lines = content.split('\n');

  // Check for console.log left in code
  for (let i = 0; i < lines.length; i++) {
    if (/console\.(log|debug|info)\s*\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
      issues.push({
        file: fileName,
        line: i + 1,
        perspective: 'basic',
        severity: 'important',
        confidence: 80,
        description: 'console.log left in code',
        fix: 'Remove or replace with proper logging',
      });
    }
  }

  // Check for TODO/FIXME comments
  for (let i = 0; i < lines.length; i++) {
    if (/\b(TODO|FIXME|XXX|HACK)\b/i.test(lines[i])) {
      issues.push({
        file: fileName,
        line: i + 1,
        perspective: 'basic',
        severity: 'important',
        confidence: 75,
        description: 'Unresolved TODO/FIXME comment',
        fix: 'Address the TODO or create a task to track it',
      });
    }
  }

  // Check for empty catch blocks
  const emptyCatch = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g);
  if (emptyCatch) {
    issues.push({
      file: fileName,
      line: 1,
      perspective: 'basic',
      severity: 'critical',
      confidence: 95,
      description: 'Empty catch block swallows errors silently',
      fix: 'Log the error or rethrow it',
    });
  }

  // Check for debugger statements
  for (let i = 0; i < lines.length; i++) {
    if (/\bdebugger\b/.test(lines[i])) {
      issues.push({
        file: fileName,
        line: i + 1,
        perspective: 'basic',
        severity: 'critical',
        confidence: 100,
        description: 'debugger statement left in code',
        fix: 'Remove the debugger statement',
      });
    }
  }

  return issues;
}

/**
 * Merge and dedupe issues from multiple perspectives
 */
function mergeIssues(issues) {
  // Group by file:line
  const grouped = {};
  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(issue);
  }

  // For each group, keep highest confidence version
  const merged = [];
  for (const group of Object.values(grouped)) {
    // Sort by confidence descending
    group.sort((a, b) => b.confidence - a.confidence);

    // If multiple perspectives found same issue, boost confidence
    if (group.length > 1) {
      const best = group[0];
      best.confidence = Math.min(100, best.confidence + (group.length - 1) * 5);
      best.perspectives = group.map(i => i.perspective);
      merged.push(best);
    } else {
      merged.push(group[0]);
    }
  }

  return merged;
}

module.exports = { run, runMultiAgentReview, runSimpleReview };
