---
name: conventional-commit
version: 1.0.0
description: Format git commit messages following the Conventional Commits 1.0 specification
scope: project
user-invocable: true
context: inline
agent: developer
memory: project
license: MIT
compatibility: Claude Code 2.1+
portable: true
allowed-tools:
  - Read
  - Bash(git *)
lastUpdated: 2026-05-13
---

# Conventional Commit Skill

A reusable, project-agnostic skill that helps an agent compose
[Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/)
messages from the staged diff.

## When to Use

- The user asks to "commit" recent changes.
- An automated workflow wraps up and needs to record a commit.
- A patch series should be split into typed, scoped commits.

## Format

```
<type>(<scope>): <description>

[body]

[footer(s)]
```

| Type       | When to use |
|------------|-------------|
| `feat`     | New feature or capability |
| `fix`      | Bug fix |
| `docs`     | Documentation only |
| `style`    | Formatting, whitespace (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement |
| `test`     | Adding or updating tests |
| `chore`    | Build process, tooling, dependencies |

The optional `BREAKING CHANGE:` footer escalates the commit to a major bump
for tools that consume Conventional Commits (semantic-release, changelog
generators, etc.).

## Workflow

1. Read the staged diff with `git diff --staged`.
2. Classify the change against the type table above. If multiple types
   apply, split into multiple commits rather than mixing.
3. Choose a scope — usually a module name, directory, or feature area.
4. Draft a one-line description in the imperative mood (50 chars max).
5. If the change is non-obvious, add a body explaining the *why*.
6. Run the commit. Don't push.

## Output

The skill produces a commit message that an agent can pass to
`git commit -F -`. It does not run `git push`, does not edit code, and
does not touch the working tree.

## Why this skill is portable

This skill references no project-specific paths, state files, or slash
commands. It works in any git repository regardless of which AI workflow
framework is in use. That makes it a clean Phase 1B export target.
