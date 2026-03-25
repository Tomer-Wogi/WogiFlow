#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code TaskCompleted Hook
 *
 * Called when a sub-agent task completes (Claude Code 2.1.33+).
 * Moves completed tasks in ready.json and logs completion.
 */

const { handleTaskCompleted } = require('../../core/task-completed');
const { runHook } = require('../shared/hook-runner');

runHook('TaskCompleted', async ({ parsedInput }) => {
  return await handleTaskCompleted(parsedInput);
}, { failMode: 'silent' });
