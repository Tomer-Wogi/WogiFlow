# [wf-phase0-2] Failure Category Enum

## User Story
**As a** developer using wogi-flow
**I want** consistent error categorization across the system
**So that** I can understand failures better and the system can make smarter recovery decisions

## Description
Formalize the error categorization system that's partially implemented in `flow-adaptive-learning.js`. This provides a standardized set of failure categories used by Model Stats (to track failures by type), Cascade Fallback (to decide when to escalate), and the Learning system (to categorize what went wrong).

## Acceptance Criteria

### Scenario 1: Failure categories are exported
**Given** I import the failure categories module
**When** I access the categories
**Then** I should have access to all standard failure types
**And** each category should have a code, description, and severity

### Scenario 2: Error detection uses categories
**Given** an error occurs during task execution
**When** the system analyzes the error
**Then** it should be categorized into one of the standard categories
**And** the category should be logged for stats tracking

### Scenario 3: Categories inform cascade decisions
**Given** a failure occurs with category "CAPABILITY_MISMATCH"
**When** the cascade fallback system checks the failure
**Then** it should recognize this as an escalation-worthy category
**And** trigger fallback to a more capable model

### Scenario 4: Stats track failures by category
**Given** failures are occurring during execution
**When** I view model stats
**Then** I should see failure counts broken down by category
**And** I should be able to identify which error types are most common

### Scenario 5: Learning system uses categories
**Given** a learning is captured after a failure
**When** the learning is stored
**Then** it should include the failure category
**And** future similar failures can match against this learning

## Technical Notes

**Files to Create**:
- `.workflow/lib/failure-categories.js` - Central definition

**Files to Modify**:
- `scripts/flow-adaptive-learning.js` - Use centralized categories
- `scripts/flow-loop-retry-learning.js` - Use centralized categories

**Category Schema**:
```javascript
const FailureCategory = {
  PARSE_ERROR: {
    code: 'parse_error',
    description: 'Failed to parse response',
    severity: 'medium',
    escalate: false
  },
  IMPORT_ERROR: {
    code: 'import_error',
    description: 'Module import failed',
    severity: 'high',
    escalate: false
  },
  TYPE_ERROR: {
    code: 'type_error',
    description: 'TypeScript/type mismatch',
    severity: 'medium',
    escalate: false
  },
  SYNTAX_ERROR: {
    code: 'syntax_error',
    description: 'Invalid syntax in generated code',
    severity: 'high',
    escalate: false
  },
  RUNTIME_ERROR: {
    code: 'runtime_error',
    description: 'Error during execution',
    severity: 'medium',
    escalate: false
  },
  RATE_LIMIT: {
    code: 'rate_limit',
    description: 'API rate limit exceeded',
    severity: 'low',
    escalate: false
  },
  CONTEXT_OVERFLOW: {
    code: 'context_overflow',
    description: 'Context window exceeded',
    severity: 'high',
    escalate: true
  },
  CAPABILITY_MISMATCH: {
    code: 'capability_mismatch',
    description: 'Model lacks required capability',
    severity: 'high',
    escalate: true
  },
  HALLUCINATION: {
    code: 'hallucination',
    description: 'Model produced incorrect/fabricated output',
    severity: 'high',
    escalate: true
  },
  INCOMPLETE_OUTPUT: {
    code: 'incomplete_output',
    description: 'Response was truncated or incomplete',
    severity: 'medium',
    escalate: false
  }
};
```

## Test Strategy
- [ ] Unit: All categories are defined and valid
- [ ] Unit: Error detection correctly categorizes sample errors
- [ ] Integration: Stats correctly track by category

## Dependencies
- None

## Complexity
**Low** - Formalizing existing partial implementation

## Out of Scope
- Cascade fallback logic (Phase 3.2)
- Model stats implementation (Phase 1.2)
