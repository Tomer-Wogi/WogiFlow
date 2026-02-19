Analyze an existing project and set up workflow with full context.

Usage: `/wogi-onboard`

## When to Use

- Starting to use Wogi Flow on an existing codebase
- After cloning a project you haven't worked on before
- When joining a new team/project
- Onboarding a mature/production project that needs AI assistance

## What It Does

### Phase 1: Project Analysis

1. **Auto-detect tech stack** using `scripts/flow-context-init.js`:
   - Detects language (TypeScript, Python, Go, etc.)
   - Detects framework (Next.js, NestJS, React, FastAPI, etc.)
   - Detects database (PostgreSQL, MongoDB, etc.)
   - Reads package.json, tsconfig.json, .eslintrc, .prettierrc
   - Scans directory structure for patterns

2. **Display detected stack for confirmation:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: `I detected the following tech stack:\n\n- Language: ${detected.language}\n- Framework: ${detected.framework}\n- Database: ${detected.database}\n- Testing: ${detected.testing}\n\nIs this correct?`,
       header: "Stack",
       options: [
         { label: "Yes, that's correct", description: "Use detected stack" },
         { label: "Let me correct", description: "Some detections are wrong" }
       ],
       multiSelect: false
     }]
   });
   ```

### Phase 2: Deep Pattern Extraction

3. **Run pattern extractor on the project:**
   ```javascript
   const { extractPatterns, formatAsDecisions } = require('./scripts/flow-pattern-extractor.js');
   const result = await extractPatterns(projectRoot, { analysisMode: 'deep' });
   ```
   This scans source files for:
   - File and function naming conventions
   - Import styles and module patterns
   - Component structure patterns (class vs functional, hooks, etc.)
   - API route patterns and response formats
   - Architecture patterns (layers, modules)

4. **Detect and resolve conflicts:**
   ```javascript
   const { resolveConflictsAuto, resolveConflictsInteractive, resolutionsToDecisions } = require('./scripts/flow-conflict-resolver.js');
   ```

   If conflicts are found (competing patterns in the codebase):
   ```javascript
   AskUserQuestion({
     questions: [{
       question: `I found ${result.conflicts.length} conflicting patterns in your codebase. How should I handle them?`,
       header: "Conflicts",
       options: [
         { label: "Auto-resolve (Recommended)", description: "Accept the most common/recent pattern for each conflict" },
         { label: "Review each conflict", description: "I'll show each conflict and you choose the pattern to follow" },
         { label: "Skip conflicts", description: "Don't resolve now - I'll ask when I encounter them" }
       ],
       multiSelect: false
     }]
   });
   ```

   **If "Auto-resolve":** `const resolutions = resolveConflictsAuto(result.conflicts);`
   **If "Review each":** Present each conflict via AskUserQuestion:
   ```javascript
   // For each conflict:
   AskUserQuestion({
     questions: [{
       question: `Conflict in ${conflict.description}:\n\nPattern A: ${conflict.patternA.pattern.name} (${conflict.patternA.occurrences} files)\nPattern B: ${conflict.patternB.pattern.name} (${conflict.patternB.occurrences} files)`,
       header: "Resolve",
       options: [
         { label: `A: ${conflict.patternA.pattern.name}`, description: conflict.patternA.pattern.description },
         { label: `B: ${conflict.patternB.pattern.name}`, description: conflict.patternB.pattern.description },
         { label: "Skip", description: "Decide later" }
       ],
       multiSelect: false
     }]
   });
   ```

### Phase 3: Project Interview

5. **Ask about project context:**
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

6. **Ask about goals:**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "What are your primary goals with this project?",
       header: "Goals",
       options: [
         { label: "Add features", description: "Build new functionality" },
         { label: "Fix bugs", description: "Address existing issues" },
         { label: "Refactor", description: "Improve code quality and architecture" },
         { label: "Onboard team", description: "Help new developers understand the codebase" }
       ],
       multiSelect: true
     }]
   });
   ```

7. **Ask about known issues** (optional):
   ```
   Do you have any known issues or tech debt you'd like to track?
   (Paste a list or say "skip")
   ```

### Phase 4: Persistence Pipeline (CRITICAL)

