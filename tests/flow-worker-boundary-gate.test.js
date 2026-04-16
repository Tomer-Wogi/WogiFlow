'use strict';

/**
 * Tests for worker-boundary-gate (v2.20.1).
 *
 * Blocks AskUserQuestion in workspace worker mode to prevent silent stalls
 * where the worker prompts the user but the user only sees the manager
 * terminal. Forces workers to channel-dispatch "## QUESTION:" to the manager.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {}; console.warn = () => {}; console.error = () => {};

const { checkWorkerBoundary, isWorkspaceWorker } = require('../scripts/hooks/core/worker-boundary-gate');

const origEnv = {};
function snapshotEnv() {
  origEnv.ROOT = process.env.WOGI_WORKSPACE_ROOT;
  origEnv.REPO = process.env.WOGI_REPO_NAME;
  origEnv.PORT = process.env.WOGI_MANAGER_PORT;
}
function restoreEnv() {
  for (const [k, v] of [
    ['WOGI_WORKSPACE_ROOT', origEnv.ROOT],
    ['WOGI_REPO_NAME', origEnv.REPO],
    ['WOGI_MANAGER_PORT', origEnv.PORT]
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('isWorkspaceWorker', () => {
  beforeEach(snapshotEnv);
  afterEach(restoreEnv);

  it('returns false without WOGI_WORKSPACE_ROOT (single-repo mode)', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    process.env.WOGI_REPO_NAME = 'backend';
    assert.equal(isWorkspaceWorker(), false);
  });

  it('returns false for the manager', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    assert.equal(isWorkspaceWorker(), false);
  });

  it('returns true for a real worker', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    assert.equal(isWorkspaceWorker(), true);
  });
});

describe('checkWorkerBoundary — AskUserQuestion in worker mode', () => {
  beforeEach(snapshotEnv);
  afterEach(restoreEnv);

  const cfg = { workspace: { blockAskUserQuestionInWorker: true } };

  it('BLOCKS AskUserQuestion when running as a worker', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    const result = checkWorkerBoundary('AskUserQuestion', { question: 'x' }, cfg);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'worker-boundary-askuser');
    assert.ok(result.message.includes('WORKER BOUNDARY'));
    assert.ok(result.message.includes('## QUESTION:'));
    assert.ok(result.message.includes('curl'), 'block message should give the exact curl command');
    assert.ok(result.message.includes('8800') || result.message.includes(process.env.WOGI_MANAGER_PORT || '8800'),
      'block message should include the manager port');
  });

  it('block message includes the worker repo name as X-Wogi-From header', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'frontend';
    const result = checkWorkerBoundary('AskUserQuestion', {}, cfg);
    assert.ok(result.message.includes('X-Wogi-From: frontend'));
  });

  it('respects WOGI_MANAGER_PORT override in block message', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    process.env.WOGI_MANAGER_PORT = '9001';
    const result = checkWorkerBoundary('AskUserQuestion', {}, cfg);
    assert.ok(result.message.includes('9001'), 'should reference the configured manager port');
  });

  it('does NOT block in manager mode (manager SHOULD prompt the user)', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    const result = checkWorkerBoundary('AskUserQuestion', { question: 'x' }, cfg);
    assert.equal(result.blocked, false);
  });

  it('does NOT block in single-repo mode (no WOGI_WORKSPACE_ROOT)', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    process.env.WOGI_REPO_NAME = 'backend';
    const result = checkWorkerBoundary('AskUserQuestion', { question: 'x' }, cfg);
    assert.equal(result.blocked, false);
  });

  it('does NOT block other tools (Bash, Edit, Read, etc.)', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    for (const tool of ['Bash', 'Edit', 'Read', 'Write', 'Grep', 'Glob', 'WebSearch', 'Agent']) {
      const result = checkWorkerBoundary(tool, {}, cfg);
      assert.equal(result.blocked, false, `${tool} should not be blocked by worker-boundary-gate`);
    }
  });

  it('respects config.workspace.blockAskUserQuestionInWorker = false (opt-out)', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    const result = checkWorkerBoundary('AskUserQuestion', {}, {
      workspace: { blockAskUserQuestionInWorker: false }
    });
    assert.equal(result.blocked, false);
  });

  it('defaults to blocking when config is missing entirely', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'backend';
    const result = checkWorkerBoundary('AskUserQuestion', {}, undefined);
    assert.equal(result.blocked, true, 'default should be BLOCK (safe default)');
  });
});
