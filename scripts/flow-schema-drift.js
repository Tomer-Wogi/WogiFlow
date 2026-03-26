#!/usr/bin/env node

/**
 * Wogi Flow — Schema Drift Quality Gate
 *
 * Detects when schema fields are removed/renamed but consumers still reference
 * the old field names. Agnostic core + specific parsers for known ORMs.
 *
 * Triggers on ALL tasks that touch schema files (not just refactors).
 * Auto-fixes consumers when the change was explicitly requested in the task spec;
 * flags for user decision when the change is a side-effect.
 *
 * Cross-repo aware: can scan workspace member repos for drift.
 *
 * Usage:
 *   node scripts/flow-schema-drift.js [changed-files...]
 *   node scripts/flow-schema-drift.js --task wf-XXXXXXXX
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ============================================================
// Constants
// ============================================================

let PROJECT_ROOT;
try {
  PROJECT_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
} catch (_err) {
  PROJECT_ROOT = process.cwd();
}

const SCHEMA_MAP_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'schema-map.md');
const SCHEMA_INDEX_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'schema-index.json');
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow', 'config.json');

// Convention-based schema file patterns (when no schema-map exists)
const SCHEMA_CONVENTIONS = [
  /\.prisma$/,
  /\.entity\.(ts|js)$/,
  /\.model\.(ts|js)$/,
  /\.schema\.(ts|js)$/,
  /models\/[^/]+\.(ts|js)$/,
  /entities\/[^/]+\.(ts|js)$/,
  /schemas\/[^/]+\.(ts|js)$/,
];

// Directories to exclude from consumer scanning
const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', '.next', '.workflow', '.git', 'coverage'];

// ============================================================
// Schema File Detection (C1 — Layer 1)
// ============================================================

/**
 * Get registered schema files from schema-map.md or schema-index.json.
 * @returns {string[]} absolute paths to known schema files
 */
