#!/usr/bin/env node

/**
 * Wogi Flow - File Operations
 *
 * Safe file operations with atomic writes and error handling.
 * Extracted from flow-utils.js for better modularity.
 *
 * Usage:
 *   const { readJson, writeJson, fileExists, dirExists } = require('./flow-file-ops');
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// File Existence Checks
// ============================================================

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists (create recursively if needed)
 */
function ensureDir(dirPath) {
  if (!dirExists(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================
// JSON File Operations
// ============================================================

/**
 * Read JSON file safely
 * @param {string} filePath - Path to JSON file
 * @param {*} [defaultValue=undefined] - Default value if file doesn't exist or is invalid
 * @returns {*} Parsed JSON or defaultValue
 * @throws {Error} If file cannot be read and no defaultValue provided
 */
function readJson(filePath, defaultValue = undefined) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read JSON from ${filePath}: ${err.message}`);
  }
}

/**
 * Write JSON file with pretty formatting using atomic write pattern
 * (writes to temp file, then renames for crash safety)
 * @param {string} filePath - Path to JSON file
 * @param {*} data - Data to serialize as JSON
 * @returns {boolean} True on success
 * @throws {Error} If file cannot be written
 */
function writeJson(filePath, data) {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    ensureDir(path.dirname(filePath));
    const content = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw new Error(`Failed to write JSON to ${filePath}: ${err.message}`);
  }
}

/**
 * Safely read and parse JSON file with prototype pollution protection
 * Use this for user-modifiable files (registry, stats, etc.)
 *
 * Note: For parsing raw JSON content (not files), use safeJsonParseContent
 * from lib/utils.js instead.
 *
 * @param {string} filePath - Path to JSON file
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {object|null} Parsed JSON or defaultValue on error
 */
function safeJsonParseFile(filePath, defaultValue = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for prototype pollution attempts
    if (/__proto__|constructor\s*["'`:]|prototype\s*["'`:]/i.test(content)) {
      console.error(`[safeJsonParseFile] Suspicious content detected in ${filePath}`);
      return defaultValue;
    }

    const parsed = JSON.parse(content);

    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`[safeJsonParseFile] Invalid JSON structure in ${filePath} (expected object)`);
      return defaultValue;
    }

    const keys = Object.getOwnPropertyNames(parsed);
    if (keys.includes('__proto__') || keys.includes('constructor') || keys.includes('prototype')) {
      console.error(`[safeJsonParseFile] Prototype pollution attempt detected in ${filePath}`);
      return defaultValue;
    }

    return parsed;
  } catch (err) {
    console.error(`[safeJsonParseFile] Failed to parse ${filePath}: ${err.message}`);
    return defaultValue;
  }
}

// ============================================================
// Text File Operations
// ============================================================

/**
 * Read text file safely
 * @param {string} filePath - Path to text file
 * @param {*} [defaultValue=undefined] - Default value if file doesn't exist
 * @returns {string|*} File contents or defaultValue
 * @throws {Error} If file cannot be read and no defaultValue provided
 */
function readFile(filePath, defaultValue = undefined) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read file ${filePath}: ${err.message}`);
  }
}

/**
 * Write text file using atomic write pattern
 */
function writeFile(filePath, content) {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw new Error(`Failed to write file ${filePath}: ${err.message}`);
  }
}

// ============================================================
// Path Validation
// ============================================================

/**
 * Check if a path is within a base directory (prevents path traversal)
 * @param {string} targetPath - Path to validate
 * @param {string} baseDir - Base directory to check against
 * @returns {boolean} True if path is within base directory
 */
function isPathWithinDir(targetPath, baseDir) {
  const resolved = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
}

/**
 * Validate JSON file syntax
 */
function validateJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ============================================================
// Directory Operations
// ============================================================

/**
 * List directories in a path
 */
function listDirs(dirPath) {
  try {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(name => {
        const fullPath = path.join(dirPath, name);
        return fs.statSync(fullPath).isDirectory();
      });
  } catch {
    return [];
  }
}

/**
 * List files matching a pattern in a directory
 */
function listFiles(dirPath, extension = null) {
  try {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(name => {
        const fullPath = path.join(dirPath, name);
        if (!fs.statSync(fullPath).isFile()) return false;
        if (extension && !name.endsWith(extension)) return false;
        return true;
      });
  } catch {
    return [];
  }
}

/**
 * Count files recursively with depth limit and symlink protection
 */
function countFiles(dirPath, extensions = [], maxDepth = 10) {
  let count = 0;
  const visited = new Set();

  function walk(dir, depth) {
    if (depth <= 0) return;

    try {
      const realPath = fs.realpathSync(dir);
      if (visited.has(realPath)) return;
      visited.add(realPath);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          walk(fullPath, depth - 1);
        } else if (entry.isFile()) {
          if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
            count++;
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] countFiles: ${err.message}`);
    }
  }

  if (dirExists(dirPath)) {
    walk(dirPath, maxDepth);
  }

  return count;
}

module.exports = {
  // Existence checks
  fileExists,
  dirExists,
  ensureDir,

  // JSON operations
  readJson,
  writeJson,
  safeJsonParseFile,
  safeJsonParse: safeJsonParseFile,  // Backward-compatible alias (deprecated)
  validateJson,

  // Text operations
  readFile,
  writeFile,

  // Path validation
  isPathWithinDir,
  isPathWithinProject: isPathWithinDir,  // Alias for documentation consistency

  // Directory operations
  listDirs,
  listFiles,
  countFiles,
};
