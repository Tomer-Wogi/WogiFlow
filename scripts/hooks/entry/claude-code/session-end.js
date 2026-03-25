#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionEnd Hook
 *
 * Called when a Claude Code session ends.
 * Auto-logs to request-log.md and warns about uncommitted work.
 */

const { handleSessionEnd } = require('../../core/session-end');
const { runHook } = require('../shared/hook-runner');

runHook('SessionEnd', async ({ parsedInput }) => {
  return handleSessionEnd(parsedInput);
}, { failMode: 'silent' });
