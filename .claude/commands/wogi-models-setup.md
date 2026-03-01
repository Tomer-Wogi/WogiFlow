---
description: "Configure external models for peer review and hybrid mode"
---
Configure external models for WogiFlow features (peer review, hybrid mode).

## Overview

This wizard helps you set up external LLM providers:
- **OpenAI** (GPT-4o, o1)
- **Google** (Gemini)
- **Anthropic** (Claude - for peer review)
- **Local LLM** (Ollama, LM Studio)

Configured models are shared between:
- `/wogi-peer-review` - Multi-model code review
- `/wogi-hybrid` - Local/cloud execution mode

## Setup Flow

### Step 1: Provider Selection

Use AskUserQuestion to let user select which providers to configure:

```javascript
{
  question: "Which AI providers do you want to configure?",
  header: "Providers",
  multiSelect: true,
  options: [
    { label: "OpenAI", description: "GPT-4o, GPT-4o-mini, o1 models" },
    { label: "Google (Gemini)", description: "Gemini 2.0 Flash, Gemini Pro" },
    { label: "Anthropic", description: "Claude models (for peer review comparison)" },
    { label: "Local LLM", description: "Ollama or LM Studio (free, runs on your machine)" }
  ]
}
```

### Step 2: Configure Each Selected Provider

For each selected provider, run the appropriate setup:

#### OpenAI Setup

1. Ask for API key:
   ```
   Please paste your OpenAI API key (starts with sk-):
   ```

2. Test connection:
   ```bash
   node -e "require('./scripts/flow-model-config').testProviderConnection('openai').then(r => console.log(JSON.stringify(r)))"
   ```

3. If successful, ask which models to enable:
   ```javascript
   {
     question: "Which OpenAI models do you want to enable?",
     header: "OpenAI Models",
     multiSelect: true,
     options: [
       { label: "gpt-4o (Recommended)", description: "Best quality, good speed" },
       { label: "gpt-4o-mini", description: "Faster, cheaper, still capable" },
       { label: "o1-mini", description: "Advanced reasoning, slower" }
     ]
   }
   ```

4. Save configuration:
   ```javascript
   const modelConfig = require('./scripts/flow-model-config');
   modelConfig.addProvider('openai', {
     apiKey: userProvidedKey,
     models: selectedModels
   });
   ```

#### Google (Gemini) Setup

1. Ask for API key:
   ```
   Please paste your Google AI API key (get one at https://aistudio.google.com/apikey):
   ```

2. Test and select models (similar to OpenAI):
   - gemini-2.0-flash-exp (Recommended)
   - gemini-1.5-flash
   - gemini-1.5-pro

#### Anthropic Setup

1. Ask for API key:
   ```
   Please paste your Anthropic API key (starts with sk-ant-):
   ```

2. Select models:
   - claude-sonnet-4 (Recommended)
   - claude-3-5-haiku
   - claude-opus-4

Note: Anthropic models are mainly useful for peer review to get different perspectives.

#### Local LLM Setup

1. Auto-detect local providers:
   ```bash
   # Test Ollama
   curl -s http://localhost:11434/api/tags 2>/dev/null | head -1

   # Test LM Studio
   curl -s http://localhost:1234/v1/models 2>/dev/null | head -1
   ```

2. If detected, list available models and let user select.

3. If not detected, show instructions:
   ```
   No local LLM detected. To use local models:

   Option 1: Install Ollama
     1. Visit https://ollama.ai
     2. Install and run: ollama pull qwen2.5-coder:7b
     3. Re-run /wogi-models-setup

   Option 2: Install LM Studio
     1. Visit https://lmstudio.ai
     2. Download and load a model
     3. Start the server
     4. Re-run /wogi-models-setup
   ```

### Step 3: Set Defaults (Optional)

Ask user about default preferences:

```javascript
{
  question: "Which models should be used by default for peer review?",
  header: "Peer Review Default",
  multiSelect: true,
  options: [
    // Show only configured models
    { label: "openai:gpt-4o", description: "..." },
    { label: "google:gemini-2.0-flash", description: "..." }
  ]
}
```

### Step 3.5: Include Claude in Peer Reviews (Optional)

Ask if Claude should also participate as a reviewer:

```javascript
{
  question: "Include Claude as a peer reviewer?",
  header: "Claude Review",
  multiSelect: false,
  options: [
    {
      label: "Yes (Recommended)",
      description: "Claude also reviews alongside external models for an extra perspective"
    },
    {
      label: "No",
      description: "Only use external models for peer review"
    }
  ]
}
```

Save to config:
```javascript
const modelConfig = require('./scripts/flow-model-config');
modelConfig.setIncludeClaude(userSelectedYes);
```

**Why include Claude?**
- Provides additional perspective from the orchestrating model
- Can leverage full conversation context when reviewing
- Catches things external models might miss due to context limitations

### Step 4: Summary

Display configuration summary:

```
╔══════════════════════════════════════════════════════════╗
║  Model Configuration Complete                             ║
╚══════════════════════════════════════════════════════════╝

Configured Providers:
  ✓ OpenAI: gpt-4o, gpt-4o-mini
  ✓ Google: gemini-2.0-flash
  ✓ Local: qwen2.5-coder (via Ollama)

API Keys stored in: .env
Config saved to: .workflow/config.json

Default for peer review: gpt-4o, gemini-2.0-flash
Include Claude in reviews: Yes ✓
Default for hybrid mode: local:qwen2.5-coder

You can now use:
  /wogi-review      - Multi-model code review
  /wogi-hybrid      - Hybrid execution mode
  /wogi-peer-review - Same as /wogi-review
```

## Implementation Details

### Config Storage

API keys are stored as environment variable names (not values) in config:
```json
{
  "models": {
    "providers": {
      "openai": {
        "apiKeyEnv": "OPENAI_API_KEY",
        "enabled": true,
        "models": ["gpt-4o", "gpt-4o-mini"]
      }
    }
  }
}
```

Actual keys go in `.env`:
```
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIza...
```

### Migration

If old config exists (hybrid.executor or peerReview.apiKeys), migrate automatically:
```javascript
const modelConfig = require('./scripts/flow-model-config');
modelConfig.migrateOldConfig();
```

### Testing

Test any provider connection:
```bash
node scripts/flow-model-config.js test openai
node scripts/flow-model-config.js test local
```

## Error Handling

### Invalid API Key

```
✗ OpenAI connection failed: Invalid API key

Please check your API key and try again.
You can get a new key at: https://platform.openai.com/api-keys
```

### No Local LLM

```
✗ No local LLM detected

Install Ollama (recommended): https://ollama.ai
Then run: ollama pull qwen2.5-coder:7b
```

### Network Error

```
✗ Connection failed: Network error

Please check your internet connection and try again.
```

## Quick Setup (Non-Interactive)

For users who already have API keys set in environment:

```bash
# If OPENAI_API_KEY is already in environment
node -e "
const mc = require('./scripts/flow-model-config');
if (process.env.OPENAI_API_KEY) {
  mc.addProvider('openai', { models: ['gpt-4o'] });
  console.log('OpenAI configured');
}
"
```
