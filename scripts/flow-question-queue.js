#!/usr/bin/env node

/**
 * Wogi Flow — Question Queue (Story C / wf-d712002e)
 *
 * Persistent queue for product/UX questions surfaced during autonomous mode.
 * Questions blocking dependent tasks are recorded together with the skipped
 * tasks so the completion summary can render them and the user can resolve
 * them in one batch.
 *
 * Dependency classification is deliberately conservative — it is safer to
 * over-flag (false positive: extra re-run) than to under-flag (false
 * negative: dependent task ran on a stale assumption).
 *
 * File: .workflow/state/question-queue.json
 *
 * Programmatic:
 *   const q = require('./flow-question-queue');
 *   q.addQuestion({ text, classifiedBucket, taskContext, dependencies, runId });
 *   q.skipTask({ taskId, reason });
 *   q.loadQueue();
 *   q.clearQueue();
 *   q.classifyDependencies(questionText, pendingTaskIds);
 */

const path = require('node:path');
const fs = require('node:fs');
const { PATHS } = require('./flow-paths');
const { readJson, writeJson, withLock } = require('./flow-io');

const QUEUE_PATH = path.join(PATHS.state, 'question-queue.json');

// SEC-004 caps (2026-04-26): bound disk consumption for buggy classifier
// over-flag and prompt-injection that intentionally generates many questions.
// Overflow rotates the current queue to an archive file, never silently drops.
const MAX_QUESTIONS_PER_FILE = 100;
const MAX_QUESTION_TEXT_BYTES = 4 * 1024;          // 4 KB per question text
const MAX_QUEUE_FILE_BYTES = 1 * 1024 * 1024;      // 1 MB total queue file

function emptyQueue() {
  return { questions: [], skippedTasks: [] };
}

function loadQueue() {
  try {
    const data = readJson(QUEUE_PATH, null);
    if (!data || typeof data !== 'object') return emptyQueue();
    return {
      questions: Array.isArray(data.questions) ? data.questions : [],
      skippedTasks: Array.isArray(data.skippedTasks) ? data.skippedTasks : []
    };
  } catch (_err) {
    return emptyQueue();
  }
}

function saveQueue(data) {
  writeJson(QUEUE_PATH, data);
  return data;
}

/**
 * Rotate the current queue to a timestamped archive file, then return an
 * empty queue. Used when overflow caps are hit (SEC-004).
 */
function rotateQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return emptyQueue();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(PATHS.state, `question-queue-archive-${ts}.json`);
    fs.renameSync(QUEUE_PATH, archivePath);
  } catch (_err) { /* best-effort archive */ }
  return emptyQueue();
}

function truncateText(text) {
  if (typeof text !== 'string') return '';
  const buf = Buffer.from(text, 'utf-8');
  if (buf.byteLength <= MAX_QUESTION_TEXT_BYTES) return text;
  // Truncate by bytes, then drop last char to avoid mid-codepoint cuts.
  const truncated = buf.slice(0, MAX_QUESTION_TEXT_BYTES - 1).toString('utf-8');
  return truncated.replace(/.$/, '') + '… [truncated]';
}

function clearQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
  } catch (_err) { /* ignore */ }
  return emptyQueue();
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Append a question to the queue.
 * @param {object} q
 * @param {string} q.text - Question text
 * @param {string} [q.classifiedBucket] - Original classifier bucket
 * @param {string} [q.taskContext] - Task ID where the question arose
 * @param {string[]} [q.dependencies] - Task IDs likely depending on the answer
 * @param {string} [q.runId] - Autonomous run ID
 */
function addQuestion(q) {
  if (!q || !q.text) throw new Error('addQuestion: text is required');
  // SEC-004: cap text size, count, file size with archive rotation on overflow
  const text = truncateText(String(q.text));
  let queue = loadQueue();

  // Count cap — rotate before append if at limit
  if (queue.questions.length >= MAX_QUESTIONS_PER_FILE) {
    queue = rotateQueue();
  }

  const entry = {
    id: `q-${shortId()}`,
    text,
    classifiedBucket: q.classifiedBucket || null,
    taskContext: q.taskContext || null,
    dependencies: Array.isArray(q.dependencies) ? q.dependencies : [],
    createdAt: new Date().toISOString(),
    runId: q.runId || null,
    answered: false
  };
  queue.questions.push(entry);

  // File-size cap (defense-in-depth — covers degenerate per-question payloads).
  const candidate = JSON.stringify(queue);
  if (Buffer.byteLength(candidate, 'utf-8') > MAX_QUEUE_FILE_BYTES) {
    queue = rotateQueue();
    queue.questions.push(entry);
  }

  saveQueue(queue);
  return entry;
}

/**
 * Async variant of addQuestion that holds an inter-process lock around the
 * read-modify-write cycle (CL-002 fix). Prefer this in concurrent contexts
 * (autonomous worker + manager dispatch handler running in parallel).
 */
async function addQuestionAsync(q) {
  return withLock(QUEUE_PATH, async () => addQuestion(q));
}

/**
 * Mark a task as skipped, recording the reason and (optionally) the question
 * blocking it.
 */
