'use strict';

/**
 * Wogi Flow — Glob Matcher (wf-2eafdab0 / v2.30.1)
 *
 * Single source of truth for glob → regex conversion across:
 *   - flow-standards-checker.js (forbidden-patterns exemptions)
 *   - flow-feature-dossier.js  (dossier scope matching)
 *   - flow-logic-rules.js      (logic-rule applies-to scope)
 *
 * Replaces 3 separate inline implementations (review finding M4).
 *
 * Semantics (security-patterns.md §4 compliant):
 *   - single-star  matches any chars EXCEPT path separators (uses [^/]*, not .*)
 *   - double-star  matches any chars INCLUDING path separators (uses .*)
 *   - question     matches a single non-separator char ([^/])
 *   - "dir/double-star" ALSO matches "dir" itself (the directory case — review M3)
 *   - "double-star/foo" requires a directory boundary or root — does NOT match
 *     "xfoo" as a substring of another segment (review M3)
 *   - All regex metacharacters in literal portions are escaped.
 *
 * Public API:
 *   - globToRegex(glob) → RegExp (anchored ^...$, throws if input invalid)
 *   - globMatch(filePath, glob) → boolean (false-on-error fail-open)
 */

/** Regex metacharacters that need escaping when they appear as literal chars. */
const REGEX_METACHARS = '.^$+(){}[]|\\';

/**
 * Convert a glob pattern to an anchored regex source string (no flags).
 * Returns the regex source; caller wraps in `new RegExp(src)` if needed.
 *
 * Edge cases (notation: ★ = star — literal asterisk-slash ends JSDoc blocks).
 * "dir/★★" → directory-or-anything-under regex; "★★/foo" → optional-prefix
 * regex that requires a directory boundary; bare "★★" → match-anything regex.
 */
function globToRegexSource(glob) {
  if (typeof glob !== 'string') throw new TypeError('glob must be a string');
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    // Detect `**/` — anchored anywhere or at start
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      // `**/` matches zero-or-more directory segments + separator
      re += '(?:.*/)?';
      i += 3;
    } else if (c === '/' && glob[i + 1] === '*' && glob[i + 2] === '*' && (i + 3 === glob.length || glob[i + 3] === undefined)) {
      // `dir/**` at end: match `/anything` OR nothing (dir itself)
      re += '(?:/.*)?';
      i += 3;
    } else if (c === '*' && glob[i + 1] === '*') {
      // `**` not followed by `/` and not preceded by `/` — bare `**` matches anything
      re += '.*';
      i += 2;
    } else if (c === '*') {
      // single `*` — no path separators
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (REGEX_METACHARS.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return re;
}

/**
 * Compile a glob to a RegExp object. Always anchored.
 * @param {string} glob — pattern string
 * @param {string} [flags=''] — RegExp flags (e.g., 'i' for case-insensitive)
 */
function globToRegex(glob, flags = '') {
  return new RegExp(globToRegexSource(glob), flags);
}

/**
 * Match a file path against a glob. Normalizes Windows-style separators
 * to forward slashes. Returns false on any error (fail-open for callers
 * that don't want to handle exceptions).
 */
function globMatch(filePath, glob) {
  if (typeof filePath !== 'string' || typeof glob !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  try {
    return globToRegex(glob).test(normalized);
  } catch (_err) {
    return false;
  }
}

module.exports = {
  globToRegex,
  globToRegexSource,
  globMatch
};
