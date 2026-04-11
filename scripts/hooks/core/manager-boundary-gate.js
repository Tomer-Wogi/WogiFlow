#!/usr/bin/env node

/**
 * Wogi Flow - Manager Role Boundary Gate
 *
 * Mechanically enforces the manager's role boundaries in workspace mode.
 * The manager is an orchestrator — it dispatches work to workers via channels.
 * It must NOT directly modify files in member repos or run commands there.
 *
 * Activation: WOGI_REPO_NAME === 'manager'
 *
 * Rules:
 * - Edit/Write: BLOCKED on any file inside a member repo
 * - Read/Glob/Grep: ALLOWED for .workflow/state/, package.json; BLOCKED for source code
 * - Bash: If command contains a member repo path, must match a read-only allowlist
 *         Otherwise BLOCKED with a dispatch redirect message
 *
 * Design: Allowlist-based (not blocklist). New tools/commands are blocked by default.
 * Only explicitly whitelisted read patterns are allowed in member repos.
 *
 * Source: Workspace manager repeatedly violated role boundaries despite prompt rules
 * (cd into worker repos, npm install, bridge sync). Prompt-only enforcement failed
 * 3 times — mechanical gate required.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

// ============================================================
// Member Path Resolution
// ============================================================

let _cachedMemberPaths = null;

/**
 * Load and cache resolved member repo paths from workspace manifest.
 * Returns an array of { name, resolvedPath } objects.
 *
 * @returns {Array<{ name: string, resolvedPath: string }>}
 */
function getMemberPaths() {
  if (_cachedMemberPaths) return _cachedMemberPaths;

  const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) return [];

  const manifestPath = path.join(workspaceRoot, '.workspace', 'state', 'workspace-manifest.json');
  if (!fs.existsSync(manifestPath)) return [];

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const members = manifest.members || {};
    const paths = [];

    for (const [name, member] of Object.entries(members)) {
      if (typeof name !== 'string' || !member) continue;
      const memberPath = member.path || member.root;
      if (typeof memberPath !== 'string') continue;

      // Store both the original (normalized) path AND the symlink-resolved path.
      // On macOS, /tmp → /private/tmp, so commands may contain either form.
      const normalized = path.resolve(workspaceRoot, memberPath);
      let resolved = normalized;
      try {
        resolved = fs.realpathSync(normalized);
      } catch (_err) {
        // Path doesn't exist — use normalized only
      }

      // allPaths: deduplicated list of paths to match against
      const allPaths = [resolved];
      if (normalized !== resolved) allPaths.push(normalized);

      paths.push({ name, resolvedPath: resolved, allPaths, port: member.port || member.channelPort });
    }

    _cachedMemberPaths = paths;
    return paths;
  } catch (_err) {
    return [];
  }
}

/**
 * Check if a path is inside any member repo.
 * Returns the member name if found, null otherwise.
 *
 * @param {string} targetPath - Absolute path to check
 * @returns {{ name: string, resolvedPath: string } | null}
 */
function findMemberForPath(targetPath) {
  if (!targetPath || !path.isAbsolute(targetPath)) return null;

  const members = getMemberPaths();

  // Try both normalized and symlink-resolved versions of the target path.
  // On macOS, /tmp → /private/tmp, so we need to check both forms.
  const normalized = path.resolve(targetPath);
  let resolved = normalized;
  try {
    // Walk up to find the nearest existing ancestor, resolve from there
    let check = normalized;
    while (check !== path.dirname(check)) {
      if (fs.existsSync(check)) {
        resolved = fs.realpathSync(check) + normalized.slice(check.length);
        break;
      }
      check = path.dirname(check);
    }
  } catch (_err) {
    // Can't resolve — use normalized
  }

  const candidates = [resolved, normalized];

  for (const member of members) {
    const memberPaths = member.allPaths || [member.resolvedPath];
    for (const candidate of candidates) {
      for (const mp of memberPaths) {
        if (candidate === mp || candidate.startsWith(mp + path.sep)) {
          return member;
        }
      }
    }
  }

  return null;
}

/**
 * Get the channel port for a member repo (for dispatch redirect messages).
 *
 * @param {string} memberName
 * @returns {number|null}
 */
