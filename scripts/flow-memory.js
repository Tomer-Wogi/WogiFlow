#!/usr/bin/env node

/**
 * Wogi Flow - Memory CLI (query / fetch / stats / tag)
 *
 * Unified query layer over WogiFlow's state-file landscape. Instead of
 * grepping across ready.json / decisions.md / feedback-patterns.md /
 * corrections/ / adversary-runs/ / request-log.md, users run
 * `flow memory query <filters>` or `flow memory fetch <ref>`.
 *
 * Story: wf-e64cacd0 (epic-episodic-memory, re-scoped post-pivot).
 *
 * Boundaries:
 *   - Does NOT modify memory file contents (read-only across all sources).
 *   - Tags are stored in a sidecar `.workflow/state/memory-tags.json` — the
 *     source memory files stay immutable.
 *
 * Usage (CLI):
 *   flow memory query [--since=<dur>] [--task=<id>] [--kind=<k>] [--tag=<#t>]
 *   flow memory fetch <ref>                  # ref = wf-ID, R-N, CORR-N, adversary-run filename
 *   flow memory stats
 *   flow memory tag <ref> <#tag>
 *   flow memory untag <ref> <#tag>
 *
 * Usage (programmatic):
 *   const { queryMemory, fetchByRef, memoryStats, addTag } = require('./flow-memory');
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  PATHS,
  safeJsonParse,
  safeJsonParseString,
  writeJson,
  withLock,
} = require('./flow-utils');

// ============================================================================
// Constants
// ============================================================================

const MEMORY_TAGS_FILE = path.join(PATHS.state, 'memory-tags.json');

const ADVERSARY_RUNS_DIR = path.join(PATHS.state, 'adversary-runs');
const CORRECTIONS_DIR = path.join(PATHS.workflow, 'corrections');
const READY_FILE = path.join(PATHS.state, 'ready.json');
const REQUEST_LOG_FILE = path.join(PATHS.state, 'request-log.md');
const DECISIONS_FILE = path.join(PATHS.state, 'decisions.md');
const FEEDBACK_PATTERNS_FILE = path.join(PATHS.state, 'feedback-patterns.md');
const CORRECTION_PATTERNS_FILE = path.join(PATHS.state, 'correction-patterns.json');

const KINDS = Object.freeze({
  task: 'task',                 // ready.json tasks
  requestlog: 'requestlog',     // R-NNN entries
  correction: 'correction',     // CORR-NNN records
  adversary: 'adversary',       // adversary-runs/*.json
  rule: 'rule',                 // decisions.md sections
  pattern: 'pattern',           // feedback-patterns.md entries
  phrase: 'phrase',             // correction-patterns.json phrases
});

// ============================================================================
// Duration parser — accepts 30m / 2h / 7d / 2w
// ============================================================================

function parseDuration(spec) {
  if (!spec || typeof spec !== 'string') return null;
  const m = spec.trim().match(/^(\d+(?:\.\d+)?)(m|h|d|w)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'm' ? 60_000 :
               unit === 'h' ? 3_600_000 :
               unit === 'd' ? 86_400_000 :
                              604_800_000;
  return n * mult;
}

function isAfter(iso, cutoffMs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= cutoffMs;
}

// ============================================================================
// Tag sidecar
// ============================================================================

function loadMemoryTags() {
  if (!fs.existsSync(MEMORY_TAGS_FILE)) return {};
  const data = safeJsonParse(MEMORY_TAGS_FILE, {});
  return data && typeof data === 'object' ? data : {};
}

function normalizeTag(tag) {
  let t = String(tag || '').trim();
  if (!t) return '';
  if (!t.startsWith('#')) t = '#' + t;
  return t.toLowerCase();
}

async function addTag(ref, tag) {
  const nref = String(ref || '').trim();
  const ntag = normalizeTag(tag);
  if (!nref || !ntag) return { ok: false, reason: 'ref and tag required' };
  await withLock(MEMORY_TAGS_FILE, async () => {
    const tags = loadMemoryTags();
    if (!Array.isArray(tags[nref])) tags[nref] = [];
    if (!tags[nref].includes(ntag)) tags[nref].push(ntag);
    writeJson(MEMORY_TAGS_FILE, tags);
  });
  return { ok: true, ref: nref, tag: ntag };
}

async function removeTag(ref, tag) {
  const nref = String(ref || '').trim();
  const ntag = normalizeTag(tag);
  if (!nref || !ntag) return { ok: false, reason: 'ref and tag required' };
  let removed = false;
  await withLock(MEMORY_TAGS_FILE, async () => {
    const tags = loadMemoryTags();
    if (!Array.isArray(tags[nref])) return;
    const before = tags[nref].length;
    tags[nref] = tags[nref].filter(t => t !== ntag);
    if (tags[nref].length !== before) removed = true;
    if (tags[nref].length === 0) delete tags[nref];
    writeJson(MEMORY_TAGS_FILE, tags);
  });
  return { ok: removed, ref: nref, tag: ntag };
}

function getTagsForRef(ref, tagsMap) {
  const tags = tagsMap || loadMemoryTags();
  return Array.isArray(tags[ref]) ? tags[ref].slice() : [];
}

// ============================================================================
// Source readers — each returns a normalized entry shape:
//   { kind, ref, title, summary, timestamp, taskIds: [], tags: [], source: path }
// ============================================================================

function loadTasks() {
  const data = safeJsonParse(READY_FILE, null);
  if (!data || typeof data !== 'object') return [];
  const out = [];
  const buckets = ['inProgress', 'ready', 'blocked', 'recentlyCompleted', 'backlog'];
  for (const b of buckets) {
    const arr = Array.isArray(data[b]) ? data[b] : [];
    for (const t of arr) {
      if (!t || !t.id) continue;
      const ts = t.completedAt || t.startedAt || t.created || null;
      out.push({
        kind: KINDS.task,
        ref: t.id,
        title: t.title || '',
        summary: `[${b}] ${t.type || 'task'} level=${t.level || '?'} priority=${t.priority || '?'}`,
        timestamp: ts,
        taskIds: [t.id],
        tags: [],
        source: READY_FILE,
        extra: { bucket: b, raw: t },
      });
    }
  }
  return out;
}

// Parses request-log.md into structured R-NNN entries.
// Format per entry (observed):
//   ### R-NNN | YYYY-MM-DD
//   **Type**: ...
//   **Tags**: #a #b ...
//   **Task**: wf-...              (sometimes)
//   **Request**: "..."
//   **Result**: ...
//   **Files**: ...
function loadRequestLog() {
  if (!fs.existsSync(REQUEST_LOG_FILE)) return [];
  let raw;
  try {
    raw = fs.readFileSync(REQUEST_LOG_FILE, 'utf-8');
  } catch (_err) {
    return [];
  }
  const out = [];
  const entryRe = /^### (R-\d+)\s*\|\s*([0-9-]+)(?:\s+[0-9:]+)?$/gm;
  const matches = [...raw.matchAll(entryRe)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    const block = raw.slice(start, end);
    const ref = m[1];
    const dateStr = m[2];
    // Parse fields
    const tagsMatch = block.match(/^\*\*Tags\*\*:\s*(.+)$/m);
    const typeMatch = block.match(/^\*\*Type\*\*:\s*(.+)$/m);
    const requestMatch = block.match(/^\*\*Request\*\*:\s*(.+)$/m);
    const resultMatch = block.match(/^\*\*Result\*\*:\s*(.+)$/m);
    const filesMatch = block.match(/^\*\*Files\*\*:\s*(.+)$/m);
    const tagsStr = tagsMatch ? tagsMatch[1] : '';
    const entryTags = (tagsStr.match(/#[\w:-]+/g) || []).map(t => t.toLowerCase());
    // Extract task IDs from tags and from block content
    const taskIds = new Set();
    for (const t of entryTags) {
      const mm = t.match(/#task:(wf-[a-f0-9]{8})/i);
      if (mm) taskIds.add(mm[1].toLowerCase());
    }
    for (const mm of block.matchAll(/\bwf-[a-f0-9]{8}\b/gi)) {
      taskIds.add(mm[0].toLowerCase());
    }
    out.push({
      kind: KINDS.requestlog,
      ref,
      title: (requestMatch ? requestMatch[1] : '').trim().replace(/^["']|["']$/g, '').slice(0, 120),
      summary: (typeMatch ? `[${typeMatch[1].trim()}] ` : '') +
               (resultMatch ? resultMatch[1].trim().slice(0, 200) : ''),
      timestamp: dateStr ? `${dateStr}T00:00:00.000Z` : null,
      taskIds: [...taskIds],
      tags: entryTags,
      source: REQUEST_LOG_FILE,
      extra: { block, files: filesMatch ? filesMatch[1] : '' },
    });
  }
  return out;
}

function loadCorrections() {
  if (!fs.existsSync(CORRECTIONS_DIR)) return [];
  let names;
  try {
    names = fs.readdirSync(CORRECTIONS_DIR);
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^CORR-\d+\.md$/i.test(name)) continue;
    const full = path.join(CORRECTIONS_DIR, name);
    let body;
    try {
      body = fs.readFileSync(full, 'utf-8');
    } catch (_err) {
      continue;
    }
    const ref = name.replace(/\.md$/i, '');
    const stat = fs.statSync(full);
    // Parse optional frontmatter fields (first-section)
    const firstLine = body.split('\n').slice(0, 15).join('\n');
    const summary = firstLine
      .replace(/^#.*$/gm, '')
      .split('\n')
      .filter(l => l.trim())
      .slice(0, 2)
      .join(' ')
      .slice(0, 180);
    const taskMatch = body.match(/\bwf-[a-f0-9]{8}\b/i);
    out.push({
      kind: KINDS.correction,
      ref,
      title: body.split('\n').find(l => l.startsWith('# ')) || ref,
      summary,
      timestamp: stat.mtime.toISOString(),
      taskIds: taskMatch ? [taskMatch[0].toLowerCase()] : [],
      tags: [],
      source: full,
      extra: { body },
    });
  }
  return out;
}

function loadAdversaryRuns() {
  if (!fs.existsSync(ADVERSARY_RUNS_DIR)) return [];
  let names;
  try {
    names = fs.readdirSync(ADVERSARY_RUNS_DIR);
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(ADVERSARY_RUNS_DIR, name);
    let stat;
    try {
      stat = fs.statSync(full);
      if (!stat.isFile()) continue;
    } catch (_err) {
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf-8');
    } catch (_err) {
      continue;
    }
    const parsed = safeJsonParseString(raw, null);
    if (!parsed || typeof parsed !== 'object') continue;
    const principles = Array.isArray(parsed.principles) ? parsed.principles : [];
    const failCount = principles.filter(p => /^(FAIL|CONCERN)$/i.test(String(p?.verdict || ''))).length;
    const verdict = parsed.overallVerdict || '?';
    out.push({
      kind: KINDS.adversary,
      ref: name.replace(/\.json$/, ''),
      title: `${parsed.taskId || '?'} r${parsed.round || '?'}`,
      summary: `overall=${verdict} fail/concern=${failCount}/${principles.length}`,
      timestamp: parsed.runAt || stat.mtime.toISOString(),
      taskIds: parsed.taskId ? [String(parsed.taskId).toLowerCase()] : [],
      tags: [],
      source: full,
      extra: parsed,
    });
  }
  return out;
}

// Parse decisions.md into rule entries (one per `### <Title>` heading under a `## <Section>`)
function loadRules() {
  if (!fs.existsSync(DECISIONS_FILE)) return [];
  let raw;
  try {
    raw = fs.readFileSync(DECISIONS_FILE, 'utf-8');
  } catch (_err) {
    return [];
  }
  const out = [];
  const sectionRe = /^##\s+(.+)$/gm;
  const sections = [];
  let m;
  while ((m = sectionRe.exec(raw)) !== null) {
    sections.push({ title: m[1].trim(), start: m.index });
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const end = i + 1 < sections.length ? sections[i + 1].start : raw.length;
    const body = raw.slice(s.start, end);
    // Each ### under this section is a rule.
    const ruleRe = /^###\s+(.+)$/gm;
    let rm;
    while ((rm = ruleRe.exec(body)) !== null) {
      const title = rm[1].trim();
      // Slug for ref: section/title
      const slug = (s.title + '/' + title)
        .toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      out.push({
        kind: KINDS.rule,
        ref: `rule/${slug}`,
        title,
        summary: `[${s.title}] ${title}`,
        timestamp: null,
        taskIds: [],
        tags: [],
        source: DECISIONS_FILE,
        extra: { section: s.title },
      });
    }
  }
  return out;
}

// Parse feedback-patterns.md — looks for table rows in `## Auto-Captured Patterns`.
function loadFeedbackPatterns() {
  if (!fs.existsSync(FEEDBACK_PATTERNS_FILE)) return [];
  let raw;
  try {
    raw = fs.readFileSync(FEEDBACK_PATTERNS_FILE, 'utf-8');
  } catch (_err) {
    return [];
  }
  const out = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    // Skip header + separator rows
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    if (/\bDate\s*\|\s*Pattern\b/i.test(line)) continue;
    const cells = line.split('|').map(c => c.trim()).filter((_c, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;
    const [date, pattern, source] = cells;
    if (!date || !pattern) continue;
    out.push({
      kind: KINDS.pattern,
      ref: `pattern/${pattern.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      title: pattern,
      summary: `[${source || '?'}] ${pattern}`,
      timestamp: /^\d{4}-\d{2}-\d{2}/.test(date) ? `${date.slice(0, 10)}T00:00:00.000Z` : null,
      taskIds: [],
      tags: [],
      source: FEEDBACK_PATTERNS_FILE,
      extra: { row: line, cells },
    });
  }
  return out;
}

function loadPhrases() {
  if (!fs.existsSync(CORRECTION_PATTERNS_FILE)) return [];
  let raw;
  try {
    raw = fs.readFileSync(CORRECTION_PATTERNS_FILE, 'utf-8');
  } catch (_err) {
    return [];
  }
  const parsed = safeJsonParseString(raw, null);
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const p of parsed) {
    if (!p || typeof p !== 'object' || !p.phrase) continue;
    out.push({
      kind: KINDS.phrase,
      ref: `phrase/${String(p.phrase).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      title: p.phrase,
      summary: `hits=${p.hits || 0} confirmed=${p.confirmedHits || 0} fp=${p.falsePositives || 0}`,
      timestamp: p.lastHitAt || p.lastConfirmedAt || p.addedAt || null,
      taskIds: [],
      tags: [],
      source: CORRECTION_PATTERNS_FILE,
      extra: p,
    });
  }
  return out;
}

function loadAllMemory() {
  return [
    ...loadTasks(),
    ...loadRequestLog(),
    ...loadCorrections(),
    ...loadAdversaryRuns(),
    ...loadRules(),
    ...loadFeedbackPatterns(),
    ...loadPhrases(),
  ];
}

// ============================================================================
// Query
// ============================================================================

/**
 * @param {Object} filters
 * @param {string} [filters.since]   duration spec (e.g. "2h", "7d")
 * @param {string} [filters.task]    wf-XXXXXXXX
 * @param {string} [filters.kind]    one of KINDS values
 * @param {string} [filters.tag]     e.g. "#important"
 * @param {number} [filters.limit]   max results (default 100)
 * @returns {Array} normalized entries
 */
