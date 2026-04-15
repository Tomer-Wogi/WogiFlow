#!/usr/bin/env node

/**
 * Wogi Flow - `flow ask` CLI
 *
 * Mark that the AI has a pending question for the user. Suppresses the
 * task-boundary session restart (wf-39e9dc09) until the user responds — so
 * the AI can complete a task AND ask a follow-up without losing the question
 * across the restart boundary.
 *
 * Usage:
 *   flow ask "<question text>"
 *
 * Behavior:
 *   Writes `.workflow/state/pending-question.json` with the question + timestamp.
 *   The Stop hook's restart logic checks this file — if present, restart is deferred.
 *   UserPromptSubmit clears the file when the user responds.
 *
 * When to call:
 *   Any time the AI asks the user a question during or after a task. Especially
 *   safe to call even when unsure — worst case, it just delays a restart by one
 *   turn. Under-calling is the risk (orphaned question after restart).
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-utils');

const PENDING_QUESTION_FILE = 'pending-question.json';

function getPendingQuestionPath() {
  return path.join(PATHS.state, PENDING_QUESTION_FILE);
}

/**
 * Write the pending-question marker.
 *
 * @param {string} question — question text (1-1000 chars)
 * @returns {{ marked: boolean, path?: string, reason?: string }}
 */
function markQuestionPending(question) {
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { marked: false, reason: 'empty-question' };
  }
  const trimmed = question.trim().slice(0, 1000);
  try {
    const p = getPendingQuestionPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      version: 1,
      question: trimmed,
      askedAt: new Date().toISOString()
    }, null, 2));
    return { marked: true, path: p };
  } catch (err) {
    return { marked: false, reason: `write-failed: ${err.message}` };
  }
}

/**
 * Clear the pending-question marker (called from UserPromptSubmit).
 *
 * @returns {{ cleared: boolean, wasPresent: boolean }}
 */
function clearPendingQuestion() {
  const p = getPendingQuestionPath();
  if (!fs.existsSync(p)) return { cleared: true, wasPresent: false };
  try {
    fs.unlinkSync(p);
    return { cleared: true, wasPresent: true };
  } catch (err) {
    return { cleared: false, wasPresent: true };
  }
}

/**
 * Check whether a pending-question marker exists.
 *
 * @returns {boolean}
 */
function hasPendingQuestion() {
  try { return fs.existsSync(getPendingQuestionPath()); } catch (_err) { return false; }
}

module.exports = {
  markQuestionPending,
  clearPendingQuestion,
  hasPendingQuestion,
  getPendingQuestionPath
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: flow ask "<question text>"');
    console.log('Marks a pending question; the restart mechanism will defer until');
    console.log('the user responds (UserPromptSubmit clears the flag).');
    process.exit(args.length === 0 ? 2 : 0);
  }
  if (args[0] === '--clear') {
    const r = clearPendingQuestion();
    console.log(JSON.stringify(r));
    process.exit(0);
  }
  if (args[0] === '--check') {
    console.log(JSON.stringify({ hasPendingQuestion: hasPendingQuestion() }));
    process.exit(0);
  }
  const question = args.join(' ');
  const r = markQuestionPending(question);
  if (r.marked) {
    console.log(`Pending question marked. Restart deferred until you respond.`);
    console.log(`  File: ${r.path}`);
    process.exit(0);
  } else {
    console.error(`Failed to mark: ${r.reason}`);
    process.exit(1);
  }
}
