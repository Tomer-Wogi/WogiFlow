#!/usr/bin/env node

/**
 * Wogi Flow - Phase Gate (Core Module)
 *
 * Lightweight state machine for workflow phase enforcement.
 * Tracks current phase and restricts tool access per phase.
 *
 * Phases: idle → routing → exploring → spec_review → coding → validating → completing → idle
 *
 * State file: .workflow/state/workflow-phase.json
 * Fail-open: If state file is missing/corrupt, skip phase check (existing gates still enforce).
 */

const path = require('path');
const fs = require('fs');
const { getConfig, PATHS, safeJsonParse } = require('../../flow-utils');

const PHASE_FILE = path.join(PATHS.state, 'workflow-phase.json');

// 2 hours in milliseconds
const STALE_PHASE_TTL_MS = 2 * 60 * 60 * 1000;

// Valid phases
const PHASES = ['idle', 'routing', 'exploring', 'spec_review', 'coding', 'validating', 'completing'];

// Valid transitions: from → [allowed to states]
const VALID_TRANSITIONS = {
  idle: ['routing'],
  routing: ['idle', 'exploring', 'coding'],
  exploring: ['spec_review', 'coding'],
  spec_review: ['coding'],
  coding: ['validating'],
  validating: ['coding', 'completing'],
  completing: ['idle']
};

// Tool permissions per phase
// Tools not listed are allowed by default (Read, Glob, Grep always allowed)
const PHASE_TOOL_PERMISSIONS = {
  idle: {
    blocked: [] // No restrictions in idle — routing gate handles enforcement here
  },
  routing: {
    blocked: ['Edit', 'Write', 'Bash']
  },
  exploring: {
    blocked: ['Edit', 'Write']
  },
  spec_review: {
    blocked: ['Edit', 'Write', 'Bash']
  },
  coding: {
    blocked: [] // All tools allowed
  },
  validating: {
    blocked: ['Edit', 'Write']
  },
  completing: {
    blocked: [] // All tools allowed for logs/maps/commit
  }
};

// Read-only bash commands allowed in idle/exploring phases
const READONLY_BASH_PATTERNS = [
  /^git\s+(status|log|diff|show|branch|remote|tag)/,
  /^ls\b/,
  /^cat\b/,
  /^node\s+--check\b/,
  /^npm\s+(run\s+)?(lint|typecheck|test)/,
  /^npx\s+(tsc|eslint)/
];

// Shell operators that indicate command chaining (security: reject compound commands)
const SHELL_OPERATOR_PATTERN = /[;|&`$()]/;

/**
 * Check if phase gating is enabled
 */
function isPhaseGateEnabled() {
  try {
    const config = getConfig();
    return config.hooks?.rules?.phaseGate?.enabled === true;
  } catch (err) {
    return false; // Fail-open
  }
}

/**
 * Read current phase from state file
 * @returns {{ phase: string, taskId: string|null, updatedAt: string, previousPhase: string|null }}
 */
function getCurrentPhase() {
  const defaults = { phase: 'idle', taskId: null, updatedAt: null, previousPhase: null };
  try {
    const data = safeJsonParse(PHASE_FILE, null);
    if (!data || !data.phase || !PHASES.includes(data.phase)) {
      return defaults;
    }
    return {
      phase: data.phase,
      taskId: data.taskId || null,
      updatedAt: data.updatedAt || null,
      previousPhase: data.previousPhase || null
    };
  } catch (err) {
    return defaults;
  }
}

/**
 * Write phase state to file
 */
function writePhaseState(state) {
  try {
    const dir = path.dirname(PHASE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PHASE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[phase-gate] Failed to write phase state: ${err.message}`);
    }
    return false;
  }
}

/**
 * Transition from one phase to another
 * @param {string} from - Expected current phase
 * @param {string} to - Target phase
 * @param {string|null} taskId - Task ID (optional)
 * @returns {boolean} Whether transition succeeded
 */
function transitionPhase(from, to, taskId) {
  if (!PHASES.includes(from) || !PHASES.includes(to)) {
    if (process.env.DEBUG) {
      console.error(`[phase-gate] Invalid phase: ${from} → ${to}`);
    }
    return false;
  }

  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    if (process.env.DEBUG) {
      console.error(`[phase-gate] Invalid transition: ${from} → ${to}`);
    }
    return false;
  }

  const current = getCurrentPhase();
  if (current.phase !== from) {
    if (process.env.DEBUG) {
      console.error(`[phase-gate] Current phase is ${current.phase}, expected ${from}`);
    }
    return false;
  }

  return writePhaseState({
    phase: to,
    taskId: taskId || current.taskId,
    updatedAt: new Date().toISOString(),
    previousPhase: from
  });
}

/**
 * Check if a tool is allowed in the current phase
 * @param {string} toolName - Tool name (Edit, Write, Bash, etc.)
 * @param {string} phase - Current phase
 * @param {string} [bashCommand] - Bash command (for read-only check)
 * @returns {boolean}
 */
