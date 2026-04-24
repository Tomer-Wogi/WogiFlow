'use strict';

/**
 * Wogi Flow — Parallel-Worktree Auto Review (wf-8d635d0e / E1)
 *
 * On `coding → validating` phase transition, a background "review worker"
 * scans the task's changes in an isolated git worktree and writes findings
 * to `.workflow/state/auto-review-findings.json`. The Completion Truth Gate
 * reads the file and downgrades completion claims when high-severity findings
 * are present.
 *
 * Architecture:
 *   - `startReview({ taskId })` — detached background spawn (fire-and-forget)
 *   - `runReview({ taskId, reviewer, ... })` — core scan loop (used in-process
 *     by the detached child; injectable `reviewer` for tests)
 *   - `writeFindings / readFindings / awaitFindings` — JSON file I/O helpers.
 *
 * The "workspace worker" per the spec is a detached Node child process — not
 * an MCP-channel-hosted Claude session. Per-task model selection is a Claude
 * Code feature we don't yet own (AC6 — documented known limitation); the
 * review therefore defaults to a heuristic static scan of the worktree diff
 * so it's useful today without a running Claude Code child.
 */

const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const { PATHS } = require('../scripts/flow-paths');
const { readJson, writeJson } = require('../scripts/flow-io');

const FINDINGS_FILE = path.join(PATHS.state, 'auto-review-findings.json');
const DEFAULT_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 250;

// ============================================================
// File I/O — { schemaVersion, records: [...] } object wrapping the records
// array. Object-at-root is required by safeJsonParse (prototype-pollution
// protection). Semantics per AC3 remain "array; last-write-wins per task":
// `records` is the array, one entry per taskId after last-write dedupe.
// ============================================================

const SCHEMA_VERSION = 1;

function readAll() {
  const data = readJson(FINDINGS_FILE, { schemaVersion: SCHEMA_VERSION, records: [] });
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

function readFindings(taskId) {
  if (!taskId) return null;
  const all = readAll();
  // Latest record wins (iterate reverse).
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i] && all[i].taskId === taskId) return all[i];
  }
  return null;
}

/**
 * Upsert a record for `taskId`. Last-write-wins per AC3: the existing record
 * (if any) is replaced by `record`.
 */
function writeFindings(record) {
  if (!record || !record.taskId) {
    throw new Error('writeFindings requires { taskId, ... }');
  }
  const all = readAll();
  const filtered = all.filter((r) => r && r.taskId !== record.taskId);
  filtered.push(record);
  writeJson(FINDINGS_FILE, { schemaVersion: SCHEMA_VERSION, records: filtered });
  return record;
}

/**
 * Poll for a terminal record (status !== 'in-progress') for `taskId` within
 * `timeoutMs`. Returns either the completed record or a synthetic
 * `unverified-review-timeout` record. Does NOT modify the findings file on
 * timeout — that's the caller's call.
 */
