#!/usr/bin/env node

/**
 * Wogi Flow - PreToolUse Helpers (core module)
 *
 * Shared helper functions extracted from scripts/hooks/entry/claude-code/pre-tool-use.js
 * to improve three-layer compliance (entry = parse + dispatch, core = logic).
 *
 * Story: wf-93b48ca1 (epic wf-94cc3b72, arch-001 fix — partial).
 *
 * Scope: safe, pure helpers only. The 480-line gate-orchestration body
 * remains in the entry file until hook coverage (wf-e9e31c7c) lands — refactoring
 * it blind is high-risk given 0 unit tests on the orchestration path.
 */

const VALID_AGENT_TYPES = new Set([
  'general-purpose', 'Explore', 'Plan', 'code-reviewer', 'bug-analyzer',
  'statusline-setup', 'claude-code-guide', 'ui-sketcher',
]);

const READ_ONLY_AGENT_TYPES = new Set(['Explore', 'Plan', 'code-reviewer', 'bug-analyzer']);

/**
 * Parse + validate the subagent context from hook input.
 *
 * @param {Object} input - Parsed hook input
 * @returns {{ agentId: string|null, agentType: string|null, isSubagent: boolean, subagentReadOnly: boolean }}
 */
function parseSubagentContext(input) {
  const rawAgentId = input && input.agent_id ? input.agent_id : null;
  const rawAgentType = input && input.agent_type ? input.agent_type : null;
  const agentId = typeof rawAgentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawAgentId) ? rawAgentId : null;
  const agentType = typeof rawAgentType === 'string' && VALID_AGENT_TYPES.has(rawAgentType) ? rawAgentType : null;
  const isSubagent = !!agentId;
  const subagentReadOnly = isSubagent && agentType ? READ_ONLY_AGENT_TYPES.has(agentType) : false;
  return { agentId, agentType, isSubagent, subagentReadOnly };
}

/**
 * Check if the hook-status fast path applies — all gates disabled, skip
 * full orchestration.
 *
 * @param {Object|null} hookStatus - Result of readHookStatus()
 * @returns {boolean}
 */
function isAllGatesDisabled(hookStatus) {
  if (!hookStatus || !hookStatus.enforcement) return false;
  const enf = hookStatus.enforcement;
  return (
    enf.taskGating === false &&
    enf.scopeGating === false &&
    enf.routingGate === false &&
    enf.commitLogGate === false &&
    enf.todoWriteGate === false &&
    enf.loopEnforcement === false &&
    enf.deployGate === false &&
    enf.strikeEscalation === false &&
    enf.bugfixScope === false &&
    enf.scopeMutation === false &&
    enf.gitSafety === false &&
    hookStatus.componentReuse === false &&
    hookStatus.phaseGate === false &&
    hookStatus.phaseReadGate === false
  );
}

module.exports = {
  VALID_AGENT_TYPES,
  READ_ONLY_AGENT_TYPES,
  parseSubagentContext,
  isAllGatesDisabled,
};
