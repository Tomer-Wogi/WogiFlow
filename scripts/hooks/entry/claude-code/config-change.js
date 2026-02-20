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

async function main() {
  try {
    // Read input from stdin
    let input = '';
    const chunks = [];
    const MAX_INPUT_SIZE = 100 * 1024; // 100KB limit

    for await (const chunk of process.stdin) {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > MAX_INPUT_SIZE) break;
    }
    input = Buffer.concat(chunks).toString('utf-8').trim();

    let parsed = {};
    if (input) {
      try {
        parsed = JSON.parse(input);
      } catch {
        parsed = {};
      }
    }

    // Extract the changed file path from the hook input
    const filePath = parsed.file_path || parsed.filePath || '';
    const projectRoot = parsed.cwd || process.cwd();

    // Handle the config change
    const result = handleConfigChange({ filePath, projectRoot });

    // Transform to Claude Code format - always continue, never block
    const output = {
      continue: true,
      ...(result.message && { systemMessage: result.message })
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on config change errors
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
