---
description: "Analyze an existing project and set up workflow with full context"
---
Analyze an existing project and set up workflow with full context.

Usage: `/wogi-onboard`

## When to Use

- Starting to use Wogi Flow on an existing codebase
- After cloning a project you haven't worked on before
- When joining a new team/project
- Onboarding a mature/production project that needs AI assistance

## Key Difference from `/wogi-init`

`/wogi-init` creates a NEW project with optional reference.
`/wogi-onboard` analyzes an EXISTING project — the codebase IS the reference. It deeply scans itself to understand existing patterns, detects legacy vs modern code, and produces a complete WogiFlow setup.

---

## What It Does

### Phase 1: Project Analysis & Stack Detection

Display:
```
━━━ Phase 1/7: Project Analysis ━━━
```

1. **Auto-detect tech stack** using `scripts/flow-context-init.js`:
   ```javascript
   const { detectStack, initContext } = require('./scripts/flow-context-init.js');
   const detected = detectStack();
   ```
   This detects:
   - Language and version (TypeScript, Python, Go, etc.)
   - Framework (Next.js, NestJS, React, FastAPI, etc.)
   - Database and ORM (PostgreSQL + TypeORM, MongoDB + Mongoose, etc.)
   - Testing framework (Jest, Vitest, Mocha, Pytest, etc.)
   - Linting and formatting tools (ESLint, Prettier, etc.)
   - Build tools and bundlers (Webpack, Vite, esbuild, etc.)
   - Package manager (npm, yarn, pnpm)
   - WebMCP compatibility (frontend framework with interactive components)

2. **Display detected stack for confirmation:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: `I detected the following tech stack:\n\n` +
         `- Language: ${detected.language}${detected.languageVersion ? ' ' + detected.languageVersion : ''}\n` +
         `- Runtime: ${detected.runtime || 'N/A'}\n` +
         `- Framework: ${[detected.frameworks.frontend, detected.frameworks.backend, detected.frameworks.fullStack].filter(Boolean).join(', ') || 'None detected'}\n` +
         `- Database: ${detected.database || 'None detected'}${detected.orm ? ' (' + detected.orm + ')' : ''}\n` +
         `- Testing: ${detected.testing || 'None detected'}\n` +
         `- Linting: ${detected.linting || 'None'}\n` +
         `- Formatting: ${detected.formatting || 'None'}\n` +
         `- Bundler: ${detected.bundler || 'None'}\n` +
         `\nIs this correct?`,
       header: "Stack",
       options: [
         { label: "Yes, correct", description: "Use detected stack as-is" },
         { label: "Let me correct", description: "Some detections are wrong — I'll provide corrections" }
       ],
       multiSelect: false
     }]
   });
   ```
   If "Let me correct": Ask for corrections via free-text input.

3. **Scan product information:**
   ```javascript
   const { scanProject, formatSummary } = require('./scripts/flow-product-scanner.js');
   const productInfo = scanProject(projectRoot);
   ```
   This extracts:
   - Project name and description (from package.json, README)
   - Project type (frontend, backend, fullstack, CLI, library)
   - Key features detected (auth, database, testing, docker, etc.)
   - Routes and pages discovered

Display:
```
  Stack detection...     ✓ TypeScript + NestJS + PostgreSQL
  Product scanning...    ✓ Backend API, 12 features detected
