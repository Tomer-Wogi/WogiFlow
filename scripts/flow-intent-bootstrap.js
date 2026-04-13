#!/usr/bin/env node

/**
 * Wogi Flow - Intent Bootstrap
 *
 * Orchestrates the generation of the 4 intent artifacts that every subsequent
 * IGR stage consumes:
 *
 *   .workflow/state/product.md
 *   .workflow/state/domain-model.md
 *   .workflow/state/user-journeys.md
 *   .workflow/state/glossary.md
 *
 * Pipeline:
 *   1. Collect signals (package.json, README, Prisma schemas, TS types, routes)
 *   2. Run trap-zone detector for glossary.md's Trap Zone section
 *   3. Render templates from templates/intent/ with collected data
 *   4. Write to .workflow/state/ (skip files that already exist unless --force)
 *   5. Update .workflow/state/igr-bootstrap-state.json
 *   6. Emit gate-telemetry event
 *
 * Story: wf-c5198406 (IGR Stage 1)
 * Epic: wf-b00262b1 (IGR)
 *
 * Usage:
 *   const { bootstrap } = require('./flow-intent-bootstrap');
 *   const result = bootstrap({ autoConfirm: false });
 *
 * CLI:
 *   node scripts/flow-intent-bootstrap.js                  # interactive
 *   node scripts/flow-intent-bootstrap.js --auto-confirm   # non-interactive
 *   node scripts/flow-intent-bootstrap.js --force          # overwrite existing artifacts
 *   node scripts/flow-intent-bootstrap.js status           # show bootstrap state
 *   node scripts/flow-intent-bootstrap.js refresh          # re-scan, three-way merge
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./flow-paths');
const { fileExists, safeJsonParse, ensureDir } = require('./flow-io');
const { info, success, warn, error, color } = require('./flow-output');
const { detectTrapZones } = require('./flow-trap-zone');
const gateTelemetry = require('./flow-gate-telemetry');

// ============================================================
// Constants
// ============================================================

const ARTIFACT_PATHS = {
  product: path.join(PATHS.state, 'product.md'),
  domainModel: path.join(PATHS.state, 'domain-model.md'),
  userJourneys: path.join(PATHS.state, 'user-journeys.md'),
  glossary: path.join(PATHS.state, 'glossary.md'),
};

const BOOTSTRAP_STATE_PATH = path.join(PATHS.state, 'igr-bootstrap-state.json');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates', 'intent');

const TEMPLATE_FILES = {
  product: 'product.md.hbs',
  domainModel: 'domain-model.md.hbs',
  userJourneys: 'user-journeys.md.hbs',
  glossary: 'glossary.md.hbs',
};

// ============================================================
// Public API
// ============================================================

/**
 * Run the full bootstrap.
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - Overwrite existing artifacts.
 * @param {string} [options.taskId] - Task context for telemetry.
 * @returns {Object} Result: { artifactsCreated, artifactsSkipped, trapZoneCount, durationMs, verdict }
 *
 * CL-004 fix (2026-04-13): removed unused `autoConfirm` parameter — bootstrap
 * is non-interactive today (drafts are reviewed at /wogi-session-end per Option C).
 */
