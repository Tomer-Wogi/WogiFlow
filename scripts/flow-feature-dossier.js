#!/usr/bin/env node

/**
 * Wogi Flow - Feature Dossier System
 *
 * Per-feature canonical knowledge docs with mechanical auto-injection.
 *
 * Problem solved (from the 2026-04-24 workspace failure catalog):
 *   - Feature/workflow knowledge gets lost between sessions
 *   - Claude doesn't proactively fetch context — even when told to look, it
 *     grabs one thing and ignores the rest
 *   - Owner corrections ("remove the contact block") stop being remembered
 *   - Small stuff has maps (app-map, function-map); multi-part logic has nothing
 *
 * How it works:
 *   - Each user-facing feature has a dossier at <dossierDir>/<slug>.md
 *   - Dossiers capture: canonical summary, match patterns, contracts,
 *     rejected alternatives, removed elements, known bugs, append-only log
 *   - .workflow/dossiers/index.json maps {route, file, component, keyword}
 *     patterns to dossier slugs
 *   - At phase transitions, matchFeatures() scans the active task for
 *     touched features and injects their canonical headers into phase context
 *   - validateSpecAgainstDossier() greps spec text for contradictions with
 *     canonical claims (Rejected Alternatives, Removed Elements)
 *   - detectDrift() greps the codebase for things dossier claims were
 *     removed (the contact-person case)
 *
 * Workspace-mode path resolution:
 *   - Cross-repo features: WOGI_WORKSPACE_ROOT/.workspace/dossiers/
 *   - Per-repo features: <repo>/.workflow/dossiers/
 *   - At match time, both roots are scanned; workspace dossiers shadow per-repo
 *     on slug collision (workspace is the shared truth).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { PATHS, safeJsonParse } = require('./flow-utils');
const { globToRegex: _gtr } = require('./flow-glob');
// Local convenience: case-insensitive glob (this module's historical default)
const globToRegex = (pat) => _gtr(pat, 'i');

const DOSSIER_DIRNAME = 'dossiers';
const INDEX_FILENAME = 'index.json';

const RESERVED_SLUGS = new Set(['_template', '_logic-rules', 'README', 'index']);

function getDossierRoots() {
  const roots = [];
  if (process.env.WOGI_WORKSPACE_ROOT) {
    const wsRoot = path.join(process.env.WOGI_WORKSPACE_ROOT, '.workspace', DOSSIER_DIRNAME);
    roots.push({ kind: 'workspace', dir: wsRoot });
  }
  roots.push({ kind: 'repo', dir: path.join(PATHS.workflow, DOSSIER_DIRNAME) });
  return roots;
}

function getPrimaryDossierDir() {
  return path.join(PATHS.workflow, DOSSIER_DIRNAME);
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_err) { /* noop */ }
}

function loadIndex() {
  const merged = { patterns: [], slugs: {}, version: '1.0.0' };
  for (const root of getDossierRoots()) {
    const idxPath = path.join(root.dir, INDEX_FILENAME);
    if (!fs.existsSync(idxPath)) continue;
    const idx = safeJsonParse(idxPath, null);
    if (!idx) continue;
    if (Array.isArray(idx.patterns)) {
      for (const p of idx.patterns) merged.patterns.push({ ...p, _root: root.kind });
    }
    if (idx.slugs && typeof idx.slugs === 'object') {
      for (const [slug, meta] of Object.entries(idx.slugs)) {
        if (!merged.slugs[slug] || root.kind === 'workspace') {
          merged.slugs[slug] = { ...meta, _root: root.kind };
        }
      }
    }
  }
  return merged;
}

function saveIndex(index, rootKind = 'repo') {
  const target = rootKind === 'workspace' && process.env.WOGI_WORKSPACE_ROOT
    ? path.join(process.env.WOGI_WORKSPACE_ROOT, '.workspace', DOSSIER_DIRNAME)
    : getPrimaryDossierDir();
  ensureDir(target);
  const idxPath = path.join(target, INDEX_FILENAME);
  const out = { version: index.version || '1.0.0', patterns: [], slugs: {} };
  for (const p of index.patterns || []) {
    const { _root: _ignored, ...rest } = p;
    out.patterns.push(rest);
  }
  for (const [slug, meta] of Object.entries(index.slugs || {})) {
    const { _root: _ignored, ...rest } = meta;
    out.slugs[slug] = rest;
  }
  out.lastUpdated = new Date().toISOString();
  fs.writeFileSync(idxPath, JSON.stringify(out, null, 2));
}

