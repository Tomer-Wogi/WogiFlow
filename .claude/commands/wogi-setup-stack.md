Interactive tech stack wizard that configures your project and generates skills.

Usage:
- `/wogi-setup-stack` - Run interactive wizard
- `/wogi-setup-stack --fetch-docs` - Fetch documentation for existing skills via Context7
- `/wogi-setup-stack --regenerate` - Regenerate skills from saved selections

## What This Does

1. **Interactive Wizard** - Guides you through selecting:
   - Project type (web, mobile, backend, full-stack, CLI, library)
   - Frontend framework (React, Next.js, Vue, Svelte, Angular, etc.)
   - Backend framework (Express, NestJS, FastAPI, Django, etc.)
   - State management (Redux, Zustand, TanStack Query, Pinia, etc.)
   - Styling (Tailwind, CSS Modules, Styled Components, etc.)
   - Database & ORM (PostgreSQL, MongoDB, Prisma, etc.)
   - Testing (Jest, Vitest, Playwright, Cypress, etc.)
   - Additional tools (Docker, GraphQL, Auth, etc.)

2. **"Choose Best For Me"** - Enter `?` at any prompt for recommended defaults:
   - Frontend: Next.js
   - State: TanStack Query + Zustand
   - Styling: Tailwind + shadcn/ui
   - Backend: NestJS (TS) or FastAPI (Python)
   - Database: PostgreSQL + Prisma
   - Testing: Vitest + Playwright

3. **Skills Generation** - For each technology, offers two sources:
   - **skills.sh** (if available): Install curated community skill via `npx skills add`
   - **Context7 MCP**: Generate from official documentation
   - Technologies with a `skillsShId` in `flow-tech-options.js` offer both options
   - Skills without a skills.sh mapping fall back to Context7 automatically
   - Generated skills include: `skill.md`, `knowledge/patterns.md`, `knowledge/anti-patterns.md`, `rules/conventions.md`

4. **Skills Index** - Creates `.claude/skills/skills-index.json` for easy access

5. **Updates**:
   - Adds tech stack to `decisions.md`
   - Updates `config.json` with installed skills

## Running the Wizard

```bash
# Via Claude Code command
/wogi-setup-stack

# Or directly
node scripts/flow-stack-wizard.js
```

## Output

```
============================================================
  Tech Stack Wizard
  Configure your project and generate coding patterns
============================================================

What type of project is this?
  (1) Web Application
  (2) Mobile App (React Native / Flutter / Native)
  ...

Your choice: 5

What's your focus?
  (1) Frontend only
  (2) Backend only
  (3) Full-stack (both)

Your choice: 3

...

============================================================
  Your Tech Stack
============================================================

  Project Type: Full-Stack (Frontend + Backend)
  Frontend: Next.js
  State Management: TanStack Query (server state)
  Styling: shadcn/ui + Tailwind
  Backend: NestJS
  Database: Prisma

Generate skills and fetch documentation? [Y/n] y

  Generating skills for:
    - Next.js
    - TanStack Query
    - Tailwind CSS
    - NestJS
    - Prisma

  Processing Next.js...
    ✓ Created: .claude/skills/nextjs

  ...

  ✓ Created: .claude/skills/skills-index.json
  ✓ Updated: .workflow/state/decisions.md
  ✓ Updated: .workflow/config.json

✓ Skills generated successfully!
```

## Fetching Documentation (`--fetch-docs`)

After running the wizard, populate skills with real documentation:

```
/wogi-setup-stack --fetch-docs
```

### How It Works (Fetch-Extract-Flush Loop)

This command populates placeholder skills with real documentation from Context7 MCP.
It processes skills **one at a time** to prevent context overflow.

**Step 1: Identify skills needing docs**

```bash
node scripts/flow-skill-generator.js --fetch-docs
```

This lists all installed skills with Context7 IDs, showing which have content and which need fetching.

**Step 2: For EACH skill that needs docs (sequentially)**

Do NOT fetch multiple libraries in parallel. Process one at a time:

1. **Resolve**: Call `mcp__MCP_DOCKER__resolve-library-id` with `libraryName="<skill name>"`
   - If resolution fails, log warning and skip to next skill

2. **Fetch**: Call `mcp__MCP_DOCKER__get-library-docs` with:
   - `context7CompatibleLibraryID`: the resolved ID (or the stored `context7` ID from the skill's frontmatter)
   - `topic`: "best practices patterns common mistakes"
   - `tokens`: 5000 (capped to prevent context overflow)

3. **Extract & Write**: Call the enhancer to write docs to disk:
   ```javascript
   const { enhanceSkillWithDocs } = require('./scripts/flow-skill-generator.js');
   await enhanceSkillWithDocs('<skillId>', fetchedDocs);
   ```
   This updates `knowledge/patterns.md`, `knowledge/anti-patterns.md`, and `rules/conventions.md`.

4. **Flush**: The doc content is now on disk. Do NOT hold it in context.
   Move to the next skill.

5. **Context check**: If context usage feels high (many skills processed), suggest compacting before continuing.

**Step 3: Report results**

```
Documentation Fetch Complete:
  Enhanced: 5 skills (nextjs, react, prisma, tailwind, nestjs)
  Skipped: 1 skill (no Context7 ID: custom-utils)
  Already populated: 2 skills (vue, svelte)
  Failed: 0

Skills with documentation are now ready for use.
```

### Graceful Degradation

- **Context7 MCP not available**: Skills keep placeholder content. User can retry later.
- **Single library fails**: Skip it and continue with remaining libraries.
- **Context getting large**: Suggest `/wogi-compact` between fetches if needed.

### Alternative: Install from skills.sh

For popular frameworks, curated skills may be available on skills.sh:

```bash
npx skills add vercel-labs/agent-skills/vercel-react-best-practices --agent claude-code
```

WogiFlow automatically discovers skills installed to `.claude/skills/`.
Check the tech options in `flow-tech-options.js` for known `skillsShId` mappings.

## Skills Index Structure

```json
{
  "version": "1.0",
  "generated": "2024-01-06T12:00:00Z",
  "skills": {
    "nextjs": {
      "path": ".claude/skills/nextjs/",
      "covers": ["next.js", "app router", "server components"],
      "sections": {
        "patterns": "knowledge/patterns.md",
        "anti-patterns": "knowledge/anti-patterns.md"
      }
    }
  },
  "projectStack": ["nextjs", "tailwind", "prisma"]
}
```

## Re-running the Wizard

You can run the wizard again to:
- Add new technologies
- Change existing selections
- Regenerate skills with updated documentation

Existing learnings in `knowledge/learnings.md` are preserved.

## Integration

Run `/wogi-setup-stack` anytime after installing WogiFlow to configure your tech stack.
