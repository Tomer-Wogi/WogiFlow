---
description: "Run a multi-model peer review with different AI perspectives"
---
Run a multi-model peer review where different AI models review the same code.

## Step 0: Model Selection (Session Persistent)

**Models are selected once per session and remembered for subsequent runs.**

### Check Session State First

```javascript
const modelConfig = require('./scripts/flow-model-config');

// Run migration if needed (handles old config formats)
modelConfig.migrateOldConfig();

// Check if Claude should also review
const includeClaude = modelConfig.shouldIncludeClaude();

// Check if models already selected this session
const sessionModels = modelConfig.getSessionModels('peerReview');

if (sessionModels && sessionModels.length > 0 && !args.includes('--select-models')) {
  // Use session models - show brief note
  const claudeNote = includeClaude ? ' + Claude' : '';
  console.log(`Using models: ${sessionModels.join(', ')}${claudeNote}`);
  console.log(`(Run with --select-models to change)`);
  // Proceed with review using sessionModels
} else {
  // Need to select models - continue to selection flow
}
```

### If No Models Configured

If `modelConfig.getEnabledModels().length === 0`:

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

Show selection dialog when:
- First run of session (no session models set)
- User passes `--select-models` flag

```javascript
{
  question: "Select models for peer review (multiple allowed):",
  header: "Models",
  multiSelect: true,
  options: [
    // Claude option (when includeClaude is enabled in config)
    { label: "Claude (current session)", description: "Reviews using current conversation context" },
    // Dynamically populated from configured models
    { label: "openai:gpt-4o", description: "Best quality reasoning" },
    { label: "openai:gpt-4o-mini", description: "Faster, cheaper" },
    { label: "google:gemini-2.0-flash", description: "Fast, good at code" },
    { label: "local:qwen2.5-coder", description: "Free, runs locally" }
    // ... other configured models
  ]
}
```

**Show Claude option when:**
- `modelConfig.shouldIncludeClaude()` returns `true`
- Claude is shown first (recommended) as it has full context

**Show external models that:**
1. Are configured in `models.providers`
2. Have `enabled: true`
3. Have API key set (check `process.env[apiKeyEnv]`) or are local

### After Selection

Save the selection to session state:
```javascript
modelConfig.setSessionModels('peerReview', selectedModels);
```

This persists until `/wogi-session-end` is called, which clears the selection.

Then proceed with the review using selected models.

## How It Works

### When `includeClaude` is enabled (recommended):
1. **Claude reviews first** using the same improvement-focused prompt as external models
2. **External model(s)** review the same changes via API
3. **All findings compared** (Claude + external models)
4. **Claude synthesizes** all perspectives and responds to disagreements

### When `includeClaude` is disabled:
1. **External model(s)** review the changes via API
2. **Findings are compared** across external models
3. **Claude synthesizes** findings and responds to peer feedback:
   - Defends decisions with context
   - OR acknowledges valid alternatives

**Why include Claude?**
- Provides additional perspective alongside external models
- Has full conversation context (knows why certain decisions were made)
- Catches things external models might miss due to context limitations

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
/wogi-peer-review                    # Review staged changes (uses session models)
/wogi-peer-review --files src/*.ts   # Review specific files
/wogi-peer-review --task wf-abc123   # Review task changes
/wogi-peer-review --select-models    # Force model re-selection
/wogi-peer-review --manual           # Manual mode (no API keys needed)
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
      "peerReview": ["openai:gpt-4o", "google:gemini-2.0-flash"],
      "includeClaude": true
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
│  3. If includeClaude enabled:                            │
│     • Launch Claude review (Task agent, Explore type)   │
│     • Claude reviews using same prompt as external       │
│  4. External model(s) review via API                     │
│  5. Collect all results                                  │
│  6. Compare findings:                                    │
│     • All agree → Strong suggestion                      │
│     • Partial agree → Present perspectives               │
│     • Disagree → Surface disagreement                    │
│  7. Claude synthesizes and responds to feedback:         │
│     • "I have more context, here's why X is better..."   │
│     • "Valid point, Y would be an improvement..."        │
│  8. Output final synthesis                               │
└─────────────────────────────────────────────────────────┘
```

### Claude Review Implementation

When `includeClaude` is enabled, launch a Task agent to perform Claude's review:

```javascript
// In wogi-peer-review execution
const modelConfig = require('./scripts/flow-model-config');

if (modelConfig.shouldIncludeClaude()) {
  // Launch Task agent with subagent_type=Explore
  // Use the same improvement-focused prompt as external models
  // The agent reviews the code and returns findings
  // Add Claude's results to the comparison alongside external model results
}
```

**Task agent prompt for Claude review:**
```
Review this code for IMPROVEMENT OPPORTUNITIES (not bugs):

1. Optimization: Can this be faster/more efficient?
2. Alternatives: Are there better approaches?
3. Patterns: Does this follow best practices?
4. Readability: Could this be clearer/simpler?
5. Extensibility: Will this be easy to extend?

[code changes]

Return structured findings with specific suggestions.
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

Reviewers: Claude, GPT-4o, Gemini 2.0 Flash

✅ Agreement (3/3 models):
   • Consider using early return for readability
   • Extract repeated logic to helper function

⚖️ Partial Agreement (2/3 models):
   • Claude + Gemini: Add input validation at boundary
   • GPT-4o: Not necessary for internal function

⚖️ Disagreement:
   • Claude: Prefer inline styling for this case
   • GPT-4o: Recommend extracting to CSS module
   • Gemini: No strong opinion
   → Resolution: Context-dependent, current approach is valid

💡 Unique Insights:
   • [Claude] Current architecture handles edge case X well
   • [GPT-4o] Consider memoization for expensive computation
   • [Gemini] Similar pattern used in popular library Y

📊 Summary:
   Reviewers: 3 (Claude + 2 external)
   4 actionable improvements identified
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

- `--select-models` - Force model re-selection (overrides session selection)
- `--manual` - Manual mode (copy prompt to another AI, paste response back)
- `--provider <name>` - Override configured provider
- `--model <name>` - Specify secondary model
- `--files <glob>` - Review specific files
- `--task <id>` - Review task changes
- `--json` - Output JSON for automation
- `--verbose` - Show full model responses
- `--create-tasks` - Auto-create tasks for strong agreements