**All extracted data MUST persist to state files. Without this, analysis is lost.**

8. **Persist patterns to decisions.md:**
   ```javascript
   const patternMarkdown = formatAsDecisions(result);
   const conflictMarkdown = resolutionsToDecisions(resolutions);
   ```
   Write to `.workflow/state/decisions.md`:
   ```markdown
   # Project Decisions & Patterns

   [patternMarkdown - extracted patterns grouped by category]

   [conflictMarkdown - resolved conflict decisions]
   ```

9. **Run function scanner:**
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

10. **Run API scanner:**
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

11. **Populate app-map.md from component data:**
    From the pattern extraction result, populate app-map.md with:
    - Detected UI components -> Components table
    - Detected pages/screens -> Screens table
    - Detected modals -> Modals table
    Include paths and patterns where detected.

12. **Create remaining state files:**
    - `ready.json` - Empty task queue (with blocked/backlog arrays)
    - `request-log.md` - Initialized with R-001 onboarding entry
    - `progress.md` - Initialized with project state

### Phase 5: Skill Generation

13. **Generate skills based on detected stack:**
    - Create skill directories for each detected framework/library
    - Fetch Context7 documentation (one at a time to prevent context overflow)
    - Check skills.sh for curated community skills

### Phase 6: Config Generation

14. **Generate `.workflow/config.json`:**
    - Quality gates configured based on detected tooling (eslint, prettier, jest, etc.)
    - Commit rules matching project's existing commit style
    - Hooks configured for detected CI/CD pipeline

### Phase 7: Summary

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
Pattern extraction...    ✓ Found 12 patterns, 2 conflicts resolved

━━━ Generated Files ━━━

.workflow/
  config.json              # Project configuration
  specs/
    stack.md               # Detected tech stack
    product.md             # Product description
  state/
    ready.json             # Task queue
    request-log.md         # Change history (R-001 init)
    app-map.md             # Component registry (24 entries)
    decisions.md           # Coding patterns (12 patterns)
    function-map.md        # Utility functions (32 entries)
    api-map.md             # API endpoints (15 entries)
    function-index.json    # Machine-readable function index
    api-index.json         # Machine-readable API index

.claude/
  skills/
    [framework]/           # Framework patterns
    [library]/             # Library patterns

╔═══════════════════════════════════════════════════════════════╗
║           ✅ Project Onboarding Complete!                     ║
╚═══════════════════════════════════════════════════════════════╝
```

## After Onboarding

The AI now has full context about your project:
- Tech stack and architecture
- Existing components and their locations
- Utility functions available for reuse
- API endpoints and patterns
- Coding patterns to follow
- Known issues to fix
- Project goals

You can:
- Ask it to analyze specific code
- Ask for improvement suggestions
- Create new features that fit the architecture
- Fix bugs with proper context

## Files Created

| File | Purpose |
|------|---------|
| `.workflow/config.json` | Project configuration |
| `.workflow/specs/stack.md` | Detected tech stack |
| `.workflow/specs/product.md` | Product description |
| `.workflow/state/ready.json` | Task queue |
| `.workflow/state/request-log.md` | Change history |
| `.workflow/state/app-map.md` | Component registry (auto-populated) |
| `.workflow/state/decisions.md` | Coding patterns (from extraction) |
| `.workflow/state/function-map.md` | Utility function registry (auto-scanned) |
| `.workflow/state/api-map.md` | API endpoint registry (auto-scanned) |
| `.workflow/state/function-index.json` | Machine-readable function index |
| `.workflow/state/api-index.json` | Machine-readable API index |
| `.workflow/changes/onboarding/tasks.json` | Initial tasks from known issues |

## CLI Equivalent

```bash
./scripts/flow onboard
```

## Error Handling

### If pattern extraction fails
- Log error but continue
- Create empty decisions.md template
- Inform user they can re-run extraction later

### If scanner fails
- Log error but continue
- Create template function-map.md / api-map.md
- Inform user they can run `flow function-index scan` or `flow api-index scan` later

### If Context7 fetch fails
- Log error but continue
- Create skills with placeholder content
- Inform user they can run `/wogi-skills refresh` later
