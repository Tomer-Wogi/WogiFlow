# /wogi-init - AI-Driven Project Setup

Initialize WogiFlow for a new project through conversational setup.

## When This Runs

This command activates when:
1. User runs `/wogi-init` explicitly
2. User says "setup wogiflow" or similar
3. AI detects `.workflow/state/pending-setup.json` exists (fresh install)
4. AI detects `.workflow/config.json` is missing

## Pre-Flight Check

Before starting, verify setup is needed:

```javascript
// Check if already configured
const configPath = '.workflow/config.json';
const pendingPath = '.workflow/state/pending-setup.json';

if (fs.existsSync(configPath)) {
  // Already configured - offer to reconfigure
  return "WogiFlow is already configured. Would you like to reconfigure? (This will overwrite existing settings)";
}
```

---

## Setup Flow

### Step 1: Project Name Confirmation

1. Read `package.json` to detect project name
2. Ask for confirmation using AskUserQuestion:

```javascript
AskUserQuestion({
  questions: [{
    question: `I detected your project name as "${detectedName}". Is this correct?`,
    header: "Project",
    options: [
      { label: "Yes, that's correct", description: `Use "${detectedName}" as the project name` },
      { label: "No, let me specify", description: "Enter a different project name" }
    ],
    multiSelect: false
  }]
});
```

If user selects "No", ask them to provide the name in their next message.

### Step 2: Import Sources

Ask about existing resources that can help configure the project:

```javascript
AskUserQuestion({
  questions: [{
    question: "Do you have any of these to help me understand your project?",
    header: "Import",
    options: [
      { label: "Other project folder", description: "A folder with patterns to learn from (I'll scan package.json, configs, and code)" },
      { label: "Exported WogiFlow profile", description: "A .zip file exported from another WogiFlow project" },
      { label: "PRD or project description", description: "Paste text or provide a file path to a project description" },
      { label: "None - start fresh", description: "Set up from scratch with tech stack selection" }
    ],
    multiSelect: true
  }]
});
```

#### If "Other project folder" selected:

This is the **Reference Project Import Pipeline** — it deeply analyzes a reference project so that AI-generated code in the NEW project is indistinguishable from code written by the reference project's developers.

**Ask user to provide the folder path:**
```javascript
// User provides the reference project path in their next message
const referenceProjectPath = path.resolve(userInput); // e.g., "/Users/dev/my-production-app"

// Validate path is absolute and doesn't escape filesystem boundaries
if (!path.isAbsolute(referenceProjectPath) || referenceProjectPath.includes('..')) {
  return "Invalid path. Please provide a clean absolute path without '..' segments.";
}

// Validate the path exists and has source files
if (!fs.existsSync(referenceProjectPath)) {
  return "Path not found. Please provide a valid folder path.";
}
if (!fs.existsSync(path.join(referenceProjectPath, 'package.json')) &&
    !fs.existsSync(path.join(referenceProjectPath, 'requirements.txt')) &&
    !fs.existsSync(path.join(referenceProjectPath, 'go.mod'))) {
  return "No project manifest found. Is this the correct project root?";
}
```

##### Phase 1/6: Detect Reference Stack

```
━━━ Reference Import: Phase 1/6 — Detecting Stack ━━━
```

```javascript
const { detectStack } = require('./scripts/flow-context-init.js');
// Temporarily set CWD context for the reference project
const refStack = detectStack(referenceProjectPath);
```

Display detected stack:
```
  Reference project: [name from package.json]
  Language:  ${refStack.language} ${refStack.languageVersion || ''}
  Framework: ${[refStack.frameworks.frontend, refStack.frameworks.backend, refStack.frameworks.fullStack].filter(Boolean).join(', ') || 'None'}
  Database:  ${refStack.database || 'None'} ${refStack.orm ? '(' + refStack.orm + ')' : ''}
  Testing:   ${refStack.testing || 'None'}
  Linting:   ${refStack.linting || 'None'}
```

Confirm with user:
```javascript
AskUserQuestion({
  questions: [{
    question: `I detected this stack in the reference project. Should the NEW project match it?`,
    header: "Stack",
    options: [
      { label: "Yes, match it", description: "New project uses the same stack" },
      { label: "Partially", description: "I'll keep some but change others in the wizard" },
      { label: "Just patterns", description: "Import coding patterns only, I'll choose my own stack" }
    ],
    multiSelect: false
  }]
});
```

If "Yes" or "Partially": Pre-populate the tech stack wizard (Step 3) with the detected stack.

##### Phase 2/6: Extract Patterns (Deep Mode)

```
━━━ Reference Import: Phase 2/6 — Extracting Patterns ━━━
```

