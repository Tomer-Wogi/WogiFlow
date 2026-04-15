---
description: "Zero-trust research protocol for capability and feasibility questions"
effort: high
---
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

## Step 0: Config Loading (MANDATORY — before all phases)

Before ANY research phase, read the project's config to determine depth, format, and verification requirements:

```bash
cat .workflow/config.json | grep -A 30 '"research"'
```

**Extract and apply these settings:**

1. **Determine depth** (in priority order):
   - CLI flag (`--deep`, `--quick`, etc.) → use that depth
   - If auto-triggered (no flag): classify question type and look up `research.triggers`:
     - Capability question ("Does X support Y?") → `triggers.capabilityQuestions` (default: `"standard"`)
     - Feasibility question ("Is it possible to...") → `triggers.feasibilityQuestions` (default: `"deep"`)
     - Existence question ("Is there a...") → `triggers.existenceQuestions` (default: `"standard"`)
     - Architecture question ("How does X work?") → `triggers.architectureQuestions` (default: `"deep"`)
     - Integration question ("How to integrate X with Y?") → `triggers.integrationQuestions` (default: `"deep"`)
     - Comparison question ("How does X compare to Y?") → `triggers.comparisonQuestions` (default: `"deep"`)
   - Fallback: `research.defaultDepth` (default: `"standard"`)

2. **Apply format flags** from config:
   - `requireVerificationFormat: true` → ALL assumptions must have `[VERIFIED]`/`[UNVERIFIED]` markers
   - `requireCitations: true` → ALL claims must have an Evidence Chain entry
   - `assumptionTracking: true` → Assumption Stack table is MANDATORY in output
   - `negativeEvidenceRule: true` → Negative claims require exhaustive search evidence

3. **Display header block** (MANDATORY):
   ```markdown
   ## Research Report
   **Question:** [the question]
   **Depth:** [resolved depth from step 1]
   **Flow:** [Standard/Comparison]
   **Config applied:** requireVerification=[yes/no], citations=[yes/no], assumptionTracking=[yes/no]
   ```

**If config.json has no `research` section or is unreadable**: use defaults (depth: standard, all format flags: true).

---

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
    "autoTrigger": true,
    "requireVerificationFormat": true,
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
    "assumptionTracking": true,
    "triggers": {
      "capabilityQuestions": "standard",
      "feasibilityQuestions": "deep",
      "existenceQuestions": "standard",
      "architectureQuestions": "deep",
      "integrationQuestions": "deep",
      "comparisonQuestions": "deep"
    }
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

When `research.requireCitations` is enabled and `research.autoTrigger` is true:
- Capability/feasibility questions automatically trigger research
- Claims without citations are flagged
- Negative claims require exhaustive search evidence

## Output Checklist (MANDATORY — self-verify before presenting)

Before presenting ANY research report, verify ALL of these are present. If any is missing, add it before outputting.

| # | Check | Required When |
|---|-------|---------------|
| 1 | **Header block** with Question, Depth, Flow, Config applied | Always |
| 2 | **Conclusion** section with direct answer | Always |
| 3 | **Assumption Stack** table with `[VERIFIED]`/`[UNVERIFIED]` markers | `assumptionTracking: true` (default) |
| 4 | **Evidence Chain** table with Claim, Source Type, Source Location, Confidence | `requireCitations: true` (default) |
| 5 | **Confidence level** (HIGH/MEDIUM/LOW) | Always |
| 6 | **Searches Performed** list (web + local) | Always |
| 7 | **Negative Evidence format** for any "X doesn't exist" claims | `negativeEvidenceRule: true` (default) |
| 8 | **Comparison table** (External Feature / Local Equivalent / Status) | Comparison flow only |
| 9 | **Recommendation Verification** (EXISTS/PARTIAL/MISSING markers) | Comparison flow only |

**Self-check prompt**: "Have I included all mandatory sections per config? Is every assumption marked? Is every claim cited?"

If the report is missing any required section, DO NOT present it — add the missing section first.

## Research Reasoning Gate (wf-6dbc0b2a)

When `config.researchReasoningGate.enabled` (default: true), classify the research question into a tier by **structural markers**, NOT by your own judgement. When ambiguous, default to Tier 2.

| Tier | Markers | Behavior |
|------|---------|----------|
| 1 — Factual | "what is", "how many", "show me", "list all", "which file", "where does" | Run the zero-trust research protocol and answer. No assumption gate. |
| 2 — Domain (default for ambiguous) | "what should", "how should", "recommend", "which approach", "what do you think about", "is it better to" | **Before analyzing**, surface the domain-model assumptions your recommendation will depend on. WAIT for user confirmation. |
| 3 — Architecture | "should we restructure", "what's the right architecture", "design a schema", "how to migrate", "should we split / merge / replace" | Tier 2 flow + after producing the recommendation, spawn an Agent on a DIFFERENT model (config `researchReasoningGate.tier3.adversaryModel`, default `sonnet`) to critique it. Show both perspectives. |

**Tier 2 assumption-surfacing format** (BEFORE any analysis):
```
━━━ ASSUMPTIONS (confirm before I analyze) ━━━
My analysis will depend on these domain model assumptions:
1. <assumption 1>
2. <assumption 2>
3. <assumption 3>

Do these match your understanding? [confirm / correct]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Do NOT produce the research report while waiting. When the user confirms or corrects, ground the report in the user's domain model — not your original guess.

**Tier 3 adversary-critique format** (AFTER recommendation):
```
━━━ RECOMMENDATION ━━━
<research report>

━━━ ADVERSARY CRITIQUE (reviewed by a different model) ━━━
<sub-agent output — 1-3 specific concerns with citations>
```

**Why this is here** (and not left to AI self-reflection): same-model self-critique is a known rubber-stamp. The USER is the effective adversary at Tier 2 — surfacing assumptions lets them validate the domain model before you build recommendations on invisible guesses. At Tier 3, a different-model agent catches failures of reasoning the original model cannot see.

Tier toggles: `researchReasoningGate.tier2.enabled` / `researchReasoningGate.tier3.enabled` — independent. Both default ON.

## CLI Compatibility

This command currently supports Claude Code only.
State is stored in `.workflow/` for persistence across sessions.
