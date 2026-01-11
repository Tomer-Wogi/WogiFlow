# Onboarding Existing Projects

Analyze an existing codebase and set up WogiFlow with full context.

---

## Quick Start

```bash
npx flow onboard
```

This interactive process:
1. Detects your tech stack
2. Scans for components
3. Asks about your project
4. Generates populated state files

---

## Detection Phase

### Tech Stack Detection

Automatically detects:

| Type | How Detected |
|------|--------------|
| **Language** | `tsconfig.json`, `package.json`, `requirements.txt`, `go.mod` |
| **Framework** | Dependencies in package.json, config files |
| **Database** | ORM packages, docker-compose services |
| **Package Manager** | Lock files (npm, yarn, pnpm, pip) |

### Supported Frameworks

| Framework | Detection Method |
|-----------|-----------------|
| Next.js | `next` in package.json, `next.config.js` |
| React | `react` in package.json |
| NestJS | `@nestjs/core`, `nest-cli.json` |
| Vue | `vue` in package.json |
| Angular | `@angular/core`, `angular.json` |
| FastAPI | `fastapi` in requirements.txt |
| Django | `django` in requirements.txt |
| Express | `express` in package.json |

### Component Scanning

Scans for:
- React/Vue components in `src/components/`
- Pages in `src/pages/`, `pages/`, `app/`
- NestJS modules (`.module.ts`)
- API routes in `pages/api/`, `app/api/`
- Services in `src/services/`

---

## Project Interview

The onboarding process asks about:

### 1. Project Basics
- Project name (auto-detected from package.json)
- Brief description

### 2. Documentation
- PRD or technical spec
- README with project overview
- Architecture documentation

Documents found automatically:
- `PRD.md`, `prd.md`
- `README.md`
- `ARCHITECTURE.md`
- `docs/technical-spec.md`

### 3. Current State
- Early development
- MVP / working prototype
- Production with active users
- Maintenance mode

### 4. Goals
- Add new features
- Fix bugs
- Refactor/improve code quality
- Add tests
- Documentation
- Performance optimization
- Security improvements

### 5. Known Issues
Input existing bugs and tech debt to create initial tasks.

### 6. Coding Preferences
Patterns and conventions your team follows.

---

## What Gets Generated

### project.md (Specification)

```markdown
# Project Specification: my-app

## Overview
A web application for managing tasks...

## Tech Stack
| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Framework | Next.js |
| Database | PostgreSQL (Prisma) |

## Goals
- Add new features
- Fix bugs

## Known Issues / Tech Debt
- Login sometimes fails on slow connections
- Dashboard needs performance optimization
```

### app-map.md (Component Registry)

```markdown
# App Map - Component Registry

## Screens / Pages
| Screen | Route | Description |
|--------|-------|-------------|
| Login | /login | User authentication |
| Dashboard | /dashboard | Main dashboard |

## Components
| Component | Path | Type |
|-----------|------|------|
| Button | src/components/Button.tsx | UI |
| Modal | src/components/Modal.tsx | UI |

## Modules / Services
| Module | Path | Description |
|--------|------|-------------|
| auth | src/services/auth.ts | Authentication |
```

### decisions.md (Patterns)

```markdown
# Project Decisions

## Tech Stack
- **Language**: TypeScript
- **Framework**: Next.js
- **Database**: PostgreSQL (Prisma)

## Conventions
- Use functional components
- Services should be thin
- All API calls through axios wrapper
```

### Initial Tasks

From known issues:
```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Login sometimes fails on slow connections",
      "type": "bugfix"
    },
    {
      "id": "TASK-002",
      "title": "Dashboard needs performance optimization",
      "type": "refactor"
    }
  ]
}
```

---

## Skill Suggestions

Based on detected framework, suggests relevant skills:

| Framework | Suggested Skill |
|-----------|----------------|
| NestJS | `nestjs` |
| React/Next.js | `react` |
| FastAPI/Django/Flask | `python` |

Skills are added to `config.json`:
```json
{
  "skills": {
    "installed": ["react"]
  }
}
```

---

## Post-Onboarding Steps

### 1. Review Generated Files

```bash
# Check detected components
cat .workflow/state/app-map.md

# Check detected patterns
cat .workflow/state/decisions.md

# Check project spec
cat .workflow/specs/project.md
```

### 2. Fill in Gaps

Edit files to add:
- Missing components
- Team-specific patterns
- Architectural decisions

### 3. Verify Health

```bash
/wogi-health
```

### 4. View Tasks

```bash
/wogi-ready
```

### 5. Start Working

```bash
/wogi-start TASK-001
```

---

## Re-running Onboarding

If you need to update the analysis:

```bash
./scripts/flow onboard
# Answer "y" when asked to re-run
```

This will:
- Re-detect tech stack
- Re-scan components
- Preserve your customizations (with option to overwrite)

---

## Hybrid Mode Setup

Onboarding also configures hybrid mode context:

```json
{
  "hybrid": {
    "projectContext": {
      "uiFramework": "react",
      "stylingApproach": "tailwind",
      "componentDirs": ["src/components"],
      "availableComponents": {...}
    }
  }
}
```

This helps local LLMs understand your project structure.

---

## Troubleshooting

### Components Not Detected

Check directory patterns in config:
```json
{
  "componentIndex": {
    "directories": ["src/components", "src/hooks", "src/services"]
  }
}
```

### Framework Not Detected

Verify dependencies are in package.json or requirements.txt.

### PRD Not Found

Specify path manually when prompted, or use:
```bash
# Paste PRD directly during interview
```

---

## Related

- [Installation](./installation.md) - For new projects
- [Component Indexing](./component-indexing.md) - Auto-scanning details
- [Framework Detection](./framework-detection.md) - Skill auto-creation
