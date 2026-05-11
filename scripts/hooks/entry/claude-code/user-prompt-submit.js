#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code UserPromptSubmit Hook (thin entry)
 *
 * All UserPromptSubmit business logic lives in
 * scripts/hooks/core/user-prompt-orchestrator.js. This entry dispatches.
 *
 * Per .claude/rules/architecture/hook-three-layer.md: entry files ≤ 120 LOC,
 * ≤ 2 core/ imports, no inline business logic. wf-6e31850e A-3 extracted
 * the prior 293-LOC body into core/user-prompt-orchestrator.js.
 */

const { orchestrateUserPromptSubmit } = require('../../core/user-prompt-orchestrator');
const { runHook } = require('../shared/hook-runner');

runHook('UserPromptSubmit', async ({ input, parsedInput }) => {
  return await orchestrateUserPromptSubmit({ input, parsedInput });
}, {
  failMode: 'block',
  failOutput: {
    decision: 'block',
    reason: 'WogiFlow validation error. Please check your WogiFlow setup or use /wogi-start to route your request.'
  }
});
