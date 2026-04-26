/**
 * Wogi Flow - File I/O Operations
 *
 * Extracted from flow-utils.js for modularity.
 * Contains all file I/O operations, locking, and JSON handling.
 *
 * Usage:
 *   const { readJson, writeJson, fileExists, acquireLock } = require('./flow-io');
 */

const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('./flow-paths');

// ============================================================
// Constants - Named values for magic numbers
// ============================================================

/**
 * Canonical DANGEROUS_KEYS — prototype-pollution guard constant used by
 * JSON parse safety checks, plugin-name validation, frontmatter parsers.
 * Consolidated 2026-04-15 per audit dup-002 (wf-2f6fbb12). All scripts/
 * consumers should import from here; lib/ has its own local copy to avoid
 * lib→scripts dependency per dual-repo-management.md.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Default lock stale threshold (60 seconds) */
const LOCK_STALE_THRESHOLD_MS = 60000;

/** Cleanup lock stale threshold (30 seconds) */
const CLEANUP_LOCK_STALE_MS = 30000;

/** Default retry delay for lock acquisition (100ms) */
const LOCK_RETRY_DELAY_MS = 100;

/** Default max retries for lock acquisition */
const LOCK_MAX_RETRIES = 5;

// ============================================================
// File Existence Checks
// ============================================================

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
}

/**
 * Check if a directory exists
 */
