# Audit Report — Pre-IGR WogiFlow Codebase

**Generated**: 2026-04-15T18:30:00.000Z
**Framing**: `.workflow/state/audit-framing/2026-04-15-pre-igr-project.md`
**Findings JSON**: `.workflow/scratch/audit-findings-pre-igr-project.json`
**Adversary run**: `.workflow/state/adversary-runs/audit-2026-04-15-pre-igr-project.json`
**Scope**: The ~340 files never exposed to IGR Architect+Adversary during development (everything NOT in the 13 files of R-277..R-287).

---

## Gate 0 — Baseline

| Check | Result |
|-------|--------|
| Build | N/A (Node CLI) |
| Typecheck | N/A (pure JS) |
| Lint | 0 errors, 9 pre-existing warnings (total project) |
| Lint config downgrades | 2 (`no-unreachable`, `no-unused-vars` both downgraded to warn) → finds as cons-c05 |
| Tests | 1042 / 1042 passing ✓ |
| Score cap | 97 (hard Gate 0 ceiling) |

---

## Overall score: **C+ (78)**

**Why not higher**: Systemic findings in architecture (god files, three-layer violations), modernization (1,884 sync fs calls in async contexts), and test coverage (6.9%) cap the mean score. These are the consequence of ~3 years of growth without adversarial per-PR review.

**Why not lower**: No security criticals, zero npm vulnerabilities, 100% conventional commits, active tech-debt tracking, clean `.env.example`-missing-but-no-hardcoded-secrets posture, good architectural primitives exist (flow-io, flow-output, flow-hook-errors) — they're just under-adopted.

**Dimension scores:**

| Dimension | Score | Weight | Why |
|-----------|-------|--------|-----|
| Architecture | C+ | 0.25 | 3 HIGH (god files, three-layer violations, flow-io bypass), 5 MEDIUM |
| Dependencies | B+ | 0.15 | 0 vulns, 5 total deps — only 1 major-behind (huggingface) |
| Duplication | B- | 0.15 | 4 HIGH (loadConfig, DANGEROUS_KEYS, slugify, safeParseJson duplicates), all post-adversary demoted to MEDIUM |
| Performance | B | 0.15 | Hot-path 10-14 sync I/O per PreToolUse, but already has caching layers |
| Consistency | C+ | 0.10 | 137 raw JSON.parse, 77+ `\|\|` vs `??`, 5 config-access patterns |
| Modernization | C+ | 0.10 | 1,884 sync fs in async ctx (HIGH), 459 manual null guards |
| Tech Debt | C+ | 0.10 | 6.9% test coverage + 3 god files flagged in tech-debt.json (TD-002, TD-004, TD-005) |

---

## Top 10 HIGH findings (post-adversary)

| # | ID | Dim | Title | Evidence |
|---|-----|-----|-------|----------|
| 1 | td-f01 | tech-debt | **Test coverage 6.9%** — 337+ source files have zero tests; hooks, review-passes, learning modules all untested | 25 test files / 364 source |
| 2 | arch-002 | architecture | **Systemic god-files** — 215/265 scripts >300 LOC, 35 >1000 LOC. Worst: flow-long-input-cli.js (3064), flow-memory-db.js (2602), flow-pattern-extractor.js (2477) | wc -l |
| 3 | arch-003 | architecture | **flow-io bypass at 195 files / 727 sites** (UNDERstated in original find — adversary corrected from 148/516) | grep -r |
| 4 | arch-001 | architecture | **pre-tool-use.js = 560 LOC, 84 branch points** — three-layer violation | wc -l + grep |
| 5 | mod-m01 | modernization | **1,884 sync fs calls** in files that also declare async functions — event loop blocking | grep in async-declaring files |
| 6 | mod-m02 | modernization | **459 manual `obj && obj.prop` guards** where `?.` would simplify | grep counted |
| 7 | dep-001 | dependencies | **@huggingface/transformers 3.8.1 → 4.1.0** — 1 major behind, breaking API changes | npm outdated |
| 8 | td-f02 | tech-debt | **TD-002: flow-orchestrate autoCorrectCode** — 125 LOC, 18 branches. Tracked open since 2026-03-14. | tech-debt.json |
| 9 | td-f03 | tech-debt | **TD-004: flow-durable-session.js = 1,802 LOC / 53 fns** — SRP violation. Tracked open. | wc -l |
| 10 | td-f04 | tech-debt | **TD-005: flow-utils.js = 1,748 LOC / 70+ exports, 302 importers** — mega-facade, auto-executing lock cleanup on require = hidden side-effect | wc -l + re-export count |

---

## Adversary impact

**Verdict: REVISE_SCORE** — the adversary meaningfully corrected agent output.

### False positives caught (2)

- **arch-001** branch count was 84 (not 77) — not a blocker, but direction-correct, numbers stale.
- **arch-003** file/site counts were UNDERstated — adversary found 195 files / 727 sites vs claimed 148 / 516. Finding is **more** severe than agent reported. (Rare adversary call — catching understated severity, not just overstated.)

### Severity adjustments (7 HIGH → MEDIUM)

Four duplication findings (dup-001/002/003/004) + two performance findings (perf-001/002) + one consistency finding (cons-c02) were all Tier 3 grep-observations that didn't meet the Tier→HIGH evidence bar. Rubric Step 1.8 caps Tier 1 at MEDIUM unless 5+ instances verified; Tier 3 grep-observations cap at MEDIUM for consistency/maintainability issues.

