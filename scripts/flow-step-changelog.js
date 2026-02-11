#!/usr/bin/env node

/**
 * Wogi Flow - Update Changelog Step
 *
 * Prompts or auto-generates changelog entries.
 * Follows Keep a Changelog format.
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const CHANGELOG_PATH = path.join(PROJECT_ROOT, 'CHANGELOG.md');

/**
 * Run update changelog step
 *
 * @param {object} options
 * @param {string} options.taskId - Current task ID
 * @param {string} options.taskTitle - Task title/description
 * @param {string} options.taskType - Task type (feature/bugfix/refactor)
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, entry?: string }
 */
async function run(options = {}) {
  const { taskId, taskTitle, taskType, files = [], mode, stepConfig = {} } = options;

  // Determine changelog category
  const category = getChangelogCategory(taskType, taskTitle, files);

  // Generate suggested entry
  const entry = generateEntry(taskId, taskTitle, category, files);

  // In prompt mode, show suggestion
  if (mode === 'prompt') {
    console.log(colors.yellow + '\n  Suggested changelog entry:' + colors.reset);
    console.log(colors.gray + `  ### ${category}` + colors.reset);
    console.log(`  - ${entry}`);

    if (!fs.existsSync(CHANGELOG_PATH)) {
      console.log(colors.yellow + '\n  CHANGELOG.md does not exist - will create if approved' + colors.reset);
    }

    return {
      passed: true,
      message: 'Changelog entry suggested',
      entry,
      category,
      suggestion: `Add to CHANGELOG.md under ${category}`,
    };
  }

  // In auto mode, add the entry
  if (mode === 'auto') {
    const result = addToChangelog(entry, category);
    if (result.success) {
      return {
        passed: true,
        message: 'Changelog entry added',
        entry,
        category,
      };
    } else {
      return {
        passed: false,
        message: result.error,
      };
    }
  }

  // In warn mode, just report
  return {
    passed: true,
    message: `Changelog entry ready: ${entry}`,
    entry,
    category,
  };
}

/**
 * Determine changelog category from task type
 */
function getChangelogCategory(taskType, taskTitle, files) {
  // Explicit type mapping
  const typeMap = {
    feature: 'Added',
    feat: 'Added',
    add: 'Added',
    bugfix: 'Fixed',
    fix: 'Fixed',
    refactor: 'Changed',
    change: 'Changed',
    update: 'Changed',
    remove: 'Removed',
    delete: 'Removed',
    deprecate: 'Deprecated',
    security: 'Security',
  };

  if (taskType && typeMap[taskType.toLowerCase()]) {
    return typeMap[taskType.toLowerCase()];
  }

  // Infer from title
  const titleLower = (taskTitle || '').toLowerCase();

  if (titleLower.includes('add') || titleLower.includes('implement') || titleLower.includes('create')) {
    return 'Added';
  }
  if (titleLower.includes('fix') || titleLower.includes('bug') || titleLower.includes('resolve')) {
    return 'Fixed';
  }
  if (titleLower.includes('remove') || titleLower.includes('delete')) {
    return 'Removed';
  }
  if (titleLower.includes('refactor') || titleLower.includes('update') || titleLower.includes('change')) {
    return 'Changed';
  }
  if (titleLower.includes('deprecate')) {
    return 'Deprecated';
  }
  if (titleLower.includes('security') || titleLower.includes('vulnerability')) {
    return 'Security';
  }

  // Default to Changed
  return 'Changed';
}

/**
 * Generate a changelog entry
 */
function generateEntry(taskId, taskTitle, category, files) {
  // Clean up title
  let entry = taskTitle || 'Update';

  // Remove task ID prefix if present
  entry = entry.replace(/^(TASK-\d+:?\s*)/i, '');

  // Capitalize first letter
  entry = entry.charAt(0).toUpperCase() + entry.slice(1);

  // Add task reference
  if (taskId) {
    entry += ` (${taskId})`;
  }

  return entry;
}

/**
 * Add entry to CHANGELOG.md
 */
function addToChangelog(entry, category) {
  try {
    let content;

    if (fs.existsSync(CHANGELOG_PATH)) {
      content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    } else {
      // Create new changelog
      content = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`;
    }

    // Find or create [Unreleased] section
    const unreleasedMatch = content.match(/## \[Unreleased\]\n/);
    if (!unreleasedMatch) {
      // Add unreleased section after header
      const headerEnd = content.indexOf('\n\n') + 2;
      content = content.slice(0, headerEnd) + '## [Unreleased]\n\n' + content.slice(headerEnd);
    }

    // Find or create category under Unreleased
    const unreleasedIndex = content.indexOf('## [Unreleased]');
    const nextVersionMatch = content.slice(unreleasedIndex + 15).match(/\n## \[/);
    const unreleasedEnd = nextVersionMatch
      ? unreleasedIndex + 15 + nextVersionMatch.index
      : content.length;

    const unreleasedSection = content.slice(unreleasedIndex, unreleasedEnd);

    // Check if category exists
    const categoryRegex = new RegExp(`### ${category}\\n`);
    const categoryMatch = unreleasedSection.match(categoryRegex);

    if (categoryMatch) {
      // Add under existing category
      const categoryIndex = unreleasedIndex + categoryMatch.index + categoryMatch[0].length;
      content = content.slice(0, categoryIndex) + `- ${entry}\n` + content.slice(categoryIndex);
    } else {
      // Add new category section
      const insertIndex = unreleasedIndex + 16; // After "## [Unreleased]\n"
      content = content.slice(0, insertIndex) + `\n### ${category}\n- ${entry}\n` + content.slice(insertIndex);
    }

    fs.writeFileSync(CHANGELOG_PATH, content);
    return { success: true };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { run, getChangelogCategory, generateEntry, addToChangelog };