function resolveDossierPath(slug) {
  for (const root of getDossierRoots()) {
    const candidate = path.join(root.dir, `${slug}.md`);
    if (fs.existsSync(candidate)) return { path: candidate, root: root.kind };
  }
  return null;
}

function listFeatures() {
  const index = loadIndex();
  const slugs = new Set(Object.keys(index.slugs));
  for (const root of getDossierRoots()) {
    if (!fs.existsSync(root.dir)) continue;
    for (const f of fs.readdirSync(root.dir)) {
      if (!f.endsWith('.md')) continue;
      const slug = f.replace(/\.md$/, '');
      if (RESERVED_SLUGS.has(slug)) continue;
      slugs.add(slug);
    }
  }
  return Array.from(slugs).sort();
}

function parseDossier(raw) {
  const result = {
    slug: null, status: null, owners: [], created: null, title: null,
    sections: {}, rawContent: raw
  };
  const slugMatch = raw.match(/<!--\s*slug:\s*([^\s-]+[^>]*)-->/);
  if (slugMatch) result.slug = slugMatch[1].trim();
  const statusMatch = raw.match(/<!--\s*status:\s*([^>]+)-->/);
  if (statusMatch) result.status = statusMatch[1].trim();
  const ownersMatch = raw.match(/<!--\s*owners:\s*([^>]+)-->/);
  if (ownersMatch) result.owners = ownersMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  const createdMatch = raw.match(/<!--\s*created:\s*([^>]+)-->/);
  if (createdMatch) result.created = createdMatch[1].trim();
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  if (titleMatch) result.title = titleMatch[1].trim();

  const sectionRegex = /\n##\s+([^\n]+)\n([\s\S]*?)(?=\n##\s+|$)/g;
  let m;
  while ((m = sectionRegex.exec(raw)) !== null) {
    const name = m[1].trim();
    result.sections[name] = m[2].trim();
  }
  return result;
}

function loadDossier(slug) {
  const found = resolveDossierPath(slug);
  if (!found) return null;
  let raw;
  try { raw = fs.readFileSync(found.path, 'utf-8'); } catch (_err) { return null; }
  const parsed = parseDossier(raw);
  parsed.path = found.path;
  parsed.root = found.root;
  if (!parsed.slug) parsed.slug = slug;
  return parsed;
}

function normalize(s) {
  return String(s || '').toLowerCase();
}

/**
 * Match candidate features for a task.
 * Scans both the registered index.json patterns and every dossier's
 * "Match Patterns" section (patterns listed inline in the dossier itself).
 *
 * @param {Object} input
 * @param {string} [input.title]
 * @param {string} [input.description]
 * @param {string[]} [input.files]
 * @param {string[]} [input.keywords]
 * @returns {Array<{slug: string, score: number, reasons: string[]}>}
 */
