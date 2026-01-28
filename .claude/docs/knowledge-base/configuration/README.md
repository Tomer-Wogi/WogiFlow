# Configuration

How to configure WogiFlow.

---

## Location

All configuration lives in `.workflow/config.json`:

```json
{
  "version": "2.0.0",
  "projectName": "my-project",
  // ... options
}
```

---

## Quick Start

### View Current Config

```bash
cat .workflow/config.json
```

### Modify Config

```bash
# Using the config command
/wogi-config set loops.maxRetries 10

# Or edit directly
# (config is auto-reloaded)
```

---

## Configuration Categories

| Category | What It Controls |
|----------|------------------|
| **Execution** | Task loops, verification, quality gates |
| **Learning** | Skills, model adapters, knowledge routing |
| **Memory** | Context monitor, session state, facts |
| **Safety** | Damage control, security scanning, checkpoints |
| **Team** | Sync settings, conflict resolution |
| **Development** | Figma, traces, MCP |

---

## Key Trade-offs

### Token Usage vs Quality

```json
{
  "loops": {
    "maxRetries": 5,      // Higher = more tokens, better results
    "maxIterations": 20   // Higher = more tokens, better results
  }
}
```

### Speed vs Control

```json
{
  "parallel": {
    "autoExecute": false  // true = faster, less control
  },
  "storyDecomposition": {
    "autoDecompose": false  // true = faster, less input
  }
}
```

### Strictness vs Flexibility

```json
{
  "enforcement": {
    "strictMode": true    // true = more gates, better quality
  },
  "qualityGates": {
    "feature": {
      "require": ["tests"]  // More gates = slower, better quality
    }
  }
}
```

---

## Common Configurations

### Minimal (Fast, Flexible)

```json
{
  "enforcement": {
    "strictMode": false
  },
  "loops": {
    "enforced": false,
    "maxRetries": 2
  },
  "qualityGates": {
    "feature": { "require": [] }
  }
}
```

### Strict (High Quality)

```json
{
  "enforcement": {
    "strictMode": true,
    "requirePatternCitation": true
  },
  "loops": {
    "enforced": true,
    "maxRetries": 5
  },
  "qualityGates": {
    "feature": {
      "require": ["tests", "appMapUpdate", "requestLogEntry", "review"]
    }
  }
}
```

### Cost-Optimized (Hybrid Mode)

```json
{
  "hybrid": {
    "enabled": true,
    "executor": {
      "type": "local",
      "model": "qwen2.5-coder:14b"
    }
  }
}
```

---

## Environment Variables

Some options can be set via environment:

```bash
# Team credentials
export WOGI_TEAM_API_KEY="your-key"

# Hybrid mode providers
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_API_KEY="AI..."
export GROQ_API_KEY="gsk_..."

# Voice input
export OPENAI_API_KEY="sk-..."  # For Whisper
```

---

## Config Inheritance

Config can be layered:

1. **Default** - Built into wogi-flow
2. **Project** - `.workflow/config.json`
3. **Profile** - Imported via `/wogi-import`
4. **Runtime** - Set via `/wogi-config`

Later layers override earlier ones.

---

## Validation

Config is validated on load:

```
Config validation errors:
  - loops.maxRetries: must be a number
  - enforcement.strictMode: must be boolean
```

Invalid config falls back to defaults.

---

## Reference

See [all-options.md](./all-options.md) for complete configuration reference with all 200+ options.

---

## Related

- [All Options](./all-options.md) - Complete reference
- [Task Execution](../02-task-execution/) - Execution config details
