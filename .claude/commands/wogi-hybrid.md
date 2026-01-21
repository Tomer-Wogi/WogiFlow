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

## Hybrid Mode Intelligence (v2.1)

Hybrid mode now includes intelligent features that learn from each execution:

### Model Learning Profiles

Each executor model gets its own learning profile at `.workflow/state/model-profiles/`.
The system learns:
- What context each model needs for success
- Common failure patterns to avoid
- Optimal example count and instruction richness

```bash
# View model profiles
node scripts/flow-model-profile.js list

# Get profile for specific model
node scripts/flow-model-profile.js get qwen3-coder

# Get instruction richness recommendation
node scripts/flow-model-profile.js richness qwen3-coder create --json
```

### Task Type Classification

Tasks are automatically classified as:
- **create** - New files/components
- **modify** - Edit existing files
- **refactor** - Structural changes
- **fix** - Bug fixes
- **integrate** - Connect systems

Each type loads specific context and follows learned patterns.

```bash
# Classify a task
node scripts/flow-task-classifier.js classify "Add user authentication"

# Get context for task type
node scripts/flow-task-classifier.js context create
```

### Failure Learning

When execution fails, the system:
1. Asks the executor what information was missing
2. Updates the model profile with learnings
3. Retries with enhanced context

```bash
# View learning statistics
node scripts/flow-failure-learning.js stats

# View recent learnings
node scripts/flow-failure-learning.js recent qwen3-coder
```

### Cheaper Context Generation

Context is generated using the cheapest appropriate model:
- **Scripts**: File listing, export extraction (free)
- **Haiku**: Import mapping, PIN generation (cheap)
- **Sonnet**: Pattern identification (moderate)
- **Opus**: Architecture analysis (only when needed)

```bash
# Generate project context
node scripts/flow-context-generator.js generate --verbose
```

Let me detect your local LLM setup now...
