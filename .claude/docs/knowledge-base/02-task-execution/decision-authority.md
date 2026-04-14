# Decision Authority Framework

Automatically classifies which decisions the AI can make autonomously vs which require human approval.

---

## Overview

During task execution, the AI faces many decisions: naming conventions, error handling strategy, library choice, API shape, UX behavior. Without structure, it either asks too many questions (blocking progress) or makes too many autonomous choices (surprising the developer).

The Decision Authority Framework classifies every decision into one of four authority levels, with configurable defaults per category.

---

## Authority Levels

| Level | Action |
|-------|--------|
| `agent-decides` | Decide autonomously. Report only in completion summary. |
| `agent-decides-report-after` | Decide autonomously. Explicitly state the decision after implementing. |
| `owner-decides` | Present to user. Wait for answer before proceeding. |
| `auto-fix-report-after` | Fix automatically. Report what was fixed after. |

---

## Default Categories

| Category | Default Authority | Rationale |
|----------|------------------|-----------|
| Engineering | `agent-decides` | Code structure, patterns — AI competent |
| Naming | `agent-decides` | Variable/function names — low risk |
| Infrastructure | `agent-decides-report-after` | Build config, deps — report for awareness |
| Performance | `agent-decides-report-after` | Optimization choices — report for awareness |
| Product Behavior | `owner-decides` | Feature behavior — human judgment needed |
| UX | `owner-decides` | User-facing design — human judgment needed |
| Security | `auto-fix-report-after` | Vulnerabilities — fix immediately, report after |

---

## Batch Enforcement

When multiple decisions arise in a single task:
- Decisions are batched and classified together
- If `owner-decides` questions exceed `maxOwnerQuestionsPerBatch` (default: 5), overflow is automatically downgraded to `agent-decides-report-after`
- This prevents question flooding (12+ questions blocking progress)

---

## Low-Confidence Fallback

When the classifier cannot confidently categorize a decision, it defaults to `owner-decides` — the safest fallback. Better to ask unnecessarily than to make an unauthorized autonomous decision.

---

## Usage

### Classify a decision

```bash
node node_modules/wogiflow/scripts/flow-decision-authority.js classify "Should we use Redis or in-memory cache?"
```

### Batch classify

```bash
node node_modules/wogiflow/scripts/flow-decision-authority.js batch '[
  "Should we use Redis or in-memory cache?",
  "Name for the cache service class?",
  "Add rate limiting to the endpoint?"
]'
```

### Update category authority

Users can change defaults via `/wogi-decide`:

```
"from now on, just fix infrastructure decisions yourself"
→ Updates infrastructure category to agent-decides
```

---

## Configuration

```json
{
  "decisionAuthority": {
    "enabled": true,
    "maxOwnerQuestionsPerBatch": 5,
    "categories": {
      "engineering": "agent-decides",
      "naming": "agent-decides",
      "infrastructure": "agent-decides-report-after",
      "performance": "agent-decides-report-after",
      "productBehavior": "owner-decides",
      "ux": "owner-decides",
      "security": "auto-fix-report-after"
    }
  }
}
```

---

## Related

- [Task Planning](./01-task-planning.md) — Where decisions arise during planning
- [Execution Loop](./02-execution-loop.md) — Decisions during implementation
- [Rules Management](../03-self-improvement/rules-management.md) — `/wogi-decide` for permanent rules
