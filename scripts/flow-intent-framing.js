#!/usr/bin/env node

/**
 * Wogi Flow - Intent Framing Pass
 *
 * IGR Stage 2 building blocks. This module assembles a structured framing
 * prompt the orchestrating Claude reflects against, parses the resulting
 * artifact, gates the pipeline on remaining ambiguities, and persists the
 * framing artifact for downstream consumers (Adversary, Architect).
 *
 * Per spec §2.2 Stage 2: "A single, short-lived reasoning pass (NOT a
 * sub-agent — same context, structured prompt)." This script does NOT
 * spawn a sub-agent. It builds the prompt; the orchestrator reflects.
 *
 * Story: wf-5c024cc2 (IGR Stage 2)
 * Epic: wf-b00262b1 (IGR)
 *
 * Reuses (no parallel implementations):
 *   - flow-context-orchestrator.js → getTargetedContext()
 *   - flow-task-analyzer.js        → analyzeTask()
 *   - flow-correction-detector.js  → getSessionCorrections()
 *   - flow-prompt-capture.js       → capturePrompt() (audit log to prompt-history.json)
 *   - flow-gate-telemetry.js       → recordGateEvent()
 *
 * Usage (programmatic):
 *   const { buildFramingPrompt, parseFramingArtifact, evaluateFramingGate,
 *           saveFramingArtifact, loadFramingArtifact, recordTelemetry } =
 *     require('./flow-intent-framing');
 *
 * CLI:
 *   node scripts/flow-intent-framing.js prompt <task-input-file> [--task=ID]
 *   node scripts/flow-intent-framing.js validate <artifact-file>
 *   node scripts/flow-intent-framing.js gate <artifact-file>
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, ensureDir, readFile } = require('./flow-io');
const { getConfig } = require('./flow-config-loader');
const { color, warn, error } = require('./flow-output');

const gateTelemetry = require('./flow-gate-telemetry');

// ============================================================
// Constants
// ============================================================

const FRAMING_DIR = path.join(PATHS.state, 'framing');
const REQUEST_LOG_PATH = path.join(PATHS.state, 'request-log.md');

// Section identifiers in the artifact (PINs)
const REQUIRED_PINS = [
  'ask',
  'interpretation',
  'concepts',
  'ambiguities-resolved',
  'ambiguities-remaining',
  'journeys',
  'prior-corrections',
  'scope',
  'questions',
];

const DEFAULT_REQUEST_LOG_ENTRIES = 10;
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_STALE_HOURS = 24;

// ============================================================
// Disabled-mode short-circuit
// ============================================================

function isFramingDisabled() {
  const cfg = getConfig();
  const igr = cfg.intentGroundedReasoning || {};
  if (igr.enabled === false) return { disabled: true, reason: 'igr-disabled' };
  const fr = igr.intentFraming || {};
  if (fr.enabled === false) return { disabled: true, reason: 'framing-disabled' };
  return { disabled: false };
}

// ============================================================
// Input assembly — reuse existing context machinery
// ============================================================

/**
 * Read the most recent N entries from request-log.md.
 * Per spec §2.2 — required Framing input.
 *
 * @param {number} [n=10]
 * @returns {string[]} Entry blocks (most recent first)
 */
