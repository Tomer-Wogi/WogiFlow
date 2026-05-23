#!/usr/bin/env node

/**
 * Skill Portability Checker (Phase 1B — wf-0342fc33)
 *
 * Determines whether a skill is portable to the broader Claude Code / agentskills.io
 * ecosystem. A "portable" skill MUST NOT reference WogiFlow-specific paths, state files,
 * imports, or slash-command invocations — because those won't exist outside this project.
 *
 * Fail-loud: every blocker is cited with `path:line`. Callers MUST refuse export when
 * `portable === false`.
 *
 * Usage:
 *   const { assessSkillPortability } = require('./skill-portability');
 *   const result = assessSkillPortability('/path/to/.claude/skills/commit');
 *   // result = { portable: true, blockers: [], manifest: {...}, scannedFiles: [...] }
 *
 * @module lib/skill-portability
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Blocker patterns
// ---------------------------------------------------------------------------
// Each entry: { pattern: RegExp, label: string }
//
// The pattern is matched line-by-line against every text file under the skill
// directory. If any line matches any pattern, the skill is non-portable.
//
// NOTE on scoping: we deliberately use *substring* matches on canonical WogiFlow
// path strings rather than language-level imports, because skill content is
// mostly Markdown. A reference like ".workflow/state/ready.json" in a how-to
// guide is just as project-locking as a literal `require('./scripts/flow-utils')`.

const BLOCKER_PATTERNS = [
  // State-file references
  { pattern: /\.workflow\//, label: 'wogiflow-state-path (.workflow/)' },
  { pattern: /\bwogiflow-cloud\b/, label: 'wogiflow-cloud reference' },
  { pattern: /\bready\.json\b/, label: 'ready.json reference' },
  { pattern: /\bfeedback-patterns\.md\b/, label: 'feedback-patterns.md reference' },
  { pattern: /\bdecisions\.md\b/, label: 'decisions.md reference' },
  { pattern: /\bapp-map\.md\b/, label: 'app-map.md reference' },
  { pattern: /\bfunction-map\.md\b/, label: 'function-map.md reference' },
  { pattern: /\bapi-map\.md\b/, label: 'api-map.md reference' },
  // Imports / requires of WogiFlow modules
  { pattern: /\bflow-utils\b/, label: 'flow-utils import/reference' },
  { pattern: /require\(['"][^'"]*\/scripts\/flow[-/]/, label: 'WogiFlow scripts/ require()' },
  { pattern: /from\s+['"][^'"]*\/scripts\/flow[-/]/, label: 'WogiFlow scripts/ import' },
  // Slash-command invocations (any /wogi-* with a word char after).
  // F7 (R-379): require a lookbehind for start-of-line, whitespace, or
  // quote/bracket — so legitimate file paths like
  // `.claude/skills/wogi-start/skill.md` or `/workflows/wogi-status` don't
  // trip a false-positive blocker. Lookbehind (not capturing group) so the
  // matched substring is the slash-command itself, e.g. `/wogi-finalize`.
  { pattern: /(?<=^|[\s`'"(\[])\/wogi-[a-z][a-z0-9-]*\b/im, label: '/wogi-* slash command' },
  // Shell invocations of the local flow CLI
  { pattern: /\.\/scripts\/flow\b/, label: 'local ./scripts/flow CLI call' },
  { pattern: /\bflow\s+(?:wogi-|skill\s+|story\s+|start\s+|status\b|ready\b|finalize\b)/, label: 'flow CLI subcommand specific to WogiFlow' },
];

// File extensions we scan for blockers.
const SCAN_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.js', '.ts', '.sh']);

// Max file size to scan (defense against accidentally enormous fixtures).
const MAX_SCAN_BYTES = 1 * 1024 * 1024; // 1 MiB

// Max files to scan (defense against deeply nested fixture trees).
const MAX_SCAN_FILES = 200;

// ---------------------------------------------------------------------------
// Frontmatter parser (kept local — same shape as flow-skill-freshness.js)
// ---------------------------------------------------------------------------

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse YAML frontmatter from a skill.md file. Handles colons in values
 * by splitting on the first colon only. Blocks prototype pollution keys.
 *
 * @param {string} content - File content
 * @returns {Object} Parsed frontmatter key-value pairs (empty object on miss)
 */
