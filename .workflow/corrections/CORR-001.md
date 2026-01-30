# CORR-001 - AI Ignored Research Protocol Verification Step

**Date**: 2026-01-30
**Task**: wf-085f189d
**Skill**: Research Protocol
**Tags**: #research #verification #protocol-violation #regression-risk

---

## What Happened

When asked "What can we learn from Crush for hybrid mode?", the AI:

1. Received the research protocol injection in context (system-reminder showed "Research Protocol Auto-Triggered")
2. Performed external research (Crush repository) correctly
3. **Made 6 recommendations WITHOUT verifying if WogiFlow already had equivalent features**
4. Recommendation #3 ("provider compatibility layer") was something **WogiFlow already has** in `flow-providers.js`
5. If user had auto-accepted, this could have caused duplicate code or regressions

**Evidence of protocol injection received:**
```
Research Protocol Auto-Triggered
**Question Type**: existence
**Depth**: standard (Standard research)
**Limits**: Up to 10 files, 3 web searches
```

---

## What Should Happen

For external comparison research ("What can we learn from X?"):

1. **EXTERNAL RESEARCH FIRST** - Understand what X has (patterns, features)
2. **For EACH potential recommendation:**
   - Search local codebase for equivalent
   - Read at least one potentially relevant file
   - Determine status: EXISTS / PARTIAL / MISSING
3. **Only recommend items marked MISSING**
4. **Include verification evidence** in each recommendation

**Correct flow:**
```
External insight: "Crush has provider compatibility layer"
→ Search WogiFlow: Glob "flow-*provider*.js", Grep "provider|adapter"
→ Read: flow-providers.js
→ Status: EXISTS (lines 192-762 implement this comprehensively)
→ DO NOT RECOMMEND (already exists)
```

---

## Root Cause

1. **Protocol had no explicit verification step** for recommendations
2. AI got absorbed in external research and skipped internal verification
3. No checkpoint asked "Have you verified this doesn't already exist?"

---

## Solution Applied

Added **Phase 6: Recommendation Verification** to research protocol in `research-gate.js`:

```markdown
**Phase 6: Recommendation Verification (for comparison research)**
If you're about to recommend "Add feature X" or "We should implement Y":
- FIRST: Search local codebase for equivalent (Glob/Grep)
- SECOND: Read at least one potentially relevant file
- THIRD: Mark recommendation as EXISTS/PARTIAL/MISSING
- ONLY recommend features marked MISSING
- Include verification evidence
```

---

## Prevention Measures

1. Protocol now explicitly requires verification before recommendations
2. Each recommendation must include evidence: "Searched: [patterns], Read: [files], Status: [status]"
3. This correction document serves as learning record

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/hooks/core/research-gate.js` | Added Phase 6 verification step |
| `.workflow/corrections/CORR-001.md` | Created this document |

---

## Lessons Learned

1. **Protocol injection ≠ protocol compliance** - Instructions must be explicit enough to enforce
2. **Comparison research needs bidirectional verification** - External first, then internal check for each item
3. **Recommendations need evidence** - "We should add X" must include proof X doesn't exist
