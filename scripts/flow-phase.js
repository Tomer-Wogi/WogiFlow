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
  if (!isPhaseGateEnabled()) {
    process.exit(0); // Silent no-op when disabled
  }
  const success = transitionPhase(from, to, taskId || null);
  if (success) {
    console.log(`Phase: ${from} → ${to}`);
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
