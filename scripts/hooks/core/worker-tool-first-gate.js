'use strict';

/**
 * Worker Tool-First Turn Gate — G1 + G4 + G6 (epic wf-34290000, Workstream G)
 *
 * In workspace worker mode, every turn that follows a UserPromptSubmit
 * (channel dispatch from the manager) MUST contain at least one tool call,
 * and — in strict mode — the first assistant content block MUST be a tool
 * call, not text.
 *
 * Why this exists
 * ----------------
 * Workers communicate with the manager via tool calls (channel dispatches,
 * file edits, test runs) and structured `## Results` payloads. A pure-text
 * response from a worker is invisible to the user (who only sees the manager
 * terminal) and disqualifies the worker from the three-state end-of-turn
 * contract (ACTION | ESCALATION | IDLE — see CLAUDE.md rule "Workspace
 * Autonomous-Mode Action-After-Completion Contract").
 *
 * Three violations this gate detects
 * ----------------------------------
 *   G1 — silent halt:            zero tool_use blocks in the turn
 *   G4 — text-before-tool-call:  first content block is text, not tool_use
 *                                (strict mode only)
 *   G6 — documented contract:    the named "worker-tool-first-turn" rule
 *                                referenced in block messages, so the worker
 *                                sees one coherent contract, not three gates.
 *
 * Fail-open throughout: missing transcript, parse errors, config errors all
 * return `{ blocked: false }`. Silent-halt false-negatives are recoverable;
 * blocking legitimate stops on a gate bug is not.
 *
 * Scope: worker mode only. Main-mode (non-workspace) turns are unaffected —
 * the caller must gate on `isWorkerMode()` before invoking this check.
 */

const fs = require('node:fs');

const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;  // 4MB cap — large transcripts read last-N lines only

/**
 * Inspect the current turn in a worker transcript and determine whether it
 * violates the tool-first contract.
 *
 * @param {Object} opts
 * @param {string} opts.transcriptPath - absolute path to Claude Code JSONL transcript
 * @param {boolean} [opts.strict=true]  - when true, also flag text-before-tool-call
 * @returns {{ blocked: boolean, reason?: string, violation?: 'silent-halt'|'text-before-tool-call', ruleId?: string }}
 */
function checkWorkerToolFirstTurn(opts) {
  const { transcriptPath, strict = true } = opts || {};
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    return { blocked: false, reason: 'no-transcript-path' };
  }

  const events = readTranscript(transcriptPath);
  if (!events) {
    return { blocked: false, reason: 'transcript-unreadable' };
  }

  const turn = extractCurrentTurn(events);
  if (!turn) {
    return { blocked: false, reason: 'no-current-turn' };
  }

  // G1 — zero tool_use blocks across the entire turn.
  if (turn.toolUseCount === 0) {
    return {
      blocked: true,
      violation: 'silent-halt',
      ruleId: 'worker-tool-first-turn',
      reason: 'worker turn after UserPromptSubmit had zero tool calls (silent-halt / text-only response)'
    };
  }

  // G4 — first content block is text, not tool_use (strict mode only).
  if (strict && turn.firstBlockType === 'text') {
    return {
      blocked: true,
      violation: 'text-before-tool-call',
      ruleId: 'worker-tool-first-turn',
      reason: 'worker turn began with a text block before any tool call (text-before-tool-call)'
    };
  }

  return { blocked: false };
}

/**
 * Read a JSONL transcript and return parsed event objects. Large transcripts
 * are truncated to the last MAX_TRANSCRIPT_BYTES by reading the file size
 * and, if oversized, reading only the tail. This bounds per-Stop overhead.
 *
 * Returns null on any IO failure (fail-open signal to the caller).
 */
function readTranscript(p) {
  let raw;
  try {
    const stat = fs.statSync(p);
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      // Read the last MAX_TRANSCRIPT_BYTES — the first partial line will be
      // dropped by JSON.parse failure (we skip unparseable lines).
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
        fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, stat.size - MAX_TRANSCRIPT_BYTES);
        raw = buf.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(p, 'utf-8');
    }
  } catch (_err) {
    return null;
  }
  if (!raw) return [];

  const events = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (_err) {
      // Unparseable line (likely the truncated first line when we tailed the
      // file, or a mid-write line) — skip.
    }
  }
  return events;
}

