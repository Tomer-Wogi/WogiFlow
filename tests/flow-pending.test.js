'use strict';

/**
 * Tests for flow-pending.js — pending prompts queue management
 *
 * Development-only — not distributed to end users.
 * Run: node --test tests/flow-pending.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  addItem,
  listItems,
  clearItem,
  clearAll,
  getPendingCount,
  markProcessed,
  loadPending,
  savePending,
  PENDING_PATH
} = require('../scripts/flow-pending');

// Backup existing file content before tests, restore after
let originalContent = null;

describe('flow-pending', () => {
  beforeEach(() => {
    // Backup any existing pending-prompts.json
    try {
      originalContent = fs.readFileSync(PENDING_PATH, 'utf-8');
    } catch (_err) {
      originalContent = null;
    }
    // Reset to empty state before each test
    const dir = path.dirname(PENDING_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PENDING_PATH, JSON.stringify({ items: [], nextId: 1 }));
  });

  afterEach(() => {
    // Restore original content
    if (originalContent !== null) {
      fs.writeFileSync(PENDING_PATH, originalContent);
    } else {
      try { fs.unlinkSync(PENDING_PATH); } catch (_err) { /* ignore */ }
    }
  });

  describe('addItem', () => {
    it('creates item with correct structure', () => {
      const item = addItem('fix the header alignment');
      assert.equal(item.prompt, 'fix the header alignment');
      assert.equal(item.status, 'pending');
      assert.equal(typeof item.id, 'number');
      assert.equal(typeof item.addedAt, 'string');
      // Verify ISO date format
      assert.ok(!isNaN(Date.parse(item.addedAt)));
    });

    it('auto-increments IDs', () => {
      const item1 = addItem('first task');
      const item2 = addItem('second task');
      const item3 = addItem('third task');
      assert.ok(item2.id > item1.id, `Expected ${item2.id} > ${item1.id}`);
      assert.ok(item3.id > item2.id, `Expected ${item3.id} > ${item2.id}`);
    });

    it('trims whitespace from prompt', () => {
      const item = addItem('  spaces around  ');
      assert.equal(item.prompt, 'spaces around');
    });
  });

  describe('listItems', () => {
    it('returns only pending items', () => {
      addItem('task one');
      const item2 = addItem('task two');
      addItem('task three');

      // Mark one as processed
      markProcessed(item2.id);

      const items = listItems();
      assert.equal(items.length, 2);
      assert.ok(items.every(i => i.status === 'pending'));
    });

    it('returns empty array when no items', () => {
      const items = listItems();
      assert.deepEqual(items, []);
    });
  });

  describe('clearItem', () => {
    it('removes specific item by ID', () => {
      const item1 = addItem('task one');
      addItem('task two');

      const removed = clearItem(item1.id);
      assert.equal(removed, true);

      const items = listItems();
      assert.equal(items.length, 1);
      assert.equal(items[0].prompt, 'task two');
    });

    it('returns false for non-existent ID', () => {
      const removed = clearItem(999);
      assert.equal(removed, false);
    });
  });

  describe('clearAll', () => {
    it('empties the queue', () => {
      addItem('task one');
      addItem('task two');
      addItem('task three');

      const result = clearAll();
      assert.equal(result, true);

      const items = listItems();
      assert.equal(items.length, 0);
    });

    it('resets nextId to 1', () => {
      addItem('task one');
      clearAll();

      const data = loadPending();
      assert.equal(data.nextId, 1);
    });
  });

  describe('getPendingCount', () => {
    it('returns correct count', () => {
      assert.equal(getPendingCount(), 0);

      addItem('task one');
      assert.equal(getPendingCount(), 1);

      addItem('task two');
      assert.equal(getPendingCount(), 2);
    });

    it('excludes processed items from count', () => {
      const item1 = addItem('task one');
      addItem('task two');

      markProcessed(item1.id);
      assert.equal(getPendingCount(), 1);
    });
  });

  describe('markProcessed', () => {
    it('changes status to processed', () => {
      const item = addItem('task one');
      markProcessed(item.id);

      const data = loadPending();
      const updated = data.items.find(i => i.id === item.id);
      assert.equal(updated.status, 'processed');
      assert.equal(typeof updated.processedAt, 'string');
    });

    it('does not throw for non-existent ID', () => {
      assert.doesNotThrow(() => markProcessed(999));
    });
  });

  describe('multiple items maintain correct order', () => {
    it('preserves insertion order', () => {
      addItem('first');
      addItem('second');
      addItem('third');

      const items = listItems();
      assert.equal(items[0].prompt, 'first');
      assert.equal(items[1].prompt, 'second');
      assert.equal(items[2].prompt, 'third');
    });
  });

  describe('loading empty/missing file', () => {
    it('returns default structure when file is missing', () => {
      // Delete the file
      try { fs.unlinkSync(PENDING_PATH); } catch (_err) { /* ignore */ }

      const data = loadPending();
      assert.deepEqual(data.items, []);
      assert.equal(data.nextId, 1);
    });
  });
});
