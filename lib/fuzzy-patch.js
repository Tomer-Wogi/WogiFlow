'use strict';

/**
 * Wogi Flow — Fuzzy Find-Replace Patching
 *
 * Applies a `find → replace` edit to a source string, tolerating benign
 * whitespace drift (CRLF↔LF, trailing whitespace, extra blank lines) without
 * tolerating semantic drift (reordered lines, changed tokens). Used by F1
 * `flow skill patch` when the agent stages a find/replace pair.
 *
 * Strategy:
 *   1. Exact match → confidence 1.0, replace in place.
 *   2. Normalized-haystack ↔ normalized-needle exact match → locate original
 *      bounds in the raw haystack, replace, confidence 1.0 (whitespace drift).
 *   3. Sliding-window Levenshtein similarity over normalized text.
 *      Best window score ≥ threshold → replace that window; otherwise reject.
 *
 * The similarity metric is 1 − levenshtein(a,b) / max(len(a), len(b)), so
 * reordered lines (many single-char moves) score far below 0.85 and are
 * rejected as "semantic drift, not whitespace drift".
 */

const DEFAULT_THRESHOLD = 0.85;

/**
 * Normalize text for similarity comparison:
 *  - CRLF → LF
 *  - Strip trailing whitespace per line
 *  - Collapse runs of spaces/tabs inside a line to a single space
 *  - Trim leading/trailing blank lines
 */
function normalize(text) {
  if (typeof text !== 'string') return '';
  const unix = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = unix.split('\n').map((ln) => ln.replace(/[ \t]+/g, ' ').replace(/\s+$/, ''));
  // Trim leading / trailing blank lines but preserve interior blanks.
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end).join('\n');
}

/**
 * Levenshtein distance with O(min(a,b)) memory (two-row DP).
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Ensure a is the shorter string to cap memory.
  if (a.length > b.length) { const t = a; a = b; b = t; }

  const aLen = a.length;
  const bLen = b.length;
  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);
  for (let i = 0; i <= aLen; i++) prev[i] = i;

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    const bc = b.charCodeAt(j - 1);
    for (let i = 1; i <= aLen; i++) {
      const cost = a.charCodeAt(i - 1) === bc ? 0 : 1;
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      curr[i] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[aLen];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Find the bounds in `rawHaystack` whose normalized form equals `normalizedNeedle`.
 * Walks candidate slices, expanding around each line boundary.
 * Returns { start, end } indices in rawHaystack, or null if not found.
 */
