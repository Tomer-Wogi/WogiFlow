#!/usr/bin/env node

/**
 * Wogi Flow - Logic Adversary Runner
 *
 * Orchestration for the pre-implementation plan critic.
 *
 * This script does NOT spawn the sub-agent directly. In WogiFlow, sub-agents
 * are spawned by the orchestrating Claude via the Agent tool. This runner
 * provides the building blocks:
 *   - Load the Logic Constitution rubric
 *   - Load calibration examples
 *   - Build the prompt string to pass to the Agent tool
 *   - Parse / validate the structured JSON response
 *   - Apply the iteration policy
 *   - Emit telemetry
 *   - Select the adversary model per config
 *
 * Story: wf-3975a001 (IGR Stage 4 — Logic Adversary)
 * Epic: wf-b00262b1 (IGR)
 *
 * Usage (programmatic, from the orchestrating Claude via /wogi-start Step 1.57):
 *   const { buildAdversaryPrompt, parseAdversaryOutput, recordTelemetry } = require('./flow-logic-adversary');
 *
 *   const prompt = buildAdversaryPrompt({
 *     plan: planMarkdown,
 *     framing: framingMarkdown,
 *     taskId: 'wf-XXXXXXXX',
 *     round: 1,
 *     previousAdversaryOutput: null  // or the prior round's output on re-runs
 *   });
 *   // ... orchestrator invokes Agent tool with this prompt ...
 *   const result = parseAdversaryOutput(agentResponse, { taskId, round });
 *   recordTelemetry(result, { taskId, durationMs, architectModel });
 *
 * Usage (CLI, for dogfood / manual inspection):
 *   node scripts/flow-logic-adversary.js prompt <plan-file> [--framing=<file>] [--task=<id>]
 *   node scripts/flow-logic-adversary.js validate <agent-response-file>
 *   node scripts/flow-logic-adversary.js rubric
 */

const _fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, safeJsonParse, readFile } = require('./flow-io');
const { getConfig } = require('./flow-config-loader');
const { info, error, color } = require('./flow-output');
const gateTelemetry = require('./flow-gate-telemetry');

// ============================================================
// Constants
// ============================================================

const RUBRIC_DIR = path.join(PATHS.workflow, 'rubrics');
const DEFAULT_RUBRIC = 'logic-constitution-v3';
const CALIBRATION_PATH = path.join(PATHS.state, 'adversary-calibration.json');
const PERSONAS_DIR = path.join(PATHS.workflow, 'agents', 'personas');

// Persona library — see .workflow/agents/personas/README.md
// Story: wf-258f558c (A2). Keys map to .md filenames (minus extension).
const PERSONA_LIBRARY = ['scale-skeptic', 'security-hawk', 'simplicity-champion', 'platform-rigor', 'user-advocate'];

// Trigger patterns — if the plan/title/taskId mentions any of these, auto-pick the persona.
// Order matters: earlier entries win when multiple triggers match.
const PERSONA_TRIGGERS = [
  { persona: 'security-hawk',      patterns: [/\bauth\b/i, /\bsecret\b/i, /\btoken\b/i, /\bcredential/i, /rm\s+-rf/i, /--force/i, /destructive/i, /\bshell\s+inject/i, /\bexecSync\b/, /\.env\b/] },
  { persona: 'platform-rigor',     patterns: [/\bPreToolUse\b/, /\bPostToolUse\b/, /\bSessionStart\b/, /\bMCP\b/, /\bsubagent\b/i, /\bvalidator\b/i, /\bvalidateTaskId\b/, /\bconfig\s+key\b/i] },
  { persona: 'scale-skeptic',      patterns: [/\bparallel\b/i, /\bconcurrent/i, /\bworktree/i, /\bdispatch/i, /\bqueue\b/i, /\bworker\b/i, /\brace\s+condition/i, /\bTOCTOU\b/i, /\bboundary\b/i] },
  { persona: 'user-advocate',      patterns: [/\bUI\b/, /\buser-facing\b/i, /\bonboarding/i, /\bjourney/i, /\berror\s+message/i, /\bempty\s+state/i, /\bcli\s+output/i] },
  { persona: 'simplicity-champion', patterns: [/\bframework\b/i, /\bpluggable/i, /\bfuture-proof/i, /\bextensibility/i, /\bgeneric\b/i, /\babstraction\b/i, /\brefactor\b/i] },
];

