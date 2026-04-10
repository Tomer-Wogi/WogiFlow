#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreToolUse Hook
 *
 * Called before Edit/Write/TodoWrite/Skill/Bash tool execution.
 * Enforces task gating, scope validation, component reuse checking,
 * TodoWrite gating, and routing gate enforcement.
 *
 * v4.0: Added scope gating to validate edits are within task's declared scope
 * v6.0: Added routing gate — blocks Bash before /wogi-* routing
 */

const path = require('node:path');
const { checkScopeGate } = require('../../core/scope-gate');
const { checkComponentReuse } = require('../../core/component-check');
const { checkTodoWriteGate } = require('../../core/todowrite-gate');
const { checkRoutingGate, clearRoutingPending, hasActiveTask } = require('../../core/routing-gate');
const { checkPhaseGate } = require('../../core/phase-gate');
const { checkCommitLogGate } = require('../../core/commit-log-gate');
// F19: Lazy-load enforcement gates with try/catch to prevent one broken gate from crashing all hooks
const _noop = () => ({ allowed: true, blocked: false });
let checkDeployGate = _noop, checkWriteBlock = _noop;
try { const dg = require('../../core/deploy-gate'); checkDeployGate = dg.checkDeployGate; checkWriteBlock = dg.checkWriteBlock; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Deploy gate not loaded: ${_err.message}`); }
let checkStrikeGate = _noop;
try { checkStrikeGate = require('../../core/strike-gate').checkStrikeGate; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Strike gate not loaded: ${_err.message}`); }
let checkBugfixScope = _noop;
try { checkBugfixScope = require('../../core/bugfix-scope-gate').checkBugfixScope; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Bugfix scope gate not loaded: ${_err.message}`); }
let checkScopeMutation = _noop;
try { checkScopeMutation = require('../../core/scope-mutation-gate').checkScopeMutation; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Scope mutation gate not loaded: ${_err.message}`); }
let checkGitSafety = _noop;
try { checkGitSafety = require('../../core/git-safety-gate').checkGitSafety; } catch (_err) { if (process.env.DEBUG) console.error(`[Hook] Git safety gate not loaded: ${_err.message}`); }
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending } = require('../../../flow-durable-session');
const { getConfig } = require('../../../flow-utils');
const { readHookStatus } = require('../../../flow-hook-status');
const { runHook } = require('../shared/hook-runner');

// Lazy-load strict adherence to avoid circular deps and startup cost
let _strictAdherence = null;
function getStrictAdherence() {
  if (!_strictAdherence) {
    try {
      _strictAdherence = require('../../../flow-strict-adherence');
    } catch (err) {
      _strictAdherence = { isEnabled: () => false, validateCommand: () => ({ valid: true }) };
    }
  }
  return _strictAdherence;
}

