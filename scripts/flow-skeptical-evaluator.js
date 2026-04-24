#!/usr/bin/env node

/**
 * Wogi Flow — Skeptical Evaluator (wf-15175dbc / B5).
 *
 * Validating-phase agent that reads the spec + delivery, then forces the AI
 * through a field-by-field enumeration before letting a "done" claim stand.
 *
 * The evaluator composes a prompt with three enumeration passes:
 *   1. UI-field enumeration  — for every modified UI surface, list every
 *      input/select/textarea/custom field. Reuses the B3 template schema.
 *   2. API-parameter enumeration — for every touched endpoint, list every
 *      request/response field.
 *   3. State-key enumeration — for every touched state file or config key,
 *      list every entry.
 *
 * For each enumerated item, the evaluator demands a Tier classification
 * (reuse flow-completion-truth-gate EVIDENCE_TIERS) and a confidencePct
 * per the 95/85/75 rubric (wf-f14dcfeb / A4).
 *
 * Composition flow (orchestrator calls this, then invokes Agent tool with the prompt):
 *   const { buildSkepticalPrompt, parseSkepticalOutput } = require('./flow-skeptical-evaluator');
 *   const prompt = buildSkepticalPrompt({ specMarkdown, diffText, changedFiles, taskId });
 *   // ... orchestrator invokes Agent tool with prompt ...
 *   const result = parseSkepticalOutput(agentResponse, { taskId });
 *
 * Story: wf-15175dbc (B5)
 * Epic: wf-34290000
 */

const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { getConfig } = require('./flow-config-loader');
const {
  parseBELItems,
  extractSpecStrings,
  verifyBELAgainstDelivery,
  verifySpecBundleCoverage,
} = require('./flow-completion-truth-gate');

const TEMPLATE_PATH = path.join(PATHS.workflow, 'templates', 'tier3-dom-field-inventory.md');

function _isDisabled() {
  const cfg = getConfig();
  const igr = cfg.intentGroundedReasoning || {};
  if (igr.enabled === false) return { disabled: true, reason: 'igr-disabled' };
  const se = igr.skepticalEvaluator || {};
  if (se.enabled === false) return { disabled: true, reason: 'skeptical-evaluator-disabled' };
  return { disabled: false };
}

/**
 * Build the system + user prompt for the skeptical evaluator sub-agent.
 *
 * @param {object} opts
 * @param {string} opts.specMarkdown - spec file content
 * @param {string} opts.diffText - git diff
 * @param {string[]} [opts.changedFiles]
 * @param {string} [opts.commitMessage]
 * @param {string} [opts.taskId]
 * @param {string} [opts.bundleText] - built-bundle text if available
 * @returns {{ systemPrompt: string, userPrompt: string, preChecks: object, metadata: object }}
 */
