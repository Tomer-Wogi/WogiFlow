#!/usr/bin/env node

/**
 * Wogi Flow - Security Scan Step
 *
 * Workflow step for security scanning.
 * Runs npm audit and checks for common vulnerabilities.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run security scan as a workflow step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {}, mode } = options;
  const severity = stepConfig.severity || 'high';
  const issues = [];

  // 1. Check for secrets in modified files
  const secretPatterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/gi,
    /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/gi,
    /(?:access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]+['"]/gi,
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
    /(?:aws[_-]?access[_-]?key[_-]?id)\s*[:=]\s*['"][A-Z0-9]+['"]/gi,
  ];

  for (const file of files) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    // Skip test files and config examples
    if (file.includes('.test.') || file.includes('.spec.') || file.includes('.example')) {
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
          issues.push({
            type: 'secret',
            severity: 'high',
            file,
            message: 'Potential secret or credential detected',
          });
          break; // One issue per file is enough
        }
      }
    } catch (err) {
      // Skip unreadable files
    }
  }

  // 2. Run npm audit if package.json was modified
  const packageModified = files.some(f => f.endsWith('package.json') || f.endsWith('package-lock.json'));

  if (packageModified || stepConfig.alwaysAudit) {
    try {
      const auditResult = execSync('npm audit --json 2>/dev/null', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const audit = JSON.parse(auditResult);

      if (audit.metadata && audit.metadata.vulnerabilities) {
        const vulns = audit.metadata.vulnerabilities;

        if (severity === 'critical' && vulns.critical > 0) {
          issues.push({
            type: 'npm_audit',
            severity: 'critical',
            message: `${vulns.critical} critical vulnerabilities found`,
            count: vulns.critical,
          });
        } else if (severity === 'high' && (vulns.critical > 0 || vulns.high > 0)) {
          const count = vulns.critical + vulns.high;
          issues.push({
            type: 'npm_audit',
            severity: 'high',
            message: `${count} high/critical vulnerabilities found`,
            count,
          });
        } else if (severity === 'moderate') {
          const count = vulns.critical + vulns.high + vulns.moderate;
          if (count > 0) {
            issues.push({
              type: 'npm_audit',
              severity: 'moderate',
              message: `${count} moderate+ vulnerabilities found`,
              count,
            });
          }
        }
      }
    } catch (err) {
      // npm audit failed or returned non-zero
      if (e.stdout) {
        try {
          const audit = JSON.parse(e.stdout);
          if (audit.metadata && audit.metadata.vulnerabilities) {
            const vulns = audit.metadata.vulnerabilities;
            const count = vulns.critical + vulns.high;
            if (count > 0 && (severity === 'high' || severity === 'critical')) {
              issues.push({
                type: 'npm_audit',
                severity: 'high',
                message: `${count} high/critical vulnerabilities`,
                count,
              });
            }
          }
        } catch (parseError) {
          // Ignore parse errors
        }
      }
    }
  }

  // 3. Evaluate results
  if (issues.length === 0) {
    return { passed: true, message: 'Security scan passed' };
  }

  // Filter by severity for blocking
  const blockingIssues = issues.filter(i => {
    if (severity === 'critical') return i.severity === 'critical';
    if (severity === 'high') return i.severity === 'high' || i.severity === 'critical';
    return true;
  });

  if (blockingIssues.length > 0) {
    return {
      passed: false,
      message: `${blockingIssues.length} security issue(s) found`,
      details: blockingIssues,
    };
  }

  // Non-blocking issues
  return {
    passed: true,
    message: `${issues.length} low-severity issue(s) found`,
    details: issues,
  };
}

module.exports = { run };
