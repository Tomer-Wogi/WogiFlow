#!/usr/bin/env node

/**
 * Wogi Flow - Architect Pass
 *
 * IGR Stage 3 building blocks. The Architect is a READ-ONLY sub-agent
 * (separate context from the orchestrator) that produces a structured
 * pre-spec plan in markdown. Inspired by Aider's architect/coder split.
 *
 * Per spec §2.2 Stage 3: the Architect is a sub-agent. This script does
 * NOT spawn the sub-agent — it builds the prompt, parses the response,
 * validates structure, persists the artifact, and emits telemetry. The
 * orchestrator drives the Agent tool call when /wogi-start Step 1.55 fires
 * (Story 7 wires that integration).
 *
 * Story: wf-4d3e8d3e (IGR Stage 3)
 * Epic: wf-b00262b1 (IGR)
 *
 * Reuses (no parallel implementations):
 *   - flow-context-orchestrator.js → getTargetedContext()
 *   - flow-intent-framing.js       → loadFramingArtifact()
 *   - flow-logic-adversary.js      → loadRubric() (the Logic Constitution)
 *   - flow-correction-detector.js  → deriveSessionId()
 *   - flow-gate-telemetry.js       → recordGateEvent()
 *
 * Persona: .workflow/agents/architect.md
 *
 * Usage (programmatic):
 *   const { buildArchitectPrompt, parsePlanArtifact, evaluateArchitectGate,
 *           savePlanArtifact, loadPlanArtifact, recordTelemetry } =
 *     require('./flow-architect-pass');
 *
 * CLI:
 *   node scripts/flow-architect-pass.js prompt <task-input-file> [--task=ID]
 *   node scripts/flow-architect-pass.js validate <plan-file>
 *   node scripts/flow-architect-pass.js gate <plan-file>
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, ensureDir, readFile } = require('./flow-io');
const { getConfig } = require('./flow-config-loader');
const { color, info, warn, error } = require('./flow-output');

const gateTelemetry = require('./flow-gate-telemetry');

// ============================================================
// Constants
// ============================================================

const PLANS_DIR = path.join(PATHS.workflow, 'plans');
const PERSONA_PATH = path.join(PATHS.workflow, 'agents', 'architect.md');

// Match spec §2.2 Stage 3 — exactly 8 sections (R2 fix removed unauthorized 9th)
const REQUIRED_PINS = [
  'approach',
  'data-model',
  'journey-impact',
  'net-new',
  'alternatives',
  'risks',
  'reversibility',
  'dependencies',
];

// Truncation priority — least-important first per plan §2 (R2 addition)
const TRUNCATION_PRIORITY = [
  'alternatives',
  'risks',
  'dependencies',
  'journey-impact',
  'data-model',
  'net-new',
  'reversibility',
  'approach',
];

const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_STALE_HOURS = 24;

// ============================================================
// Disabled-mode short-circuit
// ============================================================

function isArchitectDisabled() {
  const cfg = getConfig();
  const igr = cfg.intentGroundedReasoning || {};
  if (igr.enabled === false) return { disabled: true, reason: 'igr-disabled' };
  const ap = igr.architectPass || {};
  if (ap.enabled === false) return { disabled: true, reason: 'architect-disabled' };
  return { disabled: false };
}

// ============================================================
// Prompt building
// ============================================================

/**
 * Build the Architect sub-agent prompt.
 *
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.taskInput - Raw user task description.
 * @param {string} [opts.framing] - Framing artifact content. If absent, attempts to load via loadFramingArtifact.
 * @param {string} [opts.exploreFindings] - Consolidated explore-phase findings.
 * @param {string} [opts.scopeConfidenceAudit] - Optional per spec §2.2; degraded mode if absent.
 * @param {string} [opts.constitutionVersion='logic-constitution-v3']
 * @returns {Promise<{ systemPrompt:string, userPrompt:string, metadata:Object }>}
 */
