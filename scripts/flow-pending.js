/**
 * Wogi Flow - Pending Prompts Queue
 *
 * Manages a queue of user requests saved for later processing.
 * Items are saved individually and processed after the current task completes.
 *
 * Usage:
 *   flow pending add "prompt text"   # Add item to queue
 *   flow pending list                # Show all pending items
 *   flow pending clear [id]          # Clear specific item or all
 *   flow pending count               # Get pending count
 *   flow pending mark-processed <id> # Mark item as processed
 */

const _fs = require('node:fs');
const path = require('node:path');
const { PATHS, readJson, writeJson } = require('./flow-utils');

const PENDING_PATH = path.join(PATHS.state, 'pending-prompts.json');

/**
 * Load pending queue from disk
 * @returns {{ items: Array, nextId: number }}
 */
function loadPending() {
  return readJson(PENDING_PATH, { items: [], nextId: 1 });
}

/**
 * Save pending queue to disk
 * @param {Object} data - Queue data
 */
function savePending(data) {
  return writeJson(PENDING_PATH, data);
}

/**
 * Add an item to the pending queue
 * @param {string} prompt - The prompt text to queue
 * @returns {Object} The created item
 */
function addItem(prompt) {
  const data = loadPending();
  const item = {
    id: data.nextId || (data.items.length + 1),
    prompt: prompt.trim(),
    addedAt: new Date().toISOString(),
    status: 'pending'
  };
  data.items.push(item);
  data.nextId = (data.nextId || data.items.length) + 1;
  savePending(data);
  return item;
}

/**
 * List all pending (non-processed) items
 * @returns {Array} Pending items
 */
function listItems() {
  const data = loadPending();
  return data.items.filter(i => i.status === 'pending');
}

/**
 * Remove a specific item by ID
 * @param {number} id - Item ID to remove
 * @returns {boolean} Whether the item was found and removed
 */
function clearItem(id) {
  const data = loadPending();
  const idx = data.items.findIndex(i => i.id === id);
  if (idx === -1) return false;
  data.items.splice(idx, 1);
  savePending(data);
  return true;
}

/**
 * Clear all items from the queue
 * @returns {boolean} Always true
 */
function clearAll() {
  savePending({ items: [], nextId: 1 });
  return true;
}

/**
 * Get the count of pending (non-processed) items
 * @returns {number}
 */
function getPendingCount() {
  const data = loadPending();
  return data.items.filter(i => i.status === 'pending').length;
}

/**
 * Mark an item as processed
 * @param {number} id - Item ID to mark
 */
function markProcessed(id) {
  const data = loadPending();
  const item = data.items.find(i => i.id === id);
  if (item) {
    item.status = 'processed';
    item.processedAt = new Date().toISOString();
    savePending(data);
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'add') {
    const prompt = args.slice(1).join(' ');
    if (!prompt) {
      console.error('Usage: flow pending add "prompt text"');
      process.exit(1);
    }
    const item = addItem(prompt);
    console.log(JSON.stringify({ success: true, item }));
  } else if (command === 'list') {
    const items = listItems();
    console.log(JSON.stringify({ success: true, items, count: items.length }));
  } else if (command === 'clear') {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) {
      clearAll();
      console.log(JSON.stringify({ success: true, cleared: 'all' }));
    } else {
      const removed = clearItem(id);
      console.log(JSON.stringify({ success: removed, cleared: id }));
    }
  } else if (command === 'count') {
    console.log(JSON.stringify({ count: getPendingCount() }));
  } else if (command === 'mark-processed') {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) {
      console.error('Usage: flow pending mark-processed <id>');
      process.exit(1);
    }
    markProcessed(id);
    console.log(JSON.stringify({ success: true, marked: id }));
  } else {
    console.log('Usage: flow pending [add|list|clear|count|mark-processed]');
  }
}

module.exports = { addItem, listItems, clearItem, clearAll, getPendingCount, markProcessed, loadPending, savePending, PENDING_PATH };
