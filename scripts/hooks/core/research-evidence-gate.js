#!/usr/bin/env node

/**
 * Wogi Flow - Research-Evidence Gate (Core Module)
 *
 * Enforces the "Research Before Propose" methodology rule by tracking which
 * state/spec/epic files the AI has Read in the current task turn, and blocking
 * proposal actions (spec writes, channel-dispatch to workers) until a minimum
 * evidence threshold has been reached.
 *
 * Does NOT block AskUserQuestion, plain Read/Glob/Grep/WebSearch, conversational
 * text, or non-proposal edits. Asking the user is a valid escape hatch.
 *
 * State file: .workflow/state/research-evidence.json
 * Fail-open: If state file is missing/corrupt or config disabled, allow the tool call.
 *
 * Three entry points:
 *   recordEvidenceRead(filePath)         — called when Read targets an evidence file
 *   checkSpecWriteGate(filePath, config) — called before Edit/Write to proposal paths
 *   checkDispatchEvidenceGate(config)    — called before manager channel-dispatch
 *   clearResearchEvidence()              — called on new task start / session end / post-compact
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS, safeJsonParse } = require('../../flow-utils');

const EVIDENCE_FILE = path.join(PATHS.state, 'research-evidence.json');

// Relative-to-project path prefixes that count as evidence when Read.
// Any file whose project-relative path starts with one of these prefixes
// increments the evidence counter.
const EVIDENCE_PREFIXES = [
  '.workflow/state/',
  '.workflow/changes/',
  '.workflow/specs/',
  '.workflow/epics/'
];

// Path prefixes that trigger the spec-write gate when targeted by Edit/Write.
// Writing to these paths = "proposing a spec" = must have evidence first.
const PROPOSAL_PREFIXES = [
  '.workflow/changes/',
  '.workflow/specs/',
  '.workflow/epics/'
];

// Default threshold: minimum number of distinct evidence-file reads required
// before a proposal action is allowed. Can be overridden by config.
const DEFAULT_MIN_EVIDENCE = 2;

function toProjectRelative(filePath) {
  try {
    // Canonicalize both sides via realpath to prevent symlink escape
    // (SEC-003): a symlink in PATHS.root or the input path could make a
    // file outside the project appear inside after a plain path.relative.
    let rootCanon = PATHS.root;
    let targetCanon = path.resolve(filePath);
    try { rootCanon = fs.realpathSync(PATHS.root); } catch (_err) { /* root may not exist mid-test */ }
    try { targetCanon = fs.realpathSync(targetCanon); } catch (_err) { /* target may not exist yet */ }
    const rel = path.relative(rootCanon, targetCanon);
    return rel.split(path.sep).join('/');
  } catch (_err) {
    return null;
  }
}

function matchesPrefix(relPath, prefixes) {
  if (!relPath || relPath.startsWith('..')) return false;
  return prefixes.some(p => relPath.startsWith(p));
}

/**
 * Record that an evidence file was read. Called from PreToolUse on Read.
 * De-duplicates: reading the same file twice still counts as 1.
 *
 * Write strategy (CL-001): atomic temp-file + rename. A concurrent tool call
 * that loses the read-modify-write race will at worst lose one evidence entry,
 * which causes a false-block that the user resolves by reading one more file.
 * The atomic rename prevents partial writes on crash.
 */
function recordEvidenceRead(filePath) {
  if (!filePath || typeof filePath !== 'string') return;

  const rel = toProjectRelative(filePath);
  if (!matchesPrefix(rel, EVIDENCE_PREFIXES)) return;

  try {
    const existing = safeJsonParse(EVIDENCE_FILE, {});
    if (!existing.reads || typeof existing.reads !== 'object') existing.reads = {};
    if (!existing.reads[rel]) {
      existing.reads[rel] = { at: new Date().toISOString() };
      const tmp = `${EVIDENCE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
      fs.renameSync(tmp, EVIDENCE_FILE);
      if (process.env.DEBUG) {
        console.error(`[ResearchEvidenceGate] Recorded evidence read: ${rel}`);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[ResearchEvidenceGate] Failed to record read: ${err.message}`);
    }
  }
}

function getEvidenceCount() {
  try {
    const data = safeJsonParse(EVIDENCE_FILE, {});
    if (!data.reads || typeof data.reads !== 'object') return 0;
    return Object.keys(data.reads).length;
  } catch (_err) {
    return 0;
  }
}

function isGateEnabled(config) {
  const gateCfg = config?.hooks?.rules?.researchEvidenceGate;
  if (gateCfg === undefined || gateCfg === null) return true;
  if (gateCfg === false) return false;
  if (typeof gateCfg === 'object' && gateCfg.enabled === false) return false;
  return true;
}

function getMinEvidence(config) {
  const v = config?.hooks?.rules?.researchEvidenceGate?.minEvidence;
  if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) return v;
  return DEFAULT_MIN_EVIDENCE;
}

/**
 * Block Edit/Write to a proposal path when evidence fingerprint is below threshold.
 * Called from pre-tool-orchestrator before Edit/Write runs.
 *
 * @param {string} filePath - Path being written/edited
 * @param {Object} config
 * @returns {{ blocked: boolean, message?: string }}
 */