function queryMemory(filters = {}) {
  const { since, task, kind, tag, limit = 100 } = filters;
  let entries = loadAllMemory();

  // Attach tags from sidecar
  const tagsMap = loadMemoryTags();
  for (const e of entries) {
    const t = tagsMap[e.ref];
    if (Array.isArray(t) && t.length) e.tags = [...new Set([...e.tags, ...t])];
  }

  if (kind) {
    const k = String(kind).toLowerCase();
    if (!Object.values(KINDS).includes(k)) {
      return { error: `unknown kind: ${kind}`, valid: Object.values(KINDS) };
    }
    entries = entries.filter(e => e.kind === k);
  }

  if (since) {
    const ms = parseDuration(since);
    if (ms === null) return { error: `unparsable duration: ${since}` };
    const cutoff = Date.now() - ms;
    entries = entries.filter(e => isAfter(e.timestamp, cutoff));
  }

  if (task) {
    const tnorm = String(task).toLowerCase();
    entries = entries.filter(e =>
      e.ref.toLowerCase() === tnorm ||
      (e.taskIds || []).some(id => id.toLowerCase() === tnorm)
    );
  }

  if (tag) {
    const tnorm = normalizeTag(tag);
    entries = entries.filter(e => (e.tags || []).includes(tnorm));
  }

  // Sort newest first (undefined timestamps last)
  entries.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });

  return entries.slice(0, limit);
}

