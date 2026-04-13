#!/usr/bin/env node

/**
 * Wogi Flow - Template Change Detector (Track B B3 — 2026-04-13)
 *
 * Mechanical enforcement for self-maintenance.md §1: "CLAUDE.md is generated
 * from template ... Run `flow bridge sync` to regenerate." Without this hook,
 * the rule was prose-only — the IGR review found a real-world violation
 * (PSR-001: CLAUDE.md last synced 2026-04-12, templates modified 2026-04-13).
 *
 * Detects edits to `.workflow/templates/**` and `.workflow/templates/partials/**`
 * and signals the AI to run `flow bridge sync` before the session ends. Marks
 * a flag in `.workflow/state/template-change-pending.json` that session-end
 * and the next /wogi-start can read.
 *
 * CLI-agnostic per the three-layer hook architecture.
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('../../flow-paths');
const { ensureDir, fileExists, safeJsonParse } = require('../../flow-io');

const TEMPLATE_PATHS_PATTERN = /\.workflow\/templates\/(.+\.hbs|partials\/.+\.hbs|claude-md\.hbs)$/;
const PENDING_PATH = path.join(PATHS.state, 'template-change-pending.json');

/**
 * Inspect a PostToolUse invocation; if the tool was Edit/Write/MultiEdit
 * targeting a template file, mark the project as needing `flow bridge sync`.
 *
 * @param {Object} ctx - { toolName, toolInput, toolResponse, filePath }
 * @returns {{ marked:boolean, reason?:string }}
 */
function maybeMarkTemplateChange(ctx) {
  if (!ctx || !ctx.toolName) return { marked: false };
  if (!['Edit', 'Write', 'MultiEdit'].includes(ctx.toolName)) return { marked: false };
  const fp = ctx.filePath || ctx.toolInput?.file_path;
  if (!fp || typeof fp !== 'string') return { marked: false };
  if (!TEMPLATE_PATHS_PATTERN.test(fp)) return { marked: false };

  // Don't mark if the tool failed
  if (ctx.toolResponse?.error || ctx.toolResponse?.isError) return { marked: false };

  try {
    ensureDir(PATHS.state);
    const existing = safeJsonParse(PENDING_PATH, { changes: [], firstNoticedAt: null }) || {
      changes: [],
      firstNoticedAt: null,
    };
    const change = {
      path: fp,
      tool: ctx.toolName,
      at: new Date().toISOString(),
    };
    existing.changes = (Array.isArray(existing.changes) ? existing.changes : []).concat([change]);
    if (!existing.firstNoticedAt) existing.firstNoticedAt = change.at;
    existing.lastChangeAt = change.at;
    fs.writeFileSync(PENDING_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    return { marked: true, reason: `template change detected: ${fp}` };
  } catch (err) {
    // Hook telemetry is best-effort; never block a successful tool call.
    return { marked: false, reason: `marker write failed: ${err.message}` };
  }
}

/**
 * Read the current pending state. Returns null when no template change pending.
 */
function getPendingState() {
  if (!fileExists(PENDING_PATH)) return null;
  return safeJsonParse(PENDING_PATH, null);
}

/**
 * Clear the pending marker after `flow bridge sync` runs. Caller is
 * `scripts/flow-bridge.js` — invoked at the end of its sync flow.
 */
function clearPending() {
  try {
    if (fileExists(PENDING_PATH)) fs.unlinkSync(PENDING_PATH);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Render a human-readable reminder for surfacing at session-end.
 */
function renderReminder(state) {
  if (!state || !Array.isArray(state.changes) || state.changes.length === 0) return '';
  const distinctFiles = [...new Set(state.changes.map((c) => c.path))];
  const lines = [];
  lines.push('━━━ TEMPLATE CHANGE REMINDER ━━━');
  lines.push(`${state.changes.length} template edit(s) since CLAUDE.md was last regenerated:`);
  for (const p of distinctFiles.slice(0, 8)) lines.push(`  • ${p}`);
  if (distinctFiles.length > 8) lines.push(`  ...and ${distinctFiles.length - 8} more`);
  lines.push('');
  lines.push('Run: node scripts/flow-bridge.js sync claude-code');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

module.exports = {
  maybeMarkTemplateChange,
  getPendingState,
  clearPending,
  renderReminder,
  TEMPLATE_PATHS_PATTERN,
  PENDING_PATH,
};
