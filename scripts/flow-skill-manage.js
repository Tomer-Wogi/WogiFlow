#!/usr/bin/env node

'use strict';

/**
 * Wogi Flow — Skill Proposal CLI
 *
 * Subcommands:
 *   flow skill propose --name <n> --content <file> [--rationale <text>]
 *   flow skill patch   --name <n> --content <file> [--rationale <text>]
 *   flow skill remove  --name <n> [--rationale <text>]
 *   flow skill promote <name> [--id <proposalId>]
 *   flow skill reject  <name> [--id <proposalId>]
 *   flow skill archive <name>
 *   flow skill pending [--json]
 *
 * Writes are staged to .claude/skills/pending/ and .workflow/state/skill-proposals.json.
 * Session-end hook surfaces pending proposals for user review.
 */

const store = require('../lib/skill-proposal-store');
const { success, warn, error: errorMsg, info, colors } = require('./flow-output');

// ============================================================
// Arg parsing
// ============================================================

function parseArgs(argv) {
  // argv = [subcommand, ...rest]
  const [subcommand, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--name') {
      flags.name = rest[++i];
    } else if (a === '--content') {
      flags.content = rest[++i];
    } else if (a === '--rationale') {
      flags.rationale = rest[++i];
    } else if (a === '--id') {
      flags.id = rest[++i];
    } else if (a === '--json') {
      flags.json = true;
    } else if (a === '--proposed-by') {
      flags.proposedBy = rest[++i];
    } else if (a === '--help' || a === '-h') {
      flags.help = true;
    } else if (a && !a.startsWith('--')) {
      positional.push(a);
    }
  }
  return { subcommand, flags, positional };
}

function showHelp() {
  console.log(`
${colors.cyan}Wogi Flow — Skill Proposal CLI${colors.reset}

Agent-staged skill changes. Proposals are reviewed at session-end and approved
or rejected by the user. No auto-apply.

Usage:
  flow skill propose --name <n> --content <file> [--rationale <text>]
  flow skill patch   --name <n> --content <file> [--rationale <text>]
  flow skill remove  --name <n> [--rationale <text>]
  flow skill promote <name> [--id <proposalId>]
  flow skill reject  <name> [--id <proposalId>]
  flow skill archive <name>
  flow skill pending [--json]

Actions:
  propose     Stage a new skill. Writes content to .claude/skills/pending/<n>.md
  patch       Stage an edit to an existing skill.
  remove      Stage a removal of an existing skill.
  promote     Apply a pending proposal (user-only). Moves pending → active,
              applies patch, or archives as appropriate.
  reject      Discard a pending proposal; cleans up staged content.
  archive     Direct archival of an active skill (no staging).
  pending     List pending proposals. --json for machine-readable output.

Examples:
  flow skill propose --name react-hooks --content scratch/draft.md \\
                     --rationale "capture hook patterns from recent session"
  flow skill patch   --name react-hooks --content scratch/updated.md
  flow skill remove  --name outdated-skill --rationale "superseded by newer skill"
  flow skill promote react-hooks
  flow skill reject  react-hooks
`);
}

function printPending(list, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    return;
  }
  if (list.length === 0) {
    info('No pending skill proposals.');
    return;
  }
  console.log(`${colors.cyan}Pending skill proposals (${list.length}):${colors.reset}\n`);
  for (const p of list) {
    const icon = p.action === 'propose' ? '+' : p.action === 'patch' ? '~' : '-';
    console.log(`  ${colors.bold}${icon} ${p.skillName}${colors.reset} ${colors.dim}(${p.action}, ${p.id})${colors.reset}`);
    console.log(`    proposedAt: ${p.proposedAt}  by: ${p.proposedBy}`);
    if (p.contentPath) console.log(`    content:    ${p.contentPath}`);
    if (p.rationale) console.log(`    rationale:  ${p.rationale}`);
    console.log('');
  }
}

// ============================================================
// Subcommand handlers
// ============================================================

function runPropose(flags) {
  const record = store.createProposal({
    action: 'propose',
    skillName: flags.name,
    contentFile: flags.content,
    rationale: flags.rationale,
    proposedBy: flags.proposedBy,
  });
  success(`Staged propose '${record.skillName}' (${record.id})`);
  console.log(`  content: ${record.contentPath}`);
  console.log(`  review with: flow skill pending`);
  return 0;
}

function runPatch(flags) {
  const record = store.createProposal({
    action: 'patch',
    skillName: flags.name,
    contentFile: flags.content,
    rationale: flags.rationale,
    proposedBy: flags.proposedBy,
  });
  success(`Staged patch '${record.skillName}' (${record.id})`);
  console.log(`  content: ${record.contentPath}`);
  warn('  Patch applies as a full replacement until F3 fuzzy-match lands (wf-9a969442).');
  return 0;
}

function runRemove(flags) {
  const record = store.createProposal({
    action: 'remove',
    skillName: flags.name,
    rationale: flags.rationale,
    proposedBy: flags.proposedBy,
  });
  success(`Staged remove '${record.skillName}' (${record.id})`);
  console.log(`  review with: flow skill pending`);
  return 0;
}

function runPromote(flags, positional) {
  const name = positional[0] || flags.name;
  const id = flags.id;
  if (!name && !id) throw new Error('promote requires a skill name or --id <proposalId>');
  const applied = store.promoteProposal({ skillName: name, id });
  success(`Promoted ${applied.action} '${applied.skillName}' (${applied.id})`);
  return 0;
}

function runReject(flags, positional) {
  const name = positional[0] || flags.name;
  const id = flags.id;
  if (!name && !id) throw new Error('reject requires a skill name or --id <proposalId>');
  const rejected = store.rejectProposal({ skillName: name, id });
  success(`Rejected ${rejected.action} '${rejected.skillName}' (${rejected.id})`);
  return 0;
}

function runArchive(_flags, positional) {
  const name = positional[0];
  if (!name) throw new Error('archive requires a skill name');
  const r = store.archiveSkill(name);
  success(`Archived '${r.skillName}' → ${r.archivedPath}`);
  return 0;
}

function runPending(flags) {
  const list = store.listProposals({ status: 'pending' });
  printPending(list, !!flags.json);
  return 0;
}

// ============================================================
// Main
// ============================================================

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const { subcommand, flags, positional } = parseArgs(argv);

  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  try {
    let code;
    switch (subcommand) {
      case 'propose':  code = runPropose(flags); break;
      case 'patch':    code = runPatch(flags); break;
      case 'remove':   code = runRemove(flags); break;
      case 'promote':  code = runPromote(flags, positional); break;
      case 'reject':   code = runReject(flags, positional); break;
      case 'archive':  code = runArchive(flags, positional); break;
      case 'pending':  code = runPending(flags); break;
      default:
        errorMsg(`Unknown subcommand: ${subcommand}`);
        showHelp();
        process.exit(1);
    }
    process.exit(code);
  } catch (err) {
    errorMsg(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, runPropose, runPatch, runRemove, runPromote, runReject, runArchive, runPending };
