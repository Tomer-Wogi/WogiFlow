'use strict';

/**
 * Wogi Flow — Memory Proposal Store
 *
 * Durable storage for agent-proposed edits to IGR artifacts (product.md,
 * domain-model.md, user-journeys.md, glossary.md). Proposals are staged until
 * the user approves or rejects them at session-end. Approved proposals are
 * applied to the target artifact + archived; rejected proposals are moved
 * aside without touching the target.
 *
 * Storage layout:
 *   .workflow/state/memory-proposals/<id>.json          — proposal records
 *   .workflow/state/memory-proposals/<id>.content.md    — staged content
 *   .workflow/state/memory-proposals/applied/           — approved archive
 *   .workflow/state/memory-proposals/rejected/          — rejected archive
 *
 * Record schema:
 *   {
 *     id:          "mprop-<8hex>",
 *     block:       "product" | "domain-model" | "user-journeys" | "glossary",
 *     op:          "append" | "replace-section" | "replace-all",
 *     contentPath: string,               // repo-relative path to staged content
 *     section:     string | null,        // heading text for replace-section only
 *     rationale:   string,
 *     proposedAt:  ISO-8601 timestamp,
 *     proposedBy:  "agent" | "user",
 *     status:      "pending" | "approved" | "rejected",
 *     decidedAt?:  ISO-8601,
 *     reason?:     string                // reject reason
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PATHS, isPathWithinProject } = require('../scripts/flow-paths');

const PROPOSALS_DIR = path.join(PATHS.state, 'memory-proposals');
const APPLIED_DIR = path.join(PROPOSALS_DIR, 'applied');
const REJECTED_DIR = path.join(PROPOSALS_DIR, 'rejected');

const VALID_BLOCKS = Object.freeze(['product', 'domain-model', 'user-journeys', 'glossary']);
const VALID_OPS = Object.freeze(['append', 'replace-section', 'replace-all']);

// ============================================================
// Low-level helpers
// ============================================================

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateProposalId() {
  return `mprop-${crypto.randomBytes(4).toString('hex')}`;
}

function blockArtifactPath(block) {
  return path.join(PATHS.state, `${block}.md`);
}

function proposalRecordPath(id, baseDir = PROPOSALS_DIR) {
  return path.join(baseDir, `${id}.json`);
}

function proposalContentPath(id, baseDir = PROPOSALS_DIR) {
  return path.join(baseDir, `${id}.content.md`);
}

function toRepoRelative(absPath) {
  return path.relative(PATHS.root, absPath);
}

function resolveWithinProject(relOrAbs) {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(PATHS.root, relOrAbs);
  if (!isPathWithinProject(abs)) {
    throw new Error(`path escapes project root: ${relOrAbs}`);
  }
  return abs;
}

function readRecord(absPath) {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function writeRecord(absPath, record) {
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, JSON.stringify(record, null, 2) + '\n', 'utf-8');
}

function listRecordsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^mprop-[a-f0-9]{8}\.json$/.test(name)) continue;
    const rec = readRecord(path.join(dir, name));
    if (rec) out.push(rec);
  }
  return out;
}

// ============================================================
// Section boundary (markdown heading) parsing
// ============================================================

/**
 * Parse `##`/`###` headings from markdown text. Returns an array of
 *   { level, heading, start, end }
 * where `start` is the index of the heading line's `#` and `end` is the
 * index of the next same-or-higher heading (or EOF) — the section body
 * spans [start, end).
 */
function parseSections(text) {
  const lines = text.split('\n');
  const sections = [];
  // We need line offsets to compute absolute text indices.
  const lineOffsets = new Array(lines.length);
  {
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      lineOffsets[i] = off;
      off += lines[i].length + 1; // +1 for the removed '\n'
    }
  }
  const headingRe = /^(#{2,6})\s+(.+?)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (!m) continue;
    sections.push({
      level: m[1].length,
      heading: m[2].trim(),
      start: lineOffsets[i],
      lineIndex: i,
      end: text.length, // patched below
    });
  }
  // Patch `end` — first section whose level <= current.level ends us.
  for (let i = 0; i < sections.length; i++) {
    const cur = sections[i];
    let end = text.length;
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= cur.level) {
        end = sections[j].start;
        break;
      }
    }
    cur.end = end;
  }
  return sections;
}

/**
 * Find the section with the given heading. Returns:
 *   { section, error?, matchCount }
 * When multiple sections share the same heading, returns an error — the
 * caller must supply a unique heading to avoid ambiguous replacement.
 */
