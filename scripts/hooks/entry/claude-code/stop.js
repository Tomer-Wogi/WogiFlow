#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Stop Hook (thin entry)
 *
 * All Stop-hook business logic lives in scripts/hooks/core/stop-orchestrator.js.
 * This entry file dispatches.
 *
 * Per .claude/rules/architecture/hook-three-layer.md: entry files ≤ 120 LOC,
 * ≤ 2 core/ imports, no inline business logic. wf-6e31850e A-3 extracted
 * the prior 518-LOC body into core/stop-orchestrator.js +
 * core/workspace-stop-notify.js + core/task-boundary-restart-coordinator.js +
 * core/workspace-stop-gates.js.
 */

const { orchestrateStop } = require('../../core/stop-orchestrator');
const { runHook } = require('../shared/hook-runner');

runHook('Stop', async ({ parsedInput }) => {
  return await orchestrateStop({ parsedInput });
}, { failMode: 'warn', failOutput: { continue: false } });
