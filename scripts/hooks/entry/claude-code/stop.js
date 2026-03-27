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

  // Workspace worker: send results to manager via HTTP when stopping.
  // Uses execFileSync with array args to avoid shell injection (finding-001).
  if (process.env.WOGI_MANAGER_PORT && process.env.WOGI_REPO_NAME && process.env.WOGI_REPO_NAME !== 'manager') {
    try {
      const { execFileSync, execSync } = require('node:child_process');
      const path = require('node:path');
      const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
      const repoName = process.env.WOGI_REPO_NAME;
      const managerPort = parseInt(process.env.WOGI_MANAGER_PORT, 10);

      // Validate inputs before using them (finding-001, finding-002)
      if (!VALID_NAME.test(repoName) || !Number.isInteger(managerPort) || managerPort < 1024 || managerPort > 65535) {
        throw new Error(`Invalid WOGI_REPO_NAME or WOGI_MANAGER_PORT`);
      }

      // Build summary from available state
      const summaryParts = [];
      const { PATHS, safeJsonParse } = require('../../flow-utils');

      const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), {});
      const recentTask = (ready.recentlyCompleted || [])[0];
      const inProgressTask = (ready.inProgress || [])[0];
      const task = recentTask || inProgressTask;

      if (task) {
        summaryParts.push(`**Task**: ${task.title || task.id}`);
        if (task.type) summaryParts.push(`**Type**: ${task.type}`);
      }

      try {
        const diff = execSync('git diff --name-only HEAD 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const staged = execSync('git diff --name-only --staged 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const allChanged = [...new Set([...diff.split('\n'), ...staged.split('\n')].filter(Boolean))];
        if (allChanged.length > 0) {
          summaryParts.push(`**Files changed**: ${allChanged.join(', ')}`);
        }
      } catch (_err) { /* non-critical */ }

      const body = summaryParts.join('\n') || `Work completed by ${repoName}.`;

      // execFileSync with array args — no shell interpretation (finding-001 fix)
      try {
        execFileSync('curl', [
          '-s', '-X', 'POST',
          `http://127.0.0.1:${managerPort}`,
          '-H', 'Content-Type: text/plain',
          '-H', `X-Wogi-From: ${repoName}`,
          '--data-binary', '@-'
        ], { input: body, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (_err) {
        // Manager might be offline — that's OK
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Stop] Workspace notification failed: ${err.message}`);
      }
    }
  }

  // Check if loop can exit
  return await checkLoopExit();
}, { failMode: 'warn', failOutput: { continue: false } });
