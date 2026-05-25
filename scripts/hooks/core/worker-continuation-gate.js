'use strict';

/**
 * Worker In-Progress Continuation Gate
 * (epic-workspace-sustained-exec / S2, wf-aee4a4fa)
 *
 * THE core fix for "channel-dispatched workers stall after one turn." The
 * existing "Gap B" gate (workspace-stop-gates.js) only forces continuation when
 * a dispatch is queued but NOT started (inProgressCount===0). When a decomposed
 * task is already in-progress and the worker stops mid-way, nothing keeps it
 * going. This gate fills that hole.
 *
 * On a worker Stop, if a task is in-progress in an active-work phase with
 * sub-tasks remaining (durable ledger from S1) and no escalation is pending and
 * the per-task cap isn't exhausted, it returns {continue:true} so Claude Code
 * does NOT stop — keeping the SAME session alive (preserving in-context
 * decomposition, sidestepping the flaky channel wake-up). The proven mechanism
 * is the same one the routing-gate / research-required-gate / tool-first-gate
 * already use.
 *
 * Termination (no infinite loop):
 *   - Task leaves inProgress (done) ⇒ remaining()=0 / no inProgress ⇒ gate stops.
 *   - Per-task iteration cap = total*perSubtaskTurns + capBuffer (≤ maxContinuations).
 *   - No-progress detector: a "progress fingerprint" = hash(git status --porcelain)
 *     + remaining-count. If it doesn't change across noProgressK consecutive
 *     continuations, the worker isn't doing anything ⇒ escalate ## BLOCKED + stop.
 *     Any file edit OR completed sub-task changes the fingerprint, so legitimately
 *     long multi-turn refactors (no commits yet) are NOT false-killed, and a
 *     failing `flow done` that the worker keeps editing around still counts as
 *     progress.
 *
 * Phase-gating: fires only in active-work phases (coding/validating). In
 * spec_review / exploring the worker is legitimately waiting on the manager's
 * approval, so the gate stays out of the way.
 *
 * Worker-mode only. Fail-open: any error returns null (normal Stop flow).
 */

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');

const COUNTER_FILE = 'worker-continuation.json';
const PHASE_FILE = 'workflow-phase.json';

const DEFAULTS = {
  enabled: true,
  activePhases: ['coding', 'validating'],
  perSubtaskTurns: 6,
  capBuffer: 4,
  maxContinuations: 60,
  noProgressK: 4
};

function getCfg(config) {
  const ws = (config && config.workspace && config.workspace.continuationGate) || {};
  return {
    enabled: ws.enabled !== false,
    activePhases: Array.isArray(ws.activePhases) && ws.activePhases.length ? ws.activePhases : DEFAULTS.activePhases,
    perSubtaskTurns: Number.isFinite(ws.perSubtaskTurns) ? ws.perSubtaskTurns : DEFAULTS.perSubtaskTurns,
    capBuffer: Number.isFinite(ws.capBuffer) ? ws.capBuffer : DEFAULTS.capBuffer,
    maxContinuations: Number.isFinite(ws.maxContinuations) ? ws.maxContinuations : DEFAULTS.maxContinuations,
    noProgressK: Number.isFinite(ws.noProgressK) ? ws.noProgressK : DEFAULTS.noProgressK
  };
}

function isWorkerMode(env = process.env) {
  return Boolean(env.WOGI_WORKSPACE_ROOT && env.WOGI_REPO_NAME && env.WOGI_REPO_NAME !== 'manager');
}

function getCounterPath(stateDir) {
  return path.join(stateDir, COUNTER_FILE);
}