async function buildArchitectPrompt(opts) {
  if (!opts || !opts.taskId) {
    throw new TypeError('buildArchitectPrompt: opts.taskId required');
  }
  const taskId = opts.taskId;
  const constitutionVersion = opts.constitutionVersion || 'logic-constitution-v3';

  const dis = isArchitectDisabled();
  if (dis.disabled) {
    return {
      systemPrompt: '',
      userPrompt: '',
      metadata: { skipped: true, reason: dis.reason, taskId },
    };
  }

  // 1. Load persona
  const persona = fileExists(PERSONA_PATH)
    ? readFile(PERSONA_PATH)
    : '# Persona\nYou are the Architect — read-only sub-agent producing a pre-spec plan. See the rubric below.';

  // 2. Load Logic Constitution (so Architect anticipates Adversary)
  let constitution = '';
  try {
    const adv = require('./flow-logic-adversary');
    constitution = adv.loadRubric(constitutionVersion).content;
  } catch (err) {
    warn(`architect: could not load constitution ${constitutionVersion}: ${err.message}`);
  }

  // 3. Load Framing artifact (Story 4 output) if not provided directly
  let framingContent = opts.framing || '';
  let framingAvailable = !!framingContent;
  if (!framingContent) {
    try {
      const framing = require('./flow-intent-framing');
      const loaded = framing.loadFramingArtifact(taskId, { maxAgeHours: DEFAULT_STALE_HOURS });
      if (loaded && !loaded.stale && loaded.content) {
        framingContent = loaded.content;
        framingAvailable = true;
      }
    } catch (_err) {
      /* fall through — degraded mode */
    }
  }

  // 4. Targeted context (intent artifacts via PINs)
  let targetedContext = null;
  try {
    const orch = require('./flow-context-orchestrator');
    targetedContext = await orch.getTargetedContext({
      task: opts.taskInput || '',
      maxTokens: DEFAULT_MAX_TOKENS,
      includeProduct: true,
      format: 'summary',
    });
  } catch (err) {
    warn(`architect: getTargetedContext failed: ${err.message}`);
  }

  // 5. Session ID for traceability
  let sessionId = null;
  try {
    sessionId = require('./flow-correction-detector').deriveSessionId();
  } catch (_err) {
    /* no-op */
  }

  // ---- Compose the prompts ----
  const systemParts = [];
  systemParts.push(persona);
  systemParts.push('\n# Logic Constitution v1 (the rubric the Adversary will judge your plan against)\n');
  systemParts.push(constitution || '_(constitution not loaded — produce a defensive plan)_');

  const userParts = [];
  userParts.push(`# Task to plan\n`);
  userParts.push(`- Task ID: ${taskId}`);
  userParts.push(`- Session: ${sessionId || '(none)'}`);
  userParts.push(`- Framing artifact: ${framingAvailable ? 'available' : 'NOT available — proceed from task description alone'}`);
  userParts.push(`- Scope-confidence audit: ${opts.scopeConfidenceAudit ? 'available' : 'NOT available (degraded mode per spec §2.2)'}\n`);

  userParts.push('## User task (verbatim)\n');
  userParts.push('```\n' + (opts.taskInput || '_(empty — no task description provided)_') + '\n```\n');

  if (framingAvailable) {
    userParts.push('## Framing Artifact\n');
    userParts.push('```markdown');
    userParts.push(framingContent);
    userParts.push('```\n');
  }

  if (opts.exploreFindings) {
    userParts.push('## Explore phase findings\n');
    userParts.push('```markdown');
    userParts.push(opts.exploreFindings);
    userParts.push('```\n');
  } else {
    userParts.push('## Explore phase findings\n\n_(none provided — work from task + framing alone)_\n');
  }

  if (opts.scopeConfidenceAudit) {
    userParts.push('## Scope-confidence audit results\n');
    userParts.push('```markdown');
    userParts.push(opts.scopeConfidenceAudit);
    userParts.push('```\n');
  }

  if (targetedContext && targetedContext.context) {
    userParts.push('## Project context (intent artifacts + relevant sections)\n');
    userParts.push(targetedContext.context);
  }

  userParts.push(`
## Output

Produce ONE markdown document matching the structure in the system prompt EXACTLY. All 8 required PINs (${REQUIRED_PINS.join(', ')}) must appear. Use \`_(none)_\` placeholders for genuinely empty sections — do NOT invent content. Save your reasoning, not your style. The Adversary will critique this against the Logic Constitution.
`);

  return {
    systemPrompt: systemParts.join('\n'),
    userPrompt: userParts.join('\n'),
    metadata: {
      taskId,
      sessionId,
      constitutionVersion,
      constitutionLoaded: !!constitution,
      framingAvailable,
      scopeConfidenceAvailable: !!opts.scopeConfidenceAudit,
      exploreFindingsProvided: !!opts.exploreFindings,
      hasTargetedContext: !!targetedContext?.context,
    },
  };
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse a Plan Artifact (markdown) into a structured object.
 * Validates required PIN sections.
 *
 * @param {string} text
 * @returns {{ valid:boolean, plan:Object|null, errors:string[] }}
 */
function parsePlanArtifact(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, plan: null, errors: ['empty input'] };
  }

  // ARCH-003 fix (2026-04-13): use shared parser from flow-cli-utils
  const { sections, errors } = parsePinSections(text, REQUIRED_PINS);
  if (errors.length > 0) {
    return { valid: false, plan: null, errors };
  }

  // Heuristic: detect code blocks with language tags (violates persona's no-code rule)
  const codeBlockMatches = text.match(/```[a-zA-Z][\w-]*\n[\s\S]*?\n```/g) || [];
  const containsCode = codeBlockMatches.length > 0;

  // Header metadata
  const taskIdMatch = text.match(/<!--\s*taskId:\s*([\w-]+)\s*-->/);
  const generatedAtMatch = text.match(/<!--\s*generatedAt:\s*([^>]+?)\s*-->/);

  // Per-section enrichment
  const netNewItems = parseListItems(sections['net-new']);
  const alternativesItems = parseTableRows(sections.alternatives);
  const risksItems = parseListItems(sections.risks);
  const dataModelItems = parseListItems(sections['data-model']);
  const journeyItems = parseListItems(sections['journey-impact']);

  return {
    valid: true,
    errors: [],
    plan: {
      taskId: taskIdMatch ? taskIdMatch[1] : null,
      generatedAt: generatedAtMatch ? generatedAtMatch[1] : null,
      sections,
      approach: sections.approach || '',
      dataModel: dataModelItems,
      journeyImpact: journeyItems,
      netNew: netNewItems,
      alternatives: alternativesItems,
      risks: risksItems,
      reversibility: sections.reversibility || '',
      dependencies: sections.dependencies || '',
      containsCode,
      codeBlockCount: codeBlockMatches.length,
    },
  };
}