function matchFeatures(input = {}) {
  const title = normalize(input.title);
  const description = normalize(input.description);
  const haystack = `${title}\n${description}`;
  const files = (input.files || []).map(f => f.toLowerCase());
  const extras = (input.keywords || []).map(normalize);

  const scores = {};
  const addScore = (slug, amount, reason) => {
    if (!slug) return;
    if (!scores[slug]) scores[slug] = { slug, score: 0, reasons: [] };
    scores[slug].score += amount;
    if (reason && !scores[slug].reasons.includes(reason)) {
      scores[slug].reasons.push(reason);
    }
  };

  const index = loadIndex();

  for (const entry of index.patterns || []) {
    if (!entry || !entry.slug) continue;
    const slug = entry.slug;
    if (entry.keyword && haystack.includes(normalize(entry.keyword))) {
      addScore(slug, 1, `keyword: ${entry.keyword}`);
    }
    if (entry.route && haystack.includes(normalize(entry.route))) {
      addScore(slug, 1.5, `route: ${entry.route}`);
    }
    if (entry.component && haystack.includes(normalize(entry.component))) {
      addScore(slug, 1.5, `component: ${entry.component}`);
    }
    if (entry.filePattern && files.length > 0) {
      const re = globToRegex(entry.filePattern);
      for (const f of files) {
        if (re.test(f)) {
          addScore(slug, 2, `file: ${entry.filePattern}`);
          break;
        }
      }
    }
    for (const kw of extras) {
      if (entry.keyword && kw === normalize(entry.keyword)) addScore(slug, 0.5, `kw-extra:${kw}`);
    }
  }

  for (const slug of listFeatures()) {
    const dossier = loadDossier(slug);
    if (!dossier) continue;
    const patternsSection = dossier.sections['Match Patterns'] || '';
    if (!patternsSection) continue;
    const lines = patternsSection.split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    for (const line of lines) {
      const kvMatch = line.match(/^-\s*([a-zA-Z-]+):\s*(.+)$/);
      if (!kvMatch) continue;
      const kind = kvMatch[1].toLowerCase();
      const value = kvMatch[2].trim();
      if (!value) continue;
      if (kind === 'keyword' && haystack.includes(normalize(value))) {
        addScore(slug, 1, `keyword: ${value}`);
      } else if (kind === 'route' && haystack.includes(normalize(value))) {
        addScore(slug, 1.5, `route: ${value}`);
      } else if (kind === 'component' && haystack.includes(normalize(value))) {
        addScore(slug, 1.5, `component: ${value}`);
      } else if ((kind === 'file' || kind === 'filepattern' || kind === 'file-pattern') && files.length > 0) {
        const re = globToRegex(value);
        for (const f of files) {
          if (re.test(f)) {
            addScore(slug, 2, `file: ${value}`);
            break;
          }
        }
      }
    }
  }

  return Object.values(scores).sort((a, b) => b.score - a.score);
}


function scaffoldDossier(slug, meta = {}) {
  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`Slug "${slug}" is reserved`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Slug "${slug}" must be kebab-case (lowercase + hyphens)`);
  }
  const existing = resolveDossierPath(slug);
  if (existing) {
    throw new Error(`Dossier already exists at ${existing.path}`);
  }
  const target = meta.root === 'workspace' && process.env.WOGI_WORKSPACE_ROOT
    ? path.join(process.env.WOGI_WORKSPACE_ROOT, '.workspace', DOSSIER_DIRNAME)
    : getPrimaryDossierDir();
  ensureDir(target);
  const now = new Date().toISOString().slice(0, 10);
  const title = meta.title || slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const owners = (meta.owners || []).join(', ') || 'unset';
  const patterns = (meta.patterns || []).map(p => `- ${p}`).join('\n') || '- keyword: <add match keyword>';
  const body = `# ${title}

<!-- slug: ${slug} -->
<!-- status: active -->
<!-- owners: ${owners} -->
<!-- created: ${now} -->

## Canonical Summary

${meta.summary || '<One-paragraph description of what this feature IS today. Replace any time the owner revises scope.>'}

## Match Patterns

<!-- Auto-match patterns for loadOnMatch. Any task whose title/description/files match will auto-load this dossier. -->
${patterns}

## Contracts

<!-- DTO/API contracts, state-flow expectations, cross-repo agreements. One bullet per contract. -->
- <describe contract>

## Logic Rules

<!-- Cross-cutting rules scoped to this feature. For rules that span features, use .workflow/dossiers/_logic-rules.md -->
- <describe rule>

## Rejected Alternatives

<!-- Owner-rejected designs, with date + reason. Any future spec that matches these is a contradiction and will be blocked at spec phase. -->
- <date>: <alternative name> → REJECTED, reason: <why>

## Removed Elements

<!-- Things the owner told us to remove. The drift detector greps the codebase for these — if they reappear, you see drift. -->
- <date>: <element> → removed, reason: <why>, enforcement-grep: \`<regex>\`

## Known Bugs / Tech Debt

<!-- Active bugs or deferred fixes. Link to task IDs. -->
- <describe bug> — task: wf-xxxxxxxx

## Change Log

<!-- Append-only. One row per task that touched this feature. Populated by appendEvent(). -->

| Date | Task ID | Event | Note |
|------|---------|-------|------|
`;
  const outPath = path.join(target, `${slug}.md`);
  fs.writeFileSync(outPath, body);

  const index = loadIndex();
  if (!index.slugs[slug]) {
    index.slugs[slug] = { title, created: now, owners: meta.owners || [] };
    saveIndex(index, meta.root === 'workspace' ? 'workspace' : 'repo');
  }
  return outPath;
}