function readCounter(stateDir) {
  try {
    const raw = fs.readFileSync(getCounterPath(stateDir), 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch (_err) { /* absent or unreadable */ }
  return null;
}

function writeCounter(stateDir, state) {
  try {
    const p = getCounterPath(stateDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, p);
  } catch (_err) { /* best effort */ }
}

function clearCounter(stateDir) {
  try { fs.unlinkSync(getCounterPath(stateDir)); } catch (_err) { /* fine */ }
}

function readPhase(stateDir) {
  try {
    const raw = fs.readFileSync(path.join(stateDir, PHASE_FILE), 'utf-8');
    const data = JSON.parse(raw);
    return data && typeof data.phase === 'string' ? data.phase : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Progress fingerprint: working-tree state (uncommitted edits count too) plus the
 * remaining sub-task count. Changes whenever a file is touched OR a sub-task
 * completes. Used to detect "doing nothing" without false-killing long refactors.
 */
function defaultProgressFingerprint(root, remainingCount) {
  let porcelain = '';
  try {
    porcelain = childProcess.execSync('git status --porcelain 2>/dev/null || true', {
      cwd: root, encoding: 'utf-8', timeout: 3000
    });
  } catch (_err) { /* non-fatal */ }
  let sha = '';
  try {
    sha = childProcess.execSync('git rev-parse --short HEAD 2>/dev/null || true', {
      cwd: root, encoding: 'utf-8', timeout: 2000
    }).trim();
  } catch (_err) { /* non-fatal */ }
  return crypto.createHash('sha1').update(`${sha}\n${remainingCount}\n${porcelain}`).digest('hex');
}

function derivedCap(total, cfg) {
  const base = (total > 0 ? total : 1) * cfg.perSubtaskTurns + cfg.capBuffer;
  return Math.min(base, cfg.maxContinuations);
}

function buildContinueDirective({ taskId, remaining, total, attempt, cap }) {
  return [
    `SUSTAINED EXECUTION — task ${taskId} is in progress with ${remaining} of ${total} sub-task(s) remaining.`,
    `You are a workspace worker. A dispatched task runs to COMPLETION across turns — do NOT stop to "report progress" mid-task.`,
    '',
    `Do the next sub-task NOW (one tool call to start). Keep going until ALL sub-tasks are done.`,
    '',
    'Exit conditions (only these):',
    `  • DONE → run \`flow done ${taskId}\` (quality gates run). When the task leaves inProgress, this gate stops automatically.`,
    `  • BLOCKED on something only the manager/user can resolve, OR the next step is DESTRUCTIVE / IRREVERSIBLE /`,
    `    touches PRODUCTION / needs external credentials → do NOT proceed. Escalate instead:`,
    `      curl -s -X POST http://127.0.0.1:${process.env.WOGI_MANAGER_PORT || '8800'} \\`,
    `        -H "X-Wogi-From: ${process.env.WOGI_REPO_NAME || 'worker'}" \\`,
    `        --data-binary "## QUESTION: <blocker>"  (then end the turn)`,
    '',
    `(continuation ${attempt}/${cap} — make real progress this turn or escalate; idle turns are detected and will be stopped.)`
  ].join('\n');
}

/**
 * Best-effort escalation to the manager when the gate gives up (cap / no-progress).
 * Writes a worker-blocked message to the bus AND POSTs to the manager port.
 */
function escalateBlocked({ workspaceRoot, repoName, taskId, reason, managerPort }) {
  const summary = `## BLOCKED: ${reason} (task ${taskId})`;
  try {
    if (workspaceRoot) {
      const libMessages = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-messages');
      const { createMessage, saveMessage } = require(libMessages);
      const msg = createMessage({
        from: repoName, to: 'manager', type: 'worker-blocked',
        subject: `Worker ${repoName} blocked on ${taskId}`,
        body: summary, priority: 'high', actionRequired: true
      });
      msg.taskId = taskId;
      msg.reason = reason;
      saveMessage(workspaceRoot, msg);
    }
  } catch (_err) { /* best effort */ }
  try {
    if (managerPort) {
      const http = require('node:http');
      const buf = Buffer.from(summary, 'utf-8');
      const req = http.request({
        hostname: '127.0.0.1', port: parseInt(managerPort, 10), path: '/', method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': buf.byteLength, 'X-Wogi-From': repoName }
      });
      req.on('error', () => {});
      req.write(buf); req.end();
    }
  } catch (_err) { /* best effort */ }
}

/**
 * Is autonomous walk-away mode active for this worker? Read from the canonical
 * session-state.json. Tailors the stall directive (pre-approved → proceed) but
 * does NOT change the never-idle guarantee — that holds in all worker mode.
 */
function isAutonomousActive(stateDir) {
  try {
    const { safeJsonParse } = require('../../flow-utils');
    const ss = safeJsonParse(path.join(stateDir, 'session-state.json'), null);
    return Boolean(ss && ss.autonomousMode && ss.autonomousMode.active);
  } catch (_err) {
    return false;
  }
}

/**
 * Directive injected when an in-progress worker is parked at a gate. Tells it to
 * make real progress by SATISFYING the gate legitimately (read the phase doc,
 * decompose, provide evidence) — or to channel-escalate — and EXPLICITLY forbids
 * gate circumvention. This is the integrity half of RC2: never give the worker a
 * reason to reach for a worktree / marker-write.
 */
function buildStallDirective({ taskId, phase, remaining, total, attempt, k, autonomous, env }) {
  const port = (env && env.WOGI_MANAGER_PORT) || '8800';
  const repo = (env && env.WOGI_REPO_NAME) || 'worker';
  const isParked = phase === 'exploring' || phase === 'spec_review';
  const lines = [
    `SUSTAINED EXECUTION — task ${taskId} is in progress but appears PARKED (phase=${phase}, ${remaining}/${total || 0} sub-tasks).`,
    `You are a workspace worker. A dispatched task runs to COMPLETION across turns. Idling silently while a task is in-progress is NOT a valid end-of-turn state.`,
    '',
    'Make REAL progress THIS turn by SATISFYING the gate legitimately:'
  ];
  if (isParked) {
    lines.push(
      `  • You are in the ${phase} phase. Read the required phase instruction file (.claude/docs/phases/), finish the ${phase === 'spec_review' ? 'spec' : 'exploration'}, and advance the pipeline.`,
      autonomous
        ? `  • Autonomous mode is ACTIVE → you are PRE-APPROVED. Do NOT wait for spec/architect approval — proceed.`
        : `  • If this needs manager/user approval, channel-escalate (below) instead of waiting silently.`
    );
  } else {
    lines.push(
      `  • The task is in an active phase but has no decomposed sub-task ledger yet. Decompose it (TodoWrite) and START the first sub-task, OR if a gate is blocking you, satisfy it (read the required phase doc / provide the required evidence).`
    );
  }
  lines.push(
    '',
    'PROHIBITED — gate circumvention is forbidden and pointless (gates resolve phase from the canonical main-repo state, not your cwd):',
    '  ✗ Do NOT create a git worktree to reach an "ungated" context.',
    '  ✗ Do NOT hand-write gate-satisfying markers or edit .workflow/state files to fake gate satisfaction.',
    '  ✗ Do NOT change working directory to dodge a gate.',
    '',
    'If you genuinely cannot proceed (blocked on the manager/user, or the next step is destructive / needs credentials), ESCALATE then end the turn:',
    `  curl -s -X POST http://127.0.0.1:${port} \\`,
    `    -H "X-Wogi-From: ${repo}" \\`,
    `    --data-binary "## QUESTION: <your blocker>"`,
    '',
    `(stall continuation ${attempt}/${k} — make real progress or escalate; ${k} idle turns in a row will auto-escalate to the manager and stop.)`
  );
  return lines.join('\n');
}

/**
 * Stall handler (RC1). Drives a proceed-or-escalate continuation for an
 * in-progress worker task the happy path won't cover, then escalates to the
 * manager after `noProgressK` consecutive no-progress turns. Shares the per-task
 * counter file but tracks stall progress in dedicated fields so it never
 * conflates with the happy-path continuation count. Never returns a silent stop
 * without having escalated.
 */
function handleStall({ stateDir, root, env, taskId, phase, remaining, total, fingerprintFn, cfg }) {
  let counter = readCounter(stateDir);
  if (!counter || counter.taskId !== taskId) {
    counter = { taskId, count: 0, noProgressStreak: 0, fingerprint: null, escalated: false };
  }

  const fp = fingerprintFn(root, remaining);

  // Use the SAME progress fields as the happy path (fingerprint /
  // noProgressStreak / escalated). The stall and happy paths are mutually
  // exclusive per turn but share one task counter; keeping separate fingerprint
  // fields would break the escalated-resume check when a task transitions
  // between modes after an escalation (the other mode's fingerprint is null →
  // resume never fires → worker stuck "already-escalated"). Only `stallCount`
  // is stall-specific (the attempt display).

  // Respect an existing escalation — only resume if work moved since.
  if (counter.escalated) {
    if (counter.fingerprint && fp !== counter.fingerprint) {
      counter.escalated = false;
      counter.noProgressStreak = 0;
    } else {
      counter.fingerprint = fp;
      writeCounter(stateDir, counter);
      return { fired: false, decision: 'allow', reason: 'stall-already-escalated', escalated: true };
    }
  }

  // No-progress streak (shared with happy path — no-progress is no-progress
  // regardless of which mode produced the turn).
  if (counter.fingerprint != null && fp === counter.fingerprint) {
    counter.noProgressStreak = (counter.noProgressStreak || 0) + 1;
  } else {
    counter.noProgressStreak = 0;
  }
  counter.fingerprint = fp;

  // Escalate after K consecutive no-progress turns, then stop.
  if (counter.noProgressStreak >= cfg.noProgressK) {
    counter.escalated = true;
    writeCounter(stateDir, counter);
    escalateBlocked({
      workspaceRoot: env.WOGI_WORKSPACE_ROOT, repoName: env.WOGI_REPO_NAME,
      taskId, reason: `parked at "${phase}" gate with no progress across ${counter.noProgressStreak} turns`,
      managerPort: env.WOGI_MANAGER_PORT
    });
    return { fired: false, decision: 'allow', reason: 'stall-escalated', escalated: true, phase };
  }

  // Fire a proceed-or-escalate continuation.
  counter.stallCount = (counter.stallCount || 0) + 1;
  writeCounter(stateDir, counter);
  const directive = buildStallDirective({
    taskId, phase, remaining, total,
    attempt: counter.noProgressStreak + 1, k: cfg.noProgressK,
    autonomous: isAutonomousActive(stateDir), env
  });
  return {
    fired: true, decision: 'continue', reason: 'in-progress-stall',
    taskId, phase, remaining, total, attempt: counter.stallCount, stopReason: directive
  };
}

/**
 * Main gate. Returns one of:
 *   { continue: true, stopReason }              — force continuation
 *   null                                        — allow normal stop (no fire)
 * plus a `decision` field for diagnostics/tests: 'continue' | 'allow' with reason.
 *
 * @param {Object} opts
 * @param {Object} opts.config
 * @param {string} [opts.stateDir]  default PATHS.state
 * @param {string} [opts.root]      repo root for git probe (default PATHS.root)
 * @param {Object} [opts.env]       default process.env
 * @param {Function} [opts.fingerprintFn]  (root, remaining) => string  (injectable for tests)
 * @param {Object}  [opts.subtaskState]    injectable S1 module (tests)
 */
function checkWorkerContinuation(opts = {}) {
  try {
    const env = opts.env || process.env;
    if (!isWorkerMode(env)) return { fired: false, decision: 'allow', reason: 'not-worker' };

    const cfg = getCfg(opts.config);
    if (!cfg.enabled) return { fired: false, decision: 'allow', reason: 'disabled' };

    const { PATHS, safeJsonParse } = require('../../flow-utils');
    const stateDir = opts.stateDir || PATHS.state;
    const root = opts.root || PATHS.root;

    // Active task?
    const ready = safeJsonParse(path.join(stateDir, 'ready.json'), { inProgress: [] });
    const task = (ready.inProgress || [])[0];
    const taskId = task && task.id;
    if (!taskId) {
      clearCounter(stateDir); // nothing in progress — reset for next task
      return { fired: false, decision: 'allow', reason: 'no-in-progress' };
    }

    const phase = readPhase(stateDir);
    const fingerprintFn = opts.fingerprintFn || defaultProgressFingerprint;

    // Remaining decomposed work (needed by both happy-path and stall fallback).
    const subtaskState = opts.subtaskState || require('../../../lib/workspace-subtask-state');
    const summary = subtaskState.summary(taskId);
    const remaining = summary.remaining;
    const total = summary.total;

    const PARKED_PHASES = ['exploring', 'spec_review'];
    const inActivePhase = cfg.activePhases.includes(phase);

    // Decomposed ledger exists and ALL sub-tasks are complete (total>0,
    // remaining<=0): the task is wrapping up. Allow a clean stop so the worker
    // can run `flow done` and task-complete can fire (preserves S2/S6
    // termination — this is the completion boundary, not a parked stall).
    if (inActivePhase && remaining <= 0 && total > 0) {
      return { fired: false, decision: 'allow', reason: 'subtasks-complete' };
    }

    // Stall fallback (RC1, wf-e5e57361): an in-progress worker task that the
    // happy path won't cover MUST NOT idle silently. Two shapes:
    //   (a) active phase but NO decomposed ledger ever (total<=0) — e.g. parked
    //       at an architect / phase-read gate before TodoWrite decomposition.
    //   (b) parked in an approval / explore phase (exploring / spec_review).
    // Drive a proceed-or-escalate continuation; escalate to the manager after
    // noProgressK no-progress turns. Never a silent allow-stop.
    if ((inActivePhase && total <= 0) || PARKED_PHASES.includes(phase)) {
      return handleStall({
        stateDir, root, env, taskId, phase,
        remaining, total, fingerprintFn, cfg
      });
    }

    // Not actionable (idle / routing / completing / unknown) — genuinely allow a
    // normal stop; there is no in-progress work to sustain here.
    if (!inActivePhase) {
      return { fired: false, decision: 'allow', reason: `phase-not-actionable:${phase || 'none'}` };
    }

    // ── Happy path: active phase + remaining > 0 (unchanged S2 logic) ──
    // Per-task counter (reset when the task changes).
    let counter = readCounter(stateDir);
    if (!counter || counter.taskId !== taskId) {
      counter = { taskId, count: 0, noProgressStreak: 0, fingerprint: null, escalated: false };
    }

    // Already escalated for this task ⇒ allow stop (don't re-fire). Manager
    // re-dispatch / restart resets the counter (taskId match but escalated flag);
    // we clear the escalation only when progress resumes (fingerprint changes).
    const fingerprint = fingerprintFn(root, remaining);

    if (counter.escalated) {
      if (counter.fingerprint && fingerprint !== counter.fingerprint) {
        // Work resumed since we escalated — clear and continue.
        counter.escalated = false;
        counter.noProgressStreak = 0;
      } else {
        return { fired: false, decision: 'allow', reason: 'already-escalated' };
      }
    }

    const cap = derivedCap(summary.total, cfg);

    // No-progress detection.
    if (counter.fingerprint !== null && fingerprint === counter.fingerprint) {
      counter.noProgressStreak = (counter.noProgressStreak || 0) + 1;
    } else {
      counter.noProgressStreak = 0;
    }
    counter.fingerprint = fingerprint;

    if (counter.noProgressStreak >= cfg.noProgressK) {
      counter.escalated = true;
      writeCounter(stateDir, counter);
      escalateBlocked({
        workspaceRoot: env.WOGI_WORKSPACE_ROOT, repoName: env.WOGI_REPO_NAME,
        taskId, reason: `no progress across ${counter.noProgressStreak} continuations`,
        managerPort: env.WOGI_MANAGER_PORT
      });
      return { fired: false, decision: 'allow', reason: 'no-progress-escalated', escalated: true };
    }

    if (counter.count >= cap) {
      counter.escalated = true;
      writeCounter(stateDir, counter);
      escalateBlocked({
        workspaceRoot: env.WOGI_WORKSPACE_ROOT, repoName: env.WOGI_REPO_NAME,
        taskId, reason: `iteration cap (${cap}) reached`,
        managerPort: env.WOGI_MANAGER_PORT
      });
      return { fired: false, decision: 'allow', reason: 'cap-escalated', escalated: true };
    }

    // Fire continuation.
    counter.count += 1;
    writeCounter(stateDir, counter);
    const directive = buildContinueDirective({
      taskId, remaining, total: summary.total, attempt: counter.count, cap
    });
    return {
      fired: true,
      decision: 'continue',
      reason: 'remaining-subtasks',
      taskId,
      remaining,
      total: summary.total,
      attempt: counter.count,
      cap,
      stopReason: directive
    };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[worker-continuation-gate] fail-open: ${err.message}`);
    return { fired: false, decision: 'allow', reason: `error:${err.message}` };
  }
}

module.exports = {
  checkWorkerContinuation,
  handleStall,
  buildStallDirective,
  isAutonomousActive,
  isWorkerMode,
  getCfg,
  derivedCap,
  buildContinueDirective,
  readCounter,
  writeCounter,
  clearCounter,
  getCounterPath,
  readPhase,
  DEFAULTS
};