function bootstrap(options = {}) {
  const start = Date.now();
  const force = !!options.force;

  const signals = collectSignals();
  let trapZoneReport;
  try {
    trapZoneReport = detectTrapZones({ root: PATHS.root });
  } catch (err) {
    warn(`Trap-zone detector failed: ${err.message}`);
    trapZoneReport = { scanned: { files: 0, declarations: 0, skippedFiles: 0 }, trapZones: [] };
  }

  const renderCtx = {
    projectName: signals.projectName,
    description: signals.description,
    reviewStatus: 'draft',
    lastAutoUpdated: new Date().toISOString(),
    schemaFormat: signals.schemaFormat,
    filesScanned: trapZoneReport.scanned.files,
    entities: signals.entities,
    enums: signals.enums,
    journeys: signals.journeys,
    entryPoints: signals.entryPoints,
    signals: signals.summary,
    autoDetectedSignals: signals.bulletList,
    trapZones: trapZoneReport.trapZones.map((tz) => ({
      term: tz.term,
      occurrences: tz.occurrences.map((o) => ({
        kind: o.kind,
        file: o.file,
        line: o.line,
        fieldCount: o.fieldCount,
        fieldSample: o.fieldSample.join(', '),
        truncated: o.fieldCount > o.fieldSample.length,
      })),
    })),
    scanned: trapZoneReport.scanned,
  };

  const artifactsCreated = [];
  const artifactsSkipped = [];
  const artifactsFailed = [];

  for (const [key, targetPath] of Object.entries(ARTIFACT_PATHS)) {
    if (fileExists(targetPath) && !force) {
      artifactsSkipped.push({ key, path: targetPath, reason: 'exists' });
      continue;
    }
    try {
      const templatePath = path.join(TEMPLATE_DIR, TEMPLATE_FILES[key]);
      if (!fileExists(templatePath)) {
        artifactsFailed.push({ key, path: targetPath, reason: `template not found: ${templatePath}` });
        continue;
      }
      const template = fs.readFileSync(templatePath, 'utf-8');
      const rendered = renderTemplate(template, renderCtx);
      ensureDir(PATHS.state);
      fs.writeFileSync(targetPath, rendered, 'utf-8');
      artifactsCreated.push({ key, path: targetPath });
    } catch (err) {
      artifactsFailed.push({ key, path: targetPath, reason: err.message });
    }
  }

  // Update bootstrap state
  const state = readBootstrapState();
  state.lastRun = new Date().toISOString();
  state.lastRunOutcome = artifactsFailed.length > 0 ? 'partial' : 'success';
  state.lastRunError = artifactsFailed.length > 0 ? artifactsFailed[0].reason : null;
  state.bootstrappedAt = state.bootstrappedAt || new Date().toISOString();
  state.artifactsCreated = artifactsCreated.map((a) => a.key);
  state.skipCounter = 0; // reset skip counter on successful or partial bootstrap
  writeBootstrapState(state);

  const durationMs = Date.now() - start;

  // Telemetry
  const verdict =
    artifactsFailed.length === 0
      ? 'PASS'
      : artifactsCreated.length > 0
        ? 'CONCERN'
        : 'FAIL';

  gateTelemetry.recordGateEvent({
    gateId: 'intent-bootstrap',
    gateVersion: '1.0',
    taskId: options.taskId || null,
    verdict,
    findingCount: trapZoneReport.trapZones.length,
    findingSummary: trapZoneReport.trapZones.slice(0, 10).map((tz) => tz.term),
    durationMs,
    metadata: {
      artifactsCreated: artifactsCreated.map((a) => a.key),
      artifactsSkipped: artifactsSkipped.map((a) => a.key),
      artifactsFailed: artifactsFailed.map((a) => ({ key: a.key, reason: a.reason })),
      schemaFormat: signals.schemaFormat,
      scanFiles: trapZoneReport.scanned.files,
      declarationsFound: trapZoneReport.scanned.declarations,
    },
  });

  return {
    artifactsCreated,
    artifactsSkipped,
    artifactsFailed,
    trapZoneCount: trapZoneReport.trapZones.length,
    trapZones: trapZoneReport.trapZones,
    durationMs,
    verdict,
    signals,
  };
}

/**
 * Increment the "skip now" counter when user declines bootstrap at first-run.
 * @returns {{ skipCounter: number, deferredIndefinitely: boolean }}
 */
function recordSkip() {
  const state = readBootstrapState();
  state.skipCounter = (state.skipCounter || 0) + 1;
  state.lastSkipAt = new Date().toISOString();
  if (state.skipCounter >= 3) {
    state.userDeferredIndefinitely = true;
  }
  writeBootstrapState(state);
  return {
    skipCounter: state.skipCounter,
    deferredIndefinitely: !!state.userDeferredIndefinitely,
  };
}

/**
 * Has this project been bootstrapped (at least partially)?
 */
function isBootstrapped() {
  const state = readBootstrapState();
  return !!state.bootstrappedAt;
}

/**
 * Has the user deferred bootstrap indefinitely (3+ skips)?
 */
function isDeferredIndefinitely() {
  const state = readBootstrapState();
  return !!state.userDeferredIndefinitely;
}

/**
 * Read the bootstrap state file with safe fallback.
 */
function readBootstrapState() {
  const state = safeJsonParse(BOOTSTRAP_STATE_PATH, {
    bootstrappedAt: null,
    lastRun: null,
    skipCounter: 0,
    userDeferredIndefinitely: false,
    artifactsCreated: [],
  });
  // CL-007 fix (2026-04-13): migrate legacy misspelling `bootstrapedAt` (single p)
  // to the correctly-spelled `bootstrappedAt`. Fallback is read-only — we do not
  // rewrite the file here; the next writeBootstrapState call emits the correct key.
  if (state && state.bootstrapedAt && !state.bootstrappedAt) {
    state.bootstrappedAt = state.bootstrapedAt;
    delete state.bootstrapedAt;
  }
  return state;
}

