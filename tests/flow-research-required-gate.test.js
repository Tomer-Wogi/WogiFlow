'use strict';

/**
 * Tests for the mechanical Research-Required Gate (wf-5cd71b1f).
 *
 * Covers:
 *   - Classifier intent detection (command / factual / diagnostic / none)
 *   - Override prefix `!`
 *   - Marker write/load/clear/bump
 *   - Stop-hook gate: insufficient reads → block (continue:true)
 *   - Stop-hook gate: enough reads → allow + consume marker
 *   - Stop-hook gate: maxAttempts exceeded → hard-stop (continue:false)
 *   - Transcript parsing (current-turn isolation)
 *   - Bash read commands count as evidence
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLF_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'research-required-classifier.js');
const GATE_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'research-required-gate.js');
const FLOW_PATHS = path.resolve(__dirname, '..', 'scripts', 'flow-paths.js');
const FLOW_UTILS = path.resolve(__dirname, '..', 'scripts', 'flow-utils.js');
const FLOW_IO = path.resolve(__dirname, '..', 'scripts', 'flow-io.js');

function evictCaches() {
  [CLF_PATH, GATE_PATH, FLOW_PATHS, FLOW_UTILS, FLOW_IO].forEach((p) => {
    try { delete require.cache[require.resolve(p)]; } catch (_err) { /* */ }
  });
}

function withProject(fn) {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-research-test-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.workflow', 'config.json'), JSON.stringify({ researchRequiredGate: { enabled: true } }));
  process.chdir(tmp);
  try {
    evictCaches();
    const clf = require(CLF_PATH);
    const gate = require(GATE_PATH);
    fn(tmp, clf, gate);
  } finally {
    process.chdir(originalCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* */ }
    evictCaches();
  }
}

function writeTranscript(tmp, entries) {
  const transcriptPath = path.join(tmp, 'transcript.jsonl');
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(transcriptPath, lines + '\n');
  return transcriptPath;
}

describe('research-required-classifier — intent detection', () => {
  it('classifies generic-factual prompts (NO marker): "what is a X", "what does X mean"', () => {
    withProject((_tmp, clf) => {
      assert.strictEqual(clf.classifyPrompt('what is a closure').category, 'factual');
      assert.strictEqual(clf.classifyPrompt('what does idempotent mean').category, 'factual');
      assert.strictEqual(clf.classifyPrompt('how many days in a year').category, 'factual');
    });
  });

  it('wf-1bcc67d5: project-specific factual/locational prompts classify as "locational" (gated)', () => {
    withProject((_tmp, clf) => {
      // The reported failure case + siblings:
      assert.strictEqual(clf.classifyPrompt('where do API keys get saved in this project').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('where is the config file').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('where are the secrets stored').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('which file handles routing').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('which module defines the deferral gate').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('how does the deferral gate work').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('how is the routing flag configured').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('show me the routes').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('list all the gates').category, 'locational');
      assert.strictEqual(clf.classifyPrompt('what file handles the stop hook').category, 'locational');
    });
  });

  it('classifies command prompts: task IDs, action imperatives, follow-ups', () => {
    withProject((_tmp, clf) => {
      assert.strictEqual(clf.classifyPrompt('wf-abc12345').category, 'command');
      assert.strictEqual(clf.classifyPrompt('/wogi-start').category, 'command');
      assert.strictEqual(clf.classifyPrompt('add a button').category, 'command');
      assert.strictEqual(clf.classifyPrompt('yes').category, 'command');
      assert.strictEqual(clf.classifyPrompt('continue').category, 'command');
      assert.strictEqual(clf.classifyPrompt('option 4').category, 'command');
    });
  });

  it('classifies diagnostic prompts: "why", "should I", "what do you think"', () => {
    withProject((_tmp, clf) => {
      assert.strictEqual(clf.classifyPrompt('why did the test fail').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('should I commit this').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('what do you think about this approach').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('is this correct').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('explain why this happens').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('did you fix the bug').category, 'diagnostic');
    });
  });

  it('wf-12271e82: bare "recommend" no longer over-triggers; question-shape still does', () => {
    withProject((_tmp, clf) => {
      // Diagnostic: imperative or question-shape recommend at sentence start
      assert.strictEqual(clf.classifyPrompt('Recommend a library for parsing dates').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('Please recommend an approach').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('Can you recommend a fix').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('What do you recommend for this case').category, 'diagnostic');
      assert.strictEqual(clf.classifyPrompt('Do you recommend keeping the old API').category, 'diagnostic');
      // After sentence boundary still counts
      assert.strictEqual(clf.classifyPrompt('I tried option A. Recommend something else.').category, 'diagnostic');

      // NOT diagnostic: bare "recommend" mid-sentence in declarative / mid-clause use
      assert.notStrictEqual(clf.classifyPrompt('The recommendation system is broken').category, 'diagnostic');
      assert.notStrictEqual(clf.classifyPrompt('I recommend doing X tomorrow').category, 'diagnostic');
      assert.notStrictEqual(clf.classifyPrompt('She wrote a recommendation letter').category, 'diagnostic');
    });
  });

  it('override prefix `!` classifies as command (skips gate)', () => {
    withProject((_tmp, clf) => {
      const r = clf.classifyPrompt('! why did this happen');
      assert.strictEqual(r.category, 'command');
      assert.strictEqual(r.overridden, true);
    });
  });

  it('returns none for unmatched prompts', () => {
    withProject((_tmp, clf) => {
      // "hello world" — no marker pattern
      const r = clf.classifyPrompt('hello world');
      assert.strictEqual(r.category, 'none');
    });
  });
});