```

---

### Phase 2: Deep Pattern Extraction with Temporal Analysis

Display:
```
━━━ Phase 2/7: Pattern Extraction (Deep Mode) ━━━
```

4. **Run pattern extractor in deep mode:**
   ```javascript
   const { extractPatterns, formatAsDecisions } = require('./scripts/flow-pattern-extractor.js');
   const result = await extractPatterns(projectRoot, {
     analysisMode: 'deep',
     categories: ['code', 'api', 'component', 'architecture', 'types', 'exports', 'tests', 'folders', 'comments', 'config']
   });
   ```

   Deep mode uses `git log` dates instead of filesystem mtime for reliable temporal analysis. This scans across all 10 pattern categories:
   - **code**: Naming conventions, variable declaration, error handling, async patterns
   - **api**: Response formats, pagination, error formats, status codes
   - **component**: Class vs functional, hooks, state management, styling
   - **architecture**: File structure, layering, dependency injection
   - **types**: Interface naming, type naming, enum conventions, generics
   - **exports**: Default vs named, barrel files, module system
   - **tests**: File naming, organization, assertion style, mocking
   - **folders**: Feature-first vs type-first, co-location, index files
   - **comments**: Documentation style, inline comments, TODOs
   - **config**: Environment handling, validation, defaults

   Display:
   ```
     File discovery...      ✓ Found 245 source files
     Pattern extraction...  ✓ Found 18 patterns across 10 categories
   ```

5. **Classify patterns by temporal age:**

   After extraction, classify each pattern using its `lastSeen` date:

   ```javascript
   // Configurable thresholds
   const CURRENT_MONTHS = 6;       // Default: patterns seen in last 6 months
   const TRANSITIONAL_MONTHS = 18; // Default: patterns seen 6-18 months ago
   // Anything older than TRANSITIONAL_MONTHS is "legacy"

   const now = new Date();
   const currentCutoff = new Date(now);
   currentCutoff.setMonth(currentCutoff.getMonth() - CURRENT_MONTHS);
   const legacyCutoff = new Date(now);
   legacyCutoff.setMonth(legacyCutoff.getMonth() - TRANSITIONAL_MONTHS);

   function classifyAge(pattern) {
     if (!pattern.lastSeen) return 'unknown';
     const date = new Date(pattern.lastSeen);
     if (date >= currentCutoff) return 'current';
     if (date >= legacyCutoff) return 'transitional';
     return 'legacy';
   }

   // Classify all patterns
   for (const [category, patterns] of Object.entries(result.patterns)) {
     for (const pattern of patterns) {
       pattern.temporalClass = classifyAge(pattern);
     }
   }
   ```

   Display:
   ```
     Temporal analysis...   ✓ 14 current, 2 transitional, 2 legacy patterns
   ```

   **When git history is unavailable** (shallow clone, no .git directory):
   - Fall back to file mtime with a warning
   - Display: `⚠️ No git history available — using file modification times (less reliable)`

6. **Detect and resolve conflicts with temporal awareness:**
   ```javascript
   const { resolveConflictsAuto, resolveConflictsInteractive, resolutionsToDecisions } = require('./scripts/flow-conflict-resolver.js');
   ```

   Display:
   ```
     Conflict detection...  ✓ Found 3 conflicts
   ```

   If conflicts are found, first attempt temporal auto-resolution:
   ```javascript
   // For each conflict, check if temporal analysis can resolve it
   const autoResolvable = [];
   const ambiguous = [];

   for (const conflict of result.conflicts) {
     const ageA = conflict.patternA.pattern.temporalClass;
     const ageB = conflict.patternB.pattern.temporalClass;

     // Clear case: one is current, other is legacy
     if (ageA === 'current' && ageB === 'legacy') {
       autoResolvable.push({ conflict, winner: 'A', reason: 'temporal' });
     } else if (ageB === 'current' && ageA === 'legacy') {
       autoResolvable.push({ conflict, winner: 'B', reason: 'temporal' });
     }
     // Clear case: newer pattern used in >70% of recent files
     else if (conflict.patternA.recentFileRatio > 0.7) {
       autoResolvable.push({ conflict, winner: 'A', reason: 'dominance' });
     } else if (conflict.patternB.recentFileRatio > 0.7) {
       autoResolvable.push({ conflict, winner: 'B', reason: 'dominance' });
     }
     // Ambiguous: both current, or both transitional, or close ratio
     else {
       ambiguous.push(conflict);
     }
   }
   ```

   If there are auto-resolved conflicts, display them:
   ```
     Auto-resolved: 2 conflicts (temporal analysis)
       ✓ code.variable-declaration: "const-let" beats "var" (legacy → current)
       ✓ component.style: "functional" beats "class-components" (70%+ recent files)
   ```

   If there are ambiguous conflicts, ask the developer:
   ```javascript
   // For EACH ambiguous conflict:
   AskUserQuestion({
     questions: [{
       question: `Conflicting patterns in "${conflict.description}":\n\n` +
         `Pattern A: ${conflict.patternA.pattern.name}\n` +
         `  Used in ${conflict.patternA.occurrences} files\n` +
         `  Age: ${conflict.patternA.pattern.temporalClass}\n` +
         `  Last seen: ${conflict.patternA.pattern.lastSeen?.toLocaleDateString() || 'unknown'}\n\n` +
         `Pattern B: ${conflict.patternB.pattern.name}\n` +
         `  Used in ${conflict.patternB.occurrences} files\n` +
         `  Age: ${conflict.patternB.pattern.temporalClass}\n` +
         `  Last seen: ${conflict.patternB.pattern.lastSeen?.toLocaleDateString() || 'unknown'}\n\n` +
         `Which should the AI follow for NEW code?`,
       header: "Resolve",
       options: [
         { label: `A: ${conflict.patternA.pattern.name}`, description: conflict.patternA.pattern.description },
         { label: `B: ${conflict.patternB.pattern.name}`, description: conflict.patternB.pattern.description },
         { label: "Both (migration)", description: "We're migrating from one to the other — use newer for new code, leave old code alone" },
         { label: "Skip", description: "Decide later when I encounter it" }
       ],
       multiSelect: false
     }]
   });
   ```

   **Migration-in-progress handling:**

   If the developer chooses "Both (migration)", determine which is the migration target:
   ```javascript
   // If one is clearly newer (more recent lastSeen), that's the target
   // Otherwise ask:
   AskUserQuestion({
     questions: [{
       question: `You indicated a migration is in progress. Which pattern is the TARGET (what new code should use)?`,
       header: "Target",
       options: [
         { label: conflict.patternA.pattern.name, description: `Used in ${conflict.patternA.occurrences} files` },
         { label: conflict.patternB.pattern.name, description: `Used in ${conflict.patternB.occurrences} files` }
       ],
       multiSelect: false
     }]
   });
   ```

   Record migration decisions in a special format (see Phase 4, step 8).

---

### Phase 3: Project Interview

Display:
```
━━━ Phase 3/7: Project Interview ━━━
```

7. **Ask about project context:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "What's the current state of this project?",
       header: "State",
       options: [
         { label: "Early development", description: "Just started, few features complete" },
         { label: "MVP / Beta", description: "Core features work, still iterating" },
         { label: "Production", description: "Live and serving users" },
         { label: "Maintenance", description: "Stable, mostly bug fixes and small features" }
       ],
       multiSelect: false
     }]
   });
   ```

