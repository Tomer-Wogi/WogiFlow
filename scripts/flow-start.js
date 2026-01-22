#!/usr/bin/env node

/**
 * Wogi Flow - Start Task
 *
 * Moves a task from ready to inProgress queue.
 * v2.0: Integrates with durable session for crash recovery and suspension support.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  moveTaskAsync,
  findTask,
  color,
  error,
  getConfig
} = require('./flow-utils');
// Auto-context module (optional - graceful degradation)
let autoContext = null;
try {
  autoContext = require('./flow-auto-context');
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-auto-context not available: ${err.message}`);
}
const getAutoContext = autoContext?.getAutoContext || (() => Promise.resolve({ files: [] }));
const formatAutoContext = autoContext?.formatAutoContext || (() => '');
const searchTraces = autoContext?.searchTraces || (() => []);
const extractKeywords = autoContext?.extractKeywords || (() => []);

// Multi-approach module (optional - graceful degradation)
let multiApproach = null;
try {
  multiApproach = require('./flow-multi-approach');
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-multi-approach not available: ${err.message}`);
}
const shouldUseMultiApproach = multiApproach?.shouldUseMultiApproach || (() => ({ shouldUse: false }));

// Complexity assessment module (optional - graceful degradation)
let complexityModule = null;
try {
  complexityModule = require('./flow-complexity');
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-complexity not available: ${err.message}`);
}
const assessTaskComplexity = complexityModule?.assessTaskComplexity || (() => ({ level: 'unknown' }));

// v1.7.0 context memory management
const { warnIfContextHigh, checkContextHealth } = require('./flow-context-monitor');
const { setCurrentTask } = require('./flow-memory-blocks');
const { trackTaskStart, checkAndDisplayResumeContext } = require('./flow-session-state');

// v2.0 durable session support
const {
  loadDurableSession,
  createDurableSession,
  createDurableSessionAsync,
  canResumeFromStep,
  getResumeContext,
  getSuspensionStatus,
  resumeSession,
  isSuspended,
  STEP_STATUS,
  clearPendingSkill  // v4.1: Clear pending skill state when task starts
} = require('./flow-durable-session');

// Spec loader for scope enforcement (optional - graceful degradation)
let loadSpec = null;
try {
  loadSpec = require('./flow-spec-generator').loadSpec;
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-spec-generator not available: ${err.message}`);
}

// v3.0 phased task execution (recursive enhancements)
const {
  initializePhasedTask,
  getCurrentPhase,
  getPhasedTaskStatus,
  formatPhasedStatus,
  isPhasedModeEnabled,
  generatePhaseContext
} = require('./flow-phased-task');

// v3.1 recursive context compaction (hierarchical context loading)
let contextCompact;
try {
  contextCompact = require('./flow-context-compact');
} catch (err) {
  // Module optional - graceful degradation
  contextCompact = null;
}

// v2.7 Registry relevance detection - import from semantic matching
const { SEMANTIC_KEYWORDS } = require('./flow-semantic-match');

// v4.0 Clarifying questions (optional - graceful degradation)
let clarifyingModule = null;
try {
  clarifyingModule = require('./flow-clarifying-questions');
} catch (err) {
  if (process.env.DEBUG) console.error(`[DEBUG] flow-clarifying-questions not available: ${err.message}`);
}
const generateQuestions = clarifyingModule?.generateQuestions || (() => []);
const formatQuestions = clarifyingModule?.formatQuestions || (() => '');

// Flatten semantic keywords for simple task detection
const FUNCTION_KEYWORDS = Object.values(SEMANTIC_KEYWORDS.functions || {}).flat();
const API_KEYWORDS = Object.values(SEMANTIC_KEYWORDS.apis || {}).flat();

/**
 * Check if task description suggests working with utility functions
 */
function isRelevantToFunctions(taskDescription) {
  const lower = taskDescription.toLowerCase();
  return FUNCTION_KEYWORDS.some(kw => lower.includes(kw)) ||
         /\b(add|create|new|write|implement)\b.*\b(function|method|helper)\b/i.test(taskDescription);
}

/**
 * Check if task description suggests working with API calls
 */
function isRelevantToAPIs(taskDescription) {
  const lower = taskDescription.toLowerCase();
  return API_KEYWORDS.some(kw => lower.includes(kw)) ||
         /\b(add|create|new|implement)\b.*\b(api|endpoint|call|request)\b/i.test(taskDescription) ||
         /\b(fetch|load|save|get|post|put|delete)\b.*\b(data|user|item|record)\b/i.test(taskDescription);
}

/**
 * Get summary of registry contents
 */
