'use strict';

/**
 * Wogi Flow — Self-Adversary PreToolUse Gate (wf-e399bd8d)
 *
 * Intercepts AskUserQuestion tool calls. If the question classifier
 * returns IMPLEMENTATION with high confidence AND no recent self-
 * adversary loop completion marker exists, BLOCK the call with
 * instructions to run the loop first.
 *
 * State markers used:
 *   .workflow/state/self-adversary-complete.json
 *     Written by the loop when it produces a confident decision.
 *     Single-use; cleared on consumption.
 *     Shape:
 *       {
 *         completedAt: ISO timestamp,
 *         questionHash: SHA-256-hex (first 16) of the original question,
 *         decision, confidence, iterationCount,
 *         expiresAt: ISO timestamp (5 min TTL)
 *       }
 *
 *   .workflow/state/self-adversary-escalation.json
 *     Written by the loop when iteration exhausts. Indicates the AI
 *     DID iterate but still needs the user. Allows AskUserQuestion to
 *     pass through without re-running the loop. Single-use, 5 min TTL.
 *
 * Note: the classifier is async (Haiku call). PreToolUse hooks must
 * return promptly. Two options:
 *   A) Block all AskUserQuestion calls if classifier hasn't pre-run,
 *      requiring the AI to explicitly invoke the loop first.
 *   B) Run classifier inline (async) and block based on result.
 *
 * Approach: (A) primary path, with a synchronous heuristic fallback
 * that catches obvious implementation phrasings. The synchronous
 * heuristic uses keyword presence (NOT user-input parsing — this is
 * AI-authored question text, the "no regex on user answers" rule
 * doesn't apply). The classifier itself is invoked from the user-
 * prompt-submit hook (where async is fine) OR by the AI explicitly
 * via the wogi-self-adversary skill.
 *
 * Fail-open: any error → allow the AskUserQuestion through.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PATHS } = require('../../flow-utils');
const { safeJsonParse } = require('../../flow-io');

const COMPLETE_FILE = 'self-adversary-complete.json';
const ESCALATION_FILE = 'self-adversary-escalation.json';
const DEFAULT_TTL_SECONDS = 300; // 5 min

function getCompletePath() { return path.join(PATHS.state, COMPLETE_FILE); }
function getEscalationPath() { return path.join(PATHS.state, ESCALATION_FILE); }

function hashQuestion(text) {
  if (typeof text !== 'string') return '';
  // wf-6e31850e (S-4): use 32-char (128-bit) instead of 16-char (64-bit).
  // 64-bit was below NIST collision-resistance recommendation; 128-bit is
  // standard. Birthday-bound collision moves from ~2^32 to ~2^64 questions.
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function isGateEnabled(config) {
  const cfg = config?.selfAdversaryGate;
  if (cfg === false) return false;
  if (cfg && typeof cfg === 'object' && cfg.enabled === false) return false;
  return true;
}

function loadMarker(filePath) {
  const data = safeJsonParse(filePath, null);
  if (!data || typeof data !== 'object') return null;
  if (data.expiresAt) {
    const exp = Date.parse(data.expiresAt);
    if (Number.isFinite(exp) && exp < Date.now()) return null;
  }
  return data;
}

function consumeMarker(filePath) {
  try { fs.unlinkSync(filePath); } catch (_err) { /* fine */ }
}

