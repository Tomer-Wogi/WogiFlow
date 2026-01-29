#!/usr/bin/env node

/**
 * Wogi Flow Shared Utilities
 *
 * Common utility functions used across lib modules.
 * Extracted to reduce duplication and standardize behavior.
 *
 * @module lib/utils
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// Constants
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 10000; // 10 seconds
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Find the project root by looking for .workflow directory
 * @returns {string|null} Project root path or null if not in a project
 */
function findProjectRoot() {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.workflow'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Safely parse JSON content with prototype pollution protection
 *
 * Note: For parsing JSON files, use safeJsonParseFile from flow-file-ops.js
 * or safeReadJson from this module instead.
 *
 * @param {string} content - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {Object} Parsed object or default value
 */
function safeJsonParseContent(content, defaultValue = null) {
  try {
    // Check for prototype pollution attempts in raw content
    // Covers various quote styles and whitespace variants
    if (/__proto__|constructor\s*["'`:]|prototype\s*["'`:]/i.test(content)) {
      console.warn('[safeJsonParse] Suspicious content detected');
      return defaultValue;
    }

    const parsed = JSON.parse(content);

    // Validate it's an object (not primitive)
    if (typeof parsed !== 'object' || parsed === null) {
      return parsed; // Allow primitives to pass through
    }

    // Additional check: ensure no proto/constructor keys were added
    const keys = Object.getOwnPropertyNames(parsed);
    if (keys.includes('__proto__') || keys.includes('constructor') || keys.includes('prototype')) {
      console.warn('[safeJsonParse] Prototype pollution attempt detected');
      return defaultValue;
    }

    return parsed;
  } catch (_err) {
    return defaultValue;
  }
}

/**
 * Safely read and parse JSON file
 * SECURITY: Uses try/catch instead of existsSync to avoid TOCTOU race condition
 * @param {string} filePath - Path to JSON file
 * @param {*} defaultValue - Default value if reading/parsing fails
 * @returns {Object} Parsed object or default value
 */
function safeReadJson(filePath, defaultValue = null) {
  try {
    // Read directly without existsSync check - avoids TOCTOU vulnerability
    // where file could be deleted between check and read
    const content = fs.readFileSync(filePath, 'utf8');
    return safeJsonParseContent(content, defaultValue);
  } catch (_err) {
    // ENOENT (file not found) is expected for optional files
    // Other errors still return defaultValue for resilience
    return defaultValue;
  }
}

/**
 * Make an HTTPS GET request with safety limits
 * @param {string} url - URL to fetch
 * @param {Object} options - Options
 * @param {number} options.timeout - Request timeout in ms
 * @param {number} options.maxRedirects - Maximum redirects to follow
 * @param {number} options.redirectCount - Current redirect count (internal)
 * @returns {Promise<string>} Response body
 */
function httpsGet(url, options = {}) {
  const timeout = options.timeout || REQUEST_TIMEOUT;
  const maxRedirects = options.maxRedirects || MAX_REDIRECTS;
  const redirectCount = options.redirectCount || 0;

  return new Promise((resolve, reject) => {
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:') {
        reject(new Error('Only HTTPS URLs are allowed'));
        return;
      }
    } catch (_err) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const req = https.get(url, { timeout }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (redirectCount >= maxRedirects) {
          reject(new Error('Too many redirects'));
          return;
        }

        const location = res.headers.location;
        if (!location) {
          reject(new Error('Redirect without location header'));
          return;
        }

        // Validate redirect URL (same-origin or absolute HTTPS)
        let redirectUrl;
        try {
          redirectUrl = new URL(location, url);
          if (redirectUrl.protocol !== 'https:') {
            reject(new Error('Redirect to non-HTTPS URL not allowed'));
            return;
          }
        } catch (_err) {
          reject(new Error(`Invalid redirect URL: ${location}`));
          return;
        }

        return httpsGet(redirectUrl.href, {
          ...options,
          redirectCount: redirectCount + 1
        }).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      let size = 0;

      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_SIZE) {
          req.destroy();
          reject(new Error('Response too large'));
          return;
        }
        data += chunk;
      });

      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', reject);
  });
}

/**
 * Copy directory recursively with optional dry-run
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function copyDir(src, dest, dryRun = false) {
  if (!fs.existsSync(src)) return;

  if (dryRun) {
    console.log(`  Would copy: ${src} -> ${dest}`);
    return;
  }

  try {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        copyDir(srcPath, destPath, dryRun);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch (err) {
    console.error(`  Error copying ${src}: ${err.message}`);
  }
}

/**
 * Parse CLI arguments with bounds checking
 * @param {string[]} args - Command line arguments
 * @param {Object} spec - Argument specification { flags: { '--flag': 'key' }, withValue: ['--flag'] }
 * @returns {Object} Parsed options
 */
function parseArgs(args, spec = {}) {
  const options = {};
  const flags = spec.flags || {};
  const withValue = new Set(spec.withValue || []);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (flags[arg]) {
      const key = flags[arg];
      if (withValue.has(arg)) {
        // Bounds check before accessing next argument
        if (i + 1 >= args.length) {
          console.error(`Error: ${arg} requires a value`);
          options._error = true;
          continue;
        }
        options[key] = args[++i];
      } else {
        options[key] = true;
      }
    } else if (!arg.startsWith('-')) {
      // Positional argument
      if (!options._positional) options._positional = [];
      options._positional.push(arg);
    }
  }

  return options;
}

/**
 * Validate a path is within a base directory (prevents path traversal)
 * @param {string} basePath - Base directory path
 * @param {string} targetPath - Target path to validate
 * @returns {string|null} Resolved path if valid, null if traversal detected
 */
function validatePath(basePath, targetPath) {
  const resolved = path.resolve(basePath, targetPath);
  const normalizedBase = path.resolve(basePath);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    return null;
  }

  return resolved;
}

/**
 * Safely write file with path validation
 * @param {string} basePath - Base directory (file must be within this)
 * @param {string} relativePath - Relative path within base
 * @param {string} content - File content
 * @returns {boolean} True if written successfully
 */
function safeWriteFile(basePath, relativePath, content) {
  // Validate path to prevent traversal
  const safePath = validatePath(basePath, relativePath);
  if (!safePath) {
    console.error(`Error: Invalid path '${relativePath}' (path traversal detected)`);
    return false;
  }

  try {
    // Ensure parent directory exists
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(safePath, content);
    return true;
  } catch (err) {
    console.error(`Error writing file: ${err.message}`);
    return false;
  }
}

module.exports = {
  findProjectRoot,
  safeJsonParseContent,
  safeJsonParse: safeJsonParseContent,  // Backward-compatible alias (deprecated)
  safeReadJson,
  httpsGet,
  copyDir,
  parseArgs,
  validatePath,
  safeWriteFile,

  // Constants
  MAX_REDIRECTS,
  REQUEST_TIMEOUT,
  MAX_RESPONSE_SIZE
};
