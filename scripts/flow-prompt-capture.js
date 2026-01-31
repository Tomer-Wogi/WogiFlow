#!/usr/bin/env node

/**
 * Wogi Flow - Prompt Capture System
 *
 * Two-file system for capturing and learning from user prompts:
 * 1. prompt-history.json - Full history of all prompts during task execution
 * 2. clarifications.md - Learning entries from refinement patterns
 *
 * Features:
 * - Captures all user prompts during task execution
 * - Detects refinement/clarification patterns
 * - Tracks refinement count for learning system
 * - Generates learning entries on task completion
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  safeJsonParse,
  writeJson,
  ensureDir,
  fileExists,
  readFile,
  writeFile
} = require('./flow-utils');
const { loadDurableSession } = require('./flow-durable-session');

// ============================================================================
// Constants
// ============================================================================

const PROMPT_HISTORY_FILE = 'prompt-history.json';
const CLARIFICATIONS_FILE = 'clarifications.md';
const MAX_TASK_HISTORY = 50; // Max tasks to keep in history before cleanup

// Patterns that indicate a refinement/clarification
const REFINEMENT_PATTERNS = [
  /^no[,.]?\s/i,                    // "no, I meant..."
  /^not\s(that|what|quite)/i,       // "not that", "not what I meant"
  /^i meant/i,                       // "I meant..."
  /^actually[,.]?\s/i,              // "actually, ..."
  /^let me clarify/i,               // "let me clarify"
  /^to be (more\s)?clear/i,         // "to be clear"
  /^specifically/i,                  // "specifically..."
  /^what i (really\s)?(want|mean)/i, // "what I really want"
  /^that'?s not/i,                   // "that's not..."
  /^you misunderstood/i,            // "you misunderstood"
  /^i (should have|didn'?t)\s/i,    // "I should have mentioned", "I didn't mean"
  /^sorry,?\s*(i|let me)/i,         // "sorry, I meant", "sorry let me"
  /^wait,?\s/i,                      // "wait, ..."
  /^hold on/i,                       // "hold on"
  /^correction:/i,                   // "correction: ..."
  /^instead,?\s/i                    // "instead, ..."
];

// ============================================================================
// Path Helpers
// ============================================================================

function getPromptHistoryPath() {
  return path.join(PATHS.state, PROMPT_HISTORY_FILE);
}

function getClarificationsPath() {
  return path.join(PATHS.state, CLARIFICATIONS_FILE);
}

// ============================================================================
// Refinement Detection
// ============================================================================

/**
 * Detect if a prompt is a refinement/clarification
 * @param {string} prompt - User prompt text
 * @returns {boolean} True if prompt is a refinement
 */
function detectRefinement(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return false;
  }

  const trimmed = prompt.trim();
  return REFINEMENT_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Analyze a prompt for refinement characteristics
 * @param {string} prompt - User prompt text
 * @returns {Object} Analysis result
 */