```javascript
const { extractPatterns, formatAsDecisions } = require('./scripts/flow-pattern-extractor.js');
const result = await extractPatterns(referenceProjectPath, {
  analysisMode: 'deep',
  categories: ['code', 'api', 'component', 'architecture', 'types', 'exports', 'tests', 'folders', 'comments', 'config']
});
```

Display findings:
```
  Files scanned:     245
  Patterns found:    18 across 10 categories
  Conflicts found:   2

  Top patterns:
    code.naming: camelCase functions, PascalCase components
    code.async: async/await (no callbacks)
    api.response: { data, meta } envelope
    component.style: functional with hooks
    tests.naming: *.test.ts in __tests__/
```

##### Phase 3/6: Resolve Conflicts

```
━━━ Reference Import: Phase 3/6 — Resolving Conflicts ━━━
```

If conflicts detected:
```javascript
AskUserQuestion({
  questions: [{
    question: `I found ${result.conflicts.length} conflicting patterns in the reference project. How should I handle them?`,
    header: "Conflicts",
    options: [
      { label: "Accept recommended (Recommended)", description: "Use the most common/recent pattern for each conflict" },
      { label: "Review each conflict", description: "I'll show each conflict and you choose" },
      { label: "Skip conflicts", description: "Don't resolve — ask when encountered" }
    ],
    multiSelect: false
  }]
});
```

**If "Accept recommended":**
```javascript
const { resolveConflictsAuto, resolutionsToDecisions } = require('./scripts/flow-conflict-resolver.js');
const resolutions = resolveConflictsAuto(result.conflicts);
const conflictDecisionsMarkdown = resolutionsToDecisions(resolutions);
```

**If "Review each conflict":**
For each conflict, present via AskUserQuestion:
```javascript
AskUserQuestion({
  questions: [{
    question: `Conflict: ${conflict.description}\n\nPattern A: ${conflict.patternA.pattern.name} (${conflict.patternA.occurrences} files)\nPattern B: ${conflict.patternB.pattern.name} (${conflict.patternB.occurrences} files)`,
    header: "Resolve",
    options: [
      { label: `A: ${conflict.patternA.pattern.name}`, description: conflict.patternA.pattern.description },
      { label: `B: ${conflict.patternB.pattern.name}`, description: conflict.patternB.pattern.description },
      { label: "Skip (decide later)", description: "Don't set a rule yet" }
    ],
    multiSelect: false
  }]
});
```
Collect all resolutions:
```javascript
const { resolutionsToDecisions } = require('./scripts/flow-conflict-resolver.js');
const conflictDecisionsMarkdown = resolutionsToDecisions(resolutions);
```

Display: `  Conflicts resolved:  ${resolutions.length} resolved, ${skipped} skipped`

##### Phase 4/6: Extract Templates & Scan Registries

```
━━━ Reference Import: Phase 4/6 — Extracting Templates & Registries ━━━
```

**a) Extract file templates:**
```javascript
const { extractTemplates, saveTemplates, formatTemplateDecisions } = require('./scripts/flow-template-extractor.js');
const templateResult = await extractTemplates(referenceProjectPath, {
  types: ['component', 'service', 'test', 'route', 'hook', 'config'],
  outputDir: path.join(projectRoot, '.workflow', 'templates', 'extracted')
});
const saved = saveTemplates(templateResult, path.join(projectRoot, '.workflow', 'templates', 'extracted'));
```

Display:
```
  Templates extracted:  ${Object.keys(templateResult.templates).length} types
    - Component: ${templateResult.templates.component?.sourcePath || 'none'}
    - Service: ${templateResult.templates.service?.sourcePath || 'none'}
    - Test: ${templateResult.templates.test?.sourcePath || 'none'}
```

**b) Scan function registry:**
```javascript
const { FunctionScanner } = require('./scripts/flow-function-index.js');
const funcScanner = new FunctionScanner({ projectRoot: referenceProjectPath });
const funcRegistry = await funcScanner.scan();
```

Display: `  Functions found:     ${funcRegistry?.functions?.length || 0} utility functions`

**c) Scan API registry:**
```javascript
const { APIScanner } = require('./scripts/flow-api-index.js');
const apiScanner = new APIScanner({ projectRoot: referenceProjectPath });
const apiRegistry = await apiScanner.scan();
```

Display: `  API endpoints found: ${apiRegistry?.endpoints?.length || 0} endpoints`

**d) Scan product info:**
```javascript
const { scanProject, formatSummary } = require('./scripts/flow-product-scanner.js');
const refProductInfo = scanProject(referenceProjectPath);
```

