#!/usr/bin/env node

/**
 * Wogi Flow - Decisions Merge
 *
 * Smart section-level merge for decisions.md files.
 * Replaces naive concatenation with conflict-aware merging.
 *
 * Modes:
 *   import-wins   - Imported sections override existing on conflict;
 *                   non-addressed existing sections stay
 *   list-conflicts - Output conflicting section names as JSON (for manual resolution)
 *   manual         - Accept a resolutions JSON to apply per-section choices
 *
 * Usage:
 *   node flow-decisions-merge.js import-wins <existing> <imported> [--output <file>]
 *   node flow-decisions-merge.js list-conflicts <existing> <imported>
 *   node flow-decisions-merge.js manual <existing> <imported> --resolutions <file> [--output <file>]
 */

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// Section Parser
// ============================================================

/**
 * Parse a decisions.md file into sections.
 * Sections are delimited by `## ` headers (level 2).
 * The file header (# title) and any content before the first ## is preserved as "preamble".
 *
 * @param {string} content - Raw markdown content
 * @returns {{ preamble: string, sections: Array<{ header: string, key: string, body: string }> }}
 */
function parseSections(content) {
  const lines = content.split('\n');
  let preamble = '';
  const sections = [];
  let currentHeader = null;
  let currentBody = [];

  for (const line of lines) {
    // Match ## headers (but not ### or #)
    const headerMatch = line.match(/^## (.+)$/);

    if (headerMatch) {
      // Save previous section
      if (currentHeader !== null) {
        sections.push({
          header: currentHeader,
          key: normalizeKey(currentHeader),
          body: currentBody.join('\n')
        });
      } else {
        // Everything before first ## is preamble
        preamble = currentBody.join('\n');
      }

      currentHeader = headerMatch[1].trim();
      currentBody = [line];
    } else {
      currentBody.push(line);
    }
  }

  // Save last section
  if (currentHeader !== null) {
    sections.push({
      header: currentHeader,
      key: normalizeKey(currentHeader),
      body: currentBody.join('\n')
    });
  } else {
    preamble = currentBody.join('\n');
  }

  return { preamble, sections };
}

/**
 * Normalize a section header for comparison.
 * Strips metadata markers, lowercases, trims.
 *
 * @param {string} header - Raw section header text
 * @returns {string} Normalized key
 */
function normalizeKey(header) {
  return header
    .replace(/<!--.*?-->/g, '')      // Remove HTML comments (PIN markers)
    .replace(/\s*\(.*?\)\s*/g, '')   // Remove parentheticals like (imported)
    .replace(/[^a-zA-Z0-9\s]/g, '')  // Remove special chars
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ============================================================
// Merge Operations
// ============================================================

/**
 * Find conflicts between two parsed decisions files.
 *
 * @param {Object} existing - Parsed existing file
 * @param {Object} imported - Parsed imported file
 * @returns {Array<{ key: string, existingHeader: string, importedHeader: string }>}
 */
function findConflicts(existing, imported) {
  const conflicts = [];
  const existingKeys = new Map(existing.sections.map(s => [s.key, s]));

  for (const impSection of imported.sections) {
    if (existingKeys.has(impSection.key)) {
      const exSection = existingKeys.get(impSection.key);
      conflicts.push({
        key: impSection.key,
        existingHeader: exSection.header,
        importedHeader: impSection.header
      });
    }
  }

  return conflicts;
}

/**
 * Merge decisions files with import-wins strategy.
 * Imported sections override existing on conflict.
 * Non-addressed existing sections are preserved.
 *
 * @param {Object} existing - Parsed existing file
 * @param {Object} imported - Parsed imported file
 * @param {string} source - Source description for metadata
 * @returns {string} Merged markdown content
 */
function mergeImportWins(existing, imported, source) {
  const importedKeys = new Map(imported.sections.map(s => [s.key, s]));
  const usedImported = new Set();
  const resultSections = [];

  // Walk existing sections: keep or replace
  for (const exSection of existing.sections) {
    if (importedKeys.has(exSection.key)) {
      // Conflict: imported wins
      const impSection = importedKeys.get(exSection.key);
      resultSections.push(impSection.body);
      usedImported.add(exSection.key);
    } else {
      // No conflict: keep existing
      resultSections.push(exSection.body);
    }
  }

  // Add imported sections that don't conflict (new sections from import)
  for (const impSection of imported.sections) {
    if (!usedImported.has(impSection.key)) {
      resultSections.push(impSection.body);
    }
  }

  // Build output
  const parts = [];

  // Use existing preamble (or imported if no existing)
  const preamble = existing.preamble.trim() || imported.preamble.trim();
  if (preamble) {
    parts.push(preamble);
  }

  // Add metadata comment
  parts.push('');
  parts.push(`<!-- Merged from: ${source || 'imported profile'} on ${getTodayDate()} -->`);

  for (const section of resultSections) {
    parts.push('');
    parts.push(section.trim());
  }

  return parts.join('\n') + '\n';
}

/**
 * Merge decisions files with per-section resolutions.
 * Each conflict is resolved by a choice: "existing" or "imported".
 *
 * @param {Object} existing - Parsed existing file
 * @param {Object} imported - Parsed imported file
 * @param {Object} resolutions - Map of key → "existing" | "imported"
 * @param {string} source - Source description for metadata
 * @returns {string} Merged markdown content
 */
function mergeManual(existing, imported, resolutions, source) {
  const importedKeys = new Map(imported.sections.map(s => [s.key, s]));
  const usedImported = new Set();
  const resultSections = [];

  for (const exSection of existing.sections) {
    if (importedKeys.has(exSection.key)) {
      const resolution = resolutions[exSection.key] || 'existing'; // default to existing (conservative)
      if (resolution === 'existing') {
        resultSections.push(exSection.body);
      } else {
        resultSections.push(importedKeys.get(exSection.key).body);
      }
      usedImported.add(exSection.key);
    } else {
      resultSections.push(exSection.body);
    }
  }

  // Add new sections from import (no conflict)
  for (const impSection of imported.sections) {
    if (!usedImported.has(impSection.key)) {
      resultSections.push(impSection.body);
    }
  }

  const parts = [];
  const preamble = existing.preamble.trim() || imported.preamble.trim();
  if (preamble) {
    parts.push(preamble);
  }

  parts.push('');
  parts.push(`<!-- Merged from: ${source || 'imported profile'} on ${getTodayDate()} -->`);

  for (const section of resultSections) {
    parts.push('');
    parts.push(section.trim());
  }

  return parts.join('\n') + '\n';
}

/**
 * Write merged content to outputPath or stdout.
 * @param {string} merged - Merged markdown content
 * @param {string|null} outputPath - File path, or null for stdout
 */
function writeMergedOutput(merged, outputPath) {
  if (outputPath) {
    fs.writeFileSync(outputPath, merged);
  } else {
    process.stdout.write(merged);
  }
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (!mode || mode === '--help') {
    console.error('Usage:');
    console.error('  flow-decisions-merge.js import-wins <existing> <imported> [--output <file>] [--source <name>]');
    console.error('  flow-decisions-merge.js list-conflicts <existing> <imported>');
    console.error('  flow-decisions-merge.js manual <existing> <imported> --resolutions <file> [--output <file>] [--source <name>]');
    process.exit(1);
  }

  const existingPath = args[1];
  const importedPath = args[2];

  if (!existingPath || !importedPath) {
    console.error('Error: Both existing and imported file paths are required');
    process.exit(1);
  }

  // Parse optional flags first (needed for validation)
  let outputPath = null;
  let resolutionsPath = null;
  let source = 'imported profile';
  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === '--resolutions' && args[i + 1]) {
      resolutionsPath = args[++i];
    } else if (args[i] === '--source' && args[i + 1]) {
      source = args[++i];
    }
  }

  // Sanitize --source to prevent HTML comment injection
  source = source.replace(/-->/g, '--&gt;').replace(/<!--/g, '&lt;!--');

  // Validate output path is within project if provided
  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    const projectRoot = process.cwd();
    if (!resolvedOutput.startsWith(projectRoot + path.sep) && resolvedOutput !== projectRoot) {
      console.error('Error: Output path must be within the project directory');
      process.exit(1);
    }
  }

  let existingContent, importedContent;
  try {
    existingContent = fs.readFileSync(existingPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading existing file: ${err.message}`);
    process.exit(1);
  }
  try {
    importedContent = fs.readFileSync(importedPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading imported file: ${err.message}`);
    process.exit(1);
  }

  const existing = parseSections(existingContent);
  const imported = parseSections(importedContent);

  switch (mode) {
    case 'import-wins': {
      const conflicts = findConflicts(existing, imported);
      const merged = mergeImportWins(existing, imported, source);

      writeMergedOutput(merged, outputPath);

      // Print conflict summary to stderr for the caller
      if (conflicts.length > 0) {
        console.error(`Resolved ${conflicts.length} conflict(s) (import wins):`);
        for (const c of conflicts) {
          console.error(`  - "${c.existingHeader}" → replaced by imported version`);
        }
      } else {
        console.error('No conflicts detected — all sections are new.');
      }

      console.error(`Existing sections preserved: ${existing.sections.length - conflicts.length}`);
      console.error(`New sections added: ${imported.sections.length - conflicts.length}`);
      break;
    }

    case 'list-conflicts': {
      const conflicts = findConflicts(existing, imported);
      const output = {
        conflicts: conflicts.map(c => ({
          key: c.key,
          existingHeader: c.existingHeader,
          importedHeader: c.importedHeader
        })),
        existingOnly: existing.sections
          .filter(s => !imported.sections.some(i => i.key === s.key))
          .map(s => s.header),
        importedOnly: imported.sections
          .filter(s => !existing.sections.some(e => e.key === s.key))
          .map(s => s.header),
        summary: {
          totalExisting: existing.sections.length,
          totalImported: imported.sections.length,
          conflicting: conflicts.length,
          existingOnly: existing.sections.length - conflicts.length,
          importedOnly: imported.sections.length - conflicts.length
        }
      };
      console.log(JSON.stringify(output, null, 2));
      break;
    }

    case 'manual': {
      if (!resolutionsPath) {
        console.error('Error: --resolutions <file> is required for manual mode');
        process.exit(1);
      }

      let resolutions;
      try {
        const raw = fs.readFileSync(resolutionsPath, 'utf-8');
        resolutions = JSON.parse(raw);
        // Prototype pollution protection (per security-patterns.md #2)
        if (resolutions && typeof resolutions === 'object') {
          for (const key of Object.keys(resolutions)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              delete resolutions[key];
            }
          }
        }
      } catch (err) {
        console.error(`Error reading resolutions file: ${err.message}`);
        process.exit(1);
      }

      const merged = mergeManual(existing, imported, resolutions, source);

      writeMergedOutput(merged, outputPath);

      console.error('Merged with manual resolutions.');
      break;
    }

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error('Valid modes: import-wins, list-conflicts, manual');
      process.exit(1);
  }
}

// ============================================================
// CLI Entry Point
// ============================================================

if (require.main === module) {
  main();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseSections,
  normalizeKey,
  findConflicts,
  mergeImportWins,
  mergeManual
};
