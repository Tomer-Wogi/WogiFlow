#!/usr/bin/env node

/**
 * On-Demand Expander
 *
 * Expands compressed context nodes when more detail is needed.
 * Uses relevance scoring to prioritize what to expand within token budgets.
 *
 * Expansion Strategy:
 * 1. Start with summaries only
 * 2. When user asks for details, expand relevant nodes
 * 3. Track which nodes have been expanded to avoid re-expansion
 * 4. Clean up old expansions when context pressure increases
 */

const path = require('path');
const { getConfig, readJson, writeJson, ensureDir, PATHS } = require('../flow-utils');
const { loadTree, saveTree, estimateTokens, calculateTreeTokens } = require('./summary-tree');
const { scoreNodeRelevance, extractKeywords } = require('./section-extractor');

// ============================================================
// Expansion State
// ============================================================

const EXPANSION_STATE_PATH = path.join(PATHS.state, 'context-expansions.json');

/**
 * Load expansion state
 * @returns {Object} Expansion state
 */
function loadExpansionState() {
  const fs = require('fs');
  const defaultState = {
    expandedNodes: {},  // nodeId -> { expandedAt, tokens, reason }
    totalExpanded: 0,
    lastCleanup: null
  };

  if (!fs.existsSync(EXPANSION_STATE_PATH)) {
    return defaultState;
  }

  try {
    const state = readJson(EXPANSION_STATE_PATH);
    return state || defaultState;
  } catch {
    return defaultState;
  }
}

/**
 * Save expansion state
 * @param {Object} state - Expansion state
 */
function saveExpansionState(state) {
  ensureDir(path.dirname(EXPANSION_STATE_PATH));
  writeJson(EXPANSION_STATE_PATH, state);
}

/**
 * Check if a node is currently expanded
 * @param {string} nodeId - Node ID
 * @returns {boolean}
 */
function isNodeExpanded(nodeId) {
  const state = loadExpansionState();
  return !!state.expandedNodes[nodeId];
}

/**
 * Mark a node as expanded
 * @param {string} nodeId - Node ID
 * @param {number} tokens - Tokens used
 * @param {string} reason - Why it was expanded
 */
function markExpanded(nodeId, tokens, reason = 'query') {
  const state = loadExpansionState();
  state.expandedNodes[nodeId] = {
    expandedAt: new Date().toISOString(),
    tokens,
    reason
  };
  state.totalExpanded = Object.values(state.expandedNodes)
    .reduce((sum, e) => sum + (e.tokens || 0), 0);
  saveExpansionState(state);
}

/**
 * Mark a node as collapsed
 * @param {string} nodeId - Node ID
 */
function markCollapsed(nodeId) {
  const state = loadExpansionState();
  delete state.expandedNodes[nodeId];
  state.totalExpanded = Object.values(state.expandedNodes)
    .reduce((sum, e) => sum + (e.tokens || 0), 0);
  saveExpansionState(state);
}

// ============================================================
// Expansion Operations
// ============================================================

/**
 * Get expandable nodes from tree
 * @param {Object} tree - Summary tree
 * @returns {Object[]} Expandable nodes
 */
function getExpandableNodes(tree) {
  const expandable = [];
  const state = loadExpansionState();

  for (const [id, node] of Object.entries(tree.nodes)) {
    // Node is expandable if:
    // 1. It has content (not just summary)
    // 2. It's not the root
    // 3. It's not already expanded
    if (node.content && node.level > 0 && !state.expandedNodes[id]) {
      expandable.push({
        id,
        node,
        tokens: estimateTokens(node.content)
      });
    }
  }

  return expandable;
}

/**
 * Expand nodes relevant to a query
 * @param {string} query - Query to match
 * @param {Object} options - Expansion options
 * @returns {Object} Expansion result
 */
function expandForQuery(query, options = {}) {
  const {
    maxTokens = 5000,
    minRelevance = 0.3,
    maxNodes = 10
  } = options;

  const tree = loadTree();
  if (!tree) {
    return {
      expanded: [],
      content: '',
      tokens: 0,
      error: 'No context tree available'
    };
  }

  const queryKeywords = extractKeywords(query);
  const expandable = getExpandableNodes(tree);

  // Score expandable nodes
  const scored = expandable.map(({ id, node, tokens }) => ({
    id,
    node,
    tokens,
    score: scoreNodeRelevance(node, query, queryKeywords)
  }));

  // Sort by relevance
  scored.sort((a, b) => b.score - a.score);

  // Select within budget
  const toExpand = [];
  let tokenBudget = maxTokens;

  for (const item of scored) {
    if (item.score < minRelevance) continue;
    if (toExpand.length >= maxNodes) break;
    if (tokenBudget < item.tokens) continue;

    toExpand.push(item);
    tokenBudget -= item.tokens;
  }

  // Build expanded content
  const lines = [];
  let totalTokens = 0;

  for (const { id, node, tokens, score } of toExpand) {
    markExpanded(id, tokens, `query: ${query.substring(0, 50)}`);

    lines.push(`### ${node.summary}`);
    lines.push('');
    lines.push(node.content);
    lines.push('');

    totalTokens += tokens;
  }

  return {
    expanded: toExpand.map(t => ({
      id: t.id,
      summary: t.node.summary,
      score: t.score,
      tokens: t.tokens
    })),
    content: lines.join('\n'),
    tokens: totalTokens
  };
}

