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
const { captureObservation, selectDuration } = require('../../core/observation-capture');
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
      duration: selectDuration(parsedInput, Date.now() - startTime),
      explorationStatus: toolFailed ? 'rejected' : undefined,
      rejectionReason: toolFailed ? extractErrorMessage(toolResponse) : undefined
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[observation-capture] ${err.message}`);
    }
  }

  // S1 (wf-e72350bf): mirror the worker's TodoWrite decomposition to the durable
  // sub-task ledger so the continuation gate (S2) and restart-resume (S5) have a
  // disk-readable "work remaining" signal. Worker-mode only by default (solo
  // sessions opt in via workspace.subtaskLedger.alsoInSolo). Fail-open.
  if (toolName === 'TodoWrite' && !toolFailed) {
    try {
      const { getConfig, PATHS, safeJsonParse } = require('../../../flow-utils');
      const cfg = (() => { try { return getConfig()?.workspace?.subtaskLedger || {}; } catch (_err) { return {}; } })();
      const ledgerEnabled = cfg.enabled !== false;
      const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                       process.env.WOGI_REPO_NAME &&
                       process.env.WOGI_REPO_NAME !== 'manager';
      if (ledgerEnabled && (isWorker || cfg.alsoInSolo === true)) {
        const ready = safeJsonParse(require('node:path').join(PATHS.state, 'ready.json'), { inProgress: [] });
        const taskId = ready.inProgress?.[0]?.id || null;
        if (taskId) {
          const subtaskState = require('../../../../lib/workspace-subtask-state');
          const subs = subtaskState.subtasksFromTodos(toolInput);
          if (subs.length > 0) subtaskState.write(taskId, subs);
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[post-tool-use] subtask-ledger mirror: ${err.message}`);
    }
  }

  // Track B B3 fix (2026-04-13): mark when templates are edited, so
  // session-end and the next /wogi-start can remind to run flow bridge sync.
  // Mechanical enforcement of self-maintenance.md §1.
  try {
    const { maybeMarkTemplateChange } = require('../../core/template-change-detector');
    maybeMarkTemplateChange({ toolName, toolInput, toolResponse, filePath });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[template-change-detector] ${err.message}`);
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

  // Deletion log (Fork C, v2.29.5): warn-only audit trail for AI
  // deletions of user-facing UI files. Fire on Bash rm/git rm and
  // Edit/Write that empty a UI-glob-matching path. Never blocks; just
  // appends to .workflow/state/deletions-log.md.
  if (!toolFailed) {
    try {
      const { recordDeletion } = require('../../core/deletion-log');
      const { getConfig, PATHS } = require('../../../flow-utils');
      const cfg = (() => {
        try { return getConfig()?.hooks?.rules?.deletionLog || {}; }
        catch (_err) { return {}; }
      })();
      // Read active task id (best-effort — not critical for the log)
      let taskId = null;
      try {
        const { safeJsonParse: rj } = require('../../../flow-utils');
        const ready = rj(require('node:path').join(PATHS.state, 'ready.json'), { inProgress: [] });
        taskId = ready.inProgress?.[0]?.id || null;
      } catch (_err) { /* fail-open */ }
      recordDeletion({
        toolName,
        toolInput,
        toolResponse,
        sessionId: parsedInput.sessionId,
        taskId,
        config: cfg
      });
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[post-tool-use] deletion-log: ${err.message}`);
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
