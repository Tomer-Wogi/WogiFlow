#!/usr/bin/env node

/**
 * Skill Exporter — agentskills.io v1 (Phase 1B — wf-0342fc33)
 *
 * Produces a manifest + file list for publishing a portable WogiFlow skill to
 * agentskills.io under the v1 schema.
 *
 * IMPORTANT — Schema assumption:
 *   This module has NO network access; the agentskills.io v1 schema is not
 *   fetched at build time. We pin our serializer output to the field map
 *   sketched in epic-quality-loop.md Phase 1B and lock the `schemaVersion`
 *   string to `agentskills@v1`. A future contract-test in CI (Phase 1B's
 *   "Contract test in CI validates output against agentskills.io schema")
 *   will catch any drift once the network gate exists. Until then, this is
 *   our authoritative interpretation. Field map:
 *
 *     {
 *       schemaVersion: "agentskills@v1",   // pinned
 *       name:          string,             // skill identifier (kebab-case)
 *       version:       string,             // semver
 *       description:   string,             // one-line summary
 *       license:       string,             // SPDX (default MIT)
 *       source:        { type, url? },     // provenance
 *       compatibility: string,             // env requirements
 *       instructions:  string,             // skill.md body (post-frontmatter)
 *       files:         string[],           // relative paths included in bundle
 *       triggers:      object,             // optional trigger metadata
 *       dependencies:  string[],           // optional, default []
 *     }
 *
 * Callers MUST verify portability via lib/skill-portability before calling.
 * This module deliberately does not re-check — separation of concerns.
 *
 * @module lib/skill-export-agentskills
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { parseFrontmatter } = require('./skill-portability');

const AGENTSKILLS_SCHEMA_VERSION = 'agentskills@v1';

const DEFAULT_LICENSE = 'MIT';

// File extensions we bundle. Everything else (binaries, dotfiles, etc.) is
// skipped to keep exports lean and predictable.
const BUNDLE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.js', '.ts', '.sh', '.template', '.hbs']);

// Files always included regardless of extension (manifest aliases).
const ALWAYS_INCLUDE = new Set(['LICENSE', 'README', 'README.md']);

const MAX_BUNDLE_FILES = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip YAML frontmatter from a skill.md body, returning the prose portion.
 *
 * @param {string} content
 * @returns {string}
 */
function stripFrontmatter(content) {
  if (typeof content !== 'string') return '';
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length).trimStart();
}

/**
 * Recursively list files under a directory that qualify for bundling.
 *
 * @param {string} rootDir
 * @returns {string[]} Absolute file paths, capped at MAX_BUNDLE_FILES.
 */
function listBundleFiles(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0 && out.length < MAX_BUNDLE_FILES) {
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
      if (BUNDLE_EXTENSIONS.has(ext) || ALWAYS_INCLUDE.has(entry.name)) {
        out.push(full);
        if (out.length >= MAX_BUNDLE_FILES) break;
      }
    }
  }
  return out;
}

/**
 * Read a file safely, returning empty string on failure.
 *
 * @param {string} filePath
 * @returns {string}
 */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (_err) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a skill to agentskills.io v1 manifest + file list.
 *
 * @param {string} skillDir - Absolute path to skill directory
 * @param {Object} [opts]
 * @param {string} [opts.name] - Override skill name (default: from frontmatter or dir basename)
 * @param {string} [opts.version] - Override version (default: from frontmatter or 0.0.0)
 * @param {string} [opts.sourceUrl] - Provenance URL for `source.url`
 * @returns {{manifest: Object, files: Array<{path: string, content: string}>, skillMdPath: string|null}}
 */
function exportToAgentskills(skillDir, opts = {}) {
  if (typeof skillDir !== 'string' || !skillDir) {
    throw new Error('exportToAgentskills: skillDir must be a non-empty string');
  }
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    throw new Error(`exportToAgentskills: not a directory: ${skillDir}`);
  }

  // Locate skill.md
  let skillMdPath = null;
  for (const candidate of ['skill.md', 'SKILL.md', 'Skill.md']) {
    const p = path.join(skillDir, candidate);
    if (fs.existsSync(p)) {
      skillMdPath = p;
      break;
    }
  }

  let frontmatter = {};
  let instructions = '';
  if (skillMdPath) {
    const content = safeReadFile(skillMdPath);
    frontmatter = parseFrontmatter(content);
    instructions = stripFrontmatter(content);
  }

  const name = opts.name ?? frontmatter.name ?? path.basename(skillDir);
  const version = opts.version ?? frontmatter.version ?? '0.0.0';
  const description = frontmatter.description ?? '';
  const license = frontmatter.license ?? DEFAULT_LICENSE;
  const compatibility = frontmatter.compatibility ?? '';

  // Build file bundle (relative paths, content strings)
  const absFiles = listBundleFiles(skillDir);
  const files = absFiles.map((abs) => {
    const rel = path.relative(skillDir, abs) || path.basename(abs);
    return {
      path: rel.split(path.sep).join('/'), // POSIX-style for cross-OS portability
      content: safeReadFile(abs),
    };
  });

  // agentskills v1 shape (see header comment for source of this field map)
  const manifest = {
    schemaVersion: AGENTSKILLS_SCHEMA_VERSION,
    name,
    version,
    description,
    license,
    compatibility,
    source: {
      type: 'wogiflow',
      ...(opts.sourceUrl ? { url: opts.sourceUrl } : {}),
    },
    instructions,
    files: files.map((f) => f.path),
    dependencies: [],
    // Pass through any trigger metadata declared in the skill manifest
    ...(frontmatter['user-invocable'] !== undefined
      ? { userInvocable: frontmatter['user-invocable'] === 'true' }
      : {}),
  };

  return { manifest, files, skillMdPath };
}

module.exports = {
  exportToAgentskills,
  AGENTSKILLS_SCHEMA_VERSION,
  // exposed for tests
  stripFrontmatter,
  listBundleFiles,
};
