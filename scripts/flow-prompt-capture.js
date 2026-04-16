#!/usr/bin/env node

/**
 * Wogi Flow - Prompt Capture System (v2 — Flat Array Architecture)
 *
 * Two-file system for capturing and learning from user prompts:
 * 1. prompt-history.json - Chronological flat array of ALL prompts (v2)
 * 2. clarifications.md - Learning entries from refinement patterns
 *
 * v2 Architecture (Approach B):
 * - All prompts are ALWAYS saved, regardless of whether a taskId exists
 * - taskId is optional metadata on each prompt, not a primary key
 * - First prompt is never lost (saved with taskId: null, tagged retrospectively)
 * - Stale taskIds are detected via ready.json cross-check
 * - v1 → v2 migration happens automatically on first load
 *
 * Fixes bugs: wf-ddd498de
 * - Bug 1: First prompt lost (no taskId yet) → now saved with taskId: null
 * - Bug 2: Prompts persist under stale taskId → cross-check with ready.json
 * - Bug 3: Top-level prompts[] never used → now the primary storage
 */

const _fs = require('node:fs');
const path = require('node:path');
const {
  PATHS,
  safeJsonParse,
  writeJson,
  ensureDir,
  fileExists,
  readFile,
  writeFile,
  getReadyData
} = require('./flow-utils');
const { getTodayDate } = require('./flow-output');

// Lazy-load to avoid circular dependency (durable-session imports flow-utils too)
let _loadDurableSession;
function loadDurableSession() {
  if (!_loadDurableSession) {
    _loadDurableSession = require('./flow-durable-session').loadDurableSession;
  }
  return _loadDurableSession();
}

// ============================================================================
// Constants
// ============================================================================

const PROMPT_HISTORY_FILE = 'prompt-history.json';
const CLARIFICATIONS_FILE = 'clarifications.md';
const MAX_PROMPTS = 500; // Max prompts to keep before cleanup (flat array)
const SCHEMA_VERSION = 2;

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
  return REFINEMENT_PATTERNS.some(pattern => pattern.test(prompt.trim()));
}

/**
 * Analyze a prompt for refinement characteristics
 * @param {string} prompt - User prompt text
 * @returns {Object} Analysis result
 */
