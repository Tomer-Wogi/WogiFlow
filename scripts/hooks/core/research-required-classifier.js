#!/usr/bin/env node

/**
 * Wogi Flow — Research-Required Classifier (wf-5cd71b1f)
 *
 * Regex-based detector for diagnostic prompts that require evidence-reading
 * before the AI answers. Runs on UserPromptSubmit. Cheap, deterministic.
 *
 * Categories:
 *   - command   — task IDs, action imperatives, follow-ups → no marker
 *   - factual   — Tier-1 lookup ("what is X", "where is Y") → no marker
 *   - diagnostic — Tier-2/3 ("why", "should I", "what do you think") → MARKER
 *
 * On 'diagnostic' classification, writes a turn-scoped marker that the Stop
 * hook checks: if the assistant's turn produced fewer than `requiredEvidence`
 * Read tool calls against evidence-prefix paths, the Stop hook re-prompts the
 * AI with a violation message forcing a redo with reads.
 *
 * Override: prompt prefix `!` skips classification entirely.
 *
 * Note on regex vs Haiku: spec'd as Haiku in the original story (mirroring
 * flow-worker-question-classifier.js). Regex is used for v1 because it covers
 * the explicit Tier-1/2/3 markers from CLAUDE.md verbatim, costs nothing, and
 * is deterministic. A Haiku fallback can be added later if false-negative
 * rate is high enough to justify the latency.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../../flow-utils');
const { safeJsonParse } = require('../../flow-io');

const MARKER_FILE = 'research-required-this-turn.json';
const DEFAULT_REQUIRED_EVIDENCE = 2;
const DEFAULT_MAX_ATTEMPTS = 3;
const OVERRIDE_PREFIX = '!';

// Diagnostic markers — Tier 2/3 from CLAUDE.md routing rules
const DIAGNOSTIC_PATTERNS = [
  /\bwhy\s+(did|does|is|are|would|should|don['’]t|doesn['’]t|isn['’]t|aren['’]t|won['’]t|wouldn['’]t)\b/i,
  /\bshould\s+(i|we|you)\b/i,
  /\bwhat\s+(do\s+you\s+think|should|would|would'?s?\s+the)\b/i,
  /\bis\s+(this|that|it|the)\s+(correct|right|wrong|broken|safe)\b/i,
  /\bare\s+(these|those)\s+(correct|right)\b/i,
  /\bexplain\s+why\b/i,
  /\bhow\s+(should|do\s+i\s+decide|to\s+decide)\b/i,
  /\bwhich\s+(approach|option|way|one)\s+(is\s+better|should|do\s+you)\b/i,
  /\bis\s+it\s+better\s+to\b/i,
  /\bwhat'?s?\s+the\s+(right|best|correct)\s+(approach|way)\b/i,
  // Imperative "recommend" — anchored to prompt start or after sentence end.
  // Prior version `/\brecommend\b/i` matched ANY occurrence and false-fired on
  // "the recommendation system is broken" / "I recommend doing X" (statements,
  // not questions). See wf-12271e82.
  /(?:^|[.?!]\s+)\s*(please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?recommend\b/i,
  /\bdid\s+you\s+(fix|address|verify|check|test|handle)\b/i,
  /\bdo\s+you\s+(think|recommend|suggest)\b/i,
];

// Factual markers — Tier 1 (no marker, AI can answer from code/docs)
const FACTUAL_PATTERNS = [
  /^\s*what\s+is\b/i,
  /^\s*where\s+(is|does|are)\b/i,
  /^\s*how\s+many\b/i,
  /^\s*show\s+me\b/i,
  /^\s*list\s+(all|the)\b/i,
  /^\s*which\s+file\b/i,
];

// Command markers — task IDs, imperatives, follow-ups
const COMMAND_PATTERNS = [
  /^\s*wf-[a-f0-9]{8}\b/i,
  /^\s*\/wogi-[a-z0-9-]+\b/i,
  /^\s*(yes|no|continue|go\s+ahead|skip\s+(that|this)|option\s*\d|stop|pause)\s*[.!?]?\s*$/i,
  /^\s*(add|build|create|implement|refactor|fix|remove|delete|update|change|rename)\b/i,
];

function getMarkerPath() { return path.join(PATHS.state, MARKER_FILE); }

function isClassifierEnabled(config) {
  const cfg = config?.researchRequiredGate;
  if (cfg === false) return false;
  if (cfg && typeof cfg === 'object' && cfg.enabled === false) return false;
  return true;
}

function getRequiredEvidence(config) {
  const v = config?.researchRequiredGate?.requiredEvidence;
  if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  return DEFAULT_REQUIRED_EVIDENCE;
}

function getMaxAttempts(config) {
  const v = config?.researchRequiredGate?.maxAttempts;
  if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  return DEFAULT_MAX_ATTEMPTS;
}

/**
 * Classify a user prompt into command / factual / diagnostic.
 *
 * Order matters: override > command > factual > diagnostic > default(none).
 *
 * @param {string} prompt
 * @returns {{ category: 'command'|'factual'|'diagnostic'|'none', match?: string, overridden?: boolean }}
 */
