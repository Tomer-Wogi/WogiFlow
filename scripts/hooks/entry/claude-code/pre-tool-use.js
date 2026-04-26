#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreToolUse Hook (Entry)
 *
 * Thin CLI-specific entry point. Parses input, wires dependencies, and
 * dispatches to the shared pre-tool-orchestrator.
 *
 * Extraction history:
 *   v7.0  — Original 470-LOC inline gate cascade extracted to
 *           scripts/hooks/core/pre-tool-orchestrator.js.
 *   v8.0  — Audit Story 9 (wf-5e94e2c0, 2026-04-26): the lazy-loader
 *           try/catch boilerplate (12 gate modules) extracted to
 *           scripts/hooks/core/pre-tool-deps.js. Entry brought below the
 *           ≤120 LOC three-layer rule.
 */

'use strict';

const { runPreToolGates } = require('../../core/pre-tool-orchestrator');
const { loadGateDeps } = require('../../core/pre-tool-deps');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { runHook } = require('../shared/hook-runner');

runHook('PreToolUse', async ({ input, parsedInput }) => {
  const hookStart = process.hrtime.bigint();

  // Empty input — allow through
  if (!input || Object.keys(input).length === 0) {
    return {
      __raw: true,
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
    };
  }

  const deps = loadGateDeps();
  const coreResult = runPreToolGates({ input, parsedInput }, deps);

  // Fast path (no transform needed — short-circuit to allow)
  if (coreResult._fastPath) {
    if (process.env.DEBUG) {
      const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
      console.error(`[Hook] PreToolUse fast-path: ${elapsed.toFixed(1)}ms`);
    }
    return {
      __raw: true,
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
    };
  }

  if (coreResult.blocked) {
    const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
    return { __raw: true, ...output };
  }

  if (process.env.DEBUG) {
    const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
    console.error(`[Hook] PreToolUse latency: ${elapsed.toFixed(1)}ms`);
  }

  return coreResult;
}, { failMode: 'block' });