describe('research-required-classifier — applyClassification', () => {
  it('writes marker on diagnostic, skips on command/factual', () => {
    withProject((_tmp, clf) => {
      const r1 = clf.applyClassification('why is X broken', { researchRequiredGate: { enabled: true } });
      assert.strictEqual(r1.applied, true);
      assert.ok(clf.loadMarker());

      clf.clearMarker();
      const r2 = clf.applyClassification('what is the time', { researchRequiredGate: { enabled: true } });
      assert.strictEqual(r2.applied, false);
      assert.strictEqual(clf.loadMarker(), null);

      const r3 = clf.applyClassification('continue', { researchRequiredGate: { enabled: true } });
      assert.strictEqual(r3.applied, false);
    });
  });

  it('disabled config → no marker', () => {
    withProject((_tmp, clf) => {
      const r = clf.applyClassification('why is X broken', { researchRequiredGate: { enabled: false } });
      assert.strictEqual(r.applied, false);
      assert.strictEqual(clf.loadMarker(), null);
    });
  });

  it('wf-1bcc67d5: locational question writes marker with category=locational + returns a nudge', () => {
    withProject((_tmp, clf) => {
      const r = clf.applyClassification('where do API keys get saved in this project', { researchRequiredGate: { enabled: true } });
      assert.strictEqual(r.applied, true);
      assert.strictEqual(r.category, 'locational');
      assert.ok(typeof r.nudge === 'string' && r.nudge.includes('Read/Grep/Glob'), 'nudge should instruct to grep/read');
      const marker = clf.loadMarker();
      assert.ok(marker);
      assert.strictEqual(marker.category, 'locational');
    });
  });

  it('wf-1bcc67d5: GATED_CATEGORIES contains both diagnostic and locational', () => {
    withProject((_tmp, clf) => {
      assert.ok(clf.GATED_CATEGORIES.has('diagnostic'));
      assert.ok(clf.GATED_CATEGORIES.has('locational'));
      assert.equal(clf.GATED_CATEGORIES.has('factual'), false);
      assert.equal(clf.GATED_CATEGORIES.has('command'), false);
    });
  });
});