function findSectionByHeading(text, heading) {
  const normalize = (s) => String(s || '').trim();
  const target = normalize(heading);
  if (!target) {
    return { section: null, error: 'empty heading', matchCount: 0 };
  }
  const sections = parseSections(text);
  const matches = sections.filter((s) => normalize(s.heading) === target);
  if (matches.length === 0) {
    return { section: null, error: `heading not found: '${heading}'`, matchCount: 0 };
  }
  if (matches.length > 1) {
    return {
      section: null,
      error: `ambiguous heading '${heading}' — matches ${matches.length} sections; make the heading unique or use replace-all`,
      matchCount: matches.length,
    };
  }
  return { section: matches[0], matchCount: 1 };
}

// ============================================================
// Public API — proposal staging
// ============================================================

/**
 * Stage a proposal.
 *
 *   block:       one of VALID_BLOCKS
 *   op:          append | replace-section | replace-all
 *   contentFile: repo-relative or absolute path to staged content (required)
 *   section:     heading text — required for replace-section
 *   rationale:   string — required for replace-all
 */
function createProposal({
  block,
  op,
  contentFile = null,
  section = null,
  rationale = '',
  proposedBy = 'agent',
} = {}) {
  if (!VALID_BLOCKS.includes(block)) {
    throw new Error(`invalid block '${block}': expected ${VALID_BLOCKS.join('|')}`);
  }
  if (!VALID_OPS.includes(op)) {
    throw new Error(`invalid op '${op}': expected ${VALID_OPS.join('|')}`);
  }
  if (!contentFile) {
    throw new Error('--content is required');
  }
  const contentAbs = resolveWithinProject(contentFile);
  if (!fs.existsSync(contentAbs)) {
    throw new Error(`content file not found: ${contentFile}`);
  }

  const rationaleStr = String(rationale || '').trim();

  if (op === 'replace-all' && !rationaleStr) {
    throw new Error('replace-all requires --rationale');
  }

  const sectionStr = section != null ? String(section).trim() : null;
  if (op === 'replace-section') {
    if (!sectionStr) {
      throw new Error('replace-section requires --section <heading>');
    }
    // Validate the heading exists in the current artifact (AC #3).
    // If the artifact is missing, replace-section is nonsensical — error.
    const artifactPath = blockArtifactPath(block);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`cannot replace-section — artifact missing at ${toRepoRelative(artifactPath)}`);
    }
    const body = fs.readFileSync(artifactPath, 'utf-8');
    const hit = findSectionByHeading(body, sectionStr);
    if (hit.error) {
      throw new Error(`section validation failed: ${hit.error}`);
    }
  }

  const id = generateProposalId();
  ensureDir(PROPOSALS_DIR);
  const stagedAbs = proposalContentPath(id);
  fs.copyFileSync(contentAbs, stagedAbs);

  const record = {
    id,
    block,
    op,
    contentPath: toRepoRelative(stagedAbs),
    section: sectionStr,
    rationale: rationaleStr,
    proposedAt: new Date().toISOString(),
    proposedBy: proposedBy === 'user' ? 'user' : 'agent',
    status: 'pending',
  };
  writeRecord(proposalRecordPath(id), record);
  return record;
}

// ============================================================
// Public API — lookup
// ============================================================

function listProposals(filter = {}) {
  const status = filter.status || null;
  const buckets = [];
  if (!status || status === 'pending') buckets.push(...listRecordsIn(PROPOSALS_DIR));
  if (!status || status === 'approved') buckets.push(...listRecordsIn(APPLIED_DIR));
  if (!status || status === 'rejected') buckets.push(...listRecordsIn(REJECTED_DIR));

  const want = Object.entries(filter).filter(([k]) => k !== 'status');
  return buckets.filter((r) => want.every(([k, v]) => r[k] === v));
}

function findProposal({ id = null, block = null, status = 'pending' } = {}) {
  const candidates = listProposals({ status });
  return candidates.find((r) =>
    (id ? r.id === id : true) &&
    (block ? r.block === block : true)
  ) || null;
}

function readStagedContent(record) {
  const abs = path.resolve(PATHS.root, record.contentPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`staged content missing at ${record.contentPath}`);
  }
  return fs.readFileSync(abs, 'utf-8');
}

// ============================================================
// Public API — approve / reject
// ============================================================

/**
 * Apply op to artifact, archive proposal to applied/.
 * Returns the updated record.
 */
