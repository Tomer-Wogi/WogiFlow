'use strict';

/**
 * Wogi Flow - Worker Boundary Gate (v2.20.1+)
 *
 * Mirror of manager-boundary-gate, but for workspace WORKERS.
 *
 * Problem this solves: a worker running in workspace mode cannot prompt the
 * user directly — the user only sees the manager terminal. When a worker
 * calls AskUserQuestion, its terminal shows a prompt nobody will ever type
 * into. The worker stalls silently.
 *
 * Contract: in workspace worker mode, questions to the user MUST be
 * channel-dispatched to the manager via `## QUESTION:`. The manager relays
 * to the user, gets the answer, and channel-dispatches back.
 *
 * This gate blocks the `AskUserQuestion` tool in worker mode with a message
 * giving the exact curl command to escalate properly.
 *
 * Scope:
 *   - Only fires in workspace worker mode (WOGI_WORKSPACE_ROOT +
 *     WOGI_REPO_NAME !== 'manager').
 *   - No-op in single-repo mode (no WOGI_WORKSPACE_ROOT).
 *   - No-op for the manager (manager SHOULD prompt the user — that is the
 *     manager's job).
 *   - Respects `config.workspace.blockAskUserQuestionInWorker` (default true).
 *
 * This is the missing piece after v2.20.0: v2.20.0 blocked hedging BETWEEN
 * queued tasks but not worker-asks-user-directly when the queue is empty.
 */

/**
 * Check if a tool call violates worker-role boundaries.
 *
 * @param {string} toolName - Tool being called
 * @param {Object} toolInput - Tool input parameters (unused for AskUserQuestion)
 * @param {Object} [config] - Loaded config (optional)
 * @returns {{ blocked: boolean, reason?: string, message?: string }}
 */
function checkWorkerBoundary(toolName, toolInput, config) {
  // Only active in workspace worker mode.
  if (!isWorkspaceWorker()) {
    return { blocked: false };
  }

  // Config toggle — default on.
  if (config?.workspace?.blockAskUserQuestionInWorker === false) {
    return { blocked: false };
  }

  // Block list: tools that prompt the user directly.
  // `AskUserQuestion` is the primary case — Claude Code's built-in
  // interactive-question tool. If more user-prompting tools emerge, add them
  // here (be surgical — only tools that actually expect a user reply).
  const USER_PROMPT_TOOLS = new Set(['AskUserQuestion']);

  if (!USER_PROMPT_TOOLS.has(toolName)) {
    return { blocked: false };
  }

  const repoName = process.env.WOGI_REPO_NAME || 'worker';
  const managerPort = process.env.WOGI_MANAGER_PORT || '8800';

  return {
    blocked: true,
    reason: 'worker-boundary-askuser',
    message: [
      `WORKER BOUNDARY: Cannot use ${toolName} in workspace worker mode.`,
      '',
      'The user ONLY sees the manager terminal. If you prompt the user here,',
      'nobody will see it — your session will stall silently.',
      '',
      'Channel-dispatch the question to the manager instead:',
      '',
      `  curl -s -X POST http://127.0.0.1:${managerPort} \\`,
      `    -H "X-Wogi-From: ${repoName}" \\`,
      `    --data-binary "## QUESTION: <your question for the user>"`,
      '',
      'The manager will relay to the user, capture the answer, and',
      'channel-dispatch a follow-up task to you with the resolved context.',
      '',
      'If you genuinely do NOT need the user — make a reasonable decision',
      'and note it in your reply to the manager (autonomous mode contract).'
    ].join('\n')
  };
}

/**
 * Detect workspace worker mode. Requires both env vars:
 *   WOGI_WORKSPACE_ROOT — set by the worker spawn path
 *   WOGI_REPO_NAME     — must NOT be 'manager'
 *
 * @returns {boolean}
 */
function isWorkspaceWorker() {
  if (!process.env.WOGI_WORKSPACE_ROOT) return false;
  const repo = process.env.WOGI_REPO_NAME;
  if (!repo || repo === 'manager') return false;
  return true;
}