function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_err) {
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
// Dangerous Keys Check (Prototype Pollution Protection)
// ============================================================

/**
 * Recursively check for dangerous keys in nested objects
 * @param {Object} obj - Object to scan
 * @param {string} path - Current path for error reporting
 * @returns {string|null} - Error message if dangerous key found, null otherwise
 */
function checkForDangerousKeys(obj, keyPath = '') {
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (dangerousKeys.includes(key)) {
      return `Dangerous key "${key}" at path: ${keyPath}${key}`;
    }
    const value = obj[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        // Recurse into array elements
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object') {
            const nestedError = checkForDangerousKeys(value[i], `${keyPath}${key}[${i}].`);
            if (nestedError) return nestedError;
          }
        }
      } else {
        const nestedError = checkForDangerousKeys(value, `${keyPath}${key}.`);
        if (nestedError) return nestedError;
      }
    }
  }
  return null;
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
    const parsed = JSON.parse(content);

    // Prototype pollution protection for object results
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const dangerousKeyError = checkForDangerousKeys(parsed);
      if (dangerousKeyError) {
        if (process.env.DEBUG) {
          console.error(`[readJson] Prototype pollution attempt in ${filePath}: ${dangerousKeyError}`);
        }
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`Dangerous keys in ${filePath}: ${dangerousKeyError}`);
      }
    }

    return parsed;
  } catch (err) {
    // Check for undefined to allow falsy defaults like false, 0, ''
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read JSON from ${filePath}: ${err.message}`, { cause: err });
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
    const content = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);  // Atomic rename
    return true;
  } catch (err) {
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch (_err) { /* ignore */ }
    throw new Error(`Failed to write JSON to ${filePath}: ${err.message}`, { cause: err });
  }
}

/**
 * Safely parse JSON with prototype pollution protection
 * Use this for user-modifiable files (registry, stats, etc.)
 * @param {string} filePath - Path to JSON file
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {object|null} Parsed JSON or defaultValue on error
 */
function safeJsonParse(filePath, defaultValue = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // NOTE: We no longer check raw content with regex because it causes false positives
    // when "__proto__" appears in string values (e.g., {"desc": "__proto__ is dangerous"})
    // The recursive checkForDangerousKeys() on the parsed object is the proper defense

    const parsed = JSON.parse(content);

    // Validate it's a plain object (not array, null, or primitive)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;
      const relPath = path.relative(PROJECT_ROOT, filePath) || filePath;
      console.error(`[safeJsonParse] Invalid JSON structure in ${relPath} (expected object, got ${actualType})`);
      return defaultValue;
    }

    // Recursive check for prototype pollution in nested objects and arrays
    const dangerousKeyError = checkForDangerousKeys(parsed);
    if (dangerousKeyError) {
      const relPath = path.relative(PROJECT_ROOT, filePath) || filePath;
      console.error(`[safeJsonParse] Prototype pollution attempt in ${relPath}: ${dangerousKeyError}`);
      return defaultValue;
    }

    return parsed;
  } catch (err) {
    // Only log errors for actual parse failures, not missing files
    // ENOENT is expected for optional files - caller handles with defaultValue
    if (err.code !== 'ENOENT') {
      const relPath = path.relative(PROJECT_ROOT, filePath) || filePath;
      console.error(`[safeJsonParse] Failed to parse ${relPath}: ${err.message}`);
    }
    return defaultValue;
  }
}

/**
 * Safely parse a JSON string with prototype pollution protection.
 * Use this when you already have the JSON content as a string.
 * Note: Unlike safeJsonParse (file-based), this allows arrays through
 * since it validates typeof === 'object' which is true for arrays.
 * @param {string} jsonString - JSON string to parse
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {object|Array|null} Parsed JSON (object or array) or defaultValue on error
 */
function safeJsonParseString(jsonString, defaultValue = null) {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate it's an object or array (not primitive for config files)
    if (typeof parsed !== 'object' || parsed === null) {
      return defaultValue;
    }

    // Recursive check for prototype pollution in nested objects and arrays
    const dangerousKeyError = checkForDangerousKeys(parsed);
    if (dangerousKeyError) {
      if (process.env.DEBUG) {
        console.error(`[safeJsonParseString] Prototype pollution attempt: ${dangerousKeyError}`);
      }
      return defaultValue;
    }

    return parsed;
  } catch (_err) {
    return defaultValue;
  }
}

/**
 * Recursively strip prototype-pollution keys from a parsed object/array.
 * Mutates in place; returns the same reference. Use when the caller wants
 * to filter dangerous content rather than reject the whole payload.
 *
 * Sibling to checkForDangerousKeys (which DETECTS without modifying). This
 * is the strip variant used by lib/* JSON parsers that want to keep
 * structurally-valid content but defang any __proto__/constructor/prototype
 * keys nested anywhere in the tree.
 */
// Sentinel returned when stripDangerousKeys hits the depth cap. Distinct from
// `null` (legitimate JSON value) so callers can distinguish "hit the cap" from
// "successfully scrubbed null".
const STRIP_TOO_DEEP = Object.freeze({ __wogiTooDeep: true });

const STRIP_MAX_DEPTH = 256;

function stripDangerousKeys(value, depth = 0) {
  // SEC-001 fix (2026-04-26): bound recursion AND fail-safe at the cap.
  // Previous impl returned the partially-stripped value, which left dangerous
  // keys live in subtrees past depth 32 — caller could then merge them and
  // pollute Object.prototype. New behavior: return STRIP_TOO_DEEP sentinel so
  // safeJsonParseStringStrip can fall back to defaultValue. Cap raised from
  // 32 → 256 so legitimate nesting never trips it.
  if (depth > STRIP_MAX_DEPTH) return STRIP_TOO_DEEP;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = stripDangerousKeys(value[i], depth + 1);
      if (r === STRIP_TOO_DEEP) return STRIP_TOO_DEEP;
    }
    return value;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete value[key];
      continue;
    }
    const r = stripDangerousKeys(value[key], depth + 1);
    if (r === STRIP_TOO_DEEP) return STRIP_TOO_DEEP;
  }
  return value;
}

/**
 * Parse a JSON string and STRIP any prototype-pollution keys recursively.
 * Returns the sanitized parsed object (or defaultValue on parse error).
 *
 * Differs from safeJsonParseString: that function REJECTS the whole payload
 * if dangerous keys are present (returns defaultValue). This function
 * returns the parsed object with dangerous keys removed. Pick based on
 * threat model:
 *   - reject (safeJsonParseString)  — fail-loud, refuse hostile content
 *   - strip (safeJsonParseStringStrip) — fail-soft, sanitize and proceed
 *
 * Added as part of audit dup-004 consolidation (2026-04-26): unifies the
 * lib/utils.safeJsonParseContent / lib/workspace.safeParseJson /
 * lib/commands/team-connection.safeParseJson trio under a single canonical
 * helper. Preserves the lib/* "strip and proceed" semantic.
 *
 * @param {string} jsonString
 * @param {*} [defaultValue=null]
 * @returns {object|Array|*} sanitized parsed value, or defaultValue
 */
function safeJsonParseStringStrip(jsonString, defaultValue = null) {
  try {
    const parsed = JSON.parse(jsonString);
    if (typeof parsed !== 'object' || parsed === null) return defaultValue;
    const stripped = stripDangerousKeys(parsed);
    if (stripped === STRIP_TOO_DEEP) return defaultValue;
    return stripped;
  } catch (_err) {
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
    // Check for undefined to allow falsy defaults like false, 0, ''
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read file ${filePath}: ${err.message}`, { cause: err });
  }
}

