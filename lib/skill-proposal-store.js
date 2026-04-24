'use strict';

/**
 * Wogi Flow — Skill Proposal Store
 *
 * Durable storage for agent-proposed skill changes (new / edit / remove).
 * Proposals are staged until the user reviews them at session-end and approves
 * or rejects. Approved proposals are applied by `promote`; rejected proposals
 * are removed without touching `.claude/skills/`.
 *
 * Storage layout:
 *   .workflow/state/skill-proposals.json          — proposal records (array)
 *   .claude/skills/pending/<name>.md              — staged content for propose/patch
 *   .claude/skills/archived/<name>.md             — destination after approved remove
 *
 * Record schema:
 *   {
 *     id:          "prop-<8hex>",
 *     action:      "propose" | "patch" | "remove",
 *     skillName:   string,
 *     contentPath: string | null,       // repo-relative; null for remove
 *     rationale:   string,
 *     proposedAt:  ISO-8601 timestamp,
 *     proposedBy:  "agent" | "user",
 *     status:      "pending" | "approved" | "rejected"
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PATHS, isPathWithinProject } = require('../scripts/flow-paths');

const PROPOSALS_FILE = path.join(PATHS.state, 'skill-proposals.json');
const PENDING_DIR = path.join(PATHS.claude, 'skills', 'pending');
const ARCHIVED_DIR = path.join(PATHS.claude, 'skills', 'archived');
const ACTIVE_SKILLS_DIR = path.join(PATHS.claude, 'skills');

const VALID_SKILL_NAME = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const VALID_ACTIONS = new Set(['propose', 'patch', 'remove']);

// ============================================================
// Low-level helpers
// ============================================================

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readProposals() {
  if (!fs.existsSync(PROPOSALS_FILE)) return [];
  try {
    const raw = fs.readFileSync(PROPOSALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function writeProposals(list) {
  ensureDir(path.dirname(PROPOSALS_FILE));
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
}

function generateProposalId() {
  return `prop-${crypto.randomBytes(4).toString('hex')}`;
}

function validateSkillName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('skill name is required');
  }
  if (!VALID_SKILL_NAME.test(name)) {
    throw new Error(
      `invalid skill name '${name}': use lowercase letters, digits, hyphens (kebab-case); forward-slashes allowed for nesting`
    );
  }
}

function skillNameToFile(name) {
  return `${name}.md`;
}

function resolveWithinProject(relOrAbs) {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(PATHS.root, relOrAbs);
  if (!isPathWithinProject(abs)) {
    throw new Error(`path escapes project root: ${relOrAbs}`);
  }
  return abs;
}

function toRepoRelative(absPath) {
  return path.relative(PATHS.root, absPath);
}

function activeSkillPath(name) {
  return path.join(ACTIVE_SKILLS_DIR, skillNameToFile(name));
}

function pendingSkillPath(name) {
  return path.join(PENDING_DIR, skillNameToFile(name));
}

function archivedSkillPath(name) {
  return path.join(ARCHIVED_DIR, skillNameToFile(name));
}

// ============================================================
// Public API
// ============================================================

/**
 * Stage a proposal record. For propose/patch, copies `contentFile` into
 * .claude/skills/pending/<name>.md. For remove, no content is copied.
 */
function createProposal({ action, skillName, contentFile = null, rationale = '', proposedBy = 'agent' }) {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`invalid action '${action}': expected propose|patch|remove`);
  }
  validateSkillName(skillName);

  let contentPath = null;
  if (action === 'propose' || action === 'patch') {
    if (!contentFile) {
      throw new Error(`--content is required for ${action}`);
    }
    const srcAbs = resolveWithinProject(contentFile);
    if (!fs.existsSync(srcAbs)) {
      throw new Error(`content file not found: ${contentFile}`);
    }
    ensureDir(PENDING_DIR);
    const destAbs = pendingSkillPath(skillName);
    ensureDir(path.dirname(destAbs));
    fs.copyFileSync(srcAbs, destAbs);
    contentPath = toRepoRelative(destAbs);
  }

  if (action === 'remove') {
    const activeAbs = activeSkillPath(skillName);
    if (!fs.existsSync(activeAbs)) {
      throw new Error(`cannot propose remove — no active skill at ${toRepoRelative(activeAbs)}`);
    }
  }

  const record = {
    id: generateProposalId(),
    action,
    skillName,
    contentPath,
    rationale: String(rationale || ''),
    proposedAt: new Date().toISOString(),
    proposedBy: proposedBy === 'user' ? 'user' : 'agent',
    status: 'pending',
  };

  const list = readProposals();
  list.push(record);
  writeProposals(list);

  return record;
}

function listProposals(filter = {}) {
  const list = readProposals();
  if (!filter || Object.keys(filter).length === 0) return list;
  return list.filter((r) =>
    Object.entries(filter).every(([k, v]) => r[k] === v)
  );
}

