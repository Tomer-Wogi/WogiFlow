#!/usr/bin/env node

/**
 * Summary Tree Builder
 *
 * Builds hierarchical summary trees for context compaction.
 * Based on recursive language model principles - summarize at multiple
 * levels to enable on-demand expansion.
 *
 * Tree Structure:
 * - Root: High-level overview (1-2 sentences)
 * - L1: Section summaries (session goals, tasks, decisions)
 * - L2: Detailed items (specific files, changes, code snippets)
 *
 * Each node has:
 * - id: Unique identifier
 * - level: Depth in tree (0=root, 1=section, 2=detail)
 * - summary: Compressed representation
 * - content: Original content (for leaf nodes)
 * - children: Child node IDs
 * - tokens: Estimated token count
 * - relevance: Current relevance score (0-1)
 */

const path = require('path');
const crypto = require('crypto');
const { getConfig, readJson, writeJson, ensureDir, PATHS } = require('../flow-utils');

// ============================================================
// Configuration
// ============================================================

const COMPACT_STATE_PATH = path.join(PATHS.state, 'context-tree.json');

/**
 * Default compaction thresholds
 */
const DEFAULT_COMPACTION_CONFIG = {
  enabled: true,
  // Token thresholds for triggering compaction
  thresholds: {
    warnAt: 50000,      // Warn when estimated tokens exceed this
    compactAt: 80000,   // Auto-compact when exceeding this
    maxExpanded: 20000  // Max tokens to expand at once
  },
  // Summary generation settings
  summary: {
    rootMaxLength: 200,     // Max chars for root summary
    sectionMaxLength: 500,  // Max chars for section summary
    detailMaxLength: 1000   // Max chars for detail summary
  },
  // Relevance decay
  relevanceDecay: {
    enabled: true,
    decayPerTurn: 0.05     // Decay older items each turn
  }
};

// ============================================================
// Node Operations
// ============================================================

// Token estimation constant (rough approximation for English text)
const CHARS_PER_TOKEN = 4;

/**
 * Generate a unique node ID
 * @returns {string} UUID
 */
function generateNodeId() {
  return crypto.randomUUID();
}

/**
 * Estimate token count from text
 * Rough approximation: ~4 chars per token for English
 * @param {string} text - Text to estimate
 * @returns {number} Estimated tokens
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Create a new tree node
 * @param {Object} options - Node options
 * @returns {Object} Node object
 */
function createNode({
  level = 0,
  type = 'generic',
  summary = '',
  content = '',
  children = [],
  metadata = {}
}) {
  return {
    id: generateNodeId(),
    level,
    type,
    summary,
    content: level >= 2 ? content : '', // Only store full content at leaf level
    children,
    tokens: estimateTokens(summary) + estimateTokens(content),
    relevance: 1.0,
    created: new Date().toISOString(),
    accessed: new Date().toISOString(),
    metadata
  };
}

// ============================================================
// Tree Building
// ============================================================

/**
 * Build a summary tree from session state
 * @param {Object} sessionData - Session data to summarize
 * @returns {Object} Summary tree
 */
