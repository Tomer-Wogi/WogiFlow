#!/usr/bin/env node

/**
 * Security Pass - OWASP checks, injection risks, credential exposure
 *
 * This is a conditional pass that only runs when security-relevant
 * patterns are detected in the code.
 *
 * Checks:
 * - SQL injection risks
 * - XSS vulnerabilities
 * - Command injection
 * - Credential exposure
 * - Insecure crypto
 * - Path traversal
 * - OWASP Top 10 patterns
 */

const path = require('path');
const { readFile, PATHS, getConfig } = require('../flow-utils');

/**
 * SQL Injection patterns
 */
const SQL_INJECTION_PATTERNS = [
  {
    pattern: /query\s*\(\s*['"`][^'"`]*\$\{/g,
    severity: 'critical',
    message: 'Potential SQL injection - template string with interpolation in query',
    type: 'sql-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /query\s*\(\s*['"`]\s*SELECT.*\+/gi,
    severity: 'critical',
    message: 'Potential SQL injection - string concatenation in SELECT query',
    type: 'sql-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /exec\s*\(\s*['"`].*\+.*['"`]\s*\)/g,
    severity: 'high',
    message: 'Potential SQL injection - concatenation in exec()',
    type: 'sql-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+[^`]*\$\{[^}]+\}/gi,
    severity: 'critical',
    message: 'SQL query with unsanitized interpolation - use parameterized queries',
    type: 'sql-injection',
    owasp: 'A03:2021'
  }
];

/**
 * XSS patterns
 */
