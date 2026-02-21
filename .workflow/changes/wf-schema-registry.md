# Story: Schema/Model Registry Plugin

**ID**: wf-schema-registry
**Epic**: epic-universal-registry
**Type**: story
**Priority**: P1
**Feature**: scanner

## User Story

As a developer using Prisma (or any ORM),
I want WogiFlow to detect and track my database schema structure, models, and relations,
So that code generation respects my schema organization (like multi-file Prisma schemas).

## Description

This is the first new registry plugin, directly fixing the reported bug: WogiFlow's onboarding scanner misses Prisma multi-file schema patterns. The scanner currently detects Prisma from package.json but never reads `.prisma` files.

This story creates a `SchemaRegistry` plugin that:
- Parses Prisma schema files (single and multi-file)
- Detects preview features like `prismaSchemaFolder`
- Registers models, fields, relations, enums in `schema-map.md`
- Generates project rules for schema organization in `decisions.md`
- Supports TypeORM entities and Django models as secondary targets

## Acceptance Criteria

### Scenario 1: Multi-file Prisma schema detected and recorded
Given a project using `prismaSchemaFolder` preview feature
When the schema registry scans during onboarding
Then multi-file schema structure is detected and recorded as a project rule in decisions.md
And each model file is registered in schema-map.md

### Scenario 2: Single-file Prisma schema scanned
Given a standard Prisma project with one `schema.prisma`
When the schema registry scans
Then all models, enums, and their fields are registered in schema-map.md

### Scenario 3: Prisma preview features captured
Given a schema.prisma with `previewFeatures = ["prismaSchemaFolder", "fullTextSearch"]`
When scanned
Then each preview feature is recorded in decisions.md under "Database Patterns"

### Scenario 4: Model relations tracked
Given models with `@relation` directives
When scanned
Then one-to-many, many-to-many, and one-to-one relations are captured in schema-map.md

### Scenario 5: Pruning removes deleted models
Given a model was previously registered but its schema file was deleted
When `prune()` runs
Then the model is removed from the registry

### Scenario 6: TypeORM entities detected
Given a TypeScript project using TypeORM with `@Entity()` decorators
When the schema registry scans
Then entities, columns, and relations are registered in schema-map.md

### Scenario 7: Plugin auto-activates when ORM detected
Given `detectStack()` returns `{orm: 'Prisma'}` or `{orm: 'TypeORM'}`
When RegistryManager checks activation
Then SchemaRegistry.activateWhen() returns true

## Technical Notes

### Components
- **New**: `scripts/registries/schema-registry.js` — Schema scanner plugin
- **New**: `.workflow/state/schema-map.md` — Human-readable schema documentation
- **New**: `.workflow/state/schema-index.json` — Machine-readable schema index
- **Modify**: `scripts/flow-registry-manager.js` — Register schema plugin

### Schema-Map Format

```markdown
# Schema Map

## Models

| Model | File | Fields | Relations | Indexes |
|-------|------|--------|-----------|---------|
| User | prisma/models/user.prisma | 8 | 3 (has many Post, has one Profile, has many Comment) | email (unique) |
| Post | prisma/models/post.prisma | 6 | 2 (belongs to User, has many Comment) | - |

## Enums

| Enum | Values | File |
|------|--------|------|
| Role | ADMIN, USER, MODERATOR | prisma/enums.prisma |

## Schema Structure

- Organization: **Multi-file** (prismaSchemaFolder)
- Preview Features: prismaSchemaFolder, fullTextSearch
- Provider: postgresql
```

### Prisma Parser Logic

```javascript
// Detect schema organization
function detectSchemaOrg(projectRoot) {
  const singleFile = path.join(projectRoot, 'prisma/schema.prisma');
  const schemaDir = path.join(projectRoot, 'prisma/schema');

  if (fs.existsSync(schemaDir)) return 'multi-file';
  if (fs.existsSync(singleFile)) return 'single-file';
  return null;
}

// Parse .prisma file for models
function parsePrismaFile(content) {
  const models = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  // Parse fields, @relation directives, @@index, @@unique
  // Parse generator blocks for previewFeatures
  // Parse datasource blocks for provider
}
```

## Boundaries

Do NOT modify:
- Existing map files (app-map.md, function-map.md, api-map.md)
- Core scanner base classes (use plugin interface)

## Dependencies

- **Depends on**: wf-ext-registry (needs plugin architecture)
- **Depends on**: wf-fwk-discovery (needs .prisma file patterns)

## Complexity

Medium — New plugin with Prisma-specific parsing. Clear input/output.
