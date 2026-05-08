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