function findProposal({ id = null, skillName = null, action = null, status = 'pending' }) {
  const list = readProposals();
  return list.find((r) =>
    (id ? r.id === id : true) &&
    (skillName ? r.skillName === skillName : true) &&
    (action ? r.action === action : true) &&
    (status ? r.status === status : true)
  );
}

function updateProposalStatus(id, status) {
  const list = readProposals();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error(`no proposal with id ${id}`);
  list[idx].status = status;
  list[idx].decidedAt = new Date().toISOString();
  writeProposals(list);
  return list[idx];
}

/**
 * Apply a pending proposal (user-invoked only).
 *   propose → move pending/<name>.md → .claude/skills/<name>.md
 *   patch   → overwrite .claude/skills/<name>.md with pending content
 *   remove  → move .claude/skills/<name>.md → .claude/skills/archived/<name>.md
 *
 * Selector: `skillName` (finds the most recent pending proposal for that skill)
 * or `id` (exact proposal id). `id` wins when both provided.
 */
function promoteProposal({ skillName = null, id = null } = {}) {
  if (!skillName && !id) throw new Error('promoteProposal requires skillName or id');
  const proposal = id
    ? findProposal({ id })
    : findProposal({ skillName });
  if (!proposal) {
    throw new Error(`no pending proposal found for ${id || skillName}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(`proposal ${proposal.id} already ${proposal.status}`);
  }
  validateSkillName(proposal.skillName);

  const activeAbs = activeSkillPath(proposal.skillName);
  const pendingAbs = pendingSkillPath(proposal.skillName);
  const archivedAbs = archivedSkillPath(proposal.skillName);

  if (proposal.action === 'propose') {
    if (fs.existsSync(activeAbs)) {
      throw new Error(`cannot promote propose — active skill already exists at ${toRepoRelative(activeAbs)}; use patch instead`);
    }
    if (!fs.existsSync(pendingAbs)) {
      throw new Error(`pending content missing at ${toRepoRelative(pendingAbs)}`);
    }
    ensureDir(path.dirname(activeAbs));
    fs.renameSync(pendingAbs, activeAbs);
  } else if (proposal.action === 'patch') {
    if (!fs.existsSync(activeAbs)) {
      throw new Error(`cannot promote patch — no active skill at ${toRepoRelative(activeAbs)}`);
    }
    if (!fs.existsSync(pendingAbs)) {
      throw new Error(`pending content missing at ${toRepoRelative(pendingAbs)}`);
    }
    fs.copyFileSync(pendingAbs, activeAbs);
    fs.unlinkSync(pendingAbs);
  } else if (proposal.action === 'remove') {
    if (!fs.existsSync(activeAbs)) {
      throw new Error(`cannot promote remove — active skill gone at ${toRepoRelative(activeAbs)}`);
    }
    ensureDir(ARCHIVED_DIR);
    ensureDir(path.dirname(archivedAbs));
    fs.renameSync(activeAbs, archivedAbs);
  }

  return updateProposalStatus(proposal.id, 'approved');
}

function rejectProposal({ skillName = null, id = null } = {}) {
  if (!skillName && !id) throw new Error('rejectProposal requires skillName or id');
  const proposal = id ? findProposal({ id }) : findProposal({ skillName });
  if (!proposal) {
    throw new Error(`no pending proposal found for ${id || skillName}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(`proposal ${proposal.id} already ${proposal.status}`);
  }

  // Clean up staged content for propose/patch
  if (proposal.action === 'propose' || proposal.action === 'patch') {
    const pendingAbs = pendingSkillPath(proposal.skillName);
    if (fs.existsSync(pendingAbs)) {
      try { fs.unlinkSync(pendingAbs); } catch (_err) { /* non-critical */ }
    }
  }

  return updateProposalStatus(proposal.id, 'rejected');
}

/**
 * Direct archival of an active skill. User-invoked; bypasses proposal staging.
 */
function archiveSkill(skillName) {
  validateSkillName(skillName);
  const activeAbs = activeSkillPath(skillName);
  if (!fs.existsSync(activeAbs)) {
    throw new Error(`no active skill at ${toRepoRelative(activeAbs)}`);
  }
  const archivedAbs = archivedSkillPath(skillName);
  ensureDir(path.dirname(archivedAbs));
  fs.renameSync(activeAbs, archivedAbs);
  return { skillName, archivedPath: toRepoRelative(archivedAbs) };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core API
  createProposal,
  listProposals,
  findProposal,
  promoteProposal,
  rejectProposal,
  archiveSkill,

  // Path helpers (for tests & hooks)
  pathFor: {
    proposals: PROPOSALS_FILE,
    pending: PENDING_DIR,
    archived: ARCHIVED_DIR,
    active: ACTIVE_SKILLS_DIR,
    activeSkill: activeSkillPath,
    pendingSkill: pendingSkillPath,
    archivedSkill: archivedSkillPath,
  },

  // Low-level helpers (exposed for targeted tests)
  _internal: {
    readProposals,
    writeProposals,
    updateProposalStatus,
    validateSkillName,
    VALID_ACTIONS,
  },
};
