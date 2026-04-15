#!/usr/bin/env node

/**
 * Wogi Flow - Registry Discovery
 *
 * Reads the active registry manifest (.workflow/state/registry-manifest.json)
 * and exposes paths to all active map + index files. Falls back to a safe
 * default (components, functions, apis) when the manifest is missing.
 *
 * Extracted from flow-utils.js (wf-94cc3b72 epic — flow-utils decomposition).
 *
 * Lightweight — reads the manifest file directly without pulling in
 * flow-registry-manager (which has heavier deps).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STATE_DIR } = require('./flow-paths');
const { safeJsonParse } = require('./flow-io');

const MANIFEST_PATH = path.join(STATE_DIR, 'registry-manifest.json');

const DEFAULT_REGISTRIES = [
  { id: 'components', name: 'Component Registry', mapFile: 'app-map.md', indexFile: 'component-index.json', category: 'code', type: 'components', active: true },
  { id: 'functions', name: 'Function Registry', mapFile: 'function-map.md', indexFile: 'function-index.json', category: 'code', type: 'functions', active: true },
  { id: 'apis', name: 'API Registry', mapFile: 'api-map.md', indexFile: 'api-index.json', category: 'code', type: 'apis', active: true }
];

/**
 * Get all active registries from the manifest (with fallback to defaults).
 * @returns {Array<{id, name, mapFile, indexFile, category, type, active}>}
 */
function getActiveRegistries() {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const manifest = safeJsonParse(MANIFEST_PATH, null);
      if (manifest) {
        const active = (manifest.registries || []).filter(r => r.active);
        if (active.length > 0) return active;
      }
    } catch (_err) {
      // Fall through to defaults
    }
  }
  return DEFAULT_REGISTRIES;
}

/**
 * Get paths for all active registry map and index files.
 * @returns {{ maps: string[], indexes: string[], mapsByCategory: Object, registries: Array }}
 */
function getRegistryPaths() {
  const registries = getActiveRegistries();
  const maps = registries.map(r => path.join(STATE_DIR, r.mapFile));
  const indexes = registries.map(r => path.join(STATE_DIR, r.indexFile));

  const mapsByCategory = {};
  for (const r of registries) {
    if (!mapsByCategory[r.category]) mapsByCategory[r.category] = [];
    mapsByCategory[r.category].push({
      id: r.id,
      mapPath: path.join(STATE_DIR, r.mapFile),
      indexPath: path.join(STATE_DIR, r.indexFile)
    });
  }

  return { maps, indexes, mapsByCategory, registries };
}

/**
 * Get map file names only (for copying to worktrees, etc.).
 * @returns {string[]} e.g. ['app-map.md', 'function-map.md', 'api-map.md']
 */
function getRegistryMapFiles() {
  return getActiveRegistries().map(r => r.mapFile);
}

module.exports = {
  getActiveRegistries,
  getRegistryPaths,
  getRegistryMapFiles,
  DEFAULT_REGISTRIES,
  MANIFEST_PATH,
};
