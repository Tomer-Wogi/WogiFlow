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
const { readJson, writeJson } = require('./flow-io');

const QUEUE_PATH = path.join(PATHS.state, 'question-queue.json');

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
  const queue = loadQueue();
  const entry = {
    id: `q-${shortId()}`,
    text: q.text,
    classifiedBucket: q.classifiedBucket || null,
    taskContext: q.taskContext || null,
    dependencies: Array.isArray(q.dependencies) ? q.dependencies : [],
    createdAt: new Date().toISOString(),
    runId: q.runId || null,
    answered: false
  };
  queue.questions.push(entry);
  saveQueue(queue);
  return entry;
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

/**
 * Conservative dependency classifier — text-match only.
 * AI classifier (Haiku) fallback is intentionally NOT inlined here; callers
 * that have access to Haiku invoke `classifyDependenciesWithAi()` and merge
 * results with `unionDependencies()`. This keeps the hot path classifier-free
 * for tests and for environments without Anthropic credentials.
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
  emptyQueue,
  loadQueue,
  saveQueue,
  clearQueue,
  addQuestion,
  skipTask,
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
