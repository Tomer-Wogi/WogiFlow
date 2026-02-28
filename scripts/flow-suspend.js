#!/usr/bin/env node

/**
 * Wogi Flow - Suspend Command
 *
 * Suspend the current task with a resume condition.
 *
 * Usage:
 *   flow suspend --wait-ci "gh run view 1234"      # Wait for CI/CD
 *   flow suspend --rate-limit 60                    # Wait N seconds
 *   flow suspend --review "Check PR #456"           # Wait for human review
 *   flow suspend --wait-file "deploy-ready.json"   # Wait for file
 *   flow suspend --schedule "2024-01-06T09:00:00"  # Wait until time
 */

const {
  loadDurableSession,
  suspendSession,
  isSuspended,
  getSuspensionStatus,
  SUSPENSION_TYPE,
  RESUME_CONDITION
} = require('./flow-durable-session');
const { color, getConfig } = require('./flow-utils');
const { validateCommand } = require('./flow-workflow');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    type: null,
    reason: null,
    resumeCondition: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--wait-ci':
      case '-c':
        // SECURITY: Validate command before storing
        if (nextArg) {
          const validation = validateCommand(nextArg);
          if (validation.blocked) {
            console.error(color('red', `Error: Unsafe command rejected - ${validation.reason}`));
            process.exit(1);
          }
        }
        options.type = SUSPENSION_TYPE.CI_CD;
        options.reason = `Waiting for CI/CD: ${nextArg}`;
        options.resumeCondition = {
          type: RESUME_CONDITION.POLL,
          poll: {
            command: nextArg,
            expectedValue: 'completed',
            intervalSeconds: 60,
            maxAttempts: 120
          }
        };
        i++;
        break;

      case '--rate-limit':
      case '-r':
        const seconds = parseInt(nextArg, 10);
        options.type = SUSPENSION_TYPE.RATE_LIMIT;
        options.reason = `Rate limited for ${seconds} seconds`;
        const resumeTime = new Date(Date.now() + seconds * 1000).toISOString();
        options.resumeCondition = {
          type: RESUME_CONDITION.TIME,
          time: { resumeAfter: resumeTime }
        };
        i++;
        break;

      case '--review':
      case '-R':
        options.type = SUSPENSION_TYPE.HUMAN_REVIEW;
        options.reason = `Awaiting human review: ${nextArg}`;
        options.resumeCondition = {
          type: RESUME_CONDITION.MANUAL,
          manual: { prompt: nextArg }
        };
        i++;
        break;

      case '--wait-file':
      case '-f':
        options.type = SUSPENSION_TYPE.EXTERNAL_EVENT;
        options.reason = `Waiting for file: ${nextArg}`;
        options.resumeCondition = {
          type: RESUME_CONDITION.FILE,
          file: { watchPath: nextArg }
        };
        i++;
        break;

      case '--schedule':
      case '-s':
        options.type = SUSPENSION_TYPE.SCHEDULED;
        options.reason = `Scheduled resume at: ${nextArg}`;
        options.resumeCondition = {
          type: RESUME_CONDITION.TIME,
          time: { resumeAfter: new Date(nextArg).toISOString() }
        };
        i++;
        break;

      case '--long-running':
      case '-l':
        options.type = SUSPENSION_TYPE.LONG_RUNNING;
        options.reason = `Long-running task: ${nextArg || 'Manual progress tracking'}`;
        options.resumeCondition = {
          type: RESUME_CONDITION.MANUAL,
          manual: { prompt: nextArg || 'Continue when ready' }
        };
        if (nextArg && !nextArg.startsWith('-')) i++;
        break;

      case '--reason':
        options.reason = nextArg;
        i++;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Wogi Flow - Suspend Command

Suspend the current task with a resume condition.

Usage:
  flow suspend [options]

Options:
  --wait-ci, -c <command>    Wait for CI/CD (poll command until "completed")
  --rate-limit, -r <seconds> Wait for N seconds (rate limiting)
  --review, -R <message>     Wait for human review/approval
  --wait-file, -f <path>     Wait for file to exist
  --schedule, -s <datetime>  Wait until specific time (ISO 8601)
  --long-running, -l [msg]   Long-running task with manual progress
  --reason <text>            Custom reason message
  --help, -h                 Show this help

Examples:
  flow suspend --wait-ci "gh run view 1234 --json status -q '.status'"
  flow suspend --rate-limit 60
  flow suspend --review "Check PR #456 before continuing"
  flow suspend --wait-file ".workflow/state/deploy-ready.json"
  flow suspend --schedule "2024-01-06T09:00:00"
  flow suspend --long-running "Multi-day implementation"
`);
}

function main() {
  // Handle help first (before any other checks)
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const config = getConfig();

  // Check if durable steps are enabled
  if (config.durableSteps?.enabled === false) {
    console.log(color('red', 'Durable steps are disabled. Enable in config.json to use suspend/resume.'));
    process.exit(1);
  }

  // Check for active session
  const session = loadDurableSession();
  if (!session) {
    console.log(color('red', 'No active task session. Start a task first with /wogi-start.'));
    process.exit(1);
  }

  // Check if already suspended
  if (isSuspended()) {
    const status = getSuspensionStatus();
    console.log(color('yellow', 'Task is already suspended:'));
    console.log(`  Type: ${status.type}`);
    console.log(`  Reason: ${status.reason}`);
    console.log(`  Since: ${status.suspendedAt}`);
    console.log('');
    console.log(`Use ${color('cyan', 'flow resume')} to resume.`);
    process.exit(0);
  }

  // Parse arguments
  const options = parseArgs();

  if (!options.type) {
    console.log(color('red', 'Please specify a suspend type. Use --help for options.'));
    process.exit(1);
  }

  // Suspend the session
  const result = suspendSession({
    type: options.type,
    reason: options.reason,
    resumeCondition: options.resumeCondition
  });

  if (!result) {
    console.log(color('red', 'Failed to suspend session.'));
    process.exit(1);
  }

  // Display confirmation
  console.log('');
  console.log(color('yellow', '⏸️  Task Suspended'));
  console.log(color('yellow', '─'.repeat(50)));
  console.log(`Task: ${session.taskId}`);
  console.log(`Type: ${options.type}`);
  console.log(`Reason: ${options.reason}`);
  console.log('');

  // Show resume info
  switch (options.resumeCondition.type) {
    case RESUME_CONDITION.TIME:
      console.log(`Resume at: ${options.resumeCondition.time.resumeAfter}`);
      break;
    case RESUME_CONDITION.POLL:
      console.log(`Polling: ${options.resumeCondition.poll.command}`);
      console.log(`Expected: ${options.resumeCondition.poll.expectedValue}`);
      break;
    case RESUME_CONDITION.MANUAL:
      console.log(`Waiting for: ${options.resumeCondition.manual.prompt}`);
      break;
    case RESUME_CONDITION.FILE:
      console.log(`Watching: ${options.resumeCondition.file.watchPath}`);
      break;
  }

  console.log('');
  console.log(`To resume: ${color('cyan', 'flow resume')}`);
  console.log(`To force resume: ${color('cyan', 'flow resume --force')}`);
  console.log(color('yellow', '─'.repeat(50)));
}

main();