function skipTask({ taskId, reason, blockingQuestionId } = {}) {
  if (!taskId) throw new Error('skipTask: taskId is required');
  const queue = loadQueue();
  const existing = queue.skippedTasks.find(s => s.taskId === taskId);
  const record = {
    taskId,
    reason: reason || 'awaiting answer',
    blockingQuestionId: blockingQuestionId || null,
    skippedAt: new Date().toISOString()
  };
  if (existing) {
    Object.assign(existing, record);
  } else {
    queue.skippedTasks.push(record);
  }
  saveQueue(queue);
  return record;
}

async function skipTaskAsync(args) {
  return withLock(QUEUE_PATH, async () => skipTask(args));
}

/**
 * Conservative dependency classifier — text-match only.
 * AI classifier integration is handled by `classifyDependenciesSafe(text,
 * tasks, aiClassifier)` below — callers pass an injected classifier
 * function. This keeps the hot path classifier-free for tests and for
 * environments without Anthropic credentials. (CL-008 fix 2026-04-26 —
 * removed misleading reference to a non-existent classifyDependenciesWithAi.)
 *
 * Rules:
 * 1. Exact task ID match (wf-XXXXXXXX) → flag dependency.
 * 2. Title substring match (case-insensitive, ≥6 chars to avoid noise) → flag.
 * 3. File-path match (anywhere in question text) → flag the task whose changed
 *    files include that path.
 *
 * @param {string} questionText
 * @param {Array<{id:string,title?:string,files?:string[]}>} pendingTasks
 * @returns {string[]} task IDs flagged as dependent
 */
function classifyDependencies(questionText, pendingTasks = []) {
  if (!questionText || !pendingTasks.length) return [];
  const text = String(questionText);
  const lower = text.toLowerCase();
  const flagged = new Set();

  const idRegex = /\bwf-[a-f0-9]{8}\b/gi;
  const ids = text.match(idRegex) || [];
  for (const id of ids) flagged.add(id.toLowerCase());

  for (const task of pendingTasks) {
    if (!task || !task.id) continue;
    if (flagged.has(task.id.toLowerCase())) continue;
    if (titleMatchesText(task.title, lower)) {
      flagged.add(task.id);
      continue;
    }
    if (Array.isArray(task.files)) {
      for (const f of task.files) {
        if (typeof f === 'string' && f.length >= 4 && lower.includes(f.toLowerCase())) {
          flagged.add(task.id);
          break;
        }
      }
    }
  }
  return [...flagged];
}

function titleMatchesText(title, lowerText) {
  if (!title || title.length < 6) return false;
  const t = title.toLowerCase();
  if (lowerText.includes(t)) return true;
  const words = t.split(/\s+/).filter(w => w.length >= 4);
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 6 && lowerText.includes(bigram)) return true;
  }
  return false;
}

/**
 * Conservative union — combines text-match + AI classifier results, deduped.
 */
function unionDependencies(...lists) {
  const out = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const id of list) out.add(id);
  }
  return [...out];
}

/**
 * Fail-safe wrapper: if the classifier is unavailable or throws, mark ALL
 * pending tasks as dependent (the safest over-flag per the spec).
 */
function classifyDependenciesSafe(questionText, pendingTasks, aiClassifier = null) {
  const textMatched = classifyDependencies(questionText, pendingTasks);
  if (typeof aiClassifier !== 'function') {
    if (textMatched.length === 0) {
      return pendingTasks.map(t => t && t.id).filter(Boolean);
    }
    return textMatched;
  }
  try {
    const aiResult = aiClassifier(questionText, pendingTasks);
    if (!Array.isArray(aiResult)) {
      return pendingTasks.map(t => t && t.id).filter(Boolean);
    }
    return unionDependencies(textMatched, aiResult);
  } catch (_err) {
    return pendingTasks.map(t => t && t.id).filter(Boolean);
  }
}

function listOpenQuestions() {
  return loadQueue().questions.filter(q => !q.answered);
}

function listSkippedTasks() {
  return loadQueue().skippedTasks;
}

module.exports = {
  QUEUE_PATH,
  MAX_QUESTIONS_PER_FILE,
  MAX_QUESTION_TEXT_BYTES,
  MAX_QUEUE_FILE_BYTES,
  emptyQueue,
  loadQueue,
  saveQueue,
  rotateQueue,
  clearQueue,
  addQuestion,
  addQuestionAsync,
  skipTask,
  skipTaskAsync,
  classifyDependencies,
  classifyDependenciesSafe,
  unionDependencies,
  listOpenQuestions,
  listSkippedTasks
};

if (require.main === module) {
  const [,, cmd, ...args] = process.argv;
  switch (cmd) {
    case 'list': {
      const q = loadQueue();
      console.log(JSON.stringify(q, null, 2));
      break;
    }
    case 'clear': {
      clearQueue();
      console.log('cleared');
      break;
    }
    case 'add': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: flow-question-queue add <text>'); process.exit(1); }
      const entry = addQuestion({ text });
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    default:
      console.log('Usage: flow-question-queue <list|add|clear>');
  }
}
