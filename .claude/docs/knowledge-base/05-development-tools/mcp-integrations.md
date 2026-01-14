# MCP Integrations

<!-- PINS: overview, figma-integration, context7-docs, lsp-integration, custom-servers, auto-search, troubleshooting -->

Connect external tools via Model Context Protocol servers.

---

## Overview
<!-- PIN: overview -->

MCP (Model Context Protocol) allows WogiFlow to:
- Connect to external services
- Access additional tools
- Extend functionality
- Integrate with IDEs

---

## Available Integrations

### Figma MCP

Design-to-code integration:

```json
{
  "figmaAnalyzer": {
    "mcpServer": {
      "port": 3847,
      "autoStart": false
    }
  }
}
```

### Context7 Documentation

Library documentation lookup:

```bash
# Find library ID
mcp-find "react hooks"

# Get documentation
mcp-get-library-docs "/vercel/next.js" --topic "routing"
```

### Custom Servers

Configure additional MCP servers in Claude settings.

---

## Using MCP Tools

### List Available Tools

```bash
mcp-find "search query"
```

### Add a Server

```bash
mcp-add server-name
```

### Enable/Disable Servers

Use Claude Code's MCP commands to manage servers:

```bash
# Enable a server
/mcp enable <server-name>

# Disable a server
/mcp disable <server-name>

# List all servers
/mcp list
```

> **Note**: The @-mention syntax for enabling/disabling MCP servers has been removed. Use `/mcp enable <name>` instead.

### MCP Tool Auto-Search Mode (Claude Code 2.1.7+)
<!-- PIN: auto-search -->

Claude Code automatically manages MCP tools to optimize context usage:

- **When enabled**: If MCP tool descriptions exceed 10% of the context window, tools are automatically deferred
- **Discovery**: Deferred tools are discovered via the `MCPSearch` tool instead of being loaded upfront
- **Default**: Enabled by default for all users

**Implications for WogiFlow users:**
- Keep tool descriptions concise (under 100 words recommended)
- Tools with verbose descriptions may not appear in initial tool list
- Use `MCPSearch` to find deferred tools when needed

**To disable** (not recommended):
```json
// In Claude Code settings
{
  "disallowedTools": ["MCPSearch"]
}
```

**Best practice**: Design MCP tool descriptions to be concise and searchable. Front-load the most important keywords.

### Configure Server

```bash
mcp-config-set server-name {config}
```

---

## Figma Integration
<!-- PIN: figma-integration -->

### Setup

1. Configure MCP server:
   ```json
   {
     "figmaAnalyzer": {
       "mcpServer": {
         "port": 3847,
         "autoStart": true
       }
     }
   }
   ```

2. Install Figma plugin (if available)

3. Connect to server

### Commands

| Command | Purpose |
|---------|---------|
| `figma-analyze` | Analyze frame |
| `figma-export` | Export assets |
| `figma-compare` | Compare to code |

---

## Documentation Integration
<!-- PIN: context7-docs -->

### Context7 Lookup

```bash
# Find library
mcp-resolve-library-id "react"

# Get docs
mcp-get-library-docs "/facebook/react" --topic "hooks"
```

### Automatic Docs

With `skillLearning.fetchOfficialDocs`:

```json
{
  "skillLearning": {
    "fetchOfficialDocs": true,
    "officialDocsUrls": {
      "react": "https://react.dev"
    }
  }
}
```

---

## LSP Integration
<!-- PIN: lsp-integration -->

Language Server Protocol for type information:

```json
{
  "lsp": {
    "enabled": true,
    "server": "typescript-language-server",
    "timeout": 5000,
    "cacheTypes": true
  }
}
```

### Benefits

- Type-aware completions
- Import suggestions
- Error detection
- Go-to-definition

---

## Building Custom MCP Servers
<!-- PIN: custom-servers -->

### Code Mode

Create JavaScript tools combining multiple servers:

```bash
mcp-code-mode --servers "figma,context7" --name "design-docs"
```

### Server Structure

```javascript
// Custom MCP server
module.exports = {
  name: "my-server",
  tools: {
    "my-tool": {
      description: "Does something useful",
      parameters: {...},
      handler: async (params) => {
        // Implementation
      }
    }
  }
};
```

---

## Resource Access

Read resources from MCP servers:

```bash
# List resources
mcp-list-resources

# Read resource
mcp-read-resource "server-name" "resource://path"
```

---

## Best Practices

1. **Start with Built-in**: Use provided integrations first
2. **Configure Once**: Set up profiles for common configs
3. **Check Availability**: Verify server is running
4. **Cache Wisely**: Enable caching for slow services
5. **Security**: Don't expose sensitive servers publicly

---

## Troubleshooting
<!-- PIN: troubleshooting -->

### Server Not Responding

- Check server is running
- Verify port is correct
- Check firewall settings

### Tool Not Found

- Ensure server is added
- Check tool name spelling
- Verify server supports the tool

### Timeout Errors

- Increase timeout settings
- Check network connectivity
- Verify server performance

---

## Related

- [Figma Analyzer](./figma-analyzer.md) - Design integration
- [Configuration](../configuration/all-options.md) - All settings
- [Hybrid Mode](../02-task-execution/02-execution-loop.md#hybrid-mode) - Local LLM execution
