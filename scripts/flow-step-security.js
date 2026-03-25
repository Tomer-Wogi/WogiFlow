#!/usr/bin/env node

/**
 * Wogi Flow - Security Scan Step
 *
 * Workflow step for security scanning.
 * Runs npm audit and checks for common vulnerabilities.
 */

const { execSync } = require('node:child_process');
const { BaseWorkflowStep } = require('./base-workflow-step');
const { PATHS } = require('./flow-utils');
const { CREDENTIAL_SCAN_PATTERNS } = require('./flow-security');

class SecurityStep extends BaseWorkflowStep {
  constructor() {
    // Security step checks ALL file types (not just code), so use broad extensions
    super('securityScan', {
      extensions: ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.json', '.yml', '.yaml', '.env', '.sh'],
      excludeTests: true,
      excludeDts: true,
    });
  }

  // Override filterFiles for security-specific exclusions
  filterFiles(files) {
    return files.filter(f => !f.includes('.example'));
  }

  async execute(files, options) {
    const { stepConfig = {} } = options;
    const severity = stepConfig.severity || 'high';
    const issues = [];

    // 1. Check for secrets in modified files (using centralized patterns)
    for (const file of files) {
      const content = this.readFile(file);
      if (!content) continue;

      try {
        for (const { pattern, name } of CREDENTIAL_SCAN_PATTERNS) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            issues.push({
              type: 'secret',
              severity: 'high',
              file,
              message: name || 'Potential secret or credential detected',
            });
            break;
          }
        }
      } catch (_err) {
        // Skip unreadable files
      }
    }

    // 2. Run npm audit if package.json was modified
    const packageModified = files.some(f => f.endsWith('package.json') || f.endsWith('package-lock.json'));

    if (packageModified || stepConfig.alwaysAudit) {
      try {
        const auditResult = execSync('npm audit --json 2>/dev/null', {
          cwd: PATHS.root,
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
        if (err.stdout) {
          try {
            const audit = JSON.parse(err.stdout);
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
          } catch (_parseError) {
            // Ignore parse errors
          }
        }
      }
    }

    // 3. Evaluate results
    if (issues.length === 0) {
      return this.pass('Security scan passed');
    }

    // Filter by severity for blocking
    const blockingIssues = issues.filter(i => {
      if (severity === 'critical') return i.severity === 'critical';
      if (severity === 'high') return i.severity === 'high' || i.severity === 'critical';
      return true;
    });

    if (blockingIssues.length > 0) {
      return this.fail(`${blockingIssues.length} security issue(s) found`, blockingIssues);
    }

    // Non-blocking issues
    return this.pass(`${issues.length} low-severity issue(s) found`);
  }
}

const step = new SecurityStep();
module.exports = { run: (opts) => step.run(opts) };
