#!/usr/bin/env node

/**
 * Wogi Workspace — Agent Communication (Message Bus)
 *
 * Story 4 (wf-0206b2b5): File-based message bus for agent-to-agent
 * communication across repos. Supports structured message types,
 * lifecycle management, and suggested task auto-creation.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ============================================================
// Constants
// ============================================================

const MESSAGE_TYPES = [
  'contract-change',  // "I changed an API endpoint"
  'question',         // "Does your side handle X?"
  'bug-report',       // "Your endpoint returns 500 when I send Y"
  'task-complete',    // "I finished my side of feature Z"
  'needs-help',       // "I'm stuck, can you check X on your side?"
  'heads-up'          // "I'm about to change Y, just FYI"
];

const MESSAGE_STATUSES = ['pending', 'acknowledged', 'task-created', 'resolved'];

const MESSAGE_ID_PATTERN = /^msg-[a-f0-9]{8}$/;

// ============================================================
// Message Creation (Criterion 1)
// ============================================================

/**
 * Generate a unique message ID
 * @returns {string} msg-XXXXXXXX
 */
function generateMessageId() {
  return 'msg-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Create a structured message
 * @param {Object} params
 * @param {string} params.from — sender repo name
 * @param {string} params.to — receiver repo name, "manager", or "all"
 * @param {string} params.type — one of MESSAGE_TYPES
 * @param {string} params.subject — short description
 * @param {string} params.body — detailed description
 * @param {string} [params.priority] — "low", "medium", "high", "critical"
 * @param {string} [params.diff] — git diff or contract diff
 * @param {Object} [params.suggestedTask] — auto-create task in target repo
 * @param {boolean} [params.actionRequired] — does the receiver need to act?
 * @returns {Object} message object
 */
function createMessage({ from, to, type, subject, body, priority, diff, suggestedTask, actionRequired }) {
  if (typeof from !== 'string' || !from.trim()) {
    throw new Error('Message "from" must be a non-empty string');
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    throw new Error('Message "subject" must be a non-empty string');
  }
  if (!MESSAGE_TYPES.includes(type)) {
    throw new Error(`Invalid message type: ${type}. Must be one of: ${MESSAGE_TYPES.join(', ')}`);
  }

  return {
    id: generateMessageId(),
    from,
    to: to || 'all',
    type,
    priority: priority || 'medium',
    timestamp: new Date().toISOString(),
    subject,
    body,
    ...(diff && { diff }),
    ...(suggestedTask && { suggestedTask }),
    actionRequired: actionRequired ?? (type === 'contract-change' || type === 'bug-report'),
    status: 'pending'
  };
}

// ============================================================
// Message Persistence (Criterion 2 — lifecycle)
// ============================================================

/**
 * Save a message to the workspace message bus
 * @param {string} workspaceRoot
 * @param {Object} message
 * @returns {string} message file path
 */
function saveMessage(workspaceRoot, message) {
  const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });

  const filePath = path.join(messagesDir, `${message.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
  return filePath;
}

/**
 * Read all messages from the workspace
 * @param {string} workspaceRoot
 * @param {Object} [filter] — { status, from, to, type }
 * @returns {Array<Object>} messages sorted by timestamp (newest first)
 */
function readMessages(workspaceRoot, filter = {}) {
  const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
  if (!fs.existsSync(messagesDir)) return [];

  const messages = [];
  const files = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(messagesDir, file), 'utf-8'));
      if (!content.id) continue;

      // Apply filters
      if (filter.status && content.status !== filter.status) continue;
      if (filter.from && content.from !== filter.from) continue;
      if (filter.to && content.to !== filter.to && content.to !== 'all') continue;
      if (filter.type && content.type !== filter.type) continue;

      messages.push(content);
    } catch (_err) {
      // Skip malformed messages
    }
  }

  // Sort newest first
  messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return messages;
}

/**
 * Update a message's status
 * @param {string} workspaceRoot
 * @param {string} messageId
 * @param {string} newStatus
 * @param {Object} [extra] — additional fields to merge
 * @returns {Object|null} updated message or null if not found
 */
function updateMessageStatus(workspaceRoot, messageId, newStatus, extra = {}) {
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    throw new Error(`Invalid messageId: ${messageId}. Must match msg-[a-f0-9]{8}`);
  }
  if (!MESSAGE_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${MESSAGE_STATUSES.join(', ')}`);
  }

  const filePath = path.join(workspaceRoot, '.workspace', 'messages', `${messageId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const message = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    message.status = newStatus;
    message.updatedAt = new Date().toISOString();
    Object.assign(message, extra);
    fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
    return message;
  } catch (_err) {
    return null;
  }
}

/**
 * Get unread (pending) messages for a specific repo
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @returns {Array<Object>} unread messages
 */
function getUnreadMessages(workspaceRoot, repoName) {
  return readMessages(workspaceRoot, { status: 'pending', to: repoName });
}

// ============================================================
// Change Notifications (Criterion 3)
// ============================================================

/**
 * Generate a change notification message when a repo changes a contract endpoint
 * @param {string} repoName — which repo made the change
 * @param {Object} change — { endpoint, method, action, details }
 * @param {string[]} affectedRepos — repos that consume this endpoint
 * @returns {Array<Object>} messages to send (one per affected repo)
 */
function generateChangeNotifications(repoName, change, affectedRepos) {
  const messages = [];

  for (const targetRepo of affectedRepos) {
    if (targetRepo === repoName) continue; // Don't notify self

    const msg = createMessage({
      from: repoName,
      to: targetRepo,
      type: 'contract-change',
      priority: change.action === 'removed' ? 'critical' : 'high',
      subject: `${change.action}: ${change.method} ${change.endpoint}`,
      body: change.details || `The endpoint ${change.method} ${change.endpoint} was ${change.action} by ${repoName}.`,
      diff: change.diff,
      actionRequired: true,
      suggestedTask: {
        title: `Update ${targetRepo} for contract change: ${change.method} ${change.endpoint}`,
        type: 'fix',
        criteria: [`Handle ${change.action} of ${change.method} ${change.endpoint} from ${repoName}`]
      }
    });

    messages.push(msg);
  }

  return messages;
}

// ============================================================
// Suggested Task Auto-Creation (Criterion 4)
// ============================================================

/**
 * Process suggested tasks from messages — create tasks in target repo's ready.json
 * @param {string} workspaceRoot
 * @param {Object} message — message with suggestedTask
 * @returns {Object|null} created task entry, or null if no suggestion
 */
function processSuggestedTask(workspaceRoot, message) {
  if (!message.suggestedTask) return null;

  const targetRepo = message.to;
  if (targetRepo === 'all' || targetRepo === 'manager') return null;

  // Find the target repo's ready.json
  const config = readWorkspaceConfig(workspaceRoot);
  if (!config || !config.members[targetRepo]) return null;

  const memberPath = path.resolve(workspaceRoot, config.members[targetRepo].path);
  const resolvedRoot = path.resolve(workspaceRoot);
  if (!memberPath.startsWith(resolvedRoot + path.sep) && memberPath !== resolvedRoot) {
    return null; // Path traversal attempt — member path escapes workspace root
  }
  const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

  if (!fs.existsSync(readyPath)) return null;

  try {
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    // Use generateTaskId when available, fallback to random (finding-008)
    let taskId;
    try {
      const { generateTaskId } = require('../scripts/flow-utils');
      taskId = generateTaskId(message.suggestedTask.title || message.subject);
    } catch (_err) {
      taskId = 'wf-' + crypto.randomBytes(4).toString('hex');
    }

    const task = {
      id: taskId,
      title: message.suggestedTask.title || `From ${message.from}: ${message.subject}`,
      type: message.suggestedTask.type || 'fix',
      level: 'L2',
      priority: message.priority === 'critical' ? 'P0' : 'P1',
      source: `workspace-message:${message.id}`,
      status: 'ready',
      description: message.body,
      createdAt: new Date().toISOString()
    };

    if (!ready.ready) ready.ready = [];
    ready.ready.push(task);
    ready.lastUpdated = new Date().toISOString();
    fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2));

    // Update message status
    updateMessageStatus(workspaceRoot, message.id, 'task-created', { createdTaskId: taskId });

    return task;
  } catch (_err) {
    return null;
  }
}

// ============================================================
// Message Display (Criterion 5)
// ============================================================

/**
 * Format messages for session display
 * @param {Array<Object>} messages
 * @param {number} [maxMessages=10]
 * @returns {string} formatted text
 */
function formatMessagesForDisplay(messages, maxMessages = 10) {
  if (messages.length === 0) return 'No messages.';

  const lines = [];
  const displayed = messages.slice(0, maxMessages);

  for (const msg of displayed) {
    const icon = getMessageIcon(msg.type);
    const priority = msg.priority === 'critical' ? ' 🔴' : msg.priority === 'high' ? ' 🟡' : '';
    const action = msg.actionRequired ? ' [ACTION REQUIRED]' : '';
    const age = formatAge(msg.timestamp);

    lines.push(`${icon} ${msg.from}→${msg.to}: ${msg.subject}${priority}${action} (${age})`);
  }

  if (messages.length > maxMessages) {
    lines.push(`  ... and ${messages.length - maxMessages} more`);
  }

  return lines.join('\n');
}

function getMessageIcon(type) {
  switch (type) {
    case 'contract-change': return '📋';
    case 'question': return '❓';
    case 'bug-report': return '🐛';
    case 'task-complete': return '✅';
    case 'needs-help': return '🆘';
    case 'heads-up': return '👀';
    default: return '💬';
  }
}

function formatAge(timestamp) {
  const ms = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================
// Agent-to-Agent Questions (Criterion 6)
// ============================================================

/**
 * Create a question from one repo agent to another
 * @param {string} fromRepo
 * @param {string} toRepo
 * @param {string} question
 * @param {Object} [context] — optional context (file paths, error messages, etc.)
 * @returns {Object} question message
 */
function askQuestion(fromRepo, toRepo, question, context = {}) {
  return createMessage({
    from: fromRepo,
    to: toRepo,
    type: 'question',
    subject: question.length > 80 ? question.substring(0, 77) + '...' : question,
    body: question,
    priority: 'medium',
    actionRequired: true,
    ...(context.diff && { diff: context.diff })
  });
}

/**
 * Create a response to a question
 * @param {string} workspaceRoot
 * @param {string} originalMessageId — the question being answered
 * @param {string} fromRepo — who is answering
 * @param {string} answer
 * @returns {Object} response message
 */
function answerQuestion(workspaceRoot, originalMessageId, fromRepo, answer) {
  if (!MESSAGE_ID_PATTERN.test(originalMessageId)) {
    throw new Error(`Invalid messageId: ${originalMessageId}. Must match msg-[a-f0-9]{8}`);
  }

  // Mark original question as resolved
  updateMessageStatus(workspaceRoot, originalMessageId, 'resolved');

  // Read original to get the sender
  const filePath = path.join(workspaceRoot, '.workspace', 'messages', `${originalMessageId}.json`);
  let originalFrom = 'unknown';
  try {
    const original = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    originalFrom = original.from;
  } catch (_err) {
    // Non-critical
  }

  return createMessage({
    from: fromRepo,
    to: originalFrom,
    type: 'heads-up',
    subject: `Re: ${originalMessageId}`,
    body: answer,
    priority: 'medium',
    actionRequired: false
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Read workspace config (wogi-workspace.json)
 * @param {string} workspaceRoot
 * @returns {Object|null}
 */
function readWorkspaceConfig(workspaceRoot) {
  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Message creation
  createMessage,
  generateMessageId,
  MESSAGE_TYPES,
  MESSAGE_STATUSES,

  // Persistence
  saveMessage,
  readMessages,
  updateMessageStatus,
  getUnreadMessages,

  // Change notifications
  generateChangeNotifications,

  // Suggested tasks
  processSuggestedTask,

  // Display
  formatMessagesForDisplay,

  // Agent questions
  askQuestion,
  answerQuestion
};