function getRegisteredSchemaFiles() {
  const files = [];

  // Try schema-index.json first (structured data)
  try {
    if (fs.existsSync(SCHEMA_INDEX_PATH)) {
      const index = JSON.parse(fs.readFileSync(SCHEMA_INDEX_PATH, 'utf-8'));
      if (index.models) {
        for (const model of index.models) {
          if (model.file) {
            const abs = path.resolve(PROJECT_ROOT, model.file);
            if (!files.includes(abs)) files.push(abs);
          }
        }
      }
    }
  } catch (_err) {
    // Fall through to schema-map.md
  }

  // Try schema-map.md (parse table rows for file paths)
  try {
    if (files.length === 0 && fs.existsSync(SCHEMA_MAP_PATH)) {
      const content = fs.readFileSync(SCHEMA_MAP_PATH, 'utf-8');
      const filePattern = /`([^`]+\.(prisma|entity\.\w+|model\.\w+|schema\.\w+))`/g;
      let match;
      while ((match = filePattern.exec(content)) !== null) {
        const abs = path.resolve(PROJECT_ROOT, match[1]);
        if (!files.includes(abs)) files.push(abs);
      }
    }
  } catch (_err) {
    // Non-critical
  }

  return files;
}

/**
 * Detect schema files among changed files.
 * Uses registry-first approach, then convention fallback.
 *
 * @param {string[]} changedFiles — paths (relative or absolute)
 * @returns {string[]} schema file paths found in the changed set
 */
function detectSchemaFiles(changedFiles) {
  const registered = new Set(getRegisteredSchemaFiles().map(f => path.resolve(PROJECT_ROOT, f)));
  const schemaFiles = [];

  for (const file of changedFiles) {
    const abs = path.resolve(PROJECT_ROOT, file);

    // Registry match
    if (registered.has(abs)) {
      schemaFiles.push(file);
      continue;
    }

    // Convention match
    const rel = path.relative(PROJECT_ROOT, abs);
    if (SCHEMA_CONVENTIONS.some(pattern => pattern.test(rel))) {
      schemaFiles.push(file);
      continue;
    }

    // Agnostic: check if file is in schema-index by model file reference
    // (handles cases where schema-map lists the file differently)
  }

  return schemaFiles;
}

// ============================================================
// Field Change Parsing (C1 — Layer 2)
// ============================================================

/**
 * Parse removed/added lines from git diff for a file.
 * @param {string} filePath
 * @returns {{ removed: string[], added: string[] }}
 */
function getDiffLines(filePath) {
  const removed = [];
  const added = [];

  try {
    const diff = execFileSync('git', [
      'diff', '--unified=0', '--', filePath
    ], { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    let stagedDiff = '';
    try {
      stagedDiff = execFileSync('git', [
        'diff', '--cached', '--unified=0', '--', filePath
      ], { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_err) { /* no staged changes */ }

    const combined = diff + '\n' + stagedDiff;
    for (const line of combined.split('\n')) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        removed.push(line.substring(1).trim());
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        added.push(line.substring(1).trim());
      }
    }
  } catch (_err) {
    // File may not have changes
  }

  return { removed, added };
}

// ---- Specific Parsers ----

/**
 * Extract field name from a Prisma schema line.
 * Prisma format: `  fieldName  Type  @decorators`
 * @param {string} line
 * @returns {string|null} field name or null
 */
function parsePrismaField(line) {
  // Skip model/enum declarations, comments, decorators, closing braces
  if (/^\s*(model|enum|type|generator|datasource)\s/.test(line)) return null;
  if (/^\s*(\/\/|@@|})/.test(line)) return null;
  if (!line.trim()) return null;

  // Prisma field: `  fieldName  Type  @optional`
  const match = line.match(/^\s+(\w+)\s+\w/);
  return match ? match[1] : null;
}

/**
 * Extract field name from a TypeORM/NestJS entity line.
 * Format: `@Column() fieldName: Type` or just `fieldName: Type`
 * @param {string} line
 * @returns {string|null}
 */
function parseEntityField(line) {
  // Skip decorators, imports, class declarations
  if (/^\s*(@|import |export |class |\/\/|\/\*|\*|})/.test(line)) return null;

  // Match: `fieldName: Type` or `fieldName?: Type` or `fieldName!: Type`
  const match = line.match(/^\s+(\w+)[?!]?\s*:\s*\w/);
  return match ? match[1] : null;
}

/**
 * Extract field name from a Mongoose schema line.
 * Format: `fieldName: { type: ... }` or `fieldName: Type`
 * @param {string} line
 * @returns {string|null}
 */
function parseMongooseField(line) {
  if (/^\s*(\/\/|\/\*|\*|import |export |const |let |var |})/.test(line)) return null;

  // Match: `fieldName: {` or `fieldName: Schema.Types.` or `fieldName: String`
  const match = line.match(/^\s+(\w+)\s*:\s*[{\[A-Z]/);
  return match ? match[1] : null;
}

/**
 * Extract field name from a TypeScript interface/type line.
 * Format: `fieldName: Type;` or `fieldName?: Type;`
 * @param {string} line
 * @returns {string|null}
 */
function parseTsInterfaceField(line) {
  if (/^\s*(\/\/|\/\*|\*|import |export |interface |type |})/.test(line)) return null;

  const match = line.match(/^\s+(\w+)[?!]?\s*:\s*.+[;,]?\s*$/);
  return match ? match[1] : null;
}

/**
 * Extract field name from a SQL column definition.
 * Format: `column_name TYPE ...`
 * @param {string} line
 * @returns {string|null}
 */
function parseSqlColumn(line) {
  if (/^\s*(CREATE|ALTER|DROP|INSERT|SELECT|UPDATE|DELETE|--|\/\*|\*|CONSTRAINT|INDEX|PRIMARY|FOREIGN|UNIQUE|CHECK|\))/i.test(line)) return null;

  const match = line.match(/^\s+"?(\w+)"?\s+(VARCHAR|INT|TEXT|BOOLEAN|TIMESTAMP|DATE|FLOAT|DECIMAL|BIGINT|SERIAL|UUID|JSONB?|BYTEA|SMALLINT|NUMERIC)/i);
  return match ? match[1] : null;
}

/**
 * Agnostic field extraction — catches property-like patterns in any file.
 * @param {string} line
 * @returns {string|null}
 */
function parseAgnosticField(line) {
  if (/^\s*(\/\/|\/\*|\*|import |export |class |function |const |let |var |return |if |})/.test(line)) return null;
  if (!line.trim()) return null;

  // Match property definitions: `  name: Type` or `  name?: Type` or `  name: value,`
  const match = line.match(/^\s{2,}(\w{2,})[?!]?\s*:\s*\S/);
  if (match) {
    const name = match[1];
    // Filter noise: common keywords that aren't field names
    const noise = new Set(['type', 'default', 'required', 'unique', 'index', 'ref', 'enum', 'validate', 'get', 'set', 'value', 'key', 'label', 'description', 'constructor', 'prototype']);
    if (noise.has(name.toLowerCase())) return null;
    return name;
  }
  return null;
}

/**
 * Select the best parser for a file based on extension and content heuristics.
 * @param {string} filePath
 * @returns {Function} parser function
 */
function selectParser(filePath) {
  const ext = path.extname(filePath);
  const basename = path.basename(filePath);

  if (ext === '.prisma') return parsePrismaField;
  if (/\.entity\.(ts|js)$/.test(basename)) return parseEntityField;
  if (/\.schema\.(ts|js)$/.test(basename)) return parseMongooseField;
  if (/\.model\.(ts|js)$/.test(basename)) return parseEntityField;  // TypeORM-style
  if (/\.sql$/.test(ext)) return parseSqlColumn;
  if (ext === '.ts' || ext === '.tsx') return parseTsInterfaceField;
  if (ext === '.js' || ext === '.jsx') return parseMongooseField;  // Mongoose-style fallback

  return parseAgnosticField;
}

/**
 * Parse field changes from a schema file's git diff.
 *
 * @param {string} filePath — schema file path
 * @returns {Array<{ file: string, field: string, action: 'removed'|'renamed', oldName: string, newName?: string }>}
 */
function parseFieldChanges(filePath) {
  const { removed, added } = getDiffLines(filePath);
  const parser = selectParser(filePath);
  const agnostic = parseAgnosticField;

  // Extract fields from removed lines
  const removedFields = new Set();
  for (const line of removed) {
    const field = parser(line) ?? agnostic(line);
    if (field) removedFields.add(field);
  }

  // Extract fields from added lines
  const addedFields = new Set();
  for (const line of added) {
    const field = parser(line) ?? agnostic(line);
    if (field) addedFields.add(field);
  }

  const entries = [];

  for (const field of removedFields) {
    if (addedFields.has(field)) {
      // Field appears in both removed and added — not actually removed (just modified)
      continue;
    }

    // Check for rename: was a similar field added?
    const rename = detectRename(field, addedFields);
    if (rename) {
      entries.push({
        file: filePath,
        field,
        action: 'renamed',
        oldName: field,
        newName: rename
      });
    } else {
      entries.push({
        file: filePath,
        field,
        action: 'removed',
        oldName: field
      });
    }
  }

  return entries;
}

/**
 * Heuristic rename detection: check if a removed field name is similar to an added one.
 * @param {string} removedField
 * @param {Set<string>} addedFields
 * @returns {string|null} new name if rename detected
 */
function detectRename(removedField, addedFields) {
  const lower = removedField.toLowerCase();

  for (const added of addedFields) {
    const addedLower = added.toLowerCase();

    // Case change: emailVerified → emailverified (same when lowered)
    if (lower === addedLower && removedField !== added) return added;

    // Prefix change: emailVerified → isEmailVerified
    if (addedLower.includes(lower) || lower.includes(addedLower)) return added;

    // Levenshtein-like: similar enough (> 60% shared characters for short names)
    if (removedField.length >= 4 && added.length >= 4) {
      const shared = [...lower].filter(c => addedLower.includes(c)).length;
      const similarity = shared / Math.max(lower.length, addedLower.length);
      if (similarity > 0.7) return added;
    }
  }

  return null;
}

// ============================================================
// Consumer Scanning (C2)
// ============================================================

/**
 * Find all files that reference a field name.
 *
 * @param {string} fieldName — the field to search for
 * @param {string} excludeFile — schema file to exclude from results
 * @param {string} [searchRoot] — directory to search (default: PROJECT_ROOT)
 * @returns {Array<{ file: string, line: number, context: string, matchType: string }>}
 */
function findFieldReferences(fieldName, excludeFile, searchRoot) {
  const root = searchRoot ?? PROJECT_ROOT;
  const refs = [];

  // Skip very short field names that would produce too many false positives
  if (fieldName.length < 3) return refs;

  try {
    const excludeArgs = EXCLUDE_DIRS.flatMap(d => ['--exclude-dir', d]);
    const result = execFileSync('grep', [
      '-rn',
      '--include=*.ts', '--include=*.tsx',
      '--include=*.js', '--include=*.jsx',
      '--include=*.vue', '--include=*.svelte',
      ...excludeArgs,
      '-w',
      fieldName,
      '.'
    ], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const filePath = line.substring(0, colonIdx).replace(/^\.\//, '');

      // Skip the schema file itself
      const absFile = path.resolve(root, filePath);
      const absExclude = path.resolve(root, excludeFile);
      if (absFile === absExclude) continue;

      // Skip schema-adjacent files (other model/entity files)
      if (SCHEMA_CONVENTIONS.some(p => p.test(filePath))) continue;

      const secondColon = line.indexOf(':', colonIdx + 1);
      const lineNum = secondColon > colonIdx ? parseInt(line.substring(colonIdx + 1, secondColon), 10) : 0;
      const context = secondColon > colonIdx ? line.substring(secondColon + 1).trim() : '';

      // Classify match type
      let matchType = 'reference';
      if (context.includes(`.${fieldName}`)) matchType = 'property-access';
      else if (context.includes(`{ ${fieldName}`) || context.includes(`{${fieldName}`)) matchType = 'destructuring';
      else if (context.includes(`${fieldName}:`)) matchType = 'object-key';
      else if (context.includes(`'${fieldName}'`) || context.includes(`"${fieldName}"`)) matchType = 'string-literal';

      refs.push({ file: filePath, line: lineNum, context: context.substring(0, 120), matchType });
    }
  } catch (_err) {
    // grep returns exit code 1 when no matches — that's fine
  }

  return refs;
}

/**
 * Scan all consumers for drift entries.
 *
 * @param {Array} driftEntries — from parseFieldChanges()
 * @param {string} [searchRoot] — search root (default: PROJECT_ROOT)
 * @returns {Array<{ field: string, action: string, oldName: string, newName?: string, consumers: Array }>}
 */
function scanConsumers(driftEntries, searchRoot) {
  const results = [];

  for (const entry of driftEntries) {
    const consumers = findFieldReferences(entry.oldName, entry.file, searchRoot);
    if (consumers.length > 0) {
      results.push({ ...entry, consumers });
    }
  }

  return results;
}

// ============================================================
// Intent Classification (C4)
// ============================================================

/**
 * Classify whether a field change was explicitly requested by the user
 * or is a side-effect of the task.
 *
 * @param {Array} driftWithConsumers — from scanConsumers()
 * @param {string|null} specContent — task spec content (or null)
 * @returns {Array} same entries with `intent: 'auto-fix'|'flag'` added
 */
function classifyIntent(driftWithConsumers, specContent) {
  const specLower = (specContent ?? '').toLowerCase();

  return driftWithConsumers.map(entry => {
    const oldLower = entry.oldName.toLowerCase();
    const newLower = (entry.newName ?? '').toLowerCase();

    // Check if the field change is mentioned in the spec
    const mentionsOld = specLower.includes(oldLower);
    const mentionsNew = newLower && specLower.includes(newLower);
    const mentionsRename = specLower.includes('rename') && (mentionsOld || mentionsNew);
    const mentionsRemove = (specLower.includes('remove') || specLower.includes('delete')) && mentionsOld;

    const isExplicit = mentionsRename || mentionsRemove || (mentionsOld && mentionsNew);

    return {
      ...entry,
      intent: isExplicit ? 'auto-fix' : 'flag'
    };
  });
}

// ============================================================
// Quality Gate (C3)
// ============================================================

/**
 * Run the schema drift quality gate on changed files.
 *
 * @param {string[]} changedFiles — files changed in this task
 * @param {Object} [opts]
 * @param {string} [opts.specContent] — task spec for intent classification
 * @param {string} [opts.searchRoot] — search root override
 * @returns {{ passed: boolean, blocked: boolean, schemaFiles: string[], driftEntries: Array, consumers: Array, violations: Array }}
 */
function runSchemaDriftGate(changedFiles, opts = {}) {
  // Check config
  let enabled = true;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      enabled = config.enforcement?.schemaDrift?.enabled ?? config.schemaDrift?.enabled ?? true;
    }
  } catch (_err) {
    // Default to enabled
  }

  if (!enabled) {
    return { passed: true, blocked: false, schemaFiles: [], driftEntries: [], consumers: [], violations: [], skipped: true };
  }

  // Step 1: Detect schema files in changed set
  const schemaFiles = detectSchemaFiles(changedFiles);
  if (schemaFiles.length === 0) {
    return { passed: true, blocked: false, schemaFiles: [], driftEntries: [], consumers: [], violations: [] };
  }

  // Step 2: Parse field changes
  const allDriftEntries = [];
  for (const file of schemaFiles) {
    const entries = parseFieldChanges(file);
    allDriftEntries.push(...entries);
  }

  if (allDriftEntries.length === 0) {
    return { passed: true, blocked: false, schemaFiles, driftEntries: [], consumers: [], violations: [] };
  }

  // Step 3: Scan consumers
  const consumersWithDrift = scanConsumers(allDriftEntries, opts.searchRoot);

  if (consumersWithDrift.length === 0) {
    return { passed: true, blocked: false, schemaFiles, driftEntries: allDriftEntries, consumers: [], violations: [] };
  }

  // Step 4: Classify intent
  const classified = classifyIntent(consumersWithDrift, opts.specContent ?? null);

  // Build violations in standard format (compatible with standards gate)
  const violations = [];
  for (const entry of classified) {
    for (const consumer of entry.consumers) {
      violations.push({
        type: 'schema-drift',
        severity: entry.action === 'removed' ? 'must-fix' : 'warning',
        file: consumer.file,
        line: consumer.line,
        rule: `Schema field '${entry.oldName}' was ${entry.action}${entry.newName ? ` to '${entry.newName}'` : ''} in ${entry.file}`,
        message: `Consumer still references '${entry.oldName}' (${consumer.matchType})`,
        context: consumer.context,
        intent: entry.intent,
        autoFixable: entry.intent === 'auto-fix'
      });
    }
  }

  const hasBlockers = violations.some(v => v.severity === 'must-fix' && v.intent !== 'auto-fix');

  return {
    passed: !hasBlockers,
    blocked: hasBlockers,
    schemaFiles,
    driftEntries: allDriftEntries,
    consumers: classified,
    violations
  };
}

// ============================================================
// Cross-Repo Scanning (C7)
// ============================================================

/**
 * Scan workspace member repos for drift in consumer code.
 *
 * @param {Array} driftEntries — from parseFieldChanges()
 * @param {string} workspaceRoot — workspace root path
 * @returns {Array<{ repo: string, field: string, consumers: Array }>}
 */
function scanCrossRepoConsumers(driftEntries, workspaceRoot) {
  const results = [];

  // Read workspace config
  let config;
  try {
    const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
    if (!fs.existsSync(configPath)) return results;
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_err) {
    return results;
  }

  if (!config.members) return results;

  // Scan each member repo (excluding the repo that made the change)
  const currentRepoName = path.basename(PROJECT_ROOT);
  for (const [name, member] of Object.entries(config.members)) {
    if (name === currentRepoName) continue;

    const memberPath = path.resolve(workspaceRoot, member.path ?? `./${name}`);

    // Path safety: ensure member is inside workspace
    if (!memberPath.startsWith(workspaceRoot + path.sep) && memberPath !== workspaceRoot) continue;

    if (!fs.existsSync(memberPath)) continue;

    for (const entry of driftEntries) {
      const consumers = findFieldReferences(entry.oldName, entry.file, memberPath);
      if (consumers.length > 0) {
        results.push({
          repo: name,
          field: entry.oldName,
          action: entry.action,
          newName: entry.newName,
          consumers: consumers.map(c => ({ ...c, file: `${name}/${c.file}` }))
        });
      }
    }
  }

  return results;
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format drift gate results for display.
 * @param {Object} result — from runSchemaDriftGate()
 * @returns {string}
 */
function formatResult(result) {
  if (result.skipped) return '⊘ Schema drift gate: disabled';
  if (result.schemaFiles.length === 0) return '✓ Schema drift gate: no schema files changed';
  if (result.driftEntries.length === 0) return '✓ Schema drift gate: no fields removed/renamed';
  if (result.violations.length === 0) return '✓ Schema drift gate: no consumer drift detected';

  const lines = ['', '━━━ SCHEMA DRIFT DETECTED ━━━', ''];

  // Group by drift entry
  for (const entry of result.consumers) {
    const action = entry.action === 'renamed'
      ? `renamed to '${entry.newName}'`
      : 'removed';
    const intent = entry.intent === 'auto-fix' ? ' [AUTO-FIX]' : ' [NEEDS REVIEW]';

    lines.push(`  ${entry.action === 'removed' ? '🔴' : '🟡'} ${entry.file}: field '${entry.oldName}' ${action}${intent}`);
    lines.push(`     Consumers (${entry.consumers.length}):`);
    for (const c of entry.consumers.slice(0, 10)) {
      lines.push(`       → ${c.file}:${c.line} (${c.matchType})`);
    }
    if (entry.consumers.length > 10) {
      lines.push(`       ... and ${entry.consumers.length - 10} more`);
    }
    lines.push('');
  }

  const autoFix = result.violations.filter(v => v.intent === 'auto-fix').length;
  const needsReview = result.violations.filter(v => v.intent === 'flag').length;

  lines.push(`  Total: ${result.violations.length} drift references (${autoFix} auto-fixable, ${needsReview} need review)`);
  if (result.blocked) {
    lines.push('');
    lines.push('  ⚠️  Task BLOCKED — fix consumer references before completing');
  }
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  let changedFiles = [];
  let specContent = null;

  if (args.includes('--task')) {
    const taskIdx = args.indexOf('--task');
    const taskId = args[taskIdx + 1];
    if (taskId) {
      // Read spec for intent classification
      const specPaths = [
        path.join(PROJECT_ROOT, '.workflow', 'specs', `${taskId}.md`),
        path.join(PROJECT_ROOT, '.workflow', 'changes', `${taskId}.md`)
      ];
      for (const sp of specPaths) {
        try {
          if (fs.existsSync(sp)) {
            specContent = fs.readFileSync(sp, 'utf-8');
            break;
          }
        } catch (_err) { /* continue */ }
      }

      // Get changed files from git
      try {
        const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
          cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        });
        const staged = execFileSync('git', ['diff', '--name-only', '--staged'], {
          cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        });
        changedFiles = [...new Set([...diff.trim().split('\n'), ...staged.trim().split('\n')].filter(Boolean))];
      } catch (_err) {
        console.error('Cannot read git diff');
        process.exit(1);
      }
    }
  } else {
    changedFiles = args.filter(a => !a.startsWith('--'));
  }

  if (changedFiles.length === 0) {
    // Default: get all changed files
    try {
      const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      const staged = execFileSync('git', ['diff', '--name-only', '--staged'], {
        cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      changedFiles = [...new Set([...diff.trim().split('\n'), ...staged.trim().split('\n')].filter(Boolean))];
    } catch (_err) {
      console.error('Cannot read git diff');
      process.exit(1);
    }
  }

  const result = runSchemaDriftGate(changedFiles, { specContent });
  console.log(formatResult(result));

  if (result.blocked) {
    console.log(JSON.stringify({ blocked: true, violations: result.violations.length }, null, 2));
    process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Detection
  detectSchemaFiles,
  getRegisteredSchemaFiles,
  parseFieldChanges,
  getDiffLines,

  // Parsers
  parsePrismaField,
  parseEntityField,
  parseMongooseField,
  parseTsInterfaceField,
  parseSqlColumn,
  parseAgnosticField,
  selectParser,
  detectRename,

  // Scanning
  findFieldReferences,
  scanConsumers,
  scanCrossRepoConsumers,

  // Classification
  classifyIntent,

  // Gate
  runSchemaDriftGate,

  // Display
  formatResult,

  // Constants
  SCHEMA_CONVENTIONS,
  EXCLUDE_DIRS
};
