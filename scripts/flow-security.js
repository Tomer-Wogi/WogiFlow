#!/usr/bin/env node

/**
 * Wogi Flow - Security Utilities
 *
 * Shared security functions for safe command execution and path validation.
 * Part of Phase 1: Critical Security Fixes (wf-9bcb4fa8)
 *
 * Functions:
 * - validatePathWithinProject: Prevent path traversal attacks
 * - safeExecFile: Execute commands safely without shell injection
 * - safeGitCommand: Execute git commands with validated arguments
 * - escapeRegex: Escape regex special characters for safe patterns
 * - validateGitRef: Validate git branch/tag names
 * - validateRepoFormat: Validate GitHub repository format
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// Constants
// ============================================================

/** Maximum length for regex patterns to prevent ReDoS */
const MAX_REGEX_LENGTH = 100;

/** Allowed characters in git branch names (per git-check-ref-format) */
const GIT_REF_PATTERN = /^[a-zA-Z0-9_\-./]+$/;

/** GitHub repository format: owner/repo */
const GITHUB_REPO_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

/** Valid file extensions for code search */
const VALID_CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

// ============================================================
// Path Validation
// ============================================================

/**
 * Validate that a path is within the project root directory.
 * Prevents path traversal attacks using ../ or absolute paths.
 *
 * @param {string} filePath - Path to validate
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} True if path is safely within project root
 */
function validatePathWithinProject(filePath, projectRoot) {
  if (!filePath || !projectRoot) {
    return false;
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(projectRoot, filePath);

  // Get real path if it exists (resolves symlinks)
  let realPath = resolvedPath;
  try {
    if (fs.existsSync(resolvedPath)) {
      realPath = fs.realpathSync(resolvedPath);
    }
  } catch (err) {
    // If realpathSync fails, continue with resolved path
    if (process.env.DEBUG) console.warn(`[Security] realpathSync failed for ${resolvedPath}: ${err.message}`);
  }

  // Get real project root (resolves symlinks)
  let realProjectRoot = projectRoot;
  try {
    realProjectRoot = fs.realpathSync(projectRoot);
  } catch (err) {
    // If realpathSync fails, continue with original
    if (process.env.DEBUG) console.warn(`[Security] realpathSync failed for projectRoot: ${err.message}`);
  }

  // Ensure path starts with project root + separator
  // The separator check prevents /project/foo matching /project-other/foo
  return realPath === realProjectRoot ||
         realPath.startsWith(realProjectRoot + path.sep);
}

/**
 * Sanitize a path for safe use in file operations.
 * Returns null if path is invalid or traverses outside project.
 *
 * @param {string} filePath - Path to sanitize
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} Sanitized absolute path or null if invalid
 */
function sanitizePath(filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }

  // Resolve path relative to project root
  const resolved = path.resolve(projectRoot, filePath);

  // Validate it's within project
  if (!validatePathWithinProject(resolved, projectRoot)) {
    return null;
  }

  return resolved;
}

// ============================================================
// Safe Command Execution
// ============================================================

/**
 * Execute a command safely using execFileSync (no shell).
 * Prevents command injection by passing arguments as an array.
 *
 * @param {string} command - Command to execute (e.g., 'git', 'grep')
 * @param {string[]} args - Array of command arguments
 * @param {Object} [options] - execFileSync options
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.timeout] - Timeout in milliseconds
 * @param {string} [options.encoding] - Output encoding (default: 'utf-8')
 * @returns {string} Command output
 * @throws {Error} If command fails
 */
function safeExecFile(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    timeout = 30000,
    encoding = 'utf-8',
    ...rest
  } = options;

  return execFileSync(command, args, {
    cwd,
    timeout,
    encoding,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...rest
  });
}

/**
 * Execute a command safely using spawnSync (no shell).
 * Useful for commands that need more control over output handling.
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Array of command arguments
 * @param {Object} [options] - spawnSync options
 * @returns {Object} spawnSync result { status, stdout, stderr, error }
 */
function safeSpawn(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    timeout = 30000,
    encoding = 'utf-8',
    ...rest
  } = options;

  return spawnSync(command, args, {
    cwd,
    timeout,
    encoding,
    ...rest
  });
}

// ============================================================
// Git Command Safety
// ============================================================

/**
 * Validate a git reference name (branch, tag, commit).
 * Based on git-check-ref-format rules.
 *
 * @param {string} ref - Git reference to validate
 * @returns {boolean} True if valid git reference
 */
function validateGitRef(ref) {
  if (!ref || typeof ref !== 'string') {
    return false;
  }

  // Length check
  if (ref.length === 0 || ref.length > 255) {
    return false;
  }

  // Cannot start or end with dot, cannot contain ..
  if (ref.startsWith('.') || ref.endsWith('.') || ref.includes('..')) {
    return false;
  }

  // Cannot contain certain characters
  if (ref.includes(' ') || ref.includes('~') || ref.includes('^') ||
      ref.includes(':') || ref.includes('?') || ref.includes('*') ||
      ref.includes('[') || ref.includes('\\') || ref.includes('@{')) {
    return false;
  }

  // Must match allowed pattern
  return GIT_REF_PATTERN.test(ref);
}

/**
 * Execute a git command with validated arguments.
 * Prevents injection through git arguments.
 *
 * @param {string[]} args - Git subcommand and arguments as array
 * @param {Object} [options] - Execution options
 * @param {string} [options.cwd] - Working directory
 * @param {boolean} [options.silent] - Suppress errors
 * @returns {string|null} Command output or null if failed with silent=true
 */
