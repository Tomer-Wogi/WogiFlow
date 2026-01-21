Run a multi-model peer review where different AI models review the same code.

## Step 0: Model Selection (Every Run)

**Before starting the review, check for configured models and let user select:**

### Check Configuration

```javascript
const modelConfig = require('./scripts/flow-model-config');

// Run migration if needed (handles old config formats)
modelConfig.migrateOldConfig();

// Get enabled models
const models = modelConfig.getEnabledModels();
```

### If No Models Configured

If `models.length === 0`:

```
No external models configured for peer review.

Run /wogi-models-setup to configure:
- OpenAI (GPT-4o)
- Google (Gemini)
- Local LLM (Ollama)

Or use --manual flag for manual mode.
```

Then either:
- Auto-launch `/wogi-models-setup` wizard
- Or use `--manual` mode if user prefers

### Model Selection Dialog

If models are configured, show selection dialog using AskUserQuestion:

```javascript
{
  question: "Select models for peer review (multiple allowed):",
  header: "Models",
  multiSelect: true,
  options: [
    // Dynamically populated from configured models
    { label: "openai:gpt-4o", description: "Best quality reasoning" },
    { label: "openai:gpt-4o-mini", description: "Faster, cheaper" },
    { label: "google:gemini-2.0-flash", description: "Fast, good at code" },
    { label: "local:qwen2.5-coder", description: "Free, runs locally" }
    // ... other configured models
  ]
}
```

**Show only models that:**
1. Are configured in `models.providers`
2. Have `enabled: true`
3. Have API key set (check `process.env[apiKeyEnv]`) or are local

### After Selection

Save the selection for future runs (optional):
```javascript
modelConfig.setDefaultModels('peerReview', selectedModels);
```

Then proceed with the review using selected models.

## How It Works

1. **Primary model (Claude)** reviews the changes for improvements
2. **Secondary model(s)** review the same changes
3. **Findings are compared** and disagreements surfaced
4. **Primary model responds** to peer feedback:
   - Defends decisions with context
   - OR acknowledges valid alternatives

## Key Difference from `/wogi-review`

| `/wogi-review` | `/wogi-peer-review` |
|----------------|---------------------|
| "Is this correct, secure, working?" | "Is this the BEST approach?" |
| Bug detection | Optimization opportunities |
| Security vulnerabilities | Alternative implementations |
| Architecture conflicts | Pattern suggestions |
| Verification-focused | Improvement-focused |

## What Peer Review Surfaces

1. **Optimization opportunities** - "This works, but could be faster/cleaner"
2. **Alternative approaches** - "Consider doing X instead of Y"
3. **Cross-model disagreements** - Where different models see things differently
4. **Pattern suggestions** - "Other codebases typically do this as..."
5. **Missed edge cases** - Fresh eyes catch what familiarity misses

## Usage

```bash
/wogi-peer-review                    # Review staged changes
/wogi-peer-review --files src/*.ts   # Review specific files
/wogi-peer-review --task wf-abc123   # Review task changes
```

## Provider Configuration

### Recommended: Use `/wogi-models-setup`

The easiest way to configure models is the setup wizard:
```
/wogi-models-setup
```

This creates a unified configuration used by both peer review and hybrid mode.

### Config Location

Models are configured in `.workflow/config.json` under `models`:

```json
{
  "models": {
    "providers": {
      "openai": {
        "apiKeyEnv": "OPENAI_API_KEY",
        "enabled": true,
        "models": ["gpt-4o", "gpt-4o-mini"]
      },
      "google": {
        "apiKeyEnv": "GOOGLE_API_KEY",
        "enabled": true,
        "models": ["gemini-2.0-flash"]
      },
      "local": {
        "endpoint": "http://localhost:11434",
        "provider": "ollama",
        "enabled": true,
        "models": ["qwen2.5-coder"]
      }
    },
    "defaults": {
      "peerReview": ["openai:gpt-4o", "google:gemini-2.0-flash"]
    }
  }
}
```

