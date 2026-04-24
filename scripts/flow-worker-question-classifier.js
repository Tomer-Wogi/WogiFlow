'use strict';

/**
 * Wogi Flow — Worker Question Classifier (v2.21.0+)
 *
 * AI-based semantic detector that runs at Stop-hook time in workspace worker
 * mode and answers ONE question about the AI's final assistant message:
 *
 *   "Does this message end by asking the user a question that expects
 *    a user response?"
 *
 * If YES + confidence >= threshold + worker mode → Stop hook blocks the turn
 * with instructions to channel-dispatch `## QUESTION:` to the manager instead.
 *
 * Why AI, not regex: the hedging vocabulary is infinite ("let me know",
 * "should I", "which option", "?", "thoughts?", "any preference?"). User
 * explicitly requested AI logic over regex in the 2026-04-16 session.
 *
 * Design mirrors flow-conclusion-classifier.js / flow-correction-detector.js:
 *   - Uses existing flow-model-caller.js infrastructure (same plan tokens
 *     Claude Code already uses)
 *   - ANTHROPIC_API_KEY absent → returns `{ classified: false, reason:
 *     'no-credentials' }` — Stop hook treats as no-op, does NOT block.
 *     This matches the established fail-open pattern.
 *   - Transcript parsing is defensive — missing, empty, or malformed
 *     transcript returns `{ classified: false, reason: <specific> }`.
 *   - JSON response from Haiku validated for shape + prototype-pollution.
 *   - Fail-open on model error — if the classifier breaks, legitimate
 *     stops are not affected. A silent-stall false-negative is recoverable;
 *     a false-positive block on every turn is not.
 */

const fs = require('node:fs');

const DEFAULT_MIN_CONFIDENCE = 70;
const DEFAULT_MODEL = 'anthropic:claude-3-5-haiku-latest';
const MAX_MESSAGE_CHARS = 8000;     // Classifier input cap
const MAX_TOKENS = 300;             // Classifier output cap (tiny JSON)
const TEMPERATURE = 0.0;            // Deterministic classification

// Shared prototype-pollution guard (same as flow-conclusion-classifier).
const { DANGEROUS_KEYS } = require('./flow-io');

/**
 * Extract the final assistant message from a Claude Code transcript JSONL file.
 *
 * Claude Code writes one JSON object per line. Each object represents an event
 * (user message, assistant message, tool call, tool result, etc.). We scan
 * backward for the last event where the content resembles an assistant-authored
 * text block (has `role: 'assistant'` OR `type: 'assistant'` shape).
 *
 * Defensive: any IO / parse error returns null. Caller treats null as no-op.
 *
 * @param {string} transcriptPath - Absolute path to the JSONL transcript
 * @returns {string|null} The text of the last assistant message, or null
 */
function extractLastAssistantMessage(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch (_err) {
    return null;
  }
  if (!raw || raw.length === 0) return null;

  // Scan from end for lines we can parse as assistant messages.
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_err) {
      continue;  // Skip unparseable lines — transcript may be mid-write.
    }
    const text = extractAssistantText(entry);
    if (text) return text.slice(0, MAX_MESSAGE_CHARS);
  }
  return null;
}

/**
 * Pull assistant-authored text out of a single transcript entry. The transcript
 * format has evolved across Claude Code versions — we accept any of:
 *   - { role: 'assistant', content: 'string' }
 *   - { role: 'assistant', content: [{ type: 'text', text: '...' }] }
 *   - { type: 'assistant', message: { content: [{ type: 'text', text: '...' }] } }
 *   - { type: 'assistant', text: '...' }
 */
function extractAssistantText(entry) {
  if (!entry || typeof entry !== 'object') return null;

  // Direct role/type check.
  const isAssistant =
    entry.role === 'assistant' ||
    entry.type === 'assistant' ||
    (entry.message && entry.message.role === 'assistant');
  if (!isAssistant) return null;

  // Pull the content wherever it lives.
  const content = entry.content ?? entry.message?.content ?? entry.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Collect text blocks only — skip tool_use / tool_result blocks.
    const texts = content
      .filter(b => b && typeof b === 'object' && (b.type === 'text' || typeof b.text === 'string'))
      .map(b => String(b.text || ''))
      .filter(Boolean);
    if (texts.length > 0) return texts.join('\n').trim();
  }
  return null;
}

