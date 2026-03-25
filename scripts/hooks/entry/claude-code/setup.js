#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Setup Hook
 *
 * Called when Claude Code is started with --init, --init-only, or --maintenance flags.
 * Triggers project setup or maintenance operations.
 *
 * Claude Code 2.1.10+ feature.
 */

const { handleSetup, handleMaintenance } = require('../../core/setup-handler');
const { runHook } = require('../shared/hook-runner');

runHook('Setup', async ({ parsedInput }) => {
  const trigger = parsedInput.source || 'init';
  const isMaintenance = trigger === 'maintenance' || trigger === '--maintenance';

  if (isMaintenance) {
    return handleMaintenance({ cwd: parsedInput.cwd });
  }
  return handleSetup({ trigger, cwd: parsedInput.cwd });
}, { failMode: 'silent' });
