'use strict';

/**
 * Wogi Flow — Deletion Log (Fork C, v2.29.5)
 *
 * Warn-only audit trail for AI deletions of user-facing UI files.
 *
 * Why this exists (wogi-hub 2026-04-27 incident, IntegrationConnectionSection.tsx):
 *   FE worker shipped commit 728faf2 "AC2 + dead-code cleanup" deleting an
 *   896-LOC component justified by static-import-graph analysis. The file
 *   contained an active `CommunicationRule` component the owner used. The
 *   owner noticed only ~1 day later, while actively trying to use the
 *   feature. For features used monthly/quarterly, the noticing gap
 *   compounds to weeks/months — by which time the AI session has zero
 *   memory of the deletion, and recovery requires forensics.
 *
 * Rather than block deletions (which would have heavy false-positive cost
 * on legitimate refactors), this module produces an append-only log at
 * `.workflow/state/deletions-log.md` capturing for each deletion:
 *   - Detection shape (rm | git rm | edit-empty | write-empty)
 *   - Original-add commit (SHA, author, date, subject) when discoverable
 *   - File age in days
 *   - LOC of the deleted version
 *   - Top-N user-visible string excerpts (so the owner can grep "did we
 *     ever delete a feature called X?")
 *
 * The log is the artifact. The owner consults it when something feels
 * missing. After 30 days of log accumulation, the actual deletion-rate
 * and shape distribution will be visible — at which point Fork A or B
 * (mechanical-enforcement variants) become design-from-data, not
 * design-from-one-incident.
 *
 * All functions are pure / fail-open. The module never throws.
 *
 * Public surface:
 *   detectDeletionShape({toolName, toolInput, toolResponse}) → {deleted, files, shape} | null
 *   isUiSurfaceFile(filePath, uiGlobs) → boolean
 *   lookupOriginalAdd(filePath, opts) → {sha, date, author, subject, ageDays, originalLOC, userVisibleStrings} | null
 *   formatLogEntry({timestamp, filePath, shape, provenance, sessionId, taskId, currentCommitSubject}) → string
 *   appendLogEntry(workspaceRoot, entry) → boolean
 *   recordDeletion(input) → {logged, files, reason}
 *
 * The recordDeletion orchestrator is what PostToolUse calls. It composes
 * the rest. Returns a structured result for tests; the entry-layer can
 * ignore the result.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_UI_GLOBS = [
  // Page / route / view files in monorepo packages and apps
  /(?:^|\/)(packages|apps)\/[^/]+\/src\/(pages|routes|views|screens)\/.+\.(tsx|jsx|vue|svelte)$/i,
  // Component files in monorepo packages and apps
  /(?:^|\/)(packages|apps)\/[^/]+\/src\/components\/.+\.(tsx|jsx|vue|svelte)$/i,
  // Single-package layout fallbacks
  /(?:^|\/)src\/(pages|routes|views|screens|components)\/.+\.(tsx|jsx|vue|svelte)$/i,
];

const DEFAULT_LOG_PATH = '.workflow/state/deletions-log.md';
const DEFAULT_MIN_LOC = 20; // skip tiny files; noise > signal
const DEFAULT_MAX_USER_VISIBLE_STRINGS = 5;

// JSX/HTML user-visible string heuristic: text nodes between tags, label/title/aria-label props.
// Lower bound at 5 chars to skip "<>", "OK", etc. Upper bound at 80 to skip code-like content.
const USER_VISIBLE_STRING_PATTERNS = [
  />([A-Z][^<>{}\n]{4,80})</g,                       // JSX text content starting with capital
  /(?:label|title|placeholder|aria-label|alt)=["']([^"']{5,80})["']/gi,
];

// Detect Bash `rm` (with optional flags) extracting target paths.
// Conservative: only match when -r/-f/-rf appear or when no flags at all,
// so we don't get false positives on `rm-related` strings.
const RM_COMMAND_PATTERN = /^\s*rm\s+(?:-[rRfFv]+\s+)*([^\s|&;]+(?:\s+[^\s|&;]+)*)\s*$/;
const GIT_RM_PATTERN = /^\s*git\s+rm\s+(?:--cached\s+|-[rfq]+\s+)*([^\s|&;]+(?:\s+[^\s|&;]+)*)\s*$/;

/**
 * Detect whether a tool invocation deleted one or more files, and what
 * shape the deletion took. Returns null when no deletion occurred.
 *
 * Detection rules:
 *   - Bash `rm <files>` — straightforward; ignore flags, take rest as paths
 *   - Bash `git rm <files>` — same
 *   - Edit with new_string='' AND old_string covering full prior content —
 *     conservatively, treat any Edit with new_string='' as a deletion
 *     candidate (post-test confirms what's left)
 *   - Write with content='' — treated as deletion (the prior file's content
 *     is gone, even though the file still exists)
 *
 * Failure responses (non-deletion or ambiguous): returns null.
 *
 * @param {object} ctx
 * @returns {{deleted: true, shape: string, files: string[]} | null}
 */