function analyzePrompt(prompt) {
  const isRefinement = detectRefinement(prompt);

  return {
    isRefinement,
    length: prompt?.length || 0,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// Prompt History Management
// ============================================================================

/**
 * Load prompt history from file
 * @returns {Object} Prompt history keyed by task ID
 */
function loadPromptHistory() {
  const historyPath = getPromptHistoryPath();
  return safeJsonParse(historyPath, {});
}

/**
 * Save prompt history to file
 * @param {Object} history - History object to save
 */
function savePromptHistory(history) {
  const historyPath = getPromptHistoryPath();
  ensureDir(path.dirname(historyPath));
  writeJson(historyPath, history);
}

/**
 * Capture a user prompt for the current task
 * @param {string} taskId - Current task ID
 * @param {string} prompt - User prompt text
 * @param {Object} options - Additional options
 * @param {string} options.taskTitle - Task title
 * @returns {Object} Captured prompt entry
 */
function capturePrompt(taskId, prompt, options = {}) {
  if (!taskId || !prompt) {
    return null;
  }

  const history = loadPromptHistory();

  // Initialize task entry if not exists
  if (!history[taskId]) {
    history[taskId] = {
      taskId,
      title: options.taskTitle || null,
      startedAt: new Date().toISOString(),
      prompts: [],
      refinementCount: 0
    };
  }

  const analysis = analyzePrompt(prompt);
  const isInitial = history[taskId].prompts.length === 0;

  const entry = {
    timestamp: analysis.timestamp,
    content: prompt,
    isInitial,
    isRefinement: analysis.isRefinement
  };

  history[taskId].prompts.push(entry);

  // Track refinement count
  if (analysis.isRefinement) {
    history[taskId].refinementCount = (history[taskId].refinementCount || 0) + 1;
  }

  // Update title if provided
  if (options.taskTitle && !history[taskId].title) {
    history[taskId].title = options.taskTitle;
  }

  // Cleanup old tasks if we have too many
  cleanupOldTasks(history);

  savePromptHistory(history);

  return entry;
}

/**
 * Get prompt history for a specific task
 * @param {string} taskId - Task ID
 * @returns {Object|null} Task prompt history or null
 */
function getTaskPromptHistory(taskId) {
  const history = loadPromptHistory();
  return history[taskId] || null;
}

/**
 * Get refinement count for a task
 * @param {string} taskId - Task ID
 * @returns {number} Number of refinements
 */
function getRefinementCount(taskId) {
  const taskHistory = getTaskPromptHistory(taskId);
  return taskHistory?.refinementCount || 0;
}

/**
 * Get the last refinement for a task
 * @param {string} taskId - Task ID
 * @returns {Object|null} Last refinement entry or null
 */
function getLastRefinement(taskId) {
  const taskHistory = getTaskPromptHistory(taskId);
  if (!taskHistory) return null;

  const refinements = taskHistory.prompts.filter(p => p.isRefinement);
  return refinements.length > 0 ? refinements[refinements.length - 1] : null;
}

/**
 * Mark a task as completed in prompt history
 * @param {string} taskId - Task ID
 */
function markTaskCompleted(taskId) {
  const history = loadPromptHistory();

  if (history[taskId]) {
    history[taskId].completedAt = new Date().toISOString();
    savePromptHistory(history);
  }
}

/**
 * Cleanup old task entries to prevent unbounded growth
 * @param {Object} history - History object (modified in place)
 */
function cleanupOldTasks(history) {
  const taskIds = Object.keys(history);

  if (taskIds.length <= MAX_TASK_HISTORY) {
    return;
  }

  // Sort by startedAt and remove oldest
  // Tasks without startedAt get epoch 0 (oldest) so they're cleaned first
  const sorted = taskIds.sort((a, b) => {
    const dateA = history[a].startedAt ? new Date(history[a].startedAt).getTime() : 0;
    const dateB = history[b].startedAt ? new Date(history[b].startedAt).getTime() : 0;
    return dateA - dateB;
  });

  const toRemove = sorted.slice(0, sorted.length - MAX_TASK_HISTORY);

  for (const taskId of toRemove) {
    delete history[taskId];
  }
}

// ============================================================================
// Clarification Learning Entries
// ============================================================================

/**
 * Generate a clarification learning entry ID
 * @returns {string} Learning entry ID (CL-XXXXXXXX)
 */
function generateClarificationId() {
  return `CL-${Date.now().toString(36)}`;
}

/**
 * Generate a clarification learning entry
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @returns {Object|null} Learning entry or null if no refinements
 */
function generateClarificationEntry(taskId, taskTitle) {
  const taskHistory = getTaskPromptHistory(taskId);

  if (!taskHistory) {
    return null;
  }

  const refinements = taskHistory.prompts.filter(p => p.isRefinement);

  if (refinements.length === 0) {
    return null; // No clarifications needed
  }

  const initial = taskHistory.prompts.find(p => p.isInitial);
  const final = refinements[refinements.length - 1];

  return {
    id: generateClarificationId(),
    taskId,
    taskTitle: taskTitle || taskHistory.title || taskId,
    initial: initial?.content || 'Unknown initial request',
    refinementCount: refinements.length,
    whatWorked: final?.content || 'Unknown final clarification',
    timestamp: new Date().toISOString()
  };
}

/**
 * Append a clarification learning entry to clarifications.md
 * @param {Object} entry - Learning entry from generateClarificationEntry
 * @returns {boolean} Success
 */
function appendClarificationLearning(entry) {
  if (!entry) return false;

  const clPath = getClarificationsPath();
  ensureDir(path.dirname(clPath));

  const today = new Date().toISOString().split('T')[0];

  // Build markdown entry
  const markdown = `
### ${entry.id} | ${entry.taskId} | ${entry.taskTitle}
**Initial Request:** "${truncateString(entry.initial, 200)}"
**Refinements:** ${entry.refinementCount}
**What Worked:** "${truncateString(entry.whatWorked, 200)}"
**Pattern:** [To be filled by learning system]

---
`;

  try {
    let content = '';

    if (fileExists(clPath)) {
      content = readFile(clPath, '');
    } else {
      // Create file with header
      content = `# Clarification Learnings

This file contains learnings from user clarifications during task execution.
High-value patterns can be promoted to decisions.md for permanent rules.

`;
    }

    // Add date header if new day
    if (!content.includes(`## ${today}`)) {
      content += `\n## ${today}\n`;
    }

    content += markdown;

    writeFile(clPath, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] appendClarificationLearning: ${err.message}`);
    }
    return false;
  }
}

/**
 * Process task completion - generate learning entry if needed
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @returns {Object} Result with entry details
 */
function processTaskCompletion(taskId, taskTitle) {
  // Generate entry if refinements exist
  const entry = generateClarificationEntry(taskId, taskTitle);

  if (!entry) {
    return { generated: false, reason: 'no-refinements' };
  }

  // Append to clarifications.md
  const success = appendClarificationLearning(entry);

  if (success) {
    // Mark task as completed in history
    markTaskCompleted(taskId);

    return {
      generated: true,
      entry,
      refinementCount: entry.refinementCount
    };
  }

  return { generated: false, reason: 'write-failed' };
}

// ============================================================================
// Auto-Detection from Session
// ============================================================================

/**
 * Get current task ID from durable session
 * @returns {string|null} Task ID or null
 */
function getCurrentTaskId() {
  try {
    const session = loadDurableSession();
    return session?.taskId || null;
  } catch (err) {
    return null;
  }
}

/**
 * Capture prompt for current task (auto-detects task ID)
 * @param {string} prompt - User prompt text
 * @returns {Object|null} Captured entry or null
 */
function captureCurrentPrompt(prompt) {
  const taskId = getCurrentTaskId();

  if (!taskId) {
    // No active task - don't capture
    return null;
  }

  return capturePrompt(taskId, prompt);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Max length
 * @returns {string} Truncated string
 */
function truncateString(str, maxLength) {
  if (!str || str.length <= maxLength) {
    return str || '';
  }
  return str.slice(0, maxLength - 3) + '...';
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'capture': {
      const taskId = args[1];
      const prompt = args.slice(2).join(' ');

      if (!taskId || !prompt) {
        console.log('Usage: node flow-prompt-capture.js capture <taskId> <prompt>');
        process.exit(1);
      }

      const result = capturePrompt(taskId, prompt);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'history': {
      const taskId = args[1];
      if (taskId) {
        const history = getTaskPromptHistory(taskId);
        console.log(JSON.stringify(history, null, 2));
      } else {
        const allHistory = loadPromptHistory();
        console.log(JSON.stringify(allHistory, null, 2));
      }
      break;
    }

    case 'complete': {
      const taskId = args[1];
      const title = args.slice(2).join(' ') || taskId;

      if (!taskId) {
        console.log('Usage: node flow-prompt-capture.js complete <taskId> [title]');
        process.exit(1);
      }

      const result = processTaskCompletion(taskId, title);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'analyze': {
      const prompt = args.slice(1).join(' ');
      if (!prompt) {
        console.log('Usage: node flow-prompt-capture.js analyze <prompt>');
        process.exit(1);
      }

      const isRefinement = detectRefinement(prompt);
      console.log(JSON.stringify({ prompt, isRefinement }, null, 2));
      break;
    }

    default:
      console.log(`
Usage: node flow-prompt-capture.js <command> [args]

Commands:
  capture <taskId> <prompt>  - Capture a prompt for a task
  history [taskId]           - Show prompt history (all or for specific task)
  complete <taskId> [title]  - Process task completion (generate learning entry)
  analyze <prompt>           - Analyze if prompt is a refinement
`);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Refinement detection
  detectRefinement,
  analyzePrompt,
  REFINEMENT_PATTERNS,

  // Prompt history
  loadPromptHistory,
  capturePrompt,
  captureCurrentPrompt,
  getTaskPromptHistory,
  getRefinementCount,
  getLastRefinement,
  markTaskCompleted,

  // Clarification learning
  generateClarificationEntry,
  appendClarificationLearning,
  processTaskCompletion,

  // Paths
  getPromptHistoryPath,
  getClarificationsPath,

  // Utils
  getCurrentTaskId
};
