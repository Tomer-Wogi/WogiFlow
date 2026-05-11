'use strict';

/**
 * Wogi Flow — AI-Based Deferral-Intent Classifier (wf-b8839d99)
 *
 * Replaces the prior regex-based deferral classifier. The user surfaced a
 * critical case on 2026-05-11: regex `/\bfix\s+(everything|all\s+of\s+(them|it)|all\s+findings?)\b/i`
 * did NOT match bare "fix all" — natural English the user actually typed.
 * Result: AI silently deferred findings the user had told it to fix.
 *
 * Why AI, not regex (user instruction, restated 2026-05-11):
 *   "Regex is prone to mistakes. I don't want regex or matching when I
 *    answer things like that. AI needs to get my responses and analyze them."
 *
 * Design mirrors flow-worker-question-classifier.js:
 *   - Single Haiku call per UserPromptSubmit
 *   - Returns {intent, confidence, reason, interpretation}
 *   - Fail-open: missing API key / model error → {classified: false} → no
 *     state change. The gate's default-restrictive behavior holds.
 *   - JSON validated for shape + prototype-pollution
 *
 * Three outputs the classifier produces:
 *   negative  — user wants no deferrals (any phrasing: "fix all", "I don't
 *               like tech debt", "no deferrals", "fix everything", etc.).
 *               Triggers no-defer-pin write + auth-marker clear.
 *   positive  — user explicitly authorized deferring specific items.
 *               Triggers auth-marker write with scope.
 *   none      — nothing relevant said. No state change.
 *
 * The classifier ALSO captures `interpretation`: the AI's brief explanation
 * of WHAT it understood the user to mean. This goes into the auth/pin marker
 * `source` field SEPARATELY from any verbatim quote — ending the "false
 * attribution" failure shape where the AI fabricated a "user said X" claim.
 */

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_MODEL = 'anthropic:claude-3-5-haiku-latest';
const MAX_PROMPT_CHARS = 4000;
const MAX_TOKENS = 400;
const TEMPERATURE = 0.0;

const { DANGEROUS_KEYS } = require('./flow-io');

/**
 * Build the deferral-intent classifier prompt.
 *
 * Designed to distinguish:
 *   - Explicit no-defer commands ("fix all", "fix everything", "no
 *     deferrals", "I don't like tech debt", "always fix it") → NEGATIVE
 *   - Explicit defer commands ("defer F5", "skip the low ones", "option 2",
 *     "ship as-is", "fix critical only") → POSITIVE
 *   - Everything else (unrelated chatter, ambiguous, conditional) → NONE
 *
 * Critical: the classifier MUST default to NONE on ambiguity. Granting
 * auth when in doubt is the original bug. Failing to detect a no-defer
 * is recoverable (user can repeat); silently granting auth is not.
 */
