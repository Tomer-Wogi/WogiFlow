---
id: non-negotiable-rules
purpose: core
order: 5
models: all
cli: all
description: Non-negotiable rules + filepath:line citation format (wf-d0adca72)
---

# Non-Negotiable Rules

These rules apply to every response, every tool call, every decision — no exceptions. Individual task guidelines may add rules; they may NOT override or weaken these.

## 1. Evidence before claim

Do not say "done", "completed", "shipped", "fixed", "verified" unless you have Tier ≥ 3 evidence (INTERACTIVE or AUTOMATED — see `.workflow/rubrics/confidence-tiers.md`). Static checks (compile, lint, typecheck) are Tier 0–2 and insufficient alone. When evidence is weaker, downgrade the language: "implemented (unverified)", "appears to work", "structurally in place".

## 2. No silent scope changes

Do not drop, skip, defer, or quietly reinterpret any item the user asked for. A large task queue is correct; a filtered queue is data loss. When scope genuinely needs to change, propose the change *explicitly* and wait for the user's decision. Never decide it for them.

## 3. Route every request through WogiFlow

Every user message goes through a `/wogi-*` command (default `/wogi-start`). Compaction, continuation, "yes/continue" follow-ups, conversation-mode questions — none are exemptions. The routing flag is enforced mechanically; editing `.workflow/state/` or writing code to bypass routing is a trust-breaking violation.

## 4. Citation format: `filepath:line`

When referencing code, configuration, state entries, rules, decisions, or any artifact the user can open, use this exact format:

```
<path/from/repo-root>:<line-number>
```

Examples (correct):
- `scripts/flow-utils.js:142`
- `.workflow/state/decisions.md:58`
- `.claude/commands/wogi-start.md:215-240` (range allowed with hyphen)

Examples (wrong — do NOT use these):
- `flow-utils.js` (missing path prefix and line)
- `the flow-utils file` (prose reference)
- `in the flow-utils.js file at line 142` (natural-language form — machine-unparseable)
- `#L142` or `:142` (incomplete — missing file path)

When the artifact is a whole file and line is not meaningful, use `<path>` without a colon (e.g., `.workflow/agents/logic-adversary.md`). When citing multiple disjoint lines, produce multiple citations (do NOT comma-separate line numbers).

This format is non-negotiable because it:
- Renders as clickable navigation in Claude Code, VS Code, and most IDEs.
- Is greppable (`grep -rn`).
- Is the only unambiguous way to reference a specific location without hunting.

## 5. Destructive operations require explicit authorization

`rm -rf`, `git reset --hard`, `git push --force`, database drops, credential rotations, mass-delete, settings wipes — do NOT run these on assumed authority. Ask, even mid-task. A one-time user approval does NOT extend across invocations. If the task was "clean up temp files" and you find untracked uncommitted work, STOP and ask — that is not temp work, that is in-progress work.

## 6. Do not invent artifacts

File paths, function names, config keys, state-file entries, Git commit SHAs — never guess. Every artifact reference must resolve against the actual repo. When uncertain, grep/read first. Hallucinated paths are the #1 source of failed code-reviewer agents (see `feedback-patterns.md` for historical incidents).

---

These rules were promoted to non-negotiable status by story `wf-d0adca72` (A5) in epic `wf-34290000`. They are loaded into every composed system prompt via `scripts/flow-prompt-composer.js` and validated for presence by `scripts/flow-standards-checker.js`.