/**
 * Write text file using atomic write pattern
 * (writes to temp file, then renames for crash safety)
 */
function writeFile(filePath, content) {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);  // Atomic rename
    return true;
  } catch (err) {
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch (_err) { /* ignore */ }
    throw new Error(`Failed to write file ${filePath}: ${err.message}`, { cause: err });
  }
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
  } catch (_err) {
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
  } catch (_err) {
    return [];
  }
}

/**
 * Count files recursively with depth limit and symlink protection
 */
function countFiles(dirPath, extensions = [], maxDepth = 10) {
  let count = 0;
  const visited = new Set(); // Prevent infinite loops from symlinks

  function walk(dir, depth) {
    if (depth <= 0) return; // Depth limit reached

    try {
      // Resolve real path to detect symlink cycles
      const realPath = fs.realpathSync(dir);
      if (visited.has(realPath)) return; // Already visited (symlink cycle)
      visited.add(realPath);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip node_modules and hidden directories for performance
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
      // Ignore permission errors, log others in debug mode
      if (process.env.DEBUG) console.error(`[DEBUG] countFiles: ${err.message}`);
    }
  }

  if (dirExists(dirPath)) {
    walk(dirPath, maxDepth);
  }

  return count;
}

// ============================================================
// JSON Output Helpers (for --json flag support)
// ============================================================

/**
 * Output data as JSON and exit
 * Use this in scripts that support --json flag
 *
 * @param {Object} data - Data to output
 * @param {Object} [options] - Options
 * @param {boolean} [options.exitOnOutput=true] - Exit after output
 * @param {number} [options.exitCode=0] - Exit code
 */
function outputJson(data, options = {}) {
  const { exitOnOutput = true, exitCode = 0 } = options;

  const output = {
    success: data.success !== false,
    timestamp: new Date().toISOString(),
    ...data
  };

  console.log(JSON.stringify(output, null, 2));

  if (exitOnOutput) {
    process.exit(exitCode);
  }
}

// ============================================================
// File Locking (for parallel execution safety)
// ============================================================

/**
 * Simple file locking without external dependencies.
 * Uses mkdir (atomic on most filesystems) for lock acquisition.
 *
 * @param {string} filePath - File to lock
 * @param {Object} options - Lock options
 * @param {number} [options.retries=5] - Number of retry attempts
 * @param {number} [options.retryDelay=100] - Delay between retries (ms)
 * @param {number} [options.staleMs=30000] - Consider lock stale after this many ms
 * @returns {Promise<Function>} Release function
 */