function writeCompletionMarker({ question, decision, confidence, iterationCount, ttlSec }) {
  try {
    const ttl = Number.isFinite(ttlSec) ? ttlSec : DEFAULT_TTL_SECONDS;
    const now = Date.now();
    const payload = {
      version: 1,
      completedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      questionHash: hashQuestion(question),
      decision: typeof decision === 'string' ? decision.slice(0, 500) : '',
      confidence: Number.isFinite(confidence) ? Math.round(confidence) : 0,
      iterationCount: Number.isFinite(iterationCount) ? iterationCount : 0
    };
    fs.mkdirSync(path.dirname(getCompletePath()), { recursive: true });
    fs.writeFileSync(getCompletePath(), JSON.stringify(payload, null, 2));
    return payload;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[self-adversary-gate] writeCompletionMarker failed: ${err.message}`);
    }
    return null;
  }
}

function writeEscalationMarker({ question, decision, confidence, iterationCount, reason, ttlSec }) {
  try {
    const ttl = Number.isFinite(ttlSec) ? ttlSec : DEFAULT_TTL_SECONDS;
    const now = Date.now();
    const payload = {
      version: 1,
      escalatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      questionHash: hashQuestion(question),
      reason: typeof reason === 'string' ? reason : 'unknown',
      bestDecision: typeof decision === 'string' ? decision.slice(0, 500) : '',
      finalConfidence: Number.isFinite(confidence) ? Math.round(confidence) : 0,
      iterationCount: Number.isFinite(iterationCount) ? iterationCount : 0
    };
    fs.mkdirSync(path.dirname(getEscalationPath()), { recursive: true });
    fs.writeFileSync(getEscalationPath(), JSON.stringify(payload, null, 2));
    return payload;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[self-adversary-gate] writeEscalationMarker failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Synchronous heuristic: does this question text LOOK implementation-class?
 * Used as a fallback when the async classifier hasn't run. Conservative —
 * defaults to NOT-implementation when ambiguous so AskUserQuestion passes.
 * This is NOT user-input parsing (the text is AI-authored), so keyword
 * matching is acceptable here. The async classifier provides the
 * authoritative answer; this heuristic just catches the obvious cases.
 */
const IMPLEMENTATION_HEURISTIC_KEYWORDS = [
  /\bmap\(\)\s+(?:or|vs)\s+for(?:-loop)?/i,
  /\bwhich\s+(?:library|framework|algorithm|approach|pattern)\b/i,
  /\bshould\s+(?:i|we)\s+use\s+\w+\s+or\s+\w+/i,
  /\b(?:naming|name)\s+(?:convention|this|the\s+\w+)/i,
  /\b(?:refactor|extract|inline)\s+(?:this|the)\b/i,
  /\btest\s+(?:framework|library)\b/i,
  /\berror\s+handling\s+(?:approach|pattern|style)/i,
  /\bcode\s+(?:style|organization|structure)\b/i
];

const PRODUCT_HEURISTIC_KEYWORDS = [
  /\bwhat\s+(?:should|do)\s+(?:users?|customers?)\b/i,
  /\b(?:business|product)\s+(?:rule|decision|requirement)\b/i,
  /\bcounts?\s+as\s+(?:done|complete|valid)\b/i,
  /\bwhich\s+(?:behavior|outcome)\s+(?:do\s+you|should)\s+(?:want|prefer)\b/i,
  /\b(?:delete|drop|truncate|remove|destroy)\b.*\b(?:data|table|migration|user)/i
];

function heuristicCategory(questionText) {
  if (typeof questionText !== 'string') return 'unknown';
  for (const re of PRODUCT_HEURISTIC_KEYWORDS) {
    if (re.test(questionText)) return 'product';
  }
  for (const re of IMPLEMENTATION_HEURISTIC_KEYWORDS) {
    if (re.test(questionText)) return 'implementation';
  }
  return 'unknown';
}

/**
 * PreToolUse intercept on AskUserQuestion. Returns { blocked: bool, message? }.
 *
 * Decision tree:
 *   1. Gate disabled → allow.
 *   2. Tool is not AskUserQuestion → allow.
 *   3. Escalation marker present for this question → allow (loop already ran).
 *   4. Completion marker present for this question → allow (AI may follow up).
 *   5. Sync heuristic → 'implementation' → block with loop-first instructions.
 *   6. Otherwise → allow.
 *
 * The classifier itself (Haiku call) lives in flow-impl-question-classifier.js
 * and is invoked by the `wogi-self-adversary` skill or by the user-prompt-
 * submit hook for upstream classification — NOT from this synchronous gate.
 */
function checkSelfAdversaryGate(toolName, toolInput, config) {
  try {
    if (!isGateEnabled(config)) return { blocked: false };
    if (toolName !== 'AskUserQuestion') return { blocked: false };

    // Extract question text from the tool input shape (Claude Code's
    // AskUserQuestion accepts a `questions` array).
    let questionText = '';
    if (toolInput && Array.isArray(toolInput.questions) && toolInput.questions.length > 0) {
      const parts = [];
      for (const q of toolInput.questions) {
        if (q && typeof q.question === 'string') parts.push(q.question);
      }
      questionText = parts.join('\n');
    } else if (toolInput && typeof toolInput.prompt === 'string') {
      questionText = toolInput.prompt;
    }
    if (!questionText.trim()) return { blocked: false };

    const qHash = hashQuestion(questionText);

    // Check escalation marker
    const escalation = loadMarker(getEscalationPath());
    if (escalation && escalation.questionHash === qHash) {
      // Consume and allow — the loop already ran and confirmed user is needed.
      consumeMarker(getEscalationPath());
      return { blocked: false, reason: 'escalation-marker-consumed' };
    }

    // Check completion marker — AI already decided via loop, this AskUserQuestion
    // is a follow-up (e.g., "I decided X, but did you want Y instead?")
    const complete = loadMarker(getCompletePath());
    if (complete && complete.questionHash === qHash) {
      consumeMarker(getCompletePath());
      return { blocked: false, reason: 'completion-marker-consumed' };
    }

    // Sync heuristic
    const heuristic = heuristicCategory(questionText);
    if (heuristic !== 'implementation') {
      return { blocked: false, reason: `heuristic-${heuristic}` };
    }

    // Heuristic says implementation — block and require loop.
    return {
      blocked: true,
      reason: 'implementation-heuristic',
      message: buildBlockMessage(questionText, qHash)
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[self-adversary-gate] checkSelfAdversaryGate error (fail-open): ${err.message}`);
    }
    return { blocked: false };
  }
}

