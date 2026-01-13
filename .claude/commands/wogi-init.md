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
1. Ask user to provide the folder path
2. Scan the folder:
   - Read `package.json` for dependencies
   - Read `.workflow/` if exists for patterns
   - Read `.eslintrc`, `tsconfig.json`, `.prettierrc` for conventions
   - Read `src/` structure for file organization patterns
3. Use `scripts/flow-pattern-extractor.js` to extract and analyze patterns
4. Detect conflicts (different approaches in same codebase)
5. Present findings with conflict resolution:

```
I found the following patterns in [project-name]:

## Tech Stack (Detected)
- Framework: Next.js 14
- Styling: Tailwind CSS
- State: Zustand
- Testing: Vitest

## Coding Patterns (5 found)
1. Use functional components with hooks
2. API routes follow /api/[resource]/[action] pattern
3. Use zod for validation
4. Components in src/components/[feature]/
5. Server actions for mutations

## Conflicts Detected (2)
These need your decision:

### 1. Error Handling
- Pattern A (8 files): try/catch with console.error
- Pattern B (12 files): try/catch with error boundary (Recommended)

### 2. API Response Format
- Pattern A (3 files): { data, error, status }
- Pattern B (5 files): { success, data, message } (Recommended)
```

Then ask:
```javascript
AskUserQuestion({
  questions: [{
    question: "How would you like to handle the detected patterns?",
    header: "Patterns",
    options: [
      { label: "Accept All with Recommended (Recommended)", description: "Use the recommended resolution for conflicts" },
      { label: "Manual Review 1-by-1", description: "Review each conflict and pattern individually" }
    ],
    multiSelect: false
  }]
});
```

#### If "Exported WogiFlow profile" selected:
1. Ask for the .zip file path
2. Extract to temp folder
3. Read `profile.json` for metadata
4. Display contents: rules, skills, decisions, tech stack
5. Same conflict detection as above

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
      { label: "Playwright", description: "E2E testing with browser automation" },
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
```

Save to `.workflow/config.json`.

#### 4.2 Generate Skills Using Context7

For each selected technology that has a Context7 ID:

1. Call `mcp__MCP_DOCKER__resolve-library-id` to verify the library
2. Call `mcp__MCP_DOCKER__get-library-docs` with topic "patterns" to fetch best practices
3. Use `scripts/flow-skill-generator.js` to create skill files

```javascript
// For each technology in stack
const techOptions = require('./scripts/flow-tech-options.js');
const technologies = techOptions.collectTechnologiesFromSelections(config.stack);

for (const tech of technologies) {
  if (tech.context7) {
    // Fetch docs from Context7
    const docs = await getLibraryDocs(tech.context7, { topic: 'patterns', tokens: 8000 });

    // Generate skill
    await generateSkill({
      name: tech.value,
      label: tech.label,
      context7Id: tech.context7,
      content: docs,
      isFramework: techOptions.getSkillType(tech.value) === 'framework'
    });
  }
}
```

#### 4.3 Create State Files

Create the following files in `.workflow/state/`:

**ready.json** (task queue):
```json
{
  "ready": [],
  "inProgress": [],
  "recentlyCompleted": [],
  "lastUpdated": "2026-01-13T..."
}
```

**decisions.md** (coding patterns):
```markdown
# Project Decisions & Patterns

## Component Architecture
<!-- Patterns will be added as we work -->

## Coding Standards
<!-- Standards will be added as we work -->

## Architecture Decisions
<!-- Decisions will be added as we work -->
```

**app-map.md** (component registry):
```markdown
# Application Component Map

## Overview
This file tracks all components in the application.

## Components
<!-- Components will be registered as they're created -->

## Screens
<!-- Screens will be registered as they're created -->
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

**roadmap.md** (future work):
Copy from `templates/roadmap.md` to `.workflow/roadmap.md`

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

### Step 5: Summary & Learning Explanation

Display the completion summary:

```
Setup Complete!

## Generated Files

.workflow/
  config.json          # Project configuration
  specs/
    stack.md           # Your tech stack details
  state/
    ready.json         # Task queue
    request-log.md     # Change history
    app-map.md         # Component registry (grows as you work)
    decisions.md       # Coding patterns (grows as you work)

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
