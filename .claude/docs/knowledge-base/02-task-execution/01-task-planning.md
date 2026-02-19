# Task Planning

Before implementation begins, WogiFlow ensures proper planning through task gating, size assessment, and story creation.

---

## Task Gating

**The Problem**: AI tends to jump straight into coding without understanding scope, leading to incomplete or over-engineered solutions.

**The Solution**: Task gating blocks implementation until a task exists with proper context.

### How It Works

1. User requests implementation
2. System checks if task exists in `ready.json`
3. If no task exists → blocks and asks for story/task creation
4. If task exists → proceeds with context from acceptance criteria

### Configuration

```json
{
  "enforcement": {
    "strictMode": true,                      // Master switch
    "requireTaskForImplementation": true,    // Require task in ready.json
    "requireStoryForMediumTasks": true,      // Medium+ need acceptance criteria
    "requirePatternCitation": false          // Require citing decisions.md patterns
  }
}
```

### Strict Mode Flow

```
User: "Add a login button"
          ↓
┌─────────────────────────────────────────┐
│ Is this an implementation request?      │
├─────────────────────────────────────────┤
│ YES → Check for existing task           │
│ NO  → Handle normally (questions, etc.) │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ Does task exist in ready.json?          │
├─────────────────────────────────────────┤
│ YES → /wogi-start TASK-XXX              │
│ NO  → Assess size first                 │
└─────────────────────────────────────────┘
```

---

## Task Size Assessment

Different task sizes require different levels of planning:

| Size | Criteria | Planning Required |
|------|----------|-------------------|
| **Small** | < 3 files, < 1 hour, obvious scope | Minimal - create task inline |
| **Medium** | 3-10 files, 1-4 hours, some complexity | Story with acceptance criteria |
| **Large** | > 10 files, > 4 hours, new feature | Story + decomposition |

### Configuration

```json
{
  "enforcement": {
    "taskSizeThresholds": {
      "small": { "maxFiles": 3, "maxHours": 1 },
      "medium": { "maxFiles": 10, "maxHours": 4 },
      "large": { "minFiles": 10, "minHours": 4 }
    }
  }
}
```

### Size Assessment Process

When a task doesn't exist:

1. **Analyze Request**: Extract scope indicators (files mentioned, feature complexity)
2. **Classify Size**: Map to small/medium/large based on thresholds
3. **Apply Rules**:
   - Small → Create task inline, proceed
   - Medium → Require story approval first
   - Large → Require story + suggest decomposition

---

## Story Creation

Stories define acceptance criteria that drive the execution loop.

### Creating a Story

```bash
/wogi-story "Add user authentication"
```

This generates a structured story:

```markdown
# [TASK-015] Add user authentication

## User Story
**As a** user
**I want** to log in with email and password
**So that** I can access my personalized dashboard

## Acceptance Criteria

### Scenario 1: Successful login
**Given** valid credentials
**When** user submits login form
**Then** user is redirected to dashboard

### Scenario 2: Invalid credentials
**Given** invalid email or password
**When** user submits login form
**Then** error message is displayed

### Scenario 3: Form validation
**Given** empty fields
**When** user attempts to submit
**Then** validation errors are shown

## Technical Notes
- Use existing AuthService from app-map
- Follow project pattern for form handling (decisions.md)
```

### Story Workflow

1. Story is created with proposed acceptance criteria
2. User reviews and approves (or modifies)
3. Task is added to `ready.json` with criteria attached
4. `/wogi-start TASK-XXX` uses criteria to drive loop

---

## Story Decomposition

For complex stories, automatic decomposition breaks them into manageable sub-tasks.

### When Decomposition Happens

```json
{
  "storyDecomposition": {
    "autoDetect": true,              // Suggest when beneficial
    "autoDecompose": false,          // Require approval (true = automatic)
    "complexityThreshold": "medium", // Trigger on medium+ tasks
    "minSubTasks": 5                 // Min subtasks to suggest decomposition
  }
}
```

### Decomposition Process

1. **Complexity Analysis**: Assess story scope
2. **Subtask Generation**: Break into granular tasks
3. **Edge Case Expansion**: Add loading/error state tasks
4. **Dependency Ordering**: Sequence tasks appropriately

### Example Decomposition

Original story: "Add user authentication"

Decomposed tasks:
```
TASK-015-A: Create AuthService with login/logout methods
TASK-015-B: Create LoginForm component
TASK-015-C: Add form validation with error states
TASK-015-D: Handle loading state during auth
TASK-015-E: Add error handling for failed auth
TASK-015-F: Integrate with existing routing
TASK-015-G: Add session persistence
```

### Configuration Options

```json
{
  "storyDecomposition": {
    "autoDetect": true,           // Suggest decomposition for complex tasks
    "autoDecompose": false,       // false = ask first, true = automatic
    "complexityThreshold": "medium",
    "minSubTasks": 5,
    "edgeCases": true,            // Generate edge case tasks
    "loadingStates": true,        // Generate loading state tasks
    "errorStates": true           // Generate error handling tasks
  }
}
```

---

## Multi-Approach Analysis

For complex tasks, analyze multiple implementation approaches before committing.

### When to Use

- Task has high complexity assessment
- Multiple valid implementation paths exist
- Architecture decisions needed

### Configuration

```json
{
  "multiApproach": {
    "enabled": true,
    "mode": "suggest",              // "suggest" | "auto" | "off"
    "triggerOn": ["large", "xl"],   // Complexity levels
    "maxApproaches": 3,
    "selectionStrategy": "first-passing"
  }
}
```

### How It Works

1. Task is assessed for complexity
2. If complex enough, multi-approach analysis is suggested
3. Multiple implementation strategies are outlined with trade-offs
4. User selects approach (or accepts recommendation)
5. Execution proceeds with chosen approach

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-story "title"` | Create story with acceptance criteria |
| `/wogi-story "title" --deep` | Create story with forced decomposition |
| `/wogi-ready` | Show available tasks |
| `/wogi-start TASK-XXX` | Start executing a task |
| `/wogi-deps TASK-XXX` | Show task dependencies |

---

## Best Practices

1. **Always create stories for non-trivial tasks** - The upfront planning saves time
2. **Review acceptance criteria before starting** - Catch scope issues early
3. **Use decomposition for features** - Smaller tasks = better results
4. **Trust the size assessment** - It's tuned for AI task completion patterns

---

## Related

- [Execution Loop](./02-execution-loop.md) - How tasks are executed
- [Story Writer Agent](../../../../agents/story-writer.md) - Story creation guidelines
- [Configuration Reference](../configuration/all-options.md) - All config options
