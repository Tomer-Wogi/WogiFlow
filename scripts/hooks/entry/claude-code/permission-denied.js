#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code PermissionDenied Hook
 *
 * Fires after auto-mode classifier denies a tool use.
 * Available in Claude Code 2.1.88+.
 *
 * Handles:
 * 1. Logging — tracks denied permissions for diagnostics
 * 2. Workspace redirect — when a worker tries to access a file in another
 *    repo, redirect via the workspace message bus instead of retrying
 * 3. Guidance — provides actionable hints about what to do instead
 *
 * Return { retry: true } to tell the model it can retry the operation.
 * Return { retry: false } (or nothing) to accept the denial.
 */

'use strict';

const path = require('node:path');
const { runHook } = require('../shared/hook-runner');

runHook('PermissionDenied', async ({ input, parsedInput }) => {
  const toolName = parsedInput.toolName || input.tool_name || 'unknown';
  const toolInput = parsedInput.toolInput || input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.command || '';
  const reason = input.denial_reason || input.reason || '';

  // ── 1. Log the denial for diagnostics ──────────────────────
  try {
    const fs = require('node:fs');
    const { PATHS } = require('../../../flow-utils');
    const { safeJsonParseString } = require('../../../flow-io');
    const logPath = path.join(PATHS.state, 'permission-denials.json');

    let denials = [];
    try {
      if (fs.existsSync(logPath)) {
        const raw = fs.readFileSync(logPath, 'utf-8');
        const parsed = safeJsonParseString(raw, []);
        denials = Array.isArray(parsed) ? parsed : [];
      }
    } catch (_err) {
      denials = [];
    }

    denials.push({
      tool: toolName,
      target: typeof filePath === 'string' ? filePath.substring(0, 200) : '',
      reason: typeof reason === 'string' ? reason.substring(0, 200) : '',
      timestamp: new Date().toISOString()
    });

    // Keep last 100 denials
    if (denials.length > 100) denials = denials.slice(-100);

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(denials, null, 2));
  } catch (_err) {
    // Non-critical — don't let logging failure break the hook
  }

  // ── 2. Workspace redirect — cross-repo file access ─────────
  // When a worker tries to read/write a file that belongs to another repo,
  // redirect them to use the workspace message bus instead.
  const isWorkspace = !!process.env.WOGI_WORKSPACE_ROOT;
  const repoName = process.env.WOGI_REPO_NAME || '';

  if (isWorkspace && typeof filePath === 'string' && filePath.length > 0) {
    const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;

    // Check if the denied path is inside the workspace but outside this repo
    try {
      const resolvedFile = path.resolve(filePath);
      const resolvedRoot = path.resolve(workspaceRoot);
      const isInsideWorkspace = resolvedFile.startsWith(resolvedRoot + path.sep);
      const cwd = process.cwd();
      const isOutsideOwnRepo = !resolvedFile.startsWith(cwd + path.sep) && resolvedFile !== cwd;

      if (isInsideWorkspace && isOutsideOwnRepo) {
        // This is a cross-repo access attempt — redirect to message bus
        // Extract the target repo name from the path
        const relPath = resolvedFile.substring(resolvedRoot.length + 1);
        const targetRepo = relPath.split(path.sep)[0] || 'unknown';

        const guidance = [
          `Cross-repo file access denied: ${toolName} on ${path.basename(filePath)}`,
          `Target repo: ${targetRepo} (you are: ${repoName})`,
          '',
          'In workspace mode, repos cannot directly access each other\'s files.',
          `Use workspace_send_message(to: "${targetRepo}", message: "...") to ask the other repo\'s worker.`,
          `Or use workspace_send_message(to: "manager", message: "...") to escalate to the manager.`
        ].join('\n');

        return {
          __raw: true,
          retry: false,
          message: guidance
        };
      }
    } catch (_err) {
      // Path resolution failed — fall through to default handling
    }
  }

  // ── 3. Default handling — accept denial with guidance ──────
  // For non-workspace denials, just accept and let the model know
  return {
    __raw: true,
    retry: false
  };
}, { failMode: 'silent' });
