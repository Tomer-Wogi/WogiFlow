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
const { safeReadJson } = require('./utils');
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
  'heads-up',         // "I'm about to change Y, just FYI"
  'impact-query',     // Pre-dev: "I'm about to change X, will this break you?"
  'impact-response',  // Pre-dev response: "Yes/No, here's what to watch out for"
  'verification-request', // Post-change: "Please verify your integrations"
  'lock-acquired',    // "I'm editing shared interface X"
  'lock-released',    // "Done editing shared interface X"
  'decision-broadcast' // "New workspace-wide decision: ..."
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
      const content = safeReadJson(path.join(messagesDir, file));
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
    const message = safeReadJson(filePath);
    message.status = newStatus;
    message.updatedAt = new Date().toISOString();
    // Safe merge: filter dangerous keys to prevent prototype pollution
    if (extra && typeof extra === 'object') {
      const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      for (const [key, value] of Object.entries(extra)) {
        if (!DANGEROUS_KEYS.has(key)) {
          message[key] = value;
        }
      }
    }
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
    const ready = safeReadJson(readyPath);
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
    const original = safeReadJson(filePath);
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
    return safeReadJson(configPath);
  } catch (_err) {
    return null;
  }
}

// ============================================================
// Peer Query Protocol (Pre-Dev Impact Queries)
// ============================================================

/**
 * Send an impact query to a peer before making changes.
 * This is a structured pre-dev check: "I'm about to change X, will this break you?"
 *
 * @param {string} fromRepo
 * @param {string} toRepo
 * @param {Object} params
 * @param {string} params.taskTitle — what work is planned
 * @param {string[]} [params.affectedEndpoints] — endpoints that will change
 * @param {string[]} [params.affectedTypes] — types/schemas that will change
 * @param {string} [params.changeDescription] — detailed description of planned changes
 * @returns {Object} impact-query message (unsaved — caller must saveMessage)
 */
function sendImpactQuery(fromRepo, toRepo, params) {
  const { taskTitle, affectedEndpoints = [], affectedTypes = [], changeDescription = '' } = params;

  let body = `## Pre-Dev Impact Query\n\n`;
  body += `**Planned work**: ${taskTitle}\n\n`;
  if (affectedEndpoints.length > 0) {
    body += `**Endpoints that will change**:\n${affectedEndpoints.map(e => `- \`${e}\``).join('\n')}\n\n`;
  }
  if (affectedTypes.length > 0) {
    body += `**Types/schemas that will change**:\n${affectedTypes.map(t => `- \`${t}\``).join('\n')}\n\n`;
  }
  if (changeDescription) {
    body += `**Details**: ${changeDescription}\n\n`;
  }
  body += `**Please respond with**:\n`;
  body += `1. Will this break anything on your side?\n`;
  body += `2. Are there any endpoints/types I should be aware of?\n`;
  body += `3. Any coordination needed?\n`;

  return createMessage({
    from: fromRepo,
    to: toRepo,
    type: 'impact-query',
    subject: `Impact query: ${taskTitle.substring(0, 60)}`,
    body,
    priority: 'high',
    actionRequired: true
  });
}

/**
 * Respond to an impact query from a peer.
 *
 * @param {string} workspaceRoot
 * @param {string} originalMessageId — the impact-query being responded to
 * @param {string} fromRepo — who is responding
 * @param {Object} response
 * @param {boolean} response.willBreak — will the planned changes break this repo?
 * @param {string[]} [response.concerns] — specific concerns
 * @param {string} [response.suggestion] — suggested approach
 * @returns {Object} impact-response message (unsaved)
 */
function respondToImpactQuery(workspaceRoot, originalMessageId, fromRepo, response) {
  if (!MESSAGE_ID_PATTERN.test(originalMessageId)) {
    throw new Error(`Invalid messageId: ${originalMessageId}. Must match msg-[a-f0-9]{8}`);
  }

  // Mark original as acknowledged
  updateMessageStatus(workspaceRoot, originalMessageId, 'acknowledged');

  // Read original to get sender
  const filePath = path.join(workspaceRoot, '.workspace', 'messages', `${originalMessageId}.json`);
  let originalFrom = 'unknown';
  try {
    const original = safeReadJson(filePath);
    originalFrom = original.from;
  } catch (_err) {
    // Non-critical
  }

  const { willBreak, concerns = [], suggestion = '' } = response;
  let body = `## Impact Response\n\n`;
  body += `**Will break**: ${willBreak ? 'YES' : 'No'}\n\n`;
  if (concerns.length > 0) {
    body += `**Concerns**:\n${concerns.map(c => `- ${c}`).join('\n')}\n\n`;
  }
  if (suggestion) {
    body += `**Suggestion**: ${suggestion}\n`;
  }

  return createMessage({
    from: fromRepo,
    to: originalFrom,
    type: 'impact-response',
    subject: `Re: ${originalMessageId} — ${willBreak ? 'BREAKING' : 'OK'}`,
    body,
    priority: willBreak ? 'critical' : 'medium',
    actionRequired: willBreak
  });
}