function readRecentRequestLog(n = DEFAULT_REQUEST_LOG_ENTRIES) {
  if (!fileExists(REQUEST_LOG_PATH)) return [];
  let content;
  try {
    content = readFile(REQUEST_LOG_PATH);
  } catch (_err) {
    return [];
  }

  // Entries start with "### R-NNN" headers. Split on those headers.
  const parts = content.split(/^###\s+R-/m).slice(1); // first split is preamble
  const entries = parts.map((p) => '### R-' + p.trim()).filter((s) => s.length > 0);
  return entries.slice(-n).reverse(); // newest first, capped
}

/**
 * Assemble all inputs for the framing prompt.
 * Returns a structured object — caller composes the final prompt string.
 */
async function assembleFramingInputs({ taskId, taskInput }) {
  const out = {
    taskId,
    taskInput,
    productContext: null,
    targetedContext: null,
    taskAnalysis: null,
    sessionCorrections: [],
    requestLogEntries: [],
    intentArtifactsAvailable: 0,
    intentArtifactsMissing: 0,
    sessionId: null,
  };

  // 1. Task analysis (complexity, domains, languages)
  try {
    const { analyzeTask } = require('./flow-task-analyzer');
    out.taskAnalysis = analyzeTask({ description: taskInput, type: 'feature' });
  } catch (err) {
    warn(`framing: analyzeTask failed: ${err.message}`);
  }

  // 2. Targeted context (product + intent artifacts via PINs)
  try {
    const orch = require('./flow-context-orchestrator');
    out.targetedContext = await orch.getTargetedContext({
      task: taskInput,
      maxTokens: DEFAULT_MAX_TOKENS,
      includeProduct: true,
      format: 'summary',
    });
  } catch (err) {
    warn(`framing: getTargetedContext failed: ${err.message}`);
  }

  // 3. Session corrections (Story 3)
  try {
    const corrDet = require('./flow-correction-detector');
    out.sessionId = corrDet.deriveSessionId();
    out.sessionCorrections = corrDet.getSessionCorrections(out.sessionId);
  } catch (err) {
    warn(`framing: getSessionCorrections failed: ${err.message}`);
  }

  // 4. Request log (last 10 entries) — per spec §2.2
  out.requestLogEntries = readRecentRequestLog(DEFAULT_REQUEST_LOG_ENTRIES);

  // 5. Intent-artifact availability count (for Adversary downstream telemetry)
  const ARTIFACTS = ['product.md', 'domain-model.md', 'glossary.md', 'user-journeys.md'];
  for (const a of ARTIFACTS) {
    if (fileExists(path.join(PATHS.state, a))) out.intentArtifactsAvailable++;
    else out.intentArtifactsMissing++;
  }

  return out;
}

// ============================================================
// Prompt building
// ============================================================

/**
 * Build the structured framing prompt the orchestrating Claude reflects against.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.taskInput - The raw user message / task description.
 * @param {number} [opts.framingRound=1]
 * @returns {Promise<{ systemPrompt: string, userPrompt: string, metadata: Object }>}
 */
async function buildFramingPrompt(opts) {
  if (!opts || !opts.taskInput) {
    throw new TypeError('buildFramingPrompt: opts.taskInput required');
  }
  const taskId = opts.taskId || 'unscoped';
  const round = opts.framingRound || 1;

  // Disabled short-circuit
  const dis = isFramingDisabled();
  if (dis.disabled) {
    return {
      systemPrompt: '',
      userPrompt: '',
      metadata: { skipped: true, reason: dis.reason, taskId, round },
    };
  }

  const inputs = await assembleFramingInputs({ taskId, taskInput: opts.taskInput });

  // Per spec §2.2: log to prompt-history.json for post-hoc audit
  try {
    const { capturePrompt } = require('./flow-prompt-capture');
    capturePrompt(opts.taskInput, {
      taskId,
      taskTitle: `framing-pass:${taskId}`,
      sessionId: inputs.sessionId,
      source: 'intent-framing',
    });
  } catch (err) {
    warn(`framing: prompt-history capture failed: ${err.message}`);
  }

  const systemParts = [];
  systemParts.push('# Intent Framing Pass — Orchestrator Self-Reflection\n');
  systemParts.push(
    `You are reflecting on a task BEFORE asking the user clarifying questions and BEFORE generating a spec. Your job is to interpret what is actually being asked in the context of THIS project, identify which product concepts the task touches, resolve ambiguous terms against the available intent artifacts, and surface what genuinely cannot be resolved without asking.\n`
  );
  systemParts.push(
    'Produce a Framing Artifact in markdown matching the structure shown below. Every required PIN section MUST appear, even if empty (use a placeholder line). Do not invent content for sections you cannot fill from the available inputs.\n'
  );
  systemParts.push(`\n## Required artifact structure\n`);
  systemParts.push(buildArtifactTemplate(taskId));

  const userParts = [];
  userParts.push(`# Task to frame\n`);
  userParts.push(`- Task ID: ${taskId}`);
  userParts.push(`- Round: ${round}`);
  userParts.push(`- Session ID: ${inputs.sessionId || '(none)'}`);
  userParts.push(`- Intent artifacts available: ${inputs.intentArtifactsAvailable} / 4\n`);

  userParts.push('## User ask (verbatim)\n');
  userParts.push('```\n' + opts.taskInput + '\n```\n');

  if (inputs.taskAnalysis) {
    userParts.push('## Task analysis hints (auto-detected)');
    // analyzeTask returns shapes that vary by version — defensively coerce.
    // Known shapes: { primary, all, count } (domains/languages),
    // { score, level } (complexity), or plain string/array.
    const summarize = (v) => {
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      if (typeof v === 'object') {
        // Prefer common detail fields when present
        if (Array.isArray(v.all)) {
          // v.all may be array of strings OR array of objects with .name
          return v.all
            .map((it) => (typeof it === 'string' ? it : it && it.name ? it.name : JSON.stringify(it)))
            .join(', ');
        }
        if (typeof v.primary === 'string') return v.primary;
        if (typeof v.level === 'string') return v.level;
        if (typeof v.score === 'number') return `score=${v.score}`;
        // Last resort: short JSON preview, capped to 80 chars
        const j = JSON.stringify(v);
        return j.length > 80 ? j.slice(0, 77) + '...' : j;
      }
      return String(v);
    };
    const complexity = summarize(inputs.taskAnalysis.complexity) || 'unknown';
    const domains = summarize(inputs.taskAnalysis.domains) || 'unspecified';
    const languages = summarize(inputs.taskAnalysis.languages) || 'unspecified';
    userParts.push(
      `- Complexity: ${complexity}\n- Domains: ${domains}\n- Languages: ${languages}\n`
    );
  }

  if (inputs.targetedContext && inputs.targetedContext.context) {
    userParts.push('## Project context (intent artifacts + relevant sections)\n');
    userParts.push(inputs.targetedContext.context);
  } else {
    userParts.push(
      '## Project context\n\n_(targeted context unavailable — degraded mode; answer from task input alone)_\n'
    );
  }

  if (inputs.sessionCorrections.length > 0) {
    userParts.push('\n## Prior session corrections that apply');
    userParts.push(
      'These were corrections the user gave earlier in THIS session. Any proposal that contradicts them is a logic failure.\n'
    );
    for (const c of inputs.sessionCorrections.slice(0, 10)) {
      userParts.push(`- [${c.correctionType || 'correction'}] ${c.durableRule || c.whatUserWants || c.prompt || '(no rule)'}`);
    }
  } else {
    userParts.push('\n## Prior session corrections that apply\n\n_(none)_\n');
  }

  if (inputs.requestLogEntries.length > 0) {
    userParts.push('\n## Recent project history (last ' + inputs.requestLogEntries.length + ' request-log entries)');
    userParts.push('```markdown');
    userParts.push(inputs.requestLogEntries.join('\n\n').slice(0, 6000));
    userParts.push('```');
  } else {
    userParts.push('\n## Recent project history\n\n_(no request-log entries available)_\n');
  }

  userParts.push(`
## Output

Return ONE markdown document matching the required artifact structure exactly. Use the PIN comment markers shown. Do not wrap in code fences. All required PINs (${REQUIRED_PINS.join(', ')}) must appear. If a section is empty, write a single placeholder line (e.g., "_(none)_").
`);

  return {
    systemPrompt: systemParts.join('\n'),
    userPrompt: userParts.join('\n'),
    metadata: {
      taskId,
      round,
      sessionId: inputs.sessionId,
      intentArtifactsAvailable: inputs.intentArtifactsAvailable,
      intentArtifactsMissing: inputs.intentArtifactsMissing,
      sessionCorrectionsCount: inputs.sessionCorrections.length,
      requestLogEntriesCount: inputs.requestLogEntries.length,
      hasTargetedContext: !!inputs.targetedContext?.context,
      taskAnalysisComplexity: inputs.taskAnalysis?.complexity || null,
    },
  };
}

function buildArtifactTemplate(taskId) {
  return `\`\`\`markdown
<!-- PINS: ask, interpretation, concepts, ambiguities-resolved, ambiguities-remaining, journeys, prior-corrections, scope, questions -->
<!-- artifactKind: framing -->
<!-- taskId: ${taskId} -->
<!-- generatedAt: <ISO> -->

# Framing — ${taskId}

## Ask (verbatim)
<!-- PIN: ask -->
<the user's literal message>

## What I think is actually being asked
<!-- PIN: interpretation -->
<1–3 sentences in your own words>

## Product concepts this task touches
<!-- PIN: concepts -->
- <concept> — <role in this task>

## Ambiguous terms detected
<!-- PIN: ambiguities-resolved -->
| Term | Appears as | Resolved to | Why |
| ---- | ---------- | ----------- | --- |
| ...  | ...        | ...         | ... |

## Remaining ambiguities
<!-- PIN: ambiguities-remaining -->
- <items the framing could not resolve from available context>

## User journeys affected
<!-- PIN: journeys -->
- <journey> — <how this task changes it>

## Prior-session corrections that apply
<!-- PIN: prior-corrections -->
- <relevant correction (or "_(none)_")>

## My initial read of the scope
<!-- PIN: scope -->
<one-paragraph scope statement>

## Questions I would ask if not auto-proceeding
<!-- PIN: questions -->
- <questions>
\`\`\``;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse a Framing Artifact (markdown) into a structured object.
 * Validates required PIN sections.
 *
 * @param {string} text - The markdown artifact.
 * @returns {{ valid: boolean, artifact: Object|null, errors: string[] }}
 */
function parseFramingArtifact(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, artifact: null, errors: ['empty input'] };
  }

  // ARCH-003 fix (2026-04-13): use shared parser from flow-cli-utils
  const { sections, errors } = parsePinSections(text, REQUIRED_PINS);
  if (errors.length > 0) {
    return { valid: false, artifact: null, errors };
  }

  // Extract metadata header values
  const taskIdMatch = text.match(/<!--\s*taskId:\s*([\w-]+)\s*-->/);
  const generatedAtMatch = text.match(/<!--\s*generatedAt:\s*([^>]+?)\s*-->/);

  // Heuristic parse for "remaining ambiguities" and "questions"
  const remainingAmbiguitiesItems = parseListItems(sections['ambiguities-remaining']);
  const questionsItems = parseListItems(sections.questions);
  const conceptsItems = parseListItems(sections.concepts);
  const journeysItems = parseListItems(sections.journeys);
  const priorCorrectionsItems = parseListItems(sections['prior-corrections']);

  return {
    valid: true,
    errors: [],
    artifact: {
      taskId: taskIdMatch ? taskIdMatch[1] : null,
      generatedAt: generatedAtMatch ? generatedAtMatch[1] : null,
      sections,
      ask: sections.ask || '',
      interpretation: sections.interpretation || '',
      concepts: conceptsItems,
      ambiguitiesResolved: sections['ambiguities-resolved'] || '',
      remainingAmbiguities: remainingAmbiguitiesItems,
      journeys: journeysItems,
      priorCorrections: priorCorrectionsItems,
      scope: sections.scope || '',
      questions: questionsItems,
    },
  };
}

