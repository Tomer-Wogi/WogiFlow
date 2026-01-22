#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code UserPromptSubmit Hook
 *
 * Called when user submits a prompt (before processing).
 * Enforces implementation gate - blocks implementation requests without active task.
 */

const { checkImplementationGate } = require('../../core/implementation-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending } = require('../../../flow-durable-session');

// Maximum stdin size to prevent DoS (100KB should be more than enough for prompts)
const MAX_STDIN_SIZE = 100 * 1024;

async function main() {
  try {
    // Read input from stdin with size limit
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) {
        // Truncate at limit to prevent memory exhaustion
        inputData += chunk.slice(0, MAX_STDIN_SIZE - (totalSize - chunk.length));
        break;
      }
      inputData += chunk;
    }

    // Handle empty input gracefully
    if (!inputData || inputData.trim().length === 0) {
      console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
      process.exit(0);
      return;
    }

    // Parse JSON safely
    let input;
    try {
      input = JSON.parse(inputData);
    } catch (_parseErr) {
      // Invalid JSON - allow through (graceful degradation)
      console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
      process.exit(0);
      return;
    }

    const parsedInput = claudeCodeAdapter.parseInput(input);

    const prompt = parsedInput.prompt;
    const source = parsedInput.source;

    // v4.1: Detect skill commands that need execution tracking
    // This prevents premature exit when /wogi-bulk or /wogi-start is entered
    if (typeof prompt === 'string') {
      const skillMatch = prompt.match(/^\/(wogi-bulk|wogi-start)\b/i);
      if (skillMatch) {
        const skillName = skillMatch[1].toLowerCase();
        markSkillPending(skillName, { prompt });
        if (process.env.DEBUG) {
          console.error(`[Hook] Marked /${skillName} as pending execution`);
        }
      }
    }

    // Check implementation gate
    const coreResult = checkImplementationGate({
      prompt,
      source
    });

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('UserPromptSubmit', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - allow prompt to continue (graceful degradation)
    // Log generic message to avoid leaking sensitive path information
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    } else {
      console.error('[Wogi Flow Hook] Validation error occurred');
    }
    // Exit 0 with continue:true to not block on hook errors
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit'
      }
    }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