const VALID_OVERALL_VERDICTS = new Set([
  'PASS',
  'PASS_WITH_CONCERNS',
  'NEEDS_REVISION',
  'FAIL',
  'ERROR',
]);

const VALID_PRINCIPLE_VERDICTS = new Set(['PASS', 'CONCERN', 'FAIL', 'SKIP']);

/**
 * Intent artifacts the adversary references. Missing artifacts → degraded mode
 * (some principles SKIP instead of evaluating). See the rubric's degraded-mode
 * table for which principles require which artifact.
 */
const INTENT_ARTIFACTS = {
  productMd: path.join(PATHS.state, 'product.md'),
  domainModel: path.join(PATHS.state, 'domain-model.md'),
  glossary: path.join(PATHS.state, 'glossary.md'),
  userJourneys: path.join(PATHS.state, 'user-journeys.md'),
};

// ============================================================
// Rubric + calibration loaders
// ============================================================

/**
 * Load the Logic Constitution rubric by version identifier.
 * @param {string} [version='logic-constitution-v3']
 * @returns {{ content: string, version: string, path: string }}
 */
function loadRubric(version = DEFAULT_RUBRIC) {
  const rubricPath = path.join(RUBRIC_DIR, `${version}.md`);
  if (!fileExists(rubricPath)) {
    throw new Error(`Logic Constitution not found at ${rubricPath}`);
  }
  const content = readFile(rubricPath);
  return { content, version, path: rubricPath };
}

/**
 * Load calibration examples. Returns empty array if the file doesn't exist.
 * @returns {Array<{label:string, description:string, plan:string, expectedVerdict:object}>}
 */
function loadCalibration() {
  if (!fileExists(CALIBRATION_PATH)) return [];
  const parsed = safeJsonParse(CALIBRATION_PATH, { examples: [] });
  return Array.isArray(parsed.examples) ? parsed.examples : [];
}

// ============================================================
// Persona library (wf-258f558c / A2)
// ============================================================

function _getPersonasConfig() {
  const cfg = getConfig();
  return cfg.intentGroundedReasoning?.logicAdversary?.personas || cfg.adversary?.personas || {};
}

/**
 * Load a persona amplifier file.
 * @param {string} key - persona slug (must be in PERSONA_LIBRARY)
 * @returns {string} markdown content, or empty string when missing
 */
function loadPersona(key) {
  if (!key || !PERSONA_LIBRARY.includes(key)) return '';
  const p = path.join(PERSONAS_DIR, `${key}.md`);
  return fileExists(p) ? readFile(p) : '';
}

/**
 * Pick a persona based on plan/title content. Falls back to taskId-hash rotation.
 * @param {object} opts
 * @param {string} [opts.taskId]
 * @param {string} [opts.plan]
 * @param {string} [opts.title]
 * @returns {string} persona key (always one of PERSONA_LIBRARY)
 */
function pickPersona({ taskId, plan, title } = {}) {
  const haystack = [title || '', plan || ''].join('\n').slice(0, 4000);
  if (haystack.trim().length > 0) {
    for (const trigger of PERSONA_TRIGGERS) {
      for (const pattern of trigger.patterns) {
        if (pattern.test(haystack)) return trigger.persona;
      }
    }
  }
  // Rotate by taskId hash to ensure library coverage over time.
  const source = taskId || haystack || Date.now().toString();
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  return PERSONA_LIBRARY[h % PERSONA_LIBRARY.length];
}

// ============================================================
// Intent artifact detection
// ============================================================

/**
 * Return which intent artifacts exist (drives degraded-mode evaluation).
 * @returns {{ productMd:boolean, domainModel:boolean, glossary:boolean, userJourneys:boolean }}
 */
function detectIntentArtifacts() {
  const out = {};
  for (const [key, p] of Object.entries(INTENT_ARTIFACTS)) {
    out[key] = fileExists(p);
  }
  return out;
}

/**
 * Read intent artifact content (empty string when missing).
 */
function readIntentArtifact(key) {
  const p = INTENT_ARTIFACTS[key];
  if (!p || !fileExists(p)) return '';
  try {
    return readFile(p);
  } catch (_err) {
    return '';
  }
}

