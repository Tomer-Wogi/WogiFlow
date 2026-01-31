# Project Decisions

Project-specific rules that agents must follow. Updated when user gives feedback.

---

## Component Architecture

### Component Reuse Policy
**Added**: Project initialization
**Rule**: Always check `app-map.md` before creating any component. Prefer adding variants over creating new components.

### Variant Naming Convention
**Rule**: Use consistent variant names:
- Size: `sm`, `md`, `lg`, `xl`
- Intent: `primary`, `secondary`, `danger`, `success`, `warning`
- State: `default`, `hover`, `active`, `disabled`

---

## Coding Standards

### Security Patterns (2026-01-11)
**Source**: Session review findings

1. **File Read Safety**
   - Always wrap `fs.readFileSync()` in try-catch, even after `fileExists()` check
   - Reason: Race conditions, permission changes, symlink issues can still cause failures

2. **JSON Parsing Safety**
   - Use `safeJsonParse()` from flow-utils.js instead of raw `JSON.parse()`
   - Validate parsed structure has expected fields before use
   - Check for `__proto__`, `constructor`, `prototype` injection

3. **Template Substitution Safety**
   - Block access to `__proto__`, `constructor`, `prototype` keys
   - Use `Object.prototype.hasOwnProperty.call()` for property access
   - Example: See `applyTemplate()` in flow-prompt-composer.js

4. **Path Safety**
   - Validate patterns before `path.join()` with user/config data
   - Use `isPathWithinProject()` for defense-in-depth
   - Glob-to-regex: Use `[^/]*` not `.*` to prevent path separator matching

5. **Module Dependencies**
   - Check for circular dependencies when refactoring shared functions
   - Node.js handles circular deps but can cause undefined exports during load

### Code Quality Patterns (2026-01-12)
**Source**: Session review findings

1. **Catch Block Variable Naming**
   - **Standard**: Use `err` for all catch blocks in this codebase
   - Avoid: `e`, `error`, `ex`, `exception` - these cause confusion with loop variables
   - Example: `catch (err) { console.error(err.message); }`
   - Bad: `arr.map(e => e.value)` inside a `catch (err)` block using `e.message` (typo!)
   - Reason: Standardizing on `err` prevents mix-ups with iterator variables like `e`

2. **Single Source of Truth for Constants**
   - Avoid duplicating model/configuration objects across files
   - Import from one canonical location instead
   - Example: `getModelContextPreferences()` in flow-instruction-richness.js
   - Reason: Prevents drift and makes updates simpler

3. **Named Constants for Magic Numbers**
   - Define constants for threshold values, percentages, limits
   - Example: `COVERAGE_THRESHOLDS = { default: 0.7, comprehensive: 0.85, concise: 0.5 }`
   - Reason: Self-documenting code, easier maintenance

---

## UI/UX Decisions

<!-- Add UI/UX decisions here -->

---

## Architecture Decisions

<!-- Project-specific architecture decisions go here -->

---

## File/Folder Structure

<!-- Add structure rules here -->

---

## Continuous Learning Protocol (2026-01-30)

**Source**: User feedback - the learning system exists but wasn't being used
**Priority**: CRITICAL - This is the core purpose of WogiFlow

The user installed WogiFlow so the AI learns from mistakes and improves over time. This requires THREE mandatory behaviors:

---

### Part 1: Pre-Task Pattern Check (BEFORE starting any work)

**Before starting ANY task**, check for known issues:

```
1. Read feedback-patterns.md
   → Look for patterns related to this type of task
   → Check "Pending Patterns" section for recent issues

2. Read relevant sections of decisions.md
   → Search for rules related to this task type
   → Check if there are documented procedures to follow

3. Check corrections/ directory
   → Look for recent corrections in this area
   → Learn from past mistakes before repeating them
```

**Example**: Before doing a release:
- Check feedback-patterns.md for "release" patterns → Found: "Release Process Failure"
- Check decisions.md for release procedures → Found: "GitHub Release Workflow"
- Follow the documented procedure instead of improvising

**If you skip this check and make a preventable mistake, that's a learning system failure.**

---

### Part 2: Post-Failure Capture (AFTER any failure occurs)

**When ANY of these happen, you MUST capture the learning:**

| Failure Type | Examples |
|--------------|----------|
| **Code error** | Bug introduced, tests fail, lint errors |
| **Process error** | Skipped step, wrong order, forgot requirement |
| **Judgment error** | Wrong assumption, misunderstood requirement |
| **Tool error** | Used wrong command, wrong flags, race condition |
| **Knowledge gap** | Didn't know about existing component/pattern |
| **Verification skip** | Claimed done without checking |

**Capture process:**