// parseListItems moved to flow-cli-utils (ARCH-003 / CL-001 fix 2026-04-13)

// ============================================================
// Gate evaluation
// ============================================================

/**
 * Evaluate the Framing Gate against a parsed artifact.
 * Per AC14: returns { verdict, shouldBlock, reasons }.
 *
 * @param {Object} artifact - From parseFramingArtifact.artifact
 * @returns {{ verdict: 'PASS'|'CONCERN'|'FAIL', shouldBlock: boolean, reasons: string[] }}
 */
function evaluateFramingGate(artifact) {
  if (!artifact) {
    return { verdict: 'FAIL', shouldBlock: true, reasons: ['no artifact'] };
  }

  const reasons = [];

  // Hard FAIL: interpretation missing or trivially short
  const interp = (artifact.interpretation || '').trim();
  if (!interp || interp.length < 30) {
    reasons.push('interpretation empty or trivially short (≥30 chars required)');
    return { verdict: 'FAIL', shouldBlock: true, reasons };
  }

  // CONCERN: remaining ambiguities present → surface, but allow proceed-anyway
  if (artifact.remainingAmbiguities && artifact.remainingAmbiguities.length > 0) {
    reasons.push(
      `${artifact.remainingAmbiguities.length} unresolved ambiguity${artifact.remainingAmbiguities.length > 1 ? 'ies' : ''} remaining`
    );
    return { verdict: 'CONCERN', shouldBlock: false, reasons };
  }

  // CONCERN: structural emptiness of all enrichment fields when artifacts are available
  const enrichmentEmpty =
    artifact.concepts.length === 0 &&
    artifact.journeys.length === 0 &&
    artifact.priorCorrections.length === 0;
  if (enrichmentEmpty) {
    reasons.push(
      'concepts, journeys, and prior-corrections sections all empty — framing may be incomplete'
    );
    return { verdict: 'CONCERN', shouldBlock: false, reasons };
  }

  return { verdict: 'PASS', shouldBlock: false, reasons: [] };
}