API keys are stored in `.env` (not in config):
```
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIza...
```

### Legacy Config (Auto-Migrated)

Old format configs are automatically migrated on first use:
```json
// Old format (still supported, auto-migrates)
"peerReview": {
  "apiKeys": {
    "openai": "${OPENAI_API_KEY}"
  },
  "models": ["openai:gpt-4o"]
}
```

### Manual Mode

For manual review (no API keys needed):
```
/wogi-peer-review --manual
```

When manual:
1. Outputs the review prompt
2. User runs in Cursor/other tool
3. User pastes results back
4. Claude synthesizes

## Review Flow

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-peer-review                                       │
├─────────────────────────────────────────────────────────┤
│  1. Collect code changes (git diff or specified files)   │
│  2. Generate improvement-focused prompt                  │
│  3. Claude reviews for improvements                      │
│  4. Secondary model(s) review                            │
│  5. Compare findings:                                    │
│     • Both agree → Strong suggestion                     │
│     • Disagree → Present both perspectives               │
│  6. Claude responds to peer feedback:                    │
│     • "I have more context, here's why X is better..."   │
│     • "Valid point, Y would be an improvement..."        │
│  7. Output final synthesis                               │
└─────────────────────────────────────────────────────────┘
```

## Review Prompt Template

The peer review focuses on improvements, not correctness:

```
Review this code for IMPROVEMENT OPPORTUNITIES, not bugs:

1. **Optimization**: Can this be faster/more efficient?
2. **Alternatives**: Are there better approaches?
3. **Patterns**: Does this follow best practices?
4. **Readability**: Could this be clearer/simpler?
5. **Extensibility**: Will this be easy to extend?

Code:
[code changes]

Respond with:
- Specific improvement suggestions
- Alternative approaches considered
- Trade-off analysis for any changes
```

## Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Peer Review Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Agreement (2/2 models):
   • Consider using early return for readability
   • Extract repeated logic to helper function

⚖️ Disagreement:
   • Claude: Prefer inline styling for this case
   • GPT-4: Recommend extracting to CSS module
   → Resolution: Context-dependent, current approach is valid

💡 Unique Insights:
   • [GPT-4] Consider memoization for expensive computation
   • [Claude] Current architecture handles edge case X well

📊 Summary:
   3 actionable improvements identified
   1 disagreement resolved
   Code quality: Good, with minor optimization opportunities
```

## When to Use

- Before merging significant changes
- For security-sensitive code
- When you want high confidence
- For learning different perspectives
- When stuck on architecture decisions

## Phase: Post-Review Actions

After peer review completes, optionally create tasks from actionable improvements.

### Store & Create Tasks

Unlike `/wogi-review` (which finds bugs), peer review finds **improvement opportunities**. These are optional enhancements, not required fixes.

**Task creation rules:**
- Strong agreements (2+ models) → Create task if user approves
- Single-model suggestions → Note in tech-debt.json for future
- Disagreements → Document in review report, no task

**Present options:**
```
═══════════════════════════════════════
ACTIONABLE IMPROVEMENTS
═══════════════════════════════════════
3 improvements with strong agreement:
• Extract repeated logic to helper (readability)
• Add memoization for expensive computation (performance)
• Use early return pattern (readability)

Options:
[1] Create tasks - Add as improvement tasks (P3)
[2] Add to tech-debt - Track for future
[3] Skip - Just log the review
```

### Learning Loop

For recurring suggestions across reviews:

1. If same improvement suggested 3+ times → Consider adding to decisions.md
2. If pattern disagreement resolved consistently → Document the resolution

Example:
```
Pattern "prefer-early-return" suggested 4 times across reviews.
Add to coding standards? [Y/n]
```

## Options

- `--provider <name>` - Override configured provider
- `--model <name>` - Specify secondary model
- `--files <glob>` - Review specific files
- `--task <id>` - Review task changes
- `--json` - Output JSON for automation
- `--verbose` - Show full model responses
- `--create-tasks` - Auto-create tasks for strong agreements
