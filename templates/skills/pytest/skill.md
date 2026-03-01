---
name: pytest
version: 1.0.0
description: "pytest testing patterns, fixtures, and parametrize"
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: "Claude Code 2.1+"
source: prebuilt
prebuiltVersion: "1.0.0"
lastDocCheck: "2026-03-01"
context7: "/nicepkg/docs.pytest.org"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: "2026-03-01"
learningCount: 0
successRate: 0
---

# pytest Skill

pytest testing patterns, fixtures, and parametrize.

## Triggers

- keywords: ["pytest","test","fixture","parametrize","conftest","assert","mark","monkeypatch"]
- filePatterns: ["test_*.py","*_test.py","tests/**/*.py","conftest.py","pytest.ini","pyproject.toml"]
- taskTypes: ["feature","bugfix"]
- categories: ["testing","python"]

## When to Use

Load this skill when working with pytest in the project.
Matches files: test_*.py, *_test.py, tests/**/*.py, conftest.py, pytest.ini, pyproject.toml

## Quick Reference

### Key Patterns
- **Fixtures for Setup/Teardown**: Fixtures handle setup/teardown, are composable, and scoped (function/class/module/session)
- **Parametrize for Data-Driven Tests**: One test function covers multiple cases without code duplication

### Common Mistakes to Avoid
- **Overly Broad Fixtures**: Session-scoped fixtures that set up too much

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