8. **Ask about goals:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "What are your primary goals with this project?",
       header: "Goals",
       options: [
         { label: "Accelerate & improve development", description: "Use AI agents to build faster and write better code — pages in minutes, consistent patterns, fewer mistakes" },
         { label: "Fix bugs & refactor", description: "Address existing issues and improve code quality and architecture" },
         { label: "Onboard team", description: "Help new developers understand the codebase" }
       ],
       multiSelect: true
     }]
   });
   ```

9. **Offer project health scan:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "Now that I understand your project's rules and patterns, would you like me to run a comprehensive health scan?\n\n" +
         "This scans your entire codebase using the rules we just established and looks for:\n" +
         "- Redundant or duplicate components that could be merged\n" +
         "- Orphan files not imported or wired anywhere\n" +
         "- Functions or API calls that could be consolidated\n" +
         "- Broken references and dead imports\n" +
         "- Patterns that violate the conventions we just detected\n\n" +
         "Results become actionable tasks in your backlog.",
       header: "Health",
       options: [
         { label: "Run full scan (Recommended)", description: "Deep scan the entire project for improvement opportunities based on your rules" },
         { label: "Paste known issues", description: "I already know what needs fixing — let me paste a list instead" },
         { label: "Skip for now", description: "Continue to skill generation and finish setup — I can run /wogi-health later" }
       ],
       multiSelect: false
     }]
   });
   ```

   **If "Run full scan":**
   Launch a multi-agent health scan (similar to Explore Phase but project-wide):

   - **Agent A: Redundancy Scanner** — Compares all components, functions, and API endpoints from the maps generated in Phase 4. Uses AI-driven semantic matching (configurable via `config.semanticMatching.thresholds`) to flag entries that could be merged into one with variants.
   - **Agent B: Orphan Detector** — For every file in the project, checks if it's imported/referenced somewhere. Flags files that exist but are never used (dead code).
   - **Agent C: Wiring Verifier** — Checks that all components in app-map are actually rendered somewhere, all hooks are called, all utilities are imported. Flags anything created but never wired.
   - **Agent D: Convention Auditor** — Using the patterns and decisions detected in Phase 2, scans the codebase for violations. Groups findings by severity (must-fix vs nice-to-have).

   All 4 agents run in parallel. Results are consolidated and presented as a summary:
   ```
   ━━━ Project Health Scan Results ━━━

   Redundancies:  X components/functions could be consolidated
   Orphans:       Y files are not imported anywhere
   Unwired:       Z components exist but aren't rendered
   Violations:    W patterns don't match your rules

   Total improvement opportunities: N

   Would you like me to create tasks for these findings?
   ```

   If user approves, create task entries in ready.json backlog, grouped by category.

   **If "Paste known issues":**
   ```
   Paste your known issues or tech debt below.
   (One per line, or a comma-separated list)
   ```
   If issues provided, create task entries in ready.json backlog.

   **If "Skip for now":**
   Continue to Phase 4. User can run `/wogi-review` or `/wogi-health` later.

