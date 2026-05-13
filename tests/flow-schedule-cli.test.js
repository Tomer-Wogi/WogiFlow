'use strict';

/**
 * Tests for scripts/flow-schedule.js (Phase 1A — wf-b211a076).
 *
 * Coverage:
 *   - parseCliArgs (subcommand + flags)
 *   - generateCrontabLines (correct cron expressions, all scheduled jobs included)
 *   - generateLaunchdPlist (XML structure, StartCalendarInterval keys)
 *   - generateSystemdServiceUnit + Timer (correct OnCalendar expressions)
 *   - installLaunchd / installCron / installSystemd dry-run paths
 *   - removeLaunchd / removeCron / removeSystemd
 *   - getStatus
 *   - dispatch() error paths
 *
 * Run: NODE_ENV=test node --test tests/flow-schedule-cli.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const sched = require('../scripts/flow-schedule');

// ============================================================
// parseCliArgs
// ============================================================

describe('parseCliArgs', () => {
  it('extracts subcommand, target, and dry-run flag', () => {
    const a = sched.parseCliArgs(['install', '--target=launchd', '--dry-run']);
    assert.equal(a.subcommand, 'install');
    assert.equal(a.target, 'launchd');
    assert.equal(a.dryRun, true);
  });
  it('handles bare subcommands', () => {
    const a = sched.parseCliArgs(['status']);
    assert.equal(a.subcommand, 'status');
    assert.equal(a.target, null);
    assert.equal(a.dryRun, false);
  });
});

// ============================================================
// Crontab generation
// ============================================================

describe('generateCrontabLines', () => {
  const lines = sched.generateCrontabLines({
    node: '/usr/bin/node',
    runner: '/tmp/runner.js',
    projectRoot: '/tmp/proj',
  });
  it('includes the managed-block sentinels', () => {
    assert.match(lines[0], /wogi-scheduled \(managed by flow schedule\)/);
    assert.match(lines[lines.length - 1], /wogi-scheduled end/);
  });
  it('has correct cron expressions for all scheduled jobs', () => {
    const joined = lines.join('\n');
    assert.match(joined, /^0 3 \* \* \* /m, 'nightly cron');
    assert.match(joined, /^0 9 \* \* 1 /m, 'monday audit cron');
    assert.match(joined, /^0 17 \* \* 5 /m, 'friday digest cron');
  });
  it('does NOT include per-pr-review (PR jobs are not cron-scheduled)', () => {
    const joined = lines.join('\n');
    assert.equal(/per-pr-review/.test(joined), false);
  });
  it('uses the resolved node + runner paths', () => {
    const joined = lines.join('\n');
    assert.match(joined, /\/usr\/bin\/node/);
    assert.match(joined, /\/tmp\/runner\.js/);
  });
});

// ============================================================
// launchd plist generation
// ============================================================

describe('generateLaunchdPlist', () => {
  it('produces valid XML structure for nightly-regression', () => {
    const xml = sched.generateLaunchdPlist('nightly-regression', {
      node: '/usr/bin/node',
      runner: '/tmp/runner.js',
      projectRoot: '/tmp/proj',
    });
    assert.match(xml, /<\?xml version/);
    assert.match(xml, /<plist version="1.0">/);
    assert.match(xml, /<key>Label<\/key>/);
    assert.match(xml, /io\.wogi\.scheduled\.nightly-regression/);
    assert.match(xml, /<key>StartCalendarInterval<\/key>/);
    assert.match(xml, /<integer>3<\/integer>/); // hour
    // Daily — no Weekday key
    assert.equal(/Weekday/.test(xml), false);
  });
  it('includes Weekday for weekly jobs', () => {
    const audit = sched.generateLaunchdPlist('weekly-audit', { projectRoot: '/tmp/proj' });
    assert.match(audit, /<key>Weekday<\/key>/);
    assert.match(audit, /<integer>1<\/integer>/);
    const digest = sched.generateLaunchdPlist('weekly-digest', { projectRoot: '/tmp/proj' });
    assert.match(digest, /<integer>5<\/integer>/);
  });
  it('throws on unknown job', () => {
    assert.throws(() => sched.generateLaunchdPlist('bogus', {}));
  });
});

// ============================================================
// systemd unit generation
// ============================================================

describe('generateSystemdServiceUnit + Timer', () => {
  it('service unit references the runner with the right job name', () => {
    const s = sched.generateSystemdServiceUnit('weekly-audit', {
      node: '/usr/bin/node',
      runner: '/tmp/runner.js',
      projectRoot: '/tmp/proj',
    });
    assert.match(s, /ExecStart=\/usr\/bin\/node \/tmp\/runner\.js weekly-audit/);
    assert.match(s, /Description=Wogi Flow scheduled job: weekly-audit/);
  });
  it('timer unit has correct OnCalendar for monday audit', () => {
    const t = sched.generateSystemdTimerUnit('weekly-audit');
    assert.match(t, /OnCalendar=Mon \*-\*-\* 09:00:00/);
    assert.match(t, /Unit=wogi-scheduled-weekly-audit\.service/);
  });
  it('nightly timer is daily', () => {
    const t = sched.generateSystemdTimerUnit('nightly-regression');
    assert.match(t, /OnCalendar=\*-\*-\* 03:00:00/);
  });
});

// ============================================================
// install* — dry-run path with injected fs
// ============================================================

function mockFs() {
  const written = {};
  return {
    written,
    fs: {
      existsSync: (p) => Object.prototype.hasOwnProperty.call(written, p),
      mkdirSync: () => {},
      writeFileSync: (p, content) => { written[p] = content; },
      unlinkSync: (p) => { delete written[p]; },
    },
  };
}

describe('installLaunchd', () => {
  it('writes 3 plists into ~/Library/LaunchAgents', () => {
    const m = mockFs();
    const r = sched.installLaunchd({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.target, 'launchd');
    assert.equal(r.written.length, 3); // 3 scheduled jobs
    const paths = Object.keys(m.written);
    assert.ok(paths.some((p) => p.endsWith('io.wogi.scheduled.nightly-regression.plist')));
    assert.ok(paths.some((p) => p.endsWith('io.wogi.scheduled.weekly-audit.plist')));
    assert.ok(paths.some((p) => p.endsWith('io.wogi.scheduled.weekly-digest.plist')));
    for (const p of paths) assert.match(p, /Library\/LaunchAgents/);
  });
  it('dry-run does not write', () => {
    const m = mockFs();
    const r = sched.installLaunchd({ homeDir: '/Users/test', dryRun: true }, { fs: m.fs });
    assert.equal(r.dryRun, true);
    assert.equal(Object.keys(m.written).length, 0);
  });
});

describe('installCron', () => {
  it('writes a fragment file under ~/.config/wogi-flow/', () => {
    const m = mockFs();
    const r = sched.installCron({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.target, 'cron');
    assert.equal(r.written.length, 1);
    const filename = Object.keys(m.written)[0];
    assert.match(filename, /\.config\/wogi-flow\/crontab-fragment/);
    assert.match(m.written[filename], /wogi-scheduled \(managed/);
  });
});

describe('installSystemd', () => {
  it('writes 6 files (.service + .timer × 3 jobs) under ~/.config/systemd/user/', () => {
    const m = mockFs();
    const r = sched.installSystemd({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.target, 'systemd');
    assert.equal(r.written.length, 6);
    const paths = Object.keys(m.written);
    const services = paths.filter((p) => p.endsWith('.service'));
    const timers = paths.filter((p) => p.endsWith('.timer'));
    assert.equal(services.length, 3);
    assert.equal(timers.length, 3);
    for (const p of paths) assert.match(p, /systemd\/user/);
  });
});

// ============================================================
// remove* — round-trip
// ============================================================

describe('remove*', () => {
  it('removeLaunchd removes only the installed plists it finds', () => {
    const m = mockFs();
    sched.installLaunchd({ homeDir: '/Users/test' }, { fs: m.fs });
    const before = Object.keys(m.written).length;
    assert.equal(before, 3);
    const r = sched.removeLaunchd({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.removed.length, 3);
    assert.equal(Object.keys(m.written).length, 0);
  });
  it('removeCron removes the fragment when present', () => {
    const m = mockFs();
    sched.installCron({ homeDir: '/Users/test' }, { fs: m.fs });
    const r = sched.removeCron({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.removed.length, 1);
  });
  it('removeSystemd removes all 6 units', () => {
    const m = mockFs();
    sched.installSystemd({ homeDir: '/Users/test' }, { fs: m.fs });
    const r = sched.removeSystemd({ homeDir: '/Users/test' }, { fs: m.fs });
    assert.equal(r.removed.length, 6);
  });
});

// ============================================================
// getStatus
// ============================================================

describe('getStatus', () => {
  it('returns empty arrays when nothing installed (real FS, isolated home)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sched-status-'));
    try {
      const s = sched.getStatus({ homeDir: tmp });
      assert.deepEqual(s.launchd, []);
      assert.deepEqual(s.cron, []);
      assert.deepEqual(s.systemd, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('reports installed launchd plists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sched-status-'));
    try {
      const dir = path.join(tmp, 'Library', 'LaunchAgents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'io.wogi.scheduled.weekly-audit.plist'), '<plist/>');
      const s = sched.getStatus({ homeDir: tmp });
      assert.equal(s.launchd.length, 1);
      assert.match(s.launchd[0], /weekly-audit\.plist$/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ============================================================
// dispatch — error paths
// ============================================================

describe('dispatch', () => {
  it('returns help text when no subcommand', () => {
    const r = sched.dispatch([]);
    assert.equal(r.ok, true);
    assert.match(r.output, /flow schedule/);
  });
  it('returns error when --target missing on install', () => {
    const r = sched.dispatch(['install']);
    assert.equal(r.ok, false);
    assert.match(r.output, /--target/);
  });
  it('rejects bad target value', () => {
    const r = sched.dispatch(['install', '--target=skynet']);
    assert.equal(r.ok, false);
  });
  it('status returns JSON', () => {
    // Use a fresh deps to avoid contaminating user's home dir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sched-disp-'));
    try {
      const r = sched.dispatch(['status'], { homeDir: tmp });
      assert.equal(r.ok, true);
      // We can't pass deps via dispatch — but the call should still work
      // against the real home. We just assert the output is valid JSON.
      const parsed = JSON.parse(r.output);
      assert.ok('launchd' in parsed);
      assert.ok('cron' in parsed);
      assert.ok('systemd' in parsed);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ============================================================
// install dispatch with dry-run produces output without side effects
// ============================================================

describe('dispatch install --dry-run', () => {
  it('returns a result object for each target', () => {
    for (const target of ['launchd', 'cron', 'systemd']) {
      const r = sched.dispatch(['install', `--target=${target}`, '--dry-run']);
      assert.equal(r.ok, true, `dispatch for ${target} should succeed`);
      const parsed = JSON.parse(r.output);
      assert.equal(parsed.target, target);
      assert.equal(parsed.dryRun, true);
    }
  });
});