// parseListItems moved to flow-cli-utils (ARCH-003 / CL-001 fix 2026-04-13)

function parseTableRows(block) {
  if (!block) return [];
  const rows = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue; // separator row
    if (/^\|\s*Alternative/i.test(line)) continue; // header
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length >= 2 && cells[0] && cells[1] && cells[0] !== '...') {
      rows.push({ alternative: cells[0], rejectedBecause: cells[1] });
    }
  }
  return rows;
}

// ============================================================
// Gate evaluation
// ============================================================

/**
 * Evaluate the Architect Gate against a parsed plan.
 *
 * @param {Object} plan - From parsePlanArtifact.plan
 * @returns {{ verdict:'PASS'|'CONCERN'|'FAIL', shouldBlock:boolean, reasons:string[] }}
 */
function evaluateArchitectGate(plan) {
  if (!plan) {
    return { verdict: 'FAIL', shouldBlock: true, reasons: ['no plan'] };
  }

  const reasons = [];
  let verdict = 'PASS';

  // FAIL: approach is missing or trivially short (must be 2-5 paragraphs)
  const approach = (plan.approach || '').trim();
  if (!approach || approach.length < 80) {
    return {
      verdict: 'FAIL',
      shouldBlock: true,
      reasons: ['approach section missing or too short (minimum 80 chars)'],
    };
  }

  // FAIL: reversibility section missing or empty
  if (!plan.reversibility || plan.reversibility.trim().length < 10) {
    return {
      verdict: 'FAIL',
      shouldBlock: true,
      reasons: ['reversibility section missing or empty'],
    };
  }

  // CONCERN: contains code blocks (violates persona's no-code rule)
  if (plan.containsCode) {
    reasons.push(`contains ${plan.codeBlockCount} code block(s) — Architect should produce concept-level reasoning, not code`);
    verdict = 'CONCERN';
  }

  // CONCERN: alternatives section is empty (the Adversary's principle 2 will catch unjustified scope)
  if (plan.alternatives.length === 0) {
    reasons.push('alternatives section empty — every plan should consider at least one rejected option');
    verdict = 'CONCERN';
  }

  // CONCERN: data-model AND journey-impact AND risks all empty (likely incomplete)
  const enrichmentEmpty =
    plan.dataModel.length === 0 &&
    plan.journeyImpact.length === 0 &&
    plan.risks.length === 0;
  if (enrichmentEmpty) {
    reasons.push('data-model, journey-impact, and risks all empty — plan may be too thin');
    verdict = 'CONCERN';
  }

  // Net-new being empty is the EXPECTED case — do NOT flag as concern.

  return { verdict, shouldBlock: false, reasons };
}

