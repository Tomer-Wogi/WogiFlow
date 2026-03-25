#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code ConfigChange Hook
 *
 * Called when a configuration file changes during a session.
 * Re-syncs the bridge if .workflow/config.json changes,
 * ensuring CLAUDE.md stays current.
 *
 * This hook is non-blocking (never rejects).
 */

const { handleConfigChange } = require('../../core/config-change');
const { runHook } = require('../shared/hook-runner');

runHook('ConfigChange', async ({ input }) => {
  const filePath = input.file_path || input.filePath || '';
  const projectRoot = input.cwd || process.cwd();
  return handleConfigChange({ filePath, projectRoot });
}, { failMode: 'silent', useStdoutWrite: true });
