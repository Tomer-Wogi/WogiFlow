#!/usr/bin/env node

/**
 * Wogi Workspace — Event Bus
 *
 * Persistent event stream for real-time cross-repo coordination.
 * Workers subscribe to events from peers and react to them.
 *
 * Event types:
 *   - task-started    — a worker began working on a task
 *   - task-completed  — a worker finished a task
 *   - contract-changed — a contract was updated
 *   - lock-acquired   — a shared interface was locked
 *   - lock-released   — a shared interface was unlocked
 *   - test-failed     — integration tests failed
 *   - decision-added  — a new workspace-wide decision was added
 *   - sync-requested  — workspace manifest needs refresh
 *
 * Architecture:
 *   - File-based event log (.workspace/state/events.json)
 *   - SSE endpoint on channel server (GET /events)
 *   - Workers poll or subscribe via SSE
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ============================================================
// Constants
// ============================================================

const EVENT_TYPES = [
  'task-started',
  'task-completed',
  'contract-changed',
  'lock-acquired',
  'lock-released',
  'test-failed',
  'decision-added',
  'sync-requested'
];

const EVENTS_FILE = 'events.json';
const MAX_EVENTS = 500; // Keep last 500 events
const EVENT_ID_PATTERN = /^evt-[a-f0-9]{8}$/;

// ============================================================
// Event Creation
// ============================================================

/**
 * Create an event object.
 *
 * @param {Object} params
 * @param {string} params.type — one of EVENT_TYPES
 * @param {string} params.source — repo name that emitted the event
 * @param {Object} [params.data] — event-specific payload
 * @returns {Object} event object
 */