function isToolAllowedInPhase(toolName, phase, bashCommand) {
  const permissions = PHASE_TOOL_PERMISSIONS[phase];
  if (!permissions) return true; // Unknown phase → allow

  // Always allow these tools regardless of phase
  if (['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'AskUserQuestion'].includes(toolName)) {
    return true;
  }

  // Skill tool is always allowed (needed for /wogi-* routing)
  if (toolName === 'Skill') return true;

  // Check blocked list
  if (permissions.blocked && permissions.blocked.includes(toolName)) {
    return false;
  }

  // Special bash handling for phases with bashRestricted
  if (toolName === 'Bash' && permissions.bashRestricted && bashCommand) {
    const trimmed = bashCommand.trim();
    // Reject commands containing shell operators (prevents chaining like `git status && rm -rf /`)
    if (SHELL_OPERATOR_PATTERN.test(trimmed)) {
      return false;
    }
    return READONLY_BASH_PATTERNS.some(pattern => pattern.test(trimmed));
  }

  return true;
}

// Paths exempt from phase gating (workflow state files must always be writable)
const PHASE_EXEMPT_PATHS = [
  '.workflow/state/',
  '.workflow/changes/',
  '.workflow/specs/',
  '.workflow/plans/',
  '.workflow/verifications/',
  '.workflow/reviews/',
  '.claude/plans/'
];

/**
 * Check if a file path is exempt from phase gating
 * @param {string} filePath - Absolute or relative file path
 * @returns {boolean}
 */
function isPhaseExemptPath(filePath) {
  if (!filePath) return false;
  return PHASE_EXEMPT_PATHS.some(exempt => filePath.includes(exempt));
}

/**
 * Main phase gate check - called from PreToolUse
 * @param {string} toolName - Tool being used
 * @param {Object} [toolInput] - Tool input (for bash command extraction)
 * @returns {{ allowed: boolean, blocked: boolean, reason: string, message: string|null }}
 */
function checkPhaseGate(toolName, toolInput) {
  // Fail-open if disabled
  if (!isPhaseGateEnabled()) {
    return { allowed: true, blocked: false, reason: 'phase_gating_disabled', message: null };
  }

  // Exempt workflow state/spec/plan files from Edit/Write blocking
  if ((toolName === 'Edit' || toolName === 'Write') && toolInput) {
    const filePath = toolInput.file_path || '';
    if (isPhaseExemptPath(filePath)) {
      return { allowed: true, blocked: false, reason: 'phase_exempt_path', message: null };
    }
  }

  const current = getCurrentPhase();

  // Check stale phase (auto-expire after 2 hours)
  if (current.updatedAt) {
    const age = Date.now() - new Date(current.updatedAt).getTime();
    if (age > STALE_PHASE_TTL_MS) {
      resetPhase();
      return { allowed: true, blocked: false, reason: 'phase_expired_reset', message: null };
    }
  }

  const bashCommand = toolInput?.command || '';
  const allowed = isToolAllowedInPhase(toolName, current.phase, bashCommand);

  if (allowed) {
    return { allowed: true, blocked: false, reason: 'phase_allows', message: null };
  }

  // Build deny message
  const phaseLabel = current.phase.replace('_', ' ');
  const taskInfo = current.taskId ? ` (task: ${current.taskId})` : '';
  const message = `Phase gate: "${phaseLabel}" phase is active${taskInfo}. ` +
    `${toolName} is not allowed in this phase. ` +
    getPhaseGuidance(current.phase, toolName);

  return {
    allowed: false,
    blocked: true,
    reason: 'phase_restricts_tool',
    message
  };
}

/**
 * Get guidance text for a blocked tool in a phase
 */
function getPhaseGuidance(phase, toolName) {
  const guidance = {
    idle: 'Route your request through a /wogi-* command first.',
    routing: 'Wait for /wogi-start to finish routing.',
    exploring: 'Research phase is active. Use only read-only tools. Do NOT edit files.',
    spec_review: 'Spec is under review. Wait for user approval before editing.',
    validating: 'Validation phase active. Fix issues in code, do not add new features.',
    completing: ''
  };
  return guidance[phase] || '';
}

/**
 * Reset phase to idle
 */
function resetPhase() {
  return writePhaseState({
    phase: 'idle',
    taskId: null,
    updatedAt: new Date().toISOString(),
    previousPhase: null
  });
}

/**
 * Get phase-specific context prompt for UserPromptSubmit injection
 * @returns {{ inject: boolean, prompt: string|null }}
 */
function getPhaseContextPrompt() {
  if (!isPhaseGateEnabled()) {
    return { inject: false, prompt: null };
  }

  const current = getCurrentPhase();
  const taskInfo = current.taskId || 'unknown';

  const prompts = {
    idle: 'Route this request through a /wogi-* command before taking any action.',
    routing: null, // /wogi-start handles this
    exploring: `Research phase active for ${taskInfo}. Use only read-only tools. Do NOT edit files.`,
    spec_review: `Spec generated for ${taskInfo}. Wait for user approval before implementing.`,
    coding: `Implementing ${taskInfo}. Follow acceptance criteria. Run verification after each edit.`,
    validating: `Validation phase for ${taskInfo}. Run lint, typecheck, tests. Fix issues, do not add new features.`,
    completing: `Completing ${taskInfo}. Update request-log, maps, and commit.`
  };

  const prompt = prompts[current.phase];
  if (!prompt) {
    return { inject: false, prompt: null };
  }

  return { inject: true, prompt };
}

/**
 * Check and reset stale phase on session start
 * @returns {boolean} Whether phase was reset
 */
function checkAndResetStalePhase() {
  try {
    const current = getCurrentPhase();
    if (current.phase === 'idle' || !current.updatedAt) {
      return false;
    }
    const age = Date.now() - new Date(current.updatedAt).getTime();
    if (age > STALE_PHASE_TTL_MS) {
      resetPhase();
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getCurrentPhase,
  transitionPhase,
  isToolAllowedInPhase,
  checkPhaseGate,
  resetPhase,
  getPhaseContextPrompt,
  checkAndResetStalePhase,
  isPhaseGateEnabled,
  PHASES,
  VALID_TRANSITIONS
};
