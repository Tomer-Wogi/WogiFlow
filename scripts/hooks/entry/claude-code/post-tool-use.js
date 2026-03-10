#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PostToolUse Hook
 *
 * Called after tool execution.
 * - Captures observations for ALL tools (automatic memory)
 * - Runs validation (lint, typecheck) for Edit/Write only
 * - Detects task entering inProgress via ready.json edit and initializes
 *   durable session, session state tracking, and memory blocks (v6.0)
 */

const { runValidation } = require('../../core/validation');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { captureObservation } = require('../../core/observation-capture');

function extractErrorMessage(toolResponse) {
  if (!toolResponse) return 'unknown error';
  if (typeof toolResponse === 'string') return toolResponse.slice(0, 500);
  if (toolResponse.error) {
    return typeof toolResponse.error === 'string'
      ? toolResponse.error.slice(0, 500)
      : JSON.stringify(toolResponse.error).slice(0, 500);
  }
  return 'tool execution failed';
}

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
    // Detect tool failure for rejected-approach tagging
    const toolFailed = !!(
      toolResponse?.error ||
      toolResponse?.isError ||
      (typeof toolResponse === 'string' && toolResponse.toLowerCase().startsWith('error:'))
    );

    try {
      await captureObservation({
        sessionId: parsedInput.sessionId,
        toolName,
        toolInput,
        toolResponse,
        duration: Date.now() - startTime,
        explorationStatus: toolFailed ? 'rejected' : undefined,
        rejectionReason: toolFailed ? extractErrorMessage(toolResponse) : undefined
      });
    } catch (err) {
      // Non-blocking - observation capture should never fail the hook
      if (process.env.DEBUG) {
        console.error(`[observation-capture] ${err.message}`);
      }
    }

    // v6.0: Detect task entering inProgress via ready.json edit
    // The /wogi-start skill (prompt-level) edits ready.json manually but never
    // calls flow-start.js, so durable session, session state, and memory blocks
    // are never initialized. This bridge detects the edit and initializes them.
    if ((toolName === 'Edit' || toolName === 'Write') && filePath && filePath.endsWith('ready.json') && !toolFailed) {
      try {
        const fs = require('fs');
        const { safeJsonParse } = require('../../../flow-utils');
        const readyData = safeJsonParse(filePath, null);
        if (readyData && Array.isArray(readyData.inProgress) && readyData.inProgress.length > 0) {
          const task = readyData.inProgress[0];
          const taskId = task && task.id;
          if (!taskId) throw new Error('inProgress entry missing id');
          const taskTitle = task.title || taskId;

          // Check if durable session already exists for this task
          const { loadDurableSession, createDurableSession } = require('../../../flow-durable-session');
          const existing = loadDurableSession();
          if (!existing || existing.taskId !== taskId) {
            // Initialize durable session
            const criteria = task.acceptanceCriteria || task.scenarios || [];
            const steps = Array.isArray(criteria) ? criteria : [];
            const sessionSteps = steps.length > 0 ? steps : [taskTitle];
            createDurableSession(taskId, 'task', sessionSteps);

            // Initialize session state tracking
            try {
              const { trackTaskStart } = require('../../../flow-session-state');
              trackTaskStart(taskId, taskTitle);
            } catch (err) {
              if (process.env.DEBUG) console.error(`[post-tool-use] trackTaskStart: ${err.message}`);
            }

            // Initialize memory blocks
            try {
              const { setCurrentTask } = require('../../../flow-memory-blocks');
              setCurrentTask(taskId, taskTitle);
            } catch (err) {
              if (process.env.DEBUG) console.error(`[post-tool-use] setCurrentTask: ${err.message}`);
            }

            if (process.env.DEBUG) {
              console.error(`[post-tool-use] Initialized durable session for ${taskId} (prompt-path bridge)`);
            }
          }
        }
      } catch (err) {
        // Non-blocking — durable session init should never fail the hook
        if (process.env.DEBUG) {
          console.error(`[post-tool-use] Durable session bridge: ${err.message}`);
        }
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
