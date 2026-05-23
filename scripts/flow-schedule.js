#!/usr/bin/env node

'use strict';

/**
 * Wogi Flow — `flow schedule` CLI (Phase 1A — wf-b211a076).
 *
 * Installs platform-native unit files that invoke `flow-scheduled-runner.js`
 * for users who prefer not to use GitHub Actions.
 *
 * Subcommands:
 *   flow schedule install --target=launchd|cron|systemd [--dry-run]
 *   flow schedule status
 *   flow schedule remove --target=launchd|cron|systemd
 *
 * Targets:
 *   launchd  — macOS user-domain LaunchAgent plists in ~/Library/LaunchAgents/
 *   cron     — crontab entries appended for the current user
 *   systemd  — systemd --user .service + .timer units in ~/.config/systemd/user/
 *
 * The same 4 jobs are installed regardless of target. Schedules:
 *   nightly-regression  03:00 daily
 *   weekly-audit        Mon  09:00
 *   weekly-digest       Fri  17:00
 *   per-pr-review       on-demand only (no schedule entry — invoked by gh webhook
 *                       or `flow scheduled-runner per-pr-review` manually)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JOB_NAMES } = require('../lib/scheduled-mode');

// ============================================================
// Schedule table — shared across all targets
// ============================================================

/**
 * Job schedule definitions.
 * - cronExpr is in classic 5-field cron format (UTC where the platform supports it).
 * - macOS launchd uses StartCalendarInterval (hour/minute/weekday fields).
 * - systemd uses OnCalendar with extended cron-like syntax.
 *
 * per-pr-review is intentionally omitted from schedules — it runs on PR events
 * (via the GH Actions workflow), or on demand via the CLI.
 */
const SCHEDULES = Object.freeze({
  'nightly-regression': {
    cronExpr: '0 3 * * *',
    launchd: { Hour: 3, Minute: 0 },
    systemdOnCalendar: '*-*-* 03:00:00',
  },
  'weekly-audit': {
    cronExpr: '0 9 * * 1',
    launchd: { Hour: 9, Minute: 0, Weekday: 1 },
    systemdOnCalendar: 'Mon *-*-* 09:00:00',
  },
  'weekly-digest': {
    cronExpr: '0 17 * * 5',
    launchd: { Hour: 17, Minute: 0, Weekday: 5 },
    systemdOnCalendar: 'Fri *-*-* 17:00:00',
  },
});

const SCHEDULED_JOB_NAMES = Object.keys(SCHEDULES);

const ALLOWED_TARGETS = new Set(['launchd', 'cron', 'systemd']);

// ============================================================
// Path helpers
// ============================================================

