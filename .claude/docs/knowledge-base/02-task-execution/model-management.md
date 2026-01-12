# Model Management

Registry, routing, and statistics for LLM models.

---

## Overview

WogiFlow supports multiple LLM providers and tracks performance to optimize model selection.

---

## Model Registry

**Script**: `flow-models.js`

```bash
# List all registered models
flow models list

# Show detailed model info
flow models info <model>

# Get routing recommendation for task type
flow models route <task-type>

# Show performance statistics
flow models stats

# Show cost analysis
flow models cost
```

### Model List Output

```
Registered Models
════════════════════════════════════════
  claude-sonnet-4      Anthropic    200K context   $$
  claude-opus-4        Anthropic    200K context   $$$
  gpt-4o              OpenAI        128K context   $$
  gemini-2.0-flash    Google        1M context     $
  ollama-qwen         Local         32K context    Free
```

---

## Intelligent Routing

**Script**: `flow-model-router.js`

```bash
# Get routing recommendation
flow route "<task description>"

# Use specific strategy
flow route --strategy quality-first "<task>"
flow route --strategy cost-optimized "<task>"
flow route --strategy learned "<task>"
```

### Routing Strategies

| Strategy | Description |
|----------|-------------|
| `quality-first` | Prefer most capable model |
| `cost-optimized` | Minimize cost while meeting requirements |
| `learned` | Use historical success rates |

### Routing Factors

- Task complexity (estimated tokens)
- Required capabilities (code, reasoning, context)
- Historical success rate per model
- Cost constraints

---

## Cascade Fallback

**Script**: `flow-cascade.js`

Automatically try alternate models on repeated failures.

```bash
# Show cascade state
flow cascade status

# Reset failure tracking
flow cascade reset

# Show configuration
flow cascade config
```

### Configuration

```json
{
  "cascade": {
    "enabled": true,
    "fallbackModel": "claude-sonnet-4",
    "maxFailuresBeforeEscalate": 3,
    "escalateOnCategories": ["capability_mismatch", "context_overflow"]
  }
}
```

### How Cascade Works

1. Primary model fails 3x on same error category
2. System escalates to fallback model
3. Success rate tracked for future routing
4. Failure count resets after successful completion

---

## Model Adapter

**Script**: `flow-model-adapter.js`

Per-model prompt adaptations and learned corrections.

```bash
# Show current adapter info
flow model-adapter

# Show per-model statistics
flow model-adapter --stats
```

### Adapter Files

Located in `.workflow/model-adapters/`:

```
├── claude-default.md      # Claude family defaults
├── claude-sonnet-4.md     # Sonnet-specific
├── ollama-qwen.md         # Local model adapter
└── _template.md           # New adapter template
```

### Adapter Contents

- Prompt style preferences
- Known limitations
- Learned corrections
- Success patterns

---

## Performance Stats

```bash
flow models stats
```

### Output Example

```
Model Performance Statistics
════════════════════════════════════════
Model               Success   Avg Time   Tasks
────────────────────────────────────────
claude-sonnet-4     94%       12.3s      234
claude-opus-4       98%       45.2s      45
ollama-qwen         78%       8.5s       156
gpt-4o              91%       15.1s      89
```

---

## Tiered Learning

**Script**: `flow-tiered-learning.js`

```bash
# Show patterns by confidence tier
flow learning tiers

# Show learning statistics
flow learning stats

# Manually apply a pattern
flow learning apply <pattern-id>
```

### Learning Tiers

| Tier | Confidence | Behavior |
|------|------------|----------|
| Auto-Apply | 90%+ | Applied without prompt |
| Apply with Log | 70-90% | Applied, logged for review |
| Queue for Review | <70% | Held for manual approval |

---

## Related

- [Execution Loop](./02-execution-loop.md) - How models are invoked
- [Hybrid Mode](./02-execution-loop.md#hybrid-mode) - Multi-model orchestration
- [Memory Commands](../04-memory-context/memory-commands.md) - Learning storage
