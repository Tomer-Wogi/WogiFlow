#!/usr/bin/env node

/**
 * Recursive Context Compaction System
 *
 * Main entry point for the context compaction module.
 * Provides a unified API for building, querying, and managing
 * the hierarchical summary tree.
 *
 * Usage:
 *   const compact = require('./flow-context-compact');
 *
 *   // Save current session state
 *   compact.saveSession({ goal, tasks, decisions, files });
 *
 *   // Get relevant context for a query
 *   const context = compact.getContext('working on authentication');
 *
 *   // Expand specific details
 *   compact.expandForQuery('show me the auth changes');
 *
 *   // Check context pressure
 *   const pressure = compact.checkPressure();
 */

const summaryTree = require('./summary-tree');
const sectionExtractor = require('./section-extractor');
const expander = require('./expander');

// ============================================================
// High-Level API
// ============================================================

/**
 * Save current session state to the summary tree
 * @param {Object} sessionData - Session data
 * @param {string} sessionData.goal - Session goal/objective
 * @param {Object[]} sessionData.tasks - Tasks worked on
 * @param {Object[]} sessionData.decisions - Decisions made
 * @param {string[]} sessionData.files - Files modified
 * @param {Object} sessionData.context - Additional context to preserve
 * @returns {Object} Save result
 */
function saveSession(sessionData) {
  const existingTree = summaryTree.loadTree();

  let tree;
  if (existingTree) {
    // Merge into existing tree
    tree = summaryTree.mergeIntoTree(existingTree, sessionData);
  } else {
    // Create new tree
    tree = summaryTree.buildSummaryTree(sessionData);
  }

  summaryTree.saveTree(tree);

  const stats = summaryTree.calculateTreeTokens(tree);

  return {
    saved: true,
    isNew: !existingTree,
    stats
  };
}

/**
 * Get context relevant to a query
 * @param {string} query - Query or task description
 * @param {Object} options - Options
 * @returns {Object} Context result
 */
function getContext(query, options = {}) {
  return sectionExtractor.extractRelevantContext(query, options);
}

/**
 * Expand details for a query
 * @param {string} query - Query to expand for
 * @param {Object} options - Expansion options
 * @returns {Object} Expanded content
 */
function expandForQuery(query, options = {}) {
  return expander.expandForQuery(query, options);
}

/**
 * Check current context pressure
 * @returns {Object} Pressure status
 */
function checkPressure() {
  return expander.checkContextPressure();
}

/**
 * Clean up completed plan files from ~/.claude/plans/
 * Plan files that are explicitly marked complete are deleted.
 *
 * Safety: Only deletes files that explicitly contain completion markers.
 * Path traversal protection: Validates resolved paths stay within plansDir.
 *
 * @returns {Object} Cleanup result with cleaned count and file list
 */
function cleanupPlanFiles() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const result = { cleaned: 0, archived: 0, files: [] };

  // Get user's home directory and .claude/plans path
  const homeDir = os.homedir();
  const plansDir = path.join(homeDir, '.claude', 'plans');

  if (!fs.existsSync(plansDir)) {
    return result;
  }

  // Resolve to absolute path for security comparison
  const realPlansDir = path.resolve(plansDir);

  try {
    const files = fs.readdirSync(plansDir);

    for (const file of files) {
      // Only process .md files
      if (!file.endsWith('.md')) continue;

      // Skip files with path separators (potential traversal)
      if (file.includes('/') || file.includes('\\')) continue;

      const filePath = path.join(plansDir, file);

      // Path traversal protection: ensure resolved path is within plansDir
      const realFilePath = path.resolve(filePath);
      if (!realFilePath.startsWith(realPlansDir + path.sep) && realFilePath !== realPlansDir) {
        continue; // Skip files outside target directory
      }

      // Skip symlinks (security measure)
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink()) continue;
      } catch (err) {
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        continue; // Skip files we can't read
      }

      // Check if plan is EXPLICITLY marked complete
      // More restrictive patterns to avoid accidental deletion
      const isComplete =
        /^#\s*Plan:\s*Complete/im.test(content) ||  // Title starts with "Plan: Complete"
        /^This plan (file )?can be deleted\.?$/im.test(content);  // Explicit deletion marker

      if (isComplete) {
        try {
          fs.unlinkSync(filePath);
          result.cleaned++;
          result.files.push(file);
        } catch (err) {
          // Couldn't delete - that's okay
          if (process.env.DEBUG) {
            console.error(`[cleanupPlanFiles] Failed to delete ${file}: ${err.message}`);
          }
        }
      }
    }
  } catch (err) {
    // Error reading plans directory - non-critical
    if (process.env.DEBUG) {
      console.error(`[cleanupPlanFiles] Error: ${err.message}`);
    }
  }

  return result;
}

