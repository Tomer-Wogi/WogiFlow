#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionStart Hook (thin entry)
 *
 * All SessionStart business logic lives in
 * scripts/hooks/core/session-start-orchestrator.js. This entry dispatches.
 *
 * Per .claude/rules/architecture/hook-three-layer.md: entry files ≤ 120 LOC,
 * ≤ 2 core/ imports, no inline business logic. wf-6e31850e A-3 extracted
 * the prior 387-LOC body into core/session-start-orchestrator.js.
 *
 * Boot-latency instrumentation (env-guarded, no effect unless WOGI_DEBUG_BOOT=1)
 * stays here because it wraps the call.
 */

const { orchestrateSessionStart } = require('../../core/session-start-orchestrator');
const { runHook } = require('../shared/hook-runner');

// wf-8294d960: env-guarded boot-latency instrumentation.
const BOOT_DEBUG = process.env.WOGI_DEBUG_BOOT === '1';
const _bootT0 = BOOT_DEBUG ? Date.now() : 0;
const _bootLogFile = BOOT_DEBUG
  ? require('path').join(require('os').tmpdir(), 'wogi-boot-latency.log')
  : null;
let _bootSep = false;
function _bootWrite(line) {
  if (!BOOT_DEBUG) return;
  try {
    if (!_bootSep) {
      require('fs').appendFileSync(_bootLogFile, `\n=== SessionStart pid=${process.pid} @ ${new Date().toISOString()} ===\n`);
      _bootSep = true;
    }
    require('fs').appendFileSync(_bootLogFile, line + '\n');
  } catch (_err) { /* non-blocking */ }
}
function _bootMark(label) {
  if (!BOOT_DEBUG) return;
  _bootWrite(`[boot-latency] +${String(Date.now() - _bootT0).padStart(6)}ms ${label}`);
}
async function _bootTime(label, fn) {
  if (!BOOT_DEBUG) return fn();
  const t = Date.now();
  try { return await fn(); }
  finally { _bootWrite(`[boot-latency]   (${String(Date.now() - t).padStart(6)}ms) ${label}`); }
}

runHook('SessionStart', async ({ parsedInput }) => {
  return await orchestrateSessionStart({
    parsedInput,
    bootMark: _bootMark,
    bootTime: _bootTime
  });
}, { failMode: 'warn' });
