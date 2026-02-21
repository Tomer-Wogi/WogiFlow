Re-scan the project after external changes and sync WogiFlow state.

Usage: `/wogi-rescan`

## When to Use

- Other developers worked on the project while you weren't using WogiFlow
- New libraries or dependencies were added
- Code was refactored, files moved or renamed
- The project feels "out of sync" with what WogiFlow knows
- After a long break from the project
- After merging a large PR or branch

## Key Difference from `/wogi-onboard`

`/wogi-onboard` creates everything from scratch (fresh setup).
`/wogi-rescan` **diffs** the current codebase against existing WogiFlow state and **merges** changes intelligently — auto-adding what's new, flagging what's gone, and asking about conflicts one by one.

---

## What It Does

### Phase 1: Snapshot Current State

Display:
```
━━━ Phase 1/5: Reading Current WogiFlow State ━━━
```

1. **Load all existing state files as the "before" snapshot:**
   ```javascript
   const before = {
     stack: readFile('.workflow/context/stack.md'),
     decisions: readFile('.workflow/state/decisions.md'),
     appMap: readFile('.workflow/state/app-map.md'),
     functionMap: readFile('.workflow/state/function-map.md'),
     apiMap: readFile('.workflow/state/api-map.md'),
     skills: readDir('.claude/skills/'),
     config: readJSON('.workflow/config.json')
   };
   ```

2. **Record timestamps:**
   ```javascript
   const lastOnboard = before.config.project?.onboardedAt;
   const lastRescan = before.config.project?.lastRescanAt;
   const baseline = lastRescan || lastOnboard;
   ```

   Display:
   ```
     Last synced:           2026-01-15 (38 days ago)
     Known components:      24
     Known functions:       32
     Known API endpoints:   15
     Known patterns:        18
     Installed skills:      4 (nestjs, typeorm, jest, eslint)
   ```

---

### Phase 2: Fresh Scan (Non-Interactive — Same Analysis as Onboard Phases 1-2)

Display:
```
━━━ Phase 2/5: Scanning Current Codebase ━━━
```

3. **Run the same deep analysis as onboard:**
   - Stack detection via `flow-context-init.js`
   - Product scanning via `flow-product-scanner.js`
   - Pattern extraction in deep mode via `flow-pattern-extractor.js`
   - Temporal classification of patterns
   - Function scanning via `flow-function-index.js`
   - API scanning via `flow-api-index.js`
   - Component/app-map scanning
   - Template extraction via `flow-template-extractor.js`

   Display:
   ```
     Stack detection...     ✓ TypeScript + NestJS + PostgreSQL
     Pattern extraction...  ✓ Found 22 patterns across 10 categories
     Function scan...       ✓ Found 38 utility functions
     API scan...            ✓ Found 18 API endpoints
     Component scan...      ✓ Found 29 components/modules
     Template extraction... ✓ Found 5 templates
   ```

4. **Store as the "after" snapshot:**
   ```javascript
   const after = {
     stack: detectedStack,
     patterns: extractedPatterns,
     functions: scannedFunctions,
     apis: scannedAPIs,
     components: scannedComponents,
     templates: extractedTemplates,
     skills: detectRequiredSkills(detectedStack)
   };
   ```

---

### Phase 3: Diff & Classify Changes

Display:
```
━━━ Phase 3/5: Comparing Against Known State ━━━
```

5. **Diff each category and classify every change:**

   For each category (stack, patterns, components, functions, APIs, skills, templates):

   ```javascript
   function classifyChanges(before, after) {
     const changes = {
       added: [],      // In after but not before — NEW items
       removed: [],    // In before but not after — GONE items
       modified: [],   // In both but different — CHANGED items
       unchanged: []   // Identical in both
     };

     // ... diffing logic per category
     return changes;
   }
   ```

   **Classification rules:**

   | Change Type | Category | Action |
   |-------------|----------|--------|
   | NEW component/function/API | `added` | Auto-add (no conflict) |
   | NEW pattern (no existing conflict) | `added` | Auto-add (no conflict) |
   | NEW dependency in package.json | `added` | Auto-add + suggest skill |
   | REMOVED file (was in app-map) | `removed` | Auto-remove from maps |
   | REMOVED dependency | `removed` | Auto-remove skill if orphaned |
   | RENAMED file (similar content) | `modified` | Auto-update path in maps |
   | NEW pattern CONFLICTS with existing | `conflict` | Ask user |
   | Dependency REPLACED (e.g. Redux→Recoil) | `conflict` | Ask user |
   | Pattern changed (e.g. tabs→spaces) | `conflict` | Ask user |
   | Existing decision contradicted by new code | `conflict` | Ask user |
   | NEW component added, semantically similar to existing (configurable) | `conflict` | Ask user (merge or keep both) |

