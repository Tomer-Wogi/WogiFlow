---
description: "Import a team workflow profile"
---
Import a team workflow profile.

**v3.0**: Imports complete enforcement profile — rules, skills, templates, review checklists, tech stack.

## Usage

```bash
/wogi-import team-v2.zip              # Import from zip
/wogi-import team-v2.zip --backup     # Backup first
/wogi-import team-v2.zip --dry-run    # Preview without changes
/wogi-import --scan ../other-project  # Scan another project for patterns
```

## Options

| Flag | Description |
|------|-------------|
| `--backup` | Create backup of current config before importing |
| `--dry-run` | Show what would be imported without making changes |
| `--force` | Overwrite without confirmation |
| `--skip-learnings` | Don't import learnings (feedback-patterns, skill learnings) |
| `--skip-rules` | Don't import rules (.claude/rules/, agents, stack) |
| `--skip-templates` | Don't import templates |
| `--scan <folder>` | Scan another project folder for patterns (scan mode) |
| `--strict` | Enable strict adherence mode (with --scan) |
| `--resolve-conflicts` | Interactive conflict resolution (with --scan) |
| `--analysis-mode MODE` | Analysis depth: `balanced` (default), `deep` |

## What Gets Imported

**Core (always):**
- CLAUDE.md (replaced)
- agents/ (replaced)
- config.json (smart-merged — your overrides preserved)

**Rules & Standards:**
- decisions.md (appended to existing)
- .claude/rules/ (recursive tree — security, code-style, architecture, operations)
- .workflow/agents/ (review checklists)
- .claude/docs/stack.md (tech stack)

**Skills:**
- .claude/skills/*/skill.md (skill definitions)
- .claude/skills/*/knowledge/ (patterns + learnings, appended)

**Templates:**
- .workflow/templates/ (HBS files for CLAUDE.md generation)
- templates/ (story, bug, task templates — only if not exists)
- .workflow/state/*.template (init templates)

**Learnings:**
- feedback-patterns.md (appended)

## Merge Behavior

| Artifact | Behavior |
|----------|----------|
| CLAUDE.md | Replaced |
| agents/ | Replaced |
| config.json | Smart merge (jq if available, else replace) |
| decisions.md | Appended with separator |
| .claude/rules/ | Copied (overwrites per-file) |
| feedback-patterns.md | Appended with separator |
| skill knowledge | Appended per-file |
| skill definitions | Copied |
| templates | Copied (skip if exists) |
| state templates | Copied |

## What is NOT Imported

Session-specific data is never included in profiles:
- request-log.md, progress.md, session-state.json
- ready.json, epics.json, task-queue.json
- app-map.md (opt-in only, project-specific)
- function-map.md, api-map.md