##### Phase 5/6: Generate Skills from Reference Stack

```
━━━ Reference Import: Phase 5/6 — Generating Skills ━━━
```

Generate skills for the reference project's detected technologies:
```javascript
const { generateSkills, enhanceSkillWithDocs } = require('./scripts/flow-skill-generator.js');
```

For each detected framework/library in `refStack`:
- Create skill directories in `.claude/skills/[technology]/`
- Fetch Context7 documentation (one at a time, fetch-extract-flush loop)
- Check skills.sh for curated community skills
- Write `skill.md`, `patterns.md`, `anti-patterns.md`, `conventions.md`

```
FOR EACH technology (sequentially):
  1. FETCH: resolve-library-id → get-library-docs (tokens: 5000)
  2. EXTRACT: enhanceSkillWithDocs(skillId, fetchedDocs)
  3. FLUSH: Content written to disk, released from context
```

Display:
```
  nestjs...            ✓ Skill generated (Context7)
  typeorm...           ✓ Skill generated (Context7)
  jest...              ✓ Skill generated (skills.sh)
```

If Context7 is unavailable, create placeholder skills:
```
  ⚠️ Context7 unavailable. Skills created with placeholder content.
  Run /wogi-skills refresh later to populate.
```

##### Phase 6/6: Persist to New Project State Files

```
━━━ Reference Import: Phase 6/6 — Creating State Files ━━━
```

**CRITICAL**: All paths from the reference project MUST be sanitized before writing to the new project's state files. No absolute paths from the reference project should appear in the new project.

```javascript
// Path sanitization helper
function sanitizeRefPath(absPath, refRoot) {
  // Convert absolute reference paths to relative "ref:" prefixed paths
  if (absPath.startsWith(refRoot)) {
    return 'ref:' + absPath.slice(refRoot.length).replace(/^\//, '');
  }
  return absPath;
}

// Apply to all registry entries
function sanitizeRegistry(registry, refRoot) {
  if (!registry) return registry;
  const { safeJsonParse } = require('./scripts/flow-utils.js');
  const sanitized = safeJsonParse(JSON.stringify(registry), registry);
  for (const item of (sanitized.functions || sanitized.endpoints || [])) {
    if (item.file) item.file = sanitizeRefPath(item.file, refRoot);
    if (item.path) item.path = sanitizeRefPath(item.path, refRoot);
  }
  return sanitized;
}
```

**a) Write decisions.md with extracted patterns:**
```javascript
const patternDecisionsMarkdown = formatAsDecisions(result);
```
Write to `.workflow/state/decisions.md`:
```markdown
# Project Decisions & Patterns

<!-- Imported from reference project: [reference project name] -->
<!-- Date: [import date] -->

[patternDecisionsMarkdown]

## Conflict Resolutions

[conflictDecisionsMarkdown]
```

If templates were extracted, append template decisions:
```javascript
const templateDecisions = formatTemplateDecisions(templateResult);
if (templateDecisions) {
  const decisionsPath = path.join(projectRoot, '.workflow', 'state', 'decisions.md');
  const existing = fs.readFileSync(decisionsPath, 'utf-8');
  fs.writeFileSync(decisionsPath, existing + '\n' + templateDecisions);
}
```

**b) Write function-map.md (reference patterns):**

Write function entries with `[ref]` prefix to indicate they're from the reference:
```markdown
# Function Map

Utility functions from reference project. **Follow these patterns when creating similar functions.**

## Reference Patterns (from [reference project name])

| Function | Purpose | Ref Path | Parameters |
|----------|---------|----------|------------|
| formatDate | Date formatting | ref:src/utils/date.ts | (date: Date, format: string) |
| validateEmail | Email validation | ref:src/utils/validate.ts | (email: string) |
```

If `funcRegistry` has entries, write them. Otherwise create empty template.

**c) Write api-map.md (reference patterns):**

```markdown
# API Map

API patterns from reference project. **Follow these patterns for new endpoints.**

## Reference Patterns (from [reference project name])

| Method | Endpoint | Purpose | Ref Path |
|--------|----------|---------|----------|
| GET | /api/users | List users | ref:src/routes/users.ts |
| POST | /api/auth/login | User login | ref:src/routes/auth.ts |
```

**d) Write app-map.md (reference patterns):**

Populate from component extraction. Each entry marked as reference:
```markdown
## Components

| Component | Variants | Ref Path | Pattern |
|-----------|----------|----------|---------|
| Button | primary, secondary, danger | ref:src/components/Button.tsx | [ref] Functional + hooks |
| Modal | confirm, alert | ref:src/components/Modal.tsx | [ref] Portal-based |
```