// ============================================================
// Persistence
// ============================================================

function savePlanArtifact(taskId, planText) {
  if (!taskId) throw new TypeError('savePlanArtifact: taskId required');
  ensureDir(PLANS_DIR);
  const p = path.join(PLANS_DIR, `${taskId}.md`);
  // Inject generatedAt if not present
  let toWrite = planText;
  if (!/<!--\s*generatedAt:/.test(toWrite)) {
    toWrite = toWrite.replace(
      /<!--\s*taskId:/,
      `<!-- generatedAt: ${new Date().toISOString()} -->\n<!-- taskId:`
    );
  }
  fs.writeFileSync(p, toWrite, 'utf-8');
  return p;
}

function loadPlanArtifact(taskId, options = {}) {
  if (!taskId) return null;
  const maxAgeHours =
    typeof options.maxAgeHours === 'number' ? options.maxAgeHours : DEFAULT_STALE_HOURS;
  const p = path.join(PLANS_DIR, `${taskId}.md`);
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

function recordTelemetry({ taskId, parseResult, gateResult, runCtx = {} }) {
  let telemetryVerdict;
  if (parseResult && !parseResult.valid) {
    telemetryVerdict = 'FAIL';
  } else if (gateResult) {
    telemetryVerdict = gateResult.verdict;
  } else {
    telemetryVerdict = 'PASS';
  }

  const findingCount = gateResult?.reasons?.length || 0;
  const sectionsPresent = parseResult?.plan?.sections
    ? Object.keys(parseResult.plan.sections).filter((k) => REQUIRED_PINS.includes(k)).length
    : 0;

  gateTelemetry.recordGateEvent({
    gateId: 'architect-pass',
    gateVersion: '1.0',
    taskId,
    verdict: telemetryVerdict,
    findingCount,
    findingSummary: gateResult?.reasons?.slice(0, 10) || [],
    durationMs: runCtx.durationMs,
    metadata: {
      sectionsPresent, // Should be 8 when valid
      requiredSections: REQUIRED_PINS.length,
      netNewConceptsCount: parseResult?.plan?.netNew?.length ?? null,
      alternativesConsideredCount: parseResult?.plan?.alternatives?.length ?? null,
      risksCount: parseResult?.plan?.risks?.length ?? null,
      dataModelTouchpoints: parseResult?.plan?.dataModel?.length ?? null,
      containsCode: parseResult?.plan?.containsCode ?? null,
      framingArtifactAvailable: runCtx.framingAvailable ?? null,
      scopeConfidenceAvailable: runCtx.scopeConfidenceAvailable ?? null,
      constitutionVersion: runCtx.constitutionVersion || null,
      truncatedSections: runCtx.truncatedSections || [],
      sessionId: runCtx.sessionId ?? null,
    },
  });
}

// ============================================================
// Human rendering
// ============================================================

function renderPlanSummary(parseResult, gateResult) {
  const lines = [];
  lines.push(color('bold', '━━━ Architect Plan ━━━'));
  if (!parseResult || !parseResult.valid) {
    lines.push(color('red', 'PARSE FAILED'));
    for (const e of parseResult?.errors || []) lines.push('  - ' + e);
    return lines.join('\n');
  }
  const p = parseResult.plan;
  lines.push(`Task: ${p.taskId || '(unknown)'}`);
  lines.push(`Generated: ${p.generatedAt || '(no timestamp)'}`);
  lines.push('');
  lines.push(color('bold', 'Approach (excerpt):'));
  lines.push('  ' + (p.approach.slice(0, 200) + (p.approach.length > 200 ? '...' : '')));
  lines.push('');
  lines.push(`Data-model touchpoints: ${p.dataModel.length}`);
  lines.push(`Journey impacts: ${p.journeyImpact.length}`);
  lines.push(`Net-new concepts: ${p.netNew.length} (empty is expected)`);
  lines.push(`Alternatives considered: ${p.alternatives.length}`);
  lines.push(`Risks: ${p.risks.length}`);
  lines.push(`Code blocks: ${p.codeBlockCount}${p.containsCode ? color('yellow', ' [CONCERN]') : ''}`);
  lines.push('');
  if (gateResult) {
    lines.push(color('bold', `Gate verdict: ${gateResult.verdict} (shouldBlock=${gateResult.shouldBlock})`));
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
    error('Usage: flow-architect-pass prompt <task-input-file> [--task=ID]');
    process.exit(2);
  }
  if (!fileExists(inputFile)) {
    error(`Input file not found: ${inputFile}`);
    process.exit(2);
  }
  const taskInput = readFile(inputFile);
  const built = await buildArchitectPrompt({
    taskId: args.task || path.basename(inputFile, path.extname(inputFile)),
    taskInput,
    constitutionVersion: args.rubric || 'logic-constitution-v3',
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
    error('Usage: flow-architect-pass validate <plan-file>');
    process.exit(2);
  }
  const content = readFile(file);
  const parsed = parsePlanArtifact(content);
  const gate = parsed.valid ? evaluateArchitectGate(parsed.plan) : null;
  console.log(renderPlanSummary(parsed, gate));
  if (!parsed.valid) process.exit(1);
}

function cliGate(argv) {
  const args = parseArgs(argv);
  const file = args._[0];
  if (!file) {
    error('Usage: flow-architect-pass gate <plan-file>');
    process.exit(2);
  }
  const content = readFile(file);
  const parsed = parsePlanArtifact(content);
  if (!parsed.valid) {
    console.log(JSON.stringify({ verdict: 'FAIL', shouldBlock: true, reasons: parsed.errors }, null, 2));
    process.exit(1);
  }
  const gate = evaluateArchitectGate(parsed.plan);
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
      console.log(`Usage: node scripts/flow-architect-pass.js <command> [options]

Commands:
  prompt <task-input-file> [--task=ID] [--rubric=ver]    Build architect prompt
  validate <plan-file>                                   Parse + summarize plan
  gate <plan-file>                                       Evaluate gate, exit non-zero if shouldBlock
`);
  }
}

module.exports = {
  buildArchitectPrompt,
  parsePlanArtifact,
  evaluateArchitectGate,
  savePlanArtifact,
  loadPlanArtifact,
  recordTelemetry,
  isArchitectDisabled,
  REQUIRED_PINS,
  TRUNCATION_PRIORITY,
  PLANS_DIR,
  PERSONA_PATH,
};
