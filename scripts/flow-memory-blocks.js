#!/usr/bin/env node

/**
 * Wogi Flow - Memory Blocks Manager
 *
 * Handles structured memory blocks within progress.md.
 * Allows programmatic access while maintaining human readability.
 *
 * Memory blocks are JSON stored in a markdown comment block,
 * allowing both machine parsing and human readability.
 *
 * Part of v1.7.0 Context Memory Management
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  STATE_DIR,
  colors,
  color,
  warn,
  success,
  error,
  readFile,
  writeFile,
  fileExists,
  printHeader
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const PROGRESS_PATH = PATHS.progress;
const BLOCK_START = '<!-- MEMORY-BLOCKS-START -->';
const BLOCK_END = '<!-- MEMORY-BLOCKS-END -->';

// ============================================================
// Default Structures
// ============================================================

/**
 * Default memory blocks structure
 */
function getDefaultBlocks() {
  return {
    currentTask: null,
    taskQueueSnapshot: {
      readyCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      readyTaskIds: [],
      inProgressTaskIds: [],
      capturedAt: null
    },
    sessionContext: {
      filesModified: [],
      decisionsThisSession: [],
      blockers: []
    },
    keyFacts: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Default progress.md template with memory blocks section
 */
function getDefaultProgress() {
  const blocks = getDefaultBlocks();
  const now = new Date().toISOString().split('T')[0];

  return `# Progress & Handoff Notes

Session handoff notes for human readability.

---

## Last Updated
${now}

---

## Memory Blocks
${BLOCK_START}
\`\`\`json
${JSON.stringify(blocks, null, 2)}
\`\`\`
${BLOCK_END}

---

## Last Session
_No previous session recorded_

## In Progress
_Nothing in progress_

## Next
_No next steps defined_

## Blockers
_None_

## Notes
_No notes_

---
`;
}

// ============================================================
// Core Operations
// ============================================================

/**
 * Read memory blocks from progress.md
 * Returns null if blocks section doesn't exist or is invalid
 */
function readMemoryBlocks() {
  if (!fileExists(PROGRESS_PATH)) {
    return null;
  }

  try {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');

    const startIdx = content.indexOf(BLOCK_START);
    const endIdx = content.indexOf(BLOCK_END);

    if (startIdx === -1 || endIdx === -1) {
      return null;
    }

    // Extract JSON from within the markdown code block
    const blockSection = content.slice(startIdx + BLOCK_START.length, endIdx);
    const jsonMatch = blockSection.match(/```json\n([\s\S]*?)\n```/);

    if (!jsonMatch) {
      return null;
    }

    // Use safe JSON parsing to prevent prototype pollution (Security Rule 2)
    const parsed = JSON.parse(jsonMatch[1].trim());
    // Basic validation - memory blocks should have expected structure
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] Failed to read memory blocks: ${err.message}`);
    }
    return null;
  }
}

/**
 * Write memory blocks to progress.md
 * Creates the section if it doesn't exist
 */
function writeMemoryBlocks(blocks) {
  // Clone to avoid mutating caller's data
  const toWrite = { ...blocks, lastUpdated: new Date().toISOString() };

  let content;
  if (!fileExists(PROGRESS_PATH)) {
    content = getDefaultProgress();
  } else {
    content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
  }

  const blockContent = `${BLOCK_START}
\`\`\`json
${JSON.stringify(toWrite, null, 2)}
\`\`\`
${BLOCK_END}`;

  const startIdx = content.indexOf(BLOCK_START);
  const endIdx = content.indexOf(BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing blocks
    content = content.slice(0, startIdx) + blockContent + content.slice(endIdx + BLOCK_END.length);
  } else {
    // Insert after "## Memory Blocks" header if it exists
    const headerIdx = content.indexOf('## Memory Blocks');
    if (headerIdx !== -1) {
      const insertPoint = content.indexOf('\n', headerIdx) + 1;
      content = content.slice(0, insertPoint) + blockContent + '\n' + content.slice(insertPoint);
    } else {
      // Insert after "## Last Updated" section
      const lastUpdatedIdx = content.indexOf('## Last Updated');
      if (lastUpdatedIdx !== -1) {
        // Find end of Last Updated section (next ---)
        const nextDivider = content.indexOf('---', lastUpdatedIdx + 10);
        if (nextDivider !== -1) {
          const insertPoint = nextDivider + 4;
          content = content.slice(0, insertPoint) + '\n## Memory Blocks\n' + blockContent + '\n\n---\n' + content.slice(insertPoint);
        }
      }
    }
  }

  // Wrap in try-catch per Security Rule 1
  try {
    fs.writeFileSync(PROGRESS_PATH, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[memory-blocks] Failed to write: ${err.message}`);
    }
    return false;
  }
}

/**
 * Get memory blocks, creating defaults if needed
 */
function getOrCreateBlocks() {
  let blocks = readMemoryBlocks();
  if (!blocks) {
    blocks = getDefaultBlocks();
    writeMemoryBlocks(blocks);
  }
  return blocks;
}

/**
 * Capture current task queue state to memory blocks
 * Called before compaction to preserve task awareness across context resets
 * @returns {Object} Updated memory blocks
 */
function captureTaskQueueSnapshot() {
  const blocks = getOrCreateBlocks();
  try {
    const { getReadyData } = require('./flow-utils');
    const readyData = getReadyData();

    blocks.taskQueueSnapshot = {
      readyCount: (readyData.ready || []).length,
      inProgressCount: (readyData.inProgress || []).length,
      blockedCount: (readyData.blocked || []).length,
      readyTaskIds: (readyData.ready || []).slice(0, 20).map(t => typeof t === 'object' ? t.id : t),
      inProgressTaskIds: (readyData.inProgress || []).map(t => typeof t === 'object' ? t.id : t),
      capturedAt: new Date().toISOString()
    };

    writeMemoryBlocks(blocks);
    return blocks;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[memory-blocks] Task queue capture failed: ${err.message}`);
    }
    return blocks;
  }
}

/**
 * Get task queue snapshot from memory blocks
 * @returns {Object|null} Task queue snapshot or null
 */
function getTaskQueueSnapshot() {
  const blocks = readMemoryBlocks();
  return blocks?.taskQueueSnapshot || null;
}

// ============================================================
// Update Operations
// ============================================================

/**
 * Update a specific block by key
 */
function updateBlock(key, value) {
  const blocks = getOrCreateBlocks();
  blocks[key] = value;
  writeMemoryBlocks(blocks);
  return blocks;
}

/**
 * Update current task
 */
function setCurrentTask(taskId, taskTitle, metadata = {}) {
  return updateBlock('currentTask', {
    id: taskId,
    title: taskTitle,
    startedAt: new Date().toISOString(),
    ...metadata
  });
}

/**
 * Clear current task
 */
function clearCurrentTask() {
  return updateBlock('currentTask', null);
}

/**
 * Add a key fact (max 10 kept)
 */
function addKeyFact(fact) {
  const blocks = getOrCreateBlocks();

  if (!blocks.keyFacts.includes(fact)) {
    blocks.keyFacts.push(fact);

    // Keep only last 10 facts
    if (blocks.keyFacts.length > 10) {
      blocks.keyFacts = blocks.keyFacts.slice(-10);
    }

    writeMemoryBlocks(blocks);
  }

  return blocks;
}

/**
 * Remove a key fact
 */
function removeKeyFact(fact) {
  const blocks = getOrCreateBlocks();
  blocks.keyFacts = blocks.keyFacts.filter(f => f !== fact);
  writeMemoryBlocks(blocks);
  return blocks;
}

/**
 * Track a file modification
 */
function trackFileModified(filePath) {
  const blocks = getOrCreateBlocks();
  const relPath = path.relative(process.cwd(), filePath);

  if (!blocks.sessionContext.filesModified.includes(relPath)) {
    blocks.sessionContext.filesModified.push(relPath);

    // Keep only last 20 files
    if (blocks.sessionContext.filesModified.length > 20) {
      blocks.sessionContext.filesModified = blocks.sessionContext.filesModified.slice(-20);
    }

    writeMemoryBlocks(blocks);
  }

  return blocks;
}

/**
 * Track a decision made this session
 */
function trackDecision(decision) {
  const blocks = getOrCreateBlocks();

  if (!blocks.sessionContext.decisionsThisSession.includes(decision)) {
    blocks.sessionContext.decisionsThisSession.push(decision);

    // Keep only last 10 decisions
    if (blocks.sessionContext.decisionsThisSession.length > 10) {
      blocks.sessionContext.decisionsThisSession = blocks.sessionContext.decisionsThisSession.slice(-10);
    }

    writeMemoryBlocks(blocks);
  }

  return blocks;
}

/**
 * Add a blocker
 */
function addBlocker(blocker) {
  const blocks = getOrCreateBlocks();

  if (!blocks.sessionContext.blockers.includes(blocker)) {
    blocks.sessionContext.blockers.push(blocker);
    writeMemoryBlocks(blocks);
  }

  return blocks;
}

/**
 * Remove a blocker
 */
function removeBlocker(blocker) {
  const blocks = getOrCreateBlocks();
  blocks.sessionContext.blockers = blocks.sessionContext.blockers.filter(b => b !== blocker);
  writeMemoryBlocks(blocks);
  return blocks;
}

/**
 * Clear all blockers
 */
function clearBlockers() {
  const blocks = getOrCreateBlocks();
  blocks.sessionContext.blockers = [];
  writeMemoryBlocks(blocks);
  return blocks;
}

/**
 * Reset session context (for new session)
 */
function resetSessionContext() {
  const blocks = getOrCreateBlocks();
  blocks.sessionContext = {
    filesModified: [],
    decisionsThisSession: [],
    blockers: []
  };
  // Don't clear currentTask or keyFacts - those persist
  writeMemoryBlocks(blocks);
  return blocks;
}

// ============================================================
// Query Operations
// ============================================================

/**
 * Get current task info
 */
function getCurrentTask() {
  const blocks = readMemoryBlocks();
  return blocks?.currentTask || null;
}

/**
 * Get all key facts
 */
function getKeyFacts() {
  const blocks = readMemoryBlocks();
  return blocks?.keyFacts || [];
}

/**
 * Get session context
 */
function getSessionContext() {
  const blocks = readMemoryBlocks();
  return blocks?.sessionContext || {
    filesModified: [],
    decisionsThisSession: [],
    blockers: []
  };
}

/**
 * Get summary for Claude (useful for resume context)
 */
function getResumeContext() {
  const blocks = readMemoryBlocks();
  if (!blocks) return null;

  const lines = [];

  if (blocks.currentTask) {
    lines.push(`**Resuming task**: ${blocks.currentTask.id} - ${blocks.currentTask.title}`);
    if (blocks.currentTask.startedAt) {
      const started = new Date(blocks.currentTask.startedAt);
      lines.push(`  Started: ${started.toLocaleString()}`);
    }
  }

  if (blocks.sessionContext?.filesModified?.length > 0) {
    lines.push(`**Recently modified**: ${blocks.sessionContext.filesModified.slice(-5).join(', ')}`);
  }

  if (blocks.keyFacts?.length > 0) {
    lines.push(`**Key context**:`);
    for (const fact of blocks.keyFacts.slice(-5)) {
      lines.push(`  - ${fact}`);
    }
  }

  if (blocks.sessionContext?.blockers?.length > 0) {
    lines.push(`**Blockers**: ${blocks.sessionContext.blockers.join(', ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

// ============================================================
// Migration
// ============================================================

/**
 * Migrate existing progress.md to include memory blocks
 * Only adds blocks section if it doesn't exist
 */
function migrateProgressFile() {
  if (!fileExists(PROGRESS_PATH)) {
    // Create with template
    fs.writeFileSync(PROGRESS_PATH, getDefaultProgress());
    return { migrated: true, action: 'created' };
  }

  const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');

  if (content.includes(BLOCK_START)) {
    return { migrated: false, reason: 'already has memory blocks' };
  }

  // Add memory blocks section
  writeMemoryBlocks(getDefaultBlocks());
  return { migrated: true, action: 'updated' };
}

// ============================================================
// CLI Interface
// ============================================================

function printUsage() {
  console.log(`
Usage: flow-memory-blocks.js [command] [args]

Commands:
  show              Show current memory blocks
  migrate           Add memory blocks to existing progress.md
  task <id> <title> Set current task
  task clear        Clear current task
  fact add <fact>   Add a key fact
  fact remove <idx> Remove a key fact by index
  fact list         List all key facts
  file <path>       Track file modification
  decision <text>   Track a decision
  blocker add <b>   Add a blocker
  blocker clear     Clear all blockers
  reset-session     Reset session context
  resume            Show resume context
  --help            Show this help

Examples:
  node scripts/flow-memory-blocks.js show
  node scripts/flow-memory-blocks.js task TASK-042 "Add login form"
  node scripts/flow-memory-blocks.js fact add "Using React 18 with TypeScript"
`);
}

// Main CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'show': {
      const blocks = readMemoryBlocks();
      if (blocks) {
        printHeader('Memory Blocks');
        console.log(JSON.stringify(blocks, null, 2));
      } else {
        warn('No memory blocks found. Run "migrate" to add them.');
      }
      break;
    }

    case 'migrate': {
      const result = migrateProgressFile();
      if (result.migrated) {
        success(`Progress file ${result.action} with memory blocks`);
      } else {
        console.log(`No migration needed: ${result.reason}`);
      }
      break;
    }

    case 'task': {
      if (args[1] === 'clear') {
        clearCurrentTask();
        success('Current task cleared');
      } else if (args[1] && args[2]) {
        setCurrentTask(args[1], args.slice(2).join(' '));
        success(`Set current task: ${args[1]}`);
      } else {
        const task = getCurrentTask();
        if (task) {
          console.log(`Current task: ${task.id} - ${task.title}`);
        } else {
          console.log('No current task');
        }
      }
      break;
    }

    case 'fact': {
      if (args[1] === 'add' && args[2]) {
        addKeyFact(args.slice(2).join(' '));
        success('Key fact added');
      } else if (args[1] === 'remove' && args[2]) {
        const facts = getKeyFacts();
        const idx = parseInt(args[2], 10);
        if (idx >= 0 && idx < facts.length) {
          removeKeyFact(facts[idx]);
          success(`Removed fact: "${facts[idx]}"`);
        } else {
          error(`Invalid index: ${args[2]}`);
        }
      } else if (args[1] === 'list') {
        const facts = getKeyFacts();
        if (facts.length > 0) {
          console.log('Key facts:');
          facts.forEach((f, i) => console.log(`  ${i}. ${f}`));
        } else {
          console.log('No key facts');
        }
      } else {
        error('Usage: fact [add|remove|list] [args]');
      }
      break;
    }

    case 'file': {
      if (args[1]) {
        trackFileModified(args[1]);
        success(`Tracked file: ${args[1]}`);
      } else {
        const ctx = getSessionContext();
        console.log('Modified files:', ctx.filesModified.join(', ') || 'none');
      }
      break;
    }

    case 'decision': {
      if (args[1]) {
        trackDecision(args.slice(1).join(' '));
        success('Decision tracked');
      } else {
        const ctx = getSessionContext();
        console.log('Decisions:', ctx.decisionsThisSession.join(', ') || 'none');
      }
      break;
    }

    case 'blocker': {
      if (args[1] === 'add' && args[2]) {
        addBlocker(args.slice(2).join(' '));
        success('Blocker added');
      } else if (args[1] === 'clear') {
        clearBlockers();
        success('Blockers cleared');
      } else {
        const ctx = getSessionContext();
        console.log('Blockers:', ctx.blockers.join(', ') || 'none');
      }
      break;
    }

    case 'reset-session': {
      resetSessionContext();
      success('Session context reset');
      break;
    }

    case 'resume': {
      const ctx = getResumeContext();
      if (ctx) {
        printHeader('Resume Context');
        console.log(ctx);
      } else {
        console.log('No resume context available');
      }
      break;
    }

    case '--help':
    case '-h':
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
  // Core operations
  readMemoryBlocks,
  writeMemoryBlocks,
  getOrCreateBlocks,
  updateBlock,

  // Task operations
  setCurrentTask,
  clearCurrentTask,
  getCurrentTask,

  // Task queue snapshot (for compaction survival)
  captureTaskQueueSnapshot,
  getTaskQueueSnapshot,

  // Key facts
  addKeyFact,
  removeKeyFact,
  getKeyFacts,

  // Session tracking
  trackFileModified,
  trackDecision,
  addBlocker,
  removeBlocker,
  clearBlockers,
  getSessionContext,
  resetSessionContext,

  // Resume context
  getResumeContext,

  // Migration
  migrateProgressFile,

  // Defaults
  getDefaultBlocks,
  getDefaultProgress,

  // Constants
  BLOCK_START,
  BLOCK_END
};