async function acquireLock(filePath, options = {}) {
  const {
    retries = LOCK_MAX_RETRIES,
    retryDelay = LOCK_RETRY_DELAY_MS,
    staleMs = LOCK_STALE_THRESHOLD_MS,
    exponentialBackoff = false
  } = options;

  const lockDir = `${filePath}.lock`;
  const lockInfoFile = path.join(lockDir, 'info.json');
  let staleCleanupAttempts = 0;
  const maxStaleCleanupAttempts = 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // mkdir is atomic - will fail if directory already exists
      fs.mkdirSync(lockDir, { recursive: false });

      // Write lock info for stale detection
      fs.writeFileSync(lockInfoFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        file: filePath
      }));

      // Return release function with robust cleanup
      return () => {
        // Try to remove info file first
        try {
          fs.unlinkSync(lockInfoFile);
        } catch (err) {
          // ENOENT is fine - file already gone
          // Other errors we log but continue to try rmdir
          if (err.code !== 'ENOENT' && process.env.DEBUG) {
            console.warn(`[DEBUG] Lock info cleanup warning: ${err.message}`);
          }
        }

        // Always try to remove lock directory
        try {
          fs.rmdirSync(lockDir);
        } catch (err) {
          // ENOENT is fine - directory already gone
          if (err.code !== 'ENOENT') {
            // Directory not empty or other error - force cleanup
            try {
              fs.rmSync(lockDir, { recursive: true, force: true });
            } catch (_err) {
              // Last resort failed - log if debug
              if (process.env.DEBUG) {
                console.warn(`[DEBUG] Lock dir cleanup failed: ${err.message}`);
              }
            }
          }
        }
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists - check if stale
        let isStale = false;
        let lockAge = 0;

        try {
          const info = readJson(lockInfoFile, null);
          if (info && typeof info.timestamp === 'number') {
            lockAge = Date.now() - info.timestamp;
            isStale = lockAge > staleMs;
          } else {
            isStale = attempt >= 2;
          }
        } catch (_err) {
          // Can't read lock info - assume stale if we've waited long enough
          isStale = attempt >= 2;
        }

        if (isStale) {
          staleCleanupAttempts++;
          if (staleCleanupAttempts > maxStaleCleanupAttempts) {
            throw new Error(`Failed to clean up stale lock for ${filePath} after ${maxStaleCleanupAttempts} attempts`);
          }

          if (process.env.DEBUG) {
            console.warn(`[DEBUG] Removing stale lock (${lockAge}ms old) for ${filePath} (cleanup attempt ${staleCleanupAttempts})`);
          }

          try {
            fs.unlinkSync(lockInfoFile);
            fs.rmdirSync(lockDir);
          } catch (err) {
            // Cleanup failed - wait before retrying
            if (process.env.DEBUG) {
              console.warn(`[DEBUG] Stale lock cleanup failed: ${err.message}`);
            }
            await require('node:timers/promises').setTimeout(retryDelay);
          }
          // Try again
          continue;
        }

        if (attempt < retries) {
          // Wait and retry
          const delay = exponentialBackoff
            ? retryDelay * Math.pow(2, attempt)
            : retryDelay * (attempt + 1);
          await require('node:timers/promises').setTimeout(delay);
          continue;
        }
      }

      throw new Error(`Failed to acquire lock for ${filePath}: ${err.message}`, { cause: err });
    }
  }

  throw new Error(`Failed to acquire lock for ${filePath} after ${retries} retries`);
}

/**
 * Execute a function while holding a lock on a file
 *
 * @param {string} filePath - File to lock
 * @param {Function} fn - Async function to execute
 * @param {Object} [options] - Lock options
 * @returns {Promise<*>} Result of fn
 */
