# Wogi Flow Commands Reference

Complete reference for all slash commands and CLI commands.

## Slash Commands

When user types these commands, execute the corresponding action immediately.

### Task Management

| Command | Action |
|---------|--------|
| `/wogi-ready` | Read `ready.json`, show tasks organized by status (ready, in progress, blocked). Summarize what's available to work on. |
| `/wogi-start [id]` | **Self-completing loop.** Load context, decompose into TodoWrite checklist, implement each scenario with self-verification, run quality gates, auto-complete when truly done. Use `--no-loop` for old behavior. |
| `/wogi-done [id]` | Manual completion (optional). Check quality gates, update ready.json, commit. Usually not needed since `/wogi-start` auto-completes. |
| `/wogi-bulk` | Execute multiple tasks in sequence. Order by dependencies + priority. Follow all Task Execution Rules for each. Compact between tasks. Options: number, task IDs, --auto, --plan. |
| `/wogi-status` | Show project overview: task counts, active features, bugs, component count, git status, recent request-log entries. |
| `/wogi-deps [id]` | Find the task in tasks.json, show what it depends on and what depends on it. |

### Story & Feature Creation

| Command | Action |
|---------|--------|
| `/wogi-story [title]` | Create a detailed story using story-writer.md format. Include user story, Given/When/Then acceptance criteria, technical notes with app-map components, test strategy. |
| `/wogi-feature [name]` | Create new feature directory in `.workflow/changes/`. Generate proposal.md and tasks.json templates. Ask user for details to fill in. |
| `/wogi-bug [title]` | Create bug report in `.workflow/bugs/` with next BUG-XXX number. Use bug-report template. |

### Workflow Management

| Command | Action |
|---------|--------|
| `/wogi-session-review` | **Comprehensive code review.** Runs 3 parallel agents: Code & Logic, Security, Architecture & Conflicts. Triggered by command or "please review". Options: `--commits N`, `--staged`, `--security-only`, `--quick`. |
| `/wogi-health` | Check all workflow files exist and are valid. Verify config.json and ready.json are valid JSON. Check app-map sync with src/components. Report issues. |
| `/wogi-standup` | Generate standup summary: what was done (from request-log), what's in progress, what's next, any blockers. |
| `/wogi-session-end` | Ensure request-log is current. Update app-map if components created. Update progress.md. Commit all changes. Offer to push. |
| `/wogi-init` | Initialize workflow structure. Create all directories and state files. Use for new projects. |

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

### Code Traces

| Command | Action |
|---------|--------|
| `/wogi-trace [prompt]` | Generate task-focused code trace. Analyzes codebase to show execution flow, components involved, mermaid diagram. Saves to `.workflow/traces/`. |
| `/wogi-trace list` | List all saved traces. |
| `/wogi-trace [name]` | Load and show an existing trace. |

### Search & Context

| Command | Action |
|---------|--------|
| `/wogi-search [tag]` | Search request-log.md for entries with the given tag. Show matching entries with context. |
| `/wogi-context [id]` | Load all context for a task: the story, related request-log entries, relevant component docs from app-map, decisions.md patterns. |

### Team Collaboration

| Command | Action |
|---------|--------|
| `/wogi-team login <code>` | Join a team with invite code. Downloads team config and triggers initial sync. |
| `/wogi-team logout` | Leave current team. Disables team features but preserves local data. |
| `/wogi-team setup [n]` | List or select a team setup configuration. |
| `/wogi-team sync` | Manually sync knowledge with team backend. |
| `/wogi-team proposals` | View pending team rule proposals. Vote with `proposals vote <id> <approve\|reject>`. |
| `/wogi-team status` | Show team connection status, sync info, and local proposals. |

### PRD Management

| Command | Action |
|---------|--------|
| `/wogi-prd load <file>` | Load PRD markdown file into memory. Chunks content for contextual retrieval. |
| `/wogi-prd context <task>` | Get relevant PRD context for a task description. |
| `/wogi-prd list` | List loaded PRDs with chunk counts. |
| `/wogi-prd show <id>` | Show chunks from a specific PRD. |
| `/wogi-prd remove <id>` | Remove a PRD from memory. |
| `/wogi-prd clear` | Clear all PRD data. |

### Export & Import

| Command | Action |
|---------|--------|
| `/wogi-export [name]` | Export CLAUDE.md, agents/, config.json to a shareable zip. Ask about including decisions.md. |
| `/wogi-import [file]` | Import team profile. Merge or replace workflow config. Restart required after. |
| `/wogi-changelog` | Generate CHANGELOG.md from request-log entries. Group by type (added, changed, fixed). |

### Browser Testing (Claude Extension)

| Command | Action |
|---------|--------|
| `/wogi-test-browser [flow]` | Open browser and execute test flow. Navigate to URLs, interact with elements, verify outcomes. Report pass/fail with screenshots. |
| `/wogi-test-browser all` | Run all test flows defined in `.workflow/tests/flows/`. |
| `/wogi-test-record [name]` | Interactively record a new test flow. Open browser, perform actions, save as JSON flow definition. |

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

