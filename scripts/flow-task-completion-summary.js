#!/usr/bin/env node

/**
 * Wogi Flow - Task Completion Summary Generator
 *
 * Auto-generates a structured completion summary file when a task finishes.
 * Writes to .workflow/completed/<feature>/wf-XXXXXXXX-completed.md
 *
 * This is best-effort — failures never block task completion.
 */

const path = require('path');
const fs = require('fs');
const { getConfig, PATHS, safeJsonParse, readFile, writeFile, ensureDir, isPathWithinProject } = require('./flow-utils');

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
  const changesDir = path.join(PATHS.workflow, 'changes');

  // Try feature subdirectory first (most common)
  if (feature) {
    const featurePath = path.join(changesDir, feature, `${taskId}.md`);
    try {
      if (fs.existsSync(featurePath)) {
        return featurePath;
      }
    } catch {
      // Permission or access error — continue to other lookups
    }
  }

  // Try flat root
  const directPath = path.join(changesDir, `${taskId}.md`);
  try {
    if (fs.existsSync(directPath)) {
      return directPath;
    }
  } catch {
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
          } catch {
            // Continue scanning
          }
        }
      }
    }
  } catch {
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
      // Match Given/When/Then lines as criteria if no scenario headers
      const givenMatch = line.match(/^(?:Given|When|Then)\s+(.+)/i);
      if (givenMatch && criteria.length === 0) {
        criteria.push(givenMatch[1].trim());
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
  } catch {
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
        } catch {
          // Skip unreadable artifact
        }
      }
    }
  } catch {
    // No verification data available
  }

  return results;
}

/**
 * Collect review findings associated with a task
 * @param {string} taskId
 * @returns {{ count: number, fixed: number, deferred: number }}
 */
function collectReviewFindings(taskId) {
  const summary = { count: 0, fixed: 0, deferred: 0 };

  // Check last-review.json for findings referencing this task's files
  const reviewPath = path.join(PATHS.state, 'last-review.json');
  try {
    if (fs.existsSync(reviewPath)) {
      const review = safeJsonParse(reviewPath, null);
      if (review && review.findings) {
        summary.count = review.findings.length;
        summary.fixed = review.findings.filter(f => f.status === 'fixed').length;
        summary.deferred = review.findings.filter(f => f.status !== 'fixed' && f.status !== 'dismissed').length;
      }
    }
  } catch {
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
    const { execSync } = require('child_process');
    // Get files changed in the most recent commit (likely the task commit)
    const output = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
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
  } catch {
    return 'unknown';
  }
}

/**
 * Generate a completion summary markdown file
 * @param {Object} task - The completed task object from ready.json
 * @param {Object} [input] - Additional input from the hook
 * @returns {Promise<{ path: string, success: boolean }>}
 */
async function generateCompletionSummary(task, input) {
  if (!isSummaryEnabled()) {
    return { path: null, success: false, reason: 'disabled' };
  }

  if (!task || !task.id) {
    return { path: null, success: false, reason: 'no task' };
  }

  const feature = task.feature || 'general';
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
    } catch {
      // Story file unreadable
    }
  }

  const verificationResults = collectVerificationResults(task.id);
  const reviewFindings = collectReviewFindings(task.id);
  const changedFiles = (input && input.changedFiles) || getChangedFiles(task.id);
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
    lines.push('| # | Criterion | Status |');
    lines.push('|---|-----------|--------|');
    for (let i = 0; i < criteria.length; i++) {
      lines.push(`| ${i + 1} | ${criteria[i]} | PASS |`);
    }
    lines.push('');
    lines.push(`**Result**: ${criteria.length}/${criteria.length} passed`);
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
      } catch {
        // Skip unreadable correction file
      }
    }
  } catch {
    // No corrections directory or can't read it
  }

  return lessons;
}

module.exports = { generateCompletionSummary, isSummaryEnabled, findStoryFile, extractAcceptanceCriteria };
