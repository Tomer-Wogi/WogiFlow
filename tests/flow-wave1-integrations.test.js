'use strict';

/**
 * Wave 1 (2.23.0) integration tests.
 *
 * Verifies that the two script-level upgrades (wogi-morning workspace/honesty
 * surfacing, wogi-session-end workspace message) correctly wire up to the
 * existing workspace-messages + honesty-check infrastructure from 2.22.x.
 *
 * The command-level changes (wogi-debug-hypothesis, wogi-peer-review) are
 * documentation — covered by dedicated docs-contract tests below.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const COMMANDS_DIR = path.join(__dirname, '..', '.claude', 'commands');

// ============================================================
// wogi-debug-hypothesis docs contract
// ============================================================

describe('wogi-debug-hypothesis.md (Wave 1.1)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-debug-hypothesis.md'), 'utf-8');

  it('documents the Tier 2 assumption-surfacing gate', () => {
    assert.match(file, /Step 1:\s*Assumption Surfacing/);
    assert.match(file, /WAIT for user confirmation|WAIT\*\*/);
  });

  it('documents the Scope-Confidence pre-check', () => {
    assert.match(file, /Step 0:\s*Scope-Confidence Pre-Check/);
    assert.match(file, /auditScopeConfidence/);
  });

  it('documents the hypothesis adversary step', () => {
    assert.match(file, /Step 4:\s*Hypothesis Adversary/);
    assert.match(file, /shared_hallucination_risk|overlap_risk/);
  });

  it('exposes CLI opt-outs', () => {
    assert.match(file, /--no-assumptions/);
    assert.match(file, /--no-adversary/);
  });
});

// ============================================================
// wogi-peer-review docs contract
// ============================================================

describe('wogi-peer-review.md (Wave 1.3)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-peer-review.md'), 'utf-8');

  it('documents the synthesis adversary step', () => {
    assert.match(file, /Synthesis Adversary/);
    assert.match(file, /shared hallucination|shared_hallucination/i);
  });

  it('documents evidence tiers on claims', () => {
    assert.match(file, /Tier 0.*NONE/);
    assert.match(file, /Tier 3.*INTERACTIVE/);
    assert.match(file, /Tier 4.*SHIPPED/);
  });

  it('documents effort tier derived from diff size', () => {
    assert.match(file, /effort tier/i);
    assert.match(file, /xhigh|opus-4-7/);
  });

  it('exposes new CLI flags', () => {
    assert.match(file, /--no-adversary/);
    assert.match(file, /--adversary-model/);
    assert.match(file, /--effort/);
  });
});

// ============================================================
// wogi-morning integration
// ============================================================

describe('flow-morning.js (Wave 1.2)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'flow-morning.js'), 'utf-8');

  it('imports buildOverdueContext for workspace dispatch surfacing', () => {
    assert.match(src, /buildOverdueContext/);
    assert.match(src, /require\(['"]\.\/hooks\/core\/overdue-dispatches['"]\)/);
  });

  it('imports checkCompletionClaimHonesty', () => {
    assert.match(src, /checkCompletionClaimHonesty/);
    assert.match(src, /require\(['"]\.\/flow-health['"]\)/);
  });

  it('adds workspaceOverdue + honestyHits to briefing payload', () => {
    assert.match(src, /workspaceOverdue:/);
    assert.match(src, /honestyHits:/);
  });

  it('renders WORKSPACE DISPATCH ISSUES section in print output', () => {
    assert.match(src, /WORKSPACE DISPATCH ISSUES/);
  });

  it('renders HONESTY CHECK section in print output', () => {
    assert.match(src, /HONESTY CHECK/);
  });

  it('fail-open: workspace surfacing wrapped in try/catch', () => {
    // Both new sections must be fail-open so morning briefing never crashes
    // because of missing workspace env or tracking file.
    const workspaceBlock = src.match(/\/\/ v2\.23\.0 — Workspace[\s\S]{0,400}?\}/);
    assert.ok(workspaceBlock, 'expected workspace block');
    assert.match(workspaceBlock[0], /try\s*\{/);
  });
});

// ============================================================
// wogi-session-end integration
// ============================================================

describe('flow-session-end.js (Wave 1.4)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'flow-session-end.js'), 'utf-8');

  it('defines writeWorkspaceSessionEndMessage helper', () => {
    assert.match(src, /function writeWorkspaceSessionEndMessage/);
  });

  it('calls writeWorkspaceSessionEndMessage in main()', () => {
    // Ensure the new function is actually invoked
    const mainSection = src.slice(src.lastIndexOf('writeWorkspaceSessionEndMessage'));
    assert.ok(mainSection.length > 0);
    assert.match(src, /writeWorkspaceSessionEndMessage\(\)/);
  });

  it('gates on WOGI_WORKSPACE_ROOT (manager-only)', () => {
    const fn = src.match(/function writeWorkspaceSessionEndMessage[\s\S]{0,2500}?^\}/m);
    assert.ok(fn);
    assert.match(fn[0], /WOGI_WORKSPACE_ROOT/);
    assert.match(fn[0], /WOGI_REPO_NAME/);
  });

  it('uses workspace-messages bus via saveMessage', () => {
    const fn = src.match(/function writeWorkspaceSessionEndMessage[\s\S]{0,2500}?^\}/m);
    assert.ok(fn);
    assert.match(fn[0], /saveMessage/);
    assert.match(fn[0], /workspace-messages/);
  });

  it('preserves the existing completion-claim honesty scan', () => {
    // We must NOT have accidentally removed the existing scan
    assert.match(src, /runCompletionContradictionScan/);
    assert.match(src, /function runCompletionContradictionScan/);
  });
});

// ============================================================
// wogi-morning docs contract
// ============================================================

describe('wogi-morning.md (Wave 1.2 docs)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-morning.md'), 'utf-8');

  it('documents the WORKSPACE DISPATCH ISSUES section', () => {
    assert.match(file, /WORKSPACE DISPATCH ISSUES/);
  });

  it('documents the HONESTY CHECK section', () => {
    assert.match(file, /HONESTY CHECK/);
  });
});

// ============================================================
// wogi-session-end docs contract
// ============================================================

describe('wogi-session-end.md (Wave 1.4 docs)', () => {
  const file = fs.readFileSync(path.join(COMMANDS_DIR, 'wogi-session-end.md'), 'utf-8');

  it('documents the workspace session-end message step', () => {
    assert.match(file, /Workspace session-end message/i);
    assert.match(file, /heads-up/);
  });

  it('documents the completion-claim honesty scan step', () => {
    assert.match(file, /honesty/i);
  });
});