function approveProposal({ id }) {
  if (!id) throw new Error('approveProposal requires id');
  const recordPath = proposalRecordPath(id);
  const record = readRecord(recordPath);
  if (!record) throw new Error(`no pending proposal with id ${id}`);
  if (record.status !== 'pending') {
    throw new Error(`proposal ${id} already ${record.status}`);
  }

  const artifactAbs = blockArtifactPath(record.block);
  const newContent = readStagedContent(record);

  let updatedBody;
  if (record.op === 'append') {
    const existing = fs.existsSync(artifactAbs) ? fs.readFileSync(artifactAbs, 'utf-8') : '';
    const sep = existing.length === 0 ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
    updatedBody = existing + sep + newContent;
    if (!updatedBody.endsWith('\n')) updatedBody += '\n';
  } else if (record.op === 'replace-all') {
    updatedBody = newContent.endsWith('\n') ? newContent : newContent + '\n';
  } else if (record.op === 'replace-section') {
    if (!fs.existsSync(artifactAbs)) {
      throw new Error(`cannot replace-section — artifact missing at ${toRepoRelative(artifactAbs)}`);
    }
    const existing = fs.readFileSync(artifactAbs, 'utf-8');
    const hit = findSectionByHeading(existing, record.section);
    if (hit.error) {
      throw new Error(`section validation failed at approval: ${hit.error}`);
    }
    const s = hit.section;
    const replacement = newContent.endsWith('\n') ? newContent : newContent + '\n';
    updatedBody = existing.slice(0, s.start) + replacement + existing.slice(s.end);
  } else {
    throw new Error(`unknown op: ${record.op}`);
  }

  ensureDir(path.dirname(artifactAbs));
  fs.writeFileSync(artifactAbs, updatedBody, 'utf-8');

  // Archive the record + content to applied/
  ensureDir(APPLIED_DIR);
  const applied = {
    ...record,
    status: 'approved',
    decidedAt: new Date().toISOString(),
  };
  writeRecord(proposalRecordPath(id, APPLIED_DIR), applied);
  // Move staged content
  const stagedAbs = proposalContentPath(id);
  const archivedContentAbs = proposalContentPath(id, APPLIED_DIR);
  if (fs.existsSync(stagedAbs)) {
    fs.renameSync(stagedAbs, archivedContentAbs);
  }
  // Remove the pending record
  try { fs.unlinkSync(recordPath); } catch (_err) { /* non-critical */ }

  return applied;
}

function rejectProposal({ id, reason = '' } = {}) {
  if (!id) throw new Error('rejectProposal requires id');
  const recordPath = proposalRecordPath(id);
  const record = readRecord(recordPath);
  if (!record) throw new Error(`no pending proposal with id ${id}`);
  if (record.status !== 'pending') {
    throw new Error(`proposal ${id} already ${record.status}`);
  }

  ensureDir(REJECTED_DIR);
  const rejected = {
    ...record,
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    reason: String(reason || '').trim(),
  };
  writeRecord(proposalRecordPath(id, REJECTED_DIR), rejected);
  // Move staged content
  const stagedAbs = proposalContentPath(id);
  const archivedContentAbs = proposalContentPath(id, REJECTED_DIR);
  if (fs.existsSync(stagedAbs)) {
    fs.renameSync(stagedAbs, archivedContentAbs);
  }
  try { fs.unlinkSync(recordPath); } catch (_err) { /* non-critical */ }

  return rejected;
}

// ============================================================
// Public API — diff preview (for session-end surfacing, AC #6)
// ============================================================

/**
 * Render a short preview of what a pending proposal would do. Returns a
 * multi-line string suitable for terminal display. Non-throwing.
 */
function previewProposal(record) {
  const block = record.block;
  const artifactAbs = blockArtifactPath(block);
  const artifactExists = fs.existsSync(artifactAbs);
  let staged = '';
  try { staged = readStagedContent(record); } catch (_err) { staged = '<missing staged content>'; }
  const stagedHead = staged.split('\n').slice(0, 6).join('\n');
  const icon = record.op === 'append' ? '+' : record.op === 'replace-section' ? '~' : '!';

  const lines = [
    `  ${icon} ${block} [${record.op}] (${record.id})`,
    `    proposedAt: ${record.proposedAt}  by: ${record.proposedBy}`,
  ];
  if (record.section) lines.push(`    section:    ${record.section}`);
  if (record.rationale) lines.push(`    rationale:  ${record.rationale}`);
  lines.push(`    artifact:   ${toRepoRelative(artifactAbs)}${artifactExists ? '' : ' (new)'}`);
  lines.push(`    preview (first 6 lines of staged content):`);
  for (const l of stagedHead.split('\n')) {
    lines.push(`      ${l}`);
  }
  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core API
  createProposal,
  listProposals,
  findProposal,
  approveProposal,
  rejectProposal,
  previewProposal,

  // Section parsing (exposed for tests and CLI)
  parseSections,
  findSectionByHeading,

  // Path helpers
  pathFor: {
    proposals: PROPOSALS_DIR,
    applied: APPLIED_DIR,
    rejected: REJECTED_DIR,
    artifact: blockArtifactPath,
    record: proposalRecordPath,
    content: proposalContentPath,
  },

  // Constants
  VALID_BLOCKS,
  VALID_OPS,
};
