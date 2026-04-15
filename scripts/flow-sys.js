#!/usr/bin/env node

/**
 * Wogi Flow - System-Level Helpers
 *
 * CLI tool detection (fd, semver compare) + git repo utilities + app-map
 * state-file operations. Extracted from flow-utils.js (wf-94cc3b72 epic
 * — flow-utils decomposition).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');
const { PATHS, PROJECT_ROOT } = require('./flow-paths');
const { readFile, writeFile } = require('./flow-io');
const { warn, error } = require('./flow-output');

// ============================================================
// CLI Tool Detection (Claude Code 2.1.72+ compatibility)
// ============================================================

/**
 * Compare a parsed semver against a required minimum.
 * @param {number} major - Parsed major
 * @param {number} minor - Parsed minor
 * @param {number} patch - Parsed patch
 * @param {number} rMajor - Required major
 * @param {number} rMinor - Required minor
 * @param {number} rPatch - Required patch
 * @returns {boolean}
 */
function meetsVersion(major, minor, patch, rMajor, rMinor, rPatch) {
  return major > rMajor ||
    (major === rMajor && minor > rMinor) ||
    (major === rMajor && minor === rMinor && patch >= rPatch);
}

/**
 * Detect if fd or fdfind is available on the system.
 * fd/fdfind is auto-approved in Claude Code 2.1.72+ bash allowlist,
 * making it a better choice than find for reduced permission prompts.
 *
 * Result is memoized for the process lifetime.
 * @returns {string|false} The fd command name ('fd' or 'fdfind'), or false
 */
let _fdCommand = null;
function getFdCommand() {
  if (_fdCommand !== null) return _fdCommand;
  for (const cmd of ['fd', 'fdfind']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 3000 });
      _fdCommand = cmd;
      return cmd;
    } catch (_err) {
      // Not available
    }
  }
  _fdCommand = false;
  return false;
}

// ============================================================
// Git Operations
// ============================================================

/**
 * Check if current directory is a git repo.
 * Note: .git can be a directory (normal repo) or file (worktree).
 */
function isGitRepo() {
  const gitPath = path.join(PROJECT_ROOT, '.git');
  return fs.existsSync(gitPath);
}

/**
 * Get git status info.
 * @returns {{ isRepo: boolean, branch?: string, uncommitted?: number, clean?: boolean, error?: string }}
 */
function getGitStatus() {
  if (!isGitRepo()) {
    return { isRepo: false };
  }

  try {
    const branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const uncommitted = status.split('\n').filter(Boolean).length;

    return {
      isRepo: true,
      branch,
      uncommitted,
      clean: uncommitted === 0
    };
  } catch (err) {
    return { isRepo: true, error: err.message };
  }
}

// ============================================================
// App Map Operations
// ============================================================

/**
 * Count components in app-map.md (data rows only — excludes headers).
 * @returns {number}
 */
function countAppMapComponents() {
  try {
    const content = readFile(PATHS.appMap, '');
    const dataRows = content.match(/^\|[^-|][^|]*\|/gm);
    const headerCount = (content.match(/^## /gm) || []).length * 1;
    return dataRows ? Math.max(0, dataRows.length - headerCount) : 0;
  } catch (_err) {
    return 0;
  }
}

/**
 * Add a component row to app-map.md in the appropriate section.
 * @param {Object} component
 * @param {string} component.name
 * @param {string} component.type - 'screen' | 'modal' | 'component' | 'layout'
 * @param {string} component.path
 * @param {string[]} [component.variants]
 * @param {string} [component.description]
 * @returns {boolean}
 */
function addAppMapComponent(component) {
  const { name, type, path: filePath, variants = [], description = '' } = component;

  try {
    let content = readFile(PATHS.appMap, '');

    const sectionMap = {
      screen: '## Screens',
      modal: '## Modals',
      component: '## Components',
      layout: '## Layouts'
    };

    const section = sectionMap[type] || '## Components';
    const variantsStr = variants.length > 0 ? variants.join(', ') : '-';
    const descStr = description || '-';

    const newRow = `| ${name} | ${filePath} | ${variantsStr} | ${descStr} |`;

    const sectionIndex = content.indexOf(section);
    if (sectionIndex === -1) {
      warn(`Section "${section}" not found in app-map.md`);
      return false;
    }

    const nextSectionMatch = content.substring(sectionIndex + section.length).match(/\n## /);
    const endIndex = nextSectionMatch
      ? sectionIndex + section.length + nextSectionMatch.index
      : content.length;

    const sectionContent = content.substring(sectionIndex, endIndex);
    const lastPipeIndex = sectionContent.lastIndexOf('\n|');

    if (lastPipeIndex !== -1) {
      const afterPipe = sectionContent.substring(lastPipeIndex);
      const newlineOffset = afterPipe.indexOf('\n', 1);
      const insertOffset = newlineOffset !== -1 ? newlineOffset : afterPipe.length;
      const insertIndex = sectionIndex + lastPipeIndex + insertOffset;
      content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
    } else {
      const headerEnd = sectionContent.indexOf('\n\n');
      if (headerEnd !== -1) {
        const insertIndex = sectionIndex + headerEnd;
        content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
      } else {
        warn(`Could not find proper insertion point in section "${section}"`);
        return false;
      }
    }

    writeFile(PATHS.appMap, content);
    return true;
  } catch (err) {
    error(`Failed to add component to app-map: ${err.message}`);
    return false;
  }
}

module.exports = {
  meetsVersion,
  getFdCommand,
  isGitRepo,
  getGitStatus,
  countAppMapComponents,
  addAppMapComponent,
};