function parseFrontmatter(content) {
  if (typeof content !== 'string') return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    // Skip list-item lines (we don't parse arrays here — caller pulls those via dedicated logic)
    if (line.startsWith('- ')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key || DANGEROUS_KEYS.has(key)) continue;
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

/**
 * Walk a directory and return absolute paths of files we should scan.
 * Skips hidden dirs (except the skill root itself), node_modules, large files.
 *
 * @param {string} rootDir - Absolute path to skill directory
 * @returns {string[]} Absolute file paths, capped at MAX_SCAN_FILES
 */
function listScanFiles(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0 && out.length < MAX_SCAN_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_err) {
        continue;
      }
      if (stat.size > MAX_SCAN_BYTES) continue;
      out.push(full);
      if (out.length >= MAX_SCAN_FILES) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core: assessSkillPortability
// ---------------------------------------------------------------------------

/**
 * Assess whether a skill directory is portable to non-WogiFlow consumers.
 *
 * Algorithm:
 *   1. Validate the directory exists and has a `skill.md` (or SKILL.md).
 *   2. Parse the skill.md frontmatter (used by exporters for manifest fields).
 *   3. Walk the directory, scanning every text-y file line by line.
 *   4. For each line, test all BLOCKER_PATTERNS; collect citations.
 *   5. portable = blockers.length === 0.
 *
 * If the frontmatter declares `portable: false` explicitly, that wins even
 * when the content scan finds nothing — the skill author is signaling an
 * implicit-dependency the scanner can't detect (e.g., relies on a project
 * convention that isn't a literal path string).
 *
 * If the frontmatter declares `portable: true` but the scanner finds blockers,
 * the scanner wins — fail-loud is the priority.
 *
 * @param {string} skillDir - Absolute path to skill directory
 * @param {Object} [opts]
 * @param {RegExp[]} [opts.extraPatterns] - Additional blocker patterns
 * @returns {{portable: boolean, blockers: Array<{file: string, line: number, match: string, label: string}>, manifest: Object, scannedFiles: string[], skillMdPath: string|null}}
 */
function assessSkillPortability(skillDir, opts = {}) {
  if (typeof skillDir !== 'string' || !skillDir) {
    return {
      portable: false,
      blockers: [{ file: '<input>', line: 0, match: '', label: 'invalid skill directory (empty path)' }],
      manifest: {},
      scannedFiles: [],
      skillMdPath: null,
    };
  }

  let stat;
  try {
    stat = fs.statSync(skillDir);
  } catch (_err) {
    return {
      portable: false,
      blockers: [{ file: skillDir, line: 0, match: '', label: 'skill directory does not exist' }],
      manifest: {},
      scannedFiles: [],
      skillMdPath: null,
    };
  }
  if (!stat.isDirectory()) {
    return {
      portable: false,
      blockers: [{ file: skillDir, line: 0, match: '', label: 'skill path is not a directory' }],
      manifest: {},
      scannedFiles: [],
      skillMdPath: null,
    };
  }

  // Locate skill.md (case variants accepted)
  let skillMdPath = null;
  for (const candidate of ['skill.md', 'SKILL.md', 'Skill.md']) {
    const p = path.join(skillDir, candidate);
    if (fs.existsSync(p)) {
      skillMdPath = p;
      break;
    }
  }

  let manifest = {};
  if (skillMdPath) {
    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      manifest = parseFrontmatter(content);
    } catch (_err) {
      // Continue; missing manifest is itself a portability concern handled below.
    }
  }

  const blockers = [];
  if (!skillMdPath) {
    blockers.push({
      file: skillDir,
      line: 0,
      match: '',
      label: 'skill.md not found at skill root',
    });
  }

  // Explicit author declaration. F14 (R-379): previously the comment claimed
  // `portable: false` "short-circuits scanning" — but there was no early
  // return; the function scanned anyway, producing a needlessly long blocker
  // list for skills the author already marked non-portable. Short-circuit
  // now matches the comment: return early so the caller gets a single,
  // clear blocker ("author opted out") instead of dozens of pattern hits.
  const declaredPortable = typeof manifest.portable === 'string'
    ? manifest.portable.toLowerCase() === 'true'
    : null;
  if (declaredPortable === false) {
    blockers.push({
      file: skillMdPath ?? skillDir,
      line: 0,
      match: 'portable: false',
      label: 'manifest declares portable: false',
    });
    // Short-circuit: author opted out, no need to enumerate every pattern hit.
    return {
      portable: false,
      blockers,
      manifest,
      scannedFiles: [],
      skillMdPath,
    };
  }

  // Compose pattern list: builtin + extras.
  const patterns = [...BLOCKER_PATTERNS];
  if (Array.isArray(opts.extraPatterns)) {
    for (const p of opts.extraPatterns) {
      if (p instanceof RegExp) {
        patterns.push({ pattern: p, label: `custom: ${p.source}` });
      }
    }
  }

  const files = listScanFiles(skillDir);
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (_err) {
      continue;
    }
    const rel = path.relative(skillDir, file) || path.basename(file);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, label } of patterns) {
        const match = line.match(pattern);
        if (match) {
          blockers.push({
            file: rel,
            line: i + 1,
            match: match[0],
            label,
          });
        }
      }
    }
  }

  return {
    portable: blockers.length === 0,
    blockers,
    manifest,
    scannedFiles: files.map((f) => path.relative(skillDir, f) || path.basename(f)),
    skillMdPath,
  };
}

/**
 * Format a blockers array as a human-readable report. Useful for CLI output.
 *
 * @param {Array} blockers - Output of assessSkillPortability().blockers
 * @returns {string} Multi-line summary
 */
function formatBlockers(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return 'No portability blockers found.';
  }
  const lines = [`Found ${blockers.length} portability blocker(s):`];
  for (const b of blockers) {
    const where = `${b.file}:${b.line}`;
    const detail = b.match ? ` — "${b.match}"` : '';
    lines.push(`  - [${b.label}] ${where}${detail}`);
  }
  return lines.join('\n');
}

module.exports = {
  assessSkillPortability,
  formatBlockers,
  parseFrontmatter,
  // Exposed for tests
  BLOCKER_PATTERNS,
  SCAN_EXTENSIONS,
};
