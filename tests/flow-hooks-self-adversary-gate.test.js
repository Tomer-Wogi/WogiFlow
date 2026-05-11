'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withProject(fn) {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-self-adversary-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.workflow', 'config.json'), JSON.stringify({}));
  process.chdir(tmp);
  delete require.cache[require.resolve('../scripts/flow-paths')];
  delete require.cache[require.resolve('../scripts/flow-utils')];
  delete require.cache[require.resolve('../scripts/hooks/core/self-adversary-gate')];
  try {
    const gate = require('../scripts/hooks/core/self-adversary-gate');
    fn(tmp, gate);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/flow-paths')];
    delete require.cache[require.resolve('../scripts/flow-utils')];
    delete require.cache[require.resolve('../scripts/hooks/core/self-adversary-gate')];
  }
}

describe('self-adversary-gate — hashQuestion', () => {
  it('produces stable 16-char hash', () => {
    withProject((_tmp, gate) => {
      const a = gate.hashQuestion('Should I use map() or for?');
      const b = gate.hashQuestion('Should I use map() or for?');
      assert.equal(a, b);
      assert.equal(a.length, 16);
    });
  });
  it('differs for different inputs', () => {
    withProject((_tmp, gate) => {
      const a = gate.hashQuestion('q1');
      const b = gate.hashQuestion('q2');
      assert.notEqual(a, b);
    });
  });
  it('handles non-string input', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.hashQuestion(null), '');
      assert.equal(gate.hashQuestion(undefined), '');
    });
  });
});

describe('self-adversary-gate — isGateEnabled', () => {
  it('returns true by default', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.isGateEnabled({}), true);
    });
  });
  it('returns false when selfAdversaryGate.enabled === false', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.isGateEnabled({ selfAdversaryGate: { enabled: false } }), false);
    });
  });
  it('returns false when selfAdversaryGate === false', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.isGateEnabled({ selfAdversaryGate: false }), false);
    });
  });
});

describe('self-adversary-gate — heuristicCategory', () => {
  it('detects obvious implementation phrasings', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.heuristicCategory('Should I use map() or for-loop?'), 'implementation');
      assert.equal(gate.heuristicCategory('which library should I use?'), 'implementation');
      assert.equal(gate.heuristicCategory('refactor this to use a hook'), 'implementation');
    });
  });
  it('detects obvious product phrasings', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.heuristicCategory('what should users see on the home page?'), 'product');
      assert.equal(gate.heuristicCategory('OK to delete the migration table?'), 'product');
      assert.equal(gate.heuristicCategory('counts as done if the test passes?'), 'product');
    });
  });
  it('returns unknown for ambiguous input (defaults to NOT-implementation)', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.heuristicCategory('let me know your thoughts'), 'unknown');
      assert.equal(gate.heuristicCategory('any preference?'), 'unknown');
    });
  });
  it('product check beats implementation when both match', () => {
    withProject((_tmp, gate) => {
      // "should we use Postgres" phrasing matches IMPLEMENTATION keyword,
      // but "what should users see" matches PRODUCT. Product wins.
      assert.equal(gate.heuristicCategory('what should users see, should we use approach A or B'), 'product');
    });
  });
});

