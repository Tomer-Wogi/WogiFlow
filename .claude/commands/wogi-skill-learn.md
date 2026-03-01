---
description: "Manually trigger skill learning extraction from recent changes"
---

# Skill Learning

This command extracts learnings from recent work and updates relevant skills.

## What It Does

1. Analyzes changed files (staged or recent commits)
2. Matches files to installed skills by pattern
3. Updates skill knowledge files:
   - `knowledge/learnings.md` - What was done
   - `knowledge/patterns.md` - What worked (on success)
   - `knowledge/anti-patterns.md` - What to avoid (on errors)
4. Logs unmatched files to `feedback-patterns.md`

## When to Use

This runs automatically on:
- **Pre-commit hook** (if hooks enabled)
- **Session end** (`/wogi-session-end`)
- **Context compaction** (`/wogi-compact`)

Use this command manually when:
- You want to extract learnings mid-session
- After fixing a significant bug
- After discovering a new pattern

## Execute

```bash
# Manual extraction from current changes
node scripts/flow-skill-learn.js --trigger=manual

# Target specific skill
node scripts/flow-skill-learn.js --skill=nestjs

# Preview without making changes
node scripts/flow-skill-learn.js --dry-run --verbose
```

## Configuration

Skill learning is controlled by `config.json`:

```json
{
  "skillLearning": {
    "enabled": true,
    "autoExtract": true,
    "triggers": {
      "onCommit": true,
      "onTaskComplete": true,
      "onCompact": true
    }
  }
}
```

## Related Commands

- `/wogi-skills` - List installed skills
- `/wogi-skill-create` - Create a new skill
- `/wogi-session-end` - End session (includes learning extraction)
