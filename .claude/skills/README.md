# WogiFlow Skills

Skills are modular add-ons that extend WogiFlow with specialized commands, templates, and rules for specific tech stacks.

## Available Skills

| Skill | Description |
|-------|-------------|
| `nestjs` | NestJS module builder with TypeORM |
| `react` | React component patterns (coming soon) |
| `python` | Python/FastAPI patterns (coming soon) |

## Installing Skills

After installing WogiFlow:

```
/wogi-skills add nestjs
```

Or manually:
1. Copy skill folder to `.claude/skills/`
2. Add skill name to `config.json` → `skills.installed`

## Using Skills

Once installed, skill commands are available:

```
# NestJS skill
/nestjs-scaffold users        # Create complete module
/nestjs-entity User           # Create entity
/nestjs-db migrate            # Run migrations
```

## Skill Structure

Each skill follows this structure:

```
.claude/skills/[name]/
├── skill.md              # Description, when to use, commands list
├── rules/                # Coding conventions (auto-loaded)
│   ├── conventions.md
│   └── [topic].md
├── commands/             # Slash commands
│   ├── scaffold.md       # Becomes /[name]-scaffold
│   └── [action].md
└── templates/            # Code templates
    ├── entity.template.ts
    └── [type].template.ts
```

## Creating Custom Skills

### 1. Create Skill Directory

```bash
mkdir -p .claude/skills/my-skill/{rules,commands,templates}
```

### 2. Create skill.md

```markdown
# My Skill

Description of what this skill does.

## When to Use

- Creating [type] components
- Working with [technology]

## Commands Added

| Command | Description |
|---------|-------------|
| `/my-skill-action` | Does something |
```

### 3. Add Commands

Create `.claude/skills/my-skill/commands/action.md`:

```markdown
Do the action for my skill.

Usage: `/my-skill-action [args]`

## Steps

1. Read templates from skill folder
2. Generate files
3. Report results
```

### 4. Add Rules

Create `.claude/skills/my-skill/rules/conventions.md`:

```markdown
# My Skill Conventions

## Pattern 1

Always do X when Y.

## Pattern 2

Never do A because B.
```

### 5. Add Templates

Create template files that commands will use.

### 6. Register Skill

Add to `config.json`:
```json
"skills": {
  "installed": ["my-skill"]
}
```

## Sharing Skills

Skills can be:
- Included in project repo
- Shared via `/wogi-export` profile
- Published to skill repository (coming soon)