function analyzePrompt(prompt) {
  return {
    isRefinement: detectRefinement(prompt),
    length: prompt?.length || 0,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// v1 → v2 Migration
// ============================================================================

/**
 * Migrate v1 (task-keyed object) to v2 (flat array) format.
 * v1: { "wf-xxx": { prompts: [...], ... }, "wf-yyy": { ... } }
 * v2: { version: 2, prompts: [{ taskId, content, timestamp, ... }] }
 *
 * @param {Object} v1Data - v1 format data
 * @returns {Object} v2 format data
 */
function migrateV1ToV2(v1Data) {
  const prompts = [];

  for (const [taskId, taskEntry] of Object.entries(v1Data)) {
    // Skip metadata keys
    if (taskId === 'version' || taskId === 'prompts') continue;
    if (!taskEntry || !Array.isArray(taskEntry.prompts)) continue;

    for (const prompt of taskEntry.prompts) {
      prompts.push({
        timestamp: prompt.timestamp || taskEntry.startedAt || new Date().toISOString(),
        content: prompt.content || '',
        taskId: taskId,
        taskTitle: taskEntry.title || null,
        isRefinement: prompt.isRefinement || false,
        isInitial: prompt.isInitial || false,
        sessionId: null,
        source: 'migrated-v1'
      });
    }
  }

  // Sort chronologically
  prompts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return { version: SCHEMA_VERSION, prompts };
}

// ============================================================================
// Prompt History Management (v2 — Flat Array)
// ============================================================================

/**
 * Load prompt history, auto-migrating v1 → v2 if needed.
 * @returns {{ version: number, prompts: Object[] }}
 */
function loadPromptHistory() {
  const historyPath = getPromptHistoryPath();
  const raw = safeJsonParse(historyPath, null);

  // No file yet
  if (!raw) {
    return { version: SCHEMA_VERSION, prompts: [] };
  }

  // Already v2
  if (raw.version === SCHEMA_VERSION && Array.isArray(raw.prompts)) {
    return raw;
  }

  // v1 format detected — migrate
  if (!raw.version && typeof raw === 'object') {
    const migrated = migrateV1ToV2(raw);
    // Save migrated data
    try {
      ensureDir(path.dirname(historyPath));
      writeJson(historyPath, migrated);
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[prompt-capture] Migration write failed: ${err.message}`);
      }
    }
    return migrated;
  }

  // Unknown format — start fresh
  return { version: SCHEMA_VERSION, prompts: [] };
}

/**
 * Save prompt history to file
 * @param {Object} history - v2 history object
 */
function savePromptHistory(history) {
  const historyPath = getPromptHistoryPath();
  ensureDir(path.dirname(historyPath));
  writeJson(historyPath, history);
}

/**
 * Get current valid task ID — cross-checked against ready.json.
 * Returns null if:
 * - No durable session exists
 * - durable-session taskId is not in ready.json inProgress (stale)
 *
 * @returns {string|null} Valid task ID or null
 */
function getCurrentTaskId() {
  try {
    const session = loadDurableSession();
    const taskId = session?.taskId;
    if (!taskId) return null;

    // Cross-check: is this task actually in progress?
    const readyData = getReadyData();
    const inProgress = Array.isArray(readyData.inProgress) ? readyData.inProgress : [];
    const isActive = inProgress.some(t =>
      (typeof t === 'string' ? t : t.id) === taskId
    );

    if (!isActive) {
      // Task is no longer in progress — stale durable session
      if (process.env.DEBUG) {
        console.error(`[prompt-capture] Stale taskId ${taskId} — not in ready.json inProgress`);
      }
      return null;
    }

    return taskId;
  } catch (_err) {
    return null;
  }
}

/**
 * Capture a user prompt. ALWAYS saves — taskId is optional metadata.
 *
 * @param {string} prompt - User prompt text
 * @param {Object} [options] - Additional options
 * @param {string} [options.taskId] - Override task ID (otherwise auto-detected)
 * @param {string} [options.taskTitle] - Task title
 * @param {string} [options.sessionId] - Session ID
 * @returns {Object} Captured prompt entry
 */
function capturePrompt(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return null;
  }

  const taskId = options.taskId !== undefined ? options.taskId : getCurrentTaskId();
  const analysis = analyzePrompt(prompt);

  const entry = {
    timestamp: analysis.timestamp,
    content: prompt,
    taskId: taskId || null,
    taskTitle: options.taskTitle || null,
    isRefinement: analysis.isRefinement,
    sessionId: options.sessionId || process.env.CLAUDE_CODE_SESSION_ID || null,
    source: 'hook'
  };

  const history = loadPromptHistory();
  history.prompts.push(entry);

  // Cleanup if over limit
  if (history.prompts.length > MAX_PROMPTS) {
    history.prompts = history.prompts.slice(-MAX_PROMPTS);
  }

  savePromptHistory(history);
  return entry;
}

/**
 * Capture prompt for current task (backward-compatible wrapper).
 * In v2, this ALWAYS saves — even without a taskId.
 *
 * @param {string} prompt - User prompt text
 * @returns {Object|null} Captured entry (null only if prompt is empty)
 */
function captureCurrentPrompt(prompt) {
  return capturePrompt(prompt);
}

/**
 * Tag recent untagged prompts with a taskId (retrospective tagging).
 * Called after task creation to tag the initial prompt that triggered it.
 *
 * @param {string} taskId - Task ID to tag with
 * @param {string} [taskTitle] - Task title
 * @param {number} [lookbackMs=60000] - How far back to look (default 1 min)
 * @returns {{ tagged: number }}
 */
function tagRecentPrompts(taskId, taskTitle, lookbackMs = 60000) {
  if (!taskId) return { tagged: 0 };

  const history = loadPromptHistory();
  const cutoff = Date.now() - lookbackMs;
  let tagged = 0;

  // Walk backwards through recent prompts
  for (let i = history.prompts.length - 1; i >= 0; i--) {
    const prompt = history.prompts[i];
    const promptTime = new Date(prompt.timestamp).getTime();

    // Stop if we've gone past the lookback window
    if (promptTime < cutoff) break;

    // Tag untagged prompts
    if (!prompt.taskId) {
      prompt.taskId = taskId;
      if (taskTitle) prompt.taskTitle = taskTitle;
      tagged++;
    }
  }

  if (tagged > 0) {
    savePromptHistory(history);
  }

  return { tagged };
}

// ============================================================================
// Query Functions (backward-compatible)
// ============================================================================

/**
 * Get prompt history for a specific task (filters flat array by taskId).
 * @param {string} taskId - Task ID
 * @returns {{ taskId: string, prompts: Object[], refinementCount: number }|null}
 */
function getTaskPromptHistory(taskId) {
  const history = loadPromptHistory();
  const taskPrompts = history.prompts.filter(p => p.taskId === taskId);

  if (taskPrompts.length === 0) return null;

  return {
    taskId,
    title: taskPrompts[0]?.taskTitle || null,
    prompts: taskPrompts,
    refinementCount: taskPrompts.filter(p => p.isRefinement).length
  };
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
 * Mark a task as completed in prompt history.
 * In v2, this is a no-op for the flat array (completedAt is tracked in ready.json).
 * Kept for backward compatibility with flow-done.js.
 * @param {string} _taskId - Task ID (unused in v2)
 */
function markTaskCompleted(_taskId) {
  // No-op in v2 — task completion is tracked in ready.json, not prompt-history
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
  if (!taskHistory) return null;

  const refinements = taskHistory.prompts.filter(p => p.isRefinement);
  if (refinements.length === 0) return null;

  const initial = taskHistory.prompts[0];
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

  const today = getTodayDate();
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
      content = `# Clarification Learnings

This file contains learnings from user clarifications during task execution.
High-value patterns can be promoted to decisions.md for permanent rules.

`;
    }

    if (!content.includes(`## ${today}`)) {
      content += `\n## ${today}\n`;
    }

    content += markdown;
    writeFile(clPath, content);
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[prompt-capture] appendClarificationLearning: ${err.message}`);
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
  const entry = generateClarificationEntry(taskId, taskTitle);

  if (!entry) {
    return { generated: false, reason: 'no-refinements' };
  }

  const success = appendClarificationLearning(entry);

  if (success) {
    return {
      generated: true,
      entry,
      refinementCount: entry.refinementCount
    };
  }

  return { generated: false, reason: 'write-failed' };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Truncate string with ellipsis
 */
function truncateString(str, maxLength) {
  if (!str || str.length <= maxLength) return str || '';
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
      const prompt = args.slice(1).join(' ');
      if (!prompt) {
        console.log('Usage: node flow-prompt-capture.js capture <prompt>');
        process.exit(1);
      }
      const result = capturePrompt(prompt);
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
        console.log(JSON.stringify({ version: allHistory.version, count: allHistory.prompts.length, prompts: allHistory.prompts.slice(-20) }, null, 2));
      }
      break;
    }

    case 'tag': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node flow-prompt-capture.js tag <taskId> [title]');
        process.exit(1);
      }
      const title = args.slice(2).join(' ') || null;
      const result = tagRecentPrompts(taskId, title);
      console.log(JSON.stringify(result, null, 2));
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
      console.log(JSON.stringify({ prompt, isRefinement: detectRefinement(prompt) }, null, 2));
      break;
    }

    case 'migrate': {
      const history = loadPromptHistory(); // auto-migrates on load
      console.log(JSON.stringify({ version: history.version, promptCount: history.prompts.length, migrated: true }, null, 2));
      break;
    }

    default:
      console.log(`
Usage: node flow-prompt-capture.js <command> [args]

Commands:
  capture <prompt>            - Capture a prompt (taskId auto-detected)
  history [taskId]            - Show prompt history (all or filtered by task)
  tag <taskId> [title]        - Tag recent untagged prompts with a taskId
  complete <taskId> [title]   - Process task completion (generate learning entry)
  analyze <prompt>            - Analyze if prompt is a refinement
  migrate                     - Force v1 → v2 migration
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

  // Prompt history (v2)
  loadPromptHistory,
  capturePrompt,
  captureCurrentPrompt,
  tagRecentPrompts,
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
