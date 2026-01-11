#!/usr/bin/env node

/**
 * Wogi Flow - Silent Failure Hunter Step
 *
 * Detects code patterns that silently swallow errors or failures:
 * - Empty catch blocks
 * - Catch blocks that only log
 * - Async functions without error handling
 * - Promise chains without .catch()
 * - try-finally without catch
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run silent failure detection as a workflow step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object[] }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {} } = options;
  const checkEmptyCatch = stepConfig.checkEmptyCatch !== false;
  const checkLogOnlyCatch = stepConfig.checkLogOnlyCatch !== false;
  const checkUnhandledAsync = stepConfig.checkUnhandledAsync !== false;
  const checkPromiseChains = stepConfig.checkPromiseChains !== false;

  // Filter to analyzable files
  const analyzableExtensions = ['.js', '.ts', '.jsx', '.tsx'];
  const analyzableFiles = files.filter(f =>
    analyzableExtensions.some(ext => f.endsWith(ext)) &&
    !f.includes('.test.') &&
    !f.includes('.spec.') &&
    !f.includes('.d.ts')
  );

  if (analyzableFiles.length === 0) {
    return { passed: true, message: 'No files to analyze' };
  }

  const issues = [];

  for (const file of analyzableFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileIssues = analyzeForSilentFailures(content, file, {
        checkEmptyCatch,
        checkLogOnlyCatch,
        checkUnhandledAsync,
        checkPromiseChains,
      });
      issues.push(...fileIssues);
    } catch (err) {
      // Skip unreadable files
    }
  }

  if (issues.length === 0) {
    return {
      passed: true,
      message: 'No silent failure patterns detected',
    };
  }

  // Report issues
  console.log(colors.yellow + '\n  Silent Failure Patterns Detected:' + colors.reset);
  for (const issue of issues) {
    const icon = issue.severity === 'high' ? '\u{1F534}' : '\u{1F7E1}';
    console.log(`    ${icon} ${issue.file}:${issue.line}`);
    console.log(`       ${issue.type}: ${issue.message}`);
    if (issue.suggestion) {
      console.log(colors.dim + `       \u{2192} ${issue.suggestion}` + colors.reset);
    }
  }

  const highSeverity = issues.filter(i => i.severity === 'high');

  return {
    passed: highSeverity.length === 0,
    message: `${issues.length} silent failure pattern(s) found (${highSeverity.length} high severity)`,
    details: issues,
  };
}

/**
 * Analyze code for silent failure patterns
 */