function safeGitCommand(args, options = {}) {
  const { cwd = process.cwd(), silent = false, timeout = 30000 } = options;

  try {
    const result = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (err) {
    if (!silent) {
      throw new Error(`Git command failed: git ${args.join(' ')}\n${err.stderr || err.message}`);
    }
    return null;
  }
}

// ============================================================
// Safe Grep/Search
// ============================================================

/**
 * Escape special regex characters for use in patterns.
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for regex
 */
function escapeRegex(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate and sanitize a search pattern.
 * Escapes special characters and limits length.
 *
 * @param {string} pattern - Search pattern
 * @param {Object} [options]
 * @param {number} [options.maxLength] - Maximum pattern length
 * @param {boolean} [options.escape] - Whether to escape regex chars
 * @returns {string|null} Sanitized pattern or null if invalid
 */
function sanitizeSearchPattern(pattern, options = {}) {
  const {
    maxLength = MAX_REGEX_LENGTH,
    escape = true
  } = options;

  if (!pattern || typeof pattern !== 'string') {
    return null;
  }

  // Limit length to prevent ReDoS
  if (pattern.length > maxLength) {
    return null;
  }

  // Optionally escape regex special characters
  return escape ? escapeRegex(pattern) : pattern;
}

/**
 * Execute grep safely using execFileSync.
 * Escapes pattern to prevent regex injection.
 *
 * @param {string} pattern - Search pattern (will be escaped)
 * @param {Object} options
 * @param {string} options.cwd - Working directory
 * @param {string} options.searchDir - Directory to search in
 * @param {string[]} [options.extensions] - File extensions to include
 * @param {number} [options.maxResults] - Maximum results to return
 * @returns {string[]} Array of matching file paths
 */
function safeGrep(pattern, options = {}) {
  const {
    cwd,
    searchDir,
    extensions = VALID_CODE_EXTENSIONS,
    maxResults = 20
  } = options;

  // Validate and escape pattern
  const safePattern = sanitizeSearchPattern(pattern);
  if (!safePattern) {
    return [];
  }

  // Build include arguments
  const includeArgs = extensions.flatMap(ext => ['--include', `*${ext}`]);

  try {
    const args = [
      '-ril',           // recursive, ignore case, files only
      safePattern,      // escaped pattern
      ...includeArgs,   // file extensions
      searchDir         // search directory
    ];

    const output = safeExecFile('grep', args, {
      cwd,
      timeout: 5000
    });

    return output
      .split('\n')
      .filter(Boolean)
      .slice(0, maxResults);
  } catch (err) {
    // grep returns non-zero when no matches found - this is expected
    if (process.env.DEBUG && err.status !== 1) {
      console.warn(`[Security] safeGrep failed: ${err.message}`);
    }
    return [];
  }
}

/**
 * Execute find safely using execFileSync.
 *
 * @param {string} dir - Directory to search
 * @param {Object} options
 * @param {string[]} [options.extensions] - File extensions to find
 * @param {number} [options.maxResults] - Maximum results
 * @param {string} [options.cwd] - Working directory
 * @returns {string[]} Array of found file paths
 */
function safeFind(dir, options = {}) {
  const {
    extensions = VALID_CODE_EXTENSIONS,
    maxResults = 100,
    cwd = process.cwd()
  } = options;

  // Build name expressions for extensions
  const nameArgs = [];
  extensions.forEach((ext, i) => {
    if (i > 0) nameArgs.push('-o');
    nameArgs.push('-name', `*${ext}`);
  });

  try {
    const args = [
      dir,
      '-type', 'f',
      '(', ...nameArgs, ')'
    ];

    const output = safeExecFile('find', args, { cwd, timeout: 10000 });

    return output
      .split('\n')
      .filter(Boolean)
      .slice(0, maxResults);
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn(`[Security] safeFind failed: ${err.message}`);
    }
    return [];
  }
}

// ============================================================
// GitHub/Repository Validation
// ============================================================

/**
 * Validate GitHub repository format (owner/repo).
 *
 * @param {string} repo - Repository string to validate
 * @returns {boolean} True if valid format
 */
function validateRepoFormat(repo) {
  if (!repo || typeof repo !== 'string') {
    return false;
  }
  return GITHUB_REPO_PATTERN.test(repo);
}

/**
 * Sanitize a commit message for safe use in git commands.
 * Escapes special characters that could cause issues.
 *
 * @param {string} message - Commit message to sanitize
 * @returns {string} Sanitized message
 */
function sanitizeCommitMessage(message) {
  if (!message || typeof message !== 'string') {
    return '';
  }
  // Only allow basic text characters, newlines, and common punctuation
  return message
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
    .substring(0, 5000); // Limit length
}

// ============================================================
// URL Validation
// ============================================================

/**
 * Check if an IP address is private/internal.
 * Used for SSRF protection.
 *
 * @param {string} ip - IP address to check
 * @returns {boolean} True if private/internal IP
 */
function isPrivateIP(ip) {
  if (!ip) return false;

  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every(p => !isNaN(p))) {
    // Loopback
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Link-local
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  // Localhost
  if (ip === 'localhost' || ip === '::1') return true;

  return false;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Path validation
  validatePathWithinProject,
  sanitizePath,

  // Command execution
  safeExecFile,
  safeSpawn,

  // Git safety
  validateGitRef,
  safeGitCommand,
  sanitizeCommitMessage,

  // Search safety
  escapeRegex,
  sanitizeSearchPattern,
  safeGrep,
  safeFind,

  // Repository validation
  validateRepoFormat,

  // URL/Network safety
  isPrivateIP,

  // Constants
  MAX_REGEX_LENGTH,
  VALID_CODE_EXTENSIONS
};
