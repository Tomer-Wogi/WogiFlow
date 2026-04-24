'use strict';

/**
 * Tests for worker-tool-first-gate.js (G1 + G4 + G6 — epic wf-34290000).
 *
 * Unit tests exercise the pure-function detection logic via extractCurrentTurn
 * and checkWorkerToolFirstTurn. Uses fixture JSONL transcripts written to tmp.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Silence module-level logs from transitive requires.
console.log = () => {}; console.warn = () => {}; console.error = () => {};

const {
  checkWorkerToolFirstTurn,
  extractCurrentTurn,
  renderBlockMessage,
  isWorkerMode,
  readTranscript
} = require('../scripts/hooks/core/worker-tool-first-gate');

let tmpDir;
function withTranscript(events) {
  if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-tfg-'));
  const file = path.join(tmpDir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  fs.writeFileSync(file, events.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n'));
  return file;
}

function userMsg(text) {
  return { type: 'user', message: { role: 'user', content: text } };
}
function assistantText(text) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } };
}
function assistantToolUse(name) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, id: 'tu_' + name, input: {} }] } };
}
function assistantMixed(blocks) {
  return { type: 'assistant', message: { role: 'assistant', content: blocks } };
}

describe('extractCurrentTurn', () => {
  it('returns null when transcript has no user message', () => {
    assert.equal(extractCurrentTurn([]), null);
    assert.equal(extractCurrentTurn([assistantText('hi')]), null);
  });

  it('counts tool_use blocks after the last user message', () => {
    const events = [
      userMsg('dispatch 1'),
      assistantToolUse('Bash'),
      userMsg('dispatch 2'),
      assistantToolUse('Edit'),
      assistantToolUse('Read')
    ];
    const turn = extractCurrentTurn(events);
    assert.equal(turn.toolUseCount, 2);
    assert.equal(turn.firstBlockType, 'tool_use');
  });

  it('records first block as text when turn starts with text', () => {
    const events = [
      userMsg('hi'),
      assistantText('let me think...'),
      assistantToolUse('Bash')
    ];
    const turn = extractCurrentTurn(events);
    assert.equal(turn.toolUseCount, 1);
    assert.equal(turn.firstBlockType, 'text');
  });

  it('handles mixed content blocks in a single assistant event', () => {
    const events = [
      userMsg('dispatch'),
      assistantMixed([
        { type: 'tool_use', name: 'Edit', id: 'tu_e', input: {} },
        { type: 'text', text: 'narration' },
        { type: 'tool_use', name: 'Bash', id: 'tu_b', input: {} }
      ])
    ];
    const turn = extractCurrentTurn(events);
    assert.equal(turn.toolUseCount, 2);
    assert.equal(turn.firstBlockType, 'tool_use');
  });

  it('zero tool_use for pure-text response', () => {
    const events = [userMsg('dispatch'), assistantText('I am done thinking about this.')];
    const turn = extractCurrentTurn(events);
    assert.equal(turn.toolUseCount, 0);
    assert.equal(turn.firstBlockType, 'text');
  });
});

describe('checkWorkerToolFirstTurn — G1 silent-halt', () => {
  it('blocks on zero tool_use (pure-text turn)', () => {
    const p = withTranscript([userMsg('do X'), assistantText('I did X already.')]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p });
    assert.equal(r.blocked, true);
    assert.equal(r.violation, 'silent-halt');
    assert.equal(r.ruleId, 'worker-tool-first-turn');
  });

  it('blocks on zero tool_use even in non-strict mode', () => {
    const p = withTranscript([userMsg('do X'), assistantText('pure text')]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: false });
    assert.equal(r.blocked, true);
    assert.equal(r.violation, 'silent-halt');
  });
});

describe('checkWorkerToolFirstTurn — G4 text-before-tool-call', () => {
  it('blocks in strict mode when first block is text', () => {
    const p = withTranscript([
      userMsg('do X'),
      assistantText('let me start...'),
      assistantToolUse('Edit')
    ]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: true });
    assert.equal(r.blocked, true);
    assert.equal(r.violation, 'text-before-tool-call');
  });

  it('allows text-first in non-strict mode as long as a tool call fires', () => {
    const p = withTranscript([
      userMsg('do X'),
      assistantText('let me start...'),
      assistantToolUse('Edit')
    ]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: false });
    assert.equal(r.blocked, false);
  });
});

describe('checkWorkerToolFirstTurn — pass cases', () => {
  it('passes when first block is tool_use (strict)', () => {
    const p = withTranscript([userMsg('do X'), assistantToolUse('Edit')]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: true });
    assert.equal(r.blocked, false);
  });

  it('passes on tool_use → text → tool_use (narrate-after-action)', () => {
    const p = withTranscript([
      userMsg('do X'),
      assistantToolUse('Edit'),
      assistantText('just did the edit'),
      assistantToolUse('Bash')
    ]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: true });
    assert.equal(r.blocked, false);
  });
});

describe('checkWorkerToolFirstTurn — fail-open behavior', () => {
  it('returns no-block for missing transcriptPath', () => {
    const r = checkWorkerToolFirstTurn({});
    assert.equal(r.blocked, false);
    assert.equal(r.reason, 'no-transcript-path');
  });

  it('returns no-block for non-existent transcript file', () => {
    const r = checkWorkerToolFirstTurn({ transcriptPath: '/tmp/does-not-exist-' + Date.now() + '.jsonl' });
    assert.equal(r.blocked, false);
    assert.equal(r.reason, 'transcript-unreadable');
  });

  it('returns no-block when transcript has no user message yet', () => {
    const p = withTranscript([assistantText('bootstrap line')]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p });
    assert.equal(r.blocked, false);
    assert.equal(r.reason, 'no-current-turn');
  });

  it('skips unparseable lines and continues', () => {
    const p = withTranscript([
      'this is not JSON',
      userMsg('do X'),
      '{"incomplete',
      assistantToolUse('Edit')
    ]);
    const r = checkWorkerToolFirstTurn({ transcriptPath: p, strict: true });
    assert.equal(r.blocked, false);
  });
});

describe('renderBlockMessage', () => {
  it('includes rule name and violation in message', () => {
    const msg = renderBlockMessage({ violation: 'silent-halt', reason: 'zero tool calls' });
    assert.ok(msg.includes('worker-tool-first-turn'));
    assert.ok(msg.includes('silent-halt'));
    assert.ok(msg.includes('zero tool calls'));
  });

  it('includes escalation curl command with repo + port', () => {
    const prev = { port: process.env.WOGI_MANAGER_PORT, repo: process.env.WOGI_REPO_NAME };
    process.env.WOGI_MANAGER_PORT = '9999';
    process.env.WOGI_REPO_NAME = 'test-worker';
    try {
      const msg = renderBlockMessage({ violation: 'silent-halt', reason: 'zero tool calls' });
      assert.ok(msg.includes('9999'));
      assert.ok(msg.includes('test-worker'));
      assert.ok(msg.includes('## QUESTION:'));
    } finally {
      if (prev.port === undefined) delete process.env.WOGI_MANAGER_PORT;
      else process.env.WOGI_MANAGER_PORT = prev.port;
      if (prev.repo === undefined) delete process.env.WOGI_REPO_NAME;
      else process.env.WOGI_REPO_NAME = prev.repo;
    }
  });

  it('uses text-before-tool-call heading when violation is text-first', () => {
    const msg = renderBlockMessage({ violation: 'text-before-tool-call', reason: 'first block was text' });
    assert.ok(msg.includes('text-before-tool-call'));
  });
});

describe('isWorkerMode', () => {
  it('returns false without WOGI_WORKSPACE_ROOT', () => {
    const prev = {
      root: process.env.WOGI_WORKSPACE_ROOT,
      name: process.env.WOGI_REPO_NAME
    };
    delete process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_REPO_NAME;
    try {
      assert.equal(isWorkerMode(), false);
    } finally {
      if (prev.root) process.env.WOGI_WORKSPACE_ROOT = prev.root;
      if (prev.name) process.env.WOGI_REPO_NAME = prev.name;
    }
  });

  it('returns true with workspace env + worker name', () => {
    const prev = {
      root: process.env.WOGI_WORKSPACE_ROOT,
      name: process.env.WOGI_REPO_NAME
    };
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'test-repo';
    try {
      assert.equal(isWorkerMode(), true);
    } finally {
      if (prev.root === undefined) delete process.env.WOGI_WORKSPACE_ROOT;
      else process.env.WOGI_WORKSPACE_ROOT = prev.root;
      if (prev.name === undefined) delete process.env.WOGI_REPO_NAME;
      else process.env.WOGI_REPO_NAME = prev.name;
    }
  });

  it('returns false when WOGI_REPO_NAME is "manager"', () => {
    const prev = {
      root: process.env.WOGI_WORKSPACE_ROOT,
      name: process.env.WOGI_REPO_NAME
    };
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    try {
      assert.equal(isWorkerMode(), false);
    } finally {
      if (prev.root === undefined) delete process.env.WOGI_WORKSPACE_ROOT;
      else process.env.WOGI_WORKSPACE_ROOT = prev.root;
      if (prev.name === undefined) delete process.env.WOGI_REPO_NAME;
      else process.env.WOGI_REPO_NAME = prev.name;
    }
  });
});

describe('readTranscript — robustness', () => {
  it('returns empty array for empty file', () => {
    const p = withTranscript([]);
    // withTranscript joins with \n, so empty array produces ''
    fs.writeFileSync(p, '');
    assert.deepEqual(readTranscript(p), []);
  });

  it('returns null for missing file', () => {
    assert.equal(readTranscript('/tmp/no-such-file-' + Date.now()), null);
  });
});
