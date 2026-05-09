#!/usr/bin/env node

/**
 * Wogi Flow - Logic Rules (Cross-Cutting)
 *
 * Cross-cutting business-logic rules that span multiple features/pages.
 *
 * Problem solved (2026-04-24 workspace failure catalog, point 4):
 *   Owner says "every person in the system needs a seat — remove contact-person
 *   blocks." A dossier captures that for ONE feature. But the rule applies
 *   everywhere. Next session, Claude edits a different page and reintroduces
 *   the pattern. Feature-scoped memory doesn't catch it.
 *
 * How it works:
 *   - Rules live in <dossier-dir>/_logic-rules.md, one "## RULE: <id>" per rule
 *   - Each rule declares: statement, applies-to (file globs / keywords),
 *     enforcement-grep (regex to detect violations anywhere)
 *   - listRules() parses all rules from the canonical file(s)
 *   - matchRulesForFiles(files) returns rules scoped to those files
 *   - checkPropagation(rule, originFiles) greps the repo for other places
 *     the rule should apply but the origin task may have missed
 *   - detectViolations() scans the entire repo for grep patterns that should
 *     not appear — surfaces drift at session-start or /wogi-health
 *
 * Workspace-mode:
 *   Workspace-level rules live at WOGI_WORKSPACE_ROOT/.workspace/dossiers/
 *     _logic-rules.md (cross-repo).
 *   Per-repo rules live at <repo>/.workflow/dossiers/_logic-rules.md.
 *   Both are merged at read time; workspace shadows repo on id collision.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { PATHS } = require('./flow-utils');
const { globToRegex: _gtr } = require('./flow-glob');
// Local convenience: case-insensitive glob (this module's historical default)
const globToRegex = (pat) => _gtr(pat, 'i');
const { getDossierRoots, DOSSIER_DIRNAME: _DOSSIER_DIRNAME } = require('./flow-feature-dossier');

const LOGIC_RULES_FILENAME = '_logic-rules.md';

function getRulesPaths() {
  const out = [];
  for (const root of getDossierRoots()) {
    const p = path.join(root.dir, LOGIC_RULES_FILENAME);
    if (fs.existsSync(p)) out.push({ path: p, root: root.kind });
  }
  return out;
}

/**
 * Parse a logic-rules markdown file.
 * Format:
 *   ## RULE: <id>
 *   <!-- id: <id> --> (optional, id taken from heading if absent)
 *   <!-- status: active|deprecated -->
 *   <!-- created: YYYY-MM-DD -->
 *   **Statement**: ...
 *   **Why**: ...
 *   **Applies to**:
 *     - pattern: src/**\/Customer*
 *     - keyword: contact person
 *   **Enforcement grep**: `regex`
 *   **Origin**: wf-xxxxxxxx
 */
