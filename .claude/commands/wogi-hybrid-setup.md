---
description: Set up hybrid mode - configure executor models for multi-model execution
---

# Hybrid Mode Setup

This command sets up everything needed for multi-model hybrid execution in your project.

## Step 1: Choose Executor Type

### Cloud Models (Recommended — Easiest Setup)

If you have API keys for any of these providers, hybrid mode works immediately:

| Provider | Cheapest Model | Mid-tier Model | Env Variable |
|----------|---------------|----------------|--------------|
| Anthropic | Claude 3.5 Haiku | Claude 3.5 Sonnet | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4o-mini | GPT-4o | `OPENAI_API_KEY` |
| Google | Gemini 2.0 Flash | Gemini 1.5 Pro | `GOOGLE_API_KEY` |

**Quick setup**: If you already have `ANTHROPIC_API_KEY` set (which you do if you use Claude Code), Haiku and Sonnet are ready to use as executors.

### Local Models (Free Tokens)

For local LLM execution, you need Ollama or LM Studio running:

**Ollama:**
```bash
ollama serve
ollama pull qwen3-coder  # or your preferred model
```

**LM Studio:**
- Open the app → Download a model → Start the local server

### Mixed Setup (Best of Both)

Configure both local and cloud models. Hybrid mode will select the best executor based on task type:
- Simple edits → Local LLM (free) or Haiku (cheapest cloud)
- Code generation → Sonnet or GPT-4o (mid-tier cloud)
- Complex work → Keep on Opus (no delegation)

## Step 2: Generate Project Templates

Analyzing your codebase and generating customized templates:

```bash
node scripts/flow-templates.js generate
```

This creates templates in `templates/hybrid/` that teach executor models your project's patterns.

## Step 3: Configure Hybrid Mode

### Option A: Use Unified Model Setup (Recommended)

Configures all your models in one place:

```
/wogi-models-setup
```

### Option B: Interactive Setup

Runs the hybrid-specific setup wizard:

```bash
node scripts/flow-hybrid-interactive.js
```

## Step 4: Configure Smart Routing (Optional)

Edit `config.json → hybrid.routing` to customize which models handle which task types:

```json
{
  "hybrid": {
    "routing": {
      "enabled": true,
      "rules": [
        { "taskType": "simple-edit", "model": "cheapest" },
        { "taskType": "code-generation", "model": "mid-tier" },
        { "taskType": "refactoring", "model": "planner" },
        { "taskType": "documentation", "model": "cheapest" }
      ],
      "tiers": {
        "cheapest": ["claude-3-5-haiku-latest", "gpt-4o-mini", "gemini-2.0-flash-exp"],
        "mid-tier": ["claude-3-5-sonnet-latest", "gpt-4o", "gemini-1.5-pro"],
        "planner": "current"
      }
    }
  }
}
```

## What This Does

1. **Analyzes your project** — Detects framework, state management, styling
2. **Generates templates** — Customized task templates in `templates/hybrid/`
3. **Configures executor(s)** — Sets up cloud and/or local model connections
4. **Tests connections** — Verifies executor models respond correctly
5. **Enables routing** — Configures smart model selection based on task type

## After Setup

Use these commands:
- `/wogi-hybrid` — Enable hybrid mode and start using it
- `/wogi-hybrid-status` — Check configuration and routing table
- `/wogi-hybrid-off` — Disable hybrid mode
- `/wogi-hybrid-edit` — Edit plans before execution

## Token Savings

| Task Size | Normal (Opus) | Hybrid (mixed) | Savings |
|-----------|--------------|----------------|---------|
| Small | ~8K | ~2K | 75% |
| Medium | ~20K | ~8K | 60% |
| Large | ~45K | ~15K | 65% |

*Savings vary based on executor model selection and task complexity.*

Let me set up hybrid mode for your project now...
