# Feature Dossiers

Per-feature canonical knowledge docs with mechanical auto-injection. This directory is the single source of truth for non-obvious feature state — the stuff that isn't captured by `app-map.md`, `function-map.md`, or commit messages.

## Why this exists

`app-map.md` / `function-map.md` / `api-map.md` capture structural knowledge (what components exist, what functions exist, what endpoints exist). They do not capture:

- Owner-rejected design alternatives ("we tried stack-two-components, rejected")
- Removed elements the codebase must not reintroduce ("no contact-person block — every person needs a seat")
- Cross-repo contracts ("BE returns Decimal as string, FE parses")
- Known global-state bugs ("Jira integration persists tags across customers")
- The two mockup variants the owner saw and which one they picked

That's what dossiers capture. One file per user-facing feature.

## Workspace vs per-repo

| Location | Scope | Used for |
|----------|-------|----------|
| `$WOGI_WORKSPACE_ROOT/.workspace/dossiers/` | Cross-repo feature (spans BE+FE) | Features whose decisions span multiple repos in a workspace |
| `<repo>/.workflow/dossiers/` | Per-repo feature | Features local to one repo |

Both are read at match time. Workspace shadows repo on slug collision — workspace is the shared truth.

## Files in this directory

| File | Purpose |
|------|---------|
| `<slug>.md` | Per-feature dossier (one file per feature) |
| `index.json` | Registry mapping routes / components / file-globs / keywords → slugs |
| `_template.md` | Template copied by `flow feature-dossier scaffold` |
| `_logic-rules.md` | Cross-cutting logic rules that span features |
| `README.md` | This file |

## Dossier structure

Every dossier has these sections:

- **Canonical Summary** — one paragraph. What this feature IS today.
- **Match Patterns** — how the auto-matcher recognizes tasks touching this feature.
- **Contracts** — DTO / API / cross-repo agreements.
- **Logic Rules** — feature-scoped rules. Cross-cutting rules go in `_logic-rules.md`.
- **Rejected Alternatives** — owner-rejected designs. Any spec that proposes these is a contradiction and will be blocked at spec phase.
- **Removed Elements** — things the owner told us to remove. `detectDrift` greps the codebase for these; if they reappear, you see drift.
- **Known Bugs / Tech Debt** — open issues linked to task IDs.
- **Change Log** — append-only. One row per task that touched the feature.

## CLI

```bash
flow feature-dossier list
flow feature-dossier scaffold services-integrations --title "Services + Integrations" --owners "fe,be"
flow feature-dossier show services-integrations
flow feature-dossier match --title "merge services and integrations card" --files "src/pages/Services.tsx"
flow feature-dossier touch services-integrations --task wf-aa350e26 --type merge-shipped --note "Correct variant"
flow feature-dossier drift services-integrations
flow feature-dossier validate services-integrations --spec .workflow/changes/*/wf-xxx.md

flow logic-rules list
flow logic-rules match --files "src/pages/Customer.tsx"
flow logic-rules propagate every-person-needs-seat --origin "src/pages/Customer.tsx"
flow logic-rules scan
```

## Auto-injection contract

At phase transitions (exploring / spec_review / coding), the hook:

1. Loads the active task's title + description + files-touched.
2. Runs `matchFeatures()` and `matchRulesForFiles()`.
3. Injects the top dossiers' canonical/contracts/rejected/removed sections into phase context.
4. Injects matched logic rules.

Unlike feedback-patterns.md (which is an index that Claude is supposed to re-read), dossier content is injected **into** the prompt — Claude can't skip it.

## Spec contradiction gate

During spec-review, `validateSpecAgainstDossier()` scans the spec text for mentions of rejected alternatives or removed elements. Any match blocks spec approval with the dossier citation. This is the mechanical enforcement layer.

## Drift detection

`flow feature-dossier drift <slug>` greps the codebase for every `enforcement-grep` regex listed under Removed Elements. Finds the contact-person case: dossier says "removed", code still has it. Run on session start or manually.
