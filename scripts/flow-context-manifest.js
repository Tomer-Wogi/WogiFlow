#!/usr/bin/env node

/**
 * Wogi Flow - Context Manifest Generator
 *
 * Generates a compact context manifest from project registry files.
 * The manifest provides one-line summaries of all coding rules, components,
 * utility functions, and API endpoints — enough for Claude to know WHAT EXISTS
 * without injecting full content upfront.
 *
 * Part of the Tiered Context Architecture (CC 2.1.89+):
 * - T1: Critical state (task, routing, warnings) — always injected
 * - T2: Context manifest (this file) — compact inventory of available context
 * - T3: Full content — loaded on-demand via Read when Claude needs it
 *
 * The manifest solves the "unknown unknowns" problem: if Claude doesn't know
 * a utility exists, it will reinvent it. The manifest lists everything that
 * exists with enough context to know when to look deeper.
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse } = require('./flow-utils');

/** Maximum chars per summary line in the manifest */
const MAX_SUMMARY_LEN = 120;

/** Maximum entries per registry section */
const MAX_ENTRIES_PER_SECTION = 30;

/**
 * Extract coding rules from decisions.md as one-line summaries.
 * Parses ## sections and extracts the first meaningful line of each.
 *
 * @returns {Array<{title: string, summary: string}>}
 */
function extractDecisionSummaries() {
  if (!fs.existsSync(PATHS.decisions)) return [];

  try {
    const content = fs.readFileSync(PATHS.decisions, 'utf-8');
    const sections = content.split(/^##\s+/m).slice(1);
    const results = [];

    for (const section of sections) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;

      const lines = section.split('\n');
      const title = lines[0].trim();
      if (!title) continue;

      // Skip the divider line and header, find first content line
      const subsections = section.split(/^###\s+/m).slice(1);
      if (subsections.length > 0) {
        // Has subsections — list them (skip placeholder subsections)
        const subNames = subsections
          .map(s => s.split('\n')[0].trim())
          .filter(name => name && !name.includes('<!--'))
          .slice(0, 5);
        if (subNames.length > 0) {
          results.push({
            title,
            summary: subNames.join(', ')
          });
        }
      } else {
        // No subsections — take first non-empty content line
        const bodyLines = lines.slice(1).filter(l =>
          l.trim() && !l.startsWith('---') && !l.startsWith('**Source') && !l.includes('<!--')
        );
        const summary = bodyLines[0]?.trim().substring(0, MAX_SUMMARY_LEN) || '';
        if (summary) {
          results.push({ title, summary });
        }
      }
    }

    return results;
  } catch (_err) {
    return [];
  }
}

/**
 * Extract components from app-map.md tables.
 * Parses markdown tables for Screen, Modal, and Component entries.
 *
 * @returns {Array<{type: string, name: string, detail: string}>}
 */
function extractComponentSummaries() {
  const appMapPath = PATHS.appMap || path.join(PATHS.state, 'app-map.md');
  if (!fs.existsSync(appMapPath)) return [];

  try {
    const content = fs.readFileSync(appMapPath, 'utf-8');
    const results = [];

    // Parse table rows: | Name | ... | ... |
    // Skip header rows (containing ---), template rows (_Example_), and column header rows
    const HEADER_KEYWORDS = ['Screen', 'Route', 'Status', 'Modal', 'Trigger', 'Component', 'Variants', 'Path', 'Details'];
    const tableRows = content.match(/^\|[^|]+\|.+\|$/gm) || [];
    for (const row of tableRows) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;
      if (row.includes('---') || row.includes('_Example_')) continue;
      // Skip column header rows (first row of each table)
      const cells = row.split('|').filter(Boolean).map(c => c.trim());
      if (cells.length >= 2 && HEADER_KEYWORDS.includes(cells[0]) && HEADER_KEYWORDS.includes(cells[1])) continue;

      if (cells.length >= 2 && cells[0]) {
        results.push({
          type: 'component',
          name: cells[0],
          detail: cells.slice(1, 3).filter(Boolean).join(' — ').substring(0, MAX_SUMMARY_LEN)
        });
      }
    }

    return results;
  } catch (_err) {
    return [];
  }
}

/**
 * Extract utility functions from function-map.md.
 * Parses both table format and manual entry format.
 *
 * @returns {Array<{name: string, file: string, purpose: string}>}
 */
function extractFunctionSummaries() {
  const fnMapPath = path.join(PATHS.state, 'function-map.md');
  if (!fs.existsSync(fnMapPath)) return [];

  try {
    const content = fs.readFileSync(fnMapPath, 'utf-8');
    const results = [];

    // Parse table rows: | functionName | file | purpose |
    const tableRows = content.match(/^\|[^|]+\|.+\|$/gm) || [];
    for (const row of tableRows) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;
      if (row.includes('---') || row.includes('Function') && row.includes('File')) continue;

      const cells = row.split('|').filter(Boolean).map(c => c.trim());
      if (cells.length >= 2 && cells[0] && !cells[0].startsWith('_')) {
        results.push({
          name: cells[0],
          file: cells[1] || '',
          purpose: (cells[2] || '').substring(0, MAX_SUMMARY_LEN)
        });
      }
    }

    // Parse ### entries (manual format): ### functionName(params)
    const manualEntries = content.match(/^###\s+\w+.*$/gm) || [];
    for (const entry of manualEntries) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;
      const name = entry.replace(/^###\s+/, '').trim();
      if (name && !name.includes('Rules') && !name.includes('Scan')) {
        // Avoid duplicates
        if (!results.some(r => r.name === name)) {
          results.push({ name, file: '', purpose: '' });
        }
      }
    }

    return results;
  } catch (_err) {
    return [];
  }
}