// ============================================================
// Verification Requests (Post-Change)
// ============================================================

/**
 * Create a verification request for a consumer repo after provider changes.
 *
 * @param {string} fromRepo — the repo that made changes
 * @param {string} toRepo — the consumer that needs to verify
 * @param {Object} params
 * @param {string} params.taskTitle — what was changed
 * @param {string[]} [params.changedEndpoints] — endpoints that changed
 * @param {string[]} [params.changedTypes] — types that changed
 * @param {boolean} [params.contractDriftDetected] — if drift was found
 * @returns {Object} verification-request message (unsaved)
 */
function createVerificationRequest(fromRepo, toRepo, params) {
  const { taskTitle, changedEndpoints = [], changedTypes = [], contractDriftDetected = false } = params;

  let body = `## Verification Required\n\n`;
  body += `Repo \`${fromRepo}\` completed: **${taskTitle}**\n\n`;
  if (changedEndpoints.length > 0) {
    body += `**Changed endpoints**:\n${changedEndpoints.map(e => `- \`${e}\``).join('\n')}\n\n`;
  }
  if (changedTypes.length > 0) {
    body += `**Changed types**:\n${changedTypes.map(t => `- \`${t}\``).join('\n')}\n\n`;
  }
  if (contractDriftDetected) {
    body += `**WARNING**: Contract drift detected — your integration may be broken.\n\n`;
  }
  body += `**Action**: Please verify your API calls and type usage still match.\n`;

  return createMessage({
    from: fromRepo,
    to: toRepo,
    type: 'verification-request',
    subject: `Verify: ${fromRepo} changed ${taskTitle.substring(0, 50)}`,
    body,
    priority: contractDriftDetected ? 'critical' : 'high',
    actionRequired: true,
    suggestedTask: {
      title: `Verify integrations after ${fromRepo} changes — ${taskTitle.substring(0, 40)}`,
      type: 'fix',
      priority: contractDriftDetected ? 'P0' : 'P1'
    }
  });
}

// ============================================================
// Decision Broadcast
// ============================================================

/**
 * Broadcast a workspace-wide decision to all members.
 *
 * @param {string} fromRepo — the repo that made the decision
 * @param {string} decisionTitle
 * @param {string} decisionContent
 * @param {string[]} targetRepos — list of member repo names
 * @returns {Array<Object>} messages (unsaved)
 */
function broadcastDecision(fromRepo, decisionTitle, decisionContent, targetRepos) {
  const messages = [];
  for (const target of targetRepos) {
    if (target === fromRepo) continue;
    messages.push(createMessage({
      from: fromRepo,
      to: target,
      type: 'decision-broadcast',
      subject: `Decision: ${decisionTitle.substring(0, 60)}`,
      body: `## New Workspace Decision\n\n### ${decisionTitle}\n\n${decisionContent}\n\n*This decision applies workspace-wide. Please follow it in your repo.*`,
      priority: 'high',
      actionRequired: false
    }));
  }
  return messages;
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
  answerQuestion,

  // Peer query protocol (pre-dev)
  sendImpactQuery,
  respondToImpactQuery,

  // Verification requests (post-change)
  createVerificationRequest,

  // Decision broadcast
  broadcastDecision
};
