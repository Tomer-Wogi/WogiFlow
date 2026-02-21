# WogiFlow

A self-improving AI development workflow that learns from your feedback. Currently supports **Claude Code 2.1.23+**.

```bash
npm install wogiflow
npx flow onboard        # Analyze your project
npx flow bridge sync    # Sync to Claude Code
```

## Features

| Feature | Description |
|---------|-------------|
| **Task Gating** | Blocks implementation without an active tracked task |
| **Self-Completing Tasks** | `/wogi-start` runs until all acceptance criteria pass |
| **Multi-Agent Explore Phase** | 5-6 parallel research agents analyze codebase before implementation |
| **Extensible Registry** | Plugin-based component/function/API registries with auto-activation |
| **AI-Judge Semantic Matching** | Detects duplicate components, functions, and APIs using AI similarity |
| **Framework Discovery** | Auto-detects your stack and activates relevant registry plugins |
| **Consumer Impact Analysis** | Maps all code consumers before refactoring to prevent breakage |
| **Component Registry** | Tracks all components in `app-map.md` — prevents duplicates |
| **Function Registry** | Tracks utility functions in `function-map.md` — prevents duplicates |
| **API Registry** | Tracks endpoints in `api-map.md` — prevents duplicates |
| **Adversarial Code Review** | Review agents must find minimum findings or justify clean code |
| **Git-Verified Claims** | Cross-references spec deliverables against actual `git diff` |
| **Standards Compliance** | Auto-checks naming conventions, security patterns, and project rules |
| **TDD Mode** | Opt-in test-first development (write test → fail → implement → pass) |
| **Phased Execution** | Contract → Skeleton → Core → Edge Cases → Polish |
| **Hybrid Mode** | Claude plans, local LLM executes (20-60% token savings) |
| **Peer Review** | Multi-model code review for diverse perspectives |
| **Skills System** | Modular add-ons that learn from your sessions |
| **Research Protocol** | Enforces verification before capability claims |
| **Worktree Isolation** | Parallel tasks run in isolated git worktrees |
| **Parallel Execution** | Independent tasks execute concurrently |
| **Memory Systems** | MCP-based memory server with SQLite persistence |
| **Durable Sessions** | Suspend/resume tasks across sessions with full context |
| **Debug Hypothesis** | Parallel agents investigate competing theories simultaneously |
| **Browser Debug/Test** | WebMCP-powered browser debugging and test flows |
| **Decision Tracking** | Auditable amendment trail for all project rule changes |
| **Cross-Artifact Consistency** | Validates registries against codebase — detects orphans and phantoms |
| **Self-Improvement** | Learns from corrections — after 3+ similar mistakes, creates permanent rules |

See the [Knowledge Base](.claude/docs/knowledge-base/) for detailed documentation on each feature.

## Commands

### Slash Commands (in Claude Code)

| Category | Commands | Description |
|----------|----------|-------------|
| **Daily** | `/wogi-morning`, `/wogi-ready`, `/wogi-status` | Briefing, task queue, project overview |
| **Tasks** | `/wogi-start`, `/wogi-story`, `/wogi-bug`, `/wogi-bulk` | Execute, create stories, report bugs, batch process |
| **Planning** | `/wogi-feature`, `/wogi-epics`, `/wogi-plan`, `/wogi-deps` | Feature/epic/plan management, dependency trees |
| **Review** | `/wogi-review`, `/wogi-review-fix`, `/wogi-peer-review`, `/wogi-triage` | Code review, auto-fix, multi-model, finding triage |
| **Debug** | `/wogi-debug-hypothesis`, `/wogi-debug-browser`, `/wogi-test-browser`, `/wogi-trace` | Parallel theories, browser debug, test flows, code traces |
| **Registries** | `/wogi-map`, `/wogi-map-add`, `/wogi-map-scan`, `/wogi-map-sync`, `/wogi-map-check` | Component registry management |
| **Rules** | `/wogi-decide`, `/wogi-learn`, `/wogi-rules`, `/wogi-retrospective` | Create rules, promote patterns, session retros |
| **Research** | `/wogi-research`, `/wogi-correction` | Zero-trust verification, correction reports |
| **Context** | `/wogi-compact`, `/wogi-context`, `/wogi-suspend`, `/wogi-resume` | Memory management, task context, suspend/resume |
| **Capture** | `/wogi-capture`, `/wogi-extract-review`, `/wogi-changelog` | Quick capture, transcript extraction, changelogs |
| **Hybrid** | `/wogi-hybrid`, `/wogi-hybrid-setup`, `/wogi-hybrid-off`, `/wogi-hybrid-status` | Local LLM integration |
| **Skills** | `/wogi-skills`, `/wogi-skill-learn`, `/wogi-setup-stack` | Skill packages, learning extraction, stack detection |
| **Session** | `/wogi-session-end`, `/wogi-health`, `/wogi-standup` | End session, health check, standup summary |
| **Config** | `/wogi-config`, `/wogi-statusline-setup`, `/wogi-init`, `/wogi-onboard` | Configuration, status line, setup |
| **Utilities** | `/wogi-search`, `/wogi-guided-edit`, `/wogi-export`, `/wogi-import`, `/wogi-debt`, `/wogi-roadmap`, `/wogi-log`, `/wogi-rescan` | Search, guided edits, export/import, tech debt, roadmap |

