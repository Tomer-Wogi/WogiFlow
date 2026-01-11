#!/usr/bin/env node

/**
 * Wogi Flow - Multi-Approach Validation
 *
 * Uses multi-trajectory validation approach:
 * For complex tasks, generate multiple solution approaches,
 * validate each, and select the best one.
 *
 * Modes:
 * - "suggest" (default): Ask user before using extra tokens
 * - "auto": Automatically use for high-complexity tasks
 * - "off": Disabled
 *
 * This works in both normal and hybrid modes:
 * - Normal: Claude generates N approaches, picks best after analysis
 * - Hybrid: Generate N plans, execute best one with local LLM
 *
 * Usage as module:
 *   const { shouldUseMultiApproach, runMultiApproach } = require('./flow-multi-approach');
 *   if (shouldUseMultiApproach(complexity)) { ... }
 *
 * Usage as CLI:
 *   flow multi-approach "task description"
 *   flow multi-approach --analyze "task"    # Just analyze, don't execute
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, PATHS, colors, writeJson, ensureDir } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const APPROACHES_DIR = path.join(PROJECT_ROOT, '.workflow', 'state', 'approaches');

// ============================================================
// Configuration
// ============================================================

/**
 * Default configuration for multi-approach
 */
const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'suggest',           // 'suggest', 'auto', 'off'
  triggerOn: ['large', 'xl'], // Complexity levels that trigger
  maxApproaches: 3,          // Number of approaches to generate
  validationGates: ['typecheck', 'lint'], // Gates to run on each approach
  selectionStrategy: 'first-passing' // 'first-passing', 'best-score', 'user-choice'
};

/**
 * Get multi-approach config from project config
 */
function getMultiApproachConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONFIG,
    ...(config.multiApproach || {})
  };
}

// ============================================================
// Complexity Integration
// ============================================================

/**
 * Check if multi-approach should be used for a given complexity
 * @param {string|object} complexity - Complexity level string or complexity result object
 * @returns {object} { shouldUse: boolean, reason: string, mode: string }
 */
function shouldUseMultiApproach(complexity) {
  const config = getMultiApproachConfig();

  // Check if enabled
  if (!config.enabled || config.mode === 'off') {
    return {
      shouldUse: false,
      reason: 'Multi-approach is disabled',
      mode: 'off'
    };
  }

  // Extract complexity level
  const level = typeof complexity === 'string'
    ? complexity.toLowerCase()
    : (complexity?.level || complexity?.complexity || 'medium').toLowerCase();

  // Check if complexity triggers multi-approach
  const triggers = config.triggerOn.map(t => t.toLowerCase());
  const shouldTrigger = triggers.includes(level);

  if (!shouldTrigger) {
    return {
      shouldUse: false,
      reason: `Complexity "${level}" does not trigger multi-approach (triggers: ${triggers.join(', ')})`,
      mode: config.mode
    };
  }

  return {
    shouldUse: true,
    reason: `Complexity "${level}" triggers multi-approach`,
    mode: config.mode,
    needsUserApproval: config.mode === 'suggest'
  };
}

// ============================================================
// Approach Generation
// ============================================================

/**
 * Approach template for generating diverse solutions
 */
const APPROACH_STRATEGIES = [
  {
    name: 'Direct',
    description: 'Most straightforward implementation',
    guidance: 'Implement the most direct, minimal solution. Prefer built-in features and existing utilities. Avoid abstractions unless necessary.'
  },
  {
    name: 'Robust',
    description: 'Focus on error handling and edge cases',
    guidance: 'Focus on comprehensive error handling, validation, and edge cases. Add defensive checks. Consider what could go wrong.'
  },
  {
    name: 'Reusable',
    description: 'Maximize code reuse and patterns',
    guidance: 'Focus on reusability and patterns. Extract shared logic. Consider how this might be extended later. Follow DRY principles.'
  },
  {
    name: 'Performance',
    description: 'Optimize for speed and efficiency',
    guidance: 'Focus on performance. Consider caching, lazy loading, memoization. Avoid unnecessary computations or re-renders.'
  },
  {
    name: 'Simple',
    description: 'Minimize complexity and lines of code',
    guidance: 'Minimize lines of code and complexity. Use concise patterns. Prefer clarity over cleverness. KISS principle.'
  }
];

