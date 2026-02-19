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
6. **Comparison Questions**: "What can we learn from X?", "How does X compare to Y?"

## Research Protocol Phases

There are two flows depending on question type:

### Standard Flow (Capability, Existence, Architecture Questions)

For questions like "Does X support Y?" or "How does X work?":

**Phase 1: Scope Mapping**
- Identify all potentially relevant local files
- Identify external tools/libraries mentioned
- Generate search keywords

**Phase 2: Local Evidence Gathering**
- Read ALL files identified in scope (not just the first match)
- Extract relevant code snippets and documentation
- **DO NOT SKIP FILES** - partial reading leads to false conclusions

**Phase 3: External Verification**
- For each external tool/library:
  - Web search: "[tool] documentation [feature] [current year]"
  - Read official docs (top 3 results minimum)
- **ASSUME training data is 2+ years stale**

**Phase 4: Assumption Check**
- List ALL assumptions made during research
- Tag each: `[VERIFIED]` with source or `[UNVERIFIED]`
- Loop back to Phase 2/3 for any unverified assumptions

**Phase 5: Synthesis**
- Generate research report with citations
- State confidence level (HIGH/MEDIUM/LOW)

---

### Comparison Flow (External-First)

For questions like "What can we learn from X?" or "How does X compare to Y?":

**⚠️ CRITICAL: Do external research FIRST**

You're comparing an external tool to your codebase. You must understand what the external tool HAS before you can search locally for equivalents.

**Phase 0: External Research (DO THIS FIRST)**
- Web search the external tool/repository
- Read their documentation, README, source code
- List the features, patterns, or approaches they have
- **OUTPUT**: A clear list of "External tool X has: [features]"

**Phase 1: Scope Mapping (informed by Phase 0)**
- For EACH feature found in Phase 0:
  - Identify local files that might have equivalent functionality
  - Use search patterns based on what you learned externally

**Phase 2: Local Evidence Gathering**
- For EACH external feature, search the local codebase
- Read ALL potentially relevant local files
- Note specific implementations with file paths

**Phase 4: Assumption Check**
- List assumptions, mark [VERIFIED] or [UNVERIFIED]
- Verify anything uncertain

**Phase 5: Synthesis**
- Generate comparison table: External Feature | Local Equivalent | Status
- Cite sources for each claim

**Phase 6: Recommendation Verification (MANDATORY)**

Before presenting ANY recommendation ("We should add X"):

1. **Search local codebase** for equivalent functionality
   - Use Glob/Grep with relevant patterns
   - Search for synonyms and related terms
2. **Read at least one potentially relevant file**
   - Don't just search - actually read the code
3. **Mark each recommendation**:
   - `EXISTS` - Already implemented → **DO NOT recommend**
   - `PARTIAL` - Partially implemented → Recommend enhancement
   - `MISSING` - Not implemented → Safe to recommend
4. **Include verification evidence** in output:
   ```
   Searched: [patterns used]
   Read: [files examined]
   Status: EXISTS/PARTIAL/MISSING
   ```

**ONLY recommend features marked MISSING or PARTIAL.**

This phase prevents recommending features that already exist in the codebase.

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
1. [VERIFY] Library X supports feature Y → Confidence: LOW (training data)
2. [OK] Project uses JavaScript → Confidence: HIGH (read package.json)
3. [VERIFY] Config format is correct → Confidence: LOW (haven't read docs)
```

Any assumption marked `[VERIFY]` with `LOW` confidence **MUST** be verified.

## Evidence Chain Format

Every claim needs a traceable source:

```markdown
| Claim | Source Type | Source Location | Confidence |
|-------|-------------|-----------------|------------|
| "Hooks are supported" | Live Docs | github.com/x/docs/hooks | HIGH |
| "Settings format is X" | File Read | .workflow/config.json | HIGH |
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
User: Does Claude Code support custom hooks?

/wogi-research "Does Claude Code support custom hooks?"
```

Research output:
```
## Research Report

**Question:** Does Claude Code support custom hooks?
**Depth:** standard
**Confidence:** HIGH

### Conclusion
Yes, Claude Code supports hooks since version 2.1.x.

### Evidence Chain
| Claim | Source | Confidence |
|-------|--------|------------|
| Hooks supported | https://docs.anthropic.com/claude-code/hooks | HIGH |
| Configuration in .claude/settings.local.json | File read | HIGH |

### Searches Performed
1. Web: "Claude Code hooks documentation 2026"
2. Local: .claude/settings.local.json
3. Local: .claude/**/*.md
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

This command currently supports Claude Code only.
State is stored in `.workflow/` for persistence across sessions.