**e) Write remaining state files:**
- `ready.json` — Empty task queue
- `request-log.md` — R-001 init entry noting reference import
- `progress.md` — Initialized

Display:
```
  decisions.md...       ✓ 18 patterns, 2 conflict resolutions
  function-map.md...    ✓ 32 reference function patterns
  api-map.md...         ✓ 15 reference API patterns
  app-map.md...         ✓ 24 reference component patterns
  templates/...         ✓ 4 file templates saved
  ready.json...         ✓ Task queue initialized
  request-log.md...     ✓ Initialized (R-001: reference import)
  progress.md...        ✓ Project state recorded
```

##### Reference Import Summary

After all phases complete, display:
```
━━━ Reference Import Complete ━━━

  Reference: [reference project name] ([reference path])
  Imported:
    18 coding patterns (10 categories)
    2 conflicts resolved
    32 function signatures (as reference patterns)
    15 API endpoint patterns
    24 component patterns
    4 file templates

  The AI will now write code that matches your reference project's style.
  All patterns are labeled [ref] — they'll be replaced with actual paths
  as you build your new project.
```

##### Error Handling (Reference Import)

**If reference path is invalid:**
- Display: `Path not found or not a project root. Please try again.`
- Re-ask for the path

**If pattern extraction fails on reference:**
- Log error, continue with other phases
- Display: `⚠️ Pattern extraction failed on reference. Other imports will continue.`

**If scanner fails:**
- Log error, continue
- Create template function-map.md / api-map.md
- Display: `⚠️ [Scanner] failed on reference. Created template.`

**If reference has no source files:**
- Display: `No source files found in reference project. Only package.json patterns imported.`

#### If "Exported WogiFlow profile" selected:

**Delegate to `flow-import-profile`** — the hardened import script with full merge semantics, security checks, and cleanup.

1. Ask for the .zip file path:
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "What is the path to the exported WogiFlow profile (.zip)?",
       header: "Zip path",
       options: [
         { label: "Browse", description: "Enter the full path to the .zip file" }
       ],
       multiSelect: false
     }]
   });
   ```

2. Validate the zip path exists:
   ```bash
   if [ ! -f "<zip-path>" ]; then
     echo "File not found: <zip-path>"
     # Offer retry or skip
   fi
   ```

3. Invoke the import script with init-appropriate flags:
   ```bash
   ./scripts/flow-import-profile "<zip-path>" --force
   ```
   - `--force`: Skip confirmation prompts (init is setting up fresh, no conflicts possible)
   - No `--skip-*` flags: Import everything during init (rules, learnings, skills, templates)
   - The script handles: smart config merge (jq), append-with-separator for decisions.md,
     skip-if-exists for templates, path traversal protection, prototype-pollution checks,
     zip-slip prevention, and trap-based temp directory cleanup

4. Capture and display the import summary:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Profile Import Complete
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Source: <zip-path>
   Imported: CLAUDE.md, agents/, config.json, rules, skills, templates
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

5. If the import script exits non-zero (e.g., security check failed, invalid zip):
   - Display the error message from the script
   - Offer options:
     ```
     Import failed. Options:
     [1] Try a different zip file
     [2] Skip profile import and continue setup
     ```

**Why delegate?** The import script was hardened with 19 security and correctness fixes
(path traversal containment, prototype-pollution regex, zip-slip prevention, trap cleanup,
jq merge validation, etc.). Reimplementing this logic inline would miss these protections.

**Combined with other sources**: If the user also selected "Other project folder", run the
zip import FIRST (establishes baseline rules), then the project folder scan SECOND (adds
project-specific patterns on top). Conflicts between the two are detected normally.

#### If "PRD or project description" selected:
1. Ask user to paste or provide file path
2. Analyze content for:
   - Technology mentions
   - Architecture requirements
   - Feature requirements
3. Use detected info to pre-select tech stack options
4. Also use this to populate `product.md` (see Step 2.5)

### Step 2.5: Product Description (NEW)

After import sources, ask about product documentation:

```javascript
AskUserQuestion({
  questions: [{
    question: "Would you like to describe your product? This helps me generate better stories and features.",
    header: "Product",
    options: [
      { label: "Describe my product", description: "Paste a PRD or describe what you're building" },
      { label: "Scan and infer", description: "I'll analyze your project and show you what I found" },
      { label: "Skip for now", description: "Create a placeholder - you can fill it in later" }
    ],
    multiSelect: false
  }]
});
```

#### If "Describe my product" selected:
1. Ask user to paste PRD or description in their next message
2. Parse the content and extract:
   - Product name and tagline
   - Target users
   - Key features
   - Non-goals
3. Show a summary:
```
I understood your product as:

