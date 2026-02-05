#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PostToolUse Hook
 *
 * Called after tool execution.
 * - Captures observations for ALL tools (automatic memory)
 * - Runs validation (lint, typecheck) for Edit/Write only
 */

const { runValidation } = require('../../core/validation');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { captureObservation } = require('../../core/observation-capture');

async function main() {
  const startTime = Date.now();

  try {
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? JSON.parse(inputData) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    const toolName = parsedInput.toolName;
    const toolInput = parsedInput.toolInput || {};
    const toolResponse = parsedInput.toolResponse;
    const filePath = toolInput.file_path;

    // CAPTURE OBSERVATION FOR ALL TOOLS (non-blocking)
    // This runs before validation so we capture even if validation fails
    try {
      await captureObservation({
        sessionId: parsedInput.sessionId,
        toolName,
        toolInput,
        toolResponse,
        duration: Date.now() - startTime
      });
    } catch (err) {
      // Non-blocking - observation capture should never fail the hook
      if (process.env.DEBUG) {
        console.error(`[observation-capture] ${err.message}`);
      }
    }

    // Only run validation for Edit/Write
    if (toolName !== 'Edit' && toolName !== 'Write') {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
      return;
    }

    // Skip if tool failed
    if (toolResponse && toolResponse.error) {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
      return;
    }

    // Run validation
    const coreResult = await runValidation({
      filePath,
      timeout: 30000
    });

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('PostToolUse', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