/**
 * Build the Haiku classifier prompt. Kept as a pure string for testability.
 *
 * Designed to minimize false positives:
 *   - Rhetorical questions ("Did the tests pass? Yes.") → NO
 *   - Narration with trailing "?" ("the question is how to proceed") → NO
 *   - Actual open-ended ask ("Should I use A or B?" with no answer given) → YES
 */
function buildClassifierPrompt(lastMessage) {
  return `You classify whether an AI assistant's final message to a WORKSPACE WORKER session ends by asking the USER a question that expects a user response.

Context: in workspace mode, workers are autonomous and MUST NOT prompt the user directly — the user only sees the manager terminal, so direct questions stall silently. Workers that need user input MUST channel-dispatch "## QUESTION:" to the manager instead.

Your job: classify YES only when the worker's final message contains an OPEN question the worker is waiting on the user to answer. Classify NO for rhetorical questions that the worker answers itself, narrative descriptions, or questions that have an accompanying decision.

[MESSAGE_START]
${String(lastMessage || '').slice(0, MAX_MESSAGE_CHARS)}
[MESSAGE_END]

Return JSON only, no prose, no markdown fences:
{"isUserQuestion": true|false, "confidence": 0-100, "reason": "one short sentence"}

Examples:
- "Should I proceed with A or B? Let me know." → {"isUserQuestion": true, "confidence": 95, "reason": "open choice awaiting user decision"}
- "Did the tests pass? Yes, all 12 passed." → {"isUserQuestion": false, "confidence": 90, "reason": "rhetorical, answered inline"}
- "I finished the task. Awaiting your signal." → {"isUserQuestion": true, "confidence": 85, "reason": "hedging terminal state awaiting user"}
- "Task complete. Next: wf-abc12345 — starting now." → {"isUserQuestion": false, "confidence": 95, "reason": "action statement, no question"}`;
}

/**
 * Build the main-mode classifier prompt. Used by the task-boundary-reset path
 * in solo/main-mode sessions to detect when the AI forgot to call `flow ask`
 * before ending a turn with a user-facing question. A YES classification
 * auto-writes the pending-question marker and defers the restart.
 *
 * Same shape as buildClassifierPrompt — only the contextual framing differs.
 */
function buildMainModePrompt(lastMessage) {
  return `You classify whether an AI assistant's final message to a SOLO (non-workspace) session ends by asking the USER a question that expects a user response.

Context: in solo mode the session has a task-boundary session-restart feature. Before the restart fires, this classifier checks whether the AI is waiting on a user answer. If YES, the restart is deferred so the user's next reply lands in the same session context. The safety net exists because the AI should have called \`flow ask\` manually but sometimes forgets.

Your job: classify YES only when the AI's final message contains an OPEN question the AI is waiting on the user to answer. Classify NO for rhetorical questions the AI answers itself, narrative descriptions, "here are your options" menus with the AI continuing after, or questions that have an accompanying decision.

[MESSAGE_START]
${String(lastMessage || '').slice(0, MAX_MESSAGE_CHARS)}
[MESSAGE_END]

Return JSON only, no prose, no markdown fences:
{"isUserQuestion": true|false, "confidence": 0-100, "reason": "one short sentence"}

Examples:
- "Confirm this approach, or want a different split?" → {"isUserQuestion": true, "confidence": 95, "reason": "open confirm/alternate awaiting user"}
- "Option 1 (rule only) or option 2 (classifier)?" → {"isUserQuestion": true, "confidence": 95, "reason": "binary choice awaiting user"}
- "Did the tests pass? Yes, all 12 passed." → {"isUserQuestion": false, "confidence": 90, "reason": "rhetorical, answered inline"}
- "Task complete. Moving to next task now." → {"isUserQuestion": false, "confidence": 95, "reason": "action statement, no question"}
- "Implementation done — committing and pushing." → {"isUserQuestion": false, "confidence": 95, "reason": "action statement, no question"}`;
}