/**
 * From a list of transcript events, isolate the current turn: everything
 * AFTER the most recent user message. Returns turn-level summary:
 *
 *   {
 *     toolUseCount: number,      // total tool_use blocks in the turn
 *     firstBlockType: 'text'|'tool_use'|null,  // first assistant block type
 *     assistantEventCount: number
 *   }
 *
 * Returns null if no user message is found (pre-dispatch — not a worker turn
 * we should gate).
 */
function extractCurrentTurn(events) {
  if (!Array.isArray(events) || events.length === 0) return null;

  // Find the last user message index. Scan from end.
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (isUserEvent(events[i])) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;

  // Collect assistant blocks after the last user message, in order.
  let toolUseCount = 0;
  let firstBlockType = null;
  let assistantEventCount = 0;

  for (let i = lastUserIdx + 1; i < events.length; i++) {
    const entry = events[i];
    if (!isAssistantEvent(entry)) continue;
    assistantEventCount++;
    const blocks = extractContentBlocks(entry);
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const t = block.type;
      if (!firstBlockType && (t === 'text' || t === 'tool_use')) {
        firstBlockType = t;
      }
      if (t === 'tool_use') {
        toolUseCount++;
      }
    }
  }

  return { toolUseCount, firstBlockType, assistantEventCount };
}

function isUserEvent(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return (
    entry.role === 'user' ||
    entry.type === 'user' ||
    (entry.message && entry.message.role === 'user')
  );
}

function isAssistantEvent(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return (
    entry.role === 'assistant' ||
    entry.type === 'assistant' ||
    (entry.message && entry.message.role === 'assistant')
  );
}

/**
 * Extract the content-blocks array from a transcript event. Claude Code's
 * transcript format has evolved, so accept any of:
 *   { content: [ {...} ] }
 *   { message: { content: [ {...} ] } }
 *   { content: 'string' }       → [{ type: 'text', text: 'string' }]
 *   { message: { content: '...' } } same
 */
function extractContentBlocks(entry) {
  const content = entry.content ?? entry.message?.content;
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [];
}

/**
 * Render the standard block message the Stop hook returns when a violation
 * is detected. Centralised so G6 (contract name) stays consistent across
 * violations.
 */
function renderBlockMessage({ violation, reason }) {
  const port = process.env.WOGI_MANAGER_PORT || '8800';
  const repo = process.env.WOGI_REPO_NAME || '<worker>';
  const head = violation === 'text-before-tool-call'
    ? 'WORKER CONTRACT VIOLATION: text-before-tool-call'
    : 'WORKER CONTRACT VIOLATION: silent-halt (zero tool calls)';
  return [
    head,
    '',
    `Rule: worker-tool-first-turn`,
    `Why: ${reason}`,
    '',
    'The worker start-of-turn contract requires every turn after a UserPromptSubmit to',
    'have at least one tool call, with the first content block being a tool call in',
    'strict mode. Pure-text responses are invisible to the user and disqualify the',
    'three-state end-of-turn contract (ACTION | ESCALATION | IDLE).',
    '',
    'Do ONE of these NOW:',
    '  (a) ACTION — invoke the tool you intended to use',
    '  (b) ESCALATE — channel-dispatch a "## QUESTION:" to the manager:',
    `      curl -s -X POST http://127.0.0.1:${port} \\`,
    `        -H "X-Wogi-From: ${repo}" \\`,
    `        --data-binary "## QUESTION: <your question>"`,
    '  (c) REPLY with ## Results — channel-dispatch the structured task reply to manager',
    '',
    'Then end the turn.'
  ].join('\n');
}

/**
 * Convenience: determine worker mode from env. Exported so callers don\'t
 * have to duplicate the env-check pattern.
 */
function isWorkerMode() {
  return Boolean(
    process.env.WOGI_WORKSPACE_ROOT &&
    process.env.WOGI_REPO_NAME &&
    process.env.WOGI_REPO_NAME !== 'manager'
  );
}

module.exports = {
  checkWorkerToolFirstTurn,
  renderBlockMessage,
  isWorkerMode,
  // Exported for tests
  extractCurrentTurn,
  readTranscript
};