/**
 * Extract API endpoints from api-map.md.
 *
 * @returns {Array<{method: string, path: string, purpose: string}>}
 */
function extractApiSummaries() {
  const apiMapPath = path.join(PATHS.state, 'api-map.md');
  if (!fs.existsSync(apiMapPath)) return [];

  try {
    const content = fs.readFileSync(apiMapPath, 'utf-8');
    const results = [];

    // Parse ### METHOD /path entries
    const endpointHeaders = content.match(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+\S+/gm) || [];
    for (const header of endpointHeaders) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;
      const match = header.match(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/);
      if (match) {
        // Find purpose line after the header
        const idx = content.indexOf(header);
        const afterHeader = content.substring(idx + header.length, idx + header.length + 300);
        const purposeMatch = afterHeader.match(/\*\*Purpose\*\*:\s*(.+)/);
        results.push({
          method: match[1],
          path: match[2],
          purpose: (purposeMatch ? purposeMatch[1] : '').substring(0, MAX_SUMMARY_LEN)
        });
      }
    }

    // Parse table format: | METHOD | /path | purpose |
    const tableRows = content.match(/^\|[^|]+\|.+\|$/gm) || [];
    for (const row of tableRows) {
      if (results.length >= MAX_ENTRIES_PER_SECTION) break;
      if (row.includes('---') || row.includes('Method') && row.includes('Path')) continue;

      const cells = row.split('|').filter(Boolean).map(c => c.trim());
      if (cells.length >= 2 && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(cells[0])) {
        if (!results.some(r => r.method === cells[0] && r.path === cells[1])) {
          results.push({
            method: cells[0],
            path: cells[1],
            purpose: (cells[2] || '').substring(0, MAX_SUMMARY_LEN)
          });
        }
      }
    }

    return results;
  } catch (_err) {
    return [];
  }
}

/**
 * Generate the full context manifest.
 * Returns a structured object with all registry summaries.
 *
 * @returns {{ decisions: Array, components: Array, functions: Array, apis: Array, generatedAt: string }}
 */
function generateManifest() {
  return {
    decisions: extractDecisionSummaries(),
    components: extractComponentSummaries(),
    functions: extractFunctionSummaries(),
    apis: extractApiSummaries(),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Format the manifest as a compact markdown string for context injection.
 * Designed to be small enough to always fit in T2 (target: 2-8KB depending on project size).
 *
 * @param {Object} manifest - From generateManifest()
 * @returns {string} Formatted markdown
 */
function formatManifestForInjection(manifest) {
  if (!manifest) return '';

  const parts = [];

  // Coding rules
  if (manifest.decisions.length > 0) {
    parts.push('**Coding Rules** (load full: `Read .workflow/state/decisions.md`):');
    for (const d of manifest.decisions) {
      parts.push(`- ${d.title}: ${d.summary}`);
    }
  }

  // Components
  if (manifest.components.length > 0) {
    parts.push('**Components** (load full: `Read .workflow/state/app-map.md`):');
    for (const c of manifest.components) {
      parts.push(`- ${c.name}: ${c.detail}`);
    }
  }

  // Utility functions
  if (manifest.functions.length > 0) {
    parts.push('**Utility Functions** (load full: `Read .workflow/state/function-map.md`):');
    for (const f of manifest.functions) {
      const detail = f.purpose ? ` — ${f.purpose}` : '';
      const file = f.file ? ` (${f.file})` : '';
      parts.push(`- \`${f.name}\`${file}${detail}`);
    }
  }

  // API endpoints
  if (manifest.apis.length > 0) {
    parts.push('**API Endpoints** (load full: `Read .workflow/state/api-map.md`):');
    for (const a of manifest.apis) {
      const purpose = a.purpose ? ` — ${a.purpose}` : '';
      parts.push(`- ${a.method} ${a.path}${purpose}`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join('\n');
}

/**
 * Check if any registries have content worth manifesting.
 * Returns false for empty/template-only registries.
 *
 * @param {Object} manifest - From generateManifest()
 * @returns {boolean}
 */
function hasContent(manifest) {
  return (
    manifest.decisions.length > 0 ||
    manifest.components.length > 0 ||
    manifest.functions.length > 0 ||
    manifest.apis.length > 0
  );
}

module.exports = {
  generateManifest,
  formatManifestForInjection,
  hasContent,
  extractDecisionSummaries,
  extractComponentSummaries,
  extractFunctionSummaries,
  extractApiSummaries
};
