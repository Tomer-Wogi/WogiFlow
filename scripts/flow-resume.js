#!/usr/bin/env node

/**
 * Wogi Flow - Resume Command
 *
 * Resume a suspended task.
 *
 * Usage:
 *   flow resume                    # Resume if condition met
 *   flow resume --force            # Force resume regardless
 *   flow resume --approve          # Approve human review
 *   flow resume --status           # Check suspension status
 */

const {
  loadDurableSession,
  getSuspensionStatus,
  checkResumeCondition,
  resumeSession,
  canResumeFromStep,
  getRemainingSteps,
  isSuspended,
  RESUME_CONDITION
} = require('./flow-durable-session');
const { color, getConfig } = require('./flow-utils');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    force: false,
    approve: false,
    status: false,
    approvedBy: 'user'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--force':
      case '-f':
        options.force = true;
        break;

      case '--approve':
      case '-a':
        options.approve = true;
        break;

      case '--approved-by':
        options.approvedBy = nextArg;
        i++;
        break;

      case '--status':
      case '-s':
        options.status = true;
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
Wogi Flow - Resume Command

Resume a suspended task.

Usage:
  flow resume [options]

Options:
  --force, -f             Force resume regardless of conditions
  --approve, -a           Approve human review condition
  --approved-by <name>    Specify who approved (for audit)
  --status, -s            Show suspension status only
  --help, -h              Show this help

Examples:
  flow resume                    # Resume if condition met
  flow resume --status           # Check current status
  flow resume --approve          # Approve pending review
  flow resume --force            # Override and resume
`);
}

function showStatus() {
  const session = loadDurableSession();
  if (!session) {
    console.log(color('yellow', 'No active task session.'));
    return;
  }

  console.log('');
  console.log(color('cyan', '📊 Task Session Status'));
  console.log(color('cyan', '─'.repeat(50)));
  console.log(`Task: ${session.taskId}`);
  console.log(`Type: ${session.taskType}`);
  console.log(`Started: ${session.startedAt}`);
  console.log('');

  if (!isSuspended()) {
    console.log(color('green', '▶️  Status: ACTIVE'));
    const resumeInfo = canResumeFromStep(session);
    if (resumeInfo.canResume) {
      console.log(`Progress: ${resumeInfo.completedCount}/${resumeInfo.totalSteps} steps`);
      console.log(`Next step: ${resumeInfo.fromStep?.description?.substring(0, 60) || resumeInfo.fromStep?.id}...`);
    }
  } else {
    const status = getSuspensionStatus();
    console.log(color('yellow', '⏸️  Status: SUSPENDED'));
    console.log('');
    console.log(`Type: ${status.type}`);
    console.log(`Reason: ${status.reason}`);
    console.log(`Since: ${status.suspendedAt}`);

    if (status.suspendedAtStep) {
      console.log(`At step: ${status.suspendedAtStep}`);
    }

    console.log('');
    console.log(color('cyan', '📋 Resume Condition:'));

    const conditionCheck = checkResumeCondition(session.suspension);

    if (conditionCheck.canResume) {
      console.log(color('green', `  ✓ Condition met: ${conditionCheck.reason}`));
      console.log('');
      console.log(`Run ${color('cyan', 'flow resume')} to continue.`);
    } else {
      console.log(color('red', `  ✗ Waiting: ${conditionCheck.reason}`));

      // Show specific waiting info
      switch (session.suspension?.resumeCondition?.type) {
        case RESUME_CONDITION.TIME:
          console.log(`  Resume at: ${conditionCheck.resumeAt}`);
          if (conditionCheck.remainingSeconds) {
            const mins = Math.floor(conditionCheck.remainingSeconds / 60);
            const secs = conditionCheck.remainingSeconds % 60;
            console.log(`  Remaining: ${mins}m ${secs}s`);
          }
          break;

        case RESUME_CONDITION.POLL:
          console.log(`  Expected: ${conditionCheck.expectedValue}`);
          console.log(`  Current: ${conditionCheck.currentValue || 'N/A'}`);
          break;

        case RESUME_CONDITION.MANUAL:
          console.log(`  Approval needed: ${session.suspension.resumeCondition.manual.prompt}`);
          console.log('');
          console.log(`  Run ${color('cyan', 'flow resume --approve')} to approve.`);
          break;

        case RESUME_CONDITION.FILE:
          console.log(`  Watching: ${session.suspension.resumeCondition.file.watchPath}`);
          break;
      }

      console.log('');
      console.log(`To force resume: ${color('cyan', 'flow resume --force')}`);
    }
  }

  console.log(color('cyan', '─'.repeat(50)));
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

  const options = parseArgs();

  // Status only?
  if (options.status) {
    showStatus();
    process.exit(0);
  }

  // Check for active session
  const session = loadDurableSession();
  if (!session) {
    console.log(color('red', 'No active task session.'));
    process.exit(1);
  }

  // Check suspension state from loaded session (avoids race condition from re-reading)
  if (!session.suspension) {
    console.log(color('green', 'Task is not suspended. Continue working!'));
    const resumeInfo = canResumeFromStep(session);
    if (resumeInfo.canResume && resumeInfo.fromStep) {
      console.log('');
      console.log(`Next step: ${resumeInfo.fromStep.description?.substring(0, 80) || resumeInfo.fromStep.id}`);
    }
    process.exit(0);
  }

  // Try to resume (resumeSession re-loads session internally for atomicity)
  const result = resumeSession({
    force: options.force,
    approve: options.approve,
    approvedBy: options.approvedBy
  });

  // Check result
  if (result.error) {
    console.log('');
    console.log(color('red', '⚠️  Cannot Resume Yet'));
    console.log(color('red', '─'.repeat(50)));
    console.log(`Reason: ${result.reason}`);

    // Show helpful info based on condition type
    const status = getSuspensionStatus();
    switch (result.reason) {
      case 'waiting-for-time':
        console.log(`Resume at: ${result.resumeAt}`);
        if (result.remainingSeconds) {
          const mins = Math.floor(result.remainingSeconds / 60);
          const secs = result.remainingSeconds % 60;
          console.log(`Remaining: ${mins}m ${secs}s`);
        }
        break;

      case 'poll-condition-not-met':
        console.log(`Expected: ${result.expectedValue}`);
        console.log(`Current: ${result.currentValue}`);
        break;

      case 'awaiting-approval':
        console.log(`Approval needed: ${result.prompt}`);
        console.log('');
        console.log(`Run ${color('cyan', 'flow resume --approve')} to approve.`);
        break;

      case 'file-not-found':
        console.log(`Waiting for: ${result.watchPath}`);
        break;
    }

    console.log('');
    console.log(`To force resume: ${color('cyan', 'flow resume --force')}`);
    console.log(color('red', '─'.repeat(50)));
    process.exit(1);
  }

  // Success!
  console.log('');
  console.log(color('green', '▶️  Task Resumed'));
  console.log(color('green', '─'.repeat(50)));
  console.log(`Task: ${session.taskId}`);

  // Show remaining work (defensive null check for session)
  const remaining = result ? getRemainingSteps(result) : [];
  if (remaining.length > 0) {
    console.log('');
    console.log(`Remaining steps: ${remaining.length}`);
    console.log(`Next: ${remaining[0].description?.substring(0, 60) || remaining[0].id}...`);
  }

  console.log('');
  console.log(color('green', '─'.repeat(50)));
}

main();