### Skills & Rules

| Command | Action |
|---------|--------|
| `/wogi-skills` | List installed and available skills. Show what commands each skill provides. |
| `/wogi-skills add [name]` | Install a skill package. Copy to `.claude/skills/`, update config.json. |
| `/wogi-skills remove [name]` | Remove installed skill. |
| `/wogi-skills info [name]` | Show skill details, commands, templates. |
| `/wogi-rules` | List all coding rules from `.claude/rules/` and installed skills. |
| `/wogi-rules [name]` | View specific rule file. |
| `/wogi-rules add [name]` | Create new rule file. |

### Hybrid Mode (Token Savings)

| Command | Action |
|---------|--------|
| `/wogi-hybrid-setup` | **Full setup for new projects.** Generates project-specific templates by analyzing codebase, then runs interactive setup to configure local LLM. |
| `/wogi-hybrid` | Enable hybrid mode. Runs interactive setup to detect local LLM providers. |
| `/wogi-hybrid-off` | Disable hybrid mode. Returns to normal Claude-only execution. |
| `/wogi-hybrid-status` | Show current hybrid mode configuration. |
| `/wogi-hybrid-edit` | Edit the current execution plan before running. |

### Durable Sessions (v2.0)

| Command | Action |
|---------|--------|
| `/wogi-suspend` | Suspend current task. Options: `--wait-ci`, `--review`, `--rate-limit N`. |
| `/wogi-resume` | Resume suspended task. Options: `--status`, `--approve`. |
| `/wogi-session-end` | Properly end work session. Update logs, commit changes. |

### Loop Enforcement

| Command | Action |
|---------|--------|
| `/wogi-loop` | Show loop status (active session, progress). |

### Memory & Knowledge
| Command | Action |
|---------|--------|
| `/wogi-compact` | Run memory compaction. Preview with `--preview`. |

### Morning Briefing

| Command | Action |
|---------|--------|
| `/wogi-morning` | Morning briefing - show where you left off, pending tasks, recent changes. |

### Verification

| Command | Action |
|---------|--------|
| `/wogi-verify [gate]` | Run verification gate (lint, typecheck, test, build). Use `all` for all gates. |

### Voice Input

| Command | Action |
|---------|--------|
| `/wogi-voice` | Voice-to-transcript input. Subcommands: setup, status, test, record. |

### Guided Edit

| Command | Action |
|---------|--------|
| `/wogi-guided-edit` | Guide through multi-file changes step by step. Shows each edit for approval. |

### Planning & Documentation

| Command | Action |
|---------|--------|
| `/wogi-correction [TASK-XXX]` | Create detailed correction report for significant bug fix. |
| `/wogi-help` | Show all available Wogi Flow commands with descriptions. |

## CLI Commands

```bash
# Setup
npm install wogiflow              # Install WogiFlow in your project
npx flow onboard                  # Analyze existing project & set up context

# Task Management
./scripts/flow ready              # See unblocked tasks
./scripts/flow start TASK-X       # Start a task
./scripts/flow done TASK-X        # Complete a task
./scripts/flow story "title"      # Create detailed story
./scripts/flow story "t" --deep   # Create story with automatic decomposition
./scripts/flow new-feature        # Create feature
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
./scripts/flow browser-suggest    # Suggest browser tests for a task
./scripts/flow standup            # Generate standup summary
./scripts/flow session-end        # End session properly
./scripts/flow search "#tag"      # Search request-log
./scripts/flow context TASK-X     # Load task context
./scripts/flow export-profile     # Export workflow config for team
./scripts/flow import-profile     # Import team config
./scripts/flow archive            # Archive old request-log entries
./scripts/flow watch              # Run file watcher for auto-validation

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

# Memory & Knowledge./scripts/flow memory search <q>  # Search stored facts
./scripts/flow memory stats       # Show memory statistics
./scripts/flow memory-server      # Start MCP memory server
./scripts/flow entropy            # Show memory entropy stats
./scripts/flow entropy --auto     # Auto-compact if entropy high
./scripts/flow entropy --history  # Show entropy history
./scripts/flow compact-memory     # Run full memory compaction
./scripts/flow compact-memory --preview # Show what would be affected
./scripts/flow memory-sync        # Check patterns for promotion
./scripts/flow memory-sync --auto # Auto-promote to decisions.md
./scripts/flow knowledge-route <t> # Detect route for a learning
./scripts/flow knowledge-route store # Store a learning with route
./scripts/flow log-manager status  # Show request-log statistics
./scripts/flow log-manager archive # Archive old log entries

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

# Voice Input
./scripts/flow voice-input setup  # Set up voice input
./scripts/flow voice-input status # Check voice input status
./scripts/flow voice-input test   # Test voice input
./scripts/flow voice-input record # Record voice input

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
