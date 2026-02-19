# Specification Mode

Generate comprehensive specifications before implementation starts, following a "spec-first" approach.

---

## Overview

Specification mode ensures quality planning before coding. For medium and large tasks, a specification is generated and optionally approved before any implementation begins.

Key principle: **"Quality code starts with quality planning"**

---

## When Specs Are Generated

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SPEC GENERATION TRIGGERS                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Task Size Assessment                                              │
│   ────────────────────                                               │
│                                                                      │
│   SMALL (< 3 files)                                                 │
│   → No spec, proceed directly                                       │
│                                                                      │
│   MEDIUM (3-10 files)                                               │
│   → Generate spec                                                    │
│   → Show summary                                                    │
│   → Continue = implicit approval                                    │
│                                                                      │
│   LARGE (> 10 files)                                                │
│   → Generate spec                                                    │
│   → Require explicit approval                                       │
│   → Wait for user confirmation                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

```json
{
  "specificationMode": {
    "enabled": true,
    "requireForMedium": true,      // Require spec for medium tasks
    "requireForLarge": true,       // Require spec for large tasks
    "requireApproval": {
      "small": false,              // No approval needed
      "medium": false,             // Implicit approval (continue = ok)
      "large": true                // Explicit approval required
    },
    "autoDetectComplexity": true,  // Auto-assess task size
    "includeFileList": true,       // List files to be modified
    "includeTestStrategy": true    // Include testing approach
  }
}
```

---

## [NEEDS CLARIFICATION] Markers

When generating specs, ambiguous or uncertain requirements are tagged with `[NEEDS CLARIFICATION]` markers. Implementation is **blocked** until all markers are resolved.

### How It Works

1. During spec generation, the AI flags assumptions and ambiguities
2. Markers are inserted inline: `[NEEDS CLARIFICATION: reason]`
3. If `blockImplementation: true`, coding cannot begin until all markers are resolved
4. User resolves markers by answering questions or providing guidance

### Categories

| Category | Example |
|----------|---------|
| `assumption` | "Assuming REST API, not GraphQL" |
| `ambiguity` | "Should validation happen client-side or server-side?" |
| `missing-context` | "No error handling strategy defined" |
| `dependency-unknown` | "Unclear which auth library to use" |
| `edge-case` | "What happens when input is empty?" |

### Configuration

```json
{
  "needsClarification": {
    "enabled": true,
    "markerFormat": "[NEEDS CLARIFICATION: {reason}]",
    "blockImplementation": true,
    "minMarkersForReview": 0,
    "categories": ["assumption", "ambiguity", "missing-context", "dependency-unknown", "edge-case"]
  }
}
```

### Example Spec with Markers

```markdown
## Implementation Steps

1. Create AuthService with login method
2. [NEEDS CLARIFICATION: Should we use JWT or session-based auth?]
3. Add route protection middleware
4. [NEEDS CLARIFICATION: Should expired sessions redirect to login or show modal?]
```

---

## Spec Structure

Generated specs are saved to `.workflow/specs/`:

```markdown
# Specification: wf-abc123

**Task**: Implement user authentication
**Generated**: 2026-01-10T10:30:00Z
**Complexity**: Medium (5 files)

## Acceptance Criteria

### Scenario 1: Happy path login
**Given** a registered user
**When** they enter valid credentials
**Then** they are redirected to dashboard

### Scenario 2: Invalid credentials
**Given** a registered user
**When** they enter wrong password
**Then** they see error message

## Implementation Steps

1. Create AuthService with login method
2. Create LoginForm component
3. Add route protection middleware
4. Update navigation for auth state
5. Add unit tests

## Files to Change

| File | Action | Confidence |
|------|--------|------------|
| src/services/auth.ts | Create | High |
| src/components/LoginForm.tsx | Create | High |
| src/middleware/auth.ts | Create | Medium |
| src/App.tsx | Modify | High |

## Test Strategy

- Unit: AuthService methods
- Integration: Login flow
- E2E: Full authentication journey

## Verification Commands

```bash
npm run typecheck
npm test -- --coverage
npm run lint
```
```

---

## Spec Workflow

### 1. Task Start

```bash
/wogi-start wf-abc123
```

### 2. Complexity Assessment

System analyzes:
- Number of acceptance criteria
- Files likely to change
- Scope of changes

### 3. Spec Generation

```
📋 Generated Specification:

Acceptance Criteria: 4 scenarios
Implementation Steps: 6 steps
Files to Change: 5 files (medium confidence)
Verification Commands: 4 commands

Saved to: .workflow/specs/wf-abc123.md
```

### 4. Reflection Checkpoint

```
🪞 Reflection: Does this spec fully address the requirements?
   - Are there any edge cases not covered?
   - Is the scope clear and achievable?

[Continue to proceed, or provide feedback]
```

### 5. Implementation

Only after spec is approved does implementation begin.

---

## File Detection

The spec generator analyzes the task to predict files:

| Signal | Detection Method |
|--------|------------------|
| Component names | Grep for existing components |
| Service patterns | Match against app-map |
| Route changes | Analyze routing files |
| Test files | Infer from implementation files |

Confidence levels:
- **High**: Explicit file mentioned or clear pattern
- **Medium**: Inferred from context
- **Low**: Best guess based on conventions

---

## Skipping Specs

### Per-Task

```bash
/wogi-start wf-abc123 --no-spec
```

### Globally

```json
{
  "specificationMode": {
    "enabled": false
  }
}
```

### For Small Tasks

Small tasks (< 3 files) skip specs by default.

---

## Spec Approval

### Implicit Approval (Medium Tasks)

Continuing execution = approval:
```
📋 Specification generated

[User continues without objection]
→ Spec approved implicitly
```

### Explicit Approval (Large Tasks)

Requires confirmation:
```
📋 Specification generated

This is a large task (12 files). Please review the spec:
.workflow/specs/wf-abc123.md

Approve and proceed? [y/n]
```

---

## Spec Updates

Specs can be updated during implementation:

```
🔄 Updating specification:
- Added Scenario 5 (edge case discovered)
- Changed file confidence for middleware
- Added integration test step
```

---

## Verification Against Spec

After implementation, verify against spec:

```
✓ Verifying against specification...

Acceptance Criteria:
  ✓ Scenario 1: Happy path login
  ✓ Scenario 2: Invalid credentials
  ✓ Scenario 3: Session persistence
  ✗ Scenario 4: Password reset (not implemented)

Files Changed:
  ✓ src/services/auth.ts (created)
  ✓ src/components/LoginForm.tsx (created)
  ✓ src/middleware/auth.ts (created)
  ✗ src/utils/validation.ts (unexpected)
```

---

## Best Practices

1. **Review specs before proceeding** - Catch scope issues early
2. **Update specs when scope changes** - Keep documentation accurate
3. **Use confidence levels** - High confidence = plan is solid
4. **Check file predictions** - Catch missing components early

---

## Commands

| Option | Description |
|--------|-------------|
| `--no-spec` | Skip specification generation |
| `--spec-only` | Generate spec without implementation |
| `--respec` | Regenerate specification |

---

## Related

- [Task Planning](./01-task-planning.md) - Story creation
- [Execution Loop](./02-execution-loop.md) - Implementation flow
- [Verification](./03-verification.md) - Quality gates