function repoRoot() {
  // Best-effort: walk up looking for package.json with name "wogiflow"
  let dir = process.cwd();
  for (let i = 0; i < 25; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const data = fs.readFileSync(pkg, 'utf-8');
        if (data.includes('"wogiflow"') || data.includes('wogi-flow')) return dir;
      } catch (_err) { /* */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function runnerScriptPath() {
  return path.join(repoRoot(), 'scripts', 'flow-scheduled-runner.js');
}

function nodeBinary() {
  return process.execPath; // canonical, absolute
}

// ============================================================
// Unit content generators (pure — no I/O)
// ============================================================

// F8 (R-379): paths that get inlined into shell-interpreted contexts
// (crontab lines, systemd ExecStart) MUST be single-quoted with embedded
// single-quotes escaped. Without this, a project at `/Users/Alice Smith/...`
// breaks the schedule because cron treats the space as an argument boundary.
function shellQuote(s) {
  // POSIX single-quote escape: replace each ' with '\''
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function generateCrontabLines(opts = {}) {
  const node = opts.node || nodeBinary();
  const runner = opts.runner || runnerScriptPath();
  const projectRoot = opts.projectRoot || repoRoot();
  const lines = [
    `# === wogi-scheduled (managed by flow schedule) — DO NOT EDIT BELOW ===`,
  ];
  for (const jobName of SCHEDULED_JOB_NAMES) {
    const spec = SCHEDULES[jobName];
    const logPath = path.join(projectRoot, '.workflow', 'scratch', `scheduled-${jobName}.log`);
    lines.push(
      `${spec.cronExpr} cd ${shellQuote(projectRoot)} && ` +
      `${shellQuote(node)} ${shellQuote(runner)} ${jobName} ` +
      `>> ${shellQuote(logPath)} 2>&1`
    );
  }
  lines.push(`# === wogi-scheduled end ===`);
  return lines;
}

function generateLaunchdPlist(jobName, opts = {}) {
  const node = opts.node || nodeBinary();
  const runner = opts.runner || runnerScriptPath();
  const projectRoot = opts.projectRoot || repoRoot();
  const spec = SCHEDULES[jobName];
  if (!spec) throw new Error(`No schedule defined for "${jobName}"`);

  const calBlock = [
    `        <key>Hour</key>`,
    `        <integer>${spec.launchd.Hour}</integer>`,
    `        <key>Minute</key>`,
    `        <integer>${spec.launchd.Minute}</integer>`,
  ];
  if (typeof spec.launchd.Weekday === 'number') {
    calBlock.push(`        <key>Weekday</key>`);
    calBlock.push(`        <integer>${spec.launchd.Weekday}</integer>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>io.wogi.scheduled.${jobName}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${node}</string>
      <string>${runner}</string>
      <string>${jobName}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectRoot}</string>
    <key>StandardOutPath</key>
    <string>${path.join(projectRoot, '.workflow', 'scratch', `scheduled-${jobName}.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(projectRoot, '.workflow', 'scratch', `scheduled-${jobName}.err.log`)}</string>
    <key>StartCalendarInterval</key>
    <dict>
${calBlock.join('\n')}
    </dict>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
`;
}

function generateSystemdServiceUnit(jobName, opts = {}) {
  const node = opts.node || nodeBinary();
  const runner = opts.runner || runnerScriptPath();
  const projectRoot = opts.projectRoot || repoRoot();
  if (!SCHEDULES[jobName]) throw new Error(`No schedule defined for "${jobName}"`);

  // F8 (R-379): systemd ExecStart with a path containing spaces needs each
  // arg surrounded by quotes — systemd's argument parser splits on spaces.
  // WorkingDirectory and Standard{Output,Error} accept literal paths (no
  // splitting), but quoting them too is harmless and consistent.
  return `[Unit]
Description=Wogi Flow scheduled job: ${jobName}
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory="${projectRoot}"
ExecStart="${node}" "${runner}" "${jobName}"
StandardOutput=append:${path.join(projectRoot, '.workflow', 'scratch', `scheduled-${jobName}.log`)}
StandardError=append:${path.join(projectRoot, '.workflow', 'scratch', `scheduled-${jobName}.err.log`)}
`;
}

function generateSystemdTimerUnit(jobName) {
  const spec = SCHEDULES[jobName];
  if (!spec) throw new Error(`No schedule defined for "${jobName}"`);
  return `[Unit]
Description=Wogi Flow scheduled timer: ${jobName}

[Timer]
OnCalendar=${spec.systemdOnCalendar}
Persistent=true
Unit=wogi-scheduled-${jobName}.service

[Install]
WantedBy=timers.target
`;
}

// ============================================================
// Install / remove / status (with FS injection for tests)
// ============================================================

function installLaunchd(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const dir = path.join(homeDir, 'Library', 'LaunchAgents');
  const dryRun = Boolean(opts.dryRun);
  const written = [];

  for (const jobName of SCHEDULED_JOB_NAMES) {
    const filename = `io.wogi.scheduled.${jobName}.plist`;
    const dest = path.join(dir, filename);
    const content = generateLaunchdPlist(jobName, opts);
    if (!dryRun) {
      fsx.mkdirSync(dir, { recursive: true });
      fsx.writeFileSync(dest, content);
    }
    written.push({ path: dest, jobName, content });
  }
  return { target: 'launchd', dryRun, written };
}

function installCron(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const fragmentPath = opts.fragmentPath ||
    path.join(homeDir, '.config', 'wogi-flow', 'crontab-fragment');
  const dryRun = Boolean(opts.dryRun);
  const lines = generateCrontabLines(opts);
  const content = lines.join('\n') + '\n';

  if (!dryRun) {
    fsx.mkdirSync(path.dirname(fragmentPath), { recursive: true });
    fsx.writeFileSync(fragmentPath, content);
  }

  return {
    target: 'cron',
    dryRun,
    written: [{ path: fragmentPath, content }],
    note:
      `Crontab fragment written. Activate with:\n` +
      `    (crontab -l 2>/dev/null; cat ${fragmentPath}) | crontab -\n` +
      `Idempotency: re-running install OVERWRITES the fragment but does NOT auto-install ` +
      `into crontab — the user runs the command above.`,
  };
}

function installSystemd(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const dir = path.join(homeDir, '.config', 'systemd', 'user');
  const dryRun = Boolean(opts.dryRun);
  const written = [];

  for (const jobName of SCHEDULED_JOB_NAMES) {
    const serviceUnit = generateSystemdServiceUnit(jobName, opts);
    const timerUnit = generateSystemdTimerUnit(jobName);
    const servicePath = path.join(dir, `wogi-scheduled-${jobName}.service`);
    const timerPath = path.join(dir, `wogi-scheduled-${jobName}.timer`);
    if (!dryRun) {
      fsx.mkdirSync(dir, { recursive: true });
      fsx.writeFileSync(servicePath, serviceUnit);
      fsx.writeFileSync(timerPath, timerUnit);
    }
    written.push({ path: servicePath, jobName, content: serviceUnit });
    written.push({ path: timerPath, jobName, content: timerUnit });
  }
  return {
    target: 'systemd',
    dryRun,
    written,
    note:
      `Activate with:\n` +
      SCHEDULED_JOB_NAMES.map(
        (j) => `    systemctl --user enable --now wogi-scheduled-${j}.timer`
      ).join('\n'),
  };
}

function removeLaunchd(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const dir = path.join(homeDir, 'Library', 'LaunchAgents');
  const removed = [];
  for (const jobName of SCHEDULED_JOB_NAMES) {
    const dest = path.join(dir, `io.wogi.scheduled.${jobName}.plist`);
    try {
      if (fsx.existsSync(dest)) {
        fsx.unlinkSync(dest);
        removed.push(dest);
      }
    } catch (_err) { /* fail-open */ }
  }
  return { target: 'launchd', removed };
}

function removeCron(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const fragmentPath = opts.fragmentPath ||
    path.join(homeDir, '.config', 'wogi-flow', 'crontab-fragment');
  const removed = [];
  try {
    if (fsx.existsSync(fragmentPath)) {
      fsx.unlinkSync(fragmentPath);
      removed.push(fragmentPath);
    }
  } catch (_err) { /* */ }
  return {
    target: 'cron',
    removed,
    note:
      `Fragment file removed. Manually purge the lines between the\n` +
      `'# === wogi-scheduled ...' markers from your active crontab with:\n` +
      `    crontab -e`,
  };
}

function removeSystemd(opts = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = opts.homeDir || os.homedir();
  const dir = path.join(homeDir, '.config', 'systemd', 'user');
  const removed = [];
  for (const jobName of SCHEDULED_JOB_NAMES) {
    for (const ext of ['service', 'timer']) {
      const dest = path.join(dir, `wogi-scheduled-${jobName}.${ext}`);
      try {
        if (fsx.existsSync(dest)) {
          fsx.unlinkSync(dest);
          removed.push(dest);
        }
      } catch (_err) { /* */ }
    }
  }
  return { target: 'systemd', removed };
}

// ============================================================
// Status — list what is currently installed
// ============================================================

function getStatus(deps = {}) {
  const fsx = deps.fs || fs;
  const homeDir = deps.homeDir || os.homedir();
  const status = { launchd: [], cron: [], systemd: [] };

  // launchd
  const ldir = path.join(homeDir, 'Library', 'LaunchAgents');
  for (const jobName of SCHEDULED_JOB_NAMES) {
    const p = path.join(ldir, `io.wogi.scheduled.${jobName}.plist`);
    if (fsx.existsSync(p)) status.launchd.push(p);
  }

  // cron
  const cfrag = path.join(homeDir, '.config', 'wogi-flow', 'crontab-fragment');
  if (fsx.existsSync(cfrag)) status.cron.push(cfrag);

  // systemd — both .service and .timer files are tracked under the same key.
  // F21 (R-379): the prior ternary `ext === 'timer' ? 'systemd' : 'systemd'`
  // had identical branches — a meaningless conditional. Just push directly.
  const sdir = path.join(homeDir, '.config', 'systemd', 'user');
  for (const jobName of SCHEDULED_JOB_NAMES) {
    for (const ext of ['service', 'timer']) {
      const p = path.join(sdir, `wogi-scheduled-${jobName}.${ext}`);
      if (fsx.existsSync(p)) status.systemd.push(p);
    }
  }
  return status;
}

// ============================================================
// CLI dispatch
// ============================================================

function parseCliArgs(argv) {
  const args = { subcommand: argv[0] || null, target: null, dryRun: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--target=')) args.target = a.slice('--target='.length);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function dispatch(argv, deps = {}) {
  const args = parseCliArgs(argv);

  if (!args.subcommand || args.subcommand === '--help' || args.subcommand === '-h') {
    return { ok: true, output: helpText() };
  }

  if (args.subcommand === 'status') {
    const status = getStatus(deps);
    return { ok: true, output: JSON.stringify(status, null, 2), status };
  }

  if (args.subcommand === 'install' || args.subcommand === 'remove') {
    if (!ALLOWED_TARGETS.has(args.target)) {
      return {
        ok: false,
        output:
          `Error: --target=<launchd|cron|systemd> is required\n\n${helpText()}`,
      };
    }
    const op = args.subcommand === 'install' ? installFor(args.target) : removeFor(args.target);
    const opOpts = { dryRun: args.dryRun };
    if (deps.homeDir) opOpts.homeDir = deps.homeDir;
    const result = op(opOpts, deps);
    return { ok: true, output: JSON.stringify(result, null, 2), result };
  }

  return { ok: false, output: `Unknown subcommand: ${args.subcommand}\n\n${helpText()}` };
}

function installFor(target) {
  return ({ launchd: installLaunchd, cron: installCron, systemd: installSystemd })[target];
}

function removeFor(target) {
  return ({ launchd: removeLaunchd, cron: removeCron, systemd: removeSystemd })[target];
}

function helpText() {
  return `flow schedule — install platform-native scheduled-mode units

Subcommands:
  install --target=<launchd|cron|systemd> [--dry-run]
  remove  --target=<launchd|cron|systemd>
  status

Jobs installed: ${SCHEDULED_JOB_NAMES.join(', ')}
(per-pr-review runs via GH Actions / on-demand only, no schedule entry.)
`;
}

// ============================================================
// Exports + CLI
// ============================================================

module.exports = {
  SCHEDULES,
  SCHEDULED_JOB_NAMES,
  ALLOWED_TARGETS,
  generateCrontabLines,
  generateLaunchdPlist,
  generateSystemdServiceUnit,
  generateSystemdTimerUnit,
  installLaunchd,
  installCron,
  installSystemd,
  removeLaunchd,
  removeCron,
  removeSystemd,
  getStatus,
  dispatch,
  parseCliArgs,
  // Re-export for convenience to consumers
  JOB_NAMES,
};

if (require.main === module) {
  const result = dispatch(process.argv.slice(2));
  if (result.output) console.log(result.output);
  process.exit(result.ok ? 0 : 1);
}
