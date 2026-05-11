#!/usr/bin/env node

/**
 * Wogi Flow - Phase Gate CLI
 *
 * Lightweight CLI for workflow phase transitions.
 * Used by /wogi-start to update phase state at execution milestones.
 *
 * Usage:
 *   node scripts/flow-phase.js transition <from> <to> [taskId]
 *   node scripts/flow-phase.js status
 *   node scripts/flow-phase.js reset
 */

const { transitionPhase, getCurrentPhase, resetPhase, isPhaseGateEnabled } = require('./hooks/core/phase-gate');

const [command, ...args] = process.argv.slice(2);

if (command === 'transition') {
  const [from, to, taskId] = args;
  if (!from || !to) {
    console.error('Usage: flow-phase.js transition <from> <to> [taskId]');
    process.exit(1);
  }
  // wf-88a08fd4: previously this exited silently when `phaseGate.enabled` was
  // false, which is the default. The CLI is an explicit caller action — honor
  // it even when gate enforcement is off. State tracking (workflow-phase.json)
  // is independent of gate enforcement (blocking Edit/Write until phase file
  // is read). Callers that depend on phase state always need the write; the
  // gate flag only controls whether PreToolUse blocks tools.
  const gateActive = isPhaseGateEnabled();
  const success = transitionPhase(from, to, taskId || null);
  if (success) {
    const suffix = gateActive ? '' : ' (gate enforcement disabled — state updated only)';
    console.log(`Phase: ${from} → ${to}${suffix}`);
    // wf-8d635d0e / E1: fire background auto-review on coding → validating.
    // Fails open — any error here must not fail the primary transition.
    try {
      const { maybeStartAutoReview } = require('./hooks/core/phase-transition-auto-review');
      const result = maybeStartAutoReview(from, to, taskId || null);
      if (result.started && process.env.DEBUG) {
        console.error(`[auto-review] started pid=${result.handle?.pid} task=${taskId}`);
      }
    } catch (_err) { /* fail-open */ }
  } else {
    console.error(`Phase transition failed: ${from} → ${to}`);
    process.exit(1);
  }
} else if (command === 'status') {
  const phase = getCurrentPhase();
  console.log(JSON.stringify(phase, null, 2));
} else if (command === 'reset') {
  resetPhase();
  console.log('Phase reset to idle');
} else {
  console.error('Usage: flow-phase.js <transition|status|reset> [args]');
  process.exit(1);
}