function buildBlockMessage(questionText, qHash) {
  const preview = questionText.slice(0, 240);
  return [
    'BLOCKED: AskUserQuestion looks like an implementation-class question.',
    '',
    'WogiFlow user directive (wf-e399bd8d): when you have doubt about an',
    'implementation decision (code structure, library choice, naming,',
    'refactor mechanics, etc.), self-adversary FIRST — iterate generator',
    'and adversary on different models until ≥95% confidence. Only escalate',
    'to the user if confidence stays low after the loop.',
    '',
    `Question intercepted: "${preview}${questionText.length > 240 ? '…' : ''}"`,
    `Question hash: ${qHash}`,
    '',
    'How to proceed:',
    '  1. RECOMMENDED — invoke the self-adversary skill:',
    '       Skill(skill="wogi-self-adversary", args="<the question + brief context>")',
    '     The skill runs the loop, writes a completion or escalation marker,',
    '     then either acts on the high-confidence decision or re-issues the',
    '     AskUserQuestion (which will now pass).',
    '',
    '  2. ESCAPE HATCH — if this is genuinely product / architecture /',
    '     sensitive, the heuristic is wrong. Re-phrase the question to make',
    '     the product-domain nature explicit (e.g., reference the user as',
    '     decision-maker, name business constraints), and try again.',
    '',
    '  3. OVERRIDE — set the question metadata to bypass (advanced only).',
    '',
    'See: scripts/hooks/core/self-adversary-gate.js, wf-e399bd8d.'
  ].join('\n');
}

module.exports = {
  checkSelfAdversaryGate,
  hashQuestion,
  isGateEnabled,
  loadMarker,
  consumeMarker,
  writeCompletionMarker,
  writeEscalationMarker,
  heuristicCategory,
  getCompletePath,
  getEscalationPath,
  COMPLETE_FILE,
  ESCALATION_FILE,
  DEFAULT_TTL_SECONDS,
  IMPLEMENTATION_HEURISTIC_KEYWORDS,
  PRODUCT_HEURISTIC_KEYWORDS
};
