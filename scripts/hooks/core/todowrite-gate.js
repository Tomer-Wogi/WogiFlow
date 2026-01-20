#!/usr/bin/env node

/**
 * Wogi Flow - TodoWrite Gate (Core Module)
 *
 * Distinguishes between implementation todos and workflow tracking todos.
 * Blocks implementation todos when no active task exists.
 *
 * Implementation todos: "Create X component", "Add Y feature"
 * Tracking todos: "Run tests", "Update request-log", "Commit changes"
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const { getConfig } = require('../../flow-utils');
const { getActiveTask } = require('./task-gate');

/**
 * Patterns that indicate an implementation todo (should require active task)
 */
const IMPLEMENTATION_TODO_PATTERNS = [
  // Creation patterns
  /^(create|add|build|implement|make|write)\s+/i,
  /^(new|design)\s+/i,

  // Modification patterns
  /^(fix|update|modify|change|edit|refactor)\s+/i,
  /^(remove|delete|drop)\s+/i,

  // Integration patterns
  /^(integrate|connect|hook\s+up|wire\s+up)\s+/i,

  // Component-specific
  /\b(component|module|service|hook|util|function|class|interface)\b/i,

  // Feature patterns
  /\b(feature|functionality|capability)\b/i,

  // File operation patterns that imply creation
  /\b(file|page|screen|view|route)\b.*\b(for|to)\b/i
];

/**
 * Patterns that indicate a workflow tracking todo (always allowed)
 * These are WogiFlow workflow steps, not implementation
 */
const TRACKING_TODO_PATTERNS = [
  // Testing and validation
  /^run\s+(tests?|lint|typecheck|build|check)/i,
  /^(test|verify|validate|check)\s+/i,
  /^(execute|perform)\s+(tests?|validation)/i,

  // Logging and documentation
  /^update\s+(request-?log|app-?map|decision|progress)/i,
  /^(log|record|document)\s+/i,
  /^add\s+(to\s+)?(log|entry|record)/i,

  // Version control
  /^(commit|push|pull|merge|rebase)/i,
  /^(stage|unstage|stash)/i,
  /^git\s+/i,

  // Review and cleanup
  /^review\s+(changes?|code|implementation)/i,
  /^clean\s+up/i,
  /^(finalize|complete|finish)\s+(task|work)/i,

  // WogiFlow specific
  /^(mark|set)\s+(as\s+)?(complete|done|finished)/i,
  /^close\s+(task|issue)/i,
  /^(update|sync)\s+(state|status)/i,

  // Reading/checking (non-modifying)
  /^(read|check|look\s+at|review|inspect)\s+/i,
  /^(verify|confirm|ensure)\s+/i,

  // Quality gates
  /^(pass|run)\s+(quality|lint|type)\s*(gate|check)?/i
];

/**
 * Explicit allowlist - these are ALWAYS allowed regardless of patterns
 */
const ALWAYS_ALLOWED_TODOS = [
  'run tests',
  'run lint',
  'run typecheck',
  'run build',
  'run quality gates',
  'update request-log',
  'update request log',
  'update app-map',
  'update app map',
  'update decisions',
  'update progress',
  'commit changes',
  'push changes',
  'commit and push',
  'verify changes',
  'review code',
  'mark as complete',
  'close task'
];

/**
 * Check if TodoWrite gate should be enforced
 * @returns {boolean}
 */
function isTodoWriteGateEnabled() {
  const config = getConfig();

  // Check hooks config first
  if (config.hooks?.rules?.todoWriteGate?.enabled === false) {
    return false;
  }

  // Fall back to enforcement config
  if (config.enforcement?.strictMode === false) {
    return false;
  }

  return true;
}

/**
 * Check if a single todo item is a tracking todo (always allowed)
 * @param {string} content - Todo content
 * @returns {boolean}
 */