function findNormalizedMatch(rawHaystack, normalizedNeedle) {
  const unix = rawHaystack.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Compute line offsets (each entry = start index of that line in `unix`).
  const lineStarts = [0];
  for (let i = 0; i < unix.length; i++) {
    if (unix.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  lineStarts.push(unix.length + 1); // sentinel

  const needleLineCount = normalizedNeedle.split('\n').length;
  // Try windows of size [needleLineCount-1 .. needleLineCount+1] lines.
  for (let size = Math.max(1, needleLineCount - 1); size <= needleLineCount + 1; size++) {
    for (let s = 0; s + size < lineStarts.length; s++) {
      const startIdx = lineStarts[s];
      // end = start of line s+size, minus the trailing newline (if any).
      let endIdx = lineStarts[s + size] - 1;
      if (endIdx < startIdx) endIdx = startIdx;
      const slice = unix.slice(startIdx, endIdx);
      if (normalize(slice) === normalizedNeedle) {
        // Map back to rawHaystack offsets. Since we only replaced CRLF/CR with
        // LF (same character count for CR→LF; CRLF→LF drops one), we need to
        // translate `unix` offsets back to `rawHaystack` offsets.
        const rawStart = translateUnixToRaw(rawHaystack, startIdx);
        const rawEnd = translateUnixToRaw(rawHaystack, endIdx);
        return { start: rawStart, end: rawEnd };
      }
    }
  }
  return null;
}

/**
 * Translate an offset in the LF-normalized version of `raw` back to an offset
 * in `raw` itself. Handles CRLF and bare CR.
 */
function translateUnixToRaw(raw, unixOffset) {
  let rawI = 0;
  let unixI = 0;
  while (unixI < unixOffset && rawI < raw.length) {
    const c = raw.charCodeAt(rawI);
    if (c === 13 /* \r */) {
      // CR or CRLF — consumes 1 or 2 raw chars for 1 unix LF.
      if (rawI + 1 < raw.length && raw.charCodeAt(rawI + 1) === 10) {
        rawI += 2;
      } else {
        rawI += 1;
      }
      unixI += 1;
    } else {
      rawI += 1;
      unixI += 1;
    }
  }
  return rawI;
}

/**
 * Slide windows of approximately `|needle|` chars across `haystack`, computing
 * normalized similarity. Returns the best { start, end, confidence } or null.
 *
 * For performance, we step by 1 char but only compute Levenshtein on windows
 * of length within ±20% of the needle length (after normalization is cheap).
 */
function bestFuzzyWindow(rawHaystack, normalizedNeedle) {
  const needleLen = normalizedNeedle.length;
  if (needleLen === 0 || rawHaystack.length === 0) return null;

  const minLen = Math.max(1, Math.floor(needleLen * 0.8));
  const maxLen = Math.ceil(needleLen * 1.2);

  let best = { start: 0, end: 0, confidence: 0 };

  // Step size scales with haystack size to keep this O(n * |needle|).
  // For small files (skills <10KB), step=1 is fine.
  const step = rawHaystack.length > 20000 ? Math.max(1, Math.floor(needleLen / 4)) : 1;

  for (let start = 0; start <= rawHaystack.length - minLen; start += step) {
    for (let len = minLen; len <= maxLen && start + len <= rawHaystack.length; len += Math.max(1, Math.floor(len / 8))) {
      const windowRaw = rawHaystack.slice(start, start + len);
      const windowNorm = normalize(windowRaw);
      if (!windowNorm) continue;
      const sim = similarity(windowNorm, normalizedNeedle);
      if (sim > best.confidence) {
        best = { start, end: start + len, confidence: sim };
      }
    }
  }

  return best.confidence > 0 ? best : null;
}

/**
 * Apply a fuzzy patch. Returns:
 *   { applied: true,  result: string, confidence: number, mode: 'exact'|'normalized'|'fuzzy' }
 *   { applied: false, confidence: number, reason: string }
 *
 * Never throws on bad matches — rejection is signaled via applied=false.
 * Throws only on invalid arguments.
 */
function applyFuzzyPatch(haystack, find, replace, options = {}) {
  if (typeof haystack !== 'string') throw new Error('haystack must be a string');
  if (typeof find !== 'string') throw new Error('find must be a string');
  if (typeof replace !== 'string') throw new Error('replace must be a string');
  const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_THRESHOLD;
  if (threshold < 0 || threshold > 1) throw new Error('threshold must be between 0 and 1');
  if (find === '') throw new Error('find must not be empty');

  // Tier 1: exact match.
  const exactIdx = haystack.indexOf(find);
  if (exactIdx !== -1) {
    return {
      applied: true,
      result: haystack.slice(0, exactIdx) + replace + haystack.slice(exactIdx + find.length),
      confidence: 1.0,
      mode: 'exact',
    };
  }

  const normalizedNeedle = normalize(find);
  if (!normalizedNeedle) {
    return { applied: false, confidence: 0, reason: 'find reduces to empty after normalization' };
  }

  // Tier 2: whitespace-drift match (normalized equality).
  const bounds = findNormalizedMatch(haystack, normalizedNeedle);
  if (bounds) {
    return {
      applied: true,
      result: haystack.slice(0, bounds.start) + replace + haystack.slice(bounds.end),
      confidence: 1.0,
      mode: 'normalized',
    };
  }

  // Tier 3: fuzzy sliding window.
  const win = bestFuzzyWindow(haystack, normalizedNeedle);
  const confidence = win ? win.confidence : 0;
  if (!win || confidence < threshold) {
    return {
      applied: false,
      confidence,
      reason: `best match confidence ${confidence.toFixed(3)} below threshold ${threshold}`,
    };
  }

  return {
    applied: true,
    result: haystack.slice(0, win.start) + replace + haystack.slice(win.end),
    confidence,
    mode: 'fuzzy',
  };
}

module.exports = {
  applyFuzzyPatch,
  DEFAULT_THRESHOLD,
  // Exposed for targeted tests.
  _internal: {
    normalize,
    levenshtein,
    similarity,
    findNormalizedMatch,
    bestFuzzyWindow,
    translateUnixToRaw,
  },
};
