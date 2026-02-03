#!/usr/bin/env node

/**
 * Wogi Flow - Autonomous Browser Debug Loop
 *
 * Orchestrates an autonomous debugging system that:
 * 1. Navigates to the app and reproduces issues
 * 2. Reads console errors and identifies problems
 * 3. Analyzes failures and suggests fixes
 * 4. Applies fixes and refreshes to verify
 * 5. Loops until the issue is resolved or max iterations reached
 *
 * Usage:
 *   flow browser-debug "description of expected behavior"
 *   flow browser-debug --url http://localhost:3000 "click Login, expect dashboard"
 *
 * Requires:
 *   - Chrome DevTools MCP server OR Claude in Chrome extension
 *   - Run with: claude --chrome
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, success, warn, error, info, safeJsonParse } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const SESSIONS_DIR = path.join(PROJECT_ROOT, '.workflow', 'debug-sessions');

// ============================================================
// Configuration
// ============================================================

/**
 * Get browser debugging configuration with defaults
 */
function getDebugConfig() {
  const config = getConfig();
  const defaults = {
    enabled: true,
    maxIterations: 10,
    iterationTimeout: 60000,
    screenshotOnEachIteration: true,
    autoRefreshAfterFix: true,
    hotReloadWaitMs: 2000,
    consoleErrorPatterns: true,
    saveDebugSession: true,
    sessionSavePath: '.workflow/debug-sessions/',
    triggers: {
      manual: true,
      suggestOnBroken: true,
      autoOnTestFailure: false
    },
    naturalLanguage: {
      enabled: true,
      useAppMap: true
    }
  };

  return { ...defaults, ...(config.browserDebugging || {}) };
}

// ============================================================
// Debug Session Management
// ============================================================

/**
 * Create a new debug session
 * @param {object} options - Session options
 * @returns {object} - Session object
 */
