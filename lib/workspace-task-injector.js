'use strict';

/**
 * Wogi Workspace — Manager-side Task Injector (wf-2f49b292 / G5)
 *
 * Writes a task record into a worker's `.workflow/state/ready.json` from the
 * manager, so the manager can dispatch `/wogi-start <taskId>` for a brand-new
 * task that the worker doesn't yet know about.
 *
 * Before G5: manager could only dispatch tasks that already existed in the
 * worker's ready.json (worker had to create them first). G5 closes that gap.
 *
 * Atomicity: write-to-temp + rename — atomic at the filesystem layer.
 * Concurrent injects from two manager turns serialize via rename semantics;
 * the last writer wins only on the rename, so we re-read before every write
 * to avoid losing a concurrent append.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_REPO_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_TASK_ID = /^wf-[0-9a-f]{8}$/i;
const REQUIRED_FIELDS = ['id', 'title', 'type'];
const MAX_RETRIES = 5;

/**
 * Resolve the filesystem path to a worker's ready.json.
 * Reads wogi-workspace.json manifest to find the worker's repo path.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @returns {string} absolute path to ready.json (may not yet exist)
 */
function getWorkerReadyPath(workspaceRoot, repoName) {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    throw new Error('workspaceRoot must be a non-empty string');
  }
  if (!VALID_REPO_NAME.test(repoName)) {
    throw new Error(`Invalid repoName: "${repoName}" — must match ${VALID_REPO_NAME}`);
  }

  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Cannot read workspace manifest at ${configPath}: ${err.message}`);
  }

  const member = manifest.members?.[repoName];
  if (!member) {
    throw new Error(`Unknown repo "${repoName}" in workspace manifest`);
  }

  const memberPath = member.path || `./${repoName}`;
  const repoPath = path.resolve(workspaceRoot, memberPath);

  const resolvedRoot = path.resolve(workspaceRoot);
  if (!repoPath.startsWith(resolvedRoot + path.sep) && repoPath !== resolvedRoot) {
    throw new Error(`Worker repo path escapes workspace root: ${repoPath}`);
  }

  return path.join(repoPath, '.workflow', 'state', 'ready.json');
}

/**
 * Validate a task record has the shape needed for ready.json entries.
 *
 * @param {Object} taskRecord
 * @throws {Error} if invalid
 */
function validateTaskRecord(taskRecord) {
  if (!taskRecord || typeof taskRecord !== 'object' || Array.isArray(taskRecord)) {
    throw new Error('taskRecord must be a plain object');
  }
  for (const field of REQUIRED_FIELDS) {
    if (!taskRecord[field] || typeof taskRecord[field] !== 'string') {
      throw new Error(`taskRecord.${field} is required and must be a string`);
    }
  }
  if (!VALID_TASK_ID.test(taskRecord.id)) {
    throw new Error(`Invalid task ID "${taskRecord.id}" — expected wf-XXXXXXXX (8 hex)`);
  }
  if (taskRecord.title.length > 500) {
    throw new Error('taskRecord.title exceeds 500 chars');
  }
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function readReadyJson(readyPath) {
  if (!fs.existsSync(readyPath)) {
    return {
      lastUpdated: new Date().toISOString(),
      inProgress: [],
      ready: [],
      blocked: [],
      recentlyCompleted: []
    };
  }
  const raw = fs.readFileSync(readyPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`ready.json is not a valid object at ${readyPath}`);
  }
  parsed.ready = Array.isArray(parsed.ready) ? parsed.ready : [];
  parsed.inProgress = Array.isArray(parsed.inProgress) ? parsed.inProgress : [];
  parsed.blocked = Array.isArray(parsed.blocked) ? parsed.blocked : [];
  parsed.recentlyCompleted = Array.isArray(parsed.recentlyCompleted) ? parsed.recentlyCompleted : [];
  return parsed;
}

function taskExistsAnywhere(data, taskId) {
  const lists = ['inProgress', 'ready', 'blocked', 'recentlyCompleted'];
  for (const k of lists) {
    if (data[k].some(t => t && t.id === taskId)) return k;
  }
  return null;
}

/**
 * Inject a task record into a worker's ready.json `ready[]` array.
 *
 * Idempotent: if a task with the same id already exists anywhere in the file,
 * returns `{ ok: true, alreadyPresent: <list-name> }` without modifying the file.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @param {Object} taskRecord — must have id (wf-XXXXXXXX), title, type
 * @returns {{ ok: boolean, path?: string, taskId?: string, alreadyPresent?: string, message?: string }}
 */
function injectTask(workspaceRoot, repoName, taskRecord) {
  try {
    validateTaskRecord(taskRecord);
  } catch (err) {
    return { ok: false, message: err.message };
  }

  let readyPath;
  try {
    readyPath = getWorkerReadyPath(workspaceRoot, repoName);
  } catch (err) {
    return { ok: false, message: err.message };
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let data;
    try {
      data = readReadyJson(readyPath);
    } catch (err) {
      return { ok: false, message: `Read failed: ${err.message}` };
    }

    const existingList = taskExistsAnywhere(data, taskRecord.id);
    if (existingList) {
      return { ok: true, path: readyPath, taskId: taskRecord.id, alreadyPresent: existingList };
    }

    const enriched = {
      ...taskRecord,
      status: taskRecord.status || 'ready',
      created: taskRecord.created || new Date().toISOString(),
      injectedBy: process.env.WOGI_REPO_NAME || 'manager',
      injectedAt: new Date().toISOString()
    };
    data.ready.push(enriched);
    data.lastUpdated = new Date().toISOString();

    try {
      atomicWriteJson(readyPath, data);
      return { ok: true, path: readyPath, taskId: taskRecord.id };
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        return { ok: false, message: `Write failed after ${MAX_RETRIES} attempts: ${err.message}` };
      }
    }
  }

  return { ok: false, message: 'Unreachable retry exhaustion' };
}

/**
 * Inject a task into the worker's ready.json, then dispatch /wogi-start.
 *
 * If injection reports `alreadyPresent`, still proceeds to dispatch — the
 * task exists, so dispatch is the right next step.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @param {Object} taskRecord
 * @param {Object} [opts] — forwarded to dispatchToChannel
 * @returns {Promise<{ inject: Object, dispatch: Object, ok: boolean }>}
 */
async function injectAndDispatch(workspaceRoot, repoName, taskRecord, opts = {}) {
  const injectResult = injectTask(workspaceRoot, repoName, taskRecord);
  if (!injectResult.ok) {
    return { ok: false, inject: injectResult, dispatch: null };
  }

  const { dispatchToChannel } = require('./workspace-routing');
  const dispatchResult = await dispatchToChannel(workspaceRoot, repoName, taskRecord.id, opts);

  return {
    ok: injectResult.ok && dispatchResult.ok,
    inject: injectResult,
    dispatch: dispatchResult
  };
}

module.exports = {
  injectTask,
  injectAndDispatch,
  getWorkerReadyPath,
  validateTaskRecord
};
