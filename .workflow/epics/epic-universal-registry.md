# Epic: Universal Registry & Framework-Driven Scanner

## Overview
<!-- PIN: overview -->
Replace hardcoded file patterns with framework-driven discovery, and replace three fixed maps with an extensible registry system that adapts to any tech stack. Fixes Prisma multi-file schema scanning bug.

## Success Metrics
<!-- PIN: success-metrics -->
- [ ] Prisma multi-file schema patterns detected during onboarding (fixes reported bug)
- [ ] New registry types can be added without modifying core code (plugin architecture)
- [ ] All consuming systems (context loaders, quality gates, hooks, instructions) discover registries dynamically
- [ ] Backend frameworks (NestJS, Django, Go) get service/controller mapping

## Features
<!-- PIN: features -->
- Framework-driven file discovery (replaces hardcoded FILE_PATTERNS)
- Plugin-based extensible registry architecture
- Registry manifest for dynamic wiring
- Schema/model registry (Prisma, TypeORM, Django)
- Architecture/service registry (NestJS, Django, Go)

## Stories
<!-- PIN: stories -->

| # | Story ID | Title | Priority | Depends On | Status |
|---|----------|-------|----------|------------|--------|
| 1 | wf-fwk-discovery | Framework-Driven File Discovery | P1 | — | ready |
| 2 | wf-ext-registry | Extensible Registry Architecture + Manifest | P1 | Story 1 | ready |
| 3 | wf-manifest-wiring | Registry Manifest Wiring (46+ consuming systems) | P1 | Story 2 | ready |
| 4 | wf-schema-registry | Schema/Model Registry Plugin (fixes Prisma bug) | P1 | Story 2 | ready |
| 5 | wf-service-registry | Architecture/Service Registry Plugin | P2 | Story 2 | ready |

**Dependency graph:**
```
wf-fwk-discovery (1)
  └── wf-ext-registry (2)
        ├── wf-manifest-wiring (3)
        ├── wf-schema-registry (4)
        └── wf-service-registry (5)
```

Stories 3, 4, and 5 can run in parallel after Story 2 completes.

## Dependencies
<!-- PIN: dependencies -->
- None

## Status: ready
## Progress: 0%
## Created: 2026-02-21T10:20:45.472Z
## Updated: 2026-02-21T10:20:45.472Z
