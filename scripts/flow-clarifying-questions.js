#!/usr/bin/env node

/**
 * Wogi Flow - Clarifying Questions Generator
 *
 * Generates contextual questions BEFORE implementation to catch
 * assumptions, scope issues, and edge cases early.
 *
 * Usage:
 *   node scripts/flow-clarifying-questions.js <task-id>
 *   node scripts/flow-clarifying-questions.js --task "<description>" --context "<context>"
 */

const path = require('path');
const {
  PATHS,
  readJson,
  readFile,
  fileExists,
  parseFlags,
  outputJson,
  getConfig,
  getConfigValue,
  color,
  findTask
} = require('./flow-utils');

/**
 * Question categories for different aspects of implementation
 */
const QUESTION_CATEGORIES = {
  scope: {
    name: 'Scope Validation',
    description: 'Clarify what is and is not included',
    icon: '🎯'
  },
  assumptions: {
    name: 'Assumption Surfacing',
    description: 'Validate implicit assumptions',
    icon: '💡'
  },
  edgeCases: {
    name: 'Edge Cases',
    description: 'Identify boundary conditions',
    icon: '🔀'
  },
  integration: {
    name: 'Integration Points',
    description: 'Understand dependencies and touchpoints',
    icon: '🔗'
  },
  preferences: {
    name: 'Implementation Preferences',
    description: 'User preferences for approach',
    icon: '⚙️'
  }
};

/**
 * Patterns that suggest specific question types
 */
const QUESTION_TRIGGERS = {
  // Multiple files/components found → scope question
  multipleComponents: {
    category: 'scope',
    condition: (context) => context.matchedFiles?.length > 3,
    question: (context) =>
      `Found ${context.matchedFiles?.length} related files. Should I modify all of them, or focus on specific ones?`
  },

  // API/service task → integration question
  apiTask: {
    category: 'integration',
    condition: (context) =>
      /\b(api|endpoint|fetch|request|service)\b/i.test(context.taskDescription),
    question: () =>
      'Are there existing API patterns or services I should follow?'
  },

  // UI/component task → design question
  uiTask: {
    category: 'preferences',
    condition: (context) =>
      /\b(button|form|modal|dialog|component|ui)\b/i.test(context.taskDescription),
    question: () =>
      'Are there existing UI components or design patterns I should reuse?'
  },

  // State management → architecture question
  stateTask: {
    category: 'assumptions',
    condition: (context) =>
      /\b(state|store|context|redux|zustand)\b/i.test(context.taskDescription),
    question: () =>
      'What state management approach does this project use?'
  },

  // Error handling mentioned → edge cases
  errorHandling: {
    category: 'edgeCases',
    condition: (context) =>
      /\b(error|fail|invalid|handle|catch)\b/i.test(context.taskDescription),
    question: () =>
      'What should happen when errors occur? Silent fail, toast notification, or redirect?'
  },

  // Authentication/security → assumptions
  securityTask: {
    category: 'assumptions',
    condition: (context) =>
      /\b(auth|login|permission|security|token|session)\b/i.test(context.taskDescription),
    question: () =>
      'What authentication method is being used? Are there existing auth utilities?'
  },

  // Database/data task → integration
  dataTask: {
    category: 'integration',
    condition: (context) =>
      /\b(database|db|model|entity|query|table)\b/i.test(context.taskDescription),
    question: () =>
      'Are there existing data models or database patterns I should follow?'
  },

  // Migration/refactor → scope
  refactorTask: {
    category: 'scope',
    condition: (context) =>
      /\b(refactor|migrate|rename|move|update|upgrade)\b/i.test(context.taskDescription),
    question: () =>
      'Should this be done incrementally or all at once? Any backward compatibility concerns?'
  },

  // New feature → preferences
  newFeature: {
    category: 'preferences',
    condition: (context) =>
      /\b(new|add|create|implement)\b/i.test(context.taskDescription),
    question: () =>
      'Are there any specific requirements not mentioned in the task description?'
  },

  // Testing mentioned → edge cases
  testingTask: {
    category: 'edgeCases',
    condition: (context) =>
      /\b(test|spec|coverage)\b/i.test(context.taskDescription),
    question: () =>
      'What testing framework is used? Any specific test patterns to follow?'
  }
};

/**
 * Analyze context to determine task complexity
 * @param {Object} context - Task context
 * @returns {string} 'small' | 'medium' | 'large'
 */
function assessComplexity(context) {
  const fileCount = context.matchedFiles?.length || 0;
  const descLength = context.taskDescription?.length || 0;

  if (fileCount > 10 || descLength > 500) return 'large';
  if (fileCount > 3 || descLength > 200) return 'medium';
  return 'small';
}

/**
 * Generate clarifying questions based on context
 * @param {Object} context - Task context
 * @param {Object} options - Generation options
 * @returns {Object[]} Array of questions with category and text
 */
