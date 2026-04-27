#!/usr/bin/env node

'use strict';

/**
 * Wogi Flow — long-input-pending CLI
 *
 * Subcommands:
 *   status                       — show whether the marker is set + payload
 *   dismiss [--reason="<text>"]  — clear the marker after the AI / user has
 *                                  decided this prompt does NOT create work
 *                                  (escape hatch for the P11.6 gate)
 *
 * The marker file is written by user-prompt-submit when a long-form prompt
 * arrives without a source-link. The PreToolUse `checkLongInputPendingGate`
 * (long-input-enforcement.js) consults it and blocks Edit/Write/Bash/Skill
 * (with a small allow-list) until either /wogi-extract-review runs or this
 * dispatcher's `dismiss` command clears it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('./flow-utils');
const {
  isLongInputPending,
  readLongInputPending,
  clearLongInputPending,
  PENDING_PATH
} = require('./hooks/core/long-input-enforcement');

const DISMISS_LOG = path.join(PATHS.state, 'long-input-pending-dismiss.log');

function showStatus() {
  if (!isLongInputPending()) {
    process.stdout.write('long-input-pending: not set\n');
    return 0;
  }
  const payload = readLongInputPending() || {};
  process.stdout.write('long-input-pending: SET\n');
  process.stdout.write(`  marker:  ${PENDING_PATH}\n`);
  process.stdout.write(`  level:   ${payload.level || 'unknown'}\n`);
  process.stdout.write(`  reason:  ${payload.reason || 'unknown'}\n`);
  process.stdout.write(`  marked:  ${payload.markedAt || 'unknown'}\n`);
  return 0;
}

function dismiss(args) {
  if (!isLongInputPending()) {
    process.stdout.write('long-input-pending: nothing to dismiss (marker not set)\n');
    return 0;
  }
  const reasonArg = args.find(a => a.startsWith('--reason='));
  const reason = reasonArg ? reasonArg.slice('--reason='.length).replace(/^['"]|['"]$/g, '').trim() : '';
  if (!reason) {
    process.stderr.write([
      'Usage: flow long-input-pending dismiss --reason="<concrete reason>"',
      '',
      'A reason is required so the dismissal is auditable. Examples:',
      '  --reason="log dump, no work created"',
      '  --reason="verbatim error trace, already linked to wf-12345678"',
      '  --reason="conversational question, not work-creating"'
    ].join('\n') + '\n');
    return 1;
  }
  const payload = readLongInputPending() || {};
  clearLongInputPending();
  try {
    fs.mkdirSync(path.dirname(DISMISS_LOG), { recursive: true });
    fs.appendFileSync(DISMISS_LOG, JSON.stringify({
      dismissedAt: new Date().toISOString(),
      reason,
      markerPayload: payload
    }) + '\n');
  } catch (_err) { /* best-effort log */ }
  process.stdout.write('long-input-pending: dismissed\n');
  process.stdout.write(`  reason:  ${reason}\n`);
  process.stdout.write(`  logged:  ${DISMISS_LOG}\n`);
  return 0;
}

function showHelp() {
  process.stdout.write([
    'Usage: flow long-input-pending <subcommand> [options]',
    '',
    'Subcommands:',
    '  status                       Show whether the P11.6 long-input-pending marker is set',
    '  dismiss --reason="<text>"    Clear the marker after deciding the prompt does',
    '                               NOT create work. A reason is required and is',
    '                               appended to .workflow/state/long-input-pending-dismiss.log',
    '                               for telemetry/learning.',
    '  help                         Show this help',
    ''
  ].join('\n'));
  return 0;
}

const [, , sub, ...rest] = process.argv;
let exitCode = 0;
switch (sub) {
  case 'status': exitCode = showStatus(); break;
  case 'dismiss': exitCode = dismiss(rest); break;
  case 'help':
  case '--help':
  case '-h':
  case undefined: exitCode = showHelp(); break;
  default:
    process.stderr.write(`Unknown subcommand: ${sub}\nRun 'flow long-input-pending help' for usage.\n`);
    exitCode = 2;
}
process.exit(exitCode);
