#!/usr/bin/env node

/**
 * Wogi Flow - Hierarchical Task Utilities
 *
 * Helpers for traversing epic → feature → story → task hierarchies stored
 * in ready.json. Extracted from flow-utils.js (wf-94cc3b72 epic —
 * flow-utils decomposition).
 *
 * Pure functions — no filesystem side effects.
 */

'use strict';

/**
 * Normalize a task object to include optional hierarchical fields.
 * Ensures backward compatibility with existing tasks.
 * @param {Object|string} task - Task object (or legacy string ID)
 * @returns {Object|string} Normalized task with all optional fields, or
 *   passthrough for legacy string IDs.
 */
function normalizeTask(task) {
  if (!task || typeof task === 'string') {
    return task; // Can't normalize string IDs (legacy format)
  }

  return {
    ...task,
    // Default level based on type if not set
    level: task.level || (task.type === 'epic' ? 'L0' : task.type === 'story' ? 'L1' : 'L2'),
    // Use existing parent field (backward compatible)
    parent: task.parent || null,
    // Child task IDs
    children: task.children || [],
    // Progress tracking for hierarchical items
    progress: task.progress || null
  };
}

/**
 * Find all tasks with a given parent ID.
 * @param {Object} readyData - Ready.json data
 * @param {string} parentId - Parent task ID
 * @returns {Object[]} Array of child tasks
 */
function findAllWithParent(readyData, parentId) {
  const children = [];
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = readyData[listName] || [];
    for (const task of list) {
      if (task && typeof task !== 'string' && task.parent === parentId) {
        children.push(task);
      }
    }
  }

  return children;
}

/**
 * Find a task in all lists by ID.
 * @param {Object} readyData - Ready.json data
 * @param {string} taskId - Task ID to find
 * @returns {Object|null} Task object or null if not found
 */
function findTaskInAllLists(readyData, taskId) {
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = readyData[listName] || [];
    for (const task of list) {
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) {
        return typeof task === 'string' ? { id: task } : task;
      }
    }
  }

  return null;
}

module.exports = {
  normalizeTask,
  findAllWithParent,
  findTaskInAllLists,
};