// ============================================================
// Prompt construction
// ============================================================

/**
 * Build the full prompt the orchestrating Claude passes to the Agent tool
 * when spawning the Logic Adversary sub-agent.
 *
 * @param {Object} opts
 * @param {string} opts.plan - The plan artifact (from Architect Pass) as markdown.
 * @param {string} [opts.framing] - The Framing Artifact (from Intent Framing Pass) as markdown.
 * @param {string} [opts.taskId]
 * @param {number} [opts.round=1] - Iteration round number (≥1).
 * @param {object} [opts.previousAdversaryOutput] - Prior round's parsed output when re-running.
 * @param {string} [opts.rubricVersion='logic-constitution-v3']
 * @param {number} [opts.calibrationCount=3] - How many calibration examples to inject.
 * @returns {{ systemPrompt:string, userPrompt:string, metadata:object }}
 */
function buildAdversaryPrompt(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('buildAdversaryPrompt: opts required');
  }
  if (!opts.plan || typeof opts.plan !== 'string') {
    throw new TypeError('buildAdversaryPrompt: opts.plan required (plan markdown string)');
  }

  // ARCH-004 fix (2026-04-13): disable-mode short-circuit — return empty prompt
  // when IGR or the adversary is disabled in config. Matches pattern in other IGR modules.
  const dis = isAdversaryDisabled();
  if (dis.disabled) {
    return {
      systemPrompt: '',
      userPrompt: '',
      metadata: {
        skipped: true,
        reason: dis.reason,
        taskId: opts.taskId || null,
        round: opts.round || 1,
      },
    };
  }

  const round = opts.round || 1;
  const rubricVersion = opts.rubricVersion || DEFAULT_RUBRIC;
  const calibrationCount = typeof opts.calibrationCount === 'number' ? opts.calibrationCount : 3;

  const rubric = loadRubric(rubricVersion);
  const calibration = loadCalibration().slice(0, calibrationCount);
  const artifacts = detectIntentArtifacts();
  const personaPath = path.join(PATHS.workflow, 'agents', 'logic-adversary.md');
  const personaContent = fileExists(personaPath) ? readFile(personaPath) : '';

  // Persona-library pick (wf-258f558c / A2). An amplification layer on top of the base persona.
  // Config toggle: adversary.personas.enabled (default true). Orchestrator may override via opts.persona.
  const personasEnabled = _getPersonasConfig().enabled !== false;
  const personaKey = personasEnabled
    ? (opts.persona || pickPersona({ taskId: opts.taskId, plan: opts.plan, title: opts.title }))
    : null;
  const amplifierContent = personaKey ? loadPersona(personaKey) : '';

  // System prompt — base persona + persona amplifier + rubric + calibration + degraded-mode notes
  const systemParts = [];
  systemParts.push(personaContent || '# Persona\nYou are the Logic Adversary. See the rubric below.');
  if (amplifierContent) {
    systemParts.push('\n# Persona amplifier (stacks on top of base persona)\n');
    systemParts.push(amplifierContent);
  }
  systemParts.push('\n# Rubric (Logic Constitution)\n');
  systemParts.push(rubric.content);

  if (calibration.length > 0) {
    systemParts.push('\n# Calibration — few-shot examples\n');
    systemParts.push(
      'These examples anchor verdict severity. Study them before evaluating the real plan.\n'
    );
    for (const ex of calibration) {
      systemParts.push(`## Example: ${ex.label}\n\n_${ex.description || ''}_\n`);
      systemParts.push('### Plan\n```markdown\n' + ex.plan + '\n```\n');
      systemParts.push(
        '### Expected verdict\n```json\n' +
          JSON.stringify(ex.expectedVerdict, null, 2) +
          '\n```\n'
      );
    }
  }

  systemParts.push('\n# Intent-artifact availability for this task\n');
  systemParts.push(
    Object.entries(artifacts)
      .map(([k, v]) => `- ${k}: ${v ? 'AVAILABLE' : 'MISSING (degraded mode for dependent principles)'}`)
      .join('\n')
  );

  // User prompt — the actual plan to critique + framing + prior round output
  const userParts = [];
  userParts.push(`# Task to evaluate\n`);
  userParts.push(`- Task ID: ${opts.taskId || '<unknown>'}`);
  userParts.push(`- Round: ${round}`);
  userParts.push(`- Rubric version: ${rubric.version}\n`);

  if (opts.framing) {
    userParts.push('## Framing Artifact\n');
    userParts.push('```markdown');
    userParts.push(opts.framing);
    userParts.push('```\n');
  } else {
    userParts.push('## Framing Artifact\n\n_(not available — Intent Framing Pass did not run or no artifact saved)_\n');
  }

  userParts.push('## Plan to critique\n');
  userParts.push('```markdown');
  userParts.push(opts.plan);
  userParts.push('```\n');

  // SEC-004 fix (2026-04-13): escape triple-backticks + cap length before
  // injecting arbitrary file content. A file line containing ``` could break
  // the fence boundary and allow injected content to escape its markdown block.
  const MAX_ARTIFACT_CHARS = 8000;
  const MAX_DECISIONS_CHARS = 12000;
  const MAX_CORRECTIONS_CHARS = 4000;
  const fenceSafe = (text, cap) => {
    let s = String(text || '').replace(/```/g, '`` `'); // break any fence occurrence
    if (s.length > cap) s = s.slice(0, cap) + '\n\n[... truncated at ' + cap + ' chars]';
    return s;
  };

  // Include intent artifacts inline (so the adversary isn't told to fetch them
  // via tools — reduces tool-use latency and keeps the adversary focused on reasoning)
  for (const [key, available] of Object.entries(artifacts)) {
    if (!available) continue;
    const content = readIntentArtifact(key);
    if (!content) continue;
    userParts.push(`## Intent artifact: ${key}\n`);
    userParts.push('```markdown');
    userParts.push(fenceSafe(content, MAX_ARTIFACT_CHARS));
    userParts.push('```\n');
  }

  // Also inject decisions.md and recent session-corrections (principle 5 inputs)
  const decisionsPath = PATHS.decisions;
  if (fileExists(decisionsPath)) {
    userParts.push('## decisions.md\n```markdown');
    userParts.push(fenceSafe(readFile(decisionsPath), MAX_DECISIONS_CHARS));
    userParts.push('```\n');
  }
  const correctionsPath = path.join(PATHS.state, 'session-corrections.json');
  if (fileExists(correctionsPath)) {
    userParts.push('## session-corrections.json\n```json');
    userParts.push(fenceSafe(readFile(correctionsPath), MAX_CORRECTIONS_CHARS));
    userParts.push('```\n');
  }

  if (round > 1 && opts.previousAdversaryOutput) {
    userParts.push('## Previous round output\n');
    userParts.push(
      'The plan has been revised in response to your prior critique. Re-evaluate ALL principles; a fix to one may create an issue on another. Indicate per principle whether the prior issue is RESOLVED, STILL_PRESENT, or NEWLY_INTRODUCED in the `evidence` field.\n'
    );
    userParts.push('```json');
    userParts.push(JSON.stringify(opts.previousAdversaryOutput, null, 2));
    userParts.push('```\n');
  }

  userParts.push(`
## Output
Return ONE JSON object matching the rubric's output schema exactly. No prose. No markdown fences.
All 10 principles must appear in the \`principles\` array, even if SKIPped.
`);

  return {
    systemPrompt: systemParts.join('\n'),
    userPrompt: userParts.join('\n'),
    metadata: {
      rubricVersion: rubric.version,
      round,
      calibrationExamples: calibration.length,
      intentArtifactsAvailable: Object.values(artifacts).filter(Boolean).length,
      intentArtifactsMissing: Object.values(artifacts).filter((v) => !v).length,
    },
  };
}

