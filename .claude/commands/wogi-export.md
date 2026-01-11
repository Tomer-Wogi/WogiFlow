Export workflow configuration as a shareable profile.

**v2.1**: Enhanced with rules, learnings, and templates export.

## Usage

```bash
/wogi-export my-team              # Core files only
/wogi-export my-team --rules      # Include rules and decisions
/wogi-export my-team --learnings  # Include feedback patterns and skill learnings
/wogi-export my-team --full       # Include everything
```

## Options

| Flag | Includes |
|------|----------|
| (none) | CLAUDE.md, agents/, config.json |
| `--rules` | + decisions.md, .claude/rules/ |
| `--learnings` | + feedback-patterns.md, skill learnings |
| `--templates` | + project and roadmap templates |
| `--full` | All of the above |
| `--include-decisions` | Legacy: just decisions.md |
| `--include-app-map` | Include app-map.md (usually project-specific) |

## Export Categories

**Core (always included):**
- CLAUDE.md - Core workflow instructions
- agents/*.md - Agent personas
- .workflow/config.json - Configuration

**Rules & Decisions (`--rules`):**
- .workflow/state/decisions.md - Project rules
- .claude/rules/*.md - Auto-synced coding rules

**Learnings (`--learnings`):**
- .workflow/state/feedback-patterns.md - Team learnings
- .claude/skills/*/knowledge/ - Skill patterns and learnings

**Templates (`--templates`):**
- templates/project-template.md - Project spec template
- templates/roadmap-template.md - Roadmap template

## Output

```
╔══════════════════════════════════════════════════════════╗
║  Exporting Profile: my-team                               ║
╚══════════════════════════════════════════════════════════╝

Core Files:
  ✓ CLAUDE.md
  ✓ agents/ (11 personas)
  ✓ config.json

Rules & Decisions:
  ✓ decisions.md
  ✓ .claude/rules/ (3 rules)

Learnings:
  ✓ feedback-patterns.md
  ✓ skill learnings (2 skills)

╔══════════════════════════════════════════════════════════╗
║  ✓ Profile exported successfully                          ║
╚══════════════════════════════════════════════════════════╝

  File: wogi-profiles/my-team.zip
  Size: 45K

Share this file with team members.
Import with: ./scripts/flow import-profile my-team.zip
```

## Import a Profile

After installing WogiFlow, import a team profile:

```bash
npm install wogiflow
npx flow import-profile ~/my-team.zip
```

## CLI

Run the export script directly:

```bash
./scripts/flow export-profile my-team --full
```

## What This Enables

Share with your team:
- Refined agent instructions and personas
- Coding conventions and decisions
- Skill-specific patterns and learnings
- Quality gate configuration
- Template structures
