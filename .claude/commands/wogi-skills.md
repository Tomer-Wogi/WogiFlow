---
description: "Manage skill packages for specialized development workflows"
---
Manage skill packages for specialized development workflows.

Usage:
- `/wogi-skills` - List installed and available skills
- `/wogi-skills add [name]` - Install a skill
- `/wogi-skills remove [name]` - Remove a skill
- `/wogi-skills info [name]` - Show skill details

## What Are Skills?

Skills are modular add-ons that provide:
- Specialized slash commands
- Code templates
- Coding rules/conventions
- Best practices for specific tech stacks

## Available Skills

| Skill | Description | Commands Added |
|-------|-------------|----------------|
| `nestjs` | NestJS module builder | `/nestjs-scaffold`, `/nestjs-entity`, `/nestjs-db` |
| `react` | React component patterns | `/react-component`, `/react-hook` |
| `python` | Python/FastAPI patterns | `/python-endpoint`, `/python-test` |

## Output - List

```
🧰 Wogi Flow Skills

Installed:
  ✓ nestjs - NestJS module builder
    Commands: /nestjs-scaffold, /nestjs-entity, /nestjs-db

Available:
  ○ react - React component patterns
  ○ python - Python/FastAPI patterns

Use: /wogi-skills add [name] to install
     /wogi-skills info [name] for details
```

## Output - Info

```
📦 Skill: nestjs

NestJS module builder with production-ready patterns.

Commands:
  /nestjs-scaffold [name]  Create complete module
  /nestjs-entity [name]    Create TypeORM entity
  /nestjs-dto [name]       Create DTOs with validation
  /nestjs-migration [name] Generate migration
  /nestjs-db migrate       Run migrations
  /nestjs-db seed          Run seed data

Rules included:
  • conventions.md - Architecture patterns
  • database.md - TypeORM patterns

Templates included:
  • entity.template.ts
  • dto.template.ts
  • service.template.ts
  • controller.template.ts
  • module.template.ts
```

## Installation

When adding a skill:
1. Copy skill folder to `.claude/skills/[name]/`
2. Update `config.json` with skill in `skills.installed`
3. Skill commands become available immediately

## Creating Custom Skills

See: `.claude/skills/README.md` for skill creation guide

Structure:
```
.claude/skills/[name]/
  skill.md           # Description and usage
  rules/             # Coding conventions
  commands/          # Slash commands
  templates/         # Code templates
```