function getMemberPort(memberName) {
  const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
  if (!workspaceRoot) return null;

  try {
    const manifestPath = path.join(workspaceRoot, '.workspace', 'state', 'workspace-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const member = manifest.members?.[memberName];
    return member?.port ?? member?.channelPort ?? null;
  } catch (_err) {
    return null;
  }
}

// ============================================================
// Read-Only Allowlist for Bash Commands
// ============================================================

/**
 * Patterns that are allowed when a Bash command references a member repo path.
 * If the command matches ANY of these patterns, it's a permitted read operation.
 * Everything else is blocked by default (allowlist, not blocklist).
 */
const ALLOWED_BASH_PATTERNS = [
  // Reading workflow state files
  /\bcat\s+.*\.workflow\b/,
  /\bls\s+.*\.workflow\b/,
  /\bhead\s+.*\.workflow\b/,
  /\btail\s+.*\.workflow\b/,
  /\bwc\s+.*\.workflow\b/,

  // Reading package.json
  /\bcat\s+.*package\.json\b/,

  // Git read-only operations (with -C for cross-directory)
  /\bgit\s+(-C\s+\S+\s+)?log\b/,
  /\bgit\s+(-C\s+\S+\s+)?status\b/,
  /\bgit\s+(-C\s+\S+\s+)?diff\b/,
  /\bgit\s+(-C\s+\S+\s+)?show\b/,
  /\bgit\s+(-C\s+\S+\s+)?blame\b/,
  /\bgit\s+(-C\s+\S+\s+)?rev-parse\b/,
  /\bgit\s+(-C\s+\S+\s+)?branch\b/,
  /\bgit\s+(-C\s+\S+\s+)?tag\s+-l\b/,
  /\bgit\s+(-C\s+\S+\s+)?ls-files\b/,
  /\bgit\s+(-C\s+\S+\s+)?describe\b/,
  /\bgit\s+(-C\s+\S+\s+)?remote\s+-v\b/,

  // Grep/find for reading
  /\bgrep\s+/,
  /\bfind\s+.*-name\b/,

  // Curl is always allowed (it's the dispatch mechanism)
  /\bcurl\s+/,

  // Health checks
  /\bwget\s+/,
];

/**
 * Check if a Bash command that references a member repo matches the read-only allowlist.
 *
 * @param {string} command - The Bash command string
 * @returns {boolean} True if the command is an allowed read-only operation
 */
function isAllowedReadCommand(command) {
  const trimmed = command.trim();
  return ALLOWED_BASH_PATTERNS.some(pattern => pattern.test(trimmed));
}

// ============================================================
// Gate Logic
// ============================================================

/**
 * Check if a tool call violates manager role boundaries.
 *
 * @param {string} toolName - Tool being called (Bash, Edit, Write, Read, etc.)
 * @param {Object} toolInput - Tool input parameters
 * @returns {{ blocked: boolean, message?: string, reason?: string }}
 */
function checkManagerBoundary(toolName, toolInput) {
  // Only active in workspace manager mode
  if (process.env.WOGI_REPO_NAME !== 'manager') {
    return { blocked: false };
  }

  const members = getMemberPaths();
  if (members.length === 0) {
    // No manifest or no members — can't enforce, fail open
    return { blocked: false };
  }

  // ── Edit / Write: check file_path ────────────────────────
  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path;
    if (!filePath) return { blocked: false };

    const member = findMemberForPath(filePath);
    if (member) {
      const port = member.port || getMemberPort(member.name);
      const portHint = port ? ` (port ${port})` : '';
      return {
        blocked: true,
        reason: 'manager-boundary-write',
        message: [
          `MANAGER BOUNDARY: Cannot modify files in worker repo "${member.name}" directly.`,
          `Blocked: ${toolName} on ${path.basename(filePath)}`,
          '',
          `Dispatch to the worker instead:`,
          `  curl -s -X POST http://localhost:${port || '{port}'} -H "X-Wogi-From: manager" -d "<describe what needs to change>"`,
          '',
          `You are an orchestrator — workers make changes, you coordinate.${portHint}`
        ].join('\n')
      };
    }
    return { blocked: false };
  }

  // ── Read / Glob / Grep: allow .workflow/state/ and package.json ──
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    const targetPath = toolInput.file_path || toolInput.path;
    if (!targetPath) return { blocked: false };

    const member = findMemberForPath(targetPath);
    if (member) {
      // Compute relative path using the same form that matched.
      // Try each member path form to find one that produces a clean relative.
      const resolved = path.resolve(targetPath);
      const memberPaths = member.allPaths || [member.resolvedPath];
      let relative = path.relative(member.resolvedPath, resolved);
      for (const mp of memberPaths) {
        const rel = path.relative(mp, resolved);
        if (!rel.startsWith('..')) { relative = rel; break; }
      }

      // Allowed paths: .workflow/, .workspace/, package.json, tsconfig.json
      const allowedPrefixes = ['.workflow', '.workspace', '.claude'];
      const allowedFiles = ['package.json', 'tsconfig.json', '.env.example'];
      const baseName = path.basename(resolved);

      const isAllowed = allowedPrefixes.some(prefix => relative.startsWith(prefix)) ||
                        allowedFiles.includes(baseName);

      if (!isAllowed) {
        return {
          blocked: true,
          reason: 'manager-boundary-read',
          message: [
            `MANAGER BOUNDARY: Cannot read source code in worker repo "${member.name}".`,
            `Blocked: ${toolName} on ${relative}`,
            '',
            `You may read: .workflow/state/*, package.json, .claude/ (state files)`,
            `For source code investigation, dispatch to the worker.`
          ].join('\n')
        };
      }
    }
    return { blocked: false };
  }

  // ── Bash: check for member repo paths in the command ──────
  if (toolName === 'Bash') {
    const command = toolInput.command;
    if (!command) return { blocked: false };

    // Find if any member repo path appears in the command (check all path forms)
    for (const member of members) {
      const memberPaths = member.allPaths || [member.resolvedPath];
      const matchedPath = memberPaths.find(mp => command.includes(mp));
      if (matchedPath) {
        // Member path found in command — check allowlist
        if (isAllowedReadCommand(command)) {
          return { blocked: false };
        }

        const port = member.port || getMemberPort(member.name);
        return {
          blocked: true,
          reason: 'manager-boundary-bash',
          message: [
            `MANAGER BOUNDARY: Cannot run commands in worker repo "${member.name}".`,
            `Blocked: ${command.length > 100 ? command.slice(0, 100) + '...' : command}`,
            '',
            `Dispatch to the worker instead:`,
            `  curl -s -X POST http://localhost:${port || '{port}'} -H "X-Wogi-From: manager" -d "<your command>"`,
            '',
            `Allowed in member repos: read .workflow/state/, git log/status/diff, curl to ports.`,
            `Everything else must be dispatched to the worker.`
          ].join('\n')
        };
      }
    }

    // Check for cd into member repos (handles cd with various chaining operators)
    const cdPattern = /\bcd\s+["']?([^\s"';&|]+)/g;
    let match;
    while ((match = cdPattern.exec(command)) !== null) {
      const cdTarget = match[1];
      // Try to resolve the cd target (absolute paths and simple relative paths)
      let resolvedCd;
      try {
        resolvedCd = path.isAbsolute(cdTarget)
          ? path.resolve(cdTarget)
          : path.resolve(process.cwd(), cdTarget);
      } catch (_err) {
        continue;
      }

      const member = findMemberForPath(resolvedCd);
      if (member) {
        const port = member.port || getMemberPort(member.name);
        return {
          blocked: true,
          reason: 'manager-boundary-cd',
          message: [
            `MANAGER BOUNDARY: Cannot cd into worker repo "${member.name}".`,
            '',
            `Dispatch to the worker instead:`,
            `  curl -s -X POST http://localhost:${port || '{port}'} -H "X-Wogi-From: manager" -d "<your command>"`,
            '',
            `The manager stays in the workspace root. Workers execute in their own repos.`
          ].join('\n')
        };
      }
    }

    return { blocked: false };
  }

  return { blocked: false };
}

/**
 * Clear the cached member paths (for testing or re-initialization).
 */
function clearCache() {
  _cachedMemberPaths = null;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  checkManagerBoundary,
  getMemberPaths,
  findMemberForPath,
  getMemberPort,
  isAllowedReadCommand,
  clearCache
};