```
1. STOP - Don't just fix it and move on

2. DIAGNOSE - Ask yourself:
   - What exactly went wrong?
   - What did I do (or not do) that caused this?
   - What should I have done instead?
   - Was there a learning file I should have checked first?
   - Is this the first time, or has this happened before?

3. RECORD - Add to feedback-patterns.md:
   | Date | Pattern | Description | Count | Action |
   |------|---------|-------------|-------|--------|
   | [today] | [short-name] | [what went wrong and why] | 1 | Monitor |

4. If this is a REPEATED issue (count >= 3):
   → Create a rule in decisions.md
   → Mark pattern as PROMOTED in feedback-patterns.md
   → The rule must include VERIFICATION STEPS
```

**Self-diagnosis questions to ask after every failure:**

1. "Did I check feedback-patterns.md before starting?" → If no, that's the root cause
2. "Did I check decisions.md for existing rules?" → If no, that's the root cause
3. "Did I follow the documented procedure?" → If no, why not?
4. "Did I verify my work before claiming done?" → If no, add verification
5. "Is there a pattern here I've seen before?" → If yes, it needs a rule

---

### Part 3: Pattern Promotion (Learning Loop)

**When the same failure happens 3+ times:**

```
Pattern Count Reaches 3
    ↓
Create Rule in decisions.md:
    - Clear description of what to do/not do
    - WHY this matters (the failures it prevents)
    - VERIFICATION steps to confirm compliance
    - Examples of correct vs incorrect behavior
    ↓
Mark as PROMOTED in feedback-patterns.md
    ↓
Future sessions will see the rule and follow it
```

**Rule template:**
```markdown
### [Rule Name] (YYYY-MM-DD)
**Source**: [X] failures recorded in feedback-patterns.md
**Problem**: [What kept going wrong]
**Rule**: [What to do instead]
**Verification**: [How to check you followed the rule]
**Example**:
  - WRONG: [what was happening]
  - RIGHT: [what should happen]
```

---

### Part 4: User Frustration Detection (Escalation)

**When the user expresses frustration about repeated issues:**

Phrases that indicate this:
- "This keeps happening"
- "I told you this before"
- "You keep forgetting X"
- "How many times..."
- "This failed again"
- Any tone of frustration about repetition

**Required response:**

1. **Acknowledge** - Don't be defensive
2. **Investigate** - Check learning files for what should have been known
3. **Diagnose** - Why wasn't the learning system used?
4. **Fix** - Create/strengthen the rule
5. **Verify** - Test that the fix works

**This is an escalation** - it means Parts 1-3 failed. Treat it seriously.

---

### Types of Failures to Track

| Category | Examples | Capture? |
|----------|----------|----------|
| **Process failures** | Skipped steps, wrong order, forgot verification | YES |
| **Code bugs** | Logic errors, missing error handling, race conditions | YES |
| **Knowledge gaps** | Didn't know about existing component, pattern, or rule | YES |
| **Assumption errors** | Made assumption without verifying | YES |
| **Tool misuse** | Wrong command, wrong flags, wrong sequence | YES |
| **Scope creep** | Did more than asked, changed unrelated code | YES |
| **Communication** | Misunderstood requirement, didn't ask clarifying question | YES |
| **Verification skips** | Claimed done without testing, didn't check output | YES |

---

### Why This Matters

The user installed WogiFlow specifically for these benefits:
- **Accountability**: Every mistake is tracked and learned from
- **Improvement**: The AI gets better over time, not worse
- **Trust**: The user can rely on the AI to not repeat mistakes
- **Efficiency**: Less time spent on preventable errors

**When you skip the learning system:**
- You repeat mistakes that were already solved
- The user loses trust
- The learning files become useless
- WogiFlow's core value proposition fails

**The learning system only works if you USE it.**

---

## Operational Procedures

### GitHub Release Workflow (2026-01-30)
**Source**: Repeated failures (10+ times) in npm publish automation
**Priority**: Critical - prevents wasted releases and broken npm versions

**Problem**: Running `git push` followed immediately by `gh release create` causes a race condition. The release tag gets created on the remote's HEAD before the push fully propagates, pointing to an old commit.

**Correct Procedure**:
```bash
# 1. Push commits first
git push origin master

# 2. Create tag LOCALLY on the correct commit
git tag vX.Y.Z HEAD

# 3. Push the tag explicitly
git push origin vX.Y.Z

# 4. THEN create the release (it will use the existing tag)
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

**NEVER do this**:
```bash
# BAD - race condition, tag may point to wrong commit
git push origin master && gh release create vX.Y.Z ...
```

**If a release fails**:
1. Delete the bad release: `gh release delete vX.Y.Z --yes`
2. Delete the bad remote tag: `git push origin --delete vX.Y.Z`
3. Delete local tag if exists: `git tag -d vX.Y.Z`
4. Follow the correct procedure above

**Verification**: Check that `git show vX.Y.Z` shows the expected commit with the correct package.json version.

---

## Review & Cleanup Procedures

<!-- Project-specific review procedures go here -->

---

### 2026-01-02

Use kebab-case for all file names in this project