const XSS_PATTERNS = [
  {
    pattern: /innerHTML\s*=/g,
    severity: 'high',
    message: 'innerHTML assignment - potential XSS, use textContent or sanitize',
    type: 'xss',
    owasp: 'A03:2021'
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    severity: 'high',
    message: 'dangerouslySetInnerHTML - ensure content is sanitized',
    type: 'xss',
    owasp: 'A03:2021'
  },
  {
    pattern: /document\.write\s*\(/g,
    severity: 'high',
    message: 'document.write() - potential XSS and performance issues',
    type: 'xss',
    owasp: 'A03:2021'
  },
  {
    pattern: /eval\s*\(/g,
    severity: 'critical',
    message: 'eval() usage - high security risk, avoid if possible',
    type: 'xss',
    owasp: 'A03:2021'
  },
  {
    pattern: /new\s+Function\s*\(/g,
    severity: 'high',
    message: 'new Function() - similar risks to eval(), avoid dynamic code',
    type: 'xss',
    owasp: 'A03:2021'
  }
];

/**
 * Command injection patterns
 */
const COMMAND_INJECTION_PATTERNS = [
  {
    pattern: /exec\s*\(\s*`[^`]*\$\{/g,
    severity: 'critical',
    message: 'Command injection risk - template literal with interpolation in exec()',
    type: 'command-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /execSync\s*\(\s*['"`][^'"`]*\+/g,
    severity: 'critical',
    message: 'Command injection risk - string concatenation in execSync()',
    type: 'command-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /spawn\s*\([^)]*\+/g,
    severity: 'high',
    message: 'Potential command injection - concatenation in spawn arguments',
    type: 'command-injection',
    owasp: 'A03:2021'
  },
  {
    pattern: /child_process.*exec.*\$\{/g,
    severity: 'critical',
    message: 'Command injection - user input may reach shell command',
    type: 'command-injection',
    owasp: 'A03:2021'
  }
];

/**
 * Credential/secret exposure patterns
 */
const CREDENTIAL_PATTERNS = [
  {
    pattern: /(?:password|passwd|pwd|secret|token|apikey|api_key|auth)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: 'critical',
    message: 'Hardcoded credential detected - use environment variables',
    type: 'credential',
    owasp: 'A07:2021'
  },
  {
    pattern: /['"](?:sk-|pk_|rk_|AIza|AKIA|ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{20,}['"]/g,
    severity: 'critical',
    message: 'API key/token pattern detected in code - must be removed',
    type: 'credential',
    owasp: 'A07:2021'
  },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    severity: 'critical',
    message: 'Private key in source code - serious security violation',
    type: 'credential',
    owasp: 'A07:2021'
  },
  {
    pattern: /(?:mongodb|mysql|postgres|redis):\/\/[^:]+:[^@]+@/gi,
    severity: 'critical',
    message: 'Database connection string with credentials in code',
    type: 'credential',
    owasp: 'A07:2021'
  }
];

/**
 * Insecure crypto patterns
 */
const CRYPTO_PATTERNS = [
  {
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/gi,
    severity: 'high',
    message: 'Weak hash algorithm (MD5/SHA1) - use SHA256 or better',
    type: 'crypto',
    owasp: 'A02:2021'
  },
  {
    pattern: /crypto\.createCipher\s*\(/g,
    severity: 'high',
    message: 'Deprecated crypto.createCipher - use createCipheriv with random IV',
    type: 'crypto',
    owasp: 'A02:2021'
  },
  {
    pattern: /Math\.random\s*\(\s*\).*(?:token|password|secret|key)/gi,
    severity: 'high',
    message: 'Math.random() for security-sensitive value - use crypto.randomBytes()',
    type: 'crypto',
    owasp: 'A02:2021'
  },
  {
    pattern: /algorithm\s*[:=]\s*['"](?:des|rc4|rc2)['"]/gi,
    severity: 'critical',
    message: 'Insecure encryption algorithm - use AES-256 or better',
    type: 'crypto',
    owasp: 'A02:2021'
  }
];

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = [
  {
    pattern: /path\.join\s*\([^)]*(?:req\.|params\.|query\.)/g,
    severity: 'high',
    message: 'User input in path.join - potential path traversal',
    type: 'path-traversal',
    owasp: 'A01:2021'
  },
  {
    pattern: /readFile(?:Sync)?\s*\([^)]*\+/g,
    severity: 'high',
    message: 'Concatenation in file read - potential path traversal',
    type: 'path-traversal',
    owasp: 'A01:2021'
  },
  {
    pattern: /\.\.\/|\.\.\\|%2e%2e/gi,
    context: (content, index) => {
      // Check if this is in user input handling code
      const around = content.substring(Math.max(0, index - 200), Math.min(content.length, index + 200));
      return around.includes('req.') || around.includes('input') || around.includes('param');
    },
    severity: 'high',
    message: 'Path traversal pattern near user input handling',
    type: 'path-traversal',
    owasp: 'A01:2021'
  }
];

/**
 * Authentication/Authorization patterns
 */
const AUTH_PATTERNS = [
  {
    pattern: /===\s*['"](?:admin|root|superuser)['"]/gi,
    severity: 'medium',
    message: 'Hardcoded role check - use role constants or config',
    type: 'auth',
    owasp: 'A01:2021'
  },
  {
    pattern: /jwt\.verify\s*\([^)]+\)\s*;[^}]*(?!catch)/g,
    severity: 'medium',
    message: 'JWT verification without error handling',
    type: 'auth',
    owasp: 'A07:2021'
  },
  {
    pattern: /algorithm\s*[:=]\s*['"]none['"]/gi,
    severity: 'critical',
    message: 'JWT "none" algorithm - critical authentication bypass vulnerability',
    type: 'auth',
    owasp: 'A07:2021'
  },
  {
    pattern: /session\s*\.\s*(?:cookie\s*\.)?(?:secure|httpOnly)\s*[:=]\s*false/gi,
    severity: 'high',
    message: 'Insecure session cookie configuration',
    type: 'auth',
    owasp: 'A07:2021'
  }
];

/**
 * All security patterns combined
 */
const ALL_SECURITY_PATTERNS = [
  ...SQL_INJECTION_PATTERNS,
  ...XSS_PATTERNS,
  ...COMMAND_INJECTION_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...CRYPTO_PATTERNS,
  ...PATH_TRAVERSAL_PATTERNS,
  ...AUTH_PATTERNS
];

/**
 * Check file for security issues
 * @param {Object} file - File object with path and content
 * @returns {Object[]} Array of issues
 */
function checkFileSecurity(file) {
  const issues = [];
  const content = file.content || '';
  const isTestFile = /\.(test|spec)\.[tj]sx?$/.test(file.path);

  // Skip test files for most security checks
  // (credentials in test mocks are expected)
  const patternsToCheck = isTestFile
    ? ALL_SECURITY_PATTERNS.filter(p => !['credential'].includes(p.type))
    : ALL_SECURITY_PATTERNS;

  for (const patternDef of patternsToCheck) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Run context check if defined
      if (patternDef.context && !patternDef.context(content, match.index)) {
        continue;
      }

      // Find line number
      const lineNumber = content.substring(0, match.index).split('\n').length;

      // Truncate match for display
      const snippet = match[0].length > 60
        ? match[0].substring(0, 60) + '...'
        : match[0];

      issues.push({
        severity: patternDef.severity,
        message: patternDef.message,
        file: file.path,
        line: lineNumber,
        type: patternDef.type,
        owasp: patternDef.owasp,
        snippet: snippet.replace(/[\n\r]/g, ' ')
      });
    }
  }

  return issues;
}

/**
 * Check for sensitive file patterns
 * @param {string} filePath - File path
 * @returns {Object|null} Issue if sensitive file pattern detected
 */
function checkSensitiveFile(filePath) {
  const fileName = path.basename(filePath).toLowerCase();

  const sensitivePatterns = [
    { pattern: /\.env(?:\.local)?$/, message: '.env file should not be committed' },
    { pattern: /\.pem$/, message: 'PEM file (certificate/key) should not be committed' },
    { pattern: /\.key$/, message: 'Key file should not be committed' },
    { pattern: /credentials\.json$/, message: 'Credentials file should not be committed' },
    { pattern: /secrets?\.(?:json|ya?ml)$/, message: 'Secrets file should not be committed' }
  ];

  for (const { pattern, message } of sensitivePatterns) {
    if (pattern.test(fileName)) {
      return {
        severity: 'critical',
        message,
        file: filePath,
        type: 'sensitive-file',
        owasp: 'A07:2021'
      };
    }
  }

  return null;
}

/**
 * Run the security pass
 * @param {Object} context - Review context
 * @returns {Promise<Object>} Pass results
 */
async function run(context) {
  const { files = [], previousResults = {} } = context;

  const issues = [];
  const suggestions = [];
  const filesToExamine = [];
  const metrics = {
    filesChecked: 0,
    issuesByType: {},
    issuesBySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    },
    owaspFindings: {}
  };

  // Focus on files flagged by previous passes
  const priorityFiles = [
    ...(previousResults.structure?.filesToExamine || []),
    ...(previousResults.logic?.filesToExamine || [])
  ];

  // Check each file
  for (const file of files) {
    metrics.filesChecked++;

    // Sensitive file check
    const sensitiveIssue = checkSensitiveFile(file.path);
    if (sensitiveIssue) {
      issues.push(sensitiveIssue);
      metrics.issuesByType['sensitive-file'] = (metrics.issuesByType['sensitive-file'] || 0) + 1;
      metrics.issuesBySeverity[sensitiveIssue.severity]++;
    }

    // Security pattern checks
    const securityIssues = checkFileSecurity(file);
    for (const issue of securityIssues) {
      issues.push(issue);
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
      metrics.issuesBySeverity[issue.severity]++;

      // Track OWASP categories
      if (issue.owasp) {
        metrics.owaspFindings[issue.owasp] = (metrics.owaspFindings[issue.owasp] || 0) + 1;
      }

      // Critical issues need immediate attention
      if (issue.severity === 'critical' && !filesToExamine.includes(file.path)) {
        filesToExamine.push(file.path);
      }
    }
  }

  // Generate suggestions based on findings
  if (metrics.issuesBySeverity.critical > 0) {
    suggestions.push({
      message: `CRITICAL: ${metrics.issuesBySeverity.critical} critical security issues must be fixed immediately`,
      priority: 'critical'
    });
  }

  if (metrics.issuesByType['sql-injection'] > 0) {
    suggestions.push({
      message: 'Use parameterized queries or an ORM to prevent SQL injection',
      priority: 'high'
    });
  }

  if (metrics.issuesByType['credential'] > 0) {
    suggestions.push({
      message: 'Move all credentials to environment variables and add files to .gitignore',
      priority: 'critical'
    });
  }

  if (metrics.issuesByType['xss'] > 0) {
    suggestions.push({
      message: 'Implement content sanitization and use safe APIs (textContent vs innerHTML)',
      priority: 'high'
    });
  }

  if (Object.keys(metrics.owaspFindings).length > 2) {
    suggestions.push({
      message: 'Multiple OWASP Top 10 categories affected - consider a security audit',
      priority: 'high'
    });
  }

  return {
    issues,
    suggestions,
    filesToExamine,
    metrics
  };
}

module.exports = { run };
