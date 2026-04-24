#!/usr/bin/env node

/**
 * Wogi Flow - Feature Dossier Gate (Core Module)
 *
 * Auto-injects matching feature dossiers + cross-cutting logic rules into
 * the phase context so Claude doesn't have to fetch them under token pressure.
 *
 * Problem this solves (2026-04-24 workspace failure catalog):
 *   - Claude doesn't proactively fetch context — grabs one thing, ignores rest
 *   - Feature/workflow knowledge is lost between sessions
 *   - Owner corrections stop being remembered
 *   - "I know the rule exists" ≠ "I consulted it before acting"
 *
 * Two enforcement surfaces:
 *   1. buildPhaseInjection() — called by UserPromptSubmit. Returns a
 *      markdown block with the top matching dossiers' canonical content.
 *      Injected into the phase prompt alongside the phase-context injection.
 *
 *   2. validateSpecContradictions() — called from /wogi-story spec-review.
 *      Scans a spec file against every matching dossier and returns
 *      blocking issues (spec mentions rejected alternative, spec reintroduces
 *      removed element). Returns { blocked: boolean, issues: [...] }.
 *
 * Fail-open throughout. Missing dossiers, unreadable files, grep failures —
 * all fail-open. The gate is an aid, not a hard stopgap; the core invariant
 * is "don't break existing workflow if dossiers aren't set up yet."
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, safeJsonParse, getConfig } = require('../../flow-utils');

function isEnabled() {
  try {
    const config = getConfig();
    return config.featureDossier?.enabled !== false;
  } catch (_err) {
    return true;
  }
}

function getCurrentTaskInfo() {
  try {
    const ready = safeJsonParse(PATHS.ready, null);
    if (!ready || !Array.isArray(ready.inProgress) || ready.inProgress.length === 0) {
      return null;
    }
    const task = ready.inProgress[0];
    const files = [];
    if (task.specPath && fs.existsSync(path.join(PATHS.root, task.specPath))) {
      files.push(task.specPath);
    }
    const changeFiles = listRecentlyChangedFiles();
    return {
      id: task.id,
      title: task.title || '',
      description: task.notes || task.description || '',
      criteria: task.criteria || [],
      files: [...new Set([...files, ...changeFiles])]
    };
  } catch (_err) {
    return null;
  }
}

function listRecentlyChangedFiles() {
  try {
    const { execSync } = require('node:child_process');
    const out = execSync('git diff --name-only HEAD 2>/dev/null; git status --porcelain 2>/dev/null | awk \'{print $2}\' ', {
      cwd: PATHS.root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return out.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
  } catch (_err) { return []; }
}

/**
 * Build the phase-injection block for the current task.
 * Returns null if no matches, dossier system is disabled, or on any error.
 */
function getDossierInjection() {
  if (!isEnabled()) return null;
  let dossier, logicRules;
  try {
    dossier = require('../../flow-feature-dossier');
    logicRules = require('../../flow-logic-rules');
  } catch (_err) { return null; }

  const taskInfo = getCurrentTaskInfo();
  if (!taskInfo) return null;

  const criteriaText = (taskInfo.criteria || []).map(c =>
    typeof c === 'string' ? c : (c && c.text) || ''
  ).join('\n');
  const matchInput = {
    title: taskInfo.title,
    description: `${taskInfo.description}\n${criteriaText}`,
    files: taskInfo.files
  };

  let featureBlock = null, rulesBlock = null;
  try {
    const featureMatches = dossier.matchFeatures(matchInput);
    const config = getConfig();
    const minScore = config.featureDossier?.autoMatchConfidence ?? 1;
    featureBlock = dossier.buildPhaseInjection(featureMatches, { minScore, maxDossiers: 3 });
  } catch (_err) { /* non-blocking */ }

  try {
    const ruleMatches = logicRules.matchRulesForFiles(
      taskInfo.files,
      [taskInfo.title, taskInfo.description].filter(Boolean)
    );
    rulesBlock = logicRules.buildRulesInjection(ruleMatches);
  } catch (_err) { /* non-blocking */ }

  const parts = [featureBlock, rulesBlock].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join('\n\n---\n\n');
}

/**
 * Validate a spec file against all matching dossiers.
 * Returns { blocked, issues } — blocked=true if any blocker-severity issue.
 *
 * @param {string} specContent
 * @param {Object} [taskInfo] — optional pre-computed task info; otherwise detected
 */
function validateSpecContradictions(specContent, taskInfo) {
  if (!isEnabled()) return { blocked: false, issues: [] };
  let dossier;
  try { dossier = require('../../flow-feature-dossier'); }
  catch (_err) { return { blocked: false, issues: [] }; }

  const info = taskInfo || getCurrentTaskInfo();
  if (!info) return { blocked: false, issues: [] };

  const matches = dossier.matchFeatures({
    title: info.title,
    description: info.description,
    files: info.files
  });

  const allIssues = [];
  for (const m of matches) {
    const d = dossier.loadDossier(m.slug);
    if (!d) continue;
    const issues = dossier.validateSpecAgainstDossier(specContent, d);
    for (const issue of issues) {
      allIssues.push({ ...issue, dossier: m.slug });
    }
  }

  let blockOnContradiction = true;
  try {
    const config = getConfig();
    blockOnContradiction = config.featureDossier?.blockOnContradiction !== false;
  } catch (_err) { /* default true */ }

  const blockers = allIssues.filter(i => i.severity === 'blocker');
  return {
    blocked: blockOnContradiction && blockers.length > 0,
    issues: allIssues
  };
}

/**
 * Format contradictions as a block message the caller can surface to the user.
 */
function formatContradictionMessage(issues) {
  if (!issues || issues.length === 0) return '';
  const lines = ['## Feature Dossier Contradiction Gate', ''];
  lines.push(`${issues.length} contradiction(s) found between the proposed spec and one or more active feature dossiers.`);
  lines.push('');
  lines.push('Dossiers capture owner-rejected alternatives and removed elements. A spec that reintroduces any of these would re-introduce a bug the owner already corrected.');
  lines.push('');
  for (const issue of issues) {
    lines.push(`- **[${issue.severity}]** (${issue.dossier} / ${issue.kind}) ${issue.detail}`);
  }
  lines.push('');
  lines.push('**Resolution**:');
  lines.push('1. Read the referenced dossier section in full.');
  lines.push('2. If the owner has actually changed their mind, update the dossier (move the item out of Rejected / Removed) before proceeding.');
  lines.push('3. Otherwise, revise the spec to not reintroduce the rejected/removed item.');
  return lines.join('\n');
}

module.exports = {
  isEnabled,
  getCurrentTaskInfo,
  getDossierInjection,
  validateSpecContradictions,
  formatContradictionMessage
};