function writeBootstrapState(state) {
  ensureDir(PATHS.state);
  fs.writeFileSync(BOOTSTRAP_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// ============================================================
// Signal collection
// ============================================================

/**
 * Gather inputs needed to render the 4 artifact templates.
 */
function collectSignals() {
  const out = {
    projectName: path.basename(PATHS.root),
    description: '',
    schemaFormat: 'none',
    entities: [],
    enums: [],
    journeys: [],
    entryPoints: [],
    summary: '',
    bulletList: [],
  };

  // package.json
  const pkgPath = path.join(PATHS.root, 'package.json');
  if (fileExists(pkgPath)) {
    const pkg = safeJsonParse(pkgPath, {});
    if (pkg.name) out.projectName = pkg.name;
    if (pkg.description) out.description = pkg.description;
    if (pkg.name) out.bulletList.push(`package.json name: ${pkg.name}`);
    if (pkg.description) out.bulletList.push(`package.json description: ${pkg.description}`);
  }

  // README
  const readme = findReadme(PATHS.root);
  if (readme) {
    out.bulletList.push(`README found: ${path.relative(PATHS.root, readme)}`);
    if (!out.description) {
      out.description = extractReadmeSummary(readme);
    }
  }

  // Schema detection
  const prismaFiles = findFilesByPattern(PATHS.root, /\.prisma$/, 10);
  const tsFiles = findFilesByPattern(PATHS.root, /\.tsx?$/, 5);

  if (prismaFiles.length > 0) {
    out.schemaFormat = 'prisma';
    out.bulletList.push(`Prisma schema(s) found: ${prismaFiles.length}`);
  } else if (tsFiles.length > 0) {
    out.schemaFormat = 'typescript';
    out.bulletList.push(`TypeScript sources found: ${tsFiles.length}+`);
  }

  // Entity extraction (piggyback on the trap-zone detector's parsers)
  const { parsePrisma, parseTypeScript } = require('./flow-trap-zone');
  const entityMap = new Map();
  const enumMap = new Map();

  for (const file of prismaFiles) {
    for (const decl of parsePrisma(file)) {
      const key = `${decl.kind}:${decl.name}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: decl.name,
          kind: decl.kind,
          file: path.relative(PATHS.root, decl.file),
          line: decl.line,
          fieldCount: decl.fields.length,
          fieldSample: decl.fields.slice(0, 6).join(', '),
          truncated: decl.fields.length > 6,
        });
      }
    }
    // Also pick up enums
    const prismaSource = fs.readFileSync(file, 'utf-8');
    const enumRe = /\benum\s+(\w+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = enumRe.exec(prismaSource)) !== null) {
      const values = m[2]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'));
      enumMap.set(m[1], {
        name: m[1],
        values: values.slice(0, 8).join(', '),
        file: path.relative(PATHS.root, file),
        line: prismaSource.slice(0, m.index).split('\n').length,
      });
    }
  }

  // TS entity extraction — cap at 15 representative entities
  if (entityMap.size === 0 && tsFiles.length > 0) {
    for (const file of tsFiles) {
      for (const decl of parseTypeScript(file)) {
        const key = `${decl.kind}:${decl.name}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: decl.name,
            kind: decl.kind,
            file: path.relative(PATHS.root, decl.file),
            line: decl.line,
            fieldCount: decl.fields.length,
            fieldSample: decl.fields.slice(0, 6).join(', '),
            truncated: decl.fields.length > 6,
          });
          if (entityMap.size >= 15) break;
        }
      }
      if (entityMap.size >= 15) break;
    }
  }

  out.entities = [...entityMap.values()].slice(0, 20);
  out.enums = [...enumMap.values()].slice(0, 10);

  // Journey / entry-point heuristics
  out.entryPoints = findEntryPointCandidates(PATHS.root);
  out.journeys = []; // MVP: leave empty for user to fill; heuristics here are too lossy to be useful

  out.summary = `${out.schemaFormat} schema, ${out.entities.length} entities, ${out.entryPoints.length} entry-point candidates`;
  return out;
}

function findReadme(root) {
  for (const name of ['README.md', 'Readme.md', 'readme.md', 'README.markdown']) {
    const p = path.join(root, name);
    if (fileExists(p)) return p;
  }
  return null;
}

