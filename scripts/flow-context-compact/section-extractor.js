#!/usr/bin/env node

/**
 * Section Extractor
 *
 * Extracts relevant sections from the summary tree based on query context.
 * Uses keyword matching and relevance scoring to select what to expand.
 *
 * Selection Strategy:
 * 1. Always include root summary
 * 2. Include section summaries that match keywords
 * 3. Expand detail nodes only if highly relevant to query
 * 4. Respect token budget constraints
 */

const path = require('path');
const { getConfig } = require('../flow-utils');
const { loadTree, estimateTokens, calculateTreeTokens } = require('./summary-tree');

// ============================================================
// Relevance Scoring
// ============================================================

/**
 * Extract keywords from text
 * @param {string} text - Text to extract keywords from
 * @returns {string[]} Lowercase keywords
 */
function extractKeywords(text) {
  if (!text) return [];

  // Remove common words and punctuation
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'this', 'that', 'these',
    'those', 'it', 'its', 'i', 'you', 'we', 'they', 'he', 'she'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate keyword overlap score between two texts
 * @param {string[]} queryKeywords - Query keywords
 * @param {string} text - Text to match against
 * @returns {number} Score 0-1
 */
function calculateKeywordOverlap(queryKeywords, text) {
  if (!queryKeywords.length || !text) return 0;

  const textKeywords = new Set(extractKeywords(text));
  let matches = 0;

  for (const keyword of queryKeywords) {
    if (textKeywords.has(keyword)) {
      matches++;
    }
  }

  return matches / queryKeywords.length;
}

/**
 * Score node relevance to a query
 * @param {Object} node - Tree node
 * @param {string} query - Query string
 * @param {string[]} queryKeywords - Pre-extracted query keywords
 * @returns {number} Relevance score 0-1
 */
function scoreNodeRelevance(node, query, queryKeywords) {
  // Base relevance from node's stored relevance
  let score = node.relevance * 0.3;

  // Keyword match in summary
  const summaryMatch = calculateKeywordOverlap(queryKeywords, node.summary);
  score += summaryMatch * 0.4;

  // Keyword match in content (if present)
  if (node.content) {
    const contentMatch = calculateKeywordOverlap(queryKeywords, node.content);
    score += contentMatch * 0.2;
  }

  // Type-based bonus for certain queries
  const queryLower = query.toLowerCase();

  if (node.type === 'task' && /task|progress|status|work/i.test(query)) {
    score += 0.1;
  }
  if (node.type === 'file' && /file|code|change|modify/i.test(query)) {
    score += 0.1;
  }
  if (node.type === 'decision' && /decision|decide|chose|why/i.test(query)) {
    score += 0.1;
  }
  if (node.type === 'context' && /context|remember|important/i.test(query)) {
    score += 0.1;
  }

  return Math.min(1, score);
}

// ============================================================
// Section Selection
// ============================================================

/**
 * Select nodes to include based on query and budget
 * @param {Object} tree - Summary tree
 * @param {Object} options - Selection options
 * @returns {Object[]} Selected nodes with scores
 */
function selectNodes(tree, options = {}) {
  const {
    query = '',
    maxTokens = 10000,
    minRelevance = 0.2,
    alwaysIncludeTypes = ['root', 'tasks']
  } = options;

  const config = getConfig();
  const compactionConfig = config.context?.compaction || {};

  const queryKeywords = extractKeywords(query);
  const selected = [];
  let tokenBudget = maxTokens;

  const root = tree.nodes[tree.rootId];
  if (!root) return [];

  // Always include root
  selected.push({
    node: root,
    score: 1.0,
    includeContent: false,
    reason: 'root'
  });
  tokenBudget -= estimateTokens(root.summary);

  // Score all sections
  const sectionScores = [];
  for (const sectionId of root.children) {
    const section = tree.nodes[sectionId];
    if (!section) continue;

    const score = scoreNodeRelevance(section, query, queryKeywords);
    sectionScores.push({ section, score, id: sectionId });
  }

  // Sort sections by score
  sectionScores.sort((a, b) => b.score - a.score);

  // Include sections based on score and budget
  for (const { section, score, id } of sectionScores) {
    // Always include certain types
    const alwaysInclude = alwaysIncludeTypes.includes(section.type);

    if (!alwaysInclude && score < minRelevance) {
      continue;
    }

    const sectionTokens = estimateTokens(section.summary);

    if (tokenBudget >= sectionTokens) {
      selected.push({
        node: section,
        score,
        includeContent: false,
        reason: alwaysInclude ? 'required_type' : 'relevant'
      });
      tokenBudget -= sectionTokens;

      // Check if we should expand children
      if (score >= 0.5 || alwaysInclude) {
        // Score children
        const childScores = [];
        for (const childId of section.children) {
          const child = tree.nodes[childId];
          if (!child) continue;

          const childScore = scoreNodeRelevance(child, query, queryKeywords);
          childScores.push({ child, score: childScore, id: childId });
        }

        // Sort and include top children within budget
        childScores.sort((a, b) => b.score - a.score);

        for (const { child, score: childScore } of childScores) {
          if (childScore < minRelevance && !alwaysInclude) continue;

          const childTokens = estimateTokens(child.summary);
          const contentTokens = estimateTokens(child.content);

          // Decide whether to include full content
          const includeContent = childScore >= 0.7 && tokenBudget >= childTokens + contentTokens;

          const neededTokens = includeContent ? childTokens + contentTokens : childTokens;

          if (tokenBudget >= neededTokens) {
            selected.push({
              node: child,
              score: childScore,
              includeContent,
              reason: 'child_of_relevant'
            });
            tokenBudget -= neededTokens;
          }
        }
      }
    }
  }

  return selected;
}

// ============================================================
// Extraction & Formatting
// ============================================================

/**
 * Extract and format selected sections
 * @param {Object} tree - Summary tree
 * @param {Object[]} selectedNodes - Selected nodes from selectNodes()
 * @returns {string} Formatted context
 */
function formatSelectedContext(tree, selectedNodes) {
  const lines = [];

  // Group by level
  const roots = selectedNodes.filter(n => n.node.level === 0);
  const sections = selectedNodes.filter(n => n.node.level === 1);
  const details = selectedNodes.filter(n => n.node.level === 2);

  // Root
  for (const { node } of roots) {
    lines.push(`# Context Summary`);
    lines.push(node.summary);
    lines.push('');
  }

  // Build section map
  const sectionMap = new Map();
  for (const { node } of sections) {
    sectionMap.set(node.id, {
      node,
      children: details.filter(d => {
        // Find parent section
        return sections.some(s => s.node.children?.includes(d.node.id));
      })
    });
  }

  // Output by section
  for (const { node, score } of sections) {
    const relevanceTag = score >= 0.7 ? '(highly relevant)' : score >= 0.4 ? '(relevant)' : '';
    lines.push(`## ${node.type}: ${node.summary} ${relevanceTag}`);

    // Include children of this section
    const sectionChildren = details.filter(d =>
      node.children?.includes(d.node.id)
    );

    for (const { node: child, includeContent, score: childScore } of sectionChildren) {
      lines.push(`- ${child.summary}`);

      if (includeContent && child.content) {
        const content = child.content.length > 500
          ? child.content.substring(0, 500) + '...'
          : child.content;
        lines.push('  ```');
        lines.push('  ' + content.split('\n').join('\n  '));
        lines.push('  ```');
      }
    }

    lines.push('');
  }

  // Token count footer
  const totalTokens = selectedNodes.reduce((sum, n) => {
    return sum + estimateTokens(n.node.summary) + (n.includeContent ? estimateTokens(n.node.content) : 0);
  }, 0);
  lines.push(`---`);
  lines.push(`_Context: ${selectedNodes.length} nodes, ~${totalTokens} tokens_`);

  return lines.join('\n');
}

/**
 * Extract relevant context for a query
 * @param {string} query - Query or task description
 * @param {Object} options - Extraction options
 * @returns {Object} { context: string, stats: Object, nodes: Object[] }
 */
function extractRelevantContext(query, options = {}) {
  const tree = loadTree();

  if (!tree) {
    return {
      context: '# No Context Available\n\nNo previous context has been saved.',
      stats: { nodeCount: 0, tokens: 0 },
      nodes: []
    };
  }

  const selectedNodes = selectNodes(tree, { query, ...options });
  const context = formatSelectedContext(tree, selectedNodes);

  const stats = {
    nodeCount: selectedNodes.length,
    tokens: selectedNodes.reduce((sum, n) => {
      return sum + estimateTokens(n.node.summary) + (n.includeContent ? estimateTokens(n.node.content) : 0);
    }, 0),
    treeStats: calculateTreeTokens(tree),
    compressionRatio: calculateTreeTokens(tree).total > 0
      ? (selectedNodes.reduce((sum, n) => sum + (n.includeContent ? n.node.tokens : estimateTokens(n.node.summary)), 0) / calculateTreeTokens(tree).total)
      : 0
  };

  return { context, stats, nodes: selectedNodes };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Scoring
  extractKeywords,
  calculateKeywordOverlap,
  scoreNodeRelevance,

  // Selection
  selectNodes,

  // Extraction
  formatSelectedContext,
  extractRelevantContext
};
