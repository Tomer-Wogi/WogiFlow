'use strict';

/**
 * Wogi Flow — Standing No-Defer Policy Refresh (wf-b8839d99)
 *
 * Reads `.workflow/state/decisions.md` at SessionStart for an explicit
 * no-defer policy section and refreshes the no-defer-pin if found. This
 * makes a user's standing preference ("I don't like tech debt", written
 * via /wogi-decide into decisions.md) survive session boundaries instead
 * of evaporating with the 7-day pin TTL.
 *
 * Recognized markers in decisions.md (case-insensitive, structured-section
 * scan — NOT user-prompt parsing, so simple string match is acceptable):
 *   - "## No-Deferral Policy" (or "### No-Deferral Policy")
 *   - "## Anti-Tech-Debt Policy" / "### Anti-Tech-Debt Policy"
 *   - Body must contain "active" / "enabled" / "enforced" (any of those)
 *
 * If found → write a fresh standing no-defer-pin with 30-day TTL. The pin
 * carries `grantedBy: 'decisions-policy'` to distinguish it from per-prompt
 * pins written by the AI classifier.
 *
 * Fail-open: any read/parse error → no action. Decisions.md is optional
 * and many projects won't have a policy section.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../../flow-utils');

const POLICY_HEADER_PATTERNS = [
  /^#{2,3}\s+No-?Deferr?al\s+Policy\b/im,
  /^#{2,3}\s+Anti-?Tech-?Debt\s+Policy\b/im
];

const ACTIVE_MARKERS = /\b(active|enabled|enforced)\b/i;

const POLICY_PIN_TTL_SEC = 30 * 24 * 3600; // 30 days

/**
 * Check decisions.md for a no-defer policy section.
 *
 * @returns {{ active: boolean, header?: string, snippet?: string }}
 */
function detectPolicy() {
  try {
    const decisionsPath = path.join(PATHS.state, 'decisions.md');
    if (!fs.existsSync(decisionsPath)) return { active: false };
    const content = fs.readFileSync(decisionsPath, 'utf-8');
    if (typeof content !== 'string' || content.length === 0) return { active: false };

    for (const re of POLICY_HEADER_PATTERNS) {
      const m = content.match(re);
      if (!m) continue;
      // Found a header — check the next ~500 chars for an "active" marker.
      const startIdx = m.index || 0;
      const window = content.slice(startIdx, startIdx + 500);
      if (ACTIVE_MARKERS.test(window)) {
        return {
          active: true,
          header: m[0].trim(),
          snippet: window.slice(0, 200).trim()
        };
      }
    }
    return { active: false };
  } catch (_err) {
    return { active: false };
  }
}

/**
 * Refresh the no-defer pin if decisions.md has an active policy.
 *
 * @returns {{ refreshed: boolean, reason?: string }}
 */
function refreshFromPolicy() {
  try {
    const policy = detectPolicy();
    if (!policy.active) {
      return { refreshed: false, reason: 'no-active-policy' };
    }

    const gate = require('./deferral-gate');
    gate.writeNoDeferPin({
      source: `Standing policy in decisions.md: ${policy.header}`,
      userPromptExcerpt: policy.snippet || '',
      confidence: 100,
      grantedBy: 'decisions-policy',
      standing: true,
      ttlSec: POLICY_PIN_TTL_SEC
    });
    return { refreshed: true, header: policy.header };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[no-defer-policy] refreshFromPolicy error (fail-open): ${err.message}`);
    }
    return { refreshed: false, reason: `error: ${err.message}` };
  }
}

module.exports = {
  detectPolicy,
  refreshFromPolicy,
  POLICY_PIN_TTL_SEC,
  POLICY_HEADER_PATTERNS,
  ACTIVE_MARKERS
};
