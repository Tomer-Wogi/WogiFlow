Run a multi-model peer review where different AI models review the same code.

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

Configure in `.workflow/config.json` under `peerReview`:

### Option A: API Keys (Default)
```json
"peerReview": {
  "enabled": true,
  "provider": "api",
  "models": ["openai:gpt-4o", "google:gemini-pro"],
  "apiKeys": {
    "openai": "${OPENAI_API_KEY}",
    "google": "${GOOGLE_API_KEY}"
  }
}
```

### Option B: MCP Integration
```json
"peerReview": {
  "enabled": true,
  "provider": "mcp",
  "mcpServers": {
    "openai": "mcp-openai",
    "google": "mcp-gemini"
  }
}
```

### Option C: Manual Mode
```json
"peerReview": {
  "enabled": true,
  "provider": "manual"
}
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

## Options

- `--provider <name>` - Override configured provider
- `--model <name>` - Specify secondary model
- `--files <glob>` - Review specific files
- `--task <id>` - Review task changes
- `--json` - Output JSON for automation
- `--verbose` - Show full model responses
