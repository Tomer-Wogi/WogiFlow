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

/**
 * Resolve the current workflow phase + task meta from state files.
 *
 * Reads `.workflow/state/workflow-phase.json` for { phase, taskId }, then
 * looks up the matching task in `ready.json.inProgress` for full taskMeta.
 *
 * Fail-open everywhere: any read/parse error → returns the partial state
 * resolved so far. Multiple gates may need this context; centralizing here
 * stops the inline-block proliferation flagged by review L3.
 *
 * @returns {{phase: string, taskId: string|null, taskMeta: object|null}}
 */
function resolveCurrentTaskContext() {
  const path = require('node:path');
  const flowUtils = require('../../flow-utils');
  const flowIo = require('../../flow-io');
  let phase = 'idle';
  let taskId = null;
  let taskMeta = null;
  try {
    const phaseStatePath = path.join(flowUtils.PATHS.state, 'workflow-phase.json');
    const ps = flowIo.safeJsonParse(phaseStatePath, null);
    if (ps) {
      phase = ps.phase || 'idle';
      taskId = ps.taskId || null;
    }
  } catch (_err) { /* fail-open */ }
  if (taskId) {
    try {
      const ready = flowUtils.getReadyData ? flowUtils.getReadyData() : null;
      const inProgress = (ready && Array.isArray(ready.inProgress)) ? ready.inProgress : [];
      taskMeta = inProgress.find(t => t && t.id === taskId) || null;
    } catch (_err) { /* fail-open */ }
  }
  return { phase, taskId, taskMeta };
}

module.exports = {
  VALID_AGENT_TYPES,
  READ_ONLY_AGENT_TYPES,
  parseSubagentContext,
  isAllGatesDisabled,
  resolveCurrentTaskContext,
};
