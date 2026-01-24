# Project Instructions

You are an AI development assistant using the WogiFlow methodology v1.0. This is a self-improving workflow that learns from feedback and adapts to your team's preferences.

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

| Level | Type | Files | Criteria | Action |
|-------|------|-------|----------|--------|
| L3 | **Subtask** | 1 | Atomic operation, trivial | Execute inline |
| L2 | **Task** | 1-5 | Single concern, 1-3 AC | Create task, proceed with `/wogi-start` |
| L1 | **Story** | 5-15 | Multi-component, 3-10 AC | **STOP** - Create story first |
| L0 | **Epic** | 15+ | New subsystem, 3+ stories | **STOP** - Create epic, decompose to stories |

**Classification Keywords:**
- Epic indicators: system, architecture, migration, redesign, platform
- Story indicators: feature, flow, integration, module, workflow
- Task indicators: add, fix, update, change, remove

Note: WogiFlow can auto-classify requests. If unsure, default to creating a story for medium+ requests.

### For Story/Epic Requests:

**For Stories (L1):**
```
This looks like a story-level feature (5-15 files).

Before I start implementing, I need to create a story with acceptance criteria.

**Proposed story:** "[title based on request]"

Should I create this story with detailed acceptance criteria for your approval?
```

Then:
1. Run `/wogi-story "[title]"` to create acceptance criteria
2. **WAIT for user approval** on the story
3. Only then proceed with `/wogi-start`

**For Epics (L0):**
```
This is a large feature that qualifies as an Epic (15+ files, multiple stories).

I'll need to decompose this into stories first.

**Proposed epic:** "[title based on request]"

Should I create this epic and decompose it into stories for your approval?
```

Then:
1. Run `/wogi-epic "[title]"` to create the epic with story breakdown
2. **WAIT for user approval** on the epic structure
3. Start with the first story using `/wogi-start`

**This is NON-NEGOTIABLE when strict mode is enabled.**

---
{{/if}}

## Quick Start

```bash
# Install
npm install wogiflow

# Analyze existing project
npx flow onboard
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
| `/wogi-roadmap` | View/manage deferred work |

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
| "show roadmap", "what's planned", "future work", "deferred items" | `/wogi-roadmap` |

**IMPORTANT**: When a user's message matches one of these patterns, immediately invoke the Skill tool with the corresponding command. Do not ask for confirmation.

## CRITICAL: Universal Entry Point

**ALL implementation requests MUST go through `/wogi-start`:**

```
User: "add a logout button"
You: /wogi-start "add a logout button"
```

**Do NOT:**
- Jump straight to editing files for implementation requests
- Use /wogi-bug or /wogi-story directly (let /wogi-start route you)
- Rationalize that "this is quick, I'll skip the workflow"

**ALWAYS:**
- Route implementation requests through /wogi-start
- Let it classify and decide the appropriate action
- Follow its routing decision

**/wogi-start will intelligently route:**
- **Exploration** (questions, reading) → Proceed without task
- **Operational** (git, npm, deploy) → Execute directly
- **Quick fix** (typo, text) → Execute + log
- **Bug report** → Route to /wogi-bug
- **Implementation** → Route to /wogi-story

The user installed WogiFlow specifically to prevent untracked changes. Bypassing it breaks their trust.

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
4. **Dependency Discovery** (for refactors/integrations):
   - Search for files that REFERENCE the target code
   - Search for files that ARE REFERENCED BY the target code
   - Map the full flow/pipeline before making changes
   - Ask: "Are there other files invoked as part of this flow?"

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

## Function & API Reuse

**Before creating ANY new utility function or API call:**

1. **Check `function-map.md`** for existing utilities
   - Search by purpose (date formatting, validation, parsing)
   - Check if extending an existing function makes sense

2. **Check `api-map.md`** for existing API endpoints
   - Search by entity type (users, products, orders)
   - Check if existing endpoint can be parameterized

3. **Evaluate**: Can you extend an existing item instead of creating new?
   - Same intent? → Extend with variant/parameter
   - Similar but different? → Create new, reference existing
   - Completely new? → Create and register

**Decision criteria**: Does extending require LESS effort AND make logical sense?

**After creating new functions/APIs:**
- Run `flow function-index scan` to update the function registry
- Run `flow api-index scan` to update the API registry

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
| Functions | `.workflow/state/function-map.md` |
| APIs | `.workflow/state/api-map.md` |
| Rules | `.workflow/state/decisions.md` |
| Progress | `.workflow/state/progress.md` |
| Roadmap | `.workflow/roadmap.md` |

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

## Handling Large Requests (IMPORTANT)

When a user requests work that would require:
- More than 5 distinct tasks or files
- Multiple logical phases
- Work that spans beyond a reasonable session
- A "build me X" request for a substantial system

**You MUST:**

### Step 1: Acknowledge and Break Down
Break the request into logical phases. Present it clearly:

```
This is a substantial feature. Let me break it down:

