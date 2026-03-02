---
name: openai
version: 1.0.0
description: "OpenAI SDK patterns for GPT and assistants integration"
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
context7: "/openai/openai-node"
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

# openai Skill

OpenAI SDK patterns for GPT and assistants integration.

## Triggers

- keywords: ["openai","gpt","gpt-4","gpt-4o","chatgpt","openai-sdk","chat.completions","assistants","dall-e","whisper"]
- filePatterns: ["**/*openai*","**/*gpt*","**/*chat-completion*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["ai","sdk","api"]

## When to Use

Load this skill when integrating with the OpenAI API.
Matches files: *openai*, *gpt*, *chat-completion*

## Quick Reference

### Key Patterns
- **Chat Completions**: Use `client.chat.completions.create()` with messages array
- **Function Calling**: Define functions with JSON Schema parameters, handle `tool_calls` in response
- **Streaming**: Use `stream: true` and iterate over chunks

### Common Mistakes to Avoid
- **Hardcoding API keys**: Use environment variables (`OPENAI_API_KEY`)
- **Ignoring finish_reason**: Always check for `stop`, `tool_calls`, `length` to handle different outcomes

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
