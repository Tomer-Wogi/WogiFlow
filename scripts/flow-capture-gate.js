#!/usr/bin/env node

/**
 * Wogi Flow - Capture-at-Task-Boundary Gate
 *
 * Quality gate that prevents a task from closing when durable conclusions have
 * been made during the task but not captured to the correct state file.
 *
 * Story: wf-a3cc5f2a (epic-episodic-memory, capture enforcement)
 * Upstream audit: .workflow/audits/state-coverage-2026-04-15.md (G4)
 *
 * Pipeline position: dispatched by flow-done.js via GATE_REGISTRY in
 * flow-done-gates.js. Self-instrumented telemetry (mirrors completionTruthGate).
 *
 * Reuses (no parallel implementations):
 *   - flow-conclusion-classifier.js → classifyConclusions, CONCLUSION_KINDS
 *   - flow-gate-telemetry.js       → recordGateEvent
 *   - flow-session-state.js        → trackBypassAttempt
 *   - flow-utils.js                → PATHS, getConfig
 *
 * Usage (programmatic):
 *   const { captureGate } = require('./flow-capture-gate');
 *   const result = captureGate(ctx);
 *   // { passed: boolean, skipped?: true, errorOutput?: string, details?: {...} }
 *
 * CLI (for smoke-testing):
 *   node scripts/flow-capture-gate.js smoke <taskId>
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

const { PATHS, getConfig, safeJsonParse, safeJsonParseString } = require('./flow-utils');
const gateTelemetry = require('./flow-gate-telemetry');

// Timeout for the classifier subprocess (Haiku call + parse). Generous but bounded —
// if it exceeds, the gate SKIPs rather than FAILs (infrastructure issue, not a real miss).
const CLASSIFIER_TIMEOUT_MS = 25000;

const GATE_ID = 'capture-gate';
const GATE_VERSION = '1.0';

// Target files / directories the gate knows how to verify writes against.
const KNOWN_TARGETS = {
  '.workflow/state/decisions.md': { kind: 'file' },
  '.workflow/state/feedback-patterns.md': { kind: 'file' },
  '.workflow/state/product.md': { kind: 'file' },
  '.workflow/state/adr/': { kind: 'directory' },
};

// ============================================================================
// Disabled-mode short-circuit
// ============================================================================

function isGateDisabled(config) {
  const cfg = config || getConfig();
  const cap = cfg?.externalMemory?.capture;
  if (!cap || cap.enabled !== true) {
    return { disabled: true, reason: 'capture-disabled' };
  }
  return { disabled: false, config: cap };
}

function getBlockOnMiss(captureCfg) {
  return captureCfg?.blockOnMiss !== false;
}

function getMinLevel(captureCfg) {
  return captureCfg?.minLevel || 'L2';
}

function getMinConfidence(captureCfg) {
  return Number.isFinite(captureCfg?.minConfidence) ? captureCfg.minConfidence : 70;
}

// Level ordering — L0 is largest (epic), L3 is smallest (subtask).
// Gate "minLevel: L2" means: run on L2 and larger (L2, L1, L0). Skip on L3.
const LEVEL_ORDER = { L0: 0, L1: 1, L2: 2, L3: 3 };
function levelIsBelowMin(taskLevel, minLevel) {
  const t = LEVEL_ORDER[String(taskLevel || '').toUpperCase()];
  const m = LEVEL_ORDER[String(minLevel || 'L2').toUpperCase()];
  if (t === undefined || m === undefined) return false; // unknown → run
  return t > m;
}

// ============================================================================
// Task context helpers
// ============================================================================

/**
 * Load the in-progress task entry from ready.json (or return null).
 */
