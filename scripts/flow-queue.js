#!/usr/bin/env node

/**
 * Wogi Flow - Task Queue Management
 *
 * CLI for managing multi-task queues.
 * v2.1: Supports natural language parsing and automatic queue continuation.
 *
 * Commands:
 *   flow queue init <task-ids...>  - Initialize queue with task IDs
 *   flow queue status              - Show current queue status
 *   flow queue clear               - Clear the queue
 *   flow queue parse "<text>"      - Parse natural language for task IDs
 *   flow queue advance             - Manually advance to next task
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  color,
  error,
  getConfig
} = require('./flow-utils');

const {
  initTaskQueue,
  getQueueStatus,
  advanceTaskQueue,
  clearTaskQueue
} = require('./flow-durable-session');

/**
 * Parse natural language input for task IDs
 * Examples:
 *   "do story 1-3" → ["wf-001", "wf-002", "wf-003"]
 *   "wf-001, wf-002, wf-003" → ["wf-001", "wf-002", "wf-003"]
 *   "tasks 1, 2, 3" → gets from ready.json
 */
function parseNaturalLanguage(input) {
  const taskIds = [];

  // Try to extract wf-* task IDs directly
  const wfMatches = input.match(/wf-[a-f0-9]{8}(?:-\d{2})?/gi);
  if (wfMatches && wfMatches.length > 0) {
    return wfMatches.map(id => id.toLowerCase());
  }

  // Try range patterns like "1-3", "story 1-5"
  const rangeMatch = input.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const count = Math.min(end - start + 1, 10); // Max 10 tasks

    // Get tasks from ready.json
    return getTasksFromReady(count);
  }

  // Try patterns like "3 tasks", "these 5 stories"
  const countMatch = input.match(/(\d+)\s*(?:tasks?|stories?|features?)/i);
  if (countMatch) {
    const count = Math.min(parseInt(countMatch[1], 10), 10);
    return getTasksFromReady(count);
  }

  // Try comma-separated numbers
  const numbersMatch = input.match(/\d+(?:\s*,\s*\d+)+/);
  if (numbersMatch) {
    const numbers = numbersMatch[0].split(/\s*,\s*/).map(n => parseInt(n, 10));
    return getTasksFromReady(numbers.length);
  }

  // "all ready tasks"
  if (/all\s+(?:ready\s+)?tasks?/i.test(input)) {
    return getTasksFromReady(10); // Max 10
  }

  return taskIds;
}

/**
 * Get N tasks from ready.json sorted by priority
 */
function getTasksFromReady(count) {
  const readyPath = path.join(PATHS.state, 'ready.json');

  if (!fileExists(readyPath)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    const ready = data.ready || [];

    // Sort by priority (P0 first)
    const sorted = ready.sort((a, b) => {
      const priorityA = a.priority || 'P2';
      const priorityB = b.priority || 'P2';
      return priorityA.localeCompare(priorityB);
    });

    // Return requested count
    return sorted.slice(0, count).map(t => t.id);
  } catch (err) {
    console.error(error(`Failed to read ready.json: ${err.message}`));
    return [];
  }
}

/**
 * Show queue status
 */
function showStatus() {
  const status = getQueueStatus();

  console.log('');
  console.log(color('cyan', '📋 Task Queue Status'));
  console.log(color('cyan', '─'.repeat(50)));

  if (!status.enabled || status.tasks.length === 0) {
    console.log(color('dim', 'No active queue.'));
    console.log('');
    console.log('Initialize a queue with:');
    console.log('  flow queue init wf-001 wf-002 wf-003');
    console.log('  flow queue parse "do story 1-3"');
    return;
  }

  console.log(`Source: ${status.source || 'manual'}`);
  console.log(`Queued at: ${status.queuedAt || 'N/A'}`);
  console.log('');

  console.log(color('white', `Tasks (${status.currentIndex + 1}/${status.tasks.length}):`));

  status.tasks.forEach((taskId, i) => {
    const isCompleted = status.completedTasks.includes(taskId);
    const isCurrent = i === status.currentIndex;

    let prefix = '  ';
    let taskColor = 'dim';
    let statusIcon = '○';

    if (isCompleted) {
      statusIcon = '✓';
      taskColor = 'green';
    } else if (isCurrent) {
      statusIcon = '→';
      taskColor = 'yellow';
      prefix = '';
    }

    console.log(color(taskColor, `${prefix}${statusIcon} ${taskId}`));
  });

  console.log('');
  console.log(color('dim', `Completed: ${status.completedTasks.length}/${status.tasks.length}`));
}