function isTrackingTodo(content) {
  if (!content || typeof content !== 'string') return false;

  const normalizedContent = content.toLowerCase().trim();

  // Check explicit allowlist first
  for (const allowed of ALWAYS_ALLOWED_TODOS) {
    if (normalizedContent === allowed || normalizedContent.startsWith(allowed)) {
      return true;
    }
  }

  // Check tracking patterns
  return TRACKING_TODO_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Check if a single todo item is an implementation todo (requires active task)
 * @param {string} content - Todo content
 * @returns {boolean}
 */
function isImplementationTodo(content) {
  if (!content || typeof content !== 'string') return false;

  // If it's a tracking todo, it's NOT an implementation todo
  if (isTrackingTodo(content)) {
    return false;
  }

  // Check implementation patterns
  return IMPLEMENTATION_TODO_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Classify a todo item
 * @param {Object} todo - Todo object with content and status
 * @returns {{type: string, reason: string}}
 */
function classifyTodo(todo) {
  if (!todo || !todo.content) {
    return { type: 'unknown', reason: 'no_content' };
  }

  const content = todo.content;

  // Completed todos are always allowed (just tracking completion)
  if (todo.status === 'completed') {
    return { type: 'tracking', reason: 'completed_status' };
  }

  // Check if tracking
  if (isTrackingTodo(content)) {
    return { type: 'tracking', reason: 'tracking_pattern' };
  }

  // Check if implementation
  if (isImplementationTodo(content)) {
    return { type: 'implementation', reason: 'implementation_pattern' };
  }

  // Default to allowed (unknown todos don't block)
  return { type: 'unknown', reason: 'no_pattern_match' };
}

/**
 * Check TodoWrite gate for a TodoWrite call
 *
 * @param {Object} options
 * @param {Array} options.todos - Array of todo items [{content, status, activeForm}]
 * @returns {Object} Result: { allowed, blocked, message, reason, implementationTodos, trackingTodos }
 */
function checkTodoWriteGate(options = {}) {
  const { todos } = options;

  // No todos - allow
  if (!todos || !Array.isArray(todos) || todos.length === 0) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'no_todos'
    };
  }

  // Check if gate is enabled
  if (!isTodoWriteGateEnabled()) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'gate_disabled'
    };
  }

  // Classify all todos
  const implementationTodos = [];
  const trackingTodos = [];
  const unknownTodos = [];

  for (const todo of todos) {
    const classification = classifyTodo(todo);
    if (classification.type === 'implementation') {
      implementationTodos.push({ ...todo, classification });
    } else if (classification.type === 'tracking') {
      trackingTodos.push({ ...todo, classification });
    } else {
      unknownTodos.push({ ...todo, classification });
    }
  }

  // If no implementation todos, allow
  if (implementationTodos.length === 0) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'no_implementation_todos',
      trackingTodos: trackingTodos.map(t => t.content),
      unknownTodos: unknownTodos.map(t => t.content)
    };
  }

  // Has implementation todos - check for active task
  const activeTask = getActiveTask();

  if (activeTask) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      task: activeTask,
      reason: 'task_active',
      implementationTodos: implementationTodos.map(t => t.content),
      trackingTodos: trackingTodos.map(t => t.content)
    };
  }

  // No active task and has implementation todos - check if blocking is enabled
  const config = getConfig();
  // Default to blocking (true), only disable if explicitly set to false
  const blockingEnabled = config.hooks?.rules?.todoWriteGate?.blockImplementationWithoutTask !== false;

  if (blockingEnabled) {
    // Hard block mode
    return {
      allowed: false,
      blocked: true,
      message: generateBlockMessage(implementationTodos, trackingTodos),
      reason: 'no_active_task',
      implementationTodos: implementationTodos.map(t => t.content),
      trackingTodos: trackingTodos.map(t => t.content)
    };
  }

  // Warn-only mode (blockImplementationWithoutTask explicitly set to false)
  return {
    allowed: true,
    blocked: false,
    message: generateWarningMessage(implementationTodos, trackingTodos),
    reason: 'warn_only',
    implementationTodos: implementationTodos.map(t => t.content),
    trackingTodos: trackingTodos.map(t => t.content)
  };
}

/**
 * Generate warning message
 */
function generateWarningMessage(implementationTodos, trackingTodos) {
  return `Warning: TodoWrite contains implementation tasks but no WogiFlow task is active.

Implementation todos detected:
${implementationTodos.slice(0, 5).map(t => `  - ${t.content}`).join('\n')}

Consider using /wogi-story to create a proper task.

Tracking todos (always allowed):
${trackingTodos.length > 0 ? trackingTodos.slice(0, 3).map(t => `  - ${t.content}`).join('\n') : '  (none)'}`;
}

/**
 * Generate block message
 */
function generateBlockMessage(implementationTodos, _trackingTodos) {
  const implList = implementationTodos.slice(0, 5).map(t => `  - ${t.content}`).join('\n');

  return `BLOCKED: TodoWrite contains implementation tasks but no WogiFlow task is active.

Implementation todos detected:
${implList}

Use WogiFlow instead:
1. /wogi-ready - see available tasks
2. /wogi-start wf-XXXXXXXX - start an existing task
3. /wogi-story "description" - create a new task with these items

Tracking todos (always allowed):
  - Run tests, Run lint, Run typecheck
  - Update request-log, Update app-map
  - Commit changes, Push changes
  - Verify, Review, Mark as complete

Why? WogiFlow ensures:
- Acceptance criteria are tracked
- Changes are logged
- Quality gates are enforced`;
}

module.exports = {
  isTodoWriteGateEnabled,
  isTrackingTodo,
  isImplementationTodo,
  classifyTodo,
  checkTodoWriteGate,
  generateWarningMessage,
  generateBlockMessage,
  IMPLEMENTATION_TODO_PATTERNS,
  TRACKING_TODO_PATTERNS,
  ALWAYS_ALLOWED_TODOS
};