function checkSpecWriteGate(filePath, config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };
    if (!filePath || typeof filePath !== 'string') return { blocked: false };

    const rel = toProjectRelative(filePath);
    if (!matchesPrefix(rel, PROPOSAL_PREFIXES)) return { blocked: false };

    const minEvidence = getMinEvidence(config);
    const count = getEvidenceCount();
    if (count >= minEvidence) return { blocked: false };

    return {
      blocked: true,
      message:
        `Research-before-propose: this writes a spec/change/epic (${rel}), but you have only ` +
        `read ${count} evidence file(s) this task turn. Minimum required: ${minEvidence}.\n\n` +
        `Before proposing, read relevant files from:\n` +
        `  .workflow/state/decisions.md, feedback-patterns.md, app-map.md, function-map.md, api-map.md\n` +
        `  the task spec (.workflow/changes/<taskId>.md or .workflow/specs/<id>.md)\n` +
        `  .workflow/epics/ if this task belongs to an epic\n\n` +
        `If you genuinely need clarification before proposing, use AskUserQuestion — that is allowed.\n` +
        `The rule is "don't propose before researching," not "never ask."`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[ResearchEvidenceGate] Spec-write gate error (fail-open): ${err.message}`);
    }
    return { blocked: false };
  }
}

/**
 * Block channel-dispatch to a worker when the manager has no evidence of
 * having researched the target's state. Called from lib/workspace-routing.js
 * before dispatchToChannel posts.
 *
 * @param {Object} config
 * @returns {{ blocked: boolean, message?: string }}
 */
function checkDispatchEvidenceGate(config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };

    // Manager-mode only: workers don't dispatch. Single-repo sessions
    // (no WOGI_WORKSPACE_ROOT) are n/a — there are no workers to dispatch
    // to, so the evidence requirement does not apply (CL-003).
    const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
    const repo = process.env.WOGI_REPO_NAME;
    const isManager = !!workspaceRoot && (!repo || repo === 'manager');
    if (!isManager) return { blocked: false };

    const minEvidence = getMinEvidence(config);
    const count = getEvidenceCount();
    if (count >= minEvidence) return { blocked: false };

    return {
      blocked: true,
      message:
        `Research-before-dispatch: dispatching to a worker proposes work, but the manager has only ` +
        `read ${count} evidence file(s) this turn. Minimum required: ${minEvidence}.\n\n` +
        `Before dispatching, read relevant state from the target member repo:\n` +
        `  <member-repo>/.workflow/state/decisions.md, app-map.md, feedback-patterns.md\n` +
        `  <member-repo>/.workflow/changes/ for existing task specs\n\n` +
        `Silent workers that receive poorly-specified work cost the most to recover. ` +
        `The Wogi Hub manager incident that prompted this rule dispatched Employee-class ` +
        `clarifying-question work without reading the existing class system.`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[ResearchEvidenceGate] Dispatch gate error (fail-open): ${err.message}`);
    }
    return { blocked: false };
  }
}

/**
 * Block phase transitions into proposal phases (spec_review, coding) when
 * the AI has not read enough evidence files this task turn. Called from
 * phase-gate.js transitionPhase() when the target is a proposal phase.
 *
 * @param {string} from
 * @param {string} to
 * @param {Object} config
 * @returns {{ blocked: boolean, message?: string }}
 */
function checkPhaseTransitionEvidence(from, to, config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };
    if (to !== 'spec_review' && to !== 'coding') return { blocked: false };

    const minEvidence = getMinEvidence(config);
    const count = getEvidenceCount();
    if (count >= minEvidence) return { blocked: false };

    return {
      blocked: true,
      message:
        `Research-before-propose: transitioning to "${to}" requires ${minEvidence} evidence ` +
        `file read(s) this task turn; you have ${count}.\n\n` +
        `Before transitioning to a proposal phase, read relevant files from:\n` +
        `  .workflow/state/decisions.md, feedback-patterns.md, app-map.md, function-map.md\n` +
        `  the task spec (.workflow/changes/<taskId>.md or .workflow/specs/<id>.md)\n` +
        `  .workflow/epics/ if this task belongs to an epic\n\n` +
        `AskUserQuestion is not blocked — ask if clarification is genuinely needed.`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[ResearchEvidenceGate] Phase-transition gate error (fail-open): ${err.message}`);
    }
    return { blocked: false };
  }
}

/**
 * Clear evidence state. Called at:
 *   - New task start (pre-tool-use.js Skill hook for wogi-start)
 *   - Session end
 *   - Post-compact (forces re-read in new context)
 */
function clearResearchEvidence() {
  try {
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify({ reads: {} }, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[ResearchEvidenceGate] Failed to clear evidence: ${err.message}`);
    }
  }
}

module.exports = {
  recordEvidenceRead,
  checkSpecWriteGate,
  checkDispatchEvidenceGate,
  checkPhaseTransitionEvidence,
  clearResearchEvidence,
  getEvidenceCount,
  EVIDENCE_FILE,
  EVIDENCE_PREFIXES,
  PROPOSAL_PREFIXES,
  DEFAULT_MIN_EVIDENCE
};
