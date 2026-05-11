#!/usr/bin/env node

/**
 * Wogi Flow — Deferral Intent Classifier — Hook Wrapper (wf-b8839d99)
 *
 * Thin wrapper around the AI-based classifier (scripts/flow-deferral-classifier-ai.js).
 * Originally regex-based; replaced 2026-05-11 after the user surfaced the
 * "fix all" miss + false-attribution incident.
 *
 * User's instruction (2026-05-11):
 *   "Regex is prone to mistakes. I don't want regex or matching when I
 *    answer things like that. AI needs to get my responses and analyze them."
 *
 * Flow at UserPromptSubmit:
 *   1. Call AI classifier (Haiku, cheap, ~500ms)
 *   2. If actionable + negative → write no-defer-pin (clear any auth)
 *   3. If actionable + positive → write auth marker
 *   4. None/low-confidence/classifier-error → no state change (fail-open)
 *
 * The marker source field is now the AI's structured interpretation, NOT
 * a free-form string the AI invents. The classifier returns {intent,
 * confidence, interpretation} as a triple; we record all three plus the
 * verbatim user-message excerpt in the marker. Audit trails can then
 * distinguish "user said X" from "AI interpreted Y".
 *
 * The synchronous regex API used to be the entry point. We keep the same
 * name and return shape but the implementation is now an async call to
 * the AI classifier. Callers in user-prompt-submit.js are already async.
 */

const NEGATIVE_INTENT = 'negative';
const POSITIVE_INTENT = 'positive';

/**
 * Apply deferral-intent classification at UserPromptSubmit time.
 *
 * @param {string} prompt - The user's message
 * @param {Object} config - Loaded WogiFlow config
 * @returns {Promise<{
 *   applied: boolean,
 *   intent?: 'negative'|'positive'|'none',
 *   match?: string,
 *   reason?: string
 * }>}
 */
async function applyClassification(prompt, config) {
  try {
    if (config?.deferralGate?.classifyUserPrompts === false) {
      return { applied: false, reason: 'classifier-disabled' };
    }

    // wf-6e31850e (L-4): lazy require inside function body to break any
    // theoretical circular-require risk if flow-deferral-classifier-ai ever
    // imports back. require.cache makes this O(1) on subsequent calls.
    const { classifyUserDeferralIntent } = require('../../flow-deferral-classifier-ai');
    const result = await classifyUserDeferralIntent(prompt, {
      minConfidence: config?.deferralGate?.minClassifierConfidence
    });

    if (!result.classified) {
      // Fail-open — no state change on classifier error. Status quo holds.
      if (process.env.DEBUG) {
        console.error(`[deferral-classifier] classifier skipped: ${result.reason}`);
      }
      return { applied: false, reason: `classifier-skipped: ${result.reason}` };
    }

    if (!result.actionable) {
      return {
        applied: false,
        intent: result.intent,
        reason: `below-threshold (confidence ${result.confidence} < ${result.minConfidence})`
      };
    }

    const gate = require('./deferral-gate');

    if (result.intent === NEGATIVE_INTENT) {
      // wf-b8839d99 fix #5: if there was a prior auth marker, the user's
      // negative is likely a correction ("I did not authorize"). Write a
      // brief routing-recovery grace window so the AI can act on the
      // correction without re-routing through /wogi-start first.
      let priorAuthExisted = false;
      try { priorAuthExisted = Boolean(gate.loadAuth()); } catch (_err) { /* fine */ }

      gate.writeNoDeferPin({
        source: result.interpretation,
        userPromptExcerpt: typeof prompt === 'string' ? prompt.slice(0, 300) : '',
        confidence: result.confidence,
        grantedBy: 'ai-classifier',
        standing: result.standing
      });

      if (priorAuthExisted) {
        try {
          const fs = require('node:fs');
          const path = require('node:path');
          const { PATHS } = require('../../flow-utils');
          const gracePath = path.join(PATHS.state, 'routing-recovery-grace.json');
          const now = Date.now();
          fs.writeFileSync(gracePath, JSON.stringify({
            grantedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 60 * 1000).toISOString(),
            reason: 'user-correction-after-prior-defer-auth',
            userPromptExcerpt: typeof prompt === 'string' ? prompt.slice(0, 300) : ''
          }, null, 2));
        } catch (_err) { /* fail-open */ }
      }

      return {
        applied: true,
        intent: 'negative',
        match: result.interpretation,
        confidence: result.confidence,
        standing: result.standing,
        correctionGrace: priorAuthExisted
      };
    }

    if (result.intent === POSITIVE_INTENT) {
      gate.writeAuth({
        scope: result.scope || 'all',
        source: result.interpretation,
        userPromptExcerpt: typeof prompt === 'string' ? prompt.slice(0, 300) : '',
        confidence: result.confidence,
        grantedBy: 'ai-classifier',
        config
      });
      return {
        applied: true,
        intent: 'positive',
        match: result.interpretation,
        scope: result.scope || 'all',
        confidence: result.confidence
      };
    }

    return { applied: false, intent: result.intent, reason: 'none-intent' };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[deferral-classifier] applyClassification error (fail-open): ${err.message}`);
    }
    return { applied: false, reason: `error: ${err.message}` };
  }
}

module.exports = {
  applyClassification,
  NEGATIVE_INTENT,
  POSITIVE_INTENT
};
