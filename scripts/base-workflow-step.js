/**
 * Wogi Flow - BaseWorkflowStep
 *
 * Base class for all flow-step-*.js workflow steps.
 * Provides shared infrastructure: file filtering, context loading,
 * validation, and result formatting.
 *
 * Subclasses override execute() with step-specific logic.
 *
 * Usage:
 *   const { BaseWorkflowStep } = require('./base-workflow-step');
 *
 *   class MyStep extends BaseWorkflowStep {
 *     constructor() {
 *       super('myStep', {
 *         extensions: ['.js', '.ts'],
 *         excludeTests: true,
 *         excludeDts: true,
 *       });
 *     }
 *     async execute(files, options) {
 *       // ... step-specific logic
 *       return this.pass('All checks passed');
 *     }
 *   }
 *
 *   module.exports = { run: (options) => new MyStep().run(options) };
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getTodayDate } = require('./flow-utils');

class BaseWorkflowStep {
  /**
   * @param {string} name - Step identifier
   * @param {object} [filterOpts] - File filtering options
   * @param {string[]} [filterOpts.extensions] - File extensions to include (e.g., ['.js', '.ts'])
   * @param {boolean} [filterOpts.excludeTests=true] - Exclude .test./.spec. files
   * @param {boolean} [filterOpts.excludeDts=true] - Exclude .d.ts files
   */
  constructor(name, filterOpts = {}) {
    this.name = name;
    this.extensions = filterOpts.extensions ?? ['.js', '.ts', '.jsx', '.tsx'];
    this.excludeTests = filterOpts.excludeTests ?? true;
    this.excludeDts = filterOpts.excludeDts ?? true;
  }

  /**
   * Main entry point — matches the `run(options)` interface expected by flow-workflow-steps.js
   * @param {object} options
   * @param {string[]} [options.files] - Files modified
   * @param {object} [options.stepConfig] - Step configuration
   * @param {string} [options.mode] - Step mode (block/warn/prompt/auto)
   * @param {string} [options.taskType] - Task type
   * @param {string} [options.taskId] - Task ID
   * @param {string} [options.taskTitle] - Task title
   * @returns {Promise<{passed: boolean, message: string, details?: any}>}
   */
  async run(options = {}) {
    const { files = [], stepConfig = {}, ...rest } = options;

    // Filter files to those this step cares about
    const filteredFiles = this.filterFiles(files);

    if (filteredFiles.length === 0) {
      return this.pass(`No ${this.name}-eligible files modified`);
    }

    // Delegate to subclass
    return await this.execute(filteredFiles, { stepConfig, ...rest });
  }

  /**
   * Override in subclass — contains the step-specific logic.
   * @param {string[]} files - Filtered files
   * @param {object} options - Remaining options (stepConfig, mode, taskType, etc.)
   * @returns {Promise<{passed: boolean, message: string, details?: any}>}
   */
  async execute(files, options) {
    throw new Error(`${this.name}: execute() must be overridden`);
  }

  /**
   * Filter files based on step's extension and exclusion rules.
   * @param {string[]} files - Raw file list
   * @returns {string[]} Filtered files
   */
  filterFiles(files) {
    return files.filter(f => {
      const hasExt = this.extensions.some(ext => f.endsWith(ext));
      if (!hasExt) return false;
      if (this.excludeTests && (f.includes('.test.') || f.includes('.spec.'))) return false;
      if (this.excludeDts && f.endsWith('.d.ts')) return false;
      return true;
    });
  }

  /**
   * Read a file safely, returning null on error.
   * @param {string} relativePath - Path relative to project root
   * @returns {string|null} File content or null
   */
  readFile(relativePath) {
    const fullPath = path.join(PATHS.root, relativePath);
    try {
      if (!fs.existsSync(fullPath)) return null;
      return fs.readFileSync(fullPath, 'utf8');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Create a passing result.
   * @param {string} message
   * @returns {{passed: true, message: string}}
   */
  pass(message) {
    return { passed: true, message };
  }

  /**
   * Create a failing result.
   * @param {string} message
   * @param {any} [details]
   * @returns {{passed: false, message: string, details?: any}}
   */
  fail(message, details) {
    const result = { passed: false, message };
    if (details !== undefined) result.details = details;
    return result;
  }
}

module.exports = { BaseWorkflowStep };
