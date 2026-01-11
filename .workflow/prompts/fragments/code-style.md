---
id: code-style
purpose: quality
order: 20
models: all
cli: all
description: Code style and conventions
---

# Code Style Guidelines

Follow these coding conventions:

## General
- Write clean, readable code with meaningful names
- Keep functions small and focused (single responsibility)
- Add comments only when the logic isn't self-evident

## TypeScript/JavaScript
- Use TypeScript for all new files when available
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw promises
- Destructure when it improves readability

## File Organization
- One component/class per file
- Group imports: external, internal, relative
- Export from index files when appropriate
