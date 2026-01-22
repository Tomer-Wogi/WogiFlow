#!/usr/bin/env node

/**
 * Wogi Flow - Core Hooks Index
 *
 * Exports all core hook modules for easy importing.
 */

const taskGate = require('./task-gate');
const scopeGate = require('./scope-gate');
const validation = require('./validation');
const loopCheck = require('./loop-check');
const componentCheck = require('./component-check');
const sessionContext = require('./session-context');
const setupCheck = require('./setup-check');
const setupHandler = require('./setup-handler');
const implementationGate = require('./implementation-gate');
const todoWriteGate = require('./todowrite-gate');

module.exports = {
  // Task Gating
  ...taskGate,
  taskGate,

  // Scope Gating (v4.0 - validates edits are within task scope)
  ...scopeGate,
  scopeGate,

  // Validation
  ...validation,
  validation,

  // Loop Check
  ...loopCheck,
  loopCheck,

  // Component Check
  ...componentCheck,
  componentCheck,

  // Session Context
  ...sessionContext,
  sessionContext,

  // Setup Check
  ...setupCheck,
  setupCheck,

  // Setup Handler (Claude Code 2.1.10+)
  ...setupHandler,
  setupHandler,

  // Implementation Gate (blocks implementation requests without active task)
  ...implementationGate,
  implementationGate,

  // TodoWrite Gate (blocks implementation todos without active task)
  ...todoWriteGate,
  todoWriteGate
};
