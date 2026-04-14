# Mechanical Enforcement Gates

WogiFlow enforces workflow rules through PreToolUse hook gates — real JavaScript code that intercepts every tool call and blocks violations before they happen. These are not prompt suggestions; they are physical blocks that the AI cannot bypass.

---

## How It Works

Every time Claude Code calls a tool (Edit, Write, Bash, Read, Grep, etc.), the PreToolUse hook fires first. It runs through a chain of gates. If any gate returns `blocked: true`, the tool call is rejected with an error message telling the AI what to do instead.

```
Claude Code → tool call → PreToolUse hook → [Gate chain] → allowed / blocked
```

Gates are fail-open by default (errors don't block work) unless noted. The routing gate is fail-closed (errors block everything until routing completes).

---

## Gate Reference

### Routing Gate
**Enforces**: Every user message must go through `/wogi-start` before any tool can run.
**Blocks**: Read, Glob, Grep, Edit, Write, Bash, Agent, WebSearch, WebFetch, EnterPlanMode
**Fail mode**: Fail-CLOSED (if the gate errors, tools are blocked)
**Config**: `hooks.rules.routingGate.enabled`
**Exceptions**: Read-only git commands (`git status`, `git log`, `git diff`), subagents with an active parent task

### Phase Gate
**Enforces**: Tools are restricted based on the current workflow phase.
**Rules**:
- `routing` phase: Edit, Write, Bash blocked
- `exploring` phase: Edit, Write blocked (research is read-only)
- `spec_review` phase: Edit, Write, Bash blocked (reviewing, not coding)
- `coding` phase: All tools allowed
- `validating` phase: Edit, Write blocked (verifying, not changing)
- `completing` phase: All tools allowed (for logs, maps, commits)
**Config**: `hooks.rules.phaseGate.enabled`

### Phase-Read Gate
**Enforces**: Must read the phase instruction file before using mutation tools.
**Blocks**: Edit, Write, Bash — until the current phase's file in `.claude/docs/phases/` is read
**Purpose**: Enables on-demand loading of pipeline instructions (79% token savings for conversations)
**State file**: `.workflow/state/phase-reads.json`
**Config**: Respects `hooks.rules.phaseGate.enabled` (same toggle)

### Scope Gate
**Enforces**: Edits must be within the task's declared file scope.
**Blocks**: Edit, Write on files not listed in the task spec
**Config**: `hooks.rules.scopeGating.enabled`

### Bugfix Scope Gate
**Enforces**: L3 bugfix tasks are limited in how many files they can touch.
**Behavior**: Warns after 3 unique file edits, blocks at configurable threshold
**Purpose**: Prevents scope creep — a "quick fix" that touches 15 files should be an L2 task
**Config**: `enforcement.bugfixScope.enabled`

### Scope Mutation Gate
**Enforces**: Fix tasks cannot create new files; tasks cannot delete pre-existing files via Bash.
**Blocks**: Write (new file creation in fix tasks), Bash (rm commands on tracked files)
**Config**: `enforcement.scopeMutation.enabled`

### Strike Gate
**Enforces**: After repeated verification failures, blocks further edits.
**Behavior**: Tracks consecutive failures per task. After 3 strikes, blocks Edit/Write/Bash.
**Purpose**: Prevents infinite retry loops where the AI tries the same broken approach repeatedly
**State file**: `.workflow/state/strike-tracker.json`
**Config**: `enforcement.strikeEscalation.enabled`

### Deploy Gate
**Enforces**: Cannot deploy without a verification artifact. Cannot write/edit verification artifacts directly (anti-forgery).
**Blocks**: Bash (deploy commands without artifact), Write/Edit (on verification artifact files)
**Config**: `enforcement.deployGate.enabled`

### Git Safety Gate
**Enforces**: Creates automatic backup before destructive git operations.
**Triggers on**: `git reset --hard`, `git checkout -- .`, `git restore .`, `git clean -f`
**Behavior**: Creates a backup branch before allowing the destructive operation
**Config**: `enforcement.gitSafety.enabled`

### Commit-Log Gate
**Enforces**: Commits must have corresponding request-log entries.
**Blocks**: Bash (git commit) when request-log.md wasn't updated for the current task
**Config**: `hooks.rules.commitLogGate.enabled`

### Manager Boundary Gate
**Enforces**: Manager repos cannot modify worker repo source code (workspace mode).
**Blocks**: Edit/Write on any file inside member repos; Bash except allowlisted read-only commands
**Allows**: Read of metadata files (api-map, app-map, config, state files)
**Active when**: `WOGI_REPO_NAME === 'manager'`

### Component Reuse Gate
**Enforces**: Must check existing components before creating new ones.
**Behavior**: When Write creates a new component file, checks app-map for similar existing components
**Output**: Warning with reuse candidates (name, path, similarity score)
**Config**: `componentReuse.enabled`

### Standards Compliance Gate
**Enforces**: Naming conventions, security patterns, decisions.md rules.
**Runs at**: Task completion (part of quality gates)
**Checks scoped by task type**: component → naming/components/security, API → naming/api/security, feature → all
**Config**: Part of `qualityGates.<taskType>.require` array

### Damage Control
**Enforces**: Configurable blocklist for dangerous commands and protected files.
**Behavior**: Block or ask-before-execute based on pattern matching
**Config**: `damageControl.enabled` with custom patterns in `.workflow/damage-control.yaml`

---

## Configuration

All gates can be toggled independently:

```json
{
  "hooks": {
    "rules": {
      "routingGate": { "enabled": true },
      "phaseGate": { "enabled": true },
      "scopeGating": { "enabled": true },
      "commitLogGate": { "enabled": true }
    }
  },
  "enforcement": {
    "strictMode": true,
    "bugfixScope": { "enabled": true },
    "scopeMutation": { "enabled": true },
    "strikeEscalation": { "enabled": true },
    "deployGate": { "enabled": true },
    "gitSafety": { "enabled": true }
  },
  "componentReuse": { "enabled": true },
  "damageControl": { "enabled": false }
}
```

---

## Fast-Path Optimization

The hook checks pre-computed status from `.workflow/state/hook-status.json`. If all gates are disabled, the entire hook exits in <1ms. Individual gates are skipped via the status cache without loading their modules.

---

## Related

- [Damage Control](./damage-control.md) — Configurable pattern-based protection
- [Commit Gates](./commit-gates.md) — Approval workflow for commits
- [Task Execution](../02-task-execution/) — Where gates enforce workflow phases
- [Verification](../02-task-execution/03-verification.md) — Quality gates at completion
