# Explore Phase Agent Prompts

Reference document for `/wogi-start` Step 1.3. Read this file when entering the explore phase.

## Agent 1: Codebase Analyzer

Launch as `Agent(subagent_type=Explore)`:

```
Analyze the codebase for task: "[TASK_TITLE]"

STEP 1 — Domain-keyword search (MANDATORY, do this FIRST):
  a. Extract 3-5 domain keywords from the task title
     Example: "AI Policies tab" → ["policy", "policies", "automation", "AI"]
     Example: "Payment service refactor" → ["payment", "checkout", "billing", "transaction"]
  b. For EACH keyword, run:
     - Glob **/*[keyword]* to find files with that keyword in the name
     - Grep for the keyword in src/ (or project root) to find references in code
  c. Read EVERY file that matches — these are potential reuse candidates
  d. Pay special attention to files in shared/, utils/, lib/, common/ directories

STEP 2 — Registry check (read ALL registry maps):
  a. Read app-map.md for existing components that could be reused
  b. Read function-map.md for existing utility functions
  c. Read api-map.md for existing API endpoints
  d. Read any other *-map.md files in .workflow/state/
  e. For each planned NEW item, check if something similar already exists

STEP 3 — Pattern & dependency analysis:
  a. Read decisions.md for patterns that must be followed
  b. Map dependencies:
     - Files that REFERENCE the target code
     - Files REFERENCED BY the target code
  c. Surface assumptions that need verification

Return a structured summary:
- **REUSE CANDIDATES** (MUST be first section):
  List every existing file/component/function/service that overlaps
  with what this task plans to create. For each: path, purpose, and
  whether the task should USE it, EXTEND it, or CREATE new.
- Related files (path + why it's relevant)
- Patterns to follow (from decisions.md)
- Dependency map
- Assumptions to verify

CRITICAL: If domain-keyword search finds existing implementations that
overlap with the task's goals, this MUST be prominently flagged.
Do NOT skip Step 1 even if you think you already know the codebase.
```

## Agent 2: Best Practices Researcher

Launch as `Agent(subagent_type=Explore)` (skipped if `researchDepth: "minimal"`):

```
Research best practices for: "[TASK_TITLE]"

1. Web search for current best practices related to this task type
   - Include the current year in searches for up-to-date results
   - Search for: "[task type] best practices [year]"
   - Search for: "[relevant technology] patterns [year]"
   - Maximum 3 web searches
2. Look for common pitfalls and anti-patterns
3. Check if there are established patterns in the ecosystem

Return:
- Best practices found (with sources)
- Common pitfalls to avoid
- Recommended patterns
```

## Agent 3: Framework/Version Verifier

Launch as `Agent(subagent_type=Explore)` (skipped if `researchDepth: "minimal"`):

```
Verify framework versions and API compatibility for: "[TASK_TITLE]"

1. Read package.json to get actual dependency versions
2. For each relevant dependency:
   - Web search for "[package]@[version] API documentation"
   - Verify the APIs we plan to use exist in this version
   - Flag any deprecated APIs
3. Check for version-specific gotchas

Return:
- Dependency versions relevant to this task
- API compatibility notes
- Deprecated APIs to avoid
- Version-specific considerations
```

## Agent 4: Risk & History Analyzer

Launch as `Agent(subagent_type=Explore)` (local only, no web searches):

```
Analyze risk and history for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned files: [FILES_TO_CHANGE]

1. Read .workflow/state/feedback-patterns.md
   - Search for entries matching this task type and planned file extensions
   - Extract the top 5 most relevant patterns with occurrence counts
2. Search .workflow/corrections/ directory for correction reports
   - Read any that relate to the same feature area or file paths
   - Extract lessons learned
3. Search .workflow/state/decisions.md for rules tagged with the task type
   - Focus on rules promoted from repeated violations (count >= 3)
   - Extract specific verification steps required
4. If a memory database exists (.workflow/memory/local.db or via MCP):
   - Query for rejected approaches from past tasks touching the same files
   - Surface any "approach X was tried and failed" warnings
5. **Eval trend analysis** (NEW — from Anthropic harness design research):
   - Read `.workflow/evals/` directory for the last 5-10 eval results
   - Calculate average score per dimension (completeness, accuracy, workflowCompliance, tokenEfficiency, quality)
   - If any dimension averages below 6/10 across recent evals:
     - Flag it as a RECURRING WEAKNESS
     - Suggest a mitigation for the spec (e.g., "tokenEfficiency averaging 4/10 → add context budgeting hints")
   - If eval calibration exists (`.workflow/state/eval-calibration.json`):
     - Compare the current task type against high/low calibration examples
     - Warn if this task type historically scores low

Return:
- Known risks for this task type (from feedback-patterns)
- Past corrections in this area (from corrections/)
- Promoted rules that apply (from decisions.md, count >= 3)
- Rejected approaches from similar past work (from memory-db)
- **Eval trend warnings** (dimensions scoring below 6/10 in recent evals)
- **Recommended spec hints** (based on eval trends — inject into spec generation)
- Confidence: HIGH (many data points) / MEDIUM / LOW (no history)
```

## Agent 5: Standards Preview + Reuse Candidate Discovery

Launch as `Agent(subagent_type=Explore)` (local only, no web searches):