function buildSkepticalPrompt(opts) {
  if (!opts || typeof opts !== 'object') throw new TypeError('buildSkepticalPrompt: opts required');
  if (typeof opts.specMarkdown !== 'string') throw new TypeError('buildSkepticalPrompt: specMarkdown required');

  const dis = _isDisabled();
  if (dis.disabled) {
    return { systemPrompt: '', userPrompt: '', preChecks: {}, metadata: { skipped: true, reason: dis.reason, taskId: opts.taskId || null } };
  }

  const { specMarkdown, diffText = '', changedFiles = [], commitMessage = '', taskId = '', bundleText = '' } = opts;

  // Run the mechanical pre-checks so the evaluator is grounded in data, not vibes.
  const bel = verifyBELAgainstDelivery({ specMarkdown, diffText, changedFiles, commitMessage });
  const bundle = verifySpecBundleCoverage({ specMarkdown, diffText, changedFiles, bundleText });
  const belItems = parseBELItems(specMarkdown);
  const specStrings = extractSpecStrings(specMarkdown);

  const systemPrompt = [
    '# Skeptical Evaluator',
    '',
    'You are the Skeptical Evaluator for WogiFlow\'s validating phase. Your job is to force field-by-field enumeration before a task can be marked "done". Your baseline stance: the claim is unverified until you see every field enumerated and classified.',
    '',
    '## Inputs you receive',
    '',
    '- The task spec (markdown)',
    '- The unified diff',
    '- Changed file paths',
    '- Commit message (if any)',
    '- Mechanical pre-check results from `flow-completion-truth-gate` (BEL grep, spec-bundle grep)',
    '',
    '## Mandatory enumeration passes',
    '',
    '### Pass 1 — UI-field enumeration',
    'For every modified UI surface (form, filter, wizard, settings panel):',
    '- List every `<input>`, `<select>`, `<textarea>`, or custom input component by its `name` / `data-testid`.',
    '- For each: label, type, default, required, validation, visibility condition.',
    '- Compare to the spec\'s AC. Flag vanished / modified / added fields.',
    '',
    'If no UI surfaces touched, state explicitly: "UI-field pass: N/A — no UI files modified."',
    'Reference template: `' + path.relative(process.cwd(), TEMPLATE_PATH) + '`.',
    '',
    '### Pass 2 — API-parameter enumeration',
    'For every touched API endpoint (request handler, route, or client call):',
    '- List every request parameter (query, path, body field).',
    '- List every response field.',
    '- Compare to the spec\'s AC. Flag additions / removals / type changes.',
    '',
    'If no API work touched, state explicitly: "API-parameter pass: N/A."',
    '',
    '### Pass 3 — State-key enumeration',
    'For every touched state file (JSON, YAML, TOML, .env) or config key:',
    '- List every top-level key and each nested key the change introduces / removes.',
    '- Compare to the spec\'s AC.',
    '',
    'If no state-file work touched, state explicitly: "State-key pass: N/A."',
    '',
    '## Evidence tier + confidence tier on every claim',
    '',
    'For every enumerated item you classify as preserved/modified/added/vanished, attach:',
    '- `evidenceTier`: 0–4 per `scripts/flow-runtime-verification.js` EVIDENCE_TIERS',
    '- `confidencePct`: exactly 95, 85, or 75 per `.workflow/rubrics/confidence-tiers.md`',
    '- `evidenceNote`: one-line citation (file:line, grep result, or observation)',
    '',
    'Confidence 75 automatically flags the claim `UNVERIFIED`. Do not upgrade without evidence.',
    '',
    '## Output contract',
    '',
    'Return ONE JSON object with shape:',
    '```json',
    '{',
    '  "taskId": "<id>",',
    '  "uiFieldPass": { "ran": true|false, "reason": "...", "findings": [...] },',
    '  "apiParameterPass": { ... },',
    '  "stateKeyPass": { ... },',
    '  "overallVerdict": "PASS" | "CONCERN" | "FAIL",',
    '  "blockers": ["one string per blocking issue"],',
    '  "unverifiedClaims": ["one string per claim at confidence 75"]',
    '}',
    '```',
    '',
    'No prose. No markdown fences around the JSON. Just the object.',
  ].join('\n');

  const userPrompt = [
    '# Inputs',
    '',
    `- Task ID: ${taskId || '<unknown>'}`,
    `- Changed files (${changedFiles.length}): ${changedFiles.slice(0, 20).join(', ')}${changedFiles.length > 20 ? ', ...' : ''}`,
    '',
    '## Spec',
    '```markdown',
    _truncate(specMarkdown, 12000),
    '```',
    '',
    '## Unified diff',
    '```',
    _truncate(diffText, 12000),
    '```',
    '',
    '## Commit message',
    '```',
    _truncate(commitMessage, 2000),
    '```',
    '',
    '## Mechanical pre-checks (from flow-completion-truth-gate)',
    '',
    '### BEL grep',
    `- items parsed: ${belItems.length}`,
    `- ok: ${bel.ok}`,
    `- uncovered: ${bel.uncoveredItems.length}`,
    bel.uncoveredItems.length ? `- uncovered samples: ${bel.uncoveredItems.slice(0, 5).map((u) => u.text).join(' | ')}` : '',
    '',
    '### Spec-bundle coverage',
    `- ok: ${bundle.ok}`,
    ..._bundleSummaryLines(bundle),
    '',
    '## Extracted spec strings (reference)',
    `- backtickIds (${specStrings.backtickIds.length}): ${specStrings.backtickIds.slice(0, 8).join(', ')}`,
    `- filePaths (${specStrings.filePaths.length}): ${specStrings.filePaths.slice(0, 8).join(', ')}`,
    `- constants (${specStrings.constants.length}): ${specStrings.constants.slice(0, 8).join(', ')}`,
    `- routes (${specStrings.routes.length}): ${specStrings.routes.slice(0, 8).join(', ')}`,
    '',
    '## Your task',
    '',
    'Run the three enumeration passes described in the system prompt. Return the JSON object. Be skeptical — force a verdict on every field.',
  ].filter(Boolean).join('\n');

  return {
    systemPrompt,
    userPrompt,
    preChecks: { bel, bundle, belItems, specStrings },
    metadata: { taskId: taskId || null, changedFileCount: changedFiles.length },
  };
}