**Name**: [extracted name]
**Tagline**: [one-liner]
**Target Users**: [list]
**Key Features**: [list 3-5]

Is this correct? [Yes / Let me correct]
```
4. Generate `product.md` with PIN markers to `.workflow/specs/product.md`

#### If "Scan and infer" selected:
1. Run `scripts/flow-product-scanner.js` to analyze:
   - `package.json` (name, description, keywords)
   - `README.md` (description, features)
   - Project structure (routes, screens, API)
2. Show brief summary:
```
Based on scanning your project:

**Name**: [from package.json]
**Type**: [web-app | api | cli] (detected [framework])
**Features**: [top 3 detected]

Is this correct? [Yes / Let me correct]
```
3. If user says "Let me correct", ask what to change
4. Generate `product.md` with PIN markers

#### If "Skip for now" selected:
1. Copy `templates/context/product-placeholder.md` to `.workflow/specs/product.md`
2. Show reminder:
```
Created a placeholder product.md. You can fill it in later by:
- Running `/wogi-init` again and selecting "Describe my product"
- Editing `.workflow/specs/product.md` directly
```

### Step 3: Tech Stack Selection (if no import or new project)

If user selected "None - start fresh" or to supplement imported patterns, run the step-by-step tech stack wizard.

**IMPORTANT**: Ask ONE question at a time. Wait for response before proceeding.

#### Step 3a: Project Type

```javascript
AskUserQuestion({
  questions: [{
    question: "What type of project is this?",
    header: "Type",
    options: [
      { label: "Web Application", description: "Website or web app running in a browser" },
      { label: "Mobile App", description: "React Native, Flutter, or native iOS/Android" },
      { label: "Desktop App", description: "Electron, Tauri, or native desktop application" },
      { label: "Backend/API Only", description: "REST API, GraphQL, or microservice" }
    ],
    multiSelect: false
  }]
});
```

If user needs more options, offer:
- Full-Stack (Web + API)
- CLI Tool
- Library/Package

#### Step 3b: Focus Area (if applicable)

Skip if Backend/API Only or CLI Tool.

```javascript
AskUserQuestion({
  questions: [{
    question: "What's your focus area?",
    header: "Focus",
    options: [
      { label: "Frontend only", description: "UI and client-side code" },
      { label: "Backend only", description: "Server-side and API code" },
      { label: "Full-stack (Recommended)", description: "Both frontend and backend" }
    ],
    multiSelect: false
  }]
});
```

#### Step 3c: Frontend Framework (if frontend)

```javascript
AskUserQuestion({
  questions: [{
    question: "Which frontend framework would you like to use?",
    header: "Frontend",
    options: [
      { label: "Next.js (Recommended)", description: "React framework with SSR, routing, and API routes built-in" },
      { label: "React", description: "UI library - you'll configure routing and bundling separately" },
      { label: "Vue 3", description: "Progressive framework with gentle learning curve" },
      { label: "Svelte / SvelteKit", description: "Compiler-based framework with minimal runtime" }
    ],
    multiSelect: false
  }]
});
```

Other options if requested: Nuxt, Angular, Astro, Solid.js, Qwik

#### Step 3d: Backend Framework (if backend)

```javascript
AskUserQuestion({
  questions: [{
    question: "Which backend framework would you like to use?",
    header: "Backend",
    options: [
      { label: "NestJS (Recommended)", description: "TypeScript framework with dependency injection and decorators" },
      { label: "Express", description: "Minimal, flexible Node.js web framework" },
      { label: "FastAPI (Python)", description: "Modern Python framework with automatic OpenAPI docs" },
      { label: "Hono", description: "Lightweight, fast edge-ready framework" }
    ],
    multiSelect: false
  }]
});
```

Other options: Fastify, tRPC, Django, Flask, Go (Gin), Rails, Phoenix

#### Step 3e: Database & ORM

```javascript
AskUserQuestion({
  questions: [{
    question: "Which database and ORM combination?",
    header: "Database",
    options: [
      { label: "PostgreSQL + Prisma (Recommended)", description: "Type-safe ORM with great DX and migrations" },
      { label: "PostgreSQL + TypeORM", description: "Decorator-based ORM, popular with NestJS" },
      { label: "MongoDB + Mongoose", description: "Document database with schema validation" },
      { label: "SQLite + Drizzle", description: "Lightweight DB with type-safe SQL-like queries" }
    ],
    multiSelect: false
  }]
});
```

Other options: MySQL, Redis, DynamoDB, raw SQL

#### Step 3f: State Management (if frontend)

Skip for Vue (default to Pinia) or if no frontend.

```javascript
AskUserQuestion({
  questions: [{
    question: "Which state management solution?",
    header: "State",
    options: [
      { label: "Zustand (Recommended)", description: "Simple, minimal boilerplate, works great with React" },
      { label: "Redux Toolkit", description: "Predictable state container with dev tools" },
      { label: "TanStack Query", description: "Server state management with caching" },
      { label: "React Context only", description: "Built-in React state, no extra library" }
    ],
    multiSelect: false
  }]
});
```

For Vue: Pinia (default), Vuex

#### Step 3g: Form Handling (if frontend)

```javascript
AskUserQuestion({
  questions: [{
    question: "Which form handling library?",
    header: "Forms",
    options: [
      { label: "React Hook Form (Recommended)", description: "Performant, flexible, easy validation" },
      { label: "Formik", description: "Popular form library with comprehensive features" },
      { label: "Native controlled", description: "No library, just useState for forms" }
    ],
    multiSelect: false
  }]
});
```

For Vue: VeeValidate, FormKit

#### Step 3h: Styling

```javascript
AskUserQuestion({
  questions: [{
    question: "Which styling approach?",
    header: "Styling",
    options: [
      { label: "Tailwind CSS (Recommended)", description: "Utility-first CSS framework" },
      { label: "shadcn/ui + Tailwind", description: "Copy-paste components with Tailwind" },
      { label: "CSS Modules", description: "Scoped CSS with component co-location" },
      { label: "Styled Components", description: "CSS-in-JS with tagged template literals" }
    ],
    multiSelect: false
  }]
});
```

Other options: Emotion, Vanilla Extract, Sass/SCSS, plain CSS

#### Step 3i: Testing

```javascript
AskUserQuestion({
  questions: [{
    question: "Which testing setup?",
    header: "Testing",
    options: [
      { label: "Vitest (Recommended)", description: "Fast unit testing, Vite-native, Jest compatible" },
      { label: "Jest", description: "Popular testing framework with snapshots" },
      { label: "Playwright", description: "E2E testing with browser automation (complements WebMCP for full browser control)" },
      { label: "Skip for now", description: "Set up testing later" }
    ],
    multiSelect: true
  }]
});
```

### Step 4: Generate Files

After collecting all selections, generate the project files:

#### 4.1 Create config.json

```javascript
const config = {
  projectName: selectedName,
  version: "1.0",
  stack: {
    platform: selectedPlatform,
    focus: selectedFocus,
    frontend: selectedFrontend,
    backend: selectedBackend,
    database: selectedDatabase,
    orm: selectedOrm,
    stateManagement: selectedState,
    forms: selectedForms,
    styling: selectedStyling,
    testing: selectedTesting
  },
  createdAt: new Date().toISOString()
};

