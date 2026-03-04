# Model-Level Learning

Per-model optimization, adapters, and error pattern learning.

---

## Overview

Different LLMs have different behaviors:
- Claude excels at reasoning
- Local models may struggle with complex types
- Some models output markdown when code is expected

Model adapters learn these behaviors and optimize prompts accordingly.

---

## Configuration

```json
{
  "learning": {
    "modelAdapters": {
      "enabled": true,
      "directory": ".workflow/model-adapters"
    }
  }
}
```

---

## Model Adapter Structure

```
.workflow/model-adapters/
├── claude-sonnet.json
├── qwen3-coder.json
├── gpt-4o-mini.json
└── llama-3.json
```

### Adapter Content

```json
{
  "modelId": "qwen3-coder",
  "lastUpdated": "2024-01-15T10:30:00Z",
  "stats": {
    "totalRequests": 150,
    "successRate": 0.87,
    "avgRetries": 1.3
  },
  "behaviors": {
    "outputFormat": {
      "tendency": "markdown-wrapped",
      "adjustment": "Specify: Output ONLY code, no markdown"
    },
    "typeHandling": {
      "tendency": "struggles-with-generics",
      "adjustment": "Simplify complex types in prompt"
    }
  },
  "errorPatterns": [
    {
      "signature": "unexpected-markdown",
      "frequency": 23,
      "recovery": "strip-markdown-fences"
    },
    {
      "signature": "import-not-found",
      "frequency": 15,
      "recovery": "provide-import-paths"
    }
  ],
  "promptAdjustments": {
    "prefix": "Output ONLY TypeScript code. No explanations.",
    "suffix": "",
    "temperature": 0.5
  }
}
```

---

## Auto-Learning

When model adapter learning is enabled:

```
Request to LLM
      ↓
Success/Failure recorded
      ↓
┌─────────────────────────────────────────┐
│ Analyze error patterns                  │
│ - Same error 3+ times?                 │
│ - Known fix available?                  │
│ - Prompt adjustment helps?              │
└─────────────────────────────────────────┘
      ↓
Update model adapter
      ↓
Apply learnings to future requests
```

---

## Error Categories

| Category | Description | Recovery |
|----------|-------------|----------|
| `import` | Import path errors | Provide explicit paths |
| `type` | Type mismatches | Simplify types |
| `syntax` | Markdown in output | Strip formatting |
| `runtime` | Logic errors | Add validation |
| `unknown` | Unclassified | Log for analysis |

---

## Adaptive Learning

From `flow-adaptive-learning.js`:

### Error Analysis

```javascript
analyzeFailure(error, context) {
  // Categorize the error
  // Extract signature
  // Check against known patterns
  // Suggest recovery strategy
}
```

### Prompt Refinement

```javascript
refinePromptForRetry(originalPrompt, errorHistory) {
  // Learn from failure pattern
  // Adjust prompt for retry
  // Apply model-specific fixes
}
```

### Success Recording

```javascript
recordSuccessfulRecovery(modelId, errorSignature, recoveryStrategy) {
  // Track what worked
  // Update adapter with learning
  // Improve future success rate
}
```

---

## Prompt Adjustments

Model adapters can modify prompts:

### Prefix Adjustments

```json
{
  "promptAdjustments": {
    "prefix": "You are a code generator. Output ONLY valid TypeScript code."
  }
}
```

### Temperature Adjustments

```json
{
  "promptAdjustments": {
    "temperature": 0.3    // Lower for more deterministic output
  }
}
```

### Context Window

```json
{
  "promptAdjustments": {
    "maxContextTokens": 4096    // Limit for smaller models
  }
}
```

---

## Recovery Strategies

When errors occur, adapters suggest recovery:

### Markdown Stripping

For models that wrap code in markdown:
```javascript
if (errorCategory === 'syntax' && signature === 'unexpected-markdown') {
  // Strip ```typescript and ``` fences
  code = code.replace(/```\w*\n?/g, '');
}
```

### Import Path Resolution

For import errors:
```javascript
if (errorCategory === 'import') {
  // Provide explicit import map in retry prompt
  prompt += `\n\nAvailable imports:\n${formatImportMap()}`;
}
```

### Type Simplification

For type errors:
```javascript
if (errorCategory === 'type') {
  // Simplify generic types in prompt
  prompt = simplifyTypes(prompt);
}
```

---

## Hybrid Mode Integration

Model adapters are crucial for hybrid mode:

```json
{
  "hybrid": {
    "planner": {
      "adaptToExecutor": true,         // Use adapter knowledge
      "useAdapterKnowledge": true
    }
  }
}
```

### How It Works

1. **Plan Creation**: Claude creates detailed plan
2. **Adapter Lookup**: Find adapter for executor model
3. **Prompt Adjustment**: Apply model-specific modifications
4. **Execution**: Send optimized prompt to local LLM
5. **Error Handling**: Use adapter's recovery strategies
6. **Learning**: Record outcomes for future improvement

---

## Statistics Tracking

```json
{
  "stats": {
    "totalRequests": 150,
    "successRate": 0.87,
    "avgRetries": 1.3,
    "errorBreakdown": {
      "import": 15,
      "type": 8,
      "syntax": 23,
      "runtime": 4
    }
  }
}
```

Used for:
- Identifying problematic patterns
- Measuring improvement over time
- Choosing best model for task type

---

## Manual Adapter Configuration

Create custom adapter:

```bash
cat > .workflow/model-adapters/custom-model.json << 'EOF'
{
  "modelId": "custom-model",
  "behaviors": {
    "outputFormat": {
      "tendency": "verbose-explanations",
      "adjustment": "Be concise. Code only."
    }
  },
  "promptAdjustments": {
    "prefix": "You are a TypeScript expert. Output clean, typed code.",
    "temperature": 0.4
  }
}
EOF
```

---

## Viewing Model Performance

```bash
# Check adapter stats
cat .workflow/model-adapters/qwen3-coder.json | jq '.stats'

# Output:
# {
#   "totalRequests": 150,
#   "successRate": 0.87,
#   "avgRetries": 1.3
# }
```

---

## Best Practices

1. **Let Adapter Learning Work**: Don't manually edit adapters frequently
2. **Review Error Patterns**: Check what's failing most
3. **Test Different Models**: Some models work better for certain tasks
4. **Lower Temperature**: For code generation, 0.3-0.5 is often better
5. **Provide Clear Examples**: Models learn from explicit patterns

---

## Related

- [Project Learning](./project-learning.md) - Project-specific patterns
- [Skill Learning](./skill-learning.md) - Framework patterns
- [Hybrid Mode](../02-task-execution/02-execution-loop.md#hybrid-mode)