function createEvent(params) {
  const { type, source, data = {} } = params;

  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type: ${type}. Must be one of: ${EVENT_TYPES.join(', ')}`);
  }

  return {
    id: 'evt-' + crypto.randomBytes(4).toString('hex'),
    type,
    source,
    data,
    timestamp: new Date().toISOString()
  };
}

// ============================================================
// Event Persistence
// ============================================================

/**
 * Emit an event to the workspace event log.
 *
 * @param {string} workspaceRoot
 * @param {Object} event — from createEvent()
 * @returns {Object} the saved event
 */
function emitEvent(workspaceRoot, event) {
  const eventsPath = path.join(workspaceRoot, '.workspace', 'state', EVENTS_FILE);
  let events = [];

  try {
    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
      if (!Array.isArray(events)) events = [];
    }
  } catch (_err) {
    events = [];
  }

  events.push(event);

  // Trim to max events (keep newest)
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }

  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));

  return event;
}

/**
 * Read events from the event log.
 *
 * @param {string} workspaceRoot
 * @param {Object} [filter]
 * @param {string} [filter.type] — filter by event type
 * @param {string} [filter.source] — filter by source repo
 * @param {string} [filter.since] — ISO date string, only events after this time
 * @param {number} [filter.limit] — max events to return (default: 50)
 * @returns {Array<Object>} events (newest first)
 */
function readEvents(workspaceRoot, filter = {}) {
  const eventsPath = path.join(workspaceRoot, '.workspace', 'state', EVENTS_FILE);
  let events = [];

  try {
    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
      if (!Array.isArray(events)) events = [];
    }
  } catch (_err) {
    return [];
  }

  // Apply filters
  if (filter.type) {
    events = events.filter(e => e.type === filter.type);
  }
  if (filter.source) {
    events = events.filter(e => e.source === filter.source);
  }
  if (filter.since) {
    const sinceTime = new Date(filter.since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() > sinceTime);
  }

  // Newest first
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Limit
  const limit = filter.limit ?? 50;
  if (limit > 0) {
    events = events.slice(0, limit);
  }

  return events;
}

// ============================================================
// Event Subscriptions (Reactive Workflows)
// ============================================================

/**
 * A subscription defines a reaction to a specific event type.
 * Subscriptions are stored in .workspace/state/subscriptions.json.
 *
 * @param {Object} params
 * @param {string} params.subscriber — repo name subscribing
 * @param {string} params.eventType — event type to react to
 * @param {string} params.sourceFilter — only events from this source (or '*' for all)
 * @param {Object} params.action — what to do: { type: 'create-task', taskTemplate: {...} }
 * @returns {Object} subscription object
 */
function createSubscription(params) {
  const { subscriber, eventType, sourceFilter = '*', action } = params;

  return {
    id: 'sub-' + crypto.randomBytes(4).toString('hex'),
    subscriber,
    eventType,
    sourceFilter,
    action,
    createdAt: new Date().toISOString(),
    active: true
  };
}

/**
 * Save a subscription.
 *
 * @param {string} workspaceRoot
 * @param {Object} subscription
 * @returns {Object} saved subscription
 */
function saveSubscription(workspaceRoot, subscription) {
  const subsPath = path.join(workspaceRoot, '.workspace', 'state', 'subscriptions.json');
  let subs = [];

  try {
    if (fs.existsSync(subsPath)) {
      subs = JSON.parse(fs.readFileSync(subsPath, 'utf-8'));
      if (!Array.isArray(subs)) subs = [];
    }
  } catch (_err) {
    subs = [];
  }

  subs.push(subscription);
  fs.mkdirSync(path.dirname(subsPath), { recursive: true });
  fs.writeFileSync(subsPath, JSON.stringify(subs, null, 2));

  return subscription;
}

/**
 * Get all active subscriptions.
 *
 * @param {string} workspaceRoot
 * @returns {Array<Object>} active subscriptions
 */
function getActiveSubscriptions(workspaceRoot) {
  const subsPath = path.join(workspaceRoot, '.workspace', 'state', 'subscriptions.json');

  try {
    if (fs.existsSync(subsPath)) {
      const subs = JSON.parse(fs.readFileSync(subsPath, 'utf-8'));
      return (Array.isArray(subs) ? subs : []).filter(s => s.active);
    }
  } catch (_err) {
    // Non-critical
  }

  return [];
}

/**
 * Remove a subscription.
 *
 * @param {string} workspaceRoot
 * @param {string} subscriptionId
 * @returns {boolean} true if found and removed
 */
function removeSubscription(workspaceRoot, subscriptionId) {
  const subsPath = path.join(workspaceRoot, '.workspace', 'state', 'subscriptions.json');

  try {
    if (!fs.existsSync(subsPath)) return false;
    let subs = JSON.parse(fs.readFileSync(subsPath, 'utf-8'));
    if (!Array.isArray(subs)) return false;

    const before = subs.length;
    subs = subs.filter(s => s.id !== subscriptionId);
    if (subs.length === before) return false;

    fs.writeFileSync(subsPath, JSON.stringify(subs, null, 2));
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Process an event against all active subscriptions.
 * Returns actions that should be taken.
 *
 * @param {string} workspaceRoot
 * @param {Object} event
 * @returns {Array<Object>} triggered actions
 */
function processEventSubscriptions(workspaceRoot, event) {
  const subs = getActiveSubscriptions(workspaceRoot);
  const triggeredActions = [];

  for (const sub of subs) {
    // Check if this subscription matches the event
    if (sub.eventType !== event.type) continue;
    if (sub.sourceFilter !== '*' && sub.sourceFilter !== event.source) continue;
    if (sub.subscriber === event.source) continue; // Don't trigger on own events

    triggeredActions.push({
      subscription: sub,
      event,
      action: sub.action
    });
  }

  return triggeredActions;
}

// ============================================================
// SSE Helpers (for channel server integration)
// ============================================================

/**
 * Format an event as an SSE (Server-Sent Events) message.
 *
 * @param {Object} event
 * @returns {string} SSE-formatted string
 */
function formatAsSSE(event) {
  const data = JSON.stringify(event);
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

/**
 * Get events since a specific event ID (for SSE Last-Event-ID reconnection).
 *
 * @param {string} workspaceRoot
 * @param {string} lastEventId — the last event ID the client received
 * @returns {Array<Object>} events after the given ID (oldest first)
 */
function getEventsSince(workspaceRoot, lastEventId) {
  const eventsPath = path.join(workspaceRoot, '.workspace', 'state', EVENTS_FILE);

  try {
    if (!fs.existsSync(eventsPath)) return [];
    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
    if (!Array.isArray(events)) return [];

    // Find the index of the last event
    const idx = events.findIndex(e => e.id === lastEventId);
    if (idx === -1) return events; // If not found, send all events
    return events.slice(idx + 1); // Return everything after
  } catch (_err) {
    return [];
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  EVENT_TYPES,

  // Event creation & persistence
  createEvent,
  emitEvent,
  readEvents,

  // Subscriptions
  createSubscription,
  saveSubscription,
  getActiveSubscriptions,
  removeSubscription,
  processEventSubscriptions,

  // SSE helpers
  formatAsSSE,
  getEventsSince
};