// Add WebMCP config if frontend framework selected
const webmcpFrameworks = ['next', 'react', 'vue', 'svelte', 'nuxt'];
const normalizedFrontend = (selectedFrontend || '').toLowerCase();
if (webmcpFrameworks.some(f => normalizedFrontend.includes(f))) {
  config.webmcp = {
    enabled: true,
    toolsPath: ".workflow/webmcp/tools.json",
    fallbackEnabled: true,
    maxToolCalls: 20
  };
}
```

Save to `.workflow/config.json`.

#### 4.2 Generate Skills (Placeholder + Documentation)

**Step A: Create placeholder skills first (fast, no network)**

Run the skill generator to create directory structure with placeholder content:

```bash
node scripts/flow-skill-generator.js --from-selections
```

This creates `.claude/skills/<name>/` for each selected technology with `skill.md`, `knowledge/patterns.md`, etc. - all with template content that will be populated in Step B.

**Step B: Check for curated skills on skills.sh**

For each technology, check if it has a `skillsShId` in `flow-tech-options.js`. If so, offer to install the curated skill instead:

```
For [technology], a curated community skill is available on skills.sh.
Options:
  1. Install curated skill (recommended for well-known frameworks)
  2. Generate from documentation via Context7
  3. Both (install curated + augment with Context7)
