#!/usr/bin/env node

/**
 * Wogi Flow — Aider-style Repo Map (wf-f3707d2f / C1).
 *
 * Generates a compact, task-aware repo map that fits in a bounded token
 * budget. Intended for injection at Step 1 Load Context (and refresh at each
 * turn during exploring + coding phases) so the AI sees:
 *   - TOUCHED  — files the current task modifies (summary + top-level symbols)
 *   - ADJACENT — files that import or are imported by the touched set
 *   - SHAPE    — compressed tree of the rest of the project (names only)
 *
 * This complements the existing registry maps (app-map, function-map, api-map)
 * which are manually curated; the repo map is cheap, disposable, and always-fresh.
 *
 * Story: wf-f3707d2f (C1)
 * Epic: wf-34290000
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { PATHS } = require('./flow-paths');
const { getConfig } = require('./flow-config-loader');
const { safeJsonParse } = require('./flow-io');

const DEFAULT_BUDGET_BYTES = 16 * 1024; // ~4k tokens
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.workflow', '.worktrees', 'out']);
const CODE_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs']);
const DOC_EXTS = new Set(['.md']);
const STATE_EXTS = new Set(['.json', '.yaml', '.yml', '.toml']);

function _getRepoMapConfig() {
  const cfg = getConfig();
  return cfg.repoMap || {};
}

/**
 * Resolve changed-files list for a task.
 * Priority: explicit opts.changedFiles → durable-session checkpoint → `git diff --name-only`.
 *
 * @param {object} opts
 * @returns {string[]}
 */
function resolveChangedFiles(opts = {}) {
  if (Array.isArray(opts.changedFiles)) return opts.changedFiles;

  // Try task-checkpoint.json
  // wf-3c968989: safeJsonParse adds DANGEROUS_KEYS protection. Returns null
  // (the explicit default) on missing/corrupt/array — preserves the
  // original silent-fallthrough contract via the null check below.
  const checkpointPath = path.join(PATHS.state, 'task-checkpoint.json');
  if (fs.existsSync(checkpointPath)) {
    const cp = safeJsonParse(checkpointPath, null);
    if (cp && Array.isArray(cp.changedFiles) && cp.changedFiles.length > 0) {
      return cp.changedFiles;
    }
  }

  // Git diff
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = out.split('\n').filter(Boolean);
    if (files.length > 0) return files;
  } catch { /* no git */ }

  try {
    const out = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * Extract top-level symbol signatures from a file. Lightweight — regex only,
 * no AST parser. Captures: function decls, class decls, const declarations,
 * module.exports / export default, named exports.
 *
 * @param {string} filePath - absolute path
 * @returns {{ symbols: string[], firstLine: string, loc: number }}
 */
function extractSymbols(filePath) {
  const out = { symbols: [], firstLine: '', loc: 0 };
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch { return out; }

  const lines = content.split('\n');
  out.loc = lines.length;
  // First docblock / comment line
  for (const line of lines.slice(0, 5)) {
    const t = line.trim().replace(/^[*/\s]+|[*/\s]+$/g, '');
    if (t.length > 4 && !/^@|^#!\//.test(t)) { out.firstLine = t.slice(0, 100); break; }
  }

  const patterns = [
    /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,
    /^(?:export\s+(?:default\s+)?)?class\s+(\w+)/gm,
    /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=/gm, // SCREAMING_SNAKE constants
    /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/gm,
  ];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      const sig = m[2] !== undefined ? `${m[1]}(${m[2].length > 40 ? '...' : m[2]})` : m[1];
      if (!out.symbols.includes(sig)) out.symbols.push(sig);
      if (out.symbols.length >= 12) break;
    }
  }

  // module.exports = {...} named-key extraction
  const mexRe = /module\.exports\s*=\s*\{([^}]+)\}/;
  const mex = content.match(mexRe);
  if (mex) {
    const keys = mex[1].split(',').map((s) => s.trim().split(/[:=\s]/)[0]).filter(Boolean);
    for (const k of keys.slice(0, 8)) if (/^\w+$/.test(k) && !out.symbols.some((s) => s.startsWith(k))) out.symbols.push(k);
  }

  return out;
}

/**
 * Find files that import or are imported by the given seed files.
 * Strict depth=1 (direct neighbors only).
 *
 * @param {string[]} seedFiles - paths relative to repo root
 * @param {string[]} allCodeFiles - paths to consider
 * @returns {string[]} paths of adjacent files
 */
function findAdjacent(seedFiles, allCodeFiles) {
  const seedSet = new Set(seedFiles);
  const adjacent = new Set();
  const seedBasenames = seedFiles.map((f) => path.basename(f, path.extname(f)));

  for (const file of allCodeFiles) {
    if (seedSet.has(file)) continue;
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    // File imports something FROM the seed set
    for (const base of seedBasenames) {
      const re = new RegExp(`(?:require|import|from)\\s*\\(?[\`'"][^\`'"]*?${base}[^\`'"]*?[\`'"]\\)?`);
      if (re.test(content)) { adjacent.add(file); break; }
    }
  }

  // Reverse: what do seed files import?
  for (const seed of seedFiles) {
    let content;
    try { content = fs.readFileSync(seed, 'utf8'); } catch { continue; }
    const importRe = /(?:require|from)\s*\(?[`'"]([^`'"]+)[`'"]\)?/g;
    for (const m of content.matchAll(importRe)) {
      const resolved = _resolveImport(seed, m[1], allCodeFiles);
      if (resolved && !seedSet.has(resolved)) adjacent.add(resolved);
    }
  }

  return [...adjacent];
}

function _resolveImport(fromFile, spec, allFiles) {
  if (!spec.startsWith('.')) return null; // external package
  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, spec);
  for (const ext of ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '/index.js', '/index.ts']) {
    const candidate = base + ext;
    const rel = path.relative(process.cwd(), candidate);
    if (allFiles.includes(rel)) return rel;
  }
  return null;
}