// ============================================================================
// Fetch
// ============================================================================

/**
 * Resolve a ref to a full record with related entries.
 * Accepts: wf-XXXXXXXX, R-NNN, CORR-NNN, adversary-run filename (without .json), rule/*, pattern/*, phrase/*.
 */
function fetchByRef(ref) {
  const r = String(ref || '').trim();
  if (!r) return { found: false, reason: 'empty ref' };
  const all = loadAllMemory();
  const tagsMap = loadMemoryTags();
  for (const e of all) {
    const t = tagsMap[e.ref];
    if (Array.isArray(t) && t.length) e.tags = [...new Set([...e.tags, ...t])];
  }

  // Normalize comparison
  const rl = r.toLowerCase();

  // 1. Direct ref match
  const direct = all.find(e => e.ref.toLowerCase() === rl);
  if (direct) {
    // If it's a task, gather all related entries.
    const related = [];
    if (direct.kind === KINDS.task) {
      for (const e of all) {
        if (e === direct) continue;
        if ((e.taskIds || []).some(id => id.toLowerCase() === rl)) related.push(e);
      }
    }
    return { found: true, entry: direct, related };
  }

  // 2. Task-ID lookup if ref is wf-xxx but not in ready.json any more (e.g., archived)
  if (/^wf-[a-f0-9]{8}$/i.test(r)) {
    const related = all.filter(e => (e.taskIds || []).some(id => id.toLowerCase() === rl));
    if (related.length > 0) {
      return {
        found: true,
        entry: {
          kind: KINDS.task,
          ref: r,
          title: `(task not in ready.json; reconstructed from ${related.length} related entries)`,
          summary: related.map(e => `${e.kind}:${e.ref}`).join(', '),
          taskIds: [r],
          tags: [],
          timestamp: null,
          source: null,
          extra: {},
        },
        related,
      };
    }
  }

  return {
    found: false,
    reason: `no memory entry matches "${r}"`,
    suggestion: 'try: flow memory query  (to list recent entries)',
  };
}