```

If the user picks skills.sh:
```javascript
// Validate skillsShId against allowlist before shell interpolation
const ALLOWED_SKILL_ID = /^[a-zA-Z0-9_-]+$/;
if (!ALLOWED_SKILL_ID.test(skillsShId)) {
  console.warn(`Invalid skill ID: ${skillsShId}. Skipping.`);
} else {
  // Safe to interpolate after validation
  execSync(`npx skills add ${skillsShId} --agent claude-code`);
}
```

If `npx skills` is not available, log a warning and fall back to Context7.

**Step C: Fetch documentation via Context7 (fetch-extract-flush loop)**

IMPORTANT: Fetch docs ONE library at a time to prevent context overflow.

For each skill with a `context7` ID that still has placeholder content:

```
FOR EACH skill (sequentially, NOT in parallel):

  1. FETCH: Call mcp__MCP_DOCKER__resolve-library-id
     with libraryName="<skill name>"

  2. FETCH: Call mcp__MCP_DOCKER__get-library-docs
     with context7CompatibleLibraryID="<context7 ID>"
     topic="best practices patterns"
     tokens=5000

  3. EXTRACT: Pass fetched docs to the skill enhancer:
     const { enhanceSkillWithDocs } = require('./scripts/flow-skill-generator.js');
     enhanceSkillWithDocs('<skillId>', fetchedDocs);

  4. FLUSH: The doc content is now written to disk.
     Do NOT hold it in context. Move to the next library.

  5. CHECK: If context usage > 80%, consider compacting
     before fetching the next library.
```

If Context7 MCP is not available, log a warning and skip:
```
Context7 MCP not available. Skills created with placeholder content.
Run /wogi-setup-stack --fetch-docs later to populate with real documentation.
```

After all fetches complete, report:
```
Enhanced X/Y skills with documentation (Z had no Context7 ID, W already had content)
```

#### 4.3 Create State Files

Create ALL of the following files in `.workflow/state/`. **Do NOT skip any.**

**ready.json** (task queue):
```json
{
  "ready": [],
  "inProgress": [],
  "recentlyCompleted": [],
  "blocked": [],
  "backlog": [],
  "lastUpdated": "2026-01-13T..."
}
```

**decisions.md** (coding patterns):

If patterns were extracted (from reference project or existing code), use the extracted content:
```markdown
# Project Decisions & Patterns

[OUTPUT FROM formatAsDecisions(result) - extracted patterns grouped by category]

[OUTPUT FROM resolutionsToDecisions(resolutions) - resolved conflict decisions]
```

If no patterns extracted (fresh project with no reference), create a template:
```markdown
# Project Decisions & Patterns

## Component Architecture
<!-- Patterns will be added as we work -->

## Coding Standards
<!-- Standards will be added as we work -->

## Architecture Decisions
<!-- Decisions will be added as we work -->
```

**CRITICAL**: When a reference project was scanned (Step 2 "Other project folder"), the extracted patterns from `formatAsDecisions()` and resolved conflicts from `resolutionsToDecisions()` MUST be written here. This is the persistence pipeline — without it, all extracted knowledge is lost.

**app-map.md** (component registry):

If components were detected (from reference project scan or existing code scan), populate with detected data:
```markdown
# Application Component Map

## Overview
This file tracks all components in the application.

## Screens

| Screen | Route | Status |
|--------|-------|--------|
[Detected screens from pattern extraction, if any]

## Modals

| Modal | Trigger | Status |
|-------|---------|--------|
[Detected modals, if any]

## Components

| Component | Variants | Path | Details |
|-----------|----------|------|---------|
[Detected components from pattern extraction, if any]

## Rules

1. **Before creating** → Search this file
2. **If similar exists** → Add variant, don't create new
3. **After creating** → Update this file + create detail doc
```

If no components detected, create the empty template (same structure, no entries).

**function-map.md** (utility function registry):

Run the function scanner to auto-generate:
```javascript
const { FunctionScanner } = require('./scripts/flow-function-index.js');
const scanner = new FunctionScanner();
const registry = await scanner.scan();
if (registry && registry.functions.length > 0) {
  scanner.save();        // Writes function-index.json
  scanner.generateMap(); // Writes function-map.md
}
```

If no functions found (empty project), create a minimal template:
```markdown
# Function Map

Utility functions available for reuse. **Check before creating new utilities.**

## Utilities

| Function | Purpose | File | Parameters |
|----------|---------|------|------------|
<!-- Functions will be registered as they're created -->

## Rules

1. **Before creating** → Search this file
2. **If similar exists** → Extend it, don't create new
3. **After creating** → Run `flow function-index scan` to update
```

**api-map.md** (API endpoint registry):

Run the API scanner to auto-generate:
```javascript
const { APIScanner } = require('./scripts/flow-api-index.js');
const scanner = new APIScanner();
const registry = await scanner.scan();
if (registry && (registry.endpoints.length > 0 || registry.clientFunctions.length > 0)) {
  scanner.save();        // Writes api-index.json
  scanner.generateMap(); // Writes api-map.md
}
```

If no APIs found (empty project), create a minimal template:
```markdown
# API Map

