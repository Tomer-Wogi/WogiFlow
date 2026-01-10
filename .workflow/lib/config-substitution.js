/**
 * Wogi Flow - Config Substitution
 *
 * Enables dynamic values in config files using substitution patterns:
 * - {env:VAR_NAME} - Environment variable substitution
 * - {file:path/to/file} - File content substitution
 *
 * Features:
 * - Tilde expansion (~/.secrets → /home/user/.secrets)
 * - Nested object/array processing
 * - Graceful handling of missing values
 * - Warning logging for unresolved placeholders
 *
 * Usage:
 *   const { substituteConfig } = require('./.workflow/lib/config-substitution');
 *   const resolvedConfig = substituteConfig(rawConfig);
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// Patterns
// ============================================================

/**
 * Substitution patterns
 */
const PATTERNS = {
  env: /\{env:([^}]+)\}/g,   // {env:VAR_NAME}
  file: /\{file:([^}]+)\}/g  // {file:path/to/file}
};

/**
 * Check if a value contains substitution patterns
 * @param {string} value - Value to check
 * @returns {boolean}
 */
function hasSubstitutionPattern(value) {
  if (typeof value !== 'string') return false;
  return PATTERNS.env.test(value) || PATTERNS.file.test(value);
}

// ============================================================
// Path Utilities
// ============================================================

/**
 * Expand tilde (~) to user's home directory
 * @param {string} filePath - Path that may contain ~
 * @returns {string} Expanded path
 */
function expandTilde(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath;

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath === '~') {
    return os.homedir();
  }
  return filePath;
}

/**
 * Resolve a file path (handles tilde and relative paths)
 * @param {string} filePath - Path to resolve
 * @param {string} basePath - Base path for relative paths
 * @returns {string} Resolved absolute path
 */
function resolvePath(filePath, basePath = process.cwd()) {
  const expanded = expandTilde(filePath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(basePath, expanded);
}

// ============================================================
// Substitution Functions
// ============================================================

/**
 * Substitute environment variable pattern
 * @param {string} value - String containing {env:VAR} patterns
 * @param {Object} options - Options
 * @returns {Object} Result with value and warnings
 */
function substituteEnvVars(value, options = {}) {
  const { logWarnings = true } = options;
  const warnings = [];

  // Reset regex lastIndex
  PATTERNS.env.lastIndex = 0;

  const result = value.replace(PATTERNS.env, (match, varName) => {
    const envValue = process.env[varName];

    if (envValue !== undefined) {
      return envValue;
    }

    // Env var not set - keep placeholder and warn
    if (logWarnings) {
      warnings.push({
        type: 'env',
        pattern: match,
        variable: varName,
        message: `Environment variable '${varName}' is not set`
      });
    }
    return match; // Keep original placeholder
  });

  return { value: result, warnings };
}

/**
 * Substitute file content pattern
 * @param {string} value - String containing {file:path} patterns
 * @param {Object} options - Options
 * @returns {Object} Result with value and warnings
 */
function substituteFileContents(value, options = {}) {
  const { logWarnings = true, basePath = process.cwd() } = options;
  const warnings = [];

  // Reset regex lastIndex
  PATTERNS.file.lastIndex = 0;

  const result = value.replace(PATTERNS.file, (match, filePath) => {
    const resolvedPath = resolvePath(filePath.trim(), basePath);

    try {
      if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        return content.trim(); // Trim whitespace from file contents
      }

      // File doesn't exist - keep placeholder and warn
      if (logWarnings) {
        warnings.push({
          type: 'file',
          pattern: match,
          path: filePath,
          resolvedPath,
          message: `File not found: ${resolvedPath}`
        });
      }
      return match; // Keep original placeholder
    } catch (err) {
      if (logWarnings) {
        warnings.push({
          type: 'file',
          pattern: match,
          path: filePath,
          resolvedPath,
          message: `Error reading file: ${err.message}`
        });
      }
      return match;
    }
  });

  return { value: result, warnings };
}

/**
 * Substitute all patterns in a string value
 * @param {string} value - String to process
 * @param {Object} options - Options
 * @returns {Object} Result with value and warnings
 */
function substituteString(value, options = {}) {
  if (typeof value !== 'string') {
    return { value, warnings: [] };
  }

  const allWarnings = [];

  // First pass: environment variables
  let result = value;
  const envResult = substituteEnvVars(result, options);
  result = envResult.value;
  allWarnings.push(...envResult.warnings);

  // Second pass: file contents
  const fileResult = substituteFileContents(result, options);
  result = fileResult.value;
  allWarnings.push(...fileResult.warnings);

  return { value: result, warnings: allWarnings };
}