/**
 * Path-discipline gate (Story B / wf-ab59f0e4 — Phase 4.5).
 *
 * Single-writer invariant: workers NEVER write into the workspace-manager
 * tree (`<workspace>/.workspace/**`); the manager NEVER writes into worker
 * member-repo `.workflow/state/**` paths. Cross-process state coordination
 * happens exclusively via the channel-dispatch HTTP bus.
 *
 * Without this check, a confused worker (or hostile prompt-injection
 * payload that talked the worker into editing manager state) could corrupt
 * `dispatched-tasks.json` for ALL workers in the workspace. The check
 * fails LOUD (block + clear error) so the boundary violation is impossible
 * to ignore — silent corruption is the worst-case alternative.
 *
 * Returns the same `{ blocked, reason?, message? }` shape as
 * `checkWorkerBoundary` so the caller can compose the two checks.
 *
 * @param {string} toolName
 * @param {Object} toolInput - { file_path } for Edit/Write
 * @returns {{ blocked: boolean, reason?: string, message?: string }}
 */
// SEC-002 fix (2026-04-26): manager-side path discipline now derives member
// state dirs from the actual workspace registry, not a hardcoded /members?/
// regex. Workspaces with flat-sibling layouts (member dirs directly under
// workspace root, no /members/ prefix) are now correctly enforced.
//
// Discovery is cached per-process for the WOGI_WORKSPACE_ROOT lifetime —
// PreToolUse fires often, fs.readdir on every call would add latency.
let _memberDirsCache = null;
let _memberDirsCacheRoot = null;

function discoverMemberStateDirs(root) {
  if (_memberDirsCache && _memberDirsCacheRoot === root) return _memberDirsCache;
  const fs = require('node:fs');
  const path = require('node:path');
  const out = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden dirs (.workspace, .git) and node_modules (mirrors
      // discoverMembers() in lib/workspace.js).
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const stateDir = path.join(root, entry.name, '.workflow', 'state');
      // Only include paths that actually have a .workflow/state/ subtree —
      // these are the member repos. Other directories (e.g. shared/, docs/,
      // dist/) are not workspace members.
      try {
        if (fs.existsSync(stateDir) && fs.statSync(stateDir).isDirectory()) {
          out.push(stateDir + path.sep);
        }
      } catch (_e) { /* skip unreadable */ }
    }
  } catch (_err) { /* unreadable workspace root → empty list */ }
  _memberDirsCache = out;
  _memberDirsCacheRoot = root;
  return out;
}

function _resetPathDisciplineCache() {
  _memberDirsCache = null;
  _memberDirsCacheRoot = null;
}

function checkPathDiscipline(toolName, toolInput) {
  if (!process.env.WOGI_WORKSPACE_ROOT) return { blocked: false };
  const writeTools = new Set(['Edit', 'Write', 'NotebookEdit']);
  if (!writeTools.has(toolName)) return { blocked: false };
  const filePath = toolInput && (toolInput.file_path || toolInput.notebook_path);
  if (typeof filePath !== 'string' || !filePath) return { blocked: false };

  const repo = process.env.WOGI_REPO_NAME || '';
  const root = process.env.WOGI_WORKSPACE_ROOT.replace(/\/+$/, '');
  const managerStateDir = `${root}/.workspace/`;

  if (repo && repo !== 'manager') {
    if (filePath.startsWith(managerStateDir)) {
      return {
        blocked: true,
        reason: 'path-discipline-worker',
        message: [
          `PATH DISCIPLINE: workers MUST NOT write to manager-owned files.`,
          ``,
          `Blocked: ${filePath}`,
          ``,
          `${managerStateDir}** is owned by the manager process.`,
          `Use the channel-dispatch HTTP bus to communicate with the manager;`,
          `never edit shared workspace state directly. See Story B (wf-ab59f0e4)`,
          `Phase 4.5 in .workflow/changes/wf-ab59f0e4.md.`
        ].join('\n')
      };
    }
  }

  if (repo === 'manager') {
    // Match against EVERY discovered member's .workflow/state/ path —
    // layout-independent. (SEC-002 fix; was hardcoded /members?/ regex)
    const memberStateDirs = discoverMemberStateDirs(root);
    for (const memberStateDir of memberStateDirs) {
      if (filePath.startsWith(memberStateDir)) {
        return {
          blocked: true,
          reason: 'path-discipline-manager',
          message: [
            `PATH DISCIPLINE: manager MUST NOT write to worker member-repo state.`,
            ``,
            `Blocked: ${filePath}`,
            `Member: ${memberStateDir}`,
            ``,
            `Worker member-repos own their own .workflow/state/. Send a channel`,
            `dispatch to the worker if state changes are needed there.`
          ].join('\n')
        };
      }
    }
  }

  return { blocked: false };
}

module.exports = {
  checkWorkerBoundary,
  checkPathDiscipline,
  _resetPathDisciplineCache,
  isWorkspaceWorker
};
