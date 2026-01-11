---
name: react
version: 1.0.0
description: React component patterns, hooks, and best practices
scope: project
user-invocable: true
context: inline
agent: developer
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(npm *)
  - Bash(npx *)
lastUpdated: 2026-01-11
learningCount: 0
successRate: 0
loadable: false
status: coming-soon
---

# React Skill

React component patterns, hooks, and best practices.

## Status

🚧 **Coming Soon** - This skill is under development.

## Triggers

- keywords: ["react", "react-component", "react-hook", "useState", "useEffect", "useContext", "useMemo", "useCallback", "useRef", "jsx", "tsx", "props", "state-management"]
- filePatterns: ["*.tsx", "*.jsx", "use*.ts", "use*.tsx", "*.component.tsx"]
- taskTypes: ["feature", "bugfix", "refactor"]
- categories: ["react", "frontend-framework"]

## Planned Commands

| Command | Description |
|---------|-------------|
| `/react-component [name]` | Create React component with tests |
| `/react-hook [name]` | Create custom hook |
| `/react-context [name]` | Create context provider |

## Planned Templates

- Functional component
- Custom hook
- Context provider
- Test file

## Contributing

Want to help build this skill? Create a PR with:
- Commands in `commands/`
- Rules in `rules/`
- Templates in `templates/`