function generateQuestions(context, options = {}) {
  const config = getConfig();
  const maxQuestions = options.maxQuestions ||
    getConfigValue('clarifyingQuestions.maxQuestions', 5);
  const skipForSmall = options.skipForSmall ??
    getConfigValue('clarifyingQuestions.skipForSmallTasks', true);
  const smallThreshold = getConfigValue('clarifyingQuestions.smallTaskThreshold', 2);

  // Skip for small tasks if configured
  const complexity = assessComplexity(context);
  const fileCount = context.matchedFiles?.length || 0;

  if (skipForSmall && complexity === 'small' && fileCount <= smallThreshold) {
    return [];
  }

  const questions = [];
  const usedCategories = new Set();

  // Check each trigger pattern
  for (const [triggerId, trigger] of Object.entries(QUESTION_TRIGGERS)) {
    // Skip if we already have a question in this category
    if (usedCategories.has(trigger.category)) continue;

    // Check if condition matches
    if (trigger.condition(context)) {
      questions.push({
        id: triggerId,
        category: trigger.category,
        categoryName: QUESTION_CATEGORIES[trigger.category]?.name || trigger.category,
        icon: QUESTION_CATEGORIES[trigger.category]?.icon || '❓',
        question: trigger.question(context)
      });
      usedCategories.add(trigger.category);
    }

    // Stop if we have enough questions
    if (questions.length >= maxQuestions) break;
  }

  // Add a general question if we have few questions
  if (questions.length > 0 && questions.length < 3 && !usedCategories.has('preferences')) {
    questions.push({
      id: 'general',
      category: 'preferences',
      categoryName: QUESTION_CATEGORIES.preferences.name,
      icon: QUESTION_CATEGORIES.preferences.icon,
      question: 'Is there anything specific about the implementation approach you prefer?'
    });
  }

  return questions;
}

/**
 * Format questions for CLI output
 * @param {Object[]} questions - Array of questions
 * @returns {string} Formatted output
 */
function formatQuestions(questions) {
  if (questions.length === 0) {
    return '';
  }

  let output = '';
  output += color('cyan', '━'.repeat(50)) + '\n';
  output += color('cyan', '❓ Clarifying Questions') + '\n';
  output += color('cyan', '━'.repeat(50)) + '\n';
  output += color('dim', 'Before implementation, consider clarifying:') + '\n\n';

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    output += `${q.icon} ${color('yellow', q.categoryName)}\n`;
    output += `   ${i + 1}. ${q.question}\n`;
    output += '\n';
  }

  output += color('dim', 'Note: You can proceed without answering, but clarification may prevent rework.') + '\n';

  return output;
}

/**
 * Format questions for JSON output (for Claude to use with AskUserQuestion)
 * @param {Object[]} questions - Array of questions
 * @returns {Object} Structured for AskUserQuestion tool
 */
function formatForClaude(questions) {
  return questions.map(q => ({
    question: q.question,
    header: q.categoryName.substring(0, 12), // Max 12 chars for chip
    options: [
      { label: 'Yes', description: 'Proceed with default approach' },
      { label: 'No', description: 'I have specific requirements' },
      { label: 'Skip', description: 'Not relevant to this task' }
    ],
    multiSelect: false,
    metadata: {
      category: q.category,
      questionId: q.id
    }
  }));
}

/**
 * Load task context for question generation
 * @param {string} taskId - Task ID
 * @returns {Object} Task context
 */
function loadTaskContext(taskId) {
  const found = findTask(taskId);

  if (!found) {
    return { taskDescription: taskId };
  }

  const task = found.task;
  const context = {
    taskId,
    taskDescription: task.title || task.description || taskId,
    taskType: task.type || 'feature',
    matchedFiles: []
  };

  // Try to load spec if it exists
  const specPath = path.join(PATHS.specs, `${taskId}.md`);
  if (fileExists(specPath)) {
    try {
      context.spec = readFile(specPath);
    } catch {
      // Ignore spec read errors
    }
  }

  // Try to load change file if it exists
  const changePath = path.join(PATHS.changes, `${taskId}.md`);
  if (fileExists(changePath)) {
    try {
      context.change = readFile(changePath);
    } catch {
      // Ignore change read errors
    }
  }

  return context;
}

/**
 * Main function - can be called from CLI or imported
 */
function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: flow clarifying-questions <task-id>
       flow clarifying-questions --task "<description>" [--context "<json>"]

Generate clarifying questions for a task before implementation.

Options:
  --task <desc>     Task description (instead of task ID)
  --context <json>  Additional context as JSON
  --max <n>         Maximum questions (default: 5)
  --json            Output JSON for Claude integration
  --skip-small      Skip questions for small tasks (default: true)

Examples:
  flow clarifying-questions wf-abc123
  flow clarifying-questions --task "Add dark mode" --json
`);
    process.exit(0);
  }

  // Build context
  let context;

  if (flags.task) {
    // Direct task description
    context = {
      taskDescription: flags.task,
      matchedFiles: []
    };

    if (flags.context) {
      try {
        Object.assign(context, JSON.parse(flags.context));
      } catch {
        // Ignore invalid JSON
      }
    }
  } else {
    // Load from task ID
    const taskId = positional[0];
    if (!taskId) {
      console.error('Usage: flow clarifying-questions <task-id>');
      process.exit(1);
    }
    context = loadTaskContext(taskId);
  }

  // Generate questions
  const questions = generateQuestions(context, {
    maxQuestions: flags.max ? parseInt(flags.max, 10) : undefined,
    skipForSmall: flags['skip-small'] !== false
  });

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      questionsCount: questions.length,
      questions,
      claudeFormat: formatForClaude(questions)
    });
  } else {
    const formatted = formatQuestions(questions);
    if (formatted) {
      console.log('');
      console.log(formatted);
    } else {
      console.log(color('dim', 'No clarifying questions needed for this task.'));
    }
  }
}

// Run only when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generateQuestions,
  formatQuestions,
  formatForClaude,
  loadTaskContext,
  assessComplexity,
  QUESTION_CATEGORIES,
  QUESTION_TRIGGERS
};