/**
 * Guard parsed JSON response against prototype pollution. Mirrors
 * flow-conclusion-classifier.hasDangerousKeys.
 */
function hasDangerousKeys(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasDangerousKeys);
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys(value[key])) return true;
  }
  return false;
}

/**
 * Classify the assistant's last message in either worker or main mode.
 *
 * @param {Object} opts
 * @param {string} opts.transcriptPath - Absolute path to session JSONL transcript
 * @param {'worker'|'main'} [opts.mode='worker'] - Which prompt framing to use
 * @param {number} [opts.minConfidence] - Confidence threshold (default 70)
 * @param {string} [opts.model] - Model override (default haiku)
 * @returns {Promise<{
 *   classified: boolean,
 *   isUserQuestion?: boolean,
 *   confidence?: number,
 *   reason?: string,
 *   lastMessage?: string,
 *   blocked?: boolean,
 *   minConfidence?: number
 * }>}
 */
async function classifyQuestion(opts = {}) {
  const mode = opts.mode === 'main' ? 'main' : 'worker';
  const minConfidence = Number.isFinite(opts.minConfidence) ? opts.minConfidence : DEFAULT_MIN_CONFIDENCE;
  const model = opts.model || DEFAULT_MODEL;

  // Fail-open gates — any reason to skip returns { classified: false }.
  if (!process.env.ANTHROPIC_API_KEY) {
    return { classified: false, reason: 'no-credentials' };
  }
  if (!opts.transcriptPath) {
    return { classified: false, reason: 'no-transcript-path' };
  }

  const lastMessage = extractLastAssistantMessage(opts.transcriptPath);
  if (!lastMessage || lastMessage.length < 10) {
    return { classified: false, reason: 'no-last-message', lastMessage };
  }

  let callModel;
  try {
    ({ callModel } = require('./flow-model-caller'));
  } catch (_err) {
    return { classified: false, reason: 'no-model-caller' };
  }

  const prompt = mode === 'main'
    ? buildMainModePrompt(lastMessage)
    : buildClassifierPrompt(lastMessage);

  let result;
  try {
    result = await callModel(model, prompt, {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[question-classifier:${mode}] model call failed: ${err.message}`);
    }
    return { classified: false, reason: 'model-error' };
  }

  // flow-model-caller returns { success, response, ... } where `response` is the text.
  // Earlier classifiers read `.content`; accept both shapes for resilience.
  const raw = String(result?.response ?? result?.content ?? '').trim();
  if (!raw) return { classified: false, reason: 'empty-response' };

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { classified: false, reason: 'non-json-response' };

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (_err) {
    return { classified: false, reason: 'json-parse-error' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { classified: false, reason: 'bad-shape' };
  }
  if (hasDangerousKeys(parsed)) {
    return { classified: false, reason: 'dangerous-keys' };
  }

  const isUserQuestion = Boolean(parsed.isUserQuestion);
  const confidence = Number.isFinite(parsed.confidence) ? Math.round(parsed.confidence) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '';

  return {
    classified: true,
    isUserQuestion,
    confidence,
    reason,
    lastMessage,
    blocked: isUserQuestion && confidence >= minConfidence,
    minConfidence
  };
}

// Preserve the original worker-mode export name for zero signature break.
// New callers should prefer classifyQuestion({ mode }) directly.
async function classifyWorkerQuestion(opts = {}) {
  return classifyQuestion({ ...opts, mode: 'worker' });
}

module.exports = {
  classifyQuestion,
  classifyWorkerQuestion,
  extractLastAssistantMessage,
  extractAssistantText,
  buildClassifierPrompt,
  buildMainModePrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MODEL
};
