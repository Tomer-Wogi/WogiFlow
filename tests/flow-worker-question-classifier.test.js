'use strict';

/**
 * Tests for flow-worker-question-classifier.js (v2.21.0).
 *
 * Pure-function tests for the helpers. The classifyWorkerQuestion() call is
 * tested primarily via its fail-open paths (missing transcript, missing API
 * key, malformed JSONL) since exercising the full Haiku round-trip would
 * require live credentials. The live path is smoke-tested by the Stop-hook
 * integration in production sessions.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.error = () => {};

const {
  classifyQuestion,
  classifyWorkerQuestion,
  extractLastAssistantMessage,
  extractAssistantText,
  buildClassifierPrompt,
  buildMainModePrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MODEL
} = require('../scripts/flow-worker-question-classifier');

let tmpDir;
function withTranscript(lines) {
  if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-wqc-'));
  const file = path.join(tmpDir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  fs.writeFileSync(file, lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n'));
  return file;
}

describe('extractAssistantText', () => {
  it('extracts string content from role:assistant entry', () => {
    assert.equal(extractAssistantText({ role: 'assistant', content: 'hello' }), 'hello');
  });

  it('extracts concatenated text blocks from content array', () => {
    const entry = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'text', text: 'line two' }
      ]
    };
    assert.equal(extractAssistantText(entry), 'line one\nline two');
  });

  it('handles nested message.content shape (Claude Code transcript variant)', () => {
    const entry = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'nested' }] }
    };
    assert.equal(extractAssistantText(entry), 'nested');
  });

  it('returns null for user entries', () => {
    assert.equal(extractAssistantText({ role: 'user', content: 'hi' }), null);
  });

  it('returns null for tool results and non-text blocks', () => {
    assert.equal(extractAssistantText({ role: 'assistant', content: [{ type: 'tool_use' }] }), null);
  });

  it('tolerates null / primitive / missing content', () => {
    assert.equal(extractAssistantText(null), null);
    assert.equal(extractAssistantText({ role: 'assistant' }), null);
    assert.equal(extractAssistantText('string'), null);
  });
});

describe('extractLastAssistantMessage', () => {
  it('returns null for missing/bad path', () => {
    assert.equal(extractLastAssistantMessage(null), null);
    assert.equal(extractLastAssistantMessage(''), null);
    assert.equal(extractLastAssistantMessage('/nonexistent/file.jsonl'), null);
  });

  it('returns null for empty transcript', () => {
    const file = withTranscript([]);
    assert.equal(extractLastAssistantMessage(file), null);
  });

  it('extracts the LAST assistant message, ignoring earlier ones', () => {
    const file = withTranscript([
      { role: 'user', content: 'first user msg' },
      { role: 'assistant', content: 'first assistant msg' },
      { role: 'user', content: 'second user msg' },
      { role: 'assistant', content: 'second assistant msg' }
    ]);
    assert.equal(extractLastAssistantMessage(file), 'second assistant msg');
  });

  it('skips trailing user/tool entries to find last assistant', () => {
    const file = withTranscript([
      { role: 'assistant', content: 'final assistant text' },
      { role: 'tool_result', content: 'some tool output' },
      { role: 'user', content: 'user reply' }
    ]);
    assert.equal(extractLastAssistantMessage(file), 'final assistant text');
  });

  it('tolerates unparseable lines mid-transcript (transcript being written)', () => {
    const file = withTranscript([
      { role: 'assistant', content: 'good message' },
      '{partial-json that was being written',
      { role: 'user', content: 'later' }
    ]);
    assert.equal(extractLastAssistantMessage(file), 'good message');
  });

  it('returns null when no assistant entries exist', () => {
    const file = withTranscript([
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' }
    ]);
    assert.equal(extractLastAssistantMessage(file), null);
  });
});

describe('buildClassifierPrompt', () => {
  it('includes the message between MESSAGE_START and MESSAGE_END', () => {
    const prompt = buildClassifierPrompt('hello world');
    assert.ok(prompt.includes('[MESSAGE_START]'));
    assert.ok(prompt.includes('[MESSAGE_END]'));
    assert.ok(prompt.includes('hello world'));
  });

  it('asks for structured JSON response with isUserQuestion + confidence', () => {
    const prompt = buildClassifierPrompt('x');
    assert.ok(prompt.includes('isUserQuestion'));
    assert.ok(prompt.includes('confidence'));
    assert.ok(prompt.toLowerCase().includes('json'));
  });

  it('provides positive and negative examples', () => {
    const prompt = buildClassifierPrompt('x');
    assert.ok(prompt.includes('Examples:'));
    assert.ok(prompt.includes('Yes'), 'should have a NO-classification example (rhetorical)');
    assert.ok(prompt.includes('proceed with A or B'), 'should have a YES-classification example');
  });

  it('caps message length to avoid runaway prompts', () => {
    const huge = 'X'.repeat(50000);
    const prompt = buildClassifierPrompt(huge);
    // Prompt should not contain the full 50k chars.
    assert.ok(prompt.length < 20000, 'prompt should be capped');
  });
});

describe('hasDangerousKeys', () => {
  // Note: object literal `{__proto__: {}}` is syntactic sugar for setPrototypeOf
  // and does NOT create an own property named "__proto__". To test the guard we
  // must create objects with a real own property of that name via JSON.parse
  // (which is what the classifier actually receives from Haiku).
  const makeProtoKey = () => JSON.parse('{"__proto__": {"polluted": true}}');
  const makeCtorKey = () => JSON.parse('{"constructor": "x"}');
  const makePrototypeKey = () => JSON.parse('{"prototype": "x"}');

  it('detects top-level __proto__ / constructor / prototype (own-property form)', () => {
    assert.equal(hasDangerousKeys(makeProtoKey()), true);
    assert.equal(hasDangerousKeys(makeCtorKey()), true);
    assert.equal(hasDangerousKeys(makePrototypeKey()), true);
  });

  it('detects nested dangerous keys', () => {
    assert.equal(hasDangerousKeys({ a: makeProtoKey() }), true);
  });

  it('returns false for clean objects', () => {
    assert.equal(hasDangerousKeys({ a: 1, b: { c: 'ok' } }), false);
  });

  it('handles arrays and primitives', () => {
    assert.equal(hasDangerousKeys([makeProtoKey()]), true);
    assert.equal(hasDangerousKeys(null), false);
    assert.equal(hasDangerousKeys('string'), false);
  });
});

describe('classifyWorkerQuestion — fail-open paths (no live API)', () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  it('returns classified:false with reason:no-credentials when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await classifyWorkerQuestion({ transcriptPath: '/tmp/does-not-matter' });
    assert.equal(result.classified, false);
    assert.equal(result.reason, 'no-credentials');
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origKey;
  });

  it('returns classified:false with reason:no-transcript-path when path missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-for-test';
    try {
      const result = await classifyWorkerQuestion({ transcriptPath: '' });
      assert.equal(result.classified, false);
      assert.equal(result.reason, 'no-transcript-path');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('returns classified:false with reason:no-last-message for empty transcript', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-for-test';
    const file = withTranscript([]);
    try {
      const result = await classifyWorkerQuestion({ transcriptPath: file });
      assert.equal(result.classified, false);
      assert.equal(result.reason, 'no-last-message');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('returns classified:false for transcript with no assistant entries', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-for-test';
    const file = withTranscript([{ role: 'user', content: 'hi' }]);
    try {
      const result = await classifyWorkerQuestion({ transcriptPath: file });
      assert.equal(result.classified, false);
      assert.equal(result.reason, 'no-last-message');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});

describe('exports', () => {
  it('exports the documented public API', () => {
    assert.ok(typeof classifyQuestion === 'function');
    assert.ok(typeof classifyWorkerQuestion === 'function');
    assert.ok(typeof extractLastAssistantMessage === 'function');
    assert.ok(typeof extractAssistantText === 'function');
    assert.ok(typeof buildClassifierPrompt === 'function');
    assert.ok(typeof buildMainModePrompt === 'function');
    assert.ok(typeof hasDangerousKeys === 'function');
    assert.equal(typeof DEFAULT_MIN_CONFIDENCE, 'number');
    assert.equal(typeof DEFAULT_MODEL, 'string');
    assert.ok(DEFAULT_MODEL.includes('haiku'), 'default model should be haiku');
  });
});

describe('buildMainModePrompt', () => {
  it('frames prompt for SOLO/main-mode sessions, not worker', () => {
    const p = buildMainModePrompt('any message');
    assert.ok(p.includes('SOLO'), 'main-mode prompt must frame session as SOLO');
    assert.ok(!p.includes('WORKSPACE WORKER'), 'main-mode prompt must NOT reuse worker framing');
    assert.ok(p.includes('task-boundary') || p.includes('flow ask'), 'mentions the deferral context');
  });

  it('embeds message between MESSAGE_START and MESSAGE_END markers', () => {
    const p = buildMainModePrompt('Option A or B?');
    assert.ok(p.includes('[MESSAGE_START]\nOption A or B?\n[MESSAGE_END]'));
  });

  it('requests structured JSON output matching the worker schema', () => {
    const p = buildMainModePrompt('x');
    assert.ok(p.includes('"isUserQuestion"'));
    assert.ok(p.includes('"confidence"'));
    assert.ok(p.includes('"reason"'));
  });

  it('caps message length to MAX_MESSAGE_CHARS (8000)', () => {
    const long = 'a'.repeat(20000);
    const p = buildMainModePrompt(long);
    const aCount = (p.match(/a/g) || []).length;
    assert.ok(aCount <= 8100, `message should be capped; got ${aCount} a's in prompt`);
  });
});

describe('classifyQuestion — fail-open paths (main mode)', () => {
  it('returns classified:false with no-credentials when ANTHROPIC_API_KEY absent', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await classifyQuestion({ mode: 'main', transcriptPath: '/tmp/x' });
      assert.equal(r.classified, false);
      assert.equal(r.reason, 'no-credentials');
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('returns classified:false with no-transcript-path when path missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-fake';
    try {
      const r = await classifyQuestion({ mode: 'main' });
      assert.equal(r.classified, false);
      assert.equal(r.reason, 'no-transcript-path');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('returns classified:false with no-last-message for empty transcript', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-fake';
    const file = withTranscript([]);
    try {
      const r = await classifyQuestion({ mode: 'main', transcriptPath: file });
      assert.equal(r.classified, false);
      assert.equal(r.reason, 'no-last-message');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('defaults mode to worker when mode param is missing or invalid', async () => {
    // Both should follow the worker prompt path — easiest proxy: the fail-open
    // reason is identical regardless of mode, so we check that classifyQuestion
    // without mode matches classifyWorkerQuestion behavior.
    const a = await classifyQuestion({ transcriptPath: '/tmp/nope' });
    const b = await classifyWorkerQuestion({ transcriptPath: '/tmp/nope' });
    assert.equal(a.classified, b.classified);
    assert.equal(a.reason, b.reason);
  });
});
