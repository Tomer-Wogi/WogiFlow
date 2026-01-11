# Framework Detection

Auto-detect tech stack and suggest relevant skills.

---

## Purpose

Framework detection enables:
- **Skill Suggestions**: Recommend framework-specific skills
- **Pattern Recognition**: Apply framework best practices
- **Documentation Fetching**: Retrieve official docs for reference
- **Hybrid Mode Optimization**: Configure for specific frameworks

---

## Detected Frameworks

### JavaScript/TypeScript

| Framework | Detection Method |
|-----------|-----------------|
| Next.js | `next` in package.json, `next.config.js` |
| React | `react` in package.json |
| React Native | `react-native` in package.json |
| Vue | `vue` in package.json |
| Nuxt | `nuxt.config.js` or `nuxt.config.ts` |
| Angular | `@angular/core`, `angular.json` |
| NestJS | `@nestjs/core`, `nest-cli.json` |
| Express | `express` in package.json |
| Fastify | `fastify` in package.json |

### Python

| Framework | Detection Method |
|-----------|-----------------|
| FastAPI | `fastapi` in requirements.txt |
| Django | `django` in requirements.txt |
| Flask | `flask` in requirements.txt |

### Other Languages

| Language | Detection Method |
|----------|-----------------|
| Go | `go.mod` file |
| Rust | `Cargo.toml` file |
| Java | `pom.xml` or `build.gradle` |

---

## Configuration

```json
{
  "skillLearning": {
    "enabled": true,
    "autoDetectFrameworks": true,
    "fetchOfficialDocs": true,
    "frameworkDetectionPatterns": {
      "nestjs": ["*.module.ts", "*.controller.ts", "*.service.ts", "@nestjs/*"],
      "react": ["*.tsx", "*.jsx", "use*.ts", "react", "react-dom"],
      "vue": ["*.vue", "vue", "@vue/*"],
      "angular": ["*.component.ts", "*.module.ts", "@angular/*"],
      "fastapi": ["main.py", "fastapi", "pydantic"],
      "django": ["manage.py", "django", "settings.py"],
      "express": ["app.js", "express", "router.js"]
    },
    "officialDocsUrls": {
      "nestjs": "https://docs.nestjs.com",
      "react": "https://react.dev",
      "vue": "https://vuejs.org/guide",
      "angular": "https://angular.io/docs",
      "fastapi": "https://fastapi.tiangolo.com",
      "django": "https://docs.djangoproject.com",
      "express": "https://expressjs.com/en/guide"
    }
  }
}
```

---

## Detection Process

```
┌─────────────────────────────────────────────────────────────┐
│                  FRAMEWORK DETECTION                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Check Package Files                                    │
│      ├─ package.json → JS/TS frameworks                    │
│      ├─ requirements.txt → Python frameworks               │
│      ├─ go.mod → Go                                        │
│      └─ Cargo.toml → Rust                                  │
│                                                             │
│   2. Check Config Files                                     │
│      ├─ next.config.js → Next.js                          │
│      ├─ nest-cli.json → NestJS                            │
│      ├─ angular.json → Angular                            │
│      └─ nuxt.config.ts → Nuxt                             │
│                                                             │
│   3. Scan File Patterns                                     │
│      ├─ *.module.ts → NestJS                              │
│      ├─ *.tsx → React                                     │
│      └─ *.vue → Vue                                        │
│                                                             │
│   4. Suggest Skills                                         │
│      └─ Map framework → skill package                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Skill Suggestions

When a framework is detected:

```bash
./scripts/flow onboard

# Output:
# Detected:
#   Language:  TypeScript
#   Framework: NestJS
#
# ✓ Recommended skill: nestjs
```

Skills are auto-added to config:
```json
{
  "skills": {
    "installed": ["nestjs"]
  }
}
```

### Framework → Skill Mapping

| Framework | Skill |
|-----------|-------|
| NestJS | `nestjs` |
| React, Next.js, React Native | `react` |
| FastAPI, Django, Flask | `python` |

---

## Official Documentation

When `fetchOfficialDocs` is enabled, WogiFlow can reference official documentation:

```json
{
  "skillLearning": {
    "fetchOfficialDocs": true,
    "officialDocsUrls": {
      "nestjs": "https://docs.nestjs.com",
      "react": "https://react.dev"
    }
  }
}
```

This enables:
- Citing official patterns
- Referencing best practices
- Staying up-to-date with conventions

---

## Customizing Detection

### Add Custom Patterns

```json
{
  "skillLearning": {
    "frameworkDetectionPatterns": {
      "my-framework": ["*.mf.ts", "my-framework-config.json"]
    }
  }
}
```

### Add Custom Docs URL

```json
{
  "skillLearning": {
    "officialDocsUrls": {
      "my-framework": "https://docs.my-framework.io"
    }
  }
}
```

---

## Database Detection

Also detects databases:

| Database | Detection Method |
|----------|-----------------|
| TypeORM | `typeorm` in package.json |
| Prisma | `prisma` in package.json |
| MongoDB | `mongoose` in package.json |
| Sequelize | `sequelize` in package.json |
| PostgreSQL | In docker-compose.yml |
| MySQL | In docker-compose.yml |
| Redis | In docker-compose.yml |

Output stored in `decisions.md`:
```markdown
## Tech Stack
- **Database**: PostgreSQL (Prisma)
```

---

## Language Detection

Priority order:
1. `tsconfig.json` → TypeScript
2. `package.json` → JavaScript
3. `requirements.txt`, `setup.py`, `pyproject.toml` → Python
4. `go.mod` → Go
5. `Cargo.toml` → Rust
6. `pom.xml`, `build.gradle` → Java

---

## Multi-Framework Projects

For monorepos or multi-framework projects:

```
project/
├── frontend/        # Next.js
│   └── package.json
├── backend/         # NestJS
│   └── package.json
└── mobile/          # React Native
    └── package.json
```

Run onboarding from root:
```bash
./scripts/flow onboard
# Detects: Next.js, NestJS, React Native
```

Multiple skills suggested:
```json
{
  "skills": {
    "installed": ["react", "nestjs"]
  }
}
```

---

## Related

- [Onboarding](./onboarding-existing.md) - Full onboarding process
- [Skills System](../03-self-improvement/skill-learning.md) - How skills work
- [Configuration Reference](../configuration/all-options.md) - All options
