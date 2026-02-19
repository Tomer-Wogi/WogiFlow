# Function Map

Utility functions registry for preventing duplication.

---

## How to Use

Before creating any new utility function, check this file first.

### Scan & Generate
```bash
flow function-index scan    # Scan codebase for utility functions
flow function-index map     # Generate this file from scan results
```

### Manual Entry Format
```markdown
### functionName
**File**: path/to/file.js
**Purpose**: Brief description
**Params**: (input: Type) => ReturnType
**Used by**: [list of consumers]
```

---

## Registered Functions

<!-- Functions will be populated by `flow function-index scan` or manually -->
<!-- WogiFlow project: utility functions live in scripts/flow-utils.js -->

### safeJsonParse
**File**: scripts/flow-utils.js
**Purpose**: Parse JSON with prototype pollution protection
**Params**: (filePath: string, fallback: any) => any
**Used by**: Multiple scripts across the project

### isPathWithinProject
**File**: scripts/flow-utils.js
**Purpose**: Validate a path is within the project root (path traversal prevention)
**Params**: (targetPath: string) => boolean
**Used by**: flow-roadmap.js, flow-done.js, task-gate.js

### recordAmendment
**File**: scripts/flow-decision-tracker.js
**Purpose**: Record a decision amendment with rationale, timestamp, impact assessment, and source
**Params**: (params: { section, action, rationale, source?, impactAssessment?, previousValue?, newValue?, taskId? }) => Object
**Used by**: CLI `flow-decision-tracker record`, programmatic import

### getHistory
**File**: scripts/flow-decision-tracker.js
**Purpose**: Get amendment history, optionally filtered by section
**Params**: (section?: string, limit?: number) => Object[]
**Used by**: CLI `flow-decision-tracker history`

### getAmendment
**File**: scripts/flow-decision-tracker.js
**Purpose**: Get a specific amendment by ID
**Params**: (id: string) => Object|null
**Used by**: CLI `flow-decision-tracker diff`

### runConsistencyCheck
**File**: scripts/flow-consistency-check.js
**Purpose**: Run all cross-artifact consistency checks (app-map/function-map/api-map vs codebase)
**Params**: (options?: Object) => Object
**Used by**: CLI `flow-consistency-check check`

### parseAppMap
**File**: scripts/flow-consistency-check.js
**Purpose**: Extract component entries from app-map.md (table rows and list entries)
**Params**: () => Object[]
**Used by**: runConsistencyCheck, CLI `flow-consistency-check stats`

### parseFunctionMap
**File**: scripts/flow-consistency-check.js
**Purpose**: Extract function entries from function-map.md
**Params**: () => Object[]
**Used by**: runConsistencyCheck, CLI `flow-consistency-check stats`

### parseApiMap
**File**: scripts/flow-consistency-check.js
**Purpose**: Extract API endpoint entries from api-map.md
**Params**: () => Object[]
**Used by**: runConsistencyCheck, CLI `flow-consistency-check stats`

### generateId
**File**: scripts/flow-utils.js
**Purpose**: Generate crypto-random 8-char hex ID with prefix
**Params**: (prefix?: string) => string
**Used by**: flow-story.js, flow-epics.js, flow-plan.js, flow-feature.js

---
