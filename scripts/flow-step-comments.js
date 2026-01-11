#!/usr/bin/env node

/**
 * Wogi Flow - Comment Analyzer Step
 *
 * Analyzes code comments for quality issues:
 * - Stale or misleading comments
 * - TODO/FIXME/HACK markers
 * - JSDoc accuracy vs actual signatures
 * - Commented-out code
 * - Missing documentation for public APIs
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run comment analysis as a workflow step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object[] }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {} } = options;
  const flagTodo = stepConfig.flagTodo !== false;
  const flagFixme = stepConfig.flagFixme !== false;
  const checkJsdoc = stepConfig.checkJsdoc !== false;
  const flagCommentedCode = stepConfig.flagCommentedCode !== false;
  const flagStale = stepConfig.flagStale !== false;

  // Filter to analyzable files
  const analyzableExtensions = ['.js', '.ts', '.jsx', '.tsx'];
  const analyzableFiles = files.filter(f =>
    analyzableExtensions.some(ext => f.endsWith(ext)) &&
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
      const fileIssues = analyzeComments(content, file, {
        flagTodo,
        flagFixme,
        checkJsdoc,
        flagCommentedCode,
        flagStale,
      });
      issues.push(...fileIssues);
    } catch (err) {
      // Skip unreadable files
    }
  }

  if (issues.length === 0) {
    return {
      passed: true,
      message: 'Comment analysis passed',
    };
  }

  // Report issues
  console.log(colors.yellow + '\n  Comment Analysis Issues:' + colors.reset);

  // Group by type
  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.type]) grouped[issue.type] = [];
    grouped[issue.type].push(issue);
  }

  for (const [type, typeIssues] of Object.entries(grouped)) {
    console.log(colors.cyan + `  ${type}:` + colors.reset);
    for (const issue of typeIssues.slice(0, 5)) { // Limit to 5 per type
      console.log(`    ${issue.file}:${issue.line}`);
      console.log(`       ${issue.message}`);
    }
    if (typeIssues.length > 5) {
      console.log(colors.dim + `    ... and ${typeIssues.length - 5} more` + colors.reset);
    }
  }

  const highSeverity = issues.filter(i => i.severity === 'high');

  return {
    passed: highSeverity.length === 0,
    message: `${issues.length} comment issue(s) found (${highSeverity.length} high severity)`,
    details: issues,
  };
}

/**
 * Analyze code for comment quality issues
 */
