#!/usr/bin/env node

/**
 * Wogi Flow - PreToolUse Orchestrator (Core Module)
 *
 * Gate-cascade logic extracted from scripts/hooks/entry/claude-code/pre-tool-use.js
 * (wf-94cc3b72 epic / TD-002). Entry file shrinks from 538 LOC to a thin
 * wiring layer; this module owns the check sequence.
 *
 * CLI-agnostic: all side-effect and gate dependencies are injected via
 * the `deps` argument so this module can be unit-tested in isolation and
 * reused by future (non-Claude-Code) CLIs.
 *
 * Contract:
 *   runPreToolGates({ input, parsedInput }, deps) → coreResult
 *   where coreResult = { allowed, blocked, reason?, message?, ...extras }
 *
 *   Special sentinel field `_fastPath: true` signals that the all-gates-disabled
 *   fast path was taken — the entry-layer should bypass the adapter transform
 *   and return an allow response directly. Always paired with allowed=true.
 *
 * Short-circuit: the first gate that blocks wins — subsequent gates skip.
 * Fail-open everywhere except routing gate (fail-closed) and top-level
 * try/catch boundaries.
 */

'use strict';

const path = require('node:path');
const { parseSubagentContext, isAllGatesDisabled } = require('./pre-tool-helpers');

/**
 * Run the PreToolUse gate cascade.
 *
 * @param {Object} ctx - { input, parsedInput }
 * @param {Object} deps - Injected gate functions + side-effect helpers
 *   - checkScopeGate, checkComponentReuse, checkTodoWriteGate
 *   - checkRoutingGate, clearRoutingPending, hasActiveTask
 *   - checkPhaseGate, checkCommitLogGate
 *   - recordPhaseRead, checkPhaseReadGate, clearPhaseReads
 *   - checkDeployGate, checkWriteBlock
 *   - checkStrikeGate, checkBugfixScope, checkScopeMutation
 *   - checkGitSafety, checkManagerBoundary
 *   - markSkillPending, getConfig, readHookStatus
 *   - getStrictAdherence
 * @returns {Object} coreResult
 */