async function awaitFindings(taskId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const rec = readFindings(taskId);
    if (rec && rec.status && rec.status !== 'in-progress') return rec;
    if (Date.now() >= deadline) {
      return {
        taskId,
        status: 'unverified-review-timeout',
        startedAt: rec?.startedAt || null,
        completedAt: null,
        findings: [],
        timeoutMs,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Heuristic default reviewer (no Claude dependency)
// ============================================================

const FINDING_PATTERNS = [
  { re: /\bTODO\b/, severity: 'low', claim: 'TODO left in changed code' },
  { re: /\bFIXME\b/, severity: 'medium', claim: 'FIXME left in changed code' },
  { re: /\bXXX\b/, severity: 'medium', claim: 'XXX marker left in changed code' },
  { re: /^<<<<<<<|^=======$|^>>>>>>>/, severity: 'high', claim: 'Unresolved merge conflict marker' },
  { re: /console\.log\(/, severity: 'low', claim: 'console.log left in code' },
  { re: /debugger;/, severity: 'high', claim: 'debugger statement left in code' },
];

/**
 * Default reviewer — runs in the worktree and reports findings on changed
 * lines only (git diff scope). Pure static scan; no AI. Returns findings[].
 *
 * This is intentionally cheap so the feature is useful without per-task
 * Claude model selection (AC6). When that Claude Code feature lands, a
 * richer reviewer can be plugged in via the `reviewer` option of runReview.
 */
function heuristicReviewer({ worktreePath, baseBranch }) {
  const findings = [];
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', `${baseBranch}...HEAD`, '--unified=0'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (_err) {
    return findings;
  }
  if (!diff) return findings;

  let currentFile = null;
  let currentLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice(6);
      currentLine = 0;
      continue;
    }
    if (raw.startsWith('@@')) {
      // @@ -a,b +c,d @@
      const m = raw.match(/\+(\d+)/);
      currentLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const added = raw.slice(1);
    for (const pat of FINDING_PATTERNS) {
      if (pat.re.test(added)) {
        findings.push({
          severity: pat.severity,
          file: currentFile,
          line: currentLine,
          claim: pat.claim,
          evidence: added.trim().slice(0, 200),
        });
      }
    }
    currentLine += 1;
  }
  return findings;
}

// ============================================================
// Run (in-process) — the detached child calls this
// ============================================================

/**
 * Run a review for `taskId` against `worktreePath`. Updates the findings file
 * with `in-progress` → `complete|error` status transitions. Returns the final
 * record.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.worktreePath
 * @param {string} [opts.baseBranch='HEAD~1']
 * @param {Function} [opts.reviewer] — (ctx) => findings[] | Promise<findings[]>.
 *   Injectable for tests. Default = heuristicReviewer.
 */
async function runReview({ taskId, worktreePath, baseBranch = 'HEAD~1', reviewer = heuristicReviewer }) {
  if (!taskId) throw new Error('runReview requires taskId');
  const startedAt = new Date().toISOString();
  writeFindings({
    taskId,
    status: 'in-progress',
    startedAt,
    completedAt: null,
    findings: [],
  });

  try {
    const findings = await Promise.resolve(reviewer({ taskId, worktreePath, baseBranch }));
    const record = {
      taskId,
      status: 'complete',
      startedAt,
      completedAt: new Date().toISOString(),
      findings: Array.isArray(findings) ? findings : [],
    };
    writeFindings(record);
    return record;
  } catch (err) {
    const record = {
      taskId,
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      findings: [],
      error: String(err.message || err),
    };
    writeFindings(record);
    return record;
  }
}

// ============================================================
// startReview — the public entry (spawn detached child)
// ============================================================

/**
 * Fire-and-forget background review. Creates a worktree, spawns a detached
 * child that runs `runReview`, and returns a handle the caller can poll via
 * `awaitFindings(taskId, timeoutMs)`. The child is unref()d so it never
 * keeps the parent process alive.
 *
 * Non-blocking per AC5: the parent writes an `in-progress` marker and
 * returns immediately. If the child never completes within `timeoutMs`,
 * `awaitFindings` returns an `unverified-review-timeout` record.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} [opts.repoRoot] — default = process.cwd()
 * @param {string} [opts.childScript] — override the worker entry (tests)
 * @returns {{ taskId, pid, worktreePath }}
 */
function startReview({ taskId, repoRoot, childScript }) {
  if (!taskId) throw new Error('startReview requires taskId');
  const root = repoRoot || process.cwd();

  // Write the in-progress marker synchronously so consumers see it immediately.
  writeFindings({
    taskId,
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    completedAt: null,
    findings: [],
  });

  // Worktree creation happens inside the child process (the worker script
  // is responsible for createWorktree / discardWorktree — keeping this
  // parent call synchronous and fire-and-forget).
  const worktreePath = null;

  const entry = childScript || path.join(__dirname, '..', 'scripts', 'flow-auto-review-worker.js');
  const child = spawn(process.execPath, [entry, '--task', taskId, '--repoRoot', root], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WOGI_AUTO_REVIEW_CHILD: '1' },
  });
  child.unref();

  return { taskId, pid: child.pid, worktreePath };
}

// ============================================================
// Findings → audit incorporation (consumed by completion-truth-gate)
// ============================================================

/**
 * Summarize findings for a task into a shape the truth gate can fold into its
 * existing `audit` object. High-severity findings trigger a soft-warn or block
 * (depending on configuration) without the gate having to re-implement any
 * downgrade logic — it just treats this like another "insufficient" signal.
 */
function summarizeFindingsForAudit(taskId) {
  const rec = readFindings(taskId);
  if (!rec) return { present: false };

  const findings = Array.isArray(rec.findings) ? rec.findings : [];
  const counts = { low: 0, medium: 0, high: 0 };
  for (const f of findings) {
    const sev = (f && f.severity) || 'low';
    if (counts[sev] !== undefined) counts[sev] += 1;
  }

  return {
    present: true,
    status: rec.status || 'unknown',
    timedOut: rec.status === 'unverified-review-timeout',
    counts,
    highSeverityCount: counts.high,
    topHighSeverity: findings.filter((f) => f && f.severity === 'high').slice(0, 5),
  };
}

module.exports = {
  FINDINGS_FILE,
  DEFAULT_TIMEOUT_MS,
  readFindings,
  writeFindings,
  awaitFindings,
  runReview,
  startReview,
  heuristicReviewer,
  summarizeFindingsForAudit,
  _internal: { readAll },
};