function buildSummaryTree(sessionData) {
  const tree = {
    version: '1.0.0',
    created: new Date().toISOString(),
    rootId: null,
    nodes: {}
  };

  // Create root node
  const root = createNode({
    level: 0,
    type: 'root',
    summary: sessionData.goal || 'Session summary',
    metadata: {
      sessionId: sessionData.sessionId,
      startTime: sessionData.startTime
    }
  });
  tree.rootId = root.id;
  tree.nodes[root.id] = root;

  // Create section nodes
  const sections = [];

  // Tasks section
  if (sessionData.tasks && sessionData.tasks.length > 0) {
    const tasksSection = createNode({
      level: 1,
      type: 'tasks',
      summary: `${sessionData.tasks.length} tasks: ${sessionData.tasks.map(t => t.title || t.id).slice(0, 3).join(', ')}${sessionData.tasks.length > 3 ? '...' : ''}`,
      metadata: { count: sessionData.tasks.length }
    });

    // Create detail nodes for each task
    for (const task of sessionData.tasks) {
      const taskNode = createNode({
        level: 2,
        type: 'task',
        summary: task.title || task.id,
        content: JSON.stringify(task, null, 2),
        metadata: {
          taskId: task.id,
          status: task.status
        }
      });
      tasksSection.children.push(taskNode.id);
      tree.nodes[taskNode.id] = taskNode;
    }

    sections.push(tasksSection);
    tree.nodes[tasksSection.id] = tasksSection;
  }

  // Decisions section
  if (sessionData.decisions && sessionData.decisions.length > 0) {
    const decisionsSection = createNode({
      level: 1,
      type: 'decisions',
      summary: `${sessionData.decisions.length} decisions made`,
      metadata: { count: sessionData.decisions.length }
    });

    for (const decision of sessionData.decisions) {
      const decisionNode = createNode({
        level: 2,
        type: 'decision',
        summary: typeof decision === 'string' ? decision.substring(0, 100) : decision.title || 'Decision',
        content: typeof decision === 'string' ? decision : JSON.stringify(decision, null, 2),
        metadata: {}
      });
      decisionsSection.children.push(decisionNode.id);
      tree.nodes[decisionNode.id] = decisionNode;
    }

    sections.push(decisionsSection);
    tree.nodes[decisionsSection.id] = decisionsSection;
  }

  // Files changed section
  if (sessionData.files && sessionData.files.length > 0) {
    const filesSection = createNode({
      level: 1,
      type: 'files',
      summary: `${sessionData.files.length} files modified`,
      metadata: { count: sessionData.files.length }
    });

    for (const file of sessionData.files) {
      const fileName = typeof file === 'string' ? file : file.path;
      const fileNode = createNode({
        level: 2,
        type: 'file',
        summary: path.basename(fileName),
        content: typeof file === 'string' ? file : JSON.stringify(file, null, 2),
        metadata: { path: fileName }
      });
      filesSection.children.push(fileNode.id);
      tree.nodes[fileNode.id] = fileNode;
    }

    sections.push(filesSection);
    tree.nodes[filesSection.id] = filesSection;
  }

  // Context section (preserved important context)
  if (sessionData.context && Object.keys(sessionData.context).length > 0) {
    const contextSection = createNode({
      level: 1,
      type: 'context',
      summary: 'Important context preserved',
      metadata: {}
    });

    for (const [key, value] of Object.entries(sessionData.context)) {
      const contextNode = createNode({
        level: 2,
        type: 'context-item',
        summary: key,
        content: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        metadata: { key }
      });
      contextSection.children.push(contextNode.id);
      tree.nodes[contextNode.id] = contextNode;
    }

    sections.push(contextSection);
    tree.nodes[contextSection.id] = contextSection;
  }

  // Link sections to root
  root.children = sections.map(s => s.id);

  // Update root summary with section count
  root.summary = `Session: ${sessionData.goal || 'Work session'}. Contains ${sections.length} sections.`;

  return tree;
}

/**
 * Merge new data into existing tree
 * @param {Object} existingTree - Existing summary tree
 * @param {Object} newData - New session data to add
 * @returns {Object} Updated tree
 */
