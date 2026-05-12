#!/usr/bin/env node

/**
 * Wogi Flow — Research-Required Stop-Hook Gate (wf-5cd71b1f)
 *
 * Companion to research-required-classifier.js. The classifier runs at
 * UserPromptSubmit and writes a marker when the user's prompt is diagnostic
 * (Tier 2/3). This gate runs at Stop hook time:
 *
 *   1. Read the marker
 *   2. Parse the transcript for the current turn (assistant entries since
 *      the most recent user entry)
 *   3. Count tool_use blocks where tool name is "Read" against an evidence
 *      path (lib/, scripts/, src/, .workflow/state/, .workflow/changes/, etc.)
 *      Also count Bash invocations with cat/head/tail/grep/rg targeting
 *      evidence paths.
 *   4. If count < requiredEvidence:
 *      - Increment marker.attemptCount
 *      - If attemptCount > maxAttempts: hard-stop with user-visible message
 *      - Otherwise: re-prompt the AI with violation message (continue:true,
 *        stopReason)
 *   5. If count >= requiredEvidence: consume marker, allow stop
 *
 * Mirrors the worker-tool-first-gate pattern: Stop hook owns the redo loop;
 * the AI cannot bypass because Stop fires after every assistant turn.
 *
 * Fail-open throughout — any error in transcript parsing or marker handling
 * falls through (allow stop).
 */

const fs = require('node:fs');
const path = require('node:path');

const classifier = require('./research-required-classifier');

// Evidence-path prefixes — Read against these counts as evidence.
const EVIDENCE_PREFIXES = [
  '.workflow/state/',
  '.workflow/changes/',
  '.workflow/specs/',
  '.workflow/epics/',
  'lib/',
  'scripts/',
  'src/',
  'tests/',
  'app/'
];

const BASH_READ_COMMANDS = ['cat', 'head', 'tail', 'less', 'view', 'grep', 'rg', 'jq', 'awk', 'sed'];

function isEvidencePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  // Normalize path separators
  const norm = filePath.replace(/\\/g, '/');
  // Strip leading absolute-path noise — match by suffix containment of any prefix
  for (const pre of EVIDENCE_PREFIXES) {
    if (norm.includes(pre)) return true;
  }
  return false;
}

/**
 * Parse a Bash command for evidence-path reads. Looks for read-style commands
 * followed by an arg matching evidence prefixes.
 */
function bashReadsEvidence(command) {
  if (typeof command !== 'string' || !command) return false;
  // Strip common shell pipe/redirect noise but keep args
  const tokens = command.split(/[\s|;&]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^["']|["']$/g, ''); // strip surrounding quotes
    const baseCmd = path.basename(tok);
    if (!BASH_READ_COMMANDS.includes(baseCmd)) continue;
    // Look at subsequent tokens for an evidence-path arg
    for (let j = i + 1; j < Math.min(tokens.length, i + 10); j++) {
      const arg = tokens[j].replace(/^["']|["']$/g, '');
      if (arg.startsWith('-')) continue; // flag, skip
      if (isEvidencePath(arg)) return true;
    }
  }
  return false;
}

/**
 * Read JSONL transcript and find assistant tool_use blocks since the most
 * recent user entry. Returns an array of normalized tool calls:
 *   [{ name: 'Read'|'Bash'|'...', input: object }]
 *
 * Defensive parsing — JSONL with malformed lines is tolerated.
 */
function readTranscriptAssistantTools(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return [];
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf-8'); } catch (_err) { return []; }
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch (_err) { /* skip malformed */ }
  }

  // Find index of last user entry — current turn is everything after it
  let lastUserIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || typeof e !== 'object') continue;
    const role = e.role ?? e.type ?? e.message?.role;
    if (role === 'user') { lastUserIdx = i; break; }
  }

  const turnEntries = lastUserIdx >= 0 ? entries.slice(lastUserIdx + 1) : entries;

  const toolCalls = [];
  for (const e of turnEntries) {
    if (!e || typeof e !== 'object') continue;
    const role = e.role ?? e.type ?? e.message?.role;
    if (role !== 'assistant') continue;
    const content = e.content ?? e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type !== 'tool_use') continue;
      toolCalls.push({ name: block.name, input: block.input || {} });
    }
  }
  return toolCalls;
}

/**
 * Count evidence reads in the current turn.
 */