---

### Phase 4: Persistence Pipeline (CRITICAL)

Display:
```
━━━ Phase 4/7: Generating State Files ━━━
```

**All extracted data MUST persist to state files. Without this, analysis is lost.**

10. **Generate stack.md:**
    ```javascript
    const contextResult = initContext({ rescan: false });
    ```
    Writes `.workflow/context/stack.md` with detected tech stack details.
    If `initContext` was already called, skip re-generation.

    Display: `  stack.md...           ✓ Tech stack documented`

11. **Generate product.md:**
    ```javascript
    const productSummary = formatSummary(productInfo);
    ```
    Write to `.workflow/context/product.md`:
    ```markdown
    # Product Overview

    **Name**: [project name]
    **Type**: [frontend/backend/fullstack/cli/library]
    **Description**: [from package.json or README]

    ## Features Detected
    [list of features: auth, database, testing, docker, etc.]

    ## Routes / Pages
    [discovered routes with paths]
    ```

    Display: `  product.md...         ✓ Product overview generated`

12. **Persist patterns to decisions.md:**
    ```javascript
    const patternMarkdown = formatAsDecisions(result);
    const conflictMarkdown = resolutionsToDecisions(resolutions);
    ```
    Write to `.workflow/state/decisions.md`:
    ```markdown
    # Project Decisions & Patterns

    <!-- Auto-generated by /wogi-onboard -->
    <!-- Temporal analysis: patterns classified as current/transitional/legacy -->

    [patternMarkdown - extracted patterns grouped by category]

    ## Conflict Resolutions

    [conflictMarkdown - resolved conflict decisions]
    ```

    **Migration decisions** get a special format:
    ```markdown
    ### MIGRATION: [old pattern] → [new pattern]
    <!-- PIN: migration-[category] -->
    **Status**: In Progress
    **Old pattern**: [name] (used in X files)
    **New pattern**: [name] (used in Y files)
    **Rule**: Use **[new pattern]** for ALL new code. Existing [old pattern] code will be migrated separately.
    **Detected**: [date]
    ```

    Display: `  decisions.md...       ✓ 18 patterns, 3 conflicts resolved (2 auto, 1 manual)`

13. **Run function scanner:**
    ```javascript
    const { FunctionScanner } = require('./scripts/flow-function-index.js');
    const funcScanner = new FunctionScanner();
    const funcRegistry = await funcScanner.scan();
    if (funcRegistry && funcRegistry.functions.length > 0) {
      funcScanner.save();        // Writes function-index.json
      funcScanner.generateMap(); // Writes function-map.md
    }
    ```
    If no functions found, create template `function-map.md`.

    Display: `  function-map.md...    ✓ Found 32 utility functions`

