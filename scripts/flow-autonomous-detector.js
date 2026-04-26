#!/usr/bin/env node

/**
 * Wogi Flow — Autonomous-Mode Trigger Detector (Story C / wf-d712002e)
 *
 * Decides whether a user message activates autonomous walk-away mode.
 *
 * Strategy:
 *   1. Phrase-match (fast, deterministic, free).
 *   2. Optional Haiku classifier fallback for novel phrasings.
 *   3. Fail-closed: classifier failure → NOT autonomous (interactive is the
 *      safer default; users can re-trigger explicitly).
 *
 * Programmatic:
 *   const d = require('./flow-autonomous-detector');
 *   const r = d.detect(userMessage);              // { autonomous, trigger, source }
 *   const r = await d.detectAsync(userMessage);   // includes classifier fallback
 */

const TRIGGER_PHRASES = [
  'go until you finish',
  'go until done',
  'go until complete',
  'work on all these',
  'work through all of these',
  'run this epic autonomously',
  'run this autonomously',
  "don't bother me, just do it",
  "don't bother me",
  'walk-away mode',
  'walk away mode',
  'autonomous mode',
  'go ahead until done',
  'just keep going until you finish',
  'finish all of them',
  'do them all without asking'
];

// CL-001 fix (2026-04-26): split into EXACT and EXPLICIT phrase lists.
//
// Previously detectStop() did a startsWith/endsWith match on every phrase,
// which silently deactivated autonomous mode when the user said things like
// "wait for the build then continue" or "hold on let me check, then proceed"
// or "stop being so verbose but keep working" — common conversational words
// at the start/end of a message would falsely trigger deactivation.
//
// New semantic:
//   EXACT_STOP_PHRASES — exact match only (common short words; if the user
//     actually means it as a stop command, they'll type just that)
//   EXPLICIT_STOP_PHRASES — substring match (unambiguous because they
//     mention "autonomous" by name)
const EXACT_STOP_PHRASES = [
  'stop',
  'pause',
  'hold on',
  'wait'
];

const EXPLICIT_STOP_PHRASES = [
  'cancel autonomous',
  'exit autonomous',
  'leave autonomous mode',
  'stop autonomous',
  'pause autonomous',
  'end autonomous'
];

// Backwards-compat: union for any external caller that imported STOP_PHRASES.
const STOP_PHRASES = [...EXACT_STOP_PHRASES, ...EXPLICIT_STOP_PHRASES];

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detect(message) {
  const text = normalize(message);
  if (!text) return { autonomous: false, source: 'empty' };

  for (const phrase of TRIGGER_PHRASES) {
    if (text.includes(phrase)) {
      return { autonomous: true, trigger: phrase, source: 'phrase-match' };
    }
  }

  return { autonomous: false, source: 'no-match' };
}

function detectStop(message) {
  const text = normalize(message);
  if (!text) return false;
  // EXACT phrases require equality (don't match mid-message)
  if (EXACT_STOP_PHRASES.includes(text)) return true;
  // EXPLICIT phrases match anywhere (unambiguous due to "autonomous" word)
  return EXPLICIT_STOP_PHRASES.some(p => text.includes(p));
}

/**
 * Async variant with optional Haiku classifier fallback.
 * Caller injects the classifier (function returning {autonomous: boolean, confidence: number}).
 * Fail-closed on any error.
 */
async function detectAsync(message, { aiClassifier = null, minConfidence = 0.7 } = {}) {
  const fast = detect(message);
  if (fast.autonomous) return fast;

  if (typeof aiClassifier !== 'function') return fast;

  try {
    const result = await aiClassifier(message);
    if (
      result &&
      typeof result === 'object' &&
      result.autonomous === true &&
      typeof result.confidence === 'number' &&
      result.confidence >= minConfidence
    ) {
      return { autonomous: true, trigger: 'classifier-match', source: 'classifier', confidence: result.confidence };
    }
    return { autonomous: false, source: 'classifier-no-match' };
  } catch (err) {
    return { autonomous: false, source: 'classifier-error', error: err && err.message };
  }
}

module.exports = {
  TRIGGER_PHRASES,
  STOP_PHRASES,
  detect,
  detectAsync,
  detectStop,
  normalize
};

if (require.main === module) {
  const [,, ...rest] = process.argv;
  const msg = rest.join(' ');
  if (!msg) {
    console.log('Usage: flow-autonomous-detector <message>');
    process.exit(1);
  }
  const r = detect(msg);
  console.log(JSON.stringify(r, null, 2));
}