function analyzeForSilentFailures(content, fileName, config) {
  const issues = [];
  const lines = content.split('\n');

  // Track context for multi-line analysis
  let inTryBlock = false;
  let inCatchBlock = false;
  let catchStartLine = 0;
  let catchContent = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect try-catch structure
    if (/\btry\s*\{/.test(line)) {
      inTryBlock = true;
    }

    if (inTryBlock && /\bcatch\s*\([^)]*\)\s*\{/.test(line)) {
      inCatchBlock = true;
      catchStartLine = i + 1;
      catchContent = [];
      braceDepth = 1;
      continue;
    }

    if (inCatchBlock) {
      catchContent.push(trimmed);
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (braceDepth <= 0) {
        // Analyze the complete catch block
        const catchIssues = analyzeCatchBlock(catchContent, catchStartLine, fileName, config);
        issues.push(...catchIssues);

        inCatchBlock = false;
        inTryBlock = false;
        catchContent = [];
      }
      continue;
    }

    // Check for try-finally without catch (config.checkUnhandledAsync)
    if (config.checkUnhandledAsync && /\btry\s*\{/.test(line)) {
      // Look ahead for finally without catch
      const tryContext = content.substring(content.indexOf(line));
      if (/try\s*\{[^}]*\}\s*finally/.test(tryContext) && !/catch\s*\(/.test(tryContext.substring(0, tryContext.indexOf('finally')))) {
        issues.push({
          file: fileName,
          line: i + 1,
          type: 'Try-Finally Without Catch',
          severity: 'medium',
          message: 'try-finally without catch will not handle errors',
          suggestion: 'Add a catch block or let errors propagate intentionally',
        });
      }
    }

    // Check for unhandled promise chains (config.checkPromiseChains)
    if (config.checkPromiseChains) {
      // Look for .then() without .catch()
      if (/\.then\s*\(/.test(line) && !line.includes('.catch(') && !line.includes('await')) {
        // Check if .catch() is on the next few lines
        const nextLines = lines.slice(i, i + 5).join(' ');
        if (!nextLines.includes('.catch(') && !nextLines.includes('.finally(')) {
          issues.push({
            file: fileName,
            line: i + 1,
            type: 'Unhandled Promise Chain',
            severity: 'medium',
            message: 'Promise chain without .catch() handler',
            suggestion: 'Add .catch() handler or use async/await with try-catch',
          });
        }
      }
    }

    // Check for async functions without try-catch (config.checkUnhandledAsync)
    if (config.checkUnhandledAsync) {
      const asyncMatch = line.match(/async\s+(?:function\s+)?(\w+)?/);
      if (asyncMatch && !line.includes('test') && !line.includes('spec')) {
        // Find the function body
        const funcStart = i;
        let funcBraceDepth = 0;
        let funcStarted = false;
        let funcContent = '';

        for (let j = i; j < Math.min(i + 100, lines.length); j++) {
          funcContent += lines[j] + '\n';
          funcBraceDepth += (lines[j].match(/\{/g) || []).length;
          funcBraceDepth -= (lines[j].match(/\}/g) || []).length;

          if (lines[j].includes('{')) funcStarted = true;
          if (funcStarted && funcBraceDepth === 0) break;
        }

        // Check if function has await but no try-catch
        if (/\bawait\b/.test(funcContent) && !/\btry\s*\{/.test(funcContent)) {
          const funcName = asyncMatch[1] || 'anonymous';
          // Don't flag if it's a short function (likely a wrapper)
          if (funcContent.split('\n').length > 5) {
            issues.push({
              file: fileName,
              line: funcStart + 1,
              type: 'Unhandled Async',
              severity: 'medium',
              message: `Async function "${funcName}" uses await without try-catch`,
              suggestion: 'Wrap await calls in try-catch or document that errors propagate',
            });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Analyze a catch block for silent failure patterns
 */
function analyzeCatchBlock(catchLines, startLine, fileName, config) {
  const issues = [];
  const catchBody = catchLines.join('\n').trim();

  // Remove the closing brace if present
  const cleanBody = catchBody.replace(/\}\s*$/, '').trim();

  // Check for empty catch block
  if (config.checkEmptyCatch && cleanBody.length === 0) {
    issues.push({
      file: fileName,
      line: startLine,
      type: 'Empty Catch Block',
      severity: 'high',
      message: 'Empty catch block silently swallows all errors',
      suggestion: 'Log the error, rethrow it, or handle it appropriately',
    });
    return issues;
  }

  // Check for catch blocks that only log
  if (config.checkLogOnlyCatch) {
    const onlyLogging = /^(?:console\.(?:log|error|warn)|logger\.(?:log|error|warn|info))\s*\(/i.test(cleanBody);
    const hasOtherStatements = cleanBody.split(';').filter(s => {
      const t = s.trim();
      return t.length > 0 && !/^console\.|^logger\.|^\/\//.test(t);
    }).length > 0;

    if (onlyLogging && !hasOtherStatements) {
      issues.push({
        file: fileName,
        line: startLine,
        type: 'Log-Only Catch',
        severity: 'medium',
        message: 'Catch block only logs error without handling it',
        suggestion: 'Consider if error should be rethrown or if recovery logic is needed',
      });
    }
  }

  // Check for catch blocks that swallow specific errors
  if (/return\s*(?:null|undefined|false|''|""|``)/.test(cleanBody)) {
    issues.push({
      file: fileName,
      line: startLine,
      type: 'Error Suppression',
      severity: 'medium',
      message: 'Catch block returns falsy value, hiding error from caller',
      suggestion: 'Document this behavior or throw a typed error',
    });
  }

  // Check for catch block with only a comment
  if (/^\/[/*]/.test(cleanBody) && cleanBody.split('\n').every(l => l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim() === '')) {
    issues.push({
      file: fileName,
      line: startLine,
      type: 'Comment-Only Catch',
      severity: 'high',
      message: 'Catch block contains only comments - errors are silently ignored',
      suggestion: 'Add proper error handling or explicit ignore marker',
    });
  }

  return issues;
}

module.exports = { run, analyzeForSilentFailures };
