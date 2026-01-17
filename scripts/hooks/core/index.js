#!/usr/bin/env node

/**
 * Wogi Flow - Core Hooks Index
 *
 * Exports all core hook modules for easy importing.
 */

const taskGate = require('./task-gate');
const validation = require('./validation');
const loopCheck = require('./loop-check');
const componentCheck = require('./component-check');
const sessionContext = require('./session-context');
const setupCheck = require('./setup-check');
const setupHandler = require('./setup-handler');

module.exports = {
  // Task Gating
  ...taskGate,
  taskGate,

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
  setupHandler
};