/**
 * Expand a specific node by ID
 * @param {string} nodeId - Node ID to expand
 * @returns {Object} Expansion result
 */
function expandNode(nodeId) {
  const tree = loadTree();
  if (!tree) {
    return { error: 'No context tree available' };
  }

  const node = tree.nodes[nodeId];
  if (!node) {
    return { error: `Node not found: ${nodeId}` };
  }

  if (!node.content) {
    return { error: `Node has no content to expand: ${nodeId}` };
  }

  const tokens = estimateTokens(node.content);
  markExpanded(nodeId, tokens, 'explicit');

  return {
    id: nodeId,
    summary: node.summary,
    content: node.content,
    tokens,
    type: node.type,
    metadata: node.metadata
  };
}

/**
 * Collapse a specific node
 * @param {string} nodeId - Node ID to collapse
 * @returns {Object} Result
 */
function collapseNode(nodeId) {
  markCollapsed(nodeId);
  return { collapsed: nodeId };
}

/**
 * Collapse all expanded nodes
 * @returns {Object} Result
 */
function collapseAll() {
  const state = loadExpansionState();
  const collapsed = Object.keys(state.expandedNodes);

  state.expandedNodes = {};
  state.totalExpanded = 0;
  state.lastCleanup = new Date().toISOString();
  saveExpansionState(state);

  return {
    collapsed,
    count: collapsed.length
  };
}

// ============================================================
// Context Pressure Management
// ============================================================

/**
 * Check current context pressure
 * @returns {Object} Pressure status
 */
function checkContextPressure() {
  const config = getConfig();
  const compactionConfig = config.context?.compaction || {};
  const thresholds = compactionConfig.thresholds || {
    warnAt: 50000,
    compactAt: 80000,
    maxExpanded: 20000
  };

  const tree = loadTree();
  const state = loadExpansionState();

  const treeTokens = tree ? calculateTreeTokens(tree) : { total: 0 };
  const expandedTokens = state.totalExpanded || 0;

  const totalTokens = treeTokens.total + expandedTokens;

  return {
    treeTokens: treeTokens.total,
    expandedTokens,
    totalTokens,
    thresholds,
    status: totalTokens >= thresholds.compactAt ? 'critical' :
            totalTokens >= thresholds.warnAt ? 'warning' : 'normal',
    shouldCollapseSome: expandedTokens > thresholds.maxExpanded,
    recommendation: totalTokens >= thresholds.compactAt ?
      'Compact context immediately' :
      totalTokens >= thresholds.warnAt ?
      'Consider compacting soon' :
      expandedTokens > thresholds.maxExpanded ?
      'Collapse some expanded nodes' : null
  };
}

/**
 * Auto-cleanup based on context pressure
 * @returns {Object} Cleanup result
 */
function autoCleanup() {
  const pressure = checkContextPressure();

  if (!pressure.shouldCollapseSome) {
    return {
      action: 'none',
      reason: 'No cleanup needed'
    };
  }

  const state = loadExpansionState();

  // Find oldest expanded nodes to collapse
  const expanded = Object.entries(state.expandedNodes)
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => new Date(a.expandedAt) - new Date(b.expandedAt));

  // Calculate how many tokens to free
  const targetFreed = state.totalExpanded - (pressure.thresholds.maxExpanded * 0.7);
  let freed = 0;
  const collapsed = [];

  for (const node of expanded) {
    if (freed >= targetFreed) break;

    markCollapsed(node.id);
    freed += node.tokens || 0;
    collapsed.push(node.id);
  }

  return {
    action: 'collapsed',
    collapsed,
    tokensFreed: freed,
    reason: `Context pressure: ${pressure.status}`
  };
}

// ============================================================
// Get Current Expanded Context
// ============================================================

/**
 * Get all currently expanded content
 * @returns {Object} Expanded context
 */
function getExpandedContext() {
  const tree = loadTree();
  const state = loadExpansionState();

  if (!tree) {
    return {
      content: '',
      nodes: [],
      tokens: 0
    };
  }

  const lines = [];
  const nodes = [];
  let totalTokens = 0;

  for (const [nodeId, info] of Object.entries(state.expandedNodes)) {
    const node = tree.nodes[nodeId];
    if (!node) continue;

    lines.push(`### ${node.summary}`);
    lines.push('');
    if (node.content) {
      lines.push(node.content);
      lines.push('');
    }

    nodes.push({
      id: nodeId,
      summary: node.summary,
      expandedAt: info.expandedAt,
      tokens: info.tokens
    });

    totalTokens += info.tokens || 0;
  }

  return {
    content: lines.join('\n'),
    nodes,
    tokens: totalTokens
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // State management
  loadExpansionState,
  saveExpansionState,
  isNodeExpanded,
  markExpanded,
  markCollapsed,

  // Expansion operations
  getExpandableNodes,
  expandForQuery,
  expandNode,
  collapseNode,
  collapseAll,

  // Context pressure
  checkContextPressure,
  autoCleanup,

  // Current state
  getExpandedContext
};
