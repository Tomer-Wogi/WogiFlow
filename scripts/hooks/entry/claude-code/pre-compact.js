#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PreCompact Hook
 *
 * Called BEFORE context compaction (Claude Code 2.1.105+).
 * Saves critical state and optionally blocks compaction during critical phases.
 *
 * This hook can block compaction by exiting with code 2 or returning
 * { decision: "block" }. It blocks during atomic workflow phases
 * (validating, completing, wiring_check, standards_check) where
 * interruption would leave state inconsistent.
 */

const { handlePreCompact } = require('../../core/pre-compact');
const { runHook } = require('../shared/hook-runner');

runHook('PreCompact', async () => {
  const result = handlePreCompact();

  // Claude Code 2.1.105+: return { decision: "block" } to prevent compaction
  if (result.decision === 'block') {
    return {
      __raw: true,
      decision: 'block',
      reason: result.reason
    };
  }

  return result;
}, { failMode: 'warn', useStdoutWrite: true });