```
Preview applicable standards and discover reuse candidates for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned files: [FILES_TO_CHANGE]

1. Determine which standard checks apply based on planned file paths:
   - Components (.tsx, .jsx) → naming, components, security
   - Utilities (utils/, helpers/) → naming, functions, security
   - API routes (api/, routes/) → naming, api, security
   - Schemas/models → naming, schemas, security
   - Services → naming, services, security
   - Bugfix → naming, security (minimal)
   - Feature/refactor → all checks
2. Read .claude/rules/code-style/naming-conventions.md — extract applicable rules
3. Read .claude/rules/security/security-patterns.md — extract relevant patterns
4. Read ALL registry map files:
   - .workflow/state/app-map.md, function-map.md, api-map.md
   - .workflow/state/schema-map.md, service-map.md (if exist)
   - Also scan .workflow/state/*-map.md for additional registries
   - For each planned NEW item, check similarity against existing (30% threshold)
   - Reason about PURPOSE overlap, not just name similarity
5. Read .workflow/state/decisions.md — extract coding rules for this task type

Return:
- Standards that WILL be enforced (rule name + how to comply)
- Reuse candidates across ALL registries (with purpose analysis)
- Security patterns that apply
```

## Agent 6: Consumer Impact Analyzer (ALL L1+ Tasks)

Launch as `Agent(subagent_type=Explore)` (local only). **MANDATORY for ALL L1+ tasks (stories, epics, features).** Also triggered for any L2 task that modifies schema/model files.

Previously limited to refactor/migration only, but blast-radius analysis has proven valuable for ALL task types — a feature task's consumer grep collapsed a 3-day estimate to 0.5 days (18:1 ROI).

Trigger: ALL tasks at level L1 or L0. L2 tasks when keywords or trigger files match.
Trigger keywords (L2 only): refactor, replace, rename, restructure, extract, consolidate, deprecate, migrate, move, reorganize.
Trigger files (L2 only): *.prisma, *.entity.ts, *.model.ts, *.schema.ts, files listed in schema-map.md.

```
Analyze consumer impact for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned changes: [FILES_TO_CHANGE]

You MUST map all consumers before changes proceed.

1. For EACH file/module being modified or replaced:
   a. Grep for ALL files that import/require from it
   b. Grep for ALL files that reference its exported names
   c. Grep for ALL config files that reference it
   d. Grep for ALL documentation (.md) that reference it
   e. Grep for ALL test files that import or mock it
   f. For schema/model files: grep for FIELD-LEVEL references — property accesses
      (obj.fieldName), destructuring ({ fieldName }), object keys (fieldName:),
      and string literals ('fieldName'). Report which specific fields are referenced
      by which consumers. This catches drift that module-level import checks miss.

2. For EACH consumer, classify impact:
   - BREAKING (import/API changes) — describe what breaks + migration path
   - NEEDS-UPDATE (behavior change) — describe expected behavioral change
   - SCHEMA-DRIFT (field removed/renamed but consumer still references old name)
   - SAFE (no change needed)

3. Check indirect consumers (up to 3 levels deep)
4. Check dynamic references (config files, CLI commands, package.json scripts, .md files)

Return:
- Consumer count
- BREAKING consumers (MUST be updated in same PR): file + what breaks + migration
- NEEDS-UPDATE consumers: file + what to review
- SAFE consumers
- Indirect consumer chains
- Risk: HIGH (10+), MEDIUM (3-9), LOW (0-2) breaking consumers
- If HIGH: recommend phased migration (create new → migrate consumers → remove old)

5. Write results to `.workflow/state/blast-radius-{taskId}.json`:
   {
     "taskId": "[TASK_ID]",
     "taskTitle": "[TASK_TITLE]",
     "timestamp": "[ISO_DATE]",
     "consumers": { "breaking": [...], "needsUpdate": [...], "safe": [...] },
     "risk": "HIGH|MEDIUM|LOW",
     "breakingCount": N,
     "totalConsumers": N
   }
```

**CRITICAL**: If 5+ BREAKING consumers found, spec MUST include migration plan. Implementation is BLOCKED without it.

**Blast-radius artifact**: Results are persisted to `.workflow/state/blast-radius-{taskId}.json` for use by downstream gates (context estimator, standards compliance, workspace dispatch).

## Launching

All agents launch in parallel as `Agent(subagent_type=Explore)` calls in a single message. When `config.hybrid.enabled`, use the `model` parameter on each Agent call to route by task type:

```
Agent(subagent_type=Explore, model="sonnet")   # Agents 1-6: Codebase analysis, research
Agent(subagent_type=Explore, model="haiku")     # Lightweight search/grep-only agents
```

The `model` parameter was restored in Claude Code 2.1.72 for per-invocation overrides. This enables true hybrid explore where routine agents run on cheaper models while complex reasoning stays on Opus.

## Graceful Fallback

- If any agent fails, log warning and proceed with remaining agents
- Agents 1, 4, 5, 6 are local-only (should rarely fail)
- Agents 2, 3 use web search (may fail on network issues)
- If Consumer Impact fails AND task is L1+: **HARD BLOCK** — require user confirmation
- If ALL agents fail: proceed with codebase analysis only (minimal mode)

## Constraints

- **READ-ONLY**: No Edit, Write, or NotebookEdit during explore phase
- **OBSERVE**: Agents use only Glob, Grep, Read, WebSearch, WebFetch