// ============================================================
// Response parsing + validation
// ============================================================

/**
 * Parse the adversary sub-agent's response. Accepts either a raw string that
 * is (or contains) JSON, or a pre-parsed object. Returns the validated verdict
 * object or an ERROR verdict if parsing/validation fails.
 *
 * @param {string|object} response
 * @param {Object} ctx
 * @param {string} [ctx.taskId]
 * @param {number} [ctx.round=1]
 * @param {string} [ctx.rubricVersion='logic-constitution-v3']
 * @returns {object} The validated adversary verdict.
 */
function parseAdversaryOutput(response, ctx = {}) {
  const defaults = {
    rubricVersion: ctx.rubricVersion || DEFAULT_RUBRIC,
    taskId: ctx.taskId || null,
    round: ctx.round || 1,
  };

  let parsed;

  if (response && typeof response === 'object' && !Array.isArray(response)) {
    parsed = response;
  } else if (typeof response === 'string') {
    parsed = tryExtractJson(response);
    if (!parsed) {
      return errorVerdict(defaults, 'Could not parse adversary response as JSON');
    }
  } else {
    return errorVerdict(defaults, 'Adversary response was neither object nor string');
  }

  // Validate structure
  if (!Array.isArray(parsed.principles)) {
    return errorVerdict(defaults, 'principles array missing from adversary response');
  }
  if (!VALID_OVERALL_VERDICTS.has(parsed.overallVerdict)) {
    return errorVerdict(defaults, `invalid overallVerdict: ${parsed.overallVerdict}`);
  }

  const principles = [];
  for (const p of parsed.principles) {
    if (!p || typeof p !== 'object') continue;
    if (!VALID_PRINCIPLE_VERDICTS.has(p.verdict)) continue;
    principles.push({
      id: p.id,
      name: String(p.name || '').slice(0, 120),
      verdict: p.verdict,
      evidence: String(p.evidence || '').slice(0, 500),
      issue: p.issue ? String(p.issue).slice(0, 300) : undefined,
      remedy: p.remedy ? String(p.remedy).slice(0, 300) : undefined,
    });
  }

  return {
    rubricVersion: parsed.rubricVersion || defaults.rubricVersion,
    taskId: parsed.taskId || defaults.taskId,
    round: typeof parsed.round === 'number' ? parsed.round : defaults.round,
    principles,
    overallVerdict: parsed.overallVerdict,
    criticalIssues: Array.isArray(parsed.criticalIssues)
      ? parsed.criticalIssues.slice(0, 5).map((s) => String(s).slice(0, 300))
      : [],
    questionsForUser: Array.isArray(parsed.questionsForUser)
      ? parsed.questionsForUser.slice(0, 5).map((s) => String(s).slice(0, 300))
      : [],
  };
}

