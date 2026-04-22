#!/usr/bin/env node

/**
 * Wogi Flow - Trap-Zone Ambiguity Detector
 *
 * AGNOSTIC mechanism — zero hardcoded domain knowledge.
 *
 * Finds identifiers that appear as domain-entity declarations in ≥2 structural
 * contexts with divergent field sets. These are the "same term, different
 * meanings" trap zones that cause logic failures.
 *
 * Example (from wogi-hub, but discovered structurally, not by knowing the project):
 *   - `Department` appears in prisma schema with fields { id, name, employees, services }
 *   - `Department` also appears as a type-string discriminator on `Project` records
 *   - The detector sees: same name, two structurally distinct declarations → TRAP ZONE
 *
 * How this stays agnostic:
 *   1. No lookup tables, no hardcoded terms.
 *   2. Scans: Prisma models, TypeScript interface/type/class declarations.
 *   3. Clusters by identifier name.
 *   4. Flags any cluster with ≥2 members having structurally divergent fields.
 *
 * Story: wf-c5198406 (IGR Stage 1 — Intent Bootstrap)
 * Epic: wf-b00262b1 (IGR)
 *
 * Usage:
 *   const { detectTrapZones } = require('./flow-trap-zone');
 *   const report = detectTrapZones({ scanPaths: ['src', 'packages'] });
 *
 *   // report = {
 *   //   scanned: { files: N, identifiers: N },
 *   //   trapZones: [ { term, occurrences: [ { path, kind, fields }, ... ] } ]
 *   // }
 *
 * CLI:
 *   node scripts/flow-trap-zone.js scan [--root=.] [--paths=src,packages]
 *   node scripts/flow-trap-zone.js scan --json
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, dirExists } = require('./flow-io');
const { color } = require('./flow-output');

// ============================================================
// Constants
// ============================================================

/**
 * File patterns to scan. Broad but bounded — we parse only the file types
 * where entity-like declarations are structurally regular.
 */
const SCAN_EXTENSIONS = ['.prisma', '.ts', '.tsx'];

/**
 * Directories to skip regardless of other settings.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.workflow',
  '.claude',
  // Generated code directories — these produce massive false-positive clusters
  // because build tools emit duplicate type names by design.
  'generated',
  '__generated__',
  '.prisma',
  'prisma-client',
]);

/**
 * Minimum number of fields for a declaration to be considered "entity-like".
 * A type alias with only 1-2 fields is usually a utility type, not a domain entity.
 */
const MIN_FIELDS_FOR_ENTITY = 2;

// ============================================================
// Public API
// ============================================================

/**
 * Scan a project and return the trap-zone report.
 *
 * @param {Object} [options]
 * @param {string} [options.root] - Project root. Defaults to PATHS.root.
 * @param {string[]} [options.scanPaths] - Relative paths within root to scan. Defaults to [''] (scan whole root).
 * @param {Set<string>} [options.skipDirs] - Additional directories to skip.
 * @param {number} [options.maxFiles] - Cap on files scanned. Default Infinity.
 * @returns {Object} Report shape described in the module docstring.
 */
function detectTrapZones(options = {}) {
  const root = options.root || PATHS.root;
  const scanPaths = (options.scanPaths && options.scanPaths.length > 0 ? options.scanPaths : ['']).map(
    (p) => path.join(root, p)
  );
  const skipDirs = new Set([...SKIP_DIRS, ...(options.skipDirs || [])]);
  const maxFiles = typeof options.maxFiles === 'number' ? options.maxFiles : Infinity;

  const files = [];
  for (const base of scanPaths) {
    if (!dirExists(base) && !fileExists(base)) continue;
    walkFiles(base, files, skipDirs, maxFiles);
    if (files.length >= maxFiles) break;
  }

  // Parse each file into declarations
  const declarations = []; // { name, kind, fields: [], file, line }
  let skipFiles = 0;
  for (const f of files) {
    try {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.prisma') {
        declarations.push(...parsePrisma(f));
      } else if (ext === '.ts' || ext === '.tsx') {
        declarations.push(...parseTypeScript(f));
      }
    } catch (_err) {
      skipFiles++;
    }
  }

  // Cluster by name
  const byName = new Map();
  for (const d of declarations) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }

  // Identify trap zones: ≥2 declarations of the same name with structurally
  // divergent field sets (different count, or different field names)
  const trapZones = [];
  for (const [name, occurrences] of byName) {
    if (occurrences.length < 2) continue;
    if (!hasStructuralDivergence(occurrences)) continue;
    trapZones.push({ term: name, occurrences: occurrences.map(summarizeDeclaration) });
  }

  // Sort by term for stable output
  trapZones.sort((a, b) => a.term.localeCompare(b.term));

  return {
    scanned: {
      files: files.length,
      declarations: declarations.length,
      skippedFiles: skipFiles,
    },
    trapZones,
  };
}