function getRegistrySummary(registryPath, type) {
  try {
    if (!fs.existsSync(registryPath)) return null;

    const content = fs.readFileSync(registryPath, 'utf-8');
    if (type === 'function') {
      const registry = JSON.parse(content);
      const count = registry.functions?.length || 0;
      const categories = Object.keys(registry.categories || {});
      return { count, categories };
    } else if (type === 'api') {
      const registry = JSON.parse(content);
      const funcCount = registry.clientFunctions?.length || 0;
      const endpointCount = registry.endpoints?.length || 0;
      const services = Object.keys(registry.services || {});
      return { funcCount, endpointCount, services };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Triage a request that isn't a task ID
 * Outputs classification context for the agent (Claude) to decide what to do
 * @param {string} prompt - The user's request
 */
function triageRequest(prompt) {
  console.log('');
  console.log(color('cyan', '━'.repeat(60)));
  console.log(color('cyan', '  REQUEST TRIAGE'));
  console.log(color('cyan', '━'.repeat(60)));
  console.log('');
  console.log(`Request: "${prompt}"`);
  console.log('');
  console.log(color('yellow', 'Decide based on your understanding:'));
  console.log('');
  console.log(color('green', 'OPERATIONAL') + ' (execute directly, no task needed):');
  console.log('  - Version control: push, pull, fetch, merge, commit');
  console.log('  - Publishing: deploy, publish to any platform');
  console.log('  - Build/CI: run tests, build, lint, format');
  console.log('  - Maintenance: update deps, bump version');
  console.log('  - Reviews: code review, check something');
  console.log('');
  console.log(color('yellow', 'SMALL FIX') + ' (execute + log for learning):');
  console.log('  - Trivial changes: typo, color, text');
  console.log('  - Single line changes');
  console.log('  - No behavioral change');
  console.log('');
  console.log(color('red', 'IMPLEMENTATION') + ' (create task first):');
  console.log('  - New features: add, create, build');
  console.log('  - Bug fixes: fix errors, resolve issues');
  console.log('  - Refactoring: restructure, reorganize');
  console.log('');
  console.log(color('cyan', '━'.repeat(60)));
  console.log('');
  console.log(color('dim', 'Based on your classification:'));
  console.log(`  ${color('green', 'OPERATIONAL')} → Proceed with the request directly`);
  console.log(`  ${color('yellow', 'SMALL FIX')} → Execute, then add to request-log.md with #quick-fix tag`);
  console.log(`  ${color('red', 'IMPLEMENTATION')} → Use /wogi-bug or /wogi-story first`);
  console.log('');

  // Return triage mode indicator for programmatic use
  return {
    triageMode: true,
    prompt,
    awaitingClassification: true
  };
}

async function main() {
  const taskIdArg = process.argv[2];
  const forceResume = process.argv.includes('--force-resume');
  const skipSuspensionCheck = process.argv.includes('--skip-suspension');
  const usePhasedMode = process.argv.includes('--phased');

  if (!taskIdArg) {
    console.log('Usage: flow start <task-id> [--force-resume] [--skip-suspension] [--phased]');
    console.log('       flow start "<request>" - Triage a request (agent decides)');
    process.exit(1);
  }

  // v4.2: Check if this is a quoted request or non-task-ID input
  // Task IDs match pattern: wf-XXXXXXXX (hex hash)
  const isTaskId = /^wf-[a-f0-9]+$/i.test(taskIdArg);

  if (!isTaskId) {
    // This is a quoted request, not a task ID - run triage
    const prompt = taskIdArg.replace(/^["']|["']$/g, ''); // Remove surrounding quotes if any
    triageRequest(prompt);
    process.exit(0);
  }

  const taskId = taskIdArg;

  // v1.7.0: Check for session resume context
  const config = getConfig();
  if (config.sessionState?.autoRestore !== false) {
    checkAndDisplayResumeContext();
  }

  // v1.7.0: Check context health at task start
  if (config.contextMonitor?.checkOnSessionStart !== false) {
    warnIfContextHigh();
  }

  // v2.0: Check for existing durable session for this task
  if (config.durableSteps?.enabled !== false) {
    const existingSession = loadDurableSession();

    if (existingSession && existingSession.taskId === taskId) {
      // Found existing session for this task - handle resume
      const resumeInfo = canResumeFromStep(existingSession);
      const suspension = getSuspensionStatus();

      if (suspension && !skipSuspensionCheck) {
        // Task is suspended
        console.log('');
        console.log(color('yellow', '⏸️  Task is SUSPENDED'));
        console.log(color('yellow', '─'.repeat(50)));
        console.log(`Task: ${taskId}`);
        console.log(`Type: ${suspension.type}`);
        console.log(`Reason: ${suspension.reason}`);
        console.log(`Suspended at: ${suspension.suspendedAt}`);
        console.log('');

        if (suspension.canResume) {
          console.log(color('green', '✓ Resume condition is met!'));
          if (forceResume) {
            console.log('Resuming session...');
            resumeSession({ force: true });
          } else {
            console.log(`Run: ${color('cyan', `flow start ${taskId} --force-resume`)} to continue`);
            process.exit(0);
          }
        } else {
          console.log(color('red', '✗ Resume condition not yet met'));
          console.log(`Reason: ${suspension.resumeReason}`);
          console.log('');
          console.log(`To override: ${color('cyan', `flow start ${taskId} --skip-suspension`)}`);
          process.exit(0);
        }
      }

      if (resumeInfo.canResume && resumeInfo.completedCount > 0) {
        // Show resume context
        console.log('');
        console.log(color('cyan', '🔄 Resuming from durable session'));
        console.log(color('cyan', '─'.repeat(50)));
        console.log(`Task: ${taskId}`);
        console.log(`Progress: ${resumeInfo.completedCount}/${resumeInfo.totalSteps} steps completed`);
        console.log(`Resuming from: ${resumeInfo.fromStep?.description?.substring(0, 60) || resumeInfo.fromStep?.id}...`);
        console.log(color('cyan', '─'.repeat(50)));
        console.log('');
      }
    } else if (existingSession && existingSession.taskId !== taskId) {
      // Different task in session - block starting new task
      console.log('');
      console.log(color('yellow', '⚠️  Another task is in a durable session'));
      console.log(`Current session: ${existingSession.taskId}`);
      console.log(`Attempting to start: ${taskId}`);
      console.log('');
      console.log(`Finish current task first, or run: ${color('cyan', 'flow session clear')}`);
      console.log('');
      process.exit(1);
    }
  }

  if (!fileExists(PATHS.ready)) {
    error('No ready.json found');
    process.exit(1);
  }

  // Check if task exists and where it is
  const found = findTask(taskId);

  if (!found) {
    console.log(color('red', `Task ${taskId} not found in any queue`));
    process.exit(1);
  }

  if (found.list === 'inProgress') {
    console.log(color('yellow', `Task ${taskId} is already in progress`));
    process.exit(0);
  }

  if (found.list !== 'ready') {
    console.log(color('red', `Task ${taskId} is in ${found.list}, not ready`));
    process.exit(1);
  }

  // Move task from ready to inProgress (with file locking)
  const result = await moveTaskAsync(taskId, 'ready', 'inProgress');

  if (!result.success) {
    error(result.error);
    process.exit(1);
  }

  console.log(color('green', `✓ Started: ${taskId}`));

  const taskTitle = result.task && typeof result.task === 'object' && result.task.title
    ? result.task.title
    : taskId;

  if (result.task && typeof result.task === 'object' && result.task.title) {
    console.log(`  ${result.task.title}`);
  }

  // v1.7.0: Track task in session state and memory blocks
  try {
    trackTaskStart(taskId, taskTitle);
    setCurrentTask(taskId, taskTitle);
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Task tracking: ${err.message}`);
  }

  // v2.0: Initialize durable session for crash recovery (with file locking)
  if (config.durableSteps?.enabled !== false) {
    try {
      // Extract acceptance criteria if available
      const acceptanceCriteria = result.task?.acceptanceCriteria || result.task?.scenarios || [];
      const steps = Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [];
      const sessionSteps = steps.length > 0 ? steps : [taskTitle || taskId];

      // v4.0: Load spec to get filesToChange for scope enforcement
      let filesToChange = null;
      if (loadSpec) {
        try {
          const spec = loadSpec(taskId);
          if (spec?.sections?.filesToChange) {
            filesToChange = spec.sections.filesToChange;
            if (process.env.DEBUG) {
              const fileCount = (filesToChange.create?.length || 0) +
                               (filesToChange.modify?.length || 0) +
                               (filesToChange.delete?.length || 0);
              console.log(color('dim', `[DEBUG] Loaded scope: ${fileCount} files from spec`));
            }
          }
        } catch (err) {
          if (process.env.DEBUG) console.error(`[DEBUG] Spec load for scope: ${err.message}`);
        }
      }

      // Use async version with file locking to prevent race conditions
      const session = await createDurableSessionAsync(taskId, 'task', sessionSteps, {
        filesToChange
      });

      // v4.1: Clear pending skill state now that task has started
      // This signals to the stop hook that the skill has been executed
      clearPendingSkill();

      if (steps.length > 0) {
        console.log(color('cyan', `📋 Durable session initialized with ${steps.length} steps`));
      } else if (process.env.DEBUG) {
        console.log(color('cyan', '📋 Durable session initialized (no acceptance criteria)'));
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Durable session init: ${err.message}`);
    }
  }

  // v3.0: Initialize phased execution if requested or auto-enabled for complex tasks
  const shouldUsePhased = usePhasedMode || (config.phases?.autoEnable && isPhasedModeEnabled());

  if (shouldUsePhased) {
    try {
      // Check if task already has phased state
      const existingPhasedState = getPhasedTaskStatus(taskId);

      if (existingPhasedState && existingPhasedState.status === 'active') {
        // Resume existing phased execution
        const currentPhase = getCurrentPhase(taskId);
        console.log('');
        console.log(color('cyan', '━'.repeat(50)));
        console.log(color('cyan', '📐 Phased Execution (Resuming)'));
        console.log(color('cyan', '━'.repeat(50)));
        console.log(formatPhasedStatus(existingPhasedState));

        if (currentPhase) {
          console.log('');
          console.log(color('yellow', `Current Focus: ${currentPhase.name}`));
          console.log(color('dim', currentPhase.description));

          // Generate phase context to display
          const phaseContext = generatePhaseContext(currentPhase, result.task || {},
            existingPhasedState.phases.filter(p => p.status === 'completed'));
          console.log('');
          console.log(phaseContext);
        }
      } else {
        // Initialize new phased execution
        const phasedTask = initializePhasedTask(taskId, {
          skipPhases: config.phases?.skipPhases || []
        });

        console.log('');
        console.log(color('cyan', '━'.repeat(50)));
        console.log(color('cyan', '📐 Phased Execution (Initialized)'));
        console.log(color('cyan', '━'.repeat(50)));
        console.log(formatPhasedStatus(phasedTask));

        const firstPhase = phasedTask.phases[0];
        if (firstPhase) {
          console.log('');
          console.log(color('yellow', `Starting Phase: ${firstPhase.name}`));
          console.log(color('dim', firstPhase.description));

          const phaseContext = generatePhaseContext(firstPhase, result.task || {}, []);
          console.log('');
          console.log(phaseContext);
        }
      }

      console.log('');
      console.log(color('dim', 'Phase commands: flow phase complete <taskId> | flow phase skip <taskId> | flow phase status <taskId>'));
      console.log('');
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Phased task init: ${err.message}`);
    }
  }

  // Auto-context: show relevant files for this task
  const taskDescription = result.task?.title || result.task?.description || taskId;

  if (config.autoContext?.enabled !== false) {
    try {
      const context = await getAutoContext(taskDescription);
      if (context.files && context.files.length > 0) {
        console.log('');
        console.log(formatAutoContext(context));
      }
    } catch (err) {
      // Auto-context is best-effort; don't block task start on failure
      if (process.env.DEBUG) console.error(`[DEBUG] Auto-context: ${err.message}`);
    }
  }

  // v3.1: Hierarchical context from summary tree (recursive enhancements)
  if (contextCompact && config.contextCompact?.enabled !== false) {
    try {
      const treeStats = contextCompact.getStats();
      if (treeStats.exists) {
        // Get relevant context for this task
        const relevantContext = contextCompact.getContext(taskDescription);

        if (relevantContext.sections && relevantContext.sections.length > 0) {
          console.log('');
          console.log(color('cyan', '━'.repeat(50)));
          console.log(color('cyan', '📜 Hierarchical Context'));
          console.log(color('cyan', '━'.repeat(50)));
          console.log(`Summary tree: ${treeStats.nodes} nodes, ~${treeStats.tokens} tokens`);
          console.log(`Relevant sections: ${relevantContext.sections.length}`);

          // Show top relevant sections
          for (const section of relevantContext.sections.slice(0, 3)) {
            console.log(`  • ${section.title || section.id}: ${section.summary?.substring(0, 60) || '(no summary)'}...`);
          }

          if (relevantContext.sections.length > 3) {
            console.log(`  ... and ${relevantContext.sections.length - 3} more`);
          }
          console.log('');
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Context compact: ${err.message}`);
    }
  }

  // v4.0: Generate clarifying questions for medium/large tasks
  if (config.clarifyingQuestions?.enabled !== false) {
    try {
      const questionContext = {
        taskDescription,
        taskType: result.task?.type || 'feature',
        matchedFiles: [] // Will be populated from auto-context if available
      };

      const questions = generateQuestions(questionContext);
      if (questions.length > 0) {
        const formatted = formatQuestions(questions);
        console.log(formatted);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[DEBUG] Clarifying questions: ${err.message}`);
    }
  }

  // v2.7: Check and suggest function/API registries when relevant
  const funcRegistryPath = path.join(PATHS.state, 'function-index.json');
  const apiRegistryPath = path.join(PATHS.state, 'api-index.json');
  const funcMapPath = path.join(PATHS.state, 'function-map.md');
  const apiMapPath = path.join(PATHS.state, 'api-map.md');

  const showFunctionRegistry = config.functionRegistry?.enabled !== false && isRelevantToFunctions(taskDescription);
  const showApiRegistry = config.apiRegistry?.enabled !== false && isRelevantToAPIs(taskDescription);

  if (showFunctionRegistry || showApiRegistry) {
    console.log('');
    console.log(color('cyan', '━'.repeat(50)));
    console.log(color('cyan', '📚 Reuse Check'));
    console.log(color('cyan', '━'.repeat(50)));

    if (showFunctionRegistry) {
      const funcSummary = getRegistrySummary(funcRegistryPath, 'function');
      if (funcSummary && funcSummary.count > 0) {
        console.log(color('yellow', '📦 Function Registry:'));
        console.log(`   ${funcSummary.count} functions available`);
        if (funcSummary.categories.length > 0) {
          console.log(`   Categories: ${funcSummary.categories.join(', ')}`);
        }
        console.log(`   ${color('dim', `Check: .workflow/state/function-map.md`)}`);
        console.log('');
      } else {
        console.log(color('yellow', '📦 Function Registry:'));
        console.log('   No functions indexed yet.');
        console.log(`   Run: ${color('cyan', 'flow function-index scan')} to populate`);
        console.log('');
      }
    }

    if (showApiRegistry) {
      const apiSummary = getRegistrySummary(apiRegistryPath, 'api');
      if (apiSummary && (apiSummary.funcCount > 0 || apiSummary.endpointCount > 0)) {
        console.log(color('yellow', '🌐 API Registry:'));
        console.log(`   ${apiSummary.funcCount} API functions, ${apiSummary.endpointCount} endpoints`);
        if (apiSummary.services.length > 0) {
          console.log(`   Services: ${apiSummary.services.join(', ')}`);
        }
        console.log(`   ${color('dim', `Check: .workflow/state/api-map.md`)}`);
        console.log('');
      } else {
        console.log(color('yellow', '🌐 API Registry:'));
        console.log('   No APIs indexed yet.');
        console.log(`   Run: ${color('cyan', 'flow api-index scan')} to populate`);
        console.log('');
      }
    }

    console.log(color('dim', 'Before creating new functions/APIs, check if existing ones can be extended.'));
    console.log('');
  }

  // v1.0.4: Suggest trace generation for complex tasks
  if (config.traces?.suggestForComplex !== false) {
    try {
      const complexity = assessTaskComplexity(taskDescription);
      const keywords = extractKeywords(taskDescription);
      const existingTraces = searchTraces(keywords);

      // Suggest trace if complex and no relevant trace exists
      if (complexity.level === 'high' && existingTraces.length === 0) {
        console.log('');
        console.log(color('cyan', '━'.repeat(50)));
        console.log(color('cyan', '📍 Trace Suggestion'));
        console.log(color('cyan', '━'.repeat(50)));
        console.log('This is a complex task with no existing code trace.');
        console.log('Consider generating a trace first to understand the code flow.');
        console.log(`  Run: ${color('cyan', `flow trace "${taskDescription}"`)}`);
        console.log('');
      }
    } catch {
      // Ignore trace suggestion errors
    }
  }

  // Multi-approach: suggest for complex tasks
  if (config.multiApproach?.enabled !== false && config.multiApproach?.mode === 'suggest') {
    try {
      const complexity = assessTaskComplexity(taskDescription);
      const decision = shouldUseMultiApproach(complexity.level);

      if (decision.shouldUse) {
        console.log('');
        console.log(color('yellow', '━'.repeat(50)));
        console.log(color('yellow', '💡 Multi-Approach Suggestion'));
        console.log(color('yellow', '━'.repeat(50)));
        console.log(`This task has "${complexity.level}" complexity.`);
        console.log('Consider using multi-approach validation for better results.');
        console.log(`  Run: ${color('cyan', `flow multi-approach --analyze "${taskDescription}"`)}`);
        console.log('');
      }
    } catch {
      // Ignore multi-approach errors
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