// ============================================================
// Persistence
// ============================================================

function saveFramingArtifact(taskId, artifactText) {
  if (!taskId) throw new TypeError('saveFramingArtifact: taskId required');
  ensureDir(FRAMING_DIR);
  const p = path.join(FRAMING_DIR, `${taskId}.md`);
  // Inject generatedAt if not present
  let toWrite = artifactText;
  if (!/<!--\s*generatedAt:/.test(toWrite)) {
    toWrite = toWrite.replace(
      /<!--\s*taskId:/,
      `<!-- generatedAt: ${new Date().toISOString()} -->\n<!-- taskId:`
    );
  }
  fs.writeFileSync(p, toWrite, 'utf-8');
  return p;
}

function loadFramingArtifact(taskId, options = {}) {
  if (!taskId) return null;
  const maxAgeHours = typeof options.maxAgeHours === 'number' ? options.maxAgeHours : DEFAULT_STALE_HOURS;
  const p = path.join(FRAMING_DIR, `${taskId}.md`);
  if (!fileExists(p)) return null;

  let stat;
  try {
    stat = fs.statSync(p);
  } catch (_err) {
    return null;
  }

  if (maxAgeHours > 0) {
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > maxAgeHours * 3600 * 1000) {
      return { stale: true, path: p, ageMs };
    }
  }

  let content;
  try {
    content = fs.readFileSync(p, 'utf-8');
  } catch (_err) {
    return null;
  }

  return { stale: false, path: p, content };
}

