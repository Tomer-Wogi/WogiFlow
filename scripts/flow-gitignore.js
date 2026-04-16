#!/usr/bin/env node

/**
 * Wogi Flow - Gitignore Auto-Management
 *
 * Declarative mapping of config features to .gitignore entries.
 * When a config change enables a feature that produces runtime artifacts,
 * the relevant entries are automatically appended to .gitignore.
 *
 * Design:
 * - Append-only: never removes existing entries
 * - Idempotent: no duplicate entries on repeated calls
 * - Grouped under "# WogiFlow runtime (auto-managed)" comment
 * - Declarative: RUNTIME_ARTIFACT_MAP defines all mappings
 */

const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./flow-config-loader');
const { PROJECT_ROOT } = require('./flow-paths');

// ============================================================================
// Declarative Config-to-Gitignore Mapping
// ============================================================================

/**
 * Each entry maps a config condition to gitignore patterns.
 * - configPath: dot-notation path into config object
 * - matchValue: value that triggers the entry (true for boolean, string for exact match)
 *   If matchValue is true, any truthy value triggers the entry.
 * - patterns: gitignore entries to add when condition is met
 * - description: human-readable description for health check output
 */
const RUNTIME_ARTIFACT_MAP = [
  {
    configPath: 'testing.uiProvider',
    matchValue: 'playwright-mcp',
    patterns: ['.playwright-mcp/'],
    description: 'Playwright MCP logs and screenshots'
  },
  {
    configPath: 'testing.enabled',
    matchValue: true,
    patterns: ['.workflow/verifications/', '.workflow/tests/generated/'],
    description: 'Test verification artifacts and generated tests'
  },
  {
    configPath: 'webmcp.enabled',
    matchValue: true,
    patterns: ['.workflow/webmcp/'],
    description: 'WebMCP tool definitions'
  }
];

const GITIGNORE_SECTION_HEADER = '# WogiFlow runtime (auto-managed)';

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the value at a dot-notation path in an object.
 * @param {Object} obj
 * @param {string} dotPath - e.g. 'testing.uiProvider'
 * @returns {*} Value at path, or undefined
 */
function getNestedValue(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Determine which gitignore entries are needed based on current config.
 * @param {Object} [config] - Pre-loaded config (optional)
 * @returns {string[]} Gitignore patterns that should exist
 */
function getRequiredEntries(config) {
  if (!config) config = getConfig();
  const needed = [];

  for (const mapping of RUNTIME_ARTIFACT_MAP) {
    const value = getNestedValue(config, mapping.configPath);
    let matches = false;

    if (mapping.matchValue === true) {
      matches = !!value;
    } else {
      matches = value === mapping.matchValue;
    }

    if (matches) {
      needed.push(...mapping.patterns);
    }
  }

  return needed;
}

/**
 * Read the current .gitignore content.
 * @returns {string} Content of .gitignore, or empty string if not found
 */
function readGitignore() {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  try {
    return fs.readFileSync(gitignorePath, 'utf-8');
  } catch (_err) {
    return '';
  }
}

/**
 * Parse existing gitignore entries (trimmed, non-empty, non-comment lines).
 * @param {string} content - .gitignore content
 * @returns {Set<string>} Set of existing entries
 */
function parseExistingEntries(content) {
  const entries = new Set();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      entries.add(trimmed);
    }
  }
  return entries;
}

/**
 * Sync .gitignore with config-required entries.
 * Appends missing entries under the auto-managed section header.
 * @param {Object} [config] - Pre-loaded config (optional)
 * @returns {{ added: string[], alreadyPresent: string[] }} What was done
 */
function syncGitignore(config) {
  const required = getRequiredEntries(config);
  if (required.length === 0) {
    return { added: [], alreadyPresent: [] };
  }

  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  const content = readGitignore();
  const existing = parseExistingEntries(content);

  const missing = required.filter(entry => !existing.has(entry));
  const alreadyPresent = required.filter(entry => existing.has(entry));

  if (missing.length === 0) {
    return { added: [], alreadyPresent };
  }

  // Build the new section content
  const hasSection = content.includes(GITIGNORE_SECTION_HEADER);
  let newContent;

  if (hasSection) {
    // Append to existing section — find the section and add after it
    const lines = content.split('\n');
    const headerIdx = lines.findIndex(l => l.trim() === GITIGNORE_SECTION_HEADER);
    // Find the end of the managed section (next blank line or next comment section)
    let insertIdx = headerIdx + 1;
    while (insertIdx < lines.length) {
      const line = lines[insertIdx].trim();
      if (line === '' || (line.startsWith('#') && line !== GITIGNORE_SECTION_HEADER)) {
        break;
      }
      insertIdx++;
    }
    // Insert missing entries
    lines.splice(insertIdx, 0, ...missing);
    newContent = lines.join('\n');
  } else {
    // Create new section at end of file
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    newContent = content + separator + GITIGNORE_SECTION_HEADER + '\n' + missing.join('\n') + '\n';
  }

  fs.writeFileSync(gitignorePath, newContent, 'utf-8');

  return { added: missing, alreadyPresent };
}

/**
 * Check gitignore health — returns missing entries for /wogi-health.
 * @param {Object} [config] - Pre-loaded config (optional)
 * @returns {{ ok: boolean, missing: Array<{pattern: string, description: string}> }}
 */
function checkGitignoreHealth(config) {
  if (!config) config = getConfig();
  const content = readGitignore();
  const existing = parseExistingEntries(content);
  const missing = [];

  for (const mapping of RUNTIME_ARTIFACT_MAP) {
    const value = getNestedValue(config, mapping.configPath);
    let matches = false;

    if (mapping.matchValue === true) {
      matches = !!value;
    } else {
      matches = value === mapping.matchValue;
    }

    if (matches) {
      for (const pattern of mapping.patterns) {
        if (!existing.has(pattern)) {
          missing.push({ pattern, description: mapping.description });
        }
      }
    }
  }

  return { ok: missing.length === 0, missing };
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'sync';

  if (command === 'sync') {
    const result = syncGitignore();
    if (result.added.length > 0) {
      console.log(`Added ${result.added.length} entries to .gitignore:`);
      for (const entry of result.added) {
        console.log(`  + ${entry}`);
      }
    } else {
      console.log('.gitignore is up to date');
    }
  } else if (command === 'check') {
    const health = checkGitignoreHealth();
    if (health.ok) {
      console.log('.gitignore: all required entries present');
    } else {
      console.log(`Missing ${health.missing.length} .gitignore entries:`);
      for (const m of health.missing) {
        console.log(`  - ${m.pattern} (${m.description})`);
      }
      console.log('\nRun: flow gitignore sync');
      process.exit(1);
    }
  } else {
    console.log('Usage: flow-gitignore.js [sync|check]');
  }
}

module.exports = {
  RUNTIME_ARTIFACT_MAP,
  GITIGNORE_SECTION_HEADER,
  getRequiredEntries,
  syncGitignore,
  checkGitignoreHealth
};
