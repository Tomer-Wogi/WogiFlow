#!/usr/bin/env node

/**
 * Wogi Flow - Task Completion Summary Generator
 *
 * Auto-generates a structured completion summary file when a task finishes.
 * Writes to .workflow/completed/<feature>/wf-XXXXXXXX-completed.md
 *
 * This is best-effort — failures never block task completion.
 */

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { getConfig, PATHS, safeJsonParse, writeFile, ensureDir, isPathWithinProject, validateTaskId } = require('./flow-utils');

/**
 * Check if completion summaries are enabled in config
 * @returns {boolean}
 */
function isSummaryEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.completionSummaries?.enabled !== false;
}

/**
 * Find the story/spec file for a given task ID
 * Searches .workflow/changes/ (flat and subdirectories)
 * @param {string} taskId
 * @param {string} [feature] - Feature subdirectory hint
 * @returns {string|null} Path to the story file, or null
 */
function findStoryFile(taskId, feature) {
  // Validate task ID to prevent path traversal
  if (!validateTaskId(taskId).valid) {
    return null;
  }

  // Sanitize feature — only allow alphanumeric, hyphens, underscores
  const safeFeature = feature ? feature.replace(/[^a-zA-Z0-9_-]/g, '') : null;

  const changesDir = path.join(PATHS.workflow, 'changes');

  // Try feature subdirectory first (most common)
  if (safeFeature) {
    const featurePath = path.join(changesDir, safeFeature, `${taskId}.md`);
    try {
      if (fs.existsSync(featurePath)) {
        return featurePath;
      }
    } catch (_err) {
      // Permission or access error — continue to other lookups
    }
  }

  // Try flat root
  const directPath = path.join(changesDir, `${taskId}.md`);
  try {
    if (fs.existsSync(directPath)) {
      return directPath;
    }
  } catch (_err) {
    // Continue
  }

  // Scan all subdirectories
  try {
    if (fs.existsSync(changesDir)) {
      const entries = fs.readdirSync(changesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(changesDir, entry.name, `${taskId}.md`);
          try {
            if (fs.existsSync(subPath)) {
              return subPath;
            }
          } catch (_err) {
            // Continue scanning
          }
        }
      }
    }
  } catch (_err) {
    // readdirSync failed
  }

  return null;
}

/**
 * Extract acceptance criteria from a story/spec markdown file
 * @param {string} content - Markdown content
 * @returns {string[]} List of criteria descriptions
 */
function extractAcceptanceCriteria(content) {
  const criteria = [];
  const lines = content.split('\n');
  let inCriteria = false;

  for (const line of lines) {
    // Detect criteria section headers
    if (/^##\s+Acceptance Criteria/i.test(line)) {
      inCriteria = true;
      continue;
    }
    // Stop at next major section
    if (inCriteria && /^##\s+[^#]/.test(line) && !/scenario/i.test(line)) {
      break;
    }

    if (inCriteria) {
      // Match scenario headers (### Scenario N: ...)
      const scenarioMatch = line.match(/^###\s+Scenario\s+\d+:\s*(.+)/i);
      if (scenarioMatch) {
        criteria.push(scenarioMatch[1].trim());
        continue;
      }
      // Match Given lines as criteria (works alongside Scenario headers too)
      const givenMatch = line.match(/^Given\s+(.+)/i);
      if (givenMatch) {
        // Only add Given lines that aren't duplicates of already-captured Scenario titles
        const givenText = givenMatch[1].trim();
        if (!criteria.some(c => c.toLowerCase() === givenText.toLowerCase())) {
          criteria.push(givenText);
        }
      }
    }
  }

  return criteria;
}

/**
 * Collect verification artifacts for a task
 * @param {string} taskId
 * @returns {Object[]} Array of { gate, status } objects
 */
function collectVerificationResults(taskId) {
  const results = [];
  const verificationsDir = path.join(PATHS.workflow, 'verifications');

  // Look for final verification artifact
  const finalPath = path.join(verificationsDir, `${taskId}-final.json`);
  try {
    if (fs.existsSync(finalPath)) {
      const data = safeJsonParse(finalPath, null);
      if (data && data.results) {
        for (const r of data.results) {
          results.push({
            gate: r.command || r.gate || 'unknown',
            status: r.passed ? 'PASS' : 'FAIL'
          });
        }
        return results;
      }
    }
  } catch (_err) {
    // Continue without verification data
  }

  // Look for scenario-level artifacts
  try {
    if (fs.existsSync(verificationsDir)) {
      const files = fs.readdirSync(verificationsDir)
        .filter(f => f.startsWith(taskId) && f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = safeJsonParse(path.join(verificationsDir, file), null);
          if (data && data.results) {
            for (const r of data.results) {
              results.push({
                gate: r.command || r.gate || 'unknown',
                status: r.passed ? 'PASS' : 'FAIL'
              });
            }
          }
        } catch (_err) {
          // Skip unreadable artifact
        }
      }
    }
  } catch (_err) {
    // No verification data available
  }

  return results;
}