function countEvidenceReads(transcriptPath) {
  const toolCalls = readTranscriptAssistantTools(transcriptPath);
  let count = 0;
  for (const tc of toolCalls) {
    if (tc.name === 'Read' && tc.input && isEvidencePath(tc.input.file_path)) {
      count += 1;
      continue;
    }
    if (tc.name === 'Bash' && tc.input && bashReadsEvidence(tc.input.command)) {
      count += 1;
      continue;
    }
    // Glob/Grep also count as evidence-gathering
    if ((tc.name === 'Glob' || tc.name === 'Grep') && tc.input) {
      const probe = tc.input.path || tc.input.pattern || '';
      if (typeof probe === 'string' && (isEvidencePath(probe) || probe.includes('*'))) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Stop-hook gate entry. Fail-open throughout.
 *
 * @param {Object} opts
 * @param {string} [opts.transcriptPath] - JSONL transcript path
 * @param {Object} [opts.config]
 * @returns {{ blocked: boolean, hardStop?: boolean, message?: string, evidenceCount?: number, requiredEvidence?: number }}
 */
function checkResearchRequiredGate(opts = {}) {
  try {
    const config = opts.config || {};
    if (!classifier.isClassifierEnabled(config)) return { blocked: false };

    const marker = classifier.loadMarker();
    if (!marker || marker.category !== 'diagnostic') return { blocked: false };

    const requiredEvidence = marker.requiredEvidence || classifier.getRequiredEvidence(config);
    const evidenceCount = countEvidenceReads(opts.transcriptPath);

    if (evidenceCount >= requiredEvidence) {
      classifier.clearMarker();
      return { blocked: false, evidenceCount, requiredEvidence };
    }

    const maxAttempts = classifier.getMaxAttempts(config);
    const next = classifier.bumpMarkerAttempt(marker);

    if (next.attemptCount > maxAttempts) {
      classifier.clearMarker();
      return {
        blocked: true,
        hardStop: true,
        evidenceCount,
        requiredEvidence,
        message:
          `RESEARCH-REQUIRED HARD-STOP: the AI failed the research gate ${maxAttempts} times for a diagnostic ` +
          `prompt and has not read evidence. Escalating to user.\n\n` +
          `Diagnostic prompt match: "${marker.match}"\n` +
          `Evidence read: ${evidenceCount} (minimum required: ${requiredEvidence}).\n\n` +
          `User: please review whether the AI is missing context or whether the gate is mis-classifying.`
      };
    }

    // wf-1bcc67d5: the marker now carries category 'diagnostic' OR 'locational'.
    // For locational ("where does X live", "which file handles Y"), the message
    // is sharper — answering from prior knowledge is the precise failure shape.
    const isLocational = marker.category === 'locational';
    const kind = isLocational ? 'project-specific locational question' : 'diagnostic question';
    return {
      blocked: true,
      hardStop: false,
      evidenceCount,
      requiredEvidence,
      message:
        `RESEARCH-REQUIRED VIOLATION: the user asked a ${kind} (matched "${marker.match}") ` +
        `but you produced an answer with only ${evidenceCount} evidence read${evidenceCount === 1 ? '' : 's'} ` +
        `(minimum required: ${requiredEvidence}).\n\n` +
        (isLocational
          ? `You answered "${kind === 'project-specific locational question' ? 'where/which/how X works in this project' : '...'}" WITHOUT opening a file. That is the exact failure wf-1bcc67d5 exists to stop: a confident model pattern-matching to industry defaults instead of checking THIS codebase, then doubling down. Do NOT answer from prior knowledge.\n\n`
          : '') +
        `Re-do this turn:\n` +
        `  1. Identify the relevant code/state files for the question (grep first if you're not sure where).\n` +
        `  2. Read at least ${requiredEvidence} of them via the Read tool. Bash with cat/head/grep/rg/Glob/Grep ` +
        `against evidence paths also counts.\n` +
        `  3. THEN answer — and the answer MUST cite the file:line(s) you actually read. An uncited answer to a ` +
        `${kind} is not acceptable.\n\n` +
        `Evidence prefixes that count: .workflow/state/, .workflow/changes/, lib/, scripts/, src/, tests/, app/.\n\n` +
        `If you genuinely cannot find the relevant files after grepping, say so explicitly and ask the user via ` +
        `\`flow ask "<question>"\` — do NOT guess.\n` +
        `If this is genuinely a generic-knowledge question (not about this project), the user can prefix their ` +
        `next prompt with \`!\` to skip the gate.\n\n` +
        `Attempt ${next.attemptCount}/${maxAttempts}.`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[research-required-gate] error (fail-open): ${err.message}`);
    }
    return { blocked: false };
  }
}

module.exports = {
  checkResearchRequiredGate,
  countEvidenceReads,
  readTranscriptAssistantTools,
  isEvidencePath,
  bashReadsEvidence,
  EVIDENCE_PREFIXES,
  BASH_READ_COMMANDS
};
