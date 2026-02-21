# Wogi Flow Commands Reference

Complete reference for all slash commands and CLI commands.

## Slash Commands

When user types these commands, execute the corresponding action immediately.

### Task Management

| Command | Action |
|---------|--------|
| `/wogi-ready` | Read `ready.json`, show tasks organized by status (ready, in progress, blocked). Summarize what's available to work on. |
| `/wogi-start [id]` | **Self-completing loop.** Load context, decompose into TodoWrite checklist, implement each scenario with self-verification, run quality gates, auto-complete when truly done. Use `--no-loop` for old behavior. |
| `/wogi-bulk` | Execute multiple tasks in sequence. Order by dependencies + priority. Follow all Task Execution Rules for each. Compact between tasks. Options: number, task IDs, --auto, --plan. |
| `/wogi-bulk-loop` | Continuous work loop — processes captured ideas and queued tasks automatically. |
| `/wogi-log` | Add an entry to the request log manually. Used for tracking changes outside the normal task flow. |
| `/wogi-status` | Show project overview: task counts, active features, bugs, component count, git status, recent request-log entries. |
| `/wogi-deps [id]` | Find the task in tasks.json, show what it depends on and what depends on it. |

### Story & Feature Creation

| Command | Action |
|---------|--------|
| `/wogi-story [title]` | Create a detailed story. Simple stories go flat in `.workflow/changes/`. Use `--deep` for decomposition which creates a feature folder. Auto-archived when completed. |
| `/wogi-bug [title]` | Create bug report in `.workflow/bugs/` with next BUG-XXX number. Use bug-report template. |
| `/wogi-feature [title]` | Manage features - group related stories under a coherent product capability. Create, list, add stories. |
| `/wogi-epics [title]` | Manage epics - large initiatives spanning multiple stories. Create, decompose, track progress. |
| `/wogi-plan [title]` | Manage plans - strategic initiatives coordinating epics and features into higher-level strategy. |

### Workflow Management

| Command | Action |
|---------|--------|
| `/wogi-review` | **Comprehensive code review.** First runs verification gates (lint, typecheck, test), then 3 parallel AI agents: Code & Logic, Security, Architecture. Triggered by command or "please review". Options: `--commits N`, `--staged`, `--skip-verify`, `--verify-only`, `--security-only`, `--quick`. |
| `/wogi-health` | Check all workflow files exist and are valid. Verify config.json and ready.json are valid JSON. Check app-map sync with src/components. Report issues. |
| `/wogi-standup` | Generate standup summary: what was done (from request-log), what's in progress, what's next, any blockers. |
| `/wogi-session-end` | End session: update progress, analyze session for learnings (auto-apply 90%+ confidence patterns), archive logs, offer tech debt cleanup, commit and push. |
| `/wogi-init` | Initialize workflow structure. Create all directories and state files. Use for new projects. |
| `/wogi-review-fix` | Code review with automatic fixing. Runs full review process then auto-fixes all findings. |
| `/wogi-peer-review` | Multi-model code review - different AI models review same code for diverse perspectives. |
| `/wogi-triage` | Interactive walkthrough of review findings from last-review.json. Categorize, dismiss, or create tasks. |
| `/wogi-onboard` | Analyze existing project with deep temporal analysis, pattern extraction, and state file generation. |
| `/wogi-rescan` | Re-scan project after external changes. Smart diff: auto-adds new items, auto-removes deleted items, presents conflicts one-by-one. Options: `--dry-run`, `--auto-resolve`, `--category`, `--since`. |
| `/wogi-morning` | Morning briefing - where you left off, pending tasks, key context, recommended starting task. |
| `/wogi-compact` | Run memory compaction to free context space. Preview with `--preview`. |
| `/wogi-debt` | View and manage technical debt across sessions. |
| `/wogi-roadmap` | View and manage deferred work items. Add, archive, promote to stories. |

### Debugging & Investigation

