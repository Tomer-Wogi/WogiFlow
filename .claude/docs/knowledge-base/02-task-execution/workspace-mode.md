# Workspace Mode: Multi-Repo Orchestration

Manage multiple repositories from a single orchestrator using the manager-worker architecture.

---

## Overview

Workspace mode enables a **manager** Claude Code session to orchestrate work across multiple **worker** repos. The manager reads metadata, creates execution plans, and dispatches tasks — but never touches source code directly. Each worker runs its own Claude Code session and executes independently.

```
Manager (workspace root)
   ├── Backend repo (provider — APIs, database)
   ├── Frontend repo (consumer — UI, pages)
   ├── Shared repo (library — types, utilities)
   └── Mobile repo (consumer — native app)
```

---

## Setup

### 1. Create workspace config

Create `wogi-workspace.json` at the workspace root:

```json
{
  "workspace": "my-project",
  "members": {
    "backend": { "role": "provider", "path": "./backend", "port": 8802 },
    "frontend": { "role": "consumer", "path": "./frontend", "port": 8803 },
    "shared": { "role": "library", "path": "./shared", "port": 8804 }
  }
}
```

### 2. Start worker sessions

Each worker runs with its identity:

```bash
WOGI_REPO_NAME=backend WOGI_CHANNEL_PORT=8802 claude
WOGI_REPO_NAME=frontend WOGI_CHANNEL_PORT=8803 claude
```

### 3. Start manager session

```bash
WOGI_REPO_NAME=manager WOGI_PEERS=backend:8802,frontend:8803,shared:8804 claude
```

---

## How Task Routing Works

When you tell the manager "Add user profile editing":

1. **Metadata scan**: Manager reads api-map, app-map, schema-map from each member repo (never source code)
2. **Routing analysis**: Scores each repo by matching task keywords against role keywords
   - Provider keywords: endpoint, route, controller, database, schema, backend, api
   - Consumer keywords: page, component, ui, form, modal, hook, redux
   - Library keywords: shared, utility, types, common, helper
3. **Execution plan**: Determines single-repo or cross-repo, creates phased plan
4. **Dispatch**: Tasks sent to workers via HTTP channel

### Execution Phase Order

Cross-repo tasks execute in dependency order:

```
library (0) → contract (0) → provider (1) → consumer (2) → verify (4)
```

The provider (backend) always finishes before the consumer (frontend) starts — no broken integrations from timing mismatches.

---

## Manager Boundary Enforcement

The manager-boundary-gate mechanically prevents the manager from modifying worker source code:

| Action | Allowed? |
|--------|----------|
| Read metadata (api-map, app-map, config, state) | Yes |
| Read source code | No — blocked |
| Edit/Write any worker file | No — blocked |
| Bash in worker directories | Only allowlisted read-only commands |
| Dispatch tasks to workers | Yes |
| Read worker messages | Yes |

This is enforced by a PreToolUse hook gate, not a prompt. The manager physically cannot `cd` into a worker repo and start editing.

---

## Agent-to-Agent Communication

Workers communicate through a file-based message bus at `.workspace/messages/`:

| Message Type | Purpose |
|-------------|---------|
| `contract-change` | "I changed an API endpoint" |
| `question` | "Does your side handle X?" |
| `impact-query` | Pre-implementation: "Will my change break you?" |
| `impact-response` | "Yes/No, watch out for..." |
| `task-complete` | "I finished my side" |
| `needs-help` | "I'm stuck, can you check X?" |
| `heads-up` | "I'm about to change Y, FYI" |
| `verification-request` | "Please verify your integrations" |
| `lock-acquired` / `lock-released` | Shared interface edit coordination |
| `bug-report` | "Your endpoint returns 500 when..." |

Workers can also query peers directly via HTTP for synchronous questions.

---

## Cross-Repo Quality Gates

When workspace mode is active, additional quality gates are injected:

- **Contract Compliance**: Changes must comply with declared API contracts in `.workspace/contracts/`
- **Peer Notification**: Affected repos are automatically notified of changes
- **Cascade Verification**: Library changes trigger verification in all consumer repos
- **Cross-Repo Impact Check**: Verify impact assessed before implementation

---

## Contract Management

`workspace-contracts.js` tracks integration health:

- Builds integration map: cross-references provider endpoints with consumer usage
- Detects orphaned consumers (calling endpoints that don't exist)
- Detects orphaned providers (endpoints nobody uses)
- Tracks type versions for schema drift detection
- Supports OpenAPI, GraphQL, TypeScript, and JSON Schema contract formats

---

## Session Continuity

Manager sessions have special handoff handling:

- `saveManagerHandoff()`: Captures dispatched tasks, pending messages, active locks, contract drifts
- `loadManagerHandoff()`: Restores state on next session start
- Session notes and decisions are preserved across restarts

---

## Directory Structure

```
workspace-root/
├── wogi-workspace.json          # Workspace configuration
├── .workspace/
│   ├── state/                   # Workspace-level state
│   │   ├── workspace-manifest.json
│   │   └── manager-session.json
│   ├── contracts/               # Shared API contracts
│   ├── messages/                # Agent-to-agent message bus
│   └── specs/                   # Cross-repo task specs
├── backend/                     # Worker repo (provider)
│   └── .workflow/               # Its own WogiFlow state
├── frontend/                    # Worker repo (consumer)
│   └── .workflow/
└── shared/                      # Worker repo (library)
    └── .workflow/
```

---

## Related

- [Mechanical Gates](../06-safety-guardrails/mechanical-gates.md) — Manager boundary gate details
- [Execution Loop](./02-execution-loop.md) — Single-repo task execution
- [Model Management](./model-management.md) — Multi-model support
