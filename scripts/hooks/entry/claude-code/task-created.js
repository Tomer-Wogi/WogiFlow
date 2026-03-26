#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code TaskCreated Hook
 *
 * Called when a native task is created via TaskCreate (Claude Code 2.1.84+).
 * Links native tasks to the active WogiFlow task for tracking.
 */

const { handleTaskCreated } = require('../../core/task-created');
const { runHook } = require('../shared/hook-runner');

runHook('TaskCreated', async ({ parsedInput }) => {
  return await handleTaskCreated(parsedInput);
}, { failMode: 'silent' });