/**
 * Generate approach prompts for a task
 * @param {object} task - Task description and context
 * @param {number} count - Number of approaches to generate
 * @returns {array} Array of approach configurations
 */
function generateApproachPrompts(task, count = 3) {
  const strategies = APPROACH_STRATEGIES.slice(0, count);

  return strategies.map((strategy, index) => ({
    id: `approach-${index + 1}`,
    name: strategy.name,
    description: strategy.description,
    prompt: buildApproachPrompt(task, strategy),
    strategy
  }));
}

/**
 * Build a prompt for a specific approach strategy
 */
function buildApproachPrompt(task, strategy) {
  return `
## Approach: ${strategy.name}

${strategy.guidance}

### Task
${task.description || task}

### Context
${task.context || 'Use existing project patterns and conventions.'}

### Requirements
- Follow the "${strategy.name}" approach strictly
- Generate complete, working code
- Include necessary imports
- Follow project conventions

### Output Format
Provide the implementation with:
1. File path
2. Complete code
3. Brief explanation of approach

`.trim();
}

// ============================================================
// Approach Execution & Validation
// ============================================================

/**
 * Approach result structure
 */
function createApproachResult(approach) {
  return {
    id: approach.id,
    name: approach.name,
    status: 'pending', // pending, generating, validating, passed, failed
    code: null,
    files: [],
    validationResults: {},
    score: 0,
    errors: [],
    startTime: null,
    endTime: null
  };
}

/**
 * Calculate score for an approach based on validation results
 */
function calculateApproachScore(result) {
  let score = 0;

  // Base score for completion
  if (result.code) score += 10;

  // Validation gates
  for (const [gate, passed] of Object.entries(result.validationResults)) {
    if (passed) score += 20;
    else score -= 10;
  }

  // Penalties
  score -= result.errors.length * 5;

  // Bonus for simplicity (fewer lines = higher score)
  if (result.code) {
    const lines = result.code.split('\n').length;
    if (lines < 50) score += 10;
    else if (lines < 100) score += 5;
    else if (lines > 200) score -= 5;
  }

  return Math.max(0, score);
}

/**
 * Select best approach from results
 * @param {array} results - Array of approach results
 * @param {string} strategy - Selection strategy
 * @returns {object} Selected approach result
 */
function selectBestApproach(results, strategy = 'first-passing') {
  const validResults = results.filter(r => r.status !== 'failed');

  if (validResults.length === 0) {
    return {
      selected: null,
      reason: 'No approaches passed validation'
    };
  }

  switch (strategy) {
    case 'first-passing':
      // Return first approach that passed all gates
      const passing = validResults.find(r => r.status === 'passed');
      return {
        selected: passing || validResults[0],
        reason: passing
          ? `Selected first passing approach: ${passing.name}`
          : `No fully passing approach, selected best available: ${validResults[0].name}`
      };

    case 'best-score':
      // Sort by score and return highest
      validResults.sort((a, b) => b.score - a.score);
      return {
        selected: validResults[0],
        reason: `Selected highest scoring approach: ${validResults[0].name} (score: ${validResults[0].score})`
      };

    case 'user-choice':
      // Return all for user to choose
      return {
        selected: null,
        candidates: validResults,
        reason: 'Awaiting user selection'
      };

    default:
      return {
        selected: validResults[0],
        reason: `Default selection: ${validResults[0].name}`
      };
  }
}

// ============================================================
// Multi-Approach Session Management
// ============================================================

/**
 * Create a new multi-approach session
 */