| Command | Action |
|---------|--------|
| `/wogi-debug-hypothesis [desc]` | Parallel hypothesis debugging - spawns multiple agents investigating competing theories simultaneously. Use for complex bugs with unclear root cause. |
| `/wogi-debug-browser [desc]` | WebMCP-powered browser debugging - uses structured tool calls instead of screenshots for precise UI inspection and state debugging. |
| `/wogi-trace [prompt]` | Generate task-focused code trace showing execution flow, components involved, and mermaid diagram. |
| `/wogi-test-browser [flow]` | WebMCP-powered browser testing - defines test flows as structured tool call sequences with expectations. |

### Capture & Extraction

| Command | Action |
|---------|--------|
| `/wogi-capture [idea]` | Quick-capture an idea or bug without interrupting current work. Routes to appropriate backlog. |
| `/wogi-extract-review [input]` | Zero-loss task extraction from transcripts/recordings with mandatory review step. |

### Component Management

| Command | Action |
|---------|--------|
| `/wogi-map` | Show app-map.md contents - all screens, modals, components. |
| `/wogi-map-add [name] [path] [variants]` | Add component to app-map.md. Create detail file in `.workflow/state/components/`. |
| `/wogi-map-scan [dir]` | Scan directory for component files. Compare with app-map. Report unmapped components. |
| `/wogi-map-check` | Check if mapped components still exist in codebase. Report drift. |
| `/wogi-map-index` | Show auto-generated component index summary. |
| `/wogi-map-index scan` | Rescan codebase and regenerate component-index.json. |
| `/wogi-map-sync` | Compare auto-generated index with curated app-map. Show what's missing, what's stale. Offer to update. |

### Search & Context

| Command | Action |
|---------|--------|
| `/wogi-search [tag]` | Search request-log.md for entries with the given tag. Show matching entries with context. |
| `/wogi-context [id]` | Load all context for a task: story, product context (from product.md), related request-log entries, component docs from app-map, decisions.md patterns. |

### Export & Import

| Command | Action |
|---------|--------|
| `/wogi-export [name]` | Export CLAUDE.md, agents/, config.json to a shareable zip. Ask about including decisions.md. |
| `/wogi-import [file]` | Import workflow profile. Merge or replace workflow config. Restart required after. |
| `/wogi-changelog` | Generate CHANGELOG.md from request-log entries. Group by type (added, changed, fixed). |

### Status Line

| Command | Action |
|---------|--------|
| `/wogi-statusline-setup` | Configure Claude Code's status line to show task info and context %. Opens interactive wizard or use `--format` flag. |

### Configuration

| Command | Action |
|---------|--------|
| `/wogi-config` | Show current config.json settings summary. |
| `/wogi-config storybook on` | Enable auto-generation of Storybook stories for new components. |
| `/wogi-config storybook off` | Disable Storybook auto-generation. |
| `/wogi-config hooks on` | Enable pre-commit hooks. Runs `flow setup-hooks install`. |
| `/wogi-config hooks off` | Disable pre-commit hooks. |
| `/wogi-config tests-before-commit on/off` | Toggle running tests before commits. |
| `/wogi-config phases on/off` | Toggle phase-based planning. |

### Rules & Learning

| Command | Action |
|---------|--------|
| `/wogi-decide [rule]` | Create or update project rules with clarifying questions. Trigger: "from now on always/never/must/should..." |
| `/wogi-learn` | Promote feedback patterns to permanent decision rules. Browse, incident, or bulk mode. |
| `/wogi-retrospective` | Guided session reflection — extracts lessons, routes to rules or learnings. |
| `/wogi-rules` | List all coding rules from `.claude/rules/` and installed skills. |
| `/wogi-rules [name]` | View specific rule file. |
| `/wogi-rules add [name]` | Create new rule file. |

### Skills & Stack

