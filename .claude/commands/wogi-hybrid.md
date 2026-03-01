---
description: "Enable hybrid mode - Claude plans, cheaper/faster models execute"
---

# Enable Multi-Model Hybrid Execution

Hybrid mode is a **multi-model execution system** where Opus (the planning model) delegates tasks to cheaper/faster models for execution. This saves tokens while maintaining quality.

**Hybrid works with:**
- **Local LLMs** (Ollama, LM Studio) — free tokens, runs on your machine
- **Cloud models** (Haiku, Sonnet, GPT-4o-mini, Gemini Flash) — cheap tokens, fast execution
- **Mixed setups** — different models for different task types

## Step 1: Detect Available Providers

Check what's available on your system:

```bash
node scripts/flow-hybrid-detect.js providers
```

This detects:
- **Local**: Ollama (port 11434), LM Studio (port 1234)
- **Cloud**: Checks `config.json → hybrid.cloudProviders` for configured API keys

## Step 2: Choose Setup Method

### Option A: Use Unified Model Setup (Recommended)

Configure multiple providers at once (for both hybrid and peer review):

```
/wogi-models-setup
```

### Option B: Hybrid-Specific Setup

For hybrid-specific configuration only:

```bash
node scripts/flow-hybrid-interactive.js
```

### Model Selection (Session Persistent)

The executor model is selected once per session and remembered for subsequent runs.

```javascript
const modelConfig = require('./scripts/flow-model-config');

// Check if model already selected this session
const sessionModel = modelConfig.getSessionModels('hybrid');

if (sessionModel && !args.includes('--select-model')) {
  // Use session model - show brief note
  console.log(`Using executor: ${sessionModel}`);
  console.log(`(Run with --select-model to change)`);
} else {
  // Show selection if multiple models available
  const models = modelConfig.getEnabledModels();
  // Use AskUserQuestion to let user select
  // Then save: modelConfig.setSessionModels('hybrid', selectedModel);
}
```

Selection persists until `/wogi-session-end` is called.

## How Hybrid Mode Works

1. **You give me a task** — "Add user authentication"
2. **I analyze complexity** — Determine which executor model to use (smart routing)
3. **I create a plan** — Detailed steps with templates and context
4. **You review the plan** — Approve, modify, or cancel via `/wogi-hybrid-edit`
5. **Executor model runs each step** — Local LLM or cloud model
6. **I validate results** — Run lint, typecheck, and standards checks after each step
7. **I handle failures** — Escalate to Opus if executor model fails

## Smart Model Routing

Opus selects the executor model based on task complexity. The routing table is configurable in `config.json → hybrid.routing`:

| Task Type | Model Tier | Examples |
|-----------|-----------|---------|
| **Simple edits** | Cheapest (Haiku, GPT-4o-mini) | Typos, text changes, config edits |
| **Code generation** | Mid-tier (Sonnet, GPT-4o) | New functions, components, tests |
| **Documentation** | Cheapest | README, comments, docs |
| **Complex refactoring** | Planner (keep on Opus) | Multi-file restructuring — don't delegate |

**Routing decision logic:**
1. Analyze task description and acceptance criteria
2. Match against routing rules in `config.json → hybrid.routing.rules`
3. Select first available model from the matched tier
4. If no models available in tier → escalate to next tier up
5. If task is too complex for any executor → keep on Opus (don't delegate)

## Workflow Integration

Hybrid mode follows the same workflow pipeline as direct execution:

- **Phase gating**: Hybrid execution only runs in the `coding` phase
- **Explore phase**: Research findings from the explore phase are included in the executor's context
- **Standards compliance**: After each hybrid-executed edit, run standards check
- **Post-edit validation**: Lint and typecheck after every file edit
- **Criteria verification**: All acceptance criteria are verified after hybrid execution completes

**Failure escalation:**
1. Executor model fails a step → Retry with more context (up to 3 retries)
2. Still fails → Escalate to Opus to fix the issue
3. Opus fixes and resumes hybrid execution for remaining steps

## Token Savings

| Task Size | Normal (Opus) | Hybrid (mixed) | Savings |
|-----------|--------------|----------------|---------|
| Small (typo, config) | ~8K | ~2K (Haiku) | 75% |
| Medium (feature) | ~20K | ~8K (Sonnet) | 60% |
| Large (multi-file) | ~45K | ~15K (mixed) | 65% |

*Actual savings depend on model selection and task complexity.*

## Commands After Enabling

- `/wogi-hybrid-off` — Disable hybrid mode
- `/wogi-hybrid-status` — Check current configuration and routing table
- `/wogi-hybrid-edit` — Modify the execution plan before running
- `/wogi-hybrid --select-model` — Change executor model for this session

## Supported Executor Models

### Cloud Models (Recommended for Most Users)
- **Claude 3.5 Haiku** — Fast, cheap, great for simple tasks
- **Claude 3.5 Sonnet** — Balanced quality/cost for code generation
- **GPT-4o-mini** — OpenAI's cheapest code model
- **GPT-4o** — OpenAI's mid-tier model
- **Gemini 2.0 Flash** — Google's fast model
- **Gemini 1.5 Pro** — Google's mid-tier model

### Local Models (Free Tokens)
- **Qwen3-Coder 30B** — Best code quality
- **NVIDIA Nemotron 3 Nano** — Best instruction following
- **DeepSeek Coder** — Good balance

## Security

- **Local LLMs**: Code never leaves your machine
- **Cloud models**: Follow existing API key security (keys stored in env vars, never committed)
- **No code sharing**: Hybrid mode sends task plans and context, not your full codebase

Let me detect your setup and configure hybrid mode now...
