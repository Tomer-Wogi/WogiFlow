# /wogi-roadmap - Roadmap Management

View and manage the project roadmap for deferred work and future phases.

## Usage

```
/wogi-roadmap                    # Show roadmap summary
/wogi-roadmap add "title"        # Add item to roadmap
/wogi-roadmap validate "title"   # Validate dependencies before implementing
/wogi-roadmap promote "title"    # Move item to ready.json as a story
```

## When to Use

- **View deferred work**: See what's planned for later
- **Add deferred phases**: When breaking large features into phases
- **Before implementing**: Validate dependencies are still valid
- **Promote to active**: When ready to implement a deferred item

## Steps

### Show Roadmap (Default)

1. Read `.workflow/roadmap.md`
2. Parse phases: Now, Next, Later, Ideas, Completed
3. Display summary with item counts per phase
4. Show dependencies for items in Later phase

**Output format:**
```
==================================================
        Project Roadmap
==================================================

> Now (Current Focus) (2)
    Authentication system ← Phase 0: Setup
    User profile page

- Next (Ready to Plan) (3)
    Password reset flow ← Phase 1: Auth
    Email verification
    OAuth integration ← Phase 1: Auth

o Later (Future Phases) (4)
    Two-factor auth ← Phase 2: Security
    Session management ← Phase 2: Security
    API rate limiting
    Audit logging ← Phase 3: Compliance

? Ideas (Exploration) (1)
    Single sign-on

File: .workflow/roadmap.md
Commands: add, validate, promote, move
```

### Add Item

When user runs `/wogi-roadmap add "Feature name"`:

1. Parse optional flags:
   - `--phase=<now|next|later|ideas>` (default: later)
   - `--depends="Parent phase"`
   - `--assumes="assumption1, assumption2"`
   - `--files="path/to/file.ts, other/file.ts"`

2. Create item block:
```markdown
### [Feature Name]

**Status:** Deferred
**Created:** [TODAY]
**Depends On:** [from --depends or ask user]

**Assumes:**
- [from --assumes or ask user]

**Key Files:**
- [from --files or ask user]

**Context When Deferred:**
[Ask user or infer from current work]

**Implementation Plan:**
1. [Ask user]
```

3. Insert into appropriate phase section in `.workflow/roadmap.md`

4. Confirm: "Added '[Feature]' to [phase] phase"

### Validate Item

When user runs `/wogi-roadmap validate "Feature name"`:

1. Find the item in roadmap.md
2. Check each dependency:

   **Depends On:**
   - Is parent phase/feature marked complete?
   - Check both roadmap.md (Completed section) and ready.json (recentlyCompleted)

   **Key Files:**
   - Do the listed files still exist?
   - (Advanced) Do they still have expected exports/interfaces?

   **Assumes:**
   - Flag assumptions for AI review
   - Look for contradicting patterns in codebase

3. Report results:

**If valid:**
```
Validating: OAuth integration

+ All dependencies valid
+ Ready to implement
```

**If issues found:**
```
Validating: OAuth integration

Issues (blocking):
  - Key file not found: src/auth/jwt.ts

Warnings (review recommended):
  - Dependency not marked complete: Phase 1: Auth
  - Assumption needs verification: Using JWT tokens

Cannot proceed until issues are resolved.
```

### Promote Item

When user runs `/wogi-roadmap promote "Feature name"`:

1. Validate the item first (run validate step)
2. If validation fails, show issues and ask to proceed anyway
3. If valid (or user confirms):
   - Extract implementation plan
   - Run `/wogi-story "[Feature name]"` to create story
   - Move item to "Completed" section in roadmap
   - Add note: "Promoted to story on [DATE]"

### Move Item

When user runs `/wogi-roadmap move "Feature" --to=next`:

1. Find item in current phase
2. Remove from current location
3. Insert into target phase
4. Confirm: "Moved '[Feature]' from [old] to [new]"

## AI Behavior Integration

### When User Requests Large Feature

If you detect a request that would require 5+ tasks or multiple phases:

1. Break down into phases
2. Present breakdown to user
3. If user agrees to defer later phases:
   ```javascript
   // For each deferred phase:
   const item = {
     title: "Phase N: Feature description",
     dependsOn: "Phase N-1: Previous phase",
     assumes: [
       "Key assumption from current implementation",
       "Another architectural decision"
     ],
     keyFiles: [
       "src/relevant/file.ts - Contains X interface",
       "src/other/file.ts - Has Y dependency"
     ],
     context: "Current state description",
     plan: ["Step 1", "Step 2", "Step 3"]
   };

   // Add to roadmap
   const { addItem } = require('./scripts/flow-roadmap');
   addItem(item, 'later');
   ```

4. Inform user: "Added N items to your roadmap. Run `/wogi-roadmap` to see them."

### When Modifying Key Files

Before modifying any file, check if it's listed in roadmap items:

```javascript
const { parseRoadmap } = require('./scripts/flow-roadmap');
const roadmap = parseRoadmap();

// Collect all key files from all phases
const keyFiles = [];
for (const [phase, items] of Object.entries(roadmap.phases)) {
  for (const item of items) {
    if (item.keyFiles) {
      keyFiles.push(...item.keyFiles.map(f => ({
        file: f,
        item: item.title,
        phase
      })));
    }
  }
}

// Check if target file is in list
const affected = keyFiles.filter(k =>
  k.file.includes(targetFile) || targetFile.includes(k.file.split(' - ')[0])
);

if (affected.length > 0) {
  // Warn user
}
```

## If Roadmap Doesn't Exist

```
No roadmap found for this project.

Would you like me to create one? This helps track:
- Deferred work from large features
- Future phases and their dependencies
- Ideas for later exploration

[Yes, create roadmap] [No thanks]
```

If yes, copy template from `templates/roadmap.md` to `.workflow/roadmap.md`.

## Related Commands

- `/wogi-story` - Create detailed story with acceptance criteria
- `/wogi-ready` - View tasks ready to implement
- `/wogi-status` - Overall project status
