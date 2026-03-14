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
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { readHookInput } = require('../shared/read-stdin');

process.stdin.setEncoding('utf8');

async function main() {
  try {
    // Consume stdin (required by hook protocol, even if we don't use the input)
    await readHookInput();

    // Handle post-compaction state recovery
    const result = handlePostCompact();

    // Transform to Claude Code format via adapter
    const output = claudeCodeAdapter.transformResult('PostCompact', result);

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on post-compact errors — fail open
    try {
      const { logHookError } = require('../../../flow-hook-errors');
      logHookError('PostCompact', err, { failMode: 'open', operation: 'post-compaction-recovery' });
    } catch (logErr) {
      console.error(`[WogiFlow] PostCompact hook error: ${err.message}`);
    }
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
