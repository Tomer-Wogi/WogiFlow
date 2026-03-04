# Skill-Level Learning

Framework-specific patterns, anti-patterns, and skill creation.

---

## Overview

Skills encapsulate framework-specific knowledge:
- Best practices for React, NestJS, FastAPI, etc.
- Common anti-patterns to avoid
- Framework-specific code snippets
- Official documentation references

---

## Skill Structure

```
.claude/skills/
├── react/
│   ├── skill.md                  # Skill definition
│   └── knowledge/
│       ├── patterns.md           # Best practices
│       └── anti-patterns.md      # What to avoid
├── nestjs/
│   ├── skill.md
│   └── knowledge/
│       ├── patterns.md
│       └── anti-patterns.md
└── ...
```

---

## Configuration

```json
{
  "learning": {
    "skill": {
      "enabled": true,
      "autoExtract": true,
      "triggers": {
        "onCommit": true,
        "onTaskComplete": true,
        "onCompact": true
      },
      "minCorrectionsToLearn": 1,
      "autoCreateSkills": "ask",        // "ask" | "auto" | "off"
      "autoDetectFrameworks": true,
      "fetchOfficialDocs": true
    }
  },
  "skills": {
    "installed": ["react", "nestjs"]
  }
}
```

---

## Auto-Skill Creation

When a framework is detected but no skill exists:

```json
{
  "learning": {
    "skill": {
      "autoCreateSkills": "ask"    // Prompt before creating
    }
  }
}
```

### Options

| Value | Behavior |
|-------|----------|
| `"ask"` | Prompt user before creating |
| `"auto"` | Create automatically |
| `"off"` | Never auto-create |

### Creation Flow

```
Framework Detected: NestJS
         ↓
No existing skill found
         ↓
┌─────────────────────────────────────────┐
│ Create NestJS skill? [y/n]              │
│                                         │
│ This will create:                       │
│ - .claude/skills/nestjs/skill.md                │
│ - .claude/skills/nestjs/knowledge/patterns.md   │
│ - .claude/skills/nestjs/knowledge/anti-patterns.md
└─────────────────────────────────────────┘
         ↓
User confirms → Skill created
```

---

## Skill Definition (skill.md)

```markdown
# NestJS Skill

## Framework
NestJS - A progressive Node.js framework

## When Active
This skill applies when working with:
- `.module.ts` files
- `.controller.ts` files
- `.service.ts` files
- `@nestjs/*` imports

## Key Concepts
- Dependency injection via decorators
- Module-based architecture
- Guard/Interceptor/Pipe patterns

## Official Docs
https://docs.nestjs.com
```

---

## Pattern Files

### patterns.md

```markdown
# NestJS Patterns

## Module Organization

Every feature should have its own module:
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
```

## Service Layer

Keep controllers thin, put logic in services:
```typescript
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }
}
```

## DTOs

Always validate input with class-validator:
```typescript
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;
}
```
```

### anti-patterns.md

```markdown
# NestJS Anti-Patterns

## ❌ Business Logic in Controllers

Don't put business logic in controllers:
```typescript
// BAD
@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    // Logic here is wrong
    const user = { ...dto, createdAt: new Date() };
    return this.repo.save(user);
  }
}

// GOOD
@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}
```

## ❌ Circular Dependencies

Avoid circular module dependencies:
```typescript
// BAD: Module A imports B, B imports A

// GOOD: Use forwardRef() or restructure
@Module({
  imports: [forwardRef(() => ModuleB)]
})
export class ModuleA {}
```
```

---

## Pattern Extraction

When corrections relate to a framework:

1. **Detect Framework**: Match against installed skills
2. **Extract Pattern**: Identify the learning
3. **Route Appropriately**: Skill patterns vs project decisions
4. **Update Skill**: Add to patterns.md or anti-patterns.md

```
User: "In NestJS, services should be @Injectable"
         ↓
Detected: NestJS-specific correction
         ↓
Added to: .claude/skills/nestjs/knowledge/patterns.md
```

---

## Official Docs Integration

When `fetchOfficialDocs` is enabled:

```json
{
  "learning": {
    "skill": {
      "fetchOfficialDocs": true,
      "officialDocsUrls": {
        "nestjs": "https://docs.nestjs.com",
        "react": "https://react.dev"
      }
    }
  }
}
```

Benefits:
- Reference official patterns
- Stay updated with best practices
- Cite authoritative sources

---

## Manual Learning Trigger

```bash
/wogi-skill-learn

# Output:
# 🎓 Skill Learning Extraction
#
# Analyzing recent commits and corrections...
#
# Found patterns:
#   1. NestJS: Use ConfigService for env vars
#   2. React: Prefer named exports for components
#
# Add to skills? [y/n]
```

---

## Continual Learning Skills

Some skills continuously learn:

```markdown
# skill.md

## Continual Learning
This skill should:
- Track new patterns from corrections
- Update with latest best practices
- Learn from code review feedback
```

---

## Skill Activation

Skills activate based on context:

```
Working on src/users/users.module.ts
         ↓
Detect: NestJS module file
         ↓
Activate: nestjs skill
         ↓
Apply: NestJS patterns from skill
```

### Activation Triggers

| File Pattern | Skill Activated |
|--------------|-----------------|
| `*.tsx`, `*.jsx` | react |
| `*.module.ts`, `*.controller.ts` | nestjs |
| `*.vue` | vue |
| `main.py` + fastapi | fastapi |

---

## Custom Skills

Create project-specific skills:

```bash
mkdir -p .claude/skills/my-skill/knowledge

cat > .claude/skills/my-skill/skill.md << 'EOF'
# My Custom Skill

## When Active
When working with internal-api patterns

## Key Concepts
- All API calls must use v2 endpoint
- Auth tokens must be refreshed
EOF

cat > .claude/skills/my-skill/knowledge/patterns.md << 'EOF'
# Internal API Patterns

## V2 Endpoints
Always use v2 API endpoints:
```typescript
const response = await api.get('/api/v2/users');
```
EOF
```

Add to config:
```json
{
  "skills": {
    "installed": ["my-skill"]
  }
}
```

---

## Related

- [Project Learning](./project-learning.md) - Project-specific patterns
- [Model Learning](./model-learning.md) - Per-model optimization
- [Framework Detection](../01-setup-onboarding/framework-detection.md)
