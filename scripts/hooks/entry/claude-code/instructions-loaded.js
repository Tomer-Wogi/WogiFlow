#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code InstructionsLoaded Hook
 *
 * Called when CLAUDE.md or .claude/rules/*.md files are loaded into context.
 *
 * Responsibilities:
 * 1. Package-check: detect new dependencies, suggest /wogi-rescan
 * 2. Rule conflict detection: find contradictions between rules
 * 3. Auto-onboard: detect missing .workflow/state/, ask if setup should run
 *
 * This hook is non-blocking (never rejects).
 */

const { handleInstructionsLoaded } = require('../../core/instructions-loaded');
const { runHook } = require('../shared/hook-runner');

runHook('InstructionsLoaded', async ({ parsedInput }) => {
  const projectRoot = parsedInput.cwd || process.cwd();
  return handleInstructionsLoaded({ projectRoot });
}, { failMode: 'silent', useStdoutWrite: true });