14. **Run API scanner:**
    ```javascript
    const { APIScanner } = require('./scripts/flow-api-index.js');
    const apiScanner = new APIScanner();
    const apiRegistry = await apiScanner.scan();
    if (apiRegistry && (apiRegistry.endpoints.length > 0 || apiRegistry.clientFunctions.length > 0)) {
      apiScanner.save();        // Writes api-index.json
      apiScanner.generateMap(); // Writes api-map.md
    }
    ```
    If no APIs found, create template `api-map.md`.

    Display: `  api-map.md...         ✓ Found 15 API endpoints`

15. **Populate app-map.md from component data:**
    From the pattern extraction result, populate app-map.md with:
    - Detected UI components -> Components table
    - Detected pages/screens -> Screens table
    - Detected modals -> Modals table
    Include paths and patterns where detected.

    Display: `  app-map.md...         ✓ Found 24 components/modules`

16. **Extract file templates:**
    ```javascript
    const { extractTemplates, saveTemplates, formatTemplateDecisions } = require('./scripts/flow-template-extractor.js');
    const templateResult = await extractTemplates(projectRoot, {
      types: ['component', 'service', 'test', 'route', 'hook', 'config']
    });
    if (Object.keys(templateResult.templates).length > 0) {
      saveTemplates(templateResult, path.join(projectRoot, '.workflow', 'templates', 'extracted'));
      // Append template decisions to decisions.md
      const templateDecisions = formatTemplateDecisions(templateResult);
      if (templateDecisions) {
        const decisionsPath = '.workflow/state/decisions.md';
        try {
          const existing = fs.readFileSync(decisionsPath, 'utf-8');
          fs.writeFileSync(decisionsPath, existing + '\n' + templateDecisions);
        } catch (err) {
          console.warn('Could not update decisions.md:', err.message);
        }
      }
    }
    ```

    Display: `  templates...          ✓ Found 4 templates (component, service, test, hook)`

17. **Create remaining state files:**

    **ready.json** - Empty task queue:
    ```json
    {
      "lastUpdated": "[ISO timestamp]",
      "inProgress": [],
      "ready": [],
      "blocked": [],
      "recentlyCompleted": [],
      "backlog": [/* known issues from interview, if any */]
    }
    ```

    **request-log.md** - Initialized with onboarding entry:
    ```markdown
    # Request Log

    Automatic log of all requests that changed files. Searchable by tags.

    ---

    ### R-001 | [date]
    **Type**: new
    **Tags**: #onboarding #setup
    **Request**: "Initial project onboarding via /wogi-onboard"
    **Result**: Generated complete WogiFlow setup from existing project analysis.
    Detected [X] patterns, resolved [Y] conflicts, extracted [Z] templates.
    **Files**: .workflow/ (all state files generated)
    ```

    **progress.md** - Initialized with project state:
    ```markdown
    # Progress

    ## Current State
    - **Project**: [name] ([state from interview])
    - **Goals**: [from interview]
    - **Onboarded**: [date]

    ## Session Notes
    <!-- Updated by /wogi-session-end -->
    ```

    Display:
    ```
      ready.json...          ✓ Task queue initialized
      request-log.md...      ✓ Initialized with R-001
      progress.md...         ✓ Project state recorded
    ```

---

### Phase 5: Skill Generation

Display:
```
━━━ Phase 5/7: Generating Skills ━━━
```

18. **Generate skills based on detected stack:**
    ```javascript
    const { generateSkills } = require('./scripts/flow-skill-generator.js');
    ```

    For each detected framework/library:
    - Create skill directories in `.claude/skills/[technology]/`
    - Fetch Context7 documentation (one at a time to prevent context overflow)
    - Check skills.sh for curated community skills
    - Write `skill.md`, `patterns.md`, `anti-patterns.md`, `conventions.md`

    **Fetch-extract-flush loop** (prevents context overflow):
    ```
    For each technology:
      1. Fetch docs via Context7 MCP (resolve-library-id → get-library-docs)
      2. Extract patterns, conventions, anti-patterns
      3. Write to skill files
      4. Release fetched content from context
    ```

    Display:
    ```
      nestjs...              ✓ Skill generated (Context7 docs)
      typeorm...             ✓ Skill generated (Context7 docs)
      jest...                ✓ Skill generated (skills.sh)
      eslint...              ✓ Skill generated (built-in)
    ```