/**
 * Initialize queue
 */
function initQueue(taskIds, source = 'cli') {
  if (taskIds.length === 0) {
    console.log(error('No task IDs provided.'));
    console.log('');
    console.log('Usage:');
    console.log('  flow queue init wf-001 wf-002 wf-003');
    console.log('  flow queue init $(flow queue parse "do story 1-3")');
    process.exit(1);
  }

  const config = getConfig();
  const maxQueueSize = config.taskQueue?.maxQueueSize || 10;

  if (taskIds.length > maxQueueSize) {
    console.log(color('yellow', `Warning: Queue size limited to ${maxQueueSize} tasks.`));
    taskIds = taskIds.slice(0, maxQueueSize);
  }

  initTaskQueue(taskIds, source);

  console.log('');
  console.log(color('green', '✓ Task queue initialized'));
  console.log('');
  console.log(`Tasks queued: ${taskIds.length}`);
  taskIds.forEach((id, i) => {
    console.log(color('dim', `  ${i + 1}. ${id}`));
  });
  console.log('');
  console.log('Start the first task with:');
  console.log(color('cyan', `  /wogi-start ${taskIds[0]}`));
}

/**
 * Parse command and output task IDs
 */
function parseCommand(input) {
  const taskIds = parseNaturalLanguage(input);

  if (taskIds.length === 0) {
    console.log(error('Could not parse task IDs from input.'));
    console.log('');
    console.log('Supported formats:');
    console.log('  "wf-001, wf-002, wf-003" - Direct task IDs');
    console.log('  "story 1-3" or "tasks 1-5" - Range from ready queue');
    console.log('  "3 tasks" or "these 5 stories" - Count from ready queue');
    console.log('  "all ready tasks" - All from ready queue (max 10)');
    process.exit(1);
  }

  // Output task IDs for use in other commands
  console.log(taskIds.join(' '));
}

/**
 * Clear the queue
 */
function clearQueue() {
  clearTaskQueue();
  console.log(color('green', '✓ Task queue cleared'));
}

/**
 * Advance to next task
 */
function advance() {
  const status = getQueueStatus();

  if (!status.enabled || status.tasks.length === 0) {
    console.log(error('No active queue.'));
    process.exit(1);
  }

  if (status.currentIndex >= status.tasks.length - 1) {
    console.log(color('yellow', 'Already at the last task in queue.'));
    process.exit(0);
  }

  advanceTaskQueue();

  const newStatus = getQueueStatus();
  const nextTask = newStatus.tasks[newStatus.currentIndex];

  console.log(color('green', '✓ Advanced to next task'));
  console.log(`Next task: ${nextTask}`);
  console.log('');
  console.log('Start with:');
  console.log(color('cyan', `  /wogi-start ${nextTask}`));
}

// Main
function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'init':
      initQueue(args, 'cli');
      break;

    case 'status':
      showStatus();
      break;

    case 'clear':
      clearQueue();
      break;

    case 'parse':
      if (args.length === 0) {
        console.log(error('Missing input string.'));
        console.log('Usage: flow queue parse "do story 1-3"');
        process.exit(1);
      }
      parseCommand(args.join(' '));
      break;

    case 'advance':
      advance();
      break;

    default:
      console.log('Wogi Flow - Task Queue Management');
      console.log('');
      console.log('Commands:');
      console.log('  flow queue init <task-ids...>  - Initialize queue with task IDs');
      console.log('  flow queue status              - Show current queue status');
      console.log('  flow queue clear               - Clear the queue');
      console.log('  flow queue parse "<text>"      - Parse natural language for task IDs');
      console.log('  flow queue advance             - Manually advance to next task');
      console.log('');
      console.log('Examples:');
      console.log('  flow queue init wf-001 wf-002 wf-003');
      console.log('  flow queue init $(flow queue parse "do story 1-3")');
      console.log('  flow queue parse "work on tasks 1-5"');
      console.log('  flow queue status');
      break;
  }
}

main();

module.exports = {
  parseNaturalLanguage,
  getTasksFromReady
};
