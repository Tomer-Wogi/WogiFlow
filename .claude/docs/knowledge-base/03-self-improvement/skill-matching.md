# Skill Matching

<!-- PINS: overview, matching-flow, trigger-types, scoring, configuration, auto-invoke, debugging -->

How skills are automatically matched to task context based on keywords, file patterns, and task types.

---

## Overview
<!-- PIN: overview -->

Skill matching enables model-invoked skills - automatically loading relevant framework knowledge based on what you're working on. No manual activation required.

---

## How Matching Works
<!-- PIN: matching-flow -->

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SKILL MATCHING FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Task Context                    Matching Engine                    │
│   ────────────                    ───────────────                    │
│                                                                      │
│   Description:                                                       │
│   "Create user service"  ──────▶  Keywords: service, user           │
│                                         ↓                            │
│   Files modified:                       ↓                            │
│   users.service.ts      ──────▶  File patterns: *.service.ts        │
│                                         ↓                            │
│   Task type:                            ↓                            │
│   feature               ──────▶  Task types: feature                │
│                                         ↓                            │
│                                   ┌─────────────┐                    │
│                                   │  MATCHED:   │                    │
│                                   │  nestjs ●●●●○                    │
│                                   │  react  ●○○○○                    │
│                                   └─────────────┘                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Trigger Types
<!-- PIN: trigger-types -->

### 1. Keywords

Words in task description that trigger a skill:

```json
{
  "nestjs": {
    "keywords": ["nestjs", "module", "controller", "service", "entity", "dto"]
  },
  "react": {
    "keywords": ["react", "component", "hook", "usestate", "jsx", "tsx"]
  }
}
```

### 2. File Patterns

File extensions and naming patterns:

```json
{
  "nestjs": {
    "filePatterns": ["*.module.ts", "*.controller.ts", "*.service.ts"]
  },
  "react": {
    "filePatterns": ["*.tsx", "*.jsx", "use*.ts"]
  }
}
```

### 3. Task Types

The type of task being worked on:

```json
{
  "nestjs": {
    "taskTypes": ["feature", "bugfix", "refactor"]
  }
}
```

### 4. Categories

Broader categorization:

```json
{
  "nestjs": {
    "categories": ["backend", "api", "database"]
  }
}
```

---

## Scoring System
<!-- PIN: scoring -->

Each trigger type contributes to the match score:

| Trigger Type | Weight | Example |
|--------------|--------|---------|
| Exact keyword | +3 | "nestjs" in description |
| Partial keyword | +1 | "service" (common word) |
| File pattern | +2 | Editing `*.controller.ts` |
| Task type | +1 | feature task |
| Category | +1 | backend category |

Score display: `●●●●○` = 4/5 score

---

## Configuration
<!-- PIN: configuration -->

### Installed Skills

```json
{
  "skills": {
    "installed": ["nestjs", "react", "figma-analyzer", "python"],
    "autoInvoke": true,           // Auto-load matched skills
    "autoDiscoverNested": true,   // Auto-discover nested skills
    "minScore": 2                 // Minimum score to invoke
  }
}
```

### Nested Skills (v1.0.3+)

Skills can be organized in nested directories for better categorization:

```
.claude/skills/
├── nestjs/                    # Flat skill (traditional)
├── frontend/                  # Category directory
│   ├── react/                # Nested skill: "frontend/react"
│   └── vue/                  # Nested skill: "frontend/vue"
└── backend/                   # Category directory
    └── express/              # Nested skill: "backend/express"
```

**Nested skills are auto-discovered** when `autoDiscoverNested: true` (default).

Create nested skills:
```bash
flow skill-create frontend/react
flow skill-create backend/express
```

Reference in config:
```json
{
  "skills": {
    "installed": ["nestjs", "frontend/react", "backend/express"]
  }
}
```

**Max nesting depth**: 3 levels (e.g., `domain/category/framework`)

### Custom Triggers

Override default triggers in skill.md:

```markdown
---
name: my-skill
---

## Triggers

- keywords: ["custom", "keywords"]
- filePatterns: ["*.custom.ts"]
- taskTypes: ["feature"]
- categories: ["backend"]
```

---

## Skill Priority

When multiple skills match:

1. **Exclusive skills** (if marked) prevent others from loading
2. **Higher score** wins for conflicting patterns
3. **Explicit install** takes priority over auto-detected

---

## Auto-Invoke Behavior
<!-- PIN: auto-invoke -->

When `autoInvoke: true`:

```
/wogi-start wf-012
         ↓
Load task context
         ↓
Run skill matcher
         ↓
┌─────────────────────────────────────────┐
│ 🔧 Matched Skills:                       │
│    nestjs [●●●●○]                       │
│    keyword: "service", file: *.service.ts│
└─────────────────────────────────────────┘
         ↓
Load: .claude/skills/nestjs/knowledge/patterns.md
Load: .claude/skills/nestjs/knowledge/anti-patterns.md
```

---

## Default Triggers

Built-in triggers for common frameworks:

| Skill | Key Triggers |
|-------|--------------|
| `nestjs` | module, controller, service, entity, dto, *.module.ts |
| `react` | component, hook, useState, *.tsx, *.jsx |
| `python` | pip, django, flask, fastapi, *.py |
| `figma-analyzer` | figma, design, design-system, tokens |

> **Note**: Long input processing (transcripts, specs, requirements) is now handled automatically by the `long-input-gate` hook, not as a skill.

---

## Disabling Auto-Invoke

Per-task:
```bash
/wogi-start wf-012 --no-skills
```

Globally:
```json
{
  "skills": {
    "autoInvoke": false
  }
}
```

---

## Skill Loading Sequence

1. **Match skills** against task context
2. **Filter** by minimum score
3. **Sort** by score (highest first)
4. **Load** skill.md for each matched skill
5. **Load** knowledge files (patterns.md, anti-patterns.md)
6. **Apply** to current context

---

## Debugging Matches
<!-- PIN: debugging -->

Check why a skill was/wasn't matched:

```bash
# Show matching details
node scripts/flow-skill-matcher.js debug "create user service"

# Output:
# Task: "create user service"
#
# nestjs: 4/5
#   - keyword "service": +3
#   - category "backend": +1
#
# react: 1/5
#   - keyword "user": +1
```

---

## Best Practices

1. **Keep keywords specific** - "nestjs" over "backend"
2. **Use file patterns** - More reliable than keywords
3. **Set appropriate minScore** - Too low = noise, too high = misses
4. **Review matches** - Check output on `/wogi-start`

---

## Related

- [Skill Learning](./skill-learning.md) - How skills are created and updated
- [Task Execution](../02-task-execution/) - Where skills are applied
- [Configuration](../configuration/all-options.md) - Full skill settings
