#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PostCompact Hook
 *
 * Called after context compaction completes (Claude Code 2.1.76+).
 * Re-injects critical state: active task, durable session progress,
 * workflow phase, and routing enforcement.
 *
 * This hook is non-blocking (never rejects).
 */

const { handlePostCompact } = require('../../core/post-compact');
const { runHook } = require('../shared/hook-runner');

runHook('PostCompact', async () => {
  return handlePostCompact();
}, { failMode: 'warn', useStdoutWrite: true });