function runPreToolGates(ctx, deps) {
  const { input, parsedInput } = ctx;

  // Handle empty/invalid input gracefully (caller also handles, belt-and-braces)
  if (!input || Object.keys(input).length === 0) {
    return { allowed: true, blocked: false };
  }

  const toolName = parsedInput.toolName;
  const toolInput = parsedInput.toolInput || {};
  const filePath = toolInput.file_path;

  // Agent-aware gating
  const { isSubagent, subagentReadOnly } = parseSubagentContext(input);

  // Fast path: pre-computed hook status
  const hookStatus = deps.readHookStatus();
  if (isAllGatesDisabled(hookStatus)) {
    return { allowed: true, blocked: false, _fastPath: true };
  }

  // Load config once
  let config;
  try {
    config = deps.getConfig();
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Config load error: ${err.message}`);
    config = null;
  }

  let coreResult = { allowed: true, blocked: false };

  // Phase-read recording (side effect)
  if (toolName === 'Read' && filePath) {
    try { deps.recordPhaseRead(filePath); } catch (_err) { /* fail-open */ }
  }

  // Phase gate
  const isReadTool = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(toolName);
  const skipPhaseGateForSubagent = isSubagent && subagentReadOnly && isReadTool;

  if (!skipPhaseGateForSubagent) {
    try {
      const phaseResult = deps.checkPhaseGate(toolName, toolInput, config);
      if (phaseResult.blocked) {
        return { allowed: false, blocked: true, reason: phaseResult.reason, message: phaseResult.message };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Phase gate error (fail-open): ${err.message}`);
    }
  }

  // Phase-read gate
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') {
    try {
      const readGateResult = deps.checkPhaseReadGate(toolName, config);
      if (readGateResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: 'Phase-read gate: phase file not read',
          message: readGateResult.message,
        };
      }
    } catch (_err) {
      if (process.env.DEBUG) console.error(`[Hook] Phase-read gate error (fail-open): ${_err.message}`);
    }
  }

  // Scope gate (Edit/Write only)
  if (toolName === 'Edit' || toolName === 'Write') {
    coreResult = deps.checkScopeGate({ filePath, operation: toolName.toLowerCase() }, config);
    if (coreResult.blocked) return coreResult;
  }

  // TodoWrite gate
  if (toolName === 'TodoWrite') {
    const todos = toolInput.todos || [];
    coreResult = deps.checkTodoWriteGate({ todos }, config);
    if (coreResult.blocked) return coreResult;
  }

  // Skill tool tracking (side effects)
  if (toolName === 'Skill') {
    const skillName = toolInput.skill;
    if (typeof skillName === 'string' && /^wogi-(bulk|start)$/i.test(skillName)) {
      deps.markSkillPending(skillName.toLowerCase(), { args: toolInput.args });
      try { deps.clearPhaseReads(); } catch (_err) { /* fail-open */ }
      if (process.env.DEBUG) {
        console.error(`[Hook] Marked skill ${skillName} as pending (via Skill tool)`);
      }
    }
    if (typeof skillName === 'string' && /^wogi-/i.test(skillName)) {
      try {
        deps.clearRoutingPending();
        if (process.env.DEBUG) {
          console.error(`[Hook] Cleared routing-pending flag (Skill: ${skillName})`);
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`[Hook] Failed to clear routing flag: ${err.message}`);
      }
    }
  }

  // Routing gate
  const skipRoutingGateForSubagent = isSubagent && deps.hasActiveTask();

  let skipRoutingGateForReadOnlyGit = false;
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const cmd = toolInput.command.trim();
    const READ_ONLY_GIT_PREFIXES = [
      'git status', 'git log', 'git diff', 'git branch',
      'git show', 'git rev-parse', 'git remote -v', 'git tag -l',
      'git ls-files', 'git describe',
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

  const GATED_TOOLS = new Set([
    'Bash', 'EnterPlanMode', 'Read', 'Glob', 'Grep',
    'Edit', 'Write', 'NotebookEdit', 'Agent', 'WebSearch', 'WebFetch',
  ]);
  if (!skipRoutingGateForSubagent && !skipRoutingGateForReadOnlyGit && GATED_TOOLS.has(toolName)) {
    try {
      const routingResult = deps.checkRoutingGate(toolName, config, toolInput);
      if (routingResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Routing gate: ${routingResult.reason}`,
          message: routingResult.message,
        };
      }
    } catch (err) {
      // Fail-CLOSED for routing gate
      if (process.env.DEBUG) console.error(`[Hook] Routing gate error (fail-closed): ${err.message}`);
      return {
        allowed: false,
        blocked: true,
        reason: `Routing gate error: ${err.message}`,
        message: 'Routing gate check failed. Please invoke /wogi-start first. Use Skill(skill="wogi-start", args="<your request>").',
      };
    }
  }

  // Manager boundary
  if (process.env.WOGI_REPO_NAME === 'manager') {
    try {
      const boundaryResult = deps.checkManagerBoundary(toolName, toolInput);
      if (boundaryResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: boundaryResult.reason,
          message: boundaryResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Manager boundary gate error (fail-open): ${err.message}`);
    }
  }

  // Commit log gate
  if (toolName === 'Bash' && toolInput.command) {
    try {
      const commitLogResult = deps.checkCommitLogGate(toolInput.command, config);
      if (commitLogResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Commit log gate: ${commitLogResult.reason}`,
          message: commitLogResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Commit log gate error (fail-open): ${err.message}`);
    }
  }

  // Deploy gate (Bash)
  if (toolName === 'Bash' && toolInput.command) {
    try {
      const deployResult = deps.checkDeployGate(toolInput.command, config);
      if (deployResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Deploy gate: ${deployResult.reason}`,
          message: deployResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Deploy gate error (fail-open): ${err.message}`);
    }
  }

  // Deploy gate (Write anti-forgery)
  if ((toolName === 'Write' || toolName === 'Edit') && filePath) {
    try {
      const writeBlockResult = deps.checkWriteBlock(filePath, config);
      if (writeBlockResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Deploy gate: ${writeBlockResult.reason}`,
          message: writeBlockResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Deploy gate write-block error (fail-open): ${err.message}`);
    }
  }

  // Scope mutation guard
  if (toolName === 'Write' || toolName === 'Bash') {
    try {
      const scopeMutResult = deps.checkScopeMutation(toolName, toolInput, config);
      if (scopeMutResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Scope mutation: ${scopeMutResult.reason}`,
          message: scopeMutResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Scope mutation gate error (fail-open): ${err.message}`);
    }
  }

  // Git safety
  if (toolName === 'Bash' && toolInput.command && /git\s+(reset|checkout\s+(--\s+)?[\.\-]|restore\s+.*\.|clean\s+.*-f)/.test(toolInput.command)) {
    try {
      const gitResult = deps.checkGitSafety(toolInput.command, config);
      if (gitResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Git safety: ${gitResult.reason}`,
          message: gitResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Git safety gate error (fail-open): ${err.message}`);
    }
  }

  // Bugfix scope
  if (toolName === 'Edit' || toolName === 'Write') {
    try {
      const scopeResult = deps.checkBugfixScope(toolName, config);
      if (scopeResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Bugfix scope: ${scopeResult.reason}`,
          message: scopeResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Bugfix scope gate error (fail-open): ${err.message}`);
    }
  }

  // Strike gate
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') {
    try {
      const strikeResult = deps.checkStrikeGate(toolName, config);
      if (strikeResult.blocked) {
        return {
          allowed: false,
          blocked: true,
          reason: `Strike gate: ${strikeResult.reason}`,
          message: strikeResult.message,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Strike gate error (fail-open): ${err.message}`);
    }
  }

  // Strict adherence (Bash)
  if (toolName === 'Bash') {
    const command = toolInput.command;
    if (command) {
      const strictAdherence = deps.getStrictAdherence();
      if (strictAdherence.isEnabled()) {
        const cmdResult = strictAdherence.validateCommand(command);
        if (cmdResult.blocked) {
          return {
            allowed: false,
            blocked: true,
            reason: `Strict adherence: ${cmdResult.reason}`,
            message: cmdResult.autoCorrect
              ? `⚠️ BLOCKED: ${cmdResult.reason}\n\n✅ Auto-correcting to: ${cmdResult.autoCorrect}`
              : `⚠️ BLOCKED: ${cmdResult.reason}\n\n💡 ${cmdResult.suggestion || 'Please use the correct pattern.'}`,
          };
        }
      }
    }
  }

  // Damage control (Bash)
  if (toolName === 'Bash' && toolInput.command && config?.damageControl?.enabled) {
    try {
      const dc = require('../../flow-damage-control');
      const dcResult = dc.checkBashEvent(toolInput.command);
      if (dcResult && dcResult.action === 'block') {
        return {
          allowed: false,
          blocked: true,
          reason: `Damage control: ${dcResult.reason || dcResult.message || 'blocked by rule'}`,
          message: `\u26d4 BLOCKED by damage control: ${dcResult.message || dcResult.reason || 'This command matches a blocked pattern.'}\n\nRule: ${dcResult.rule || 'unknown'}`,
        };
      }
      if (dcResult && dcResult.action === 'ask') {
        return {
          allowed: true,
          blocked: false,
          reason: `Damage control warning: ${dcResult.reason || dcResult.message || 'requires confirmation'}`,
          message: `\u26a0\ufe0f Damage control: ${dcResult.message || dcResult.reason || 'This command matches an ask-before-execute pattern.'}`,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Damage control error (fail-open): ${err.message}`);
    }
  }

  // Damage control (file ops)
  if ((toolName === 'Edit' || toolName === 'Write') && filePath && config?.damageControl?.enabled && config?.damageControl?.events?.file) {
    try {
      const dc = require('../../flow-damage-control');
      const dcResult = dc.checkFileEvent(filePath, toolName.toLowerCase());
      if (dcResult && dcResult.action === 'block') {
        return {
          allowed: false,
          blocked: true,
          reason: `Damage control: ${dcResult.reason || 'file access blocked'}`,
          message: `\u26d4 BLOCKED by damage control: ${dcResult.message || 'This file is protected.'}`,
        };
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Damage control file check error (fail-open): ${err.message}`);
    }
  }

  // Component reuse (Write only)
  if (toolName === 'Write' && filePath) {
    const componentResult = deps.checkComponentReuse({ filePath, content: toolInput.content }, config);

    if (componentResult.blocked || componentResult.warning) {
      coreResult = {
        ...coreResult,
        ...componentResult,
        allowed: !componentResult.blocked,
        blocked: componentResult.blocked,
      };
    }

    // Strict adherence — file naming
    if (!coreResult.blocked) {
      const strictAdherence = deps.getStrictAdherence();
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
            message: `⚠️ BLOCKED: ${fileResult.reason}\n\n💡 ${fileResult.suggestion || 'Please use the correct naming convention.'}`,
          };
        }
      }
    }
  }

  return coreResult;
}

module.exports = {
  runPreToolGates,
};
