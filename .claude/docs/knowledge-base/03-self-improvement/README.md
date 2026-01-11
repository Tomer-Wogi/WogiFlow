# Self-Improvement & Learning

How WogiFlow learns and improves over time through feedback, corrections, and pattern recognition.

---

## The Learning System

WogiFlow learns at four levels:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LEARNING HIERARCHY                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌───────────────┐                                                │
│   │ 4. Team Level │ ← Cross-project patterns, shared knowledge     │
│   └───────┬───────┘                                                │
│           │                                                         │
│   ┌───────▼───────┐                                                │
│   │ 3. Model Level│ ← Per-model optimizations, error patterns      │
│   └───────┬───────┘                                                │
│           │                                                         │
│   ┌───────▼───────┐                                                │
│   │ 2. Skill Level│ ← Framework patterns, anti-patterns           │
│   └───────┬───────┘                                                │
│           │                                                         │
│   ┌───────▼───────┐                                                │
│   │1. Project Level│ ← decisions.md, feedback patterns             │
│   └───────────────┘                                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why Learning Matters

**The Problem**: AI makes the same mistakes repeatedly because it doesn't remember corrections.

**The Solution**: WogiFlow captures corrections and patterns, then applies them to future work:
- Corrections update decisions.md
- Patterns are extracted into skills
- Model-specific behaviors are adapted
- Team knowledge is shared

---

## Quick Start

### Enable Learning

```json
{
  "skillLearning": {
    "enabled": true,
    "autoExtract": true,
    "autoCreateSkills": "ask"
  }
}
```

### Trigger Learning

- **Automatic**: On task completion, commits, compaction
- **Manual**: Correction reports, feedback patterns

### View Learnings

```bash
# View current decisions
cat .workflow/state/decisions.md

# View feedback patterns
cat .workflow/state/feedback-patterns.md

# View skill learnings
cat .claude/skills/*/knowledge/patterns.md
```

---

## Features in This Category

| Feature | Purpose |
|---------|---------|
| [Project Learning](./project-learning.md) | decisions.md updates, feedback patterns |
| [Skill Learning](./skill-learning.md) | Framework patterns, skill creation |
| [Model Learning](./model-learning.md) | Per-model optimization, adapters |
| [Team Learning](./team-learning.md) | Knowledge routing, promotion |

---

## Key Configuration

```json
{
  "skillLearning": {
    "enabled": true,
    "autoExtract": true,
    "triggers": {
      "onCommit": true,
      "onTaskComplete": true,
      "onCompact": true
    },
    "minCorrectionsToLearn": 1,
    "autoCreateSkills": "ask"
  },
  "modelAdapters": {
    "enabled": true,
    "autoLearn": true
  },
  "knowledgeRouting": {
    "autoDetect": true,
    "confirmWithUser": true,
    "defaultScope": "local"
  }
}
```

---

## The Feedback Loop

```
User Corrects AI
      ↓
┌─────────────────────────────────────────┐
│ 1. Fix the immediate issue              │
├─────────────────────────────────────────┤
│ 2. Offer to persist correction          │
│    - decisions.md (project)             │
│    - agents/*.md (personas)             │
│    - config.json (behavior)             │
│    - .claude/skills/*/patterns.md (framework)   │
├─────────────────────────────────────────┤
│ 3. Update selected location             │
├─────────────────────────────────────────┤
│ 4. Log to feedback-patterns.md          │
├─────────────────────────────────────────┤
│ 5. Commit learning                      │
└─────────────────────────────────────────┘
      ↓
Future work uses new knowledge
```

---

## Learning Locations

| What | Where | Updated By |
|------|-------|------------|
| Coding patterns | `decisions.md` | AI + User |
| Agent behaviors | `agents/*.md` | AI + User |
| Config settings | `config.json` | AI + User |
| Framework patterns | `.claude/skills/*/patterns.md` | AI |
| Model behaviors | `model-adapters/*.md` | System |
| Feedback history | `feedback-patterns.md` | System |

---

## Correction Types

| Type | Example | Persists To |
|------|---------|-------------|
| Pattern | "Always use axios wrapper" | decisions.md |
| Style | "Don't use semicolons" | decisions.md |
| Architecture | "Services go in /services" | decisions.md |
| Framework | "NestJS uses decorators" | .claude/skills/nestjs/patterns.md |
| Behavior | "Ask before deleting files" | config.json |
| Agent | "Tester should mock external APIs" | agents/tester.md |

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-skill-learn` | Trigger learning extraction |
| `/wogi-correction` | Create detailed correction report |
| `/wogi-rules` | View and manage project rules |

---

## Best Practices

1. **Correct Once, Persist Forever**: Always choose to persist corrections
2. **Be Specific**: "Use axios from lib/api" not just "use axios"
3. **Review Learnings**: Periodically check decisions.md for accuracy
4. **Share Team Patterns**: Promote valuable patterns to team level
5. **Clean Up Outdated**: Remove patterns that no longer apply

---

## Related

- [Task Execution](../02-task-execution/) - Where learnings are applied
- [Memory & Context](../04-memory-context/) - How learnings are stored
- [Configuration](../configuration/all-options.md) - Learning settings