function createSession(task, approaches) {
  const sessionId = `ma-${Date.now()}`;

  return {
    id: sessionId,
    task: typeof task === 'string' ? { description: task } : task,
    approaches: approaches.map(createApproachResult),
    status: 'created', // created, generating, validating, selecting, complete, failed
    selectedApproach: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Save session to disk
 */
function saveSession(session) {
  session.updatedAt = new Date().toISOString();

  ensureDir(APPROACHES_DIR);

  const sessionPath = path.join(APPROACHES_DIR, `${session.id}.json`);
  // Use atomic writeJson to prevent data corruption
  writeJson(sessionPath, session);

  return sessionPath;
}

/**
 * Load session from disk
 */
function loadSession(sessionId) {
  const sessionPath = path.join(APPROACHES_DIR, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
}

/**
 * List recent sessions
 */
function listSessions(limit = 10) {
  if (!fs.existsSync(APPROACHES_DIR)) {
    return [];
  }

  return fs.readdirSync(APPROACHES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const session = JSON.parse(
        fs.readFileSync(path.join(APPROACHES_DIR, f), 'utf-8')
      );
      return {
        id: session.id,
        task: session.task?.description?.slice(0, 50) + '...',
        status: session.status,
        selectedApproach: session.selectedApproach?.name,
        createdAt: session.createdAt
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

// ============================================================
// Main Entry Points
// ============================================================

/**
 * Analyze a task for multi-approach suitability
 * Does not execute, just returns analysis
 */
function analyzeForMultiApproach(taskDescription, complexityLevel = null) {
  // Try to assess complexity if not provided
  let complexity = complexityLevel;
  if (!complexity) {
    try {
      const { assessTaskComplexity } = require('./flow-complexity');
      const result = assessTaskComplexity(taskDescription);
      complexity = result.level;
    } catch {
      complexity = 'medium';
    }
  }

  const shouldUse = shouldUseMultiApproach(complexity);
  const config = getMultiApproachConfig();

  // Generate approach previews
  const approaches = generateApproachPrompts(taskDescription, config.maxApproaches);

  return {
    task: taskDescription,
    complexity,
    multiApproach: shouldUse,
    config: {
      mode: config.mode,
      maxApproaches: config.maxApproaches,
      triggerOn: config.triggerOn,
      selectionStrategy: config.selectionStrategy
    },
    approaches: approaches.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description
    }))
  };
}

/**
 * Start a multi-approach session for a task
 * Returns session that can be executed step by step
 */
function startMultiApproach(taskDescription, options = {}) {
  const config = getMultiApproachConfig();

  const approaches = generateApproachPrompts(
    taskDescription,
    options.maxApproaches || config.maxApproaches
  );

  const session = createSession(taskDescription, approaches);
  session.status = 'created';
  session.config = config;

  // Save session
  saveSession(session);

  return session;
}

/**
 * Format analysis for display
 */
function formatAnalysis(analysis) {
  let output = '';

  output += `${colors.cyan}Multi-Approach Analysis${colors.reset}\n`;
  output += `${'═'.repeat(50)}\n\n`;

  // Task summary
  output += `${colors.bold}Task:${colors.reset} ${analysis.task.slice(0, 100)}${analysis.task.length > 100 ? '...' : ''}\n`;
  output += `${colors.bold}Complexity:${colors.reset} ${analysis.complexity}\n\n`;

  // Multi-approach decision
  if (analysis.multiApproach.shouldUse) {
    output += `${colors.green}✓ Multi-approach recommended${colors.reset}\n`;
    output += `  Reason: ${analysis.multiApproach.reason}\n`;

    if (analysis.multiApproach.needsUserApproval) {
      output += `  ${colors.yellow}Mode is "suggest" - will ask for approval${colors.reset}\n`;
    }
  } else {
    output += `${colors.dim}○ Multi-approach not needed${colors.reset}\n`;
    output += `  Reason: ${analysis.multiApproach.reason}\n`;
  }

  output += '\n';

  // Approaches
  if (analysis.approaches.length > 0) {
    output += `${colors.bold}Available Approaches (${analysis.approaches.length}):${colors.reset}\n`;
    for (const approach of analysis.approaches) {
      output += `  ${colors.cyan}${approach.name}${colors.reset}: ${approach.description}\n`;
    }
    output += '\n';
  }

  // Config
  output += `${colors.dim}Config: mode=${analysis.config.mode}, triggers=${analysis.config.triggerOn.join(',')}${colors.reset}\n`;

  return output;
}

/**
 * Format suggestion prompt for user
 */
function formatSuggestionPrompt(analysis) {
  return `
${colors.yellow}Multi-Approach Suggestion${colors.reset}

This task has "${analysis.complexity}" complexity. Using multi-approach validation
could help find the best solution but will use more tokens.

${colors.bold}What multi-approach does:${colors.reset}
1. Generates ${analysis.config.maxApproaches} different solutions
2. Validates each through quality gates
3. Selects the best passing approach

${colors.bold}Approaches that would be tried:${colors.reset}
${analysis.approaches.map(a => `  • ${a.name}: ${a.description}`).join('\n')}

${colors.bold}Options:${colors.reset}
  [Y] Yes, use multi-approach (more thorough)
  [N] No, use single approach (faster, less tokens)
  [A] Always use for this complexity level
  [S] Show me more details

`.trim();
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Multi-Approach Validation

Generate multiple solution approaches for complex tasks, validate each,
and select the best one.

Usage:
  flow multi-approach "task description"
  flow multi-approach --analyze "task"     # Analyze without executing
  flow multi-approach --list               # List recent sessions
  flow multi-approach --config             # Show configuration

Options:
  --analyze    Just analyze, don't start session
  --list       List recent multi-approach sessions
  --config     Show current configuration
  --json       Output as JSON
  --help, -h   Show this help

Modes (configurable in config.json):
  "suggest"    Ask user before using extra tokens (default)
  "auto"       Automatically use for high-complexity tasks
  "off"        Disabled

Examples:
  flow multi-approach "Implement user authentication with OAuth"
  flow multi-approach --analyze "Refactor the payment module"
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');

  if (args.includes('--list')) {
    const sessions = listSessions();
    if (jsonOutput) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      console.log(`${colors.cyan}Recent Multi-Approach Sessions${colors.reset}\n`);
      if (sessions.length === 0) {
        console.log(`${colors.dim}No sessions found.${colors.reset}`);
      } else {
        for (const s of sessions) {
          const statusIcon = s.status === 'complete' ? colors.green + '✓' : colors.yellow + '○';
          console.log(`${statusIcon} ${s.id}${colors.reset}`);
          console.log(`  Task: ${s.task}`);
          console.log(`  Status: ${s.status}`);
          if (s.selectedApproach) {
            console.log(`  Selected: ${s.selectedApproach}`);
          }
          console.log('');
        }
      }
    }
    process.exit(0);
  }

  if (args.includes('--config')) {
    const config = getMultiApproachConfig();
    if (jsonOutput) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(`${colors.cyan}Multi-Approach Configuration${colors.reset}\n`);
      console.log(`  Enabled: ${config.enabled}`);
      console.log(`  Mode: ${config.mode}`);
      console.log(`  Trigger on: ${config.triggerOn.join(', ')}`);
      console.log(`  Max approaches: ${config.maxApproaches}`);
      console.log(`  Selection: ${config.selectionStrategy}`);
    }
    process.exit(0);
  }

  // Get task description
  const taskDescription = args
    .filter(a => !a.startsWith('--'))
    .join(' ');

  if (!taskDescription) {
    console.log(`${colors.red}Error: Please provide a task description${colors.reset}`);
    showHelp();
    process.exit(1);
  }

  // Analyze or start session
  if (args.includes('--analyze')) {
    const analysis = analyzeForMultiApproach(taskDescription);

    if (jsonOutput) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatAnalysis(analysis));
    }
  } else {
    // Start a session
    const session = startMultiApproach(taskDescription);

    if (jsonOutput) {
      console.log(JSON.stringify(session, null, 2));
    } else {
      console.log(`${colors.green}✓${colors.reset} Created multi-approach session: ${session.id}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Approaches: ${session.approaches.length}`);
      console.log(`\n  Session saved to: ${APPROACHES_DIR}/${session.id}.json`);
      console.log(`\n${colors.dim}Note: This creates a session. Execution is handled by the orchestrator.${colors.reset}`);
    }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getMultiApproachConfig,
  DEFAULT_CONFIG,

  // Decision making
  shouldUseMultiApproach,
  analyzeForMultiApproach,

  // Approach generation
  generateApproachPrompts,
  APPROACH_STRATEGIES,

  // Session management
  createSession,
  startMultiApproach,
  saveSession,
  loadSession,
  listSessions,

  // Validation & selection
  calculateApproachScore,
  selectBestApproach,

  // Formatting
  formatAnalysis,
  formatSuggestionPrompt
};

if (require.main === module) {
  main();
}