function tryExtractJson(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (_err) {
    /* fall through */
  }
  // Try extracting the first {...} block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_err) {
    return null;
  }
}

function errorVerdict(defaults, reason) {
  return {
    rubricVersion: defaults.rubricVersion,
    taskId: defaults.taskId,
    round: defaults.round,
    principles: [],
    overallVerdict: 'ERROR',
    criticalIssues: [`Adversary parse error: ${reason}`],
    questionsForUser: [],
  };
}

// ============================================================
// Iteration policy
// ============================================================

/**
 * Decide whether to iterate based on the current verdict and config.
 * @param {object} verdict - Parsed adversary output.
 * @param {number} round - Current round (1-indexed).
 * @returns {{ shouldIterate:boolean, reason:string, nextRound:number }}
 */
function shouldIterate(verdict, round) {
  const config = getConfig();
  const adversaryConfig = config.intentGroundedReasoning?.logicAdversary || {};
  const maxRounds = typeof adversaryConfig.maxRounds === 'number' ? adversaryConfig.maxRounds : 3;

  if (verdict.overallVerdict === 'PASS' || verdict.overallVerdict === 'PASS_WITH_CONCERNS') {
    return { shouldIterate: false, reason: 'verdict-accepted', nextRound: round };
  }
  if (verdict.overallVerdict === 'ERROR') {
    return { shouldIterate: false, reason: 'adversary-errored', nextRound: round };
  }
  if (round >= maxRounds) {
    return { shouldIterate: false, reason: 'max-rounds-reached', nextRound: round };
  }
  return { shouldIterate: true, reason: 'needs-revision', nextRound: round + 1 };
}

// ============================================================
// Model selection
// ============================================================

/**
 * Decide which model the adversary should use given what the Architect used.
 * Per the approved spec: different model when both are available.
 *
 * @param {string} [architectModel] - Model id the Architect used.
 * @returns {string|null} Suggested model id, or null if config says 'same' / no preference.
 */
// CL-008 fix (2026-04-13): pairing table moved to config so model IDs stay
// current as new versions release. Defaults preserved as fallback.
// Updated 2026-04-16: Opus 4.7 is the new top tier; sonnet/haiku adversary upgraded.
const DEFAULT_MODEL_PAIRING = {
  opus: 'claude-sonnet-4-6',
  sonnet: 'claude-opus-4-7',
  haiku: 'claude-opus-4-7',
};