async function withLock(filePath, fn, options = {}) {
  const release = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Synchronous version of withLock for simpler use cases
 * Note: Still uses async for lock acquisition, but fn is sync
 */
async function withLockSync(filePath, fn, options = {}) {
  const release = await acquireLock(filePath, options);
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Clean up any stale locks in a directory
 * Useful for cleanup after crashes
 *
 * @param {string} dirPath - Directory to scan for .lock directories
 * @param {number} [staleMs=30000] - Consider locks older than this as stale
 * @returns {number} Number of locks cleaned up
 */
function cleanupStaleLocks(dirPath, staleMs = CLEANUP_LOCK_STALE_MS) {
  try {
    if (!dirExists(dirPath)) return 0;

    let cleaned = 0;
    const entries = fs.readdirSync(dirPath);

    for (const entry of entries) {
      if (!entry.endsWith('.lock')) continue;

      const lockDir = path.join(dirPath, entry);
      const lockInfoFile = path.join(lockDir, 'info.json');

      try {
        const info = readJson(lockInfoFile, null);
        const age = info && typeof info.timestamp === 'number' ? Date.now() - info.timestamp : Infinity;

        if (age > staleMs) {
          // Clean up stale lock
          try {
            fs.unlinkSync(lockInfoFile);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              if (process.env.DEBUG) {
                console.warn(`[DEBUG] cleanupStaleLocks: Could not delete ${lockInfoFile}: ${err.message}`);
              }
            }
          }

          try {
            fs.rmdirSync(lockDir);
            cleaned++;
          } catch (err) {
            if (err.code !== 'ENOENT') {
              // Directory not empty or other error - force cleanup
              try {
                fs.rmSync(lockDir, { recursive: true, force: true });
                cleaned++;
              } catch (err) {
                if (process.env.DEBUG) {
                  console.warn(`[DEBUG] cleanupStaleLocks: Could not force delete ${lockDir}: ${err.message}`);
                }
              }
            }
          }
        }
      } catch (err) {
        // Can't read lock info - try to remove based on directory mtime
        if (err.code === 'ENOENT') continue; // Lock already gone

        try {
          const stat = fs.statSync(lockDir);
          const age = Date.now() - stat.mtimeMs;
          if (age > staleMs) {
            fs.rmSync(lockDir, { recursive: true, force: true });
            cleaned++;
          }
        } catch (err) {
          // Directory gone or inaccessible - skip
          if (err.code !== 'ENOENT' && process.env.DEBUG) {
            console.warn(`[DEBUG] cleanupStaleLocks: Could not stat ${lockDir}: ${err.message}`);
          }
        }
      }
    }

    return cleaned;
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn(`[DEBUG] cleanupStaleLocks: Could not scan ${dirPath}: ${err.message}`);
    }
    return 0;
  }
}

// ============================================================
// String Sanitization (for AI context injection)
// ============================================================

/**
 * Sanitize a string value before injecting into AI context.
 * Strips markdown heading markers and truncates to prevent prompt manipulation.
 *
 * @param {string} value - Raw string from state files
 * @param {number} [maxLen=200] - Maximum length
 * @returns {string} Sanitized string
 */
function sanitizeForContext(value, maxLen = 200) {
  return String(value).replace(/^#+\s/gm, '').slice(0, maxLen);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  DANGEROUS_KEYS,
  LOCK_STALE_THRESHOLD_MS,
  CLEANUP_LOCK_STALE_MS,
  LOCK_RETRY_DELAY_MS,
  LOCK_MAX_RETRIES,

  // File Existence
  fileExists,
  dirExists,
  ensureDir,

  // Dangerous Keys
  checkForDangerousKeys,

  // JSON Operations
  readJson,
  writeJson,
  safeJsonParse,
  safeJsonParseString,
  safeJsonParseStringStrip,
  stripDangerousKeys,

  // Text File Operations
  readFile,
  writeFile,
  validateJson,

  // Directory Operations
  listDirs,
  listFiles,
  countFiles,

  // JSON Output
  outputJson,

  // File Locking
  acquireLock,
  withLock,
  withLockSync,
  cleanupStaleLocks,

  // String Sanitization
  sanitizeForContext,
};