/**
 * Collect review findings associated with a task
 * @param {string} taskId
 * @param {string[]} [changedFiles] - Optional list of changed files to scope findings
 * @returns {{ count: number, fixed: number, deferred: number }}
 */
function collectReviewFindings(taskId, changedFiles) {
  const summary = { count: 0, fixed: 0, deferred: 0 };

  // Check last-review.json for findings scoped to this task's changed files
  const reviewPath = path.join(PATHS.state, 'last-review.json');
  try {
    if (fs.existsSync(reviewPath)) {
      const review = safeJsonParse(reviewPath, null);
      if (review && review.findings) {
        // Scope findings to this task's files when possible
        let relevantFindings = review.findings;
        if (changedFiles && changedFiles.length > 0) {
          relevantFindings = review.findings.filter(f => {
            if (!f.file) return true;
            return changedFiles.some(cf =>
              f.file === cf || cf === f.file ||
              f.file.endsWith('/' + cf) || cf.endsWith('/' + f.file)
            );
          });
        }
        summary.count = relevantFindings.length;
        summary.fixed = relevantFindings.filter(f => f.status === 'fixed').length;
        summary.deferred = relevantFindings.filter(f => f.status !== 'fixed' && f.status !== 'dismissed').length;
      }
    }
  } catch (_err) {
    // No review data
  }

  return summary;
}

/**
 * Get files changed by a task (from git, best-effort)
 * @param {string} taskId
 * @returns {string[]}
 */
function getChangedFiles(taskId) {
  try {
    // Try to find commits by task ID in commit messages for full range
    if (taskId) {
      try {
        const commits = execFileSync('git', ['log', '--format=%H', '--grep', taskId], {
          encoding: 'utf-8',
          timeout: 5000
        }).trim();
        if (commits) {
          const commitList = commits.split('\n').filter(Boolean);
          const oldest = commitList[commitList.length - 1];
          // Use diff-tree --root for the oldest commit (handles root commits without parent)
          // then union with diff to HEAD for the range
          let files = [];
          try {
            const rangeOutput = execFileSync('git', ['diff', '--name-only', `${oldest}~1`, 'HEAD'], {
              encoding: 'utf-8',
              timeout: 5000
            });
            files = rangeOutput.trim().split('\n').filter(Boolean);
          } catch (_err) {
            // oldest~1 fails on root commit — use diff-tree --root instead
            const rootOutput = execFileSync('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
              encoding: 'utf-8',
              timeout: 5000
            });
            files = rootOutput.trim().split('\n').filter(Boolean);
          }
          const output = files.join('\n');
          return output.trim().split('\n').filter(Boolean);
        }
      } catch (_err) {
        // Fall through to single-commit fallback
      }
    }

    // Fallback: files changed in the most recent commit
    const output = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5000
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (_err) {
    return [];
  }
}

/**
 * Format a duration between two ISO timestamps
 * @param {string} startedAt - ISO timestamp
 * @param {string} completedAt - ISO timestamp
 * @returns {string} Formatted duration (e.g., "1h 23m")
 */
function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return 'unknown';

  try {
    const start = new Date(startedAt);
    const end = new Date(completedAt);
    const diffMs = end - start;

    if (isNaN(diffMs) || diffMs < 0) return 'unknown';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  } catch (_err) {
    return 'unknown';
  }
}

/**
 * Generate a completion summary markdown file
 * @param {Object} task - The completed task object from ready.json
 * @param {Object} [input] - Additional input from the hook
 * @returns {{ path: string|null, success: boolean, reason?: string }}
 */