function extractReadmeSummary(readmePath) {
  try {
    const content = fs.readFileSync(readmePath, 'utf-8');
    // First non-heading, non-empty paragraph
    const lines = content.split('\n');
    let buffer = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        if (buffer) return buffer.slice(0, 240);
        continue;
      }
      if (line.startsWith('#') || line.startsWith('<') || line.startsWith('!')) continue;
      buffer += (buffer ? ' ' : '') + line;
      if (buffer.length > 240) return buffer.slice(0, 240);
    }
    return buffer.slice(0, 240);
  } catch (_err) {
    return '';
  }
}

function findFilesByPattern(root, pattern, cap) {
  const results = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.workflow', '.claude', 'generated', '__generated__']);
  (function walk(dir) {
    if (results.length >= cap) return;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_err) {
      return;
    }
    for (const entry of entries) {
      if (results.length >= cap) return;
      if (skip.has(entry) || entry.startsWith('.git')) continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_err) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry)) {
        results.push(full);
      }
    }
  })(root);
  return results;
}

function findEntryPointCandidates(root) {
  const candidates = [];
  // Common entry-point patterns: controllers, routes, pages, app.tsx
  const patterns = [
    { dir: 'src/pages', label: 'page', max: 6 },
    { dir: 'pages', label: 'page', max: 6 },
    { dir: 'src/app', label: 'app-route', max: 6 },
    { dir: 'src/controllers', label: 'controller', max: 6 },
    { dir: 'src/modules', label: 'module', max: 8 },
    { dir: 'src/routes', label: 'route', max: 6 },
    { dir: 'packages', label: 'package', max: 6 },
  ];
  for (const p of patterns) {
    const full = path.join(root, p.dir);
    try {
      if (!fs.existsSync(full)) continue;
      const entries = fs.readdirSync(full);
      for (const e of entries.slice(0, p.max)) {
        if (e.startsWith('.') || e.startsWith('_')) continue;
        candidates.push(`${p.dir}/${e} (${p.label})`);
      }
    } catch (_err) {
      /* skip */
    }
  }
  return candidates.slice(0, 15);
}

// ============================================================
// Template rendering (minimal Handlebars-like)
// ============================================================

/**
 * Minimal template renderer — supports {{var}}, {{#if var}}...{{else}}...{{/if}},
 * {{#each array}}...{{/each}} with dot-free identifiers. Sufficient for our templates.
 * Not a full Handlebars; dependency-free intentionally.
 */
function renderTemplate(template, ctx) {
  return render(template, ctx);
}

