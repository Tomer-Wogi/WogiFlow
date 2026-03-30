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
 * Uses append-only NDJSON format to avoid read-modify-write races
 * when multiple workspace repos emit events concurrently.
 *
 * @param {string} workspaceRoot
 * @param {Object} event — from createEvent()
 * @returns {Object} the saved event
 */
function emitEvent(workspaceRoot, event) {
  const eventsPath = path.join(workspaceRoot, '.workspace', 'state', EVENTS_FILE);
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });

  // Append-only: one JSON object per line (NDJSON format)
  // This is safe for concurrent writers — appendFileSync is atomic for small writes
  fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');

  // Periodic trim: only when file exceeds 2x MAX_EVENTS lines (amortized cost)
  try {
    const stat = fs.statSync(eventsPath);
    // Rough estimate: ~200 bytes per event line
    if (stat.size > MAX_EVENTS * 400) {
      trimEventLog(eventsPath);
    }
  } catch (_err) {
    // Non-critical
  }

  return event;
}

/**
 * Trim the event log to MAX_EVENTS entries.
 * Called periodically by emitEvent when the file grows too large.
 *
 * @param {string} eventsPath
 */
function trimEventLog(eventsPath) {
  try {
    const content = fs.readFileSync(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > MAX_EVENTS) {
      const trimmed = lines.slice(lines.length - MAX_EVENTS);
      fs.writeFileSync(eventsPath, trimmed.join('\n') + '\n');
    }
  } catch (_err) {
    // Non-critical — will try again next time
  }
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
      const content = fs.readFileSync(eventsPath, 'utf-8');
      // Support both NDJSON (one JSON per line) and legacy JSON array format
      if (content.trimStart().startsWith('[')) {
        events = JSON.parse(content);
        if (!Array.isArray(events)) events = [];
      } else {
        // NDJSON format
        events = content.trim().split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch (_err) { return null; }
        }).filter(Boolean);
      }
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
  const MAX_REPLAY_EVENTS = 50;
  // Reuse readEvents which handles both NDJSON and legacy formats
  const allEvents = readEvents(workspaceRoot, { limit: 0 });
  // readEvents returns newest-first; reverse for oldest-first replay
  allEvents.reverse();

  if (!lastEventId) return allEvents.slice(-MAX_REPLAY_EVENTS);

  const idx = allEvents.findIndex(e => e.id === lastEventId);
  if (idx === -1) {
    // Unknown ID — return only recent events, not the entire history
    return allEvents.slice(-MAX_REPLAY_EVENTS);
  }
  return allEvents.slice(idx + 1);
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