---

### Phase 6: Config Generation

Display:
```
━━━ Phase 6/7: Generating Config ━━━
```

19. **Generate `.workflow/config.json`:**

    Build config based on detected tooling:

    ```javascript
    const config = {
      version: "1.0",
      project: {
        name: productInfo.name,
        type: productInfo.type,
        onboardedAt: new Date().toISOString()
      },
      qualityGates: {
        feature: { require: [] },
        bugfix: { require: [] },
        refactor: { require: [] }
      },
      commits: {
        requireApproval: { feature: true, bugfix: false, refactor: true, docs: false },
        autoCommitSmallFixes: true,
        smallFixThreshold: 3
      },
      onboard: {
        temporal: {
          currentMonths: 6,
          transitionalMonths: 18,
          autoResolveThreshold: 0.7
        }
      }
    };

    // Configure quality gates based on detected tooling
    if (detected.linting) {
      config.qualityGates.feature.require.push('lint');
      config.qualityGates.bugfix.require.push('lint');
    }
    if (detected.typeChecking || detected.language === 'TypeScript') {
      config.qualityGates.feature.require.push('typecheck');
      config.qualityGates.bugfix.require.push('typecheck');
    }
    if (detected.testing) {
      config.qualityGates.feature.require.push('tests');
    }

    // WebMCP detection: If project has a frontend framework with UI components
    const hasWebMCPFramework = detected.frameworks.frontend &&
      ['react', 'next.js', 'vue', 'svelte', 'sveltekit', 'nuxt'].some(f =>
        (detected.frameworks.frontend || '').toLowerCase().includes(f));
    if (hasWebMCPFramework) {
      config.webmcp = {
        enabled: true,
        toolsPath: ".workflow/webmcp/tools.json",
        fallbackEnabled: true,
        maxToolCalls: 20
      };
      // Auto-generate initial WebMCP tool definitions
      // Run: flow webmcp-generate scan
    }

    // Always require these
    for (const type of ['feature', 'bugfix', 'refactor']) {
      config.qualityGates[type].require.push('requestLogEntry');
    }
    config.qualityGates.feature.require.push('appMapUpdate');

    // Detect commit style from git log
    // Check for conventional commits, ticket prefixes, etc.
    ```

    **Model Routing Configuration:**

    Present the user with a model routing choice using `AskUserQuestion`:

    ```
    How should WogiFlow route sub-tasks to AI models?

    1. "Full Opus (Recommended)" — Maximum quality. All sub-agents use Opus.
       Best for complex projects where quality matters most.

    2. "Smart Routing" — Opus orchestrates, Sonnet handles implementation/review,
       Haiku handles searches/lookups. Best quality-to-cost balance.
       Preserves context window by offloading sub-tasks to lighter models.

    3. "Custom" — Configure your own routing rules per task type.
    ```

    Based on choice:
    - Option 1: Set `config.hybrid.enabled = false` (all tasks stay with current model)
    - Option 2: Set `config.hybrid.enabled = true` with default routing table (already configured)
    - Option 3: Set `config.hybrid.enabled = true` and guide user through per-task-type routing overrides

    Display: `  Model routing...      ✓ [Smart Routing | Full Opus | Custom]`

    **Community Knowledge Sync:**

    Present opt-in question using `AskUserQuestion`:

    ```
    Would you like to share anonymized model performance data with the WogiFlow community?

    What's shared: model ID, task type, iteration count, token usage, wall clock time
    What's NOT shared: file paths, code, project names, task descriptions

    You'll receive back: community-optimized model routing rules and capability scores.

    1. "Enable (Recommended)" — Help improve WogiFlow for everyone
    2. "Disable" — Keep all data local only
    ```

    Based on choice:
    - Option 1: Set `config.communitySync.enabled = true`
    - Option 2: Set `config.communitySync.enabled = false` (default)

    Display: `  Community sync...     ✓ [Enabled | Disabled]`

    **Commit style detection:**
    ```bash
    git log --oneline -20 --format="%s"
    ```
    Analyze recent commit messages:
    - If most use `feat:`, `fix:`, `chore:` → conventional commits
    - If most use `[TICKET-123]` → ticket-prefix style
    - If no pattern → default to conventional commits

    **CI/CD detection:**
    - Check for `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`, `.circleci/`
    - If found, configure hooks accordingly

    Display: `  config.json...        ✓ Quality gates: lint + typecheck + tests`

