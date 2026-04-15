#!/usr/bin/env node

/**
 * Wogi Flow - Permission Rule Audit (Claude Code settings.local.json)
 *
 * Analyzes Claude Code permission rules (e.g., 'Bash(git:*)') for duplicates,
 * overly broad wildcards, and redundant specific rules covered by wildcards.
 * Extracted from flow-utils.js (wf-94cc3b72 epic — decomposition pass).
 *
 * Separate from flow-permissions.js (which manages user permission grants
 * for WogiFlow operations) — these audit the upstream Claude Code config.
 *
 * Pure functions with no filesystem side effects. Zero external deps.
 */

'use strict';

/**
 * Analyze permission rules for issues
 * @param {string[]} permissions - Array of permission rule strings
 * @returns {Object} Analysis result with duplicates, overbroad, shadowed, total
 */
function analyzePermissions(permissions) {
  const result = {
    duplicates: [],
    overbroad: [],
    shadowed: [],
    total: permissions.length
  };

  // Check for duplicates
  const seen = new Set();
  for (const perm of permissions) {
    if (seen.has(perm)) {
      result.duplicates.push(perm);
    }
    seen.add(perm);
  }

  // Check for overly broad patterns (wildcards on core tools)
  const overbroadPatterns = ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)'];
  for (const perm of permissions) {
    if (overbroadPatterns.includes(perm)) {
      result.overbroad.push(perm);
    }
  }

  // Check for shadowed rules (specific rules covered by wildcards)
  const wildcards = permissions.filter(p => p.includes('*'));
  const specific = permissions.filter(p => !p.includes('*'));

  for (const spec of specific) {
    const match = spec.match(/^(\w+)\((.+)\)$/);
    if (match) {
      const [, tool, pattern] = match;
      for (const wild of wildcards) {
        const wildMatch = wild.match(/^(\w+)\((.+)\)$/);
        if (wildMatch && wildMatch[1] === tool) {
          const wildPattern = wildMatch[2].replace(/\*/g, '.*');
          try {
            const regex = new RegExp(`^${wildPattern}$`);
            if (regex.test(pattern)) {
              result.shadowed.push({ specific: spec, wildcard: wild });
              break;
            }
          } catch (_err) {
            // Invalid regex, skip
          }
        }
      }
    }
  }

  return result;
}

/**
 * Validate permission rules and return classified issues + warnings.
 * @param {string[]} permissions - Array of permission rules
 * @returns {Object} { valid, issues, warnings, analysis }
 */
function validatePermissions(permissions) {
  const analysis = analyzePermissions(permissions);

  const issues = [];
  const warnings = [];

  if (analysis.duplicates.length > 0) {
    warnings.push({
      type: 'duplicate',
      message: `${analysis.duplicates.length} duplicate rule(s) found`,
      items: analysis.duplicates
    });
  }

  if (analysis.overbroad.length > 0) {
    issues.push({
      type: 'overbroad',
      severity: 'critical',
      message: `${analysis.overbroad.length} overly broad rule(s) found`,
      items: analysis.overbroad
    });
  }

  if (analysis.shadowed.length > 0) {
    warnings.push({
      type: 'shadowed',
      message: `${analysis.shadowed.length} rule(s) shadowed by wildcards (redundant)`,
      items: analysis.shadowed.map(s => s.specific)
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    analysis
  };
}

module.exports = {
  analyzePermissions,
  validatePermissions,
};
