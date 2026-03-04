# Development Tools

Features that accelerate specific development workflows.

---

## Overview

These tools speed up common tasks:
- Design-to-code with Figma
- Understanding codebases with traces
- Step-by-step multi-file editing
- MCP server integrations

---

## Features

| Feature | Purpose |
|---------|---------|
| [Figma Analyzer](./figma-analyzer.md) | Design-to-code via Figma MCP + skill |
| [Code Traces](./code-traces.md) | Understand code flow for features |
| [Guided Edit](./guided-edit.md) | Step-by-step multi-file changes |
| [Browser Debugging](./browser-debugging.md) | Debug & test UI via WebMCP |
| [MCP Integrations](./mcp-integrations.md) | External tool connections |

---

## Quick Start

### Figma Analysis

Share a Figma URL in chat, and WogiFlow uses the Figma MCP server + `figma-analyzer` skill to generate matched components.

### Code Trace

```bash
/wogi-trace "user authentication flow"
```

### Guided Edit

```bash
/wogi-guided-edit "rename Button to BaseButton"
```

---

## Key Configuration

```json
{
  "traces": {
    "saveTo": ".workflow/traces",
    "generateDiagrams": true
  },
  "webmcp": {
    "enabled": false,
    "baseUrl": "http://localhost:3000"
  }
}
```

---

## Integration Points

These tools integrate with:
- Task execution (auto-context)
- Component indexing
- App-map registry
- Hybrid mode

---

## Related

- [Task Execution](../02-task-execution/) - Core workflow
- [Setup](../01-setup-onboarding/) - Component indexing
- [Configuration](../configuration/all-options.md) - All settings