function selectAdversaryModel(architectModel) {
  const config = getConfig();
  const adversaryConfig = config.intentGroundedReasoning?.logicAdversary || {};
  const separation = adversaryConfig.modelSeparation || 'different-from-architect';

  if (separation === 'same' || !architectModel) return null;

  if (separation === 'different-from-architect') {
    const pairing = adversaryConfig.modelPairingTable || DEFAULT_MODEL_PAIRING;
    const lc = String(architectModel).toLowerCase();
    for (const [family, target] of Object.entries(pairing)) {
      if (lc.includes(family.toLowerCase())) return target;
    }
    return null;
  }

  // Explicit model id passed through
  return separation;
}

// ARCH-004 fix (2026-04-13): disable-mode short-circuit, matching the pattern
// used by flow-intent-framing, flow-architect-pass, flow-completion-truth-gate.
// Without this, disabling logicAdversary.enabled in config has no effect —
// buildAdversaryPrompt still loaded the rubric, calibration, and intent artifacts.
function isAdversaryDisabled() {
  const cfg = getConfig();
  const igr = cfg.intentGroundedReasoning || {};
  if (igr.enabled === false) return { disabled: true, reason: 'igr-disabled' };
  const adv = igr.logicAdversary || {};
  if (adv.enabled === false) return { disabled: true, reason: 'logic-adversary-disabled' };
  return { disabled: false };
}

// ============================================================
// Telemetry
// ============================================================

/**
 * Emit a gate-telemetry event for this adversary run.
 */
function recordTelemetry(verdict, runCtx = {}) {
  const findingCount = verdict.principles.filter(
    (p) => p.verdict === 'FAIL' || p.verdict === 'CONCERN'
  ).length;

  const findingSummary = verdict.principles
    .filter((p) => p.verdict !== 'PASS' && p.verdict !== 'SKIP')
    .slice(0, 10)
    .map((p) => `P${p.id} ${p.verdict}: ${(p.issue || '').slice(0, 120)}`);

  // Map overallVerdict → telemetry verdict dimension
  let telemetryVerdict;
  switch (verdict.overallVerdict) {
    case 'PASS':
      telemetryVerdict = 'PASS';
      break;
    case 'PASS_WITH_CONCERNS':
      telemetryVerdict = 'CONCERN';
      break;
    case 'NEEDS_REVISION':
    case 'FAIL':
      telemetryVerdict = 'FAIL';
      break;
    case 'ERROR':
    default:
      telemetryVerdict = 'ERROR';
  }

  // CL-002 fix (2026-04-13): runCtx.totalRoundsCompleted preferred over verdict.round.
  // verdict.round is the current round index; avgIterations in stats should reflect
  // TOTAL rounds the loop ran, not just the current round.
  const iterationsForTelemetry =
    typeof runCtx.totalRoundsCompleted === 'number' ? runCtx.totalRoundsCompleted : verdict.round;

  gateTelemetry.recordGateEvent({
    gateId: 'logic-adversary',
    gateVersion: verdict.rubricVersion,
    taskId: verdict.taskId,
    verdict: telemetryVerdict,
    findingCount,
    findingSummary,
    iterations: iterationsForTelemetry,
    durationMs: runCtx.durationMs,
    metadata: {
      architectModel: runCtx.architectModel || null,
      adversaryModel: runCtx.adversaryModel || null,
      currentRound: verdict.round,
      totalRoundsCompleted: runCtx.totalRoundsCompleted ?? null,
      skippedPrinciples: verdict.principles.filter((p) => p.verdict === 'SKIP').length,
      questionsForUser: verdict.questionsForUser?.length || 0,
      intentArtifactsMissing: runCtx.intentArtifactsMissing ?? null,
    },
  });
}

// ============================================================
// Render verdict for humans
// ============================================================