function parseRulesFile(raw, rootKind) {
  const rules = [];
  // Strip fenced code blocks so example rules in docs aren't parsed as real rules.
  const stripped = raw.replace(/```[\s\S]*?```/g, '');
  const sectionRegex = /\n##\s+RULE:\s*([^\n]+)\n([\s\S]*?)(?=\n##\s+RULE:|\n##\s+[^R]|$)/gi;
  let m;
  while ((m = sectionRegex.exec('\n' + stripped)) !== null) {
    const headingId = m[1].trim();
    const body = m[2];
    const idMatch = body.match(/<!--\s*id:\s*([^>]+)-->/);
    const id = (idMatch ? idMatch[1].trim() : headingId).replace(/\s+/g, '-').toLowerCase();
    const statusMatch = body.match(/<!--\s*status:\s*([^>]+)-->/);
    const createdMatch = body.match(/<!--\s*created:\s*([^>]+)-->/);
    const statement = extractBoldField(body, 'Statement');
    const why = extractBoldField(body, 'Why');
    const origin = extractBoldField(body, 'Origin');
    const grepMatch = body.match(/\*\*Enforcement\s*grep\*\*\s*:\s*`([^`]+)`/i);
    const appliesSection = body.match(/\*\*Applies\s*to\*\*\s*:\s*\n([\s\S]*?)(?=\n\*\*|\n$|$)/i);

    const patterns = [];
    const keywords = [];
    const components = [];
    if (appliesSection) {
      for (const line of appliesSection[1].split('\n')) {
        const kv = line.trim().match(/^-\s*([a-zA-Z-]+):\s*(.+)$/);
        if (!kv) continue;
        const kind = kv[1].toLowerCase();
        const value = kv[2].trim();
        if (kind === 'pattern' || kind === 'file' || kind === 'filepattern') patterns.push(value);
        else if (kind === 'keyword') keywords.push(value.toLowerCase());
        else if (kind === 'component') components.push(value);
      }
    }

    rules.push({
      id,
      status: statusMatch ? statusMatch[1].trim() : 'active',
      created: createdMatch ? createdMatch[1].trim() : null,
      statement: statement || '',
      why: why || '',
      origin: origin || '',
      enforcementGrep: grepMatch ? grepMatch[1] : null,
      appliesTo: { patterns, keywords, components },
      _root: rootKind
    });
  }
  return rules;
}

function extractBoldField(body, name) {
  const re = new RegExp(`\\*\\*${name}\\*\\*\\s*:\\s*(.+?)(?=\\n\\*\\*|\\n$|$)`, 'is');
  const m = body.match(re);
  if (!m) return '';
  return m[1].trim().replace(/\n+/g, ' ');
}

function listRules() {
  const all = [];
  const seen = new Map();
  for (const { path: p, root } of getRulesPaths()) {
    let raw;
    try { raw = fs.readFileSync(p, 'utf-8'); } catch (_err) { continue; }
    const rules = parseRulesFile(raw, root);
    for (const r of rules) {
      if (seen.has(r.id) && root !== 'workspace') continue;
      seen.set(r.id, r);
    }
  }
  for (const r of seen.values()) all.push(r);
  return all;
}


function matchRulesForFiles(files = [], extraKeywords = []) {
  if (!Array.isArray(files)) files = [files];
  const lowerFiles = files.map(f => String(f).toLowerCase());
  const lowerKw = extraKeywords.map(k => String(k).toLowerCase());
  const rules = listRules();
  const matched = [];
  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    let scoreHit = false;
    const reasons = [];
    for (const pat of rule.appliesTo.patterns) {
      const re = globToRegex(pat);
      for (const f of lowerFiles) {
        if (re.test(f)) {
          scoreHit = true;
          reasons.push(`file-match: ${pat}`);
          break;
        }
      }
    }
    for (const kw of rule.appliesTo.keywords) {
      if (lowerKw.some(k => k.includes(kw))) {
        scoreHit = true;
        reasons.push(`keyword: ${kw}`);
      }
    }
    if (scoreHit) matched.push({ ...rule, reasons });
  }
  return matched;
}

/**
 * Propagation check: given a rule and the files just touched,
 * grep the repo for other places the rule's enforcement pattern appears.
 * Surface hits as "rule applies here too, did you miss it?"
 */
function checkPropagation(rule, originFiles = []) {
  if (!rule.enforcementGrep) return { rule: rule.id, checked: false, otherHits: [] };
  const normalizedOrigin = new Set(originFiles.map(f => path.normalize(f)));
  try {
    const out = execSync(
      `git grep -lE ${JSON.stringify(rule.enforcementGrep)} -- . ':(exclude).workflow' ':(exclude).workspace' ':(exclude)node_modules' ':(exclude).git' 2>/dev/null || true`,
      { cwd: PATHS.root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const files = out.split('\n').filter(Boolean);
    const otherHits = files.filter(f => !normalizedOrigin.has(path.normalize(f)));
    return { rule: rule.id, checked: true, pattern: rule.enforcementGrep, otherHits };
  } catch (_err) {
    return { rule: rule.id, checked: false, otherHits: [] };
  }
}

function detectViolations() {
  const rules = listRules();
  const report = [];
  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    if (!rule.enforcementGrep) continue;
    try {
      const out = execSync(
        `git grep -nE ${JSON.stringify(rule.enforcementGrep)} -- . ':(exclude).workflow' ':(exclude).workspace' ':(exclude)node_modules' ':(exclude).git' 2>/dev/null || true`,
        { cwd: PATHS.root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const lines = out.split('\n').filter(Boolean);
      if (lines.length > 0) {
        report.push({
          rule: rule.id,
          statement: rule.statement,
          pattern: rule.enforcementGrep,
          hits: lines.length,
          sample: lines.slice(0, 5)
        });
      }
    } catch (_err) { /* skip */ }
  }
  return report;
}

function buildRulesInjection(matches) {
  if (!matches || matches.length === 0) return null;
  const blocks = matches.slice(0, 6).map(rule => {
    let b = `### Logic Rule: ${rule.id}\n`;
    b += `**Statement**: ${rule.statement}\n`;
    if (rule.why) b += `**Why**: ${rule.why}\n`;
    b += `**Matched via**: ${rule.reasons.join(', ')}\n`;
    if (rule.enforcementGrep) b += `**Enforcement grep**: \`${rule.enforcementGrep}\`\n`;
    if (rule.origin) b += `**Origin**: ${rule.origin}\n`;
    return b;
  });
  return [
    '## Cross-Cutting Logic Rules (auto-loaded)',
    '',
    'Active logic rules scoped to the files you are touching. Violating these introduces regressions the owner has already corrected. Run propagation check (`flow logic-rules propagate <rule-id>`) if your change implements or reinforces one of these rules.',
    '',
    blocks.join('\n---\n\n')
  ].join('\n');
}

