#!/usr/bin/env node

/**
 * Wogi Flow — Deferral Authorization CLI (wf-f9912af6)
 *
 * Explicit user-authorization helper for the deferral gate. Used when the AI
 * needs to record that the user picked a defer-style menu option in
 * /wogi-review (e.g., "Create tasks for all - fix later in batches").
 *
 * Usage:
 *   flow defer-auth grant --scope=all --reason="<verbatim user phrase>"
 *   flow defer-auth grant --findings=F5,F6,F7 --reason="..."
 *   flow defer-auth clear
 *   flow defer-auth status
 */

const gate = require('./hooks/core/deferral-gate');

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) {
        args[a.slice(2)] = true;
      } else {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      }
    }
  }
  return args;
}

function cmdGrant(args) {
  // wf-b8839d99: Refuse to grant when invoked from a non-TTY context.
  // wf-6e31850e (S-5): Defense-in-depth — also check parent process name.
  // PTY allocation can fake TTY; checking parent process binds the gate to
  // an actual shell. Falls back gracefully if /proc isn't queryable (macOS,
  // restricted environments) — keeps the TTY check as primary signal.
  //
  // Override: --i-am-human bypasses both checks. Logged to shell history;
  // CI pipelines that need to grant must explicitly opt in.
  function detectParentShell() {
    try {
      const ppid = process.ppid;
      if (!ppid) return null;
      // Linux: /proc/<ppid>/comm contains the parent process name
      const fs = require('node:fs');
      try {
        const comm = fs.readFileSync(`/proc/${ppid}/comm`, 'utf-8').trim();
        if (/^(bash|zsh|fish|sh|ksh|dash|tcsh)$/.test(comm)) return comm;
        return `not-a-shell:${comm}`;
      } catch (_err) {
        // macOS / Windows / restricted: fall back to ps
        const { execSync } = require('node:child_process');
        try {
          const out = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf-8', timeout: 1000 }).trim();
          const base = require('node:path').basename(out);
          if (/^(-?bash|-?zsh|-?fish|-?sh|-?ksh|-?dash|-?tcsh)$/.test(base)) return base;
          return `not-a-shell:${base}`;
        } catch (_err2) {
          return null; // ps unavailable — fall back to TTY check only
        }
      }
    } catch (_err) {
      return null;
    }
  }

  const ttySignal = Boolean(process.stdin.isTTY);
  const parentShell = detectParentShell();
  const parentIsShell = parentShell && !parentShell.startsWith('not-a-shell:');
  const parentSignal = parentShell === null ? null : parentIsShell; // null = couldn't detect
  // Human if: explicit --i-am-human OR (TTY AND (parent is shell OR parent undetectable))
  const isHuman = args['i-am-human'] === true ||
                  (ttySignal && parentSignal !== false);
  if (!isHuman) {
    console.error('grant: refused — non-TTY invocation detected.');
    console.error('');
    console.error('Per wf-b8839d99: AI subprocesses cannot self-issue deferral authorization.');
    console.error('The auth marker may only be written by:');
    console.error('  1. The UserPromptSubmit AI classifier interpreting the user\'s message, OR');
    console.error('  2. A human running this CLI from a terminal directly.');
    console.error('');
    console.error('If the user authorized deferral, surface it back through the conversation —');
    console.error('the classifier will detect it and write the marker on the next prompt.');
    console.error('');
    console.error('Override (genuine automation): pass --i-am-human (logged in audit trail).');
    process.exit(3);
  }

  let scope = 'all';
  if (args.findings) {
    scope = String(args.findings)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (scope.length === 0) {
      console.error('grant: --findings must be a non-empty comma-separated list');
      process.exit(2);
    }
  } else if (args.scope === 'all' || args.scope === undefined) {
    scope = 'all';
  } else {
    scope = String(args.scope);
  }
  const reason = args.reason ? String(args.reason) : 'cli-grant';
  const ttlSec = args['ttl-sec'] ? parseInt(args['ttl-sec'], 10) : undefined;

  const payload = gate.writeAuth({
    scope,
    source: reason,
    userPromptExcerpt: '(out-of-band CLI grant — no user prompt)',
    confidence: 100,
    grantedBy: 'explicit-cli',
    ttlSec
  });

  if (!payload) {
    console.error('grant: failed to write authorization marker');
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'granted', ...payload }, null, 2));
}

function cmdClear() {
  gate.clearAuth();
  gate.clearNoDeferPin();
  console.log(JSON.stringify({ status: 'cleared' }, null, 2));
}

function cmdStatus() {
  const auth = gate.loadAuth();
  const pin = gate.loadNoDeferPin();
  console.log(JSON.stringify({
    authorization: auth || null,
    noDeferPin: pin || null,
    authPath: gate.getAuthPath(),
    pinPath: gate.getNoDeferPinPath()
  }, null, 2));
}

function usage() {
  console.log('Usage: flow defer-auth <grant|clear|status> [--scope=all|<id>] [--findings=F1,F2] [--reason="..."] [--ttl-sec=600]');
  process.exit(2);
}

function main() {
  const [, , subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);
  switch (subcommand) {
    case 'grant': return cmdGrant(args);
    case 'clear': return cmdClear();
    case 'status': return cmdStatus();
    default: return usage();
  }
}

if (require.main === module) main();

module.exports = { parseArgs, cmdGrant, cmdClear, cmdStatus };
