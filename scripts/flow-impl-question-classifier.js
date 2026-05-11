'use strict';

/**
 * Wogi Flow — Implementation-Question Classifier (wf-e399bd8d)
 *
 * Classifies an "AI is about to ask the user" question to decide whether
 * the self-adversary loop should run first or the question should reach
 * the user directly.
 *
 * Four categories:
 *   implementation — code structure, library/algorithm choice, naming,
 *                    refactor mechanics, testing approach. The AI should
 *                    self-adversary (likely high enough confidence).
 *   product        — domain semantics, user-facing behavior, what to
 *                    SHOW the user, what counts as "done" for the
 *                    business. The AI cannot self-adversary; ask user.
 *   architecture   — system-design tradeoffs (DB choice, deployment
 *                    topology, public API shape). Tier-3: existing
 *                    researchReasoningGate handles this with adversary;
 *                    the new loop can also handle it but caller decides.
 *   sensitive      — destructive operations (delete, force-push, drop),
 *                    cross-boundary commitments (notify users, send
 *                    emails). Always ask.
 *
 * The classifier is a small Haiku call. Fail-open: any error → ask
 * (treat as if classification said "product"), preserving prior
 * behavior. This avoids the failure shape from wf-b8839d99 (regex
 * silently misclassifying).
 *
 * Note: this is interpretation of an AI-AUTHORED question (the question
 * the AI is about to ask the user). It is NOT user-input parsing — so
 * the "no regex on user answers" rule from wf-b8839d99 doesn't constrain
 * us. We still use AI here because hedging vocabulary for implementation
 * vs product is unbounded.
 */

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_MODEL = 'anthropic:claude-3-5-haiku-latest';
const MAX_QUESTION_CHARS = 3000;
const MAX_TOKENS = 300;
const TEMPERATURE = 0.0;

const { DANGEROUS_KEYS } = require('./flow-io');

function hasDangerousKeys(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasDangerousKeys);
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys(value[key])) return true;
  }
  return false;
}

function buildClassifierPrompt(questionText) {
  return `You classify the type of question an AI development assistant is about to ask the user. The user has instructed the AI to STOP asking implementation-class questions — instead, the AI should iterate generator↔adversary on a different model until ≥95% confidence. Product, architecture, or sensitive questions still reach the user normally.

[QUESTION_START]
${String(questionText || '').slice(0, MAX_QUESTION_CHARS)}
[QUESTION_END]

Four categories:

  IMPLEMENTATION — code structure, library or algorithm choice, naming,
    refactor mechanics, test framework picks, error-handling shape, code
    organization, idiom selection. The AI can reason this out with research.

  PRODUCT — domain semantics, user-facing behavior decisions, feature
    scope, what counts as "done" for the business, copy/tone, UX flow
    decisions. The AI cannot reason its way to these without the owner.

  ARCHITECTURE — system-design tradeoffs (database choice, deployment
    topology, public API shape, multi-tenant boundaries). High-stakes;
    self-adversary alone may not be enough but more iteration helps.

  SENSITIVE — destructive operations (delete data, force-push, drop
    table), cross-boundary commitments (notify users, send emails),
    legal/compliance gates. Always ask the user.

CRITICAL RULES:
  1. When ambiguous, return PRODUCT — the cost of mis-asking is low, the
     cost of mis-acting is high.
  2. Even if the question phrasing is technical, ask whether the ANSWER
     depends on user-only knowledge. "Which date format do users
     prefer?" — phrasing is technical, answer is product.
  3. Confidence: only ≥80 if the category is unambiguous.

Return JSON only, no prose, no markdown fences:
{
  "category": "implementation" | "product" | "architecture" | "sensitive",
  "confidence": 0-100,
  "reason": "one short sentence"
}

Examples:
- "Should this be a map() or for-loop?" → {"category":"implementation","confidence":95,"reason":"pure code-style choice"}
- "Which date format do users prefer?" → {"category":"product","confidence":90,"reason":"answer depends on user preference"}
- "Should we use Postgres or MongoDB?" → {"category":"architecture","confidence":85,"reason":"system-design tradeoff"}
- "OK to delete the migration table?" → {"category":"sensitive","confidence":95,"reason":"destructive operation"}
- "Should I add error handling here?" → {"category":"implementation","confidence":85,"reason":"code-quality choice the AI can research"}`;
}

async function classifyImplementationQuestion(questionText, options = {}) {
  const minConfidence = Number.isFinite(options.minConfidence) ? options.minConfidence : DEFAULT_MIN_CONFIDENCE;
  const model = options.model || DEFAULT_MODEL;

  if (typeof questionText !== 'string' || questionText.trim().length === 0) {
    return { classified: false, reason: 'empty-question' };
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

  let result;
  try {
    result = await callModel(model, buildClassifierPrompt(questionText), {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS
    });
  } catch (err) {
    if (process.env.DEBUG) {
      // wf-6e31850e (S-2): sanitize potential API-key leakage in error messages.
      const safe = String(err.message || '').replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***');
      console.error(`[impl-question-classifier] model call failed: ${safe}`);
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

  const categoryRaw = String(parsed.category || '').toLowerCase();
  const category = ['implementation', 'product', 'architecture', 'sensitive'].includes(categoryRaw)
    ? categoryRaw
    : 'product'; // fail-safe default
  const confidence = Number.isFinite(parsed.confidence) ? Math.round(parsed.confidence) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '';

  return {
    classified: true,
    category,
    confidence,
    reason,
    shouldRunLoop: category === 'implementation' && confidence >= minConfidence,
    minConfidence
  };
}

module.exports = {
  classifyImplementationQuestion,
  buildClassifierPrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MODEL
};
