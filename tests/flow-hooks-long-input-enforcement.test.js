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

describe('wf-f7d58760 — system-originated content does not trip the gate', () => {
  it('isSystemOriginatedContent flags task-notification, system-reminder, command-* prefixes', () => {
    assert.equal(lie.isSystemOriginatedContent('<task-notification>blah'), true);
    assert.equal(lie.isSystemOriginatedContent('  <task-notification>blah'), true);
    assert.equal(lie.isSystemOriginatedContent('<system-reminder>some reminder'), true);
    assert.equal(lie.isSystemOriginatedContent('<command-message>foo'), true);
    assert.equal(lie.isSystemOriginatedContent('<local-command-stdout>output'), true);
    assert.equal(lie.isSystemOriginatedContent('<bash-input>ls -la'), true);

    // Negative: tag-like text mid-string is NOT a system prefix.
    assert.equal(lie.isSystemOriginatedContent('Hello <task-notification>'), false);
    assert.equal(lie.isSystemOriginatedContent('Add a button'), false);
    assert.equal(lie.isSystemOriginatedContent(''), false);
    assert.equal(lie.isSystemOriginatedContent(null), false);
  });

  it('shouldForceExtractReview returns pass on long sub-agent task-notification', () => {
    // Simulates the exact bug: a background sub-agent completes and emits a
    // task-notification block long enough + imperative-laden enough to clear
    // every other gate check. Pre-fix, this tripped the gate and force-blocked
    // the parent session.
    const taskNotification = [
      '<task-notification>',
      'Sub-agent wf-XXXXXXXX completed successfully.',
      '',
      '## Summary',
      'Implemented the feature. Files changed:',
      '  - scripts/foo.js: add helper',
      '  - scripts/bar.js: refactor consumer',
      '  - scripts/baz.js: remove dead code',
      '  - scripts/qux.js: update tests',
      '  - scripts/quux.js: fix lint',
      '',
      Array.from({ length: 40 }, (_, i) => `Detail line ${i}: more output that pads the message past the 40-line threshold`).join('\n'),
      '</task-notification>'
    ].join('\n');

    const r = lie.shouldForceExtractReview({ text: taskNotification });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'system-originated-content');
  });

  it('still forces on a real long-form user prompt without source-link', () => {
    // Sanity: the new gate doesn't break the actual P11.5 enforcement.
    const realUserPrompt = Array.from({ length: 50 }, (_, i) =>
      `${i + 1}. Implement feature ${i} — add the X component and integrate with Y`
    ).join('\n');
    const r = lie.shouldForceExtractReview({ text: realUserPrompt });
    assert.equal(r.forced, true);
    assert.equal(r.reason, 'long-form-task-without-source-link');
  });
});

describe('shouldForceExtractReview — channel-source skip (wf-e5e57361 / RC3)', () => {
  // regression-tier3
  // RC3: channel traffic is inter-agent transport, NOT user input. Firing the
  // gate on it wrote a long-input-pending marker that deadlocked against the
  // routing gate. Channel-source messages now PASS; source fidelity for
  // dispatches is enforced at the manager AUTHORING layer instead.
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

  it('PASSES (channel-source) a long channel-dispatch in worker mode — no deadlock', () => {
    const r = lie.shouldForceExtractReview({
      text: wogiHubPrompt,
      source: 'channel-dispatch',
      env: { WOGI_WORKSPACE_ROOT: '/tmp/ws', WOGI_REPO_NAME: 'frontend' }
    });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'channel-source');
  });

  it('PASSES (channel-source) a long worker→manager `## Results` status reply on the manager', () => {
    const statusReply = `## Results

1. Fixed the continuation gate stall
2. Added canonical state resolution
3. Updated the worker rules template
4. Skipped the long-input gate for channel traffic
5. Added regression tests for all four ACs
6. Ran the full suite — green`;
    const r = lie.shouldForceExtractReview({
      text: statusReply,
      source: 'channel',
      env: { WOGI_WORKSPACE_ROOT: '/tmp/ws', WOGI_REPO_NAME: 'manager' }
    });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'channel-source');
  });

  it('PASSES (channel-source) a <channel>-tagged message even without a source field', () => {
    const tagged = `<channel from="manager">\n${wogiHubPrompt}\n</channel>`;
    const r = lie.shouldForceExtractReview({ text: tagged });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'channel-source');
  });

  it('STILL FORCES the same prompt as direct USER input (protection preserved off the transport layer)', () => {
    const r = lie.shouldForceExtractReview({
      text: wogiHubPrompt,
      source: 'user',
      env: {}
    });
    assert.equal(r.forced, true);
    assert.equal(r.level, 'force');
    assert.equal(r.reason, 'long-form-task-without-source-link');
  });
});