function createDebugSession(options) {
  const { url, description, expectedBehavior, maxIterations } = options;
  const config = getDebugConfig();

  const session = {
    id: `debug-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date().toISOString(),
    url: url || config.baseUrl || 'http://localhost:3000',
    description: description || '',
    expectedBehavior: expectedBehavior || description,
    maxIterations: maxIterations || config.maxIterations,
    currentIteration: 0,
    status: 'pending', // pending, running, passed, failed, max_iterations_reached
    iterations: [],
    fixes: [],
    finalResult: null,
    config: {
      screenshotOnEachIteration: config.screenshotOnEachIteration,
      hotReloadWaitMs: config.hotReloadWaitMs,
      iterationTimeout: config.iterationTimeout
    }
  };

  return session;
}

/**
 * Save debug session to file
 * @param {object} session - Session to save
 * @returns {string|null} - Path to saved file or null on error
 */
function saveDebugSession(session) {
  const config = getDebugConfig();
  if (!config.saveDebugSession) return null;

  const sessionsDir = path.join(PROJECT_ROOT, config.sessionSavePath);
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  const fileName = `${session.id}.json`;
  const filePath = path.join(sessionsDir, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return filePath;
  } catch (err) {
    error(`Failed to save debug session: ${err.message}`);
    return null;
  }
}

/**
 * Load a debug session from file
 * @param {string} sessionId - Session ID to load
 * @returns {object|null} - Session object or null
 */
function loadDebugSession(sessionId) {
  const config = getDebugConfig();
  const sessionsDir = path.join(PROJECT_ROOT, config.sessionSavePath);
  const filePath = path.join(sessionsDir, `${sessionId}.json`);

  return safeJsonParse(filePath, null);
}

/**
 * List recent debug sessions
 * @param {number} limit - Max sessions to return
 * @returns {Array} - List of session summaries
 */
function listDebugSessions(limit = 10) {
  const config = getDebugConfig();
  const sessionsDir = path.join(PROJECT_ROOT, config.sessionSavePath);

  if (!fs.existsSync(sessionsDir)) return [];

  try {
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const session = safeJsonParse(path.join(sessionsDir, f), null);
        if (!session) return null;
        return {
          id: session.id,
          createdAt: session.createdAt,
          url: session.url,
          description: session.description?.substring(0, 50),
          status: session.status,
          iterations: session.iterations?.length || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    return files;
  } catch (err) {
    error(`Failed to list sessions: ${err.message}`);
    return [];
  }
}

// ============================================================
// Debug Iteration
// ============================================================

/**
 * Create a debug iteration record
 * @param {number} iterationNumber - Current iteration (1-based)
 * @returns {object} - Iteration object
 */
function createIteration(iterationNumber) {
  return {
    number: iterationNumber,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running', // running, passed, failed
    steps: [],
    consoleErrors: [],
    screenshotBefore: null,
    screenshotAfter: null,
    analysis: null,
    fix: null,
    verificationResult: null
  };
}

/**
 * Record a step in the current iteration
 * @param {object} iteration - Current iteration
 * @param {string} action - Action performed
 * @param {boolean} success - Whether it succeeded
 * @param {string} details - Additional details
 */
function recordStep(iteration, action, succeeded, details = '') {
  iteration.steps.push({
    timestamp: new Date().toISOString(),
    action,
    success: succeeded,
    details
  });
}

// ============================================================
// Console Error Analysis
// ============================================================

/**
 * Parse console errors and categorize them
 * @param {Array} consoleMessages - Raw console messages
 * @returns {object} - Categorized errors
 */
function categorizeConsoleErrors(consoleMessages) {
  const errors = {
    javascript: [],
    network: [],
    react: [],
    vue: [],
    typescript: [],
    other: []
  };

  for (const msg of consoleMessages) {
    const text = msg.text || msg.message || String(msg);
    const level = msg.level || msg.type || 'error';

    if (level !== 'error' && level !== 'warning') continue;

    // Categorize by error type
    if (text.includes('TypeError') || text.includes('ReferenceError') || text.includes('SyntaxError')) {
      errors.javascript.push({ text, level, source: msg.source });
    } else if (text.includes('Failed to fetch') || text.includes('NetworkError') || text.includes('CORS') || text.includes('404') || text.includes('500')) {
      errors.network.push({ text, level, source: msg.source });
    } else if (text.includes('React') || text.includes('Warning:') || text.includes('Uncaught Error:')) {
      errors.react.push({ text, level, source: msg.source });
    } else if (text.includes('Vue') || text.includes('[Vue warn]')) {
      errors.vue.push({ text, level, source: msg.source });
    } else if (text.includes('TS') || text.includes('typescript')) {
      errors.typescript.push({ text, level, source: msg.source });
    } else {
      errors.other.push({ text, level, source: msg.source });
    }
  }

  return errors;
}

/**
 * Extract the most relevant error for fixing
 * @param {object} categorizedErrors - Errors by category
 * @returns {object|null} - Most relevant error
 */
function extractPrimaryError(categorizedErrors) {
  // Priority: JavaScript > Network > React/Vue > TypeScript > Other
  const priorities = ['javascript', 'network', 'react', 'vue', 'typescript', 'other'];

  for (const category of priorities) {
    if (categorizedErrors[category]?.length > 0) {
      return {
        category,
        error: categorizedErrors[category][0],
        allInCategory: categorizedErrors[category]
      };
    }
  }

  return null;
}

// ============================================================
// Fix Generation (Placeholder - AI does the actual fixing)
// ============================================================

/**
 * Generate fix suggestion based on error analysis
 * This creates structured guidance for the AI to apply fixes
 * @param {object} primaryError - The primary error to fix
 * @param {object} session - Current debug session
 * @returns {object} - Fix suggestion
 */
function generateFixSuggestion(primaryError, session) {
  if (!primaryError) {
    return {
      type: 'unknown',
      confidence: 'low',
      suggestion: 'Unable to identify specific error. Manual investigation needed.',
      actions: []
    };
  }

  const errorText = primaryError.error.text;
  const category = primaryError.category;

  // Load error patterns for specific guidance
  let patterns;
  try {
    patterns = require('./flow-browser-error-patterns');
  } catch (err) {
    patterns = { getPatternForError: () => null };
  }

  const pattern = patterns.getPatternForError ? patterns.getPatternForError(errorText) : null;

  if (pattern) {
    return {
      type: pattern.category,
      confidence: pattern.confidence || 'medium',
      suggestion: pattern.suggestion,
      likelyCauses: pattern.likelyCauses,
      investigationSteps: pattern.investigationSteps,
      actions: pattern.suggestedFixes || []
    };
  }

  // Fallback generic suggestions by category
  const genericSuggestions = {
    javascript: {
      type: 'javascript-error',
      confidence: 'medium',
      suggestion: 'JavaScript runtime error detected',
      likelyCauses: [
        'Accessing property on undefined/null',
        'Missing null check',
        'Async data not loaded yet'
      ],
      investigationSteps: [
        'Check the variable mentioned in the error',
        'Add console.log before the error line',
        'Check if async data is loaded before use'
      ]
    },
    network: {
      type: 'network-error',
      confidence: 'medium',
      suggestion: 'Network request failed',
      likelyCauses: [
        'Backend server not running',
        'Incorrect API URL',
        'CORS configuration issue',
        'Authentication required'
      ],
      investigationSteps: [
        'Check if backend is running',
        'Verify API endpoint URL',
        'Check browser Network tab for details'
      ]
    },
    react: {
      type: 'react-error',
      confidence: 'medium',
      suggestion: 'React component error',
      likelyCauses: [
        'Invalid prop type',
        'Missing key in list',
        'State update on unmounted component',
        'Render returning undefined'
      ],
      investigationSteps: [
        'Check component props',
        'Verify state management',
        'Check useEffect cleanup'
      ]
    },
    vue: {
      type: 'vue-error',
      confidence: 'medium',
      suggestion: 'Vue component error',
      likelyCauses: [
        'Template syntax error',
        'Reactive reference issue',
        'Component lifecycle issue'
      ],
      investigationSteps: [
        'Check template bindings',
        'Verify reactive state',
        'Check component lifecycle'
      ]
    }
  };

  return genericSuggestions[category] || {
    type: 'unknown',
    confidence: 'low',
    suggestion: `Error detected in ${category} category`,
    likelyCauses: ['Unknown cause'],
    investigationSteps: ['Manual investigation required']
  };
}

// ============================================================
// Debug Loop Output Formatting
// ============================================================

/**
 * Format debug session start message
 */
function formatSessionStart(session) {
  return `
${color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${color('cyan', '🔍 BROWSER DEBUG SESSION')}
${color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

URL: ${session.url}
Expected: ${session.expectedBehavior}
Max iterations: ${session.maxIterations}
`.trim();
}

/**
 * Format iteration start message
 */
function formatIterationStart(iteration) {
  return `
${color('yellow', `📸 Iteration ${iteration.number}:`)}`;
}

/**
 * Format console errors found
 */
function formatConsoleErrors(categorizedErrors, primaryError) {
  const lines = [];

  const totalErrors = Object.values(categorizedErrors).flat().length;
  if (totalErrors === 0) {
    lines.push(color('green', '   ✓ No console errors detected'));
    return lines.join('\n');
  }

  lines.push(color('red', `\n📋 Console Errors (${totalErrors} found):`));

  if (primaryError) {
    lines.push(`   ${color('red', '→')} ${primaryError.error.text.substring(0, 200)}`);
    if (primaryError.error.text.length > 200) {
      lines.push('     ...(truncated)');
    }
  }

  return lines.join('\n');
}

/**
 * Format fix suggestion
 */
function formatFixSuggestion(fix) {
  const lines = [
    '',
    color('yellow', '🔍 Analysis:'),
    `   - Type: ${fix.type}`,
    `   - Confidence: ${fix.confidence}`
  ];

  if (fix.likelyCauses?.length > 0) {
    lines.push(`   - Likely causes:`);
    fix.likelyCauses.forEach(cause => {
      lines.push(`     • ${cause}`);
    });
  }

  lines.push('');
  lines.push(color('cyan', '💡 Suggested Fix:'));
  lines.push(`   ${fix.suggestion}`);

  return lines.join('\n');
}

/**
 * Format iteration result
 */
function formatIterationResult(iteration) {
  const status = iteration.status === 'passed'
    ? color('green', '🟢 PASS')
    : color('red', '🔴 FAIL');

  return `
   ${status}: ${iteration.verificationResult || 'Verification pending'}`;
}

/**
 * Format session completion
 */
function formatSessionComplete(session) {
  const statusColor = session.status === 'passed' ? 'green' : 'red';
  const statusIcon = session.status === 'passed' ? '✅' : '❌';

  const lines = [
    '',
    color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'),
    color(statusColor, `${statusIcon} DEBUG SESSION ${session.status.toUpperCase()}`),
    color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'),
    ''
  ];

  if (session.fixes.length > 0) {
    lines.push('Issues found and fixed:');
    session.fixes.forEach((fix, i) => {
      lines.push(`  ${i + 1}. ${fix.description || fix.type}`);
    });
    lines.push('');
  }

  lines.push(`Iterations: ${session.iterations.length}`);

  if (session.iterations.length > 0) {
    const duration = new Date(session.iterations[session.iterations.length - 1].completedAt || new Date()) -
                     new Date(session.iterations[0].startedAt);
    lines.push(`Duration: ${Math.round(duration / 1000)}s`);
  }

  if (session.fixes.length > 0) {
    lines.push('');
    lines.push('Files modified:');
    const uniqueFiles = [...new Set(session.fixes.map(f => f.file).filter(Boolean))];
    uniqueFiles.forEach(file => {
      lines.push(`  - ${file}`);
    });
  }

  return lines.join('\n');
}

// ============================================================
// Main Debug Loop Execution Instructions
// ============================================================

/**
 * Generate debug loop execution plan for Claude to follow
 * @param {object} session - Debug session
 * @returns {object} - Execution plan
 */
function generateDebugPlan(session) {
  return {
    session,
    instructions: `
## Autonomous Browser Debug Loop

You are about to run an autonomous debugging session. Follow these steps:

### Initial Setup
1. Ensure Chrome integration is active (\`/chrome\` to check)
2. Navigate to: ${session.url}
3. Take an initial screenshot

### Debug Loop (max ${session.maxIterations} iterations)

For each iteration:

**Step 1: Capture State**
- Take a screenshot (before state)
- Read console logs/errors using \`list_console_messages\` or check browser console
- Note any visible errors on the page

**Step 2: Try Expected Action**
- ${session.expectedBehavior}
- Watch for what actually happens

**Step 3: Evaluate Result**
- Did it work as expected? → PASS, exit loop
- Something went wrong? → Continue to Step 4

**Step 4: Analyze Failure**
- Identify the primary error from console
- Determine the likely cause
- Find the relevant source file

**Step 5: Apply Fix**
- Edit the source file to fix the issue
- Use safe patterns (null checks, error handling)
- Keep fixes minimal and targeted

**Step 6: Verify Fix**
- Wait ${session.config.hotReloadWaitMs}ms for hot reload
- Or manually refresh the page
- Return to Step 1 for next iteration

### Exit Conditions
- ✅ PASS: Expected behavior is now working
- ❌ FAIL: Max iterations (${session.maxIterations}) reached without resolution
- ⚠️ BLOCKED: Cannot proceed (auth required, server down, etc.)

### After Completion
- Save summary of what was fixed
- Report files modified
- Ask if user wants to commit changes
`.trim(),
    chromeMcpTools: {
      navigation: ['browser_navigate', 'navigate'],
      interaction: ['browser_click', 'click', 'browser_type', 'fill'],
      verification: ['browser_read', 'take_snapshot'],
      debugging: ['list_console_messages', 'evaluate_script'],
      screenshots: ['browser_screenshot', 'take_screenshot']
    }
  };
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
${color('cyan', 'Wogi Flow - Autonomous Browser Debug Loop')}

Usage:
  flow browser-debug "description"              Start debug session
  flow browser-debug --url <url> "description"  Start with specific URL
  flow browser-debug --list                     List recent sessions
  flow browser-debug --resume <session-id>      Resume a session
  flow browser-debug --check                    Check configuration

Examples:
  flow browser-debug "click Login, expect to see dashboard"
  flow browser-debug --url http://localhost:3000/tasks "click Pull Tasks, expect task list"

This generates instructions for Claude to follow using Chrome MCP tools.
The actual debugging happens when Claude executes the plan.

Run with Claude Code's Chrome integration:
  claude --chrome
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--check')) {
    const config = getDebugConfig();
    console.log(color('cyan', '\nBrowser Debugging Configuration:'));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (args.includes('--list')) {
    const sessions = listDebugSessions();
    if (sessions.length === 0) {
      console.log(color('yellow', 'No debug sessions found.'));
    } else {
      console.log(color('cyan', '\nRecent Debug Sessions:'));
      sessions.forEach(s => {
        const statusIcon = s.status === 'passed' ? '✅' : s.status === 'failed' ? '❌' : '⏸️';
        console.log(`  ${statusIcon} ${s.id} - ${s.description || '(no description)'}`);
        console.log(`     ${s.createdAt} | ${s.iterations} iterations | ${s.url}`);
      });
    }
    return;
  }

  // Parse URL option
  let url = null;
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1 && args[urlIndex + 1]) {
    url = args[urlIndex + 1];
    args.splice(urlIndex, 2);
  }

  // Remaining args are the description
  const description = args.filter(a => !a.startsWith('--')).join(' ');

  if (!description) {
    error('Please provide a description of the expected behavior');
    console.log('Example: flow browser-debug "click Login, expect dashboard"');
    process.exit(1);
  }

  // Create session
  const session = createDebugSession({
    url,
    description,
    expectedBehavior: description
  });

  // Generate and display plan
  const plan = generateDebugPlan(session);

  console.log(formatSessionStart(session));
  console.log('');
  console.log(color('yellow', 'Debug Plan Generated'));
  console.log(color('dim', '─────────────────────'));
  console.log(plan.instructions);
  console.log('');

  // Save session for potential resumption
  const savedPath = saveDebugSession(session);
  if (savedPath) {
    console.log(color('dim', `Session saved: ${savedPath}`));
  }

  console.log('');
  console.log(color('cyan', 'To execute this debug session, use /wogi-debug-browser'));
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getDebugConfig,
  createDebugSession,
  saveDebugSession,
  loadDebugSession,
  listDebugSessions,
  createIteration,
  recordStep,
  categorizeConsoleErrors,
  extractPrimaryError,
  generateFixSuggestion,
  generateDebugPlan,
  formatSessionStart,
  formatIterationStart,
  formatConsoleErrors,
  formatFixSuggestion,
  formatIterationResult,
  formatSessionComplete
};

if (require.main === module) {
  main();
}