/**
 * Compact the context (collapse all expansions, optionally prune tree)
 * @param {Object} options - Compaction options
 * @returns {Object} Compaction result
 */
function compact(options = {}) {
  const { pruneOldNodes = false, maxAge = 7 } = options;

  // Clean up completed plan files
  const planCleanup = cleanupPlanFiles();

  // Collapse all expansions
  const collapseResult = expander.collapseAll();

  // Optionally prune old nodes
  let pruneResult = { pruned: 0 };
  if (pruneOldNodes) {
    const tree = summaryTree.loadTree();
    if (tree) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAge);

      // Collect IDs to delete first to avoid mutating during iteration
      const idsToDelete = [];
      for (const [id, node] of Object.entries(tree.nodes)) {
        if (node.level >= 2 && new Date(node.created) < cutoffDate && node.relevance < 0.3) {
          idsToDelete.push(id);
        }
      }

      // Now perform the deletions
      for (const id of idsToDelete) {
        // Remove from parent children arrays
        for (const parent of Object.values(tree.nodes)) {
          if (parent.children?.includes(id)) {
            parent.children = parent.children.filter(c => c !== id);
          }
        }
        delete tree.nodes[id];
      }

      if (idsToDelete.length > 0) {
        summaryTree.saveTree(tree);
      }
      pruneResult.pruned = idsToDelete.length;
    }
  }

  return {
    collapsed: collapseResult.count,
    pruned: pruneResult.pruned,
    plansCleaned: planCleanup.cleaned,
    pressure: checkPressure()
  };
}

/**
 * Get tree statistics
 * @returns {Object} Tree stats
 */
function getStats() {
  const tree = summaryTree.loadTree();
  if (!tree) {
    return {
      exists: false,
      nodes: 0,
      tokens: 0
    };
  }

  const tokenStats = summaryTree.calculateTreeTokens(tree);
  const expandedContext = expander.getExpandedContext();

  return {
    exists: true,
    nodes: tokenStats.nodeCount,
    tokens: tokenStats.total,
    expandedNodes: expandedContext.nodes.length,
    expandedTokens: expandedContext.tokens,
    created: tree.created,
    updated: tree.updated
  };
}

/**
 * Clear all context (reset tree and expansions)
 * @returns {Object} Clear result
 */
function clearAll() {
  const fs = require('fs');

  // Clear tree
  if (summaryTree.treeExists()) {
    fs.unlinkSync(summaryTree.COMPACT_STATE_PATH);
  }

  // Clear expansions
  expander.collapseAll();

  return { cleared: true };
}

/**
 * Get serialized tree for display
 * @param {number} level - Max level to expand
 * @returns {string} Serialized tree
 */
function getSerializedTree(level = 1) {
  const tree = summaryTree.loadTree();
  if (!tree) {
    return '# No Context Saved\n\nRun /wogi-compact to save session context.';
  }

  return summaryTree.serializeTree(tree, level);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // High-level API
  saveSession,
  getContext,
  expandForQuery,
  checkPressure,
  compact,
  getStats,
  clearAll,
  getSerializedTree,
  cleanupPlanFiles,

  // Low-level modules
  summaryTree,
  sectionExtractor,
  expander
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const output = (data) => {
    if (args.includes('--json')) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  };

  switch (command) {
    case 'stats':
      output(getStats());
      break;

    case 'pressure':
      output(checkPressure());
      break;

    case 'show':
      const level = parseInt(args[1]) || 1;
      console.log(getSerializedTree(level));
      break;

    case 'compact':
      output(compact({ pruneOldNodes: args.includes('--prune') }));
      break;

    case 'clear':
      output(clearAll());
      break;

    case 'context':
      const query = args.slice(1).join(' ') || '';
      output(getContext(query));
      break;

    case 'expand':
      const expandQuery = args.slice(1).join(' ') || '';
      output(expandForQuery(expandQuery));
      break;

    default:
      console.log(`
Recursive Context Compaction

Usage: node flow-context-compact [command] [options]

Commands:
  stats              Show tree statistics
  pressure           Check context pressure
  show [level]       Show serialized tree (level 0-2)
  compact [--prune]  Collapse expansions, optionally prune old nodes
  clear              Clear all context
  context <query>    Get context relevant to query
  expand <query>     Expand nodes relevant to query

Options:
  --json             Output as JSON
`);
  }
}