20. **Generate WebMCP tool definitions** (if config.webmcp.enabled):

    Now that config.json exists with `webmcp.enabled: true`, generate initial tool definitions:

    ```bash
    node scripts/flow-webmcp-generator.js scan
    ```

    This scans `app-map.md` for interactive components and generates tool definitions
    to `.workflow/webmcp/tools.json`. Display:

    ```
      WebMCP tools...        ✓ N tool definitions generated
    ```

    If no interactive components found (e.g., fresh project):
    ```
      WebMCP tools...        ○ No components yet (will generate after first UI task)
    ```

    If `config.webmcp` is not set (no frontend framework), skip silently.

---

### Phase 6.5: Generate CLAUDE.md (CRITICAL)

**Now that config.json exists, generate the full CLAUDE.md from templates.**

This replaces the bootstrap CLAUDE.md (created by postinstall) with the complete version rendered from Handlebars templates using the project's actual config values.

```bash
npx flow bridge sync
```

This runs the bridge which:
1. Reads `.workflow/config.json` (just created in Phase 6)
2. Renders `.workflow/templates/claude-md.hbs` with config values
3. Writes the full `CLAUDE.md` with all enforcement rules, file locations, and commands

Display:
```
  CLAUDE.md...           ✓ Generated from templates (full version)
```

**If bridge sync fails:**
- Log warning: `⚠️ CLAUDE.md generation failed: [error]. Bootstrap version remains.`
- The bootstrap CLAUDE.md from postinstall still provides basic task gating
- User can manually run `npx flow bridge sync` later

**Why this step matters:**
Without it, the user completes onboarding but CLAUDE.md is either missing or still the bootstrap version. The full CLAUDE.md contains file locations, quality gate configs, commit behavior rules, and natural language command detection — all essential for the full WogiFlow experience.

---

### Phase 7: Summary

Display:
```
━━━ Phase 7/7: Complete ━━━
```

Display the completion summary:

