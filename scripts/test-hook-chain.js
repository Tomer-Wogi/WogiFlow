#!/usr/bin/env node
/**
 * Test the full hook chain: implementation-gate + adapter
 *
 * v5.3: Tests context injection (not blocking).
 * When no active task, prompts are ALLOWED through with additionalContext
 * that tells Claude to invoke /wogi-start automatically.
 */

// Clear module cache
const keysToDelete = Object.keys(require.cache).filter(k =>
  k.includes('implementation-gate') || k.includes('task-gate') ||
  k.includes('claude-code') || k.includes('base-adapter') ||
  k.includes('flow-utils')
);
keysToDelete.forEach(k => delete require.cache[k]);

// Patch getReadyData before loading implementation-gate
const utils = require('./flow-utils');
let mockInProgress = [];
utils.getReadyData = () => ({
  ready: [],
  inProgress: mockInProgress,
  blocked: [],
  recentlyCompleted: []
});

// Now load the modules
const { checkImplementationGate } = require('./hooks/core/implementation-gate');
const { claudeCodeAdapter } = require('./hooks/adapters/claude-code');

let allPass = true;

function assert(condition, name, details) {
  console.log(condition ? '  PASS' : '  FAIL', '-', name);
  if (!condition) {
    if (details) console.log('   ', details);
    allPass = false;
  }
}

// ===================================================================
// NO ACTIVE TASK → Context injection (NOT blocking)
// Prompts go through with additionalContext telling Claude to invoke /wogi-start
// ===================================================================
console.log('=== NO ACTIVE TASK (should inject routing context, NOT block) ===');

function testContextInjection(name, prompt) {
  mockInProgress = [];
  const result = checkImplementationGate({ prompt });
  const adapted = claudeCodeAdapter.transformResult('UserPromptSubmit', result);

  const notBlocked = adapted.decision !== 'block';
  const hasContext = adapted.hookSpecificOutput?.additionalContext?.includes('wogi-start');
  const noContinueFalse = adapted.continue !== false;

  assert(notBlocked, `${name}: NOT blocked`);
  assert(hasContext, `${name}: has routing context mentioning wogi-start`);
  assert(noContinueFalse, `${name}: does not kill session`);

  if (!notBlocked || !hasContext || !noContinueFalse) {
    console.log('    Adapted:', JSON.stringify(adapted).slice(0, 200));
  }
}

testContextInjection('Implementation request', 'add a logout button');
testContextInjection('Question', 'what does this function do?');
testContextInjection('Operational', 'push to github');
testContextInjection('Random text', 'hello world');

// ===================================================================
// NO ACTIVE TASK → /wogi-* commands always pass clean (no context injection)
// ===================================================================
console.log('');
console.log('=== NO ACTIVE TASK (/wogi-* commands pass clean) ===');

function testCleanAllow(name, prompt) {
  mockInProgress = [];
  const result = checkImplementationGate({ prompt });
  const adapted = claudeCodeAdapter.transformResult('UserPromptSubmit', result);

  const notBlocked = adapted.decision !== 'block';
  const isEmpty = Object.keys(adapted).length === 0;

  assert(notBlocked, `${name}: NOT blocked`);
  assert(isEmpty, `${name}: clean empty response (no context injection)`);
}

testCleanAllow('/wogi-start command', '/wogi-start add feature');
testCleanAllow('/wogi-review command', '/wogi-review');
testCleanAllow('/wogi-bug command', '/wogi-bug something broken');

// ===================================================================
// EMPTY/NULL PROMPTS → pass clean
// ===================================================================
console.log('');
console.log('=== EMPTY/NULL PROMPTS (pass clean) ===');

testCleanAllow('Empty prompt', '');
testCleanAllow('Null prompt', null);
testCleanAllow('Whitespace only', '   ');

// ===================================================================
// WITH ACTIVE TASK → everything passes clean
// ===================================================================
console.log('');
console.log('=== WITH ACTIVE TASK (everything passes clean) ===');

function testWithTask(name, prompt) {
  mockInProgress = [{ id: 'wf-test', title: 'Test task', status: 'in_progress' }];
  const result = checkImplementationGate({ prompt });
  const adapted = claudeCodeAdapter.transformResult('UserPromptSubmit', result);

  const notBlocked = adapted.decision !== 'block';
  const isEmpty = Object.keys(adapted).length === 0;

  assert(notBlocked, `${name}: NOT blocked`);
  assert(isEmpty, `${name}: clean empty response`);
}

testWithTask('Implementation request', 'add a logout button');
testWithTask('Question', 'what does this do?');
testWithTask('Operational', 'push to github');

// ===================================================================
// ADAPTER FORMAT VERIFICATION
// ===================================================================
console.log('');
console.log('=== ADAPTER FORMAT - No task (context injection) ===');

mockInProgress = [];
const noTaskResult = checkImplementationGate({ prompt: 'add a feature' });
const noTaskAdapted = claudeCodeAdapter.transformResult('UserPromptSubmit', noTaskResult);

assert(noTaskAdapted.decision !== 'block',
  'No task: does NOT have decision:"block"');
assert(noTaskAdapted.hookSpecificOutput?.hookEventName === 'UserPromptSubmit',
  'No task: has hookEventName "UserPromptSubmit"');
assert(typeof noTaskAdapted.hookSpecificOutput?.additionalContext === 'string',
  'No task: has additionalContext string');
assert(noTaskAdapted.hookSpecificOutput?.additionalContext?.includes('MANDATORY'),
  'No task: context includes MANDATORY instruction');
assert(noTaskAdapted.hookSpecificOutput?.additionalContext?.includes('wogi-start'),
  'No task: context mentions wogi-start');
assert(noTaskAdapted.continue !== false,
  'No task: does NOT have continue:false (would kill session)');

console.log('');
console.log('=== ADAPTER FORMAT - With task (clean allow) ===');

mockInProgress = [{ id: 'wf-test', title: 'Test', status: 'in_progress' }];
const withTaskResult = checkImplementationGate({ prompt: 'add a feature' });
const withTaskAdapted = claudeCodeAdapter.transformResult('UserPromptSubmit', withTaskResult);

assert(Object.keys(withTaskAdapted).length === 0,
  'With task: response is empty object {}');
assert(withTaskAdapted.decision !== 'block',
  'With task: no block decision');
assert(withTaskAdapted.continue !== false,
  'With task: no continue:false');

// ===================================================================
// CORE RESULT VERIFICATION
// ===================================================================
console.log('');
console.log('=== CORE RESULT SHAPE ===');

mockInProgress = [];
const coreNoTask = checkImplementationGate({ prompt: 'build a dashboard' });
assert(coreNoTask.allowed === true, 'Core no-task: allowed=true (not blocking)');
assert(coreNoTask.blocked === false, 'Core no-task: blocked=false');
assert(typeof coreNoTask.systemReminder === 'string', 'Core no-task: has systemReminder string');
assert(coreNoTask.reason === 'no_active_task_route', 'Core no-task: reason is no_active_task_route');

mockInProgress = [{ id: 'wf-test', title: 'Test', status: 'in_progress' }];
const coreWithTask = checkImplementationGate({ prompt: 'build a dashboard' });
assert(coreWithTask.allowed === true, 'Core with-task: allowed=true');
assert(coreWithTask.blocked === false, 'Core with-task: blocked=false');
assert(!coreWithTask.systemReminder, 'Core with-task: no systemReminder');
assert(coreWithTask.reason === 'task_active', 'Core with-task: reason is task_active');

console.log('');
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
