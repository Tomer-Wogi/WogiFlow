# <Feature Title>

<!-- slug: <kebab-slug> -->
<!-- status: active -->
<!-- owners: fe, be -->
<!-- created: YYYY-MM-DD -->

## Canonical Summary

<One paragraph. What this feature IS today. Replace when the owner revises scope.>

## Match Patterns

<!-- Auto-match patterns. Any task whose title/description/files match will auto-load this dossier. -->
- route: /some/route
- file: src/pages/Something*
- keyword: <phrase that identifies this feature in prose>
- component: SomeComponent

## Contracts

<!-- DTO / API / cross-repo agreements. One bullet per contract. -->
- <describe contract>

## Logic Rules

<!-- Feature-scoped rules. For cross-cutting rules, use _logic-rules.md instead. -->
- <describe rule>

## Rejected Alternatives

<!-- Owner-rejected designs. Any future spec matching one of these is blocked at spec phase.
     Format: "<date>: <alternative name> → REJECTED, reason: <why>" -->
- <date>: <alternative name> → REJECTED, reason: <why>

## Removed Elements

<!-- Things the owner told us to remove. The drift detector greps the codebase for these.
     Format: "<date>: <element> → removed, reason: <why>, enforcement-grep: `<regex>`" -->
- <date>: <element> → removed, reason: <why>, enforcement-grep: `<regex>`

## Known Bugs / Tech Debt

<!-- Active bugs or deferred fixes. Link to task IDs. -->
- <describe bug> — task: wf-xxxxxxxx

## Change Log

<!-- Append-only. One row per task that touched this feature. Populated by `flow feature-dossier touch`. -->

| Date | Task ID | Event | Note |
|------|---------|-------|------|