6. **Display diff summary:**
   ```
   ━━━ Changes Detected ━━━

   📦 Stack Changes:
      + Added: recoil@0.7.7
      + Added: @tanstack/react-query@5.0.0
      - Removed: redux@4.2.1
      ~ Changed: react 18.2.0 → 18.3.0

   📁 Components:
      + 5 new components found
      - 2 components removed (files deleted)
      ~ 3 components renamed/moved

   ⚙️ Functions:
      + 6 new utility functions
      - 1 function removed

   🌐 API Endpoints:
      + 3 new endpoints
      ~ 1 endpoint path changed

   📋 Patterns:
      + 2 new patterns detected
      ⚠ 3 conflicts with existing decisions

   🔧 Skills:
      + 2 new skills needed (recoil, react-query)
      - 1 skill no longer needed (redux)

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Auto-resolvable: 22 changes
   Conflicts requiring input: 3
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

---

### Phase 4: Resolve Conflicts (One by One)

Display:
```
━━━ Phase 4/5: Resolving Conflicts ━━━
```

7. **For EACH conflict, present it individually and wait for resolution:**

   **Conflict type: Dependency replacement**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "Detected a dependency change:\n\n" +
         "REMOVED: redux@4.2.1\n" +
         "ADDED: recoil@0.7.7\n\n" +
         "Current WogiFlow state has Redux skill and patterns.\n" +
         "What happened?",
       header: "Conflict 1/3",
       options: [
         { label: "Replaced", description: "Redux was replaced by Recoil — remove Redux skill/patterns, add Recoil" },
         { label: "Both exist", description: "Redux is still used somewhere, Recoil was added alongside it" },
         { label: "Recoil is temporary", description: "Recoil is experimental/POC — keep Redux as the standard" },
         { label: "Skip", description: "Decide later — keep current state unchanged for now" }
       ],
       multiSelect: false
     }]
   });
   ```

   **Conflict type: Pattern contradiction**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "Pattern conflict detected:\n\n" +
         "EXISTING RULE: \"Use class-based components for stateful logic\"\n" +
         "  (from decisions.md, established during onboard)\n\n" +
         "NEW EVIDENCE: 8 recently-created files use functional components with hooks\n" +
         "  Last seen: 2026-02-18 (3 days ago)\n\n" +
         "The codebase appears to have shifted. Which should the AI follow for NEW code?",
       header: "Conflict 2/3",
       options: [
         { label: "Update to new", description: "Functional + hooks is now the standard — update the rule" },
         { label: "Keep existing", description: "Class components are still preferred — the new code is an exception" },
         { label: "Migration in progress", description: "We're migrating from classes to hooks — use hooks for new code, leave old alone" },
         { label: "Skip", description: "Decide later — keep current rule unchanged for now" }
       ],
       multiSelect: false
     }]
   });
   ```

   **Conflict type: Convention changed**
   ```javascript
   AskUserQuestion({
     questions: [{
       question: "Convention change detected:\n\n" +
         "EXISTING RULE: \"API responses use { data, error, status } format\"\n\n" +
         "NEW EVIDENCE: 5 recent API endpoints use { result, message, code } format\n\n" +
         "Which response format should the AI use for NEW endpoints?",
       header: "Conflict 3/3",
       options: [
         { label: "New format", description: "{ result, message, code } is the new standard" },
         { label: "Old format", description: "{ data, error, status } is still correct — new endpoints need fixing" },
         { label: "Both valid", description: "Different contexts use different formats — ask case by case" },
         { label: "Skip", description: "Decide later — keep current convention unchanged for now" }
       ],
       multiSelect: false
     }]
   });
   ```

   **After each resolution**, record the decision and move to the next conflict.

   If user chose "Skip" for any conflict, leave the existing state unchanged and mark the conflict as deferred (can be revisited later via `/wogi-rescan --category`).

   If user chose "Other" (free-text), accept the explanation and parse intent to determine the appropriate action.

---

### Phase 5: Apply Changes & Generate Report

Display:
```
━━━ Phase 5/5: Applying Changes ━━━
```

8. **Apply all auto-resolved changes:**
   ```
     app-map.md...         ✓ +5 added, -2 removed, ~3 updated (29 total)
     function-map.md...    ✓ +6 added, -1 removed (37 total)
     api-map.md...         ✓ +3 added, ~1 updated (18 total)
     decisions.md...       ✓ +2 patterns added, ~3 updated from conflict resolution
     stack.md...           ✓ Updated dependency versions
   ```

9. **Apply conflict resolutions:**
   - Update decisions.md with resolved patterns
   - Mark migration-in-progress patterns with special format
   - Remove deprecated skill directories
   - Generate new skills for added dependencies

   ```
     Conflict resolutions... ✓ 3/3 applied
       → Redux skill removed, Recoil skill generated
       → "class components" rule updated to "functional + hooks"
       → API format rule updated with dual-format note
   ```

10. **Update config.json:**
    ```javascript
    config.project.lastRescanAt = new Date().toISOString();
    config.project.rescanCount = (config.project.rescanCount || 0) + 1;
    ```

11. **Generate new/updated skills:**
    For any newly detected frameworks, run the same skill generation as onboard Phase 5:
    - Fetch Context7 docs
    - Generate skill.md, patterns.md, anti-patterns.md
    - Remove skills for dependencies that are gone

    ```
      Skills updated:
        + recoil...            ✓ Skill generated (Context7 docs)
        + react-query...       ✓ Skill generated (Context7 docs)
        - redux...             ✓ Skill removed (dependency no longer present)
    ```

12. **Display final summary:**
    ```
    ━━━ Rescan Complete ━━━

    Changes applied:
      Components:   +5 added, -2 removed, ~3 moved     (24 → 29)
      Functions:    +6 added, -1 removed                 (32 → 37)
      API Endpoints: +3 added, ~1 updated                (15 → 18)
      Patterns:     +2 new, ~3 updated via resolution    (18 → 20)
      Skills:       +2 generated, -1 removed             (4 → 5)

    Conflicts resolved: 3/3
      → Redux → Recoil (replaced)
      → Class → Functional components (migration)
      → API response format (updated)

    Last synced: 2026-02-21 (just now)

    ╔═══════════════════════════════════════════════════════════════╗
    ║          WogiFlow state is now up to date!                    ║
    ╚═══════════════════════════════════════════════════════════════╝
    ```

13. **Log to request-log.md:**
    ```markdown
    ### R-[XXX] | [date]
    **Type**: change
    **Tags**: #rescan #sync
    **Request**: "Project rescan after external changes"
    **Result**: Synced WogiFlow state. +X added, -Y removed, ~Z updated. N conflicts resolved.
    **Files**: .workflow/state/ (all state files updated)
    ```

---

## Conflict Resolution Principles

### What counts as a conflict

A conflict exists when the **new scan** contradicts what WogiFlow **currently believes**. Specifically:

| Situation | Conflict? | Why |
|-----------|-----------|-----|
| New component added, no similar exists | No | Just add it |
| New component added, semantically similar to existing (configurable threshold) | Yes | User must decide: merge or keep both |
| Dependency removed from package.json | No | Auto-remove, clean up skill |
| Dependency replaced by alternative | Yes | User must confirm replacement |
| New pattern detected, no rule exists | No | Just add it |
| New pattern contradicts existing rule | Yes | User must decide which is correct |
| File renamed, content ~same | No | Auto-update path references |
| File deleted, was in app-map | No | Auto-remove from maps |
| Convention changed in recent code | Yes | User must confirm new convention |

### Resolution strategy

1. **Never silently overwrite existing decisions** — if a rule exists and new code contradicts it, the user decides
2. **Always auto-add genuinely new things** — no conflict means no question
3. **Always auto-remove genuinely gone things** — if a file doesn't exist, it shouldn't be in maps
4. **Present conflicts with full context** — show the existing rule, the new evidence, recency data
5. **One conflict at a time** — don't overwhelm with a wall of choices

---

## Options

### `--dry-run`
Show what would change without applying anything:
```
/wogi-rescan --dry-run
```

### `--auto-resolve`
Skip conflict prompts and auto-resolve using temporal analysis (newer wins):
```
/wogi-rescan --auto-resolve
```
Use with caution — best for teams where "latest code is always right."

**Note:** Dependency replacements (e.g., Redux→Recoil) still prompt the user even in `--auto-resolve` mode, because auto-resolving a library swap can break skill generation and pattern matching. Only pattern and convention conflicts are auto-resolved.

### `--category [name]`
Only rescan a specific category:
```
/wogi-rescan --category stack
/wogi-rescan --category patterns
/wogi-rescan --category components
/wogi-rescan --category functions
/wogi-rescan --category apis
```

### `--since [date]`
Only consider changes since a specific date:
```
/wogi-rescan --since 2026-02-01
```
Uses `git log --since` to scope the analysis to recent changes.

---

## Error Handling

### If pattern extraction fails
- Log warning, keep existing decisions.md unchanged
- Display: `Pattern extraction failed. Existing patterns preserved.`

### If scanner fails (function or API)
- Log warning, keep existing maps unchanged
- Display: `[Scanner] failed. Existing map preserved.`

### If Context7 unavailable (skill generation)
- Create placeholder skill, mark for later refresh
- Display: `Context7 unavailable. Placeholder skill created for [tech].`

### If no changes detected
- Display: `No changes detected since last sync. WogiFlow state is current.`
- Still update `lastRescanAt` timestamp

---

## When to Suggest Rescan

The AI should proactively suggest `/wogi-rescan` when:
- User mentions "other developers made changes"
- `git log` shows commits by other authors since last sync
- Package.json has new dependencies not in stack.md
- Morning briefing detects drift between state files and codebase

---

## CLI Equivalent

```bash
./scripts/flow rescan
./scripts/flow rescan --dry-run
./scripts/flow rescan --auto-resolve
```