function analyzeComments(content, fileName, config) {
  const issues = [];
  const lines = content.split('\n');

  // Track JSDoc blocks for accuracy checking
  let inJsDoc = false;
  let jsDocContent = [];
  let jsDocStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track JSDoc blocks
    if (trimmed.startsWith('/**')) {
      inJsDoc = true;
      jsDocContent = [trimmed];
      jsDocStartLine = i + 1;
      continue;
    }

    if (inJsDoc) {
      jsDocContent.push(trimmed);
      if (trimmed.includes('*/')) {
        inJsDoc = false;
        // Check JSDoc accuracy if the next line is a function
        if (config.checkJsdoc && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const jsDocIssues = checkJsDocAccuracy(jsDocContent, nextLine, jsDocStartLine, fileName);
          issues.push(...jsDocIssues);
        }
        jsDocContent = [];
      }
      continue;
    }

    // Check for TODO/FIXME/HACK markers
    if (config.flagTodo || config.flagFixme) {
      const todoMatch = trimmed.match(/\b(TODO|FIXME|XXX|HACK|BUG|UNDONE)\b:?\s*(.*)/i);
      if (todoMatch) {
        const marker = todoMatch[1].toUpperCase();
        const isTodo = marker === 'TODO';
        const isFixme = ['FIXME', 'XXX', 'BUG', 'HACK', 'UNDONE'].includes(marker);

        if ((isTodo && config.flagTodo) || (isFixme && config.flagFixme)) {
          issues.push({
            file: fileName,
            line: i + 1,
            type: marker,
            severity: isFixme ? 'high' : 'medium',
            message: todoMatch[2] || `Unresolved ${marker} marker`,
          });
        }
      }
    }

    // Check for commented-out code
    if (config.flagCommentedCode) {
      // Single line comment that looks like code
      if (trimmed.startsWith('//') && !trimmed.startsWith('///')) {
        const commentContent = trimmed.substring(2).trim();
        if (looksLikeCode(commentContent)) {
          issues.push({
            file: fileName,
            line: i + 1,
            type: 'Commented Code',
            severity: 'medium',
            message: 'Commented-out code should be removed',
          });
        }
      }
    }

    // Check for potentially stale comments
    if (config.flagStale) {
      // Comment followed by code that contradicts it
      if (trimmed.startsWith('//') && i + 1 < lines.length) {
        const comment = trimmed.substring(2).trim().toLowerCase();
        const nextLine = lines[i + 1].trim().toLowerCase();

        const stalePatterns = [
          { comment: /always returns?|never fails?/, code: /throw|error|null|undefined/ },
          { comment: /deprecated|don't use|do not use/, code: /^\s*(?:export\s+)?(?:function|const|class)/ },
          { comment: /temporary|temp\s|remove later/, code: /.+/ }, // Any code after "temporary"
        ];

        for (const pattern of stalePatterns) {
          if (pattern.comment.test(comment) && pattern.code.test(nextLine)) {
            issues.push({
              file: fileName,
              line: i + 1,
              type: 'Potentially Stale Comment',
              severity: 'medium',
              message: 'Comment may not match the code below it',
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Check if a comment looks like commented-out code
 */
function looksLikeCode(text) {
  // Skip very short comments
  if (text.length < 10) return false;

  // Skip obvious prose
  if (/^[A-Z][a-z]+\s+[a-z]+/.test(text)) return false; // Starts like a sentence

  // Code patterns
  const codePatterns = [
    /^\s*(?:const|let|var|function|class|if|for|while|return|import|export)\s/,
    /^\s*\w+\s*[=:]\s*[^=]/,  // Assignment
    /^\s*\w+\s*\([^)]*\)\s*[;{]?$/, // Function call
    /^\s*\}\s*(?:else|catch|finally)?\s*\{?\s*$/, // Braces
    /^\s*(?:await|async)\s+/, // Async
    /^\s*\w+\.\w+\(/, // Method call
    /^\s*\/\*|\*\/\s*$/, // Multi-line comment markers
  ];

  return codePatterns.some(pattern => pattern.test(text));
}

/**
 * Check JSDoc accuracy against function signature
 */
function checkJsDocAccuracy(jsDocLines, functionLine, startLine, fileName) {
  const issues = [];
  const jsDoc = jsDocLines.join('\n');

  // Extract @param and @returns from JSDoc
  const jsDocParams = [];
  const paramMatches = jsDoc.matchAll(/@param\s+(?:\{[^}]+\}\s+)?(\w+)/g);
  for (const match of paramMatches) {
    jsDocParams.push(match[1]);
  }

  const hasReturns = /@returns?/.test(jsDoc);

  // Parse function signature
  const funcMatch = functionLine.match(/(?:async\s+)?(?:function\s+)?(\w+)?\s*\(([^)]*)\)/);
  if (!funcMatch) return issues;

  const actualParams = funcMatch[2]
    .split(',')
    .map(p => p.trim().replace(/[:=].*/, '').replace(/^\.\.\./, '').trim())
    .filter(p => p.length > 0);

  // Check for missing params in JSDoc
  for (const param of actualParams) {
    if (!jsDocParams.includes(param)) {
      issues.push({
        file: fileName,
        line: startLine,
        type: 'Missing @param',
        severity: 'medium',
        message: `JSDoc missing @param for "${param}"`,
      });
    }
  }

  // Check for extra params in JSDoc
  for (const param of jsDocParams) {
    if (!actualParams.includes(param)) {
      issues.push({
        file: fileName,
        line: startLine,
        type: 'Extra @param',
        severity: 'medium',
        message: `JSDoc has @param "${param}" but function doesn't have this parameter`,
      });
    }
  }

  // Check for returns mismatch
  const hasReturnStatement = /\breturn\s+[^;]/.test(functionLine) ||
    (functionLine.includes('=>') && !functionLine.includes('=> {'));

  if (hasReturnStatement && !hasReturns) {
    issues.push({
      file: fileName,
      line: startLine,
      type: 'Missing @returns',
      severity: 'low',
      message: 'Function returns a value but JSDoc has no @returns',
    });
  }

  return issues;
}

module.exports = { run, analyzeComments };
