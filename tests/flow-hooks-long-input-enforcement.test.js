'use strict';

/**
 * Tests for long-input-enforcement core (P11.5 mechanical layer).
 *
 * Pin the wogi-hub 2026-04-27 regression: a long task-creating prompt
 * arriving via channel-dispatch in worker mode without a source-link
 * MUST trigger STRICT-level forcing of /wogi-extract-review.
 *
 * Run: node --test tests/flow-hooks-long-input-enforcement.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const lie = require('../scripts/hooks/core/long-input-enforcement');

beforeEach(() => { lie.clearLongInputPending(); });
afterEach(() => { lie.clearLongInputPending(); });

describe('detectLongFormPrompt', () => {
  it('detects >40 lines', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    assert.equal(lie.detectLongFormPrompt(text), true);
  });

  it('detects ≥5 discrete bullet items', () => {
    const text = '- one\n- two\n- three\n- four\n- five';
    assert.equal(lie.detectLongFormPrompt(text), true);
  });

  it('detects ≥5 numbered items', () => {
    const text = '1. one\n2. two\n3. three\n4. four\n5. five';
    assert.equal(lie.detectLongFormPrompt(text), true);
  });

  it('passes short prose', () => {
    assert.equal(lie.detectLongFormPrompt('Fix the typo on the login page'), false);
  });

  it('passes 3-item lists', () => {
    assert.equal(lie.detectLongFormPrompt('- a\n- b\n- c'), false);
  });

  it('handles non-string input', () => {
    assert.equal(lie.detectLongFormPrompt(null), false);
    assert.equal(lie.detectLongFormPrompt(undefined), false);
    assert.equal(lie.detectLongFormPrompt(42), false);
  });
});

describe('hasSourceLink', () => {
  it('detects ## Original Request (verbatim) header', () => {
    assert.equal(lie.hasSourceLink('## Original Request (verbatim)\n\nfoo'), true);
  });

  it('detects spec-file path reference', () => {
    assert.equal(lie.hasSourceLink('Implementing per .workflow/changes/wf-12345abc.md'), true);
  });

  it('detects bare wf-ID', () => {
    assert.equal(lie.hasSourceLink('Continue work on wf-89aaab85'), true);
  });

  it('detects spec: <path> marker', () => {
    assert.equal(lie.hasSourceLink('spec: /path/to/wf-123.md\nbody'), true);
  });

  it('returns false for plain prose', () => {
    assert.equal(lie.hasSourceLink('Add a button to the login page'), false);
  });
});

describe('hasTaskSignals', () => {
  it('detects ≥2 imperatives', () => {
    assert.equal(lie.hasTaskSignals('We need to add X and refactor Y'), true);
  });

  it('rejects 1 imperative (data-dump heuristic)', () => {
    assert.equal(lie.hasTaskSignals('I noticed an error in the log'), false);
  });

  it('rejects pure log content', () => {
    const log = '[2026-04-27] INFO: starting\n[2026-04-27] ERROR: connection timed out';
    assert.equal(lie.hasTaskSignals(log), false);
  });
});

describe('shouldForceExtractReview — happy paths', () => {
  it('passes a short prompt', () => {
    const r = lie.shouldForceExtractReview({ text: 'Fix the typo' });
    assert.equal(r.forced, false);
    assert.equal(r.level, 'pass');
  });

  it('passes a long prompt with source-link', () => {
    const text = `## Original Request (verbatim)\n\n` +
      Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const r = lie.shouldForceExtractReview({ text });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'source-link-present');
  });

  it('does not force long-but-no-task-signals (log dump)', () => {
    const log = Array.from({ length: 50 }, (_, i) => `[2026-04-27 ${i}] some log line`).join('\n');
    const r = lie.shouldForceExtractReview({ text: log });
    assert.equal(r.forced, false);
    assert.equal(r.level, 'suggest');
  });
});

describe('shouldForceExtractReview — wogi-hub regression case', () => {
  // regression-tier3
  // The exact failure shape: long task-creating prompt arrives via
  // channel-dispatch in worker mode without source-link.
  it('STRICT level when channel-dispatched in worker mode without source-link', () => {
    const wogiHubPrompt = `Customers > Services (call it services and not integrations)
Connect To Jira
Add Service Block

When Adding a Service Block

Dropdown to select Department / Service / Team / Employee
- Customer Rate
- Customer department rate
- Department rate
- Service rate
- Employee rate

After we map this we need to add routing rules and implement the cascade.
We need to refactor the existing structure to consolidate.`;
    const r = lie.shouldForceExtractReview({
      text: wogiHubPrompt,
      source: 'channel-dispatch',
      env: { WOGI_WORKSPACE_ROOT: '/tmp/ws', WOGI_REPO_NAME: 'frontend' }
    });
    assert.equal(r.forced, true);
    assert.equal(r.level, 'strict');
    assert.equal(r.reason, 'channel-dispatch-without-source-link');
  });

  it('FORCE level when same prompt arrives in solo manager session', () => {
    const wogiHubPrompt = `Customers > Services (call it services and not integrations)
- Customer Rate
- Customer department rate
- Department rate
- Service rate
- Employee rate

We need to add routing and implement the cascade. Refactor the existing structure.`;
    const r = lie.shouldForceExtractReview({
      text: wogiHubPrompt,
      source: 'user',
      env: {}
    });
    assert.equal(r.forced, true);
    assert.equal(r.level, 'force');
    assert.equal(r.reason, 'long-form-task-without-source-link');
  });

  it('PASSES same prompt when source-link is added (manager did the right thing)', () => {
    const wellFormed = `Per .workflow/changes/wf-89aaab85.md, implement these:

## Original Request (verbatim)

- Customer Rate
- Customer department rate
- Department rate
- Service rate
- Employee rate

We need to add routing and refactor.`;
    const r = lie.shouldForceExtractReview({
      text: wellFormed,
      source: 'channel-dispatch',
      env: { WOGI_WORKSPACE_ROOT: '/tmp/ws', WOGI_REPO_NAME: 'frontend' }
    });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'source-link-present');
  });
});

describe('buildEnforcementMessage', () => {
  it('strict message includes wogi-hub citation', () => {
    const msg = lie.buildEnforcementMessage('channel-dispatch-without-source-link', 'strict');
    assert.match(msg, /STRICT P11.5/);
    assert.match(msg, /wogi-hub/);
    assert.match(msg, /wogi-extract-review/);
  });

  it('force message has the same actions but different framing', () => {
    const msg = lie.buildEnforcementMessage('long-form-task-without-source-link', 'force');
    assert.match(msg, /P11.5 ENFORCEMENT/);
    assert.match(msg, /wogi-extract-review/);
    assert.match(msg, /Override/);
    assert.match(msg, /dismiss/);
  });
});

describe('marker file lifecycle', () => {
  it('mark, isPending, read, clear', () => {
    assert.equal(lie.isLongInputPending(), false);
    lie.markLongInputPending({ level: 'strict', reason: 'test' });
    assert.equal(lie.isLongInputPending(), true);
    const payload = lie.readLongInputPending();
    assert.equal(payload.level, 'strict');
    assert.equal(payload.reason, 'test');
    assert.ok(payload.markedAt);
    lie.clearLongInputPending();
    assert.equal(lie.isLongInputPending(), false);
  });

  it('clear is idempotent', () => {
    lie.clearLongInputPending();
    lie.clearLongInputPending();
    assert.equal(lie.isLongInputPending(), false);
  });
});

describe('isChannelDispatchInWorker', () => {
  it('detects worker + channel source', () => {
    assert.equal(
      lie.isChannelDispatchInWorker('channel-dispatch', { WOGI_WORKSPACE_ROOT: '/tmp', WOGI_REPO_NAME: 'frontend' }),
      true
    );
  });

  it('rejects manager mode', () => {
    assert.equal(
      lie.isChannelDispatchInWorker('channel-dispatch', { WOGI_WORKSPACE_ROOT: '/tmp', WOGI_REPO_NAME: 'manager' }),
      false
    );
  });

  it('rejects non-channel sources', () => {
    assert.equal(
      lie.isChannelDispatchInWorker('user', { WOGI_WORKSPACE_ROOT: '/tmp', WOGI_REPO_NAME: 'frontend' }),
      false
    );
  });

  it('rejects when not in workspace mode', () => {
    assert.equal(lie.isChannelDispatchInWorker('channel-dispatch', {}), false);
  });
});

describe('checkLongInputPendingGate', () => {
  it('passes through everything when no marker is set', () => {
    lie.clearLongInputPending();
    assert.equal(lie.checkLongInputPendingGate('Edit', { file_path: 'foo.ts' }).blocked, false);
    assert.equal(lie.checkLongInputPendingGate('Write', { file_path: 'foo.ts' }).blocked, false);
    assert.equal(lie.checkLongInputPendingGate('Bash', { command: 'git status' }).blocked, false);
  });

  it('allows Read/Glob/Grep when marker is set', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(lie.checkLongInputPendingGate('Read', { file_path: 'foo.ts' }).blocked, false);
    assert.equal(lie.checkLongInputPendingGate('Glob', { pattern: '*.ts' }).blocked, false);
    assert.equal(lie.checkLongInputPendingGate('Grep', { pattern: 'foo' }).blocked, false);
  });

  it('allows Skill→wogi-extract-review when marker is set', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Skill', { skill: 'wogi-extract-review' }).blocked,
      false
    );
  });

  it('allows Skill→wogi-start with --bypass-long-input arg', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Skill', { skill: 'wogi-start', args: 'foo --bypass-long-input' }).blocked,
      false
    );
  });

  it('allows Skill→wogi-start that names wogi-extract-review in args', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Skill', { skill: 'wogi-start', args: 'wogi-extract-review' }).blocked,
      false
    );
  });

  it('blocks generic Skill→wogi-start when marker is set', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const result = lie.checkLongInputPendingGate('Skill', { skill: 'wogi-start', args: 'wf-12345678' });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'long-input-pending');
    assert.match(result.message, /BLOCKED: long-input-pending/);
  });

  it('allows Bash→flow long-input-pending dismiss', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Bash', { command: 'flow long-input-pending dismiss --reason="log dump"' }).blocked,
      false
    );
  });

  it('allows Bash→flow extract-zero-loss', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Bash', { command: 'flow extract-zero-loss <(cat prompt.txt)' }).blocked,
      false
    );
  });

  it('allows Bash→flow-source-fidelity verifier', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(
      lie.checkLongInputPendingGate('Bash', { command: 'node scripts/flow-source-fidelity.js check spec.md' }).blocked,
      false
    );
  });

  it('blocks Bash→generic command', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const result = lie.checkLongInputPendingGate('Bash', { command: 'git commit -m "foo"' });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'long-input-pending');
  });

  it('blocks Edit and Write when marker is set', () => {
    lie.markLongInputPending({ level: 'strict', reason: 'channel-dispatch-without-source-link' });
    const editResult = lie.checkLongInputPendingGate('Edit', { file_path: 'foo.ts' });
    assert.equal(editResult.blocked, true);
    assert.match(editResult.message, /channel-dispatch-without-source-link/);
    const writeResult = lie.checkLongInputPendingGate('Write', { file_path: 'foo.ts', content: 'x' });
    assert.equal(writeResult.blocked, true);
    assert.match(writeResult.message, /strict/);
  });

  it('handles missing toolInput safely', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    assert.equal(lie.checkLongInputPendingGate('Edit', undefined).blocked, true);
    assert.equal(lie.checkLongInputPendingGate('Bash', undefined).blocked, true);
    assert.equal(lie.checkLongInputPendingGate('Skill', undefined).blocked, true);
  });
});
