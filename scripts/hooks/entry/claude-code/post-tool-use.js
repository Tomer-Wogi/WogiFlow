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
const { captureObservation } = require('../../core/observation-capture');
const { runHook } = require('../shared/hook-runner');

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

runHook('PostToolUse', async ({ parsedInput }) => {
  const startTime = Date.now();

  const toolName = parsedInput.toolName;
  const toolInput = parsedInput.toolInput || {};
  const toolResponse = parsedInput.toolResponse;
  const filePath = toolInput.file_path;

  // Detect tool failure for rejected-approach tagging
  const toolFailed = !!(
    toolResponse?.error ||
    toolResponse?.isError ||
    (typeof toolResponse === 'string' && toolResponse.toLowerCase().startsWith('error:'))
  );

  // CAPTURE OBSERVATION FOR ALL TOOLS (non-blocking)
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
    if (process.env.DEBUG) {
      console.error(`[observation-capture] ${err.message}`);
    }
  }

  // v6.0: Detect task entering inProgress via ready.json edit
  if ((toolName === 'Edit' || toolName === 'Write') && filePath && filePath.endsWith('ready.json') && !toolFailed) {
    try {
      const { safeJsonParse } = require('../../../flow-utils');
      const readyData = safeJsonParse(filePath, null);
      if (readyData && Array.isArray(readyData.inProgress) && readyData.inProgress.length > 0) {
        const task = readyData.inProgress[0];
        const taskId = task && task.id;
        if (!taskId) throw new Error('inProgress entry missing id');
        const taskTitle = task.title || taskId;

        const { loadDurableSession, createDurableSession } = require('../../../flow-durable-session');
        const existing = loadDurableSession();
        if (!existing || existing.taskId !== taskId) {
          const criteria = task.acceptanceCriteria || task.scenarios || [];
          const steps = Array.isArray(criteria) ? criteria : [];
          const sessionSteps = steps.length > 0 ? steps : [taskTitle];
          createDurableSession(taskId, 'task', sessionSteps);

          try {
            const { trackTaskStart } = require('../../../flow-session-state');
            trackTaskStart(taskId, taskTitle);
          } catch (err) {
            if (process.env.DEBUG) console.error(`[post-tool-use] trackTaskStart: ${err.message}`);
          }

          try {
            const { setCurrentTask } = require('../../../flow-memory-blocks');
            setCurrentTask(taskId, taskTitle);
          } catch (err) {
            if (process.env.DEBUG) console.error(`[post-tool-use] setCurrentTask: ${err.message}`);
          }

          // v7.0: Initialize task checkpoint with criteria for PostCompact recovery
          try {
            const { saveCheckpoint } = require('../../../flow-task-checkpoint');
            const criteriaList = (task.acceptanceCriteria || task.scenarios || [])
              .map((c, i) => ({
                id: `ac-${i + 1}`,
                text: typeof c === 'string' ? c : (c.description || c.title || `Criterion ${i + 1}`),
                done: false
              }));
            await saveCheckpoint({
              taskId,
              taskTitle,
              currentPhase: 'coding',
              criteria: criteriaList,
              changedFiles: []
            });
          } catch (err) {
            if (process.env.DEBUG) console.error(`[post-tool-use] Checkpoint init: ${err.message}`);
          }

          if (process.env.DEBUG) {
            console.error(`[post-tool-use] Initialized durable session for ${taskId} (prompt-path bridge)`);
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[post-tool-use] Durable session bridge: ${err.message}`);
      }
    }
  }

  // Auto registry scan after successful git commit (fire-and-forget)
  if (toolName === 'Bash' && toolInput.command && !toolFailed) {
    const { isGitCommit } = require('../../core/commit-log-gate');
    if (isGitCommit(toolInput.command)) {
      try {
        const { RegistryManager } = require('../../../flow-registry-manager');
        const manager = new RegistryManager();
        manager.loadPlugins();
        manager.activatePlugins();
        manager.scanAll().catch((err) => {
          if (process.env.DEBUG) {
            console.error(`[post-tool-use] Auto registry scan failed: ${err.message}`);
          }
        });
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[post-tool-use] Registry manager load error: ${err.message}`);
        }
      }
    }
  }

  // Only run validation for Edit/Write
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return { __raw: true, continue: true };
  }

  // Skip if tool failed
  if (toolResponse && toolResponse.error) {
    return { __raw: true, continue: true };
  }

  // v3.0: Scope mutation guard — track new file creations for fix tasks
  if (toolName === 'Write' && filePath && !filePath.includes('.workflow/') && !filePath.includes('.claude/')) {
    try {
      const { recordNewFile } = require('../../core/scope-mutation-gate');
      const { safeJsonParse: readJsonSm, PATHS: pathsSm } = require('../../../flow-utils');
      const readySm = readJsonSm(require('path').join(pathsSm.state, 'ready.json'), { inProgress: [] });
      const activeSm = readySm.inProgress?.[0];
      if (activeSm?.id) {
        recordNewFile(activeSm.id, filePath);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[post-tool-use] Scope mutation tracking: ${err.message}`);
    }
  }

  // v3.0: Bugfix scope gate — track file edits for L3 bugfix tasks
  if (filePath && !filePath.includes('.workflow/') && !filePath.includes('.claude/')) {
    try {
      const { recordFileEdit } = require('../../core/bugfix-scope-gate');
      const { safeJsonParse: readJson, PATHS: utilPaths } = require('../../../flow-utils');
      const readyData = readJson(require('path').join(utilPaths.state, 'ready.json'), { inProgress: [] });
      const activeTask = readyData.inProgress?.[0];
      if (activeTask?.id && (activeTask.level === 'L3') &&
          (activeTask.type === 'bugfix' || activeTask.type === 'fix' || activeTask.type === 'bug')) {
        recordFileEdit(activeTask.id, filePath);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[post-tool-use] Bugfix scope tracking: ${err.message}`);
      }
    }
  }

  // v7.0: Track changed files in task checkpoint
  if (filePath && !filePath.includes('.workflow/') && !filePath.includes('.claude/')) {
    try {
      const { trackChangedFile } = require('../../../flow-task-checkpoint');
      trackChangedFile(filePath);
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[post-tool-use] File tracking: ${err.message}`);
      }
    }
  }

  // Run validation
  return await runValidation({
    filePath,
    timeout: 30000
  });
}, { failMode: 'warn' });
