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
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { safeJsonParseString } = require('../../../flow-utils');

process.stdin.setEncoding('utf8');

async function main() {
  try {
    // Read input from stdin (consistent pattern with other entry hooks)
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? safeJsonParseString(inputData, {}) : {};

    // Extract the changed file path from the hook input
    const filePath = input.file_path || input.filePath || '';
    const projectRoot = input.cwd || process.cwd();

    // Handle the config change
    const result = handleConfigChange({ filePath, projectRoot });

    // Transform to Claude Code format via adapter (consistent with other hooks)
    const output = claudeCodeAdapter.transformResult('ConfigChange', result);

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on config change errors
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