// ============================================================
// Telemetry
// ============================================================

function recordTelemetry({ taskId, verdict, gateResult, parseResult, runCtx = {} }) {
  let telemetryVerdict;
  if (parseResult && !parseResult.valid) {
    telemetryVerdict = 'FAIL';
  } else if (gateResult) {
    telemetryVerdict = gateResult.verdict;
  } else {
    telemetryVerdict = verdict || 'PASS';
  }

  const findingCount = gateResult?.reasons?.length || 0;

  gateTelemetry.recordGateEvent({
    gateId: 'intent-framing',
    gateVersion: '1.0',
    taskId,
    verdict: telemetryVerdict,
    findingCount,
    findingSummary: gateResult?.reasons?.slice(0, 10) || [],
    durationMs: runCtx.durationMs,
    metadata: {
      intentArtifactsAvailable: runCtx.intentArtifactsAvailable ?? null,
      intentArtifactsMissing: runCtx.intentArtifactsMissing ?? null,
      sessionCorrectionsCount: runCtx.sessionCorrectionsCount ?? null,
      requestLogEntriesCount: runCtx.requestLogEntriesCount ?? null,
      remainingAmbiguities: parseResult?.artifact?.remainingAmbiguities?.length ?? null,
      sectionsFilled: parseResult?.artifact
        ? {
            ask: !!parseResult.artifact.ask,
            interpretation: !!parseResult.artifact.interpretation,
            concepts: parseResult.artifact.concepts.length,
            journeys: parseResult.artifact.journeys.length,
          }
        : null,
    },
  });
}

// ============================================================
// Human rendering
// ============================================================