// ============================================================
// CLI
// ============================================================

function printHelp() {
  console.log(`Usage: flow logic-rules <command> [args]

Commands:
  list                             List all rules with status
  show <id>                        Show a single rule
  match --files "a,b" [--keywords "k1,k2"]
                                   Show rules that scope to these files/keywords
  propagate <id> [--origin "a,b"]
                                   Find other places this rule's pattern appears
  scan                             Detect violations across the whole repo
  inject --files "a,b" [--keywords "k1,k2"]
                                   Print phase-injection block
  help                             Show this help

Examples:
  flow logic-rules list
  flow logic-rules match --files "src/pages/Customer.tsx"
  flow logic-rules propagate every-person-needs-seat --origin "src/pages/Customer.tsx"
  flow logic-rules scan
`);
}

function parseArgs(args) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out.flags[key] = next; i++; }
      else { out.flags[key] = true; }
    } else { out._.push(a); }
  }
  return out;
}

function cliMain(argv) {
  const [cmd, ...rest] = argv;
  const { _: positional, flags } = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help') return printHelp();

  if (cmd === 'list') {
    const rules = listRules();
    if (rules.length === 0) {
      console.log('(no rules — edit .workflow/dossiers/_logic-rules.md to add)');
      return;
    }
    for (const r of rules) {
      console.log(`${r.id}  [${r.status}]  ${r.statement.slice(0, 80)}`);
    }
    return;
  }

  if (cmd === 'show') {
    const id = positional[0];
    const rules = listRules();
    const r = rules.find(x => x.id === id);
    if (!r) { console.error(`rule not found: ${id}`); process.exit(1); }
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'match') {
    const files = flags.files ? String(flags.files).split(',').map(s => s.trim()) : [];
    const kw = flags.keywords ? String(flags.keywords).split(',').map(s => s.trim()) : [];
    const matches = matchRulesForFiles(files, kw);
    if (matches.length === 0) { console.log('(no matches)'); return; }
    for (const m of matches) {
      console.log(`${m.id}  [${m.reasons.join(', ')}]  ${m.statement.slice(0, 80)}`);
    }
    return;
  }

  if (cmd === 'propagate') {
    const id = positional[0];
    if (!id) { console.error('rule id required'); process.exit(1); }
    const rules = listRules();
    const r = rules.find(x => x.id === id);
    if (!r) { console.error(`rule not found: ${id}`); process.exit(1); }
    const origin = flags.origin ? String(flags.origin).split(',').map(s => s.trim()) : [];
    const report = checkPropagation(r, origin);
    if (!report.checked) { console.log('(no enforcement grep to propagate)'); return; }
    if (report.otherHits.length === 0) {
      console.log(`propagation: clean (pattern /${report.pattern}/ only appears in origin files)`);
    } else {
      console.log(`PROPAGATION: pattern /${report.pattern}/ also appears in:`);
      for (const f of report.otherHits) console.log(`  ${f}`);
      process.exit(2);
    }
    return;
  }

  if (cmd === 'scan') {
    const report = detectViolations();
    if (report.length === 0) { console.log('no violations'); return; }
    console.log(`${report.length} rule violation(s):`);
    for (const v of report) {
      console.log(`\n${v.rule}: ${v.statement}`);
      console.log(`  pattern: /${v.pattern}/  hits: ${v.hits}`);
      for (const s of v.sample) console.log(`    ${s}`);
    }
    process.exit(2);
  }

  if (cmd === 'inject') {
    const files = flags.files ? String(flags.files).split(',').map(s => s.trim()) : [];
    const kw = flags.keywords ? String(flags.keywords).split(',').map(s => s.trim()) : [];
    const matches = matchRulesForFiles(files, kw);
    const block = buildRulesInjection(matches);
    if (block) console.log(block);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  try { cliMain(process.argv.slice(2)); }
  catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = {
  listRules,
  parseRulesFile,
  matchRulesForFiles,
  checkPropagation,
  detectViolations,
  buildRulesInjection
};
