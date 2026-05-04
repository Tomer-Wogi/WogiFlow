#!/usr/bin/env node

/**
 * Wogi Flow — Deferral Intent Classifier (wf-f9912af6)
 *
 * Regex-based detector for explicit user deferral intent in UserPromptSubmit
 * messages. Cheap (no Haiku call), deterministic, runs every prompt.
 *
 * NEGATIVE intent takes precedence over POSITIVE — if the user says both
 * "fix everything" and "skip Y" in the same message, we assume they want
 * everything fixed (the defer-everything pattern is the dangerous one this
 * gate exists to stop).
 *
 * Negative match → write `no-defer-pin.json` (HARD block, overrides any auth)
 * Positive match → write `deferral-authorization.json` (allows specific scope)
 * Neither → no-op
 *
 * Fail-open: any error in classification falls through silently.
 */

// Negative phrases (HIGH PRIORITY — clear auth, write no-defer pin)
const NEGATIVE_PATTERNS = [
  /\bfix\s+(everything|all\s+of\s+(them|it)|all\s+findings?)\b/i,
  /\bno\s+deferr?als?\b/i,
  /\b(don'?t|do\s+not)\s+defer\b/i,
  /\bi\s+don'?t\s+(want|like)\s+(tech\s*-?\s*debt|technical\s*-?\s*debt|deferr?al)/i,
  /\bnever\s+defer\b/i,
  /\balways\s+fix\s+(what'?s\s+broken|what\s+needs?\s+fixing)/i,
  /\bnothing\s+(should\s+be|gets)\s+deferr?ed\b/i,
];

// Positive phrases (MEDIUM PRIORITY — write auth marker)
// We're conservative: require defer/skip phrasing to be coupled with finding
// context (this/that/those/it/option N/F\d+/severity word) to avoid catching
// unrelated mentions like "let's defer the meeting".
const POSITIVE_PATTERNS = [
  // "defer X" / "skip X" with a referent
  /\b(defer|skip|ignore|drop)\s+(this|that|those|it|them|f\d+|finding\s+\w+)\b/i,
  /\bleave\s+(this|that|those|f\d+|.*?)\s+(for\s+)?later\b/i,

  // /wogi-review menu options that mean defer
  /\boption\s*[24]\b/i, // option 2 = "fix critical only"; option 4 = "create tasks for all (defer)"
  /\bcreate\s+tasks?\s+for\s+(all|the\s+rest|remaining)\b/i,

  // Severity-scoped deferrals
  /\bfix\s+(only\s+)?(critical|high)\s*(\s*\/\s*high)?\s+only\b/i,
  /\bfix\s+(critical|high)\s+(only|first)\b/i,
  /\bskip\s+(low|medium|low\s*\/\s*medium)\b/i,

  // Ship-as-is style
  /\bship\s+(it\s+)?as\s*-?\s*is\b/i,
  /\bgood\s+enough\s+(as\s*-?\s*is|for\s+now)\b/i,
  /\bcall\s+it\s+(done|good)\b/i,
];

/**
 * Classify a user prompt for deferral intent.
 *
 * @param {string} prompt - the user's UserPromptSubmit text
 * @returns {{ intent: 'negative'|'positive'|'none', match?: string, scope?: string|string[] }}
 */
function classifyDeferralIntent(prompt) {
  if (!prompt || typeof prompt !== 'string') return { intent: 'none' };

  // Negative first — overrides positive
  for (const rx of NEGATIVE_PATTERNS) {
    const m = prompt.match(rx);
    if (m) return { intent: 'negative', match: m[0] };
  }

  // Positive
  for (const rx of POSITIVE_PATTERNS) {
    const m = prompt.match(rx);
    if (m) {
      // Try to extract scope — look for F\d+ ids in the prompt
      const findingIds = Array.from(prompt.matchAll(/\bF\d+\b/g)).map(x => x[0]);
      return {
        intent: 'positive',
        match: m[0],
        scope: findingIds.length > 0 ? findingIds : 'all'
      };
    }
  }

  return { intent: 'none' };
}

/**
 * Apply classification result to the gate's state files. Wired into
 * UserPromptSubmit. Fail-open throughout.
 */
function applyClassification(prompt, config) {
  try {
    if (config?.deferralGate?.classifyUserPrompts === false) return { applied: false, reason: 'classifier-disabled' };

    const result = classifyDeferralIntent(prompt);
    if (result.intent === 'none') return { applied: false, reason: 'no-match' };

    // Lazy-require to avoid load-order coupling
    const gate = require('./deferral-gate');

    if (result.intent === 'negative') {
      gate.writeNoDeferPin({ source: result.match });
      return { applied: true, intent: 'negative', match: result.match };
    }

    if (result.intent === 'positive') {
      gate.writeAuth({
        scope: result.scope,
        source: result.match,
        grantedBy: 'user-prompt',
        config
      });
      return { applied: true, intent: 'positive', match: result.match, scope: result.scope };
    }

    return { applied: false, reason: 'unhandled-intent' };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[deferral-classifier] applyClassification error (fail-open): ${err.message}`);
    return { applied: false, reason: `error: ${err.message}` };
  }
}

module.exports = {
  classifyDeferralIntent,
  applyClassification,
  NEGATIVE_PATTERNS,
  POSITIVE_PATTERNS
};