function render(template, ctx) {
  let output = template;
  // Iteratively process blocks innermost-first.
  // Negative lookahead (?!\{\{#(each|if)) ensures the matched body contains no nested
  // opening block — so we match only the innermost each/if, render it, then the next
  // pass sees the outer block as flat and matches it.
  let prev;
  let guard = 0;
  do {
    prev = output;
    guard++;
    // Innermost {{#each}}
    output = output.replace(
      /\{\{#each\s+([\w.]+)\}\}((?:(?!\{\{#each\s)[\s\S])*?)\{\{\/each\}\}/g,
      (_m, key, body) => {
        const arr = getByPath(ctx, key);
        if (!Array.isArray(arr) || arr.length === 0) return '';
        return arr
          .map((item) =>
            render(body, {
              ...ctx,
              ...(typeof item === 'object' ? item : { this: item }),
              this: item,
            })
          )
          .join('');
      }
    );
    // Innermost {{#if}} / {{else}}
    output = output.replace(
      /\{\{#if\s+([\w.]+)\}\}((?:(?!\{\{#if\s)[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if\s)[\s\S])*?))?\{\{\/if\}\}/g,
      (_m, key, thenBody, elseBody) => {
        const val = getByPath(ctx, key);
        const truthy = Array.isArray(val) ? val.length > 0 : !!val;
        return truthy ? thenBody : elseBody || '';
      }
    );
    if (guard > 10) break; // Safety: never loop forever on malformed templates
  } while (output !== prev);

  // Variable substitution (last, after all blocks resolved)
  output = output.replace(/\{\{([\w.]+)\}\}/g, (_m, key) => {
    const val = getByPath(ctx, key);
    if (val === undefined || val === null) return '';
    return String(val);
  });
  return output;
}

// SEC-003 fix (2026-04-13): block __proto__/constructor/prototype traversal
// per security-patterns.md §3. Template keys come from regex-extracted strings
// in .hbs files; an attacker-controlled template (or a codebase field literally
// named __proto__) could otherwise walk the prototype chain.
const DANGEROUS_TEMPLATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function getByPath(obj, keyPath) {
  if (keyPath === 'this') return obj.this;
  const parts = keyPath.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (DANGEROUS_TEMPLATE_KEYS.has(part)) return undefined;
    // Use hasOwnProperty to avoid inherited-property traversal even on untagged parts
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ============================================================
// Rendering for humans
// ============================================================

function renderBootstrapResult(result) {
  const lines = [];
  lines.push(color('bold', '━━━ Intent Bootstrap ━━━'));
  lines.push(`Verdict: ${result.verdict}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  lines.push('');
  if (result.artifactsCreated.length > 0) {
    lines.push(color('green', 'Created:'));
    for (const a of result.artifactsCreated) lines.push(`  + ${path.relative(PATHS.root, a.path)}`);
  }
  if (result.artifactsSkipped.length > 0) {
    lines.push(color('yellow', 'Skipped (already exists; use --force to overwrite):'));
    for (const a of result.artifactsSkipped) lines.push(`  - ${path.relative(PATHS.root, a.path)}`);
  }
  if (result.artifactsFailed.length > 0) {
    lines.push(color('red', 'Failed:'));
    for (const a of result.artifactsFailed) lines.push(`  ! ${path.relative(PATHS.root, a.path)} — ${a.reason}`);
  }
  lines.push('');
  lines.push(`Trap zones detected: ${result.trapZoneCount}`);
  if (result.trapZoneCount > 0) {
    lines.push('  Top terms:');
    for (const tz of result.trapZones.slice(0, 5)) lines.push(`    - ${tz.term} (${tz.occurrences.length} occurrences)`);
  }
  lines.push('');
  lines.push(color('bold', 'Next step:'));
  lines.push('  Review the drafts in .workflow/state/:');
  for (const key of ['product', 'domainModel', 'userJourneys', 'glossary']) {
    lines.push(`    ${path.relative(PATHS.root, ARTIFACT_PATHS[key])}`);
  }
  lines.push('  Replace [CONFIRM] markers. Flip `reviewStatus: "draft"` → `"confirmed"` in each file header when done.');
  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

// ARCH-002 fix (2026-04-13): use shared parseArgs from flow-cli-utils
const { parseArgs } = require('./flow-cli-utils');

function cliBootstrap(argv) {
  const args = parseArgs(argv);
  const result = bootstrap({
    autoConfirm: !!args['auto-confirm'],
    force: !!args.force,
    taskId: args.task || null,
  });
  console.log(renderBootstrapResult(result));
  process.exit(result.verdict === 'FAIL' ? 1 : 0);
}

function cliStatus() {
  const state = readBootstrapState();
  console.log(color('bold', '━━━ IGR Bootstrap Status ━━━'));
  console.log(`Bootstrapped at: ${state.bootstrappedAt || 'never'}`);
  console.log(`Last run: ${state.lastRun || 'never'} (outcome: ${state.lastRunOutcome || 'n/a'})`);
  console.log(`Skip counter: ${state.skipCounter || 0}`);
  console.log(`Deferred indefinitely: ${state.userDeferredIndefinitely ? 'yes' : 'no'}`);
  console.log(`Artifacts on disk:`);
  for (const [key, p] of Object.entries(ARTIFACT_PATHS)) {
    console.log(`  ${fileExists(p) ? '✓' : '✗'}  ${key}: ${path.relative(PATHS.root, p)}`);
  }
}

// ============================================================
// Main
// ============================================================

if (require.main === module) {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'bootstrap':
    case undefined:
      cliBootstrap(rest);
      break;
    case 'status':
      cliStatus();
      break;
    case 'refresh':
      // Refresh = bootstrap with force + preserve [CONFIRM]-tagged user edits (MVP: force only; three-way merge fast-follow)
      info('refresh: MVP behavior is --force bootstrap. Three-way merge preserving user edits is fast-follow.');
      cliBootstrap([...rest, '--force']);
      break;
    default:
      console.log(`Usage: node scripts/flow-intent-bootstrap.js [bootstrap|status|refresh] [options]

Commands:
  bootstrap [--auto-confirm] [--force] [--task=<id>]    Generate the 4 intent artifacts
  status                                                Show bootstrap state
  refresh [--force]                                     Re-scan and regenerate
`);
  }
}

module.exports = {
  bootstrap,
  recordSkip,
  isBootstrapped,
  isDeferredIndefinitely,
  readBootstrapState,
  collectSignals,
  renderTemplate,
  renderBootstrapResult,
  ARTIFACT_PATHS,
  BOOTSTRAP_STATE_PATH,
};