**Result**: 17 HIGH → **10 HIGH**, 31 MEDIUM + 7 demoted + 3 added-by-adversary = **41 MEDIUM**, 20 LOW + 1 adversary-added = **21 LOW**.

### Missed issues adversary caught (4)

1. **[MEDIUM] Cross-repo contract drift with wogiflow-cloud** — `partner-versions.json` has `minCompatible: 1.5.0` for teams-client; no agent checked if self v1.6.0 broke anything. Frame deferred it explicitly as out-of-scope, but adversary challenges whether that was correct.
2. **[MEDIUM] Compliance-enforcement gap** — three-layer architecture documented in `.claude/docs/architecture.md:44` but no lint rule prevents violation. arch-001 treats symptom; adversary identifies root cause.
3. **[MEDIUM] JSON.parse safe-vs-unsafe context** — cons-c02 counted 146 raw JSON.parse sites but didn't separate safe (local config) from unsafe (subprocess output in lib/workspace-*). Prototype-pollution on untrusted parsed data is the real risk.
4. **[LOW] Template injection pattern** in `flow-skill-learn.js:86` `getRecentCommitFiles()` — currently orphaned but dangerous pattern.

### Scope drift (1)

- **dup-003** flagged `flow-auto-learn.js` which was epic-audited. Moved to appendix.

### Frame assumption challenges (2)

- **Standard rubric assumption**: evidenceTier + evidenceNote fields required by Step 1.8 weren't in consolidated JSON. Protocol loose spot — audit flow-audit.js could enforce this.
- **Safety-net assumption**: "1042 tests" is misleading because coverage is 6.9%. Hooks, learning modules, orchestration are untested. Refactoring those carries more risk than refactoring tested core.

---

## The honest meta-point

The audit **found a lot** because most of this code was written pre-IGR. The adversary **caught real protocol issues** (severity capping, scope drift) plus real missed categories (contract drift, compliance enforcement). Both halves of the enhanced pipeline justified their cost:

- **Framing** kept scope explicit — adversary correctly flagged `dup-003` breach.
- **Evidence tiers** forced demotions that would otherwise have bloated the HIGH count.
- **Different-model adversary** caught arch-003 severity UNDERcounting — a class of error the original agent couldn't catch on itself.

**Per-dimension cost-adjusted score**: If you accept the adversary's REVISE_SCORE verdict, the effective grade is closer to **B- (80)** — 10 HIGH is still non-trivial but not alarming for a 300+ file codebase built pre-IGR.

---

## Recommended prioritization (user decides follow-ups)

### Ship immediately (cheap, high impact)

1. Re-enable `no-unreachable` and `no-unused-vars` as `error` in eslint.config.js (cons-c05) — stops regression on the outlier catch names.
2. Delete merged stale branch `origin/team-features-backup` (td-f09).
3. Create `.env.example` (td-f11).
4. Remove `LOCK_STALE` and 4 other dead exports from flow-constants.js (arch-010).

### High-value mechanical refactors (run each as an IGR-supervised story)

5. **Replace 137 raw JSON.parse with safeJsonParse** in lib/workspace-*.js first (prototype-pollution prevention) — cons-c02 + adversary-added missedIssue. **Run Architect+Adversary on this plan** before touching lib/ files.
6. **Consolidate 4 loadConfig / 7 DANGEROUS_KEYS / 3 safeParseJson impls** (dup-001, dup-002, dup-004). Single PR.
7. **Hook three-layer compliance lint rule** — prevents arch-001 / arch-005 / arch-008 regressions (adversary-added missedIssue).

### Targeted test coverage expansion (not backfill — focus on high-risk)

8. Write tests for `scripts/hooks/core/*.js` gates (currently 0 coverage on the most-exercised code path). This is the highest-risk refactor gap per the adversary's safety-net challenge.

### Structural (big, deferrable)

9. Decompose flow-utils.js per TD-005 — already tracked.
10. Decompose flow-durable-session.js per TD-004 — already tracked.
11. Cross-repo contract audit with wogiflow-cloud — separate story per adversary's missedIssue.

### Don't bother (documented / acceptable)

- Lazy-loader wrappers in flow-learning-orchestrator.js (mod-m05) — architecturally justified.
- console.log dominance (cons-c06) — fine for CLI tools.
- AGPL license (dep-005) — a deliberate choice.

---

## Pipeline validation

This run EXERCISED every new pipeline element shipped this session:

- ✅ **Step 0 Framing**: scope explicit, assumptions tracked, item-reconciliation clean. Adversary used framing to flag dup-003 scope drift.
- ✅ **Step 1.8 Evidence Tiers**: forced every finding into T0-T4. Adversary demoted 7 HIGH → MEDIUM based on tier caps.
- ✅ **Step 2 Agents**: 7 parallel Sonnet agents (architecture, deps, duplication, perf, consistency, modernization, tech-debt). All returned structured JSON.
- ✅ **Step 3 Consolidate**: 55 findings across 7 dimensions.
- ✅ **Step 3.5 Adversary**: Haiku (different model), found 2 false positives, 7 severity adjustments, 4 missed issues, 1 scope drift, 2 frame-assumption challenges. Verdict: REVISE_SCORE.
- ✅ **Step 5 Display Report**: you're reading it.
- ⏭ **Step 4 Pattern Promotion**: not run for this audit (would auto-surface recurring patterns to feedback-patterns.md — user can trigger via `flow promote`).
- ⏭ **Step 7 Persist**: saving to `.workflow/audits/2026-04-15-pre-igr-project.md` (this file).

The adversary demonstrably added value beyond what the 7 Sonnet agents produced alone.