```
🔍 Wogi Flow - Project Onboarding

━━━ Analysis Complete ━━━

  Language:  TypeScript
  Framework: NestJS
  Database:  PostgreSQL (TypeORM)

Scanning for components... ✓ Found 24 components/modules
Scanning for API routes... ✓ Found 15 API routes/controllers
Scanning for utilities... ✓ Found 32 utility functions
Pattern extraction...    ✓ Found 18 patterns, 3 conflicts resolved
  Temporal analysis:     14 current, 2 transitional, 2 legacy
  Migrations in progress: 1 (class-components → hooks)
Template extraction...   ✓ Found 4 templates (component, service, test, hook)

━━━ Generated Files ━━━

CLAUDE.md                    # Full project instructions (from templates)

.workflow/
  config.json              # Project configuration
  context/
    stack.md               # Detected tech stack
    product.md             # Product description
  state/
    ready.json             # Task queue
    request-log.md         # Change history (R-001 init)
    progress.md            # Project state
    app-map.md             # Component registry (24 entries)
    decisions.md           # Coding patterns (18 patterns, 3 resolutions)
    function-map.md        # Utility functions (32 entries)
    api-map.md             # API endpoints (15 entries)
    function-index.json    # Machine-readable function index
    api-index.json         # Machine-readable API index
  templates/
    extracted/
      component.template   # Component file skeleton
      service.template     # Service/utility skeleton
      test.template        # Test file skeleton
      route.template       # API route skeleton

.claude/
  skills/
    [framework]/           # Framework patterns
    [library]/             # Library patterns

╔═══════════════════════════════════════════════════════════════╗
║           Project Onboarding Complete!                        ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## After Onboarding

The AI now has full context about your project:
- Tech stack and architecture
- Existing components and their locations
- Utility functions available for reuse
- API endpoints and patterns
- Coding patterns to follow (with temporal awareness)
- Migration-in-progress rules
- File templates for consistent new file creation
- Known issues to fix
- Project goals

You can:
- Ask it to analyze specific code
- Ask for improvement suggestions
- Create new features that fit the architecture
- Fix bugs with proper context

---

## Files Created

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Full project instructions for Claude Code (generated from templates) |
| `.workflow/config.json` | Project configuration (quality gates, temporal thresholds) |
| `.workflow/context/stack.md` | Detected tech stack |
| `.workflow/context/product.md` | Product description and features |
| `.workflow/state/ready.json` | Task queue |
| `.workflow/state/request-log.md` | Change history |
| `.workflow/state/progress.md` | Project state and session notes |
| `.workflow/state/app-map.md` | Component registry (auto-populated) |
| `.workflow/state/decisions.md` | Coding patterns, conflict resolutions, migration rules |
| `.workflow/state/function-map.md` | Utility function registry (auto-scanned) |
| `.workflow/state/api-map.md` | API endpoint registry (auto-scanned) |
| `.workflow/state/function-index.json` | Machine-readable function index |
| `.workflow/state/api-index.json` | Machine-readable API index |
| `.workflow/templates/extracted/*.template` | File skeletons for consistent new file creation |
| `.workflow/changes/onboarding/tasks.json` | Initial tasks from known issues |

---

## Configuration

Temporal analysis thresholds in `config.json`:

```json
{
  "onboard": {
    "temporal": {
      "currentMonths": 6,
      "transitionalMonths": 18,
      "autoResolveThreshold": 0.7
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `currentMonths` | 6 | Patterns seen within this many months are "current" |
| `transitionalMonths` | 18 | Patterns older than `currentMonths` but newer than this are "transitional" |
| `autoResolveThreshold` | 0.7 | Auto-resolve when one pattern has >70% of recent files |

---

## CLI Equivalent

```bash
./scripts/flow onboard
```

---

## Error Handling

### If pattern extraction fails
- Log error but continue
- Create empty decisions.md template
- Display: `⚠️ Pattern extraction failed: [error]. Created empty decisions.md.`
- Inform user they can re-run: `flow pattern-extract --deep`

### If temporal analysis fails (no git history)
- Fall back to file mtime with warning
- Display: `⚠️ No git history — using file modification times (less reliable after git clone)`
- Temporal classification will be less accurate but still functional

### If scanner fails (function or API)
- Log error but continue
- Create template function-map.md / api-map.md
- Display: `⚠️ [Scanner] failed: [error]. Created template file.`
- Inform user they can run `flow function-index scan` or `flow api-index scan` later

### If template extraction fails
- Log error but continue
- Skip template section in decisions.md
- Display: `⚠️ Template extraction failed: [error]. Skipping templates.`

### If Context7 fetch fails (skill generation)
- Log error but continue
- Create skills with placeholder content
- Display: `⚠️ Context7 unavailable for [technology]. Created placeholder skill.`
- Inform user they can run `/wogi-skills refresh` later

### If product scanner fails
- Log error but continue
- Create minimal product.md from package.json name/description only
- Display: `⚠️ Product scanner failed: [error]. Created minimal product.md.`

---

## Edge Cases

### Monorepo detection
If multiple `package.json` files are found at different levels:
- Ask the developer which packages to analyze
- Run analysis per-package or on the root, based on their choice

### No source files found
If no recognizable source files exist:
- Display error: `No source files found. Is this the correct project root?`
- Suggest checking the directory path

### Very large codebase (>10,000 files)
- Display warning: `Large codebase detected (X files). Analysis may take longer.`
- Consider using `--max-files N` option to limit scan scope
- Pattern extraction will automatically sample rather than scan every file

### Project already onboarded
If `.workflow/config.json` already exists:
```javascript
AskUserQuestion({
  questions: [{
    question: "This project already has a WogiFlow setup. What would you like to do?",
    header: "Existing",
    options: [
      { label: "Re-analyze", description: "Overwrite existing setup with fresh analysis" },
      { label: "Rescan", description: "Smart diff — keep existing decisions, auto-add new items, resolve conflicts one by one (runs /wogi-rescan)" },
      { label: "Cancel", description: "Keep current setup unchanged" }
    ],
    multiSelect: false
  }]
});
```
