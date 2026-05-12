# Implementation Timeline

## 2026-05

### Week 3 (May 10-16)
- [x] wf-e8851cfc: Architectural refactor: extract business logic from oversized entry files (stop.js 496 LOC, user-prompt-submit.js 293 LOC, session-start.js 387 LOC) into core/ per hook-three-layer.md (A-3 deferred follow-up to v2.31.1) (May 12)
- [x] wf-740f47e4: v2.31.2 patch: close 5 review findings from v2.31.1 post-patch review (L-1-RESIDUAL verdict-bypass, DOCS-DRIFT config defaults, NULL-CHECK, DUAL API, CRLF heredoc) (May 12)
- [x] wf-6e31850e: v2.31.1 patch: close 16 review findings from 2026-05-11 post-session review (6 HIGH + 7 MED + 3 LOW) (May 12)
- [x] wf-e399bd8d: Bake self-adversary-before-asking pattern into WogiFlow: AI must iterate Self-Refine + Reflexion up to 8 rounds reaching 95% confidence on implementation-class questions before asking user (user directive: don't compromise quality for tokens; challenge yourself) (May 11)
- [x] wf-4a5b7a6f: deferral-gate checkBashGate over-triggers on commands that merely reference 'deferred' and 'last-review.json' as text content (markdown blockquotes, commit messages, release notes) (May 11)
- [x] wf-b8839d99: Replace regex deferral-classifier with AI classifier + close architectural gaps (false-attribution, standing-pref persistence, recovery-routing) (May 11)
- [x] wf-d5fcb880: Close pre-release HIGH findings H1+H2: safeJsonParse self-violation + missing forbidden-patterns rule pack (May 11)
- [x] wf-6c9ed721: Verification fallout from gate-bug batch 2026-05-10 (phase-gate test isolation + standards-checker file-shape tolerance) (May 11)
- [x] wf-c573961f: Task-gating gate consults 5+ drifting state sources (May 11)
- [x] wf-35742353: Gate cascade: Stop hook + research-required + long-input-pending fire same turn with conflicting remediations (May 11)
- [x] wf-88a08fd4: flow-phase.js transition CLI silently no-ops (May 11)
- [x] wf-f7d58760: long-input-pending gate misfires on sub-agent task-notifications (May 11)
- [x] wf-12271e82: Research-required gate false-positives on the word 'recommend' (May 11)

## 2026-04

### Week 4 (Apr 19-25)
- [x] wf-34290000: WogiFlow Extension Finalize (pre-CLI release) (Apr 24)
- [x] wf-a346c915: A1 AGENTS.md alias for CLAUDE.md (Apr 24)
- [x] wf-04585518: Surface effort.level and thinking.enabled in status line (Apr 24)
- [x] wf-3635574e: G3 SQLite-as-IPC for workspace dispatch (Apr 24)
- [x] wf-8d635d0e: E1 Parallel-worktree Auto Review for Completion Truth Gate (no per-task model selection) (Apr 24)
- [x] wf-4434851f: C2 IGR artifact edit proposals via CLI + session-end approval (Apr 24)
- [x] wf-26d363ce: H1 Structured phase definition schema (YAML) (Apr 24)
- [x] wf-9a969442: F3 Fuzzy-match patching for skill edits (Apr 24)
- [x] wf-2a9f179e: F1 Skill propose/patch/remove CLI + session-end approval UI (Apr 24)
- [x] wf-f267ea2a: Auto-pickup next ready task at session restart (Apr 24)
- [x] wf-191d5f6e: Main-mode question classifier auto-defers task-boundary restart (Apr 24)

### Week 3 (Apr 12-18)
- [x] wf-63c0f4cc: Enhance /wogi-story with P0 specification-quality gates (Apr 17)
- [x] wf-d3e67abe: Silent-worker-halt detection via dispatch-tracking (Apr 17)

## 2026-02

### Week 1 (Feb 1-7)
- [x] wf-175171e3: Fix auto-regenerate bug in flow-morning.js - calls bash script with node (Feb 2)

## 2026-01

### Week 5 (Jan 25-31)
- [x] wf-917c85b7: Implement Video Methodologies: Prompt Capture, Correction Detection, and Bulk Loop (Jan 30)
- [x] wf-36d79345: Fix security issues in browser testing: raw JSON.parse, command injection, path traversal (Jan 30)

### Week 3 (Jan 11-17)
- [x] wf-eb8ed7d0: Fix flow-utils.js (Jan 16)

Tasks completed, organized by date.

