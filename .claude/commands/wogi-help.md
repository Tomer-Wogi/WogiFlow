Show all available Wogi Flow commands.

Usage: `/wogi-help`

## Output

```
🚀 Wogi Flow - Command Reference

═══════════════════════════════════════════════════════════════
SETUP & ONBOARDING
═══════════════════════════════════════════════════════════════
/wogi-onboard            Analyze existing project, set up context
/wogi-init               Initialize workflow structure
/wogi-config             Show/modify configuration
/wogi-skills             Manage skill packages
/wogi-rules              View/manage coding rules

═══════════════════════════════════════════════════════════════
TASK MANAGEMENT
═══════════════════════════════════════════════════════════════
/wogi-ready              Show tasks by status, recommend next
/wogi-start [id]         Start task, load context
/wogi-bulk               Execute multiple tasks in sequence
/wogi-status             Full project overview
/wogi-deps [id]          Show task dependency tree

═══════════════════════════════════════════════════════════════
STORY & FEATURE CREATION
═══════════════════════════════════════════════════════════════
/wogi-story [title]      Create detailed story with acceptance criteria
/wogi-feature [name]     Create new feature with tasks
/wogi-bug [title]        Create bug report

═══════════════════════════════════════════════════════════════
WORKFLOW
═══════════════════════════════════════════════════════════════
/wogi-health             Check all workflow files
/wogi-standup            Generate standup summary
/wogi-session-end        End session properly
/wogi-compact            Prepare for context compaction
/wogi-roadmap            Show phase-based roadmap (if enabled)

═══════════════════════════════════════════════════════════════
COMPONENT MANAGEMENT
═══════════════════════════════════════════════════════════════
/wogi-map                Show full component registry
/wogi-map-add [name]     Add component to registry
/wogi-map-scan [dir]     Find unmapped components
/wogi-map-check          Check for drift

═══════════════════════════════════════════════════════════════
DEBUGGING
═══════════════════════════════════════════════════════════════
/wogi-debug-browser [desc]   WebMCP browser debug (structured tool calls)
/wogi-test-browser [flow]    WebMCP browser test flows with assertions
/wogi-debug-hypothesis [desc] Parallel hypothesis investigation
/wogi-trace [feature]        Code flow trace for a feature

═══════════════════════════════════════════════════════════════
LEARNING & RULES
═══════════════════════════════════════════════════════════════
/wogi-decide [rule]      Create project rule with clarifying questions
/wogi-learn              Promote feedback patterns to decision rules
/wogi-retrospective      Guided session reflection with lesson capture

═══════════════════════════════════════════════════════════════
SEARCH & CONTEXT
═══════════════════════════════════════════════════════════════
/wogi-search [query]     Search request-log
/wogi-context [id]       Load all task context
/wogi-log                Add request-log entry

═══════════════════════════════════════════════════════════════
DOCUMENTATION
═══════════════════════════════════════════════════════════════
/wogi-changelog          Generate changelog
/wogi-correction [id]    Create detailed correction report

═══════════════════════════════════════════════════════════════
CONFIGURATION
═══════════════════════════════════════════════════════════════
/wogi-config             Show/modify configuration
/wogi-skills             Manage skill packages
/wogi-export [name]      Export workflow profile
/wogi-import [file]      Import team profile

═══════════════════════════════════════════════════════════════
SKILL COMMANDS (when installed)
═══════════════════════════════════════════════════════════════
Run /wogi-skills to see commands from installed skills.

Example (NestJS skill):
  /nestjs-scaffold [name]  Create complete module
  /nestjs-entity [name]    Create TypeORM entity
  /nestjs-db migrate       Run migrations
```

## Quick Tips

• Start your day: `/wogi-ready`
• End your day: `/wogi-session-end`
• Check health: `/wogi-health`
• Get task context: `/wogi-context wf-XXXXXXXX`