API endpoints and client functions. **Check before creating new endpoints.**

## Endpoints

| Method | Endpoint | Service | File |
|--------|----------|---------|------|
<!-- Endpoints will be registered as they're created -->

## Client Functions

| Function | Method | Endpoint | File |
|----------|--------|----------|------|
<!-- Client functions will be registered as they're created -->

## Rules

1. **Before creating** → Search this file
2. **If similar exists** → Parameterize it, don't duplicate
3. **After creating** → Run `flow api-index scan` to update
```

**request-log.md** (change history):
```markdown
# Request Log

This file tracks all changes made to the project.

---

### R-001 | [DATE]
**Type**: setup
**Tags**: #system
**Request**: "Initialize WogiFlow"
**Result**: Project configured with [stack summary]
**Files**: .workflow/*, .claude/*
```

**State File Generation Checklist** (verify all created):
- [ ] `ready.json` — Task queue
- [ ] `decisions.md` — Coding patterns (with extracted patterns if available)
- [ ] `app-map.md` — Component registry (with detected components if available)
- [ ] `function-map.md` — Function registry (auto-scanned or template)
- [ ] `api-map.md` — API registry (auto-scanned or template)
- [ ] `request-log.md` — Change history (with R-001 entry)

#### 4.4 Create Spec Files

**stack.md** in `.workflow/specs/`:
```markdown
# Tech Stack

## Frontend
- Framework: [selected]
- State Management: [selected]
- Forms: [selected]
- Styling: [selected]

## Backend
- Framework: [selected]
- Database: [selected]
- ORM: [selected]

## Testing
- Unit: [selected]
- E2E: [selected]

## Context7 Documentation
Skills with documentation have been generated in `.claude/skills/`.
```

#### 4.5 Delete Pending Setup Marker

```javascript
const pendingPath = '.workflow/state/pending-setup.json';
if (fs.existsSync(pendingPath)) {
  fs.unlinkSync(pendingPath);
}
```

#### 4.6 Register Hooks with Claude Code (CRITICAL)

**Run `flow hooks setup` to ensure hooks are registered with Claude Code.**

The postinstall script copies `.claude/settings.json` which contains hook definitions,
but this step regenerates `settings.local.json` with absolute paths as a safety net.

```bash
./scripts/flow hooks setup 2>&1
```

If this fails, hooks may not fire. Display a warning:
```
⚠️ Hook setup failed. Hooks may not work.
   Run manually: ./scripts/flow hooks setup
```

**Why this matters**: Without hooks registered in `.claude/settings.json` or
`.claude/settings.local.json`, Claude Code doesn't know WogiFlow's hook scripts
exist. Task gating, scope validation, and loop enforcement all depend on hooks.

### Step 5: Summary & Learning Explanation

Display the completion summary:

```
Setup Complete!

## Generated Files

.workflow/
  config.json          # Project configuration
  specs/
    stack.md           # Your tech stack details
    product.md         # Product description (if provided)
  state/
    ready.json         # Task queue
    request-log.md     # Change history
    app-map.md         # Component registry (auto-populated if reference project provided)
    decisions.md       # Coding patterns (auto-populated from pattern extraction)
    function-map.md    # Utility function registry (auto-scanned)
    api-map.md         # API endpoint registry (auto-scanned)
    function-index.json # Machine-readable function index
    api-index.json     # Machine-readable API index

.claude/
  skills/
    [framework]/       # Framework patterns from Context7
    [library]/         # Library patterns from Context7

## Your Stack
- Frontend: [selection]
- Backend: [selection]
- Database: [selection]
- Styling: [selection]
- Testing: [selection]

## How to Customize

- **Edit directly**: Open any .md or .json file and modify it
- **Ask me**: Say "update the rules to prefer X" and I'll update the files

## WogiFlow Learns With You

As we work together, WogiFlow automatically:
- Records patterns you prefer in decisions.md
- Learns from corrections you make
- Updates skills when you change approaches
- Tracks components in app-map.md

Say "show me the rules" or "what patterns are we using?" anytime.

## Next Steps

1. Run `/wogi-health` to verify everything is set up correctly
2. Create your first task with `/wogi-story "Your first feature"`
3. Or just tell me what you'd like to build!
```

---

## Error Handling

### If Context7 fetch fails
- Log the error but continue
- Create a minimal skill file noting that docs couldn't be fetched
- Inform user they can run `/wogi-skills refresh` later to retry

### If file creation fails
- Report which file failed
- Attempt to clean up partial state
- Suggest manual intervention if needed

### If user cancels mid-wizard
- Save progress to `.workflow/state/setup-progress.json`
- Next run can offer to resume
