---
description: Enable hybrid mode - Claude plans, local LLM executes
---

# Enable Hybrid Mode

Hybrid mode allows me to create execution plans that are executed by a local LLM (Ollama or LM Studio), saving tokens while maintaining quality.

## Step 1: Detect Local LLM Providers

Let me check what's available on your system:

```bash
node scripts/flow-hybrid-detect.js providers
```

## Step 2: Choose Setup Method

### Option A: Use Unified Model Setup (Recommended)

If you want to configure multiple providers at once (for both hybrid and peer review):

```
/wogi-models-setup
```

This configures all your models in one place.

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
  // Proceed with hybrid mode using sessionModel
} else {
  // Show selection if multiple models available
  const models = modelConfig.getEnabledModels();
  // Use AskUserQuestion to let user select
  // Then save: modelConfig.setSessionModels('hybrid', selectedModel);
}
```

Selection persists until `/wogi-session-end` is called.

## How Hybrid Mode Works

1. **You give me a task** - "Add user authentication"
2. **I create a plan** - Detailed steps with templates
3. **You review the plan** - Approve, modify, or cancel
4. **Local LLM executes** - Each step runs on your machine
5. **I handle failures** - Escalate to me if local LLM fails

## Token Savings

Typical savings: **20-60%** (depending on task complexity)
- Planning: ~1,500-5,000 tokens (Claude)
- Execution: Local LLM (free) or Cloud model (paid but cheaper)
- Detailed instructions needed for quality results
- Only escalations use additional Claude tokens

## Commands After Enabling

- `/wogi-hybrid-off` - Disable hybrid mode
- `/wogi-hybrid-status` - Check current configuration
- `/wogi-hybrid-edit` - Modify plan before execution
- `/wogi-hybrid --select-model` - Change executor model for this session

## Supported Models

Recommended models for code generation:
- **NVIDIA Nemotron 3 Nano** - Best instruction following
- **Qwen3-Coder 30B** - Best code quality
- **DeepSeek Coder** - Good balance

Let me detect your local LLM setup now...
