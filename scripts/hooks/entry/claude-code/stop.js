#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Stop Hook
 *
 * Called when Claude is about to stop.
 * Enforces:
 * 1. Loop completion - blocks stop if acceptance criteria incomplete
 * 2. Routing enforcement - blocks stop if routing-pending flag is still set
 *    (catches text-only responses that bypassed /wogi-start routing)
 *
 * v6.2: Added routing enforcement to catch post-compaction bypass
 */

const { checkLoopExit } = require('../../core/loop-check');
const { isRoutingPending, incrementStopAttempts } = require('../../core/routing-gate');
const { runHook } = require('../shared/hook-runner');

runHook('Stop', async ({ parsedInput }) => {
  // v6.2: Routing enforcement check — catches text-only response bypass
  // If routing-pending flag is still set when the AI tries to stop, it means
  // the AI responded to the user's message without ever invoking a /wogi-* command.
  // This is the exact bypass we need to prevent (especially after context compaction).
  try {
    if (isRoutingPending()) {
      // Use counter-based approach instead of clearing immediately.
      // This gives the AI multiple chances to comply before giving up.
      // Gap 4 fix: clearing immediately made this single-shot protection.
      const { cleared, attempts } = incrementStopAttempts(10);

      if (cleared) {
        // Max attempts reached — allow stop to prevent infinite loop
        if (process.env.DEBUG) {
          console.error(`[Stop] Max routing enforcement attempts reached (${attempts}), allowing stop`);
        }
        // Fall through to normal stop logic
      } else {
        // Block the stop — force the AI to route through /wogi-start
        const routingMessage = [
          `ROUTING VIOLATION (attempt ${attempts}/10): You MUST call Skill(skill="wogi-start") before responding.`,
          '',
          'Call Skill(skill="wogi-start", args="<user\'s message>") NOW. No text. No explanation. Just the Skill tool call.'
        ].join('\n');

        // Return raw output — skip adapter transform for routing enforcement
        // (this needs { continue: true, stopReason } format directly)
        return { __raw: true, continue: true, stopReason: routingMessage };
      }
    }
  } catch (err) {
    // Fail-CLOSED for routing check — force continuation on errors.
    // Gap 5 fix: failing open here disabled the last line of defense.
    // Worst case: AI retries and hits the 3-attempt limit, which clears naturally.
    if (process.env.DEBUG) {
      console.error(`[Stop] Routing check error (fail-closed, forcing continue): ${err.message}`);
    }
    return {
      __raw: true,
      continue: true,
      stopReason: 'Routing enforcement check encountered an error. Please invoke /wogi-start with your request.'
    };
  }

  // Workspace worker: auto-write results back to manager when stopping
  // This runs in the hook (not the AI), so it's guaranteed to execute.
  // The AI can't be relied on to call workspace_send_message — the stop
  // hook fires before the AI gets a chance, or the AI forgets.
  if (process.env.WOGI_WORKSPACE_ROOT && process.env.WOGI_REPO_NAME) {
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const crypto = require('node:crypto');
      const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
      const repoName = process.env.WOGI_REPO_NAME;
      const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
      fs.mkdirSync(messagesDir, { recursive: true });

      // Build summary from available state
      const summary = [];
      const { PATHS, safeJsonParse } = require('../../flow-utils');

      // Get current/recently completed task info
      const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), {});
      const recentTask = (ready.recentlyCompleted || [])[0];
      const inProgressTask = (ready.inProgress || [])[0];
      const task = recentTask || inProgressTask;

      if (task) {
        summary.push(`**Task**: ${task.title || task.id}`);
        if (task.type) summary.push(`**Type**: ${task.type}`);
      }

      // Get last request-log entry
      try {
        const logPath = path.join(PATHS.root, 'request-log.md');
        if (fs.existsSync(logPath)) {
          const stat = fs.statSync(logPath);
          if (stat.size < 200 * 1024) {
            const logContent = fs.readFileSync(logPath, 'utf-8');
            const parts = logContent.split(/^### R-/m);
            if (parts.length > 1) {
              const lastEntry = parts[parts.length - 1];
              if (lastEntry.length < 2000) {
                summary.push(`**Log entry**:\n### R-${lastEntry.trim()}`);
              }
            }
          }
        }
      } catch (_err) { /* non-critical */ }

      // Get git status for changed files
      try {
        const { execSync } = require('node:child_process');
        const diff = execSync('git diff --name-only HEAD 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const staged = execSync('git diff --name-only --staged 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const allChanged = [...new Set([...diff.split('\n'), ...staged.split('\n')].filter(Boolean))];
        if (allChanged.length > 0) {
          summary.push(`**Files changed**: ${allChanged.join(', ')}`);
        }
      } catch (_err) { /* non-critical */ }

      const msgId = 'msg-' + crypto.randomBytes(4).toString('hex');
      const message = {
        id: msgId,
        from: repoName,
        to: 'manager',
        type: 'task-complete',
        priority: 'medium',
        timestamp: new Date().toISOString(),
        subject: task ? `Completed: ${task.title || task.id}` : `Work completed by ${repoName}`,
        body: summary.join('\n') || `${repoName} finished processing.`,
        taskId: task?.id || null,
        actionRequired: false,
        status: 'pending'
      };

      fs.writeFileSync(path.join(messagesDir, `${msgId}.json`), JSON.stringify(message, null, 2));

      if (process.env.DEBUG) {
        console.error(`[Stop] Workspace message written: ${msgId}`);
      }
    } catch (err) {
      // Non-critical — best effort
      if (process.env.DEBUG) {
        console.error(`[Stop] Workspace message failed: ${err.message}`);
      }
    }
  }

  // Check if loop can exit
  return await checkLoopExit();
}, { failMode: 'warn', failOutput: { continue: false } });