// ============================================================
// File walker
// ============================================================

function walkFiles(startPath, collected, skipDirs, maxFiles) {
  let stat;
  try {
    stat = fs.statSync(startPath);
  } catch (_err) {
    return;
  }
  if (stat.isFile()) {
    if (SCAN_EXTENSIONS.includes(path.extname(startPath).toLowerCase())) {
      collected.push(startPath);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  if (collected.length >= maxFiles) return;

  let entries;
  try {
    entries = fs.readdirSync(startPath);
  } catch (_err) {
    return;
  }

  for (const entry of entries) {
    if (collected.length >= maxFiles) break;
    if (skipDirs.has(entry)) continue;
    if (entry.startsWith('.') && entry !== '.') {
      // Skip hidden directories except the current dir itself
      continue;
    }
    walkFiles(path.join(startPath, entry), collected, skipDirs, maxFiles);
  }
}

// ============================================================
// Prisma parser
// ============================================================

/**
 * Parse a Prisma schema file. Returns declarations for `model` and `type`.
 * Lightweight regex-based parser — covers 95% of real-world schemas without
 * a full Prisma AST dependency.
 */
function parsePrisma(file) {
  const content = safeRead(file);
  if (!content) return [];
  const declarations = [];

  // Match "model Name {" or "type Name {"
  // then capture body until matching "}"
  const blockRegex = /\b(model|type|enum)\s+(\w+)\s*\{([^{}]*)\}/g;
  let m;
  while ((m = blockRegex.exec(content)) !== null) {
    const [, kind, name, body] = m;
    if (kind === 'enum') continue; // enums are value sets, not entities
    const fields = extractPrismaFields(body);
    if (fields.length < MIN_FIELDS_FOR_ENTITY) continue;
    declarations.push({
      name,
      kind: `prisma-${kind}`,
      fields,
      file,
      line: content.slice(0, m.index).split('\n').length,
    });
  }

  return declarations;
}

function extractPrismaFields(body) {
  const fields = [];
  const lines = body.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    // "fieldName Type ...modifiers"
    const m = line.match(/^([A-Za-z_]\w*)\s+\S+/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

// ============================================================
// TypeScript parser
// ============================================================

/**
 * Parse TypeScript interface / class / type-literal declarations.
 * Regex-based — covers the common case of `interface Foo { ... }`,
 * `type Foo = { ... }`, `class Foo { ... }`. Does not handle
 * namespaces or deeply nested generics; those are false-negatives, acceptable.
 */
function parseTypeScript(file) {
  const content = safeRead(file);
  if (!content) return [];
  const declarations = [];

  // interface / class / type with object literal
  // We scan for declaration header, then balance braces forward.
  const headerRegex =
    /(?:^|\n)\s*(?:export\s+)?(interface|class|type)\s+([A-Z]\w*)\b\s*(?:extends[^{]*|implements[^{]*|<[^>]*>\s*)?(?:=\s*)?(\{)/g;
  let m;
  while ((m = headerRegex.exec(content)) !== null) {
    const [, kind, name, _openBrace] = m;
    const bodyStart = m.index + m[0].length;
    const body = extractBalancedBlock(content, bodyStart - 1); // include the opening brace
    if (!body) continue;
    const fields = extractTsFields(body);
    if (fields.length < MIN_FIELDS_FOR_ENTITY) continue;
    declarations.push({
      name,
      kind: `ts-${kind}`,
      fields,
      file,
      line: content.slice(0, m.index).split('\n').length,
    });
  }

  return declarations;
}

/**
 * Given text and the position of an opening '{', return the contents between
 * that brace and its matching '}' (exclusive). Returns null if unbalanced.
 */
function extractBalancedBlock(text, openIndex) {
  if (text[openIndex] !== '{') return null;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

function extractTsFields(body) {
  const fields = [];
  // Match "fieldName:" or "fieldName?:" or "get fieldName()"
  // Skip method bodies; we care about field declarations
  const re = /(?:^|\n|;|,)\s*(?:readonly\s+|public\s+|private\s+|protected\s+|static\s+)?(?:get\s+)?([a-zA-Z_$][\w$]*)\s*(?:\?)?\s*[:(]/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    // Skip obvious non-fields
    if (['constructor', 'return', 'if', 'else', 'for', 'while', 'function'].includes(name)) continue;
    seen.add(name);
    fields.push(name);
  }
  return fields;
}

// ============================================================
// Structural divergence
// ============================================================

/**
 * Two declarations are structurally divergent when their field sets differ
 * by at least one member on either side. Identical field sets = benign
 * redefinition (e.g., a type alias in one file and its class impl in another).
 */
function hasStructuralDivergence(declarations) {
  if (declarations.length < 2) return false;

  // If kinds are mixed (e.g., prisma-model + ts-type) and fields differ, that's a trap zone.
  // If all kinds are the same and fields differ, that's also a trap zone.
  // If all kinds AND fields are identical, it's benign.
  const fieldSets = declarations.map((d) => new Set(d.fields));
  const kinds = new Set(declarations.map((d) => d.kind));

  // Fast check: all kinds same + all field sets identical?
  if (kinds.size === 1) {
    const first = fieldSets[0];
    const allIdentical = fieldSets.every((s) => setsEqual(first, s));
    if (allIdentical) return false; // benign
  }

  // Otherwise check for structural difference: at least one pair differs.
  for (let i = 0; i < fieldSets.length; i++) {
    for (let j = i + 1; j < fieldSets.length; j++) {
      if (!setsEqual(fieldSets[i], fieldSets[j])) return true;
    }
  }
  return false;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ============================================================
// Helpers
// ============================================================

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (_err) {
    return null;
  }
}

function summarizeDeclaration(d) {
  return {
    kind: d.kind,
    file: path.relative(PATHS.root, d.file),
    line: d.line,
    fieldCount: d.fields.length,
    fieldSample: d.fields.slice(0, 6),
  };
}

// ============================================================
// Rendering
// ============================================================

function renderReport(report) {
  const { scanned, trapZones } = report;
  const lines = [];
  lines.push(color('bold', '━━━ Trap-Zone Scan ━━━'));
  lines.push(
    `Scanned: ${scanned.files} files, ${scanned.declarations} entity-like declarations (${scanned.skippedFiles} skipped)`
  );
  lines.push(`Trap zones found: ${trapZones.length}`);
  lines.push('');

  if (trapZones.length === 0) {
    lines.push(color('green', 'No trap zones detected.'));
    return lines.join('\n');
  }

  for (const tz of trapZones) {
    lines.push(color('bold', `${tz.term}`));
    for (const occ of tz.occurrences) {
      lines.push(`  ${occ.kind}  ${occ.file}:${occ.line}  [${occ.fieldCount} fields: ${occ.fieldSample.join(', ')}${occ.fieldCount > occ.fieldSample.length ? ', ...' : ''}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function parseArgs(argv) {
  const out = { _: [] };
  for (const tok of argv) {
    const m = tok.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (tok.startsWith('--')) out[tok.slice(2)] = true;
    else out._.push(tok);
  }
  return out;
}

function cliScan(argv) {
  const args = parseArgs(argv);
  const options = {};
  if (args.root) options.root = args.root;
  if (args.paths) options.scanPaths = String(args.paths).split(',').map((s) => s.trim()).filter(Boolean);
  if (args.maxFiles) options.maxFiles = Number(args.maxFiles);

  const report = detectTrapZones(options);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }
}

// ============================================================
// Main
// ============================================================

if (require.main === module) {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'scan':
    case undefined:
      cliScan(rest);
      break;
    default:
      console.log(`Usage: node scripts/flow-trap-zone.js scan [--root=.] [--paths=src,packages] [--json] [--maxFiles=N]`);
  }
}

module.exports = {
  detectTrapZones,
  parsePrisma,
  parseTypeScript,
  hasStructuralDivergence,
  renderReport,
  SCAN_EXTENSIONS,
  SKIP_DIRS,
};