See [Command Reference](.claude/docs/commands.md) for full details on every command.

### CLI Commands

```bash
flow onboard                # Analyze project & set up context
flow bridge sync            # Sync workflow to Claude Code
flow ready                  # Show task queue
flow start <id>             # Start a task
flow status                 # Project overview
flow health                 # Check workflow integrity
flow verify all             # Run all quality gates
flow map-index scan         # Rescan component registry
flow skill-learn            # Extract learnings from session
flow hybrid setup           # Configure local LLM integration
flow worktree enable        # Enable worktree isolation
flow parallel check         # Check for parallelizable tasks
flow figma analyze <file>   # Figma-to-code pipeline
flow research "question"    # Execute research protocol
flow metrics                # Command success/failure stats
```

Run `flow --help` or see [CLI docs](.claude/docs/commands.md#cli-commands) for the full list (100+ subcommands).

## How Tasks Work

```
/wogi-start "add logout button"
    │
    ├── Classify request → Route to story creation
    ├── Multi-agent research (5 parallel agents)
    ├── Generate spec with acceptance criteria
    ├── Approval gate (for stories/epics)
    │
    │   FOR EACH criterion:
    │   ├── Implement
    │   ├── Verify (lint, typecheck, tests)
    │   └── Mark complete only when passing
    │
    ├── Criteria completion check (re-verify ALL)
    ├── Wiring check (no orphan files)
    ├── Standards compliance check
    ├── Update registries + request-log
    └── Commit
```

## File Structure

```
.workflow/
├── config.json              # Workflow configuration (200+ options)
├── state/
│   ├── ready.json           # Task queue
│   ├── request-log.md       # Change history
│   ├── app-map.md           # Component registry
│   ├── function-map.md      # Utility function registry
│   ├── api-map.md           # API endpoint registry
│   ├── decisions.md          # Project rules (auto-learned)
│   └── progress.md          # Session handoff notes
├── templates/               # CLAUDE.md generation templates
└── bridges/                 # CLI bridge implementations

.claude/
├── commands/                # 64 slash commands
├── skills/                  # Skill modules (auto-learned)
├── rules/                   # Project coding rules
└── docs/                    # Documentation & knowledge base
```

## Documentation

| Category | Topics |
|----------|--------|
| [Setup & Onboarding](.claude/docs/knowledge-base/01-setup-onboarding/) | Installation, project analysis, component indexing |
| [Task Execution](.claude/docs/knowledge-base/02-task-execution/) | Execution pipeline, verification, completion, specifications |
| [Self-Improvement](.claude/docs/knowledge-base/03-self-improvement/) | Skills, learning, model adapters, pattern promotion |
| [Memory & Context](.claude/docs/knowledge-base/04-memory-context/) | Context management, session persistence, memory systems |
| [Development Tools](.claude/docs/knowledge-base/05-development-tools/) | Figma analyzer, code traces, MCP integrations |
| [Safety & Guardrails](.claude/docs/knowledge-base/06-safety-guardrails/) | Damage control, security scanning, checkpoint/rollback |
| [Configuration](.claude/docs/knowledge-base/configuration/) | All 200+ configuration options |
| [Command Reference](.claude/docs/commands.md) | Every slash command and CLI command |

## License

AGPL-3.0