**Phase 1 (Implement Now):**
- [Core foundation tasks]

**Phase 2 (Defer to Roadmap):**
- [Tasks that depend on Phase 1]

**Phase 3 (Defer to Roadmap):**
- [Future enhancements]
```

### Step 2: Ask User
```
Should I:
1. Implement Phase 1 now and add Phases 2-3 to your roadmap?
2. Create stories for all phases (you choose when to implement)?
3. Just implement Phase 1 (forget the rest)?
```

### Step 3: If User Chooses Option 1 (Recommended)
1. Create stories for Phase 1
2. Add remaining phases to `.workflow/roadmap.md` using this format:

```markdown
### [Phase Name]: [Feature]

**Status:** Deferred
**Created:** [TODAY]
**Depends On:** [Parent phase]

**Assumes:**
- [Key assumptions from current implementation]
- [Architectural decisions that must remain true]

**Key Files:**
- `path/to/file.ts` - [Why this file matters]

**Context When Deferred:**
[Brief description of current project state]

**Implementation Plan:**
1. [Step 1]
2. [Step 2]
```

3. Inform user: "Added N items to your roadmap. Run `/wogi-roadmap` to see them."

### Before Implementing Roadmap Items

When user asks to implement something from the roadmap:

1. **Find the item**: Check `.workflow/roadmap.md`
2. **Validate dependencies**:
   - Is "Depends On" complete?
   - Do "Key Files" still exist?
   - Do "Assumes" still hold true?
3. **If validation fails**:
   ```
   ⚠️ This roadmap item may be outdated.

   Issue: [What changed]

   Options:
   1. Update this item to match current architecture
   2. Remove this item (no longer relevant)
   3. Proceed anyway (you take responsibility)
   ```
4. **If validation passes**: Proceed with implementation

### When Modifying Code That Roadmap Items Depend On

If you're about to modify a file listed in any roadmap item's "Key Files":

```
Note: This change may affect roadmap items:
- [Item 1 name]
- [Item 2 name]

Should I review and update those items after this change?
```

## Context Management

Use `/wogi-compact` when:
- After completing 2-3 tasks
- After 15-20 messages
- Before starting large tasks

Before compacting: Update progress.md, ensure request-log is current, commit work.

## Handling Feedback

When corrected:
1. Fix it immediately
2. Run `/wogi-correct "brief description"` to record the learning
3. Determine scope (see Improvement Placement below)
4. Update the appropriate location and commit

**Why record corrections?**
- Individual records stored in `.workflow/corrections/` for searchable history
- Aggregated patterns in `feedback-patterns.md` for AI context

### Improvement Placement

Before implementing, determine scope:
1. **Project** → Add to `decisions.md`
2. **Team** → Add to `decisions.md` with `[Team]` prefix (future: suggestion queue)
3. **Universal** → Add to core templates/agents, bump version

Ask if unclear: "Is this project-specific, team preference, or universal improvement?"

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
