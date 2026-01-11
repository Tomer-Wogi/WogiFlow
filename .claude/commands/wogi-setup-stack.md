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

3. **Skills Generation** - Creates skill files for each technology:
   - `skill.md` - Overview and when to apply
   - `knowledge/patterns.md` - Best practices
   - `knowledge/anti-patterns.md` - Common mistakes
   - `rules/conventions.md` - Coding standards

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

## Fetching Documentation

After running the wizard, populate skills with real documentation:

```
/wogi-setup-stack --fetch-docs
```

This uses Context7 MCP to fetch latest docs and extract:
- Best practices
- Common patterns
- Anti-patterns
- Code examples

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