function renderArtifactSummary(parseResult, gateResult) {
  const lines = [];
  lines.push(color('bold', '━━━ Framing Artifact ━━━'));
  if (!parseResult || !parseResult.valid) {
    lines.push(color('red', 'PARSE FAILED'));
    for (const e of parseResult?.errors || []) lines.push('  - ' + e);
    return lines.join('\n');
  }
  const a = parseResult.artifact;
  lines.push(`Task: ${a.taskId || '(unknown)'}`);
  lines.push(`Generated: ${a.generatedAt || '(no timestamp)'}`);
  lines.push('');
  lines.push(color('bold', 'Interpretation:'));
  lines.push('  ' + a.interpretation);
  lines.push('');
  lines.push(`Concepts (${a.concepts.length}):`);
  for (const c of a.concepts.slice(0, 5)) lines.push('  - ' + c);
  if (a.concepts.length > 5) lines.push(`  ...and ${a.concepts.length - 5} more`);
  lines.push('');
  lines.push(`Remaining ambiguities (${a.remainingAmbiguities.length}):`);
  for (const r of a.remainingAmbiguities.slice(0, 5)) lines.push('  ! ' + r);
  lines.push('');
  lines.push(`Journeys affected: ${a.journeys.length}, Prior corrections: ${a.priorCorrections.length}, Questions: ${a.questions.length}`);
  lines.push('');
  if (gateResult) {
    const tag = gateResult.verdict;
    lines.push(color('bold', `Gate verdict: ${tag} (shouldBlock=${gateResult.shouldBlock})`));
    for (const r of gateResult.reasons) lines.push('  - ' + r);
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

// ARCH-002 + ARCH-003 fix (2026-04-13): use shared utilities from flow-cli-utils
const { parseArgs, parsePinSections, parseListItems } = require('./flow-cli-utils');

async function cliPrompt(argv) {
  const args = parseArgs(argv);
  const inputFile = args._[0];
  if (!inputFile) {
    error('Usage: flow-intent-framing prompt <task-input-file> [--task=ID]');
    process.exit(2);
  }
  if (!fileExists(inputFile)) {
    error(`Input file not found: ${inputFile}`);
    process.exit(2);
  }
  const taskInput = readFile(inputFile);
  const built = await buildFramingPrompt({
    taskId: args.task || path.basename(inputFile, path.extname(inputFile)),
    taskInput,
    framingRound: Number(args.round) || 1,
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
  const file = args._[0];
  if (!file) {
    error('Usage: flow-intent-framing validate <artifact-file>');
    process.exit(2);
  }
  const content = readFile(file);
  const parsed = parseFramingArtifact(content);
  const gate = parsed.valid ? evaluateFramingGate(parsed.artifact) : null;
  console.log(renderArtifactSummary(parsed, gate));
  if (!parsed.valid) process.exit(1);
}

function cliGate(argv) {
  const args = parseArgs(argv);
  const file = args._[0];
  if (!file) {
    error('Usage: flow-intent-framing gate <artifact-file>');
    process.exit(2);
  }
  const content = readFile(file);
  const parsed = parseFramingArtifact(content);
  if (!parsed.valid) {
    console.log(JSON.stringify({ verdict: 'FAIL', shouldBlock: true, reasons: parsed.errors }, null, 2));
    process.exit(1);
  }
  const gate = evaluateFramingGate(parsed.artifact);
  console.log(JSON.stringify(gate, null, 2));
  if (gate.shouldBlock) process.exit(1);
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
    case 'gate':
      cliGate(rest);
      break;
    default:
      console.log(`Usage: node scripts/flow-intent-framing.js <command> [options]

Commands:
  prompt <task-input-file> [--task=ID] [--round=N]    Build framing prompt
  validate <artifact-file>                            Parse + summarize artifact
  gate <artifact-file>                                Evaluate gate, exit non-zero if shouldBlock
`);
  }
}

module.exports = {
  buildFramingPrompt,
  parseFramingArtifact,
  evaluateFramingGate,
  saveFramingArtifact,
  loadFramingArtifact,
  recordTelemetry,
  readRecentRequestLog,
  assembleFramingInputs,
  isFramingDisabled,
  REQUIRED_PINS,
  FRAMING_DIR,
  DEFAULT_STALE_HOURS,
};