function classifyPrompt(prompt) {
  if (typeof prompt !== 'string') return { category: 'none' };
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { category: 'none' };

  // Override: prompt starts with `!` → treat as command (skip gate)
  if (trimmed.startsWith(OVERRIDE_PREFIX)) {
    return { category: 'command', match: 'override-prefix', overridden: true };
  }

  // Command first (cheapest to classify, also overrides everything else)
  for (const rx of COMMAND_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'command', match: m[0] };
  }

  // Factual next
  for (const rx of FACTUAL_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'factual', match: m[0] };
  }

  // Diagnostic last
  for (const rx of DIAGNOSTIC_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'diagnostic', match: m[0] };
  }

  return { category: 'none' };
}

/**
 * Apply classification — write or skip the marker. Fail-open.
 */
function applyClassification(prompt, config) {
  try {
    if (!isClassifierEnabled(config)) return { applied: false, reason: 'classifier-disabled' };

    const result = classifyPrompt(prompt);
    if (result.category !== 'diagnostic') {
      return { applied: false, category: result.category, reason: 'not-diagnostic' };
    }

    const requiredEvidence = getRequiredEvidence(config);
    const payload = {
      version: 1,
      classifiedAt: new Date().toISOString(),
      category: 'diagnostic',
      match: result.match,
      requiredEvidence,
      attemptCount: 0
    };
    fs.mkdirSync(path.dirname(getMarkerPath()), { recursive: true });
    const tmp = `${getMarkerPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, getMarkerPath());
    return { applied: true, category: 'diagnostic', match: result.match, requiredEvidence };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[research-required-classifier] applyClassification error (fail-open): ${err.message}`);
    }
    return { applied: false, reason: `error: ${err.message}` };
  }
}

function loadMarker() {
  return safeJsonParse(getMarkerPath(), null);
}

function clearMarker() {
  try { fs.unlinkSync(getMarkerPath()); } catch (_err) { /* fine if absent */ }
}

function bumpMarkerAttempt(marker) {
  try {
    const next = { ...marker, attemptCount: (marker.attemptCount || 0) + 1, lastAttemptAt: new Date().toISOString() };
    const tmp = `${getMarkerPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, getMarkerPath());
    return next;
  } catch (_err) {
    return marker;
  }
}

module.exports = {
  classifyPrompt,
  applyClassification,
  loadMarker,
  clearMarker,
  bumpMarkerAttempt,
  getMarkerPath,
  isClassifierEnabled,
  getRequiredEvidence,
  getMaxAttempts,

  // Constants for tests
  DEFAULT_REQUIRED_EVIDENCE,
  DEFAULT_MAX_ATTEMPTS,
  OVERRIDE_PREFIX,
  DIAGNOSTIC_PATTERNS,
  FACTUAL_PATTERNS,
  COMMAND_PATTERNS
};