/**
 * Walk the repo collecting code file paths (relative to cwd).
 * @returns {string[]}
 */
function collectCodeFiles() {
  const root = process.cwd();
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.claude' && e.name !== '.workflow') continue;
      if (IGNORED_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && CODE_EXTS.has(path.extname(e.name))) out.push(path.relative(root, p));
    }
  }
  walk(root);
  return out;
}

/**
 * Generate a compact shape-of-repo summary (file count per top-level dir).
 */
function generateShape(allCodeFiles) {
  const buckets = {};
  for (const f of allCodeFiles) {
    const top = f.split('/')[0];
    buckets[top] = (buckets[top] || 0) + 1;
  }
  return Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${k}/ (${v})`)
    .join(', ');
}

/**
 * Generate the repo map markdown.
 *
 * @param {object} [opts]
 * @param {string} [opts.taskId]
 * @param {string[]} [opts.changedFiles]
 * @param {number} [opts.budgetBytes] - max output size
 * @param {boolean} [opts.includeShape=true]
 * @returns {{ markdown: string, stats: object }}
 */
function generateRepoMap(opts = {}) {
  const cfg = _getRepoMapConfig();
  if (cfg.enabled === false) {
    return { markdown: '', stats: { skipped: true, reason: 'config-disabled' } };
  }

  const budget = opts.budgetBytes ?? cfg.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const includeShape = opts.includeShape !== false;
  const changed = resolveChangedFiles(opts).filter((f) => CODE_EXTS.has(path.extname(f)) || DOC_EXTS.has(path.extname(f)) || STATE_EXTS.has(path.extname(f)));

  const allCode = collectCodeFiles();
  const touched = changed.filter((f) => fs.existsSync(f));
  const adjacent = touched.length > 0 ? findAdjacent(touched, allCode).slice(0, 20) : [];

  const lines = [];
  lines.push(`# Repo Map${opts.taskId ? ' — ' + opts.taskId : ''}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()} | files-scanned: ${allCode.length} | touched: ${touched.length} | adjacent: ${adjacent.length}`);
  lines.push('');

  if (touched.length > 0) {
    lines.push('## TOUCHED');
    for (const f of touched.slice(0, 20)) {
      const abs = path.resolve(f);
      const info = extractSymbols(abs);
      lines.push(`### ${f}`);
      if (info.firstLine) lines.push(`_${info.firstLine}_`);
      lines.push(`- LOC: ${info.loc}`);
      if (info.symbols.length > 0) lines.push(`- Symbols: \`${info.symbols.slice(0, 10).join('`, `')}\``);
      lines.push('');
    }
  } else {
    lines.push('## TOUCHED\n_(no changed code files detected)_\n');
  }

  if (adjacent.length > 0) {
    lines.push('## ADJACENT (depth=1 imports)');
    for (const f of adjacent) {
      const info = extractSymbols(path.resolve(f));
      const sigs = info.symbols.slice(0, 5).join(', ');
      lines.push(`- ${f}${sigs ? ` — \`${sigs}\`` : ''}`);
    }
    lines.push('');
  }

  if (includeShape) {
    lines.push('## SHAPE');
    lines.push(generateShape(allCode));
    lines.push('');
  }

  let markdown = lines.join('\n');
  const wasTruncated = markdown.length > budget;
  if (wasTruncated) {
    markdown = markdown.slice(0, budget - 40) + '\n\n_(repo map truncated at budget)_\n';
  }

  return {
    markdown,
    stats: {
      touched: touched.length,
      adjacent: adjacent.length,
      filesScanned: allCode.length,
      bytes: markdown.length,
      budget,
      truncated: wasTruncated,
    },
  };
}

module.exports = {
  generateRepoMap,
  resolveChangedFiles,
  extractSymbols,
  findAdjacent,
  collectCodeFiles,
  DEFAULT_BUDGET_BYTES,
};

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'generate' || !cmd) {
    const taskId = args.find((a) => a.startsWith('--task='))?.split('=')[1];
    const budgetArg = args.find((a) => a.startsWith('--budget='))?.split('=')[1];
    const result = generateRepoMap({ taskId, budgetBytes: budgetArg ? parseInt(budgetArg, 10) : undefined });
    process.stdout.write(result.markdown);
    if (args.includes('--stats')) {
      process.stderr.write('\n\nStats: ' + JSON.stringify(result.stats) + '\n');
    }
  } else {
    console.error('usage: flow-repo-map generate [--task=<id>] [--budget=<bytes>] [--stats]');
    process.exit(2);
  }
}