function loadTaskEntry(taskId) {
  try {
    const readyPath = PATHS.ready || path.join(PATHS.state, 'ready.json');
    if (!fs.existsSync(readyPath)) return null;
    const data = safeJsonParse(readyPath, null);
    if (!data || typeof data !== 'object') return null;
    const buckets = ['inProgress', 'ready', 'blocked', 'recentlyCompleted'];
    for (const b of buckets) {
      const arr = Array.isArray(data[b]) ? data[b] : [];
      const hit = arr.find(t => t && t.id === taskId);
      if (hit) return hit;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

/**
 * Read the tail of request-log.md as a plain-text excerpt for the classifier.
 * We only need the last ~2–3 entries for context on what this task did.
 */
function readRequestLogTail(maxChars = 6000) {
  try {
    const p = PATHS.requestLog || path.join(PATHS.state, 'request-log.md');
    if (!fs.existsSync(p)) return '';
    const raw = fs.readFileSync(p, 'utf-8');
    if (raw.length <= maxChars) return raw;
    return raw.slice(-maxChars);
  } catch (_err) {
    return '';
  }
}

/**
 * Build a textual summary of the task for the classifier.
 */
function buildTaskSummary(taskEntry, taskId) {
  if (!taskEntry) return `Task ${taskId} (no summary available).`;
  const bits = [];
  bits.push(`Task: ${taskEntry.id}`);
  if (taskEntry.title) bits.push(`Title: ${taskEntry.title}`);
  if (taskEntry.type) bits.push(`Type: ${taskEntry.type}`);
  if (taskEntry.level) bits.push(`Level: ${taskEntry.level}`);
  if (taskEntry.epic) bits.push(`Epic: ${taskEntry.epic}`);
  if (taskEntry.specPath) {
    try {
      const specFull = path.resolve(process.cwd(), taskEntry.specPath);
      if (fs.existsSync(specFull)) {
        const spec = fs.readFileSync(specFull, 'utf-8').slice(0, 4000);
        bits.push(`\n## Spec\n${spec}`);
      }
    } catch (_err) {
      /* no-op */
    }
  }
  return bits.join('\n');
}

// ============================================================================
// Write verification
// ============================================================================

/**
 * Return an array of target files that have working-tree changes (unstaged + staged + untracked).
 */
function getChangedStateFiles() {
  try {
    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!porcelain) return [];
    const files = [];
    for (const line of porcelain.split('\n')) {
      if (!line || line.length < 3) continue;
      const raw = line.slice(3);
      const name = raw.includes(' -> ') ? raw.split(' -> ')[1] : raw;
      files.push(name);
    }
    return files;
  } catch (_err) {
    return [];
  }
}

/**
 * Return the added-lines diff for a single file relative to HEAD (includes untracked).
 */
function getAddedLinesForFile(filePath) {
  try {
    // Handle untracked: cat the file directly. For tracked files: diff against HEAD.
    const status = execSync(`git status --porcelain -- "${filePath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!status) return '';
    const indicator = status.slice(0, 2);
    if (indicator.includes('?')) {
      // Untracked — read whole file as "added".
      // Wrap in try-catch per security-patterns.md §1: existsSync→readFileSync race.
      const abs = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(abs)) return '';
      try {
        return fs.readFileSync(abs, 'utf-8');
      } catch (_err) {
        return '';
      }
    }
    const diff = execSync(`git diff -U0 HEAD -- "${filePath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Keep only added lines (leading + but not +++ header)
    return diff
      .split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1))
      .join('\n');
  } catch (_err) {
    return '';
  }
}

/**
 * Normalize a string for exact-substring matching: lowercase + collapse whitespace.
 */
function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Verify whether a conclusion was written. Strategy (per plan P8 resolution):
 *   1. Exact-substring match of normalized excerpt against added lines of the target.
 *   2. For directory targets (ADR), scan all added/untracked files under the dir.
 *   3. Secondary evidence: scan request-log tail for this task's entry citing the target.
 *
 * @returns {{ written: boolean, via: string, matchedFile?: string }}
 */
function verifyConclusionWrite(conclusion, ctx) {
  const target = conclusion.targetFile;
  const known = KNOWN_TARGETS[target];
  if (!known) return { written: false, via: 'unknown-target' };

  const needle = normalizeForMatch(conclusion.excerpt);
  if (!needle || needle.length < 12) {
    // Excerpt too short to do a safe substring check — fall back to file-changed signal.
    const changed = getChangedStateFiles();
    const fileChanged = known.kind === 'file'
      ? changed.includes(target)
      : changed.some(f => f.startsWith(target));
    return { written: fileChanged, via: fileChanged ? 'file-changed-short-excerpt' : 'no-match' };
  }

  if (known.kind === 'file') {
    const added = getAddedLinesForFile(target);
    if (added && normalizeForMatch(added).includes(needle)) {
      return { written: true, via: 'excerpt-in-diff', matchedFile: target };
    }
  } else if (known.kind === 'directory') {
    const changed = getChangedStateFiles().filter(f => f.startsWith(target));
    for (const f of changed) {
      const added = getAddedLinesForFile(f);
      if (added && normalizeForMatch(added).includes(needle)) {
        return { written: true, via: 'excerpt-in-diff', matchedFile: f };
      }
    }
  }

  // Secondary evidence: request-log entry for this task mentions the target file.
  try {
    const tail = readRequestLogTail(8000);
    if (tail && ctx && ctx.taskId) {
      // Rough heuristic: find the entry block containing the taskId, check its Files field.
      const entryIdx = tail.lastIndexOf(ctx.taskId);
      if (entryIdx >= 0) {
        const window = tail.slice(Math.max(0, entryIdx - 500), Math.min(tail.length, entryIdx + 2000));
        const tgtBase = target.replace(/\/$/, '');
        if (window.includes(tgtBase)) {
          return { written: true, via: 'request-log-cites-target' };
        }
      }
    }
  } catch (_err) {
    /* no-op */
  }

  if (process.env.DEBUG) {
    // P8 debug: if the file did change but no excerpt match, surface it.
    const changed = getChangedStateFiles();
    if (
      (known.kind === 'file' && changed.includes(target)) ||
      (known.kind === 'directory' && changed.some(f => f.startsWith(target)))
    ) {
      console.error(
        `[capture-gate] target=${target} changed but excerpt not matched in diff: "${conclusion.excerpt.slice(0, 80)}"`
      );
    }
  }

  return { written: false, via: 'no-match' };
}

// ============================================================================
// Directive rendering
// ============================================================================

function renderDirective(misses) {
  if (!misses.length) return '';
  const lines = [
    'Capture gate: detected durable conclusions that were not captured to a state file.',
    '',
  ];
  for (const m of misses) {
    lines.push(`  • [${m.kind}] ${m.excerpt}`);
    lines.push(`      → write to: ${m.targetFile}`);
    lines.push(`      → suggested: ${m.suggestedCommand}`);
  }
  lines.push('');
  lines.push('Capture the above, then re-run `flow done`. To override temporarily, set');
  lines.push('  externalMemory.capture.blockOnMiss: false');
  lines.push('in .workflow/config.json (the bypass is logged to request-log).');
  return lines.join('\n');
}

// ============================================================================
// Telemetry helper
// ============================================================================

function recordTelemetry(verdict, runCtx = {}) {
  try {
    gateTelemetry.recordGateEvent({
      gateId: GATE_ID,
      gateVersion: GATE_VERSION,
      taskId: runCtx.taskId || null,
      verdict,
      findingCount: runCtx.missCount ?? 0,
      findingSummary: runCtx.findingSummary || [],
      durationMs: runCtx.durationMs,
      metadata: {
        reason: runCtx.reason || null,
        detected: runCtx.detected ?? null,
        written: runCtx.written ?? null,
        missed: runCtx.missCount ?? null,
        blockOnMiss: runCtx.blockOnMiss ?? null,
        minLevel: runCtx.minLevel ?? null,
        taskLevel: runCtx.taskLevel ?? null,
      },
    });
  } catch (_err) {
    // Telemetry failure must never break the gate.
  }
}

// ============================================================================
// Main gate handler — matches flow-done-gates.js interface
// ============================================================================

/**
 * Call the conclusion classifier synchronously via spawnSync so the gate handler
 * stays sync-compatible with flow-done-gates.js runGate (which does not await).
 * @returns {Array} classified conclusions (possibly empty)
 */
function callClassifierSync({ taskSummary, requestLogExcerpt, taskId, minConfidence }) {
  try {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, 'flow-conclusion-classifier.js'), 'classify'],
      {
        input: JSON.stringify({ taskSummary, requestLogExcerpt, taskId, minConfidence }),
        encoding: 'utf-8',
        timeout: CLASSIFIER_TIMEOUT_MS,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_PATH: process.env.NODE_PATH || '',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
          DEBUG: process.env.DEBUG || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    if (result.error) {
      if (process.env.DEBUG) {
        console.error(`[capture-gate] classifier spawn error: ${result.error.message}`);
      }
      return null; // null signals infrastructure error → SKIP
    }
    if (result.status !== 0) {
      if (process.env.DEBUG) {
        console.error(`[capture-gate] classifier exited ${result.status}: ${result.stderr || ''}`);
      }
      return null;
    }
    const out = String(result.stdout || '').trim();
    if (!out) return [];
    // Use safeJsonParseString (prototype-pollution guard) instead of raw JSON.parse
    // per security-patterns.md §2.
    const parsed = safeJsonParseString(out, null);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[capture-gate] classifier call failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * @param {Object} ctx - Gate context from flow-done-gates.js runGate
 * @returns {{ passed: boolean, skipped?: boolean, errorOutput?: string, details?: Object }}
 */
function captureGate(ctx) {
  const start = Date.now();
  const taskId = ctx?.taskId || null;
  const config = ctx?.config || getConfig();

  const dis = isGateDisabled(config);
  if (dis.disabled) {
    if (ctx?.color) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} captureGate (${dis.reason})`);
    }
    recordTelemetry('SKIP', {
      taskId,
      reason: dis.reason,
      durationMs: Date.now() - start,
    });
    return { passed: true, skipped: true, reason: dis.reason };
  }

  const captureCfg = dis.config;
  const minLevel = getMinLevel(captureCfg);
  const minConfidence = getMinConfidence(captureCfg);
  const blockOnMiss = getBlockOnMiss(captureCfg);

  const taskEntry = taskId ? loadTaskEntry(taskId) : null;
  const taskLevel = taskEntry?.level || null;

  if (taskLevel && levelIsBelowMin(taskLevel, minLevel)) {
    if (ctx?.color) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} captureGate (level ${taskLevel} below ${minLevel})`);
    }
    recordTelemetry('SKIP', {
      taskId,
      reason: 'level-too-low',
      taskLevel,
      minLevel,
      durationMs: Date.now() - start,
    });
    return { passed: true, skipped: true, reason: 'level-too-low' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    if (ctx?.warn) {
      ctx.warn('captureGate skipped — ANTHROPIC_API_KEY not set (classifier unavailable)');
    }
    recordTelemetry('SKIP', {
      taskId,
      reason: 'no-api-key',
      durationMs: Date.now() - start,
    });
    return { passed: true, skipped: true, reason: 'no-api-key' };
  }

  // Classify (synchronous subprocess call — gate dispatch is sync)
  const taskSummary = buildTaskSummary(taskEntry, taskId);
  const requestLogExcerpt = readRequestLogTail(6000);
  const raw = callClassifierSync({ taskSummary, requestLogExcerpt, taskId, minConfidence });
  if (raw === null) {
    // Infrastructure error → skip, don't block task close on our own failure.
    recordTelemetry('SKIP', {
      taskId,
      reason: 'classifier-error',
      durationMs: Date.now() - start,
    });
    return { passed: true, skipped: true, reason: 'classifier-error' };
  }

  // Enrich classifier output with canonical target-file / suggested-command metadata.
  // The CLI returns raw classifier records; we reattach KNOWN_TARGETS-derived metadata
  // via the conclusion-classifier's export to keep a single source of truth.
  let CONCLUSION_KINDS;
  try {
    CONCLUSION_KINDS = require('./flow-conclusion-classifier').CONCLUSION_KINDS;
  } catch (_err) {
    CONCLUSION_KINDS = {};
  }
  const conclusions = (Array.isArray(raw) ? raw : [])
    .map(r => {
      const meta = CONCLUSION_KINDS[r?.kind] || {};
      return {
        kind: r?.kind || 'unknown',
        targetFile: r?.targetFile || meta.targetFile || '',
        excerpt: String(r?.excerpt || '').slice(0, 240),
        rationale: String(r?.rationale || '').slice(0, 240),
        confidence: Number(r?.confidence) || 0,
        suggestedCommand: r?.suggestedCommand || meta.suggestedCommand || '',
        taskId,
      };
    })
    .filter(c => c.excerpt && c.targetFile);

  if (!conclusions.length) {
    if (ctx?.success) {
      ctx.success('captureGate (no durable conclusions detected)');
    }
    recordTelemetry('PASS', {
      taskId,
      detected: 0,
      written: 0,
      missCount: 0,
      blockOnMiss,
      minLevel,
      taskLevel,
      durationMs: Date.now() - start,
    });
    return { passed: true, details: { conclusions: [] } };
  }

  // Verify each
  const classified = [];
  const misses = [];
  for (const c of conclusions) {
    const v = verifyConclusionWrite(c, { taskId });
    const enriched = { ...c, written: v.written, verifiedVia: v.via, matchedFile: v.matchedFile };
    classified.push(enriched);
    if (!v.written) misses.push(enriched);
  }

  const detected = classified.length;
  const written = classified.filter(c => c.written).length;
  const missCount = misses.length;

  if (missCount === 0) {
    if (ctx?.success) {
      ctx.success(`captureGate (${written}/${detected} conclusions captured)`);
    }
    recordTelemetry('PASS', {
      taskId,
      detected,
      written,
      missCount: 0,
      blockOnMiss,
      minLevel,
      taskLevel,
      durationMs: Date.now() - start,
    });
    return { passed: true, details: { conclusions: classified } };
  }

  const directive = renderDirective(misses);
  const findingSummary = misses.slice(0, 5).map(m => `${m.kind}: ${m.excerpt.slice(0, 80)}`);

  if (!blockOnMiss) {
    // Soft mode: log bypass, warn, but pass.
    try {
      const { trackBypassAttempt } = require('./flow-session-state');
      trackBypassAttempt({
        taskId,
        operation: 'capture-gate',
        reason: `${missCount} conclusion(s) not captured (blockOnMiss=false)`,
        filePath: misses.map(m => m.targetFile).join(','),
      });
    } catch (_err) {
      /* no-op */
    }
    if (ctx?.warn) {
      ctx.warn(`captureGate — soft mode (${missCount}/${detected} conclusions missing)`);
      for (const m of misses.slice(0, 5)) {
        console.log(
          ctx.color
            ? ctx.color('dim', `    - ${m.kind}: ${m.excerpt.slice(0, 100)} → ${m.targetFile}`)
            : `    - ${m.kind}: ${m.excerpt.slice(0, 100)} → ${m.targetFile}`
        );
      }
    }
    recordTelemetry('CONCERN', {
      taskId,
      detected,
      written,
      missCount,
      blockOnMiss: false,
      minLevel,
      taskLevel,
      findingSummary,
      durationMs: Date.now() - start,
    });
    return { passed: true, details: { conclusions: classified, directive } };
  }

  // FAIL (block)
  if (ctx?.error) {
    ctx.error(`captureGate (${missCount}/${detected} durable conclusions not captured)`);
  }
  recordTelemetry('FAIL', {
    taskId,
    detected,
    written,
    missCount,
    blockOnMiss: true,
    minLevel,
    taskLevel,
    findingSummary,
    durationMs: Date.now() - start,
  });
  return {
    passed: false,
    errorOutput: directive,
    details: { conclusions: classified, directive },
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  captureGate,
  isGateDisabled,
  verifyConclusionWrite,
  renderDirective,
  KNOWN_TARGETS,
  // Private helpers exposed for tests
  _levelIsBelowMin: levelIsBelowMin,
  _normalizeForMatch: normalizeForMatch,
  _getChangedStateFiles: getChangedStateFiles,
  _getAddedLinesForFile: getAddedLinesForFile,
};

// ============================================================================
// CLI for smoke-testing
// ============================================================================

if (require.main === module) {
  const [, , cmd, taskArg] = process.argv;
  if (cmd === 'smoke') {
    const ctx = {
      taskId: taskArg || process.env.WOGI_TASK_ID || null,
      config: getConfig(),
      color: (_c, s) => s,
      success: s => console.log(`PASS: ${s}`),
      warn: s => console.log(`WARN: ${s}`),
      error: s => console.log(`FAIL: ${s}`),
    };
    const res = captureGate(ctx);
    console.log('\n--- result ---');
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log('Usage: node scripts/flow-capture-gate.js smoke [taskId]');
  }
}