// ============================================================================
// Stats
// ============================================================================

function memoryStats() {
  const tasks = loadTasks();
  const byBucket = { inProgress: 0, ready: 0, blocked: 0, recentlyCompleted: 0, backlog: 0 };
  for (const t of tasks) {
    const b = t.extra?.bucket;
    if (b && byBucket[b] !== undefined) byBucket[b] += 1;
  }
  return {
    tasks: { total: tasks.length, byBucket },
    requestLog: loadRequestLog().length,
    corrections: loadCorrections().length,
    adversaryRuns: loadAdversaryRuns().length,
    rules: loadRules().length,
    feedbackPatterns: loadFeedbackPatterns().length,
    correctionPhrases: loadPhrases().length,
    tags: Object.keys(loadMemoryTags()).length,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  queryMemory,
  fetchByRef,
  memoryStats,
  addTag,
  removeTag,
  getTagsForRef,
  loadMemoryTags,
  // Source loaders (exposed for tests)
  loadTasks,
  loadRequestLog,
  loadCorrections,
  loadAdversaryRuns,
  loadRules,
  loadFeedbackPatterns,
  loadPhrases,
  loadAllMemory,
  // Helpers
  parseDuration,
  normalizeTag,
  KINDS,
  MEMORY_TAGS_FILE,
};

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { args[key] = next; i++; }
        else args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printEntries(entries) {
  if (!Array.isArray(entries)) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log('(no results)');
    return;
  }
  for (const e of entries) {
    const tagStr = e.tags && e.tags.length ? ` ${e.tags.join(' ')}` : '';
    const ts = e.timestamp ? ` @ ${e.timestamp.slice(0, 19).replace('T', ' ')}` : '';
    const title = e.title ? ` — ${String(e.title).slice(0, 80)}` : '';
    console.log(`${e.kind.padEnd(11)} ${e.ref.padEnd(40)}${ts}${title}${tagStr}`);
    if (e.summary) console.log(`    ${String(e.summary).slice(0, 160)}`);
  }
  console.log(`\n(${entries.length} result${entries.length === 1 ? '' : 's'})`);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  (async () => {
    if (cmd === 'query' || cmd === undefined) {
      const result = queryMemory({
        since: args.since,
        task: args.task,
        kind: args.kind,
        tag: args.tag,
        limit: args.limit ? Number(args.limit) : 100,
      });
      if (result && result.error) {
        console.error(`error: ${result.error}`);
        if (result.valid) console.error(`valid kinds: ${result.valid.join(', ')}`);
        process.exit(1);
      }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else printEntries(result);
      return;
    }

    if (cmd === 'fetch') {
      const ref = args._[1];
      const r = fetchByRef(ref);
      if (!r.found) {
        console.error(`error: ${r.reason}`);
        if (r.suggestion) console.error(`hint:  ${r.suggestion}`);
        process.exit(1);
      }
      if (args.raw && r.entry.extra?.body) {
        console.log(r.entry.extra.body);
        return;
      }
      if (args.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(`=== ${r.entry.kind} ${r.entry.ref} ===`);
      if (r.entry.title) console.log(`title:     ${r.entry.title}`);
      if (r.entry.timestamp) console.log(`timestamp: ${r.entry.timestamp}`);
      if (r.entry.summary) console.log(`summary:   ${r.entry.summary}`);
      if (r.entry.taskIds?.length) console.log(`tasks:     ${r.entry.taskIds.join(', ')}`);
      if (r.entry.tags?.length) console.log(`tags:      ${r.entry.tags.join(' ')}`);
      if (r.entry.source) console.log(`source:    ${path.relative(PATHS.root || process.cwd(), r.entry.source)}`);
      if (r.related && r.related.length) {
        console.log(`\nRelated (${r.related.length}):`);
        for (const e of r.related) {
          console.log(`  ${e.kind.padEnd(11)} ${e.ref}  ${String(e.title || '').slice(0, 60)}`);
        }
      }
      return;
    }

    if (cmd === 'stats') {
      const s = memoryStats();
      if (args.json) { console.log(JSON.stringify(s, null, 2)); return; }
      console.log('=== flow memory stats ===');
      console.log(`Tasks:             ${s.tasks.total} total`);
      for (const [b, c] of Object.entries(s.tasks.byBucket)) {
        console.log(`    ${b.padEnd(20)} ${c}`);
      }
      console.log(`Request log:       ${s.requestLog}`);
      console.log(`Corrections:       ${s.corrections}`);
      console.log(`Adversary runs:    ${s.adversaryRuns}`);
      console.log(`Rules:             ${s.rules}`);
      console.log(`Feedback patterns: ${s.feedbackPatterns}`);
      console.log(`Correction phrases:${s.correctionPhrases}`);
      console.log(`Tags (refs):       ${s.tags}`);
      return;
    }

    if (cmd === 'tag') {
      const ref = args._[1];
      const tag = args._[2];
      if (!ref || !tag) { console.error('Usage: flow memory tag <ref> <#tag>'); process.exit(1); }
      const r = await addTag(ref, tag);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === 'untag') {
      const ref = args._[1];
      const tag = args._[2];
      if (!ref || !tag) { console.error('Usage: flow memory untag <ref> <#tag>'); process.exit(1); }
      const r = await removeTag(ref, tag);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    console.log(`Usage:
  flow memory query [--since=<dur>] [--task=<id>] [--kind=<k>] [--tag=<#t>] [--limit=N] [--json]
  flow memory fetch <ref> [--raw] [--json]
  flow memory stats [--json]
  flow memory tag <ref> <#tag>
  flow memory untag <ref> <#tag>

Durations: 30m, 2h, 7d, 2w
Kinds:     ${Object.values(KINDS).join(', ')}
Refs:      wf-XXXXXXXX | R-NNN | CORR-NNN | <adversary-run-filename>`);
    process.exit(cmd ? 1 : 0);
  })().catch((err) => {
    console.error(`[memory] error: ${err.message}`);
    process.exit(1);
  });
}