function renderVerdictForHuman(verdict) {
  const lines = [];
  const line = (s) => lines.push(s);

  line(color('bold', '━━━ LOGIC ADVERSARY ━━━'));
  line(`Task: ${verdict.taskId || '—'}`);
  line(`Rubric: ${verdict.rubricVersion}`);
  line(`Round: ${verdict.round}`);
  line('');

  for (const p of verdict.principles) {
    const tag = p.verdict === 'PASS' ? 'PASS' : p.verdict === 'SKIP' ? 'SKIP' : p.verdict;
    line(`[${tag}] P${p.id}: ${p.name}`);
    if (p.evidence) line(`    evidence: ${p.evidence}`);
    if (p.issue) line(`    issue:    ${p.issue}`);
    if (p.remedy) line(`    remedy:   ${p.remedy}`);
  }
  line('');
  line(`Overall: ${verdict.overallVerdict}`);
  if (verdict.criticalIssues?.length) {
    line('Critical issues:');
    verdict.criticalIssues.forEach((ci) => line(`  - ${ci}`));
  }
  if (verdict.questionsForUser?.length) {
    line('Questions for user:');
    verdict.questionsForUser.forEach((q) => line(`  ? ${q}`));
  }
  line('━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

// ARCH-002 fix (2026-04-13): use shared parseArgs from flow-cli-utils
const { parseArgs } = require('./flow-cli-utils');

function cliPrompt(argv) {
  const args = parseArgs(argv);
  const planFile = args._[0];
  if (!planFile) {
    error('Usage: flow-logic-adversary prompt <plan-file> [--framing=<file>] [--task=<id>]');
    process.exit(2);
  }
  if (!fileExists(planFile)) {
    error(`Plan file not found: ${planFile}`);
    process.exit(2);
  }
  const plan = readFile(planFile);
  const framing = args.framing && fileExists(args.framing) ? readFile(args.framing) : null;
  const built = buildAdversaryPrompt({
    plan,
    framing,
    taskId: args.task || path.basename(planFile, path.extname(planFile)),
    round: Number(args.round) || 1,
    rubricVersion: args.rubric || DEFAULT_RUBRIC,
  });
  console.log('===== SYSTEM PROMPT =====');
  console.log(built.systemPrompt);
  console.log('\n===== USER PROMPT =====');
  console.log(built.userPrompt);
  console.log('\n===== METADATA =====');
  console.log(JSON.stringify(built.metadata, null, 2));
}

function cliValidate(argv) {
  const args = parseArgs(argv);
  const responseFile = args._[0];
  if (!responseFile) {
    error('Usage: flow-logic-adversary validate <agent-response-file>');
    process.exit(2);
  }
  if (!fileExists(responseFile)) {
    error(`Response file not found: ${responseFile}`);
    process.exit(2);
  }
  const raw = readFile(responseFile);
  const parsed = parseAdversaryOutput(raw, { taskId: args.task || null });
  console.log(renderVerdictForHuman(parsed));
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(parsed, null, 2));
}

function cliRubric() {
  const r = loadRubric();
  info(`Rubric: ${r.version}\nPath:   ${r.path}\n`);
  console.log(r.content);
}

// ============================================================
// Main
// ============================================================

if (require.main === module) {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'prompt':
      cliPrompt(rest);
      break;
    case 'validate':
      cliValidate(rest);
      break;
    case 'rubric':
      cliRubric();
      break;
    default:
      console.log(`Usage: node scripts/flow-logic-adversary.js <command> [options]

Commands:
  prompt <plan-file> [--framing=<f>] [--task=<id>] [--round=N] [--rubric=<ver>]
    Build the adversary prompt for a plan. Prints system + user prompts + metadata.

  validate <response-file> [--task=<id>]
    Parse and validate an adversary JSON response. Prints human-readable summary.

  rubric
    Print the active Logic Constitution rubric.
`);
  }
}

module.exports = {
  buildAdversaryPrompt,
  parseAdversaryOutput,
  shouldIterate,
  selectAdversaryModel,
  recordTelemetry,
  renderVerdictForHuman,
  loadRubric,
  loadCalibration,
  detectIntentArtifacts,
  isAdversaryDisabled,
  INTENT_ARTIFACTS,
  VALID_OVERALL_VERDICTS,
  VALID_PRINCIPLE_VERDICTS,
  DEFAULT_RUBRIC,
  DEFAULT_MODEL_PAIRING,
  pickPersona,
  loadPersona,
  PERSONA_LIBRARY,
  PERSONA_TRIGGERS,
};