| Command | Action |
|---------|--------|
| `/wogi-skills` | List installed and available skills. Show what commands each skill provides. |
| `/wogi-skills add [name]` | Install a skill package. Copy to `.claude/skills/`, update config.json. |
| `/wogi-skills remove [name]` | Remove installed skill. |
| `/wogi-skills info [name]` | Show skill details, commands, templates. |
| `/wogi-skill-learn` | Extract learnings from recent code changes into skill patterns. |
| `/wogi-setup-stack` | Interactive tech stack wizard — detects frameworks and generates skills. |
| `/wogi-models-setup` | Configure external models for peer review and hybrid mode. |

### Hybrid Mode (Token Savings)

| Command | Action |
|---------|--------|
| `/wogi-hybrid-setup` | **Full setup for new projects.** Generates project-specific templates by analyzing codebase, then runs interactive setup to configure local LLM. |
| `/wogi-hybrid` | Enable hybrid mode. Runs interactive setup to detect local LLM providers. |
| `/wogi-hybrid-off` | Disable hybrid mode. Returns to normal Claude-only execution. |
| `/wogi-hybrid-status` | Show current hybrid mode configuration. |
| `/wogi-hybrid-edit` | Edit the current execution plan before running. |

### Memory & Knowledge

| Command | Action |
|---------|--------|
| `/wogi-suspend` | Suspend current task with resume condition (--wait-ci, --review, --rate-limit). |
| `/wogi-resume` | Resume a suspended task. Use --status to check, --approve to approve review. |

### Research Protocol (Zero-Trust)

| Command | Action |
|---------|--------|
| `/wogi-research [question]` | Execute rigorous research before answering capability/feasibility questions. Phases: scope mapping, evidence gathering, external verification, assumption check, synthesis. |
| `/wogi-research --quick [q]` | Quick research (5K tokens) - 1-2 files, no web search. |
| `/wogi-research --deep [q]` | Deep research (50K tokens) - full file audit, multiple web searches. |
| `/wogi-research --exhaustive [q]` | Exhaustive research (100K+ tokens) - everything + user confirmation gates. |
| `/wogi-correction [id]` | Create detailed correction report for a significant bug fix with root cause analysis. |

### Planning & Documentation

| Command | Action |
|---------|--------|
| `/wogi-help` | Show all available Wogi Flow commands with descriptions. |
| `/wogi-guided-edit` | Guide through multi-file changes step by step with approval at each edit. |

## CLI Commands