function mergeIntoTree(existingTree, newData) {
  const tree = JSON.parse(JSON.stringify(existingTree)); // Deep clone

  // Apply relevance decay to existing nodes
  const config = getConfig();
  const compactionConfig = config.context?.compaction || DEFAULT_COMPACTION_CONFIG;

  if (compactionConfig.relevanceDecay?.enabled) {
    const decayRate = compactionConfig.relevanceDecay.decayPerTurn || 0.05;
    for (const node of Object.values(tree.nodes)) {
      node.relevance = Math.max(0.1, node.relevance - decayRate);
    }
  }

  // Build tree from new data
  const newTree = buildSummaryTree(newData);

  // Merge sections
  const root = tree.nodes[tree.rootId];

  for (const newSectionId of newTree.nodes[newTree.rootId].children) {
    const newSection = newTree.nodes[newSectionId];

    // Find existing section of same type
    const existingSection = root.children
      .map(id => tree.nodes[id])
      .find(s => s.type === newSection.type);

    if (existingSection) {
      // Merge children into existing section
      for (const newChildId of newSection.children) {
        const newChild = newTree.nodes[newChildId];
        newChild.id = generateNodeId(); // Generate new ID
        tree.nodes[newChild.id] = newChild;
        existingSection.children.push(newChild.id);
      }

      // Update section summary
      existingSection.summary = `${existingSection.children.length} ${existingSection.type}`;
      existingSection.relevance = 1.0; // Reset relevance for updated sections
    } else {
      // Add new section
      newSection.id = generateNodeId();
      tree.nodes[newSection.id] = newSection;

      // Re-add children with new IDs
      const newChildIds = [];
      for (const childId of newSection.children) {
        const child = newTree.nodes[childId];
        child.id = generateNodeId();
        tree.nodes[child.id] = child;
        newChildIds.push(child.id);
      }
      newSection.children = newChildIds;

      root.children.push(newSection.id);
    }
  }

  // Update root
  root.summary = `Session summary with ${root.children.length} sections`;
  root.relevance = 1.0;
  tree.updated = new Date().toISOString();

  return tree;
}

// ============================================================
// Tree Serialization
// ============================================================

/**
 * Serialize tree to compact format
 * @param {Object} tree - Summary tree
 * @param {number} maxLevel - Maximum level to expand (0=root only, 1=sections, 2=all)
 * @returns {string} Serialized tree
 */
function serializeTree(tree, maxLevel = 1) {
  const lines = [];
  const root = tree.nodes[tree.rootId];

  lines.push(`# ${root.summary}`);
  lines.push('');

  if (maxLevel >= 1) {
    for (const sectionId of root.children) {
      const section = tree.nodes[sectionId];
      if (!section) continue;

      lines.push(`## ${section.type}: ${section.summary}`);

      if (maxLevel >= 2) {
        for (const childId of section.children) {
          const child = tree.nodes[childId];
          if (!child) continue;

          lines.push(`  - ${child.summary}`);
          if (maxLevel >= 3 && child.content) {
            lines.push(`    ${child.content.substring(0, 200)}...`);
          }
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Calculate total tokens in tree
 * @param {Object} tree - Summary tree
 * @returns {Object} Token stats
 */
function calculateTreeTokens(tree) {
  let totalTokens = 0;
  let summaryTokens = 0;
  let contentTokens = 0;

  for (const node of Object.values(tree.nodes)) {
    summaryTokens += estimateTokens(node.summary);
    contentTokens += estimateTokens(node.content);
    totalTokens += node.tokens;
  }

  return {
    total: totalTokens,
    summary: summaryTokens,
    content: contentTokens,
    nodeCount: Object.keys(tree.nodes).length
  };
}

// ============================================================
// Persistence
// ============================================================

/**
 * Save tree to file
 * @param {Object} tree - Summary tree
 */
function saveTree(tree) {
  ensureDir(path.dirname(COMPACT_STATE_PATH));
  writeJson(COMPACT_STATE_PATH, tree);
}

/**
 * Load tree from file
 * @returns {Object|null} Summary tree or null
 */
function loadTree() {
  const fs = require('fs');
  if (!fs.existsSync(COMPACT_STATE_PATH)) {
    return null;
  }
  try {
    return readJson(COMPACT_STATE_PATH);
  } catch {
    return null;
  }
}

/**
 * Check if tree exists
 * @returns {boolean}
 */
function treeExists() {
  const fs = require('fs');
  return fs.existsSync(COMPACT_STATE_PATH);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  DEFAULT_COMPACTION_CONFIG,
  COMPACT_STATE_PATH,

  // Node operations
  generateNodeId,
  estimateTokens,
  createNode,

  // Tree building
  buildSummaryTree,
  mergeIntoTree,

  // Serialization
  serializeTree,
  calculateTreeTokens,

  // Persistence
  saveTree,
  loadTree,
  treeExists
};
