---
description: "Export workflow configuration as a shareable profile"
---
Export workflow configuration as a shareable profile.

**v3.0**: Complete enforcement profile — exports everything needed to enforce identical code standards across projects, while excluding session-specific data.

## Usage

```bash
/wogi-export my-team              # Core files only
/wogi-export my-team --rules      # Include rules, decisions, review checklists, tech stack
/wogi-export my-team --learnings  # Include feedback patterns and skill learnings
/wogi-export my-team --skills     # Include skill definitions (skill.md files)
/wogi-export my-team --templates  # Include workflow templates (HBS, story, bug report)
/wogi-export my-team --full       # Include everything (recommended)
```

## Options

| Flag | Includes |
|------|----------|
| (none) | CLAUDE.md, agents/, config.json |
| `--rules` | + decisions.md, .claude/rules/ (recursive), .workflow/agents/, .claude/docs/stack.md |
| `--learnings` | + feedback-patterns.md, skill knowledge (patterns.md, learnings.md) |
| `--skills` | + .claude/skills/*/skill.md (skill definitions) |
| `--templates` | + .workflow/templates/ (HBS), templates/ (story/bug), state templates |
| `--full` | All of the above + pattern extraction |
| `--include-app-map` | Include app-map.md (project-specific, not in --full) |
| `--extract-patterns` | Scan codebase and extract patterns (included in --full) |
| `--resolve-conflicts` | Interactive conflict resolution (with --extract-patterns) |
| `--analysis-mode MODE` | Analysis depth: `balanced` (default), `deep` |
| `--include-examples` | Include code snippets as pattern examples |

## What Gets Exported (Generic Enforcement)

**Core (always included):**
- `CLAUDE.md` - Core workflow instructions
- `agents/*.md` - Agent personas (11 files)
- `.workflow/config.json` - Configuration and quality gates

**Rules & Standards (`--rules`):**
- `.workflow/state/decisions.md` - All coding rules and patterns
- `.claude/rules/**/*.md` - Recursive rule tree (security, code-style, architecture, operations)
- `.workflow/agents/*.md` - Review checklists (security.md, performance.md)
- `.claude/docs/stack.md` - Tech stack definition

**Skills (`--skills`):**
- `.claude/skills/*/skill.md` - Skill definition files

**Learnings (`--learnings`):**
- `.workflow/state/feedback-patterns.md` - Team learnings and patterns
- `.claude/skills/*/knowledge/` - Skill patterns and learnings

**Templates (`--templates`):**
- `.workflow/templates/` - HBS templates for CLAUDE.md generation (claude-md.hbs, partials/)
- `templates/` - Story, bug report, correction, task templates
- `.workflow/state/*.template` - State file init templates

## What is EXCLUDED (Session-Specific)

These are NEVER exported regardless of flags:
- `request-log.md` - Session request history
- `progress.md` - Session progress notes
- `session-state.json` - Current session state
- `ready.json` - Active task queue
- `epics.json` - Active epics
- `prompt-history.json` - Prompt history
- `last-review.json` - Last review results
- `app-map.md` - Project-specific component registry (opt-in with --include-app-map)
- `function-map.md` - Project-specific function registry
- `api-map.md` - Project-specific API registry

## CLI

Run the export script directly:

```bash
./scripts/flow export-profile my-team --full
```

## Import a Profile

After installing WogiFlow, import a team profile:

```bash
npm install -D wogiflow
npx flow import-profile ~/my-team.zip
```

## What This Enables

Export from project A, import into project B → identical code standards:
- Same coding rules and conventions enforced
- Same security patterns checked
- Same review checklists applied
- Same quality gates and config
- Same skill definitions available
- No session history or project-specific state carried over
