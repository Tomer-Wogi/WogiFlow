# /wogi-research - Zero-Trust Research Protocol

Execute rigorous research before answering questions about capabilities, feasibility, or existence.

## Usage

```
/wogi-research "Does X support Y?"          # Standard depth
/wogi-research --quick "Simple question"    # Quick check (5K tokens)
/wogi-research --deep "Architecture query"  # Deep audit (50K tokens)
/wogi-research --exhaustive "Critical decision" # Full audit (100K tokens)
```

## When This is Required

This command is **automatically triggered** (when strict mode is enabled) for:

1. **Capability Questions**: "Does X support Y?", "Can X do Y?"
2. **Feasibility Questions**: "Is it possible to...", "Can we..."
3. **Existence Questions**: "Is there a...", "Does X exist?"
4. **Architecture Questions**: "How does X work?", "How is X structured?"
5. **Integration Questions**: "How to integrate X with Y?"

## Research Protocol Phases

### Phase 1: Scope Mapping
- Identify all potentially relevant local files
- Identify external tools/libraries mentioned
- Generate search keywords
- Create `research-scope.json`

### Phase 2: Local Evidence Gathering
- Read ALL files identified in scope (not just the first match)
- Extract relevant code snippets and documentation
- Log findings to research notes
- **DO NOT SKIP FILES** - partial reading leads to false conclusions

### Phase 3: External Verification
- For each external tool/library:
  - Web search: "[tool] documentation [feature] [current year]"
  - Read official docs (top 3 results minimum)
  - Extract quotes with URLs
- **ASSUME training data is 2+ years stale**

### Phase 4: Assumption Check
- List ALL assumptions made during research
- Tag each assumption:
  - `[VERIFIED]` with HIGH confidence + source
  - `[UNVERIFIED]` with LOW confidence - **MUST be verified before proceeding**
- Loop back to Phase 2/3 for any unverified assumptions

### Phase 5: Synthesis
- Generate research report with:
  - Answer to original question
  - Evidence chain (every claim → source)
  - Confidence level (HIGH/MEDIUM/LOW)
  - Caveats and uncertainties
  - List of searches performed

## Critical Rules

### The Negative Evidence Rule

**FORBIDDEN conclusions:**
- "X is not supported"
- "There is no Y"
- "It doesn't exist"
- "X cannot do Y"

**REQUIRED format for negative claims:**
```
I searched the following sources and found no evidence of X:
1. [source 1] - searched for [terms]
2. [source 2] - searched for [terms]
3. [official docs URL] - no mention found

However, my search may be incomplete. Before concluding X doesn't exist:
- Check if there's a different name for this feature
- Verify with the latest official documentation
- Consider that the feature may be in development
```

### The Version Paranoia Rule

For ANY external tool (npm packages, CLIs, APIs, frameworks):
```
ASSUME: Training data is 2+ years old
ACTION: ALWAYS web search "[tool] latest documentation [current year]"
        BEFORE making capability claims
```

### The Assumption Stack

Before answering, explicitly list:
```markdown
## My Assumptions
1. [VERIFY] Gemini CLI version supports hooks → Confidence: LOW (training data)
2. [OK] Project uses JavaScript → Confidence: HIGH (read package.json)
3. [VERIFY] settings.json format → Confidence: LOW (haven't read docs)
```

Any assumption marked `[VERIFY]` with `LOW` confidence **MUST** be verified.

## Evidence Chain Format

Every claim needs a traceable source:

```markdown
| Claim | Source Type | Source Location | Confidence |
|-------|-------------|-----------------|------------|
| "Hooks are supported" | Live Docs | github.com/x/docs/hooks | HIGH |
| "Settings format is X" | File Read | .gemini/settings.json | HIGH |
| "Feature Y exists" | Training Data | None | LOW - VERIFY |
```

## Depth Tiers

| Depth | Token Budget | Actions | Use For |
|-------|--------------|---------|---------|
| `--quick` | 5K | 1-2 files, no web search | Simple factual lookups |
| (default) | 20K | All relevant files, 1 web search | Most questions |
| `--deep` | 50K | Full file audit, multiple web searches | Architecture/feasibility |
| `--exhaustive` | 100K+ | Everything + user confirmation gates | Production decisions |

## Output

The command generates:

1. **research-report.md** - Full research findings with citations
2. **Console summary** - Key findings and confidence level
3. **Cached verifications** - Stored in `.workflow/state/research-cache.json`

## Configuration

In `.workflow/config.json`:

```json
{
  "research": {
    "enabled": true,
    "defaultDepth": "standard",
    "strictMode": true,
    "autoTrigger": true,
    "maxTokensPerDepth": {
      "quick": 5000,
      "standard": 20000,
      "deep": 50000,
      "exhaustive": 100000
    },
    "requireCitations": true,
    "cacheVerifications": true,
    "cacheExpiryHours": 24,
    "budgetMode": "soft",
    "negativeEvidenceRule": true,
    "assumptionTracking": true
  }
}
```

## Examples

### Example 1: Capability Question

```
User: Does Gemini CLI support hooks?

/wogi-research "Does Gemini CLI support hooks?"
```

Research output:
```
## Research Report

**Question:** Does Gemini CLI support hooks?
**Depth:** standard
**Confidence:** HIGH

### Conclusion
Yes, Gemini CLI supports hooks since version X.

### Evidence Chain
| Claim | Source | Confidence |
|-------|--------|------------|
| Hooks supported | https://github.com/gemini-cli/docs/hooks | HIGH |
| Configuration in .gemini/settings.json | File read | HIGH |

### Searches Performed
1. Web: "Gemini CLI hooks documentation 2026"
2. Local: .gemini/settings.json
3. Local: .gemini/**/*.md
```

### Example 2: Architecture Question

```
User: How does the authentication flow work in this codebase?

/wogi-research --deep "How does the authentication flow work?"
```

This will:
1. Search for auth-related files
2. Read all matches (not just first)
3. Trace the flow through the codebase
4. Generate a comprehensive report

## Integration with Hooks

When `research.strictMode` is enabled and `research.autoTrigger` is true:
- Capability/feasibility questions automatically trigger research
- Claims without citations are flagged
- Negative claims require exhaustive search evidence

## CLI Compatibility

This command works across all supported CLIs:
- Claude Code
- Gemini CLI
- Codex (OpenAI)
- OpenCode
- Cline/Cursor

State is stored in `.workflow/` for cross-CLI persistence.