function generateCompletionSummary(task, input) {
  if (!isSummaryEnabled()) {
    return { path: null, success: false, reason: 'disabled' };
  }

  if (!task || !task.id) {
    return { path: null, success: false, reason: 'no task' };
  }

  // Validate task ID to prevent path traversal
  if (!validateTaskId(task.id).valid) {
    return { path: null, success: false, reason: 'invalid task ID' };
  }

  const feature = (task.feature || 'general').replace(/[^a-zA-Z0-9_-]/g, '');
  const completedDir = path.join(PATHS.workflow, 'completed', feature);

  // Path safety check
  if (!isPathWithinProject(completedDir)) {
    return { path: null, success: false, reason: 'path outside project' };
  }

  // Ensure directory exists
  ensureDir(completedDir);

  const summaryPath = path.join(completedDir, `${task.id}-completed.md`);

  // Gather data (all best-effort)
  const storyFile = findStoryFile(task.id, feature);
  let criteria = [];
  if (storyFile) {
    try {
      const content = fs.readFileSync(storyFile, 'utf-8');
      criteria = extractAcceptanceCriteria(content);
    } catch (_err) {
      // Story file unreadable
    }
  }

  const verificationResults = collectVerificationResults(task.id);
  const changedFiles = (input && input.changedFiles) || getChangedFiles(task.id);
  const reviewFindings = collectReviewFindings(task.id, changedFiles);
  const duration = formatDuration(task.startedAt, task.completedAt);
  const completedDate = task.completedAt
    ? new Date(task.completedAt).toISOString().replace('T', ' ').substring(0, 16)
    : new Date().toISOString().replace('T', ' ').substring(0, 16);

  // Build markdown
  const lines = [];
  lines.push(`# Completed: ${task.id} — ${task.title || 'Untitled'}`);
  lines.push('');
  lines.push(`**Completed**: ${completedDate}`);
  lines.push(`**Duration**: ${duration}`);
  lines.push(`**Type**: ${task.type || 'unknown'}`);
  lines.push(`**Feature**: ${feature}`);
  lines.push('');

  // Acceptance criteria section
  lines.push('## Acceptance Criteria Results');
  lines.push('');
  if (criteria.length > 0) {
    // Determine overall verification status — distinguish partial from total failure
    const failedGates = verificationResults.filter(v => v.status === 'FAIL');
    const passedGates = verificationResults.filter(v => v.status === 'PASS');
    let defaultStatus;
    if (verificationResults.length === 0) {
      defaultStatus = 'UNVERIFIED';
    } else if (failedGates.length === 0) {
      defaultStatus = 'PASS';
    } else if (passedGates.length === 0) {
      defaultStatus = 'FAIL';
    } else {
      defaultStatus = 'PARTIAL';
    }

    lines.push('| # | Criterion | Status |');
    lines.push('|---|-----------|--------|');
    for (let i = 0; i < criteria.length; i++) {
      lines.push(`| ${i + 1} | ${criteria[i]} | ${defaultStatus} |`);
    }
    lines.push('');
    if (defaultStatus === 'UNVERIFIED') {
      lines.push(`**Result**: ${criteria.length} criteria (no verification artifacts found)`);
    } else if (defaultStatus === 'PASS') {
      lines.push(`**Result**: ${criteria.length}/${criteria.length} passed`);
    } else if (defaultStatus === 'PARTIAL') {
      lines.push(`**Result**: ${passedGates.length}/${verificationResults.length} gates passed (${failedGates.length} failed)`);
    } else {
      lines.push(`**Result**: 0/${criteria.length} passed`);
    }
  } else {
    lines.push('No acceptance criteria found in story file.');
  }
  lines.push('');

  // Files changed section
  lines.push('## Files Changed');
  lines.push('');
  if (changedFiles.length > 0) {
    lines.push('| File | Change |');
    lines.push('|------|--------|');
    for (const file of changedFiles) {
      lines.push(`| ${file} | Modified |`);
    }
  } else {
    lines.push('No file change data available.');
  }
  lines.push('');

  // Verification results section
  lines.push('## Verification Results');
  lines.push('');
  if (verificationResults.length > 0) {
    lines.push('| Gate | Status |');
    lines.push('|------|--------|');
    for (const v of verificationResults) {
      lines.push(`| ${v.gate} | ${v.status} |`);
    }
  } else {
    lines.push('No verification artifacts found.');
  }
  lines.push('');

  // Review findings section
  lines.push('## Review Findings');
  lines.push('');
  if (reviewFindings.count > 0) {
    lines.push(`${reviewFindings.count} findings — ${reviewFindings.fixed} fixed, ${reviewFindings.deferred} deferred`);
  } else {
    lines.push('No review findings for this task.');
  }
  lines.push('');

  // Lessons learned section (placeholder — populated from corrections if any)
  lines.push('## Lessons Learned');
  lines.push('');
  const lessonsLearned = collectLessonsLearned(task.id);
  if (lessonsLearned.length > 0) {
    for (const lesson of lessonsLearned) {
      lines.push(`- ${lesson}`);
    }
  } else {
    lines.push('No corrections or lessons captured during this task.');
  }
  lines.push('');

  // Write the summary file
  const content = lines.join('\n');
  try {
    writeFile(summaryPath, content);
    return { path: summaryPath, success: true };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Completion Summary] Write failed: ${err.message}`);
    }
    return { path: null, success: false, reason: err.message };
  }
}

/**
 * Collect lessons learned from corrections directory
 * @param {string} taskId
 * @returns {string[]}
 */
function collectLessonsLearned(taskId) {
  const lessons = [];
  const correctionsDir = path.join(PATHS.workflow, 'corrections');

  try {
    if (!fs.existsSync(correctionsDir)) return lessons;

    const files = fs.readdirSync(correctionsDir)
      .filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(correctionsDir, file), 'utf-8');
        if (content.includes(taskId)) {
          // Extract the Prevention line from correction reports
          const preventionMatch = content.match(/\*\*Prevention\*\*:\s*(.+)/);
          if (preventionMatch) {
            lessons.push(preventionMatch[1].trim());
          }
        }
      } catch (_err) {
        // Skip unreadable correction file
      }
    }
  } catch (_err) {
    // No corrections directory or can't read it
  }

  return lessons;
}

module.exports = { generateCompletionSummary, isSummaryEnabled, findStoryFile, extractAcceptanceCriteria };
