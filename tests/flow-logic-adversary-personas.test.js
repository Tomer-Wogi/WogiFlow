#!/usr/bin/env node

/**
 * Tests for Logic Adversary persona library.
 * Story: wf-258f558c (A2)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  pickPersona,
  loadPersona,
  PERSONA_LIBRARY,
  PERSONA_TRIGGERS,
} = require('../scripts/flow-logic-adversary');

test('PERSONA_LIBRARY exports 5 personas', () => {
  assert.equal(PERSONA_LIBRARY.length, 5);
  assert.ok(PERSONA_LIBRARY.includes('scale-skeptic'));
  assert.ok(PERSONA_LIBRARY.includes('security-hawk'));
  assert.ok(PERSONA_LIBRARY.includes('simplicity-champion'));
  assert.ok(PERSONA_LIBRARY.includes('platform-rigor'));
  assert.ok(PERSONA_LIBRARY.includes('user-advocate'));
});

test('every persona in the library has a corresponding .md file', () => {
  const dir = path.join(__dirname, '..', '.workflow', 'agents', 'personas');
  for (const key of PERSONA_LIBRARY) {
    const p = path.join(dir, `${key}.md`);
    assert.ok(fs.existsSync(p), `missing persona file: ${p}`);
  }
});

test('loadPersona returns content for a known key', () => {
  const content = loadPersona('security-hawk');
  assert.ok(content.length > 100);
  assert.match(content, /Security Hawk/);
});

test('loadPersona returns empty for unknown key', () => {
  assert.equal(loadPersona('nonexistent'), '');
  assert.equal(loadPersona(''), '');
  assert.equal(loadPersona(null), '');
});

test('pickPersona: auth keywords → security-hawk', () => {
  assert.equal(pickPersona({ plan: 'update the auth middleware' }), 'security-hawk');
  assert.equal(pickPersona({ plan: 'rotate secret tokens' }), 'security-hawk');
  assert.equal(pickPersona({ plan: 'rm -rf the old dir' }), 'security-hawk');
});

test('pickPersona: hook/MCP keywords → platform-rigor', () => {
  assert.equal(pickPersona({ plan: 'wire into the PreToolUse hook' }), 'platform-rigor');
  assert.equal(pickPersona({ plan: 'register MCP server for Atlassian' }), 'platform-rigor');
  assert.equal(pickPersona({ plan: 'task ID must pass validateTaskId()' }), 'platform-rigor');
});

test('pickPersona: concurrency keywords → scale-skeptic', () => {
  assert.equal(pickPersona({ plan: 'spawn parallel worker dispatches' }), 'scale-skeptic');
  assert.equal(pickPersona({ plan: 'TOCTOU race condition possible' }), 'scale-skeptic');
});

test('pickPersona: UI keywords → user-advocate', () => {
  assert.equal(pickPersona({ plan: 'improve the onboarding journey' }), 'user-advocate');
  assert.equal(pickPersona({ plan: 'fix the empty state UI' }), 'user-advocate');
});

test('pickPersona: framework/refactor keywords → simplicity-champion', () => {
  assert.equal(pickPersona({ plan: 'extract a pluggable framework for this' }), 'simplicity-champion');
  assert.equal(pickPersona({ plan: 'large refactor for future-proof abstraction' }), 'simplicity-champion');
});

test('pickPersona: no trigger match → deterministic rotation by taskId', () => {
  const p1 = pickPersona({ taskId: 'wf-aaaaaaaa', plan: 'generic task' });
  const p2 = pickPersona({ taskId: 'wf-aaaaaaaa', plan: 'generic task' });
  assert.equal(p1, p2, 'same taskId must yield same persona');
  assert.ok(PERSONA_LIBRARY.includes(p1));
});

test('pickPersona: different taskIds spread across library', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const id = `wf-${i.toString(16).padStart(8, '0')}`;
    seen.add(pickPersona({ taskId: id, plan: 'plain text' }));
  }
  assert.ok(seen.size >= 3, `expected rotation across library; saw ${seen.size} unique`);
});

test('PERSONA_TRIGGERS entries reference valid library keys', () => {
  for (const t of PERSONA_TRIGGERS) {
    assert.ok(PERSONA_LIBRARY.includes(t.persona), `unknown persona in triggers: ${t.persona}`);
    assert.ok(Array.isArray(t.patterns) && t.patterns.length > 0);
  }
});