```bash
# Setup
npm install wogiflow              # Install WogiFlow in your project
npx flow onboard                  # Analyze existing project & set up context

# Task Management
./scripts/flow ready              # See unblocked tasks
./scripts/flow start TASK-X       # Start a task
./scripts/flow story "title"      # Create simple story (flat)
./scripts/flow story "t" --deep   # Create decomposed story (feature folder)
./scripts/flow bug                # Report bug
./scripts/flow status             # Project overview
./scripts/flow deps TASK-X        # Show task dependencies

# Workflow
./scripts/flow morning            # Morning briefing
./scripts/flow health             # Check workflow health
./scripts/flow verify <gate>      # Run verification gate (lint, typecheck, test, build)
./scripts/flow verify all         # Run all verification gates
./scripts/flow regression         # Run regression tests
./scripts/flow regression --all   # Test all completed tasks
./scripts/flow standup            # Generate standup summary
./scripts/flow session-end        # End session properly (with learning analysis)
./scripts/flow session-learning   # Analyze session for patterns (standalone)
./scripts/flow search "#tag"      # Search request-log
./scripts/flow context TASK-X     # Load task context
./scripts/flow export-profile     # Export workflow config as shareable profile
./scripts/flow import-profile     # Import workflow profile
./scripts/flow archive            # Archive old request-log entries
./scripts/flow watch              # Run file watcher for auto-validation
./scripts/flow rescan             # Re-scan project after external changes
./scripts/flow rescan --dry-run   # Show what would change without applying
./scripts/flow rescan --auto-resolve  # Auto-resolve pattern conflicts (newer wins)
./scripts/flow rescan --category stack  # Rescan specific category only
./scripts/flow rescan --since 2026-02-01  # Only changes since date

# Durable Sessions (v2.0)
./scripts/flow suspend            # Suspend current task
./scripts/flow suspend --wait-ci  # Suspend waiting for CI
./scripts/flow suspend --review   # Suspend for human review
./scripts/flow resume             # Resume suspended task
./scripts/flow resume --status    # Show suspension status
./scripts/flow resume --approve   # Approve human review
./scripts/flow session status     # Show durable session status
./scripts/flow session stats      # Show session statistics
./scripts/flow session clear      # Clear active session

# Loop Enforcement
./scripts/flow loop status        # Show active loop session
./scripts/flow loop stats         # Show loop statistics
./scripts/flow loop can-exit      # Check if current loop can exit
./scripts/flow loop enable        # Enable loop enforcement
./scripts/flow loop disable       # Disable loop enforcement

# Components
./scripts/flow update-map         # Add/scan components
./scripts/flow map-index          # Show component index
./scripts/flow map-index scan     # Rescan codebase
./scripts/flow map-sync           # Compare index with app-map

# Skills & Learning
./scripts/flow skill-learn        # Extract learnings from recent changes
./scripts/flow skill-create <n>   # Create a new skill
./scripts/flow skill detect       # Detect frameworks in project
./scripts/flow skill list         # List installed skills
./scripts/flow correct            # Capture a correction/learning
./scripts/flow correct "desc"     # Quick mode with description
./scripts/flow correct list       # List recent corrections
./scripts/flow aggregate          # Aggregate learnings across skills
./scripts/flow aggregate --promote # Interactive promotion wizard

# Code Traces
./scripts/flow trace "prompt"     # Generate code trace
./scripts/flow trace list         # List saved traces
./scripts/flow trace show <name>  # Show a saved trace

# Run History
./scripts/flow run-trace start <n> # Start a new traced run
./scripts/flow run-trace end       # End current run
./scripts/flow history             # List recent runs
./scripts/flow inspect <run-id>    # Show run details

# Diff Preview
./scripts/flow diff <f1> <f2>     # Show diff between files
./scripts/flow diff --preview <j> # Preview proposed changes
./scripts/flow diff --apply <j>   # Apply changes from JSON
./scripts/flow diff --dry-run <j> # Show diff without prompting

# Checkpoints
./scripts/flow checkpoint create  # Create manual checkpoint
./scripts/flow checkpoint list    # List all checkpoints
./scripts/flow checkpoint rollback <id> # Rollback to checkpoint
./scripts/flow checkpoint cleanup # Remove old checkpoints

# Memory & Knowledge
node scripts/flow-memory-db.js search <q>       # Search stored facts
node scripts/flow-memory-db.js stats             # Show memory statistics
node scripts/flow-memory-db.js server            # Start MCP memory server
node scripts/flow-entropy-monitor.js             # Show memory entropy stats
node scripts/flow-entropy-monitor.js --auto      # Auto-compact if entropy high
node scripts/flow-entropy-monitor.js --history   # Show entropy history
node scripts/flow-memory-compactor.js            # Run full memory compaction
node scripts/flow-memory-compactor.js --preview  # Show what would be affected
node scripts/flow-memory-sync.js                 # Check patterns for promotion
node scripts/flow-memory-sync.js --auto          # Auto-promote to decisions.md
node scripts/flow-knowledge-router.js <t>        # Detect route for a learning
node scripts/flow-knowledge-router.js store      # Store a learning with route
node scripts/flow-log-manager.js status          # Show request-log statistics
node scripts/flow-log-manager.js archive         # Archive old log entries

# Hybrid Mode
./scripts/flow hybrid setup       # Full setup (templates + config)
./scripts/flow hybrid enable      # Enable hybrid mode
./scripts/flow hybrid disable     # Disable hybrid mode
./scripts/flow hybrid status      # Show hybrid configuration
./scripts/flow hybrid execute     # Execute a plan file
./scripts/flow hybrid rollback    # Rollback last execution
./scripts/flow hybrid test        # Test hybrid installation
./scripts/flow hybrid learning    # Show learning stats
./scripts/flow templates generate # Generate project templates

# Model Providers
./scripts/flow providers list     # List all available providers
./scripts/flow providers detect   # Detect running local providers
./scripts/flow providers test <t> # Test a provider connection

# Declarative Workflows
./scripts/flow workflow list      # List available workflows
./scripts/flow workflow run <n>   # Run a workflow
./scripts/flow workflow create <n> # Create workflow template

# Decision Amendment Tracking
node scripts/flow-decision-tracker.js record <section> <action> <rationale>  # Record amendment
node scripts/flow-decision-tracker.js history [section]  # Show history
node scripts/flow-decision-tracker.js history --json     # JSON output
node scripts/flow-decision-tracker.js stats              # Show statistics
node scripts/flow-decision-tracker.js stats --json       # JSON stats
node scripts/flow-decision-tracker.js diff <id>          # Show specific amendment

# Cross-Artifact Consistency
node scripts/flow-consistency-check.js        # Run consistency check
node scripts/flow-consistency-check.js --json # JSON output for CI
node scripts/flow-consistency-check.js --mode block  # Block on failures

# Metrics & Analysis
./scripts/flow metrics            # Show command success/failure stats
./scripts/flow metrics --problems # Show only problematic commands
./scripts/flow metrics --reset    # Clear all metrics
./scripts/flow insights           # Generate codebase insights
./scripts/flow auto-context "t"   # Preview context for a task
./scripts/flow model-adapter      # Show model adapter info
./scripts/flow complexity "task"  # Assess task complexity
./scripts/flow safety             # Run security scan
./scripts/flow context-init "t"   # Initialize context for task

# Worktree Isolation
./scripts/flow worktree enable    # Enable worktree isolation
./scripts/flow worktree disable   # Disable worktree isolation
./scripts/flow worktree list      # List active task worktrees
./scripts/flow worktree cleanup   # Remove stale worktrees
./scripts/flow worktree status    # Show worktree configuration

# Parallel Execution
./scripts/flow parallel config    # Show parallel config
./scripts/flow parallel check     # Check tasks for parallel potential
./scripts/flow parallel analyze   # Analyze tasks for parallel potential
./scripts/flow parallel suggest   # Check if parallel should be suggested
./scripts/flow parallel enable    # Enable parallel execution
./scripts/flow parallel disable   # Disable parallel execution

# Figma Analyzer
./scripts/flow figma scan         # Scan codebase for components
./scripts/flow figma show [name]  # Show component details
./scripts/flow figma extract <f>  # Extract from Figma MCP data
./scripts/flow figma match <f>    # Match against registry
./scripts/flow figma analyze <f>  # Full pipeline
./scripts/flow figma confirm <f>  # Interactive confirmation
./scripts/flow figma generate     # Generate code from decisions
./scripts/flow figma server       # Start MCP server

# Research Protocol
./scripts/flow research "q"       # Execute research protocol
./scripts/flow research --quick   # Quick research (5K tokens)
./scripts/flow research --deep    # Deep research (50K tokens)
./scripts/flow research --exhaustive # Full audit (100K+ tokens)
./scripts/flow research cache     # Show cached verifications
./scripts/flow research cache clear # Clear verification cache
```

## Command Execution

When user types a slash command:
1. Parse the command and arguments
2. Execute the action (read files, update state, etc.)
3. Provide clear output
4. If command modifies files, log to request-log if appropriate

Example:
```
User: /wogi-ready
Agent:
📋 **Task Queue**

**Ready (3)**
• TASK-012: Add forgot password link [High]
• TASK-015: User profile page [Medium]
• TASK-018: Settings modal [Low]

**In Progress (1)**
• TASK-011: Login form validation

**Blocked (1)**
• TASK-020: Email notifications (waiting on TASK-019)

Recommend starting with TASK-012 (high priority, no dependencies).
```
