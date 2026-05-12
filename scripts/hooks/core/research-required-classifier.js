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

// Generic-factual markers — Tier 1a (no marker; answerable from general
// knowledge). NARROWED from the prior FACTUAL_PATTERNS: "where is X",
// "which file", "show me", "list all" all MOVED to LOCATIONAL_PATTERNS
// below because in a project context they are almost always asking about
// THIS codebase and require a Read first. See wf-1bcc67d5 (the wogiflow-cli
// "where do API keys get saved" incident — model answered from prior,
// doubled down twice, before finally grepping).
const FACTUAL_PATTERNS = [
  /^\s*what\s+is\s+(a|an)\b/i,            // "what is a closure" — conceptual
  /^\s*what\s+does\s+\w+\s+mean\b/i,      // "what does idempotent mean"
  /^\s*how\s+many\s+\w+\s+(are\s+in|in)\s+a\b/i, // "how many days in a year" — generic
];

// Locational / project-specific-factual markers — Tier 1b (WRITES the
// evidence marker, same as diagnostic). "Where is X configured?", "which
// file handles Y?", "how does the deferral gate work?" — these are
// answerable ONLY by reading this codebase. The model MUST Read/Grep/Glob
// first and cite what it read. No "Tier 1 → answer directly" shortcut.
// wf-1bcc67d5.
const LOCATIONAL_PATTERNS = [
  /\bwhere\s+(is|are|do|does|did|should|would|can)\b/i,           // where is X / where are the keys / where does X get saved
  /\bwhich\s+(file|module|function|component|class|method|hook|gate|script|test|directory|folder|package)\b/i,
  /\bwhat\s+(file|module|function|class|hook|gate|script|component)\s+(handles?|does|is|contains?|defines?)\b/i,
  /\bwhat\s+is\s+(responsible\s+for|the\s+\w+\s+(file|module|gate|hook)\s+for)\b/i,
  // "how does the deferral gate work" — allow multiple words between the
  // determiner and the action verb (lazy [\s\w-]*?). Covers 1+ noun phrases.
  /\bhow\s+(does|do|did)\s+(the|this|our|its?|wogiflow|a|an)\b[\s\w-]*?\s+(work|works|worked|happen|behave|operate|function|run|fire|trigger|get\s+\w+)\b/i,
  // "how is the routing flag configured" — same lazy gap
  /\bhow\s+(is|are|was|were|does|do)\s+[\s\w-]*?\b(configured|wired|stored|set\s+up|implemented|handled|loaded|registered|defined|saved|kept|read|written|persisted|injected)\b/i,
  /^\s*(show\s+me\s+(the|all|how|where)|list\s+(all|the))\b/i,    // show me the routes / list all the gates — project enumeration
  /\bis\s+there\s+(a|an|any)\s+\w+\s+(in\s+(this|the)\s+(project|codebase|repo|code)|here)\b/i,
  /\b(in\s+this\s+(project|codebase|repo|code))\b.*\b(where|how|which|what)\b/i,
  /\b(where|how|which|what)\b.*\b(in\s+this\s+(project|codebase|repo|code))\b/i,
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
 * Classify a user prompt into command / factual / locational / diagnostic.
 *
 * Order matters: override > command > generic-factual > locational > diagnostic > default(none).
 *
 * `locational` and `diagnostic` BOTH write the evidence marker — the Stop
 * hook then requires Read/Grep/Glob calls before the answer is accepted.
 * `command` and `factual` and `none` do NOT write the marker.
 *
 * The generic-factual check is intentionally NARROW (only "what is a/an
 * <concept>", "what does X mean", "how many X in a Y"). Anything that
 * smells project-specific — "where is X", "which file/module", "how does
 * the X work" — falls through to `locational` and is gated. See wf-1bcc67d5.
 *
 * @param {string} prompt
 * @returns {{ category: 'command'|'factual'|'locational'|'diagnostic'|'none', match?: string, overridden?: boolean }}
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

  // Generic-factual next (NARROW — only truly-conceptual questions)
  for (const rx of FACTUAL_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'factual', match: m[0] };
  }

  // Locational / project-specific-factual — gated (writes marker)
  for (const rx of LOCATIONAL_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'locational', match: m[0] };
  }

  // Diagnostic — gated (writes marker)
  for (const rx of DIAGNOSTIC_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return { category: 'diagnostic', match: m[0] };
  }

  return { category: 'none' };
}

// Both 'diagnostic' AND 'locational' write the evidence marker. wf-1bcc67d5.
const GATED_CATEGORIES = new Set(['diagnostic', 'locational']);

/**
 * Apply classification — write or skip the marker. Fail-open.
 *
 * @returns {{ applied: boolean, category?: string, match?: string,
 *             requiredEvidence?: number, nudge?: string, reason?: string }}
 *   On a gated category, `nudge` is a short upfront reminder string the
 *   UserPromptSubmit orchestrator can surface as additionalContext so the
 *   model is told to Read BEFORE answering — not just re-prompted at Stop.
 */
function applyClassification(prompt, config) {
  try {
    if (!isClassifierEnabled(config)) return { applied: false, reason: 'classifier-disabled' };

    const result = classifyPrompt(prompt);
    if (!GATED_CATEGORIES.has(result.category)) {
      return { applied: false, category: result.category, reason: 'not-gated' };
    }

    const requiredEvidence = getRequiredEvidence(config);
    const payload = {
      version: 1,
      classifiedAt: new Date().toISOString(),
      category: result.category,
      match: result.match,
      requiredEvidence,
      attemptCount: 0
    };
    fs.mkdirSync(path.dirname(getMarkerPath()), { recursive: true });
    const tmp = `${getMarkerPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, getMarkerPath());

    const nudge = result.category === 'locational'
      ? `[research-required] This is a project-specific locational question (matched "${result.match}"). Before answering, run Read/Grep/Glob against the actual codebase — do NOT answer from prior knowledge or industry defaults. Your answer MUST cite the file:line(s) you read. (wf-1bcc67d5: a confident model answering "where does X live" from memory, doubling down, is the exact failure this gate exists to stop.)`
      : `[research-required] This is a diagnostic question (matched "${result.match}"). Read at least ${requiredEvidence} relevant evidence files before answering; cite them.`;

    return { applied: true, category: result.category, match: result.match, requiredEvidence, nudge };
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
  LOCATIONAL_PATTERNS,
  COMMAND_PATTERNS,
  GATED_CATEGORIES
};
