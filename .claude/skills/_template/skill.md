---
name: _template
version: 1.0.0
description: Template for creating new skills - DO NOT LOAD
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: Claude Code 2.1+
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: {{DATE}}
learningCount: 0
successRate: 0
template: true
loadable: false
---

<!--
  ⚠️  THIS IS A TEMPLATE - DO NOT LOAD THIS SKILL

  To create a new skill, copy this directory and replace:
  - {{SKILL_NAME}} with your skill name
  - {{SHORT_DESCRIPTION}} with a brief description
  - {{USE_CASE_*}} with actual use cases
  - {{FILE_PATTERN_*}} with file globs
  - {{DATE}} with current date

  ## Frontmatter Fields (Claude Code 2.1.x aligned)

  Required:
  - name: Skill identifier (kebab-case)
  - description: Short description shown in slash command menu
  - scope: project | user (where skill applies)

  Claude Code 2.1.x fields:
  - user-invocable: true | false (controls /slash command visibility)
  - context: inline | fork (fork = isolated execution context)
  - agent: orchestrator | developer | reviewer | tester (persona mapping)
  - memory: project | user | local (persistent memory scope, Claude Code 2.1.33+)
  - allowed-tools: YAML list of tools the skill can use
    Example: [Read, Glob, Grep, Edit, Write, Bash(npm *), Bash(git *)]

  SKILL.md standard fields (cross-tool compatibility):
  - license: SPDX identifier (e.g., MIT, Apache-2.0)
  - compatibility: Environment/tool requirements (e.g., "Claude Code 2.1+")

  Optional:
  - lastUpdated: ISO date string
  - learningCount: Number of learnings captured
  - successRate: Historical success rate (0-1)
  - loadable: true | false (whether skill can be loaded)
  - template: true (only for _template skill)
-->

# {{SKILL_NAME}} Skill

## When to Use

- {{USE_CASE_1}}
- {{USE_CASE_2}}

## Quick Reference

### Key Patterns
- Pattern 1: Description
- Pattern 2: Description

### Common Mistakes to Avoid
- See `knowledge/anti-patterns.md` for details

## Progressive Content

Load these files when relevant:

| File | When to Load |
|------|--------------|
| `${CLAUDE_SKILL_DIR}/knowledge/learnings.md` | Starting a task with this skill |
| `${CLAUDE_SKILL_DIR}/knowledge/patterns.md` | Looking for examples |
| `${CLAUDE_SKILL_DIR}/knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `${CLAUDE_SKILL_DIR}/rules/conventions.md` | Writing new code |

## File Patterns

This skill applies to files matching:
- `{{FILE_PATTERN_1}}`
- `{{FILE_PATTERN_2}}`

## Commands

| Command | Description |
|---------|-------------|
| `/{{SKILL_NAME}}-{{ACTION}}` | Description |

## Integration

### Dependencies
- None

### Related Skills
- None