describe('buildEnforcementMessage', () => {
  it('force message has the expected actions and framing', () => {
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

describe('isChannelSourceMessage', () => {
  it('detects a channel/notifications source field', () => {
    assert.equal(lie.isChannelSourceMessage('anything', 'channel-dispatch'), true);
    assert.equal(lie.isChannelSourceMessage('anything', 'notifications/claude/channel'), true);
  });

  it('detects a leading <channel> tag without a source field', () => {
    assert.equal(lie.isChannelSourceMessage('<channel from="manager">hi</channel>', undefined), true);
  });

  it('rejects ordinary user input', () => {
    assert.equal(lie.isChannelSourceMessage('Fix the login bug', 'user'), false);
    assert.equal(lie.isChannelSourceMessage('Fix the login bug'), false);
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

// ============================================================
// 2026-05-13 deadlock fix — false-positive reduction
// ============================================================

describe('stripQuotedContent — strips pasted/quoted content', () => {
  it('strips fenced code blocks', () => {
    const text = [
      'real instruction line one',
      'real instruction line two',
      '```',
      'pasted code',
      'more pasted code',
      'even more pasted code',
      '```',
      'real instruction line three',
    ].join('\n');
    const stripped = lie.stripQuotedContent(text);
    assert.ok(stripped.includes('real instruction line one'));
    assert.ok(stripped.includes('real instruction line three'));
    assert.ok(!stripped.includes('pasted code'));
    assert.ok(!stripped.includes('more pasted code'));
  });

  it('strips Claude Code transcript bullet lines and continuations', () => {
    const text = [
      'my actual instruction',
      '⏺ Some Claude bullet',
      '  ⎿ tool result',
      '  ⎿ continued',
      'another actual instruction',
    ].join('\n');
    const stripped = lie.stripQuotedContent(text);
    assert.ok(stripped.includes('my actual instruction'));
    assert.ok(stripped.includes('another actual instruction'));
    assert.ok(!stripped.includes('Some Claude bullet'));
    assert.ok(!stripped.includes('tool result'));
  });

  it('strips markdown blockquotes', () => {
    const text = 'instruction\n> quoted line\n> another quote\nmore instruction';
    const stripped = lie.stripQuotedContent(text);
    assert.ok(stripped.includes('instruction'));
    assert.ok(stripped.includes('more instruction'));
    assert.ok(!stripped.includes('quoted line'));
  });

  it('preserves indented markdown list items', () => {
    const text = [
      'do these things:',
      '  - first',
      '  - second',
      '  - third',
    ].join('\n');
    const stripped = lie.stripQuotedContent(text);
    assert.ok(stripped.includes('- first'));
    assert.ok(stripped.includes('- second'));
    assert.ok(stripped.includes('- third'));
  });

  it('handles non-string input gracefully', () => {
    assert.equal(lie.stripQuotedContent(null), '');
    assert.equal(lie.stripQuotedContent(undefined), '');
    assert.equal(lie.stripQuotedContent(42), '');
  });
});

describe('detectLongFormPrompt — pasted-content false positives', () => {
  it('does NOT fire on short instruction + long pasted code block', () => {
    const pasted = Array.from({ length: 50 }, (_, i) => `pasted line ${i}`).join('\n');
    const text = `please address the long input problem\n\n\`\`\`\n${pasted}\n\`\`\``;
    assert.equal(lie.detectLongFormPrompt(text), false);
  });

  it('does NOT fire on instruction + pasted Claude transcript', () => {
    const transcript = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? `⏺ Claude bullet ${i}` : `  ⎿ tool result ${i}`
    ).join('\n');
    const text = `look at this transcript and fix the gate:\n${transcript}`;
    assert.equal(lie.detectLongFormPrompt(text), false);
  });

  it('still fires on a genuine long user-typed work prompt', () => {
    const realPrompt = Array.from({ length: 50 }, (_, i) =>
      `${i + 1}. do real work item ${i + 1}`
    ).join('\n');
    assert.equal(lie.detectLongFormPrompt(realPrompt), true);
  });
});

describe('isSkillBodyEcho — AI skill-args false positives', () => {
  it('detects a typical wogi-start skill body echo', () => {
    const text = `
Start working on a task. Provide the task ID as argument.

**UNIVERSAL ENTRY POINT**: Route everything through /wogi-start

## Request Triage (AI-Driven Routing v5.0)

When invoked with a quoted request instead of a task ID, assess intent.

### Command Catalog
| Command | When to use |
|---|---|
| /wogi-story | For story work |
| /wogi-bug | For bug work |

### Pre-Routing Checks (Automatic)
Routing order: Task ID → Long input gate → Command Catalog → Plugin Registry

## Mandatory Rules
- TodoWrite: Track progress.
- Self-verification: Don't mark done without checking.

ARGUMENTS: {args}

ARGUMENTS: Fix things and add things
${' '.repeat(500)}
`;
    assert.equal(lie.isSkillBodyEcho(text), true);
  });

  it('does NOT match plain user prose', () => {
    const text = 'I want to add a feature. Please implement it. ' +
      'It should work like this. Here are the requirements. End of message. ' +
      'Even if I write a few more sentences. Still just user prose. ' +
      'No skill body markers should match this. Done.';
    assert.equal(lie.isSkillBodyEcho(text), false);
  });

  it('requires at least 2 markers (not a single coincidental match)', () => {
    const text = 'I have an idea: lets add a Command Catalog feature. ' +
      'None of the other skill markers appear in this prompt. ' +
      'So it should not match. ' + ' '.repeat(500);
    assert.equal(lie.isSkillBodyEcho(text), false);
  });

  it('requires minimum length (rejects accidental short matches)', () => {
    const text = '**UNIVERSAL ENTRY POINT** ## Mandatory Rules';
    assert.equal(lie.isSkillBodyEcho(text), false);
  });
});

describe('shouldForceExtractReview — skill-body-echo bypass', () => {
  it('does NOT force extract-review on a skill-body echo', () => {
    const text = `
**UNIVERSAL ENTRY POINT**: Route everything through /wogi-start

## Request Triage (AI-Driven Routing v5.0)
Some triage content here.

### Command Catalog
A catalog goes here.

### Pre-Routing Checks (Automatic)
Routing order: Task ID → Long input gate → Command Catalog

## Mandatory Rules
Rules go here.

ARGUMENTS: {args}

ARGUMENTS: fix things and add things and create things and remove things
${' '.repeat(600)}
`;
    const r = lie.shouldForceExtractReview({ text });
    assert.equal(r.forced, false);
    assert.equal(r.reason, 'skill-body-echo');
  });

  it('still forces on a genuine long-form work prompt', () => {
    const text = 'Please fix all of this and add the following:\n' +
      Array.from({ length: 60 }, (_, i) => `${i + 1}. add a new feature ${i + 1}`).join('\n');
    const r = lie.shouldForceExtractReview({ text });
    assert.equal(r.forced, true);
  });
});

describe('checkLongInputPendingGate — emergency rm escape hatch', () => {
  it('allows `rm .workflow/state/long-input-pending.json` (bare form)', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const r = lie.checkLongInputPendingGate('Bash', {
      command: 'rm .workflow/state/long-input-pending.json'
    });
    assert.equal(r.blocked, false, 'manual rm of the marker must be allowed');
  });

  it('allows `rm -f .workflow/state/long-input-pending.json`', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const r = lie.checkLongInputPendingGate('Bash', {
      command: 'rm -f .workflow/state/long-input-pending.json'
    });
    assert.equal(r.blocked, false, 'rm -f variant must be allowed');
  });

  it('allows `fs.unlinkSync` node-script equivalent', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const r = lie.checkLongInputPendingGate('Bash', {
      command: 'node -e "require(\'fs\').unlinkSync(\'.workflow/state/long-input-pending.json\')"'
    });
    assert.equal(r.blocked, false, 'fs.unlinkSync escape must be allowed');
  });

  it('does NOT allow `rm` of OTHER paths', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const r = lie.checkLongInputPendingGate('Bash', {
      command: 'rm -rf .workflow/state/'
    });
    assert.equal(r.blocked, true, 'rm of other paths must still be blocked');
  });

  it('does NOT allow compound `rm` with appended destructive commands', () => {
    lie.markLongInputPending({ level: 'force', reason: 'test' });
    const r = lie.checkLongInputPendingGate('Bash', {
      command: 'rm .workflow/state/long-input-pending.json && rm -rf /'
    });
    assert.equal(r.blocked, true, 'compound rm command must be blocked');
  });
});

describe('hasTaskSignals — pasted-imperative false positives', () => {
  it('does NOT count imperatives inside pasted fenced code blocks', () => {
    const text = `please look at this:
\`\`\`
fix the bug
add a feature
remove the dead code
refactor the helper
implement the thing
\`\`\`
that's all.`;
    assert.equal(lie.hasTaskSignals(text), false,
      'imperatives inside fenced code should not count as task signals');
  });

  it('still counts imperatives in the user\'s own prose', () => {
    const text = 'please fix the bug and add a new feature, then remove the dead code.';
    assert.equal(lie.hasTaskSignals(text), true);
  });
});
