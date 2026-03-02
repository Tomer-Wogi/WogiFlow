#!/usr/bin/env node

/**
 * Wogi Flow - Proactive Compaction Manager
 *
 * Triggers context compaction proactively at phase boundaries,
 * before Claude's auto-compact fires (which causes context loss).
 *
 * Two-pronged approach:
 * A) Race: Compact at ~75% context, before Claude's ~95% auto-compact
 * B) Persist: Save full task state so auto-compact recovery is lossless
 *
 * Part of S1: Smart Context Compaction
 */

const {
  getConfig
} = require('./flow-utils');
const { saveCheckpoint, loadCheckpoint, formatCheckpointSummary } = require('./flow-task-checkpoint');
const { getSmartCompactionConfig } = require('./flow-context-estimator');

// ============================================================
// Configuration
// ============================================================

/**
 * Default proactive compaction config
 */
const DEFAULT_PROACTIVE_CONFIG = {
  enabled: true,
  triggerThreshold: 0.75,   // Compact at 75% context usage
  useHaiku: true,           // Use Haiku for compaction summaries when available
  phases: [                 // Which phase boundaries trigger compaction check
    'exploring',            // After explore phase completes
    'spec_review',          // After spec is generated
    'scenario',             // After each scenario implementation
    'criteria_check',       // After criteria completion check
    'validating'            // Before final validation
  ]
};

/**
 * Get proactive compaction config from config.json
 * Merges with smartCompaction config for threshold awareness.
 *
 * @returns {Object} Combined compaction configuration
 */