// ============================================================
// Deep Substitution
// ============================================================

/**
 * Recursively substitute patterns in an object/array
 * @param {*} obj - Object, array, or value to process
 * @param {Object} options - Options
 * @param {string} path - Current path in object (for debugging)
 * @returns {Object} Result with value and warnings
 */
function substituteDeep(obj, options = {}, currentPath = '') {
  const allWarnings = [];

  if (obj === null || obj === undefined) {
    return { value: obj, warnings: [] };
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const result = obj.map((item, index) => {
      const itemResult = substituteDeep(item, options, `${currentPath}[${index}]`);
      allWarnings.push(...itemResult.warnings.map(w => ({
        ...w,
        path: `${currentPath}[${index}]`
      })));
      return itemResult.value;
    });
    return { value: result, warnings: allWarnings };
  }

  // Handle objects
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key;
      const itemResult = substituteDeep(value, options, keyPath);
      allWarnings.push(...itemResult.warnings.map(w => ({
        ...w,
        path: keyPath
      })));
      result[key] = itemResult.value;
    }
    return { value: result, warnings: allWarnings };
  }

  // Handle strings
  if (typeof obj === 'string') {
    const strResult = substituteString(obj, options);
    return {
      value: strResult.value,
      warnings: strResult.warnings.map(w => ({
        ...w,
        path: currentPath
      }))
    };
  }

  // Other primitives - return as-is
  return { value: obj, warnings: [] };
}

// ============================================================
// Main API
// ============================================================

/**
 * Substitute all patterns in a config object
 * @param {Object} config - Config object to process
 * @param {Object} options - Options
 * @param {boolean} options.logWarnings - Whether to log warnings (default: true)
 * @param {boolean} options.printWarnings - Whether to print warnings to console (default: false)
 * @param {string} options.basePath - Base path for relative file paths
 * @returns {Object} Result with value and warnings array
 */
function substituteConfig(config, options = {}) {
  const { printWarnings = false, logWarnings = true, basePath } = options;

  const result = substituteDeep(config, { logWarnings, basePath });

  // Print warnings to console if requested
  if (printWarnings && result.warnings.length > 0) {
    console.warn('\n⚠️  Config substitution warnings:');
    for (const warning of result.warnings) {
      const pathInfo = warning.path ? ` at '${warning.path}'` : '';
      console.warn(`   - ${warning.message}${pathInfo}`);
    }
    console.warn('');
  }

  return result;
}

/**
 * Check if a config has unresolved substitution patterns
 * @param {Object} config - Config object to check
 * @returns {Object} Result with hasUnresolved boolean and patterns array
 */
function checkUnresolvedPatterns(config) {
  const configStr = JSON.stringify(config);
  const unresolvedEnv = [];
  const unresolvedFile = [];

  // Check for env patterns
  PATTERNS.env.lastIndex = 0;
  let match;
  while ((match = PATTERNS.env.exec(configStr)) !== null) {
    unresolvedEnv.push({ pattern: match[0], variable: match[1] });
  }

  // Check for file patterns
  PATTERNS.file.lastIndex = 0;
  while ((match = PATTERNS.file.exec(configStr)) !== null) {
    unresolvedFile.push({ pattern: match[0], path: match[1] });
  }

  return {
    hasUnresolved: unresolvedEnv.length > 0 || unresolvedFile.length > 0,
    env: unresolvedEnv,
    file: unresolvedFile
  };
}

/**
 * Get a list of all substitution patterns used in a config
 * @param {Object} config - Config object to scan
 * @returns {Object} Object with env and file pattern lists
 */
function getUsedPatterns(config) {
  const configStr = JSON.stringify(config);
  const envPatterns = new Set();
  const filePatterns = new Set();

  // Find env patterns
  PATTERNS.env.lastIndex = 0;
  let match;
  while ((match = PATTERNS.env.exec(configStr)) !== null) {
    envPatterns.add(match[1]);
  }

  // Find file patterns
  PATTERNS.file.lastIndex = 0;
  while ((match = PATTERNS.file.exec(configStr)) !== null) {
    filePatterns.add(match[1]);
  }

  return {
    env: Array.from(envPatterns),
    file: Array.from(filePatterns)
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Main API
  substituteConfig,
  checkUnresolvedPatterns,
  getUsedPatterns,

  // Lower-level functions
  substituteString,
  substituteEnvVars,
  substituteFileContents,
  substituteDeep,

  // Utilities
  expandTilde,
  resolvePath,
  hasSubstitutionPattern,

  // Constants
  PATTERNS
};
