# Skill Portability — Export to agentskills.io / Claude Code plugin

Phase 1B of the Continuous Code-Quality Initiative (epic `epic-quality-loop`,
task `wf-0342fc33`) adds a portable export path for WogiFlow skills. This
document explains what "portable" means in this context, how the portability
checker works, how to publish to either supported format, and why **import is
deliberately deferred**.

## What is a "portable" skill?

A WogiFlow skill is *portable* when its content runs unchanged in a Claude
Code (or agentskills.io–compatible) environment that does NOT have WogiFlow
installed. In practice that means:

- No references to `.workflow/` paths (state files, specs, dossiers, epics).
- No references to WogiFlow state files by name: `ready.json`,
  `feedback-patterns.md`, `decisions.md`, `app-map.md`, `function-map.md`,
  `api-map.md`.
- No mentions of WogiFlow-specific tooling: `flow-utils`, `./scripts/flow`,
  WogiFlow-specific `flow <subcommand>` invocations.
- No `/wogi-*` slash-command invocations.
- No `wogiflow-cloud` references (paid tier is out of scope for the OSS
  catalog).

Skills that legitimately depend on any of the above are **not** portable.
That's fine — they remain available in WogiFlow's own catalog (the
`Wogi-Git/wogi-flow-skills` registry), which is unaffected by this work.

## The `portable` manifest field

Every skill manifest gains an optional `portable: true|false` field. Default
is `false` — exports refuse skills that haven't opted in.

```yaml
---
name: my-skill
version: 1.0.0
description: ...
license: MIT
portable: true     # <-- new in Phase 1B
---
```

Setting `portable: true` only declares the intent. The portability checker
still runs and overrides the declaration if it finds WogiFlow-specific
references — fail-loud is the rule.

Setting `portable: false` explicitly short-circuits the checker and blocks
export. Use this when your skill has an implicit dependency on a project
convention the scanner can't detect.

## How the portability checker works

`lib/skill-portability.js` walks the skill directory and scans every
text-y file (`.md`, `.txt`, `.json`, `.yaml`, `.js`, `.ts`, `.sh`, etc.)
line by line. Each line is matched against a fixed set of blocker patterns;
matches become citations of the form `file:line — "<offending substring>"`.

Run the checker via the export CLI — it always runs first:

```bash
flow skill export my-skill
# → succeeds, or prints the citation list and exits 1.
```

## Two-catalog principle

WogiFlow maintains two parallel skill catalogs:

| Catalog | Holds | Distribution |
|---------|-------|--------------|
| **WogiFlow registry** (`Wogi-Git/wogi-flow-skills`) | All skills, portable or not | `flow skill add <name>` |
| **agentskills.io / Claude Code plugins** | *Portable subset only* | `flow skill export <name>` |

The WogiFlow registry stays canonical for non-portable skills that depend on
WogiFlow-specific paths or commands. Phase 1B adds export *alongside* the
existing registry — it never replaces it.

## Publishing to agentskills.io

```bash
flow skill export my-skill --format=agentskills@v1
```

Output (default `dist/skills/my-skill/`):

```
dist/skills/my-skill/
├── manifest.json        # agentskills@v1 manifest (schemaVersion pinned)
├── skill.md             # the skill itself
├── knowledge/...        # bundled aux files
└── templates/...
```

Manifest shape (pinned to `schemaVersion: "agentskills@v1"`):

```json
{
  "schemaVersion": "agentskills@v1",
  "name": "my-skill",
  "version": "1.0.0",
  "description": "...",
  "license": "MIT",
  "compatibility": "Claude Code 2.1+",
  "instructions": "<post-frontmatter body of skill.md>",
  "source": { "type": "wogiflow" },
  "files": ["skill.md", "knowledge/learnings.md"],
  "dependencies": []
}
```

Note: this module operates offline. We do not fetch the agentskills.io v1
schema at export time. Our serializer pins `schemaVersion` to a known
identifier so a future CI contract test (Phase 1B acceptance criterion) can
catch drift once the network gate is built. Until then, this is our
authoritative interpretation of the v1 shape; see `lib/skill-export-agentskills.js`
header comment.

## Publishing as a Claude Code plugin

```bash
flow skill export my-skill --format=claude-plugin
```

Output (default `dist/skills/my-skill/`):

```
dist/skills/my-skill/
├── .claude-plugin/
│   └── plugin.json      # Claude Code plugin manifest
└── skills/
    └── my-skill/
        ├── SKILL.md     # normalized from skill.md
        └── knowledge/...
```

This layout matches the convention used by shipping Claude Code plugins
(e.g., the official Figma plugin). It is ready for the
`claude plugin tag` distribution path (Claude Code 2.1.118+).

## Why import is deferred

The Phase 1B spec explicitly defers `flow skill import <archive>` to a
follow-up. Reason: importing third-party skills means executing third-party
content under our existing tool-grant model. Even Markdown-only skills can
declare `allowed-tools` and ship templates that an agent will treat as
authoritative. Shipping import without a security model would mean either:

- Granting third-party skills our default tool surface (Read/Write/Edit/
  Glob/Grep/Bash) on first install — unsafe by default, breaks our
  no-surprise principle.
- Or stripping `allowed-tools` and re-prompting the user on every tool use
  — degraded UX that defeats the point of skills.

The right design is **quarantine + content scanner + opt-in enable**:

1. Imported skills land in `.claude/skills-quarantine/` (off the loader path).
2. A content scanner flags `allowed-tools`, scripts, bash invocations,
   and any reference to known sensitive paths for review.
3. The user explicitly promotes a skill out of quarantine after review.

That work needs a dedicated security-model spec and is the obvious next
phase after the catalog is seeded with safe exports.

The import insertion point in `scripts/flow-skill-export.js` is marked
with the comment `[import would go here]` so a future task can locate it
without grep.

## Which in-repo skills are portable?

At Phase 1B ship:

| Skill | Portable | Why |
|-------|----------|-----|
| `_template`            | yes | No WogiFlow refs; a clean template by design. |
| `conventional-commit`  | yes | Reusable across any git repo. |
| `figma-analyzer`       | no  | References `.workflow/state/`, `./scripts/flow figma`, `/wogi-flow`, and a WogiFlow MCP server (28 blockers). To make it portable, decouple from the WogiFlow component registry. |

The portability tag also shows up in `flow skill list` output as
`[portable]` for any installed skill whose local manifest carries
`portable: true`.

## Roadmap

- Phase 1B (this work) — export only. Two catalog separation. Portability
  checker is the single source of truth for "exportable".
- Follow-up (post-security-model) — `flow skill import` with quarantine.
- Phase 3 candidate — auto-flag drift when a portable skill picks up a
  WogiFlow-specific reference in a later edit (the same scanner, run via
  the registry-update gate).
