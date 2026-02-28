#!/usr/bin/env node

/**
 * Wogi Flow - PRD Manager
 *
 * Manages Project Requirements Documents (PRDs) with:
 * - Loading and chunking PRD content
 * - Semantic storage for contextual retrieval (via flow-memory-db)
 * - Task-aware context extraction with embeddings
 *
 * Part of v1.8.0 Team Collaboration
 *
 * Usage:
 *   ./scripts/flow prd load <file>     Load PRD into memory
 *   ./scripts/flow prd context <task>  Get relevant PRD context for task
 *   ./scripts/flow prd list            List loaded PRDs
 *   ./scripts/flow prd clear           Clear PRD memory
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  colors,
  color,
  success,
  warn,
  error,
  info,
  printHeader,
  fileExists,
  readFile
} = require('./flow-utils');

// Use shared memory database
const memoryDb = require('./flow-memory-db');

// ============================================================
// Constants
// ============================================================

const DEFAULT_MAX_CONTEXT_TOKENS = 2000;

// ============================================================
// PRD Loading
// ============================================================

/**
 * Load a PRD file into storage (using shared database)
 */
async function loadPRD(filePath, options = {}) {
  if (!fileExists(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFile(filePath);
  const fileName = path.basename(filePath);
  const prdId = options.id || fileName.replace(/\.[^.]+$/, '');

  // Use shared database to store PRD with embeddings
  const result = await memoryDb.storePRD({
    content,
    prdId,
    fileName
  });

  return result;
}

// ============================================================
// Context Retrieval
// ============================================================

/**
 * Get relevant PRD context for a task (using semantic search)
 *
 * @param {string} taskDescription - The task description or query
 * @param {object} options - Retrieval options
 * @returns {string} Formatted context for the task
 */
async function getPRDContext(taskDescription, options = {}) {
  const config = getConfig();
  const maxTokens = options.maxTokens || config.prd?.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS;

  const result = await memoryDb.getPRDContext({
    query: taskDescription,
    maxTokens,
    prdId: options.prdId
  });

  return result ? result.context : null;
}

/**
 * List loaded PRDs
 */
async function listPRDs() {
  const prds = await memoryDb.listPRDs();
  return prds.map(p => ({
    id: p.prd_id,
    fileName: p.file_name,
    chunkCount: p.chunk_count,
    loadedAt: p.created_at
  }));
}

/**
 * Clear all PRD data
 */
async function clearPRDs() {
  await memoryDb.clearPRDs();
}

/**
 * Remove a specific PRD
 */
async function removePRD(prdId) {
  const result = await memoryDb.deletePRD(prdId);
  return result.deleted;
}

// ============================================================
// CLI
// ============================================================

function printUsage() {
  console.log(`
Wogi Flow - PRD Manager

Usage: ./scripts/flow prd <command> [args]

Commands:
  load <file>           Load PRD markdown file into memory
  context <task>        Get relevant PRD context for task
  list                  List loaded PRDs
  remove <prd-id>       Remove a PRD from memory
  clear                 Clear all PRD data
  stats                 Show PRD memory statistics

Examples:
  ./scripts/flow prd load docs/PRD.md
  ./scripts/flow prd context "implement user login"
  ./scripts/flow prd list

Configuration (config.json):
  prd.enabled            Enable PRD features (default: false)
  prd.maxContextTokens   Max tokens for context (default: 2000)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'load': {
      printHeader('Load PRD');

      const filePath = args[1];
      if (!filePath) {
        error('Please provide a file path');
        process.exit(1);
      }

      try {
        info('Loading PRD with embeddings (this may take a moment on first run)...');
        const result = await loadPRD(filePath);
        success(`Loaded PRD: ${result.prdId}`);
        console.log(`  Chunks: ${result.chunkCount}`);
        console.log(`  Sections: ${result.sections.join(', ')}`);
      } catch (err) {
        error(err.message);
        process.exit(1);
      }
      break;
    }

    case 'context': {
      const task = args.slice(1).join(' ');
      if (!task) {
        error('Please provide a task description');
        process.exit(1);
      }

      const context = await getPRDContext(task);
      if (!context) {
        warn('No PRD loaded. Run: ./scripts/flow prd load <file>');
        process.exit(0);
      }

      console.log(context);
      break;
    }

    case 'list': {
      printHeader('Loaded PRDs');

      const prds = await listPRDs();
      if (prds.length === 0) {
        info('No PRDs loaded.');
        info('Load one with: ./scripts/flow prd load <file>');
        break;
      }

      console.log('');
      for (const prd of prds) {
        console.log(`  ${color('green', prd.id)}`);
        console.log(`    File: ${prd.fileName || 'N/A'}`);
        console.log(`    Chunks: ${prd.chunkCount}`);
        console.log(`    Loaded: ${prd.loadedAt}`);
        console.log('');
      }
      break;
    }

    case 'remove': {
      const prdId = args[1];
      if (!prdId) {
        error('Please provide a PRD ID');
        process.exit(1);
      }

      if (await removePRD(prdId)) {
        success(`Removed PRD: ${prdId}`);
      } else {
        error(`PRD not found: ${prdId}`);
        process.exit(1);
      }
      break;
    }

    case 'clear': {
      await clearPRDs();
      success('All PRD data cleared');
      break;
    }

    case 'stats': {
      printHeader('PRD Memory Stats');
      const stats = await memoryDb.getStats();
      console.log('');
      console.log(`  PRDs: ${stats.prds.total}`);
      console.log(`  Chunks: ${stats.prds.chunks}`);
      console.log(`  Facts: ${stats.facts.total}`);
      console.log(`  Proposals: ${stats.proposals.total} (${stats.proposals.pending} pending)`);
      console.log('');
      break;
    }

    case '--help':
    case '-h':
    case 'help':
      printUsage();
      break;

    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  loadPRD,
  getPRDContext,
  listPRDs,
  clearPRDs,
  removePRD
};

if (require.main === module) {
  main().catch(e => {
    error(err.message);
    process.exit(1);
  });
}