describe('self-adversary-gate — completion + escalation markers', () => {
  it('writes a completion marker that loads back as same data', () => {
    withProject((_tmp, gate) => {
      gate.writeCompletionMarker({
        question: 'Should I use map?',
        decision: 'use map() — readability outweighs allocation cost here',
        confidence: 95,
        iterationCount: 3
      });
      const loaded = gate.loadMarker(gate.getCompletePath());
      assert.ok(loaded);
      assert.equal(loaded.confidence, 95);
      assert.equal(loaded.iterationCount, 3);
      assert.equal(loaded.questionHash, gate.hashQuestion('Should I use map?'));
    });
  });

  it('expires completion marker after TTL', () => {
    withProject((_tmp, gate) => {
      // Write with -1 second TTL (already expired)
      gate.writeCompletionMarker({
        question: 'q',
        decision: 'd',
        confidence: 95,
        iterationCount: 1,
        ttlSec: -1
      });
      const loaded = gate.loadMarker(gate.getCompletePath());
      assert.equal(loaded, null);
    });
  });

  it('writeEscalationMarker captures the reason', () => {
    withProject((_tmp, gate) => {
      gate.writeEscalationMarker({
        question: 'q',
        decision: 'best guess',
        confidence: 60,
        iterationCount: 8,
        reason: 'max-iterations-exhausted'
      });
      const loaded = gate.loadMarker(gate.getEscalationPath());
      assert.equal(loaded.reason, 'max-iterations-exhausted');
      assert.equal(loaded.finalConfidence, 60);
    });
  });
});

describe('self-adversary-gate — checkSelfAdversaryGate', () => {
  it('allows non-AskUserQuestion tools through (early return)', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.checkSelfAdversaryGate('Edit', { file_path: 'x.js' }, {}).blocked, false);
      assert.equal(gate.checkSelfAdversaryGate('Write', { file_path: 'x.js' }, {}).blocked, false);
      assert.equal(gate.checkSelfAdversaryGate('Bash', { command: 'ls' }, {}).blocked, false);
    });
  });

  it('allows when gate disabled', () => {
    withProject((_tmp, gate) => {
      const input = { questions: [{ question: 'Should I use map() or for?' }] };
      const r = gate.checkSelfAdversaryGate('AskUserQuestion', input, { selfAdversaryGate: false });
      assert.equal(r.blocked, false);
    });
  });

  it('blocks AskUserQuestion when heuristic returns implementation', () => {
    withProject((_tmp, gate) => {
      const input = { questions: [{ question: 'Should I use map() or for-loop here?' }] };
      const r = gate.checkSelfAdversaryGate('AskUserQuestion', input, {});
      assert.equal(r.blocked, true);
      assert.equal(r.reason, 'implementation-heuristic');
      assert.match(r.message, /wogi-self-adversary/);
    });
  });

  it('allows AskUserQuestion for product questions', () => {
    withProject((_tmp, gate) => {
      const input = { questions: [{ question: 'What should users see on the home page?' }] };
      const r = gate.checkSelfAdversaryGate('AskUserQuestion', input, {});
      assert.equal(r.blocked, false);
    });
  });

  it('allows after completion marker (consumes it)', () => {
    withProject((_tmp, gate) => {
      const question = 'Should I use map() or for?';
      gate.writeCompletionMarker({ question, decision: 'use for', confidence: 95, iterationCount: 2 });
      const input = { questions: [{ question }] };
      const r = gate.checkSelfAdversaryGate('AskUserQuestion', input, {});
      assert.equal(r.blocked, false);
      // Marker should now be gone
      assert.equal(gate.loadMarker(gate.getCompletePath()), null);
    });
  });

  it('allows after escalation marker (consumes it)', () => {
    withProject((_tmp, gate) => {
      const question = 'Should I use map() or for-loop here?';
      gate.writeEscalationMarker({ question, decision: 'inconclusive', confidence: 70, iterationCount: 8, reason: 'low-confidence' });
      const input = { questions: [{ question }] };
      const r = gate.checkSelfAdversaryGate('AskUserQuestion', input, {});
      assert.equal(r.blocked, false);
      assert.equal(gate.loadMarker(gate.getEscalationPath()), null);
    });
  });

  it('handles missing or malformed input gracefully', () => {
    withProject((_tmp, gate) => {
      assert.equal(gate.checkSelfAdversaryGate('AskUserQuestion', null, {}).blocked, false);
      assert.equal(gate.checkSelfAdversaryGate('AskUserQuestion', {}, {}).blocked, false);
      assert.equal(gate.checkSelfAdversaryGate('AskUserQuestion', { questions: [] }, {}).blocked, false);
    });
  });
});
