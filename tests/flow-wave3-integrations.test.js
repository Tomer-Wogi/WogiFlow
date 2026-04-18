'use strict';

/**
 * Wave 3 (2.25.0) integration tests — docs contracts.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', '.claude', 'commands');

describe('wogi-onboard.md + wogi-init.md (Wave 3.1)', () => {
  for (const cmd of ['wogi-onboard', 'wogi-init']) {
    const file = fs.readFileSync(path.join(COMMANDS_DIR, `${cmd}.md`), 'utf-8');

    describe(cmd, () => {
      it('scaffolds intentGroundedReasoning in fresh config', () => {
        assert.match(file, /intentGroundedReasoning/);
      });
      it('scaffolds taskBoundaryReset', () => {
        assert.match(file, /taskBoundaryReset/);
      });
      it('scaffolds storyFlow.* P0 gate blocks', () => {
        assert.match(file, /storyFlow/);
        assert.match(file, /consumerImpactAnalysis/);
        assert.match(file, /scopeConfidenceAudit/);
        assert.match(file, /itemReconciliation/);
      });
      it('scaffolds longInputGate + researchReasoningGate', () => {
        assert.match(file, /longInputGate/);
        assert.match(file, /researchReasoningGate/);
      });
    });
  }
});

describe('wogi-learn.md (Wave 3.2)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-learn.md'), 'utf-8');

  it('documents Promotion Adversary', () => {
    assert.match(file, /Promotion Adversary/);
  });
  it('documents SAME_PATTERN / MIXED / DIFFERENT verdicts', () => {
    assert.match(file, /SAME_PATTERN/);
    assert.match(file, /MIXED/);
    assert.match(file, /DIFFERENT/);
  });
  it('references a different-model adversary (researchReasoningGate)', () => {
    assert.match(file, /researchReasoningGate|adversaryModel|different model/);
  });
});

describe('wogi-decide.md (Wave 3.2)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-decide.md'), 'utf-8');

  it('documents Rule-Creation Adversary', () => {
    assert.match(file, /Rule-Creation Adversary/);
  });
  it('documents ACCEPT / CLARIFY / NARROW / REJECT verdicts', () => {
    for (const v of ['ACCEPT', 'CLARIFY', 'NARROW', 'REJECT']) {
      assert.match(file, new RegExp(v));
    }
  });
});

describe('wogi-triage.md (Wave 3.3)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-triage.md'), 'utf-8');

  it('documents Anti-Deferral Enforcement section', () => {
    assert.match(file, /Anti-Deferral Enforcement/);
  });
  it('requires explicit user confirmation + reason to defer', () => {
    assert.match(file, /Reason required|requires explicit user confirmation/i);
  });
  it('documents Commit/diff consistency gate (v2.25.1 — mechanical layer)', () => {
    assert.match(file, /Mechanical gate|verifyCommitMessageAgainstDiff|parseCommitMessageClaims/i);
  });
  it('documents Deferral Audit Trail', () => {
    assert.match(file, /Deferral Audit Trail/);
  });
  it('references historical v2.17.4 incident', () => {
    assert.match(file, /2\.17\.4|silently dropped/i);
  });
});