function detectDeletionShape(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const { toolName, toolInput, toolResponse } = ctx;
  if (!toolName || !toolInput) return null;

  // Skip failed tool invocations — nothing was actually deleted.
  if (toolResponse && (toolResponse.error || toolResponse.isError)) return null;

  if (toolName === 'Bash') {
    const cmd = toolInput.command;
    if (typeof cmd !== 'string' || !cmd.trim()) return null;

    // Reject compound commands (semicolons / pipes) — too many false-positive shapes.
    // Future: parse with a real shell parser if needed.
    if (/[;&|`$()]/.test(cmd)) return null;

    let m = cmd.match(GIT_RM_PATTERN);
    if (m) {
      const files = m[1].split(/\s+/).filter(Boolean);
      return { deleted: true, shape: 'git-rm', files };
    }

    m = cmd.match(RM_COMMAND_PATTERN);
    if (m) {
      const files = m[1].split(/\s+/).filter(Boolean);
      return { deleted: true, shape: 'rm', files };
    }
    return null;
  }

  if (toolName === 'Edit') {
    const { new_string, file_path } = toolInput;
    if (typeof file_path !== 'string') return null;
    // Edit with empty new_string is a deletion candidate — but only counts
    // when the old_string was substantial (else it's a small edit that
    // happens to delete a snippet, not a file removal).
    if (new_string !== '' && new_string !== undefined && new_string !== null) return null;
    const oldStr = toolInput.old_string;
    if (typeof oldStr !== 'string' || oldStr.length < 200) return null;
    return { deleted: true, shape: 'edit-empty', files: [file_path] };
  }

  if (toolName === 'Write') {
    const { content, file_path } = toolInput;
    if (typeof file_path !== 'string') return null;
    if (content === '' || content === undefined || content === null) {
      return { deleted: true, shape: 'write-empty', files: [file_path] };
    }
    return null;
  }

  return null;
}

/**
 * Test a file path against the configured UI-surface glob list.
 * @param {string} filePath
 * @param {Array<RegExp|string>} uiGlobs - default DEFAULT_UI_GLOBS
 * @returns {boolean}
 */
function isUiSurfaceFile(filePath, uiGlobs) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const globs = Array.isArray(uiGlobs) && uiGlobs.length > 0 ? uiGlobs : DEFAULT_UI_GLOBS;
  // Normalize to forward slashes for matching
  const norm = filePath.replace(/\\/g, '/');
  for (const g of globs) {
    if (g instanceof RegExp) {
      if (g.test(norm)) return true;
    } else if (typeof g === 'string') {
      // Convert simple glob string to RegExp: treat ** and * appropriately
      const re = simpleGlobToRegex(g);
      if (re.test(norm)) return true;
    }
  }
  return false;
}

function simpleGlobToRegex(glob) {
  // ** = any path; * = any segment. Other regex chars escaped.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DBLSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DBLSTAR__/g, '.*');
  return new RegExp('^' + escaped + '$', 'i');
}

/**
 * Extract user-visible string candidates from file content. Returns up to
 * `max` unique strings (longest first), useful for owner-grep audit.
 */
function extractUserVisibleStrings(content, max) {
  if (typeof content !== 'string') return [];
  const limit = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_USER_VISIBLE_STRINGS;
  const found = new Set();
  for (const re of USER_VISIBLE_STRING_PATTERNS) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const cloned = new RegExp(re.source, flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      const s = (match[1] || '').trim();
      if (s.length >= 5 && s.length <= 80) found.add(s);
      if (found.size > 50) break; // bound work
    }
  }
  // Return longest-first up to limit
  return Array.from(found).sort((a, b) => b.length - a.length).slice(0, limit);
}

/**
 * Look up the commit that originally added a file via `git log --diff-filter=A --follow`.
 * Returns null when git is unavailable, the file has no add commit (e.g., shallow
 * clone or the file was never under git), or any subprocess error occurs.
 *
 * @param {string} filePath - absolute or repo-relative path
 * @param {object} [opts]
 * @param {string} [opts.workspaceRoot] - cwd for git commands
 * @param {Function} [opts.runGit] - injectable for tests; receives args array, returns string
 * @returns {object|null}
 */
function lookupOriginalAdd(filePath, opts = {}) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const cwd = opts.workspaceRoot || process.cwd();
  const runGit = typeof opts.runGit === 'function'
    ? opts.runGit
    : (args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

  let logOut;
  try {
    // --reverse so the oldest add commit comes first; we take the first line.
    logOut = runGit([
      'log', '--diff-filter=A', '--follow', '--reverse',
      '--format=%H%x09%aI%x09%an%x09%s',
      '--', filePath
    ]);
  } catch (_err) {
    return null;
  }
  if (!logOut || !logOut.trim()) return null;
  const firstLine = logOut.split('\n').find(l => l.trim());
  if (!firstLine) return null;
  const parts = firstLine.split('\t');
  if (parts.length < 4) return null;
  const [sha, dateIso, author, subject] = parts;
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;

  let originalContent = '';
  try {
    originalContent = runGit(['show', `${sha}:${filePath}`]);
  } catch (_err) { /* fail-open */ }

  const originalLOC = originalContent ? originalContent.split('\n').length : null;
  const userVisibleStrings = extractUserVisibleStrings(originalContent, DEFAULT_MAX_USER_VISIBLE_STRINGS);

  let ageDays = null;
  const ts = Date.parse(dateIso);
  if (Number.isFinite(ts)) {
    ageDays = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  }

  return {
    sha: sha.slice(0, 12),
    date: dateIso,
    author,
    subject,
    ageDays,
    originalLOC,
    userVisibleStrings
  };
}

/**
 * Format a single deletion log entry as markdown. Stable shape so the
 * owner can grep / diff over time.
 *
 * @param {object} entry
 * @returns {string}
 */
function formatLogEntry(entry) {
  const ts = entry.timestamp || new Date().toISOString();
  const lines = [];
  lines.push(`## ${ts} — \`${entry.filePath}\``);
  lines.push('');
  lines.push(`- **Shape**: ${entry.shape}`);
  if (entry.taskId) lines.push(`- **Task**: ${entry.taskId}`);
  if (entry.sessionId) lines.push(`- **Session**: ${entry.sessionId.slice(0, 12)}`);
  if (entry.currentCommitSubject) lines.push(`- **Deletion context**: ${entry.currentCommitSubject}`);
  if (entry.provenance) {
    const p = entry.provenance;
    lines.push(`- **Original add**: \`${p.sha}\`${p.date ? ` (${p.date.slice(0, 10)})` : ''}${p.author ? ` by ${p.author}` : ''}`);
    if (p.subject) lines.push(`  - Subject: ${p.subject}`);
    if (Number.isFinite(p.ageDays)) lines.push(`  - Age: ${p.ageDays} days`);
    if (Number.isFinite(p.originalLOC)) lines.push(`  - Lines deleted: ${p.originalLOC}`);
    if (Array.isArray(p.userVisibleStrings) && p.userVisibleStrings.length > 0) {
      lines.push(`  - User-visible strings (top ${p.userVisibleStrings.length}):`);
      for (const s of p.userVisibleStrings) {
        lines.push(`    - "${s.replace(/"/g, '\\"')}"`);
      }
    }
  } else {
    lines.push('- **Original add**: not discoverable (shallow clone, file outside git, or no add commit)');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Append an entry to the deletion log. Creates parent dirs as needed.
 * Returns true on success, false on any I/O error (fail-open).
 */
function appendLogEntry(workspaceRoot, entryText, opts = {}) {
  if (typeof entryText !== 'string' || !entryText) return false;
  const root = workspaceRoot || process.cwd();
  const logPath = path.join(root, opts.logPath || DEFAULT_LOG_PATH);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (!fs.existsSync(logPath)) {
      const header = [
        '# Deletions Log',
        '',
        '> Append-only audit trail for AI deletions of user-facing UI files.',
        '> Emitted by `scripts/hooks/core/deletion-log.js` (PostToolUse hook).',
        '> Owner-grep workflow: did we ever delete a feature called X?',
        '',
        '---',
        ''
      ].join('\n');
      fs.appendFileSync(logPath, header);
    }
    fs.appendFileSync(logPath, entryText);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Top-level orchestrator called from PostToolUse. Detects deletion,
 * filters by glob, looks up provenance, and appends to log. Always
 * returns a structured result; never throws.
 *
 * @param {object} ctx
 * @param {string} ctx.toolName
 * @param {object} ctx.toolInput
 * @param {object} [ctx.toolResponse]
 * @param {string} [ctx.workspaceRoot]
 * @param {string} [ctx.sessionId]
 * @param {string} [ctx.taskId]
 * @param {object} [ctx.config] - hooks.rules.deletionLog block
 * @param {Function} [ctx.runGit] - injectable for tests
 * @returns {{logged: number, skipped: number, reasons: string[], entries: object[]}}
 */
function recordDeletion(ctx) {
  const result = { logged: 0, skipped: 0, reasons: [], entries: [] };
  if (!ctx || typeof ctx !== 'object') {
    result.reasons.push('no-context');
    return result;
  }
  const cfg = ctx.config || {};
  if (cfg.enabled === false) {
    result.reasons.push('disabled');
    return result;
  }

  const detection = detectDeletionShape(ctx);
  if (!detection) {
    result.reasons.push('not-a-deletion');
    return result;
  }

  const uiGlobs = Array.isArray(cfg.uiGlobs) ? cfg.uiGlobs : null;
  const minLOC = Number.isFinite(cfg.minLOC) ? cfg.minLOC : DEFAULT_MIN_LOC;
  const workspaceRoot = ctx.workspaceRoot || process.cwd();

  for (const f of detection.files) {
    if (!isUiSurfaceFile(f, uiGlobs)) {
      result.skipped++;
      result.reasons.push(`glob-miss:${f}`);
      continue;
    }
    let provenance = null;
    try {
      provenance = lookupOriginalAdd(f, { workspaceRoot, runGit: ctx.runGit });
    } catch (_err) { /* fail-open */ }

    if (provenance && Number.isFinite(provenance.originalLOC) && provenance.originalLOC < minLOC) {
      result.skipped++;
      result.reasons.push(`below-min-loc:${f}`);
      continue;
    }

    const entry = {
      timestamp: ctx.timestamp || new Date().toISOString(),
      filePath: f,
      shape: detection.shape,
      provenance,
      sessionId: ctx.sessionId || null,
      taskId: ctx.taskId || null,
      currentCommitSubject: ctx.currentCommitSubject || null
    };

    const text = formatLogEntry(entry);
    const ok = appendLogEntry(workspaceRoot, text, { logPath: cfg.logPath });
    if (ok) {
      result.logged++;
      result.entries.push(entry);
    } else {
      result.skipped++;
      result.reasons.push(`append-failed:${f}`);
    }
  }
  return result;
}

module.exports = {
  // Constants (exposed for tests + integrators)
  DEFAULT_UI_GLOBS,
  DEFAULT_LOG_PATH,
  DEFAULT_MIN_LOC,
  DEFAULT_MAX_USER_VISIBLE_STRINGS,
  USER_VISIBLE_STRING_PATTERNS,
  // Functions
  detectDeletionShape,
  isUiSurfaceFile,
  simpleGlobToRegex,
  extractUserVisibleStrings,
  lookupOriginalAdd,
  formatLogEntry,
  appendLogEntry,
  recordDeletion
};
