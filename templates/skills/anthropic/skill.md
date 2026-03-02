---
name: anthropic
version: 1.0.0
description: "Anthropic SDK patterns for Claude API integration"
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: "Claude Code 2.1+"
source: prebuilt
prebuiltVersion: "1.0.0"
lastDocCheck: "2026-03-02"
context7: "/anthropics/anthropic-sdk-typescript"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: "2026-03-02"
learningCount: 0
successRate: 0
---

# anthropic Skill

Anthropic SDK patterns for Claude API integration.

## Triggers

- keywords: ["anthropic","claude","claude-api","messages","anthropic-sdk","claude-sdk","tool_use","content_block"]
- filePatterns: ["**/*anthropic*","**/*claude*","**/*ai-client*","**/*llm*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["ai","sdk","api"]

## When to Use

Load this skill when integrating with the Anthropic/Claude API.
Matches files: *anthropic*, *claude*, *ai-client*, *llm*

## Quick Reference

### Key Patterns
- **Messages API**: Use `client.messages.create()` with structured messages array
- **Tool Use**: Define tools with JSON Schema input_schema, handle tool_use content blocks
- **Streaming**: Use `client.messages.stream()` for real-time token output

### Common Mistakes to Avoid
- **Hardcoding API keys**: Use environment variables (`ANTHROPIC_API_KEY`)
- **Ignoring stop_reason**: Always check `stop_reason` to handle `end_turn`, `tool_use`, `max_tokens`

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
