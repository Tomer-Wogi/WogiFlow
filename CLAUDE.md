# Project Instructions

You are an AI development assistant using the Wogi Flow methodology v1.9. This is a self-improving workflow that learns from feedback and adapts to your team's preferences.

---

{{#if config.enforcement.strictMode}}
## Task Gating (MANDATORY)

**STOP. Before doing ANY implementation work, you MUST follow these steps:**

### Step 1: Is this an implementation request?

**YES - Implementation requests:**
- "Add X to Y"
- "Fix the bug in..."
- "Create a component for..."
- "Implement feature X"
- "Build me a [system/feature]"
- Any request that requires writing/modifying code

**NO - Handle normally:**
- "What does X do?"
- "How does Y work?"
- "Show me the code for..."
- Questions, exploration, reading files

If **NO** → Proceed normally without task gating.
If **YES** → Continue to Step 2.

### Step 2: Does a task already exist?

Check `.workflow/state/ready.json` for existing tasks.

- If **YES** → Use `/wogi-start TASK-XXX`
- If **NO** → Continue to Step 3

### Step 3: Assess task size

| Size | Criteria | Action |
|------|----------|--------|
| **Small** | < 3 files, < 1 hour, obvious scope | Create task inline, proceed with `/wogi-start` |
| **Medium** | 3-10 files, 1-4 hours, some complexity | **STOP** - Create story first |
| **Large** | > 10 files, > 4 hours, new feature | **STOP** - Create story first |

### For Medium/Large Tasks:

```
This looks like a medium/large task.

Before I start implementing, I need to create a story with acceptance criteria.

**Proposed story:** "[title based on request]"

Should I create this story with detailed acceptance criteria for your approval?
```

Then:
1. Run `/wogi-story "[title]"` to create acceptance criteria
2. **WAIT for user approval** on the story
3. Only then proceed with `/wogi-start`

**This is NON-NEGOTIABLE when strict mode is enabled.**

---
{{/if}}

## Quick Start

```bash
# New project
./scripts/flow install

# Existing project
./scripts/flow onboard
```

## Core Principles

1. **State files are memory** - Read `.workflow/state/` first
2. **Config drives behavior** - Follow `.workflow/config.json` rules
3. **Log every change** - Append to `request-log.md`
4. **Reuse components** - Check `app-map.md` before creating
5. **Learn from feedback** - Update instructions when corrected

## Essential Commands

| Command | Purpose |
|---------|---------|
| `/wogi-ready` | Show available tasks |
| `/wogi-start TASK-X` | Start task (self-completing loop) |
| `/wogi-story "title"` | Create story with acceptance criteria |
| `/wogi-status` | Project overview |
| `/wogi-health` | Check workflow health |

See `.claude/docs/commands.md` for complete command reference.

## Natural Language Command Detection

**When you recognize these phrases, auto-invoke the corresponding command:**

| Phrase Pattern | Command |
|----------------|---------|
| "review what we did", "review this session", "please review", "code review" | `/wogi-session-review` |
| "show tasks", "what's ready", "available tasks" | `/wogi-ready` |
| "project status", "show status", "where are we" | `/wogi-status` |
| "check health", "workflow health", "is everything ok" | `/wogi-health` |
| "wrap up", "end session", "that's all" | `/wogi-session-end` |
| "compact context", "save context", "running low on context" | `/wogi-compact` |

**IMPORTANT**: When a user's message matches one of these patterns, immediately invoke the Skill tool with the corresponding command. Do not ask for confirmation.

## Session Startup

```bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
cat .workflow/state/decisions.md # Project rules
```

## Task Execution Rules

**These apply to ALL implementation work:**

### Before Starting:
1. Check `app-map.md` for existing components
2. Check `decisions.md` for coding patterns
3. Load task acceptance criteria

### While Working:
1. Follow acceptance criteria exactly
2. Use existing components from app-map
3. Follow patterns from decisions.md
4. Validate after EVERY file edit (run lint/typecheck)

### After Completing:
1. Update `request-log.md` with tags
2. Update `app-map.md` if new components
3. Run quality gates (lint, typecheck, test)
4. Provide completion report

## Auto-Validation (CRITICAL)

After editing ANY TypeScript/JavaScript file:
```bash
npx tsc --noEmit 2>&1 | head -20
npx eslint [file] --fix
```

**Do NOT edit another file until current file passes validation.**

## Request Logging

After EVERY request that changes files:
```markdown
### R-[XXX] | [YYYY-MM-DD HH:MM]
**Type**: new | fix | change | refactor
**Tags**: #screen:[name] #component:[name]
**Request**: "[what user asked]"
**Result**: [what was done]
**Files**: [files changed]
```

## Component Reuse

**Before creating ANY component:**
1. Check `app-map.md`
2. Search codebase for existing
3. Priority: Use existing → Add variant → Extend → Create new (last resort)

{{#if skills}}
## Installed Skills

{{#each skills}}
- {{this}}
{{/each}}

Check `.claude/skills/[name]/skill.md` for skill-specific guidance.

{{/if}}
## File Locations

| What | Where |
|------|-------|
| Config | `.workflow/config.json` |
| Tasks | `.workflow/state/ready.json` |
| Logs | `.workflow/state/request-log.md` |
| Components | `.workflow/state/app-map.md` |
| Rules | `.workflow/state/decisions.md` |
| Progress | `.workflow/state/progress.md` |

## Commit Behavior

Check `config.json → commits` before committing:

```json
"commits": {
  "requireApproval": {
    "feature": true,
    "bugfix": false,
    "refactor": true,
    "docs": false
  },
  "autoCommitSmallFixes": true,
  "smallFixThreshold": 3
}
```

**Rules:**
- If `requireApproval[taskType]` is `true` → ASK before committing
- If task changes > `smallFixThreshold` files → ASK before committing
- Show git diff and ask: "Ready to commit these changes?"
- Never commit without user awareness on features/refactors

## Quality Gates

Check `config.json → qualityGates` before closing any task:
```json
"qualityGates": {
  "feature": { "require": ["loopComplete", "tests", "appMapUpdate", "requestLogEntry"] }
}
```

## Context Management

Use `/wogi-compact` when:
- After completing 2-3 tasks
- After 15-20 messages
- Before starting large tasks

Before compacting: Update progress.md, ensure request-log is current, commit work.

## Handling Feedback

When corrected:
1. Fix it
2. Offer to update: decisions.md / agents/*.md / config.json / CLAUDE.md
3. If accepted, update and commit
4. Log to feedback-patterns.md

## Session End

When user says to wrap up:
1. Finish current work
2. Ensure request-log is current
3. Update progress.md
4. Commit and push

---

## Generated by CLI Bridge

This file was generated by the Wogi Flow CLI bridge.
Edit `.workflow/templates/claude-md.hbs` to customize.
Run `flow bridge sync` to regenerate.

Last synced: {{timestamp}}
