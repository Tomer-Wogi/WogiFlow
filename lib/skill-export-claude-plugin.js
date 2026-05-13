#!/usr/bin/env node

/**
 * Skill Exporter — Claude Code plugin format (Phase 1B — wf-0342fc33)
 *
 * Produces a Claude Code plugin manifest + file list suitable for the
 * `claude plugin tag` distribution path (Claude Code 2.1.118+).
 *
 * Layout produced (the file map this module returns; `flow skill export`
 * is responsible for actually writing these to disk):
 *
 *   .claude-plugin/plugin.json     (root manifest)
 *   skills/<name>/SKILL.md         (the skill itself)
 *   skills/<name>/<...other files> (knowledge/, templates/, etc.)
 *
 * The plugin.json shape mirrors what shipping Claude Code plugins use
 * (see e.g., the official Figma plugin's `.claude-plugin/plugin.json`):
 *
 *   {
 *     name:        string,         // plugin identifier
 *     description: string,
 *     version:     string,
 *     author:      { name: string } | string,
 *     license:     string          // optional
 *   }
 *
 * Like the agentskills exporter, this module assumes the caller has already
 * run the portability checker. We don't double-verify.
 *
 * @module lib/skill-export-claude-plugin
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { parseFrontmatter } = require('./skill-portability');
const { listBundleFiles } = require('./skill-export-agentskills');

const DEFAULT_LICENSE = 'MIT';
const DEFAULT_AUTHOR = 'wogiflow';

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

/**
 * Export a skill to Claude Code plugin format.
 *
 * @param {string} skillDir - Absolute path to skill directory
 * @param {Object} [opts]
 * @param {string} [opts.name] - Override plugin name (default: from frontmatter or dir basename)
 * @param {string} [opts.version] - Override version (default: from frontmatter or 0.0.0)
 * @param {string} [opts.author] - Override author name (default: DEFAULT_AUTHOR)
 * @returns {{manifest: Object, files: Array<{path: string, content: string}>, skillMdPath: string|null}}
 */
function exportToClaudePlugin(skillDir, opts = {}) {
  if (typeof skillDir !== 'string' || !skillDir) {
    throw new Error('exportToClaudePlugin: skillDir must be a non-empty string');
  }
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    throw new Error(`exportToClaudePlugin: not a directory: ${skillDir}`);
  }

  // Locate skill.md (we tolerate case variants; output is normalized to SKILL.md
  // which is the prevailing convention in shipping Claude Code plugins).
  let skillMdPath = null;
  for (const candidate of ['skill.md', 'SKILL.md', 'Skill.md']) {
    const p = path.join(skillDir, candidate);
    if (fs.existsSync(p)) {
      skillMdPath = p;
      break;
    }
  }

  let frontmatter = {};
  if (skillMdPath) {
    frontmatter = parseFrontmatter(safeReadFile(skillMdPath));
  }

  const name = opts.name ?? frontmatter.name ?? path.basename(skillDir);
  const version = opts.version ?? frontmatter.version ?? '0.0.0';
  const description = frontmatter.description ?? '';
  const license = frontmatter.license ?? DEFAULT_LICENSE;
  const author = opts.author ?? DEFAULT_AUTHOR;

  // Plugin manifest — matches the .claude-plugin/plugin.json shape used by
  // shipping Claude Code plugins. Keeping it tight: name/description/version/
  // author/license. Future plugin fields (commands, hooks, mcpServers) are
  // additive — leave room but don't speculatively fill them in.
  const manifest = {
    name,
    description,
    version,
    author: { name: author },
    license,
  };

  // Build file bundle. The Claude Code plugin layout puts the skill under
  // `skills/<name>/...`, so we re-root every file under that prefix.
  // skill.md is normalized to SKILL.md in the destination.
  const absFiles = listBundleFiles(skillDir);
  const files = [
    // The plugin.json manifest itself
    {
      path: '.claude-plugin/plugin.json',
      content: JSON.stringify(manifest, null, 2) + '\n',
    },
  ];

  for (const abs of absFiles) {
    const relRaw = path.relative(skillDir, abs) || path.basename(abs);
    const rel = relRaw.split(path.sep).join('/');
    let destName = rel;

    // Normalize skill.md → SKILL.md at the skill root only.
    if (rel === 'skill.md' || rel === 'Skill.md') {
      destName = 'SKILL.md';
    }

    files.push({
      path: `skills/${name}/${destName}`,
      content: safeReadFile(abs),
    });
  }

  return { manifest, files, skillMdPath };
}

module.exports = {
  exportToClaudePlugin,
};