function buildDeferralPrompt(userPrompt) {
  return `You classify whether a user's message to an AI development assistant expresses deferral intent — and if so, which direction.

Three categories:

  NEGATIVE — user wants NO deferrals; everything should be fixed.
    Examples: "fix all", "fix everything", "fix all of them", "no deferrals",
    "I don't like tech debt", "don't defer anything", "ship everything fixed",
    "I always want it all fixed", "fix it all".

  POSITIVE — user explicitly authorizes deferring specific items.
    Examples: "defer F5", "skip the low-priority ones", "option 2", "option 4",
    "fix critical only", "ship as-is", "good enough for now", "create tasks
    for the rest", "leave that for later".

  NONE — neither. Includes:
    - Unrelated messages ("looks good", "thanks", "let's discuss X")
    - Ambiguous statements where defer-intent is unclear
    - Conditional / hypothetical ("we could defer X if needed" — that's
      reasoning aloud, not an authorization)
    - Questions about deferring without a directive
    - The word "defer" appearing in technical context (e.g., "defer the
      callback execution")

CRITICAL RULES:
  1. When ambiguous, return NONE. The cost of missing a defer signal is low
     (user can repeat); the cost of false-positive auth is high (AI defers
     work the user wanted done).
  2. NEGATIVE takes precedence. If the user says both "fix everything" AND
     "skip Y" in the same message, return NEGATIVE — they want it all.
  3. Standing preferences ("I always", "from now on", "as a rule") about
     deferring are NEGATIVE even if no current finding is in scope.
  4. Confidence: only >= 80 if the message is unambiguous about defer intent.
     Anything that requires reading between the lines is < 80.

[USER_MESSAGE_START]
${String(userPrompt || '').slice(0, MAX_PROMPT_CHARS)}
[USER_MESSAGE_END]

Return JSON only, no prose, no markdown fences:
{
  "intent": "negative" | "positive" | "none",
  "confidence": 0-100,
  "interpretation": "one short sentence: what you understood the user to mean",
  "scope": "all" | [array of finding IDs like F1, F2, M3] | null,
  "standing": true | false
}

Examples:
- "fix all" → {"intent":"negative","confidence":95,"interpretation":"user wants every finding fixed, no deferrals","scope":null,"standing":false}
- "I don't like tech debt" → {"intent":"negative","confidence":90,"interpretation":"standing preference against accumulating deferred work","scope":null,"standing":true}
- "defer F5 and F6, fix the rest" → {"intent":"positive","confidence":95,"interpretation":"user authorizes deferring F5 and F6 specifically","scope":["F5","F6"],"standing":false}
- "option 2" → {"intent":"positive","confidence":90,"interpretation":"user picked the fix-critical-only menu option","scope":"all","standing":false}
- "looks good, let's continue" → {"intent":"none","confidence":85,"interpretation":"acknowledgment, no defer signal","scope":null,"standing":false}
- "could we defer this?" → {"intent":"none","confidence":80,"interpretation":"question, not an authorization","scope":null,"standing":false}`;
}

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
 * Classify user-prompt deferral intent.
 *
 * @param {string} userPrompt - The user's message
 * @param {Object} [options]
 * @param {number} [options.minConfidence=75] - Confidence threshold for treating as actionable
 * @param {string} [options.model] - Model override
 * @returns {Promise<{
 *   classified: boolean,
 *   intent?: 'negative'|'positive'|'none',
 *   confidence?: number,
 *   interpretation?: string,
 *   scope?: string|string[]|null,
 *   standing?: boolean,
 *   actionable?: boolean,
 *   minConfidence?: number,
 *   reason?: string
 * }>}
 */
async function classifyUserDeferralIntent(userPrompt, options = {}) {
  const minConfidence = Number.isFinite(options.minConfidence) ? options.minConfidence : DEFAULT_MIN_CONFIDENCE;
  const model = options.model || DEFAULT_MODEL;

  if (typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
    return { classified: false, reason: 'empty-prompt' };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { classified: false, reason: 'no-credentials' };
  }

  let callModel;
  try {
    ({ callModel } = require('./flow-model-caller'));
  } catch (_err) {
    return { classified: false, reason: 'no-model-caller' };
  }

  const prompt = buildDeferralPrompt(userPrompt);

  let result;
  try {
    result = await callModel(model, prompt, {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[deferral-classifier-ai] model call failed: ${err.message}`);
    }
    return { classified: false, reason: 'model-error' };
  }

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

  const intentRaw = String(parsed.intent || '').toLowerCase();
  const intent = ['negative', 'positive', 'none'].includes(intentRaw) ? intentRaw : 'none';
  const confidence = Number.isFinite(parsed.confidence) ? Math.round(parsed.confidence) : 0;
  const interpretation = typeof parsed.interpretation === 'string'
    ? parsed.interpretation.slice(0, 500)
    : '';
  let scope = parsed.scope;
  if (scope === undefined) scope = null;
  if (typeof scope === 'string' && scope !== 'all') scope = null;
  if (Array.isArray(scope)) {
    scope = scope.filter(s => typeof s === 'string' && /^[A-Za-z]\d+$/.test(s.trim())).map(s => s.trim());
    if (scope.length === 0) scope = null;
  }
  const standing = Boolean(parsed.standing);

  return {
    classified: true,
    intent,
    confidence,
    interpretation,
    scope,
    standing,
    actionable: intent !== 'none' && confidence >= minConfidence,
    minConfidence
  };
}

module.exports = {
  classifyUserDeferralIntent,
  buildDeferralPrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MODEL
};