function getProactiveCompactionConfig() {
  const config = getConfig();
  const smartConfig = getSmartCompactionConfig();
  const proactiveConfig = config.proactiveCompaction || {};

  return {
    enabled: proactiveConfig.enabled !== false && smartConfig.enabled,
    triggerThreshold: proactiveConfig.triggerThreshold || DEFAULT_PROACTIVE_CONFIG.triggerThreshold,
    useHaiku: proactiveConfig.useHaiku !== false,
    phases: proactiveConfig.phases || DEFAULT_PROACTIVE_CONFIG.phases,
    safeThreshold: smartConfig.safeThreshold,
    emergencyThreshold: smartConfig.emergencyThreshold
  };
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Check whether proactive compaction should trigger at a phase boundary.
 *
 * This is called by /wogi-start at each phase transition.
 * The actual compaction is performed by the AI agent using /wogi-compact.
 *
 * @param {Object} params - Check parameters
 * @param {string} params.phase - The phase that just completed
 * @param {number} params.contextPercent - Current context usage (0.0-1.0)
 * @param {string} params.taskId - Current task ID
 * @param {string} [params.taskTitle] - Task title for checkpoint
 * @returns {{ shouldCompact: boolean, reason: string, checkpoint: Object|null }}
 */
function shouldCompactAtPhase(params) {
  const { phase, contextPercent, taskId } = params;
  const config = getProactiveCompactionConfig();

  // Disabled — skip
  if (!config.enabled) {
    return { shouldCompact: false, reason: 'proactive compaction disabled', checkpoint: null };
  }

  // Phase not in the trigger list — skip
  if (!config.phases.includes(phase)) {
    return { shouldCompact: false, reason: `phase '${phase}' not in trigger list`, checkpoint: null };
  }

  // Emergency threshold always triggers
  if (contextPercent >= config.emergencyThreshold) {
    return {
      shouldCompact: true,
      reason: `emergency: context at ${Math.round(contextPercent * 100)}% (>=${Math.round(config.emergencyThreshold * 100)}%)`,
      checkpoint: loadCheckpoint()
    };
  }

  // Proactive threshold
  if (contextPercent >= config.triggerThreshold) {
    return {
      shouldCompact: true,
      reason: `proactive: context at ${Math.round(contextPercent * 100)}% (>=${Math.round(config.triggerThreshold * 100)}%)`,
      checkpoint: loadCheckpoint()
    };
  }

  return {
    shouldCompact: false,
    reason: `context at ${Math.round(contextPercent * 100)}% (threshold: ${Math.round(config.triggerThreshold * 100)}%)`,
    checkpoint: null
  };
}

/**
 * Save a checkpoint and check if compaction is needed.
 * This is the main entry point called at each phase boundary.
 *
 * @param {Object} params - Phase boundary parameters
 * @param {string} params.taskId - Task ID
 * @param {string} params.taskTitle - Task title
 * @param {string} params.completedPhase - Phase that just completed
 * @param {number} params.contextPercent - Current context usage (0.0-1.0)
 * @param {Object} [params.checkpointData] - Additional checkpoint data (scenarios, files, etc.)
 * @returns {Promise<{ checkpointSaved: boolean, compactionNeeded: boolean, reason: string, summary: string|null }>}
 */
async function handlePhaseBoundary(params) {
  const { taskId, taskTitle, completedPhase, contextPercent, checkpointData = {} } = params;

  // Always save checkpoint at phase boundaries (Approach B: Persist)
  const checkpointSaved = await saveCheckpoint({
    taskId,
    taskTitle,
    currentPhase: completedPhase,
    ...checkpointData
  });

  // Check if compaction is needed (Approach A: Race)
  const compactionCheck = shouldCompactAtPhase({
    phase: completedPhase,
    contextPercent,
    taskId
  });

  let summary = null;
  if (compactionCheck.shouldCompact && compactionCheck.checkpoint) {
    summary = formatCheckpointSummary(compactionCheck.checkpoint);
  }

  return {
    checkpointSaved,
    compactionNeeded: compactionCheck.shouldCompact,
    reason: compactionCheck.reason,
    summary
  };
}

/**
 * Generate a compaction summary for the current task state.
 * Used by /wogi-compact when proactive compaction triggers.
 *
 * @param {Object} checkpoint - Current checkpoint data
 * @returns {string} Formatted compaction summary
 */
function generateCompactionContext(checkpoint) {
  if (!checkpoint) return '';

  const lines = [];
  lines.push('## Task Checkpoint (Preserved for Recovery)');
  lines.push('');
  lines.push(`**Task**: ${checkpoint.taskId} — ${checkpoint.taskTitle || 'Untitled'}`);
  lines.push(`**Phase**: ${checkpoint.currentPhase}`);
  lines.push(`**Last Updated**: ${checkpoint.lastUpdated}`);

  if (checkpoint.specPath) {
    lines.push(`**Spec**: ${checkpoint.specPath}`);
  }

  const { scenarios } = checkpoint;
  if (scenarios && scenarios.total > 0) {
    lines.push('');
    lines.push(`**Scenarios**: ${scenarios.completed.length}/${scenarios.total} completed`);

    if (scenarios.completed.length > 0) {
      lines.push('Completed:');
      for (const s of scenarios.completed) {
        lines.push(`  - [${s.passed ? 'PASS' : 'FAIL'}] ${s.title || `Scenario #${s.index}`}`);
      }
    }

    if (scenarios.pending.length > 0) {
      lines.push('Pending:');
      for (const s of scenarios.pending) {
        lines.push(`  - ${s.title || `Scenario #${s.index}`}`);
      }
    }
  }

  if (checkpoint.changedFiles.length > 0) {
    lines.push('');
    lines.push(`**Changed Files** (${checkpoint.changedFiles.length}):`);
    for (const f of checkpoint.changedFiles) {
      lines.push(`  - ${f}`);
    }
  }

  if (checkpoint.verificationResults.length > 0) {
    lines.push('');
    lines.push('**Verification Results**:');
    for (const v of checkpoint.verificationResults) {
      const status = v.passed ? 'PASS' : 'FAIL';
      lines.push(`  - [${status}] ${v.command || v.name || 'Unknown'}`);
    }
  }

  if (checkpoint.explorationSummary) {
    lines.push('');
    lines.push('**Exploration Summary**:');
    lines.push(checkpoint.explorationSummary);
  }

  if (checkpoint.completedPhases.length > 0) {
    lines.push('');
    lines.push(`**Completed Phases**: ${checkpoint.completedPhases.join(' → ')}`);
  }

  lines.push('');
  lines.push('**ON RESUME**: Read this checkpoint and continue from the next pending scenario.');
  lines.push('Check `.workflow/state/task-checkpoint.json` for machine-readable state.');

  return lines.join('\n');
}

/**
 * Format a proactive compaction message for display.
 *
 * @param {Object} result - Result from handlePhaseBoundary
 * @param {number} contextPercent - Current context percentage
 * @returns {string} Formatted message
 */
function formatCompactionMessage(result, contextPercent) {
  const pct = Math.round(contextPercent * 100);

  if (!result.compactionNeeded) {
    return `Checkpoint saved. Context at ${pct}% — no compaction needed.`;
  }

  const lines = [];
  lines.push(`Context at ${pct}%. Compacting before next phase...`);
  lines.push(`Reason: ${result.reason}`);
  lines.push('');
  lines.push('Task state has been checkpointed. Run /wogi-compact to compact now.');
  lines.push('After compaction, read task-checkpoint.json to restore context.');

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'check': {
      const phase = args[0];
      const contextPctStr = args[1];
      const taskId = args[2];

      if (!phase || !contextPctStr || !taskId) {
        console.error('Usage: flow-proactive-compact.js check <phase> <contextPercent> <taskId>');
        process.exit(1);
      }

      const contextPercent = parseFloat(contextPctStr);
      if (isNaN(contextPercent) || contextPercent < 0 || contextPercent > 1) {
        console.error('contextPercent must be between 0.0 and 1.0');
        process.exit(1);
      }

      const result = shouldCompactAtPhase({ phase, contextPercent, taskId });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'config': {
      const config = getProactiveCompactionConfig();
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case 'context': {
      const checkpoint = loadCheckpoint();
      if (checkpoint) {
        console.log(generateCompactionContext(checkpoint));
      } else {
        console.log('No checkpoint found.');
      }
      break;
    }

    default:
      console.log(`
Proactive Compaction Manager

Usage: flow-proactive-compact.js <command> [args]

Commands:
  check <phase> <contextPct> <taskId>  Check if compaction needed
  config                               Show current configuration
  context                              Generate compaction context from checkpoint

Examples:
  flow-proactive-compact.js check exploring 0.78 wf-a1b2c3d4
  flow-proactive-compact.js config
  flow-proactive-compact.js context
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getProactiveCompactionConfig,
  shouldCompactAtPhase,
  handlePhaseBoundary,
  generateCompactionContext,
  formatCompactionMessage
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