describe('research-required-gate — Stop-hook gate', () => {
  it('does not block when marker is absent', () => {
    withProject((tmp, _clf, gate) => {
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'hi' },
        { type: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      ]);
      const r = gate.checkResearchRequiredGate({ transcriptPath, config: { researchRequiredGate: { enabled: true } } });
      assert.strictEqual(r.blocked, false);
    });
  });

  it('blocks (soft re-prompt) when marker exists and no Read calls in turn', () => {
    withProject((tmp, clf, gate) => {
      clf.applyClassification('why did X fail', { researchRequiredGate: { enabled: true } });
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'why did X fail' },
        { type: 'assistant', content: [{ type: 'text', text: 'X failed because of Y' }] }
      ]);
      const r = gate.checkResearchRequiredGate({ transcriptPath, config: { researchRequiredGate: { enabled: true } } });
      assert.strictEqual(r.blocked, true);
      assert.strictEqual(r.hardStop, false);
      assert.strictEqual(r.evidenceCount, 0);
      assert.match(r.message, /RESEARCH-REQUIRED VIOLATION/);
    });
  });

  it('does not block when sufficient Read calls exist (consumes marker)', () => {
    withProject((tmp, clf, gate) => {
      clf.applyClassification('why did X fail', { researchRequiredGate: { enabled: true } });
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'why did X fail' },
        { type: 'assistant', content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/abs/lib/wogi-claude' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/abs/scripts/hooks/core/foo.js' } },
          { type: 'text', text: 'Based on the code, X failed because of Y at line N.' }
        ] }
      ]);
      const r = gate.checkResearchRequiredGate({ transcriptPath, config: { researchRequiredGate: { enabled: true } } });
      assert.strictEqual(r.blocked, false);
      assert.strictEqual(r.evidenceCount, 2);
      assert.strictEqual(clf.loadMarker(), null, 'marker should be consumed');
    });
  });

  it('counts Bash with cat/head/grep/rg against evidence paths as evidence', () => {
    withProject((tmp, clf, gate) => {
      clf.applyClassification('why did X fail', { researchRequiredGate: { enabled: true } });
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'why did X fail' },
        { type: 'assistant', content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'cat scripts/foo.js' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'grep -n pattern lib/wogi-claude' } },
          { type: 'text', text: 'answer' }
        ] }
      ]);
      const r = gate.checkResearchRequiredGate({ transcriptPath, config: { researchRequiredGate: { enabled: true } } });
      assert.strictEqual(r.blocked, false);
      assert.ok(r.evidenceCount >= 2);
    });
  });

  it('hard-stops after maxAttempts exceeded', () => {
    withProject((tmp, clf, gate) => {
      clf.applyClassification('why did X fail', { researchRequiredGate: { enabled: true, maxAttempts: 2 } });
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'why did X fail' },
        { type: 'assistant', content: [{ type: 'text', text: 'still no reads' }] }
      ]);
      // Bump marker manually to simulate prior attempts
      const marker = clf.loadMarker();
      clf.bumpMarkerAttempt(marker);
      clf.bumpMarkerAttempt(clf.loadMarker());
      // Now attemptCount should be 2; next attempt will trigger hard-stop
      const r = gate.checkResearchRequiredGate({
        transcriptPath,
        config: { researchRequiredGate: { enabled: true, maxAttempts: 2 } }
      });
      assert.strictEqual(r.blocked, true);
      assert.strictEqual(r.hardStop, true);
      assert.match(r.message, /HARD-STOP/);
      assert.strictEqual(clf.loadMarker(), null, 'marker cleared on hard-stop');
    });
  });

  it('isEvidencePath matches expected prefixes', () => {
    withProject((_tmp, _clf, gate) => {
      assert.strictEqual(gate.isEvidencePath('/abs/lib/wogi-claude'), true);
      assert.strictEqual(gate.isEvidencePath('scripts/flow-utils.js'), true);
      assert.strictEqual(gate.isEvidencePath('.workflow/state/decisions.md'), true);
      assert.strictEqual(gate.isEvidencePath('src/components/Button.tsx'), true);
      assert.strictEqual(gate.isEvidencePath('node_modules/foo/bar.js'), false);
      assert.strictEqual(gate.isEvidencePath('README.md'), false);
    });
  });

  it('bashReadsEvidence detects cat/head/grep targeting evidence paths', () => {
    withProject((_tmp, _clf, gate) => {
      assert.strictEqual(gate.bashReadsEvidence('cat lib/foo.js'), true);
      assert.strictEqual(gate.bashReadsEvidence('grep -n bar scripts/baz.js'), true);
      assert.strictEqual(gate.bashReadsEvidence('rg pattern src/'), true);
      assert.strictEqual(gate.bashReadsEvidence('cat README.md'), false, 'README is not evidence');
      assert.strictEqual(gate.bashReadsEvidence('echo hello'), false);
      assert.strictEqual(gate.bashReadsEvidence('rm -rf lib/'), false, 'rm is not a read command');
    });
  });

  it('disabled gate is fail-open', () => {
    withProject((tmp, clf, gate) => {
      clf.applyClassification('why did X fail', { researchRequiredGate: { enabled: true } });
      const transcriptPath = writeTranscript(tmp, [
        { type: 'user', content: 'why' },
        { type: 'assistant', content: [{ type: 'text', text: 'no reads' }] }
      ]);
      const r = gate.checkResearchRequiredGate({ transcriptPath, config: { researchRequiredGate: { enabled: false } } });
      assert.strictEqual(r.blocked, false);
    });
  });
});