function appendEvent(slug, event = {}) {
  const dossier = loadDossier(slug);
  if (!dossier) throw new Error(`Dossier not found: ${slug}`);
  const date = event.date || new Date().toISOString().slice(0, 10);
  const taskId = event.taskId || '-';
  const type = event.type || 'touched';
  const note = (event.note || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const row = `| ${date} | ${taskId} | ${type} | ${note} |\n`;

  let raw = fs.readFileSync(dossier.path, 'utf-8');
  const header = '| Date | Task ID | Event | Note |';
  const sep = '|------|---------|-------|------|';
  const idx = raw.indexOf(sep);
  if (idx === -1) {
    raw = raw.trimEnd() + `\n\n${header}\n${sep}\n${row}`;
  } else {
    const insertAt = raw.indexOf('\n', idx) + 1;
    raw = raw.slice(0, insertAt) + row + raw.slice(insertAt);
  }
  fs.writeFileSync(dossier.path, raw);
  return { dossierPath: dossier.path, row: row.trim() };
}

/**
 * Auto-append a Change Log row to every dossier matching a completed task.
 * Called by flow-done.js after a task moves to recentlyCompleted.
 * Fail-safe: never throws — returns {touched:[], skipped?, error?} on any failure.
 * Guards: duplicate-row check (by taskId) and per-file lockfile to prevent
 * concurrent /wogi-done corruption.
 */
function autoTouchFromTask(taskMeta = {}) {
  try {
    let config = {};
    try {
      const { getConfig } = require('./flow-utils');
      config = getConfig() || {};
    } catch (_err) { /* fail-open */ }

    const fd = config.featureDossier || {};
    if (fd.enabled === false) return { touched: [], skipped: 'dossier-disabled' };
    if (fd.autoTouchOnDone === false) return { touched: [], skipped: 'auto-touch-disabled' };
    const threshold = fd.autoMatchConfidence ?? 1;

    const matches = matchFeatures({
      title: taskMeta.title || '',
      description: taskMeta.description || '',
      files: taskMeta.files || []
    });
    const qualifying = matches.filter(m => m.score >= threshold);
    if (qualifying.length === 0) return { touched: [], skipped: 'no-match' };

    const rawNote = String(taskMeta.title || '').trim();
    const note = rawNote.length > 80 ? rawNote.slice(0, 77) + '...' : rawNote;
    const taskId = taskMeta.taskId || '-';
    const event = {
      taskId,
      type: taskMeta.type || 'feat',
      note,
      date: taskMeta.date
    };

    const touched = [];
    const skipped = [];
    for (const m of qualifying) {
      const dossier = loadDossier(m.slug);
      if (!dossier) continue;

      // Duplicate-row guard: skip if any existing row already references this taskId.
      if (taskId !== '-') {
        try {
          const existing = fs.readFileSync(dossier.path, 'utf-8');
          if (existing.includes(`| ${taskId} |`)) {
            skipped.push({ slug: m.slug, reason: 'already-touched' });
            continue;
          }
        } catch (_err) { /* fall through to attempt append */ }
      }

      // Per-file lockfile (O_EXCL atomic create) — prevents concurrent writers
      // from clobbering each other's rows on same-second task completions.
      const lockPath = `${dossier.path}.lock`;
      let lockFd;
      try {
        lockFd = fs.openSync(lockPath, 'wx');
      } catch (err) {
        if (err.code === 'EEXIST') {
          skipped.push({ slug: m.slug, reason: 'locked' });
          if (process.env.DEBUG) console.error(`[auto-touch] ${m.slug}: locked by another writer, skipping`);
          continue;
        }
        if (process.env.DEBUG) console.error(`[auto-touch] ${m.slug} lock: ${err.message}`);
        continue;
      }

      try {
        appendEvent(m.slug, event);
        touched.push({ slug: m.slug, score: m.score });
      } catch (err) {
        if (process.env.DEBUG) console.error(`[auto-touch] ${m.slug}: ${err.message}`);
      } finally {
        try { fs.closeSync(lockFd); } catch (_err) { /* noop */ }
        try { fs.unlinkSync(lockPath); } catch (_err) { /* noop */ }
      }
    }
    return { touched, skipped };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[auto-touch] error: ${err.message}`);
    return { touched: [], error: err.message };
  }
}

/**
 * Check a spec against a dossier's canonical claims.
 * Flags contradictions: spec mentions something listed in Rejected Alternatives
 * or reintroduces something listed in Removed Elements.
 */
function validateSpecAgainstDossier(specContent, dossier) {
  const issues = [];
  const specLower = String(specContent || '').toLowerCase();

  const rejected = dossier.sections['Rejected Alternatives'] || '';
  for (const line of rejected.split('\n')) {
    const m = line.match(/^-\s*(?:\d{4}-\d{2}-\d{2}:\s*)?([^→\n]+?)(?:\s*→|$)/);
    if (!m) continue;
    const altName = m[1].trim();
    if (!altName || altName.startsWith('<')) continue;
    const cleanAlt = altName.toLowerCase();
    if (cleanAlt.length < 4) continue;
    if (specLower.includes(cleanAlt)) {
      issues.push({
        severity: 'blocker',
        kind: 'rejected-alternative',
        detail: `Spec mentions "${altName}" which was rejected. See dossier § Rejected Alternatives.`
      });
    }
  }

  const removed = dossier.sections['Removed Elements'] || '';
  for (const line of removed.split('\n')) {
    if (!line.trim().startsWith('-')) continue;
    const gm = line.match(/enforcement-grep:\s*`([^`]+)`/);
    const nameMatch = line.match(/^-\s*(?:\d{4}-\d{2}-\d{2}:\s*)?([^→\n]+?)(?:\s*→|$)/);
    if (nameMatch) {
      const name = nameMatch[1].trim().toLowerCase();
      if (name && name.length >= 4 && !name.startsWith('<') && specLower.includes(name)) {
        issues.push({
          severity: 'blocker',
          kind: 'removed-element',
          detail: `Spec reintroduces "${nameMatch[1].trim()}" which was removed. See dossier § Removed Elements.`
        });
      }
    }
    if (gm) {
      try {
        const re = new RegExp(gm[1], 'i');
        if (re.test(specContent)) {
          issues.push({
            severity: 'blocker',
            kind: 'removed-element-pattern',
            detail: `Spec matches removed-element enforcement pattern /${gm[1]}/. See dossier § Removed Elements.`
          });
        }
      } catch (_err) { /* bad regex, skip */ }
    }
  }
  return issues;
}

/**
 * Drift detector: grep the codebase for patterns the dossier claims were removed.
 * If a match is found, the dossier is out of sync with reality (the contact-person case).
 */
function detectDrift(slug) {
  const dossier = loadDossier(slug);
  if (!dossier) throw new Error(`Dossier not found: ${slug}`);
  const removed = dossier.sections['Removed Elements'] || '';
  const findings = [];
  const patterns = [];
  for (const line of removed.split('\n')) {
    const gm = line.match(/enforcement-grep:\s*`([^`]+)`/);
    if (gm) patterns.push({ pattern: gm[1], source: line.trim() });
  }
  if (patterns.length === 0) {
    return { slug, patterns: 0, findings: [] };
  }
  for (const { pattern, source } of patterns) {
    try {
      const out = execSync(
        `git grep -nE ${JSON.stringify(pattern)} -- . ':(exclude).workflow' ':(exclude)node_modules' ':(exclude).git' 2>/dev/null || true`,
        { cwd: PATHS.root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const lines = out.split('\n').filter(Boolean).slice(0, 40);
      if (lines.length > 0) {
        findings.push({ pattern, source, hits: lines.length, sample: lines.slice(0, 5) });
      }
    } catch (_err) { /* non-blocking */ }
  }
  return { slug, patterns: patterns.length, findings };
}

function buildPhaseInjection(matches, opts = {}) {
  const max = opts.maxDossiers || 3;
  const top = matches
    .filter(m => m.score >= (opts.minScore || 1))
    .slice(0, max);
  if (top.length === 0) return null;

  const blocks = [];
  for (const match of top) {
    const dossier = loadDossier(match.slug);
    if (!dossier) continue;
    const title = dossier.title || match.slug;
    const canonical = dossier.sections['Canonical Summary'] || '(no canonical summary)';
    const contracts = dossier.sections['Contracts'] || '';
    const rejected = dossier.sections['Rejected Alternatives'] || '';
    const removed = dossier.sections['Removed Elements'] || '';
    const logicRules = dossier.sections['Logic Rules'] || '';

    let block = `### Feature Dossier: ${title} (slug: ${match.slug}, score ${match.score.toFixed(1)})\n`;
    block += `**Matched via**: ${match.reasons.join(', ')}\n\n`;
    block += `**Canonical**: ${canonical.split('\n').map(l => l.trim()).filter(Boolean).join(' ').slice(0, 600)}\n`;
    if (contracts && !contracts.startsWith('<')) {
      block += `\n**Contracts**:\n${contracts.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6).join('\n')}\n`;
    }
    if (logicRules && !logicRules.startsWith('<')) {
      block += `\n**Feature-scoped logic rules**:\n${logicRules.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6).join('\n')}\n`;
    }
    if (rejected && !rejected.startsWith('<')) {
      block += `\n**Rejected alternatives (do not re-propose)**:\n${rejected.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6).join('\n')}\n`;
    }
    if (removed && !removed.startsWith('<')) {
      block += `\n**Removed elements (do not reintroduce)**:\n${removed.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6).join('\n')}\n`;
    }
    block += `\n**Full dossier**: \`${path.relative(PATHS.root, dossier.path)}\`\n`;
    blocks.push(block);
  }
  if (blocks.length === 0) return null;
  return [
    '## Feature Dossier Auto-Load',
    '',
    'The following feature dossiers match the active task. These capture prior owner decisions, rejected alternatives, and removed elements. Your spec/implementation MUST NOT contradict them.',
    '',
    blocks.join('\n---\n\n')
  ].join('\n');
}

// ============================================================
// CLI
// ============================================================

function printHelp() {
  console.log(`Usage: flow feature-dossier <command> [args]

Commands:
  list                         List all known dossier slugs
  show <slug>                  Print a dossier's parsed content
  scaffold <slug> [options]    Create a new dossier
                               Options: --title "X" --owners "be,fe" --summary "..." --workspace
  match --title "..." [--files "a,b"] [--description "..."]
                               Show candidate dossiers for a task
  touch <slug> --task wf-XXX --type <event> [--note "..."]
                               Append a change-log event
  drift <slug>                 Grep codebase for removed-element patterns
  validate <slug> --spec <file>
                               Check a spec file against the dossier for contradictions
  inject --title "..." [--files "a,b"]
                               Print phase-injection block (for hook use)
  help                         Show this help

Examples:
  flow feature-dossier scaffold services-integrations --title "Services + Integrations" --owners "fe,be"
  flow feature-dossier match --title "merge services and integrations card" --files "src/pages/Services.tsx"
  flow feature-dossier drift services-integrations
`);
}

function parseArgs(args) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function cliMain(argv) {
  const [cmd, ...rest] = argv;
  const { _: positional, flags } = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return printHelp();

  if (cmd === 'list') {
    const slugs = listFeatures();
    if (slugs.length === 0) {
      console.log('(no dossiers — run `flow feature-dossier scaffold <slug>`)');
    } else {
      for (const s of slugs) console.log(s);
    }
    return;
  }

  if (cmd === 'show') {
    const slug = positional[0];
    if (!slug) { console.error('slug required'); process.exit(1); }
    const d = loadDossier(slug);
    if (!d) { console.error(`not found: ${slug}`); process.exit(1); }
    console.log(d.rawContent);
    return;
  }

  if (cmd === 'scaffold') {
    const slug = positional[0];
    if (!slug) { console.error('slug required'); process.exit(1); }
    const meta = {
      title: flags.title,
      owners: flags.owners ? String(flags.owners).split(',').map(s => s.trim()) : [],
      summary: flags.summary,
      patterns: flags.patterns ? String(flags.patterns).split(',').map(s => s.trim()) : [],
      root: flags.workspace ? 'workspace' : 'repo'
    };
    const out = scaffoldDossier(slug, meta);
    console.log(`Created: ${out}`);
    return;
  }

  if (cmd === 'match') {
    const input = {
      title: flags.title || '',
      description: flags.description || '',
      files: flags.files ? String(flags.files).split(',').map(s => s.trim()) : []
    };
    const matches = matchFeatures(input);
    if (matches.length === 0) {
      console.log('(no matches)');
      return;
    }
    for (const m of matches) {
      console.log(`${m.slug}  score=${m.score.toFixed(1)}  [${m.reasons.join(', ')}]`);
    }
    return;
  }

  if (cmd === 'touch') {
    const slug = positional[0];
    if (!slug) { console.error('slug required'); process.exit(1); }
    const result = appendEvent(slug, {
      taskId: flags.task || '-',
      type: flags.type || 'touched',
      note: flags.note || '',
      date: flags.date
    });
    console.log(`Appended to ${result.dossierPath}: ${result.row}`);
    return;
  }

  if (cmd === 'drift') {
    const slug = positional[0];
    if (!slug) { console.error('slug required'); process.exit(1); }
    const report = detectDrift(slug);
    if (report.findings.length === 0) {
      console.log(`drift: clean (${report.patterns} pattern(s) checked)`);
    } else {
      console.log(`DRIFT DETECTED in ${slug}:`);
      for (const f of report.findings) {
        console.log(`\n  pattern: /${f.pattern}/  hits: ${f.hits}`);
        console.log(`  source: ${f.source}`);
        for (const s of f.sample) console.log(`    ${s}`);
      }
      process.exit(2);
    }
    return;
  }

  if (cmd === 'validate') {
    const slug = positional[0];
    if (!slug || !flags.spec) { console.error('usage: validate <slug> --spec <file>'); process.exit(1); }
    const d = loadDossier(slug);
    if (!d) { console.error(`not found: ${slug}`); process.exit(1); }
    let spec;
    try { spec = fs.readFileSync(flags.spec, 'utf-8'); }
    catch (err) { console.error(`cannot read spec: ${err.message}`); process.exit(1); }
    const issues = validateSpecAgainstDossier(spec, d);
    if (issues.length === 0) {
      console.log('spec OK vs dossier');
    } else {
      console.log(`${issues.length} contradiction(s):`);
      for (const i of issues) console.log(`  [${i.severity}] ${i.kind}: ${i.detail}`);
      process.exit(2);
    }
    return;
  }

  if (cmd === 'inject') {
    const input = {
      title: flags.title || '',
      description: flags.description || '',
      files: flags.files ? String(flags.files).split(',').map(s => s.trim()) : []
    };
    const matches = matchFeatures(input);
    const block = buildPhaseInjection(matches, { minScore: Number(flags['min-score'] || 1), maxDossiers: Number(flags.max || 3) });
    if (block) console.log(block);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  try { cliMain(process.argv.slice(2)); }
  catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = {
  getDossierRoots,
  getPrimaryDossierDir,
  loadIndex,
  saveIndex,
  listFeatures,
  loadDossier,
  parseDossier,
  matchFeatures,
  scaffoldDossier,
  appendEvent,
  autoTouchFromTask,
  validateSpecAgainstDossier,
  detectDrift,
  buildPhaseInjection,
  DOSSIER_DIRNAME,
  RESERVED_SLUGS
};