runHook('PreToolUse', async ({ input, parsedInput }) => {
  const hookStart = process.hrtime.bigint();

  // Handle empty or invalid input gracefully
  if (!input || Object.keys(input).length === 0) {
    return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  }

  const toolName = parsedInput.toolName;
  const toolInput = parsedInput.toolInput || {};
  const filePath = toolInput.file_path;

  // Agent-aware gating: detect subagent context from hook event fields
  const rawAgentId = input.agent_id || null;
  const rawAgentType = input.agent_type || null;

  const VALID_AGENT_TYPES = new Set([
    'general-purpose', 'Explore', 'Plan', 'code-reviewer', 'bug-analyzer',
    'statusline-setup', 'claude-code-guide', 'ui-sketcher'
  ]);
  const agentId = (typeof rawAgentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawAgentId)) ? rawAgentId : null;
  const agentType = (typeof rawAgentType === 'string' && VALID_AGENT_TYPES.has(rawAgentType)) ? rawAgentType : null;
  const isSubagent = !!agentId;

  const readOnlyAgentTypes = new Set(['Explore', 'Plan', 'code-reviewer', 'bug-analyzer']);
  const subagentReadOnly = isSubagent && agentType ? readOnlyAgentTypes.has(agentType) : false;

  // Fast path: read pre-computed hook status
  const hookStatus = readHookStatus();
  if (hookStatus && hookStatus.enforcement) {
    const enf = hookStatus.enforcement;
    const allGatesDisabled = enf.taskGating === false && enf.scopeGating === false
      && enf.routingGate === false && enf.commitLogGate === false
      && enf.todoWriteGate === false && enf.loopEnforcement === false
      && enf.deployGate === false && enf.strikeEscalation === false
      && enf.bugfixScope === false && enf.scopeMutation === false
      && enf.gitSafety === false
      && hookStatus.componentReuse === false && hookStatus.phaseGate === false;
    if (allGatesDisabled) {
      if (process.env.DEBUG) {
        const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
        console.error(`[Hook] PreToolUse fast-path: ${elapsed.toFixed(1)}ms`);
      }
      return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    }
  }

  // Load config ONCE
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Config load error: ${err.message}`);
    config = null;
  }

  let coreResult = { allowed: true, blocked: false };

  // Phase gate check
  const isReadTool = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(toolName);
  const skipPhaseGateForSubagent = isSubagent && subagentReadOnly && isReadTool;

  if (!skipPhaseGateForSubagent) {
    try {
      const phaseResult = checkPhaseGate(toolName, toolInput, config);
      if (phaseResult.blocked) {
        coreResult = { allowed: false, blocked: true, reason: phaseResult.reason, message: phaseResult.message };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Phase gate error (fail-open): ${err.message}`);
    }
  }

  // Task + scope gating check (for Edit and Write)
  if (toolName === 'Edit' || toolName === 'Write') {
    coreResult = checkScopeGate({
      filePath,
      operation: toolName.toLowerCase()
    }, config);

    if (coreResult.blocked) {
      const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
      return { __raw: true, ...output };
    }
  }

  // TodoWrite gating check
  if (toolName === 'TodoWrite') {
    const todos = toolInput.todos || [];
    coreResult = checkTodoWriteGate({ todos }, config);

    if (coreResult.blocked) {
      const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
      return { __raw: true, ...output };
    }
  }

  // v4.1: Skill execution tracking
  if (toolName === 'Skill') {
    const skillName = toolInput.skill;
    if (typeof skillName === 'string' && /^wogi-(bulk|start)$/i.test(skillName)) {
      markSkillPending(skillName.toLowerCase(), { args: toolInput.args });
      if (process.env.DEBUG) {
        console.error(`[Hook] Marked skill ${skillName} as pending (via Skill tool)`);
      }
    }

    // v6.0: Clear routing-pending flag on ANY /wogi-* skill invocation
    if (typeof skillName === 'string' && /^wogi-/i.test(skillName)) {
      try {
        clearRoutingPending();
        if (process.env.DEBUG) {
          console.error(`[Hook] Cleared routing-pending flag (Skill: ${skillName})`);
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Hook] Failed to clear routing flag: ${err.message}`);
        }
      }
    }
  }

  // v6.0: Routing gate
  const skipRoutingGateForSubagent = isSubagent && hasActiveTask();

  let skipRoutingGateForReadOnlyGit = false;
  if (toolName === 'Bash' && toolInput.command) {
    const cmd = toolInput.command.trim();
    const READ_ONLY_GIT_PREFIXES = [
      'git status', 'git log', 'git diff', 'git branch',
      'git show', 'git rev-parse', 'git remote -v', 'git tag -l',
      'git ls-files', 'git describe'
    ];
    const SHELL_CHAIN_OPERATORS = /[;&|`$()\n\r\\]/;
    const DESTRUCTIVE_GIT_FLAGS = /\s-[dD]\b|\s--delete\b|\s--force\b|\s--hard\b|\s--prune\b/;
    if (
      READ_ONLY_GIT_PREFIXES.some(prefix => cmd.startsWith(prefix)) &&
      !SHELL_CHAIN_OPERATORS.test(cmd) &&
      !DESTRUCTIVE_GIT_FLAGS.test(cmd)
    ) {
      skipRoutingGateForReadOnlyGit = true;
    }
  }

  if (!skipRoutingGateForSubagent && !skipRoutingGateForReadOnlyGit && (toolName === 'Bash' || toolName === 'EnterPlanMode' || toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep' || toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit' || toolName === 'Agent' || toolName === 'WebSearch' || toolName === 'WebFetch')) {
    try {
      const routingResult = checkRoutingGate(toolName, config);
      if (routingResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Routing gate: ${routingResult.reason}`,
          message: routingResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      // Fail-CLOSED for routing gate
      if (process.env.DEBUG) {
        console.error(`[Hook] Routing gate error (fail-closed): ${err.message}`);
      }
      coreResult = {
        allowed: false,
        blocked: true,
        reason: `Routing gate error: ${err.message}`,
        message: 'Routing gate check failed. Please invoke /wogi-start first. Use Skill(skill="wogi-start", args="<your request>").'
      };
      const errOutput = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
      return { __raw: true, ...errOutput };
    }
  }

  // Commit log gate check
  if (toolName === 'Bash' && toolInput.command) {
    try {
      const commitLogResult = checkCommitLogGate(toolInput.command, config);
      if (commitLogResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Commit log gate: ${commitLogResult.reason}`,
          message: commitLogResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Commit log gate error (fail-open): ${err.message}`);
      }
    }
  }

  // Deploy gate check (for Bash commands — blocks deploy without verification artifact)
  if (toolName === 'Bash' && toolInput.command) {
    try {
      const deployResult = checkDeployGate(toolInput.command, config);
      if (deployResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Deploy gate: ${deployResult.reason}`,
          message: deployResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      // Fail-open: deploy gate errors should not block normal work
      if (process.env.DEBUG) {
        console.error(`[Hook] Deploy gate error (fail-open): ${err.message}`);
      }
    }
  }

  // Deploy gate: block Write to verification artifacts (anti-forgery)
  if ((toolName === 'Write' || toolName === 'Edit') && filePath) {
    try {
      const writeBlockResult = checkWriteBlock(filePath, config);
      if (writeBlockResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Deploy gate: ${writeBlockResult.reason}`,
          message: writeBlockResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Deploy gate write-block error (fail-open): ${err.message}`);
      }
    }
  }

  // Scope mutation guard (fix tasks creating files, deleting pre-existing files)
  if (toolName === 'Write' || toolName === 'Bash') {
    try {
      const scopeMutResult = checkScopeMutation(toolName, toolInput, config);
      if (scopeMutResult.blocked) {
        coreResult = {
          allowed: false, blocked: true,
          reason: `Scope mutation: ${scopeMutResult.reason}`,
          message: scopeMutResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Scope mutation gate error (fail-open): ${err.message}`);
    }
  }

  // Git safety net (auto-backup before destructive git operations)
  if (toolName === 'Bash' && toolInput.command && /git\s+(reset|checkout\s+(--\s+)?[\.\-]|restore\s+.*\.|clean\s+.*-f)/.test(toolInput.command)) {
    try {
      const gitResult = checkGitSafety(toolInput.command, config);
      if (gitResult.blocked) {
        coreResult = {
          allowed: false, blocked: true,
          reason: `Git safety: ${gitResult.reason}`,
          message: gitResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Git safety gate error (fail-open): ${err.message}`);
    }
  }

  // Bugfix scope gate (warns/blocks L3 bugfixes after 3+ unique file edits)
  if (toolName === 'Edit' || toolName === 'Write') {
    try {
      const scopeResult = checkBugfixScope(toolName, config);
      if (scopeResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Bugfix scope: ${scopeResult.reason}`,
          message: scopeResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Bugfix scope gate error (fail-open): ${err.message}`);
      }
    }
  }

  // Strike escalation gate (blocks Edit/Write/Bash after repeated verification failures)
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') {
    try {
      const strikeResult = checkStrikeGate(toolName, config);
      if (strikeResult.blocked) {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Strike gate: ${strikeResult.reason}`,
          message: strikeResult.message
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      // Fail-open: strike gate errors should not block normal work
      if (process.env.DEBUG) {
        console.error(`[Hook] Strike gate error (fail-open): ${err.message}`);
      }
    }
  }

  // Strict adherence check (for Bash commands)
  if (toolName === 'Bash') {
    const command = toolInput.command;
    if (command) {
      const strictAdherence = getStrictAdherence();
      if (strictAdherence.isEnabled()) {
        const cmdResult = strictAdherence.validateCommand(command);
        if (cmdResult.blocked) {
          coreResult = {
            allowed: false,
            blocked: true,
            reason: `Strict adherence: ${cmdResult.reason}`,
            message: cmdResult.autoCorrect
              ? `⚠️ BLOCKED: ${cmdResult.reason}\n\n✅ Auto-correcting to: ${cmdResult.autoCorrect}`
              : `⚠️ BLOCKED: ${cmdResult.reason}\n\n💡 ${cmdResult.suggestion || 'Please use the correct pattern.'}`
          };
          const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
          return { __raw: true, ...output };
        }
      }
    }
  }

  // Damage control check (for Bash commands)
  if (toolName === 'Bash' && toolInput.command && config?.damageControl?.enabled) {
    try {
      const dc = require('../../../flow-damage-control');
      const dcResult = dc.checkBashEvent(toolInput.command);
      if (dcResult && dcResult.action === 'block') {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Damage control: ${dcResult.reason || dcResult.message || 'blocked by rule'}`,
          message: `\u26d4 BLOCKED by damage control: ${dcResult.message || dcResult.reason || 'This command matches a blocked pattern.'}\n\nRule: ${dcResult.rule || 'unknown'}`
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
      if (dcResult && dcResult.action === 'ask') {
        coreResult = {
          allowed: true,
          blocked: false,
          reason: `Damage control warning: ${dcResult.reason || dcResult.message || 'requires confirmation'}`,
          message: `\u26a0\ufe0f Damage control: ${dcResult.message || dcResult.reason || 'This command matches an ask-before-execute pattern.'}`
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Damage control error (fail-open): ${err.message}`);
      }
    }
  }

  // Damage control check (for file operations)
  if ((toolName === 'Edit' || toolName === 'Write') && filePath && config?.damageControl?.enabled && config?.damageControl?.events?.file) {
    try {
      const dc = require('../../../flow-damage-control');
      const dcResult = dc.checkFileEvent(filePath, toolName.toLowerCase());
      if (dcResult && dcResult.action === 'block') {
        coreResult = {
          allowed: false,
          blocked: true,
          reason: `Damage control: ${dcResult.reason || 'file access blocked'}`,
          message: `\u26d4 BLOCKED by damage control: ${dcResult.message || 'This file is protected.'}`
        };
        const output = claudeCodeAdapter.transformResult('PreToolUse', coreResult);
        return { __raw: true, ...output };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Damage control file check error (fail-open): ${err.message}`);
      }
    }
  }

  // Component reuse check (for Write only)
  if (toolName === 'Write' && filePath) {
    const componentResult = checkComponentReuse({
      filePath,
      content: toolInput.content
    }, config);

    if (componentResult.blocked || componentResult.warning) {
      coreResult = {
        ...coreResult,
        ...componentResult,
        allowed: !componentResult.blocked,
        blocked: componentResult.blocked
      };
    }

    // Strict adherence: File naming check (for Write)
    if (!coreResult.blocked) {
      const strictAdherence = getStrictAdherence();
      if (strictAdherence.isEnabled()) {
        const isComponent = /\/(components?|ui)\//i.test(filePath) && /\.(tsx|jsx)$/i.test(filePath);
        const isApi = /\/(api|routes)\//i.test(filePath);
        const fileType = isComponent ? 'component' : isApi ? 'api' : 'generic';

        const fileName = path.basename(filePath);
        const fileResult = strictAdherence.validateFileName(fileName, fileType);
        if (fileResult.blocked) {
          coreResult = {
            allowed: false,
            blocked: true,
            reason: `Strict adherence: ${fileResult.reason}`,
            message: `⚠️ BLOCKED: ${fileResult.reason}\n\n💡 ${fileResult.suggestion || 'Please use the correct naming convention.'}`
          };
        }
      }
    }
  }

  // Benchmark: log hook latency when DEBUG is enabled
  if (process.env.DEBUG) {
    const elapsed = Number(process.hrtime.bigint() - hookStart) / 1e6;
    console.error(`[Hook] PreToolUse latency: ${elapsed.toFixed(1)}ms`);
  }

  return coreResult;
}, { failMode: 'block' });