function _truncate(text, cap) {
  const s = String(text || '');
  return s.length > cap ? s.slice(0, cap) + `\n\n[... truncated at ${cap} chars]` : s;
}

function _bundleSummaryLines(bundle) {
  const out = [];
  for (const [cat, v] of Object.entries(bundle.coverage || {})) {
    if (v.total === 0) continue;
    out.push(`  - ${cat}: ${v.hit}/${v.total} (need ${v.threshold.toFixed(2)})`);
    if (v.missing && v.missing.length > 0) out.push(`      missing: ${v.missing.slice(0, 4).join(', ')}`);
  }
  return out;
}

/**
 * Parse the sub-agent's JSON response.
 * @param {string} response
 * @param {object} [ctx]
 * @returns {object}
 */
function parseSkepticalOutput(response, ctx = {}) {
  if (typeof response !== 'string' || response.trim().length === 0) {
    return { ok: false, reason: 'empty response', overallVerdict: 'FAIL' };
  }
  let parsed;
  try {
    // Try raw
    parsed = JSON.parse(response);
  } catch (_err) {
    // Try extracting JSON object
    const m = response.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: 'no JSON object found', overallVerdict: 'FAIL' };
    try {
      parsed = JSON.parse(m[0]);
    } catch (err) {
      return { ok: false, reason: `JSON parse failed: ${err.message}`, overallVerdict: 'FAIL' };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'response is not an object', overallVerdict: 'FAIL' };
  }
  const verdict = parsed.overallVerdict || 'FAIL';
  return {
    ok: verdict === 'PASS',
    overallVerdict: verdict,
    uiFieldPass: parsed.uiFieldPass || { ran: false },
    apiParameterPass: parsed.apiParameterPass || { ran: false },
    stateKeyPass: parsed.stateKeyPass || { ran: false },
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    unverifiedClaims: Array.isArray(parsed.unverifiedClaims) ? parsed.unverifiedClaims : [],
    taskId: parsed.taskId || ctx.taskId || null,
  };
}

module.exports = {
  buildSkepticalPrompt,
  parseSkepticalOutput,
  TEMPLATE_PATH,
};

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'prompt') {
    const specFile = process.argv[3];
    if (!specFile) { console.error('usage: flow-skeptical-evaluator prompt <spec.md>'); process.exit(2); }
    const fs = require('node:fs');
    const specMarkdown = fs.readFileSync(specFile, 'utf8');
    const built = buildSkepticalPrompt({ specMarkdown, diffText: '', changedFiles: [], taskId: 'cli' });
    console.log('--- SYSTEM ---\n' + built.systemPrompt + '\n--- USER ---\n' + built.userPrompt);
  } else {
    console.error('usage: flow-skeptical-evaluator prompt <spec.md>');
    process.exit(2);
  }
}
