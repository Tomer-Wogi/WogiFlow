# Story: Framework-Driven File Discovery

**ID**: wf-fwk-discovery
**Epic**: epic-universal-registry
**Type**: story
**Priority**: P1
**Feature**: scanner

## User Story

As a WogiFlow user with any tech stack,
I want the scanner to automatically discover framework-specific files based on my detected packages,
So that patterns like Prisma multi-file schemas, Django models, or NestJS decorators are not missed.

## Description

The pattern extractor (`flow-pattern-extractor.js`) currently uses a hardcoded `FILE_PATTERNS` object that only covers 6 language extensions (`.js`, `.jsx`, `.mjs`, `.ts`, `.tsx`, `.py`, `.go`, `.rs`, `.java`). Framework-specific files like `.prisma`, `.sql`, `*.controller.ts`, `models.py` are never scanned.

The fix: create a `FrameworkFileResolver` that takes the output of `detectStack()` (which already identifies Prisma, Django, NestJS, etc. from package.json/requirements.txt) and returns additional file patterns to scan.

## Acceptance Criteria

### Scenario 1: Prisma project gets .prisma files scanned
Given a project with `prisma` or `@prisma/client` in package.json
When the pattern extractor runs during onboarding
Then `.prisma` files in `prisma/` directory are included in the scan

### Scenario 2: Django project gets model/view files prioritized
Given a project with `django` in requirements.txt
When the pattern extractor runs
Then `models.py`, `views.py`, `serializers.py`, `admin.py`, `urls.py` patterns are added to scan targets

### Scenario 3: NestJS project gets decorator files targeted
Given a project with `@nestjs/core` in package.json
When the pattern extractor runs
Then `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.middleware.ts` patterns are added

### Scenario 4: Go project gets handler/interface patterns
Given a project with `go.mod` detected
When the pattern extractor runs
Then `*_handler.go`, `*_service.go`, `*_repository.go` patterns are added

### Scenario 5: Backwards compatibility preserved
Given a project with no special frameworks
When the pattern extractor runs
Then default FILE_PATTERNS behavior is unchanged

### Scenario 6: Multiple frameworks combine patterns
Given a project with both Prisma AND NestJS
When the pattern extractor runs
Then both Prisma and NestJS file patterns are included

## Technical Notes

### Components
- **New**: `scripts/flow-framework-resolver.js` — Maps stack → file patterns
- **Modify**: `scripts/flow-pattern-extractor.js` — Call resolver instead of hardcoded FILE_PATTERNS
- **Modify**: `scripts/flow-context-init.js` — Export stack info for resolver consumption

### Framework-to-Pattern Mapping (initial set)

```javascript
const FRAMEWORK_PATTERNS = {
  // ORM/Database
  'Prisma': {
    patterns: ['prisma/**/*.prisma', 'prisma/migrations/**/*.sql'],
    category: 'database'
  },
  'TypeORM': {
    patterns: ['**/*.entity.ts', '**/*.migration.ts'],
    category: 'database'
  },
  'Sequelize': {
    patterns: ['**/*.model.js', '**/models/**/*.js', '**/migrations/**/*.js'],
    category: 'database'
  },
  'Drizzle': {
    patterns: ['**/*.schema.ts', '**/drizzle/**/*.ts'],
    category: 'database'
  },

  // Backend frameworks
  'NestJS': {
    patterns: ['**/*.controller.ts', '**/*.service.ts', '**/*.module.ts', '**/*.guard.ts', '**/*.middleware.ts', '**/*.dto.ts'],
    category: 'architecture'
  },
  'Django': {
    patterns: ['**/models.py', '**/views.py', '**/serializers.py', '**/admin.py', '**/urls.py', '**/forms.py', '**/middleware.py'],
    category: 'architecture'
  },
  'FastAPI': {
    patterns: ['**/routers/**/*.py', '**/schemas/**/*.py', '**/models/**/*.py', '**/dependencies/**/*.py'],
    category: 'architecture'
  },
  'Flask': {
    patterns: ['**/routes/**/*.py', '**/models/**/*.py', '**/blueprints/**/*.py'],
    category: 'architecture'
  },

  // Go
  'Go': {
    patterns: ['**/*_handler.go', '**/*_service.go', '**/*_repository.go', '**/*_middleware.go'],
    category: 'architecture'
  },

  // Rust
  'Rust': {
    patterns: ['**/mod.rs', '**/lib.rs'],
    category: 'architecture'
  }
};
```

### Design Principle
The resolver is purely additive — it adds patterns ON TOP of the base FILE_PATTERNS, never removes them. This ensures backwards compatibility.

## Boundaries

Do NOT modify:
- `.workflow/state/ready.json` (only at task start/end)
- `.workflow/config.json` (no config changes in this story)
- `lib/installer.js`
- Any `.md` command files

## Dependencies

- None (this is the foundation story)

## Complexity

Medium — New module + integration into existing scanner. No breaking changes.
